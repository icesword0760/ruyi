#!/usr/bin/env python3
"""
Headless Chrome + CDP + WebRTC 控制服务器
"""

import asyncio
import logging
import os
import threading
import time
from typing import Dict, Optional

from flask import Flask, Response, jsonify, redirect, request, send_file, send_from_directory
from flask_cors import CORS

import config
from headless.webrtc_bridge import HeadlessBridge
from headless.mjpeg_server import MJPEGServer
from headless.stream_server import StreamServer  # 🎬 新增：统一流媒体服务器
from headless.websocket_recorder_handler import WebSocketRecorderHandler

# Configure logging - reduce noise
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger(__name__)
# Reduce noise from 3rd party libs
logging.getLogger("werkzeug").setLevel(logging.WARNING)
logging.getLogger("aiortc").setLevel(logging.WARNING)
logging.getLogger("aioice").setLevel(logging.WARNING)
logging.getLogger("websockets").setLevel(logging.WARNING)

app = Flask(__name__, static_folder="static", template_folder="templates")
app.config["SECRET_KEY"] = config.SECRET_KEY
CORS(app, resources={r"/*": {"origins": config.CORS_ALLOWED_ORIGINS}})


# 全局事件循环与 Headless 管理器
async_loop = asyncio.new_event_loop()
asyncio_thread = threading.Thread(target=async_loop.run_forever, daemon=True)
asyncio_thread.start()

# 🎬 编码模式（可通过配置或API动态修改）
current_encoding_mode = getattr(config, 'DEFAULT_ENCODING_MODE', 'mjpeg')

bridge = HeadlessBridge(
    remote_debugging_port=config.REMOTE_DEBUGGING_PORT,
    remote_debugging_address=config.REMOTE_DEBUGGING_ADDRESS,
    chrome_executable=config.CHROME_EXECUTABLE,
    initial_url=config.DEFAULT_TARGET_URL,
    encoding_mode=current_encoding_mode,  # 🎬 传递编码模式
)

# 🎬 使用新的StreamServer替代MJPEGServer（向后兼容）
# 可以同时支持MJPEG和H.264模式
USE_STREAM_SERVER = True  # 设为False可回退到纯MJPEG模式

if USE_STREAM_SERVER:
    mjpeg_server = StreamServer(port=5567, host="0.0.0.0")
    logger.info("🎬 使用StreamServer（支持MJPEG/H.264双模式）")
else:
    mjpeg_server = MJPEGServer(port=5567, host="0.0.0.0")
    logger.info("🎬 使用MJPEGServer（仅MJPEG模式）")

# 🎬 WebSocket录制处理器 - V5: 传入CDP client用于选择器验证
# 注意：此时bridge还未初始化，CDP client稍后设置
ws_recorder_handler = WebSocketRecorderHandler(cdp_client=None)

# Session release debounce: prevent late pagehide beacons from tearing down a new controller session.
_release_lock = threading.Lock()
_release_timer: Optional[threading.Timer] = None
_last_api_activity_ts = 0.0
_RELEASE_GRACE_SECONDS = 1.5


def run_async(coro):
    return asyncio.run_coroutine_threadsafe(coro, async_loop).result()


@app.before_request
def _track_api_activity():
    """Track API activity and cancel any pending delayed release.

    The controller page sends `/api/session/release` via `sendBeacon()` on `pagehide`.
    That request can arrive *after* a new controller page has started issuing API calls,
    which previously could race and shutdown the browser mid-flow (flaky E2E + bad UX).
    """
    global _last_api_activity_ts, _release_timer
    if not request.path.startswith("/api/"):
        return

    now = time.time()
    with _release_lock:
        _last_api_activity_ts = now
        if request.path != "/api/session/release" and _release_timer is not None:
            _release_timer.cancel()
            _release_timer = None


@app.route("/")
def index():
    return redirect("/controller", code=302)


@app.route("/controller")
def controller():
    controller_app_dir = os.path.join(app.static_folder, "controller-app")
    if os.path.exists(os.path.join(controller_app_dir, "index.html")):
        return send_from_directory(controller_app_dir, "index.html")
    return jsonify({"error": "controller react app not built"}), 500


@app.route("/api/webrtc/offer", methods=["POST"])
def api_webrtc_offer():
    payload = request.get_json(force=True)
    if not payload or "sdp" not in payload:
        return jsonify({"error": "Invalid SDP offer"}), 400

    try:
        answer = run_async(bridge.process_offer(payload))
        return jsonify({"sdp": answer.sdp, "type": answer.type})
    except Exception as exc:  # noqa: BLE001
        logger.exception("Failed to process WebRTC offer")
        return jsonify({"error": str(exc)}), 500


@app.route("/api/session/navigate", methods=["POST"])
def api_session_navigate():
    try:
        payload = request.get_json(force=True)
        url = payload.get("url")
        if not url:
            return jsonify({"error": "URL is required"}), 400

        logger.info("NAVIGATE: %s", url)
        run_async(bridge.navigate(url))
        return jsonify({"status": "ok", "url": url})
    except Exception as exc:
        logger.exception("Navigation failed")
        return jsonify({"error": str(exc)}), 500


@app.route("/api/session/execute", methods=["POST"])
def api_session_execute():
    """Execute JavaScript in the active tab"""
    try:
        payload = request.get_json(force=True)
        script = payload.get("script")
        if not script:
            return jsonify({"error": "script is required"}), 400
        
        result = run_async(bridge.execute_script(script))
        return jsonify({"status": "ok", "result": result})
    except Exception as exc:
        logger.exception("Failed to execute script")
        return jsonify({"error": str(exc)}), 500


@app.route("/api/session/reload", methods=["POST"])
def api_session_reload():
    run_async(bridge.reload())
    return jsonify({"status": "ok"})


