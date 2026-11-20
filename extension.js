'use strict';

const fs = require('fs');
const vscode = require('vscode');
const { CodexStore } = require('./src/store');
const { CodexTreeProvider, formatWhen } = require('./src/tree');
const { ChatPanel } = require('./src/panel');
const { exportSession, openSessionFile } = require('./src/exporter');
const {
  buildCodexDeepLink,
  buildResumeCommand,
  codexExtensionHome,
  findCodexExecutable,
  isSessionInExtensionHome,
  unarchiveSession
} = require('./src/codexCli');

const TYPE_LABELS = {
  user: '你',
  assistant: 'Codex',
  reasoning: '思考',
  tool: '工具',
  notice: '提示'
};

function activate(context) {
  const store = new CodexStore(context);
  const state = { query: '', workspaceOnly: false };
  const provider = new CodexTreeProvider(store, state);
  const view = vscode.window.createTreeView('codexHistory.sessions', {
    treeDataProvider: provider,
    showCollapseAll: true
  });
  context.subscriptions.push(view);

  let watchers = [];
  let refreshTimer = null;

  function updateView() {
    const sessions = store.listSessions({ query: state.query, workspaceOnly: state.workspaceOnly });
    provider.lastCount = sessions.length;
    view.description = state.query ? `过滤：${state.query}` : state.workspaceOnly ? '当前工作区' : undefined;
    view.badge = state.query || state.workspaceOnly
      ? { value: sessions.length, tooltip: '符合条件的会话数' }
      : undefined;
    if (!sessions.length) {
      if (!fs.existsSync(store.sessionsDir)) {
        view.message = `未找到 ${store.sessionsDir}。请在设置中检查 codexHistory.codexHome。`;
      } else if (state.query || state.workspaceOnly) {
        view.message = '没有匹配的会话，试试清除筛选。';
      } else {
        view.message = undefined;
      }
    } else {
      view.message = undefined;
    }
    vscode.commands.executeCommand('setContext', 'codexHistory.filterActive', Boolean(state.query));
  }

  function refreshAll(resetCache) {
    if (resetCache) {
      store.invalidate();
    }
    provider.refresh();
    updateView();
  }

  function scheduleRefresh() {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      refreshAll(false);
    }, 220);
  }

  function disposeWatchers() {
    for (const watcher of watchers) {
      watcher.dispose();
    }
    watchers = [];
  }

  function addWatcher(uri, pattern, handler) {
    try {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(uri, pattern));
      watcher.onDidChange(handler);
      watcher.onDidCreate(handler);
      watcher.onDidDelete(handler);
      watchers.push(watcher);
    } catch (error) {
      // The directory may not exist yet; a refresh will retry.
    }
  }

  function watchRoots() {
    disposeWatchers();
    const onSessionFile = (uri) => {
      store.invalidate(uri.fsPath);
      ChatPanel.onFileChanged(uri.fsPath);
      scheduleRefresh();
    };
    addWatcher(vscode.Uri.file(store.sessionsDir), '**/*.jsonl', onSessionFile);
    addWatcher(vscode.Uri.file(store.archivedDir), '**/*.jsonl', onSessionFile);
    addWatcher(vscode.Uri.file(store.codexHome), 'session_index.jsonl', () => {
      store.indexMtime = 0;
      store.sessionsCache = null;
      scheduleRefresh();
    });
  }

  function register(command, handler) {
    context.subscriptions.push(vscode.commands.registerCommand(command, handler));
  }

  async function pickSession(options) {
    const opts = options || {};
    const sessions = store.listSessions({ max: opts.max || 120 });
    if (!sessions.length) {
      const action = await vscode.window.showWarningMessage('没有找到 Codex 会话记录。', '打开设置');
      if (action === '打开设置') {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'codexHistory.codexHome');
      }
      return null;
    }
    const picked = await vscode.window.showQuickPick(
      sessions.map((session) => ({
        label: session.title,
        description: formatWhen(session.updatedAt),
        detail: session.cwd || session.path,
        session
      })),
      { title: '打开 Codex 聊天记录', matchOnDescription: true, matchOnDetail: true, placeHolder: '选择要查看的会话' }
    );
    return picked ? picked.session : null;
  }

  async function resolveSession(arg) {
    if (arg && arg.path) {
      return arg;
    }
    return pickSession();
  }

  function clipText(value, max) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  function configuredCodexPath() {
    return String(vscode.workspace.getConfiguration('codexHistory').get('codexPath', '') || '').trim();
  }

  function hasCodexExtension() {
    return Boolean(
      vscode.extensions &&
        typeof vscode.extensions.getExtension === 'function' &&
        vscode.extensions.getExtension('openai.chatgpt')
    );
  }

  async function showCodexCliMissing() {
    const configured = configuredCodexPath();
    const message = configured
      ? `找不到 codex 可执行文件：${configured}。请检查设置 codexHistory.codexPath。`
      : '找不到 codex 可执行文件。请安装 Codex 扩展，或设置 codexHistory.codexPath。';
    const action = await vscode.window.showErrorMessage(message, '打开设置');
    if (action === '打开设置') {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'codexHistory.codexPath');
    }
  }

  async function restoreInCodex(sessionInfo) {
    const session = await resolveSession(sessionInfo);
    if (!session) {
      return;
    }
    const canDeepLink = hasCodexExtension() && isSessionInExtensionHome(session.path);
    let executable = null;

    if (session.archived || !canDeepLink) {
      executable = findCodexExecutable({ configured: configuredCodexPath() });
      if (!executable) {
        await showCodexCliMissing();
        return;
      }
    }

    if (session.archived) {
      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `正在还原「${clipText(session.title, 40)}」`
          },
          () => unarchiveSession(executable.path, session)
        );
      } catch (error) {
        const action = await vscode.window.showErrorMessage(
          `取消归档失败：${error.message}`,
          '复制命令'
        );
        if (action === '复制命令') {
          await vscode.env.clipboard.writeText(`codex unarchive ${session.id}`);
        }
        return;
      }
      store.invalidate();
      refreshAll(false);
    }

    if (canDeepLink) {
      try {
        const opened = await vscode.env.openExternal(vscode.Uri.parse(buildCodexDeepLink(session.id)));
        if (opened) {
          vscode.window.showInformationMessage(
            session.archived
              ? `已还原并在 Codex 中打开：${clipText(session.title, 60)}`
              : `已在 Codex 中打开：${clipText(session.title, 60)}`
          );
          return;
        }
      } catch (error) {
        // Fall through to the terminal resume path.
      }
    }

    if (!executable) {
      executable = findCodexExecutable({ configured: configuredCodexPath() });
      if (!executable) {
        await showCodexCliMissing();
        return;
      }
    }

    const cwd = session.cwd && fs.existsSync(session.cwd) ? session.cwd : undefined;
    const terminal = vscode.window.createTerminal({
      name: `Codex · ${clipText(session.title, 28)}`,
      cwd
    });
    terminal.show();
    terminal.sendText(buildResumeCommand(executable.path, session.id), true);
    vscode.window.showInformationMessage(
      session.archived
        ? `已取消归档，并在终端中用 codex resume 恢复：${clipText(session.title, 60)}`
        : `该会话不在 Codex 扩展的数据目录（${codexExtensionHome()}）中，已在终端中恢复。`
    );
  }

  register('codexHistory.open', async () => {
    const session = await pickSession();
    if (session) {
      ChatPanel.createOrShow(context, store, session);
    }
  });

  register('codexHistory.openSession', async (session) => {
    if (!session || !session.path) {
      const picked = await pickSession();
      if (!picked) {
        return;
      }
      session = picked;
    }
    ChatPanel.createOrShow(context, store, session);
  });

  register('codexHistory.openInCodex', (session) => restoreInCodex(session));

  register('codexHistory.restoreSession', (session) => restoreInCodex(session));

  register('codexHistory.refresh', () => {
    watchRoots();
    refreshAll(true);
  });

  register('codexHistory.filter', async () => {
    const value = await vscode.window.showInputBox({
      title: '筛选 Codex 会话',
      prompt: '按标题、工作目录或会话 ID 筛选；留空显示全部',
      value: state.query
    });
    if (value === undefined) {
      return;
    }
    state.query = value.trim();
    refreshAll(false);
  });

  register('codexHistory.clearFilter', () => {
    state.query = '';
    refreshAll(false);
  });

  register('codexHistory.toggleWorkspaceScope', () => {
    if (!(vscode.workspace.workspaceFolders || []).length) {
      vscode.window.showInformationMessage('当前没有打开的工作区，无法按工作区筛选。');
      return;
    }
    state.workspaceOnly = !state.workspaceOnly;
    refreshAll(false);
  });

  register('codexHistory.revealCodexHome', async () => {
    if (!fs.existsSync(store.codexHome)) {
      vscode.window.showWarningMessage(`Codex 数据目录不存在：${store.codexHome}`);
      return;
    }
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(store.codexHome));
  });

  register('codexHistory.revealSession', async (sessionInfo) => {
    const session = await resolveSession(sessionInfo);
    if (!session) {
      return;
    }
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(session.path));
  });

  register('codexHistory.openRaw', async (sessionInfo) => {
    const session = await resolveSession(sessionInfo);
    if (!session) {
      return;
    }
    await openSessionFile(session);
  });

  register('codexHistory.export', async (sessionInfo) => {
    const session = await resolveSession(sessionInfo);
    if (!session) {
      return;
    }
    await exportSession(store, session);
  });

  register('codexHistory.searchContent', async () => {
    const query = await vscode.window.showInputBox({
      title: '在全部 Codex 会话中搜索',
      prompt: '输入要在消息、工具输入和输出中查找的文字',
      placeHolder: '例如：NullReferenceException'
    });
    if (!query || !query.trim()) {
      return;
    }
    const hits = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `搜索 Codex 会话：${query}`, cancellable: true },
      async (progress, token) => {
        return store.searchContent(query, {
          token,
          limit: 300,
          onProgress: (index, total, session) => {
            progress.report({
              message: `${index + 1}/${total} ${session.title}`,
              increment: total ? 100 / total : 1
            });
          }
        });
      }
    );
    if (!hits.length) {
      vscode.window.showInformationMessage(`没有在会话中找到“${query}”。`);
      return;
    }
    const picked = await vscode.window.showQuickPick(
      hits.map((hit) => ({
        label: `$(comment-discussion) ${hit.session.title}`,
        description: `${TYPE_LABELS[hit.type] || hit.type} · ${formatWhen(hit.session.updatedAt)}`,
        detail: hit.snippet,
        hit
      })),
      {
        title: `找到 ${hits.length} 处匹配`,
        matchOnDescription: true,
        matchOnDetail: true,
        placeHolder: '选择一条结果跳转到具体消息'
      }
    );
    if (picked) {
      ChatPanel.createOrShow(context, store, picked.hit.session, { focusIndex: picked.hit.index });
    }
  });

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('codexHistory.codexHome')) {
        store.reset();
        watchRoots();
        refreshAll(false);
      } else if (event.affectsConfiguration('codexHistory')) {
        store.sessionsCache = null;
        refreshAll(false);
      }
    })
  );

  context.subscriptions.push({
    dispose: () => {
      disposeWatchers();
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }
    }
  });

  watchRoots();
  refreshAll(true);
  return { store };
}

function deactivate() {
  ChatPanel.current = null;
}

module.exports = { activate, deactivate };
