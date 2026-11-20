'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildCodexDeepLink,
  buildResumeCommand,
  codexExtensionHome,
  codexHomeFromSessionPath,
  findCodexExecutable,
  isSessionInExtensionHome,
  runCodex
} = require('../src/codexCli');

function withTempHome(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `codex-cli-${name}-`));
}

async function main() {
  const home = 'C:\\Users\\demo';
  const sessionPath = path.join(
    home,
    '.codex',
    'sessions',
    '2026',
    '11',
    '20',
    'rollout-2026-11-20T10-00-00-01a1f452-6bc3-7532-aebe-514e5e5b004f.jsonl'
  );
  assert.strictEqual(codexHomeFromSessionPath(sessionPath), path.join(home, '.codex'), 'session home');
  assert.ok(isSessionInExtensionHome(sessionPath, home), 'default home is visible to extension');
  assert.ok(
    !isSessionInExtensionHome(
      path.join(home, 'friendbuddy', 'sessions', 'rollout-2026-11-20T10-00-00-x.jsonl'),
      home
    ),
    'custom home is not visible to extension'
  );
  assert.strictEqual(codexExtensionHome(home), path.join(home, '.codex'), 'extension home');

  const deepLink = buildCodexDeepLink('01a1f452-6bc3-7532-aebe-514e5e5b004f');
  assert.strictEqual(
    deepLink,
    'vscode://openai.chatgpt/local/01a1f452-6bc3-7532-aebe-514e5e5b004f',
    'deep link route'
  );

  const resume = buildResumeCommand('C:\\tools\\codex.exe', '01a1f452');
  assert.ok(resume.includes('resume'), 'resume command includes subcommand');
  assert.ok(resume.includes('01a1f452'), 'resume command includes session id');
  assert.ok(resume.includes('--all'), 'resume command includes --all');

  const tempHome = withTempHome('extensions');
  const extensions = path.join(tempHome, '.vscode', 'extensions');
  const binary = process.platform === 'win32' ? 'codex.exe' : 'codex';
  const oldDir = path.join(extensions, 'openai.chatgpt-1.2.3-win32-x64', 'bin', 'windows-x86_64');
  const newDir = path.join(extensions, 'openai.chatgpt-26.1117.31558-win32-x64', 'bin', 'windows-x86_64');
  fs.mkdirSync(oldDir, { recursive: true });
  fs.mkdirSync(newDir, { recursive: true });
  fs.writeFileSync(path.join(oldDir, binary), '');
  fs.writeFileSync(path.join(newDir, binary), '');
  const discovered = findCodexExecutable({ homeDir: tempHome, pathEnv: '' });
  assert.strictEqual(discovered.path, path.join(newDir, binary), 'newest extension binary wins');
  assert.strictEqual(discovered.source, 'extension', 'extension source');

  const configured = path.join(tempHome, 'custom-codex', binary);
  fs.mkdirSync(path.dirname(configured), { recursive: true });
  fs.writeFileSync(configured, '');
  const fromConfig = findCodexExecutable({ configured, homeDir: tempHome, pathEnv: '' });
  assert.strictEqual(fromConfig.path, configured, 'configured path wins');
  assert.strictEqual(fromConfig.source, 'config', 'config source');
  assert.strictEqual(
    findCodexExecutable({ configured: path.join(tempHome, 'missing.exe'), homeDir: tempHome, pathEnv: '' }),
    null,
    'missing configured path is reported'
  );

  const probeHome = path.join(tempHome, 'probe-home');
  const probe = await runCodex(
    process.execPath,
    ['-e', 'console.log(process.env.CODEX_HOME || "none")'],
    { codexHome: probeHome }
  );
  assert.strictEqual(probe.code, 0, 'probe exits cleanly');
  assert.strictEqual(probe.stdout, probeHome, 'CODEX_HOME forwarded');

  await assert.rejects(
    runCodex(process.execPath, ['-e', 'process.exit(3)']),
    /退出码 3/,
    'nonzero exit rejected'
  );

  const resolvedTemp = path.resolve(tempHome);
  if (resolvedTemp.startsWith(path.resolve(os.tmpdir()))) {
    fs.rmSync(resolvedTemp, { recursive: true, force: true });
  }

  console.log('codexCli: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
