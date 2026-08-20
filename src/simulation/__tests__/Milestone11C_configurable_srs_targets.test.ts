import { describe, expect, test } from 'vitest'
import SimulationEngine from '../SimulationEngine'
import { DEFAULT_SRS_TARGETS } from '../srsTargets'
import type { SrsTargets } from '../types'

const SEGMENTS = [
  ['A1',103.5,45],['B1',86,38],['C1',86,38],['PRE_T',15,6],['T',30,12],['D',230,92],['PURGE',30,12],['E',70,28],['X',10,4],['S',20,8],['A2',136,58],['B2',118.5,51],['C2',118.5,51],
  ['CARTBUILD_A',75,30],['CARTBUILD_B',75,30],['CARTBUILD_C',75,30],
].map(([id,lengthFt,maxOccupancy]) => ({ id: id as string, lengthFt: lengthFt as number, speedFtPerMin: 120, maxOccupancy: maxOccupancy as number }))
const SETTINGS = { korberEnabled: true, cartbuildAEnabled: true, cartbuildBEnabled: true, cartbuildCEnabled: true }

describe('Milestone 11C configurable SRS targets', () => {
  test('starts with custom active targets, capacity-clamped physical inventory, and immediate planning', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const targets: SrsTargets = { A1: 80, B1: 2, C1: 1, T: 7, D: 3, A2: 4, B2: 5, C2: 6 }
    engine.startScenario(SETTINGS, 10, targets)
    ;(targets as Record<string, number>).A1 = 1
    const state = engine.getState()
    expect(state.srsControl.targets).toEqual({ A1: 80, B1: 2, C1: 1, T: 7, D: 3, A2: 4, B2: 5, C2: 6 })
    expect(state.srsControl.current).toEqual({ A1: 45, B1: 2, C1: 1, T: 0, D: 3, A2: 0, B2: 0, C2: 0 })
    expect(state.srsControl.globalTarget).toBe(108)
    expect(state.trays.filter((tray) => tray.zonePlacement?.conveyorId === 'D').map((tray) => tray.zonePlacement?.zoneIndex)).toEqual([89, 90, 91])
    expect(state.srsControl.globalPending).toBeGreaterThan(0)
  })

  test.each([0, -1, 1.5, 1000, Number.NaN])('rejects invalid target %s without changing the scenario', (bad) => {
    const engine = new SimulationEngine(SEGMENTS)
    const before = engine.getState()
    expect(() => engine.startScenario(SETTINGS, 10, { ...DEFAULT_SRS_TARGETS, T: bad })).toThrow(/T target/)
    expect(engine.getState()).toEqual(before)
  })

  test('reset restores authoritative defaults, cadence, settings, and default initialization', () => {
    const engine = new SimulationEngine(SEGMENTS)
    engine.startScenario({ ...SETTINGS, korberEnabled: false }, 7, { A1: 1, B1: 1, C1: 1, T: 1, D: 1, A2: 1, B2: 1, C2: 1 })
    engine.reset()
    const state = engine.getState()
    expect(state.srsControl.targets).toEqual(DEFAULT_SRS_TARGETS)
    expect(state.srsControl.current).toEqual({ A1: 24, B1: 16, C1: 16, T: 0, D: 92, A2: 0, B2: 0, C2: 0 })
    expect(state.srsControl.planningCadenceSec).toBe(10)
    expect(state.operatingSettings).toEqual(SETTINGS)
  })

  test('returned snapshots cannot mutate the active target configuration', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const snapshot = engine.getState()
    ;(snapshot.srsControl.targets as Record<string, number>).A1 = 999
    expect(engine.getState().srsControl.targets.A1).toBe(24)
  })
})
