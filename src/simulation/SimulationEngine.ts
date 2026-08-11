import type { Tray, ConveyorSegmentConfig, SimulationStateWithProgress, SourceConfig, SourceId, MergeState, SourceState } from './types'
import ConveyorSegment from './ConveyorSegment'

const INTERNAL_TICK_SECONDS = 0.1
const EPS = 1e-9
const DEFAULT_SOURCE_CONFIGS: SourceConfig[] = [
  { id: 'A', firstSegmentId: 'A1', initialOffsetSec: 0 },
  { id: 'B', firstSegmentId: 'B1', initialOffsetSec: 2 },
  { id: 'C', firstSegmentId: 'C1', initialOffsetSec: 4 },
]

export class SimulationEngine {
  private timeSec = 0
  private trays: Tray[] = []
  private segmentsMap: Map<string, ConveyorSegment>
  private segmentsOrder: ConveyorSegmentConfig[]

  // source + physical params
  private trayPitchFt: number
  private sourceHeadwaySec: number
  private sourcesConfig: SourceConfig[]
  private sourcesState: SourceState[]
  private totalTraysCreated = 0

  // merge arbitration
  private mergeState: MergeState

  constructor(
    segmentConfigs: ConveyorSegmentConfig[],
    options?: {
      trayPitchFt?: number
      sourceRatePerHour?: number
      sourcesConfig?: SourceConfig[]
    }
  ) {
    this.segmentsMap = new Map(segmentConfigs.map((c) => [c.id, new ConveyorSegment(c)]))
    this.segmentsOrder = segmentConfigs
    this.trayPitchFt = options?.trayPitchFt ?? 3.0
    const rate = options?.sourceRatePerHour ?? 450
    this.sourceHeadwaySec = 3600 / rate
    this.sourcesConfig = options?.sourcesConfig ?? DEFAULT_SOURCE_CONFIGS
    this.sourcesState = this.sourcesConfig
      .filter((cfg) => this.segmentsMap.has(cfg.firstSegmentId))
      .map((cfg) => ({
        id: cfg.id,
        enabled: true,
        sourceReady: false,
        sourceBlocked: false,
        lastSourceReleaseTime: cfg.initialOffsetSec - this.sourceHeadwaySec,
        nextReleaseTime: cfg.initialOffsetSec,
        totalTraysCreated: 0,
        headwaySec: this.sourceHeadwaySec,
        initialOffsetSec: cfg.initialOffsetSec,
        firstSegmentId: cfg.firstSegmentId,
      }))
    this.mergeState = {
      nextPriority: 'A',
      eligibleA: false,
      eligibleB: false,
      eligibleC: false,
      selectedSource: 'NONE',
      cumulativeTransfersA: 0,
      cumulativeTransfersB: 0,
      cumulativeTransfersC: 0,
    }

    this.tryInjectSources()
  }

  step(seconds: number) {
    if (seconds <= 0) return
    let remaining = seconds
    while (remaining > 0) {
      const delta = Math.min(INTERNAL_TICK_SECONDS, remaining)
      remaining -= delta
      this.timeSec += delta
      this.tryInjectSources()
      this.processTick(delta)
    }
  }

  private tryInjectSources() {
    for (const source of this.sourcesState) {
      if (!source.enabled) continue
      const headwayPassed = this.timeSec + EPS >= source.nextReleaseTime
      if (!headwayPassed) {
        source.sourceReady = false
        source.sourceBlocked = false
        continue
      }

      const canEnter = this.canEnterSegment(source.firstSegmentId, 0)
      source.sourceReady = true
      source.sourceBlocked = !canEnter
      if (canEnter) {
        this.totalTraysCreated += 1
        source.totalTraysCreated += 1
        const tray: Tray = {
          id: this.totalTraysCreated,
          currentSegmentId: source.firstSegmentId,
          positionFt: 0,
          status: 'MOVING',
          createdAtSec: this.timeSec,
          originSourceId: source.id,
        }
        this.trays.push(tray)
        source.lastSourceReleaseTime = this.timeSec
        source.nextReleaseTime = this.timeSec + source.headwaySec
        source.sourceReady = false
        source.sourceBlocked = false
      }
    }
  }

