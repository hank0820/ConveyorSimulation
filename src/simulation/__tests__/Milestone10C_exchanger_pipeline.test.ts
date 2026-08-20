import { describe, expect, test } from 'vitest'
import SimulationEngine from '../SimulationEngine'
import type { Mission, OutboundRobotLifecycleState, SourceId, Tray } from '../types'

const SEGMENTS = [
  ['A1',81,24],['B1',81,16],['C1',81,16],['PRE_T',20,8],['T',30,12],['D',235,94],['PURGE',15,6],['E',87.5,35],['X',12.5,5],['S',20,8],['A2',90,36],['B2',72.5,29],['C2',72.5,29],['CARTBUILD_A',75,30],['CARTBUILD_B',75,30],['CARTBUILD_C',75,30],
].map(([id,lengthFt,maxOccupancy]) => ({ id: String(id), lengthFt: Number(lengthFt), speedFtPerMin: 120, maxOccupancy: Number(maxOccupancy) }))

type RobotMission = Mission & {
  robotId?: number
  robotState?: OutboundRobotLifecycleState
  robotPayload?: Tray
  payloadTrayId?: number
  payloadLoadState?: 'EMPTY' | 'FULL'
  payloadCartbuildCartonAttached?: boolean
  robotBlockedDurationSec?: number
  robotBlockedSinceSec?: number
  queueEntryTimeSec?: number
  dropEntryTimeSec?: number
  successfulDropTimeSec?: number
  takeArrivalTimeSec?: number
}
type Runtime = {
  timeSec: number
  trays: Tray[]
  cartons: Array<{ internalKey: number; laneId: 'CARTBUILD_A' | 'CARTBUILD_B' | 'CARTBUILD_C'; zoneIndex: number }>
  missions: RobotMission[]
  asrsLastRelease: Record<SourceId, number>
  attemptExchangerReleases: () => void
  processPiles: (delta: number) => void
}

const runtimeOf = (engine: SimulationEngine) => (engine as unknown as { milestone7: Runtime }).milestone7
const pipeline = (engine: SimulationEngine, source: SourceId) => engine.getState().asrsRobotSystem.exchangers[source]
const clearEntrance = (runtime: Runtime, source: SourceId) => {
  runtime.trays = runtime.trays.filter((tray) => !(tray.pilePlacement?.pileId === `${source}1` && tray.pilePlacement.component === 'MDR_PRE_DETRAYER' && tray.pilePlacement.zoneIndex === 0))
}
const blockEntrance = (runtime: Runtime, source: SourceId) => {
  const tray = runtime.trays.find((candidate) => candidate.pilePlacement?.pileId === `${source}1`)!
  tray.pilePlacement = { pileId: `${source}1`, component: 'MDR_PRE_DETRAYER', zoneIndex: 0 }
}
const ready = (engine: SimulationEngine, source: SourceId, count = 1) => {
  const runtime = runtimeOf(engine)
  const missions = runtime.missions.filter(({ assignedExchanger }) => assignedExchanger === source).slice(0, count)
  runtime.missions = missions
  for (const mission of missions) {
    mission.state = 'READY_AT_EXCHANGER'
    mission.robotState = 'QUEUED_FOR_DROP'
    mission.queueEntryTimeSec = mission.readyAtSec
  }
  runtime.timeSec = 200
  runtime.asrsLastRelease = { A: Number.MAX_VALUE, B: Number.MAX_VALUE, C: Number.MAX_VALUE }
  runtime.asrsLastRelease[source] = -1e9
  blockEntrance(runtime, source)
  return { runtime, missions }
}
const assertBalances = (engine: SimulationEngine) => {
  const state = engine.getState()
  expect(state.materialBalanceError).toBe(0)
  expect(state.cartbuildSystem.cartonBalanceError).toBe(0)
  expect(state.createdTrayCount).toBe(state.physicalTrayCount + state.returnSystem.returnedToAsrsCount)
}

