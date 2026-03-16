/**
 * AI 助手服务 —— Midscene 黑盒执行引擎
 *
 * 核心能力：用户输入自然语言 → Midscene 自动规划+执行 → SSE 流式返回每步进度
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { chromium } = require('playwright-core');
const sharp = require('sharp');

const http = require('http');

const PORT = parseInt(process.env.AI_SERVICE_PORT || '3100', 10);
const CHROME_CDP_URL = process.env.CHROME_CDP_URL || 'http://127.0.0.1:9222';
const FLASK_HOST = process.env.FLASK_HOST || '127.0.0.1';
const FLASK_PORT = parseInt(process.env.FLASK_PORT || '5566', 10);

// 统一视口尺寸：录制和回放必须使用相同分辨率，与 cdp_client.py 的 viewport_width/height 一致
const VIEWPORT_WIDTH = 1920;
const VIEWPORT_HEIGHT = 1080;

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ─── 模型配置 ───────────────────────────────────────────
// 默认 API 凭证（讯飞网关，大部分模型共用）
const DEFAULT_BASE_URL = process.env.OPENAI_BASE_URL;
const DEFAULT_API_KEY = process.env.OPENAI_API_KEY;

// 独立端点凭证
const DOUBAO_BASE_URL = process.env.DOUBAO_BASE_URL;
const DOUBAO_API_KEY = process.env.DOUBAO_API_KEY;
const LMSTUDIO_BASE_URL = process.env.LMSTUDIO_BASE_URL;

// ─── MAI-UI（本地 VLM Agent）配置 ─────────────────────────────
// 说明：MAI-UI 使用 OpenAI-compatible Chat Completions 接口（LM Studio 等）
const MAIUI_BASE_URL = process.env.MAIUI_BASE_URL || LMSTUDIO_BASE_URL || 'http://localhost:1234/v1';
const MAIUI_API_KEY = process.env.MAIUI_API_KEY || 'lm-studio';
const MAIUI_MODEL_NAME = process.env.MAIUI_MODEL_NAME || 'mai-ui-8b@q8_0';
const MAIUI_HISTORY_N = parseInt(process.env.MAIUI_HISTORY_N || '3', 10);
const MAIUI_MAX_STEPS = parseInt(process.env.MAIUI_MAX_STEPS || '25', 10);
const MAIUI_TEMPERATURE = parseFloat(process.env.MAIUI_TEMPERATURE || '0.0');
const MAIUI_TOP_P = parseFloat(process.env.MAIUI_TOP_P || '1.0');
const MAIUI_MAX_TOKENS = parseInt(process.env.MAIUI_MAX_TOKENS || '2048', 10);
const MAIUI_SCALE_FACTOR = 999;

// VL 模型（可做元素定位 + 规划）
// baseUrl / apiKey 为空则使用默认凭证
const VL_MODELS = [
  { id: 'Qwen/Qwen3-VL-235B-A22B-Instruct', label: 'Qwen3-VL', family: 'qwen3-vl' },
  { id: 'Qwen/Qwen3-VL-235B-A22B-Thinking', label: 'Qwen3-VL-Think', family: 'qwen3-vl' },
  { id: 'google/gemini-3-pro-preview', label: 'Gemini 3 Pro', family: 'gemini' },
  { id: 'doubao-seed-1-8-251228', label: '豆包 Seed', family: 'doubao-vision', baseUrl: DOUBAO_BASE_URL, apiKey: DOUBAO_API_KEY },
  { id: 'ui-tars-1.5-7b', label: 'UI-TARS 1.5 (本地)', family: 'vlm-ui-tars-doubao-1.5', baseUrl: LMSTUDIO_BASE_URL, apiKey: 'lm-studio' },
];

// 所有模型（仅规划时可用，不需要 VL 能力）
const ALL_MODELS = [
  ...VL_MODELS,
  { id: 'openai/gpt-4o', label: 'GPT-4o', family: null },
  { id: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4', family: null },
  { id: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5', family: null },
];

/** 获取某个模型的 API 凭证（优先用模型自身的，否则用默认的） */
function getModelCredentials(model) {
  return {
    baseUrl: model?.baseUrl || DEFAULT_BASE_URL,
    apiKey: model?.apiKey || DEFAULT_API_KEY,
  };
}

/**
 * 构建 modelConfig，支持分离模式 + 每模型独立凭证
 * 注意：传入 modelConfig 后 Midscene 进入"隔离模式"，不再读取 process.env，
 *       因此必须在 config 中显式包含 base URL 和 API key。
 */
function buildModelConfig(modelId, planningModelId) {
  const vlModel = VL_MODELS.find(m => m.id === modelId) || VL_MODELS[0];
  const vlCreds = getModelCredentials(vlModel);

  const config = {
    MIDSCENE_MODEL_NAME: vlModel.id,
    MIDSCENE_MODEL_FAMILY: vlModel.family,
    OPENAI_BASE_URL: vlCreds.baseUrl,
    OPENAI_API_KEY: vlCreds.apiKey,
  };

  // 分离模式：规划模型与定位模型不同
  if (planningModelId && planningModelId !== vlModel.id) {
    const planModel = ALL_MODELS.find(m => m.id === planningModelId);
    if (planModel) {
      const planCreds = getModelCredentials(planModel);
      config.MIDSCENE_PLANNING_MODEL_NAME = planModel.id;
      config.MIDSCENE_PLANNING_MODEL_BASE_URL = planCreds.baseUrl;
      config.MIDSCENE_PLANNING_MODEL_API_KEY = planCreds.apiKey;
      if (planModel.family) {
        config.MIDSCENE_PLANNING_MODEL_FAMILY = planModel.family;
      }
    }
  }

  return config;
}

// ─── 全局状态 ───────────────────────────────────────────
let browser = null;
let PuppeteerAgent = null;

// OCR 任务存储（taskId → { status, text, modelId, error }）
// status: 'pending' | 'done' | 'error'
const ocrTaskStore = new Map();

// ─── RapidOCR 本地服务调用 ──────────────────────────────────────────────

const OCR_SERVICE_URL = process.env.OCR_SERVICE_URL || 'http://127.0.0.1:9788';

/**
 * 调用 RapidOCR 提取图片中所有文字（用于录制时的文字提取）
 * @param {string} imageBase64 - 不含 data:image/... 前缀
 * @returns {Promise<string>} 所有识别文字拼接（空格分隔），失败返回 ''
 */
async function callOCRForText(imageBase64) {
  try {
    const resp = await fetch(`${OCR_SERVICE_URL}/ocr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageBase64 }),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`OCR HTTP ${resp.status}`);
    const data = await resp.json();
    if (!data.results || data.results.length === 0) return '';
    return data.results.map(r => r.text).join(' ');
  } catch (e) {
    console.log(`    ⚠️  RapidOCR 提取失败: ${e.message}`);
    return '';
  }
}

/**
 * 调用 RapidOCR 在截图中定位指定文字，返回精确中心坐标
 * @param {string} imageBase64 - 不含前缀
 * @param {string} text - 要查找的文字
 * @returns {Promise<{x,y,confidence}|null>}
 */
async function callOCRForLocate(imageBase64, text) {
  try {
    const resp = await fetch(`${OCR_SERVICE_URL}/ocr/locate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageBase64, text }),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`OCR Locate HTTP ${resp.status}`);
    const data = await resp.json();
    if (data.found) {
      return { x: data.x, y: data.y, confidence: data.confidence };
    }
    return null;
  } catch (e) {
    console.log(`    ⚠️  RapidOCR 定位失败: ${e.message}`);
    return null;
  }
}

/**
 * 检测 OCR 服务是否可用
 */
