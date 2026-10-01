import ts from 'typescript';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

function harness(reading) {
  const sent = [], deleted = [], cache = new Map();
  const near = { endpoint: 'https://fcm.googleapis.com/fcm/send/near', p256dh: 'near-key',
    auth_key: 'near-auth', latitude: 14.6, longitude: 121 };
  const far = { ...near, endpoint: 'https://fcm.googleapis.com/fcm/send/far', latitude: 15.2 };
  const db = {
    rpc: async name => {
      assert.equal(name, 'flow_claim_rising_alert');
      return { data: reading, error: null };
    },
    from: table => {
      assert.equal(table, 'flow_push_subscriptions');
      const query = {
        select: () => query, gte: () => query, lte: () => query, order: () => query,
        range: async () => ({ data: [near, far], error: null }),
        delete: () => query, eq: () => query,
        then: resolve => { deleted.push(table); resolve({ error: null }); }
      };
      return query;
    }
  };
  const webpush = {
    setVapidDetails() {},
    sendNotification: async (subscription, payload) => {
      sent.push({ subscription, payload: JSON.parse(payload) });
    }
  };
  function load(relative) {
    let file = path.resolve(relative);
    if (!path.extname(file)) file += '.ts';
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      fileName: file,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
    }).outputText;
    const require = name => {
      if (name === 'server-only') return {};
      if (name === 'web-push') return webpush;
      if (name === 'node:crypto') return crypto;
      if (name === '@supabase/supabase-js') return { createClient: () => db };
      if (name.startsWith('@/')) return load(path.resolve(name.slice(2)));
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name));
      throw new Error('Unexpected import: ' + name);
    };
    vm.runInNewContext(source, {
      module, exports: module.exports, require, process: { env: {
        NEXT_PUBLIC_SUPABASE_URL: 'https://example.test',
        SUPABASE_SECRET_KEY: 'secret',
        NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'public',
        VAPID_PRIVATE_KEY: 'private',
        VAPID_SUBJECT: 'mailto:test@example.test'
      } },
      console, Buffer, TextDecoder, Uint8Array, AbortSignal, fetch
    }, { filename: file });
    return module.exports;
  }
  return { sent, deleted, dispatch: load('lib/server/push.ts').dispatchNearbyAlerts };
}

const reading = {
  id: 'FLOW-001', name: 'Campus', latitude: 14.6, longitude: 121, level: 1
};
const one = harness(reading);
await one.dispatch('FLOW-001', 'message-id');
assert.equal(one.sent.length, 1);
assert.equal(one.sent[0].payload.level, 1);
assert.equal(one.sent[0].subscription.endpoint.includes('/near'), true);
const unchanged = harness(null);
await unchanged.dispatch('FLOW-001', 'message-id');
assert.equal(unchanged.sent.length, 0);
console.log('PASS background push sends only to nearby subscriptions after an atomic rising claim');
