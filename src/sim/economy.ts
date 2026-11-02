/**
 * Monthly economy (D-026, D-061): potential and actual output, growth, inflation, interest, debt,
 * budget execution, recessions and stability. Trade, sanctions and resource shortages arrive as
 * pre-computed terms from trade.ts (`NationState.econ`).
 */
import { techDelta } from './research';
import { nationName, type World } from './world';
import type { GameState, Iso3, NationState } from './types';
import {
  clamp,
  controlShare,
  costFactor,
  headline,
  isAtWar,
  log,
  makeUnit,
  rawUpkeepByNation,
} from './query';
import { chokepointGrowthEffect, semiconductorDisruption } from './geography';
import { maybeCommander } from './commanders';
import { productionThroughput, inputShortage } from './trade';

export const MOBILIZATION_GROWTH_DRAG = [0, 0.6, 1.8]; // pp of annual growth
export const MOBILIZATION_PRODUCTION = [1, 1.25, 1.6];
export const MOBILIZATION_STABILITY = [0, 0.4, 1.2]; // per month
export const MOBILIZATION_INFLATION = [0, 1, 3]; // pp of annual inflation
export const DEFAULT_TAX_RATE = 28;
export const TAX_MIN = 15;
export const TAX_MAX = 45;
/** Growth recovered per year for each 1 % output gap (output converges toward potential). */
export const RECOVERY_RATE = 30;
export const WAR_BOND_SHARE = 0.015; // of GDP per issue
export const WAR_BOND_COOLDOWN = 6;
export const HISTORY_KEEP = 240;

export interface GrowthBreakdown {
  /** Trend growth: the IMF rate converging toward 2 % with a 15-year half-life. */
  base: number;
  infrastructure: number;
  tech: number;
  /** Taxes above (below) the 28 % norm cost (add) growth. */
  tax: number;
  /** Bilateral trade lost or gained against January 2027 (war, sanctions, cut routes, treaties). */
  trade: number;
  /** Strategic resources: shortages, export earnings and import prices. */
  resources: number;
  /** Financial sanctions (frozen reserves, capital flight) relative to the start. */
  sanctions: number;
  war: number;
  mobilization: number;
  debt: number;
  inflation: number;
  /** Catch-up toward potential output (positive after a downturn, negative when overheating). */
  recovery: number;
  events: number;
  /** Oil shocks and trade disruption from closed or contested chokepoints (D-052). */
  chokepoints: number;
  chokepointReasons: string[];
  /** Growth of potential output (trend + infrastructure + tech + tax). */
  potential: number;
  /** GDP ÷ potential − 1. */
  gap: number;
  total: number;
}

export function trendGrowth(state: GameState, n: NationState): number {
  return 2 + (n.baseGrowth - 2) * 0.5 ** (state.turn / 180);
}

/** Inflation the economy would settle at if nothing changed (the monthly update moves 15 % toward it). */
export interface InflationBreakdown {
  anchor: number;
  overheating: number;
  deficit: number;
  mobilization: number;
  prices: number;
  shortages: number;
  sanctions: number;
  target: number;
}

const PRICE_WEIGHT: Record<string, number> = { oil: 4, gas: 2, food: 5, steel: 1, chips: 0.5, rareEarths: 0.2 };
const SHORT_WEIGHT: Record<string, number> = { oil: 8, gas: 4, food: 12, steel: 2, chips: 1, rareEarths: 0.5 };

export function inflationAnchor(world: World, state: GameState, iso: Iso3): number {
  const p0 = world.startInflation.get(iso) ?? 3;
  return 2.5 + (p0 - 2.5) * 0.5 ** (state.turn / 36);
}

