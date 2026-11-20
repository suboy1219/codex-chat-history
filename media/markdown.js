(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CodexMarkdown = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeHref(raw) {
    const value = String(raw || '').trim();
    if (!value) {
      return '';
    }
    if (/^(https?:|mailto:|file:)/i.test(value)) {
      return value;
    }
    if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\') || value.startsWith('/')) {
      return value;
    }
    if (/^\.{1,2}[\\/]/.test(value)) {
      return value;
    }
    if (value.startsWith('#')) {
      return value;
    }
    return '';
  }

  function renderInline(text) {
    const slots = [];
    const stash = (html) => {
      slots.push(html);
      return `\u0001${slots.length - 1}\u0001`;
    };
    const restore = (value) => {
      let result = value;
      for (let i = 0; i < 8 && /\u0001\d+\u0001/.test(result); i += 1) {
        result = result.replace(/\u0001(\d+)\u0001/g, (match, index) => slots[Number(index)] || match);
      }
      return result;
    };

    let source = String(text);
    source = source.replace(/`([^`\n]+)`/g, (match, code) => stash(`<code>${escapeHtml(code)}</code>`));
    source = escapeHtml(source);

    source = source.replace(/!\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+&quot;[^&]*&quot;)?\)/g, (match, alt, url) => {
      const href = /^data:image\//i.test(url) ? url : safeHref(url);
      if (!href || !/^(https?:|data:image\/)/i.test(href)) {
        return alt;
      }
      return stash(`<img src="${href}" alt="${alt}" loading="lazy">`);
    });

    source = source.replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+&quot;[^&]*&quot;)?\)/g, (match, label, url) => {
      const href = safeHref(url);
      if (!href) {
        return label;
      }
      return stash(`<a href="#" data-href="${href}" title="${href}">${label}</a>`);
    });

    source = source.replace(/(^|[\s(])(https?:\/\/[^\s<]+)/g, (match, lead, url) => {
      let clean = url;
      let tail = '';
      const trailing = clean.match(/[.,;:!?)\]}'"。，、；：！？）》」』】]+$/);
      if (trailing) {
        tail = trailing[0];
        clean = clean.slice(0, -tail.length);
      }
      if (!clean) {
        return match;
      }
      return `${lead}${stash(`<a href="#" data-href="${clean}" title="${clean}">${clean}</a>`)}${tail}`;
    });

    source = source.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    source = source.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
    source = source.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
    source = source.replace(/(^|[^\w*])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>');
    source = source.replace(/(^|[^\w_])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
    return restore(source);
  }

  function isTableSeparator(line) {
    const trimmed = String(line).trim();
    if (!trimmed.includes('-')) {
      return false;
    }
    const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|');
    return cells.length > 0 && cells.every((cell) => /^\s*:?-{2,}:?\s*$/.test(cell));
  }

  function splitRow(line) {
    return String(line)
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim());
  }

  function renderList(items) {
    if (!items.length) {
      return '';
    }
    const base = items[0].indent;
    while (items.length && items[0].indent > base) {
      items.shift();
    }
    const tag = items[0].ordered ? 'ol' : 'ul';
    let html = `<${tag}>`;
    let index = 0;
    while (index < items.length) {
      const item = items[index];
      let next = index + 1;
      while (next < items.length && items[next].indent > base) {
        next += 1;
      }
      let text = item.text;
      const task = text.match(/^\[([ xX])\]\s+([\s\S]*)$/);
      if (task) {
        const checked = task[1].toLowerCase() === 'x';
        text = `<span class="task">${checked ? '☑' : '☐'}</span> ${renderInline(task[2])}`;
      } else {
        text = renderInline(text);
      }
      html += `<li>${text}`;
      if (next > index + 1) {
        html += renderList(items.slice(index + 1, next));
      }
      html += '</li>';
      index = next;
    }
    return `${html}</${tag}>`;
  }

  function render(source) {
    const lines = String(source === undefined || source === null ? '' : source).replace(/\r\n?/g, '\n').split('\n');
    const output = [];
    let paragraph = [];
    let index = 0;

    const flushParagraph = () => {
      if (!paragraph.length) {
        return;
      }
      output.push(`<p>${renderInline(paragraph.join('\n')).replace(/\n/g, '<br>')}</p>`);
      paragraph = [];
    };

    while (index < lines.length) {
      const line = lines[index];

      if (/^\s*$/.test(line)) {
        flushParagraph();
        index += 1;
        continue;
      }

      const fenceMatch = line.match(/^\s*(`{3,}|~{3,})\s*([^\s`]*)/);
      if (fenceMatch) {
        flushParagraph();
        const marker = fenceMatch[1][0];
        const length = fenceMatch[1].length;
        const language = (fenceMatch[2] || '').replace(/[^\w+#.-]/g, '').slice(0, 20);
        const body = [];
        index += 1;
        const closing = new RegExp(`^\\s*${marker === '`' ? '`' : '~'}{${length},}\\s*$`);
        while (index < lines.length && !closing.test(lines[index])) {
          body.push(lines[index]);
          index += 1;
        }
        index += 1;
        output.push(
          `<div class="code-block"><div class="code-head"><span class="lang">${escapeHtml(language || 'text')}</span>` +
            `<button type="button" class="copy-code">复制</button></div>` +
            `<pre><code>${escapeHtml(body.join('\n'))}</code></pre></div>`
        );
        continue;
      }

      const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
      if (heading) {
        flushParagraph();
        const level = heading[1].length;
        output.push(`<h${level}>${renderInline(heading[2].replace(/\s+#+\s*$/, ''))}</h${level}>`);
        index += 1;
        continue;
      }

      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
        flushParagraph();
        output.push('<hr>');
        index += 1;
        continue;
      }

      if (/^\s*\|.*\|\s*$/.test(line) && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
        flushParagraph();
        const headers = splitRow(line);
        index += 2;
        const rows = [];
        while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index])) {
          rows.push(splitRow(lines[index]));
          index += 1;
        }
        let table = '<div class="table-wrap"><table><thead><tr>';
        for (const header of headers) {
          table += `<th>${renderInline(header)}</th>`;
        }
        table += '</tr></thead><tbody>';
        for (const row of rows) {
          table += '<tr>';
          for (const cell of row) {
            table += `<td>${renderInline(cell)}</td>`;
          }
          table += '</tr>';
        }
        table += '</tbody></table></div>';
        output.push(table);
        continue;
      }

      if (/^\s*>/.test(line)) {
        flushParagraph();
        const quoted = [];
        while (index < lines.length && /^\s*>/.test(lines[index])) {
          quoted.push(lines[index].replace(/^\s*>\s?/, ''));
          index += 1;
        }
        output.push(`<blockquote>${render(quoted.join('\n'))}</blockquote>`);
        continue;
      }

      if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) {
        flushParagraph();
        const items = [];
        while (index < lines.length) {
          const match = lines[index].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
          if (!match) {
            break;
          }
          items.push({
            indent: match[1].replace(/\t/g, '  ').length,
            ordered: /\d/.test(match[2]),
            text: match[3]
          });
          index += 1;
        }
        output.push(renderList(items));
        continue;
      }

      paragraph.push(line);
      index += 1;
    }

    flushParagraph();
    return output.join('\n');
  }

  return { escapeHtml, render, renderInline, safeHref };
});
