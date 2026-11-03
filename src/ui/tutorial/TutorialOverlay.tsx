import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, MousePointerClick, X } from 'lucide-react';
import { useGameStore } from '../../state/gameStore';
import { useUiStore } from '../../state/uiStore';
import { Portrait } from '../Portrait';
import { ADVISOR, SIMPLE_TUTORIAL_STEPS, TUTORIAL_STEPS as FULL_STEPS, type TutorialContext } from './steps';
import { playSound } from '../audio';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const CARD_W = 360;

/** Spotlight + chief-of-staff card for the tutorial (D-080). */
export function TutorialOverlay() {
  const tut = useUiStore((s) => s.tutorial);
  const setTutorial = useUiStore((s) => s.setTutorial);
  const scale = useUiStore((s) => s.prefs.uiScale);
  const modal = useUiStore((s) => s.modal);
  const mapMode = useUiStore((s) => s.mapMode);
  const selectedRegion = useUiStore((s) => s.selectedRegion);
  const game = useGameStore((s) => s.game);
  const [box, setBox] = useState<Box | null>(null);
  // Simple mode has its own five-step tutorial (D-086).
  const simple = game?.mode === 'simple';
  const TUTORIAL_STEPS = simple ? SIMPLE_TUTORIAL_STEPS : FULL_STEPS;
  const step = tut.active ? TUTORIAL_STEPS[tut.step] : undefined;

  // Measure the target (it may move, open or close) a few times a second.
  useEffect(() => {
    if (!step?.target) return;
    const measure = () => {
      const el = document.querySelector<HTMLElement>(`[data-testid="${step.target}"]`);
      if (!el || el.offsetParent === null) {
        setBox((b) => (b === null ? b : null));
        return;
      }
      const r = el.getBoundingClientRect();
      const next = { x: r.left / scale - 6, y: r.top / scale - 6, w: r.width / scale + 12, h: r.height / scale + 12 };
      setBox((b) => (b && Math.abs(b.x - next.x) < 0.5 && Math.abs(b.y - next.y) < 0.5 && Math.abs(b.w - next.w) < 0.5 && Math.abs(b.h - next.h) < 0.5 ? b : next));
    };
    const first = window.requestAnimationFrame(measure);
    const t = window.setInterval(measure, 250);
    window.addEventListener('resize', measure);
    return () => {
      window.cancelAnimationFrame(first);
      window.clearInterval(t);
      window.removeEventListener('resize', measure);
      setBox(null);
    };
  }, [step?.target, scale]);

  // Steps with a task complete themselves.
  useEffect(() => {
    if (!step?.done || !game) return;
    const ctx: TutorialContext = { game, modal, mapMode, selectedRegion, stepTurn: tut.startedTurn };
    if (step.done(ctx)) {
      playSound('accept');
      setTutorial({ step: tut.step + 1, startedTurn: game.turn });
    }
  }, [step, game, modal, mapMode, selectedRegion, tut.step, tut.startedTurn, setTutorial]);

  // Past the last step: done for good.
  useEffect(() => {
    if (tut.active && tut.step >= TUTORIAL_STEPS.length) {
      setTutorial({ active: false, step: 0 });
      useUiStore.getState().setPrefs({ tutorialDone: true });
    }
  }, [tut.active, tut.step, setTutorial, TUTORIAL_STEPS.length]);

  if (!step || !game) return null;
  // A decision (event) takes precedence: the tutorial waits beside it (Simple mode shows events as cards).
  if (game.pendingEvents.length > 0 && !modal && !simple)
    return (
      <div className="tutorial-layer" data-testid="tutorial">
        <div className="tutorial-pill" data-testid="tutorial-paused">
          <Portrait iso3="HQ" accent="#e8b04a" name={ADVISOR.name} military size={26} />
          <span>A decision needs you first — every choice lists its effects. The briefing continues afterwards.</span>
        </div>
      </div>
    );
  const finish = () => {
    setTutorial({ active: false, step: 0 });
    useUiStore.getState().setPrefs({ tutorialDone: true });
    playSound('close');
  };
  const go = (d: number) => {
    playSound('click');
    setTutorial({ step: Math.max(0, tut.step + d), startedTurn: game.turn });
  };
  const vw = window.innerWidth / scale;
  const vh = window.innerHeight / scale;
  // Card placement: beside the target if it fits, else below/above, else in a corner.
  let left = (vw - CARD_W) / 2;
  let top = vh / 2 - 130;
  if (box) {
    const big = box.w * box.h > vw * vh * 0.25;
    if (big) {
      left = Math.max(16, box.x + box.w - CARD_W - 20);
      top = Math.max(16, box.y + box.h - 300);
    } else if (box.y + box.h + 280 < vh) {
      left = box.x + box.w / 2 - CARD_W / 2;
      top = box.y + box.h + 14;
    } else if (box.y - 280 > 0) {
      left = box.x + box.w / 2 - CARD_W / 2;
      top = box.y - 280;
    } else if (box.x > CARD_W + 30) {
      left = box.x - CARD_W - 14;
      top = box.y;
    } else {
      left = box.x + box.w + 14;
      top = box.y;
    }
  }
  left = Math.max(12, Math.min(vw - CARD_W - 12, left));
  top = Math.max(64, Math.min(vh - 300, top));
  const turnSteps = TUTORIAL_STEPS.filter((s) => s.turn === step.turn);
  const indexInTurn = turnSteps.indexOf(step) + 1;
  return (
    <div className="tutorial-layer" data-testid="tutorial">
      {box ? (
        <div className="tutorial-spot" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />
      ) : (
        <div className="tutorial-dim" />
      )}
      <AnimatePresence mode="wait">
        <motion.div
          key={step.id}
          className="tutorial-card"
          style={{ left, top, width: CARD_W }}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
          data-testid={`tutorial-step-${step.id}`}
          role="dialog"
          aria-label={`Tutorial: ${step.title}`}
        >
          <div className="tutorial-head">
            <Portrait iso3="HQ" accent="#e8b04a" name={ADVISOR.name} military size={44} />
            <div className="tutorial-who">
              <div className="tutorial-name">
                {ADVISOR.name} <span className="chip tiny">fictional</span>
              </div>
              <div className="tutorial-role">
                {simple ? `${ADVISOR.title} · Step ${tut.step + 1} of ${TUTORIAL_STEPS.length}` : `${ADVISOR.title} · Month ${step.turn + 1} of 5 · ${indexInTurn}/${turnSteps.length}`}
              </div>
            </div>
            <button className="icon-btn" onClick={finish} data-tip="End the tutorial (H replays it)" data-testid="tutorial-close" aria-label="End the tutorial">
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          <h3>{step.title}</h3>
          <p>{step.body}</p>
          {step.task && (
            <div className="tutorial-task">
              <MousePointerClick size={16} aria-hidden="true" />
              <span>{step.task}</span>
            </div>
          )}
          <div className="tutorial-progress">
            <div className="tutorial-bar" style={{ width: `${((tut.step + 1) / TUTORIAL_STEPS.length) * 100}%` }} />
          </div>
          <div className="tutorial-actions">
            <button className="btn small ghost" onClick={() => go(-1)} disabled={tut.step === 0} data-testid="tutorial-back">
              <ChevronLeft size={14} aria-hidden="true" /> Back
            </button>
            {tut.step === TUTORIAL_STEPS.length - 1 ? (
              <button className="btn small primary" onClick={finish} data-testid="tutorial-finish">
                Finish
              </button>
            ) : (
              <button className={`btn small ${step.task ? 'ghost' : 'primary'}`} onClick={() => go(1)} data-testid="tutorial-next">
                {step.task ? 'Skip step' : 'Next'} <ChevronRight size={14} aria-hidden="true" />
              </button>
            )}
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
