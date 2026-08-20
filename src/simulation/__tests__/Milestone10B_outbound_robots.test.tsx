import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import ConveyorDiagram from '../../visualization/ConveyorDiagram'
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
  robotBlockedReason?: string | null
  robotBlockedDurationSec?: number
}
type Runtime = {
  timeSec: number
  trays: Tray[]
  cartons: Array<{ internalKey: number; laneId: 'CARTBUILD_A' | 'CARTBUILD_B' | 'CARTBUILD_C'; zoneIndex: number }>
  missions: RobotMission[]
  totalTraysCreated: number
  asrsLastRelease: Record<SourceId, number>
  matureMissions: () => void
  attemptExchangerReleases: (deltaSec?: number) => void
}
const runtimeOf = (engine: SimulationEngine) => (engine as unknown as { milestone7: Runtime }).milestone7
const robots = (engine: SimulationEngine) => engine.getState().asrsRobotSystem.outboundRobots
const clearEntrance = (runtime: Runtime, source: SourceId) => {
  runtime.trays = runtime.trays.filter((tray) => !(tray.pilePlacement?.pileId === `${source}1` && tray.pilePlacement.component === 'MDR_PRE_DETRAYER' && tray.pilePlacement.zoneIndex === 0))
}
const blockEntrance = (runtime: Runtime, source: SourceId) => {
  const tray = runtime.trays.find((candidate) => candidate.pilePlacement?.pileId === `${source}1`)!
  tray.pilePlacement = { pileId: `${source}1`, component: 'MDR_PRE_DETRAYER', zoneIndex: 0 }
}
const assertBalances = (engine: SimulationEngine) => {
  const state = engine.getState()
  expect(state.materialBalanceError).toBe(0)
  expect(state.cartbuildSystem.cartonBalanceError).toBe(0)
  expect(state.createdTrayCount).toBe(state.physicalTrayCount + state.returnSystem.returnedToAsrsCount)
}

