import { describe, expect, test } from 'vitest'
import SimulationEngine from '../SimulationEngine'
import type { Mission, ReturnDestination, SourceReleaseGrantState, Tray } from '../types'

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
  activeSourceGrant: SourceReleaseGrantState | null
  returnAssignments: Record<ReturnDestination, { EMPTY: number; FULL: number }>
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

  test('six-member purge admits a nonmember concurrently and completes exactly once despite D reopening', () => {
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
    const newcomer = zoned(21, 'PRE_T', 5)
    newcomer.sourceGrantId = 77
    runtime.trays.push(newcomer)
    runtime.totalTraysCreated += 1
    runtime.activeSourceGrant = { grantId: 77, source: 'A', releasedCount: 1, enteredTCount: 0, startedAtSec: 0, expiresAtSec: 10, drainingStartedAtSec: null, completedAtSec: null, phase: 'DRAINING', selectionReason: 'NORMAL', purgeDemandExecution: null }
    const dBlocker = runtime.trays.find(({ id }) => id === 20)!
    dBlocker.zonePlacement = { conveyorId: 'D', zoneIndex: 1 }
    dBlocker.pileRuntime = undefined
    const entrySequence = [12]
    const seenInPurge = new Set(entrySequence)
    let newcomerEnteredTDuringDiversion = false
    const observedBatchIds = new Set<number>()
    for (let tick = 0; tick < 500 && engine.getState().returnSystem.inFlightPurgeBatches.length; tick++) {
      engine.step(0.1)
      const during = engine.getState()
      if (during.returnSystem.activePurgeBatch) observedBatchIds.add(during.returnSystem.activePurgeBatch.batchId)
      newcomerEnteredTDuringDiversion ||= Boolean(during.returnSystem.inFlightPurgeBatches.length && during.trays.find((tray) => tray.id === 21)?.zonePlacement?.conveyorId === 'T')
      expect(during.trays.find((tray) => tray.id === 21)?.tPurgeBatchId).toBeUndefined()
      expect(during.trays.find((tray) => tray.id === 21)?.purgeMember).not.toBe(true)
      for (const item of during.trays.filter((tray) => tray.zonePlacement?.conveyorId === 'PURGE')) {
        if (!seenInPurge.has(item.id)) { seenInPurge.add(item.id); entrySequence.push(item.id) }
      }
    }
    state = engine.getState()
    expect(state.returnSystem.activePurgeBatch).toBeNull()
    expect(state.returnSystem.lastCompletedPurgeBatch).toMatchObject({ authorizedCount: 6, divertedCount: 6, enteredPurgeCount: 6, enteredXCount: 6, exitedXCount: 6, status: 'COMPLETE' })
    expect(state.returnSystem.lastCompletedPurgeBatch?.authorizedTrayIds).toEqual([12, 11, 10, 9, 8, 7])
    expect(state.returnSystem.lastCompletedPurgeBatch?.authorizedTrayIds).not.toContain(21)
    expect(newcomerEnteredTDuringDiversion).toBe(true)
    expect([...observedBatchIds]).toEqual([1])
    expect(entrySequence).toEqual([12, 11, 10, 9, 8, 7])
    expect(new Set(entrySequence).size).toBe(6)
    expect(state.trays.filter((tray) => tray.purgeMember || tray.tPurgeBatchId !== undefined)).toEqual([])
    for (const id of [12, 11, 10, 9, 8, 7]) expect(state.trays.find((tray) => tray.id === id)?.zonePlacement?.conveyorId).not.toBe('D')
    assertPhysical(state)
  })

  test('default six-tray batches overlap through public advancement with independent frozen ownership', () => {
    const engine = createEngine()
    // Keep D blocked by disabling Korber, and defer replenishment beyond this trace.
    // Geometry and the default 6/6 purge settings are supplied by the real engine.
    engine.startScenario({ ...engine.getOperatingSettings(), korberEnabled: false }, 1000)
    const runtime = runtimeOf(engine)
    const earlyArrival = zoned(13, 'PRE_T', 5)
    earlyArrival.sourceGrantId = 77
    // The second arrival must traverse A1's downstream MDR bank and PRE_T,
    // so it reaches T after batch 2 freezes, without injecting a tray mid-run.
    const laterArrival: Tray = {
      id: 14, currentSegmentId: 'A1', positionFt: 67.25, status: 'BLOCKED',
      createdAtSec: 0, originSourceId: 'A', loadState: 'EMPTY',
      pilePlacement: { pileId: 'A1', component: 'MDR_DOWNSTREAM', zoneIndex: 0 },
    }
    runtime.trays = [
      ...Array.from({ length: 12 }, (_, zone) => zoned(zone + 1, 'T', zone)),
      ...Array.from({ length: 92 }, (_, zone) => zoned(100 + zone, 'D', zone)),
      ...Array.from({ length: 28 }, (_, zone) => zoned(200 + zone, 'E', zone, 'FULL')),
      earlyArrival, laterArrival,
    ]
    runtime.missions = []
    runtime.totalTraysCreated = runtime.trays.length
    runtime.activeSourceGrant = {
      grantId: 77, source: 'A', releasedCount: 1, enteredTCount: 0,
      startedAtSec: 0, expiresAtSec: 60, drainingStartedAtSec: null,
      completedAtSec: null, phase: 'ACTIVE', selectionReason: 'POSITIVE_PURGE_DEMAND',
      purgeDemandExecution: { requestedCount: 2, satisfiedCount: 1, requestedAtSec: 0, completedAtSec: null, outcome: null },
    }
    // Setup ends here: no repositioning, private controller calls, or state writes below.
    let prior = engine.getState()
    expect(prior.srsControl.tPurgeSettings).toEqual({ backupTrigger: 6, purgeQuantity: 6 })
    assertPhysical(prior)
    const frozen = [[12, 11, 10, 9, 8, 7], [6, 5, 4, 3, 2, 1]]
    expect(new Set(frozen.flat()).size).toBe(12)
    type Crossing = { id: number; batchId: number; time: number }
    const diverted: Crossing[] = []
    const enteredX: Crossing[] = []
    const exitedX: Crossing[] = []
    const allXEntries: number[] = []
    const allXExits: number[] = []
    const deferrals = [0, 0]
    const authorizationTimes = new Map<number, number>()
    const completedHistory = new Map<number, string>()
    const arrivals = new Map<number, number>()
    let overlapObserved = false
    let completedTicks = 0
    for (let tick = 0; tick < 1200; tick++) {
      engine.step(0.1)
      const state = engine.getState()
      assertPhysical(state)
      const previousById = new Map(prior.trays.map((tray) => [tray.id, tray]))
      for (const tray of state.trays) {
        const previous = previousById.get(tray.id)!
        const before = routeOf(previous)
        const after = routeOf(tray)
        if (before === 'PRE_T' && after === 'T') {
          arrivals.set(tray.id, state.timeSec)
          expect(state.timeSec).toBeGreaterThan(authorizationTimes.get(1)!)
        }
        if (tray.id === 13 || tray.id === 14) {
          expect(tray.tPurgeBatchId).toBeUndefined()
          expect(tray.purgeMember).not.toBe(true)
        }
        if (before === 'T' && after === 'PURGE') {
          expect(tray.tPurgeBatchId).toBe(tray.id >= 7 ? 1 : 2)
          diverted.push({ id: tray.id, batchId: tray.tPurgeBatchId!, time: state.timeSec })
        }
        if (before !== 'X' && after === 'X') {
          allXEntries.push(tray.id)
          const waitingPurge = state.trays.find((item) => item.zonePlacement?.conveyorId === 'PURGE' && item.zonePlacement.zoneIndex === 11)
          if (before === 'E' && waitingPurge) deferrals[waitingPurge.tPurgeBatchId! - 1] += 1
          if (before === 'PURGE') {
            // E cannot remain eligible when PURGE wins the open X entrance.
            expect(state.trays.some((item) => item.zonePlacement?.conveyorId === 'E' && item.zonePlacement.zoneIndex === 27)).toBe(false)
            expect(tray.tPurgeBatchId).toBe(previous.tPurgeBatchId)
            enteredX.push({ id: tray.id, batchId: tray.tPurgeBatchId!, time: state.timeSec })
          }
        }
        if (before === 'X' && after !== 'X') {
          allXExits.push(tray.id)
          if (previous.tPurgeBatchId !== undefined) {
            exitedX.push({ id: tray.id, batchId: previous.tPurgeBatchId, time: state.timeSec })
            expect(tray.tPurgeBatchId).toBeUndefined()
            expect(tray.purgeMember).toBe(false)
          }
        }
      }
      expect(allXExits).toEqual(allXEntries.slice(0, allXExits.length))
      const batches = [...state.returnSystem.inFlightPurgeBatches, ...state.returnSystem.completedPurgeBatches]
      expect(new Set(batches.map(({ batchId }) => batchId)).size).toBe(batches.length)
      expect(batches.length).toBeLessThanOrEqual(2)
      for (const batch of batches) {
        expect([1, 2]).toContain(batch.batchId)
        expect(batch.authorizedTrayIds).toEqual(frozen[batch.batchId - 1])
        expect(batch.authorizedCount).toBe(6)
        const count = (events: Crossing[]) => events.filter(({ batchId }) => batchId === batch.batchId).length
        expect(batch.divertedCount).toBe(count(diverted))
        expect(batch.enteredPurgeCount).toBe(count(diverted))
        expect(batch.enteredXCount).toBe(count(enteredX))
        expect(batch.exitedXCount).toBe(count(exitedX))
        expect(batch.purgeEPriorityDeferralCount).toBe(deferrals[batch.batchId - 1])
        if (!authorizationTimes.has(batch.batchId)) {
          authorizationTimes.set(batch.batchId, batch.authorizedAtSec)
          expect(state.trays.some((tray) => tray.zonePlacement?.conveyorId === 'D' && tray.zonePlacement.zoneIndex === 0)).toBe(true)
          if (batch.batchId === 2) {
            const first = state.returnSystem.inFlightPurgeBatches.find(({ batchId }) => batchId === 1)!
            expect(first).toMatchObject({ enteredPurgeCount: 6, phase: 'RETURNING_THROUGH_X', status: 'ACTIVE', completedAtSec: null })
            expect(first.exitedXCount).toBeLessThan(6)
            expect(first.diversionCompletedAtSec).toBeLessThanOrEqual(batch.authorizedAtSec)
            expect(state.returnSystem.completedPurgeBatches).toEqual([])
            overlapObserved = true
          }
        }
        expect(batch.authorizedAtSec).toBe(authorizationTimes.get(batch.batchId))
        if (batch.enteredPurgeCount < 6) {
          expect(batch.phase).toBe(batch.enteredPurgeCount ? 'DIVERTING_TO_PURGE' : 'AUTHORIZED')
          expect(state.returnSystem.activePurgeBatch?.batchId).toBe(batch.batchId)
          expect(batch.diversionCompletedAtSec).toBeNull()
        } else {
          expect(state.returnSystem.activePurgeBatch?.batchId).not.toBe(batch.batchId)
          expect(batch.diversionCompletedAtSec).toBe(diverted.filter(({ batchId }) => batchId === batch.batchId).at(-1)!.time)
          expect(batch.phase).toBe(batch.exitedXCount === 6 ? 'COMPLETE' : 'RETURNING_THROUGH_X')
        }
        expect(batch.status).toBe(batch.exitedXCount === 6 ? 'COMPLETE' : 'ACTIVE')
        if (batch.status === 'COMPLETE') {
          expect(batch.completedAtSec).toBe(exitedX.filter(({ batchId }) => batchId === batch.batchId).at(-1)!.time)
          expect(batch.purgeStarvedBehindE).toBe(false)
          if (!completedHistory.has(batch.batchId)) completedHistory.set(batch.batchId, JSON.stringify(batch))
          expect(JSON.stringify(batch)).toBe(completedHistory.get(batch.batchId))
        } else expect(batch.completedAtSec).toBeNull()
        for (const id of batch.authorizedTrayIds) {
          const tray = state.trays.find((item) => item.id === id)
          const hasExited = exitedX.some((event) => event.id === id)
          if (!hasExited) expect(tray).toMatchObject({ tPurgeBatchId: batch.batchId, purgeMember: true })
          else if (tray) expect(tray.tPurgeBatchId).toBeUndefined()
        }
      }
      prior = state
      // Keep evaluating the unchanged trigger after completion to catch reauthorization.
      if (state.returnSystem.completedPurgeBatches.length === 2 && ++completedTicks === 30) break
    }
    expect(overlapObserved).toBe(true)
    expect(completedTicks).toBe(30)
    expect([...arrivals.keys()].sort()).toEqual([13, 14])
    expect(arrivals.get(14)).toBeGreaterThan(authorizationTimes.get(2)!)
    for (const events of [diverted, enteredX, exitedX]) {
      expect(events.map(({ id }) => id)).toEqual(frozen.flat())
      expect(events.map(({ batchId }) => batchId)).toEqual([...Array(6).fill(1), ...Array(6).fill(2)])
      expect(new Set(events.map(({ id }) => id)).size).toBe(12)
    }
    expect(deferrals[0]).toBeGreaterThan(0)
    expect(prior.returnSystem.completedPurgeBatches.map(({ batchId }) => batchId)).toEqual([1, 2])
    expect(prior.returnSystem.lastCompletedPurgeBatch).toEqual(prior.returnSystem.completedPurgeBatches[1])
    expect(prior.returnSystem.inFlightPurgeBatches).toEqual([])
    expect(prior.returnSystem.activePurgeBatch).toBeNull()
    expect(prior.trays.filter((tray) => tray.purgeMember || tray.tPurgeBatchId !== undefined)).toEqual([])
    expect(prior.srsControl.tBypassBatch).toMatchObject({ inFlightBatchIds: [], completedBatchCount: 2 })
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

  test('sorter remains cursor-first regardless of assignment totals and unavailable inspections', () => {
    const engine = createEngine()
    const runtime = runtimeOf(engine)
    runtime.trays = []
    runtime.totalTraysCreated = 0

    // Historical totals are diagnostics only and must never influence routing.
    runtime.returnAssignments.A2.EMPTY = 100
    runtime.returnAssignments.B2.EMPTY = 0
    runtime.returnAssignments.C2.EMPTY = 50
    const first = zoned(1, 'X', 3)
    runtime.trays = [first]
    runtime.totalTraysCreated = 1
    runtime.processReturnBoundaries()
    expect(first.returnDestination).toBe('A2')
    expect(runtime.sorterCursor).toBe('B2')

    // With every path unavailable, inspection does not advance the cursor.
    runtime.trays = [
      zoned(2, 'X', 3),
      zoned(3, 'S', 0),
      inbound(4, 'C2', 'MDR_SORTER_SIDE', 0),
    ]
    runtime.totalTraysCreated = 4
    runtime.processReturnBoundaries()
    expect(runtime.trays.find(({ id }) => id === 2)?.returnDestination).toBeUndefined()
    expect(runtime.sorterCursor).toBe('B2')

    // B2 is first from the cursor once S opens; the successful selection—not
    // either unavailable inspection above—advances the cursor to C2.
    runtime.trays = runtime.trays.filter(({ id }) => id !== 3)
    runtime.processReturnBoundaries()
    expect(runtime.trays.find(({ id }) => id === 2)?.returnDestination).toBe('B2')
    expect(runtime.sorterCursor).toBe('C2')

    runtime.trays = []
    const c = zoned(5, 'X', 3)
    runtime.trays.push(c)
    runtime.processReturnBoundaries()
    expect(c.returnDestination).toBe('C2')
    expect(runtime.sorterCursor).toBe('A2')

    // A2, which was unavailable during the earlier inspection, re-enters at
    // its normal cursor position when it becomes available.
    runtime.trays = []
    const a = zoned(6, 'X', 3)
    runtime.trays.push(a)
    runtime.processReturnBoundaries()
    expect(a.returnDestination).toBe('A2')
    expect(runtime.sorterCursor).toBe('B2')

    engine.reset()
    expect(engine.getState().returnSystem.sorterCursor).toBe('A2')
    engine.startScenario(engine.getOperatingSettings(), 10)
    expect(engine.getState().returnSystem.sorterCursor).toBe('A2')
    assertPhysical(engine.getState())
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
    const assigned = Object.values(prior.returnSystem.assignments).reduce((total, counts) => total + counts.EMPTY + counts.FULL, 0)
    expect(assigned + prior.returnSystem.conveyorOccupancy.X).toBe(prior.returnSystem.mergeCounts.eToXFull + prior.returnSystem.mergeCounts.purgeToXEmpty)
    engine.reset()
    const resetA = engine.getState()
    engine.step(10)
    engine.reset()
    expect(engine.getState()).toEqual(resetA)
  }, 120_000)
})
