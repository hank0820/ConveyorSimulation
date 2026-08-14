import { describe, expect, test } from 'vitest'
import SimulationEngine from '../SimulationEngine'

const MILESTONE_7_SEGMENTS = [
  { id: 'A1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'PRE_T', maxOccupancy: 24 },
  { id: 'B1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'PRE_T', maxOccupancy: 16 },
  { id: 'C1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'T', maxOccupancy: 16 },
  { id: 'PRE_T', lengthFt: 20, speedFtPerMin: 120, nextSegmentId: 'T', maxOccupancy: 8 },
  { id: 'T', lengthFt: 30, speedFtPerMin: 120, nextSegmentId: 'D', maxOccupancy: 12 },
  { id: 'D', lengthFt: 235, speedFtPerMin: 120, maxOccupancy: 94 },
]

describe('Milestone 7 reported-defect reproductions', () => {
  test('C1 exit-zone trays can release into an available T', () => {
    const engine = new SimulationEngine(MILESTONE_7_SEGMENTS)
    engine.reset()
    engine.step(220)
    expect(engine.getState().mergeState.cumulativeTransfersC).toBeGreaterThan(0)
  })

  test('Körber waits a full interval and requires a tray at D physical end', () => {
    const engine = new SimulationEngine(MILESTONE_7_SEGMENTS)
    engine.reset()
    const interval = 3600 / 1050
    engine.step(interval - 0.1)
    expect(engine.getState().korber.totalConsumed).toBe(0)
  })
})