export function inflationBreakdown(world: World, state: GameState, iso: Iso3): InflationBreakdown {
  const n = state.nations[iso]!;
  const anchor = inflationAnchor(world, state, iso);
  const gap = n.gdp / Math.max(0.01, n.potentialGdp) - 1;
  const overheating = gap > 0 ? gap * 40 : gap * 10;
  const deficit = Math.max(0, n.econ.deficitPct - 3) * 0.35;
  const mobilization = MOBILIZATION_INFLATION[n.mobilization]!;
  let prices = 0;
  let shortages = 0;
  for (const res of world.resources) {
    const b = n.resources[res.id];
    if (!b) continue;
    const dep = b.demand > 0 ? b.imports / b.demand : 0;
    prices += dep * ((state.economy.prices[res.id] ?? 1) - 1) * (PRICE_WEIGHT[res.id] ?? 1);
    shortages += Math.max(0, (n.resourceRef[res.id] ?? 1) - b.satisfaction) * (SHORT_WEIGHT[res.id] ?? 1);
  }
  if (!(world.nations.get(iso)?.resources.includes('oil') ?? false)) prices += (state.oilPrice - 1) * 3;
  const sanctions = Math.max(0, n.econ.sanctionShare - n.econ.sanctionRef) * 12;
  const target = clamp(anchor + overheating + deficit + mobilization + prices + shortages + sanctions, -3, 400);
  return { anchor, overheating, deficit, mobilization, prices, shortages, sanctions, target };
}

/** Debt level markets accept without a risk premium: the starting ratio, at least 90 % of GDP. */
export function debtTolerance(world: World, iso: Iso3): number {
  return Math.max(0.9, (world.nations.get(iso)?.debtToGdpPct ?? 60) / 100);
}

export function defaultThreshold(world: World, iso: Iso3): number {
  return Math.max(2.5, debtTolerance(world, iso) + 0.8);
}

export interface InterestBreakdown {
  base: number;
  inflation: number;
  debtPremium: number;
  defaultPremium: number;
  sanctions: number;
  target: number;
}

/** Interest the market demands on new debt; the average rate moves 1/24 of the way each month. */
export function interestBreakdown(world: World, state: GameState, iso: Iso3): InterestBreakdown {
  const n = state.nations[iso]!;
  const ratio = n.debt / Math.max(1, n.gdp);
  const base = 1.5;
  const inflation = 0.9 * Math.max(0, n.inflation);
  const debtPremium = Math.max(0, ratio - debtTolerance(world, iso)) * 5;
  const defaultPremium = n.monthsSinceDefault < 36 ? 4 : 0;
  const sanctions = Math.max(0, n.econ.sanctionShare - n.econ.sanctionRef) * 4;
  const target = clamp(base + inflation + debtPremium + defaultPremium + sanctions, 0.5, 60);
  return { base, inflation, debtPremium, defaultPremium, sanctions, target };
}

export function growthBreakdown(world: World, state: GameState, iso: Iso3): GrowthBreakdown {
  const n = state.nations[iso]!;
  const base = trendGrowth(state, n);
  const infra = (n.budget.infrastructure - 20) * 0.03; // 20% is neutral
  // Relative to January 2027: IMF forecasts already price in the technology fielded then (D-079).
  const tech = techDelta(n, 'gdpGrowth');
  const tax = -(n.taxRate - DEFAULT_TAX_RATE) * 0.06;
  const e = n.econ;
  const trade = e.tradeEffect;
  const resources = clamp(e.exportEffect + e.shortageEffect + e.priceEffect, -10, 5);
  const sanctions = -(e.sanctionShare - e.sanctionRef) * 2 * (1 - (n.modifiers.sanctionResistance ?? 0));
  const war = isAtWar(state, iso) ? -1.0 - (1 - controlShare(world, state, iso)) * 6 : 0;
  const mobilization = -MOBILIZATION_GROWTH_DRAG[n.mobilization]!;
  const debtRatio = n.debt / Math.max(1, n.gdp);
  // Debt drag above 120 % of GDP, or above the starting ratio for nations that began higher (Japan).
  const debtLine = Math.max(1.2, debtTolerance(world, iso));
  const debt = debtRatio > debtLine ? -(debtRatio - debtLine) * 2 : 0;
  const inflation = -clamp((n.inflation - Math.max(10, inflationAnchor(world, state, iso))) * 0.05, 0, 5);
  const gap = n.gdp / Math.max(0.01, n.potentialGdp) - 1;
  const recovery = clamp(-gap * RECOVERY_RATE, -3, 8);
  const events = n.growthMods.reduce((s, m) => s + m.delta, 0);
  const choke = chokepointGrowthEffect(world, state, iso);
  const potential = base + infra + tech + tax;
  const sum = potential + trade + resources + sanctions + war + mobilization + debt + inflation + recovery + events + choke.value;
  return {
    base,
    infrastructure: infra,
    tech,
    tax,
    trade,
    resources,
    sanctions,
    war,
    mobilization,
    debt,
    inflation,
    recovery,
    events,
    chokepoints: choke.value,
    chokepointReasons: choke.reasons,
    potential,
    gap,
    total: clamp(sum, -15, 12),
  };
}

