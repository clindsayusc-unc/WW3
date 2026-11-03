import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { dispatch, setDispatchGate } from '../../state/simBridge';
import { useGameStore } from '../../state/gameStore';
import { useUiStore } from '../../state/uiStore';
import { loadWorld } from '../../sim/world';
import type { Command } from '../../sim/types';
import { confirmText, type ConfirmText } from '../confirmText';
import { playSound } from '../audio';

const world = loadWorld();

/** Holds irreversible commands until the player confirms them (D-080). */
export function ConfirmDialog() {
  const [pending, setPending] = useState<{ command: Command; text: ConfirmText } | null>(null);
  useEffect(() => {
    setDispatchGate((command) => {
      const game = useGameStore.getState().game;
      if (!game || !useUiStore.getState().prefs.confirmIrreversible) return false;
      const text = confirmText(world, game, command);
      if (!text) return false;
      setPending({ command, text });
      playSound('alert');
      return true;
    });
    return () => setDispatchGate(null);
  }, []);
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setPending(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pending]);
  const Icon = pending?.text.danger ? ShieldAlert : AlertTriangle;
  return (
    <AnimatePresence>
      {pending && (
        <motion.div className="confirm-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
          <motion.div
            className={`confirm-card ${pending.text.danger ? 'danger' : ''}`}
            role="alertdialog"
            aria-modal="true"
            aria-label={pending.text.title}
            data-testid="confirm-dialog"
            initial={{ y: 12, scale: 0.97, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 6, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <div className="confirm-head">
              <Icon size={20} aria-hidden="true" />
              <h3>{pending.text.title}</h3>
            </div>
            <p>{pending.text.body}</p>
            <p className="hint">This action cannot be undone. You can turn these confirmations off in Settings → Accessibility.</p>
            <div className="confirm-actions">
              <button className="btn" onClick={() => setPending(null)} data-testid="confirm-cancel" autoFocus>
                Cancel
              </button>
              <button
                className={`btn ${pending.text.danger ? 'danger' : 'primary'}`}
                onClick={() => {
                  dispatch(pending.command, { confirmed: true });
                  setPending(null);
                }}
                data-testid="confirm-ok"
              >
                {pending.text.confirm}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
