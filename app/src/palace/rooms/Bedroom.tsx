import { ClueSlot, Hotspot, occluderStyle, P, RoomShell, type SceneProps } from './shared.tsx'

/** Bedroom: bed, night window — and the WARDROBE, final locus (8). */
export default function Bedroom({ openLocusId, highlightLocusId, onLocusClick, clues }: SceneProps) {
  const open = openLocusId === 'wardrobe'

  return (
    <g>
      <RoomShell wall={P.wallShade} />

      {/* night window */}
      <g>
        <rect x={110} y={100} width={140} height={120} fill={P.dusk} stroke={P.ink} strokeWidth={3} />
        <circle cx={205} cy={135} r={22} fill={P.cream} />
        <circle cx={196} cy={128} r={19} fill={P.dusk} />
        <circle cx={150} cy={165} r={2.5} fill={P.cream} />
        <circle cx={175} cy={190} r={2} fill={P.cream} />
        <circle cx={135} cy={130} r={2} fill={P.cream} />
        <line x1={180} y1={100} x2={180} y2={220} stroke={P.ink} strokeWidth={3} />
      </g>

      {/* bed */}
      <g stroke={P.ink} strokeWidth={3}>
        <rect x={80} y={252} width={22} height={120} rx={6} fill={P.brickDark} />
        <rect x={92} y={296} width={268} height={54} rx={8} fill={P.cream} />
        <rect x={92} y={276} width={70} height={30} rx={10} fill={P.amberLight} />
        <path d="M 92 322 L 360 322 L 360 350 L 92 350 Z" fill={P.sage} />
        <rect x={348} y={296} width={16} height={76} rx={5} fill={P.brickDark} />
      </g>

      {/* nightstand with candle */}
      <g stroke={P.ink} strokeWidth={3}>
        <rect x={396} y={310} width={64} height={56} fill={P.brick} />
        <rect x={422} y={282} width={12} height={28} fill={P.cream} />
        <ellipse cx={428} cy={276} rx={5} ry={9} fill={P.amber} />
      </g>

      {/* ============ LOCUS: wardrobe ============ */}
      <g>
        {/* body + interior */}
        <rect x={520} y={86} width={210} height={288} rx={6} fill={P.brickDark} stroke={P.ink} strokeWidth={4} />
        <rect x={532} y={98} width={186} height={264} fill={P.ink} />
        {/* rail + clothes */}
        <line x1={536} y1={130} x2={714} y2={130} stroke={P.duskLight} strokeWidth={5} />
        <g opacity={0.9}>
          <path d="M 550 130 l 0 12 c -10 24 -12 60 -5 88 l 30 0 c 7 -28 5 -64 -5 -88 l 0 -12 Z" fill={P.brick} stroke={P.duskLight} strokeWidth={2} />
          <path d="M 668 130 l 0 12 c -10 24 -12 60 -5 88 l 30 0 c 7 -28 5 -64 -5 -88 l 0 -12 Z" fill={P.dusk} stroke={P.duskLight} strokeWidth={2} />
        </g>
        {/* folded blankets on the floor of the wardrobe */}
        <rect x={545} y={330} width={70} height={12} rx={3} fill={P.sage} />
        <rect x={545} y={318} width={70} height={12} rx={3} fill={P.cream} opacity={0.8} />
        {/* clue in the center */}
        <ClueSlot id="wardrobe" x={552} y={196} width={146} height={118}>
          {clues['wardrobe']}
        </ClueSlot>
        {/* two doors: left hinges left, right hinges right */}
        <g style={occluderStyle(open, 'scaleX(0.13)', 'left center')}>
          <rect x={524} y={90} width={101} height={280} rx={4} fill={P.sage} stroke={P.ink} strokeWidth={4} />
          <rect x={538} y={108} width={73} height={180} fill="none" stroke={P.sageDark} strokeWidth={4} />
          <circle cx={612} cy={232} r={6} fill={P.amber} stroke={P.ink} strokeWidth={2} />
        </g>
        <g style={occluderStyle(open, 'scaleX(0.13)', 'right center')}>
          <rect x={625} y={90} width={101} height={280} rx={4} fill={P.sage} stroke={P.ink} strokeWidth={4} />
          <rect x={639} y={108} width={73} height={180} fill="none" stroke={P.sageDark} strokeWidth={4} />
          <circle cx={638} cy={232} r={6} fill={P.amber} stroke={P.ink} strokeWidth={2} />
        </g>
        <Hotspot cx={625} cy={230} r={118} onClick={() => onLocusClick('wardrobe')} highlighted={highlightLocusId === 'wardrobe'} label="Wardrobe" />
      </g>

      {/* rug */}
      <ellipse cx={300} cy={440} rx={170} ry={36} fill={P.dusk} opacity={0.35} />
    </g>
  )
}