describe('Milestone 10B outbound ASRS robots', () => {
  test('every time-zero mission has one unique robot and payload tray', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const state = engine.getState()
    expect(robots(engine)).toHaveLength(state.missions.length)
    expect(new Set(robots(engine).map(({ robotId }) => robotId)).size).toBe(state.missions.length)
    expect(new Set(robots(engine).map(({ payloadTrayId }) => payloadTrayId)).size).toBe(state.missions.length)
    expect(robots(engine).map(({ missionId }) => missionId).sort((a, b) => a - b)).toEqual(state.missions.map(({ missionId }) => missionId).sort((a, b) => a - b))
  })

  test('default reset creates 100 outbound robots carrying 100 trays', () => {
    const engine = new SimulationEngine(SEGMENTS)
    expect(engine.getState().asrsRobotSystem).toMatchObject({ robotCarriedTrayCount: 100 })
    expect(robots(engine)).toHaveLength(100)
    expect(robots(engine).every(({ ownsPayload }) => ownsPayload)).toBe(true)
  })

  test('default time zero has 148 conveyor trays and 248 total physical trays', () => {
    const state = new SimulationEngine(SEGMENTS).getState()
    expect(state.trays).toHaveLength(148)
    expect(state.physicalTrayCount).toBe(248)
    expect(state.createdTrayCount).toBe(248)
  })

  test('CARTBUILD missions create one attached anonymous carton at assignment', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const state = engine.getState()
    expect(robots(engine).filter(({ missionType }) => missionType === 'CARTBUILD').every(({ payloadLoadState, cartbuildCartonAttached }) => payloadLoadState === 'FULL' && cartbuildCartonAttached)).toBe(true)
    expect(state.cartbuildSystem).toMatchObject({ cartbuildCartonsIntroduced: 90, cartbuildCartonsAttachedToTrays: 90 })
  })

  test('EMPTY missions create EMPTY payload trays without cartons', () => {
    const engine = new SimulationEngine(SEGMENTS)
    engine.startScenario({ korberEnabled: true, cartbuildAEnabled: false, cartbuildBEnabled: false, cartbuildCEnabled: false }, 10)
    expect(robots(engine)).toHaveLength(100)
    expect(robots(engine).every(({ missionType, payloadLoadState, cartbuildCartonAttached }) => missionType === 'EMPTY' && payloadLoadState === 'EMPTY' && !cartbuildCartonAttached)).toBe(true)
    expect(engine.getState().cartbuildSystem.cartbuildCartonsIntroduced).toBe(0)
  })

  test('tray and carton balances are zero at time zero', () => {
    assertBalances(new SimulationEngine(SEGMENTS))
  })

  test('outbound travel progress is linear and approximately one half at 90 seconds', () => {
    const engine = new SimulationEngine(SEGMENTS)
    engine.step(90)
    expect(robots(engine).filter(({ assignedAtSec }) => assignedAtSec === 0).every(({ travelProgress }) => Math.abs(travelProgress - 0.5) < 1e-9)).toBe(true)
  })

  test('no robot matures or drops before 180 seconds', () => {
    const engine = new SimulationEngine(SEGMENTS)
    engine.step(179.9)
    const state = engine.getState()
    const original = robots(engine).filter(({ assignedAtSec }) => assignedAtSec === 0)
    expect(original).toHaveLength(100)
    expect(original.every(({ lifecycleState, ownsPayload }) => lifecycleState === 'TRAVELING_OUTBOUND' && ownsPayload)).toBe(true)
    const originalPayloadIds = new Set(original.map(({ payloadTrayId }) => payloadTrayId))
    expect(state.trays.some(({ id }) => originalPayloadIds.has(id))).toBe(false)
  })

  test('robots enter stable deterministic exchanger queues at maturity', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    runtime.asrsLastRelease = { A: Number.MAX_VALUE, B: Number.MAX_VALUE, C: Number.MAX_VALUE }
    engine.step(180)
    const state = engine.getState()
    for (const source of ['A', 'B', 'C'] as SourceId[]) {
      const expected = robots(engine).filter(({ assignedExchanger, lifecycleState }) => assignedExchanger === source && lifecycleState !== 'TRAVELING_OUTBOUND' && lifecycleState !== 'OUTBOUND_COMPLETE').map(({ robotId }) => robotId)
      expect(state.asrsRobotSystem.maturedQueues[source]).toEqual(expected)
    }
  })

  test('CARTBUILD robots queue ahead of EMPTY robots', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    const aMissions = runtime.missions.filter(({ assignedExchanger }) => assignedExchanger === 'A').slice(0, 2)
    aMissions[0].missionType = 'EMPTY'
    for (const mission of aMissions) { mission.state = 'READY_AT_EXCHANGER'; mission.robotState = 'QUEUED_FOR_DROP' }
    runtime.missions = aMissions
    expect(engine.getState().asrsRobotSystem.maturedQueues.A).toEqual([aMissions[1].robotId, aMissions[0].robotId])
  })

  test('oldest assignment and mission ID win within a mission type', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    const aMissions = runtime.missions.filter(({ assignedExchanger }) => assignedExchanger === 'A').slice(0, 3)
    aMissions[0].createdAtSec = 5
    aMissions[1].createdAtSec = 2
    aMissions[2].createdAtSec = 2
    for (const mission of aMissions) { mission.state = 'READY_AT_EXCHANGER'; mission.robotState = 'QUEUED_FOR_DROP' }
    runtime.missions = aMissions
    expect(engine.getState().asrsRobotSystem.maturedQueues.A).toEqual([aMissions[1].robotId, aMissions[2].robotId, aMissions[0].robotId])
  })

  test('successful drop preserves payload tray identity without incrementing created count', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    const mission = runtime.missions[0]
    runtime.missions = [mission]
    mission.state = 'READY_AT_EXCHANGER'
    mission.robotState = 'QUEUED_FOR_DROP'
    clearEntrance(runtime, mission.assignedExchanger)
    runtime.asrsLastRelease[mission.assignedExchanger] = -1e9
    const payloadId = mission.payloadTrayId
    const created = runtime.totalTraysCreated
    runtime.attemptExchangerReleases()
    expect(runtime.totalTraysCreated).toBe(created)
    expect(runtime.trays.find(({ id }) => id === payloadId)?.pilePlacement).toMatchObject({ pileId: `${mission.assignedExchanger}1`, zoneIndex: 0 })
  })

  test('successful drop atomically changes PendingDemand to physical SRS CurrentCount', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    const mission = runtime.missions.find(({ assignedExchanger }) => assignedExchanger === 'A')!
    runtime.missions = [mission]
    mission.state = 'READY_AT_EXCHANGER'
    clearEntrance(runtime, 'A')
    runtime.asrsLastRelease.A = -1e9
    const before = engine.getState()
    runtime.attemptExchangerReleases()
    const after = engine.getState()
    expect(after.srsControl.globalPending).toBe(before.srsControl.globalPending - 1)
    expect(after.srsControl.current.A1).toBe(before.srsControl.current.A1 + 1)
  })

  test('successful CARTBUILD drop preserves the total lane commitment', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    const mission = runtime.missions.find(({ assignedExchanger }) => assignedExchanger === 'A')!
    runtime.missions = [mission]
    mission.state = 'READY_AT_EXCHANGER'
    clearEntrance(runtime, 'A')
    runtime.asrsLastRelease.A = -1e9
    const before = engine.getState().cartbuildSystem.lanes.CARTBUILD_A.committedPositions
    runtime.attemptExchangerReleases()
    const lane = engine.getState().cartbuildSystem.lanes.CARTBUILD_A
    expect(lane.committedPositions).toBe(before)
    expect(lane).toMatchObject({ pendingMissionReservations: 0, attachedTrayReservations: 1 })
  })

  test('blocked drop retains robot ownership, payload, mission, reservation, and balances', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    const mission = runtime.missions.find(({ assignedExchanger }) => assignedExchanger === 'A')!
    runtime.missions = [mission]
    mission.state = 'READY_AT_EXCHANGER'
    runtime.asrsLastRelease.A = -1e9
    blockEntrance(runtime, 'A')
    const before = engine.getState()
    runtime.attemptExchangerReleases(0.1)
    const after = engine.getState()
    expect(after.missions[0].state).toBe('READY_AT_EXCHANGER')
    expect(after.asrsRobotSystem.outboundRobots[0]).toMatchObject({ lifecycleState: 'BLOCKED_FROM_DROP', ownsPayload: true, payloadTrayId: mission.payloadTrayId })
    expect(after.srsControl.globalPending).toBe(before.srsControl.globalPending)
    expect(after.cartbuildSystem.lanes.CARTBUILD_A.committedPositions).toBe(before.cartbuildSystem.lanes.CARTBUILD_A.committedPositions)
  })

  test('failed drop does not advance the shared eight-second clock', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    const mission = runtime.missions.find(({ assignedExchanger }) => assignedExchanger === 'A')!
    runtime.missions = [mission]
    mission.state = 'READY_AT_EXCHANGER'
    runtime.timeSec = 180
    runtime.asrsLastRelease.A = 100
    blockEntrance(runtime, 'A')
    runtime.attemptExchangerReleases(0.1)
    expect(runtime.asrsLastRelease.A).toBe(100)
  })

  test('DROP ownership prevents EMPTY bypass around a blocked CARTBUILD robot', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    const [cartbuild, empty] = runtime.missions.filter(({ assignedExchanger }) => assignedExchanger === 'A').slice(0, 2)
    empty.missionType = 'EMPTY'
    empty.payloadLoadState = 'EMPTY'
    empty.payloadCartbuildCartonAttached = false
    if (empty.robotPayload) { empty.robotPayload.loadState = 'EMPTY'; empty.robotPayload.payloadOrigin = undefined; empty.robotPayload.cartbuildCartonAttached = undefined }
    for (const mission of [cartbuild, empty]) { mission.state = 'READY_AT_EXCHANGER'; mission.robotState = 'QUEUED_FOR_DROP' }
    runtime.missions = [cartbuild, empty]
    runtime.cartons = [{ internalKey: 1, laneId: 'CARTBUILD_A', zoneIndex: 0 }]
    runtime.asrsLastRelease.A = -1e9
    blockEntrance(runtime, 'A')
    runtime.attemptExchangerReleases()
    expect(cartbuild.state).toBe('READY_AT_EXCHANGER')
    expect(empty.state).toBe('READY_AT_EXCHANGER')
    expect(runtime.trays.find(({ id }) => id === empty.payloadTrayId)).toBeUndefined()
  })

  test('repeated Reset and Start Scenario reproduce robot and payload tray IDs', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const identity = () => robots(engine).map(({ robotId, missionId, payloadTrayId }) => [robotId, missionId, payloadTrayId])
    const initial = identity()
    engine.reset()
    expect(identity()).toEqual(initial)
    engine.startScenario({ korberEnabled: true, cartbuildAEnabled: true, cartbuildBEnabled: true, cartbuildCEnabled: true }, 10)
    expect(identity()).toEqual(initial)
  })

  test('earlier snapshots remain immutable during later robot movement', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const before = engine.getState()
    const frozen = JSON.stringify(before)
    engine.step(90)
    expect(JSON.stringify(before)).toBe(frozen)
    expect(engine.getState().asrsRobotSystem.outboundRobots[0].travelProgress).toBeCloseTo(0.5, 9)
  })

  test('conveyor visualization does not render robot-carried payload trays', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const state = engine.getState()
    const markup = renderToStaticMarkup(createElement(ConveyorDiagram, { segments: state.segments, trays: state.trays, state }))
    for (const { payloadTrayId } of state.asrsRobotSystem.outboundRobots) expect(markup).not.toContain(`data-tray-id="${payloadTrayId}"`)
    expect((markup.match(/data-tray-id=/g) ?? [])).toHaveLength(148)
  })

  test('Milestone 9 allocation, timing, SRS counts, and 10A reservations remain valid', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const state = engine.getState()
    expect([state.pendingA, state.pendingB, state.pendingC]).toEqual([34, 33, 33])
    expect(state.missions.every(({ readyAtSec, createdAtSec }) => readyAtSec - createdAtSec === 180)).toBe(true)
    expect(state.srsControl).toMatchObject({ globalCurrent: 148, globalPending: 100, globalAvailableCapacity: 0 })
    expect([state.cartbuildSystem.lanes.CARTBUILD_A.availablePositions, state.cartbuildSystem.lanes.CARTBUILD_B.availablePositions, state.cartbuildSystem.lanes.CARTBUILD_C.availablePositions]).toEqual([0, 0, 0])
    assertBalances(engine)
  })
})