async function isOCRServiceAvailable() {
  try {
    const resp = await fetch(`${OCR_SERVICE_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return resp.ok;
  } catch { return false; }
}

// ─── Chrome 连接 ────────────────────────────────────────
async function connectToChrome() {
  if (browser && browser.connected) return browser;
  console.log(`🔗 连接 Chrome: ${CHROME_CDP_URL}`);
  browser = await puppeteer.connect({ browserURL: CHROME_CDP_URL, defaultViewport: null });
  browser.on('disconnected', () => { browser = null; });
  console.log('✅ Chrome 连接成功');
  return browser;
}

/** 确保 Puppeteer 页面视口为统一尺寸 */
async function ensurePuppeteerViewport(page) {
  const vp = page.viewport();
  if (!vp || vp.width !== VIEWPORT_WIDTH || vp.height !== VIEWPORT_HEIGHT) {
    await page.setViewport({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT, deviceScaleFactor: 1 });
    console.log(`📐 Puppeteer 视口已设置: ${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT}`);
  }
}

async function getActivePage() {
  const b = await connectToChrome();
  const pages = await b.pages();
  const valid = pages.filter(p => {
    const u = p.url();
    return u && !u.startsWith('chrome://') && u !== 'about:blank';
  });
  const page = valid.length > 0 ? valid[valid.length - 1] : pages[0];
  await ensurePuppeteerViewport(page);
  return page;
}

async function takeScreenshot(page) {
  return await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 80 });
}

function loadMidscene() {
  if (!PuppeteerAgent) {
    PuppeteerAgent = require('@midscene/web/puppeteer').PuppeteerAgent;
    console.log('✅ Midscene 加载成功');
  }
  return PuppeteerAgent;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── 投屏标签页同步 ────────────────────────────────────────
// 当 AI 执行过程中打开了新标签页，通知 CDPClient 切换投屏目标

function switchScreencastTab(targetId) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({ targetId });
    const req = http.request({
      hostname: FLASK_HOST,
      port: FLASK_PORT,
      path: '/api/tabs/switch',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
      timeout: 3000,
    }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end(postData);
  });
}

function setupScreencastSync(browser, initialTargetId) {
  let currentTargetId = initialTargetId;
  const onTargetCreated = async (target) => {
    if (target.type() !== 'page') return;
    const newId = target._targetId;
    if (!newId || newId === currentTargetId) return;
    await sleep(600);
    const ok = await switchScreencastTab(newId);
    if (ok) {
      console.log(`📺 投屏已切换到新标签页: ${newId.slice(0, 8)}`);
      currentTargetId = newId;
    }
  };
  browser.on('targetcreated', onTargetCreated);
  return {
    cleanup: () => browser.off('targetcreated', onTargetCreated),
    syncToPage: async (page) => {
      const tid = page.target()._targetId;
      if (tid && tid !== currentTargetId) {
        const ok = await switchScreencastTab(tid);
        if (ok) {
          console.log(`📺 投屏已同步到当前页面: ${tid.slice(0, 8)}`);
          currentTargetId = tid;
        }
      }
    },
  };
}

// ─── XPath 捕获（Puppeteer 方法拦截方案）──────────────────
//
// 核心思路：在 Node.js 层拦截 Puppeteer 的 page.mouse.click / page.keyboard.type，
// 在 Midscene 实际执行动作【之前】同步调用 page.evaluate() 获取目标元素的 XPath。
//
// 对比浏览器事件监听方案的优势：
//   ✅ 零时序竞争：拦截在 Node.js 端，DOM 还未被修改，XPath 获取必然成功
//   ✅ 无脚本冲突：不需要与 Chrome 扩展竞争全局变量声明
//   ✅ 导航后自动有效：每次导航后 evaluateOnNewDocument 重注入工具脚本；
//      拦截逻辑在 Node.js 端，不受页面生命周期影响
//   ✅ input 步骤天然支持：keyboard.type 拦截时读 document.activeElement 即可

const EXTENSION_DIR = path.join(__dirname, '..', 'chrome_extension');
let _xpathScripts = null;

/** 读取 XPath 工具脚本（带防重复包装，兼容 Chrome 扩展已注入的场景） */
function getXPathScripts() {
  if (!_xpathScripts) {
    const files = ['dom_exporter_all_in_one.js', 'element_locator.js'];
    const raw = files.map(f => {
      const fpath = path.join(EXTENSION_DIR, f);
      return fs.existsSync(fpath) ? fs.readFileSync(fpath, 'utf-8') : '';
    }).join('\n');
    // 用 try-catch + 已注入检测包装，防止 Chrome 扩展已注入时重复声明报错
    _xpathScripts = `try { if (!window.__elementLocatorUtils) { ${raw} } } catch(e) {}`;
    console.log(`✅ XPath 脚本已加载 (${(raw.length / 1024).toFixed(0)}KB)`);
  }
  return _xpathScripts;
}

/**
 * 确保 XPath 工具脚本在页面（及后续导航）中可用
 * 使用 evaluateOnNewDocument 保证导航后自动重注入
 */
async function ensureXPathUtils(page) {
  const script = getXPathScripts();
  // evaluateOnNewDocument：每次导航后自动执行
  await page.evaluateOnNewDocument(script);
  // 立即注入当前页面（首次调用时）
  try {
    const hasUtils = await page.evaluate(() => !!window.__elementLocatorUtils);
    if (!hasUtils) {
      await page.evaluate(script);
      console.log('  📦 XPath 工具脚本已注入当前页面');
    } else {
      console.log('  📦 XPath 工具脚本已就绪（扩展或之前已注入）');
    }
  } catch (e) {
    console.warn('  ⚠️ XPath 工具注入失败（将在下次导航后自动注入）:', e.message);
  }
}

/**
 * 在 Puppeteer page 上安装方法拦截钩子，捕获 Midscene 执行的每次鼠标点击和键盘输入。
 *
 * 返回 uninstall 函数，执行后恢复原始方法。
 * 每次调用都把捕获到的 XPath 记录追加到传入的 xpathLog 数组。
 */
function installPuppeteerHooks(page, xpathLog, options = {}) {
  const opts = {
    // 是否在 mouse.click 拦截时额外裁剪元素小图（用于生成 imageTemplate）
    // 默认关闭，避免影响 Midscene 既有“VLM bbox 裁剪”策略。
    captureClickElementScreenshot: false,
    ...options,
  };
  const mouse = page.mouse;
  const keyboard = page.keyboard;

  const origMouseClick = mouse.click.bind(mouse);
  const origKeyboardType = keyboard.type.bind(keyboard);

  /**
   * 从浏览器 info 对象构建统一的多定位器记录
   */
  function buildLocatorRecord(info, source, extra = {}) {
    const rec = {
      x: info.x, y: info.y,
      xpath: info.value,
      cssSelector: info.cssSelector || '',
      text: info.text || '',
      tagName: info.tagName || '',
      index: info.index || 0,
      iframes: info.iframes || [],
      boundingBox: info.boundingBox || null,
      viewportSize: info.viewportSize || null,
      timestamp: Date.now(),
      source,
      ...extra,
    };
    return rec;
  }

  // ── 拦截 mouse.click(x, y) ──────────────────────────────
  mouse.click = async (x, y, options) => {
    try {
      // 在点击前截取全页截图（用于后续图像模板裁剪，比 Midscene 的 uiContext 更可靠）
      let fullPageScreenshot = null;
      try {
        fullPageScreenshot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 90 });
      } catch (_) {}

      const info = await page.evaluate((px, py) => {
        if (!window.__elementLocatorUtils) return { _noUtils: true };
        const result = window.__elementLocatorUtils.getElementInfoByCoordinates(px, py);
        if (result && !result.viewportSize) {
          result.viewportSize = {
            width: window.innerWidth || document.documentElement.clientWidth,
            height: window.innerHeight || document.documentElement.clientHeight,
          };
        }
        if (result && !result.cssSelector) {
          try {
            const el = document.elementFromPoint(px, py);
            if (el && window.__elementLocatorUtils.getRelativeSelector) {
              result.cssSelector = window.__elementLocatorUtils.getRelativeSelector(el);
            }
          } catch(_) {}
        }
        return result;
      }, x, y);

      if (info?._noUtils) {
        console.log(`  ⚠️ click(${x},${y}): __elementLocatorUtils 未注入，尝试重新注入`);
        try {
          await page.evaluate(getXPathScripts());
          const retryInfo = await page.evaluate((px, py) => {
            if (!window.__elementLocatorUtils) return null;
            const r = window.__elementLocatorUtils.getElementInfoByCoordinates(px, py);
            if (r && !r.viewportSize) {
              r.viewportSize = { width: window.innerWidth || document.documentElement.clientWidth, height: window.innerHeight || document.documentElement.clientHeight };
            }
            return r;
          }, x, y);
          if (retryInfo?.success) {
            const rec = buildLocatorRecord(retryInfo, 'mouse.click');
            if (fullPageScreenshot) rec._fullPageScreenshot = fullPageScreenshot;
            xpathLog.push(rec);
            console.log(`  🎯 [重注入后] click(${x},${y}) → ${retryInfo.tagName}:${retryInfo.value.slice(0, 60)}`);
          } else {
            console.log(`  ⚠️ click(${x},${y}): 重注入后仍无法定位元素`);
          }
        } catch(re) { console.log(`  ⚠️ click(${x},${y}): 重注入失败: ${re.message}`); }
      } else if (info?.success) {
        const rec = buildLocatorRecord(info, 'mouse.click');
        if (fullPageScreenshot) rec._fullPageScreenshot = fullPageScreenshot;

        // 可选：裁剪元素小图，作为 imageTemplate（仅在需要时开启，避免影响 Midscene 默认策略）
        if (opts.captureClickElementScreenshot) {
          const bb = info.boundingBox;
          if (bb && bb.width > 4 && bb.height > 4) {
            try {
              const pad = 8;
              const bx = Math.round(bb.x + bb.width / 2);
              const by = Math.round(bb.y + bb.height / 2);
              const maxW = 320;
              const maxH = 220;
              const elemW = Math.min(bb.width + pad * 2, maxW);
              const elemH = Math.min(bb.height + pad * 2, maxH);
              const clip = {
                x: Math.max(0, Math.round(bx - elemW / 2)),
                y: Math.max(0, Math.round(by - elemH / 2)),
                width: Math.round(elemW),
                height: Math.round(elemH),
              };
              if (clip.width > 4 && clip.height > 4) {
                const elemShot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 90, clip });
                rec._elementScreenshot = elemShot;
                rec._elementClipRect = clip;
                console.log(`    📷 mouse.click 截图成功: ${clip.width}x${clip.height} @ (${clip.x},${clip.y})`);
              }
            } catch (ssErr) {
              console.log(`    ⚠️ mouse.click 截图失败: ${ssErr.message} (bb=${JSON.stringify(bb)})`);
            }
          }
        }

        xpathLog.push(rec);
        console.log(`  🎯 拦截 click(${x},${y}) → ${info.tagName}:${info.value.slice(0, 60)}`);
      } else {
        console.log(`  ⚠️ click(${x},${y}): 元素定位失败, info=${JSON.stringify(info)?.slice(0,200)}`);
      }
    } catch (e) { console.log(`  ⚠️ click 拦截异常: ${e.message}`); }
    return origMouseClick(x, y, options);
  };

  // ── 拦截 keyboard.type(text) ──────────────────────────────
  keyboard.type = async (text, options) => {
    try {
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const vw = window.innerWidth || document.documentElement.clientWidth;
        const vh = window.innerHeight || document.documentElement.clientHeight;
        const rect = el.getBoundingClientRect();
        const cx = Math.round(rect.left + rect.width / 2);
        const cy = Math.round(rect.top + rect.height / 2);
        const activeElBB = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        if (window.__elementLocatorUtils) {
          const res = window.__elementLocatorUtils.getElementInfoByCoordinates(cx, cy);
          if (res?.success) {
            if (!res.viewportSize) res.viewportSize = { width: vw, height: vh };
            return { ...res, x: cx, y: cy, _activeElBB: activeElBB };
          }
        }
        if (window.getElementXPath) {
          const xpath = window.getElementXPath(el);
          if (xpath) {
            return {
              success: true, value: xpath, cssSelector: '', tagName: el.tagName.toLowerCase(),
              text: (el.value || el.placeholder || el.textContent || '').slice(0, 100),
              index: 0, iframes: [],
              x: cx, y: cy,
              boundingBox: activeElBB,
              _activeElBB: activeElBB,
              viewportSize: { width: vw, height: vh },
            };
          }
        }
        return null;
      });

      if (info?.success) {
        const rec = buildLocatorRecord(info, 'keyboard.type', { typedText: text });
        // 在 keyboard.type 拦截时截图，确保输入步骤拥有图像模板
        const bb = (info._activeElBB && info._activeElBB.width > 0) ? info._activeElBB : info.boundingBox;
        if (bb && bb.width > 4 && bb.height > 4) {
          try {
            const pad = 8;
            const bx = Math.round(bb.x + bb.width / 2);
            const by = Math.round(bb.y + bb.height / 2);
            const maxW = 300;
            const elemW = Math.min(bb.width + pad * 2, maxW);
            const elemH = Math.min(bb.height + pad * 2, 200);
            const clip = {
              x: Math.max(0, Math.round(bx - elemW / 2)),
              y: Math.max(0, Math.round(by - elemH / 2)),
              width: Math.round(elemW),
              height: Math.round(elemH),
            };
            if (clip.width > 4 && clip.height > 4) {
              const elemShot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 90, clip });
              rec._elementScreenshot = elemShot;
              rec._elementClipRect = clip;
              console.log(`    📷 keyboard.type 截图成功: ${clip.width}x${clip.height} @ (${clip.x},${clip.y})`);
            }
          } catch (ssErr) {
            console.log(`    ⚠️ keyboard.type 截图失败: ${ssErr.message} (bb=${JSON.stringify(bb)})`);
          }
        } else {
          console.log(`    ⚠️ keyboard.type 无有效 boundingBox: bb=${JSON.stringify(bb)}`);
        }
        xpathLog.push(rec);
        console.log(`  🎯 拦截 keyboard.type("${text}") → activeElement: ${info.tagName}:${info.value.slice(0, 60)}`);
      }
    } catch (e) { /* 忽略 */ }
    return origKeyboardType(text, options);
  };

  // 返回 uninstall 函数，恢复原方法
  return function uninstall() {
    mouse.click = origMouseClick;
    keyboard.type = origKeyboardType;
  };
}

/**
 * Capture-only hook: intercept Puppeteer mouse.click to collect locator info
 * without performing the actual click (used by "regenerate step").
 */
function installPuppeteerCaptureOnly(page, xpathLog, options = {}) {
  const opts = {
    captureClickElementScreenshot: true,
    ...options,
  };
  const mouse = page.mouse;
  const origMouseClick = mouse.click.bind(mouse);

  function buildLocatorRecord(info, source, extra = {}) {
    return {
      x: info.x, y: info.y,
      xpath: info.value,
      cssSelector: info.cssSelector || '',
      text: info.text || '',
      tagName: info.tagName || '',
      index: info.index || 0,
      iframes: info.iframes || [],
      boundingBox: info.boundingBox || null,
      viewportSize: info.viewportSize || null,
      timestamp: Date.now(),
      source,
      ...extra,
    };
  }

  mouse.click = async (x, y, clickOpts) => {
    try {
      const info = await page.evaluate((px, py) => {
        if (!window.__elementLocatorUtils) return { _noUtils: true };
        const result = window.__elementLocatorUtils.getElementInfoByCoordinates(px, py);
        if (result && !result.viewportSize) {
          result.viewportSize = {
            width: window.innerWidth || document.documentElement.clientWidth,
            height: window.innerHeight || document.documentElement.clientHeight,
          };
        }
        if (result && !result.cssSelector) {
          try {
            const el = document.elementFromPoint(px, py);
            if (el && window.__elementLocatorUtils.getRelativeSelector) {
              result.cssSelector = window.__elementLocatorUtils.getRelativeSelector(el);
            }
          } catch(_) {}
        }
        return result;
      }, x, y);

      if (info?._noUtils) {
        try {
          await page.evaluate(getXPathScripts());
        } catch (_) {}
      } else if (info?.success) {
        const rec = buildLocatorRecord(info, 'mouse.click');

        if (opts.captureClickElementScreenshot) {
          const bb = info.boundingBox;
          if (bb && bb.width > 4 && bb.height > 4) {
            try {
              const pad = 8;
              const bx = Math.round(bb.x + bb.width / 2);
              const by = Math.round(bb.y + bb.height / 2);
              const maxW = 320;
              const maxH = 220;
              const elemW = Math.min(bb.width + pad * 2, maxW);
              const elemH = Math.min(bb.height + pad * 2, maxH);
              const clip = {
                x: Math.max(0, Math.round(bx - elemW / 2)),
                y: Math.max(0, Math.round(by - elemH / 2)),
                width: Math.round(elemW),
                height: Math.round(elemH),
              };
              if (clip.width > 4 && clip.height > 4) {
                const elemShot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 90, clip });
                rec._elementScreenshot = elemShot;
                rec._elementClipRect = clip;
              }
            } catch (_) {}
          }
        }

        xpathLog.push(rec);
      }
    } catch (_) {}

    // Do NOT click; behave like a no-op.
    return;
  };

  return function uninstall() {
    mouse.click = origMouseClick;
  };
}

/**
 * 将 Puppeteer 拦截日志匹配到对应的执行步骤
 *
 * 新方案（Puppeteer 方法拦截）下，xpathLog 中的每条记录对应一次真实的
 * mouse.click 或 keyboard.type 调用，可直接按顺序分配给 action 步骤。
 *
 * 匹配策略（按优先级）：
 *  1. 顺序分配：click/hover 对应 mouse.click 记录；input 对应 keyboard.type 记录
 *  2. 坐标辅助校验：如果步骤有坐标，用坐标距离验证分配是否合理
 *  3. 继承兜底：input 步骤若无 keyboard.type 记录，继承最近 click 步骤的 XPath
 */
function matchXPathsToSteps(capturedSteps, xpathLog) {
  if (!xpathLog.length) return 0;

  let matchCount = 0;
  const COORD_TOLERANCE = 50; // 宽松一些，因为 Midscene 点击坐标可能与定位坐标有偏差

  function attachXPath(step, rec, reason) {
    step.xpath = rec.xpath;
    step.xpathInfo = {
      xpath: rec.xpath,
      text: rec.text || '',
      tagName: rec.tagName || '',
      index: rec.index || 0,
      iframes: rec.iframes || [],
    };
    // 构建多定位器集合（元素自愈用）
    const locators = step.locators || {};
    locators.xpath = { value: rec.xpath, enabled: true, priority: 1 };
    if (rec.cssSelector) {
      locators.cssSelector = {
        value: rec.cssSelector, enabled: true, priority: 2,
        matchIndex: rec.cssMatchIndex ?? 0,
        matchTotal: rec.cssMatchTotal ?? 1,
      };
    }
    if (rec.text) {
      // DOM 属性来源的文字（textContent / value / placeholder）
      locators.textContent = {
        value: rec.text, enabled: true, priority: 3,
        matchIndex: rec.textMatchIndex ?? 0,
        matchTotal: rec.textMatchTotal ?? 1,
        source: 'dom',
      };
    } else if (!locators.textContent) {
      // 无 DOM 文字：暂不标记，等图像模板裁剪完成后再统一标记需要 VLM OCR 的步骤
    }
    if (rec.boundingBox && rec.viewportSize) {
      const bb = rec.boundingBox;
      const vp = rec.viewportSize;
      locators.normalizedCoords = {
        xPercent: +(((rec.x || (bb.x + bb.width / 2)) / vp.width) * 100).toFixed(4),
        yPercent: +(((rec.y || (bb.y + bb.height / 2)) / vp.height) * 100).toFixed(4),
        viewportWidth: vp.width,
        viewportHeight: vp.height,
        enabled: true,
        priority: 5,
      };
    }
    // 图像模板：优先使用 keyboard.type 拦截时就地截图（最准确）
    if (rec._elementScreenshot && !locators.imageTemplate) {
      locators.imageTemplate = {
        screenshot: rec._elementScreenshot,
        threshold: 0.8, enabled: true, priority: 4,
      };
      console.log(`    🖼️ [input] 图像模板 ← keyboard.type 拦截截图（${rec._elementClipRect?.width}x${rec._elementClipRect?.height}）`);
    }
    if (rec._fullPageScreenshot) {
      step._hookFullPageScreenshot = rec._fullPageScreenshot;
    }
    // AI 定位：使用 step.description 作为 Midscene aiTap 的自然语言描述
    const aiDesc = step.description || step.target || '';
    if (aiDesc) {
      locators.aiLocate = {
        value: aiDesc,
        enabled: true,
        priority: 6,
      };
    }
    step.locators = locators;

    // 输入步骤：回填 value 和 target（keyboard.type 直接输入时，解析出的 target 为空）
    if (step.action === 'input' && !step.value && rec.typedText) {
      step.value = rec.typedText;
      console.log(`    🖊️ [input] value 回填: "${rec.typedText}"`);
    }
    if (step.action === 'input' && !step.target) {
      // 用捕获到的元素 text/placeholder 或 tagName 作为 target 展示
      const elemHint = rec.text || (rec.tagName ? `<${rec.tagName}>` : '');
      if (elemHint) {
        step.target = elemHint;
      }
    }
    rec._used = true;
    matchCount++;
    console.log(`    📍 [${step.action}] "${step.target || step.value}" ← ${reason}: ${rec.xpath.slice(0, 70)}`);
  }

  // click/hover 记录（来自 mouse.click 拦截）
  const clickRecs = xpathLog.filter(r => r.source === 'mouse.click' && !r._used);
  // input 记录（来自 keyboard.type 拦截）
  const typeRecs  = xpathLog.filter(r => r.source === 'keyboard.type' && !r._used);

  let typeIdx = 0;

  for (const step of capturedSteps) {
    if (step.xpath) continue;
    if (!['click', 'input', 'hover'].includes(step.action)) continue;

    if (step.action === 'click' || step.action === 'hover') {
      // 匹配策略：
      //  1. 如果步骤有坐标 → 在 clickRecs 中找坐标最近的未使用记录
      //  2. 没有坐标 → 顺序取第一个未使用记录
      const available = clickRecs.filter(r => !r._used);
      if (available.length === 0) continue;

      let bestRec = null;
      if (step.coordinates) {
        // 按坐标距离找最佳匹配
        let bestDist = Infinity;
        for (const r of available) {
          const d = Math.hypot(r.x - step.coordinates.x, r.y - step.coordinates.y);
          if (d < bestDist) { bestDist = d; bestRec = r; }
        }
        if (bestDist > COORD_TOLERANCE) {
          // 坐标偏差超出阈值但仍是最近的，降级记录但继续使用
          console.log(`    ⚠️ [${step.action}] 最近记录坐标偏差 ${bestDist.toFixed(0)}px（>${COORD_TOLERANCE}px），仍使用`);
        }
      } else {
        bestRec = available[0];
      }

      if (bestRec) attachXPath(step, bestRec, `mouse.click(${bestRec.x},${bestRec.y})`);

    } else if (step.action === 'input') {
      // 优先用 keyboard.type 记录（直接捕获 activeElement，最精准）
      while (typeIdx < typeRecs.length && typeRecs[typeIdx]._used) typeIdx++;
      if (typeIdx < typeRecs.length) {
        const rec = typeRecs[typeIdx++];
        attachXPath(step, rec, `keyboard.type("${(rec.typedText||'').slice(0,20)}")`);
      } else {
        // 兜底：input 无 type 记录，继承前序最近 click 步骤的 XPath
        // （Midscene 流程：locate → click → input，三步同一元素）
        const stepIdx = capturedSteps.indexOf(step);
        for (let j = stepIdx - 1; j >= Math.max(0, stepIdx - 5); j--) {
          const prev = capturedSteps[j];
          if (prev.xpath && ['click', 'locate'].includes(prev.action)) {
            step.xpath = prev.xpath;
            step.xpathInfo = { ...prev.xpathInfo };
            matchCount++;
            console.log(`    📍 [input] "${step.target}" ← 继承步骤[${j}] XPath: ${prev.xpath.slice(0, 60)}`);
            break;
          }
        }
      }
    }
  }

  return matchCount;
}

/**
 * 后置匹配：为缺少 VLM 数据的 action 步骤，从 locateImageLog 回溯最近的 Locate 记录。
 *
 * 匹配规则：
 *   1. action 步骤必须有坐标 (step.coordinates)
 *   2. 在 locateImageLog 中找 timestamp <= step.timestamp 的最近一条
 *   3. 该 Locate 的坐标与 action 坐标在合理范围内（≤100px）
 *   4. 该 Locate 条目未被更高优先级的步骤占用
 *
 * 调用时机：AI 任务执行结束后、cropImageTemplates 之前。
 * 截图和 bbox 都是在 Locate 发生时实时保存的，不受后续页面变化影响。
 */
function matchLocateImagesToSteps(capturedSteps, locateImageLog) {
  if (!locateImageLog || locateImageLog.length === 0) return 0;
  const actionTypes = new Set(['click', 'input', 'hover']);
  let matched = 0;

  for (let i = 0; i < capturedSteps.length; i++) {
    const s = capturedSteps[i];
    if (!actionTypes.has(s.action)) continue;
    if (s._locateImageData) continue;

    let bestEntry = null;
    let bestTimeDiff = Infinity;
    const stepTs = s.timestamp || 0;
    const stepCoords = s.coordinates;

    for (let j = locateImageLog.length - 1; j >= 0; j--) {
      const entry = locateImageLog[j];
      if (entry.timestamp > stepTs) continue;

      const timeDiff = stepTs - entry.timestamp;
      if (timeDiff >= bestTimeDiff) continue;

      if (stepCoords && entry.coords) {
        const dx = Math.abs(stepCoords.x - entry.coords.x);
        const dy = Math.abs(stepCoords.y - entry.coords.y);
        if (dx > 100 || dy > 100) continue;
      }

      bestTimeDiff = timeDiff;
      bestEntry = entry;
    }

    if (bestEntry) {
      s._locateImageData = {
        screenshotBase64: bestEntry.screenshotBase64,
        elementRect: bestEntry.elementRect,
      };
      matched++;
      console.log(`    📸 步骤[${i}] (${s.action}) 后置匹配 Locate VLM 数据 (timeDiff=${bestTimeDiff}ms, source=${bestEntry.bboxSource}) ✅`);
    }
  }
  return matched;
}

/**
 * 裁剪图像模板 — 唯一策略：VLM bbox + Locate 截图（同一坐标空间）
 * 独立于 DOM 元素定位，不受 elementFromPoint 正确性影响。
 * 没有 VLM 数据的步骤不生成图像模板（严禁错误兜底）。
 */
async function cropImageTemplates(capturedSteps) {
  const MIN_SCREENSHOT_BYTES = 5000;
  let generated = 0;
  try {
    for (let idx = 0; idx < capturedSteps.length; idx++) {
      const s = capturedSteps[idx];
      if (!['click', 'input', 'hover'].includes(s.action)) { delete s._locateImageData; delete s._hookFullPageScreenshot; continue; }
      if (!s.locators) s.locators = {};
      if (s.locators.imageTemplate) {
        console.log(`    🖼️ 步骤[${idx}] 已有图像模板（来源: hook截图），跳过 VLM 裁剪`);
        delete s._locateImageData; delete s._hookFullPageScreenshot; continue;
      }

      const vlmRect = s._locateImageData?.elementRect;
      const locateScreenshot = s._locateImageData?.screenshotBase64;

      if (!vlmRect || !locateScreenshot) {
        if (!s._locateImageData) {
          console.log(`    ⚠️ 步骤[${idx}] 无 VLM Locate 数据，不生成图像模板`);
        } else {
          console.log(`    ⚠️ 步骤[${idx}] VLM 数据不完整 (rect=${!!vlmRect}, ss=${!!locateScreenshot})，不生成图像模板`);
        }
        delete s._locateImageData; delete s._hookFullPageScreenshot;
        continue;
      }
      if (vlmRect.width <= 4 || vlmRect.height <= 4) {
        console.log(`    ⚠️ 步骤[${idx}] VLM bbox 太小 (${vlmRect.width}x${vlmRect.height})，不生成图像模板`);
        delete s._locateImageData; delete s._hookFullPageScreenshot;
        continue;
      }

      const cleanB64 = locateScreenshot.replace(/^data:image\/\w+;base64,/, '');
      if (cleanB64.length < MIN_SCREENSHOT_BYTES) {
        console.log(`    ⚠️ 步骤[${idx}] Locate 截图太小 (${cleanB64.length} bytes)，不生成图像模板`);
        delete s._locateImageData; delete s._hookFullPageScreenshot;
        continue;
      }

      const pad = 8;
      const buf = Buffer.from(cleanB64, 'base64');
      const meta = await sharp(buf).metadata();
      const imgW = meta.width || 1920;
      const imgH = meta.height || 1080;

      if (vlmRect.left + vlmRect.width > imgW + 50 || vlmRect.top + vlmRect.height > imgH + 50) {
        console.log(`    ⚠️ 步骤[${idx}] VLM bbox (${vlmRect.left},${vlmRect.top},${vlmRect.width}x${vlmRect.height}) 超出截图 (${imgW}x${imgH})，不生成图像模板`);
        delete s._locateImageData; delete s._hookFullPageScreenshot;
        continue;
      }

      const extractRegion = {
        left: Math.max(0, Math.round(vlmRect.left - pad)),
        top: Math.max(0, Math.round(vlmRect.top - pad)),
        width: Math.round(vlmRect.width + pad * 2),
        height: Math.round(vlmRect.height + pad * 2),
      };
      extractRegion.width = Math.min(extractRegion.width, imgW - extractRegion.left);
      extractRegion.height = Math.min(extractRegion.height, imgH - extractRegion.top);
      if (extractRegion.width > 4 && extractRegion.height > 4 && extractRegion.width < 800 && extractRegion.height < 600) {
        try {
          const cropped = await sharp(buf).extract(extractRegion).jpeg({ quality: 90 }).toBuffer();
          s.locators.imageTemplate = { screenshot: cropped.toString('base64'), threshold: 0.8, enabled: true, priority: 4 };
          generated++;
          console.log(`    🖼️ 步骤[${idx}] 图像模板 ${extractRegion.width}x${extractRegion.height} (VLM bbox, img=${imgW}x${imgH}) ✅`);
        } catch (cropErr) { console.log(`    ⚠️ 步骤[${idx}] 图像裁剪失败: ${cropErr.message}`); }
      }
      delete s._locateImageData;
      delete s._hookFullPageScreenshot;
    }
  } catch (outerErr) { console.log(`  ❌ 图像裁剪异常: ${outerErr.message}`); }
  return generated;
}

// ─── Playwright 连接（用于脚本回放）─────────────────────
let pwBrowser = null;
async function getPlaywrightBrowser() {
  if (pwBrowser && pwBrowser.isConnected()) return pwBrowser;
  console.log(`🔗 Playwright 连接 Chrome: ${CHROME_CDP_URL}`);
  pwBrowser = await chromium.connectOverCDP(CHROME_CDP_URL);
  console.log('✅ Playwright 连接成功');
  return pwBrowser;
}

/** 确保 Playwright 页面视口为统一尺寸 */
async function ensurePlaywrightViewport(page) {
  const vp = page.viewportSize();
  if (!vp || vp.width !== VIEWPORT_WIDTH || vp.height !== VIEWPORT_HEIGHT) {
    await page.setViewportSize({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT });
    console.log(`📐 Playwright 视口已设置: ${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT}`);
  }
}

async function getPlaywrightPage() {
  const b = await getPlaywrightBrowser();
  const contexts = b.contexts();
  for (const ctx of contexts) {
    const pages = ctx.pages();
    for (let i = pages.length - 1; i >= 0; i--) {
      const u = pages[i].url();
      if (u && !u.startsWith('chrome://') && u !== 'about:blank') {
        await ensurePlaywrightViewport(pages[i]);
        return pages[i];
      }
    }
  }
  const defaultCtx = contexts[0] || await b.newContext();
  const page = defaultCtx.pages()[0] || await defaultCtx.newPage();
  await ensurePlaywrightViewport(page);
  return page;
}

async function takePlaywrightScreenshot(page) {
  const buf = await page.screenshot({ type: 'jpeg', quality: 80 });
  return buf.toString('base64');
}

// ─── SSE 辅助 ───────────────────────────────────────────
function sseWrite(res, type, data) {
  res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
}

// ─── MAI-UI 引擎（OpenAI-compatible + 截图驱动）────────────────

// 基于 MAI-UI 项目的输出格式与动作空间（做了少量“Web 场景”适配，不影响原协议）
const MAIUI_SYS_PROMPT_WEB = `
You are a GUI agent controlling a desktop web browser page via mouse and keyboard.
You are given a task and your action history, with screenshots. You need to perform the next action to complete the task.

## Output Format
For each function call, return the thinking process in <thinking> </thinking> tags, and a json object with function name and arguments within <tool_call></tool_call> XML tags:
\`\`\`
<thinking>
...
</thinking>
<tool_call>
{"name": "mobile_use", "arguments": <args-json-object>}
</tool_call>
\`\`\`

## Coordinate System
- All coordinates are in the range [0, ${MAIUI_SCALE_FACTOR}] relative to the screenshot width/height.
- For coordinate fields, you may output either [x, y] or a bounding box [x1, y1, x2, y2]; if a box is given it will be converted to its center.

## Action Space
{"action": "click", "coordinate": [x, y]}
{"action": "double_click", "coordinate": [x, y]}
{"action": "long_press", "coordinate": [x, y]}
{"action": "type", "text": ""}
{"action": "swipe", "direction": "up or down or left or right", "coordinate": [x, y]} # "coordinate" is optional.
{"action": "open", "text": "url_or_keyword"} # For web: treat as navigation/search when appropriate.
{"action": "drag", "start_coordinate": [x1, y1], "end_coordinate": [x2, y2]}
{"action": "system_button", "button": "back or home or menu or enter"}
{"action": "wait"}
{"action": "terminate", "status": "success or fail"}
{"action": "answer", "text": "xxx"} # Use escape characters \\\\', \\\\\", and \\\\n in text part to ensure we can parse.

## Note
- Write a small plan and finally summarize your next action (with its target element) in one sentence in <thinking></thinking>.
- You must follow the Action Space strictly, and return the correct json object within <thinking> </thinking> and <tool_call></tool_call> XML tags.
`.trim();

const MAIUI_SYS_PROMPT_GROUNDING_WEB = `
You are a GUI grounding agent controlling a desktop web browser page.

## Task
Given a screenshot and the user's grounding instruction, your task is to accurately locate the UI element based on the instruction, then provide the final coordinate.

## Output Format
Return a json object with a reasoning process in <grounding_think></grounding_think> tags, and a [x,y] format coordinate within <answer></answer> XML tags:
<grounding_think>...</grounding_think>
<answer>
{"coordinate": [x,y]}
</answer>

## Coordinate System
- Coordinates are in the range [0, ${MAIUI_SCALE_FACTOR}] relative to screenshot width/height.
- You may also output a bounding box [x1,y1,x2,y2]; it will be converted to its center.
`.trim();

function resolveAiEngine(engine, modelId) {
  const e = (engine || '').toString().trim().toLowerCase();
  if (e) {
    if (['mai-ui', 'maiui', 'mai_ui', 'mai', 'mai-ui-engine'].includes(e)) return 'mai-ui';
    if (['midscene', 'mid', 'midscene-engine'].includes(e)) return 'midscene';
  }
  const m = (modelId || '').toString().trim();
  if (m && m === MAIUI_MODEL_NAME) return 'mai-ui';
  return 'midscene';
}

function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function normalizeMaiUiCoord(coord) {
  if (!Array.isArray(coord)) return null;
  const nums = coord.map(n => Number(n)).filter(n => Number.isFinite(n));
  if (nums.length !== 2 && nums.length !== 4) return null;
  let x = 0, y = 0;
  if (nums.length === 2) {
    [x, y] = nums;
  } else {
    const [x1, y1, x2, y2] = nums;
    x = (x1 + x2) / 2;
    y = (y1 + y2) / 2;
  }
  // 支持两种范围：0..1（已归一化）或 0..999（MAI-UI 默认）
  if (x > 1 || y > 1) {
    x = x / MAIUI_SCALE_FACTOR;
    y = y / MAIUI_SCALE_FACTOR;
  }
  return [clamp01(x), clamp01(y)];
}

function denormalizeMaiUiCoord01To999(coord01) {
  const c = normalizeMaiUiCoord(coord01);
  if (!c) return null;
  const [x, y] = c;
  return [Math.round(x * MAIUI_SCALE_FACTOR), Math.round(y * MAIUI_SCALE_FACTOR)];
}

function normalizeMaiUiActionArgs(actionArgs) {
  const args = (actionArgs && typeof actionArgs === 'object') ? { ...actionArgs } : {};
  if (args.action) args.action = String(args.action).toLowerCase();
  if (args.direction) args.direction = String(args.direction).toLowerCase();
  if (args.button) args.button = String(args.button).toLowerCase();

  if (args.coordinate) {
    const c = normalizeMaiUiCoord(args.coordinate);
    if (c) args.coordinate = c;
  }
  if (args.start_coordinate) {
    const c = normalizeMaiUiCoord(args.start_coordinate);
    if (c) args.start_coordinate = c;
  }
  if (args.end_coordinate) {
    const c = normalizeMaiUiCoord(args.end_coordinate);
    if (c) args.end_coordinate = c;
  }
  return args;
}

function buildMaiUiHistoryAssistantResponse(thinking, actionArgs01) {
  const args = normalizeMaiUiActionArgs(actionArgs01);
  const out = { ...args };
  // 将坐标从 0..1 还原为 0..999（MAI-UI 原始格式）
  if (out.coordinate) out.coordinate = denormalizeMaiUiCoord01To999(out.coordinate);
  if (out.start_coordinate) out.start_coordinate = denormalizeMaiUiCoord01To999(out.start_coordinate);
  if (out.end_coordinate) out.end_coordinate = denormalizeMaiUiCoord01To999(out.end_coordinate);

  const toolCall = JSON.stringify({ name: 'mobile_use', arguments: out }, null, 0);
  return `<thinking>\n${(thinking || '').trim()}\n</thinking>\n<tool_call>\n${toolCall}\n</tool_call>`;
}

function buildMaiUiMessages(instruction, currentImageDataUrl, historySteps) {
  const messages = [
    { role: 'system', content: [{ type: 'text', text: MAIUI_SYS_PROMPT_WEB }] },
    { role: 'user', content: [{ type: 'text', text: instruction }] },
  ];

  const hist = Array.isArray(historySteps) ? historySteps : [];
  const includeHistoryImages = (process.env.MAIUI_INCLUDE_HISTORY_IMAGES || 'false').toLowerCase() === 'true';
  if (hist.length > 0) {
    const startImageIdx = Math.max(0, hist.length - (MAIUI_HISTORY_N - 1));
    for (let i = 0; i < hist.length; i++) {
      const step = hist[i];
      const shouldIncludeImage = includeHistoryImages && (i >= startImageIdx);
      if (shouldIncludeImage && step.imageDataUrl) {
        messages.push({
          role: 'user',
          content: [
            { type: 'text', text: `History screenshot ${i + 1}/${hist.length}` },
            { type: 'image_url', image_url: { url: step.imageDataUrl } },
          ],
        });
      }
      const assistantText = buildMaiUiHistoryAssistantResponse(step.thinking, step.actionArgs01);
      messages.push({ role: 'assistant', content: [{ type: 'text', text: assistantText }] });
    }
  }

  // current screenshot
  messages.push({
    role: 'user',
    content: [
      { type: 'text', text: 'Current screenshot' },
      { type: 'image_url', image_url: { url: currentImageDataUrl } },
    ],
  });
  return messages;
}

async function captureMaiUiScreenshotDataUrl(page, { maxWidth = 1024, maxHeight = 1024, quality = 60 } = {}) {
  // 部分 OpenAI-compatible 服务对超大截图的解码/预处理不稳定（会返回 400 failed to process image）。
  // 这里使用 CDP 的 clip.scale 做降采样，避免引入额外图像处理依赖。
  const vp = (typeof page.viewport === 'function') ? page.viewport() : null;
  const width = (vp && vp.width) ? vp.width : VIEWPORT_WIDTH;
  const height = (vp && vp.height) ? vp.height : VIEWPORT_HEIGHT;
  const scale = Math.max(0.1, Math.min(1, maxWidth / Math.max(1, width), maxHeight / Math.max(1, height)));

  let cdp = null;
  try {
    cdp = await page.target().createCDPSession();
    const result = await cdp.send('Page.captureScreenshot', {
      format: 'jpeg',
      quality,
      fromSurface: true,
      captureBeyondViewport: false,
      clip: { x: 0, y: 0, width, height, scale },
    });
    const b64 = result?.data || '';
    if (!b64) throw new Error('empty screenshot');
    return `data:image/jpeg;base64,${b64}`;
  } catch (_) {
    // fallback：退回 Puppeteer screenshot（不缩放）
    const b64 = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: Math.max(30, Math.min(95, quality)) });
    return `data:image/jpeg;base64,${b64}`;
  } finally {
    try { await cdp?.detach?.(); } catch (_) {}
  }
}

function extractThinkingSummary(thinking) {
  const t = (thinking || '').trim();
  if (!t) return '';
  const lines = t.split('\n').map(s => s.trim()).filter(Boolean);
  if (lines.length === 0) return '';
  // 取最后一行（MAI-UI prompt 要求“最后一句总结下一步动作”）
  return lines[lines.length - 1].replace(/^[-*•]\s*/, '').trim();
}

function tryParseJsonLoose(text) {
  if (!text) return null;
  const raw = String(text).trim();
  const cleaned = raw
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim()
    .replace(/^"+|"+$/g, '');
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    // 尝试截取第一个 { 到最后一个 }
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first >= 0 && last > first) {
      const slice = cleaned.slice(first, last + 1);
      try { return JSON.parse(slice); } catch (_) {}
    }
    return null;
  }
}

