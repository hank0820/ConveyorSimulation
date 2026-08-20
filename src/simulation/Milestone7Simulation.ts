import HybridAccumulationPile from './HybridAccumulationPile'
import InboundCompositeConveyor from './InboundCompositeConveyor'
import type {
  ActiveSlugState,
  BeltDiagnostic,
  CartbuildLaneId,
  CartonMarker,
  CompletedOutboundCycle,
  ConveyorSegmentConfig,
  MergeState,
  Mission,
  MissionType,
  OperatingSettings,
  OutboundRobotBlockedReason,
  OutboundRobotLifecycleState,
  PurgeBatchState,
  ReturnDestination,
  ReturnedTrayRecord,
  SimulationStateWithProgress,
  SourceId,
  SourceState,
  SrsPileId,
  Tray,
  TrayLoadState,
} from './types'

const EPS = 1e-9
const ZONE_LENGTH_FT = 2.5
const TRAY_LENGTH_FT = 2
const SPEED_FT_PER_SEC = 2
const ZONE_TRANSFER_SEC = ZONE_LENGTH_FT / SPEED_FT_PER_SEC
const KORBER_INTERVAL_SEC = 3600 / 1050
export const ZONE_COUNTS = { PRE_T: 6, T: 12, D: 92, PURGE: 12, E: 28, X: 4, S: 8 } as const
type ZonedId = keyof typeof ZONE_COUNTS
const RETURN_IDS = ['PURGE', 'E', 'X', 'S', 'A2', 'B2', 'C2'] as const
const RETURN_DESTINATIONS: ReturnDestination[] = ['A2', 'B2', 'C2']
export const INBOUND_COMPOSITE_CONFIGS = {
  A2: { totalLengthFt: 136, sorterSideMdrCount: 33, spiralLengthFt: 41, exchangerSideMdrCount: 5 },
  B2: { totalLengthFt: 118.5, sorterSideMdrCount: 26, spiralLengthFt: 41, exchangerSideMdrCount: 5 },
  C2: { totalLengthFt: 118.5, sorterSideMdrCount: 26, spiralLengthFt: 41, exchangerSideMdrCount: 5 },
} as const
const CARTBUILD_LANES: CartbuildLaneId[] = ['CARTBUILD_A', 'CARTBUILD_B', 'CARTBUILD_C']
const CARTBUILD_ZONE_COUNT = 30
const CARTBUILD_INTERVAL_SEC = 8
export const SRS_TARGET_SIZES: Record<SrsPileId, number> = { A1: 24, B1: 16, C1: 16, T: 6, D: 92, A2: 36, B2: 29, C2: 29 }
const SRS_GLOBAL_TARGET = Object.values(SRS_TARGET_SIZES).reduce((sum, target) => sum + target, 0)
const DEFAULT_PLANNING_CADENCE_SEC = 10
const DEFAULT_SETTINGS = (): OperatingSettings => ({ korberEnabled: true, cartbuildAEnabled: true, cartbuildBEnabled: true, cartbuildCEnabled: true })
const laneFor = (source: SourceId): CartbuildLaneId => `CARTBUILD_${source}` as CartbuildLaneId
const settingFor = (source: SourceId): keyof OperatingSettings => `cartbuild${source}Enabled` as keyof OperatingSettings

type OutboundMission = Mission & {
  robotId?: number
  robotState?: OutboundRobotLifecycleState
  robotPayload?: Tray
  payloadTrayId?: number
  payloadLoadState?: 'EMPTY' | 'FULL'
  payloadCartbuildCartonAttached?: boolean
  robotBlockedReason?: OutboundRobotBlockedReason | null
  robotBlockedDurationSec?: number
  robotBlockedSinceSec?: number
  queueEntryTimeSec?: number
  dropEntryTimeSec?: number
  successfulDropTimeSec?: number
  takeArrivalTimeSec?: number
  inboundPayload?: Tray
  inboundTrayId?: number
  inboundTrayLoadState?: TrayLoadState
  takePickupTimeSec?: number
  returnStartedAtSec?: number
  rackArrivalTimeSec?: number
  cycleType?: 'OUTBOUND_ONLY' | 'DUAL_CYCLE'
}

type InboundMission = {
  missionId: number
  robotId: number
  assignedExchanger: SourceId
  reservedTrayId: number
  reservedLoadState: TrayLoadState
  assignedAtSec: number
  maturityTimeSec: number
  robotState: 'TRAVELING_TO_DROP' | 'QUEUED_FOR_DROP' | 'HEAD_OF_DROP_QUEUE' | 'AT_DROP' | 'SHIFTING_TO_TAKE' | 'RETURNING_TO_RACK' | 'INBOUND_COMPLETE' | 'CANCELLED'
  queueEntryTimeSec?: number
  dropEntryTimeSec?: number
  successfulDropTimeSec?: number
  takeArrivalTimeSec?: number
  takePickupTimeSec?: number
  returnStartedAtSec?: number
  rackArrivalTimeSec?: number
  inboundPayload?: Tray
  cancellationTimeSec?: number
  cancellationReason?: 'CLAIMED_BY_OUTBOUND_ROBOT'
  cancelledAfterAdmission: boolean
  historyRecorded: boolean
}

type QueuedRobot =
  | { kind: 'OUTBOUND'; mission: OutboundMission }
  | { kind: 'INBOUND_ONLY'; mission: InboundMission }

type ExchangerStation = {
  dropMissionId: number | null
  dropRobotKind: 'OUTBOUND' | 'INBOUND_ONLY' | null
  shiftingMissionId: number | null
  shiftingRobotKind: 'OUTBOUND' | 'INBOUND_ONLY' | null
  shiftStartedAtSec: number | null
  queueAdvanceStartedAtSec: number | null
  queueAdvanceRobotIds: number[]
  maximumObservedQueueLength: number
  completedCycles: CompletedOutboundCycle[]
}

const createExchangerStations = (): Record<SourceId, ExchangerStation> => ({
  A: { dropMissionId: null, dropRobotKind: null, shiftingMissionId: null, shiftingRobotKind: null, shiftStartedAtSec: null, queueAdvanceStartedAtSec: null, queueAdvanceRobotIds: [], maximumObservedQueueLength: 0, completedCycles: [] },
  B: { dropMissionId: null, dropRobotKind: null, shiftingMissionId: null, shiftingRobotKind: null, shiftStartedAtSec: null, queueAdvanceStartedAtSec: null, queueAdvanceRobotIds: [], maximumObservedQueueLength: 0, completedCycles: [] },
  C: { dropMissionId: null, dropRobotKind: null, shiftingMissionId: null, shiftingRobotKind: null, shiftStartedAtSec: null, queueAdvanceStartedAtSec: null, queueAdvanceRobotIds: [], maximumObservedQueueLength: 0, completedCycles: [] },
})

const SOURCE_STATES: SourceState[] = (['A', 'B', 'C'] as SourceId[]).map((id) => ({
  id,
  enabled: true,
  sourceReady: false,
  sourceBlocked: false,
  lastSourceReleaseTime: -8,
  nextReleaseTime: 0,
  totalTraysCreated: 0,
  headwaySec: 8,
  initialOffsetSec: id === 'A' ? 0 : id === 'B' ? 2 : 4,
  firstSegmentId: `${id}1`,
}))

export default class Milestone7Simulation {
  private timeSec = 0
  private trays: Tray[] = []
  private totalTraysCreated = 0
  private consumedCount = 0
  private segments: ConveyorSegmentConfig[]
  private piles = new Map<string, HybridAccumulationPile>()
  private inboundComposites = new Map<ReturnDestination, InboundCompositeConveyor>()
  private missions: OutboundMission[] = []
  private inboundMissions: InboundMission[] = []
  private inboundReservations = new Map<number, number>()
  private missionCounter = 0
  private robotCounter = 0
  private asrsNextAssign: SourceId = 'A'
  private planningCadenceSec = DEFAULT_PLANNING_CADENCE_SEC
  private nextPlanningTime = 0
  private asrsAssigned: Record<SourceId, number> = { A: 0, B: 0, C: 0 }
  private asrsLastRelease: Record<SourceId, number> = { A: -1e9, B: -1e9, C: -1e9 }
  private exchangerStations = createExchangerStations()
  private sources = SOURCE_STATES.map((source) => ({ ...source }))
  private slugCursor: SourceId = 'A'
  private activeSlug: ActiveSlugState | null = null
  private lastCompletedSlug: ActiveSlugState | null = null
  private nextConsumptionTime = KORBER_INTERVAL_SEC
  private korberStarved = false
  private lastConsumedTrayId: number | null = null
  private cumulativeTransfers: Record<SourceId, number> = { A: 0, B: 0, C: 0 }
  private beltDiagnostics = new Map<string, BeltDiagnostic>()
  private returnEnabled: boolean
  private korberProcessedCount = 0
  private returnedHistory: ReturnedTrayRecord[] = []
  private sorterCursor: ReturnDestination = 'A2'
  private sorterSelectedDestination: ReturnDestination | null = null
  private sorterBlockedReason: string | null = null
  private activePurgeBatch: PurgeBatchState | null = null
  private lastCompletedPurgeBatch: PurgeBatchState | null = null
  private returnAssignments: Record<ReturnDestination, { EMPTY: number; FULL: number }> = { A2: { EMPTY: 0, FULL: 0 }, B2: { EMPTY: 0, FULL: 0 }, C2: { EMPTY: 0, FULL: 0 } }
  private returnMergeCounts = { eToXFull: 0, purgeToXEmpty: 0, blockedE: 0, blockedPurge: 0 }
  private exchangerAcceptanceTimes: Record<ReturnDestination, number[]> = { A2: [], B2: [], C2: [] }
  private cartbuildAvailable: boolean
  private asrsReturnRobotsEnabled: boolean
  private operatingSettings: OperatingSettings = DEFAULT_SETTINGS()
  private cartons: CartonMarker[] = []
  private cartonMarkerCounter = 0
  private cartonIntroduced: Record<SourceId, number> = { A: 0, B: 0, C: 0 }
  private operatorConsumptionTimes: Record<SourceId, number[]> = { A: [], B: [], C: [] }
  private outboundDiagnostics: Record<SourceId, { loadedReleases: number; emptyReleases: number; blockedLoadedAttempts: number; blockedEmptyAttempts: number; mostRecentReleaseType: 'LOADED' | 'EMPTY' | null; releaseTimes: Array<{ timeSec: number; type: 'LOADED' | 'EMPTY'; trayId: number }> }> = {
    A: { loadedReleases: 0, emptyReleases: 0, blockedLoadedAttempts: 0, blockedEmptyAttempts: 0, mostRecentReleaseType: null, releaseTimes: [] },
    B: { loadedReleases: 0, emptyReleases: 0, blockedLoadedAttempts: 0, blockedEmptyAttempts: 0, mostRecentReleaseType: null, releaseTimes: [] },
    C: { loadedReleases: 0, emptyReleases: 0, blockedLoadedAttempts: 0, blockedEmptyAttempts: 0, mostRecentReleaseType: null, releaseTimes: [] },
  }
  private detrayerDiagnostics: Record<SourceId, { splitCount: number; blockedTicks: number; blockedDurationSec: number; mostRecentSplitTime: number | null }> = {
    A: { splitCount: 0, blockedTicks: 0, blockedDurationSec: 0, mostRecentSplitTime: null },
    B: { splitCount: 0, blockedTicks: 0, blockedDurationSec: 0, mostRecentSplitTime: null },
    C: { splitCount: 0, blockedTicks: 0, blockedDurationSec: 0, mostRecentSplitTime: null },
  }

  constructor(segments: ConveyorSegmentConfig[]) {
    const authoritativeGeometry: Partial<Record<string, Pick<ConveyorSegmentConfig, 'lengthFt' | 'maxOccupancy'>>> = {
      A1: { lengthFt: 103.5, maxOccupancy: 45 }, B1: { lengthFt: 86, maxOccupancy: 38 }, C1: { lengthFt: 86, maxOccupancy: 38 },
      PRE_T: { lengthFt: 15, maxOccupancy: 6 }, T: { lengthFt: 30, maxOccupancy: 12 }, D: { lengthFt: 230, maxOccupancy: 92 },
      PURGE: { lengthFt: 30, maxOccupancy: 12 }, E: { lengthFt: 70, maxOccupancy: 28 }, X: { lengthFt: 10, maxOccupancy: 4 }, S: { lengthFt: 20, maxOccupancy: 8 },
      A2: { lengthFt: 136, maxOccupancy: 58 }, B2: { lengthFt: 118.5, maxOccupancy: 51 }, C2: { lengthFt: 118.5, maxOccupancy: 51 },
    }
    this.segments = segments.map((segment) => ({ ...segment, ...authoritativeGeometry[segment.id] }))
    this.returnEnabled = RETURN_IDS.every((id) => segments.some((segment) => segment.id === id))
    this.cartbuildAvailable = CARTBUILD_LANES.every((id) => segments.some((segment) => segment.id === id))
    this.asrsReturnRobotsEnabled = this.returnEnabled && this.cartbuildAvailable
    this.piles.set('A1', new HybridAccumulationPile({ pileId: 'A1', totalLengthFt: 103.5, preDetrayerMdrCount: 5, postDetrayerMdrCount: 5, downstreamMdrCount: 15, beltLengthFt: 41, mdrZoneLengthFt: ZONE_LENGTH_FT, trayLengthFt: TRAY_LENGTH_FT }))
    this.piles.set('B1', new HybridAccumulationPile({ pileId: 'B1', totalLengthFt: 86, preDetrayerMdrCount: 5, postDetrayerMdrCount: 5, downstreamMdrCount: 8, beltLengthFt: 41, mdrZoneLengthFt: ZONE_LENGTH_FT, trayLengthFt: TRAY_LENGTH_FT }))
    this.piles.set('C1', new HybridAccumulationPile({ pileId: 'C1', totalLengthFt: 86, preDetrayerMdrCount: 5, postDetrayerMdrCount: 5, downstreamMdrCount: 8, beltLengthFt: 41, mdrZoneLengthFt: ZONE_LENGTH_FT, trayLengthFt: TRAY_LENGTH_FT }))
    for (const conveyorId of RETURN_DESTINATIONS) {
      this.inboundComposites.set(conveyorId, new InboundCompositeConveyor({ conveyorId, ...INBOUND_COMPOSITE_CONFIGS[conveyorId], mdrZoneLengthFt: ZONE_LENGTH_FT, trayLengthFt: TRAY_LENGTH_FT }))
    }
    this.reset()
  }

