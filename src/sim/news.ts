/**
 * The news wire (D-077): every month the notable log entries become short wire stories in one
 * consistent voice — dateline, present-tense headline, a lede and one line of context. Priority 3
 * stories are breaking news (the UI shows a banner). Deterministic: no randomness.
 */
import { nationName, type World } from './world';
import type { GameState, Iso3, LogEntry, NewsCategory, WireStory } from './types';
import { getRelation } from './query';
import { addMonths } from './calendar';
import { START_DATE } from './setup';

const MAX_WIRE = 150;
const MAX_PER_MONTH = 14;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const NEWS_CATEGORIES: readonly NewsCategory[] = ['war', 'nuclear', 'diplomacy', 'politics', 'economy', 'security', 'disaster', 'science'];

function categoryOf(e: LogEntry): NewsCategory {
  switch (e.kind) {
    case 'war':
    case 'peace':
    case 'battle':
    case 'capture':
    case 'capitulation':
      return 'war';
    case 'nuclear':
      return 'nuclear';
    case 'diplomacy':
      return 'diplomacy';
    case 'economy':
      return 'economy';
    case 'research':
      return 'science';
    case 'strike':
    case 'cyber':
    case 'space':
    case 'intel':
      return 'security';
    case 'event':
      if (/earthquake|flood|hurricane|famine|pandemic|virus|wildfire|eruption|drought|disaster/i.test(e.text)) return 'disaster';
      if (/market|bond|currency|bank|default|OPEC|tariff|economy/i.test(e.text)) return 'economy';
      if (/breakthrough|fusion|quantum|chip|vaccine/i.test(e.text)) return 'science';
      if (/election|coup|leader|minister|protest|assassin|impeach|parliament/i.test(e.text)) return 'politics';
      return 'security';
    default:
      return /coup|election|votes|succeeds|leader|protest/i.test(e.text) ? 'politics' : 'diplomacy';
  }
}

function majorInvolved(world: World, e: LogEntry): boolean {
  return (e.nations ?? []).some((n) => world.nations.get(n)?.major);
}

/** 3 breaking, 2 top story, 1 brief, 0 skip. */
function priorityOf(world: World, state: GameState, e: LogEntry): 0 | 1 | 2 | 3 {
  const major = majorInvolved(world, e);
  const mine = (e.nations ?? []).includes(state.player);
  const t = e.text;
  if (e.kind === 'nuclear') return 3;
  if (e.kind === 'capitulation') return 3;
  if (e.kind === 'war' && /declares war|Article 5|Article 4/.test(t)) return major || mine ? 3 : 2;
  if (/assassinated|is killed|COUP|Coup in|seizes power|leaves (NATO|CSTO|SCO|AUKUS)|quits/i.test(t)) return major || mine ? 3 : 2;
  if (e.kind === 'peace') return major || mine ? 2 : 1;
  if (/UN Security Council adopts|vetoed by|balancing coalition|summit/i.test(t)) return 2;
  if (e.kind === 'battle' || e.kind === 'capture') return mine || (major && /capital|Kyiv|Taipei|Seoul|Moscow|Beijing|Washington/i.test(t)) ? 1 : 0;
  if (/protests enter month/.test(t)) return 1;
  if (e.kind === 'event') return mine || major ? 2 : 1;
  if (e.kind === 'research' || e.kind === 'production') return 0;
  if (e.kind === 'economy') return mine || major ? 1 : 0;
  if (e.kind === 'info') return mine || major ? 1 : 0;
  if (e.kind === 'diplomacy') return mine || (major && !/trade agreement/.test(t)) ? 1 : 0;
  return mine || major ? 1 : 0;
}

const CHOSE = /^(.*?) — you chose "(.*)"\.?$/;

