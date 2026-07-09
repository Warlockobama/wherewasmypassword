import { useState } from 'react'
import Palace from './palace/Palace.tsx'
import { LOCI } from './palace/loci.ts'
import { ClueCard } from './palace/rooms/shared.tsx'

// Temporary dev harness: walk the palace with sample clues in every locus.
const SAMPLE = ['abacus', 'zebra', 'lantern', 'copper', 'velvet', 'meteor', 'sardine', 'walnut']

export default function App() {
  const [step, setStep] = useState(0)
  const [openId, setOpenId] = useState<string | null>(null)

  const clues = Object.fromEntries(
    LOCI.map((l, i) => [l.id, <ClueCard key={l.id} word={SAMPLE[i]} imagery={`a vivid ${SAMPLE[i]} doing something absurd`} />]),
  )

  return (
    <main className="flex h-full flex-col items-center justify-center gap-2 p-4">
      <h1 className="font-display text-2xl">Palace dev harness</h1>
      <Palace
        stepIndex={step}
        onStepChange={(i) => {
          setStep(i)
          setOpenId(null)
        }}
        clues={clues}
        openLocusId={openId}
        onLocusClick={(id) => setOpenId(openId === id ? null : id)}
        highlightLocusId={LOCI[step].id === openId ? null : LOCI[step].id}
      />
    </main>
  )
}
