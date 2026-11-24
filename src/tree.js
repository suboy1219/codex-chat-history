'use strict';

const path = require('path');
const vscode = require('vscode');
const { COLOR_ID } = require('./follows');

function startOfDay(date) {
  const copy = new Date(date.getTime());
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function formatSize(bytes) {
  if (!bytes) {
    return '';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatWhen(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const now = new Date();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
  const hhmm = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  if (diffDays === 0) {
    return `今天 ${hhmm}`;
  }
  if (diffDays === 1) {
    return `昨天 ${hhmm}`;
  }
  if (diffDays < 7) {
    return `${diffDays} 天前 ${hhmm}`;
  }
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日 ${hhmm}`;
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function groupFor(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return { key: 'unknown', label: '日期未知', sortValue: Number.NEGATIVE_INFINITY };
  }
  const now = new Date();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
  const key = `day:${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  let label;
  if (diffDays === 0) {
    label = '今天';
  } else if (diffDays === 1) {
    label = '昨天';
  } else if (date.getFullYear() === now.getFullYear()) {
    label = `${date.getMonth() + 1}月${date.getDate()}日`;
  } else {
    label = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  }
  return { key, label, sortValue: startOfDay(date).getTime() };
}

class CodexTreeProvider {
  constructor(store, state, followed) {
    this.store = store;
    this.state = state;
    this.followed = followed;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
    this.lastCount = 0;
  }

  refresh() {
    this.emitter.fire();
  }

  getTreeItem(element) {
    return element;
  }

  getChildren(element) {
    const groupByDate = vscode.workspace.getConfiguration('codexHistory').get('groupByDate', true);
    const sessions = this.store.listSessions({
      query: this.state.query,
      workspaceOnly: this.state.workspaceOnly
    });
    this.lastCount = sessions.length;

    if (!element) {
      if (!groupByDate) {
        return sessions.map((session) => this.createSessionItem(session));
      }
      const buckets = new Map();
      for (const session of sessions) {
        const group = groupFor(session.updatedAt);
        if (!buckets.has(group.key)) {
          buckets.set(group.key, { ...group, sessions: [] });
        }
        buckets.get(group.key).sessions.push(session);
      }
      const groups = Array.from(buckets.values()).sort((a, b) => b.sortValue - a.sortValue);
      return groups.map((bucket) => {
        const item = new vscode.TreeItem(`${bucket.label} (${bucket.sessions.length})`, vscode.TreeItemCollapsibleState.Expanded);
        item.iconPath = new vscode.ThemeIcon('calendar');
        item.contextValue = 'codexGroup';
        item.group = bucket;
        return item;
      });
    }

    if (element.group) {
      return element.group.sessions.map((session) => this.createSessionItem(session));
    }
    return [];
  }

  createSessionItem(session) {
    const followed = this.followed.has(session);
    const item = new vscode.TreeItem(session.title, vscode.TreeItemCollapsibleState.None);
    const parts = [formatWhen(session.updatedAt)];
    const size = formatSize(session.size);
    if (size) {
      parts.push(size);
    }
    item.description = parts.filter(Boolean).join(' · ');
    item.id = session.path;
    item.session = session;
    item.contextValue = `${session.archived ? 'codexSessionArchived' : 'codexSession'}${followed ? 'Followed' : ''}`;
    item.resourceUri = this.followed.uri(session);
    item.iconPath = followed
      ? new vscode.ThemeIcon('star-full', new vscode.ThemeColor(COLOR_ID))
      : new vscode.ThemeIcon(session.archived ? 'archive' : 'comment-discussion');
    item.command = {
      command: 'codexHistory.openSession',
      title: '打开聊天记录',
      arguments: [session]
    };

    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown('**');
    tooltip.appendText(session.title);
    tooltip.appendMarkdown('**\n\n');
    if (followed) {
      tooltip.appendMarkdown('★ 已关注\n\n');
    }
    if (session.cwd) {
      tooltip.appendMarkdown('工作目录：');
      tooltip.appendText(session.cwd);
      tooltip.appendMarkdown('\n\n');
    }
    tooltip.appendMarkdown('更新时间：');
    tooltip.appendText(formatWhen(session.updatedAt));
    tooltip.appendMarkdown('\n\n会话 ID：');
    tooltip.appendText(session.id);
    if (session.archived) {
      tooltip.appendMarkdown('\n\n已归档');
    }
    tooltip.appendMarkdown('\n\n文件：');
    tooltip.appendText(path.basename(session.path));
    item.tooltip = tooltip;
    return item;
  }
}

module.exports = { CodexTreeProvider, formatWhen, formatSize };
