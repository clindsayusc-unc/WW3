/**
 * Itemised tooltip breakdowns with nested sources (D-080): each row says how much a cause
 * contributes, and hovering the row names where it comes from (partners, sanctioners, wars,
 * technologies, events). Pure, so the rows are unit-tested.
 */
import { nationName, type World } from '../sim/world';
import type { GameState, Iso3 } from '../sim/types';
import { growthBreakdown } from '../sim/economy';
import { supportBreakdown } from '../sim/domestic';
import { enemiesOf, isSanctioned, controlShare } from '../sim/query';
import { tradePartners } from '../sim/trade';
import type { BreakdownRow } from './Stat';

const pp = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)} pp`;
const tone = (v: number): 'good' | 'bad' | 'neutral' => (v > 0.005 ? 'good' : v < -0.005 ? 'bad' : 'neutral');

function lines(items: string[], empty: string): string {
  return items.length ? items.join(' · ') : empty;
}

export function growthRows(world: World, state: GameState, iso: Iso3): BreakdownRow[] {
  const g = growthBreakdown(world, state, iso);
  const n = state.nations[iso]!;
  const name = (x: Iso3) => nationName(world, x);
  const partners = tradePartners(state, iso)
    .map((p) => ({ p: p.partner, lost: p.route.reference - p.route.volume, status: p.route.status }))
    .filter((x) => Math.abs(x.lost) > 0.5)
    .sort((a, b) => Math.abs(b.lost) - Math.abs(a.lost))
    .slice(0, 5)
    .map((x) => `${name(x.p)} ${x.lost > 0 ? '−' : '+'}$${Math.abs(x.lost).toFixed(0)} bn (${x.status})`);
  const sanctioners = Object.values(state.nations)
    .filter((o) => o.alive && o.iso3 !== iso && isSanctioned(state, o.iso3, iso))
    .sort((a, b) => b.gdp - a.gdp)
    .slice(0, 6)
    .map((o) => name(o.iso3));
  const shortages = Object.entries(n.resources ?? {})
    .filter(([, b]) => b.demand > 0 && b.satisfaction < 0.97)
    .map(([r, b]) => `${world.resourceById.get(r as never)?.name ?? r} ${Math.round(b.satisfaction * 100)} % supplied`);
  const techs = n.techs
    .map((id) => world.techs.get(id))
    .filter((t) => t && t.effects.some((e) => e.key === 'gdpGrowth') && !(world.startingTechs.get(iso) ?? []).includes(t.id))
    .map((t) => `${t!.name} +${t!.effects.find((e) => e.key === 'gdpGrowth')!.value} pp`);
  const rows: BreakdownRow[] = [
    { label: 'Trend', value: pp(g.base), tone: 'neutral', tip: 'IMF World Economic Outlook trend for this economy, converging toward 2 % a year with a 15-year half-life.' },
    { label: 'Infrastructure', value: pp(g.infrastructure), tone: tone(g.infrastructure), tip: `Budget share ${n.budget.infrastructure} %: every point above 20 % adds 0.03 pp, every point below costs it.` },
    { label: 'Technology', value: pp(g.tech), tone: tone(g.tech), tip: `Technologies researched since January 2027: ${lines(techs, 'none yet that add growth')}.` },
    { label: 'Taxes', value: pp(g.tax), tone: tone(g.tax), tip: `Tax rate ${n.taxRate} % against a 28 % norm: −0.06 pp per point above.` },
    { label: 'Trade', value: pp(g.trade), tone: tone(g.trade), tip: `Largest changes against January 2027: ${lines(partners, 'no partner has changed much')}.` },
    { label: 'Resources', value: pp(g.resources), tone: tone(g.resources), tip: `Strategic inputs: ${lines(shortages, 'every resource fully supplied')}. Export earnings and import prices also count.` },
    { label: 'Financial sanctions', value: pp(g.sanctions), tone: tone(g.sanctions), tip: `Sanctioning you: ${lines(sanctioners, 'nobody')}. Measured against the sanctions already in force in January 2027.` },
    { label: 'War', value: pp(g.war), tone: tone(g.war), tip: `${enemiesOf(state, iso).length ? `At war with ${enemiesOf(state, iso).map(name).join(', ')}; ${Math.round((1 - controlShare(world, state, iso)) * 100)} % of your land occupied.` : 'At peace: no war costs to the economy.'}` },
    { label: 'Mobilisation', value: pp(g.mobilization), tone: tone(g.mobilization), tip: ['Peacetime economy.', 'Partial mobilisation: production first.', 'Total mobilisation: everything for the war.'][n.mobilization] ?? '' },
    { label: 'Debt', value: pp(g.debt), tone: tone(g.debt), tip: `Debt ${Math.round((n.debt / Math.max(1, n.gdp)) * 100)} % of GDP; the drag starts above 120 % (or your starting ratio).` },
    { label: 'Inflation', value: pp(g.inflation), tone: tone(g.inflation), tip: `Inflation ${n.inflation.toFixed(1)} %: above 10 % it starts to cost growth.` },
    { label: 'Recovery', value: pp(g.recovery), tone: tone(g.recovery), tip: 'Catch-up toward potential output: positive after a downturn, negative when the economy overheats.' },
    { label: 'Events', value: pp(g.events), tone: tone(g.events), tip: `${lines(n.growthMods.map((m) => `${m.reason} ${pp(m.delta)} (${m.monthsLeft} mo)`), 'no temporary shocks')}.` },
    { label: 'Chokepoints', value: pp(g.chokepoints), tone: tone(g.chokepoints), tip: `${lines(g.chokepointReasons, 'every strait open')}.` },
  ];
  // Structural causes stay listed (their sources are worth seeing even at zero); the rest only when they act.
  const always = new Set(['Trend', 'Technology', 'Trade', 'Financial sanctions', 'War']);
  return rows.filter((r) => always.has(r.label) || r.value !== '+0.00 pp');
}

export function approvalRows(world: World, state: GameState, iso: Iso3): BreakdownRow[] {
  const b = supportBreakdown(world, state, iso);
  const n = state.nations[iso]!;
  const pts = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`;
  const rows: BreakdownRow[] = [
    { label: 'Baseline', value: pts(b.base), tone: 'neutral' },
    { label: 'Growth', value: pts(b.growth), tone: tone(b.growth), tip: `Growth ${n.growth.toFixed(1)} % a year: 2 points per pp above 1 %.` },
    { label: 'Inflation', value: pts(b.inflation), tone: tone(b.inflation), tip: `Inflation ${n.inflation.toFixed(1)} % a year.` },
    { label: 'Taxes', value: pts(b.taxes), tone: tone(b.taxes), tip: `Tax rate ${n.taxRate} %: −0.6 per point above 28 %.` },
    { label: 'Social spending', value: pts(b.social), tone: tone(b.social), tip: `Social budget ${n.budget.social} %.` },
    { label: 'War weariness', value: pts(b.warWeariness), tone: tone(b.warWeariness), tip: `War weariness ${Math.round(n.warWeariness)}.` },
    { label: 'Rally round the flag', value: pts(b.rally), tone: tone(b.rally), tip: 'A short-lived boost after being attacked.' },
    { label: 'Mobilisation', value: pts(b.mobilization), tone: tone(b.mobilization) },
    { label: 'Shortages', value: pts(b.shortages), tone: tone(b.shortages), tip: 'Food and fuel shortages at home.' },
    { label: 'Lost territory', value: pts(b.territory), tone: tone(b.territory) },
    { label: 'Output gap', value: pts(b.unemployment), tone: tone(b.unemployment), tip: 'Joblessness when output falls below potential.' },
    { label: 'Stability', value: pts(b.stability), tone: tone(b.stability), tip: `Stability ${Math.round(n.stability)}: 0.15 a point above or below 50.` },
    { label: 'Protests', value: pts(b.protests), tone: tone(b.protests) },
  ];
  return rows.filter((r) => r.label === 'Baseline' || r.value !== '+0.0');
}
