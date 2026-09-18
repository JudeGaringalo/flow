// Isolated API/validation tests. External SDKs and network calls are mocked.
// This is NOT a live Supabase, Gemini, Web Push or Next.js deployment test.
import ts from 'typescript';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

let count = 0;

async function test(name, run) {
  await run();
  console.log('PASS', name);
  count++;
}

const ok = data => ({
  data,
  error: null
});

const URL = 'http://localhost:3000';

const token = 'a'.repeat(64);

const validBody = {
  device_id: 'FLOW-TEST-001',
  message_id: '12345678-1234-4123-8123-123456789abc',
  probes: [true, true, false]
};

const user = { id: 'user-123' };

const vapid = {
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'public-key',
  VAPID_PRIVATE_KEY: 'private-key',
  VAPID_SUBJECT: 'mailto:ops@example.test'
};

const node = () => ({
  id: 'FLOW-TEST-001',
  name: 'Test fixture (not a real place)',
  quality: 'valid',
  current_level: 2,
  state_version: 4,
  last_seen: new Date().toISOString(),
  is_public: true
});

const fixtureSubscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/unit-test-only',
  keys: {
    p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url'),
    auth: Buffer.alloc(16, 1).toString('base64url')
  }
};

function harness({ env = {}, steps = [], auth = ok({ user }), network } = {}) {
  const calls = [], scheduled = [], queue = [...steps], cache = new Map();
  let creations = 0;

  function resolve(name, details) {
    calls.push({
      name,
      details
    });
    const next = queue.shift();
    assert.ok(next, `Unexpected DB request: ${name}`);
    assert.equal(next.name, name);
    return Promise.resolve(next.result);
  }

  const db = {
    auth: {
      getUser: async (value) => {
        calls.push({
          name: 'auth',
          details: value
        });
        return auth;
      }
    },
    rpc: (name, details) => ({ then: (res, rej) => resolve('rpc:' + name, details).then(res, rej) }),
    from: name => {
      const ops = [];
      const builder = new Proxy({}, {
        get(_target, key) {
          if (key === 'then')
            return (res, rej) => resolve('from:' + name, ops).then(res, rej);

          return (...args) => {
            ops.push([key, ...args]);
            return builder;
          };
        }
      });
      return builder;
    },
  };
  const effectiveEnv = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://unit-test.supabase.co',
    SUPABASE_SECRET_KEY: 'server-test-key',
    ...env
  };
  const fetcher = network || (async () => {
    throw new Error('No test network permitted');
  });

  function load(relative) {
    let file = path.resolve(relative);
    if (!path.extname(file))
      file += '.ts';

    if (cache.has(file))
      return cache.get(file).exports;

    const mod = { exports: {} };
    cache.set(file, mod);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      fileName: file,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true
      }
    }).outputText;
    const require = spec => {
      if (spec === 'server-only')
        return {};

      if (spec === 'node:crypto')
        return crypto;

      if (spec === '@supabase/supabase-js')
        return {
          createClient: (...args) => {
            creations++;
            calls.push({
              name: 'createClient',
              details: args
            });
            return db;
          }
        };

      if (spec === 'next/server')
        return { after: task => scheduled.push(task) };

      if (spec === 'web-push')
        return {
          generateRequestDetails: (sub, payload) => ({
            endpoint: sub.endpoint,
            method: 'POST',
            headers: { 'content-type': 'application/octet-stream' },
            body: Buffer.from(payload)
          })
        };

      if (spec.startsWith('@/'))
        return load(path.resolve(spec.slice(2)));

      if (spec.startsWith('.'))
        return load(path.resolve(path.dirname(file), spec));

      throw new Error(`Unexpected import ${spec}`);
    };
    const context = vm.createContext(
      {
        module: mod,
        exports: mod.exports,
        require,
        process: { env: effectiveEnv },
        console: {
          error() { },
          warn() { }
        },
        Buffer,
        TextEncoder,
        TextDecoder,
        Uint8Array,
        ArrayBuffer,
        URL: globalThis.URL,
        Request,
        Response,
        Headers,
        AbortSignal,
        setTimeout,
        clearTimeout,
        fetch: fetcher
      }
    );
    new vm.Script(code, { filename: file }).runInContext(context);
    return mod.exports;
  }

  const request = (endpoint, body, headers = {}) => new Request(URL + '/api/' + endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers
    },
    body: JSON.stringify(body)
  });
  return {
    load,
    request,
    calls,
    scheduled,
    queue,
    get creations() {
      return creations;
    }
  };
}

