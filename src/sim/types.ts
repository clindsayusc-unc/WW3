import type { YearMonth } from './calendar';
import type { RngState } from './rng';

export type Iso3 = string;
export type RegionId = number;
export type UnitTypeId = string;
export type TechId = string;

export type MobilizationLevel = 0 | 1 | 2;
export type Defcon = 1 | 2 | 3 | 4 | 5;

export interface Budget {
  military: number;
  research: number;
  infrastructure: number;
  social: number;
  debt: number;
}

export interface GrowthModifier {
  readonly delta: number; // percentage points of annual growth
  monthsLeft: number;
  readonly reason: string;
}

export interface ProductionItem {
  readonly id: number;
  readonly type: UnitTypeId;
  readonly region: RegionId;
  monthsLeft: number;
}

export interface Finances {
  revenue: number;
  military: number;
  upkeep: number;
  production: number;
  research: number;
  infrastructure: number;
  social: number;
  debtService: number;
  interest: number;
  deficit: number;
}

export interface NationState {
  readonly iso3: Iso3;
  alive: boolean;
  capitulatedTo: Iso3 | null;
  /** Annual nominal GDP, USD bn (home economy before occupation losses). */
  gdp: number;
  /** Trend real growth, % per year. */
  baseGrowth: number;
  /** Last month's effective annualised growth, % per year (for the HUD). */
  growth: number;
  growthMods: GrowthModifier[];
  treasury: number;
  debt: number;
  stability: number;
  warWeariness: number;
  mobilization: MobilizationLevel;
  budget: Budget;
  researchCurrent: TechId | null;
  researchPoints: number;
  techs: TechId[];
  modifiers: Record<string, number>;
  defcon: Defcon;
  defconMod: number;
  warheads: number;
  population: number;
  /** Force quality multiplier derived from spending per soldier. */
  quality: number;
  production: ProductionItem[];
  finances: Finances;
  monthsUnstable: number;
  /** Consecutive months the capital has been in enemy hands. */
  capitalLostMonths: number;
  /** Latest one-line AI rationale (for the diplomacy screen). */
  aiNote: string;
  /** Leader name shown in the UI; may be replaced by a fictional successor. */
  leaderName: string;
  leaderTitle: string;
  leaderFictional: boolean;
}

export interface RegionState {
  readonly id: RegionId;
  owner: Iso3 | null;
  controller: Iso3 | null;
  /** 0..1 — war damage; reduces the region's economic output. */
  devastation: number;
  /** Supply level 0..1 reaching this region for its controller (D-050). */
  supply: number;
  /** `supply >= 0.25`; kept for the UI and older saves. */
  supplied: boolean;
  /** Set when the region changed controller this turn (for the renderer). */
  flippedTurn: number;
}

export interface Unit {
  readonly id: number;
  readonly type: UnitTypeId;
  readonly owner: Iso3;
  region: RegionId;
  strength: number;
  morale: number;
  /** Remaining path (region ids) set by the player or the AI. */
  path: RegionId[];
  /** Region the unit was in at the start of the last turn (for movement animation). */
  prevRegion: RegionId;
  /** Movement points banked toward the next step when terrain costs more than one turn. */
  moveProgress: number;
}

export type ChokepointStatus = 'open' | 'contested' | 'closed';
export interface ChokepointState {
  status: ChokepointStatus;
  /** Nation closing or contesting it (null when open). */
  by: Iso3 | null;
  mined: boolean;
  minedBy: Iso3 | null;
  /** Turn the status last changed. */
  since: number;
}

/** One factor in a combat, movement or supply calculation, shown to the player (D-018). */
export interface Modifier {
  readonly label: string;
  readonly factor: number;
  readonly detail: string;
}

export interface PathPreview {
  readonly regions: RegionId[];
  /** Movement cost of each step (1 = one month for a speed-1 unit). */
  readonly costs: number[];
  /** Supply level at each step (0..1, as it stands now). */
  readonly supply: number[];
  readonly turns: number;
  readonly totalCost: number;
}

export interface OddsReport {
  readonly target: RegionId;
  readonly ratio: number;
  readonly text: string;
  readonly attacker: Modifier[];
  readonly defender: Modifier[];
  readonly attackPower: number;
  readonly defencePower: number;
  readonly defenders: number;
  readonly path: PathPreview | null;
  readonly pathNote: string | null;
}

export interface War {
  readonly id: number;
  attackers: Iso3[];
  defenders: Iso3[];
  readonly since: number;
  /** Positive favours attackers. */
  score: number;
}

export type TreatyType = 'trade' | 'nap' | 'defensive' | 'alliance';
export interface Treaty {
  readonly type: TreatyType;
  readonly a: Iso3;
  readonly b: Iso3;
  readonly since: number;
}

export type ProposalType =
  | 'trade'
  | 'nap'
  | 'defensive'
  | 'alliance'
  | 'sanction'
  | 'liftSanction'
  | 'demand'
  | 'declareWar'
  | 'peaceWhite'
  | 'peaceStatusQuo'
  | 'resolution';

