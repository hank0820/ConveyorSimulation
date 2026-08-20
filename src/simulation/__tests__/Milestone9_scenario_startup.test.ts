import { describe, expect, test, vi } from 'vitest'
import SimulationEngine from '../SimulationEngine'
import type { OperatingSettings, SourceId } from '../types'

const SEGMENTS = [
  ['A1', 81, 24], ['B1', 81, 16], ['C1', 81, 16], ['PRE_T', 20, 8], ['T', 30, 12], ['D', 235, 94],
  ['PURGE', 15, 6], ['E', 87.5, 35], ['X', 12.5, 5], ['S', 20, 8], ['A2', 90, 36], ['B2', 72.5, 29], ['C2', 72.5, 29],
  ['CARTBUILD_A', 75, 30], ['CARTBUILD_B', 75, 30], ['CARTBUILD_C', 75, 30],
].map(([id, lengthFt, maxOccupancy]) => ({ id: String(id), lengthFt: Number(lengthFt), speedFtPerMin: 120, maxOccupancy: Number(maxOccupancy) }))

const ALL_ON: OperatingSettings = { korberEnabled: true, cartbuildAEnabled: true, cartbuildBEnabled: true, cartbuildCEnabled: true }
const missionCounts = (engine: SimulationEngine, source: SourceId, type: 'EMPTY' | 'CARTBUILD') =>
  engine.getState().missions.filter((mission) => mission.assignedExchanger === source && mission.missionType === type).length

describe('Milestone 9 clean scenario startup', () => {
  test('all-ON startup creates the default 34/33/33 allocation exactly once', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = (engine as unknown as { milestone7: { planPendingDemand: () => void } }).milestone7
    const planner = vi.spyOn(runtime, 'planPendingDemand')
    engine.startScenario(ALL_ON, 10)
    const state = engine.getState()
    expect(planner).toHaveBeenCalledOnce()
    expect([state.pendingA, state.pendingB, state.pendingC]).toEqual([34, 33, 33])
    expect(state.missions).toHaveLength(100)
    expect(state.missions.filter((mission) => mission.missionType === 'CARTBUILD')).toHaveLength(90)
    expect(state.missions.every((mission) => mission.createdAtSec === 0)).toBe(true)
    expect(state.srsControl).toMatchObject({ planningCadenceSec: 10, nextPlanningTime: 10 })
  })

  test('Körber-only startup creates 34/33/33 EMPTY missions and no CARTBUILD missions', () => {
    const engine = new SimulationEngine(SEGMENTS)
    engine.startScenario({ ...ALL_ON, cartbuildAEnabled: false, cartbuildBEnabled: false, cartbuildCEnabled: false }, 10)
    expect((['A', 'B', 'C'] as SourceId[]).map((source) => missionCounts(engine, source, 'EMPTY'))).toEqual([34, 33, 33])
    expect(engine.getState().missions.some((mission) => mission.missionType === 'CARTBUILD')).toBe(false)
  })

  test('cartbuild-only startup creates CARTBUILD missions without Körber', () => {
    const engine = new SimulationEngine(SEGMENTS)
    engine.startScenario({ ...ALL_ON, korberEnabled: false }, 10)
    expect(engine.getState().operatingSettings.korberEnabled).toBe(false)
    expect(engine.getState().missions).toHaveLength(90)
    expect(engine.getState().missions.every((mission) => mission.missionType === 'CARTBUILD')).toBe(true)
  })

  test('mixed startup types A as CARTBUILD and B/C as EMPTY', () => {
    const engine = new SimulationEngine(SEGMENTS)
    engine.startScenario({ ...ALL_ON, cartbuildBEnabled: false, cartbuildCEnabled: false }, 10)
    expect([missionCounts(engine, 'A', 'CARTBUILD'), missionCounts(engine, 'B', 'EMPTY'), missionCounts(engine, 'C', 'EMPTY')]).toEqual([30, 33, 33])
    expect(missionCounts(engine, 'A', 'EMPTY')).toBe(4)
    expect(missionCounts(engine, 'B', 'CARTBUILD') + missionCounts(engine, 'C', 'CARTBUILD')).toBe(0)
  })

  test('all toggles OFF creates no missions and remains balanced', () => {
    const engine = new SimulationEngine(SEGMENTS)
    engine.startScenario({ korberEnabled: false, cartbuildAEnabled: false, cartbuildBEnabled: false, cartbuildCEnabled: false }, 10)
    const state = engine.getState()
    expect(state.missions).toEqual([])
    expect(state).toMatchObject({ timeSec: 0, materialBalanceError: 0 })
    expect(state.cartbuildSystem.cartonBalanceError).toBe(0)
    expect(state.srsControl).toMatchObject({ globalPending: 0, globalAvailableCapacity: 100, nextPlanningTime: 10 })
  })

  test('selected cadence is installed before planning and normal Reset restores defaults', () => {
    const engine = new SimulationEngine(SEGMENTS)
    engine.startScenario({ ...ALL_ON, cartbuildBEnabled: false }, 7.5)
    expect(engine.getState().srsControl).toMatchObject({ planningCadenceSec: 7.5, nextPlanningTime: 7.5 })
    engine.reset()
    const reset = engine.getState()
    expect(reset.operatingSettings).toEqual(ALL_ON)
    expect(reset.srsControl).toMatchObject({ planningCadenceSec: 10, nextPlanningTime: 10 })
    expect([reset.pendingA, reset.pendingB, reset.pendingC]).toEqual([34, 33, 33])
    expect(reset.missions.filter((mission) => mission.missionType === 'CARTBUILD')).toHaveLength(90)
    expect(reset.materialBalanceError).toBe(0)
    expect(reset.cartbuildSystem.cartonBalanceError).toBe(0)
  })
})
