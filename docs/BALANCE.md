# Balance: geography and the calibration scenarios

How real geography shapes strategy in the simulation, the numbers behind it, and the scenario tests
that pin them (`src/sim/scenarios.test.ts`, `src/sim/geography.test.ts`). Values are game design;
the inputs they act on are real data (`docs/DATA_SOURCES.md`). Decisions D-050 to D-053.

## Terrain (`src/sim/terrain.ts`)

Each land region has a terrain class derived from ETOPO 2022 relief and MODIS land cover
(`data/terrain.json`, classifier documented in the file). The class sets:

| Terrain   | Defender × | Armour × | Infantry / special × | Air support × | Move cost | Supply loss / region |
| --------- | ---------- | -------- | -------------------- | ------------- | --------- | -------------------- |
| Plains    | 1.0        | 1.15     | 1.0 / 1.0            | 1.0           | 1.0       | 8 %                  |
| Desert    | 1.0        | 1.10     | 1.0 / 1.0            | 1.1           | 1.2       | 14 %                 |
| Forest    | 1.3        | 0.85     | 1.05 / 1.1           | 0.85          | 1.3       | 10 %                 |
| Hills     | 1.4        | 0.80     | 1.05 / 1.1           | 0.9           | 1.4       | 10 %                 |
| Marsh     | 1.5        | 0.60     | 1.0 / 1.1            | 0.9           | 1.8       | 15 %                 |
| Arctic    | 1.3        | 0.70     | 0.95 / 1.05          | 0.85          | 1.8       | 18 %                 |
| Jungle    | 2.0        | 0.50     | 1.0 / 1.15           | 0.6           | 2.0       | 20 %                 |
| Urban     | 2.0        | 0.60     | 1.1 / 1.15           | 0.75          | 1.1       | 6 %                  |
| Mountains | 2.5        | 0.50     | 1.0 / 1.15           | 0.6           | 2.2       | 22 %                 |
| Ice       | 1.5        | 0.50     | 0.9 / 1.0            | 0.8           | 3.0       | 30 %                 |

Mechanised formations take 60 % of the armour penalty, artillery 30 %. Supply loss is multiplied
by `1.4 − 0.8 × infrastructure` (road/rail density index), so a mountain region with no roads
loses ~31 % per hop and a motorway plain ~5 %.

## Crossings (`data/crossings.json`, `src/sim/geography.ts`)

Attacks across a border with a river along it pay ×0.75; across a mountain border ×0.7 (×0.8
through a named pass). Engineering tech (`crossing` modifier, "Combat Engineering & Bridging")
recovers up to half of the penalty. Units already inside the region — a bridgehead — pay nothing,
so the penalty bites on the first wave and disappears once a foothold is held. Crossings also add
movement cost (river +0.3, mountains +0.5, pass +0.3) and supply loss (+3 % / +6 %).

## Movement

A land unit has `speed` movement points a month (infantry 1, mechanised/armour 2). Entering a
region costs its terrain cost × weather × crossing. Progress banks across months, so infantry needs
three months to cross a mountain region in winter (2.2 × 1.8 ≈ 4) but one month on summer plains.

## Supply (`runSupply`)

Every region a nation owns and controls is a depot (level `0.8 + 0.2 × infrastructure`, reduced for
exclaves cut off from the capital). From depots, supply spreads along friendly land, losing the
terrain/infrastructure share per hop, and over sea zones from ports: 5 % per zone, +12–30 % where
enemy submarines hunt (halved by escorts), and capped on arrival by the destination port
(`0.35 + 0.15 × port capacity`; a bare beach caps at 35 %). Allies pass supply through their
territory. Units fight at `0.5 + 0.5 × supply`; below 25 % they are cut off (−4 strength/month).

## Oceans and power projection

- A landing needs sea control (friendly naval power ≥ hostile, at least one ship) in every zone on
  the route, the target must share a connected water body with the embarkation region, and the
  reach is 700 km for self-lifting marines/special forces, 2,000 km with amphibious lift.
- Amphibious groups carry two formations each per month (`liftCapacity`); marines and special
  forces lift themselves across one zone. Other formations wait for shipping.
- Assaulting a defended coast from the sea: ×0.5 (×0.7 with sea dominance and ≥ 60 % air
  superiority); defenders attacked only from the sea get ×1.3 (coastal defence).
- Convoys need zones without a commanding hostile fleet; submarines cut them.

## Strategic depth and seasons

Occupiers in hostile-owned regions suffer partisans: `(1.5 + 0.8 × depth) × 1.3` strength a
month in countries with ≥ 20 regions (×1.1 for ≥ 10), where depth is the number of land steps to
the nearest region the occupier (or an ally) both owns and controls. Recovery in occupied territory
runs at 35 % of the home rate and stops entirely in deep winter.

