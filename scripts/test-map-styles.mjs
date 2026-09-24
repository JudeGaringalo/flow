import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync('lib/map-styles.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const output = { exports: {} };
vm.runInNewContext(compiled, {
  exports: output.exports,
  module: output,
  structuredClone,
  AbortSignal,
  fetch: () => { throw new Error('These tests must not request external tiles.'); },
});
const { composeBasemap, isBasemap } = output.exports;
const sample = {
  version: 8,
  sources: { openmaptiles: { type: 'vector', url: 'https://example.invalid/tiles' } },
  glyphs: 'https://example.invalid/fonts/{fontstack}/{range}.pbf',
  sprite: 'https://example.invalid/sprite',
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#eee' } },
    { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water' },
    { id: 'roads', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation' },
    { id: 'roads-label', type: 'symbol', source: 'openmaptiles', 'source-layer': 'transportation_name',
      minzoom: 12, layout: { 'text-field': ['get', 'name'], 'text-size': 13 } },
    { id: 'city-label', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place',
      layout: { 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']] } },
  ],
};
let count = 0;
const test = (label, run) => { run(); count++; console.log('PASS', label); };
const original = JSON.stringify(sample);

for (const mode of ['standard', 'satellite']) {
  const style = composeBasemap(sample, mode);
  test(`${mode} retains the same road-name expression and placement`, () => {
    const label = style.layers.find((layer) => layer.id === 'roads-label');
    assert.deepEqual(label.layout, sample.layers[3].layout);
    assert.equal(label.minzoom, 12);
    assert.equal(label.source, 'openmaptiles');
  });
  test(`${mode} keeps labels above base imagery`, () => {
    const labelIndex = style.layers.findIndex((layer) => layer.type === 'symbol');
    const baseIndex = style.layers.findIndex((layer) => layer.type === 'raster');
    assert.ok(baseIndex < labelIndex);
  });
  test(`${mode} has unique layer IDs`, () => {
    assert.equal(new Set(style.layers.map((layer) => layer.id)).size, style.layers.length);
  });
}
test('Composing styles does not mutate the provider style', () => assert.equal(JSON.stringify(sample), original));
test('Satellite includes imagery and vector labels, but not an opaque vector background', () => {
  const style = composeBasemap(sample, 'satellite');
  assert.equal(style.layers[0].type, 'raster');
  assert.ok(style.layers.some((layer) => layer.type === 'symbol'));
  assert.ok(!style.layers.some((layer) => ['background', 'fill'].includes(layer.type)));
});
test('Removed and invalid map names are rejected', () => {
  assert.equal(isBasemap('satellite'), true);
  for (const invalid of ['terrain', 'dark', 'legacy', 'prototype', null, {}, 42]) {
    assert.equal(isBasemap(invalid), false);
  }
});
test('Map code cannot create demo observations', () => {
  const map = fs.readFileSync('components/flow/map-canvas.tsx', 'utf8');
  assert.ok(map.includes('flow.visibleNodes'));
  assert.ok(!map.includes('seed('));
  assert.ok(!map.includes('_designLevel'));
});
test('Worker does not serve Next.js bundles from its cache', () => {
  const worker = fs.readFileSync('public/sw.js', 'utf8');
  assert.ok(worker.includes("u.pathname.startsWith('/_next/')"));
  assert.ok(!worker.includes("u.pathname.startsWith('/_next/static/')"));
});
console.log(`\n${count} map/UI source regression checks passed. No external services were contacted.`);