function parseMaiUiTaggedOutput(text) {
  let t = (text || '').toString().trim();
  if (!t) return { thinking: '', toolName: null, actionArgs: null, raw: '' };

  // 兼容部分 thinking 模型输出：使用 </think>
  if (t.includes('</think>') && !t.includes('</thinking>')) {
    t = '<thinking>' + t.replaceAll('</think>', '</thinking>');
  }

  const thinkingMatch = t.match(/<thinking>([\s\S]*?)<\/thinking>/i);
  const toolMatch = t.match(/<tool_call>([\s\S]*?)<\/tool_call>/i);
  const thinking = thinkingMatch ? (thinkingMatch[1] || '').trim().replace(/^"+|"+$/g, '') : '';
  const toolText = toolMatch ? (toolMatch[1] || '').trim().replace(/^"+|"+$/g, '') : '';

  let toolObj = tryParseJsonLoose(toolText);
  if (!toolObj) {
    // fallback: 直接解析整段文本中的 JSON
    toolObj = tryParseJsonLoose(t);
  }

  let toolName = null;
  let actionArgs = null;
  if (toolObj && typeof toolObj === 'object') {
    toolName = toolObj.name || toolObj.tool_name || null;
    actionArgs = toolObj.arguments || toolObj.args || null;
    if (typeof actionArgs === 'string') {
      const parsed = tryParseJsonLoose(actionArgs);
      if (parsed) actionArgs = parsed;
    }
  }

  // 兼容：工具调用被模型直接输出为 arguments JSON（无 name 包装）
  if (!actionArgs && toolObj && typeof toolObj === 'object' && toolObj.action) {
    actionArgs = toolObj;
  }

  return { thinking, toolName, actionArgs, raw: t };
}

