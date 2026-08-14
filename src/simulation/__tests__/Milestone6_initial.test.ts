import { test, expect } from 'vitest'
import SimulationEngine from '../SimulationEngine'

const SEGMENTS = [
  { id: 'A1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'A1T', maxOccupancy: 24 },
  { id: 'A1T', lengthFt: 59, speedFtPerMin: 120, nextSegmentId: 'T' },
  { id: 'B1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'B1T', maxOccupancy: 16 },
  { id: 'B1T', lengthFt: 44, speedFtPerMin: 120, nextSegmentId: 'T' },
  { id: 'C1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'T', maxOccupancy: 16 },
  { id: 'T', lengthFt: 33, speedFtPerMin: 120, nextSegmentId: 'D', maxOccupancy: 12 },
  { id: 'D', lengthFt: 235, speedFtPerMin: 120, maxOccupancy: 73 },
]

test('reset initializes hybrid piles with expected initial counts and non-overlapping positions', () => {
  const e = new SimulationEngine(SEGMENTS)
  e.reset()
  const s = e.getState()

  // A1 should have 24 total trays, with upstream 8, belt 1, downstream 15
  expect(s.upstreamMdrA).toBe(8)
  expect(s.beltCountA).toBe(1)
  expect(s.downstreamMdrA).toBe(15)
  expect(s.pendingA).toBeDefined()
  expect(s.pendingA).toBeGreaterThanOrEqual(0)
  expect(s.trays.filter(t => t.currentSegmentId === 'A1').length).toBe(24)

  // B1 and C1 initial counts
  expect(s.upstreamMdrB).toBe(8)
  expect(s.beltCountB).toBe(1)
  expect(s.downstreamMdrB).toBe(7)
  expect(s.trays.filter(t => t.currentSegmentId === 'B1').length).toBe(16)

  expect(s.upstreamMdrC).toBe(8)
  expect(s.beltCountC).toBe(1)
  expect(s.downstreamMdrC).toBe(7)
  expect(s.trays.filter(t => t.currentSegmentId === 'C1').length).toBe(16)

  // verify tray positions within each pile do not overlap (simple pairwise check)
  const checkNoOverlap = (pileId: string) => {
    const trays = s.trays.filter(t => t.currentSegmentId === pileId)
    for (let i = 0; i < trays.length; i++) {
      for (let j = i + 1; j < trays.length; j++) {
        const a = trays[i].positionFt
        const b = trays[j].positionFt
        expect(Math.abs(a - b)).toBeGreaterThanOrEqual(0.5) // at least small gap
      }
    }
  }

  checkNoOverlap('A1')
  checkNoOverlap('B1')
  checkNoOverlap('C1')
})
