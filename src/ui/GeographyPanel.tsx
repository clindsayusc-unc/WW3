/**
 * Region geography, battle-odds breakdown, route preview and chokepoint controls for the context
 * panel (D-053). Every number goes through <Stat> or carries a data-tip.
 */
import { useUiStore } from '../state/uiStore';
import { dispatch } from '../state/simBridge';
import { loadWorld, nationName, type ChokepointMeta, type RegionMeta } from '../sim/world';
import { TERRAIN, describeWeather, weatherAt } from '../sim/terrain';
import {
  canCloseChokepoint,
  canMineChokepoint,
  chokepointState,
  crossingBetween,
  shoreControllers,
} from '../sim/geography';
import { SUPPLY_THRESHOLD, depotKind } from '../sim/military';
import { INTEL_LABEL } from '../sim/intel';
import type { GameState, Modifier, OddsReport, RegionState } from '../sim/types';
import { Stat } from './Stat';
import { formatPct } from './format';
import { playSound } from './audio';
import { TERRAIN_TINT } from '../render/palette';

const world = loadWorld();
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const COVER_LABEL: Record<string, string> = {
  forest: 'forest',
  jungle: 'jungle',
  woodland: 'open woodland',
  shrub: 'shrubland',
  savanna: 'savanna',
  grassland: 'grassland',
  marsh: 'wetland',
  cropland: 'cropland',
  urban: 'built-up',
  ice: 'ice',
  barren: 'barren',
  water: 'water',
};
const COVER_COLOR: Record<string, string> = {
  forest: '#2f7a3a',
  jungle: '#1f6b34',
  woodland: '#5c8f3a',
  shrub: '#b5a35a',
  savanna: '#c2b35c',
  grassland: '#9fbf5a',
  marsh: '#4f9a8a',
  cropland: '#d9c36a',
  urban: '#b8b4c4',
  ice: '#eef4fa',
  barren: '#e3c27a',
  water: '#3b6fa0',
};

