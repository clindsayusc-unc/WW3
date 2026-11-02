import type { YearMonth } from './calendar';
import type { RngState } from './rng';
import type { Traits } from './world';

export type Iso3 = string;
export type RegionId = number;
export type UnitTypeId = string;
export type TechId = string;

export type MobilizationLevel = 0 | 1 | 2;

/** Strategic resources traded on the world market (D-061, data/resources.json). */
export type ResourceId = 'oil' | 'gas' | 'rareEarths' | 'chips' | 'food' | 'steel';
export const RESOURCE_IDS: readonly ResourceId[] = ['oil', 'gas', 'rareEarths', 'chips', 'food', 'steel'];

/** One nation's position in one resource, in shares of world output (1 = the world at start). */
export interface ResourceBalance {
  production: number;
  demand: number;
  imports: number;
  exports: number;
  /** (home production used + imports) ÷ demand, 0..1. */
  satisfaction: number;
  /** Largest suppliers of this month's imports (≤ 3), share of world output each. */
  suppliers: Record<Iso3, number>;
}

/** Why a trade route carries less than it could (D-061). */
export type TradeStatus = 'open' | 'rerouted' | 'contested' | 'cut' | 'sanctioned' | 'embargoed' | 'war';

/** One bilateral trade relationship from data/trade.json, recomputed every month. */
export interface TradeRoute {
  readonly a: Iso3;
  readonly b: Iso3;
  /** Two-way goods trade in the data (US$ bn/yr). */
  readonly base: number;
  /** Current two-way volume, US$ bn/yr. */
  volume: number;
  /** Volume this pair would carry today under the conditions of January 2027. */
  reference: number;
  status: TradeStatus;
  /** Sea zones the cargo runs through (empty when the pair trades overland). */
  via: RegionId[];
  land: boolean;
  /** One-line explanation for the tooltip. */
  note: string;
}

/** Last month's economic transmission terms for a nation (pp of annual growth unless noted). */
export interface EconTerms {
  /** Trade lost (+) or gained (−) against the January 2027 baseline, US$ bn/yr. */
  tradeLost: number;
  tradeEffect: number;
  /** Strategic-resource export earnings, US$ bn/yr, and their baseline. */
  exportValue: number;
  exportRef: number;
  exportEffect: number;
  shortageEffect: number;
  priceEffect: number;
  /** Secondary-sanction penalties on this nation's trade, US$ bn/yr. */
  secondaryLost: number;
  /** Deficit financed by borrowing last month, % of GDP (annualised). */
  deficitPct: number;
  /** Share of world GDP sanctioning this nation now, and at game start. */
  sanctionShare: number;
  sanctionRef: number;
}

export interface EconSample {
  readonly turn: number;
  readonly gdp: number;
  readonly growth: number;
  readonly inflation: number;
  /** Debt as % of GDP. */
  readonly debt: number;
  readonly support: number;
  readonly treasury: number;
}