  reset() {
    this.initialize(DEFAULT_SETTINGS(), DEFAULT_PLANNING_CADENCE_SEC)
  }

  startScenario(settings: OperatingSettings, planningCadenceSec: number) {
    if (!Number.isFinite(planningCadenceSec) || planningCadenceSec <= 0) throw new Error('PendingDemand planning cadence must be a positive finite number')
    this.initialize(settings, planningCadenceSec)
  }

  private initialize(settings: OperatingSettings, planningCadenceSec: number) {
    this.timeSec = 0
    this.trays = []
    this.totalTraysCreated = 0
    this.consumedCount = 0
    this.missions = []
    this.inboundMissions = []
    this.inboundReservations.clear()
    this.missionCounter = 0
    this.robotCounter = 0
    this.asrsNextAssign = 'A'
    this.planningCadenceSec = planningCadenceSec
    this.nextPlanningTime = 0
    this.asrsAssigned = { A: 0, B: 0, C: 0 }
    this.asrsLastRelease = { A: -1e9, B: -1e9, C: -1e9 }
    this.exchangerStations = createExchangerStations()
    this.sources = SOURCE_STATES.map((source) => ({ ...source }))
    this.slugCursor = 'A'
    this.activeSlug = null
    this.lastCompletedSlug = null
    this.nextConsumptionTime = KORBER_INTERVAL_SEC
    this.korberStarved = false
    this.lastConsumedTrayId = null
    this.cumulativeTransfers = { A: 0, B: 0, C: 0 }
    this.beltDiagnostics.clear()
    this.korberProcessedCount = 0
    this.returnedHistory = []
    this.sorterCursor = 'A2'
    this.sorterSelectedDestination = null
    this.sorterBlockedReason = null
    this.activePurgeBatch = null
    this.lastCompletedPurgeBatch = null
    this.returnAssignments = { A2: { EMPTY: 0, FULL: 0 }, B2: { EMPTY: 0, FULL: 0 }, C2: { EMPTY: 0, FULL: 0 } }
    this.returnMergeCounts = { eToXFull: 0, purgeToXEmpty: 0, blockedE: 0, blockedPurge: 0 }
    this.exchangerAcceptanceTimes = { A2: [], B2: [], C2: [] }
    this.operatingSettings = { ...settings }
    this.cartons = []
    this.cartonMarkerCounter = 0
    this.cartonIntroduced = { A: 0, B: 0, C: 0 }
    this.operatorConsumptionTimes = { A: [], B: [], C: [] }
    this.outboundDiagnostics = {
      A: { loadedReleases: 0, emptyReleases: 0, blockedLoadedAttempts: 0, blockedEmptyAttempts: 0, mostRecentReleaseType: null, releaseTimes: [] },
      B: { loadedReleases: 0, emptyReleases: 0, blockedLoadedAttempts: 0, blockedEmptyAttempts: 0, mostRecentReleaseType: null, releaseTimes: [] },
      C: { loadedReleases: 0, emptyReleases: 0, blockedLoadedAttempts: 0, blockedEmptyAttempts: 0, mostRecentReleaseType: null, releaseTimes: [] },
    }
    this.detrayerDiagnostics = {
      A: { splitCount: 0, blockedTicks: 0, blockedDurationSec: 0, mostRecentSplitTime: null },
      B: { splitCount: 0, blockedTicks: 0, blockedDurationSec: 0, mostRecentSplitTime: null },
      C: { splitCount: 0, blockedTicks: 0, blockedDurationSec: 0, mostRecentSplitTime: null },
    }

    let nextId = 1
    for (const source of ['A', 'B', 'C'] as SourceId[]) {
      const result = this.piles.get(`${source}1`)!.initialTrays(nextId, source, SRS_TARGET_SIZES[`${source}1` as 'A1' | 'B1' | 'C1'])
      this.trays.push(...result.trays)
      nextId = result.nextId
    }
    this.totalTraysCreated = nextId - 1
    for (let zoneIndex = 0; zoneIndex < ZONE_COUNTS.D; zoneIndex++) {
      this.trays.push(this.createZonedTray('D', zoneIndex, 'A'))
    }
    for (const tray of this.trays) tray.loadState = 'EMPTY'
    this.planPendingDemand()
    this.nextPlanningTime = this.planningCadenceSec
  }

  step(seconds: number) {
    if (seconds <= 0) return
    let remaining = seconds
    while (remaining > EPS) {
      const delta = Math.min(0.1, remaining)
      remaining -= delta
      this.timeSec += delta
      this.matureMissions()
      this.processKorber()
      this.planPendingDemandIfDue()
      this.processZonedConveyors(delta)
      this.processInboundComposites(delta)
      this.processCartonConveyors(delta)
      this.processCartonOperators()
      this.processPiles(delta)
      this.authorizeSlugIfPossible()
      this.releaseActivePileTray()
      this.authorizePurgeIfNeeded()
      this.processZonedBoundaries()
      this.processReturnBoundaries()
      this.processExchangerSinks()
      this.attemptExchangerReleases()
    }
  }

  setOperatingSetting(setting: keyof OperatingSettings, enabled: boolean) {
    this.operatingSettings = { ...this.operatingSettings, [setting]: enabled }
  }

  getOperatingSettings(): OperatingSettings {
    return { ...this.operatingSettings }
  }

  setPendingDemandPlanningCadence(seconds: number) {
    if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('PendingDemand planning cadence must be a positive finite number')
    this.planningCadenceSec = seconds
    this.nextPlanningTime = this.timeSec + seconds
  }

  private createZonedTray(conveyorId: ZonedId, zoneIndex: number, origin: SourceId): Tray {
    const id = ++this.totalTraysCreated
    return {
      id,
      currentSegmentId: conveyorId,
      positionFt: (zoneIndex + 0.5) * ZONE_LENGTH_FT,
      status: 'BLOCKED',
      createdAtSec: this.timeSec,
      originSourceId: origin,
      loadState: 'EMPTY',
      zonePlacement: { conveyorId, zoneIndex },
    }
  }

  private zonedOccupancy(conveyorId: ZonedId): (Tray | null)[] {
    const zones: (Tray | null)[] = Array(ZONE_COUNTS[conveyorId]).fill(null)
    for (const tray of this.trays) {
      if (tray.zonePlacement?.conveyorId === conveyorId) zones[tray.zonePlacement.zoneIndex] = tray
    }
    return zones
  }

  private processZonedConveyors(delta: number) {
    const ids: ZonedId[] = this.returnEnabled
      ? ['PRE_T', 'T', 'D', 'PURGE', 'E', 'X', 'S']
      : ['PRE_T', 'T', 'D']
    for (const conveyorId of ids) {
      let residualElapsedSec = 0
      for (const tray of this.trays) {
        if (tray.zonePlacement?.conveyorId !== conveyorId || !tray.pileRuntime?.transferRemainingSec) continue
        tray.pileRuntime.transferRemainingSec -= delta
        if (tray.pileRuntime.transferRemainingSec <= EPS) {
          residualElapsedSec = Math.max(residualElapsedSec, -tray.pileRuntime.transferRemainingSec)
          tray.zonePlacement.zoneIndex += 1
          tray.positionFt = (tray.zonePlacement.zoneIndex + 0.5) * ZONE_LENGTH_FT
          tray.pileRuntime = undefined
        }
      }
      const zones = this.zonedOccupancy(conveyorId)
      for (let index = ZONE_COUNTS[conveyorId] - 2; index >= 0; index--) {
        const source = zones[index]
        if (source && !zones[index + 1] && !source.pileRuntime) {
          source.pileRuntime = { transferring: true, transferRemainingSec: ZONE_TRANSFER_SEC - residualElapsedSec }
        }
      }
    }
  }

  private inboundFinalTray(destination: ReturnDestination) {
    const composite = this.inboundComposites.get(destination)!
    return composite.mdrOccupancy(this.trays, 'MDR_EXCHANGER_SIDE')[composite.config.exchangerSideMdrCount - 1]
  }

  private inboundEntranceOpen(destination: ReturnDestination) {
    return !this.inboundComposites.get(destination)!.mdrOccupancy(this.trays, 'MDR_SORTER_SIDE')[0]
  }

  private moveToInboundEntrance(tray: Tray, destination: ReturnDestination) {
    tray.currentSegmentId = destination
    tray.inboundPlacement = { conveyorId: destination, component: 'MDR_SORTER_SIDE', zoneIndex: 0 }
    tray.zonePlacement = undefined
    tray.pilePlacement = undefined
    tray.pileRuntime = undefined
    tray.status = 'BLOCKED'
    this.inboundComposites.get(destination)!.updateAbsolutePosition(tray)
  }

  private processInboundComposites(delta: number) {
    if (!this.returnEnabled) return
    for (const destination of RETURN_DESTINATIONS) {
      const inboundTrays = this.trays.filter((tray) => tray.inboundPlacement?.conveyorId === destination)
      if (!inboundTrays.length) continue
      const composite = this.inboundComposites.get(destination)!
      const exchanger = composite.mdrOccupancy(inboundTrays, 'MDR_EXCHANGER_SIDE')
      let residualElapsedSec = 0

      for (const tray of inboundTrays) {
        const placement = tray.inboundPlacement
        if (placement?.conveyorId !== destination || placement.component === 'SPIRAL' || tray.pileRuntime?.transferRemainingSec === undefined) continue
        const isSorterEntryTransfer = placement.component === 'MDR_SORTER_SIDE'
          && placement.zoneIndex === composite.config.sorterSideMdrCount - 1
        if (isSorterEntryTransfer && exchanger[0]) continue
        tray.pileRuntime.transferRemainingSec -= delta
        if (tray.pileRuntime.transferRemainingSec <= EPS) {
          residualElapsedSec = Math.max(residualElapsedSec, -tray.pileRuntime.transferRemainingSec)
          if (isSorterEntryTransfer) {
            tray.inboundPlacement = { conveyorId: destination, component: 'SPIRAL', spiralPosFt: TRAY_LENGTH_FT / 2 }
            tray.status = 'MOVING'
          } else {
            placement.zoneIndex = (placement.zoneIndex ?? 0) + 1
          }
          tray.pileRuntime = undefined
          composite.updateAbsolutePosition(tray)
        }
      }

      const refreshedExchanger = composite.mdrOccupancy(inboundTrays, 'MDR_EXCHANGER_SIDE')
      for (let index = refreshedExchanger.length - 2; index >= 0; index--) {
        const tray = refreshedExchanger[index]
        if (tray && !refreshedExchanger[index + 1] && !tray.pileRuntime) {
          tray.pileRuntime = { transferring: true, transferRemainingSec: ZONE_TRANSFER_SEC - residualElapsedSec }
        }
      }

      const spiral = composite.spiralTrays(inboundTrays)
      const beltExitAvailable = !refreshedExchanger[0]
      if (beltExitAvailable) {
        const leading = spiral.at(-1)
        if (leading && (leading.inboundPlacement!.spiralPosFt ?? 0) >= composite.config.spiralLengthFt - TRAY_LENGTH_FT / 2 - EPS) {
          leading.inboundPlacement = { conveyorId: destination, component: 'MDR_EXCHANGER_SIDE', zoneIndex: 0 }
          leading.pileRuntime = undefined
          composite.updateAbsolutePosition(leading)
        }

        const remainingSpiral = composite.spiralTrays(inboundTrays)
        const maxCenter = composite.config.spiralLengthFt - TRAY_LENGTH_FT / 2
        const maxDelta = remainingSpiral.length ? maxCenter - (remainingSpiral.at(-1)!.inboundPlacement!.spiralPosFt ?? 0) : Infinity
        const sharedDelta = Math.max(0, Math.min(SPEED_FT_PER_SEC * delta, maxDelta))
        for (const tray of remainingSpiral) {
          tray.inboundPlacement!.spiralPosFt = (tray.inboundPlacement!.spiralPosFt ?? TRAY_LENGTH_FT / 2) + sharedDelta
          tray.status = 'MOVING'
          composite.updateAbsolutePosition(tray)
        }

        const sorterAfterMovement = composite.mdrOccupancy(inboundTrays, 'MDR_SORTER_SIDE')
        const sorterFinal = sorterAfterMovement.at(-1)
        const nearestCenter = remainingSpiral[0]?.inboundPlacement?.spiralPosFt ?? Infinity
        if (sorterFinal && !sorterFinal.pileRuntime && nearestCenter - TRAY_LENGTH_FT / 2 >= TRAY_LENGTH_FT - EPS) {
          sorterFinal.pileRuntime = { transferring: true, transferRemainingSec: ZONE_TRANSFER_SEC - residualElapsedSec }
        }
      } else {
        for (const tray of spiral) tray.status = 'BLOCKED'
      }

      const refreshedSorter = composite.mdrOccupancy(inboundTrays, 'MDR_SORTER_SIDE')
      for (let index = refreshedSorter.length - 2; index >= 0; index--) {
        const tray = refreshedSorter[index]
        if (tray && !refreshedSorter[index + 1] && !tray.pileRuntime) {
          tray.pileRuntime = { transferring: true, transferRemainingSec: ZONE_TRANSFER_SEC - residualElapsedSec }
        }
      }
    }
  }