export function TerrainSection({
  meta,
  rs,
  game,
}: {
  meta: RegionMeta;
  rs: RegionState;
  game: GameState;
}) {
  const rule = TERRAIN[meta.terrain];
  const w = weatherAt(world, meta.id, game.date.month);
  const cover = Object.entries(meta.cover)
    .filter(([, v]) => v >= 0.03)
    .sort((a, b) => b[1] - a[1]);
  const hover = useUiStore((s) => s.hoverRegion);
  const selected = useUiStore((s) => s.selectedRegion);
  const other =
    selected !== null && selected !== meta.id
      ? selected
      : hover !== null && hover !== meta.id
        ? hover
        : null;
  const crossing = other !== null ? crossingBetween(world, meta.id, other) : null;
  const c = meta.climate;
  return (
    <div className="panel-section">
      <div className="section-title">Terrain</div>
      <div className="row">
        <Stat
          label="Terrain"
          value={rule.name}
          tooltip={`${rule.description} Defence ×${rule.defence}, armour ×${rule.armour}, air support ×${rule.air}, movement ×${rule.moveCost}. Classified from ETOPO 2022 relief and MODIS land cover.`}
          accent={TERRAIN_TINT[meta.terrain]}
        />
        <Stat
          label="Elevation"
          value={`${meta.elevMean} m`}
          tooltip={`Mean elevation ${meta.elevMean} m, highest point ${meta.elevMax} m, spread ±${meta.elevStd} m (NOAA ETOPO 2022).`}
        />
        <Stat
          label="Relief"
          value={`${meta.ruggedness} m`}
          tooltip={`Ruggedness: mean height difference between neighbouring 3.7 km cells. Under 70 m is flat, over 130 m is mountain country.`}
        />
      </div>
      <div
        className="cover-bar"
        data-tip={`Land cover (MODIS IGBP, 2022): ${cover.map(([k, v]) => `${COVER_LABEL[k] ?? k} ${Math.round(v * 100)} %`).join(', ')}.`}
      >
        {cover.map(([k, v]) => (
          <span key={k} style={{ width: `${v * 100}%`, background: COVER_COLOR[k] ?? '#888' }} />
        ))}
      </div>
      <div className="row">
        <Stat
          label="Infrastructure"
          value={formatPct(meta.infrastructure * 100, 0)}
          tooltip={`Road and rail density index (Natural Earth). Supply loses less per region where infrastructure is dense: ×${(1.4 - 0.8 * meta.infrastructure).toFixed(2)} of the terrain's base loss here.`}
        />
        <Stat
          label="Ports"
          value={meta.portCapacity > 0 ? `${meta.portCapacity}` : 'none'}
          tooltip={
            meta.portCapacity > 0
              ? `Port capacity ${meta.portCapacity} (NGA World Port Index: ${meta.ports.map((p) => `${p.name} ${p.size}`).join(', ')}). Seaborne supply landing here is capped at ${Math.round(Math.min(1, 0.35 + 0.15 * meta.portCapacity) * 100)} %; a beach with no port caps at 35 %.`
              : meta.coastal
                ? 'Coastal but without a harbour: a landing here is supplied over the beach at 35 % at best.'
                : 'Landlocked.'
          }
        />
        <Stat
          label="Supply"
          value={rs.controller ? formatPct(rs.supply * 100, 0) : '—'}
          tooltip={`Supply reaching the controller here${rs.controller && depotKind(world, rs.controller, meta.id) ? ` — a depot (${depotKind(world, rs.controller, meta.id)})` : ''}. Depots are capitals, industrial regions and major ports; supply spreads from them through owned and allied land and controlled sea zones, losing a share at every region, sea zone, river and mountain; home regions linked to the capital never drop below 55 %. Enemy interdiction wings and bombed infrastructure${rs.infraDamage > 0 ? ` (${Math.round(rs.infraDamage * 100)} % damaged here)` : ''} cut it further. Below ${Math.round(SUPPLY_THRESHOLD * 100)} % units are cut off: they fight at half strength and lose 4 strength and 4 morale a month.`}
          accent={
            rs.supply < SUPPLY_THRESHOLD ? 'var(--bad)' : rs.supply < 0.6 ? 'var(--warn)' : undefined
          }
        />
      </div>
      {c && (
        <div className="row">
          <Stat
            label={`Weather (${MONTH[game.date.month - 1]})`}
            value={describeWeather(w)}
            tooltip={`${w.tempC.toFixed(0)} °C mean, ${w.precipMm} mm rain this month (MERRA-2 2023). Winter ${formatPct(w.winter * 100, 0)}: attack ×${(1 - 0.35 * w.winter).toFixed(2)}, movement ×${(1 + 0.8 * w.winter).toFixed(2)}, ${(8 * w.winter).toFixed(0)} strength/month attrition for troops off their own soil. Monsoon ${formatPct(w.monsoon * 100, 0)}: attack ×${(1 - 0.3 * w.monsoon).toFixed(2)}, air ×${(1 - 0.45 * w.monsoon).toFixed(2)}. Heat ${formatPct(w.heat * 100, 0)}: attack ×${(1 - 0.15 * w.heat).toFixed(2)}, ${(4 * w.heat).toFixed(0)} attrition.`}
            accent={w.winter + w.monsoon + w.heat > 0.5 ? 'var(--warn)' : undefined}
          />
          <Stat
            label="Year"
            value={`${Math.min(...c.tempC).toFixed(0)}…${Math.max(...c.tempC).toFixed(0)} °C`}
            tooltip={`Monthly means Jan–Dec: ${c.tempC.map((t) => t.toFixed(0)).join('/')} °C; rain ${c.precipMm.join('/')} mm. Winter months: ${
              c.winter
                .map((v, i) => (v >= 0.15 ? MONTH[i] : null))
                .filter(Boolean)
                .join(' ') || 'none'
            }; monsoon: ${
              c.monsoon
                .map((v, i) => (v >= 0.15 ? MONTH[i] : null))
                .filter(Boolean)
                .join(' ') || 'none'
            }; extreme heat: ${
              c.heat
                .map((v, i) => (v >= 0.15 ? MONTH[i] : null))
                .filter(Boolean)
                .join(' ') || 'none'
            }.`}
          />
        </div>
      )}
      {crossing && other !== null && (
        <p
          className="hint"
          data-tip="Crossing features on the border with the other highlighted region. Attacks across it pay the penalty unless units are already inside (a bridgehead) or engineering tech is researched."
        >
          Border with {world.regions.get(other)?.name}:{' '}
          {[
            ...crossing.rivers.map((r) => `river ${r}`),
            ...(crossing.mountain
              ? [
                  crossing.ranges.length
                    ? `mountains (${crossing.ranges.join(', ')})`
                    : 'mountain border',
                ]
              : []),
            ...(crossing.pass ? [`pass: ${crossing.pass}`] : []),
          ].join(' · ')}
        </p>
      )}
    </div>
  );
}

