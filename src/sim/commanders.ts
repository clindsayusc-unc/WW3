/**
 * Generated commanders (D-059): a minority of land formations carry a named officer with one
 * simple trait. Names are assembled from short syllable pools keyed by the nation's world region
 * so they read plausibly; every commander is fictional and marked so. No real officers appear.
 */
import type { World } from './world';
import type { Commander, CommanderTrait, GameState, Iso3, Modifier } from './types';
import { roll } from './query';

interface NamePool {
  readonly given: readonly string[];
  readonly family: readonly string[];
}

const POOLS: Record<string, NamePool> = {
  west: {
    given: ['Anna', 'Erik', 'Lena', 'Marc', 'Sofia', 'Tomas', 'Clara', 'Johan', 'Ines', 'Pavel', 'Maren', 'Luca'],
    family: ['Varga', 'Lindqvist', 'Moreau', 'Brandt', 'Okafor-Reid', 'Castellani', 'Novak', 'Duarte', 'Hallberg', 'Ferrand', 'Keller', 'Rowan'],
  },
  slavic: {
    given: ['Dmitri', 'Olga', 'Andrei', 'Irina', 'Sergei', 'Yulia', 'Mykola', 'Oksana', 'Bogdan', 'Vera', 'Taras', 'Nina'],
    family: ['Voronin', 'Sadovska', 'Melnik', 'Gribov', 'Kravets', 'Orlova', 'Zhukovsky', 'Tarasenko', 'Belov', 'Rudenko', 'Polyakov', 'Yurchenko'],
  },
  eastAsia: {
    given: ['Wei', 'Jun', 'Mei', 'Hao', 'Li', 'Tao', 'Hiro', 'Yuki', 'Kenji', 'Min-jun', 'Seo-yeon', 'Ji-ho'],
    family: ['Zhao', 'Lin', 'Chen', 'Tanaka', 'Ishikawa', 'Mori', 'Park', 'Kang', 'Han', 'Xu', 'Sato', 'Yoon'],
  },
  southAsia: {
    given: ['Arjun', 'Priya', 'Vikram', 'Meera', 'Rohan', 'Asha', 'Imran', 'Faisal', 'Zara', 'Nadia', 'Kiran', 'Devika'],
    family: ['Rao', 'Malhotra', 'Iyer', 'Chaudhry', 'Bhatt', 'Khan', 'Sengupta', 'Nair', 'Qureshi', 'Deshmukh', 'Mirza', 'Pillai'],
  },
  middleEast: {
    given: ['Omar', 'Layla', 'Hassan', 'Reza', 'Darius', 'Yasmin', 'Tariq', 'Noor', 'Emre', 'Elif', 'Kemal', 'Samir'],
    family: ['Haddad', 'Farahani', 'Nasser', 'Demir', 'Rostami', 'Aziz', 'Yilmaz', 'Mansour', 'Karimi', 'Saleh', 'Kaya', 'Barzani'],
  },
  africa: {
    given: ['Kwame', 'Amara', 'Tendai', 'Zanele', 'Chidi', 'Fatou', 'Samuel', 'Abebe', 'Nia', 'Kofi', 'Lerato', 'Ibrahim'],
    family: ['Mensah', 'Okonkwo', 'Dlamini', 'Diallo', 'Abara', 'Mwangi', 'Bekele', 'Sow', 'Nkosi', 'Achebe', 'Toure', 'Habte'],
  },
  latin: {
    given: ['Mateo', 'Valentina', 'Diego', 'Camila', 'Rafael', 'Lucia', 'Andres', 'Mariana', 'Joao', 'Beatriz', 'Santiago', 'Paula'],
    family: ['Ortega', 'Salazar', 'Carvalho', 'Mendoza', 'Pereira', 'Rojas', 'Ibarra', 'Castillo', 'Quintero', 'Barros', 'Navarro', 'Fonseca'],
  },
  seAsia: {
    given: ['Minh', 'Linh', 'Arief', 'Dewi', 'Somchai', 'Nong', 'Rizal', 'Maya', 'Aung', 'Thiri', 'Jose', 'Mariel'],
    family: ['Nguyen', 'Santoso', 'Pham', 'Wijaya', 'Chaiyasit', 'Reyes', 'Tran', 'Hartono', 'Lim', 'Dela Cruz', 'Phan', 'Saputra'],
  },
};

