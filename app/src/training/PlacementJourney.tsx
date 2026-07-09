import { useState } from 'react'
import Palace from '../palace/Palace.tsx'
import { LOCI } from '../palace/loci.ts'
import { ClueCard } from '../palace/rooms/shared.tsx'
import type { Association } from '../crypto/vault.ts'
import { Button, Panel, Screen, Title } from '../ui.tsx'

const COACHING = [
  'Make it enormous or tiny — scale is memorable.',
  'Add motion: let it spin, drip, explode, or crawl.',
  'Involve a sense: a smell, a sound, a texture.',
  'Make it absurd — dignity is the enemy of memory.',
  'Let it interact with the spot: jammed in, overflowing, wearing it.',
  'Add emotion: something hilarious, gross, or alarming.',
  'Give it a color that clashes with everything.',
  'Exaggerate the quantity: not one — hundreds.',
]

export default function PlacementJourney({
  words,
  onComplete,
}: {
  words: string[]
  onComplete: (associations: Association[]) => void
}) {
  const [step, setStep] = useState(0)
  const [opened, setOpened] = useState(false)
  const [imagery, setImagery] = useState('')
  const [placed, setPlaced] = useState<Association[]>([])
  // Blocks interaction while the compartment-closing animation plays.
  const [transitioning, setTransitioning] = useState(false)

  const locus = LOCI[step]
  const word = words[step]
  const isPlaced = placed.length > step

  const clues = Object.fromEntries(
    placed.map((a) => [a.locusId, <ClueCard key={a.locusId} word={a.word} imagery={a.imagery} />]),
  )

  const place = () => {
    setPlaced([...placed, { locusId: locus.id, word, imagery: imagery.trim() }])
  }

  const walkOn = () => {
    setOpened(false)
    setTransitioning(true)
    const next = [...placed]
    if (step < words.length - 1) {
      // small pause so the closing animation reads as "hidden away"
      setTimeout(() => {
        setStep(step + 1)
        setImagery('')
        setTransitioning(false)
      }, 550)
    } else {
      setTimeout(() => onComplete(next), 550)
    }
  }

  return (
    <Screen wide>
      <Title>
        Hide Word {step + 1} of {words.length}
      </Title>
      <Palace
        stepIndex={step}
        clues={clues}
        openLocusId={opened ? locus.id : null}
        onLocusClick={(id) => !transitioning && id === locus.id && setOpened(true)}
        highlightLocusId={opened ? null : locus.id}
        activeLocusCount={words.length}
        completedSteps={new Set(Array.from({ length: step }, (_, i) => i))}
        showNav={false}
      />
      <Panel className="w-full space-y-3">
        {transitioning ? (
          <p className="text-center text-dusk/50">…</p>
        ) : !opened ? (
          <p className="text-center">
            Your word is <strong className="font-display text-xl uppercase">{word}</strong>. Click to{' '}
            <strong>
              {locus.openVerb} the {locus.name.toLowerCase()}
            </strong>{' '}
            and hide it there.
          </p>
        ) : !isPlaced ? (
          <>
            <p className="text-center">
              Picture <strong className="font-display text-xl uppercase">{word}</strong> {locus.prompt}.{' '}
              <em className="text-dusk/80">{COACHING[step % COACHING.length]}</em>
            </p>
            <textarea
              value={imagery}
              onChange={(e) => setImagery(e.target.value)}
              rows={2}
              placeholder={`e.g. "a ${word} ${locus.prompt}, …" — describe the image in your own words`}
              className="w-full rounded-lg border-2 border-dusk/40 bg-parchment p-2 text-sm focus:border-amber-glow focus:outline-none"
            />
            <div className="flex justify-center">
              <Button onClick={place} disabled={imagery.trim().length < 3}>
                Place it {locus.prompt.split(' ')[0]} the {locus.name.toLowerCase()}
              </Button>
            </div>
          </>
        ) : (
          <div className="space-y-3 text-center">
            <p>
              Look at it once more: <em>{placed[step].imagery || word}</em>
            </p>
            <Button onClick={walkOn}>
              {step < words.length - 1 ? 'Shut it away & walk on →' : 'Shut it away — route complete'}
            </Button>
          </div>
        )}
      </Panel>
    </Screen>
  )
}
