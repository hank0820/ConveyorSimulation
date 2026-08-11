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

  let nextAx = branchStartX
  nextAx = addSegment('A1', nextAx, 'A', segments.find((s) => s.id === 'A1')?.lengthFt ?? 0)
  nextAx = addSegment('A1T', nextAx, 'A', segments.find((s) => s.id === 'A1T')?.lengthFt ?? 0)

  let nextBx = branchStartX
  nextBx = addSegment('B1', nextBx, 'B', segments.find((s) => s.id === 'B1')?.lengthFt ?? 0)
  nextBx = addSegment('B1T', nextBx, 'B', segments.find((s) => s.id === 'B1T')?.lengthFt ?? 0)

  let nextCx = branchStartX
  nextCx = addSegment('C1', nextCx, 'C', segments.find((s) => s.id === 'C1')?.lengthFt ?? 0)

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
          <rect x={layout.x} y={layout.y - layout.h / 2} width={layout.w} height={layout.h} fill={id === 'T' ? '#ffd54f' : id === 'D' ? '#ffe0b2' : '#e0e0e0'} stroke="#666" />
          <text x={layout.x + layout.w / 2} y={layout.y - layout.h / 2 - 6} fontSize={12} fill="#000" textAnchor="middle">{id}</text>
          {layout.lengthFt > 0 && (
            <text x={layout.x + layout.w / 2} y={layout.y + layout.h / 2 + 14} fontSize={10} fill="#333" textAnchor="middle">
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