function parseMaiUiGroundingOutput(text) {
  const t = (text || '').toString().trim();
  if (!t) return { thinking: '', coordinate01: null, raw: '' };

  const thinkMatch = t.match(/<grounding_think>([\s\S]*?)<\/grounding_think>/i);
  const answerMatch = t.match(/<answer>([\s\S]*?)<\/answer>/i);
  const thinking = thinkMatch ? (thinkMatch[1] || '').trim() : '';
  const answerText = answerMatch ? (answerMatch[1] || '').trim() : '';
  const answerObj = tryParseJsonLoose(answerText) || tryParseJsonLoose(t);

  const coord = answerObj?.coordinate;
  const coord01 = normalizeMaiUiCoord(coord);
  return { thinking, coordinate01: coord01, raw: t };
}

function absCoordFrom01(coord01) {
  const c = normalizeMaiUiCoord(coord01);
  if (!c) return null;
  const [x01, y01] = c;
  const x = Math.min(VIEWPORT_WIDTH - 1, Math.max(0, Math.round(x01 * VIEWPORT_WIDTH)));
  const y = Math.min(VIEWPORT_HEIGHT - 1, Math.max(0, Math.round(y01 * VIEWPORT_HEIGHT)));
  return { x, y };
}

function buildStepFromMaiUiAction(actionArgs01, thinking, stepIndex) {
  const args = normalizeMaiUiActionArgs(actionArgs01);
  const action = args.action || '';
  const summary = extractThinkingSummary(thinking);
  const id = `step_${Date.now()}_${stepIndex}`;

  // 终止 / 回答
  if (action === 'terminate') {
    return { type: 'terminate', status: (args.status || 'success').toString().toLowerCase(), summary };
  }
  if (action === 'answer') {
    return { type: 'answer', text: (args.text || '').toString(), summary };
  }
  if (action === 'ask_user') {
    return { type: 'ask_user', text: (args.text || '').toString(), summary };
  }

  const step = {
    id,
    action: 'action',
    target: summary || '',
    value: '',
    description: summary || `MAI-UI: ${action}`,
    status: 'executing',
    timestamp: Date.now(),
  };

  // 映射到既有 step.action 集合（回放/自愈依赖）
  if (action === 'click') {
    step.action = 'click';
    step.coordinates = absCoordFrom01(args.coordinate);
  } else if (action === 'double_click') {
    step.action = 'double_click';
    step.coordinates = absCoordFrom01(args.coordinate);
  } else if (action === 'long_press') {
    step.action = 'long_press';
    step.coordinates = absCoordFrom01(args.coordinate);
  } else if (action === 'type') {
    step.action = 'input';
    step.value = (args.text || '').toString();
    // target 由 keyboard.type 拦截回填（activeElement 的 text/placeholder）
  } else if (action === 'swipe') {
    step.action = 'scroll';
    step.target = (args.direction || 'down').toString().toLowerCase();
    step.description = summary || `滚动 ${step.target}`;
    // 可选：用于日志展示
    const c = absCoordFrom01(args.coordinate);
    if (c) step.coordinates = c;
  } else if (action === 'open') {
    step.action = 'navigate';
    step.value = (args.text || '').toString();
    step.description = summary || `导航: ${step.value}`;
  } else if (action === 'drag') {
    step.action = 'drag';
    const start = absCoordFrom01(args.start_coordinate);
    const end = absCoordFrom01(args.end_coordinate);
    step.drag = { start, end };
    step.description = summary || '拖拽';
  } else if (action === 'system_button') {
    step.action = 'system_button';
    step.value = (args.button || '').toString().toLowerCase();
    step.description = summary || `系统按键: ${step.value}`;
  } else if (action === 'wait') {
    step.action = 'wait';
    step.value = '2000';
    step.description = summary || '等待';
  } else {
    step.action = action || 'action';
  }

  return { type: 'step', step, args };
}

function normalizeUrlFromOpenText(text) {
  const raw = (text || '').toString().trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^[\w.-]+\.[a-z]{2,}/i.test(raw) && !raw.includes(' ')) return `https://${raw}`;
  // keyword → search（保持兼容：优先百度）
  return `https://www.baidu.com/s?wd=${encodeURIComponent(raw)}`;
}

async function callMaiUiLLM(messages, modelName, baseUrl) {
  const url = `${(baseUrl || MAIUI_BASE_URL).replace(/\/$/, '')}/chat/completions`;
  const body = {
    model: modelName || MAIUI_MODEL_NAME,
    messages,
    max_tokens: MAIUI_MAX_TOKENS,
    temperature: MAIUI_TEMPERATURE,
    top_p: MAIUI_TOP_P,
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MAIUI_API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`MAI-UI LLM HTTP ${resp.status}: ${txt.slice(0, 800)}`);
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || '';
  if (!content) throw new Error('MAI-UI LLM 返回空内容');
  return content.toString();
}