  private cartonOccupancy(laneId: CartbuildLaneId): (CartonMarker | null)[] {
    const zones: (CartonMarker | null)[] = Array(CARTBUILD_ZONE_COUNT).fill(null)
    for (const carton of this.cartons) if (carton.laneId === laneId) zones[carton.zoneIndex] = carton
    return zones
  }

  private processCartonConveyors(delta: number) {
    if (!this.cartbuildAvailable) return
    for (const laneId of CARTBUILD_LANES) {
      let residualElapsedSec = 0
      for (const carton of this.cartons) {
        if (carton.laneId !== laneId || carton.transferRemainingSec === undefined) continue
        carton.transferRemainingSec -= delta
        if (carton.transferRemainingSec <= EPS) {
          residualElapsedSec = Math.max(residualElapsedSec, -carton.transferRemainingSec)
          carton.zoneIndex += 1
          carton.transferRemainingSec = undefined
        }
      }
      const zones = this.cartonOccupancy(laneId)
      for (let index = CARTBUILD_ZONE_COUNT - 2; index >= 0; index--) {
        const carton = zones[index]
        if (carton && !zones[index + 1] && carton.transferRemainingSec === undefined) {
          carton.transferRemainingSec = ZONE_TRANSFER_SEC - residualElapsedSec
        }
      }
    }
  }

  private processCartonOperators() {
    if (!this.cartbuildAvailable) return
    for (const source of ['A', 'B', 'C'] as SourceId[]) {
      const final = this.cartonOccupancy(laneFor(source))[CARTBUILD_ZONE_COUNT - 1]
      const times = this.operatorConsumptionTimes[source]
      const last = times.at(-1) ?? -Infinity
      if (!final || this.timeSec < last + CARTBUILD_INTERVAL_SEC - EPS) continue
      this.cartons.splice(this.cartons.indexOf(final), 1)
      times.push(this.timeSec)
    }
  }

  private processZonedBoundaries() {
    const preTFinal = this.zonedOccupancy('PRE_T')[ZONE_COUNTS.PRE_T - 1]
    if (preTFinal && !this.zonedOccupancy('T')[0] && this.activeSlug && this.activeSlug.source !== 'C') {
      this.moveToZonedEntrance(preTFinal, 'T')
      this.recordEnteredT(preTFinal)
    }
    const tFinal = this.zonedOccupancy('T')[ZONE_COUNTS.T - 1]
    if (tFinal) {
      const ownsPurge = Boolean(this.activePurgeBatch?.authorizedTrayIds.includes(tFinal.id))
      if (ownsPurge) {
        if (!this.zonedOccupancy('PURGE')[0]) {
          this.moveToZonedEntrance(tFinal, 'PURGE')
          tFinal.purgeMember = true
          this.activePurgeBatch!.divertedCount += 1
          this.activePurgeBatch!.enteredPurgeCount += 1
          if (this.activePurgeBatch!.enteredPurgeCount === this.activePurgeBatch!.authorizedCount) {
            this.activePurgeBatch!.status = 'COMPLETE'
            this.activePurgeBatch!.completedAtSec = this.timeSec
            this.lastCompletedPurgeBatch = { ...this.activePurgeBatch!, authorizedTrayIds: [...this.activePurgeBatch!.authorizedTrayIds] }
            this.activePurgeBatch = null
          }
        }
      } else if (!this.activePurgeBatch && !this.zonedOccupancy('D')[0]) {
        this.moveToZonedEntrance(tFinal, 'D')
      }
    }
  }

  private authorizePurgeIfNeeded() {
    if (!this.returnEnabled || this.activePurgeBatch) return
    const t = this.zonedOccupancy('T')
    const dBlocked = Boolean(this.zonedOccupancy('D')[0])
    if (!dBlocked || t.filter(Boolean).length !== ZONE_COUNTS.T || this.zonedOccupancy('PURGE')[0]) return
    const selected = t.filter((tray): tray is Tray => Boolean(tray && (tray.loadState ?? 'EMPTY') === 'EMPTY'))
      .sort((a, b) => b.zonePlacement!.zoneIndex - a.zonePlacement!.zoneIndex)
      .slice(0, 6)
    if (selected.length !== 6) return
    this.activePurgeBatch = {
      authorizedTrayIds: selected.map((tray) => tray.id), authorizedCount: 6,
      divertedCount: 0, enteredPurgeCount: 0, authorizedAtSec: this.timeSec,
      completedAtSec: null, status: 'ACTIVE',
    }
    for (const tray of selected) tray.purgeMember = true
  }

  private processReturnBoundaries() {
    if (!this.returnEnabled) return
    const xOpen = !this.zonedOccupancy('X')[0]
    const eReady = this.zonedOccupancy('E')[ZONE_COUNTS.E - 1]
    const purgeReady = this.zonedOccupancy('PURGE')[ZONE_COUNTS.PURGE - 1]
    if (xOpen && eReady) {
      this.moveToZonedEntrance(eReady, 'X')
      this.returnMergeCounts.eToXFull += 1
    } else if (xOpen && purgeReady) {
      this.moveToZonedEntrance(purgeReady, 'X')
      this.returnMergeCounts.purgeToXEmpty += 1
    } else if (!xOpen) {
      if (eReady) this.returnMergeCounts.blockedE += 1
      if (purgeReady) this.returnMergeCounts.blockedPurge += 1
    }

    const xFinal = this.zonedOccupancy('X')[ZONE_COUNTS.X - 1]
    this.sorterSelectedDestination = xFinal?.returnDestination ?? null
    this.sorterBlockedReason = null
    if (xFinal) {
      let destination = xFinal.returnDestination
      if (!destination) destination = this.selectReturnDestination()
      if (destination) {
        const direct = destination === 'C2'
        const destinationOpen = this.inboundEntranceOpen(destination)
        const pathOpen = direct ? destinationOpen : destinationOpen && !this.zonedOccupancy('S')[0]
        if (pathOpen) {
          xFinal.returnDestination = destination
          this.returnAssignments[destination][xFinal.loadState ?? 'EMPTY'] += 1
          if (direct) this.moveToInboundEntrance(xFinal, 'C2')
          else this.moveToZonedEntrance(xFinal, 'S')
          this.sorterCursor = RETURN_DESTINATIONS[(RETURN_DESTINATIONS.indexOf(destination) + 1) % RETURN_DESTINATIONS.length]
          this.sorterSelectedDestination = destination
        } else {
          this.sorterBlockedReason = direct ? 'C2_ENTRANCE_BLOCKED' : 'S_OR_DESTINATION_ENTRANCE_BLOCKED'
        }
      } else {
        this.sorterBlockedReason = 'NO_DESTINATION_AVAILABLE'
      }
    }

    const sFinal = this.zonedOccupancy('S')[ZONE_COUNTS.S - 1]
    if (sFinal?.returnDestination && this.inboundEntranceOpen(sFinal.returnDestination)) {
      this.moveToInboundEntrance(sFinal, sFinal.returnDestination)
    }
  }

  private selectReturnDestination(): ReturnDestination | undefined {
    const start = RETURN_DESTINATIONS.indexOf(this.sorterCursor)
    for (let offset = 0; offset < RETURN_DESTINATIONS.length; offset++) {
      const destination = RETURN_DESTINATIONS[(start + offset) % RETURN_DESTINATIONS.length]
      const destinationOpen = this.inboundEntranceOpen(destination)
      const pathOpen = destination === 'C2' ? destinationOpen : destinationOpen && !this.zonedOccupancy('S')[0]
      if (pathOpen) return destination
    }
    return undefined
  }

  private processExchangerSinks() {
    if (!this.returnEnabled) return
    if (this.asrsReturnRobotsEnabled) {
      this.dispatchInboundOnlyRobots()
      return
    }
    for (const destination of RETURN_DESTINATIONS) {
      const final = this.inboundFinalTray(destination)
      const times = this.exchangerAcceptanceTimes[destination]
      const last = times.at(-1) ?? -Infinity
      if (!final || this.timeSec < last + 8 - EPS) continue
      this.trays.splice(this.trays.indexOf(final), 1)
      times.push(this.timeSec)
      this.returnedHistory.push({ trayId: final.id, loadState: final.loadState ?? 'EMPTY', destination, acceptedAtSec: this.timeSec })
    }
  }

  private moveToZonedEntrance(tray: Tray, conveyorId: ZonedId) {
    tray.currentSegmentId = conveyorId
    tray.positionFt = ZONE_LENGTH_FT / 2
    tray.zonePlacement = { conveyorId, zoneIndex: 0 }
    tray.inboundPlacement = undefined
    tray.pilePlacement = undefined
    tray.pileRuntime = undefined
    tray.status = 'BLOCKED'
  }

