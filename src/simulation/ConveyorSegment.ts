import type { ConveyorSegmentConfig } from './types'

export class ConveyorSegment {
  public config: ConveyorSegmentConfig

  constructor(config: ConveyorSegmentConfig) {
    this.config = config
  }

  get speedFtPerSec(): number {
    return this.config.speedFtPerMin / 60
  }
}

export default ConveyorSegment
