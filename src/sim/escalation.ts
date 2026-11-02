/** Global tension, DEFCON and nuclear use (D-028). */
import { nationName, traitsOf, type World } from './world';
import { invalidateGeoCache } from './geography';
import type { Defcon, GameState, Iso3, RegionId } from './types';
import { adjustLegitimacy, agendaWeight, opinionOf, remember } from './personality';
import { imposeSanction } from './diplomacy';
import {
  adjustRelation,
  alliesOf,
  atWar,
  clamp,
  controlShare,
  enemiesOf,
  headline,
  isAtWar,
  log,
  roll,
  unitsIn,
} from './query';

export const FULL_EXCHANGE_THRESHOLD = 8;

export function updateTension(world: World, state: GameState): void {
  // Flashpoints: rise when their sides fight or hate each other, otherwise cool slowly.
  for (const f of world.flashpoints) {
    const [sideA = [], sideB = []] = f.sides;
    let war = false;
    let worst = 100;
    let living = 0;
    for (const a of sideA)
      for (const b of sideB) {
        if (!state.nations[a]?.alive || !state.nations[b]?.alive) continue;
        living++;
        if (atWar(state, a, b)) war = true;
        const r = state.relations[a < b ? `${a}|${b}` : `${b}|${a}`];
        if (r !== undefined) worst = Math.min(worst, r);
      }
    // Tension drifts toward a target set by the state of the rivalry (D-028).
    const target =
      living === 0 ? 15 : war ? 95 : worst < -80 ? 72 : worst < -60 ? 58 : worst < -40 ? 45 : 30;
    const cur = state.flashpoints[f.id] ?? f.tension;
    state.flashpoints[f.id] = clamp(cur + clamp(target - cur, -1.5, 2), 0, 100);
  }
  const avgFlash =
    Object.values(state.flashpoints).reduce((a, b) => a + b, 0) /
    Math.max(1, Object.keys(state.flashpoints).length);
  let majorsAtWar = 0;
  let mobilized = 0;
  for (const iso of world.majors) {
    if (isAtWar(state, iso)) majorsAtWar++;
    if ((state.nations[iso]?.mobilization ?? 0) > 0) mobilized++;
  }
  const target = clamp(
    avgFlash * 0.6 + majorsAtWar * 6 + mobilized * 2 + state.detonations * 15,
    0,
    100,
  );
  // Tension moves toward its target by at most 3 points per month.
  const diff = target - state.globalTension;
  state.globalTension = clamp(state.globalTension + clamp(diff, -2, 3), 0, 100);

  for (const n of Object.values(state.nations)) {
    if (!n.alive) continue;
    n.defcon = computeDefcon(world, state, n.iso3);
    if (n.defconMod !== 0) n.defconMod = n.defconMod > 0 ? n.defconMod - 1 : n.defconMod + 1;
  }
}

export interface DefconFactor {
  readonly label: string;
  /** The DEFCON level this factor alone would set. */
  readonly level: Defcon;
  readonly active: boolean;
}

/** Every rule that sets a nation's DEFCON, with whether it applies now (D-076). */
export function defconFactors(world: World, state: GameState, iso: Iso3): DefconFactor[] {
  const enemies = enemiesOf(state, iso);
  const nuclearEnemy = enemies.some((e) => (state.nations[e]?.warheads ?? 0) > 0);
  const majorEnemy = enemies.some((e) => world.nations.get(e)?.major);
  const held = controlShare(world, state, iso);
  const t = state.globalTension;
  return [
    { label: `Global tension ≥ 35 (now ${Math.round(t)})`, level: 4, active: t >= 35 },
    { label: 'At war with anyone', level: 4, active: enemies.length > 0 },
    { label: `Global tension ≥ 60`, level: 3, active: t >= 60 },
    { label: 'At war with a great power', level: 3, active: majorEnemy },
    { label: 'Global tension ≥ 80', level: 2, active: t >= 80 },
    { label: 'At war with a nuclear power', level: 2, active: nuclearEnemy },
    { label: 'Nuclear weapons have been used', level: 2, active: state.detonations > 0 },
    { label: `At war with a nuclear power and holding < 75 % of the homeland (now ${Math.round(held * 100)} %)`, level: 1, active: nuclearEnemy && held < 0.75 },
    { label: 'Global tension ≥ 95', level: 1, active: t >= 95 },
    { label: 'At war with a nuclear power after nuclear use', level: 1, active: nuclearEnemy && state.detonations > 0 },
  ];
}

