import { describe, it, expect, beforeEach } from 'vitest'
import SimulationEngine from '../SimulationEngine'

const CONVEYOR_CONFIG = { id: 'TEST_CONVEYOR', lengthFt: 120, speedFtPerMin: 120 }

describe('SimulationEngine', () => {
  let engine: SimulationEngine

  beforeEach(() => {
    engine = new SimulationEngine(CONVEYOR_CONFIG)
  })

  it('initial tray position is 0 and time is 0', () => {
    const s = engine.getState()
    expect(s.timeSec).toBe(0)
    expect(s.tray.positionFt).toBe(0)
  })

  it('after 1 second position is 2 ft', () => {
    engine.step(1)
    const s = engine.getState()
    expect(s.timeSec).toBe(1)
    expect(s.tray.positionFt).toBeCloseTo(2)
  })

  it('after 10 seconds position is 20 ft', () => {
    engine.step(10)
    const s = engine.getState()
    expect(s.tray.positionFt).toBeCloseTo(20)
  })

  it('after 60 seconds position is 120 ft', () => {
    engine.step(60)
    const s = engine.getState()
    expect(s.tray.positionFt).toBeCloseTo(120)
  })

  it('stepping beyond 60 seconds does not exceed conveyor length', () => {
    engine.step(1000)
    const s = engine.getState()
    expect(s.tray.positionFt).toBeCloseTo(120)
  })

  it('reset returns time and position to zero', () => {
    engine.step(5)
    engine.reset()
    const s = engine.getState()
    expect(s.timeSec).toBe(0)
    expect(s.tray.positionFt).toBe(0)
  })
})
