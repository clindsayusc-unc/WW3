/** Diplomacy panels (D-071): dispatches, blocs, UN Security Council and leader intelligence. */
import { useMemo, useState } from 'react';
import type { BlocId, Dispatch, GameState, Iso3, ResolutionKind, UnVote } from '../../sim/types';
import { loadWorld, nationName, traitsOf, type Traits } from '../../sim/world';
import { factionOf } from '../../sim/succession';
import { dispatch } from '../../state/simBridge';
import { Stat } from '../Stat';
import { Portrait } from '../Portrait';
import { flagEmoji } from '../flags';
import { nationHex } from '../../render/palette';
import { formatMonth } from '../format';
import { dateForTurn } from '../../sim/game';
import { ACTIVE_BLOCS, BLOC_NAMES, cohesionTarget } from '../../sim/blocs';
import { RESOLUTION_LABELS, isPermanent, resolutionProblem, voteOf } from '../../sim/un';
import { agendasOf, memoriesAbout, opinionOf } from '../../sim/personality';
import { aidByDonor, assessAid } from '../../sim/aid';
import { playSound } from '../audio';

const world = loadWorld();

const KIND_LABEL: Record<Dispatch['kind'], string> = {
  threat: 'Threat',
  warning: 'Warning',
  praise: 'Praise',
  request: 'Request',
  offer: 'Offer',
  condemnation: 'Condemnation',
  communique: 'Communiqué',
};
const KIND_CLASS: Record<Dispatch['kind'], string> = {
  threat: 'enemy',
  warning: 'enemy',
  condemnation: 'enemy',
  praise: 'ok',
  request: 'active',
  offer: 'active',
  communique: '',
};

const TRAITS: [keyof Traits, string][] = [
  ['aggression', 'Aggression'],
  ['riskTolerance', 'Risk'],
  ['pragmatism', 'Pragmatism'],
  ['nationalism', 'Nationalism'],
  ['paranoia', 'Paranoia'],
  ['economicPriority', 'Economy'],
  ['allianceLoyalty', 'Loyalty'],
  ['nuclearThreshold', 'Nuclear bar'],
];

const AGENDA_LABEL: Record<string, string> = {
  reunification: 'Reunification',
  territorialRecovery: 'Territorial recovery',
  regionalHegemony: 'Regional hegemony',
  alliancePreservation: 'Alliance preservation',
  regimeSurvival: 'Regime survival',
  nonAlignment: 'Non-alignment',
  transactional: 'Transactional',
  economicDevelopment: 'Economic development',
};

export function DispatchCard({ game, d }: { game: GameState; d: Dispatch }) {
  const meta = world.nations.get(d.from);
  const leader = world.leaders.get(d.from);
  const n = game.nations[d.from];
  // Nations without a researched leader speak as their government (no invented names).
  const name = leader || n?.leaderFictional ? (n?.leaderName ?? leader?.name ?? '') : `Government of ${nationName(world, d.from)}`;
  return (
    <div className="dispatch-card" style={{ ['--accent' as string]: nationHex(d.from) }} data-testid="dispatch">
      <Portrait iso3={d.from} accent={nationHex(d.from)} name={name} role={leader?.role} title={n?.leaderTitle ?? leader?.title} military={n?.leaderFictional && /council|junta|general/i.test(n.leaderTitle)} />
      <div className="dispatch-body">
        <div className="dispatch-head">
          <span className="dispatch-from">
            {meta ? flagEmoji(meta.iso2) : ''} {name}
          </span>
          <span className={`chip tiny ${KIND_CLASS[d.kind]}`}>{KIND_LABEL[d.kind]}</span>
          <span className="dim dispatch-date">{formatMonth(dateForTurn(d.turn))}</span>
        </div>
        <div className="dim dispatch-title">
          {leader || n?.leaderFictional ? `${n?.leaderTitle ?? leader?.title ?? 'Leader'}, ${nationName(world, d.from)}` : 'Official statement'}
          {d.to ? ` → ${nationName(world, d.to)}` : ' — public statement'}
        </div>
        <p className="dispatch-text" data-tip={`Tone: ${d.tone}. The wording follows the leader's traits (aggression, paranoia, pragmatism, nationalism).`}>
          “{d.text}”
        </p>
      </div>
    </div>
  );
}

