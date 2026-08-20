import { describe, expect, test } from 'vitest'
import SimulationEngine from '../SimulationEngine'
import InboundCompositeConveyor from '../InboundCompositeConveyor'
import { INBOUND_COMPOSITE_CONFIGS, SRS_TARGET_SIZES } from '../Milestone7Simulation'
import type { ReturnDestination, SourceId, Tray } from '../types'

const SEGMENTS = [
  ['A1', 103.5, 45], ['B1', 86, 38], ['C1', 86, 38], ['PRE_T', 15, 6], ['T', 30, 12], ['D', 230, 92],
  ['PURGE', 30, 12], ['E', 70, 28], ['X', 10, 4], ['S', 20, 8], ['A2', 136, 58], ['B2', 118.5, 51], ['C2', 118.5, 51],
  ['CARTBUILD_A', 75, 30], ['CARTBUILD_B', 75, 30], ['CARTBUILD_C', 75, 30],
].map(([id, lengthFt, maxOccupancy]) => ({ id: String(id), lengthFt: Number(lengthFt), speedFtPerMin: 120, maxOccupancy: Number(maxOccupancy) }))

type Runtime = {
  trays: Tray[]
  timeSec: number
  totalTraysCreated: number
  missions: unknown[]
  inboundMissions: Array<{ reservedTrayId: number; maturityTimeSec: number }>
  processInboundComposites: (delta: number) => void
  processReturnBoundaries: () => void
  processExchangerSinks: () => void
  takeInboundTray: (source: SourceId, reservedTrayId?: number) => Tray | undefined
  srsCurrentCounts: () => Record<string, number>
}
const runtimeOf = (engine: SimulationEngine) => (engine as unknown as { milestone7: Runtime }).milestone7
const makeTray = (id: number, destination: ReturnDestination, component: NonNullable<Tray['inboundPlacement']>['component'], value: number): Tray => ({
  id, currentSegmentId: destination, positionFt: 0, status: 'BLOCKED', createdAtSec: 0, originSourceId: destination[0] as SourceId, loadState: 'EMPTY',
  inboundPlacement: component === 'SPIRAL' ? { conveyorId: destination, component, spiralPosFt: value } : { conveyorId: destination, component, zoneIndex: value },
})
const isolate = (engine: SimulationEngine, trays: Tray[]) => {
  const runtime = runtimeOf(engine)
  runtime.trays = trays
  runtime.missions = []
  runtime.totalTraysCreated = trays.length
  return runtime
}
const processFor = (runtime: Runtime, seconds: number) => {
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += 0.1) runtime.processInboundComposites(Math.min(0.1, seconds - elapsed))
}
const placementKey = (tray: Tray) => `${tray.inboundPlacement?.conveyorId}:${tray.inboundPlacement?.component}:${tray.inboundPlacement?.zoneIndex ?? tray.inboundPlacement?.spiralPosFt}`