export function monthlyRevenue(n: NationState, controlled: number): number {
  return (n.gdp * controlled * (n.taxRate ?? DEFAULT_TAX_RATE)) / 100 / 12;
}

/** War bonds: patriotic borrowing (1.5 % of GDP) when at war or mobilised; 6-month cooldown. */
export function canIssueWarBonds(state: GameState, iso: Iso3): string | null {
  const n = state.nations[iso];
  if (!n?.alive) return 'Nation no longer exists.';
  if (!isAtWar(state, iso) && n.mobilization === 0) return 'War bonds need a war or at least partial mobilisation.';
  if (n.warBondCooldown > 0) return `The last issue is still being sold (${n.warBondCooldown} months).`;
  if (n.debt / Math.max(1, n.gdp) > 2) return 'Debt is too high: no one will buy more bonds.';
  return null;
}

export function issueWarBonds(world: World, state: GameState, iso: Iso3): void {
  const why = canIssueWarBonds(state, iso);
  if (why) throw new Error(why);
  const n = state.nations[iso]!;
  const amount = n.gdp * WAR_BOND_SHARE;
  n.treasury += amount;
  n.debt += amount;
  n.warBonds += amount;
  n.warBondCooldown = WAR_BOND_COOLDOWN;
  if (isAtWar(state, iso)) {
    n.support = clamp(n.support + 3, 0, 100);
    n.warWeariness = clamp(n.warWeariness - 3, 0, 100);
  }
  log(state, {
    kind: 'economy',
    text: `${nationName(world, iso)} issues war bonds: ${amount.toFixed(0)} bn raised from savers${isAtWar(state, iso) ? '; the campaign rallies the public' : ''}.`,
    nations: [iso],
    alert: iso === state.player,
  });
}

