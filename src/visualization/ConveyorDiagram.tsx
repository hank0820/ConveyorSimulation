import type { FC } from 'react'
import type { ConveyorSegmentConfig } from '../simulation/types'

interface Props {
  segments: ConveyorSegmentConfig[]
  traySegmentId: string
  trayPositionFt: number
}

const ConveyorDiagram: FC<Props> = ({ segments, traySegmentId, trayPositionFt }) => {
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

  // find tray rect
  const active = segRects.find((r) => r.id === traySegmentId)
  const cx = active ? active.x + (Math.max(0, Math.min(1, trayPositionFt / active.lengthFt)) * active.w) : padding

  return (
    <svg width={width} height={height} role="img" aria-label="Conveyor network">
      {segRects.map((r) => (
        <g key={r.id}>
          <rect x={r.x} y={height / 2 - 12} width={r.w} height={24} fill="#e0e0e0" stroke="#666" />
          <text x={r.x + r.w / 2} y={height / 2 - 18} fontSize={12} fill="#000" textAnchor="middle">{r.id}</text>
          <text x={r.x + r.w / 2} y={height / 2 + 36} fontSize={10} fill="#333" textAnchor="middle">{r.lengthFt} ft</text>
        </g>
      ))}

      <circle cx={cx} cy={height / 2} r={8} fill="#1976d2" />
    </svg>
  )
}

export default ConveyorDiagram
