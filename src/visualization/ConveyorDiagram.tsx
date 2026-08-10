import type { FC } from 'react'

interface Props {
  lengthFt: number
  trayPositionFt: number
}

const ConveyorDiagram: FC<Props> = ({ lengthFt, trayPositionFt }) => {
  const width = 600
  const height = 100
  const padding = 20
  const usable = width - padding * 2
  const pct = Math.max(0, Math.min(1, trayPositionFt / lengthFt))
  const cx = padding + pct * usable

  return (
    <svg width={width} height={height} role="img" aria-label="Conveyor diagram">
      <rect x={padding} y={height / 2 - 10} width={usable} height={20} fill="#e0e0e0" stroke="#888" />
      <text x={padding} y={height / 2 - 16} fontSize={12} fill="#333">0 ft</text>
      <text x={padding + usable} y={height / 2 - 16} fontSize={12} fill="#333" textAnchor="end">{lengthFt} ft</text>
      <circle cx={cx} cy={height / 2} r={10} fill="#1976d2" />
    </svg>
  )
}

export default ConveyorDiagram
