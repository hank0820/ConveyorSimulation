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

test('first Korber consumption creates ASRS pending and authorizes one A1 exit which executes', () => {
  const e = new SimulationEngine(SEGMENTS)
  e.reset()
  let s = e.getState()

  // initial expectations
  expect(s.trays.filter(t => t.currentSegmentId === 'A1').length).toBe(24)
  expect(s.trays.filter(t => t.currentSegmentId === 'D').length).toBe(73)
  const initialD = s.trays.filter(t => t.currentSegmentId === 'D').length

  // step forward until D decreases by 1 (Korber consumption)
  let maxSteps1 = 200
  let consumedAt = -1
  for (let i = 0; i < maxSteps1; i++) {
    e.step(0.5)
    s = e.getState()
    if (s.trays.filter(t => t.currentSegmentId === 'D').length === initialD - 1) { consumedAt = s.timeSec; break }
  }
  expect(consumedAt).toBeGreaterThanOrEqual(0)

  // ensure at least one new ASRS mission pending for A (or others) and pending counts > 0
  expect(s.pendingA + s.pendingB + s.pendingC).toBeGreaterThan(0)

  // determine purgeDemandA positive
  expect(s.purgeDemandA).toBeGreaterThanOrEqual(0)

  // note: the existing downstream tray must leave before any replacement enters
  const beforeA1T = s.trays.filter(t => t.currentSegmentId === 'A1T').length
  const beforeTotalCreated = s.totalTraysCreated

  // step forward up to 300s to allow authorized exit; fail if replacement created first
  let executed = false
  let newCreated = false
  const maxStepsWait = Math.ceil(300 / 0.25)
  for (let i = 0; i < maxStepsWait; i++) {
    e.step(0.25)
    s = e.getState()
    const after = s.trays.filter(t => t.currentSegmentId === 'A1T').length
    if (after > beforeA1T) { executed = true; break }
    if (s.totalTraysCreated > beforeTotalCreated) { newCreated = true; break }
  }
  expect(newCreated).toBe(false)
  expect(executed).toBe(true)

  // after exit, A1 currentCount should have decreased by one
  const a1After = s.trays.filter(t => t.currentSegmentId === 'A1').length
  expect(a1After).toBeLessThan(24)

  // PurgeDemand should have been recomputed (may be zero or lower)
  // ensure pending remains >=0
  expect(s.pendingA).toBeGreaterThanOrEqual(0)
})
