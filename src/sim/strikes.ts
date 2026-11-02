/**
 * Strategic operations (D-059): conventional missile strikes with missile-defence interception,
 * cyber operations and space (satellites, ASAT, debris). Each operation has a `can*` check that
 * returns a reason string the UI can show, and an `apply*` that mutates the state.
 */
import { nationName, type World } from './world';
import type { CyberKind, GameState, Iso3, RegionId, StrikeKind } from './types';
import { adjustRelation, atWar, clamp, headline, isLand, log, roll, unitsIn } from './query';
import { distanceKm, invalidateGeoCache } from './geography';
import { ASAT_DEBRIS, SATELLITE_COST_BN, SPY_OP_COST_PCT_GDP, SPY_OP_MONTHS } from './intel';

/** Missiles fired per strike. */
export const SALVO = 8;
/** Monthly missile production: spend ÷ 50 (at least one), more with strike tech. */
export function missileProduction(world: World, state: GameState, iso: Iso3): number {
  const meta = world.nations.get(iso);
  const n = state.nations[iso];
  if (!meta || !n) return 0;
  return Math.max(1, Math.round((meta.defenceSpendUsdBn / 50) * (1 + (n.modifiers.strikePower ?? 0)) * (n.mobilization > 0 ? 1.3 : 1)));
}

export const STRIKE_INFO: Record<StrikeKind, { label: string; description: string }> = {
  infrastructure: {
    label: 'Infrastructure',
    description: 'Bridges, rail yards and ports: each hit adds 6 % infrastructure damage, cutting supply through the region. Repairs 5 % a month.',
  },
  industry: {
    label: 'Industry',
    description: 'Factories and depots: each hit adds 3 % devastation (lost output); a heavy strike stalls the target’s production queue for a month.',
  },
  military: {
    label: 'Military',
    description: 'Formations and airfields in the region: each hit costs 3 strength spread over the units there.',
  },
};

/** Interception chance per missile at `region` for a strike by `attacker` (same formula as the renderer). */
export function interceptionChance(world: World, state: GameState, region: RegionId, attacker: Iso3): number {
  const ctrl = state.regions[region]?.controller;
  const tech = ctrl ? (state.nations[ctrl]?.modifiers.missileDefence ?? 0) : 0;
  let aa = 0;
  for (const u of unitsIn(state, region)) if (u.type === 'airDefense' && (u.owner === ctrl || (ctrl && !atWar(state, u.owner, ctrl)))) aa += u.strength / 100;
  const base = Math.min(0.8, tech * 2.2 + aa * 0.12 + (tech > 0 ? 0.1 : 0));
  // Hypersonic and precision tech of the attacker degrades the defence.
  const penetration = clamp(state.nations[attacker]?.modifiers.strikePower ?? 0, 0, 0.6);
  void world;
  return clamp(base * (1 - penetration), 0, 0.85);
}

export function canMissileStrike(world: World, state: GameState, iso: Iso3, region: RegionId): string | null {
  const n = state.nations[iso];
  if (!n) return 'Unknown nation.';
  if (!isLand(world, region)) return 'Missile strikes target land regions.';
  const ctrl = state.regions[region]?.controller;
  if (!ctrl) return 'No one controls that region.';
  if (!atWar(state, iso, ctrl)) return `You are not at war with ${nationName(world, ctrl)}.`;
  if (n.missiles < SALVO) return `A strike needs ${SALVO} missiles (${n.missiles} in stock).`;
  return null;
}

/** Launch point: the attacker's controlled region nearest to the target (for the renderer). */
function launchRegion(world: World, state: GameState, iso: Iso3, target: RegionId): RegionId {
  let best: RegionId | null = null;
  let bestD = Infinity;
  for (const r of Object.values(state.regions)) {
    if (r.controller !== iso || !isLand(world, r.id)) continue;
    const d = distanceKm(world, r.id, target);
    if (d < bestD) {
      bestD = d;
      best = r.id;
    }
  }
  return best ?? world.capitalRegion.get(iso) ?? target;
}

