'use strict';

const os = require('os');
const path = require('path');
const vscode = require('vscode');
const { AccountStore, parseAuth, loginAccount } = require('./accounts');
const { findCodexExecutable } = require('./codexCli');

function registerAccounts(context) {
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  status.command = 'codexHistory.switchAccount';
  status.name = 'Codex 账号';
  context.subscriptions.push(status);
  let busy = false;
  const getStore = () => {
    const configured = vscode.workspace.getConfiguration('codexHistory').get('accountHome', '');
    return new AccountStore(context.secrets, String(configured || process.env.CODEX_HOME || path.join(os.homedir(), '.codex'))
      .replace(/^~(?=$|[\\/])/, os.homedir()));
  };
  async function refresh() {
    try {
      const store = getStore();
      const accounts = await store.list();
      const selected = accounts.find((account) => account.current);
      let label = selected && selected.label;
      if (!label) {
        const raw = store.currentRaw();
        label = raw ? parseAuth(raw).email || '未保存账号' : '未登录';
      }
      status.text = `$(account) Codex: ${String(label).replace(/[\r\n$()]/g, '').slice(0, 40)}`;
      status.tooltip = `点击切换或添加 ChatGPT 账号\n登录缓存：${store.home}\n切换后请重载窗口，其他 Codex 窗口也需重启。`;
    } catch {
      status.text = '$(account) Codex: 账号管理';
      status.tooltip = '点击管理账号；仅支持 ChatGPT 文件登录缓存。';
    }
    status.show();
  }
  function register(name, handler) {
    context.subscriptions.push(vscode.commands.registerCommand(`codexHistory.${name}`, async () => {
      if (busy) { return vscode.window.showInformationMessage('账号操作正在进行，请稍候。'); }
      busy = true;
      try { await handler(getStore()); }
      catch (error) {
        // Never forward arbitrary JSON/CLI output or filesystem paths containing credentials.
        await vscode.window.showErrorMessage(error.code ? `账号操作失败（${error.code}），未能完成切换。` : error.message);
      } finally { busy = false; await refresh(); }
    }));
  }
  async function labelFor(defaultValue) {
    const value = await vscode.window.showInputBox({
      title: '账号名称', prompt: '用于区分账号，例如：个人账号、工作账号', value: defaultValue,
      validateInput: (input) => input.trim() && input.trim().length <= 60 ? null : '请输入 1–60 个字符'
    });
    return value && value.trim();
  }
  async function saveCurrent(store) {
    const raw = store.currentRaw();
    if (!raw) { throw new Error('未找到 auth.json，请先使用 Codex 官方网页登录，或选择“添加账号”。'); }
    const info = parseAuth(raw);
    const label = await labelFor(info.email || '我的账号');
    if (!label) { return; }
    await store.save(raw, label);
    await vscode.window.showInformationMessage(`已加密保存账号“${label}”。`);
  }
  async function add(store) {
    const label = await labelFor('另一个账号');
    if (!label) { return; }
    const executable = findCodexExecutable({ configured: vscode.workspace.getConfiguration('codexHistory').get('codexPath', '') });
    if (!executable) { throw new Error('找不到 Codex CLI，请安装官方 Codex 扩展或设置 codexHistory.codexPath。'); }
    const raw = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification, title: '请在浏览器中登录要添加的 ChatGPT 账号（可取消，5 分钟超时）', cancellable: true
    }, (_, token) => loginAccount(executable.path, token));
    await store.save(raw, label);
    await vscode.window.showInformationMessage(`已加密保存“${label}”，点击状态栏即可切换。`);
  }
  async function switchAccount(store) {
    const accounts = await store.list();
    const picked = await vscode.window.showQuickPick([
      ...accounts.map((account) => ({ label: account.label, description: account.current ? '当前缓存账号' : account.email, account })),
      { label: '$(save) 保存当前登录账号', action: 'save' },
      { label: '$(add) 添加账号（官方网页登录）', action: 'add' },
      { label: '$(trash) 移除已保存的账号', action: 'remove' }
    ], { title: '切换 Codex 账号', placeHolder: '切换会影响共享此数据目录的 Codex CLI 和 IDE，生效需重载窗口' });
    if (!picked) { return; }
    if (picked.action === 'save') { return saveCurrent(store); }
    if (picked.action === 'add') { return add(store); }
    if (picked.action === 'remove') { return remove(store); }
    const answer = await vscode.window.showWarningMessage(
      `切换到“${picked.account.label}”？请先结束正在运行的 Codex 任务。当前登录会自动加密备份，切换后需重载窗口。`,
      { modal: true }, '切换账号');
    if (answer !== '切换账号') { return; }
    const label = await store.switchTo(picked.account.id);
    await refresh();
    const reload = await vscode.window.showInformationMessage(`已写入“${label}”的登录缓存；重载窗口后让 Codex 使用此账号。`, '重载窗口');
    if (reload === '重载窗口') { await vscode.commands.executeCommand('workbench.action.reloadWindow'); }
  }
  async function remove(store) {
    const picked = await vscode.window.showQuickPick((await store.list()).map((account) => ({ label: account.label, account })), { title: '移除已保存账号' });
    if (!picked) { return; }
    const answer = await vscode.window.showWarningMessage(`移除“${picked.label}”的加密备份？当前 Codex 登录保持不变。`, { modal: true }, '移除');
    if (answer === '移除') { await store.remove(picked.account.id); }
  }
  register('switchAccount', switchAccount);
  register('saveAccount', saveCurrent);
  register('addAccount', add);
  register('removeAccount', remove);
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('codexHistory.accountHome')) { void refresh(); }
  }));
  context.subscriptions.push(context.secrets.onDidChange(() => { void refresh(); }));
  const timer = setInterval(() => { void refresh(); }, 30000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
  void refresh();
}

module.exports = { registerAccounts };
