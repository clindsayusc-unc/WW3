/**
 * The interactive tutorial (D-080): five turns with the chief of staff. Each step highlights one
 * element (by `data-testid`) and either waits for "Next" or for the player to do the thing it
 * describes. Steps carry the game turn they belong to; once a turn's steps are done the player
 * ends the turn and the next batch begins.
 */
import type { GameState } from '../../sim/types';
import type { Modal } from '../../state/uiStore';

/** The chief of staff is a fictional character (CLAUDE.md rule 6): no real person, no likeness. */
export const ADVISOR = {
  name: 'Col. Iris Halden',
  title: 'Chief of Staff',
  fictional: true,
} as const;

export interface TutorialContext {
  readonly game: GameState;
  readonly modal: Modal;
  readonly mapMode: string;
  readonly selectedRegion: number | null;
  /** The game turn when the current step began (for "end the turn" steps). */
  readonly stepTurn: number;
}

export interface TutorialStep {
  readonly id: string;
  /** Game turn (0 = January 2027) the step belongs to. */
  readonly turn: number;
  readonly title: string;
  readonly body: string;
  /** `data-testid` of the element to spotlight; none = centred card. */
  readonly target?: string;
  /** What the player should do; when set, the step completes itself once `done` is true. */
  readonly task?: string;
  readonly done?: (c: TutorialContext) => boolean;
}

