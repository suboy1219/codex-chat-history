'use strict';

function fenceFor(text) {
  let longest = 0;
  const matches = String(text).match(/`+/g);
  if (matches) {
    for (const match of matches) {
      longest = Math.max(longest, match.length);
    }
  }
  return '`'.repeat(Math.max(3, longest + 1));
}

function formatClock(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleString();
}

function sessionToMarkdown(session) {
  const meta = session.meta;
  const lines = [];
  lines.push(`# ${meta.title || 'Codex 会话'}`);
  lines.push('');
  if (meta.timestamp) {
    lines.push(`- **开始时间**：${formatDate(meta.timestamp)}`);
  }
  if (meta.updatedAt) {
    lines.push(`- **最后更新**：${formatDate(meta.updatedAt)}`);
  }
  if (meta.cwd) {
    lines.push(`- **工作目录**：\`${meta.cwd.replace(/`/g, "'")}\``);
  }
  if (meta.model) {
    lines.push(`- **模型**：\`${meta.model}\``);
  }
  lines.push(`- **会话 ID**：\`${meta.id}\``);
  lines.push(`- **原始文件**：\`${meta.path.replace(/`/g, "'")}\``);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const item of session.items) {
    if (item.type === 'user') {
      lines.push(`## 你${item.time ? ` · ${formatClock(item.time)}` : ''}`);
      lines.push('');
      lines.push(item.text || '');
      if (item.images && item.images.length) {
        lines.push('');
        for (const image of item.images) {
          if (/^https?:\/\//i.test(image)) {
            lines.push(`![](${image})`);
          } else {
            lines.push('_(内嵌图片已省略)_');
          }
        }
      }
      lines.push('');
    } else if (item.type === 'assistant') {
      lines.push(`## Codex${item.time ? ` · ${formatClock(item.time)}` : ''}`);
      lines.push('');
      lines.push(item.text || '');
      lines.push('');
    } else if (item.type === 'reasoning') {
      lines.push('<details><summary>思考过程</summary>');
      lines.push('');
      lines.push(item.text || '');
      lines.push('');
      lines.push('</details>');
      lines.push('');
    } else if (item.type === 'tool') {
      lines.push(`### 工具调用 · ${item.name || 'tool'}${item.time ? ` · ${formatClock(item.time)}` : ''}`);
      lines.push('');
      if (item.input) {
        const inputFence = fenceFor(item.input);
        lines.push(`输入：`);
        lines.push('');
        lines.push(`${inputFence}text`);
        lines.push(item.input);
        lines.push(inputFence);
        lines.push('');
      }
      if (item.output) {
        const outputFence = fenceFor(item.output);
        lines.push(`输出：`);
        lines.push('');
        lines.push(`${outputFence}text`);
        lines.push(item.output);
        lines.push(outputFence);
        lines.push('');
      }
    } else if (item.type === 'notice') {
      lines.push(`> ⚠️ ${String(item.text || '').replace(/\n/g, '\n> ')}`);
      lines.push('');
    }
  }
  return `${lines.join('\n')}\n`;
}

module.exports = { sessionToMarkdown, fenceFor };
