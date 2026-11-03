import { ShieldCheck } from 'lucide-react';
import { Modal } from '../Modal';
import { ScreenIcon } from '../icons';
import { useGameStore } from '../../state/gameStore';
import { Stat } from '../Stat';
import { formatMoney, formatMonth, formatDelta, formatPct } from '../format';
import { dateForTurn } from '../../sim/game';
import { useUiStore } from '../../state/uiStore';
import { loadWorld, nationName } from '../../sim/world';
import { getRelation, isAtWar } from '../../sim/query';
import { relationLabel } from '../../sim/diplomacy';
import { playSound } from '../audio';
import { DivergingBar, Sparkline } from '../charts';
import { ADVISOR } from '../tutorial/steps';
import { flagEmoji } from '../flags';
import type { EconSample, GameState, TurnSummary } from '../../sim/types';

const world = loadWorld();
/** A signed change with a unit, or "±0" when it rounds away. */
const signed = (v: number, unit = '', digits = 1) => (Math.abs(v) < 0.5 * 10 ** -digits ? '±0' : `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}${unit}`);

/** One-paragraph bottom line from the month's numbers. */
function bottomLine(game: GameState, s: TurnSummary): string {
  const me = game.nations[game.player]!;
  const parts: string[] = [];
  parts.push(`The economy ${me.growth >= 0 ? 'grows' : 'shrinks'} at ${formatPct(me.growth, 1, true)} a year; the treasury ${s.treasuryDelta >= 0 ? 'rose' : 'fell'} by ${formatMoney(Math.abs(s.treasuryDelta))}.`);
  if (s.battles > 0) parts.push(`Your forces fought ${s.battles} battle${s.battles === 1 ? '' : 's'}${s.regionsGained || s.regionsLost ? `, gaining ${s.regionsGained} and losing ${s.regionsLost} region${s.regionsLost === 1 ? '' : 's'}` : ' with no territory changing hands'}.`);
  else parts.push(isAtWar(game, game.player) ? 'The front was quiet.' : 'Your forces saw no combat.');
  parts.push(`Global tension stands at ${Math.round(game.globalTension)}; you are at DEFCON ${me.defcon}.`);
  if (s.techsCompleted.length) parts.push(`Research delivered ${s.techsCompleted.join(', ')}.`);
  return parts.join(' ');
}

function Indicator({ label, value, tooltip, series, delta, good }: { label: string; value: string; tooltip: string; series: number[]; delta: string; good: boolean | null }) {
  return (
    <div className="ind">
      <Stat label={label} value={value} tooltip={tooltip} />
      <Sparkline values={series} label={label} color={good === null ? 'var(--accent-2)' : good ? 'var(--good)' : 'var(--bad)'} />
      <Stat value={delta} tooltip={`Change since last month. The chart covers the last ${series.length} months.`} className={`ind-delta ${good === null ? '' : good ? 'good' : 'bad'}`} inline />
    </div>
  );
}