  private processTick(deltaSec: number) {
    this.updateMergeEligibility()

    const segmentIndex: Record<string, number> = {}
    this.segmentsOrder.forEach((s, i) => (segmentIndex[s.id] = i))

    const traysOrder = this.trays.slice().sort((a, b) => {
      const ia = segmentIndex[a.currentSegmentId]
      const ib = segmentIndex[b.currentSegmentId]
      if (ia !== ib) return ib - ia
      return b.positionFt - a.positionFt
    })

    for (const t of traysOrder) {
      if (t.status !== 'MOVING' && t.status !== 'BLOCKED') continue
      const segConfig = this.segmentsMap.get(t.currentSegmentId)!.config
      let distance = (segConfig.speedFtPerMin / 60) * deltaSec
      let blocked = false
      while (distance > EPS && !blocked) {
        const seg = this.segmentsMap.get(t.currentSegmentId)!
        const remainingOnSegment = seg.config.lengthFt - t.positionFt

        if (remainingOnSegment <= EPS) {
          const nextId = seg.config.nextSegmentId
          if (nextId && this.tryTransferToNextSegment(t, seg.config.id, nextId, distance)) {
            continue
          }
          t.positionFt = seg.config.lengthFt
          t.status = 'BLOCKED'
          blocked = true
          break
        }

        const downstreamNeighbor = this.findDownstreamNeighborOnSameSegment(t)
        let maxByNeighbor = remainingOnSegment
        if (downstreamNeighbor) {
          const gap = downstreamNeighbor.positionFt - t.positionFt - this.trayPitchFt
          maxByNeighbor = Math.max(0, Math.min(maxByNeighbor, gap))
        }

        if (distance <= maxByNeighbor + EPS) {
          t.positionFt += distance
          distance = 0
          if (t.positionFt >= seg.config.lengthFt - EPS) {
            const nextId = seg.config.nextSegmentId
            if (nextId && this.tryTransferToNextSegment(t, seg.config.id, nextId, 0)) {
              continue
            }
            t.positionFt = seg.config.lengthFt
            t.status = 'BLOCKED'
            blocked = true
          } else {
            t.status = 'MOVING'
          }
          break
        }

        const isBlockedByNeighbor = maxByNeighbor + EPS < remainingOnSegment
        if (maxByNeighbor <= EPS && !isBlockedByNeighbor) {
          t.status = 'BLOCKED'
          blocked = true
          break
        }

        t.positionFt += maxByNeighbor
        distance -= maxByNeighbor

        if (isBlockedByNeighbor) {
          t.status = 'BLOCKED'
          blocked = true
          break
        }

        const nextId = seg.config.nextSegmentId
        if (nextId && this.tryTransferToNextSegment(t, seg.config.id, nextId, distance)) {
          continue
        }

        t.positionFt = seg.config.lengthFt
        t.status = 'BLOCKED'
        blocked = true
        break
      }
    }
  }

  private findDownstreamNeighborOnSameSegment(tray: Tray): Tray | undefined {
    const same = this.trays.filter((t) => t.currentSegmentId === tray.currentSegmentId && t.id !== tray.id)
    let candidates = same.filter((t) => t.positionFt > tray.positionFt + EPS)
    if (candidates.length === 0) return undefined
    candidates.sort((a, b) => a.positionFt - b.positionFt)
    return candidates[0]
  }

  private updateMergeEligibility() {
    const eligible = {
      A: false,
      B: false,
      C: false,
    }

    for (const source of this.sourcesState) {
      const feederSegmentId = source.id === 'C' ? 'C1' : `${source.id}1T`
      const feederSeg = this.segmentsMap.get(feederSegmentId)
      if (!feederSeg) continue
      const feederTrays = this.trays.filter((t) => t.currentSegmentId === feederSegmentId)
      if (feederTrays.length === 0) continue
      const lastTray = feederTrays.reduce((max, t) => (t.positionFt > max.positionFt ? t : max), feederTrays[0])
      const atEnd = lastTray.positionFt >= feederSeg.config.lengthFt - EPS
      const canEnter = this.canEnterSegment('T', 0)
      eligible[source.id] = atEnd && canEnter
    }

    this.mergeState.eligibleA = eligible.A
    this.mergeState.eligibleB = eligible.B
    this.mergeState.eligibleC = eligible.C
    this.mergeState.selectedSource = 'NONE'

    const selected = this.selectMergeSource(eligible)
    if (selected !== 'NONE') {
      this.mergeState.selectedSource = selected
      this.transferFromFeederToT(selected)
    }
  }

  private selectMergeSource(eligible: Record<SourceId, boolean>): SourceId | 'NONE' {
    const order: SourceId[] = ['A', 'B', 'C']
    let idx = order.indexOf(this.mergeState.nextPriority)
    for (let i = 0; i < order.length; i++) {
      const sourceId = order[(idx + i) % order.length]
      if (eligible[sourceId]) return sourceId
    }
    return 'NONE'
  }

  private transferFromFeederToT(sourceId: SourceId) {
    const feederSegmentId = sourceId === 'C' ? 'C1' : `${sourceId}1T`
    const feederSeg = this.segmentsMap.get(feederSegmentId)
    const targetTrays = this.trays.filter((t) => t.currentSegmentId === feederSegmentId)
    if (!feederSeg || targetTrays.length === 0) return
    const lastTray = targetTrays.reduce((max, t) => (t.positionFt > max.positionFt ? t : max), targetTrays[0])
    if (lastTray.positionFt < feederSeg.config.lengthFt - EPS) return
    const allowedIntoNext = this.allowedEntryDistance('T')
    if (allowedIntoNext <= EPS) return
    if (sourceId === 'A' || sourceId === 'B' || sourceId === 'C') {
      lastTray.currentSegmentId = 'T'
      lastTray.positionFt = Math.min(allowedIntoNext, 0)
      lastTray.status = 'MOVING'
      this.advanceMergePointer(sourceId)
      if (sourceId === 'A') this.mergeState.cumulativeTransfersA += 1
      if (sourceId === 'B') this.mergeState.cumulativeTransfersB += 1
      if (sourceId === 'C') this.mergeState.cumulativeTransfersC += 1
    }
  }

