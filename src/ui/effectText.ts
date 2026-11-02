/** Plain-language trade-offs of an event choice (D-074): one chip per effect, coloured for the player. */
import type { Effect, World } from '../sim/world';
import { nationName } from '../sim/world';
import type { GameState, Iso3 } from '../sim/types';

export interface EffectChip {
  readonly text: string;
  readonly tone: 'good' | 'bad' | 'neutral';
}

const pp = (v: number, unit = '') => `${v > 0 ? '+' : '−'}${Math.abs(v)}${unit}`;

export function describeEffect(world: World, state: GameState, ctx: { player: Iso3; target: Iso3 | null }, e: Effect): EffectChip | null {
  const who = (ref: string | undefined): Iso3 | null => (ref === 'PLAYER' ? ctx.player : ref === 'TARGET' ? ctx.target : ref ?? null);
  const name = (ref: string | undefined) => {
    const iso = who(ref);
    return iso === state.player ? 'you' : iso ? nationName(world, iso) : 'someone';
  };
  const mine = (ref: string | undefined) => who(ref) === state.player;
  const signed = (v: number, ref: string | undefined): EffectChip['tone'] => (mine(ref) ? (v > 0 ? 'good' : 'bad') : 'neutral');
  switch (e.type) {
    case 'relation':
      return { text: `Relations ${name(e.a)}–${name(e.b)} ${pp(e.delta)}`, tone: mine(e.a) || mine(e.b) ? (e.delta > 0 ? 'good' : 'bad') : 'neutral' };
    case 'tension':
      return { text: `World tension ${pp(e.delta)}`, tone: e.delta > 0 ? 'bad' : 'good' };
    case 'flashpoint':
      return { text: `${world.flashpoints.find((f) => f.id === e.id)?.name ?? e.id} tension ${pp(e.delta)}`, tone: e.delta > 0 ? 'bad' : 'good' };
    case 'stability':
      return { text: `Stability (${name(e.nation)}) ${pp(e.delta)}`, tone: signed(e.delta, e.nation) };
    case 'support':
      return { text: `Approval (${name(e.nation)}) ${pp(e.delta)}`, tone: signed(e.delta, e.nation) };
    case 'legitimacy':
      return { text: `Legitimacy (${name(e.nation)}) ${pp(e.delta)}`, tone: signed(e.delta, e.nation) };
    case 'treasury':
      return { text: `Treasury (${name(e.nation)}) ${pp(e.pctGdp, ' % GDP')}`, tone: signed(e.pctGdp, e.nation) };
    case 'gdp':
      return { text: `GDP (${name(e.nation)}) ${pp(e.pct, ' %')}`, tone: signed(e.pct, e.nation) };
    case 'growth':
      return { text: `Growth (${name(e.nation)}) ${pp(e.delta, ' pp')} for ${e.months} mo`, tone: signed(e.delta, e.nation) };
    case 'sanction':
      return { text: `${name(e.from)} sanction${mine(e.from) ? '' : 's'} ${name(e.to)}`, tone: mine(e.to) ? 'bad' : 'neutral' };
    case 'liftSanction':
      return { text: `${name(e.from)} lift${mine(e.from) ? '' : 's'} sanctions on ${name(e.to)}`, tone: mine(e.to) ? 'good' : 'neutral' };
    case 'war':
      return { text: `WAR: ${name(e.a)} attack${mine(e.a) ? '' : 's'} ${name(e.b)}`, tone: 'bad' };
    case 'peace':
      return { text: `Peace between ${name(e.a)} and ${name(e.b)}`, tone: 'good' };
    case 'defcon':
      return { text: `DEFCON (${name(e.nation)}) ${e.delta < 0 ? 'rises' : 'eases'} ${Math.abs(e.delta)} level${Math.abs(e.delta) > 1 ? 's' : ''}`, tone: e.delta < 0 ? 'bad' : 'good' };
    case 'research':
      return { text: `Research (${name(e.nation)}) ${pp(e.points, ' RP')}`, tone: signed(e.points, e.nation) };
    case 'units':
      return { text: `${name(e.nation)} gain${mine(e.nation) ? '' : 's'} ${e.count} ${world.unitTypes.get(e.unitType)?.name ?? e.unitType}`, tone: mine(e.nation) ? 'good' : 'neutral' };
    case 'mobilize':
      return { text: `${name(e.nation)} mobilise${mine(e.nation) ? '' : 's'} (level ${e.level})`, tone: mine(e.nation) ? 'bad' : 'neutral' };
    case 'warheads':
      return { text: `Warheads (${name(e.nation)}) ${pp(e.delta)}`, tone: 'neutral' };
    case 'succession':
      return { text: `${name(e.nation) === 'you' ? 'Your leader' : `${name(e.nation)}'s leader`} leaves office (fictional successor)`, tone: mine(e.nation) ? 'bad' : 'neutral' };
    case 'chain':
      return { text: 'The crisis continues…', tone: 'neutral' };
    case 'news':
      return null;
  }
}
