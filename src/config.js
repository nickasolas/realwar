// Game tuning data. Everything balance-related lives here so it can be
// tweaked without touching simulation code.

export const TILE = 32;
export const TICK_RATE = 20; // simulation ticks per second
export const DT = 1 / TICK_RATE;

export const Terrain = Object.freeze({
  DEEP: 0,
  WATER: 1,
  SAND: 2,
  GRASS: 3,
  FOREST: 4,
  ROCK: 5,
});

// Movement domains decide which tiles an entity may occupy.
export const Domain = Object.freeze({ GROUND: 'ground', NAVAL: 'naval', AIR: 'air' });

// Armor classes; weapons scale damage against each one.
export const Armor = Object.freeze({
  INFANTRY: 'infantry',
  LIGHT: 'light',
  HEAVY: 'heavy',
  AIR: 'air',
  SHIP: 'ship',
  BUILDING: 'building',
});

export const FACTIONS = [
  { id: 0, name: 'Allied Coalition', short: 'AC', color: '#3d8bff', dark: '#1d4c99' },
  { id: 1, name: 'Liberation Front', short: 'LF', color: '#e8473c', dark: '#8a211a' },
];

export const STARTING_CREDITS = 3000;
export const OIL_PER_WELL = 6000;
export const TRUCK_CAPACITY = 150;
export const HARVEST_RATE = 50; // credits per second while loading

// Weapon definitions. `hits` lists the domains a weapon can engage.
// `vs` multiplies damage per armor class (default 1).
export const WEAPONS = {
  rifle: { damage: 9, range: 4.5, cooldown: 0.8, speed: 26, hits: ['ground', 'naval'], vs: { infantry: 1.4, light: 0.5, heavy: 0.2, building: 0.3, ship: 0.3 }, fx: 'bullet' },
  rocket: { damage: 34, range: 5.5, cooldown: 2.2, speed: 13, hits: ['ground', 'naval', 'air'], vs: { infantry: 0.4, light: 1.2, heavy: 1.3, air: 1.1, building: 0.7, ship: 1.0 }, fx: 'rocket' },
  cannon_light: { damage: 18, range: 5, cooldown: 1.1, speed: 22, hits: ['ground', 'naval'], vs: { infantry: 0.8, light: 1.1, heavy: 0.8, building: 0.8 }, fx: 'shell' },
  cannon_heavy: { damage: 42, range: 6, cooldown: 2.0, speed: 22, hits: ['ground', 'naval'], vs: { infantry: 0.6, light: 1.2, heavy: 1.0, building: 1.0 }, fx: 'shell' },
  howitzer: { damage: 60, range: 11, minRange: 3, cooldown: 4.5, speed: 9, splash: 1.3, arc: true, hits: ['ground', 'naval'], vs: { infantry: 1.2, light: 1.0, heavy: 0.7, building: 1.3 }, fx: 'artillery' },
  flak: { damage: 16, range: 7, cooldown: 0.5, speed: 30, hits: ['air'], vs: { air: 1.0 }, fx: 'flak' },
  heli_missile: { damage: 30, range: 5, cooldown: 1.6, speed: 16, hits: ['ground', 'naval'], vs: { infantry: 0.6, light: 1.2, heavy: 1.3, building: 0.8, ship: 1.1 }, fx: 'rocket' },
  aam: { damage: 45, range: 7, cooldown: 2.0, speed: 24, hits: ['air'], vs: { air: 1.0 }, fx: 'rocket' },
  bomb: { damage: 160, range: 1.2, cooldown: 6.0, speed: 6, splash: 1.8, arc: true, hits: ['ground', 'naval'], vs: { infantry: 1.0, light: 1.0, heavy: 1.0, building: 1.5, ship: 1.2 }, fx: 'bomb' },
  naval_gun: { damage: 26, range: 7, cooldown: 1.4, speed: 20, hits: ['ground', 'naval'], vs: { infantry: 0.8, light: 1.0, heavy: 0.9, building: 1.1, ship: 1.2 }, fx: 'shell' },
  cruise: { damage: 90, range: 13, minRange: 3, cooldown: 6.0, speed: 10, splash: 1.5, arc: true, hits: ['ground', 'naval'], vs: { infantry: 0.8, light: 1.0, heavy: 0.9, building: 1.5, ship: 1.0 }, fx: 'artillery' },
  turret_gun: { damage: 28, range: 6.5, cooldown: 1.3, speed: 24, hits: ['ground', 'naval'], vs: { infantry: 1.0, light: 1.1, heavy: 0.9, building: 0.5, ship: 1.0 }, fx: 'shell' },
  sam: { damage: 40, range: 8.5, cooldown: 1.5, speed: 26, hits: ['air'], vs: { air: 1.0 }, fx: 'rocket' },
};