describe('Milestone 10C exchanger DROP/TAKE pipeline', () => {
  test('each exchanger exposes independent DROP and TAKE state', () => {
    const engine = new SimulationEngine(SEGMENTS)
    expect(engine.getState().asrsRobotSystem.exchangers).toEqual({
      A: expect.objectContaining({ source: 'A', dropRobotId: null, shiftingOrTakeRobotId: null }),
      B: expect.objectContaining({ source: 'B', dropRobotId: null, shiftingOrTakeRobotId: null }),
      C: expect.objectContaining({ source: 'C', dropRobotId: null, shiftingOrTakeRobotId: null }),
    })
  })

  test('matured queue priority is CARTBUILD, EMPTY, then oldest', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const { runtime, missions } = ready(engine, 'A', 3)
    missions[0].missionType = 'EMPTY'; missions[0].createdAtSec = 0
    missions[1].createdAtSec = 2
    missions[2].createdAtSec = 1
    runtime.asrsLastRelease.A = Number.MAX_VALUE
    expect(pipeline(engine, 'A').queue.map(({ missionId }) => missionId)).toEqual([missions[2].missionId, missions[1].missionId, missions[0].missionId])
  })

  test('selected matured robot enters DROP at an eligible opportunity', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const { runtime, missions } = ready(engine, 'A')
    runtime.attemptExchangerReleases()
    expect(pipeline(engine, 'A')).toMatchObject({ dropRobotId: missions[0].robotId, dropBlocked: true })
  })

  test('blocked DROP robot retains its tray and pending mission', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const { runtime, missions } = ready(engine, 'A')
    const trayId = missions[0].payloadTrayId
    runtime.attemptExchangerReleases()
    expect(missions[0]).toMatchObject({ state: 'READY_AT_EXCHANGER', payloadTrayId: trayId })
    expect(missions[0].robotPayload?.id).toBe(trayId)
  })

  test('blocked DROP ownership prevents subsequent admissions', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const { runtime, missions } = ready(engine, 'A', 3)
    runtime.attemptExchangerReleases()
    runtime.timeSec = 220
    runtime.attemptExchangerReleases()
    expect(pipeline(engine, 'A').dropRobotId).toBe(missions[0].robotId)
    expect(pipeline(engine, 'A').queue.map(({ robotId }) => robotId)).toEqual(missions.slice(1).map(({ robotId }) => robotId))
  })

  test('EMPTY cannot bypass a blocked CARTBUILD DROP robot', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const { runtime, missions } = ready(engine, 'A', 2)
    missions[1].missionType = 'EMPTY'
    runtime.attemptExchangerReleases()
    expect(missions.map(({ state }) => state)).toEqual(['READY_AT_EXCHANGER', 'READY_AT_EXCHANGER'])
    expect(pipeline(engine, 'A').dropRobotId).toBe(missions[0].robotId)
  })

  test('failed unload does not advance the eight-second clock', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const { runtime } = ready(engine, 'A')
    runtime.asrsLastRelease.A = 150
    runtime.attemptExchangerReleases()
    expect(runtime.asrsLastRelease.A).toBe(150)
    expect(pipeline(engine, 'A').lastSuccessfulDropTime).toBe(150)
  })

  test('unblocking causes unload on the next internal simulation tick', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const { runtime, missions } = ready(engine, 'A')
    runtime.timeSec = 204.9
    runtime.attemptExchangerReleases()
    clearEntrance(runtime, 'A')
    engine.step(0.1)
    expect(missions[0].state).toBe('RELEASED')
    expect(pipeline(engine, 'A').lastSuccessfulDropTime).toBeCloseTo(205, 9)
  })

  test('successful unload at 205 schedules the next admission for 213', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const { runtime } = ready(engine, 'A')
    runtime.timeSec = 205
    clearEntrance(runtime, 'A')
    runtime.attemptExchangerReleases()
    expect(pipeline(engine, 'A').nextEligibleCycleAdmissionTime).toBe(213)
  })

  test('successful unload preserves the robot payload tray ID', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const { runtime, missions } = ready(engine, 'A')
    clearEntrance(runtime, 'A')
    const trayId = missions[0].payloadTrayId
    runtime.attemptExchangerReleases()
    expect(runtime.trays.find(({ id }) => id === trayId)?.pilePlacement).toMatchObject({ pileId: 'A1', zoneIndex: 0 })
  })

  test('successful unload atomically exchanges PendingDemand for CurrentCount', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const { runtime } = ready(engine, 'A')
    clearEntrance(runtime, 'A')
    const before = engine.getState()
    runtime.attemptExchangerReleases()
    const after = engine.getState()
    expect(after.srsControl.globalPending).toBe(before.srsControl.globalPending - 1)
    expect(after.srsControl.current.A1).toBe(before.srsControl.current.A1 + 1)
  })

  test('CARTBUILD commitment remains unchanged through unload', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const { runtime } = ready(engine, 'A')
    clearEntrance(runtime, 'A')
    const before = engine.getState().cartbuildSystem.lanes.CARTBUILD_A.committedPositions
    runtime.attemptExchangerReleases()
    expect(engine.getState().cartbuildSystem.lanes.CARTBUILD_A.committedPositions).toBe(before)
  })

  test('CARTBUILD unload requires pile zone 0 but not carton-lane zone 0', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const { runtime, missions } = ready(engine, 'A')
    clearEntrance(runtime, 'A')
    runtime.cartons = [{ internalKey: 1, laneId: 'CARTBUILD_A', zoneIndex: 0 }]
    runtime.attemptExchangerReleases()
    expect(missions[0].state).toBe('RELEASED')
  })

  test('detrayer still blocks the loaded tray when carton-lane zone 0 is occupied', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const { runtime, missions } = ready(engine, 'A')
    clearEntrance(runtime, 'A')
    runtime.cartons = [{ internalKey: 1, laneId: 'CARTBUILD_A', zoneIndex: 0 }]
    runtime.attemptExchangerReleases()
    const tray = runtime.trays.find(({ id }) => id === missions[0].payloadTrayId)!
    tray.pilePlacement!.zoneIndex = 4
    for (let tick = 0; tick < 20; tick++) runtime.processPiles(0.1)
    expect(tray).toMatchObject({ loadState: 'FULL', cartbuildCartonAttached: true, pilePlacement: { zoneIndex: 4 } })
  })

  test('DROP-to-TAKE shifting lasts exactly one simulated second and history follows rack return', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const { runtime, missions } = ready(engine, 'A')
    clearEntrance(runtime, 'A')
    runtime.attemptExchangerReleases()
    expect(pipeline(engine, 'A').shiftingOrTakeRobotId).toBe(missions[0].robotId)
    runtime.timeSec = 200.999
    runtime.attemptExchangerReleases()
    expect(pipeline(engine, 'A').shiftingOrTakeRobotId).toBe(missions[0].robotId)
    runtime.timeSec = 201
    runtime.attemptExchangerReleases()
    expect(pipeline(engine, 'A')).toMatchObject({ shiftingOrTakeRobotId: null, successfulOutboundOnlyCycleCount: 0 })
    expect(engine.getState().asrsRobotSystem.returningRobots[0]).toMatchObject({ robotId: missions[0].robotId, returnStartedAtSec: 201, rackArrivalTimeSec: 211 })
    runtime.timeSec = 211
    runtime.attemptExchangerReleases()
    expect(pipeline(engine, 'A').successfulOutboundOnlyCycleCount).toBe(1)
    expect(engine.getState().asrsRobotSystem.completedOutboundCycles[0]).toMatchObject({ robotId: missions[0].robotId, takeArrivalTimeSec: 201, rackArrivalTimeSec: 211, cycleType: 'OUTBOUND_ONLY' })
  })

  test('a shifting robot completes while another exchanger DROP is blocked', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    const a = runtime.missions.find(({ assignedExchanger }) => assignedExchanger === 'A')!
    const b = runtime.missions.find(({ assignedExchanger }) => assignedExchanger === 'B')!
    runtime.missions = [a, b]
    for (const mission of runtime.missions) { mission.state = 'READY_AT_EXCHANGER'; mission.robotState = 'QUEUED_FOR_DROP' }
    runtime.timeSec = 200
    runtime.asrsLastRelease = { A: -1e9, B: -1e9, C: Number.MAX_VALUE }
    blockEntrance(runtime, 'B')
    clearEntrance(runtime, 'A')
    runtime.attemptExchangerReleases()
    expect(pipeline(engine, 'B').dropBlocked).toBe(true)
    runtime.timeSec = 211
    runtime.attemptExchangerReleases()
    expect(pipeline(engine, 'A').successfulOutboundOnlyCycleCount).toBe(1)
    expect(pipeline(engine, 'B').dropBlocked).toBe(true)
  })

  test('queue advancement takes one second without changing priority order', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const { runtime } = ready(engine, 'A', 3)
    clearEntrance(runtime, 'A')
    runtime.attemptExchangerReleases()
    const order = pipeline(engine, 'A').queue.map(({ robotId }) => robotId)
    runtime.timeSec = 200.5
    expect(pipeline(engine, 'A')).toMatchObject({ queueAdvancementState: 'ADVANCING', queueAdvanceProgress: 0.5 })
    expect(pipeline(engine, 'A').queue.map(({ robotId }) => robotId)).toEqual(order)
    runtime.timeSec = 201
    expect(pipeline(engine, 'A')).toMatchObject({ queueAdvancementState: 'COMPLETE', queueAdvanceProgress: 1 })
  })

  test('successful outbound drops remain at least eight seconds apart', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const { runtime } = ready(engine, 'A', 2)
    clearEntrance(runtime, 'A')
    runtime.attemptExchangerReleases()
    clearEntrance(runtime, 'A')
    runtime.timeSec = 207.999
    runtime.attemptExchangerReleases()
    expect(engine.getState().cartbuildSystem.exchangers.A.releaseTimes).toHaveLength(1)
    runtime.timeSec = 208
    runtime.attemptExchangerReleases()
    expect(engine.getState().cartbuildSystem.exchangers.A.releaseTimes.map(({ timeSec }) => timeSec)).toEqual([200, 208])
  })

  test('A/B/C clocks and blocked states remain independent', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    runtime.missions = (['A', 'B', 'C'] as SourceId[]).map((source) => runtime.missions.find(({ assignedExchanger }) => assignedExchanger === source)!)
    for (const mission of runtime.missions) { mission.state = 'READY_AT_EXCHANGER'; mission.robotState = 'QUEUED_FOR_DROP' }
    runtime.timeSec = 200
    runtime.asrsLastRelease = { A: -1e9, B: -1e9, C: -1e9 }
    blockEntrance(runtime, 'A')
    clearEntrance(runtime, 'B'); clearEntrance(runtime, 'C')
    runtime.attemptExchangerReleases()
    expect(pipeline(engine, 'A').dropBlocked).toBe(true)
    expect(pipeline(engine, 'B')).toMatchObject({ dropRobotId: null, lastSuccessfulDropTime: 200 })
    expect(pipeline(engine, 'C')).toMatchObject({ dropRobotId: null, lastSuccessfulDropTime: 200 })
  })

  test('Reset and Start Scenario clear and deterministically rebuild station state', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const { runtime } = ready(engine, 'A')
    runtime.attemptExchangerReleases()
    expect(pipeline(engine, 'A').dropRobotId).not.toBeNull()
    engine.reset()
    const reset = engine.getState().asrsRobotSystem
    expect(Object.values(reset.exchangers).every(({ dropRobotId, maximumObservedQueueLength }) => dropRobotId === null && maximumObservedQueueLength === 0)).toBe(true)
    expect(reset.completedOutboundCycles).toEqual([])
    engine.startScenario({ korberEnabled: true, cartbuildAEnabled: true, cartbuildBEnabled: true, cartbuildCEnabled: true }, 10)
    expect(engine.getState().asrsRobotSystem).toEqual(reset)
  })

  test('earlier station snapshots are not mutated by later changes', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const before = engine.getState()
    const frozen = JSON.stringify(before.asrsRobotSystem)
    engine.step(180)
    expect(JSON.stringify(before.asrsRobotSystem)).toBe(frozen)
  })

  test('tray and carton balances remain zero through outbound pipeline activity', () => {
    const engine = new SimulationEngine(SEGMENTS)
    for (let second = 0; second < 300; second++) { engine.step(1); assertBalances(engine) }
  })

  test('Milestone 9, 10A, and 10B allocation, timing, and ownership remain valid', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const state = engine.getState()
    expect([state.pendingA, state.pendingB, state.pendingC]).toEqual([34, 33, 33])
    expect(state.missions.every(({ readyAtSec, createdAtSec }) => readyAtSec - createdAtSec === 180)).toBe(true)
    expect(state.asrsRobotSystem).toMatchObject({ robotCarriedTrayCount: 100 })
    expect([state.cartbuildSystem.lanes.CARTBUILD_A.availablePositions, state.cartbuildSystem.lanes.CARTBUILD_B.availablePositions, state.cartbuildSystem.lanes.CARTBUILD_C.availablePositions]).toEqual([0, 0, 0])
    assertBalances(engine)
  })
})
