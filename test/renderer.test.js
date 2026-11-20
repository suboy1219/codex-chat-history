'use strict';

const assert = require('assert');
const { render, renderInline, safeHref } = require('../media/markdown');
const { parseSessionText } = require('../src/parser');
const { sessionToMarkdown } = require('../src/markdownExport');

const fence = '```';
const sample = [
  '# 标题 **粗体**',
  '',
  '普通 **加粗**、`内联代码`、[链接](https://example.com/a?b=1&c=2) 与 https://x.com/y。',
  '',
  '- 项目一',
  '  - 嵌套项',
  '- [x] 已完成',
  '',
  `${fence}js`,
  'const ok = 1 < 2 && 3 > 2;',
  `${fence}`,
  '',
  '| A | B |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '> 引用 **文本**',
  '',
  '---'
].join('\n');

const html = render(sample);
assert.ok(html.includes('<h1>标题 <strong>粗体</strong></h1>'), 'heading');
assert.ok(html.includes('data-href="https://example.com/a?b=1&amp;c=2"'), 'link url escaped');
assert.ok(html.includes('href="#" data-href="https://x.com/y"'), 'bare url autolinked');
assert.ok(html.includes('<div class="code-block">'), 'fenced code block');
assert.ok(html.includes('const ok = 1 &lt; 2 &amp;&amp; 3 &gt; 2;'), 'code escaped');
assert.ok(html.includes('<ul><li>项目一<ul><li>嵌套项</li></ul></li>'), 'nested list');
assert.ok(html.includes('<span class="task">☑</span> 已完成'), 'task list');
assert.ok(html.includes('<table><thead><tr><th>A</th><th>B</th></tr>'), 'table');
assert.ok(html.includes('<blockquote><p>引用 <strong>文本</strong></p></blockquote>'), 'blockquote');
assert.ok(html.includes('<hr>'), 'horizontal rule');

const unsafe = render('[x](javascript:alert(1)) <img src=x onerror=alert(1)> ![](javascript:alert(1))');
assert.ok(!unsafe.includes('<script'), 'script escaped');
assert.ok(!unsafe.includes('<img'), 'unsafe image dropped');
assert.ok(!/href="javascript:/i.test(unsafe), 'javascript link blocked');
assert.strictEqual(safeHref('javascript:alert(1)'), '', 'safeHref blocks javascript');
assert.strictEqual(safeHref('D:\\demo\\a.cs'), 'D:\\demo\\a.cs', 'safeHref allows windows path');
assert.ok(renderInline('**a** `b`').includes('<strong>a</strong> <code>b</code>'), 'inline basics');

const parsed = parseSessionText(
  [
    JSON.stringify({
      timestamp: '2026-11-20T07:00:00.000Z',
      type: 'session_meta',
      payload: { id: 'sid', cwd: 'D:\\demo', timestamp: '2026-11-20T07:00:00.000Z' }
    }),
    JSON.stringify({
      timestamp: '2026-11-20T07:00:01.000Z',
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '你好' }] }
    }),
    JSON.stringify({
      timestamp: '2026-11-20T07:00:02.000Z',
      type: 'response_item',
      payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '你好！' }] }
    })
  ].join('\n'),
  { title: '导出测试', path: 'D:\\demo\\rollout.jsonl' }
);
const markdown = sessionToMarkdown(parsed);
assert.ok(markdown.startsWith('# 导出测试'), 'export title');
assert.ok(markdown.includes('## 你'), 'export user heading');
assert.ok(markdown.includes('你好！'), 'export assistant text');

console.log('renderer: ok');