export interface Proposal {
  readonly id: number;
  readonly from: Iso3;
  readonly to: Iso3;
  readonly type: ProposalType;
  readonly turn: number;
  readonly text: string;
}

export type LogKind =
  | 'war'
  | 'peace'
  | 'battle'
  | 'capture'
  | 'diplomacy'
  | 'economy'
  | 'research'
  | 'event'
  | 'nuclear'
  | 'production'
  | 'capitulation'
  | 'info';

export interface LogEntry {
  readonly turn: number;
  readonly kind: LogKind;
  readonly text: string;
  readonly nations?: Iso3[];
  readonly region?: RegionId;
  /** True when the entry concerns the player directly (alerts list). */
  readonly alert?: boolean;
}

export interface Strike {
  readonly turn: number;
  readonly kind: 'missile' | 'nuclear' | 'air';
  readonly from: RegionId;
  readonly to: RegionId;
  readonly attacker: Iso3;
}

export interface PendingEvent {
  readonly id: string;
  readonly eventId: string;
  readonly target: Iso3 | null;
  readonly title: string;
  readonly text: string;
  readonly choices: { label: string; tooltip: string }[];
}

export interface Victory {
  readonly kind: 'hegemony' | 'deterrence' | 'diplomatic' | 'conquest';
  readonly text: string;
}
export interface Defeat {
  readonly kind: 'capitulation' | 'collapse' | 'nuclearWar';
  readonly text: string;
}

/** Complete, serialisable simulation state. Must be structured-clone safe. */
export interface GameState {
  readonly version: number;
  readonly seed: number;
  rng: RngState;
  readonly scenario: string;
  readonly player: Iso3;
  /** Turn index, starting at 0. */
  turn: number;
  date: YearMonth;
  isoDate: string;
  nations: Record<Iso3, NationState>;
  regions: Record<RegionId, RegionState>;
  /** Incremented whenever any region's owner/controller changes (cache invalidation). */
  regionsVersion: number;
  /** Incremented whenever treaties change (cache invalidation). */
  diplomacyVersion: number;
  units: Record<number, Unit>;
  nextId: number;
  relations: Record<string, number>;
  sanctions: string[];
  treaties: Treaty[];
  wars: War[];
  proposals: Proposal[];
  globalTension: number;
  flashpoints: Record<string, number>;
  eventsFired: Record<string, number>;
  pendingEvents: PendingEvent[];
  log: LogEntry[];
  news: string[];
  strikes: Strike[];
  detonations: number;
  chokepoints: Record<string, ChokepointState>;
  /** Oil price index, 1 = January 2027; rises while chokepoints are closed. */
  oilPrice: number;
  resolutionPassed: boolean;
  victory: Victory | null;
  defeat: Defeat | null;
  /** Turn-summary numbers captured at the end of the last turn. */
  summary: TurnSummary | null;
}

export interface TurnSummary {
  readonly turn: number;
  readonly gdpDelta: number;
  readonly treasuryDelta: number;
  readonly stabilityDelta: number;
  readonly battles: number;
  readonly regionsGained: number;
  readonly regionsLost: number;
  readonly techsCompleted: string[];
  readonly headlines: string[];
}

export type Command =
  | { readonly type: 'endTurn' }
  | { readonly type: 'setBudget'; readonly budget: Budget }
  | { readonly type: 'setMobilization'; readonly level: MobilizationLevel }
  | { readonly type: 'queueProduction'; readonly unitType: UnitTypeId; readonly region: RegionId }
  | { readonly type: 'cancelProduction'; readonly id: number }
  | { readonly type: 'setResearch'; readonly tech: TechId }
  | { readonly type: 'moveUnits'; readonly unitIds: number[]; readonly target: RegionId }
  | { readonly type: 'propose'; readonly proposal: ProposalType; readonly target: Iso3 }
  | { readonly type: 'respond'; readonly proposalId: number; readonly accept: boolean }
  | { readonly type: 'resolveEvent'; readonly pendingId: string; readonly choice: number }
  | { readonly type: 'nuclearStrike'; readonly target: Iso3; readonly region: RegionId }
  | { readonly type: 'disband'; readonly unitIds: number[] }
  | {
      readonly type: 'chokepoint';
      readonly id: string;
      readonly action: 'close' | 'open' | 'mine' | 'clear';
    };

export interface NewGameOptions {
  readonly seed: number;
  readonly player: Iso3;
  readonly scenario: 'world-2027' | 'taiwan-crisis';
}

export type WorkerRequest =
  | { readonly kind: 'new'; readonly options: NewGameOptions }
  | { readonly kind: 'load'; readonly state: GameState }
  | { readonly kind: 'command'; readonly command: Command }
  | { readonly kind: 'odds'; readonly unitIds: number[]; readonly target: RegionId };

export type WorkerResponse =
  | { readonly kind: 'state'; readonly state: GameState; readonly ms: number }
  | { readonly kind: 'odds'; readonly report: OddsReport }
  | { readonly kind: 'error'; readonly message: string };