/** Wire-style headline: present tense, the first sentence, no trailing full stop. */
function headlineOf(world: World, state: GameState, e: LogEntry, priority: number): string {
  const chose = CHOSE.exec(e.text);
  let h: string;
  if (chose) h = `${nationName(world, state.player)} responds to ${chose[1]!.toLowerCase()}: “${chose[2]}”`;
  else if (e.kind === 'event' && /^[^:]{3,60}: /.test(e.text)) h = e.text.split(': ')[0]!;
  else
    h = e.text
      .replace(/^(NUCLEAR STRIKE|UN):\s*/, '')
      .replace(/\s*\([^)]*\)/g, '')
      .split(/(?<=[a-z0-9’”"])\. /)[0]!
      .trim();
  h = h.replace(/\.$/, '');
  if (h.length > 110) h = `${h.slice(0, 107).replace(/\s+\S*$/, '')}…`;
  if (e.kind === 'nuclear') h = `NUCLEAR: ${h}`;
  else if (priority === 3) h = h.charAt(0).toUpperCase() + h.slice(1);
  return h;
}

function bodyText(world: World, state: GameState, e: LogEntry): string {
  const chose = CHOSE.exec(e.text);
  if (chose) return `The government of ${nationName(world, state.player)} has decided to “${chose[2]}” in response to the ${chose[1]!.toLowerCase()}.`;
  const t = e.text.replace(/^NUCLEAR STRIKE:\s*/, '');
  return /[.!?”]$/.test(t) ? t : `${t}.`;
}

function context(world: World, state: GameState, e: LogEntry, cat: NewsCategory): string {
  const [a, b] = e.nations ?? [];
  switch (cat) {
    case 'war': {
      const t = Math.round(state.globalTension);
      return `Global tension stands at ${t} on a scale of 100${a ? `; ${nationName(world, a)} is at DEFCON ${state.nations[a]?.defcon ?? 5}` : ''}.`;
    }
    case 'nuclear':
      return `It is detonation number ${state.detonations} of the crisis. Scientists estimate the world has cooled by ${(state.nuclearWinter ?? 0).toFixed(1)} °C.`;
    case 'diplomacy':
      return a && b ? `Relations between ${nationName(world, a)} and ${nationName(world, b)} stand at ${Math.round(getRelation(world, state, a, b))} on a scale from −100 to +100.` : 'Diplomats expect further moves in the coming weeks.';
    case 'politics':
      return a && state.nations[a] ? `Government approval in ${nationName(world, a)} is ${Math.round(state.nations[a]!.support)}; stability ${Math.round(state.nations[a]!.stability)}.` : 'Analysts are divided on what comes next.';
    case 'economy':
      return a && state.nations[a] ? `${nationName(world, a)}'s economy is growing at ${state.nations[a]!.growth.toFixed(1)} % a year with inflation at ${state.nations[a]!.inflation.toFixed(1)} %.` : 'Markets are watching closely.';
    case 'disaster':
      return 'Aid agencies say the full extent of the damage is not yet known.';
    case 'science':
      return 'Rival programmes are expected to respond.';
    case 'security':
      return `Global tension stands at ${Math.round(state.globalTension)}.`;
  }
}

function dateline(world: World, e: LogEntry): string {
  const iso: Iso3 | undefined = e.kind === 'nuclear' ? e.nations?.[1] ?? e.nations?.[0] : e.nations?.[0];
  const city = (iso && world.nations.get(iso)?.capital) || 'GENEVA';
  const d = addMonths(START_DATE, e.turn);
  return `${city.toUpperCase()}, ${MONTHS[d.month - 1]} ${d.year}`;
}

/** Turns this month's log into wire stories (called once per turn, before the calendar advances). */
export function writeWire(world: World, state: GameState): WireStory[] {
  const entries = state.log.filter((e) => e.turn === state.turn);
  const scored: { e: LogEntry; p: 1 | 2 | 3; i: number }[] = [];
  const seen = new Set<string>();
  entries.forEach((e, i) => {
    const p = priorityOf(world, state, e);
    if (p === 0) return;
    const key = e.text.slice(0, 60);
    if (seen.has(key)) return;
    seen.add(key);
    scored.push({ e, p, i });
  });
  scored.sort((x, y) => y.p - x.p || x.i - y.i);
  const out: WireStory[] = [];
  for (const { e, p } of scored.slice(0, MAX_PER_MONTH)) {
    const category = categoryOf(e);
    out.push({
      id: state.nextId++,
      turn: state.turn,
      category,
      priority: p,
      headline: headlineOf(world, state, e, p),
      body: `${dateline(world, e)} (WW3 Wire) — ${bodyText(world, state, e)} ${context(world, state, e, category)}`,
      dateline: dateline(world, e),
      nations: [...(e.nations ?? [])],
    });
  }
  state.wire.push(...out);
  if (state.wire.length > MAX_WIRE) state.wire.splice(0, state.wire.length - MAX_WIRE);
  return out;
}
