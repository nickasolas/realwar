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
  { id: 2, name: 'Northern Pact', short: 'NP', color: '#f0b429', dark: '#8f6610' },
  { id: 3, name: 'Southern Union', short: 'SU', color: '#3fc6a0', dark: '#1d7560' },
];

// Menu choices for a skirmish.
export const MAP_SIZES = { small: 96, medium: 128, large: 160, huge: 192 };
export const MAX_OPPONENTS = 3;

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
  // Researched weapons.
  specops: { damage: 24, range: 6.5, cooldown: 1.2, speed: 30, hits: ['ground', 'naval'], vs: { infantry: 1.6, light: 0.8, heavy: 0.45, building: 1.6, ship: 0.5 }, fx: 'bullet' },
  drone_missile: { damage: 22, range: 4.5, cooldown: 1.4, speed: 18, hits: ['ground', 'naval'], vs: { infantry: 0.9, light: 1.3, heavy: 0.9, building: 0.6, ship: 0.9 }, fx: 'rocket' },
  torpedo: { damage: 90, range: 6, cooldown: 3.2, speed: 8, hits: ['naval'], vs: { ship: 1.2 }, fx: 'torpedo' },
  icbm: { damage: 1100, range: Infinity, cooldown: 0, speed: 7, splash: 3.5, arc: true, arcHeight: 12, hits: ['ground', 'naval'], vs: { infantry: 1.0, light: 1.0, heavy: 0.8, building: 1.2, ship: 1.0 }, fx: 'icbm' },
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
  gunboat: { name: 'Patrol Boat', domain: 'naval', armor: 'ship', hp: 380, speed: 3.6, sight: 8, cost: 800, buildTime: 11, radius: 0.55, weapon: 'naval_gun', sonar: 4 },
  destroyer: { name: 'Missile Cruiser', domain: 'naval', armor: 'ship', hp: 900, speed: 2.2, sight: 9, cost: 2000, buildTime: 22, radius: 0.8, weapon: 'cruise', secondary: 'flak', sonar: 5 },
  // Researched units (`tech` must be unlocked at a Research Lab first).
  commando: { name: 'Special Forces', domain: 'ground', armor: 'infantry', hp: 140, speed: 2.0, sight: 8, cost: 600, buildTime: 10, radius: 0.3, weapon: 'specops', tech: 'specops' },
  strikedrone: { name: 'Attack Drone', domain: 'air', armor: 'air', hp: 130, speed: 6.0, sight: 9, cost: 650, buildTime: 9, radius: 0.35, weapon: 'drone_missile', tech: 'attackdrone' },
  // Hidden from enemies unless one of their units or structures is within
  // `stealth` tiles (or `sonar` range), or for a moment after it fires.
  submarine: { name: 'Attack Submarine', domain: 'naval', armor: 'ship', hp: 600, speed: 2.8, sight: 7, cost: 1300, buildTime: 16, radius: 0.6, weapon: 'torpedo', stealth: 2.5, tech: 'submarine' },
  // A transport that flies to the Airbase's rally point (the drop zone) and
  // drops `drop.count` squads of `drop.unit`, then flies home.
  paratroopers: { name: 'Paratroopers', domain: 'air', armor: 'air', hp: 320, speed: 5.0, sight: 7, cost: 1100, buildTime: 14, radius: 0.7, transport: true, drop: { unit: 'para', count: 4 }, tech: 'airborne' },
  para: { name: 'Paratrooper Squad', domain: 'ground', armor: 'infantry', hp: 80, speed: 1.8, sight: 7, cost: 250, buildTime: 0, radius: 0.3, weapon: 'rifle', dropped: true },
};

// Research: each finished Research Lab turns credits into research points,
// which unlock technologies. `unit`/`building` name what a tech unlocks.
export const RESEARCH = {
  rate: 1, // points per second per lab
  cost: 4, // credits per second per lab while researching
};
export const TECHS = {
  specops: { name: 'Special Forces', points: 45, unit: 'commando', desc: 'Elite Barracks infantry: long-range rifles and demolition charges that wreck structures.' },
  attackdrone: { name: 'Attack Drones', points: 60, unit: 'strikedrone', desc: 'Fast, cheap Airbase drones armed with light missiles.' },
  optics: { name: 'Advanced Optics', points: 50, sightBonus: 2, desc: 'All units see 2 tiles further.' },
  submarine: { name: 'Submarines', points: 90, unit: 'submarine', desc: 'Naval Yard attack sub. Torpedoes ships and stays hidden unless enemies come close (cruisers have sonar).' },
  airborne: { name: 'Airborne Infantry', points: 90, unit: 'paratroopers', desc: 'The Airbase flies a transport to its rally point and drops four paratrooper squads.' },
  armor: { name: 'Composite Armor', points: 110, armorBonus: 0.2, desc: 'Vehicles and ships take 20% less damage.' },
  icbm: { name: 'Strategic Missiles', points: 200, building: 'silo', requires: ['optics'], desc: 'ICBM Silo: charges a missile you can launch anywhere on the map.' },
};
export const TECH_ORDER = ['specops', 'attackdrone', 'optics', 'submarine', 'airborne', 'armor', 'icbm'];