const step = (name, data) => ({
  name,
  result: ok(data)
});

const credential = step('from:flow_device_keys', { node_id: validBody.device_id });

const rate = step('rpc:flow_take_limit', true);

await test('Server modules import without backend credentials; client creation stays lazy', () => {
  const h = harness({
    env: {
      NEXT_PUBLIC_SUPABASE_URL: '',
      SUPABASE_SECRET_KEY: ''
    }
  });
  const r = h.load('lib/server/runtime.ts');
  assert.equal(h.creations, 0);
  assert.throws(() => r.getServerDb(), e => e.status === 503);
});

await test('Server client uses private credentials without persistent auth sessions', () => {
  const h = harness();
  const r = h.load('lib/server/runtime.ts');
  r.getServerDb();
  r.getServerDb();
  assert.equal(h.creations, 1);
  assert.equal(h.calls[0].details[1], 'server-test-key');
  assert.equal(h.calls[0].details[2].auth.persistSession, false);
});

await test('Device tokens are random 256-bit values; only hashes belong in DB', () => {
  const r = harness().load('lib/server/runtime.ts'),
    a = r.newDeviceToken(),
    b = r.newDeviceToken();
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.notEqual(a, b);
  assert.equal(r.hashToken(a), crypto.createHash('sha256').update(a).digest('hex'));
});

await test('Worker secret comparison handles equal/unequal/empty values', () => {
  const r = harness().load('lib/server/runtime.ts');
  assert.equal(r.equalSecret('x', 'x'), true);
  assert.equal(r.equalSecret('x', 'y'), false);
  assert.equal(r.equalSecret('', ''), false);
});

await test('Browser origin mismatch is rejected; same origin and hardware allowed', () => {
  const r = harness().load('lib/server/runtime.ts');
  r.checkOrigin(new Request(URL));
  r.checkOrigin(new Request(URL, { headers: { origin: URL } }));
  assert.throws(
    () => r.checkOrigin(new Request(URL, { headers: { origin: 'https://evil.example' } })),
    e => e.status === 403
  );
});

await test('JSON parser rejects arrays, null, text and oversized bodies', async () => {
  const h = harness(), r = h.load('lib/server/runtime.ts');
  for (const value of [
    null,
    []
  ])
    await assert.rejects(() => r.readJson(h.request('x', value)), e => e.status === 400);

  await assert.rejects(
    () => r.readJson(new Request(URL, {
      method: 'POST',
      body: 'hello'
    })),
    e => e.status === 415
  );
  await assert.rejects(
    () => r.readJson(h.request('x', { large: 'x'.repeat(9000) })),
    e => e.status === 413
  );
});

await test('JSON parser accepts a valid object', async () => {
  const h = harness();
  const data = await h.load('lib/server/runtime.ts').readJson(h.request('x', { a: 1 }));
  assert.equal(data.a, 1);
});

await test(
  'Telemetry validator accepts booleans but not strings, NaN RSSI or malformed UUID',
  () => {
    const r = harness().load('lib/server/validation.ts');
    assert.equal(r.readingBody(validBody).device_id, validBody.device_id);
    for (const body of [
      {
        ...validBody,
        probes: ['true', false, false]
      },
      {
        ...validBody,
        rssi: NaN
      },
      {
        ...validBody,
        message_id: '-'.repeat(36)
      }
    ])
      assert.throws(() => r.readingBody(body), e => e.status === 400);
  }
);

