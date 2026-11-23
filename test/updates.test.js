'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');
const { checkForUpdates, releaseResult } = require('../src/updates');

function fakeGet(status, body, failure) {
  return (url, options, callback) => {
    assert.ok(url.endsWith('/codex-chat-history/releases/latest'));
    assert.strictEqual(options.headers['User-Agent'], 'Codex-History-Lens/1.2.1');
    const request = new EventEmitter();
    request.destroy = (error) => {
      request.emit('error', error);
      request.emit('close');
    };
    process.nextTick(() => {
      if (failure) return request.destroy(new Error(failure));
      const response = new EventEmitter();
      response.resume = () => {};
      response.setEncoding = () => {};
      response.statusCode = status;
      callback(response);
      response.emit('data', body);
      response.emit('end');
      request.emit('close');
    });
    return request;
  };
}

async function main() {
  for (const [tag, expected] of [['v1.2.2', true], ['1.10.0', true], ['2.0.0', true], ['v1.2.1', false], ['1.2.1+build.3', false], ['1.1.9', false]]) {
    assert.strictEqual(releaseResult({ tag_name: tag }, '1.2.1').isUpdateAvailable, expected, tag);
  }
  assert.strictEqual(releaseResult({ prerelease: true }, '1.2.1'), null);
  assert.strictEqual(releaseResult({ draft: true }, '1.2.1'), null);
  for (const tag of ['', 'latest', 'v1.3.0-beta.1']) {
    assert.throws(() => releaseResult({ tag_name: tag }, '1.2.1'));
  }
  assert.throws(() => releaseResult(null, '1.2.1'));
  const newer = await checkForUpdates('1.2.1', fakeGet(200, '{"tag_name":"v1.3.0","html_url":"https://untrusted.example"}'));
  assert.strictEqual(newer.releaseUrl, 'https://github.com/suboy1219/codex-chat-history/releases/tag/v1.3.0');
  assert.strictEqual(await checkForUpdates('1.2.1', fakeGet(404, '')), null);
  await assert.rejects(checkForUpdates('1.2.1', fakeGet(403, '')), /403/);
  await assert.rejects(checkForUpdates('1.2.1', fakeGet(500, '')), /500/);
  await assert.rejects(checkForUpdates('1.2.1', fakeGet(200, 'not json')));
  await assert.rejects(checkForUpdates('1.2.1', fakeGet(200, '', 'network unavailable')), /network unavailable/);
  console.log('updates: ok');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
