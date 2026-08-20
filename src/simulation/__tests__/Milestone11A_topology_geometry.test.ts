import { describe, expect, test } from 'vitest'
import HybridAccumulationPile from '../HybridAccumulationPile'
import SimulationEngine from '../SimulationEngine'
import { SRS_TARGET_SIZES, ZONE_COUNTS } from '../Milestone7Simulation'
import type { SourceId, Tray, ZonedConveyorId } from '../types'

const SEGMENTS = [
  ['A1', 103.5, 45], ['B1', 86, 38], ['C1', 86, 38], ['PRE_T', 15, 6], ['T', 30, 12], ['D', 230, 92],
  ['PURGE', 30, 12], ['E', 70, 28], ['X', 10, 4], ['S', 20, 8], ['A2', 90, 36], ['B2', 72.5, 29], ['C2', 72.5, 29],
  ['CARTBUILD_A', 75, 30], ['CARTBUILD_B', 75, 30], ['CARTBUILD_C', 75, 30],
].map(([id, lengthFt, maxOccupancy]) => ({ id: String(id), lengthFt: Number(lengthFt), speedFtPerMin: 120, maxOccupancy: Number(maxOccupancy) }))

type Runtime = {
  trays: Tray[]
  missions: Array<{ assignedExchanger: SourceId; missionType: 'CARTBUILD' | 'EMPTY' }>
  totalTraysCreated: number
  cartons: Array<{ internalKey: number; laneId: 'CARTBUILD_A' | 'CARTBUILD_B' | 'CARTBUILD_C'; zoneIndex: number }>
  cartonIntroduced: Record<SourceId, number>
  processPiles: (delta: number) => void
  authorizePurgeIfNeeded: () => void
}

const runtimeOf = (engine: SimulationEngine) => (engine as unknown as { milestone7: Runtime }).milestone7
const pile = (pileId: 'A1' | 'B1' | 'C1', downstreamMdrCount: number, totalLengthFt: number) => new HybridAccumulationPile({
  pileId, totalLengthFt, preDetrayerMdrCount: 5, postDetrayerMdrCount: 5, downstreamMdrCount,
  beltLengthFt: 41, mdrZoneLengthFt: 2.5, trayLengthFt: 2,
})
const tray = (id: number, source: SourceId, component: NonNullable<Tray['pilePlacement']>['component'], zoneIndex?: number, beltPosFt?: number): Tray => ({
  id, currentSegmentId: `${source}1`, positionFt: 0, status: 'BLOCKED', createdAtSec: 0, originSourceId: source,
  loadState: 'EMPTY', pilePlacement: { pileId: `${source}1`, component, zoneIndex, beltPosFt },
})
const zoned = (id: number, conveyorId: ZonedConveyorId, zoneIndex: number): Tray => ({
  id, currentSegmentId: conveyorId, positionFt: (zoneIndex + 0.5) * 2.5, status: 'BLOCKED', createdAtSec: 0,
  originSourceId: 'A', loadState: 'EMPTY', zonePlacement: { conveyorId, zoneIndex },
})

