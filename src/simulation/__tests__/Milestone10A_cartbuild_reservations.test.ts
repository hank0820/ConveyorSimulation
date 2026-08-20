import { describe, expect, test } from 'vitest'
import SimulationEngine from '../SimulationEngine'
import type { CartbuildLaneId, CartonMarker, Mission, OperatingSettings, SourceId, Tray } from '../types'

const SEGMENTS = [
  ['A1',81,24],['B1',81,16],['C1',81,16],['PRE_T',20,8],['T',30,12],['D',235,94],['PURGE',15,6],['E',87.5,35],['X',12.5,5],['S',20,8],['A2',90,36],['B2',72.5,29],['C2',72.5,29],['CARTBUILD_A',75,30],['CARTBUILD_B',75,30],['CARTBUILD_C',75,30],
].map(([id,lengthFt,maxOccupancy]) => ({ id: String(id), lengthFt: Number(lengthFt), speedFtPerMin: 120, maxOccupancy: Number(maxOccupancy) }))

type Runtime = {
  timeSec: number
  trays: Tray[]
  cartons: CartonMarker[]
  missions: Mission[]
  totalTraysCreated: number
  cartonIntroduced: Record<SourceId, number>
  operatorConsumptionTimes: Record<SourceId, number[]>
  asrsLastRelease: Record<SourceId, number>
  asrsNextAssign: SourceId
  operatingSettings: OperatingSettings
  planPendingDemand: () => void
  attemptExchangerReleases: () => void
  processPiles: (delta: number) => void
  processCartonOperators: () => void
}

const runtimeOf = (engine: SimulationEngine) => (engine as unknown as { milestone7: Runtime }).milestone7
const laneIdFor = (source: SourceId): CartbuildLaneId => `CARTBUILD_${source}` as CartbuildLaneId
const lane = (engine: SimulationEngine, source: SourceId) => engine.getState().cartbuildSystem.lanes[laneIdFor(source)]
const mission = (missionId: number, source: SourceId, missionType: 'CARTBUILD' | 'EMPTY', state: Mission['state'] = 'RETRIEVING'): Mission => ({
  missionId, assignedExchanger: source, missionType, createdAtSec: 0, readyAtSec: 180, state,
})
const attachedTray = (id: number, source: SourceId, zoneIndex = 0): Tray => ({
  id, currentSegmentId: `${source}1`, positionFt: (zoneIndex + 0.5) * 2.5, status: 'BLOCKED', createdAtSec: 0,
  originSourceId: source, loadState: 'FULL', payloadOrigin: 'CARTBUILD', cartbuildCartonAttached: true,
  pilePlacement: { pileId: `${source}1`, component: 'MDR_PRE_DETRAYER', zoneIndex },
})

function expectBalanced(engine: SimulationEngine) {
  const state = engine.getState()
  expect(state.materialBalanceError).toBe(0)
  expect(state.cartbuildSystem.cartonBalanceError).toBe(0)
  expect(state.createdTrayCount).toBe(state.physicalTrayCount + state.returnSystem.returnedToAsrsCount)
}

