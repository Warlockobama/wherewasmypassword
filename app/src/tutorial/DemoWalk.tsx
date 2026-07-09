import { useState } from 'react'
import Palace from '../palace/Palace.tsx'
import { LOCI } from '../palace/loci.ts'
import { ClueCard } from '../palace/rooms/shared.tsx'
import { Button, Panel, Screen, Title } from '../ui.tsx'

/**
 * Fixed, throwaway demo phrase — teaches the mechanics risk-free. Each image
 * is fused with the locus's permanent resident to demonstrate anchoring.
 */
const DEMO = [
  { word: 'piano', imagery: 'the sumo wrestler is crushing a tiny grand piano under his belly, keys shrieking' },
  { word: 'tornado', imagery: 'grandma is can-canning inside a miniature tornado, fishnets flapping' },
  { word: 'butter', imagery: 'Elvis is slathering every coat with melted butter, thong glistening' },
]

type Stage = 'walk' | 'quiz-forward' | 'quiz-backward' | 'done'

export default function DemoWalk({ onComplete }: { onComplete: () => void }) {
  const [stage, setStage] = useState<Stage>('walk')
  const [step, setStep] = useState(0)
  const [opened, setOpened] = useState(false)
  const [answer, setAnswer] = useState<string | null>(null)

  const locus = LOCI[step]
  const clues = Object.fromEntries(
    DEMO.map((d, i) => [
      LOCI[i].id,
      <ClueCard key={i} word={d.word} imagery={d.imagery} anchorEmoji={LOCI[i].anchor.emoji} />,
    ]),
  )

  const advanceWalk = () => {
    if (step < DEMO.length - 1) {
      setStep(step + 1)
      setOpened(false)
    } else {
      setStage('quiz-forward')
      setAnswer(null)
    }
  }

  return (
    <Screen wide>
      <Title>Practice Walk</Title>

      {stage === 'walk' && (
        <>
          <Palace
            stepIndex={step}
            clues={clues}
            openLocusId={opened ? locus.id : null}
            onLocusClick={(id) => id === locus.id && setOpened(true)}
            highlightLocusId={opened ? null : locus.id}
            activeLocusCount={DEMO.length}
            completedSteps={new Set(Array.from({ length: step }, (_, i) => i))}
            showNav={false}
          />
          <Panel className="w-full text-center">
            {!opened ? (
              <p>
                Someone already hid three words along this route. Walk up and{' '}
                <strong>
                  {locus.openVerb} the {locus.name.toLowerCase()}
                </strong>{' '}
                — click it.
              </p>
            ) : (
              <div className="space-y-3">
                <p>
                  <strong className="uppercase">{DEMO[step].word}</strong> — picture it:{' '}
                  <em>{DEMO[step].imagery}</em>
                </p>
                <p className="text-sm text-dusk/70">
                  {locus.anchor.emoji} Notice <strong>{locus.anchor.name}</strong> — they live at this
                  stop permanently. That&apos;s the <em>anchor</em>: a shocking resident your memory
                  grabs onto, so the word never floats free. The weirder, the stickier.
                </p>
                <Button onClick={advanceWalk}>
                  {step < DEMO.length - 1 ? 'Walk to the next stop →' : 'End of the route'}
                </Button>
              </div>
            )}
          </Panel>
        </>
      )}

      {stage === 'quiz-forward' && (
        <QuizCard
          key="fwd"
          question={`Without looking — what was ${LOCI[1].prompt}? (Grandma was dancing in it.)`}
          options={['piano', 'tornado', 'butter']}
          correct="tornado"
          answer={answer}
          onAnswer={setAnswer}
          explain="You just walked the route: mailbox → doormat → closet. Your mind replays the walk, finds grandma mid-can-can, and there's the tornado around her. The resident pulls the word back."
          onNext={() => {
            setStage('quiz-backward')
            setAnswer(null)
          }}
        />
      )}

      {stage === 'quiz-backward' && (
        <QuizCard
          key="bwd"
          question="Now walk it BACKWARD from the coat closet. What comes right before the closet?"
          options={['the piano in the mailbox', 'the tornado under the doormat', 'the butter in the closet']}
          correct="the tornado under the doormat"
          answer={answer}
          onAnswer={setAnswer}
          explain="That's the real power: a route works in both directions, so you can recover your phrase even if you lose your place."
          onNext={() => setStage('done')}
        />
      )}

      {stage === 'done' && (
        <Panel className="w-full space-y-3 text-center">
          <p className="text-lg">
            That&apos;s the whole method. Now let&apos;s do it for real — with <strong>your</strong>{' '}
            words, <strong>your</strong> images, and a phrase strong enough to guard everything.
          </p>
          <Button onClick={onComplete}>Generate my passphrase</Button>
        </Panel>
      )}
    </Screen>
  )
}

function QuizCard({
  question,
  options,
  correct,
  answer,
  onAnswer,
  explain,
  onNext,
}: {
  question: string
  options: string[]
  correct: string
  answer: string | null
  onAnswer: (a: string) => void
  explain: string
  onNext: () => void
}) {
  const isCorrect = answer === correct
  return (
    <Panel className="w-full space-y-4 text-center">
      <p className="text-lg font-semibold">{question}</p>
      <div className="flex flex-wrap justify-center gap-3">
        {options.map((o) => (
          <Button
            key={o}
            variant={answer === o ? 'primary' : 'secondary'}
            onClick={() => onAnswer(o)}
            disabled={answer === correct}
          >
            {o}
          </Button>
        ))}
      </div>
      {answer !== null &&
        (isCorrect ? (
          <div className="space-y-3">
            <p className="font-semibold text-sage">Exactly.</p>
            <p className="text-dusk/80">{explain}</p>
            <Button onClick={onNext}>Continue</Button>
          </div>
        ) : (
          <p className="font-semibold text-brick">Not quite — replay the walk in your mind and try again.</p>
        ))}
    </Panel>
  )
}
