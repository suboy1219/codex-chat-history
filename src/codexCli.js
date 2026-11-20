'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const CODEX_EXTENSION_ID = 'openai.chatgpt';
const EXTENSION_NAME_PATTERN = /^openai\.chatgpt-(\d+(?:\.\d+)*)/i;

function normalizePath(value) {
  return path.resolve(String(value || '')).replace(/[\\/]+$/, '').toLowerCase();
}

function codexHomeFromSessionPath(filePath) {
  const resolved = path.resolve(String(filePath || ''));
  const lower = resolved.toLowerCase();
  let cut = -1;
  for (const marker of [`${path.sep}sessions${path.sep}`, `${path.sep}archived_sessions${path.sep}`]) {
    const at = lower.lastIndexOf(marker.toLowerCase());
    if (at > cut) {
      cut = at;
    }
  }
  return cut > 0 ? resolved.slice(0, cut) : '';
}

function codexExtensionHome(homeDir) {
  return path.join(homeDir || os.homedir(), '.codex');
}

// The VS Code extension runs its own app-server against ~/.codex. Sessions stored
// in a different CODEX_HOME are visible here but cannot be deep-linked there.
function isSessionInExtensionHome(filePath, homeDir) {
  const home = codexHomeFromSessionPath(filePath);
  return Boolean(home) && normalizePath(home) === normalizePath(codexExtensionHome(homeDir));
}

function buildCodexDeepLink(sessionId) {
  return `vscode://${CODEX_EXTENSION_ID}/local/${encodeURIComponent(sessionId)}`;
}

function quoteCommandArg(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function buildResumeCommand(executable, sessionId) {
  const command = `${quoteCommandArg(executable)} resume ${quoteCommandArg(sessionId)} --all`;
  return process.platform === 'win32' ? `& ${command}` : command;
}

function compareVersions(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

function executableNames() {
  return process.platform === 'win32' ? ['codex.exe'] : ['codex'];
}

function findInPath(envPath) {
  const dirs = String(envPath || '')
    .split(path.delimiter)
    .filter(Boolean);
  for (const dir of dirs) {
    for (const name of executableNames()) {
      const candidate = path.join(dir, name);
      try {
        if (fs.statSync(candidate).isFile()) {
          return candidate;
        }
      } catch (error) {
        // Keep looking.
      }
    }
  }
  return null;
}

function collectBinaries(root, output) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (error) {
    return;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      collectBinaries(full, output);
    } else if (entry.isFile() && executableNames().includes(entry.name.toLowerCase())) {
      output.push(full);
    }
  }
}

function findInExtensions(homeDir) {
  const roots = [
    path.join(homeDir, '.vscode', 'extensions'),
    path.join(homeDir, '.vscode-insiders', 'extensions'),
    path.join(homeDir, '.cursor', 'extensions')
  ];
  const candidates = [];
  for (const root of roots) {
    let entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch (error) {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.toLowerCase().startsWith('openai.chatgpt-')) {
        continue;
      }
      const match = EXTENSION_NAME_PATTERN.exec(entry.name);
      const version = match ? match[1] : '0';
      const bin = path.join(root, entry.name, 'bin');
      const found = [];
      collectBinaries(bin, found);
      for (const file of found) {
        let mtimeMs = 0;
        try {
          mtimeMs = fs.statSync(file).mtimeMs;
        } catch (error) {
          // Ignore stat failures.
        }
        candidates.push({ file, version, mtimeMs });
      }
    }
  }
  candidates.sort((a, b) => compareVersions(b.version, a.version) || b.mtimeMs - a.mtimeMs);
  return candidates.length ? candidates[0].file : null;
}

function findCodexExecutable(options) {
  const opts = options || {};
  const homeDir = opts.homeDir || os.homedir();
  if (opts.configured) {
    const configured = path.resolve(String(opts.configured).replace(/^~(?=$|[\\/])/, homeDir));
    try {
      if (fs.statSync(configured).isFile()) {
        return { path: configured, source: 'config' };
      }
    } catch (error) {
      return null;
    }
  }
  const fromPath = findInPath(opts.pathEnv === undefined ? process.env.PATH : opts.pathEnv);
  if (fromPath) {
    return { path: fromPath, source: 'path' };
  }
  const fromExtension = findInExtensions(homeDir);
  if (fromExtension) {
    return { path: fromExtension, source: 'extension' };
  }
  return null;
}

function stripAnsi(value) {
  return String(value || '').replace(/\u001b\[[0-9;]*m/g, '');
}

function runCodex(executable, args, options) {
  const opts = options || {};
  const timeoutMs = opts.timeoutMs || 20000;
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    if (opts.codexHome) {
      env.CODEX_HOME = opts.codexHome;
    }
    let child;
    try {
      child = spawn(executable, args, {
        cwd: opts.cwd || undefined,
        env,
        windowsHide: true
      });
    } catch (error) {
      reject(error);
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        child.kill();
      } catch (error) {
        // Ignore kill failures.
      }
      reject(new Error(`codex ${args.join(' ')} 超时（${Math.round(timeoutMs / 1000)} 秒）。`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      const result = {
        code: code === null ? -1 : code,
        stdout: stripAnsi(stdout).trim(),
        stderr: stripAnsi(stderr).trim()
      };
      if (result.code === 0) {
        resolve(result);
      } else {
        const detail = result.stderr || result.stdout || `退出码 ${result.code}`;
        reject(new Error(detail));
      }
    });
  });
}

async function unarchiveSession(executable, session) {
  const codexHome = codexHomeFromSessionPath(session.path);
  return runCodex(executable, ['unarchive', session.id], {
    codexHome: codexHome || undefined,
    cwd: session.cwd || undefined
  });
}

module.exports = {
  CODEX_EXTENSION_ID,
  buildCodexDeepLink,
  buildResumeCommand,
  codexExtensionHome,
  codexHomeFromSessionPath,
  findCodexExecutable,
  isSessionInExtensionHome,
  runCodex,
  unarchiveSession
};
