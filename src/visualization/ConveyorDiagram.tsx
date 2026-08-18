import type { FC, ReactNode } from 'react'
import type {
  CartbuildLaneId,
  ConveyorSegmentConfig,
  InboundRobotSnapshot,
  OutboundRobotSnapshot,
  SimulationStateWithProgress,
  SourceId,
  Tray,
  TrayLoadState,
  ZonedConveyorId,
} from '../simulation/types'

interface Props { segments: ConveyorSegmentConfig[]; trays: Tray[]; state: SimulationStateWithProgress }
type Orientation = 'horizontal' | 'vertical'
type Region = 'MDR' | 'MDR_UPSTREAM' | 'BELT' | 'MDR_DOWNSTREAM'
interface LayoutRect { x: number; y: number; w: number; h: number; conveyorId: string; region: Region; orientation: Orientation; zoneIndex?: number; reverse?: boolean }

const VIEWBOX = { width: 1600, height: 1040 }
const ZONE_THICKNESS = 24
const COLORS = {
  canvas: '#f8fafb', grid: '#e6ebef', conveyor: '#dce2e6', conveyorEdge: '#647581', belt: '#a8bcc8', beltEdge: '#435f70', text: '#22333e', muted: '#627480', connector: '#526a78',
  empty: '#2b78a0', full: '#e57b25', held: '#9b51a8', purge: '#f4c542', A2: '#b74747', B2: '#7254a5', C2: '#34815c',
  robot: '#52616b', inboundRobot: '#7b8790', blockedRobot: '#bd2c2c', rack: '#d7dee3', rackEdge: '#526a78',
}

const ASRS_PATHS: Record<SourceId, { centerX: number; dropX: number; takeX: number }> = {
  A: { centerX: 300, dropX: 280, takeX: 320 },
  B: { centerX: 430, dropX: 410, takeX: 450 },
  C: { centerX: 620, dropX: 600, takeX: 640 },
}
const ASRS_DROP_Y = 872
const ASRS_RACK_Y = 1008
const ASRS_QUEUE_START_Y = 900
const ASRS_VISIBLE_QUEUE_SIZE = 4
const ASRS_QUEUE_SLOT_SPACING = 24

type VisualRobot = {
  robotId: number
  missionId: number
  exchanger: SourceId
  kind: 'OUTBOUND' | 'INBOUND_ONLY'
  state: string
  missionType: 'CARTBUILD' | 'EMPTY' | 'INBOUND_ONLY'
  travelProgress: number
  returnProgress: number
  queuePosition: number | null
  blocked: boolean
  cycleType: 'OUTBOUND_ONLY' | 'INBOUND_ONLY' | 'DUAL_CYCLE' | 'CANCELLED_INBOUND_ONLY' | null
  outboundTrayId: number | null
  inboundTrayId: number | null
  payloadState: TrayLoadState | null
  payloadHasCarton: boolean
  carryingPayload: boolean
}

const clampProgress = (value: number) => Math.max(0, Math.min(1, value))

