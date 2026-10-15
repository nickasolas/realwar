# Real War: Reforged

A modern, browser-based 3D real-time strategy game inspired by *Real War*
(2001): combined-arms warfare with land, sea and air forces, oil-based economy,
fog of war and a computer opponent, presented as a tilted 3D diorama in the
style of modern 4X games.

Visuals: height-mapped terrain with hills and mountains, painted with
procedurally generated grass, dirt, rock and sand textures; dirt roads and
worn earth around structures and craters; mixed forests with autumn stands;
farmsteads and windmills; animated water; units in desert-tan or olive-drab
camouflage with small team markings; real-time sun shadows, ambient
occlusion, drifting cloud shadows, and unexplored land hidden under cloud.
All art is generated in code; there are no image or model files.

> Working title. "Real War" is a trademark of its original publisher; all art,
> sound, faction names and code here are original. Pick a new name before any
> public release.

## Play

No build step and no install: Three.js is vendored in `vendor/three`. Serve
the folder with any static server (ES modules don't load from `file://`):

```sh
npm start            # http://localhost:8080
# or: python3 -m http.server 8080
```

## How it plays

- **Economy:** Supply Trucks pump oil from wells and haul it to a Command
  Center or Supply Depot. Wells run dry, so expansion matters. A standing
  Command Center pays a small income ($5/s), and a player left with no trucks
  and too little money to buy one gets a free truck from it after 90 seconds
  (the sidebar counts down). The AI saves every credit for a truck when it has
  none.
- **Base building:** Structures are placed from the sidebar within range of your
  base, one at a time. Tech tree: Command Center → Barracks → Vehicle Plant →
  Airbase / Service Depot; Barracks → Naval Yard (on the open-sea shoreline; ponds don't count); plus Gun Turrets and SAM Sites.
- **Units:** Recon Drones (unarmed, long-sight scouts from the Command Center), Rifle Squads, Rocket Teams, Scout Buggies, Battle Tanks, Flak
  Tracks, Howitzers, Attack Helicopters, Interceptors, Strike Bombers, Patrol
  Boats and Missile Cruisers. Weapons only hit certain domains (ground/naval/air)
  and deal different damage per armor class, so army composition counts.
- **Repair:** select a damaged structure and press **R** (or its Repair
  button) to repair it gradually for credits. Vehicles repair at a **Service
  Depot**, aircraft at an **Airbase**, ships at a **Naval Yard**: right-click
  the facility, or press **R** with units selected to send them to the
  nearest one. Infantry heal for free near a Barracks or Command Center.
  Repairs run at half speed under fire and pause when funds run out.
  Tuning lives in `REPAIR` in `src/config.js`.
- **Fortifications:** drag to draw concrete **walls** ($40/segment) and
  asphalt **roads** ($15/tile); click to drop a **gate** ($150) into a wall,
  replacing a segment. Your ground units drive through your gates; enemies
  can't. Roads make ground units about 1.6x faster and can be cut through
  forest. Walls and gates build alongside other construction, don't count
  for victory, and aren't auto-targeted; an attack-moving army that finds
  its way walled off breaches the nearest wall. On Normal and Hard the
  computer walls in its own base once its core structures are up, with
  gates facing you, its oil wells and the main road, and a paved road out
  through the main gate; it rebuilds segments you knock down.
- **Rally points:** select one or more production structures and
  right-click the ground (or press *Set rally point*). New units deploy
  there, spreading out around the flag; armed units attack-move so they
  fight on the way. Rally a Command Center or Vehicle Plant onto an oil
  well to send new trucks to that well. Right-click the structure itself
  (or *Clear*) to remove it.
- **Research:** a **Research Lab** (needs a Vehicle Plant) turns credits
  into research points: each lab makes 1 point a second for $4 a second
  while it runs (pause it from its panel; it stalls when funds run out).
  Spend points in the sidebar's Research panel:
  - *Special Forces* (45): elite Barracks infantry with long-range rifles and
    demolition charges that wreck structures.
  - *Attack Drones* (60): fast, cheap armed drones from the Airbase.
  - *Advanced Optics* (50): every unit sees 2 tiles further.
  - *Submarines* (90): Naval Yard attack subs that torpedo ships and stay
    hidden unless an enemy is within a few tiles, or for a moment after they
    fire. Patrol Boats and Missile Cruisers have sonar that reaches further.
  - *Airborne Infantry* (90): Paratroopers from the Airbase. A transport flies
    to the Airbase's rally point and drops four squads, then flies home.
    Right-click with the transport selected to change its drop zone.
  - *Composite Armor* (110): vehicles and ships take 20% less damage.
  - *Strategic Missiles* (200, needs Advanced Optics): the **ICBM Silo**.
    It charges for three minutes; select it and press **L** (or *Launch
    missile*), then click a target anywhere on the map. Both sides see the
    launch and the target.
  The computer researches too and fields all of it. Tuning lives in
  `RESEARCH`, `TECHS` and the unit and building tables in `src/config.js`.
- **Win:** destroy every enemy structure (walls and gates don't count).

### Controls

| Input | Action |
| --- | --- |
| Left-click / drag | Select (Shift adds, double-click selects all of a type on screen) |
| Right-click | Move · attack · harvest a well · set a rally point (with a structure selected) |
| A + click | Attack-move |
| S / H | Stop / jump to HQ |
| R | Repair selected structure, or send selected units for repairs |
| L | Launch a charged ICBM Silo (then click the target) |
| Ctrl+1–9, 1–9 | Assign / recall group (press twice to center) |
| Arrows, screen edge, middle-drag, wheel | Scroll and zoom |
| P, +/-, M, Del | Pause, game speed, mute, sell structure |

Shift-click a unit button to queue five; right-click it to cancel. PgUp/PgDn
also zoom. Pick **Graphics: Performance** on the menu for older GPUs (drops
ambient occlusion, bloom and tilt-shift).

## Code layout

| File | Role |
| --- | --- |
| `src/config.js` | All balance data: units, structures, weapons, armor modifiers |
| `src/map.js` | Seeded, point-symmetric map generator (sea channel, bridges ships sail under, canals joining ponds to the sea, oil) |
| `src/path.js` | A* pathfinding per movement domain with path smoothing |
| `src/sim.js` | Deterministic fixed-step simulation (20 ticks/s) and the command API |
| `src/ai.js` | Computer opponent; uses the same commands as the player |
| `src/gfx/heightfield.js` | Cosmetic terrain relief derived from the tile map (no three.js; tested) |
| `src/gfx/textures.js` | Procedural, tiling ground textures (grass, dirt, rock, sand) |
| `src/gfx/world.js` | Splat-textured terrain, water, vegetation, sky and the fog-of-war shader patch |
| `src/gfx/modelkit.js` | Model toolkit: surface shader (camo paint, concrete, corrugated metal, canvas, track links, glass), geometry helpers |
| `src/gfx/units.js` | Unit models: tracked armour, wheeled vehicles, infantry, aircraft, ships |
| `src/gfx/structures.js` | Structure, scenery and oil-well models |
| `src/gfx/bridges.js` | Bridge decks, parapets and piers over bridged water |
| `src/gfx/particles.js` | Point-sprite particles: explosions, smoke, fire, dust, wakes, tracers |
| `src/gfx/renderer3d.js` | Scene, camera, lighting, post-processing, picking, overlays, minimap, icons |
| `src/audio.js` | Procedurally synthesized sound effects (WebAudio) |
| `src/main.js` | Game loop, input, camera and sidebar UI |

The simulation has no DOM dependencies, so it runs headless under Node for
tests and AI-vs-AI balance runs.

```sh
npm test
```

## Ideas for next steps

- Asymmetric factions with unique units and superweapons, like the original
- Campaign missions and scripted objectives
- Multiplayer over WebRTC (the fixed-step sim is a good fit for lockstep)
- Veterancy, repair, transports and amphibious units
- Hand-authored glTF models and textures to replace the procedural ones
- Day/night cycle and weather