export function DispatchFeed({ game }: { game: GameState }) {
  const [filter, setFilter] = useState<'all' | 'me' | 'threats'>('all');
  const list = [...game.dispatches]
    .reverse()
    .filter((d) => (filter === 'me' ? d.to === game.player || d.from === game.player : filter === 'threats' ? ['threat', 'warning', 'condemnation'].includes(d.kind) : true));
  return (
    <div className="dispatch-feed" data-testid="dispatch-feed">
      <div className="seg" style={{ marginBottom: 10 }}>
        {(
          [
            ['all', 'All dispatches'],
            ['me', 'Addressed to you'],
            ['threats', 'Threats & warnings'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} className={`seg-btn ${filter === id ? 'active' : ''}`} onClick={() => setFilter(id)} data-tip="Filter the diplomatic wire.">
            {label}
          </button>
        ))}
      </div>
      {list.length === 0 && <p className="hint">No statements yet. Leaders speak when something happens: wars, aid, summits, threats, deals.</p>}
      <div className="dispatch-list">
        {list.map((d) => (
          <DispatchCard key={d.id} game={game} d={d} />
        ))}
      </div>
    </div>
  );
}

export function BlocsPanel({ game }: { game: GameState }) {
  const me = game.player;
  const [confirm, setConfirm] = useState<BlocId | null>(null);
  return (
    <div className="blocs-panel" data-testid="blocs-panel">
      <p className="hint">
        NATO Article 5 and CSTO Article 4: an attack on one member is an attack on all — but each member decides how to respond. Willingness grows with alliance loyalty,
        cohesion, opinion of the victim and proximity; members below it send aid instead of troops. Members leave when relations with the bloc’s leading powers collapse.
      </p>
      <div className="bloc-grid">
        {ACTIVE_BLOCS.map((id) => {
          const b = game.blocs[id];
          if (!b) return null;
          const mine = b.members.includes(me);
          const target = cohesionTarget(world, game, id);
          return (
            <div key={id} className="bloc-card" data-testid={`bloc-${id}`}>
              <div className="row between">
                <strong>{id}</strong>
                <Stat
                  label="Cohesion"
                  value={`${Math.round(b.cohesion)}`}
                  tooltip={`0–100: relations among the largest members, a shared adversary, wars between members, recent departures and transactional leaders. Drifting toward ${Math.round(target)}. Above 45 summits warm relations; below 40 unhappy members may walk out.`}
                  accent={b.cohesion < 40 ? '#f87171' : b.cohesion >= 65 ? '#4ade80' : undefined}
                />
              </div>
              <div className="dim">{BLOC_NAMES[id]}</div>
              <div className="chips" style={{ marginTop: 6 }}>
                {b.members.map((m) => (
                  <span key={m} className={`chip tiny ${m === me ? 'active' : ''}`} data-tip={nationName(world, m)}>
                    {flagEmoji(world.nations.get(m)?.iso2 ?? '')} {m}
                  </span>
                ))}
              </div>
              <div className="row between" style={{ marginTop: 6 }}>
                <Stat label="Members" value={`${b.members.length}`} tooltip="Current members (members can leave)." />
                <Stat label="Next summit" value={formatMonth(dateForTurn(b.nextSummit))} tooltip="Annual summit: relations among the core shift with cohesion, the communiqué names the main threat; NATO presses low spenders; AUKUS shares advanced technology." />
              </div>
              {b.departed.length > 0 && (
                <div className="dim">Left: {b.departed.map((d) => `${nationName(world, d.iso3)} (${formatMonth(dateForTurn(d.turn))})`).join(', ')}</div>
              )}
              {mine &&
                (confirm === id ? (
                  <div className="row">
                    <button
                      className="btn small danger"
                      onClick={() => {
                        dispatch({ type: 'leaveBloc', bloc: id });
                        playSound('reject');
                        setConfirm(null);
                      }}
                      data-testid={`leave-${id}`}
                    >
                      Confirm: leave {id}
                    </button>
                    <button className="btn small ghost" onClick={() => setConfirm(null)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button className="btn small" onClick={() => setConfirm(id)} data-tip="Walk out of the bloc: its defence guarantee ends and its leaders will remember.">
                    Leave {id}…
                  </button>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const VOTE_CLASS: Record<UnVote, string> = { yes: 'ok', no: 'enemy', abstain: '' };

export function UnPanel({ game }: { game: GameState }) {
  const me = game.player;
  const [kind, setKind] = useState<ResolutionKind>('condemnation');
  const [target, setTarget] = useState<Iso3>('');
  const onCouncil = game.un.council.includes(me);
  const targets = useMemo(
    () => world.nationList.filter((n) => n.iso3 !== me && game.nations[n.iso3]?.alive).sort((a, b) => Number(b.major) - Number(a.major) || a.name.localeCompare(b.name)),
    [game, me],
  );
  const t = target || targets[0]?.iso3 || '';
  const problem = t ? resolutionProblem(world, game, me, kind, t) : 'Choose a target.';
  const forecast = t ? game.un.council.map((m) => ({ m, v: m === me ? ({ vote: 'yes', reason: 'You tabled it.' } as const) : voteOf(world, game, m, { kind, sponsor: me, target: t }) })) : [];
  const yes = forecast.filter((f) => f.v.vote === 'yes').length;
  const vetoes = forecast.filter((f) => f.v.vote === 'no' && isPermanent(world, f.m));
  const pending = game.un.resolutions.find((r) => r.status === 'pending');
  return (
    <div className="un-panel" data-testid="un-panel">
      <div className="row between">
        <p className="hint" style={{ maxWidth: 640 }}>
          Fifteen members: five permanent (veto) and ten elected — the real 2027 Council; seats elected for 2028 onward are simulated. Nine votes and no veto adopt a resolution.
          Adopted sanctions bind every member that is not a friend of the target; a ceasefire is accepted by war-weary parties and costs the rest legitimacy; a condemnation costs
          legitimacy and stability.
        </p>
        <Stat
          label="Your legitimacy"
          value={`${Math.round(game.nations[me]!.legitimacy)}`}
          tooltip="International standing, 0–100, drifting back toward 50. Wars of aggression, defied ceasefires and condemnations lower it; honouring alliances and winning votes raise it. It moves AI deal evaluations and UN votes."
        />
      </div>
      <div className="section-title">Council</div>
      <div className="chips">
        {game.un.council.map((m) => (
          <span key={m} className={`chip tiny ${isPermanent(world, m) ? 'active' : ''} ${m === me ? 'ok' : ''}`} data-tip={`${nationName(world, m)}${isPermanent(world, m) ? ' — permanent member with a veto' : ` — elected until ${game.un.electedUntil[m] ?? '?'}`}`}>
            {flagEmoji(world.nations.get(m)?.iso2 ?? '')} {m}
            {isPermanent(world, m) ? ' ★' : ''}
          </span>
        ))}
      </div>
      {pending && (
        <div className="resolution pending" data-testid="un-pending">
          <div className="section-title">Before the Council</div>
          <p>{pending.text}</p>
          {onCouncil && pending.sponsor !== me ? (
            <div className="row">
              {(['yes', 'abstain', 'no'] as UnVote[]).map((v) => (
                <button
                  key={v}
                  className={`btn small ${pending.votes[me] === v ? 'primary' : ''} ${v === 'no' && isPermanent(world, me) ? 'danger' : ''}`}
                  onClick={() => dispatch({ type: 'unVote', resolutionId: pending.id, vote: v })}
                  data-tip={v === 'no' && isPermanent(world, me) ? 'As a permanent member, a no vote is a veto: it kills the resolution and costs you 3 legitimacy.' : `Vote ${v}. The vote is held at the end of the month.`}
                  data-testid={`un-vote-${v}`}
                >
                  {v === 'no' && isPermanent(world, me) ? 'Veto' : v[0]!.toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
          ) : (
            <p className="hint">The vote is held at the end of the month.</p>
          )}
        </div>
      )}
      <div className="section-title">Table a resolution</div>
      {!onCouncil && <p className="hint">You do not sit on the Security Council this year; you can still lobby members through deals and relations.</p>}
      <div className="row wrap">
        <select className="input small" value={kind} onChange={(e) => setKind(e.target.value as ResolutionKind)} data-testid="un-kind">
          {(Object.keys(RESOLUTION_LABELS) as ResolutionKind[]).map((k) => (
            <option key={k} value={k}>
              {RESOLUTION_LABELS[k]}
            </option>
          ))}
        </select>
        <select className="input small" value={t} onChange={(e) => setTarget(e.target.value)} data-testid="un-target">
          {targets.map((n) => (
            <option key={n.iso3} value={n.iso3}>
              {n.name}
            </option>
          ))}
        </select>
        <Stat
          label="Forecast"
          value={`${yes}/15${vetoes.length ? ' · veto' : ''}`}
          tooltip={`Projected yes votes from each member's opinion of you and of the target, the target's legitimacy, bloc solidarity and non-alignment.${vetoes.length ? ` Expected veto: ${vetoes.map((v) => nationName(world, v.m)).join(', ')}.` : ''} Nine and no veto needed.`}
          accent={vetoes.length || yes < 9 ? '#f87171' : '#4ade80'}
        />
        <button
          className="btn"
          disabled={!!problem}
          data-tip={problem ?? 'Table the draft: the Council votes at once.'}
          onClick={() => {
            dispatch({ type: 'unPropose', kind, target: t });
            playSound('open');
          }}
          data-testid="un-table"
        >
          Table resolution
        </button>
      </div>
      {t && (
        <div className="vote-forecast">
          {forecast.map(({ m, v }) => (
            <span key={m} className={`chip tiny ${VOTE_CLASS[v.vote]}`} data-tip={`${nationName(world, m)}: ${v.reason}`}>
              {m} {v.vote}
            </span>
          ))}
        </div>
      )}
      <div className="section-title">Recent resolutions</div>
      {game.un.resolutions.length === 0 && <p className="hint">The Council has not voted yet.</p>}
      {[...game.un.resolutions].reverse().map((r) => (
        <div key={r.id} className="resolution" data-testid="un-resolution">
          <span className={`chip tiny ${r.status === 'adopted' ? 'ok' : r.status === 'pending' ? 'active' : 'enemy'}`}>{r.status}</span> {r.text}
          {r.vetoedBy.length > 0 && <span className="dim"> Vetoed by {r.vetoedBy.map((v) => nationName(world, v)).join(', ')}.</span>}
          <span className="dim"> ({formatMonth(dateForTurn(r.turn))})</span>
        </div>
      ))}
    </div>
  );
}

/** What the player knows about a leader: agenda, memory, war plan, aid. */
export function LeaderIntel({ game, iso }: { game: GameState; iso: Iso3 }) {
  const me = game.player;
  const opinion = opinionOf(world, game, iso, me);
  const memories = memoriesAbout(game, iso, me);
  const plan = game.warPlans[iso];
  const n = game.nations[iso]!;
  const atWarWith = game.wars.find((w) => w.attackers.includes(iso) || w.defenders.includes(iso));
  const enemy = atWarWith ? (atWarWith.attackers.includes(iso) ? atWarWith.defenders[0] : atWarWith.attackers[0]) : null;
  const myAid = game.playerAid[iso] ?? 0;
  const traits = traitsOf(world, iso, game);
  const faction = factionOf(world, iso, n.leaderFaction);
  const donors = aidByDonor(game, iso).slice(0, 5);
  const advice = atWarWith && enemy ? assessAid(world, game, me, iso, enemy, atWarWith) : null;
  return (
    <div className="leader-intel" data-testid="leader-intel">
      <div className="row">
        <Stat
          label="Their opinion of you"
          value={`${Math.round(opinion)}`}
          tooltip="Relations plus everything this leader remembers about you (favours minus grievances). This is what the AI uses to judge your deals and votes."
          accent={opinion < -30 ? '#f87171' : opinion > 30 ? '#4ade80' : undefined}
        />
        <Stat label="Legitimacy" value={`${Math.round(n.legitimacy)}`} tooltip="Their international standing, 0–100 (UN votes, aggression, vetoes). Low legitimacy makes their resolutions fail and their deals harder." />
      </div>
      <div className="section-title">Agenda</div>
      <div className="chips">
        {agendasOf(world, iso).map((a, i) => (
          <span key={i} className="chip" data-tip={`${a.basis}${a.targets.length ? ` Aimed at: ${a.targets.map((x) => nationName(world, x)).join(', ')}.` : ''}${a.sphere.length ? ` Sphere: ${a.sphere.map((x) => nationName(world, x)).join(', ')}.` : ''} Weight ${Math.round(a.weight * 100)} %.`}>
            {AGENDA_LABEL[a.id] ?? a.id}
          </span>
        ))}
      </div>
      <div className="section-title">Personality</div>
      <div className="trait-row" data-testid="leader-traits">
        {TRAITS.map(([k, label]) => (
          <Stat
            key={k}
            label={label}
            value={`${traits[k]}`}
            tooltip={`${label}, 0–100. ${n.leaderFictional ? `Generated for this fictional successor from the ${faction?.name ?? 'governing'} profile (${faction ? faction.traits[k] : '—'}), the national baseline and chance (D-078).` : 'Researched from the leader’s public record (data/leaders.json).'}`}
            inline
          />
        ))}
      </div>
      {faction && (
        <p className="hint" data-tip={faction.url}>
          {n.leaderFictional ? 'Successor from' : 'Governing faction:'} {faction.name} — {faction.position}
        </p>
      )}
      <div className="section-title">What they remember about you</div>
      {memories.length === 0 ? (
        <p className="hint">Nothing notable — yet.</p>
      ) : (
        <div className="chips">
          {memories.map((m, i) => (
            <span key={i} className={`chip tiny ${m.kind === 'favour' ? 'ok' : 'enemy'}`} data-tip={`${m.kind === 'favour' ? 'Favour' : 'Grievance'} of weight ${m.weight.toFixed(1)} (adds ${m.kind === 'favour' ? '+' : '−'}${m.weight.toFixed(1)} to their opinion), from ${formatMonth(dateForTurn(m.turn))}. Fades monthly at a rate set by the leader's pragmatism, paranoia and nationalism.`}>
              {m.kind === 'favour' ? '+' : '−'} {m.reason}
            </span>
          ))}
        </div>
      )}
      {plan && (plan.warned || plan.readiness >= 0.5) && (
        <div className="reply warn" data-testid="war-plan">
          Intelligence: {nationName(world, iso)} is preparing for war against {nationName(world, plan.target)}. {plan.reason}{' '}
          <Stat value={`${Math.round(plan.readiness * 100)}%`} tooltip={`Readiness: estimated force ratio ${plan.odds.toFixed(2)} against the ${plan.threshold.toFixed(2)} its leader needs (risk tolerance and aggression set the bar; nuclear-armed targets raise it). At 100 % an attack becomes possible.`} inline />
        </div>
      )}
      {(atWarWith || donors.length > 0) && <div className="section-title">Foreign aid</div>}
      {donors.length > 0 && (
        <div className="chips">
          {donors.map((f) => (
            <span key={f.donor} className="chip tiny" data-tip={`Last month: $${f.money.toFixed(2)} bn money, $${f.arms.toFixed(2)} bn arms, $${f.munitions.toFixed(2)} bn munitions.`}>
              {flagEmoji(world.nations.get(f.donor)?.iso2 ?? '')} {f.donor} ${(f.money + f.arms + f.munitions).toFixed(1)} bn
            </span>
          ))}
        </div>
      )}
      {atWarWith && enemy && iso !== me && enemy !== me && (
        <div className="row wrap">
          <span className="dim">Your aid programme:</span>
          {[0, 1, 2, 3].map((lvl) => (
            <button
              key={lvl}
              className={`btn small ${myAid === lvl ? 'primary' : ''}`}
              onClick={() => dispatch({ type: 'setAid', recipient: iso, level: lvl })}
              data-tip={lvl === 0 ? 'No aid.' : `${(lvl * 0.1).toFixed(1)} % of your GDP a year (${((game.nations[me]!.gdp * 0.001 * lvl) / 12).toFixed(1)} bn a month): 40 % money, 45 % arms delivered as formations, 15 % munitions (supply and combat bonus).${advice ? ` Your peers' formula would send ${advice.perYear.toFixed(1)} bn a year.` : ''}`}
              data-testid={`aid-${lvl}`}
            >
              {lvl === 0 ? 'None' : `${(lvl * 0.1).toFixed(1)} % GDP`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
