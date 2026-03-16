"""
webrtc_healing.conftest_template — pytest fixtures 模板

导出的测试文件通过 conftest.py 使用这些 fixtures，或者直接
    from webrtc_healing.conftest_template import *
在测试文件中引用。
"""
from __future__ import annotations

import allure
import pytest
from playwright.sync_api import sync_playwright

from webrtc_healing.config import CHROME_CDP_URL


@pytest.fixture(scope="session")
def browser():
    """session 级别的浏览器连接 (CDP)"""
    pw = sync_playwright().start()
    br = pw.chromium.connect_over_cdp(CHROME_CDP_URL)
    yield br
    br.close()
    pw.stop()


@pytest.fixture
def page(browser):
    """每个测试复用已有 page，或创建新的"""
    contexts = browser.contexts
    if contexts:
        pages = contexts[0].pages
        if pages:
            yield pages[0]
            return
    ctx = browser.new_context()
    p = ctx.new_page()
    yield p
    ctx.close()


@pytest.hookimpl(tryfirst=True, hookwrapper=True)
def pytest_runtest_makereport(item, call):
    """失败时自动附加截图到 allure 报告"""
    outcome = yield
    report = outcome.get_result()
    if report.when == "call" and report.failed:
        try:
            page = item.funcargs.get("page")
            if page:
                png = page.screenshot(type="png")
                allure.attach(png, name="失败截图", attachment_type=allure.attachment_type.PNG)
        except Exception:
            pass