export function computeDefcon(world: World, state: GameState, iso: Iso3): Defcon {
  const n = state.nations[iso]!;
  let d = 5;
  for (const f of defconFactors(world, state, iso)) if (f.active && f.level < d) d = f.level;
  const adjusted = clamp(d - n.defconMod, 1, 5);
  return adjusted as Defcon;
}

// --- the escalation ladder (D-076) -------------------------------------------------------------

export interface Rung {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** What pushes the world up to this rung. */
  readonly up: string;
  /** What brings it back down. */
  readonly down: string;
}

export const ESCALATION_LADDER: readonly Rung[] = [
  { id: 'posturing', name: 'Posturing', description: 'Exercises, statements, deployments. No sanctions between great powers.', up: 'Start of the game; hostile statements, war plans being prepared.', down: '—' },
  { id: 'sanctions', name: 'Sanctions', description: 'Great powers sanction or embargo each other.', up: 'A great power sanctions or embargoes another great power.', down: 'Sanctions lifted as relations recover above 10.' },
  { id: 'proxy', name: 'Proxy conflict', description: 'Great powers arm opposite sides of someone else’s war.', up: 'A great power sends aid to a nation at war with another great power.', down: 'The proxy war ends in peace, or aid is suspended.' },
  { id: 'limited', name: 'Limited conventional war', description: 'A great power is fighting a war.', up: 'Any war involving a great power.', down: 'Peace between the great power and its enemies.' },
  { id: 'general', name: 'General war', description: 'Great powers are at war with each other.', up: 'Two great powers at war, or three great powers at war at once.', down: 'Peace between the great powers.' },
  { id: 'tactical', name: 'Tactical nuclear use', description: 'Nuclear weapons have been used.', up: 'One to three nuclear detonations.', down: 'Never: there is no way back below this rung.' },
  { id: 'strategic', name: 'Strategic exchange', description: 'Cities are being destroyed. Eight detonations end the game for everyone.', up: 'Four or more detonations.', down: 'Never.' },
];

/** Current rung of the ladder (index into ESCALATION_LADDER) and why. */
export function escalationRung(world: World, state: GameState): { index: number; why: string } {
  if (state.detonations >= 4) return { index: 6, why: `${state.detonations} nuclear detonations.` };
  if (state.detonations > 0) return { index: 5, why: `${state.detonations} nuclear detonation${state.detonations > 1 ? 's' : ''}.` };
  const majors = world.majors.filter((m) => state.nations[m]?.alive);
  for (const w of state.wars) {
    const ma = w.attackers.filter((x) => majors.includes(x));
    const md = w.defenders.filter((x) => majors.includes(x));
    if (ma.length > 0 && md.length > 0) return { index: 4, why: `${nationName(world, ma[0]!)} and ${nationName(world, md[0]!)} are at war.` };
  }
  const majorsAtWar = majors.filter((m) => isAtWar(state, m));
  if (majorsAtWar.length >= 3) return { index: 4, why: `${majorsAtWar.length} great powers at war.` };
  if (majorsAtWar.length > 0) return { index: 3, why: `${nationName(world, majorsAtWar[0]!)} is at war.` };
  for (const f of state.aid ?? []) {
    if (!majors.includes(f.donor)) continue;
    if (majors.includes(f.against)) return { index: 2, why: `${nationName(world, f.donor)} arms ${nationName(world, f.recipient)} against ${nationName(world, f.against)}.` };
  }
  for (const k of [...state.sanctions, ...state.embargoes]) {
    const [a, b] = k.split('>') as [Iso3, Iso3];
    if (majors.includes(a) && majors.includes(b)) return { index: 1, why: `${nationName(world, a)} sanctions ${nationName(world, b)}.` };
  }
  return { index: 0, why: 'No great power is at war or sanctioning another.' };
}