async function callMaiUiGroundingLLM(instruction, imageDataUrl, { baseUrl, modelName } = {}) {
  const url = `${(baseUrl || MAIUI_BASE_URL).replace(/\/$/, '')}/chat/completions`;
  const body = {
    model: modelName || MAIUI_MODEL_NAME,
    messages: [
      { role: 'system', content: [{ type: 'text', text: MAIUI_SYS_PROMPT_GROUNDING_WEB }] },
      {
        role: 'user',
        content: [
          { type: 'text', text: `${instruction}\n` },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
      },
    ],
    max_tokens: MAIUI_MAX_TOKENS,
    temperature: 0.0,
    top_p: 1.0,
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MAIUI_API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`MAI-UI Grounding HTTP ${resp.status}: ${txt.slice(0, 800)}`);
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || '';
  if (!content) throw new Error('MAI-UI Grounding 返回空内容');
  return content.toString();
}

async function tryAiLocateMaiUi(description, { baseUrl, modelName } = {}) {
  try {
    console.log(`    🤖 MAI-UI 定位: "${description}" (${modelName || MAIUI_MODEL_NAME})`);
    const puppPage = await getActivePage();
    const ssUrl = await captureMaiUiScreenshotDataUrl(puppPage, { maxWidth: 1024, maxHeight: 1024, quality: 60 });

    const prediction = await callMaiUiGroundingLLM(description, ssUrl, { baseUrl, modelName });
    const parsed = parseMaiUiGroundingOutput(prediction);
    if (!parsed.coordinate01) {
      throw new Error(`Grounding 输出无法解析坐标: ${prediction.slice(0, 200)}`);
    }
    const abs = absCoordFrom01(parsed.coordinate01);
    if (!abs) throw new Error('坐标解析失败');
    console.log(`    ✅ MAI-UI 坐标: (${abs.x}, ${abs.y})`);
    return { coordinates: abs, method: 'aiLocate(MAI-UI)', thinking: parsed.thinking || '' };
  } catch (e) {
    console.log(`    ⚠️  MAI-UI 定位失败: ${e.message}`);
    return null;
  }
}

async function runMaiUiAiRun(req, res, { task, modelName, baseUrl }) {
  const startTime = Date.now();
  const capturedSteps = [];
  const history = [];
  const xpathLog = [];
  let uninstallHooks = () => {};
  let screencastSync = null;

  let clientClosed = false;
  // 注意：在代理/转发（例如 Python requests → Node）场景下，`req.close` 可能在请求体读完后触发，
  // 但这不代表 SSE 响应端已断开。应以响应流关闭或请求被中止为准。
  const markClientClosed = () => { clientClosed = true; };
  res.on('close', markClientClosed);
  req.on('aborted', markClientClosed);

  const resolvedModelName = (modelName && modelName.trim()) ? modelName.trim() : MAIUI_MODEL_NAME;
  const modeDesc = `MAI-UI: ${resolvedModelName}`;
  console.log(`\n🚀 AI-RUN(MAI-UI): "${task}" [${modeDesc}] baseUrl=${baseUrl || MAIUI_BASE_URL}`);

  sseWrite(res, 'thinking', { message: `正在分析页面并规划操作... (${modeDesc})` });

  try {
    const page = await getActivePage();
    const browser = await connectToChrome();
    screencastSync = setupScreencastSync(browser, page.target()._targetId);

    // 截取执行前截图
    const screenshotBefore = await takeScreenshot(page);
    sseWrite(res, 'screenshot', { screenshot: screenshotBefore, label: 'before' });

    // 注入 XPath 工具（用于 click/type 捕获多定位器）
    await ensureXPathUtils(page);
    uninstallHooks = installPuppeteerHooks(page, xpathLog, { captureClickElementScreenshot: true });

    const MAX_STEPS = Math.max(1, MAIUI_MAX_STEPS);
    for (let i = 0; i < MAX_STEPS; i++) {
      if (clientClosed || res.writableEnded) {
        throw new Error('客户端已断开，停止任务');
      }

      // 当前屏幕截图（供 MAI-UI 推理）
      const ssUrl = await captureMaiUiScreenshotDataUrl(page, { maxWidth: 1024, maxHeight: 1024, quality: 60 });

      const messages = buildMaiUiMessages(task, ssUrl, history);
      const prediction = await callMaiUiLLM(messages, resolvedModelName, baseUrl);
      const parsed = parseMaiUiTaggedOutput(prediction);

      if (!parsed.actionArgs) {
        throw new Error(`MAI-UI 输出无法解析 action: ${prediction.slice(0, 200)}`);
      }

      const built = buildStepFromMaiUiAction(parsed.actionArgs, parsed.thinking, capturedSteps.length);

      if (built.type === 'ask_user') {
        throw new Error(`MAI-UI 需要用户补充信息: ${built.text}`);
      }

      if (built.type === 'answer') {
        // 作为最终“完成确认”步骤展示（不执行浏览器动作）
        const finalStep = {
          id: `step_${Date.now()}_${capturedSteps.length}`,
          action: 'done',
          target: built.text || built.summary || '完成',
          value: built.text || '',
          description: built.text || built.summary || '完成',
          status: 'executing',
          timestamp: Date.now(),
        };
        capturedSteps.push(finalStep);
        sseWrite(res, 'step_start', { step: finalStep, index: capturedSteps.length - 1 });
        sseWrite(res, 'step_detail', { taskIndex: capturedSteps.length - 1, thought: parsed.thinking || '' });
        finalStep.status = 'success';
        sseWrite(res, 'step_update', { index: capturedSteps.length - 1, status: 'success' });
        break;
      }

      if (built.type === 'terminate') {
        if (built.status === 'fail' || built.status === 'failed' || built.status === 'error') {
          throw new Error(`MAI-UI terminate: ${built.summary || 'fail'}`);
        }
        break;
      }

      if (built.type !== 'step') {
        throw new Error(`未知 MAI-UI built 类型: ${built.type}`);
      }

      const step = built.step;
      // open → navigate URL 归一化（避免 executor 400）
      if (step.action === 'navigate') {
        step.value = normalizeUrlFromOpenText(step.value);
        step.description = step.description || `导航: ${step.value}`;
      }

      capturedSteps.push(step);
      const stepIdx = capturedSteps.length - 1;
      sseWrite(res, 'step_start', { step, index: stepIdx });
      if (parsed.thinking) {
        sseWrite(res, 'step_detail', { taskIndex: stepIdx, thought: parsed.thinking });
      }

      // 执行步骤
      try {
        if (step.action === 'click' && step.coordinates) {
          await page.mouse.click(step.coordinates.x, step.coordinates.y);
          await sleep(800);
        } else if (step.action === 'double_click' && step.coordinates) {
          await page.mouse.click(step.coordinates.x, step.coordinates.y, { clickCount: 2 });
          await sleep(800);
        } else if (step.action === 'long_press' && step.coordinates) {
          await page.mouse.move(step.coordinates.x, step.coordinates.y);
          await page.mouse.down();
          await sleep(850);
          await page.mouse.up();
          await sleep(500);
        } else if (step.action === 'input') {
          await page.keyboard.type(step.value || '', { delay: 10 });
          await sleep(600);
        } else if (step.action === 'scroll') {
          const dir = (step.target || 'down').toLowerCase();
          await page.evaluate((d) => {
            const px = 700;
            const m = { down: [0, px], up: [0, -px], right: [px, 0], left: [-px, 0] };
            const [dx, dy] = m[d] || m['down'];
            window.scrollBy(dx, dy);
          }, dir);
          await sleep(600);
        } else if (step.action === 'navigate') {
          if (!step.value || !step.value.startsWith('http')) {
            throw new Error(`无效导航 URL: ${step.value}`);
          }
          await page.goto(step.value, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await sleep(1000);
        } else if (step.action === 'drag') {
          const start = step.drag?.start;
          const end = step.drag?.end;
          if (!start || !end) throw new Error('drag 缺少 start/end 坐标');
          await page.mouse.move(start.x, start.y);
          await page.mouse.down();
          await page.mouse.move(end.x, end.y, { steps: 12 });
          await page.mouse.up();
          await sleep(800);
        } else if (step.action === 'system_button') {
          const btn = (step.value || '').toLowerCase();
          if (btn === 'back') {
            await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
          } else if (btn === 'enter') {
            await page.keyboard.press('Enter');
          } else if (btn === 'home') {
            await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
          } else if (btn === 'menu') {
            // best-effort：触发 Alt 键菜单（不同平台行为不同）
            await page.keyboard.press('Alt').catch(() => {});
          } else {
            console.log(`  ⚠️ 未识别 system_button: ${btn}`);
          }
          await sleep(600);
        } else if (step.action === 'wait') {
          await sleep(parseInt(step.value, 10) || 2000);
        } else {
          console.log(`  ⚠️ 未实现动作: ${step.action}（跳过执行）`);
        }

        step.status = 'success';
        sseWrite(res, 'step_update', { index: stepIdx, status: 'success' });

        if (screencastSync) {
          try { const ap = await getActivePage(); await screencastSync.syncToPage(ap); } catch (_) {}
        }
      } catch (execErr) {
        step.status = 'error';
        step.error = execErr.message;
        sseWrite(res, 'step_update', { index: stepIdx, status: 'error' });
        throw execErr;
      }

      // 记录历史（用于下一轮上下文）
      history.push({
        imageDataUrl: ssUrl,
        thinking: parsed.thinking || '',
        actionArgs01: normalizeMaiUiActionArgs(parsed.actionArgs),
      });
    }

    // 清理钩子
    try { uninstallHooks(); } catch (_) {}
    if (screencastSync) { screencastSync.cleanup(); screencastSync = null; }

    // 匹配 XPath/定位器（复用现有逻辑）
    console.log(`  📋 Puppeteer 拦截了 ${xpathLog.length} 次动作（click:${xpathLog.filter(r=>r.source==='mouse.click').length} type:${xpathLog.filter(r=>r.source==='keyboard.type').length}）`);
    const xpathMatchCount = matchXPathsToSteps(capturedSteps, xpathLog);
    console.log(`  📍 成功匹配 ${xpathMatchCount} 个步骤的 XPath`);

    // hook 已生成 imageTemplate（click/type）；VLM 裁剪在 MAI-UI 场景下通常不可用，但不影响（会自动跳过）
    await cropImageTemplates(capturedSteps);

    // 标记需要 OCR 的步骤（与 Midscene 逻辑保持一致）
    for (const s of capturedSteps) {
      if (!s.locators) continue;
      if (s.locators.textContent?.value || s.locators.textContent?.pending) continue;
      const hasImg = s.locators.imageTemplate?.screenshot;
      if (hasImg && ['click', 'hover'].includes(s.action)) {
        s.locators.textContent = { pending: true, source: 'ocr', enabled: true, priority: 3, matchIndex: 0 };
      }
    }

    const ocrPending = capturedSteps
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.locators?.textContent?.pending && s.locators?.imageTemplate?.screenshot);
    if (ocrPending.length > 0) {
      console.log(`  🔤 OCR: ${ocrPending.length} 个步骤需要识别文字 (RapidOCR)`);
      const ocrResults = await Promise.allSettled(
        ocrPending.map(({ s }) => callOCRForText(s.locators.imageTemplate.screenshot))
      );
      ocrPending.forEach(({ s, i }, ri) => {
        const r = ocrResults[ri];
        if (r.status === 'fulfilled' && r.value) {
          s.locators.textContent = { value: r.value, source: 'ocr', enabled: true, priority: 3, matchIndex: 0, pending: false };
          console.log(`    ✅ 步骤[${i}] 文字: "${r.value.slice(0, 40)}"`);
        } else {
          s.locators.textContent = { pending: false, source: 'ocr', enabled: false };
          const err = r.status === 'rejected' ? r.reason?.message : '无文字';
          console.log(`    ⚠️  步骤[${i}] 未识别: ${err}`);
        }
      });
    }

    // 回填 step_xpath（兼容前端脚本编辑器定位器徽章）
    for (let i = 0; i < capturedSteps.length; i++) {
      const s = capturedSteps[i];
      if (s.xpath || (s.locators && Object.keys(s.locators).length > 0) || s.coordinates) {
        sseWrite(res, 'step_xpath', {
          index: i,
          xpath: s.xpath,
          xpathInfo: s.xpathInfo,
          coordinates: s.coordinates,
          value: s.value,
          target: s.target,
          locators: s.locators || {},
        });
      }
    }

    // 执行后截图
    const screenshotAfter = await takeScreenshot(page);

    // 清理内部字段
    const cleanSteps = capturedSteps.map(({ _hasCoords, _pendingCoords, _hasDetail, _locateImageData, _hookFullPageScreenshot, ...rest }) => rest);
    const duration = Date.now() - startTime;

    sseWrite(res, 'done', {
      success: true,
      steps: cleanSteps,
      result: { engine: 'mai-ui', model: resolvedModelName },
      screenshot: screenshotAfter,
      currentUrl: page.url(),
      duration,
    });
  } catch (err) {
    try { uninstallHooks(); } catch (_) {}
    if (screencastSync) { screencastSync.cleanup(); screencastSync = null; }
    const duration = Date.now() - startTime;
    console.error(`  ❌ MAI-UI 失败 (${duration}ms):`, err.message);

    // 尝试匹配已拦截的 XPath 数据
    if (xpathLog.length > 0) {
      try { matchXPathsToSteps(capturedSteps, xpathLog); } catch (_) {}
    }

    for (let i = 0; i < capturedSteps.length; i++) {
      const s = capturedSteps[i];
      if (s.xpath || (s.locators && Object.keys(s.locators).length > 0) || s.coordinates) {
        sseWrite(res, 'step_xpath', {
          index: i, xpath: s.xpath, xpathInfo: s.xpathInfo,
          coordinates: s.coordinates, value: s.value, target: s.target,
          locators: s.locators || {},
        });
      }
    }

    let errorScreenshot = null;
    try { errorScreenshot = await takeScreenshot(await getActivePage()); } catch (_) {}

    const cleanSteps = capturedSteps.map(({ _hasCoords, _pendingCoords, _hasDetail, _locateImageData, _hookFullPageScreenshot, ...rest }) => rest);
    sseWrite(res, 'error', { error: err.message, steps: cleanSteps, screenshot: errorScreenshot, duration });
  }

  res.end();
}

// ─── 核心端点：/ai-run ──────────────────────────────────
// 用户输入自然语言 → Midscene 自动规划+执行 → SSE 流式返回
app.post('/ai-run', async (req, res) => {
  const {
    task,
    model,
    planningModel,
    engine,
    maiuiBaseUrl,
    maiui_base_url,
    maiuiModel,
    maiui_model,
  } = req.body;
  if (!task) return res.status(400).json({ error: '缺少 task' });

  // SSE 头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const resolvedEngine = resolveAiEngine(engine, model);
  if (resolvedEngine === 'mai-ui') {
    await runMaiUiAiRun(req, res, {
      task,
      modelName: (maiuiModel || maiui_model || model || MAIUI_MODEL_NAME),
      baseUrl: (maiuiBaseUrl || maiui_base_url || MAIUI_BASE_URL),
    });
    return;
  }

  const modelCfg = model ? buildModelConfig(model, planningModel || null) : null;
  const vlLabel = VL_MODELS.find(m => m.id === model)?.label || 'default';
  const planLabel = planningModel ? (ALL_MODELS.find(m => m.id === planningModel)?.label || planningModel) : vlLabel;
  const modeDesc = planningModel && planningModel !== model ? `定位: ${vlLabel}, 规划: ${planLabel}` : vlLabel;
  console.log(`\n🚀 AI-RUN: "${task}" [${modeDesc}]`);
  const startTime = Date.now();
  const capturedSteps = [];

  sseWrite(res, 'thinking', { message: `正在分析页面并规划操作... (${modeDesc})` });

  const xpathLog = [];
  const locateImageLog = [];
  let uninstallHooks = () => {};

  let screencastSync = null;
  try {
    const page = await getActivePage();
    const AgentClass = loadMidscene();

    const browser = await connectToChrome();
    screencastSync = setupScreencastSync(browser, page.target()._targetId);

    // 截取执行前截图
    const screenshotBefore = await takeScreenshot(page);
    sseWrite(res, 'screenshot', { screenshot: screenshotBefore, label: 'before' });

    // ★ 确保 XPath 工具脚本在页面中可用（evaluateOnNewDocument + 立即注入）
    await ensureXPathUtils(page);

    // ★ 在 Puppeteer 方法层拦截 mouse.click / keyboard.type，
    //    在动作执行前同步获取目标元素 XPath，不依赖浏览器事件
    uninstallHooks = installPuppeteerHooks(page, xpathLog);

    // 创建 Agent，通过回调捕获每步启动
    const agentOpts = {
      onTaskStartTip: (taskDesc, taskType) => {
        const parsed = parseStepDescription(taskDesc);
        console.log(`  📌 [${parsed.action}] ${parsed.description}`);

        // 上一个步骤标记为成功
        if (capturedSteps.length > 0) {
          const prev = capturedSteps[capturedSteps.length - 1];
          if (prev.status === 'executing') {
            prev.status = 'success';
            sseWrite(res, 'step_update', { index: capturedSteps.length - 1, status: 'success' });
          }
        }

        const step = {
          id: `step_${Date.now()}_${capturedSteps.length}`,
          action: parsed.action,
          target: parsed.target,
          value: parsed.value,
          description: parsed.description,
          status: 'executing',
          timestamp: Date.now(),
        };

        // 消费 Locate 阶段缓存的坐标和图像数据
        const coordActions = new Set(['click', 'input', 'hover']);
        if (coordActions.has(parsed.action) && capturedSteps._pendingCoords) {
          step.coordinates = capturedSteps._pendingCoords;
          step._hasCoords = true;
          capturedSteps._pendingCoords = null;
          if (capturedSteps._pendingLocateImageData) {
            step._locateImageData = capturedSteps._pendingLocateImageData;
            delete capturedSteps._pendingLocateImageData;
            // click 步骤保留副本：Locate → click → input 三步同一元素，input 需要继承
            if (parsed.action === 'click') {
              capturedSteps._lastClickLocateImageData = step._locateImageData;
            }
          }
        }
        // input 步骤：如果没有自己的 Locate 数据，继承前序 click 的（同一 Locate 目标）
        if (parsed.action === 'input' && !step._locateImageData && capturedSteps._lastClickLocateImageData) {
          step._locateImageData = capturedSteps._lastClickLocateImageData;
          delete capturedSteps._lastClickLocateImageData;
        }

        capturedSteps.push(step);
        sseWrite(res, 'step_start', { step, index: capturedSteps.length - 1 });
      },
      waitAfterAction: 4000,
      waitForNetworkIdleTimeout: 10000,
    };

    // 动态模型配置：如果前端指定了模型，覆盖默认配置
    if (modelCfg) {
      agentOpts.modelConfig = modelCfg;
    }

    const agent = new AgentClass(page, agentOpts);

    // 实时流式思考回调：LLM token 级别流式解析
    // 1. reasoning_content（深度思考模型）→ 直接流式传输
    // 2. content（所有模型）→ 解析 <thought> / <log> 标签，提取内部文本流式传输
    const _tagStreams = [
      { tag: 'thought', label: '思考：', sentLen: 0, done: false },
      { tag: 'log',     label: '\n日志：', sentLen: 0, done: false },
    ];
    let _contentAccum = '';
    let _lastAccumLen = 0;
    let _reasoningStarted = false;

    agent.taskExecutor.onThoughtChunk = (chunk) => {
      let textToSend = '';

      if (chunk.reasoning) {
        if (!_reasoningStarted) {
          textToSend += '\n推理：';
          _reasoningStarted = true;
        }
        textToSend += chunk.reasoning;
      }

      const accLen = (chunk.accumulated_content || '').length;
      if (accLen > 0 && accLen < _lastAccumLen) {
        _contentAccum = '';
        _reasoningStarted = false;
        for (const s of _tagStreams) { s.sentLen = 0; s.done = false; }
      }
      _lastAccumLen = accLen;

      if (chunk.content) {
        _contentAccum += chunk.content;
        const lower = _contentAccum.toLowerCase();

        for (const s of _tagStreams) {
          if (s.done) continue;
          const openTag = `<${s.tag}>`;
          const closeTag = `</${s.tag}>`;
          const openIdx = lower.indexOf(openTag);
          if (openIdx < 0) continue;

          const contentStart = openIdx + openTag.length;
          const closeIdx = lower.indexOf(closeTag, contentStart);
          let contentEnd;
          if (closeIdx >= 0) {
            contentEnd = closeIdx;
            s.done = true;
          } else {
            // 闭合标签可能正在拆分接收中，安全截断：不发送末尾可能属于 </ 标签的部分
            const safeEnd = _contentAccum.lastIndexOf('<', _contentAccum.length - 1);
            contentEnd = (safeEnd > contentStart) ? safeEnd : _contentAccum.length;
          }
          const fullText = _contentAccum.substring(contentStart, contentEnd);

          if (fullText.length > s.sentLen) {
            if (s.sentLen === 0 && s.label) textToSend += s.label;
            textToSend += fullText.substring(s.sentLen);
            s.sentLen = fullText.length;
          }
        }
      }

      if (!textToSend) return;
      const stepIdx = capturedSteps.length > 0 ? capturedSteps.length - 1 : 0;
      sseWrite(res, 'thought_chunk', { taskIndex: stepIdx, text: textToSend });
    };

    // 注册 dump 更新监听器，提取 thought / log / reasoning + 元素坐标
    const sentDetails = new Set();
    const sentCoords = new Set();
    // Locate 任务用 taskId 去重（避免同坐标的两次 Locate 互相覆盖 pending 数据）
    const sentLocateIds = new Set();
    agent.addDumpUpdateListener((_dumpStr, executionDump) => {
      if (!executionDump) return;
      try {
        const tasks = executionDump.tasks || [];
        for (const t of tasks) {
          // ── 提取思考过程 ──
          const detail = extractTaskDetail(t);
          if (detail) {
            const key = `${detail.taskType}:${detail.taskSubType}:${(detail.thought||'').slice(0,60)}:${(detail.log||'').slice(0,60)}`;
            if (!sentDetails.has(key)) {
              sentDetails.add(key);
              const stepIdx = findMatchingStepIndex(capturedSteps, detail);
              if (stepIdx >= 0) {
                sseWrite(res, 'step_detail', { taskIndex: stepIdx, ...detail });
              }
            }
          }

          // ── 提取坐标（仅保存坐标，XPath 由浏览器事件钩子自动捕获）──
          const coords = extractCoordinates(t);
          if (coords) {
            const isLocateTask = (t.subType === 'Locate' || t.type === 'Insight');
            const coordKey = isLocateTask
              ? `locate:${t.taskId || (coords.x + ':' + coords.y + ':' + (t.taskId || Math.random()))}`
              : `${coords.x}:${coords.y}:${t.subType}`;

            if (!sentCoords.has(coordKey)) {
              sentCoords.add(coordKey);

              // （诊断已精简，仅保留关键日志）

              const actionMap = { Tap: 'click', Click: 'click', Input: 'input', Type: 'input', Hover: 'hover' };
              const mappedAction = actionMap[t.subType];
              if (mappedAction) {
                for (let i = capturedSteps.length - 1; i >= 0; i--) {
                  if (!capturedSteps[i]._hasCoords && capturedSteps[i].action === mappedAction) {
                    capturedSteps[i]._hasCoords = true;
                    capturedSteps[i].coordinates = coords;
                    if (capturedSteps._pendingLocateImageData) {
                      capturedSteps[i]._locateImageData = capturedSteps._pendingLocateImageData;
                      if (mappedAction === 'click') {
                        capturedSteps._lastClickLocateImageData = capturedSteps._pendingLocateImageData;
                      }
                      delete capturedSteps._pendingLocateImageData;
                    }
                    break;
                  }
                }
              }
              // Locate 阶段：缓存坐标 + 截图/元素rect（供下一个 action 步骤消费）
              if (isLocateTask) {
                capturedSteps._pendingCoords = coords;
                const screenshotObj = t.uiContext?.screenshot;
                let realRect = null;
                let bboxSource = 'none';
                if (t.log?.dump?.matchedRect) {
                  realRect = t.log.dump.matchedRect;
                  bboxSource = 'matchedRect';
                }
                if (!realRect && t.param?.bbox && Array.isArray(t.param.bbox) && t.param.bbox.length >= 4) {
                  const [x1, y1, x2, y2] = t.param.bbox;
                  realRect = { left: x1, top: y1, width: x2 - x1 + 1, height: y2 - y1 + 1 };
                  bboxSource = 'param.bbox';
                }
                if (!realRect && t.hitBy?.context?.bbox && Array.isArray(t.hitBy.context.bbox) && t.hitBy.context.bbox.length >= 4) {
                  const [x1, y1, x2, y2] = t.hitBy.context.bbox;
                  realRect = { left: x1, top: y1, width: x2 - x1 + 1, height: y2 - y1 + 1 };
                  bboxSource = 'hitBy.bbox';
                }
                if (!realRect && t.output?.element?.center) {
                  const [cx, cy] = t.output.element.center;
                  realRect = { left: Math.round(cx - 40), top: Math.round(cy - 25), width: 80, height: 50 };
                  bboxSource = 'center-fallback';
                }
                // bbox 太小时（VLM 返回的矩形可能被缩放），用 center 坐标推算默认区域
                if (realRect && (realRect.width <= 4 || realRect.height <= 4)) {
                  const cx = realRect.left + realRect.width / 2;
                  const cy = realRect.top + realRect.height / 2;
                  realRect = { left: Math.round(cx - 60), top: Math.round(cy - 30), width: 120, height: 60 };
                  bboxSource += '+center-fallback';
                }
                if (screenshotObj && realRect && realRect.width > 4 && realRect.height > 4) {
                  const ssBase64 = typeof screenshotObj === 'string' ? screenshotObj : screenshotObj.base64;
                  if (ssBase64) {
                    const imgData = { screenshotBase64: ssBase64, elementRect: realRect };
                    capturedSteps._pendingLocateImageData = imgData;
                    locateImageLog.push({
                      ...imgData,
                      coords,
                      timestamp: Date.now(),
                      bboxSource,
                      taskId: t.taskId || null,
                    });
                  }
                }
              }
            }
          }
        }
      } catch (_) { /* 不影响主流程 */ }
    });

    // ★ Midscene 黑盒执行：自动规划 + 逐步执行
    const result = await agent.ai(task);

    // 清理监听器 + 恢复 Puppeteer 原始方法
    agent.clearDumpUpdateListeners();
    uninstallHooks();
    if (screencastSync) { screencastSync.cleanup(); screencastSync = null; }

    // 执行结束后同步投屏到当前活跃页面
    try { const activePage = await getActivePage(); await switchScreencastTab(activePage.target()._targetId); } catch (_) {}

    // ★★ 将 Puppeteer 拦截日志匹配到对应步骤 ★★
    console.log(`  📋 Puppeteer 拦截了 ${xpathLog.length} 次动作（click:${xpathLog.filter(r=>r.source==='mouse.click').length} type:${xpathLog.filter(r=>r.source==='keyboard.type').length}）`);
    const xpathMatchCount = matchXPathsToSteps(capturedSteps, xpathLog);
    console.log(`  📍 成功匹配 ${xpathMatchCount} 个步骤的 XPath`);

    // ★★ 后置匹配：为缺少 VLM 数据的 action 步骤从 locateImageLog 回溯 ★★
    const locateMatchCount = matchLocateImagesToSteps(capturedSteps, locateImageLog);
    console.log(`  📸 Locate VLM 数据后置匹配 ${locateMatchCount} 个步骤 (log共${locateImageLog.length}条)`);

    await cropImageTemplates(capturedSteps);

    // ★ 图像裁剪完成后，标记无 DOM 文字但有图像模板的步骤 → 需要 OCR
    for (const s of capturedSteps) {
      if (!s.locators) continue;
      if (s.locators.textContent?.value || s.locators.textContent?.pending) continue;
      const hasImg = s.locators.imageTemplate?.screenshot;
      if (hasImg && ['click', 'hover'].includes(s.action)) {
        s.locators.textContent = { pending: true, source: 'ocr', enabled: true, priority: 3, matchIndex: 0 };
      }
    }

    // ★ OCR 文字提取：使用 RapidOCR 本地引擎
    const ocrPending = capturedSteps
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.locators?.textContent?.pending
                         && s.locators?.imageTemplate?.screenshot);
    if (ocrPending.length > 0) {
      console.log(`  🔤 OCR: ${ocrPending.length} 个步骤需要识别文字 (RapidOCR)`);
      const ocrResults = await Promise.allSettled(
        ocrPending.map(({ s }) => callOCRForText(s.locators.imageTemplate.screenshot))
      );
      ocrPending.forEach(({ s, i }, ri) => {
        const r = ocrResults[ri];
        if (r.status === 'fulfilled' && r.value) {
          s.locators.textContent = {
            value: r.value,
            source: 'ocr',
            enabled: true,
            priority: 3,
            matchIndex: 0,
            pending: false,
          };
          console.log(`    ✅ 步骤[${i}] 文字: "${r.value.slice(0, 40)}"`);
        } else {
          s.locators.textContent = { pending: false, source: 'ocr', enabled: false };
          const err = r.status === 'rejected' ? r.reason?.message : '无文字';
          console.log(`    ⚠️  步骤[${i}] 未识别: ${err}`);
        }
      });
    }

    // 为有坐标但无 locators 的可执行步骤补充基本定位器
    for (const s of capturedSteps) {
      if (!['click', 'input', 'hover'].includes(s.action)) continue;
      if (!s.locators) s.locators = {};
      if (s.coordinates && !s.locators.normalizedCoords) {
        const vw = 1920, vh = 1080;
        s.locators.normalizedCoords = {
          xPercent: +((s.coordinates.x / vw) * 100).toFixed(4),
          yPercent: +((s.coordinates.y / vh) * 100).toFixed(4),
          viewportWidth: vw, viewportHeight: vh,
          enabled: true, priority: 5,
        };
      }
      if (!s.locators.aiLocate && (s.description || s.target)) {
        s.locators.aiLocate = { value: s.description || s.target, enabled: true, priority: 6 };
      }
    }

    // 向前端发送所有定位器数据
    for (let i = 0; i < capturedSteps.length; i++) {
      const s = capturedSteps[i];
      if (s.xpath || (s.locators && Object.keys(s.locators).length > 0)) {
        sseWrite(res, 'step_xpath', {
          index: i,
          xpath: s.xpath,
          xpathInfo: s.xpathInfo,
          coordinates: s.coordinates,
          value: s.value,
          target: s.target,
          locators: s.locators || {},
        });
      }
    }

    // 执行后截图
    const screenshotAfter = await takeScreenshot(page);

    // 标记所有步骤成功；如果最后一步是规划且任务已完成，标记为"完成确认"
    capturedSteps.forEach(s => {
      if (s.status === 'executing') s.status = 'success';
    });
    const last = capturedSteps[capturedSteps.length - 1];
    if (last && last.action === 'plan') {
      last.action = 'done';
      last.description = '完成确认 - 目标已达成';
      last.target = '目标已达成';
    }

    const duration = Date.now() - startTime;
    const xpathCount = capturedSteps.filter(s => s.xpath).length;
    console.log(`  ✅ 完成 (${duration}ms, ${capturedSteps.length} 步, ${xpathCount} 步有XPath)`);

    // 清理内部属性后发送
    const cleanSteps = capturedSteps.map(({ _hasCoords, _pendingCoords, _hasDetail, _locateImageData, _hookFullPageScreenshot, ...rest }) => rest);

    sseWrite(res, 'done', {
      success: true,
      steps: cleanSteps,
      result: result || null,
      screenshot: screenshotAfter,
      currentUrl: page.url(),
      duration,
    });
  } catch (err) {
    const duration = Date.now() - startTime;
    console.error(`  ❌ 失败 (${duration}ms):`, err.message);

    // 清理钩子（可能还没执行到正常清理）
    try { uninstallHooks(); } catch (_) {}
    if (screencastSync) { screencastSync.cleanup(); screencastSync = null; }

    // 即使任务失败，也尝试匹配已拦截的 XPath 数据 + 后置匹配 VLM 数据 + 裁剪图像模板
    if (xpathLog.length > 0 || locateImageLog.length > 0) {
      console.log(`  📋 [错误恢复] Puppeteer 拦截了 ${xpathLog.length} 次动作, Locate VLM 记录 ${locateImageLog.length} 条`);
      try {
        const xpathMatchCount = matchXPathsToSteps(capturedSteps, xpathLog);
        console.log(`  📍 [错误恢复] 成功匹配 ${xpathMatchCount} 个步骤的 XPath`);
      } catch (e) { console.error('  ⚠️ XPath 匹配异常:', e.message); }
      try {
        const locateMatchCount = matchLocateImagesToSteps(capturedSteps, locateImageLog);
        console.log(`  📸 [错误恢复] Locate VLM 后置匹配 ${locateMatchCount} 个步骤`);
      } catch (e) { console.error('  ⚠️ [错误恢复] Locate 后置匹配异常:', e.message); }
      try {
        await cropImageTemplates(capturedSteps);
      } catch (e) { console.error('  ⚠️ [错误恢复] 图像裁剪异常:', e.message); }
    }

    // 为有坐标但无 locators 的步骤补充基本定位器
    for (const s of capturedSteps) {
      if (!['click', 'input', 'hover'].includes(s.action)) continue;
      if (!s.locators) s.locators = {};
      if (s.coordinates && !s.locators.normalizedCoords) {
        const vw = 1920, vh = 1080;
        s.locators.normalizedCoords = {
          xPercent: +((s.coordinates.x / vw) * 100).toFixed(4),
          yPercent: +((s.coordinates.y / vh) * 100).toFixed(4),
          viewportWidth: vw, viewportHeight: vh,
          enabled: true, priority: 5,
        };
      }
      if (!s.locators.aiLocate && (s.description || s.target)) {
        s.locators.aiLocate = { value: s.description || s.target, enabled: true, priority: 6 };
      }
    }

    // 发送已匹配的定位器数据
    for (let i = 0; i < capturedSteps.length; i++) {
      const s = capturedSteps[i];
      if (s.xpath || (s.locators && Object.keys(s.locators).length > 0)) {
        sseWrite(res, 'step_xpath', {
          index: i, xpath: s.xpath, xpathInfo: s.xpathInfo,
          coordinates: s.coordinates, value: s.value, target: s.target,
          locators: s.locators || {},
        });
      }
    }

    // 已完成的步骤标记 success，最后一个标记 error
    for (let i = 0; i < capturedSteps.length; i++) {
      const s = capturedSteps[i];
      if (s.status === 'executing') {
        if (i === capturedSteps.length - 1) {
          s.status = 'error';
          s.error = err.message;
        } else {
          s.status = 'success';
        }
      }
    }

    let errorScreenshot = null;
    try { errorScreenshot = await takeScreenshot(await getActivePage()); } catch (_) {}

    const errorCleanSteps = capturedSteps.map(({ _hasCoords, _pendingCoords, _hasDetail, _locateImageData, _hookFullPageScreenshot, ...rest }) => rest);
    sseWrite(res, 'error', {
      error: err.message,
      steps: errorCleanSteps,
      screenshot: errorScreenshot,
      duration,
    });
  }

  res.end();
});