await test(
  'Inconsistent physical probe combinations reach the server fault classifier unchanged',
  () => {
    const r = harness().load('lib/server/validation.ts');
    assert.equal(r.readingBody({
      ...validBody,
      probes: [false, true, false]
    }).probes[1], true);
  }
);

await test(
  'Freshness rejects invalid dates, stale/future readings and impossible numeric levels',
  () => {
    const r = harness().load('lib/server/runtime.ts');
    for (const change of [
      { last_seen: 'invalid' },
      { last_seen: null },
      { last_seen: new Date(Date.now() - 121000).toISOString() },
      { last_seen: new Date(Date.now() + 60000).toISOString() },
      { current_level: 4 },
      { current_level: 1.5 }
    ])
      assert.equal(r.condition({
        ...node(),
        ...change
      }), 'Data unavailable');

    assert.equal(r.condition({
      ...node(),
      quality: 'fault'
    }), 'Check sensor');
    assert.equal(r.condition(node()), 'Flood Watch');
  }
);

await test('Registration validates coordinates and rotation has no required name', () => {
  const r = harness().load('lib/server/validation.ts');
  assert.equal(r.nodeBody({
    action: 'rotate',
    id: 'FLOW-001'
  }).action, 'rotate');
  assert.throws(
    () => r.nodeBody({
      id: 'FLOW-001',
      action: 'create',
      name: 'Test',
      latitude: 91,
      longitude: 121
    }),
    e => e.status === 400
  );
});

await test(
  'Push endpoint validation blocks SSRF, deceptive suffixes, credentials and HTTP',
  () => {
    const r = harness().load('lib/server/validation.ts');
    assert.equal(r.allowedPushEndpoint(fixtureSubscription.endpoint), true);
    for (const url of [
      'http://fcm.googleapis.com/a',
      'https://127.0.0.1/a',
      'https://[::1]/',
      'https://fcm.googleapis.com.evil.example/a',
      'https://user:pass@fcm.googleapis.com/a',
      'https://fcm.googleapis.com:8443/a',
      'https://fcm.googleapis.com/a#x'
    ])
      assert.equal(r.allowedPushEndpoint(url), false);
  }
);

await test('Subscription key sizes and encoding are checked', () => {
  const r = harness().load('lib/server/validation.ts');
  assert.equal(r.subscriptionBody(fixtureSubscription).endpoint, fixtureSubscription.endpoint);
  assert.throws(
    () => r.subscriptionBody({
      ...fixtureSubscription,
      keys: {
        p256dh: 'bad',
        auth: 'bad'
      }
    }),
    e => e.status === 400
  );
});

await test('Ingestion rejects a missing token before a database connection', async () => {
  const h = harness();
  const res = await h.load('app/api/ingest-reading/route.ts').POST(h.request('ingest-reading', validBody));
  assert.equal(res.status, 401);
  assert.equal(h.creations, 0);
});

await test('Ingestion rejects an unknown device secret', async () => {
  const h = harness({ steps: [step('from:flow_device_keys', null)] });
  const res = await h.load('app/api/ingest-reading/route.ts')
    .POST(h.request('ingest-reading', validBody, { 'x-device-token': token }));
  assert.equal(res.status, 401);
});

await test('Ingestion rate limits authenticated devices before writing', async () => {
  const h = harness({ steps: [credential, step('rpc:flow_take_limit', false)] });
  const res = await h.load('app/api/ingest-reading/route.ts')
    .POST(h.request('ingest-reading', validBody, { 'x-device-token': token }));
  assert.equal(res.status, 429);
  assert.equal(h.queue.length, 0);
});

