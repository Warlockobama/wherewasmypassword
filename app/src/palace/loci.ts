/**
 * The fixed route through the starter house. Order matters: this array IS
 * the journey, walked forward and backward during training. 8 loci support
 * phrases of 5-8 words (extra loci simply stay empty).
 */
export interface Locus {
  id: string
  /** Short label shown in the minimap and quiz prompts. */
  name: string
  sceneId: SceneId
  /** How the compartment opens — used in coaching copy. */
  openVerb: string
  /** Where the clue physically sits, for prompts like "what's inside the mailbox?" */
  prompt: string
  /**
   * The anchoring layer (per *Moonwalking with Einstein*): every locus has a
   * permanent, ridiculous resident. Fusing your word with the resident gives
   * memory a second, emotionally charged handle — and because the resident
   * never changes, it doubles as a landmark on the route. The app keeps these
   * PG-13; users are coached to make their private version as lewd as they
   * dare, since nobody else ever sees it.
   */
  anchor: Anchor
}

export interface Anchor {
  /** e.g. "the sweaty sumo wrestler" — always with the definite article. */
  name: string
  emoji: string
  /** What the resident is doing, to seed the user's mental scene. */
  doing: string
}

export type SceneId =
  | 'exterior'
  | 'entry'
  | 'living'
  | 'kitchen'
  | 'hallway'
  | 'bedroom'

export interface Scene {
  id: SceneId
  name: string
}

export const SCENES: readonly Scene[] = [
  { id: 'exterior', name: 'Front Yard' },
  { id: 'entry', name: 'Entry Hall' },
  { id: 'living', name: 'Living Room' },
  { id: 'kitchen', name: 'Kitchen' },
  { id: 'hallway', name: 'Hallway' },
  { id: 'bedroom', name: 'Bedroom' },
]

export const LOCI: readonly Locus[] = [
  {
    id: 'mailbox', name: 'Mailbox', sceneId: 'exterior', openVerb: 'open the flap of', prompt: 'inside the mailbox',
    anchor: { name: 'the sweaty sumo wrestler', emoji: '🤼', doing: 'wedged inside, straining against the walls' },
  },
  {
    id: 'doormat', name: 'Doormat', sceneId: 'exterior', openVerb: 'lift', prompt: 'under the doormat',
    anchor: { name: 'grandma in fishnet stockings', emoji: '💃', doing: 'doing the can-can right on top of it' },
  },
  {
    id: 'closet', name: 'Coat Closet', sceneId: 'entry', openVerb: 'open', prompt: 'in the coat closet',
    anchor: { name: 'Elvis in a leopard-print thong', emoji: '🕺', doing: 'gyrating between the coats' },
  },
  {
    id: 'firescreen', name: 'Fireplace', sceneId: 'living', openVerb: 'slide the screen off', prompt: 'in the fireplace, behind the screen',
    anchor: { name: 'the naked opera singer', emoji: '🎭', doing: 'belting an aria from the hearth, sooty and unashamed' },
  },
  {
    id: 'oven', name: 'Oven', sceneId: 'kitchen', openVerb: 'pull down the door of', prompt: 'inside the oven',
    anchor: { name: 'the disco skeleton in hot pants', emoji: '💀', doing: 'baking itself at 200 degrees, still dancing' },
  },
  {
    id: 'fridge', name: 'Fridge', sceneId: 'kitchen', openVerb: 'open', prompt: 'inside the fridge',
    anchor: { name: 'Einstein in a string bikini', emoji: '👙', doing: 'lounging on the middle shelf, sipping the milk' },
  },
  {
    id: 'mirror', name: 'Mirror Cabinet', sceneId: 'hallway', openVerb: 'swing open', prompt: 'behind the hallway mirror',
    anchor: { name: 'the flossing vampire', emoji: '🧛', doing: 'flossing his fangs and grinning at himself, even though he has no reflection' },
  },
  {
    id: 'wardrobe', name: 'Wardrobe', sceneId: 'bedroom', openVerb: 'open the doors of', prompt: 'in the bedroom wardrobe',
    anchor: { name: 'the minotaur in your underwear', emoji: '🐂', doing: 'trying on everything you own, ripping the seams' },
  },
]

export function locusAt(step: number): Locus {
  const locus = LOCI[step]
  if (!locus) throw new RangeError(`no locus at step ${step}`)
  return locus
}

export function sceneName(id: SceneId): string {
  return SCENES.find((s) => s.id === id)!.name
}
