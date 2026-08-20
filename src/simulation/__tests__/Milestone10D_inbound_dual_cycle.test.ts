import { describe, expect, test } from 'vitest'
import SimulationEngine from '../SimulationEngine'
import type { Mission, OutboundRobotLifecycleState, SourceId, Tray, TrayLoadState } from '../types'

const SEGMENTS = [
  ['A1',81,24],['B1',81,16],['C1',81,16],['PRE_T',20,8],['T',30,12],['D',235,94],['PURGE',15,6],['E',87.5,35],['X',12.5,5],['S',20,8],['A2',90,36],['B2',72.5,29],['C2',72.5,29],['CARTBUILD_A',75,30],['CARTBUILD_B',75,30],['CARTBUILD_C',75,30],
].map(([id,lengthFt,maxOccupancy]) => ({ id: String(id), lengthFt: Number(lengthFt), speedFtPerMin: 120, maxOccupancy: Number(maxOccupancy) }))

const LEGACY_SEGMENTS = SEGMENTS.filter(({ id }) => !id.startsWith('CARTBUILD_'))

type RobotMission = Mission & {
  robotId?: number
  robotState?: OutboundRobotLifecycleState
  robotPayload?: Tray
  inboundPayload?: Tray
  queueEntryTimeSec?: number
}
type InboundMission = {
  missionId: number
  robotId: number
  assignedExchanger: SourceId
  reservedTrayId: number
  robotState: string
  maturityTimeSec: number
  cancellationTimeSec?: number
  cancelledAfterAdmission: boolean
  inboundPayload?: Tray
}
type Runtime = {
  timeSec: number
  trays: Tray[]
  missions: RobotMission[]
  inboundMissions: InboundMission[]
  inboundReservations: Map<number, number>
  asrsLastRelease: Record<SourceId, number>
  matureMissions: () => void
  processExchangerSinks: () => void
  attemptExchangerReleases: () => void
  cancelInboundReservation: (trayId: number) => void
}

const runtimeOf = (engine: SimulationEngine) => (engine as unknown as { milestone7: Runtime }).milestone7
const stateOf = (engine: SimulationEngine) => engine.getState().asrsRobotSystem
const destinationFor = (source: SourceId) => `${source}2` as 'A2' | 'B2' | 'C2'
const placeFinalTray = (engine: SimulationEngine, source: SourceId, loadState: TrayLoadState = 'EMPTY') => {
  const runtime = runtimeOf(engine)
  const tray = runtime.trays.find((candidate) => candidate.zonePlacement?.conveyorId === 'D')!
  tray.pilePlacement = undefined
  tray.pileRuntime = undefined
  tray.zonePlacement = undefined
  tray.inboundPlacement = { conveyorId: destinationFor(source), component: 'MDR_EXCHANGER_SIDE', zoneIndex: 4 }
  tray.currentSegmentId = destinationFor(source)
  tray.positionFt = (source === 'A' ? 123.5 : 106) + 11.25
  tray.loadState = loadState
  tray.status = 'BLOCKED'
  return tray
}

const openPileEntrance = (runtime: Runtime, source: SourceId) => {
  const tray = runtime.trays.find((candidate) => candidate.pilePlacement?.pileId === `${source}1` && candidate.pilePlacement.component === 'MDR_PRE_DETRAYER' && candidate.pilePlacement.zoneIndex === 0)
  if (tray) {
    tray.currentSegmentId = 'TEST_HOLD'
    tray.pilePlacement = undefined
    tray.pileRuntime = undefined
  }
}

const blockPileEntrance = (runtime: Runtime, source: SourceId) => {
  const tray = runtime.trays.find((candidate) => candidate.pilePlacement?.pileId === `${source}1`)!
  tray.pilePlacement = { pileId: `${source}1`, component: 'MDR_PRE_DETRAYER', zoneIndex: 0 }
}

const retainOutbound = (runtime: Runtime, source: SourceId, count = 1) => {
  const selected = runtime.missions.filter((mission) => mission.assignedExchanger === source).slice(0, count)
  runtime.missions = selected
  return selected
}

const readyOutbound = (runtime: Runtime, source: SourceId, count = 1) => {
  const selected = retainOutbound(runtime, source, count)
  for (const mission of selected) {
    mission.state = 'READY_AT_EXCHANGER'
    mission.robotState = 'QUEUED_FOR_DROP'
    mission.queueEntryTimeSec = mission.readyAtSec
  }
  return selected
}

