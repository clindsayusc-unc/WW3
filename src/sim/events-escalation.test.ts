/** Event chains, the event deck, succession, the news wire and nuclear deterrence (D-074 – D-077). */
import { describe, expect, it } from 'vitest';
import { applyCommand, createGame } from './game';
import { loadWorld, type Effect, type EventMeta } from './world';
import type { GameState, Iso3 } from './types';
import { applyEffect, aiChoice, chainActor, runChains } from './events';
import {
  ESCALATION_LADDER,
  computeDefcon,
  defconFactors,
  deterrentAgainst,
  escalationRung,
  nuclearDecision,
  nuclearStats,
  nuclearStrike,
  secondStrike,
} from './escalation';
import { succeedLeader } from './domestic';
import { writeWire } from './news';
import { makePeace } from './diplomacy';

const world = loadWorld();
const fresh = (player: Iso3 = 'BRA', seed = 21): GameState => createGame({ seed, player, scenario: 'world-2027' }, world);

const EFFECT_TYPES = new Set([
  'relation', 'tension', 'flashpoint', 'stability', 'treasury', 'gdp', 'growth', 'sanction', 'liftSanction', 'war', 'peace',
  'defcon', 'research', 'units', 'mobilize', 'warheads', 'news', 'chain', 'succession', 'legitimacy', 'support',
]);
const chainTargets = (ev: EventMeta, choice: number): string[] =>
  ev.choices[choice]!.effects.filter((e): e is Extract<Effect, { type: 'chain' }> => e.type === 'chain').map((e) => e.event);

describe('event deck', () => {
  it('holds about 120 events, each with 2–3 choices and known effects', () => {
    expect(world.events.length).toBeGreaterThanOrEqual(115);
    const ids = new Set<string>();
    for (const ev of world.events) {
      expect(ids.has(ev.id), `duplicate ${ev.id}`).toBe(false);
      ids.add(ev.id);
      // Flashpoint world events from the original deck may report a single outcome; everything else offers a real choice.
      if (!(ev.scope === 'world' && ev.flashpoint)) {
        expect(ev.choices.length, ev.id).toBeGreaterThanOrEqual(2);
        expect(ev.choices.length, ev.id).toBeLessThanOrEqual(3);
      }
      for (const c of ev.choices) {
        expect(c.label.length, ev.id).toBeGreaterThan(2);
        for (const e of c.effects) expect(EFFECT_TYPES.has(e.type), `${ev.id}: ${e.type}`).toBe(true);
      }
      if (ev.choices.some((c) => typeof c.chance === 'number')) {
        const sum = ev.choices.reduce((s, c) => s + (c.chance ?? 0), 0);
        expect(sum, ev.id).toBeCloseTo(1, 2);
      }
    }
  });

  it('covers elections, coups, assassinations, pandemics, crashes, cyber, disasters, defections and breakthroughs', () => {
    const text = world.events.map((e) => `${e.id} ${e.title}`.toLowerCase()).join(' ');
    for (const k of ['election', 'coup', 'assassination', 'pandemic', 'crash', 'cyber', 'hurricane', 'flood', 'earthquake', 'defect', 'breakthrough'])
      expect(text, k).toContain(k);
  });
});

