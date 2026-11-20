'use strict';

const assert = require('assert');
const Module = require('module');

const commands = new Map();
const watchers = [];
const panels = [];
const clipboard = [];
const externalLinks = [];
let panelMessageHandler = null;
let treeView = null;
let config = {};

class EventEmitter {
  constructor() {
    this.listeners = [];
  }

  get event() {
    return (listener) => {
      this.listeners.push(listener);
      return { dispose: () => {} };
    };
  }

  fire(value) {
    for (const listener of this.listeners) {
      listener(value);
    }
  }
}

class TreeItem {
  constructor(label, collapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

class ThemeIcon {
  constructor(id) {
    this.id = id;
  }
}

class MarkdownString {
  constructor() {
    this.value = '';
  }

  appendMarkdown(value) {
    this.value += value;
    return this;
  }

  appendText(value) {
    this.value += value;
    return this;
  }
}

class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
}

class Range {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }
}

class Selection extends Range {}

function uriOf(filePath) {
  return {
    fsPath: filePath,
    scheme: 'file',
    toString: () => `file:///${String(filePath).replace(/\\/g, '/')}`
  };
}

function createFakePanel() {
  const panel = {
    title: '',
    iconPath: null,
    viewColumn: 1,
    webview: {
      html: '',
      cspSource: 'vscode-resource:',
      asWebviewUri: (uri) => uri,
      messages: [],
      postMessage(message) {
        this.messages.push(message);
      },
      onDidReceiveMessage(handler) {
        panelMessageHandler = handler;
        return { dispose: () => {} };
      }
    },
    onDidDispose() {
      return { dispose: () => {} };
    },
    reveal() {},
    dispose() {}
  };
  panels.push(panel);
  return panel;
}

const vscodeMock = {
  EventEmitter,
  TreeItem,
  ThemeIcon,
  MarkdownString,
  Position,
  Range,
  Selection,
  ProgressLocation: { Notification: 15 },
  ViewColumn: { Active: -1 },
  TextEditorRevealType: { InCenter: 1 },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  Uri: {
    file: uriOf,
    parse: (value) => uriOf(String(value).replace(/^file:\/\//i, '')),
    joinPath: (base, ...parts) => uriOf([base.fsPath, ...parts].join('\\'))
  },
  RelativePattern: class RelativePattern {
    constructor(base, pattern) {
      this.base = base;
      this.pattern = pattern;
    }
  },
  workspace: {
    workspaceFolders: [{ uri: uriOf('D:\\demo'), name: 'demo' }],
    getConfiguration: () => ({
      get: (key, fallback) => (key in config ? config[key] : fallback)
    }),
    createFileSystemWatcher: () => {
      const watcher = {
        onDidChange: () => ({ dispose: () => {} }),
        onDidCreate: () => ({ dispose: () => {} }),
        onDidDelete: () => ({ dispose: () => {} }),
        dispose: () => {}
      };
      watchers.push(watcher);
      return watcher;
    },
    onDidChangeConfiguration: () => ({ dispose: () => {} }),
    onDidChangeWorkspaceFolders: () => ({ dispose: () => {} }),
    openTextDocument: async () => ({}),
    fs: { writeFile: async () => {} }
  },
  window: {
    createTreeView: (id, options) => {
      treeView = {
        id,
        description: undefined,
        badge: undefined,
        message: undefined,
        treeDataProvider: options.treeDataProvider,
        dispose: () => {}
      };
      return treeView;
    },
    createWebviewPanel: () => createFakePanel(),
    showQuickPick: async () => undefined,
    showInputBox: async () => undefined,
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showErrorMessage: () => {},
    setStatusBarMessage: () => {},
    withProgress: async (options, task) => task({ report: () => {} }, { isCancellationRequested: false }),
    showTextDocument: async () => ({ selection: null, revealRange: () => {} })
  },
  commands: {
    registerCommand: (id, handler) => {
      commands.set(id, handler);
      return { dispose: () => {} };
    },
    executeCommand: async () => undefined
  },
  env: {
    clipboard: { writeText: async (text) => clipboard.push(text) },
    openExternal: async (uri) => externalLinks.push(uri.fsPath || uri)
  }
};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'vscode') {
    return vscodeMock;
  }
  return originalLoad.call(this, request, parent, isMain);
};

async function main() {
  const extension = require('../extension');
  const context = {
    subscriptions: [],
    extensionUri: uriOf('D:\\fake-extension')
  };

  extension.activate(context);
  assert.ok(treeView, 'tree view created');
  assert.ok(commands.has('codexHistory.openSession'), 'commands registered');
  assert.ok(watchers.length >= 2, 'session watchers created');
  assert.ok(Array.isArray(context.subscriptions) && context.subscriptions.length > 0, 'subscriptions tracked');

  const groups = treeView.treeDataProvider.getChildren();
  assert.ok(Array.isArray(groups), 'tree root children');
  const sessions = groups.flatMap((group) => (group.group ? group.group.sessions : []));
  assert.ok(sessions.length > 0, 'real sessions discovered');
  const first = sessions[0];
  assert.ok(first.title, 'session title');
  assert.ok(first.path.endsWith('.jsonl'), 'session file path');

  await commands.get('codexHistory.openSession')(first);
  assert.strictEqual(panels.length, 1, 'panel created');
  const panel = panels[0];
  assert.ok(panel.webview.html.includes('btn-refresh'), 'panel html rendered');
  assert.ok(panel.webview.html.includes('Content-Security-Policy'), 'csp present');
  assert.ok(panel.title.includes('Codex'), 'panel title set');

  panelMessageHandler({ type: 'ready' });
  const sessionMessage = panel.webview.messages.find((message) => message.type === 'session' && message.session);
  assert.ok(sessionMessage, 'session payload posted after ready');
  assert.ok(sessionMessage.session.items.length > 0, 'session has renderable items');
  assert.ok(sessionMessage.session.meta.id, 'session meta id');

  panelMessageHandler({ type: 'copy', text: 'hello' });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepStrictEqual(clipboard, ['hello'], 'copy forwarded to clipboard');

  panelMessageHandler({ type: 'openLink', href: 'javascript:alert(1)' });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.strictEqual(externalLinks.length, 0, 'javascript link blocked');

  panelMessageHandler({ type: 'refresh' });
  const refreshCount = panel.webview.messages.filter((message) => message.type === 'session').length;
  assert.ok(refreshCount >= 2, 'refresh reposts session');

  await commands.get('codexHistory.refresh')();
  assert.ok(treeView.badge === undefined, 'badge cleared without filter');

  extension.deactivate();
  console.log(`extension: ok (${sessions.length} sessions, ${panel.webview.messages.length} panel messages)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
