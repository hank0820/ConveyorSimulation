import type { FC, ReactNode } from 'react'
import type { ConveyorSegmentConfig, SimulationStateWithProgress, Tray, ZonedConveyorId } from '../simulation/types'

interface Props { segments: ConveyorSegmentConfig[]; trays: Tray[]; state: SimulationStateWithProgress }
type Orientation = 'horizontal' | 'vertical'
type Region = 'MDR' | 'MDR_UPSTREAM' | 'BELT' | 'MDR_DOWNSTREAM'
interface LayoutRect { x: number; y: number; w: number; h: number; conveyorId: string; region: Region; orientation: Orientation; zoneIndex?: number; reverse?: boolean }

const VIEWBOX = { width: 1600, height: 850 }
const ZONE_THICKNESS = 24
const COLORS = {
  canvas: '#f8fafb', grid: '#e6ebef', conveyor: '#dce2e6', conveyorEdge: '#647581', belt: '#a8bcc8', beltEdge: '#435f70', text: '#22333e', muted: '#627480', connector: '#526a78',
  empty: '#2b78a0', full: '#e57b25', held: '#9b51a8', purge: '#f4c542', A2: '#b74747', B2: '#7254a5', C2: '#34815c',
}

const ZONED_SPECS: Array<{ id: ZonedConveyorId; count: number; x: number; y: number; length: number; orientation: Orientation; reverse?: boolean; label: string }> = [
  { id: 'PRE_T', count: 8, x: 450, y: 90, length: 160, orientation: 'horizontal', label: 'PRE_T · 8 zones' },
  { id: 'T', count: 12, x: 650, y: 90, length: 180, orientation: 'horizontal', label: 'T · 12 zones' },
  { id: 'D', count: 94, x: 850, y: 90, length: 650, orientation: 'horizontal', label: 'D · 94 zones' },
  { id: 'PURGE', count: 6, x: 806, y: 170, length: 150, orientation: 'vertical', label: 'PURGE · 6 zones' },
  { id: 'E', count: 35, x: 850, y: 330, length: 610, orientation: 'horizontal', reverse: true, label: 'E · 35 zones' },
  { id: 'X', count: 5, x: 794, y: 370, length: 120, orientation: 'vertical', label: 'X · 5 zones' },
  { id: 'S', count: 8, x: 488, y: 540, length: 74, orientation: 'horizontal', reverse: true, label: 'S · 8 zones' },
  { id: 'A2', count: 36, x: 288, y: 590, length: 205, orientation: 'vertical', label: 'A2 · 36 zones' },
  { id: 'B2', count: 29, x: 418, y: 590, length: 205, orientation: 'vertical', label: 'B2 · 29 zones' },
  { id: 'C2', count: 29, x: 608, y: 590, length: 205, orientation: 'vertical', label: 'C2 · 29 zones' },
]

const PILES = [
  { id: 'A1', x: 300, upstream: 8, beltFt: 23.5, beltHeight: 70, downstream: 15, label: 'A1 · 24' },
  { id: 'B1', x: 430, upstream: 8, beltFt: 43.5, beltHeight: 120, downstream: 7, label: 'B1 · 16' },
  { id: 'C1', x: 620, upstream: 8, beltFt: 43.5, beltHeight: 120, downstream: 7, label: 'C1 · 16' },
] as const

const Connector = ({ id, from, to, d }: { id: string; from: string; to: string; d: string }) => (
  <path data-connector-id={id} data-flow-from={from} data-flow-to={to} d={d} fill="none" stroke={COLORS.connector} strokeWidth={3} strokeLinejoin="round" markerEnd="url(#flow-arrow)" />
)

const Equipment = ({ id, x, y, width, children }: { id: string; x: number; y: number; width: number; children: ReactNode }) => (
  <g data-equipment-id={id} data-bounds-x={x} data-bounds-y={y} data-bounds-width={width} data-bounds-height={34}>
    <rect x={x} y={y} width={width} height={34} rx={4} fill="#e6edf2" stroke="#5d7280" strokeWidth={2} />
    <text x={x + width / 2} y={y + 21} textAnchor="middle" fontSize={11} fontWeight={700} fill={COLORS.text}>{children}</text>
  </g>
)

