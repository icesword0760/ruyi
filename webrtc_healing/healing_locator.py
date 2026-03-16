"""
webrtc_healing.healing_locator — 7 策略自愈定位引擎
完整移植 ai_service/server.js 中的 healingLocate 函数。

策略优先级（可通过 locator.priority 字段自定义）:
  1 XPath
  2 CSS Selector
  3 Text Content (DOM / OCR)
  4 Image Template (Airtest)
  5 Normalized Coords
  6 AI Locate (Midscene)
  99 Raw Coords (兜底)
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Optional

from webrtc_healing.config import STANDALONE, logger
from webrtc_healing import services


@dataclass
class HealResult:
    """自愈定位的返回结果"""
    locator: Any = None          # Playwright Locator（如有）
    coordinates: Optional[dict] = None  # {x, y}
    method: str = "none"
    healed: bool = False
    tapped: bool = False         # AI Locate 已完成点击
    heal_log: list = field(default_factory=list)
    frame: Any = None            # 目标 frame


class HealingLocator:
    """自愈定位器：按优先级逐一尝试所有已启用的定位策略"""

    def __init__(self, page):
        """page: Playwright Page 对象"""
        self.page = page

    async def locate(self, step: dict) -> HealResult:
        """
        对给定步骤执行自愈定位，返回 HealResult。
        同步版本请使用 locate_sync()。
        """
        return self._locate_sync(step)

    def locate_sync(self, step: dict) -> HealResult:
        """同步版本的自愈定位"""
        return self._locate_sync(step)

    def _locate_sync(self, step: dict) -> HealResult:
        heal_log: list[str] = []
        locators = step.get("locators") or {}
        iframes = (step.get("xpathInfo") or {}).get("iframes") or []

        frame = self._get_target_frame(iframes)
        tag_name = (step.get("xpathInfo") or {}).get("tagName", "")

        candidates = self._build_candidates(step, locators)
        candidates.sort(key=lambda c: c["priority"])

        for c in candidates:
            try:
                result = self._try_candidate(frame, c, tag_name)
                if result is not None:
                    healed = c["type"] != "xpath"
                    if healed:
                        heal_log.append(f"⚠️ XPath 失败，通过 {result.method} 自愈成功")
                        logger.info("自愈: %s", result.method)
                    return HealResult(
                        locator=result.locator,
                        coordinates=result.coordinates,
                        method=result.method,
                        healed=healed,
                        tapped=result.tapped,
                        heal_log=heal_log,
                        frame=frame,
                    )
                heal_log.append(f"❌ {c['type']} 失败")
            except Exception as exc:
                heal_log.append(f"❌ {c['type']} 异常: {exc}")

        return HealResult(heal_log=heal_log, frame=frame)

    # ── 候选列表构建 ─────────────────────────────────────
    def _build_candidates(self, step: dict, locators: dict) -> list[dict]:
        candidates = []

        if step.get("xpath"):
            xpath_loc = locators.get("xpath") or {}
            if xpath_loc.get("enabled") is not False:
                candidates.append({
                    "type": "xpath",
                    "priority": xpath_loc.get("priority", 1),
                    "value": step["xpath"],
                })

        css = locators.get("cssSelector") or {}
        if css.get("enabled") is not False and css.get("value"):
            candidates.append({
                "type": "cssSelector",
                "priority": css.get("priority", 2),
                "value": css["value"],
                "matchIndex": css.get("matchIndex", 0),
            })

        text = locators.get("textContent") or {}
        if text.get("enabled") is not False and text.get("value") and not text.get("pending"):
            candidates.append({
                "type": "textContent",
                "priority": text.get("priority", 3),
                "value": text["value"],
                "matchIndex": text.get("matchIndex", 0),
                "textLocator": text,
            })

        img = locators.get("imageTemplate") or {}
        if img.get("enabled") is not False and img.get("screenshot"):
            candidates.append({
                "type": "imageTemplate",
                "priority": img.get("priority", 4),
                "data": img,
            })

        norm = locators.get("normalizedCoords") or {}
        if norm.get("enabled") is not False and norm.get("xPercent"):
            candidates.append({
                "type": "normalizedCoords",
                "priority": norm.get("priority", 5),
                "data": norm,
            })

        ai = locators.get("aiLocate") or {}
        if ai.get("enabled") is not False and ai.get("value"):
            candidates.append({
                "type": "aiLocate",
                "priority": ai.get("priority", 6),
                "value": ai["value"],
                "modelId": ai.get("model"),
            })

        if not candidates:
            if step.get("xpath"):
                candidates.append({"type": "xpath", "priority": 1, "value": step["xpath"]})
            if step.get("coordinates"):
                candidates.append({"type": "rawCoords", "priority": 99, "data": step["coordinates"]})

        return candidates

    # ── iframe 链穿透 ────────────────────────────────────
    def _get_target_frame(self, iframes: list):
        frame = self.page.main_frame()
        for ifr in iframes:
            try:
                xpath = ifr.get("value", ifr) if isinstance(ifr, dict) else ifr
                iframe_el = frame.locator(f"xpath={xpath}").first
                content_frame = iframe_el.content_frame()
                if content_frame:
                    frame = content_frame
            except Exception:
                break
        return frame

    # ── 分发到各策略 ─────────────────────────────────────
    def _try_candidate(self, frame, c: dict, tag_name: str) -> Optional[HealResult]:
        t = c["type"]
        if t == "xpath":
            return self._try_xpath(frame, c["value"])
        if t == "cssSelector":
            return self._try_css(frame, c["value"], c.get("matchIndex", 0))
        if t == "textContent":
            return self._try_text(frame, c["value"], tag_name, c.get("matchIndex", 0), c.get("textLocator"))
        if t == "imageTemplate":
            return self._try_image(c["data"])
        if t == "normalizedCoords":
            return self._try_norm_coords(c["data"])
        if t == "aiLocate":
            return self._try_ai(c["value"], c.get("modelId", "doubao-seed-1-8-251228"))
        if t == "rawCoords":
            return HealResult(coordinates=c["data"], method="rawCoords")
        return None

    # ── 策略 1: XPath ────────────────────────────────────
    def _try_xpath(self, frame, xpath: str) -> Optional[HealResult]:
        if not xpath:
            return None
        loc = frame.locator(f"xpath={xpath}").first
        if loc.count() <= 0:
            return None
        if not loc.is_visible():
            return None
        return HealResult(locator=loc, method="xpath")

    # ── 策略 2: CSS Selector ─────────────────────────────
    def _try_css(self, frame, css: str, match_index: int = 0) -> Optional[HealResult]:
        if not css:
            return None
        try:
            all_loc = frame.locator(f"css={css}")
            total = all_loc.count()
            if total <= 0:
                return None
            target = all_loc.nth(match_index) if match_index < total else all_loc.first
            if not target.is_visible():
                return None
            return HealResult(locator=target, method=f"cssSelector[{match_index}/{total}]")
        except Exception:
            return None

    # ── 策略 3: Text Content (DOM + OCR) ─────────────────
    def _try_text(self, frame, text: str, tag_name: str, match_index: int, text_locator: dict | None) -> Optional[HealResult]:
        if not text or len(text) < 2:
            return None
        clean = text.rstrip("...").rstrip("…").strip()
        if not clean:
            return None

        source = (text_locator or {}).get("source", "dom")

        if source in ("ocr", "vlm"):
            coords = services.ocr_locate(self.page, clean)
            if coords:
                return HealResult(coordinates=coords, method="textContent(OCR)")
            return None

        # DOM 精确匹配
        try:
            exact = frame.get_by_text(clean, exact=True)
            count = exact.count()
            if count > 0:
                target = exact.nth(match_index) if match_index < count else exact.first
                if target.is_visible():
                    return HealResult(locator=target, method=f"textContent(exact)[{match_index}/{count}]")

            # DOM 模糊匹配
            fuzzy = frame.get_by_text(clean)
            count = fuzzy.count()
            if count > 0:
                target = fuzzy.nth(match_index) if match_index < count else fuzzy.first
                if target.is_visible():
                    return HealResult(locator=target, method=f"textContent(contains)[{match_index}/{count}]")

            # 输入框 placeholder
            if tag_name and tag_name.lower() in ("input", "textarea"):
                ph = frame.get_by_placeholder(clean)
                count = ph.count()
                if count > 0:
                    target = ph.nth(match_index) if match_index < count else ph.first
                    if target.is_visible():
                        return HealResult(locator=target, method=f"textContent(placeholder)[{match_index}/{count}]")
        except Exception:
            pass
        return None

    # ── 策略 4: Image Template (Airtest) ─────────────────
    def _try_image(self, data: dict) -> Optional[HealResult]:
        if STANDALONE:
            logger.debug("STANDALONE 跳过 imageTemplate")
            return None
        screenshot = data.get("screenshot")
        if not screenshot:
            return None
        idx = data.get("matchIndex", 0)
        result = services.airtest_match(screenshot, data.get("threshold", 0.7), idx)
        if result:
            return HealResult(coordinates=result, method=f"imageTemplate[{idx}]")
        return None

    # ── 策略 5: Normalized Coords ────────────────────────
    def _try_norm_coords(self, data: dict) -> Optional[HealResult]:
        x_pct = data.get("xPercent")
        y_pct = data.get("yPercent")
        if not x_pct or not y_pct:
            return None
        vp = self.page.viewport_size
        if not vp:
            return None
        x = round((x_pct / 100) * vp["width"])
        y = round((y_pct / 100) * vp["height"])
        return HealResult(coordinates={"x": x, "y": y}, method="normalizedCoords")

    # ── 策略 6: AI Locate (Midscene) ─────────────────────
    def _try_ai(self, description: str, model_id: str) -> Optional[HealResult]:
        if STANDALONE:
            logger.debug("STANDALONE 跳过 aiLocate")
            return None
        result = services.ai_locate(description, model_id)
        if result and result.get("tapped"):
            return HealResult(tapped=True, method="aiLocate(Midscene)")
        return None