await test(
  'Valid ingestion keeps the existing RPC contract and does not send coordinates or raw token',
  async () => {
    const h = harness(
      {
        steps: [credential, rate, step('rpc:flow_accept_reading', {
          accepted: true,
          changed: true,
          level: 2
        })]
      }
    );
    const res = await h.load('app/api/ingest-reading/route.ts')
      .POST(
        h.request('ingest-reading', {
          ...validBody,
          latitude: 99,
          level: 4
        }, { 'x-device-token': token })
      );
    assert.equal(res.status, 200);
    assert.equal((await res.json()).level, 2);
    const call = h.calls.find(c => c.name === 'rpc:flow_accept_reading');
    assert.equal(call.details.p_node_id, validBody.device_id);
    assert.equal('latitude' in call.details, false);
    assert.equal(JSON.stringify(call.details).includes(token), false);
    assert.equal(h.scheduled.length, 0);
  }
);

await test('Push work is scheduled after a committed change, not on every heartbeat', async () => {
  for (const changed of [true, false]) {
    const h = harness(
      {
        env: vapid,
        steps: [credential, rate, step('rpc:flow_accept_reading', {
          accepted: true,
          changed
        })]
      }
    );
    const res = await h.load('app/api/ingest-reading/route.ts')
      .POST(h.request('ingest-reading', validBody, { 'x-device-token': token }));
    assert.equal(res.status, 200);
    assert.equal(h.scheduled.length, changed ? 1 : 0);
  }
});

await test('Backend errors do not expose database internals', async () => {
  const h = harness(
    {
      steps: [
        {
          name: 'from:flow_device_keys',
          result: {
            data: null,
            error: { message: 'secret internal database detail' }
          }
        }
      ]
    }
  );
  const res = await h.load('app/api/ingest-reading/route.ts')
    .POST(h.request('ingest-reading', validBody, { 'x-device-token': token }));
  assert.equal(res.status, 500);
  assert.equal((await res.text()).includes('secret internal'), false);
});

await test('Registration requires a verified user and installer membership', async () => {
  let h = harness();
  let res = await h.load('app/api/register-node/route.ts').POST(h.request('register-node', {}));
  assert.equal(res.status, 401);
  h = harness({ steps: [step('from:flow_admins', null)] });
  res = await h.load('app/api/register-node/route.ts')
    .POST(
      h.request('register-node', {}, { authorization: 'Bearer verified-token' })
    );
  assert.equal(res.status, 403);
});

await test('Registration writes a hash atomically and returns the token once', async () => {
  const h = harness(
    {
      steps: [
        step('from:flow_admins', { user_id: user.id }),
        rate,
        step('rpc:flow_write_node', { id: 'FLOW-001' })
      ]
    }
  );
  const res = await h.load('app/api/register-node/route.ts')
    .POST(
      h.request(
        'register-node',
        {
          id: 'FLOW-001',
          action: 'create',
          name: 'Node',
          latitude: 14,
          longitude: 121
        },
        { authorization: 'Bearer verified-token' }
      )
    );
  assert.equal(res.status, 200);
  const b = await res.json();
  assert.match(b.device_token, /^[a-f0-9]{64}$/);
  const call = h.calls.find(c => c.name === 'rpc:flow_write_node');
  assert.equal(
    call.details.p_token_hash,
    crypto.createHash('sha256').update(b.device_token).digest('hex')
  );
});

await test('Push subscription uses verified user ID, not a browser-supplied owner', async () => {
  const h = harness({ steps: [rate, step('rpc:flow_store_subscription', true)] });
  const res = await h.load('app/api/manage-push/route.ts')
    .POST(
      h.request(
        'manage-push',
        {
          action: 'subscribe',
          user_id: 'attacker',
          subscription: fixtureSubscription
        },
        { authorization: 'Bearer token' }
      )
    );
  assert.equal(res.status, 200);
  assert.equal(
    h.calls.find(c => c.name === 'rpc:flow_store_subscription').details.p_user_id,
    user.id
  );
});

