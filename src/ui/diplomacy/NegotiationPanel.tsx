/** Negotiation screen (D-071): build a deal from items; the AI's verdict updates live. */
import { useMemo, useState } from 'react';
import type { Deal, DealItem, GameState, Iso3, TreatyType } from '../../sim/types';
import { loadWorld, nationName } from '../../sim/world';
import { DEAL_ITEM_LABELS, evaluateDeal, itemLabel, itemProblem } from '../../sim/deals';
import { dispatch } from '../../state/simBridge';
import { Stat } from '../Stat';
import { playSound } from '../audio';
import { nationHex } from '../../render/palette';

const world = loadWorld();

type Kind = DealItem['kind'];
const KINDS: { kind: Kind; tip: string }[] = [
  { kind: 'money', tip: 'A one-off payment from the treasury, US$ bn.' },
  { kind: 'region', tip: 'Transfer a region: your own, or theirs that you occupy (and vice versa).' },
  { kind: 'basing', tip: 'Basing rights: the guest’s forces may move through and draw supply in the host’s territory.' },
  { kind: 'tech', tip: 'Share the most advanced technology the other side can use.' },
  { kind: 'liftSanctions', tip: 'Lift sanctions, embargo and secondary sanctions on the other side.' },
  { kind: 'arms', tip: 'Deliver mechanised brigades (they arrive through the buyer’s production queue next month).' },
  { kind: 'joinWar', tip: 'Declare war on a third nation (or join an existing war against it).' },
  { kind: 'treaty', tip: 'Sign a treaty: trade agreement, non-aggression pact, defensive pact or alliance.' },
];
const TREATIES: TreatyType[] = ['trade', 'nap', 'defensive', 'alliance'];

function ItemEditor({
  game,
  giver,
  receiver,
  onAdd,
}: {
  game: GameState;
  giver: Iso3;
  receiver: Iso3;
  onAdd: (item: DealItem) => void;
}) {
  const [kind, setKind] = useState<Kind>('money');
  const [amount, setAmount] = useState(10);
  const [region, setRegion] = useState<number | null>(null);
  const [units, setUnits] = useState(2);
  const [against, setAgainst] = useState<Iso3>('');
  const [treaty, setTreaty] = useState<TreatyType>('trade');
  const regions = useMemo(
    () =>
      Object.values(game.regions)
        .filter((r) => r.controller === giver && (r.owner === giver || r.owner === receiver) && world.regions.get(r.id) && !world.regions.get(r.id)!.sea)
        .map((r) => r.id)
        .sort((a, b) => (world.regions.get(a)!.name < world.regions.get(b)!.name ? -1 : 1)),
    [game, giver, receiver],
  );
  const others = useMemo(
    () =>
      world.nationList
        .filter((n) => n.iso3 !== giver && n.iso3 !== receiver && game.nations[n.iso3]?.alive)
        .sort((a, b) => Number(b.major) - Number(a.major) || a.name.localeCompare(b.name)),
    [game, giver, receiver],
  );
  const build = (): DealItem | null => {
    switch (kind) {
      case 'money':
        return { kind, amount: Math.max(1, Math.round(amount)) };
      case 'region': {
        const id = region ?? regions[0];
        return id === undefined ? null : { kind, region: id };
      }
      case 'arms':
        return { kind, units: Math.max(1, Math.min(10, Math.round(units))) };
      case 'joinWar': {
        const x = against || others[0]?.iso3;
        return x ? { kind, against: x } : null;
      }
      case 'treaty':
        return { kind, treaty };
      default:
        return { kind } as DealItem;
    }
  };
  const draft = build();
  const problem = draft ? itemProblem(world, game, draft, giver, receiver) : 'Nothing to add.';
  return (
    <div className="deal-editor">
      <select className="input small" value={kind} onChange={(e) => setKind(e.target.value as Kind)} data-testid={`deal-kind-${giver}`}>
        {KINDS.map((k) => (
          <option key={k.kind} value={k.kind}>
            {DEAL_ITEM_LABELS[k.kind]}
          </option>
        ))}
      </select>
      {kind === 'money' && (
        <input className="input small" type="number" min={1} value={amount} onChange={(e) => setAmount(Number(e.target.value))} data-tip="US$ bn, paid once." />
      )}
      {kind === 'region' && (
        <select className="input small" value={region ?? regions[0] ?? ''} onChange={(e) => setRegion(Number(e.target.value))}>
          {regions.map((id) => (
            <option key={id} value={id}>
              {world.regions.get(id)!.name}
              {game.regions[id]!.owner !== giver ? ' (occupied)' : ''}
            </option>
          ))}
        </select>
      )}
      {kind === 'arms' && (
        <input className="input small" type="number" min={1} max={10} value={units} onChange={(e) => setUnits(Number(e.target.value))} data-tip="Mechanised brigades, 1–10." />
      )}
      {kind === 'joinWar' && (
        <select className="input small" value={against || others[0]?.iso3} onChange={(e) => setAgainst(e.target.value)}>
          {others.map((n) => (
            <option key={n.iso3} value={n.iso3}>
              {n.name}
            </option>
          ))}
        </select>
      )}
      {kind === 'treaty' && (
        <select className="input small" value={treaty} onChange={(e) => setTreaty(e.target.value as TreatyType)}>
          {TREATIES.map((t) => (
            <option key={t} value={t}>
              {t === 'nap' ? 'non-aggression pact' : t === 'defensive' ? 'defensive pact' : t === 'trade' ? 'trade agreement' : 'alliance'}
            </option>
          ))}
        </select>
      )}
      <button
        className="btn small"
        disabled={!draft || !!problem}
        data-tip={problem ?? KINDS.find((k) => k.kind === kind)!.tip}
        onClick={() => draft && onAdd(draft)}
        data-testid={`deal-add-${giver}`}
      >
        Add
      </button>
    </div>
  );
}

