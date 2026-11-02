/**
 * Diplomatic statements (D-071): template-driven leader messages flavoured by personality. The tone
 * comes from the leader's traits; the template is chosen by a hash of the turn and the parties, so
 * statements never consume the simulation's random stream.
 */
import { nationName, traitsOf, type World } from './world';
import type { Dispatch, DispatchKind, GameState, Iso3 } from './types';

export type Tone = Dispatch['tone'];

export function toneOf(world: World, iso: Iso3): Tone {
  const t = traitsOf(world, iso);
  if (t.aggression >= 65 || t.nationalism >= 85) return 'blunt';
  if (t.paranoia >= 68) return 'cold';
  if (t.pragmatism >= 60) return 'measured';
  return 'formal';
}

/** `{to}` addressee, `{subject}` third party, `{reason}` free text, `{from}` speaker's nation. */
const TEMPLATES: Record<DispatchKind, Record<Tone, string[]>> = {
  threat: {
    blunt: [
      '{to} is playing with fire. Any move against our interests will be met with overwhelming force. {reason}',
      'Let there be no confusion in {to}: we will not hesitate. {reason}',
      'Our patience with {to} is finished. {reason}',
    ],
    cold: [
      'We are watching {to} closely and have prepared for every contingency. {reason}',
      '{to} should study its history before it repeats its mistakes. {reason}',
    ],
    measured: [
      'We urge {to} to step back. If it does not, we will take the measures necessary to protect our people. {reason}',
      'Escalation serves no one, but {to} should not mistake restraint for weakness. {reason}',
    ],
    formal: [
      'The government formally warns {to} that continued provocation will carry consequences. {reason}',
    ],
  },
  warning: {
    blunt: ['{to} has crossed a line and it will be remembered. {reason}', 'We will not forget what {to} has done. {reason}'],
    cold: ['We take note of the conduct of {to}. {reason}', 'The actions of {to} confirm our assessment of its intentions. {reason}'],
    measured: ['We regret the decision taken by {to}; it makes cooperation harder. {reason}'],
    formal: ['The government expresses its deep concern at the conduct of {to}. {reason}'],
  },
  praise: {
    blunt: ['{to} has shown real friendship, and we never forget our friends. {reason}', 'A strong partner: {to} delivered when it mattered. {reason}'],
    cold: ['{to} has proven itself reliable. That is rare. {reason}'],
    measured: ['We thank {to} for its support; this is what partnership looks like. {reason}', 'Our cooperation with {to} grows stronger. {reason}'],
    formal: ['The government extends its sincere gratitude to {to}. {reason}'],
  },
  request: {
    blunt: ['We need help from {to}, and we need it now. {reason}'],
    cold: ['We ask {to} to stand by its word. {reason}'],
    measured: ['We call on {to} to stand with us. {reason}', 'Every month counts: we ask {to} for further support. {reason}'],
    formal: ['The government respectfully requests the assistance of {to}. {reason}'],
  },
  offer: {
    blunt: ['{to} should take this deal while it is on the table. {reason}'],
    cold: ['We have a proposal for {to}. It will not be repeated. {reason}'],
    measured: ['We believe there is a deal to be made with {to}. {reason}'],
    formal: ['The government submits a proposal to {to}. {reason}'],
  },
  condemnation: {
    blunt: ['The aggression of {to} is a crime and it will fail. {reason}', '{to} has shown the world exactly who it is. {reason}'],
    cold: ['We condemn {to} without reservation. {reason}'],
    measured: ['We condemn the actions of {to} and call for an immediate return to diplomacy. {reason}'],
    formal: ['The government condemns in the strongest terms the actions of {to}. {reason}'],
  },
  communique: {
    blunt: ['{reason}'],
    cold: ['{reason}'],
    measured: ['{reason}'],
    formal: ['{reason}'],
  },
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function composeStatement(
  world: World,
  state: GameState,
  from: Iso3,
  to: Iso3 | null,
  kind: DispatchKind,
  reason: string,
): { text: string; tone: Tone } {
  const tone = toneOf(world, from);
  const list = TEMPLATES[kind][tone];
  const tpl = list[hash(`${state.turn}|${from}|${to}|${kind}`) % list.length]!;
  const text = tpl
    .replace(/\{to\}/g, to ? nationName(world, to) : 'the world')
    .replace(/\{from\}/g, nationName(world, from))
    .replace(/\{reason\}/g, reason)
    .replace(/\s+$/, '');
  return { text, tone };
}

const MAX_DISPATCHES = 40;

/**
 * Issues a statement. Only statements involving a major or the player are kept, so the feed reads
 * like a diplomatic wire rather than noise. Duplicates (same speaker, addressee and kind in the
 * same month) are dropped.
 */
export function issueDispatch(
  world: World,
  state: GameState,
  from: Iso3,
  to: Iso3 | null,
  kind: DispatchKind,
  reason: string,
): void {
  if (!state.dispatches) return;
  const notable =
    from === state.player ||
    to === state.player ||
    world.nations.get(from)?.major ||
    (to !== null && world.nations.get(to)?.major) ||
    kind === 'communique';
  if (!notable) return;
  if (state.dispatches.some((d) => d.turn === state.turn && d.from === from && d.to === to && d.kind === kind)) return;
  const { text, tone } = composeStatement(world, state, from, to, kind, reason);
  state.dispatches.push({ id: state.nextId++, turn: state.turn, from, to, kind, text, tone });
  if (state.dispatches.length > MAX_DISPATCHES) state.dispatches.splice(0, state.dispatches.length - MAX_DISPATCHES);
}
