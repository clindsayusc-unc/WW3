/** Simple mode: click a country, then Attack or Defend (D-086). Odds in words, never numbers. */
import { Swords, Shield, X } from 'lucide-react';
import { useGameStore } from '../../state/gameStore';
import { useUiStore } from '../../state/uiStore';
import { dispatch } from '../../state/simBridge';
import { loadWorld } from '../../sim/world';
import { alliesOf, atWar, getRelation } from '../../sim/query';
import { relationWords, warOdds } from '../../sim/simple';
import { flagEmoji } from '../flags';
import { playSound } from '../audio';

const world = loadWorld();

export function CountryPanel() {
  const game = useGameStore((s) => s.game);
  const busy = useGameStore((s) => s.busy);
  const selected = useUiStore((s) => s.selectedRegion);
  if (!game || selected === null) return null;
  const region = world.regions.get(selected);
  const iso = game.regions[selected]?.controller ?? null;
  const close = () => useUiStore.getState().select(null);
  if (!region || region.sea || !iso) return null;
  const meta = world.nations.get(iso);
  const n = game.nations[iso];
  if (!meta || !n) return null;
  const p = game.player;
  const mine = iso === p;
  const war = atWar(game, p, iso);
  const ally = alliesOf(world, game, p).includes(iso);
  const rel = getRelation(world, game, p, iso);
  const odds = mine ? null : warOdds(world, game, iso);
  const stance = game.simple?.stances[iso];
  const status = mine
    ? 'Your country. Your ministers run it for you.'
    : war
      ? stance === 'attack'
        ? 'At war with us. Our armies are attacking.'
        : stance === 'defend'
          ? 'At war with us. Our armies are holding the line.'
          : 'At war with us.'
      : ally
        ? 'Our ally: we have promised to defend each other.'
        : stance === 'defend'
          ? 'Not at war. Our armies are guarding the border.'
          : 'Not at war with us.';
  const set = (s: 'attack' | 'defend') => {
    playSound(s === 'attack' ? 'alert' : 'click');
    dispatch({ type: 'setStance', target: iso, stance: s });
  };
  return (
    <section className="s-country" data-testid="country-panel" aria-label={meta.name}>
      <header className="s-country-head">
        <span className="s-country-flag">{flagEmoji(meta.iso2)}</span>
        <div className="s-country-who">
          <h3>{meta.name}</h3>
          <div className="s-country-leader">
            {n.leaderTitle} {n.leaderName}
            {n.leaderFictional ? ' (fictional)' : ''}
          </div>
        </div>
        <button className="icon-btn" onClick={close} aria-label="Close" data-tip="Close (Esc)">
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <p className="s-country-status" data-testid="country-status">
        {status}
      </p>
      {!mine && (
        <dl className="s-country-facts">
          <dt>How they see us</dt>
          <dd>{relationWords(rel)}</dd>
          <dt>{war ? 'If we attack' : 'If it came to war'}</dt>
          <dd className={`tone-${odds!.tone}`} data-testid="country-odds">
            {odds!.words}
          </dd>
          {n.warheads > 0 && (
            <>
              <dt>Nuclear weapons</dt>
              <dd className="tone-bad">Yes</dd>
            </>
          )}
        </dl>
      )}
      {!mine && (
        <div className="s-country-actions">
          <button
            className={`btn danger ${stance === 'attack' ? 'on' : ''}`}
            disabled={busy || ally || stance === 'attack'}
            onClick={() => set('attack')}
            data-testid="simple-attack"
            data-tip={
              ally
                ? 'You cannot attack an ally.'
                : war
                  ? 'Order our armies to push into their territory. Generals pick the fronts.'
                  : `Declare war on ${meta.name}. Our armies are sent to the fronts automatically.`
            }
          >
            <Swords size={16} aria-hidden="true" /> Attack
          </button>
          <button
            className={`btn ${stance === 'defend' ? 'primary' : ''}`}
            disabled={busy || ally || stance === 'defend'}
            onClick={() => set('defend')}
            data-testid="simple-defend"
            data-tip={war ? 'Hold what we have and take back our own land; no invasion.' : `Move armies to guard our border with ${meta.name}. This does not start a war.`}
          >
            <Shield size={16} aria-hidden="true" /> Defend
          </button>
        </div>
      )}
    </section>
  );
}
