'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');
const { parseSessionFile, readSessionHead, shortText } = require('./parser');

const SESSION_FILE_PATTERN = /^rollout-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(.+)\.jsonl$/;
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function walkJsonl(dir, archived, output) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkJsonl(full, archived, output);
    } else if (entry.isFile() && entry.name.endsWith('.jsonl') && entry.name.startsWith('rollout-')) {
      output.push({ path: full, archived });
    }
  }
}

function normalizePath(value) {
  return String(value || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

function isInside(child, parent) {
  const a = normalizePath(child);
  const b = normalizePath(parent);
  if (!a || !b) {
    return false;
  }
  return a === b || a.startsWith(`${b}\\`);
}

function sessionIdFromName(name) {
  const match = name.match(SESSION_FILE_PATTERN);
  if (match) {
    return match[7];
  }
  const uuid = name.match(UUID_PATTERN);
  return uuid ? uuid[0] : name.replace(/\.jsonl$/, '');
}

function formatTime(value) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toISOString();
}

class CodexStore {
  constructor(context) {
    this.context = context;
    this.index = new Map();
    this.headCache = new Map();
    this.sessionCache = new Map();
    this.indexMtime = 0;
    this.sessionsCache = null;
    this.sessionsCacheAt = 0;
  }

  get codexHome() {
    const configured = vscode.workspace.getConfiguration('codexHistory').get('codexHome', '');
    if (configured && String(configured).trim()) {
      return path.resolve(String(configured).replace(/^~(?=$|[\\/])/, os.homedir()));
    }
    if (process.env.CODEX_HOME) {
      return path.resolve(process.env.CODEX_HOME);
    }
    return path.join(os.homedir(), '.codex');
  }

  get sessionsDir() {
    return path.join(this.codexHome, 'sessions');
  }

  get archivedDir() {
    return path.join(this.codexHome, 'archived_sessions');
  }

  reset() {
    this.index.clear();
    this.headCache.clear();
    this.sessionCache.clear();
    this.indexMtime = 0;
    this.sessionsCache = null;
  }

  invalidate(filePath) {
    if (!filePath) {
      this.reset();
      return;
    }
    this.headCache.delete(filePath);
    this.sessionCache.delete(filePath);
    this.sessionsCache = null;
  }

  loadIndex() {
    const indexFile = path.join(this.codexHome, 'session_index.jsonl');
    let stat;
    try {
      stat = fs.statSync(indexFile);
    } catch (error) {
      return;
    }
    if (stat.mtimeMs === this.indexMtime && this.index.size) {
      return;
    }
    this.index.clear();
    let text = '';
    try {
      text = fs.readFileSync(indexFile, 'utf8');
    } catch (error) {
      return;
    }
    for (const line of text.split(/\r?\n/)) {
      if (!line) {
        continue;
      }
      try {
        const entry = JSON.parse(line);
        if (entry && entry.id) {
          this.index.set(entry.id, {
            title: entry.thread_name || '',
            updatedAt: entry.updated_at || ''
          });
        }
      } catch (error) {
        // Ignore malformed index lines.
      }
    }
    this.indexMtime = stat.mtimeMs;
  }

  getHead(filePath, stat) {
    const cached = this.headCache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return cached.head;
    }
    let head = { id: '', cwd: '', timestamp: '', title: '', model: '' };
    try {
      head = readSessionHead(filePath);
    } catch (error) {
      // Leave defaults when the file cannot be read.
    }
    this.headCache.set(filePath, { mtimeMs: stat.mtimeMs, head });
    return head;
  }

  scanSessions() {
    const files = [];
    walkJsonl(this.sessionsDir, false, files);
    if (vscode.workspace.getConfiguration('codexHistory').get('showArchived', false)) {
      walkJsonl(this.archivedDir, true, files);
    }
    this.loadIndex();
    const sessions = [];
    for (const file of files) {
      let stat;
      try {
        stat = fs.statSync(file.path);
      } catch (error) {
        continue;
      }
      const fileName = path.basename(file.path);
      const head = this.getHead(file.path, stat);
      const id = head.id || sessionIdFromName(fileName);
      const indexEntry = this.index.get(id);
      const title = (indexEntry && indexEntry.title) || head.title || `会话 ${fileName.slice(8, 27).replace(/T/, ' ')}`;
      sessions.push({
        id,
        title,
        cwd: head.cwd || '',
        model: head.model || '',
        timestamp: head.timestamp || '',
        updatedAt: formatTime(stat.mtime.toISOString()),
        mtimeMs: stat.mtimeMs,
        path: file.path,
        fileName,
        size: stat.size,
        archived: file.archived
      });
    }
    sessions.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return sessions;
  }

  listSessions(options) {
    const opts = options || {};
    const ttl = 1500;
    let all;
    if (this.sessionsCache && Date.now() - this.sessionsCacheAt < ttl && !opts.force) {
      all = this.sessionsCache;
    } else {
      all = this.scanSessions();
      this.sessionsCache = all;
      this.sessionsCacheAt = Date.now();
    }
    const query = String(opts.query || '').trim().toLowerCase();
    const roots = opts.workspaceOnly ? (vscode.workspace.workspaceFolders || []).map((folder) => folder.uri.fsPath) : [];
    let result = all;
    if (query) {
      result = result.filter((session) => {
        return (
          session.title.toLowerCase().includes(query) ||
          session.cwd.toLowerCase().includes(query) ||
          session.id.toLowerCase().includes(query)
        );
      });
    }
    if (roots.length) {
      result = result.filter((session) => session.cwd && roots.some((root) => isInside(session.cwd, root)));
    }
    const max = Number(opts.max || vscode.workspace.getConfiguration('codexHistory').get('maxSessions', 300)) || 300;
    return result.slice(0, max);
  }

  getSessionByPath(filePath) {
    const normalized = path.resolve(filePath);
    const sessions = this.listSessions({ force: true, max: 100000 });
    return sessions.find((session) => path.resolve(session.path) === normalized) || null;
  }

  read(session) {
    const cached = this.sessionCache.get(session.path);
    let stat;
    try {
      stat = fs.statSync(session.path);
    } catch (error) {
      throw new Error(`找不到会话文件：${session.path}`);
    }
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return cached.session;
    }
    const parsed = parseSessionFile(session.path, {
      title: session.title,
      archived: session.archived,
      updatedAt: session.updatedAt
    });
    if (parsed.meta.title === '未命名会话' && session.title) {
      parsed.meta.title = session.title;
    }
    this.sessionCache.set(session.path, { mtimeMs: stat.mtimeMs, session: parsed });
    if (this.sessionCache.size > 8) {
      const firstKey = this.sessionCache.keys().next().value;
      this.sessionCache.delete(firstKey);
    }
    return parsed;
  }

  async searchContent(query, options) {
    const opts = options || {};
    const needle = String(query || '').trim().toLowerCase();
    if (!needle) {
      return [];
    }
    const sessions = this.listSessions({ force: true, max: 100000 });
    const hits = [];
    const limit = opts.limit || 300;
    for (let i = 0; i < sessions.length; i += 1) {
      if (opts.token && opts.token.isCancellationRequested) {
        break;
      }
      if (opts.onProgress) {
        opts.onProgress(i, sessions.length, sessions[i]);
      }
      const session = sessions[i];
      let raw;
      try {
        raw = await fs.promises.readFile(session.path, 'utf8');
      } catch (error) {
        continue;
      }
      if (!raw.toLowerCase().includes(needle)) {
        if (i % 8 === 7) {
          await new Promise((resolve) => setImmediate(resolve));
        }
        continue;
      }
      let parsed;
      try {
        parsed = this.read(session);
      } catch (error) {
        continue;
      }
      let sessionHits = 0;
      for (let index = 0; index < parsed.items.length; index += 1) {
        const item = parsed.items[index];
        const haystack = `${item.text || ''}\n${item.name || ''}\n${item.input || ''}\n${item.output || ''}`;
        const at = haystack.toLowerCase().indexOf(needle);
        if (at < 0) {
          continue;
        }
        const start = Math.max(0, at - 50);
        hits.push({
          session,
          index,
          type: item.type,
          snippet: shortText(haystack.slice(start, at + needle.length + 90).replace(/\s+/g, ' '), 150)
        });
        sessionHits += 1;
        if (sessionHits >= 3 || hits.length >= limit) {
          break;
        }
      }
      if (hits.length >= limit) {
        break;
      }
      if (i % 8 === 7) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
    return hits;
  }
}

module.exports = { CodexStore, isInside, normalizePath };
