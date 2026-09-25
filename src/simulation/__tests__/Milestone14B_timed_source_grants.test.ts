import { describe, expect, test } from 'vitest'
import SimulationEngine from '../SimulationEngine'
import type { PurgeBatchState, SourceId, SourceReleaseGrantState, Tray } from '../types'

const SEGMENTS = [['A1',103.5,45],['B1',86,38],['C1',86,38],['PRE_T',15,6],['T',30,12],['D',230,92],['PURGE',30,12],['E',70,28],['X',10,4],['S',20,8],['A2',136,58],['B2',118.5,51],['C2',118.5,51],['CARTBUILD_A',75,30],['CARTBUILD_B',75,30],['CARTBUILD_C',75,30]].map(([id,lengthFt,maxOccupancy]) => ({ id: String(id), lengthFt: Number(lengthFt), speedFtPerMin: 120, maxOccupancy: Number(maxOccupancy) }))
type Runtime = {
  timeSec: number; trays: Tray[]; sourceGrantCursor: SourceId; sourceGrantCounter: number; activeSourceGrant: SourceReleaseGrantState | null; lastCompletedSourceGrant: SourceReleaseGrantState | null; activePurgeBatch: PurgeBatchState | null
  missions: Array<{ missionId: number; assignedExchanger: SourceId; missionType: 'EMPTY'; createdAtSec: number; readyAtSec: number; state: 'RETRIEVING' }>
  authorizeSourceGrantIfPossible: () => void; releaseActiveSourceTray: () => void; synchronizeSourceGrant: () => void; processZonedBoundaries: () => void
}
const runtimeOf = (engine: SimulationEngine) => (engine as unknown as { milestone7: Runtime }).milestone7
const pile = (id: number, source: SourceId, zoneIndex: number): Tray => ({ id, currentSegmentId: `${source}1`, positionFt: (zoneIndex + 0.5) * 2.5, status: 'BLOCKED', createdAtSec: 0, originSourceId: source, loadState: 'EMPTY', pilePlacement: { pileId: `${source}1`, component: 'MDR_DOWNSTREAM', zoneIndex } })
const zoned = (id: number, conveyorId: 'PRE_T' | 'T' | 'D' | 'PURGE', zoneIndex: number): Tray => ({ id, currentSegmentId: conveyorId, positionFt: (zoneIndex + 0.5) * 2.5, status: 'BLOCKED', createdAtSec: 0, originSourceId: 'A', loadState: 'EMPTY', zonePlacement: { conveyorId, zoneIndex } })
const purge = (at: number): PurgeBatchState => ({ batchId: 1, authorizedTrayIds: [900], authorizedCount: 1, divertedCount: 0, enteredPurgeCount: 0, authorizedAtSec: at, completedAtSec: null, status: 'ACTIVE', phase: 'AUTHORIZED', diversionCompletedAtSec: null, enteredXCount: 0, exitedXCount: 0, purgeStarvedBehindE: false, purgeEPriorityDeferralCount: 0 })
const isolated = (windowSec = 10) => {
  const engine = new SimulationEngine(SEGMENTS); engine.startScenario(engine.getOperatingSettings(), 10, undefined, windowSec)
  const runtime = runtimeOf(engine); runtime.trays = [pile(1, 'A', 14)]; runtime.activeSourceGrant = null; runtime.lastCompletedSourceGrant = null; runtime.sourceGrantCursor = 'A'
  return { engine, runtime }
}