const dispatchInbound = (engine: SimulationEngine, source: SourceId, loadState: TrayLoadState = 'EMPTY') => {
  const tray = placeFinalTray(engine, source, loadState)
  const runtime = runtimeOf(engine)
  runtime.processExchangerSinks()
  const mission = runtime.inboundMissions.find((candidate) => candidate.reservedTrayId === tray.id)!
  return { runtime, tray, mission }
}

const matureAt = (runtime: Runtime, timeSec: number) => {
  runtime.timeSec = timeSec
  runtime.matureMissions()
}
const isolateInbound = (runtime: Runtime) => { runtime.missions = [] }
const deferOutbound = (runtime: Runtime) => {
  for (const mission of runtime.missions) {
    mission.state = 'RETRIEVING'
    mission.readyAtSec = 1e9
    mission.robotState = 'TRAVELING_OUTBOUND'
  }
}

const assertBalances = (engine: SimulationEngine) => {
  const state = engine.getState()
  expect(state.materialBalanceError).toBe(0)
  expect(state.cartbuildSystem.cartonBalanceError).toBe(0)
  expect(state.createdTrayCount).toBe(state.physicalTrayCount + state.returnSystem.returnedToAsrsCount)
}

describe('Milestone 10D inbound reservations and dual cycles', () => {
  test('a final-zone tray remains physical while its robot approaches', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const { tray } = dispatchInbound(engine, 'A')
    expect(engine.getState().trays.some(({ id }) => id === tray.id)).toBe(true)
  })

  test('one unreserved final-zone tray dispatches exactly one inbound-only robot', () => {
    const engine = new SimulationEngine(SEGMENTS)
    dispatchInbound(engine, 'A')
    runtimeOf(engine).processExchangerSinks()
    expect(stateOf(engine).inboundOnlyRobots).toHaveLength(1)
  })

  test('the inbound-only robot reserves the exact tray identity', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const { tray, mission } = dispatchInbound(engine, 'A', 'FULL')
    expect(stateOf(engine).inboundReservations).toEqual([expect.objectContaining({ trayId: tray.id, robotId: mission.robotId, loadState: 'FULL' })])
  })

  test('a retrieving outbound robot does not prevent inbound-only dispatch', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const { runtime } = dispatchInbound(engine, 'A')
    expect(runtime.missions.some((mission) => mission.assignedExchanger === 'A' && mission.state === 'RETRIEVING')).toBe(true)
    expect(runtime.inboundMissions).toHaveLength(1)
  })

  test('a matured outbound robot prevents unnecessary inbound-only dispatch', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    readyOutbound(runtime, 'A')
    placeFinalTray(engine, 'A')
    runtime.processExchangerSinks()
    expect(runtime.inboundMissions).toHaveLength(0)
  })

  test('inbound-only travel matures at exactly 180 seconds', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const { runtime, mission } = dispatchInbound(engine, 'A')
    matureAt(runtime, mission.maturityTimeSec - 0.001)
    expect(stateOf(engine).inboundOnlyRobots[0]).toMatchObject({ lifecycleState: 'TRAVELING_TO_DROP' })
    matureAt(runtime, mission.maturityTimeSec)
    expect(stateOf(engine).inboundOnlyRobots[0]).toMatchObject({ lifecycleState: 'QUEUED_FOR_DROP', travelProgress: 1 })
  })

  test('inbound-only robots queue behind CARTBUILD and EMPTY outbound robots', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const { runtime, mission: inbound } = dispatchInbound(engine, 'A')
    const outbound = readyOutbound(runtime, 'A', 2)
    outbound[0].missionType = 'EMPTY'
    outbound[1].missionType = 'CARTBUILD'
    matureAt(runtime, inbound.maturityTimeSec)
    expect(stateOf(engine).exchangers.A.queue.map(({ missionType }) => missionType)).toEqual(['CARTBUILD', 'EMPTY', 'INBOUND_ONLY'])
  })

  test('inbound-only DROP admission consumes one eight-second opportunity', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const { runtime, mission } = dispatchInbound(engine, 'A')
    deferOutbound(runtime)
    matureAt(runtime, mission.maturityTimeSec)
    runtime.attemptExchangerReleases()
    expect(stateOf(engine).exchangers.A).toMatchObject({ lastSuccessfulDropTime: mission.maturityTimeSec, nextEligibleCycleAdmissionTime: mission.maturityTimeSec + 8 })
  })

  test('a blocked outbound DROP robot prevents inbound-only admission', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const { runtime, mission: inbound } = dispatchInbound(engine, 'A')
    const outbound = readyOutbound(runtime, 'A')[0]
    matureAt(runtime, inbound.maturityTimeSec)
    blockPileEntrance(runtime, 'A')
    runtime.attemptExchangerReleases()
    expect(stateOf(engine).exchangers.A).toMatchObject({ dropRobotId: outbound.robotId, dropBlocked: true })
    expect(missionState(engine, inbound.robotId)).toBe('QUEUED_FOR_DROP')
  })

  test('inbound-only DROP passage creates no outbound tray', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const { runtime, mission } = dispatchInbound(engine, 'A')
    deferOutbound(runtime)
    const before = engine.getState().createdTrayCount
    matureAt(runtime, mission.maturityTimeSec)
    runtime.attemptExchangerReleases()
    expect(engine.getState().createdTrayCount).toBe(before)
  })

  test('inbound pickup occurs at exactly one second and preserves ID and load', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const { runtime, mission, tray } = dispatchInbound(engine, 'A', 'FULL')
    isolateInbound(runtime)
    matureAt(runtime, mission.maturityTimeSec)
    runtime.attemptExchangerReleases()
    runtime.timeSec = mission.maturityTimeSec + 0.999
    runtime.attemptExchangerReleases()
    expect(stateOf(engine).exchangers.A.shiftingOrTakeRobotId).toBe(mission.robotId)
    runtime.timeSec = mission.maturityTimeSec + 1
    runtime.attemptExchangerReleases()
    expect(stateOf(engine).returningRobots[0]).toMatchObject({ inboundTrayId: tray.id, inboundTrayLoadState: 'FULL', returnStartedAtSec: mission.maturityTimeSec + 1 })
  })

  test('an outbound pickup with an inbound tray completes as DUAL_CYCLE', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const { runtime, mission: inbound } = dispatchInbound(engine, 'A')
    readyOutbound(runtime, 'A')
    openPileEntrance(runtime, 'A')
    matureAt(runtime, inbound.maturityTimeSec)
    runtime.attemptExchangerReleases()
    runtime.timeSec = inbound.maturityTimeSec + 11
    runtime.attemptExchangerReleases()
    expect(stateOf(engine).completedCycles).toContainEqual(expect.objectContaining({ cycleType: 'DUAL_CYCLE' }))
  })

  test('an outbound robot without an inbound tray completes as OUTBOUND_ONLY', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    readyOutbound(runtime, 'A')
    openPileEntrance(runtime, 'A')
    runtime.timeSec = 200
    runtime.asrsLastRelease.A = -1e9
    runtime.attemptExchangerReleases()
    runtime.timeSec = 211
    runtime.attemptExchangerReleases()
    expect(stateOf(engine).completedCycles).toContainEqual(expect.objectContaining({ cycleType: 'OUTBOUND_ONLY' }))
  })

  test('return travel completes at exactly ten seconds after TAKE', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const { runtime, mission } = dispatchInbound(engine, 'A')
    isolateInbound(runtime)
    matureAt(runtime, mission.maturityTimeSec)
    runtime.attemptExchangerReleases()
    runtime.timeSec = mission.maturityTimeSec + 10.999
    runtime.attemptExchangerReleases()
    expect(stateOf(engine).returningRobots).toHaveLength(1)
    runtime.timeSec = mission.maturityTimeSec + 11
    runtime.attemptExchangerReleases()
    expect(stateOf(engine).completedCycles).toContainEqual(expect.objectContaining({ rackArrivalTimeSec: mission.maturityTimeSec + 11 }))
  })

  test('TAKE completion does not postpone the next DROP opportunity', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    readyOutbound(runtime, 'A', 2)
    openPileEntrance(runtime, 'A')
    runtime.timeSec = 200
    runtime.asrsLastRelease.A = -1e9
    runtime.attemptExchangerReleases()
    openPileEntrance(runtime, 'A')
    runtime.timeSec = 208
    runtime.attemptExchangerReleases()
    expect(engine.getState().cartbuildSystem.exchangers.A.releaseTimes.map(({ timeSec }) => timeSec)).toEqual([200, 208])
  })

  test('a returning inbound tray remains physical inventory', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const { runtime, mission } = dispatchInbound(engine, 'A')
    isolateInbound(runtime)
    const before = engine.getState().physicalTrayCount
    matureAt(runtime, mission.maturityTimeSec)
    runtime.attemptExchangerReleases()
    runtime.timeSec = mission.maturityTimeSec + 1
    runtime.attemptExchangerReleases()
    expect(engine.getState().physicalTrayCount).toBe(before)
  })

  test('returned count increments only at rack arrival', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const { runtime, mission } = dispatchInbound(engine, 'A')
    isolateInbound(runtime)
    matureAt(runtime, mission.maturityTimeSec)
    runtime.attemptExchangerReleases()
    runtime.timeSec = mission.maturityTimeSec + 10.999
    runtime.attemptExchangerReleases()
    expect(engine.getState().returnSystem.returnedToAsrsCount).toBe(0)
    runtime.timeSec = mission.maturityTimeSec + 11
    runtime.attemptExchangerReleases()
    expect(engine.getState().returnSystem.returnedToAsrsCount).toBe(1)
  })

  test('pickup immediately reduces the matching SRS CurrentCount', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const { runtime, mission } = dispatchInbound(engine, 'A')
    isolateInbound(runtime)
    const before = engine.getState().srsControl.current.A2
    matureAt(runtime, mission.maturityTimeSec)
    runtime.attemptExchangerReleases()
    runtime.timeSec = mission.maturityTimeSec + 1
    runtime.attemptExchangerReleases()
    expect(engine.getState().srsControl.current.A2).toBe(before - 1)
  })

  test('material balance remains zero through pickup and rack arrival', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const { runtime, mission } = dispatchInbound(engine, 'A')
    deferOutbound(runtime)
    matureAt(runtime, mission.maturityTimeSec)
    runtime.attemptExchangerReleases()
    runtime.timeSec = mission.maturityTimeSec + 1
    runtime.attemptExchangerReleases()
    assertBalances(engine)
    runtime.timeSec = mission.maturityTimeSec + 11
    runtime.attemptExchangerReleases()
    assertBalances(engine)
  })

  test('inbound-only missions do not affect PendingDemand or global reservation', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const before = engine.getState().srsControl
    dispatchInbound(engine, 'A')
    const after = engine.getState().srsControl
    expect([after.globalPending, after.globalAvailableCapacity]).toEqual([before.globalPending, before.globalAvailableCapacity])
  })

  test('an outbound TAKE claims a tray reserved by an approaching robot', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const { runtime, mission: inbound, tray } = dispatchInbound(engine, 'A')
    readyOutbound(runtime, 'A')
    openPileEntrance(runtime, 'A')
    matureAt(runtime, inbound.maturityTimeSec)
    runtime.attemptExchangerReleases()
    runtime.timeSec = inbound.maturityTimeSec + 1
    runtime.attemptExchangerReleases()
    expect(stateOf(engine).returningRobots).toContainEqual(expect.objectContaining({ robotKind: 'OUTBOUND', inboundTrayId: tray.id }))
  })

  test('pre-admission cancellation removes the inbound robot and reservation', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const { runtime, mission: inbound } = dispatchInbound(engine, 'A')
    readyOutbound(runtime, 'A')
    openPileEntrance(runtime, 'A')
    matureAt(runtime, inbound.maturityTimeSec)
    runtime.attemptExchangerReleases()
    runtime.timeSec = inbound.maturityTimeSec + 1
    runtime.attemptExchangerReleases()
    expect(stateOf(engine).inboundReservations).toEqual([])
    expect(stateOf(engine).inboundOnlyRobots).toContainEqual(expect.objectContaining({ robotId: inbound.robotId, lifecycleState: 'CANCELLED', cancelledAfterAdmission: false }))
  })

  test('post-admission cancellation preserves the cycle and returns empty', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const { runtime, mission, tray } = dispatchInbound(engine, 'A')
    isolateInbound(runtime)
    matureAt(runtime, mission.maturityTimeSec)
    runtime.attemptExchangerReleases()
    runtime.timeSec = mission.maturityTimeSec + 0.5
    runtime.cancelInboundReservation(tray.id)
    runtime.timeSec = mission.maturityTimeSec + 1
    runtime.attemptExchangerReleases()
    expect(stateOf(engine).returningRobots[0]).toMatchObject({ inboundTrayId: null })
    expect(stateOf(engine).cancelledInboundOnlyRobots[0]).toMatchObject({ cancelledAfterAdmission: true })
    expect(stateOf(engine).exchangers.A.lastSuccessfulDropTime).toBe(mission.maturityTimeSec)
  })

  test('cancelled robots are retained but never reassigned', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const { runtime, mission: inbound } = dispatchInbound(engine, 'A')
    readyOutbound(runtime, 'A')
    openPileEntrance(runtime, 'A')
    matureAt(runtime, inbound.maturityTimeSec)
    runtime.attemptExchangerReleases()
    runtime.timeSec = inbound.maturityTimeSec + 20
    runtime.attemptExchangerReleases()
    expect(stateOf(engine).inboundOnlyRobots.find(({ robotId }) => robotId === inbound.robotId)?.lifecycleState).toBe('CANCELLED')
  })

  test('the same inbound tray is never returned twice', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const { runtime, mission, tray } = dispatchInbound(engine, 'A')
    isolateInbound(runtime)
    matureAt(runtime, mission.maturityTimeSec)
    runtime.attemptExchangerReleases()
    runtime.timeSec = mission.maturityTimeSec + 11
    runtime.attemptExchangerReleases()
    runtime.processExchangerSinks()
    expect(engine.getState().returnSystem.returnedHistory.filter(({ trayId }) => trayId === tray.id)).toHaveLength(1)
  })

  test('A, B, and C inbound cycles operate concurrently', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const a = dispatchInbound(engine, 'A')
    const b = dispatchInbound(engine, 'B')
    const c = dispatchInbound(engine, 'C')
    isolateInbound(a.runtime)
    matureAt(a.runtime, 180)
    a.runtime.attemptExchangerReleases()
    expect(stateOf(engine).returningRobots).toHaveLength(0)
    a.runtime.timeSec = 181
    a.runtime.attemptExchangerReleases()
    expect(new Set(stateOf(engine).returningRobots.map(({ exchanger }) => exchanger))).toEqual(new Set(['A', 'B', 'C']))
    expect([a.mission, b.mission, c.mission].every(({ robotState }) => robotState === 'RETURNING_TO_RACK')).toBe(true)
  })

  test('completed history classifies inbound-only and cancellation cycles', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const { runtime, mission, tray } = dispatchInbound(engine, 'A')
    isolateInbound(runtime)
    matureAt(runtime, mission.maturityTimeSec)
    runtime.attemptExchangerReleases()
    runtime.timeSec = mission.maturityTimeSec + 0.5
    runtime.cancelInboundReservation(tray.id)
    runtime.timeSec = mission.maturityTimeSec + 11
    runtime.attemptExchangerReleases()
    expect(stateOf(engine).completedCountByClassification.CANCELLED_INBOUND_ONLY).toBe(1)
  })

  test('dual-cycle percentage uses completed outbound interactions', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const { runtime, mission: inbound } = dispatchInbound(engine, 'A')
    readyOutbound(runtime, 'A')
    openPileEntrance(runtime, 'A')
    matureAt(runtime, inbound.maturityTimeSec)
    runtime.attemptExchangerReleases()
    runtime.timeSec = inbound.maturityTimeSec + 11
    runtime.attemptExchangerReleases()
    expect(stateOf(engine).dualCyclePercentage).toBe(100)
  })

  test('Reset clears reservations, inbound robots, returns, and histories', () => {
    const engine = new SimulationEngine(SEGMENTS)
    dispatchInbound(engine, 'A')
    engine.reset()
    expect(stateOf(engine)).toMatchObject({ inboundReservations: [], inboundOnlyRobots: [], returningRobots: [], completedCycles: [], cancelledInboundOnlyRobots: [] })
  })

  test('Start Scenario deterministically rebuilds clean robot state and IDs', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const firstRobot = dispatchInbound(engine, 'A').mission.robotId
    engine.startScenario({ korberEnabled: true, cartbuildAEnabled: true, cartbuildBEnabled: true, cartbuildCEnabled: true }, 10)
    const secondRobot = dispatchInbound(engine, 'A').mission.robotId
    expect(secondRobot).toBe(firstRobot)
    expect(stateOf(engine).completedCycles).toEqual([])
  })

  test('earlier robot snapshots remain immutable', () => {
    const engine = new SimulationEngine(SEGMENTS)
    dispatchInbound(engine, 'A')
    const before = stateOf(engine)
    const frozen = JSON.stringify(before)
    engine.step(1)
    expect(JSON.stringify(before)).toBe(frozen)
  })

  test('tray and carton balances remain zero with inbound robots', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const { runtime } = dispatchInbound(engine, 'A', 'FULL')
    deferOutbound(runtime)
    assertBalances(engine)
    engine.step(191)
    assertBalances(engine)
  })

  test('legacy return topology retains provisional sink compatibility', () => {
    const engine = new SimulationEngine(LEGACY_SEGMENTS)
    const tray = placeFinalTray(engine, 'A')
    runtimeOf(engine).processExchangerSinks()
    expect(engine.getState().trays.some(({ id }) => id === tray.id)).toBe(false)
    expect(engine.getState().returnSystem.returnedHistory).toContainEqual(expect.objectContaining({ trayId: tray.id }))
  })
})

const missionState = (engine: SimulationEngine, robotId: number) => stateOf(engine).inboundOnlyRobots.find((robot) => robot.robotId === robotId)?.lifecycleState
