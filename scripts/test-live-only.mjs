import ts from 'typescript';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

let count = 0;

function test(name, run) {
  run();
  count++;
  console.log('PASS', name);
}

const source = fs.readFileSync('lib/config.ts', 'utf8');

const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS
  }
}).outputText;

function configFor(env) {
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    process: { env }
  });
  return exports.config;
}

test(
  'Default configuration has no sensor connection',
  () => assert.equal(configFor({}).configured, false)
);

test(
  'Old demo mode is ignored',
  () => assert.equal(configFor({ NEXT_PUBLIC_FLOW_MODE: 'demo' }).mode, 'live')
);

test(
  'Old illustrative map option is ignored',
  () => assert.equal(configFor({ NEXT_PUBLIC_FLOW_MAP_MODE: 'illustrative' }).mapMode, 'geographic')
);

test('Both Supabase values are needed', () => {
  assert.equal(
    configFor({ NEXT_PUBLIC_SUPABASE_URL: 'https://project.example' }).configured,
    false
  );
  assert.equal(
    configFor(
      {
        NEXT_PUBLIC_SUPABASE_URL: 'https://project.example',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-key'
      }
    ).configured,
    true
  );
});

test('Demo seed file is absent', () => assert.equal(fs.existsSync('lib/demo.ts'), false));

test(
  'Illustrative map directory is absent',
  () => assert.equal(fs.existsSync('public/maps'), false)
);

const hook = fs.readFileSync('hooks/use-flow.tsx', 'utf8');

test('Node state starts empty', () => assert.match(hook, /useState<FlowNode\[\]>\(\[\]\)/));

test(
  'No browser-made last_seen timestamp',
  () => assert.doesNotMatch(hook, /last_seen\s*:\s*new Date/)
);

test('No seed import', () => assert.doesNotMatch(hook, /createDemo|from ['"]@\/lib\/demo/));

test(
  'Old observation cache is not restored',
  () => assert.doesNotMatch(hook, /cache\.nodes|setNodes\(cache/)
);

const dialogs = fs.readFileSync('components/flow/dialogs.tsx', 'utf8');

test(
  'Demo controls are not available',
  () => assert.doesNotMatch(dialogs, /DemoControls|Demo controls|Reference design cards/)
);

const cssConfig = fs.readFileSync('postcss.config.mjs', 'utf8');

test(
  'No Tailwind plugin required',
  () => assert.doesNotMatch(cssConfig, /@tailwindcss\/postcss/)
);

console.log(`\n${count} live-only regression checks passed.`);
