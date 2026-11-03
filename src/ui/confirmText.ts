/**
 * Which commands are irreversible and what the confirmation dialog says about them (D-080).
 * Pure (no React), so it is unit-tested.
 */
import { nationName, type World } from '../sim/world';
import type { Command, GameState } from '../sim/types';
import { alliesOf } from '../sim/query';
import { STRIKE_INFO } from '../sim/strikes';

export interface ConfirmText {
  readonly title: string;
  readonly body: string;
  readonly confirm: string;
  /** Red styling for acts of war. */
  readonly danger: boolean;
}

export function confirmText(world: World, game: GameState, c: Command): ConfirmText | null {
  const name = (iso: string) => nationName(world, iso);
  switch (c.type) {
    case 'propose': {
      const who = name(c.target);
      switch (c.proposal) {
        case 'declareWar': {
          const allies = alliesOf(world, game, c.target).filter((a) => game.nations[a]?.alive).map(name);
          return {
            title: `Declare war on ${who}?`,
            body: `This cannot be undone. ${allies.length ? `${allies.slice(0, 5).join(', ')}${allies.length > 5 ? ` and ${allies.length - 5} more` : ''} may honour their treaties with ${who}. ` : ''}Starting a war costs legitimacy and stability, raises global tension and may bring a UN condemnation.`,
            confirm: 'Declare war',
            danger: true,
          };
        }
        case 'sanction':
          return { title: `Sanction ${who}?`, body: `Trade with ${who} falls and relations drop; ${who} will remember it. Lifting sanctions later does not restore the goodwill.`, confirm: 'Impose sanctions', danger: false };
        case 'embargo':
          return { title: `Total embargo on ${who}?`, body: `All trade with ${who}, food included, stops. Relations −30 and a lasting grievance.`, confirm: 'Impose embargo', danger: false };
        case 'secondarySanctions':
          return { title: `Secondary sanctions on ${who}?`, body: `Third countries must choose between your market and ${who}'s; some will defy you and trade less with you.`, confirm: 'Impose', danger: false };
        case 'demand':
          return { title: `Demand concessions from ${who}?`, body: `A public ultimatum. If ${who} refuses, relations fall and the crisis may escalate.`, confirm: 'Send demand', danger: false };
        default:
          return null;
      }
    }
    case 'missileStrike': {
      const region = world.regions.get(c.region)?.name ?? 'the target';
      return {
        title: `Launch a ${c.hypersonic ? 'hypersonic' : 'missile'} strike on ${region}?`,
        body: `${STRIKE_INFO[c.kind].description} The salvo is spent whatever the defences intercept, and the strike raises tension and hardens the enemy.`,
        confirm: 'Launch',
        danger: true,
      };
    }
    case 'cyberOp':
      return { title: `Cyber operation against ${name(c.target)}?`, body: 'It may fail, and if it is attributed relations fall by 12. Your teams then need three months to rebuild access.', confirm: 'Launch operation', danger: false };
    case 'asat':
      return { title: `Destroy ${name(c.target)}'s satellites?`, body: 'An anti-satellite strike leaves debris that threatens every constellation, including yours, for years. Relations with every nation fall.', confirm: 'Fire ASAT', danger: true };
    case 'stealTech':
      return { title: `Steal ${world.techs.get(c.tech)?.name ?? 'technology'} from ${name(c.target)}?`, body: 'If the operation is exposed: relations −15, legitimacy −2, and their allies think less of you. Your services then lie low for four months.', confirm: 'Run the operation', danger: false };
    case 'leaveBloc':
      return { title: `Leave ${c.bloc}?`, body: `You lose the protection of ${c.bloc}'s members, and walking out of a treaty costs legitimacy. Rejoining is not possible.`, confirm: `Leave ${c.bloc}`, danger: true };
    case 'chokepoint':
      if (c.action === 'close' || c.action === 'mine')
        return { title: `${c.action === 'close' ? 'Close' : 'Mine'} ${world.chokepoints.find((k) => k.id === c.id)?.name ?? 'the strait'}?`, body: 'Shipping through it stops for everyone: oil prices rise, trade reroutes and neutral nations take offence.', confirm: c.action === 'close' ? 'Close it' : 'Lay mines', danger: true };
      return null;
    case 'techControls':
      return c.on ? { title: `Export controls on ${name(c.target)}?`, body: `${name(c.target)}'s chip and AI research becomes dearer; relations −8 and a grievance remembered.`, confirm: 'Impose controls', danger: false } : null;
    default:
      return null;
  }
}
