import type { Tray, ConveyorSegmentConfig, SimulationStateWithProgress } from './types'
import ConveyorSegment from './ConveyorSegment'

const INTERNAL_TICK_SECONDS = 0.1
const EPS = 1e-9

export class SimulationEngine {
  private timeSec = 0
  private trays: Tray[] = []
  private segmentsMap: Map<string, ConveyorSegment>
  private segmentsOrder: ConveyorSegmentConfig[]

  // source + physical params
  private trayPitchFt: number
  private sourceEnabled = true
  private sourceHeadwaySec: number
  private lastSourceReleaseTime: number
  private totalTraysCreated = 0

  constructor(segmentConfigs: ConveyorSegmentConfig[], options?: { trayPitchFt?: number; sourceRatePerHour?: number; sourceEnabled?: boolean }) {
    this.segmentsMap = new Map(segmentConfigs.map((c) => [c.id, new ConveyorSegment(c)]))
    this.segmentsOrder = segmentConfigs
    this.trayPitchFt = options?.trayPitchFt ?? 3.0
    const rate = options?.sourceRatePerHour ?? 450
    this.sourceHeadwaySec = 3600 / rate
    this.sourceEnabled = options?.sourceEnabled ?? true
    // allow first tray at t=0
    this.lastSourceReleaseTime = -this.sourceHeadwaySec
    this.totalTraysCreated = 0
    // allow first injection at t=0 if headway permits
    this.tryInjectSource()
  }

  step(seconds: number) {
    if (seconds <= 0) return
    let remaining = seconds
    while (remaining > 0) {
      const delta = Math.min(INTERNAL_TICK_SECONDS, remaining)
      remaining -= delta
      this.timeSec += delta
      // try to inject from source at start of tick
      this.tryInjectSource()
      this.processTick(delta)
    }
  }

  private tryInjectSource() {
    if (!this.sourceEnabled) return
    const elapsed = this.timeSec - this.lastSourceReleaseTime
    const headwayPassed = elapsed + EPS >= this.sourceHeadwaySec
    // A1 is the first segment
    const firstSeg = this.segmentsOrder[0]
    if (!firstSeg) return
    const canEnter = this.canEnterSegment(firstSeg.id, 0)
    if (headwayPassed && canEnter) {
      // create tray at position 0
      this.totalTraysCreated += 1
      const tray: Tray = {
        id: this.totalTraysCreated,
        currentSegmentId: firstSeg.id,
        positionFt: 0,
        status: 'MOVING',
        createdAtSec: this.timeSec,
      }
      this.trays.push(tray)
      this.lastSourceReleaseTime = this.timeSec
    }
  }

