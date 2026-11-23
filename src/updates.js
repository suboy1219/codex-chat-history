'use strict';

const https = require('https');

const PROJECT_URL = 'https://github.com/suboy1219/codex-chat-history';
const WEBSITE_URL = 'https://suboy1219.github.io/suboy';
const LATEST_RELEASE_API = 'https://api.github.com/repos/suboy1219/codex-chat-history/releases/latest';

function parseVersion(value) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[\da-z.-]+)?$/i.exec(String(value).trim());
  if (!match) throw new Error('无法识别发布版本号。');
  return match.slice(1, 4).map(Number);
}

function releaseResult(release, currentVersion) {
  if (!release || typeof release !== 'object' || Array.isArray(release)) {
    throw new Error('更新信息为空或格式无效。');
  }
  if (release.draft || release.prerelease) return null;
  const tag = String(release.tag_name || '').trim();
  const latest = parseVersion(tag);
  const current = parseVersion(currentVersion);
  let comparison = 0;
  for (let i = 0; i < 3; i += 1) {
    if (latest[i] !== current[i]) {
      comparison = latest[i] > current[i] ? 1 : -1;
      break;
    }
  }
  return {
    currentVersion,
    tag,
    isUpdateAvailable: comparison > 0,
    releaseUrl: `${PROJECT_URL}/releases/tag/${encodeURIComponent(tag)}`
  };
}

function checkForUpdates(currentVersion, get = https.get) {
  return new Promise((resolve, reject) => {
    const request = get(LATEST_RELEASE_API, {
      headers: {
        'User-Agent': `Codex-History-Lens/${currentVersion}`,
        Accept: 'application/vnd.github+json'
      }
    }, (response) => {
      response.on('error', reject);
      if (response.statusCode === 404) {
        response.resume();
        resolve(null);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`GitHub HTTP ${response.statusCode}`));
        return;
      }
      response.setEncoding('utf8');
      let body = '';
      response.on('data', (chunk) => {
        body += chunk;
        if (body.length > 1024 * 1024) request.destroy(new Error('更新信息过大。'));
      });
      response.on('end', () => {
        try {
          resolve(releaseResult(JSON.parse(body), currentVersion));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('error', reject);
    const timer = setTimeout(() => request.destroy(new Error('检测更新超时。')), 10000);
    request.once('close', () => clearTimeout(timer));
  });
}

module.exports = { PROJECT_URL, WEBSITE_URL, checkForUpdates, releaseResult };
