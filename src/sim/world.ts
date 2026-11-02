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
import type { Iso3, RegionId, TechId, UnitTypeId } from './types';

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
  readonly terrain: string;
  readonly coastal: boolean;
  readonly capital: boolean;
  readonly sea: boolean;
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
  | { type: 'news'; text: string };

export interface Condition {
  readonly type: string;
  readonly nation?: string;
  readonly a?: string;
  readonly b?: string;
  readonly id?: string;
  readonly iso3?: readonly string[];
  readonly bloc?: string;
  readonly value?: number | boolean;
}

export interface EventMeta {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly scope: 'player' | 'world';
  readonly weight: number;
  readonly once: boolean;
  readonly cooldown: number;
  readonly conditions: readonly Condition[];
  readonly targetPick: string | null;
  readonly choices: readonly { label: string; tooltip: string; effects: readonly Effect[] }[];
  readonly flashpoint: string | null;
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
  readonly terrain: Readonly<Record<string, { defence: number; armorBonus: number }>>;
  readonly techs: ReadonlyMap<TechId, TechMeta>;
  readonly techList: readonly TechMeta[];
  readonly branches: readonly { id: string; name: string; color: string }[];
  readonly cities: readonly CityMeta[];
  /** Regions owned by each nation at start. */
  readonly regionsByNation: ReadonlyMap<Iso3, readonly RegionId[]>;
  /** National capital region per nation (falls back to the most populous region). */
  readonly capitalRegion: ReadonlyMap<Iso3, RegionId>;
}

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
  const regionList: RegionMeta[] = [];
  for (const r of regionsMeta.regions) {
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
      terrain: r.terrain,
      coastal: r.coastal,
      capital: r.capital,
      sea: false,
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
    scope: e.scope === 'world' ? 'world' : 'player',
    weight: Number(e.weight ?? 1),
    once: Boolean(e.once ?? false),
    cooldown: Number(e.cooldown ?? 12),
    conditions: (e.conditions as Condition[] | undefined) ?? [],
    targetPick: (e.targetPick as string | undefined) ?? null,
    choices: (e.choices as EventMeta['choices'] | undefined) ?? [],
    flashpoint,
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

  cached = {
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
    terrain: unitsData.terrain,
    techs,
    techList,
    branches: techsData.branches,
    cities,
    regionsByNation,
    capitalRegion,
  };
  return cached;
}

export function traitsOf(world: World, iso3: Iso3): Traits {
  return world.leaders.get(iso3)?.traits ?? DEFAULT_TRAITS;
}

export function nationName(world: World, iso3: Iso3 | null | undefined): string {
  if (!iso3) return 'Unclaimed';
  return world.nations.get(iso3)?.name ?? iso3;
}
