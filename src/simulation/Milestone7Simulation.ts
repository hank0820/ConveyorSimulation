import HybridAccumulationPile from './HybridAccumulationPile'
import type {
  ActiveSlugState,
  BeltDiagnostic,
  ConveyorSegmentConfig,
  MergeState,
  Mission,
  SimulationStateWithProgress,
  SourceId,
  SourceState,
  Tray,
} from './types'

const EPS = 1e-9
const ZONE_LENGTH_FT = 2.5
const TRAY_LENGTH_FT = 2
const SPEED_FT_PER_SEC = 2
const ZONE_TRANSFER_SEC = ZONE_LENGTH_FT / SPEED_FT_PER_SEC
const KORBER_INTERVAL_SEC = 3600 / 1050
const ZONE_COUNTS = { PRE_T: 8, T: 12, D: 94 } as const
type ZonedId = keyof typeof ZONE_COUNTS

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

  constructor(segments: ConveyorSegmentConfig[]) {
    this.segments = segments
    this.piles.set('A1', new HybridAccumulationPile({ pileId: 'A1', totalLengthFt: 81, upstreamMdrCount: 8, downstreamMdrCount: 15, beltLengthFt: 23.5, mdrZoneLengthFt: ZONE_LENGTH_FT, trayLengthFt: TRAY_LENGTH_FT }))
    this.piles.set('B1', new HybridAccumulationPile({ pileId: 'B1', totalLengthFt: 81, upstreamMdrCount: 8, downstreamMdrCount: 7, beltLengthFt: 43.5, mdrZoneLengthFt: ZONE_LENGTH_FT, trayLengthFt: TRAY_LENGTH_FT }))
    this.piles.set('C1', new HybridAccumulationPile({ pileId: 'C1', totalLengthFt: 81, upstreamMdrCount: 8, downstreamMdrCount: 7, beltLengthFt: 43.5, mdrZoneLengthFt: ZONE_LENGTH_FT, trayLengthFt: TRAY_LENGTH_FT }))
    this.reset()
  }

  reset() {
    this.timeSec = 0
    this.trays = []
    this.totalTraysCreated = 0
    this.consumedCount = 0
    this.missions = []
    this.missionCounter = 0
    this.asrsNextAssign = 'A'
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
      this.createMissionIfNeeded()
      this.processZonedConveyors(delta)
      this.processPiles(delta)
      this.authorizeSlugIfPossible()
      this.releaseActivePileTray()
      this.processZonedBoundaries()
      this.attemptExchangerReleases()
    }
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
    for (const conveyorId of ['PRE_T', 'T', 'D'] as ZonedId[]) {
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

  private processZonedBoundaries() {
    const preTFinal = this.zonedOccupancy('PRE_T')[ZONE_COUNTS.PRE_T - 1]
    if (preTFinal && !this.zonedOccupancy('T')[0] && this.activeSlug && this.activeSlug.source !== 'C') {
      this.moveToZonedEntrance(preTFinal, 'T')
      this.recordEnteredT(preTFinal)
    }
    const tFinal = this.zonedOccupancy('T')[ZONE_COUNTS.T - 1]
    if (tFinal && !this.zonedOccupancy('D')[0]) this.moveToZonedEntrance(tFinal, 'D')
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
            if (index + 1 < cfg.upstreamMdrCount) placement.zoneIndex = index + 1
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
        if (source && !up[index + 1] && !source.pileRuntime) source.pileRuntime = { transferring: true, transferRemainingSec: ZONE_TRANSFER_SEC }
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

  private authorizeSlugIfPossible() {
    if (this.activeSlug || !this.isDEntranceAvailable()) return
    const order: SourceId[] = ['A', 'B', 'C']
    const start = order.indexOf(this.slugCursor)
    const cyclic = Array.from({ length: 3 }, (_, index) => order[(start + index) % 3])
    let source = cyclic.find((candidate) => this.releasableTrayIds(candidate).length >= 8)
    if (!source) source = cyclic.find((candidate) => this.releasableTrayIds(candidate).length > 0)
    if (!source) return
    const available = this.releasableTrayIds(source)
    const authorizedTrayIds = available.slice(0, Math.min(8, available.length))
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

  private createMissionIfNeeded() {
    const pending = this.missions.filter((mission) => mission.state !== 'RELEASED').length
    const deficit = 150 - this.trays.length - pending
    for (let index = 0; index < deficit; index++) {
      const assigned = this.asrsNextAssign
      this.missions.push({ missionId: ++this.missionCounter, assignedExchanger: assigned, createdAtSec: this.timeSec, readyAtSec: this.timeSec + 180, state: 'RETRIEVING' })
      this.asrsAssigned[assigned] += 1
      this.asrsNextAssign = assigned === 'A' ? 'B' : assigned === 'B' ? 'C' : 'A'
    }
  }

  private matureMissions() {
    for (const mission of this.missions) if (mission.state === 'RETRIEVING' && this.timeSec + EPS >= mission.readyAtSec) mission.state = 'READY_AT_EXCHANGER'
  }

  private attemptExchangerReleases() {
    for (const source of ['A', 'B', 'C'] as SourceId[]) {
      const mission = this.missions.find((candidate) => candidate.assignedExchanger === source && candidate.state === 'READY_AT_EXCHANGER')
      if (!mission || this.timeSec - this.asrsLastRelease[source] < 8 - EPS) continue
      const pileId = `${source}1`
      const occupied = this.trays.some((tray) => tray.pilePlacement?.pileId === pileId && tray.pilePlacement.component === 'MDR_UPSTREAM' && tray.pilePlacement.zoneIndex === 0)
      if (occupied) continue
      const tray: Tray = { id: ++this.totalTraysCreated, currentSegmentId: pileId, positionFt: ZONE_LENGTH_FT / 2, status: 'BLOCKED', createdAtSec: this.timeSec, originSourceId: source, pilePlacement: { pileId, component: 'MDR_UPSTREAM', zoneIndex: 0 } }
      this.trays.push(tray)
      mission.state = 'RELEASED'
      this.asrsLastRelease[source] = this.timeSec
      this.sources.find((entry) => entry.id === source)!.totalTraysCreated += 1
    }
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
    return {
      timeSec: this.timeSec,
      trays: this.trays.map((tray) => ({ ...tray, pilePlacement: tray.pilePlacement ? { ...tray.pilePlacement } : undefined, zonePlacement: tray.zonePlacement ? { ...tray.zonePlacement } : undefined, pileRuntime: tray.pileRuntime ? { ...tray.pileRuntime } : undefined })),
      segments: this.segments.map((segment) => ({ ...segment })), sources: this.sources.map((source) => ({ ...source })), source: { ...this.sources[0] }, mergeState,
      korber: { lastConsumptionTime: this.consumedCount ? this.nextConsumptionTime - KORBER_INTERVAL_SEC : null, totalConsumed: this.consumedCount, ready: this.timeSec + EPS >= this.nextConsumptionTime || this.korberStarved, starved: this.korberStarved },
      missions: this.missions.map((mission) => ({ ...mission })), pendingA: pending('A'), pendingB: pending('B'), pendingC: pending('C'), retrievingA: retrieving('A'), retrievingB: retrieving('B'), retrievingC: retrieving('C'), readyA: ready('A'), readyB: ready('B'), readyC: ready('C'),
      additionalASRSDemand: Math.max(0, 150 - physical - pending('A') - pending('B') - pending('C')), globalTargetCount: 150, globalCurrentCount: physical, transportInventory: this.zonedOccupancy('PRE_T').filter(Boolean).length + this.zonedOccupancy('T').filter(Boolean).length, physicalPreKorberInventory: physical,
      purgeDemandA: 0, purgeDemandB: 0, purgeDemandC: 0, asrsNextAssign: this.asrsNextAssign, asrsAssignedA: this.asrsAssigned.A, asrsAssignedB: this.asrsAssigned.B, asrsAssignedC: this.asrsAssigned.C,
      upstreamMdrA: pileCount('A', 'MDR_UPSTREAM'), beltCountA: pileCount('A', 'BELT'), downstreamMdrA: pileCount('A', 'MDR_DOWNSTREAM'), beltRunningA: beltDiagnostics[0].beltRunning,
      upstreamMdrB: pileCount('B', 'MDR_UPSTREAM'), beltCountB: pileCount('B', 'BELT'), downstreamMdrB: pileCount('B', 'MDR_DOWNSTREAM'), beltRunningB: beltDiagnostics[1].beltRunning,
      upstreamMdrC: pileCount('C', 'MDR_UPSTREAM'), beltCountC: pileCount('C', 'BELT'), downstreamMdrC: pileCount('C', 'MDR_DOWNSTREAM'), beltRunningC: beltDiagnostics[2].beltRunning,
      pileAuthorizedExitA: this.activeSlug?.source === 'A', pileAuthorizedExitB: this.activeSlug?.source === 'B', pileAuthorizedExitC: this.activeSlug?.source === 'C',
      beltDiagnostics,
      segmentStats, movingCount: this.trays.filter((tray) => tray.status === 'MOVING').length, blockedCount: this.trays.filter((tray) => tray.status === 'BLOCKED').length,
      totalTraysCreated: this.totalTraysCreated, createdTrayCount: this.totalTraysCreated, physicalTrayCount: physical, consumedTrayCount: this.consumedCount, materialBalanceError: this.totalTraysCreated - physical - this.consumedCount,
      slugCursor: this.slugCursor, activeSlug: this.activeSlug ? { ...this.activeSlug, authorizedTrayIds: [...this.activeSlug.authorizedTrayIds] } : null, lastCompletedSlug: this.lastCompletedSlug ? { ...this.lastCompletedSlug, authorizedTrayIds: [...this.lastCompletedSlug.authorizedTrayIds] } : null,
      dEntranceAvailable: this.isDEntranceAvailable(), dFinalZoneOccupied: dFinal, korberNextConsumptionTime: this.nextConsumptionTime, korberLastConsumedTrayId: this.lastConsumedTrayId,
      zonedOccupancy: { PRE_T: this.zonedOccupancy('PRE_T').filter(Boolean).length, T: this.zonedOccupancy('T').filter(Boolean).length, D: this.zonedOccupancy('D').filter(Boolean).length },
      totalRouteDistance: this.segments.reduce((sum, segment) => sum + segment.lengthFt, 0),
    }
  }
}
