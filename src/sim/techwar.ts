/**
 * The technology war (D-079): stealing research at diplomatic risk, sharing it with allies, and
 * export controls that slow a rival's chips and AI. Player operations draw on the seeded RNG; AI
 * decisions and outcomes use hash draws so they never shift the simulation's random stream.
 */
import { nationName, traitsOf, type World } from './world';
import type { GameState, Iso3, TechId } from './types';
import { adjustRelation, alliesOf, atWar, clamp, getRelation, headline, log, roll } from './query';
import { opinionOf, remember } from './personality';
import { completeTech, hasAbility, prerequisitesMet } from './research';

/** Months between two thefts of technology. */
export const STEAL_COOLDOWN = 4;
/** Share of a technology's cost a successful theft covers. */
export const STEAL_CREDIT = 0.5;
/** Relations (with the victim) and legitimacy lost when a theft is exposed. */
export const STEAL_EXPOSED_RELATIONS = -15;
export const STEAL_EXPOSED_LEGITIMACY = -2;
/** Relations a nation must have with a non-ally before it may hand over technology. */
export const SHARE_MIN_RELATIONS = 50;

/** An operation costs 0.01 % of GDP (at least US$ 0.3 bn). */
export function stealCost(state: GameState, iso: Iso3): number {
  return Math.max(0.3, (state.nations[iso]?.gdp ?? 0) * 0.0001);
}

export interface StealOdds {
  readonly success: number;
  readonly detection: number;
  readonly factors: readonly string[];
}

export function stealOdds(world: World, state: GameState, iso: Iso3, target: Iso3): StealOdds {
  const me = state.nations[iso]!.modifiers;
  const them = state.nations[target]?.modifiers ?? {};
  const factors: string[] = ['Base 35 %'];
  let success = 0.35;
  const esp = (me.espionage ?? 0) + 0.5 * (me.cyberAttack ?? 0);
  if (esp > 0) factors.push(`+${Math.round(esp * 100)} your espionage and cyber-attack technology`);
  success += esp;
  const def = 0.3 * (them.cyberDefence ?? 0) + (them.counterIntel ?? 0);
  if (def > 0) factors.push(`−${Math.round(def * 100)} their cyber defence and counter-intelligence`);
  success -= def;
  if ((state.nations[iso]!.intelOps[target] ?? 0) > 0) {
    success += 0.15;
    factors.push('+15 spy network in place');
  }
  if (hasAbility(world, state, target, 'quantumComms')) {
    success -= 0.15;
    factors.push('−15 quantum-secure communications');
  }
  const detection = clamp(0.4 + (them.counterIntel ?? 0) + 0.3 * (them.cyberDefence ?? 0) - 0.5 * (me.espionage ?? 0), 0.1, 0.9);
  return { success: clamp(success, 0.05, 0.85), detection, factors };
}

/** Technologies `target` fields that `iso` could use (prerequisites met, not already half-stolen). */
export function stealableTechs(world: World, state: GameState, iso: Iso3, target: Iso3): TechId[] {
  const n = state.nations[iso];
  const t = state.nations[target];
  if (!n || !t) return [];
  return t.techs.filter((id) => {
    const meta = world.techs.get(id);
    return !!meta && !n.techs.includes(id) && prerequisitesMet(meta, n) && (n.techCredit?.[id] ?? 0) < STEAL_CREDIT;
  });
}

export function canStealTech(world: World, state: GameState, iso: Iso3, target: Iso3, tech: TechId): string | null {
  const n = state.nations[iso];
  const t = state.nations[target];
  if (!n || !t) return 'Unknown nation.';
  if (iso === target) return 'That is you.';
  if (!t.alive) return 'That nation no longer exists.';
  if (n.espionageCooldown > 0) return `Your services are lying low after the last operation: ${n.espionageCooldown} month${n.espionageCooldown === 1 ? '' : 's'} to go.`;
  const meta = world.techs.get(tech);
  if (!meta) return 'Unknown technology.';
  if (!t.techs.includes(tech)) return `${nationName(world, target)} does not field ${meta.name}.`;
  if (n.techs.includes(tech)) return `You already field ${meta.name}.`;
  if (!prerequisitesMet(meta, n)) return `Stolen designs are useless without the prerequisites: ${meta.requires.filter((r) => !n.techs.includes(r)).map((r) => world.techs.get(r)?.name ?? r).join(', ')}.`;
  if ((n.techCredit?.[tech] ?? 0) >= STEAL_CREDIT) return `You already hold stolen designs for ${meta.name}.`;
  const cost = stealCost(state, iso);
  if (n.treasury < cost) return `An operation costs $${cost.toFixed(1)} bn.`;
  return null;
}

