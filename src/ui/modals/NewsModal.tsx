/** News screen (D-077): the WW3 Wire with category, scope and priority filters; breaking-news banner. */
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Modal } from '../Modal';
import { ScreenIcon } from '../icons';
import { useGameStore } from '../../state/gameStore';
import { useUiStore } from '../../state/uiStore';
import { NEWS_CATEGORIES } from '../../sim/news';
import type { NewsCategory, WireStory } from '../../sim/types';
import { playSound } from '../audio';

const LABEL: Record<NewsCategory, string> = {
  war: 'War',
  nuclear: 'Nuclear',
  diplomacy: 'Diplomacy',
  politics: 'Politics',
  economy: 'Economy',
  security: 'Security',
  disaster: 'Disasters',
  science: 'Science',
};

function StoryCard({ s }: { s: WireStory }) {
  return (
    <article className={`wire-story p${s.priority}`} data-testid="wire-story">
      <div className="wire-meta">
        <span className={`chip tiny ${s.priority === 3 ? 'enemy' : ''}`}>{s.priority === 3 ? 'Breaking' : LABEL[s.category]}</span>
        <span className="dim">{s.dateline}</span>
      </div>
      <h3>{s.headline}</h3>
      <p>{s.body}</p>
    </article>
  );
}

export function NewsModal() {
  const game = useGameStore((s) => s.game);
  const [cat, setCat] = useState<NewsCategory | 'all'>('all');
  const [scope, setScope] = useState<'all' | 'mine' | 'top'>('all');
  const [query, setQuery] = useState('');
  const stories = useMemo(() => {
    if (!game) return [];
    const q = query.trim().toLowerCase();
    return [...game.wire]
      .reverse()
      .filter((s) => cat === 'all' || s.category === cat)
      .filter((s) => (scope === 'mine' ? s.nations.includes(game.player) : scope === 'top' ? s.priority >= 2 : true))
      .filter((s) => !q || s.headline.toLowerCase().includes(q) || s.body.toLowerCase().includes(q));
  }, [game, cat, scope, query]);
  if (!game) return null;
  return (
    <Modal icon={<ScreenIcon id="news" />} title="WW3 Wire" subtitle="Wire stories generated from the month's events. Breaking news also appears as a banner." wide testId="modal-news">
      <div className="news-filters">
        <div className="seg">
          <button className={`seg-btn ${cat === 'all' ? 'active' : ''}`} onClick={() => setCat('all')} data-tip="Every category." data-testid="news-cat-all">
            All
          </button>
          {NEWS_CATEGORIES.map((c) => (
            <button key={c} className={`seg-btn ${cat === c ? 'active' : ''}`} onClick={() => setCat(c)} data-tip={`${LABEL[c]} stories only.`} data-testid={`news-cat-${c}`}>
              {LABEL[c]}
            </button>
          ))}
        </div>
        <div className="row">
          <div className="seg">
            {(
              [
                ['all', 'Everything'],
                ['top', 'Top stories'],
                ['mine', 'About us'],
              ] as const
            ).map(([id, label]) => (
              <button key={id} className={`seg-btn ${scope === id ? 'active' : ''}`} onClick={() => setScope(id)} data-tip="Filter by importance or by stories that involve your nation." data-testid={`news-scope-${id}`}>
                {label}
              </button>
            ))}
          </div>
          <input className="input" placeholder="Search the wire…" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="news-search" />
        </div>
      </div>
      <div className="wire-list" data-testid="wire-list">
        {stories.length === 0 && <p className="hint">No stories match. The wire fills up as months pass.</p>}
        {stories.map((s) => (
          <StoryCard key={s.id} s={s} />
        ))}
      </div>
    </Modal>
  );
}

/** Breaking-news banner for last month's priority-3 stories (dismissable). */
export function BreakingBanner() {
  const game = useGameStore((s) => s.game);
  const seen = useUiStore((s) => s.breakingSeen);
  const setSeen = useUiStore((s) => s.setBreakingSeen);
  const setModal = useUiStore((s) => s.setModal);
  if (!game) return null;
  const latest = game.wire.filter((s) => s.priority === 3 && s.turn >= game.turn - 1 && s.id > seen);
  const top = latest[latest.length - 1];
  if (!top) return null;
  return (
    <motion.div className="breaking-banner" initial={{ y: -40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} data-testid="breaking-banner">
      <span className="breaking-tag">Breaking</span>
      <span className="breaking-text">{top.headline}</span>
      {latest.length > 1 && <span className="dim" data-tip="Other breaking stories this month.">+{latest.length - 1}</span>}
      <button
        className="btn small"
        onClick={() => {
          setSeen(top.id);
          setModal('news');
          playSound('open');
        }}
        data-tip="Open the WW3 Wire (N)."
      >
        Read
      </button>
      <button className="btn small ghost" onClick={() => setSeen(top.id)} data-tip="Dismiss." data-testid="breaking-dismiss">
        ✕
      </button>
    </motion.div>
  );
}