export function applyMissileStrike(world: World, state: GameState, iso: Iso3, region: RegionId, kind: StrikeKind): void {
  const why = canMissileStrike(world, state, iso, region);
  if (why) throw new Error(why);
  const n = state.nations[iso]!;
  const r = state.regions[region]!;
  const target = r.controller!;
  const meta = world.regions.get(region)!;
  n.missiles -= SALVO;
  const p = interceptionChance(world, state, region, iso);
  let intercepted = 0;
  for (let i = 0; i < SALVO; i++) if (roll(state) < p) intercepted++;
  const hits = SALVO - intercepted;
  const quality = 1 + (n.modifiers.strikePower ?? 0);
  let effect: string;
  if (kind === 'infrastructure') {
    r.infraDamage = clamp(r.infraDamage + 0.06 * hits * quality, 0, 0.8);
    effect = `infrastructure damage now ${Math.round(r.infraDamage * 100)} %`;
  } else if (kind === 'industry') {
    r.devastation = clamp(r.devastation + 0.03 * hits * quality, 0, 0.8);
    const t = state.nations[target]!;
    if (hits >= 4) t.productionDelay = Math.max(t.productionDelay, 1);
    effect = `devastation now ${Math.round(r.devastation * 100)} %${hits >= 4 ? ', production stalled for a month' : ''}`;
  } else {
    const units = unitsIn(state, region).filter((u) => u.owner === target || atWar(state, u.owner, iso));
    const total = units.reduce((s, u) => s + u.strength, 0);
    let dealt = 0;
    if (total > 0)
      for (const u of units) {
        const d = Math.min(u.strength, ((3 * hits * quality) * u.strength) / total);
        u.strength -= d;
        u.morale = clamp(u.morale - d / 2, 5, 100);
        dealt += d;
        if (u.strength <= 1) delete state.units[u.id];
      }
    invalidateGeoCache(state);
    effect = `${Math.round(dealt)} strength destroyed across ${units.length} formation${units.length === 1 ? '' : 's'}`;
  }
  state.strikes.push({ turn: state.turn, kind: 'missile', from: launchRegion(world, state, iso, region), to: region, attacker: iso, launched: SALVO, intercepted });
  state.globalTension = clamp(state.globalTension + 2, 0, 100);
  adjustRelation(world, state, iso, target, -6);
  const involvesPlayer = iso === state.player || target === state.player;
  log(state, {
    kind: 'strike',
    text: `${nationName(world, iso)} fires ${SALVO} cruise missiles at ${meta.name} (${STRIKE_INFO[kind].label.toLowerCase()}): ${intercepted} intercepted, ${hits} hit — ${effect}.`,
    nations: [iso, target],
    region,
    alert: involvesPlayer,
  });
  if (involvesPlayer || meta.capital) headline(state, `Missile strike on ${meta.name}; ${intercepted} of ${SALVO} shot down`);
}

// --- cyber -----------------------------------------------------------------------------------------

export const CYBER_COOLDOWN = 3;
export const CYBER_INFO: Record<CyberKind, { label: string; description: string }> = {
  economy: {
    label: 'Disrupt economy',
    description: 'Ransomware and grid attacks: −1.5 pp growth for three months.',
  },
  intel: {
    label: 'Blind intelligence',
    description: 'Jam and spoof satellite downlinks: the target’s intelligence levels drop by two for two months.',
  },
  production: {
    label: 'Delay production',
    description: 'Sabotage defence-industrial networks: every item in the target’s production queue loses a month.',
  },
};

export function cyberSuccessChance(state: GameState, iso: Iso3, target: Iso3): number {
  const a = state.nations[iso]?.modifiers.cyberAttack ?? 0;
  const d = state.nations[target]?.modifiers.cyberDefence ?? 0;
  return clamp(0.4 + a - d, 0.05, 0.9);
}

