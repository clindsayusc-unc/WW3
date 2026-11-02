import { useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { useGameStore } from '../../state/gameStore';
import { useUiStore } from '../../state/uiStore';
import { dispatch } from '../../state/simBridge';
import { loadWorld, nationName } from '../../sim/world';
import {
  getRelation,
  hasTreaty,
  isSanctioned,
  atWar,
  alliesOf,
  militaryPower,
} from '../../sim/query';
import { evaluateProposal, PROPOSAL_LABELS, relationLabel } from '../../sim/diplomacy';
import { Stat } from '../Stat';
import { formatMoney } from '../format';
import { flagEmoji } from '../flags';
import { nationHex } from '../../render/palette';
import { LeaderCard } from '../LeaderCard';
import { playSound } from '../audio';
import type { ProposalType } from '../../sim/types';

const world = loadWorld();

const ACTIONS: { type: ProposalType; tip: string; danger?: boolean }[] = [
  {
    type: 'trade',
    tip: 'Both economies gain a small growth bonus; relations +8 and a higher baseline.',
  },
  { type: 'nap', tip: 'Neither side may attack without a heavy reputational cost. Relations +10.' },
  {
    type: 'defensive',
    tip: 'If either is attacked, the other joins the war. Needs relations ≥ 35.',
  },
  {
    type: 'alliance',
    tip: 'Full alliance: mutual defence and a +70 relations baseline. Needs relations ≥ 55.',
  },
  {
    type: 'sanction',
    tip: 'Cuts their growth in proportion to your share of world GDP; relations −20.',
    danger: true,
  },
  { type: 'liftSanction', tip: 'Ends your sanctions; relations +10.' },
  {
    type: 'demand',
    tip: 'Demand 1% of their GDP. Only the badly outgunned comply; refusal costs relations.',
    danger: true,
  },
  {
    type: 'declareWar',
    tip: 'Declare war. Their defence-pact allies will join. Unprovoked wars cost stability.',
    danger: true,
  },
  { type: 'peaceWhite', tip: 'End the war; all occupied regions return to their owners.' },
  { type: 'peaceStatusQuo', tip: 'End the war; each side keeps the regions it controls.' },
];

export function DiplomacyModal() {
  const game = useGameStore((s) => s.game);
  const target = useUiStore((s) => s.diplomacyTarget);
  const setTarget = useUiStore((s) => s.setDiplomacyTarget);
  const [filter, setFilter] = useState('');
  const [lastReply, setLastReply] = useState<string | null>(null);
  const list = useMemo(() => {
    if (!game) return [];
    return world.nationList
      .filter((n) => n.iso3 !== game.player && game.nations[n.iso3]?.alive)
      .filter(
        (n) =>
          !filter ||
          n.name.toLowerCase().includes(filter.toLowerCase()) ||
          n.iso3.toLowerCase().includes(filter.toLowerCase()),
      )
      .sort((a, b) => Number(b.major) - Number(a.major) || b.gdpUsdBn - a.gdpUsdBn);
  }, [game, filter]);
  if (!game) return null;
  const me = game.player;
  const iso = target && game.nations[target]?.alive ? target : (list[0]?.iso3 ?? null);
  const n = iso ? game.nations[iso] : undefined;
  const meta = iso ? world.nations.get(iso) : undefined;
  const rel = iso ? getRelation(world, game, me, iso) : 0;
  const warNow = iso ? atWar(game, me, iso) : false;
  const act = (type: ProposalType) => {
    if (!iso) return;
    const verdict = evaluateProposal(world, game, me, iso, type);
    dispatch({ type: 'propose', proposal: type, target: iso });
    setLastReply(
      `${PROPOSAL_LABELS[type]} → ${nationName(world, iso)} ${verdict.accept ? 'accepts' : 'declines'}: ${verdict.reason}`,
    );
    playSound(verdict.accept ? 'accept' : 'reject');
  };
  const respond = (id: number, accept: boolean) => {
    dispatch({ type: 'respond', proposalId: id, accept });
    playSound(accept ? 'accept' : 'reject');
  };
  const resolutionOk = alliesOf(world, game, me).length >= 2;
  return (
    <Modal
      title="Diplomacy"
      subtitle="Relations run from −100 (war) to +100 (special relationship). Every reply explains itself."
      wide
      testId="modal-diplomacy"
    >
      <div className="diplomacy-layout">
        <div className="nation-list">
          <input
            className="input"
            placeholder="Search nations…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            data-testid="diplomacy-search"
          />
          <div className="nation-scroll">
            {list.map((x) => {
              const r = getRelation(world, game, me, x.iso3);
              return (
                <button
                  key={x.iso3}
                  className={`nation-row ${iso === x.iso3 ? 'active' : ''}`}
                  onClick={() => {
                    setTarget(x.iso3);
                    setLastReply(null);
                  }}
                  data-testid={`dip-${x.iso3}`}
                >
                  <span className="flag">{flagEmoji(x.iso2)}</span>
                  <span className="name" style={{ color: nationHex(x.iso3) }}>
                    {x.name}
                  </span>
                  {atWar(game, me, x.iso3) && <span className="chip tiny enemy">war</span>}
                  {hasTreaty(game, me, x.iso3, 'alliance') && (
                    <span className="chip tiny ally">ally</span>
                  )}
                  <span className={`rel ${r < -30 ? 'bad' : r > 30 ? 'good' : ''}`}>
                    {Math.round(r)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        {n && meta && iso && (
          <div className="nation-detail">
            <LeaderCard
              nation={meta}
              leader={world.leaders.get(iso)}
              accent={nationHex(iso)}
              compact
            />
            <div className="row">
              <Stat
                label="Relations"
                value={`${Math.round(rel)}`}
                tooltip={`${relationLabel(rel)}. Baseline from blocs and treaties; recent actions decay toward it at 0.5/month.`}
                accent={rel < -30 ? '#f87171' : rel > 30 ? '#4ade80' : undefined}
              />
              <Stat label="GDP" value={formatMoney(n.gdp)} tooltip="Annual GDP." />
              <Stat
                label="Power"
                value={`${Math.round(militaryPower(world, game, iso))}`}
                tooltip={`Military power index (sum of unit attack + defence values). Yours: ${Math.round(militaryPower(world, game, me))}.`}
              />
              <Stat
                label="Stability"
                value={`${Math.round(n.stability)}`}
                tooltip="Public order."
              />
            </div>
            <div className="chips">
              {meta.blocs.map((b) => (
                <span key={b} className="chip">
                  {b}
                </span>
              ))}
              {hasTreaty(game, me, iso, 'trade') && <span className="chip ok">trade deal</span>}
              {hasTreaty(game, me, iso, 'nap') && <span className="chip ok">non-aggression</span>}
              {hasTreaty(game, me, iso, 'defensive') && (
                <span className="chip ally">defensive pact</span>
              )}
              {hasTreaty(game, me, iso, 'alliance') && <span className="chip ally">alliance</span>}
              {isSanctioned(game, me, iso) && <span className="chip enemy">you sanction them</span>}
              {isSanctioned(game, iso, me) && <span className="chip enemy">they sanction you</span>}
            </div>
            <p className="ai-note">“{n.aiNote || 'No statement.'}”</p>
            <div className="section-title">Actions</div>
            <div className="action-grid">
              {ACTIONS.filter((a) =>
                warNow
                  ? ['peaceWhite', 'peaceStatusQuo', 'sanction', 'liftSanction', 'demand'].includes(
                      a.type,
                    )
                  : !['peaceWhite', 'peaceStatusQuo'].includes(a.type),
              )
                .filter(
                  (a) =>
                    !(a.type === 'liftSanction' && !isSanctioned(game, me, iso)) &&
                    !(a.type === 'sanction' && isSanctioned(game, me, iso)),
                )
                .map((a) => {
                  const v = evaluateProposal(world, game, me, iso, a.type);
                  return (
                    <button
                      key={a.type}
                      className={`btn small ${a.danger ? 'danger' : ''} ${v.accept ? '' : 'dim'}`}
                      onClick={() => act(a.type)}
                      data-tip={`${a.tip} Likely reply: ${v.reason}`}
                      data-testid={`act-${a.type}`}
                    >
                      {PROPOSAL_LABELS[a.type]}
                    </button>
                  );
                })}
            </div>
            {lastReply && (
              <div className="reply" data-testid="diplomacy-reply">
                {lastReply}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="section-title" style={{ marginTop: 16 }}>
        Incoming proposals
      </div>
      {game.proposals.length === 0 && <p className="hint">No proposals waiting for your answer.</p>}
      {game.proposals.map((p) => (
        <div key={p.id} className="proposal" data-testid="proposal">
          <div>
            <strong style={{ color: nationHex(p.from) }}>{nationName(world, p.from)}</strong> —{' '}
            {PROPOSAL_LABELS[p.type]}
            <div className="dim">{p.text}</div>
          </div>
          <div className="proposal-actions">
            <button className="btn small primary" onClick={() => respond(p.id, true)}>
              Accept
            </button>
            <button className="btn small ghost" onClick={() => respond(p.id, false)}>
              Decline
            </button>
          </div>
        </div>
      ))}
      <div className="section-title" style={{ marginTop: 16 }}>
        World order
      </div>
      <div className="row between">
        <p className="hint" style={{ maxWidth: 620 }}>
          A World Order Resolution passes if nations holding 60% of world GDP (excluding you) have
          relations ≥ 15 with you and no P5 member with relations below −30 vetoes. Passing it with
          a bloc holding 45% of world output is a Diplomatic Victory.
        </p>
        <button
          className="btn"
          disabled={!resolutionOk || game.resolutionPassed}
          onClick={() => act('resolution')}
          data-tip={
            game.resolutionPassed
              ? 'Already adopted.'
              : resolutionOk
                ? 'Call the vote (costs 0.2% of GDP).'
                : 'You need at least two defence partners to table a resolution.'
          }
          data-testid="act-resolution"
        >
          {game.resolutionPassed ? 'Resolution adopted' : 'Table resolution'}
        </button>
      </div>
    </Modal>
  );
}
