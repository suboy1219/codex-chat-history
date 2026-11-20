'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { normalizeUserText, parseSessionText, readSessionHead } = require('../src/parser');

function record(type, payload, timestamp) {
  return { timestamp: timestamp || '2026-11-20T07:20:00.000Z', type, payload };
}

const fixture = [
  record('session_meta', {
    id: '11111111-2222-3333-4444-555555555555',
    timestamp: '2026-11-20T07:19:47.635Z',
    cwd: 'D:\\demo\\project',
    cli_version: '0.171.0',
    source: 'vscode',
    model_provider: 'openai'
  }),
  record('response_item', {
    type: 'message',
    role: 'developer',
    content: [{ type: 'input_text', text: 'developer instructions' }]
  }),
  record('response_item', {
    type: 'message',
    role: 'user',
    content: [{ type: 'input_text', text: '<environment_context>\n  <cwd>D:\\demo</cwd>\n</environment_context>' }]
  }),
  record('response_item', {
    type: 'message',
    role: 'user',
    content: [
      {
        type: 'input_text',
        text: '\n# Files mentioned by the user:\n\n## a.cs: D:\\demo\\a.cs\n\n## My request:\n修复登录问题'
      }
    ]
  }),
  record('event_msg', { type: 'user_message', message: '修复登录问题' }),
  record('turn_context', {
    cwd: 'D:\\demo\\project',
    model: 'gpt-test',
    collaboration_mode: { settings: { reasoning_effort: 'high' } }
  }),
  record('response_item', { type: 'reasoning', summary: [{ type: 'summary_text', text: '先看代码' }] }),
  record('event_msg', { type: 'agent_message', message: '我来看看。' }),
  record('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '我来看看。' }] }),
  record('response_item', {
    type: 'custom_tool_call',
    name: 'exec',
    call_id: 'call_1',
    input: 'await tools.exec_command({cmd:"dir"})'
  }),
  record('response_item', {
    type: 'custom_tool_call_output',
    call_id: 'call_1',
    output: [{ type: 'input_text', text: 'a.cs\nb.cs' }]
  }),
  record('response_item', {
    type: 'message',
    role: 'user',
    content: [
      { type: 'input_text', text: '看这个截图' },
      { type: 'input_image', image_url: 'data:image/png;base64,AAAA' }
    ]
  }),
  record('event_msg', { type: 'task_started' }),
  record('event_msg', { type: 'token_count', info: { total_token_usage: { total_tokens: 1234 } } })
];

const sessionText = `${fixture.map((entry) => JSON.stringify(entry)).join('\n')}\n`;
const parsed = parseSessionText(sessionText, { title: '' });

assert.strictEqual(parsed.meta.id, '11111111-2222-3333-4444-555555555555', 'meta id');
assert.strictEqual(parsed.meta.model, 'gpt-test', 'model from turn_context');
assert.strictEqual(parsed.meta.reasoningEffort, 'high', 'reasoning effort');
assert.strictEqual(parsed.meta.tokens, 1234, 'token usage');
assert.strictEqual(parsed.meta.title, '修复登录问题', 'fallback title from first user message');

const types = parsed.items.map((item) => item.type);
assert.deepStrictEqual(types, ['user', 'reasoning', 'assistant', 'tool', 'user'], 'item ordering and filtering');
assert.strictEqual(parsed.items[0].text, '修复登录问题', 'attachment wrapper stripped');
assert.strictEqual(parsed.items[3].output, 'a.cs\nb.cs', 'tool output paired by call_id');
assert.strictEqual(parsed.items[4].images.length, 1, 'image kept on user message');
assert.strictEqual(parsed.stats.messages, 2, 'user message count');
assert.strictEqual(parsed.stats.turns, 1, 'turn count');
assert.ok(!JSON.stringify(parsed.items).includes('developer instructions'), 'developer content excluded');

assert.strictEqual(normalizeUserText('# AGENTS.md instructions for D:\\x'), null, 'agents injection dropped');
assert.strictEqual(normalizeUserText('<environment_context>\n<cwd>x</cwd>'), null, 'env injection dropped');
assert.strictEqual(
  normalizeUserText('<friendbuddy_context_update>\n以下是宿主提供的用户级背景更新'),
  null,
  'friendbuddy context injection dropped'
);
assert.strictEqual(normalizeUserText('# 当前运行模型（事实）\n供应商：fttoken'), null, 'model context dropped');
assert.strictEqual(normalizeUserText('## My request:\n你好'), '你好', 'request section extracted');
assert.strictEqual(
  normalizeUserText('<send_user_message_question_reply>[{"question":"用哪个方案？","answer":"方案 A"}]</send_user_message_question_reply>'),
  '用哪个方案？：方案 A',
  'question reply unwrapped'
);

const eventOnly = parseSessionText(
  [
    JSON.stringify(record('session_meta', { id: 'evt-id', timestamp: '2026-11-20T08:00:00.000Z', cwd: 'D:\\demo' })),
    JSON.stringify(record('event_msg', { type: 'user_message', message: '只有事件记录' })),
    JSON.stringify(record('event_msg', { type: 'agent_message', message: '也能显示回复' }))
  ].join('\n'),
  {}
);
assert.deepStrictEqual(eventOnly.items.map((item) => item.type), ['user', 'assistant'], 'event_msg fallback');
assert.strictEqual(eventOnly.meta.title, '只有事件记录', 'event fallback title');

const home = path.join(os.homedir(), '.codex', 'sessions');
if (fs.existsSync(home)) {
  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.jsonl')) {
        files.push(full);
      }
    }
  })(home);
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  for (const file of files.slice(0, 3)) {
    const session = require('../src/parser').parseSessionFile(file, {});
    assert.ok(session.meta.id, `real session id: ${file}`);
    assert.ok(Array.isArray(session.items), 'real session items');
    assert.ok(session.meta.title && session.meta.title !== '未命名会话', `real session title: ${file}`);
    assert.ok(!session.items.some((item) => item.type === 'developer'), 'no developer items');
    const head = readSessionHead(file);
    assert.ok(head.id, 'head id');
  }
  console.log(`parser: ok (validated ${Math.min(3, files.length)} real sessions)`);
} else {
  console.log('parser: ok (synthetic only, no ~/.codex/sessions)');
}