export type Regime = 'democracy' | 'hybrid' | 'autocracy';
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
  /** Donor when the formation is a foreign arms-aid delivery (D-072). */
  readonly aidFrom?: Iso3;
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
  /** Potential output (US$ bn): GDP at full employment; actual GDP converges toward it (D-061). */
  potentialGdp: number;
  /** Consumer-price inflation, % per year. */
  inflation: number;
  /** Average interest rate on public debt, % per year. */
  interestRate: number;
  /** Government revenue as % of GDP (the tax lever). */
  taxRate: number;
  /** Public approval of the government, 0–100. */
  support: number;
  /** Consecutive months of negative growth; six or more is a recession. */
  negativeMonths: number;
  recession: boolean;
  resources: Record<ResourceId, ResourceBalance>;
  /** Satisfaction per resource at game start (the baseline shortages are measured against). */
  resourceRef: Record<ResourceId, number>;
  econ: EconTerms;
  /** War bonds outstanding, US$ bn, and months before another issue. */
  warBonds: number;
  warBondCooldown: number;
  /** Turn of the next national election (null: no competitive elections). */
  nextElection: number | null;
  /** Monthly probability of a coup, 0..1 (autocracies and hybrid regimes). */
  coupRisk: number;
  /** Consecutive months of mass protests. */
  protestMonths: number;
  /** Turns since the last sovereign default (interest premium while < 36). */
  monthsSinceDefault: number;
  /** International legitimacy 0–100 (D-071): UN votes, aggression and vetoes move it; deals and votes read it. */
  legitimacy: number;
  /** Munitions aid this month as a supply and recovery bonus, 0..0.35 (D-072). */
  aidSupply: number;
  /** Foreign aid received last month, US$ bn (money + arms + munitions). */
  aidReceived: number;
  /** Arms aid banked toward the next delivered formation, US$ bn. */
  aidArmsBank: number;
  /** Turn the current leader took office (negative: before January 2027) (D-075). */
  leaderSince: number;
  /** The current leader may not stand at the next election (term limits, D-075). */
  leaderTermLimited: boolean;
  /** Party or faction of the current leader (data/factions.json), D-078. */
  leaderFaction: string | null;
  /** Generated traits of a fictional successor; null while the researched leader holds office. */
  leaderTraits: Traits | null;
}

// --- Diplomacy AI (D-071) ----------------------------------------------------------------------

export type AgendaId =
  | 'reunification'
  | 'territorialRecovery'
  | 'regionalHegemony'
  | 'alliancePreservation'
  | 'regimeSurvival'
  | 'nonAlignment'
  | 'transactional'
  | 'economicDevelopment';

/** Something a leader remembers about another nation: a grievance or a favour, decaying monthly. */
export interface MemoryEntry {
  readonly about: Iso3;
  readonly kind: 'grievance' | 'favour';
  weight: number;
  readonly reason: string;
  turn: number;
}

export type DispatchKind = 'threat' | 'warning' | 'praise' | 'request' | 'offer' | 'condemnation' | 'communique';

/** A leader's diplomatic statement, generated from templates flavoured by personality. */
export interface Dispatch {
  readonly id: number;
  readonly turn: number;
  readonly from: Iso3;
  /** Addressee; null for a public statement. */
  readonly to: Iso3 | null;
  readonly kind: DispatchKind;
  readonly text: string;
  /** Tone the template was chosen for (shown on the card). */
  readonly tone: 'blunt' | 'cold' | 'measured' | 'formal';
}

export type BlocId = 'NATO' | 'CSTO' | 'SCO' | 'AUKUS' | 'EU' | 'Quad' | 'BRICS' | 'GCC';

export interface BlocState {
  members: Iso3[];
  /** 0–100: shared threat, relations among members and burden sharing. */
  cohesion: number;
  /** Turn of the next summit. */
  nextSummit: number;
  /** Members that walked out, with the turn. */
  departed: { iso3: Iso3; turn: number }[];
}

export type ResolutionKind = 'sanctions' | 'ceasefire' | 'condemnation';
export type UnVote = 'yes' | 'no' | 'abstain';

export interface Resolution {
  readonly id: number;
  readonly kind: ResolutionKind;
  readonly sponsor: Iso3;
  readonly target: Iso3;
  readonly turn: number;
  readonly text: string;
  votes: Record<Iso3, UnVote>;
  status: 'pending' | 'adopted' | 'vetoed' | 'failed';
  vetoedBy: Iso3[];
}

export interface UnState {
  council: Iso3[];
  /** Last year of each elected member's term. */
  electedUntil: Record<Iso3, number>;
  /** Recent resolutions (pending first), newest last; ≤ 12 kept. */
  resolutions: Resolution[];
}