/**
 * Attempt to steal `tech` from `target`. `draws` (two numbers in [0, 1)) replace the RNG for AI
 * operations. Returns whether the theft succeeded and whether it was exposed.
 */
export function applyStealTech(
  world: World,
  state: GameState,
  iso: Iso3,
  target: Iso3,
  tech: TechId,
  draws?: readonly [number, number],
): { success: boolean; exposed: boolean } {
  const why = canStealTech(world, state, iso, target, tech);
  if (why) throw new Error(why);
  const n = state.nations[iso]!;
  const meta = world.techs.get(tech)!;
  n.treasury -= stealCost(state, iso);
  n.espionageCooldown = STEAL_COOLDOWN;
  const odds = stealOdds(world, state, iso, target);
  const success = (draws ? draws[0] : roll(state)) < odds.success;
  const exposed = (draws ? draws[1] : roll(state)) < odds.detection;
  if (success) n.techCredit = { ...(n.techCredit ?? {}), [tech]: STEAL_CREDIT };
  if (exposed) {
    adjustRelation(world, state, iso, target, STEAL_EXPOSED_RELATIONS);
    remember(state, target, iso, 'grievance', 15, 'stole our technology');
    n.legitimacy = clamp(n.legitimacy + STEAL_EXPOSED_LEGITIMACY, 0, 100);
    for (const a of alliesOf(world, state, target)) if (a !== iso) adjustRelation(world, state, iso, a, -4);
    state.globalTension = clamp(state.globalTension + 1, 0, 100);
  }
  const involvesPlayer = iso === state.player || target === state.player;
  if (iso === state.player || exposed)
    log(state, {
      kind: 'research',
      text:
        iso === state.player
          ? `${success ? 'Operation succeeds' : 'Operation fails'}: ${success ? `stolen ${meta.name} designs cover half its research cost` : `no usable ${meta.name} data reached us`}${exposed ? `. ${nationName(world, target)} has exposed the operation (relations ${STEAL_EXPOSED_RELATIONS}, legitimacy ${STEAL_EXPOSED_LEGITIMACY})` : '; the operation was not detected'}.`
          : `${nationName(world, target)} exposes an operation by ${nationName(world, iso)} to steal ${meta.name} research${success ? '; some data is believed lost' : ''}.`,
      nations: [iso, target],
      alert: involvesPlayer,
    });
  if (exposed && (world.nations.get(iso)?.major || world.nations.get(target)?.major))
    headline(state, `${nationName(world, target)} accuses ${nationName(world, iso)} of stealing ${meta.name} secrets`);
  return { success, exposed };
}

// --- sharing -----------------------------------------------------------------------------------

export function canShareTech(world: World, state: GameState, iso: Iso3, to: Iso3, tech: TechId): string | null {
  const n = state.nations[iso];
  const r = state.nations[to];
  if (!n || !r || !r.alive) return 'Unknown nation.';
  if (iso === to) return 'That is you.';
  const meta = world.techs.get(tech);
  if (!meta) return 'Unknown technology.';
  if (!n.techs.includes(tech)) return `You do not field ${meta.name}.`;
  if (r.techs.includes(tech)) return `${nationName(world, to)} already fields ${meta.name}.`;
  if (!prerequisitesMet(meta, r)) return `${nationName(world, to)} lacks the prerequisites for ${meta.name}.`;
  if (atWar(state, iso, to)) return 'You are at war.';
  const ally = alliesOf(world, state, iso).includes(to);
  if (!ally && getRelation(world, state, iso, to) < SHARE_MIN_RELATIONS)
    return `Only allies, or partners with relations of at least ${SHARE_MIN_RELATIONS}, receive technology.`;
  return null;
}

/** Technologies `iso` could hand to `to` right now. */
export function shareableTechs(world: World, state: GameState, iso: Iso3, to: Iso3): TechId[] {
  return (state.nations[iso]?.techs ?? []).filter((id) => canShareTech(world, state, iso, to, id) === null);
}

