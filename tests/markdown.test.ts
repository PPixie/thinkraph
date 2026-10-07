import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownContent } from '../src/components/MarkdownContent';
import { AssistantMessage } from '../src/components/AssistantMessage';
import { conversationMessages } from '../src/state/conversation';
import type { Message } from '../shared/schemas';

const render = (content: string, streaming = false) => renderToStaticMarkup(createElement(MarkdownContent, { content, streaming }));
const message: Message = { id: 'reply-1', role: 'assistant', content: '### 执行模型\n\n**Driver** 调度 `Task`。', createdAt: new Date().toISOString(), sourceIds: [], status: 'complete' };

test('assistant renders headings, Chinese emphasis, nested lists, tables, links, code and math', () => {
  const html = render('### 执行模型\n\n**重点：**理解 `Task`。\n\n> 先理解，再实践。\n\n1. Driver\n   - Executor\n\n- [x] 完成\n\n| 组件 | 职责 |\n|---|---|\n| Driver | 调度 |\n\n```python\nprint("Spark")\n```\n\n公式：$x^2$\n\n[参考](https://example.com)');
  for (const pattern of [/<h3[^>]*>执行模型<\/h3>/, /<strong>重点：<\/strong>/, /<blockquote/, /<ol/, /<ul/, /type="checkbox"/, /<table>/, /<th/, /<td/, /data-streamdown="inline-code"/, /data-streamdown="code-block"/, /复制代码/, /class="katex"/, /rel="noopener noreferrer"/]) assert.match(html, pattern);
});

test('incomplete emphasis and code fences keep semantic formatting, including stopped replies', () => {
  assert.match(render('**尚未结束', true), /<strong>尚未结束<\/strong>/);
  const partial = '### 示例\n\n```python\nprint(1)';
  const live = render(partial, true), stopped = render(partial, false);
  for (const html of [live, stopped]) {
    assert.match(html, /data-streamdown="code-block"/);
    assert.match(html, /print\(1\)/);
    assert.doesNotMatch(html, /```/);
  }
  assert.match(live, /disabled=""/);
  assert.doesNotMatch(stopped, /disabled=""/);
});

test('streaming and completed text use identical Markdown DOM and message identity', () => {
  assert.equal(render(message.content, true), render(message.content, false));
  const callbacks = { onSave() {}, onExpand() {}, onSources() {} };
  for (const streaming of [true, false]) {
    const html = renderToStaticMarkup(createElement(AssistantMessage, { message, streaming, ...callbacks }));
    assert.match(html, /class="assistant-message" data-message-id="reply-1"/);
    assert.match(html, /class="[^"]*\bassistant-markdown\b/);
    assert.doesNotMatch(html, /stream-answer|answer-text/);
  }
});

test('Markdown sanitization blocks scripts, handlers and unsafe link protocols', () => {
  const html = render('<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n\n[点击](javascript:alert%281%29)\n\n<iframe src="https://example.com"></iframe>');
  assert.doesNotMatch(html, /<script|<iframe|onerror=|href="javascript:/i);
});

test('saving a streamed reply replaces its draft exactly once and stays in its node', () => {
  const pending = { graphId: 'graph', nodeId: 'node', messageId: message.id, requestId: 'request', createdAt: message.createdAt };
  const live = conversationMessages([], pending, message.content, true, 'graph', 'node');
  assert.equal(live.length, 1); assert.equal(live[0].id, message.id); assert.equal(live[0].streaming, true);
  const saving = conversationMessages([message], pending, message.content, true, 'graph', 'node');
  assert.deepEqual(saving, [message]);
  assert.deepEqual(conversationMessages([], pending, message.content, true, 'other', 'node'), []);
  assert.deepEqual(conversationMessages([], pending, message.content, true, 'graph', 'other'), []);
  assert.deepEqual(conversationMessages([], pending, '', false, 'graph', 'node'), []);
  assert.equal(conversationMessages([], pending, '', true, 'graph', 'node')[0].content, '');
});
