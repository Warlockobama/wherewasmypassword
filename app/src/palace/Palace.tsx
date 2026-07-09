import type { ReactNode } from 'react'
import { LOCI, locusAt, sceneName, type SceneId } from './loci.ts'
import type { SceneProps } from './rooms/shared.tsx'
import Exterior from './rooms/Exterior.tsx'
import EntryHall from './rooms/EntryHall.tsx'
import LivingRoom from './rooms/LivingRoom.tsx'
import Kitchen from './rooms/Kitchen.tsx'
import Hallway from './rooms/Hallway.tsx'
import Bedroom from './rooms/Bedroom.tsx'

const SCENE_COMPONENTS: Record<SceneId, (props: SceneProps) => ReactNode> = {
  exterior: Exterior,
  entry: EntryHall,
  living: LivingRoom,
  kitchen: Kitchen,
  hallway: Hallway,
  bedroom: Bedroom,
}

export interface PalaceProps {
  /** Position on the route (index into LOCI). The scene shown is this locus's room. */
  stepIndex: number
  onStepChange?: (index: number) => void
  /** Compartment contents by locus id (ClueCard / MysteryCard / EmptySlot). */
  clues: Record<string, ReactNode>
  openLocusId: string | null
  onLocusClick: (id: string) => void
  highlightLocusId?: string | null
  /** How many loci are in use (phrase length); the rest render dimmed in the minimap. */
  activeLocusCount?: number
  /** Steps already completed, shown green in the minimap. */
  completedSteps?: ReadonlySet<number>
  /** Hide prev/next when a flow drives movement itself. */
  showNav?: boolean
}

export default function Palace({
  stepIndex,
  onStepChange,
  clues,
  openLocusId,
  onLocusClick,
  highlightLocusId = null,
  activeLocusCount = LOCI.length,
  completedSteps,
  showNav = true,
}: PalaceProps) {
  const locus = locusAt(stepIndex)
  const Scene = SCENE_COMPONENTS[locus.sceneId]
  const canPrev = stepIndex > 0
  const canNext = stepIndex < activeLocusCount - 1

  return (
    <div className="mx-auto w-full max-w-3xl select-none">
      {/* room title */}
      <div className="mb-1 flex items-baseline justify-between px-1">
        <h2 className="font-display text-xl text-dusk">{sceneName(locus.sceneId)}</h2>
        <span className="text-sm text-dusk/70">
          stop {stepIndex + 1} of {activeLocusCount} — {locus.name}
        </span>
      </div>

      {/* the scene */}
      <div className="relative overflow-hidden rounded-xl border-4 border-dusk bg-parchment-dark shadow-lg">
        <svg key={locus.sceneId} viewBox="0 0 800 500" className="scene-enter block w-full">
          <Scene
            openLocusId={openLocusId}
            highlightLocusId={highlightLocusId}
            onLocusClick={onLocusClick}
            clues={clues}
          />
        </svg>

        {showNav && (
          <>
            <NavButton side="left" disabled={!canPrev} onClick={() => onStepChange?.(stepIndex - 1)} />
            <NavButton side="right" disabled={!canNext} onClick={() => onStepChange?.(stepIndex + 1)} />
          </>
        )}
      </div>

      {/* minimap: the route as a strip of stops */}
      <ol className="mt-3 flex items-center justify-center gap-1">
        {LOCI.map((l, i) => {
          const isActive = i === stepIndex
          const isUsed = i < activeLocusCount
          const isDone = completedSteps?.has(i) ?? false
          return (
            <li key={l.id} className="flex items-center">
              {i > 0 && <span className={`h-0.5 w-4 ${isUsed ? 'bg-dusk/40' : 'bg-dusk/15'}`} />}
              <button
                type="button"
                disabled={!isUsed || !showNav || !onStepChange}
                onClick={() => onStepChange?.(i)}
                title={l.name}
                className={[
                  'flex h-7 min-w-7 items-center justify-center rounded-full border-2 px-1 text-xs font-bold transition-all',
                  isActive
                    ? 'scale-110 border-amber-glow bg-amber-glow text-white shadow'
                    : isDone
                      ? 'border-sage bg-sage text-white'
                      : isUsed
                        ? 'border-dusk/50 bg-parchment text-dusk'
                        : 'border-dusk/20 bg-transparent text-dusk/30',
                  showNav && isUsed && onStepChange ? 'cursor-pointer hover:scale-110' : 'cursor-default',
                ].join(' ')}
              >
                {i + 1}
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function NavButton({ side, disabled, onClick }: { side: 'left' | 'right'; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={side === 'left' ? 'Walk back' : 'Walk forward'}
      disabled={disabled}
      onClick={onClick}
      className={[
        'absolute top-1/2 -translate-y-1/2 rounded-full border-2 border-dusk bg-parchment/90 p-2 text-xl leading-none text-dusk shadow transition-all',
        side === 'left' ? 'left-2' : 'right-2',
        disabled ? 'cursor-default opacity-25' : 'hover:scale-110 hover:bg-amber-glow hover:text-white',
      ].join(' ')}
    >
      {side === 'left' ? '←' : '→'}
    </button>
  )
}