  private processPiles(delta: number) {
    for (const [pileId, pile] of this.piles) {
      const cfg = pile.config
      const pre: (Tray | null)[] = Array(cfg.preDetrayerMdrCount).fill(null)
      const post: (Tray | null)[] = Array(cfg.postDetrayerMdrCount).fill(null)
      const down: (Tray | null)[] = Array(cfg.downstreamMdrCount).fill(null)
      const belt: Tray[] = []
      const refresh = () => {
        pre.fill(null); post.fill(null); down.fill(null); belt.length = 0
        for (const tray of this.trays) {
          const placement = tray.pilePlacement
          if (placement?.pileId !== pileId) continue
          if (placement.component === 'MDR_PRE_DETRAYER') pre[placement.zoneIndex ?? 0] = tray
          else if (placement.component === 'MDR_POST_DETRAYER') post[placement.zoneIndex ?? 0] = tray
          else if (placement.component === 'MDR_DOWNSTREAM') down[placement.zoneIndex ?? 0] = tray
          else belt.push(tray)
        }
      }
      refresh()

      // Complete MDR-to-MDR transfers first. The final post-detrayer zone is handled
      // later because entry onto a mechanically coupled belt is interlocked.
      for (const tray of this.trays) {
        if (tray.pilePlacement?.pileId !== pileId || !tray.pileRuntime?.transferRemainingSec) continue
        const placement = tray.pilePlacement
        const isBeltEntry = placement.component === 'MDR_POST_DETRAYER'
          && placement.zoneIndex === cfg.postDetrayerMdrCount - 1
        if (isBeltEntry) continue
        tray.pileRuntime.transferRemainingSec -= delta
        if (tray.pileRuntime.transferRemainingSec <= EPS) {
          if (placement.component === 'MDR_PRE_DETRAYER') {
            const index = placement.zoneIndex ?? 0
            const source = pileId[0] as SourceId
            if (index === cfg.preDetrayerMdrCount - 1) {
              if (tray.payloadOrigin === 'KORBER') throw new Error(`Körber payload tray ${tray.id} entered outbound detrayer ${source}`)
              placement.component = 'MDR_POST_DETRAYER'
              placement.zoneIndex = 0
              if (tray.payloadOrigin === 'CARTBUILD' && tray.cartbuildCartonAttached) {
                const laneId = laneFor(source)
                tray.loadState = 'EMPTY'
                tray.payloadOrigin = undefined
                tray.cartbuildCartonAttached = undefined
                this.cartons.push({ internalKey: ++this.cartonMarkerCounter, laneId, zoneIndex: 0 })
                const diagnostics = this.detrayerDiagnostics[source]
                diagnostics.splitCount += 1
                diagnostics.mostRecentSplitTime = this.timeSec
              }
            } else {
              placement.zoneIndex = index + 1
            }
          } else if (placement.component === 'MDR_POST_DETRAYER') {
            placement.zoneIndex = (placement.zoneIndex ?? 0) + 1
          } else if (placement.component === 'MDR_DOWNSTREAM') {
            placement.zoneIndex = (placement.zoneIndex ?? 0) + 1
          }
          tray.pileRuntime = undefined
        }
      }
      refresh()
      for (let index = cfg.downstreamMdrCount - 2; index >= 0; index--) {
        const source = down[index]
        if (source && !down[index + 1] && !source.pileRuntime) source.pileRuntime = { transferring: true, transferRemainingSec: ZONE_TRANSFER_SEC }
      }

      // Zone zero is the physical belt discharge destination. Its current,
      // rebuilt occupancy is the single authoritative interlock for this tick.
      const beltExitAvailable = down[0] === null
      const beltRunning = beltExitAvailable
      const beltBlockedReason = beltRunning ? null : 'DOWNSTREAM_MDR_ENTRANCE_OCCUPIED' as const
      const beltEntrancePositionFt = TRAY_LENGTH_FT / 2
      const beltDischargePositionFt = cfg.beltLengthFt - TRAY_LENGTH_FT / 2

      belt.sort((a, b) => (a.pilePlacement!.beltPosFt ?? 0) - (b.pilePlacement!.beltPosFt ?? 0))
      let leading = belt.at(-1)

      // A tray already at the discharge transfers before the shared belt
      // translation. Remaining belt trays still receive only this tick's delta.
      if (beltRunning && leading && (leading.pilePlacement!.beltPosFt ?? 0) >= beltDischargePositionFt - EPS) {
        leading.pilePlacement = { pileId, component: 'MDR_DOWNSTREAM', zoneIndex: 0 }
        belt.pop()
        down[0] = leading
        leading = belt.at(-1)
      }

      if (beltRunning && belt.length) {
        const requestedDelta = SPEED_FT_PER_SEC * delta
        const leadingPosition = leading!.pilePlacement!.beltPosFt ?? 0
        const sharedDelta = Math.max(0, Math.min(requestedDelta, beltDischargePositionFt - leadingPosition))
        for (const tray of belt) {
          tray.pilePlacement!.beltPosFt = (tray.pilePlacement!.beltPosFt ?? 0) + sharedDelta
          tray.status = 'MOVING'
        }
      } else {
        for (const tray of belt) tray.status = 'BLOCKED'
      }

      // Entry uses the same interlock decision and the post-transfer/post-motion
      // belt positions. A stopped tick never consumes an entry transfer timer.
      const nearestBelt = belt.length ? Math.min(...belt.map((tray) => tray.pilePlacement!.beltPosFt ?? 0)) : Infinity
      const postLast = post[cfg.postDetrayerMdrCount - 1]
      const entranceHasSpace = nearestBelt - beltEntrancePositionFt >= TRAY_LENGTH_FT - EPS
      if (beltRunning && postLast && entranceHasSpace) {
        if (!postLast.pileRuntime) {
          postLast.pileRuntime = { transferring: true, transferRemainingSec: ZONE_TRANSFER_SEC }
        } else {
          postLast.pileRuntime.transferRemainingSec = (postLast.pileRuntime.transferRemainingSec ?? ZONE_TRANSFER_SEC) - delta
          if (postLast.pileRuntime.transferRemainingSec <= EPS) {
            postLast.pilePlacement = { pileId, component: 'BELT', beltPosFt: beltEntrancePositionFt }
            postLast.pileRuntime = undefined
            belt.push(postLast)
            post[cfg.postDetrayerMdrCount - 1] = null
          }
        }
      }
      for (let index = cfg.postDetrayerMdrCount - 2; index >= 0; index--) {
        const source = post[index]
        if (source && !post[index + 1] && !source.pileRuntime) source.pileRuntime = { transferring: true, transferRemainingSec: ZONE_TRANSFER_SEC }
      }

      const preLastIndex = cfg.preDetrayerMdrCount - 1
      const detrayerTray = pre[preLastIndex]
      if (detrayerTray && !detrayerTray.pileRuntime) {
        const branch = pileId[0] as SourceId
        if (detrayerTray.payloadOrigin === 'KORBER') throw new Error(`Körber payload tray ${detrayerTray.id} entered outbound detrayer ${branch}`)
        const cartonEntranceOpen = !this.cartonOccupancy(laneFor(branch))[0]
        const canCross = !post[0] && (!detrayerTray.cartbuildCartonAttached || cartonEntranceOpen)
        if (canCross) detrayerTray.pileRuntime = { transferring: true, transferRemainingSec: ZONE_TRANSFER_SEC }
        else if (detrayerTray.cartbuildCartonAttached) {
          const diagnostics = this.detrayerDiagnostics[branch]
          diagnostics.blockedTicks += 1
          diagnostics.blockedDurationSec += delta
        }
      }
      for (let index = cfg.preDetrayerMdrCount - 2; index >= 0; index--) {
        const source = pre[index]
        if (!source || source.pileRuntime || pre[index + 1]) continue
        source.pileRuntime = { transferring: true, transferRemainingSec: ZONE_TRANSFER_SEC }
      }

      leading = belt.sort((a, b) => (a.pilePlacement!.beltPosFt ?? 0) - (b.pilePlacement!.beltPosFt ?? 0)).at(-1)
      this.beltDiagnostics.set(pileId, {
        pileId: pileId as BeltDiagnostic['pileId'], beltRunning, beltExitAvailable, beltBlockedReason,
        beltTrayCount: belt.length, leadingBeltTrayId: leading?.id ?? null,
        leadingBeltTrayPositionFt: leading?.pilePlacement?.beltPosFt ?? null,
      })
    }
  }

  private releasableTrayIds(source: SourceId): number[] {
    const pileId = `${source}1`
    const pile = this.piles.get(pileId)!
    const position = (tray: Tray) => {
      const placement = tray.pilePlacement!
      const preLength = pile.config.preDetrayerMdrCount * ZONE_LENGTH_FT
      const postLength = pile.config.postDetrayerMdrCount * ZONE_LENGTH_FT
      if (placement.component === 'MDR_PRE_DETRAYER') return (placement.zoneIndex ?? 0) * ZONE_LENGTH_FT
      if (placement.component === 'MDR_POST_DETRAYER') return preLength + (placement.zoneIndex ?? 0) * ZONE_LENGTH_FT
      if (placement.component === 'BELT') return preLength + postLength + (placement.beltPosFt ?? 0)
      return preLength + postLength + pile.config.beltLengthFt + (placement.zoneIndex ?? 0) * ZONE_LENGTH_FT
    }
    return this.trays.filter((tray) => tray.pilePlacement?.pileId === pileId).sort((a, b) => position(b) - position(a)).map((tray) => tray.id)
  }

  private lanePurgeDemand(source: SourceId, current = this.srsCurrentCounts()) {
    return current[`${source}1` as 'A1' | 'B1' | 'C1'] - SRS_TARGET_SIZES[`${source}1` as 'A1' | 'B1' | 'C1'] + this.pendingDemand(source)
  }

  private authorizeSlugIfPossible() {
    if (this.activeSlug) return
    const order: SourceId[] = ['A', 'B', 'C']
    const start = order.indexOf(this.slugCursor)
    const cyclic = Array.from({ length: 3 }, (_, index) => order[(start + index) % 3])
    const current = this.srsCurrentCounts()
    const dAvailable = this.isDEntranceAvailable()
    const eligible = cyclic.filter((source) => this.releasableTrayIds(source).length > 0 && (dAvailable || this.lanePurgeDemand(source, current) > 0))
    if (!eligible.length) return
    const highestPositive = Math.max(0, ...eligible.map((source) => this.lanePurgeDemand(source, current)))
    let source: SourceId | undefined
    if (highestPositive > 0) source = cyclic.find((candidate) => eligible.includes(candidate) && this.lanePurgeDemand(candidate, current) === highestPositive)
    if (!source) {
      const physicallyFull = eligible.filter((candidate) => {
        const capacity = this.segments.find((segment) => segment.id === `${candidate}1`)?.maxOccupancy ?? 0
        return current[`${candidate}1` as 'A1' | 'B1' | 'C1'] >= capacity
      })
      source = cyclic.find((candidate) => physicallyFull.includes(candidate)) ?? cyclic.find((candidate) => eligible.includes(candidate))
    }
    if (!source) return
    const available = this.releasableTrayIds(source)
    const purgeDemand = this.lanePurgeDemand(source, current)
    const authorizedCount = purgeDemand > 0 ? Math.min(8, purgeDemand, available.length) : Math.min(8, available.length)
    const authorizedTrayIds = available.slice(0, authorizedCount)
    this.activeSlug = {
      source,
      authorizedCount: authorizedTrayIds.length,
      releasedCount: 0,
      authorizedTrayIds,
      enteredTCount: 0,
      finalAuthorizedTrayId: authorizedTrayIds[authorizedTrayIds.length - 1],
      authorizedAtSec: this.timeSec,
      completedAtSec: null,
      status: 'ACTIVE',
    }
  }

  private releaseActivePileTray() {
    const slug = this.activeSlug
    if (!slug || slug.releasedCount >= slug.authorizedCount) return
    const pileId = `${slug.source}1`
    const finalZone = this.piles.get(pileId)!.config.downstreamMdrCount - 1
    const tray = this.trays.find((candidate) => candidate.pilePlacement?.pileId === pileId && candidate.pilePlacement.component === 'MDR_DOWNSTREAM' && candidate.pilePlacement.zoneIndex === finalZone)
    if (!tray || !slug.authorizedTrayIds.includes(tray.id)) return
    const destination: ZonedId = slug.source === 'C' ? 'T' : 'PRE_T'
    if (this.zonedOccupancy(destination)[0]) return
    this.moveToZonedEntrance(tray, destination)
    slug.releasedCount += 1
    this.cumulativeTransfers[slug.source] += 1
    if (destination === 'T') this.recordEnteredT(tray)
  }

  private recordEnteredT(tray: Tray) {
    const slug = this.activeSlug
    if (!slug || !slug.authorizedTrayIds.includes(tray.id)) return
    slug.enteredTCount += 1
    if (tray.id === slug.finalAuthorizedTrayId) {
      slug.status = 'COMPLETE'
      slug.completedAtSec = this.timeSec
      this.lastCompletedSlug = { ...slug, authorizedTrayIds: [...slug.authorizedTrayIds] }
      this.slugCursor = slug.source === 'A' ? 'B' : slug.source === 'B' ? 'C' : 'A'
      this.activeSlug = null
    }
  }

  private processKorber() {
    if (this.returnEnabled) {
      const held = this.trays.find((tray) => tray.korberHeld)
      if (held) {
        if (!this.zonedOccupancy('E')[0]) {
          held.korberHeld = false
          this.moveToZonedEntrance(held, 'E')
          this.nextConsumptionTime = this.timeSec + KORBER_INTERVAL_SEC
        }
        return
      }
      if (!this.operatingSettings.korberEnabled) return
      if (this.timeSec + EPS < this.nextConsumptionTime) return
      const finalTray = this.zonedOccupancy('D')[ZONE_COUNTS.D - 1]
      if (!finalTray) {
        this.korberStarved = true
        return
      }
      finalTray.zonePlacement = undefined
      finalTray.pileRuntime = undefined
      finalTray.korberHeld = true
      finalTray.loadState = 'FULL'
      finalTray.payloadOrigin = 'KORBER'
      finalTray.status = 'BLOCKED'
      this.korberProcessedCount += 1
      this.korberStarved = false
      return
    }
    const finalTray = this.zonedOccupancy('D')[ZONE_COUNTS.D - 1]
    const due = this.timeSec + EPS >= this.nextConsumptionTime
    if (!due && !this.korberStarved) return
    if (!finalTray) {
      if (due) this.korberStarved = true
      return
    }
    const wasStarved = this.korberStarved
    this.trays.splice(this.trays.indexOf(finalTray), 1)
    this.consumedCount += 1
    this.lastConsumedTrayId = finalTray.id
    this.korberStarved = false
    this.nextConsumptionTime = wasStarved
      ? this.timeSec + KORBER_INTERVAL_SEC
      : this.nextConsumptionTime + KORBER_INTERVAL_SEC
  }

  private srsCurrentCounts(): Record<SrsPileId, number> {
    const pileCount = (source: SourceId) => this.trays.filter((tray) => tray.pilePlacement?.pileId === `${source}1`).length
    const zonedCount = (conveyorId: 'T' | 'D') => this.trays.filter((tray) => tray.zonePlacement?.conveyorId === conveyorId).length
    const inboundCount = (conveyorId: ReturnDestination) => this.trays.filter((tray) => tray.inboundPlacement?.conveyorId === conveyorId).length
    return {
      A1: pileCount('A'), B1: pileCount('B'), C1: pileCount('C'),
      T: zonedCount('T'), D: zonedCount('D'), A2: inboundCount('A2'), B2: inboundCount('B2'), C2: inboundCount('C2'),
    }
  }

  private pendingDemand(source: SourceId) {
    return this.missions.filter((mission) => mission.assignedExchanger === source && mission.state !== 'RELEASED').length
  }

  private positiveAvailability(pile: SrsPileId, current = this.srsCurrentCounts()) {
    return Math.max(0, SRS_TARGET_SIZES[pile] - current[pile])
  }

  private laneMissionCapacity(source: SourceId, current = this.srsCurrentCounts()) {
    const local = this.positiveAvailability(`${source}1` as SrsPileId, current)
    const returnPile = `${source}2` as 'A2' | 'B2' | 'C2'
    const downstream = this.positiveAvailability('T', current) + this.positiveAvailability('D', current) + this.positiveAvailability(returnPile, current)
    return Math.max(0, local + downstream - this.pendingDemand(source))
  }

