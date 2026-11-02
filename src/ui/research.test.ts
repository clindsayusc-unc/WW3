/** Research screen (D-079): tree layout and effect labels. */
import { describe, expect, it } from 'vitest';
import { loadWorld } from '../sim/world';
import { EFFECT_LABEL, effectText } from './techText';
import { layoutTree, NODE_H, NODE_W } from './researchLayout';

const world = loadWorld();

describe('technology effect labels', () => {
  it('every effect key has a label and explanation', () => {
    for (const t of world.techList)
      for (const e of t.effects) {
        expect(EFFECT_LABEL[e.key], `${t.id}: ${e.key}`).toBeDefined();
        expect(effectText(e)).toMatch(/\d/);
      }
  });
});

describe('research screen layout', () => {
  const L = layoutTree(world.techList, world.branches.map((b) => b.id));
  it('places every tech, links run left to right, and nodes never overlap', () => {
    expect(L.pos.size).toBe(world.techList.length);
    for (const t of world.techList)
      for (const r of t.requires) expect(L.pos.get(r)!.x + NODE_W, `${r} → ${t.id}`).toBeLessThan(L.pos.get(t.id)!.x);
    const list = [...L.pos.values()];
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        const overlap = Math.abs(a.x - b.x) < NODE_W && Math.abs(a.y - b.y) < NODE_H;
        expect(overlap).toBe(false);
      }
  });
  it('has five era columns in order and one band per branch', () => {
    expect(L.eras.map((e) => e.era)).toEqual([1, 2, 3, 4, 5]);
    for (let i = 1; i < L.eras.length; i++) expect(L.eras[i]!.x0).toBe(L.eras[i - 1]!.x1);
    expect(L.branches).toHaveLength(8);
    for (const t of world.techList) {
      const p = L.pos.get(t.id)!;
      const era = L.eras.find((e) => e.era === t.era)!;
      expect(p.x).toBeGreaterThanOrEqual(era.x0);
      expect(p.x + NODE_W).toBeLessThanOrEqual(era.x1);
    }
  });
});
