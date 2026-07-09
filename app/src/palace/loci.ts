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
  { id: 'mailbox', name: 'Mailbox', sceneId: 'exterior', openVerb: 'open the flap of', prompt: 'inside the mailbox' },
  { id: 'doormat', name: 'Doormat', sceneId: 'exterior', openVerb: 'lift', prompt: 'under the doormat' },
  { id: 'closet', name: 'Coat Closet', sceneId: 'entry', openVerb: 'open', prompt: 'in the coat closet' },
  { id: 'firescreen', name: 'Fireplace', sceneId: 'living', openVerb: 'slide the screen off', prompt: 'in the fireplace, behind the screen' },
  { id: 'oven', name: 'Oven', sceneId: 'kitchen', openVerb: 'pull down the door of', prompt: 'inside the oven' },
  { id: 'fridge', name: 'Fridge', sceneId: 'kitchen', openVerb: 'open', prompt: 'inside the fridge' },
  { id: 'mirror', name: 'Mirror Cabinet', sceneId: 'hallway', openVerb: 'swing open', prompt: 'behind the hallway mirror' },
  { id: 'wardrobe', name: 'Wardrobe', sceneId: 'bedroom', openVerb: 'open the doors of', prompt: 'in the bedroom wardrobe' },
]

export function locusAt(step: number): Locus {
  const locus = LOCI[step]
  if (!locus) throw new RangeError(`no locus at step ${step}`)
  return locus
}

export function sceneName(id: SceneId): string {
  return SCENES.find((s) => s.id === id)!.name
}
