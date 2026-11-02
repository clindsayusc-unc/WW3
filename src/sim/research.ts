/**
 * Research (D-027, D-079). Research points come from the research budget; each technology has a
 * cost that alliances lower (allies who already field it share data and engineers), stolen designs
 * lower further, and export controls raise for the controlled branches. Finished techs become
 * nation modifiers, unlock units and abilities, and the queue starts the next project.
 */
import { nationName, type TechMeta, type World } from './world';
import type { GameState, Iso3, NationState, TechId } from './types';
import { alliesOf, clamp, headline, isSanctioned, log } from './query';
import { semiconductorDisruption } from './geography';
import { researchThroughput, techAccess } from './trade';

/** Modifier keys an economy is calibrated against at the start (IMF forecasts already price in today's technology). */
export const CALIBRATED_KEYS = ['gdpGrowth', 'stability'] as const;
/** Branches covered by technology export controls (chips, chip tools and AI). */
export const CONTROLLED_BRANCHES: readonly string[] = ['semiconductors', 'ai'];
/** Cost discount per ally already fielding a technology, and the cap. */
export const ALLY_DISCOUNT = 0.1;
export const ALLY_DISCOUNT_MAX = 0.3;
/** Extra discount once nations with half the world's output field it ("it has been done"). */
export const DIFFUSION_DISCOUNT = 0.1;
/** Export controls raise a controlled branch's cost by this × the controllers' share of world GDP. */
export const EXPORT_CONTROL_PENALTY = 1.2;

export interface ResearchFactor {
  readonly label: string;
  readonly factor: number;
  readonly detail: string;
}

/** Research points per month with every factor named (the research screen shows each one). */
export function researchBreakdown(world: World, state: GameState, iso: Iso3): { base: number; factors: ResearchFactor[]; total: number } {
  const n = state.nations[iso]!;
  const spendBn =
    n.finances.research > 0 ? n.finances.research : (((n.gdp * (n.taxRate ?? 28)) / 100) * n.budget.research) / 100 / 12;
  const base = 10 * Math.sqrt(Math.max(0, spendBn));
  const factors: ResearchFactor[] = [];
  if (world.nations.get(iso)?.major)
    factors.push({ label: 'Great-power science base', factor: 1.1, detail: 'Universities, national laboratories and a deep industrial base: +10 %.' });
  // Technology-export controls scale with the sanctioners' share of world GDP (D-061).
  const sanctions = techAccess(world, state, iso);
  if (sanctions < 0.999)
    factors.push({ label: 'Sanctions', factor: sanctions, detail: 'Nations under sanctions lose access to foreign equipment, journals and collaborators: −30 % × the sanctioners’ share of world GDP.' });
  // Shortages of the current project's inputs (chips, rare earths, …) slow the labs (D-061).
  const branch = n.researchCurrent ? world.techs.get(n.researchCurrent)?.branch : undefined;
  const inputs = branch ? researchThroughput(world, state, iso, branch) : 1;
  if (inputs < 0.999)
    factors.push({ label: 'Input shortages', factor: inputs, detail: 'The current project needs chips, rare earths or fuel the economy cannot get.' });
  // Closed semiconductor chokepoints (Taiwan Strait, Malacca) starve chip importers (D-052).
  const chips = 1 - semiconductorDisruption(world, state, iso);
  if (chips < 0.999)
    factors.push({ label: 'Chip disruption', factor: chips, detail: 'A closed semiconductor chokepoint cuts the supply of advanced chips to the labs.' });
  // A naval blockade cuts the imports research depends on (D-059).
  if (n.blockaded) factors.push({ label: 'Blockade', factor: 0.85, detail: 'Enemy fleets cut the imports research depends on: −15 %.' });
  const speed = 1 + (n.modifiers.researchSpeed ?? 0);
  if (speed > 1.001)
    factors.push({ label: 'Research technologies', factor: speed, detail: 'Researched technologies that speed up science (AI, packaging, launch, …).' });
  const total = factors.reduce((p, f) => p * f.factor, base);
  return { base, factors, total };
}

export function researchPointsPerMonth(world: World, state: GameState, iso: Iso3): number {
  return researchBreakdown(world, state, iso).total;
}

// --- costs ---------------------------------------------------------------------------------------

/** Share of world GDP held by nations that sanction or export-control `iso`'s technology access. */
export function exportControlShare(state: GameState, iso: Iso3): number {
  let total = 0;
  let cut = 0;
  const controls = state.techControls ?? [];
  for (const n of Object.values(state.nations)) {
    if (!n.alive) continue;
    total += n.gdp;
    if (n.iso3 === iso) continue;
    if (isSanctioned(state, n.iso3, iso) || controls.includes(`${n.iso3}>${iso}`)) cut += n.gdp;
  }
  return total > 0 ? cut / total : 0;
}

