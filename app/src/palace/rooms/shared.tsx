import type { CSSProperties, ReactNode } from 'react'

/** Flat-illustration palette shared by every room. */
export const P = {
  ink: '#2b2337',
  wall: '#f3e8d2',
  wallShade: '#e6d5b8',
  floor: '#c9a06c',
  floorDark: '#b58a55',
  brick: '#b5654a',
  brickDark: '#96503a',
  sage: '#7a9e7e',
  sageDark: '#5f8163',
  dusk: '#4a3f63',
  duskLight: '#6b5d8a',
  amber: '#e8a03d',
  amberLight: '#f6c877',
  cream: '#faf5ea',
  sky: '#bcd7d4',
  grass: '#93b578',
  shadow: 'rgba(43,35,55,0.18)',
} as const

/** Contract every room scene implements. */
export interface SceneProps {
  openLocusId: string | null
  highlightLocusId: string | null
  onLocusClick: (id: string) => void
  clues: Record<string, ReactNode>
}

/** Hinge/slide style for occluders: transforms relative to the shape itself. */
export function occluderStyle(open: boolean, openTransform: string, origin: string): CSSProperties {
  return {
    transform: open ? openTransform : 'none',
    transformBox: 'fill-box',
    transformOrigin: origin,
    transition: 'transform 500ms cubic-bezier(0.34, 1.2, 0.4, 1)',
    pointerEvents: 'none',
  }
}

export interface LocusVisualProps {
  open: boolean
  onClick: () => void
  highlighted: boolean
  /** Rendered inside the compartment, behind the occluder. */
  clue: ReactNode
}

/** Invisible-ish click target + pulsing ring when the flow wants attention. */
export function Hotspot({
  cx,
  cy,
  r,
  onClick,
  highlighted,
  label,
}: {
  cx: number
  cy: number
  r: number
  onClick: () => void
  highlighted: boolean
  label: string
}) {
  return (
    <g style={{ cursor: 'pointer' }} onClick={onClick} role="button" aria-label={label}>
      {highlighted && (
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={P.amber} strokeWidth={4} className="locus-pulse" />
      )}
      <circle cx={cx} cy={cy} r={r} fill="transparent" />
    </g>
  )
}

export const CLUE_W = 150
export const CLUE_H = 104

/**
 * Positions, scales, and clips a clue card to its compartment. Content is
 * top-aligned in ClueCard so shallow compartments still show the word.
 */
export function ClueSlot({
  id,
  x,
  y,
  width,
  height,
  children,
}: {
  id: string
  x: number
  y: number
  width: number
  height: number
  children: ReactNode
}) {
  const scale = width / CLUE_W
  return (
    <g>
      <clipPath id={`clueclip-${id}`}>
        <rect x={x} y={y} width={width} height={height} />
      </clipPath>
      <g clipPath={`url(#clueclip-${id})`}>
        <g transform={`translate(${x} ${y}) scale(${scale})`}>{children}</g>
      </g>
    </g>
  )
}

/**
 * The placed memory object: a luminous card bearing the word and the user's
 * vivid-imagery text. Scenes position/scale a CLUE_W x CLUE_H slot for it.
 * The locus's resident anchor peeks from the corner as the second memory hook.
 */
export function ClueCard({ word, imagery, anchorEmoji }: { word: string; imagery?: string; anchorEmoji?: string }) {
  return (
    <g>
      <rect width={CLUE_W} height={CLUE_H} rx={10} fill={P.amberLight} stroke={P.amber} strokeWidth={3} />
      <rect x={5} y={5} width={CLUE_W - 10} height={CLUE_H - 10} rx={7} fill={P.cream} />
      {anchorEmoji && (
        <text x={CLUE_W - 4} y={22} textAnchor="end" fontSize={20}>
          {anchorEmoji}
        </text>
      )}
      <foreignObject x={8} y={6} width={CLUE_W - 16} height={CLUE_H - 12}>
        <div
          style={{
            fontFamily: 'Georgia, serif',
            color: P.ink,
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-start',
            paddingTop: 4,
            textAlign: 'center',
            overflow: 'hidden',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 19, letterSpacing: 1, textTransform: 'uppercase' }}>{word}</div>
          {imagery && (
            <div
              style={{
                fontSize: 11,
                fontStyle: 'italic',
                opacity: 0.75,
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {imagery}
            </div>
          )}
        </div>
      </foreignObject>
    </g>
  )
}

/**
 * Placeholder shown in quizzes before the compartment is opened honestly.
 * The resident anchor stays visible — it's a legitimate recall hook, not a
 * spoiler: the word is what you fused WITH the resident.
 */
export function MysteryCard({ anchorEmoji }: { anchorEmoji?: string }) {
  return (
    <g>
      <rect width={CLUE_W} height={CLUE_H} rx={10} fill={P.dusk} stroke={P.duskLight} strokeWidth={3} />
      <text
        x={CLUE_W / 2}
        y={44}
        textAnchor="middle"
        fontFamily="Georgia, serif"
        fontSize={40}
        fontWeight={700}
        fill={P.amberLight}
      >
        ?
      </text>
      {anchorEmoji && (
        <text x={CLUE_W / 2} y={82} textAnchor="middle" fontSize={24}>
          {anchorEmoji}
        </text>
      )}
    </g>
  )
}

/** Empty compartment marker (loci beyond the phrase length). */
export function EmptySlot() {
  return (
    <g opacity={0.35}>
      <rect
        width={CLUE_W}
        height={CLUE_H}
        rx={10}
        fill="none"
        stroke={P.duskLight}
        strokeWidth={2}
        strokeDasharray="7 7"
      />
    </g>
  )
}

/** Interior room backdrop: wall, floor, baseboard. */
export function RoomShell({ wall = P.wall, floorY = 360 }: { wall?: string; floorY?: number }) {
  return (
    <g>
      <rect x={0} y={0} width={800} height={floorY} fill={wall} />
      <rect x={0} y={floorY} width={800} height={500 - floorY} fill={P.floor} />
      <rect x={0} y={floorY - 8} width={800} height={8} fill={P.wallShade} />
      {/* floorboards */}
      {[80, 200, 320, 440, 560, 680].map((x) => (
        <line key={x} x1={x} y1={floorY + 10} x2={x - 30} y2={500} stroke={P.floorDark} strokeWidth={2} opacity={0.5} />
      ))}
    </g>
  )
}