describe('Milestone 14B timed source grants', () => {
  test('starts exactly and prohibits a departure at the exclusive expiry', () => {
    const { engine, runtime } = isolated(0.1)
    runtime.authorizeSourceGrantIfPossible(); const grant = runtime.activeSourceGrant!
    expect(grant).toMatchObject({ startedAtSec: 0, expiresAtSec: 0.1, phase: 'ACTIVE' })
    runtime.timeSec = 0.1; runtime.synchronizeSourceGrant(); runtime.releaseActiveSourceTray()
    expect(grant).toMatchObject({ phase: 'DRAINING', releasedCount: 0 })
    expect(engine.getState().lastCompletedSourceGrant).toMatchObject({ source: 'A', completedAtSec: 0.1 })
    expect(runtime).toMatchObject({ sourceGrantCursor: 'B', sourceGrantCounter: 1 })
    runtime.synchronizeSourceGrant()
    expect(runtime).toMatchObject({ sourceGrantCursor: 'B', sourceGrantCounter: 1 })
  })

  test('permits a physically legal departure immediately before exclusive expiry', () => {
    const { runtime } = isolated(1)
    runtime.authorizeSourceGrantIfPossible()
    const grantId = runtime.activeSourceGrant!.grantId
    runtime.timeSec = 1 - 1e-6
    runtime.releaseActiveSourceTray()
    expect(runtime.activeSourceGrant).toMatchObject({ grantId, phase: 'ACTIVE', releasedCount: 1 })
    expect(runtime.trays.find((tray) => tray.id === 1)).toMatchObject({ sourceGrantId: grantId, zonePlacement: { conveyorId: 'PRE_T', zoneIndex: 0 } })
  })

  test('a public step crossing expiry gives equivalent outcomes across partitions', () => {
    const run = (steps: number[]) => { const { engine } = isolated(0.35); for (const step of steps) engine.step(step); const state = engine.getState(); return { time: state.timeSec, last: state.lastCompletedSourceGrant, preT: state.trays.filter((tray) => tray.zonePlacement?.conveyorId === 'PRE_T').map((tray) => tray.id) } }
    expect(run([0.6])).toEqual(run([0.1, 0.1, 0.1, 0.1, 0.1, 0.1]))
  })

  test('ordinary blockage consumes time and creates no catch-up departure', () => {
    const { engine, runtime } = isolated(1)
    runtime.trays.push(zoned(9, 'PRE_T', 0)); runtime.authorizeSourceGrantIfPossible()
    engine.step(1)
    expect(engine.getState().lastCompletedSourceGrant).toMatchObject({ releasedCount: 0 })
    runtime.trays = runtime.trays.filter((tray) => tray.id !== 9)
    engine.step(0.1)
    const state = engine.getState()
    expect(state.trays.find((tray) => tray.id === 1)?.zonePlacement?.conveyorId).toBe('PRE_T')
    expect(state.activeSourceGrant?.releasedCount).toBe(1)
  })

  test('clearing ordinary blockage cannot restart or extend the expired grant', () => {
    const { engine, runtime } = isolated(0.5)
    runtime.trays.push(zoned(9, 'PRE_T', 0)); runtime.authorizeSourceGrantIfPossible()
    const grantId = runtime.activeSourceGrant!.grantId
    engine.step(0.5)
    expect(runtime.lastCompletedSourceGrant).toMatchObject({ grantId, releasedCount: 0, completedAtSec: 0.5 })
    runtime.trays = runtime.trays.filter((tray) => tray.id !== 9)
    expect(runtime.lastCompletedSourceGrant?.expiresAtSec).toBe(0.5)
    expect(runtime.activeSourceGrant?.grantId).not.toBe(grantId)
    expect(runtime.lastCompletedSourceGrant?.grantId).toBe(grantId)
  })

  test('T remaining full for an entire C grant consumes the window', () => {
    const { engine, runtime } = isolated(0.5)
    runtime.trays = [pile(1, 'C', 7)]; runtime.sourceGrantCursor = 'C'; runtime.authorizeSourceGrantIfPossible()
    runtime.trays.push(...Array.from({ length: 12 }, (_, index) => zoned(100 + index, 'T', index)))
    engine.step(0.5)
    expect(runtime.lastCompletedSourceGrant).toMatchObject({ source: 'C', releasedCount: 0, completedAtSec: 0.5 })
    expect(runtime.trays.find((tray) => tray.id === 1)?.pilePlacement?.pileId).toBe('C1')
  })

  test('bypass starting mid-grant leaves the original deadline authoritative', () => {
    const { runtime } = isolated(10); runtime.authorizeSourceGrantIfPossible()
    runtime.timeSec = 2; runtime.activePurgeBatch = purge(2); runtime.synchronizeSourceGrant()
    expect(runtime.activeSourceGrant?.expiresAtSec).toBe(10)
    runtime.timeSec = 9; runtime.activePurgeBatch = null; runtime.synchronizeSourceGrant()
    expect(runtime.activeSourceGrant).toMatchObject({ phase: 'ACTIVE', expiresAtSec: 10 })
  })

  test('bypass beginning at expiry cannot revive an expired grant', () => {
    const { runtime } = isolated(1); runtime.authorizeSourceGrantIfPossible(); runtime.timeSec = 1
    runtime.activePurgeBatch = purge(1)
    runtime.synchronizeSourceGrant()
    expect(runtime.activeSourceGrant).toBeNull()
    expect(runtime.lastCompletedSourceGrant).toMatchObject({ releasedCount: 0 })
  })

  test('expiry during bypass stops departures and bypass completion cannot revive the grant', () => {
    const { runtime } = isolated(1); runtime.authorizeSourceGrantIfPossible(); const grantId = runtime.activeSourceGrant!.grantId
    runtime.activePurgeBatch = purge(0.25); runtime.timeSec = 1; runtime.synchronizeSourceGrant(); runtime.releaseActiveSourceTray()
    expect(runtime.lastCompletedSourceGrant).toMatchObject({ grantId, releasedCount: 0, expiresAtSec: 1 })
    runtime.activePurgeBatch = null; runtime.timeSec = 2; runtime.synchronizeSourceGrant(); runtime.releaseActiveSourceTray()
    expect(runtime.trays.find((tray) => tray.id === 1)?.pilePlacement?.pileId).toBe('A1')
  })

  test.each(['A', 'B', 'C'] as const)('%s selection and a physically legal departure can occur during bypass', (source) => {
    const { runtime } = isolated(10)
    runtime.trays = [pile(1, source, source === 'A' ? 14 : 7)]; runtime.sourceGrantCursor = source; runtime.activePurgeBatch = purge(0)
    runtime.authorizeSourceGrantIfPossible(); runtime.releaseActiveSourceTray()
    expect(runtime.activeSourceGrant).toMatchObject({ source, releasedCount: 1, expiresAtSec: 10 })
    expect(runtime.trays.find((tray) => tray.id === 1)?.zonePlacement).toEqual({ conveyorId: source === 'C' ? 'T' : 'PRE_T', zoneIndex: 0 })
  })

  test('new arrivals join ACTIVE and successful departures alone receive ownership', () => {
    const { runtime } = isolated(10); runtime.authorizeSourceGrantIfPossible(); runtime.releaseActiveSourceTray()
    expect(runtime.activeSourceGrant?.releasedCount).toBe(1)
    const arrival = pile(2, 'A', 14); runtime.trays.push(arrival); runtime.processZonedBoundaries(); runtime.releaseActiveSourceTray()
    expect(runtime.activeSourceGrant?.releasedCount).toBe(1)
    expect(arrival.sourceGrantId).toBeUndefined()
    runtime.trays = runtime.trays.filter((tray) => tray.id !== 1); runtime.releaseActiveSourceTray()
    expect(runtime.activeSourceGrant?.releasedCount).toBe(2)
    expect(arrival.sourceGrantId).toBe(runtime.activeSourceGrant?.grantId)
  })

  test('A ownership drains PRE_T after expiry; C direct entry reconciles immediately', () => {
    const { runtime } = isolated(1); runtime.authorizeSourceGrantIfPossible(); runtime.releaseActiveSourceTray(); const aGrant = runtime.activeSourceGrant!
    runtime.timeSec = 1; runtime.synchronizeSourceGrant(); expect(aGrant.phase).toBe('DRAINING')
    const released = runtime.trays.find((tray) => tray.sourceGrantId === aGrant.grantId)!; released.zonePlacement!.zoneIndex = 5
    runtime.processZonedBoundaries(); expect(runtime.activeSourceGrant).toBeNull(); expect(released.sourceGrantId).toBeUndefined()

    runtime.trays = [pile(3, 'C', 7)]; runtime.sourceGrantCursor = 'C'; runtime.authorizeSourceGrantIfPossible(); runtime.releaseActiveSourceTray()
    expect(runtime.activeSourceGrant).toMatchObject({ releasedCount: 1, enteredTCount: 1 })
  })

  test('DRAINING never restores departure permission', () => {
    const { runtime } = isolated(1)
    runtime.authorizeSourceGrantIfPossible(); runtime.releaseActiveSourceTray()
    runtime.trays.push(pile(2, 'A', 14)); runtime.timeSec = 1; runtime.synchronizeSourceGrant()
    expect(runtime.activeSourceGrant).toMatchObject({ phase: 'DRAINING', releasedCount: 1 })
    runtime.releaseActiveSourceTray()
    expect(runtime.activeSourceGrant).toMatchObject({ phase: 'DRAINING', releasedCount: 1 })
    expect(runtime.trays.find((tray) => tray.id === 2)?.sourceGrantId).toBeUndefined()
  })

  test.each(['A', 'B'] as const)('%s PRE_T draining completes during bypass and permits handoff', (source) => {
    const { runtime } = isolated(1)
    runtime.trays = [pile(1, source, source === 'A' ? 14 : 7)]; runtime.sourceGrantCursor = source
    runtime.authorizeSourceGrantIfPossible(); runtime.releaseActiveSourceTray(); const grantId = runtime.activeSourceGrant!.grantId
    runtime.timeSec = 1; runtime.synchronizeSourceGrant()
    const released = runtime.trays.find((tray) => tray.sourceGrantId === grantId)!
    released.zonePlacement!.zoneIndex = 5
    runtime.activePurgeBatch = purge(1)
    runtime.synchronizeSourceGrant(); runtime.processZonedBoundaries()
    expect(runtime.activeSourceGrant).toBeNull()
    expect(runtime.lastCompletedSourceGrant).toMatchObject({ grantId, source, releasedCount: 1, enteredTCount: 1 })
    expect(released.sourceGrantId).toBeUndefined()
    runtime.trays.push(pile(2, source === 'A' ? 'B' : 'C', source === 'A' ? 7 : 7))
    runtime.authorizeSourceGrantIfPossible()
    expect(runtime.activeSourceGrant?.grantId).toBe(grantId + 1)
  })

  test('an extended PRE_T blockage drains without controller deadlock once T reopens', () => {
    const { runtime } = isolated(0.2)
    runtime.authorizeSourceGrantIfPossible(); runtime.releaseActiveSourceTray(); const grantId = runtime.activeSourceGrant!.grantId
    const released = runtime.trays.find((tray) => tray.sourceGrantId === grantId)!; released.zonePlacement!.zoneIndex = 5
    runtime.trays.push(zoned(99, 'T', 0)); runtime.timeSec = 20; runtime.synchronizeSourceGrant()
    expect(runtime.activeSourceGrant).toMatchObject({ grantId, phase: 'DRAINING', enteredTCount: 0 })
    runtime.trays = runtime.trays.filter((tray) => tray.id !== 99); runtime.processZonedBoundaries()
    expect(runtime.activeSourceGrant).toBeNull()
    expect(runtime.lastCompletedSourceGrant).toMatchObject({ grantId, enteredTCount: 1 })
  })

  test.each([
    ['MDR_PRE_DETRAYER', { zoneIndex: 0 }],
    ['BELT', { beltPosFt: 20.5 }],
    ['MDR_POST_DETRAYER', { zoneIndex: 0 }],
  ] as const)('%s occupancy prevents false true-empty completion and a later arrival needs a new grant', (component, position) => {
    const { runtime } = isolated(10)
    const resident = runtime.trays[0]
    resident.pilePlacement = { pileId: 'A1', component, ...position }
    runtime.authorizeSourceGrantIfPossible(); const firstGrantId = runtime.activeSourceGrant!.grantId
    runtime.synchronizeSourceGrant()
    expect(runtime.activeSourceGrant).toMatchObject({ grantId: firstGrantId, phase: 'ACTIVE' })
    runtime.trays = []
    runtime.synchronizeSourceGrant()
    expect(runtime.lastCompletedSourceGrant).toMatchObject({ grantId: firstGrantId, releasedCount: 0, enteredTCount: 0 })
    runtime.trays = [pile(2, 'A', 14)]; runtime.authorizeSourceGrantIfPossible()
    expect(runtime.activeSourceGrant!.grantId).toBe(firstGrantId + 1)
  })

  test('a later higher PurgeDemand cannot preempt an ACTIVE owner', () => {
    const { runtime } = isolated(10)
    runtime.missions = []
    runtime.trays.push(pile(2, 'B', 6)); runtime.authorizeSourceGrantIfPossible(); const grantId = runtime.activeSourceGrant!.grantId
    runtime.missions = Array.from({ length: 20 }, (_, index) => ({ missionId: index + 1, assignedExchanger: 'B', missionType: 'EMPTY', createdAtSec: 0, readyAtSec: 180, state: 'RETRIEVING' }))
    runtime.authorizeSourceGrantIfPossible()
    expect(runtime.activeSourceGrant).toMatchObject({ grantId, source: 'A' })
  })

  test('per-departure destination interlocks are reevaluated across opportunities', () => {
    const { runtime } = isolated(10)
    runtime.authorizeSourceGrantIfPossible(); runtime.releaseActiveSourceTray(); const grantId = runtime.activeSourceGrant!.grantId
    const first = runtime.trays.find((tray) => tray.sourceGrantId === grantId)!; runtime.trays.push(pile(2, 'A', 14))
    runtime.releaseActiveSourceTray()
    expect(runtime.activeSourceGrant?.releasedCount).toBe(1)
    expect(runtime.trays.find((tray) => tray.id === 2)?.sourceGrantId).toBeUndefined()
    first.zonePlacement!.zoneIndex = 5; runtime.processZonedBoundaries(); runtime.releaseActiveSourceTray()
    expect(runtime.activeSourceGrant?.releasedCount).toBe(2)
    expect(runtime.trays.find((tray) => tray.id === 2)?.sourceGrantId).toBe(grantId)
  })

  test('candidate rejection and empty inspection leave the controller IDLE without advancing or looping', () => {
    const { runtime } = isolated(10)
    runtime.missions = []; runtime.trays.push(zoned(99, 'D', 0))
    const before = { cursor: runtime.sourceGrantCursor, counter: runtime.sourceGrantCounter }
    for (let attempt = 0; attempt < 10; attempt++) runtime.authorizeSourceGrantIfPossible()
    expect(runtime.activeSourceGrant).toBeNull()
    expect({ cursor: runtime.sourceGrantCursor, counter: runtime.sourceGrantCounter }).toEqual(before)
  })

  test('preserves 1.25-second physical movement and permits more than eight departures in a long window', () => {
    const engine = new SimulationEngine(SEGMENTS); engine.startScenario(engine.getOperatingSettings(), 10, undefined, 30)
    engine.step(30)
    expect(engine.getState().lastCompletedSourceGrant?.releasedCount ?? engine.getState().activeSourceGrant?.releasedCount).toBeGreaterThan(8)
    expect(engine.getState().cartbuildSystem.lanes.CARTBUILD_A.zoneTransferSec).toBe(1.25)
  })
})