describe('Milestone 11A outbound topology and geometry', () => {
  test('A1 is 103.5 feet with 45 positions', () => {
    const model = pile('A1', 15, 103.5)
    expect(model.getPhysicalCapacity()).toBe(45)
  })

  test('B1 and C1 are 86 feet with 38 positions each', () => {
    for (const id of ['B1', 'C1'] as const) expect(pile(id, 8, 86).getPhysicalCapacity()).toBe(38)
  })

  test('pile placements expose the exact pre, post, belt, downstream order and dimensions', () => {
    const model = pile('A1', 15, 103.5)
    const ordered = model.initialTrays(1, 'A', 45).trays
      .sort((left, right) => left.positionFt - right.positionFt)
      .map(({ pilePlacement }) => pilePlacement!.component)
      .filter((component, index, components) => component !== components[index - 1])
    expect(ordered).toEqual(['MDR_PRE_DETRAYER', 'MDR_POST_DETRAYER', 'BELT', 'MDR_DOWNSTREAM'])
    expect(model.config).toMatchObject({ preDetrayerMdrCount: 5, postDetrayerMdrCount: 5, beltLengthFt: 41, downstreamMdrCount: 15 })
  })

  test('the 41-foot belt supplies 20 tray positions and a 20.5-second nominal traversal', () => {
    const model = pile('A1', 15, 103.5)
    expect(model.getBeltPositions()).toBe(20)
    expect(model.getNominalBeltTraversalSec(120)).toBe(20.5)
  })

  test('downstream zone zero stops every belt tray and rejects post-zone-four entry', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    runtime.trays = [tray(1, 'A', 'MDR_DOWNSTREAM', 0), tray(2, 'A', 'BELT', undefined, 30), tray(3, 'A', 'BELT', undefined, 20), tray(4, 'A', 'MDR_POST_DETRAYER', 4)]
    runtime.processPiles(1)
    expect(runtime.trays.map(({ pilePlacement }) => pilePlacement)).toEqual([
      { pileId: 'A1', component: 'MDR_DOWNSTREAM', zoneIndex: 0 },
      { pileId: 'A1', component: 'BELT', beltPosFt: 30 },
      { pileId: 'A1', component: 'BELT', beltPosFt: 20 },
      { pileId: 'A1', component: 'MDR_POST_DETRAYER', zoneIndex: 4 },
    ])
    expect(engine.getState().beltDiagnostics.find(({ pileId }) => pileId === 'A1')?.beltRunning).toBe(false)

    runtime.trays = runtime.trays.filter(({ id }) => id !== 1)
    runtime.processPiles(0.1)
    const restartedPositions = runtime.trays.filter(({ pilePlacement }) => pilePlacement?.component === 'BELT')
      .map(({ pilePlacement }) => pilePlacement!.beltPosFt!).sort((left, right) => left - right)
    expect(restartedPositions).toEqual([20.2, 30.2])
    expect(restartedPositions[1] - restartedPositions[0]).toBeGreaterThanOrEqual(2)
    expect(engine.getState().beltDiagnostics.find(({ pileId }) => pileId === 'A1')?.beltRunning).toBe(true)
  })

  test('loaded CARTBUILD trays split atomically between pre-zone four and post-zone zero', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    const loaded = tray(1, 'A', 'MDR_PRE_DETRAYER', 4); loaded.loadState = 'FULL'; loaded.payloadOrigin = 'CARTBUILD'; loaded.cartbuildCartonAttached = true
    runtime.trays = [loaded]; runtime.missions = []; runtime.cartons = []; runtime.totalTraysCreated = 1; runtime.cartonIntroduced = { A: 1, B: 0, C: 0 }
    for (let tick = 0; tick < 14; tick++) runtime.processPiles(0.1)
    expect(loaded).toMatchObject({ loadState: 'EMPTY', pilePlacement: { component: 'MDR_POST_DETRAYER', zoneIndex: 0 } })
    expect(runtime.cartons).toEqual([expect.objectContaining({ laneId: 'CARTBUILD_A', zoneIndex: 0 })])
  })

  test.each(['POST_ZONE_0', 'CARTON_ZONE_0'] as const)('atomic detraying waits when %s is unavailable', (blockedDestination) => {
    const engine = new SimulationEngine(SEGMENTS); const runtime = runtimeOf(engine)
    const loaded = tray(1, 'A', 'MDR_PRE_DETRAYER', 4); loaded.loadState = 'FULL'; loaded.payloadOrigin = 'CARTBUILD'; loaded.cartbuildCartonAttached = true
    runtime.trays = blockedDestination === 'POST_ZONE_0' ? [loaded, tray(2, 'A', 'MDR_POST_DETRAYER', 0)] : [loaded]
    runtime.cartons = blockedDestination === 'CARTON_ZONE_0' ? [{ internalKey: 1, laneId: 'CARTBUILD_A', zoneIndex: 0 }] : []
    for (let tick = 0; tick < 20; tick++) runtime.processPiles(0.1)
    expect(loaded).toMatchObject({ loadState: 'FULL', cartbuildCartonAttached: true, pilePlacement: { component: 'MDR_PRE_DETRAYER', zoneIndex: 4 } })
  })

  test('EMPTY trays cross the detrayer boundary without creating a carton', () => {
    const engine = new SimulationEngine(SEGMENTS); const runtime = runtimeOf(engine); const empty = tray(1, 'A', 'MDR_PRE_DETRAYER', 4)
    runtime.trays = [empty]; runtime.cartons = []
    for (let tick = 0; tick < 14; tick++) runtime.processPiles(0.1)
    expect(empty.pilePlacement).toMatchObject({ component: 'MDR_POST_DETRAYER', zoneIndex: 0 })
    expect(runtime.cartons).toEqual([])
  })

  test('Körber-origin FULL trays are rejected at the outbound detrayer', () => {
    const engine = new SimulationEngine(SEGMENTS); const runtime = runtimeOf(engine); const invalid = tray(1, 'A', 'MDR_PRE_DETRAYER', 4)
    invalid.loadState = 'FULL'; invalid.payloadOrigin = 'KORBER'; runtime.trays = [invalid]
    expect(() => runtime.processPiles(0.1)).toThrow(/Körber payload tray 1/)
  })

  test('shared zoned conveyors use the authoritative position counts', () => {
    expect(ZONE_COUNTS).toEqual({ PRE_T: 6, T: 12, D: 92, PURGE: 12, E: 28, X: 4, S: 8, A2: 36, B2: 29, C2: 29 })
  })

  test('SRS targets use D=92 and total 248', () => {
    expect(SRS_TARGET_SIZES.D).toBe(92)
    expect(Object.values(SRS_TARGET_SIZES).reduce((sum, count) => sum + count, 0)).toBe(248)
  })

  test('reset creates A1=24, B1=16, C1=16, and a full 92-position D', () => {
    const state = new SimulationEngine(SEGMENTS).getState()
    expect(state.srsControl.current).toMatchObject({ A1: 24, B1: 16, C1: 16, D: 92 })
    expect(state.zonedOccupancy.D).toBe(92)
  })

  test('reset fills each hybrid pile from the discharge end backward without overlap', () => {
    for (const [model, count, source] of [[pile('A1', 15, 103.5), 24, 'A'], [pile('B1', 8, 86), 16, 'B'], [pile('C1', 8, 86), 16, 'C']] as const) {
      const trays = model.initialTrays(1, source, count)
      expect(trays.trays[0].pilePlacement).toMatchObject({ component: 'MDR_DOWNSTREAM', zoneIndex: model.config.downstreamMdrCount - 1 })
      const positions = trays.trays.map(({ positionFt }) => positionFt).sort((left, right) => left - right)
      for (let index = 1; index < positions.length; index++) expect(positions[index] - positions[index - 1]).toBeGreaterThanOrEqual(2)
    }
  })

  test('SRS CurrentCount includes every MDR region and the belt exactly once', () => {
    const engine = new SimulationEngine(SEGMENTS); const runtime = runtimeOf(engine)
    runtime.trays = [tray(1, 'A', 'MDR_PRE_DETRAYER', 0), tray(2, 'A', 'MDR_POST_DETRAYER', 0), tray(3, 'A', 'BELT', undefined, 10), tray(4, 'A', 'MDR_DOWNSTREAM', 0)]
    expect(engine.getState().srsControl.current.A1).toBe(4)
  })

  test('time-zero planning creates 100 missions allocated 34/33/33', () => {
    const state = new SimulationEngine(SEGMENTS).getState()
    expect(state.missions).toHaveLength(100)
    expect([state.pendingA, state.pendingB, state.pendingC]).toEqual([34, 33, 33])
  })

  test('time-zero mission types are 90 CARTBUILD and 10 EMPTY', () => {
    const missions = new SimulationEngine(SEGMENTS).getState().missions
    expect(missions.filter(({ missionType }) => missionType === 'CARTBUILD')).toHaveLength(90)
    expect(missions.filter(({ missionType }) => missionType === 'EMPTY')).toHaveLength(10)
  })

  test('time-zero accounting reconciles 148 conveyor, 100 robot-carried, and 248 physical trays', () => {
    const state = new SimulationEngine(SEGMENTS).getState()
    expect(state.trays).toHaveLength(148)
    expect(state.asrsRobotSystem.robotCarriedTrayCount).toBe(100)
    expect(state.physicalTrayCount).toBe(248)
  })

  test('PURGE has 12 physical zones while its frozen bypass batch remains six trays', () => {
    const engine = new SimulationEngine(SEGMENTS); const runtime = runtimeOf(engine)
    runtime.trays = [...Array.from({ length: 12 }, (_, index) => zoned(index + 1, 'T', index)), zoned(20, 'D', 0)]
    runtime.authorizePurgeIfNeeded()
    expect(engine.getState().returnSystem.activePurgeBatch).toMatchObject({ authorizedCount: 6 })
    expect(ZONE_COUNTS.PURGE).toBe(12)
  })

  test('tray and carton balances are exact at reset and after sustained operation', () => {
    const engine = new SimulationEngine(SEGMENTS)
    for (const seconds of [0, 300]) {
      if (seconds) engine.step(seconds)
      const state = engine.getState()
      expect(state.materialBalanceError).toBe(0)
      expect(state.cartbuildSystem.cartonBalanceError).toBe(0)
      expect(new Set(state.trays.map(({ id }) => id)).size).toBe(state.trays.length)
      for (const pileId of ['A1', 'B1', 'C1']) {
        const beltPositions = state.trays.filter(({ pilePlacement }) => pilePlacement?.pileId === pileId && pilePlacement.component === 'BELT')
          .map(({ pilePlacement }) => pilePlacement!.beltPosFt!).sort((left, right) => left - right)
        for (let index = 1; index < beltPositions.length; index++) expect(beltPositions[index] - beltPositions[index - 1]).toBeGreaterThanOrEqual(2 - 1e-8)
        const zoneKeys = state.trays.filter(({ pilePlacement }) => pilePlacement?.pileId === pileId && pilePlacement.component !== 'BELT')
          .map(({ pilePlacement }) => `${pilePlacement!.component}:${pilePlacement!.zoneIndex}`)
        expect(new Set(zoneKeys).size).toBe(zoneKeys.length)
      }
    }
  })

  test('existing robot ownership and immutable snapshot behavior remain valid', () => {
    const engine = new SimulationEngine(SEGMENTS); const before = engine.getState(); const frozen = JSON.stringify(before)
    expect(new Set(before.asrsRobotSystem.outboundRobots.map(({ robotId }) => robotId)).size).toBe(100)
    engine.step(1)
    expect(JSON.stringify(before)).toBe(frozen)
  })
})