// --- deterrence (D-076) --------------------------------------------------------------------------

/** Warheads carried by one ballistic-missile submarine formation on patrol (abstract squadron). */
export const SLBM_PER_SSBN = 120;
const SEA_SURVIVAL = 0.9;
const LAND_SURVIVAL = 0.3;

export interface SecondStrike {
  readonly warheads: number;
  readonly ssbns: number;
  readonly atSea: number;
  /** Warheads expected to survive a disarming first strike. */
  readonly survivable: number;
  /** Survivors that get through the adversary's missile defence. */
  readonly penetrating: number;
  readonly status: 'assured' | 'limited' | 'none';
}

/**
 * Second-strike capability of `iso` against an adversary's missile defence: warheads on SSBNs at
 * sea survive a first strike (90 %), land-based and air-delivered ones mostly do not (30 %).
 * ≥ 50 penetrating warheads is an assured second strike; ≥ 10 a limited one.
 */
export function secondStrike(world: World, state: GameState, iso: Iso3, adversary: Iso3 | null = null): SecondStrike {
  void world;
  const n = state.nations[iso];
  const warheads = n?.alive ? n.warheads : 0;
  let ssbns = 0;
  if (warheads > 0) for (const u of Object.values(state.units)) if (u.owner === iso && u.type === 'missileSub') ssbns += u.strength / 100;
  const atSea = Math.min(warheads, Math.round(ssbns * SLBM_PER_SSBN));
  // Modern strategic forces (mobile launchers, MIRVs, glide vehicles) survive and penetrate better (D-079).
  const det = clamp(n?.modifiers.deterrence ?? 0, 0, 0.5);
  const survivable = Math.round(atSea * SEA_SURVIVAL + (warheads - atSea) * Math.min(0.6, LAND_SURVIVAL + det));
  const md = adversary ? clamp(state.nations[adversary]?.modifiers.missileDefence ?? 0, 0, 0.8) * (1 - det) : 0;
  const penetrating = Math.round(survivable * (1 - md));
  const status = penetrating >= 50 ? 'assured' : penetrating >= 10 ? 'limited' : 'none';
  return { warheads, ssbns: Math.round(ssbns * 10) / 10, atSea, survivable, penetrating, status };
}

/**
 * Strongest second strike `target` and its nuclear allies hold against `attacker`. Extended
 * deterrence is weaker than a nation's own: an ally's assured second strike counts as assured
 * only inside NATO (formal nuclear guarantees and sharing); elsewhere it counts as limited.
 */
export function deterrentAgainst(world: World, state: GameState, target: Iso3, attacker: Iso3): SecondStrike {
  let best = secondStrike(world, state, target, attacker);
  const rank = { none: 0, limited: 1, assured: 2 } as const;
  const nato = state.blocs?.NATO?.members ?? [];
  for (const a of alliesOf(world, state, target)) {
    if (a === attacker) continue;
    let s = secondStrike(world, state, a, attacker);
    if (s.status === 'assured' && !(nato.includes(a) && nato.includes(target))) s = { ...s, status: 'limited' };
    if (rank[s.status] > rank[best.status]) best = s;
  }
  return best;
}

export interface NuclearDecision {
  readonly target: Iso3 | null;
  /** 0–~150: how close the regime is to collapse. */
  readonly desperation: number;
  /** Desperation needed before nuclear use is considered (leader's nuclear threshold, deterrence). */
  readonly threshold: number;
  readonly consider: boolean;
  readonly reason: string;
}