Weather comes from the MERRA-2 monthly climatology per region (`data/climate.json`): winter
`clamp(−T/15)`, monsoon `clamp((P − 150)/250)`, heat `clamp((T − 30)/10)`. Effects: attack
×(1 − 0.35 w)(1 − 0.3 m)(1 − 0.15 h); air support ×(1 − 0.25 w)(1 − 0.45 m); movement
×(1 + 0.8 w)(1 + 0.6 m)(1 + 0.25 h); attrition off own soil 8 w + 3 m + 4 h strength a month
(a quarter of that at home). Seasons follow the in-game month, so the southern hemisphere's winter
is July.

## Chokepoints (`data/chokepoints.json`, `updateChokepoints`)

Twelve straits. A shore controller at war can close one (the AI does so when an enemy depends on
it more than it does itself); submarines or destroyers in the strait can mine it. Closed straits
block hostile fleets and convoys; enemy naval dominance over every adjacent zone contests the
closure. Economics: the oil-price index rises by the strait's `oilShock` (Hormuz +60 %, Malacca
+25 %, Suez / Bab el-Mandeb +10 %, …); importers lose 3 pp of growth per +1.0 of index, exporters
gain 2 pp; nations listed as `dependents` lose `6 × share` pp while it is closed (half while
contested). Closing the Taiwan Strait or Malacca also cuts research speed by 15 % and raises
production costs for every nation without its own semiconductor industry.

## Calibration scenarios

Scripted campaigns on the real map with the real starting forces (plus documented additions where
the economy cap under-counts an army). The driver orders the attacker's stacks toward an objective
each month, attacking in front-width waves when the odds reach a threshold; everyone else is the
built-in AI. Numbers from the run on 2026-11-02 (seeded, deterministic).

| Scenario                                       | Result                                                                                                                                        | Assertion                                                                      |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| US corps (24 formations, carriers in the Gulf) vs mobilised Iran (≈ 50 formations) | Khuzestan taken in month 1; no attack on the Zagros ever reaches 0.7:1 odds; the corps is ground down on the coast by heat, partisans and counter-attacks (2,400 → 507 strength over 18 months). | coast ≤ 6 months; Tehran ≥ 9 months or never; attacker losses > 250          |
| Invasion of the continental US                 | No sea route to California exists while the US Navy holds the Pacific (the uncontested route is > 3 zones); no Chinese unit can land anywhere in the US. A force granted total naval dominance and already ashore holds nothing after 12 months. | route null; no landing targets; ≤ 1 US region held; landed strength < 300     |
| Russia vs Baltics, no NATO                     | Tallinn month 1, Riga month 2, Vilnius month 3.                                                                                                | ≥ 2 capitals, first within 3 months                                             |
| Russia vs Estonia with NATO pact               | 30 NATO members enter; Tallinn falls in month 2 but Russia loses 8 home regions to NATO counter-attacks within 4 months.                       | Tallinn holds, or Russia loses home regions, or its army shrinks 30 %           |
| China vs Taiwan (US fleet in the strait)       | No sea control, no landing possible.                                                                                                         | `hasSeaControl` false; Taipei not a landing target                              |
| China vs Taiwan (US stays out, PLAN controls strait) | Taipei falls in month 3 after 8 battles; 2,700 strength (≈ 27 formations) lost in 9 months.                                                   | losses > 1,500; Taipei ≥ 3 months                                               |
| KPA (≈ 44 formations) across the DMZ           | Gyeonggi (urban) in month 5; Seoul still South Korean after 8 months; attacker −574, defender −859.                                            | Seoul ≥ 4 months; attacker losses > 500; defender losses > 300                  |
| Chinese army group two regions deep in Russia  | Winter (Dec–Mar): −2,257 strength in 4 months with one battle. Summer: −1,335 with four battles.                                              | winter losses > 1.5 × summer and > 1,200                                        |
| India vs China on the LAC / China vs India     | India never finds 0.6:1 odds against Tibet; China takes Ladakh in month 6 for 1,600 strength and nothing more.                                | each side ≤ 2 regions                                                           |

Why these ranges: the Gulf coast is flat and within reach of carrier air, so it should fall fast;
the Zagros (×2.5, armour ×0.5, air ×0.6, mountain border ×0.7, 22 % supply loss per hop) is where
numbers stop mattering. Crossing an ocean against a fleet is the hardest thing in the game by
design: without control of every zone there is no route, and a beach without a port cannot feed a
corps. The Baltics are small, flat and a day's drive from Russian depots; only the alliance changes
that. Taiwan is three regions of cities and mountains behind a strait, and Korea's border is a
conurbation. Siberia in January kills more soldiers than the Russians do. The Himalaya is a wall.

Tuning notes: the attacker in the Iran run never attacks because the driver's 0.7 threshold is
conservative; a human would probe at worse odds and lose faster. Partisan attrition is deliberately
mild per month and brutal over a year. If a future force-size pass raises Iran's and North Korea's
standing armies, remove the unit additions in the tests.