  private cartbuildReservation(source: SourceId) {
    const laneId = laneFor(source)
    const pendingMissionReservations = this.missions.filter((mission) =>
      mission.assignedExchanger === source && mission.missionType === 'CARTBUILD' && mission.state !== 'RELEASED'
    ).length
    const attachedTrayReservations = this.trays.filter((tray) =>
      tray.originSourceId === source && tray.payloadOrigin === 'CARTBUILD' && tray.cartbuildCartonAttached
    ).length
    const physicalLaneOccupancy = this.cartons.filter((carton) => carton.laneId === laneId).length
    const committedPositions = pendingMissionReservations + attachedTrayReservations + physicalLaneOccupancy
    return {
      positionCapacity: CARTBUILD_ZONE_COUNT,
      pendingMissionReservations,
      attachedTrayReservations,
      physicalLaneOccupancy,
      committedPositions,
      availablePositions: Math.max(0, CARTBUILD_ZONE_COUNT - committedPositions),
    }
  }

  private dispatchInboundOnlyRobots() {
    for (const destination of RETURN_DESTINATIONS) {
      const source = destination[0] as SourceId
      const tray = this.inboundFinalTray(destination)
      if (!tray || this.inboundReservations.has(tray.id)) continue
      const station = this.exchangerStations[source]
      const outboundCanService = station.dropRobotKind === 'OUTBOUND'
        || station.shiftingRobotKind === 'OUTBOUND'
        || this.missions.some((mission) => mission.assignedExchanger === source && mission.state === 'READY_AT_EXCHANGER')
      if (outboundCanService) continue
      const mission: InboundMission = {
        missionId: ++this.missionCounter,
        robotId: ++this.robotCounter,
        assignedExchanger: source,
        reservedTrayId: tray.id,
        reservedLoadState: tray.loadState ?? 'EMPTY',
        assignedAtSec: this.timeSec,
        maturityTimeSec: this.timeSec + 180,
        robotState: 'TRAVELING_TO_DROP',
        cancelledAfterAdmission: false,
        historyRecorded: false,
      }
      this.inboundMissions.push(mission)
      this.inboundReservations.set(tray.id, mission.missionId)
    }
  }

  private missionTypeFor(source: SourceId): MissionType | undefined {
    if (this.cartbuildAvailable && this.operatingSettings[settingFor(source)] && this.cartbuildReservation(source).availablePositions > 0) return 'CARTBUILD'
    if (this.operatingSettings.korberEnabled) return 'EMPTY'
    return undefined
  }

  private createRobotPayload(source: SourceId, missionType: MissionType) {
    const isCartbuild = missionType === 'CARTBUILD'
    const tray: Tray = {
      id: ++this.totalTraysCreated,
      currentSegmentId: 'ASRS_ROBOT',
      positionFt: 0,
      status: 'BLOCKED',
      createdAtSec: this.timeSec,
      originSourceId: source,
      loadState: isCartbuild ? 'FULL' : 'EMPTY',
      payloadOrigin: isCartbuild ? 'CARTBUILD' : undefined,
      cartbuildCartonAttached: isCartbuild || undefined,
    }
    if (isCartbuild) this.cartonIntroduced[source] += 1
    return tray
  }

  private attachRobotToMission(mission: OutboundMission) {
    if (mission.robotId !== undefined && mission.robotPayload) return mission
    const payload = this.createRobotPayload(mission.assignedExchanger, mission.missionType)
    mission.robotId = ++this.robotCounter
    mission.robotState = mission.state === 'RETRIEVING' ? 'TRAVELING_OUTBOUND' : 'QUEUED_FOR_DROP'
    mission.robotPayload = payload
    mission.payloadTrayId = payload.id
    mission.payloadLoadState = payload.loadState ?? 'EMPTY'
    mission.payloadCartbuildCartonAttached = Boolean(payload.cartbuildCartonAttached)
    mission.robotBlockedReason = null
    mission.robotBlockedDurationSec = 0
    return mission
  }

  private planPendingDemandIfDue() {
    while (this.timeSec + EPS >= this.nextPlanningTime) {
      this.planPendingDemand()
      this.nextPlanningTime += this.planningCadenceSec
    }
  }

  private planPendingDemand() {
    const sources: SourceId[] = ['A', 'B', 'C']
    while (true) {
      const current = this.srsCurrentCounts()
      const globalCurrent = Object.values(current).reduce((sum, count) => sum + count, 0)
      const globalPending = sources.reduce((sum, source) => sum + this.pendingDemand(source), 0)
      if (Math.max(0, SRS_GLOBAL_TARGET - globalCurrent - globalPending) <= 0) return
      const start = sources.indexOf(this.asrsNextAssign)
      let selected: SourceId | undefined
      let missionType: MissionType | undefined
      for (let offset = 0; offset < sources.length; offset++) {
        const source = sources[(start + offset) % sources.length]
        const type = this.missionTypeFor(source)
        if (type && this.laneMissionCapacity(source, current) > 0) {
          selected = source
          missionType = type
          break
        }
      }
      if (!selected || !missionType) return
      const mission: OutboundMission = {
        missionId: ++this.missionCounter, assignedExchanger: selected, missionType,
        createdAtSec: this.timeSec, readyAtSec: this.timeSec + 180, state: 'RETRIEVING',
      }
      this.attachRobotToMission(mission)
      this.missions.push(mission)
      this.asrsAssigned[selected] += 1
      this.asrsNextAssign = selected === 'A' ? 'B' : selected === 'B' ? 'C' : 'A'
    }
  }

  private matureMissions() {
    for (const mission of this.missions) {
      if (mission.state !== 'RETRIEVING' || this.timeSec + EPS < mission.readyAtSec) continue
      mission.state = 'READY_AT_EXCHANGER'
      mission.robotState = 'QUEUED_FOR_DROP'
      mission.queueEntryTimeSec = mission.readyAtSec
    }
    for (const mission of this.inboundMissions) {
      if (mission.robotState !== 'TRAVELING_TO_DROP' || this.timeSec + EPS < mission.maturityTimeSec) continue
      mission.robotState = 'QUEUED_FOR_DROP'
      mission.queueEntryTimeSec = mission.maturityTimeSec
    }
  }

  private maturedQueue(source: SourceId) {
    const dropMissionId = this.exchangerStations[source].dropMissionId
    return this.missions
      .filter((mission) => mission.assignedExchanger === source && mission.state === 'READY_AT_EXCHANGER' && mission.missionId !== dropMissionId)
      .sort((a, b) => Number(a.missionType === 'EMPTY') - Number(b.missionType === 'EMPTY') || a.createdAtSec - b.createdAtSec || a.missionId - b.missionId)
  }

  private exchangerQueue(source: SourceId): QueuedRobot[] {
    const station = this.exchangerStations[source]
    const outbound: QueuedRobot[] = this.maturedQueue(source).map((mission) => ({ kind: 'OUTBOUND', mission }))
    const inbound: QueuedRobot[] = this.inboundMissions
      .filter((mission) => mission.assignedExchanger === source
        && (mission.robotState === 'QUEUED_FOR_DROP' || mission.robotState === 'HEAD_OF_DROP_QUEUE')
        && mission.missionId !== station.dropMissionId)
      .sort((a, b) => (a.queueEntryTimeSec ?? a.maturityTimeSec) - (b.queueEntryTimeSec ?? b.maturityTimeSec) || a.missionId - b.missionId)
      .map((mission) => ({ kind: 'INBOUND_ONLY', mission }))
    return [...outbound, ...inbound]
  }

  private currentDropBlockedDuration(mission: OutboundMission) {
    return (mission.robotBlockedDurationSec ?? 0) + (mission.robotBlockedSinceSec === undefined ? 0 : Math.max(0, this.timeSec - mission.robotBlockedSinceSec))
  }

  private completeDropBlock(mission: OutboundMission) {
    mission.robotBlockedDurationSec = this.currentDropBlockedDuration(mission)
    mission.robotBlockedSinceSec = undefined
    mission.robotBlockedReason = null
  }

  private takeInboundTray(source: SourceId, reservedTrayId?: number): Tray | undefined {
    const destination = `${source}2` as ReturnDestination
    const tray = this.inboundFinalTray(destination)
    if (!tray || (reservedTrayId !== undefined && tray.id !== reservedTrayId)) return undefined
    const index = this.trays.indexOf(tray)
    if (index < 0) return undefined
    this.trays.splice(index, 1)
    tray.currentSegmentId = `ASRS_RETURN_${source}`
    tray.positionFt = 0
    tray.status = 'MOVING'
    tray.zonePlacement = undefined
    tray.inboundPlacement = undefined
    tray.pilePlacement = undefined
    tray.pileRuntime = undefined
    return tray
  }

  private recordCompletedCycle(source: SourceId, cycle: CompletedOutboundCycle) {
    this.exchangerStations[source].completedCycles.push(cycle)
  }

  private cancelInboundReservation(trayId: number, atSec = this.timeSec) {
    const inboundMissionId = this.inboundReservations.get(trayId)
    if (inboundMissionId === undefined) return
    const mission = this.inboundMissions.find((candidate) => candidate.missionId === inboundMissionId)
    this.inboundReservations.delete(trayId)
    if (!mission || mission.robotState === 'CANCELLED' || mission.robotState === 'INBOUND_COMPLETE') return
    mission.cancellationTimeSec = atSec
    mission.cancellationReason = 'CLAIMED_BY_OUTBOUND_ROBOT'
    mission.cancelledAfterAdmission = mission.robotState === 'AT_DROP' || mission.robotState === 'SHIFTING_TO_TAKE'
    if (mission.cancelledAfterAdmission) return
    mission.robotState = 'CANCELLED'
    if (!mission.historyRecorded) {
      this.recordCompletedCycle(mission.assignedExchanger, {
        robotId: mission.robotId, missionId: mission.missionId, missionType: 'INBOUND_ONLY', exchanger: mission.assignedExchanger,
        payloadTrayId: null, payloadLoadState: null, assignmentTimeSec: mission.assignedAtSec, maturityTimeSec: mission.maturityTimeSec,
        queueEntryTimeSec: mission.queueEntryTimeSec ?? mission.maturityTimeSec, dropEntryTimeSec: mission.dropEntryTimeSec ?? mission.cancellationTimeSec,
        successfulDropTimeSec: null, takeArrivalTimeSec: mission.cancellationTimeSec, totalDropBlockedDurationSec: 0,
        cycleType: 'CANCELLED_INBOUND_ONLY', inboundTrayId: null, inboundTrayLoadState: null, takePickupTimeSec: null,
        returnStartedAtSec: mission.cancellationTimeSec, rackArrivalTimeSec: mission.cancellationTimeSec,
        cancellationTimeSec: mission.cancellationTimeSec, cancellationReason: mission.cancellationReason, cancelledAfterAdmission: false,
      })
      mission.historyRecorded = true
    }
  }

  private completeRobotShift(source: SourceId) {
    const station = this.exchangerStations[source]
    if (station.shiftingMissionId === null || station.shiftStartedAtSec === null || this.timeSec + EPS < station.shiftStartedAtSec + 1) return
    const takeTime = station.shiftStartedAtSec + 1
    if (station.shiftingRobotKind === 'OUTBOUND') {
      const mission = this.missions.find(({ missionId }) => missionId === station.shiftingMissionId)!
      const candidate = this.inboundFinalTray(`${source}2` as ReturnDestination)
      if (candidate) this.cancelInboundReservation(candidate.id, takeTime)
      const tray = this.takeInboundTray(source)
      mission.takeArrivalTimeSec = takeTime
      mission.takePickupTimeSec = tray ? takeTime : undefined
      mission.inboundPayload = tray
      mission.inboundTrayId = tray?.id
      mission.inboundTrayLoadState = tray?.loadState ?? undefined
      mission.cycleType = tray ? 'DUAL_CYCLE' : 'OUTBOUND_ONLY'
      mission.returnStartedAtSec = takeTime
      mission.rackArrivalTimeSec = takeTime + 10
      mission.robotState = 'RETURNING_TO_RACK'
    } else {
      const mission = this.inboundMissions.find(({ missionId }) => missionId === station.shiftingMissionId)!
      const tray = mission.cancellationTimeSec === undefined ? this.takeInboundTray(source, mission.reservedTrayId) : undefined
      this.inboundReservations.delete(mission.reservedTrayId)
      mission.takeArrivalTimeSec = takeTime
      mission.takePickupTimeSec = tray ? takeTime : undefined
      mission.inboundPayload = tray
      mission.returnStartedAtSec = takeTime
      mission.rackArrivalTimeSec = takeTime + 10
      mission.robotState = 'RETURNING_TO_RACK'
    }
    station.shiftingMissionId = null
    station.shiftingRobotKind = null
    station.shiftStartedAtSec = null
  }

