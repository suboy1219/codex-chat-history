'use strict';

const vscode = require('vscode');
const { version } = require('../package.json');
const { PROJECT_URL, WEBSITE_URL, checkForUpdates } = require('./updates');

function registerHelp(register) {
  let checking = false;

  async function open(url) {
    try {
      if (await vscode.env.openExternal(vscode.Uri.parse(url))) return;
    } catch (error) {
      // Show a usable URL if the system browser cannot be opened.
    }
    await vscode.window.showWarningMessage(`无法打开浏览器，请手动访问：${url}`);
  }

  register('codexHistory.openHelp', () => open(`${PROJECT_URL}#readme`));
  register('codexHistory.openWebsite', () => open(WEBSITE_URL));
  register('codexHistory.about', async () => {
    const action = await vscode.window.showInformationMessage(
      `Codex History Lens ${version}\n本地 Codex 历史会话浏览器。社区扩展，与 OpenAI 无隶属关系。`,
      { modal: true, detail: PROJECT_URL },
      '访问官网', '使用说明'
    );
    if (action === '访问官网') await open(WEBSITE_URL);
    if (action === '使用说明') await open(`${PROJECT_URL}#readme`);
  });
  register('codexHistory.checkForUpdates', async () => {
    if (checking) return;
    checking = true;
    try {
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: '正在检测 Codex History Lens 更新…' },
        () => checkForUpdates(version)
      );
      if (!result) {
        await vscode.window.showInformationMessage('暂时没有可用的 GitHub 正式发布版。');
      } else if (result.isUpdateAvailable) {
        const action = await vscode.window.showInformationMessage(
          `发现新版本 ${result.tag}（当前 ${version}）。`, '打开发布页'
        );
        if (action === '打开发布页') await open(result.releaseUrl);
      } else {
        await vscode.window.showInformationMessage(`当前已是最新版本（${version}）。`);
      }
    } catch (error) {
      await vscode.window.showWarningMessage('无法检测更新，请检查网络连接后重试。GitHub 暂时不可用或请求次数受限时也可能出现此提示。');
    } finally {
      checking = false;
    }
  });
}

module.exports = { registerHelp };
