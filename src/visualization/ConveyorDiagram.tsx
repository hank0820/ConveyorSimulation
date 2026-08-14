import type { FC, ReactElement } from 'react'
import type { ConveyorSegmentConfig, Tray, SimulationStateWithProgress } from '../simulation/types'

type BranchId = 'A' | 'B' | 'C'

interface Props {
  segments: ConveyorSegmentConfig[]
  trays: Tray[]
  state: SimulationStateWithProgress
}

const ConveyorDiagram: FC<Props> = ({ segments, trays, state }) => {
  const width = 920
  const height = 280
  const padding = 20
  const branchStartX = 130
  const exchangerX = 20
  const branchGap = 8
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
      .filter((s) => s.id === 'A1' || s.id === 'A1T')
      .reduce((sum, s) => sum + s.lengthFt, 0),
    B: segments
      .filter((s) => s.id === 'B1' || s.id === 'B1T')
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

  const segmentLayout = new Map<string, { x: number; y: number; w: number; h: number; lengthFt: number }>()

  const rectHeight = 24
  const textOffset = 14

  const addSegment = (id: string, x: number, row: 'A' | 'B' | 'C', len: number) => {
    const y = rowYs[row]
    const w = Math.max(50, Math.round(len * branchScales[row]))
    segmentLayout.set(id, { x, y, w, h: rectHeight, lengthFt: len })
    return x + w + branchGap
  }
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

  const drawMdrBank = (startX: number, row: 'A' | 'B' | 'C', count: number, zoneLen: number, scale: number) => {
    let x = startX
    for (let i = 0; i < count; i++) {
      const w = Math.max(6, Math.round(zoneLen * scale))
      const id = `${row}MDR_${i}`
      segmentLayout.set(id, { x, y: rowYs[row], w, h: rectHeight, lengthFt: zoneLen })
      x += w + 2
    }
    return x
  }

  let nextAx = branchStartX
  const scaleA = branchScales.A
  nextAx = drawMdrBank(nextAx, 'A', A1_up, 2.5, scaleA)
  // belt
  const beltAx = nextAx
  const beltAw = Math.max(40, Math.round(A1_belt * scaleA))
  segmentLayout.set('A1_BELT', { x: beltAx, y: rowYs.A, w: beltAw, h: rectHeight, lengthFt: A1_belt })
  nextAx = beltAx + beltAw + 6
  nextAx = drawMdrBank(nextAx, 'A', A1_down, 2.5, scaleA)
  // mark logical segment A1 spanning
  segmentLayout.set('A1', { x: branchStartX, y: rowYs.A, w: nextAx - branchStartX, h: rectHeight, lengthFt: A1_len })

  // A1T remains transport element
  nextAx = addSegment('A1T', nextAx + 8, 'A', segments.find((s) => s.id === 'A1T')?.lengthFt ?? 59)

  let nextBx = branchStartX
  const scaleB = branchScales.B
  nextBx = drawMdrBank(nextBx, 'B', B1_up, 2.5, scaleB)
  const beltBx = nextBx
  const beltBw = Math.max(40, Math.round(B1_belt * scaleB))
  segmentLayout.set('B1_BELT', { x: beltBx, y: rowYs.B, w: beltBw, h: rectHeight, lengthFt: B1_belt })
  nextBx = beltBx + beltBw + 6
  nextBx = drawMdrBank(nextBx, 'B', B1_down, 2.5, scaleB)
  segmentLayout.set('B1', { x: branchStartX, y: rowYs.B, w: nextBx - branchStartX, h: rectHeight, lengthFt: B1_len })
  nextBx = addSegment('B1T', nextBx + 8, 'B', segments.find((s) => s.id === 'B1T')?.lengthFt ?? 44)

  let nextCx = branchStartX
  const scaleC = branchScales.C
  nextCx = drawMdrBank(nextCx, 'C', B1_up, 2.5, scaleC)
  const beltCx = nextCx
  const beltCw = Math.max(40, Math.round(B1_belt * scaleC))
  segmentLayout.set('C1_BELT', { x: beltCx, y: rowYs.C, w: beltCw, h: rectHeight, lengthFt: B1_belt })
  nextCx = beltCx + beltCw + 6
  nextCx = drawMdrBank(nextCx, 'C', B1_down, 2.5, scaleC)
  segmentLayout.set('C1', { x: branchStartX, y: rowYs.C, w: nextCx - branchStartX, h: rectHeight, lengthFt: B1_len })

  const tX = 620
  const tY = rowYs.B
  const tW = 140
  const tH = 32
  segmentLayout.set('T', { x: tX, y: tY, w: tW, h: tH, lengthFt: segments.find((s) => s.id === 'T')?.lengthFt ?? 0 })

  const dX = tX + tW + 30
  const dY = tY
  const dW = 140
  segmentLayout.set('D', { x: dX, y: dY, w: dW, h: tH, lengthFt: segments.find((s) => s.id === 'D')?.lengthFt ?? 0 })

  const trayPositions = trays.map((t) => {
    // if tray has pilePlacement metadata, map it to the specific visual subcomponent
    if (t.pilePlacement) {
      const pile = t.pilePlacement.pileId
      if (t.pilePlacement.component === 'BELT') {
        const layout = segmentLayout.get(`${pile}_BELT`)
        if (layout) {
          const beltPos = t.pilePlacement.beltPosFt ?? 0
          const pct = layout.lengthFt > 0 ? Math.max(0, Math.min(1, beltPos / layout.lengthFt)) : 0
          const cx = layout.x + pct * layout.w
          return { id: t.id, cx, cy: layout.y, segId: pile }
        }
      }
      if (t.pilePlacement.component === 'MDR_UPSTREAM' || t.pilePlacement.component === 'MDR_DOWNSTREAM') {
        const zoneIdx = t.pilePlacement.zoneIndex ?? 0
        const rowChar = pile[0]
        const mdrId = `${rowChar}MDR_${zoneIdx}`
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
        <g key={id}>
          <rect
            x={layout.x}
            y={layout.y - layout.h / 2}
            width={layout.w}
            height={layout.h}
            fill={id.includes('MDR_') ? '#c8e6c9' : id.endsWith('_BELT') ? '#90caf9' : id === 'T' ? '#ffd54f' : id === 'D' ? '#ffe0b2' : '#e0e0e0'}
            stroke="#666"
          />
          <text x={layout.x + layout.w / 2} y={layout.y - layout.h / 2 - 6} fontSize={10} fill="#000" textAnchor="middle">{id}</text>
          {layout.lengthFt > 0 && (
            <text x={layout.x + layout.w / 2} y={layout.y + layout.h / 2 + 12} fontSize={9} fill="#333" textAnchor="middle">
              {layout.lengthFt} ft
            </text>
          )}
        </g>
      ))}

      {(() => {
        const paths: ReactElement[] = []
        const a1 = getSegmentRect('A1')
        const a1t = getSegmentRect('A1T')
        const b1 = getSegmentRect('B1')
        const b1t = getSegmentRect('B1T')
        const c1 = getSegmentRect('C1')
        const t = getSegmentRect('T')
        if (a1) paths.push(
          <path key="A-exch-A1" d={`M ${exchangerX + 80} ${rowYs.A} L ${a1.x} ${rowYs.A}`} stroke="#999" fill="none" strokeWidth={2} />
        )
        if (a1 && a1t) paths.push(
          <path key="A1-A1T" d={`M ${a1.x + a1.w} ${rowYs.A} L ${a1t.x} ${rowYs.A}`} stroke="#999" fill="none" strokeWidth={2} />
        )
        if (a1t && t) paths.push(
          <path key="A1T-T" d={branchConnector(a1t.x + a1t.w, rowYs.A, t.x, rowYs.B)} stroke="#999" fill="none" strokeWidth={2} />
        )
        if (b1) paths.push(
          <path key="B-exch-B1" d={`M ${exchangerX + 80} ${rowYs.B} L ${b1.x} ${rowYs.B}`} stroke="#999" fill="none" strokeWidth={2} />
        )
        if (b1 && b1t) paths.push(
          <path key="B1-B1T" d={`M ${b1.x + b1.w} ${rowYs.B} L ${b1t.x} ${rowYs.B}`} stroke="#999" fill="none" strokeWidth={2} />
        )
        if (b1t && t) paths.push(
          <path key="B1T-T" d={`M ${b1t.x + b1t.w} ${rowYs.B} L ${t.x} ${rowYs.B}`} stroke="#999" fill="none" strokeWidth={2} />
        )
        if (c1) paths.push(
          <path key="C-exch-C1" d={`M ${exchangerX + 80} ${rowYs.C} L ${c1.x} ${rowYs.C}`} stroke="#999" fill="none" strokeWidth={2} />
        )
        if (c1 && t) paths.push(
          <path key="C1-T" d={branchConnector(c1.x + c1.w, rowYs.C, t.x, rowYs.B)} stroke="#999" fill="none" strokeWidth={2} />
        )
        return paths
      })()}

      {trayPositions.map((tp) => (
        <g key={tp.id}>
          <circle cx={tp.cx} cy={tp.cy} r={8} fill="#1976d2" />
          <text x={tp.cx} y={tp.cy + 20} fontSize={10} fill="#000" textAnchor="middle">{tp.id}</text>
        </g>
      ))}
    </svg>
  )
}

export default ConveyorDiagram
