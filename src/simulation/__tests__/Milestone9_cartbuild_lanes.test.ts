import { describe, expect, test } from 'vitest'
import SimulationEngine from '../SimulationEngine'
import type { CartbuildLaneId, CartonMarker, Mission, SourceId, Tray } from '../types'

const SEGMENTS = [
  { id: 'A1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'PRE_T', maxOccupancy: 24 },
  { id: 'B1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'PRE_T', maxOccupancy: 16 },
  { id: 'C1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'T', maxOccupancy: 16 },
  { id: 'PRE_T', lengthFt: 20, speedFtPerMin: 120, nextSegmentId: 'T', maxOccupancy: 8 },
  { id: 'T', lengthFt: 30, speedFtPerMin: 120, nextSegmentId: 'D', maxOccupancy: 12 },
  { id: 'D', lengthFt: 235, speedFtPerMin: 120, maxOccupancy: 94 },
  { id: 'PURGE', lengthFt: 15, speedFtPerMin: 120, nextSegmentId: 'X', maxOccupancy: 6 },
  { id: 'E', lengthFt: 87.5, speedFtPerMin: 120, nextSegmentId: 'X', maxOccupancy: 35 },
  { id: 'X', lengthFt: 12.5, speedFtPerMin: 120, maxOccupancy: 5 },
  { id: 'S', lengthFt: 20, speedFtPerMin: 120, maxOccupancy: 8 },
  { id: 'A2', lengthFt: 90, speedFtPerMin: 120, maxOccupancy: 36 },
  { id: 'B2', lengthFt: 72.5, speedFtPerMin: 120, maxOccupancy: 29 },
  { id: 'C2', lengthFt: 72.5, speedFtPerMin: 120, maxOccupancy: 29 },
  { id: 'CARTBUILD_A', lengthFt: 75, speedFtPerMin: 120, maxOccupancy: 30 },
  { id: 'CARTBUILD_B', lengthFt: 75, speedFtPerMin: 120, maxOccupancy: 30 },
  { id: 'CARTBUILD_C', lengthFt: 75, speedFtPerMin: 120, maxOccupancy: 30 },
]

type Runtime = {
  timeSec: number
  trays: Tray[]
  cartons: CartonMarker[]
  missions: Mission[]
  totalTraysCreated: number
  cartonIntroduced: Record<SourceId, number>
  asrsLastRelease: Record<SourceId, number>
  operatingSettings: { korberEnabled: boolean; cartbuildAEnabled: boolean; cartbuildBEnabled: boolean; cartbuildCEnabled: boolean }
  attemptExchangerReleases: () => void
  processPiles: (delta: number) => void
  processCartonConveyors: (delta: number) => void
  processCartonOperators: () => void
  planPendingDemand: () => void
  processKorber: () => void
  nextConsumptionTime: number
}

const runtimeOf = (engine: SimulationEngine) => (engine as unknown as { milestone7: Runtime }).milestone7
const pileTray = (id: number, source: SourceId, zoneIndex: number, loadState: 'EMPTY' | 'FULL' = 'EMPTY'): Tray => ({
  id, currentSegmentId: `${source}1`, positionFt: (zoneIndex + 0.5) * 2.5, status: 'BLOCKED', createdAtSec: 0,
  originSourceId: source, loadState, pilePlacement: { pileId: `${source}1`, component: 'MDR_UPSTREAM', zoneIndex },
})
const zonedTray = (id: number, conveyorId: NonNullable<Tray['zonePlacement']>['conveyorId'], zoneIndex: number): Tray => ({
  id, currentSegmentId: conveyorId, positionFt: (zoneIndex + 0.5) * 2.5, status: 'BLOCKED', createdAtSec: 0,
  originSourceId: 'A', loadState: 'EMPTY', zonePlacement: { conveyorId, zoneIndex },
})

function assertBalances(engine: SimulationEngine) {
  const state = engine.getState()
  expect(state.materialBalanceError).toBe(0)
  expect(state.cartbuildSystem.cartonBalanceError).toBe(0)
  expect(state.createdTrayCount).toBe(state.physicalTrayCount + state.returnSystem.returnedToAsrsCount)
  expect(state.cartbuildSystem.cartbuildCartonsIntroduced).toBe(
    state.cartbuildSystem.cartbuildCartonsAttachedToTrays + state.cartbuildSystem.cartbuildCartonsOnConveyors + state.cartbuildSystem.cartbuildCartonsConsumedByOperators,
  )
  expect(new Set(state.trays.map((tray) => tray.id)).size).toBe(state.trays.length)
}

describe('Milestone 9 cartbuild operating modes and physical lanes', () => {
  test('defaults all settings ON, declares three 75-foot 30-zone lanes, and reset restores them', () => {
    const engine = new SimulationEngine(SEGMENTS)
    let state = engine.getState()
    expect(state.operatingSettings).toEqual({ korberEnabled: true, cartbuildAEnabled: true, cartbuildBEnabled: true, cartbuildCEnabled: true })
    for (const id of ['CARTBUILD_A', 'CARTBUILD_B', 'CARTBUILD_C'] as CartbuildLaneId[]) {
      expect(state.segments.find((segment) => segment.id === id)).toMatchObject({ lengthFt: 75, speedFtPerMin: 120, maxOccupancy: 30 })
      expect(state.cartbuildSystem.lanes[id]).toMatchObject({ zoneCount: 30, zoneTransferSec: 1.25, occupancy: 0 })
    }
    engine.setOperatingSetting('korberEnabled', false)
    engine.setOperatingSetting('cartbuildBEnabled', false)
    engine.step(2)
    engine.reset()
    state = engine.getState()
    expect(state.timeSec).toBe(0)
    expect(state.operatingSettings).toEqual({ korberEnabled: true, cartbuildAEnabled: true, cartbuildBEnabled: true, cartbuildCEnabled: true })
    expect(state.cartbuildSystem.cartbuildCartonsIntroduced).toBe(79)
  })

  test('runtime settings mutate the same engine without changing time, trays, missions, or clocks', () => {
    const engine = new SimulationEngine(SEGMENTS)
    engine.step(12.3)
    const before = engine.getState()
    engine.setOperatingSetting('cartbuildAEnabled', false)
    const after = engine.getState()
    expect(after.timeSec).toBe(before.timeSec)
    expect(after.trays).toEqual(before.trays)
    expect(after.missions).toEqual(before.missions)
    expect(after.cartbuildSystem.exchangers).toEqual(expect.objectContaining({ B: before.cartbuildSystem.exchangers.B, C: before.cartbuildSystem.exchangers.C }))
    expect(after.operatingSettings.cartbuildAEnabled).toBe(false)
  })

  test('shared exchanger clocks prioritize loaded releases and preserve independent eight-second headways', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    runtime.trays = []
    runtime.cartons = []
    runtime.missions = [
      { missionId: 1, assignedExchanger: 'A', missionType: 'CARTBUILD', createdAtSec: 0, readyAtSec: 0, state: 'READY_AT_EXCHANGER' },
      { missionId: 2, assignedExchanger: 'B', missionType: 'CARTBUILD', createdAtSec: 0, readyAtSec: 0, state: 'READY_AT_EXCHANGER' },
    ]
    runtime.totalTraysCreated = 0
    runtime.cartonIntroduced = { A: 0, B: 0, C: 0 }
    runtime.asrsLastRelease = { A: -1e9, B: -1e9, C: -1e9 }
    runtime.operatingSettings.cartbuildCEnabled = false
    runtime.attemptExchangerReleases()
    let state = engine.getState()
    expect(state.cartbuildSystem.exchangers.A.mostRecentReleaseType).toBe('LOADED')
    expect(state.cartbuildSystem.exchangers.B.mostRecentReleaseType).toBe('LOADED')
    expect(state.missions.filter((mission) => mission.state === 'RELEASED')).toHaveLength(2)

    runtime.trays = []
    runtime.missions.push(
      { missionId: 3, assignedExchanger: 'A', missionType: 'CARTBUILD', createdAtSec: 1, readyAtSec: 1, state: 'READY_AT_EXCHANGER' },
      { missionId: 4, assignedExchanger: 'B', missionType: 'CARTBUILD', createdAtSec: 1, readyAtSec: 1, state: 'READY_AT_EXCHANGER' },
    )
    runtime.timeSec = 7.9
    runtime.attemptExchangerReleases()
    expect(engine.getState().cartbuildSystem.exchangers.A.loadedReleases).toBe(1)
    runtime.timeSec = 8
    runtime.attemptExchangerReleases()
    state = engine.getState()
    expect(state.cartbuildSystem.exchangers.A.releaseTimes.map(({ timeSec }) => timeSec)).toEqual([0, 8])
    expect(state.cartbuildSystem.exchangers.B.releaseTimes.map(({ timeSec }) => timeSec)).toEqual([0, 8])
    expect(state.cartbuildSystem.exchangers.C.mostRecentReleaseType).toBeNull()
  })

  test('pile-blocked CARTBUILD DROP ownership prevents matured EMPTY bypass', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    runtime.trays = [pileTray(99, 'A', 0)]
    runtime.cartons = []
    runtime.missions = [
      { missionId: 1, assignedExchanger: 'A', missionType: 'CARTBUILD', createdAtSec: 0, readyAtSec: 0, state: 'READY_AT_EXCHANGER' },
      { missionId: 2, assignedExchanger: 'A', missionType: 'EMPTY', createdAtSec: 1, readyAtSec: 1, state: 'READY_AT_EXCHANGER' },
    ]
    runtime.totalTraysCreated = 0
    runtime.asrsLastRelease.A = -1e9
    runtime.attemptExchangerReleases()
    const state = engine.getState()
    expect(state.cartbuildSystem.exchangers.A).toMatchObject({ loadedReleases: 0, emptyReleases: 0, mostRecentReleaseType: null })
    expect(state.missions.map((mission) => mission.state)).toEqual(['READY_AT_EXCHANGER', 'READY_AT_EXCHANGER'])
    expect(state.asrsRobotSystem.exchangers.A.dropBlocked).toBe(true)
  })

  test('exchanger arbitration is oldest-first within type and CARTBUILD remains ahead of older EMPTY work', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    runtime.trays = []
    runtime.cartons = []
    runtime.totalTraysCreated = 0
    runtime.cartonIntroduced = { A: 0, B: 0, C: 0 }
    runtime.asrsLastRelease = { A: -1e9, B: 1e9, C: 1e9 }
    runtime.missions = [
      { missionId: 1, assignedExchanger: 'A', missionType: 'EMPTY', createdAtSec: -10, readyAtSec: 0, state: 'READY_AT_EXCHANGER' },
      { missionId: 3, assignedExchanger: 'A', missionType: 'CARTBUILD', createdAtSec: -2, readyAtSec: 0, state: 'READY_AT_EXCHANGER' },
      { missionId: 2, assignedExchanger: 'A', missionType: 'CARTBUILD', createdAtSec: -5, readyAtSec: 0, state: 'READY_AT_EXCHANGER' },
      { missionId: 4, assignedExchanger: 'A', missionType: 'EMPTY', createdAtSec: -20, readyAtSec: 0, state: 'READY_AT_EXCHANGER' },
    ]
    for (const expectedMissionId of [2, 3, 4, 1]) {
      runtime.attemptExchangerReleases()
      expect(runtime.missions.find((mission) => mission.missionId === expectedMissionId)?.state).toBe('RELEASED')
      runtime.trays = []
      runtime.timeSec += 8
    }
    expect(engine.getState().cartbuildSystem.exchangers.A.releaseTimes.map(({ type }) => type)).toEqual(['LOADED', 'LOADED', 'EMPTY', 'EMPTY'])
  })

  test('a failed physical attempt neither releases the mission nor advances the exchanger clock', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    runtime.trays = [pileTray(99, 'A', 0)]
    runtime.cartons = []
    runtime.missions = [{ missionId: 1, assignedExchanger: 'A', missionType: 'CARTBUILD', createdAtSec: 0, readyAtSec: 0, state: 'READY_AT_EXCHANGER' }]
    runtime.asrsLastRelease.A = -1e9
    runtime.timeSec = 25
    runtime.attemptExchangerReleases()
    expect(runtime.missions[0].state).toBe('READY_AT_EXCHANGER')
    expect(engine.getState().cartbuildSystem.exchangers.A.releaseTimes).toEqual([])
    expect(engine.getState().srsControl.lanes.A.lastActualExchangerReleaseTime).toBeNull()
    runtime.trays = []
    runtime.attemptExchangerReleases()
    expect(engine.getState().cartbuildSystem.exchangers.A.releaseTimes.map(({ timeSec }) => timeSec)).toEqual([25])
  })

  test('one authoritative clock enforces headway across LOADED, EMPTY, then LOADED releases', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    runtime.trays = []
    runtime.cartons = []
    runtime.missions = []
    runtime.totalTraysCreated = 0
    runtime.cartonIntroduced = { A: 0, B: 0, C: 0 }
    runtime.asrsLastRelease = { A: -1e9, B: 1e9, C: 1e9 }
    runtime.timeSec = 0
    runtime.missions = [{ missionId: 1, assignedExchanger: 'A', missionType: 'CARTBUILD', createdAtSec: 0, readyAtSec: 0, state: 'READY_AT_EXCHANGER' }]
    runtime.attemptExchangerReleases()
    runtime.trays = []
    engine.setOperatingSetting('cartbuildAEnabled', false)
    runtime.missions.push({ missionId: 2, assignedExchanger: 'A', missionType: 'EMPTY', createdAtSec: 1, readyAtSec: 1, state: 'READY_AT_EXCHANGER' })
    runtime.timeSec = 7.9
    runtime.attemptExchangerReleases()
    expect(runtime.missions.find((mission) => mission.missionId === 2)?.state).toBe('READY_AT_EXCHANGER')
    runtime.timeSec = 8
    runtime.attemptExchangerReleases()
    runtime.trays = []
    engine.setOperatingSetting('cartbuildAEnabled', true)
    runtime.missions.push({ missionId: 3, assignedExchanger: 'A', missionType: 'CARTBUILD', createdAtSec: 2, readyAtSec: 2, state: 'READY_AT_EXCHANGER' })
    runtime.timeSec = 16
    runtime.attemptExchangerReleases()
    const releases = engine.getState().cartbuildSystem.exchangers.A.releaseTimes
    expect(releases.map(({ timeSec, type }) => [timeSec, type])).toEqual([[0, 'LOADED'], [8, 'EMPTY'], [16, 'LOADED']])
    for (let index = 1; index < releases.length; index++) expect(releases[index].timeSec - releases[index - 1].timeSec).toBeGreaterThanOrEqual(8)
  })

  test('mission planning retains existing work and applies toggle changes only to future missions', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    const existingB = runtime.missions.filter((mission) => mission.assignedExchanger === 'B')
    engine.setOperatingSetting('cartbuildBEnabled', false)
    runtime.trays = runtime.trays.filter((tray) => tray.pilePlacement?.pileId !== 'B1')
    runtime.planPendingDemand()
    const currentB = runtime.missions.filter((mission) => mission.assignedExchanger === 'B')
    expect(currentB.slice(0, existingB.length)).toEqual(existingB)
    expect(currentB.slice(existingB.length).every((mission) => mission.missionType === 'EMPTY')).toBe(true)
  })

  test('loaded CARTBUILD tray remains FULL through zones 0-2 and splits atomically into zone 3 and lane zone 0', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    const tray = pileTray(1, 'A', 2, 'FULL')
    tray.payloadOrigin = 'CARTBUILD'
    tray.cartbuildCartonAttached = true
    runtime.trays = [tray]
    runtime.missions = []
    runtime.cartons = []
    runtime.totalTraysCreated = 1
    runtime.cartonIntroduced = { A: 1, B: 0, C: 0 }
    for (let tick = 0; tick < 14; tick++) runtime.processPiles(0.1)
    const state = engine.getState()
    expect(state.trays[0]).toMatchObject({ id: 1, loadState: 'EMPTY', pilePlacement: { component: 'MDR_UPSTREAM', zoneIndex: 3 } })
    expect(state.trays[0].cartbuildCartonAttached).toBeUndefined()
    expect(state.cartbuildSystem.lanes.CARTBUILD_A.markers).toEqual([expect.objectContaining({ laneId: 'CARTBUILD_A', zoneIndex: 0 })])
    expect(state.cartbuildSystem.detrayers.A.splitCount).toBe(1)
    assertBalances(engine)
  })

  test.each([
    ['zone 3', [pileTray(2, 'A', 3)], []],
    ['carton entrance', [], [{ internalKey: 8, laneId: 'CARTBUILD_A' as const, zoneIndex: 0 }]],
  ])('detrayer blocks atomically when %s is occupied', (_reason, blockers, cartons) => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    const loaded = pileTray(1, 'A', 2, 'FULL')
    loaded.payloadOrigin = 'CARTBUILD'; loaded.cartbuildCartonAttached = true
    runtime.trays = [loaded, ...blockers]
    runtime.cartons = cartons
    runtime.totalTraysCreated = runtime.trays.length
    runtime.cartonIntroduced = { A: 1 + cartons.length, B: 0, C: 0 }
    for (let tick = 0; tick < 20; tick++) runtime.processPiles(0.1)
    expect(loaded).toMatchObject({ loadState: 'FULL', cartbuildCartonAttached: true, pilePlacement: { zoneIndex: 2 } })
    expect(runtime.cartons).toHaveLength(cartons.length)
    expect(engine.getState().cartbuildSystem.detrayers.A.blockedTicks).toBeGreaterThan(0)
  })

  test('pure EMPTY trays bypass detraying and Körber payloads are explicitly rejected', () => {
    const emptyEngine = new SimulationEngine(SEGMENTS)
    const emptyRuntime = runtimeOf(emptyEngine)
    emptyRuntime.trays = [pileTray(1, 'A', 2)]
    emptyRuntime.cartons = []
    for (let tick = 0; tick < 14; tick++) emptyRuntime.processPiles(0.1)
    expect(emptyRuntime.trays[0].pilePlacement?.zoneIndex).toBe(3)
    expect(emptyRuntime.cartons).toHaveLength(0)

    const invalidEngine = new SimulationEngine(SEGMENTS)
    const invalidRuntime = runtimeOf(invalidEngine)
    const invalid = pileTray(2, 'A', 2, 'FULL'); invalid.payloadOrigin = 'KORBER'
    invalidRuntime.trays = [invalid]
    expect(() => invalidRuntime.processPiles(0.1)).toThrow(/Körber payload tray 2/)
  })

  test('carton lanes preserve occupancy order and operators consume only zone 29 at eight-second intervals', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    runtime.trays = []
    runtime.missions = []
    runtime.totalTraysCreated = 0
    runtime.cartonIntroduced = { A: 3, B: 0, C: 0 }
    runtime.cartons = [
      { internalKey: 1, laneId: 'CARTBUILD_A', zoneIndex: 29 },
      { internalKey: 2, laneId: 'CARTBUILD_A', zoneIndex: 28 },
      { internalKey: 3, laneId: 'CARTBUILD_A', zoneIndex: 10 },
    ]
    runtime.timeSec = 100
    runtime.processCartonOperators()
    expect(runtime.cartons.map((carton) => carton.internalKey)).toEqual([2, 3])
    runtime.cartons.find((carton) => carton.internalKey === 2)!.zoneIndex = 29
    runtime.processCartonOperators()
    expect(runtime.cartons.map((carton) => carton.internalKey)).toContain(2)
    runtime.timeSec = 108
    runtime.processCartonOperators()
    expect(runtime.cartons.map((carton) => carton.internalKey)).toEqual([3])
    expect(engine.getState().cartbuildSystem.lanes.CARTBUILD_A.operatorConsumptionTimes).toEqual([100, 108])
    assertBalances(engine)
  })

  test('three continuously supplied operator clocks independently sustain exactly 450 cartons/hour without drift', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    runtime.trays = []
    runtime.missions = []
    runtime.totalTraysCreated = 0
    runtime.cartons = []
    runtime.cartonIntroduced = { A: 0, B: 0, C: 0 }
    let marker = 0
    for (let tick = 0; tick <= 36_000; tick++) {
      runtime.timeSec = tick / 10
      for (const source of ['A', 'B', 'C'] as SourceId[]) {
        const laneId = `CARTBUILD_${source}` as CartbuildLaneId
        if (!runtime.cartons.some((carton) => carton.laneId === laneId && carton.zoneIndex === 29)) {
          runtime.cartons.push({ internalKey: ++marker, laneId, zoneIndex: 29 })
          runtime.cartonIntroduced[source] += 1
        }
      }
      runtime.processCartonOperators()
    }
    const state = engine.getState()
    for (const lane of Object.values(state.cartbuildSystem.lanes)) {
      expect(lane.operatorConsumptionTimes).toHaveLength(451)
      for (let index = 1; index < lane.operatorConsumptionTimes.length; index++) {
        expect(lane.operatorConsumptionTimes[index] - lane.operatorConsumptionTimes[index - 1]).toBeCloseTo(8, 9)
      }
      expect((lane.operatorConsumptionTimes.length - 1) * 3600 / (lane.operatorConsumptionTimes.at(-1)! - lane.operatorConsumptionTimes[0])).toBeCloseTo(450, 9)
    }
    assertBalances(engine)
  }, 60_000)

  test('starved exchanger and operator clocks release immediately once, then enforce a full interval', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    runtime.trays = []
    runtime.cartons = []
    runtime.totalTraysCreated = 0
    runtime.cartonIntroduced = { A: 0, B: 0, C: 0 }
    runtime.asrsLastRelease = { A: -1e9, B: -1e9, C: -1e9 }
    runtime.timeSec = 100
    runtime.missions = [{ missionId: 1, assignedExchanger: 'A', missionType: 'CARTBUILD', createdAtSec: 0, readyAtSec: 0, state: 'READY_AT_EXCHANGER' }]
    runtime.attemptExchangerReleases()
    runtime.trays = []
    runtime.missions.push({ missionId: 2, assignedExchanger: 'A', missionType: 'CARTBUILD', createdAtSec: 1, readyAtSec: 1, state: 'READY_AT_EXCHANGER' })
    runtime.attemptExchangerReleases()
    expect(engine.getState().cartbuildSystem.exchangers.A.releaseTimes.map(({ timeSec }) => timeSec)).toEqual([100])
    runtime.timeSec = 108
    runtime.attemptExchangerReleases()
    expect(engine.getState().cartbuildSystem.exchangers.A.releaseTimes.map(({ timeSec }) => timeSec)).toEqual([100, 108])

    runtime.cartons = [{ internalKey: 50, laneId: 'CARTBUILD_A', zoneIndex: 29 }]
    runtime.cartonIntroduced.A += 1
    runtime.timeSec = 200
    runtime.processCartonOperators()
    runtime.cartons.push({ internalKey: 51, laneId: 'CARTBUILD_A', zoneIndex: 29 })
    runtime.cartonIntroduced.A += 1
    runtime.processCartonOperators()
    expect(engine.getState().cartbuildSystem.lanes.CARTBUILD_A.operatorConsumptionTimes).toEqual([200])
    runtime.timeSec = 208
    runtime.processCartonOperators()
    expect(engine.getState().cartbuildSystem.lanes.CARTBUILD_A.operatorConsumptionTimes).toEqual([200, 208])
  })

  test('switching a cartbuild lane OFF stops new loaded work while in-flight cartons continue to clear', () => {
    const engine = new SimulationEngine(SEGMENTS)
    engine.step(100)
    const before = engine.getState()
    const released = before.cartbuildSystem.exchangers.A.loadedReleases
    const consumed = before.cartbuildSystem.lanes.CARTBUILD_A.operatorConsumedCount
    const existingCartbuildMissionIds = new Set(before.missions.filter((mission) => mission.assignedExchanger === 'A' && mission.missionType === 'CARTBUILD').map((mission) => mission.missionId))
    engine.setOperatingSetting('cartbuildAEnabled', false)
    engine.step(120)
    const after = engine.getState()
    expect(after.cartbuildSystem.exchangers.A.loadedReleases).toBeGreaterThanOrEqual(released)
    expect(after.missions.filter((mission) => mission.assignedExchanger === 'A' && mission.missionType === 'CARTBUILD').every((mission) => existingCartbuildMissionIds.has(mission.missionId))).toBe(true)
    expect(after.cartbuildSystem.lanes.CARTBUILD_A.operatorConsumedCount).toBeGreaterThanOrEqual(consumed)
    expect(after.cartbuildSystem.exchangers.A.pendingEmptyMissions).toBeGreaterThan(0)
    assertBalances(engine)
  })

  test.each([
    ['K on / one cartbuild', true, true, false, false],
    ['K on / two cartbuild', true, true, true, false],
    ['K on / all cartbuild', true, true, true, true],
    ['K off / one cartbuild', false, true, false, false],
    ['K off / two cartbuild', false, true, true, false],
    ['K off / all cartbuild', false, true, true, true],
    ['K on / cartbuild all off', true, false, false, false],
  ])('%s preserves deterministic balances', (_name, korber, a, b, c) => {
    const engine = new SimulationEngine(SEGMENTS)
    engine.setOperatingSetting('korberEnabled', korber)
    engine.setOperatingSetting('cartbuildAEnabled', a)
    engine.setOperatingSetting('cartbuildBEnabled', b)
    engine.setOperatingSetting('cartbuildCEnabled', c)
    engine.step(240)
    const state = engine.getState()
    expect(state.operatingSettings).toEqual({ korberEnabled: korber, cartbuildAEnabled: a, cartbuildBEnabled: b, cartbuildCEnabled: c })
    assertBalances(engine)
  })

  test('disabled Korber starts no new transformation while an existing hold and return flow continue', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    const held = zonedTray(1, 'D', 93); held.zonePlacement = undefined; held.korberHeld = true; held.loadState = 'FULL'; held.payloadOrigin = 'KORBER'
    const waiting = zonedTray(2, 'D', 93)
    runtime.trays = [held, waiting]
    runtime.totalTraysCreated = 2
    runtime.nextConsumptionTime = 0
    engine.setOperatingSetting('korberEnabled', false)
    runtime.processKorber()
    expect(held.zonePlacement).toEqual({ conveyorId: 'E', zoneIndex: 0 })
    runtime.processKorber()
    expect(waiting.zonePlacement).toEqual({ conveyorId: 'D', zoneIndex: 93 })
    engine.setOperatingSetting('korberEnabled', true)
    runtime.timeSec = runtime.nextConsumptionTime
    runtime.processKorber()
    expect(waiting.korberHeld).toBe(true)
  })

  test('long mixed run preserves tray/carton equations, unique identities, and immutable snapshots', () => {
    const engine = new SimulationEngine(SEGMENTS)
    let prior = engine.getState()
    for (let second = 0; second < 600; second++) {
      const frozen = JSON.stringify(prior)
      engine.step(1)
      const state = engine.getState()
      expect(JSON.stringify(prior)).toBe(frozen)
      assertBalances(engine)
      prior = state
    }
    expect(prior.cartbuildSystem.cartbuildCartonsIntroduced).toBeGreaterThan(0)
    expect(prior.cartbuildSystem.cartbuildCartonsConsumedByOperators).toBeGreaterThan(0)
    for (const source of ['A', 'B', 'C'] as SourceId[]) {
      const times = prior.cartbuildSystem.exchangers[source].releaseTimes.map(({ timeSec }) => timeSec)
      for (let index = 1; index < times.length; index++) expect(times[index] - times[index - 1]).toBeGreaterThanOrEqual(8 - 1e-9)
    }
  }, 120_000)
})