export function BreakdownRows({ title, mods }: { title: string; mods: Modifier[] }) {
  return (
    <>
      <div className="bk-head">{title}</div>
      {mods.map((m) => {
        const good = m.factor > 1.001;
        const bad = m.factor < 0.999;
        const width = Math.min(100, Math.abs(Math.log2(Math.max(0.05, m.factor))) * 50);
        return (
          <div key={m.label} style={{ display: 'contents' }} data-tip={m.detail}>
            <span className="bk-label" data-tip={m.detail}>
              {m.label}
            </span>
            <span className="bk-bar" data-tip={m.detail}>
              <span
                style={{
                  width: `${width}%`,
                  background: good ? 'var(--good)' : bad ? 'var(--bad)' : '#94a3b8',
                }}
              />
            </span>
            <Stat
              value={`×${m.factor.toFixed(2)}`}
              tooltip={m.detail}
              inline
              className={`bk-value ${good ? 'good' : bad ? 'bad' : ''}`}
            />
          </div>
        );
      })}
    </>
  );
}

export function OddsBreakdown({ report }: { report: OddsReport }) {
  const target = world.regions.get(report.target);
  return (
    <div className="odds" data-testid="odds-breakdown">
      <Stat
        label="Odds"
        value={report.text}
        tooltip="Attack power ÷ defence power, with every multiplier applied — the same numbers the battle will use."
        breakdown={[
          ...report.attacker.map((m) => ({ label: `Attacker · ${m.label}`, value: `×${m.factor.toFixed(2)}`, tip: m.detail, tone: m.factor > 1.001 ? ('good' as const) : m.factor < 0.999 ? ('bad' as const) : ('neutral' as const) })),
          ...report.defender.map((m) => ({ label: `Defender · ${m.label}`, value: `×${m.factor.toFixed(2)}`, tip: m.detail, tone: m.factor > 1.001 ? ('bad' as const) : m.factor < 0.999 ? ('good' as const) : ('neutral' as const) })),
        ]}
        testId="odds-headline"
        inline
      />
      {report.intel < 4 && (
        <div
          className="hint"
          data-tip="Your intelligence on the target: satellites, ISR tech, recon wings, spy networks and allied coverage raise it; distance, enemy counterspace and cyber blinding lower it. Below level 3 the defender count and the odds are estimates."
        >
          Intelligence: {INTEL_LABEL[report.intel]} ({report.intel}/4)
        </div>
      )}
      {(report.attacker.length > 0 || report.defender.length > 0) && (
        <div className="breakdown">
          {report.attacker.length > 0 && (
            <BreakdownRows title={`Attacker in ${target?.name ?? ''}`} mods={report.attacker} />
          )}
          {report.defender.length > 0 && <BreakdownRows title="Defender" mods={report.defender} />}
        </div>
      )}
      {report.path && (
        <div className="route" data-testid="route-preview">
          <div className="section-title">
            Route ·{' '}
            <Stat
              value={`${report.path.turns}`}
              tooltip={`Months to arrive: total movement cost ${report.path.totalCost} ÷ movement points per month. Terrain, weather and river or mountain crossings raise each step's cost.`}
              inline
            />{' '}
            month{report.path.turns === 1 ? '' : 's'}
          </div>
          {report.path.regions.map((r, i) => (
            <div key={r} className="route-step">
              <span>{world.regions.get(r)?.name}</span>
              <span className="mono">
                <Stat
                  value={`cost ${report.path!.costs[i]}`}
                  tooltip={`Movement cost of entering ${world.regions.get(r)?.name}: ${TERRAIN[world.regions.get(r)?.terrain ?? 'plains'].name} base ×${TERRAIN[world.regions.get(r)?.terrain ?? 'plains'].moveCost} with this month's weather, plus any river or mountain crossing.`}
                  inline
                />{' '}
                <Stat
                  value={`supply ${Math.round((report.path!.supply[i] ?? 0) * 100)}%`}
                  tooltip="Supply level the unit would have there, as things stand now: decays with every region, sea zone and crossing from the nearest depot or port."
                  inline
                  accent={(report.path!.supply[i] ?? 0) < SUPPLY_THRESHOLD ? 'var(--bad)' : undefined}
                />
              </span>
            </div>
          ))}
        </div>
      )}
      {report.pathNote && <p className="hint">{report.pathNote}</p>}
    </div>
  );
}