/**
 * 解析 onTaskStartTip 回调的描述文本，提取结构化的操作信息
 *
 * 回调描述格式示例：
 *   "Planning - 搜索大模型测试，点击第三个结果"
 *   "Insight / Locate - 搜索输入框"
 *   "Action / Input - 搜索输入框 - 大模型测试"
 *   "Action / Tap - 第一个帖子标题"
 *   "Action / KeyboardPress - Enter"
 *   "Action / Scroll - down, once"
 */
function parseStepDescription(desc) {
  if (!desc) return { action: 'action', description: desc || '', target: '', value: '' };

  // 尝试匹配 "Category / ActionType - details" 格式（details 可能含换行，如 Navigate 参数的 JSON）
  const match = desc.match(/^(?:(\w+)\s*\/\s*)?(\w+)\s*-\s*([\s\S]+)$/);
  if (match) {
    const [, category, actionType, details] = match;
    const mappedAction = mapMidsceneAction(actionType);

    // Input 特殊处理：
    //   "target - value" → target=target, value=value
    //   "value"          → target='', value=value（AI规划时 Input 动作只有 value 无 locate）
    if (mappedAction === 'input') {
      if (details.includes(' - ')) {
        const parts = details.split(' - ');
        const value = parts.pop();
        const target = parts.join(' - ');
        return { action: mappedAction, description: desc, target, value };
      } else {
        // Midscene 规划输出的 Input 动作只含 value（无 locate）
        return { action: mappedAction, description: desc, target: '', value: details.trim() };
      }
    }

    // KeyboardPress 特殊处理
    if (mappedAction === 'keypress') {
      return { action: mappedAction, description: desc, target: '', value: details.trim() };
    }

    // Navigate 特殊处理：从 JSON 参数中提取 URL
    if (mappedAction === 'navigate') {
      let url = details.trim();
      try {
        const parsed = JSON.parse(url);
        if (parsed.url) url = parsed.url;
      } catch (_) {
        // 如果不是 JSON，可能本身就是 URL
      }
      return { action: mappedAction, description: desc, target: '', value: url };
    }

    return { action: mappedAction, description: desc, target: details.trim(), value: '' };
  }

  // 匹配 "Planning - xxx" 格式
  const planMatch = desc.match(/^Planning\s*-\s*(.+)$/);
  if (planMatch) {
    return { action: 'plan', description: desc, target: planMatch[1].trim(), value: '' };
  }

  return { action: 'action', description: desc, target: '', value: '' };
}

/**
 * 将 dump 中的 task detail 匹配到 capturedSteps 的索引
 * 通过任务类型映射：Planning → plan, Locate → locate, Action → click/input 等
 */
function findMatchingStepIndex(capturedSteps, detail) {
  if (!capturedSteps.length) return -1;
  const typeMap = { Planning: 'plan', Insight: 'locate', 'Action Space': null };
  const mappedType = typeMap[detail.taskType];
  const subMap = { Locate: 'locate', Tap: 'click', Click: 'click', Input: 'input', Scroll: 'scroll', KeyboardPress: 'keypress' };
  const mappedSub = subMap[detail.taskSubType];

  // 从后往前搜索，匹配最近的同类型步骤
  for (let i = capturedSteps.length - 1; i >= 0; i--) {
    const s = capturedSteps[i];
    if (s._hasDetail) continue;
    if (mappedType && s.action === mappedType) { s._hasDetail = true; return i; }
    if (mappedSub && s.action === mappedSub) { s._hasDetail = true; return i; }
  }
  // fallback：返回最后一个正在执行的步骤
  for (let i = capturedSteps.length - 1; i >= 0; i--) {
    if (capturedSteps[i].status === 'executing') return i;
  }
  return capturedSteps.length - 1;
}

/**
 * 从 Midscene ExecutionTask 中提取 thought / log / reasoning 等详细信息
 */
function extractTaskDetail(task) {
  if (!task) return null;
  const detail = {};
  let hasContent = false;

  // Planning 任务的 output 中包含 thought 和 log
  if (task.output) {
    if (task.output.thought) {
      detail.thought = task.output.thought;
      hasContent = true;
    }
    if (task.output.log) {
      detail.log = task.output.log;
      hasContent = true;
    }
  }

  // 深度思考模型的 reasoning_content
  if (task.reasoning_content) {
    detail.reasoning = task.reasoning_content;
    hasContent = true;
  }

  // 任务的 thought 字段（Action Space 任务）
  if (task.thought && !detail.thought) {
    detail.thought = task.thought;
    hasContent = true;
  }

  // 任务类型和子类型，方便前端匹配
  if (hasContent) {
    detail.taskType = task.type;
    detail.taskSubType = task.subType;
    detail.timing = task.timing;
  }

  return hasContent ? detail : null;
}

/**
 * 从 dump 任务中提取元素的像素坐标
 * Midscene 定位后，元素坐标存在于：
 *   - Action Space 任务: param.locate.center / param.locate.bbox
 *   - Insight/Locate 任务: output.element.center
 *   - Planning/Locate 任务: output.element.center
 */
function extractCoordinates(task) {
  if (!task) return null;

  // Action Space 任务（Tap / Input / Hover 等）
  if (task.type === 'Action Space' && task.param?.locate) {
    const loc = task.param.locate;
    if (loc.center && loc.center.length >= 2) {
      return { x: Math.round(loc.center[0]), y: Math.round(loc.center[1]) };
    }
    if (loc.bbox && loc.bbox.length >= 4) {
      return {
        x: Math.round((loc.bbox[0] + loc.bbox[2]) / 2),
        y: Math.round((loc.bbox[1] + loc.bbox[3]) / 2),
      };
    }
  }

  // Insight/Locate 或 Planning/Locate 任务
  if ((task.type === 'Insight' || task.type === 'Planning') &&
      (task.subType === 'Locate') &&
      task.output?.element?.center) {
    const c = task.output.element.center;
    return { x: Math.round(c[0]), y: Math.round(c[1]) };
  }

  return null;
}

function mapMidsceneAction(actionType) {
  const map = {
    Tap: 'click', Click: 'click', Input: 'input', Type: 'input',
    Scroll: 'scroll', Hover: 'hover', KeyboardPress: 'keypress', KeyPress: 'keypress',
    Sleep: 'wait', Navigate: 'navigate', Locate: 'locate', Assert: 'assert',
    Planning: 'plan', Insight: 'locate',
  };
  return map[actionType] || actionType.toLowerCase();
}

// ─── 元素自愈定位引擎 ──────────────────────────────────
// 按优先级依次尝试多种定位策略，任一成功即返回
// 优先级: 1.XPath → 2.CSS → 3.文本 → 4.图像模板(Airtest) → 5.归一化坐标

const HEAL_TIMEOUT = 5000;

/**
 * 尝试用 XPath 定位元素
 * @returns {Object|null} { locator, method }
 */
async function tryXPath(frame, xpath) {
  if (!xpath) return null;
  const loc = frame.locator(`xpath=${xpath}`).first();
  const count = await loc.count().catch(() => 0);
  if (count > 0) {
    const visible = await loc.isVisible().catch(() => false);
    if (!visible) return null;
    return { locator: loc, method: 'xpath' };
  }
  return null;
}

/**
 * 尝试用 CSS Selector 定位元素（支持 matchIndex + 坐标合理性校验）
 */
async function tryCssSelector(frame, css, matchIndex) {
  if (!css) return null;
  const idx = matchIndex ?? 0;
  try {
    const allLoc = frame.locator(`css=${css}`);
    const total = await allLoc.count().catch(() => 0);
    if (total <= 0) return null;
    const target = idx < total ? allLoc.nth(idx) : allLoc.first();
    const visible = await target.isVisible().catch(() => false);
    if (!visible) return null;
    return { locator: target, method: `cssSelector[${idx}/${total}]` };
  } catch (_) {}
  return null;
}

/**
 * 用 RapidOCR 在当前页面截图中定位含指定文字的元素，返回精确中心坐标
 */
async function tryTextContentOCR(pwPage, text) {
  try {
    const screenshotBuf = await pwPage.screenshot({ type: 'jpeg', quality: 90 });
    const imageBase64 = screenshotBuf.toString('base64');
    console.log(`    🔍 OCR 文字定位: "${text}"`);
    const coords = await callOCRForLocate(imageBase64, text);
    if (coords) {
      console.log(`    ✅ OCR 定位成功: (${coords.x}, ${coords.y}) conf=${coords.confidence}`);
      return { coordinates: { x: coords.x, y: coords.y }, method: `textContent(OCR)` };
    }
    console.log(`    ⚠️  OCR 未找到 "${text}"`);
  } catch (e) {
    console.log(`    ❌ OCR 定位失败: ${e.message}`);
  }
  return null;
}

/**
 * AI 定位 —— 调用 Midscene 的 aiTap 进行元素定位和点击
 * 利用 Midscene 的 截图+DOM树+VLM 综合分析能力，作为自愈定位的最终策略
 * Puppeteer 和 Playwright 共享同一 Chrome，点击效果互通
 */
