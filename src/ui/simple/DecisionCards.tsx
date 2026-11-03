/** Decision Cards (D-086): the month's big choices, each with two or three plain-English buttons. */
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Handshake, Swords, ShieldAlert, Coins, Ban, Users, Landmark, Scale } from 'lucide-react';
import { useGameStore } from '../../state/gameStore';
import { useUiStore } from '../../state/uiStore';
import { dispatch } from '../../state/simBridge';
import { loadWorld } from '../../sim/world';
import { decisionCards, type CardKind, type DecisionCard } from '../../sim/simple';
import { flagEmoji } from '../flags';
import { playSound } from '../audio';

const world = loadWorld();

const KIND: Record<CardKind, { label: string; Icon: typeof Swords }> = {
  crisis: { label: 'Crisis', Icon: AlertTriangle },
  deal: { label: 'Offer', Icon: Handshake },
  war: { label: 'War', Icon: Swords },
  threat: { label: 'Threat', Icon: ShieldAlert },
  money: { label: 'Money', Icon: Coins },
  sanctions: { label: 'Sanctions', Icon: Ban },
  alliance: { label: 'Alliance', Icon: Users },
  bloc: { label: 'Alliance', Icon: Landmark },
  spending: { label: 'Budget', Icon: Scale },
};

export function DecisionCards() {
  const game = useGameStore((s) => s.game);
  const busy = useGameStore((s) => s.busy);
  if (!game) return null;
  const cards = decisionCards(world, game);
  return (
    <aside className="s-cards" data-testid="decision-cards" aria-label="Decisions this month">
      <div className="s-cards-head">
        {cards.length > 0 ? (
          <>
            <span className="s-cards-title">Your decisions</span>
            <span className="s-cards-sub">Choose one button on each card.</span>
          </>
        ) : (
          <>
            <span className="s-cards-title">All decided</span>
            <span className="s-cards-sub">Nothing else needs you this month. Press End Turn.</span>
          </>
        )}
      </div>
      <AnimatePresence initial={false}>
        {cards.map((c) => (
          <Card key={c.id} card={c} disabled={busy} />
        ))}
      </AnimatePresence>
    </aside>
  );
}

function Card({ card, disabled }: { card: DecisionCard; disabled: boolean }) {
  const { label, Icon } = KIND[card.kind];
  const meta = card.nation ? world.nations.get(card.nation) : undefined;
  const flyThere = () => {
    if (!card.nation) return;
    const cap = world.capitalRegion.get(card.nation);
    const r = cap !== undefined ? world.regions.get(cap) : undefined;
    if (r) {
      useUiStore.getState().fly(r.lat, r.lon, 1.9);
      useUiStore.getState().select(r.id);
    }
  };
  return (
    <motion.div
      className={`s-card kind-${card.kind}`}
      data-testid="decision-card"
      data-card={card.id}
      layout
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24, transition: { duration: 0.15 } }}
      transition={{ duration: 0.2 }}
    >
      <div className="s-card-kicker">
        <Icon size={14} aria-hidden="true" />
        {label}
        {meta && (
          <button className="s-card-where" onClick={flyThere} data-tip={`Show ${meta.name} on the map`}>
            {flagEmoji(meta.iso2)} {meta.name}
          </button>
        )}
      </div>
      <h3 className="s-card-title">{card.title}</h3>
      <p className="s-card-text">{card.text}</p>
      <div className="s-card-options">
        {card.options.map((o, i) => (
          <button
            key={i}
            className={`s-option tone-${o.tone}`}
            disabled={disabled}
            onClick={() => {
              playSound(o.tone === 'risky' ? 'alert' : 'accept');
              dispatch({ type: 'decide', card: card.id, option: i });
            }}
            data-testid={`card-option-${i}`}
            data-tip={o.sensible ? 'Your advisers think this is a reasonable choice.' : 'Your advisers warn against this.'}
          >
            <span className="s-option-label">{o.label}</span>
            <span className="s-option-effect">{o.effect}</span>
          </button>
        ))}
      </div>
    </motion.div>
  );
}
