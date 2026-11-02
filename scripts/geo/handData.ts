/**
 * Hand-compiled geography for scripts/build-geography.ts: named mountain passes and maritime
 * chokepoints. Coordinates are public facts (Wikipedia / Britannica); oil-flow figures come from
 * the US EIA "World Oil Transit Chokepoints" (2024 update; 2023 volumes) and its Strait of Hormuz
 * fact sheet (2025). Trade shares are rounded public estimates; `oilShock`, `semiconductors` and
 * `dependents` are game-design values (see docs/BALANCE.md).
 */

export interface PassDef {
  name: string;
  lat: number;
  lon: number;
  /** Mountain system, for tooltips. */
  range: string;
}

export const PASSES: PassDef[] = [
  { name: 'Khyber Pass', lat: 34.08, lon: 71.1, range: 'Spin Ghar / Hindu Kush' },
  { name: 'Bolan Pass', lat: 29.75, lon: 67.55, range: 'Central Brahui Range' },
  { name: 'Khojak Pass', lat: 30.85, lon: 66.6, range: 'Toba Kakar Range' },
  { name: 'Gomal Pass', lat: 31.9, lon: 69.9, range: 'Sulaiman Range' },
  { name: 'Salang Pass', lat: 35.32, lon: 69.03, range: 'Hindu Kush' },
  { name: 'Khunjerab Pass', lat: 36.85, lon: 75.43, range: 'Karakoram' },
  { name: 'Karakoram Pass', lat: 35.51, lon: 77.82, range: 'Karakoram' },
  { name: 'Zoji La', lat: 34.28, lon: 75.47, range: 'Great Himalaya' },
  { name: 'Shipki La', lat: 31.83, lon: 78.74, range: 'Himalaya' },
  { name: 'Lipulekh Pass', lat: 30.23, lon: 81.03, range: 'Himalaya' },
  { name: 'Nathu La', lat: 27.39, lon: 88.83, range: 'Himalaya (Sikkim)' },
  { name: 'Jelep La', lat: 27.37, lon: 88.87, range: 'Himalaya (Sikkim)' },
  { name: 'Torugart Pass', lat: 40.52, lon: 75.4, range: 'Tian Shan' },
  { name: 'Irkeshtam Pass', lat: 39.68, lon: 73.9, range: 'Pamir–Alay' },
  { name: 'Dzungarian Gate', lat: 45.3, lon: 82.4, range: 'Dzungarian Alatau' },
  { name: 'Paitak Pass', lat: 34.26, lon: 45.67, range: 'Zagros' },
  { name: 'Piranshahr (Tamarchin) Pass', lat: 36.7, lon: 45.1, range: 'Zagros / Kurdistan' },
  { name: 'Darial Gorge', lat: 42.74, lon: 44.62, range: 'Greater Caucasus' },
  { name: 'Roki Tunnel', lat: 42.59, lon: 44.1, range: 'Greater Caucasus' },
  { name: 'Mamison Pass', lat: 42.71, lon: 43.98, range: 'Greater Caucasus' },
  { name: 'Cilician Gates', lat: 37.28, lon: 34.78, range: 'Taurus' },
  { name: 'Brenner Pass', lat: 47.0, lon: 11.5, range: 'Alps' },
  { name: 'St. Gotthard Pass', lat: 46.56, lon: 8.56, range: 'Alps' },
  { name: 'Simplon Pass', lat: 46.25, lon: 8.03, range: 'Alps' },
  { name: 'Mont Cenis / Fréjus', lat: 45.08, lon: 6.7, range: 'Alps' },
  { name: 'Great St Bernard Pass', lat: 45.87, lon: 7.17, range: 'Alps' },
  { name: 'Somport Pass', lat: 42.8, lon: -0.53, range: 'Pyrenees' },
  { name: 'Roncesvalles Pass', lat: 43.02, lon: -1.32, range: 'Pyrenees' },
  { name: 'Col du Perthus', lat: 42.47, lon: 2.86, range: 'Pyrenees' },
  { name: 'Shipka Pass', lat: 42.75, lon: 25.32, range: 'Balkan Mountains' },
  { name: 'Dukla Pass', lat: 49.42, lon: 21.7, range: 'Carpathians' },
  { name: 'Veretsky (Verecke) Pass', lat: 48.79, lon: 23.03, range: 'Carpathians' },
  { name: 'Predeal Pass', lat: 45.5, lon: 25.58, range: 'Carpathians' },
  { name: 'Thermopylae', lat: 38.8, lon: 22.55, range: 'Kallidromo' },
  { name: 'Uspallata / Los Libertadores', lat: -32.83, lon: -70.08, range: 'Andes' },
  { name: 'Paso de Jama', lat: -23.2, lon: -67.0, range: 'Andes' },
  { name: 'Cardenal Samoré Pass', lat: -40.7, lon: -71.9, range: 'Andes' },
  { name: 'Chilkoot Pass', lat: 59.7, lon: -135.3, range: 'Coast Mountains' },
];

