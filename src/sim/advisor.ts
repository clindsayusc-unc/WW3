/**
 * The chief of staff's advice (D-080): every month, the three most useful things the player could
 * do — one each for the economy, the military and diplomacy when there is something to say — with
 * the reason in numbers. Pure and deterministic; the UI only renders it and opens the screen named
 * in `target`.
 */
import { nationName, type World } from './world';
import type { GameState, Iso3, RegionId } from './types';
import { alliesOf, atWar, enemiesOf, getRelation, hasTreaty, isAtWar, isLand, militaryPower, unitsOf } from './query';
import { monthlyRevenue } from './economy';
import { controlShare } from './query';
import { availableTechs } from './research';

export type AdviceCategory = 'economy' | 'military' | 'diplomacy';
export type AdviceTarget = 'budget' | 'economy' | 'production' | 'research' | 'diplomacy' | 'military' | 'escalation';

export interface Advice {
  readonly id: string;
  readonly category: AdviceCategory;
  /** 0–100: how urgent. */
  readonly priority: number;
  readonly title: string;
  readonly reason: string;
  readonly target: AdviceTarget;
  /** Nation to preselect in the diplomacy screen, or region to fly to. */
  readonly nation?: Iso3;
  readonly region?: RegionId;
}

const pct = (v: number, d = 1) => `${v.toFixed(d)} %`;

