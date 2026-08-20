import type { ReturnDestination, Tray } from './types'

export interface InboundCompositeConfig {
  conveyorId: ReturnDestination
  totalLengthFt: number
  sorterSideMdrCount: number
  spiralLengthFt: number
  exchangerSideMdrCount: number
  mdrZoneLengthFt: number
  trayLengthFt: number
}

export default class InboundCompositeConveyor {
  readonly config: InboundCompositeConfig

  constructor(config: InboundCompositeConfig) {
    const componentLength = (config.sorterSideMdrCount + config.exchangerSideMdrCount) * config.mdrZoneLengthFt + config.spiralLengthFt
    if (Math.abs(componentLength - config.totalLengthFt) > 1e-9) {
      throw new Error(`${config.conveyorId} component lengths must equal total length`)
    }
    this.config = config
  }

  get spiralPositionCapacity() {
    return Math.floor(this.config.spiralLengthFt / this.config.trayLengthFt)
  }

  get positionCapacity() {
    return this.config.sorterSideMdrCount + this.spiralPositionCapacity + this.config.exchangerSideMdrCount
  }

  get nominalSpiralTraversalSec() {
    return this.config.spiralLengthFt / 2
  }

  componentTrays(trays: Tray[], component: NonNullable<Tray['inboundPlacement']>['component']) {
    return trays.filter((tray) => tray.inboundPlacement?.conveyorId === this.config.conveyorId && tray.inboundPlacement.component === component)
  }

  mdrOccupancy(trays: Tray[], component: 'MDR_SORTER_SIDE' | 'MDR_EXCHANGER_SIDE') {
    const count = component === 'MDR_SORTER_SIDE' ? this.config.sorterSideMdrCount : this.config.exchangerSideMdrCount
    const zones: (Tray | null)[] = Array(count).fill(null)
    for (const tray of this.componentTrays(trays, component)) {
      if (tray.inboundPlacement?.zoneIndex !== undefined) zones[tray.inboundPlacement.zoneIndex] = tray
    }
    return zones
  }

  spiralTrays(trays: Tray[]) {
    return this.componentTrays(trays, 'SPIRAL').sort((a, b) => (a.inboundPlacement!.spiralPosFt ?? 0) - (b.inboundPlacement!.spiralPosFt ?? 0))
  }

  updateAbsolutePosition(tray: Tray) {
    const placement = tray.inboundPlacement
    if (!placement || placement.conveyorId !== this.config.conveyorId) return
    if (placement.component === 'MDR_SORTER_SIDE') {
      tray.positionFt = ((placement.zoneIndex ?? 0) + 0.5) * this.config.mdrZoneLengthFt
    } else if (placement.component === 'SPIRAL') {
      tray.positionFt = this.config.sorterSideMdrCount * this.config.mdrZoneLengthFt + (placement.spiralPosFt ?? 0)
    } else {
      tray.positionFt = this.config.sorterSideMdrCount * this.config.mdrZoneLengthFt + this.config.spiralLengthFt
        + ((placement.zoneIndex ?? 0) + 0.5) * this.config.mdrZoneLengthFt
    }
  }
}
