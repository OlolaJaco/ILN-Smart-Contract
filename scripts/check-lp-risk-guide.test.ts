/**
 * Tests for docs/lp-risk-management-guide.md.
 *
 *   node --experimental-strip-types --test scripts/check-lp-risk-guide.test.ts
 *
 * Guards the things that rot silently: broken relative links, missing
 * cross-links from the docs the issue requires, and the break-even table.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docs = join(root, 'docs');
const guidePath = join(docs, 'lp-risk-management-guide.md');
const guide = readFileSync(guidePath, 'utf8');

function slugify(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[`*_]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');
}

function anchors(markdown: string): Set<string> {
  const out = new Set<string>();
  for (const m of markdown.matchAll(/^#{1,6}\s+(.+)$/gm)) out.add(slugify(m[1]));
  return out;
}

test('every relative link in the guide resolves to a file', () => {
  const broken: string[] = [];
  for (const m of guide.matchAll(/\]\(([^)#\s]+\.md)(#[^)]*)?\)/g)) {
    if (/^https?:/.test(m[1])) continue;
    if (!existsSync(resolve(docs, m[1]))) broken.push(m[1]);
  }
  assert.deepEqual(broken, []);
});

test('every in-page and cross-doc anchor exists', () => {
  const missing: string[] = [];
  for (const m of guide.matchAll(/\]\((?:([^)#\s]+\.md))?#([^)\s]+)\)/g)) {
    const target = m[1] ? readFileSync(resolve(docs, m[1]), 'utf8') : guide;
    if (!anchors(target).has(m[2])) missing.push(`${m[1] ?? '(self)'}#${m[2]}`);
  }
  assert.deepEqual(missing, []);
});

test('faq and SDK integration guide link to the guide (issue #893)', () => {
  for (const file of ['faq.md', 'sdk-integration.md']) {
    const text = readFileSync(join(docs, file), 'utf8');
    assert.ok(text.includes('lp-risk-management-guide.md'), `${file} must link to the guide`);
  }
});

test('the break-even table matches d = y / (1 + y)', () => {
  const rows = [...guide.matchAll(/^\|\s*(\d+)%\s*\|\s*([\d.]+)%\s*\|$/gm)];
  assert.ok(rows.length >= 5, 'expected the break-even rows');
  for (const [, yPct, dPct] of rows) {
    const y = Number(yPct) / 100;
    const expected = (y / (1 + y)) * 100;
    assert.equal(Number(dPct), Number(expected.toFixed(2)), `y=${yPct}%`);
  }
});

test('the loss-per-default table matches (1/N)/y cycles at y = 3%', () => {
  const rows = [...guide.matchAll(/^\|\s*(\d+)\s*\|\s*(\d+)%\s*\|\s*([\d.]+)\s*\|$/gm)];
  assert.ok(rows.length >= 4, 'expected the concentration rows');
  for (const [, n, lossPct, cycles] of rows) {
    assert.equal(Number(lossPct), 100 / Number(n));
    assert.equal(Number(cycles), Number(((1 / Number(n)) / 0.03).toFixed(1)));
  }
});
