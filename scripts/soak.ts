/** Dev tool: runs N turns headless and prints timing + world statistics. node scripts/soak.ts [turns] [player] */
import { applyCommand, createGame } from '../src/sim/game.ts';
import { loadWorld } from '../src/sim/world.ts';

const turns = Number(process.argv[2] ?? '24');
const player = process.argv[3] ?? 'USA';
const world = loadWorld();
let g = createGame({ seed: 2027, player, scenario: 'world-2027' }, world);
const t0 = performance.now();
const history: typeof g.log = [];
for (let i = 0; i < turns; i++) {
  const t = performance.now();
  g = applyCommand(world, g, { type: 'endTurn' });
  history.push(...g.log.filter((l) => l.turn === g.turn - 1));
  if (i < 3 || i % 12 === 11)
    console.log(
      `turn ${g.turn} ${(performance.now() - t).toFixed(0)} ms | wars ${g.wars.length} units ${Object.keys(g.units).length} tension ${g.globalTension.toFixed(0)} alive ${Object.values(g.nations).filter((n) => n.alive).length}`,
    );
}
console.log(`total ${(performance.now() - t0).toFixed(0)} ms for ${turns} turns`);
const worst = Object.values(g.nations)
  .sort((a, b) => b.debt / b.gdp - a.debt / a.gdp)
  .slice(0, 5)
  .map(
    (n) =>
      `${n.iso3} debt/gdp ${(n.debt / n.gdp).toFixed(1)} upkeep ${n.finances.upkeep.toFixed(2)} rev ${n.finances.revenue.toFixed(2)}`,
  );
console.log(worst.join('\n'));
const seen = new Set<string>();
console.log('major events:');
console.log(
  history
    .filter(
      (l) =>
        ['war', 'capitulation', 'peace', 'nuclear'].includes(l.kind) ||
        (l.kind === 'event' && l.alert),
    )
    .filter((l) => {
      const k = l.turn + l.text;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((l) => `[${l.turn}] ${l.text}`)
    .join('\n'),
);
console.log(
  'capitulated:',
  Object.values(g.nations)
    .filter((n) => !n.alive)
    .map((n) => `${n.iso3}→${n.capitulatedTo}`)
    .join(', '),
);
console.log(
  'player:',
  JSON.stringify({
    gdp: g.nations[player]!.gdp.toFixed(0),
    treasury: g.nations[player]!.treasury.toFixed(0),
    stability: g.nations[player]!.stability.toFixed(0),
    debt: g.nations[player]!.debt.toFixed(0),
    techs: g.nations[player]!.techs.length,
    pending: g.pendingEvents.length,
    proposals: g.proposals.length,
  }),
);
console.log(
  'finances:',
  JSON.stringify(
    Object.fromEntries(
      Object.entries(g.nations[player]!.finances).map(([k, v]) => [k, Math.round(v as number)]),
    ),
  ),
);
console.log(
  'flashpoints:',
  JSON.stringify(
    Object.fromEntries(Object.entries(g.flashpoints).map(([k, v]) => [k, Math.round(v)])),
  ),
);
