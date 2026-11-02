import { useEffect, useState } from 'react';
import { useGameStore } from '../state/gameStore';
import { useUiStore } from '../state/uiStore';
import { loadWorld, nationName } from '../sim/world';
import { Stat } from './Stat';
import { formatMoney, formatPct, formatPop } from './format';
import { flagEmoji } from './flags';
import { nationHex } from '../render/palette';
import { getRelation, unitsIn, isAtWar, atWar } from '../sim/query';
import { relationLabel } from '../sim/diplomacy';
import { requestOdds } from '../state/simBridge';
import { playSound } from './audio';
import type { Unit } from '../sim/types';

const world = loadWorld();

export function ContextPanel() {
  const game = useGameStore((s) => s.game);
  const selected = useUiStore((s) => s.selectedRegion);
  const selectedUnits = useUiStore((s) => s.selectedUnitIds);
  const selectUnits = useUiStore((s) => s.selectUnits);
  const hover = useUiStore((s) => s.hoverRegion);
  const [oddsFor, setOddsFor] = useState<{ target: number; text: string } | null>(null);
  useEffect(() => {
    if (!hover || selectedUnits.length === 0 || hover === selected) return;
    requestOdds(selectedUnits, hover, (target, _ratio, text) => setOddsFor({ target, text }));
  }, [hover, selectedUnits, selected]);
  const odds =
    oddsFor && oddsFor.target === hover && hover !== selected && selectedUnits.length > 0
      ? oddsFor.text
      : null;
  if (!game) return null;
  const id = selected ?? hover;
  if (!id) {
    return (
      <aside className="panel panel-right muted" data-testid="context-panel">
        <div className="section-title">Map</div>
        <p className="hint">
          Hover a region for details. Click to select. Select your units, then right-click a
          destination to move or attack.
        </p>
        <p className="hint">Scroll to zoom, drag to orbit. Keys 1–6 switch map modes.</p>
      </aside>
    );
  }
  const meta = world.regions.get(id);
  const rs = game.regions[id];
  if (!meta || !rs) return null;
  const units = unitsIn(game, id);
  const byOwner = new Map<string, Unit[]>();
  for (const u of units) byOwner.set(u.owner, [...(byOwner.get(u.owner) ?? []), u]);
  const owner = rs.owner;
  const controller = rs.controller;
  const nation = controller ? game.nations[controller] : undefined;
  const nationMeta = controller ? world.nations.get(controller) : undefined;
  const regionGdp = owner
    ? (game.nations[owner]?.gdp ?? 0) * meta.populationShare * (1 - rs.devastation)
    : 0;
  const toggleStack = (list: Unit[]) => {
    const ids = list.map((u) => u.id);
    const all = ids.every((x) => selectedUnits.includes(x));
    selectUnits(
      all
        ? selectedUnits.filter((x) => !ids.includes(x))
        : [...new Set([...selectedUnits, ...ids])],
    );
    playSound('click');
  };
  return (
    <aside className="panel panel-right" data-testid="context-panel">
      <div className="context-head">
        <div className="context-kicker">
          {meta.sea
            ? 'Sea zone'
            : controller
              ? `${flagEmoji(nationMeta?.iso2 ?? '')} ${nationName(world, controller)}`
              : 'Unclaimed'}
        </div>
        <h3 className="context-title">{meta.name}</h3>
        {!meta.sea && owner && owner !== controller && (
          <div
            className="occupied"
            data-tip="This region's owner has lost control of it. Liberating it returns it to the owner; a peace recognising the front line transfers it."
          >
            Occupied by {nationName(world, controller)} — owned by {nationName(world, owner)}
          </div>
        )}
      </div>
      {!meta.sea && (
        <div className="panel-section">
          <div className="row">
            <Stat
              label="Population"
              value={formatPop(meta.population)}
              tooltip="Natural Earth country population × ½(area share + city-population share) — an estimate."
            />
            <Stat
              label="Output"
              value={formatMoney(regionGdp)}
              tooltip={`Share of the owner's GDP produced here (${formatPct(meta.populationShare * 100, 1)})${rs.devastation > 0 ? `, reduced ${formatPct(rs.devastation * 100, 0)} by war damage` : ''}.`}
            />
          </div>
          <div className="row">
            <Stat
              label="Terrain"
              value={meta.terrain}
              tooltip={`Defence ×${world.terrain[meta.terrain]?.defence ?? 1}, armour ×${world.terrain[meta.terrain]?.armorBonus ?? 1}. Heuristic from elevation and latitude.`}
            />
            <Stat
              label="Supply"
              value={rs.supplied ? 'Supplied' : 'Cut off'}
              tooltip="Supplied regions connect to their controller's capital through friendly land. Unsupplied units fight at 60% and lose strength each month."
              accent={rs.supplied ? undefined : '#f87171'}
            />
          </div>
          {meta.capital && (
            <div
              className="tag"
              data-tip="National capital. Losing it with 70% of the population is capitulation."
            >
              ★ Capital
            </div>
          )}
          {meta.coastal && (
            <div
              className="tag"
              data-tip="Adjacent to a sea zone: open to amphibious landings and naval strikes."
            >
              ⚓ Coastal
            </div>
          )}
        </div>
      )}
      {nation && nationMeta && controller !== game.player && (
        <div className="panel-section">
          <div className="section-title" style={{ color: nationHex(controller!) }}>
            {nationMeta.name}
          </div>
          <div className="row">
            <Stat
              label="Relations"
              value={`${Math.round(getRelation(world, game, game.player, controller!))}`}
              tooltip={`${relationLabel(getRelation(world, game, game.player, controller!))}. −100 war to +100 special relationship. Drifts toward a baseline set by blocs, treaties and sanctions.`}
            />
            <Stat
              label="GDP"
              value={formatMoney(nation.gdp)}
              tooltip="Annual GDP (IMF WEO baseline)."
            />
          </div>
          <div className="row">
            <Stat
              label="Stability"
              value={`${Math.round(nation.stability)}`}
              tooltip="Public order 0–100."
            />
            <Stat
              label="Status"
              value={
                atWar(game, game.player, controller!)
                  ? 'AT WAR'
                  : isAtWar(game, controller!)
                    ? 'At war'
                    : 'Peace'
              }
              tooltip="Whether this nation is fighting you or anyone else."
              accent={atWar(game, game.player, controller!) ? '#f87171' : undefined}
            />
          </div>
          <p
            className="ai-note"
            data-tip="The leader's current stated priority, from the AI's own decision log."
          >
            “{nation.aiNote || 'No statement.'}”
          </p>
          <button
            className="btn small"
            onClick={() => {
              useUiStore.getState().setDiplomacyTarget(controller!);
              useUiStore.getState().setModal('diplomacy');
              playSound('open');
            }}
          >
            Open diplomacy
          </button>
        </div>
      )}
      <div className="panel-section">
        <div className="section-title">Forces present</div>
        {units.length === 0 && <p className="hint">No units.</p>}
        {[...byOwner.entries()].map(([iso, list]) => {
          const mine = iso === game.player;
          const allSel = list.every((u) => selectedUnits.includes(u.id));
          const types = new Map<string, number>();
          for (const u of list) types.set(u.type, (types.get(u.type) ?? 0) + 1);
          const avg = list.reduce((s, u) => s + u.strength, 0) / list.length;
          return (
            <div
              key={iso}
              className={`stack ${mine ? 'mine' : ''} ${allSel ? 'selected' : ''}`}
              onClick={() => mine && toggleStack(list)}
              role={mine ? 'button' : undefined}
              data-testid={mine ? 'own-stack' : undefined}
            >
              <div className="stack-head">
                <span style={{ color: nationHex(iso) }}>{nationName(world, iso)}</span>
                <Stat
                  value={`${list.length}`}
                  tooltip="Formations in this stack. Click to select all of them (your units only)."
                  inline
                />
              </div>
              <div className="stack-types">
                {[...types.entries()].map(([t, n]) => (
                  <span
                    key={t}
                    className="chip tiny"
                    data-tip={world.unitTypes.get(t)?.description ?? t}
                  >
                    {n}× {world.unitTypes.get(t)?.name ?? t}
                  </span>
                ))}
              </div>
              <div
                className="strength-bar"
                data-tip={`Average strength ${avg.toFixed(0)}%. Units recover 8%/month in supplied friendly territory and retreat below 20%.`}
              >
                <span style={{ width: `${avg}%` }} />
              </div>
              {mine && list.some((u) => u.path.length > 0) && (
                <div className="hint">
                  Moving to{' '}
                  {world.regions.get(list.find((u) => u.path.length > 0)!.path.at(-1)!)?.name}
                </div>
              )}
            </div>
          );
        })}
        {selectedUnits.length > 0 && (
          <div className="orders-hint" data-testid="orders-hint">
            <strong>{selectedUnits.length}</strong> selected — right-click a region to move or
            attack.
            {odds && <div className="odds">Odds: {odds}</div>}
            <button className="btn small ghost" onClick={() => selectUnits([])}>
              Clear selection
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
