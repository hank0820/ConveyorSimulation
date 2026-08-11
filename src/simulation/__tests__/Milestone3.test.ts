import { describe, it, expect } from 'vitest'
import SimulationEngine from '../SimulationEngine'

const SEGMENTS = [
  { id: 'A1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'A1T', maxOccupancy: 24 },
  { id: 'A1T', lengthFt: 59, speedFtPerMin: 120, nextSegmentId: 'T' },
  { id: 'T', lengthFt: 33, speedFtPerMin: 120, nextSegmentId: 'D', maxOccupancy: 12 },
  { id: 'D', lengthFt: 235, speedFtPerMin: 120, maxOccupancy: 73 },
]

describe('Milestone 3: multiple trays, spacing, capacity, blocking', () => {
  it('reset begins with zero trays', () => {
    const e = new SimulationEngine(SEGMENTS)
    e.reset()
    const s = e.getState()
    expect(s.trays.length).toBe(0)
    expect(s.totalTraysCreated).toBe(0)
    expect(s.materialBalanceError).toBe(0)
  })

  it('first tray may enter at t=0 on fresh engine', () => {
    const e = new SimulationEngine(SEGMENTS)
    const s = e.getState()
    expect(s.trays.length).toBeGreaterThanOrEqual(1)
    const first = s.trays[0]
    expect(first.createdAtSec).toBeCloseTo(0, 6)
  })

  it('source actual releases are never less than 8 seconds apart', () => {
    const e = new SimulationEngine(SEGMENTS)
    // engine created with first tray at t=0
    e.step(7.9)
    let s = e.getState()
    expect(s.totalTraysCreated).toBe(1)
    e.step(0.2)
    s = e.getState()
    expect(s.totalTraysCreated).toBeGreaterThanOrEqual(2)
    // check timestamps
    const times = s.trays.map(t => t.createdAtSec).sort((a,b)=>a-b)
    for (let i=1;i<times.length;i++) {
      expect(times[i] - times[i-1]).toBeGreaterThanOrEqual(7.999)
    }
  })

  it('after ~24s under free flow, expected trays according to 450/hr cadence', () => {
    const e = new SimulationEngine(SEGMENTS)
    e.step(24)
    const s = e.getState()
    // expected at least 4 (0,8,16,24)
    expect(s.totalTraysCreated).toBeGreaterThanOrEqual(4)
  })

  it('tray IDs are unique', () => {
    const e = new SimulationEngine(SEGMENTS)
    e.step(200)
    const s = e.getState()
    const ids = s.trays.map(t => t.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  it('no overtaking and spacing >= trayPitch on same segment', () => {
    const e = new SimulationEngine(SEGMENTS)
    e.step(300)
    const s = e.getState()
    const pitch = 3.0
    for (const seg of s.segments) {
      const trays = s.trays.filter(t => t.currentSegmentId === seg.id).sort((a,b)=>a.positionFt - b.positionFt)
      for (let i=0;i<trays.length-1;i++) {
        const up = trays[i]
        const down = trays[i+1]
        // upstream position must be <= downstream - pitch
        expect(up.positionFt).toBeLessThanOrEqual(down.positionFt - pitch + 1e-6)
      }
    }
  })

  it('blocking accumulates at downstream D and preserves spacing', () => {
    const e = new SimulationEngine(SEGMENTS)
    // run long enough for congestion
    e.step(1000)
    const s = e.getState()
    const dTrays = s.trays.filter(t => t.currentSegmentId === 'D').sort((a,b)=>b.positionFt - a.positionFt)
    expect(dTrays.length).toBeGreaterThanOrEqual(1)
    if (dTrays.length >= 2) {
      const first = dTrays[0]
      const second = dTrays[1]
      expect(first.positionFt - second.positionFt).toBeGreaterThanOrEqual(3.0 - 1e-6)
    }
    // material balance
    expect(s.trays.length).toBe(s.totalTraysCreated)
  })

  it('engine.step(10) equals 100 * engine.step(0.1) deterministic', () => {
    const e1 = new SimulationEngine(SEGMENTS)
    e1.step(10)
    const s1 = e1.getState()

    const e2 = new SimulationEngine(SEGMENTS)
    for (let i=0;i<100;i++) e2.step(0.1)
    const s2 = e2.getState()

    expect(s1.trays.length).toBe(s2.trays.length)
    expect(s1.totalTraysCreated).toBe(s2.totalTraysCreated)
    // compare positions of trays by id
    const map2 = new Map(s2.trays.map(t=>[t.id,t]))
    for (const t of s1.trays) {
      const t2 = map2.get(t.id)
      expect(t2).toBeDefined()
      expect(t.positionFt).toBeCloseTo(t2!.positionFt, 6)
      expect(t.currentSegmentId).toBe(t2!.currentSegmentId)
    }
  })
})
