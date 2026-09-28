// Locked-in pilot and mech, taken from Vail's Comp/Con export.
// Numbers come from the official lancer-data package (GMS, LL0).

export const PILOT = {
  name: 'Vail Halvorsen',
  callsign: 'Bulkhead',
  ll: 0,
  grit: 0,
  hase: { hull: 2, agi: 0, sys: 0, eng: 0 },
  talents: [
    { name: 'Combined Arms I — Shield of Blades', text: 'While Engaged, you count as having soft cover.' },
    { name: 'Vanguard I — Handshake Etiquette', text: '+1 Accuracy with CQB weapons against targets within Range 3.' },
    { name: 'Executioner I — Backswing Cut', text: '1/round, when you hit with a Heavy melee weapon, make a free half-damage attack with it against a different adjacent enemy.' },
  ],
};

// GMS Everest: HP 10 +2/Hull +2 Personalizations = 16. Repair cap 5 + Hull/2 = 6.
export const MECH = {
  name: 'Moral Responsibility',
  frame: 'GMS Everest',
  size: 1,
  maxHp: 10 + 2 * PILOT.hase.hull + 2,
  armor: 0,
  evasion: 8,
  edef: 8,
  heatCap: 6 + PILOT.hase.eng,
  speed: 4,
  saveTarget: 10 + PILOT.grit,
  structure: 4,
  stress: 4,
  repairs: 5 + Math.floor(PILOT.hase.hull / 2),
  mounts: [
    { id: 'main', label: 'Main', weapons: ['shotgun'] },
    { id: 'flex', label: 'Flex', weapons: ['pistols'] },
    { id: 'heavy', label: 'Heavy', weapons: ['blade'] },
  ],
};

// Weapons by mount. The two Aux thermal pistols share the Flex mount: picking
// it fires the first pistol, then the second (Aux) pistol at a target of your choice.
export const PLAYER_WEAPONS = {
  shotgun: {
    id: 'shotgun', name: 'Shotgun', short: 'Shotgun', mount: 'main', size: 'Main', type: 'CQB',
    range: 5, threat: 3, damage: '1d6', dtype: 'Kinetic',
    note: 'Main CQB · Range 5 · Threat 3 · 1d6 kinetic',
  },
  pistols: {
    id: 'pistols', name: 'Thermal Pistols ×2', short: 'Pistols', mount: 'flex', size: 'Auxiliary', type: 'CQB',
    range: 5, damage: 2, dtype: 'Energy',
    note: 'Aux CQB ×2 · Range 5 · 2 energy each · each pistol picks its own target',
  },
  blade: {
    id: 'blade', name: 'Heavy Charged Blade', short: 'Blade', mount: 'heavy', size: 'Heavy', type: 'Melee',
    threat: 1, damage: '1d6+3', dtype: 'Energy', ap: true,
    note: 'Heavy Melee · Threat 1 · 1d6+3 energy · AP',
  },
};

export const SYSTEMS = [
  { id: 'shield', name: 'Type-3 Projected Shield', text: 'Protocol, 1 heat: nominate an enemy in sight. Attacks between you and them get +2 Difficulty until your next turn.' },
  { id: 'hex', name: 'Pattern-B HEX Charges', limited: 3, text: 'Limited 3. Frag Grenade (Quick, Range 5, Blast 1, Agility save or 1d6 explosive, half on success) or Explosive Mine (Quick, adjacent; Burst 1, Agility save or 2d6 explosive, half on success).' },
  { id: 'personal', name: 'Personalizations', text: '+2 HP (Vail\'s old hacking rig in the cockpit).' },
  { id: 'paint', name: 'Custom Paint Job', indestructible: true, text: 'Once per mission, when you take structure damage, roll 1d6: on a 6 you return to 1 HP instead.' },
];

export const FRAME_TEXT = {
  initiative: 'Initiative — 1/mission, take any quick action as a free action.',
  core: 'Core: Hyperspec Fuel Injector (Protocol, 1/mission) — +1 Accuracy on all attacks, checks and saves for the rest of the mission, and 1/turn Boost as a free action.',
};

