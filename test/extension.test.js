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
let quickPickCount = 0;
let panelMessageHandler = null;
let treeView = null;
let config = {};
let decorationProvider = null;

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

  dispose() {
    this.listeners = [];
  }
}

class TreeItem {
  constructor(label, collapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

class ThemeIcon {
  constructor(id, color) {
    this.id = id;
    this.color = color;
  }
}

class ThemeColor {
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
  ThemeColor,
  MarkdownString,
  Position,
  Range,
  Selection,
  ProgressLocation: { Notification: 15 },
  ViewColumn: { Active: -1 },
  TextEditorRevealType: { InCenter: 1 },
  StatusBarAlignment: { Right: 2 },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  Uri: {
    file: uriOf,
    from: (components) => ({ ...components, toString: () => `${components.scheme}:${components.path}` }),
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
    registerFileDecorationProvider: (provider) => {
      decorationProvider = provider;
      return { dispose() {} };
    },
    createStatusBarItem: () => ({ show() {}, dispose() {} }),
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
    showQuickPick: async () => {
      quickPickCount += 1;
      return undefined;
    },
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
  const savedState = new Map();
  const context = {
    subscriptions: [],
    globalState: {
      get: (key, fallback) => savedState.has(key) ? savedState.get(key) : fallback,
      update: async (key, value) => savedState.set(key, value)
    },
    secrets: { get: async () => undefined, onDidChange: () => ({ dispose() {} }) },
    extensionUri: uriOf('D:\\fake-extension')
  };

  extension.activate(context);
  assert.ok(treeView, 'tree view created');
  assert.ok(commands.has('codexHistory.openSession'), 'commands registered');
  assert.ok(watchers.length >= 2, 'session watchers created');
  assert.ok(Array.isArray(context.subscriptions) && context.subscriptions.length > 0, 'subscriptions tracked');

  const groups = treeView.treeDataProvider.getChildren();
  assert.ok(Array.isArray(groups), 'tree root children');
  assert.ok(
    !groups.some((group) => /最近 \d+ 天/.test(String(group.label))),
    'sessions are grouped by individual day'
  );
  assert.ok(
    groups.every((group) =>
      /^(今天|昨天|\d+月\d+日|\d+年\d+月\d+日|日期未知) \(\d+\)$/.test(String(group.label))
    ),
    'day labels use today, yesterday, or a concrete date'
  );
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

  const treeItem = treeView.treeDataProvider.createSessionItem(localSession);
  const provider = treeView.treeDataProvider;
  let treeChanges = 0;
  let decorationChanges = 0;
  provider.onDidChangeTreeData(() => { treeChanges += 1; });
  decorationProvider.onDidChangeFileDecorations(() => { decorationChanges += 1; });
  assert.strictEqual(decorationProvider.provideFileDecoration(treeItem.resourceUri), undefined);
  await commands.get('codexHistory.followSession')(treeItem);
  const followedItem = provider.createSessionItem(localSession);
  assert.strictEqual(followedItem.contextValue, 'codexSessionFollowed');
  assert.strictEqual(followedItem.iconPath.id, 'star-full');
  assert.strictEqual(followedItem.iconPath.color.id, 'codexHistory.followedForeground');
  assert.ok(followedItem.tooltip.value.includes('已关注'));
  assert.strictEqual(decorationProvider.provideFileDecoration(treeItem.resourceUri).color.id, 'codexHistory.followedForeground');
  assert.strictEqual(decorationProvider.provideFileDecoration(uriOf(localSession.path)), undefined, 'ordinary files are not colored');
  assert.ok(treeChanges > 0 && decorationChanges > 0, 'following updates the tree and its existing decorations');

  const { FollowedSessions } = require('../src/follows');
  const restoredFollows = new FollowedSessions(context.globalState);
  assert.ok(restoredFollows.has(localSession), 'followed sessions survive extension restart');
  const archivedSession = { ...localSession, archived: true, path: localSession.path.replace('sessions', 'archived_sessions') };
  assert.ok(restoredFollows.has(archivedSession), 'follow state follows the session ID when archived');
  assert.strictEqual(provider.createSessionItem(archivedSession).contextValue, 'codexSessionArchivedFollowed');
  const quickPicksBeforeFollow = quickPickCount;
  await commands.get('codexHistory.unfollowSession')(provider.createSessionItem(archivedSession));
  const unfollowedItem = provider.createSessionItem(localSession);
  assert.strictEqual(unfollowedItem.contextValue, 'codexSession');
  assert.strictEqual(unfollowedItem.iconPath.id, 'comment-discussion');
  assert.strictEqual(decorationProvider.provideFileDecoration(followedItem.resourceUri), undefined);
  assert.strictEqual(quickPickCount, quickPicksBeforeFollow, 'context menu acts on the clicked session');
  const afterUnfollow = new FollowedSessions(context.globalState);
  assert.ok(!afterUnfollow.has(localSession), 'unfollowing is persisted');

  const secondSession = { ...localSession, id: 'second-session' };
  await Promise.all([decorationProvider.set(localSession, true), decorationProvider.set(secondSession, true)]);
  const afterConcurrentFollow = new FollowedSessions(context.globalState);
  assert.ok(afterConcurrentFollow.has(localSession) && afterConcurrentFollow.has(secondSession), 'concurrent follows do not overwrite each other');
  const failingState = { get: () => [], update: async () => { throw new Error('storage unavailable'); } };
  const failedFollows = new FollowedSessions(failingState);
  await assert.rejects(failedFollows.set(localSession, true), /storage unavailable/);
  assert.ok(!failedFollows.has(localSession), 'failed storage write does not change the displayed state');
  for (const follows of [restoredFollows, afterUnfollow, afterConcurrentFollow, failedFollows]) {
    follows.dispose();
  }
  const quickPicksBefore = quickPickCount;
  await commands.get('codexHistory.openInCodex')(treeItem);
  assert.strictEqual(quickPickCount, quickPicksBefore, 'context menu item resolves session without picker');

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
  for (const subscription of context.subscriptions) { subscription.dispose(); }
  console.log(`extension: ok (${sessions.length} sessions, ${panel.webview.messages.length} panel messages)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
