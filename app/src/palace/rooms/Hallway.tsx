import { ClueSlot, Hotspot, occluderStyle, P, RoomShell, type SceneProps } from './shared.tsx'

/** Hallway: runner rug, sconces, and the MIRROR CABINET (locus 7). */
export default function Hallway({ openLocusId, highlightLocusId, onLocusClick, clues }: SceneProps) {
  const open = openLocusId === 'mirror'

  return (
    <g>
      <RoomShell wall={P.wall} floorY={340} />

      {/* receding corridor: doorframes left and right */}
      <g stroke={P.ink} strokeWidth={3}>
        <rect x={60} y={120} width={96} height={220} fill={P.brickDark} />
        <rect x={72} y={132} width={72} height={208} fill={P.dusk} />
        <rect x={644} y={120} width={96} height={220} fill={P.brickDark} />
        <rect x={656} y={132} width={72} height={208} fill={P.dusk} />
      </g>

      {/* wall sconces */}
      {[230, 570].map((x) => (
        <g key={x}>
          <rect x={x - 4} y={160} width={8} height={22} fill={P.brickDark} />
          <polygon points={`${x - 14},160 ${x + 14},160 ${x + 8},140 ${x - 8},140`} fill={P.amberLight} stroke={P.ink} strokeWidth={2} />
          <circle cx={x} cy={136} r={9} fill={P.amber} opacity={0.5} />
        </g>
      ))}

      {/* small plant */}
      <g>
        <path d="M 320 340 l 6 -40 m -6 40 l -14 -34 m 14 34 l 16 -30" stroke={P.sageDark} strokeWidth={4} fill="none" />
        <circle cx={326} cy={296} r={8} fill={P.sage} />
        <circle cx={306} cy={302} r={8} fill={P.sage} />
        <circle cx={336} cy={306} r={8} fill={P.sage} />
        <path d="M 306 340 L 334 340 L 328 372 L 312 372 Z" fill={P.brick} stroke={P.ink} strokeWidth={3} />
      </g>

      {/* ============ LOCUS: mirror cabinet ============ */}
      <g>
        {/* cabinet box recessed in the wall */}
        <rect x={412} y={140} width={132} height={180} rx={6} fill={P.brickDark} stroke={P.ink} strokeWidth={4} />
        <rect x={422} y={150} width={112} height={160} fill={P.ink} />
        {/* shallow shelves */}
        <line x1={422} y1={210} x2={534} y2={210} stroke={P.duskLight} strokeWidth={3} />
        <line x1={422} y1={266} x2={534} y2={266} stroke={P.duskLight} strokeWidth={3} />
        <rect x={430} y={190} width={16} height={20} rx={3} fill={P.sage} />
        <rect x={510} y={247} width={14} height={19} rx={3} fill={P.amberLight} />
        {/* clue on the middle shelf */}
        <ClueSlot id="mirror" x={426} y={212} width={104} height={52}>
          {clues['mirror']}
        </ClueSlot>
        {/* mirror door: hinges left, swings open toward the viewer */}
        <g style={occluderStyle(open, 'scaleX(0.15)', 'left center')}>
          <rect x={416} y={144} width={124} height={172} rx={6} fill={P.sky} stroke={P.ink} strokeWidth={4} />
          {/* mirror shine */}
          <line x1={434} y1={296} x2={510} y2={168} stroke={P.cream} strokeWidth={10} opacity={0.7} />
          <line x1={452} y1={300} x2={522} y2={182} stroke={P.cream} strokeWidth={4} opacity={0.7} />
          <circle cx={532} cy={230} r={5} fill={P.amber} stroke={P.ink} strokeWidth={2} />
        </g>
        <Hotspot cx={478} cy={230} r={84} onClick={() => onLocusClick('mirror')} highlighted={highlightLocusId === 'mirror'} label="Mirror cabinet" />
      </g>

      {/* runner rug */}
      <path d="M 340 500 L 460 500 L 430 356 L 370 356 Z" fill={P.brick} opacity={0.6} />
      <path d="M 352 500 L 448 500 L 422 370 L 378 370 Z" fill="none" stroke={P.cream} strokeWidth={3} opacity={0.6} />
    </g>
  )
}