// Structures. Footprint is w x h tiles. `produces` lists unit keys.
export const BUILDINGS = {
  hq: { name: 'Command Center', w: 3, h: 3, hp: 3000, sight: 9, cost: 0, repairValue: 3000, healsInfantry: true, buildTime: 0, produces: ['truck', 'drone'], dropoff: true, buildable: false },
  refinery: { name: 'Supply Depot', w: 2, h: 2, hp: 1000, sight: 5, cost: 900, buildTime: 12, dropoff: true, requires: ['hq'] },
  barracks: { name: 'Barracks', w: 2, h: 2, hp: 900, sight: 5, cost: 500, buildTime: 10, produces: ['infantry', 'rocketeer', 'commando'], requires: ['hq'], healsInfantry: true },
  factory: { name: 'Vehicle Plant', w: 3, h: 3, hp: 1500, sight: 5, cost: 1500, buildTime: 18, produces: ['scout', 'tank', 'aa', 'artillery', 'truck'], requires: ['barracks'] },
  airfield: { name: 'Airbase', w: 6, h: 2, hp: 1300, sight: 6, cost: 2000, buildTime: 22, produces: ['heli', 'fighter', 'bomber', 'strikedrone', 'paratroopers'], requires: ['factory'], repairs: 'air' },
  shipyard: { name: 'Naval Yard', w: 3, h: 3, hp: 1400, sight: 6, cost: 1500, buildTime: 18, produces: ['gunboat', 'destroyer', 'submarine'], requires: ['barracks'], coastal: true, repairs: 'naval' },
  // Fortifications: placed in lines, built in parallel with other construction,
  // and ignored for victory. Gates let their owner's ground units through.
  wall: { name: 'Wall', w: 1, h: 1, hp: 700, sight: 2, cost: 40, buildTime: 2, requires: ['hq'], segment: true },
  gate: { name: 'Gate', w: 1, h: 1, hp: 900, sight: 3, cost: 150, buildTime: 4, requires: ['hq'], segment: true, gate: true },
  depot: { name: 'Service Depot', w: 2, h: 2, hp: 1000, sight: 5, cost: 800, buildTime: 12, requires: ['factory'], repairs: 'ground' },
  turret: { name: 'Gun Turret', w: 1, h: 1, hp: 700, sight: 7, cost: 600, buildTime: 8, weapon: 'turret_gun', requires: ['barracks'] },
  samsite: { name: 'SAM Site', w: 1, h: 1, hp: 600, sight: 9, cost: 750, buildTime: 9, weapon: 'sam', requires: ['factory'] },
  lab: { name: 'Research Lab', w: 3, h: 2, hp: 1100, sight: 5, cost: 1200, buildTime: 16, requires: ['factory'], research: true },
  // Charges for `missile.charge` seconds, then launches anywhere on command.
  silo: { name: 'ICBM Silo', w: 2, h: 2, hp: 1400, sight: 4, cost: 2500, buildTime: 30, requires: ['lab'], tech: 'icbm', missile: { weapon: 'icbm', charge: 180 } },
};

export const BUILD_ORDER_MENU = ['refinery', 'barracks', 'factory', 'depot', 'shipyard', 'airfield', 'lab', 'turret', 'samsite', 'silo'];
export const FORTIFICATION_MENU = ['wall', 'gate', 'road'];

// Roads are painted onto the map rather than built as structures.
export const ROAD = { name: 'Road', cost: 15, requires: ['hq'] };

// Longest line a single wall or road drag can place.
export const MAX_LINE = 40;

// Safety nets so a player can never be permanently broke.
export const ECONOMY = {
  hqIncome: 5, // credits per second from a standing Command Center
  emergencyTruckDelay: 90, // seconds broke with no trucks before the HQ sends a free one
};

// Repair rules. Rates are fractions of max HP per second; costs are the
// share of an item's price paid for a full 0-to-100% repair.
export const REPAIR = {
  buildingRate: 0.04, // toggled structure repair: ~25s from empty to full
  buildingCost: 0.5,
  unitRate: 0.08, // vehicles at a Service Depot, aircraft at an Airbase, ships at a Naval Yard
  unitCost: 0.4,
  facilityRange: 2, // tiles from the repair structure's edge
  infantryRate: 0.03, // free healing near a Barracks or Command Center
  infantryRange: 4,
  underFire: 0.5, // repair speed multiplier while recently hit
  underFireWindow: 3, // seconds after a hit that count as "under fire"
};

// Structures may only be placed within this many tiles of an existing friendly structure.
export const BUILD_RADIUS = 8;