describe('event chains: no dead ends', () => {
  it('six flashpoint chains: valid steps, acyclic, every step can end the chain', () => {
    expect(world.chains.length).toBeGreaterThanOrEqual(6);
    for (const c of world.chains) {
      const entry = world.eventById.get(c.entry)!;
      expect(entry, c.id).toBeDefined();
      expect(entry.chainStep).toBe(false);
      // Reachability from the entry, and every chain link stays inside the chain.
      const reached = new Set<string>([c.entry]);
      const queue = [c.entry];
      while (queue.length) {
        const ev = world.eventById.get(queue.shift()!)!;
        expect(ev.actor.length, ev.id).toBeGreaterThan(0);
        expect(ev.choices.length, ev.id).toBeGreaterThanOrEqual(2);
        // At least one choice ends the chain.
        expect(ev.choices.some((_, i) => chainTargets(ev, i).length === 0), `${ev.id} has no exit`).toBe(true);
        for (let i = 0; i < ev.choices.length; i++)
          for (const t of chainTargets(ev, i)) {
            expect(c.steps, `${ev.id} → ${t}`).toContain(t);
            if (!reached.has(t)) {
              reached.add(t);
              queue.push(t);
            }
          }
      }
      expect([...reached].sort()).toEqual([...c.steps].sort());
      // Acyclic: depth-first search finds no back edge.
      const state = new Map<string, 0 | 1 | 2>();
      const dfs = (id: string): void => {
        state.set(id, 1);
        const ev = world.eventById.get(id)!;
        for (let i = 0; i < ev.choices.length; i++)
          for (const t of chainTargets(ev, i)) {
            expect(state.get(t), `cycle ${id} → ${t}`).not.toBe(1);
            if (!state.has(t)) dfs(t);
          }
        state.set(id, 2);
      };
      dfs(c.entry);
    }
  });

  it('every path through every chain terminates within five steps', () => {
    for (const c of world.chains) {
      let paths = 0;
      const walk = (id: string, depth: number): void => {
        expect(depth, `${c.id} too deep`).toBeLessThanOrEqual(5);
        const ev = world.eventById.get(id)!;
        for (let i = 0; i < ev.choices.length; i++) {
          const next = chainTargets(ev, i);
          if (next.length === 0) paths++;
          for (const t of next) walk(t, depth + 1);
        }
      };
      walk(c.entry, 1);
      expect(paths, c.id).toBeGreaterThan(2);
    }
  });

  it('AI-run chains resolve in the simulation and leave nothing scheduled', () => {
    for (const c of world.chains) {
      let g = fresh('BRA', 33);
      g.chains.push({ eventId: c.entry, chain: c.id, due: g.turn, target: world.eventById.get(c.entry)!.target });
      for (let i = 0; i < 8 && g.chains.some((x) => x.chain === c.id); i++) g = applyCommand(world, g, { type: 'endTurn' });
      expect(g.chains.filter((x) => x.chain === c.id), c.id).toEqual([]);
      expect(g.log.some((l) => l.text.startsWith(world.eventById.get(c.entry)!.title)), c.id).toBe(true);
    }
  });

  it('the player decides their own steps, and choosing to escalate moves the crisis on', () => {
    let g = fresh('CHN', 5);
    g.chains.push({ eventId: 'tw-customs', chain: 'taiwan-blockade', due: g.turn, target: null });
    runChains(world, g);
    expect(g.pendingEvents.map((p) => p.eventId)).toContain('tw-customs');
    const p = g.pendingEvents.find((x) => x.eventId === 'tw-customs')!;
    g = applyCommand(world, g, { type: 'resolveEvent', pendingId: p.id, choice: 1 });
    expect(g.chains.map((x) => x.eventId)).toContain('tw-quarantine');
    // The next step is decided by the United States (an AI here), a month later.
    expect(chainActor(g, world.eventById.get('tw-quarantine')!)).toBe('USA');
  });

  it('AI choices follow traits and are deterministic for a given state', () => {
    const g = fresh('BRA', 9);
    const ev = world.eventById.get('kr-crisis')!;
    const a = aiChoice(world, structuredClone(g), 'KOR', ev);
    const b = aiChoice(world, structuredClone(g), 'KOR', ev);
    expect(a).toBe(b);
    // Across many draws a cautious, pragmatic leader de-escalates more often than it escalates.
    const counts = [0, 0, 0];
    const s = structuredClone(g);
    for (let i = 0; i < 400; i++) counts[aiChoice(world, s, 'CAN', ev)]!++;
    const esc = ev.choices.findIndex((c) => c.stance === 'escalate');
    const de = ev.choices.findIndex((c) => c.stance === 'deescalate');
    expect(counts[de]!).toBeGreaterThan(counts[esc]!);
  });
});