export interface ChokepointDef {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Sea points on each side; resolved to sea-zone ids. */
  zoneProbes: [number, number][];
  /** Land points whose regions control the strait; resolved to region ids. */
  shoreProbes: [number, number][];
  /** EIA petroleum flow, million barrels per day (2023), where published. */
  oilMbd: number | null;
  /** Rough share of world seaborne trade passing through (public estimates). */
  tradeShare: number;
  /** Oil-price index increase while closed (game design). */
  oilShock: number;
  /** True when closure disrupts semiconductor flows (game design). */
  semiconductors: boolean;
  /** GDP-growth exposure by nation while closed (game design, share 0..1). */
  dependents: Record<string, number>;
  note: string;
}

export const CHOKEPOINTS: ChokepointDef[] = [
  {
    id: 'hormuz',
    name: 'Strait of Hormuz',
    lat: 26.56,
    lon: 56.25,
    zoneProbes: [
      [26.3, 54.5],
      [25.0, 57.8],
    ],
    shoreProbes: [
      [27.2, 56.3],
      [26.1, 56.3],
    ],
    oilMbd: 20.9,
    tradeShare: 0.05,
    oilShock: 0.6,
    semiconductors: false,
    dependents: {
      IRN: 0.8, IRQ: 0.9, KWT: 1.0, QAT: 0.9, BHR: 0.9, ARE: 0.5, SAU: 0.4,
      CHN: 0.15, IND: 0.2, JPN: 0.3, KOR: 0.3, TWN: 0.2, SGP: 0.2, PAK: 0.15, THA: 0.1,
    },
    note: 'About a fifth of world petroleum liquids consumption transits Hormuz; most Gulf exporters have no alternative outlet.',
  },
  {
    id: 'bab-el-mandeb',
    name: 'Bab el-Mandeb',
    lat: 12.6,
    lon: 43.3,
    zoneProbes: [
      [14.5, 41.8],
      [12.2, 45.0],
    ],
    shoreProbes: [
      [13.3, 43.9],
      [11.8, 42.8],
    ],
    oilMbd: 8.8,
    tradeShare: 0.12,
    oilShock: 0.1,
    semiconductors: false,
    dependents: { EGY: 0.3, SAU: 0.1, ISR: 0.1, DJI: 0.5, YEM: 0.3, ITA: 0.05, FRA: 0.05, DEU: 0.05, NLD: 0.05, GRC: 0.1 },
    note: 'Gateway between the Red Sea/Suez route and the Indian Ocean; closure forces Asia–Europe traffic round the Cape.',
  },
  {
    id: 'suez',
    name: 'Suez Canal',
    lat: 30.5,
    lon: 32.35,
    zoneProbes: [
      [31.8, 32.3],
      [28.5, 33.2],
    ],
    shoreProbes: [
      [30.6, 31.8],
      [29.8, 33.2],
    ],
    oilMbd: 8.8,
    tradeShare: 0.12,
    oilShock: 0.1,
    semiconductors: false,
    dependents: { EGY: 0.6, ITA: 0.08, GRC: 0.1, FRA: 0.05, DEU: 0.05, NLD: 0.06, ESP: 0.05, TUR: 0.05, ISR: 0.1, IND: 0.05 },
    note: 'Roughly 12 % of world trade; Egypt earns several billion dollars a year in tolls.',
  },
  {
    id: 'malacca',
    name: 'Strait of Malacca',
    lat: 2.5,
    lon: 101.5,
    zoneProbes: [
      [6.0, 97.0],
      [1.2, 104.5],
    ],
    shoreProbes: [
      [3.0, 101.6],
      [1.5, 100.5],
      [1.35, 103.8],
    ],
    oilMbd: 23.7,
    tradeShare: 0.25,
    oilShock: 0.25,
    semiconductors: true,
    dependents: { CHN: 0.4, JPN: 0.4, KOR: 0.4, TWN: 0.3, SGP: 0.8, MYS: 0.4, IDN: 0.15, THA: 0.2, VNM: 0.2, IND: 0.1, AUS: 0.1 },
    note: 'Shortest sea route between the Indian Ocean and East Asia; a quarter of world trade and most of East Asia’s oil imports.',
  },
  {
    id: 'taiwan-strait',
    name: 'Taiwan Strait',
    lat: 24.5,
    lon: 119.5,
    zoneProbes: [
      [26.5, 121.5],
      [22.5, 118.5],
      [24.5, 119.5],
    ],
    shoreProbes: [
      [26.0, 118.5],
      [24.0, 120.8],
    ],
    oilMbd: null,
    tradeShare: 0.2,
    oilShock: 0.05,
    semiconductors: true,
    dependents: { TWN: 0.7, CHN: 0.2, JPN: 0.3, KOR: 0.3, PHL: 0.1, VNM: 0.1, HKG: 0.3 },
    note: 'Over a fifth of global maritime trade and almost all of Taiwan’s leading-edge chip exports pass through or beside it.',
  },
  {
    id: 'turkish-straits',
    name: 'Bosporus & Dardanelles',
    lat: 40.7,
    lon: 28.5,
    zoneProbes: [
      [41.6, 29.5],
      [39.8, 25.5],
    ],
    shoreProbes: [
      [41.1, 28.9],
      [40.2, 26.6],
    ],
    oilMbd: 3.1,
    tradeShare: 0.03,
    oilShock: 0.05,
    semiconductors: false,
    dependents: { RUS: 0.15, UKR: 0.4, ROU: 0.2, BGR: 0.25, GEO: 0.4, TUR: 0.1, KAZ: 0.1 },
    note: 'The Black Sea’s only outlet; governed by the Montreux Convention in peacetime.',
  },
  {
    id: 'gibraltar',
    name: 'Strait of Gibraltar',
    lat: 35.95,
    lon: -5.6,
    zoneProbes: [
      [35.9, -7.0],
      [36.0, -4.0],
    ],
    shoreProbes: [
      [36.3, -5.6],
      [35.5, -5.7],
    ],
    oilMbd: null,
    tradeShare: 0.1,
    oilShock: 0.05,
    semiconductors: false,
    dependents: { ESP: 0.1, ITA: 0.1, FRA: 0.05, GRC: 0.1, TUR: 0.1, MAR: 0.3, DZA: 0.3, EGY: 0.1 },
    note: 'Entrance to the Mediterranean from the Atlantic.',
  },
  {
    id: 'panama',
    name: 'Panama Canal',
    lat: 9.1,
    lon: -79.7,
    zoneProbes: [
      [9.6, -79.6],
      [8.3, -79.6],
    ],
    shoreProbes: [[9.0, -79.9]],
    oilMbd: 2.1,
    tradeShare: 0.05,
    oilShock: 0.03,
    semiconductors: false,
    dependents: { PAN: 0.6, USA: 0.03, CHL: 0.1, PER: 0.1, ECU: 0.15, COL: 0.05, JPN: 0.03, KOR: 0.03 },
    note: 'About 5 % of world trade; the US east coast–Asia route.',
  },
  {
    id: 'giuk',
    name: 'GIUK Gap',
    lat: 62.5,
    lon: -12.0,
    zoneProbes: [
      [62.0, -10.0],
      [66.5, -27.0],
      [60.5, -4.0],
    ],
    shoreProbes: [
      [64.8, -18.5],
      [58.5, -4.0],
    ],
    oilMbd: null,
    tradeShare: 0.0,
    oilShock: 0,
    semiconductors: false,
    dependents: { ISL: 0.3, NOR: 0.1 },
    note: 'Naval chokepoint between the Norwegian Sea and the North Atlantic (Greenland–Iceland–UK); no trade effect, but it gates Atlantic access for northern fleets.',
  },
  {
    id: 'korea-strait',
    name: 'Korea Strait',
    lat: 34.5,
    lon: 129.0,
    zoneProbes: [
      [34.0, 128.5],
      [35.5, 130.5],
    ],
    shoreProbes: [
      [35.2, 129.1],
      [33.6, 130.4],
    ],
    oilMbd: null,
    tradeShare: 0.04,
    oilShock: 0.02,
    semiconductors: true,
    dependents: { KOR: 0.3, JPN: 0.15, RUS: 0.05, PRK: 0.2 },
    note: 'Links the East China Sea and the Sea of Japan; the Vladivostok route.',
  },
  {
    id: 'danish-straits',
    name: 'Danish Straits',
    lat: 56.0,
    lon: 11.0,
    zoneProbes: [
      [57.5, 10.5],
      [55.0, 13.5],
    ],
    shoreProbes: [
      [55.5, 11.8],
      [56.5, 9.5],
      [56.0, 13.0],
    ],
    oilMbd: 3.2,
    tradeShare: 0.03,
    oilShock: 0.05,
    semiconductors: false,
    dependents: { RUS: 0.2, FIN: 0.4, EST: 0.4, LVA: 0.4, LTU: 0.4, POL: 0.15, SWE: 0.2, DNK: 0.1, DEU: 0.03 },
    note: 'The Baltic’s outlet; Russian Baltic oil exports and the Baltic states’ seaborne trade.',
  },
  {
    id: 'bering',
    name: 'Bering Strait',
    lat: 65.8,
    lon: -169.0,
    zoneProbes: [
      [68.0, -170.0],
      [63.5, -172.0],
    ],
    shoreProbes: [
      [64.8, -165.4],
      [66.0, -173.5],
    ],
    oilMbd: null,
    tradeShare: 0.002,
    oilShock: 0,
    semiconductors: false,
    dependents: { RUS: 0.02 },
    note: 'Arctic gateway between the Pacific and the Northern Sea Route.',
  },
];
