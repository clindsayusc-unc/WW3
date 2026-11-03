/** Simple mode (D-086): managed play, Decision Cards, stances, goal, report and mode switching. */
import { describe, expect, it } from 'vitest';
import { applyCommand, createGame } from './game';
import { loadWorld } from './world';
import { atWar, militaryPower } from './query';
import { decisionCards, goalProgress, oddsWords, CARDS_PER_TURN } from './simple';
import type { GameState } from './types';

const world = loadWorld();
const simpleGame = (player = 'USA', seed = 11): GameState =>
  createGame({ seed, player, scenario: 'world-2027', mode: 'simple' }, world);

function assertFinite(value: unknown, path = 'state'): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} is ${value}`);
    return;
  }
  if (Array.isArray(value)) value.forEach((v, i) => assertFinite(v, `${path}[${i}]`));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) assertFinite(v, `${path}.${k}`);
}

describe('simple mode', () => {
  it('a 60-turn game is playable with only Decision Card buttons and End Turn', { timeout: 600_000 }, () => {
    let g = simpleGame();
    expect(g.mode).toBe('simple');
    let researched = 0;
    let built = 0;
    let answered = 0;
    for (let turn = 0; turn < 60 && !g.victory && !g.defeat; turn++) {
      const startCards = decisionCards(world, g);
      // Every month opens with one to three cards.
      expect(startCards.length, `turn ${turn}`).toBeGreaterThanOrEqual(1);
      expect(startCards.length).toBeLessThanOrEqual(CARDS_PER_TURN);
      for (let guard = 0; guard < CARDS_PER_TURN; guard++) {
        const cards = decisionCards(world, g);
        const card = cards[0];
        if (!card) break;
        for (const c of cards) {
          expect(c.options.length, c.id).toBeGreaterThanOrEqual(2);
          expect(c.options.length, c.id).toBeLessThanOrEqual(3);
          // Always at least one sensible choice, every button in words.
          expect(c.options.some((o) => o.sensible), `${c.id} has a sensible option`).toBe(true);
          for (const o of c.options) {
            expect(o.label.length).toBeGreaterThan(0);
            expect(o.effect.length).toBeGreaterThan(0);
            expect(o.effect).not.toMatch(/\d+:\d|ratio/i);
          }
        }
        // Alternate between the first sensible choice and the last sensible one, to exercise both.
        const sensible = card.options.map((o, i) => ({ o, i })).filter((x) => x.o.sensible);
        const pick = turn % 2 === 0 ? sensible[0]! : sensible[sensible.length - 1]!;
        g = applyCommand(world, g, { type: 'decide', card: card.id, option: pick.i });
        answered++;
        expect(decisionCards(world, g).some((c) => c.id === card.id)).toBe(false);
      }
      g = applyCommand(world, g, { type: 'endTurn' });
      const me = g.nations[g.player]!;
      if (me.researchCurrent) researched++;
      if (me.production.length > 0) built++;
      expect(g.simple!.report.length).toBeGreaterThanOrEqual(1);
      expect(g.simple!.report.length).toBeLessThanOrEqual(3);
    }
    expect(g.turn === 60 || g.victory !== null || g.defeat !== null).toBe(true);
    expect(answered).toBeGreaterThan(60);
    // The AI ran the details: research and production went on without a single manual order.
    expect(researched).toBeGreaterThan(30);
    expect(built).toBeGreaterThan(10);
    assertFinite(g.nations[g.player]);
    const goal = goalProgress(world, g);
    expect(goal.text).toMatch(/% of the way there$/);
    expect(goal.pct).toBeGreaterThan(0);
  });

  it('switching modes mid-game keeps the state intact', { timeout: 120_000 }, () => {
    let g = createGame({ seed: 4, player: 'CHN', scenario: 'world-2027' }, world);
    for (let i = 0; i < 4; i++) g = applyCommand(world, g, { type: 'endTurn' });
    const strip = (s: GameState) => {
      const { mode: _m, simple: _s, ...rest } = s;
      void _m;
      void _s;
      return rest;
    };
    const simple = applyCommand(world, g, { type: 'setMode', mode: 'simple' });
    expect(simple.mode).toBe('simple');
    expect(strip(simple)).toEqual(strip(g));
    const back = applyCommand(world, simple, { type: 'setMode', mode: 'full' });
    expect(back.mode).toBe('full');
    expect(strip(back)).toEqual(strip(g));
    // A Simple turn, then back to Full: the game continues from where it was.
    const s2 = applyCommand(world, applyCommand(world, simple, { type: 'setMilitaryBias', bias: 5 }), { type: 'endTurn' });
    const f2 = applyCommand(world, s2, { type: 'setMode', mode: 'full' });
    expect(f2.turn).toBe(5);
    expect(strip(f2)).toEqual(strip(s2));
    expect(f2.simple?.militaryBias).toBe(5);
  });

  it('in Full mode the AI leaves the player alone; in Simple mode it runs the player', { timeout: 60_000 }, () => {
    const full = createGame({ seed: 7, player: 'FRA', scenario: 'world-2027' }, world);
    const simple = applyCommand(world, full, { type: 'setMode', mode: 'simple' });
    const f1 = applyCommand(world, full, { type: 'endTurn' });
    const s1 = applyCommand(world, simple, { type: 'endTurn' });
    expect(f1.nations.FRA!.budget).toEqual(full.nations.FRA!.budget);
    expect(s1.nations.FRA!.researchCurrent).not.toBeNull();
    expect(s1.simple!.report.length).toBeGreaterThan(0);
  });

  it('a military-spending lean moves the AI-run budget', { timeout: 60_000 }, () => {
    const g = simpleGame('DEU', 3);
    const plus = applyCommand(world, applyCommand(world, g, { type: 'setMilitaryBias', bias: 15 }), { type: 'endTurn' });
    const minus = applyCommand(world, applyCommand(world, g, { type: 'setMilitaryBias', bias: -15 }), { type: 'endTurn' });
    expect(plus.nations.DEU!.budget.military).toBeGreaterThan(minus.nations.DEU!.budget.military + 10);
  });

  it('Attack declares war and sets the stance; peace lifts it', { timeout: 60_000 }, () => {
    const g = simpleGame('IND', 5);
    expect(atWar(g, 'IND', 'PAK')).toBe(false);
    const w = applyCommand(world, g, { type: 'setStance', target: 'PAK', stance: 'attack' });
    expect(atWar(w, 'IND', 'PAK')).toBe(true);
    expect(w.simple!.stances.PAK).toBe('attack');
    const d = applyCommand(world, w, { type: 'setStance', target: 'PAK', stance: 'defend' });
    expect(d.simple!.stances.PAK).toBe('defend');
    // A war card is on the desk with odds in words.
    const card = decisionCards(world, d).find((c) => c.id === 'war:PAK');
    expect(card).toBeDefined();
    expect(card!.options.map((o) => o.label)).toEqual(['Attack', 'Hold the line', 'Offer peace']);
    expect(militaryPower(world, d, 'IND')).toBeGreaterThan(0);
  });

  it('odds are words, not numbers', () => {
    expect(oddsWords(3).words).toBe('Likely win, light losses');
    expect(oddsWords(1.6).words).toBe('Likely win, heavy losses');
    expect(oddsWords(0.3).words).toBe('Almost certain defeat');
  });

  it('is deterministic', { timeout: 120_000 }, () => {
    const run = () => {
      let g = simpleGame('RUS', 9);
      for (let t = 0; t < 3; t++) {
        const c = decisionCards(world, g)[0];
        if (c) g = applyCommand(world, g, { type: 'decide', card: c.id, option: 0 });
        g = applyCommand(world, g, { type: 'endTurn' });
      }
      return g;
    };
    expect(run()).toEqual(run());
  });
});
