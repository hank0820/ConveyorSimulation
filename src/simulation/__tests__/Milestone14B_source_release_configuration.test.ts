import { describe, expect, test } from 'vitest'
import SimulationEngine from '../SimulationEngine'
import { DEFAULT_SRS_TARGETS } from '../srsTargets'

const SEGMENTS = [['A1',103.5,45],['B1',86,38],['C1',86,38],['PRE_T',15,6],['T',30,12],['D',230,92],['PURGE',30,12],['E',70,28],['X',10,4],['S',20,8],['A2',136,58],['B2',118.5,51],['C2',118.5,51],['CARTBUILD_A',75,30],['CARTBUILD_B',75,30],['CARTBUILD_C',75,30]].map(([id,lengthFt,maxOccupancy]) => ({ id: String(id), lengthFt: Number(lengthFt), speedFtPerMin: 120, maxOccupancy: Number(maxOccupancy) }))
const SETTINGS = { korberEnabled: true, cartbuildAEnabled: true, cartbuildBEnabled: true, cartbuildCEnabled: true }

describe('Milestone 14B source release window configuration', () => {
  test('defaults and Reset restore ten seconds deterministically', () => {
    const engine = new SimulationEngine(SEGMENTS)
    expect(engine.getState().srsControl.sourceReleaseWindowSec).toBe(10)
    engine.startScenario(SETTINGS, 10, DEFAULT_SRS_TARGETS, 7.25)
    expect(engine.getState().srsControl.sourceReleaseWindowSec).toBe(7.25)
    engine.reset()
    expect(engine.getState().srsControl.sourceReleaseWindowSec).toBe(10)
    expect(engine.getState().srsControl.sourceGrant).toMatchObject({ phase: 'IDLE', activeLane: null })
  })

  test.each([0.1, 7.25, 600])('accepts valid duration %s', (duration) => {
    const engine = new SimulationEngine(SEGMENTS)
    engine.startScenario(SETTINGS, 10, DEFAULT_SRS_TARGETS, duration)
    expect(engine.getState().srsControl.sourceReleaseWindowSec).toBe(duration)
  })

  test.each([0, -1, 0.09, 600.1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('rejects invalid duration %s atomically', (duration) => {
    const engine = new SimulationEngine(SEGMENTS)
    engine.step(3)
    const before = engine.getState()
    expect(() => engine.startScenario(SETTINGS, 10, DEFAULT_SRS_TARGETS, duration)).toThrow(/Source release window/)
    expect(engine.getState()).toEqual(before)
  })

  test('Reset and equivalent Start Scenario clear every transient grant field identically', () => {
    type Runtime = { sourceGrantCounter: number }
    const engine = new SimulationEngine(SEGMENTS)
    engine.step(20)
    engine.reset()
    const reset = engine.getState()
    const resetCounter = (engine as unknown as { milestone7: Runtime }).milestone7.sourceGrantCounter
    engine.step(20)
    engine.startScenario(SETTINGS, 10, DEFAULT_SRS_TARGETS, 10)
    const started = engine.getState()
    const startedCounter = (engine as unknown as { milestone7: Runtime }).milestone7.sourceGrantCounter
    expect({
      diagnostic: started.srsControl.sourceGrant,
      active: started.activeSourceGrant,
      completed: started.lastCompletedSourceGrant,
      cursor: started.sourceGrantCursor,
      counter: startedCounter,
      trayGrantIds: started.trays.map((tray) => tray.sourceGrantId),
    }).toEqual({
      diagnostic: reset.srsControl.sourceGrant,
      active: reset.activeSourceGrant,
      completed: reset.lastCompletedSourceGrant,
      cursor: reset.sourceGrantCursor,
      counter: resetCounter,
      trayGrantIds: reset.trays.map((tray) => tray.sourceGrantId),
    })
    expect(started.srsControl.sourceGrant).toEqual({ configuredWindowSec: 10, activeLane: null, phase: 'IDLE', pausedForBypass: false, remainingWindowSec: 0, releasedCount: 0, enteredTCount: 0, drainingElapsedSec: 0, handoffWaitReason: 'NONE', selectionReason: null, purgeDemandRequestedCount: 0, purgeDemandSatisfiedCount: 0, purgeDemandRemainingCount: 0, purgeDemandRequestedAtSec: null, purgeDemandCompletedAtSec: null, purgeDemandOutcome: null, purgeDemandRecordKind: 'NONE' })
    expect(startedCounter).toBe(0)
  })

  test('grant diagnostics and ownership snapshots are defensive', () => {
    const engine = new SimulationEngine(SEGMENTS)
    engine.step(0.1)
    const snapshot = engine.getState()
    expect(snapshot.activeSourceGrant).not.toBeNull()
    snapshot.srsControl.sourceGrant.releasedCount = 999
    snapshot.activeSourceGrant!.releasedCount = 999
    expect(engine.getState().srsControl.sourceGrant.releasedCount).not.toBe(999)
    expect(engine.getState().activeSourceGrant?.releasedCount).not.toBe(999)
  })
})
