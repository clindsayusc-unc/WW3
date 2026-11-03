import { useState } from 'react';
import { Modal } from '../Modal';
import { ScreenIcon } from '../icons';
import { useGameStore } from '../../state/gameStore';
import { useUiStore } from '../../state/uiStore';
import { dispatch } from '../../state/simBridge';
import { loadWorld } from '../../sim/world';
import { unitCost, buildMonths, unitUpkeep } from '../../sim/economy';
import { unitLockReason } from '../../sim/research';
import { Stat } from '../Stat';
import { formatMoney } from '../format';
import { playSound } from '../audio';

const world = loadWorld();

export function ProductionModal() {
  const game = useGameStore((s) => s.game);
  const selected = useUiStore((s) => s.selectedRegion);
  const [region, setRegion] = useState<number | null>(null);
  if (!game) return null;
  const me = game.nations[game.player]!;
  const owned = Object.values(game.regions)
    .filter((r) => r.controller === game.player)
    .map((r) => world.regions.get(r.id)!)
    .sort((a, b) => b.populationShare - a.populationShare);
  const cap = world.capitalRegion.get(game.player)!;
  const target =
    region ?? (selected && game.regions[selected]?.controller === game.player ? selected : cap);
  const targetMeta = world.regions.get(target);
  const upkeep = unitUpkeep(world, game, game.player);
  const queue = (type: string) => {
    dispatch({ type: 'queueProduction', unitType: type, region: target });
    playSound('order');
  };
  return (
    <Modal icon={<ScreenIcon id="production" />}
      title="Production"
      subtitle={`Treasury ${formatMoney(me.treasury)}. Units are placed in the chosen region; naval units appear in its adjacent sea zone.`}
      wide
      testId="modal-production"
      footer={
        <>
          <Stat
            label="Upkeep"
            value={formatMoney(upkeep)}
            tooltip="Current monthly upkeep of all your formations."
          />
          <Stat
            label="Military budget"
            value={formatMoney(me.finances.military)}
            tooltip="Monthly military allocation. If upkeep exceeds it, morale suffers."
          />
          <Stat
            label="Mobilisation"
            value={['Peace', 'Partial', 'Total'][me.mobilization]}
            tooltip="Partial: −20% cost. Total: −38% cost and +30% build speed."
          />
        </>
      }
    >
      <div className="production-layout">
        <div>
          <div className="section-title">Deploy to</div>
          <select
            value={target}
            onChange={(e) => setRegion(Number(e.target.value))}
            className="select"
            data-testid="production-region"
          >
            {owned.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.capital ? ' ★' : ''}
                {r.coastal ? ' ⚓' : ''}
              </option>
            ))}
          </select>
          <div className="section-title" style={{ marginTop: 14 }}>
            Queue ({me.production.length})
          </div>
          {me.production.length === 0 && <p className="hint">Nothing in production.</p>}
          {me.production.map((p) => (
            <div key={p.id} className="queue-row">
              <span>{world.unitTypes.get(p.type)?.name ?? p.type}</span>
              <span className="dim">{world.regions.get(p.region)?.name}</span>
              <Stat
                value={`${p.monthsLeft} mo`}
                tooltip="Months until this formation is ready."
                inline
              />
              <button
                className="icon-btn"
                onClick={() => dispatch({ type: 'cancelProduction', id: p.id })}
                data-tip="Cancel (50% refund)"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <div className="unit-grid">
          {world.unitTypeList.map((t) => {
            const cost = unitCost(world, game, game.player, t.id);
            const months = buildMonths(world, game, game.player, t.id);
            const navalOk = t.domain !== 'sea' || (targetMeta?.coastal ?? false);
            const locked = unitLockReason(world, game, game.player, t.id);
            const canAfford = me.treasury >= cost && navalOk && !locked;
            return (
              <div key={t.id} className={`unit-card ${t.domain} ${locked ? 'locked' : ''}`} data-testid={`unit-card-${t.id}`}>
                <div className="unit-card-head">
                  <span className="unit-name">{t.name}</span>
                  <span className="chip tiny">{t.domain}</span>
                  {t.requiresTech && (
                    <span
                      className={`chip tiny ${locked ? '' : 'ok'}`}
                      data-tip={locked ?? `Unlocked by ${world.techs.get(t.requiresTech)?.name ?? t.requiresTech}.`}
                    >
                      {locked ? '🔒 tech' : 'new tech'}
                    </span>
                  )}
                </div>
                <p className="unit-desc">{t.description}</p>
                <div className="unit-stats">
                  <Stat
                    label="Atk"
                    value={`${t.attack}`}
                    tooltip="Base attack value per full-strength formation."
                  />
                  <Stat label="Def" value={`${t.defence}`} tooltip="Base defence value." />
                  <Stat
                    label="AA"
                    value={`${t.antiAir}`}
                    tooltip="Anti-air contribution to air superiority."
                  />
                  <Stat
                    label="Spd"
                    value={`${t.domain === 'air' ? `R${t.range}` : t.speed}`}
                    tooltip={
                      t.domain === 'air'
                        ? 'Range in regions from the base.'
                        : 'Regions (or sea zones) moved per month.'
                    }
                  />
                </div>
                <div className="unit-buy">
                  <Stat
                    value={formatMoney(cost)}
                    tooltip={`Cost adjusted for force quality (×${(me.quality ** 1.5).toFixed(2)}), tech and mobilisation.`}
                    inline
                  />
                  <Stat
                    value={`${months} mo`}
                    tooltip="Build time after tech and mobilisation modifiers."
                    inline
                  />
                  <Stat
                    value={`${formatMoney(t.upkeepBn * me.quality ** 1.5)}/mo`}
                    tooltip="Monthly upkeep once fielded."
                    inline
                  />
                  <button
                    className="btn small primary"
                    disabled={!canAfford}
                    onClick={() => queue(t.id)}
                    data-tip={
                      locked
                        ? locked
                        : !navalOk
                        ? 'Choose a coastal region for naval units.'
                        : me.treasury < cost
                          ? 'Insufficient treasury.'
                          : `Queue one ${t.name}.`
                    }
                    data-testid={`build-${t.id}`}
                  >
                    Build
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
