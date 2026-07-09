import { ClueSlot, Hotspot, occluderStyle, P, RoomShell, type SceneProps } from './shared.tsx'

/** Entry hall: console table, picture, and the COAT CLOSET (locus 3). */
export default function EntryHall({ openLocusId, highlightLocusId, onLocusClick, clues }: SceneProps) {
  const open = openLocusId === 'closet'

  return (
    <g>
      <RoomShell />

      {/* front door we just came through */}
      <rect x={70} y={110} width={110} height={252} rx={4} fill={P.dusk} stroke={P.ink} strokeWidth={3} />
      <rect x={86} y={130} width={78} height={90} rx={3} fill={P.duskLight} stroke={P.ink} strokeWidth={2} />
      <circle cx={165} cy={245} r={6} fill={P.amber} />

      {/* picture frame */}
      <rect x={250} y={130} width={90} height={70} fill={P.cream} stroke={P.brick} strokeWidth={6} />
      <path d="M 258 190 L 285 155 L 305 178 L 318 162 L 332 190 Z" fill={P.sage} />
      <circle cx={318} cy={148} r={7} fill={P.amber} />

      {/* console table with lamp */}
      <g stroke={P.ink} strokeWidth={3}>
        <rect x={230} y={280} width={140} height={14} fill={P.brick} />
        <rect x={240} y={294} width={10} height={68} fill={P.brickDark} />
        <rect x={350} y={294} width={10} height={68} fill={P.brickDark} />
      </g>
      <g>
        <rect x={286} y={252} width={8} height={30} fill={P.ink} />
        <polygon points="270,252 310,252 302,226 278,226" fill={P.amberLight} stroke={P.ink} strokeWidth={3} />
      </g>

      {/* ============ LOCUS: coat closet ============ */}
      <g>
        {/* closet box + dark interior */}
        <rect x={480} y={100} width={200} height={266} fill={P.brickDark} stroke={P.ink} strokeWidth={4} />
        <rect x={492} y={112} width={176} height={242} fill={P.ink} />
        {/* rail + coats */}
        <line x1={496} y1={140} x2={664} y2={140} stroke={P.duskLight} strokeWidth={5} />
        <g opacity={0.9}>
          <path d="M 512 140 l 0 14 c -12 26 -14 66 -6 96 l 34 0 c 8 -30 6 -70 -6 -96 l 0 -14 Z" fill={P.dusk} stroke={P.duskLight} strokeWidth={2} />
          <path d="M 620 140 l 0 14 c -12 26 -14 66 -6 96 l 34 0 c 8 -30 6 -70 -6 -96 l 0 -14 Z" fill={P.sageDark} stroke={P.duskLight} strokeWidth={2} />
        </g>
        {/* clue hangs in the middle */}
        <ClueSlot id="closet" x={514} y={210} width={132} height={140}>
          {clues['closet']}
        </ClueSlot>
        {/* door: hinges on the left edge, swings open toward the viewer */}
        <g style={occluderStyle(open, 'scaleX(0.13)', 'left center')}>
          <rect x={484} y={104} width={192} height={258} rx={3} fill={P.sage} stroke={P.ink} strokeWidth={4} />
          <rect x={500} y={122} width={160} height={100} fill="none" stroke={P.sageDark} strokeWidth={4} />
          <rect x={500} y={240} width={160} height={100} fill="none" stroke={P.sageDark} strokeWidth={4} />
          <circle cx={656} cy={233} r={7} fill={P.amber} stroke={P.ink} strokeWidth={2} />
        </g>
        <Hotspot cx={580} cy={233} r={110} onClick={() => onLocusClick('closet')} highlighted={highlightLocusId === 'closet'} label="Coat closet" />
      </g>

      {/* rug */}
      <ellipse cx={400} cy={430} rx={170} ry={38} fill={P.brick} opacity={0.55} />
      <ellipse cx={400} cy={430} rx={120} ry={26} fill={P.cream} opacity={0.4} />
    </g>
  )
}
