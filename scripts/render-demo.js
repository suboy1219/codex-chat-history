'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const mediaDir = path.join(root, 'media');
const outputDir = path.join(root, 'docs', 'images');
const tempRoot = path.join(process.env.FTIMA_DISPOSABLE_TEMP || os.tmpdir(), 'codex-chat-history-demo');

const FONT = '"Segoe UI", "Microsoft YaHei", system-ui, sans-serif';
const MONO = '"Cascadia Code", "Consolas", monospace';

const THEMES = {
  dark: {
    '--vscode-font-family': FONT,
    '--vscode-font-size': '13px',
    '--vscode-editor-font-family': MONO,
    '--vscode-editor-foreground': '#cccccc',
    '--vscode-editor-background': '#1f1f1f',
    '--vscode-foreground': '#cccccc',
    '--vscode-descriptionForeground': '#9d9d9d',
    '--vscode-sideBar-background': '#181818',
    '--vscode-panel-border': '#2b2b2b',
    '--vscode-button-background': '#0078d4',
    '--vscode-button-foreground': '#ffffff',
    '--vscode-button-border': 'transparent',
    '--vscode-button-secondaryBackground': '#313131',
    '--vscode-button-secondaryForeground': '#cccccc',
    '--vscode-button-secondaryHoverBackground': '#3c3c3c',
    '--vscode-input-background': '#313131',
    '--vscode-input-foreground': '#cccccc',
    '--vscode-input-border': '#3c3c3c',
    '--vscode-focusBorder': '#0078d4',
    '--vscode-textLink-foreground': '#4daafc',
    '--vscode-textCodeBlock-background': '#181818',
    '--vscode-textBlockQuote-background': '#2b2b2b',
    '--vscode-textBlockQuote-border': '#0078d4',
    '--vscode-textBlockQuote-foreground': '#cccccc',
    '--vscode-errorForeground': '#f85149',
    '--vscode-editorWarning-foreground': '#cca700',
    '--vscode-inputValidation-warningBackground': '#352a05',
    '--vscode-badge-background': '#616161',
    '--vscode-keybindingTable-headerBackground': '#2b2b2b',
    '--vscode-toolbar-hoverBackground': '#2b2b2b'
  },
  light: {
    '--vscode-font-family': FONT,
    '--vscode-font-size': '13px',
    '--vscode-editor-font-family': MONO,
    '--vscode-editor-foreground': '#3b3b3b',
    '--vscode-editor-background': '#ffffff',
    '--vscode-foreground': '#3b3b3b',
    '--vscode-descriptionForeground': '#717171',
    '--vscode-sideBar-background': '#f8f8f8',
    '--vscode-panel-border': '#e5e5e5',
    '--vscode-button-background': '#005fb8',
    '--vscode-button-foreground': '#ffffff',
    '--vscode-button-border': 'transparent',
    '--vscode-button-secondaryBackground': '#e5e5e5',
    '--vscode-button-secondaryForeground': '#3b3b3b',
    '--vscode-button-secondaryHoverBackground': '#d9d9d9',
    '--vscode-input-background': '#ffffff',
    '--vscode-input-foreground': '#3b3b3b',
    '--vscode-input-border': '#cecece',
    '--vscode-focusBorder': '#005fb8',
    '--vscode-textLink-foreground': '#005fb8',
    '--vscode-textCodeBlock-background': '#f6f6f6',
    '--vscode-textBlockQuote-background': '#f6f6f6',
    '--vscode-textBlockQuote-border': '#005fb8',
    '--vscode-textBlockQuote-foreground': '#3b3b3b',
    '--vscode-errorForeground': '#e51400',
    '--vscode-editorWarning-foreground': '#bf8803',
    '--vscode-inputValidation-warningBackground': '#fff4ce',
    '--vscode-badge-background': '#cccccc',
    '--vscode-keybindingTable-headerBackground': '#f6f6f6',
    '--vscode-toolbar-hoverBackground': '#e5e5e5'
  }
};

