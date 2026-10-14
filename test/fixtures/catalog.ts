import type { CatalogInput, Character, StatLine } from '#shared/engine'

// A small test catalog. The real catalog comes from Contentful; stat values here are
// placeholders chosen to make the golden tests readable, not a balance proposal.

function stats(partial: Partial<StatLine> & { combat: number }): StatLine {
  return {
    leadership: 10,
    navigation: 10,
    precision: 10,
    provisions: 10,
    medicine: 10,
    knowledge: 10,
    shipcraft: 10,
    morale: 10,
    helm: 10,
    ...partial,
  }
}

type Spec = Omit<Character, 'formerKeys' | 'status' | 'haki'> & Partial<Pick<Character, 'formerKeys' | 'status' | 'haki'>>

function character(spec: Spec): Character {
  return { formerKeys: [], status: 'active', haki: [], ...spec }
}

export const characters: Character[] = [
  character({ key: 'luffy', name: 'Monkey D. Luffy', roles: ['captain', 'fighter'], powerType: 'zoan', faction: 'straw-hat', haki: ['observation', 'armament', 'conqueror'], stats: stats({ combat: 95, leadership: 90, navigation: 4, morale: 40 }) }),
  character({ key: 'zoro', formerKeys: ['zolo'], name: 'Roronoa Zoro', roles: ['swordsman', 'fighter'], powerType: 'none', faction: 'straw-hat', haki: ['observation', 'armament', 'conqueror'], stats: stats({ combat: 92, leadership: 50, navigation: 2 }) }),
  character({ key: 'nami', name: 'Nami', roles: ['navigator'], powerType: 'none', faction: 'straw-hat', stats: stats({ combat: 35, navigation: 95, helm: 40, precision: 30 }) }),
  character({ key: 'usopp', name: 'Usopp', roles: ['sniper'], powerType: 'none', faction: 'straw-hat', haki: ['observation'], stats: stats({ combat: 45, precision: 92, shipcraft: 40, morale: 50 }) }),
  character({ key: 'sanji', name: 'Vinsmoke Sanji', roles: ['cook', 'fighter'], powerType: 'none', faction: 'straw-hat', haki: ['observation', 'armament'], stats: stats({ combat: 88, provisions: 98, medicine: 20 }) }),
  character({ key: 'chopper', name: 'Tony Tony Chopper', roles: ['doctor'], powerType: 'zoan', faction: 'straw-hat', stats: stats({ combat: 50, medicine: 95, knowledge: 40 }) }),
  character({ key: 'robin', name: 'Nico Robin', roles: ['scholar'], powerType: 'paramecia', faction: 'straw-hat', haki: ['observation'], stats: stats({ combat: 70, knowledge: 98, navigation: 20 }) }),
  character({ key: 'franky', name: 'Franky', roles: ['shipwright', 'fighter'], powerType: 'none', faction: 'straw-hat', stats: stats({ combat: 72, shipcraft: 96, helm: 30 }) }),
  character({ key: 'brook', name: 'Brook', roles: ['musician', 'swordsman'], powerType: 'paramecia', faction: 'straw-hat', haki: ['observation'], stats: stats({ combat: 68, morale: 95 }) }),
  character({ key: 'jinbe', name: 'Jinbe', roles: ['helmsman', 'fighter'], powerType: 'none', faction: 'straw-hat', haki: ['observation', 'armament'], stats: stats({ combat: 85, helm: 96, navigation: 50, leadership: 60 }) }),
  character({ key: 'ace', name: 'Portgas D. Ace', roles: ['captain', 'fighter'], powerType: 'logia', faction: 'whitebeard', haki: ['observation', 'armament', 'conqueror'], stats: stats({ combat: 88, leadership: 75 }) }),
  character({ key: 'marco', name: 'Marco', roles: ['fighter', 'doctor'], powerType: 'zoan', faction: 'whitebeard', haki: ['observation', 'armament'], stats: stats({ combat: 90, medicine: 70, leadership: 55 }) }),
  character({ key: 'yamato', name: 'Yamato', roles: ['fighter'], powerType: 'zoan', faction: 'independent', haki: ['observation', 'armament', 'conqueror'], stats: stats({ combat: 90, leadership: 40 }) }),
  character({ key: 'law', name: 'Trafalgar Law', roles: ['captain', 'doctor'], powerType: 'paramecia', faction: 'heart', haki: ['observation', 'armament'], stats: stats({ combat: 88, medicine: 92, leadership: 75, navigation: 30 }) }),
  character({ key: 'kid', name: 'Eustass Kid', roles: ['captain', 'fighter'], powerType: 'paramecia', faction: 'kid', haki: ['observation', 'armament', 'conqueror'], stats: stats({ combat: 89, leadership: 70, shipcraft: 40 }) }),
  character({ key: 'killer', name: 'Killer', roles: ['fighter'], powerType: 'none', faction: 'kid', haki: ['observation', 'armament'], stats: stats({ combat: 84 }) }),
  character({ key: 'hawkins', name: 'Basil Hawkins', roles: ['captain'], powerType: 'paramecia', faction: 'beasts', stats: stats({ combat: 70, leadership: 60, knowledge: 40 }) }),
  character({ key: 'drake', name: 'X Drake', roles: ['captain', 'fighter'], powerType: 'zoan', faction: 'marine', haki: ['observation', 'armament'], stats: stats({ combat: 80, leadership: 60 }) }),
  character({ key: 'bonney', name: 'Jewelry Bonney', roles: ['captain'], powerType: 'paramecia', faction: 'independent', stats: stats({ combat: 72, leadership: 55, provisions: 40 }) }),
  character({ key: 'apoo', name: 'Scratchmen Apoo', roles: ['captain', 'musician'], powerType: 'paramecia', faction: 'beasts', stats: stats({ combat: 72, morale: 70 }) }),
  character({ key: 'urouge', name: 'Urouge', roles: ['captain', 'fighter'], powerType: 'paramecia', faction: 'independent', stats: stats({ combat: 80 }) }),
  character({ key: 'bege', name: 'Capone Bege', roles: ['captain'], powerType: 'paramecia', faction: 'big-mom', stats: stats({ combat: 70, leadership: 65 }) }),
  character({ key: 'blackbeard', name: 'Marshall D. Teach', roles: ['captain', 'fighter'], powerType: 'logia', faction: 'blackbeard', haki: ['observation', 'armament'], stats: stats({ combat: 94, leadership: 80 }) }),
  character({ key: 'koby', name: 'Koby', roles: ['fighter'], powerType: 'none', faction: 'marine', haki: ['observation', 'armament'], stats: stats({ combat: 70 }) }),
  character({ key: 'iceburg', name: 'Iceburg', roles: ['shipwright'], powerType: 'none', faction: 'independent', stats: stats({ combat: 20, shipcraft: 95, leadership: 60 }) }),
  character({ key: 'kuro', name: 'Kuro', status: 'retired', roles: ['captain'], powerType: 'none', faction: 'independent', stats: stats({ combat: 60, leadership: 50 }) }),
]

