import { ClueSlot, Hotspot, occluderStyle, P, RoomShell, type SceneProps } from './shared.tsx'

/** Kitchen: two loci — the OVEN (drop-down door, locus 5) and the FRIDGE (locus 6). */
export default function Kitchen({ openLocusId, highlightLocusId, onLocusClick, clues }: SceneProps) {
  const ovenOpen = openLocusId === 'oven'
  const fridgeOpen = openLocusId === 'fridge'

  return (
    <g>
      <RoomShell />

      {/* window over the sink */}
      <rect x={330} y={110} width={130} height={100} fill={P.sky} stroke={P.ink} strokeWidth={3} />
      <line x1={395} y1={110} x2={395} y2={210} stroke={P.ink} strokeWidth={3} />
      <path d="M 340 200 q 20 -26 40 0 q 20 -26 40 0 q 15 -20 30 0" fill="none" stroke={P.sage} strokeWidth={4} />

      {/* counter + sink */}
      <g stroke={P.ink} strokeWidth={3}>
        <rect x={296} y={252} width={198} height={14} fill={P.floorDark} />
        <rect x={306} y={266} width={178} height={96} fill={P.cream} />
        <rect x={306} y={266} width={178} height={96} fill="none" />
        <rect x={344} y={240} width={104} height={12} rx={4} fill={P.duskLight} />
        <path d="M 380 240 l 0 -18 q 0 -10 12 -10 q 12 0 12 10 l 0 6" fill="none" stroke={P.duskLight} strokeWidth={6} />
        <line x1={396} y1={290} x2={396} y2={340} stroke={P.wallShade} strokeWidth={3} />
      </g>

      {/* ============ LOCUS: oven ============ */}
      <g>
        {/* stove body */}
        <rect x={96} y={220} width={180} height={146} fill={P.cream} stroke={P.ink} strokeWidth={4} />
        {/* cooktop + knobs */}
        <rect x={96} y={206} width={180} height={18} fill={P.duskLight} stroke={P.ink} strokeWidth={3} />
        <circle cx={130} cy={215} r={5} fill={P.ink} />
        <circle cx={160} cy={215} r={5} fill={P.ink} />
        <circle cx={212} cy={215} r={5} fill={P.ink} />
        <circle cx={242} cy={215} r={5} fill={P.ink} />
        {/* dark oven cavity */}
        <rect x={110} y={240} width={152} height={112} rx={4} fill={P.ink} />
        {/* clue on the rack */}
        <ClueSlot id="oven" x={122} y={248} width={128} height={100}>
          {clues['oven']}
        </ClueSlot>
        <line x1={112} y1={344} x2={260} y2={344} stroke={P.duskLight} strokeWidth={3} />
        {/* oven door: hinges at bottom, drops open toward the viewer */}
        <g style={occluderStyle(ovenOpen, 'scaleY(0.16)', 'center bottom')}>
          <rect x={106} y={236} width={160} height={122} rx={6} fill={P.duskLight} stroke={P.ink} strokeWidth={4} />
          <rect x={122} y={260} width={128} height={64} rx={4} fill={P.dusk} stroke={P.ink} strokeWidth={3} />
          <rect x={118} y={244} width={136} height={8} rx={4} fill={P.cream} stroke={P.ink} strokeWidth={2} />
        </g>
        <Hotspot cx={186} cy={295} r={92} onClick={() => onLocusClick('oven')} highlighted={highlightLocusId === 'oven'} label="Oven" />
      </g>

      {/* ============ LOCUS: fridge ============ */}
      <g>
        {/* fridge box + interior */}
        <rect x={530} y={120} width={170} height={246} rx={8} fill={P.wallShade} stroke={P.ink} strokeWidth={4} />
        <rect x={540} y={130} width={150} height={226} fill={P.cream} />
        {/* shelves with food */}
        <g stroke={P.duskLight} strokeWidth={3}>
          <line x1={540} y1={195} x2={690} y2={195} />
          <line x1={540} y1={260} x2={690} y2={260} />
          <line x1={540} y1={325} x2={690} y2={325} />
        </g>
        <circle cx={560} cy={183} r={11} fill={P.sage} />
        <rect x={580} y={168} width={18} height={27} rx={3} fill={P.amberLight} />
        <rect x={652} y={310} width={30} height={15} rx={3} fill={P.brick} />
        {/* clue on the middle shelf */}
        <ClueSlot id="fridge" x={548} y={200} width={134} height={122}>
          {clues['fridge']}
        </ClueSlot>
        {/* door: hinges on the right edge, swings open toward the viewer */}
        <g style={occluderStyle(fridgeOpen, 'scaleX(0.13)', 'right center')}>
          <rect x={534} y={124} width={162} height={238} rx={8} fill={P.sage} stroke={P.ink} strokeWidth={4} />
          <rect x={548} y={150} width={10} height={70} rx={5} fill={P.cream} stroke={P.ink} strokeWidth={2} />
          <line x1={534} y1={250} x2={696} y2={250} stroke={P.sageDark} strokeWidth={3} />
        </g>
        <Hotspot cx={615} cy={243} r={100} onClick={() => onLocusClick('fridge')} highlighted={highlightLocusId === 'fridge'} label="Fridge" />
      </g>
    </g>
  )
}