export function runEconomy(world: World, state: GameState): void {
  for (const n of Object.values(state.nations)) {
    if (!n.alive) continue;
    const held = controlShare(world, state, n.iso3);
    const g = growthBreakdown(world, state, n.iso3);
    n.growth = g.total;
    n.gdp = Math.max(0.01, n.gdp * (1 + g.total / 100 / 12));
    n.potentialGdp = Math.max(0.01, n.potentialGdp * (1 + g.potential / 100 / 12));
    n.growthMods = n.growthMods
      .map((m) => ({ ...m, monthsLeft: m.monthsLeft - 1 }))
      .filter((m) => m.monthsLeft > 0);

    // Recessions: six consecutive months of contraction; recovery when growth returns.
    n.negativeMonths = g.total < 0 ? n.negativeMonths + 1 : 0;
    const wasRecession = n.recession;
    if (!n.recession && n.negativeMonths >= 6) n.recession = true;
    else if (n.recession && g.total > 0.5) n.recession = false;
    if (n.recession !== wasRecession && (n.iso3 === state.player || world.nations.get(n.iso3)?.major)) {
      log(state, {
        kind: 'economy',
        text: n.recession
          ? `${nationName(world, n.iso3)} enters recession after six months of contraction.`
          : `${nationName(world, n.iso3)} climbs out of recession (growth ${g.total.toFixed(1)} %).`,
        nations: [n.iso3],
        alert: n.iso3 === state.player,
      });
      if (n.recession && world.nations.get(n.iso3)?.major) headline(state, `RECESSION: ${nationName(world, n.iso3)} economy shrinks for a sixth month`);
    }

    const debtBefore = n.debt;
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
    const interest = (n.debt * n.interestRate) / 100 / 12;
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

    // Inflation moves 15 % a month toward its target; it erodes the real value of debt and cash.
    const infl = inflationBreakdown(world, state, n.iso3);
    n.inflation = clamp(n.inflation + 0.15 * (infl.target - n.inflation), -3, 400);
    const erosion = 1 + n.inflation / 1200;
    n.debt /= erosion;
    n.treasury /= 1 + n.inflation / 2400;
    // Real borrowing (after inflation has eroded the stock) is what prints money.
    const borrowed = Math.max(0, n.debt - debtBefore);
    n.econ.deficitPct = (borrowed * 12) / Math.max(1, n.gdp) * 100;
    // Interest: the average rate on the debt stock follows the market rate slowly.
    const ir = interestBreakdown(world, state, n.iso3);
    n.interestRate = clamp(n.interestRate + (ir.target - n.interestRate) / 24, 0.5, 60);
    n.warBondCooldown = Math.max(0, n.warBondCooldown - 1);
    n.monthsSinceDefault += 1;

    // Sovereign default: unsustainable debt is restructured at a heavy political price.
    if (n.debt > n.gdp * defaultThreshold(world, n.iso3)) {
      n.debt *= 0.5;
      n.stability = clamp(n.stability - 12, 0, 100);
      n.support = clamp(n.support - 10, 0, 100);
      n.monthsSinceDefault = 0;
      n.growthMods.push({ delta: -2, monthsLeft: 24, reason: 'Sovereign default' });
      log(state, {
        kind: 'economy',
        text: `${nationName(world, n.iso3)} defaults on its sovereign debt.`,
        nations: [n.iso3],
        alert: n.iso3 === state.player,
      });
      if (world.nations.get(n.iso3)?.major) headline(state, `DEFAULT: ${nationName(world, n.iso3)} cannot pay its debts`);
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
    ds += (n.support - 50) * 0.01;
    const food = n.resources.food;
    if (food) ds -= Math.max(0, (n.resourceRef.food ?? 1) - food.satisfaction) * 4;
    if (n.inflation > 40) ds -= 0.4;
    if (n.inflation > 100) ds -= 1.2;
    if (n.recession) ds -= 0.2;
    ds += techDelta(n, 'stability') / 24;
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

/** Monthly samples for the economy screen's charts (majors and the player). */
export function recordHistory(world: World, state: GameState): void {
  for (const n of Object.values(state.nations)) {
    if (!world.nations.get(n.iso3)?.major && n.iso3 !== state.player) continue;
    const list = state.history[n.iso3] ?? [];
    list.push({
      turn: state.turn,
      gdp: Math.round(n.gdp * 10) / 10,
      growth: Math.round(n.growth * 100) / 100,
      inflation: Math.round(n.inflation * 100) / 100,
      debt: Math.round((n.debt / Math.max(1, n.gdp)) * 1000) / 10,
      support: Math.round(n.support * 10) / 10,
      treasury: Math.round(n.treasury * 10) / 10,
    });
    if (list.length > HISTORY_KEEP) list.splice(0, list.length - HISTORY_KEEP);
    state.history[n.iso3] = list;
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
  // Scarce inputs (steel, chips, rare earths, oil) make every unit dearer (D-061).
  const scarcity = 0.5 * inputShortage(state, iso, world.unitInputs.get(type));
  return (
    (t.costBn *
      costFactor(n.quality) *
      (1 + (n.modifiers.productionCost ?? 0) + semiconductorDisruption(world, state, iso) + (n.blockaded ? 0.1 : 0) + scarcity)) /
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
    // Cyber sabotage of the industrial base (D-059): the queue stalls for a month.
    if (n.productionDelay > 0) {
      n.productionDelay -= 1;
      continue;
    }
    for (const p of n.production) {
      // Shortages of a unit's inputs slow its line (D-061): at worst a quarter of normal speed.
      p.monthsLeft -= productionThroughput(world, state, n.iso3, p.type);
      if (p.monthsLeft <= 1e-6) done.push(p.id);
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
      state.units[state.nextId] = makeUnit(state.nextId, p.type, n.iso3, region, {
        morale: 85,
        mission: t?.domain === 'air' ? 'superiority' : null,
        commander: t?.domain === 'land' ? maybeCommander(world, state, n.iso3) : null,
      });
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