const REGION_POOL: Record<string, string> = {
  'Western Europe': 'west',
  'North America': 'west',
  Oceania: 'west',
  'Eastern Europe': 'slavic',
  'Central Asia': 'slavic',
  'East Asia': 'eastAsia',
  'South Asia': 'southAsia',
  'Middle East': 'middleEast',
  'North Africa': 'middleEast',
  'Sub-Saharan Africa': 'africa',
  'South America': 'latin',
  'Central America': 'latin',
  Caribbean: 'latin',
  'Southeast Asia': 'seAsia',
};

export const TRAIT_INFO: Record<CommanderTrait, { label: string; description: string }> = {
  aggressive: {
    label: 'Aggressive',
    description: 'Presses the attack: +10 % attack firepower, −5 % on the defence.',
  },
  defensive: {
    label: 'Defensive',
    description: 'Digs in: +10 % defence firepower.',
  },
  logistician: {
    label: 'Logistician',
    description: 'Keeps the formation fed: supply counts as 15 points higher for this unit.',
  },
  cautious: {
    label: 'Cautious',
    description: 'Preserves the force: the formation suffers 12 % fewer losses, but attacks at −5 %.',
  },
};

const TRAITS: readonly CommanderTrait[] = ['aggressive', 'defensive', 'logistician', 'cautious'];

/** Share of newly raised land formations that come with a named commander. */
export const COMMANDER_CHANCE = 0.35;

/** Rolls a commander for a new land formation, or null. Deterministic through the state RNG. */
export function maybeCommander(world: World, state: GameState, owner: Iso3): Commander | null {
  if (roll(state) >= COMMANDER_CHANCE) return null;
  const region = world.nations.get(owner)?.region ?? 'Western Europe';
  const pool = POOLS[REGION_POOL[region] ?? 'west'] ?? POOLS.west!;
  const given = pool.given[Math.floor(roll(state) * pool.given.length)]!;
  const family = pool.family[Math.floor(roll(state) * pool.family.length)]!;
  const trait = TRAITS[Math.floor(roll(state) * TRAITS.length)]!;
  return { name: `${given} ${family}`, trait, fictional: true };
}

/** A generated, fictional name from the nation's regional pool (successors after elections and coups). */
export function fictionalName(world: World, state: GameState, iso: Iso3): string {
  const region = world.nations.get(iso)?.region ?? 'Western Europe';
  const pool = POOLS[REGION_POOL[region] ?? 'west'] ?? POOLS.west!;
  const given = pool.given[Math.floor(roll(state) * pool.given.length)]!;
  const family = pool.family[Math.floor(roll(state) * pool.family.length)]!;
  return `${given} ${family}`;
}

/** Attack-side modifier contributed by a commander, if any. */
export function commanderAttackModifier(c: Commander | null): Modifier | null {
  if (!c) return null;
  const f = c.trait === 'aggressive' ? 1.1 : c.trait === 'cautious' ? 0.95 : 1;
  if (f === 1) return null;
  return {
    label: 'Commander',
    factor: f,
    detail: `${c.name} (${TRAIT_INFO[c.trait].label.toLowerCase()}): ${TRAIT_INFO[c.trait].description}`,
  };
}

export function commanderDefenceModifier(c: Commander | null): Modifier | null {
  if (!c) return null;
  const f = c.trait === 'defensive' ? 1.1 : c.trait === 'aggressive' ? 0.95 : 1;
  if (f === 1) return null;
  return {
    label: 'Commander',
    factor: f,
    detail: `${c.name} (${TRAIT_INFO[c.trait].label.toLowerCase()}): ${TRAIT_INFO[c.trait].description}`,
  };
}

/** Supply bonus (added to the 0..1 level) from a logistician. */
export const commanderSupplyBonus = (c: Commander | null): number =>
  c?.trait === 'logistician' ? 0.15 : 0;

/** Loss multiplier for a cautious commander. */
export const commanderLossFactor = (c: Commander | null): number =>
  c?.trait === 'cautious' ? 0.88 : 1;
