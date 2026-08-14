import type { Tray } from './types'

export interface HybridPileConfig {
  pileId: string
  totalLengthFt: number
  upstreamMdrCount: number
  downstreamMdrCount: number
  beltLengthFt: number
  mdrZoneLengthFt: number
  trayLengthFt: number
}

export default class HybridAccumulationPile {
  config: HybridPileConfig

  constructor(cfg: HybridPileConfig) {
    this.config = cfg
  }

  // number of discrete MDR positions (upstream + downstream)
  getMdrPositions(): number {
    return this.config.upstreamMdrCount + this.config.downstreamMdrCount
  }

  // nominal/design positions = MDR positions + 1 guaranteed belt position
  getDesignPositions(): number {
    return this.getMdrPositions() + 1
  }

  // produce initial trays occupying all MDR zones and one belt tray centered
  initialTrays(startingId: number, origin: 'A' | 'B' | 'C') {
    const trays: Tray[] = []
    let id = startingId

    // upstream MDR zones: index 0 .. upstreamMdrCount-1
    for (let i = 0; i < this.config.upstreamMdrCount; i++) {
      const pos = (i + 0.5) * this.config.mdrZoneLengthFt // center
      trays.push({
        id: id++,
        currentSegmentId: this.config.pileId,
        positionFt: pos,
        status: 'BLOCKED',
        createdAtSec: 0,
        originSourceId: origin,
        pilePlacement: { pileId: this.config.pileId, component: 'MDR_UPSTREAM', zoneIndex: i },
      } as Tray)
    }

    // belt: one centered tray
    const beltCenter = this.config.upstreamMdrCount * this.config.mdrZoneLengthFt + this.config.beltLengthFt / 2
    trays.push({
      id: id++,
      currentSegmentId: this.config.pileId,
      positionFt: beltCenter,
      status: 'BLOCKED',
      createdAtSec: 0,
      originSourceId: origin,
      pilePlacement: { pileId: this.config.pileId, component: 'BELT', beltPosFt: this.config.beltLengthFt / 2 },
    } as Tray)

    // downstream MDR zones
    for (let i = 0; i < this.config.downstreamMdrCount; i++) {
      const zoneIndex = i
      const offset = this.config.upstreamMdrCount * this.config.mdrZoneLengthFt + this.config.beltLengthFt + (i + 0.5) * this.config.mdrZoneLengthFt
      trays.push({
        id: id++,
        currentSegmentId: this.config.pileId,
        positionFt: offset,
        status: 'BLOCKED',
        createdAtSec: 0,
        originSourceId: origin,
        pilePlacement: { pileId: this.config.pileId, component: 'MDR_DOWNSTREAM', zoneIndex },
      } as Tray)
    }

    return { trays, nextId: id }
  }
}