describe('Milestone 10A cartbuild capacity reservation', () => {
  test('time-zero planning reserves 30/30/30 cartbuild positions', () => {
    const engine = new SimulationEngine(SEGMENTS)
    expect([lane(engine, 'A').pendingMissionReservations, lane(engine, 'B').pendingMissionReservations, lane(engine, 'C').pendingMissionReservations]).toEqual([30, 30, 30])
    for (const source of ['A', 'B', 'C'] as SourceId[]) {
      expect(lane(engine, source)).toMatchObject({ positionCapacity: 30, attachedTrayReservations: 0, physicalLaneOccupancy: 0 })
      expect(lane(engine, source).committedPositions).toBe(lane(engine, source).pendingMissionReservations)
    }
  })

  test('time-zero diagnostics report fully reserved cartbuild lanes', () => {
    const engine = new SimulationEngine(SEGMENTS)
    expect([lane(engine, 'A').availablePositions, lane(engine, 'B').availablePositions, lane(engine, 'C').availablePositions]).toEqual([0, 0, 0])
  })

  test('planning never commits more than 30 positions per cartbuild lane', () => {
    const engine = new SimulationEngine(SEGMENTS)
    for (let second = 0; second < 600; second++) {
      engine.step(1)
      for (const source of ['A', 'B', 'C'] as SourceId[]) {
        const diagnostic = lane(engine, source)
        expect(diagnostic.committedPositions).toBeLessThanOrEqual(30)
        expect(diagnostic.availablePositions).toBe(Math.max(0, diagnostic.positionCapacity - diagnostic.committedPositions))
      }
    }
    expectBalanced(engine)
  }, 120_000)

  test('a saturated lane falls back to EMPTY when Korber is enabled', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    runtime.trays = []
    runtime.missions = []
    runtime.cartons = Array.from({ length: 30 }, (_, zoneIndex) => ({ internalKey: zoneIndex + 1, laneId: 'CARTBUILD_A' as const, zoneIndex }))
    runtime.cartonIntroduced = { A: 30, B: 0, C: 0 }
    runtime.operatingSettings = { korberEnabled: true, cartbuildAEnabled: true, cartbuildBEnabled: false, cartbuildCEnabled: false }
    runtime.asrsNextAssign = 'A'
    runtime.planPendingDemand()
    expect(runtime.missions.filter(({ assignedExchanger }) => assignedExchanger === 'A')).not.toHaveLength(0)
    expect(runtime.missions.filter(({ assignedExchanger }) => assignedExchanger === 'A').every(({ missionType }) => missionType === 'EMPTY')).toBe(true)
    expect(lane(engine, 'A')).toMatchObject({ committedPositions: 30, availablePositions: 0 })
  })

  test('a saturated lane cannot create a CARTBUILD mission', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    runtime.trays = []
    runtime.missions = []
    runtime.cartons = Array.from({ length: 30 }, (_, zoneIndex) => ({ internalKey: zoneIndex + 1, laneId: 'CARTBUILD_A' as const, zoneIndex }))
    runtime.cartonIntroduced = { A: 30, B: 0, C: 0 }
    runtime.operatingSettings = { korberEnabled: true, cartbuildAEnabled: true, cartbuildBEnabled: false, cartbuildCEnabled: false }
    runtime.asrsNextAssign = 'A'
    runtime.planPendingDemand()
    expect(runtime.missions.some(({ assignedExchanger, missionType }) => assignedExchanger === 'A' && missionType === 'CARTBUILD')).toBe(false)
  })

  test('a saturated lane creates no mission when Korber is disabled and the other lanes are ineligible', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    runtime.trays = []
    runtime.missions = []
    runtime.cartons = Array.from({ length: 30 }, (_, zoneIndex) => ({ internalKey: zoneIndex + 1, laneId: 'CARTBUILD_A' as const, zoneIndex }))
    runtime.cartonIntroduced = { A: 30, B: 0, C: 0 }
    runtime.operatingSettings = { korberEnabled: false, cartbuildAEnabled: true, cartbuildBEnabled: false, cartbuildCEnabled: false }
    runtime.asrsNextAssign = 'A'
    runtime.planPendingDemand()
    expect(runtime.missions).toEqual([])
    expect(runtime.asrsNextAssign).toBe('A')
  })

  test('EMPTY missions consume SRS capacity but never reserve cartbuild positions', () => {
    const engine = new SimulationEngine(SEGMENTS)
    engine.startScenario({ korberEnabled: true, cartbuildAEnabled: false, cartbuildBEnabled: false, cartbuildCEnabled: false }, 10)
    expect(engine.getState().missions).toHaveLength(100)
    expect(engine.getState().missions.every(({ missionType }) => missionType === 'EMPTY')).toBe(true)
    for (const source of ['A', 'B', 'C'] as SourceId[]) expect(lane(engine, source)).toMatchObject({ committedPositions: 0, availablePositions: 30 })
  })

  test('global SRS capacity continues to block both mission types', () => {
    for (const settings of [
      { korberEnabled: false, cartbuildAEnabled: true, cartbuildBEnabled: true, cartbuildCEnabled: true },
      { korberEnabled: true, cartbuildAEnabled: false, cartbuildBEnabled: false, cartbuildCEnabled: false },
    ] as OperatingSettings[]) {
      const engine = new SimulationEngine(SEGMENTS)
      const runtime = runtimeOf(engine)
      runtime.operatingSettings = settings
      const initialCount = runtime.missions.length
      runtime.planPendingDemand()
      expect(runtime.missions).toHaveLength(initialCount)
    }
  })

  test('local and downstream SRS capacity continue to block both mission types', () => {
    for (const missionType of ['CARTBUILD', 'EMPTY'] as const) {
      const engine = new SimulationEngine(SEGMENTS)
      const runtime = runtimeOf(engine)
      runtime.missions = []
      runtime.trays = [
        ...Array.from({ length: 24 }, (_, index) => ({ ...attachedTray(index + 1, 'A', index), loadState: 'EMPTY' as const, payloadOrigin: undefined, cartbuildCartonAttached: undefined })),
        ...Array.from({ length: 6 }, (_, zoneIndex) => ({ id: 100 + zoneIndex, currentSegmentId: 'T', positionFt: 1, status: 'BLOCKED' as const, createdAtSec: 0, originSourceId: 'A' as const, loadState: 'EMPTY' as const, zonePlacement: { conveyorId: 'T' as const, zoneIndex } })),
        ...Array.from({ length: 92 }, (_, zoneIndex) => ({ id: 200 + zoneIndex, currentSegmentId: 'D', positionFt: 1, status: 'BLOCKED' as const, createdAtSec: 0, originSourceId: 'A' as const, loadState: 'EMPTY' as const, zonePlacement: { conveyorId: 'D' as const, zoneIndex } })),
        ...Array.from({ length: 36 }, (_, zoneIndex) => ({ id: 300 + zoneIndex, currentSegmentId: 'A2', positionFt: 1, status: 'BLOCKED' as const, createdAtSec: 0, originSourceId: 'A' as const, loadState: 'EMPTY' as const, zonePlacement: { conveyorId: 'A2' as const, zoneIndex } })),
      ]
      runtime.operatingSettings = missionType === 'CARTBUILD'
        ? { korberEnabled: false, cartbuildAEnabled: true, cartbuildBEnabled: false, cartbuildCEnabled: false }
        : { korberEnabled: true, cartbuildAEnabled: false, cartbuildBEnabled: false, cartbuildCEnabled: false }
      runtime.asrsNextAssign = 'A'
      runtime.planPendingDemand()
      expect(runtime.missions.some(({ assignedExchanger }) => assignedExchanger === 'A')).toBe(false)
    }
  })

  test('mission release moves pending reservation to attached tray without changing commitment', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    runtime.trays = []
    runtime.cartons = []
    runtime.missions = [mission(1, 'A', 'CARTBUILD', 'READY_AT_EXCHANGER')]
    runtime.totalTraysCreated = 0
    runtime.cartonIntroduced = { A: 0, B: 0, C: 0 }
    runtime.asrsLastRelease.A = -1e9
    expect(lane(engine, 'A')).toMatchObject({ pendingMissionReservations: 1, attachedTrayReservations: 0, physicalLaneOccupancy: 0, committedPositions: 1 })
    runtime.attemptExchangerReleases()
    expect(lane(engine, 'A')).toMatchObject({ pendingMissionReservations: 0, attachedTrayReservations: 1, physicalLaneOccupancy: 0, committedPositions: 1 })
    expectBalanced(engine)
  })

  test('detraying moves attached reservation to physical lane without changing commitment', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    runtime.trays = [attachedTray(1, 'A', 4)]
    runtime.cartons = []
    runtime.missions = []
    runtime.totalTraysCreated = 1
    runtime.cartonIntroduced = { A: 1, B: 0, C: 0 }
    expect(lane(engine, 'A')).toMatchObject({ attachedTrayReservations: 1, physicalLaneOccupancy: 0, committedPositions: 1 })
    for (let tick = 0; tick < 14; tick++) runtime.processPiles(0.1)
    expect(lane(engine, 'A')).toMatchObject({ pendingMissionReservations: 0, attachedTrayReservations: 0, physicalLaneOccupancy: 1, committedPositions: 1 })
    expectBalanced(engine)
  })

  test('operator consumption releases one reserved position', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    runtime.trays = []
    runtime.missions = []
    runtime.cartons = [{ internalKey: 1, laneId: 'CARTBUILD_A', zoneIndex: 29 }]
    runtime.totalTraysCreated = 0
    runtime.cartonIntroduced = { A: 1, B: 0, C: 0 }
    runtime.operatorConsumptionTimes = { A: [], B: [], C: [] }
    expect(lane(engine, 'A')).toMatchObject({ committedPositions: 1, availablePositions: 29 })
    runtime.processCartonOperators()
    expect(lane(engine, 'A')).toMatchObject({ committedPositions: 0, availablePositions: 30 })
    expectBalanced(engine)
  })

  test('toggle changes retain existing pending reservations', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const before = lane(engine, 'A')
    engine.setOperatingSetting('cartbuildAEnabled', false)
    expect(lane(engine, 'A')).toMatchObject({ pendingMissionReservations: before.pendingMissionReservations, committedPositions: before.committedPositions })
  })

  test('reset and Start Scenario rebuild reservations deterministically', () => {
    const engine = new SimulationEngine(SEGMENTS)
    engine.startScenario({ korberEnabled: false, cartbuildAEnabled: false, cartbuildBEnabled: false, cartbuildCEnabled: false }, 7)
    for (const source of ['A', 'B', 'C'] as SourceId[]) expect(lane(engine, source)).toMatchObject({ committedPositions: 0, availablePositions: 30 })
    expect(engine.getState().srsControl).toMatchObject({ planningCadenceSec: 7, nextPlanningTime: 7 })
    engine.reset()
    expect([lane(engine, 'A').committedPositions, lane(engine, 'B').committedPositions, lane(engine, 'C').committedPositions]).toEqual([30, 30, 30])
    expect(engine.getState().srsControl).toMatchObject({ planningCadenceSec: 10, nextPlanningTime: 10 })
  })

  test('Milestone 9 startup allocation and 180-second mission timing remain unchanged', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const state = engine.getState()
    expect([state.pendingA, state.pendingB, state.pendingC]).toEqual([34, 33, 33])
    expect(state.missions.every(({ createdAtSec, readyAtSec, state: missionState }) => readyAtSec - createdAtSec === 180 && missionState === 'RETRIEVING')).toBe(true)
    engine.step(179.9)
    expect(engine.getState().missions.every(({ state: missionState }) => missionState === 'RETRIEVING')).toBe(true)
  })

  test('lane reservation diagnostics are immutable snapshots with disjoint category totals', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    runtime.trays = [attachedTray(1, 'A')]
    runtime.missions = [mission(1, 'A', 'CARTBUILD'), mission(2, 'A', 'EMPTY')]
    runtime.cartons = [{ internalKey: 1, laneId: 'CARTBUILD_A', zoneIndex: 10 }]
    runtime.totalTraysCreated = 1
    runtime.cartonIntroduced = { A: 2, B: 0, C: 0 }
    const first = engine.getState()
    expect(first.cartbuildSystem.lanes.CARTBUILD_A).toMatchObject({ pendingMissionReservations: 1, attachedTrayReservations: 1, physicalLaneOccupancy: 1, committedPositions: 3, availablePositions: 27 })
    const frozen = JSON.stringify(first)
    runtime.missions.push(mission(3, 'A', 'CARTBUILD'))
    expect(JSON.stringify(first)).toBe(frozen)
    expect(lane(engine, 'A').committedPositions).toBe(4)
  })
})
