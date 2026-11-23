'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { AccountStore } = require('../src/accounts');

async function main() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-account-ui-test-'));
  const commands = new Map();
  const values = new Map();
  const picks = [];
  const infos = [];
  const errors = [];
  const executed = [];
  let confirmation;
  let input;
  let lastPicker;
  const status = { show() {}, dispose() {} };
  const context = { subscriptions: [], secrets: {
    get: async (key) => values.get(key), store: async (key, value) => values.set(key, value),
    onDidChange: () => ({ dispose() {} })
  } };
  const mock = {
    StatusBarAlignment: { Right: 2 },
    workspace: {
      getConfiguration: () => ({ get: (key, fallback) => key === 'accountHome' ? home : fallback }),
      onDidChangeConfiguration: () => ({ dispose() {} })
    },
    window: {
      createStatusBarItem: () => status,
      showInputBox: async () => input,
      showQuickPick: async (items) => { lastPicker = items; const choose = picks.shift(); return choose ? choose(items) : undefined; },
      showWarningMessage: async () => confirmation,
      showInformationMessage: async (message) => { infos.push(message); return '重载窗口'; },
      showErrorMessage: async (message) => errors.push(message)
    },
    commands: {
      registerCommand: (name, handler) => { commands.set(name, handler); return { dispose() {} }; },
      executeCommand: async (name) => executed.push(name)
    }
  };
  const original = Module._load;
  Module._load = function(request, ...args) { return request === 'vscode' ? mock : original.call(this, request, ...args); };
  const claims = (user) => Buffer.from(JSON.stringify({ sub: user, email: `${user}@example.test` })).toString('base64url');
  const auth = (user) => JSON.stringify({ tokens: { access_token: 'fake', refresh_token: 'fake', id_token: `x.${claims(user)}.x`, account_id: user } });
  try {
    const { registerAccounts } = require('../src/accountCommands');
    registerAccounts(context);
    assert.strictEqual(commands.size, 4);
    assert.strictEqual(status.command, 'codexHistory.switchAccount');
    fs.writeFileSync(path.join(home, 'auth.json'), auth('a'));
    input = '个人';
    await commands.get('codexHistory.saveAccount')();
    assert.ok(status.text.includes('个人'));
    const store = new AccountStore(context.secrets, home);
    const b = await store.save(auth('b'), '工作');
    picks.push((items) => items.find((item) => item.account && item.account.id === b));
    confirmation = undefined;
    await commands.get('codexHistory.switchAccount')();
    assert.strictEqual(fs.readFileSync(store.authPath, 'utf8'), auth('a'), 'cancel leaves current login');
    picks.push((items) => items.find((item) => item.account && item.account.id === b));
    confirmation = '切换账号';
    await commands.get('codexHistory.switchAccount')();
    assert.strictEqual(fs.readFileSync(store.authPath, 'utf8'), auth('b'));
    assert.ok(executed.includes('workbench.action.reloadWindow'));
    assert.ok(status.text.includes('工作'));
    assert.ok(lastPicker.every((item) => !JSON.stringify(item).includes('access_token')));
    picks.push((items) => items.find((item) => item.account.id === b));
    confirmation = '移除';
    await commands.get('codexHistory.removeAccount')();
    assert.strictEqual((await store.list()).length, 1);
    assert.strictEqual(fs.readFileSync(store.authPath, 'utf8'), auth('b'));
    fs.writeFileSync(store.authPath, '{contains-private-text');
    await commands.get('codexHistory.saveAccount')();
    assert.strictEqual(errors.length, 1);
    assert.ok(!errors[0].includes('private-text'), 'errors do not echo credentials');
    console.log('account commands: ok (save, cancel, switch, reload, remove, status, errors)');
  } finally {
    Module._load = original;
    for (const subscription of context.subscriptions) { subscription.dispose(); }
    fs.rmSync(home, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
