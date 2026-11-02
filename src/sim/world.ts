/**
 * Static world data: everything the simulation needs that never changes during a game.
 * Loaded from data/*.json (each file carries `source` + `asOf`, validated in tests).
 */
import regionsMeta from '../../data/regions.meta.json';
import nationsData from '../../data/nations.json';
import leadersData from '../../data/leaders.json';
import relationsData from '../../data/relations.json';
import flashpointsData from '../../data/flashpoints.json';
import eventsData from '../../data/events.json';
import unitsData from '../../data/units.json';
import techsData from '../../data/techs.json';
import citiesData from '../../data/cities.json';
import terrainData from '../../data/terrain.json';
import climateData from '../../data/climate.json';
import crossingsData from '../../data/crossings.json';
import infrastructureData from '../../data/infrastructure.json';
import chokepointsData from '../../data/chokepoints.json';
import resourcesData from '../../data/resources.json';
import tradeData from '../../data/trade.json';
import politicsData from '../../data/politics.json';
import economyData from '../../data/economy.json';
import agendasData from '../../data/agendas.json';
import unscData from '../../data/unsc.json';
import chainsData from '../../data/chains.json';
import factionsData from '../../data/factions.json';
import type { AgendaId, GameState, Iso3, RegionId, Regime, ResourceId, TechId, UnitTypeId } from './types';

/** A party or power faction with a trait profile from its public positions (data/factions.json, D-078). */
export interface FactionMeta {
  readonly id: string;
  readonly name: string;
  readonly kind: 'party' | 'faction' | 'military';
  readonly weight: number;
  readonly position: string;
  readonly url: string;
  readonly traits: Traits;
  /** How far a successor from this faction may stray from its profile, per trait. */
  readonly spread: number;
}

export interface NationFactions {
  readonly incumbent: string;
  readonly factions: readonly FactionMeta[];
}

/** A leader's long-term agenda from data/agendas.json (D-071). */
export interface AgendaMeta {
  readonly id: AgendaId;
  /** 0..1 pull of the agenda (default 1). */
  readonly weight: number;
  readonly targets: readonly Iso3[];
  readonly sphere: readonly Iso3[];
  readonly flashpoint: string | null;
  readonly basis: string;
  readonly url: string;
}

export interface UnscMeta {
  readonly permanent: readonly Iso3[];
  readonly elected: readonly { readonly iso3: Iso3; readonly until: number }[];
  readonly votesToPass: number;
}

/** A strategic resource from data/resources.json (D-061). */
export interface ResourceMeta {
  readonly id: ResourceId;
  readonly name: string;
  readonly unit: string;
  /** World output in `unit` at start (1.0 share = this much). */
  readonly worldOutput: number;
  /** Approximate value of a year's world output, US$ bn. */
  readonly worldValueUsdBn: number;
  /** Percentage points of annual growth lost at a 100 % shortage. */
  readonly gdpWeight: number;
  /** Share of demand that scales with GDP (the rest with population). */
  readonly demandGdpWeight: number;
  /** Extra demand per mobilisation level (fraction). */
  readonly warDemand: number;
  /** Share of a capitulated nation's capacity its conqueror can run. */
  readonly seizedYield: number;
  readonly description: string;
  readonly source: string;
  /** Share of world output by producer. */
  readonly producers: Readonly<Record<Iso3, number>>;
  readonly estimatedProducers: readonly Iso3[];
  /** 1 − Σ producers: diffuse output of many small producers. */
  readonly diffuse: number;
}

export type InputWeights = Readonly<Partial<Record<ResourceId, number>>>;

export interface TradePairMeta {
  readonly a: Iso3;
  readonly b: Iso3;
  /** Two-way goods trade, US$ bn/yr. */
  readonly volume: number;
  readonly sourced: boolean;
}

export interface PoliticsMeta {
  readonly regime: Regime;
  readonly termYears: number | null;
  /** False when the current effective leader is term-limited at the next election (D-075). */
  readonly incumbentEligible: boolean;
}

export type TerrainClass =
  | 'plains'
  | 'hills'
  | 'mountains'
  | 'desert'
  | 'jungle'
  | 'forest'
  | 'marsh'
  | 'urban'
  | 'arctic'
  | 'ice'
  | 'sea';

