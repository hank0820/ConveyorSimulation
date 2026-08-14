import { describe, expect, test } from 'vitest'
import SimulationEngine from '../SimulationEngine'
import type { SourceId, Tray } from '../types'

const SEGMENTS = [
  { id: 'A1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'PRE_T', maxOccupancy: 24 },
  { id: 'B1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'PRE_T', maxOccupancy: 16 },
  { id: 'C1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'T', maxOccupancy: 16 },
  { id: 'PRE_T', lengthFt: 20, speedFtPerMin: 120, nextSegmentId: 'T', maxOccupancy: 8 },
  { id: 'T', lengthFt: 30, speedFtPerMin: 120, nextSegmentId: 'D', maxOccupancy: 12 },
  { id: 'D', lengthFt: 235, speedFtPerMin: 120, maxOccupancy: 94 },
]
const INTERVAL = 3600 / 1050

const createEngine = () => new SimulationEngine(SEGMENTS)
const countPile = (trays: Tray[], source: SourceId) => trays.filter((tray) => tray.pilePlacement?.pileId === `${source}1`).length
const assertInvariants = (engine: SimulationEngine) => {
  const state = engine.getState()
  const ids = state.trays.map((tray) => tray.id)
  expect(new Set(ids).size).toBe(ids.length)
  expect(state.materialBalanceError).toBe(0)
  const zones = state.trays.flatMap((tray) => tray.zonePlacement ? [`${tray.zonePlacement.conveyorId}:${tray.zonePlacement.zoneIndex}`] : [])
  expect(new Set(zones).size).toBe(zones.length)
  for (const tray of state.trays) expect(Number(Boolean(tray.pilePlacement)) + Number(Boolean(tray.zonePlacement))).toBe(1)
}

describe('Milestone 7 topology and reset', () => {
  test('uses shared PRE_T, direct C routing, and authoritative 8/12/94 zones', () => {
    const state = createEngine().getState()
    expect(state.segments.map(({ id, nextSegmentId, maxOccupancy }) => [id, nextSegmentId, maxOccupancy])).toEqual([
      ['A1', 'PRE_T', 24], ['B1', 'PRE_T', 16], ['C1', 'T', 16],
      ['PRE_T', 'T', 8], ['T', 'D', 12], ['D', undefined, 94],
    ])
    expect(state.zonedOccupancy).toEqual({ PRE_T: 0, T: 0, D: 94 })
    expect(countPile(state.trays, 'A')).toBe(24)
    expect(countPile(state.trays, 'B')).toBe(16)
    expect(countPile(state.trays, 'C')).toBe(16)
    expect(state.slugCursor).toBe('A')
    expect(state.activeSlug).toBeNull()
    expect(state.createdTrayCount).toBe(150)
    assertInvariants(createEngine())
  })

  test('reset is deterministic and clears active slug state', () => {
    const engine = createEngine()
    const initial = engine.getState().trays.map((tray) => tray.id)
    engine.step(160)
    expect(engine.getState().lastCompletedSlug).not.toBeNull()
    engine.reset()
    const reset = engine.getState()
    expect(reset.trays.map((tray) => tray.id)).toEqual(initial)
    expect(reset.slugCursor).toBe('A')
    expect(reset.activeSlug).toBeNull()
    expect(reset.lastCompletedSlug).toBeNull()
  })
})

describe('Milestone 7 D and Körber physics', () => {
  test('waits a full interval and consumes only the final-zone tray', () => {
    const engine = createEngine()
    const finalId = engine.getState().trays.find((tray) => tray.zonePlacement?.conveyorId === 'D' && tray.zonePlacement.zoneIndex === 93)!.id
    engine.step(INTERVAL - 0.01)
    expect(engine.getState().korber.totalConsumed).toBe(0)
    engine.step(0.02)
    const state = engine.getState()
    expect(state.korber.totalConsumed).toBe(1)
    expect(state.korberLastConsumedTrayId).toBe(finalId)
    expect(state.trays.some((tray) => tray.id === finalId)).toBe(false)
    assertInvariants(engine)
  })

  test('vacancy propagates with timed transfers and entrance stays blocked until it arrives', () => {
    const engine = createEngine()
    engine.step(INTERVAL + 0.01)
    expect(engine.getState().dFinalZoneOccupied).toBe(false)
    engine.step(1.1)
    expect(engine.getState().dFinalZoneOccupied).toBe(false)
    engine.step(0.2)
    expect(engine.getState().dFinalZoneOccupied).toBe(true)
    expect(engine.getState().dEntranceAvailable).toBe(false)
    engine.step(114.5)
    expect(engine.getState().dEntranceAvailable).toBe(false)
    engine.step(2)
    expect(engine.getState().dEntranceAvailable).toBe(true)
  })

  test('starvation consumes the next final-zone arrival once and schedules a fresh interval', () => {
    const engine = createEngine()
    const runtime = (engine as unknown as { milestone7: { trays: Tray[]; nextConsumptionTime: number } }).milestone7
    const final = runtime.trays.find((tray) => tray.zonePlacement?.conveyorId === 'D' && tray.zonePlacement.zoneIndex === 93)!
    final.zonePlacement!.zoneIndex = 92
    runtime.nextConsumptionTime = 0
    engine.step(0.1)
    expect(engine.getState().korber.starved).toBe(true)
    final.zonePlacement!.zoneIndex = 93
    engine.step(0.1)
    const consumed = engine.getState()
    expect(consumed.korber.totalConsumed).toBe(1)
    expect(consumed.korberNextConsumptionTime - consumed.timeSec).toBeCloseTo(INTERVAL, 8)
    engine.step(1)
    expect(engine.getState().korber.totalConsumed).toBe(1)
  })

  test('continuously supplied Körber preserves its mathematical interval without 3.5-second drift', () => {
    const engine = createEngine()
    engine.step(3600)
    expect(engine.getState().korber.totalConsumed).toBe(1050)
  })
})

describe('Milestone 7 slug arbitration and invariants', () => {
  test('100 accumulated MDR intervals retain 125-second timing within one tick', () => {
    type Runtime = { trays: Tray[]; totalTraysCreated: number; consumedCount: number; nextConsumptionTime: number }
    const elapsedFor = (conveyorId: 'PRE_T' | 'D', finalZone: number) => {
      const engine = createEngine()
      const runtime = (engine as unknown as { milestone7: Runtime }).milestone7
      runtime.trays = [{ id: 1, currentSegmentId: conveyorId, positionFt: 1.25, status: 'BLOCKED', createdAtSec: 0, originSourceId: 'A', zonePlacement: { conveyorId, zoneIndex: 0 } }]
      runtime.totalTraysCreated = 1
      runtime.consumedCount = 0
      runtime.nextConsumptionTime = Number.MAX_VALUE
      while (engine.getState().trays[0].zonePlacement!.zoneIndex < finalZone) engine.step(0.05)
      return engine.getState().timeSec
    }
    const elapsed = elapsedFor('D', 93) + elapsedFor('PRE_T', 7)
    expect(elapsed).toBeGreaterThanOrEqual(125)
    expect(elapsed).toBeLessThanOrEqual(125.1)
  })

  test('skips a short lane for a full lane, otherwise freezes the cursor lane partial slug', () => {
    type Runtime = {
      trays: Tray[]
      slugCursor: SourceId
      activeSlug: null
      authorizeSlugIfPossible: () => void
    }
    const first = createEngine()
    const firstRuntime = (first as unknown as { milestone7: Runtime }).milestone7
    firstRuntime.trays = firstRuntime.trays.filter((tray) => tray.zonePlacement?.conveyorId !== 'D' || tray.zonePlacement.zoneIndex !== 0)
    firstRuntime.trays = firstRuntime.trays.filter((tray) => tray.pilePlacement?.pileId !== 'A1' || tray.id <= 7)
    firstRuntime.slugCursor = 'A'
    firstRuntime.authorizeSlugIfPossible()
    expect(first.getState().activeSlug?.source).toBe('B')
    expect(first.getState().activeSlug?.authorizedCount).toBe(8)

    const second = createEngine()
    const secondRuntime = (second as unknown as { milestone7: Runtime }).milestone7
    secondRuntime.trays = secondRuntime.trays.filter((tray) => tray.zonePlacement?.conveyorId !== 'D' || tray.zonePlacement.zoneIndex !== 0)
    secondRuntime.trays = secondRuntime.trays.filter((tray) => {
      if (tray.pilePlacement?.pileId === 'A1') return tray.id <= 5
      if (tray.pilePlacement?.pileId === 'B1') return tray.id <= 29
      if (tray.pilePlacement?.pileId === 'C1') return tray.id <= 44
      return true
    })
    secondRuntime.slugCursor = 'A'
    secondRuntime.authorizeSlugIfPossible()
    const frozen = second.getState().activeSlug!
    expect(frozen.source).toBe('A')
    expect(frozen.authorizedCount).toBe(5)
    const replacementId = 999
    secondRuntime.trays.push({ id: replacementId, currentSegmentId: 'A1', positionFt: 1.25, status: 'BLOCKED', createdAtSec: 0, originSourceId: 'A', pilePlacement: { pileId: 'A1', component: 'MDR_UPSTREAM', zoneIndex: 0 } })
    expect(second.getState().activeSlug?.authorizedTrayIds).toEqual(frozen.authorizedTrayIds)
    expect(second.getState().activeSlug?.authorizedTrayIds).not.toContain(replacementId)
  })

  test('runs exclusive frozen full slugs round-robin A, B, C', () => {
    const engine = createEngine()
    const completed: SourceId[] = []
    let priorCompletion: number | null = null
    for (let tick = 0; tick < 3000 && completed.length < 3; tick++) {
      engine.step(0.1)
      const state = engine.getState()
      const completedAt = state.lastCompletedSlug?.completedAtSec ?? null
      if (completedAt !== null && completedAt !== priorCompletion) {
        completed.push(state.lastCompletedSlug!.source)
        expect(state.lastCompletedSlug!.authorizedCount).toBe(8)
        expect(state.lastCompletedSlug!.releasedCount).toBe(8)
        expect(state.lastCompletedSlug!.enteredTCount).toBe(8)
        priorCompletion = completedAt
      }
      if (state.activeSlug) {
        const allowed = state.activeSlug.source === 'C' ? ['T', 'D'] : ['PRE_T', 'T', 'D']
        for (const tray of state.trays.filter((candidate) => state.activeSlug!.authorizedTrayIds.includes(candidate.id) && candidate.zonePlacement)) {
          expect(allowed).toContain(tray.zonePlacement!.conveyorId)
        }
      }
    }
    expect(completed).toEqual(['A', 'B', 'C'])
  })

  test('cursor and ownership remain fixed through blocked partial progress', () => {
    const engine = createEngine()
    engine.step(125)
    const before = engine.getState()
    expect(before.activeSlug?.source).toBe('A')
    const cursor = before.slugCursor
    const authorized = [...before.activeSlug!.authorizedTrayIds]
    const inactiveCounts = [countPile(before.trays, 'B'), countPile(before.trays, 'C')]
    engine.step(1)
    const after = engine.getState()
    expect(after.slugCursor).toBe(cursor)
    expect(after.activeSlug?.source).toBe('A')
    expect(after.activeSlug?.authorizedTrayIds).toEqual(authorized)
    expect([countPile(after.trays, 'B'), countPile(after.trays, 'C')]).toEqual(inactiveCounts)
  })

  test('long deterministic run preserves identity, placement, occupancy, and material balance', () => {
    const engine = createEngine()
    const seen = new Set<SourceId>()
    let maximumPhysical = 0
    for (let second = 0; second < 700; second++) {
      engine.step(1)
      const state = engine.getState()
      maximumPhysical = Math.max(maximumPhysical, state.physicalTrayCount)
      if (state.lastCompletedSlug) seen.add(state.lastCompletedSlug.source)
      assertInvariants(engine)
    }
    expect([...seen].sort()).toEqual(['A', 'B', 'C'])
    expect(maximumPhysical).toBeLessThanOrEqual(150)
  })
})