export interface TechCost {
  readonly base: number;
  /** Allies that already field it and do not sanction us. */
  readonly sharingAllies: Iso3[];
  readonly allyDiscount: number;
  readonly diffusionDiscount: number;
  /** Share already covered by stolen or shared designs. */
  readonly credit: number;
  /** Cost multiplier from export controls (1 = none). */
  readonly exportControl: number;
  readonly total: number;
}

export function techCostBreakdown(world: World, state: GameState, iso: Iso3, techId: TechId): TechCost {
  const t = world.techs.get(techId);
  const n = state.nations[iso];
  if (!t || !n) return { base: Infinity, sharingAllies: [], allyDiscount: 0, diffusionDiscount: 0, credit: 0, exportControl: 1, total: Infinity };
  const sharingAllies = alliesOf(world, state, iso).filter(
    (a) => state.nations[a]?.techs.includes(techId) && !isSanctioned(state, a, iso) && !(state.techControls ?? []).includes(`${a}>${iso}`),
  );
  const allyDiscount = Math.min(ALLY_DISCOUNT_MAX, ALLY_DISCOUNT * sharingAllies.length);
  let knowing = 0;
  let total = 0;
  for (const o of Object.values(state.nations)) {
    if (!o.alive) continue;
    total += o.gdp;
    if (o.techs.includes(techId)) knowing += o.gdp;
  }
  const diffusionDiscount = total > 0 && knowing / total >= 0.5 ? DIFFUSION_DISCOUNT : 0;
  const credit = clamp(n.techCredit?.[techId] ?? 0, 0, 0.6);
  const exportControl = CONTROLLED_BRANCHES.includes(t.branch)
    ? 1 + EXPORT_CONTROL_PENALTY * exportControlShare(state, iso) * (1 - clamp(n.modifiers.sanctionResistance ?? 0, 0, 0.8))
    : 1;
  const mult = Math.max(0.35, 1 - allyDiscount - diffusionDiscount - credit) * exportControl;
  return { base: t.cost, sharingAllies, allyDiscount, diffusionDiscount, credit, exportControl, total: Math.round(t.cost * mult) };
}

export function techCost(world: World, state: GameState, iso: Iso3, techId: TechId): number {
  return techCostBreakdown(world, state, iso, techId).total;
}

// --- availability, unlocks, abilities --------------------------------------------------------------

export const prerequisitesMet = (t: TechMeta, n: NationState): boolean => t.requires.every((r) => n.techs.includes(r));

export function availableTechs(world: World, state: GameState, iso: Iso3): string[] {
  const n = state.nations[iso]!;
  return world.techList.filter((t) => !n.techs.includes(t.id) && prerequisitesMet(t, n)).map((t) => t.id);
}

export function hasAbility(world: World, state: GameState, iso: Iso3, ability: string): boolean {
  const a = world.abilities.get(ability);
  return !!a && !!state.nations[iso]?.techs.includes(a.tech);
}

/** Why `iso` cannot build `type` (a missing technology), or null. */
export function unitLockReason(world: World, state: GameState, iso: Iso3, type: string): string | null {
  const req = world.unitTypes.get(type)?.requiresTech;
  if (!req || state.nations[iso]?.techs.includes(req)) return null;
  return `Requires the ${world.techs.get(req)?.name ?? req} technology.`;
}

export const unitAvailable = (world: World, state: GameState, iso: Iso3, type: string): boolean =>
  unitLockReason(world, state, iso, type) === null;

/**
 * Every technology still missing on the way to `techId`, prerequisites first (cheapest branch
 * first among equals), ending with `techId` itself. Empty when it is already known.
 */
export function pathTo(world: World, n: NationState, techId: TechId): TechId[] {
  const out: TechId[] = [];
  const seen = new Set<TechId>();
  const visit = (id: TechId) => {
    if (seen.has(id) || n.techs.includes(id)) return;
    seen.add(id);
    const t = world.techs.get(id);
    if (!t) return;
    const reqs = [...t.requires].sort((a, b) => {
      const ta = world.techs.get(a)!;
      const tb = world.techs.get(b)!;
      return ta.era - tb.era || ta.cost - tb.cost || (a < b ? -1 : 1);
    });
    for (const r of reqs) visit(r);
    out.push(id);
  };
  visit(techId);
  return out;
}