describe('Milestone 11B authoritative inbound spiral conveyors', () => {
  test('declares exact composite geometry and physical capacities', () => {
    expect(INBOUND_COMPOSITE_CONFIGS).toEqual({
      A2: { totalLengthFt: 136, sorterSideMdrCount: 33, spiralLengthFt: 41, exchangerSideMdrCount: 5 },
      B2: { totalLengthFt: 118.5, sorterSideMdrCount: 26, spiralLengthFt: 41, exchangerSideMdrCount: 5 },
      C2: { totalLengthFt: 118.5, sorterSideMdrCount: 26, spiralLengthFt: 41, exchangerSideMdrCount: 5 },
    })
    for (const [id, capacity] of [['A2', 58], ['B2', 51], ['C2', 51]] as const) {
      const segment = new SimulationEngine(SEGMENTS).getState().segments.find(({ id: candidate }) => candidate === id)!
      expect([segment.lengthFt, segment.maxOccupancy]).toEqual([INBOUND_COMPOSITE_CONFIGS[id].totalLengthFt, capacity])
    }
  })

  test('all three composites expose 20 spiral positions and 20.5-second nominal travel', () => {
    for (const conveyorId of ['A2', 'B2', 'C2'] as const) {
      const composite = new InboundCompositeConveyor({ conveyorId, ...INBOUND_COMPOSITE_CONFIGS[conveyorId], mdrZoneLengthFt: 2.5, trayLengthFt: 2 })
      expect([composite.spiralPositionCapacity, composite.positionCapacity, composite.nominalSpiralTraversalSec]).toEqual([20, conveyorId === 'A2' ? 58 : 51, 20.5])
    }
  })

  test('reset and Start Scenario leave A2/B2/C2 physically empty', () => {
    const engine = new SimulationEngine(SEGMENTS)
    for (const action of [() => engine.reset(), () => engine.startScenario(engine.getOperatingSettings(), 7)]) {
      action()
      expect(engine.getState().trays.filter(({ inboundPlacement }) => inboundPlacement)).toEqual([])
    }
  })

  test('SRS control targets remain logical 36/29/29', () => {
    expect([SRS_TARGET_SIZES.A2, SRS_TARGET_SIZES.B2, SRS_TARGET_SIZES.C2]).toEqual([36, 29, 29])
  })

  test('sorter admission checks exact sorter-side zone zero', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const x = { ...makeTray(1, 'C2', 'MDR_SORTER_SIDE', 3), inboundPlacement: undefined, zonePlacement: { conveyorId: 'X' as const, zoneIndex: 3 }, returnDestination: 'C2' as const }
    const blocker = makeTray(2, 'C2', 'MDR_SORTER_SIDE', 0)
    const runtime = isolate(engine, [x, blocker])
    runtime.processReturnBoundaries()
    expect(x.zonePlacement?.conveyorId).toBe('X')
    blocker.inboundPlacement!.zoneIndex = 1
    runtime.processReturnBoundaries()
    expect(x.inboundPlacement).toEqual({ conveyorId: 'C2', component: 'MDR_SORTER_SIDE', zoneIndex: 0 })
  })

  test('A2 and B2 remain routed through S while C2 remains direct', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = isolate(engine, [])
    const routes: string[] = []
    for (let id = 1; id <= 3; id++) {
      const tray: Tray = { ...makeTray(id, 'A2', 'MDR_SORTER_SIDE', 0), inboundPlacement: undefined, zonePlacement: { conveyorId: 'X', zoneIndex: 3 } }
      runtime.trays.push(tray); runtime.processReturnBoundaries(); routes.push(tray.zonePlacement?.conveyorId ?? tray.inboundPlacement!.conveyorId); runtime.trays = []
    }
    expect(routes).toEqual(['S', 'S', 'C2'])
  })

  test('S retains head-of-line blocking at the assigned composite entrance', () => {
    const head: Tray = { ...makeTray(1, 'A2', 'MDR_SORTER_SIDE', 0), inboundPlacement: undefined, zonePlacement: { conveyorId: 'S', zoneIndex: 7 }, returnDestination: 'A2' }
    const follower: Tray = { ...head, id: 2, zonePlacement: { conveyorId: 'S', zoneIndex: 6 }, returnDestination: 'B2' }
    const runtime = isolate(new SimulationEngine(SEGMENTS), [head, follower, makeTray(3, 'A2', 'MDR_SORTER_SIDE', 0)])
    runtime.processReturnBoundaries()
    expect([head.zonePlacement?.conveyorId, follower.zonePlacement?.conveyorId]).toEqual(['S', 'S'])
  })

  test('MDR zones transfer only after the 1.25-second timer', () => {
    const tray = makeTray(1, 'A2', 'MDR_SORTER_SIDE', 0)
    const runtime = isolate(new SimulationEngine(SEGMENTS), [tray])
    runtime.processInboundComposites(0.1)
    processFor(runtime, 1.3)
    expect(tray.inboundPlacement?.zoneIndex).toBe(1)
    expect(tray.positionFt).toBeCloseTo(3.75, 9)
  })

  test('MDR vacancy propagation uses deterministic residual time without position drift', () => {
    const trays = [makeTray(1, 'B2', 'MDR_SORTER_SIDE', 1), makeTray(2, 'B2', 'MDR_SORTER_SIDE', 0)]
    const runtime = isolate(new SimulationEngine(SEGMENTS), trays)
    processFor(runtime, 2.7)
    expect(trays.map((tray) => tray.inboundPlacement?.zoneIndex)).toEqual([3, 1])
    expect(trays.map((tray) => tray.positionFt)).toEqual([8.75, 3.75])
  })

  test('spiral centers stay within 1 and 40 feet with two-foot pitch', () => {
    const trays = Array.from({ length: 20 }, (_, index) => makeTray(index + 1, 'A2', 'SPIRAL', 1 + index * 2))
    const runtime = isolate(new SimulationEngine(SEGMENTS), [...trays, makeTray(30, 'A2', 'MDR_EXCHANGER_SIDE', 0)])
    runtime.processInboundComposites(1)
    expect(trays.map((tray) => tray.inboundPlacement?.spiralPosFt)).toEqual(Array.from({ length: 20 }, (_, index) => 1 + index * 2))
  })

  test('a blocked exchanger-side zone zero stops the whole spiral', () => {
    const spiral = [makeTray(1, 'B2', 'SPIRAL', 5), makeTray(2, 'B2', 'SPIRAL', 15)]
    const runtime = isolate(new SimulationEngine(SEGMENTS), [...spiral, makeTray(3, 'B2', 'MDR_EXCHANGER_SIDE', 0)])
    runtime.processInboundComposites(2)
    expect(spiral.map(placementKey)).toEqual(['B2:SPIRAL:5', 'B2:SPIRAL:15'])
    expect(spiral.every(({ status }) => status === 'BLOCKED')).toBe(true)
  })

  test('a stopped spiral also blocks sorter-side entry', () => {
    const final = makeTray(1, 'C2', 'MDR_SORTER_SIDE', 25)
    const runtime = isolate(new SimulationEngine(SEGMENTS), [final, makeTray(2, 'C2', 'MDR_EXCHANGER_SIDE', 0), makeTray(3, 'C2', 'MDR_EXCHANGER_SIDE', 1)])
    processFor(runtime, 2)
    expect(final.inboundPlacement).toEqual({ conveyorId: 'C2', component: 'MDR_SORTER_SIDE', zoneIndex: 25 })
    expect(final.pileRuntime).toBeUndefined()
  })

  test('unblocking exchanger-side zone zero resumes all spiral trays together', () => {
    const spiral = [makeTray(1, 'A2', 'SPIRAL', 5), makeTray(2, 'A2', 'SPIRAL', 9)]
    const blocker = makeTray(3, 'A2', 'MDR_EXCHANGER_SIDE', 0)
    const runtime = isolate(new SimulationEngine(SEGMENTS), [...spiral, blocker])
    runtime.processInboundComposites(1)
    blocker.inboundPlacement!.zoneIndex = 1
    runtime.processInboundComposites(1)
    expect(spiral.map((tray) => tray.inboundPlacement?.spiralPosFt)).toEqual([7, 11])
  })

  test('spiral exit occurs before shared movement and sorter entry', () => {
    const leading = makeTray(1, 'A2', 'SPIRAL', 40)
    const following = makeTray(2, 'A2', 'SPIRAL', 36)
    const entry = makeTray(3, 'A2', 'MDR_SORTER_SIDE', 32)
    const runtime = isolate(new SimulationEngine(SEGMENTS), [leading, following, entry])
    runtime.processInboundComposites(0.5)
    expect(leading.inboundPlacement).toEqual({ conveyorId: 'A2', component: 'MDR_EXCHANGER_SIDE', zoneIndex: 0 })
    expect(following.inboundPlacement?.spiralPosFt).toBe(37)
    expect(entry.pileRuntime?.transferRemainingSec).toBeCloseTo(1.25, 9)
  })

  test('completed sorter-to-spiral entry has one placement and no stale transfer state', () => {
    const tray = makeTray(1, 'B2', 'MDR_SORTER_SIDE', 25)
    const runtime = isolate(new SimulationEngine(SEGMENTS), [tray])
    runtime.processInboundComposites(0.1)
    processFor(runtime, 1.3)
    expect(tray.inboundPlacement).toEqual({ conveyorId: 'B2', component: 'SPIRAL', spiralPosFt: expect.closeTo(1.2, 9) })
    expect(tray.pileRuntime).toBeUndefined()
  })

  test('a full 20-position spiral cannot accept a twenty-first tray', () => {
    const spiral = Array.from({ length: 20 }, (_, index) => makeTray(index + 1, 'C2', 'SPIRAL', 1 + index * 2))
    const entry = makeTray(21, 'C2', 'MDR_SORTER_SIDE', 25)
    const runtime = isolate(new SimulationEngine(SEGMENTS), [...spiral, entry, makeTray(22, 'C2', 'MDR_EXCHANGER_SIDE', 0), makeTray(23, 'C2', 'MDR_EXCHANGER_SIDE', 1)])
    processFor(runtime, 2)
    expect(entry.inboundPlacement?.component).toBe('MDR_SORTER_SIDE')
    expect(runtime.trays.filter((tray) => tray.inboundPlacement?.component === 'SPIRAL')).toHaveLength(20)
  })

  test('uninterrupted spiral movement preserves order, spacing, and nominal timing metadata', () => {
    const trays = [makeTray(1, 'B2', 'SPIRAL', 1), makeTray(2, 'B2', 'SPIRAL', 5), makeTray(3, 'B2', 'SPIRAL', 9)]
    const runtime = isolate(new SimulationEngine(SEGMENTS), trays)
    processFor(runtime, 10)
    expect(trays.map((tray) => tray.inboundPlacement?.spiralPosFt)).toEqual([expect.closeTo(21, 9), expect.closeTo(25, 9), expect.closeTo(29, 9)])
    expect(new InboundCompositeConveyor({ conveyorId: 'B2', ...INBOUND_COMPOSITE_CONFIGS.B2, mdrZoneLengthFt: 2.5, trayLengthFt: 2 }).nominalSpiralTraversalSec).toBe(20.5)
  })

  test('CurrentCount includes sorter MDR, spiral, and exchanger MDR exactly once', () => {
    const runtime = isolate(new SimulationEngine(SEGMENTS), [makeTray(1, 'A2', 'MDR_SORTER_SIDE', 0), makeTray(2, 'A2', 'SPIRAL', 7), makeTray(3, 'A2', 'MDR_EXCHANGER_SIDE', 4)])
    expect(runtime.srsCurrentCounts().A2).toBe(3)
  })

  test('inbound-only reservation selects only the exact final exchanger-side zone', () => {
    const runtime = isolate(new SimulationEngine(SEGMENTS), [makeTray(1, 'A2', 'MDR_EXCHANGER_SIDE', 3), makeTray(2, 'B2', 'MDR_EXCHANGER_SIDE', 4)])
    runtime.processExchangerSinks()
    expect(runtime.inboundMissions.map(({ reservedTrayId }) => reservedTrayId)).toEqual([2])
  })

  test('TAKE pickup rejects a nonmatching reservation and preserves physical ownership', () => {
    const tray = makeTray(1, 'A2', 'MDR_EXCHANGER_SIDE', 4)
    const runtime = isolate(new SimulationEngine(SEGMENTS), [tray])
    expect(runtime.takeInboundTray('A', 2)).toBeUndefined()
    expect(runtime.trays).toContain(tray)
  })

  test('TAKE pickup transfers the exact final-zone tray identity', () => {
    const tray = makeTray(1, 'C2', 'MDR_EXCHANGER_SIDE', 4)
    const runtime = isolate(new SimulationEngine(SEGMENTS), [tray])
    expect(runtime.takeInboundTray('C', 1)?.id).toBe(1)
    expect(runtime.trays).not.toContain(tray)
    expect(tray.inboundPlacement).toBeUndefined()
  })

  test('snapshots remain immutable and tray identity/placement stay unique', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = isolate(engine, [makeTray(1, 'A2', 'SPIRAL', 3), makeTray(2, 'B2', 'MDR_SORTER_SIDE', 0)])
    const before = engine.getState()
    runtime.processInboundComposites(1)
    expect(before.trays[0].inboundPlacement?.spiralPosFt).toBe(3)
    const after = engine.getState()
    expect(new Set(after.trays.map(({ id }) => id)).size).toBe(after.trays.length)
    expect(new Set(after.trays.map(placementKey)).size).toBe(after.trays.length)
  })

  test('long blocked/unblocked progression retains zero tray and carton balance', () => {
    const engine = new SimulationEngine(SEGMENTS)
    engine.step(600)
    const state = engine.getState()
    expect(state.materialBalanceError).toBe(0)
    expect(state.cartbuildSystem.cartonBalanceError).toBe(0)
    expect(state.createdTrayCount).toBe(state.physicalTrayCount + state.returnSystem.returnedToAsrsCount)
  }, 30_000)
})
