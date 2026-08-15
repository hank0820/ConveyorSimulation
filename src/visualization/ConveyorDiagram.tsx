import type { FC, ReactElement } from 'react'
import type { ConveyorSegmentConfig, Tray, SimulationStateWithProgress, ZonedConveyorId } from '../simulation/types'

type BranchId = 'A' | 'B' | 'C'

interface Props {
  segments: ConveyorSegmentConfig[]
  trays: Tray[]
  state: SimulationStateWithProgress
}

const ConveyorDiagram: FC<Props> = ({ segments, trays, state }) => {
  const width = 1120
  const height = state.returnSystem.enabled ? 520 : 330
  const padding = 20
  const branchStartX = 130
  const exchangerX = 20
  const branchMaxWidth = 260

  const rowYs: Record<BranchId, number> = {
    A: 60,
    B: 140,
    C: 220,
  }

  const missionCounts: Record<BranchId, { retrieving: number; ready: number; pending: number }> = {
    A: {
      retrieving: state.retrievingA,
      ready: state.readyA,
      pending: state.pendingA,
    },
    B: {
      retrieving: state.retrievingB,
      ready: state.readyB,
      pending: state.pendingB,
    },
    C: {
      retrieving: state.retrievingC,
      ready: state.readyC,
      pending: state.pendingC,
    },
  }

  const branchTotals = {
    A: segments
      .filter((s) => s.id === 'A1')
      .reduce((sum, s) => sum + s.lengthFt, 0),
    B: segments
      .filter((s) => s.id === 'B1')
      .reduce((sum, s) => sum + s.lengthFt, 0),
    C: segments
      .filter((s) => s.id === 'C1')
      .reduce((sum, s) => sum + s.lengthFt, 0),
  }

  const branchScales = {
    A: branchTotals.A > 0 ? branchMaxWidth / branchTotals.A : 1,
    B: branchTotals.B > 0 ? branchMaxWidth / branchTotals.B : 1,
    C: branchTotals.C > 0 ? branchMaxWidth / branchTotals.C : 1,
  }

  const segmentLayout = new Map<string, {
    x: number
    y: number
    w: number
    h: number
    lengthFt: number
    pileId?: string
    region?: 'MDR_UPSTREAM' | 'BELT' | 'MDR_DOWNSTREAM' | 'MDR'
    zoneIndex?: number
  }>()

  const rectHeight = 24
  const textOffset = 14

  // draw hybrid pile A1: 8 upstream MDR (2.5ft) + 23.5ft belt + 15 downstream MDR (2.5ft)
  const A1_len = segments.find((s) => s.id === 'A1')?.lengthFt ?? 81
  const A1_up = 8
  const A1_down = 15
  const A1_belt = 23.5

  // draw hybrid pile B1/C1: 8 upstream + 7 downstream + 43.5ft belt
  const B1_len = segments.find((s) => s.id === 'B1')?.lengthFt ?? 81
  const B1_up = 8
  const B1_down = 7
  const B1_belt = 43.5

  const drawMdrBank = (
    startX: number,
    row: 'A' | 'B' | 'C',
    region: 'MDR_UPSTREAM' | 'MDR_DOWNSTREAM',
    count: number,
    zoneLen: number,
    scale: number,
  ) => {
    let x = startX
    const pileId = `${row}1`
    for (let i = 0; i < count; i++) {
      const w = Math.max(6, Math.round(zoneLen * scale))
      const id = `${pileId}:${region}:${i}`
      segmentLayout.set(id, { x, y: rowYs[row], w, h: rectHeight, lengthFt: zoneLen, pileId, region, zoneIndex: i })
      x += w + 2
    }
    return x
  }

  let nextAx = branchStartX
  const scaleA = branchScales.A
  nextAx = drawMdrBank(nextAx, 'A', 'MDR_UPSTREAM', A1_up, 2.5, scaleA)
  // belt
  const beltAx = nextAx
  const beltAw = Math.max(40, Math.round(A1_belt * scaleA))
  segmentLayout.set('A1:BELT', { x: beltAx, y: rowYs.A, w: beltAw, h: rectHeight, lengthFt: A1_belt, pileId: 'A1', region: 'BELT' })
  nextAx = beltAx + beltAw + 6
  nextAx = drawMdrBank(nextAx, 'A', 'MDR_DOWNSTREAM', A1_down, 2.5, scaleA)
  // mark logical segment A1 spanning
  segmentLayout.set('A1', { x: branchStartX, y: rowYs.A, w: nextAx - branchStartX, h: rectHeight, lengthFt: A1_len })

  let nextBx = branchStartX
  const scaleB = branchScales.B
  nextBx = drawMdrBank(nextBx, 'B', 'MDR_UPSTREAM', B1_up, 2.5, scaleB)
  const beltBx = nextBx
  const beltBw = Math.max(40, Math.round(B1_belt * scaleB))
  segmentLayout.set('B1:BELT', { x: beltBx, y: rowYs.B, w: beltBw, h: rectHeight, lengthFt: B1_belt, pileId: 'B1', region: 'BELT' })
  nextBx = beltBx + beltBw + 6
  nextBx = drawMdrBank(nextBx, 'B', 'MDR_DOWNSTREAM', B1_down, 2.5, scaleB)
  segmentLayout.set('B1', { x: branchStartX, y: rowYs.B, w: nextBx - branchStartX, h: rectHeight, lengthFt: B1_len })
  let nextCx = branchStartX
  const scaleC = branchScales.C
  nextCx = drawMdrBank(nextCx, 'C', 'MDR_UPSTREAM', B1_up, 2.5, scaleC)
  const beltCx = nextCx
  const beltCw = Math.max(40, Math.round(B1_belt * scaleC))
  segmentLayout.set('C1:BELT', { x: beltCx, y: rowYs.C, w: beltCw, h: rectHeight, lengthFt: B1_belt, pileId: 'C1', region: 'BELT' })
  nextCx = beltCx + beltCw + 6
  nextCx = drawMdrBank(nextCx, 'C', 'MDR_DOWNSTREAM', B1_down, 2.5, scaleC)
  segmentLayout.set('C1', { x: branchStartX, y: rowYs.C, w: nextCx - branchStartX, h: rectHeight, lengthFt: B1_len })

  const drawZonedConveyor = (id: ZonedConveyorId, x: number, y: number, count: number, totalWidth: number) => {
    const zoneWidth = totalWidth / count
    for (let index = 0; index < count; index++) {
      segmentLayout.set(`${id}:MDR:${index}`, { x: x + index * zoneWidth, y, w: zoneWidth, h: 32, lengthFt: 2.5, pileId: id, region: 'MDR', zoneIndex: index })
    }
    segmentLayout.set(id, { x, y, w: totalWidth, h: 32, lengthFt: count * 2.5 })
  }

  const preTX = 500
  const preTY = 100
  drawZonedConveyor('PRE_T', preTX, preTY, 8, 96)
  const tX = 640
  const tY = rowYs.B
  const tW = 144
  drawZonedConveyor('T', tX, tY, 12, tW)

  const dX = tX + tW + 30
  const dY = tY
  const dW = 282
  drawZonedConveyor('D', dX, dY, 94, dW)

  if (state.returnSystem.enabled) {
    drawZonedConveyor('PURGE', 620, 290, 6, 120)
    drawZonedConveyor('E', 120, 350, 35, 350)
    drawZonedConveyor('X', 500, 350, 5, 100)
    drawZonedConveyor('C2', 770, 290, 29, 300)
    drawZonedConveyor('S', 650, 390, 8, 120)
    drawZonedConveyor('B2', 800, 370, 29, 290)
    drawZonedConveyor('A2', 800, 450, 36, 290)
  }

  const trayPositions = trays.map((t) => {
    if (t.zonePlacement) {
      const layout = segmentLayout.get(`${t.zonePlacement.conveyorId}:MDR:${t.zonePlacement.zoneIndex}`)
      if (layout) return { id: t.id, cx: layout.x + layout.w / 2, cy: layout.y, segId: t.zonePlacement.conveyorId, zoneIndex: t.zonePlacement.zoneIndex }
    }
    if (t.korberHeld) return { id: t.id, cx: 90, cy: 350, segId: 'KORBER' }
    // if tray has pilePlacement metadata, map it to the specific visual subcomponent
    if (t.pilePlacement) {
      const pile = t.pilePlacement.pileId
      if (t.pilePlacement.component === 'BELT') {
        const layout = segmentLayout.get(`${pile}:BELT`)
        if (layout) {
          const beltPos = t.pilePlacement.beltPosFt ?? 0
          const pct = layout.lengthFt > 0 ? Math.max(0, Math.min(1, beltPos / layout.lengthFt)) : 0
          const cx = layout.x + pct * layout.w
          return { id: t.id, cx, cy: layout.y, segId: pile }
        }
      }
      if (t.pilePlacement.component === 'MDR_UPSTREAM' || t.pilePlacement.component === 'MDR_DOWNSTREAM') {
        const zoneIdx = t.pilePlacement.zoneIndex ?? 0
        const mdrId = `${pile}:${t.pilePlacement.component}:${zoneIdx}`
        const layout = segmentLayout.get(mdrId)
        if (layout) {
          const cx = layout.x + layout.w / 2
          return { id: t.id, cx, cy: layout.y, segId: pile }
        }
      }
    }
    const layout = segmentLayout.get(t.currentSegmentId)
    if (!layout) {
      const fallbackY = rowYs.C + 80
      return {
        id: t.id,
        cx: padding + 40,
        cy: fallbackY,
        segId: t.currentSegmentId,
      }
    }
    const pct = layout.lengthFt > 0 ? Math.max(0, Math.min(1, t.positionFt / layout.lengthFt)) : 0
    const cx = layout.x + pct * layout.w
    return { id: t.id, cx, cy: layout.y, segId: t.currentSegmentId }
  })

  const branchConnector = (fromX: number, fromY: number, toX: number, toY: number) =>
    `M ${fromX} ${fromY} L ${fromX + 20} ${fromY} L ${fromX + 20} ${toY} L ${toX} ${toY}`

  const getSegmentRect = (id: string) => segmentLayout.get(id)

  const branchIds: BranchId[] = ['A', 'B', 'C']

  return (
    <svg width={width} height={height} role="img" aria-label="Conveyor network">
      {branchIds.map((branchId) => (
        <g key={branchId}>
          <rect x={exchangerX} y={rowYs[branchId] - rectHeight / 2} width={80} height={rectHeight} fill="#dfe7ff" stroke="#4d6cff" />
          <text x={exchangerX + 40} y={rowYs[branchId] - textOffset} fontSize={12} fill="#000" textAnchor="middle">Exchanger {branchId}</text>
          <text x={exchangerX + 40} y={rowYs[branchId] - textOffset + 16} fontSize={10} fill="#333" textAnchor="middle">Retrieving: {missionCounts[branchId].retrieving}</text>
          <text x={exchangerX + 40} y={rowYs[branchId] - textOffset + 28} fontSize={10} fill="#333" textAnchor="middle">Ready: {missionCounts[branchId].ready}</text>
          <text x={exchangerX + 40} y={rowYs[branchId] - textOffset + 40} fontSize={10} fill="#333" textAnchor="middle">Pending: {missionCounts[branchId].pending}</text>
        </g>
      ))}

      {Array.from(segmentLayout.entries()).map(([id, layout]) => (
        <g
          key={id}
          data-zone-id={layout.zoneIndex !== undefined ? id : undefined}
          data-pile-id={layout.pileId}
          data-conveyor-id={layout.region === 'MDR' ? layout.pileId : undefined}
          data-region={layout.region}
          data-zone-index={layout.zoneIndex}
        >
          <rect
            x={layout.x}
            y={layout.y - layout.h / 2}
            width={layout.w}
            height={layout.h}
            fill={layout.region === 'MDR_UPSTREAM' || layout.region === 'MDR_DOWNSTREAM' ? '#c8e6c9' : layout.region === 'BELT' ? '#90caf9' : layout.region === 'MDR' ? (layout.pileId === 'D' ? '#ffe0b2' : '#ffd54f') : id === 'A1' || id === 'B1' || id === 'C1' || id === 'PRE_T' || id === 'T' || id === 'D' ? 'none' : '#e0e0e0'}
            stroke="#666"
          />
          {layout.zoneIndex === undefined && (
            <text x={layout.x + layout.w / 2} y={layout.y - layout.h / 2 - 6} fontSize={10} fill="#000" textAnchor="middle">{id}</text>
          )}
          {layout.lengthFt > 0 && layout.zoneIndex === undefined && (
            <text x={layout.x + layout.w / 2} y={layout.y + layout.h / 2 + 12} fontSize={9} fill="#333" textAnchor="middle">
              {layout.lengthFt} ft
            </text>
          )}
        </g>
      ))}

      {(() => {
        const paths: ReactElement[] = []
        const a1 = getSegmentRect('A1')
        const b1 = getSegmentRect('B1')
        const c1 = getSegmentRect('C1')
        const preT = getSegmentRect('PRE_T')
        const t = getSegmentRect('T')
        if (a1) paths.push(
          <path key="A-exch-A1" d={`M ${exchangerX + 80} ${rowYs.A} L ${a1.x} ${rowYs.A}`} stroke="#999" fill="none" strokeWidth={2} />
        )
        if (a1 && preT) paths.push(
          <path key="A1-PRE_T" d={branchConnector(a1.x + a1.w, rowYs.A, preT.x, preT.y)} stroke="#999" fill="none" strokeWidth={2} />
        )
        if (b1) paths.push(
          <path key="B-exch-B1" d={`M ${exchangerX + 80} ${rowYs.B} L ${b1.x} ${rowYs.B}`} stroke="#999" fill="none" strokeWidth={2} />
        )
        if (b1 && preT) paths.push(
          <path key="B1-PRE_T" d={branchConnector(b1.x + b1.w, rowYs.B, preT.x, preT.y)} stroke="#999" fill="none" strokeWidth={2} />
        )
        if (c1) paths.push(
          <path key="C-exch-C1" d={`M ${exchangerX + 80} ${rowYs.C} L ${c1.x} ${rowYs.C}`} stroke="#999" fill="none" strokeWidth={2} />
        )
        if (c1 && t) paths.push(
          <path key="C1-T" d={branchConnector(c1.x + c1.w, rowYs.C, t.x, rowYs.B)} stroke="#999" fill="none" strokeWidth={2} />
        )
        if (preT && t) paths.push(
          <path key="PRE_T-T" d={branchConnector(preT.x + preT.w, preT.y, t.x, t.y)} stroke="#999" fill="none" strokeWidth={2} />
        )
        return paths
      })()}

      <text x={500} y={285} fontSize={11} fill="#111">
        Slug cursor: {state.slugCursor} | Active: {state.activeSlug?.source ?? 'NONE'} | Authorized: {state.activeSlug?.authorizedCount ?? 0} | Released: {state.activeSlug?.releasedCount ?? 0} | Entered T: {state.activeSlug?.enteredTCount ?? 0}
      </text>
      <text x={500} y={302} fontSize={11} fill="#111">
        D entrance: {state.dEntranceAvailable ? 'AVAILABLE' : 'BLOCKED'} | D final: {state.dFinalZoneOccupied ? 'OCCUPIED' : 'EMPTY'} | Körber: {state.korber.starved ? 'STARVED' : state.korber.ready ? 'READY' : 'WAITING'}
      </text>

      {state.returnSystem.enabled && (
        <g>
          <path d="M 784 140 L 784 290 L 620 290" stroke="#777" fill="none" />
          <path d="M 1096 140 L 1110 140 L 1110 250 L 90 250 L 90 334" stroke="#777" fill="none" />
          <path d="M 106 350 L 120 350" stroke="#777" fill="none" />
          <path d="M 470 350 L 500 350 M 740 290 L 480 290 L 480 350" stroke="#777" fill="none" />
          <path d="M 600 350 L 630 350 L 630 290 L 770 290 M 630 350 L 630 390 L 650 390" stroke="#777" fill="none" />
          <path d="M 770 390 L 785 390 L 785 370 L 800 370 M 785 390 L 785 450 L 800 450" stroke="#777" fill="none" />
          <rect x={70} y={334} width={36} height={32} fill="#ce93d8" stroke="#6a1b9a" />
          <text x={88} y={329} fontSize={10} textAnchor="middle">Körber</text>
          <text x={620} y={337} fontSize={10}>RETURN SORTER</text>
          <text x={500} y={485} fontSize={11}>
            Purge: {state.returnSystem.activePurgeBatch?.enteredPurgeCount ?? 0}/6 | Held: {state.returnSystem.korberHeldTrayId ?? 'NONE'} | Sorter: {state.returnSystem.sorterCursor} | Returned: {state.returnSystem.returnedToAsrsCount}
          </text>
        </g>
      )}

      {trayPositions.map((tp) => (
        (() => {
          const tray = trays.find((candidate) => candidate.id === tp.id)!
          const destinationColor = tray.returnDestination === 'A2' ? '#c62828' : tray.returnDestination === 'B2' ? '#6a1b9a' : tray.returnDestination === 'C2' ? '#2e7d32' : '#333'
          return <g key={tp.id} data-tray-id={tp.id} data-segment-id={tp.segId} data-zone-index={tp.zoneIndex} data-load-state={tray.loadState ?? 'EMPTY'} data-return-destination={tray.returnDestination} data-purge-member={tray.purgeMember || undefined}>
          <circle cx={tp.cx} cy={tp.cy} r={8} fill={tray.korberHeld ? '#ab47bc' : tray.loadState === 'FULL' ? '#ef6c00' : '#1976d2'} stroke={destinationColor} strokeWidth={tray.returnDestination ? 2 : 0} />
          {tp.segId !== 'D' && <text x={tp.cx} y={tp.cy + 20} fontSize={10} fill="#000" textAnchor="middle">{tp.id}</text>}
        </g>
        })()
      ))}
    </svg>
  )
}

export default ConveyorDiagram
