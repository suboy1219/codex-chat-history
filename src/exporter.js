'use strict';

const os = require('os');
const path = require('path');
const vscode = require('vscode');
const { sessionToMarkdown } = require('./markdownExport');

function safeFileName(value) {
  const cleaned = String(value || 'codex-session')
    .replace(/[\\/:*?"<>|\r\n]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || 'codex-session').slice(0, 60);
}

async function exportSession(store, sessionInfo) {
  let parsed;
  try {
    parsed = store.read(sessionInfo);
  } catch (error) {
    vscode.window.showErrorMessage(`导出的会话无法读取：${error.message}`);
    return null;
  }
  const markdown = sessionToMarkdown(parsed);
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  const defaultDir = folder ? folder.uri.fsPath : os.homedir();
  const target = await vscode.window.showSaveDialog({
    title: '导出 Codex 聊天记录',
    saveLabel: '导出 Markdown',
    defaultUri: vscode.Uri.file(path.join(defaultDir, `${safeFileName(parsed.meta.title)}.md`)),
    filters: { Markdown: ['md'], 所有文件: ['*'] }
  });
  if (!target) {
    return null;
  }
  try {
    await vscode.workspace.fs.writeFile(target, Buffer.from(markdown, 'utf8'));
  } catch (error) {
    vscode.window.showErrorMessage(`写入文件失败：${error.message}`);
    return null;
  }
  const size = Buffer.byteLength(markdown, 'utf8');
  const action = await vscode.window.showInformationMessage(
    `已导出会话（${(size / 1024).toFixed(1)} KB）`,
    '打开文件'
  );
  if (action === '打开文件') {
    const document = await vscode.workspace.openTextDocument(target);
    await vscode.window.showTextDocument(document, { preview: true });
  }
  return target;
}

async function openSessionFile(sessionInfo) {
  try {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(sessionInfo.path));
    await vscode.window.showTextDocument(document, { preview: true });
  } catch (error) {
    vscode.window.showErrorMessage(`无法打开原始记录：${error.message}`);
  }
}

function parseLocation(raw, baseDir) {
  let target = String(raw || '').trim();
  let line = 0;
  let column = 1;
  if (!target) {
    return null;
  }
  if (/^file:\/\//i.test(target)) {
    try {
      target = vscode.Uri.parse(target).fsPath;
    } catch (error) {
      return null;
    }
  }
  const hash = target.match(/#L(\d+)(?:C(\d+))?$/);
  if (hash) {
    line = Number(hash[1]);
    column = Number(hash[2] || 1);
    target = target.slice(0, hash.index);
  } else {
    const match = target.match(/^(.*?):(\d+)(?::(\d+))?$/);
    if (match && match[1]) {
      line = Number(match[2]);
      column = Number(match[3] || 1);
      target = match[1];
    }
  }
  if (!/^[a-zA-Z]:[\\/]/.test(target) && !target.startsWith('\\\\') && !target.startsWith('/') && baseDir) {
    target = path.resolve(baseDir, target);
  }
  return { target, line, column };
}

async function openLocalPath(raw, baseDir) {
  const location = parseLocation(raw, baseDir);
  if (!location) {
    return;
  }
  try {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(location.target));
    const editor = await vscode.window.showTextDocument(document, { preview: true });
    if (location.line > 0) {
      const position = new vscode.Position(Math.max(0, location.line - 1), Math.max(0, location.column - 1));
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    }
  } catch (error) {
    const action = await vscode.window.showWarningMessage(`打不开这个位置：${location.target}`, '复制路径');
    if (action === '复制路径') {
      await vscode.env.clipboard.writeText(location.target);
    }
  }
}

module.exports = { exportSession, openLocalPath, openSessionFile, parseLocation, safeFileName };