export function canCyberOp(world: World, state: GameState, iso: Iso3, target: Iso3): string | null {
  const n = state.nations[iso];
  if (!n) return 'Unknown nation.';
  if (iso === target) return 'That is you.';
  if (!state.nations[target]?.alive) return 'That nation no longer exists.';
  if (n.cyberCooldown > 0) return `Cyber teams are rebuilding access: ${n.cyberCooldown} month${n.cyberCooldown === 1 ? '' : 's'} to go.`;
  void world;
  return null;
}

export function applyCyberOp(world: World, state: GameState, iso: Iso3, target: Iso3, kind: CyberKind): void {
  const why = canCyberOp(world, state, iso, target);
  if (why) throw new Error(why);
  const n = state.nations[iso]!;
  const t = state.nations[target]!;
  n.cyberCooldown = CYBER_COOLDOWN;
  const p = cyberSuccessChance(state, iso, target);
  const success = roll(state) < p;
  // Attribution: good tradecraft hides the hand behind the attack.
  const attributed = roll(state) < 0.6 - (n.modifiers.cyberAttack ?? 0) * 0.5;
  const involvesPlayer = iso === state.player || target === state.player;
  if (success) {
    if (kind === 'economy') t.growthMods.push({ delta: -1.5, monthsLeft: 3, reason: 'Cyberattack on infrastructure' });
    else if (kind === 'intel') t.blinded = Math.max(t.blinded, 2);
    else for (const item of t.production) item.monthsLeft += 1;
  }
  if (attributed) {
    adjustRelation(world, state, iso, target, -12);
    state.globalTension = clamp(state.globalTension + 1, 0, 100);
  }
  log(state, {
    kind: 'cyber',
    text: success
      ? `Cyber operation against ${nationName(world, target)} (${CYBER_INFO[kind].label.toLowerCase()}) succeeds${attributed ? ` and is attributed to ${nationName(world, iso)}` : '; the attacker is not identified'}.`
      : `Cyber operation by ${nationName(world, iso)} against ${nationName(world, target)} is detected and blocked${attributed ? '' : ' before attribution'}.`,
    nations: attributed || iso === state.player ? [iso, target] : [target],
    alert: involvesPlayer,
  });
  if (success && (involvesPlayer || world.nations.get(target)?.major))
    headline(state, kind === 'economy' ? `Cyberattack paralyses ${nationName(world, target)} grid and banks` : kind === 'intel' ? `${nationName(world, target)} satellites go dark in suspected cyberattack` : `Sabotage reported in ${nationName(world, target)} defence plants`);
}

// --- space -----------------------------------------------------------------------------------------

export function satelliteCost(state: GameState, iso: Iso3): number {
  const n = state.nations[iso];
  const cadence = n?.techs.includes('space-launch-cadence') ? 0.6 : 1;
  return SATELLITE_COST_BN * cadence;
}

export function canLaunchSatellite(state: GameState, iso: Iso3): string | null {
  const n = state.nations[iso];
  if (!n) return 'Unknown nation.';
  const cost = satelliteCost(state, iso);
  if (n.treasury < cost) return `A launch costs $${cost.toFixed(1)} bn (treasury $${n.treasury.toFixed(1)} bn).`;
  if (n.satellites >= 24) return 'The constellation is at its maximum of 24 satellites.';
  return null;
}

export function applyLaunchSatellite(world: World, state: GameState, iso: Iso3): void {
  const why = canLaunchSatellite(state, iso);
  if (why) throw new Error(why);
  const n = state.nations[iso]!;
  n.treasury -= satelliteCost(state, iso);
  n.satellites += 1;
  if (iso === state.player)
    log(state, { kind: 'space', text: `A new reconnaissance satellite reaches orbit (${n.satellites} in the constellation).`, nations: [iso], alert: true });
  void world;
}

