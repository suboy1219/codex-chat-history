'use strict';

const path = require('path');
const vscode = require('vscode');

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

function groupFor(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return { key: 'earlier', label: '更早' };
  }
  const now = new Date();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
  if (diffDays <= 0) {
    return { key: 'today', label: '今天' };
  }
  if (diffDays === 1) {
    return { key: 'yesterday', label: '昨天' };
  }
  if (diffDays < 7) {
    return { key: 'week', label: '最近 7 天' };
  }
  if (diffDays < 30) {
    return { key: 'month', label: '最近 30 天' };
  }
  return { key: 'earlier', label: '更早' };
}

class CodexTreeProvider {
  constructor(store, state) {
    this.store = store;
    this.state = state;
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
      const order = ['today', 'yesterday', 'week', 'month', 'earlier'];
      const buckets = new Map();
      for (const session of sessions) {
        const group = groupFor(session.updatedAt);
        if (!buckets.has(group.key)) {
          buckets.set(group.key, { ...group, sessions: [] });
        }
        buckets.get(group.key).sessions.push(session);
      }
      const groups = [];
      for (const key of order) {
        const bucket = buckets.get(key);
        if (!bucket) {
          continue;
        }
        const item = new vscode.TreeItem(`${bucket.label} (${bucket.sessions.length})`, vscode.TreeItemCollapsibleState.Expanded);
        item.iconPath = new vscode.ThemeIcon('calendar');
        item.contextValue = 'codexGroup';
        item.group = bucket;
        groups.push(item);
      }
      return groups;
    }

    if (element.group) {
      return element.group.sessions.map((session) => this.createSessionItem(session));
    }
    return [];
  }

  createSessionItem(session) {
    const item = new vscode.TreeItem(session.title, vscode.TreeItemCollapsibleState.None);
    const parts = [formatWhen(session.updatedAt)];
    const size = formatSize(session.size);
    if (size) {
      parts.push(size);
    }
    item.description = parts.filter(Boolean).join(' · ');
    item.id = session.path;
    item.contextValue = session.archived ? 'codexSessionArchived' : 'codexSession';
    item.iconPath = new vscode.ThemeIcon(session.archived ? 'archive' : 'comment-discussion');
    item.command = {
      command: 'codexHistory.openSession',
      title: '打开聊天记录',
      arguments: [session]
    };

    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown('**');
    tooltip.appendText(session.title);
    tooltip.appendMarkdown('**\n\n');
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
