/** Global tension, DEFCON and nuclear use (D-028). */
import { nationName, traitsOf, type World } from './world';
import type { Defcon, GameState, Iso3, RegionId } from './types';
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

export function computeDefcon(world: World, state: GameState, iso: Iso3): Defcon {
  const n = state.nations[iso]!;
  const enemies = enemiesOf(state, iso);
  const nuclearEnemy = enemies.some((e) => (state.nations[e]?.warheads ?? 0) > 0);
  const majorEnemy = enemies.some((e) => world.nations.get(e)?.major);
  const held = controlShare(world, state, iso);
  let d = 5;
  if (state.globalTension >= 35 || enemies.length > 0) d = 4;
  if (state.globalTension >= 60 || majorEnemy) d = 3;
  if (state.globalTension >= 80 || nuclearEnemy || state.detonations > 0) d = 2;
  if (
    (nuclearEnemy && held < 0.75) ||
    state.globalTension >= 95 ||
    (nuclearEnemy && state.detonations > 0)
  )
    d = 1;
  const adjusted = clamp(d - n.defconMod, 1, 5);
  return adjusted as Defcon;
}

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
      const traits = traitsOf(world, ret);
      const p =
        ret === target
          ? clamp(0.55 + (100 - traits.nuclearThreshold) / 120, 0.5, 0.97)
          : clamp((100 - traits.nuclearThreshold) / 110, 0.05, 0.6);
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

export function isFullExchange(state: GameState): boolean {
  return state.detonations >= FULL_EXCHANGE_THRESHOLD;
}
