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
  /** Military satellites in orbit (D-059): each one widens intelligence coverage. */
  satellites: number;
  /** Conventional cruise/hypersonic missile stock; a strike fires a salvo (D-059). */
  missiles: number;
  /** Months of human-intelligence coverage left against each nation (spy operations). */
  intelOps: Record<Iso3, number>;
  /** Months left of ISR blindness from an enemy cyber operation. */
  blinded: number;
  /** Months before the next cyber operation can be launched. */
  cyberCooldown: number;
  /** Months of production delay inflicted by enemy cyber operations (consumed by runProduction). */
  productionDelay: number;
  /** True while enemy fleets dominate the sea zones off most of the nation's ports. */
  blockaded: boolean;
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
  /** 0..1 — bombed roads, rail and ports; cuts supply throughput, recovers slowly (D-059). */
  infraDamage: number;
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
  /** Combat experience 0..100: veterans fight at up to ×1.2 (D-059). */
  experience: number;
  /** Air wings only: what the wing does this month. Null for land and sea units. */
  mission: AirMission | null;
  /** Optional named commander with a simple trait (generated, fictional). */
  commander: Commander | null;
  /** Months spent preparing an amphibious hop at the embarkation point (prep timer). */
  prep: number;
}

export type AirMission = 'superiority' | 'cas' | 'interdiction' | 'bombing' | 'recon';
export const AIR_MISSIONS: readonly AirMission[] = ['superiority', 'cas', 'interdiction', 'bombing', 'recon'];

export type CommanderTrait = 'aggressive' | 'defensive' | 'logistician' | 'cautious';
export interface Commander {
  readonly name: string;
  readonly trait: CommanderTrait;
  /** Always true: commanders are generated, never real officers. */
  readonly fictional: true;
}

/** Intelligence level a nation holds on a region: 0 nothing … 4 full picture (D-059). */
export type IntelLevel = 0 | 1 | 2 | 3 | 4;

/** What a viewer knows about a foreign stack, given its intel level. */
export interface StackEstimate {
  readonly level: IntelLevel;
  readonly min: number;
  readonly max: number;
  /** Unit types, when the level allows (≥ 3). */
  readonly types: Record<UnitTypeId, number> | null;
  /** Average strength, when the level allows (≥ 3). */
  readonly strength: number | null;
}

export type StrikeKind = 'infrastructure' | 'industry' | 'military';
export type CyberKind = 'economy' | 'intel' | 'production';

export interface BattleSide {
  readonly nation: Iso3;
  readonly units: { readonly type: UnitTypeId; readonly count: number }[];
  readonly strengthBefore: number;
  readonly strengthAfter: number;
}

/** Full account of one battle, shown in the battle report modal (D-059). */
export interface BattleReport {
  readonly id: number;
  readonly turn: number;
  readonly region: RegionId;
  readonly domain: 'land' | 'sea';
  readonly attackers: BattleSide[];
  readonly defenders: BattleSide[];
  readonly attackerMods: Modifier[];
  readonly defenderMods: Modifier[];
  /** Attacker share of air superiority over the battle, 0..1. */
  readonly airSuperiority: number;
  readonly attackPower: number;
  readonly defencePower: number;
  readonly attackerLoss: number;
  readonly defenderLoss: number;
  readonly captured: boolean;
  readonly outcome: 'attackerWins' | 'defenderHolds' | 'stalemate';
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
  /** Attacker's intelligence on the target: below 3 the defender estimate is uncertain. */
  readonly intel: IntelLevel;
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
  | 'strike'
  | 'cyber'
  | 'space'
  | 'intel'
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
  /** Missiles launched / intercepted (conventional strikes). */
  readonly launched?: number;
  readonly intercepted?: number;
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
  /** Battle reports of the last two turns (D-059). */
  battleReports: BattleReport[];
  /** Orbital debris index 0..100: ASAT strikes raise it, it decays slowly and kills satellites. */
  debris: number;
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
    }
  | { readonly type: 'setAirMission'; readonly unitIds: number[]; readonly mission: AirMission }
  | { readonly type: 'missileStrike'; readonly region: RegionId; readonly kind: StrikeKind }
  | { readonly type: 'cyberOp'; readonly target: Iso3; readonly kind: CyberKind }
  | { readonly type: 'spyOp'; readonly target: Iso3 }
  | { readonly type: 'launchSatellite' }
  | { readonly type: 'asat'; readonly target: Iso3 };

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