export function ChokepointSection({ c, game }: { c: ChokepointMeta; game: GameState }) {
  const s = chokepointState(game, c.id);
  const shores = shoreControllers(world, game, c);
  const mine = game.player;
  const closeWhy = canCloseChokepoint(world, game, mine, c);
  const mineWhy = canMineChokepoint(world, game, mine, c);
  const act = (action: 'close' | 'open' | 'mine' | 'clear') => {
    dispatch({ type: 'chokepoint', id: c.id, action });
    playSound('order');
  };
  return (
    <div className="panel-section" data-testid={`chokepoint-${c.id}`}>
      <div className="section-title">⚓ {c.name}</div>
      <div className="row">
        <span className={`choke-status ${s.status}`} data-tip={c.note}>
          {s.status}
          {s.by ? ` by ${nationName(world, s.by)}` : ''}
          {s.mined ? ' · mined' : ''}
        </span>
      </div>
      <div className="row">
        <Stat
          label="Oil"
          value={c.oilMbd !== null ? `${c.oilMbd} mb/d` : '—'}
          tooltip={`Petroleum flow through the strait in 2023 (US EIA). Closing it raises the world oil price index by ${Math.round(c.oilShock * 100)} %.`}
        />
        <Stat
          label="Trade"
          value={formatPct(c.tradeShare * 100, 0)}
          tooltip={`Rough share of world seaborne trade passing through (public estimates). Dependent economies: ${Object.entries(
            c.dependents,
          )
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([iso, v]) => `${nationName(world, iso)} ${Math.round(v * 100)} %`)
            .join(
              ', ',
            )}.${c.semiconductors ? ' Semiconductor flows run through it: closure slows research and raises production costs for chip importers.' : ''}`}
        />
        <Stat
          label="Oil price"
          value={`×${game.oilPrice.toFixed(2)}`}
          tooltip={`World oil price index: 1.00 = all straits open, the pre-war 2025 market (Brent about US$69/bbl, EIA); now about US$${Math.round(69 * game.oilPrice)}/bbl. Each closed chokepoint adds its oil shock (half while contested); importers lose growth, exporters gain. The campaign opens with Hormuz closed by Iran (x1.60; Brent was about US$105 on 3 Nov 2026).`}
          accent={game.oilPrice > 1.15 ? 'var(--bad)' : undefined}
        />
      </div>
      <p
        className="hint"
        data-tip="Nations controlling at least one shore can close the strait while at war; ships in the strait can lay or clear mines."
      >
        Shores: {shores.map((iso) => nationName(world, iso)).join(', ') || 'none'}
      </p>
      <div className="choke-actions">
        {s.status === 'open' || s.by !== mine ? (
          <button
            className="btn small"
            disabled={!!closeWhy}
            data-tip={
              closeWhy ??
              'Close the strait to hostile shipping: reroutes trade, spikes oil, blocks enemy fleets.'
            }
            onClick={() => act('close')}
          >
            Close
          </button>
        ) : (
          <button className="btn small" data-tip="Reopen the strait." onClick={() => act('open')}>
            Reopen
          </button>
        )}
        {!s.mined ? (
          <button
            className="btn small ghost"
            disabled={!!mineWhy}
            data-tip={
              mineWhy ??
              'Lay mines with a submarine or destroyer group in the strait. Keeps it closed even if you lose the shore.'
            }
            onClick={() => act('mine')}
          >
            Mine
          </button>
        ) : (
          <button
            className="btn small ghost"
            disabled={!!mineWhy}
            data-tip={
              mineWhy ??
              'Sweep the minefield (60 % per month with a destroyer or submarine group present).'
            }
            onClick={() => act('clear')}
          >
            Clear mines
          </button>
        )}
      </div>
    </div>
  );
}
