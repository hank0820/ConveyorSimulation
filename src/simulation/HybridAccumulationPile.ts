import type { SourceId, Tray } from './types'

export interface HybridPileConfig {
  pileId: string
  totalLengthFt: number
  preDetrayerMdrCount: number
  postDetrayerMdrCount: number
  downstreamMdrCount: number
  beltLengthFt: number
  mdrZoneLengthFt: number
  trayLengthFt: number
}

type InitialPosition = NonNullable<Tray['pilePlacement']>

export default class HybridAccumulationPile {
  config: HybridPileConfig

  constructor(cfg: HybridPileConfig) {
    this.config = cfg
  }

  getMdrPositions(): number {
    return this.config.preDetrayerMdrCount + this.config.postDetrayerMdrCount + this.config.downstreamMdrCount
  }

  getBeltPositions(): number {
    return Math.floor(this.config.beltLengthFt / this.config.trayLengthFt)
  }

  getPhysicalCapacity(): number {
    return this.getMdrPositions() + this.getBeltPositions()
  }

  getNominalBeltTraversalSec(speedFtPerMin = 120): number {
    return this.config.beltLengthFt / (speedFtPerMin / 60)
  }

  private absolutePosition(placement: InitialPosition): number {
    const preLength = this.config.preDetrayerMdrCount * this.config.mdrZoneLengthFt
    const postLength = this.config.postDetrayerMdrCount * this.config.mdrZoneLengthFt
    if (placement.component === 'MDR_PRE_DETRAYER') return ((placement.zoneIndex ?? 0) + 0.5) * this.config.mdrZoneLengthFt
    if (placement.component === 'MDR_POST_DETRAYER') return preLength + ((placement.zoneIndex ?? 0) + 0.5) * this.config.mdrZoneLengthFt
    if (placement.component === 'BELT') return preLength + postLength + (placement.beltPosFt ?? 0)
    return preLength + postLength + this.config.beltLengthFt + ((placement.zoneIndex ?? 0) + 0.5) * this.config.mdrZoneLengthFt
  }

  private positionsFromDischargeBackward(): InitialPosition[] {
    const positions: InitialPosition[] = []
    for (let index = this.config.downstreamMdrCount - 1; index >= 0; index--) {
      positions.push({ pileId: this.config.pileId, component: 'MDR_DOWNSTREAM', zoneIndex: index })
    }
    const halfTray = this.config.trayLengthFt / 2
    const maximumCenter = this.config.beltLengthFt - halfTray
    for (let index = 0; index < this.getBeltPositions(); index++) {
      positions.push({ pileId: this.config.pileId, component: 'BELT', beltPosFt: maximumCenter - index * this.config.trayLengthFt })
    }
    for (let index = this.config.postDetrayerMdrCount - 1; index >= 0; index--) {
      positions.push({ pileId: this.config.pileId, component: 'MDR_POST_DETRAYER', zoneIndex: index })
    }
    for (let index = this.config.preDetrayerMdrCount - 1; index >= 0; index--) {
      positions.push({ pileId: this.config.pileId, component: 'MDR_PRE_DETRAYER', zoneIndex: index })
    }
    return positions
  }

  initialTrays(startingId: number, origin: SourceId, trayCount: number) {
    if (!Number.isInteger(trayCount) || trayCount < 0 || trayCount > this.getPhysicalCapacity()) {
      throw new Error(`${this.config.pileId} initial tray count ${trayCount} exceeds physical capacity ${this.getPhysicalCapacity()}`)
    }
    let nextId = startingId
    const trays = this.positionsFromDischargeBackward().slice(0, trayCount).map((pilePlacement): Tray => ({
      id: nextId++,
      currentSegmentId: this.config.pileId,
      positionFt: this.absolutePosition(pilePlacement),
      status: 'BLOCKED',
      createdAtSec: 0,
      originSourceId: origin,
      pilePlacement,
    }))
    return { trays, nextId }
  }
}
