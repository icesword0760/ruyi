"""
webrtc_healing.step_executor — 动作分发器
完整移植 ai_service/server.js 中 /execute-step 处理逻辑。

支持动作: navigate, click, input, hover, scroll, keypress, wait
"""
from __future__ import annotations

import time
from typing import Any

from webrtc_healing.config import (
    CLICK_TIMEOUT,
    HEAL_TIMEOUT,
    NAVIGATE_TIMEOUT,
    SELECT_ALL_KEY,
    STEP_WAIT,
    logger,
)
from webrtc_healing.healing_locator import HealResult, HealingLocator
from webrtc_healing import services


def execute_step(page, step: dict, model: str | None = None) -> dict:
    """
    在 Playwright page 上执行单个步骤。

    返回 dict:
        success: bool
        method: str           — 使用的定位方法
        healed: bool          — 是否经过自愈
        heal_log: list[str]   — 定位尝试日志
        error: str | None     — 错误信息（失败时）
    """
    action = step.get("action", "click")

    try:
        if action == "navigate":
            return _do_navigate(page, step)
        if action == "wait":
            return _do_wait(step)
        if action == "keypress":
            return _do_keypress(page, step)
        if action == "scroll":
            return _do_scroll(page, step)
        if action == "click":
            return _do_click(page, step, model)
        if action == "input":
            return _do_input(page, step, model)
        if action == "hover":
            return _do_hover(page, step, model)
        if action in ("plan", "locate", "done"):
            return {"success": True, "method": "skip", "healed": False, "heal_log": [], "skipped": True}
        return _do_fallback(page, step, action, model)
    except Exception as exc:
        return {"success": False, "method": "none", "healed": False, "heal_log": [], "error": str(exc)}


# ─── Navigate ────────────────────────────────────────────
def _do_navigate(page, step: dict) -> dict:
    url = step.get("value") or step.get("target") or ""
    try:
        import json as _json
        parsed = _json.loads(url)
        if isinstance(parsed, dict) and parsed.get("url"):
            url = parsed["url"]
    except Exception:
        pass
    if not url or not url.startswith("http"):
        return {"success": False, "method": "navigate", "healed": False, "heal_log": [], "error": f"无效的导航 URL: {url}"}
    page.goto(url, wait_until="domcontentloaded", timeout=NAVIGATE_TIMEOUT)
    time.sleep(1)
    return {"success": True, "method": "navigate", "healed": False, "heal_log": []}


# ─── Wait ────────────────────────────────────────────────
def _do_wait(step: dict) -> dict:
    ms = step.get("value", "2000")
    ms = int(ms) if str(ms).isdigit() else 2000
    time.sleep(ms / 1000)
    return {"success": True, "method": "wait", "healed": False, "heal_log": []}


# ─── Keypress ────────────────────────────────────────────
def _do_keypress(page, step: dict) -> dict:
    page.keyboard.press(step.get("value", "Enter"))
    time.sleep(0.5)
    return {"success": True, "method": "keypress", "healed": False, "heal_log": []}


# ─── Scroll ──────────────────────────────────────────────
def _do_scroll(page, step: dict) -> dict:
    direction = (step.get("target") or step.get("value") or "down").lower()
    page.evaluate("""(d) => {
        const px = 500;
        const m = {down: [0, px], up: [0, -px], right: [px, 0], left: [-px, 0]};
        const [dx, dy] = m[d] || m['down'];
        window.scrollBy(dx, dy);
    }""", direction)
    time.sleep(0.5)
    return {"success": True, "method": "scroll", "healed": False, "heal_log": []}


# ─── Click (自愈) ────────────────────────────────────────
def _do_click(page, step: dict, model: str | None) -> dict:
    hl = HealingLocator(page)
    result = hl.locate_sync(step)

    if result.tapped:
        logger.info("→ %s 点击%s", result.method, "（自愈）" if result.healed else "")
    elif result.locator:
        result.locator.scroll_into_view_if_needed(timeout=HEAL_TIMEOUT)
        result.locator.click(timeout=CLICK_TIMEOUT)
        logger.info("→ %s 点击%s", result.method, "（自愈）" if result.healed else "")
    elif result.coordinates:
        page.mouse.click(result.coordinates["x"], result.coordinates["y"])
        logger.info("→ %s 坐标点击 (%s, %s)%s", result.method, result.coordinates["x"], result.coordinates["y"], "（自愈）" if result.healed else "")
    else:
        ai = services.ai_locate(step.get("target") or step.get("description", ""), model or "doubao-seed-1-8-251228")
        if not ai:
            time.sleep(STEP_WAIT)
            return {"success": False, "method": "none", "healed": False, "heal_log": result.heal_log, "error": f"无法定位元素: {step.get('description', '')}"}
        logger.info("→ AI 回退点击: %s", step.get("target"))

    time.sleep(STEP_WAIT)
    return {"success": True, "method": result.method, "healed": result.healed, "heal_log": result.heal_log}