/** One month of aid from a donor to a nation at war (D-072). US$ bn this month. */
export interface AidFlow {
  readonly donor: Iso3;
  readonly recipient: Iso3;
  readonly against: Iso3;
  readonly money: number;
  readonly arms: number;
  readonly munitions: number;
}

export interface WarPlan {
  target: Iso3;
  /** Nations expected to fight alongside. */
  coalition: Iso3[];
  /** Force ratio needed before attacking (from risk tolerance and aggression). */
  threshold: number;
  /** Current estimated force ratio against the target and its likely defenders. */
  odds: number;
  /** odds ÷ threshold, 0..1.5. */
  readiness: number;
  readonly formed: number;
  reason: string;
  /** True once the leader has publicly warned the target. */
  warned: boolean;
}

/** A balancing coalition against a runaway power. */
export interface BalancingCoalition {
  target: Iso3;
  members: Iso3[];
  readonly formed: number;
  /** Target's dominance index when last measured (0..1). */
  dominance: number;
}

export type DealItem =
  | { readonly kind: 'money'; readonly amount: number }
  | { readonly kind: 'region'; readonly region: RegionId }
  | { readonly kind: 'basing' }
  | { readonly kind: 'tech' }
  | { readonly kind: 'liftSanctions' }
  | { readonly kind: 'arms'; readonly units: number }
  | { readonly kind: 'joinWar'; readonly against: Iso3 }
  | { readonly kind: 'treaty'; readonly treaty: TreatyType };

/** `give` flows from `from` to `to`; `get` flows from `to` to `from`. */
export interface Deal {
  readonly from: Iso3;
  readonly to: Iso3;
  readonly give: readonly DealItem[];
  readonly get: readonly DealItem[];
}

export interface DealLine {
  readonly label: string;
  /** Value to the evaluating side, US$ bn equivalent (+ good for them). */
  readonly value: number;
}