const DEMO_SESSION = {
  meta: {
    id: '00000000-0000-4000-8000-000000000000',
    title: '优化登录页的错误提示',
    cwd: '~/projects/demo-app',
    model: 'gpt-5-codex',
    timestamp: '2026-11-20T06:12:00.000Z',
    updatedAt: '2026-11-20T06:18:00.000Z',
    archived: false
  },
  stats: { messages: 2, replies: 3, tools: 2, turns: 3 },
  items: [
    {
      type: 'user',
      time: '2026-11-20T06:12:00.000Z',
      text: '登录页在密码错误时只显示一个红色感叹号，能改成明确的提示文案吗？'
    },
    {
      type: 'assistant',
      time: '2026-11-20T06:12:20.000Z',
      text: '可以。我先定位表单的错误处理逻辑，再补充文案映射和单元测试。'
    },
    {
      type: 'reasoning',
      time: '2026-11-20T06:12:26.000Z',
      text: '错误码 401 与网络异常需要区分，避免把网络问题提示成密码错误。'
    },
    {
      type: 'tool',
      name: 'read_file',
      time: '2026-11-20T06:12:31.000Z',
      input: '{\n  "path": "src/pages/login.tsx"\n}',
      output: 'export function LoginForm() {\n  const [error, setError] = useState("");\n  // ...\n}'
    },
    {
      type: 'assistant',
      time: '2026-11-20T06:13:10.000Z',
      text: '已把错误码映射到具体文案：\n\n- `invalid_credentials` → 邮箱或密码不正确\n- `too_many_attempts` → 尝试次数过多，请稍后再试\n- 网络异常 → 无法连接服务器，请检查网络\n\n原来的红色图标保留，但不再只显示感叹号。'
    },
    {
      type: 'user',
      time: '2026-11-20T06:14:02.000Z',
      text: '顺便补一个测试。'
    },
    {
      type: 'tool',
      name: 'shell',
      time: '2026-11-20T06:14:20.000Z',
      input: '{\n  "command": "npm test -- login"\n}',
      output: 'PASS src/pages/login.test.tsx\n  ✓ shows invalid credentials message\n  ✓ shows network error message'
    },
    {
      type: 'assistant',
      time: '2026-11-20T06:15:00.000Z',
      text: '测试已补齐，覆盖密码错误和网络异常两个分支。'
    }
  ]
};

const SIDEBAR_SESSIONS = [
  { title: '优化登录页的错误提示', meta: '今天 14:20 · 41 KB', active: true },
  { title: '修复订单导出乱码', meta: '今天 11:05 · 128 KB' },
  { title: '重构设置页的状态管理', meta: '今天 09:32 · 86 KB' },
  { title: '补充 API 超时重试', meta: '昨天 18:47 · 203 KB' },
  { title: '更新依赖版本', meta: '昨天 10:12 · 57 KB' },
  { title: '梳理支付回调日志', meta: '11月18日 16:20 · 74 KB' }
];

const SIDEBAR_GROUPS = [
  { label: '今天 (3)', items: SIDEBAR_SESSIONS.slice(0, 3) },
  { label: '昨天 (2)', items: SIDEBAR_SESSIONS.slice(3, 5) },
  { label: '11月18日 (1)', items: SIDEBAR_SESSIONS.slice(5) }
];

function themeCss(vars) {
  return `:root {\n${Object.entries(vars)
    .map(([key, value]) => `  ${key}: ${value};`)
    .join('\n')}\n}`;
}

function chatHtml(theme) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${themeCss(THEMES[theme])}</style>
  <link rel="stylesheet" href="chat.css">
  <title>Codex 聊天记录</title>