# ─── Input (自愈) ────────────────────────────────────────
def _do_input(page, step: dict, model: str | None) -> dict:
    hl = HealingLocator(page)
    result = hl.locate_sync(step)
    value = step.get("value", "")

    if result.tapped:
        page.keyboard.type(value)
        logger.info("→ %s 输入%s: \"%s\"", result.method, "（自愈）" if result.healed else "", value)
    elif result.locator:
        tag_name = (step.get("xpathInfo") or {}).get("tagName", "")
        loc = result.locator
        non_input_tags = {"div", "span", "section", "article", "form", "ul", "li", "table"}
        if tag_name.lower() in non_input_tags and result.method == "xpath" and step.get("xpath"):
            inner = result.frame.locator(f"xpath={step['xpath']}").locator('input, textarea, [contenteditable="true"]').first
            if inner.count() > 0:
                loc = inner
        _perform_input(page, loc, value)
        logger.info("→ %s 输入%s: \"%s\"", result.method, "（自愈）" if result.healed else "", value)
    elif result.coordinates:
        _perform_input_at_coords(page, result.coordinates["x"], result.coordinates["y"], value)
        logger.info("→ %s 坐标输入%s", result.method, "（自愈）" if result.healed else "")
    else:
        ai = services.ai_locate(step.get("target") or step.get("description", ""), model or "doubao-seed-1-8-251228", action="input")
        if not ai:
            time.sleep(STEP_WAIT)
            return {"success": False, "method": "none", "healed": False, "heal_log": result.heal_log, "error": f"无法定位输入元素: {step.get('description', '')}"}
        page.keyboard.type(value)
        logger.info("→ AI 回退输入: %s", step.get("target"))

    time.sleep(STEP_WAIT)
    return {"success": True, "method": result.method, "healed": result.healed, "heal_log": result.heal_log}


# ─── Hover (自愈) ────────────────────────────────────────
def _do_hover(page, step: dict, model: str | None) -> dict:
    hl = HealingLocator(page)
    result = hl.locate_sync(step)

    if result.tapped:
        logger.info("→ %s 悬停（Midscene）%s", result.method, "（自愈）" if result.healed else "")
    elif result.locator:
        result.locator.scroll_into_view_if_needed(timeout=HEAL_TIMEOUT)
        result.locator.hover(timeout=CLICK_TIMEOUT)
        logger.info("→ %s 悬停%s", result.method, "（自愈）" if result.healed else "")
    elif result.coordinates:
        page.mouse.move(result.coordinates["x"], result.coordinates["y"])
    else:
        ai = services.ai_locate(step.get("target") or step.get("description", ""), model or "doubao-seed-1-8-251228", action="hover")
        if not ai:
            time.sleep(0.5)
            return {"success": False, "method": "none", "healed": False, "heal_log": result.heal_log, "error": f"无法定位元素: {step.get('description', '')}"}

    time.sleep(0.5)
    return {"success": True, "method": result.method, "healed": result.healed, "heal_log": result.heal_log}


# ─── Fallback (未知动作) ─────────────────────────────────
def _do_fallback(page, step: dict, action: str, model: str | None) -> dict:
    ai = services.ai_locate(step.get("description") or f"{action} {step.get('target', '')}", model or "doubao-seed-1-8-251228", action=action)
    if ai:
        time.sleep(STEP_WAIT)
        return {"success": True, "method": "aiLocate", "healed": False, "heal_log": []}
    return {"success": False, "method": "none", "healed": False, "heal_log": [], "error": f"不支持的操作: {action}"}


# ─── 输入辅助 ────────────────────────────────────────────
def _perform_input(page, loc, value: str):
    """通过 Locator 执行输入"""
    loc.scroll_into_view_if_needed(timeout=HEAL_TIMEOUT)
    loc.click(timeout=HEAL_TIMEOUT)
    time.sleep(0.3)
    page.keyboard.press(SELECT_ALL_KEY)
    time.sleep(0.1)
    try:
        loc.fill(value or "", timeout=3000)
    except Exception:
        page.keyboard.press(SELECT_ALL_KEY)
        page.keyboard.type(value or "", delay=30)


def _perform_input_at_coords(page, x: int, y: int, value: str):
    """通过坐标执行输入"""
    page.mouse.click(x, y)
    time.sleep(0.3)
    page.keyboard.press(SELECT_ALL_KEY)
    page.keyboard.type(value or "", delay=30)
