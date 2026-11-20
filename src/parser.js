'use strict';

const fs = require('fs');

const MAX_TOOL_INPUT = 20000;
const MAX_TOOL_OUTPUT = 30000;

const INJECTED_PREFIXES = [
  '<environment_context>',
  '<permissions instructions>',
  '<collaboration_mode>',
  '<user_instructions>',
  '<skills_instructions>',
  '<friendbuddy_context_update>',
  '<codex_apps_client_time_context>',
  '<multi_agent_',
  '<codex_internal_',
  '<external_codex_apps_',
  '<turn_aborted>',
  '<subagent_notification',
  '<user_shell_command>',
  '# 当前运行模型',
  '# agents.md instructions for',
  '# files mentioned by the user:'
];

const NOTICE_EVENTS = new Set([
  'error',
  'stream_error',
  'turn_aborted',
  'context_compacted'
]);

function textOf(value) {
  if (typeof value === 'string') {
    return value;
  }
  if (!value || typeof value !== 'object') {
    return '';
  }
  if (typeof value.text === 'string') {
    return value.text;
  }
  if (Array.isArray(value.content)) {
    return value.content.map(textOf).join('');
  }
  return '';
}

function contentText(content) {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  const parts = [];
  for (const item of content) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    if (item.type === 'input_text' || item.type === 'output_text' || item.type === 'text') {
      parts.push(textOf(item.text));
    }
  }
  return parts.join('');
}

function imagesOf(content) {
  if (!Array.isArray(content)) {
    return [];
  }
  const images = [];
  for (const item of content) {
    if (!item || item.type !== 'input_image') {
      continue;
    }
    const raw = item.image_url;
    const url = typeof raw === 'string' ? raw : raw && typeof raw.url === 'string' ? raw.url : '';
    if (url) {
      images.push(url);
    }
  }
  return images;
}

function unwrapQuestionReply(text) {
  const match = text.match(/<send_user_message_question_reply>([\s\S]*?)<\/send_user_message_question_reply>/i);
  if (!match) {
    return text;
  }
  const body = match[1].trim();
  try {
    const parsed = JSON.parse(body);
    if (Array.isArray(parsed)) {
      const answers = [];
      for (const entry of parsed) {
        const question = entry && (entry.question || entry.header);
        const answer = entry && (entry.answer || entry.value || entry.selected);
        if (answer) {
          answers.push(question ? `${question}：${Array.isArray(answer) ? answer.join('、') : answer}` : String(answer));
        }
      }
      if (answers.length) {
        return answers.join('\n');
      }
    }
  } catch (error) {
    // Keep the raw body when it is not JSON.
  }
  return body;
}