/**
 * Whether an AI leader would consider nuclear use now (pure; the launch itself is a seeded roll).
 * Desperation grows with lost territory, a lost capital and nuclear attacks suffered; the bar is
 * the leader's nuclear threshold, raised by 20 when the target holds an assured second strike.
 */
export function nuclearDecision(world: World, state: GameState, iso: Iso3): NuclearDecision {
  const n = state.nations[iso];
  const none = (reason: string): NuclearDecision => ({ target: null, desperation: 0, threshold: 100, consider: false, reason });
  if (!n?.alive || n.warheads <= 0) return none('No warheads.');
  const enemies = enemiesOf(state, iso).filter((e) => state.nations[e]?.alive);
  if (enemies.length === 0) return none('Not at war.');
  const t = traitsOf(world, iso, state);
  const held = controlShare(world, state, iso);
  const cap = world.capitalRegion.get(iso);
  const capLost = cap !== undefined && state.regions[cap]?.controller !== iso;
  const struck = state.nuclearLog.some((r) => r.target === iso);
  const desperation = Math.round((1 - held) * 80 + (capLost ? 30 : 0) + (struck ? 50 : 0));
  // Pick the enemy holding the most of our land, else the strongest.
  let target: Iso3 | null = null;
  let best = -1;
  for (const e of enemies) {
    let score = 0;
    for (const r of Object.values(state.regions)) if (r.owner === iso && r.controller === e) score++;
    score = score * 10 + (world.nations.get(e)?.major ? 1 : 0);
    if (score > best && canLaunchNuclear(state, iso, e) === null) {
      best = score;
      target = e;
    }
  }
  if (!target) return { target: null, desperation, threshold: 100, consider: false, reason: `DEFCON ${n.defcon}: release not authorised.` };
  const deterred = deterrentAgainst(world, state, target, iso).status === 'assured' && !struck;
  const threshold = t.nuclearThreshold + (deterred ? 20 : 0) - 10 * agendaWeight(world, iso, 'regimeSurvival');
  const consider = desperation >= threshold;
  return {
    target,
    desperation,
    threshold,
    consider,
    reason: consider
      ? `Desperation ${desperation} ≥ threshold ${Math.round(threshold)}${deterred ? ' (despite an assured enemy second strike)' : ''}.`
      : `Desperation ${desperation} < threshold ${Math.round(threshold)}${deterred ? ' (enemy second strike deters)' : ''}.`,
  };
}

/** Monthly probability that an AI leader who is considering nuclear use actually launches. */
export const AI_LAUNCH_CHANCE = 0.25;

export function canLaunchNuclear(state: GameState, iso: Iso3, target: Iso3): string | null {
  const n = state.nations[iso];
  if (!n) return 'Unknown nation.';
  if (n.warheads <= 0) return 'No warheads available.';
  if (!atWar(state, iso, target)) return 'You can only strike a nation you are at war with.';
  if (n.defcon !== 1) return `Nuclear release requires DEFCON 1 (currently DEFCON ${n.defcon}).`;
  return null;
}