function ItemList({ game, items, giver, receiver, onRemove }: { game: GameState; items: readonly DealItem[]; giver: Iso3; receiver: Iso3; onRemove: (i: number) => void }) {
  if (items.length === 0) return <p className="hint">Nothing yet.</p>;
  return (
    <ul className="deal-items">
      {items.map((item, i) => {
        const problem = itemProblem(world, game, item, giver, receiver);
        return (
          <li key={i} className={problem ? 'bad' : ''} data-tip={problem ?? undefined}>
            <span>{itemLabel(world, game, item, giver, receiver)}</span>
            <button className="btn small ghost" onClick={() => onRemove(i)} data-tip="Remove this item.">
              ✕
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function NegotiationPanel({ game, partner }: { game: GameState; partner: Iso3 }) {
  const me = game.player;
  const [give, setGive] = useState<DealItem[]>([]);
  const [get, setGet] = useState<DealItem[]>([]);
  const [reply, setReply] = useState<string | null>(null);
  const deal: Deal = { from: me, to: partner, give, get };
  const verdict = useMemo(() => evaluateDeal(world, game, deal), [game, give, get, partner]); // eslint-disable-line react-hooks/exhaustive-deps
  const empty = give.length + get.length === 0;
  const pct = Math.round(verdict.likelihood * 100);
  const leader = game.nations[partner]?.leaderName ?? nationName(world, partner);
  const propose = (d: Deal) => {
    const v = evaluateDeal(world, game, d);
    dispatch({ type: 'proposeDeal', deal: d });
    setReply(v.reason);
    playSound(v.verdict === 'accept' ? 'accept' : 'reject');
    if (v.verdict === 'accept') {
      setGive([]);
      setGet([]);
    }
  };
  return (
    <div className="negotiation" data-testid="negotiation">
      <div className="deal-columns">
        <div className="deal-col">
          <div className="section-title">You offer</div>
          <ItemList game={game} items={give} giver={me} receiver={partner} onRemove={(i) => setGive(give.filter((_, j) => j !== i))} />
          <ItemEditor game={game} giver={me} receiver={partner} onAdd={(item) => setGive([...give, item])} />
        </div>
        <div className="deal-col">
          <div className="section-title">You ask of {nationName(world, partner)}</div>
          <ItemList game={game} items={get} giver={partner} receiver={me} onRemove={(i) => setGet(get.filter((_, j) => j !== i))} />
          <ItemEditor game={game} giver={partner} receiver={me} onAdd={(item) => setGet([...get, item])} />
        </div>
      </div>
      {!empty && (
        <div className="deal-verdict" data-testid="deal-verdict">
          <div className="row between">
            <span className={`chip ${verdict.verdict === 'accept' ? 'ok' : verdict.verdict === 'counter' ? 'active' : 'enemy'}`}>
              {verdict.verdict === 'accept' ? 'Likely to accept' : verdict.verdict === 'counter' ? 'Will counter-offer' : 'Will reject'}
            </span>
            <Stat
              label="Acceptance"
              value={`${pct}%`}
              tooltip={`How likely ${leader} is to say yes, from the net value of the package to ${nationName(world, partner)} (${Number.isFinite(verdict.score) ? `${verdict.score.toFixed(1)} bn-equivalent` : 'a hard refusal'}). Above 50 % the deal is accepted; the AI decides by the same numbers you see.`}
              accent={pct >= 50 ? '#4ade80' : pct >= 25 ? '#fbbf24' : '#f87171'}
            />
          </div>
          <div className="likelihood-bar" data-tip={`Acceptance likelihood ${pct}%. The marker shows the 50 % line.`}>
            <span className="likelihood-fill" style={{ width: `${pct}%`, background: pct >= 50 ? 'var(--good)' : pct >= 25 ? 'var(--warn)' : 'var(--bad)' }} />
            <span className="likelihood-mark" />
          </div>
          <p className="deal-reason">{verdict.reason}</p>
          <div className="deal-lines">
            {verdict.lines.map((l, i) => (
              <div key={i} className="deal-line">
                <span>{l.label}</span>
                <Stat
                  value={`${l.value >= 0 ? '+' : '−'}${Math.abs(l.value).toFixed(1)}`}
                  tooltip={`Value of this line to ${nationName(world, partner)} in US$ bn-equivalent, weighted by ${leader}'s traits, agenda and memory.`}
                  accent={l.value >= 0 ? '#4ade80' : '#f87171'}
                  inline
                />
              </div>
            ))}
          </div>
          <div className="row">
            <button className="btn primary" onClick={() => propose(deal)} data-testid="deal-propose" style={{ borderColor: nationHex(partner) }}>
              Propose deal
            </button>
            {verdict.counter && (
              <button
                className="btn"
                data-testid="deal-accept-counter"
                data-tip="Accept their terms: the counter-offer is sent as your new proposal."
                onClick={() => {
                  setGive([...verdict.counter!.give]);
                  setGet([...verdict.counter!.get]);
                  propose(verdict.counter!);
                }}
              >
                Accept counter-offer
              </button>
            )}
          </div>
        </div>
      )}
      {reply && (
        <div className="reply" data-testid="deal-reply">
          {reply}
        </div>
      )}
    </div>
  );
}
