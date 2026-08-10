export interface Tray {
  id: number
  positionFt: number
}

export interface ConveyorSegmentConfig {
  id: string
  lengthFt: number
  speedFtPerMin: number
}

export interface SimulationState {
  timeSec: number
  tray: Tray
  conveyor: ConveyorSegmentConfig
}
