"""
RapidOCR 微服务
提供两个接口：
  POST /ocr         — 从图片中提取所有文字 + 精确 bbox
  POST /ocr/locate  — 在图片中定位指定文字，返回中心坐标
"""

import base64, io, sys, json
from flask import Flask, request, jsonify
import numpy as np

app = Flask(__name__)

engine = None

def get_engine():
    global engine
    if engine is None:
        from rapidocr_onnxruntime import RapidOCR
        engine = RapidOCR()
        print("[OCR] RapidOCR engine loaded", file=sys.stderr)
    return engine


def decode_image(b64_str):
    """base64 → numpy BGR array"""
    import cv2
    if b64_str.startswith("data:"):
        b64_str = b64_str.split(",", 1)[1]
    raw = base64.b64decode(b64_str)
    arr = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    return img


@app.route("/ocr", methods=["POST"])
def ocr_extract():
    """
    输入: { "image": "<base64>" }
    输出: { "results": [ { "text": "xxx", "bbox": [[x1,y1],[x2,y2],[x3,y3],[x4,y4]], "confidence": 0.95 } ] }
    bbox 是四个角的像素坐标（左上→右上→右下→左下）
    """
    body = request.get_json(force=True)
    img_b64 = body.get("image", "")
    if not img_b64:
        return jsonify({"error": "missing image"}), 400

    img = decode_image(img_b64)
    if img is None:
        return jsonify({"error": "invalid image"}), 400

    ocr = get_engine()
    result, _ = ocr(img)

    items = []
    if result:
        for line in result:
            bbox_raw, text, confidence = line
            bbox = [[int(round(p[0])), int(round(p[1]))] for p in bbox_raw]
            items.append({
                "text": text,
                "bbox": bbox,
                "confidence": round(float(confidence), 4),
            })

    return jsonify({"results": items})


@app.route("/ocr/locate", methods=["POST"])
def ocr_locate():
    """
    在截图中查找包含指定文字的区域，返回中心坐标。
    输入: { "image": "<base64>", "text": "百度一下" }
    输出: { "found": true, "x": 960, "y": 540, "bbox": [...], "matchedText": "百度一下", "confidence": 0.98 }
    匹配策略：
      1. 精确子串匹配
      2. 按 token 重叠度模糊匹配（≥60% 则认为命中）
    """
    body = request.get_json(force=True)
    img_b64 = body.get("image", "")
    target = body.get("text", "").strip()
    if not img_b64 or not target:
        return jsonify({"error": "missing image or text"}), 400

    img = decode_image(img_b64)
    if img is None:
        return jsonify({"error": "invalid image"}), 400

    ocr = get_engine()
    result, _ = ocr(img)

    if not result:
        return jsonify({"found": False, "reason": "no text detected"})

    items = []
    for line in result:
        bbox_raw, text, confidence = line
        bbox = [[int(round(p[0])), int(round(p[1]))] for p in bbox_raw]
        items.append({"text": text, "bbox": bbox, "confidence": float(confidence)})

    # 1) 精确子串匹配
    best = _find_best_match(items, target)

    if best:
        cx, cy = _bbox_center(best["bbox"])
        return jsonify({
            "found": True,
            "x": cx, "y": cy,
            "bbox": best["bbox"],
            "matchedText": best["text"],
            "confidence": round(best["confidence"], 4),
        })

    return jsonify({"found": False, "reason": f"text '{target}' not found", "allTexts": [i["text"] for i in items]})


def _find_best_match(items, target):
    """查找最佳匹配：精确子串 > 模糊重叠"""
    target_lower = target.lower().replace(" ", "")

    # 精确子串匹配
    exact_matches = []
    for item in items:
        item_text = item["text"].lower().replace(" ", "")
        if target_lower in item_text or item_text in target_lower:
            exact_matches.append(item)

    if exact_matches:
        exact_matches.sort(key=lambda i: i["confidence"], reverse=True)
        return exact_matches[0]

    # 模糊匹配：字符重叠度
    best_item = None
    best_overlap = 0.0
    for item in items:
        overlap = _char_overlap(target_lower, item["text"].lower().replace(" ", ""))
        if overlap > best_overlap:
            best_overlap = overlap
            best_item = item

    if best_item and best_overlap >= 0.6:
        return best_item

    return None


def _char_overlap(a, b):
    """两个字符串的字符级重叠度（Jaccard 系数）"""
    if not a or not b:
        return 0.0
    set_a = set(a)
    set_b = set(b)
    intersection = set_a & set_b
    union = set_a | set_b
    return len(intersection) / len(union) if union else 0.0


def _bbox_center(bbox):
    """四点 bbox → 中心坐标"""
    xs = [p[0] for p in bbox]
    ys = [p[1] for p in bbox]
    return int(round(sum(xs) / len(xs))), int(round(sum(ys) / len(ys)))


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "engine": "RapidOCR"})


if __name__ == "__main__":
    get_engine()
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9788
    print(f"[OCR] RapidOCR service starting on port {port}", file=sys.stderr)
    app.run(host="127.0.0.1", port=port, debug=False)