/** Area shares of MODIS IGBP land-cover groups (data/terrain.json). */
export interface CoverShares {
  readonly forest: number;
  readonly jungle: number;
  readonly woodland: number;
  readonly shrub: number;
  readonly savanna: number;
  readonly grassland: number;
  readonly marsh: number;
  readonly cropland: number;
  readonly urban: number;
  readonly ice: number;
  readonly barren: number;
  readonly water: number;
}

/** Twelve monthly values (January first) from data/climate.json. */
export interface ClimateMeta {
  readonly tempC: readonly number[];
  readonly precipMm: readonly number[];
  readonly winter: readonly number[];
  readonly monsoon: readonly number[];
  readonly heat: readonly number[];
}

/** A crossing feature on the border between two adjacent land regions (data/crossings.json). */
export interface CrossingMeta {
  readonly a: RegionId;
  readonly b: RegionId;
  readonly borderKm: number;
  readonly rivers: readonly string[];
  readonly mountain: boolean;
  readonly ranges: readonly string[];
  readonly borderRuggedness: number;
  readonly borderElev: number;
  readonly pass: string | null;
}

export interface ChokepointMeta {
  readonly id: string;
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
  readonly zones: readonly RegionId[];
  readonly shores: readonly RegionId[];
  readonly oilMbd: number | null;
  readonly tradeShare: number;
  readonly oilShock: number;
  readonly semiconductors: boolean;
  readonly dependents: Readonly<Record<Iso3, number>>;
  readonly note: string;
}

export interface RegionMeta {
  readonly id: RegionId;
  readonly name: string;
  readonly iso3: Iso3;
  readonly lat: number;
  readonly lon: number;
  readonly areaKm2: number;
  readonly populationShare: number;
  readonly population: number;
  readonly neighbours: readonly RegionId[];
  readonly terrain: TerrainClass;
  readonly coastal: boolean;
  readonly capital: boolean;
  readonly sea: boolean;
  /** Mean / standard deviation / maximum elevation in metres (ETOPO 2022). */
  readonly elevMean: number;
  readonly elevStd: number;
  readonly elevMax: number;
  /** Terrain ruggedness index: mean |Δelevation| to neighbouring 3.7 km cells, metres. */
  readonly ruggedness: number;
  readonly cover: CoverShares;
  /** Road + rail density index 0.08..1 (Natural Earth). */
  readonly infrastructure: number;
  /** Abstract port throughput (Σ harbour sizes, NGA World Port Index), 0 when landlocked. */
  readonly portCapacity: number;
  readonly majorPort: boolean;
  readonly ports: readonly { readonly name: string; readonly size: string }[];
  readonly climate: ClimateMeta | null;
  /** Connected water bodies the region borders (ids from the raster); landings need a shared one. */
  readonly waterBodies: readonly number[];
}

export interface NationMeta {
  readonly iso3: Iso3;
  readonly iso2: string;
  readonly name: string;
  readonly capital: string;
  readonly region: string;
  readonly population: number;
  readonly gdpUsdBn: number;
  readonly gdpGrowthPct: number;
  readonly debtToGdpPct: number;
  readonly defenceSpendUsdBn: number;
  readonly activePersonnel: number;
  readonly nuclearWarheads: number;
  readonly blocs: readonly string[];
  readonly resources: readonly string[];
  readonly major: boolean;
  readonly estimate: boolean;
}

export interface Traits {
  readonly aggression: number;
  readonly riskTolerance: number;
  readonly pragmatism: number;
  readonly nationalism: number;
  readonly paranoia: number;
  readonly economicPriority: number;
  readonly allianceLoyalty: number;
  readonly nuclearThreshold: number;
}

export type LeaderRole = 'headOfGovernment' | 'headOfState' | 'supremeLeader' | 'partyLeader';
export const LEADER_ROLES: readonly LeaderRole[] = ['headOfGovernment', 'headOfState', 'supremeLeader', 'partyLeader'];

export interface OfficeHolder {
  readonly name: string;
  readonly title: string;
  readonly party: string | null;
  readonly since: string;
}

