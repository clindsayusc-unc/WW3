/**
 * Validates every JSON file under data/: each must be an object with a
 * non-empty string "source" and an ISO-8601 date "asOf".
 * Usage: node --experimental-strip-types scripts/validate-data.ts
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface DataIssue {
  file: string;
  problem: string;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.json') ? [p] : [];
  });
}

export function validateDataDir(dir: string): DataIssue[] {
  const issues: DataIssue[] = [];
  for (const file of walk(dir)) {
    const rel = relative(process.cwd(), file);
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      issues.push({ file: rel, problem: `invalid JSON: ${(e as Error).message}` });
      continue;
    }
    if (typeof json !== 'object' || json === null || Array.isArray(json)) {
      issues.push({ file: rel, problem: 'top level must be an object' });
      continue;
    }
    const obj = json as Record<string, unknown>;
    if (typeof obj.source !== 'string' || obj.source.trim() === '')
      issues.push({ file: rel, problem: 'missing top-level "source"' });
    if (typeof obj.asOf !== 'string' || !/^\d{4}-\d{2}(-\d{2})?$/.test(obj.asOf))
      issues.push({
        file: rel,
        problem: 'missing/invalid top-level "asOf" (YYYY-MM or YYYY-MM-DD)',
      });
  }
  return issues;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const issues = validateDataDir(join(process.cwd(), 'data'));
  for (const i of issues) console.error(`${i.file}: ${i.problem}`);
  process.exit(issues.length ? 1 : 0);
}
