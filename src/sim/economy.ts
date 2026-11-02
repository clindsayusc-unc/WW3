/** Monthly economy: growth, revenue, budget execution, debt, stability (D-026). */
import { nationName, type World } from './world';
import type { GameState, Iso3, NationState } from './types';
import {
  clamp,
  controlShare,
  costFactor,
  isAtWar,
  log,
  rawUpkeepByNation,
  sanctionersOf,
  worldGdp,
} from './query';
import { GOV_REVENUE_SHARE } from './setup';

export const MOBILIZATION_GROWTH_DRAG = [0, 0.6, 1.8]; // pp of annual growth
export const MOBILIZATION_PRODUCTION = [1, 1.25, 1.6];
export const MOBILIZATION_STABILITY = [0, 0.4, 1.2]; // per month

export interface GrowthBreakdown {
  base: number;
  infrastructure: number;
  tech: number;
  sanctions: number;
  war: number;
  mobilization: number;
  debt: number;
  events: number;
  total: number;
}

export function growthBreakdown(world: World, state: GameState, iso: Iso3): GrowthBreakdown {
  const n = state.nations[iso]!;
  const infra = (n.budget.infrastructure - 20) * 0.03; // 20% is neutral
  const tech = n.modifiers.gdpGrowth ?? 0;
  const total = worldGdp(world, state) || 1;
  let sanctionWeight = 0;
  for (const s of sanctionersOf(state, iso)) sanctionWeight += (state.nations[s]?.gdp ?? 0) / total;
  const sanctions = -sanctionWeight * 6 * (1 - (n.modifiers.sanctionResistance ?? 0));
  const war = isAtWar(state, iso) ? -1.0 - (1 - controlShare(world, state, iso)) * 6 : 0;
  const mobilization = -MOBILIZATION_GROWTH_DRAG[n.mobilization]!;
  const debtRatio = n.debt / Math.max(1, n.gdp);
  const debt = debtRatio > 1.2 ? -(debtRatio - 1.2) * 2 : 0;
  const events = n.growthMods.reduce((s, m) => s + m.delta, 0);
  const sum = n.baseGrowth + infra + tech + sanctions + war + mobilization + debt + events;
  return {
    base: n.baseGrowth,
    infrastructure: infra,
    tech,
    sanctions,
    war,
    mobilization,
    debt,
    events,
    total: clamp(sum, -15, 12),
  };
}

export function monthlyRevenue(n: NationState, controlled: number): number {
  return (n.gdp * controlled * GOV_REVENUE_SHARE) / 12;
}

export function runEconomy(world: World, state: GameState): void {
  for (const n of Object.values(state.nations)) {
    if (!n.alive) continue;
    const held = controlShare(world, state, n.iso3);
    const g = growthBreakdown(world, state, n.iso3);
    n.growth = g.total;
    n.gdp = Math.max(0.01, n.gdp * (1 + g.total / 100 / 12));
    n.growthMods = n.growthMods
      .map((m) => ({ ...m, monthsLeft: m.monthsLeft - 1 }))
      .filter((m) => m.monthsLeft > 0);

    const revenue = monthlyRevenue(n, held);
    const b = n.budget;
    const spend = (pct: number) => (revenue * pct) / 100;
    const upkeep = unitUpkeep(world, state, n.iso3);
    const militaryBudget = spend(b.military) * (n.mobilization > 0 ? 1.1 : 1);
    const production = Math.max(0, militaryBudget - upkeep);
    const research = spend(b.research);
    const infrastructure = spend(b.infrastructure);
    const social = spend(b.social);
    const debtService = spend(b.debt);
    const interest = (n.debt * 0.04) / 12;
    // The debt-service allocation pays interest first; any remainder retires principal and any
    // shortfall is borrowed (D-026).
    const principal = debtService - interest;
    const expenses = upkeep + production + research + infrastructure + social + debtService;
    const deficit = Math.max(0, interest - debtService);
    n.treasury += revenue - expenses;
    if (principal >= 0) n.debt = Math.max(0, n.debt - principal);
    else n.debt += -principal;
    // Treasury cannot go negative: shortfalls are borrowed.
    if (n.treasury < 0) {
      n.debt += -n.treasury;
      n.treasury = 0;
    }
    // Production funds accumulate in the treasury for purchases (they are not lost).
    n.treasury += production;
    // Sovereign default: unsustainable debt is restructured at a heavy political price.
    if (n.debt > n.gdp * 2.5) {
      n.debt *= 0.5;
      n.stability = clamp(n.stability - 12, 0, 100);
      n.growthMods.push({ delta: -2, monthsLeft: 24, reason: 'Sovereign default' });
      log(state, {
        kind: 'economy',
        text: `${nationName(world, n.iso3)} defaults on its sovereign debt.`,
        nations: [n.iso3],
        alert: n.iso3 === state.player,
      });
    }
    n.finances = {
      revenue,
      military: militaryBudget,
      upkeep,
      production,
      research,
      infrastructure,
      social,
      debtService,
      interest,
      deficit,
    };

    // Unpaid upkeep hurts morale.
    if (upkeep > militaryBudget * 1.1) {
      for (const u of Object.values(state.units))
        if (u.owner === n.iso3) u.morale = clamp(u.morale - 3, 10, 100);
    }

    // Stability.
    let ds = 0;
    ds += (b.social - 30) * 0.02; // 30% social is neutral
    ds += g.total > 1 ? 0.2 : g.total < -1 ? -0.6 : 0;
    ds -= MOBILIZATION_STABILITY[n.mobilization]!;
    if (isAtWar(state, n.iso3)) {
      n.warWeariness = clamp(n.warWeariness + 1.5 + (1 - held) * 6, 0, 100);
      ds -= n.warWeariness / 40;
    } else {
      n.warWeariness = Math.max(0, n.warWeariness - 2);
      ds += 0.15;
    }
    if (n.debt / Math.max(1, n.gdp) > 1.5) ds -= 0.5;
    if (held < 0.7) ds -= 1.5;
    ds += (n.modifiers.stability ?? 0) / 24;
    ds += (65 - n.stability) * 0.04; // mean reversion
    n.stability = clamp(n.stability + ds, 0, 100);
    n.monthsUnstable = n.stability < 10 ? n.monthsUnstable + 1 : 0;
    if (n.stability < 25 && state.turn % 6 === 0 && n.iso3 === state.player) {
      log(state, {
        kind: 'economy',
        text: `Unrest spreads across ${nationName(world, n.iso3)} as stability falls to ${Math.round(n.stability)}.`,
        nations: [n.iso3],
        alert: true,
      });
    }
  }
}