  private processTick(deltaSec: number) {
    // Process trays in downstream-to-upstream order
    const segmentIndex: Record<string, number> = {}
    this.segmentsOrder.forEach((s, i) => (segmentIndex[s.id] = i))

    // sort trays: downstream segments have higher index, within segment sort by position desc
    const traysOrder = this.trays.slice().sort((a, b) => {
      const ia = segmentIndex[a.currentSegmentId]
      const ib = segmentIndex[b.currentSegmentId]
      if (ia !== ib) return ib - ia
      return b.positionFt - a.positionFt
    })

    // movement map updated in place
    for (const t of traysOrder) {
      if (t.status !== 'MOVING' && t.status !== 'BLOCKED') continue
      // desired movement this tick
      const segConfig = this.segmentsMap.get(t.currentSegmentId)!.config
      let distance = (segConfig.speedFtPerMin / 60) * deltaSec

      // attempt to move respecting downstream constraints and transfers
      let moved = 0
      let blocked = false
      while (distance > EPS && !blocked) {
        const seg = this.segmentsMap.get(t.currentSegmentId)!
        const remainingOnSegment = seg.config.lengthFt - t.positionFt

        // if already at segment end, immediately attempt transfer
        if (remainingOnSegment <= EPS) {
          const nextId = seg.config.nextSegmentId
          if (nextId) {
            const allowedIntoNext = this.allowedEntryDistance(nextId)
            if (allowedIntoNext > EPS) {
              t.currentSegmentId = nextId
              const enterDist = Math.min(distance, allowedIntoNext)
              t.positionFt = enterDist
              moved += enterDist
              distance -= enterDist
              t.status = 'MOVING'
              continue
            }
          }

          t.positionFt = seg.config.lengthFt
          t.status = 'BLOCKED'
          blocked = true
          break
        }

        // constraint by downstream tray on same segment
        const downstreamNeighbor = this.findDownstreamNeighborOnSameSegment(t)
        let maxByNeighbor = remainingOnSegment
        if (downstreamNeighbor) {
          const gap = downstreamNeighbor.positionFt - t.positionFt - this.trayPitchFt
          maxByNeighbor = Math.max(0, Math.min(maxByNeighbor, gap))
        }

        if (distance <= maxByNeighbor + EPS) {
          // can move within segment
          t.positionFt += distance
          moved += distance
          distance = 0

          if (t.positionFt >= seg.config.lengthFt - EPS) {
            const nextId = seg.config.nextSegmentId
            if (nextId) {
              const allowedIntoNext = this.allowedEntryDistance(nextId)
              if (allowedIntoNext > EPS) {
                t.currentSegmentId = nextId
                t.positionFt = 0
                t.status = 'MOVING'
                continue
              }
            }
            t.positionFt = seg.config.lengthFt
            t.status = 'BLOCKED'
            blocked = true
          } else {
            t.status = 'MOVING'
          }
          break
        }

        // if blocked before segment end, stop and block
        const isBlockedByNeighbor = maxByNeighbor + EPS < remainingOnSegment
        if (maxByNeighbor <= EPS && !isBlockedByNeighbor) {
          // no movement possible, remain blocked
          t.status = 'BLOCKED'
          blocked = true
          break
        }

        t.positionFt += maxByNeighbor
        moved += maxByNeighbor
        distance -= maxByNeighbor

        if (isBlockedByNeighbor) {
          t.status = 'BLOCKED'
          blocked = true
          break
        }

        // now at end; attempt transfer if there's overflow remaining
        const nextId = seg.config.nextSegmentId
        if (nextId) {
          const allowedIntoNext = this.allowedEntryDistance(nextId)
          if (allowedIntoNext <= EPS) {
            // cannot enter next segment now -> blocked at end
            t.positionFt = seg.config.lengthFt
            t.status = 'BLOCKED'
            blocked = true
            break
          } else {
            // enter next segment with up to allowedIntoNext
            t.currentSegmentId = nextId
            const enterDist = Math.min(distance, allowedIntoNext)
            t.positionFt = enterDist
            moved += enterDist
            distance -= enterDist
            t.status = 'MOVING'
            continue
          }
        } else {
          // downstream boundary CLOSED: remain at end and become BLOCKED
          t.positionFt = seg.config.lengthFt
          t.status = 'BLOCKED'
          blocked = true
          break
        }
      }
    }
  }

  private findDownstreamNeighborOnSameSegment(tray: Tray): Tray | undefined {
    const same = this.trays.filter((t) => t.currentSegmentId === tray.currentSegmentId && t.id !== tray.id)
    let candidates = same.filter((t) => t.positionFt > tray.positionFt + EPS)
    if (candidates.length === 0) return undefined
    // nearest downstream (smallest position > tray.position)
    candidates.sort((a, b) => a.positionFt - b.positionFt)
    return candidates[0]
  }

  private allowedEntryDistance(segmentId: string): number {
    const seg = this.segmentsMap.get(segmentId)!.config
    const traysOn = this.trays.filter((t) => t.currentSegmentId === segmentId)
    const occupancy = traysOn.length
    if (seg.maxOccupancy !== undefined && occupancy >= seg.maxOccupancy) return 0

    // spacing constraint: find nearest tray to start
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
    // spacing
    if (traysOn.length === 0) return true
    const nearest = traysOn.reduce((min, t) => (t.positionFt < min.positionFt ? t : min), traysOn[0])
    return nearest.positionFt - this.trayPitchFt >= desiredEntryDist - EPS
  }

  reset() {
    this.timeSec = 0
    this.trays = []
    this.totalTraysCreated = 0
    this.lastSourceReleaseTime = -this.sourceHeadwaySec
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
    const sourceState = {
      enabled: this.sourceEnabled,
      sourceReady: this.timeSec - this.lastSourceReleaseTime >= this.sourceHeadwaySec - EPS,
      sourceBlocked: !this.canEnterSegment(this.segmentsOrder[0].id, 0),
      lastSourceReleaseTime: this.lastSourceReleaseTime,
      totalTraysCreated: this.totalTraysCreated,
      headwaySec: this.sourceHeadwaySec,
    }

    return {
      timeSec: this.timeSec,
      trays: this.trays.map((t) => ({ ...t })),
      segments,
      source: sourceState,
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
