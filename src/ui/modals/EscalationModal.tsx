/** Escalation ladder (D-076): global tension gauge, the seven rungs, DEFCON and deterrence per power. */
import { Modal } from '../Modal';
import { ScreenIcon } from '../icons';
import { useGameStore } from '../../state/gameStore';
import { loadWorld, nationName, traitsOf } from '../../sim/world';
import {
  ESCALATION_LADDER,
  defconFactors,
  escalationRung,
  nuclearDecision,
  secondStrike,
} from '../../sim/escalation';
import { Stat } from '../Stat';
import { flagEmoji } from '../flags';
import { nationHex } from '../../render/palette';
import { DEFCON_LABEL } from '../format';
import type { GameState, Iso3 } from '../../sim/types';

const world = loadWorld();

function TensionGauge({ value }: { value: number }) {
  // Semicircle from 180° (0) to 0° (100).
  const angle = Math.PI * (1 - value / 100);
  const nx = 100 + 74 * Math.cos(angle);
  const ny = 100 - 74 * Math.sin(angle);
  const arc = (from: number, to: number, color: string) => {
    const a0 = Math.PI * (1 - from / 100);
    const a1 = Math.PI * (1 - to / 100);
    const p = (a: number) => `${100 + 86 * Math.cos(a)} ${100 - 86 * Math.sin(a)}`;
    return (
      <path d={`M ${p(a0)} A 86 86 0 0 1 ${p(a1)}`} stroke={color} strokeWidth="12" fill="none" />
    );
  };
  return (
    <svg viewBox="0 0 200 138" className="tension-gauge" aria-hidden="true">
      {arc(0, 35, '#22c55e')}
      {arc(35, 60, '#facc15')}
      {arc(60, 80, '#f97316')}
      {arc(80, 95, '#ef4444')}
      {arc(95, 100, '#991b1b')}
      <line
        x1="100"
        y1="100"
        x2={nx}
        y2={ny}
        stroke="#e8eef6"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="100" cy="100" r="6" fill="#e8eef6" />
      <text
        x="100"
        y="132"
        textAnchor="middle"
        fontSize="22"
        fontFamily="JetBrains Mono, monospace"
        fill="#e8eef6"
      >
        {Math.round(value)}
      </text>
    </svg>
  );
}

/** The player, every nuclear power and any great power at war. */
function powersToShow(game: GameState): Iso3[] {
  const set = new Set<Iso3>([game.player]);
  for (const n of Object.values(game.nations)) if (n.alive && n.warheads > 0) set.add(n.iso3);
  for (const m of world.majors)
    if (game.wars.some((w) => w.attackers.includes(m) || w.defenders.includes(m))) set.add(m);
  return [...set].filter((x) => game.nations[x]?.alive);
}