const activeVisualRobots = (state: SimulationStateWithProgress): VisualRobot[] => {
  const outbound = state.asrsRobotSystem.outboundRobots
    .filter((robot) => robot.lifecycleState !== 'OUTBOUND_COMPLETE')
    .map((robot: OutboundRobotSnapshot): VisualRobot => {
      const returning = robot.lifecycleState === 'RETURNING_TO_RACK'
      const carryingOutbound = robot.ownsPayload
      const carryingInbound = returning && robot.inboundTrayId !== null
      return {
        robotId: robot.robotId,
        missionId: robot.missionId,
        exchanger: robot.assignedExchanger,
        kind: 'OUTBOUND',
        state: robot.lifecycleState,
        missionType: robot.missionType,
        travelProgress: robot.travelProgress,
        returnProgress: robot.returnProgress,
        queuePosition: robot.queuePosition,
        blocked: robot.blockedReason !== null || robot.lifecycleState === 'BLOCKED_FROM_DROP',
        cycleType: returning ? (robot.inboundTrayId === null ? 'OUTBOUND_ONLY' : 'DUAL_CYCLE') : null,
        outboundTrayId: robot.payloadTrayId,
        inboundTrayId: carryingInbound ? robot.inboundTrayId : null,
        payloadState: carryingOutbound ? robot.payloadLoadState : carryingInbound ? robot.inboundTrayLoadState : null,
        payloadHasCarton: (carryingOutbound && robot.cartbuildCartonAttached) || (carryingInbound && robot.inboundTrayLoadState === 'FULL'),
        carryingPayload: carryingOutbound || carryingInbound,
      }
    })
  const inbound = state.asrsRobotSystem.inboundOnlyRobots
    .filter((robot) => robot.lifecycleState !== 'INBOUND_COMPLETE' && robot.lifecycleState !== 'CANCELLED')
    .map((robot: InboundRobotSnapshot): VisualRobot => ({
      robotId: robot.robotId,
      missionId: robot.missionId,
      exchanger: robot.assignedExchanger,
      kind: 'INBOUND_ONLY',
      state: robot.lifecycleState,
      missionType: 'INBOUND_ONLY',
      travelProgress: robot.travelProgress,
      returnProgress: robot.returnProgress,
      queuePosition: robot.queuePosition,
      blocked: false,
      cycleType: robot.cancelledAfterAdmission ? 'CANCELLED_INBOUND_ONLY' : 'INBOUND_ONLY',
      outboundTrayId: null,
      inboundTrayId: robot.ownsInboundTray ? robot.inboundTrayId : null,
      payloadState: robot.ownsInboundTray ? robot.inboundTrayLoadState : null,
      payloadHasCarton: robot.ownsInboundTray && robot.inboundTrayLoadState === 'FULL',
      carryingPayload: robot.ownsInboundTray,
    }))
  return [...outbound, ...inbound]
}

const isOperationalRobot = (robot: VisualRobot, state: SimulationStateWithProgress) => {
  const exchanger = state.asrsRobotSystem.exchangers[robot.exchanger]
  return robot.state === 'RETURNING_TO_RACK'
    || robot.state === 'SHIFTING_TO_TAKE'
    || exchanger.shiftingOrTakeRobotId === robot.robotId
    || robot.state === 'AT_DROP'
    || robot.state === 'BLOCKED_FROM_DROP'
    || exchanger.dropRobotId === robot.robotId
}

const isIndividuallyRendered = (robot: VisualRobot, state: SimulationStateWithProgress) => isOperationalRobot(robot, state)
  || (robot.queuePosition !== null && robot.queuePosition >= 1 && robot.queuePosition <= ASRS_VISIBLE_QUEUE_SIZE)