</head>
<body>
  <header class="chat-header">
    <div class="title-row">
      <h1 id="session-title">加载中…</h1>
      <div class="actions">
        <button id="btn-refresh" type="button">刷新</button>
        <button id="btn-export" type="button">导出</button>
        <button id="btn-raw" type="button">原始文件</button>
      </div>
    </div>
    <div class="meta" id="session-meta"></div>
    <div class="toolbar">
      <input id="filter" type="search" placeholder="在本次会话中搜索（Ctrl+F）" autocomplete="off">
      <span id="filter-count"></span>
      <label><input type="checkbox" id="toggle-tools" checked> 工具调用</label>
      <label><input type="checkbox" id="toggle-reasoning" checked> 思考</label>
      <button id="btn-expand" type="button">展开全部</button>
      <button id="btn-collapse" type="button">收起全部</button>
    </div>
  </header>
  <main id="messages" class="messages">
    <div id="messages-inner" class="messages-inner"></div>
  </main>
  <button id="jump-bottom" type="button">↓</button>
  <script>
    window.acquireVsCodeApi = function () {
      return {
        postMessage: function (message) {
          if (message && message.type === 'ready') {
            setTimeout(function () {
              window.dispatchEvent(new MessageEvent('message', {
                data: {
                  type: 'session',
                  session: ${JSON.stringify(DEMO_SESSION)},
                  settings: { showToolCalls: true, showReasoning: true, openToolCalls: false }
                }
              }));
            }, 20);
          }
        },
        getState: function () { return {}; },
        setState: function () {}
      };
    };
  </script>
  <script src="markdown.js"></script>
  <script src="chat.js"></script>
</body>
</html>`;
}

function sidebarItem(session) {
  return `<div class="session${session.active ? ' active' : ''}">
    <svg class="session-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 2.5h11v8.5h-6L4 13.5V11H2.5z"/></svg>
    <div class="session-text">
      <div class="session-title">${session.title}</div>
      <div class="session-meta">${session.meta}</div>
    </div>
  </div>`;
}

function windowHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>codex-chat-history</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; height: 100%; overflow: hidden; }
    body {
      font-family: ${FONT};
      font-size: 13px;
      color: #cccccc;
      background: #1f1f1f;
    }
    .titlebar {
      height: 32px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 12px;
      background: #181818;
      border-bottom: 1px solid #2b2b2b;
      color: #cccccc;
      font-size: 12px;
    }
    .traffic { width: 8px; height: 8px; border-radius: 50%; background: #3c3c3c; }
    .traffic + .traffic { margin-left: 2px; }
    .titlebar-text { margin-left: 8px; color: #9d9d9d; }
    .workbench { display: flex; height: calc(100% - 32px); }
    .activitybar {
      width: 48px;
      flex: 0 0 48px;
      background: #181818;
      border-right: 1px solid #2b2b2b;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding-top: 10px;
      gap: 18px;
    }
    .activitybar .icon {
      width: 24px;
      height: 24px;
      opacity: .55;
      display: grid;
      place-items: center;
    }
    .activitybar .icon.active { opacity: 1; border-left: 2px solid #0078d4; width: 48px; }
    .activitybar svg { width: 20px; height: 20px; fill: none; stroke: #cccccc; stroke-width: 1.4; }
    .sidebar {
      width: 330px;
      flex: 0 0 330px;
      background: #181818;
      border-right: 1px solid #2b2b2b;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .sidebar-head {
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 12px 0 16px;
      font-size: 11px;
      letter-spacing: .06em;
      text-transform: uppercase;
      color: #cccccc;
    }
    .count {
      min-width: 18px;
      padding: 1px 6px;
      border-radius: 9px;
      background: #313131;
      color: #cccccc;
      font-size: 10px;
      text-align: center;
    }
    .search {
      margin: 2px 10px 8px;
      height: 24px;
      border: 1px solid #3c3c3c;
      background: #313131;
      border-radius: 4px;
      color: #9d9d9d;
      display: flex;
      align-items: center;
      padding: 0 8px;
      font-size: 12px;
    }
    .group-label {
      padding: 7px 16px 3px;
      color: #9d9d9d;
      font-size: 11px;
      font-weight: 600;
    }
    .session {
      display: flex;
      gap: 8px;
      align-items: flex-start;
      padding: 6px 12px 6px 14px;
      border-left: 2px solid transparent;
    }
    .session.active { background: #2a2d2e; border-left-color: #0078d4; }
    .session-icon { width: 15px; height: 15px; flex: 0 0 15px; margin-top: 2px; fill: #7d7d7d; }
    .session.active .session-icon { fill: #4daafc; }
    .session-text { min-width: 0; }
    .session-title {
      color: #cccccc;
      font-size: 13px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 282px;
    }
    .session-meta { color: #8c8c8c; font-size: 11px; margin-top: 2px; }
    .editor { flex: 1 1 auto; min-width: 0; background: #1f1f1f; }
    iframe { width: 100%; height: 100%; border: 0; display: block; }
  </style>
</head>
<body>
  <div class="titlebar">
    <span class="traffic"></span><span class="traffic"></span><span class="traffic"></span>
    <span class="titlebar-text">demo-app — Visual Studio Code</span>
  </div>
  <div class="workbench">
    <div class="activitybar">
      <div class="icon"><svg viewBox="0 0 24 24"><path d="M5 4h14v12H9l-4 4z"/></svg></div>
      <div class="icon active"><svg viewBox="0 0 24 24"><path d="M4 5h16M4 12h16M4 19h10"/></svg></div>
      <div class="icon"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M16 16l4 4"/></svg></div>
      <div class="icon"><svg viewBox="0 0 24 24"><path d="M12 3v18M3 12h18"/></svg></div>
    </div>
    <div class="sidebar">
      <div class="sidebar-head"><span>历史会话</span><span class="count">12</span></div>
      <div class="search">搜索会话</div>
      ${SIDEBAR_GROUPS.map(
        (group) => `<div class="group-label">${group.label}</div>
      ${group.items.map(sidebarItem).join('\n      ')}`
      ).join('\n      ')}
    </div>
    <div class="editor"><iframe src="chat-dark.html"></iframe></div>
  </div>
</body>
</html>`;
}

