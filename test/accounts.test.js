'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { AccountStore, parseAuth, ensureFileStorage, loginAccount } = require('../src/accounts');

function auth(user, refresh = 'refresh') {
  const claims = Buffer.from(JSON.stringify({ sub: user, email: `${user}@example.test` })).toString('base64url');
  return JSON.stringify({ auth_mode: 'chatgpt', tokens: {
    access_token: 'fake-access', refresh_token: refresh, id_token: `fake.${claims}.fake`, account_id: user
  } });
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-accounts-test-'));
  const values = new Map();
  let failStore = false;
  const secrets = {
    get: async (key) => values.get(key),
    store: async (key, value) => { if (failStore) { throw new Error('secret unavailable'); } values.set(key, value); }
  };
  try {
    const home = path.join(root, 'home');
    const store = new AccountStore(secrets, home);
    const a = await store.save(auth('a'), '个人');
    const b = await store.save(auth('b'), '工作');
    assert.strictEqual((await store.list()).length, 2);
    fs.writeFileSync(store.authPath, auth('a', 'new-refresh'));
    assert.strictEqual((await store.list()).find((entry) => entry.id === a).current, true);
    await store.switchTo(b);
    assert.strictEqual(fs.readFileSync(store.authPath, 'utf8'), auth('b'));
    await store.switchTo(a);
    assert.strictEqual(JSON.parse(fs.readFileSync(store.authPath)).tokens.refresh_token, 'new-refresh', 'refreshed tokens preserved');
    await store.switchTo(a);
    assert.strictEqual(JSON.parse(fs.readFileSync(store.authPath)).tokens.refresh_token, 'new-refresh');
    assert.strictEqual(await store.save(auth('a', 'login-again'), '新名称'), a, 'same account replaces snapshot');
    assert.strictEqual((await store.list()).length, 2);
    assert.ok(!(await store.list())[0].raw, 'picker metadata never contains tokens');

    fs.writeFileSync(store.authPath, auth('unknown'));
    await store.switchTo(b);
    assert.strictEqual((await store.list()).length, 3, 'unmanaged active account backed up automatically');
    failStore = true;
    await assert.rejects(store.switchTo(a), /secret unavailable/);
    assert.strictEqual(fs.readFileSync(store.authPath, 'utf8'), auth('b'), 'secret failure leaves login untouched');
    failStore = false;
    const rename = fs.renameSync;
    fs.renameSync = () => { const error = new Error('denied'); error.code = 'EACCES'; throw error; };
    try { await assert.rejects(store.switchTo(a), /denied/); }
    finally { fs.renameSync = rename; }
    assert.strictEqual(fs.readFileSync(store.authPath, 'utf8'), auth('b'), 'failed replacement preserves current login');
    assert.ok(!fs.readdirSync(home).some((file) => file.endsWith('.tmp')), 'failed write cleans credential temp file');
    const secretWrite = secrets.store;
    secrets.store = async (key, value) => {
      await secretWrite(key, value);
      fs.writeFileSync(store.authPath, auth('b', 'changed-during-switch'));
    };
    try { await assert.rejects(store.switchTo(a), /刚刚更新/); }
    finally { secrets.store = secretWrite; }
    assert.strictEqual(fs.readFileSync(store.authPath, 'utf8'), auth('b', 'changed-during-switch'), 'external token refresh is not overwritten');
    fs.writeFileSync(store.authPath, '{bad json');
    await assert.rejects(store.switchTo(a), /格式无效/);
    assert.strictEqual(fs.readFileSync(store.authPath, 'utf8'), '{bad json');
    fs.writeFileSync(store.authPath, auth('b'));
    await store.remove(b);
    assert.strictEqual(fs.readFileSync(store.authPath, 'utf8'), auth('b'), 'remove does not log out');
    await assert.rejects(store.switchTo(b), /已被移除/);
    fs.mkdirSync(path.join(home, '.codex-history-account-lock'));
    await assert.rejects(store.switchTo(a), /另一个窗口/);
    fs.rmdirSync(path.join(home, '.codex-history-account-lock'));
    for (const mode of ['keyring', 'auto', 'ephemeral']) {
      fs.writeFileSync(path.join(home, 'config.toml'), `cli_auth_credentials_store = "${mode}"`);
      await assert.rejects(store.switchTo(a), /仅支持文件缓存/);
    }
    fs.writeFileSync(path.join(home, 'config.toml'), 'cli_auth_credentials_store = "file" # comment');
    ensureFileStorage(home);
    assert.throws(() => parseAuth(JSON.stringify({ OPENAI_API_KEY: 'fake' })), /只支持/);
    assert.throws(() => parseAuth('{bad'), /格式无效/);
    assert.strictEqual((await new AccountStore(secrets, path.join(root, 'other')).list()).length, 0, 'homes isolated');

    // Simulate the official login process without using real credentials or opening a browser.
    const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
    let tempHome;
    const fakeSpawn = (executable, args, options) => {
      assert.deepStrictEqual(args, ['-c', 'cli_auth_credentials_store="file"', 'login']);
      tempHome = options.env.CODEX_HOME;
      assert.notStrictEqual(tempHome, home);
      const child = new EventEmitter();
      child.kill = () => { setImmediate(() => child.emit('close', null)); };
      fs.writeFileSync(path.join(tempHome, 'auth.json'), auth('browser'));
      setImmediate(() => child.emit('close', 0));
      return child;
    };
    assert.strictEqual(await loginAccount('fake', token, { spawn: fakeSpawn, tempRoot: root }), auth('browser'));
    assert.ok(!fs.existsSync(tempHome), 'temporary login credentials cleaned');
    const cancelled = { ...token, isCancellationRequested: true };
    await assert.rejects(loginAccount('fake', cancelled, { spawn: fakeSpawn, tempRoot: root }), /取消/);
    assert.ok(!fs.existsSync(tempHome), 'cancelled login cleaned');
    await assert.rejects(loginAccount('fake', token, { tempRoot: root, timeoutMs: 5, spawn: (_, __, options) => {
      tempHome = options.env.CODEX_HOME;
      const child = new EventEmitter();
      child.kill = () => { setImmediate(() => child.emit('close', null)); };
      return child;
    } }), /超时/);
    assert.ok(!fs.existsSync(tempHome), 'timed-out login cleaned');
    await assert.rejects(loginAccount('fake', token, { tempRoot: root, spawn: () => { throw new Error('spawn failure'); } }), /spawn failure/);
    assert.deepStrictEqual(fs.readdirSync(root).sort(), ['home'], 'failed login cleaned');
    console.log('accounts: ok (switch, refresh, backup, failures, isolation, cancellation)');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