async function tryAiLocate(description, modelId) {
  try {
    console.log(`    🤖 AI 定位: "${description}" (${modelId})`);
    const puppPage = await getActivePage();
    const AgentClass = loadMidscene();
    const modelCfg = buildModelConfig(modelId, null);
    const agent = new AgentClass(puppPage, { modelConfig: modelCfg, waitAfterAction: 1500 });
    await agent.aiTap(description);
    console.log(`    ✅ AI 定位并点击成功: "${description}"`);
    return { tapped: true, method: `aiLocate(Midscene)` };
  } catch (e) {
    console.log(`    ⚠️  AI 定位失败: ${e.message}`);
  }
  return null;
}

/**
 * 尝试用文本内容定位元素
 *   - source='dom'  → Playwright DOM 匹配（原有逻辑，不受影响）
 *   - source='ocr'  → RapidOCR 精确坐标定位
 *   - source='vlm'  → 兼容旧数据，走 OCR 定位
 */
async function tryTextContent(frame, text, tagName, matchIndex, textLocator, pwPage) {
  if (!text || text.length < 2) return null;
  const cleanText = text.replace(/\.\.\.$/, '').trim();
  if (!cleanText) return null;
  const idx = matchIndex ?? 0;

  // OCR 来源（含兼容旧 vlm 数据）：截图中精确定位文字
  if ((textLocator?.source === 'ocr' || textLocator?.source === 'vlm') && pwPage) {
    return await tryTextContentOCR(pwPage, cleanText);
  }

  // DOM 来源：Playwright 匹配（每个候选结果都需通过坐标合理性校验）
  // 1) DOM 精确匹配
  try {
    const exactAll = frame.getByText(cleanText, { exact: true });
    let count = await exactAll.count().catch(() => 0);
    if (count > 0) {
      const target = idx < count ? exactAll.nth(idx) : exactAll.first();
      const visible = await target.isVisible().catch(() => false);
      if (visible) return { locator: target, method: `textContent(exact)[${idx}/${count}]` };
    }

    // 2) DOM 模糊匹配
    const fuzzyAll = frame.getByText(cleanText);
    count = await fuzzyAll.count().catch(() => 0);
    if (count > 0) {
      const target = idx < count ? fuzzyAll.nth(idx) : fuzzyAll.first();
      const visible = await target.isVisible().catch(() => false);
      if (visible) return { locator: target, method: `textContent(contains)[${idx}/${count}]` };
    }

    // 3) 输入框 placeholder
    if (['input', 'textarea'].includes(tagName)) {
      const phAll = frame.getByPlaceholder(cleanText);
      count = await phAll.count().catch(() => 0);
      if (count > 0) {
        const target = idx < count ? phAll.nth(idx) : phAll.first();
        const visible = await target.isVisible().catch(() => false);
        if (visible) return { locator: target, method: `textContent(placeholder)[${idx}/${count}]` };
      }
    }
  } catch (_) {}

  return null;
}

/**
 * 尝试用图像模板匹配定位元素 —— 调用 Python Airtest API（支持 matchIndex）
 */
async function tryImageTemplate(page, imageData) {
  if (!imageData?.screenshot) return null;
  const idx = imageData.matchIndex ?? 0;
  try {
    const response = await fetch('http://127.0.0.1:5566/api/airtest-match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template: imageData.screenshot,
        threshold: imageData.threshold || 0.7,
        matchIndex: idx,
      }),
    });
    if (!response.ok) return null;
    const result = await response.json();
    if (result.success && result.x != null && result.y != null) {
      return { coordinates: { x: result.x, y: result.y }, method: `imageTemplate[${idx}]`, confidence: result.confidence };
    }
  } catch (_) {}
  return null;
}

/**
 * 尝试用归一化坐标定位
 */
async function tryNormalizedCoords(page, normData) {
  if (!normData?.xPercent || !normData?.yPercent) return null;
  try {
    const vp = page.viewportSize();
    if (!vp) return null;
    const x = Math.round((normData.xPercent / 100) * vp.width);
    const y = Math.round((normData.yPercent / 100) * vp.height);
    return { coordinates: { x, y }, method: 'normalizedCoords' };
  } catch (_) {}
  return null;
}

/**
 * 自愈定位引擎 —— 按优先级逐一尝试所有已启用的定位器
 *
 * @param {Object} pwPage - Playwright page
 * @param {Object} step   - 步骤对象
 * @returns {Object} { locator?, coordinates?, method, healed, healLog[] }
 */
async function healingLocate(pwPage, step, context = {}) {
  const healLog = [];
  const locators = step.locators || {};
  const iframes = step.xpathInfo?.iframes || [];
  const engine = context.engine || 'midscene';
  const maiuiBaseUrl = context.maiuiBaseUrl || MAIUI_BASE_URL;
  const maiuiModel = context.maiuiModel || MAIUI_MODEL_NAME;

  // 获取目标 frame（处理 iframe 链）
  async function getTargetFrame() {
    let frame = pwPage.mainFrame();
    for (const ifr of iframes) {
      try {
        const iframeXPath = ifr.value || ifr;
        const iframeEl = frame.locator(`xpath=${iframeXPath}`).first();
        const contentFrame = await iframeEl.contentFrame();
        if (contentFrame) frame = contentFrame;
      } catch (_) { break; }
    }
    return frame;
  }

  const frame = await getTargetFrame();
  const tagName = step.xpathInfo?.tagName || '';

  // 构建定位器候选列表（按 priority 排序）
  const candidates = [];

  // 始终把主 xpath 作为首选（即使 locators 中没有）
  if (step.xpath) {
    const xpathLoc = locators.xpath || {};
    if (xpathLoc.enabled !== false) {
      candidates.push({ type: 'xpath', priority: xpathLoc.priority || 1, value: step.xpath });
    }
  }
  if (locators.cssSelector?.enabled !== false && locators.cssSelector?.value) {
    candidates.push({ type: 'cssSelector', priority: locators.cssSelector.priority || 2, value: locators.cssSelector.value, matchIndex: locators.cssSelector.matchIndex ?? 0 });
  }
  if (locators.textContent?.enabled !== false && locators.textContent?.value && !locators.textContent?.pending) {
    candidates.push({
      type: 'textContent',
      priority: locators.textContent.priority || 3,
      value: locators.textContent.value,
      matchIndex: locators.textContent.matchIndex ?? 0,
      textLocator: locators.textContent,  // 含 source / vlmModel
    });
  }
  if (locators.imageTemplate?.enabled !== false && locators.imageTemplate?.screenshot) {
    candidates.push({ type: 'imageTemplate', priority: locators.imageTemplate.priority || 4, data: locators.imageTemplate });
  }
  if (locators.normalizedCoords?.enabled !== false && locators.normalizedCoords?.xPercent) {
    candidates.push({ type: 'normalizedCoords', priority: locators.normalizedCoords.priority || 5, data: locators.normalizedCoords });
  }
  if (locators.aiLocate?.enabled !== false && locators.aiLocate?.value) {
    candidates.push({ type: 'aiLocate', priority: locators.aiLocate.priority || 6, value: locators.aiLocate.value, modelId: locators.aiLocate.model });
  }

  // 兜底：即使 locators 为空，也用旧逻辑
  if (candidates.length === 0) {
    if (step.xpath) candidates.push({ type: 'xpath', priority: 1, value: step.xpath });
    if (step.coordinates) candidates.push({ type: 'rawCoords', priority: 99, data: step.coordinates });
  }

  candidates.sort((a, b) => a.priority - b.priority);

  // 逐一尝试
  for (const c of candidates) {
    try {
      let result = null;
      switch (c.type) {
        case 'xpath':
          result = await tryXPath(frame, c.value);
          break;
        case 'cssSelector':
          result = await tryCssSelector(frame, c.value, c.matchIndex);
          break;
        case 'textContent':
          result = await tryTextContent(frame, c.value, tagName, c.matchIndex, c.textLocator, pwPage);
          break;
        case 'imageTemplate':
          result = await tryImageTemplate(pwPage, c.data);
          break;
        case 'normalizedCoords':
          result = await tryNormalizedCoords(pwPage, c.data);
          break;
        case 'aiLocate': {
          if (engine === 'mai-ui') {
            result = await tryAiLocateMaiUi(c.value, { baseUrl: maiuiBaseUrl, modelName: maiuiModel });
          } else {
            result = await tryAiLocate(c.value, c.modelId || context.modelId || 'doubao-seed-1-8-251228');
          }
          break;
        }
        case 'rawCoords':
          result = { coordinates: c.data, method: 'rawCoords' };
          break;
      }
      if (result) {
        const healed = c.type !== 'xpath';
        if (healed) {
          healLog.push(`⚠️ XPath 失败，通过 ${result.method} 自愈成功`);
          console.log(`    🩹 自愈: ${result.method} (跳过了: ${healLog.length > 1 ? healLog.slice(0, -1).join(', ') : 'xpath'})`);
        }
        return { ...result, healed, healLog, frame };
      }
      healLog.push(`❌ ${c.type} 失败`);
    } catch (e) {
      healLog.push(`❌ ${c.type} 异常: ${e.message}`);
    }
  }

  return { locator: null, coordinates: null, method: 'none', healed: false, healLog, frame };
}

/**
 * 在定位到的元素上执行输入操作（共用逻辑）
 */
async function performInput(pwPage, loc, value) {
  await loc.scrollIntoViewIfNeeded({ timeout: HEAL_TIMEOUT }).catch(() => {});
  await loc.click({ timeout: HEAL_TIMEOUT });
  await sleep(300);
  const isMac = process.platform === 'darwin';
  const mod = isMac ? 'Meta' : 'Control';
  await pwPage.keyboard.press(`${mod}+a`);
  await sleep(100);
  try {
    await loc.fill(value || '', { timeout: 3000 });
  } catch (_) {
    await pwPage.keyboard.press(`${mod}+a`);
    await pwPage.keyboard.type(value || '', { delay: 30 });
  }
}

/**
 * 在坐标上执行输入操作（共用逻辑）
 */
async function performInputAtCoords(pwPage, x, y, value) {
  await pwPage.mouse.click(x, y);
  await sleep(300);
  const isMac = process.platform === 'darwin';
  const mod = isMac ? 'Meta' : 'Control';
  await pwPage.keyboard.press(`${mod}+a`);
  await pwPage.keyboard.type(value || '', { delay: 30 });
}

// ─── 单步执行（带元素自愈的 Playwright 回放）─────────────
// ─── 单步重新生成（仅采集定位信息，不执行动作）─────────────
app.post('/regenerate-step', async (req, res) => {
  const { step, stepIndex, model } = req.body || {};
  if (!step) return res.status(400).json({ success: false, error: '缺少 step' });

  const action = (step.action || '').toLowerCase();
  const needsElement = ['click', 'input', 'hover', 'double_click', 'long_press'].includes(action);
  if (!needsElement) {
    return res.status(400).json({ success: false, error: `该步骤不支持重新生成定位信息: ${action || 'unknown'}` });
  }

  const desc = (step.description || step.target || '').trim();
  if (!desc) {
    return res.status(400).json({ success: false, error: '缺少元素描述（description/target）' });
  }

  const t0 = Date.now();
  try {
    const puppPage = await getActivePage();
    await ensureXPathUtils(puppPage);

    const xpathLog = [];
    const uninstall = installPuppeteerCaptureOnly(puppPage, xpathLog, { captureClickElementScreenshot: true });

    try {
      const AgentClass = loadMidscene();
      const modelCfg = buildModelConfig(model || 'doubao-seed-1-8-251228', null);
      const agent = new AgentClass(puppPage, { modelConfig: modelCfg, waitAfterAction: 0 });

      // Run with timeout (default 45s).
      const timeoutMs = 45000;
      await Promise.race([
        agent.aiTap(desc),
        new Promise((_, rej) => setTimeout(() => rej(new Error('单步重新生成超时')), timeoutMs)),
      ]);
    } finally {
      try { uninstall(); } catch (_) {}
    }

    const rec = xpathLog.length ? xpathLog[xpathLog.length - 1] : null;
    if (!rec?.xpath) {
      return res.status(502).json({ success: false, error: '未能采集到定位信息（无 XPath 记录）' });
    }

    // Build updated step using existing attachXPath logic.
    const updated = JSON.parse(JSON.stringify(step));
    const tmpAction = updated.action;
    if (tmpAction === 'double_click' || tmpAction === 'long_press') updated.action = 'click';
    updated.coordinates = { x: Math.round(rec.x || 0), y: Math.round(rec.y || 0) };

    matchXPathsToSteps([updated], [rec]);

    // Restore original action if we temporarily mapped it.
    updated.action = tmpAction;

    // Best-effort OCR fill if no DOM text was captured.
    if (!updated.locators) updated.locators = {};
    if (!updated.locators.textContent?.value && updated.locators.imageTemplate?.screenshot) {
      const ocrOk = await isOCRServiceAvailable();
      if (ocrOk) {
        const text = await callOCRForText(updated.locators.imageTemplate.screenshot);
        if (text) {
          updated.locators.textContent = { value: text, source: 'ocr', enabled: true, priority: 3, matchIndex: 0, pending: false };
        }
      }
    }

    // Ensure aiLocate is present for future healing.
    const aiDesc = updated.description || updated.target || desc;
    if (aiDesc && !updated.locators.aiLocate) {
      updated.locators.aiLocate = { value: aiDesc, enabled: true, priority: 6 };
    }

    const duration = Date.now() - t0;
    return res.json({ success: true, step: updated, duration });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message || String(e) });
  }
});

