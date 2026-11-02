import { Modal } from '../Modal';
import { useGameStore } from '../../state/gameStore';
import { useUiStore } from '../../state/uiStore';
import { loadWorld, nationName } from '../../sim/world';
import { unitsOf, militaryPower, enemiesOf } from '../../sim/query';
import { unitUpkeep } from '../../sim/economy';
import { Stat } from '../Stat';
import { formatMoney } from '../format';
import { nationHex } from '../../render/palette';
import { playSound } from '../audio';
import type { Unit } from '../../sim/types';

const world = loadWorld();

export function MilitaryModal() {
  const game = useGameStore((s) => s.game);
  const fly = useUiStore((s) => s.fly);
  const select = useUiStore((s) => s.select);
  const selectUnits = useUiStore((s) => s.selectUnits);
  const setModal = useUiStore((s) => s.setModal);
  if (!game) return null;
  const me = game.player;
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
  return (
    <Modal
      title="Military Overview"
      subtitle={`${mine.length} formations, upkeep ${formatMoney(unitUpkeep(world, game, me))} per month.`}
      wide
      testId="modal-military"
    >
      <div className="military-layout">
        <div>
          <div className="section-title">Order of battle</div>
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
                  <button
                    key={region}
                    className="deploy-row"
                    onClick={() => goTo(region, units)}
                    data-tip="Fly to and select this stack."
                  >
                    <span className="name">{meta.name}</span>
                    <span className="dim">{ctrl ? nationName(world, ctrl) : 'sea'}</span>
                    <Stat value={`${units.length}`} tooltip="Formations here." inline />
                    <span
                      className="strength-bar small"
                      data-tip={`Average strength ${avg.toFixed(0)}%`}
                    >
                      <span style={{ width: `${avg}%` }} />
                    </span>
                    {units.some((u) => u.path.length > 0) && (
                      <span className="chip tiny">moving</span>
                    )}
                  </button>
                );
              })}
          </div>
        </div>
        <div>
          <div className="section-title">Wars</div>
          {game.wars.length === 0 && <p className="hint">The world is formally at peace.</p>}
          {game.wars.map((w) => (
            <div
              key={w.id}
              className={`war-row ${w.attackers.includes(me) || w.defenders.includes(me) ? 'mine' : ''}`}
            >
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
            </p>
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
              <Stat
                value={`${Math.round(p)}`}
                tooltip="Military power index: sum of unit attack and defence values, quality and tech included."
                inline
              />
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
