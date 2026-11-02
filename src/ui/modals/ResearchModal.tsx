import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Modal } from '../Modal';
import { useGameStore } from '../../state/gameStore';
import { dispatch } from '../../state/simBridge';
import { loadWorld, nationName, type TechMeta } from '../../sim/world';
import type { GameState, Iso3 } from '../../sim/types';
import { pathTo, researchBreakdown, techCostBreakdown, prerequisitesMet, exportControlShare } from '../../sim/research';
import { canStealTech, canShareTech, shareableTechs, stealCost, stealOdds, stealableTechs, STEAL_CREDIT } from '../../sim/techwar';
import { alliesOf, getRelation } from '../../sim/query';
import { Stat } from '../Stat';
import { playSound } from '../audio';
import { effectText } from '../techText';
import { GUTTER, NODE_H, NODE_W, layoutTree } from '../researchLayout';
import { formatMoney } from '../format';

const world = loadWorld();
const LAYOUT = layoutTree(world.techList, world.branches.map((b) => b.id));
const BRANCH = new Map(world.branches.map((b) => [b.id, b]));
const ERA = new Map(world.eras.map((e) => [e.id, e]));
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 1.6;

type Side = 'queue' | 'espionage' | 'sharing';

const fitZoom = (w: number, h: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min(w / LAYOUT.width, h / LAYOUT.height)));
const months = (cost: number, rp: number) => Math.max(1, Math.ceil(cost / Math.max(1, rp)));

