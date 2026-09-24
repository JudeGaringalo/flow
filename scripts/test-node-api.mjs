// Route tests with an isolated Supabase mock. Run live SQL/hardware checks separately.
import ts from 'typescript';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const expectedSecret = 's'.repeat(40);
const deviceToken = 'a'.repeat(64);
const reading = {
  device_id: 'FLOW-TEST-001',
  message_id: '12345678-1234-4123-8123-123456789abc',
  probes: [true, true, false]
};
let count = 0;
async function test(name, run) { await run(); console.log('PASS', name); count++; }

function harness({ env = {}, results = [] } = {}) {
  const calls = [], cache = new Map(), queue = [...results];
  const db = {
    rpc: (name, args) => {
      calls.push({ name, args });
      assert.equal(name, queue[0]?.name, 'Unexpected database function');
      const next = queue.shift();
      return Promise.resolve(next.result);
    }
  };
  const environment = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.test',
    SUPABASE_SECRET_KEY: 'server-only-key',
    FLOW_INSTALLER_SECRET: expectedSecret,
    ...env
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
      if (name === 'node:crypto') return crypto;
      if (name === '@supabase/supabase-js') return { createClient: () => db };
      if (name.startsWith('@/')) return load(path.resolve(name.slice(2)));
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name));
      throw new Error(`Unexpected import: ${name}`);
    };
    vm.runInNewContext(source, {
      module, exports: module.exports, require, process: { env: environment },
      console: { error() {} }, Buffer, TextDecoder, Uint8Array,
      Request, Response, Headers, AbortSignal, URL, fetch
    }, { filename: file });
    return module.exports;
  }
  const request = (endpoint, body, headers = {}) => new Request(`http://localhost/api/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  return { load, request, calls };
}
const result = (name, data, error = null) => ({ name, result: { data, error } });

await test('Registration is closed without the private installer secret', async () => {
  const h = harness();
  const res = await h.load('app/api/register-node/route.ts').POST(h.request('register-node', {}));
  assert.equal(res.status, 401);
  assert.equal(h.calls.length, 0);
  const notConfigured = harness({ env: { FLOW_INSTALLER_SECRET: '' } });
  const disabled = await notConfigured.load('app/api/register-node/route.ts')
    .POST(notConfigured.request('register-node', {}));
  assert.equal(disabled.status, 503);
});

await test('Registration stores a hash, returning the raw device token only once', async () => {
  const h = harness({ results: [result('flow_write_node', { id: reading.device_id })] });
  const res = await h.load('app/api/register-node/route.ts').POST(h.request('register-node', {
    action: 'create', id: reading.device_id, name: 'Test', area: 'Test', latitude: 14.5, longitude: 121
  }, { 'x-flow-installer-secret': expectedSecret }));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.match(data.device_token, /^[a-f0-9]{64}$/);
  assert.equal(h.calls[0].args.p_token_hash,
    crypto.createHash('sha256').update(data.device_token).digest('hex'));
});

await test('Missing or invalid device token never reaches the database', async () => {
  const h = harness();
  const route = h.load('app/api/ingest-reading/route.ts');
  assert.equal((await route.POST(h.request('ingest-reading', reading))).status, 401);
  assert.equal((await route.POST(h.request('ingest-reading', reading, {
    'x-device-token': 'wrong'
  }))).status, 401);
  assert.equal(h.calls.length, 0);
});

await test('A valid device report verifies its hash inside the one-table transaction', async () => {
  const h = harness({ results: [result('flow_accept_reading', {
    accepted: true, changed: true, level: 2
  })] });
  const res = await h.load('app/api/ingest-reading/route.ts').POST(h.request('ingest-reading',
    reading, { 'x-device-token': deviceToken }));
  assert.equal(res.status, 200);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].args.p_token_hash,
    crypto.createHash('sha256').update(deviceToken).digest('hex'));
  assert.equal(h.calls[0].args.p_probes[1], true);
});

await test('A database-denied device is returned as unauthorized', async () => {
  const h = harness({ results: [result('flow_accept_reading', null, { code: '42501' })] });
  const res = await h.load('app/api/ingest-reading/route.ts').POST(h.request('ingest-reading',
    reading, { 'x-device-token': deviceToken }));
  assert.equal(res.status, 401);
});

await test('Inconsistent probes are passed through for sensor fault classification', async () => {
  const h = harness({ results: [result('flow_accept_reading', { accepted: true, quality: 'fault' })] });
  const res = await h.load('app/api/ingest-reading/route.ts').POST(h.request('ingest-reading',
    { ...reading, probes: [false, true, false] }, { 'x-device-token': deviceToken }));
  assert.equal(res.status, 200);
  assert.equal(h.calls[0].args.p_probes[0], false);
});

console.log(`\n${count} one-table API checks passed. Live Supabase was not contacted.`);