export function EscalationModal() {
  const game = useGameStore((s) => s.game);
  if (!game) return null;
  const rung = escalationRung(world, game);
  const me = game.nations[game.player]!;
  return (
    <Modal icon={<ScreenIcon id="escalation" />}
      title="Escalation"
      subtitle={`Global tension ${Math.round(game.globalTension)}. ${ESCALATION_LADDER[rung.index]!.name}: ${rung.why}`}
      wide
      testId="modal-escalation"
    >
      <div className="escalation-layout">
        <div className="escalation-left">
          <div data-tip="Global tension, 0–100: 0.6 × the average flashpoint tension + 6 per great power at war + 2 per mobilised great power + 15 per nuclear detonation. It moves at most 3 points a month toward that target and sets every nation's DEFCON floor.">
            <TensionGauge value={game.globalTension} />
          </div>
          <div className="row">
            <Stat
              label="Your DEFCON"
              value={`${me.defcon}`}
              tooltip={`${DEFCON_LABEL[me.defcon] ?? ''}. Nuclear release requires DEFCON 1.`}
              className={me.defcon <= 2 ? 'danger' : me.defcon === 3 ? 'warn' : ''}
            />
            <Stat
              label="Detonations"
              value={`${game.detonations}`}
              tooltip="Nuclear detonations so far. Eight is a full exchange: the game ends for everyone."
              accent={game.detonations ? 'var(--bad)' : undefined}
            />
            <Stat
              label="Cooling"
              value={`${(game.nuclearWinter ?? 0).toFixed(1)} °C`}
              tooltip="Global cooling from the soot of nuclear fires: each detonation adds 0.6 °C, falling about 7 % a month. Every 1 °C costs every economy 0.4 pp of growth a month and erodes stability."
            />
          </div>
          <div className="section-title">Flashpoints</div>
          {world.flashpoints.map((f) => {
            const t = game.flashpoints[f.id] ?? 0;
            return (
              <div
                key={f.id}
                className="flash-row"
                data-tip={`${f.description} Tension drifts toward 95 when its sides are at war, 72/58/45 as relations worsen past −80/−60/−40, else 30; events and crises push it.`}
              >
                <span>{f.name}</span>
                <span className="flash-bar">
                  <span
                    style={{
                      width: `${t}%`,
                      background: t >= 75 ? 'var(--bad)' : t >= 55 ? 'var(--warn)' : 'var(--good)',
                    }}
                  />
                </span>
                <Stat value={`${Math.round(t)}`} tooltip={`${f.name} tension, 0–100.`} inline />
              </div>
            );
          })}
        </div>
        <div className="escalation-right">
          <div className="escalation-ladder" data-testid="escalation-ladder">
            {[...ESCALATION_LADDER].reverse().map((r) => {
              const idx = ESCALATION_LADDER.indexOf(r);
              const state = idx === rung.index ? 'current' : idx < rung.index ? 'passed' : '';
              return (
                <div key={r.id} className={`rung ${state}`} data-testid={`rung-${r.id}`}>
                  <div className="rung-head">
                    <span className="rung-step">{idx + 1}</span>
                    <strong>{r.name}</strong>
                    <span className="dim">{r.description}</span>
                    {state === 'current' && <span className="chip tiny enemy">now</span>}
                  </div>
                  <div className="rung-triggers" data-tip={r.description}>
                    <span>▲ {r.up}</span>
                    <span>▼ {r.down}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="section-title" style={{ marginTop: 10 }}>
            DEFCON and deterrence
          </div>
          <div className="defcon-table" data-testid="defcon-table">
            <div className="defcon-row head">
              <span>Nation</span>
              <span>DEFCON</span>
              <span>Warheads</span>
              <span>SSBN at sea</span>
              <span>Second strike</span>
              <span>Nuclear posture</span>
            </div>
            {powersToShow(game).map((iso) => {
              const n = game.nations[iso]!;
              const factors = defconFactors(world, game, iso).filter((f) => f.active);
              const ss = secondStrike(world, game, iso);
              const d = iso === game.player ? null : nuclearDecision(world, game, iso);
              const t = traitsOf(world, iso, game);
              return (
                <div key={iso} className={`defcon-row ${iso === game.player ? 'mine' : ''}`}>
                  <span style={{ color: nationHex(iso) }}>
                    {flagEmoji(world.nations.get(iso)?.iso2 ?? '')} {nationName(world, iso)}
                  </span>
                  <Stat
                    value={`${n.defcon}`}
                    tooltip={`${DEFCON_LABEL[n.defcon] ?? ''}. ${factors.length ? `Raised by: ${factors.map((f) => `${f.label} (→ ${f.level})`).join('; ')}.` : 'No factor raises it: peacetime readiness.'}${n.defconMod ? ` Events shift it by ${-n.defconMod}.` : ''}`}
                    className={n.defcon <= 2 ? 'danger' : n.defcon === 3 ? 'warn' : ''}
                    inline
                  />
                  <Stat
                    value={`${n.warheads}`}
                    tooltip="Nuclear warheads (public estimates, FAS); each strike expends 10."
                    inline
                  />
                  <Stat
                    value={`${ss.atSea}`}
                    tooltip={`${ss.ssbns} ballistic-missile submarine formation(s) on patrol carrying up to 120 warheads each — the most survivable leg of the triad.`}
                    inline
                  />
                  <Stat
                    value={
                      ss.status === 'assured'
                        ? 'Assured'
                        : ss.status === 'limited'
                          ? 'Limited'
                          : 'None'
                    }
                    tooltip={`${ss.survivable} warheads would survive a disarming first strike (90 % at sea, 30 % on land). ≥ 50 is an assured second strike, ≥ 10 a limited one. Enemy missile defence reduces what gets through.`}
                    accent={
                      ss.status === 'assured'
                        ? 'var(--good)'
                        : ss.status === 'limited'
                          ? 'var(--warn)'
                          : undefined
                    }
                    inline
                  />
                  <Stat
                    value={
                      n.warheads === 0
                        ? '—'
                        : d
                          ? d.consider
                            ? 'Considering use'
                            : `Threshold ${t.nuclearThreshold}`
                          : 'Your decision'
                    }
                    tooltip={
                      d
                        ? `Leader's nuclear threshold ${t.nuclearThreshold}/100 (higher is safer). ${d.reason} The AI considers use only at DEFCON 1 when desperation (lost territory, a lost capital, nuclear attack) passes its threshold, raised by 20 against an assured enemy second strike.`
                        : 'Nuclear release requires DEFCON 1 and two confirmations.'
                    }
                    accent={d?.consider ? 'var(--bad)' : undefined}
                    inline
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
}