export interface DealVerdict {
  readonly verdict: 'accept' | 'reject' | 'counter';
  /** Net value to the evaluating side, US$ bn equivalent. */
  readonly score: number;
  /** 0..1 shown as the acceptance bar; ≥ 0.5 exactly when the verdict is accept. */
  readonly likelihood: number;
  readonly reason: string;
  readonly lines: readonly DealLine[];
  readonly counter: Deal | null;
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
  /** 0..1 — radioactive fallout after a nuclear strike; decays slowly, tints the map (D-076). */
  fallout: number;
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
  | 'resolution'
  | 'embargo'
  | 'liftEmbargo'
  | 'secondarySanctions'
  | 'liftSecondary'
  | 'rallySanctions'
  | 'deal';

export interface Proposal {
  readonly id: number;
  readonly from: Iso3;
  readonly to: Iso3;
  readonly type: ProposalType;
  readonly turn: number;
  readonly text: string;
  /** For `deal` proposals: the package on offer (`from` is the AI, `to` the player). */
  readonly deal?: Deal;
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

/** A follow-up step of an event chain, due on a later turn (D-074). */
export interface ScheduledEvent {
  readonly eventId: string;
  readonly chain: string;
  readonly due: number;
  readonly target: Iso3 | null;
}

export type NewsCategory = 'war' | 'diplomacy' | 'economy' | 'politics' | 'disaster' | 'nuclear' | 'science' | 'security';

/** A wire story generated from the month's events (D-077). */
export interface WireStory {
  readonly id: number;
  readonly turn: number;
  readonly category: NewsCategory;
  /** 3 = breaking news (banner), 2 = top story, 1 = brief. */
  readonly priority: 1 | 2 | 3;
  readonly headline: string;
  readonly body: string;
  readonly dateline: string;
  readonly nations: Iso3[];
}

/** One nuclear detonation, for the aftermath and the end-of-game statistics (D-076). */
export interface NuclearRecord {
  readonly turn: number;
  readonly attacker: Iso3;
  readonly target: Iso3;
  readonly region: RegionId;
  /** People living in the struck region at the time. */
  readonly population: number;
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
  readonly kind: 'capitulation' | 'collapse' | 'nuclearWar' | 'election' | 'coup';
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
  /** Total trade embargoes, `from>to` (D-061). */
  embargoes: string[];
  /** Secondary sanctions, `from>to`: `from` penalises third parties that keep trading with `to`. */
  secondarySanctions: string[];
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
  /** World market and trade network (D-061). */
  economy: WorldEconomy;
  /** Monthly economic samples for the majors and the player (≤ 240 each). */
  history: Record<Iso3, EconSample[]>;
  /** Leader memories: holder → grievances and favours (D-071). */
  memory: Record<Iso3, MemoryEntry[]>;
  /** Recent diplomatic statements, newest last (≤ 40). */
  dispatches: Dispatch[];
  /** Live bloc membership and cohesion (members can leave). */
  blocs: Record<BlocId, BlocState>;
  /** UN Security Council. */
  un: UnState;
  /** War plans of the AI majors. */
  warPlans: Record<Iso3, WarPlan>;
  /** Balancing coalition against a runaway power, if one has formed. */
  coalition: BalancingCoalition | null;
  /** Basing rights, `host>guest`. */
  basing: string[];
  /** Aid delivered last month (D-072). */
  aid: AidFlow[];
  /** Donors that have suspended all military and financial aid (events, politics or tests). */
  aidSuspended: Iso3[];
  /** Player aid programmes: recipient → level 0–3 (each level 0.1 % of GDP a year). */
  playerAid: Record<Iso3, number>;
  /** Scheduled follow-up steps of event chains (D-074). */
  chains: ScheduledEvent[];
  /** Wire stories, newest last (≤ 150) (D-077). */
  wire: WireStory[];
  /** Global cooling from nuclear detonations, °C (D-076). */
  nuclearWinter: number;
  nuclearLog: NuclearRecord[];
  /** World GDP at the start (for the end-of-game statistics). */
  worldGdpStart: number;
}

export interface WorldEconomy {
  /** Market price index per resource, 1 = January 2027. */
  prices: Record<ResourceId, number>;
  /** World shortage per resource: 1 − delivered ÷ demanded. */
  shortage: Record<ResourceId, number>;
  /** World shortage at game start (prices are relative to it). */
  shortageRef: Record<ResourceId, number>;
  routes: TradeRoute[];
  /** Route multipliers at game start (baseline for the trade term), keyed `a|b`. */
  routeRef: Record<string, number>;
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
  | { readonly type: 'setTaxRate'; readonly rate: number }
  | { readonly type: 'issueWarBonds' }
  | { readonly type: 'queueProduction'; readonly unitType: UnitTypeId; readonly region: RegionId }
  | { readonly type: 'cancelProduction'; readonly id: number }
  | { readonly type: 'setResearch'; readonly tech: TechId }
  | { readonly type: 'moveUnits'; readonly unitIds: number[]; readonly target: RegionId }
  | { readonly type: 'propose'; readonly proposal: ProposalType; readonly target: Iso3 }
  | { readonly type: 'respond'; readonly proposalId: number; readonly accept: boolean }
  | { readonly type: 'resolveEvent'; readonly pendingId: string; readonly choice: number }
  /** Nuclear release needs two confirmations from the UI (D-076). */
  | { readonly type: 'nuclearStrike'; readonly target: Iso3; readonly region: RegionId; readonly confirmations: number }
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
  | { readonly type: 'asat'; readonly target: Iso3 }
  | { readonly type: 'proposeDeal'; readonly deal: Deal }
  | { readonly type: 'unPropose'; readonly kind: ResolutionKind; readonly target: Iso3 }
  | { readonly type: 'unVote'; readonly resolutionId: number; readonly vote: UnVote }
  | { readonly type: 'setAid'; readonly recipient: Iso3; readonly level: number }
  | { readonly type: 'leaveBloc'; readonly bloc: BlocId };

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
