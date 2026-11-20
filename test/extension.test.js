'use strict';

const assert = require('assert');
const Module = require('module');

const commands = new Map();
const watchers = [];
const panels = [];
const clipboard = [];
const externalLinks = [];
const terminalCommands = [];
const terminals = [];
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
  extensions: {
    getExtension: (id) => (id === 'openai.chatgpt' ? { id, isActive: true } : undefined)
  },
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
    parse: (value) => {
      const text = String(value);
      if (/^file:\/\//i.test(text)) {
        return uriOf(text.replace(/^file:\/\//i, ''));
      }
      return { fsPath: text, scheme: text.split(':')[0], toString: () => text };
    },
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
    createTerminal: (options) => {
      const terminal = {
        options,
        show() {},
        sendText(text) {
          terminalCommands.push(text);
        }
      };
      terminals.push(terminal);
      return terminal;
    },
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
    openExternal: async (uri) => {
      externalLinks.push(uri.fsPath || uri);
      return true;
    }
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

  const codexHome = require('os').homedir();
  const localSession = {
    id: '01a1f7d3-60ae-7861-8172-fec0b736d1ed',
    title: '本地会话',
    path: require('path').join(
      codexHome,
      '.codex',
      'sessions',
      '2026',
      '11',
      '20',
      'rollout-2026-11-20T15-19-47-01a1f7d3-60ae-7861-8172-fec0b736d1ed.jsonl'
    ),
    cwd: '',
    archived: false
  };
  await commands.get('codexHistory.openInCodex')(localSession);
  assert.ok(
    externalLinks.some((link) => String(link) === 'vscode://openai.chatgpt/local/01a1f7d3-60ae-7861-8172-fec0b736d1ed'),
    'deep link opened for default Codex home'
  );

  config.codexPath = process.execPath;
  await commands.get('codexHistory.openInCodex')({
    id: '01a1f452-6bc3-7532-aebe-514e5e5b004f',
    title: '外部目录会话',
    path: require('path').join('D:\\other-home', 'sessions', 'rollout-2026-11-20T10-00-00-x.jsonl'),
    cwd: '',
    archived: false
  });
  assert.strictEqual(terminals.length, 1, 'terminal fallback created');
  assert.ok(terminalCommands[0].includes('resume'), 'terminal resumes session');
  assert.ok(terminalCommands[0].includes('01a1f452-6bc3-7532-aebe-514e5e5b004f'), 'terminal uses session id');

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