@app.route("/api/control/event", methods=["POST"])
def api_control_event():
    """接收MJPEG模式的控制事件"""
    try:
        payload = request.get_json(force=True)
        if not payload or "type" not in payload:
            return jsonify({"error": "Invalid control event"}), 400
        
        # 调试日志：非移动事件
        event_type = payload.get("type")
        if event_type != "mousemove":
            logger.info(f"🖱️  [MJPEG控制] 接收 {event_type}: x={payload.get('x')}, y={payload.get('y')}")
        
        # 🎬 V6: 同时通知录制器记录控制事件（含 XPath 查询）
        if event_type in ["click", "dblclick", "keydown"] and ws_recorder_handler.state.value == 'recording':
            x = payload.get('x', 0)
            y = payload.get('y', 0)
            recorder_event = {
                'type': event_type,
                'timestamp': int(time.time() * 1000),
                'target': {
                    'tagName': 'UNKNOWN',
                    'id': '',
                    'className': '',
                    'textContent': '',
                },
                'clientX': x,
                'clientY': y,
                'offsetX': x,
                'offsetY': y,
                'pageX': x,
                'pageY': y,
                'button': 0,
                'is_remote_control': True,
            }
            
            if event_type == "keydown":
                recorder_event.update({
                    'key': payload.get('key', ''),
                    'code': payload.get('code', ''),
                    'ctrlKey': payload.get('ctrlKey', False),
                    'metaKey': payload.get('metaKey', False),
                    'altKey': payload.get('altKey', False),
                    'shiftKey': payload.get('shiftKey', False),
                })
            
            # V6: 点击/双击查询 XPath
            if event_type in ["click", "dblclick"] and bridge.cdp_client:
                try:
                    element_info = run_async(bridge.cdp_client.get_element_info_at_coordinates(x, y))
                    if element_info and element_info.get('success'):
                        recorder_event['xpath'] = element_info.get('value', '')
                        recorder_event['locationType'] = element_info.get('locationType', 'xpath')
                        recorder_event['xpathIndex'] = element_info.get('index', 0)
                        recorder_event['iframes'] = element_info.get('iframes', [])
                        recorder_event['target'] = {
                            'tagName': element_info.get('tagName', 'UNKNOWN'),
                            'id': '',
                            'className': '',
                            'textContent': element_info.get('text', ''),
                        }
                except Exception as e:
                    logger.warning(f"⚠️ HTTP路径查询XPath失败: {e}")
            
            # 异步调用录制handler
            asyncio.run_coroutine_threadsafe(
                ws_recorder_handler.handle_event(recorder_event),
                async_loop
            )
        
        run_async(bridge.dispatch_control_event(payload))
        return jsonify({"status": "ok"})
    except Exception as exc:
        logger.exception("Failed to dispatch control event")
        return jsonify({"error": str(exc)}), 500


@app.route("/api/session/back", methods=["POST"])
def api_session_back():
    url = run_async(bridge.history_back())
    return jsonify({"status": "ok", "url": url})


@app.route("/api/session/forward", methods=["POST"])
def api_session_forward():
    url = run_async(bridge.history_forward())
    return jsonify({"status": "ok", "url": url})


@app.route("/api/session/reset", methods=["POST"])
def api_session_reset():
    run_async(bridge.reset())
    return jsonify({"status": "ok"})


@app.route("/api/session/release", methods=["POST"])
def api_session_release():
    """释放无头浏览器资源（前端关闭时调用）"""
    logger.info("🛑 收到资源释放请求（前端页面关闭）")
    try:
        # Delay shutdown slightly and cancel if any other API activity happens.
        global _release_timer

        def _do_release():
            global _release_timer
            with _release_lock:
                idle_for = time.time() - _last_api_activity_ts
                if idle_for < _RELEASE_GRACE_SECONDS:
                    return
                _release_timer = None

            run_async(bridge.shutdown())

            # 同时停止 AI 服务子进程
            global _ai_service_process
            if _ai_service_process and _ai_service_process.poll() is None:
                logger.info("🛑 停止 AI 服务子进程...")
                _ai_service_process.terminate()
                try:
                    _ai_service_process.wait(timeout=5)
                except Exception:
                    _ai_service_process.kill()
                _ai_service_process = None
            logger.info("✅ 无头浏览器资源已释放")

        with _release_lock:
            if _release_timer is not None:
                _release_timer.cancel()
                _release_timer = None
            _release_timer = threading.Timer(_RELEASE_GRACE_SECONDS, _do_release)
            _release_timer.daemon = True
            _release_timer.start()

        return jsonify({"status": "ok", "message": "资源释放已排队"})
    except Exception as e:
        logger.error(f"❌ 资源释放失败: {e}")
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route("/api/session/status", methods=["GET"])
def api_session_status():
    status = run_async(bridge.get_status())
    return jsonify(status)


@app.route("/api/session/settings", methods=["POST"])
def api_session_settings():
    """Update FPS, quality, resolution and encoding mode settings"""
    try:
        payload = request.get_json(force=True)
        fps = payload.get("fps")
        quality = payload.get("quality")
        width = payload.get("width")
        height = payload.get("height")
        encoding_mode = payload.get("encoding_mode")  # 🎬 新增：编码模式
        
        if fps is not None:
            run_async(bridge.set_fps(fps))
        
        if quality is not None:
            run_async(bridge.set_quality(quality))
        
        if width is not None and height is not None:
            logger.info(f"📐 更改分辨率: {width}x{height}")
            run_async(bridge.set_resolution(width, height))
        
        # 🎬 处理编码模式切换
        if encoding_mode is not None and encoding_mode != bridge.encoding_mode:
            logger.info(f"🔄 切换编码模式: {bridge.encoding_mode} → {encoding_mode}")
            global current_encoding_mode
            current_encoding_mode = encoding_mode
            bridge.encoding_mode = encoding_mode
            
            # 如果CDP客户端已存在，需要重新初始化以应用新模式
            # 这里简化处理：记录模式，下次重连时生效
            logger.info(f"✅ 编码模式已更新为: {encoding_mode}")
        
        return jsonify({
            "status": "ok",
            "fps": fps,
            "quality": quality,
            "width": width,
            "height": height,
            "encoding_mode": encoding_mode or bridge.encoding_mode
        })
    except Exception as exc:
        logger.exception("Failed to update settings")
        return jsonify({"error": str(exc)}), 500


@app.route("/api/session/capture_mode", methods=["GET"])
def api_session_capture_mode():
    """Get current capture mode (push or poll)"""
    try:
        mode_info = run_async(bridge.get_capture_mode())
        return jsonify(mode_info)
    except Exception as exc:
        logger.exception("Failed to get capture mode")
        return jsonify({"error": str(exc)}), 500


@app.route("/api/session/transport_mode", methods=["GET"])
def api_session_transport_mode():
    """Get current transport mode info (WebRTC or MJPEG)"""
    try:
        webrtc_active = bridge.has_active_peer()
        # StreamServer没有client_count属性，使用stats
        stats = mjpeg_server.get_stats()
        mjpeg_clients = stats.get('mjpeg_clients', 0) + stats.get('h264_clients', 0)
        
        if mjpeg_clients > 0:
            mode = "mjpeg"
            detail = f"MJPEG直传模式 (客户端: {mjpeg_clients})"
        elif webrtc_active:
            mode = "webrtc"
            detail = "WebRTC传输模式"
        else:
            mode = "none"
            detail = "未连接"
        
        return jsonify({
            "mode": mode,
            "detail": detail,
            "webrtc_active": webrtc_active,
            "mjpeg_clients": mjpeg_clients
        })
    except Exception as exc:
        logger.exception("Failed to get transport mode")
        return jsonify({"error": str(exc)}), 500


