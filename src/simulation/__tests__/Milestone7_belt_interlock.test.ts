import { describe, expect, test } from 'vitest'
import SimulationEngine from '../SimulationEngine'
import type { Mission, SourceId, Tray } from '../types'

const SEGMENTS = [
  { id: 'A1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'PRE_T', maxOccupancy: 24 },
  { id: 'B1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'PRE_T', maxOccupancy: 16 },
  { id: 'C1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'T', maxOccupancy: 16 },
  { id: 'PRE_T', lengthFt: 20, speedFtPerMin: 120, nextSegmentId: 'T', maxOccupancy: 8 },
  { id: 'T', lengthFt: 30, speedFtPerMin: 120, nextSegmentId: 'D', maxOccupancy: 12 },
  { id: 'D', lengthFt: 235, speedFtPerMin: 120, maxOccupancy: 94 },
]

type Runtime = {
  trays: Tray[]
  missions: Mission[]
  totalTraysCreated: number
  consumedCount: number
  nextConsumptionTime: number
}

const runtimeOf = (engine: SimulationEngine) =>
  (engine as unknown as { milestone7: Runtime }).milestone7

const tray = (id: number, source: SourceId, pileId: string, component: NonNullable<Tray['pilePlacement']>['component'], location: number): Tray => ({
  id,
  currentSegmentId: pileId,
  positionFt: 0,
  status: 'BLOCKED',
  createdAtSec: 0,
  originSourceId: source,
  pilePlacement: component === 'BELT'
    ? { pileId, component, beltPosFt: location }
    : { pileId, component, zoneIndex: location },
})

const assertUniquePhysicalPlacement = (trays: Tray[]) => {
  expect(new Set(trays.map(({ id }) => id)).size).toBe(trays.length)
  const placements = trays.map((item) => {
    if (item.pilePlacement?.component === 'BELT') return `${item.pilePlacement.pileId}:BELT:${item.id}`
    if (item.pilePlacement) return `${item.pilePlacement.pileId}:${item.pilePlacement.component}:${item.pilePlacement.zoneIndex}`
    return `${item.zonePlacement?.conveyorId}:${item.zonePlacement?.zoneIndex}`
  })
  expect(new Set(placements).size).toBe(placements.length)
  for (const item of trays) expect(Number(Boolean(item.pilePlacement)) + Number(Boolean(item.zonePlacement))).toBe(1)
}

describe('Milestone 7 mechanically coupled middle-belt interlock', () => {
  for (const [source, pileId, beltLength] of [['A', 'A1', 23.5], ['B', 'B1', 43.5], ['C', 'C1', 43.5]] as const) {
    test(`${pileId} stops every belt tray and rejects entry while downstream zone 0 is occupied`, () => {
      const engine = new SimulationEngine(SEGMENTS)
      const runtime = runtimeOf(engine)
      runtime.trays = [
        tray(1, source, pileId, 'BELT', 5),
        tray(2, source, pileId, 'BELT', 10),
        tray(3, source, pileId, 'MDR_POST_DETRAYER', 4),
        tray(4, source, pileId, 'MDR_POST_DETRAYER', 3),
        tray(5, source, pileId, 'MDR_DOWNSTREAM', 0),
      ]
      runtime.missions = []
      runtime.totalTraysCreated = runtime.trays.length
      runtime.consumedCount = 0
      runtime.nextConsumptionTime = Number.MAX_VALUE

      const initial = engine.getState().trays.filter((item) => item.pilePlacement?.component === 'BELT').map((item) => item.pilePlacement!.beltPosFt!)
      engine.step(0.5)
      const blocked = engine.getState()
      const positions = blocked.trays.filter((item) => item.pilePlacement?.component === 'BELT').map((item) => item.pilePlacement!.beltPosFt!)
      expect(positions).toEqual(initial)
      expect(positions[1] - positions[0]).toBe(initial[1] - initial[0])
      expect(blocked.trays.find(({ id }) => id === 3)?.pilePlacement).toEqual({ pileId, component: 'MDR_POST_DETRAYER', zoneIndex: 4 })
      expect(blocked.trays.find(({ id }) => id === 4)?.pilePlacement).toEqual({ pileId, component: 'MDR_POST_DETRAYER', zoneIndex: 3 })
      expect(blocked.trays.find(({ id }) => id === 3)?.pileRuntime).toBeUndefined()
      expect(blocked.beltDiagnostics.find((belt) => belt.pileId === pileId)).toMatchObject({
        beltRunning: false,
        beltExitAvailable: false,
        beltBlockedReason: 'DOWNSTREAM_MDR_ENTRANCE_OCCUPIED',
        beltTrayCount: 2,
        leadingBeltTrayId: 2,
        leadingBeltTrayPositionFt: 10,
      })

      // Move the blocker to a physically distinct downstream zone. The very
      // next tick resumes by exactly speed * tick, with no stopped-time credit.
      const blocker = runtime.trays.find(({ id }) => id === 5)!
      blocker.pilePlacement = { pileId, component: 'MDR_DOWNSTREAM', zoneIndex: 1 }
      blocker.pileRuntime = undefined
      engine.step(0.1)
      const resumed = engine.getState()
      const resumedPositions = resumed.trays.filter((item) => item.pilePlacement?.component === 'BELT').map((item) => item.pilePlacement!.beltPosFt!)
      expect(resumedPositions).toEqual(initial.map((position) => position + 0.2))
      expect(resumedPositions[1] - resumedPositions[0]).toBeCloseTo(initial[1] - initial[0], 12)
      expect(resumed.beltDiagnostics.find((belt) => belt.pileId === pileId)?.beltRunning).toBe(true)
      expect(resumedPositions.at(-1)).toBeLessThan(beltLength)

      // The waiting tray enters only after the belt is running and its physical
      // 1.25-second MDR transfer has elapsed.
      engine.step(1.3)
      expect(engine.getState().trays.find(({ id }) => id === 3)?.pilePlacement?.component).toBe('BELT')
      expect(engine.getState().materialBalanceError).toBe(0)
      assertUniquePhysicalPlacement(engine.getState().trays)
    })
  }

  test('one blocked pile does not stop another pile belt', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    runtime.trays = [tray(1, 'A', 'A1', 'BELT', 5), tray(2, 'A', 'A1', 'MDR_DOWNSTREAM', 0), tray(3, 'B', 'B1', 'BELT', 5)]
    runtime.totalTraysCreated = 3
    runtime.consumedCount = 0
    runtime.nextConsumptionTime = Number.MAX_VALUE
    engine.step(0.1)
    const state = engine.getState()
    expect(state.trays.find(({ id }) => id === 1)?.pilePlacement?.beltPosFt).toBe(5)
    expect(state.trays.find(({ id }) => id === 3)?.pilePlacement?.beltPosFt).toBe(5.2)
    expect(state.beltRunningA).toBe(false)
    expect(state.beltRunningB).toBe(true)
  })

  test('long-running congestion preserves balance, uniqueness, order, spacing, and immutable snapshots each tick', () => {
    const engine = new SimulationEngine(SEGMENTS)
    let prior = engine.getState()
    let transitions = 0
    let priorRunning = prior.beltRunningA
    for (let tick = 0; tick < 4000; tick++) {
      const frozen = prior.trays.map((item) => item.pilePlacement?.beltPosFt)
      engine.step(0.1)
      const state = engine.getState()
      expect(prior.trays.map((item) => item.pilePlacement?.beltPosFt)).toEqual(frozen)
      expect(state.materialBalanceError).toBe(0)
      assertUniquePhysicalPlacement(state.trays)
      for (const pileId of ['A1', 'B1', 'C1']) {
        const belt = state.trays.filter((item) => item.pilePlacement?.pileId === pileId && item.pilePlacement.component === 'BELT')
          .sort((a, b) => a.pilePlacement!.beltPosFt! - b.pilePlacement!.beltPosFt!)
        for (let index = 1; index < belt.length; index++) {
          expect(belt[index].pilePlacement!.beltPosFt!).toBeGreaterThan(belt[index - 1].pilePlacement!.beltPosFt!)
          expect(belt[index].pilePlacement!.beltPosFt! - belt[index - 1].pilePlacement!.beltPosFt!).toBeGreaterThanOrEqual(2 - 1e-9)
        }
      }
      if (state.beltRunningA !== priorRunning) transitions += 1
      priorRunning = state.beltRunningA
      prior = state
    }
    expect(transitions).toBeGreaterThanOrEqual(2)
  }, 60_000)
})
