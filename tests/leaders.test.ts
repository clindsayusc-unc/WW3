import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEADER_ROLES, loadWorld, traitsOf } from '../src/sim/world';
import { createGame } from '../src/sim/game';

interface Holder {
  name: string;
  title: string;
  since: string;
}
interface Entry {
  iso3: string;
  effectiveLeader?: Holder & { role: string; basis: string; party?: string | null };
  headOfState: Holder;
  headOfGovernment: Holder | null;
  traits: Record<string, number>;
  rationale: string;
}

const data = JSON.parse(readFileSync(join(process.cwd(), 'data/leaders.json'), 'utf8')) as { leaders: Entry[] };
const byIso = new Map(data.leaders.map((l) => [l.iso3, l]));
const MAJORS = ['USA', 'CHN', 'RUS', 'IND', 'GBR', 'FRA', 'DEU', 'JPN', 'KOR', 'IRN', 'ISR', 'TUR', 'PAK', 'BRA'];
const TRAITS = ['aggression', 'riskTolerance', 'pragmatism', 'nationalism', 'paranoia', 'economicPriority', 'allianceLoyalty', 'nuclearThreshold'];

describe('effective leaders (D-049)', () => {
  it('every playable major has an effectiveLeader set', () => {
    for (const iso of MAJORS) {
      const e = byIso.get(iso)?.effectiveLeader;
      expect(e, `${iso} effectiveLeader`).toBeDefined();
      expect(e!.name.trim(), `${iso} name`).not.toBe('');
      expect(e!.title.trim(), `${iso} title`).not.toBe('');
      expect(e!.basis.trim(), `${iso} basis`).not.toBe('');
      expect(e!.since, `${iso} since`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(LEADER_ROLES, `${iso} role`).toContain(e!.role);
    }
  });

  it('parliamentary majors are led by the head of government, not the ceremonial head of state', () => {
    for (const iso of ['GBR', 'DEU', 'IND', 'JPN', 'ISR', 'PAK']) {
      const l = byIso.get(iso)!;
      expect(l.effectiveLeader!.role, iso).toBe('headOfGovernment');
      expect(l.effectiveLeader!.name, iso).toBe(l.headOfGovernment!.name);
      expect(l.effectiveLeader!.name, iso).not.toBe(l.headOfState.name);
    }
  });

  it('Iran is led by the Supreme Leader; presidential majors by the president', () => {
    const irn = byIso.get('IRN')!;
    expect(irn.effectiveLeader!.role).toBe('supremeLeader');
    expect(irn.effectiveLeader!.name).toBe(irn.headOfState.name);
    for (const iso of ['USA', 'RUS', 'FRA', 'KOR', 'TUR', 'BRA']) {
      const l = byIso.get(iso)!;
      expect(l.effectiveLeader!.role, iso).toBe('headOfState');
      expect(l.effectiveLeader!.name, iso).toBe(l.headOfState.name);
    }
  });

  it('every entry is internally consistent and has full trait scores', () => {
    expect(data.leaders.length).toBe(44);
    for (const l of data.leaders) {
      const e = l.effectiveLeader;
      expect(e, `${l.iso3} effectiveLeader`).toBeDefined();
      if (e!.role === 'headOfGovernment') expect(e!.name, l.iso3).toBe(l.headOfGovernment?.name);
      else expect(e!.name, l.iso3).toBe(l.headOfState.name);
      expect(Object.keys(l.traits).sort(), l.iso3).toEqual([...TRAITS].sort());
      for (const k of TRAITS) {
        expect(Number.isInteger(l.traits[k]), `${l.iso3}.${k}`).toBe(true);
        expect(l.traits[k]!, `${l.iso3}.${k}`).toBeGreaterThanOrEqual(1);
        expect(l.traits[k]!, `${l.iso3}.${k}`).toBeLessThanOrEqual(99);
      }
    }
  });

  it('the world, the picker and the AI all use the effective leader', () => {
    const world = loadWorld();
    for (const iso of MAJORS) {
      const raw = byIso.get(iso)!;
      const leader = world.leaders.get(iso)!;
      expect(leader.name).toBe(raw.effectiveLeader!.name);
      expect(leader.headOfState.name).toBe(raw.headOfState.name);
      expect(traitsOf(world, iso)).toEqual(raw.traits);
      const game = createGame({ seed: 1, player: iso, scenario: 'world-2027' }, world);
      expect(game.nations[iso]!.leaderName).toBe(raw.effectiveLeader!.name);
    }
  });
});