export function allAdvice(world: World, state: GameState, iso: Iso3 = state.player): Advice[] {
  const n = state.nations[iso];
  if (!n?.alive) return [];
  const out: Advice[] = [];
  const name = (x: Iso3) => nationName(world, x);
  const held = controlShare(world, state, iso);
  const revenue = monthlyRevenue(n, held);
  const atWarNow = isAtWar(state, iso);
  const enemies = enemiesOf(state, iso);
  const myUnits = unitsOf(state, iso);
  const cap = world.capitalRegion.get(iso);
  const monthsToElection = n.nextElection !== null ? n.nextElection - state.turn : null;

  // --- economy ------------------------------------------------------------------------------
  if (!n.researchCurrent && n.researchQueue.length === 0 && availableTechs(world, state, iso).length > 0)
    out.push({
      id: 'research-idle',
      category: 'economy',
      priority: 72,
      title: 'Choose a research project',
      reason: `Your laboratories are idle: ${Math.round(n.researchPoints)} research points are banked and nothing is being researched. Click a distant technology to queue its whole path.`,
      target: 'research',
    });
  if (monthsToElection !== null && monthsToElection <= 12 && n.support < 45)
    out.push({
      id: 'election',
      category: 'economy',
      priority: 88 - monthsToElection,
      title: 'Win back the voters',
      reason: `Approval is ${Math.round(n.support)} with an election in ${monthsToElection} months; below 50 % of the vote the game ends. Social spending, lower taxes and lower inflation all raise approval.`,
      target: 'budget',
    });
  if (n.stability < 40)
    out.push({
      id: 'stability',
      category: 'economy',
      priority: 80 - n.stability / 2,
      title: 'Shore up stability',
      reason: `Stability is ${Math.round(n.stability)}/100; under 10 for three months the regime collapses. Raise the social budget and avoid new mobilisation.`,
      target: 'budget',
    });
  if (n.recession || n.growth < 0)
    out.push({
      id: 'recession',
      category: 'economy',
      priority: 66,
      title: n.recession ? 'Pull the economy out of recession' : 'Restart growth',
      reason: `Growth is ${pct(n.growth)} a year. Infrastructure spending above 20 % of the budget adds growth; check the Economy screen for the shock behind it (trade, sanctions, war, shortages).`,
      target: 'economy',
    });
  if (n.econ.deficitPct > 6)
    out.push({
      id: 'deficit',
      category: 'economy',
      priority: 50 + Math.min(20, n.econ.deficitPct - 6),
      title: 'Rein in the deficit',
      reason: `You borrow ${pct(n.econ.deficitPct)} of GDP a year; debt is ${pct((n.debt / Math.max(1, n.gdp)) * 100, 0)} of GDP and interest rises with it. Raise taxes a little or trim spending.`,
      target: 'budget',
    });
  if (n.inflation > 10)
    out.push({
      id: 'inflation',
      category: 'economy',
      priority: 55 + Math.min(20, (n.inflation - 10) / 2),
      title: 'Tame inflation',
      reason: `Prices rise ${pct(n.inflation)} a year, eroding approval. Deficits, mobilisation and shortages drive it.`,
      target: 'economy',
    });
  const short = Object.entries(n.resources ?? {})
    .filter(([, b]) => b.demand > 0 && b.satisfaction < 0.85)
    .sort((a, b) => a[1].satisfaction - b[1].satisfaction)[0];
  if (short)
    out.push({
      id: `shortage-${short[0]}`,
      category: 'economy',
      priority: 48 + (0.85 - short[1].satisfaction) * 60,
      title: `Secure ${world.resourceById.get(short[0] as never)?.name ?? short[0]}`,
      reason: `Only ${Math.round(short[1].satisfaction * 100)} % of your demand is met: production lines and laboratories that need it slow down. Trade agreements or lifting sanctions on suppliers help.`,
      target: 'economy',
    });
  if (n.budget.research < 8 && !atWarNow)
    out.push({
      id: 'research-budget',
      category: 'economy',
      priority: 34,
      title: 'Invest in research',
      reason: `Only ${n.budget.research} % of the budget goes to research. Research points grow with the square root of spending: doubling the share gives about 40 % more.`,
      target: 'budget',
    });

  // --- military -----------------------------------------------------------------------------
  if (atWarNow && cap !== undefined) {
    const near = world.regions.get(cap)?.neighbours ?? [];
    const threat = Object.values(state.units).filter((u) => near.includes(u.region) && atWar(state, u.owner, iso) && isLand(world, u.region)).length;
    if (threat > 0)
      out.push({
        id: 'capital',
        category: 'military',
        priority: 95,
        title: 'Defend the capital',
        reason: `${threat} enemy formation${threat === 1 ? '' : 's'} stand next to ${world.regions.get(cap)?.name ?? 'the capital'}. Losing it for long risks capitulation; move reserves in and keep air cover over it.`,
        target: 'military',
        region: cap,
      });
  }
  const cut = myUnits.filter((u) => world.unitTypes.get(u.type)?.domain === 'land' && (state.regions[u.region]?.supply ?? 1) < 0.25 && state.regions[u.region]?.controller !== iso);
  if (cut.length > 0)
    out.push({
      id: 'supply',
      category: 'military',
      priority: 70,
      title: `${cut.length} formation${cut.length === 1 ? ' is' : 's are'} cut off`,
      reason: `Out-of-supply units lose 4 strength and morale every month. Pull them back toward a depot or open a corridor (supply map mode, key 8).`,
      target: 'military',
      region: cut[0]!.region,
    });
  const idleWings = myUnits.filter((u) => world.unitTypes.get(u.type)?.domain === 'air' && (u.mission === null || u.mission === 'superiority')).length;
  if (atWarNow && idleWings >= 3)
    out.push({
      id: 'air',
      category: 'military',
      priority: 46,
      title: 'Put the air force to work',
      reason: `${idleWings} wings fly air superiority only. Close air support adds ×1.5 strike weight to battles; interdiction cuts enemy supply by 15 % a wing.`,
      target: 'military',
    });
  const myPower = militaryPower(world, state, iso);
  let worst: { iso: Iso3; rel: number; power: number } | null = null;
  for (const o of world.majors) {
    if (o === iso || !state.nations[o]?.alive || alliesOf(world, state, iso).includes(o)) continue;
    const rel = getRelation(world, state, iso, o);
    const power = militaryPower(world, state, o);
    if (rel <= -40 && power > myPower * 0.8 && (!worst || rel < worst.rel)) worst = { iso: o, rel, power };
  }
  if (worst && !atWar(state, iso, worst.iso))
    out.push({
      id: 'deterrence',
      category: 'military',
      priority: 52 + Math.min(20, -worst.rel / 5),
      title: `Deter ${name(worst.iso)}`,
      reason: `Relations ${Math.round(worst.rel)} and a military ${Math.round((worst.power / Math.max(1, myPower)) * 100)} % the size of yours. Air defence, a larger military budget and allies make an attack costly.`,
      target: 'production',
      nation: worst.iso,
    });
  const queued = n.production.length;
  if (queued === 0 && n.treasury > revenue * 3 && (atWarNow || worst))
    out.push({
      id: 'treasury',
      category: 'military',
      priority: 44,
      title: 'Put the treasury to work',
      reason: `$${Math.round(n.treasury)} bn sits idle and nothing is in production. Formations take months to build; start them before you need them.`,
      target: 'production',
    });

  // --- diplomacy ----------------------------------------------------------------------------
  const incoming = state.proposals.filter((p) => p.to === iso);
  if (incoming.length > 0) {
    const p = incoming[0]!;
    out.push({
      id: `proposal-${p.id}`,
      category: 'diplomacy',
      priority: 85,
      title: `Answer ${name(p.from)}`,
      reason: `${incoming.length} proposal${incoming.length === 1 ? '' : 's'} await${incoming.length === 1 ? 's' : ''} your reply: ${p.text}`,
      target: 'diplomacy',
      nation: p.from,
    });
  }
  const vote = state.un?.resolutions.find((r) => r.status === 'pending' && state.un.council.includes(iso) && r.votes[iso] === undefined);
  if (vote)
    out.push({
      id: `un-${vote.id}`,
      category: 'diplomacy',
      priority: 70,
      title: 'Cast your Security Council vote',
      reason: `${vote.text} The vote closes at the end of the month; not voting counts as an abstention.`,
      target: 'diplomacy',
    });
  if (atWarNow) {
    const weary = n.warWeariness >= 60 || held < 0.8;
    if (weary)
      out.push({
        id: 'peace',
        category: 'diplomacy',
        priority: 64 + (n.warWeariness >= 80 ? 10 : 0),
        title: 'Explore a peace',
        reason: `War weariness ${Math.round(n.warWeariness)} and ${Math.round((1 - held) * 100)} % of your land occupied. A white peace with ${name(enemies[0]!)} stops the bleeding before approval collapses.`,
        target: 'diplomacy',
        nation: enemies[0]!,
      });
  }
  let hot: { name: string; t: number } | null = null;
  for (const f of world.flashpoints) {
    if (!f.nations.includes(iso)) continue;
    const t = state.flashpoints[f.id] ?? 0;
    if (t >= 65 && (!hot || t > hot.t)) hot = { name: f.name, t };
  }
  if (hot)
    out.push({
      id: 'flashpoint',
      category: 'diplomacy',
      priority: 50 + (hot.t - 65) / 2,
      title: `Cool the ${hot.name}`,
      reason: `Tension there is ${Math.round(hot.t)}/100 and rising tension pushes DEFCON down. Diplomacy, trade and restraint lower it; mobilisation and threats raise it.`,
      target: 'escalation',
    });
  if (worst) {
    // The strongest friendly power without a defensive pact with us.
    let best: { iso: Iso3; power: number } | null = null;
    for (const o of world.majors) {
      if (o === iso || o === worst.iso || !state.nations[o]?.alive) continue;
      if (alliesOf(world, state, iso).includes(o) || hasTreaty(state, iso, o, 'defensive')) continue;
      if (getRelation(world, state, iso, o) < 35) continue;
      const power = militaryPower(world, state, o);
      if (!best || power > best.power) best = { iso: o, power };
    }
    if (best)
      out.push({
        id: `pact-${best.iso}`,
        category: 'diplomacy',
        priority: 55,
        title: `Seek a defensive pact with ${name(best.iso)}`,
        reason: `${name(worst.iso)} is hostile; ${name(best.iso)} is friendly (relations ${Math.round(getRelation(world, state, iso, best.iso))}) and would double the cost of attacking you.`,
        target: 'diplomacy',
        nation: best.iso,
      });
  }
  // A large, friendly trading partner without a trade agreement.
  const partners = state.economy.routes
    .filter((r) => r.a === iso || r.b === iso)
    .map((r) => ({ p: r.a === iso ? r.b : r.a, v: r.volume }))
    .filter((x) => !hasTreaty(state, iso, x.p, 'trade') && getRelation(world, state, iso, x.p) >= 25 && !atWar(state, iso, x.p))
    .sort((a, b) => b.v - a.v || (a.p < b.p ? -1 : 1));
  if (partners[0] && partners[0].v > 5)
    out.push({
      id: `trade-${partners[0].p}`,
      category: 'diplomacy',
      priority: 32,
      title: `Trade agreement with ${name(partners[0].p)}`,
      reason: `$${Math.round(partners[0].v)} bn of trade a year with no agreement; a treaty adds 6 % to it and warms relations.`,
      target: 'diplomacy',
      nation: partners[0].p,
    });
  return out.sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1));
}

/** The top three: the best of each category first, then the most urgent of the rest. */
export function topAdvice(world: World, state: GameState, iso: Iso3 = state.player, count = 3): Advice[] {
  const all = allAdvice(world, state, iso);
  const picked: Advice[] = [];
  for (const cat of ['economy', 'military', 'diplomacy'] as const) {
    const best = all.find((a) => a.category === cat);
    if (best) picked.push(best);
  }
  for (const a of all) if (picked.length < count && !picked.includes(a)) picked.push(a);
  return picked.sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1)).slice(0, count);
}
