import { describe, it, expect, beforeEach } from 'vitest'
import SimulationEngine from '../SimulationEngine'

const SEGMENTS = [
  { id: 'A1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'A1T' },
  { id: 'A1T', lengthFt: 59, speedFtPerMin: 120, nextSegmentId: 'T' },
  { id: 'T', lengthFt: 33, speedFtPerMin: 120, nextSegmentId: 'D' },
  { id: 'D', lengthFt: 235, speedFtPerMin: 120 },
]

describe('SimulationEngine multi-segment', () => {
  let engine: SimulationEngine

  beforeEach(() => {
    engine = new SimulationEngine(SEGMENTS)
  })

  it('initial state is on A1 at position 0', () => {
    const s = engine.getState()
    const first = s.trays[0]
    expect(first.currentSegmentId).toBe('A1')
    expect(first.positionFt).toBeCloseTo(0)
  })

  it('at 40s still on A1 near 80 ft', () => {
    engine.step(40)
    const s = engine.getState()
    const first = s.trays[0]
    expect(first.currentSegmentId).toBe('A1')
    expect(first.positionFt).toBeCloseTo(80, 6)
  })

  it('at 40.5s transitions to A1T', () => {
    engine.step(40.5)
    const s = engine.getState()
    const first = s.trays[0]
    expect(first.currentSegmentId).toBe('A1T')
    expect(first.positionFt).toBeCloseTo(0, 6)
  })

  it('at 41s is ~1 ft into A1T', () => {
    engine.step(41)
    const s = engine.getState()
    const first = s.trays[0]
    expect(first.currentSegmentId).toBe('A1T')
    expect(first.positionFt).toBeCloseTo(1, 6)
  })

  it('at 70s reaches T', () => {
    engine.step(70)
    const s = engine.getState()
    const first = s.trays[0]
    expect(first.currentSegmentId).toBe('T')
    expect(first.positionFt).toBeCloseTo(0, 6)
  })

  it('at 86.5s reaches D', () => {
    engine.step(86.5)
    const s = engine.getState()
    const first = s.trays[0]
    expect(first.currentSegmentId).toBe('D')
    expect(first.positionFt).toBeCloseTo(0, 6)
  })

  it('at 100s is on D at ~27 ft', () => {
    engine.step(100)
    const s = engine.getState()
    const first = s.trays[0]
    expect(first.currentSegmentId).toBe('D')
    expect(first.positionFt).toBeCloseTo(27, 6)
  })

  it('at 204s completes at end of D', () => {
    engine.step(204)
    const s = engine.getState()
    const first = s.trays[0]
    expect(first.currentSegmentId).toBe('D')
    expect(first.positionFt).toBeCloseTo(235, 6)
    expect(first.status).toBe('BLOCKED')
  })

  it('at 300s remains complete at end of D', () => {
    engine.step(300)
    const s = engine.getState()
    const first = s.trays[0]
    expect(first.currentSegmentId).toBe('D')
    expect(first.positionFt).toBeCloseTo(235, 6)
    expect(first.status).toBe('BLOCKED')
  })

  it('total route time is ~204 sec', () => {
    engine.step(204)
    const s = engine.getState()
    expect(s.timeSec).toBeCloseTo(204, 6)
  })

  it('engine.step(10) equals 100 * engine.step(0.1)', () => {
    const e1 = new SimulationEngine(SEGMENTS)
    e1.step(10)
    const s1 = e1.getState()

    const e2 = new SimulationEngine(SEGMENTS)
    for (let i = 0; i < 100; i++) e2.step(0.1)
    const s2 = e2.getState()

    const t1 = s1.trays[0]
    const t2 = s2.trays[0]
    expect(t1.positionFt).toBeCloseTo(t2.positionFt, 6)
    expect(t1.currentSegmentId).toBe(t2.currentSegmentId)
    expect(s1.timeSec).toBeCloseTo(s2.timeSec, 6)
  })

})
