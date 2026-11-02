import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { useUiStore } from '../state/uiStore';
import { playSound } from './audio';

interface ModalProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  wide?: boolean;
  testId?: string;
  onClose?: () => void;
  footer?: ReactNode;
}

export function Modal({
  title,
  subtitle,
  children,
  wide = false,
  testId,
  onClose,
  footer,
}: ModalProps) {
  const close = () => {
    playSound('close');
    if (onClose) onClose();
    else useUiStore.getState().setModal(null);
  };
  return (
    <motion.div
      className="modal-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <motion.div
        className={`modal ${wide ? 'modal-wide' : ''}`}
        data-testid={testId}
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        role="dialog"
        aria-label={title}
      >
        <header className="modal-header">
          <div>
            <h2>{title}</h2>
            {subtitle && <p className="modal-subtitle">{subtitle}</p>}
          </div>
          <button className="icon-btn" onClick={close} aria-label="Close" data-testid="modal-close">
            ✕
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </motion.div>
    </motion.div>
  );
}
