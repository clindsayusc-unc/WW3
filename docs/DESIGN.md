# World War 3 — Design Brief

## Fantasy
You are the supreme military and national leader of a major power in a near-future world sliding into World War 3. You direct the armed forces, the economy, research and foreign policy. Real nations, real leaders, real alliances and real flashpoints, starting from the world as it stands in January 2027. Inspirations: Civilization (one-more-turn loop, tech tree, leaders with personalities), Hearts of Iron / Paradox (map-driven grand strategy), Risk (territorial clarity), SimCity (watching your economy respond), DEFCON (escalation dread).

## Pillars
1. The globe is the star: photoreal, cinematic, alive (day/night terminator, city lights, clouds, moving fleets, missile arcs).
2. Every decision trades off: guns vs butter vs research; allies vs autonomy; deterrence vs escalation.
3. Grounded realism: data sourced from public figures (IMF, SIPRI, FAS, IISS-style public estimates), leaders modelled on public record, every data file carries source + asOf.
4. Readable at a glance: clean military-intelligence UI, NATO map symbols, map modes, tooltips everywhere.
5. Runs beautifully on an Apple M3 with 8 GB unified memory.

## Core loop (1 turn = 1 month)
1. Read the briefing: intelligence summary, news ticker, alerts, diplomatic messages.
2. Set national budget: military / research / infrastructure / social / debt service.
3. Queue production, research and deployments; issue orders to armies, fleets, air wings.
4. Conduct diplomacy: proposals, treaties, sanctions, ultimatums, UN votes.
5. End turn: simulation resolves economy, movement, combat, AI decisions, events; results animate on the globe.

## World model
- ~1,000 land regions (from Natural Earth admin-1, merged so small countries are 1–3 regions and large ones 20–80) and ~150 sea zones. Each region: owner, controller, population, GDP share, industry, resources (oil, gas, rare earths, semiconductors, food), infrastructure, terrain, supply value, unrest.
- ~195 countries. 14 playable majors: USA, China, Russia, India, UK, France, Germany, Japan, South Korea, Iran, Israel, Turkey, Pakistan, Brazil. Minors use a simplified economy and AI.
- Blocs: NATO, EU, CSTO, SCO, AUKUS, Quad, BRICS, GCC. Membership affects obligations and AI behaviour.
- Flashpoints seeded at start: Taiwan Strait, South China Sea, Korean Peninsula, Russia–Ukraine, Baltic states, Iran–Israel/Gulf, India–Pakistan (Kashmir), India–China (LAC), Arctic.

## Leaders
Each nation has its real current head of state/government (researched and date-stamped). Traits on 0–100 scales: aggression, risk tolerance, ideology, pragmatism, nationalism, paranoia, economic priority, alliance loyalty, nuclear threshold. Traits drive AI utility weights. Leaders can change through elections, coups, succession or regime collapse (fictional successors are generated and clearly marked). Portraits are stylized cards, never photos. A splash screen states the game is a fictional simulation.

## Economy
GDP with sectors (agriculture, energy, industry, services, high-tech), growth, inflation, debt-to-GDP, tax rate, budget allocation, trade partners and dependency, strategic resources, sanctions (lost trade, tech access), war economy mobilization levels (peace / partial / total) trading growth and stability for production. Public support and stability; low stability causes unrest, protests, regime-change risk.

## Military
Domains and unit types (abstracted to formations):
- Land: infantry, mechanized, armored, artillery/rocket, air defense, special forces, marines.
- Air: fighters (4th/5th/6th gen by tech), bombers, drones (ISR, strike, swarm), tankers/AWACS as modifiers.
- Sea: carrier strike groups, destroyer/frigate groups, submarines (attack, ballistic missile), amphibious groups.
- Strategic: ICBMs, SLBMs, cruise and hypersonic missiles, missile defense, cyber operations, space (satellites, ASAT).
Mechanics: production queues with cost and build time, upkeep, supply lines from home regions and ports, terrain and weather modifiers, combat resolution per region using a Lanchester-style model with tech, training, supply, morale, air superiority and defense bonuses. Fog of war with intelligence levels. Naval control of sea zones gates invasions and trade.

## Research
~80 techs in 8 branches: AI & autonomy, drones & robotics, missiles & hypersonics, missile defense, cyber & electronic warfare, space, energy & industry, semiconductors & quantum. Each tech: cost, prerequisites, real-world framing, concrete effect. Sanctions and alliances change research speed.

## Diplomacy
Relations −100 to +100 between every pair; opinion modifiers with decay. Actions: trade agreement, non-aggression pact, defensive pact, alliance, basing rights, arms sale, joint exercise, sanctions, embargo, demand concession, ultimatum, declare war, peace deal (with terms), UN Security Council resolution (P5 vetoes). AI responds based on leader traits, interests and power balance; every AI reply includes a one-line reason.

## Escalation and nuclear weapons
Global tension meter and per-nation DEFCON 5→1. Escalation ladder: posturing → sanctions → proxy conflict → limited conventional war → general war → tactical nuclear use → strategic exchange. Warhead counts from public estimates. Nuclear use is abstracted (no gore), triggers massive diplomatic, economic and climate consequences; a full exchange ends the game for everyone ("nobody wins" screen). Deterrence matters: AI weighs second-strike capability.

## Events and news
Monthly event deck mixing scripted flashpoint events and procedural ones (elections, coups, disasters, cyberattacks, market crashes, tech breakthroughs). Choices with trade-offs. A news ticker with generated headlines from in-game events.

## Victory and defeat
Victory: Hegemony (control or ally-dominate a set share of world GDP and population), Deterrence (reach 2040 without nuclear war as the great power that gained most standing — output against its own trend, and territory; D-081), Diplomatic (lead the dominant bloc and pass a world-order resolution), Conquest (capitulate all rival majors). Defeat: capitulation, regime collapse, or global nuclear war.

## UI and presentation
Dark military-intelligence aesthetic: near-black panels, crisp sans-serif + monospace numerals, one accent colour per nation, subtle scanline/grain only on overlays. Top bar: date, treasury, GDP, stability, tension, DEFCON. Left: nation and leader panel. Right: context panel for selected region/unit. Bottom: end turn, alerts, news ticker. Map modes: political, alliance, relations, economic, resources, military, supply, tension. Every number has a tooltip explaining its cause. Keyboard shortcuts. Smooth camera with fly-to on alerts.

## Audio
Minimal ambient score, UI clicks, alert stingers (royalty-free or synthesized). Mute and volume controls.

## Technical
TypeScript strict, Vite, React for UI, React Three Fiber + Three.js for rendering, Zustand for UI state. Simulation is a pure, deterministic, seeded TypeScript module running in a Web Worker, fully unit tested and independent of rendering. Data in /data as JSON with source and asOf fields. Region-ID texture technique for map colouring (an ID map + palette lookup in the shader). Instanced rendering, LOD, KTX2 textures. Targets: 60 fps, under 1.5 GB RAM, under 400 MB GPU textures on an M3 8 GB. Native macOS packaging with Tauri v2.
