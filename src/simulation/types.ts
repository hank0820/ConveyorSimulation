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

export type MissionState = 'RETRIEVING' | 'READY_AT_EXCHANGER' | 'RELEASED'

export interface Mission {
  missionId: number
  assignedExchanger: SourceId
  createdAtSec: number
  readyAtSec: number
  state: MissionState
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
  // Milestone 5 diagnostics / control
  korber: {
    lastConsumptionTime: number | null
    totalConsumed: number
    ready: boolean
    starved: boolean
  }
  missions: Mission[]
  pendingA: number
  pendingB: number
  pendingC: number
  retrievingA: number
  retrievingB: number
  retrievingC: number
  readyA: number
  readyB: number
  readyC: number
  additionalASRSDemand: number
  globalTargetCount: number
  globalCurrentCount: number
  transportInventory: number
  physicalPreKorberInventory: number
  purgeDemandA: number
  purgeDemandB: number
  purgeDemandC: number
  asrsNextAssign: SourceId
  asrsAssignedA: number
  asrsAssignedB: number
  asrsAssignedC: number
  segmentStats: SegmentStats[]
  movingCount: number
  blockedCount: number
  totalTraysCreated: number
  materialBalanceError: number
}

export interface SimulationStateWithProgress extends SimulationState {
  totalRouteDistance: number
}
