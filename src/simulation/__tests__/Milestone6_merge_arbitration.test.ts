import { describe, expect, test } from 'vitest'
import SimulationEngine from '../SimulationEngine'
import type { MergeState, SourceId, Tray } from '../types'

const SEGMENTS = [
  { id: 'A1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'A1T', maxOccupancy: 24 },
  { id: 'A1T', lengthFt: 10, speedFtPerMin: 120, nextSegmentId: 'T' },
  { id: 'B1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'B1T', maxOccupancy: 16 },
  { id: 'B1T', lengthFt: 10, speedFtPerMin: 120, nextSegmentId: 'T' },
  { id: 'C1', lengthFt: 10, speedFtPerMin: 120, nextSegmentId: 'T', maxOccupancy: 16 },
  { id: 'T', lengthFt: 33, speedFtPerMin: 120, maxOccupancy: 12 },
]

interface MergeHarness {
  trays: Tray[]
  timeSec: number
  mergeState: MergeState
  updateMergeEligibility(): void
}

function createHarness(): { engine: SimulationEngine; harness: MergeHarness } {
  const engine = new SimulationEngine(SEGMENTS)
  engine.reset()
  return { engine, harness: engine as unknown as MergeHarness }
}

function feederId(source: SourceId): string {
  return source === 'A' ? 'A1T' : source === 'B' ? 'B1T' : 'C1'
}

function tray(id: number, segmentId: string, positionFt: number, origin: SourceId): Tray {
  return {
    id,
    currentSegmentId: segmentId,
    positionFt,
    status: 'BLOCKED',
    createdAtSec: 0,
    originSourceId: origin,
  }
}

function arbitrate(harness: MergeHarness, eligible: SourceId[], blocked = false): SourceId | 'NONE' {
  const lengths = { A: 10, B: 10, C: 10 }
  harness.trays = eligible.map((source, index) => tray(index + 1, feederId(source), lengths[source], source))
  if (blocked) harness.trays.push(tray(100, 'T', 0, 'A'))
  harness.updateMergeEligibility()
  const transferred = harness.trays.find((candidate) => candidate.currentSegmentId === 'T' && candidate.id !== 100)
  return transferred?.originSourceId ?? 'NONE'
}

describe('Milestone 6A strict merge arbitration', () => {
  test('simultaneous eligibility follows A then B then C then A', () => {
    const { harness } = createHarness()
    const selections = Array.from({ length: 4 }, () => arbitrate(harness, ['A', 'B', 'C']))
    expect(selections).toEqual(['A', 'B', 'C', 'A'])
  })

  test('an empty branch is skipped without losing cursor progression', () => {
    const { harness } = createHarness()
    expect(arbitrate(harness, ['A', 'C'])).toBe('A')
    expect(harness.mergeState.nextPriority).toBe('B')
    expect(arbitrate(harness, ['A', 'C'])).toBe('C')
    expect(harness.mergeState.nextPriority).toBe('A')
  })

  test('a skipped branch re-enters when the cursor next reaches it', () => {
    const { harness } = createHarness()
    const selections = [
      arbitrate(harness, ['A', 'B', 'C']),
      arbitrate(harness, ['A', 'C']),
      arbitrate(harness, ['A', 'B', 'C']),
      arbitrate(harness, ['A', 'B', 'C']),
    ]
    expect(selections).toEqual(['A', 'C', 'A', 'B'])
  })

  test('continuously available branches cannot starve one another', () => {
    const { harness } = createHarness()
    const selections = Array.from({ length: 30 }, () => arbitrate(harness, ['A', 'B', 'C']))
    for (const source of ['A', 'B', 'C'] as SourceId[]) {
      expect(selections.filter((selected) => selected === source)).toHaveLength(10)
    }
  })

  test('downstream blocking does not advance the cursor or transfer counters', () => {
    const { harness } = createHarness()
    const before = { ...harness.mergeState }

    expect(arbitrate(harness, ['A', 'B', 'C'], true)).toBe('NONE')
    expect(harness.mergeState.nextPriority).toBe(before.nextPriority)
    expect(harness.mergeState.cumulativeTransfersA).toBe(before.cumulativeTransfersA)
    expect(harness.mergeState.cumulativeTransfersB).toBe(before.cumulativeTransfersB)
    expect(harness.mergeState.cumulativeTransfersC).toBe(before.cumulativeTransfersC)

    expect(arbitrate(harness, ['A', 'B', 'C'])).toBe('A')
    expect(harness.mergeState.nextPriority).toBe('B')
  })

  test('reset restores the initial arbitration state', () => {
    const { engine, harness } = createHarness()
    arbitrate(harness, ['A', 'B', 'C'])
    arbitrate(harness, ['A', 'B', 'C'])

    engine.reset()
    const state = engine.getState().mergeState
    expect(state).toEqual({
      nextPriority: 'A',
      eligibleA: false,
      eligibleB: false,
      eligibleC: false,
      selectedSource: 'NONE',
      cumulativeTransfersA: 0,
      cumulativeTransfersB: 0,
      cumulativeTransfersC: 0,
    })
  })

  test('a deterministic three-minute arbitration run remains balanced', () => {
    const { harness } = createHarness()
    const counts: Record<SourceId, number> = { A: 0, B: 0, C: 0 }
    const ticks = 3 * 60 * 10 + 1
    for (let tick = 0; tick < ticks; tick++) {
      const selected = arbitrate(harness, ['A', 'B', 'C'])
      expect(selected).not.toBe('NONE')
      counts[selected as SourceId] += 1
      harness.timeSec += 0.1
    }

    expect(harness.timeSec).toBeCloseTo(180.1, 6)
    expect(Math.max(...Object.values(counts)) - Math.min(...Object.values(counts))).toBe(1)
  })
})
