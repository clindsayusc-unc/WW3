/**
 * Military overview (D-059): strength by domain against rivals, the order of battle, air wings
 * and their missions, strategic operations (missiles, cyber, spies, space) and intelligence.
 */
import { useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { useGameStore } from '../../state/gameStore';
import { useUiStore } from '../../state/uiStore';
import { dispatch } from '../../state/simBridge';
import { loadWorld, nationName } from '../../sim/world';
import { unitsOf, militaryPower, enemiesOf, getRelation, atWar } from '../../sim/query';
import { unitUpkeep } from '../../sim/economy';
import { MISSION_INFO, missionsFor } from '../../sim/air';
import {
  CYBER_INFO,
  SALVO,
  canAsat,
  canCyberOp,
  canLaunchSatellite,
  canSpyOp,
  cyberSuccessChance,
  missileProduction,
  satelliteCost,
  spyOpCost,
} from '../../sim/strikes';
import { effectiveSatellites, globalIntelBonus } from '../../sim/intel';
import { blockadeShare } from '../../sim/naval';
import { Stat } from '../Stat';
import { formatMoney } from '../format';
import { nationHex } from '../../render/palette';
import { playSound } from '../audio';
import type { AirMission, CyberKind, GameState, Iso3, Unit } from '../../sim/types';
import { DOMAIN_INFO, domainStrength, type Domain } from '../domains';

const world = loadWorld();

type Tab = 'overview' | 'air' | 'operations' | 'intel';
const TABS: { id: Tab; label: string; tip: string }[] = [
  { id: 'overview', label: 'Overview', tip: 'Strength by domain against your rivals, deployments and wars.' },
  { id: 'air', label: 'Air wings', tip: 'Every wing and its mission: superiority, close air support, interdiction, bombing or reconnaissance.' },
  { id: 'operations', label: 'Operations', tip: 'Missile strikes, cyber operations, spy networks and anti-satellite weapons.' },
  { id: 'intel', label: 'Intelligence', tip: 'Satellites, orbital debris and what you can see of each rival.' },
];

function Bars({ game, me }: { game: GameState; me: Iso3 }) {
  const rows = useMemo(() => {
    const isos = [me, ...world.majors.filter((x) => x !== me && game.nations[x]?.alive)];
    return isos.map((iso) => ({ iso, s: domainStrength(game, iso) }));
  }, [game, me]);
  const max: Record<Domain, number> = { land: 1, air: 1, sea: 1, strategic: 1 };
  for (const r of rows) for (const d of Object.keys(max) as Domain[]) max[d] = Math.max(max[d], r.s[d]);
  return (
    <div className="domain-grid" data-testid="domain-bars">
      <span />
      {(Object.keys(DOMAIN_INFO) as Domain[]).map((d) => (
        <span key={d} className="domain-head" data-tip={DOMAIN_INFO[d].tip}>
          {DOMAIN_INFO[d].label}
        </span>
      ))}
      {rows.map(({ iso, s }) => (
        <div key={iso} style={{ display: 'contents' }}>
          <span className={`domain-name ${iso === me ? 'me' : ''} ${atWar(game, me, iso) ? 'enemy' : ''}`} style={{ color: nationHex(iso) }}>
            {nationName(world, iso)}
          </span>
          {(Object.keys(DOMAIN_INFO) as Domain[]).map((d) => (
            <span key={d} className="domain-cell">
              <span className="power-bar" data-tip={`${nationName(world, iso)} ${DOMAIN_INFO[d].label.toLowerCase()} strength ${Math.round(s[d])}. ${DOMAIN_INFO[d].tip}`}>
                <span style={{ width: `${(s[d] / max[d]) * 100}%`, background: nationHex(iso) }} />
              </span>
              <Stat value={`${Math.round(s[d])}`} tooltip={DOMAIN_INFO[d].tip} inline />
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

export function MilitaryModal() {
  const game = useGameStore((s) => s.game);
  const fly = useUiStore((s) => s.fly);
  const select = useUiStore((s) => s.select);
  const selectUnits = useUiStore((s) => s.selectUnits);
  const setModal = useUiStore((s) => s.setModal);
  const [tab, setTab] = useState<Tab>('overview');
  const [opTarget, setOpTarget] = useState<Iso3 | null>(null);
  if (!game) return null;
  const me = game.player;
  const my = game.nations[me]!;
  const mine = unitsOf(game, me);
  const byRegion = new Map<number, Unit[]>();
  for (const u of mine) byRegion.set(u.region, [...(byRegion.get(u.region) ?? []), u]);
  const byType = new Map<string, number>();
  for (const u of mine) byType.set(u.type, (byType.get(u.type) ?? 0) + 1);
  const enemies = enemiesOf(game, me);
  const powers = world.majors
    .map((iso) => ({ iso, p: militaryPower(world, game, iso) }))
    .sort((a, b) => b.p - a.p);
  const maxP = powers[0]?.p ?? 1;
  const goTo = (region: number, units: Unit[]) => {
    const meta = world.regions.get(region)!;
    fly(meta.lat, meta.lon, 1.5);
    select(region);
    selectUnits(units.map((u) => u.id));
    setModal(null);
    playSound('click');
  };
  const wings = mine.filter((u) => world.unitTypes.get(u.type)?.domain === 'air');
  const targets = world.nationList
    .filter((n) => n.iso3 !== me && game.nations[n.iso3]?.alive)
    .sort((a, b) => Number(atWar(game, me, b.iso3)) - Number(atWar(game, me, a.iso3)) || getRelation(world, game, me, a.iso3) - getRelation(world, game, me, b.iso3))
    .slice(0, 24);
  const target = opTarget && game.nations[opTarget]?.alive ? opTarget : (enemies[0] ?? targets[0]?.iso3 ?? null);
  const op = (cmd: Parameters<typeof dispatch>[0]) => {
    dispatch(cmd);
    playSound('order');
  };
  return (
    <Modal
      title="Military"
      subtitle={`${mine.length} formations, upkeep ${formatMoney(unitUpkeep(world, game, me))} per month. ${my.missiles} missiles, ${my.satellites} satellites.`}
      wide
      testId="modal-military"
    >
      <div className="seg" style={{ marginBottom: 12 }}>
        {TABS.map((t) => (
          <button key={t.id} className={`seg-btn ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)} data-tip={t.tip} data-testid={`mil-tab-${t.id}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="military-layout">
          <div>
            <div className="section-title">Strength by domain vs rivals</div>
            <Bars game={game} me={me} />
            <div className="section-title" style={{ marginTop: 12 }}>
              Order of battle
            </div>
            <div className="chips">
              {[...byType.entries()].map(([t, n]) => (
                <span key={t} className="chip" data-tip={world.unitTypes.get(t)?.description}>
                  {n}× {world.unitTypes.get(t)?.name ?? t}
                </span>
              ))}
            </div>
            <div className="section-title" style={{ marginTop: 12 }}>
              Deployments
            </div>
            <div className="deploy-list">
              {[...byRegion.entries()]
                .sort((a, b) => b[1].length - a[1].length)
                .map(([region, units]) => {
                  const meta = world.regions.get(region)!;
                  const ctrl = game.regions[region]?.controller;
                  const avg = units.reduce((s, u) => s + u.strength, 0) / units.length;
                  return (
                    <button key={region} className="deploy-row" onClick={() => goTo(region, units)} data-tip="Fly to and select this stack.">
                      <span className="name">{meta.name}</span>
                      <span className="dim">{ctrl ? nationName(world, ctrl) : 'sea'}</span>
                      <Stat value={`${units.length}`} tooltip="Formations here." inline />
                      <span className="strength-bar small" data-tip={`Average strength ${avg.toFixed(0)}%`}>
                        <span style={{ width: `${avg}%` }} />
                      </span>
                      {units.some((u) => u.path.length > 0) && <span className="chip tiny">moving</span>}
                    </button>
                  );
                })}
            </div>
          </div>
          <div>
            <div className="section-title">Wars</div>
            {game.wars.length === 0 && <p className="hint">The world is formally at peace.</p>}
            {game.wars.map((w) => (
              <div key={w.id} className={`war-row ${w.attackers.includes(me) || w.defenders.includes(me) ? 'mine' : ''}`}>
                <span>{w.attackers.map((x) => nationName(world, x)).join(', ')}</span>
                <span className="vs">vs</span>
                <span>{w.defenders.map((x) => nationName(world, x)).join(', ')}</span>
                <Stat
                  value={`${w.score > 0 ? '+' : ''}${Math.round(w.score)}`}
                  tooltip="War score: population share of regions taken by the attackers minus those taken by the defenders."
                  inline
                />
              </div>
            ))}
            {enemies.length > 0 && (
              <p className="hint">
                You are at war with {enemies.map((e) => nationName(world, e)).join(', ')}.
                {my.blockaded && ' Your ports are under naval blockade.'}
              </p>
            )}
            {enemies.length > 0 && (
              <div className="row wrap">
                {enemies.slice(0, 4).map((e) => (
                  <Stat
                    key={e}
                    label={`Blockade of ${nationName(world, e)}`}
                    value={`${Math.round(blockadeShare(world, game, e) * 100)}%`}
                    tooltip="Share of that nation's port capacity facing sea zones controlled by its enemies. At 50 % or more it is blockaded: growth, research and production suffer."
                  />
                ))}
              </div>
            )}
            <div className="section-title" style={{ marginTop: 12 }}>
              Balance of power
            </div>
            {powers.map(({ iso, p }) => (
              <div key={iso} className="power-row">
                <span style={{ color: nationHex(iso), width: 110 }}>{nationName(world, iso)}</span>
                <span className="power-bar">
                  <span style={{ width: `${(p / maxP) * 100}%`, background: nationHex(iso) }} />
                </span>
                <Stat value={`${Math.round(p)}`} tooltip="Military power index: sum of unit attack and defence values, quality and tech included." inline />
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'air' && (
        <div>
          <p className="hint">
            Each wing flies one mission a month from its base. Superiority wins the air over battles in range; close air support adds strike weight; interdiction starves enemy supply; bombing wrecks industry; reconnaissance lifts intelligence. Wings over defended enemy regions are intercepted.
          </p>
          <div className="deploy-list" data-testid="air-list">
            {wings.length === 0 && <p className="hint">No air wings.</p>}
            {wings
              .sort((a, b) => a.region - b.region)
              .map((u) => {
                const meta = world.regions.get(u.region)!;
                return (
                  <div key={u.id} className="wing-row">
                    <button className="name link" onClick={() => goTo(u.region, [u])} data-tip="Fly to the wing's base.">
                      {world.unitTypes.get(u.type)?.name} · {meta.name}
                    </button>
                    <Stat value={`${Math.round(u.strength)}%`} tooltip="Strength: losses to interception and battle recover in supplied friendly territory." inline />
                    <div className="mission-row">
                      {missionsFor(u.type).map((m: AirMission) => (
                        <button
                          key={m}
                          className={`seg-btn ${u.mission === m ? 'active' : ''}`}
                          data-tip={`${MISSION_INFO[m].label}: ${MISSION_INFO[m].description}`}
                          onClick={() => op({ type: 'setAirMission', unitIds: [u.id], mission: m })}
                        >
                          {MISSION_INFO[m].short}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {tab === 'operations' && (
        <div className="military-layout" data-testid="ops-panel">
          <div>
            <div className="section-title">Target</div>
            <div className="chips">
              {targets.map((n) => (
                <button
                  key={n.iso3}
                  className={`chip ${target === n.iso3 ? 'active' : ''} ${atWar(game, me, n.iso3) ? 'enemy' : ''}`}
                  onClick={() => setOpTarget(n.iso3)}
                  data-testid={`op-target-${n.iso3}`}
                  data-tip={`Relations ${Math.round(getRelation(world, game, me, n.iso3))}${atWar(game, me, n.iso3) ? ' · at war' : ''}`}
                >
                  {n.name}
                </button>
              ))}
            </div>
            <div className="section-title" style={{ marginTop: 12 }}>
              Missiles
            </div>
            <div className="row">
              <Stat label="Stock" value={`${my.missiles}`} tooltip={`Conventional cruise and hypersonic missiles. A strike fires ${SALVO}; production adds ${missileProduction(world, game, me)} a month (defence spending ÷ 50, more with strike tech and mobilisation).`} />
              <Stat label="Per strike" value={`${SALVO}`} tooltip="Missiles per salvo. Each is intercepted independently by the target's missile defence and air-defence brigades." />
            </div>
            <p className="hint">Select an enemy region on the globe and use the strike buttons in its panel: infrastructure, industry or military.</p>
          </div>
          <div>
            {target && (
              <>
                <div className="section-title">Cyber operations vs {nationName(world, target)}</div>
                <div className="row">
                  <Stat
                    label="Success"
                    value={`${Math.round(cyberSuccessChance(game, me, target) * 100)}%`}
                    tooltip="40 % base + your cyber-attack tech − their cyber-defence tech. A failed operation may still be attributed to you (relations −12)."
                  />
                  <Stat label="Cooldown" value={`${my.cyberCooldown} mo`} tooltip="Months until your teams can launch another operation (3 after each one)." />
                </div>
                <div className="choke-actions">
                  {(Object.keys(CYBER_INFO) as CyberKind[]).map((kind) => {
                    const why = canCyberOp(world, game, me, target);
                    return (
                      <button key={kind} className="btn small" disabled={!!why} data-testid={`cyber-${kind}`} data-tip={why ?? CYBER_INFO[kind].description} onClick={() => op({ type: 'cyberOp', target, kind })}>
                        {CYBER_INFO[kind].label}
                      </button>
                    );
                  })}
                </div>
                <div className="section-title" style={{ marginTop: 12 }}>
                  Espionage
                </div>
                <div className="choke-actions">
                  <button
                    className="btn small"
                    disabled={!!canSpyOp(world, game, me, target)}
                    data-testid="spy-op"
                    data-tip={canSpyOp(world, game, me, target) ?? `Activate a human-intelligence network in ${nationName(world, target)} for ${formatMoney(spyOpCost(game, me))}: +1 intelligence level on its regions for six months.`}
                    onClick={() => op({ type: 'spyOp', target })}
                  >
                    Spy network {my.intelOps[target] ? `(${my.intelOps[target]} mo left)` : ''}
                  </button>
                  <button
                    className="btn small danger"
                    disabled={!!canAsat(world, game, me, target)}
                    data-testid="asat"
                    data-tip={canAsat(world, game, me, target) ?? `Shoot down up to 30 % of ${nationName(world, target)}'s satellites. Every nation loses relations with you and orbital debris threatens everyone's constellations, yours included.`}
                    onClick={() => op({ type: 'asat', target })}
                  >
                    ASAT strike
                  </button>
                </div>
              </>
            )}
            <div className="section-title" style={{ marginTop: 12 }}>
              Space
            </div>
            <div className="row">
              <Stat label="Satellites" value={`${my.satellites}`} tooltip="Reconnaissance satellites. 1–2 lift your global intelligence by one level, 5 or more by two. Orbital debris degrades and destroys them." />
              <Stat label="Debris" value={`${Math.round(game.debris)}`} tooltip="Orbital debris index 0–100: every ASAT strike adds 12 per satellite destroyed; it decays by 1 a month and each month destroys a satellite with probability debris ÷ 400 per satellite." accent={game.debris >= 30 ? '#f87171' : undefined} />
            </div>
            <div className="choke-actions">
              <button className="btn small" disabled={!!canLaunchSatellite(game, me)} data-testid="launch-satellite" data-tip={canLaunchSatellite(game, me) ?? `Launch a satellite for ${formatMoney(satelliteCost(game, me))} (cheaper with Reusable Launch Cadence).`} onClick={() => op({ type: 'launchSatellite' })}>
                Launch satellite
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'intel' && (
        <div>
          <div className="row wrap">
            <Stat label="Satellites" value={`${my.satellites}`} tooltip="Your constellation; see Operations to launch more." />
            <Stat label="Effective" value={effectiveSatellites(game, me).toFixed(1)} tooltip="Satellites after orbital debris degrades their sensors (−40 % at a debris index of 60 or more)." />
            <Stat label="Global bonus" value={`+${globalIntelBonus(game, me)}`} tooltip="Intelligence levels added everywhere: satellites (+1 at 1.5, +2 at 5), ISR technologies (up to +2), minus 2 while cyber-blinded." accent={my.blinded > 0 ? '#f87171' : undefined} />
            {my.blinded > 0 && (
              <span className="tag" data-tip="An enemy cyber operation is jamming your satellite downlinks.">
                ⚠ Blinded {my.blinded} mo
              </span>
            )}
          </div>
          <p className="hint">
            Intelligence level per region (0–4): your own and allied territory and anything adjacent is seen at 2+; satellites and ISR tech add globally; recon wings add +2 over their range; a spy network adds +1 on that nation; enemy counterspace tech and cyber blinding subtract. Below level 3 enemy stacks show as estimated ranges and odds as bands.
          </p>
          <div className="section-title">Coverage of rivals</div>
          <div className="deploy-list">
            {world.majors
              .filter((iso) => iso !== me && game.nations[iso]?.alive)
              .map((iso) => {
                const cap = world.capitalRegion.get(iso)!;
                const level = Math.min(4, Math.max(0, 0 + globalIntelBonus(game, me) + (my.intelOps[iso] ? 1 : 0) + Math.round(game.nations[iso]?.modifiers.enemyIntel ?? 0) - (atWar(game, me, iso) ? 1 : 0)));
                return (
                  <div key={iso} className="deploy-row" data-tip={`Baseline level on ${nationName(world, iso)}'s interior (its capital region ${world.regions.get(cap)?.name}); border regions and recon add more.`}>
                    <span className="name" style={{ color: nationHex(iso) }}>{nationName(world, iso)}</span>
                    <span className="dim">{my.intelOps[iso] ? `spies ${my.intelOps[iso]} mo` : ''}</span>
                    <Stat value={`${level}/4`} tooltip="Baseline intelligence level deep inside that nation." inline />
                    <span className="strength-bar small" data-tip={`Level ${level} of 4`}>
                      <span style={{ width: `${(level / 4) * 100}%` }} />
                    </span>
                    <span className="chip tiny" data-tip="Their satellites.">
                      🛰 {game.nations[iso]?.satellites ?? 0}
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </Modal>
  );
}