export function SummaryModal() {
  const game = useGameStore((s) => s.game);
  if (!game) return null;
  const s = game.summary;
  const me = game.nations[game.player]!;
  const entries = game.log.filter((l) => l.turn === game.turn - 1);
  const hist: EconSample[] = (game.history[game.player] ?? []).slice(-24);
  const series = (k: keyof EconSample) => hist.map((h) => h[k] as number);
  const prev = hist.length >= 2 ? hist[hist.length - 2]! : null;
  const d = (k: keyof EconSample) => (prev ? (hist[hist.length - 1]![k] as number) - (prev[k] as number) : 0);
  const majors = world.majors.filter((iso) => iso !== game.player && game.nations[iso]?.alive);
  const month = s ? formatMonth(dateForTurn(s.turn - 1)) : formatMonth(game.date);
  return (
    <Modal icon={<ScreenIcon id="summary" />} title={`Intelligence briefing — ${month}`} subtitle={`Prepared for the ${world.nations.get(game.player)!.name} government by ${ADVISOR.name} (fictional), ${ADVISOR.title}.`} testId="modal-summary" wide>
      <div className="brief-band">
        <ShieldCheck size={14} aria-hidden="true" />
        <span>EYES ONLY · {world.nations.get(game.player)!.name.toUpperCase()} · {month.toUpperCase()}</span>
      </div>
      {!s && <p className="hint">End your first turn to receive a briefing.</p>}
      {s && (
        <>
          <section className="brief-bluf" data-testid="briefing-bluf">
            <div className="section-title">Bottom line</div>
            <p>{bottomLine(game, s)}</p>
          </section>
          <div className="brief-grid">
            <section>
              <div className="section-title">Key indicators</div>
              <div className="ind-list">
                <Indicator label="GDP" value={formatMoney(me.gdp)} tooltip="Annual nominal GDP of the home economy." series={series('gdp')} delta={formatMoney(s.gdpDelta, true)} good={s.gdpDelta >= 0} />
                <Indicator label="Growth" value={formatPct(me.growth, 1, true)} tooltip="Annualised real growth this month." series={series('growth')} delta={signed(d('growth'), ' pp')} good={Math.abs(d('growth')) < 0.05 ? null : d('growth') > 0} />
                <Indicator label="Approval" value={`${Math.round(me.support)}`} tooltip="Public support for the government, 0–100." series={series('support')} delta={signed(d('support'))} good={Math.abs(d('support')) < 0.05 ? null : d('support') > 0} />
                <Indicator label="Treasury" value={formatMoney(me.treasury)} tooltip="Cash available for production and emergencies." series={series('treasury')} delta={formatMoney(s.treasuryDelta, true)} good={s.treasuryDelta >= 0} />
                <Indicator label="Inflation" value={formatPct(me.inflation, 1)} tooltip="Consumer prices, % a year." series={series('inflation')} delta={signed(d('inflation'), ' pp')} good={Math.abs(d('inflation')) < 0.05 ? null : d('inflation') < 0} />
                <Indicator label="Debt" value={formatPct(hist[hist.length - 1]?.debt ?? 0, 0)} tooltip="Public debt as a share of GDP." series={series('debt')} delta={signed(d('debt'), ' pp')} good={Math.abs(d('debt')) < 0.05 ? null : d('debt') < 0} />
              </div>
            </section>
            <section>
              <div className="section-title">Standing with the great powers</div>
              <div className="rel-chart" data-testid="briefing-relations">
                {majors.map((iso) => {
                  const rel = getRelation(world, game, game.player, iso);
                  return (
                    <div key={iso} className="rel-row">
                      <span className="rel-name">
                        {flagEmoji(world.nations.get(iso)!.iso2)} {nationName(world, iso)}
                      </span>
                      <DivergingBar value={rel} />
                      <Stat value={`${rel > 0 ? '+' : ''}${Math.round(rel)}`} tooltip={`Relations with ${nationName(world, iso)}: ${relationLabel(rel)}. −100 hostile to +100 allied.`} inline />
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
          <div className="brief-grid">
            <section>
              <div className="section-title">Operations</div>
              <div className="row wrap">
                <Stat label="Battles" value={`${s.battles}`} tooltip="Battles involving your forces this month." />
                <Stat label="Regions" value={`+${s.regionsGained} / −${s.regionsLost}`} tooltip="Regions gained and lost this month." />
                <Stat label="Stability" value={formatDelta(s.stabilityDelta)} tooltip="Change in stability this month." accent={s.stabilityDelta < 0 ? 'var(--bad)' : 'var(--good)'} />
                <Stat label="Techs" value={`${s.techsCompleted.length}`} tooltip={s.techsCompleted.join(', ') || 'None completed this month.'} />
              </div>
              {game.battleReports.length > 0 && (
                <div className="chips" style={{ marginTop: 8 }}>
                  {game.battleReports.map((b) => (
                    <button
                      key={b.id}
                      className="chip"
                      data-testid="summary-battle"
                      data-tip="Open the full battle report: forces, losses and every modifier."
                      onClick={() => {
                        useUiStore.getState().openBattleReport(b.id);
                        playSound('open');
                      }}
                    >
                      {b.domain === 'sea' ? '⚓' : '⚔'} {world.regions.get(b.region)?.name}
                    </button>
                  ))}
                </div>
              )}
            </section>
            <section>
              <div className="section-title">Headlines</div>
              <ul className="headline-list">
                {s.headlines.slice(0, 6).map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
                {s.headlines.length === 0 && <li className="hint">A quiet month.</li>}
              </ul>
            </section>
          </div>
        </>
      )}
      <details className="brief-log">
        <summary>Full log ({entries.length})</summary>
        <div className="log-list">
          {entries.map((l, i) => (
            <div key={i} className={`log-row log-${l.kind} ${l.alert ? 'alert-row' : ''}`}>
              {l.text}
            </div>
          ))}
          {entries.length === 0 && <div className="hint">Nothing logged.</div>}
        </div>
      </details>
    </Modal>
  );
}
