'use strict';

const crypto = require('crypto');
const path = require('path');
const vscode = require('vscode');
const { exportSession, openLocalPath, openSessionFile } = require('./exporter');

function makeNonce() {
  return crypto.randomBytes(16).toString('base64');
}

function truncateTitle(value, max) {
  const limit = max || 44;
  const text = String(value || 'Codex 聊天记录');
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

class ChatPanel {
  constructor(panel, context, store, sessionInfo) {
    this.panel = panel;
    this.context = context;
    this.store = store;
    this.sessionInfo = sessionInfo;
    this.ready = false;
    this.pendingMessage = null;
    this.reloadTimer = null;
    this.disposed = false;
    this.disposables = [];

    panel.webview.html = this.getHtml(panel.webview);
    this.disposables.push(panel.onDidDispose(() => this.dispose()));
    this.disposables.push(panel.webview.onDidReceiveMessage((message) => this.onMessage(message)));
    this.configListener = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('codexHistory')) {
        this.reload();
      }
    });
    this.disposables.push(this.configListener);
    this.updateTitle();
  }

  static createOrShow(context, store, sessionInfo, options) {
    const opts = options || {};
    if (ChatPanel.current) {
      ChatPanel.current.panel.reveal(ChatPanel.current.panel.viewColumn, false);
      ChatPanel.current.open(sessionInfo, opts.focusIndex);
      return ChatPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      'codexHistory.chat',
      truncateTitle(sessionInfo.title),
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
      }
    );
    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.svg');
    const instance = new ChatPanel(panel, context, store, sessionInfo);
    ChatPanel.current = instance;
    instance.open(sessionInfo, opts.focusIndex);
    return instance;
  }

  static refreshCurrent() {
    if (ChatPanel.current) {
      ChatPanel.current.reload();
    }
  }

  static onFileChanged(filePath) {
    const current = ChatPanel.current;
    if (!current) {
      return;
    }
    if (path.resolve(current.sessionInfo.path) !== path.resolve(filePath)) {
      return;
    }
    if (current.reloadTimer) {
      clearTimeout(current.reloadTimer);
    }
    current.reloadTimer = setTimeout(() => {
      current.reloadTimer = null;
      current.reload(true);
    }, 450);
  }

  getSettings() {
    const config = vscode.workspace.getConfiguration('codexHistory');
    return {
      showToolCalls: config.get('showToolCalls', true),
      showReasoning: config.get('showReasoning', true),
      openToolCalls: config.get('expandToolCalls', false)
    };
  }

  open(sessionInfo, focusIndex) {
    this.sessionInfo = sessionInfo;
    this.updateTitle();
    const message = {
      type: 'session',
      session: null,
      settings: this.getSettings(),
      focusIndex: typeof focusIndex === 'number' ? focusIndex : undefined,
      resetFilter: true
    };
    try {
      message.session = this.store.read(sessionInfo);
    } catch (error) {
      this.panel.webview.postMessage({ type: 'error', message: error.message });
      return;
    }
    if (this.ready) {
      this.panel.webview.postMessage(message);
      this.pendingMessage = null;
    } else {
      this.pendingMessage = message;
    }
  }

  reload(silent) {
    if (this.disposed || !this.sessionInfo) {
      return;
    }
    let parsed;
    try {
      parsed = this.store.read(this.sessionInfo);
    } catch (error) {
      this.panel.webview.postMessage({ type: 'error', message: error.message });
      return;
    }
    this.updateTitle(parsed.meta.title);
    this.panel.webview.postMessage({
      type: 'session',
      session: parsed,
      settings: this.getSettings(),
      silent: Boolean(silent)
    });
    this.pendingMessage = null;
  }

  updateTitle(override) {
    const title = override || (this.sessionInfo ? this.sessionInfo.title : '');
    this.panel.title = title ? `${truncateTitle(title, 42)} — Codex` : 'Codex 聊天记录';
  }

  async onMessage(message) {
    const data = message || {};
    if (data.type === 'ready') {
      this.ready = true;
      if (this.pendingMessage) {
        this.panel.webview.postMessage(this.pendingMessage);
        this.pendingMessage = null;
      } else {
        this.reload(true);
      }
      return;
    }
    if (data.type === 'refresh') {
      this.reload();
      return;
    }
    if (data.type === 'copy' && typeof data.text === 'string') {
      await vscode.env.clipboard.writeText(data.text);
      vscode.window.setStatusBarMessage('已复制到剪贴板', 1500);
      return;
    }
    if (data.type === 'openRaw') {
      await openSessionFile(this.sessionInfo);
      return;
    }
    if (data.type === 'export') {
      await exportSession(this.store, this.sessionInfo);
      return;
    }
    if (data.type === 'openLink' && typeof data.href === 'string') {
      const href = data.href;
      if (/^https?:|^mailto:/i.test(href)) {
        await vscode.env.openExternal(vscode.Uri.parse(href));
      } else if (/^file:/i.test(href) || /^[a-zA-Z]:[\\/]/.test(href) || href.startsWith('\\\\') || href.startsWith('/') || /^\.{1,2}[\\/]/.test(href)) {
        const base = this.sessionInfo && this.sessionInfo.cwd ? this.sessionInfo.cwd : undefined;
        await openLocalPath(href, base);
      }
    }
  }

  getHtml(webview) {
    const nonce = makeNonce();
    const media = (name) => webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', name));
    const csp = webview.cspSource;
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${csp} data: https:; style-src ${csp}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${media('chat.css')}">
  <title>Codex 聊天记录</title>
</head>
<body>
  <header class="chat-header">
    <div class="title-row">
      <h1 id="session-title">加载中…</h1>
      <div class="actions">
        <button id="btn-refresh" type="button" title="重新读取会话记录">刷新</button>
        <button id="btn-export" type="button" title="导出为 Markdown 文件">导出</button>
        <button id="btn-raw" type="button" title="打开原始 .jsonl 记录">原始文件</button>
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
  <button id="jump-bottom" type="button" title="回到最新消息">↓</button>
  <script nonce="${nonce}" src="${media('markdown.js')}"></script>
  <script nonce="${nonce}" src="${media('chat.js')}"></script>
</body>
</html>`;
  }

  dispose() {
    this.disposed = true;
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
    }
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
    if (ChatPanel.current === this) {
      ChatPanel.current = null;
    }
  }
}

ChatPanel.current = null;

module.exports = { ChatPanel };
