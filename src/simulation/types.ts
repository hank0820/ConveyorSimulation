export type TrayStatus = 'MOVING' | 'BLOCKED'

export interface Tray {
  id: number
  currentSegmentId: string
  positionFt: number
  status: TrayStatus
  createdAtSec: number
}

export interface ConveyorSegmentConfig {
  id: string
  lengthFt: number
  speedFtPerMin: number
  nextSegmentId?: string
  // Optional explicit capacity, otherwise geometry + trayPitchFt defines capacity
  maxOccupancy?: number
}

export interface SourceState {
  enabled: boolean
  sourceReady: boolean
  sourceBlocked: boolean
  lastSourceReleaseTime: number
  totalTraysCreated: number
  headwaySec: number
}

export interface SegmentStats {
  id: string
  occupancy: number
  capacity?: number
  occupancyPct?: number
}

export interface SimulationState {
  timeSec: number
  trays: Tray[]
  segments: ConveyorSegmentConfig[]
  source: SourceState
  segmentStats: SegmentStats[]
  movingCount: number
  blockedCount: number
  totalTraysCreated: number
  materialBalanceError: number
}

export interface SimulationStateWithProgress extends SimulationState {
  totalRouteDistance: number
}