export function unitUpkeep(world: World, state: GameState, iso: Iso3): number {
  const n = state.nations[iso]!;
  const raw = rawUpkeepByNation(world, state).get(iso) ?? 0;
  return raw * costFactor(n.quality) * (1 + (n.modifiers.upkeep ?? 0));
}

export function unitCost(world: World, state: GameState, iso: Iso3, type: string): number {
  const n = state.nations[iso]!;
  const t = world.unitTypes.get(type);
  if (!t) return Infinity;
  return (
    (t.costBn * costFactor(n.quality) * (1 + (n.modifiers.productionCost ?? 0))) /
    MOBILIZATION_PRODUCTION[n.mobilization]!
  );
}

export function buildMonths(world: World, state: GameState, iso: Iso3, type: string): number {
  const n = state.nations[iso]!;
  const t = world.unitTypes.get(type);
  if (!t) return 1;
  return Math.max(
    1,
    Math.round(
      t.buildMonths / (1 + (n.modifiers.buildSpeed ?? 0)) / (n.mobilization === 2 ? 1.3 : 1),
    ),
  );
}

/** Advances production queues; completed units appear in their region. */
export function runProduction(world: World, state: GameState): void {
  for (const n of Object.values(state.nations)) {
    if (!n.alive || n.production.length === 0) continue;
    const done: number[] = [];
    for (const p of n.production) {
      p.monthsLeft -= 1;
      if (p.monthsLeft <= 0) done.push(p.id);
    }
    for (const id of done) {
      const p = n.production.find((x) => x.id === id)!;
      let region = p.region;
      if (state.regions[region]?.controller !== n.iso3) {
        region = world.capitalRegion.get(n.iso3) ?? region;
      }
      const t = world.unitTypes.get(p.type);
      if (t?.domain === 'sea') {
        const meta = world.regions.get(region);
        const zone = meta?.neighbours.find((z) => world.regions.get(z)?.sea);
        if (zone) region = zone;
      }
      state.units[state.nextId] = {
        id: state.nextId,
        type: p.type,
        owner: n.iso3,
        region,
        strength: 100,
        morale: 85,
        path: [],
        prevRegion: region,
      };
      state.nextId++;
      if (n.iso3 === state.player) {
        log(state, {
          kind: 'production',
          text: `${t?.name ?? p.type} completed in ${world.regions.get(region)?.name ?? 'home'}.`,
          nations: [n.iso3],
          region,
          alert: true,
        });
      }
    }
    n.production = n.production.filter((p) => !done.includes(p.id));
  }
}
