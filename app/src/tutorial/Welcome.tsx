import { useRef, useState } from 'react'
import { parseBackup } from '../storage/backup.ts'
import { archiveCurrentVault, saveVault, type StoredVault } from '../storage/db.ts'
import { Button, Panel, Progress, Screen, Title } from '../ui.tsx'

const PAGES: { title: string; body: React.ReactNode }[] = [
  {
    title: 'Where Was My Password',
    body: (
      <>
        <p>
          This is a password manager with one unusual promise: <strong>you will actually remember your
          master password</strong> — a long, random, genuinely strong one — without writing it down.
        </p>
        <p>
          Everything else gets stored encrypted on this device, locked by that single passphrase. You
          only ever have to remember one thing. Let&apos;s make sure you remember it forever.
        </p>
      </>
    ),
  },
  {
    title: 'The Method of Loci',
    body: (
      <>
        <p>
          For 2,500 years, memory champions have used the same trick — the <em>method of loci</em>,
          popularized by the book <em>Moonwalking with Einstein</em>. Your spatial memory is vastly
          stronger than your working memory. You forget phone numbers; you never forget the layout of
          your childhood home.
        </p>
        <p>
          The trick: place vivid, absurd images at spots along a route through a space you know. To
          recall, you simply walk the route in your mind and <em>look</em> at what you left there.
        </p>
        <p>
          And the book&apos;s dirty secret: the images that stick hardest are the lewd, crude,
          outrageous ones. Every stop in your house has a permanent, ridiculous <strong>resident</strong>{' '}
          — an anchor your memory grabs onto. You&apos;ll fuse each word with them, as scandalously
          as you like. It stays in your head; no one else ever sees it.
        </p>
      </>
    ),
  },
  {
    title: 'Your Memory House',
    body: (
      <>
        <p>
          We&apos;ll give you a little house with a fixed route through it: mailbox, doormat, coat
          closet, fireplace, oven, fridge, mirror, wardrobe. Your master passphrase will be a handful
          of random words — and you&apos;ll hide each one somewhere along that route, wrapped in an
          image too weird to forget.
        </p>
        <p>
          Then you&apos;ll walk the house forwards and backwards until the phrase is simply… there.
          First, a quick practice walk with training wheels.
        </p>
      </>
    ),
  },
]

export default function Welcome({
  onComplete,
  onRestored,
}: {
  onComplete: () => void
  onRestored: (stored: StoredVault) => void
}) {
  const [page, setPage] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const last = page === PAGES.length - 1

  const restore = async (file: File) => {
    try {
      const restored = parseBackup(await file.text())
      // Archive unconditionally, exactly as the lock screen's restore does.
      // Nothing should reach this screen with a vault present, but "should"
      // is not a reason for the one destructive path to be the unguarded one.
      await archiveCurrentVault()
      await saveVault(restored)
      onRestored(restored)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Screen>
      <Title>{PAGES[page].title}</Title>
      <Progress current={page} total={PAGES.length} />
      <Panel className="space-y-3 leading-relaxed">{PAGES[page].body}</Panel>
      <div className="flex gap-3">
        {page > 0 && (
          <Button variant="secondary" onClick={() => setPage(page - 1)}>
            Back
          </Button>
        )}
        <Button onClick={() => (last ? onComplete() : setPage(page + 1))}>
          {last ? 'Take the practice walk' : 'Next'}
        </Button>
      </div>
      <button
        type="button"
        className="text-sm text-dusk/60 underline underline-offset-2 hover:text-dusk"
        onClick={() => fileRef.current?.click()}
      >
        Already have a vault backup? Restore it
      </button>
      {error && <p className="text-sm font-semibold text-brick">{error}</p>}
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void restore(f)
          e.target.value = ''
        }}
      />
    </Screen>
  )
}