  private processRobotReturns() {
    for (const mission of this.missions) {
      if (mission.robotState !== 'RETURNING_TO_RACK' || mission.rackArrivalTimeSec === undefined || this.timeSec + EPS < mission.rackArrivalTimeSec) continue
      const tray = mission.inboundPayload
      if (tray) {
        this.returnedHistory.push({ trayId: tray.id, loadState: tray.loadState ?? 'EMPTY', destination: `${mission.assignedExchanger}2`, acceptedAtSec: mission.rackArrivalTimeSec, payloadOrigin: tray.payloadOrigin, cartbuildCartonAttached: tray.cartbuildCartonAttached })
        this.exchangerAcceptanceTimes[`${mission.assignedExchanger}2`].push(mission.rackArrivalTimeSec)
      }
      mission.inboundPayload = undefined
      mission.robotState = 'OUTBOUND_COMPLETE'
      this.recordCompletedCycle(mission.assignedExchanger, {
        robotId: mission.robotId!, missionId: mission.missionId, missionType: mission.missionType, exchanger: mission.assignedExchanger,
        payloadTrayId: mission.payloadTrayId!, payloadLoadState: mission.payloadLoadState!, assignmentTimeSec: mission.createdAtSec,
        maturityTimeSec: mission.readyAtSec, queueEntryTimeSec: mission.queueEntryTimeSec ?? mission.readyAtSec,
        dropEntryTimeSec: mission.dropEntryTimeSec!, successfulDropTimeSec: mission.successfulDropTimeSec!,
        takeArrivalTimeSec: mission.takeArrivalTimeSec!, totalDropBlockedDurationSec: mission.robotBlockedDurationSec ?? 0,
        cycleType: mission.cycleType ?? 'OUTBOUND_ONLY', inboundTrayId: mission.inboundTrayId ?? null,
        inboundTrayLoadState: mission.inboundTrayLoadState ?? null, takePickupTimeSec: mission.takePickupTimeSec ?? null,
        returnStartedAtSec: mission.returnStartedAtSec!, rackArrivalTimeSec: mission.rackArrivalTimeSec,
        cancellationTimeSec: null, cancellationReason: null, cancelledAfterAdmission: false,
      })
    }
    for (const mission of this.inboundMissions) {
      if (mission.robotState !== 'RETURNING_TO_RACK' || mission.rackArrivalTimeSec === undefined || this.timeSec + EPS < mission.rackArrivalTimeSec) continue
      const tray = mission.inboundPayload
      if (tray) {
        this.returnedHistory.push({ trayId: tray.id, loadState: tray.loadState ?? 'EMPTY', destination: `${mission.assignedExchanger}2`, acceptedAtSec: mission.rackArrivalTimeSec, payloadOrigin: tray.payloadOrigin, cartbuildCartonAttached: tray.cartbuildCartonAttached })
        this.exchangerAcceptanceTimes[`${mission.assignedExchanger}2`].push(mission.rackArrivalTimeSec)
      }
      mission.inboundPayload = undefined
      mission.robotState = 'INBOUND_COMPLETE'
      if (!mission.historyRecorded) {
        this.recordCompletedCycle(mission.assignedExchanger, {
          robotId: mission.robotId, missionId: mission.missionId, missionType: 'INBOUND_ONLY', exchanger: mission.assignedExchanger,
          payloadTrayId: null, payloadLoadState: null, assignmentTimeSec: mission.assignedAtSec, maturityTimeSec: mission.maturityTimeSec,
          queueEntryTimeSec: mission.queueEntryTimeSec ?? mission.maturityTimeSec, dropEntryTimeSec: mission.dropEntryTimeSec!,
          successfulDropTimeSec: mission.successfulDropTimeSec ?? null, takeArrivalTimeSec: mission.takeArrivalTimeSec!, totalDropBlockedDurationSec: 0,
          cycleType: mission.cancellationTimeSec === undefined ? 'INBOUND_ONLY' : 'CANCELLED_INBOUND_ONLY',
          inboundTrayId: tray?.id ?? null, inboundTrayLoadState: tray?.loadState ?? null, takePickupTimeSec: mission.takePickupTimeSec ?? null,
          returnStartedAtSec: mission.returnStartedAtSec!, rackArrivalTimeSec: mission.rackArrivalTimeSec,
          cancellationTimeSec: mission.cancellationTimeSec ?? null, cancellationReason: mission.cancellationReason ?? null,
          cancelledAfterAdmission: mission.cancelledAfterAdmission,
        })
        mission.historyRecorded = true
      }
    }
  }

  private dropRobotPayload(mission: OutboundMission, source: SourceId) {
    const station = this.exchangerStations[source]
    const robot = this.attachRobotToMission(mission)
    const tray = robot.robotPayload!
    tray.currentSegmentId = `${source}1`
    tray.positionFt = ZONE_LENGTH_FT / 2
    tray.status = 'BLOCKED'
    tray.pilePlacement = { pileId: `${source}1`, component: 'MDR_PRE_DETRAYER', zoneIndex: 0 }
    this.trays.push(tray)
    robot.robotPayload = undefined
    this.completeDropBlock(robot)
    robot.robotState = 'SHIFTING_TO_TAKE'
    robot.successfulDropTimeSec = this.timeSec
    mission.state = 'RELEASED'
    this.recordOutboundRelease(source, tray, mission.missionType === 'CARTBUILD' ? 'LOADED' : 'EMPTY')
    station.dropMissionId = null
    station.dropRobotKind = null
    station.shiftingMissionId = mission.missionId
    station.shiftingRobotKind = 'OUTBOUND'
    station.shiftStartedAtSec = this.timeSec
    const remainingQueue = this.exchangerQueue(source)
    station.queueAdvanceStartedAtSec = remainingQueue.length ? this.timeSec : null
    station.queueAdvanceRobotIds = remainingQueue.map(({ mission: queuedMission }) => queuedMission.robotId!)
  }

  private blockRobot(mission: OutboundMission, reason: OutboundRobotBlockedReason) {
    if (mission.robotBlockedSinceSec === undefined) mission.robotBlockedSinceSec = this.timeSec
    mission.robotState = 'BLOCKED_FROM_DROP'
    mission.robotBlockedReason = reason
  }

  private attemptExchangerReleases() {
    for (const source of ['A', 'B', 'C'] as SourceId[]) this.completeRobotShift(source)
    this.processRobotReturns()
    for (const source of ['A', 'B', 'C'] as SourceId[]) {
      const station = this.exchangerStations[source]
      const pileId = `${source}1`
      const occupied = this.trays.some((tray) => tray.pilePlacement?.pileId === pileId && tray.pilePlacement.component === 'MDR_PRE_DETRAYER' && tray.pilePlacement.zoneIndex === 0)
      const diagnostics = this.outboundDiagnostics[source]
      const queue = this.exchangerQueue(source)
      station.maximumObservedQueueLength = Math.max(station.maximumObservedQueueLength, queue.length)
      for (const [index, entry] of queue.entries()) {
        entry.mission.robotState = index === 0 ? 'HEAD_OF_DROP_QUEUE' : 'QUEUED_FOR_DROP'
        if (entry.kind === 'OUTBOUND') entry.mission.robotBlockedReason = null
      }
      if (station.dropMissionId === null && this.timeSec - this.asrsLastRelease[source] >= CARTBUILD_INTERVAL_SEC - EPS && queue.length) {
        const selected = queue[0]
        station.dropMissionId = selected.mission.missionId
        station.dropRobotKind = selected.kind
        selected.mission.dropEntryTimeSec = this.timeSec
        selected.mission.robotState = 'AT_DROP'
      }
      if (station.dropMissionId === null) continue
      if (station.dropRobotKind === 'INBOUND_ONLY') {
        const inbound = this.inboundMissions.find(({ missionId }) => missionId === station.dropMissionId)!
        inbound.successfulDropTimeSec = this.timeSec
        inbound.robotState = 'SHIFTING_TO_TAKE'
        this.asrsLastRelease[source] = this.timeSec
        station.dropMissionId = null
        station.dropRobotKind = null
        station.shiftingMissionId = inbound.missionId
        station.shiftingRobotKind = 'INBOUND_ONLY'
        station.shiftStartedAtSec = this.timeSec
        const remainingQueue = this.exchangerQueue(source)
        station.queueAdvanceStartedAtSec = remainingQueue.length ? this.timeSec : null
        station.queueAdvanceRobotIds = remainingQueue.map(({ mission }) => mission.robotId!)
        continue
      }
      const dropMission = this.missions.find(({ missionId }) => missionId === station.dropMissionId)!
      if (occupied) {
        if (dropMission.missionType === 'CARTBUILD') diagnostics.blockedLoadedAttempts += 1
        else diagnostics.blockedEmptyAttempts += 1
        this.blockRobot(dropMission, 'PILE_ENTRANCE_OCCUPIED')
        continue
      }
      this.dropRobotPayload(dropMission, source)
    }
  }

  private recordOutboundRelease(source: SourceId, tray: Tray, type: 'LOADED' | 'EMPTY') {
    this.asrsLastRelease[source] = this.timeSec
    const diagnostics = this.outboundDiagnostics[source]
    if (type === 'LOADED') diagnostics.loadedReleases += 1
    else diagnostics.emptyReleases += 1
    diagnostics.mostRecentReleaseType = type
    diagnostics.releaseTimes.push({ timeSec: this.timeSec, type, trayId: tray.id })
    this.sources.find((entry) => entry.id === source)!.totalTraysCreated += 1
  }

  private isDEntranceAvailable() {
    return !this.zonedOccupancy('D')[0]
  }