describe('leader succession', () => {
  it('a term-limited president is succeeded by a fictional party candidate', () => {
    let g = fresh('BRA', 4);
    expect(g.nations.USA!.leaderTermLimited).toBe(true);
    g.nations.USA!.nextElection = g.turn;
    g.nations.USA!.support = 80;
    g = applyCommand(world, g, { type: 'endTurn' });
    expect(g.nations.USA!.leaderFictional).toBe(true);
    expect(g.nations.USA!.leaderName).not.toBe('Donald Trump');
    expect(g.nations.USA!.leaderTermLimited).toBe(false);
    expect(g.log.some((l) => /term-limited/.test(l.text))).toBe(true);
  });

  it('health and other successions install a fictional successor', () => {
    const g = fresh('BRA');
    const name = succeedLeader(world, g, 'RUS', 'health');
    expect(name).toBeTruthy();
    expect(g.nations.RUS!.leaderFictional).toBe(true);
    expect(g.nations.RUS!.leaderSince).toBe(g.turn);
    // The player's own leader can step down through the health event and the game goes on.
    const p = fresh('FRA');
    applyEffect(world, p, { player: 'FRA', target: null }, { type: 'succession', nation: 'PLAYER', cause: 'health' });
    expect(p.nations.FRA!.leaderFictional).toBe(true);
    expect(p.defeat).toBeNull();
  });
});

describe('news wire', () => {
  it('turns the month into wire stories; a great-power war declaration is breaking news', () => {
    let g = fresh('BRA', 8);
    g = applyCommand(world, g, { type: 'endTurn' });
    expect(g.wire.length).toBeGreaterThan(0);
    for (const s of g.wire) {
      expect(s.body).toMatch(/\(WW3 Wire\) — /);
      expect(s.headline.length).toBeGreaterThan(5);
    }
    const s = structuredClone(g);
    s.log.push({ turn: s.turn, kind: 'war', text: 'China declares war on Taiwan. Test.', nations: ['CHN', 'TWN'], alert: true });
    const out = writeWire(world, s);
    const story = out.find((x) => x.headline.includes('China declares war on Taiwan'))!;
    expect(story.priority).toBe(3);
    expect(story.dateline).toMatch(/^BEIJING/);
  });
});

describe('escalation ladder and DEFCON', () => {
  it('the World of 2027 starts on the limited-war rung; peace brings it down', () => {
    const g = fresh('BRA');
    expect(ESCALATION_LADDER).toHaveLength(7);
    expect(escalationRung(world, g).index).toBe(3);
    makePeace(world, g, 'RUS', 'UKR', 'statusQuo');
    expect(escalationRung(world, g).index).toBeLessThan(3);
  });

  it('DEFCON is the lowest level any active factor sets', () => {
    const g = fresh('BRA');
    for (const iso of ['USA', 'RUS', 'UKR', 'BRA']) {
      const active = defconFactors(world, g, iso).filter((f) => f.active);
      const expected = Math.max(1, Math.min(5, ...active.map((f) => f.level)) - g.nations[iso]!.defconMod);
      expect(computeDefcon(world, g, iso)).toBe(expected);
    }
  });
});

