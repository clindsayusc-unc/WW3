import { Keyboard } from 'lucide-react';
import { Modal } from '../Modal';
import { SHORTCUTS, type Shortcut } from '../shortcuts';

const GROUPS: Shortcut['group'][] = ['Turn', 'Screens', 'Map', 'Orders', 'Help'];

/** The `?` overlay: every shortcut, grouped (D-080). */
export function ShortcutsModal() {
  return (
    <Modal title="Keyboard shortcuts" subtitle="Press ? at any time to see this list." testId="modal-shortcuts" icon={<Keyboard size={20} />}>
      <div className="shortcut-grid">
        {GROUPS.map((g) => (
          <section key={g} className="shortcut-group">
            <div className="section-title">{g}</div>
            {SHORTCUTS.filter((s) => s.group === g).map((s) => (
              <div key={s.action} className="shortcut-row">
                <span className="shortcut-keys">
                  {s.keys.map((k, i) => (
                    <span key={k}>
                      {i > 0 && <span className="kbd-plus">+</span>}
                      <kbd className="kbd">{k}</kbd>
                    </span>
                  ))}
                </span>
                <span className="shortcut-action">{s.action}</span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Modal>
  );
}