const modalIs = (m: Modal) => (c: TutorialContext) => c.modal === m;
const turnEnded = (c: TutorialContext) => c.game.turn > c.stepTurn;

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  // --- Turn 1: the world and the controls -----------------------------------------------------
  {
    id: 'welcome',
    turn: 0,
    title: 'Welcome, leader',
    body: `I am ${ADVISOR.name}, your chief of staff — a fictional officer, here to brief you through your first five months. One turn is one month. The world of January 2027 is drawn from public data: real nations, real alliances, real flashpoints.`,
  },
  {
    id: 'topbar',
    turn: 0,
    target: 'topbar-stats',
    title: 'The state of the nation',
    body: 'Treasury, GDP, growth, inflation, approval, stability, global tension and DEFCON. Every number in this game explains itself: hover any of them to see why it is what it is.',
  },
  {
    id: 'growth',
    turn: 0,
    target: 'hud-growth',
    title: 'Causes, and their sources',
    body: 'Hover Growth. The tooltip lists every cause; the dotted lines open a second tooltip with the sources behind that cause — trade partners, sanctioners, wars.',
  },
  {
    id: 'nation',
    turn: 0,
    target: 'nation-panel',
    title: 'Your government',
    body: 'Your leader, forces, debt and the budget split. Alliances you belong to are listed here; allies come to your aid and share technology.',
  },
  {
    id: 'mapmodes',
    turn: 0,
    target: 'mapmodes',
    title: 'Read the map',
    body: 'Nine map modes show the world through different lenses. Relations colours every nation by how it feels about you.',
    task: 'Switch to the Relations map (press 3).',
    done: (c) => c.mapMode === 'relations',
  },
  {
    id: 'select',
    turn: 0,
    target: 'context-panel',
    title: 'Inspect a region',
    body: 'Click any region on the globe. This panel shows who holds it, the terrain, supply and the forces there. Select your own units, then right-click a destination to move or attack.',
    task: 'Click a region on the globe.',
    done: (c) => c.selectedRegion !== null,
  },
  {
    id: 'advisor',
    turn: 0,
    target: 'advisor',
    title: 'My recommendations',
    body: 'Every month I list the three most useful things you could do — economy, military and diplomacy — with the numbers behind each. "Go" takes you to the right screen. Press A to fold this away.',
  },
  {
    id: 'budget-open',
    turn: 0,
    target: 'nav-budget',
    title: 'Guns, butter and science',
    body: 'The budget decides everything: military, research, infrastructure, social spending and debt service.',
    task: 'Open the Budget (B).',
    done: modalIs('budget'),
  },
  {
    id: 'budget-inside',
    turn: 0,
    target: 'modal-budget',
    title: 'Every point is a trade-off',
    body: 'More research speeds the tech tree; more infrastructure adds growth; more social spending buys approval and stability. Apply a change, or close the screen to keep the current split.',
    task: 'Close the Budget when you are done (Esc).',
    done: (c) => c.modal !== 'budget',
  },
  {
    id: 'end-1',
    turn: 0,
    target: 'end-turn',
    title: 'End the month',
    body: 'When you are ready, end the turn. The AI governments act, the economy ticks and battles resolve. Orders you gave this month can be undone until you do.',
    task: 'Press End Turn (Enter).',
    done: turnEnded,
  },
  // --- Turn 2: briefing and research ----------------------------------------------------------
  {
    id: 'briefing',
    turn: 1,
    target: 'nav-summary',
    title: 'The monthly briefing',
    body: 'Each month begins with an intelligence briefing: what changed, where, and why — with charts of your economy and standing.',
    task: 'Open the Briefing (S).',
    done: modalIs('summary'),
  },
  {
    id: 'research-open',
    turn: 1,
    target: 'nav-research',
    title: 'The technology race',
    body: 'Eighty-one technologies from 2027 to 2040. Your nation already fields what it fields in reality.',
    task: 'Open Research (R) — the nav bar works with any screen open.',
    done: modalIs('research'),
  },
  {
    id: 'research-queue',
    turn: 1,
    target: 'tech-tree',
    title: 'Queue a path',
    body: 'Click any technology — even a distant one. Every missing prerequisite is queued in order, and research continues by itself month after month.',
    task: 'Click a technology you do not field yet.',
    done: (c) => {
      const me = c.game.nations[c.game.player]!;
      return me.researchQueue.length > 0 || me.researchCurrent !== null;
    },
  },
  {
    id: 'end-2',
    turn: 1,
    target: 'end-turn',
    title: 'Another month',
    body: 'Close the screen and end the turn.',
    task: 'End the turn.',
    done: turnEnded,
  },
  // --- Turn 3: forces and undo ---------------------------------------------------------------
  {
    id: 'production-open',
    turn: 2,
    target: 'nav-production',
    title: 'Build your forces',
    body: 'Formations take months to build and cost upkeep every month after. Start them before you need them.',
    task: 'Open Production (P).',
    done: modalIs('production'),
  },
  {
    id: 'production-build',
    turn: 2,
    target: 'modal-production',
    title: 'Place an order',
    body: 'Pick a deployment region and build a formation. Units locked behind technology show a lock until you research them.',
    task: 'Build any unit.',
    done: (c) => c.game.nations[c.game.player]!.production.length > 0,
  },
  {
    id: 'undo',
    turn: 2,
    target: 'undo',
    title: 'Second thoughts',
    body: 'Moves, production, research and budget orders can be undone until the end of the month (Ctrl+Z). Wars, strikes and diplomacy are final — they ask for confirmation instead.',
  },
  {
    id: 'military-open',
    turn: 2,
    target: 'nav-military',
    title: 'The military picture',
    body: 'Strength by domain against every great power, air missions, strategic operations and intelligence.',
    task: 'Open Military (M).',
    done: modalIs('military'),
  },
  {
    id: 'end-3',
    turn: 2,
    target: 'end-turn',
    title: 'Hold the line',
    body: 'Close the screen and end the turn.',
    task: 'End the turn.',
    done: turnEnded,
  },
  // --- Turn 4: diplomacy and the economy ------------------------------------------------------
  {
    id: 'diplomacy-open',
    turn: 3,
    target: 'nav-diplomacy',
    title: 'Friends and rivals',
    body: 'Relations, leaders with their own personalities and memories, deals, blocs and the UN Security Council.',
    task: 'Open Diplomacy (D).',
    done: modalIs('diplomacy'),
  },
  {
    id: 'diplomacy-inside',
    turn: 3,
    target: 'modal-diplomacy',
    title: 'Every leader remembers',
    body: 'Pick a nation to see what its leader thinks of you and why. Proposals show their odds before you send them. Declaring war or imposing sanctions asks you to confirm — they cannot be taken back.',
  },
  {
    id: 'economy-open',
    turn: 3,
    target: 'nav-economy',
    title: 'Follow the money',
    body: 'Trade routes, resources, sanctions and domestic politics. Close Diplomacy first.',
    task: 'Open the Economy (E).',
    done: modalIs('economy'),
  },
  {
    id: 'end-4',
    turn: 3,
    target: 'end-turn',
    title: 'One more month',
    body: 'Close the screen and end the turn.',
    task: 'End the turn.',
    done: turnEnded,
  },
  // --- Turn 5: escalation and help --------------------------------------------------------------
  {
    id: 'tension',
    turn: 4,
    target: 'hud-tension',
    title: 'The escalation ladder',
    body: 'Global tension drives DEFCON. Click Tension to see the ladder from posturing to strategic exchange, and every nuclear power’s posture.',
    task: 'Open the escalation ladder (X).',
    done: modalIs('escalation'),
  },
  {
    id: 'shortcuts',
    turn: 4,
    target: 'nav-shortcuts',
    title: 'Shortcuts',
    body: 'Every screen and map mode has a key. Close the ladder, then press ? to see them all.',
    task: 'Open the shortcuts (?).',
    done: modalIs('shortcuts'),
  },
  {
    id: 'settings',
    turn: 4,
    target: 'nav-settings',
    title: 'Make it yours',
    body: 'Settings has a UI-scale slider, colourblind-safe map palettes, confirmation and advisor switches, audio and graphics quality.',
  },
  {
    id: 'farewell',
    turn: 4,
    title: 'The world is yours',
    body: 'That is everything you need. I will keep my three recommendations coming each month. Press H to replay this briefing at any time. Good luck — and try to keep it below DEFCON 1.',
  },
];