await test('Push unsubscribe is scoped to the authenticated owner', async () => {
  const h = harness({ steps: [rate, step('from:flow_push_subscriptions', null)] });
  const res = await h.load('app/api/manage-push/route.ts')
    .POST(
      h.request(
        'manage-push',
        {
          action: 'unsubscribe',
          endpoint: fixtureSubscription.endpoint
        },
        { authorization: 'Bearer token' }
      )
    );
  assert.equal(res.status, 200);
  assert.ok(
    h.calls.find(c => c.name === 'from:flow_push_subscriptions').details.some(op => op[0] === 'eq' && op[1] === 'user_id' && op[2] === user.id)
  );
});

await test('Worker endpoint requires a nonempty strong secret', async () => {
  for (const env of [
    {},
    { PUSH_WORKER_SECRET: 'weak' }
  ]) {
    const h = harness({ env });
    const res = await h.load('app/api/push-dispatch/route.ts').POST(h.request('push-dispatch', {}));
    assert.equal(res.status, 401);
    assert.equal(h.creations, 0);
  }
});

await test('Worker without VAPID does not claim pending jobs', async () => {
  const h = harness({ env: { PUSH_WORKER_SECRET: token } });
  const res = await h.load('app/api/push-dispatch/route.ts')
    .POST(h.request('push-dispatch', {}, { 'x-worker-secret': token }));
  assert.equal(res.status, 503);
  assert.equal(h.creations, 0);
});

await test('Worker handles an empty real queue', async () => {
  const h = harness(
    {
      env: {
        ...vapid,
        PUSH_WORKER_SECRET: token
      },
      steps: [step('rpc:flow_claim_push_jobs', [])]
    }
  );
  const res = await h.load('app/api/push-dispatch/route.ts')
    .POST(h.request('push-dispatch', {}, { 'x-worker-secret': token }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).claimed, 0);
});

await test('AI endpoint requires authentication', async () => {
  const h = harness();
  const res = await h.load('app/api/flow-intelligence/route.ts')
    .POST(h.request('flow-intelligence', { node_id: 'FLOW-001' }));
  assert.equal(res.status, 401);
});

await test('Unavailable sensor returns a labeled fallback without Gemini', async () => {
  const h = harness({
    steps: [step('from:flow_nodes', {
      ...node(),
      last_seen: null
    })]
  });
  const res = await h.load('app/api/flow-intelligence/route.ts')
    .POST(
      h.request('flow-intelligence', { node_id: validBody.device_id }, { authorization: 'Bearer token' })
    );
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.provider, 'fallback');
  assert.match(data.summary, /no fresh observation/);
  assert.equal(h.queue.length, 0);
});

function aiSteps(n) {
  return [
    step('from:flow_nodes', n),
    step('from:flow_events', []),
    step('rpc:flow_nearby', []),
    step('from:flow_ai_cache', null),
    rate
  ];
}

await test('AI without a configured model summarizes evidence, never invents predictions', async () => {
  const n = node(),
    h = harness(
      { steps: [...aiSteps(n), step('from:flow_nodes', n), step('from:flow_ai_cache', null)] }
    );
  const res = await h.load('app/api/flow-intelligence/route.ts')
    .POST(
      h.request('flow-intelligence', { node_id: n.id }, { authorization: 'Bearer token' })
    );
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.provider, 'fallback');
  assert.match(data.summary, /Flood Watch/);
  assert.doesNotMatch(data.summary, /will recede|safe route|rainfall/);
  assert.equal(h.queue.length, 0);
});

await test('AI discards an answer when its sensor version changes', async () => {
  const n = node(),
    h = harness({
      steps: [...aiSteps(n), step('from:flow_nodes', {
        ...n,
        state_version: 5
      })]
    });
  const res = await h.load('app/api/flow-intelligence/route.ts')
    .POST(
      h.request('flow-intelligence', { node_id: n.id }, { authorization: 'Bearer token' })
    );
  assert.equal(res.status, 409);
  assert.equal(h.queue.length, 0);
});

