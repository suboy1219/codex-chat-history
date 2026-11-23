'use strict';

const assert = require('assert');
const Module = require('module');
const pkg = require('../package.json');
const updates = require('../src/updates');
const commands = new Map();
const links = [];
const messages = [];
let choice;
let result = null;
let fail = false;
let checks = 0;
let unblock;
let blocked = false;
let browserWorks = true;
const vscode = {
  Uri: { parse: (url) => url },
  ProgressLocation: { Notification: 15 },
  env: { openExternal: async (url) => { links.push(url); return browserWorks; } },
  window: {
    showInformationMessage: async (message) => { messages.push(message); return choice; },
    showWarningMessage: async (message) => { messages.push(message); },
    withProgress: async (options, task) => task()
  }
};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return vscode;
  if (request === './updates') return {
    ...updates,
    checkForUpdates: async () => {
      checks += 1;
      if (blocked) await new Promise((resolve) => { unblock = resolve; });
      if (fail) throw new Error('offline');
      return result;
    }
  };
  return originalLoad.call(this, request, parent, isMain);
};
const { registerHelp } = require('../src/help');
Module._load = originalLoad;

async function main() {
  registerHelp((id, handler) => commands.set(id, handler));
  assert.strictEqual(checks, 0, 'no background requests');
  for (const entry of pkg.contributes.menus['codexHistory.help']) {
    assert.ok(commands.has(entry.command), 'menu command registered');
    assert.ok(pkg.contributes.commands.some((command) => command.command === entry.command));
  }
  await commands.get('codexHistory.openHelp')();
  await commands.get('codexHistory.openWebsite')();
  assert.deepStrictEqual(links, [updates.PROJECT_URL + '#readme', updates.WEBSITE_URL]);
  choice = '访问官网';
  await commands.get('codexHistory.about')();
  assert.ok(messages.at(-1).includes(pkg.version));
  assert.strictEqual(links.at(-1), updates.WEBSITE_URL);
  choice = undefined;
  const check = commands.get('codexHistory.checkForUpdates');
  await check();
  assert.ok(messages.at(-1).includes('没有可用'));
  result = { isUpdateAvailable: false };
  await check();
  assert.ok(messages.at(-1).includes('已是最新'));
  result = { isUpdateAvailable: true, tag: 'v1.3.0', releaseUrl: updates.PROJECT_URL + '/releases/tag/v1.3.0' };
  const linkCount = links.length;
  await check();
  assert.strictEqual(links.length, linkCount, 'dismissed update does not open browser');
  choice = '打开发布页';
  await check();
  assert.strictEqual(links.at(-1), result.releaseUrl);
  fail = true;
  await check();
  assert.ok(messages.at(-1).includes('无法检测更新'));
  fail = false;
  blocked = true;
  const pending = check();
  const before = checks;
  await check();
  assert.strictEqual(checks, before, 'duplicate checks ignored');
  unblock();
  await pending;
  blocked = false;
  await check();
  assert.strictEqual(checks, before + 1, 'checking state reset');
  browserWorks = false;
  await commands.get('codexHistory.openWebsite')();
  assert.ok(messages.at(-1).includes('无法打开浏览器'));
  console.log('help: ok');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