export function canAsat(world: World, state: GameState, iso: Iso3, target: Iso3): string | null {
  const n = state.nations[iso];
  if (!n) return 'Unknown nation.';
  if (iso === target) return 'That is you.';
  if (!n.techs.includes('space-counterspace')) return 'Requires the Counterspace Capabilities technology.';
  if (!atWar(state, iso, target)) return `An anti-satellite strike is an act of war: you must be at war with ${nationName(world, target)}.`;
  if ((state.nations[target]?.satellites ?? 0) <= 0) return `${nationName(world, target)} has no satellites to shoot down.`;
  return null;
}

export function applyAsat(world: World, state: GameState, iso: Iso3, target: Iso3): void {
  const why = canAsat(world, state, iso, target);
  if (why) throw new Error(why);
  const t = state.nations[target]!;
  const killed = Math.min(t.satellites, Math.max(1, Math.ceil(t.satellites * 0.3)), 4);
  t.satellites -= killed;
  state.debris = clamp(state.debris + ASAT_DEBRIS * killed, 0, 100);
  state.globalTension = clamp(state.globalTension + 5, 0, 100);
  for (const o of Object.values(state.nations)) {
    if (o.iso3 === iso || !o.alive) continue;
    adjustRelation(world, state, iso, o.iso3, o.iso3 === target ? -30 : -8);
  }
  log(state, {
    kind: 'space',
    text: `${nationName(world, iso)} destroys ${killed} ${nationName(world, target)} satellite${killed === 1 ? '' : 's'} with anti-satellite weapons. Orbital debris index rises to ${Math.round(state.debris)}: every constellation is now at risk.`,
    nations: [iso, target],
    alert: true,
  });
  headline(state, `ASAT STRIKE: debris cloud threatens satellites of every nation`);
}

/** Debris decays slowly and randomly destroys satellites of everyone, including the shooter. */
export function runSpaceTick(world: World, state: GameState): void {
  for (const n of Object.values(state.nations)) {
    if (!n.alive) continue;
    n.missiles = Math.min(600, n.missiles + missileProduction(world, state, n.iso3));
    if (state.debris > 0 && n.satellites > 0) {
      const p = (state.debris / 400) * n.satellites;
      if (roll(state) < p) {
        n.satellites -= 1;
        if (n.iso3 === state.player)
          log(state, { kind: 'space', text: `Orbital debris destroys one of your satellites (${n.satellites} left).`, nations: [n.iso3], alert: true });
      }
    }
  }
  state.debris = Math.max(0, state.debris - 1);
}

// --- spies -----------------------------------------------------------------------------------------

export function spyOpCost(state: GameState, iso: Iso3): number {
  return (state.nations[iso]?.gdp ?? 0) * SPY_OP_COST_PCT_GDP;
}

export function canSpyOp(world: World, state: GameState, iso: Iso3, target: Iso3): string | null {
  const n = state.nations[iso];
  if (!n) return 'Unknown nation.';
  if (iso === target) return 'That is you.';
  if (!state.nations[target]?.alive) return 'That nation no longer exists.';
  const cost = spyOpCost(state, iso);
  if (n.treasury < cost) return `A network costs $${cost.toFixed(2)} bn (treasury $${n.treasury.toFixed(1)} bn).`;
  void world;
  return null;
}

export function applySpyOp(world: World, state: GameState, iso: Iso3, target: Iso3): void {
  const why = canSpyOp(world, state, iso, target);
  if (why) throw new Error(why);
  const n = state.nations[iso]!;
  n.treasury -= spyOpCost(state, iso);
  n.intelOps[target] = SPY_OP_MONTHS;
  if (iso === state.player)
    log(state, { kind: 'intel', text: `Human-intelligence network activated in ${nationName(world, target)}: +1 intelligence level on its regions for ${SPY_OP_MONTHS} months.`, nations: [iso, target], alert: true });
}