@app.route("/api/stats/bandwidth", methods=["GET"])
def api_stats_bandwidth():
    """获取带宽和性能统计数据"""
    try:
        stats = mjpeg_server.get_stats()
        return jsonify(stats)
    except Exception as exc:
        logger.exception("Failed to get bandwidth stats")
        return jsonify({"error": str(exc)}), 500


@app.route("/api/tabs/list", methods=["GET"])
def api_tabs_list():
    """List all open tabs"""
    try:
        tabs = run_async(bridge.list_tabs())
        return jsonify({"tabs": tabs})
    except Exception as exc:
        logger.exception("Failed to list tabs")
        return jsonify({"error": str(exc)}), 500


@app.route("/api/tabs/switch", methods=["POST"])
def api_tabs_switch():
    """Switch to a specific tab"""
    try:
        payload = request.get_json(force=True)
        target_id = payload.get("targetId")
        if not target_id:
            return jsonify({"error": "targetId is required"}), 400
        
        success = run_async(bridge.switch_tab(target_id))
        return jsonify({"status": "ok" if success else "failed"})
    except Exception as exc:
        logger.exception("Failed to switch tab")
        return jsonify({"error": str(exc)}), 500


@app.route("/api/tabs/close", methods=["POST"])
def api_tabs_close():
    """Close a specific tab"""
    try:
        payload = request.get_json(force=True)
        target_id = payload.get("targetId")
        if not target_id:
            return jsonify({"error": "targetId is required"}), 400
        
        success = run_async(bridge.close_tab(target_id))
        return jsonify({"status": "ok" if success else "failed"})
    except Exception as exc:
        logger.exception("Failed to close tab")
        return jsonify({"error": str(exc)}), 500


@app.route("/api/tabs/create", methods=["POST"])
def api_tabs_create():
    """Create a new tab"""
    try:
        payload = request.get_json(force=True)
        url = payload.get("url", "about:blank")
        
        target_id = run_async(bridge.create_tab(url))
        if target_id:
            return jsonify({"status": "ok", "targetId": target_id})
        else:
            return jsonify({"error": "Failed to create tab"}), 500
    except Exception as exc:
        logger.exception("Failed to create tab")
        return jsonify({"error": str(exc)}), 500


# 🎬 V6录制回放API — 持久化存储
import json
import os
import requests as http_requests  # HTTP请求库（用于代理AI服务）

RECORDINGS_DIR = os.path.join(os.path.dirname(__file__), "recordings")
os.makedirs(RECORDINGS_DIR, exist_ok=True)

recording_sessions = {}  # recordingId -> {steps: [], startTime, endTime}  (内存缓存)
active_recording_id = None


def _recording_path(recording_id) -> str:
    """获取录制文件路径"""
    return os.path.join(RECORDINGS_DIR, f"{recording_id}.json")


def _save_recording(recording_id, data: dict):
    """将录制数据保存到磁盘"""
    try:
        path = _recording_path(recording_id)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2, default=str)
        steps = data.get('steps', [])
        step_count = steps if isinstance(steps, int) else len(steps)
        logger.info(f"💾 录制已保存到磁盘: {path} ({step_count} 步骤)")
    except Exception as e:
        logger.error(f"❌ 保存录制失败: {e}", exc_info=True)


def _load_all_recordings() -> list:
    """从磁盘加载所有录制记录（摘要信息，不含完整步骤详情）"""
    result = []
    try:
        for fname in sorted(os.listdir(RECORDINGS_DIR), reverse=True):
            if not fname.endswith('.json'):
                continue
            fpath = os.path.join(RECORDINGS_DIR, fname)
            try:
                with open(fpath, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                result.append(data)
            except Exception as e:
                logger.warning(f"⚠️ 加载录制文件失败 {fname}: {e}")
    except Exception as e:
        logger.error(f"❌ 遍历录制目录失败: {e}")
    return result


def _load_recording(recording_id) -> dict:
    """从磁盘加载单个录制的完整数据"""
    path = _recording_path(recording_id)
    if not os.path.exists(path):
        return None
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"❌ 加载录制 {recording_id} 失败: {e}")
        return None


def _delete_recording(recording_id) -> bool:
    """从磁盘删除单个录制"""
    path = _recording_path(recording_id)
    if os.path.exists(path):
        try:
            os.remove(path)
            logger.info(f"🗑️ 录制已删除: {path}")
            return True
        except Exception as e:
            logger.error(f"❌ 删除录制失败: {e}")
    return False

async def _broadcast_step_to_frontend(recording_id: int, step: Dict):
    """广播步骤到前端（async - broadcast_control_message 是协程）"""
    try:
        await mjpeg_server.broadcast_control_message({
            "type": "NEW_STEP",
            "recordingId": recording_id,
            "step": step
        })
        step_num = step.get('_metadata', {}).get('number', step.get('_metadata', {}).get('step_number', '?'))
        logger.info(f"📤 [CDPRecorder] 广播步骤 #{step_num} 到前端")
    except Exception as e:
        logger.error(f"❌ 广播步骤失败: {e}", exc_info=True)