export function ResearchModal() {
  const game = useGameStore((s) => s.game);
  const [view, setView] = useState({ x: 0, y: 0, z: 0.5 });
  const [hover, setHover] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [side, setSide] = useState<Side>('queue');
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean; id: number } | null>(null);
  const [size, setSize] = useState({ w: 900, h: 560 });

  const fit = () => {
    // Keyboard focus can scroll the clipped viewport; the transform alone positions the tree.
    viewport.current?.scrollTo(0, 0);
    const z = fitZoom(size.w, size.h);
    setView({ x: (size.w - LAYOUT.width * z) / 2, y: (size.h - LAYOUT.height * z) / 2, z });
  };
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    setSize({ w: el.clientWidth, h: el.clientHeight });
    // Open at a readable zoom on the present (era I–II); the fit button shows the whole tree.
    setView({ x: 0, y: 0, z: Math.max(fitZoom(el.clientWidth, el.clientHeight), 0.62) });
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!game) return null;
  const me = game.nations[game.player]!;
  const rate = researchBreakdown(world, game, game.player);
  const rp = rate.total;
  const current = me.researchCurrent ? world.techs.get(me.researchCurrent) : undefined;
  const currentCost = current ? techCostBreakdown(world, game, game.player, current.id).total : 0;
  const hovered = hover ? world.techs.get(hover) : undefined;
  const path = hovered ? new Set(pathTo(world, me, hovered.id)) : new Set<string>();
  const queued = new Map(me.researchQueue.map((id, i) => [id, i + 1]));
  const q = query.trim().toLowerCase();
  const matches = (t: TechMeta) => !q || t.name.toLowerCase().includes(q) || t.framing.toLowerCase().includes(q);

  const onWheel = (e: React.WheelEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    setView((v) => {
      const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.z * Math.exp(-e.deltaY * 0.0015)));
      // Zoom around the cursor.
      return { z, x: mx - ((mx - v.x) * z) / v.z, y: my - ((my - v.y) * z) / v.z };
    });
  };
  const onDown = (e: ReactPointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false, id: e.pointerId };
  };
  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) > 4) {
      d.moved = true;
      viewport.current?.setPointerCapture(d.id);
    }
    if (d.moved) setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
  };
  const onUp = () => {
    const d = drag.current;
    if (d?.moved) viewport.current?.releasePointerCapture(d.id);
    drag.current = null;
  };
  const zoomBy = (f: number) => {
    const mx = size.w / 2;
    const my = size.h / 2;
    setView((v) => {
      const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.z * f));
      return { z, x: mx - ((mx - v.x) * z) / v.z, y: my - ((my - v.y) * z) / v.z };
    });
  };

  const choose = (t: TechMeta, append: boolean) => {
    if (me.techs.includes(t.id) || drag.current?.moved) return;
    dispatch({ type: 'queueResearch', tech: t.id, append });
    playSound('accept');
  };

  // Hover card position in viewport coordinates.
  const card = (() => {
    if (!hovered) return null;
    const p = LAYOUT.pos.get(hovered.id)!;
    const sx = view.x + (p.x + NODE_W) * view.z + 12;
    const sy = view.y + p.y * view.z;
    const w = 400;
    const left = sx + w > size.w ? Math.max(8, view.x + p.x * view.z - w - 12) : sx;
    return { left, top: Math.min(Math.max(8, sy), Math.max(8, size.h - 430)) };
  })();

  return (
    <Modal
      title="Research"
      subtitle={`${rp.toFixed(0)} research points a month. ${current ? `Researching ${current.name}: ${Math.round(me.researchPoints)}/${currentCost} RP, about ${months(currentCost - me.researchPoints, rp)} months left.` : 'Click any technology to research it — missing prerequisites are queued automatically.'}`}
      wide
      full
      testId="modal-research"
      footer={
        <>
          <Stat
            label="Rate"
            value={`${rp.toFixed(0)} RP/mo`}
            tooltip={`10 × √(research spending of $${me.finances.research.toFixed(1)} bn a month) = ${rate.base.toFixed(0)}, then ${rate.factors.map((f) => `${f.label} ×${f.factor.toFixed(2)}`).join(', ') || 'no modifiers'}.`}
          />
          <Stat label="Banked" value={`${Math.round(me.researchPoints)} RP`} tooltip="Points accumulate while no project is selected and carry over between projects." />
          <Stat label="Fielded" value={`${me.techs.length}/${world.techList.length}`} tooltip="Technologies your nation fields, including those it started with in January 2027." />
          <Stat label="Queue" value={`${me.researchQueue.length}`} tooltip="Projects waiting after the current one; they start automatically." />
          <div className="zoom-controls">
            <button className="icon-btn" onClick={() => zoomBy(1 / 1.2)} data-tip="Zoom out (or scroll)" data-testid="tech-zoom-out">
              −
            </button>
            <button className="icon-btn" onClick={() => zoomBy(1.2)} data-tip="Zoom in (or scroll)" data-testid="tech-zoom-in">
              +
            </button>
            <button className="icon-btn" onClick={fit} data-tip="Fit the whole tree" data-testid="tech-fit">
              ⤢
            </button>
          </div>
        </>
      }
    >
      <div className="research-layout">
        <div className="research-main">
          <div className="research-toolbar">
            <div className="branch-legend">
              {world.branches.map((b) => (
                <button
                  key={b.id}
                  className={`chip toggle ${focus === b.id ? 'on' : ''}`}
                  style={{ ['--branch' as string]: b.color }}
                  onClick={() => setFocus((f) => (f === b.id ? null : b.id))}
                  data-tip={`Highlight ${b.name}. ${me.techs.filter((id) => world.techs.get(id)?.branch === b.id).length} of ${world.techList.filter((t) => t.branch === b.id).length} fielded.`}
                  data-testid={`branch-${b.id}`}
                >
                  <span className="branch-dot" />
                  {b.name}
                </button>
              ))}
            </div>
            <input className="input tech-search" placeholder="Search technologies…" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="tech-search" />
          </div>
          <div
            ref={viewport}
            className="tech-viewport"
            onWheel={onWheel}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            data-testid="tech-tree"
          >
            <div className="tech-canvas" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`, width: LAYOUT.width, height: LAYOUT.height }}>
              {LAYOUT.eras.map((e, i) => {
                const meta = ERA.get(e.era)!;
                return (
                  <div key={e.era} className={`era-band ${i % 2 ? 'odd' : ''}`} style={{ left: e.x0, width: e.x1 - e.x0, height: LAYOUT.height }}>
                    <div className="era-head" data-tip={meta.description}>
                      <span className="era-roman">{['I', 'II', 'III', 'IV', 'V'][e.era - 1]}</span>
                      <span className="era-name">{meta.name}</span>
                      <span className="era-years">{meta.years}</span>
                    </div>
                  </div>
                );
              })}
              {LAYOUT.branches.map((b) => {
                const meta = BRANCH.get(b.id)!;
                const dim = focus && focus !== b.id;
                return (
                  <div key={b.id} className={`branch-band ${dim ? 'dim' : ''}`} style={{ top: b.y0, height: b.y1 - b.y0, width: LAYOUT.width, ['--branch' as string]: meta.color }}>
                    <div className="branch-label" style={{ width: GUTTER - 16 }}>
                      {meta.name}
                    </div>
                  </div>
                );
              })}
              <svg className="tech-links" width={LAYOUT.width} height={LAYOUT.height}>
                {world.techList.map((t) =>
                  t.requires.map((r) => {
                    const a = LAYOUT.pos.get(r)!;
                    const b = LAYOUT.pos.get(t.id)!;
                    const x1 = a.x + NODE_W;
                    const y1 = a.y + NODE_H / 2;
                    const x2 = b.x;
                    const y2 = b.y + NODE_H / 2;
                    const done = me.techs.includes(r);
                    const onPath = path.has(t.id) && (path.has(r) || me.techs.includes(r));
                    const color = BRANCH.get(world.techs.get(r)!.branch)!.color;
                    const dim = focus && focus !== t.branch && focus !== world.techs.get(r)!.branch;
                    const bend = Math.max(30, (x2 - x1) / 2);
                    return (
                      <path
                        key={`${r}-${t.id}`}
                        className={`${onPath ? 'on-path' : ''} ${dim ? 'dim' : ''}`}
                        d={`M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`}
                        stroke={onPath ? '#f8fafc' : done ? color : 'rgba(148,163,184,0.28)'}
                        strokeWidth={onPath ? 2.4 : done ? 1.8 : 1.1}
                        fill="none"
                      />
                    );
                  }),
                )}
              </svg>
              {world.techList.map((t) => {
                const p = LAYOUT.pos.get(t.id)!;
                const done = me.techs.includes(t.id);
                const available = !done && prerequisitesMet(t, me);
                const active = me.researchCurrent === t.id;
                const qn = queued.get(t.id);
                const color = BRANCH.get(t.branch)!.color;
                const cost = done ? t.cost : techCostBreakdown(world, game, game.player, t.id).total;
                const dim = (focus && focus !== t.branch) || !matches(t);
                const pct = active ? Math.min(100, (me.researchPoints / Math.max(1, cost)) * 100) : 0;
                const unlockIcons = [...t.unlocks.units.map(() => '✈'), ...t.unlocks.abilities.map(() => '★')];
                return (
                  <button
                    key={t.id}
                    className={`tech-node ${done ? 'done' : available ? 'available' : 'locked'} ${active ? 'active' : ''} ${qn ? 'queued' : ''} ${path.has(t.id) ? 'on-path' : ''} ${dim ? 'dim' : ''} ${q && matches(t) ? 'match' : ''}`}
                    style={{ left: p.x, top: p.y, width: NODE_W, height: NODE_H, ['--branch' as string]: color }}
                    onClick={(e) => choose(t, e.shiftKey)}
                    onMouseEnter={() => setHover(t.id)}
                    onMouseLeave={() => setHover((h) => (h === t.id ? null : h))}
                    aria-label={`${t.name}. ${t.framing}`}
                    data-testid={`tech-${t.id}`}
                  >
                    <span className="tech-name">
                      {t.name}
                      {unlockIcons.length > 0 && <span className="tech-unlock">{unlockIcons.join('')}</span>}
                    </span>
                    <span className="tech-meta">
                      <span className="tech-year">{t.year}</span>
                      {done ? (
                        <span className="chip tiny ok">fielded</span>
                      ) : active ? (
                        <span className="chip tiny active">{Math.round(pct)}%</span>
                      ) : qn ? (
                        <span className="chip tiny">#{qn}</span>
                      ) : null}
                      {!done && <Stat value={`${cost} RP`} tooltip={`Research cost after alliances, stolen designs and export controls. At ${rp.toFixed(0)} RP/month about ${months(cost, rp)} months.`} inline />}
                    </span>
                    {active && <span className="tech-progress" style={{ width: `${pct}%` }} />}
                  </button>
                );
              })}
            </div>
            {hovered && card && <HoverCard t={hovered} game={game} rp={rp} pos={card} pathLen={path.size} />}
            <div className="tech-hint">Scroll to zoom · drag to pan · click to research (prerequisites auto-queue) · shift-click to add to the queue</div>
          </div>
        </div>
        <aside className="research-side">
          <div className="seg" style={{ marginBottom: 10 }}>
            {(
              [
                ['queue', 'Queue', 'Current project and the queue.'],
                ['espionage', 'Espionage', 'Steal research from other nations, at diplomatic risk; export controls.'],
                ['sharing', 'Sharing', 'Hand technology to allies and partners.'],
              ] as const
            ).map(([id, label, tip]) => (
              <button key={id} className={`seg-btn ${side === id ? 'active' : ''}`} onClick={() => setSide(id)} data-tip={tip} data-testid={`research-tab-${id}`}>
                {label}
              </button>
            ))}
          </div>
          {side === 'queue' && <QueuePanel game={game} rp={rp} rate={rate} />}
          {side === 'espionage' && <EspionagePanel game={game} />}
          {side === 'sharing' && <SharingPanel game={game} />}
        </aside>
      </div>
    </Modal>
  );
}

function HoverCard({ t, game, rp, pos, pathLen }: { t: TechMeta; game: GameState; rp: number; pos: { left: number; top: number }; pathLen: number }) {
  const me = game.nations[game.player]!;
  const done = me.techs.includes(t.id);
  const branch = BRANCH.get(t.branch)!;
  const era = ERA.get(t.era)!;
  const c = techCostBreakdown(world, game, game.player, t.id);
  const path = pathTo(world, me, t.id);
  const pathCost = path.reduce((s, id) => s + techCostBreakdown(world, game, game.player, id).total, 0);
  const fielders = world.majors.filter((iso) => game.nations[iso]?.techs.includes(t.id));
  const costTip = [
    `Base ${c.base} RP`,
    c.allyDiscount > 0 ? `−${Math.round(c.allyDiscount * 100)} % shared by allies (${c.sharingAllies.map((a) => nationName(world, a)).join(', ')})` : null,
    c.diffusionDiscount > 0 ? `−${Math.round(c.diffusionDiscount * 100)} % proven: nations with half the world's output field it` : null,
    c.credit > 0 ? `−${Math.round(c.credit * 100)} % stolen or shared designs` : null,
    c.exportControl > 1.001 ? `×${c.exportControl.toFixed(2)} export controls on chips and AI against you` : null,
  ]
    .filter(Boolean)
    .join('; ');
  return (
    <div className="tech-card" style={{ left: pos.left, top: pos.top, ['--branch' as string]: branch.color }} data-testid="tech-card">
      <div className="tech-card-head">
        <span className="tech-card-branch">{branch.name}</span>
        <span className="tech-card-era">
          Era {['I', 'II', 'III', 'IV', 'V'][t.era - 1]} · {era.name} · {t.year}
        </span>
      </div>
      <h3>{t.name}</h3>
      <p className="tech-card-framing">{t.framing}</p>
      <div className="tech-card-section">
        <div className="tech-card-label">Effects</div>
        <ul>
          {t.effects.map((e) => (
            <li key={e.key}>{effectText(e)}</li>
          ))}
        </ul>
      </div>
      {(t.unlocks.units.length > 0 || t.unlocks.abilities.length > 0) && (
        <div className="tech-card-section">
          <div className="tech-card-label">Unlocks</div>
          <ul>
            {t.unlocks.units.map((u) => {
              const m = world.unitTypes.get(u);
              return (
                <li key={u}>
                  ✈ <b>{m?.name ?? u}</b>
                  {m && (
                    <span className="dim">
                      {' '}
                      — {m.domain === 'air' ? `air ${m.antiAir}, attack ${m.attack}, range ${m.range}` : `anti-air ${m.antiAir}, defence ${m.defence}`}, ${m.costBn} bn, {m.buildMonths} mo
                    </span>
                  )}
                </li>
              );
            })}
            {t.unlocks.abilities.map((a) => {
              const m = world.abilities.get(a);
              return (
                <li key={a}>
                  ★ <b>{m?.name ?? a}</b> — {m?.description}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {t.requires.length > 0 && (
        <div className="tech-card-section">
          <div className="tech-card-label">Requires</div>
          <ul>
            {t.requires.map((r) => (
              <li key={r} className={me.techs.includes(r) ? 'ok' : 'missing'}>
                {me.techs.includes(r) ? '✓' : '✗'} {world.techs.get(r)?.name}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="tech-card-stats">
        {done ? (
          <span className="chip tiny ok">Fielded</span>
        ) : (
          <>
            <Stat label="Cost" value={`${c.total} RP`} tooltip={costTip} />
            <Stat label="Time" value={`${months(c.total, rp)} mo`} tooltip={`At your current ${rp.toFixed(0)} RP a month.`} />
            {pathLen > 1 && <Stat label="Path" value={`${pathLen} techs · ${months(pathCost, rp)} mo`} tooltip={`Clicking queues ${path.map((id) => world.techs.get(id)?.name).join(' → ')} (${pathCost} RP in all).`} />}
          </>
        )}
      </div>
      <div className="tech-card-foot">
        {fielders.length > 0 ? `Fielded by ${fielders.map((iso) => nationName(world, iso)).join(', ')}.` : 'No great power fields it yet.'}
      </div>
    </div>
  );
}

function QueuePanel({ game, rp, rate }: { game: GameState; rp: number; rate: ReturnType<typeof researchBreakdown> }) {
  const me = game.nations[game.player]!;
  const current = me.researchCurrent ? world.techs.get(me.researchCurrent) : undefined;
  const cost = (id: string) => techCostBreakdown(world, game, game.player, id).total;
  const first = current ? Math.max(0, cost(current.id) - me.researchPoints) : 0;
  const cumulative: number[] = [];
  me.researchQueue.reduce((acc, id) => {
    const v = acc + cost(id);
    cumulative.push(v);
    return v;
  }, first);
  const move = (i: number, d: number) => {
    const q = [...me.researchQueue];
    const j = i + d;
    if (j < 0 || j >= q.length) return;
    [q[i], q[j]] = [q[j]!, q[i]!];
    dispatch({ type: 'setResearchQueue', queue: q });
  };
  return (
    <div data-testid="research-queue">
      <div className="section-title">Current project</div>
      {current ? (
        <div className="queue-current" style={{ ['--branch' as string]: BRANCH.get(current.branch)!.color }}>
          <div className="queue-name">{current.name}</div>
          <div className="bar">
            <div className="bar-fill" style={{ width: `${Math.min(100, (me.researchPoints / Math.max(1, cost(current.id))) * 100)}%` }} />
          </div>
          <Stat value={`${Math.round(me.researchPoints)}/${cost(current.id)} RP`} tooltip={`About ${months(first, rp)} months at ${rp.toFixed(0)} RP a month.`} inline />
        </div>
      ) : (
        <p className="hint">No project. Banked points carry over to the next one.</p>
      )}
      <div className="section-title" style={{ marginTop: 12 }}>
        Queue
      </div>
      {me.researchQueue.length === 0 && <p className="hint">Empty. Click a distant technology to queue its whole path.</p>}
      {me.researchQueue.map((id, i) => {
        const t = world.techs.get(id)!;
        const done = cumulative[i]!;
        return (
          <div key={id} className="queue-row" style={{ ['--branch' as string]: BRANCH.get(t.branch)!.color }} data-testid={`queue-item-${id}`}>
            <span className="branch-dot" />
            <span className="queue-name">{t.name}</span>
            <Stat value={`${months(done, rp)} mo`} tooltip={`Done in about ${months(done, rp)} months from now (${cost(id)} RP for this one).`} inline />
            <button className="icon-btn" onClick={() => move(i, -1)} data-tip="Earlier" disabled={i === 0}>
              ↑
            </button>
            <button className="icon-btn" onClick={() => move(i, 1)} data-tip="Later" disabled={i === me.researchQueue.length - 1}>
              ↓
            </button>
            <button className="icon-btn" onClick={() => dispatch({ type: 'setResearchQueue', queue: me.researchQueue.filter((x) => x !== id) })} data-tip="Remove from the queue">
              ✕
            </button>
          </div>
        );
      })}
      {me.researchQueue.length > 0 && (
        <button className="btn small" style={{ marginTop: 6 }} onClick={() => dispatch({ type: 'setResearchQueue', queue: [] })} data-testid="queue-clear">
          Clear queue
        </button>
      )}
      <div className="section-title" style={{ marginTop: 14 }}>
        Research rate
      </div>
      <div className="factor-list">
        <Stat label="Spending" value={`${rate.base.toFixed(0)} RP`} tooltip={`10 × √(monthly research spending, $${me.finances.research.toFixed(1)} bn). Raise the research share of the budget to go faster.`} />
        {rate.factors.map((f) => (
          <Stat key={f.label} label={f.label} value={`×${f.factor.toFixed(2)}`} tooltip={f.detail} accent={f.factor < 0.995 ? '#f87171' : f.factor > 1.005 ? '#4ade80' : undefined} />
        ))}
        <Stat
          label="Export controls"
          value={`${Math.round(exportControlShare(game, game.player) * 100)} %`}
          tooltip="Share of world GDP held by nations that sanction you or control chip and AI exports to you. It raises the cost of semiconductor and AI technologies (×1 + 1.2 × share, less your sanction resistance) and those nations share nothing with you."
        />
      </div>
    </div>
  );
}

function EspionagePanel({ game }: { game: GameState }) {
  const targets = useMemo(
    () =>
      Object.values(game.nations)
        .filter((n) => n.alive && n.iso3 !== game.player)
        .map((n) => ({ iso: n.iso3, count: stealableTechs(world, game, game.player, n.iso3).length }))
        .filter((x) => x.count > 0)
        .sort((a, b) => b.count - a.count || (a.iso < b.iso ? -1 : 1)),
    [game],
  );
  const [target, setTarget] = useState<Iso3 | null>(null);
  const tgt = target && targets.some((x) => x.iso === target) ? target : (targets[0]?.iso ?? null);
  const odds = tgt ? stealOdds(world, game, game.player, tgt) : null;
  const list = tgt
    ? stealableTechs(world, game, game.player, tgt)
        .map((id) => world.techs.get(id)!)
        .sort((a, b) => b.era - a.era || b.cost - a.cost)
    : [];
  const controlled = tgt ? (game.techControls ?? []).includes(`${game.player}>${tgt}`) : false;
  return (
    <div data-testid="research-espionage">
      <p className="hint">
        Steal designs a rival already fields: success covers {Math.round(STEAL_CREDIT * 100)} % of the research cost. Exposure costs relations, legitimacy and goodwill with the target's allies. One operation every four months.
      </p>
      {targets.length === 0 ? (
        <p className="hint">No nation fields anything you could use yet.</p>
      ) : (
        <>
          <select className="select" value={tgt ?? ''} onChange={(e) => setTarget(e.target.value)} data-testid="steal-target">
            {targets.map((x) => (
              <option key={x.iso} value={x.iso}>
                {nationName(world, x.iso)} ({x.count})
              </option>
            ))}
          </select>
          {odds && tgt && (
            <div className="factor-list" style={{ marginTop: 8 }}>
              <Stat label="Success" value={`${Math.round(odds.success * 100)} %`} tooltip={`${odds.factors.join('; ')}. Clamped to 5–85 %.`} />
              <Stat label="Exposure" value={`${Math.round(odds.detection * 100)} %`} tooltip="Chance the target uncovers the operation (independent of success): 40 % + their counter-intelligence and 30 % of their cyber defence, − half your espionage tech. Exposure: relations −15, legitimacy −2, their allies −4, a grievance remembered." accent="#fbbf24" />
              <Stat label="Cost" value={formatMoney(stealCost(game, game.player))} tooltip="0.01 % of GDP per operation (at least $0.3 bn)." />
              <Stat label="Relations" value={`${Math.round(getRelation(world, game, game.player, tgt))}`} tooltip="Current relations with the target (−100 to +100)." />
            </div>
          )}
          <div className="steal-list">
            {list.slice(0, 12).map((t) => {
              const why = canStealTech(world, game, game.player, tgt!, t.id);
              return (
                <div key={t.id} className="queue-row" style={{ ['--branch' as string]: BRANCH.get(t.branch)!.color }}>
                  <span className="branch-dot" />
                  <span className="queue-name">{t.name}</span>
                  <Stat value={`${t.cost} RP`} tooltip={`Base cost; a successful theft covers ${Math.round(t.cost * STEAL_CREDIT)} RP.`} inline />
                  <button
                    className="btn small"
                    disabled={!!why}
                    data-tip={why ?? `Attempt to steal ${t.name} from ${nationName(world, tgt!)}.`}
                    data-testid={`steal-${t.id}`}
                    onClick={() => {
                      dispatch({ type: 'stealTech', target: tgt!, tech: t.id });
                      playSound('order');
                    }}
                  >
                    Steal
                  </button>
                </div>
              );
            })}
          </div>
          <div className="section-title" style={{ marginTop: 12 }}>
            Export controls
          </div>
          <p className="hint">
            Deny {tgt ? nationName(world, tgt) : 'them'} your chips, chip tools and AI: their semiconductor and AI research costs more in proportion to the economies that join you. Relations −8.
          </p>
          {tgt && (
            <button
              className={`btn small ${controlled ? '' : 'primary'}`}
              onClick={() => dispatch({ type: 'techControls', target: tgt, on: !controlled })}
              data-tip={controlled ? 'Lift your export controls (relations +4).' : 'Impose export controls (relations −8).'}
              data-testid="tech-controls-toggle"
            >
              {controlled ? 'Lift export controls' : 'Impose export controls'}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function SharingPanel({ game }: { game: GameState }) {
  const allies = new Set(alliesOf(world, game, game.player));
  const partners = Object.values(game.nations)
    .filter((n) => n.alive && n.iso3 !== game.player)
    .map((n) => ({ iso: n.iso3, techs: shareableTechs(world, game, game.player, n.iso3) }))
    .filter((x) => x.techs.length > 0)
    .sort((a, b) => Number(allies.has(b.iso)) - Number(allies.has(a.iso)) || b.techs.length - a.techs.length);
  const [to, setTo] = useState<Iso3 | null>(null);
  const tgt = to && partners.some((p) => p.iso === to) ? to : (partners[0]?.iso ?? null);
  const list = partners.find((p) => p.iso === tgt)?.techs.map((id) => world.techs.get(id)!) ?? [];
  return (
    <div data-testid="research-sharing">
      <p className="hint">
        Allies (treaty partners and NATO/CSTO members) and partners with relations of at least 50 can receive any technology you field: they gain it at once and remember the favour; their enemies resent it. Allies who field a technology also make it up to 30 % cheaper for each other automatically.
      </p>
      {partners.length === 0 ? (
        <p className="hint">No eligible partner lacks anything you could share.</p>
      ) : (
        <>
          <select className="select" value={tgt ?? ''} onChange={(e) => setTo(e.target.value)} data-testid="share-target">
            {partners.map((p) => (
              <option key={p.iso} value={p.iso}>
                {nationName(world, p.iso)} {allies.has(p.iso) ? '(ally)' : ''} ({p.techs.length})
              </option>
            ))}
          </select>
          <div className="steal-list">
            {list
              .sort((a, b) => b.era - a.era || b.cost - a.cost)
              .slice(0, 14)
              .map((t) => (
                <div key={t.id} className="queue-row" style={{ ['--branch' as string]: BRANCH.get(t.branch)!.color }}>
                  <span className="branch-dot" />
                  <span className="queue-name">{t.name}</span>
                  <button
                    className="btn small"
                    disabled={!!canShareTech(world, game, game.player, tgt!, t.id)}
                    data-tip={`Give ${t.name} to ${nationName(world, tgt!)}: relations +6 and a favour remembered.`}
                    data-testid={`share-${t.id}`}
                    onClick={() => {
                      dispatch({ type: 'shareTech', to: tgt!, tech: t.id });
                      playSound('accept');
                    }}
                  >
                    Share
                  </button>
                </div>
              ))}
          </div>
        </>
      )}
    </div>
  );
}