/** Queue `techId` and its missing prerequisites; starts the first one if nothing is being researched. */
export function queueResearch(world: World, state: GameState, iso: Iso3, techId: TechId, append = false): void {
  const n = state.nations[iso]!;
  if (!world.techs.has(techId)) throw new Error('Unknown tech');
  const path = pathTo(world, n, techId);
  if (path.length === 0) return;
  const base = append ? n.researchQueue.filter((id) => !path.includes(id)) : [];
  const keepCurrent = append || (n.researchCurrent !== null && path.includes(n.researchCurrent));
  n.researchQueue = [...base, ...path.filter((id) => !(keepCurrent && id === n.researchCurrent))];
  if (!keepCurrent) n.researchCurrent = null;
  advanceQueue(world, state, iso);
}

/** Start the next queued project whose prerequisites are met; drops queued techs already known. */
export function advanceQueue(world: World, state: GameState, iso: Iso3): void {
  const n = state.nations[iso]!;
  n.researchQueue = n.researchQueue.filter((id) => !n.techs.includes(id) && world.techs.has(id) && id !== n.researchCurrent);
  if (n.researchCurrent) return;
  const i = n.researchQueue.findIndex((id) => prerequisitesMet(world.techs.get(id)!, n));
  if (i < 0) return;
  n.researchCurrent = n.researchQueue[i]!;
  n.researchQueue.splice(i, 1);
}

export function recomputeModifiers(world: World, state: GameState, iso: Iso3): void {
  const n = state.nations[iso]!;
  const mods: Record<string, number> = {};
  for (const id of n.techs) {
    const t = world.techs.get(id);
    if (!t) continue;
    for (const e of t.effects) mods[e.key] = (mods[e.key] ?? 0) + e.value;
  }
  n.modifiers = mods;
}

/** A calibrated modifier relative to the technologies held in January 2027. */
export function techDelta(n: NationState, key: (typeof CALIBRATED_KEYS)[number]): number {
  return (n.modifiers[key] ?? 0) - (n.techBaseline?.[key] ?? 0);
}

/** Technologies a nation fields at the start (data/tech-start.json), with prerequisites closed. */
export function startingTechList(world: World, iso: Iso3): TechId[] {
  const list = world.startingTechs.get(iso) ?? [];
  const out = new Set<TechId>();
  const add = (id: TechId) => {
    const t = world.techs.get(id);
    if (!t || out.has(id)) return;
    for (const r of t.requires) add(r);
    out.add(id);
  };
  for (const id of list) add(id);
  return [...out];
}

/** Give every nation its January 2027 technologies and record the calibrated baseline. */
export function grantStartingTechs(world: World, state: GameState): void {
  for (const n of Object.values(state.nations)) {
    n.techs = startingTechList(world, n.iso3);
    recomputeModifiers(world, state, n.iso3);
    n.techBaseline = Object.fromEntries(CALIBRATED_KEYS.map((k) => [k, n.modifiers[k] ?? 0]));
  }
}

export function completeTech(world: World, state: GameState, iso: Iso3, techId: TechId, via?: string): void {
  const n = state.nations[iso]!;
  if (n.techs.includes(techId)) return;
  n.techs.push(techId);
  if (n.techCredit) delete n.techCredit[techId];
  if (n.researchCurrent === techId) n.researchCurrent = null;
  recomputeModifiers(world, state, iso);
  const t = world.techs.get(techId);
  if (iso === state.player) {
    const unlocks = t
      ? [
          ...t.unlocks.units.map((u) => world.unitTypes.get(u)?.name ?? u),
          ...t.unlocks.abilities.map((a) => world.abilities.get(a)?.name ?? a),
        ]
      : [];
    log(state, {
      kind: 'research',
      text: `Research complete: ${t?.name ?? techId}${via ? ` (${via})` : ''}.${unlocks.length ? ` Unlocked: ${unlocks.join(', ')}.` : ''}`,
      nations: [iso],
      alert: true,
    });
  } else if (world.nations.get(iso)?.major && (t?.era ?? 0) >= 2) {
    headline(state, `${nationName(world, iso)} fields ${t?.name ?? techId}`);
  }
}

export function runResearch(world: World, state: GameState): string[] {
  const completed: string[] = [];
  for (const n of Object.values(state.nations)) {
    if (!n.alive) continue;
    n.researchPoints += researchPointsPerMonth(world, state, n.iso3);
    if (n.espionageCooldown > 0) n.espionageCooldown -= 1;
    advanceQueue(world, state, n.iso3);
    // Banked points can finish more than one project in a month (at most two).
    for (let k = 0; k < 2 && n.researchCurrent; k++) {
      const t = world.techs.get(n.researchCurrent);
      if (!t) {
        n.researchCurrent = null;
        break;
      }
      const cost = techCost(world, state, n.iso3, t.id);
      if (n.researchPoints < cost) break;
      n.researchPoints -= cost;
      completeTech(world, state, n.iso3, t.id);
      if (n.iso3 === state.player) completed.push(t.name);
      n.researchCurrent = null;
      advanceQueue(world, state, n.iso3);
    }
  }
  return completed;
}
