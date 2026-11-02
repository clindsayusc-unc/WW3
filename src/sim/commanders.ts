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
    family: ['Voronin', 'Sadovsky', 'Melnik', 'Gribov', 'Kravets', 'Orlov', 'Zhukovsky', 'Tarasenko', 'Belov', 'Rudenko', 'Polyakov', 'Yurchenko'],
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

/** Country pools where the regional pool would read wrong (D-075: fictional successors). */
const COUNTRY_POOLS: Record<string, NamePool> = {
  anglo: {
    given: ['James', 'Sarah', 'Michael', 'Emily', 'Daniel', 'Rachel', 'Thomas', 'Laura', 'David', 'Hannah'],
    family: ['Carter', 'Mitchell', 'Hughes', 'Bennett', 'Foster', 'Reynolds', 'Sullivan', 'Walsh', 'Harper', 'Coleman'],
  },
  french: {
    given: ['Camille', 'Julien', 'Élodie', 'Mathieu', 'Claire', 'Antoine', 'Hélène', 'Nicolas'],
    family: ['Lefèvre', 'Girard', 'Rousseau', 'Fontaine', 'Mercier', 'Chevalier', 'Lambert', 'Faure'],
  },
  german: {
    given: ['Katrin', 'Jonas', 'Sabine', 'Matthias', 'Julia', 'Stefan', 'Anke', 'Florian'],
    family: ['Hoffmann', 'Krüger', 'Schäfer', 'Wagner', 'Lehmann', 'Becker', 'Vogel', 'Hartmann'],
  },
  turkish: {
    given: ['Emre', 'Elif', 'Kemal', 'Zeynep', 'Murat', 'Ayşe', 'Burak', 'Selin'],
    family: ['Yılmaz', 'Demir', 'Kaya', 'Şahin', 'Aydın', 'Öztürk', 'Arslan', 'Doğan'],
  },
  persian: {
    given: ['Reza', 'Mahsa', 'Darius', 'Leila', 'Kaveh', 'Shirin', 'Hamid', 'Nasrin'],
    family: ['Farahani', 'Rostami', 'Karimi', 'Tehrani', 'Moradi', 'Jafari', 'Ahmadi', 'Hosseini'],
  },
  hebrew: {
    given: ['Noa', 'Yossi', 'Tamar', 'Eitan', 'Maya', 'Avi', 'Shira', 'Gideon'],
    family: ['Levi', 'Mizrahi', 'Peretz', 'Friedman', 'Biton', 'Dahan', 'Avraham', 'Golan'],
  },
  arab: {
    given: ['Omar', 'Layla', 'Hassan', 'Noor', 'Tariq', 'Samir', 'Huda', 'Khalid'],
    family: ['Haddad', 'Nasser', 'Aziz', 'Mansour', 'Saleh', 'Barakat', 'Hamdan', 'Khoury'],
  },
  chinese: {
    given: ['Wei', 'Mei', 'Hao', 'Li', 'Tao', 'Jun', 'Xin', 'Lan'],
    family: ['Zhao', 'Lin', 'Chen', 'Xu', 'Wang', 'Liu', 'Huang', 'Zhou'],
  },
  japanese: {
    given: ['Hiro', 'Yuki', 'Kenji', 'Aiko', 'Takeshi', 'Naomi', 'Daisuke', 'Emi'],
    family: ['Tanaka', 'Ishikawa', 'Mori', 'Sato', 'Nakamura', 'Fujita', 'Ogawa', 'Kimura'],
  },
  korean: {
    given: ['Min-jun', 'Seo-yeon', 'Ji-ho', 'Hye-jin', 'Sung-min', 'Eun-ji', 'Dong-hyun', 'Su-a'],
    family: ['Park', 'Kang', 'Han', 'Yoon', 'Kim', 'Lee', 'Choi', 'Jung'],
  },
  filipino: {
    given: ['Jose', 'Mariel', 'Rafael', 'Andrea', 'Paolo', 'Liza', 'Carlo', 'Bea'],
    family: ['Reyes', 'Dela Cruz', 'Santos', 'Bautista', 'Mendoza', 'Villanueva', 'Ramos', 'Garcia'],
  },
  lusophone: {
    given: ['João', 'Beatriz', 'Rafael', 'Mariana', 'Lucas', 'Fernanda', 'Tiago', 'Larissa'],
    family: ['Carvalho', 'Pereira', 'Barros', 'Fonseca', 'Almeida', 'Ribeiro', 'Costa', 'Teixeira'],
  },
};
const COUNTRY_POOL: Record<string, string> = {
  USA: 'anglo', GBR: 'anglo', CAN: 'anglo', AUS: 'anglo', NZL: 'anglo', IRL: 'anglo',
  FRA: 'french', BEL: 'french', DEU: 'german', AUT: 'german', CHE: 'german',
  TUR: 'turkish', IRN: 'persian', ISR: 'hebrew',
  SAU: 'arab', ARE: 'arab', EGY: 'arab', IRQ: 'arab', SYR: 'arab', QAT: 'arab', KWT: 'arab', JOR: 'arab', LBN: 'arab', OMN: 'arab', BHR: 'arab', YEM: 'arab',
  CHN: 'chinese', TWN: 'chinese', SGP: 'chinese', JPN: 'japanese', KOR: 'korean', PRK: 'korean',
  PHL: 'filipino', BRA: 'lusophone', PRT: 'lusophone', AGO: 'lusophone', MOZ: 'lusophone',
};

/** Slavic surnames agree with the given name's gender (Orlov / Orlova, Zhukovsky / Zhukovskaya). */
const SLAVIC_FEMALE = new Set(['Olga', 'Irina', 'Yulia', 'Oksana', 'Vera', 'Nina']);
function agree(given: string, family: string): string {
  if (!SLAVIC_FEMALE.has(given)) return family;
  if (/sky$/.test(family)) return family.replace(/sky$/, 'skaya');
  if (/(ov|ev|in)$/.test(family)) return `${family}a`;
  return family;
}

function poolFor(world: World, iso: Iso3): NamePool {
  const c = COUNTRY_POOL[iso];
  if (c && COUNTRY_POOLS[c]) return COUNTRY_POOLS[c]!;
  const region = world.nations.get(iso)?.region ?? 'Western Europe';
  return POOLS[REGION_POOL[region] ?? 'west'] ?? POOLS.west!;
}

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
  const pool = poolFor(world, owner);
  const given = pool.given[Math.floor(roll(state) * pool.given.length)]!;
  const family = pool.family[Math.floor(roll(state) * pool.family.length)]!;
  const trait = TRAITS[Math.floor(roll(state) * TRAITS.length)]!;
  return { name: `${given} ${agree(given, family)}`, trait, fictional: true };
}

/** A generated, fictional name from the nation's regional pool (successors after elections and coups). */
export function fictionalName(world: World, state: GameState, iso: Iso3): string {
  const pool = poolFor(world, iso);
  const given = pool.given[Math.floor(roll(state) * pool.given.length)]!;
  const family = pool.family[Math.floor(roll(state) * pool.family.length)]!;
  return `${given} ${agree(given, family)}`;
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
