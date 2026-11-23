'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHash, randomUUID } = require('crypto');
const { spawn } = require('child_process');

function parseAuth(raw) {
  let auth;
  try { auth = JSON.parse(raw); } catch { throw new Error('登录缓存格式无效，请重新登录。'); }
  const tokens = auth && auth.tokens;
  if (!tokens || !['access_token', 'refresh_token', 'id_token'].every((key) => typeof tokens[key] === 'string' && tokens[key]) || auth.OPENAI_API_KEY ||
      (auth.auth_mode && auth.auth_mode !== 'chatgpt')) {
    throw new Error('只支持通过 ChatGPT 网页登录的账号缓存。');
  }
  let claims;
  try { claims = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString('utf8')); }
  catch { throw new Error('无法识别账号信息，请重新登录。'); }
  // Claims identify a local snapshot only; they are not used to authorize requests.
  const accountId = tokens.account_id || (claims['https://api.openai.com/auth'] || {}).chatgpt_account_id;
  if (typeof accountId !== 'string' || !accountId || typeof claims.sub !== 'string' || !claims.sub) {
    throw new Error('登录缓存缺少账号标识，请重新登录。');
  }
  return { identity: `${claims.sub}:${accountId}`, email: String(claims.email || '') };
}

function ensureFileStorage(home) {
  let config = '';
  try { config = fs.readFileSync(path.join(home, 'config.toml'), 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') { throw error; } }
  // Fail closed for explicit non-file stores, including profile overrides.
  for (const line of config.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) { continue; }
    if (/cli_auth_credentials_store\s*["']?\s*=/.test(line) &&
        !/=\s*["']file["']\s*(?:#.*)?$/.test(line)) {
      throw new Error('账号切换仅支持文件缓存。请将 Codex 的 cli_auth_credentials_store 设置为 "file"，重新登录后再使用。');
    }
  }
}

class AccountStore {
  constructor(secrets, home) {
    this.secrets = secrets;
    this.home = path.resolve(home);
    const canonical = process.platform === 'win32' ? this.home.toLowerCase() : this.home;
    this.key = `codexHistory.accounts.v1.${createHash('sha256').update(canonical).digest('hex')}`;
    this.authPath = path.join(this.home, 'auth.json');
  }

  async vault() {
    const raw = await this.secrets.get(this.key);
    if (!raw) { return { accounts: [] }; }
    try {
      const vault = JSON.parse(raw);
      if (!Array.isArray(vault.accounts)) { throw new Error(); }
      return vault;
    } catch { throw new Error('账号加密存储无法读取，未修改当前登录。'); }
  }

  currentRaw() {
    ensureFileStorage(this.home);
    try { return fs.readFileSync(this.authPath, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') { return null; } throw error; }
  }

  async list() {
    const vault = await this.vault();
    let current;
    try { const raw = this.currentRaw(); current = raw ? parseAuth(raw) : null; } catch { current = null; }
    return vault.accounts.map(({ id, label, identity, email }) => ({
      id, label, email, current: Boolean(current && current.identity === identity)
    }));
  }

  put(vault, raw, label) {
    const info = parseAuth(raw);
    let account = vault.accounts.find((entry) => entry.identity === info.identity);
    if (!account) {
      account = { id: randomUUID(), label: label || info.email || `账号 ${vault.accounts.length + 1}` };
      vault.accounts.push(account);
    } else if (label) { account.label = label; }
    Object.assign(account, info, { raw });
    return account;
  }

  async locked(task) {
    fs.mkdirSync(this.home, { recursive: true, mode: 0o700 });
    const lock = path.join(this.home, '.codex-history-account-lock');
    try { fs.mkdirSync(lock, { mode: 0o700 }); }
    catch (error) {
      if (error.code === 'EEXIST') { throw new Error('另一个窗口正在管理账号，请稍后重试。若窗口曾异常退出，请在关闭所有 Codex 窗口后删除数据目录中的 .codex-history-account-lock 空目录。'); }
      throw error;
    }
    try { return await task(); } finally { fs.rmdirSync(lock); }
  }

  async save(raw, label) {
    return this.locked(async () => {
      const vault = await this.vault();
      const account = this.put(vault, raw, label);
      await this.secrets.store(this.key, JSON.stringify(vault));
      return account.id;
    });
  }

  async switchTo(id) {
    return this.locked(async () => {
      const vault = await this.vault();
      const target = vault.accounts.find((account) => account.id === id);
      if (!target) { throw new Error('账号已被移除，请重新选择。'); }
      parseAuth(target.raw);
      const before = this.currentRaw();
      // Capture refreshed tokens, even when switching to the currently selected account.
      if (before) { this.put(vault, before); }
      await this.secrets.store(this.key, JSON.stringify(vault));
      if (this.currentRaw() !== before) { throw new Error('Codex 刚刚更新了登录缓存，请停止运行中的任务后重试。'); }
      const temp = path.join(this.home, `.auth-${randomUUID()}.tmp`);
      try {
        fs.writeFileSync(temp, target.raw, { mode: 0o600, flag: 'wx' });
        fs.renameSync(temp, this.authPath);
      } finally { if (fs.existsSync(temp)) { fs.unlinkSync(temp); } }
      return target.label;
    });
  }

  async remove(id) {
    return this.locked(async () => {
      const vault = await this.vault();
      vault.accounts = vault.accounts.filter((account) => account.id !== id);
      await this.secrets.store(this.key, JSON.stringify(vault));
    });
  }
}

// Use a separate CODEX_HOME so adding an account never logs out the active one.
async function loginAccount(executable, cancellation, options = {}) {
  const home = fs.mkdtempSync(path.join(options.tempRoot || os.tmpdir(), 'codex-history-login-'));
  fs.chmodSync(home, 0o700);
  try {
    await new Promise((resolve, reject) => {
      const child = (options.spawn || spawn)(executable, ['-c', 'cli_auth_credentials_store="file"', 'login'], {
        env: { ...process.env, CODEX_HOME: home }, cwd: home, windowsHide: true, stdio: 'ignore'
      });
      let cancelled = false;
      const stop = () => { cancelled = true; child.kill(); };
      const timer = setTimeout(stop, options.timeoutMs || 5 * 60 * 1000);
      const subscription = cancellation.onCancellationRequested(stop);
      if (cancellation.isCancellationRequested) { stop(); }
      const cleanup = () => { clearTimeout(timer); subscription.dispose(); };
      child.once('error', () => { cleanup(); reject(new Error('无法启动 Codex 登录，请检查 codexHistory.codexPath。')); });
      child.once('close', (code) => {
        cleanup();
        if (cancelled) { reject(new Error('登录已取消或超时。')); }
        else if (code !== 0) { reject(new Error('官方网页登录未完成，请重试；若浏览器未打开，请先确认本机 Codex CLI 可以正常登录。')); }
        else { resolve(); }
      });
    });
    let raw;
    try { raw = fs.readFileSync(path.join(home, 'auth.json'), 'utf8'); }
    catch { throw new Error('登录没有生成文件缓存，请检查组织的认证策略。'); }
    parseAuth(raw);
    return raw;
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

module.exports = { AccountStore, parseAuth, ensureFileStorage, loginAccount };