await test('Unrecognized Gemini fact IDs fall back to approved sentences', async () => {
  const n = node(),
    h = harness(
      {
        env: {
          GEMINI_API_KEY: 'key',
          GEMINI_MODEL: 'test-model'
        },
        steps: [...aiSteps(n), rate, step('from:flow_nodes', n), step('from:flow_ai_cache', null)],
        network: async () => Response.json(
          {
            candidates: [
              {
                content: {
                  parts: [
                    { text: JSON.stringify({ fact_ids: ['fake_safe_route'] }) }
                  ]
                }
              }
            ]
          }
        )
      }
    );
  const res = await h.load('app/api/flow-intelligence/route.ts')
    .POST(
      h.request('flow-intelligence', { node_id: n.id }, { authorization: 'Bearer token' })
    );
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.provider, 'fallback');
  assert.match(data.summary, /Flood Watch/);
});

await test('Valid Gemini fact IDs retain independently generated current status', async () => {
  const n = node(),
    h = harness(
      {
        env: {
          GEMINI_API_KEY: 'key',
          GEMINI_MODEL: 'test-model'
        },
        steps: [...aiSteps(n), rate, step('from:flow_nodes', n), step('from:flow_ai_cache', null)],
        network: async () => Response.json(
          {
            candidates: [
              {
                content: {
                  parts: [
                    { text: JSON.stringify({ fact_ids: ['limitation'] }) }
                  ]
                }
              }
            ]
          }
        )
      }
    );
  const res = await h.load('app/api/flow-intelligence/route.ts')
    .POST(
      h.request('flow-intelligence', { node_id: n.id }, { authorization: 'Bearer token' })
    );
  const data = await res.json();
  assert.equal(data.provider, 'gemini');
  assert.match(data.summary, /^This monitoring point is reporting Flood Watch/);
  assert.match(data.summary, /between monitoring points/);
});

const job = {
  id: 'job-test',
  event_id: 'event-test',
  subscription_id: 'subscription-test',
  attempts: 1
};

const pushFixture = () => {
  const n = node();
  return {
    n,
    event: {
      id: job.event_id,
      node_id: n.id,
      level: 2,
      source_version: n.state_version,
      recorded_at: new Date().toISOString()
    },
    sub: {
      id: job.subscription_id,
      user_id: user.id,
      endpoint: fixtureSubscription.endpoint,
      p256dh: fixtureSubscription.keys.p256dh,
      auth_key: fixtureSubscription.keys.auth
    }
  };
};

await test('Push worker sends an eligible queued event and marks the claimed attempt sent', async () => {
  const { n, event, sub } = pushFixture();
  let pushed;
  const h = harness(
    {
      env: vapid,
      steps: [
        step('rpc:flow_claim_push_jobs', [job]),
        step('from:flow_events', event),
        step('from:flow_push_subscriptions', sub),
        step('from:flow_nodes', n),
        step('from:flow_follows', { min_level: 2 }),
        step('from:flow_push_jobs', null)
      ],
      network: async (url, init) => {
        pushed = {
          url,
          init
        };
        return new Response(null, { status: 201 });
      }
    }
  );
  const result = await h.load('lib/server/push.ts').dispatchPushJobs();
  assert.equal(result.sent, 1);
  assert.equal(pushed.init.redirect, 'error');
  assert.ok(pushed.init.body instanceof ArrayBuffer);
  assert.ok(
    h.calls.find(c => c.name === 'from:flow_push_jobs').details.some(op => op[0] === 'eq' && op[1] === 'attempts' && op[2] === 1)
  );
  assert.equal(h.queue.length, 0);
});

