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
import type { AirMission, OddsReport, Unit } from '../sim/types';
import { ChokepointSection, OddsBreakdown, TerrainSection } from './GeographyPanel';
import { estimateStack, INTEL_LABEL, intelLevel } from '../sim/intel';
import { MISSION_INFO, missionsFor } from '../sim/air';
import { zoneControl } from '../sim/naval';
import { STRIKE_INFO, SALVO, HYPERSONIC_SALVO, canMissileStrike, interceptionChance } from '../sim/strikes';
import { hasAbility } from '../sim/research';
import { TRAIT_INFO } from '../sim/commanders';
import { prepNeeded } from '../sim/military';
import { dispatch } from '../state/simBridge';

const world = loadWorld();

export function ContextPanel() {
  const game = useGameStore((s) => s.game);
  const selected = useUiStore((s) => s.selectedRegion);
  const selectedUnits = useUiStore((s) => s.selectedUnitIds);
  const selectUnits = useUiStore((s) => s.selectUnits);
  const hover = useUiStore((s) => s.hoverRegion);
  const [oddsFor, setOddsFor] = useState<OddsReport | null>(null);
  useEffect(() => {
    if (!hover || selectedUnits.length === 0 || hover === selected) return;
    requestOdds(selectedUnits, hover, (report) => setOddsFor(report));
  }, [hover, selectedUnits, selected]);
  const odds =
    oddsFor && oddsFor.target === hover && hover !== selected && selectedUnits.length > 0
      ? oddsFor
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
        <p className="hint">
          Scroll to zoom, drag to orbit. Keys 1–8 switch map modes; C toggles the chokepoint
          overlay.
        </p>
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
  const intel = intelLevel(world, game, game.player, id);
  const zc = meta.sea ? zoneControl(world, game, id) : null;
  const strikeWhy = !meta.sea ? canMissileStrike(world, game, game.player, id) : 'Sea zone';
  const myMissiles = game.nations[game.player]!.missiles;
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
      {!meta.sea && <TerrainSection meta={meta} rs={rs} game={game} />}
      {meta.sea && zc && (
        <div className="panel-section">
          <div className="section-title">Sea control</div>
          <Stat
            label="Zone"
            value={zc.controller ? nationName(world, zc.controller) : zc.contested ? 'Contested' : 'Open water'}
            tooltip="The fleet holding the zone with a clear margin (at least twice every fleet at war with it, allies pooled). Control gates landings, convoys and blockades; contested zones let no one's convoys through safely."
            accent={zc.controller ? nationHex(zc.controller) : zc.contested ? '#fbbf24' : undefined}
          />
        </div>
      )}
      {!meta.sea && controller && controller !== game.player && atWar(game, game.player, controller) && (
        <div className="panel-section" data-testid="strike-section">
          <div className="section-title">Missile strike</div>
          <div className="choke-actions">
            {(Object.keys(STRIKE_INFO) as (keyof typeof STRIKE_INFO)[]).map((kind) => (
              <button
                key={kind}
                className="btn small"
                disabled={!!strikeWhy}
                data-testid={`strike-${kind}`}
                data-tip={
                  strikeWhy ??
                  `${STRIKE_INFO[kind].description} Fires ${SALVO} of your ${myMissiles} missiles; each can be intercepted by the defender's missile defence and air-defence brigades.`
                }
                onClick={() => {
                  dispatch({ type: 'missileStrike', region: id, kind });
                  playSound('order');
                }}
              >
                {STRIKE_INFO[kind].label}
              </button>
            ))}
          </div>
          {hasAbility(world, game, game.player, 'hypersonicStrike') && (
            <div className="choke-actions" style={{ marginTop: 6 }}>
              {(Object.keys(STRIKE_INFO) as (keyof typeof STRIKE_INFO)[]).map((kind) => (
                <button
                  key={kind}
                  className="btn small"
                  disabled={!!strikeWhy}
                  data-testid={`hstrike-${kind}`}
                  data-tip={
                    strikeWhy ??
                    `Hypersonic salvo: ${HYPERSONIC_SALVO} glide vehicles (uses ${SALVO} missiles). Interception chance ${Math.round(interceptionChance(world, game, id, game.player, true) * 100)} % each instead of ${Math.round(interceptionChance(world, game, id, game.player) * 100)} %; each hit counts ×1.5. ${STRIKE_INFO[kind].description}`
                  }
                  onClick={() => {
                    dispatch({ type: 'missileStrike', region: id, kind, hypersonic: true });
                    playSound('order');
                  }}
                >
                  ⚡ {STRIKE_INFO[kind].label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {meta.sea &&
        (world.chokepointsByZone.get(meta.id) ?? []).map((c) => (
          <ChokepointSection key={c.id} c={c} game={game} />
        ))}
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
        <div className="section-title">
          Forces present{' '}
          {intel < 4 && (
            <span
              className="chip tiny"
              data-testid="intel-chip"
              data-tip="Your intelligence level here (0–4): own or allied presence and adjacency, satellites, ISR technology, recon wings and spy networks raise it; enemy counterspace and cyber blinding lower it."
            >
              intel {intel}/4 · {INTEL_LABEL[intel]}
            </span>
          )}
        </div>
        {units.length === 0 && <p className="hint">{intel === 0 ? 'No intelligence coverage.' : 'No units.'}</p>}
        {[...byOwner.entries()].map(([iso, list]) => {
          const mine = iso === game.player;
          const est = estimateStack(world, game, game.player, list);
          if (!mine && est.level === 0) return null;
          const allSel = list.every((u) => selectedUnits.includes(u.id));
          const types = new Map<string, number>();
          if (mine || est.types) for (const u of list) types.set(u.type, (types.get(u.type) ?? 0) + 1);
          const avg = list.reduce((s, u) => s + u.strength, 0) / list.length;
          if (!mine && est.level < 4) {
            return (
              <div key={iso} className="stack" data-testid="foreign-stack">
                <div className="stack-head">
                  <span style={{ color: nationHex(iso) }}>{nationName(world, iso)}</span>
                  <Stat
                    value={est.min === est.max ? `${est.min}` : `${est.min}–${est.max}`}
                    tooltip={`Estimated formations (${INTEL_LABEL[est.level]}). Better intelligence narrows the band and reveals unit types and strength.`}
                    inline
                  />
                </div>
                {est.types ? (
                  <div className="stack-types">
                    {Object.entries(est.types).map(([t, n]) => (
                      <span key={t} className="chip tiny" data-tip={world.unitTypes.get(t)?.description ?? t}>
                        {n}× {world.unitTypes.get(t)?.name ?? t}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="hint">Composition unknown.</div>
                )}
                {est.strength !== null && (
                  <div className="strength-bar" data-tip={`Average strength about ${est.strength}% (rounded: intelligence is incomplete).`}>
                    <span style={{ width: `${est.strength}%` }} />
                  </div>
                )}
              </div>
            );
          }
          const airWings = mine ? list.filter((u) => world.unitTypes.get(u.type)?.domain === 'air') : [];
          const commanders = mine ? list.filter((u) => u.commander) : [];
          const xp = list.reduce((s, u) => s + u.experience, 0) / list.length;
          const prepping = mine ? list.filter((u) => u.prep > 0) : [];
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
              {prepping.length > 0 && (
                <div className="hint" data-tip="Amphibious preparation: marines and special forces need one month, other formations two, before they embark; shipping (amphibious groups) then carries them.">
                  Embarking: {prepping[0]!.prep}/{prepNeeded(world, prepping[0]!.type)} months prepared
                </div>
              )}
              {mine && (
                <div className="row">
                  <Stat
                    label="Experience"
                    value={`${Math.round(xp)}`}
                    tooltip="Average combat experience 0–100 of the stack. Each battle survived adds 6; green formations fight at ×0.95, veterans at up to ×1.20."
                    inline
                  />
                  {commanders.length > 0 && (
                    <span className="hint" data-tip={commanders.map((u) => `${u.commander!.name} (${TRAIT_INFO[u.commander!.trait].label}): ${TRAIT_INFO[u.commander!.trait].description}`).join(' ')}>
                      ★ {commanders[0]!.commander!.name}
                      {commanders.length > 1 ? ` +${commanders.length - 1}` : ''} ({TRAIT_INFO[commanders[0]!.commander!.trait].label.toLowerCase()})
                    </span>
                  )}
                </div>
              )}
              {airWings.length > 0 && (
                <div className="mission-row" data-testid="mission-row" onClick={(e) => e.stopPropagation()}>
                  {(['superiority', 'cas', 'interdiction', 'bombing', 'recon'] as AirMission[]).map((m) => {
                    const flyable = airWings.filter((u) => missionsFor(u.type).includes(m));
                    if (flyable.length === 0) return null;
                    const active = flyable.every((u) => u.mission === m);
                    return (
                      <button
                        key={m}
                        className={`seg-btn ${active ? 'active' : ''}`}
                        data-testid={`mission-${m}`}
                        data-tip={`${MISSION_INFO[m].label}: ${MISSION_INFO[m].description}`}
                        onClick={() => {
                          dispatch({ type: 'setAirMission', unitIds: flyable.map((u) => u.id), mission: m });
                          playSound('order');
                        }}
                      >
                        {MISSION_INFO[m].short}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {selectedUnits.length > 0 && (
          <div className="orders-hint" data-testid="orders-hint">
            <strong>{selectedUnits.length}</strong> selected — right-click a region to move or
            attack.
            {odds && <OddsBreakdown report={odds} />}
            <button className="btn small ghost" onClick={() => selectUnits([])}>
              Clear selection
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
