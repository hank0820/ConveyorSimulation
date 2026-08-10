export type TrayStatus = 'MOVING' | 'COMPLETE'

export interface Tray {
  id: number
  currentSegmentId: string
  positionFt: number
  status: TrayStatus
}

export interface ConveyorSegmentConfig {
  id: string
  lengthFt: number
  speedFtPerMin: number
  nextSegmentId?: string
}

export interface SimulationState {
  timeSec: number
  tray: Tray
  segments: ConveyorSegmentConfig[]
}

export interface SimulationStateWithProgress extends SimulationState {
  totalRouteDistance: number
  distanceCompleted: number
  routeProgress: number // 0..100
}
