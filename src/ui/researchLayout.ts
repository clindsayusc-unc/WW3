/**
 * Layout of the research tree (D-079): era columns left to right, one horizontal band per branch.
 * Each technology sits in the first column of its era that lies right of all its prerequisites, so
 * every link runs left to right; techs sharing a branch and column stack in lanes.
 */
import type { TechMeta } from '../sim/world';

export const NODE_W = 184;
export const NODE_H = 54;
export const COL_W = 214;
export const LANE_H = 62;
export const BRANCH_GAP = 14;
export const GUTTER = 168;
export const HEADER = 54;

export interface TreeLayout {
  readonly pos: ReadonlyMap<string, { x: number; y: number; col: number; lane: number }>;
  readonly eras: readonly { era: number; x0: number; x1: number }[];
  readonly branches: readonly { id: string; y0: number; y1: number }[];
  readonly width: number;
  readonly height: number;
}

export function layoutTree(techs: readonly TechMeta[], branchIds: readonly string[]): TreeLayout {
  const byId = new Map(techs.map((t) => [t.id, t]));
  const col = new Map<string, number>();
  const eraIds = [...new Set(techs.map((t) => t.era))].sort((a, b) => a - b);
  const eras: { era: number; x0: number; x1: number }[] = [];
  let start = 0;
  for (const era of eraIds) {
    const inEra = techs.filter((t) => t.era === era);
    // Longest path inside the era; prerequisites from earlier eras sit left of `start` already.
    const colOf = (t: TechMeta, depth = 0): number => {
      const known = col.get(t.id);
      if (known !== undefined) return known;
      if (depth > techs.length) throw new Error(`Cycle at ${t.id}`);
      let c = start;
      for (const r of t.requires) {
        const p = byId.get(r);
        if (!p) continue;
        c = Math.max(c, (p.era === era ? colOf(p, depth + 1) : (col.get(p.id) ?? start - 1)) + 1);
      }
      col.set(t.id, c);
      return c;
    };
    for (const t of inEra) colOf(t);
    const end = Math.max(start, ...inEra.map((t) => col.get(t.id)!));
    // Spread crowded cells: a tech may slide right inside its era while it stays left of every
    // same-era dependent, when that lowers the number of lanes its branch needs.
    const cell = (b: string, c: number) => inEra.filter((t) => t.branch === b && col.get(t.id) === c).length;
    for (let moved = true; moved; ) {
      moved = false;
      for (const t of [...inEra].sort((a, b) => b.cost - a.cost || (a.id < b.id ? -1 : 1))) {
        const c = col.get(t.id)!;
        const limit = Math.min(end, ...inEra.filter((d) => d.requires.includes(t.id)).map((d) => col.get(d.id)! - 1));
        for (let c2 = c + 1; c2 <= limit; c2++)
          if (cell(t.branch, c2) < cell(t.branch, c) - 1) {
            col.set(t.id, c2);
            moved = true;
            break;
          }
      }
    }
    eras.push({ era, x0: GUTTER + start * COL_W, x1: GUTTER + (end + 1) * COL_W });
    start = end + 1;
  }
  // Lanes per (branch, column); a branch band is as tall as its fullest column.
  const pos = new Map<string, { x: number; y: number; col: number; lane: number }>();
  const branches: { id: string; y0: number; y1: number }[] = [];
  let y = HEADER;
  for (const b of branchIds) {
    const mine = techs.filter((t) => t.branch === b).sort((p, q) => col.get(p.id)! - col.get(q.id)! || p.cost - q.cost || (p.id < q.id ? -1 : 1));
    const used = new Map<number, number>();
    let lanes = 1;
    for (const t of mine) {
      const c = col.get(t.id)!;
      const lane = used.get(c) ?? 0;
      used.set(c, lane + 1);
      lanes = Math.max(lanes, lane + 1);
      pos.set(t.id, { x: GUTTER + c * COL_W + (COL_W - NODE_W) / 2, y: y + 8 + lane * LANE_H, col: c, lane });
    }
    const h = lanes * LANE_H + 8;
    branches.push({ id: b, y0: y, y1: y + h });
    y += h + BRANCH_GAP;
  }
  return { pos, eras, branches, width: GUTTER + start * COL_W + 24, height: y };
}
