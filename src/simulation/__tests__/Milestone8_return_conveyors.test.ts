import { describe, expect, test } from 'vitest'
import SimulationEngine from '../SimulationEngine'
import type { Mission, ReturnDestination, Tray } from '../types'

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
  { id: 'A2', lengthFt: 136, speedFtPerMin: 120, maxOccupancy: 58 },
  { id: 'B2', lengthFt: 118.5, speedFtPerMin: 120, maxOccupancy: 51 },
  { id: 'C2', lengthFt: 118.5, speedFtPerMin: 120, maxOccupancy: 51 },
]

type Runtime = {
  trays: Tray[]
  missions: Mission[]
  totalTraysCreated: number
  consumedCount: number
  nextConsumptionTime: number
  timeSec: number
  sorterCursor: ReturnDestination
  processReturnBoundaries: () => void
  processExchangerSinks: () => void
}

const createEngine = () => new SimulationEngine(SEGMENTS)
const runtimeOf = (engine: SimulationEngine) => (engine as unknown as { milestone7: Runtime }).milestone7
const zoned = (id: number, conveyorId: NonNullable<Tray['zonePlacement']>['conveyorId'], zoneIndex: number, loadState: 'EMPTY' | 'FULL' = 'EMPTY'): Tray => ({
  id, currentSegmentId: conveyorId, positionFt: (zoneIndex + 0.5) * 2.5, status: 'BLOCKED', createdAtSec: 0,
  originSourceId: 'A', loadState, zonePlacement: { conveyorId, zoneIndex },
})
const inbound = (id: number, conveyorId: ReturnDestination, component: NonNullable<Tray['inboundPlacement']>['component'], position: number, loadState: 'EMPTY' | 'FULL' = 'EMPTY'): Tray => ({
  id, currentSegmentId: conveyorId, positionFt: position, status: 'BLOCKED', createdAtSec: 0,
  originSourceId: 'A', loadState,
  inboundPlacement: component === 'SPIRAL' ? { conveyorId, component, spiralPosFt: position } : { conveyorId, component, zoneIndex: position },
})
const routeOf = (tray: Tray) => tray.zonePlacement?.conveyorId ?? tray.inboundPlacement?.conveyorId

const assertPhysical = (state: ReturnType<SimulationEngine['getState']>) => {
  expect(state.materialBalanceError).toBe(0)
  expect(state.createdTrayCount).toBe(state.physicalTrayCount + state.returnSystem.returnedToAsrsCount)
  expect(new Set(state.trays.map((tray) => tray.id)).size).toBe(state.trays.length)
  const zoneKeys = state.trays.flatMap((tray) => tray.zonePlacement
    ? [`${tray.zonePlacement.conveyorId}:MDR:${tray.zonePlacement.zoneIndex}`]
    : tray.inboundPlacement && tray.inboundPlacement.component !== 'SPIRAL'
      ? [`${tray.inboundPlacement?.conveyorId}:${tray.inboundPlacement?.component}:${tray.inboundPlacement?.zoneIndex}`]
      : [])
  expect(new Set(zoneKeys).size).toBe(zoneKeys.length)
  for (const tray of state.trays) {
    expect(Number(Boolean(tray.pilePlacement)) + Number(Boolean(tray.zonePlacement)) + Number(Boolean(tray.inboundPlacement)) + Number(Boolean(tray.korberHeld))).toBe(1)
  }
}