/**
 * The playable leader and AI personality: whoever actually directs foreign and defence policy
 * (D-049). `name`/`title`/`traits`/`rationale` describe that person; the head of state and head of
 * government are kept as secondary fields for display.
 */
export interface LeaderMeta {
  readonly iso3: Iso3;
  readonly name: string;
  readonly title: string;
  readonly party: string | null;
  readonly since: string;
  readonly role: LeaderRole;
  /** Why this person directs foreign and defence policy. */
  readonly basis: string;
  readonly headOfState: OfficeHolder;
  readonly headOfGovernment: OfficeHolder | null;
  readonly nextElection: string | null;
  readonly traits: Traits;
  readonly rationale: string;
}

/** Raw shape of one `data/leaders.json` entry. */
interface RawLeader {
  iso3: string;
  effectiveLeader?: { name: string; title: string; party?: string | null; since: string; role: string; basis: string };
  headOfState: { name: string; title: string; party?: string | null; since: string };
  headOfGovernment: { name: string; title: string; party?: string | null; since: string } | null;
  nextElection?: string | null;
  traits: Traits;
  rationale: string;
}

const office = (o: { name: string; title: string; party?: string | null; since: string }): OfficeHolder => ({
  name: o.name,
  title: o.title,
  party: o.party ?? null,
  since: o.since,
});

export interface UnitTypeMeta {
  readonly id: UnitTypeId;
  readonly name: string;
  readonly domain: 'land' | 'air' | 'sea';
  readonly sidc: string;
  readonly attack: number;
  readonly defence: number;
  readonly antiAir: number;
  readonly speed: number;
  readonly range: number;
  readonly costBn: number;
  readonly buildMonths: number;
  readonly upkeepBn: number;
  readonly amphibious: boolean;
  readonly strike: number;
  readonly transport: number;
  readonly deterrent: boolean;
  readonly description: string;
}

export interface TechMeta {
  readonly id: TechId;
  readonly branch: string;
  readonly tier: number;
  readonly name: string;
  readonly cost: number;
  readonly requires: readonly TechId[];
  readonly framing: string;
  readonly effects: readonly { key: string; value: number }[];
}

export type Effect =
  | { type: 'relation'; a: string; b: string; delta: number }
  | { type: 'tension'; delta: number }
  | { type: 'flashpoint'; id: string; delta: number }
  | { type: 'stability'; nation: string; delta: number }
  | { type: 'treasury'; nation: string; pctGdp: number }
  | { type: 'gdp'; nation: string; pct: number }
  | { type: 'growth'; nation: string; delta: number; months: number }
  | { type: 'sanction'; from: string; to: string }
  | { type: 'liftSanction'; from: string; to: string }
  | { type: 'war'; a: string; b: string }
  | { type: 'peace'; a: string; b: string }
  | { type: 'defcon'; nation: string; delta: number }
  | { type: 'research'; nation: string; points: number }
  | { type: 'units'; nation: string; unitType: string; count: number }
  | { type: 'mobilize'; nation: string; level: number }
  | { type: 'warheads'; nation: string; delta: number }
  | { type: 'news'; text: string }
  /** Schedules the next step of an event chain `delay` months later (D-074). */
  | { type: 'chain'; event: string; delay?: number }
  /** The leader leaves office (health, resignation, assassination): a fictional successor takes over. */
  | { type: 'succession'; nation: string; cause: 'health' | 'resignation' | 'assassination' | 'impeachment' }
  | { type: 'legitimacy'; nation: string; delta: number }
  | { type: 'support'; nation: string; delta: number };

/** How an AI decision-maker leans when it picks a choice for itself (D-074). */
export type Stance = 'escalate' | 'hold' | 'deescalate';
export interface EventChoice {
  readonly label: string;
  readonly tooltip: string;
  readonly effects: readonly Effect[];
  readonly stance?: Stance;
  /** World events: probability of this outcome (choices without a decision-maker). */
  readonly chance?: number;
}

export interface Condition {
  readonly type: string;
  readonly nation?: string;
  readonly a?: string;
  readonly b?: string;
  readonly id?: string;
  readonly iso3?: readonly string[];
  readonly bloc?: string;
  readonly value?: number | boolean | string;
}

