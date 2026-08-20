import { test, expect } from 'vitest'
import SimulationEngine from '../SimulationEngine'

const SEGMENTS = [
  { id: 'A1', lengthFt: 103.5, speedFtPerMin: 120, nextSegmentId: 'A1T', maxOccupancy: 45 },
  { id: 'A1T', lengthFt: 59, speedFtPerMin: 120, nextSegmentId: 'T' },
  { id: 'B1', lengthFt: 86, speedFtPerMin: 120, nextSegmentId: 'B1T', maxOccupancy: 38 },
  { id: 'B1T', lengthFt: 44, speedFtPerMin: 120, nextSegmentId: 'T' },
  { id: 'C1', lengthFt: 86, speedFtPerMin: 120, nextSegmentId: 'T', maxOccupancy: 38 },
  { id: 'T', lengthFt: 33, speedFtPerMin: 120, nextSegmentId: 'D', maxOccupancy: 12 },
  { id: 'D', lengthFt: 230, speedFtPerMin: 120, maxOccupancy: 92 },
]

test('reset initializes hybrid piles with expected initial counts and non-overlapping positions', () => {
  const e = new SimulationEngine(SEGMENTS)
  e.reset()
  const s = e.getState()

  // Initial target inventory fills from the physical discharge end backward.
  expect(s.preDetrayerMdrA).toBe(0)
  expect(s.postDetrayerMdrA).toBe(0)
  expect(s.beltCountA).toBe(9)
  expect(s.downstreamMdrA).toBe(15)
  expect(s.pendingA).toBeDefined()
  expect(s.pendingA).toBeGreaterThanOrEqual(0)
  expect(s.trays.filter(t => t.currentSegmentId === 'A1').length).toBe(24)

  // B1 and C1 initial counts
  expect(s.preDetrayerMdrB).toBe(0)
  expect(s.postDetrayerMdrB).toBe(0)
  expect(s.beltCountB).toBe(8)
  expect(s.downstreamMdrB).toBe(8)
  expect(s.trays.filter(t => t.currentSegmentId === 'B1').length).toBe(16)

  expect(s.preDetrayerMdrC).toBe(0)
  expect(s.postDetrayerMdrC).toBe(0)
  expect(s.beltCountC).toBe(8)
  expect(s.downstreamMdrC).toBe(8)
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