function findEdge() {
  const candidates = [
    process.env.EDGE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/microsoft-edge',
    '/usr/bin/google-chrome'
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function screenshot(edge, htmlFile, pngFile, width, height) {
  const url = `file:///${htmlFile.replace(/\\/g, '/')}`;
  execFileSync(
    edge,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1.5',
      `--window-size=${width},${height}`,
      '--virtual-time-budget=4000',
      `--user-data-dir=${path.join(tempRoot, 'edge-profile')}`,
      `--screenshot=${pngFile}`,
      url
    ],
    { stdio: 'pipe', windowsHide: true }
  );
}

function main() {
  const edge = findEdge();
  if (!edge) {
    console.error('找不到 Edge/Chrome，无法生成截图。可用 EDGE_PATH 指定浏览器路径。');
    process.exit(1);
  }
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.mkdirSync(tempRoot, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  for (const name of ['chat.css', 'chat.js', 'markdown.js']) {
    fs.copyFileSync(path.join(mediaDir, name), path.join(tempRoot, name));
  }
  fs.writeFileSync(path.join(tempRoot, 'chat-dark.html'), chatHtml('dark'), 'utf8');
  fs.writeFileSync(path.join(tempRoot, 'chat-light.html'), chatHtml('light'), 'utf8');
  fs.writeFileSync(path.join(tempRoot, 'overview.html'), windowHtml(), 'utf8');

  screenshot(edge, path.join(tempRoot, 'overview.html'), path.join(outputDir, 'overview-dark.png'), 1440, 900);
  screenshot(edge, path.join(tempRoot, 'chat-light.html'), path.join(outputDir, 'chat-light.png'), 1280, 900);

  for (const name of ['overview-dark.png', 'chat-light.png']) {
    const size = fs.statSync(path.join(outputDir, name)).size;
    console.log(`${name}: ${(size / 1024).toFixed(1)} KB`);
  }

  const resolved = path.resolve(tempRoot);
  const allowedRoots = [
    path.resolve(os.tmpdir()),
    process.env.FTIMA_DISPOSABLE_TEMP ? path.resolve(process.env.FTIMA_DISPOSABLE_TEMP) : ''
  ].filter(Boolean);
  if (path.basename(resolved) === 'codex-chat-history-demo' && allowedRoots.some((root) => resolved.startsWith(root))) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

main();