function normalizeUserText(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  let text = raw;
  const requestMatch = text.match(/##\s*My request(?: for Codex)?\s*:\s*/i);
  if (requestMatch && requestMatch.index !== undefined) {
    text = text.slice(requestMatch.index + requestMatch[0].length);
  } else if (/^\s*#\s*Files mentioned by the user:/i.test(text)) {
    return null;
  }

  text = unwrapQuestionReply(text);
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  const lowered = trimmed.toLowerCase();
  for (const prefix of INJECTED_PREFIXES) {
    if (lowered.startsWith(prefix)) {
      return null;
    }
  }
  return trimmed;
}

function reasoningText(payload) {
  const parts = [];
  for (const key of ['summary', 'content']) {
    const list = payload[key];
    if (!Array.isArray(list)) {
      continue;
    }
    for (const entry of list) {
      const text = textOf(entry);
      if (text && text.trim()) {
        parts.push(text.trim());
      }
    }
  }
  return parts.join('\n\n').trim();
}

function toolInputText(input) {
  let text;
  if (typeof input === 'string') {
    text = input;
  } else if (input === undefined || input === null) {
    text = '';
  } else {
    try {
      text = JSON.stringify(input, null, 2);
    } catch (error) {
      text = String(input);
    }
  }
  if (text.length > MAX_TOOL_INPUT) {
    return `${text.slice(0, MAX_TOOL_INPUT)}\n…（已截断，共 ${text.length} 字符）`;
  }
  return text;
}

function toolOutputText(output) {
  let text = '';
  if (typeof output === 'string') {
    text = output;
  } else if (Array.isArray(output)) {
    text = output.map(textOf).join('');
  } else if (output && typeof output === 'object') {
    text = textOf(output) || JSON.stringify(output, null, 2);
  }
  if (text.length > MAX_TOOL_OUTPUT) {
    return `${text.slice(0, MAX_TOOL_OUTPUT)}\n…（已截断，共 ${text.length} 字符）`;
  }
  return text;
}

function shortText(text, limit) {
  const compact = String(text || '').replace(/\s+/g, ' ').trim();
  if (compact.length <= limit) {
    return compact;
  }
  return `${compact.slice(0, limit - 1)}…`;
}

function fallbackTitle(userText) {
  const plain = userText
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return shortText(plain, 48) || '未命名会话';
}

function parseSessionText(text, extra) {
  const info = extra || {};
  const lines = String(text).split(/\r?\n/);
  const items = [];
  const eventItems = [];
  const toolByCallId = new Map();
  const meta = {
    id: info.id || '',
    title: info.title || '',
    timestamp: info.timestamp || '',
    updatedAt: info.updatedAt || info.mtime || '',
    cwd: '',
    model: '',
    reasoningEffort: '',
    cliVersion: '',
    source: '',
    provider: '',
    tokens: 0,
    path: info.path || '',
    archived: Boolean(info.archived),
    size: info.size || 0
  };
  let turns = 0;
  let firstUserText = '';
  let hasResponseUser = false;
  let lastTimestamp = meta.timestamp;

  for (const line of lines) {
    if (!line || line.charCodeAt(0) !== 123) {
      continue;
    }
    let record;
    try {
      record = JSON.parse(line);
    } catch (error) {
      continue;
    }
    if (!record || typeof record !== 'object') {
      continue;
    }
    if (record.timestamp) {
      lastTimestamp = record.timestamp;
    }
    const payload = record.payload || {};

    if (record.type === 'session_meta') {
      meta.id = meta.id || payload.id || payload.session_id || '';
      meta.timestamp = meta.timestamp || payload.timestamp || record.timestamp || '';
      meta.cwd = payload.cwd || meta.cwd;
      meta.cliVersion = payload.cli_version || meta.cliVersion;
      meta.source = payload.source || meta.source;
      meta.provider = payload.model_provider || meta.provider;
      continue;
    }

    if (record.type === 'turn_context') {
      meta.model = payload.model || meta.model;
      if (payload.collaboration_mode && payload.collaboration_mode.settings) {
        meta.reasoningEffort = payload.collaboration_mode.settings.reasoning_effort || meta.reasoningEffort;
      }
      meta.cwd = payload.cwd || meta.cwd;
      continue;
    }

    if (record.type === 'event_msg') {
      if (payload.type === 'task_started') {
        turns += 1;
      } else if (payload.type === 'user_message' && typeof payload.message === 'string') {
        eventItems.push({
          type: 'user',
          text: payload.message,
          images: [],
          time: record.timestamp || ''
        });
      } else if (payload.type === 'agent_message' && typeof payload.message === 'string') {
        eventItems.push({
          type: 'assistant',
          text: payload.message,
          time: record.timestamp || ''
        });
      } else if (payload.type === 'token_count' && payload.info && payload.info.total_token_usage) {
        meta.tokens = payload.info.total_token_usage.total_tokens || meta.tokens;
      } else if (NOTICE_EVENTS.has(payload.type)) {
        const message = payload.message || payload.reason || payload.error || payload.type;
        eventItems.push({
          type: 'notice',
          text: typeof message === 'string' ? message : JSON.stringify(message),
          time: record.timestamp || ''
        });
      }
      continue;
    }

    if (record.type !== 'response_item') {
      continue;
    }

    if (payload.type === 'message') {
      const role = payload.role;
      const rawText = contentText(payload.content);
      if (role === 'user') {
        const normalized = normalizeUserText(rawText);
        const images = imagesOf(payload.content);
        if (normalized || images.length) {
          hasResponseUser = true;
          if (!firstUserText && normalized) {
            firstUserText = normalized;
          }
          items.push({
            type: 'user',
            text: normalized || '（图片消息）',
            images,
            time: record.timestamp || ''
          });
        }
      } else if (role === 'assistant') {
        const normalized = rawText.trim();
        if (normalized) {
          items.push({
            type: 'assistant',
            text: normalized,
            time: record.timestamp || ''
          });
        }
      }
      continue;
    }

    if (payload.type === 'reasoning') {
      const thinking = reasoningText(payload);
      if (thinking) {
        items.push({
          type: 'reasoning',
          text: thinking,
          time: record.timestamp || ''
        });
      }
      continue;
    }

    if (payload.type === 'custom_tool_call' || payload.type === 'function_call' || payload.type === 'local_shell_call') {
      const name = payload.name || payload.type.replace(/_call$/, '');
      const input = payload.input !== undefined ? payload.input : payload.arguments;
      const item = {
        type: 'tool',
        name,
        input: toolInputText(input),
        output: '',
        callId: payload.call_id || payload.id || '',
        status: payload.status || 'completed',
        time: record.timestamp || ''
      };
      items.push(item);
      if (item.callId) {
        toolByCallId.set(item.callId, item);
      }
      continue;
    }

    if (payload.type === 'custom_tool_call_output' || payload.type === 'function_call_output') {
      const output = toolOutputText(payload.output);
      const existing = payload.call_id ? toolByCallId.get(payload.call_id) : null;
      if (existing) {
        existing.output = output;
      } else {
        items.push({
          type: 'tool',
          name: 'tool',
          input: '',
          output,
          callId: payload.call_id || '',
          status: 'completed',
          time: record.timestamp || ''
        });
      }
      continue;
    }
  }

  let finalItems = items;
  if (!hasResponseUser && eventItems.length) {
    finalItems = eventItems;
  }

  const realUserMessages = finalItems.filter((item) => item.type === 'user' && item.text);
  if (!firstUserText && realUserMessages.length) {
    const textMessage = realUserMessages.find((item) => item.text !== '（图片消息）');
    firstUserText = textMessage ? textMessage.text : '';
  }
  if (!meta.title) {
    meta.title = fallbackTitle(firstUserText);
  }
  if (!meta.timestamp) {
    meta.timestamp = lastTimestamp || '';
  }
  if (!meta.updatedAt) {
    meta.updatedAt = lastTimestamp || meta.timestamp;
  }

  const stats = {
    messages: realUserMessages.length,
    replies: finalItems.filter((item) => item.type === 'assistant').length,
    tools: finalItems.filter((item) => item.type === 'tool').length,
    turns
  };

  return { meta, items: finalItems, stats };
}

function parseSessionFile(filePath, extra) {
  const stat = fs.statSync(filePath);
  const text = fs.readFileSync(filePath, 'utf8');
  return parseSessionText(text, { ...(extra || {}), path: filePath, size: stat.size, mtime: stat.mtime.toISOString() });
}

function readSessionHead(filePath, maxBytes) {
  const limit = maxBytes || 196608;
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(limit);
    const bytes = fs.readSync(fd, buffer, 0, limit, 0);
    const text = buffer.subarray(0, bytes).toString('utf8');
    const lines = text.split(/\r?\n/);
    if (bytes === limit) {
      lines.pop();
    }
    const head = { id: '', cwd: '', timestamp: '', title: '', model: '' };
    let firstUser = '';
    for (const line of lines) {
      if (!line || line.charCodeAt(0) !== 123) {
        continue;
      }
      let record;
      try {
        record = JSON.parse(line);
      } catch (error) {
        continue;
      }
      const payload = record.payload || {};
      if (record.type === 'session_meta') {
        head.id = payload.id || payload.session_id || '';
        head.cwd = payload.cwd || '';
        head.timestamp = payload.timestamp || record.timestamp || '';
      } else if (record.type === 'turn_context' && payload.model) {
        head.model = payload.model;
      } else if (record.type === 'response_item' && payload.type === 'message' && payload.role === 'user') {
        const normalized = normalizeUserText(contentText(payload.content));
        if (normalized) {
          firstUser = normalized;
          break;
        }
      }
    }
    head.title = fallbackTitle(firstUser);
    if (!firstUser) {
      head.title = '';
    }
    return head;
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = {
  contentText,
  fallbackTitle,
  normalizeUserText,
  parseSessionFile,
  parseSessionText,
  readSessionHead,
  shortText
};
