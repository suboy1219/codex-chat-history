(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const markdown = window.CodexMarkdown;
  const persisted = vscode.getState() || {};
  const settings = {
    showToolCalls: persisted.showToolCalls !== false,
    showReasoning: persisted.showReasoning !== false,
    openToolCalls: persisted.openToolCalls === true
  };

  let session = null;
  let filterText = '';
  let focusIndex = null;

  const messagesEl = document.getElementById('messages');
  const innerEl = document.getElementById('messages-inner');
  const filterEl = document.getElementById('filter');
  const filterCountEl = document.getElementById('filter-count');
  const jumpEl = document.getElementById('jump-bottom');
  const titleEl = document.getElementById('session-title');
  const metaEl = document.getElementById('session-meta');
  const toolsToggle = document.getElementById('toggle-tools');
  const reasoningToggle = document.getElementById('toggle-reasoning');

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  }

  function formatClock(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  function dayKey(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  }

  function dayLabel(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const target = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const diff = Math.round((today - target) / 86400000);
    if (diff === 0) {
      return '今天';
    }
    if (diff === 1) {
      return '昨天';
    }
    if (date.getFullYear() === now.getFullYear()) {
      return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
    }
    return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
  }

  function formatFull(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    return date.toLocaleString();
  }

  function chip(label, value, className) {
    const node = el('span', `chip${className ? ` ${className}` : ''}`);
    node.textContent = value ? `${label} ${value}` : label;
    node.title = value || label;
    return node;
  }

  function renderMeta(meta, stats) {
    metaEl.textContent = '';
    if (meta.updatedAt || meta.timestamp) {
      metaEl.appendChild(chip('时间', formatFull(meta.timestamp || meta.updatedAt)));
    }
    if (meta.model) {
      metaEl.appendChild(chip('模型', meta.model));
    }
    const counts = [];
    if (stats.messages) {
      counts.push(`${stats.messages} 条提问`);
    }
    if (stats.replies) {
      counts.push(`${stats.replies} 条回复`);
    }
    if (stats.tools) {
      counts.push(`${stats.tools} 次工具调用`);
    }
    if (counts.length) {
      metaEl.appendChild(chip('', counts.join(' · ')));
    }
    if (meta.tokens) {
      metaEl.appendChild(chip('Token', meta.tokens.toLocaleString()));
    }
    if (meta.archived) {
      metaEl.appendChild(chip('', '已归档'));
    }
    if (meta.cwd) {
      metaEl.appendChild(chip('目录', meta.cwd, 'cwd'));
    }
  }

  function makeCopyButton(itemIndex) {
    const button = el('button', 'copy-message', '复制');
    button.type = 'button';
    button.dataset.copyMessage = String(itemIndex);
    button.title = '复制这条消息的原文';
    return button;
  }

  function renderUser(item, index) {
    const article = el('article', 'item user');
    article.id = `m-${index}`;
    article.dataset.index = String(index);
    const avatar = el('div', 'avatar', '你');
    avatar.title = '你';
    article.appendChild(avatar);
    const content = el('div', 'content');
    const headline = el('div', 'headline');
    if (item.time) {
      headline.appendChild(el('time', '', formatClock(item.time)));
    }
    headline.appendChild(makeCopyButton(index));
    content.appendChild(headline);
    const bubble = el('div', 'bubble');
    const body = el('div', 'markdown');
    body.innerHTML = markdown.render(item.text || '');
    bubble.appendChild(body);
    if (item.images && item.images.length) {
      const images = el('div', 'images');
      for (const source of item.images) {
        if (!/^(data:image\/|https?:)/i.test(source)) {
          continue;
        }
        const img = document.createElement('img');
        img.src = source;
        img.alt = '用户截图';
        img.title = '点击放大 / 还原';
        img.addEventListener('click', () => img.classList.toggle('zoomed'));
        images.appendChild(img);
      }
      if (images.childElementCount) {
        bubble.appendChild(images);
      }
    }
    content.appendChild(bubble);
    article.appendChild(content);
    article.dataset.search = String(item.text || '').toLowerCase();
    return article;
  }

  function renderAssistant(item, index) {
    const article = el('article', 'item assistant');
    article.id = `m-${index}`;
    article.dataset.index = String(index);
    const avatar = el('div', 'avatar', 'AI');
    avatar.title = 'Codex';
    article.appendChild(avatar);
    const content = el('div', 'content');
    const headline = el('div', 'headline');
    if (item.time) {
      headline.appendChild(el('time', '', formatClock(item.time)));
    }
    headline.appendChild(makeCopyButton(index));
    content.appendChild(headline);
    const bubble = el('div', 'bubble');
    const body = el('div', 'markdown');
    body.innerHTML = markdown.render(item.text || '');
    bubble.appendChild(body);
    content.appendChild(bubble);
    article.appendChild(content);
    article.dataset.search = String(item.text || '').toLowerCase();
    return article;
  }

  function renderReasoning(item, index) {
    const article = el('article', 'item reasoning');
    article.id = `m-${index}`;
    article.dataset.index = String(index);
    const details = document.createElement('details');
    details.className = 'reasoning';
    const summary = document.createElement('summary');
    summary.appendChild(el('span', 'tool-name', '思考过程'));
    summary.appendChild(el('span', 'tool-brief', `${String(item.text || '').length} 字`));
    details.appendChild(summary);
    const body = el('div', 'reasoning-body', item.text || '');
    details.appendChild(body);
    article.appendChild(details);
    article.dataset.search = String(item.text || '').toLowerCase();
    return article;
  }

  function renderTool(item, index) {
    const article = el('article', 'item tool');
    article.id = `m-${index}`;
    article.dataset.index = String(index);
    const details = document.createElement('details');
    details.className = 'tool';
    if (settings.openToolCalls) {
      details.open = true;
    }
    const summary = document.createElement('summary');
    summary.appendChild(el('span', 'tool-name', item.name || 'tool'));
    const brief = String(item.input || item.output || '').split('\n').find((line) => line.trim()) || '';
    summary.appendChild(el('span', 'tool-brief', brief.trim().slice(0, 140)));
    summary.appendChild(el('span', 'tool-output-mark', item.output ? '有输出' : '无输出'));
    details.appendChild(summary);

    const body = el('div', 'tool-body');
    if (item.input) {
      const section = el('div', 'tool-section');
      section.appendChild(el('div', 'label', '输入'));
      section.appendChild(el('pre', '', item.input));
      body.appendChild(section);
    }
    if (item.output) {
      const section = el('div', 'tool-section');
      section.appendChild(el('div', 'label', '输出'));
      section.appendChild(el('pre', '', item.output));
      body.appendChild(section);
    }
    if (!item.input && !item.output) {
      body.appendChild(el('div', 'tool-section', '（无输入输出）'));
    }
    details.appendChild(body);
    article.appendChild(details);
    article.dataset.search = `${item.name || ''} ${item.input || ''} ${item.output || ''}`.toLowerCase();
    return article;
  }

  function renderNotice(item) {
    const node = el('div', 'notice', item.text || '');
    node.dataset.search = String(item.text || '').toLowerCase();
    return node;
  }

  function render() {
    if (!session) {
      return;
    }
    const previous = messagesEl.scrollTop;
    const nearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 120;
    titleEl.textContent = session.meta.title || 'Codex 会话';
    titleEl.title = session.meta.title || '';
    renderMeta(session.meta, session.stats || {});
    innerEl.textContent = '';

    let currentDay = '';
    session.items.forEach((item, index) => {
      if (item.time) {
        const key = dayKey(item.time);
        if (key && key !== currentDay) {
          currentDay = key;
          const divider = el('div', 'day-divider', dayLabel(item.time));
          divider.dataset.search = '';
          innerEl.appendChild(divider);
        }
      }
      let node;
      if (item.type === 'user') {
        node = renderUser(item, index);
      } else if (item.type === 'assistant') {
        node = renderAssistant(item, index);
      } else if (item.type === 'reasoning') {
        node = renderReasoning(item, index);
      } else if (item.type === 'tool') {
        node = renderTool(item, index);
      } else {
        node = renderNotice(item);
      }
      innerEl.appendChild(node);
    });

    if (!session.items.length) {
      const empty = el('div', 'empty', '这次会话里没有可显示的对话内容。可能是会话刚开始，或者记录格式暂不支持。');
      innerEl.appendChild(empty);
    }

    applyVisibility();

    if (focusIndex !== null) {
      const target = document.getElementById(`m-${focusIndex}`);
      if (target) {
        target.scrollIntoView({ block: 'center' });
        target.classList.add('flash');
        setTimeout(() => target.classList.remove('flash'), 1600);
      }
      focusIndex = null;
    } else if (nearBottom) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    } else {
      messagesEl.scrollTop = previous;
    }
    updateJumpButton();
  }

  function applyVisibility() {
    if (!session) {
      return;
    }
    const needle = filterText.trim().toLowerCase();
    let visible = 0;
    let total = 0;
    const nodes = innerEl.querySelectorAll('.item, .notice');
    nodes.forEach((node) => {
      const index = Number(node.dataset.index);
      const item = Number.isFinite(index) ? session.items[index] : null;
      let hiddenBySetting = false;
      if (item && item.type === 'tool' && !settings.showToolCalls) {
        hiddenBySetting = true;
      }
      if (item && item.type === 'reasoning' && !settings.showReasoning) {
        hiddenBySetting = true;
      }
      if (hiddenBySetting) {
        node.classList.add('hidden');
        return;
      }
      total += 1;
      const matched = !needle || (node.dataset.search || '').includes(needle);
      node.classList.toggle('hidden', !matched);
      if (matched) {
        visible += 1;
      }
    });
    innerEl.querySelectorAll('.day-divider').forEach((divider) => {
      divider.classList.toggle('hidden', Boolean(needle));
    });
    filterCountEl.textContent = needle ? `${visible}/${total}` : '';
  }

  function updateJumpButton() {
    const away = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
    jumpEl.classList.toggle('visible', away > 320);
  }

  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[data-href]');
    if (link) {
      event.preventDefault();
      vscode.postMessage({ type: 'openLink', href: link.dataset.href });
      return;
    }
    const copyCode = event.target.closest('button.copy-code');
    if (copyCode) {
      const block = copyCode.closest('.code-block');
      const code = block && block.querySelector('code');
      if (code) {
        vscode.postMessage({ type: 'copy', text: code.textContent });
      }
      return;
    }
    const copyMessage = event.target.closest('button.copy-message');
    if (copyMessage) {
      const index = Number(copyMessage.dataset.copyMessage);
      const item = session && session.items[index];
      if (item) {
        vscode.postMessage({ type: 'copy', text: item.text || '' });
      }
    }
  });

  document.getElementById('btn-refresh').addEventListener('click', () => {
    vscode.postMessage({ type: 'refresh' });
  });
  document.getElementById('btn-export').addEventListener('click', () => {
    vscode.postMessage({ type: 'export' });
  });
  document.getElementById('btn-raw').addEventListener('click', () => {
    vscode.postMessage({ type: 'openRaw' });
  });
  document.getElementById('btn-expand').addEventListener('click', () => {
    innerEl.querySelectorAll('details').forEach((details) => {
      if (!details.closest('.hidden')) {
        details.open = true;
      }
    });
  });
  document.getElementById('btn-collapse').addEventListener('click', () => {
    innerEl.querySelectorAll('details').forEach((details) => {
      details.open = false;
    });
  });

  jumpEl.addEventListener('click', () => {
    messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' });
  });
  messagesEl.addEventListener('scroll', updateJumpButton);

  filterEl.addEventListener('input', () => {
    filterText = filterEl.value;
    applyVisibility();
  });

  toolsToggle.addEventListener('change', () => {
    settings.showToolCalls = toolsToggle.checked;
    persist();
    applyVisibility();
  });
  reasoningToggle.addEventListener('change', () => {
    settings.showReasoning = reasoningToggle.checked;
    persist();
    applyVisibility();
  });

  function persist() {
    vscode.setState(settings);
  }

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      filterEl.focus();
      filterEl.select();
    } else if (event.key === 'Escape' && document.activeElement === filterEl) {
      filterEl.value = '';
      filterText = '';
      applyVisibility();
      filterEl.blur();
    }
  });

  window.addEventListener('message', (event) => {
    const message = event.data || {};
    if (message.type === 'session') {
      session = message.session;
      focusIndex = typeof message.focusIndex === 'number' ? message.focusIndex : null;
      if (message.resetFilter) {
        filterEl.value = '';
        filterText = '';
      }
      if (message.settings) {
        settings.showToolCalls = message.settings.showToolCalls !== false;
        settings.showReasoning = message.settings.showReasoning !== false;
        settings.openToolCalls = Boolean(message.settings.openToolCalls);
        toolsToggle.checked = settings.showToolCalls;
        reasoningToggle.checked = settings.showReasoning;
      }
      render();
    } else if (message.type === 'error') {
      session = null;
      titleEl.textContent = '无法读取会话';
      metaEl.textContent = '';
      innerEl.textContent = '';
      innerEl.appendChild(el('div', 'error', message.message || '未知错误'));
    }
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'End' && event.ctrlKey) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
