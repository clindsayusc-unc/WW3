/**
 * Leader personality (D-071): traits and agendas turn into goal weights, and each leader keeps a
 * memory of grievances and favours that decays at a rate set by its traits. Everything here is
 * deterministic and cheap: memories are short per-holder lists.
 */
import { traitsOf, type AgendaMeta, type World } from './world';
import type { AgendaId, BlocId, GameState, Iso3, MemoryEntry } from './types';
import { clamp, getRelation } from './query';

/** Weights (0..~2) the strategic AI gives to each goal. */
export interface GoalWeights {
  /** Defend what we have: threat response, pacts, missile defence. */
  readonly security: number;
  /** Take territory or force concessions. */
  readonly expansion: number;
  /** Growth, trade, technology. */
  readonly prosperity: number;
  /** Keep alliances together; honour obligations; aid partners. */
  readonly cohesion: number;
  /** Keep the regime in power: deterrence, resistance to pressure. */
  readonly survival: number;
  /** Stay out of other people's wars. */
  readonly restraint: number;
}

export function agendasOf(world: World, iso: Iso3): readonly AgendaMeta[] {
  return world.agendas.get(iso) ?? [];
}

/** Weight (0..1) of an agenda for a nation, 0 when absent. */
export function agendaWeight(world: World, iso: Iso3, id: AgendaId): number {
  let w = 0;
  for (const a of agendasOf(world, iso)) if (a.id === id) w = Math.max(w, a.weight);
  return w;
}

/** Strongest agenda pull `iso` has against `target` (named target or sphere member), 0..1. */
export function agendaClaim(world: World, iso: Iso3, target: Iso3): { weight: number; agenda: AgendaMeta | null } {
  let best: { weight: number; agenda: AgendaMeta | null } = { weight: 0, agenda: null };
  for (const a of agendasOf(world, iso)) {
    let w = 0;
    if (a.targets.includes(target)) w = a.id === 'reunification' ? 1 : a.id === 'territorialRecovery' ? 0.8 : 0.6;
    else if (a.sphere.includes(target)) w = 0.5;
    w *= a.weight;
    if (w > best.weight) best = { weight: w, agenda: a };
  }
  return best;
}

export function goalWeights(world: World, iso: Iso3): GoalWeights {
  const t = traitsOf(world, iso);
  const ag = (id: AgendaId) => agendaWeight(world, iso, id);
  return {
    security: 0.5 + t.paranoia / 100 + 0.3 * ag('regimeSurvival'),
    expansion: (t.aggression / 100) * (0.6 + 0.6 * Math.max(ag('reunification'), ag('regionalHegemony'), ag('territorialRecovery'))),
    prosperity: 0.4 + t.economicPriority / 100 + 0.4 * ag('economicDevelopment'),
    cohesion: t.allianceLoyalty / 100 + 0.6 * ag('alliancePreservation') - 0.3 * ag('transactional'),
    survival: 0.3 + ag('regimeSurvival') + t.paranoia / 200,
    restraint: (100 - t.riskTolerance) / 100 + 0.8 * ag('nonAlignment') + 0.3 * ag('economicDevelopment'),
  };
}

// --- memory ----------------------------------------------------------------------------------

const MAX_MEMORIES = 14;
const MAX_WEIGHT = 60;

/**
 * Records a grievance or favour. Repeated memories with the same reason accumulate (capped) and
 * refresh their date instead of filling the list.
 */
export function remember(
  state: GameState,
  holder: Iso3,
  about: Iso3,
  kind: MemoryEntry['kind'],
  weight: number,
  reason: string,
): void {
  if (holder === about || weight <= 0) return;
  const list = (state.memory[holder] ??= []);
  const same = list.find((m) => m.about === about && m.kind === kind && m.reason === reason);
  if (same) {
    same.weight = Math.min(MAX_WEIGHT, Math.round((same.weight + weight) * 10) / 10);
    same.turn = state.turn;
    return;
  }
  list.push({ about, kind, weight: Math.min(MAX_WEIGHT, Math.round(weight * 10) / 10), reason, turn: state.turn });
  if (list.length > MAX_MEMORIES) {
    let weakest = 0;
    for (let i = 1; i < list.length; i++) if (list[i]!.weight < list[weakest]!.weight) weakest = i;
    list.splice(weakest, 1);
  }
}

/** Monthly decay rates from traits: proud, paranoid leaders nurse grievances; pragmatists move on. */
export function decayRates(world: World, iso: Iso3): { grievance: number; favour: number } {
  const t = traitsOf(world, iso);
  return {
    grievance: clamp(0.04 + t.pragmatism / 1500 - t.paranoia / 2500 - t.nationalism / 2500, 0.015, 0.1),
    favour: clamp(0.05 + t.paranoia / 2000 - t.allianceLoyalty / 3000, 0.03, 0.12),
  };
}

export function decayMemories(world: World, state: GameState): void {
  for (const [holder, list] of Object.entries(state.memory)) {
    if (list.length === 0) continue;
    const r = decayRates(world, holder);
    for (const m of list) m.weight = Math.round(m.weight * (1 - (m.kind === 'grievance' ? r.grievance : r.favour)) * 100) / 100;
    const kept = list.filter((m) => m.weight >= 0.5 && state.nations[m.about]?.alive !== false);
    if (kept.length !== list.length) state.memory[holder] = kept;
  }
}

/** Net memory of `holder` toward `about`: favours − grievances, clamped to ±50. */
export function memoryBalance(state: GameState, holder: Iso3, about: Iso3): number {
  const list = state.memory[holder];
  if (!list) return 0;
  let v = 0;
  for (const m of list) if (m.about === about) v += m.kind === 'favour' ? m.weight : -m.weight;
  return clamp(v, -50, 50);
}

/** What a leader actually thinks of another nation: relations plus remembered history. */
export function opinionOf(world: World, state: GameState, holder: Iso3, about: Iso3): number {
  if (holder === about) return 100;
  return clamp(getRelation(world, state, holder, about) + memoryBalance(state, holder, about), -100, 100);
}

/** The memories `holder` keeps about `about`, strongest first (for the UI). */
export function memoriesAbout(state: GameState, holder: Iso3, about: Iso3): MemoryEntry[] {
  return (state.memory[holder] ?? []).filter((m) => m.about === about).sort((a, b) => b.weight - a.weight);
}

// --- blocs -------------------------------------------------------------------------------------

export function blocMembers(world: World, state: GameState, bloc: BlocId): readonly Iso3[] {
  return state.blocs?.[bloc]?.members ?? world.nationList.filter((n) => n.blocs.includes(bloc)).map((n) => n.iso3);
}

export function inBloc(world: World, state: GameState, iso: Iso3, bloc: BlocId): boolean {
  return blocMembers(world, state, bloc).includes(iso);
}

/** Legitimacy adjustment with bounds. */
export function adjustLegitimacy(state: GameState, iso: Iso3, delta: number): void {
  const n = state.nations[iso];
  if (!n) return;
  n.legitimacy = clamp(Math.round(((n.legitimacy ?? 50) + delta) * 10) / 10, 0, 100);
}
