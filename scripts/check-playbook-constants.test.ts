/**
 * Tests for check-playbook-constants.ts.
 *
 *   node --experimental-strip-types --test scripts/check-playbook-constants.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkMarkers,
  evalIntExpr,
  extractConstants,
  extractMarkers,
  loadContractConstants,
} from './check-playbook-constants.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('evalIntExpr handles separators, products and suffixes', () => {
  assert.equal(evalIntExpr('259_200'), '259200');
  assert.equal(evalIntExpr('3 * 24 * 60 * 60'), '259200');
  assert.equal(evalIntExpr('7 * 24 * 60 * 60'), '604800');
  assert.equal(evalIntExpr('5000'), '5000');
  assert.equal(evalIntExpr('1_000_u64'), '1000');
});

test('evalIntExpr rejects non-integer expressions', () => {
  assert.equal(evalIntExpr('HALF_TOKEN'), null);
  assert.equal(evalIntExpr('"1.0.0"'), null);
  assert.equal(evalIntExpr('1 + 2'), null);
});

test('extractConstants reads pub and private consts', () => {
  const src = `
    pub const A: u32 = 1_000;
    const B: u64 = 3 * 24 * 60 * 60; // 3 days
    const C: &str = "x";
  `;
  const c = extractConstants(src);
  assert.equal(c.get('A'), '1000');
  assert.equal(c.get('B'), '259200');
  assert.equal(c.has('C'), false);
});

test('extractMarkers reports names, values and line numbers', () => {
  const md = 'intro\n| x | <!-- const:FOO=12 --> `FOO` |\n';
  assert.deepEqual(extractMarkers(md), [{ name: 'FOO', value: '12', line: 2 }]);
});

test('checkMarkers flags stale, missing and ambiguous markers', () => {
  const files = new Map([
    ['a.rs', new Map([['OK', '1'], ['STALE', '2'], ['DUP', '1']])],
    ['b.rs', new Map([['DUP', '9']])],
  ]);
  const result = checkMarkers(
    [
      { name: 'OK', value: '1', line: 1 },
      { name: 'STALE', value: '3', line: 2 },
      { name: 'GONE', value: '1', line: 3 },
      { name: 'DUP', value: '1', line: 4 },
    ],
    files,
  );
  assert.deepEqual(
    result.map((m) => [m.name, m.reason]),
    [
      ['STALE', 'stale'],
      ['GONE', 'missing'],
      ['DUP', 'ambiguous'],
    ],
  );
});

test('the published playbook matches the contract sources', () => {
  const playbook = readFileSync(join(root, 'docs/governance-operations-playbook.md'), 'utf8');
  const markers = extractMarkers(playbook);
  assert.ok(markers.length >= 15, `expected many markers, found ${markers.length}`);
  const mismatches = checkMarkers(markers, loadContractConstants(join(root, 'contracts')));
  assert.deepEqual(mismatches, []);
});
