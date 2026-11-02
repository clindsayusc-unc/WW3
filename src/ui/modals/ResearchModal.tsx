import { useRef, useState } from 'react';
import { Modal } from '../Modal';
import { useGameStore } from '../../state/gameStore';
import { dispatch } from '../../state/simBridge';
import { loadWorld } from '../../sim/world';
import { researchPointsPerMonth } from '../../sim/research';
import { Stat } from '../Stat';
import { playSound } from '../audio';

const world = loadWorld();
const COL = 190;
const ROW = 92;

const EFFECT_LABEL: Record<string, string> = {
  landAttack: 'land attack',
  landDefence: 'land defence',
  airPower: 'air power',
  navalPower: 'naval power',
  researchSpeed: 'research speed',
  gdpGrowth: 'GDP growth (pp/yr)',
  productionCost: 'production cost',
  upkeep: 'upkeep',
  missileDefence: 'missile defence',
  cyberAttack: 'cyber attack',
  cyberDefence: 'cyber defence',
  intel: 'intelligence',
  enemyIntel: 'enemy intelligence',
  stability: 'stability',
  droneStrength: 'drone strength',
  droneResistance: 'drone resistance',
  strikePower: 'strike power',
  deterrence: 'deterrence',
  antiAir: 'anti-air',
  sanctionResistance: 'sanction resistance',
  buildSpeed: 'build speed',
};

export function ResearchModal() {
  const game = useGameStore((s) => s.game);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  if (!game) return null;
  const me = game.nations[game.player]!;
  const rp = researchPointsPerMonth(world, game, game.player);
  const current = me.researchCurrent ? world.techs.get(me.researchCurrent) : undefined;
  const pick = (id: string) => {
    dispatch({ type: 'setResearch', tech: id });
    playSound('accept');
  };
  return (
    <Modal
      title="Research"
      subtitle={`${rp.toFixed(0)} research points per month. ${current ? `Researching ${current.name}: ${Math.round(me.researchPoints)}/${current.cost}, about ${Math.max(1, Math.ceil((current.cost - me.researchPoints) / Math.max(1, rp)))} months left.` : 'Select a project.'}`}
      wide
      testId="modal-research"
      footer={
        <>
          <Stat
            label="Banked"
            value={`${Math.round(me.researchPoints)} RP`}
            tooltip="Points accumulate while no project is selected and carry over between projects."
          />
          <Stat
            label="Completed"
            value={`${me.techs.length}/${world.techList.length}`}
            tooltip="Technologies researched."
          />
          <div className="zoom-controls">
            <button
              className="icon-btn"
              onClick={() => setZoom((z) => Math.max(0.5, z - 0.15))}
              data-tip="Zoom out"
            >
              −
            </button>
            <button
              className="icon-btn"
              onClick={() => setZoom((z) => Math.min(1.6, z + 0.15))}
              data-tip="Zoom in"
            >
              +
            </button>
            <button
              className="icon-btn"
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
              data-tip="Reset view"
            >
              ⟲
            </button>
          </div>
        </>
      }
    >
      <div
        className="tech-viewport"
        onWheel={(e) =>
          setZoom((z) => Math.min(1.6, Math.max(0.5, z * Math.exp(-e.deltaY * 0.001))))
        }
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current)
            setPan({
              x: drag.current.px + e.clientX - drag.current.x,
              y: drag.current.py + e.clientY - drag.current.y,
            });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        data-testid="tech-tree"
      >
        <div
          className="tech-canvas"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            width: COL * 5 + 40,
            height: ROW * world.branches.length + 20,
          }}
        >
          <svg
            className="tech-links"
            width={COL * 5 + 40}
            height={ROW * world.branches.length + 20}
          >
            {world.techList.map((t) =>
              t.requires.map((r) => {
                const a = world.techs.get(r)!;
                const ai = world.branches.findIndex((b) => b.id === a.branch);
                const bi = world.branches.findIndex((b) => b.id === t.branch);
                const x1 = (a.tier - 1) * COL + 160;
                const y1 = ai * ROW + 40;
                const x2 = (t.tier - 1) * COL + 20;
                const y2 = bi * ROW + 40;
                const done = me.techs.includes(r);
                return (
                  <path
                    key={`${r}-${t.id}`}
                    d={`M${x1},${y1} C${x1 + 40},${y1} ${x2 - 40},${y2} ${x2},${y2}`}
                    stroke={done ? world.branches[ai]!.color : 'rgba(148,163,184,0.35)'}
                    strokeWidth={done ? 2 : 1.2}
                    fill="none"
                  />
                );
              }),
            )}
          </svg>
          {world.branches.map((b, bi) => (
            <div key={b.id} className="branch-label" style={{ top: bi * ROW + 4, color: b.color }}>
              {b.name}
            </div>
          ))}
          {world.techList.map((t) => {
            const bi = world.branches.findIndex((b) => b.id === t.branch);
            const done = me.techs.includes(t.id);
            const available = !done && t.requires.every((r) => me.techs.includes(r));
            const active = me.researchCurrent === t.id;
            const color = world.branches[bi]!.color;
            const effects = t.effects
              .map(
                (e) =>
                  `${e.value > 0 ? '+' : ''}${e.key === 'gdpGrowth' || e.key === 'stability' || e.key === 'intel' || e.key === 'enemyIntel' ? e.value : `${Math.round(e.value * 100)}%`} ${EFFECT_LABEL[e.key] ?? e.key}`,
              )
              .join(', ');
            return (
              <button
                key={t.id}
                className={`tech-node ${done ? 'done' : available ? 'available' : 'locked'} ${active ? 'active' : ''}`}
                style={{
                  left: (t.tier - 1) * COL + 20,
                  top: bi * ROW + 18,
                  ['--branch' as string]: color,
                }}
                onClick={() => available && pick(t.id)}
                disabled={!available}
                data-tip={`${t.framing} Effects: ${effects}. Cost ${t.cost} RP${t.requires.length ? `; requires ${t.requires.map((r) => world.techs.get(r)?.name).join(', ')}` : ''}.`}
                data-testid={`tech-${t.id}`}
              >
                <span className="tech-name">{t.name}</span>
                <span className="tech-meta">
                  <Stat
                    value={`${t.cost} RP`}
                    tooltip={`Research cost. At ${rp.toFixed(0)} RP/month that is about ${Math.max(1, Math.ceil(t.cost / Math.max(1, rp)))} months.`}
                    inline
                  />
                  {done && <span className="chip tiny ok">done</span>}
                  {active && (
                    <span className="chip tiny active">
                      {Math.round((me.researchPoints / t.cost) * 100)}%
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