/** A nuclear strike on one region. Handles consequences and possible retaliation. */
export function nuclearStrike(
  world: World,
  state: GameState,
  attacker: Iso3,
  target: Iso3,
  region: RegionId,
  depth = 0,
): void {
  const a = state.nations[attacker];
  const t = state.nations[target];
  if (!a || !t || a.warheads <= 0) return;
  const r = state.regions[region];
  if (!r) return;
  const meta = world.regions.get(region)!;
  a.warheads = Math.max(0, a.warheads - 10);
  state.detonations += 1;
  state.nuclearLog.push({ turn: state.turn, attacker, target, region, population: Math.round(meta.population * (1 - r.devastation)) });
  // Fallout over the region and, more thinly, its land neighbours (D-076); global cooling.
  r.fallout = 1;
  for (const nb of meta.neighbours) {
    const nr = state.regions[nb];
    if (nr && !world.regions.get(nb)?.sea) nr.fallout = Math.max(nr.fallout ?? 0, 0.35);
  }
  state.nuclearWinter = clamp((state.nuclearWinter ?? 0) + 0.6, 0, 8);
  const defence = t.modifiers.missileDefence ?? 0;
  const damage = clamp(0.85 * (1 - defence), 0.2, 0.9);
  r.devastation = clamp(r.devastation + damage, 0, 1);
  // Economic and human cost abstracted as a GDP level loss proportional to the region's share.
  const share = meta.populationShare;
  t.gdp *= 1 - share * damage;
  t.population = Math.round(t.population * (1 - share * damage * 0.6));
  t.stability = clamp(t.stability - 25, 0, 100);
  for (const u of unitsIn(state, region)) {
    if (roll(state) < damage) delete state.units[u.id];
    else u.strength = clamp(u.strength * (1 - damage), 1, 100);
  }
  invalidateGeoCache(state);
  a.stability = clamp(a.stability - 8, 0, 100);
  state.globalTension = 100;
  const from = world.capitalRegion.get(attacker) ?? region;
  state.strikes.push({ turn: state.turn, kind: 'nuclear', from, to: region, attacker });
  for (const n of Object.values(state.nations)) {
    if (n.iso3 === attacker) continue;
    const ally = alliesOf(world, state, target).includes(n.iso3);
    adjustRelation(world, state, attacker, n.iso3, ally ? -60 : -35);
    n.growthMods.push({
      delta: -1.0,
      monthsLeft: 12,
      reason: 'Nuclear shock to the world economy',
    });
    n.stability = clamp(n.stability - 4, 0, 100);
  }
  // Massive diplomatic isolation: legitimacy collapses, every government remembers, most sanction.
  adjustLegitimacy(state, attacker, -40);
  let sanctioning = 0;
  for (const n of Object.values(state.nations)) {
    if (!n.alive || n.iso3 === attacker) continue;
    remember(state, n.iso3, attacker, 'grievance', n.iso3 === target ? 60 : 25, 'used nuclear weapons');
    const friend = alliesOf(world, state, attacker).includes(n.iso3) || opinionOf(world, state, n.iso3, attacker) >= 40;
    if (!friend && n.iso3 !== state.player && !state.sanctions.includes(`${n.iso3}>${attacker}`)) {
      imposeSanction(world, state, n.iso3, attacker, true);
      sanctioning++;
    }
  }
  if (sanctioning > 0)
    log(state, { kind: 'diplomacy', text: `${sanctioning} nations sanction ${nationName(world, attacker)} after its use of nuclear weapons.`, nations: [attacker], alert: true });
  log(state, {
    kind: 'nuclear',
    text: `NUCLEAR STRIKE: ${nationName(world, attacker)} detonates nuclear weapons over ${meta.name}, ${nationName(world, target)}.`,
    nations: [attacker, target],
    region,
    alert: true,
  });
  headline(state, `NUCLEAR WEAPONS USED: ${nationName(world, attacker)} strikes ${meta.name}`);
  // Retaliation by the target (and by nuclear-armed allies at war with the attacker).
  if (depth < 3) {
    const retaliators = [
      target,
      ...alliesOf(world, state, target).filter((x) => atWar(state, x, attacker)),
    ];
    for (const ret of retaliators) {
      const rn = state.nations[ret];
      if (!rn || rn.warheads <= 0 || !rn.alive) continue;
      const traits = traitsOf(world, ret, state);
      // Retaliation needs warheads that survived: a weak second strike rarely answers (D-076).
      const ss = secondStrike(world, state, ret, attacker).status;
      const capability = ss === 'assured' ? 1 : ss === 'limited' ? 0.8 : 0.3;
      const p =
        capability *
        (ret === target
          ? clamp(0.55 + (100 - traits.nuclearThreshold) / 120, 0.5, 0.97)
          : clamp((100 - traits.nuclearThreshold) / 110, 0.05, 0.6));
      if (roll(state) < p) {
        const targetRegion = pickStrikeTarget(world, state, attacker);
        if (targetRegion !== null) {
          log(state, {
            kind: 'nuclear',
            text: `${nationName(world, ret)} retaliates with nuclear weapons.`,
            nations: [ret, attacker],
            alert: true,
          });
          nuclearStrike(world, state, ret, attacker, targetRegion, depth + 1);
        }
      } else {
        log(state, {
          kind: 'nuclear',
          text: `${nationName(world, ret)} holds its nuclear fire — for now.`,
          nations: [ret],
          alert: true,
        });
      }
    }
  }
}