export const catalog: CatalogInput = {
  characters,
  abilities: [
    { key: 'monster-trio', name: 'Monster Trio', kind: 'compound' },
    { key: 'king-and-swordsman', name: 'King and Swordsman', kind: 'compound' },
    { key: 'gomu-gomu', name: 'Gomu Gomu no Mi', kind: 'devilFruit' },
  ],
  objectives: [
    {
      key: 'grand-line',
      name: 'Grand Line Survivors',
      weights: { navigation: 5, medicine: 4, provisions: 3, helm: 2 },
      requiredPositions: ['doctor', 'navigator'],
    },
    { key: 'brawl', name: 'All-out Brawl', weights: { combat: 5 }, requiredPositions: [] },
    { key: 'festival', name: 'Festival Crew', weights: { morale: 5, provisions: 3 }, requiredPositions: [] },
  ],
}

/** The canonical Straw Hat crew, as a crewPreset would hold it. */
export const strawHats = [
  { position: 'captain', character: 'luffy' },
  { position: 'first-mate', character: 'zoro' },
  { position: 'navigator', character: 'nami' },
  { position: 'sniper', character: 'usopp' },
  { position: 'cook', character: 'sanji' },
  { position: 'doctor', character: 'chopper' },
  { position: 'archaeologist', character: 'robin' },
  { position: 'shipwright', character: 'franky' },
  { position: 'musician', character: 'brook' },
  { position: 'helmsman', character: 'jinbe' },
] as const
