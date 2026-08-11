import type { FC } from 'react'
import type { ConveyorSegmentConfig } from '../simulation/types'

interface Props {
  segments: ConveyorSegmentConfig[]
  trays: import('../simulation/types').Tray[]
}

const ConveyorDiagram: FC<Props> = ({ segments, trays }) => {
  const width = 900
  const height = 120
  const padding = 20
  const usable = width - padding * 2
  const total = segments.reduce((acc, s) => acc + s.lengthFt, 0)

  // compute segment display widths proportional to physical length
  let x = padding
  const segRects = segments.map((s) => {
    const w = (s.lengthFt / total) * usable
    const rect = { id: s.id, x, w, lengthFt: s.lengthFt }
    x += w + 8
    return rect
  })


  // compute cx for each tray
  const trayPositions = trays.map(t => {
    const rect = segRects.find(r => r.id === t.currentSegmentId)!
    const pct = Math.max(0, Math.min(1, t.positionFt / rect.lengthFt))
    const cx = rect.x + pct * rect.w
    return { id: t.id, cx, cy: height / 2, segId: t.currentSegmentId }
  })

  return (
    <svg width={width} height={height} role="img" aria-label="Conveyor network">
      {segRects.map((r) => (
        <g key={r.id}>
          <rect x={r.x} y={height / 2 - 12} width={r.w} height={24} fill="#e0e0e0" stroke="#666" />
          <text x={r.x + r.w / 2} y={height / 2 - 18} fontSize={12} fill="#000" textAnchor="middle">{r.id}</text>
          <text x={r.x + r.w / 2} y={height / 2 + 36} fontSize={10} fill="#333" textAnchor="middle">{r.lengthFt} ft</text>
        </g>
      ))}

      {trayPositions.map(tp => (
        <g key={tp.id}>
          <circle cx={tp.cx} cy={tp.cy} r={8} fill="#1976d2" />
          <text x={tp.cx} y={tp.cy + 20} fontSize={10} fill="#000" textAnchor="middle">{tp.id}</text>
        </g>
      ))}
    </svg>
  )
}

export default ConveyorDiagram