app.post('/execute-step', async (req, res) => {
  const { step, stepIndex, model, engine, maiuiBaseUrl, maiuiModel } = req.body;
  if (!step) return res.status(400).json({ error: '缺少 step' });

  const locatorCount = step.locators ? Object.keys(step.locators).filter(k => step.locators[k]?.enabled !== false).length : 0;
  const modeLabel = locatorCount > 1 ? `🛡️自愈(${locatorCount}策略)` : (step.xpath ? '📍XPath' : step.coordinates ? '📐坐标' : '🤖AI');
  console.log(`▶️ 回放步骤 #${stepIndex ?? '?'} [${modeLabel}]: ${step.description || step.action}`);
  const t0 = Date.now();

  try {
    const pwPage = await getPlaywrightPage();
    const resolvedEngine = resolveAiEngine(engine, model);
    const maiuiCtx = {
      baseUrl: (maiuiBaseUrl || MAIUI_BASE_URL),
      modelName: (maiuiModel || model || MAIUI_MODEL_NAME),
    };
    const healCtx = {
      engine: resolvedEngine,
      modelId: model,
      maiuiBaseUrl: maiuiCtx.baseUrl,
      maiuiModel: maiuiCtx.modelName,
    };

    switch (step.action) {
      // ── 导航 ──
      case 'navigate': {
        let navUrl = step.value || step.target || '';
        try { const p = JSON.parse(navUrl); if (p.url) navUrl = p.url; } catch (_) {}
        if (!navUrl || !navUrl.startsWith('http')) {
          return res.status(400).json({ success: false, error: `无效的导航 URL: ${navUrl}` });
        }
        await pwPage.goto(navUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(1000); break;
      }

      case 'wait':
        await sleep(parseInt(step.value, 10) || 2000); break;

      case 'keypress':
        await pwPage.keyboard.press(step.value || 'Enter');
        await sleep(500); break;

      case 'scroll': {
        const dir = (step.target || step.value || 'down').toLowerCase();
        await pwPage.evaluate((d) => {
          const px = 500;
          const m = { down: [0, px], up: [0, -px], right: [px, 0], left: [-px, 0] };
          const [dx, dy] = m[d] || m['down'];
          window.scrollBy(dx, dy);
        }, dir);
        await sleep(500); break;
      }

      // ── 点击（自愈） ──
      case 'click': {
        const result = await healingLocate(pwPage, step, healCtx);
        if (result.tapped) {
          // Midscene 已通过 Puppeteer 完成点击（共享同一 Chrome）
          console.log(`    → ${result.method} 点击${result.healed ? '（自愈）' : ''}`);
        } else if (result.locator) {
          await result.locator.scrollIntoViewIfNeeded({ timeout: HEAL_TIMEOUT }).catch(() => {});
          await result.locator.click({ timeout: 10000 });
          console.log(`    → ${result.method} 点击${result.healed ? '（自愈）' : ''}`);
        } else if (result.coordinates) {
          await pwPage.mouse.click(result.coordinates.x, result.coordinates.y);
          console.log(`    → ${result.method} 坐标点击 (${result.coordinates.x}, ${result.coordinates.y})${result.healed ? '（自愈）' : ''}`);
        } else {
          if (resolvedEngine === 'mai-ui') {
            const located = await tryAiLocateMaiUi(step.target || step.description, maiuiCtx);
            if (!located?.coordinates) throw new Error('MAI-UI 回退点击失败（无坐标）');
            await pwPage.mouse.click(located.coordinates.x, located.coordinates.y);
            console.log(`    → MAI-UI 回退点击: ${step.target || step.description}`);
          } else {
            const puppPage = await getActivePage();
            const AgentClass = loadMidscene();
            const modelCfg = buildModelConfig(model || 'doubao-seed-1-8-251228', null);
            const agent = new AgentClass(puppPage, { modelConfig: modelCfg, waitAfterAction: 1500 });
            await agent.aiTap(step.target || step.description);
            console.log(`    → AI 回退点击: ${step.target}`);
          }
        }
        await sleep(800); break;
      }

      // ── 输入（自愈） ──
      case 'input': {
        const result = await healingLocate(pwPage, step, healCtx);
        if (result.tapped) {
          // Midscene 已定位元素并点击，现在通过 Puppeteer 输入文本
          const puppPage = await getActivePage();
          await puppPage.keyboard.type(step.value || '');
          console.log(`    → ${result.method} 输入${result.healed ? '（自愈）' : ''}: "${step.value}"`);
        } else if (result.locator) {
          const tagName = step.xpathInfo?.tagName || '';
          const nonInputTags = new Set(['div', 'span', 'section', 'article', 'form', 'ul', 'li', 'table']);
          let loc = result.locator;
          if (nonInputTags.has(tagName.toLowerCase()) && result.method === 'xpath') {
            const innerLoc = result.frame.locator(`xpath=${step.xpath}`).locator('input, textarea, [contenteditable="true"]').first();
            const innerCount = await innerLoc.count().catch(() => 0);
            if (innerCount > 0) loc = innerLoc;
          }
          await performInput(pwPage, loc, step.value);
          console.log(`    → ${result.method} 输入${result.healed ? '（自愈）' : ''}: "${step.value}"`);
        } else if (result.coordinates) {
          await performInputAtCoords(pwPage, result.coordinates.x, result.coordinates.y, step.value);
          console.log(`    → ${result.method} 坐标输入${result.healed ? '（自愈）' : ''}`);
        } else {
          if (resolvedEngine === 'mai-ui') {
            const located = await tryAiLocateMaiUi(step.target || step.description, maiuiCtx);
            if (!located?.coordinates) throw new Error('MAI-UI 回退输入失败（无坐标）');
            await performInputAtCoords(pwPage, located.coordinates.x, located.coordinates.y, step.value);
            console.log(`    → MAI-UI 回退输入: ${step.target || step.description}`);
          } else {
            const puppPage = await getActivePage();
            const AgentClass = loadMidscene();
            const modelCfg = buildModelConfig(model || 'doubao-seed-1-8-251228', null);
            const agent = new AgentClass(puppPage, { modelConfig: modelCfg, waitAfterAction: 1500 });
            await agent.aiInput(step.target || step.description, step.value);
            console.log(`    → AI 回退输入: ${step.target}`);
          }
        }
        await sleep(800); break;
      }

      // ── 悬停（自愈） ──
      case 'hover': {
        const result = await healingLocate(pwPage, step, healCtx);
        if (result.tapped) {
          console.log(`    → ${result.method} 悬停（Midscene）${result.healed ? '（自愈）' : ''}`);
        } else if (result.locator) {
          await result.locator.scrollIntoViewIfNeeded({ timeout: HEAL_TIMEOUT }).catch(() => {});
          await result.locator.hover({ timeout: 10000 });
          console.log(`    → ${result.method} 悬停${result.healed ? '（自愈）' : ''}`);
        } else if (result.coordinates) {
          await pwPage.mouse.move(result.coordinates.x, result.coordinates.y);
        } else {
          if (resolvedEngine === 'mai-ui') {
            const located = await tryAiLocateMaiUi(step.target || step.description, maiuiCtx);
            if (!located?.coordinates) throw new Error('MAI-UI 回退悬停失败（无坐标）');
            await pwPage.mouse.move(located.coordinates.x, located.coordinates.y);
          } else {
            const puppPage = await getActivePage();
            const AgentClass = loadMidscene();
            const modelCfg = buildModelConfig(model || 'doubao-seed-1-8-251228', null);
            const agent = new AgentClass(puppPage, { modelConfig: modelCfg, waitAfterAction: 1500 });
            await agent.aiHover(step.target || step.description);
          }
        }
        await sleep(500); break;
      }

      // ── 双击（自愈） ──
      case 'double_click': {
        const result = await healingLocate(pwPage, step, healCtx);
        if (result.locator) {
          await result.locator.scrollIntoViewIfNeeded({ timeout: HEAL_TIMEOUT }).catch(() => {});
          await result.locator.dblclick({ timeout: 10000 });
          console.log(`    → ${result.method} 双击${result.healed ? '（自愈）' : ''}`);
        } else if (result.coordinates) {
          await pwPage.mouse.click(result.coordinates.x, result.coordinates.y, { clickCount: 2 });
          console.log(`    → ${result.method} 坐标双击 (${result.coordinates.x}, ${result.coordinates.y})${result.healed ? '（自愈）' : ''}`);
        } else if (resolvedEngine === 'mai-ui') {
          const located = await tryAiLocateMaiUi(step.target || step.description, maiuiCtx);
          if (!located?.coordinates) throw new Error('MAI-UI 回退双击失败（无坐标）');
          await pwPage.mouse.click(located.coordinates.x, located.coordinates.y, { clickCount: 2 });
          console.log(`    → MAI-UI 回退双击: ${step.target || step.description}`);
        } else {
          // best-effort: Midscene 可能不支持双击语义，降级为两次 tap
          const puppPage = await getActivePage();
          const AgentClass = loadMidscene();
          const modelCfg = buildModelConfig(model || 'doubao-seed-1-8-251228', null);
          const agent = new AgentClass(puppPage, { modelConfig: modelCfg, waitAfterAction: 800 });
          await agent.aiTap(step.target || step.description);
          await sleep(150);
          await agent.aiTap(step.target || step.description);
          console.log(`    → Midscene 回退双击（两次tap）: ${step.target || step.description}`);
        }
        await sleep(800); break;
      }

      // ── 长按（自愈） ──
      case 'long_press': {
        const pressMs = parseInt(step.value, 10) || 900;
        const result = await healingLocate(pwPage, step, healCtx);
        if (result.locator) {
          await result.locator.scrollIntoViewIfNeeded({ timeout: HEAL_TIMEOUT }).catch(() => {});
          await result.locator.click({ timeout: 10000, delay: pressMs });
          console.log(`    → ${result.method} 长按 ${pressMs}ms${result.healed ? '（自愈）' : ''}`);
        } else if (result.coordinates) {
          await pwPage.mouse.move(result.coordinates.x, result.coordinates.y);
          await pwPage.mouse.down();
          await sleep(pressMs);
          await pwPage.mouse.up();
          console.log(`    → ${result.method} 坐标长按 ${pressMs}ms (${result.coordinates.x}, ${result.coordinates.y})${result.healed ? '（自愈）' : ''}`);
        } else if (resolvedEngine === 'mai-ui') {
          const located = await tryAiLocateMaiUi(step.target || step.description, maiuiCtx);
          if (!located?.coordinates) throw new Error('MAI-UI 回退长按失败（无坐标）');
          await pwPage.mouse.move(located.coordinates.x, located.coordinates.y);
          await pwPage.mouse.down();
          await sleep(pressMs);
          await pwPage.mouse.up();
          console.log(`    → MAI-UI 回退长按: ${step.target || step.description}`);
        } else {
          const puppPage = await getActivePage();
          const AgentClass = loadMidscene();
          const modelCfg = buildModelConfig(model || 'doubao-seed-1-8-251228', null);
          const agent = new AgentClass(puppPage, { modelConfig: modelCfg, waitAfterAction: 1500 });
          await agent.aiAction(`long press ${step.target || step.description}`);
          console.log(`    → Midscene 回退长按: ${step.target || step.description}`);
        }
        await sleep(800); break;
      }

      // ── 拖拽 ──
      case 'drag': {
        let start = step.drag?.start;
        let end = step.drag?.end;
        if ((!start || !end) && step.value) {
          try {
            const parsed = JSON.parse(step.value);
            if (parsed?.start && parsed?.end) { start = parsed.start; end = parsed.end; }
          } catch (_) {}
        }
        if (!start || !end) {
          return res.status(400).json({ success: false, error: 'drag 缺少 start/end 坐标（step.drag 或 step.value JSON）' });
        }
        await pwPage.mouse.move(start.x, start.y);
        await pwPage.mouse.down();
        await pwPage.mouse.move(end.x, end.y, { steps: 12 });
        await pwPage.mouse.up();
        await sleep(800);
        break;
      }

      // ── 系统按键 ──
      case 'system_button': {
        const btn = (step.value || step.target || '').toLowerCase();
        if (btn === 'back') {
          await pwPage.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        } else if (btn === 'enter') {
          await pwPage.keyboard.press('Enter');
        } else if (btn === 'home') {
          await pwPage.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        } else if (btn === 'menu') {
          await pwPage.keyboard.press('Alt').catch(() => {});
        } else {
          console.log(`    ⚠️ 未识别 system_button: ${btn}`);
        }
        await sleep(600);
        break;
      }

      case 'plan':
      case 'locate':
      case 'done':
        return res.json({
          success: true,
          screenshot: await takePlaywrightScreenshot(pwPage),
          duration: Date.now() - t0,
          currentUrl: pwPage.url(),
          skipped: true,
          message: `"${step.action}" 是非执行步骤，已跳过`,
        });

      default: {
        const puppPage = await getActivePage();
        const AgentClass = loadMidscene();
        const modelCfg = buildModelConfig(model || 'doubao-seed-1-8-251228', null);
        const agent = new AgentClass(puppPage, { modelConfig: modelCfg, waitAfterAction: 1500 });
        await agent.aiAction(step.description || `${step.action} ${step.target || ''}`);
        await sleep(800); break;
      }
    }

    const screenshot = await takePlaywrightScreenshot(pwPage);

    // 步骤执行后同步投屏到当前活跃页面（处理新标签页场景）
    try {
      const activePage = await getActivePage();
      await switchScreencastTab(activePage.target()._targetId);
    } catch (_) {}

    res.json({
      success: true, screenshot, duration: Date.now() - t0,
      currentUrl: pwPage.url(),
      mode: modeLabel,
    });
  } catch (err) {
    let ss = null;
    try { ss = await takePlaywrightScreenshot(await getPlaywrightPage()); } catch (_) {}
    res.status(500).json({ success: false, error: err.message, duration: Date.now() - t0, screenshot: ss });
  }
});

// ─── 辅助端点 ───────────────────────────────────────────
app.get('/models', (req, res) => {
  const safe = ({ id, label, family }) => ({ id, label, family });
  res.json({
    vlModels: VL_MODELS.map(safe),
    allModels: ALL_MODELS.map(safe),
    default: process.env.MIDSCENE_MODEL_NAME || VL_MODELS[0].id,
  });
});

app.get('/status', async (req, res) => {
  let chromeOk = false, url = '';
  try { const p = await getActivePage(); chromeOk = true; url = p.url(); } catch (_) {}
  res.json({ status: 'ok', chromeConnected: chromeOk, chromeUrl: url });
});

app.get('/screenshot', async (req, res) => {
  try {
    const page = await getActivePage();
    res.json({ success: true, screenshot: await takeScreenshot(page), url: page.url() });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ─── 测试端点：验证 XPath 捕获功能 ──────────────────────
app.get('/test-xpath', async (req, res) => {
  try {
    const page = await getActivePage();
    console.log('\n🧪 测试 XPath 捕获...');

    // 1. 注入工具脚本
    await ensureXPathUtils(page);
    const injected = await page.evaluate(() => ({
      locatorUtils: !!window.__elementLocatorUtils,
      smartXPath: !!window.SmartXPathGenerator,
      getElementXPath: !!window.getElementXPath,
    }));
    console.log('  注入状态:', injected);

    // 2. 测试 getElementInfoByCoordinates（在页面中心点）
    const viewport = page.viewport() || { width: 1280, height: 720 };
    const testX = Math.round(viewport.width / 2);
    const testY = Math.round(viewport.height / 2);

    const elementInfo = await page.evaluate((x, y) => {
      if (!window.__elementLocatorUtils) return { error: '__elementLocatorUtils 不存在' };
      return window.__elementLocatorUtils.getElementInfoByCoordinates(x, y);
    }, testX, testY);

    console.log(`  坐标 (${testX},${testY}) 元素:`, elementInfo?.success ? elementInfo.value : elementInfo);

    // 3. 查看已捕获的 XPath
    const captured = await page.evaluate(() => window.__capturedXPaths || []);

    res.json({
      success: true,
      injection: injected,
      testCoords: { x: testX, y: testY },
      elementAtCenter: elementInfo,
      capturedCount: captured.length,
      capturedXPaths: captured.slice(-10),
      pageUrl: page.url(),
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message, stack: e.stack });
  }
});

// 手动点击测试：验证 Puppeteer 方法拦截能否捕获 XPath
app.post('/test-xpath-click', async (req, res) => {
  const { x, y } = req.body;
  if (!x || !y) return res.status(400).json({ error: '缺少 x, y' });

  try {
    const page = await getActivePage();
    await ensureXPathUtils(page);

    // 安装 Puppeteer 拦截钩子
    const log = [];
    const uninstall = installPuppeteerHooks(page, log);

    // 手动调用 getElementInfoByCoordinates 验证工具可用性
    const manualXPath = await page.evaluate((px, py) => {
      if (!window.__elementLocatorUtils) return { error: 'no utils' };
      try { return window.__elementLocatorUtils.getElementInfoByCoordinates(px, py); }
      catch (e) { return { error: e.message }; }
    }, x, y);

    // 通过拦截后的 page.mouse.click 点击（会自动获取 XPath）
    await page.mouse.click(x, y);
    await sleep(500);

    uninstall();
    console.log(`🧪 拦截点击 (${x},${y}) 结果:`, log);

    res.json({
      success: true,
      clickAt: { x, y },
      manualXPathResult: manualXPath,
      intercepted: log,
      message: log.length > 0
        ? `✅ 拦截成功: ${log[0].xpath} (${log[0].tagName})`
        : '❌ 拦截未捕获到 XPath（可能工具脚本未加载）',
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message, stack: e.stack });
  }
});

// ─── OCR 接口 ────────────────────────────────────────────
/**
 * POST /api/vlm-ocr/start
 * 异步启动 RapidOCR 文字识别任务
 * body: { screenshot: base64(无前缀), modelId: string, stepId?: string }
 * 返回: { taskId }
 */
app.post('/api/vlm-ocr/start', (req, res) => {
  const { screenshot, modelId, stepId } = req.body;
  if (!screenshot || !modelId) {
    return res.status(400).json({ error: 'screenshot 和 modelId 必填' });
  }
  const taskId = `ocr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  ocrTaskStore.set(taskId, { status: 'pending', stepId: stepId || null });

  (async () => {
    try {
      const cleanB64 = screenshot.replace(/^data:image\/\w+;base64,/, '');
      const text = await callOCRForText(cleanB64);
      ocrTaskStore.set(taskId, {
        status: 'done',
        text: text || '',
        stepId: stepId || null,
        engine: 'OCR',
      });
      console.log(`  🔤 OCR [${taskId}] 完成: "${(text || '').slice(0, 40)}"`);
    } catch (e) {
      ocrTaskStore.set(taskId, { status: 'error', error: e.message, stepId: stepId || null });
      console.log(`  ❌ OCR [${taskId}] 失败: ${e.message}`);
    }
  })();

  res.json({ taskId });
});

/**
 * GET /api/vlm-ocr/result/:taskId
 * 查询 OCR 任务结果
 * 返回: { status: 'pending'|'done'|'error', text?, error? }
 */
app.get('/api/vlm-ocr/result/:taskId', (req, res) => {
  const task = ocrTaskStore.get(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'task not found' });
  res.json(task);
  // 完成后 5 分钟自动清理（节省内存）
  if (task.status !== 'pending') {
    setTimeout(() => ocrTaskStore.delete(req.params.taskId), 5 * 60 * 1000);
  }
});

// ─── 启动 ───────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🤖 AI助手服务 (Midscene + Playwright)`);
  console.log(`   端口: ${PORT}  |  Chrome: ${CHROME_CDP_URL}`);
  console.log(`   POST /ai-run        → Midscene黑盒执行 (SSE流式)`);
  console.log(`   POST /execute-step  → Playwright + XPath 回放`);
  console.log(`   GET  /status        → 健康检查\n`);
  connectToChrome().catch(e => console.warn('⚠️ Puppeteer 连接失败:', e.message));
  getPlaywrightBrowser().catch(e => console.warn('⚠️ Playwright 连接失败:', e.message));
});