const robotPosition = (robot: VisualRobot, state: SimulationStateWithProgress) => {
  const path = ASRS_PATHS[robot.exchanger]
  const exchanger = state.asrsRobotSystem.exchangers[robot.exchanger]
  if (robot.state === 'RETURNING_TO_RACK') {
    const progress = clampProgress(robot.returnProgress)
    return { x: path.takeX, y: ASRS_DROP_Y + (ASRS_RACK_Y - ASRS_DROP_Y) * progress, position: progress === 0 ? 'TAKE' : 'RETURN', progress }
  }
  if (robot.state === 'SHIFTING_TO_TAKE' || exchanger.shiftingOrTakeRobotId === robot.robotId) {
    const progress = clampProgress(state.timeSec - (exchanger.lastSuccessfulDropTime ?? state.timeSec))
    return { x: path.dropX + (path.takeX - path.dropX) * progress, y: ASRS_DROP_Y, position: progress >= 1 ? 'TAKE' : 'SHIFT', progress }
  }
  if (robot.state === 'AT_DROP' || robot.state === 'BLOCKED_FROM_DROP' || exchanger.dropRobotId === robot.robotId) {
    return { x: path.dropX, y: ASRS_DROP_Y, position: 'DROP', progress: 1 }
  }
  if (robot.queuePosition !== null || robot.state === 'QUEUED_FOR_DROP' || robot.state === 'HEAD_OF_DROP_QUEUE') {
    const queuePosition = Math.max(1, robot.queuePosition ?? 1)
    const restingY = ASRS_QUEUE_START_Y + (queuePosition - 1) * ASRS_QUEUE_SLOT_SPACING
    const advancementProgress = exchanger.queueAdvancementState === 'ADVANCING' ? clampProgress(exchanger.queueAdvanceProgress) : 1
    return {
      x: path.dropX,
      y: restingY + ASRS_QUEUE_SLOT_SPACING * (1 - advancementProgress),
      position: 'QUEUE',
      progress: advancementProgress,
    }
  }
  const progress = clampProgress(robot.travelProgress)
  return {
    x: path.dropX,
    y: ASRS_RACK_Y + (ASRS_DROP_Y - ASRS_RACK_Y) * progress,
    position: 'OUTBOUND_TRAVEL',
    progress,
  }
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

const CARTBUILD_SPECS: Array<{ id: CartbuildLaneId; source: 'A' | 'B' | 'C'; x: number; y: number; length: number; label: string }> = [
  { id: 'CARTBUILD_A', source: 'A', x: 335, y: 235, length: 225, label: 'CARTBUILD A · 30 zones' },
  { id: 'CARTBUILD_B', source: 'B', x: 465, y: 235, length: 225, label: 'CARTBUILD B · 30 zones' },
  { id: 'CARTBUILD_C', source: 'C', x: 655, y: 235, length: 225, label: 'CARTBUILD C · 30 zones' },
]

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
  const cartonLayouts = new Map<string, LayoutRect>()

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

  for (const spec of CARTBUILD_SPECS) {
    if (!segments.some((segment) => segment.id === spec.id)) continue
    const zoneLength = spec.length / 30
    for (let index = 0; index < 30; index++) {
      const visualIndex = 29 - index
      cartonLayouts.set(`${spec.id}:MDR:${index}`, { x: spec.x - 8, y: spec.y + visualIndex * zoneLength, w: 16, h: zoneLength, conveyorId: spec.id, region: 'MDR', orientation: 'vertical', zoneIndex: index, reverse: true })
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
  const visualRobots = activeVisualRobots(state)
  const individualRobots = visualRobots.filter((robot) => isIndividuallyRendered(robot, state))
  const aggregateRobots = Object.fromEntries((['A', 'B', 'C'] as SourceId[]).map((source) => [
    source,
    visualRobots
      .filter((robot) => robot.exchanger === source && !isIndividuallyRendered(robot, state))
      .sort((left, right) => left.robotId - right.robotId),
  ])) as Record<SourceId, VisualRobot[]>

  return (
    <svg className="conveyor-diagram" data-return-enabled={state.returnSystem.enabled} viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Complete conveyor and ASRS robot network">
      <title>Full conveyor network with ASRS outbound, dual-cycle, and inbound-only robots</title>
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
        {state.cartbuildSystem.enabled && <>
          <Connector id="DETRAYER-A-to-CARTBUILD-A" from="DETRAYER_A" to="CARTBUILD_A" d="M312 470 L335 470 L335 460" />
          <Connector id="DETRAYER-B-to-CARTBUILD-B" from="DETRAYER_B" to="CARTBUILD_B" d="M442 470 L465 470 L465 460" />
          <Connector id="DETRAYER-C-to-CARTBUILD-C" from="DETRAYER_C" to="CARTBUILD_C" d="M632 470 L655 470 L655 460" />
          <Connector id="CARTBUILD-A-to-OPERATOR-A" from="CARTBUILD_A" to="OPERATOR_A" d="M335 235 L335 214" />
          <Connector id="CARTBUILD-B-to-OPERATOR-B" from="CARTBUILD_B" to="OPERATOR_B" d="M465 235 L465 214" />
          <Connector id="CARTBUILD-C-to-OPERATOR-C" from="CARTBUILD_C" to="OPERATOR_C" d="M655 235 L655 214" />
        </>}
      </g>

      {state.cartbuildSystem.enabled && <g aria-label="ASRS rack and exchanger robot paths" data-asrs-system="true">
        <rect data-asrs-rack-id="ASRS_RACK" x={210} y={984} width={510} height={48} rx={6} fill={COLORS.rack} stroke={COLORS.rackEdge} strokeWidth={2} />
        <text x={708} y={1008} textAnchor="middle" transform="rotate(-90 708 1008)" fontSize={7} fontWeight={700} fill={COLORS.text}>SHARED ASRS RACK</text>
        {(Object.keys(ASRS_PATHS) as SourceId[]).map((source) => {
          const path = ASRS_PATHS[source]
          return <g key={source} data-asrs-path-id={`ASRS_PATH_${source}`} data-exchanger-id={source}>
            <path data-asrs-connector-id={`${source}_EXCHANGER_TO_DROP`} d={`M${path.centerX} 844 L${path.centerX} 855 L${path.dropX} 855 L${path.dropX} ${ASRS_DROP_Y}`} fill="none" stroke={COLORS.connector} strokeWidth={2} />
            <path data-asrs-connector-id={`${source}_EXCHANGER_TO_TAKE`} d={`M${path.centerX} 844 L${path.centerX} 855 L${path.takeX} 855 L${path.takeX} ${ASRS_DROP_Y}`} fill="none" stroke={COLORS.connector} strokeWidth={2} />
            <path data-asrs-direction="OUTBOUND" d={`M${path.dropX} 984 L${path.dropX} ${ASRS_DROP_Y}`} fill="none" stroke={COLORS.connector} strokeWidth={2} markerEnd="url(#flow-arrow)" />
            <path data-asrs-direction="RETURN" d={`M${path.takeX} ${ASRS_DROP_Y} L${path.takeX} 984`} fill="none" stroke={COLORS.connector} strokeWidth={2} markerEnd="url(#flow-arrow)" />
            <line x1={path.dropX} y1={ASRS_DROP_Y} x2={path.takeX} y2={ASRS_DROP_Y} stroke={COLORS.connector} strokeWidth={2} markerEnd="url(#flow-arrow)" />
            <circle data-asrs-position-id={`${source}_DROP`} cx={path.dropX} cy={ASRS_DROP_Y} r={7} fill="#fff" stroke={COLORS.connector} strokeWidth={2} />
            <circle data-asrs-position-id={`${source}_TAKE`} cx={path.takeX} cy={ASRS_DROP_Y} r={7} fill="#fff" stroke={COLORS.connector} strokeWidth={2} />
            <text data-asrs-label-id={`${source}_DROP_LABEL`} x={path.dropX - 8} y={ASRS_DROP_Y - 13} textAnchor="end" fontSize={8} fontWeight={700} fill={COLORS.text}>{`${source} DROP`}</text>
            <text data-asrs-label-id={`${source}_TAKE_LABEL`} x={path.takeX + 8} y={ASRS_DROP_Y - 13} textAnchor="start" fontSize={8} fontWeight={700} fill={COLORS.text}>{`${source} TAKE`}</text>
          </g>
        })}
        {(Object.keys(ASRS_PATHS) as SourceId[]).map((source) => {
          const robots = aggregateRobots[source]
          const cartbuildCount = robots.filter((robot) => robot.missionType === 'CARTBUILD').length
          const emptyCount = robots.filter((robot) => robot.missionType === 'EMPTY').length
          const inboundOnlyCount = robots.filter((robot) => robot.missionType === 'INBOUND_ONLY').length
          const maturedOverflowCount = robots.filter((robot) => robot.queuePosition !== null && robot.queuePosition > ASRS_VISIBLE_QUEUE_SIZE).length
          const containedRobotIds = robots.map((robot) => robot.robotId)
          const tooltip = robots.length === 0
            ? 'No robots in transit'
            : robots.map((robot) => `R${robot.robotId}/M${robot.missionId} ${robot.state}${robot.queuePosition === null ? '' : ` Q${robot.queuePosition}`} ${robot.payloadState ?? 'NO PAYLOAD'}`).join(' · ')
          const x = ASRS_PATHS[source].centerX - 55
          return <g
            key={`ASRS_TRANSIT_${source}`}
            data-asrs-transit-exchanger={source}
            data-aggregate-robot-count={robots.length}
            data-cartbuild-count={cartbuildCount}
            data-empty-count={emptyCount}
            data-inbound-only-count={inboundOnlyCount}
            data-matured-overflow-count={maturedOverflowCount}
            data-contained-robot-ids={containedRobotIds.join(',')}
          >
            <title>{`ASRS Transit ${source} · ${tooltip}`}</title>
            <rect x={x} y={989} width={110} height={38} rx={4} fill="rgba(255,255,255,.9)" stroke={COLORS.rackEdge} strokeWidth={1.5} />
            <text x={x + 55} y={997} textAnchor="middle" fontSize={6.5} fontWeight={700} fill={COLORS.text}>{`ASRS TRANSIT ${source}`}</text>
            <text x={x + 55} y={1006} textAnchor="middle" fontSize={6.5} fill={COLORS.text}>{`Total: ${robots.length}`}</text>
            <text x={x + 55} y={1015} textAnchor="middle" fontSize={6.5} fill={COLORS.text}>{`CB ${cartbuildCount} | E ${emptyCount} | IN ${inboundOnlyCount}`}</text>
            <text x={x + 55} y={1024} textAnchor="middle" fontSize={6.5} fill={COLORS.text}>{`Queue overflow: ${maturedOverflowCount}`}</text>
          </g>
        })}
      </g>}

      <g aria-label="Conveyor zones" data-conveyor-bounds="S" data-bounds-x="480" data-bounds-y="504" data-bounds-width="90" data-bounds-height="48">
        {Array.from(layouts.entries()).map(([key, layout]) => {
          const zoneId = layout.zoneIndex === undefined ? undefined : key
          const fill = layout.region === 'BELT' ? COLORS.belt : layout.region === 'MDR' ? COLORS.conveyor : '#d2dde2'
          return <g key={key} data-zone-id={zoneId} data-conveyor-id={layout.conveyorId} data-region={layout.region} data-zone-index={layout.zoneIndex}>
            <rect x={layout.x} y={layout.y} width={layout.w} height={layout.h} fill={fill} stroke={layout.region === 'BELT' ? COLORS.beltEdge : COLORS.conveyorEdge} strokeWidth={layout.region === 'BELT' ? 2 : 1} />
          </g>
        })}
        {Array.from(cartonLayouts.entries()).map(([key, layout]) => <g key={key} data-zone-id={key} data-cartbuild-lane={layout.conveyorId} data-conveyor-id={layout.conveyorId} data-region="MDR" data-zone-index={layout.zoneIndex}>
          <rect x={layout.x} y={layout.y} width={layout.w} height={layout.h} fill="#eadfce" stroke="#866d4d" strokeWidth={1} />
        </g>)}
      </g>

      <g aria-label="Section labels">
        {sectionLabels.map((label) => <text key={label.id} data-section-label={label.id} x={label.x} y={label.y} textAnchor={label.anchor as 'middle' | 'start'} transform={label.rotate ? `rotate(-90 ${label.x} ${label.y})` : undefined} fill={COLORS.text} fontSize={12} fontWeight={700}>{label.text}</text>)}
        {CARTBUILD_SPECS.filter((spec) => segments.some((segment) => segment.id === spec.id)).map((spec) => <text key={spec.id} data-section-label={spec.id} x={spec.x + 19} y={spec.y + spec.length / 2} textAnchor="middle" transform={`rotate(-90 ${spec.x + 19} ${spec.y + spec.length / 2})`} fill={COLORS.text} fontSize={9} fontWeight={700}>{spec.label}</text>)}
        <text x={805} y={516} textAnchor="middle" fill={COLORS.text} fontSize={11} fontWeight={700}>RETURN SORTER</text>
        <text x={1518} y={57} fill={COLORS.text} fontSize={10}>FLOW →</text>
      </g>

      <Equipment id="KORBER" x={1520} y={73} width={70}>KÖRBER</Equipment>
      <Equipment id="A_EXCHANGER" x={250} y={810} width={100}>A EXCHANGER</Equipment>
      <Equipment id="B_EXCHANGER" x={380} y={810} width={100}>B EXCHANGER</Equipment>
      <Equipment id="C_EXCHANGER" x={570} y={810} width={100}>C EXCHANGER</Equipment>
      {CARTBUILD_SPECS.filter((spec) => segments.some((segment) => segment.id === spec.id)).map((spec) => <Equipment key={spec.source} id={`OPERATOR_${spec.source}`} x={spec.x - 35} y={180} width={70}>{`OPERATOR ${spec.source}`}</Equipment>)}

      <g aria-label="Junctions">
        {[[430, 90, 'AB-merge'], [640, 90, 'T-merge'], [820, 90, 'T-diverter'], [806, 330, 'return-merge'], [806, 520, 'return-sorter'], [480, 540, 'S-diverter']].map(([x, y, id]) => <rect key={String(id)} data-junction-id={id} x={Number(x) - 5} y={Number(y) - 5} width={10} height={10} transform={`rotate(45 ${x} ${y})`} fill="#f8fafb" stroke={COLORS.connector} strokeWidth={2} />)}
      </g>

      <g aria-label="Cartbuild detrayers">
        {CARTBUILD_SPECS.filter((spec) => segments.some((segment) => segment.id === spec.id)).map((spec) => <g key={spec.source} data-detrayer-id={`DETRAYER_${spec.source}`}>
          <rect x={PILES.find((pile) => pile.id === `${spec.source}1`)!.x - 10} y={465} width={20} height={10} rx={2} fill="#f3c975" stroke="#75551e" strokeWidth={2} />
          <title>{`DETRAYER ${spec.source} between upstream zones 2 and 3`}</title>
          <text x={PILES.find((pile) => pile.id === `${spec.source}1`)!.x - 18} y={470} textAnchor="middle" transform={`rotate(-90 ${PILES.find((pile) => pile.id === `${spec.source}1`)!.x - 18} 470)`} fontSize={7} fontWeight={700} fill={COLORS.text}>{`DETRAYER ${spec.source}`}</text>
        </g>)}
      </g>

      <g aria-label="Trays">
        {trayPositions.map(({ tray, x, y, width, orientation, segment, zoneIndex }) => {
          const accent = tray.returnDestination ? COLORS[tray.returnDestination] : COLORS.text
          const fill = tray.korberHeld ? COLORS.held : tray.loadState === 'FULL' ? COLORS.full : COLORS.empty
          const label = String(tray.id).slice(-3)
          const showLabel = width >= 12 && segment !== 'D'
          return <g key={tray.id} data-tray-id={tray.id} data-segment-id={segment} data-zone-index={zoneIndex} data-load-state={tray.loadState ?? 'EMPTY'} data-payload-origin={tray.payloadOrigin} data-cartbuild-carton-attached={tray.cartbuildCartonAttached || undefined} data-return-destination={tray.returnDestination} data-purge-member={tray.purgeMember || undefined}>
            <title>{`Tray ${tray.id} · ${tray.loadState ?? 'EMPTY'}${tray.returnDestination ? ` · ${tray.returnDestination}` : ''}${tray.purgeMember ? ' · PURGE MEMBER' : ''}${tray.korberHeld ? ' · HELD AT KÖRBER' : ''}`}</title>
            {orientation === 'vertical'
              ? <rect x={x - 7} y={y - 5} width={14} height={10} rx={2} fill={fill} stroke={tray.purgeMember ? COLORS.purge : accent} strokeWidth={tray.purgeMember ? 3 : tray.returnDestination ? 2 : 1} />
              : <rect x={x - 6} y={y - 7} width={12} height={14} rx={2} fill={fill} stroke={tray.purgeMember ? COLORS.purge : accent} strokeWidth={tray.purgeMember ? 3 : tray.returnDestination ? 2 : 1} />}
            {showLabel && <text x={x} y={y + 3} textAnchor="middle" fill="white" fontSize={7} fontWeight={700}>{label}</text>}
            {tray.cartbuildCartonAttached && <rect data-attached-carton="true" x={x - 4} y={y - 11} width={8} height={6} rx={1} fill="#d39a45" stroke="#6e4819" strokeWidth={1} />}
          </g>
        })}
      </g>

      <g aria-label="Anonymous cartbuild cartons">
        {Object.values(state.cartbuildSystem.lanes).flatMap((lane) => lane.markers.map((carton) => {
          const layout = cartonLayouts.get(`${lane.id}:MDR:${carton.zoneIndex}`)
          if (!layout) return null
          return <rect key={`${lane.id}-${carton.internalKey}`} data-carton-marker="true" data-cartbuild-lane={lane.id} data-zone-id={`${lane.id}:MDR:${carton.zoneIndex}`} data-carton-state="ON_CONVEYOR" x={layout.x + 3} y={layout.y + layout.h / 2 - 3} width={10} height={6} rx={1} fill="#d39a45" stroke="#6e4819" strokeWidth={1} />
        }))}
      </g>

      {state.cartbuildSystem.enabled && <g aria-label="Active ASRS robots">
        {individualRobots.map((robot) => {
          const position = robotPosition(robot, state)
          const label = `R${String(robot.robotId).slice(-2)}`
          const bodyFill = robot.kind === 'INBOUND_ONLY' ? COLORS.inboundRobot : COLORS.robot
          return <g
            key={robot.robotId}
            data-robot-id={robot.robotId}
            data-mission-id={robot.missionId}
            data-exchanger-id={robot.exchanger}
            data-robot-kind={robot.kind}
            data-robot-state={robot.state}
            data-cycle-type={robot.cycleType ?? undefined}
            data-queue-position={robot.queuePosition ?? undefined}
            data-blocked={robot.blocked}
            data-outbound-tray-id={robot.outboundTrayId ?? undefined}
            data-inbound-tray-id={robot.inboundTrayId ?? undefined}
            data-payload-state={robot.payloadState ?? 'NONE'}
            data-path-progress={position.progress.toFixed(3)}
            data-asrs-position={position.position}
            data-robot-x={position.x.toFixed(2)}
            data-robot-y={position.y.toFixed(2)}
            transform={`translate(${position.x - 9} ${position.y - 17})`}
          >
            <title>{`Robot ${robot.robotId} · Mission ${robot.missionId} · Exchanger ${robot.exchanger} · ${robot.state}${robot.cycleType === null ? '' : ` · ${robot.cycleType}`}${robot.outboundTrayId === null ? '' : ` · outbound tray ${robot.outboundTrayId}`}${robot.inboundTrayId === null ? '' : ` · inbound tray ${robot.inboundTrayId}`}`}</title>
            <rect data-robot-body="true" x={0} y={11} width={18} height={12} rx={3} fill={bodyFill} stroke={robot.blocked ? COLORS.blockedRobot : '#26343d'} strokeWidth={robot.blocked ? 3 : 1.5} strokeDasharray={robot.blocked ? '3 2' : undefined} />
            <text x={9} y={20} textAnchor="middle" fontSize={6.5} fontWeight={700} fill="white">{label}</text>
            {robot.queuePosition !== null && robot.queuePosition <= ASRS_VISIBLE_QUEUE_SIZE && <text data-queue-slot-label={`Q${robot.queuePosition}`} x={21} y={20} fontSize={6.5} fontWeight={700} fill={COLORS.text}>{`Q${robot.queuePosition}`}</text>}
            {robot.carryingPayload && <>
              <rect data-robot-tray="true" x={2} y={5} width={14} height={6} rx={1} fill={robot.payloadState === 'FULL' ? COLORS.full : COLORS.empty} stroke="#26343d" strokeWidth={1} />
              {robot.payloadHasCarton && <rect data-robot-carton="true" x={5} y={0} width={8} height={5} rx={1} fill="#d39a45" stroke="#6e4819" strokeWidth={1} />}
            </>}
          </g>
        })}
      </g>}

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