const ConveyorDiagram: FC<Props> = ({ segments, trays, state }) => {
  const layouts = new Map<string, LayoutRect>()

  for (const spec of ZONED_SPECS) {
    if (!segments.some((segment) => segment.id === spec.id)) continue
    const zoneLength = spec.length / spec.count
    for (let index = 0; index < spec.count; index++) {
      const visualIndex = spec.reverse ? spec.count - 1 - index : index
      const rect: LayoutRect = spec.orientation === 'horizontal'
        ? { x: spec.x + visualIndex * zoneLength, y: spec.y - ZONE_THICKNESS / 2, w: zoneLength, h: ZONE_THICKNESS, conveyorId: spec.id, region: 'MDR', orientation: spec.orientation, zoneIndex: index, reverse: spec.reverse }
        : { x: spec.x - ZONE_THICKNESS / 2, y: spec.y + visualIndex * zoneLength, w: ZONE_THICKNESS, h: zoneLength, conveyorId: spec.id, region: 'MDR', orientation: spec.orientation, zoneIndex: index, reverse: spec.reverse }
      layouts.set(`${spec.id}:MDR:${index}`, rect)
    }
  }

  for (const pile of PILES) {
    const bottom = 500
    const upstreamZoneHeight = 10
    const downstreamZoneHeight = 8
    for (let index = 0; index < pile.upstream; index++) {
      layouts.set(`${pile.id}:MDR_UPSTREAM:${index}`, { x: pile.x - ZONE_THICKNESS / 2, y: bottom - (index + 1) * upstreamZoneHeight, w: ZONE_THICKNESS, h: upstreamZoneHeight, conveyorId: pile.id, region: 'MDR_UPSTREAM', orientation: 'vertical', zoneIndex: index })
    }
    const beltBottom = bottom - pile.upstream * upstreamZoneHeight
    layouts.set(`${pile.id}:BELT`, { x: pile.x - ZONE_THICKNESS / 2, y: beltBottom - pile.beltHeight, w: ZONE_THICKNESS, h: pile.beltHeight, conveyorId: pile.id, region: 'BELT', orientation: 'vertical' })
    const downstreamBottom = beltBottom - pile.beltHeight
    for (let index = 0; index < pile.downstream; index++) {
      layouts.set(`${pile.id}:MDR_DOWNSTREAM:${index}`, { x: pile.x - ZONE_THICKNESS / 2, y: downstreamBottom - (index + 1) * downstreamZoneHeight, w: ZONE_THICKNESS, h: downstreamZoneHeight, conveyorId: pile.id, region: 'MDR_DOWNSTREAM', orientation: 'vertical', zoneIndex: index })
    }
  }

  const trayPositions = trays.map((tray) => {
    if (tray.korberHeld) return { tray, x: 1540, y: 140, width: 18, orientation: 'horizontal' as Orientation, segment: 'KORBER' }
    let layout: LayoutRect | undefined
    if (tray.zonePlacement) layout = layouts.get(`${tray.zonePlacement.conveyorId}:MDR:${tray.zonePlacement.zoneIndex}`)
    else if (tray.pilePlacement?.component === 'BELT') layout = layouts.get(`${tray.pilePlacement.pileId}:BELT`)
    else if (tray.pilePlacement) layout = layouts.get(`${tray.pilePlacement.pileId}:${tray.pilePlacement.component}:${tray.pilePlacement.zoneIndex ?? 0}`)
    if (!layout) return { tray, x: 28, y: 810, width: 12, orientation: 'horizontal' as Orientation, segment: tray.currentSegmentId }
    if (tray.pilePlacement?.component === 'BELT') {
      const pile = PILES.find(({ id }) => id === tray.pilePlacement?.pileId)!
      const progress = Math.max(0, Math.min(1, (tray.pilePlacement.beltPosFt ?? 0) / pile.beltFt))
      return { tray, x: layout.x + layout.w / 2, y: layout.y + layout.h - progress * layout.h, width: layout.w, orientation: layout.orientation, segment: pile.id }
    }
    return { tray, x: layout.x + layout.w / 2, y: layout.y + layout.h / 2, width: layout.orientation === 'horizontal' ? layout.w : layout.h, orientation: layout.orientation, segment: layout.conveyorId, zoneIndex: layout.zoneIndex }
  })

  const sectionLabels = [
    ...ZONED_SPECS.filter((spec) => segments.some((segment) => segment.id === spec.id)).map((spec) => ({ id: spec.id, text: spec.label, x: spec.orientation === 'horizontal' ? spec.x + spec.length / 2 : spec.x + 22, y: spec.orientation === 'horizontal' ? spec.y - 24 : spec.y + spec.length / 2, anchor: spec.orientation === 'horizontal' ? 'middle' : 'start', rotate: spec.orientation === 'vertical' })),
    ...PILES.map((pile) => ({ id: pile.id, text: pile.label, x: pile.x - 25, y: 350, anchor: 'middle', rotate: true })),
  ]

  return (
    <svg className="conveyor-diagram" data-return-enabled={state.returnSystem.enabled} viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Complete outbound and return conveyor network">
      <title>Milestone 8 conveyor network with outbound accumulation and downstream return loop</title>
      <defs>
        <pattern id="schematic-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" fill="none" stroke={COLORS.grid} strokeWidth="1" /></pattern>
        <marker id="flow-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L8,4 L0,8 z" fill={COLORS.connector} /></marker>
      </defs>
      <rect width={VIEWBOX.width} height={VIEWBOX.height} fill={COLORS.canvas} />
      <rect width={VIEWBOX.width} height={VIEWBOX.height} fill="url(#schematic-grid)" opacity={0.7} />

      <g aria-label="Implemented routing connectors">
        <Connector id="A1-to-PRE_T" from="A1" to="PRE_T" d="M300 218 L300 160 L430 160 L430 90 L450 90" />
        <Connector id="B1-to-PRE_T" from="B1" to="PRE_T" d="M430 232 L430 90 L450 90" />
        <Connector id="PRE_T-to-T" from="PRE_T" to="T" d="M610 90 L650 90" />
        <Connector id="C1-to-T" from="C1" to="T" d="M620 232 L620 150 L640 150 L640 90 L650 90" />
        <Connector id="T-to-D" from="T" to="D" d="M830 90 L850 90" />
        <Connector id="T-to-PURGE" from="T" to="PURGE" d="M820 102 L820 150 L806 150 L806 170" />
        <Connector id="D-to-KORBER" from="D" to="KORBER" d="M1500 90 L1520 90" />
        <Connector id="KORBER-to-E" from="KORBER" to="E" d="M1550 112 L1550 330 L1460 330" />
        <Connector id="E-to-X" from="E" to="X" d="M850 330 L806 330 L806 370" />
        <Connector id="PURGE-to-X" from="PURGE" to="X" d="M806 320 L806 370" />
        <Connector id="X-to-C2" from="X" to="C2" d="M806 490 L806 520 L620 520 L620 590" />
        <Connector id="X-to-S" from="X" to="S" d="M794 490 L794 500 L562 500 L562 540" />
        <Connector id="S-to-A2" from="S" to="A2" d="M488 540 L300 540 L300 590" />
        <Connector id="S-to-B2" from="S" to="B2" d="M488 540 L430 540 L430 590" />
        <Connector id="A2-to-A-exchanger" from="A2" to="A_EXCHANGER" d="M300 795 L300 810" />
        <Connector id="B2-to-B-exchanger" from="B2" to="B_EXCHANGER" d="M430 795 L430 810" />
        <Connector id="C2-to-C-exchanger" from="C2" to="C_EXCHANGER" d="M620 795 L620 810" />
      </g>

      <g aria-label="Conveyor zones" data-conveyor-bounds="S" data-bounds-x="480" data-bounds-y="504" data-bounds-width="90" data-bounds-height="48">
        {Array.from(layouts.entries()).map(([key, layout]) => {
          const zoneId = layout.zoneIndex === undefined ? undefined : key
          const fill = layout.region === 'BELT' ? COLORS.belt : layout.region === 'MDR' ? COLORS.conveyor : '#d2dde2'
          return <g key={key} data-zone-id={zoneId} data-conveyor-id={layout.conveyorId} data-region={layout.region} data-zone-index={layout.zoneIndex}>
            <rect x={layout.x} y={layout.y} width={layout.w} height={layout.h} fill={fill} stroke={layout.region === 'BELT' ? COLORS.beltEdge : COLORS.conveyorEdge} strokeWidth={layout.region === 'BELT' ? 2 : 1} />
          </g>
        })}
      </g>

      <g aria-label="Section labels">
        {sectionLabels.map((label) => <text key={label.id} data-section-label={label.id} x={label.x} y={label.y} textAnchor={label.anchor as 'middle' | 'start'} transform={label.rotate ? `rotate(-90 ${label.x} ${label.y})` : undefined} fill={COLORS.text} fontSize={12} fontWeight={700}>{label.text}</text>)}
        <text x={805} y={516} textAnchor="middle" fill={COLORS.text} fontSize={11} fontWeight={700}>RETURN SORTER</text>
        <text x={1518} y={57} fill={COLORS.text} fontSize={10}>FLOW →</text>
      </g>

      <Equipment id="KORBER" x={1520} y={73} width={70}>KÖRBER</Equipment>
      <Equipment id="A_EXCHANGER" x={250} y={810} width={100}>A EXCHANGER</Equipment>
      <Equipment id="B_EXCHANGER" x={380} y={810} width={100}>B EXCHANGER</Equipment>
      <Equipment id="C_EXCHANGER" x={570} y={810} width={100}>C EXCHANGER</Equipment>

      <g aria-label="Junctions">
        {[[430, 90, 'AB-merge'], [640, 90, 'T-merge'], [820, 90, 'T-diverter'], [806, 330, 'return-merge'], [806, 520, 'return-sorter'], [480, 540, 'S-diverter']].map(([x, y, id]) => <rect key={String(id)} data-junction-id={id} x={Number(x) - 5} y={Number(y) - 5} width={10} height={10} transform={`rotate(45 ${x} ${y})`} fill="#f8fafb" stroke={COLORS.connector} strokeWidth={2} />)}
      </g>

      <g aria-label="Trays">
        {trayPositions.map(({ tray, x, y, width, orientation, segment, zoneIndex }) => {
          const accent = tray.returnDestination ? COLORS[tray.returnDestination] : COLORS.text
          const fill = tray.korberHeld ? COLORS.held : tray.loadState === 'FULL' ? COLORS.full : COLORS.empty
          const label = String(tray.id).slice(-3)
          const showLabel = width >= 12 && segment !== 'D'
          return <g key={tray.id} data-tray-id={tray.id} data-segment-id={segment} data-zone-index={zoneIndex} data-load-state={tray.loadState ?? 'EMPTY'} data-return-destination={tray.returnDestination} data-purge-member={tray.purgeMember || undefined}>
            <title>{`Tray ${tray.id} · ${tray.loadState ?? 'EMPTY'}${tray.returnDestination ? ` · ${tray.returnDestination}` : ''}${tray.purgeMember ? ' · PURGE MEMBER' : ''}${tray.korberHeld ? ' · HELD AT KÖRBER' : ''}`}</title>
            {orientation === 'vertical'
              ? <rect x={x - 7} y={y - 5} width={14} height={10} rx={2} fill={fill} stroke={tray.purgeMember ? COLORS.purge : accent} strokeWidth={tray.purgeMember ? 3 : tray.returnDestination ? 2 : 1} />
              : <rect x={x - 6} y={y - 7} width={12} height={14} rx={2} fill={fill} stroke={tray.purgeMember ? COLORS.purge : accent} strokeWidth={tray.purgeMember ? 3 : tray.returnDestination ? 2 : 1} />}
            {showLabel && <text x={x} y={y + 3} textAnchor="middle" fill="white" fontSize={7} fontWeight={700}>{label}</text>}
          </g>
        })}
      </g>

      <g data-legend="tray-and-conveyor-states" transform="translate(930 760)">
        <rect x={0} y={0} width={610} height={70} rx={5} fill="rgba(255,255,255,.92)" stroke="#aab7c0" />
        {[['EMPTY', COLORS.empty, 18], ['FULL', COLORS.full, 105], ['PURGE MEMBER', COLORS.empty, 180], ['KÖRBER HOLD', COLORS.held, 315]].map(([label, color, x], index) => <g key={String(label)} transform={`translate(${x} 20)`}><rect width={14} height={14} rx={2} fill={String(color)} stroke={index === 2 ? COLORS.purge : COLORS.text} strokeWidth={index === 2 ? 3 : 1} /><text x={20} y={11} fontSize={10} fill={COLORS.text}>{label}</text></g>)}
        <g transform="translate(445 20)"><rect width={22} height={14} fill={COLORS.conveyor} stroke={COLORS.conveyorEdge} /><text x={28} y={11} fontSize={10} fill={COLORS.text}>MDR</text></g>
        <g transform="translate(520 20)"><rect width={22} height={14} fill={COLORS.belt} stroke={COLORS.beltEdge} strokeWidth={2} /><text x={28} y={11} fontSize={10} fill={COLORS.text}>BELT</text></g>
        <text x={18} y={55} fontSize={9} fill={COLORS.muted}>Destination accents: <tspan fill={COLORS.A2}>A2</tspan> · <tspan fill={COLORS.B2}>B2</tspan> · <tspan fill={COLORS.C2}>C2</tspan></text>
      </g>
    </svg>
  )
}

export default ConveyorDiagram
