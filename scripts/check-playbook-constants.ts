#!/usr/bin/env node
/**
 * check-playbook-constants.ts — keeps docs/governance-operations-playbook.md
 * honest about contract constants.
 *
 * The playbook tags every constant-backed number with a marker:
 *
 *     <!-- const:NAME=VALUE -->
 *
 * This script finds `NAME` in the Rust contract sources, evaluates its value
 * (integer literals with `_` separators and `*` products only) and reports any
 * marker whose VALUE differs, whose NAME cannot be found, or which is
 * ambiguous (same name, different values, in more than one source file).
 *
 * Usage:
 *   node --experimental-strip-types scripts/check-playbook-constants.ts
 *
 * Exit code 1 when any marker is stale.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Marker {
  name: string;
  value: string;
  line: number;
}

export interface Mismatch {
  name: string;
  line: number;
  reason: 'missing' | 'ambiguous' | 'stale';
  documented: string;
  actual?: string[];
}

const MARKER_RE = /<!--\s*const:([A-Z][A-Z0-9_]*)=([^\s>]+)\s*-->/g;
const CONST_RE = /^\s*(?:pub\s+)?const\s+([A-Z][A-Z0-9_]*)\s*:\s*[A-Za-z0-9_&']+\s*=\s*([^;]+);/gm;

export function extractMarkers(markdown: string): Marker[] {
  const markers: Marker[] = [];
  const lines = markdown.split('\n');
  lines.forEach((text, i) => {
    for (const m of text.matchAll(MARKER_RE)) {
      markers.push({ name: m[1], value: m[2], line: i + 1 });
    }
  });
  return markers;
}

/** Evaluate `1_000`, `3 * 24 * 60 * 60`, `17_280`. Returns null for anything else. */
export function evalIntExpr(expr: string): string | null {
  const cleaned = expr.replace(/\/\/.*$/gm, '').trim();
  if (!/^[0-9_]+(\s*\*\s*[0-9_]+)*(_?[iu](8|16|32|64|128))?$/.test(cleaned)) return null;
  const withoutSuffix = cleaned.replace(/_?[iu](8|16|32|64|128)$/, '');
  let product = 1n;
  for (const factor of withoutSuffix.split('*')) {
    product *= BigInt(factor.replace(/_/g, '').trim());
  }
  return product.toString();
}

export function extractConstants(rustSource: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of rustSource.matchAll(CONST_RE)) {
    const value = evalIntExpr(m[2]);
    if (value !== null) out.set(m[1], value);
  }
  return out;
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'target' || entry === 'node_modules' || entry === 'test_snapshots') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (full.endsWith('.rs')) acc.push(full);
  }
  return acc;
}

export function checkMarkers(
  markers: Marker[],
  constantsByFile: Map<string, Map<string, string>>,
): Mismatch[] {
  const mismatches: Mismatch[] = [];
  for (const marker of markers) {
    const found = new Set<string>();
    for (const constants of constantsByFile.values()) {
      const v = constants.get(marker.name);
      if (v !== undefined) found.add(v);
    }
    if (found.size === 0) {
      mismatches.push({ name: marker.name, line: marker.line, reason: 'missing', documented: marker.value });
    } else if (found.size > 1) {
      mismatches.push({
        name: marker.name,
        line: marker.line,
        reason: 'ambiguous',
        documented: marker.value,
        actual: [...found],
      });
    } else if (!found.has(marker.value)) {
      mismatches.push({
        name: marker.name,
        line: marker.line,
        reason: 'stale',
        documented: marker.value,
        actual: [...found],
      });
    }
  }
  return mismatches;
}

export function loadContractConstants(contractsDir: string): Map<string, Map<string, string>> {
  const byFile = new Map<string, Map<string, string>>();
  // Only production sources: `contracts/<crate>/src/**`, never the top-level
  // integration tests or fuzz crates, which shadow constants with test values.
  const crateSrcDirs = readdirSync(contractsDir)
    .map((crate) => join(contractsDir, crate, 'src'))
    .filter((dir) => {
      try {
        return statSync(dir).isDirectory();
      } catch {
        return false;
      }
    });
  const files = crateSrcDirs
    .flatMap((dir) => walk(dir))
    .filter((f) => !/(^|[\\/])(tests?_|test\.rs|tests\.rs)|[\\/]tests?[\\/]/.test(f.slice(contractsDir.length)));
  for (const file of files) {
    const constants = extractConstants(readFileSync(file, 'utf8'));
    if (constants.size > 0) byFile.set(file, constants);
  }
  return byFile;
}

function main(): void {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const playbook = readFileSync(join(root, 'docs/governance-operations-playbook.md'), 'utf8');
  const markers = extractMarkers(playbook);
  const mismatches = checkMarkers(markers, loadContractConstants(join(root, 'contracts')));

  if (mismatches.length === 0) {
    console.log(`playbook constants OK (${markers.length} markers)`);
    return;
  }
  for (const m of mismatches) {
    const actual = m.actual ? ` actual=${m.actual.join('|')}` : '';
    console.error(`docs/governance-operations-playbook.md:${m.line} ${m.name} ${m.reason} documented=${m.documented}${actual}`);
  }
  process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