export interface EventMeta {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  /** player: the player's decision; world: an AI subject; chain: a step of a flashpoint chain (D-074). */
  readonly scope: 'player' | 'world' | 'chain';
  readonly weight: number;
  readonly once: boolean;
  readonly cooldown: number;
  readonly conditions: readonly Condition[];
  readonly targetPick: string | null;
  readonly choices: readonly EventChoice[];
  readonly flashpoint: string | null;
  /** Chain this event belongs to, and whether it is a follow-up step (never drawn at random). */
  readonly chain: string | null;
  readonly chainStep: boolean;
  /** Who decides a chain event: the first of these that is the player, else the first alive. */
  readonly actor: readonly string[];
  /** Fixed TARGET for chain events. */
  readonly target: string | null;
  /** Category for the news wire and the event deck. */
  readonly category: string;
}

export interface ChainMeta {
  readonly id: string;
  readonly name: string;
  readonly flashpoint: string;
  readonly entry: string;
  readonly steps: readonly string[];
}

export interface FlashpointMeta {
  readonly id: string;
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
  readonly nations: readonly Iso3[];
  readonly sides: readonly (readonly Iso3[])[];
  readonly tension: number;
  readonly description: string;
}

export interface CityMeta {
  readonly name: string;
  readonly iso3: Iso3;
  readonly lat: number;
  readonly lon: number;
  readonly population: number;
  readonly capital: boolean;
  readonly regionId: RegionId;
}

export interface World {
  readonly regions: ReadonlyMap<RegionId, RegionMeta>;
  readonly regionList: readonly RegionMeta[];
  readonly landCount: number;
  readonly nations: ReadonlyMap<Iso3, NationMeta>;
  readonly nationList: readonly NationMeta[];
  readonly majors: readonly Iso3[];
  readonly leaders: ReadonlyMap<Iso3, LeaderMeta>;
  readonly relations: ReadonlyMap<string, { value: number; reason: string }>;
  readonly flashpoints: readonly FlashpointMeta[];
  readonly events: readonly EventMeta[];
  readonly unitTypes: ReadonlyMap<UnitTypeId, UnitTypeMeta>;
  readonly unitTypeList: readonly UnitTypeMeta[];
  readonly techs: ReadonlyMap<TechId, TechMeta>;
  readonly techList: readonly TechMeta[];
  readonly branches: readonly { id: string; name: string; color: string }[];
  readonly cities: readonly CityMeta[];
  /** Regions owned by each nation at start. */
  readonly regionsByNation: ReadonlyMap<Iso3, readonly RegionId[]>;
  /** National capital region per nation (falls back to the most populous region). */
  readonly capitalRegion: ReadonlyMap<Iso3, RegionId>;
  /** Crossing features keyed by `crossingKey(a, b)` (numeric, order-independent). */
  readonly crossings: ReadonlyMap<number, CrossingMeta>;
  readonly chokepoints: readonly ChokepointMeta[];
  readonly chokepointsByZone: ReadonlyMap<RegionId, readonly ChokepointMeta[]>;
  readonly resources: readonly ResourceMeta[];
  readonly resourceById: ReadonlyMap<ResourceId, ResourceMeta>;
  readonly unitInputs: ReadonlyMap<UnitTypeId, InputWeights>;
  readonly branchInputs: ReadonlyMap<string, InputWeights>;
  readonly tradePairs: readonly TradePairMeta[];
  /** Regime and election term for nations with a researched leader (data/politics.json). */
  readonly politics: ReadonlyMap<Iso3, PoliticsMeta>;
  /** Inflation at start, % per year (IMF WEO, data/economy.json). */
  readonly startInflation: ReadonlyMap<Iso3, number>;
  /** Connected-water component of each sea zone (trade routes need a shared one). */
  readonly seaComponent: ReadonlyMap<RegionId, number>;
  /** Leader agendas (D-071); nations without an entry get a default from their regime. */
  readonly agendas: ReadonlyMap<Iso3, readonly AgendaMeta[]>;
  /** Parties and factions per nation with a researched leader (D-078). */
  readonly factions: ReadonlyMap<Iso3, NationFactions>;
  /** Flashpoint event chains (D-074). */
  readonly chains: readonly ChainMeta[];
  readonly eventById: ReadonlyMap<string, EventMeta>;
  readonly unsc: UnscMeta;
}

