/** Battle report (D-059): forces, losses and the full modifier breakdown of one battle. */
import { Modal } from '../Modal';
import { ScreenIcon } from '../icons';
import { useGameStore } from '../../state/gameStore';
import { useUiStore } from '../../state/uiStore';
import { loadWorld, nationName } from '../../sim/world';
import { dateForTurn } from '../../sim/game';
import { Stat } from '../Stat';
import { formatMonth } from '../format';
import { nationHex } from '../../render/palette';
import { BreakdownRows } from '../GeographyPanel';
import { playSound } from '../audio';
import type { BattleReport, BattleSide } from '../../sim/types';

const world = loadWorld();

const OUTCOME: Record<BattleReport['outcome'], { label: string; tip: string }> = {
  attackerWins: { label: 'Attacker wins', tip: 'The defenders were destroyed or driven out; the region changed hands (land) or the zone was cleared (sea).' },
  defenderHolds: { label: 'Defender holds', tip: 'Every attacking formation was destroyed or retreated below 20 % strength.' },
  stalemate: { label: 'Fighting continues', tip: 'Both sides remain in contact; the battle resumes next month unless someone withdraws.' },
};

function SideBlock({ title, sides, loss, power, tip }: { title: string; sides: BattleSide[]; loss: number; power: number; tip: string }) {
  return (
    <div className="battle-side">
      <div className="section-title">{title}</div>
      {sides.map((s) => (
        <div key={s.nation} className="battle-nation">
          <div className="battle-nation-head">
            <span style={{ color: nationHex(s.nation) }}>{nationName(world, s.nation)}</span>
            <Stat
              value={`${Math.round(s.strengthBefore)} → ${Math.round(s.strengthAfter)}`}
              tooltip="Total strength of this nation's formations in the battle before and after (100 per formation at full strength; units that retreated or died count as 0 after)."
              inline
            />
          </div>
          <div className="chips">
            {s.units.map((u) => (
              <span key={u.type} className="chip tiny" data-tip={world.unitTypes.get(u.type)?.description ?? u.type}>
                {u.count}× {world.unitTypes.get(u.type)?.name ?? u.type}
              </span>
            ))}
          </div>
        </div>
      ))}
      <div className="row">
        <Stat label="Losses" value={`${Math.round(loss)}`} tooltip="Strength points lost by this side, spread over its formations in proportion to their strength." accent="#f87171" />
        <Stat label="Firepower" value={`${power.toFixed(1)}`} tooltip={tip} />
      </div>
    </div>
  );
}

export function BattleReportModal() {
  const game = useGameStore((s) => s.game);
  const id = useUiStore((s) => s.battleReportId);
  const fly = useUiStore((s) => s.fly);
  const select = useUiStore((s) => s.select);
  const setModal = useUiStore((s) => s.setModal);
  if (!game) return null;
  const report = game.battleReports.find((b) => b.id === id) ?? game.battleReports[0];
  if (!report) {
    return (
      <Modal icon={<ScreenIcon id="battle" />} title="Battle report" testId="modal-battle">
        <p className="hint">No battles were fought last month.</p>
      </Modal>
    );
  }
  const meta = world.regions.get(report.region)!;
  const others = game.battleReports.filter((b) => b.id !== report.id);
  return (
    <Modal icon={<ScreenIcon id="battle" />}
      title={`${report.domain === 'sea' ? 'Naval battle in the' : 'Battle of'} ${meta.name}`}
      subtitle={`${formatMonth(dateForTurn(report.turn))} · ${OUTCOME[report.outcome].label}`}
      wide
      testId="modal-battle"
      footer={
        <>
          <button
            className="btn small ghost"
            onClick={() => {
              fly(meta.lat, meta.lon, 1.35);
              select(meta.id);
              setModal(null);
              playSound('click');
            }}
          >
            Fly to {meta.name}
          </button>
          {others.length > 0 && (
            <span className="hint" style={{ marginLeft: 'auto' }}>
              Other battles:{' '}
              {others.slice(0, 6).map((b) => (
                <button
                  key={b.id}
                  className="btn small ghost"
                  onClick={() => {
                    useUiStore.getState().openBattleReport(b.id);
                    playSound('click');
                  }}
                >
                  {world.regions.get(b.region)?.name}
                </button>
              ))}
            </span>
          )}
        </>
      }
    >
      <div className="row wrap" data-testid="battle-summary">
        <Stat
          label="Outcome"
          value={OUTCOME[report.outcome].label}
          tooltip={OUTCOME[report.outcome].tip}
          accent={report.outcome === 'attackerWins' ? 'var(--bad)' : report.outcome === 'defenderHolds' ? 'var(--good)' : undefined}
        />
        <Stat
          label="Odds"
          value={report.defencePower > 0 ? `${(report.attackPower / report.defencePower).toFixed(1)}:1` : '∞'}
          tooltip="Attacking firepower ÷ defending firepower with every modifier applied: the ratio the Lanchester losses were computed from."
        />
        {report.domain === 'land' && (
          <Stat
            label="Air superiority"
            value={`${Math.round(report.airSuperiority * 100)}%`}
            tooltip="Attacker's share of the air over the battle: fighters and drones on superiority, carriers and air-defence brigades in range, cut by terrain and weather. ×0.85 at 0 %, ×1.15 at 100 % for the attack; mirrored for the defence."
            accent={report.airSuperiority >= 0.6 ? 'var(--bad)' : report.airSuperiority <= 0.4 ? 'var(--good)' : undefined}
          />
        )}
        {report.captured && (
          <span className="tag" data-tip="The last defender fell and the region changed hands.">
            ⚑ Region captured
          </span>
        )}
      </div>
      <div className="battle-layout">
        <SideBlock
          title="Attackers"
          sides={report.attackers}
          loss={report.attackerLoss}
          power={report.attackPower}
          tip="Attacking firepower: Σ strength × attack × quality × every modifier below, plus air and naval support."
        />
        <SideBlock
          title="Defenders"
          sides={report.defenders}
          loss={report.defenderLoss}
          power={report.defencePower}
          tip="Defending firepower: Σ strength × defence × quality × every modifier below, plus air and naval support."
        />
      </div>
      {(report.attackerMods.length > 0 || report.defenderMods.length > 0) && (
        <div className="breakdown" data-testid="battle-breakdown">
          {report.attackerMods.length > 0 && <BreakdownRows title="Attacker modifiers (strength-weighted)" mods={report.attackerMods} />}
          {report.defenderMods.length > 0 && <BreakdownRows title="Defender modifiers (strength-weighted)" mods={report.defenderMods} />}
        </div>
      )}
      {report.domain === 'sea' && (
        <p className="hint">
          Fleet actions: submarines strike surface groups at ×1.3 and are hit at ×0.5 except by destroyer groups; ships below 25 % strength withdraw to a neighbouring zone.
        </p>
      )}
    </Modal>
  );
}