export function applyShareTech(world: World, state: GameState, iso: Iso3, to: Iso3, tech: TechId): void {
  const why = canShareTech(world, state, iso, to, tech);
  if (why) throw new Error(why);
  const meta = world.techs.get(tech)!;
  completeTech(world, state, to, tech, `shared by ${nationName(world, iso)}`);
  adjustRelation(world, state, iso, to, 6);
  remember(state, to, iso, 'favour', 8 + 2 * meta.era, 'shared technology');
  // The recipient's enemies resent the transfer.
  for (const o of Object.values(state.nations)) {
    if (!o.alive || o.iso3 === iso || o.iso3 === to) continue;
    if (getRelation(world, state, o.iso3, to) <= -40 && meta.era >= 2) adjustRelation(world, state, iso, o.iso3, -3);
  }
  if (iso === state.player || to === state.player)
    log(state, {
      kind: 'research',
      text: `${nationName(world, iso)} shares ${meta.name} with ${nationName(world, to)}.`,
      nations: [iso, to],
      alert: true,
    });
}

// --- export controls ---------------------------------------------------------------------------

export function setTechControls(world: World, state: GameState, iso: Iso3, target: Iso3, on: boolean): void {
  if (iso === target) throw new Error('That is you.');
  const key = `${iso}>${target}`;
  state.techControls ??= [];
  const has = state.techControls.includes(key);
  if (on === has) return;
  if (on) {
    state.techControls.push(key);
    adjustRelation(world, state, iso, target, -8);
    remember(state, target, iso, 'grievance', 6, 'export controls on our industry');
  } else {
    state.techControls = state.techControls.filter((k) => k !== key);
    adjustRelation(world, state, iso, target, 4);
  }
  log(state, {
    kind: 'research',
    text: `${nationName(world, iso)} ${on ? 'imposes' : 'lifts'} export controls on chips, chip-making tools and AI technology for ${nationName(world, target)}.`,
    nations: [iso, target],
    alert: iso === state.player || target === state.player,
  });
}

// --- AI ------------------------------------------------------------------------------------------

/** Deterministic per-(turn, nation, salt) draw that does not consume the simulation RNG. */
export function hashDraw(turn: number, iso: string, salt: string): number {
  let h = 2166136261 ^ Math.imul(turn + 1, 2654435761);
  for (const s of [iso, salt]) for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/**
 * AI great powers steal from rivals ahead of them (more often when paranoid or aggressive), and
 * share older technology with allies (more often when loyal). Runs after research each month.
 */
export function runTechWar(world: World, state: GameState): void {
  for (const iso of world.majors) {
    const n = state.nations[iso];
    if (!n?.alive || iso === state.player) continue;
    const t = traitsOf(world, iso, state);
    // Espionage.
    if (n.espionageCooldown <= 0 && hashDraw(state.turn, iso, 'steal') < 0.015 + t.paranoia / 4000 + t.aggression / 4000) {
      let best: { target: Iso3; tech: TechId; score: number } | null = null;
      for (const o of world.majors) {
        if (o === iso || !state.nations[o]?.alive) continue;
        const op = opinionOf(world, state, iso, o);
        if (op > 0) continue;
        for (const id of stealableTechs(world, state, iso, o)) {
          const meta = world.techs.get(id)!;
          const score = meta.era * 10 + meta.cost / 100 - op / 20;
          if (!best || score > best.score || (score === best.score && id < best.tech)) best = { target: o, tech: id, score };
        }
      }
      if (best && canStealTech(world, state, iso, best.target, best.tech) === null)
        applyStealTech(world, state, iso, best.target, best.tech, [hashDraw(state.turn, iso, 'ok'), hashDraw(state.turn, iso, 'caught')]);
    }
    // Sharing: one older (era ≤ 2) technology with the ally furthest behind.
    if (hashDraw(state.turn, iso, 'share') < 0.01 + t.allianceLoyalty / 4000) {
      let best: { to: Iso3; tech: TechId; gap: number } | null = null;
      for (const a of alliesOf(world, state, iso)) {
        if (opinionOf(world, state, iso, a) < 30) continue;
        const options = shareableTechs(world, state, iso, a).filter((id) => (world.techs.get(id)?.era ?? 9) <= 2);
        if (options.length === 0) continue;
        const gap = n.techs.length - (state.nations[a]?.techs.length ?? 0);
        const tech = [...options].sort((x, y) => (world.techs.get(x)!.cost - world.techs.get(y)!.cost) || (x < y ? -1 : 1))[0]!;
        if (!best || gap > best.gap || (gap === best.gap && a < best.to)) best = { to: a, tech, gap };
      }
      if (best) applyShareTech(world, state, iso, best.to, best.tech);
    }
  }
}