export function pickStrikeTarget(world: World, state: GameState, victim: Iso3): RegionId | null {
  let best: RegionId | null = null;
  let bestShare = -1;
  for (const r of Object.values(state.regions)) {
    if (r.owner !== victim || r.controller !== victim) continue;
    const share = (world.regions.get(r.id)?.populationShare ?? 0) * (1 - r.devastation);
    if (share > bestShare) {
      bestShare = share;
      best = r.id;
    }
  }
  return best;
}

/** Monthly aftermath (D-076): fallout decays; global cooling drags growth and stability everywhere. */
export function runNuclearAftermath(world: World, state: GameState): void {
  for (const r of Object.values(state.regions)) if (r.fallout > 0) r.fallout = r.fallout < 0.02 ? 0 : Math.round(r.fallout * 0.97 * 1000) / 1000;
  const c = state.nuclearWinter ?? 0;
  if (c <= 0) return;
  for (const n of Object.values(state.nations)) {
    if (!n.alive) continue;
    n.growthMods.push({ delta: -0.4 * c, monthsLeft: 1, reason: `Nuclear winter: the world is ${c.toFixed(1)} °C cooler; harvests fail` });
    n.stability = clamp(n.stability - 0.1 * c, 0, 100);
  }
  // Soot clears over years: about a 7 % fall a month.
  state.nuclearWinter = c < 0.05 ? 0 : Math.round(c * 0.93 * 100) / 100;
  void world;
}

export interface NuclearStats {
  readonly detonations: number;
  readonly populationStruck: number;
  readonly nationsStruck: number;
  readonly worldGdpNow: number;
  readonly worldGdpStart: number;
  readonly cooling: number;
  readonly nationsAtWar: number;
  readonly monthsSinceFirstUse: number;
  readonly warheadsLeft: number;
}

/** Statistics for the "nobody wins" ending (no casualty imagery; populations of struck regions only). */
export function nuclearStats(world: World, state: GameState): NuclearStats {
  void world;
  const log = state.nuclearLog ?? [];
  let worldGdpNow = 0;
  let warheadsLeft = 0;
  for (const n of Object.values(state.nations)) {
    if (n.alive) worldGdpNow += n.gdp;
    warheadsLeft += n.warheads;
  }
  const atWar = new Set<Iso3>();
  for (const w of state.wars) for (const x of [...w.attackers, ...w.defenders]) atWar.add(x);
  return {
    detonations: state.detonations,
    populationStruck: log.reduce((s, r) => s + r.population, 0),
    nationsStruck: new Set(log.map((r) => r.target)).size,
    worldGdpNow,
    worldGdpStart: state.worldGdpStart ?? worldGdpNow,
    cooling: state.nuclearWinter ?? 0,
    nationsAtWar: atWar.size,
    monthsSinceFirstUse: log.length ? state.turn - log[0]!.turn : 0,
    warheadsLeft,
  };
}

export function isFullExchange(state: GameState): boolean {
  return state.detonations >= FULL_EXCHANGE_THRESHOLD;
}
