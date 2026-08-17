import { describe, expect, test, vi } from 'vitest'
import { applyOperatingSettingChange, applyPlanningCadenceChange, applyStartScenario } from './operatingSettings'
import SimulationEngine from './simulation/SimulationEngine'

const SEGMENTS = [
  { id: 'A1', lengthFt: 81, speedFtPerMin: 120, maxOccupancy: 24 }, { id: 'B1', lengthFt: 81, speedFtPerMin: 120, maxOccupancy: 16 }, { id: 'C1', lengthFt: 81, speedFtPerMin: 120, maxOccupancy: 16 },
  { id: 'PRE_T', lengthFt: 20, speedFtPerMin: 120, maxOccupancy: 8 }, { id: 'T', lengthFt: 30, speedFtPerMin: 120, maxOccupancy: 12 }, { id: 'D', lengthFt: 235, speedFtPerMin: 120, maxOccupancy: 94 },
  { id: 'PURGE', lengthFt: 15, speedFtPerMin: 120, maxOccupancy: 6 }, { id: 'E', lengthFt: 87.5, speedFtPerMin: 120, maxOccupancy: 35 }, { id: 'X', lengthFt: 12.5, speedFtPerMin: 120, maxOccupancy: 5 }, { id: 'S', lengthFt: 20, speedFtPerMin: 120, maxOccupancy: 8 },
  { id: 'A2', lengthFt: 90, speedFtPerMin: 120, maxOccupancy: 36 }, { id: 'B2', lengthFt: 72.5, speedFtPerMin: 120, maxOccupancy: 29 }, { id: 'C2', lengthFt: 72.5, speedFtPerMin: 120, maxOccupancy: 29 },
  { id: 'CARTBUILD_A', lengthFt: 75, speedFtPerMin: 120, maxOccupancy: 30 }, { id: 'CARTBUILD_B', lengthFt: 75, speedFtPerMin: 120, maxOccupancy: 30 }, { id: 'CARTBUILD_C', lengthFt: 75, speedFtPerMin: 120, maxOccupancy: 30 },
]

describe('Milestone 9 application configuration', () => {
  test('pauses and mutates the existing engine in place without resetting its snapshot', () => {
    const engine = new SimulationEngine(SEGMENTS)
    engine.step(25)
    const before = engine.getState()
    const pause = vi.fn()
    const publishState = vi.fn()
    const publishNotice = vi.fn()
    applyOperatingSettingChange(engine, 'cartbuildBEnabled', false, pause, publishState, publishNotice)
    const after = publishState.mock.calls[0][0]
    expect(pause).toHaveBeenCalledOnce()
    expect(after.timeSec).toBe(before.timeSec)
    expect(after.trays).toEqual(before.trays)
    expect(after.missions).toEqual(before.missions)
    expect(after.operatingSettings.cartbuildBEnabled).toBe(false)
    expect(publishNotice).toHaveBeenCalledWith('Simulation paused after configuration change')
    expect(engine.getState()).toEqual(after)
  })

  test('cadence change pauses in place and schedules one full new interval', () => {
    const engine = new SimulationEngine(SEGMENTS)
    engine.step(25)
    const before = engine.getState()
    const pause = vi.fn()
    const publishState = vi.fn()
    const publishNotice = vi.fn()
    applyPlanningCadenceChange(engine, 7.5, pause, publishState, publishNotice)
    const after = publishState.mock.calls[0][0]
    expect(pause).toHaveBeenCalledOnce()
    expect(after.timeSec).toBe(before.timeSec)
    expect(after.trays).toEqual(before.trays)
    expect(after.missions).toEqual(before.missions)
    expect(after.srsControl).toMatchObject({ planningCadenceSec: 7.5, nextPlanningTime: 32.5 })
    expect(publishNotice).toHaveBeenCalledWith('Simulation paused after planning cadence change')
  })

  test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid cadence %s without pausing or mutation', (cadence) => {
    const engine = new SimulationEngine(SEGMENTS)
    const before = engine.getState()
    const pause = vi.fn()
    expect(() => applyPlanningCadenceChange(engine, cadence, pause, vi.fn(), vi.fn())).toThrow(/positive finite/)
    expect(pause).not.toHaveBeenCalled()
    expect(engine.getState()).toEqual(before)
  })

  test('Start Scenario pauses and cleanly applies the selected settings and cadence', () => {
    const engine = new SimulationEngine(SEGMENTS)
    engine.step(25)
    const pause = vi.fn()
    const publishState = vi.fn()
    const publishNotice = vi.fn()
    applyStartScenario(engine, { korberEnabled: true, cartbuildAEnabled: true, cartbuildBEnabled: false, cartbuildCEnabled: false }, 6, pause, publishState, publishNotice)
    const state = publishState.mock.calls[0][0]
    expect(pause).toHaveBeenCalledOnce()
    expect(state).toMatchObject({ timeSec: 0, operatingSettings: { korberEnabled: true, cartbuildAEnabled: true, cartbuildBEnabled: false, cartbuildCEnabled: false } })
    expect(state.srsControl).toMatchObject({ planningCadenceSec: 6, nextPlanningTime: 6 })
    expect(state.materialBalanceError).toBe(0)
    expect(state.cartbuildSystem.cartonBalanceError).toBe(0)
    expect(publishNotice).toHaveBeenCalledWith('Scenario started from selected settings')
  })
})
