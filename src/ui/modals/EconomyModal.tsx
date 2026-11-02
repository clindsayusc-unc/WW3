/**
 * Economy screen (D-061): overview charts, budget and war finance, trade partners, strategic
 * resources, sanctions coalitions and domestic politics. Every number explains itself.
 */
import { useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { useGameStore } from '../../state/gameStore';
import { useUiStore } from '../../state/uiStore';
import { dispatch } from '../../state/simBridge';
import { loadWorld, nationName } from '../../sim/world';
import {
  DEFAULT_TAX_RATE,
  MOBILIZATION_GROWTH_DRAG,
  MOBILIZATION_INFLATION,
  MOBILIZATION_PRODUCTION,
  MOBILIZATION_STABILITY,
  TAX_MAX,
  TAX_MIN,
  WAR_BOND_SHARE,
  canIssueWarBonds,
  defaultThreshold,
  growthBreakdown,
  inflationBreakdown,
  interestBreakdown,
  monthlyRevenue,
} from '../../sim/economy';
import {
  MOBILIZATION_SUPPORT,
  PROTEST_THRESHOLD,
  coupBreakdown,
  projectedVoteShare,
  reelectionChance,
  regimeOf,
  supportBreakdown,
} from '../../sim/domestic';
import { coalitionReply, productionThroughput, researchThroughput, sanctionCoalitions, tradePartners } from '../../sim/trade';
import { controlShare, isSanctioned } from '../../sim/query';
import { dateForTurn } from '../../sim/game';
import { Stat } from '../Stat';
import { formatMoney, formatMonthShort, formatPct } from '../format';
import { nationHex } from '../../render/palette';
import { playSound } from '../audio';
import { RESOURCE_COLOR } from '../economyInfo';
import { RESOURCE_IDS, type EconSample, type GameState, type Iso3, type MobilizationLevel, type ProposalType, type ResourceId, type TradeStatus } from '../../sim/types';

const world = loadWorld();

type Tab = 'overview' | 'budget' | 'trade' | 'resources' | 'sanctions' | 'domestic';
const TABS: { id: Tab; label: string; tip: string }[] = [
  { id: 'overview', label: 'Overview', tip: 'GDP, growth, inflation and debt over time, and what drives growth this month.' },
  { id: 'budget', label: 'Budget & war finance', tip: 'Where the money goes, taxes, mobilisation and war bonds.' },
  { id: 'trade', label: 'Trade', tip: 'Your largest trading relationships and what is cutting them.' },
  { id: 'resources', label: 'Resources', tip: 'Oil, gas, rare earths, advanced chips, food and steel: production, imports, shortages and prices.' },
  { id: 'sanctions', label: 'Sanctions', tip: 'Sanctions coalitions, embargoes and secondary sanctions around the world.' },
  { id: 'domestic', label: 'Domestic', tip: 'Approval, protests, elections and coup risk.' },
];

const STATUS_INFO: Record<TradeStatus, { label: string; color: string }> = {
  open: { label: 'open', color: '#4ade80' },
  rerouted: { label: 'rerouted', color: '#fbbf24' },
  contested: { label: 'contested', color: '#fb923c' },
  cut: { label: 'cut', color: '#f87171' },
  sanctioned: { label: 'sanctioned', color: '#f472b6' },
  embargoed: { label: 'embargoed', color: '#ef4444' },
  war: { label: 'war', color: '#ef4444' },
};

const sign = (v: number, d = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`;
const monthOf = (turn: number) => formatMonthShort(dateForTurn(turn));

// --- charts -------------------------------------------------------------------------------------

interface ChartProps {
  title: string;
  tip: string;
  samples: readonly EconSample[];
  pick: (s: EconSample) => number;
  fmt: (v: number) => string;
  color: string;
  /** Draw a zero line (growth). */
  zero?: boolean;
  /** Fixed vertical range for bounded indices (approval 0–100). */
  range?: [number, number];
  testId?: string;
}

/** A compact line chart: hover any month for its value; min, max and latest carry tooltips. */
function LineChart({ title, tip, samples, pick, fmt, color, zero = false, range, testId }: ChartProps) {
  const W = 300;
  const H = 90;
  const vals = samples.map(pick);
  const lo = range ? range[0] : Math.min(...vals, zero ? 0 : Infinity);
  const hi = range ? range[1] : Math.max(...vals, zero ? 0 : -Infinity);
  const span = hi - lo || Math.abs(hi) || 1;
  const pad = range ? 0 : span * 0.08;
  const y = (v: number) => H - ((v - (lo - pad)) / (span + 2 * pad)) * H;
  const x = (i: number) => (vals.length <= 1 ? W / 2 : (i / (vals.length - 1)) * W);
  const path = vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = vals.length > 1 ? `${path} L${W},${H} L0,${H} Z` : '';
  const last = vals[vals.length - 1] ?? 0;
  const first = samples[0];
  // Hover columns (at most 60) so every point can be read.
  const step = Math.max(1, Math.ceil(samples.length / 60));
  const cols: EconSample[] = [];
  for (let i = 0; i < samples.length; i += step) cols.push(samples[Math.min(samples.length - 1, i + step - 1)]!);
  return (
    <div className="econ-chart" data-testid={testId}>
      <div className="econ-chart-head">
        <span className="econ-chart-title" data-tip={tip}>
          {title}
        </span>
        <Stat value={fmt(last)} tooltip={`${title}, ${samples.length > 0 ? monthOf(samples[samples.length - 1]!.turn) : ''}. ${tip}`} accent={color} inline />
      </div>
      <div className="econ-chart-body">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          {zero && lo < 0 && hi > 0 && <line x1={0} x2={W} y1={y(0)} y2={y(0)} className="econ-zero" />}
          {area && <path d={area} fill={color} opacity={0.12} />}
          <path d={path} fill="none" stroke={color} strokeWidth={1.8} vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="econ-chart-cols">
          {cols.map((s) => (
            <span key={s.turn} data-tip={`${monthOf(s.turn)}: ${title.toLowerCase()} ${fmt(pick(s))}.`} />
          ))}
        </div>
      </div>
      <div className="econ-chart-foot">
        <Stat label="low" value={fmt(Math.min(...vals))} tooltip={`Lowest ${title.toLowerCase()} since ${first ? monthOf(first.turn) : 'the start'}.`} inline />
        <Stat label="high" value={fmt(Math.max(...vals))} tooltip={`Highest ${title.toLowerCase()} since ${first ? monthOf(first.turn) : 'the start'}.`} inline />
      </div>
    </div>
  );
}

interface Contribution {
  label: string;
  value: number;
  tip: string;
}

/** Diverging bars around zero: each term of a breakdown, with its cause. */
function Contributions({ items, unit, testId }: { items: Contribution[]; unit: string; testId?: string }) {
  const max = Math.max(0.5, ...items.map((i) => Math.abs(i.value)));
  return (
    <div className="contrib" data-testid={testId}>
      {items.map((i) => (
        <div key={i.label} className="contrib-row">
          <span className="contrib-label" data-tip={i.tip}>
            {i.label}
          </span>
          <span className="contrib-track">
            <span
              className={`contrib-bar ${i.value < 0 ? 'neg' : 'pos'}`}
              style={{ width: `${(Math.abs(i.value) / max) * 50}%`, [i.value < 0 ? 'right' : 'left']: '50%' }}
            />
          </span>
          <Stat value={`${sign(i.value)}${unit}`} tooltip={i.tip} inline />
        </div>
      ))}
    </div>
  );
}

function Meter({ value, color, tip }: { value: number; color: string; tip: string }) {
  return (
    <span className="power-bar" data-tip={tip}>
      <span style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
    </span>
  );
}

// --- tabs ---------------------------------------------------------------------------------------

function Overview({ game, me }: { game: GameState; me: Iso3 }) {
  const n = game.nations[me]!;
  const samples = game.history[me] ?? [];
  const g = growthBreakdown(world, game, me);
  const infl = inflationBreakdown(world, game, me);
  const ir = interestBreakdown(world, game, me);
  const debtPct = (n.debt / Math.max(1, n.gdp)) * 100;
  const items: Contribution[] = [
    { label: 'Trend', value: g.base, tip: 'Underlying growth (IMF forecast at the start), converging toward 2 % over the decades.' },
    { label: 'Infrastructure', value: g.infrastructure, tip: 'Infrastructure spending above 20 % of the budget adds 0.03 pp per point.' },
    { label: 'Technology', value: g.tech, tip: 'Growth from completed technologies.' },
    { label: 'Taxes', value: g.tax, tip: `Each point of tax above ${DEFAULT_TAX_RATE} % costs 0.06 pp of growth.` },
    { label: 'Trade', value: g.trade, tip: `Bilateral trade lost (−) or gained (+) since January 2027: ${formatMoney(n.econ.tradeLost)} a year at ${'0.6'} pp per 1 % of GDP. Wars, sanctions, embargoes and cut sea routes all count.` },
    { label: 'Resources', value: g.resources, tip: `Strategic resources: shortages ${sign(n.econ.shortageEffect)}, export earnings ${sign(n.econ.exportEffect)}, import prices ${sign(n.econ.priceEffect)} pp.` },
    { label: 'Financial sanctions', value: g.sanctions, tip: `Frozen reserves and capital flight: ${formatPct(n.econ.sanctionShare * 100, 0)} of world GDP sanctions you (${formatPct(n.econ.sanctionRef * 100, 0)} at the start).` },
    { label: 'War', value: g.war, tip: 'Fighting costs 1 pp, plus 6 pp per 100 % of your population under occupation.' },
    { label: 'Mobilisation', value: g.mobilization, tip: 'Partial mobilisation costs 0.6 pp, total 1.8 pp: workers go to the front.' },
    { label: 'Debt', value: g.debt, tip: 'Debt above 120 % of GDP (or your starting level, if higher) crowds out investment.' },
    { label: 'Inflation', value: g.inflation, tip: 'Inflation above 10 % (or its long-run anchor) disrupts business: 0.05 pp per point.' },
    { label: 'Recovery', value: g.recovery, tip: `Output ${formatPct(g.gap * 100, 1, true)} versus potential. Below potential the economy catches up (0.3 pp per 1 %); above it, it cools.` },
    { label: 'Events', value: g.events, tip: n.growthMods.map((m) => `${m.reason} ${sign(m.delta)} (${m.monthsLeft} mo)`).join('; ') || 'No temporary shocks.' },
    { label: 'Chokepoints', value: g.chokepoints, tip: g.chokepointReasons.join('; ') || 'Every strait is open.' },
  ].filter((i) => Math.abs(i.value) >= 0.05 || i.label === 'Trend');
  return (
    <div className="econ-overview">
      <div className="kpi-row" data-testid="econ-kpis">
        <Stat label="GDP" value={formatMoney(n.gdp)} tooltip={`Annual output. Potential output (full employment) is ${formatMoney(n.potentialGdp)}; the gap is ${formatPct(g.gap * 100, 1, true)}.`} />
        <Stat label="Growth" value={formatPct(n.growth, 1, true)} tooltip="Annualised real growth last month; the breakdown below shows every cause." accent={n.growth < 0 ? '#f87171' : undefined} />
        <Stat label="Inflation" value={formatPct(n.inflation, 1)} tooltip={`Consumer prices, % a year. Moving 15 % a month toward ${formatPct(infl.target, 1)}: anchor ${infl.anchor.toFixed(1)}, demand ${sign(infl.overheating)}, deficits ${sign(infl.deficit)}, mobilisation ${sign(infl.mobilization)}, import prices ${sign(infl.prices)}, shortages ${sign(infl.shortages)}, sanctions ${sign(infl.sanctions)}.`} accent={n.inflation > 15 ? '#f87171' : n.inflation > 6 ? '#fbbf24' : undefined} />
        <Stat label="Debt" value={formatPct(debtPct, 0)} tooltip={`Public debt ${formatMoney(n.debt)}. Markets add a premium above ${formatPct(Math.max(90, (world.nations.get(me)?.debtToGdpPct ?? 60)), 0)} of GDP; default comes at ${formatPct(defaultThreshold(world, me) * 100, 0)}. Inflation erodes it in real terms.`} accent={debtPct > 150 ? '#f87171' : undefined} />
        <Stat label="Interest" value={formatPct(n.interestRate, 1)} tooltip={`Average rate on the debt, drifting toward ${formatPct(ir.target, 1)}: base ${ir.base}, inflation ${sign(ir.inflation)}, debt premium ${sign(ir.debtPremium)}, past default ${sign(ir.defaultPremium)}, sanctions ${sign(ir.sanctions)}. Interest this month ${formatMoney(n.finances.interest)}.`} />
        <Stat label="Cycle" value={n.recession ? 'Recession' : g.gap < -0.02 ? 'Recovery' : g.gap > 0.02 ? 'Overheating' : 'Expansion'} tooltip={`Six consecutive months of contraction is a recession; it ends when growth tops 0.5 %. Months of contraction in a row: ${n.negativeMonths}. Output gap ${formatPct(g.gap * 100, 1, true)}.`} accent={n.recession ? '#f87171' : undefined} />
      </div>
      <div className="econ-charts">
        <LineChart title="GDP" tip="Annual output, US$." samples={samples} pick={(s) => s.gdp} fmt={(v) => formatMoney(v)} color="#38bdf8" testId="chart-gdp" />
        <LineChart title="Growth" tip="Annualised real growth, % a year." samples={samples} pick={(s) => s.growth} fmt={(v) => formatPct(v, 1, true)} color="#4ade80" zero testId="chart-growth" />
        <LineChart title="Inflation" tip="Consumer prices, % a year." samples={samples} pick={(s) => s.inflation} fmt={(v) => formatPct(v, 1)} color="#fbbf24" testId="chart-inflation" />
        <LineChart title="Debt" tip="Public debt, % of GDP." samples={samples} pick={(s) => s.debt} fmt={(v) => formatPct(v, 0)} color="#f87171" testId="chart-debt" />
      </div>
      <div className="section-title">Why growth is {formatPct(g.total, 1, true)} this month</div>
      <Contributions items={items} unit=" pp" testId="growth-breakdown" />
    </div>
  );
}

function BudgetTab({ game, me }: { game: GameState; me: Iso3 }) {
  const n = game.nations[me]!;
  const f = n.finances;
  const [tax, setTax] = useState<{ turn: number; v: number } | null>(null);
  const taxV = tax && tax.turn === game.turn ? tax.v : n.taxRate;
  const revenueAt = (rate: number) => monthlyRevenue({ ...n, taxRate: rate }, controlShare(world, game, me));
  const spend = [
    { key: 'military', label: 'Military', v: f.military, tip: 'Upkeep of every formation first; the rest flows to the treasury for production.' },
    { key: 'research', label: 'Research', v: f.research, tip: 'Laboratories and programmes.' },
    { key: 'infrastructure', label: 'Infrastructure', v: f.infrastructure, tip: 'Roads, rail, grids and ports: above 20 % of the budget it adds growth.' },
    { key: 'social', label: 'Social', v: f.social, tip: 'Health, pensions and welfare: above 30 % it adds stability and approval.' },
    { key: 'debt', label: 'Debt service', v: f.debtService, tip: `Pays interest (${formatMoney(f.interest)} this month) first, then principal.` },
  ];
  const total = spend.reduce((s, x) => s + x.v, 0) || 1;
  const bonds = canIssueWarBonds(game, me);
  const mob = (lvl: MobilizationLevel) => {
    playSound('click');
    dispatch({ type: 'setMobilization', level: lvl });
  };
  const levels: { lvl: MobilizationLevel; label: string }[] = [
    { lvl: 0, label: 'Peace' },
    { lvl: 1, label: 'Partial' },
    { lvl: 2, label: 'Total war' },
  ];
  return (
    <div className="econ-two">
      <div>
        <div className="section-title">Spending last month</div>
        <div className="budget-bar" data-testid="econ-budget-bar">
          {spend.map((s) => (
            <span key={s.key} className={`budget-seg ${s.key}`} style={{ width: `${(s.v / total) * 100}%` }} data-tip={`${s.label}: ${formatMoney(s.v)} (${formatPct((s.v / total) * 100, 0)}). ${s.tip}`} />
          ))}
        </div>
        <div className="finance-table" style={{ marginTop: 10 }}>
          <div className="finance-row">
            <span>Revenue</span>
            <Stat value={formatMoney(f.revenue)} tooltip={`Taxes: ${n.taxRate} % of the GDP you control, per month.`} inline />
          </div>
          {spend.map((s) => (
            <div key={s.key} className="finance-row">
              <span>{s.label}</span>
              <Stat value={formatMoney(s.v)} tooltip={`${s.tip} Last month.`} inline />
            </div>
          ))}
          <div className="finance-row">
            <span>Borrowed</span>
            <Stat value={formatPct(n.econ.deficitPct, 1)} tooltip="Real new borrowing last month, as % of GDP a year. Above 3 % it feeds inflation." inline />
          </div>
          <div className="finance-row">
            <span>War bonds outstanding</span>
            <Stat value={formatMoney(n.warBonds)} tooltip="Patriotic bonds sold to savers; part of the public debt." inline />
          </div>
        </div>
        <div className="section-title">Taxes</div>
        <div className="budget-row">
          <span data-tip={`Government revenue as % of GDP. ${DEFAULT_TAX_RATE} % is neutral; each point above costs 0.06 pp of growth and 0.6 approval, each point below adds them.`}>Tax rate</span>
          <input type="range" min={TAX_MIN} max={TAX_MAX} value={taxV} onChange={(e) => setTax({ turn: game.turn, v: Number(e.target.value) })} aria-label="Tax rate" data-testid="tax-slider" />
          <Stat value={formatPct(taxV, 0)} tooltip={`At ${taxV} %: revenue ≈ ${formatMoney(revenueAt(taxV))} a month, growth ${sign(-(taxV - DEFAULT_TAX_RATE) * 0.06, 2)} pp, approval ${sign(-0.6 * (taxV - DEFAULT_TAX_RATE))}.`} inline />
        </div>
        <button className="btn small" disabled={taxV === n.taxRate} onClick={() => dispatch({ type: 'setTaxRate', rate: taxV })} data-testid="tax-apply" data-tip="Apply the new tax rate from next month.">
          Set taxes
        </button>
      </div>
      <div>
        <div className="section-title">Mobilisation</div>
        <div className="seg" data-testid="mobilization">
          {levels.map(({ lvl, label }) => (
            <button
              key={lvl}
              className={`seg-btn ${n.mobilization === lvl ? 'active' : ''}`}
              onClick={() => mob(lvl)}
              data-tip={`${label}: production ×${MOBILIZATION_PRODUCTION[lvl]} cheaper and faster, growth −${MOBILIZATION_GROWTH_DRAG[lvl]} pp, stability −${MOBILIZATION_STABILITY[lvl]}/month, inflation +${MOBILIZATION_INFLATION[lvl]} pp, approval ${MOBILIZATION_SUPPORT[lvl]}, oil/steel/chip demand up. Raising it adds global tension.`}
              data-testid={`mob-${lvl}`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="hint">Mobilising converts the economy to war production: cheaper, faster units at the cost of growth, prices and patience.</p>
        <div className="section-title">War bonds</div>
        <p className="hint">Borrow {formatPct(WAR_BOND_SHARE * 100, 1)} of GDP from your own savers. At war it rallies the public (approval +3, weariness −3) and feeds inflation less than printing money.</p>
        <button className="btn" disabled={bonds !== null} onClick={() => { playSound('accept'); dispatch({ type: 'issueWarBonds' }); }} data-tip={bonds ?? `Raise ${formatMoney(n.gdp * WAR_BOND_SHARE)} now; adds the same to public debt.`} data-testid="war-bonds">
          Issue war bonds
        </button>
      </div>
    </div>
  );
}

function TradeTab({ game, me }: { game: GameState; me: Iso3 }) {
  const n = game.nations[me]!;
  const partners = tradePartners(game, me).slice(0, 14);
  const max = Math.max(1, ...partners.map((p) => Math.max(p.route.volume, p.route.reference)));
  const total = partners.reduce((s, p) => s + p.route.volume, 0);
  const setMapMode = useUiStore((s) => s.setMapMode);
  return (
    <div>
      <div className="kpi-row">
        <Stat label="Listed trade" value={formatMoney(total)} tooltip="Two-way goods trade with your largest partners this year (data: national customs statistics, approximately 2024; most rows are estimates)." />
        <Stat label="Lost vs 2027" value={formatMoney(n.econ.tradeLost)} tooltip="Trade that wars, sanctions, embargoes and cut sea routes have removed since January 2027 (negative: trade gained through new agreements)." accent={n.econ.tradeLost > 1 ? '#f87171' : undefined} />
        <Stat label="Growth effect" value={`${sign(n.econ.tradeEffect, 2)} pp`} tooltip="0.6 pp of annual growth per 1 % of GDP of trade lost." />
        <Stat label="Secondary penalties" value={formatMoney(n.econ.secondaryLost)} tooltip="Trade you lose because you defy another power's secondary sanctions." accent={n.econ.secondaryLost > 0 ? '#f87171' : undefined} />
        <button className="btn small" onClick={() => setMapMode('economy')} data-tip="Show trade routes as flowing arcs on the globe (map mode 4)." data-testid="show-trade-map">
          Show on map
        </button>
      </div>
      <div className="section-title">Top trade partners</div>
      <div className="trade-list" data-testid="trade-partners">
        {partners.map(({ partner, route }) => {
          const st = STATUS_INFO[route.status];
          return (
            <div key={partner} className="trade-row">
              <span className="trade-name" style={{ color: nationHex(partner) }}>
                {nationName(world, partner)}
              </span>
              <span className="trade-track" data-tip={`${nationName(world, partner)}: ${formatMoney(route.volume)} a year now, ${formatMoney(route.reference)} under 2027 conditions (data: ${formatMoney(route.base)}). ${route.land ? 'Overland.' : `By sea through ${route.via.length} zones.`} ${route.note}`}>
                <span className="trade-ref" style={{ width: `${(route.reference / max) * 100}%` }} />
                <span className="trade-vol" style={{ width: `${(route.volume / max) * 100}%`, background: st.color }} />
              </span>
              <Stat value={formatMoney(route.volume)} tooltip={`Current two-way goods trade with ${nationName(world, partner)}, US$ a year. ${route.note || 'Flowing normally.'}`} inline />
              <span className="chip tiny" style={{ color: st.color, borderColor: st.color }} data-tip={route.note || 'Flowing normally.'}>
                {st.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ResourcesTab({ game, me }: { game: GameState; me: Iso3 }) {
  const n = game.nations[me]!;
  return (
    <div>
      <div className="res-grid" data-testid="resource-balance">
        {RESOURCE_IDS.map((r) => {
          const meta = world.resourceById.get(r)!;
          const b = n.resources[r];
          const price = game.economy.prices[r] ?? 1;
          const toUnits = (share: number) => `${(share * meta.worldOutput).toFixed(meta.worldOutput >= 100 ? 0 : 1)} ${meta.unit.split(' ')[0]}`;
          const net = b.production - b.demand;
          const sup = Object.entries(b.suppliers);
          return (
            <div key={r} className="res-card" style={{ borderColor: RESOURCE_COLOR[r] }}>
              <div className="res-head">
                <span style={{ color: RESOURCE_COLOR[r] }} data-tip={`${meta.description} Source: ${meta.source}`}>
                  {meta.name}
                </span>
                <Stat value={formatPct(b.satisfaction * 100, 0)} tooltip={`Share of your demand met by home production plus imports. Below 100 % the shortfall slows units and research that need it and costs growth (${meta.gdpWeight} pp at a total shortage).`} accent={b.satisfaction < 0.9 ? '#f87171' : '#4ade80'} inline />
              </div>
              <Meter value={b.satisfaction} color={RESOURCE_COLOR[r]} tip={`Supply ${formatPct(b.satisfaction * 100, 0)} of demand.`} />
              <div className="res-rows">
                <Stat label="Production" value={formatPct(b.production * 100, 1)} tooltip={`Your output, % of world output at the start (${toUnits(b.production)} of ${meta.unit}). Falls with occupation and war damage.`} inline />
                <Stat label="Demand" value={formatPct(b.demand * 100, 1)} tooltip={`What your economy and armed forces consume, % of world output (${toUnits(b.demand)}). Grows with GDP and mobilisation.`} inline />
                <Stat label={net >= 0 ? 'Exports' : 'Imports'} value={formatPct((net >= 0 ? b.exports : b.imports) * 100, 1)} tooltip={net >= 0 ? 'Sold abroad this month (% of world output). Earnings count toward growth.' : 'Bought abroad this month (% of world output), along open trade routes from partners not sanctioning you.'} inline />
                <Stat label="Price" value={`×${price.toFixed(2)}`} tooltip={`World price index (1 = January 2027): moves toward (demand ÷ delivered)^1.6. World shortage ${formatPct((game.economy.shortage[r] ?? 0) * 100, 1)}.`} accent={price > 1.2 ? '#f87171' : undefined} inline />
              </div>
              <div className="res-suppliers">
                {sup.length === 0 ? (
                  <span className="hint" data-tip="No imports this month: you are self-sufficient or cut off.">{net >= 0 ? 'Self-sufficient' : 'No suppliers reachable'}</span>
                ) : (
                  sup.map(([iso, v]) => (
                    <span key={iso} className="chip tiny" data-tip={`${nationName(world, iso)} supplied ${formatPct(v * 100, 2)} of world output to you this month.`}>
                      {nationName(world, iso)}
                    </span>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="section-title">What shortages are doing to your war machine</div>
      <div className="throttle-grid">
        {(['infantry', 'armored', 'fighter', 'drone', 'destroyerGroup'] as const).map((t) => {
          const v = productionThroughput(world, game, me, t);
          return (
            <span key={t} className="throttle">
              <span>{world.unitTypes.get(t)?.name}</span>
              <Stat value={formatPct(v * 100, 0)} tooltip={`Build speed of a ${world.unitTypes.get(t)?.name}: inputs ${Object.entries(world.unitInputs.get(t) ?? {}).map(([k, w]) => `${world.resourceById.get(k as ResourceId)?.name} ${Math.round((w ?? 0) * 100)} %`).join(', ')}. Shortages slow the line (to 25 % at worst) and raise its cost.`} accent={v < 0.95 ? '#f87171' : undefined} inline />
            </span>
          );
        })}
        {(['ai', 'missiles', 'semiconductors', 'energy'] as const).map((b) => {
          const v = researchThroughput(world, game, me, b);
          return (
            <span key={b} className="throttle">
              <span>{world.branches.find((x) => x.id === b)?.name}</span>
              <Stat value={formatPct(v * 100, 0)} tooltip={`Research speed in this branch from input shortages (to 40 % at worst).`} accent={v < 0.95 ? '#f87171' : undefined} inline />
            </span>
          );
        })}
      </div>
    </div>
  );
}

function SanctionsTab({ game, me }: { game: GameState; me: Iso3 }) {
  const coalitions = useMemo(() => sanctionCoalitions(game), [game]);
  const [target, setTarget] = useState<Iso3>('');
  const majors = world.majors.filter((m) => m !== me && game.nations[m]?.alive);
  const act = (type: ProposalType, iso: Iso3) => {
    playSound('click');
    dispatch({ type: 'propose', proposal: type, target: iso });
  };
  const preview = target
    ? world.nationList
        .filter((x) => x.iso3 !== me && x.iso3 !== target && game.nations[x.iso3]?.alive)
        .map((x) => coalitionReply(world, game, me, x.iso3, target))
        .filter((r) => r.joins)
    : [];
  return (
    <div className="econ-two">
      <div>
        <div className="section-title">Sanctions coalitions</div>
        <div className="coalitions" data-testid="coalitions">
          {coalitions.slice(0, 12).map((c) => (
            <div key={c.target} className="coalition">
              <div className="coalition-head">
                <span style={{ color: nationHex(c.target) }}>{nationName(world, c.target)}</span>
                <Stat value={formatPct(c.gdpShare * 100, 0)} tooltip={`Share of world GDP sanctioning ${nationName(world, c.target)}. Strategic exports to and from it stop; general trade with sanctioners falls to 30 %.`} inline />
              </div>
              <div className="chips">
                {c.members.slice(0, 14).map((m) => (
                  <span key={m} className={`chip tiny ${m === me ? 'active' : ''}`} data-tip={`${nationName(world, m)}${c.embargo.includes(m) ? ' — total embargo' : ''}${c.secondary.includes(m) ? ' — secondary sanctions on third parties' : ''}`}>
                    {world.nations.get(m)?.iso2 ?? m}
                    {c.embargo.includes(m) ? ' ⛔' : ''}
                    {c.secondary.includes(m) ? ' ²' : ''}
                  </span>
                ))}
                {c.members.length > 14 && <span className="chip tiny" data-tip={c.members.slice(14).map((m) => nationName(world, m)).join(', ')}>+{c.members.length - 14}</span>}
              </div>
              {c.target !== me && (
                <div className="coalition-actions">
                  {!c.members.includes(me) && (
                    <button className="btn small" onClick={() => act('sanction', c.target)} data-tip="Join this coalition: cut strategic trade with the target; your own trade with it suffers too.">
                      Join
                    </button>
                  )}
                  {c.members.includes(me) && !game.embargoes.includes(`${me}>${c.target}`) && (
                    <button className="btn small danger" onClick={() => act('embargo', c.target)} data-tip="Total embargo: all trade stops, food included. Relations −30.">
                      Embargo
                    </button>
                  )}
                  {c.members.includes(me) && !game.secondarySanctions.includes(`${me}>${c.target}`) && (
                    <button className="btn small" onClick={() => act('secondarySanctions', c.target)} data-tip="Secondary sanctions: third countries must choose between trading with the target and with you. Your partners mostly comply; its friends defy and lose part of their trade with you.">
                      Secondary
                    </button>
                  )}
                  {c.members.includes(me) && (
                    <button className="btn small ghost" onClick={() => act('liftSanction', c.target)} data-tip="Lift your sanctions (and any embargo or secondary sanctions) on this nation. Relations +10.">
                      Lift
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="section-title">Rally a coalition</div>
        <p className="hint">Sanction a rival and ask friends to follow. Nations close to you and cool toward the target join, unless their own trade with it is too valuable.</p>
        <select className="input" value={target} onChange={(e) => setTarget(e.target.value)} data-testid="rally-target" aria-label="Coalition target">
          <option value="">Choose a target…</option>
          {majors.map((m) => (
            <option key={m} value={m}>
              {nationName(world, m)}
              {isSanctioned(game, me, m) ? ' (sanctioned)' : ''}
            </option>
          ))}
        </select>
        {target && (
          <>
            <p className="hint" data-tip={preview.map((r) => r.reason).join(' ')}>
              Likely to join: {preview.length === 0 ? 'no one' : preview.map((r) => nationName(world, r.iso)).join(', ')}.
            </p>
            <button className="btn danger" onClick={() => act('rallySanctions', target)} data-testid="rally-go" data-tip="Impose your sanctions and call on friends to join. Relations with the target −20.">
              Sanction and rally
            </button>
          </>
        )}
        <div className="section-title">Sanctions on you</div>
        <p className="hint" data-tip="Nations sanctioning or embargoing you.">
          {coalitions.find((c) => c.target === me)?.members.map((m) => nationName(world, m)).join(', ') || 'None.'}
        </p>
      </div>
    </div>
  );
}

function DomesticTab({ game, me }: { game: GameState; me: Iso3 }) {
  const n = game.nations[me]!;
  const sb = supportBreakdown(world, game, me);
  const coup = coupBreakdown(world, game, me);
  const regime = regimeOf(world, me);
  const samples = game.history[me] ?? [];
  const items: Contribution[] = [
    { label: 'Growth', value: sb.growth, tip: '2 points per point of growth above 1 % (capped).' },
    { label: 'Inflation', value: sb.inflation, tip: 'Half a point per point of inflation above its anchor (or 4 %).' },
    { label: 'Taxes', value: sb.taxes, tip: `0.6 per point of tax above ${DEFAULT_TAX_RATE} %.` },
    { label: 'Social spending', value: sb.social, tip: '0.4 per point of the budget above 30 %.' },
    { label: 'War weariness', value: sb.warWeariness, tip: `0.3 per point of weariness (${Math.round(n.warWeariness)}).` },
    { label: 'Rally round the flag', value: sb.rally, tip: 'Early in a war the public closes ranks; it fades as weariness grows.' },
    { label: 'Mobilisation', value: sb.mobilization, tip: 'Conscription and rationing.' },
    { label: 'Shortages', value: sb.shortages, tip: 'Food (30 per 100 %) and fuel (10 per 100 %) shortfalls against 2027.' },
    { label: 'Lost territory', value: sb.territory, tip: '40 per 100 % of your population under occupation.' },
    { label: 'Jobs', value: sb.unemployment, tip: 'Output below potential means unemployment; a recession costs 4 more.' },
    { label: 'Stability', value: sb.stability, tip: '0.15 per point of stability above or below 50.' },
    { label: 'Protests', value: sb.protests, tip: 'Ongoing mass protests.' },
  ].filter((i) => Math.abs(i.value) >= 0.05);
  const left = n.nextElection !== null ? n.nextElection - game.turn : null;
  const share = projectedVoteShare(world, n);
  const chance = reelectionChance(world, n);
  return (
    <div className="econ-two">
      <div>
        <div className="kpi-row">
          <Stat label="Approval" value={`${Math.round(n.support)}`} tooltip={`Public support for your government, 0–100, moving 12 % a month toward ${Math.round(sb.target)}. Below ${regime ? PROTEST_THRESHOLD[regime] : 30} (with stability under 55) people take to the streets.`} accent={n.support < 35 ? '#f87171' : undefined} />
          <Stat label="Stability" value={`${Math.round(n.stability)}`} tooltip="Public order, 0–100. Below 10 for three months the regime collapses." />
          <Stat label="Protests" value={n.protestMonths > 0 ? `${n.protestMonths} mo` : 'None'} tooltip="Months of mass protests in a row: each costs 1 stability; from the third month they also cost growth." accent={n.protestMonths > 0 ? '#f87171' : undefined} />
          <Stat label="Regime" value={regime ? regime[0]!.toUpperCase() + regime.slice(1) : 'n/a'} tooltip="EIU Democracy Index 2024 category. Democracies face elections; autocracies face coups; hybrid regimes both, more mildly." />
        </div>
        <LineChart title="Approval" tip="Public support, 0–100." samples={samples} pick={(s) => s.support} fmt={(v) => `${Math.round(v)}`} color="#a78bfa" range={[0, 100]} testId="chart-support" />
        <div className="section-title">What drives approval</div>
        <Contributions items={items} unit="" testId="support-breakdown" />
      </div>
      <div>
        <div className="section-title">Next election</div>
        {left === null ? (
          <p className="hint" data-tip="Only democracies and hybrid regimes hold elections that can remove the government.">No competitive national elections.</p>
        ) : (
          <div className="election" data-testid="election">
            <Stat label="When" value={formatMonthShort(dateForTurn(n.nextElection!))} tooltip={`${left} months from now. Losing ends your game.`} />
            <Stat label="Polls" value={formatPct(share, 1)} tooltip={`Projected vote share: 50 + 0.7 × (approval − 50)${regime === 'hybrid' ? ' + 10 incumbency (hybrid regime)' : ' + 1 incumbency'}, ±3 on the day.`} accent={share < 50 ? '#f87171' : '#4ade80'} />
            <Stat label="Chance to stay" value={formatPct(chance * 100, 0)} tooltip="Probability of winning at today's polls." accent={chance < 0.5 ? '#f87171' : undefined} />
            {chance < 0.5 && <div className="reply danger-text">You are projected to lose. Losing the election ends your game: raise approval before polling day.</div>}
          </div>
        )}
        <div className="section-title">Coup risk</div>
        <Stat value={formatPct(coup.total * 100, 2)} tooltip={`Monthly probability that the army moves against you: low approval ${formatPct(coup.support * 100, 2)}, low stability ${formatPct(coup.stability * 100, 2)}, battlefield defeat ${formatPct(coup.defeat * 100, 2)}, neglected army ${formatPct(coup.army * 100, 2)}, recession ${formatPct(coup.recession * 100, 2)}, protests ${formatPct(coup.protests * 100, 2)} — ×${coup.regimeFactor} for your regime. A coup ends your game.`} accent={coup.total >= 0.01 ? '#f87171' : undefined} />
        <p className="hint">{regime === 'democracy' ? 'Democracies do not face coups in this simulation.' : 'Keep approval above 35, stability above 30 and the military budget above 8 % to keep the generals loyal.'}</p>
      </div>
    </div>
  );
}

export function EconomyModal() {
  const game = useGameStore((s) => s.game);
  const [tab, setTab] = useState<Tab>('overview');
  if (!game) return null;
  const me = game.player;
  const n = game.nations[me]!;
  return (
    <Modal
      title="Economy"
      subtitle={`${formatMoney(n.gdp)} economy, ${formatPct(n.growth, 1, true)} growth, ${formatPct(n.inflation, 1)} inflation, approval ${Math.round(n.support)}. Charts begin in January 2027.`}
      wide
      testId="modal-economy"
    >
      <div className="seg" style={{ marginBottom: 12 }}>
        {TABS.map((t) => (
          <button key={t.id} className={`seg-btn ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)} data-tip={t.tip} data-testid={`econ-tab-${t.id}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <Overview game={game} me={me} />}
      {tab === 'budget' && <BudgetTab game={game} me={me} />}
      {tab === 'trade' && <TradeTab game={game} me={me} />}
      {tab === 'resources' && <ResourcesTab game={game} me={me} />}
      {tab === 'sanctions' && <SanctionsTab game={game} me={me} />}
      {tab === 'domestic' && <DomesticTab game={game} me={me} />}
    </Modal>
  );
}
