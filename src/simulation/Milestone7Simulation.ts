import HybridAccumulationPile from './HybridAccumulationPile'
import type {
  ActiveSlugState,
  BeltDiagnostic,
  CartbuildLaneId,
  CartonMarker,
  ConveyorSegmentConfig,
  MergeState,
  Mission,
  MissionType,
  OperatingSettings,
  PurgeBatchState,
  ReturnDestination,
  ReturnedTrayRecord,
  SimulationStateWithProgress,
  SourceId,
  SourceState,
  SrsPileId,
  Tray,
} from './types'

const EPS = 1e-9
const ZONE_LENGTH_FT = 2.5
const TRAY_LENGTH_FT = 2
const SPEED_FT_PER_SEC = 2
const ZONE_TRANSFER_SEC = ZONE_LENGTH_FT / SPEED_FT_PER_SEC
const KORBER_INTERVAL_SEC = 3600 / 1050
const ZONE_COUNTS = { PRE_T: 8, T: 12, D: 94, PURGE: 6, E: 35, X: 5, S: 8, A2: 36, B2: 29, C2: 29 } as const
type ZonedId = keyof typeof ZONE_COUNTS
const RETURN_IDS = ['PURGE', 'E', 'X', 'S', 'A2', 'B2', 'C2'] as const
const RETURN_DESTINATIONS: ReturnDestination[] = ['A2', 'B2', 'C2']
const CARTBUILD_LANES: CartbuildLaneId[] = ['CARTBUILD_A', 'CARTBUILD_B', 'CARTBUILD_C']
const CARTBUILD_ZONE_COUNT = 30
const CARTBUILD_INTERVAL_SEC = 8
export const SRS_TARGET_SIZES: Record<SrsPileId, number> = { A1: 24, B1: 16, C1: 16, T: 6, D: 73, A2: 36, B2: 29, C2: 29 }
const SRS_GLOBAL_TARGET = Object.values(SRS_TARGET_SIZES).reduce((sum, target) => sum + target, 0)
const DEFAULT_PLANNING_CADENCE_SEC = 10
const DEFAULT_SETTINGS = (): OperatingSettings => ({ korberEnabled: true, cartbuildAEnabled: true, cartbuildBEnabled: true, cartbuildCEnabled: true })
const laneFor = (source: SourceId): CartbuildLaneId => `CARTBUILD_${source}` as CartbuildLaneId
const settingFor = (source: SourceId): keyof OperatingSettings => `cartbuild${source}Enabled` as keyof OperatingSettings

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
  private missions: Mission[] = []
  private missionCounter = 0
  private asrsNextAssign: SourceId = 'A'
  private planningCadenceSec = DEFAULT_PLANNING_CADENCE_SEC
  private nextPlanningTime = 0
  private asrsAssigned: Record<SourceId, number> = { A: 0, B: 0, C: 0 }
  private asrsLastRelease: Record<SourceId, number> = { A: -1e9, B: -1e9, C: -1e9 }
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
    this.segments = segments
    this.returnEnabled = RETURN_IDS.every((id) => segments.some((segment) => segment.id === id))
    this.cartbuildAvailable = CARTBUILD_LANES.every((id) => segments.some((segment) => segment.id === id))
    this.piles.set('A1', new HybridAccumulationPile({ pileId: 'A1', totalLengthFt: 81, upstreamMdrCount: 8, downstreamMdrCount: 15, beltLengthFt: 23.5, mdrZoneLengthFt: ZONE_LENGTH_FT, trayLengthFt: TRAY_LENGTH_FT }))
    this.piles.set('B1', new HybridAccumulationPile({ pileId: 'B1', totalLengthFt: 81, upstreamMdrCount: 8, downstreamMdrCount: 7, beltLengthFt: 43.5, mdrZoneLengthFt: ZONE_LENGTH_FT, trayLengthFt: TRAY_LENGTH_FT }))
    this.piles.set('C1', new HybridAccumulationPile({ pileId: 'C1', totalLengthFt: 81, upstreamMdrCount: 8, downstreamMdrCount: 7, beltLengthFt: 43.5, mdrZoneLengthFt: ZONE_LENGTH_FT, trayLengthFt: TRAY_LENGTH_FT }))
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
    this.missionCounter = 0
    this.asrsNextAssign = 'A'
    this.planningCadenceSec = planningCadenceSec
    this.nextPlanningTime = 0
    this.asrsAssigned = { A: 0, B: 0, C: 0 }
    this.asrsLastRelease = { A: -1e9, B: -1e9, C: -1e9 }
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
      const result = this.piles.get(`${source}1`)!.initialTrays(nextId, source)
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
      ? ['PRE_T', 'T', 'D', 'PURGE', 'E', 'X', 'S', 'A2', 'B2', 'C2']
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
        const destinationOpen = !this.zonedOccupancy(destination)[0]
        const pathOpen = direct ? destinationOpen : destinationOpen && !this.zonedOccupancy('S')[0]
        if (pathOpen) {
          xFinal.returnDestination = destination
          this.returnAssignments[destination][xFinal.loadState ?? 'EMPTY'] += 1
          this.moveToZonedEntrance(xFinal, direct ? 'C2' : 'S')
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
    if (sFinal?.returnDestination && !this.zonedOccupancy(sFinal.returnDestination)[0]) {
      this.moveToZonedEntrance(sFinal, sFinal.returnDestination)
    }
  }

  private selectReturnDestination(): ReturnDestination | undefined {
    const start = RETURN_DESTINATIONS.indexOf(this.sorterCursor)
    for (let offset = 0; offset < RETURN_DESTINATIONS.length; offset++) {
      const destination = RETURN_DESTINATIONS[(start + offset) % RETURN_DESTINATIONS.length]
      const destinationOpen = !this.zonedOccupancy(destination)[0]
      const pathOpen = destination === 'C2' ? destinationOpen : destinationOpen && !this.zonedOccupancy('S')[0]
      if (pathOpen) return destination
    }
    return undefined
  }

  private processExchangerSinks() {
    if (!this.returnEnabled) return
    for (const destination of RETURN_DESTINATIONS) {
      const final = this.zonedOccupancy(destination)[ZONE_COUNTS[destination] - 1]
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
    tray.pilePlacement = undefined
    tray.pileRuntime = undefined
    tray.status = 'BLOCKED'
  }

  private processPiles(delta: number) {
    for (const [pileId, pile] of this.piles) {
      const cfg = pile.config
      const up: (Tray | null)[] = Array(cfg.upstreamMdrCount).fill(null)
      const down: (Tray | null)[] = Array(cfg.downstreamMdrCount).fill(null)
      const belt: Tray[] = []
      const refresh = () => {
        up.fill(null); down.fill(null); belt.length = 0
        for (const tray of this.trays) {
          const placement = tray.pilePlacement
          if (placement?.pileId !== pileId) continue
          if (placement.component === 'MDR_UPSTREAM') up[placement.zoneIndex ?? 0] = tray
          else if (placement.component === 'MDR_DOWNSTREAM') down[placement.zoneIndex ?? 0] = tray
          else belt.push(tray)
        }
      }
      refresh()

      // Complete MDR-to-MDR transfers first. The final upstream zone is handled
      // later because entry onto a mechanically coupled belt is interlocked.
      for (const tray of this.trays) {
        if (tray.pilePlacement?.pileId !== pileId || !tray.pileRuntime?.transferRemainingSec) continue
        const placement = tray.pilePlacement
        const isBeltEntry = placement.component === 'MDR_UPSTREAM'
          && placement.zoneIndex === cfg.upstreamMdrCount - 1
        if (isBeltEntry) continue
        tray.pileRuntime.transferRemainingSec -= delta
        if (tray.pileRuntime.transferRemainingSec <= EPS) {
          if (placement.component === 'MDR_UPSTREAM') {
            const index = placement.zoneIndex ?? 0
            const source = pileId[0] as SourceId
            if (index === 2 && tray.payloadOrigin === 'KORBER') throw new Error(`Körber payload tray ${tray.id} entered outbound detrayer ${source}`)
            if (index === 2 && tray.payloadOrigin === 'CARTBUILD' && tray.cartbuildCartonAttached) {
              const zone3Open = !this.trays.some((candidate) => candidate !== tray && candidate.pilePlacement?.pileId === pileId && candidate.pilePlacement.component === 'MDR_UPSTREAM' && candidate.pilePlacement.zoneIndex === 3)
              const laneId = laneFor(source)
              const cartonEntranceOpen = !this.cartonOccupancy(laneId)[0]
              if (zone3Open && cartonEntranceOpen) {
                placement.zoneIndex = 3
                tray.loadState = 'EMPTY'
                tray.payloadOrigin = undefined
                tray.cartbuildCartonAttached = undefined
                this.cartons.push({ internalKey: ++this.cartonMarkerCounter, laneId, zoneIndex: 0 })
                const diagnostics = this.detrayerDiagnostics[source]
                diagnostics.splitCount += 1
                diagnostics.mostRecentSplitTime = this.timeSec
              }
            } else if (index + 1 < cfg.upstreamMdrCount) {
              placement.zoneIndex = index + 1
            }
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

      belt.sort((a, b) => (a.pilePlacement!.beltPosFt ?? 0) - (b.pilePlacement!.beltPosFt ?? 0))
      let leading = belt.at(-1)

      // A tray already at the discharge transfers before the shared belt
      // translation. Remaining belt trays still receive only this tick's delta.
      if (beltRunning && leading && (leading.pilePlacement!.beltPosFt ?? 0) >= cfg.beltLengthFt - TRAY_LENGTH_FT - EPS) {
        leading.pilePlacement = { pileId, component: 'MDR_DOWNSTREAM', zoneIndex: 0 }
        belt.pop()
        down[0] = leading
        leading = belt.at(-1)
      }

      if (beltRunning && belt.length) {
        const requestedDelta = SPEED_FT_PER_SEC * delta
        const leadingPosition = leading!.pilePlacement!.beltPosFt ?? 0
        const sharedDelta = Math.max(0, Math.min(requestedDelta, cfg.beltLengthFt - TRAY_LENGTH_FT - leadingPosition))
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
      const upLast = up[cfg.upstreamMdrCount - 1]
      const entranceHasSpace = nearestBelt - TRAY_LENGTH_FT / 2 >= TRAY_LENGTH_FT - EPS
      if (beltRunning && upLast && entranceHasSpace) {
        if (!upLast.pileRuntime) {
          upLast.pileRuntime = { transferring: true, transferRemainingSec: ZONE_TRANSFER_SEC }
        } else {
          upLast.pileRuntime.transferRemainingSec = (upLast.pileRuntime.transferRemainingSec ?? ZONE_TRANSFER_SEC) - delta
          if (upLast.pileRuntime.transferRemainingSec <= EPS) {
            upLast.pilePlacement = { pileId, component: 'BELT', beltPosFt: TRAY_LENGTH_FT / 2 }
            upLast.pileRuntime = undefined
            belt.push(upLast)
            up[cfg.upstreamMdrCount - 1] = null
          }
        }
      }
      for (let index = cfg.upstreamMdrCount - 2; index >= 0; index--) {
        const source = up[index]
        if (!source || source.pileRuntime) continue
        if (index === 2 && source.payloadOrigin === 'KORBER') throw new Error(`Körber payload tray ${source.id} entered outbound detrayer ${pileId[0]}`)
        if (index === 2 && source.payloadOrigin === 'CARTBUILD' && source.cartbuildCartonAttached) {
          const branch = pileId[0] as SourceId
          const zone3Open = !up[index + 1]
          const cartonEntranceOpen = !this.cartonOccupancy(laneFor(branch))[0]
          if (!zone3Open || !cartonEntranceOpen) {
            const diagnostics = this.detrayerDiagnostics[branch]
            diagnostics.blockedTicks += 1
            diagnostics.blockedDurationSec += delta
            continue
          }
        } else if (up[index + 1]) {
          continue
        }
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
      if (placement.component === 'MDR_UPSTREAM') return (placement.zoneIndex ?? 0) * ZONE_LENGTH_FT
      if (placement.component === 'BELT') return pile.config.upstreamMdrCount * ZONE_LENGTH_FT + (placement.beltPosFt ?? 0)
      return pile.config.upstreamMdrCount * ZONE_LENGTH_FT + pile.config.beltLengthFt + (placement.zoneIndex ?? 0) * ZONE_LENGTH_FT
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
    const zonedCount = (conveyorId: 'T' | 'D' | 'A2' | 'B2' | 'C2') => this.trays.filter((tray) => tray.zonePlacement?.conveyorId === conveyorId).length
    return {
      A1: pileCount('A'), B1: pileCount('B'), C1: pileCount('C'),
      T: zonedCount('T'), D: zonedCount('D'), A2: zonedCount('A2'), B2: zonedCount('B2'), C2: zonedCount('C2'),
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

  private missionTypeFor(source: SourceId): MissionType | undefined {
    if (this.cartbuildAvailable && this.operatingSettings[settingFor(source)] && this.cartbuildReservation(source).availablePositions > 0) return 'CARTBUILD'
    if (this.operatingSettings.korberEnabled) return 'EMPTY'
    return undefined
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
      this.missions.push({
        missionId: ++this.missionCounter, assignedExchanger: selected, missionType,
        createdAtSec: this.timeSec, readyAtSec: this.timeSec + 180, state: 'RETRIEVING',
      })
      this.asrsAssigned[selected] += 1
      this.asrsNextAssign = selected === 'A' ? 'B' : selected === 'B' ? 'C' : 'A'
    }
  }

  private matureMissions() {
    for (const mission of this.missions) if (mission.state === 'RETRIEVING' && this.timeSec + EPS >= mission.readyAtSec) mission.state = 'READY_AT_EXCHANGER'
  }

  private attemptExchangerReleases() {
    for (const source of ['A', 'B', 'C'] as SourceId[]) {
      const pileId = `${source}1`
      const occupied = this.trays.some((tray) => tray.pilePlacement?.pileId === pileId && tray.pilePlacement.component === 'MDR_UPSTREAM' && tray.pilePlacement.zoneIndex === 0)
      if (this.timeSec - this.asrsLastRelease[source] < CARTBUILD_INTERVAL_SEC - EPS) continue
      const diagnostics = this.outboundDiagnostics[source]
      const cartonEntranceOpen = !this.cartonOccupancy(laneFor(source))[0]
      const matured = (missionType: MissionType) => this.missions
        .filter((mission) => mission.assignedExchanger === source && mission.missionType === missionType && mission.state === 'READY_AT_EXCHANGER')
        .sort((a, b) => a.createdAtSec - b.createdAtSec || a.missionId - b.missionId)[0]
      const cartbuildMission = matured('CARTBUILD')
      const emptyMission = matured('EMPTY')
      if (cartbuildMission && !occupied && cartonEntranceOpen) {
        const tray: Tray = {
          id: ++this.totalTraysCreated, currentSegmentId: pileId, positionFt: ZONE_LENGTH_FT / 2, status: 'BLOCKED', createdAtSec: this.timeSec,
          originSourceId: source, loadState: 'FULL', payloadOrigin: 'CARTBUILD', cartbuildCartonAttached: true,
          pilePlacement: { pileId, component: 'MDR_UPSTREAM', zoneIndex: 0 },
        }
        this.trays.push(tray)
        this.cartonIntroduced[source] += 1
        cartbuildMission.state = 'RELEASED'
        this.recordOutboundRelease(source, tray, 'LOADED')
        continue
      }
      if (cartbuildMission) diagnostics.blockedLoadedAttempts += 1

      if (!emptyMission) continue
      if (occupied) {
        diagnostics.blockedEmptyAttempts += 1
        continue
      }
      const tray: Tray = { id: ++this.totalTraysCreated, currentSegmentId: pileId, positionFt: ZONE_LENGTH_FT / 2, status: 'BLOCKED', createdAtSec: this.timeSec, originSourceId: source, loadState: 'EMPTY', pilePlacement: { pileId, component: 'MDR_UPSTREAM', zoneIndex: 0 } }
      this.trays.push(tray)
      emptyMission.state = 'RELEASED'
      this.recordOutboundRelease(source, tray, 'EMPTY')
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
    const physical = this.trays.length
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
    const returnAvailability = Object.fromEntries(RETURN_DESTINATIONS.map((destination) => [destination, !this.zonedOccupancy(destination)[0]])) as Record<ReturnDestination, boolean>
    const sHead = this.returnEnabled ? this.zonedOccupancy('S')[ZONE_COUNTS.S - 1] : null
    const returnConveyorOccupancy = Object.fromEntries(RETURN_IDS.map((id) => [id, this.returnEnabled ? this.zonedOccupancy(id).filter(Boolean).length : 0])) as Record<(typeof RETURN_IDS)[number], number>
    const returnedToAsrsCount = this.returnedHistory.length
    const materialSinkCount = this.returnEnabled ? returnedToAsrsCount : this.consumedCount
    const cartonAttached = this.trays.filter((tray) => tray.payloadOrigin === 'CARTBUILD' && tray.cartbuildCartonAttached).length
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
      const last = this.asrsLastRelease[source] < -1e8 ? null : this.asrsLastRelease[source]
      return [source, {
        source, cartbuildEnabled: this.cartbuildAvailable && this.operatingSettings[settingFor(source)], lastActualReleaseTime: last,
        nextEligibleReleaseTime: last === null ? this.timeSec : last + CARTBUILD_INTERVAL_SEC,
        loadedReleases: diagnostics.loadedReleases, emptyReleases: diagnostics.emptyReleases,
        blockedLoadedAttempts: diagnostics.blockedLoadedAttempts, blockedEmptyAttempts: diagnostics.blockedEmptyAttempts,
        pendingEmptyMissions: pending(source), mostRecentReleaseType: diagnostics.mostRecentReleaseType,
        releaseTimes: diagnostics.releaseTimes.map((release) => ({ ...release })),
      }]
    })) as SimulationStateWithProgress['cartbuildSystem']['exchangers']
    const detrayerState = Object.fromEntries((['A', 'B', 'C'] as SourceId[]).map((source) => {
      const pileId = `${source}1`
      const waiting = this.trays.find((tray) => tray.pilePlacement?.pileId === pileId && tray.pilePlacement.component === 'MDR_UPSTREAM' && tray.pilePlacement.zoneIndex === 2 && tray.payloadOrigin === 'CARTBUILD' && tray.cartbuildCartonAttached)
      const diagnostics = this.detrayerDiagnostics[source]
      return [source, {
        source, loadedTrayWaiting: Boolean(waiting), trayId: waiting?.id ?? null,
        zone3Available: !this.trays.some((tray) => tray.pilePlacement?.pileId === pileId && tray.pilePlacement.component === 'MDR_UPSTREAM' && tray.pilePlacement.zoneIndex === 3),
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
    return {
      timeSec: this.timeSec,
      trays: this.trays.map((tray) => ({ ...tray, pilePlacement: tray.pilePlacement ? { ...tray.pilePlacement } : undefined, zonePlacement: tray.zonePlacement ? { ...tray.zonePlacement } : undefined, pileRuntime: tray.pileRuntime ? { ...tray.pileRuntime } : undefined })),
      segments: this.segments.map((segment) => ({ ...segment })), sources: this.sources.map((source) => ({ ...source })), source: { ...this.sources[0] }, mergeState,
      korber: { lastConsumptionTime: this.returnEnabled ? (this.korberProcessedCount ? this.timeSec : null) : (this.consumedCount ? this.nextConsumptionTime - KORBER_INTERVAL_SEC : null), totalConsumed: this.returnEnabled ? this.korberProcessedCount : this.consumedCount, ready: this.timeSec + EPS >= this.nextConsumptionTime || this.korberStarved, starved: this.korberStarved },
      missions: this.missions.map((mission) => ({ ...mission })), pendingA: pending('A'), pendingB: pending('B'), pendingC: pending('C'), retrievingA: retrieving('A'), retrievingB: retrieving('B'), retrievingC: retrieving('C'), readyA: ready('A'), readyB: ready('B'), readyC: ready('C'),
      additionalASRSDemand: srsGlobalAvailable, globalTargetCount: SRS_GLOBAL_TARGET, globalCurrentCount: srsGlobalCurrent, transportInventory: this.zonedOccupancy('PRE_T').filter(Boolean).length + this.zonedOccupancy('T').filter(Boolean).length, physicalPreKorberInventory: physical,
      purgeDemandA: this.lanePurgeDemand('A', srsCurrent), purgeDemandB: this.lanePurgeDemand('B', srsCurrent), purgeDemandC: this.lanePurgeDemand('C', srsCurrent), asrsNextAssign: this.asrsNextAssign, asrsAssignedA: this.asrsAssigned.A, asrsAssignedB: this.asrsAssigned.B, asrsAssignedC: this.asrsAssigned.C,
      upstreamMdrA: pileCount('A', 'MDR_UPSTREAM'), beltCountA: pileCount('A', 'BELT'), downstreamMdrA: pileCount('A', 'MDR_DOWNSTREAM'), beltRunningA: beltDiagnostics[0].beltRunning,
      upstreamMdrB: pileCount('B', 'MDR_UPSTREAM'), beltCountB: pileCount('B', 'BELT'), downstreamMdrB: pileCount('B', 'MDR_DOWNSTREAM'), beltRunningB: beltDiagnostics[1].beltRunning,
      upstreamMdrC: pileCount('C', 'MDR_UPSTREAM'), beltCountC: pileCount('C', 'BELT'), downstreamMdrC: pileCount('C', 'MDR_DOWNSTREAM'), beltRunningC: beltDiagnostics[2].beltRunning,
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
