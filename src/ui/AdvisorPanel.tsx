import { useMemo } from 'react';
import { ChevronDown, ChevronUp, Banknote, Shield, Handshake, ArrowRight } from 'lucide-react';
import { useGameStore } from '../state/gameStore';
import { useUiStore } from '../state/uiStore';
import { loadWorld } from '../sim/world';
import { topAdvice, type Advice, type AdviceCategory } from '../sim/advisor';
import { Portrait } from './Portrait';
import { ADVISOR } from './tutorial/steps';
import { playSound } from './audio';

const world = loadWorld();

const CAT: Record<AdviceCategory, { label: string; Icon: typeof Banknote }> = {
  economy: { label: 'Economy', Icon: Banknote },
  military: { label: 'Military', Icon: Shield },
  diplomacy: { label: 'Diplomacy', Icon: Handshake },
};

/** The chief of staff's three recommendations for this month (D-080). */
export function AdvisorPanel() {
  const game = useGameStore((s) => s.game);
  const open = useUiStore((s) => s.prefs.advisor);
  const setPrefs = useUiStore((s) => s.setPrefs);
  const advice = useMemo(() => (game ? topAdvice(world, game) : []), [game]);
  if (!game) return null;
  const act = (a: Advice) => {
    const ui = useUiStore.getState();
    if (a.nation) ui.setDiplomacyTarget(a.nation);
    if (a.target === 'diplomacy') ui.setDiplomacyTab('nations');
    if (a.region !== undefined) {
      const m = world.regions.get(a.region);
      if (m) {
        ui.fly(m.lat, m.lon, 1.6);
        ui.select(m.id);
      }
    }
    ui.setModal(a.target);
    playSound('open');
  };
  return (
    <section className={`advisor ${open ? 'open' : 'closed'}`} data-testid="advisor" aria-label="Chief of staff's recommendations">
      <button
        className="advisor-head"
        onClick={() => {
          setPrefs({ advisor: !open });
          playSound('click');
        }}
        data-tip={open ? 'Fold the recommendations away (A)' : 'Show the chief of staff’s recommendations (A)'}
        data-testid="advisor-toggle"
      >
        <Portrait iso3="HQ" accent="#e8b04a" name={ADVISOR.name} military size={30} />
        <span className="advisor-who">
          <span className="advisor-name">{ADVISOR.name}</span>
          <span className="advisor-role">
            {ADVISOR.title} · {advice.length} recommendation{advice.length === 1 ? '' : 's'}
          </span>
        </span>
        {open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronUp size={16} aria-hidden="true" />}
      </button>
      {open && (
        <div className="advisor-list">
          {advice.length === 0 && <p className="hint">Nothing pressing this month. Steady as she goes.</p>}
          {advice.map((a, i) => {
            const { Icon, label } = CAT[a.category];
            return (
              <article key={a.id} className={`advice ${a.category} ${a.priority >= 80 ? 'urgent' : ''}`} data-testid={`advice-${i}`}>
                <div className="advice-head">
                  <span className="advice-cat">
                    <Icon size={13} aria-hidden="true" /> {label}
                  </span>
                  <span className="advice-head-right">
                    {a.priority >= 80 && <span className="chip tiny enemy">urgent</span>}
                    <button className="btn small" onClick={() => act(a)} data-testid={`advice-go-${i}`} data-tip={`Open ${a.target === 'escalation' ? 'the escalation ladder' : `the ${a.target} screen`}.`}>
                      Go <ArrowRight size={13} aria-hidden="true" />
                    </button>
                  </span>
                </div>
                <div className="advice-title">{a.title}</div>
                <p className="advice-reason" data-tip={a.reason}>
                  {a.reason}
                </p>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
