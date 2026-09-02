import { describe, expect, test } from 'vitest'
import SimulationEngine from '../SimulationEngine'
import type { SourceId, SourceReleaseGrantState, Tray } from '../types'

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

describe('Milestone 7 topology and physical timing retained by 14B', () => {
  test('uses shared PRE_T, direct C routing, authoritative zones, and idle grant reset', () => {
    const state = createEngine().getState()
    expect(state.segments.map(({ id, nextSegmentId, maxOccupancy }) => [id, nextSegmentId, maxOccupancy])).toEqual([
      ['A1', 'PRE_T', 45], ['B1', 'PRE_T', 38], ['C1', 'T', 38], ['PRE_T', 'T', 6], ['T', 'D', 12], ['D', undefined, 92],
    ])
    expect(state.zonedOccupancy).toEqual({ PRE_T: 0, T: 0, D: 92 })
    expect([countPile(state.trays, 'A'), countPile(state.trays, 'B'), countPile(state.trays, 'C')]).toEqual([24, 16, 16])
    expect(state.sourceGrantCursor).toBe('A')
    expect(state.activeSourceGrant).toBeNull()
    expect(state.trays).toHaveLength(148)
    expect(state.createdTrayCount).toBe(248)
    assertInvariants(createEngine())
  })

  test('reset clears grant state deterministically', () => {
    const engine = createEngine(); const initial = engine.getState().trays.map((tray) => tray.id)
    engine.step(160)
    expect(engine.getState().lastCompletedSourceGrant).not.toBeNull()
    engine.reset()
    expect(engine.getState().trays.map((tray) => tray.id)).toEqual(initial)
    expect(engine.getState()).toMatchObject({ sourceGrantCursor: 'A', activeSourceGrant: null, lastCompletedSourceGrant: null })
  })

  test('Körber waits its independent interval and consumes only the final zone', () => {
    const engine = createEngine()
    const finalId = engine.getState().trays.find((tray) => tray.zonePlacement?.conveyorId === 'D' && tray.zonePlacement.zoneIndex === 91)!.id
    engine.step(INTERVAL - 0.01); expect(engine.getState().korber.totalConsumed).toBe(0)
    engine.step(0.02)
    const state = engine.getState()
    expect(state.korber.totalConsumed).toBe(1)
    expect(state.korberLastConsumedTrayId).toBe(finalId)
    expect(state.trays.some((tray) => tray.id === finalId)).toBe(false)
    assertInvariants(engine)
  })

  test('D vacancy propagates with timed transfers and entrance stays blocked until it arrives', () => {
    const engine = createEngine()
    const runtime = (engine as unknown as { milestone7: { trays: Tray[]; missions: unknown[] } }).milestone7
    runtime.trays = runtime.trays.filter((tray) => tray.zonePlacement?.conveyorId === 'D')
    runtime.missions = []
    engine.step(INTERVAL + 0.01)
    expect(engine.getState().dFinalZoneOccupied).toBe(false)
    engine.step(1.1)
    expect(engine.getState().dFinalZoneOccupied).toBe(false)
    engine.step(0.2)
    expect(engine.getState().dFinalZoneOccupied).toBe(true)
    expect(engine.getState().dEntranceAvailable).toBe(false)
    engine.step(111.5)
    expect(engine.getState().dEntranceAvailable).toBe(false)
    engine.step(2)
    expect(engine.getState().dEntranceAvailable).toBe(true)
  })

  test('Körber starvation consumes the next final-zone arrival once and schedules a fresh interval', () => {
    const engine = createEngine()
    const runtime = (engine as unknown as { milestone7: { trays: Tray[]; nextConsumptionTime: number } }).milestone7
    const final = runtime.trays.find((tray) => tray.zonePlacement?.conveyorId === 'D' && tray.zonePlacement.zoneIndex === 91)!
    final.zonePlacement!.zoneIndex = 90
    runtime.nextConsumptionTime = 0
    engine.step(0.1)
    expect(engine.getState().korber.starved).toBe(true)
    final.zonePlacement!.zoneIndex = 91
    engine.step(0.1)
    const consumed = engine.getState()
    expect(consumed.korber.totalConsumed).toBe(1)
    expect(consumed.korberNextConsumptionTime - consumed.timeSec).toBeCloseTo(INTERVAL, 8)
    engine.step(1)
    expect(engine.getState().korber.totalConsumed).toBe(1)
  })

  test('continuously supplied Körber preserves exactly 1,050 consumptions per hour', () => {
    const engine = createEngine()
    engine.step(3600)
    expect(engine.getState().korber.totalConsumed).toBe(1050)
  })

  test('96 accumulated MDR intervals retain 120-second timing within one tick', () => {
    type Runtime = { trays: Tray[]; totalTraysCreated: number; consumedCount: number; nextConsumptionTime: number }
    const elapsedFor = (conveyorId: 'PRE_T' | 'D', finalZone: number) => {
      const engine = createEngine(); const runtime = (engine as unknown as { milestone7: Runtime }).milestone7
      runtime.trays = [{ id: 1, currentSegmentId: conveyorId, positionFt: 1.25, status: 'BLOCKED', createdAtSec: 0, originSourceId: 'A', zonePlacement: { conveyorId, zoneIndex: 0 } }]
      runtime.totalTraysCreated = 1; runtime.consumedCount = 0; runtime.nextConsumptionTime = Number.MAX_VALUE
      while (engine.getState().trays[0].zonePlacement!.zoneIndex < finalZone) engine.step(0.05)
      return engine.getState().timeSec
    }
    const elapsed = elapsedFor('D', 91) + elapsedFor('PRE_T', 5)
    expect(elapsed).toBeGreaterThanOrEqual(120); expect(elapsed).toBeLessThanOrEqual(120.1)
  })
})

describe('Milestone 14B grant arbitration compatibility', () => {
  test('keeps ownership and cursor fixed during an active grant', () => {
    const engine = createEngine(); engine.step(125); const before = engine.getState()
    expect(before.activeSourceGrant).not.toBeNull()
    const owner = before.activeSourceGrant!.source; const cursor = before.sourceGrantCursor
    engine.step(1)
    expect(engine.getState().activeSourceGrant?.source).toBe(owner)
    expect(engine.getState().sourceGrantCursor).toBe(cursor)
  })

  test('long deterministic run preserves identities and accounting across all grant owners', () => {
    const engine = createEngine(); const seen = new Set<SourceId>(); let maximumPhysical = 0
    for (let second = 0; second < 700; second++) {
      engine.step(1); const state = engine.getState()
      maximumPhysical = Math.max(maximumPhysical, state.trays.length)
      if (state.lastCompletedSourceGrant) seen.add(state.lastCompletedSourceGrant.source)
      assertInvariants(engine)
    }
    expect([...seen].sort()).toEqual(['A', 'B', 'C'])
    expect(maximumPhysical).toBeLessThanOrEqual(148)
  }, 30_000)

  test('grant state type carries explicit lifecycle timing', () => {
    const grant: SourceReleaseGrantState = { grantId: 1, source: 'A', releasedCount: 0, enteredTCount: 0, startedAtSec: 0, expiresAtSec: 10, pausedAtSec: null, remainingSecWhenPaused: null, drainingStartedAtSec: null, completedAtSec: null, phase: 'ACTIVE' }
    expect(grant.phase).toBe('ACTIVE')
  })
})
