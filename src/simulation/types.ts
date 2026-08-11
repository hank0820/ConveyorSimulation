export type TrayStatus = 'MOVING' | 'BLOCKED'

export type SourceId = 'A' | 'B' | 'C'

export interface Tray {
  id: number
  currentSegmentId: string
  positionFt: number
  status: TrayStatus
  createdAtSec: number
  originSourceId: SourceId
}

export interface ConveyorSegmentConfig {
  id: string
  lengthFt: number
  speedFtPerMin: number
  nextSegmentId?: string
  // Optional explicit capacity, otherwise geometry + trayPitchFt defines capacity
  maxOccupancy?: number
}

export interface SourceConfig {
  id: SourceId
  firstSegmentId: string
  initialOffsetSec: number
}

export interface SourceState {
  id: SourceId
  enabled: boolean
  sourceReady: boolean
  sourceBlocked: boolean
  lastSourceReleaseTime: number
  nextReleaseTime: number
  totalTraysCreated: number
  headwaySec: number
  initialOffsetSec: number
  firstSegmentId: string
}

export interface MergeState {
  nextPriority: SourceId
  eligibleA: boolean
  eligibleB: boolean
  eligibleC: boolean
  selectedSource: SourceId | 'NONE'
  cumulativeTransfersA: number
  cumulativeTransfersB: number
  cumulativeTransfersC: number
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
  sources: SourceState[]
  mergeState: MergeState
  segmentStats: SegmentStats[]
  movingCount: number
  blockedCount: number
  totalTraysCreated: number
  materialBalanceError: number
}

export interface SimulationStateWithProgress extends SimulationState {
  totalRouteDistance: number
}