await test('Push worker skips a superseded/stale event without contacting provider', async () => {
  const { n, event, sub } = pushFixture();
  n.state_version = 5;
  const h = harness(
    {
      env: vapid,
      steps: [
        step('rpc:flow_claim_push_jobs', [job]),
        step('from:flow_events', event),
        step('from:flow_push_subscriptions', sub),
        step('from:flow_nodes', n),
        step('from:flow_follows', { min_level: 2 }),
        step('from:flow_push_jobs', null)
      ]
    }
  );
  const result = await h.load('lib/server/push.ts').dispatchPushJobs();
  assert.equal(result.skipped, 1);
  assert.equal(result.sent, 0);
  assert.equal(h.queue.length, 0);
});

await test('Push worker removes an expired browser endpoint', async () => {
  const { n, event, sub } = pushFixture();
  const h = harness(
    {
      env: vapid,
      steps: [
        step('rpc:flow_claim_push_jobs', [job]),
        step('from:flow_events', event),
        step('from:flow_push_subscriptions', sub),
        step('from:flow_nodes', n),
        step('from:flow_follows', { min_level: 2 }),
        step('from:flow_push_subscriptions', null)
      ],
      network: async () => new Response(null, { status: 410 })
    }
  );
  const result = await h.load('lib/server/push.ts').dispatchPushJobs();
  assert.equal(result.skipped, 1);
  assert.equal(h.queue.length, 0);
});

await test('Push provider errors return work to the durable retry queue', async () => {
  const { n, event, sub } = pushFixture();
  const h = harness(
    {
      env: vapid,
      steps: [
        step('rpc:flow_claim_push_jobs', [job]),
        step('from:flow_events', event),
        step('from:flow_push_subscriptions', sub),
        step('from:flow_nodes', n),
        step('from:flow_follows', { min_level: 2 }),
        step('from:flow_push_jobs', null)
      ],
      network: async () => new Response(null, { status: 503 })
    }
  );
  const result = await h.load('lib/server/push.ts').dispatchPushJobs();
  assert.equal(result.retried, 1);
  const updates = h.calls.find(c => c.name === 'from:flow_push_jobs').details.find(op => op[0] === 'update')[1];
  assert.equal(updates.state, 'pending');
  assert.equal(updates.leased_until, null);
});

await test('All five endpoints explicitly use Node.js and keep caching disabled', () => {
  for (const name of ['ingest-reading', 'register-node', 'flow-intelligence', 'manage-push', 'push-dispatch']) {
    const text = fs.readFileSync(`app/api/${name}/route.ts`, 'utf8');
    assert.match(text, /runtime = 'nodejs'/);
    assert.match(text, /dynamic = 'force-dynamic'/);
  }
});

await test('Frontend calls same-origin API endpoints; no functions.invoke remains', () => {
  const text = fs.readFileSync('lib/supabase.ts', 'utf8');
  assert.match(text, /fetch\(`\/api\/\$\{name\}`/);
  assert.doesNotMatch(text, /\.functions\.invoke/);
  assert.match(text, /Bearer \$\{session.access_token\}/);
});

await test('Deno source/config removed while database migrations remain', () => {
  assert.equal(fs.existsSync('supabase/functions'), false);
  assert.equal(fs.existsSync('supabase/config.toml'), false);
  assert.equal(fs.existsSync('supabase/migrations/001_flow.sql'), true);
  assert.equal(fs.existsSync('supabase/migrations/002_node_api.sql'), true);
});

await test('Retry schedule points at Next.js, not old Edge Functions', () => {
  const text = fs.readFileSync('supabase/schedule-push.sql', 'utf8');
  assert.match(text, /\/api\/push-dispatch/);
  assert.doesNotMatch(text, /\/functions\/v1\//);
  assert.match(text, /flow_app_origin/);
});

console.log(
  `\n${count} isolated Node.js API/regression checks passed. External services were mocked.`
);