// Units. speed and sight are in tiles; buildTime in seconds.
export const UNITS = {
  truck: { name: 'Supply Truck', domain: 'ground', armor: 'light', hp: 220, speed: 2.6, sight: 5, cost: 600, buildTime: 9, radius: 0.45, harvester: true },
  infantry: { name: 'Rifle Squad', domain: 'ground', armor: 'infantry', hp: 70, speed: 1.7, sight: 6, cost: 100, buildTime: 4, radius: 0.3, weapon: 'rifle' },
  rocketeer: { name: 'Rocket Team', domain: 'ground', armor: 'infantry', hp: 60, speed: 1.6, sight: 6, cost: 250, buildTime: 6, radius: 0.3, weapon: 'rocket' },
  scout: { name: 'Scout Buggy', domain: 'ground', armor: 'light', hp: 160, speed: 4.2, sight: 8, cost: 400, buildTime: 6, radius: 0.4, weapon: 'cannon_light' },
  tank: { name: 'Battle Tank', domain: 'ground', armor: 'heavy', hp: 520, speed: 2.1, sight: 6, cost: 900, buildTime: 12, radius: 0.5, weapon: 'cannon_heavy' },
  artillery: { name: 'Howitzer', domain: 'ground', armor: 'light', hp: 220, speed: 1.5, sight: 7, cost: 1000, buildTime: 14, radius: 0.5, weapon: 'howitzer' },
  aa: { name: 'Flak Track', domain: 'ground', armor: 'light', hp: 260, speed: 2.4, sight: 8, cost: 700, buildTime: 10, radius: 0.45, weapon: 'flak' },
  // Unarmed scout: fast, fragile, and sees further than anything else.
  drone: { name: 'Recon Drone', domain: 'air', armor: 'air', hp: 90, speed: 5.5, sight: 14, cost: 450, buildTime: 8, radius: 0.35, scout: true },
  heli: { name: 'Attack Helicopter', domain: 'air', armor: 'air', hp: 280, speed: 4.0, sight: 8, cost: 1200, buildTime: 14, radius: 0.5, weapon: 'heli_missile' },
  fighter: { name: 'Interceptor', domain: 'air', armor: 'air', hp: 240, speed: 7.0, sight: 9, cost: 1100, buildTime: 13, radius: 0.5, weapon: 'aam' },
  bomber: { name: 'Strike Bomber', domain: 'air', armor: 'air', hp: 420, speed: 4.6, sight: 7, cost: 1800, buildTime: 20, radius: 0.7, weapon: 'bomb' },
  gunboat: { name: 'Patrol Boat', domain: 'naval', armor: 'ship', hp: 380, speed: 3.6, sight: 8, cost: 800, buildTime: 11, radius: 0.55, weapon: 'naval_gun' },
  destroyer: { name: 'Missile Cruiser', domain: 'naval', armor: 'ship', hp: 900, speed: 2.2, sight: 9, cost: 2000, buildTime: 22, radius: 0.8, weapon: 'cruise', secondary: 'flak' },
};

// Structures. Footprint is w x h tiles. `produces` lists unit keys.
export const BUILDINGS = {
  hq: { name: 'Command Center', w: 3, h: 3, hp: 3000, sight: 9, cost: 0, buildTime: 0, produces: ['truck', 'drone'], dropoff: true, buildable: false },
  refinery: { name: 'Supply Depot', w: 2, h: 2, hp: 1000, sight: 5, cost: 900, buildTime: 12, dropoff: true, requires: ['hq'] },
  barracks: { name: 'Barracks', w: 2, h: 2, hp: 900, sight: 5, cost: 500, buildTime: 10, produces: ['infantry', 'rocketeer'], requires: ['hq'] },
  factory: { name: 'Vehicle Plant', w: 3, h: 3, hp: 1500, sight: 5, cost: 1500, buildTime: 18, produces: ['scout', 'tank', 'aa', 'artillery', 'truck'], requires: ['barracks'] },
  airfield: { name: 'Airbase', w: 3, h: 3, hp: 1300, sight: 6, cost: 2000, buildTime: 22, produces: ['heli', 'fighter', 'bomber'], requires: ['factory'] },
  shipyard: { name: 'Naval Yard', w: 3, h: 3, hp: 1400, sight: 6, cost: 1500, buildTime: 18, produces: ['gunboat', 'destroyer'], requires: ['barracks'], coastal: true },
  turret: { name: 'Gun Turret', w: 1, h: 1, hp: 700, sight: 7, cost: 600, buildTime: 8, weapon: 'turret_gun', requires: ['barracks'] },
  samsite: { name: 'SAM Site', w: 1, h: 1, hp: 600, sight: 9, cost: 750, buildTime: 9, weapon: 'sam', requires: ['factory'] },
};

export const BUILD_ORDER_MENU = ['refinery', 'barracks', 'factory', 'shipyard', 'airfield', 'turret', 'samsite'];

// Structures may only be placed within this many tiles of an existing friendly structure.
export const BUILD_RADIUS = 8;
