'use strict';

const vscode = require('vscode');

const STATE_KEY = 'codexHistory.followedSessions';
const URI_SCHEME = 'codex-history-session';
const COLOR_ID = 'codexHistory.followedForeground';

function sessionKey(session) {
  return session.id ? `id:${session.id}` : `path:${session.path}`;
}

class FollowedSessions {
  constructor(globalState) {
    this.globalState = globalState;
    this.keys = new Set(globalState.get(STATE_KEY, []));
    this.pending = Promise.resolve();
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeFileDecorations = this.emitter.event;
  }

  has(session) {
    return this.keys.has(sessionKey(session));
  }

  uri(session) {
    return vscode.Uri.from({ scheme: URI_SCHEME, path: `/${sessionKey(session)}` });
  }

  set(session, followed) {
    const operation = this.pending.then(async () => {
      const keys = new Set(this.keys);
      if (followed) {
        keys.add(sessionKey(session));
      } else {
        keys.delete(sessionKey(session));
      }
      await this.globalState.update(STATE_KEY, Array.from(keys));
      this.keys = keys;
      this.emitter.fire();
    });
    this.pending = operation.catch(() => {});
    return operation;
  }

  provideFileDecoration(uri) {
    if (uri.scheme !== URI_SCHEME || !this.keys.has(uri.path.slice(1))) {
      return undefined;
    }
    return { color: new vscode.ThemeColor(COLOR_ID), tooltip: '已关注' };
  }

  dispose() {
    this.emitter.dispose();
  }
}

module.exports = { FollowedSessions, COLOR_ID };
