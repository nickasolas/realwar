# Real War: Reforged

A modern, browser-based 3D real-time strategy game inspired by *Real War*
(2001): combined-arms warfare with land, sea and air forces, oil-based economy,
fog of war and a computer opponent, presented as a tilted 3D diorama in the
style of modern 4X games.

Visuals: height-mapped terrain with hills and mountains, animated water,
instanced forests, procedurally modelled units and structures in team colours,
real-time sun shadows, ambient occlusion, bloom, tilt-shift depth of field,
drifting cloud shadows, and unexplored land hidden under cloud.

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
  Center or Supply Depot. Wells run dry, so expansion matters.
- **Base building:** Structures are placed from the sidebar within range of your
  base, one at a time. Tech tree: Command Center → Barracks → Vehicle Plant →
  Airbase / Service Depot; Barracks → Naval Yard (shoreline only); plus Gun Turrets and SAM Sites.
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
- **Win:** destroy every enemy structure.

### Controls

| Input | Action |
| --- | --- |
| Left-click / drag | Select (Shift adds, double-click selects all of a type on screen) |
| Right-click | Move · attack · harvest a well · set a rally point (with a structure selected) |
| A + click | Attack-move |
| S / H | Stop / jump to HQ |
| R | Repair selected structure, or send selected units for repairs |
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
| `src/map.js` | Seeded, point-symmetric map generator (sea channel, land bridges, oil) |
| `src/path.js` | A* pathfinding per movement domain with path smoothing |
| `src/sim.js` | Deterministic fixed-step simulation (20 ticks/s) and the command API |
| `src/ai.js` | Computer opponent; uses the same commands as the player |
| `src/gfx/heightfield.js` | Cosmetic terrain relief derived from the tile map (no three.js; tested) |
| `src/gfx/world.js` | Terrain mesh, water, vegetation, sky and the fog-of-war shader patch |
| `src/gfx/models.js` | Procedural low-poly unit/structure models (merged per model, team coloured) |
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