@app.route("/api/recorder/start", methods=["POST"])
def api_recorder_start():
    """V4: 开始录制（同时启动 CDP Recorder + WS Recorder）"""
    global active_recording_id
    
    try:
        if not bridge or not bridge.cdp_client:
            return jsonify({"error": "CDP client not available"}), 503
        
        # 设置步骤广播回调
        bridge.cdp_client.recorder.set_step_callback(_broadcast_step_to_frontend)
        
        # 获取页面信息
        payload = request.get_json(force=True) if request.is_json else {}
        url = payload.get("url", "")
        title = payload.get("title", "")
        
        # 调用CDP Recorder
        recording_id = run_async(bridge.cdp_client.recorder.start_recording(url, title))
        active_recording_id = recording_id
        
        # 同时启动 WS Recorder（远程控制事件需要它来捕获）
        run_async(ws_recorder_handler.handle_event({
            'type': 'recording_started',
            'url': url,
            'title': title,
        }))
        
        # 初始化session记录
        recording_sessions[recording_id] = {
            "id": recording_id,
            "startTime": time.time(),
            "steps": [],
            "url": url,
            "title": title
        }
        
        logger.info(f"🔴 V4开始录制: {recording_id} (CDP + WS Recorder)")
        
        return jsonify({"success": True, "recordingId": recording_id})
        
    except Exception as e:
        logger.error(f"❌ 开始录制失败: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500

@app.route("/api/recorder/stop", methods=["POST"])
def api_recorder_stop():
    """V4: 停止录制"""
    global active_recording_id
    
    try:
        if not bridge or not bridge.cdp_client:
            return jsonify({"error": "CDP client not available"}), 503
        
        # 同时停止 WS Recorder
        run_async(ws_recorder_handler.handle_event({'type': 'recording_stopped'}))
        
        # 调用CDP Recorder
        session = run_async(bridge.cdp_client.recorder.stop_recording())
        
        if session:
            recording_id = session.recording_id
            steps = session.steps
            
            # 构建完整的录制数据
            rec_data = {
                "id": recording_id,
                "name": f"录制 #{recording_id}",
                "startTime": getattr(session, 'start_time', time.time()),
                "endTime": time.time(),
                "steps": len(steps),
                "stepData": steps,
                "url": getattr(session, 'url', ''),
                "title": getattr(session, 'title', ''),
                "timestamp": time.strftime('%Y/%m/%d %H:%M:%S'),
                "durationSeconds": int(time.time() - getattr(session, 'start_time', time.time())),
            }
            
            # 更新内存缓存
            recording_sessions[recording_id] = rec_data
            
            # 💾 持久化到磁盘
            _save_recording(recording_id, rec_data)
            
            logger.info(f"⏹️ V4停止录制: {recording_id}, 共 {len(steps)} 步骤")
            
            # 通知前端（broadcast_control_message 是协程，需要通过 run_async 调用）
            try:
                run_async(mjpeg_server.broadcast_control_message({
                    "type": "RECORDING_STOPPED",
                    "recordingId": recording_id,
                    "steps": len(steps)
                }))
            except Exception as e:
                logger.warning(f"⚠️ 广播RECORDING_STOPPED失败: {e}")
            
            active_recording_id = None
            return jsonify({"success": True, "recordingId": recording_id, "steps": len(steps)})
        else:
            return jsonify({"error": "No active recording"}), 404
        
    except Exception as e:
        logger.error(f"❌ 停止录制失败: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500

# 兼容V1-V3旧API（用于UI按钮，逐步迁移）
@app.route("/api/recorder/event", methods=["POST"])
def api_recorder_event():
    """兼容旧API，转发到新API"""
    try:
        payload = request.get_json(force=True)
        event_type = payload.get("type")
        
        if event_type == "START_RECORDING":
            return api_recorder_start()
        elif event_type == "STOP_RECORDING":
            return api_recorder_stop()
        else:
            # V4: RECORD_STEP由CDP Recorder自动处理，不需要HTTP API
            logger.debug(f"📝 忽略旧API事件: {event_type} (V4自动处理)")
            return jsonify({"success": True, "message": "Event handled by CDP Recorder V4"})
        
    except Exception as e:
        logger.error(f"❌ 处理录制事件失败: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route("/api/recorder/sessions", methods=["GET"])
def api_recorder_sessions():
    """V6: 获取所有录制会话（从磁盘加载）"""
    recordings = _load_all_recordings()
    # 返回摘要信息（不含 stepData 以减小传输量）
    summaries = []
    for rec in recordings:
        summary = {k: v for k, v in rec.items() if k != 'stepData'}
        summaries.append(summary)
    return jsonify({
        "sessions": summaries,
        "activeRecordingId": active_recording_id
    })


@app.route("/api/recorder/session/<recording_id>", methods=["GET"])
def api_recorder_session(recording_id):
    """V6: 获取特定录制会话的完整详情（含步骤数据）"""
    rec = _load_recording(recording_id)
    if rec:
        return jsonify(rec)
    else:
        return jsonify({"error": "Recording not found"}), 404


@app.route("/api/recorder/session/<recording_id>", methods=["DELETE"])
def api_recorder_session_delete(recording_id):
    """V6: 删除录制"""
    recording_sessions.pop(int(recording_id), None)
    success = _delete_recording(recording_id)
    if success:
        return jsonify({"success": True})
    else:
        return jsonify({"error": "Recording not found"}), 404


@app.route("/api/recorder/session/<recording_id>/rename", methods=["POST"])
def api_recorder_session_rename(recording_id):
    """V6: 重命名录制"""
    payload = request.get_json(force=True)
    new_name = payload.get('name', '')
    if not new_name:
        return jsonify({"error": "Name is required"}), 400
    
    rec = _load_recording(recording_id)
    if not rec:
        return jsonify({"error": "Recording not found"}), 404
    
    rec['name'] = new_name
    _save_recording(recording_id, rec)
    return jsonify({"success": True, "name": new_name})


# ─── 🤖 AI 助手 API ─────────────────────────────────────────
AI_SERVICE_URL = "http://127.0.0.1:3100"
AI_SCRIPTS_DIR = os.path.join(os.path.dirname(__file__), "recordings", "ai_scripts")
os.makedirs(AI_SCRIPTS_DIR, exist_ok=True)

_ai_service_process = None

def _start_ai_service():
    """启动 Node.js AI 服务子进程（非阻塞）"""
    global _ai_service_process
    import subprocess
    ai_dir = os.path.join(os.path.dirname(__file__), "ai_service")
    if not os.path.isfile(os.path.join(ai_dir, "server.js")):
        logger.warning("⚠️ AI 服务目录不存在 server.js，跳过自动启动")
        return
    try:
        resp = http_requests.get(f"{AI_SERVICE_URL}/status", timeout=2)
        if resp.ok:
            logger.info("✅ AI 服务已在运行")
            return
    except Exception:
        pass
    logger.info("🚀 自动启动 AI 服务 (ai_service/server.js)...")
    _ai_service_process = subprocess.Popen(
        ["node", "server.js"],
        cwd=ai_dir,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    # 后台线程转发 AI 服务日志
    def _drain_ai_log():
        for line in _ai_service_process.stdout:
            logger.info(f"[AI] {line.rstrip()}")
    threading.Thread(target=_drain_ai_log, daemon=True).start()
    # 等待就绪（最多 10 秒）
    for _ in range(20):
        time.sleep(0.5)
        try:
            resp = http_requests.get(f"{AI_SERVICE_URL}/status", timeout=2)
            if resp.ok:
                logger.info("✅ AI 服务已就绪")
                return
        except Exception:
            pass
    logger.warning("⚠️ AI 服务启动超时，可能未就绪")


def _ai_proxy(method, path, json_data=None, timeout=120):
    """代理请求到 Node.js AI 服务"""
    url = f"{AI_SERVICE_URL}{path}"
    try:
        if method == 'GET':
            resp = http_requests.get(url, timeout=timeout)
        else:
            resp = http_requests.post(url, json=json_data, timeout=timeout)
        return resp.json(), resp.status_code
    except http_requests.exceptions.ConnectionError:
        return {"success": False, "error": "AI服务未启动，请先运行: cd ai_service && npm start"}, 503
    except http_requests.exceptions.Timeout:
        return {"success": False, "error": "AI服务响应超时"}, 504
    except Exception as e:
        return {"success": False, "error": f"AI服务请求失败: {str(e)}"}, 500


@app.route("/api/ai/status", methods=["GET"])
def api_ai_status():
    """AI服务健康检查"""
    data, status = _ai_proxy('GET', '/status')
    return jsonify(data), status


@app.route("/api/ai/run", methods=["POST"])
def api_ai_run():
    """AI黑盒执行 —— SSE流式代理到Node.js Midscene服务"""
    payload = request.get_json(force=True)

    def generate():
        try:
            resp = http_requests.post(
                f"{AI_SERVICE_URL}/ai-run",
                json=payload,
                stream=True,
                timeout=300,
            )
            for line in resp.iter_lines():
                if line:
                    yield line.decode('utf-8') + '\n\n'
        except http_requests.exceptions.ConnectionError:
            yield f'data: {{"type":"error","error":"AI服务未启动，请先运行: cd ai_service && npm start"}}\n\n'
        except Exception as e:
            yield f'data: {{"type":"error","error":"{str(e)}"}}\n\n'

    return Response(generate(), mimetype='text/event-stream',
                    headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})


@app.route("/api/ai/execute-step", methods=["POST"])
def api_ai_execute_step():
    """执行单个步骤（回放用）"""
    payload = request.get_json(force=True)
    data, status = _ai_proxy('POST', '/execute-step', payload, timeout=120)
    return jsonify(data), status


@app.route("/api/ai/regenerate-step", methods=["POST"])
def api_ai_regenerate_step():
    """重新生成单步定位信息（不执行动作）"""
    payload = request.get_json(force=True)
    data, status = _ai_proxy('POST', '/regenerate-step', payload, timeout=120)
    return jsonify(data), status


@app.route("/api/ocr/extract-text", methods=["POST"])
def api_ocr_extract_text():
    """轻量 OCR 文字提取 —— 直接调用 RapidOCR，不经 AI 服务"""
    try:
        data = request.get_json(force=True)
        image_b64 = data.get("image", "")
        if not image_b64:
            return jsonify({"success": False, "error": "缺少 image 参数"}), 400

        ocr_url = os.environ.get("OCR_SERVICE_URL", "http://127.0.0.1:9788")
        resp = http_requests.post(
            f"{ocr_url}/ocr",
            json={"image": image_b64},
            timeout=10,
        )
        if resp.status_code != 200:
            return jsonify({"success": False, "error": f"RapidOCR HTTP {resp.status_code}"}), 502

        ocr_data = resp.json()
        results = ocr_data.get("results", [])
        text = " ".join(r.get("text", "") for r in results).strip()
        return jsonify({"success": bool(text), "text": text})
    except http_requests.exceptions.ConnectionError:
        return jsonify({"success": False, "error": "RapidOCR 服务未启动"}), 503
    except Exception as e:
        logger.error(f"OCR extract-text 异常: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


# ─── AI 脚本持久化 ───────────────────────────────────────

def _ai_script_path(script_id) -> str:
    return os.path.join(AI_SCRIPTS_DIR, f"{script_id}.json")


def _save_ai_script(script_id, data: dict):
    """保存AI脚本到磁盘"""
    try:
        path = _ai_script_path(script_id)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2, default=str)
        logger.info(f"💾 AI脚本已保存: {path}")
    except Exception as e:
        logger.error(f"❌ 保存AI脚本失败: {e}", exc_info=True)


def _load_all_ai_scripts() -> list:
    """加载所有AI脚本"""
    result = []
    try:
        for fname in sorted(os.listdir(AI_SCRIPTS_DIR), reverse=True):
            if not fname.endswith('.json'):
                continue
            fpath = os.path.join(AI_SCRIPTS_DIR, fname)
            try:
                with open(fpath, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                # 返回摘要（不含大截图数据）
                summary = {k: v for k, v in data.items() if k != 'executionResults'}
                result.append(summary)
            except Exception as e:
                logger.warning(f"⚠️ 加载AI脚本失败 {fname}: {e}")
    except Exception as e:
        logger.error(f"❌ 遍历AI脚本目录失败: {e}")
    return result


def _load_ai_script(script_id) -> dict:
    path = _ai_script_path(script_id)
    if not os.path.exists(path):
        return None
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"❌ 加载AI脚本 {script_id} 失败: {e}")
        return None


def _delete_ai_script(script_id) -> bool:
    path = _ai_script_path(script_id)
    if os.path.exists(path):
        try:
            os.remove(path)
            return True
        except Exception as e:
            logger.error(f"❌ 删除AI脚本失败: {e}")
    return False


@app.route("/api/ai/scripts", methods=["GET"])
def api_ai_scripts_list():
    """获取已保存的AI脚本列表"""
    scripts = _load_all_ai_scripts()
    return jsonify({"success": True, "scripts": scripts})


@app.route("/api/ai/scripts", methods=["POST"])
def api_ai_scripts_save():
    """保存AI脚本"""
    payload = request.get_json(force=True)
    script_id = payload.get('id') or str(int(time.time() * 1000))
    _save_ai_script(script_id, payload)
    return jsonify({"success": True, "id": script_id})


@app.route("/api/ai/scripts/<script_id>", methods=["GET"])
def api_ai_scripts_get(script_id):
    """获取单个AI脚本详情"""
    script = _load_ai_script(script_id)
    if not script:
        return jsonify({"error": "Script not found"}), 404
    return jsonify({"success": True, "script": script})


@app.route("/api/ai/scripts/<script_id>", methods=["DELETE"])
def api_ai_scripts_delete(script_id):
    """删除AI脚本"""
    if _delete_ai_script(script_id):
        return jsonify({"success": True})
    return jsonify({"error": "Script not found"}), 404


@app.route("/api/ai/scripts/<script_id>/rename", methods=["POST"])
def api_ai_scripts_rename(script_id):
    """重命名AI脚本"""
    payload = request.get_json(force=True)
    new_name = payload.get('name', '')
    if not new_name:
        return jsonify({"error": "Name is required"}), 400
    script = _load_ai_script(script_id)
    if not script:
        return jsonify({"error": "Script not found"}), 404
    script['name'] = new_name
    _save_ai_script(script_id, script)
    return jsonify({"success": True, "name": new_name})


@app.route("/api/ai/scripts/<script_id>/export", methods=["GET"])
def api_ai_scripts_export(script_id):
    """导出 AI 脚本为 pytest + allure 格式的 Python 测试文件"""
    script = _load_ai_script(script_id)
    if not script:
        return jsonify({"error": "Script not found"}), 404

    from io import BytesIO
    code = _generate_pytest_file(script)
    buf = BytesIO(code.encode("utf-8"))
    buf.seek(0)

    safe_name = "".join(c if c.isalnum() or c == "_" else "_" for c in (script.get("name") or script_id))
    filename = f"test_{safe_name}.py"

    return send_file(buf, mimetype="text/x-python", as_attachment=True, download_name=filename)


def _generate_pytest_file(script: dict) -> str:
    """将脚本 JSON 转为 pytest + allure 的 Python 源码（使用 webrtc_healing 自愈引擎）"""
    import json as _json
    import re

    name = script.get("name", "unnamed")
    steps = script.get("steps", [])

    def _q(s):
        if s is None:
            return "''"
        return repr(str(s))

    def _make_func_name(s):
        s = re.sub(r"[^\w]+", "_", str(s))
        return s.strip("_").lower() or "unnamed"

    class_name = "Test" + "".join(w.capitalize() for w in re.sub(r"[^\w]+", " ", name).split())
    if not class_name[4:]:
        class_name = "TestScript"

    lines = [
        '"""',
        f"自动生成的测试脚本: {name}",
        f"步骤数: {len(steps)}",
        f"自愈策略: 7 策略引擎 (XPath / CSS / Text+OCR / Image / Coords / AI / RawCoords)",
        '"""',
        "import json",
        "import allure",
        "import pytest",
        "",
        "from webrtc_healing import execute_step",
        "from webrtc_healing.conftest_template import *  # noqa: F401,F403 — browser, page fixtures",
        "",
        "",
    ]

    lines.append(f"@allure.epic({_q(name)})")
    lines.append("@allure.feature('自动化回放')")
    lines.append(f"class {class_name}:")
    lines.append(f"    \"\"\"自动生成: {name}\"\"\"")
    lines.append("")

    for i, step in enumerate(steps):
        action = step.get("action", "click")
        desc = step.get("description") or step.get("target") or f"步骤{i+1}"
        safe_desc = re.sub(r"[^\w]+", "_", desc)[:40].strip("_").lower() or f"step_{i+1}"
        method_name = f"test_{i+1:02d}_{safe_desc}"

        allure_title = desc.replace("'", "\\'")
        step_json = _json.dumps(step, ensure_ascii=False)

        lines.append(f"    @allure.story('{action}')")
        lines.append(f"    @allure.title('{allure_title}')")
        lines.append(f"    def {method_name}(self, page):")
        lines.append(f"        \"\"\"步骤 {i+1}: {desc}\"\"\"")
        lines.append(f"        step = {step_json}")
        lines.append(f"")
        lines.append(f"        with allure.step('{action}: {allure_title}'):")
        lines.append(f"            result = execute_step(page, step)")
        lines.append(f"            if result.get('heal_log'):")
        lines.append(f"                allure.attach(")
        lines.append(f"                    '\\n'.join(result['heal_log']),")
        lines.append(f"                    name='自愈日志',")
        lines.append(f"                    attachment_type=allure.attachment_type.TEXT,")
        lines.append(f"                )")
        lines.append(f"            assert result['success'], (")
        lines.append(f"                f\"步骤失败: {{result.get('error', '未知错误')}}\"")
        lines.append(f"            )")
        lines.append("")

    lines.append("")
    lines.append("# ─── 运行方式 ─────────────────────────────────────────")
    lines.append("# 1. 安装依赖:  pip install pytest allure-pytest playwright webrtc-healing requests")
    lines.append("# 2. 确保 Chrome 已通过 CDP 运行在 127.0.0.1:9222")
    lines.append(f"# 3. 运行测试:  pytest test_{_make_func_name(name)}.py --alluredir=allure-results -v")
    lines.append("# 4. 查看报告:  allure serve allure-results")
    lines.append("#")
    lines.append("# 环境变量（可选）:")
    lines.append("#   CHROME_CDP_URL=http://127.0.0.1:9222  — Chrome CDP 地址")
    lines.append("#   WEBRTC_STANDALONE=1                    — 独立模式（禁用 OCR/AI/Airtest 服务）")
    lines.append("#   WEBRTC_PLATFORM_URL=http://...         — 平台服务地址")
    lines.append("#   WEBRTC_AI_SERVICE_URL=http://...       — AI 服务地址")
    lines.append("#   WEBRTC_OCR_SERVICE_URL=http://...      — OCR 服务地址")
    lines.append("")

    return "\n".join(lines) + "\n"


def shutdown():
    try:
        run_async(mjpeg_server.stop())
        run_async(bridge.shutdown())
    finally:
        if _ai_service_process and _ai_service_process.poll() is None:
            logger.info("🛑 停止 AI 服务子进程...")
            _ai_service_process.terminate()
            _ai_service_process.wait(timeout=5)
        async_loop.call_soon_threadsafe(async_loop.stop)


# ─── 元素自愈 API ──────────────────────────────────────

@app.route("/api/airtest-match", methods=["POST"])
def api_airtest_match():
    """
    图像模板匹配（Airtest）
    支持 matchIndex：匹配多个区域时按从上到下、从左到右排序后取第 N 个
    """
    import base64
    import io
    try:
        data = request.get_json()
        template_b64 = data.get("template", "")
        threshold = float(data.get("threshold", 0.7))
        match_index = int(data.get("matchIndex", 0))

        if not template_b64:
            return jsonify({"success": False, "error": "缺少 template 图片"}), 400

        if not bridge or not bridge.cdp_client:
            return jsonify({"success": False, "error": "浏览器未连接"}), 503

        screenshot_b64 = run_async(bridge.cdp_client.take_screenshot_base64())
        if not screenshot_b64:
            return jsonify({"success": False, "error": "截图失败"}), 500

        from PIL import Image
        import numpy as np

        screen_img = Image.open(io.BytesIO(base64.b64decode(screenshot_b64)))
        template_img = Image.open(io.BytesIO(base64.b64decode(template_b64)))

        screen_np = np.array(screen_img.convert("RGB"))
        template_np = np.array(template_img.convert("RGB"))

        def sort_and_pick(matches, idx):
            """按从上到下、从左到右排序，取第 idx 个"""
            sorted_m = sorted(matches, key=lambda m: (m["y"], m["x"]))
            pick = sorted_m[idx] if idx < len(sorted_m) else sorted_m[0]
            pick["matchTotal"] = len(sorted_m)
            pick["matchIndex"] = min(idx, len(sorted_m) - 1)
            return pick

        # 尝试使用 Airtest
        try:
            from airtest.aircv import find_all_template
            screen_bgr = screen_np[:, :, ::-1].copy()
            template_bgr = template_np[:, :, ::-1].copy()

            results = find_all_template(screen_bgr, template_bgr, threshold=threshold)
            if results:
                all_matches = []
                for r in results:
                    cx, cy = r["result"]
                    all_matches.append({
                        "x": int(cx), "y": int(cy),
                        "confidence": round(r.get("confidence", 0), 4),
                    })
                picked = sort_and_pick(all_matches, match_index)
                logger.info(f"🖼️ Airtest 匹配成功: ({picked['x']}, {picked['y']}) [{picked['matchIndex']}/{picked['matchTotal']}]")
                return jsonify({"success": True, **picked, "method": "airtest"})
            else:
                return jsonify({"success": False, "error": "模板匹配未找到", "method": "airtest"})

        except ImportError:
            # Airtest 未安装，使用 OpenCV 回退
            try:
                import cv2
                screen_gray = cv2.cvtColor(screen_np, cv2.COLOR_RGB2GRAY)
                template_gray = cv2.cvtColor(template_np, cv2.COLOR_RGB2GRAY)
                th, tw = template_gray.shape

                result = cv2.matchTemplate(screen_gray, template_gray, cv2.TM_CCOEFF_NORMED)
                # 提取所有超过阈值的匹配位置
                locations = np.where(result >= threshold)
                if len(locations[0]) == 0:
                    max_val = float(result.max()) if result.size else 0
                    return jsonify({"success": False, "error": f"匹配度不足 ({max_val:.3f} < {threshold})", "method": "opencv"})

                # 聚类相邻点（NMS 简化版：合并距离 < 模板尺寸一半的点）
                pts = list(zip(locations[1].tolist(), locations[0].tolist()))
                clusters = []
                used = set()
                merge_dist = max(tw, th) // 2
                for i, (px, py) in enumerate(pts):
                    if i in used:
                        continue
                    group_x, group_y, group_n = [px], [py], 1
                    used.add(i)
                    for j in range(i + 1, len(pts)):
                        if j in used:
                            continue
                        if abs(pts[j][0] - px) < merge_dist and abs(pts[j][1] - py) < merge_dist:
                            group_x.append(pts[j][0])
                            group_y.append(pts[j][1])
                            group_n += 1
                            used.add(j)
                    cx = int(np.mean(group_x)) + tw // 2
                    cy = int(np.mean(group_y)) + th // 2
                    val = float(result[int(np.mean(group_y)), int(np.mean(group_x))])
                    clusters.append({"x": cx, "y": cy, "confidence": round(val, 4)})

                picked = sort_and_pick(clusters, match_index)
                logger.info(f"🖼️ OpenCV 匹配成功: ({picked['x']}, {picked['y']}) [{picked['matchIndex']}/{picked['matchTotal']}]")
                return jsonify({"success": True, **picked, "method": "opencv"})

            except ImportError:
                return jsonify({"success": False, "error": "需要安装 airtest 或 opencv-python", "method": "none"})

    except Exception as e:
        logger.error(f"❌ Airtest 匹配异常: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/ocr-locate", methods=["POST"])
def api_ocr_locate():
    """
    OCR 文本定位 —— 在当前页面截图中查找指定文本的位置
    支持 matchIndex：匹配多个结果时按从上到下、从左到右排序后取第 N 个
    """
    import base64
    import io
    try:
        data = request.get_json()
        text = data.get("text", "").strip()
        match_index = int(data.get("matchIndex", 0))
        if not text:
            return jsonify({"success": False, "error": "缺少 text 参数"}), 400

        if not bridge or not bridge.cdp_client:
            return jsonify({"success": False, "error": "浏览器未连接"}), 503

        screenshot_b64 = run_async(bridge.cdp_client.take_screenshot_base64())
        if not screenshot_b64:
            return jsonify({"success": False, "error": "截图失败"}), 500

        from PIL import Image
        import numpy as np

        screen_img = Image.open(io.BytesIO(base64.b64decode(screenshot_b64)))
        screen_np = np.array(screen_img.convert("RGB"))

        def sort_matches_by_position(matches):
            """按从上到下、从左到右排序"""
            return sorted(matches, key=lambda m: (m["y"], m["x"]))

        def select_by_index(matches, idx):
            if not matches:
                return None
            sorted_m = sort_matches_by_position(matches)
            pick = sorted_m[idx] if idx < len(sorted_m) else sorted_m[0]
            pick["matchTotal"] = len(sorted_m)
            pick["matchIndex"] = min(idx, len(sorted_m) - 1)
            return pick

        # 尝试 PaddleOCR
        try:
            from paddleocr import PaddleOCR
            ocr = PaddleOCR(use_angle_cls=True, lang='ch', show_log=False)
            results = ocr.ocr(screen_np, cls=True)

            all_matches = []
            for line in (results[0] or []):
                box, (detected_text, confidence) = line
                if text.lower() in detected_text.lower() or detected_text.lower() in text.lower():
                    xs = [p[0] for p in box]
                    ys = [p[1] for p in box]
                    all_matches.append({
                        "x": int((min(xs) + max(xs)) / 2),
                        "y": int((min(ys) + max(ys)) / 2),
                        "text": detected_text,
                        "confidence": round(float(confidence), 4),
                        "box": {"x1": int(min(xs)), "y1": int(min(ys)), "x2": int(max(xs)), "y2": int(max(ys))},
                    })

            picked = select_by_index(all_matches, match_index)
            if picked:
                logger.info(f"🔤 PaddleOCR 定位成功: '{picked['text']}' at ({picked['x']}, {picked['y']}) [{picked['matchIndex']}/{picked['matchTotal']}]")
                return jsonify({"success": True, **picked, "method": "paddleocr"})
            else:
                return jsonify({"success": False, "error": f"未找到文本 '{text}'", "method": "paddleocr"})

        except ImportError:
            pass

        # 回退：尝试 EasyOCR
        try:
            import easyocr
            reader = easyocr.Reader(['ch_sim', 'en'], gpu=False)
            results = reader.readtext(screen_np)

            all_matches = []
            for (box, detected_text, confidence) in results:
                if text.lower() in detected_text.lower() or detected_text.lower() in text.lower():
                    xs = [p[0] for p in box]
                    ys = [p[1] for p in box]
                    all_matches.append({
                        "x": int((min(xs) + max(xs)) / 2),
                        "y": int((min(ys) + max(ys)) / 2),
                        "text": detected_text,
                        "confidence": round(float(confidence), 4),
                    })

            picked = select_by_index(all_matches, match_index)
            if picked:
                logger.info(f"🔤 EasyOCR 定位成功: '{picked['text']}' at ({picked['x']}, {picked['y']})")
                return jsonify({"success": True, **picked, "method": "easyocr"})
            else:
                return jsonify({"success": False, "error": f"未找到文本 '{text}'", "method": "easyocr"})

        except ImportError:
            return jsonify({"success": False, "error": "需要安装 paddleocr 或 easyocr", "method": "none"})

    except Exception as e:
        logger.error(f"❌ OCR 定位异常: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


if __name__ == "__main__":
    try:
        # 启动MJPEG服务器
        run_async(mjpeg_server.start())
        
        # Connect MJPEG server to bridge
        bridge.set_mjpeg_server(mjpeg_server)
        logger.info("🔗 MJPEG服务器已连接到HeadlessBridge")
        
        # V5: 设置录制handler到bridge（用于捕获远程控制事件）
        bridge._recorder_handler = ws_recorder_handler
        logger.info("✅ 录制handler已设置到bridge")
        
        # 🎬 设置录制事件回调
        async def handle_recorder_event(event_data):
            """处理来自WebSocket的录制事件"""
            await ws_recorder_handler.handle_event(event_data)
        
        mjpeg_server.set_recorder_callback(handle_recorder_event)
        
        # 设置步骤广播回调
        async def broadcast_step(recording_id, step):
            """广播录制消息到前端（步骤或状态变化）"""
            logger.info(f"📡 [SERVER] broadcast_step被调用: recording_id={recording_id}, step_type={step.get('type')}")
            
            # 根据消息类型决定如何包装
            step_type = step.get('type')
            
            if step_type in ['RECORDING_STARTED', 'RECORDING_STOPPED']:
                # 录制状态消息，直接发送
                message = step
                logger.info(f"📤 [SERVER] 广播状态消息: {step_type}")
            else:
                # 录制步骤消息，包装为NEW_STEP
                message = {
                    "type": "NEW_STEP",
                    "recording_id": recording_id,
                    "step": step
                }
                logger.info(f"📤 [SERVER] 广播步骤消息: step_type={step_type}")
            
            logger.debug(f"📋 [SERVER] 完整消息: {message}")
            
            # broadcast_control_message是async方法，需要await
            try:
                await mjpeg_server.broadcast_control_message(message)
                logger.info(f"✅ [SERVER] broadcast_control_message调用成功")
            except Exception as e:
                logger.error(f"❌ [SERVER] broadcast_control_message失败: {e}", exc_info=True)
        
        ws_recorder_handler.set_step_callback(broadcast_step)
        
        # V6: 设置录制持久化回调
        ws_recorder_handler.set_save_callback(_save_recording)
        
        logger.info("✅ WebSocket录制处理器已初始化")
        
        # V5: 设置元素查询回调
        async def handle_element_query(query_type, selector, request_id):
            """处理元素查询请求（用于智能回放）"""
            logger.debug(f"🔍 [SERVER] 元素查询: type={query_type}, selector={selector}")
            
            try:
                if query_type == 'check_element':
                    # 检查元素是否存在
                    exists = await bridge.check_element_exists(selector)
                    return {
                        'type': 'element_check_result',
                        'requestId': request_id,
                        'exists': exists,
                        'selector': selector
                    }
                
                elif query_type == 'get_position':
                    # 获取元素位置
                    position = await bridge.get_element_position(selector)
                    return {
                        'type': 'element_position_result',
                        'requestId': request_id,
                        'position': position,
                        'selector': selector
                    }
                
                else:
                    return {
                        'type': 'query_error',
                        'requestId': request_id,
                        'error': f'Unknown query type: {query_type}'
                    }
                    
            except Exception as e:
                logger.error(f"❌ 元素查询失败: {e}")
                return {
                    'type': 'query_error',
                    'requestId': request_id,
                    'error': str(e)
                }
        
        mjpeg_server.set_element_query_callback(handle_element_query)
        logger.info("✅ 元素查询回调已设置")
        
        # V5修复：设置控制事件回调
        async def handle_control_event(event):
            """处理来自前端的控制事件（点击、滚动等）"""
            try:
                await bridge._handle_mjpeg_control_ws(event)
            except Exception as e:
                logger.error(f"❌ 控制事件处理失败: {e}")
        
        mjpeg_server.set_control_callback(handle_control_event)
        logger.info("✅ 控制事件回调已设置")
        
        # 设置模式切换回调
        async def handle_mode_switch(new_mode: str):
            try:
                await bridge.switch_stream_mode(new_mode)
            except Exception as e:
                logger.error(f"❌ 模式切换失败: {e}")
        
        mjpeg_server.set_mode_switch_callback(handle_mode_switch)
        logger.info("✅ 模式切换回调已设置")
        
        # 设置全部客户端断开后的资源释放回调
        async def handle_all_clients_disconnected():
            """所有投屏客户端断开后，自动释放无头浏览器资源"""
            logger.info("🛑 所有客户端已断开，自动释放无头浏览器资源...")
            try:
                await bridge.shutdown()
                logger.info("✅ 无头浏览器资源已自动释放")
                # 同时停止 AI 服务
                global _ai_service_process
                if _ai_service_process and _ai_service_process.poll() is None:
                    logger.info("🛑 停止 AI 服务子进程...")
                    _ai_service_process.terminate()
                    _ai_service_process = None
            except Exception as e:
                logger.error(f"❌ 自动释放资源失败: {e}")

        mjpeg_server.set_all_clients_disconnected_callback(handle_all_clients_disconnected)
        
        # V5: 设置CDP client到录制处理器（用于选择器验证）
        if bridge.cdp_client:
            ws_recorder_handler.selector_generator.cdp_client = bridge.cdp_client
            logger.info("✅ CDP client已设置到选择器生成器")
        
        # 自动启动 AI 服务（Node.js）
        _start_ai_service()

        logger.info(
            "Headless WebRTC server started on http://%s:%s",
            config.SERVER_HOST,
            config.SERVER_PORT,
        )
        # 禁用reloader以避免MJPEG服务器重复启动
        app.run(host=config.SERVER_HOST, port=config.SERVER_PORT, debug=config.DEBUG, use_reloader=False)
    finally:
        shutdown()
