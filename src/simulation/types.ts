export type TrayStatus = 'MOVING' | 'BLOCKED'
export type TrayLoadState = 'EMPTY' | 'FULL'
export type TrayPayloadOrigin = 'CARTBUILD' | 'KORBER'
export type ReturnDestination = 'A2' | 'B2' | 'C2'
export type CartbuildLaneId = 'CARTBUILD_A' | 'CARTBUILD_B' | 'CARTBUILD_C'
export type ZonedConveyorId = 'PRE_T' | 'T' | 'D' | 'PURGE' | 'E' | 'X' | 'S' | 'A2' | 'B2' | 'C2'

export type SourceId = 'A' | 'B' | 'C'

export interface Tray {
  id: number
  currentSegmentId: string
  positionFt: number
  status: TrayStatus
  createdAtSec: number
  originSourceId: SourceId
  loadState?: TrayLoadState
  payloadOrigin?: TrayPayloadOrigin
  cartbuildCartonAttached?: boolean
  returnDestination?: ReturnDestination
  purgeMember?: boolean
  korberHeld?: boolean
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
    conveyorId: ZonedConveyorId
    zoneIndex: number
  }
}

export interface OperatingSettings {
  korberEnabled: boolean
  cartbuildAEnabled: boolean
  cartbuildBEnabled: boolean
  cartbuildCEnabled: boolean
}

export interface CartonMarker {
  internalKey: number
  laneId: CartbuildLaneId
  zoneIndex: number
  transferRemainingSec?: number
}

export interface ExchangerOutboundDiagnostic {
  source: SourceId
  cartbuildEnabled: boolean
  lastActualReleaseTime: number | null
  nextEligibleReleaseTime: number
  loadedReleases: number
  emptyReleases: number
  blockedLoadedAttempts: number
  blockedEmptyAttempts: number
  pendingEmptyMissions: number
  mostRecentReleaseType: 'LOADED' | 'EMPTY' | null
  releaseTimes: Array<{ timeSec: number; type: 'LOADED' | 'EMPTY'; trayId: number }>
}

export interface DetrayerDiagnostic {
  source: SourceId
  loadedTrayWaiting: boolean
  trayId: number | null
  zone3Available: boolean
  cartonLaneZone0Available: boolean
  splitCount: number
  blockedTicks: number
  blockedDurationSec: number
  mostRecentSplitTime: number | null
}

export interface CartbuildLaneState {
  id: CartbuildLaneId
  enabled: boolean
  lengthFt: number
  zoneCount: number
  speedFtPerMin: number
  zoneTransferSec: number
  markers: CartonMarker[]
  occupancy: number
  introducedCount: number
  operatorConsumedCount: number
  operatorConsumptionTimes: number[]
  finalZoneOccupied: boolean
  nextEligibleConsumptionTime: number
  lastConsumedTime: number | null
  configuredRatePerHour: number
}

export interface CartbuildSystemState {
  enabled: boolean
  settings: OperatingSettings
  lanes: Record<CartbuildLaneId, CartbuildLaneState>
  exchangers: Record<SourceId, ExchangerOutboundDiagnostic>
  detrayers: Record<SourceId, DetrayerDiagnostic>
  cartbuildCartonsIntroduced: number
  cartbuildCartonsAttachedToTrays: number
  cartbuildCartonsOnConveyors: number
  cartbuildCartonsConsumedByOperators: number
  cartonBalanceError: number
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
export type MissionType = 'EMPTY' | 'CARTBUILD'

export interface Mission {
  missionId: number
  assignedExchanger: SourceId
  missionType: MissionType
  createdAtSec: number
  readyAtSec: number
  state: MissionState
}

export type SrsPileId = 'A1' | 'B1' | 'C1' | 'T' | 'D' | 'A2' | 'B2' | 'C2'

export interface SrsLaneDiagnostic {
  source: SourceId
  targetSize: number
  currentCount: number
  pendingDemand: number
  lanePurgeDemand: number
  localAvailable: number
  downstreamAvailable: number
  laneMissionCapacity: number
  pendingEmptyMissions: number
  pendingCartbuildMissions: number
  maturedEmptyMissions: number
  maturedCartbuildMissions: number
  lastActualExchangerReleaseTime: number | null
  nextEligibleExchangerReleaseTime: number
  activeSourceBatch: boolean
  frozenSourceBatchQuantity: number
  sourceBatchReleasedCount: number
  sourceBatchRemainingCount: number
}

export interface SrsControlState {
  targets: Record<SrsPileId, number>
  current: Record<SrsPileId, number>
  globalTarget: number
  globalCurrent: number
  globalPending: number
  globalAvailableCapacity: number
  planningCadenceSec: number
  nextPlanningTime: number
  planningCursor: SourceId
  lanes: Record<SourceId, SrsLaneDiagnostic>
  tBypassBatch: {
    active: boolean
    authorizedTrayIds: number[]
    enteredCount: number
    remainingCount: number
    sourceBatchPaused: boolean
  }
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

export interface BeltDiagnostic {
  pileId: 'A1' | 'B1' | 'C1'
  beltRunning: boolean
  beltExitAvailable: boolean
  beltBlockedReason: 'DOWNSTREAM_MDR_ENTRANCE_OCCUPIED' | null
  beltTrayCount: number
  leadingBeltTrayId: number | null
  leadingBeltTrayPositionFt: number | null
}

export interface PurgeBatchState {
  authorizedTrayIds: number[]
  authorizedCount: number
  divertedCount: number
  enteredPurgeCount: number
  authorizedAtSec: number
  completedAtSec: number | null
  status: 'ACTIVE' | 'COMPLETE'
}

export interface ReturnedTrayRecord {
  trayId: number
  loadState: TrayLoadState
  destination: ReturnDestination
  acceptedAtSec: number
}

export interface ReturnSystemState {
  enabled: boolean
  korberProcessedCount: number
  korberHeldTrayId: number | null
  returnedToAsrsCount: number
  returnedHistory: ReturnedTrayRecord[]
  purgeTriggerReady: boolean
  activePurgeBatch: PurgeBatchState | null
  lastCompletedPurgeBatch: PurgeBatchState | null
  sorterCursor: ReturnDestination
  sorterSelectedDestination: ReturnDestination | null
  sorterAvailability: Record<ReturnDestination, boolean>
  sorterBlockedReason: string | null
  sHeadTrayDestination: ReturnDestination | null
  assignments: Record<ReturnDestination, { EMPTY: number; FULL: number }>
  mergeCounts: {
    eToXFull: number
    purgeToXEmpty: number
    blockedE: number
    blockedPurge: number
  }
  exchangerAcceptanceTimes: Record<ReturnDestination, number[]>
  conveyorOccupancy: Record<'PURGE' | 'E' | 'X' | 'S' | 'A2' | 'B2' | 'C2', number>
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
  beltDiagnostics: BeltDiagnostic[]
  returnSystem: ReturnSystemState
  operatingSettings: OperatingSettings
  cartbuildSystem: CartbuildSystemState
  srsControl: SrsControlState
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