  private advanceMergePointer(sourceId: SourceId) {
    if (sourceId === 'A') this.mergeState.nextPriority = 'B'
    else if (sourceId === 'B') this.mergeState.nextPriority = 'C'
    else this.mergeState.nextPriority = 'A'
  }

  private tryTransferToNextSegment(t: Tray, currentSegmentId: string, nextId: string, distance: number): boolean {
    const isMergeFeeder = ['A1T', 'B1T', 'C1'].includes(currentSegmentId)
    if (nextId === 'T' && isMergeFeeder && this.sourcesState.length > 1) {
      return false
    }
    const allowedIntoNext = this.allowedEntryDistance(nextId)
    if (allowedIntoNext <= EPS) return false
    t.currentSegmentId = nextId
    const enterDist = Math.min(distance, allowedIntoNext)
    t.positionFt = enterDist
    return true
  }

  private allowedEntryDistance(segmentId: string): number {
    const seg = this.segmentsMap.get(segmentId)!.config
    const traysOn = this.trays.filter((t) => t.currentSegmentId === segmentId)
    const occupancy = traysOn.length
    if (seg.maxOccupancy !== undefined && occupancy >= seg.maxOccupancy) return 0
    if (traysOn.length === 0) return Infinity
    const nearest = traysOn.reduce((min, t) => (t.positionFt < min.positionFt ? t : min), traysOn[0])
    const allowed = nearest.positionFt - this.trayPitchFt
    return Math.max(0, allowed)
  }

  private canEnterSegment(segmentId: string, desiredEntryDist: number): boolean {
    const seg = this.segmentsMap.get(segmentId)!.config
    const traysOn = this.trays.filter((t) => t.currentSegmentId === segmentId)
    const occupancy = traysOn.length
    if (seg.maxOccupancy !== undefined && occupancy >= seg.maxOccupancy) return false
    if (traysOn.length === 0) return true
    const nearest = traysOn.reduce((min, t) => (t.positionFt < min.positionFt ? t : min), traysOn[0])
    return nearest.positionFt - this.trayPitchFt >= desiredEntryDist - EPS
  }

  reset() {
    this.timeSec = 0
    this.trays = []
    this.totalTraysCreated = 0
    this.sourcesState = this.sourcesConfig.map((cfg) => ({
      id: cfg.id,
      enabled: true,
      sourceReady: false,
      sourceBlocked: false,
      lastSourceReleaseTime: cfg.initialOffsetSec - this.sourceHeadwaySec,
      nextReleaseTime: cfg.initialOffsetSec,
      totalTraysCreated: 0,
      headwaySec: this.sourceHeadwaySec,
      initialOffsetSec: cfg.initialOffsetSec,
      firstSegmentId: cfg.firstSegmentId,
    }))
    this.mergeState = {
      nextPriority: 'A',
      eligibleA: false,
      eligibleB: false,
      eligibleC: false,
      selectedSource: 'NONE',
      cumulativeTransfersA: 0,
      cumulativeTransfersB: 0,
      cumulativeTransfersC: 0,
    }
  }

  getState(): SimulationStateWithProgress {
    const segments = this.segmentsOrder.map((s) => ({ ...s }))
    const totalRouteDistance = segments.reduce((acc, s) => acc + s.lengthFt, 0)
    const segmentStats = segments.map((s) => {
      const occ = this.trays.filter((t) => t.currentSegmentId === s.id).length
      const capacity = s.maxOccupancy ?? Math.floor(s.lengthFt / this.trayPitchFt)
      const pct = capacity > 0 ? (occ / capacity) * 100 : undefined
      return { id: s.id, occupancy: occ, capacity: s.maxOccupancy, occupancyPct: pct }
    })
    const movingCount = this.trays.filter((t) => t.status === 'MOVING').length
    const blockedCount = this.trays.filter((t) => t.status === 'BLOCKED').length
    const materialBalanceError = this.trays.length - this.totalTraysCreated
    const sources = this.sourcesState.map((s) => ({ ...s }))
    const sourceState = sources[0] ?? {
      id: 'A' as SourceId,
      enabled: false,
      sourceReady: false,
      sourceBlocked: false,
      lastSourceReleaseTime: -this.sourceHeadwaySec,
      nextReleaseTime: 0,
      totalTraysCreated: 0,
      headwaySec: this.sourceHeadwaySec,
      initialOffsetSec: 0,
      firstSegmentId: this.segmentsOrder[0]?.id ?? '',
    }

    return {
      timeSec: this.timeSec,
      trays: this.trays.map((t) => ({ ...t })),
      segments,
      source: sourceState,
      sources,
      mergeState: { ...this.mergeState },
      segmentStats,
      movingCount,
      blockedCount,
      totalTraysCreated: this.totalTraysCreated,
      materialBalanceError,
      totalRouteDistance,
    }
  }
}

export default SimulationEngine