describe('nuclear deterrence', () => {
  it('second strike: submarines at sea make it assured; a small land-based arsenal is limited', () => {
    const g = fresh('BRA');
    expect(secondStrike(world, g, 'USA').status).toBe('assured');
    expect(secondStrike(world, g, 'RUS').status).toBe('assured');
    expect(secondStrike(world, g, 'PRK').status).toBe('limited');
    expect(secondStrike(world, g, 'BRA').status).toBe('none');
    // Sinking the SSBNs weakens the second strike.
    const s = structuredClone(g);
    for (const u of Object.values(s.units)) if (u.owner === 'GBR' && u.type === 'missileSub') delete s.units[u.id];
    expect(secondStrike(world, s, 'GBR').survivable).toBeLessThan(secondStrike(world, g, 'GBR').survivable);
    // Extended deterrence: NATO allies are covered by an assured second strike.
    expect(deterrentAgainst(world, g, 'EST', 'RUS').status).toBe('assured');
  });

  it('launch needs two confirmations and DEFCON 1', () => {
    const g = fresh('USA');
    g.wars.push({ id: g.nextId++, attackers: ['USA'], defenders: ['PRK'], since: 0, score: 0 });
    g.nations.USA!.defcon = 1;
    const region = world.capitalRegion.get('PRK')!;
    expect(() => applyCommand(world, g, { type: 'nuclearStrike', target: 'PRK', region, confirmations: 1 })).toThrow(/two confirmations/);
    const after = applyCommand(world, g, { type: 'nuclearStrike', target: 'PRK', region, confirmations: 2 });
    expect(after.detonations).toBeGreaterThanOrEqual(1);
  });

  it('a strike is deterministic and leaves fallout, cooling, isolation and a record', () => {
    const base = fresh('BRA', 12);
    base.wars.push({ id: base.nextId++, attackers: ['RUS'], defenders: ['POL'], since: 0, score: 0 });
    const region = world.capitalRegion.get('POL')!;
    const a = structuredClone(base);
    const b = structuredClone(base);
    nuclearStrike(world, a, 'RUS', 'POL', region);
    nuclearStrike(world, b, 'RUS', 'POL', region);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.regions[region]!.fallout).toBe(1);
    expect(world.regions.get(region)!.neighbours.some((n) => (a.regions[n]?.fallout ?? 0) > 0)).toBe(true);
    expect(a.nuclearWinter).toBeGreaterThan(0);
    expect(a.nations.RUS!.legitimacy).toBeLessThan(20);
    expect(a.sanctions.filter((k) => k.endsWith('>RUS')).length).toBeGreaterThan(50);
    expect(a.nuclearLog[0]!.population).toBeGreaterThan(0);
    const st = nuclearStats(world, a);
    expect(st.detonations).toBe(a.detonations);
    expect(st.populationStruck).toBeGreaterThan(0);
  });

  it('the AI considers nuclear use only when desperation passes its threshold, raised by deterrence', () => {
    const g = fresh('BRA', 3);
    g.wars.push({ id: g.nextId++, attackers: ['USA'], defenders: ['PRK'], since: 0, score: 0 });
    g.nations.PRK!.defcon = 1;
    expect(nuclearDecision(world, g, 'PRK').consider).toBe(false);
    // Pyongyang falls and most of the country is occupied.
    for (const r of world.regionsByNation.get('PRK')!) g.regions[r]!.controller = 'USA';
    g.regionsVersion++;
    const d = nuclearDecision(world, g, 'PRK');
    expect(d.desperation).toBeGreaterThan(80);
    expect(d.target).toBe('USA');
    // The US second strike is assured, so the bar is 20 higher than Kim's raw threshold.
    expect(d.threshold).toBeGreaterThan(40);
    expect(d.consider).toBe(d.desperation >= d.threshold);
    expect(nuclearDecision(world, structuredClone(g), 'PRK')).toEqual(d);
  });

  it('a full exchange ends the game for everyone', () => {
    let g = fresh('BRA', 2);
    g.wars.push({ id: g.nextId++, attackers: ['USA'], defenders: ['RUS'], since: 0, score: 0 });
    for (let i = 0; i < 8; i++) nuclearStrike(world, g, i % 2 ? 'RUS' : 'USA', i % 2 ? 'USA' : 'RUS', world.capitalRegion.get(i % 2 ? 'USA' : 'RUS')!, 3);
    g = applyCommand(world, g, { type: 'endTurn' });
    expect(g.defeat?.kind).toBe('nuclearWar');
    expect(nuclearStats(world, g).cooling).toBeGreaterThan(2);
  });
});