  getState(): SimulationStateWithProgress {
    const pending = (source: SourceId) => this.missions.filter((mission) => mission.assignedExchanger === source && mission.state !== 'RELEASED').length
    const retrieving = (source: SourceId) => this.missions.filter((mission) => mission.assignedExchanger === source && mission.state === 'RETRIEVING').length
    const ready = (source: SourceId) => this.missions.filter((mission) => mission.assignedExchanger === source && mission.state === 'READY_AT_EXCHANGER').length
    const pileCount = (source: SourceId, component: Tray['pilePlacement'] extends infer _ ? string : never) => this.trays.filter((tray) => tray.pilePlacement?.pileId === `${source}1` && tray.pilePlacement.component === component).length
    const robotCarriedTrayCount = this.missions.filter((mission) => Boolean(mission.robotPayload)).length
      + this.missions.filter((mission) => Boolean(mission.inboundPayload)).length
      + this.inboundMissions.filter((mission) => Boolean(mission.inboundPayload)).length
    const physical = this.trays.length + robotCarriedTrayCount
    const mergeState: MergeState = {
      nextPriority: this.slugCursor,
      eligibleA: this.activeSlug?.source === 'A', eligibleB: this.activeSlug?.source === 'B', eligibleC: this.activeSlug?.source === 'C',
      selectedSource: this.activeSlug?.source ?? 'NONE',
      cumulativeTransfersA: this.cumulativeTransfers.A, cumulativeTransfersB: this.cumulativeTransfers.B, cumulativeTransfersC: this.cumulativeTransfers.C,
    }
    const dFinal = Boolean(this.zonedOccupancy('D')[ZONE_COUNTS.D - 1])
    const segmentStats = this.segments.map((segment) => ({ id: segment.id, occupancy: this.trays.filter((tray) => tray.currentSegmentId === segment.id).length, capacity: segment.maxOccupancy, occupancyPct: segment.maxOccupancy ? this.trays.filter((tray) => tray.currentSegmentId === segment.id).length / segment.maxOccupancy * 100 : undefined }))
    const beltDiagnostic = (pileId: BeltDiagnostic['pileId']): BeltDiagnostic => this.beltDiagnostics.get(pileId) ?? (() => {
      const belt = this.trays.filter((tray) => tray.pilePlacement?.pileId === pileId && tray.pilePlacement.component === 'BELT')
        .sort((a, b) => (a.pilePlacement!.beltPosFt ?? 0) - (b.pilePlacement!.beltPosFt ?? 0))
      const exitAvailable = !this.trays.some((tray) => tray.pilePlacement?.pileId === pileId && tray.pilePlacement.component === 'MDR_DOWNSTREAM' && tray.pilePlacement.zoneIndex === 0)
      const leading = belt.at(-1)
      return { pileId, beltRunning: exitAvailable, beltExitAvailable: exitAvailable, beltBlockedReason: exitAvailable ? null : 'DOWNSTREAM_MDR_ENTRANCE_OCCUPIED', beltTrayCount: belt.length, leadingBeltTrayId: leading?.id ?? null, leadingBeltTrayPositionFt: leading?.pilePlacement?.beltPosFt ?? null }
    })()
    const beltDiagnostics = (['A1', 'B1', 'C1'] as const).map(beltDiagnostic)
    const returnAvailability = Object.fromEntries(RETURN_DESTINATIONS.map((destination) => [destination, this.inboundEntranceOpen(destination)])) as Record<ReturnDestination, boolean>
    const sHead = this.returnEnabled ? this.zonedOccupancy('S')[ZONE_COUNTS.S - 1] : null
    const returnConveyorOccupancy = Object.fromEntries(RETURN_IDS.map((id) => [id, this.returnEnabled
      ? (RETURN_DESTINATIONS.includes(id as ReturnDestination)
          ? this.trays.filter((tray) => tray.inboundPlacement?.conveyorId === id).length
          : this.zonedOccupancy(id as ZonedId).filter(Boolean).length)
      : 0])) as Record<(typeof RETURN_IDS)[number], number>
    const returnedToAsrsCount = this.returnedHistory.length
    const materialSinkCount = this.returnEnabled ? returnedToAsrsCount : this.consumedCount
    const cartonAttached = this.trays.filter((tray) => tray.payloadOrigin === 'CARTBUILD' && tray.cartbuildCartonAttached).length
      + this.missions.filter((mission) => mission.robotPayload?.payloadOrigin === 'CARTBUILD' && mission.robotPayload.cartbuildCartonAttached).length
      + this.missions.filter((mission) => mission.inboundPayload?.payloadOrigin === 'CARTBUILD' && mission.inboundPayload.cartbuildCartonAttached).length
      + this.inboundMissions.filter((mission) => mission.inboundPayload?.payloadOrigin === 'CARTBUILD' && mission.inboundPayload.cartbuildCartonAttached).length
    const cartonOnConveyors = this.cartons.length
    const cartonConsumed = (['A', 'B', 'C'] as SourceId[]).reduce((sum, source) => sum + this.operatorConsumptionTimes[source].length, 0)
    const cartonIntroduced = this.cartonIntroduced.A + this.cartonIntroduced.B + this.cartonIntroduced.C
    const cartbuildLanes = Object.fromEntries((['A', 'B', 'C'] as SourceId[]).map((source) => {
      const id = laneFor(source)
      const markers = this.cartons.filter((carton) => carton.laneId === id).map((carton) => ({ ...carton }))
      const times = this.operatorConsumptionTimes[source]
      const last = times.at(-1) ?? null
      const reservation = this.cartbuildReservation(source)
      return [id, {
        id, enabled: this.cartbuildAvailable && this.operatingSettings[settingFor(source)], lengthFt: 75, zoneCount: CARTBUILD_ZONE_COUNT,
        ...reservation,
        speedFtPerMin: 120, zoneTransferSec: ZONE_TRANSFER_SEC, markers, occupancy: markers.length,
        introducedCount: this.cartonIntroduced[source], operatorConsumedCount: times.length, operatorConsumptionTimes: [...times],
        finalZoneOccupied: markers.some((carton) => carton.zoneIndex === CARTBUILD_ZONE_COUNT - 1),
        nextEligibleConsumptionTime: last === null ? this.timeSec : last + CARTBUILD_INTERVAL_SEC,
        lastConsumedTime: last, configuredRatePerHour: 450,
      }]
    })) as SimulationStateWithProgress['cartbuildSystem']['lanes']
    const exchangerDiagnostics = Object.fromEntries((['A', 'B', 'C'] as SourceId[]).map((source) => {
      const diagnostics = this.outboundDiagnostics[source]
      const last = diagnostics.releaseTimes.at(-1)?.timeSec ?? null
      return [source, {
        source, cartbuildEnabled: this.cartbuildAvailable && this.operatingSettings[settingFor(source)], lastActualReleaseTime: last,
        nextEligibleReleaseTime: this.asrsLastRelease[source] < -1e8 ? this.timeSec : this.asrsLastRelease[source] + CARTBUILD_INTERVAL_SEC,
        loadedReleases: diagnostics.loadedReleases, emptyReleases: diagnostics.emptyReleases,
        blockedLoadedAttempts: diagnostics.blockedLoadedAttempts, blockedEmptyAttempts: diagnostics.blockedEmptyAttempts,
        pendingEmptyMissions: pending(source), mostRecentReleaseType: diagnostics.mostRecentReleaseType,
        releaseTimes: diagnostics.releaseTimes.map((release) => ({ ...release })),
      }]
    })) as SimulationStateWithProgress['cartbuildSystem']['exchangers']
    const detrayerState = Object.fromEntries((['A', 'B', 'C'] as SourceId[]).map((source) => {
      const pileId = `${source}1`
      const pile = this.piles.get(pileId)!
      const waiting = this.trays.find((tray) => tray.pilePlacement?.pileId === pileId && tray.pilePlacement.component === 'MDR_PRE_DETRAYER' && tray.pilePlacement.zoneIndex === pile.config.preDetrayerMdrCount - 1 && tray.payloadOrigin === 'CARTBUILD' && tray.cartbuildCartonAttached)
      const diagnostics = this.detrayerDiagnostics[source]
      return [source, {
        source, loadedTrayWaiting: Boolean(waiting), trayId: waiting?.id ?? null,
        postDetrayerZone0Available: !this.trays.some((tray) => tray.pilePlacement?.pileId === pileId && tray.pilePlacement.component === 'MDR_POST_DETRAYER' && tray.pilePlacement.zoneIndex === 0),
        cartonLaneZone0Available: !this.cartonOccupancy(laneFor(source))[0], splitCount: diagnostics.splitCount,
        blockedTicks: diagnostics.blockedTicks, blockedDurationSec: diagnostics.blockedDurationSec, mostRecentSplitTime: diagnostics.mostRecentSplitTime,
      }]
    })) as SimulationStateWithProgress['cartbuildSystem']['detrayers']
    const srsCurrent = this.srsCurrentCounts()
    const srsGlobalCurrent = Object.values(srsCurrent).reduce((sum, count) => sum + count, 0)
    const srsGlobalPending = (['A', 'B', 'C'] as SourceId[]).reduce((sum, source) => sum + this.pendingDemand(source), 0)
    const srsGlobalAvailable = Math.max(0, SRS_GLOBAL_TARGET - srsGlobalCurrent - srsGlobalPending)
    const srsLanes = Object.fromEntries((['A', 'B', 'C'] as SourceId[]).map((source) => {
      const laneMissions = this.missions.filter((mission) => mission.assignedExchanger === source && mission.state !== 'RELEASED')
      const active = this.activeSlug?.source === source ? this.activeSlug : null
      const localAvailable = this.positiveAvailability(`${source}1` as SrsPileId, srsCurrent)
      const downstreamPile = `${source}2` as 'A2' | 'B2' | 'C2'
      const downstreamAvailable = this.positiveAvailability('T', srsCurrent) + this.positiveAvailability('D', srsCurrent) + this.positiveAvailability(downstreamPile, srsCurrent)
      return [source, {
        source, targetSize: SRS_TARGET_SIZES[`${source}1` as 'A1' | 'B1' | 'C1'], currentCount: srsCurrent[`${source}1` as 'A1' | 'B1' | 'C1'],
        pendingDemand: laneMissions.length, lanePurgeDemand: this.lanePurgeDemand(source, srsCurrent), localAvailable, downstreamAvailable,
        laneMissionCapacity: Math.max(0, localAvailable + downstreamAvailable - laneMissions.length),
        pendingEmptyMissions: laneMissions.filter((mission) => mission.missionType === 'EMPTY').length,
        pendingCartbuildMissions: laneMissions.filter((mission) => mission.missionType === 'CARTBUILD').length,
        maturedEmptyMissions: laneMissions.filter((mission) => mission.missionType === 'EMPTY' && mission.state === 'READY_AT_EXCHANGER').length,
        maturedCartbuildMissions: laneMissions.filter((mission) => mission.missionType === 'CARTBUILD' && mission.state === 'READY_AT_EXCHANGER').length,
        lastActualExchangerReleaseTime: this.outboundDiagnostics[source].releaseTimes.at(-1)?.timeSec ?? null,
        nextEligibleExchangerReleaseTime: Math.max(0, this.asrsLastRelease[source] + CARTBUILD_INTERVAL_SEC),
        activeSourceBatch: Boolean(active), frozenSourceBatchQuantity: active?.authorizedCount ?? 0,
        sourceBatchReleasedCount: active?.releasedCount ?? 0, sourceBatchRemainingCount: active ? active.authorizedCount - active.releasedCount : 0,
      }]
    })) as SimulationStateWithProgress['srsControl']['lanes']
    const maturedQueues = Object.fromEntries((['A', 'B', 'C'] as SourceId[]).map((source) => [source, this.maturedQueue(source).map((mission) => mission.robotId!).filter((robotId) => robotId !== undefined)])) as Record<SourceId, number[]>
    const queuePositions = new Map<number, number>()
    for (const source of ['A', 'B', 'C'] as SourceId[]) this.exchangerQueue(source).forEach(({ mission }, index) => queuePositions.set(mission.robotId!, index + 1))
    const outboundRobots = this.missions
      .filter((mission) => mission.robotId !== undefined && mission.payloadTrayId !== undefined && mission.payloadLoadState !== undefined)
      .map((mission) => {
        const currentPayload = mission.robotPayload ?? this.trays.find((tray) => tray.id === mission.payloadTrayId)
        return {
          robotId: mission.robotId!, missionId: mission.missionId, missionType: mission.missionType, assignedExchanger: mission.assignedExchanger,
          lifecycleState: mission.robotState ?? 'TRAVELING_OUTBOUND', assignedAtSec: mission.createdAtSec, maturityTimeSec: mission.readyAtSec,
          travelProgress: Math.max(0, Math.min(1, (this.timeSec - mission.createdAtSec) / Math.max(EPS, mission.readyAtSec - mission.createdAtSec))),
          queuePosition: queuePositions.get(mission.robotId!) ?? null, blockedReason: mission.robotBlockedReason ?? null,
          blockedDurationSec: this.currentDropBlockedDuration(mission), payloadTrayId: mission.payloadTrayId!, payloadLoadState: currentPayload?.loadState ?? mission.payloadLoadState!,
          cartbuildCartonAttached: Boolean(currentPayload?.cartbuildCartonAttached), ownsPayload: Boolean(mission.robotPayload),
          inboundTrayId: mission.inboundTrayId ?? null, inboundTrayLoadState: mission.inboundTrayLoadState ?? null,
          takePickupTimeSec: mission.takePickupTimeSec ?? null, rackArrivalTimeSec: mission.robotState === 'OUTBOUND_COMPLETE' ? mission.rackArrivalTimeSec ?? null : null,
          returnProgress: mission.returnStartedAtSec === undefined ? 0 : Math.max(0, Math.min(1, (this.timeSec - mission.returnStartedAtSec) / 10)),
        }
      })
    const inboundReservations = [...this.inboundReservations.entries()].map(([trayId, missionId]) => {
      const mission = this.inboundMissions.find((candidate) => candidate.missionId === missionId)!
      const tray = this.trays.find((candidate) => candidate.id === trayId)
      return { trayId, loadState: tray?.loadState ?? mission.reservedLoadState, exchanger: mission.assignedExchanger, robotId: mission.robotId, missionId, reservedAtSec: mission.assignedAtSec }
    })
    const inboundOnlyRobots = this.inboundMissions.map((mission) => ({
      robotId: mission.robotId, missionId: mission.missionId, assignedExchanger: mission.assignedExchanger,
      lifecycleState: mission.robotState, reservedTrayId: mission.reservedTrayId, assignedAtSec: mission.assignedAtSec,
      maturityTimeSec: mission.maturityTimeSec, travelProgress: Math.max(0, Math.min(1, (this.timeSec - mission.assignedAtSec) / 180)),
      queuePosition: queuePositions.get(mission.robotId) ?? null, cancellationTimeSec: mission.cancellationTimeSec ?? null,
      cancellationReason: mission.cancellationReason ?? null, cancelledAfterAdmission: mission.cancelledAfterAdmission,
      ownsInboundTray: Boolean(mission.inboundPayload), inboundTrayId: mission.inboundPayload?.id ?? null,
      inboundTrayLoadState: mission.inboundPayload?.loadState ?? null, takePickupTimeSec: mission.takePickupTimeSec ?? null,
      rackArrivalTimeSec: mission.robotState === 'INBOUND_COMPLETE' ? mission.rackArrivalTimeSec ?? null : null,
      returnProgress: mission.returnStartedAtSec === undefined ? 0 : Math.max(0, Math.min(1, (this.timeSec - mission.returnStartedAtSec) / 10)),
    }))
    const returningRobots = [
      ...this.missions.filter((mission) => mission.robotState === 'RETURNING_TO_RACK').map((mission) => ({
        robotId: mission.robotId!, missionId: mission.missionId, robotKind: 'OUTBOUND' as const, exchanger: mission.assignedExchanger,
        inboundTrayId: mission.inboundPayload?.id ?? null, inboundTrayLoadState: mission.inboundPayload?.loadState ?? null,
        returnStartedAtSec: mission.returnStartedAtSec!, rackArrivalTimeSec: mission.rackArrivalTimeSec!,
        returnProgress: Math.max(0, Math.min(1, (this.timeSec - mission.returnStartedAtSec!) / 10)),
      })),
      ...this.inboundMissions.filter((mission) => mission.robotState === 'RETURNING_TO_RACK').map((mission) => ({
        robotId: mission.robotId, missionId: mission.missionId, robotKind: 'INBOUND_ONLY' as const, exchanger: mission.assignedExchanger,
        inboundTrayId: mission.inboundPayload?.id ?? null, inboundTrayLoadState: mission.inboundPayload?.loadState ?? null,
        returnStartedAtSec: mission.returnStartedAtSec!, rackArrivalTimeSec: mission.rackArrivalTimeSec!,
        returnProgress: Math.max(0, Math.min(1, (this.timeSec - mission.returnStartedAtSec!) / 10)),
      })),
    ]
    const cancelledInboundOnlyRobots = this.inboundMissions.filter((mission) => mission.cancellationTimeSec !== undefined).map((mission) => ({
      robotId: mission.robotId, missionId: mission.missionId, exchanger: mission.assignedExchanger, reservedTrayId: mission.reservedTrayId,
      cancellationTimeSec: mission.cancellationTimeSec!, cancellationReason: mission.cancellationReason!,
      cancelledAfterAdmission: mission.cancelledAfterAdmission, rackArrivalTimeSec: mission.robotState === 'INBOUND_COMPLETE' ? mission.rackArrivalTimeSec ?? null : null,
    }))
    const exchangerPipelines = Object.fromEntries((['A', 'B', 'C'] as SourceId[]).map((source) => {
      const station = this.exchangerStations[source]
      const queue = this.exchangerQueue(source)
      const dropMission = station.dropMissionId === null ? undefined : station.dropRobotKind === 'OUTBOUND'
        ? this.missions.find(({ missionId }) => missionId === station.dropMissionId)
        : this.inboundMissions.find(({ missionId }) => missionId === station.dropMissionId)
      const shiftingMission = station.shiftingMissionId === null ? undefined : station.shiftingRobotKind === 'OUTBOUND'
        ? this.missions.find(({ missionId }) => missionId === station.shiftingMissionId)
        : this.inboundMissions.find(({ missionId }) => missionId === station.shiftingMissionId)
      const queueAdvanceProgress = station.queueAdvanceStartedAtSec === null ? 0 : Math.max(0, Math.min(1, this.timeSec - station.queueAdvanceStartedAtSec))
      const stationCounts = { OUTBOUND_ONLY: 0, INBOUND_ONLY: 0, DUAL_CYCLE: 0, CANCELLED_INBOUND_ONLY: 0 }
      for (const cycle of station.completedCycles) stationCounts[cycle.cycleType] += 1
      const outboundCycleCount = stationCounts.OUTBOUND_ONLY + stationCounts.DUAL_CYCLE
      return [source, {
        source, dropRobotId: dropMission?.robotId ?? null, shiftingOrTakeRobotId: shiftingMission?.robotId ?? null,
        dropBlocked: station.dropRobotKind === 'OUTBOUND' && dropMission?.robotState === 'BLOCKED_FROM_DROP',
        dropBlockedReason: station.dropRobotKind === 'OUTBOUND' ? (dropMission as OutboundMission | undefined)?.robotBlockedReason ?? null : null,
        dropBlockedDurationSec: station.dropRobotKind === 'OUTBOUND' && dropMission ? this.currentDropBlockedDuration(dropMission as OutboundMission) : 0,
        lastSuccessfulDropTime: this.asrsLastRelease[source] < -1e8 ? null : this.asrsLastRelease[source],
        nextEligibleCycleAdmissionTime: this.asrsLastRelease[source] < -1e8 ? 0 : this.asrsLastRelease[source] + CARTBUILD_INTERVAL_SEC,
        queue: queue.map(({ kind, mission }) => ({ robotId: mission.robotId, missionId: mission.missionId, missionType: kind === 'OUTBOUND' ? (mission as OutboundMission).missionType : 'INBOUND_ONLY' as const })),
        queueLength: queue.length, maximumObservedQueueLength: station.maximumObservedQueueLength,
        queueAdvancementState: station.queueAdvanceStartedAtSec === null ? 'IDLE' : queueAdvanceProgress < 1 ? 'ADVANCING' : 'COMPLETE',
        queueAdvanceProgress, successfulOutboundOnlyCycleCount: stationCounts.OUTBOUND_ONLY,
        currentQueueDepth: queue.length, completedCountByClassification: stationCounts,
        dualCyclePercentage: outboundCycleCount === 0 ? 0 : stationCounts.DUAL_CYCLE / outboundCycleCount * 100,
      }]
    })) as SimulationStateWithProgress['asrsRobotSystem']['exchangers']
    const completedCycles = (['A', 'B', 'C'] as SourceId[]).flatMap((source) => this.exchangerStations[source].completedCycles.map((cycle) => ({ ...cycle })))
    const completedOutboundCycles = completedCycles.filter((cycle) => cycle.missionType !== 'INBOUND_ONLY')
    const completedCountByClassification = { OUTBOUND_ONLY: 0, INBOUND_ONLY: 0, DUAL_CYCLE: 0, CANCELLED_INBOUND_ONLY: 0 }
    for (const cycle of completedCycles) completedCountByClassification[cycle.cycleType] += 1
    const outboundCompletedCount = completedCountByClassification.OUTBOUND_ONLY + completedCountByClassification.DUAL_CYCLE
    return {
      timeSec: this.timeSec,
      trays: this.trays.map((tray) => ({ ...tray, pilePlacement: tray.pilePlacement ? { ...tray.pilePlacement } : undefined, zonePlacement: tray.zonePlacement ? { ...tray.zonePlacement } : undefined, inboundPlacement: tray.inboundPlacement ? { ...tray.inboundPlacement } : undefined, pileRuntime: tray.pileRuntime ? { ...tray.pileRuntime } : undefined })),
      segments: this.segments.map((segment) => ({ ...segment })), sources: this.sources.map((source) => ({ ...source })), source: { ...this.sources[0] }, mergeState,
      korber: { lastConsumptionTime: this.returnEnabled ? (this.korberProcessedCount ? this.timeSec : null) : (this.consumedCount ? this.nextConsumptionTime - KORBER_INTERVAL_SEC : null), totalConsumed: this.returnEnabled ? this.korberProcessedCount : this.consumedCount, ready: this.timeSec + EPS >= this.nextConsumptionTime || this.korberStarved, starved: this.korberStarved },
      missions: this.missions.map((mission) => ({ missionId: mission.missionId, assignedExchanger: mission.assignedExchanger, missionType: mission.missionType, createdAtSec: mission.createdAtSec, readyAtSec: mission.readyAtSec, state: mission.state })),
      asrsRobotSystem: {
        outboundRobots, maturedQueues, robotCarriedTrayCount, exchangers: exchangerPipelines, completedOutboundCycles,
        completedCycles, inboundReservations, inboundOnlyRobots, returningRobots, cancelledInboundOnlyRobots,
        completedCountByClassification,
        dualCyclePercentage: outboundCompletedCount === 0 ? 0 : completedCountByClassification.DUAL_CYCLE / outboundCompletedCount * 100,
      },
      pendingA: pending('A'), pendingB: pending('B'), pendingC: pending('C'), retrievingA: retrieving('A'), retrievingB: retrieving('B'), retrievingC: retrieving('C'), readyA: ready('A'), readyB: ready('B'), readyC: ready('C'),
      additionalASRSDemand: srsGlobalAvailable, globalTargetCount: SRS_GLOBAL_TARGET, globalCurrentCount: srsGlobalCurrent, transportInventory: this.zonedOccupancy('PRE_T').filter(Boolean).length + this.zonedOccupancy('T').filter(Boolean).length, physicalPreKorberInventory: physical,
      purgeDemandA: this.lanePurgeDemand('A', srsCurrent), purgeDemandB: this.lanePurgeDemand('B', srsCurrent), purgeDemandC: this.lanePurgeDemand('C', srsCurrent), asrsNextAssign: this.asrsNextAssign, asrsAssignedA: this.asrsAssigned.A, asrsAssignedB: this.asrsAssigned.B, asrsAssignedC: this.asrsAssigned.C,
      preDetrayerMdrA: pileCount('A', 'MDR_PRE_DETRAYER'), postDetrayerMdrA: pileCount('A', 'MDR_POST_DETRAYER'), beltCountA: pileCount('A', 'BELT'), downstreamMdrA: pileCount('A', 'MDR_DOWNSTREAM'), beltRunningA: beltDiagnostics[0].beltRunning,
      preDetrayerMdrB: pileCount('B', 'MDR_PRE_DETRAYER'), postDetrayerMdrB: pileCount('B', 'MDR_POST_DETRAYER'), beltCountB: pileCount('B', 'BELT'), downstreamMdrB: pileCount('B', 'MDR_DOWNSTREAM'), beltRunningB: beltDiagnostics[1].beltRunning,
      preDetrayerMdrC: pileCount('C', 'MDR_PRE_DETRAYER'), postDetrayerMdrC: pileCount('C', 'MDR_POST_DETRAYER'), beltCountC: pileCount('C', 'BELT'), downstreamMdrC: pileCount('C', 'MDR_DOWNSTREAM'), beltRunningC: beltDiagnostics[2].beltRunning,
      pileAuthorizedExitA: this.activeSlug?.source === 'A', pileAuthorizedExitB: this.activeSlug?.source === 'B', pileAuthorizedExitC: this.activeSlug?.source === 'C',
      beltDiagnostics,
      operatingSettings: { ...this.operatingSettings },
      cartbuildSystem: {
        enabled: this.cartbuildAvailable, settings: { ...this.operatingSettings }, lanes: cartbuildLanes, exchangers: exchangerDiagnostics, detrayers: detrayerState,
        cartbuildCartonsIntroduced: cartonIntroduced, cartbuildCartonsAttachedToTrays: cartonAttached,
        cartbuildCartonsOnConveyors: cartonOnConveyors, cartbuildCartonsConsumedByOperators: cartonConsumed,
        cartonBalanceError: cartonIntroduced - cartonAttached - cartonOnConveyors - cartonConsumed,
      },
      srsControl: {
        targets: { ...SRS_TARGET_SIZES }, current: { ...srsCurrent }, globalTarget: SRS_GLOBAL_TARGET, globalCurrent: srsGlobalCurrent,
        globalPending: srsGlobalPending, globalAvailableCapacity: srsGlobalAvailable, planningCadenceSec: this.planningCadenceSec,
        nextPlanningTime: this.nextPlanningTime, planningCursor: this.asrsNextAssign, lanes: srsLanes,
        tBypassBatch: {
          active: Boolean(this.activePurgeBatch), authorizedTrayIds: [...(this.activePurgeBatch?.authorizedTrayIds ?? [])],
          enteredCount: this.activePurgeBatch?.enteredPurgeCount ?? 0,
          remainingCount: this.activePurgeBatch ? this.activePurgeBatch.authorizedCount - this.activePurgeBatch.enteredPurgeCount : 0,
          sourceBatchPaused: Boolean(this.activeSlug && this.activePurgeBatch),
        },
      },
      returnSystem: {
        enabled: this.returnEnabled,
        korberProcessedCount: this.korberProcessedCount,
        korberHeldTrayId: this.trays.find((tray) => tray.korberHeld)?.id ?? null,
        returnedToAsrsCount,
        returnedHistory: this.returnedHistory.map((record) => ({ ...record })),
        purgeTriggerReady: this.returnEnabled && this.zonedOccupancy('T').filter(Boolean).length === ZONE_COUNTS.T && Boolean(this.zonedOccupancy('D')[0]) && !this.activePurgeBatch,
        activePurgeBatch: this.activePurgeBatch ? { ...this.activePurgeBatch, authorizedTrayIds: [...this.activePurgeBatch.authorizedTrayIds] } : null,
        lastCompletedPurgeBatch: this.lastCompletedPurgeBatch ? { ...this.lastCompletedPurgeBatch, authorizedTrayIds: [...this.lastCompletedPurgeBatch.authorizedTrayIds] } : null,
        sorterCursor: this.sorterCursor,
        sorterSelectedDestination: this.sorterSelectedDestination,
        sorterAvailability: returnAvailability,
        sorterBlockedReason: this.sorterBlockedReason,
        sHeadTrayDestination: sHead?.returnDestination ?? null,
        assignments: { A2: { ...this.returnAssignments.A2 }, B2: { ...this.returnAssignments.B2 }, C2: { ...this.returnAssignments.C2 } },
        mergeCounts: { ...this.returnMergeCounts },
        exchangerAcceptanceTimes: { A2: [...this.exchangerAcceptanceTimes.A2], B2: [...this.exchangerAcceptanceTimes.B2], C2: [...this.exchangerAcceptanceTimes.C2] },
        conveyorOccupancy: returnConveyorOccupancy,
      },
      segmentStats, movingCount: this.trays.filter((tray) => tray.status === 'MOVING').length, blockedCount: this.trays.filter((tray) => tray.status === 'BLOCKED').length,
      totalTraysCreated: this.totalTraysCreated, createdTrayCount: this.totalTraysCreated, physicalTrayCount: physical, consumedTrayCount: this.returnEnabled ? 0 : this.consumedCount, materialBalanceError: this.totalTraysCreated - physical - materialSinkCount,
      slugCursor: this.slugCursor, activeSlug: this.activeSlug ? { ...this.activeSlug, authorizedTrayIds: [...this.activeSlug.authorizedTrayIds] } : null, lastCompletedSlug: this.lastCompletedSlug ? { ...this.lastCompletedSlug, authorizedTrayIds: [...this.lastCompletedSlug.authorizedTrayIds] } : null,
      dEntranceAvailable: this.isDEntranceAvailable(), dFinalZoneOccupied: dFinal, korberNextConsumptionTime: this.nextConsumptionTime, korberLastConsumedTrayId: this.lastConsumedTrayId,
      zonedOccupancy: { PRE_T: this.zonedOccupancy('PRE_T').filter(Boolean).length, T: this.zonedOccupancy('T').filter(Boolean).length, D: this.zonedOccupancy('D').filter(Boolean).length },
      totalRouteDistance: this.segments.reduce((sum, segment) => sum + segment.lengthFt, 0),
    }
  }
}
