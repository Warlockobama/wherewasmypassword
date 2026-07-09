import { ClueSlot, Hotspot, occluderStyle, P, RoomShell, type SceneProps } from './shared.tsx'

/** Living room: sofa, window — and the FIREPLACE with sliding screen (locus 4). */
export default function LivingRoom({ openLocusId, highlightLocusId, onLocusClick, clues }: SceneProps) {
  const open = openLocusId === 'firescreen'

  return (
    <g>
      <RoomShell wall={P.wallShade} />

      {/* window with curtains */}
      <g>
        <rect x={90} y={110} width={150} height={130} fill={P.sky} stroke={P.ink} strokeWidth={3} />
        <line x1={165} y1={110} x2={165} y2={240} stroke={P.ink} strokeWidth={3} />
        <line x1={90} y1={175} x2={240} y2={175} stroke={P.ink} strokeWidth={3} />
        <path d="M 82 102 q 20 80 0 146 l -14 0 l 0 -146 Z" fill={P.brick} />
        <path d="M 248 102 q -20 80 0 146 l 14 0 l 0 -146 Z" fill={P.brick} />
      </g>

      {/* sofa */}
      <g stroke={P.ink} strokeWidth={3}>
        <rect x={80} y={300} width={250} height={60} rx={10} fill={P.dusk} />
        <rect x={92} y={266} width={104} height={44} rx={10} fill={P.duskLight} />
        <rect x={202} y={266} width={104} height={44} rx={10} fill={P.duskLight} />
        <rect x={66} y={284} width={26} height={76} rx={10} fill={P.dusk} />
        <rect x={318} y={284} width={26} height={76} rx={10} fill={P.dusk} />
      </g>

      {/* ============ LOCUS: fireplace with sliding fire screen ============ */}
      <g>
        {/* chimney breast */}
        <rect x={470} y={90} width={240} height={276} fill={P.brick} stroke={P.ink} strokeWidth={4} />
        {/* brick texture */}
        <g stroke={P.brickDark} strokeWidth={2} opacity={0.7}>
          {[120, 150, 180, 210, 240, 270, 300, 330].map((y) => (
            <line key={y} x1={470} y1={y} x2={710} y2={y} />
          ))}
          {[510, 550, 590, 630, 670].map((x) => (
            <g key={x}>
              <line x1={x} y1={120} x2={x} y2={150} />
              <line x1={x + 20} y1={150} x2={x + 20} y2={180} />
              <line x1={x} y1={180} x2={x} y2={210} />
              <line x1={x + 20} y1={210} x2={x + 20} y2={240} />
            </g>
          ))}
        </g>
        {/* mantel */}
        <rect x={456} y={196} width={268} height={16} fill={P.floorDark} stroke={P.ink} strokeWidth={3} />
        <rect x={520} y={168} width={26} height={28} fill={P.sage} stroke={P.ink} strokeWidth={2} />
        <circle cx={640} cy={182} r={14} fill={P.amberLight} stroke={P.ink} strokeWidth={2} />
        {/* firebox opening */}
        <path d="M 505 366 L 505 262 A 85 60 0 0 1 675 262 L 675 366 Z" fill={P.ink} />
        {/* clue standing in the hearth */}
        <ClueSlot id="firescreen" x={524} y={244} width={132} height={112}>
          {clues['firescreen']}
        </ClueSlot>
        {/* logs */}
        <ellipse cx={560} cy={356} rx={34} ry={9} fill={P.brickDark} />
        <ellipse cx={615} cy={356} rx={34} ry={9} fill={P.floorDark} />
        {/* fire screen: slides right to reveal */}
        <g style={occluderStyle(open, 'translate(150px, 26px) rotate(6deg)', 'center center')}>
          <path d="M 498 366 L 498 258 A 92 68 0 0 1 682 258 L 682 366 Z" fill={P.dusk} stroke={P.ink} strokeWidth={3} />
          <g stroke={P.amber} strokeWidth={3} opacity={0.9}>
            <line x1={522} y1={366} x2={522} y2={250} />
            <line x1={559} y1={366} x2={559} y2={216} />
            <line x1={596} y1={366} x2={596} y2={208} />
            <line x1={633} y1={366} x2={633} y2={218} />
            <line x1={664} y1={366} x2={664} y2={252} />
            <path d="M 498 300 L 682 300" />
          </g>
          <circle cx={590} cy={330} r={6} fill={P.amber} />
        </g>
        <Hotspot cx={590} cy={300} r={100} onClick={() => onLocusClick('firescreen')} highlighted={highlightLocusId === 'firescreen'} label="Fireplace screen" />
      </g>

      {/* rug */}
      <ellipse cx={330} cy={430} rx={180} ry={40} fill={P.sage} opacity={0.5} />
    </g>
  )
}