// Simplified Tier-1 NPCs in the spirit of the core-book roles.
// Flat damage like tabletop NPCs. `bonus` is the flat attack bonus.
export const NPC_CLASSES = {
  grunt: {
    name: 'Grunt', role: 'Grunt', letter: 'g', cost: 0.5,
    hp: 1, armor: 0, evasion: 8, edef: 8, speed: 4, agi: 0, hull: 0,
    weapons: [{ name: 'Rifle', type: 'Ranged', bonus: 1, range: 8, damage: 2, dtype: 'Kinetic' }],
    ai: 'ranged',
  },
  assault: {
    name: 'Assault', role: 'Striker', letter: 'A', cost: 1,
    hp: 10, armor: 1, evasion: 8, edef: 8, speed: 4, agi: 0, hull: 1,
    weapons: [{ name: 'Assault Rifle', type: 'Ranged', bonus: 1, range: 10, damage: 4, dtype: 'Kinetic' }],
    ai: 'ranged',
  },
  berserker: {
    name: 'Berserker', role: 'Striker', letter: 'B', cost: 1,
    hp: 12, armor: 1, evasion: 6, edef: 8, speed: 5, agi: 0, hull: 2,
    weapons: [{ name: 'Chain Axe', type: 'Melee', bonus: 2, threat: 1, damage: 6, dtype: 'Kinetic' }],
    ai: 'melee',
  },
  scout: {
    name: 'Scout', role: 'Support', letter: 'S', cost: 1,
    hp: 8, armor: 0, evasion: 12, edef: 10, speed: 6, agi: 2, hull: 0,
    weapons: [{ name: 'Marker Rifle', type: 'Ranged', bonus: 2, range: 15, damage: 2, dtype: 'Kinetic', lockOn: true }],
    ai: 'ranged', text: 'Hits apply Lock On: the next enemy attack against you consumes it for +1 Accuracy.',
  },
  sniper: {
    name: 'Sniper', role: 'Artillery', letter: 'N', cost: 1,
    hp: 8, armor: 0, evasion: 8, edef: 8, speed: 4, agi: 0, hull: 0,
    weapons: [{ name: 'Anti-Materiel Rifle', type: 'Ranged', bonus: 2, range: 20, damage: 7, dtype: 'Kinetic', loading: true }],
    ai: 'sniper', text: 'Loading: must spend an action reloading after each shot.',
  },
  ronin: {
    name: 'Ronin', role: 'Striker', letter: 'R', cost: 1,
    hp: 10, armor: 0, evasion: 10, edef: 8, speed: 5, agi: 1, hull: 1,
    weapons: [{ name: 'Katana', type: 'Melee', bonus: 2, threat: 1, damage: 5, dtype: 'Kinetic' }],
    ai: 'melee',
  },
  bombard: {
    name: 'Bombard', role: 'Artillery', letter: 'M', cost: 1,
    hp: 10, armor: 1, evasion: 6, edef: 8, speed: 3, agi: 0, hull: 1,
    weapons: [{ name: 'Mortar', type: 'Ranged', bonus: 1, range: 15, damage: 5, dtype: 'Explosive', arcing: true, blast: 1 }],
    ai: 'ranged', text: 'Arcing Blast 1: ignores cover.',
  },
};

export const QUIPS = {
  start: [
    'We will cross that bridge when it is burning.',
    'I have plan. Also plan for the plan.',
    'Moral Responsibility, online. Please do not make joke about the name.',
    'Is not my first rodeo. …What is a rodeo?',
  ],
  kill: [
    'That one is closed for business.',
    'You are welcome.',
    'Door is shut.',
  ],
  win: [
    'Everybody is clear. Good. Now I breathe.',
    'The early bird has caught the worm. I am the bird.',
    'We have hit two birds with one stone. Several birds, actually.',
  ],
  structure: [
    'That is — how you say — not ideal.',
    'Paint is scratched. Also the armour. Also me.',
  ],
  lose: [
    'Bulkhead is… breached.',
  ],
};
