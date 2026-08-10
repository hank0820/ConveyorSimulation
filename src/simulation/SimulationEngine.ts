import type { Tray, ConveyorSegmentConfig, SimulationState } from './types'
import ConveyorSegment from './ConveyorSegment'

export class SimulationEngine {
  private timeSec = 0
  private tray: Tray
  private conveyor: ConveyorSegment

  constructor(conveyorConfig: ConveyorSegmentConfig, initialTray?: Tray) {
    this.conveyor = new ConveyorSegment(conveyorConfig)
    this.tray = initialTray ?? { id: 1, positionFt: 0 }
  }

  step(seconds: number) {
    if (seconds <= 0) return
    this.timeSec += seconds
    const potential = this.tray.positionFt + this.conveyor.speedFtPerSec * seconds
    const max = this.conveyor.config.lengthFt
    this.tray.positionFt = Math.min(potential, max)
  }

  reset() {
    this.timeSec = 0
    this.tray.positionFt = 0
  }

  getState(): SimulationState {
    return {
      timeSec: this.timeSec,
      tray: { ...this.tray },
      conveyor: { ...this.conveyor.config },
    }
  }
}

export default SimulationEngine
