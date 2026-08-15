import { describe, expect, test } from 'vitest'
import SimulationEngine from '../SimulationEngine'
import type { SimulationStateWithProgress, Tray } from '../types'

const SEGMENTS = [
  { id: 'A1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'A1T', maxOccupancy: 24 },
  { id: 'A1T', lengthFt: 59, speedFtPerMin: 120, nextSegmentId: 'T' },
  { id: 'B1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'B1T', maxOccupancy: 16 },
  { id: 'B1T', lengthFt: 44, speedFtPerMin: 120, nextSegmentId: 'T' },
  { id: 'C1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'T', maxOccupancy: 16 },
  { id: 'T', lengthFt: 33, speedFtPerMin: 120, nextSegmentId: 'D', maxOccupancy: 12 },
  { id: 'D', lengthFt: 235, speedFtPerMin: 120, maxOccupancy: 73 },
]

const PILE_GEOMETRY = {
  A1: { upstreamMdrCount: 8, downstreamMdrCount: 15, beltLengthFt: 23.5 },
  B1: { upstreamMdrCount: 8, downstreamMdrCount: 7, beltLengthFt: 43.5 },
  C1: { upstreamMdrCount: 8, downstreamMdrCount: 7, beltLengthFt: 43.5 },
} as const

function createEngine() {
  const engine = new SimulationEngine(SEGMENTS)
  engine.reset()
  return engine
}

function physicalTrays(state: SimulationStateWithProgress): Tray[] {
  return state.trays
}

function duplicateIds(state: SimulationStateWithProgress): number[] {
  const seen = new Set<number>()
  const duplicates = new Set<number>()
  for (const tray of physicalTrays(state)) {
    if (seen.has(tray.id)) duplicates.add(tray.id)
    seen.add(tray.id)
  }
  return [...duplicates]
}

function physicalOccupancy(state: SimulationStateWithProgress): number {
  return physicalTrays(state).length
}

function assertMaterialBalance(state: SimulationStateWithProgress) {
  expect(state.createdTrayCount).toBe(state.totalTraysCreated)
  expect(state.physicalTrayCount).toBe(physicalOccupancy(state))
  expect(state.consumedTrayCount).toBe(state.korber.totalConsumed)
  expect(state.createdTrayCount).toBe(state.physicalTrayCount + state.consumedTrayCount)
  expect(state.materialBalanceError).toBe(0)
}

function assertUniquePhysicalIdentity(state: SimulationStateWithProgress) {
  expect(duplicateIds(state)).toEqual([])
  expect(new Set(physicalTrays(state).map((tray) => tray.id)).size).toBe(physicalOccupancy(state))
  for (const tray of physicalTrays(state)) {
    if (tray.pilePlacement) expect(tray.currentSegmentId).toBe(tray.pilePlacement.pileId)
  }
}

function assertValidPhysicalPlacement(state: SimulationStateWithProgress) {
  const segmentLengths = new Map(state.segments.map((segment) => [segment.id, segment.lengthFt]))
  for (const tray of state.trays) {
    const segmentLength = segmentLengths.get(tray.currentSegmentId)
    expect(segmentLength, `unknown segment ${tray.currentSegmentId} for tray ${tray.id}`).toBeDefined()
    expect(tray.positionFt, `tray ${tray.id} before ${tray.currentSegmentId} boundary`).toBeGreaterThanOrEqual(0)
    expect(tray.positionFt, `tray ${tray.id} after ${tray.currentSegmentId} boundary`).toBeLessThanOrEqual(segmentLength! + 1e-6)

    const pileId = tray.currentSegmentId as keyof typeof PILE_GEOMETRY
    const geometry = PILE_GEOMETRY[pileId]
    if (!geometry) {
      expect(tray.pilePlacement, `non-pile tray ${tray.id} has pile placement`).toBeUndefined()
      continue
    }

    const placement = tray.pilePlacement
    expect(placement, `pile tray ${tray.id} has no physical placement`).toBeDefined()
    expect(placement!.pileId).toBe(pileId)
    if (placement!.component === 'MDR_UPSTREAM') {
      expect(placement!.zoneIndex).toBeGreaterThanOrEqual(0)
      expect(placement!.zoneIndex).toBeLessThan(geometry.upstreamMdrCount)
      expect(placement!.beltPosFt).toBeUndefined()
    } else if (placement!.component === 'MDR_DOWNSTREAM') {
      expect(placement!.zoneIndex).toBeGreaterThanOrEqual(0)
      expect(placement!.zoneIndex).toBeLessThan(geometry.downstreamMdrCount)
      expect(placement!.beltPosFt).toBeUndefined()
    } else {
      expect(placement!.zoneIndex).toBeUndefined()
      expect(placement!.beltPosFt).toBeGreaterThanOrEqual(0)
      expect(placement!.beltPosFt).toBeLessThanOrEqual(geometry.beltLengthFt)
    }
  }
}

function pilePositionFt(tray: Tray): number {
  const placement = tray.pilePlacement!
  const upstreamLength = 8 * 2.5
  const beltLength = placement.pileId === 'A1' ? 23.5 : 43.5
  if (placement.component === 'MDR_UPSTREAM') return ((placement.zoneIndex ?? 0) + 0.5) * 2.5
  if (placement.component === 'BELT') return upstreamLength + (placement.beltPosFt ?? 0)
  return upstreamLength + beltLength + ((placement.zoneIndex ?? 0) + 0.5) * 2.5
}

function assertNoPileOverlap(state: SimulationStateWithProgress) {
  for (const pileId of ['A1', 'B1', 'C1']) {
    const trays = state.trays
      .filter((tray) => tray.pilePlacement?.pileId === pileId)
      .sort((a, b) => pilePositionFt(a) - pilePositionFt(b))
    for (let index = 1; index < trays.length; index++) {
      const upstream = trays[index - 1]
      const downstream = trays[index]
      expect(
        pilePositionFt(downstream) - pilePositionFt(upstream),
        `${pileId} overlap at ${state.timeSec}s: tray ${upstream.id} and tray ${downstream.id}`,
      ).toBeGreaterThanOrEqual(2 - 1e-6)
    }
  }
}

describe('Milestone 6A identity and material balance', () => {
  test('reset creates globally unique IDs and zero material balance', () => {
    const state = createEngine().getState()
    assertUniquePhysicalIdentity(state)
    expect(state.totalTraysCreated).toBe(Math.max(...state.trays.map((tray) => tray.id)))
    assertMaterialBalance(state)
  })

  test('reset deterministically restores the same IDs and counts', () => {
    const engine = createEngine()
    const initial = engine.getState()
    engine.step(20)
    engine.reset()
    const reset = engine.getState()

    expect(reset.trays.map((tray) => tray.id)).toEqual(initial.trays.map((tray) => tray.id))
    expect(reset.totalTraysCreated).toBe(initial.totalTraysCreated)
    expect(reset.physicalTrayCount).toBe(initial.physicalTrayCount)
    expect(reset.consumedTrayCount).toBe(0)
    assertUniquePhysicalIdentity(reset)
    assertMaterialBalance(reset)
  })

  test('Körber removes the selected D tray without removing a tray elsewhere', () => {
    const engine = createEngine()
    const initial = engine.getState()
    const selected = initial.trays
      .filter((tray) => tray.currentSegmentId === 'D')
      .reduce((downstream, tray) => tray.positionFt > downstream.positionFt ? tray : downstream)
    const initialIds = new Set(initial.trays.map((tray) => tray.id))

    engine.step(0.1)
    const after = engine.getState()

    expect(after.consumedTrayCount).toBe(1)
    expect(after.trays.some((tray) => tray.id === selected.id)).toBe(false)
    expect(after.trays.every((tray) => initialIds.has(tray.id))).toBe(true)
    expect(after.physicalTrayCount).toBe(initial.physicalTrayCount - 1)
    assertUniquePhysicalIdentity(after)
    assertMaterialBalance(after)
  })

  test('the first exchanger-created tray receives the next unused ID', () => {
    const engine = createEngine()
    const initial = engine.getState()
    const initialMaxId = Math.max(...initial.trays.map((tray) => tray.id))
    let state = initial

    while (state.timeSec < 600 && state.totalTraysCreated === initial.totalTraysCreated) {
      engine.step(0.25)
      state = engine.getState()
    }

    const newIds = state.trays.filter((tray) => tray.id > initialMaxId).map((tray) => tray.id).sort((a, b) => a - b)
    expect(state.totalTraysCreated).toBeGreaterThan(initial.totalTraysCreated)
    expect(newIds[0]).toBe(initialMaxId + 1)
    expect(newIds).toEqual(Array.from({ length: newIds.length }, (_, index) => initialMaxId + index + 1))
    assertUniquePhysicalIdentity(state)
    assertNoPileOverlap(state)
    assertMaterialBalance(state)
  })

  test('material balance remains zero through multiple consumption cycles', () => {
    const engine = createEngine()
    let state = engine.getState()
    while (state.consumedTrayCount < 10) {
      engine.step(0.25)
      state = engine.getState()
      assertUniquePhysicalIdentity(state)
      assertNoPileOverlap(state)
      assertMaterialBalance(state)
    }
  })

  test('a 600-second run preserves all physical invariants on every 0.1-second tick', () => {
    const engine = createEngine()
    let maximumPhysicalTrays = 0
    for (let tick = 0; tick < 600 / 0.1; tick++) {
      engine.step(0.1)
      const state = engine.getState()
      maximumPhysicalTrays = Math.max(maximumPhysicalTrays, state.physicalTrayCount)
      assertUniquePhysicalIdentity(state)
      assertValidPhysicalPlacement(state)
      assertNoPileOverlap(state)
      assertMaterialBalance(state)
    }
    expect(maximumPhysicalTrays).toBeGreaterThan(0)
  }, 120_000)
})

describe('hybrid pile inter-segment entry', () => {
  test('a segment transfer cannot enter an occupied hybrid-pile entrance', () => {
    const segmentsIntoA1 = SEGMENTS.map((segment) =>
      segment.id === 'C1' ? { ...segment, nextSegmentId: 'A1' } : segment,
    )
    const engine = new SimulationEngine(segmentsIntoA1)
    engine.reset()
    const initial = engine.getState()
    const c1FinalTray = initial.trays
      .filter((tray) => tray.pilePlacement?.pileId === 'C1' && tray.pilePlacement.component === 'MDR_DOWNSTREAM')
      .find((tray) => tray.pilePlacement?.zoneIndex === 6)

    expect(c1FinalTray).toBeDefined()
    engine.step(0.1)
    const after = engine.getState()
    const transferred = after.trays.find((tray) => tray.id === c1FinalTray!.id)

    expect(transferred?.currentSegmentId).toBe('C1')
    expect(transferred?.pilePlacement).toEqual(c1FinalTray!.pilePlacement)
    assertUniquePhysicalIdentity(after)
  })

  test('a blocked segment transfer enters zone 0 once the pile entrance becomes free', () => {
    const segmentsIntoA1 = SEGMENTS.map((segment) =>
      segment.id === 'C1' ? { ...segment, nextSegmentId: 'A1' } : segment,
    )
    const engine = new SimulationEngine(segmentsIntoA1)
    engine.reset()
    const initial = engine.getState()
    const c1FinalTray = initial.trays
      .filter((tray) => tray.pilePlacement?.pileId === 'C1' && tray.pilePlacement.component === 'MDR_DOWNSTREAM')
      .find((tray) => tray.pilePlacement?.zoneIndex === 6)!
    let state = initial

    while (state.timeSec < 120) {
      engine.step(0.1)
      state = engine.getState()
      const tray = state.trays.find((candidate) => candidate.id === c1FinalTray.id)
      if (tray?.currentSegmentId === 'A1') break
    }

    const entered = state.trays.find((tray) => tray.id === c1FinalTray.id)
    expect(entered?.currentSegmentId).toBe('A1')
    expect(entered?.pilePlacement).toEqual({ pileId: 'A1', component: 'MDR_UPSTREAM', zoneIndex: 0 })
    assertUniquePhysicalIdentity(state)
    assertMaterialBalance(state)
  })
})
