"""
webrtc_healing.services — 外部服务客户端（OCR / Airtest / AI Locate）
每个函数在服务不可用时优雅降级（返回 None）。
当 config.STANDALONE == True 时，所有调用直接跳过。
"""
from __future__ import annotations

import base64
from typing import Optional

import requests

from webrtc_healing.config import (
    AI_SERVICE_URL,
    OCR_SERVICE_URL,
    PLATFORM_URL,
    STANDALONE,
    logger,
)

_REQUEST_TIMEOUT = 15  # seconds


# ─── OCR 文字定位 ────────────────────────────────────────
def ocr_locate(page, text: str) -> Optional[dict]:
    """
    用 RapidOCR 在当前页面截图中定位含指定文字的元素，返回 {x, y, confidence}。
    page: Playwright Page 对象
    """
    if STANDALONE:
        logger.debug("STANDALONE 模式，跳过 OCR 定位")
        return None
    try:
        screenshot_bytes = page.screenshot(type="jpeg", quality=90)
        image_b64 = base64.b64encode(screenshot_bytes).decode("ascii")
        resp = requests.post(
            f"{OCR_SERVICE_URL}/ocr/locate",
            json={"image": image_b64, "text": text},
            timeout=_REQUEST_TIMEOUT,
        )
        if resp.status_code != 200:
            return None
        data = resp.json()
        if data.get("x") is not None and data.get("y") is not None:
            logger.debug("OCR 定位成功: (%s, %s) conf=%s", data["x"], data["y"], data.get("confidence"))
            return {"x": data["x"], "y": data["y"], "confidence": data.get("confidence", 0)}
    except Exception as exc:
        logger.debug("OCR 定位失败: %s", exc)
    return None


# ─── 图像模板匹配（Airtest） ──────────────────────────────
def airtest_match(
    template_b64: str,
    threshold: float = 0.7,
    match_index: int = 0,
) -> Optional[dict]:
    """
    调用平台的 Airtest API 进行图像模板匹配。
    返回 {x, y, confidence} 或 None。
    """
    if STANDALONE:
        logger.debug("STANDALONE 模式，跳过 Airtest 匹配")
        return None
    try:
        resp = requests.post(
            f"{PLATFORM_URL}/api/airtest-match",
            json={
                "template": template_b64,
                "threshold": threshold,
                "matchIndex": match_index,
            },
            timeout=_REQUEST_TIMEOUT,
        )
        if resp.status_code != 200:
            return None
        data = resp.json()
        if data.get("success") and data.get("x") is not None:
            logger.debug("Airtest 匹配成功: (%s, %s) conf=%s", data["x"], data["y"], data.get("confidence"))
            return {"x": data["x"], "y": data["y"], "confidence": data.get("confidence", 0)}
    except Exception as exc:
        logger.debug("Airtest 匹配失败: %s", exc)
    return None


# ─── AI 定位（Midscene） ─────────────────────────────────
def ai_locate(
    description: str,
    model: str = "doubao-seed-1-8-251228",
    action: str = "click",
) -> Optional[dict]:
    """
    调用 AI 服务的 /execute-step 端点，利用 Midscene 进行 AI 定位。
    如果 AI 服务完成了点击动作，返回 {"tapped": True}。
    """
    if STANDALONE:
        logger.debug("STANDALONE 模式，跳过 AI 定位")
        return None
    try:
        step_payload = {
            "action": action,
            "target": description,
            "description": description,
        }
        resp = requests.post(
            f"{AI_SERVICE_URL}/execute-step",
            json={"step": step_payload, "model": model},
            timeout=60,
        )
        if resp.status_code != 200:
            return None
        data = resp.json()
        if data.get("success"):
            logger.debug("AI 定位成功: %s", description)
            return {"tapped": True}
    except Exception as exc:
        logger.debug("AI 定位失败: %s", exc)
    return None
