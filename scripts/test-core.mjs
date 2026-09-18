import ts from 'typescript';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Test the SAME TypeScript sensor logic that the React application imports.
const text = await readFile(new URL('../lib/core.ts', import.meta.url), 'utf8');

const compiled = ts.transpileModule(text, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;

const C = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));

let count = 0;

function test(name, run) {
  run();
  count++;
  console.log('PASS', name);
}

const now = Date.now();

const base = {
  id: 'FLOW-TEST',
  name: 'Test location',
  area: 'Test',
  latitude: 14.5,
  longitude: 121,
  probes: [false, false, false],
  current_level: 0,
  quality: 'valid',
  last_seen: new Date(now).toISOString(),
  state_version: 1,
  is_public: true
};

for (let mask = 0; mask < 8; mask++)
  test('Probe mask ' + mask, () => {
    const p = [!!(mask & 1), !!(mask & 2), !!(mask & 4)];
    assert.equal(C.levelFromProbes(p), ({
      0: 0,
      1: 1,
      3: 2,
      7: 3
    })[mask] ?? null);
  });

test('Malformed probes rejected', () => {
  for (const p of [
    null,
    [],
    [true, true],
    [1, 1, 1],
    ['true', false, false]
  ])
    assert.equal(C.levelFromProbes(p), null);
});

test('Fresh below-threshold state', () => assert.equal(C.nodeStatus(base, now).key, 'below'));

test(
  'Fresh highest valid threshold',
  () => assert.equal(C.nodeStatus({
    ...base,
    probes: [true, true, true]
  }, now).level, 3)
);

test(
  'Stale reading is unavailable',
  () => assert.equal(
    C.nodeStatus({
      ...base,
      last_seen: new Date(now - 121000).toISOString()
    }, now).key,
    'unavailable'
  )
);

test(
  'Future timestamp is unavailable',
  () => assert.equal(
    C.nodeStatus({
      ...base,
      last_seen: new Date(now + 40000).toISOString()
    }, now).key,
    'unavailable'
  )
);

test(
  'No initial reading is unavailable',
  () => assert.equal(C.nodeStatus({
    ...base,
    last_seen: null
  }, now).key, 'unavailable')
);

test(
  'Disconnected browser cannot confirm current status',
  () => assert.equal(C.nodeStatus(base, now, true).key, 'unavailable')
);

test(
  'Impossible readings are sensor faults',
  () => assert.equal(C.nodeStatus({
    ...base,
    probes: [false, false, true]
  }, now).key, 'fault')
);

test(
  'Critical is NEVER live telemetry',
  () => assert.equal(
    C.nodeStatus({
      ...base,
      probes: [true, true, true],
      _designLevel: 4
    }, now, false, true).level,
    3
  )
);

test(
  'Legacy design flags cannot fabricate a fourth level',
  () => assert.equal(
    C.nodeStatus(
      {
        ...base,
        demo: true,
        probes: [true, true, true],
        _designLevel: 4
      },
      now,
      false,
      true
    ).level,
    3
  )
);

test(
  'Stale design example is not Critical',
  () => assert.equal(
    C.nodeStatus({
      ...base,
      demo: true,
      _designLevel: 4,
      last_seen: null
    }, now, false, true).key,
    'unavailable'
  )
);

test(
  'Notification on valid upward crossing',
  () => assert.equal(C.shouldAlert(base, {
    ...base,
    probes: [true, true, false]
  }, 2, now), true)
);

test(
  'No notification on heartbeat',
  () => assert.equal(C.shouldAlert(base, base, 1, now), false)
);

test(
  'No notification on downward crossing',
  () => assert.equal(
    C.shouldAlert(
      {
        ...base,
        probes: [true, true, true]
      },
      {
        ...base,
        probes: [true, false, false]
      },
      1,
      now
    ),
    false
  )
);

test(
  'No notification for a fault',
  () => assert.equal(C.shouldAlert(base, {
    ...base,
    probes: [false, true, false]
  }, 1, now), false)
);

test('CSV prevents formula execution', () => assert.equal(C.csvCell('=SUM(A1)'), `"'=SUM(A1)"`));

test(
  'CSV quotes commas and quotation marks',
  () => assert.equal(C.csvCell('"x",y'), '"""x"",y"')
);

test('Distance is zero at same point', () => assert.equal(C.distance(base, base), 0));

test('Distance is symmetric', () => {
  const b = {
    latitude: 14.6,
    longitude: 121.1
  };
  assert.ok(Math.abs(C.distance(base, b) - C.distance(b, base)) < .001);
});

test(
  'Missing-data summary does not imply low water',
  () => assert.match(
    C.summaryFor({
      ...base,
      last_seen: null
    }, [], [], now),
    /Missing data does not mean low water/
  )
);

test(
  'Normal summary does not claim safe road',
  () => assert.match(C.summaryFor(base, [], [], now), /road passability are not established/)
);

test('Missing probes cannot become valid dry data', () => {
  const n = C.normalizeNode({
    ...base,
    probes: null
  });
  assert.equal(n.quality, 'unknown');
  assert.equal(C.nodeStatus(n, now).key, 'fault');
});

test('Absent timestamp cannot be auto-generated', () => {
  const n = C.normalizeNode({
    ...base,
    last_seen: undefined
  });
  assert.equal(n.last_seen, null);
  assert.equal(C.nodeStatus(n, now).key, 'unavailable');
});

test('Normalization strips old demo fields', () => {
  const n = C.normalizeNode({
    ...base,
    demo: true,
    _designLevel: 4,
    _offline: false
  });
  assert.equal('demo' in n, false);
  assert.equal('_designLevel' in n, false);
});

console.log(`\n${count} deterministic core tests passed.`);
