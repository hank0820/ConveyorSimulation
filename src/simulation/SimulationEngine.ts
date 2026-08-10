import type { Tray, ConveyorSegmentConfig, SimulationStateWithProgress } from './types'
import ConveyorSegment from './ConveyorSegment'

const INTERNAL_TICK_SECONDS = 0.1
const EPS = 1e-9

export class SimulationEngine {
  private timeSec = 0
  private tray: Tray
  private segmentsMap: Map<string, ConveyorSegment>
  private segmentsOrder: ConveyorSegmentConfig[]

  constructor(segmentConfigs: ConveyorSegmentConfig[], initialTray?: Partial<Tray>) {
    this.segmentsMap = new Map(segmentConfigs.map((c) => [c.id, new ConveyorSegment(c)]))
    this.segmentsOrder = segmentConfigs
    const firstId = segmentConfigs[0].id
    this.tray = {
      id: initialTray?.id ?? 1,
      currentSegmentId: initialTray?.currentSegmentId ?? firstId,
      positionFt: initialTray?.positionFt ?? 0,
      status: initialTray?.status ?? 'MOVING',
    }
  }

  step(seconds: number) {
    if (seconds <= 0) return
    let remaining = seconds
    while (remaining > 0 && this.tray.status === 'MOVING') {
      const delta = Math.min(INTERNAL_TICK_SECONDS, remaining)
      remaining -= delta
      this.timeSec += delta
      this.processTick(delta)
    }
  }

  private processTick(deltaSec: number) {
    let seg = this.segmentsMap.get(this.tray.currentSegmentId)
    if (!seg) return
    let distance = seg.speedFtPerSec * deltaSec

    while (distance > EPS && this.tray.status === 'MOVING') {
      const remainingOnSegment = seg!.config.lengthFt - this.tray.positionFt
      if (distance + EPS < remainingOnSegment) {
        this.tray.positionFt += distance
        distance = 0
      } else {
        // consume remaining to reach end of segment
        distance -= remainingOnSegment
        // move to next segment or complete
        const nextId: string | undefined = seg!.config.nextSegmentId
        if (nextId && this.segmentsMap.has(nextId)) {
          // enter next segment with overflow distance applied
          this.tray.currentSegmentId = nextId
          this.tray.positionFt = 0
          // update seg reference for next loop
          const nextSeg: ConveyorSegment = this.segmentsMap.get(nextId)!
          // replace seg variable to reflect new segment for subsequent iterations
          seg = nextSeg
          // continue loop to apply remaining distance into next segment
        } else {
          // no next segment: clamp to end and mark complete
          this.tray.positionFt = seg!.config.lengthFt
          this.tray.status = 'COMPLETE'
          distance = 0
        }
      }
    }
  }

  reset() {
    this.timeSec = 0
    const firstId = this.segmentsOrder[0].id
    this.tray.currentSegmentId = firstId
    this.tray.positionFt = 0
    this.tray.status = 'MOVING'
  }

  getState(): SimulationStateWithProgress {
    const segments = this.segmentsOrder.map((s) => ({ ...s }))
    const totalRouteDistance = segments.reduce((acc, s) => acc + s.lengthFt, 0)
    // compute distance completed before current segment
    let before = 0
    for (const s of segments) {
      if (s.id === this.tray.currentSegmentId) break
      before += s.lengthFt
    }
    const distanceCompleted = before + this.tray.positionFt
    const routeProgress = totalRouteDistance > 0 ? (distanceCompleted / totalRouteDistance) * 100 : 0

    return {
      timeSec: this.timeSec,
      tray: { ...this.tray },
      segments,
      totalRouteDistance,
      distanceCompleted,
      routeProgress,
    }
  }
}

export default SimulationEngine
