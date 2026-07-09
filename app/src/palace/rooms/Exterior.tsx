import { ClueSlot, Hotspot, occluderStyle, P, type SceneProps } from './shared.tsx'

/** Front yard: picket fence, house facade, MAILBOX (locus 1) and DOORMAT (locus 2). */
export default function Exterior({ openLocusId, highlightLocusId, onLocusClick, clues }: SceneProps) {
  const mailboxOpen = openLocusId === 'mailbox'
  const doormatOpen = openLocusId === 'doormat'

  return (
    <g>
      {/* sky, sun, grass */}
      <rect width={800} height={330} fill={P.sky} />
      <circle cx={690} cy={80} r={42} fill={P.amberLight} />
      <circle cx={690} cy={80} r={30} fill={P.amber} opacity={0.6} />
      <rect y={330} width={800} height={170} fill={P.grass} />

      {/* house facade */}
      <g>
        <rect x={330} y={130} width={360} height={210} fill={P.cream} stroke={P.ink} strokeWidth={3} />
        <polygon points="310,135 510,40 710,135" fill={P.brick} stroke={P.ink} strokeWidth={3} />
        {/* door */}
        <rect x={480} y={210} width={70} height={130} rx={4} fill={P.dusk} stroke={P.ink} strokeWidth={3} />
        <circle cx={537} cy={280} r={5} fill={P.amber} />
        {/* windows */}
        <g stroke={P.ink} strokeWidth={3}>
          <rect x={370} y={190} width={62} height={62} fill={P.sky} />
          <line x1={401} y1={190} x2={401} y2={252} />
          <line x1={370} y1={221} x2={432} y2={221} />
          <rect x={590} y={190} width={62} height={62} fill={P.sky} />
          <line x1={621} y1={190} x2={621} y2={252} />
          <line x1={590} y1={221} x2={652} y2={221} />
        </g>
        {/* porch step + DOORMAT */}
        <rect x={462} y={340} width={106} height={16} fill={P.floorDark} stroke={P.ink} strokeWidth={2} />
      </g>

      {/* path from gate to porch */}
      <path d="M 200 500 C 260 430 400 400 505 360 L 525 372 C 430 420 320 450 280 500 Z" fill={P.floorDark} opacity={0.55} />

      {/* picket fence */}
      <g fill={P.cream} stroke={P.ink} strokeWidth={2}>
        {[40, 90, 140, 640, 700, 760].map((x) => (
          <polygon key={x} points={`${x},340 ${x + 18},340 ${x + 18},420 ${x + 9},432 ${x},420`} />
        ))}
        <rect x={30} y={355} width={140} height={10} />
        <rect x={630} y={355} width={158} height={10} />
      </g>

      {/* ============ LOCUS: doormat (under the porch step) ============ */}
      <g>
        {/* shallow recess the clue sits in — fully hidden by the mat when closed */}
        <rect x={464} y={364} width={102} height={36} rx={6} fill={P.ink} opacity={0.85} />
        <ClueSlot id="doormat" x={468} y={366} width={94} height={32}>
          {clues['doormat']}
        </ClueSlot>
        {/* the mat tips up on its left edge */}
        <g style={occluderStyle(doormatOpen, 'rotate(-78deg)', 'left center')}>
          <rect x={462} y={362} width={106} height={40} rx={6} fill={P.brick} stroke={P.ink} strokeWidth={3} />
          <text x={515} y={388} textAnchor="middle" fontFamily="Georgia, serif" fontSize={15} fill={P.cream}>
            WELCOME
          </text>
        </g>
        <Hotspot cx={515} cy={382} r={54} onClick={() => onLocusClick('doormat')} highlighted={highlightLocusId === 'doormat'} label="Doormat" />
      </g>

      {/* ============ LOCUS: mailbox (on a post by the gate) ============ */}
      <g>
        {/* post */}
        <rect x={180} y={310} width={14} height={120} fill={P.floorDark} stroke={P.ink} strokeWidth={2} />
        {/* box body */}
        <g>
          <path d="M 130 258 L 238 258 A 26 26 0 0 1 264 284 L 264 316 L 130 316 Z" fill={P.sage} stroke={P.ink} strokeWidth={3} />
          {/* interior visible when flap open */}
          <rect x={134} y={262} width={124} height={50} rx={6} fill={P.ink} opacity={0.85} />
          {/* clue inside */}
          <ClueSlot id="mailbox" x={137} y={264} width={118} height={46}>
            {clues['mailbox']}
          </ClueSlot>
          {/* flap door: hinges at its bottom edge, drops open toward the viewer */}
          <g style={occluderStyle(mailboxOpen, 'scaleY(0.2)', 'center bottom')}>
            <path d="M 130 258 A 28 28 0 0 0 102 286 L 102 316 L 130 316 Z" fill={P.sageDark} stroke={P.ink} strokeWidth={3} transform="translate(28 0)" />
            <rect x={130} y={258} width={128} height={58} rx={8} fill={P.sage} stroke={P.ink} strokeWidth={3} />
            <circle cx={244} cy={288} r={5} fill={P.amber} stroke={P.ink} strokeWidth={2} />
          </g>
          {/* red flag */}
          <rect x={262} y={252} width={6} height={34} fill={P.ink} />
          <polygon points="268,252 300,262 268,272" fill={P.brick} stroke={P.ink} strokeWidth={2} />
        </g>
        <Hotspot cx={196} cy={288} r={62} onClick={() => onLocusClick('mailbox')} highlighted={highlightLocusId === 'mailbox'} label="Mailbox" />
      </g>
    </g>
  )
}
