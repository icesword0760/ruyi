// @ts-nocheck

export function initAiCore() {
  if ((window as any).__controllerAiCoreInitialized) return;
  (window as any).__controllerAiCoreInitialized = true;

  // Matter.js is used for the toolbar pull-rope physics (SVG path).
  // It is imported lazily when needed to keep startup light.

(function() {
        'use strict';

        // ─── 状态管理 ───────────────────────────────────────
        const aiState = {
            scriptSteps: [],          // 脚本编辑区步骤
            chatHistory: [],          // 对话历史 (role/content)
            isProcessing: false,      // 是否正在处理请求
            isExecuting: false,       // 是否正在执行步骤
            currentExecutingIndex: -1,
            savedScripts: [],         // 已保存脚本列表
            scriptEditorCollapsed: false,
            insertAfterIndex: -1,     // 插入点：-1 表示追加到末尾
            activeGapParentId: null,  // 生效 gap 所属的父逻辑步骤 id（null=顶层）
            activeGapExplicit: false, // 是否由用户显式 pin 设定（true 时不做自动覆盖）
            hoverInsertAfterIndex: -1, // 行间隙 hover 的临时插入点（不落盘）
            hoverGapParentId: null,   // hover gap 所属的父逻辑步骤 id（null=顶层）
            newStepDraft: null,       // { afterIdx: number, step: any } 新建步骤草稿（不入列表）
            selectedStepIndices: new Set<number>(),
            collapsedLogicIds: new Set<string>(),
        };

        // ─── DOM 引用 ───────────────────────────────────────
        const $ = id => document.getElementById(id);
        const dom = {
            chatMessages: null,
            chatInput: null,
            sendBtn: null,
            modelSelect: null,
            scriptSteps: null,
            scriptEmpty: null,
            scriptToolbar: null,
            scriptEditor: null,
            scriptStepsContainer: null,
            savedScriptsList: null,
        };

        function initDom() {
            dom.chatMessages = $('aiChatMessages');
            dom.chatInput = $('aiChatInput');
            dom.sendBtn = $('aiSendBtn');
            dom.modelSelect = $('aiModelSelect');
            dom.scriptSteps = $('aiScriptSteps');
            dom.scriptEmpty = $('aiScriptEmpty');
            dom.scriptToolbar = $('aiScriptToolbar');
            dom.scriptEditor = $('aiScriptEditor');
            dom.scriptStepsContainer = $('aiScriptStepsContainer');
            dom.savedScriptsList = $('aiSavedScriptsList');

            // 恢复上次选择的模型（按钮式）
            initModelBtn();
            const savedModel = localStorage.getItem('ai_model');
            if (savedModel) {
                const sel = $('aiModelSelect');
                if (sel && [...sel.options].some(o => o.value === savedModel)) {
                    sel.value = savedModel;
                }
            }
            const savedPlanningModel = localStorage.getItem('ai_planning_model');
            if (savedPlanningModel) {
                const sel = $('aiPlanningModelSelect');
                if (sel && [...sel.options].some(o => o.value === savedPlanningModel)) {
                    sel.value = savedPlanningModel;
                }
            }
            // 恢复分离模式状态
            if (localStorage.getItem('ai_split_mode') === '1') {
                const toggle = $('aiSplitModeToggle');
                if (toggle) {
                    toggle.checked = true;
                    aiToggleSplitMode(true);
                }
            }
        }

        // ─── 工具函数 ───────────────────────────────────────

        function escapeHtml(str) {
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        }

        function simplifyStepError(raw, kind = 'execute') {
            const s = (raw || '').toString().trim();
            const lc = s.toLowerCase();
            const isRegen = kind === 'regenerate';

            if (!s) {
                return isRegen
                    ? '未能重新采集定位信息，请确保页面处于目标状态后重试'
                    : '执行失败，请重试';
            }

            if (s === '已终止' || lc.includes('abort') || lc.includes('aborted')) {
                return '已终止';
            }

            if (lc.includes('timeout') || s.includes('超时')) {
                return isRegen
                    ? '重新生成超时：请确保页面未卡住、元素在当前页面可见后重试'
                    : '执行超时：请确保页面未卡住、元素在当前页面可见后重试';
            }

            if (
                lc.includes('not found') ||
                lc.includes('no node') ||
                lc.includes('failed to find') ||
                s.includes('未找到') ||
                s.includes('找不到')
            ) {
                return isRegen
                    ? '未能重新定位到该元素：请确认页面已加载完成且元素可见'
                    : '未找到目标元素：请确认页面已加载完成且元素可见';
            }

            if (lc.includes('detached') || lc.includes('execution context') || lc.includes('target closed')) {
                return isRegen
                    ? '页面状态发生变化导致重新生成失败：请刷新/回到目标页面后重试'
                    : '页面状态发生变化导致执行失败：请刷新/回到目标页面后重试';
            }

            if (lc.includes('net::') || lc.includes('network') || lc.includes('navigation')) {
                return isRegen
                    ? '页面加载异常导致重新生成失败：请检查网络/页面状态后重试'
                    : '页面加载异常导致执行失败：请检查网络/页面状态后重试';
            }

            // Default: avoid surfacing raw backend errors; keep user-level and short.
            return isRegen
                ? '重新生成失败：请确认页面处于目标状态后重试'
                : '执行失败：请确认页面状态与目标元素后重试';
        }

        function setStepFailure(step, kind, rawError) {
            try {
                step._errorKind = kind;
                step._userError = simplifyStepError(rawError, kind);
            } catch (_) {
                step._errorKind = kind;
                step._userError = kind === 'regenerate' ? '重新生成失败' : '执行失败';
            }
        }

        function clearStepFailure(step) {
            try {
                delete step._errorKind;
                delete step._userError;
                delete step._regenError;
                delete step.error;
            } catch (_) {}
        }

        // ─── Icons (no emoji in UI controls) ─────────────────
        const ICON_INNER = {
            play: `<polygon points="6 3 20 12 6 21 6 3" />`,
            save: `<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
                   <path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" />
                   <path d="M7 3v4a1 1 0 0 0 1 1h7" />`,
            trash: `<path d="M3 6h18" />
                    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                    <line x1="10" y1="11" x2="10" y2="17" />
                    <line x1="14" y1="11" x2="14" y2="17" />`,
            pencil: `<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
                     <path d="m15 5 4 4" />`,
            gripVertical: `<circle cx="9" cy="12" r="1" /><circle cx="9" cy="5" r="1" /><circle cx="9" cy="19" r="1" />
                           <circle cx="15" cy="12" r="1" /><circle cx="15" cy="5" r="1" /><circle cx="15" cy="19" r="1" />`,
            crosshair: `<circle cx="12" cy="12" r="10" />
                        <line x1="22" y1="12" x2="18" y2="12" />
                        <line x1="6" y1="12" x2="2" y2="12" />
                        <line x1="12" y1="6" x2="12" y2="2" />
                        <line x1="12" y1="22" x2="12" y2="18" />`,
            shield: `<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />`,
            code: `<polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />`,
            search: `<circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />`,
            send: `<path d="M3.714 3.048a.498.498 0 0 0-.683.627l2.843 7.627a2 2 0 0 1 0 1.396l-2.842 7.627a.498.498 0 0 0 .682.627l18-8.5a.5.5 0 0 0 0-.904z" />
                   <path d="M6 12h16" />`,
            square: `<rect width="18" height="18" x="3" y="3" rx="2" />`,
            chevronUp: `<path d="m18 15-6-6-6 6" />`,
            chevronDown: `<path d="m6 9 6 6 6-6" />`,
            chevronsUpDown: `<path d="m7 15 5 5 5-5" /><path d="m7 9 5-5 5 5" />`,
            circleDot: `<circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="1" />`,
            circleCheck: `<circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" />`,
            circleX: `<circle cx="12" cy="12" r="10" /><path d="m15 9-6 6" /><path d="m9 9 6 6" />`,
            triangleAlert: `<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
                           <path d="M12 9v4" /><path d="M12 17h.01" />`,
            loader: `<path d="M21 12a9 9 0 1 1-6.219-8.56" />`,
            clipboardPlus: `<rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
                            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                            <path d="M9 14h6" /><path d="M12 17v-6" />`,
            quote: `<path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z" />
                   <path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z" />`,
            download: `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                       <polyline points="7 10 12 15 17 10" />
                       <line x1="12" y1="15" x2="12" y2="3" />`,
            bot: `<path d="M12 8V4H8" />
                  <rect width="16" height="12" x="4" y="8" rx="2" />
                  <path d="M2 14h2" /><path d="M20 14h2" />
                  <path d="M15 13v2" /><path d="M9 13v2" />`,
            user: `<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                   <circle cx="12" cy="7" r="4" />`,
            brain: `<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
                    <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
                    <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
                    <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
                    <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
                    <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
                    <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
                    <path d="M6 18a4 4 0 0 1-1.967-.516" />
                    <path d="M19.967 17.484A4 4 0 0 1 18 18" />`,
            palette: `<circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
                      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
                      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
                      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
                      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />`,
            type: `<polyline points="4 7 4 4 20 4 20 7" />
                   <line x1="9" y1="20" x2="15" y2="20" />
                   <line x1="12" y1="4" x2="12" y2="20" />`,
            image: `<rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                    <circle cx="9" cy="9" r="2" />
                    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />`,
            ruler: `<path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z" />
                   <path d="m14.5 12.5 2-2" /><path d="m11.5 9.5 2-2" />
                   <path d="m8.5 6.5 2-2" /><path d="m17.5 15.5 2-2" />`,
            moreVertical: `<circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" />`,
            refreshCw: `<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M3 21v-5h5" />`,
            plus: `<path d="M12 5v14" /><path d="M5 12h14" />`,
        };

        function iconSvg(name, className = 'ctl-icon') {
            const inner = ICON_INNER[name];
            if (!inner) return '';
            return `<svg class="${className}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                aria-hidden="true" focusable="false">${inner}</svg>`;
        }

        function generateId() {
            return `${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        }

        function formatDuration(ms) {
            if (ms < 1000) return `${ms}ms`;
            return `${(ms / 1000).toFixed(2)}s`;
        }

        function getActionLabel(action) {
            const labels = {
                click: '点击', input: '输入', navigate: '导航',
                scroll: '滚动', select: '选择', hover: '悬停',
                wait: '等待', keypress: '按键', plan: '规划',
                locate: '定位', assert: '断言', action: '操作',
                done: '完成',
                double_click: '双击',
                long_press: '长按',
                drag: '拖拽',
                system_button: '系统键',
            };
            return labels[action] || action;
        }

        function getLogicLabel(logicType) {
            const labels = { if: 'IF', else_if: 'ELIF', else: 'ELSE' };
            return labels[logicType] || logicType;
        }

        // ─── 逻辑组（logicGroupId）工具集 ───────────────────

        function generateGroupId() { return `lg_${generateId()}`; }

        /**
         * 获取同一父级下的同级步骤列表（可选排除某个索引）。
         * 返回 [{ step, idx }]，按 idx 升序。
         */
        function getSiblings(parentId, excludeIdx?) {
            const steps = aiState.scriptSteps || [];
            parentId = parentId || null;
            const out = [];
            steps.forEach((s, i) => {
                if (i === excludeIdx) return;
                if ((s.parentId || null) === parentId) out.push({ step: s, idx: i });
            });
            return out;
        }

        /**
         * 从 siblings 列表中，找到给定 siblingPos 所在的逻辑组边界。
         * 逻辑组定义：从某个 if 开始，连续的 else_if/else（中间不能有非 logic 步骤）。
         * @returns { start, end } 在 siblings 数组中的索引（包含），若不在逻辑组中返回 null
         */
        function findLogicGroupBounds(siblings, siblingPos) {
            const sib = siblings[siblingPos];
            if (!sib || sib.step.stepType !== 'logic') return null;

            // 向前找逻辑组起始（必须到 if）
            let start = siblingPos;
            while (start > 0) {
                const prev = siblings[start - 1];
                if (prev.step.stepType !== 'logic') break;
                start--;
                if (prev.step.logicType === 'if') break; // if 是起点
            }
            // 校验：逻辑组起始必须是 if
            if (siblings[start].step.logicType !== 'if') return null;

            // 向后找逻辑组结束
            let end = start;
            for (let i = start + 1; i < siblings.length; i++) {
                const cur = siblings[i];
                if (cur.step.stepType !== 'logic') break;
                if (cur.step.logicType === 'if') break; // 新的 if 开始新组
                end = i;
            }
            return { start, end };
        }

        /**
         * 对所有步骤重新计算并分配 logicGroupId。
         * 同一逻辑组（if → else_if* → else?）共享同一个 groupId。
         * 不属于任何逻辑组的步骤 logicGroupId 设为 undefined。
         */
        function recomputeAllLogicGroupIds() {
            const steps = aiState.scriptSteps || [];
            // 按 parentId 分组
            const byParent = {};
            steps.forEach((s, i) => {
                const pid = s.parentId || '__root__';
                if (!byParent[pid]) byParent[pid] = [];
                byParent[pid].push(i);
            });
            // 对每组同级步骤，扫描连续的逻辑链
            Object.values(byParent).forEach((indices: number[]) => {
                let currentGroupId = null;
                let expectingContinuation = false; // 上一个是 if/else_if，后续可接 else_if/else
                for (const i of indices) {
                    const s = steps[i];
                    if (s.stepType === 'logic') {
                        if (s.logicType === 'if') {
                            currentGroupId = generateGroupId();
                            s.logicGroupId = currentGroupId;
                            expectingContinuation = true;
                        } else if ((s.logicType === 'else_if' || s.logicType === 'else') && expectingContinuation) {
                            s.logicGroupId = currentGroupId;
                            expectingContinuation = s.logicType !== 'else'; // else 后不再接续
                        } else {
                            // 孤立的 else_if/else（前方无 if），清除 groupId
                            delete s.logicGroupId;
                            currentGroupId = null;
                            expectingContinuation = false;
                        }
                    } else {
                        // 非逻辑步骤打断逻辑链
                        delete s.logicGroupId;
                        currentGroupId = null;
                        expectingContinuation = false;
                    }
                }
            });
        }

        /**
         * 获取与指定步骤属于同一逻辑组的所有步骤索引。
         */
        function getLogicGroupIndices(stepIdx) {
            const step = (aiState.scriptSteps || [])[stepIdx];
            if (!step?.logicGroupId) return [stepIdx];
            const gid = step.logicGroupId;
            const out = [];
            (aiState.scriptSteps || []).forEach((s, i) => {
                if (s.logicGroupId === gid) out.push(i);
            });
            return out;
        }

        /**
         * 校验在给定插入位置，各 logicType 是否允许。
         * 完整考虑：向前、向后扫描 + 同组 else 重复检测。
         * @param afterIdx  插入在此索引之后（-1 表示追加到末尾）
         * @param parentId  父逻辑步骤 id（null=顶层）
         * @param editIdx   正在编辑的步骤索引（-1=新建，>=0=编辑已有步骤）
         * @returns { if: { ok, reason }, else_if: { ok, reason }, else: { ok, reason } }
         */
        function validateLogicTypeAtPosition(afterIdx, parentId, editIdx) {
            const siblings = getSiblings(parentId, editIdx >= 0 ? editIdx : undefined);

            let insertPos = siblings.length;
            for (let i = 0; i < siblings.length; i++) {
                if (siblings[i].idx > afterIdx) { insertPos = i; break; }
            }

            const prev = insertPos > 0 ? siblings[insertPos - 1] : null;
            const next = insertPos < siblings.length ? siblings[insertPos] : null;

            const prevIsLogic = prev?.step.stepType === 'logic';
            const prevLogicType = prevIsLogic ? prev.step.logicType : null;
            const nextIsLogic = next?.step.stepType === 'logic';
            const nextLogicType = nextIsLogic ? next.step.logicType : null;

            // ── if ──
            // if 始终可插入（开启新逻辑组），但如果后面紧跟 else_if/else，
            // 新 if 会"吸收"它们到自己的组（语义改变），需要警告
            let ifResult;
            if (nextIsLogic && (nextLogicType === 'else_if' || nextLogicType === 'else')) {
                ifResult = { ok: true, reason: '', warn: '后方的 ' + (nextLogicType === 'else_if' ? 'else if' : 'else') + ' 将归属到此新 if 的逻辑组' };
            } else {
                ifResult = { ok: true, reason: '' };
            }

            // ── else_if ──
            let elseIfResult;
            if (!prevIsLogic || !(prevLogicType === 'if' || prevLogicType === 'else_if')) {
                elseIfResult = { ok: false, reason: '前方没有 if / else if，else if 必须紧跟其后' };
            } else {
                elseIfResult = { ok: true, reason: '' };
            }

            // ── else ──
            let elseResult;
            if (!prevIsLogic || !(prevLogicType === 'if' || prevLogicType === 'else_if')) {
                elseResult = { ok: false, reason: '前方没有 if / else if，else 必须紧跟其后' };
            } else {
                // 向前 + 向后扫描同一逻辑组，检查是否已有 else
                let hasExistingElse = false;
                // 向前：从 insertPos-1 回溯到 if（逻辑组起点）
                for (let i = insertPos - 1; i >= 0; i--) {
                    const sib = siblings[i];
                    if (sib.step.stepType !== 'logic') break;
                    if (sib.step.logicType === 'else') { hasExistingElse = true; break; }
                    if (sib.step.logicType === 'if') break;
                }
                // 向后：从 insertPos 向后扫描同一逻辑组（不能遇到 if 或非 logic）
                if (!hasExistingElse) {
                    for (let i = insertPos; i < siblings.length; i++) {
                        const sib = siblings[i];
                        if (sib.step.stepType !== 'logic') break;
                        if (sib.step.logicType === 'if') break;
                        if (sib.step.logicType === 'else') { hasExistingElse = true; break; }
                    }
                }
                if (hasExistingElse) {
                    elseResult = { ok: false, reason: '该逻辑组中已存在 else' };
                } else {
                    elseResult = { ok: true, reason: '' };
                }
            }

            return { if: ifResult, else_if: elseIfResult, else: elseResult };
        }

        /**
         * 校验在给定位置插入非逻辑步骤（action/loop）是否会打断已有逻辑链。
         * @returns { ok: boolean, reason: string, affectedGroupIndices: number[] }
         */
        function validateNonLogicInsertAt(afterIdx, parentId) {
            const siblings = getSiblings(parentId);

            let insertPos = siblings.length;
            for (let i = 0; i < siblings.length; i++) {
                if (siblings[i].idx > afterIdx) { insertPos = i; break; }
            }

            const prev = insertPos > 0 ? siblings[insertPos - 1] : null;
            const next = insertPos < siblings.length ? siblings[insertPos] : null;

            // 前方是 if/else_if 且后方是 else_if/else → 插入普通步骤会打断逻辑链
            // 不完全依赖 logicGroupId：结构上连续的 if→else_if/else 即视为同组
            if (prev?.step.stepType === 'logic' && next?.step.stepType === 'logic') {
                const pl = prev.step.logicType;
                const nl = next.step.logicType;
                if ((pl === 'if' || pl === 'else_if') && (nl === 'else_if' || nl === 'else')) {
                    const sameGroup = (prev.step.logicGroupId && prev.step.logicGroupId === next.step.logicGroupId)
                        || !prev.step.logicGroupId; // groupId 未计算时，结构连续即视为同组
                    if (sameGroup) {
                        const groupIndices = prev.step.logicGroupId
                            ? getLogicGroupIndices(prev.idx)
                            : [prev.idx, next.idx];
                        return {
                            ok: false,
                            reason: `此处插入会打断 if/else 逻辑组（步骤 ${groupIndices.map(i => '#' + (i + 1)).join(', ')}）`,
                            affectedGroupIndices: groupIndices,
                        };
                    }
                }
            }
            return { ok: true, reason: '', affectedGroupIndices: [] };
        }

        /**
         * 校验将步骤从 logic 改为 action/loop 是否会破坏逻辑链。
         * @param idx  步骤索引
         * @returns { ok, reason, affectedGroupIndices }
         */
        function validateTypeChangeFromLogic(idx) {
            const step = (aiState.scriptSteps || [])[idx];
            if (!step || step.stepType !== 'logic') return { ok: true, reason: '' };

            const parentId = step.parentId || null;
            const siblings = getSiblings(parentId);
            const sibPos = siblings.findIndex(s => s.idx === idx);
            if (sibPos < 0) return { ok: true, reason: '' };

            const next = sibPos + 1 < siblings.length ? siblings[sibPos + 1] : null;
            const prev = sibPos > 0 ? siblings[sibPos - 1] : null;

            // 如果后方紧跟 else_if/else，移除此步骤的逻辑身份会让它们孤立
            if (next?.step.stepType === 'logic' && (next.step.logicType === 'else_if' || next.step.logicType === 'else')) {
                const sameGroup = (step.logicGroupId && next.step.logicGroupId === step.logicGroupId)
                    || (step.logicType === 'if' || step.logicType === 'else_if');
                if (sameGroup) {
                    return {
                        ok: false,
                        reason: `后方有 ${getLogicLabel(next.step.logicType)} 依赖此步骤，改变类型会破坏逻辑组`,
                    };
                }
            }

            // 如果此步骤是逻辑组中间的 else_if，后方还有同组成员，打断链
            if (step.logicType === 'else_if' && next?.step.stepType === 'logic') {
                const nl = next.step.logicType;
                if (nl === 'else_if' || nl === 'else') {
                    return {
                        ok: false,
                        reason: `此 else if 是逻辑组的一部分，改变类型会打断逻辑链`,
                    };
                }
            }

            return { ok: true, reason: '' };
        }

        /**
         * 校验删除步骤是否会破坏逻辑组完整性。
         * @param idx 步骤索引
         * @returns { ok, reason, groupIndices, cascadeWarning }
         */
        function validateDeleteStep(idx) {
            const steps = aiState.scriptSteps || [];
            const step = steps[idx];
            if (!step) return { ok: true, reason: '', groupIndices: [], cascadeWarning: '' };

            // 非逻辑步骤可直接删除
            if (step.stepType !== 'logic') return { ok: true, reason: '', groupIndices: [], cascadeWarning: '' };

            const parentId = step.parentId || null;
            const siblings = getSiblings(parentId);
            const sibPos = siblings.findIndex(s => s.idx === idx);
            if (sibPos < 0) return { ok: true, reason: '', groupIndices: [], cascadeWarning: '' };

            const groupIndices = getLogicGroupIndices(idx);

            // 逻辑步骤有子步骤时：整体删除（含子步骤）
            // 逻辑步骤是逻辑组的一部分时，需要提示影响

            const prev = sibPos > 0 ? siblings[sibPos - 1] : null;
            const next = sibPos + 1 < siblings.length ? siblings[sibPos + 1] : null;
            const isGroupStart = step.logicType === 'if';
            // 判断是否组尾：else 一定是尾部；或者后面不是同组的 else_if/else
            const nextIsSameGroup = next?.step.stepType === 'logic'
                && next.step.logicType !== 'if'
                && (next.step.logicGroupId === step.logicGroupId || !step.logicGroupId);
            const isGroupEnd = step.logicType === 'else' || !nextIsSameGroup;
            const isGroupMiddle = !isGroupStart && !isGroupEnd;

            // 如果是 IF 头部且后方直接跟着 else_if/else，则需级联删除
            const hasFollowers = isGroupStart && next?.step.stepType === 'logic'
                && (next.step.logicType === 'else_if' || next.step.logicType === 'else');
            if (isGroupStart && (groupIndices.length > 1 || hasFollowers)) {
                const grpDisplay = groupIndices.length > 1
                    ? groupIndices.slice(1).map(i => getLogicLabel(steps[i].logicType)).join('→')
                    : getLogicLabel(next.step.logicType);
                return {
                    ok: false,
                    reason: `删除此 IF 将导致后续逻辑步骤（${grpDisplay}）失去起始 IF`,
                    groupIndices: groupIndices.length > 1 ? groupIndices : [idx, next.idx],
                    cascadeWarning: '建议删除整个逻辑组',
                };
            }

            if (isGroupMiddle) {
                // 删除逻辑组中间的 else_if：后面的 else_if/else 能否"接上"前面？
                // 只有当 prev 仍然是同组的 if/else_if 时，后面的才能接上
                // 删除中间节点后，前后仍然连续，所以语法上没问题
                return { ok: true, reason: '', groupIndices, cascadeWarning: '' };
            }

            // else（尾部）或单独的 if：可安全删除
            return { ok: true, reason: '', groupIndices, cascadeWarning: '' };
        }

        // 条件判断类型
        const CONDITION_TYPES = [
            { v: 'element_exists',      l: '元素存在' },
            { v: 'element_attr',        l: '元素属性符合预期' },
            { v: 'cond_element_exists',  l: '条件判断元素存在' },
            { v: 'cond_element_attr',    l: '条件判断元素属性符合预期' },
        ];

        const CONDITION_OPERATORS = [
            { v: '==', l: '等于' }, { v: '!=', l: '不等于' },
            { v: 'contains', l: '包含' }, { v: 'not_contains', l: '不包含' },
            { v: 'starts_with', l: '开头是' }, { v: 'ends_with', l: '结尾是' },
        ];

        function buildConditionPanelHTML(cond, condIdx) {
            const typeOpts = CONDITION_TYPES.map(t =>
                `<option value="${t.v}" ${cond.type === t.v ? 'selected' : ''}>${t.l}</option>`
            ).join('');
            const needsAttr = cond.type === 'element_attr' || cond.type === 'cond_element_attr';
            const opOpts = CONDITION_OPERATORS.map(o =>
                `<option value="${o.v}" ${cond.operator === o.v ? 'selected' : ''}>${o.l}</option>`
            ).join('');
            return `
                <div class="logic-cond-panel" data-cond-idx="${condIdx}">
                    <div class="edit-field">
                        <label>条件类型</label>
                        <select class="logic-cond-type" data-cond-field="type" data-cond-idx="${condIdx}"
                            onchange="aiLogicCondTypeChanged(${condIdx})">${typeOpts}</select>
                    </div>
                    <div class="edit-field">
                        <label>目标元素</label>
                        <input class="logic-cond-input" data-cond-field="target" data-cond-idx="${condIdx}"
                            placeholder="目标元素描述" value="${escapeHtml(cond.target || '')}">
                    </div>
                    <div class="edit-field logic-cond-attr-group" data-cond-attr-group="${condIdx}" style="${needsAttr ? '' : 'display:none'}">
                        <label>属性匹配</label>
                        <div class="logic-cond-attr-row">
                            <input class="logic-cond-input" data-cond-field="attribute" data-cond-idx="${condIdx}"
                                placeholder="属性名" value="${escapeHtml(cond.attribute || '')}">
                            <select class="logic-cond-op" data-cond-field="operator" data-cond-idx="${condIdx}">${opOpts}</select>
                            <input class="logic-cond-input" data-cond-field="value" data-cond-idx="${condIdx}"
                                placeholder="预期值" value="${escapeHtml(cond.value || '')}">
                        </div>
                    </div>
                </div>`;
        }

        function buildConditionTabLabel(cond, condIdx, total) {
            const label = condIdx === 0 ? '条件' : (cond.connector === 'or' ? 'OR' : 'AND');
            const closable = total > 1;
            return `<button class="logic-cond-tab" type="button" data-cond-tab="${condIdx}"
                        onclick="aiLogicSwitchCondTab(${condIdx})"
                        title="${label}">
                        <span class="logic-cond-tab-label">${label}</span>
                        ${closable ? `<span class="logic-cond-tab-close" onclick="event.stopPropagation(); aiLogicRemoveCondition(${condIdx})" title="移除">&times;</span>` : ''}
                    </button>`;
        }

        function buildLogicPanelHTML(step, logicValidation) {
            const conditions = step.conditions && step.conditions.length > 0
                ? step.conditions
                : [{ type: 'element_exists', target: '', connector: 'and' }];
            const logicType = step.logicType || 'if';
            const isElse = logicType === 'else';

            const lv = logicValidation || { if: { ok: true }, else_if: { ok: true }, else: { ok: true } };
            const logicTypeOpts = [
                { v: 'if', l: 'if' }, { v: 'else_if', l: 'else if' }, { v: 'else', l: 'else' },
            ].map(o => {
                const vr = lv[o.v] || { ok: true };
                const dis = !vr.ok ? `disabled title="${escapeHtml(vr.reason || '')}"` : '';
                const warnTitle = (vr.ok && vr.warn) ? `title="${escapeHtml(vr.warn)}"` : '';
                const suffix = !vr.ok ? ' ⛔' : (vr.warn ? ' ⚠️' : '');
                return `<option value="${o.v}" ${logicType === o.v ? 'selected' : ''} ${dis} ${warnTitle}>${o.l}${suffix}</option>`;
            }).join('');

            const tabsHTML = isElse ? '' : conditions.map((c, i) => buildConditionTabLabel(c, i, conditions.length)).join('');
            const panelsHTML = isElse
                ? '<div class="logic-cond-empty">else 无需条件，将匹配所有未命中的情况</div>'
                : conditions.map((c, i) => buildConditionPanelHTML(c, i)).join('');

            return `
                <div class="logic-panel" id="logicPanel">
                    <div class="edit-field">
                        <label>逻辑类型</label>
                        <select id="logicTypeSelect" onchange="aiLogicTypeChanged()">${logicTypeOpts}</select>
                    </div>
                    <div class="edit-field" id="logicConditionsWrap" style="${isElse ? 'display:none' : ''}">
                        <div class="logic-cond-header">
                            <label>条件</label>
                            <div class="logic-cond-add-wrap">
                                <button class="logic-cond-add-btn" type="button" onclick="aiLogicShowAddMenu(this)"
                                    title="添加条件">${iconSvg('plus', 'ctl-icon ctl-icon--xs')}</button>
                                <div class="logic-cond-add-menu" id="logicCondAddMenu">
                                    <button type="button" onclick="aiLogicAddCondition('and')">AND（且）</button>
                                    <button type="button" onclick="aiLogicAddCondition('or')">OR（或）</button>
                                </div>
                            </div>
                        </div>
                        <div class="logic-cond-tabs" id="logicCondTabs">${tabsHTML}</div>
                        <div class="logic-cond-panels" id="logicConditionsContainer">${panelsHTML}</div>
                    </div>
                </div>`;
        }

        // ─── AI Engine (Midscene / MAI-UI) ─────────────────
        function getAiEngine() {
            const raw = (localStorage.getItem('ai_engine') || '').toLowerCase();
            if (raw === 'mai-ui' || raw === 'maiui' || raw === 'mai_ui' || raw === 'mai') return 'mai-ui';
            return 'midscene';
        }

        function isMidsceneEnabled() {
            return localStorage.getItem('midscene_enabled') !== '0';
        }

        function isMaiUiEnabled() {
            return localStorage.getItem('maiui_enabled') === '1';
        }

        function getCurrentAiModel(engine) {
            if (engine === 'mai-ui') {
                return localStorage.getItem('maiui_model') || 'mai-ui-8b@q8_0';
            }
            return document.getElementById('aiModelSelect')?.value || '';
        }

        // ─── 脚本编辑区 ─────────────────────────────────────

        function renderScriptSteps() {
            if (!dom.scriptSteps) return;
            const steps = aiState.scriptSteps;
            const hasSteps = steps.length > 0;

            // 同步步数徽章
            const badge = document.getElementById('aiScriptCountBadge');
            if (badge) {
                badge.style.display = hasSteps ? '' : 'none';
                badge.textContent = `${steps.length}步`;
            }
            // 同步标题行按钮禁用状态（删除按钮由 syncDeleteBtnState 单独管理）
            ['aiHeaderRunBtn','aiHeaderSaveBtn','aiActionRunBtn'].forEach(id => {
                const btn = document.getElementById(id) as HTMLButtonElement | null;
                if (btn) btn.disabled = !hasSteps;
            });
            const actionRunBtn = document.getElementById('aiActionRunBtn');
            if (actionRunBtn) actionRunBtn.classList.toggle('has-steps', hasSteps);

            if (!hasSteps) {
                // 没有任何步骤时：仅保留一个“实新增按钮行”（选中后的样式），便于快速创建第一步
                dom.scriptSteps.innerHTML = `
                    <div class="ai-step-gap is-active is-empty" data-after-idx="-1">
                        <button class="ai-step-insert-btn ctl-focus-ring is-solid" type="button"
                            onclick="event.stopPropagation(); aiOpenNewStepEditor(-1)"
                            title="新增步骤" aria-label="新增步骤">${iconSvg('plus', 'ctl-icon ctl-icon--sm')}</button>
                    </div>
                `;
                aiState.selectedStepIndices.clear();
                syncDeleteBtnState();
                dom.scriptEmpty.style.display = 'none';
                if (dom.scriptToolbar) dom.scriptToolbar.style.display = 'none';
                return;
            }

            dom.scriptEmpty.style.display = 'none';
            if (dom.scriptToolbar) dom.scriptToolbar.style.display = 'flex';

            // 生效行：默认最后一行；若用户点击过行间隙“虚按钮”，则由 insertAfterIndex 决定
            const hasPinnedRow =
                aiState.insertAfterIndex >= 0 && aiState.insertAfterIndex < steps.length;
            const activeIdx = hasPinnedRow ? aiState.insertAfterIndex : steps.length - 1;
            const hoverIdx = aiState.hoverInsertAfterIndex;

            // 生效 gap 的 parentId：逻辑步骤默认进入体内（除非用户显式 pin 到体外）
            let activeGapPid = aiState.activeGapParentId || null;
            const activeStep = steps[activeIdx];
            if (!aiState.activeGapExplicit && activeStep && activeStep.stepType === 'logic' && !activeGapPid) {
                activeGapPid = activeStep.id;
            }
            const hoverGapPid = aiState.hoverGapParentId || null;

            function isGapActive(gapIdx, gapParentId) {
                return gapIdx === activeIdx && (gapParentId || null) === activeGapPid;
            }
            function isGapHover(gapIdx, gapParentId) {
                if (hoverIdx < 0 || hoverIdx >= steps.length) return false;
                return hoverIdx === gapIdx && (hoverGapPid || null) === (gapParentId || null);
            }

            // ── 构建单个步骤卡片 HTML ──
            function buildStepCardHTML(step, idx, isActiveRow, isHoverRow) {
                const clickToEdit = `onclick="aiOpenStepEditor(${idx})" title="点击编辑"`;
                const isRegenerating = !!step._regenerating;
                const regenCls = isRegenerating ? 'regenerating' : '';
                const regenDisabledAttr = isRegenerating ? 'disabled aria-disabled="true"' : '';
                const failKind = step._errorKind || (step._regenError ? 'regenerate' : step.status === 'error' ? 'execute' : '');
                const failRaw = step._regenError || step.error || '';
                const failMsg = step._userError || (failRaw ? simplifyStepError(failRaw, failKind) : '');
                const failTitle = failMsg ? `${failKind === 'regenerate' ? '重新生成失败' : '执行失败'}：${failMsg}` : '';
                const failIcon = failTitle
                    ? `<span class="ai-step-fail-icon" title="${escapeHtml(failTitle)}" aria-label="${escapeHtml(failTitle)}">${iconSvg('triangleAlert', 'ctl-icon ctl-icon--sm')}</span>`
                    : '';
                const isLogicStep = step.stepType === 'logic';
                const isLoopStep = step.stepType === 'loop';
                let targetDisplay;
                if (isLogicStep) {
                    const condSummary = step.logicType === 'else'
                        ? ''
                        : (step.conditions || []).map(c => {
                            const tLabel = CONDITION_TYPES.find(t => t.v === c.type)?.l || c.type;
                            let desc = `${tLabel}「${c.target || '?'}」`;
                            if (c.type === 'element_attr' || c.type === 'cond_element_attr') {
                                const opLabel = CONDITION_OPERATORS.find(o => o.v === c.operator)?.l || c.operator;
                                desc += ` ${c.attribute || '?'} ${opLabel} "${c.value || ''}"`;
                            }
                            return desc;
                          }).join(` ${(step.conditions?.[0]?.connector === 'or' ? '或' : '且')} `);
                    targetDisplay = `
                        <div class="ai-step-text ai-step-text--logic" ${clickToEdit}>
                            <span class="ai-step-logic-cond">${escapeHtml(condSummary)}</span>
                        </div>`;
                } else if (isLoopStep) {
                    targetDisplay = `<div class="ai-step-text" ${clickToEdit}><span class="ai-step-target">循环</span></div>`;
                } else if (step.action === 'input') {
                    const tgt = step.target || step.description || '';
                    targetDisplay = `
                        <div class="ai-step-text" ${clickToEdit}>
                            ${tgt ? `<span class="ai-step-target">${escapeHtml(tgt)}</span><span class="ai-step-arrow">→</span>` : ''}
                            <span class="ai-step-value">"${escapeHtml(step.value || '')}"</span>
                        </div>
                    `;
                } else if (step.action === 'navigate') {
                    targetDisplay = `
                        <div class="ai-step-text" ${clickToEdit}>
                            <span class="ai-step-value ai-step-value--nav">${escapeHtml(step.value || step.target || '')}</span>
                        </div>
                    `;
                } else {
                    targetDisplay = `
                        <div class="ai-step-text" ${clickToEdit}>
                            <span class="ai-step-target">${escapeHtml(step.target || step.description || '')}</span>
                        </div>
                    `;
                }

                const isCollapsed = isLogicStep && aiState.collapsedLogicIds.has(step.id);
                const collapseBtn = isLogicStep
                    ? `<button class="ai-logic-collapse-btn${isCollapsed ? '' : ' is-expanded'}" type="button" onclick="event.stopPropagation(); aiToggleLogicCollapse('${step.id}')" title="${isCollapsed ? '展开' : '收起'}" aria-label="${isCollapsed ? '展开' : '收起'}">&#9654;</button>`
                    : '';
                const groupHover = (isLogicStep && step.logicGroupId)
                    ? `onmouseenter="aiHighlightLogicGroup('${step.logicGroupId}')" onmouseleave="aiClearLogicGroupHighlight()"`
                    : '';
                const stepTag = isLogicStep
                    ? `<span class="ai-step-action-tag logic-${step.logicType} ai-step-run-tag" onclick="event.stopPropagation(); aiExecuteSingleStep(${idx})" ${groupHover} title="点击执行 · 悬停查看逻辑组">${getLogicLabel(step.logicType)}</span>${collapseBtn}`
                    : isLoopStep
                    ? `<span class="ai-step-action-tag loop ai-step-run-tag" onclick="event.stopPropagation(); aiExecuteSingleStep(${idx})" title="点击执行此步骤">LOOP</span>`
                    : `<span class="ai-step-action-tag ${step.action} ai-step-run-tag" onclick="event.stopPropagation(); aiExecuteSingleStep(${idx})" title="点击执行此步骤">${getActionLabel(step.action)}</span>`;

                const isSelected = aiState.selectedStepIndices.has(idx);
                const groupAttr = step.logicGroupId ? `data-logic-group="${step.logicGroupId}"` : '';
                return `
                    <div class="ai-step-card ${step.status || ''} ${regenCls} ${isActiveRow ? 'active-insert-row' : ''} ${isSelected ? 'selected' : ''}" data-step-idx="${idx}" ${groupAttr} draggable="true">
                        <span class="ai-step-drag-handle" title="拖拽排序">${iconSvg('gripVertical', 'ctl-icon ctl-icon--sm')}</span>
                        ${stepTag}
                        <div class="ai-step-main">${targetDisplay}</div>
                        ${failIcon}
                        <span class="ai-step-sel ${isSelected ? 'checked' : ''}" onclick="event.stopPropagation(); aiToggleStepSelect(${idx})" title="选中/取消选中"></span>
                        <div class="ai-step-more">
                            <button class="ai-step-icon-btn ai-step-more-btn" type="button" onclick="event.stopPropagation(); aiToggleStepMenu(this)" title="更多操作" aria-label="更多操作">${iconSvg('moreVertical', 'ctl-icon ctl-icon--sm')}</button>
                            <div class="ai-step-menu">
                                <button class="ai-step-menu-item" type="button" ${regenDisabledAttr} onclick="aiExecuteSingleStep(${idx}); aiCloseStepMenus();">${iconSvg('play', 'ctl-icon ctl-icon--sm')} 执行</button>
                                <button class="ai-step-menu-item" type="button" ${regenDisabledAttr} onclick="aiExecuteFromHere(${idx}); aiCloseStepMenus();">${iconSvg('play', 'ctl-icon ctl-icon--sm')} 从此处执行</button>
                                <button class="ai-step-menu-item" type="button" ${regenDisabledAttr} onclick="aiRegenerateStep(${idx}); aiCloseStepMenus();">${iconSvg('refreshCw', 'ctl-icon ctl-icon--sm')} 重新生成</button>
                                <button class="ai-step-menu-item ai-step-menu-item--danger" type="button" ${regenDisabledAttr} onclick="aiRemoveStep(${idx}); aiCloseStepMenus();">${iconSvg('trash', 'ctl-icon ctl-icon--sm')} 删除</button>
                            </div>
                        </div>
                    </div>`;
            }

            // ── 构建行间隙 HTML ──
            // parentId: 如果 gap 在逻辑体内，传入父步骤的 id，点击实按钮时新增子步骤
            // treeDepth: 在逻辑体内时，绘制竖线贯通的层数
            function buildGapHTML(idx, isActive, isHover, parentId, treeDepth) {
                const pidArg = parentId ? `'${parentId}'` : 'null';
                const addTarget = parentId
                    ? `aiOpenNewChildStepEditor('${parentId}', ${idx})`
                    : `aiOpenNewStepEditor(${idx})`;
                const pinTarget = `aiPinInsertAfter(${idx}, ${pidArg})`;
                let treeLinesHTML = '';
                if (treeDepth > 0) {
                    for (let d = 0; d < treeDepth; d++) {
                        const rp = 4 + d * 10;
                        treeLinesHTML += `<span class="ai-tree-vline tree-depth-${treeDepth - 1 - d}" style="right:${rp}px"></span>`;
                    }
                }
                return `
                    <div class="ai-step-gap ${isActive ? 'is-active' : ''}"
                         data-after-idx="${idx}"
                         onmouseenter="aiSetHoverInsertAfter(${idx}, ${pidArg})"
                         onmouseleave="aiClearHoverInsertAfter(${idx}, ${pidArg})">
                      ${treeLinesHTML}
                      ${isActive ? `
                        <button class="ai-step-insert-btn ctl-focus-ring is-solid" type="button"
                            onclick="event.stopPropagation(); ${addTarget}"
                            title="新增步骤" aria-label="新增步骤">${iconSvg('plus', 'ctl-icon ctl-icon--sm')}</button>
                      ` : `
                        <button class="ai-step-insert-btn ctl-focus-ring is-ghost" type="button"
                            onclick="event.stopPropagation(); ${pinTarget}"
                            title="新增步骤" aria-label="新增步骤">${iconSvg('plus', 'ctl-icon ctl-icon--sm')}</button>
                      `}
                    </div>`;
            }

            // ── 收集子步骤映射 ──
            const childrenOf = {};  // parentId → [childIdx, ...]
            steps.forEach((s, i) => {
                if (s.parentId) {
                    if (!childrenOf[s.parentId]) childrenOf[s.parentId] = [];
                    childrenOf[s.parentId].push(i);
                }
            });

            // 计算每个步骤的嵌套深度（用于树线数量）
            function getDepth(step) {
                let d = 0, cur = step;
                while (cur.parentId) {
                    d++;
                    cur = steps.find(s => s.id === cur.parentId) || {};
                }
                return d;
            }

            // 判断某步骤是否在某个逻辑块的最后一个后代（含嵌套子孙）
            function isLastDescendant(stepIdx, logicStepId) {
                const kids = childrenOf[logicStepId] || [];
                if (kids.length === 0) return false;
                const lastKid = kids[kids.length - 1];
                const lastKidStep = steps[lastKid];
                if (lastKidStep && (lastKidStep.stepType === 'logic' || lastKidStep.stepType === 'loop')) {
                    const grandKids = childrenOf[lastKidStep.id] || [];
                    if (grandKids.length > 0) return isLastDescendant(stepIdx, lastKidStep.id);
                }
                return stepIdx === lastKid;
            }

            // 构建树线叠加层：右侧竖线表示嵌套层级
            function buildTreeLinesHTML(step, idx) {
                const depth = getDepth(step);
                if (depth === 0) return '';
                let lines = '';
                let cur = step;
                for (let d = depth; d >= 1; d--) {
                    const parentStep = steps.find(s => s.id === cur.parentId);
                    if (!parentStep) break;
                    const isLast = isLastDescendant(idx, parentStep.id);
                    const rightPos = 4 + (depth - d) * 10;
                    if (!isLast) {
                        lines += `<span class="ai-tree-vline tree-depth-${d - 1}" style="right:${rightPos}px"></span>`;
                    } else if (d === depth) {
                        lines += `<span class="ai-tree-vline ai-tree-vline--last tree-depth-${d - 1}" style="right:${rightPos}px"></span>`;
                    }
                    cur = parentStep;
                }
                return lines;
            }

            // ── 递归渲染步骤 ──
            function renderStepAndChildren(step, idx, isGroupContinuation?, groupDepthOverride?, isGroupStart?, hasNextInGroup?) {
                const isActiveRow = idx === activeIdx;
                const isLogicStep = step.stepType === 'logic';
                const children = childrenOf[step.id] || [];
                const depth = getDepth(step);
                const treeLines = buildTreeLinesHTML(step, idx);
                const depthCls = depth > 0 ? ` ai-step-depth-${Math.min(depth, 3)}` : '';
                const bodyTreeDepth = depth + 1;

                let out = '';

                if (isLogicStep) {
                    const hasKids = children.length > 0;
                    const isCollapsed = aiState.collapsedLogicIds.has(step.id);
                    const bodyGapActive = isGapActive(idx, step.id);
                    // 仅在已有子步骤或插入点被明确激活时，才通过重渲染进入面板态。
                    // 空逻辑体的 hover 预览改为纯 DOM class，避免 hover -> render -> leave 闪烁。
                    const showPanel = !isCollapsed && (hasKids || bodyGapActive);
                    const groupContCls = isGroupContinuation ? ' logic-group-continuation' : (isGroupStart ? ' logic-group-start' : '');
                    const groupShellCls = (isGroupContinuation || hasNextInGroup) ? ' logic-group-shell' : '';
                    const groupPrevLinkCls = isGroupContinuation ? ' logic-group-link-prev' : '';
                    const groupNextLinkCls = hasNextInGroup ? ' logic-group-link-next' : '';

                    out += `<div class="ai-logic-block logic-depth-${Math.min(depth, 3)}${showPanel ? ' show-panel' : ''}${isCollapsed && hasKids ? ' is-folded' : ''}${groupContCls}${groupShellCls}${groupPrevLinkCls}${groupNextLinkCls}" data-logic-idx="${idx}" data-step-id="${step.id}">`;

                    // 头部：逻辑步骤卡片 + 起始树线
                    out += `<div class="ai-step-row${depthCls}" data-step-idx="${idx}">`;
                    out += buildStepCardHTML(step, idx, isActiveRow, false);
                    out += treeLines;
                    if (showPanel && hasKids) {
                        out += `<span class="ai-tree-vline ai-tree-vline--start tree-depth-${depth}" style="right:${4 + depth * 10}px"></span>`;
                    }
                    out += `</div>`;

                    if (!isCollapsed) {
                        // 逻辑体：始终渲染（collapsed 时保留微型 hover 区域以检测鼠标进入）
                        out += `<div class="ai-logic-body${showPanel ? '' : ' is-collapsed'}">`;
                        out += buildGapHTML(idx, bodyGapActive, false, step.id, showPanel ? bodyTreeDepth : 0);
                        if (showPanel && hasKids) {
                            children.forEach((childIdx, ci) => {
                                const childStep = steps[childIdx];
                                const prevChild = ci > 0 ? steps[children[ci - 1]] : null;
                                const childIsGroupCont = prevChild
                                    && childStep.logicGroupId
                                    && childStep.logicGroupId === prevChild.logicGroupId;
                                const nextChild = ci + 1 < children.length ? steps[children[ci + 1]] : null;
                                const childGapIsConnector = nextChild
                                    && childStep.logicGroupId
                                    && childStep.logicGroupId === nextChild.logicGroupId;
                                const childIsGroupStart = !childIsGroupCont && childGapIsConnector;
                                out += renderStepAndChildren(childStep, childIdx, childIsGroupCont, getDepth(childStep), childIsGroupStart, childGapIsConnector);
                                // 判断当前子步骤与下一个子步骤是否同组（复用 nextChild）
                                const childConnCls = childGapIsConnector ? ` logic-group-gap-connector logic-group-depth-${Math.min(getDepth(childStep), 3)}` : '';
                                const childCurIsLogic = childStep.stepType === 'logic';
                                const childNextIsLogic = nextChild && nextChild.stepType === 'logic';
                                const childBetweenPanels = (childCurIsLogic && childNextIsLogic && !childGapIsConnector) ? ' gap-between-panels' : '';
                                const cGapActive = isGapActive(childIdx, step.id);
                                out += `<div class="ai-step-gap${cGapActive ? ' is-active' : ''}${childConnCls}${childBetweenPanels}"
                                     data-after-idx="${childIdx}"
                                     onmouseenter="aiSetHoverInsertAfter(${childIdx}, '${step.id}')"
                                     onmouseleave="aiClearHoverInsertAfter(${childIdx}, '${step.id}')">
                                  ${(() => { let tl = ''; if (bodyTreeDepth > 0) { for (let d = 0; d < bodyTreeDepth; d++) { const rp = 4 + d * 10; tl += '<span class=\"ai-tree-vline tree-depth-' + (bodyTreeDepth - 1 - d) + '\" style=\"right:' + rp + 'px\"></span>'; } } return tl; })()}
                                  ${cGapActive ? `
                                    <button class="ai-step-insert-btn ctl-focus-ring is-solid" type="button"
                                        onclick="event.stopPropagation(); aiOpenNewChildStepEditor('${step.id}', ${childIdx})"
                                        title="新增步骤" aria-label="新增步骤">${iconSvg('plus', 'ctl-icon ctl-icon--sm')}</button>
                                  ` : `
                                    <button class="ai-step-insert-btn ctl-focus-ring is-ghost" type="button"
                                        onclick="event.stopPropagation(); aiPinInsertAfter(${childIdx}, '${step.id}')"
                                        title="新增步骤" aria-label="新增步骤">${iconSvg('plus', 'ctl-icon ctl-icon--sm')}</button>
                                  `}
                                </div>`;
                            });
                        }
                        out += `</div>`;
                    }

                    out += `</div>`;
                } else {
                    out += `<div class="ai-step-row${depthCls}" data-step-idx="${idx}">`;
                    out += buildStepCardHTML(step, idx, isActiveRow, false);
                    out += treeLines;
                    out += `</div>`;
                }

                return out;
            }

            // ── 渲染所有顶层步骤 ──
            const html = [];
            const topLevelSteps = [];
            steps.forEach((step, idx) => {
                if (!step.parentId) topLevelSteps.push({ step, idx });
            });
            topLevelSteps.forEach(({ step, idx }, ti) => {
                // 判断当前步骤与前一个/后一个顶层步骤是否同组
                const prevTop = ti > 0 ? topLevelSteps[ti - 1] : null;
                const nextTop = ti + 1 < topLevelSteps.length ? topLevelSteps[ti + 1] : null;
                const isGroupContinuation = prevTop
                    && step.logicGroupId
                    && step.logicGroupId === prevTop.step.logicGroupId;
                const isGroupStart = !isGroupContinuation
                    && nextTop
                    && step.logicGroupId
                    && step.logicGroupId === nextTop.step.logicGroupId;
                const gapIsConnector = nextTop
                    && step.logicGroupId
                    && step.logicGroupId === nextTop.step.logicGroupId;
                const groupDepth = getDepth(step);

                html.push(renderStepAndChildren(step, idx, isGroupContinuation, groupDepth, isGroupStart, gapIsConnector));
                // 判断当前步骤与下一个顶层步骤是否同组（决定 gap 样式）
                const connectorCls = gapIsConnector ? ` logic-group-gap-connector logic-group-depth-${Math.min(groupDepth, 3)}` : '';
                // 两个逻辑体面板之间的间隙加宽
                const curIsLogic = step.stepType === 'logic';
                const nextIsLogic = nextTop && nextTop.step.stepType === 'logic';
                const betweenPanelsCls = (curIsLogic && nextIsLogic && !gapIsConnector) ? ' gap-between-panels' : '';
                html.push(`<div class="ai-step-gap${isGapActive(idx, null) ? ' is-active' : ''}${connectorCls}${betweenPanelsCls}"
                     data-after-idx="${idx}"
                     onmouseenter="aiSetHoverInsertAfter(${idx}, null)"
                     onmouseleave="aiClearHoverInsertAfter(${idx}, null)">
                  ${isGapActive(idx, null) ? `
                    <button class="ai-step-insert-btn ctl-focus-ring is-solid" type="button"
                        onclick="event.stopPropagation(); aiOpenNewStepEditor(${idx})"
                        title="新增步骤" aria-label="新增步骤">${iconSvg('plus', 'ctl-icon ctl-icon--sm')}</button>
                  ` : `
                    <button class="ai-step-insert-btn ctl-focus-ring is-ghost" type="button"
                        onclick="event.stopPropagation(); aiPinInsertAfter(${idx}, null)"
                        title="新增步骤" aria-label="新增步骤">${iconSvg('plus', 'ctl-icon ctl-icon--sm')}</button>
                  `}
                </div>`);
            });

            dom.scriptSteps.innerHTML = html.join('');
            if (aiState.hoverGapParentId) {
                const previewBlock = dom.scriptSteps.querySelector(`.ai-logic-block[data-step-id="${aiState.hoverGapParentId}"]`);
                if (previewBlock) previewBlock.classList.add('logic-preview-open');
            }

            initStepDragDrop();
            syncDeleteBtnState();
        }

        // ─── 拖拽排序 ─────────────────────────────────────
        let _dragSrcIdx = -1;
        let _dragSrcIndices: number[] = [];
        let _dragSrcRootId: string | null = null;
        let _dragSrcRootIndices: number[] = [];
        let _dragSrcRootIds: string[] = [];
        let _dragSrcIsLogicBlock = false;
        let _dragImageEl: HTMLElement | null = null;
        let _dragTargetLogicId: string | null = null;
        let _dragIndicatorEl: HTMLElement | null = null;
        let _dragInsertInfo: { afterIdx: number; parentId: string | null; valid: boolean } | null = null;
        let _dragOverDocHandler: ((e: DragEvent) => void) | null = null;
        let _dragImageOffsetX = 0;
        let _dragImageOffsetY = 0;

        function initStepDragDrop() {
            if (!dom.scriptSteps) return;
            const cards = dom.scriptSteps.querySelectorAll('.ai-step-card');

            function buildChildrenMap(steps: any[]) {
                const map: Record<string, number[]> = {};
                steps.forEach((s, i) => {
                    if (!s?.parentId) return;
                    if (!map[s.parentId]) map[s.parentId] = [];
                    map[s.parentId].push(i);
                });
                return map;
            }

            function collectSubtreeIndices(rootIdx: number, steps: any[]) {
                const root = steps[rootIdx];
                if (!root?.id) return [rootIdx];
                const childrenOf = buildChildrenMap(steps);
                const out: number[] = [rootIdx];
                const seen = new Set<number>(out);
                const stack: string[] = [root.id];
                while (stack.length) {
                    const pid = stack.pop()!;
                    const kids = childrenOf[pid] || [];
                    for (const k of kids) {
                        if (seen.has(k)) continue;
                        seen.add(k);
                        out.push(k);
                        const ks = steps[k];
                        if (ks?.id && childrenOf[ks.id]?.length) stack.push(ks.id);
                    }
                }
                out.sort((a, b) => a - b);
                return out;
            }

            function collectDragIndices(rootIdx: number, steps: any[]) {
                const step = steps[rootIdx];
                if (!step) {
                    return { rootIndices: [rootIdx], movedIndices: [rootIdx] };
                }

                // IF 行拖拽时，默认拖拽整个逻辑组（IF / ELIF / ELSE）及每个组成员的全部子级
                if (step.stepType === 'logic' && step.logicType === 'if') {
                    const groupRootIndices = getLogicGroupIndices(rootIdx)
                        .filter(i => {
                            const s = steps[i];
                            return s && (s.parentId || null) === (step.parentId || null);
                        })
                        .sort((a, b) => a - b);

                    const moved = new Set<number>();
                    groupRootIndices.forEach(i => {
                        collectSubtreeIndices(i, steps).forEach(subIdx => moved.add(subIdx));
                    });

                    return {
                        rootIndices: groupRootIndices.length ? groupRootIndices : [rootIdx],
                        movedIndices: Array.from(moved).sort((a, b) => a - b),
                    };
                }

                if (step.stepType === 'logic') {
                    return { rootIndices: [rootIdx], movedIndices: collectSubtreeIndices(rootIdx, steps) };
                }

                return { rootIndices: [rootIdx], movedIndices: [rootIdx] };
            }

            function applyParentIdToMovedRoots(movedSteps: any[], fromIndices: number[], parentId: string | null) {
                const rootSet = new Set<number>(_dragSrcRootIndices.length ? _dragSrcRootIndices : [_dragSrcIdx]);
                fromIndices.forEach((oldIdx, arrIdx) => {
                    if (!rootSet.has(oldIdx)) return;
                    const step = movedSteps[arrIdx];
                    if (!step) return;
                    if (parentId) step.parentId = parentId;
                    else delete step.parentId;
                });
            }

            function buildDragPreview(rootIndices: number[], e: DragEvent): HTMLElement | null {
                if (!dom.scriptSteps || !rootIndices.length) return null;

                const rootEls = rootIndices
                    .map(idx => dom.scriptSteps!.querySelector(`.ai-logic-block[data-logic-idx="${idx}"], .ai-step-row[data-step-idx="${idx}"]`) as HTMLElement | null)
                    .filter(Boolean) as HTMLElement[];

                if (!rootEls.length) return null;

                const firstEl = rootEls[0];
                const firstRect = firstEl.getBoundingClientRect();
                const maxWidth = Math.max(...rootEls.map(el => el.getBoundingClientRect().width));
                const groupTop = Math.min(...rootEls.map(el => el.getBoundingClientRect().top));

                _dragImageOffsetX = Math.min(24, maxWidth / 2);
                _dragImageOffsetY = Math.max(14, e.clientY - groupTop);

                // 单个逻辑块保留原来的块级预览；多个根节点时，组合成一个整体预览容器
                if (rootEls.length === 1 && firstEl.classList.contains('ai-logic-block')) {
                    const clone = firstEl.cloneNode(true) as HTMLElement;
                    clone.style.width = `${maxWidth}px`;
                    clone.style.maxWidth = `${maxWidth}px`;
                    clone.classList.remove('drag-source');
                    clone.classList.add('drag-floating-preview');
                    return clone;
                }

                const wrapper = document.createElement('div');
                wrapper.className = 'ai-logic-block drag-floating-preview drag-floating-preview-group';
                for (let d = 0; d <= 3; d++) {
                    if (firstEl.classList.contains(`logic-depth-${d}`)) {
                        wrapper.classList.add(`logic-depth-${d}`);
                        break;
                    }
                }
                wrapper.style.width = `${maxWidth}px`;
                wrapper.style.maxWidth = `${maxWidth}px`;

                rootEls.forEach((rootEl, idx) => {
                    const rootClone = rootEl.cloneNode(true) as HTMLElement;
                    rootClone.classList.remove('drag-source');
                    wrapper.appendChild(rootClone);

                    // 组内相邻成员之间，把原本的 gap 一起带上，预览更接近真实结构
                    if (idx < rootEls.length - 1) {
                        const gapEl = rootEl.nextElementSibling as HTMLElement | null;
                        if (gapEl?.classList.contains('ai-step-gap')) {
                            const gapClone = gapEl.cloneNode(true) as HTMLElement;
                            wrapper.appendChild(gapClone);
                        }
                    }
                });

                return wrapper;
            }

            function clearDragArtifacts() {
                if (!dom.scriptSteps) return;
                clearDragIndicators();
                dom.scriptSteps.querySelectorAll('.drag-source').forEach(el => el.classList.remove('drag-source'));
                dom.scriptSteps.querySelectorAll('.drag-drop-target').forEach(el => el.classList.remove('drag-drop-target'));
                if (_dragOverDocHandler) {
                    document.removeEventListener('dragover', _dragOverDocHandler, true);
                    _dragOverDocHandler = null;
                }
                if (_dragImageEl) {
                    _dragImageEl.remove();
                    _dragImageEl = null;
                }
                if (_dragIndicatorEl) {
                    _dragIndicatorEl.remove();
                    _dragIndicatorEl = null;
                }
                _dragTargetLogicId = null;
                _dragInsertInfo = null;
            }

            function buildIndexMap(oldLen: number, movedIdx: number[], insertAt: number) {
                const movedSet = new Set<number>(movedIdx);
                const remain: number[] = [];
                for (let i = 0; i < oldLen; i++) if (!movedSet.has(i)) remain.push(i);
                const nextOrder = remain.slice();
                nextOrder.splice(insertAt, 0, ...movedIdx);
                const map = new Map<number, number>();
                nextOrder.forEach((oldIdx, newIdx) => map.set(oldIdx, newIdx));
                return map;
            }

            function ensureDragIndicator(): HTMLElement {
                if (_dragIndicatorEl && _dragIndicatorEl.parentElement) return _dragIndicatorEl;
                const el = document.createElement('div');
                el.className = 'drag-indicator-line';
                dom.scriptSteps?.appendChild(el);
                _dragIndicatorEl = el;
                return el;
            }

            function positionDragIndicator(yAbsolute: number, valid: boolean) {
                const line = ensureDragIndicator();
                const containerRect = dom.scriptSteps?.getBoundingClientRect();
                if (!containerRect) return;
                const top = yAbsolute - containerRect.top + (dom.scriptSteps?.scrollTop || 0);
                line.style.top = `${top - 1}px`;
                line.style.display = 'block';
                if (valid) {
                    line.classList.remove('is-invalid');
                } else {
                    line.classList.add('is-invalid');
                }
            }

            function hideDragIndicator() {
                if (_dragIndicatorEl) {
                    _dragIndicatorEl.style.display = 'none';
                    _dragIndicatorEl.classList.remove('is-invalid');
                }
            }

            function computeDepthForParentId(parentId: string | null, steps: any[]): number {
                let d = 0;
                let pid = parentId;
                while (pid) {
                    d++;
                    const pStep = steps.find(s => s?.id === pid);
                    pid = pStep?.parentId || null;
                }
                return d;
            }

            function updateDragImageDepth(targetParentId: string | null) {
                if (!_dragImageEl || !_dragSrcIsLogicBlock) return;
                const steps = aiState.scriptSteps || [];
                const targetDepth = computeDepthForParentId(targetParentId, steps);
                const clampedDepth = Math.min(targetDepth, 3);
                for (let d = 0; d <= 3; d++) {
                    _dragImageEl.classList.toggle(`logic-depth-${d}`, d === clampedDepth);
                }
            }

            function getSiblingsForParent(parentId: string | null, steps: any[]): number[] {
                return steps.reduce((acc: number[], s, i) => {
                    if ((s.parentId || null) === parentId) acc.push(i);
                    return acc;
                }, []);
            }

            function validateDropPosition(draggedRootStep: any, afterIdx: number, parentId: string | null, steps: any[]): boolean {
                if (!draggedRootStep) return true;
                const movedSet = new Set<number>(_dragSrcIndices);

                // 禁止拖入自身子树
                if (_dragSrcIsLogicBlock && _dragSrcRootId) {
                    const draggedIds = new Set<string>();
                    for (const i of _dragSrcIndices) {
                        const s = steps[i];
                        if (s?.id) draggedIds.add(s.id);
                    }
                    if (parentId && draggedIds.has(parentId)) return false;
                    let pid: string | null = parentId;
                    while (pid) {
                        if (draggedIds.has(pid)) return false;
                        const pStep = steps.find(s => s?.id === pid);
                        pid = pStep?.parentId || null;
                    }
                }

                // 模拟拖拽后的完整步骤数组，使用 validateMoveResult 做全局校验
                const fromIndices = _dragSrcIndices.length ? _dragSrcIndices.slice() : [_dragSrcIdx];
                let resolvedAfterIdx = afterIdx;
                if (resolvedAfterIdx >= 0 && movedSet.has(resolvedAfterIdx)) {
                    const siblings = getSiblingsForParent(parentId, steps);
                    const sibPos = siblings.indexOf(resolvedAfterIdx);
                    resolvedAfterIdx = -1;
                    for (let i = sibPos - 1; i >= 0; i--) {
                        if (!movedSet.has(siblings[i])) { resolvedAfterIdx = siblings[i]; break; }
                    }
                }
                const remainIdx: number[] = [];
                for (let i = 0; i < steps.length; i++) if (!movedSet.has(i)) remainIdx.push(i);
                let insertAt: number;
                if (resolvedAfterIdx < 0) {
                    const siblingsInRemain = remainIdx.filter(i => (steps[i].parentId || null) === parentId);
                    insertAt = siblingsInRemain.length > 0
                        ? remainIdx.indexOf(siblingsInRemain[0])
                        : (parentId
                            ? (() => { const pi = remainIdx.find(i => steps[i]?.id === parentId); return pi !== undefined ? remainIdx.indexOf(pi) + 1 : 0; })()
                            : 0);
                } else {
                    const anchorPos = remainIdx.indexOf(resolvedAfterIdx);
                    if (anchorPos < 0) {
                        insertAt = remainIdx.length;
                    } else {
                        const anchorStep = steps[resolvedAfterIdx];
                        if (anchorStep && (anchorStep.stepType === 'logic' || anchorStep.stepType === 'loop')
                            && (anchorStep.parentId || null) === parentId) {
                            const sub = collectSubtreeIndices(resolvedAfterIdx, steps).filter(i => !movedSet.has(i));
                            const lastSub = sub.length ? Math.max(...sub) : resolvedAfterIdx;
                            const lastPos = remainIdx.indexOf(lastSub);
                            insertAt = lastPos >= 0 ? lastPos + 1 : anchorPos + 1;
                        } else {
                            insertAt = anchorPos + 1;
                        }
                    }
                }
                const movedSteps = fromIndices.map(i => JSON.parse(JSON.stringify(steps[i])));
                const simSteps = steps.filter((_, i) => !movedSet.has(i)).map(s => JSON.parse(JSON.stringify(s)));
                applyParentIdToMovedRoots(movedSteps, fromIndices, parentId);
                simSteps.splice(insertAt, 0, ...movedSteps);
                const result = validateMoveResult(simSteps);
                return result.ok;
            }

            function computeInsertInfo(e: DragEvent, cardEl: HTMLElement): void {
                const steps = aiState.scriptSteps || [];
                const targetIdx = parseInt((cardEl as any).dataset.stepIdx);
                if (isNaN(targetIdx)) return;
                if (targetIdx === _dragSrcIdx) return;
                if (_dragSrcIsLogicBlock && _dragSrcIndices.includes(targetIdx)) return;

                const rect = cardEl.getBoundingClientRect();
                const dropAbove = e.clientY < rect.top + rect.height / 2;
                const targetStep = steps[targetIdx];
                const parentId = targetStep?.parentId || null;

                const movedSet = new Set(_dragSrcIndices);
                const siblings = getSiblingsForParent(parentId, steps).filter(i => !movedSet.has(i));
                const sibPos = siblings.indexOf(targetIdx);
                const afterIdx = dropAbove
                    ? (sibPos > 0 ? siblings[sibPos - 1] : -1)
                    : targetIdx;

                const draggedRoot = _dragSrcIdx >= 0 ? steps[_dragSrcIdx] : null;
                const valid = validateDropPosition(draggedRoot, afterIdx, parentId, steps);

                _dragInsertInfo = { afterIdx, parentId, valid };
                updateDragImageDepth(parentId);

                const y = dropAbove ? rect.top : rect.bottom;
                positionDragIndicator(y, valid);

                if (e.dataTransfer) {
                    e.dataTransfer.dropEffect = valid ? 'move' : 'none';
                }
            }

            function executeDrop(): void {
                if (!_dragInsertInfo) return;
                if (!_dragInsertInfo.valid) { clearDragArtifacts(); return; }

                const steps = aiState.scriptSteps || [];
                const fromIndices = _dragSrcIndices.length ? _dragSrcIndices.slice() : [_dragSrcIdx];
                const movedSet = new Set<number>(fromIndices);

                let resolvedAfterIdx = _dragInsertInfo.afterIdx;
                const parentId = _dragInsertInfo.parentId;

                // If afterIdx is a moved step, resolve to nearest preceding non-moved sibling
                if (resolvedAfterIdx >= 0 && movedSet.has(resolvedAfterIdx)) {
                    const siblings = getSiblingsForParent(parentId, steps);
                    const sibPos = siblings.indexOf(resolvedAfterIdx);
                    resolvedAfterIdx = -1;
                    for (let i = sibPos - 1; i >= 0; i--) {
                        if (!movedSet.has(siblings[i])) { resolvedAfterIdx = siblings[i]; break; }
                    }
                }

                const remainIdx: number[] = [];
                for (let i = 0; i < steps.length; i++) if (!movedSet.has(i)) remainIdx.push(i);

                let insertAt: number;
                if (resolvedAfterIdx < 0) {
                    const siblingsInRemain = remainIdx.filter(i => (steps[i].parentId || null) === parentId);
                    insertAt = siblingsInRemain.length > 0
                        ? remainIdx.indexOf(siblingsInRemain[0])
                        : (parentId
                            ? (() => { const pi = remainIdx.find(i => steps[i]?.id === parentId); return pi !== undefined ? remainIdx.indexOf(pi) + 1 : 0; })()
                            : 0);
                } else {
                    const anchorPos = remainIdx.indexOf(resolvedAfterIdx);
                    if (anchorPos < 0) {
                        insertAt = remainIdx.length;
                    } else {
                        const anchorStep = steps[resolvedAfterIdx];
                        if (anchorStep && (anchorStep.stepType === 'logic' || anchorStep.stepType === 'loop')
                            && (anchorStep.parentId || null) === parentId) {
                            const sub = collectSubtreeIndices(resolvedAfterIdx, steps).filter(i => !movedSet.has(i));
                            const lastSub = sub.length ? Math.max(...sub) : resolvedAfterIdx;
                            const lastPos = remainIdx.indexOf(lastSub);
                            insertAt = lastPos >= 0 ? lastPos + 1 : anchorPos + 1;
                        } else {
                            insertAt = anchorPos + 1;
                        }
                    }
                }

                const movedSteps = fromIndices.map(i => steps[i]);
                const nextSteps = steps.filter((_, i) => !movedSet.has(i));
                nextSteps.splice(insertAt, 0, ...movedSteps);

                _dragSrcRootIds.forEach(rootId => {
                    const rootStep = nextSteps.find(s => s?.id === rootId);
                    if (!rootStep) return;
                    if (parentId) rootStep.parentId = parentId;
                    else delete rootStep.parentId;
                });

                // 最终全局校验：防止拖拽打断逻辑组
                const dropCheck = validateMoveResult(nextSteps);
                if (!dropCheck.ok) {
                    showToast(dropCheck.reason || '拖拽会打断逻辑组', 'error');
                    clearDragArtifacts();
                    return;
                }

                const map = buildIndexMap(steps.length, fromIndices, insertAt);
                if (aiState.insertAfterIndex >= 0) {
                    const ni = map.get(aiState.insertAfterIndex);
                    aiState.insertAfterIndex = typeof ni === 'number' ? ni : -1;
                }
                if (aiState.hoverInsertAfterIndex >= 0) {
                    const ni = map.get(aiState.hoverInsertAfterIndex);
                    aiState.hoverInsertAfterIndex = typeof ni === 'number' ? ni : -1;
                    if (aiState.hoverInsertAfterIndex < 0) aiState.hoverGapParentId = null;
                }
                if (aiState.selectedStepIndices && aiState.selectedStepIndices.size) {
                    const nextSel = new Set<number>();
                    for (const i of aiState.selectedStepIndices) {
                        const ni = map.get(i);
                        if (typeof ni === 'number') nextSel.add(ni);
                    }
                    aiState.selectedStepIndices = nextSel;
                }

                aiState.scriptSteps = nextSteps;
                clearDragArtifacts();
                recomputeAllLogicGroupIds();
                renderScriptSteps();
            }

            cards.forEach(card => {
                card.draggable = false;

                const handle = card.querySelector('.ai-step-drag-handle');
                if (handle) {
                    handle.addEventListener('mousedown', () => { card.draggable = true; });
                    handle.addEventListener('mouseup', () => { card.draggable = false; });
                }

                card.addEventListener('dragstart', e => {
                    _dragSrcIdx = parseInt(card.dataset.stepIdx);
                    const steps = aiState.scriptSteps || [];
                    const step = steps[_dragSrcIdx];
                    _dragSrcIsLogicBlock = !!(step && step.stepType === 'logic');
                    _dragSrcRootId = step?.id || null;
                    const dragPayload = collectDragIndices(_dragSrcIdx, steps);
                    _dragSrcRootIndices = dragPayload.rootIndices.slice();
                    _dragSrcRootIds = _dragSrcRootIndices.map(i => steps[i]?.id).filter(Boolean);
                    _dragSrcIndices = dragPayload.movedIndices.slice();

                    if (_dragSrcIsLogicBlock) {
                        const rootEls = _dragSrcRootIndices
                            .map(idx => dom.scriptSteps?.querySelector(`.ai-logic-block[data-logic-idx="${idx}"], .ai-step-row[data-step-idx="${idx}"]`) as HTMLElement | null)
                            .filter(Boolean) as HTMLElement[];
                        rootEls.forEach(el => el.classList.add('drag-source'));

                        if (rootEls.length > 0 && e.dataTransfer) {
                            const previewEl = buildDragPreview(_dragSrcRootIndices, e);

                            // Hide native drag ghost: transparent 1x1 image
                            const blank = new Image();
                            blank.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
                            e.dataTransfer.setDragImage(blank, 0, 0);

                            if (previewEl) {
                                previewEl.style.position = 'fixed';
                                previewEl.style.left = `${e.clientX - _dragImageOffsetX}px`;
                                previewEl.style.top = `${e.clientY - _dragImageOffsetY}px`;
                                previewEl.style.pointerEvents = 'none';
                                previewEl.style.opacity = '0.85';
                                previewEl.style.transform = 'scale(0.92)';
                                previewEl.style.zIndex = '50001';
                                previewEl.style.transition = 'none';
                                document.body.appendChild(previewEl);
                                _dragImageEl = previewEl;
                            }

                            // Track cursor position (capture phase so stopPropagation on cards doesn't block it)
                            _dragOverDocHandler = (ev: DragEvent) => {
                                if (!_dragImageEl) return;
                                if (ev.clientX > 0 || ev.clientY > 0) {
                                    _dragImageEl.style.left = `${ev.clientX - _dragImageOffsetX}px`;
                                    _dragImageEl.style.top = `${ev.clientY - _dragImageOffsetY}px`;
                                }
                            };
                            document.addEventListener('dragover', _dragOverDocHandler, true);
                        }
                    } else {
                        card.classList.add('dragging');
                    }
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', _dragSrcIdx);
                });

                card.addEventListener('dragend', () => {
                    card.classList.remove('dragging');
                    card.draggable = false;
                    clearDragArtifacts();
                    _dragSrcIdx = -1;
                    _dragSrcIndices = [];
                    _dragSrcRootId = null;
                    _dragSrcRootIndices = [];
                    _dragSrcRootIds = [];
                    _dragSrcIsLogicBlock = false;
                });

                card.addEventListener('dragover', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    computeInsertInfo(e, card as HTMLElement);
                });

                card.addEventListener('dragleave', () => {});

                card.addEventListener('drop', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    executeDrop();
                });
            });

            const bodies = dom.scriptSteps.querySelectorAll('.ai-logic-body');
            bodies.forEach((body) => {
                const el = body as HTMLElement;
                el.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    if (!e.dataTransfer) return;
                    if (_dragSrcIdx < 0) return;

                    // Check if cursor is past the bottom or above the top of all content children.
                    // If so, let the event bubble to the parent/container handler instead of claiming it.
                    const contentEls = el.querySelectorAll(':scope > .ai-step-row, :scope > .ai-logic-block');
                    if (contentEls.length > 0) {
                        const lastContentEl = contentEls[contentEls.length - 1] as HTMLElement;
                        const firstContentEl = contentEls[0] as HTMLElement;
                        const lastRect = lastContentEl.getBoundingClientRect();
                        const firstRect = firstContentEl.getBoundingClientRect();
                        if (e.clientY > lastRect.bottom || e.clientY < firstRect.top) {
                            return;
                        }
                    }

                    e.stopPropagation();

                    const block = el.closest('.ai-logic-block') as HTMLElement | null;
                    const logicIdxStr = block?.dataset?.logicIdx;
                    const logicIdx = logicIdxStr ? parseInt(logicIdxStr) : NaN;
                    const steps = aiState.scriptSteps || [];
                    const logicStep = Number.isFinite(logicIdx) ? steps[logicIdx] : null;
                    if (!logicStep?.id) return;

                    const parentId = logicStep.id;
                    const movedSet = new Set(_dragSrcIndices);
                    const childRows = Array.from(el.querySelectorAll(':scope > .ai-step-row, :scope > .ai-logic-block > .ai-step-row:first-child'))
                        .map(row => {
                            const rowEl = row as HTMLElement;
                            const idx = parseInt(rowEl.dataset.stepIdx || '');
                            if (isNaN(idx)) return null;
                            // For logic block headers, use the full block's rect for positioning
                            const parentBlock = rowEl.parentElement;
                            const visualEl = (parentBlock && parentBlock.classList.contains('ai-logic-block'))
                                ? parentBlock as HTMLElement
                                : rowEl;
                            return { el: rowEl, visualEl, idx };
                        })
                        .filter(Boolean) as { el: HTMLElement; visualEl: HTMLElement; idx: number }[];

                    const directChildren = steps.reduce((acc: number[], s, i) => {
                        if (s.parentId === parentId && !movedSet.has(i)) acc.push(i);
                        return acc;
                    }, []);

                    let afterIdx: number;
                    let indicatorY: number;

                    if (directChildren.length === 0 || childRows.length === 0) {
                        afterIdx = logicIdx;
                        const bodyRect = el.getBoundingClientRect();
                        indicatorY = bodyRect.top + bodyRect.height / 2;
                    } else {
                        let best = { afterIdx: logicIdx, y: 0, dist: Infinity };
                        for (let i = 0; i < childRows.length; i++) {
                            const row = childRows[i];
                            const vRect = row.visualEl.getBoundingClientRect();
                            const topDist = Math.abs(e.clientY - vRect.top);
                            const botDist = Math.abs(e.clientY - vRect.bottom);
                            const childStepIdx = row.idx;
                            const isDirectChild = directChildren.includes(childStepIdx);

                            if (isDirectChild && topDist < best.dist) {
                                const prevDirect = directChildren.filter(di => di < childStepIdx);
                                best = {
                                    afterIdx: prevDirect.length > 0 ? prevDirect[prevDirect.length - 1] : logicIdx,
                                    y: vRect.top,
                                    dist: topDist
                                };
                            }
                            if (isDirectChild && botDist < best.dist) {
                                best = { afterIdx: childStepIdx, y: vRect.bottom, dist: botDist };
                            }
                        }
                        afterIdx = best.afterIdx;
                        indicatorY = best.y;
                    }

                    const draggedRoot = _dragSrcIdx >= 0 ? steps[_dragSrcIdx] : null;
                    const valid = validateDropPosition(draggedRoot, afterIdx, parentId, steps);

                    _dragInsertInfo = { afterIdx, parentId, valid };
                    updateDragImageDepth(parentId);
                    positionDragIndicator(indicatorY, valid);
                    e.dataTransfer.dropEffect = valid ? 'move' : 'none';

                    dom.scriptSteps?.querySelectorAll('.drag-drop-target').forEach(n => n.classList.remove('drag-drop-target'));
                    el.classList.add('drag-drop-target');
                    _dragTargetLogicId = logicStep.id;
                });

                el.addEventListener('dragleave', () => {
                    el.classList.remove('drag-drop-target');
                    _dragTargetLogicId = null;
                });

                el.addEventListener('drop', (e) => {
                    e.preventDefault();
                    // Same edge check as dragover: if cursor is past content children, let container handle it
                    const contentEls = el.querySelectorAll(':scope > .ai-step-row, :scope > .ai-logic-block');
                    if (contentEls.length > 0) {
                        const lastContentEl = contentEls[contentEls.length - 1] as HTMLElement;
                        const firstContentEl = contentEls[0] as HTMLElement;
                        const lastRect = lastContentEl.getBoundingClientRect();
                        const firstRect = firstContentEl.getBoundingClientRect();
                        if (e.clientY > lastRect.bottom || e.clientY < firstRect.top) {
                            return;
                        }
                    }
                    e.stopPropagation();
                    executeDrop();
                });
            });

            // Container-level handler: covers gaps between top-level steps
            dom.scriptSteps.addEventListener('dragover', (e: DragEvent) => {
                e.preventDefault();
                if (!e.dataTransfer) return;
                if (_dragSrcIdx < 0) return;

                const steps = aiState.scriptSteps || [];
                const movedSet = new Set(_dragSrcIndices);
                const topLevelSiblings = getSiblingsForParent(null, steps).filter(i => !movedSet.has(i));
                if (topLevelSiblings.length === 0) {
                    _dragInsertInfo = { afterIdx: -1, parentId: null, valid: true };
                    updateDragImageDepth(null);
                    const containerRect = dom.scriptSteps!.getBoundingClientRect();
                    positionDragIndicator(containerRect.top + 20, true);
                    e.dataTransfer.dropEffect = 'move';
                    return;
                }

                // Find the nearest gap using ALL top-level rows (including moved) for visual positioning
                const allTopLevel = getSiblingsForParent(null, steps);
                const topRows: { el: HTMLElement; idx: number }[] = [];
                for (const idx of allTopLevel) {
                    const row = dom.scriptSteps!.querySelector(`.ai-step-row[data-step-idx="${idx}"], .ai-logic-block[data-logic-idx="${idx}"]`) as HTMLElement | null;
                    if (row) topRows.push({ el: row, idx });
                }

                let best = { afterIdx: -1 as number, y: 0, dist: Infinity };
                for (let i = 0; i < topRows.length; i++) {
                    const row = topRows[i];
                    const rect = row.el.getBoundingClientRect();
                    const topDist = Math.abs(e.clientY - rect.top);
                    const botDist = Math.abs(e.clientY - rect.bottom);

                    if (topDist < best.dist) {
                        // Find previous non-moved top-level sibling
                        let prevIdx = -1;
                        for (let j = i - 1; j >= 0; j--) {
                            if (!movedSet.has(topRows[j].idx)) { prevIdx = topRows[j].idx; break; }
                        }
                        best = { afterIdx: prevIdx, y: rect.top, dist: topDist };
                    }
                    if (botDist < best.dist) {
                        const idx = movedSet.has(row.idx)
                            ? (() => { let p = -1; for (let j = i; j >= 0; j--) { if (!movedSet.has(topRows[j].idx)) { p = topRows[j].idx; break; } } return p; })()
                            : row.idx;
                        best = { afterIdx: idx, y: rect.bottom, dist: botDist };
                    }
                }

                const draggedRoot = steps[_dragSrcIdx] || null;
                const valid = validateDropPosition(draggedRoot, best.afterIdx, null, steps);
                _dragInsertInfo = { afterIdx: best.afterIdx, parentId: null, valid };
                updateDragImageDepth(null);
                positionDragIndicator(best.y, valid);
                e.dataTransfer.dropEffect = valid ? 'move' : 'none';
            });

            dom.scriptSteps.addEventListener('drop', (e: DragEvent) => {
                e.preventDefault();
                executeDrop();
            });
        }

        function clearDragIndicators() {
            if (_dragIndicatorEl) {
                _dragIndicatorEl.style.display = 'none';
                _dragIndicatorEl.classList.remove('is-invalid');
            }
        }

        const EXECUTABLE_ACTIONS = new Set(['click', 'input', 'navigate', 'scroll', 'keypress', 'hover', 'wait', 'select', 'action']);

        function isExecutableStep(step) {
            return step && step.action && EXECUTABLE_ACTIONS.has(step.action);
        }

        // ─── Toast 轻提示 ─────────────────────────────────────
        const existingToast = typeof window.showToast === 'function' ? window.showToast : null;
        function legacyToast(msg, type) {
            const toast = document.createElement('div');
            toast.className = 'ai-toast' + (type ? ' ' + type : '');
            toast.textContent = msg;
            document.getElementById('aiPanelTab')?.appendChild(toast);
            requestAnimationFrame(() => toast.classList.add('show'));
            setTimeout(() => {
                toast.classList.remove('show');
                setTimeout(() => toast.remove(), 300);
            }, 2200);
        }
        const showToast = existingToast || legacyToast;
        // 仅在没有全局 toast 系统时，才挂载 legacy 版本
        if (!existingToast) window.showToast = showToast;

        // ─── 录制到脚本编辑区 ─────────────────────────────────────
        // 用 window 属性存储，使第一个 <script> 中的 WebSocket handler 可访问
        window.isRecordingToScript = false;

        /**
         * 将 CDP Recorder 格式的步骤转换为脚本编辑区格式（挂载到 window 供跨脚本调用）
         * CDP: { type, selectors, offsetX, offsetY, value, key, target:{tagName,textContent,...},
         *        xpath, iframes, _metadata:{description} }
         * Script: { action, target, value, description, xpath?, coordinates?, locators, xpathInfo }
         */
        window.recordingStepToScriptStep = function(step) {
            const typeMap = {
                'click': 'click', 'doubleClick': 'click',
                'change': 'input', 'input': 'input',
                'keyDown': 'keypress', 'scroll': 'scroll',
                'navigate': 'navigate', 'hover': 'hover',
            };
            const action = typeMap[step.type] || step.type;
            if (!EXECUTABLE_ACTIONS.has(action)) return null;

            const meta = step._metadata || {};
            const description = meta.description || step.description || action;

            const descParts = description.split(/\s+/);
            const target = descParts.length > 1 ? descParts.slice(1).join(' ') : description;

            // ── 提取 XPath ──
            let xpath = '';
            if (step.xpath) {
                xpath = step.xpath;
            } else if (Array.isArray(step.selectors) && step.selectors.length > 0) {
                const xpathSel = step.selectors.find(s =>
                    typeof s === 'string' && (s.startsWith('xpath/') || s.startsWith('//') || s.startsWith('(//')));
                if (xpathSel) {
                    xpath = xpathSel.startsWith('xpath/') ? xpathSel.slice(6) : xpathSel;
                }
            }

            // ── 提取 CSS 选择器（非 XPath 的最佳选择器）──
            let cssSelector = '';
            if (Array.isArray(step.selectors)) {
                const cssSel = step.selectors.find(s =>
                    typeof s === 'string' && !s.startsWith('xpath/') && !s.startsWith('//') && !s.startsWith('(//'));
                if (cssSel) cssSelector = cssSel;
            }
            if (!cssSelector && Array.isArray(step.selector_details)) {
                const cssDetail = step.selector_details.find(d => d.type !== 'xpath');
                if (cssDetail) cssSelector = cssDetail.selector;
            }

            // ── 提取坐标（优先 clientX/clientY 视口坐标，兼容 offsetX/offsetY）──
            let coordinates;
            const rawX = step.clientX ?? step.offsetX;
            const rawY = step.clientY ?? step.offsetY;
            if (rawX != null && rawY != null) {
                coordinates = { x: Number(rawX), y: Number(rawY) };
            }

            // ── 提取文本内容（来自 DOM 属性）──
            const stepTarget = (typeof step.target === 'object' && step.target) ? step.target : {};
            const domText = (stepTarget.textContent || stepTarget.innerText || '').trim().substring(0, 200);
            const tagName = stepTarget.tagName || stepTarget.nodeName || '';

            // ── 提取元素 boundingBox 及视口尺寸（CDP 录制器增强数据）──
            const boundingBox = stepTarget.boundingBox || null;
            const sourceViewport = (stepTarget.viewportWidth && stepTarget.viewportHeight)
                ? { width: stepTarget.viewportWidth, height: stepTarget.viewportHeight }
                : null;

            // ── 提取值 ──
            let value = step.value || '';
            if (step.type === 'keyDown' && step.key) value = step.key;
            if (step.type === 'navigate' && step.url) value = step.url;

            // ── 构建 locators 对象 ──
            const locators = {};
            if (xpath) {
                locators.xpath = { value: xpath, enabled: true, priority: 1 };
            }
            if (cssSelector) {
                const cssMeta = (step.selector_details || []).find(d => d.selector === cssSelector);
                locators.cssSelector = {
                    value: cssSelector, enabled: true, priority: 2,
                    matchIndex: 0,
                    matchTotal: cssMeta?.is_unique === false ? 2 : 1,
                };
            }
            if (domText) {
                locators.textContent = {
                    value: domText, enabled: true, priority: 3, source: 'dom',
                    matchIndex: 0, matchTotal: 1,
                };
            }
            if (description) {
                locators.aiLocate = {
                    value: description, enabled: true, priority: 6,
                };
            }

            // ── 构建 xpathInfo（含 iframe 上下文）──
            const xpathInfo = {
                xpath: xpath || '',
                text: domText || '',
                tagName: tagName || '',
                index: step.xpathIndex || 0,
                iframes: step.iframes || [],
            };

            const result = {
                id: `rec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                action,
                target: target || description,
                value,
                description,
                status: 'pending',
                locators,
                xpathInfo,
            };
            if (xpath) result.xpath = xpath;
            if (coordinates) result.coordinates = coordinates;
            if (boundingBox) result.boundingBox = boundingBox;
            if (sourceViewport) result.sourceViewport = sourceViewport;
            return result;
        };

        /**
         * 异步 enrichment：向后端发送 MJPEG 帧和坐标，补充 imageTemplate / normalizedCoords / OCR textContent
         * 不阻塞录制流程，完成后合并到步骤的 locators 中并刷新 UI
         */
        window.enrichRecordingStep = async function(scriptStep, frameBase64) {
            const stepDesc = scriptStep.description || scriptStep.action;
            const rawCoords = scriptStep.coordinates;
            const bb = scriptStep.boundingBox;
            const srcVp = scriptStep.sourceViewport;
            console.log(`[enrichRecordingStep] 开始 (纯前端): "${stepDesc}", id=${scriptStep.id}, coords=(${rawCoords?.x},${rawCoords?.y}), bb=${bb ? `${bb.width}x${bb.height}@(${bb.x},${bb.y})` : 'none'}, srcVp=${srcVp ? `${srcVp.width}x${srcVp.height}` : 'none'}, frame=${(frameBase64.length/1024).toFixed(0)}KB`);
            try {
                const frameImg = new Image();
                frameImg.src = 'data:image/jpeg;base64,' + frameBase64;
                await new Promise((resolve, reject) => {
                    frameImg.onload = resolve;
                    frameImg.onerror = () => reject(new Error('帧图片加载失败'));
                    setTimeout(() => reject(new Error('帧图片加载超时')), 5000);
                });
                const imgW = frameImg.naturalWidth;
                const imgH = frameImg.naturalHeight;
                if (imgW < 10 || imgH < 10) {
                    console.warn(`[enrichRecordingStep] 帧尺寸异常: ${imgW}x${imgH}`);
                    return;
                }

                // 视口→帧 缩放（CDP 坐标是 CSS 像素，MJPEG 帧可能是不同分辨率）
                const scaleX = srcVp ? (imgW / srcVp.width) : 1;
                const scaleY = srcVp ? (imgH / srcVp.height) : 1;
                if (scaleX !== 1 || scaleY !== 1) {
                    console.log(`[enrichRecordingStep] 缩放因子: scaleX=${scaleX.toFixed(3)}, scaleY=${scaleY.toFixed(3)} (viewport ${srcVp.width}x${srcVp.height} → frame ${imgW}x${imgH})`);
                }
                const coords = { x: rawCoords.x * scaleX, y: rawCoords.y * scaleY };

                const stepInList = aiState.scriptSteps.find(s => s.id === scriptStep.id);
                if (!stepInList) {
                    console.warn(`[enrichRecordingStep] 步骤 id=${scriptStep.id} 在列表中未找到`);
                    return;
                }
                const loc = stepInList.locators || {};
                let enriched = 0;

                // 1. imageTemplate: 优先使用元素 boundingBox 精确裁剪（需缩放），无 bbox 或 bb 过大时以坐标为中心裁剪
                const PAD = 8;
                const MAX_CROP_DIM = 500;
                let cropX, cropY, cropW, cropH;
                const bbUsable = bb && bb.width > 2 && bb.height > 2
                    && bb.width < MAX_CROP_DIM && bb.height < MAX_CROP_DIM;
                if (bbUsable) {
                    const sx = Math.round(bb.x * scaleX);
                    const sy = Math.round(bb.y * scaleY);
                    const sw = Math.round(bb.width * scaleX);
                    const sh = Math.round(bb.height * scaleY);
                    cropX = Math.max(0, sx - PAD);
                    cropY = Math.max(0, sy - PAD);
                    cropW = Math.min(sw + PAD * 2, imgW - cropX);
                    cropH = Math.min(sh + PAD * 2, imgH - cropY);
                    console.log(`[enrichRecordingStep] 使用 boundingBox 裁剪 (缩放后): ${cropW}x${cropH}@(${cropX},${cropY}) [原始 bb=${bb.width}x${bb.height}]`);
                } else {
                    const FALLBACK_W = 120, FALLBACK_H = 80;
                    cropW = Math.min(FALLBACK_W, imgW);
                    cropH = Math.min(FALLBACK_H, imgH);
                    cropX = Math.max(0, Math.min(Math.round(coords.x - cropW / 2), imgW - cropW));
                    cropY = Math.max(0, Math.min(Math.round(coords.y - cropH / 2), imgH - cropH));
                    const reason = (bb && (bb.width >= MAX_CROP_DIM || bb.height >= MAX_CROP_DIM))
                        ? `boundingBox 过大 (${bb.width}x${bb.height})` : '无 boundingBox';
                    console.log(`[enrichRecordingStep] ${reason}，使用坐标中心裁剪: ${cropW}x${cropH}@(${cropX},${cropY})`);
                }
                const cropCanvas = document.createElement('canvas');
                cropCanvas.width = cropW;
                cropCanvas.height = cropH;
                cropCanvas.getContext('2d').drawImage(frameImg, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
                const croppedB64 = cropCanvas.toDataURL('image/jpeg', 0.9).split(',')[1];
                if (croppedB64 && croppedB64.length > 100) {
                    loc.imageTemplate = { screenshot: croppedB64, threshold: 0.8, enabled: true, priority: 4 };
                    enriched++;
                    console.log(`[enrichRecordingStep] imageTemplate: ${cropW}x${cropH}, ${(croppedB64.length/1024).toFixed(0)}KB`);
                }

                // 2. normalizedCoords: 基于缩放后的坐标计算百分比
                loc.normalizedCoords = {
                    xPercent: +((coords.x / imgW) * 100).toFixed(4),
                    yPercent: +((coords.y / imgH) * 100).toFixed(4),
                    viewportWidth: imgW,
                    viewportHeight: imgH,
                    enabled: true, priority: 5,
                };
                enriched++;
                console.log(`[enrichRecordingStep] normalizedCoords: (${loc.normalizedCoords.xPercent}%, ${loc.normalizedCoords.yPercent}%) in ${imgW}x${imgH}`);

                // 3. OCR 文字提取（仅当 DOM 文本缺失且有图像时）
                if (!loc.textContent?.value && croppedB64) {
                    try {
                        const ocrResp = await fetch('/api/ocr/extract-text', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ image: croppedB64 }),
                        });
                        if (ocrResp.ok) {
                            const ocrData = await ocrResp.json();
                            if (ocrData.success && ocrData.text) {
                                loc.textContent = {
                                    value: ocrData.text, source: 'ocr', enabled: true, priority: 3,
                                    matchIndex: 0, matchTotal: 1,
                                };
                                enriched++;
                                console.log(`[enrichRecordingStep] OCR文本: "${ocrData.text}"`);
                            }
                        }
                    } catch (ocrErr) {
                        console.warn(`[enrichRecordingStep] OCR 调用失败 (不影响其他定位器): ${ocrErr.message}`);
                    }
                }

                stepInList.locators = loc;
                renderScriptSteps();
                const locCount = Object.keys(loc).filter(k => loc[k]?.enabled !== false).length;
                addAiLog(`🔧 录制步骤 "${stepDesc}" 定位器已增强 (+${enriched}，共${locCount}种)`);
                console.log(`[enrichRecordingStep] 完成: +${enriched} 定位器, 总计 ${locCount} 种`);
            } catch (err) {
                console.error('[enrichRecordingStep] 异常:', err);
                addAiLog(`⚠️ 定位器增强异常: ${err.message}`);
            }
        };

        window.updateRecordToScriptBtn = function() {
            const btn = document.getElementById('aiRecordToScriptBtn');
            if (!btn) return;
            if (window.isRecordingToScript) {
                btn.innerHTML = `<span class="ai-btn-icon">${iconSvg('square', 'ctl-icon--xs')}</span><span class="ai-btn-text">停止</span>`;
                btn.title = '停止录制';
                btn.classList.add('recording');
            } else {
                btn.innerHTML = `<span class="ai-btn-icon">${iconSvg('circleDot', 'ctl-icon--xs')}</span><span class="ai-btn-text">录制</span>`;
                btn.title = '录制步骤到编辑区';
                btn.classList.remove('recording');
            }
        };

        window.aiToggleRecordToScript = async function() {
            if (window.isRecordingToScript) {
                // 停止录制
                window.isRecordingToScript = false;
                window.updateRecordToScriptBtn();
                try { await fetch('/api/recorder/stop', { method: 'POST' }); } catch(e) {}
                showToast('录制已停止', 'success');
            } else {
                // 开始录制
                try {
                    const currentUrl = document.getElementById('infoRoomId')?.textContent || '';
                    const res = await fetch('/api/recorder/start', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: currentUrl, title: '脚本录制' }),
                    });
                    if (!res.ok) throw new Error(await res.text());
                    window.isRecordingToScript = true;
                    window.updateRecordToScriptBtn();
                    // 切换到 AI 助手 Tab 确保用户能看到步骤实时添加
                    switchPanelTab('ai');
                    showToast('录制已开始，操作浏览器以添加步骤', 'success');
                } catch(e) {
                    showToast('启动录制失败: ' + (e.message || e), 'error');
                }
            }
        };

        // ─── VLM OCR 手动重试 ──────────────────────────────────────
        // VLM OCR 现在由后端在 AI 执行完成后、发送 SSE 之前批量完成
        // 前端只保留手动 ↺ 重试能力

        /** 获取当前选中的 VL（定位）模型 ID */
        function getCurrentModelId() {
            const sel = document.getElementById('aiModelSelect');
            if (sel && sel.value) return sel.value;
            return 'Qwen/Qwen3-VL-235B-A22B-Instruct';
        }

        /** 手动重新触发某步骤的 VLM OCR（编辑器内 ↺ 按钮） */
        window.aiRetriggerOcr = async function(idx) {
            const step = aiState.scriptSteps[idx];
            if (!step) return;
            const screenshot = step.locators?.imageTemplate?.screenshot;
            if (!screenshot) { showToast('该步骤没有图像模板，无法重新识别', 'warn'); return; }
            const modelId = getCurrentModelId();
            // 标记 pending
            if (!step.locators) step.locators = {};
            step.locators.textContent = { pending: true, source: 'ocr', enabled: true, priority: 3, matchIndex: 0 };
            renderScriptSteps();
            const overlay = document.querySelector('.ai-step-edit-overlay');
            if (overlay) { overlay.remove(); aiOpenStepEditor(idx); }

            try {
                const resp = await fetch('http://127.0.0.1:3100/api/vlm-ocr/start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ screenshot, modelId, stepId: step.id }),
                });
                const { taskId } = await resp.json();
                let attempts = 0;
                const poll = setInterval(async () => {
                    attempts++;
                    try {
                        const r = await fetch(`http://127.0.0.1:3100/api/vlm-ocr/result/${taskId}`);
                        const data = await r.json();
                        if (data.status === 'done') {
                            clearInterval(poll);
                            const engine = data.engine || 'vlm';
                            step.locators.textContent = data.text
                                ? { value: data.text, source: engine === 'OCR' ? 'ocr' : 'vlm', ...(engine !== 'OCR' ? { vlmModel: modelId } : {}), enabled: true, priority: 3, matchIndex: 0, pending: false }
                                : { pending: false, source: 'ocr', enabled: false };
                            renderScriptSteps();
                            if (data.text) addAiLog(`🔤 步骤 "${step.description || step.action}" 识别文字(${engine}): "${data.text}"`);
                        } else if (data.status === 'error' || attempts >= 30) {
                            clearInterval(poll);
                            step.locators.textContent = { pending: false, source: 'ocr', enabled: false };
                            renderScriptSteps();
                        }
                    } catch (_) { if (attempts >= 30) clearInterval(poll); }
                }, 2000);
            } catch (_) {
                step.locators.textContent = { pending: false, source: 'ocr', enabled: false };
                renderScriptSteps();
            }
        };

        window.aiToggleStepMenu = function(btn) {
            const more = btn.closest('.ai-step-more');
            if (!more) return;
            const wasOpen = more.classList.contains('open');
            aiCloseStepMenus();
            if (!wasOpen) {
                more.classList.add('open');
                const block = more.closest('.ai-logic-block');
                if (block) block.classList.add('menu-open-boost');
            }
        };

        window.aiCloseStepMenus = function() {
            document.querySelectorAll('.ai-step-more.open').forEach(el => el.classList.remove('open'));
            document.querySelectorAll('.ai-logic-block.menu-open-boost').forEach(el => el.classList.remove('menu-open-boost'));
        };

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.ai-step-more')) aiCloseStepMenus();
        });

        // 行间隙 hover：展示“虚按钮”
        let _hoverClearTimer: ReturnType<typeof setTimeout> | null = null;
        function toggleLogicBodyPreview(stepId, enabled) {
            if (!stepId || !dom.scriptSteps) return;
            const previewBlock = dom.scriptSteps.querySelector(`.ai-logic-block[data-step-id="${stepId}"]`);
            if (previewBlock) previewBlock.classList.toggle('logic-preview-open', enabled);
        }
        window.aiSetHoverInsertAfter = function(idx, parentId) {
            if (!Number.isFinite(idx)) return;
            parentId = parentId || null;
            if (_hoverClearTimer) { clearTimeout(_hoverClearTimer); _hoverClearTimer = null; }
            const prevParentId = aiState.hoverGapParentId || null;
            if (prevParentId && prevParentId !== parentId) toggleLogicBodyPreview(prevParentId, false);
            const changed = aiState.hoverInsertAfterIndex !== idx || aiState.hoverGapParentId !== parentId;
            aiState.hoverInsertAfterIndex = idx;
            aiState.hoverGapParentId = parentId;
            if (parentId) toggleLogicBodyPreview(parentId, true);
        };
        window.aiClearHoverInsertAfter = function(idx, parentId) {
            parentId = parentId || null;
            if (aiState.hoverInsertAfterIndex !== idx || aiState.hoverGapParentId !== parentId) return;
            if (_hoverClearTimer) clearTimeout(_hoverClearTimer);
            _hoverClearTimer = setTimeout(() => {
                _hoverClearTimer = null;
                if (aiState.hoverInsertAfterIndex !== idx || aiState.hoverGapParentId !== parentId) return;
                aiState.hoverInsertAfterIndex = -1;
                aiState.hoverGapParentId = null;
                if (parentId) toggleLogicBodyPreview(parentId, false);
            }, 60);
        };

        // 点击“虚按钮”：将上一行设为生效行（插入点），并切换为“实按钮”
        window.aiPinInsertAfter = function(idx, parentId) {
            if (!Number.isFinite(idx)) return;
            aiState.insertAfterIndex = idx;
            aiState.activeGapParentId = parentId || null;
            aiState.activeGapExplicit = true;
            aiState.hoverInsertAfterIndex = -1;
            aiState.hoverGapParentId = null;
            renderScriptSteps();
        };

        // 逻辑组高亮
        window.aiHighlightLogicGroup = function(groupId) {
            if (!groupId || !dom.scriptSteps) return;
            dom.scriptSteps.querySelectorAll(`[data-logic-group="${groupId}"]`).forEach(el => {
                el.classList.add('logic-group-highlight');
            });
        };

        window.aiClearLogicGroupHighlight = function() {
            if (!dom.scriptSteps) return;
            dom.scriptSteps.querySelectorAll('.logic-group-highlight').forEach(el => {
                el.classList.remove('logic-group-highlight');
            });
        };

        // 展开/收起逻辑步骤的子步骤
        window.aiToggleLogicCollapse = function(stepId) {
            if (!stepId) return;
            if (aiState.collapsedLogicIds.has(stepId)) {
                aiState.collapsedLogicIds.delete(stepId);
            } else {
                aiState.collapsedLogicIds.add(stepId);
            }
            renderScriptSteps();
        };

        // 在指定步骤之后新建一条空步骤，并打开编辑弹框
        window.aiCreateStepAfter = function(afterIdx) {
            if (!Number.isFinite(afterIdx)) return;
            const insertAt = Math.min(Math.max(afterIdx + 1, 0), aiState.scriptSteps.length);
            if (aiState.selectedStepIndices && aiState.selectedStepIndices.size) {
                const next = new Set<number>();
                for (const i of aiState.selectedStepIndices) {
                    next.add(i >= insertAt ? i + 1 : i);
                }
                aiState.selectedStepIndices = next;
            }

            const newStep = {
                id: `step_${generateId()}`,
                action: 'click',
                target: '',
                value: '',
                description: '',
                locators: {},
                status: 'pending',
                _isNew: true,
            };

            aiState.scriptSteps.splice(insertAt, 0, newStep);

            // 若用户显式选择了生效行（insertAfterIndex>=0），则“光标”跟随新建的空步骤；
            // 默认模式（insertAfterIndex === -1）保持默认：始终以最后一行为生效行
            if (aiState.insertAfterIndex >= 0) {
                aiState.insertAfterIndex = insertAt;
            }

            renderScriptSteps();
            scheduleScrollNewStepIntoView(insertAt);
            window.aiOpenStepEditor?.(insertAt);
        };

        // 新建步骤：先弹表单，不在列表中生成空行；保存成功后才插入
        window.aiOpenNewStepEditor = function(afterIdx) {
            if (!Number.isFinite(afterIdx)) return;
            aiState.newStepDraft = {
                afterIdx,
                step: {
                    id: `step_${generateId()}`,
                    action: 'click',
                    target: '',
                    value: '',
                    description: '',
                    locators: {},
                    status: 'pending',
                    _isNew: true,
                },
            };
            window.aiOpenStepEditor?.(-1);
        };

        // 在逻辑步骤内新增子步骤（afterIdx = 插入在此索引之后）
        window.aiOpenNewChildStepEditor = function(parentId, afterIdx) {
            if (!parentId) return;
            aiState.newStepDraft = {
                afterIdx: afterIdx,
                parentId: parentId,
                step: {
                    id: `step_${generateId()}`,
                    action: 'click',
                    target: '',
                    value: '',
                    description: '',
                    locators: {},
                    status: 'pending',
                    parentId: parentId,
                    _isNew: true,
                },
            };
            window.aiOpenStepEditor?.(-1);
        };

        // 新增步骤后：自动滚动该步骤到可视范围（去抖，批量加入时只滚到最后一条）
        let _pendingNewStepScrollIdx: number | null = null;
        let _pendingNewStepScrollRaf = 0;
        function _scrollScriptStepIntoView(idx: number, attempt = 0) {
            const card = dom.scriptSteps?.querySelector?.(`[data-step-idx="${idx}"]`) as HTMLElement | null;
            if (card) {
                card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                return;
            }
            if (attempt < 2) {
                setTimeout(() => _scrollScriptStepIntoView(idx, attempt + 1), 50);
            }
        }
        function scheduleScrollNewStepIntoView(idx: number) {
            if (!Number.isFinite(idx)) return;
            _pendingNewStepScrollIdx = idx;
            if (_pendingNewStepScrollRaf) return;
            _pendingNewStepScrollRaf = requestAnimationFrame(() => {
                _pendingNewStepScrollRaf = 0;
                const targetIdx = _pendingNewStepScrollIdx;
                _pendingNewStepScrollIdx = null;
                if (targetIdx == null) return;
                _scrollScriptStepIntoView(targetIdx, 0);
            });
        }

        /**
         * 在当前插入点插入步骤。校验不通过时弹 toast 并返回 false，不生成步骤。
         * @returns boolean — true=插入成功, false=被校验阻止
         */
        function insertStepAtPoint(newStep) {
            const step = { ...newStep, id: newStep.id || `step_${generateId()}`, status: 'pending' };
            if (aiState.activeGapParentId) step.parentId = aiState.activeGapParentId;
            const afterIdx = aiState.insertAfterIndex;
            const parentId = step.parentId || null;
            // 校验：如果会打断逻辑组，阻止插入
            if (step.stepType !== 'logic' && afterIdx >= 0 && afterIdx < aiState.scriptSteps.length) {
                const nlv = validateNonLogicInsertAt(afterIdx, parentId);
                if (!nlv.ok) {
                    showToast?.(`⛔ ${nlv.reason}`, 'error');
                    return false;
                }
            }
            if (afterIdx >= 0 && afterIdx < aiState.scriptSteps.length) {
                const pos = afterIdx + 1;
                aiState.scriptSteps.splice(pos, 0, step);
                aiState.insertAfterIndex = pos;
                scheduleScrollNewStepIntoView(pos);
            } else {
                aiState.scriptSteps.push(step);
                scheduleScrollNewStepIntoView(aiState.scriptSteps.length - 1);
            }
            return true;
        }

        // 添加步骤到脚本编辑区（仅可执行的动作步骤）
        window.aiAddStepToScript = function(step) {
            if (!isExecutableStep(step)) {
                addAiLog(`ℹ️ "${getActionLabel(step.action)}" 是非执行步骤，已跳过`);
                return;
            }
            if (!insertStepAtPoint(step)) return;
            recomputeAllLogicGroupIds();
            renderScriptSteps();
        };

        // 批量添加步骤（自动过滤非可执行步骤）+ closeFloat 参数：来自浮框的"全部加入"
        window.aiAddAllStepsToScript = function(steps, closeFloat) {
            const executableSteps = steps.filter(isExecutableStep);
            if (executableSteps.length === 0) {
                showToast('没有可执行的动作步骤', 'warn');
                return;
            }
            let inserted = 0;
            let blocked = 0;
            const skipped = steps.length - executableSteps.length;
            for (const step of executableSteps) {
                if (insertStepAtPoint(step)) {
                    inserted++;
                } else {
                    blocked++;
                }
            }
            recomputeAllLogicGroupIds();
            renderScriptSteps();
            executableSteps.forEach((step, i) => {
                const idx = steps.indexOf(step);
                if (idx >= 0) stepsFloat.markAdded(idx);
            });
            let msg = `已加入 ${inserted} 个步骤`;
            if (blocked > 0) msg += `（${blocked} 个因逻辑组冲突被阻止）`;
            if (skipped > 0) msg += `（跳过 ${skipped} 个非执行步骤）`;
            showToast(msg, inserted > 0 ? 'success' : 'warn');
            addAiLog(`ℹ️ ${msg}`);
            if (closeFloat) {
                setTimeout(() => stepsFloat.close(), 600);
            }
        };

        // 移除步骤（逻辑步骤同时移除所有子步骤）
        window.aiRemoveStep = async function(idx) {
            const s = aiState.scriptSteps[idx];
            if (s && s._regenerating) {
                showToast?.('该步骤正在重新生成中，请稍后再试', 'warn');
                return;
            }

            // 逻辑组完整性校验
            const dv = validateDeleteStep(idx);
            if (!dv.ok) {
                // 删除 IF 头部会导致逻辑组断裂，提示用户选择删除整个逻辑组
                const groupSteps = dv.groupIndices.map(i => `#${i + 1} ${getLogicLabel(aiState.scriptSteps[i]?.logicType)}`).join(' → ');
                const ok = window.showConfirmDialog
                    ? await window.showConfirmDialog(
                        `${dv.reason}`,
                        `逻辑组：${groupSteps}\n${dv.cascadeWarning || '确定要删除整个逻辑组吗？'}`,
                        'danger', '删除整个逻辑组', '取消')
                    : confirm(`${dv.reason}\n${dv.cascadeWarning || '确定删除整个逻辑组？'}`);
                if (!ok) return;
                // 删除整个逻辑组（含子步骤）
                const toRemoveAll = new Set<number>();
                for (const gi of dv.groupIndices) {
                    toRemoveAll.add(gi);
                    // 也要递归收集每个逻辑步骤的子步骤
                    const gs = aiState.scriptSteps[gi];
                    if (gs && (gs.stepType === 'logic' || gs.stepType === 'loop')) {
                        for (let i = 0; i < aiState.scriptSteps.length; i++) {
                            if (aiState.scriptSteps[i].parentId === gs.id) toRemoveAll.add(i);
                        }
                    }
                }
                const sorted = Array.from(toRemoveAll).sort((a, b) => b - a);
                for (const ri of sorted) {
                    aiState.scriptSteps.splice(ri, 1);
                }
                aiState.insertAfterIndex = -1;
                aiState.activeGapParentId = null;
                aiState.activeGapExplicit = false;
                aiState.hoverInsertAfterIndex = -1;
                aiState.hoverGapParentId = null;
                aiState.selectedStepIndices.clear();
                recomputeAllLogicGroupIds();
                renderScriptSteps();
                return;
            }

            // 若为逻辑步骤，收集并一起删除其子步骤
            let removeCount = 1;
            if (s && (s.stepType === 'logic' || s.stepType === 'loop')) {
                const childIds = [];
                for (let i = aiState.scriptSteps.length - 1; i > idx; i--) {
                    if (aiState.scriptSteps[i].parentId === s.id) {
                        childIds.push(i);
                    }
                }
                childIds.forEach(ci => aiState.scriptSteps.splice(ci, 1));
                removeCount += childIds.length;
            }
            const oldLen = aiState.scriptSteps.length;
            const hadPinned =
                aiState.insertAfterIndex >= 0 && aiState.insertAfterIndex < oldLen;
            const activeIdx = hadPinned ? aiState.insertAfterIndex : oldLen - 1;
            const removedWasActive = idx === activeIdx;
            aiState.scriptSteps.splice(idx, 1);
            if (hadPinned) {
                if (idx < aiState.insertAfterIndex) {
                    aiState.insertAfterIndex--;
                } else if (idx === aiState.insertAfterIndex) {
                    const newLen = aiState.scriptSteps.length;
                    if (newLen <= 0) {
                        aiState.insertAfterIndex = -1;
                    } else {
                        aiState.insertAfterIndex = Math.max(0, idx - 1);
                    }
                }
            } else if (removedWasActive) {
                aiState.activeGapParentId = null;
                aiState.activeGapExplicit = false;
            }

            if (aiState.hoverInsertAfterIndex >= 0) {
                if (idx < aiState.hoverInsertAfterIndex) aiState.hoverInsertAfterIndex--;
                else if (idx === aiState.hoverInsertAfterIndex) { aiState.hoverInsertAfterIndex = -1; aiState.hoverGapParentId = null; }
            }
            const newSet = new Set<number>();
            for (const i of aiState.selectedStepIndices) {
                if (i < idx) newSet.add(i);
                else if (i > idx) newSet.add(i - 1);
            }
            aiState.selectedStepIndices = newSet;
            recomputeAllLogicGroupIds();
            renderScriptSteps();
        };

        /**
         * 校验移动后是否产生非法的逻辑链状态。
         * 对模拟后的步骤数组，检查每个 else_if/else 前方是否紧跟 if/else_if，
         * 以及非逻辑步骤是否夹在 if/elif 和 elif/else 之间。
         */
        function validateMoveResult(simSteps) {
            const byParent = {};
            simSteps.forEach((s, i) => {
                const pid = s.parentId || '__root__';
                if (!byParent[pid]) byParent[pid] = [];
                byParent[pid].push(i);
            });
            for (const indices of Object.values(byParent) as number[][]) {
                for (let p = 0; p < indices.length; p++) {
                    const cur = simSteps[indices[p]];
                    const prev = p > 0 ? simSteps[indices[p - 1]] : null;
                    // else_if/else 前方必须紧跟 if/else_if
                    if (cur.stepType === 'logic' && (cur.logicType === 'else_if' || cur.logicType === 'else')) {
                        if (!prev || prev.stepType !== 'logic' || !(prev.logicType === 'if' || prev.logicType === 'else_if')) {
                            return { ok: false, reason: `${getLogicLabel(cur.logicType)} 前方必须有 IF / ELIF` };
                        }
                    }
                    // 非逻辑步骤不能夹在 if/elif → elif/else 之间
                    if (cur.stepType !== 'logic' && prev?.stepType === 'logic') {
                        const next = p + 1 < indices.length ? simSteps[indices[p + 1]] : null;
                        if (next?.stepType === 'logic'
                            && (prev.logicType === 'if' || prev.logicType === 'else_if')
                            && (next.logicType === 'else_if' || next.logicType === 'else')) {
                            return { ok: false, reason: '移动会打断 if/else 逻辑组' };
                        }
                    }
                }
            }
            return { ok: true, reason: '' };
        }

        // 移动步骤（含逻辑链校验）
        window.aiMoveStep = function(idx, direction) {
            const newIdx = idx + direction;
            if (newIdx < 0 || newIdx >= aiState.scriptSteps.length) return;

            const simSteps = aiState.scriptSteps.slice();
            const [removed] = simSteps.splice(idx, 1);
            simSteps.splice(newIdx, 0, removed);
            const mv = validateMoveResult(simSteps);
            if (!mv.ok) {
                showToast?.(`⛔ ${mv.reason}`, 'error');
                return;
            }

            if (aiState.insertAfterIndex === idx) aiState.insertAfterIndex = newIdx;
            else if (aiState.insertAfterIndex === newIdx) aiState.insertAfterIndex = idx;
            const [step] = aiState.scriptSteps.splice(idx, 1);
            aiState.scriptSteps.splice(newIdx, 0, step);
            recomputeAllLogicGroupIds();
            renderScriptSteps();
        };

        // 选中/取消选中步骤
        function syncDeleteBtnState() {
            const hasSelected = aiState.selectedStepIndices.size > 0;
            const delBtn = document.getElementById('aiHeaderClearBtn') as HTMLButtonElement | null;
            if (delBtn) {
                delBtn.disabled = !hasSelected;
                delBtn.title = hasSelected ? `删除选中的 ${aiState.selectedStepIndices.size} 个步骤` : '删除（请先选中步骤）';
            }
            const copyBtn = document.getElementById('aiHeaderCopyBtn') as HTMLButtonElement | null;
            if (copyBtn) {
                copyBtn.disabled = !hasSelected;
                copyBtn.title = hasSelected ? `复制选中的 ${aiState.selectedStepIndices.size} 个步骤` : '复制（请先选中步骤）';
            }
        }

        function collectAllGroupIndices(idx) {
            const steps = aiState.scriptSteps || [];
            const step = steps[idx];
            if (!step) return [idx];
            const isLogic = step.stepType === 'logic' && step.logicGroupId;
            const groupMembers = isLogic ? getLogicGroupIndices(idx) : [idx];

            const childMap = {};
            steps.forEach((s, i) => {
                if (s.parentId) {
                    if (!childMap[s.parentId]) childMap[s.parentId] = [];
                    childMap[s.parentId].push(i);
                }
            });
            const all = new Set<number>();
            for (const mi of groupMembers) {
                all.add(mi);
                const stack = [steps[mi]?.id];
                while (stack.length) {
                    const pid = stack.pop();
                    if (!pid) continue;
                    const kids = childMap[pid] || [];
                    for (const k of kids) {
                        if (!all.has(k)) {
                            all.add(k);
                            if (steps[k]?.id) stack.push(steps[k].id);
                        }
                    }
                }
            }
            return Array.from(all);
        }

        window.aiToggleStepSelect = function(idx) {
            const steps = aiState.scriptSteps || [];
            const step = steps[idx];
            const isLogic = step && step.stepType === 'logic';
            const affectedIndices = isLogic ? collectAllGroupIndices(idx) : [idx];
            const wasSelected = aiState.selectedStepIndices.has(idx);

            for (const i of affectedIndices) {
                if (wasSelected) {
                    aiState.selectedStepIndices.delete(i);
                } else {
                    aiState.selectedStepIndices.add(i);
                }
            }

            for (const i of affectedIndices) {
                const card = dom.scriptSteps?.querySelector(`.ai-step-card[data-step-idx="${i}"]`);
                const sel = card?.querySelector('.ai-step-sel');
                if (card && sel) {
                    card.classList.toggle('selected', aiState.selectedStepIndices.has(i));
                    sel.classList.toggle('checked', aiState.selectedStepIndices.has(i));
                }
            }
            syncDeleteBtnState();
        };

        // 删除选中步骤
        window.aiClearAllSteps = async function() {
            if (aiState.selectedStepIndices.size === 0) return;
            const count = aiState.selectedStepIndices.size;

            // 预检：模拟删除后是否产生孤立的 else_if/else
            const preCheckSet = new Set<number>(aiState.selectedStepIndices);
            const simSteps = aiState.scriptSteps.filter((_, i) => !preCheckSet.has(i));
            const mv = validateMoveResult(simSteps);
            let confirmMsg = '此操作不可撤销。';
            if (!mv.ok) {
                confirmMsg = `⚠️ ${mv.reason}\n\n删除后会产生语法错误的逻辑结构，建议调整选中范围。\n仍然继续？`;
            }

            const ok = window.showConfirmDialog
                ? await window.showConfirmDialog(`删除选中的 ${count} 个步骤？`, confirmMsg, 'danger', '删除', '取消')
                : confirm(`确定删除选中的 ${count} 个步骤？\n${confirmMsg}`);
            if (!ok) return;
            const toRemove = Array.from(aiState.selectedStepIndices).sort((a, b) => b - a);
            const oldLen = aiState.scriptSteps.length;
            const hadPinned =
                aiState.insertAfterIndex >= 0 && aiState.insertAfterIndex < oldLen;
            const pinnedIdxOld = hadPinned ? aiState.insertAfterIndex : -1;
            const removeSet = new Set<number>(toRemove);
            const removedPinned = hadPinned && removeSet.has(pinnedIdxOld);
            const removedBeforePinned =
                hadPinned ? toRemove.filter((i) => i < pinnedIdxOld).length : 0;

            for (const idx of toRemove) {
                aiState.scriptSteps.splice(idx, 1);
            }
            aiState.selectedStepIndices.clear();
            // 删除后插入点回退：若原来钉住的生效行未被删，则保持钉住（索引随删除前项左移）；
            // 若被删，则钉住回退到“原生效行的上一行”（删除集里向上找第一个未删的）
            if (hadPinned) {
                if (!removedPinned) {
                    aiState.insertAfterIndex = pinnedIdxOld - removedBeforePinned;
                } else {
                    let prevSurvivorOld = -1;
                    for (let i = pinnedIdxOld - 1; i >= 0; i--) {
                        if (!removeSet.has(i)) {
                            prevSurvivorOld = i;
                            break;
                        }
                    }
                    if (prevSurvivorOld < 0) {
                        aiState.insertAfterIndex = -1;
                    } else {
                        const removedBeforePrev = toRemove.filter((i) => i < prevSurvivorOld).length;
                        aiState.insertAfterIndex = prevSurvivorOld - removedBeforePrev;
                    }
                }
            } else {
                aiState.insertAfterIndex = -1;
                aiState.activeGapParentId = null;
                aiState.activeGapExplicit = false;
            }
            aiState.hoverInsertAfterIndex = -1;
            aiState.hoverGapParentId = null;
            recomputeAllLogicGroupIds();
            renderScriptSteps();
        };

        // 复制选中步骤到最后一行
        window.aiCopySelectedSteps = function() {
            if (aiState.selectedStepIndices.size === 0) return;
            const steps = aiState.scriptSteps;
            const selIndices = Array.from(aiState.selectedStepIndices).sort((a, b) => a - b);
            const selSet = new Set(selIndices);

            // 构建 id → 新 id 映射表，以及 logicGroupId → 新 logicGroupId 映射
            const idMap = new Map<string, string>();
            const groupIdMap = new Map<string, string>();
            for (const i of selIndices) {
                const s = steps[i];
                if (s?.id) idMap.set(s.id, `step_${generateId()}`);
                if (s?.logicGroupId && !groupIdMap.has(s.logicGroupId)) {
                    groupIdMap.set(s.logicGroupId, generateGroupId());
                }
            }

            // 深拷贝选中步骤，重写 id / parentId / logicGroupId
            const cloned: any[] = [];
            for (const i of selIndices) {
                const s = JSON.parse(JSON.stringify(steps[i]));
                const oldId = s.id;
                s.id = idMap.get(oldId) || `step_${generateId()}`;

                // parentId：如果父也在选中集内，映射为新 id；否则清除（提升为顶层）
                if (s.parentId) {
                    const newPid = idMap.get(s.parentId);
                    if (newPid) {
                        s.parentId = newPid;
                    } else {
                        delete s.parentId;
                    }
                }

                // logicGroupId 映射
                if (s.logicGroupId) {
                    s.logicGroupId = groupIdMap.get(s.logicGroupId) || s.logicGroupId;
                }

                // 清除运行时状态
                delete s.status;
                delete s.error;
                delete s._regenerating;
                delete s._regenError;
                delete s._errorKind;
                delete s._userError;

                cloned.push(s);
            }

            // 追加到步骤列表末尾
            aiState.scriptSteps.push(...cloned);

            // 生效行移到最后一步
            aiState.insertAfterIndex = aiState.scriptSteps.length - 1;
            aiState.activeGapParentId = null;
            aiState.activeGapExplicit = false;

            recomputeAllLogicGroupIds();
            renderScriptSteps();
            showToast(`已复制 ${cloned.length} 个步骤`, 'success');
        };

        // ─── 步骤编辑弹框 ────────────────────────────────────

        // ── 定位器类型定义 ──
        const LOCATOR_TYPES = [
            { key: 'xpath',            icon: 'code',    label: 'XPath',    desc: 'DOM 路径定位' },
            { key: 'cssSelector',      icon: 'palette', label: 'CSS',      desc: 'CSS 选择器' },
            { key: 'textContent',      icon: 'type',    label: '文本/OCR', desc: '文本内容匹配 / OCR' },
            { key: 'imageTemplate',    icon: 'image',   label: '图像',     desc: 'Airtest 图像模板匹配' },
            { key: 'normalizedCoords', icon: 'ruler',   label: '坐标',     desc: '归一化坐标（自适应分辨率）' },
            { key: 'aiLocate',         icon: 'bot',     label: 'AI定位',   desc: 'Midscene AI 智能定位（截图+DOM+大模型）' },
        ];

        function _getLocatorOrder(locators) {
            const keys = LOCATOR_TYPES.map(t => t.key);
            return keys.slice().sort((a, b) => {
                const pa = locators[a]?.priority ?? (keys.indexOf(a) + 1);
                const pb = locators[b]?.priority ?? (keys.indexOf(b) + 1);
                return pa - pb;
            });
        }

	        function buildLocatorTabsHTML(locators, orderedKeys) {
	            const ordered = orderedKeys || LOCATOR_TYPES.map(t => t.key);
	            return ordered.map((key, i) => {
	                const t = LOCATOR_TYPES.find(x => x.key === key);
	                if (!t) return '';
	                const loc = locators[t.key];
	                const isPending = loc?.pending === true;
	                const hasValue = loc && (loc.value || loc.screenshot || loc.xPercent || isPending);
	                const enabled = loc?.enabled !== false && hasValue;
	                const dotHTML = isPending
	                    ? `<span class="loc-ocr-spinner loc-ocr-spinner--sm" aria-hidden="true"></span>`
	                    : `<span class="tab-dot ${enabled ? 'on' : 'off'}"></span>`;
	                const isFirst = i === 0;
	                return `<button class="locator-tab${isFirst ? ' active' : ''}" type="button"
	                    id="locator-tab-${t.key}"
	                    role="tab" aria-selected="${isFirst ? 'true' : 'false'}" tabindex="${isFirst ? '0' : '-1'}"
	                    aria-controls="locator-panel-${t.key}"
	                    data-loc-key="${t.key}" draggable="true"
	                    onclick="window._switchLocTab('${t.key}')"
	                    ondragstart="window._locTabDragStart(event)" ondragend="window._locTabDragEnd(event)"
	                    ondragover="window._locTabDragOver(event)" ondrop="window._locTabDrop(event)"
	                    ondragleave="window._locTabDragLeave(event)">
	                    ${dotHTML}${iconSvg(t.icon, 'ctl-icon ctl-icon--sm loc-tab-icon')}<span class="loc-tab-label">${t.label}</span>
	                </button>`;
	            }).join('');
	        }

        function buildLocatorPanelsHTML(locators, step, stepIdx, orderedKeys) {
            const ordered = orderedKeys || LOCATOR_TYPES.map(t => t.key);
            return ordered.map((key, orderIdx) => {
                const t = LOCATOR_TYPES.find(x => x.key === key);
                if (!t) return '';
                const loc = locators[t.key] || {};
                const enabled = loc.enabled !== false;
                const priority = orderIdx + 1;
                const idx = stepIdx;
                const isActive = orderIdx === 0 ? ' active' : '';

                let bodyHTML = '';
                switch (t.key) {
                    case 'xpath':
                        bodyHTML = `
                            <div class="loc-row">
                                <span class="loc-label">值:</span>
                                <input class="loc-input" data-loc-field="xpath.value" value="${escapeHtml(loc.value || step.xpath || '')}" placeholder="//*[@id='...']">
                            </div>
                            ${step.xpathInfo ? `<div class="loc-preview loc-hint">标签: &lt;${escapeHtml(step.xpathInfo.tagName || '')}&gt;${step.xpathInfo.text ? '　文本: "' + escapeHtml(step.xpathInfo.text.substring(0, 50)) + '"' : ''}</div>` : ''}`;
                        break;
                    case 'cssSelector':
                        bodyHTML = `
                            <div class="loc-row">
                                <span class="loc-label">值:</span>
                                <input class="loc-input" data-loc-field="cssSelector.value" value="${escapeHtml(loc.value || '')}" placeholder="#id / .class / tag">
                            </div>
                            <div class="loc-row">
                                <span class="loc-label">索引:</span>
                                <input class="loc-input loc-input--num-sm" data-loc-field="cssSelector.matchIndex" type="number" min="0" value="${loc.matchIndex ?? 0}">
                                <span class="loc-hint">匹配多个元素时取第 N 个（从 0 开始，按从上到下、从左到右排序）</span>
                            </div>`;
                        break;
                    case 'textContent': {
                        const isPending = loc.pending === true;
                        const isOcr = loc.source === 'ocr' || loc.source === 'vlm';
                        const isDom = !isOcr;
                        const sourceBadge = isOcr
                            ? `<span class="loc-source-badge loc-source-badge--ocr" title="由 RapidOCR 本地引擎识别（精确坐标）">OCR</span>`
                            : `<span class="loc-source-badge loc-source-badge--dom" title="从 DOM 属性读取">DOM</span>`;
                        const retryBtn = isOcr
                            ? `<button type="button" class="loc-mini-btn" onclick="aiRetriggerOcr(${idx})" title="重新识别">↺</button>`
                            : '';
                        const hintText = isOcr
                            ? 'RapidOCR 本地识别 — 回放时在截图中精确定位文字坐标'
                            : '回放时使用 Playwright DOM 文本匹配';
                        if (isPending) {
                            bodyHTML = `
                                <div class="loc-row loc-row--center">
                                    <span class="loc-label">文本:</span>${sourceBadge}
                                    <span class="loc-pending-text">
                                        <span class="loc-ocr-spinner" aria-hidden="true"></span>正在分析文本，请稍候…
                                    </span>
                                </div>
                                <div class="loc-preview loc-hint">${hintText}</div>`;
                        } else {
                            bodyHTML = `
                                <div class="loc-row">
                                    <span class="loc-label">文本:</span>${sourceBadge}${retryBtn}
                                    <input class="loc-input" data-loc-field="textContent.value" value="${escapeHtml(loc.value || '')}" placeholder="${isDom ? '元素可见文本' : '等待识别…'}">
                                </div>
                                <div class="loc-row">
                                    <span class="loc-label">索引:</span>
                                    <input class="loc-input loc-input--num-sm" data-loc-field="textContent.matchIndex" type="number" min="0" value="${loc.matchIndex ?? 0}">
                                    <span class="loc-hint">匹配多个元素时取第 N 个（从 0 开始）</span>
                                </div>
                                <div class="loc-preview loc-hint">${hintText}</div>`;
                        }
                        break;
                    }
                    case 'imageTemplate':
                        bodyHTML = `
                            <div class="loc-row">
                                <span class="loc-label">阈值:</span>
                                <input class="loc-input loc-input--num-md" data-loc-field="imageTemplate.threshold" type="number" step="0.05" min="0.5" max="1" value="${loc.threshold || 0.8}">
                                <span class="loc-hint">（0.5~1.0，越高越严格）</span>
                            </div>
                            <div class="loc-row">
                                <span class="loc-label">索引:</span>
                                <input class="loc-input loc-input--num-sm" data-loc-field="imageTemplate.matchIndex" type="number" min="0" value="${loc.matchIndex ?? 0}">
                                <span class="loc-hint">匹配多个区域时取第 N 个（从 0 开始）</span>
                            </div>
                            ${loc.screenshot
                                ? `<div class="loc-preview">
                                    <img src="data:image/jpeg;base64,${loc.screenshot}" alt="模板图像"
                                        onclick="showImgPreview('data:image/jpeg;base64,${loc.screenshot}')"
                                        title="点击查看大图">
                                    <div class="img-hint">点击可放大查看</div>
                                   </div>`
                                : '<div class="loc-preview loc-preview--empty">未捕获模板图片（AI 执行时自动截取元素区域）</div>'}`;

                        break;
                    case 'normalizedCoords':
                        bodyHTML = `
                            <div class="loc-row">
                                <span class="loc-label">X%:</span>
                                <input class="loc-input loc-input--num-md" data-loc-field="normalizedCoords.xPercent" type="number" step="0.01" value="${loc.xPercent || ''}">
                                <span class="loc-label loc-label--compact">Y%:</span>
                                <input class="loc-input loc-input--num-md" data-loc-field="normalizedCoords.yPercent" type="number" step="0.01" value="${loc.yPercent || ''}">
                                <span class="loc-hint">（0–100）</span>
                            </div>
                            ${loc.viewportWidth ? `<div class="loc-preview loc-hint">基准视口: ${loc.viewportWidth}×${loc.viewportHeight}px${step.coordinates ? '　绝对坐标: (' + step.coordinates.x + ', ' + step.coordinates.y + ')' : ''}</div>` : ''}`;
                        break;
                    case 'aiLocate':
                        bodyHTML = `
                            <div class="loc-row">
                                <span class="loc-label">描述:</span>
                                <input class="loc-input" data-loc-field="aiLocate.value" value="${escapeHtml(loc.value || step.description || step.target || '')}" placeholder="AI 自然语言元素描述">
                            </div>
                            <div class="loc-preview loc-hint">回放时调用 Midscene aiTap，利用截图+DOM树+大模型综合分析定位元素（与录制时相同的 AI 机制）</div>`;
                        break;
                }

                return `<div class="locator-panel${isActive}" data-loc-panel="${t.key}"
                    id="locator-panel-${t.key}"
                    role="tabpanel" aria-labelledby="locator-tab-${t.key}"
                    ${orderIdx === 0 ? '' : 'hidden'} aria-hidden="${orderIdx === 0 ? 'false' : 'true'}">
                    <div class="loc-row loc-row--head">
                        <span class="loc-label">启用:</span>
                        <button class="loc-toggle ${enabled ? 'on' : 'off'}" type="button"
                            aria-pressed="${enabled ? 'true' : 'false'}" aria-label="启用 ${t.label}"
                            data-loc-toggle="${t.key}" onclick="window._toggleLocator('${t.key}')"></button>
                        <span class="loc-label loc-label--auto">优先级:</span>
                        <span data-loc-priority="${t.key}" class="loc-priority-number">${priority}</span>
                        <span class="loc-priority-hint">（拖拽选项卡调整）</span>
                        <span class="loc-spacer" aria-hidden="true"></span>
                        <span class="loc-desc">${t.desc}</span>
                    </div>
                    ${bodyHTML}
                </div>`;
            }).join('');
        }

        window._switchLocTab = function(key) {
            document.querySelectorAll('.locator-tab').forEach(t => {
                const tab = t as HTMLElement;
                const active = tab.dataset.locKey === key;
                tab.classList.toggle('active', active);
                tab.setAttribute('aria-selected', active ? 'true' : 'false');
                tab.tabIndex = active ? 0 : -1;
            });
            document.querySelectorAll('.locator-panel').forEach(p => {
                const panel = p as HTMLElement;
                const active = panel.dataset.locPanel === key;
                panel.classList.toggle('active', active);
                panel.toggleAttribute('hidden', !active);
                panel.setAttribute('aria-hidden', active ? 'false' : 'true');
            });
        };

        // ── 选项卡拖拽排序 ──
        let _draggedLocTab = null;
        window._locTabDragStart = function(e) {
            _draggedLocTab = e.currentTarget;
            _draggedLocTab.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', e.currentTarget.dataset.locKey);
        };
        window._locTabDragEnd = function(e) {
            if (_draggedLocTab) _draggedLocTab.classList.remove('dragging');
            _draggedLocTab = null;
            document.querySelectorAll('.locator-tab').forEach(t => {
                t.classList.remove('drag-over-left', 'drag-over-right');
            });
        };
        window._locTabDragOver = function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const tab = e.currentTarget;
            if (tab === _draggedLocTab) return;
            tab.classList.remove('drag-over-left', 'drag-over-right');
            const rect = tab.getBoundingClientRect();
            const midX = rect.left + rect.width / 2;
            tab.classList.add(e.clientX < midX ? 'drag-over-left' : 'drag-over-right');
        };
        window._locTabDragLeave = function(e) {
            e.currentTarget.classList.remove('drag-over-left', 'drag-over-right');
        };
        window._locTabDrop = function(e) {
            e.preventDefault();
            const targetTab = e.currentTarget;
            targetTab.classList.remove('drag-over-left', 'drag-over-right');
            if (!_draggedLocTab || targetTab === _draggedLocTab) return;

            const container = targetTab.parentElement;
            const rect = targetTab.getBoundingClientRect();
            const insertBefore = e.clientX < rect.left + rect.width / 2;

            if (insertBefore) {
                container.insertBefore(_draggedLocTab, targetTab);
            } else {
                container.insertBefore(_draggedLocTab, targetTab.nextSibling);
            }

            // 同步面板顺序和 priority 数值
            window._syncLocPrioritiesFromTabOrder();
        };
        window._syncLocPrioritiesFromTabOrder = function() {
            const tabs = document.querySelectorAll('.locator-tab');
            const panelsContainer = document.getElementById('locatorPanelsContainer');
            if (!panelsContainer) return;
            tabs.forEach((tab, idx) => {
                const key = tab.dataset.locKey;
                const priorityEl = document.querySelector(`[data-loc-priority="${key}"]`);
                if (priorityEl) priorityEl.textContent = idx + 1;
                const panel = panelsContainer.querySelector(`[data-loc-panel="${key}"]`);
                if (panel) panelsContainer.appendChild(panel);
            });
        };

        window._toggleLocator = function(key) {
            const btn = document.querySelector(`[data-loc-toggle="${key}"]`);
            if (!btn) return;
            const isOn = btn.classList.contains('on');
            btn.classList.toggle('on', !isOn);
            btn.classList.toggle('off', isOn);
            btn.setAttribute('aria-pressed', (!isOn).toString());
            const tab = document.querySelector(`.locator-tab[data-loc-key="${key}"] .tab-dot`);
            if (tab) { tab.classList.toggle('on', !isOn); tab.classList.toggle('off', isOn); }
        };

        // _changeLocPriority 已移除，优先级由选项卡拖拽顺序决定

	        window.aiOpenStepEditor = function(idx) {
                const step =
                    idx === -1
                        ? aiState.newStepDraft?.step
                        : aiState.scriptSteps[idx];
	            if (!step) return;
                const isNew = !!step._isNew;

            const existingOverlay = document.querySelector('.ai-step-edit-overlay');
            if (existingOverlay) existingOverlay.remove();

            aiState._currentEditIdx = idx;

	            const overlay = document.createElement('div');
	            overlay.className = 'ai-step-edit-overlay';
	            overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

            const curMode = step.stepType === 'logic' ? 'logic' : step.stepType === 'loop' ? 'loop' : 'action';

            // 计算当前步骤的嵌套深度（用于限制最大 3 层）
            const stepParentId = step.parentId || aiState.newStepDraft?.parentId || null;
            let stepDepth = 0;
            if (stepParentId) {
                let pid = stepParentId;
                while (pid) {
                    stepDepth++;
                    const p = (aiState.scriptSteps || []).find(s => s.id === pid);
                    pid = p?.parentId || null;
                }
            }
            const nestingLimitReached = stepDepth >= 3;

            // 计算逻辑类型在当前插入位置的可用性
            let logicValidation;
            if (idx === -1 && aiState.newStepDraft) {
                logicValidation = validateLogicTypeAtPosition(
                    aiState.newStepDraft.afterIdx,
                    aiState.newStepDraft.parentId || null,
                    -1
                );
            } else if (idx >= 0) {
                const prevIdx = idx - 1;
                logicValidation = validateLogicTypeAtPosition(
                    prevIdx,
                    step.parentId || null,
                    idx
                );
            } else {
                logicValidation = { if: { ok: true, reason: '' }, else_if: { ok: true, reason: '' }, else: { ok: true, reason: '' } };
            }
            // 存储到 state 以便切换逻辑类型时读取
            aiState._logicValidation = logicValidation;

            const ACTION_OPTIONS = [
                { v: 'click', l: '点击' }, { v: 'input', l: '输入' }, { v: 'navigate', l: '导航' },
                { v: 'scroll', l: '滚动' }, { v: 'keypress', l: '按键' }, { v: 'hover', l: '悬停' }, { v: 'wait', l: '等待' },
                { v: 'double_click', l: '双击' }, { v: 'long_press', l: '长按' }, { v: 'drag', l: '拖拽' }, { v: 'system_button', l: '系统键' },
            ];
            const knownAction = ACTION_OPTIONS.some(o => o.v === step.action);
            const effectiveAction = knownAction ? step.action : 'click';
            const actionOptions = ACTION_OPTIONS
                .map(o => `<option value="${o.v}" ${effectiveAction === o.v ? 'selected' : ''}>${o.l}</option>`).join('');

            const needsValue = ['input', 'navigate', 'keypress', 'wait', 'long_press', 'drag', 'system_button'].includes(effectiveAction);
            const needsTarget = !['navigate', 'wait', 'system_button'].includes(effectiveAction);
            const needsLocator = ['click', 'input', 'hover', 'double_click', 'long_press'].includes(effectiveAction);

	            const locators = step.locators || {};
	            if (step.xpath && !locators.xpath) locators.xpath = { value: step.xpath, enabled: true, priority: 1 };

            const titleTag = curMode === 'logic'
                ? `<span class="ai-step-action-tag logic-${step.logicType || 'if'}">${getLogicLabel(step.logicType || 'if')}</span>`
                : curMode === 'loop'
                ? `<span class="ai-step-action-tag loop">LOOP</span>`
                : `<span class="ai-step-action-tag ${effectiveAction}">${getActionLabel(effectiveAction)}</span>`;

	            overlay.innerHTML = `
	                <div class="ai-step-edit-modal" role="dialog" aria-modal="true" aria-label="${isNew ? '新建步骤' : '编辑步骤'}">
	                    <h3 class="ai-step-edit-title">
                            <span class="ai-step-edit-title-left">
                              <span id="aiStepEditTitleTag">${titleTag}</span>
                              ${isNew ? '新建步骤' : `编辑步骤 #${idx + 1}`}
                            </span>
                            <span class="ai-step-edit-hint" id="aiStepEditHint" aria-live="polite"></span>
                        </h3>

                        <div class="ai-step-mode-capsule" role="tablist" aria-label="步骤类型">
                            <button class="capsule-btn ${curMode === 'action' ? 'active' : ''}" type="button"
                                role="tab" aria-selected="${curMode === 'action'}" data-mode="action"
                                onclick="aiSwitchStepMode('action')">动作</button>
                            <button class="capsule-btn ${curMode === 'logic' ? 'active' : ''}${nestingLimitReached ? ' is-disabled' : ''}" type="button"
                                role="tab" aria-selected="${curMode === 'logic'}" data-mode="logic"
                                ${nestingLimitReached ? 'disabled title="已达最大嵌套层级（3层）"' : ''}
                                onclick="${nestingLimitReached ? '' : "aiSwitchStepMode('logic')"}">逻辑</button>
                            <button class="capsule-btn ${curMode === 'loop' ? 'active' : ''}${nestingLimitReached ? ' is-disabled' : ''}" type="button"
                                role="tab" aria-selected="${curMode === 'loop'}" data-mode="loop"
                                ${nestingLimitReached ? 'disabled title="已达最大嵌套层级（3层）"' : ''}
                                onclick="${nestingLimitReached ? '' : "aiSwitchStepMode('loop')"}">循环</button>
                        </div>

                        <div class="ai-step-panel" id="actionPanel" style="${curMode === 'action' ? '' : 'display:none'}">
	                    <div class="edit-field">
	                        <label>动作类型</label>
	                        <select id="stepEditAction" onchange="aiStepEditorActionChanged()">
	                            ${actionOptions}
	                        </select>
	                    </div>

	                    <div class="edit-field" id="stepEditTargetRow" style="${needsTarget ? '' : 'display:none'}">
	                        <label>目标元素（自然语言描述）</label>
	                        <textarea id="stepEditTarget" placeholder="例如：百度搜索框、登录按钮...">${escapeHtml(step.target || '')}</textarea>
	                    </div>

	                    <div class="edit-field value-row ${needsValue ? 'visible' : ''}" id="stepEditValueRow">
	                        <label id="stepEditValueLabel">${step.action === 'navigate' ? 'URL 地址' : step.action === 'keypress' ? '按键名称' : step.action === 'wait' ? '等待时间(ms)' : step.action === 'long_press' ? '按压时间(ms)' : step.action === 'system_button' ? '按钮名称(back/home/menu/enter)' : step.action === 'drag' ? '拖拽坐标JSON' : '输入内容'}</label>
	                        <input id="stepEditValue" type="text" value="${escapeHtml(step.value || '')}" placeholder="${step.action === 'navigate' ? 'https://...' : step.action === 'keypress' ? 'Enter / Tab / Escape ...' : step.action === 'system_button' ? 'back/home/menu/enter' : step.action === 'drag' ? '{\"start\":{\"x\":100,\"y\":100},\"end\":{\"x\":500,\"y\":500}}' : ''}">
	                    </div>

	                    <div class="edit-field" id="stepEditLocatorRow" style="${needsLocator ? '' : 'display:none'}">
	                        <label>定位与自愈（拖拽上方标签调整优先级）</label>
	                        <div class="locator-tabs" role="tablist" aria-label="定位策略">${buildLocatorTabsHTML(locators, _getLocatorOrder(locators))}</div>
	                        <div id="locatorPanelsContainer">${buildLocatorPanelsHTML(locators, step, idx, _getLocatorOrder(locators))}</div>
	                    </div>
                        </div>

                        ${buildLogicPanelHTML(step, logicValidation)}

                        <div class="ai-step-panel" id="loopPanel" style="${curMode === 'loop' ? '' : 'display:none'}">
                            <div class="loop-panel-placeholder">
                                <span class="placeholder-icon">${iconSvg('refreshCw', 'ctl-icon ctl-icon--lg')}</span>
                                <p>循环功能即将上线</p>
                            </div>
                        </div>

	                    <div class="edit-actions">
	                        <button class="btn-cancel ctl-focus-ring" type="button" onclick="aiCancelStepEdit(${idx})">取消</button>
	                        <button class="btn-save ctl-focus-ring" type="button" onclick="aiSaveStepEdit(${idx})">保存</button>
	                    </div>
	                </div>
	            `;
            const panelEl = document.getElementById('dockPanel');
            const targetBody = panelEl ? panelEl.ownerDocument.body : document.body;
            targetBody.appendChild(overlay);

            if (curMode !== 'logic') {
                const lp = overlay.querySelector('#logicPanel');
                if (lp) lp.style.display = 'none';
            }

            // activate first condition tab
            if (curMode === 'logic' || curMode === 'action') {
                setTimeout(() => window.aiLogicSwitchCondTab?.(0), 0);
            }

            setTimeout(() => {
                if (curMode === 'action') {
                    const f = needsTarget ? document.getElementById('stepEditTarget') : document.getElementById('stepEditValue');
                    if (f) f.focus();
                }
            }, 100);
        };

        window.aiStepEditorActionChanged = function() {
            const action = document.getElementById('stepEditAction').value;
            const hintEl = document.getElementById('aiStepEditHint');
            if (hintEl) hintEl.textContent = '';
            const targetRow = document.getElementById('stepEditTargetRow');
            const valueRow = document.getElementById('stepEditValueRow');
            const valueLabel = document.getElementById('stepEditValueLabel');
            const locatorRow = document.getElementById('stepEditLocatorRow');

            const needsValue = ['input', 'navigate', 'keypress', 'wait', 'long_press', 'drag', 'system_button'].includes(action);
            const needsLocator = ['click', 'input', 'hover', 'double_click', 'long_press'].includes(action);
            const needsTarget = !['navigate', 'wait', 'system_button'].includes(action);

            targetRow.style.display = needsTarget ? '' : 'none';
            valueRow.className = 'edit-field value-row' + (needsValue ? ' visible' : '');
            if (locatorRow) locatorRow.style.display = needsLocator ? '' : 'none';

            const labels = {
                navigate: 'URL 地址',
                keypress: '按键名称',
                wait: '等待时间(ms)',
                input: '输入内容',
                long_press: '按压时间(ms)',
                system_button: '按钮名称(back/home/menu/enter)',
                drag: '拖拽坐标JSON',
            };
            valueLabel.textContent = labels[action] || '值';

            const titleTagEl = document.getElementById('aiStepEditTitleTag');
            if (titleTagEl) titleTagEl.innerHTML = `<span class="ai-step-action-tag ${action}">${getActionLabel(action)}</span>`;
        };

        // ─── 步骤类型胶囊切换 ───
        window.aiSwitchStepMode = function(mode) {
            const capsule = document.querySelector('.ai-step-mode-capsule');
            if (capsule) capsule.querySelectorAll('.capsule-btn').forEach(b => {
                const isActive = b.dataset.mode === mode;
                b.classList.toggle('active', isActive);
                b.setAttribute('aria-selected', String(isActive));
            });

            const actionPanel = document.getElementById('actionPanel');
            const logicPanel = document.getElementById('logicPanel');
            const loopPanel = document.getElementById('loopPanel');
            if (actionPanel) actionPanel.style.display = mode === 'action' ? '' : 'none';
            if (logicPanel) logicPanel.style.display = mode === 'logic' ? '' : 'none';
            if (loopPanel) loopPanel.style.display = mode === 'loop' ? '' : 'none';

            const titleTagEl = document.getElementById('aiStepEditTitleTag');
            if (titleTagEl) {
                if (mode === 'action') {
                    const action = document.getElementById('stepEditAction')?.value || 'click';
                    titleTagEl.innerHTML = `<span class="ai-step-action-tag ${action}">${getActionLabel(action)}</span>`;
                } else if (mode === 'logic') {
                    const lt = document.getElementById('logicTypeSelect')?.value || 'if';
                    titleTagEl.innerHTML = `<span class="ai-step-action-tag logic-${lt}">${getLogicLabel(lt)}</span>`;
                } else {
                    titleTagEl.innerHTML = `<span class="ai-step-action-tag loop">LOOP</span>`;
                }
            }
            const hintEl = document.getElementById('aiStepEditHint');
            if (hintEl) hintEl.textContent = '';

            if (mode === 'action') {
                setTimeout(() => window.aiStepEditorActionChanged?.(), 0);
                // 编辑已有逻辑步骤切换为动作模式时，提前预警
                const editIdx = aiState._currentEditIdx;
                if (editIdx >= 0) {
                    const tcv = validateTypeChangeFromLogic(editIdx);
                    if (!tcv.ok && hintEl) hintEl.textContent = tcv.reason;
                }
            }
            if (mode === 'logic') {
                setTimeout(() => window.aiLogicTypeChanged?.(), 0);
            }
        };

        // ─── 逻辑面板交互 ───
        window.aiLogicTypeChanged = function() {
            const lt = document.getElementById('logicTypeSelect')?.value || 'if';
            const condWrap = document.getElementById('logicConditionsWrap');
            const container = document.getElementById('logicConditionsContainer');
            const tabsEl = document.getElementById('logicCondTabs');

            // 检查当前选择的 logicType 是否校验通过
            const lv = aiState._logicValidation || {};
            const vr = lv[lt];
            const hintEl = document.getElementById('aiStepEditHint');
            if (vr && !vr.ok && hintEl) {
                hintEl.textContent = vr.reason || '语法不允许';
            } else if (vr?.warn && hintEl) {
                hintEl.textContent = '⚠️ ' + vr.warn;
            } else if (hintEl) {
                hintEl.textContent = '';
            }

            if (lt === 'else') {
                if (condWrap) condWrap.style.display = 'none';
                if (container) container.innerHTML = '<div class="logic-cond-empty">else 无需条件，将匹配所有未命中的情况</div>';
                if (tabsEl) tabsEl.innerHTML = '';
            } else {
                if (condWrap) condWrap.style.display = '';
                if (container && container.querySelector('.logic-cond-empty')) {
                    const cond = { type: 'element_exists', target: '', connector: 'and' };
                    container.innerHTML = buildConditionPanelHTML(cond, 0);
                    if (tabsEl) tabsEl.innerHTML = buildConditionTabLabel(cond, 0, 1);
                }
            }
            const titleTagEl = document.getElementById('aiStepEditTitleTag');
            if (titleTagEl) titleTagEl.innerHTML = `<span class="ai-step-action-tag logic-${lt}">${getLogicLabel(lt)}</span>`;
        };

        window.aiLogicCondTypeChanged = function(condIdx) {
            const sel = document.querySelector(`[data-cond-field="type"][data-cond-idx="${condIdx}"]`);
            if (!sel) return;
            const needsAttr = sel.value === 'element_attr' || sel.value === 'cond_element_attr';
            const attrGroup = document.querySelector(`[data-cond-attr-group="${condIdx}"]`);
            if (attrGroup) attrGroup.style.display = needsAttr ? '' : 'none';
        };

        window.aiLogicShowAddMenu = function(btn) {
            const menu = document.getElementById('logicCondAddMenu');
            if (!menu) return;
            const isOpen = menu.classList.contains('show');
            menu.classList.toggle('show', !isOpen);
            if (!isOpen) {
                const close = (e) => {
                    if (!menu.contains(e.target) && e.target !== btn) {
                        menu.classList.remove('show');
                        document.removeEventListener('click', close, true);
                    }
                };
                setTimeout(() => document.addEventListener('click', close, true), 0);
            }
        };

        window.aiLogicAddCondition = function(connector) {
            const menu = document.getElementById('logicCondAddMenu');
            if (menu) menu.classList.remove('show');

            const container = document.getElementById('logicConditionsContainer');
            const tabsEl = document.getElementById('logicCondTabs');
            if (!container || !tabsEl) return;

            const panels = container.querySelectorAll('.logic-cond-panel');
            const newIdx = panels.length;

            const cond = { type: 'element_exists', target: '', connector: connector || 'and' };

            const tmpTab = document.createElement('div');
            tmpTab.innerHTML = buildConditionTabLabel(cond, newIdx, newIdx + 1);
            tabsEl.appendChild(tmpTab.firstElementChild);

            const tmpPanel = document.createElement('div');
            tmpPanel.innerHTML = buildConditionPanelHTML(cond, newIdx);
            container.appendChild(tmpPanel.firstElementChild);

            aiLogicRefreshTabClose();
            aiLogicSwitchCondTab(newIdx);
        };

        window.aiLogicSwitchCondTab = function(condIdx) {
            const tabsEl = document.getElementById('logicCondTabs');
            const container = document.getElementById('logicConditionsContainer');
            if (!tabsEl || !container) return;
            tabsEl.querySelectorAll('.logic-cond-tab').forEach(t =>
                t.classList.toggle('active', Number(t.dataset.condTab) === condIdx));
            container.querySelectorAll('.logic-cond-panel').forEach(p =>
                p.style.display = Number(p.dataset.condIdx) === condIdx ? '' : 'none');
        };

        window.aiLogicRemoveCondition = function(condIdx) {
            const tabsEl = document.getElementById('logicCondTabs');
            const container = document.getElementById('logicConditionsContainer');
            if (!tabsEl || !container) return;
            const panels = container.querySelectorAll('.logic-cond-panel');
            if (panels.length <= 1) return;

            const tab = tabsEl.querySelector(`[data-cond-tab="${condIdx}"]`);
            const panel = container.querySelector(`[data-cond-idx="${condIdx}"]`);
            if (tab) tab.remove();
            if (panel) panel.remove();

            aiLogicReindexTabs();
            const firstTab = tabsEl.querySelector('.logic-cond-tab');
            if (firstTab) aiLogicSwitchCondTab(Number(firstTab.dataset.condTab));
        };

        function aiLogicReindexTabs() {
            const tabsEl = document.getElementById('logicCondTabs');
            const container = document.getElementById('logicConditionsContainer');
            if (!tabsEl || !container) return;
            const tabs = tabsEl.querySelectorAll('.logic-cond-tab');
            const panels = container.querySelectorAll('.logic-cond-panel');
            tabs.forEach((tab, i) => {
                tab.dataset.condTab = String(i);
                tab.setAttribute('onclick', `aiLogicSwitchCondTab(${i})`);
                const closeBtn = tab.querySelector('.logic-cond-tab-close');
                if (closeBtn) closeBtn.setAttribute('onclick', `event.stopPropagation(); aiLogicRemoveCondition(${i})`);
                if (i === 0) {
                    tab.querySelector('.logic-cond-tab-label').textContent = '条件';
                }
            });
            panels.forEach((panel, i) => {
                panel.dataset.condIdx = String(i);
                panel.querySelectorAll('[data-cond-idx]').forEach(el => el.dataset.condIdx = String(i));
                panel.querySelectorAll('[data-cond-attr-group]').forEach(el => el.dataset.condAttrGroup = String(i));
                const typeEl = panel.querySelector('.logic-cond-type');
                if (typeEl) typeEl.setAttribute('onchange', `aiLogicCondTypeChanged(${i})`);
            });
            aiLogicRefreshTabClose();
        }

        function aiLogicRefreshTabClose() {
            const tabsEl = document.getElementById('logicCondTabs');
            if (!tabsEl) return;
            const tabs = tabsEl.querySelectorAll('.logic-cond-tab');
            tabs.forEach(tab => {
                const close = tab.querySelector('.logic-cond-tab-close');
                if (tabs.length <= 1) {
                    if (close) close.style.display = 'none';
                } else {
                    if (close) close.style.display = '';
                }
            });
        }

        function collectLogicConditions() {
            const tabsEl = document.getElementById('logicCondTabs');
            const container = document.getElementById('logicConditionsContainer');
            if (!container) return [];
            const panels = container.querySelectorAll('.logic-cond-panel');
            const tabs = tabsEl ? tabsEl.querySelectorAll('.logic-cond-tab') : [];
            const conditions = [];
            panels.forEach((panel, i) => {
                const type = panel.querySelector('[data-cond-field="type"]')?.value || 'element_exists';
                const target = panel.querySelector('[data-cond-field="target"]')?.value?.trim() || '';
                const attribute = panel.querySelector('[data-cond-field="attribute"]')?.value?.trim() || '';
                const operator = panel.querySelector('[data-cond-field="operator"]')?.value || '==';
                const value = panel.querySelector('[data-cond-field="value"]')?.value?.trim() || '';
                const tabLabel = tabs[i]?.querySelector('.logic-cond-tab-label')?.textContent?.trim() || '';
                const connector = i === 0 ? 'and' : (tabLabel === 'OR' ? 'or' : 'and');
                conditions.push({ type, target, attribute, operator, value, connector });
            });
            return conditions;
        }

        window.aiSaveStepEdit = function(idx) {
            const step =
                idx === -1
                    ? aiState.newStepDraft?.step
                    : aiState.scriptSteps[idx];
            if (!step) return;

            const hintEl = document.getElementById('aiStepEditHint');
            const setHint = (msg) => { if (hintEl) hintEl.textContent = msg || ''; };
            setHint('');

            const activeMode = document.querySelector('.capsule-btn.active')?.dataset?.mode || 'action';

            // ── 逻辑步骤保存 ──
            if (activeMode === 'logic') {
                const logicType = document.getElementById('logicTypeSelect')?.value || 'if';

                // 插入位置语法校验
                const lv = aiState._logicValidation || {};
                const vr = lv[logicType];
                if (vr && !vr.ok) {
                    setHint(vr.reason || '当前位置不允许此逻辑类型');
                    return;
                }

                if (logicType !== 'else') {
                    const conditions = collectLogicConditions();
                    if (conditions.length === 0) { setHint('请至少添加一个条件'); return; }
                    for (let i = 0; i < conditions.length; i++) {
                        const c = conditions[i];
                        if (!c.target) { setHint(`条件 ${i + 1}：请填写目标元素`); return; }
                        if ((c.type === 'element_attr' || c.type === 'cond_element_attr') && !c.attribute) {
                            setHint(`条件 ${i + 1}：请填写属性名`); return;
                        }
                    }
                    step.conditions = conditions;
                }

                step.stepType = 'logic';
                step.logicType = logicType;
                step.action = 'logic';
                step.target = '';
                step.value = '';
                const condDesc = logicType === 'else'
                    ? 'ELSE'
                    : `${getLogicLabel(logicType)} ${(step.conditions || []).map(c => c.target).join(' & ')}`;
                step.description = condDesc;
                step.status = 'pending';

                document.querySelector('.ai-step-edit-overlay')?.remove();
                if (step._isNew) delete step._isNew;

                if (idx === -1) {
                    const afterIdx = aiState.newStepDraft?.afterIdx ?? -1;
                    const insertAt = Math.min(Math.max(afterIdx + 1, 0), aiState.scriptSteps.length);
                    aiState.scriptSteps.splice(insertAt, 0, step);
                    aiState.insertAfterIndex = insertAt;
                    aiState.activeGapParentId = step.stepType === 'logic' ? step.id : (step.parentId || null);
                    aiState.activeGapExplicit = false;
                    aiState.hoverInsertAfterIndex = -1;
                    aiState.hoverGapParentId = null;
                    aiState.newStepDraft = null;
                    recomputeAllLogicGroupIds();
                    renderScriptSteps();
                    scheduleScrollNewStepIntoView(insertAt);
                    addAiLog(`➕ 已新建逻辑步骤 #${insertAt + 1}: ${condDesc}`);
                } else {
                    recomputeAllLogicGroupIds();
                    renderScriptSteps();
                    addAiLog(`✏️ 已编辑逻辑步骤 #${idx + 1}: ${condDesc}`);
                }
                return;
            }

            // ── 循环步骤（占位） ──
            if (activeMode === 'loop') {
                setHint('循环功能尚未实现');
                return;
            }

            // ── 动作步骤保存（原逻辑） ──

            // 新建时：校验插入普通步骤是否打断逻辑链
            if (idx === -1 && aiState.newStepDraft) {
                const nlv = validateNonLogicInsertAt(
                    aiState.newStepDraft.afterIdx,
                    aiState.newStepDraft.parentId || null,
                );
                if (!nlv.ok) { setHint(nlv.reason); return; }
            }

            // 编辑已有步骤时：若从 logic 改为 action，校验是否破坏逻辑链
            if (idx >= 0 && step.stepType === 'logic') {
                const tcv = validateTypeChangeFromLogic(idx);
                if (!tcv.ok) { setHint(tcv.reason); return; }
            }

            const action = document.getElementById('stepEditAction').value;
            const target = document.getElementById('stepEditTarget').value.trim();
            const value = document.getElementById('stepEditValue').value.trim();
            const prevDesc = step.description;

            if (step._isNew) {
                const needsTarget = !['navigate', 'wait', 'system_button'].includes(action);
                const needsLocator = ['click', 'input', 'hover', 'double_click', 'long_press'].includes(action);

                if (!action) { setHint('请选择动作类型'); return; }
                if (needsTarget && !target) { setHint('请填写目标元素'); return; }
                if (needsLocator) {
                    const getField = (k, f) => {
                        const el = document.querySelector(`[data-loc-field="${k}.${f}"]`);
                        if (!el) return '';
                        const raw = (el as any).value;
                        return (raw === null || raw === undefined) ? '' : String(raw).trim();
                    };
                    const hasMeaningfulValueFor = (k) => {
                        if (k === 'xpath') return !!getField('xpath', 'value');
                        if (k === 'cssSelector') return !!getField('cssSelector', 'value');
                        if (k === 'textContent') return !!getField('textContent', 'value');
                        if (k === 'aiLocate') return !!getField('aiLocate', 'value');
                        if (k === 'normalizedCoords') {
                            const x = getField('normalizedCoords', 'xPercent');
                            const y = getField('normalizedCoords', 'yPercent');
                            if (x === '' || y === '') return false;
                            return Number.isFinite(Number.parseFloat(x)) && Number.isFinite(Number.parseFloat(y));
                        }
                        if (k === 'imageTemplate') return !!(step.locators?.imageTemplate?.screenshot);
                        return false;
                    };
                    let hasEnabledLocatorValue = false;
                    for (const t of LOCATOR_TYPES) {
                        const toggleBtn = document.querySelector(`[data-loc-toggle="${t.key}"]`);
                        if (toggleBtn?.classList.contains('on') && hasMeaningfulValueFor(t.key)) {
                            hasEnabledLocatorValue = true; break;
                        }
                    }
                    if (!hasEnabledLocatorValue) { setHint('请至少启用一种定位方式并填写定位值'); return; }
                }
            }

            step.stepType = 'action';
            step.action = action;
            step.target = target;
            step.value = value;
            if (!step.description) step.description = prevDesc || `${getActionLabel(action)} - ${target || value}`;
            step.status = 'pending';
            delete step.logicType;
            delete step.conditions;

            const locators = step.locators || {};
            LOCATOR_TYPES.forEach(t => {
                const toggleBtn = document.querySelector(`[data-loc-toggle="${t.key}"]`);
                const priorityEl = document.querySelector(`[data-loc-priority="${t.key}"]`);
                if (!locators[t.key]) locators[t.key] = {};
                if (toggleBtn) locators[t.key].enabled = toggleBtn.classList.contains('on');
                if (priorityEl) locators[t.key].priority = parseInt(priorityEl.textContent) || (LOCATOR_TYPES.indexOf(t) + 1);
            });
            document.querySelectorAll('[data-loc-field]').forEach(input => {
                const [type, field] = input.dataset.locField.split('.');
                if (!locators[type]) locators[type] = {};
                const val = input.type === 'number' ? parseFloat(input.value) : input.value.trim();
                locators[type][field] = val;
            });
            step.locators = locators;

            if (locators.xpath?.value) {
                step.xpath = locators.xpath.value;
            } else {
                delete step.xpath;
                delete step.xpathInfo;
            }

            document.querySelector('.ai-step-edit-overlay')?.remove();
            if (step._isNew) delete step._isNew;

            if (idx === -1) {
                const afterIdx = aiState.newStepDraft?.afterIdx ?? -1;
                const insertAt = Math.min(Math.max(afterIdx + 1, 0), aiState.scriptSteps.length);
                aiState.scriptSteps.splice(insertAt, 0, step);
                aiState.insertAfterIndex = insertAt;
                aiState.activeGapParentId = step.parentId || null;
                aiState.activeGapExplicit = false;
                aiState.hoverInsertAfterIndex = -1;
                aiState.hoverGapParentId = null;
                aiState.newStepDraft = null;
                recomputeAllLogicGroupIds();
                renderScriptSteps();
                scheduleScrollNewStepIntoView(insertAt);
                addAiLog(`➕ 已新建步骤 #${insertAt + 1}: ${step.description}`);
            } else {
                recomputeAllLogicGroupIds();
                renderScriptSteps();
                addAiLog(`✏️ 已编辑步骤 #${idx + 1}: ${step.description}`);
            }
        };


        // 取消编辑：新建草稿直接丢弃（不产生空行）
        window.aiCancelStepEdit = function(idx) {
            document.querySelector('.ai-step-edit-overlay')?.remove();
            if (idx === -1) {
                aiState.newStepDraft = null;
                return;
            }
        };

        // 折叠/展开脚本编辑区
        window.aiCollapseScriptEditor = function() {
            aiState.scriptEditorCollapsed = !aiState.scriptEditorCollapsed;
            const collapsed = aiState.scriptEditorCollapsed;

            // 折叠/展开步骤容器
            if (dom.scriptStepsContainer) {
                dom.scriptStepsContainer.style.display = collapsed ? 'none' : '';
            }

            // 关闭已打开的子面板
            if (collapsed) {
                ['aiScriptSplitRow', 'aiScriptSavedPanel'].forEach(id => {
                    document.getElementById(id)?.classList.remove('show');
                });
                document.getElementById('aiScriptSavedBtn')?.classList.remove('active');
                document.getElementById('aiSplitModeBtn')?.classList.remove('active');
            }

            // 折叠按钮图标切换
            const collapseBtn = document.querySelector('.ai-script-header-collapse');
            if (collapseBtn) collapseBtn.textContent = collapsed ? '↧' : '↕';
        };

        // ─── 步骤执行 ───────────────────────────────────────

        let _execAbortController: AbortController | null = null;

        function syncActionRunBtn() {
            const btn = document.getElementById('aiActionRunBtn');
            if (!btn) return;
            btn.classList.toggle('running', aiState.isExecuting);
            if (aiState.isExecuting) {
                btn.innerHTML = `${iconSvg('square', 'ctl-icon--xs')}<span>停止</span>`;
                btn.title = '停止执行';
            } else {
                btn.innerHTML = `${iconSvg('play', 'ctl-icon--xs')}<span>执行</span>`;
                btn.title = '全部执行';
            }
        }

        window.aiToggleExecution = function() {
            if (aiState.isExecuting) {
                if (_execAbortController) _execAbortController.abort();
                addAiLog('⏹ 用户终止了执行');
            } else {
                window.aiExecuteAllSteps();
            }
        };

        // 执行单个步骤
        window.aiExecuteSingleStep = async function(idx) {
            if (aiState.isExecuting) return;
            const step = aiState.scriptSteps[idx];
            if (!step) return;
            if (step._regenerating) {
                showToast?.('该步骤正在重新生成中，已跳过执行', 'warn');
                return;
            }

            _execAbortController = new AbortController();
            aiState.isExecuting = true;
            syncActionRunBtn();
            aiState.currentExecutingIndex = idx;
            step.status = 'executing';
            clearStepFailure(step);
            renderScriptSteps();

            try {
                const engine = getAiEngine();
                const currentModel = getCurrentAiModel(engine);
                const resp = await fetch('/api/ai/execute-step', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ step, stepIndex: idx, model: currentModel, engine }),
                    signal: _execAbortController.signal,
                });
                const data = await resp.json();

                if (data.success) {
                    step.status = 'success';
                    step.screenshot = data.screenshot;
                    step.duration = data.duration;
                    clearStepFailure(step);
                    const modeTag = data.mode === 'xpath' ? '[XPath]' : data.mode === 'coordinates' ? '[坐标]' : data.skipped ? '[跳过]' : '[AI]';
                    addAiLog(`✅ 步骤 #${idx + 1} ${modeTag} 执行成功 (${formatDuration(data.duration)})`);
                } else {
                    step.status = 'error';
                    step.error = data.error;
                    setStepFailure(step, 'execute', data.error);
                    addAiLog(`❌ 步骤 #${idx + 1} 执行失败: ${data.error}`);
                }
            } catch (err) {
                if (err.name === 'AbortError') {
                    step.status = 'error';
                    step.error = '已终止';
                    setStepFailure(step, 'execute', '已终止');
                } else {
                    step.status = 'error';
                    step.error = err.message;
                    setStepFailure(step, 'execute', err.message);
                    addAiLog(`❌ 步骤 #${idx + 1} 请求失败: ${err.message}`);
                }
            } finally {
                _execAbortController = null;
                aiState.isExecuting = false;
                syncActionRunBtn();
                aiState.currentExecutingIndex = -1;
                renderScriptSteps();
            }
        };

        // 批量执行所有步骤
        window.aiExecuteAllSteps = async function() {
            if (aiState.isExecuting) return;
            if (aiState.scriptSteps.length === 0) {
                addAiLog('ℹ️ 没有待执行的步骤');
                return;
            }

            _execAbortController = new AbortController();
            const signal = _execAbortController.signal;

            aiState.scriptSteps.forEach(s => { s.status = 'pending'; clearStepFailure(s); });
            renderScriptSteps();

            aiState.isExecuting = true;
            syncActionRunBtn();
            addAiLog(`▶ 开始执行 ${aiState.scriptSteps.length} 个步骤...`);

            const engine = getAiEngine();
            const currentModel = getCurrentAiModel(engine);
            let aborted = false;
            for (let i = 0; i < aiState.scriptSteps.length; i++) {
                if (signal.aborted) { aborted = true; break; }
                const step = aiState.scriptSteps[i];
                if (step && step._regenerating) {
                    addAiLog(`  ⏭️ [${i + 1}/${aiState.scriptSteps.length}] 跳过：步骤正在重新生成`);
                    continue;
                }

                aiState.currentExecutingIndex = i;
                step.status = 'executing';
                renderScriptSteps();

                const stepCard = dom.scriptSteps?.querySelector(`[data-step-idx="${i}"]`);
                if (stepCard) stepCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

                try {
                    const resp = await fetch('/api/ai/execute-step', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ step, stepIndex: i, model: currentModel, engine }),
                        signal,
                    });
                    const data = await resp.json();

                    if (data.success) {
                        step.status = 'success';
                        step.screenshot = data.screenshot;
                        step.duration = data.duration;
                        clearStepFailure(step);
                        const modeTag = data.mode === 'xpath' ? '[XPath]' : data.mode === 'coordinates' ? '[坐标]' : data.skipped ? '[跳过]' : '[AI]';
                        addAiLog(`  ✅ ${modeTag} [${i + 1}/${aiState.scriptSteps.length}] ${step.description} (${formatDuration(data.duration)})`);
                    } else {
                        step.status = 'error';
                        step.error = data.error;
                        setStepFailure(step, 'execute', data.error);
                        addAiLog(`  ❌ [${i + 1}/${aiState.scriptSteps.length}] 失败: ${data.error}`);
                        break;
                    }
                } catch (err) {
                    if (err.name === 'AbortError') {
                        step.status = 'error';
                        step.error = '已终止';
                        setStepFailure(step, 'execute', '已终止');
                        aborted = true;
                        break;
                    }
                    step.status = 'error';
                    step.error = err.message;
                    setStepFailure(step, 'execute', err.message);
                    addAiLog(`  ❌ [${i + 1}/${aiState.scriptSteps.length}] 请求失败: ${err.message}`);
                    break;
                }

                renderScriptSteps();
            }

            _execAbortController = null;
            aiState.isExecuting = false;
            syncActionRunBtn();

            if (aborted) {
                aiState.scriptSteps.forEach(s => { if (s.status === 'pending' || s.status === 'executing') s.status = 'pending'; });
                renderScriptSteps();
            }
            aiState.currentExecutingIndex = -1;
            renderScriptSteps();

            const successCount = aiState.scriptSteps.filter(s => s.status === 'success').length;
            addAiLog(`✅ 执行完成: ${successCount}/${aiState.scriptSteps.length} 步成功`);

            // 添加执行完成消息到对话
            appendAssistantMessage(`执行完成：${successCount}/${aiState.scriptSteps.length} 步成功`, null);
        };

        // 从指定行开始逐步执行（直到完成或报错）
        window.aiExecuteFromHere = async function(startIdx) {
            if (aiState.isExecuting) return;
            const start = Math.max(0, Math.min(aiState.scriptSteps.length - 1, parseInt(startIdx, 10) || 0));
            if (aiState.scriptSteps.length === 0) return;

            _execAbortController = new AbortController();
            const signal = _execAbortController.signal;

            aiState.scriptSteps.forEach(s => { s.status = 'pending'; clearStepFailure(s); });
            renderScriptSteps();

            aiState.isExecuting = true;
            syncActionRunBtn();
            addAiLog(`▶ 从第 ${start + 1} 步开始执行...`);

            const engine = getAiEngine();
            const currentModel = getCurrentAiModel(engine);
            let aborted = false;

            for (let i = start; i < aiState.scriptSteps.length; i++) {
                if (signal.aborted) { aborted = true; break; }
                const step = aiState.scriptSteps[i];
                if (step && step._regenerating) {
                    addAiLog(`  ⏭️ [${i + 1}/${aiState.scriptSteps.length}] 跳过：步骤正在重新生成`);
                    continue;
                }

                aiState.currentExecutingIndex = i;
                step.status = 'executing';
                renderScriptSteps();

                const stepCard = dom.scriptSteps?.querySelector(`[data-step-idx="${i}"]`);
                if (stepCard) stepCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

                try {
                    const resp = await fetch('/api/ai/execute-step', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ step, stepIndex: i, model: currentModel, engine }),
                        signal,
                    });
                    const data = await resp.json();

                    if (data.success) {
                        step.status = 'success';
                        step.screenshot = data.screenshot;
                        step.duration = data.duration;
                        clearStepFailure(step);
                        const modeTag = data.mode === 'xpath' ? '[XPath]' : data.mode === 'coordinates' ? '[坐标]' : data.skipped ? '[跳过]' : '[AI]';
                        addAiLog(`  ✅ ${modeTag} [${i + 1}/${aiState.scriptSteps.length}] ${step.description} (${formatDuration(data.duration)})`);
                    } else {
                        step.status = 'error';
                        step.error = data.error;
                        setStepFailure(step, 'execute', data.error);
                        addAiLog(`  ❌ [${i + 1}/${aiState.scriptSteps.length}] 失败: ${data.error}`);
                        break;
                    }
                } catch (err) {
                    if (err.name === 'AbortError') {
                        step.status = 'error';
                        step.error = '已终止';
                        setStepFailure(step, 'execute', '已终止');
                        aborted = true;
                        break;
                    }
                    step.status = 'error';
                    step.error = err.message;
                    setStepFailure(step, 'execute', err.message);
                    addAiLog(`  ❌ [${i + 1}/${aiState.scriptSteps.length}] 请求失败: ${err.message}`);
                    break;
                }

                renderScriptSteps();
            }

            _execAbortController = null;
            aiState.isExecuting = false;
            syncActionRunBtn();

            if (aborted) {
                aiState.scriptSteps.forEach(s => { if (s.status === 'pending' || s.status === 'executing') s.status = 'pending'; });
                renderScriptSteps();
            }
            aiState.currentExecutingIndex = -1;
            renderScriptSteps();
        };

        // 重新生成指定步骤（Midscene 单步生成：重新采集定位信息）
        window.aiRegenerateStep = async function(idx) {
            const i = parseInt(idx, 10);
            const step = aiState.scriptSteps[i];
            if (!step) return;
            if (aiState.isExecuting) {
                showToast?.('执行中无法重新生成步骤', 'warn');
                return;
            }
            if (step._regenerating) return;

            step._regenerating = true;
            step._regenError = '';
            clearStepFailure(step);
            renderScriptSteps();

            const engine = getAiEngine();
            const currentModel = getCurrentAiModel(engine);

            try {
                const resp = await fetch('/api/ai/regenerate-step', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ step, stepIndex: i, model: currentModel, engine }),
                    signal: AbortSignal.timeout ? AbortSignal.timeout(120000) : undefined,
                });
                const data = await resp.json();
                if (!data.success || !data.step) {
                    throw new Error(data.error || '重新生成失败');
                }
                const updated = data.step;
                // Keep editor-local flags/status while replacing locator info.
                updated.status = 'pending';
                updated._regenerating = false;
                updated._regenError = '';
                clearStepFailure(updated);
                aiState.scriptSteps[i] = updated;
                showToast?.('已重新生成并更新定位信息', 'success');
            } catch (err) {
                step._regenerating = false;
                step._regenError = err.message || String(err);
                step.status = 'error';
                step.error = step._regenError;
                setStepFailure(step, 'regenerate', step._regenError);
                showToast?.(`重新生成失败：${step._userError || '请重试'}`, 'error');
            } finally {
                renderScriptSteps();
            }
        };

        // ─── 对话区 ─────────────────────────────────────────

        function scrollChatToBottom() {
            const el = dom.chatMessages;
            if (el) el.scrollTop = el.scrollHeight;
        }

        function scrollToContainer(container) {
            const el = dom.chatMessages;
            if (!el || !container) { scrollChatToBottom(); return; }
            const isLastAssistant = !container.nextElementSibling;
            if (isLastAssistant) { el.scrollTop = el.scrollHeight; return; }
            const containerRect = container.getBoundingClientRect();
            const elRect = el.getBoundingClientRect();
            const bottomOverflow = containerRect.bottom - elRect.bottom;
            if (bottomOverflow > 0) {
                el.scrollTop += bottomOverflow + 16;
            }
        }

        function scrollElementIntoView(targetEl, padding = 16) {
            const scroller = dom.chatMessages;
            if (!scroller || !targetEl) return;
            const scRect = scroller.getBoundingClientRect();
            const elRect = targetEl.getBoundingClientRect();
            const topLimit = scRect.top + padding;
            const bottomLimit = scRect.bottom - padding;
            if (elRect.top < topLimit) {
                scroller.scrollTop -= (topLimit - elRect.top);
            } else if (elRect.bottom > bottomLimit) {
                scroller.scrollTop += (elRect.bottom - bottomLimit);
            }
        }

        function setConvoGenerating(on) {
            const wrap = document.getElementById('aiConvoWrap');
            if (wrap) wrap.classList.toggle('generating', !!on);
        }

        const _streamState = new WeakMap();
        const _chunkBuffer = new WeakMap();

        function getChunkBuffer(container) {
            let buf = _chunkBuffer.get(container);
            if (!buf) { buf = { text: '', flushed: false }; _chunkBuffer.set(container, buf); }
            return buf;
        }
        function clearChunkBuffer(container) { _chunkBuffer.delete(container); }

        function ensureStreamPanel(panel) {
            let state = _streamState.get(panel);
            if (!state) {
                // Remove loading placeholder now that real content is arriving.
                const loading = panel.querySelector('.ai-thought-loading');
                if (loading) loading.remove();
                panel.innerHTML = '';
                const section = document.createElement('div');
                section.className = 'thought-section';
                const textSpan = document.createElement('span');
                textSpan.className = 'ai-stream-text';
                const cursor = document.createElement('span');
                cursor.className = 'ai-tw-cursor';
                section.appendChild(textSpan);
                section.appendChild(cursor);
                panel.appendChild(section);
                state = { textSpan, cursor, text: '' };
                _streamState.set(panel, state);
            }
            return state;
        }

        function openStreamOnPanel(wrapper, panel, container) {
            collapseThoughtPanels(container);
            wrapper.classList.add('has-thought');
            panel.classList.add('open');
            const toggleBtn = wrapper.querySelector('[data-role="thought-toggle"]');
            if (toggleBtn) toggleBtn.innerHTML = iconSvg('chevronUp', 'ctl-icon ctl-icon--sm');
            // Insert loading dots while waiting for the first thought chunk.
            if (!panel.querySelector('.ai-thought-loading') && !panel.querySelector('.ai-stream-text')) {
                const loading = document.createElement('div');
                loading.className = 'ai-thought-loading';
                loading.innerHTML = '<div class="ai-thinking-dots"><span></span><span></span><span></span></div>';
                panel.appendChild(loading);
            }
        }

        function appendThoughtChunk(container, taskIndex, text) {
            if (!text) return;
            const chunk = text;

            const lastPlanWrapper = findLastPlanWrapper(container);
            if (lastPlanWrapper) {
                const panel = lastPlanWrapper.querySelector('[data-role="thought-panel"]');
                if (panel) {
                    if (!panel.classList.contains('open')) {
                        openStreamOnPanel(lastPlanWrapper, panel, container);
                    }
                    const state = ensureStreamPanel(panel);
                    state.text += chunk;
                    state.textSpan.textContent = state.text;
                    panel.scrollTop = panel.scrollHeight;
                    scrollToContainer(container);
                    scrollElementIntoView(panel);
                    return;
                }
            }

            const buf = getChunkBuffer(container);
            buf.text += chunk;
        }

        function findLastPlanWrapper(container) {
            const stepsEl = container.querySelector('[data-role="steps"]');
            if (!stepsEl) return null;
            const wrappers = stepsEl.querySelectorAll('.ai-step-wrapper');
            for (let i = wrappers.length - 1; i >= 0; i--) {
                if (wrappers[i].querySelector('[data-role="thought-toggle"]')) return wrappers[i];
            }
            return null;
        }

        function flushChunkBuffer(container, wrapper) {
            const buf = _chunkBuffer.get(container);
            if (!buf || !buf.text) return;
            const panel = wrapper.querySelector('[data-role="thought-panel"]');
            if (!panel) return;
            openStreamOnPanel(wrapper, panel, container);
            const state = ensureStreamPanel(panel);
            state.text += buf.text;
            state.textSpan.textContent = state.text;
            clearChunkBuffer(container);
            scrollToContainer(container);
            scrollElementIntoView(panel);
        }

        function finalizeStream(panel) {
            const cursor = panel.querySelector('.ai-tw-cursor');
            if (cursor) cursor.remove();
            _streamState.delete(panel);
        }

        function collapseThoughtPanels(scopeEl) {
            if (!scopeEl) return;
            const openPanels = scopeEl.querySelectorAll('.ai-step-thought-panel.open');
            openPanels.forEach((panel) => {
                finalizeStream(panel);
                panel.classList.remove('open');
                const wrapper = panel.closest('.ai-step-wrapper');
                const toggleBtn = wrapper?.querySelector?.('[data-role="thought-toggle"]');
                if (toggleBtn) toggleBtn.innerHTML = iconSvg('brain', 'ctl-icon ctl-icon--sm');
            });
        }

        function collapseAllThoughtPanels() {
            collapseThoughtPanels(dom.chatMessages);
        }

        function appendUserMessage(text) {
            const div = document.createElement('div');
            div.className = 'ai-msg user';
            div.dataset.userText = text;
            div.innerHTML = `
                <div class="ai-msg-avatar">${iconSvg('user', 'ctl-icon ctl-icon--lg')}</div>
                <div class="ai-msg-bubble">${escapeHtml(text)}</div>
                <button class="ai-regen-btn" onclick="aiRegenerateMessage(this)" title="重新生成">
                    ${iconSvg('refreshCw', 'ctl-icon ctl-icon--sm')}
                </button>
            `;
            const welcome = dom.chatMessages?.querySelector('.ai-chat-welcome');
            if (welcome) welcome.remove();

            dom.chatMessages?.appendChild(div);
            scrollChatToBottom();
            return div;
        }

        function appendThinkingIndicator() {
            const div = document.createElement('div');
            div.className = 'ai-msg assistant';
            div.id = 'aiThinkingMsg';
            div.innerHTML = `
                <div class="ai-msg-bubble">
                    <div class="ai-bubble-header">
                        <div class="ai-msg-avatar">${iconSvg('bot', 'ctl-icon ctl-icon--lg')}</div>
                    </div>
                    <div class="ai-thinking">
                        <div class="ai-thinking-dots"><span></span><span></span><span></span></div>
                        <span>正在思考...</span>
                    </div>
                </div>
            `;
            dom.chatMessages?.appendChild(div);
            scrollChatToBottom();
        }

        function removeThinkingIndicator() {
            const el = $('aiThinkingMsg');
            if (el) el.remove();
        }

        function appendAssistantMessage(text, steps, timing) {
            const div = document.createElement('div');
            div.className = 'ai-msg assistant';

            let timingHtml = '';
            if (timing) {
                timingHtml = `<div class="ai-timing">耗时 ${formatDuration(timing)}</div>`;
            }

            let stepsHtml = '';
            if (steps && steps.length > 0) {
                const stepsListHtml = steps.map((step, idx) => {
                    const targetText = step.action === 'input'
                        ? `${escapeHtml(step.target)} → "${escapeHtml(step.value)}"`
                        : escapeHtml(step.target || step.value || '');

                    return `
                        <div class="ai-reply-step">
                            <div class="ai-reply-step-info">
                                <span class="ai-step-action-tag ${step.action}">${getActionLabel(step.action)}</span>
                                <span class="ai-step-target" title="${escapeHtml(step.target || '')}">${escapeHtml(step.target || step.value || '')}</span>
                            </div>
                            <div class="ai-reply-step-actions">
                                <button class="ai-step-icon-btn" type="button" onclick='aiAddStepToScript(${JSON.stringify(step).replace(/'/g, "&#39;")})' title="加入编辑区" aria-label="加入编辑区">${iconSvg('clipboardPlus', 'ctl-icon ctl-icon--sm')}</button>
                                <button class="ai-step-icon-btn" type="button" onclick='aiQuoteStep(${JSON.stringify(step).replace(/'/g, "&#39;")})' title="引用" aria-label="引用">${iconSvg('quote', 'ctl-icon ctl-icon--sm')}</button>
                            </div>
                        </div>
                    `;
                }).join('');

                stepsHtml = `
                    <div class="ai-reply-steps">
                        ${stepsListHtml}
                        <div class="ai-reply-add-all">
                            <button class="ai-reply-add-all-btn" onclick='aiAddAllStepsToScript(${JSON.stringify(steps).replace(/'/g, "&#39;")})'>
                                全部加入编辑区
                            </button>
                        </div>
                    </div>
                `;
            }

            div.innerHTML = `
                <div class="ai-msg-bubble">
                    <div class="ai-bubble-header">
                        <div class="ai-msg-avatar">${iconSvg('bot', 'ctl-icon ctl-icon--lg')}</div>
                        ${timingHtml}
                    </div>
                    <div>${escapeHtml(text).replace(/\n/g, '<br>')}</div>
                    ${stepsHtml}
                </div>
            `;

            dom.chatMessages?.appendChild(div);
            scrollChatToBottom();
        }

        // 引用步骤到输入框
        window.aiQuoteStep = function(step) {
            if (dom.chatInput) {
                const quote = `${getActionLabel(step.action)} ${step.target}${step.value ? ' → ' + step.value : ''}`;
                dom.chatInput.value += (dom.chatInput.value ? '\n' : '') + quote;
                dom.chatInput.focus();
                aiAutoResizeInput(dom.chatInput);
            }
        };

        // ─── 发送消息（SSE 流式接收 Midscene 执行进度）────────
        let _aiAbortController = null;

        window.aiStopGeneration = function() {
            if (_aiAbortController) {
                _aiAbortController.abort();
                _aiAbortController = null;
            }
            addAiLog('⏹ 用户已手动停止生成');
        };

        function _showAddAllBtnAfterStop(container, liveSteps) {
            if (!liveSteps || liveSteps.length === 0) return;
            finalizeLiveSteps(container, liveSteps);
        }

        window.aiSendMessage = async function() {
            if (aiState.isProcessing) return;
            const input = dom.chatInput;
            if (!input) return;
            const text = input.value.trim();
            if (!text) return;

            input.value = '';
            aiAutoResizeInput(input);
            stepsFloat.open();
            collapseAllThoughtPanels();
            appendUserMessage(text);
            aiState.chatHistory.push({ role: 'user', content: text });
            aiState.isProcessing = true;
            _aiAbortController = new AbortController();
            updateSendBtnState();

            const chatInput = document.getElementById('aiChatInput');
            if (chatInput) chatInput.style.display = 'none';
            setConvoGenerating(true);

            const startTime = Date.now();

            const replyContainer = createLiveReplyContainer();
            clearChunkBuffer(replyContainer);
            updateReplyStatus(replyContainer, 'thinking', '正在分析页面并规划操作...');

            const liveSteps = [];

            try {
                const engine = getAiEngine();
                if (engine === 'midscene' && !isMidsceneEnabled()) {
                    window.showToast?.('请在设置中启用 Midscene 或切换到 MAI-UI', 'warning');
                    throw new Error('Midscene 未启用');
                }
                if (engine === 'mai-ui' && !isMaiUiEnabled()) {
                    window.showToast?.('请在设置中启用 MAI-UI', 'warning');
                    throw new Error('MAI-UI 未启用');
                }

                const selectedModel = getCurrentAiModel(engine);
                const splitOn = (engine === 'midscene') ? document.getElementById('aiSplitModeToggle')?.checked : false;
                const planningModel = splitOn ? (document.getElementById('aiPlanningModelSelect')?.value || '') : '';
                const bodyObj = { task: text, model: selectedModel, engine };
                if (planningModel) bodyObj.planningModel = planningModel;
                const resp = await fetch('/api/ai/run', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(bodyObj),
                    signal: _aiAbortController.signal,
                });

                if (!resp.ok) {
                    const err = await resp.text();
                    throw new Error(`HTTP ${resp.status}: ${err}`);
                }

                const reader = resp.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (!line.startsWith('data: ')) continue;
                        try {
                            const evt = JSON.parse(line.slice(6));
                            handleSSEEvent(evt, replyContainer, liveSteps, startTime);
                        } catch (e) { /* 忽略非JSON行 */ }
                    }
                }

                if (buffer.startsWith('data: ')) {
                    try {
                        const evt = JSON.parse(buffer.slice(6));
                        handleSSEEvent(evt, replyContainer, liveSteps, startTime);
                    } catch (_) {}
                }

            } catch (err) {
                const timing = Date.now() - startTime;
                if (err.name === 'AbortError') {
                    updateReplyStatus(replyContainer, 'stopped', '已停止生成');
                    updateReplyTiming(replyContainer, timing);
                    _showAddAllBtnAfterStop(replyContainer, liveSteps);
                } else {
                    updateReplyStatus(replyContainer, 'error', `请求失败：${err.message}`);
                    updateReplyTiming(replyContainer, timing);
                    addAiLog(`❌ 网络错误: ${err.message}`);
                }
            } finally {
                _aiAbortController = null;
                aiState.isProcessing = false;
                updateSendBtnState();
                const ci = document.getElementById('aiChatInput');
                if (ci) { ci.style.display = ''; ci.focus(); }
                setConvoGenerating(false);
            }
        };

        window.aiRegenerateMessage = async function(btnEl) {
            if (aiState.isProcessing) {
                window.showToast?.('正在处理中，请等待完成', 'warning');
                return;
            }

            const userMsgDiv = btnEl.closest('.ai-msg.user');
            if (!userMsgDiv) return;

            const text = userMsgDiv.dataset.userText;
            if (!text) return;

            const oldReply = userMsgDiv.nextElementSibling;
            if (oldReply && oldReply.classList.contains('assistant')) {
                oldReply.remove();
            }

            const chatHistoryIdx = aiState.chatHistory.findIndex(
                (h, i) => h.role === 'user' && h.content === text && i < aiState.chatHistory.length - 1 &&
                           aiState.chatHistory[i + 1]?.role === 'assistant'
            );
            if (chatHistoryIdx >= 0) {
                aiState.chatHistory.splice(chatHistoryIdx + 1, 1);
            }

            stepsFloat.open();
            collapseAllThoughtPanels();
            stepsFloat.currentSteps = [];
            aiState.isProcessing = true;
            _aiAbortController = new AbortController();
            updateSendBtnState();

            const chatInput = document.getElementById('aiChatInput');
            if (chatInput) chatInput.style.display = 'none';
            setConvoGenerating(true);

            const startTime = Date.now();

            const replyDiv = document.createElement('div');
            replyDiv.className = 'ai-msg assistant';
            replyDiv.innerHTML = `
                <div class="ai-msg-bubble">
                    <div class="ai-bubble-header">
                        <div class="ai-msg-avatar">${iconSvg('bot', 'ctl-icon ctl-icon--lg')}</div>
                        <div class="ai-timing" data-role="timing" style="display:none;"></div>
                    </div>
                    <div data-role="status" class="ai-thinking">
                        <div class="ai-thinking-dots"><span></span><span></span><span></span></div>
                        <span>正在重新生成...</span>
                    </div>
                    <div class="ai-reply-steps" data-role="steps" style="display:none;border:none;margin-top:6px;"></div>
                </div>
            `;
            userMsgDiv.insertAdjacentElement('afterend', replyDiv);
            clearChunkBuffer(replyDiv);
            scrollToContainer(replyDiv);

            const liveSteps = [];

            try {
                const engine = getAiEngine();
                if (engine === 'midscene' && !isMidsceneEnabled()) {
                    window.showToast?.('请在设置中启用 Midscene 或切换到 MAI-UI', 'warning');
                    throw new Error('Midscene 未启用');
                }
                if (engine === 'mai-ui' && !isMaiUiEnabled()) {
                    window.showToast?.('请在设置中启用 MAI-UI', 'warning');
                    throw new Error('MAI-UI 未启用');
                }

                const selectedModel = getCurrentAiModel(engine);
                const splitOn = (engine === 'midscene') ? document.getElementById('aiSplitModeToggle')?.checked : false;
                const planningModel = splitOn ? (document.getElementById('aiPlanningModelSelect')?.value || '') : '';
                const bodyObj = { task: text, model: selectedModel, engine };
                if (planningModel) bodyObj.planningModel = planningModel;
                const resp = await fetch('/api/ai/run', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(bodyObj),
                    signal: _aiAbortController.signal,
                });

                if (!resp.ok) {
                    const err = await resp.text();
                    throw new Error(`HTTP ${resp.status}: ${err}`);
                }

                const reader = resp.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (!line.startsWith('data: ')) continue;
                        try {
                            const evt = JSON.parse(line.slice(6));
                            handleSSEEvent(evt, replyDiv, liveSteps, startTime);
                        } catch (e) { /* ignore */ }
                    }
                }

                if (buffer.startsWith('data: ')) {
                    try {
                        const evt = JSON.parse(buffer.slice(6));
                        handleSSEEvent(evt, replyDiv, liveSteps, startTime);
                    } catch (_) {}
                }

            } catch (err) {
                const timing = Date.now() - startTime;
                if (err.name === 'AbortError') {
                    updateReplyStatus(replyDiv, 'stopped', '已停止生成');
                    updateReplyTiming(replyDiv, timing);
                    _showAddAllBtnAfterStop(replyDiv, liveSteps);
                } else {
                    updateReplyStatus(replyDiv, 'error', `请求失败：${err.message}`);
                    updateReplyTiming(replyDiv, timing);
                    addAiLog(`❌ 网络错误: ${err.message}`);
                }
            } finally {
                _aiAbortController = null;
                aiState.isProcessing = false;
                updateSendBtnState();
                const ci = document.getElementById('aiChatInput');
                if (ci) { ci.style.display = ''; ci.focus(); }
                setConvoGenerating(false);
            }
        };

        /**
         * 处理 SSE 事件
         */
        function handleSSEEvent(evt, container, liveSteps, startTime) {
            switch (evt.type) {
                case 'thinking':
                    updateReplyStatus(container, 'thinking', evt.message || '正在思考...');
                    break;

                case 'screenshot':
                    // 可选：展示执行前截图
                    break;

                case 'step_start': {
                    const step = evt.step;
                    liveSteps.push(step);
                    appendLiveStep(container, step, evt.index);
                    updateReplyStatus(container, 'executing',
                        `正在执行第 ${liveSteps.length} 步: ${step.description || step.action}...`);
                    addAiLog(`  ▶ 步骤 ${liveSteps.length}: ${step.description}`);
                    break;
                }

                case 'step_update': {
                    updateLiveStepStatus(container, evt.index, evt.status);
                    if (evt.index < liveSteps.length) {
                        liveSteps[evt.index].status = evt.status;
                    }
                    break;
                }

                case 'step_detail': {
                    updateLiveStepDetail(container, evt.taskIndex, evt);
                    break;
                }

                case 'thought_chunk': {
                    appendThoughtChunk(container, evt.taskIndex, evt.text || '');
                    break;
                }

                case 'step_xpath': {
                    if (evt.index < liveSteps.length) {
                        liveSteps[evt.index].xpath = evt.xpath;
                        liveSteps[evt.index].xpathInfo = evt.xpathInfo;
                        if (evt.coordinates) liveSteps[evt.index].coordinates = evt.coordinates;
                        if (evt.locators) liveSteps[evt.index].locators = evt.locators;
                        if (evt.value !== undefined && evt.value !== null && evt.value !== '') {
                            liveSteps[evt.index].value = evt.value;
                        }
                        // 回填 target（input 步骤通过 keyboard.type 拦截补充元素描述）
                        if (evt.target !== undefined && evt.target !== null && evt.target !== '' && !liveSteps[evt.index].target) {
                            liveSteps[evt.index].target = evt.target;
                        }
                    }
                    break;
                }

                case 'done': {
                    const timing = Date.now() - startTime;
                    const serverSteps = evt.steps || [];
                    const finalSteps = serverSteps.length > 0 ? serverSteps : liveSteps;
                    for (let si = 0; si < finalSteps.length; si++) {
                        const fs = finalSteps[si], ls = liveSteps[si];
                        if (!ls) continue;
                        if (!fs.xpath && ls.xpath) {
                            fs.xpath = ls.xpath;
                            fs.xpathInfo = ls.xpathInfo;
                        }
                        if (!fs.coordinates && ls.coordinates) {
                            fs.coordinates = ls.coordinates;
                        }
                        if (!fs.target && ls.target) {
                            fs.target = ls.target;
                        }
                        if (!fs.value && ls.value) {
                            fs.value = ls.value;
                        }
                        if (ls.locators && Object.keys(ls.locators).length > 0) {
                            fs.locators = fs.locators || {};
                            for (const [k, v] of Object.entries(ls.locators)) {
                                if (!fs.locators[k] || (!fs.locators[k].value && !fs.locators[k].screenshot && !fs.locators[k].xPercent)) {
                                    fs.locators[k] = v;
                                }
                            }
                        }
                    }

                    finalizeLiveSteps(container, finalSteps);
                    updateReplyStatus(container, 'done',
                        `已完成，共 ${finalSteps.length} 步`);
                    updateReplyTiming(container, timing);

                    const xpathCount = finalSteps.filter(s => s.xpath).length;
                    aiState.chatHistory.push({
                        role: 'assistant', content: `执行完成 (${finalSteps.length} 步)`, steps: finalSteps
                    });
                    addAiLog(`✅ AI执行完成: ${finalSteps.length} 步 (${formatDuration(timing)})${xpathCount > 0 ? ` [${xpathCount} 步已捕获XPath]` : ''}`);
                    scrollChatToBottom();
                    break;
                }

                case 'error': {
                    const timing = Date.now() - startTime;
                    updateReplyStatus(container, 'error',
                        `执行出错：${evt.error}${evt.steps?.length ? ` (已完成 ${evt.steps.length} 步)` : ''}`);
                    updateReplyTiming(container, timing);
                    if (evt.steps) {
                        const errSteps = evt.steps;
                        for (let si = 0; si < errSteps.length; si++) {
                            const fs = errSteps[si], ls = liveSteps[si];
                            if (!ls) continue;
                            if (!fs.xpath && ls.xpath) { fs.xpath = ls.xpath; fs.xpathInfo = ls.xpathInfo; }
                            if (!fs.coordinates && ls.coordinates) fs.coordinates = ls.coordinates;
                            if (!fs.target && ls.target) fs.target = ls.target;
                            if (!fs.value && ls.value) fs.value = ls.value;
                            if (ls.locators && Object.keys(ls.locators).length > 0) {
                                fs.locators = fs.locators || {};
                                for (const [k, v] of Object.entries(ls.locators)) {
                                    if (!fs.locators[k] || (!fs.locators[k].value && !fs.locators[k].screenshot && !fs.locators[k].xPercent)) {
                                        fs.locators[k] = v;
                                    }
                                }
                            }
                        }
                        finalizeLiveSteps(container, errSteps);
                    }
                    addAiLog(`❌ ${evt.error}`);
                    break;
                }
            }
            scrollToContainer(container);
        }

        // ─── AI 对话气泡浮框（全局单例） ─────────────────────
        // 浮框 = 完整对话（对话历史 + 生成步骤），支持循环 生成→选取→加入→再生成
        const stepsFloat = {
            currentSteps: [],   // 当前批次最终步骤
            addedIds: new Set(), // 已加入编辑区的步骤标识

            get el()       { return document.getElementById('aiConvoWrap'); },
            get body()     { return document.getElementById('aiChatMessages'); },
            get badge()    { return null; },   // 无独立徽章元素
            get status()   { return null; },   // 无独立状态元素
            get addAllBtn() {
                const body = this.body;
                return body?.querySelector('.ai-msg.assistant:last-child .ai-bubble-add-all-row .ai-bubble-add-all-btn') || null;
            },

            /**
             * 展开对话区：输入框上框线向上扩展至面板 1/2 高度。
             * 若已展开则保留历史、仅重置当前批次状态。
             */
            open() {
                const wrap = this.el;
                const panel = wrap?.closest('.ai-panel');
                const history = this.body;
                if (!wrap || !panel || !history) return;

                this.currentSteps = [];

                if (wrap.classList.contains('expanded')) {
                    const emptyEl = document.getElementById('aiScriptEmpty');
                    if (emptyEl) emptyEl.style.display = 'none';
                    return;
                }

                const startH = wrap.offsetHeight;
                const targetH = Math.max(Math.round(panel.offsetHeight * 2 / 3), 200);

                wrap.style.overflow = 'hidden';
                wrap.style.transition = 'none';
                wrap.style.height = startH + 'px';
                history.style.display = '';
                wrap.offsetHeight;
                wrap.style.transition = '';
                wrap.style.height = targetH + 'px';
                wrap.classList.add('expanded');

                const emptyEl = document.getElementById('aiScriptEmpty');
                if (emptyEl) emptyEl.style.display = 'none';

                const onDone = () => {
                    wrap.style.overflow = '';
                    wrap.removeEventListener('transitionend', onDone);
                };
                wrap.addEventListener('transitionend', onDone, { once: true });
            },

            /**
             * 折叠对话区：框线缩回输入框原始高度，清空输入文本。
             * 历史消息 DOM 保留，下次展开时继续显示。
             */
            close() {
                const wrap = this.el;
                const history = this.body;
                if (!wrap || !wrap.classList.contains('expanded')) return;

                const prevH = wrap.style.height;
                if (history) history.style.display = 'none';
                wrap.classList.remove('expanded');
                wrap.style.height = '';
                const colH = wrap.offsetHeight;
                wrap.classList.add('expanded');
                if (history) history.style.display = '';
                wrap.style.transition = 'none';
                wrap.style.height = prevH || (wrap.offsetHeight + 'px');
                wrap.offsetHeight;
                wrap.style.transition = '';

                wrap.style.height = colH + 'px';
                wrap.classList.remove('expanded');

                if (aiState.scriptSteps.length === 0) {
                    const emptyEl = document.getElementById('aiScriptEmpty');
                    if (emptyEl) emptyEl.style.display = 'flex';
                }

                const cleanup = () => {
                    if (history) history.style.display = 'none';
                    wrap.style.height = '';
                    wrap.removeEventListener('transitionend', cleanup);
                };
                wrap.addEventListener('transitionend', cleanup, { once: true });

                if (dom.chatInput) {
                    dom.chatInput.value = '';
                    if (typeof window.aiAutoResizeInput === 'function') window.aiAutoResizeInput(dom.chatInput);
                }
            },

            /** 已内联展开，无需 alignBottom */
            _alignBottom() {},

            setStatus(text, color) {
                const s = this.status;
                if (s) { s.textContent = text; s.style.color = color || '#94a3b8'; }
            },

            updateBadge(n) {
                const b = this.badge;
                if (!b) return;
                if (n > 0) { b.textContent = `${n}步`; b.style.display = ''; }
                else b.style.display = 'none';
            },

            /** 追加一个实时步骤行到当前 AI 气泡内 */
            appendStep(step, index) {
                // 步骤追加到最后一个 assistant 气泡的步骤区
                const body = this.body;
                if (!body) return;
                const lastBubble = body.querySelector('.ai-msg.assistant:last-child');
                if (!lastBubble) return;
                let stepsEl = lastBubble.querySelector('[data-role="steps"]');
                if (stepsEl) stepsEl.style.display = '';

                const targetText = step.target
                    ? (step.action === 'input' && step.value ? `${step.target} → "${step.value}"` : step.target)
                    : (step.value || '');
                const descText = step.description || '';

                const wrapper = document.createElement('div');
                wrapper.className = 'ai-step-wrapper';
                wrapper.dataset.stepIndex = index;

                const isPlan = (step.action || '').toLowerCase() === 'plan';
                const row = document.createElement('div');
                row.className = 'ai-reply-step executing';
                row.innerHTML = `
                    <div class="ai-reply-step-info">
                        <span class="ai-step-action-tag ${step.action || 'action'}">${getActionLabel(step.action || 'action')}</span>
                        ${targetText
                            ? `<span class="ai-step-target" title="${escapeHtml(targetText)}">${escapeHtml(targetText)}</span>`
                            : `<span style="color:#999;font-size:12px;" title="${escapeHtml(descText)}">${escapeHtml(descText)}</span>`
                        }
                    </div>
                    <div class="ai-reply-step-actions">
                        ${isPlan ? `<button class="ai-step-thought-toggle" type="button" data-role="thought-toggle" title="查看思考过程">${iconSvg('brain', 'ctl-icon ctl-icon--sm')}</button>` : ''}
                    </div>
                `;
                const thoughtPanel = document.createElement('div');
                thoughtPanel.className = 'ai-step-thought-panel';
                thoughtPanel.dataset.role = 'thought-panel';
                if (isPlan) {
                    const toggleBtn = row.querySelector('[data-role="thought-toggle"]');
                    if (toggleBtn) {
                        toggleBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            const isOpen = thoughtPanel.classList.toggle('open');
                            toggleBtn.innerHTML = isOpen ? iconSvg('chevronUp', 'ctl-icon ctl-icon--sm') : iconSvg('brain', 'ctl-icon ctl-icon--sm');
                        });
                    }
                }
                wrapper.appendChild(row);
                wrapper.appendChild(thoughtPanel);
                stepsEl?.appendChild(wrapper);
                this.updateBadge(index + 1);
                scrollChatToBottom();
            },

            /** 最终化：更新图标 + 启用"全部加入"按钮 */
            finalize(steps) {
                this.currentSteps = steps;
                const body = this.body;
                if (!body) return;
                const execSteps = steps.filter(isExecutableStep);

                // 找最后一个 assistant 气泡的步骤区
                const lastBubble = body.querySelector('.ai-msg.assistant:last-child');
                const stepsEl = lastBubble?.querySelector('[data-role="steps"]');
                if (stepsEl) {
                    const wrappers = stepsEl.querySelectorAll('.ai-step-wrapper');
                    steps.forEach((step, idx) => {
                        const wrapper = wrappers[idx];
                        if (!wrapper) return;
                        const row = wrapper.querySelector('.ai-reply-step');
                        if (row) {
                            row.classList.remove('executing', 'success', 'error');
                            if (step.status === 'success') row.classList.add('success');
                            else if (step.status === 'error') row.classList.add('error');
                        }
                        if (step.action === 'done') {
                            const tag = wrapper.querySelector('.ai-step-action-tag');
                            if (tag) { tag.className = 'ai-step-action-tag done'; tag.textContent = '完成'; }
                            const tgt = wrapper.querySelector('.ai-step-target');
                            if (tgt) tgt.remove();
                        }
                        // 为可执行步骤添加单步加入按钮
                        if (isExecutableStep(step)) {
                            const row = wrapper.querySelector('.ai-reply-step');
                            if (row && !row.querySelector('.ai-step-icon-btn')) {
                                const btn = document.createElement('button');
                                btn.className = 'ai-step-icon-btn';
                                btn.title = '加入编辑区';
                                btn.type = 'button';
                                btn.innerHTML = iconSvg('clipboardPlus', 'ctl-icon ctl-icon--sm');
                                btn.onclick = () => aiStepsFloatAddSingle(idx);
                                let actions = row.querySelector('.ai-reply-step-actions');
                                if (!actions) {
                                    actions = document.createElement('div');
                                    actions.className = 'ai-reply-step-actions';
                                    row.appendChild(actions);
                                }
                                actions.appendChild(btn);
                            }
                        }
                    });
                }

                this.updateBadge(steps.length);
                this.setStatus('', '');

                if (lastBubble && execSteps.length > 0 && !lastBubble.querySelector('.ai-bubble-add-all-row')) {
                    const addRow = document.createElement('div');
                    addRow.className = 'ai-bubble-add-all-row';
                    const addBtn = document.createElement('button');
                    addBtn.className = 'ai-bubble-add-all-btn';
                    addBtn.textContent = `全部加入编辑区（${execSteps.length}步）`;
                    addBtn.title = '将所有可执行步骤加入脚本编辑区';
                    addBtn.onclick = () => aiStepsFloatAddAll();
                    addRow.appendChild(addBtn);
                    lastBubble.appendChild(addRow);
                    // Ensure the "add all" CTA is actually visible (layout can
                    // still settle after streaming finishes, especially on regenerate).
                    requestAnimationFrame(() => {
                        scrollElementIntoView(addRow, 80);
                        setTimeout(() => scrollElementIntoView(addRow, 80), 80);
                    });
                }
            },

            /** fallback：替换步骤内容 */
            replace(steps) {
                this.currentSteps = steps;
                const body = this.body;
                if (!body) return;
                const execSteps = steps.filter(isExecutableStep);
                const lastBubble = body.querySelector('.ai-msg.assistant:last-child');
                const stepsEl = lastBubble?.querySelector('[data-role="steps"]');
                if (!stepsEl) return;
                stepsEl.innerHTML = '';
                stepsEl.style.display = '';

                steps.forEach((step, idx) => {
                    const targetText = step.target
                        ? (step.action === 'input' ? `${step.target} → "${step.value || ''}"` : step.target)
                        : (step.value || '');
                    const statusClass = step.status === 'success' ? 'success' : step.status === 'error' ? 'error' : '';
                    const wrapper = document.createElement('div');
                    wrapper.className = 'ai-step-wrapper';
                    wrapper.dataset.stepIndex = idx;
                    const row = document.createElement('div');
                    row.className = `ai-reply-step ${statusClass}`.trim();
                    const isPlan = (step.action || '').toLowerCase() === 'plan';
                    let addBtn = isExecutableStep(step)
                        ? `<button class="ai-step-icon-btn" type="button" onclick="aiStepsFloatAddSingle(${idx})" title="加入编辑区" aria-label="加入编辑区">${iconSvg('clipboardPlus', 'ctl-icon ctl-icon--sm')}</button>`
                        : '';
                    row.innerHTML = `
                        <div class="ai-reply-step-info">
                            <span class="ai-step-action-tag ${step.action || 'action'}">${getActionLabel(step.action || 'action')}</span>
                            ${targetText ? `<span class="ai-step-target" title="${escapeHtml(targetText)}">${escapeHtml(targetText)}</span>` : ''}
                        </div>
                        <div class="ai-reply-step-actions">
                            ${isPlan ? `<button class="ai-step-thought-toggle" type="button" data-role="thought-toggle" title="查看思考过程">${iconSvg('brain', 'ctl-icon ctl-icon--sm')}</button>` : ''}
                            ${addBtn}
                        </div>`;
                    wrapper.appendChild(row);
                    stepsEl.appendChild(wrapper);
                });
                this.updateBadge(steps.length);
                this.setStatus('', '');
                if (lastBubble && execSteps.length > 0 && !lastBubble.querySelector('.ai-bubble-add-all-row')) {
                    const addRow = document.createElement('div');
                    addRow.className = 'ai-bubble-add-all-row';
                    const addBtn = document.createElement('button');
                    addBtn.className = 'ai-bubble-add-all-btn';
                    addBtn.textContent = `全部加入编辑区（${execSteps.length}步）`;
                    addBtn.onclick = () => aiStepsFloatAddAll();
                    addRow.appendChild(addBtn);
                    lastBubble.appendChild(addRow);
                }
                scrollChatToBottom();
            },

            /** 标记指定步骤为已加入 */
            markAdded(stepIdx) {
                const step = this.currentSteps[stepIdx];
                if (!step) return;
                this.addedIds.add(step.id || stepIdx);
                const body = this.body;
                const lastBubble = body?.querySelector('.ai-msg.assistant:last-child');
                const wrapper = lastBubble?.querySelector(`.ai-step-wrapper[data-step-index="${stepIdx}"]`);
                if (wrapper) {
                    const row = wrapper.querySelector('.ai-reply-step');
                    row?.classList.add('added');
                    const btn = row?.querySelector('.ai-step-icon-btn');
                    if (btn) { btn.innerHTML = iconSvg('circleCheck', 'ctl-icon ctl-icon--sm'); btn.disabled = true; btn.title = '已加入'; }
                }
            },
        };

        window.aiStepsFloatClose = function() { stepsFloat.close(); };

        // ─── 最大化/最小化切换 ──────────────────────────────
        window.aiToggleConvoMaximize = function() {
            const wrap = document.getElementById('aiConvoWrap');
            const history = document.getElementById('aiChatMessages');
            if (!wrap) return;

            if (wrap.classList.contains('expanded')) {
                const prevH = wrap.style.height;
                if (history) history.style.display = 'none';
                wrap.classList.remove('expanded');
                wrap.style.height = '';
                const colH = wrap.offsetHeight;
                wrap.classList.add('expanded');
                if (history) history.style.display = '';
                wrap.style.transition = 'none';
                wrap.style.height = prevH || (wrap.offsetHeight + 'px');
                wrap.offsetHeight;
                wrap.style.transition = '';

                wrap.style.height = colH + 'px';
                wrap.classList.remove('expanded');

                if (aiState.scriptSteps.length === 0) {
                    const emptyEl = document.getElementById('aiScriptEmpty');
                    if (emptyEl) emptyEl.style.display = 'flex';
                }

                const cleanup = () => {
                    if (history) history.style.display = 'none';
                    wrap.style.height = '';
                    wrap.removeEventListener('transitionend', cleanup);
                };
                wrap.addEventListener('transitionend', cleanup, { once: true });
            } else {
                if (!history) return;
                const panel = wrap.closest('.ai-panel');
                const startH = wrap.offsetHeight;
                const targetH = Math.max(Math.round((panel?.offsetHeight || 400) * 2 / 3), 200);
                wrap.style.overflow = 'hidden';
                wrap.style.transition = 'none';
                wrap.style.height = startH + 'px';
                history.style.display = '';
                wrap.offsetHeight;
                wrap.style.transition = '';
                wrap.style.height = targetH + 'px';
                wrap.classList.add('expanded');

                const emptyEl = document.getElementById('aiScriptEmpty');
                if (emptyEl) emptyEl.style.display = 'none';

                const onDone = () => {
                    wrap.style.overflow = '';
                    wrap.removeEventListener('transitionend', onDone);
                };
                wrap.addEventListener('transitionend', onDone, { once: true });
                setTimeout(scrollChatToBottom, 50);
            }
        };
        window.aiStepsFloatAddAll = function() { aiAddAllStepsToScript(stepsFloat.currentSteps, true); };
        window.aiStepsFloatAddSingle = function(idx) {
            const step = stepsFloat.currentSteps[idx];
            if (!step) return;
            aiAddStepToScript(step);
            stepsFloat.markAdded(idx);
        };

        // ─── 实时回复容器（聊天气泡，只保留状态+耗时） ──────

        /**
         * 创建 AI 回复气泡（含状态 + 步骤区）
         */
        function createLiveReplyContainer() {

            const div = document.createElement('div');
            div.className = 'ai-msg assistant';
            div.innerHTML = `
                <div class="ai-msg-bubble">
                    <div class="ai-bubble-header">
                        <div class="ai-msg-avatar">${iconSvg('bot', 'ctl-icon ctl-icon--lg')}</div>
                        <div class="ai-timing" data-role="timing" style="display:none;"></div>
                    </div>
                    <div data-role="status" class="ai-thinking">
                        <div class="ai-thinking-dots"><span></span><span></span><span></span></div>
                        <span>正在连接AI服务...</span>
                    </div>
                    <div class="ai-reply-steps" data-role="steps" style="display:none;border:none;margin-top:6px;"></div>
                </div>
            `;
            dom.chatMessages?.appendChild(div);
            scrollChatToBottom();
            return div;
        }

        function extractErrorSummary(text: string): { summary: string; detail: string } {
            const raw = text || '';
            const prefixMatch = raw.match(/^(执行出错[：:]|请求失败[：:])\s*/);
            const body = prefixMatch ? raw.slice(prefixMatch[0].length) : raw;

            const firstLine = body.split(/\n/)[0];
            const atIdx = firstLine.indexOf(' at ');
            const briefText = atIdx > 0 ? firstLine.slice(0, atIdx).trim() : firstLine.trim();

            const prefix = prefixMatch ? prefixMatch[1] : '执行出错：';
            const summary = `${prefix}${briefText}`;

            const detail = atIdx > 0 || body.includes('\n')
                ? body.trim()
                : '';
            return { summary, detail };
        }

        function updateReplyStatus(container, state, text) {
            const el = container.querySelector('[data-role="status"]');
            if (!el) return;

            if (state === 'thinking' || state === 'executing') {
                el.className = 'ai-thinking';
                el.innerHTML = `
                    <div class="ai-thinking-dots"><span></span><span></span><span></span></div>
                    <span>${escapeHtml(text)}</span>`;
            } else if (state === 'done') {
                el.style.display = '';
                el.className = '';
                el.innerHTML = `<span class="ai-status-line ai-status-line--success">${iconSvg('circleCheck', 'ctl-icon ctl-icon--sm')} ${escapeHtml(text)}</span>`;
            } else if (state === 'stopped') {
                el.style.display = '';
                el.className = '';
                el.innerHTML = `<span class="ai-status-line ai-status-line--stopped">${iconSvg('square', 'ctl-icon ctl-icon--sm')} ${escapeHtml(text)}</span>`;
            } else if (state === 'error') {
                el.style.display = '';
                el.className = '';
                const { summary, detail } = extractErrorSummary(text);
                if (detail) {
                    el.innerHTML = `
                        <div class="ai-error-block">
                            <span class="ai-status-line ai-status-line--error">${iconSvg('circleX', 'ctl-icon ctl-icon--sm')} ${escapeHtml(summary)}</span>
                            <button class="ai-error-toggle" type="button" onclick="this.parentElement.classList.toggle('expanded')">详情</button>
                            <pre class="ai-error-detail">${escapeHtml(detail)}</pre>
                        </div>`;
                } else {
                    el.innerHTML = `<span class="ai-status-line ai-status-line--error">${iconSvg('circleX', 'ctl-icon ctl-icon--sm')} ${escapeHtml(summary)}</span>`;
                }
            }
        }

        function updateReplyTiming(container, ms) {
            const el = container.querySelector('[data-role="timing"]');
            if (el) {
                el.textContent = `耗时 ${formatDuration(ms)}`;
                el.style.display = '';
            }
        }

        /**
         * 实时追加步骤 → 写入指定容器内的步骤区
         */
        function appendLiveStep(container, step, index) {
            let stepsEl = container.querySelector('[data-role="steps"]');
            if (stepsEl) stepsEl.style.display = '';

            const targetText = step.target
                ? (step.action === 'input' && step.value ? `${step.target} → "${step.value}"` : step.target)
                : (step.value || '');
            const descText = step.description || '';

            const wrapper = document.createElement('div');
            wrapper.className = 'ai-step-wrapper';
            wrapper.dataset.stepIndex = index;

            const isPlan = (step.action || '').toLowerCase() === 'plan';
            const row = document.createElement('div');
            row.className = 'ai-reply-step executing';
            row.innerHTML = `
                <div class="ai-reply-step-info">
                    <span class="ai-step-action-tag ${step.action || 'action'}">${getActionLabel(step.action || 'action')}</span>
                    ${targetText
                        ? `<span class="ai-step-target" title="${escapeHtml(targetText)}">${escapeHtml(targetText)}</span>`
                        : `<span style="color:#999;font-size:12px;" title="${escapeHtml(descText)}">${escapeHtml(descText)}</span>`
                    }
                </div>
                <div class="ai-reply-step-actions">
                    ${isPlan ? `<button class="ai-step-thought-toggle" type="button" data-role="thought-toggle" title="查看思考过程">${iconSvg('brain', 'ctl-icon ctl-icon--sm')}</button>` : ''}
                </div>
            `;
            const thoughtPanel = document.createElement('div');
            thoughtPanel.className = 'ai-step-thought-panel';
            thoughtPanel.dataset.role = 'thought-panel';
            if (isPlan) {
                const toggleBtn = row.querySelector('[data-role="thought-toggle"]');
                if (toggleBtn) {
                    toggleBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const isOpen = thoughtPanel.classList.toggle('open');
                        toggleBtn.innerHTML = isOpen ? iconSvg('chevronUp', 'ctl-icon ctl-icon--sm') : iconSvg('brain', 'ctl-icon ctl-icon--sm');
                    });
                }
            }
            wrapper.appendChild(row);
            wrapper.appendChild(thoughtPanel);
            stepsEl?.appendChild(wrapper);
            stepsFloat.updateBadge(index + 1);

            if (isPlan) {
                flushChunkBuffer(container, wrapper);
            }

            scrollToContainer(container);
        }

        /**
         * 更新指定容器中步骤的状态图标
         */
        function updateLiveStepStatus(container, index, status) {
            const wrapper = container.querySelector(`.ai-step-wrapper[data-step-index="${index}"]`);
            if (!wrapper) return;
            const row = wrapper.querySelector('.ai-reply-step');
            if (row) {
                row.classList.remove('executing', 'success', 'error');
                if (status === 'success') row.classList.add('success');
                else if (status === 'error') row.classList.add('error');
                else row.classList.add('executing');
            }

            if (status === 'success' && container.querySelector(`.ai-step-wrapper[data-step-index="${index}"] .ai-reply-step`)) {
                const step = stepsFloat.currentSteps[index];
                if (step && step.action === 'done') {
                    const targetEl = wrapper.querySelector('.ai-step-target');
                    if (targetEl) targetEl.remove();
                }
            }
        }

        /**
         * 更新步骤的思考过程详情
         */
        function updateLiveStepDetail(container, taskIndex, detail) {
            const wrappers = container.querySelectorAll('.ai-step-wrapper[data-step-index]');
            let wrapper = null;
            for (const w of wrappers) {
                if (parseInt(w.dataset.stepIndex) === taskIndex) { wrapper = w; break; }
            }
            if (!wrapper) return;
            const panel = wrapper.querySelector('[data-role="thought-panel"]');
            if (!panel) return;

            if (_streamState.has(panel)) {
                finalizeStream(panel);
                return;
            }

            let html = '';
            if (detail.thought)   html += `<div class="thought-section"><span class="thought-label">思考：</span>${escapeHtml(detail.thought)}</div>`;
            if (detail.log)       html += `<div class="thought-section"><span class="log-label">日志：</span>${escapeHtml(detail.log)}</div>`;
            if (detail.reasoning) html += `<div class="thought-section"><span class="reasoning-label">推理：</span>${escapeHtml(detail.reasoning)}</div>`;
            if (!html) return;

            panel.innerHTML = html;
            wrapper.classList.add('has-thought');
            panel.classList.add('open');
            const toggleBtn = wrapper.querySelector('[data-role="thought-toggle"]');
            if (toggleBtn) toggleBtn.innerHTML = iconSvg('chevronUp', 'ctl-icon ctl-icon--sm');
            scrollToContainer(container);
            scrollElementIntoView(panel);
        }

        /**
         * 最终化步骤 → 在指定容器内完成
         */
        function finalizeLiveSteps(container, steps) {
            stepsFloat.currentSteps = steps;
            const execSteps = steps.filter(isExecutableStep);

            const stepsEl = container.querySelector('[data-role="steps"]');
            if (!stepsEl) { stepsFloat.finalize(steps); return; }

            const wrappers = stepsEl.querySelectorAll('.ai-step-wrapper');
            wrappers.forEach((w, i) => {
                const step = steps[i];
                if (!step) return;
                const row = w.querySelector('.ai-reply-step');
                if (row) {
                    row.classList.remove('executing', 'success', 'error');
                    if (step.status === 'error') row.classList.add('error');
                    else row.classList.add('success');
                }
                if (!row) return;
                if (isExecutableStep(step)) {
                    const stepIdx = execSteps.indexOf(step);
                    const existingBtns = row.querySelector('.ai-step-icon-btn');
                    if (!existingBtns) {
                        const btn = document.createElement('button');
                        btn.className = 'ai-step-icon-btn';
                        btn.title = '加入编辑区';
                        btn.innerHTML = iconSvg('clipboardPlus', 'ctl-icon ctl-icon--sm');
                        btn.onclick = (e) => { e.stopPropagation(); aiStepsFloatAddSingle(stepIdx); };
                        let actions = row.querySelector('.ai-reply-step-actions');
                        if (!actions) {
                            actions = document.createElement('div');
                            actions.className = 'ai-reply-step-actions';
                            row.appendChild(actions);
                        }
                        actions.appendChild(btn);
                    }
                }
            });

            if (execSteps.length > 0) {
                let addRow = container.querySelector('.ai-bubble-add-all-row');
                if (!addRow) {
                    addRow = document.createElement('div');
                    addRow.className = 'ai-bubble-add-all-row';
                    const addBtn = document.createElement('button');
                    addBtn.className = 'ai-bubble-add-all-btn';
                    addBtn.textContent = `全部加入编辑区（${execSteps.length}步）`;
                    addBtn.onclick = () => { aiAddAllStepsToScript(execSteps, true); };
                    addRow.appendChild(addBtn);
                    container.appendChild(addRow);
                }
            }
            scrollToContainer(container);
            const addRowEl = container.querySelector('.ai-bubble-add-all-row');
            if (addRowEl) {
                requestAnimationFrame(() => {
                    scrollElementIntoView(addRowEl, 80);
                    setTimeout(() => scrollElementIntoView(addRowEl, 80), 80);
                });
            }
        }

        /**
         * 替换步骤（fallback）→ 转交浮框
         */
        function replaceLiveSteps(container, steps) {
            stepsFloat.replace(steps);
        }

        // 快速消息
        window.aiSendQuickMessage = function(text) {
            if (dom.chatInput) {
                dom.chatInput.value = text;
            }
            aiSendMessage();
        };

        // 分离模式开关
        /** 供 hidden checkbox onchange 调用（保持兼容） */
        window.aiToggleSplitMode = function(checked) {
            localStorage.setItem('ai_split_mode', checked ? '1' : '0');
        };

        /** 点击标题栏"分离"按钮时调用 */
        window.aiToggleSplitModeBtn = function() {
            const toggle = document.getElementById('aiSplitModeToggle');
            if (!toggle) return;
            toggle.checked = !toggle.checked;
            aiToggleSplitMode(toggle.checked);
        };

        /** 分离/合并 AI 面板到独立窗口 */
        let detachedWin: Window | null = null;
        let detachPlaceholder: HTMLElement | null = null;
        const _origGetById = Document.prototype.getElementById;
        const _origQS = Document.prototype.querySelector;
        const _origQSA = Document.prototype.querySelectorAll;

        function patchDocLookups() {
            Document.prototype.getElementById = function(id: string) {
                const r = _origGetById.call(this, id);
                if (r) return r;
                if (detachedWin && !detachedWin.closed && this === document) {
                    return _origGetById.call(detachedWin.document, id);
                }
                return null;
            } as any;
            Document.prototype.querySelector = function(sel: string) {
                const r = _origQS.call(this, sel);
                if (r) return r;
                if (detachedWin && !detachedWin.closed && this === document) {
                    return _origQS.call(detachedWin.document, sel);
                }
                return null;
            } as any;
            Document.prototype.querySelectorAll = function(sel: string) {
                const mainList = _origQSA.call(this, sel);
                if (!detachedWin || detachedWin.closed || this !== document) return mainList;
                const popupList = _origQSA.call(detachedWin.document, sel);
                if (popupList.length === 0) return mainList;
                if (mainList.length === 0) return popupList;
                const arr = Array.from(mainList).concat(Array.from(popupList));
                return arr as any;
            } as any;
        }

        function unpatchDocLookups() {
            Document.prototype.getElementById = _origGetById;
            Document.prototype.querySelector = _origQS;
            Document.prototype.querySelectorAll = _origQSA;
        }

        function proxyWindowFunctionsToPopup(popupWin: Window) {
            const mainWin = window as any;
            const pw = popupWin as any;
            for (const key of Object.getOwnPropertyNames(mainWin)) {
                try {
                    if (typeof mainWin[key] !== 'function') continue;
                    if (key.startsWith('ai') || key.startsWith('_switch') ||
                        key.startsWith('_loc') || key.startsWith('_toggle') ||
                        key.startsWith('_sync') || key === 'showImgPreview' ||
                        key === 'showToast' || key === 'switchPanelTab' ||
                        key === 'recordingStepToScriptStep' || key === 'updateRecordToScriptBtn' ||
                        key === 'toggleToolbarCollapse') {
                        pw[key] = mainWin[key];
                    }
                } catch (_) {}
            }
        }

        function bindDocumentEventsToPopup(popupWin: Window) {
            const popupDoc = popupWin.document;
            popupDoc.addEventListener('click', (e: any) => {
                if (!e.target.closest('.ai-step-more')) (window as any).aiCloseStepMenus?.();
            });
            popupDoc.addEventListener('keydown', (e: KeyboardEvent) => {
                if (e.key === 'Escape') {
                    const overlay = popupDoc.getElementById('imgPreviewOverlay');
                    if (overlay) overlay.classList.remove('active');
                    const editOverlay = popupDoc.querySelector('.ai-step-edit-overlay');
                    if (editOverlay) (editOverlay as HTMLElement).remove();
                }
            });
        }

        function installPopupInteractionDelegation(popupWin: Window) {
            const d = popupWin.document;
            if ((d as any).__aiDetachDelegationInstalled) return;
            (d as any).__aiDetachDelegationInstalled = true;

            const invoke = (fnName: string, ...args: any[]) => {
                const fn = (window as any)[fnName];
                if (typeof fn === 'function') return fn(...args);
            };

            d.addEventListener('click', (e: any) => {
                const t = e.target as HTMLElement | null;
                if (!t) return;

                const btn = t.closest('button') as HTMLButtonElement | null;
                if (btn?.id === 'aiHeaderCopyBtn') { e.preventDefault(); invoke('aiCopySelectedSteps'); return; }
                if (btn?.id === 'aiHeaderSaveBtn') { e.preventDefault(); invoke('aiSaveScript'); return; }
                if (btn?.id === 'aiHeaderClearBtn') { e.preventDefault(); invoke('aiClearAllSteps'); return; }
                if (btn?.id === 'aiScriptSavedBtn') { e.preventDefault(); invoke('aiToggleSavedScriptsPanel'); return; }
                if (btn?.id === 'aiDetachBtn') { e.preventDefault(); invoke('aiToggleDetach'); return; }
                if (btn?.id === 'aiRecordToScriptBtn') { e.preventDefault(); invoke('aiToggleRecordToScript'); return; }
                if (btn?.id === 'aiActionRunBtn') { e.preventDefault(); invoke('aiToggleExecution'); return; }
                if (btn?.id === 'aiConvoCollapseBtn') { e.preventDefault(); invoke('aiToggleConvoMaximize'); return; }
                if (btn?.title === '打开日志面板') { e.preventDefault(); invoke('switchPanelTab', 'log'); return; }
            }, true);

            d.addEventListener('keydown', (e: any) => {
                const el = e.target as HTMLElement | null;
                if (el && (el as any).id === 'aiChatInput') invoke('aiHandleInputKeydown', e);
            }, true);

            d.addEventListener('input', (e: any) => {
                const el = e.target as HTMLElement | null;
                if (el && (el as any).id === 'aiChatInput') invoke('aiAutoResizeInput', el);
            }, true);
        }

        function rebindNativeHandlers(panel: HTMLElement) {
            const btnMap: Record<string, (...a: any[]) => void> = {
                aiHeaderCopyBtn: () => (window as any).aiCopySelectedSteps(),
                aiHeaderSaveBtn: () => (window as any).aiSaveScript(),
                aiHeaderClearBtn: () => (window as any).aiClearAllSteps(),
                aiScriptSavedBtn: () => (window as any).aiToggleSavedScriptsPanel(),
                aiDetachBtn: () => (window as any).aiToggleDetach(),
                aiRecordToScriptBtn: () => (window as any).aiToggleRecordToScript(),
                aiActionRunBtn: () => (window as any).aiToggleExecution(),
                aiConvoCollapseBtn: () => (window as any).aiToggleConvoMaximize(),
            };
            for (const [id, fn] of Object.entries(btnMap)) {
                const el = panel.querySelector('#' + id);
                if (el) el.addEventListener('click', fn);
            }
            const logBtn = panel.querySelector('button[title="打开日志面板"]');
            if (logBtn) logBtn.addEventListener('click', () => (window as any).switchPanelTab('log'));

            const input = panel.querySelector('#aiChatInput');
            if (input) {
                input.addEventListener('keydown', (e) => (window as any).aiHandleInputKeydown(e));
                input.addEventListener('input', (e) => (window as any).aiAutoResizeInput((e as Event).target));
            }
        }

        function bindDragHandleToPopup(popupWin: Window) {
            const handlers = (window as any).__dragHandlers;
            if (!handlers) return;
            popupWin.document.addEventListener('mousemove', handlers.onDragMove);
            popupWin.document.addEventListener('mouseup', handlers.onDragUp);
        }

        function copyStylesToWindow(targetWin: Window) {
            const targetDoc = targetWin.document;

            // Clear previously injected style clones (detach can be toggled repeatedly).
            try {
                targetDoc.querySelectorAll('[data-ai-detach-style]').forEach((el) => el.remove());
            } catch (_) {}

            // Clone <link rel="stylesheet"> and <style> from opener to ensure identical look.
            const headNodes = Array.from(document.head.querySelectorAll('link[rel="stylesheet"], style'));
            for (const node of headNodes) {
                try {
                    const cloned = node.cloneNode(true) as HTMLElement;
                    (cloned as any).dataset.aiDetachStyle = '1';
                    targetDoc.head.appendChild(cloned);
                } catch (_) {}
            }

            // Minimal safety rules so state toggles always render in popup
            // even if some stylesheets are delayed or blocked.
            try {
                const safety = targetDoc.createElement('style');
                (safety as any).dataset.aiDetachStyle = '1';
                safety.textContent = `
                    .ctl-popup.show { display: block !important; }
                    .ai-step-edit-overlay { position: fixed !important; inset: 0 !important; }
                    #imgPreviewOverlay { position: fixed !important; inset: 0 !important; }
                `;
                targetDoc.head.appendChild(safety);
            } catch (_) {}
        }

        async function doDetach() {
            const panel = document.getElementById('dockPanel');
            if (!panel || detachedWin) return;

            const rect = panel.getBoundingClientRect();
            const w = Math.max(380, Math.round(rect.width));
            const h = Math.round(window.innerHeight * 0.85);
            const left = window.screenX + window.innerWidth - w - 30;
            const top = window.screenY + 60;

            let popup: Window | null = null;
            const anyWin = window as any;
            if (anyWin.documentPictureInPicture?.requestWindow) {
                try {
                    popup = await anyWin.documentPictureInPicture.requestWindow({ width: w, height: h });
                } catch (_) {
                    popup = null;
                }
            }
            if (!popup) {
                popup = window.open(
                    '', 'ai_panel_detached',
                    `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=no,menubar=no,toolbar=no,location=no,status=no`
                );
                try { if (popup) popup.document.title = 'AI 助手'; } catch (_) {}
            }
            if (!popup) return;

            detachedWin = popup;

            try { popup.document.title = 'AI 助手'; } catch (_) {}
            const meta = popup.document.createElement('meta');
            meta.setAttribute('charset', 'utf-8');
            popup.document.head.appendChild(meta);
            const metaVP = popup.document.createElement('meta');
            metaVP.name = 'viewport';
            metaVP.content = 'width=device-width, initial-scale=1';
            popup.document.head.appendChild(metaVP);

            copyStylesToWindow(popup);

            const wrapStyle = popup.document.createElement('style');
            wrapStyle.textContent = `
                html, body {
                    margin: 0; padding: 0; height: 100%; overflow: hidden;
                    background: linear-gradient(135deg, #f0f2f5 0%, #e8eaf0 100%);
                    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                }
                #dockPanel {
                    position: fixed !important;
                    inset: 8px !important;
                    flex: none !important;
                    width: auto !important;
                    max-width: none !important;
                    min-width: 0 !important;
                    margin: 0 !important;
                    z-index: 1 !important;
                }
            `;
            popup.document.head.appendChild(wrapStyle);

            detachPlaceholder = document.createElement('div');
            detachPlaceholder.id = 'dockPanelPlaceholder';
            detachPlaceholder.style.display = 'none';
            panel.parentNode!.insertBefore(detachPlaceholder, panel);

            popup.document.body.appendChild(panel);
            patchDocLookups();
            proxyWindowFunctionsToPopup(popup);
            bindDocumentEventsToPopup(popup);
            installPopupInteractionDelegation(popup);
            bindDragHandleToPopup(popup);

            document.documentElement.classList.add('ctl-panel-detached');
            try { (window as any).__ctlDialogPortalContainer = popup.document.body; } catch (_) {}

            const stageCol = document.querySelector('.ctl-stage-col') as HTMLElement;
            if (stageCol) {
                stageCol.style.maxWidth = '';
                stageCol.style.flex = '';
            }

            const btn = panel.querySelector('#aiDetachBtn');
            if (btn) { btn.setAttribute('title', '合并面板'); btn.setAttribute('data-detached', '1'); }

            popup.addEventListener('beforeunload', () => { doAttach(); });
            popup.addEventListener('pagehide', () => { doAttach(); });
        }

        function doAttach() {
            unpatchDocLookups();
            try { delete (window as any).__ctlDialogPortalContainer; } catch (_) {}

            const panel = detachedWin && !detachedWin.closed
                ? _origGetById.call(detachedWin.document, 'dockPanel')
                : null;
            if (!panel || !detachPlaceholder) {
                if (detachedWin && !detachedWin.closed) detachedWin.close();
                detachedWin = null;
                detachPlaceholder = null;
                document.documentElement.classList.remove('ctl-panel-detached');
                return;
            }

            const imgOverlay = detachedWin.document.getElementById('imgPreviewOverlay');
            if (imgOverlay) document.body.appendChild(imgOverlay);

            detachPlaceholder.parentNode!.insertBefore(panel, detachPlaceholder);
            detachPlaceholder.remove();
            detachPlaceholder = null;

            document.documentElement.classList.remove('ctl-panel-detached');

            panel.style.cssText = '';

            const btn = panel.querySelector('#aiDetachBtn');
            if (btn) { btn.setAttribute('title', '分离面板'); btn.removeAttribute('data-detached'); }

            if (detachedWin && !detachedWin.closed) {
                detachedWin.close();
            }
            detachedWin = null;
        }

        window.aiToggleDetach = function() {
            if (detachedWin && !detachedWin.closed) {
                doAttach();
            } else {
                detachedWin = null;
                void doDetach();
            }
        };

        /** 切换已保存脚本面板 */
        window.aiToggleSavedScriptsPanel = function() {
            const panel = document.getElementById('aiScriptSavedPanel');
            const btn = document.getElementById('aiScriptSavedBtn');
            if (!panel) return;
            const isOpen = panel.classList.toggle('show');
            if (btn) btn.classList.toggle('active', isOpen);
            if (isOpen) {
                // 每次展开时刷新列表
                loadSavedScripts();
            }
        };

        // 输入框按键处理
        window.aiHandleInputKeydown = function(event) {
            // isComposing=true 时正在输入法组合阶段（中文输入），不应触发发送
            if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
                event.preventDefault();
                aiSendMessage();
            }
        };

        // 自动调整输入框高度
        window.aiAutoResizeInput = function(el) {
            el.style.height = 'auto';
            el.style.height = Math.min(el.scrollHeight, 100) + 'px';
        };

        function updateSendBtnState() {
            if (!dom.sendBtn) return;
            if (aiState.isProcessing) {
                dom.sendBtn.disabled = false;
                dom.sendBtn.classList.add('stop-mode');
                dom.sendBtn.title = '停止生成';
                dom.sendBtn.innerHTML = iconSvg('square', 'ctl-icon--sm');
                dom.sendBtn.onclick = aiStopGeneration;
            } else {
                dom.sendBtn.classList.remove('stop-mode');
                dom.sendBtn.title = '发送';
                dom.sendBtn.innerHTML = iconSvg('send', 'ctl-icon--sm');
                dom.sendBtn.onclick = aiSendMessage;
                dom.sendBtn.disabled = false;
            }
        }

        // ─── 脚本保存/加载 ──────────────────────────────────

        window.aiSaveScript = async function() {
            if (aiState.scriptSteps.length === 0) {
                addAiLog('ℹ️ 没有步骤可保存');
                return;
            }

            const defaultName = `AI脚本_${new Date().toLocaleString('zh-CN')}`;
            const name = window.showPromptDialog
                ? await window.showPromptDialog('保存脚本', {
                    message: '请输入脚本名称',
                    defaultValue: defaultName,
                    placeholder: '例如：登录流程 / 下单流程…',
                })
                : prompt('请输入脚本名称：', defaultName);
            if (!name || !String(name).trim()) return;

            const scriptData = {
                id: `ai_${Date.now()}`,
                name: String(name).trim(),
                steps: aiState.scriptSteps.map(s => ({
                    ...s,
                    screenshot: undefined, // 不保存截图以减小体积
                })),
                model: dom.modelSelect?.value || 'openai/gpt-4o',
                createdAt: new Date().toISOString(),
                stepCount: aiState.scriptSteps.length,
            };

            try {
                const resp = await fetch('/api/ai/scripts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(scriptData),
                });
                const data = await resp.json();
                if (data.success) {
                    showToast(`脚本已保存: ${scriptData.name}`, 'success');
                    addAiLog(`💾 脚本已保存: ${scriptData.name}`);
                    loadSavedScripts();
                } else {
                    showToast(`保存失败: ${data.error}`, 'error');
                    addAiLog(`❌ 保存失败: ${data.error}`);
                }
            } catch (err) {
                showToast(`保存失败: ${err.message}`, 'error');
                addAiLog(`❌ 保存失败: ${err.message}`);
            }
        };

        async function loadSavedScripts() {
            try {
                const resp = await fetch('/api/ai/scripts');
                const data = await resp.json();
                if (data.success && data.scripts) {
                    aiState.savedScripts = data.scripts;
                    renderSavedScripts();
                }
            } catch (err) {
                console.warn('加载AI脚本列表失败:', err);
            }
        }

        function renderSavedScripts() {
            if (!dom.savedScriptsList) return;
            const scripts = aiState.savedScripts;

            if (scripts.length === 0) {
                dom.savedScriptsList.innerHTML = '<div style="padding:10px;color:#666;font-size:12px;text-align:center;">暂无保存的脚本</div>';
                return;
            }

            dom.savedScriptsList.innerHTML = scripts.map(script => {
                const date = script.createdAt
                    ? new Date(script.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                    : '';
                return `
                    <div class="ai-saved-script-item" onclick="aiLoadScript('${script.id}')">
                        <div>
                            <div>${escapeHtml(script.name || '未命名脚本')}</div>
                            <div class="ai-saved-script-meta">${script.stepCount || 0} 步 · ${date}</div>
                        </div>
                        <div class="ai-saved-script-actions">
                            <button class="ai-step-icon-btn" type="button" onclick="event.stopPropagation(); aiExportScript('${script.id}')" title="导出为 pytest 测试文件" aria-label="导出">${iconSvg('download', 'ctl-icon ctl-icon--sm')}</button>
                            <button class="ai-step-icon-btn" type="button" onclick="event.stopPropagation(); aiDeleteScript('${script.id}')" title="删除" aria-label="删除">${iconSvg('trash', 'ctl-icon ctl-icon--sm')}</button>
                        </div>
                    </div>
                `;
            }).join('');
        }

        window.aiLoadScript = async function(scriptId) {
            try {
                const resp = await fetch(`/api/ai/scripts/${scriptId}`);
                const data = await resp.json();
                if (data.success && data.script && data.script.steps) {
                    aiState.scriptSteps = data.script.steps.map(s => ({
                        ...s,
                        status: 'pending',
                    }));
                    aiState.insertAfterIndex = -1;
                    aiState.activeGapParentId = null;
                    aiState.activeGapExplicit = false;
                    recomputeAllLogicGroupIds();
                    renderScriptSteps();
                    addAiLog(`📂 已加载脚本: ${data.script.name || scriptId} (${data.script.steps.length} 步)`);
                } else {
                    addAiLog(`❌ 加载脚本失败`);
                }
            } catch (err) {
                addAiLog(`❌ 加载脚本失败: ${err.message}`);
            }
        };

        window.aiDeleteScript = async function(scriptId) {
            const ok = window.showConfirmDialog
                ? await window.showConfirmDialog('删除脚本？', '此操作无法撤销。', 'danger', '删除', '取消')
                : confirm('确定删除此脚本？');
            if (!ok) return;
            try {
                await fetch(`/api/ai/scripts/${scriptId}`, { method: 'DELETE' });
                loadSavedScripts();
                showToast('脚本已删除', 'success');
                addAiLog('🗑 脚本已删除');
            } catch (err) {
                showToast(`删除失败: ${err.message}`, 'error');
                addAiLog(`❌ 删除失败: ${err.message}`);
            }
        };

        window.aiExportScript = async function(scriptId) {
            try {
                addAiLog('📤 正在导出脚本...');
                const resp = await fetch(`/api/ai/scripts/${scriptId}/export`);
                if (!resp.ok) {
                    const err = await resp.json();
                    throw new Error(err.error || '导出失败');
                }
                const blob = await resp.blob();
                const filename = resp.headers.get('Content-Disposition')?.match(/filename="?(.+?)"?$/)?.[1] || `test_${scriptId}.py`;
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = filename;
                a.click();
                URL.revokeObjectURL(a.href);
                addAiLog(`✅ 脚本已导出: ${filename}`);
            } catch (err) {
                addAiLog(`❌ 导出失败: ${err.message}`);
            }
        };

        // ─── 日志 ───────────────────────────────────────────

        function addAiLog(msg) {
            console.log(`[AI助手] ${msg}`);
            // 复用现有的 addLog 函数（如果存在）
            if (typeof addLog === 'function') {
                addLog(msg, 'AI', 'info');
            }
        }

        // ─── 拖拽调整会话区高度 ──────────────────────────────
        function initConvoDragResize() {
            const handle = document.getElementById('aiConvoDragHandle');
            const wrap = document.getElementById('aiConvoWrap');
            if (!handle || !wrap) return;

            let dragging = false;
            let didDrag = false;
            let startY = 0;
            let startH = 0;
            let collapsedSnapshot = 0;
            const FADE_ZONE = 60;

            function measureCollapsedHeight() {
                const history = document.getElementById('aiChatMessages');
                const wasExpanded = wrap!.classList.contains('expanded');
                const prevDisplay = history ? history.style.display : '';
                const prevHeight = wrap!.style.height;
                const prevTransition = wrap!.style.transition;

                if (history) history.style.display = 'none';
                wrap!.classList.remove('expanded');
                wrap!.style.height = '';
                wrap!.style.transition = 'none';
                const h = wrap!.offsetHeight;

                if (wasExpanded) wrap!.classList.add('expanded');
                if (history) history.style.display = prevDisplay;
                wrap!.style.height = prevHeight;
                wrap!.style.transition = prevTransition;
                wrap!.offsetHeight;
                return h;
            }

            const onDragMove = (e: MouseEvent) => {
                if (!dragging) return;
                e.preventDefault();
                if (!didDrag && Math.abs(e.clientY - startY) > 4) didDrag = true;
                if (!didDrag) return;
                const dy = startY - e.clientY;
                const panel = wrap!.closest('.ai-panel');
                const maxH = panel ? panel.clientHeight * 0.85 : 600;
                const minH = collapsedSnapshot;
                const newH = Math.max(minH, Math.min(startH + dy, maxH));
                wrap!.style.height = newH + 'px';

                const history = document.getElementById('aiChatMessages');
                if (history) {
                    const dist = newH - collapsedSnapshot;
                    const opacity = Math.min(1, Math.max(0, dist / FADE_ZONE));
                    if (opacity <= 0) {
                        if (history.style.display !== 'none') {
                            history.style.display = 'none';
                            history.style.opacity = '';
                            wrap!.classList.remove('expanded');
                            wrap!.style.height = '';
                            if (aiState.scriptSteps.length === 0) {
                                const emptyEl = document.getElementById('aiScriptEmpty');
                                if (emptyEl) emptyEl.style.display = 'flex';
                            }
                        }
                    } else {
                        if (history.style.display === 'none') {
                            history.style.transition = 'none';
                            history.style.opacity = '0';
                            history.style.display = '';
                            wrap!.classList.add('expanded');
                            wrap!.style.height = newH + 'px';
                            const emptyEl = document.getElementById('aiScriptEmpty');
                            if (emptyEl) emptyEl.style.display = 'none';
                        }
                        history.style.opacity = String(opacity);
                    }
                }
            };

            const onDragUp = () => {
                if (!dragging) return;
                dragging = false;
                const activeDoc = handle.ownerDocument;
                activeDoc.body.style.cursor = '';
                activeDoc.body.style.userSelect = '';

                if (!didDrag) {
                    const history = document.getElementById('aiChatMessages');
                    if (history) { history.style.opacity = ''; history.style.transition = ''; }
                    wrap!.style.transition = '';
                    return;
                }

                const currentH = wrap!.offsetHeight;
                const shouldCollapse = currentH <= collapsedSnapshot + 15;
                const history = document.getElementById('aiChatMessages');

                if (shouldCollapse) {
                    wrap!.classList.remove('expanded');
                    wrap!.style.transition = '';
                    wrap!.style.height = '';
                    if (history) { history.style.display = 'none'; history.style.opacity = ''; history.style.transition = ''; }
                    if (aiState.scriptSteps.length === 0) {
                        const emptyEl = document.getElementById('aiScriptEmpty');
                        if (emptyEl) emptyEl.style.display = 'flex';
                    }
                    if (dom.chatInput) {
                        dom.chatInput.value = '';
                        if (typeof window.aiAutoResizeInput === 'function') window.aiAutoResizeInput(dom.chatInput);
                    }
                } else {
                    wrap!.classList.add('expanded');
                    wrap!.style.overflow = '';
                    wrap!.style.transition = '';
                    if (history) { history.style.opacity = ''; history.style.transition = ''; }
                    const emptyEl = document.getElementById('aiScriptEmpty');
                    if (emptyEl) emptyEl.style.display = 'none';
                    setTimeout(scrollChatToBottom, 50);
                }
            };

            (window as any).__dragHandlers = { onDragMove, onDragUp };

            handle.addEventListener('mousedown', (e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                dragging = true;
                didDrag = false;
                startY = e.clientY;

                collapsedSnapshot = measureCollapsedHeight();
                startH = wrap!.offsetHeight;
                wrap!.style.transition = 'none';

                const activeDoc = handle.ownerDocument;
                activeDoc.body.style.cursor = 'ns-resize';
                activeDoc.body.style.userSelect = 'none';
            });

            document.addEventListener('mousemove', onDragMove);
            document.addEventListener('mouseup', onDragUp);
        }

        // ─── 初始化 ─────────────────────────────────────────

        // React 版本会在首屏渲染后主动调用 initAiCore()，无需依赖 DOMContentLoaded。
        initDom();
        initConvoDragResize();
        // 兜底：避免生成态残留导致输入框边框一直被隐藏
        setConvoGenerating(false);
        const iwInit = document.getElementById('aiInputWrapper');
        if (iwInit) { iwInit.style.border = ''; iwInit.style.boxShadow = ''; }
        const ciInit = document.getElementById('aiChatInput');
        if (ciInit) ciInit.style.display = '';
        recomputeAllLogicGroupIds();
        renderScriptSteps();
        loadSavedScripts();
        initOverlayExpandTouch();
        console.log('🤖 AI助手面板已初始化');

        function initOverlayExpandTouch() {
            const LONG_PRESS_MS = 500;
            let touchTimer = null;
            let currentExpanded = null;

            function clearExpanded() {
                if (currentExpanded) {
                    currentExpanded.classList.remove('touch-expanded');
                    currentExpanded = null;
                }
            }

            document.addEventListener('touchstart', (e) => {
                const el = e.target.closest('.ai-step-text, .ai-reply-step-info .ai-step-target');
                if (!el) { clearExpanded(); return; }
                touchTimer = setTimeout(() => {
                    clearExpanded();
                    el.classList.add('touch-expanded');
                    currentExpanded = el;
                }, LONG_PRESS_MS);
            }, { passive: true });

            document.addEventListener('touchend', () => {
                if (touchTimer) { clearTimeout(touchTimer); touchTimer = null; }
            }, { passive: true });

            document.addEventListener('touchmove', () => {
                if (touchTimer) { clearTimeout(touchTimer); touchTimer = null; }
            }, { passive: true });

            document.addEventListener('click', (e) => {
                if (currentExpanded && !currentExpanded.contains(e.target)) {
                    clearExpanded();
                }
            });
        }

    })();

    // ─── 顶部工具栏收起 / 展开 ──────────────────────────────────
    (function initToolbarCollapse() {
        async function initPullRopePhysics() {
            const pullTab = document.getElementById('toolbarPullTab');
            const pathEl = document.getElementById('toolbarPullTabRopePath');
            const knotEl = document.getElementById('toolbarPullTabKnot');
            if (!pullTab || !pathEl || !knotEl) return null;

            if (pullTab.dataset.ropePhysicsInit === '1') return { pullTab, pathEl, knotEl };
            pullTab.dataset.ropePhysicsInit = '1';

            const Matter = await import('matter-js');
            const { Engine, Bodies, Body, Composite, Constraint } = Matter;

            const engine = Engine.create({ enableSleeping: false });
            engine.gravity.y = 0.4;

            const SEGMENTS = 6;
            const ROPE_TOP_Y = 0;
            const ROPE_LEN = 15;
            const step = ROPE_LEN / SEGMENTS;
            const nodes = [];

            const anchor = Bodies.circle(0, ROPE_TOP_Y, 2, { isStatic: true });
            Composite.add(engine.world, anchor);

            for (let i = 0; i <= SEGMENTS; i++) {
                const node = Bodies.circle(0, ROPE_TOP_Y + i * step, 2, {
                    frictionAir: 0.06,
                    restitution: 0.15,
                    density: 0.0008,
                });
                nodes.push(node);
                Composite.add(engine.world, node);
                const a = i === 0 ? anchor : nodes[i - 1];
                Composite.add(engine.world, Constraint.create({
                    bodyA: a,
                    bodyB: node,
                    length: step,
                    stiffness: 0.95,
                    damping: 0.12,
                }));
            }

            const knotBody = nodes[nodes.length - 1];
            Body.setMass(knotBody, 0.8);
            knotBody.frictionAir = 0.08;

            // Rendering helpers (SVG path)
            function toPathD(points) {
                // Catmull-Rom to Bezier-ish smoothing (simple)
                const pts = points;
                if (pts.length < 2) return 'M0 0';
                let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
                for (let i = 1; i < pts.length; i++) {
                    const p0 = pts[i - 1];
                    const p1 = pts[i];
                    const cx = (p0.x + p1.x) / 2;
                    const cy = (p0.y + p1.y) / 2;
                    d += ` Q ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} ${cx.toFixed(2)} ${cy.toFixed(2)}`;
                }
                const last = pts[pts.length - 1];
                d += ` T ${last.x.toFixed(2)} ${last.y.toFixed(2)}`;
                return d;
            }

            let raf = 0;
            let lastTs = performance.now();

            const toolbarShell = document.querySelector('.ctl-toolbar-shell');

            function tick(ts) {
                const dt = Math.min(32, ts - lastTs);
                lastTs = ts;
                Engine.update(engine, dt);

                const shellH = toolbarShell ? toolbarShell.offsetHeight : 0;
                const anchorPt = { x: 7 + anchor.position.x, y: shellH + anchor.position.y };
                const pts = [anchorPt, ...nodes.map((b) => ({ x: 7 + b.position.x, y: shellH + b.position.y }))];
                pathEl.setAttribute('d', toPathD(pts));
                knotEl.setAttribute('cx', String(7 + knotBody.position.x));
                knotEl.setAttribute('cy', String(shellH + knotBody.position.y + 2));

                raf = requestAnimationFrame(tick);
            }
            raf = requestAnimationFrame(tick);

            // Interaction: tug (supports optional diagonal pull)
            // dy: positive pulls down; dx: negative pulls left.
            function pullDown(durationMs, dy, dx = 0) {
                const start = performance.now();
                const startX = knotBody.position.x;
                const startY = knotBody.position.y;
                const tickPull = () => {
                    const t = (performance.now() - start) / durationMs;
                    if (t >= 1) return;
                    const s = t * t * (3 - 2 * t);
                    Body.setPosition(knotBody, { x: startX + dx * s, y: startY + dy * s });
                    requestAnimationFrame(tickPull);
                };
                requestAnimationFrame(tickPull);
            }

            pullTab.addEventListener('mouseenter', (e) => {
                // Decide diagonal direction based on entry side:
                // enter from left → pull down-left; enter from right → pull down-right.
                let dir = -1;
                try {
                    const r = pullTab.getBoundingClientRect();
                    const cx = r.left + r.width / 2;
                    dir = (e && (e as MouseEvent).clientX >= cx) ? 1 : -1;
                } catch (_) {}
                pullDown(160, 3, dir * 3);
                setTimeout(() => pullDown(120, 2, dir * 2), 200);
            });

            let idleTimer = 0;
            function idleTug() {
                const root = document.documentElement;
                const collapsed = root.classList.contains('ctl-toolbar-collapsed');
                const peeking = root.classList.contains('ctl-toolbar-peek');
                if (collapsed && !peeking) {
                    pullDown(160, 3);
                    setTimeout(() => pullDown(120, 2), 200);
                }
                idleTimer = window.setTimeout(idleTug, 4000 + Math.random() * 3000);
            }
            idleTimer = window.setTimeout(idleTug, 3000);

            (window as any)._ropePullDown = pullDown;

            return { pullTab, pathEl, knotEl };
        }

        const SK_COLLAPSED = 'ctl-toolbar-collapsed';
        const SK_X = 'ctl-toolbar-pulltab-x';
        const CLS_PEEK = 'ctl-toolbar-peek';
        const root = document.documentElement;
        let _pullTabHovering = false;
        let _peekLeaveTimer = 0;

        function setPullTabX(x) {
            if (!Number.isFinite(x)) return;
            root.style.setProperty('--ctl-toolbar-pulltab-x', x + 'px');
        }

        function measureGapCenterX() {
            const videoBox = document.querySelector('.video-container');
            const isDetached = document.documentElement.classList.contains('ctl-panel-detached');

            // When AI panel is detached to a separate window, anchor the rope to the
            // right edge of the stage (video panel) instead of the stage/panel gap.
            if (isDetached && videoBox) {
                const vr = videoBox.getBoundingClientRect();
                if (vr.right > 0) {
                    // Use the right border as the rope's horizontal center.
                    // Slightly inset so the rope stays visually "on" the border.
                    // Shift a bit to the right so it doesn't feel stuck to the left edge.
                    return vr.right + 4;
                }
            }

            // Use the main document's dock panel (do not rely on cross-doc patched lookup).
            const rightPanel = (typeof _origGetById === 'function')
                ? _origGetById.call(document, 'dockPanel')
                : document.getElementById('dockPanel');
            if (videoBox && rightPanel) {
                const vr = videoBox.getBoundingClientRect();
                const rr = rightPanel.getBoundingClientRect();
                if (vr.right > 0 && rr.left > 0) {
                    return (vr.right + rr.left) / 2;
                }
            }
            if (rightPanel) {
                const r = rightPanel.getBoundingClientRect();
                if (r && r.left > 0) return r.left - 6;
            }
            return null;
        }

        function syncToolbarPullTabX() {
            // When hovering the pull-tab (peek state), keep the X locked.
            // Otherwise, videoFit/layout may shift the stage width slightly, moving the pull-tab
            // out from under the cursor and causing rapid enter/leave loops (visual shaking).
            if (_pullTabHovering && root.classList.contains(SK_COLLAPSED) && root.classList.contains(CLS_PEEK)) {
                return;
            }
            // Prefer positioning in the stage/panel gap so the rope never covers panels.
            const x = measureGapCenterX();
            if (x == null) return;
            setPullTabX(x);
        }

        function restorePullTabX() {
            // No longer restore from localStorage; always measure fresh from DOM.
        }

        function bindPullTabInteractions(pullTab) {
            if (!pullTab || pullTab.dataset.toolbarPulltabBound === '1') return;
            pullTab.dataset.toolbarPulltabBound = '1';

            // Ensure rope physics is initialized (SVG path updates + tug)
            void initPullRopePhysics();

            pullTab.addEventListener('mouseenter', () => {
                _pullTabHovering = true;
                if (!root.classList.contains(SK_COLLAPSED)) return;
                // Lock position before peeking to avoid hover jitter.
                syncToolbarPullTabX();
                root.classList.add(CLS_PEEK);
                if (_peekLeaveTimer) { clearTimeout(_peekLeaveTimer); _peekLeaveTimer = 0; }
            });
            pullTab.addEventListener('mouseleave', () => {
                _pullTabHovering = false;
                if (_peekLeaveTimer) clearTimeout(_peekLeaveTimer);
                // Delay removal slightly to prevent flicker caused by tiny layout shifts.
                _peekLeaveTimer = window.setTimeout(() => {
                    _peekLeaveTimer = 0;
                    const el = document.getElementById('toolbarPullTab');
                    if (el && el.matches(':hover')) return;
                    root.classList.remove(CLS_PEEK);
                    requestAnimationFrame(() => syncToolbarPullTabX());
                }, 120);
            });
            pullTab.addEventListener('mousedown', (e) => e.preventDefault());
        }

        function scheduleInitialSyncAndBind() {
            let tries = 0;
            let extraSyncs = 0;
            const tick = () => {
                tries += 1;
                syncToolbarPullTabX();
                const pullTab = document.getElementById('toolbarPullTab');
                if (pullTab) bindPullTabInteractions(pullTab);
                const rightPanel = document.getElementById('dockPanel');
                if (rightPanel && pullTab) {
                    extraSyncs += 1;
                    if (extraSyncs >= 10) return;
                }
                if (tries < 200) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        }

        window.toggleToolbarCollapse = function() {
            const wasCollapsed = root.classList.contains(SK_COLLAPSED);
            if (!wasCollapsed) syncToolbarPullTabX();

            if (wasCollapsed) {
                const ropePull = (window as any)._ropePullDown;
                if (ropePull) {
                    ropePull(250, 8);
                    setTimeout(() => ropePull(180, 4), 280);
                }

                setTimeout(() => {
                    root.classList.add('ctl-toolbar-expanding');
                    root.classList.remove(SK_COLLAPSED);
                    try { localStorage.setItem(SK_COLLAPSED, ''); } catch(_) {}
                    requestAnimationFrame(() => syncToolbarPullTabX());

                    const shell = document.querySelector('.ctl-toolbar-shell');
                    let done = false;
                    const onDone = () => {
                        if (done) return;
                        done = true;
                        shell?.removeEventListener('transitionend', onDone);
                        setTimeout(() => {
                            root.classList.remove('ctl-toolbar-expanding');
                            root.classList.remove(CLS_PEEK);
                        }, 80);
                    };
                    shell?.addEventListener('transitionend', onDone);
                    setTimeout(onDone, 700);
                }, 100);
            } else {
                root.classList.remove(CLS_PEEK);
                syncToolbarPullTabX();
                root.classList.add(SK_COLLAPSED);
                try { localStorage.setItem(SK_COLLAPSED, '1'); } catch(_) {}
            }
        };

        try { localStorage.removeItem(SK_X); } catch(_) {}
        if (localStorage.getItem(SK_COLLAPSED) === '1') {
            root.classList.add(SK_COLLAPSED);
        }

        scheduleInitialSyncAndBind();
        window.addEventListener('resize', () => syncToolbarPullTabX());

        // If the dock resize handle appears later, resync position.
        const mo = new MutationObserver(() => {
            const pullTab = document.getElementById('toolbarPullTab');
            if (pullTab) bindPullTabInteractions(pullTab);
            syncToolbarPullTabX();
        });
        mo.observe(document.body, { childList: true, subtree: true });

        // Keep in sync when panels resize (e.g. dock width drag, window resize).
        try {
            const ro = new ResizeObserver(() => syncToolbarPullTabX());
            const rightPanel = document.getElementById('dockPanel');
            const videoBox = document.querySelector('.video-container');
            if (rightPanel) ro.observe(rightPanel);
            if (videoBox) ro.observe(videoBox);
        } catch (_) {}
    })();

    // ─── 图像大图预览 lightbox ───────────────────────────────────
    (function() {
        const overlay = document.createElement('div');
        overlay.id = 'imgPreviewOverlay';
        overlay.innerHTML = '<img id="imgPreviewImg" src="" alt="大图预览">';
        document.body.appendChild(overlay);

        overlay.addEventListener('click', () => overlay.classList.remove('active'));
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') overlay.classList.remove('active');
        });

        window.showImgPreview = function(src) {
            const panelEl = document.getElementById('dockPanel');
            const targetBody = panelEl ? panelEl.ownerDocument.body : document.body;
            if (overlay.parentNode !== targetBody) targetBody.appendChild(overlay);
            const img = overlay.querySelector('#imgPreviewImg') as HTMLImageElement;
            if (img) img.src = src;
            overlay.classList.add('active');
        };
    })();
}
