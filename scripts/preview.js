'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseSessionFile } = require('../src/parser');

const root = path.join(__dirname, '..');
const output = path.join(process.env.FTIMA_DISPOSABLE_TEMP || os.tmpdir(), 'codex-chat-preview');
const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');

function walk(dir, files) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      files.push(full);
    }
  }
}

function loadTitles() {
  const titles = new Map();
  const indexPath = path.join(codexHome, 'session_index.jsonl');
  if (!fs.existsSync(indexPath)) {
    return titles;
  }
  for (const line of fs.readFileSync(indexPath, 'utf8').split(/\r?\n/)) {
    if (!line) {
      continue;
    }
    try {
      const entry = JSON.parse(line);
      if (entry.id) {
        titles.set(entry.id, entry.thread_name || '');
      }
    } catch (error) {
      // ignore
    }
  }
  return titles;
}

const files = [];
walk(path.join(codexHome, 'sessions'), files);
files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
const titles = loadTitles();

let chosen = null;
for (const file of files.slice(0, 40)) {
  const session = parseSessionFile(file, {});
  session.meta.title = titles.get(session.meta.id) || session.meta.title;
  const messageCount = session.items.filter((item) => item.type === 'user' || item.type === 'assistant').length;
  if (
    !session.meta.title ||
    session.meta.title.startsWith('<') ||
    session.meta.title === '未命名会话' ||
    messageCount < 6 ||
    messageCount > 120
  ) {
    continue;
  }
  const score = Math.abs(28 - messageCount) + (session.items.some((item) => item.images && item.images.length) ? 0 : 4);
  if (!chosen || score < chosen.score) {
    chosen = { session, score, file };
  }
}

if (!chosen) {
  console.error('no sessions found');
  process.exit(1);
}

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
for (const name of ['chat.css', 'chat.js', 'markdown.js', 'icon.svg']) {
  fs.copyFileSync(path.join(root, 'media', name), path.join(output, name));
}
fs.writeFileSync(path.join(output, 'session.js'), `window.__SESSION__ = ${JSON.stringify(chosen.session)};\n`, 'utf8');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="chat.css">
  <title>Codex 聊天记录预览</title>
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
                  session: window.__SESSION__,
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
  <script src="session.js"></script>
  <script src="markdown.js"></script>
  <script src="chat.js"></script>
</body>
</html>`;

fs.writeFileSync(path.join(output, 'preview.html'), html, 'utf8');
console.log(path.join(output, 'preview.html'));
console.log(`session: ${chosen.session.meta.title} (${chosen.session.items.length} items)`);