describe('Milestone 8 return conveyor topology and lifecycle', () => {
  test('declares the required return geometry and resets empty with cursor A2', () => {
    const engine = createEngine()
    const expected = { PURGE: [30, 12], E: [70, 28], X: [10, 4], S: [20, 8], A2: [136, 58], B2: [118.5, 51], C2: [118.5, 51] }
    const state = engine.getState()
    for (const [id, [lengthFt, zones]] of Object.entries(expected)) {
      const segment = state.segments.find((candidate) => candidate.id === id)!
      expect([segment.lengthFt, segment.maxOccupancy]).toEqual([lengthFt, zones])
      expect(state.returnSystem.conveyorOccupancy[id as keyof typeof state.returnSystem.conveyorOccupancy]).toBe(0)
    }
    expect(state.returnSystem.sorterCursor).toBe('A2')
    expect(state.returnSystem.activePurgeBatch).toBeNull()
    expect(state.returnSystem.korberHeldTrayId).toBeNull()
    engine.step(10)
    engine.reset()
    expect(engine.getState().returnSystem).toMatchObject({ sorterCursor: 'A2', activePurgeBatch: null, korberHeldTrayId: null, returnedToAsrsCount: 0 })
  })

  test('Körber preserves ID, transforms EMPTY to FULL, holds one blocked tray, and restarts without catch-up', () => {
    const engine = createEngine()
    const runtime = runtimeOf(engine)
    runtime.trays = [zoned(1, 'D', 91), zoned(40, 'D', 90), ...Array.from({ length: 28 }, (_, zone) => zoned(zone + 2, 'E', zone))]
    runtime.missions = []
    runtime.totalTraysCreated = runtime.trays.length
    runtime.consumedCount = 0
    runtime.nextConsumptionTime = 0
    engine.step(0.1)
    let state = engine.getState()
    expect(state.returnSystem.korberProcessedCount).toBe(1)
    expect(state.returnSystem.korberHeldTrayId).toBe(1)
    expect(state.trays.find(({ id }) => id === 1)).toMatchObject({ id: 1, loadState: 'FULL', korberHeld: true })
    expect(state.trays.find(({ id }) => id === 1)?.zonePlacement).toBeUndefined()
    expect(state.returnSystem.returnedHistory.some(({ trayId }) => trayId === 1)).toBe(false)
    expect(state.createdTrayCount).toBe(30)
    engine.step(5)
    state = engine.getState()
    expect(state.returnSystem.korberProcessedCount).toBe(1)
    expect(state.returnSystem.korberHeldTrayId).toBe(1)

    runtime.trays = runtime.trays.filter((tray) => tray.id === 1 || tray.id === 40 || tray.id === 2)
    runtime.totalTraysCreated = runtime.trays.length
    const blocker = runtime.trays.find(({ id }) => id === 2)!
    blocker.zonePlacement = { conveyorId: 'E', zoneIndex: 1 }
    blocker.pileRuntime = undefined
    engine.step(0.1)
    state = engine.getState()
    expect(state.trays.find(({ id }) => id === 1)?.zonePlacement).toEqual({ conveyorId: 'E', zoneIndex: 0 })
    const processed = state.returnSystem.korberProcessedCount
    engine.step(3)
    expect(engine.getState().returnSystem.korberProcessedCount).toBe(processed)
    assertPhysical(engine.getState())
  })

  test('purge freezes the downstream six, excludes arrivals, and completes despite D reopening', () => {
    const engine = createEngine()
    const runtime = runtimeOf(engine)
    runtime.trays = Array.from({ length: 12 }, (_, zone) => zoned(zone + 1, 'T', zone))
    runtime.missions = []
    runtime.trays.push(zoned(20, 'D', 0))
    runtime.totalTraysCreated = 13
    runtime.nextConsumptionTime = Number.MAX_VALUE
    engine.step(0.1)
    let state = engine.getState()
    expect(state.returnSystem.activePurgeBatch?.authorizedTrayIds).toEqual([12, 11, 10, 9, 8, 7])
    expect(state.returnSystem.activePurgeBatch?.authorizedTrayIds.map((id) => runtime.trays.find((tray) => tray.id === id)?.purgeMember)).toEqual(Array(6).fill(true))
    expect(state.returnSystem.activePurgeBatch?.enteredPurgeCount).toBe(1)
    runtime.trays.push(zoned(21, 'PRE_T', 0))
    runtime.totalTraysCreated += 1
    const dBlocker = runtime.trays.find(({ id }) => id === 20)!
    dBlocker.zonePlacement = { conveyorId: 'D', zoneIndex: 1 }
    dBlocker.pileRuntime = undefined
    const entrySequence = [12]
    const seenInPurge = new Set(entrySequence)
    for (let tick = 0; tick < 500 && engine.getState().returnSystem.activePurgeBatch; tick++) {
      engine.step(0.1)
      for (const item of engine.getState().trays.filter((tray) => tray.zonePlacement?.conveyorId === 'PURGE')) {
        if (!seenInPurge.has(item.id)) { seenInPurge.add(item.id); entrySequence.push(item.id) }
      }
    }
    state = engine.getState()
    expect(state.returnSystem.activePurgeBatch).toBeNull()
    expect(state.returnSystem.lastCompletedPurgeBatch).toMatchObject({ authorizedCount: 6, divertedCount: 6, enteredPurgeCount: 6, status: 'COMPLETE' })
    expect(state.returnSystem.lastCompletedPurgeBatch?.authorizedTrayIds).not.toContain(21)
    expect(entrySequence).toEqual([12, 11, 10, 9, 8, 7])
    expect(new Set(entrySequence).size).toBe(6)
    expect(state.trays.filter((tray) => tray.purgeMember).map((tray) => tray.id).sort((a, b) => b - a)).toEqual([12, 11, 10, 9, 8, 7])
    for (const id of [12, 11, 10, 9, 8, 7]) expect(state.trays.find((tray) => tray.id === id)?.zonePlacement?.conveyorId).not.toBe('D')
    assertPhysical(state)
  })

  test('E has strict eligible priority into X and PURGE proceeds when E is not ready', () => {
    const engine = createEngine()
    const runtime = runtimeOf(engine)
    runtime.trays = [zoned(1, 'E', 27, 'FULL'), zoned(2, 'PURGE', 11)]
    runtime.totalTraysCreated = 2
    runtime.processReturnBoundaries()
    expect(runtime.trays.find(({ id }) => id === 1)?.zonePlacement).toEqual({ conveyorId: 'X', zoneIndex: 0 })
    expect(runtime.trays.find(({ id }) => id === 2)?.zonePlacement?.conveyorId).toBe('PURGE')
    runtime.trays = [zoned(2, 'PURGE', 11), zoned(3, 'E', 26, 'FULL')]
    runtime.totalTraysCreated = 2
    runtime.processReturnBoundaries()
    expect(runtime.trays.find(({ id }) => id === 2)?.zonePlacement).toEqual({ conveyorId: 'X', zoneIndex: 0 })
  })

  test('sorter cycles A2/B2/C2, freezes destinations, routes through S or direct, and blocks S head', () => {
    const engine = createEngine()
    const runtime = runtimeOf(engine)
    runtime.trays = []
    runtime.totalTraysCreated = 3
    const routed: Array<[number, ReturnDestination, string]> = []
    for (let id = 1; id <= 3; id++) {
      const item = zoned(id, 'X', 3, id % 2 ? 'EMPTY' : 'FULL')
      runtime.trays.push(item)
      runtime.processReturnBoundaries()
      routed.push([id, item.returnDestination!, routeOf(item)!])
      runtime.trays.splice(runtime.trays.indexOf(item), 1)
    }
    expect(routed).toEqual([[1, 'A2', 'S'], [2, 'B2', 'S'], [3, 'C2', 'C2']])
    expect(runtime.sorterCursor).toBe('A2')

    const head = zoned(10, 'S', 7); head.returnDestination = 'A2'
    const follower = zoned(11, 'S', 6); follower.returnDestination = 'B2'
    runtime.trays = [head, follower, inbound(12, 'A2', 'MDR_SORTER_SIDE', 0)]
    runtime.processReturnBoundaries()
    expect(head.zonePlacement?.conveyorId).toBe('S')
    expect(follower.zonePlacement?.conveyorId).toBe('S')
  })

  test('sorter traces nine equal-availability assignments, skips unavailable routes, and advances only on success', () => {
    const engine = createEngine()
    const runtime = runtimeOf(engine)
    runtime.trays = []
    runtime.totalTraysCreated = 9
    const trace: Array<{ id: number; load: string; destination: ReturnDestination; before: ReturnDestination; after: ReturnDestination; route: string }> = []
    for (let id = 1; id <= 9; id++) {
      const item = zoned(id, 'X', 3, id % 2 ? 'EMPTY' : 'FULL')
      runtime.trays.push(item)
      const before = runtime.sorterCursor
      runtime.processReturnBoundaries()
      trace.push({ id, load: item.loadState!, destination: item.returnDestination!, before, after: runtime.sorterCursor, route: routeOf(item)! })
      runtime.trays.splice(runtime.trays.indexOf(item), 1)
    }
    expect(trace.map(({ destination }) => destination)).toEqual(['A2', 'B2', 'C2', 'A2', 'B2', 'C2', 'A2', 'B2', 'C2'])
    expect(trace.map(({ route }) => route)).toEqual(['S', 'S', 'C2', 'S', 'S', 'C2', 'S', 'S', 'C2'])
    expect(trace.every(({ before, after, destination }) => before === destination && after === (destination === 'A2' ? 'B2' : destination === 'B2' ? 'C2' : 'A2'))).toBe(true)

    const aBlocked = inbound(20, 'A2', 'MDR_SORTER_SIDE', 0)
    const skipped = zoned(21, 'X', 3)
    runtime.trays = [aBlocked, skipped]
    runtime.sorterCursor = 'A2'
    runtime.processReturnBoundaries()
    expect(skipped.returnDestination).toBe('B2')
    expect(runtime.sorterCursor).toBe('C2')

    const frozen = zoned(22, 'X', 3); frozen.returnDestination = 'A2'
    const sBlocker = zoned(23, 'S', 0)
    runtime.trays = [frozen, sBlocker]
    runtime.sorterCursor = 'C2'
    runtime.processReturnBoundaries()
    expect(frozen.zonePlacement?.conveyorId).toBe('X')
    expect(frozen.returnDestination).toBe('A2')
    expect(runtime.sorterCursor).toBe('C2')
    runtime.trays.splice(runtime.trays.indexOf(sBlocker), 1)
    runtime.processReturnBoundaries()
    expect(frozen.zonePlacement?.conveyorId).toBe('S')
    expect(frozen.returnDestination).toBe('A2')
    expect(runtime.sorterCursor).toBe('B2')
  })

  test('independent exchanger sinks accept only final-zone trays at least eight seconds apart and retain history', () => {
    const engine = createEngine()
    const runtime = runtimeOf(engine)
    runtime.trays = [inbound(1, 'A2', 'MDR_EXCHANGER_SIDE', 4, 'FULL'), inbound(2, 'B2', 'MDR_EXCHANGER_SIDE', 4), inbound(3, 'C2', 'MDR_EXCHANGER_SIDE', 3)]
    runtime.missions = []
    runtime.totalTraysCreated = 3
    runtime.processExchangerSinks()
    expect(runtime.trays.map(({ id }) => id)).toEqual([3])
    runtime.trays.push(inbound(4, 'A2', 'MDR_EXCHANGER_SIDE', 4))
    runtime.totalTraysCreated += 1
    runtime.timeSec = 7.9
    runtime.processExchangerSinks()
    expect(runtime.trays.some(({ id }) => id === 4)).toBe(true)
    runtime.timeSec = 8
    runtime.processExchangerSinks()
    const state = engine.getState()
    expect(state.returnSystem.exchangerAcceptanceTimes.A2).toEqual([0, 8])
    expect(state.returnSystem.exchangerAcceptanceTimes.B2).toEqual([0])
    expect(state.returnSystem.returnedHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ trayId: 1, loadState: 'FULL', destination: 'A2' }),
      expect.objectContaining({ trayId: 2, loadState: 'EMPTY', destination: 'B2' }),
    ]))
    assertPhysical(state)
  })

  test('continuously supplied exchanger clocks independently sustain 450 trays/hour without drift or catch-up', () => {
    for (const destination of ['A2', 'B2', 'C2'] as const) {
      const engine = createEngine()
      const runtime = runtimeOf(engine)
      runtime.trays = []
      runtime.totalTraysCreated = 0
      let nextId = 1
      for (let tick = 0; tick <= 36_000; tick++) {
        const occupied = runtime.trays.some((tray) => tray.inboundPlacement?.conveyorId === destination && tray.inboundPlacement.component === 'MDR_EXCHANGER_SIDE' && tray.inboundPlacement.zoneIndex === 4)
        if (!occupied) { runtime.trays.push(inbound(nextId++, destination, 'MDR_EXCHANGER_SIDE', 4)); runtime.totalTraysCreated += 1 }
        runtime.timeSec = tick / 10
        runtime.processExchangerSinks()
      }
      const times = engine.getState().returnSystem.exchangerAcceptanceTimes[destination]
      expect(times).toHaveLength(451)
      for (let index = 1; index < times.length; index++) expect(times[index] - times[index - 1]).toBeCloseTo(8, 9)
      expect((times.length - 1) * 3600 / (times.at(-1)! - times[0])).toBeCloseTo(450, 9)
    }

    const starved = createEngine()
    const runtime = runtimeOf(starved)
    runtime.trays = [inbound(1, 'A2', 'MDR_EXCHANGER_SIDE', 4)]
    runtime.totalTraysCreated = 1
    runtime.timeSec = 0
    runtime.processExchangerSinks()
    runtime.timeSec = 100
    runtime.trays.push(inbound(2, 'A2', 'MDR_EXCHANGER_SIDE', 4)); runtime.totalTraysCreated += 1
    runtime.processExchangerSinks()
    runtime.trays.push(inbound(3, 'A2', 'MDR_EXCHANGER_SIDE', 4)); runtime.totalTraysCreated += 1
    runtime.processExchangerSinks()
    expect(starved.getState().returnSystem.exchangerAcceptanceTimes.A2).toEqual([0, 100])
    runtime.timeSec = 108
    runtime.processExchangerSinks()
    expect(starved.getState().returnSystem.exchangerAcceptanceTimes.A2).toEqual([0, 100, 108])
  }, 60_000)

  test('long deterministic run exercises both return sources, all destinations, immutability, and zero balance', () => {
    const engine = createEngine()
    const runtime = runtimeOf(engine)
    runtime.trays = [
      ...Array.from({ length: 92 }, (_, zone) => zoned(zone + 1, 'D', zone)),
      ...Array.from({ length: 12 }, (_, zone) => zoned(zone + 95, 'T', zone)),
    ]
    runtime.missions = []
    runtime.totalTraysCreated = runtime.trays.length
    runtime.nextConsumptionTime = 3600 / 1050
    let prior = engine.getState()
    for (let tick = 0; tick < 5000; tick++) {
      const frozen = prior.trays.map((tray) => [tray.id, tray.zonePlacement?.zoneIndex, tray.pilePlacement?.beltPosFt, tray.inboundPlacement?.spiralPosFt])
      engine.step(0.1)
      const state = engine.getState()
      expect(prior.trays.map((tray) => [tray.id, tray.zonePlacement?.zoneIndex, tray.pilePlacement?.beltPosFt, tray.inboundPlacement?.spiralPosFt])).toEqual(frozen)
      assertPhysical(state)
      prior = state
    }
    expect(prior.returnSystem.korberProcessedCount).toBeGreaterThan(0)
    expect(prior.returnSystem.mergeCounts.eToXFull).toBeGreaterThan(0)
    expect(prior.returnSystem.mergeCounts.purgeToXEmpty).toBeGreaterThan(0)
    for (const destination of ['A2', 'B2', 'C2'] as const) expect(prior.returnSystem.assignments[destination].EMPTY + prior.returnSystem.assignments[destination].FULL).toBeGreaterThan(0)
    const totals = Object.values(prior.returnSystem.assignments).map((counts) => counts.EMPTY + counts.FULL)
    expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(1)
    engine.reset()
    const resetA = engine.getState()
    engine.step(10)
    engine.reset()
    expect(engine.getState()).toEqual(resetA)
  }, 120_000)
})
