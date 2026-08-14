export type TrayStatus = 'MOVING' | 'BLOCKED'

export type SourceId = 'A' | 'B' | 'C'

export interface Tray {
  id: number
  currentSegmentId: string
  positionFt: number
  status: TrayStatus
  createdAtSec: number
  originSourceId: SourceId
  // optional physical placement inside a logical hybrid pile
  pilePlacement?: {
    pileId: string // e.g. 'A1','B1','C1'
    component: 'MDR_UPSTREAM' | 'BELT' | 'MDR_DOWNSTREAM'
    zoneIndex?: number // for MDR zones, 0-based from upstream
    beltPosFt?: number // for belt trays: position along belt (0..beltLength)
  }
  // runtime state used by hybrid pile physics
  pileRuntime?: {
    transferring?: boolean
    transferRemainingSec?: number
  }
  zonePlacement?: {
    conveyorId: 'PRE_T' | 'T' | 'D'
    zoneIndex: number
  }
}

export interface ActiveSlugState {
  source: SourceId
  authorizedCount: number
  releasedCount: number
  authorizedTrayIds: number[]
  enteredTCount: number
  finalAuthorizedTrayId: number
  authorizedAtSec: number
  completedAtSec: number | null
  status: 'ACTIVE' | 'COMPLETE'
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
  // Milestone 6 hybrid pile diagnostics
  upstreamMdrA: number
  beltCountA: number
  downstreamMdrA: number
  beltRunningA: boolean
  upstreamMdrB: number
  beltCountB: number
  downstreamMdrB: number
  beltRunningB: boolean
  upstreamMdrC: number
  beltCountC: number
  downstreamMdrC: number
  beltRunningC: boolean
  pileAuthorizedExitA: boolean
  pileAuthorizedExitB: boolean
  pileAuthorizedExitC: boolean
  slugCursor: SourceId
  activeSlug: ActiveSlugState | null
  lastCompletedSlug: ActiveSlugState | null
  dEntranceAvailable: boolean
  dFinalZoneOccupied: boolean
  korberNextConsumptionTime: number
  korberLastConsumedTrayId: number | null
  zonedOccupancy: {
    PRE_T: number
    T: number
    D: number
  }
  segmentStats: SegmentStats[]
  movingCount: number
  blockedCount: number
  // Includes initial inventory created during reset and runtime exchanger releases.
  totalTraysCreated: number
  createdTrayCount: number
  physicalTrayCount: number
  consumedTrayCount: number
  materialBalanceError: number
}

export interface SimulationStateWithProgress extends SimulationState {
  totalRouteDistance: number
}