export const crossingKey = (a: RegionId, b: RegionId): number => (a < b ? a * 4096 + b : b * 4096 + a);

const NO_COVER: CoverShares = {
  forest: 0, jungle: 0, woodland: 0, shrub: 0, savanna: 0, grassland: 0, marsh: 0, cropland: 0,
  urban: 0, ice: 0, barren: 0, water: 1,
};

export const relationKey = (a: Iso3, b: Iso3): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
export const sanctionKey = (from: Iso3, to: Iso3): string => `${from}>${to}`;

/** Default trait set used for nations without a researched leader (D-021). */
export const DEFAULT_TRAITS: Traits = {
  aggression: 35,
  riskTolerance: 40,
  pragmatism: 60,
  nationalism: 50,
  paranoia: 40,
  economicPriority: 65,
  allianceLoyalty: 55,
  nuclearThreshold: 92,
};

let cached: World | null = null;

export function loadWorld(): World {
  if (cached) return cached;
  const terrainById = new Map(terrainData.regions.map((t) => [t.id, t]));
  const climateById = new Map(climateData.regions.map((c) => [c.id, c]));
  const infraById = new Map(infrastructureData.regions.map((i) => [i.id, i]));
  const regionList: RegionMeta[] = [];
  for (const r of regionsMeta.regions) {
    const t = terrainById.get(r.id);
    const c = climateById.get(r.id);
    const inf = infraById.get(r.id);
    if (!t || !c || !inf)
      throw new Error(`data/terrain|climate|infrastructure.json: region ${r.id} missing`);
    regionList.push({
      id: r.id,
      name: r.name,
      iso3: r.iso3,
      lat: r.lat,
      lon: r.lon,
      areaKm2: r.areaKm2,
      populationShare: r.populationShare,
      population: r.population,
      neighbours: r.neighbours,
      terrain: t.terrain as TerrainClass,
      coastal: r.coastal,
      capital: r.capital,
      sea: false,
      elevMean: t.elevMean,
      elevStd: t.elevStd,
      elevMax: t.elevMax,
      ruggedness: t.ruggedness,
      cover: t.cover,
      infrastructure: inf.infrastructure,
      portCapacity: r.coastal ? inf.portCapacity : 0,
      majorPort: r.coastal && inf.majorPort,
      ports: r.coastal ? inf.ports : [],
      climate: c,
      waterBodies: t.waterBodies,
    });
  }
  for (const z of regionsMeta.seaZones) {
    regionList.push({
      id: z.id,
      name: z.name,
      iso3: '',
      lat: z.lat,
      lon: z.lon,
      areaKm2: z.areaKm2,
      populationShare: 0,
      population: 0,
      neighbours: z.neighbours,
      terrain: 'sea',
      coastal: true,
      capital: false,
      sea: true,
      elevMean: 0,
      elevStd: 0,
      elevMax: 0,
      ruggedness: 0,
      cover: NO_COVER,
      infrastructure: 0,
      portCapacity: 0,
      majorPort: false,
      ports: [],
      climate: null,
      waterBodies: [],
    });
  }
  const regions = new Map(regionList.map((r) => [r.id, r]));

  const nationList: NationMeta[] = nationsData.nations.map((n) => ({
    iso3: n.iso3,
    iso2: n.iso2,
    name: n.name,
    capital: n.capital,
    region: n.region,
    population: n.population,
    gdpUsdBn: n.gdpUsdBn,
    gdpGrowthPct: n.gdpGrowthPct,
    debtToGdpPct: n.debtToGdpPct,
    defenceSpendUsdBn: n.defenceSpendUsdBn,
    activePersonnel: n.activePersonnel,
    nuclearWarheads: n.nuclearWarheads,
    blocs: n.blocs,
    resources: n.resources,
    major: n.major,
    estimate: n.estimate,
  }));
  const nations = new Map(nationList.map((n) => [n.iso3, n]));

  const leaders = new Map<Iso3, LeaderMeta>();
  for (const l of leadersData.leaders as unknown as RawLeader[]) {
    // No fallback to the head of state: a missing effective leader is a data error (D-049).
    const e = l.effectiveLeader;
    if (!e || !e.name || !LEADER_ROLES.includes(e.role as LeaderRole)) {
      throw new Error(`data/leaders.json: ${l.iso3} has no valid effectiveLeader`);
    }
    leaders.set(l.iso3, {
      iso3: l.iso3,
      name: e.name,
      title: e.title,
      party: e.party ?? null,
      since: e.since,
      role: e.role as LeaderRole,
      basis: e.basis,
      headOfState: office(l.headOfState),
      headOfGovernment: l.headOfGovernment ? office(l.headOfGovernment) : null,
      nextElection: l.nextElection ?? null,
      traits: l.traits,
      rationale: l.rationale,
    });
  }

  const relations = new Map<string, { value: number; reason: string }>();
  for (const p of relationsData.pairs)
    relations.set(relationKey(p.a, p.b), { value: p.value, reason: p.reason });

  const toEvent = (e: Record<string, unknown>, flashpoint: string | null): EventMeta => ({
    id: String(e.id),
    title: String(e.title),
    text: String(e.text),
    scope: e.scope === 'world' ? 'world' : e.scope === 'chain' ? 'chain' : 'player',
    weight: Number(e.weight ?? 1),
    once: Boolean(e.once ?? false),
    cooldown: Number(e.cooldown ?? 12),
    conditions: (e.conditions as Condition[] | undefined) ?? [],
    targetPick: (e.targetPick as string | undefined) ?? null,
    choices: (e.choices as EventMeta['choices'] | undefined) ?? [],
    flashpoint,
    chain: (e.chain as string | undefined) ?? null,
    chainStep: Boolean(e.chainStep ?? false),
    actor: (e.actor as string[] | undefined) ?? [],
    target: (e.target as string | undefined) ?? null,
    category: String(e.category ?? (flashpoint ? 'security' : 'politics')),
  });
  const events: EventMeta[] = [];
  for (const e of eventsData.events as unknown as Record<string, unknown>[])
    events.push(toEvent(e, null));
  const flashpoints: FlashpointMeta[] = [];
  for (const f of flashpointsData.flashpoints as unknown as Record<string, unknown>[]) {
    flashpoints.push({
      id: String(f.id),
      name: String(f.name),
      lat: Number(f.lat),
      lon: Number(f.lon),
      nations: f.nations as Iso3[],
      sides: f.sides as Iso3[][],
      tension: Number(f.tension),
      description: String(f.description ?? ''),
    });
    for (const e of (f.events as Record<string, unknown>[] | undefined) ?? [])
      events.push(toEvent(e, String(f.id)));
  }

  const chains: ChainMeta[] = [];
  for (const c of chainsData.chains as unknown as Record<string, unknown>[]) {
    const steps: string[] = [];
    for (const e of c.events as Record<string, unknown>[]) {
      const id = String(e.id);
      events.push(toEvent({ ...e, scope: 'chain', chain: c.id, chainStep: id !== c.entry, category: e.category ?? 'security' }, String(c.flashpoint)));
      steps.push(id);
    }
    chains.push({ id: String(c.id), name: String(c.name), flashpoint: String(c.flashpoint), entry: String(c.entry), steps });
  }

  const unitTypeList: UnitTypeMeta[] = unitsData.units.map((u) => {
    const x = u as Partial<UnitTypeMeta> & {
      id: string;
      name: string;
      domain: string;
      sidc: string;
    };
    return {
      id: x.id,
      name: x.name,
      domain: x.domain as UnitTypeMeta['domain'],
      sidc: x.sidc,
      attack: x.attack ?? 1,
      defence: x.defence ?? 1,
      antiAir: x.antiAir ?? 0,
      speed: x.speed ?? 1,
      range: x.range ?? 0,
      costBn: x.costBn ?? 1,
      buildMonths: x.buildMonths ?? 1,
      upkeepBn: x.upkeepBn ?? 0.1,
      amphibious: x.amphibious ?? false,
      strike: x.strike ?? 0,
      transport: x.transport ?? 0,
      deterrent: x.deterrent ?? false,
      description: x.description ?? '',
    };
  });
  const unitTypes = new Map(unitTypeList.map((u) => [u.id, u]));

  const techList: TechMeta[] = techsData.techs.map((t) => ({ ...t }));
  const techs = new Map(techList.map((t) => [t.id, t]));

  const cities: CityMeta[] = citiesData.cities;

  const regionsByNation = new Map<Iso3, RegionId[]>();
  for (const r of regionList) {
    if (r.sea || !nations.has(r.iso3)) continue;
    const list = regionsByNation.get(r.iso3) ?? [];
    list.push(r.id);
    regionsByNation.set(r.iso3, list);
  }
  const capitalRegion = new Map<Iso3, RegionId>();
  for (const c of cities)
    if (c.capital && nations.has(c.iso3) && !capitalRegion.has(c.iso3))
      capitalRegion.set(c.iso3, c.regionId);
  for (const [iso, list] of regionsByNation) {
    if (capitalRegion.has(iso)) continue;
    let best = list[0]!;
    for (const id of list)
      if ((regions.get(id)?.populationShare ?? 0) > (regions.get(best)?.populationShare ?? 0))
        best = id;
    capitalRegion.set(iso, best);
  }

  const crossings = new Map<number, CrossingMeta>();
  for (const e of crossingsData.edges) {
    if (!regions.get(e.a)?.neighbours.includes(e.b)) continue;
    crossings.set(crossingKey(e.a, e.b), e);
  }
  const chokepoints: ChokepointMeta[] = chokepointsData.chokepoints.map((c) => ({
    id: c.id,
    name: c.name,
    lat: c.lat,
    lon: c.lon,
    zones: c.zones,
    shores: c.shores,
    oilMbd: c.oilMbd,
    tradeShare: c.tradeShare,
    oilShock: c.oilShock,
    semiconductors: c.semiconductors,
    dependents: Object.fromEntries(
      Object.entries(c.dependents as Record<string, number | undefined>).filter(
        (e): e is [string, number] => typeof e[1] === 'number',
      ),
    ),
    note: c.note,
  }));
  const chokepointsByZone = new Map<RegionId, ChokepointMeta[]>();
  for (const c of chokepoints)
    for (const z of c.zones) chokepointsByZone.set(z, [...(chokepointsByZone.get(z) ?? []), c]);

  const resources: ResourceMeta[] = resourcesData.resources.map((r) => {
    const producers = r.producers as unknown as Record<string, number>;
    const listed = Object.values(producers).reduce((a, b) => a + b, 0);
    return {
      id: r.id as ResourceId,
      name: r.name,
      unit: r.unit,
      worldOutput: r.worldOutput,
      worldValueUsdBn: r.worldValueUsdBn,
      gdpWeight: r.gdpWeight,
      demandGdpWeight: r.demandGdpWeight,
      warDemand: r.warDemand,
      seizedYield: r.seizedYield,
      description: r.description,
      source: r.source,
      producers,
      estimatedProducers: r.estimatedProducers,
      diffuse: Math.max(0, 1 - listed),
    };
  });
  const toWeights = (o: Record<string, Record<string, number>>) =>
    new Map(Object.entries(o).map(([k, v]) => [k, v as InputWeights]));
  const tradeSourced = new Set(
    (tradeData.sourced as string[][]).map(([a, b]) => relationKey(a!, b!)),
  );
  const tradePairs: TradePairMeta[] = (tradeData.pairs as (string | number)[][])
    .map(([a, b, v]) => ({
      a: String(a),
      b: String(b),
      volume: Number(v),
      sourced: tradeSourced.has(relationKey(String(a), String(b))),
    }))
    .filter((p) => nations.has(p.a) && nations.has(p.b));
  const politics = new Map<Iso3, PoliticsMeta>(
    politicsData.regimes.map((r) => [
      r.iso3,
      { regime: r.regime as Regime, termYears: r.termYears, incumbentEligible: (r as { incumbentEligible?: boolean }).incumbentEligible !== false },
    ]),
  );
  const startInflation = new Map<Iso3, number>(
    Object.entries(economyData.inflation as Record<string, number>),
  );
  // Connected components of the sea-zone graph (flood fill over sea-to-sea adjacency).
  const seaComponent = new Map<RegionId, number>();
  let comp = 0;
  for (const z of regionList) {
    if (!z.sea || seaComponent.has(z.id)) continue;
    const stack = [z.id];
    seaComponent.set(z.id, comp);
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (const nb of regions.get(cur)!.neighbours) {
        if (!regions.get(nb)?.sea || seaComponent.has(nb)) continue;
        seaComponent.set(nb, comp);
        stack.push(nb);
      }
    }
    comp++;
  }

  const agendas = new Map<Iso3, AgendaMeta[]>();
  for (const e of agendasData.agendas as unknown as { iso3: string; agendas: Record<string, unknown>[] }[])
    agendas.set(
      e.iso3,
      e.agendas.map((a) => ({
        id: a.id as AgendaId,
        weight: typeof a.weight === 'number' ? a.weight : 1,
        targets: (a.targets as string[] | undefined) ?? [],
        sphere: (a.sphere as string[] | undefined) ?? [],
        flashpoint: (a.flashpoint as string | undefined) ?? null,
        basis: String(a.basis ?? ''),
        url: String(a.url ?? ''),
      })),
    );
  for (const n of nationList) {
    if (agendas.has(n.iso3)) continue;
    const autocracy = politics.get(n.iso3)?.regime === 'autocracy';
    agendas.set(n.iso3, [
      {
        id: autocracy ? 'regimeSurvival' : 'economicDevelopment',
        weight: 0.6,
        targets: [],
        sphere: [],
        flashpoint: null,
        basis: autocracy ? 'Default for an autocratic government without a researched agenda.' : 'Default for a government without a researched agenda.',
        url: '',
      },
    ]);
  }

  const factions = new Map<Iso3, NationFactions>();
  for (const n of factionsData.nations as unknown as { iso3: string; incumbent: string; factions: (Omit<FactionMeta, 'spread'> & { spread?: number })[] }[])
    factions.set(n.iso3, {
      incumbent: n.incumbent,
      factions: n.factions.map((f) => ({ ...f, kind: f.kind as FactionMeta['kind'], spread: f.spread ?? 18 })),
    });

  cached = {
    agendas,
    factions,
    chains,
    eventById: new Map(events.map((e) => [e.id, e])),
    unsc: {
      permanent: unscData.permanent,
      elected: unscData.elected,
      votesToPass: unscData.votesToPass,
    },
    regions,
    regionList,
    landCount: regionsMeta.landCount,
    nations,
    nationList,
    majors: nationList.filter((n) => n.major).map((n) => n.iso3),
    leaders,
    relations,
    flashpoints,
    events,
    unitTypes,
    unitTypeList,
    techs,
    techList,
    branches: techsData.branches,
    cities,
    regionsByNation,
    capitalRegion,
    crossings,
    chokepoints,
    chokepointsByZone,
    resources,
    resourceById: new Map(resources.map((r) => [r.id, r])),
    unitInputs: toWeights(resourcesData.unitInputs.units as Record<string, Record<string, number>>),
    branchInputs: toWeights(resourcesData.unitInputs.branches as Record<string, Record<string, number>>),
    tradePairs,
    politics,
    startInflation,
    seaComponent,
  };
  return cached;
}

/**
 * The traits driving a nation's AI. A fictional successor's generated traits (kept in the game
 * state, D-078) take precedence over the researched leader's; pass the state wherever a game is
 * running.
 */
export function traitsOf(world: World, iso3: Iso3, state?: GameState): Traits {
  return state?.nations[iso3]?.leaderTraits ?? world.leaders.get(iso3)?.traits ?? DEFAULT_TRAITS;
}

export function nationName(world: World, iso3: Iso3 | null | undefined): string {
  if (!iso3) return 'Unclaimed';
  return world.nations.get(iso3)?.name ?? iso3;
}
