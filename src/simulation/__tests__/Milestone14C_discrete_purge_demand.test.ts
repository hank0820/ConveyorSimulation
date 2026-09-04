import { describe, expect, test } from 'vitest'
import SimulationEngine from '../SimulationEngine'
import type { Mission, PurgeBatchState, SourceId, SourceReleaseGrantState, Tray } from '../types'

const SEGMENTS = [['A1',103.5,45],['B1',86,38],['C1',86,38],['PRE_T',15,6],['T',30,12],['D',230,92],['PURGE',30,12],['E',70,28],['X',10,4],['S',20,8],['A2',136,58],['B2',118.5,51],['C2',118.5,51],['CARTBUILD_A',75,30],['CARTBUILD_B',75,30],['CARTBUILD_C',75,30]].map(([id,lengthFt,maxOccupancy]) => ({ id: String(id), lengthFt: Number(lengthFt), speedFtPerMin: 120, maxOccupancy: Number(maxOccupancy) }))
const zoned = (id: number, conveyorId: 'PRE_T' | 'T' | 'D' | 'PURGE' | 'E' | 'X', zoneIndex: number): Tray => ({ id, currentSegmentId: conveyorId, positionFt: (zoneIndex + 0.5) * 2.5, status: 'BLOCKED', createdAtSec: 0, originSourceId: 'A', loadState: conveyorId === 'E' ? 'FULL' : 'EMPTY', zonePlacement: { conveyorId, zoneIndex } })
const pile = (id: number, source: SourceId, zoneIndex = source === 'A' ? 14 : 7): Tray => ({ id, currentSegmentId: `${source}1`, positionFt: (zoneIndex + 0.5) * 2.5, status: 'BLOCKED', createdAtSec: 0, originSourceId: source, loadState: 'EMPTY', pilePlacement: { pileId: `${source}1`, component: 'MDR_DOWNSTREAM', zoneIndex } })
type Runtime = {
  timeSec: number; trays: Tray[]; missions: Mission[]; activeTargets: Record<string, number>; sourceGrantCursor: SourceId
  purgeBatchCounter: number
  activeSourceGrant: SourceReleaseGrantState | null; lastCompletedSourceGrant: SourceReleaseGrantState | null
  activePurgeBatch: PurgeBatchState | null; lastCompletedPurgeBatch: PurgeBatchState | null
  activeTPurgeSettings: { backupTrigger: number; purgeQuantity: number }
  authorizeSourceGrantIfPossible: () => void; releaseActiveSourceTray: () => void; synchronizeSourceGrant: () => void
  authorizePurgeIfNeeded: () => void; processZonedBoundaries: () => void; processReturnBoundaries: (delta?: number) => void
}
const setup = () => {
  const engine = new SimulationEngine(SEGMENTS)
  engine.startScenario(engine.getOperatingSettings(), 10)
  const runtime = (engine as unknown as { milestone7: Runtime }).milestone7
  runtime.trays = [pile(1, 'A')]
  runtime.missions = []
  runtime.activeSourceGrant = null
  runtime.lastCompletedSourceGrant = null
  runtime.sourceGrantCursor = 'A'
  runtime.activeTargets.A1 = 1
  return { engine, runtime }
}
const pending = (count: number): Mission[] => Array.from({ length: count }, (_, index) => ({ missionId: index + 1, assignedExchanger: 'A', missionType: 'EMPTY', createdAtSec: 0, readyAtSec: 180, state: 'RETRIEVING' }))

describe('Milestone 14C discrete PurgeDemand execution', () => {
  test('equal positive demands follow the round-robin cursor', () => {
    const { runtime } = setup()
    runtime.trays = [pile(1, 'A'), pile(2, 'B')]
    runtime.activeTargets.B1 = 1
    runtime.missions = [
      ...pending(2),
      ...pending(2).map((mission, index) => ({ ...mission, missionId: 10 + index, assignedExchanger: 'B' as const })),
    ]
    runtime.sourceGrantCursor = 'B'
    runtime.authorizeSourceGrantIfPossible()
    expect(runtime.activeSourceGrant).toMatchObject({ source: 'B', selectionReason: 'POSITIVE_PURGE_DEMAND', purgeDemandExecution: { requestedCount: 2 } })
  })

  test.each([['A', 'PRE_T'], ['B', 'PRE_T'], ['C', 'T']] as const)('%s successful source departure credits exactly once before later topology movement', (source, destination) => {
    const { runtime } = setup()
    runtime.trays = [pile(1, source)]
    runtime.activeTargets[`${source}1`] = 1
    runtime.missions = pending(1).map((mission) => ({ ...mission, assignedExchanger: source }))
    runtime.sourceGrantCursor = source
    runtime.authorizeSourceGrantIfPossible()
    runtime.releaseActiveSourceTray()
    expect(runtime.activeSourceGrant?.purgeDemandExecution?.satisfiedCount).toBe(1)
    expect(runtime.trays[0].zonePlacement?.conveyorId).toBe(destination)
    runtime.processZonedBoundaries()
    runtime.processZonedBoundaries()
    expect(runtime.activeSourceGrant?.purgeDemandExecution?.satisfiedCount).toBe(1)
  })

  test('freezes positive demand and credits only successful departures', () => {
    const { runtime } = setup()
    runtime.missions = pending(2)
    runtime.authorizeSourceGrantIfPossible()
    expect(runtime.activeSourceGrant).toMatchObject({ selectionReason: 'POSITIVE_PURGE_DEMAND', purgeDemandExecution: { requestedCount: 2, satisfiedCount: 0, outcome: null } })
    runtime.missions = []
    runtime.trays.push(zoned(90, 'PRE_T', 0), zoned(91, 'D', 0))
    runtime.releaseActiveSourceTray()
    expect(runtime.activeSourceGrant?.purgeDemandExecution?.satisfiedCount).toBe(0)
    runtime.trays = runtime.trays.filter((tray) => tray.id !== 90)
    runtime.releaseActiveSourceTray()
    expect(runtime.activeSourceGrant?.purgeDemandExecution).toMatchObject({ requestedCount: 2, satisfiedCount: 1 })
  })

  test('new arrivals satisfy the frozen count, then D blockage stops ordinary release', () => {
    const { runtime } = setup()
    runtime.missions = pending(1)
    runtime.authorizeSourceGrantIfPossible()
    runtime.trays.push(zoned(90, 'D', 0))
    runtime.releaseActiveSourceTray()
    expect(runtime.activeSourceGrant?.purgeDemandExecution).toMatchObject({ satisfiedCount: 1, outcome: 'SATISFIED', completedAtSec: 0 })
    runtime.trays = runtime.trays.filter((tray) => tray.id !== 1)
    runtime.trays.push(pile(2, 'A'))
    runtime.releaseActiveSourceTray()
    expect(runtime.trays.find((tray) => tray.id === 2)?.pilePlacement?.pileId).toBe('A1')
    runtime.trays = runtime.trays.filter((tray) => tray.id !== 90)
    const released = runtime.trays.find((tray) => tray.id === 1)
    if (released?.zonePlacement) released.zonePlacement.zoneIndex = 1
    runtime.releaseActiveSourceTray()
    expect(runtime.trays.find((tray) => tray.id === 2)?.zonePlacement?.conveyorId).toBe('PRE_T')
    expect(runtime.activeSourceGrant?.purgeDemandExecution?.satisfiedCount).toBe(1)
  })

  test('later live increases and decreases do not resize an active frozen request', () => {
    const { runtime } = setup()
    runtime.missions = pending(2)
    runtime.authorizeSourceGrantIfPossible()
    expect(runtime.activeSourceGrant?.purgeDemandExecution?.requestedCount).toBe(2)
    runtime.missions = pending(8)
    runtime.trays.push(pile(2, 'A', 13))
    expect(runtime.activeSourceGrant?.purgeDemandExecution?.requestedCount).toBe(2)
    runtime.missions = []
    runtime.trays = runtime.trays.filter((tray) => tray.id !== 2)
    expect(runtime.activeSourceGrant?.purgeDemandExecution?.requestedCount).toBe(2)
  })

  test('next arbitration recomputes live demand and completed diagnostics do not control it', () => {
    const { engine, runtime } = setup()
    runtime.missions = pending(1)
    runtime.authorizeSourceGrantIfPossible()
    runtime.releaseActiveSourceTray()
    runtime.synchronizeSourceGrant()
    runtime.trays[0].zonePlacement!.zoneIndex = 5
    runtime.processZonedBoundaries()
    expect(runtime.lastCompletedSourceGrant?.purgeDemandExecution?.requestedCount).toBe(1)
    runtime.trays = [pile(2, 'B')]
    runtime.activeTargets.B1 = 1
    runtime.missions = pending(3).map((mission) => ({ ...mission, assignedExchanger: 'B' as const }))
    runtime.authorizeSourceGrantIfPossible()
    expect(runtime.activeSourceGrant).toMatchObject({ source: 'B', purgeDemandExecution: { requestedCount: 3 } })
    expect(engine.getState().srsControl.sourceGrant).toMatchObject({ activeLane: 'B', purgeDemandRecordKind: 'ACTIVE', purgeDemandRequestedCount: 3 })
  })

  test('records expiry and source-empty outcomes without demand debt', () => {
    let setupResult = setup()
    setupResult.runtime.missions = pending(2)
    setupResult.runtime.authorizeSourceGrantIfPossible()
    setupResult.runtime.timeSec = setupResult.runtime.activeSourceGrant!.expiresAtSec
    setupResult.runtime.synchronizeSourceGrant()
    expect(setupResult.runtime.lastCompletedSourceGrant?.purgeDemandExecution).toMatchObject({ satisfiedCount: 0, outcome: 'EXPIRED_WITH_REMAINDER' })

    setupResult = setup()
    setupResult.runtime.missions = pending(2)
    setupResult.runtime.authorizeSourceGrantIfPossible()
    setupResult.runtime.releaseActiveSourceTray()
    setupResult.runtime.synchronizeSourceGrant()
    expect(setupResult.runtime.activeSourceGrant?.purgeDemandExecution).toMatchObject({ satisfiedCount: 1, outcome: 'SOURCE_EMPTY_WITH_REMAINDER' })
    expect(setupResult.runtime.activeSourceGrant?.phase).toBe('DRAINING')
  })

  test('non-positive selection has no execution record and snapshots are immutable', () => {
    const { engine, runtime } = setup()
    runtime.authorizeSourceGrantIfPossible()
    expect(runtime.activeSourceGrant).toMatchObject({ selectionReason: 'NORMAL', purgeDemandExecution: null })
    const snapshot = engine.getState()
    expect(snapshot.srsControl.sourceGrant.purgeDemandOutcome).toBe('NOT_APPLICABLE')
    snapshot.srsControl.sourceGrant.purgeDemandRequestedCount = 99
    expect(engine.getState().srsControl.sourceGrant.purgeDemandRequestedCount).toBe(0)
  })
})

describe('Milestone 14C observable T-purge batches', () => {
  const arrangeBatch = () => {
    const { engine, runtime } = setup()
    runtime.trays = [zoned(1, 'T', 11), zoned(90, 'D', 0)]
    runtime.activeTPurgeSettings = { backupTrigger: 1, purgeQuantity: 1 }
    runtime.authorizePurgeIfNeeded()
    return { engine, runtime }
  }

  test('requires the entire configured quantity and freezes downstream-most identities', () => {
    const { runtime } = arrangeBatch()
    expect(runtime.activePurgeBatch).toMatchObject({ batchId: 1, authorizedTrayIds: [1], authorizedCount: 1, phase: 'AUTHORIZED' })
    expect(runtime.trays[0]).toMatchObject({ purgeMember: true, tPurgeBatchId: 1 })
    runtime.activePurgeBatch = null
    runtime.activeTPurgeSettings = { backupTrigger: 1, purgeQuantity: 2 }
    runtime.authorizePurgeIfNeeded()
    expect(runtime.activePurgeBatch).toBeNull()
  })

  test('resumes the source after PURGE entry while tracking the batch through X', () => {
    const { engine, runtime } = arrangeBatch()
    runtime.trays.push(pile(2, 'A'))
    runtime.activeSourceGrant = { grantId: 7, source: 'A', releasedCount: 0, enteredTCount: 0, startedAtSec: 0, expiresAtSec: 10, pausedAtSec: 0, remainingSecWhenPaused: 10, drainingStartedAtSec: null, completedAtSec: null, phase: 'ACTIVE', selectionReason: 'NORMAL', purgeDemandExecution: null }
    runtime.processZonedBoundaries()
    runtime.synchronizeSourceGrant()
    expect(runtime.activePurgeBatch?.phase).toBe('RETURNING_THROUGH_X')
    expect(runtime.activeSourceGrant?.pausedAtSec).toBeNull()
    expect(engine.getState().srsControl.tBypassBatch).toMatchObject({ phase: 'RETURNING_THROUGH_X', downstreamRemainingCount: 1, sourceGrantPaused: false })
  })

  test.each(['AUTHORIZED', 'DIVERTING_TO_PURGE', 'RETURNING_THROUGH_X'] as const)('serializes authorization while batch 1 is %s', (phase) => {
    const { runtime } = arrangeBatch()
    runtime.activePurgeBatch!.phase = phase
    runtime.trays.unshift(zoned(2, 'T', 10))
    runtime.authorizePurgeIfNeeded()
    expect(runtime.activePurgeBatch).toMatchObject({ batchId: 1, authorizedTrayIds: [1], phase })
    expect(runtime.purgeBatchCounter).toBe(1)
  })

  test('authorizes a distinct sequential batch only after X completion without mixing history', () => {
    const { engine, runtime } = arrangeBatch()
    runtime.processZonedBoundaries()
    const first = runtime.trays.find((tray) => tray.id === 1)!
    first.zonePlacement = { conveyorId: 'PURGE', zoneIndex: 11 }
    runtime.processReturnBoundaries()
    first.zonePlacement = { conveyorId: 'X', zoneIndex: 3 }
    first.returnDestination = 'C2'
    runtime.processReturnBoundaries()
    const completedOne = engine.getState().returnSystem.lastCompletedPurgeBatch!
    runtime.trays = [zoned(2, 'T', 11), zoned(90, 'D', 0)]
    runtime.authorizePurgeIfNeeded()
    expect(runtime.activePurgeBatch).toMatchObject({ batchId: 2, authorizedTrayIds: [2], phase: 'AUTHORIZED' })
    expect(engine.getState().srsControl.tBypassBatch).toMatchObject({ recordKind: 'ACTIVE', batchId: 2, authorizedTrayIds: [2], enteredCount: 0 })
    expect(completedOne).toMatchObject({ batchId: 1, authorizedTrayIds: [1], phase: 'COMPLETE', enteredPurgeCount: 1, exitedXCount: 1 })
    expect(engine.getState().returnSystem.lastCompletedPurgeBatch).toEqual(completedOne)
  })

  test('E wins each eligible transfer and starvation diagnostics exclude physical X blockage', () => {
    const { engine, runtime } = arrangeBatch()
    runtime.processZonedBoundaries()
    const member = runtime.trays.find((tray) => tray.id === 1)!
    member.zonePlacement = { conveyorId: 'PURGE', zoneIndex: 11 }
    runtime.trays.push(zoned(2, 'E', 27))
    runtime.processReturnBoundaries(0.1)
    expect(runtime.trays.find((tray) => tray.id === 2)?.zonePlacement?.conveyorId).toBe('X')
    expect(member.zonePlacement?.conveyorId).toBe('PURGE')
    expect(engine.getState().srsControl.tBypassBatch).toMatchObject({ purgeStarvedBehindE: true, purgeEPriorityDeferralCount: 1 })
    runtime.processReturnBoundaries(0.1)
    expect(engine.getState().srsControl.tBypassBatch).toMatchObject({ purgeStarvedBehindE: false, purgeEPriorityDeferralCount: 1 })
  })

  test('E-priority deferral count excludes absent PURGE and X blockage and is stable across public step partitions', () => {
    const run = (steps: number[]) => {
      const { engine, runtime } = arrangeBatch()
      runtime.processZonedBoundaries()
      const member = runtime.trays.find((tray) => tray.id === 1)!
      member.zonePlacement = { conveyorId: 'PURGE', zoneIndex: 11 }
      runtime.trays.push(zoned(2, 'E', 27))
      for (const step of steps) engine.step(step)
      return engine.getState().srsControl.tBypassBatch.purgeEPriorityDeferralCount
    }
    expect(run([0.1])).toBe(1)
    expect(run([0.05, 0.05])).toBe(1)

    const { engine, runtime } = arrangeBatch()
    runtime.processZonedBoundaries()
    runtime.trays.push(zoned(3, 'E', 27))
    runtime.processReturnBoundaries()
    expect(engine.getState().srsControl.tBypassBatch.purgeEPriorityDeferralCount).toBe(0)
    const member = runtime.trays.find((tray) => tray.id === 1)!
    member.zonePlacement = { conveyorId: 'PURGE', zoneIndex: 11 }
    runtime.trays.push(zoned(4, 'X', 0))
    runtime.processReturnBoundaries()
    expect(engine.getState().srsControl.tBypassBatch).toMatchObject({ purgeEPriorityDeferralCount: 0, purgeStarvedBehindE: false })
  })

  test('repeated simultaneous E wins accumulate exact opportunity time without changing routing', () => {
    const { engine, runtime } = arrangeBatch()
    runtime.processZonedBoundaries()
    const member = runtime.trays.find((tray) => tray.id === 1)!
    member.zonePlacement = { conveyorId: 'PURGE', zoneIndex: 11 }
    for (let index = 0; index < 100; index++) {
      runtime.trays = runtime.trays.filter((tray) => tray.zonePlacement?.conveyorId !== 'E' && tray.zonePlacement?.conveyorId !== 'X')
      runtime.trays.push(zoned(1000 + index, 'E', 27))
      runtime.processReturnBoundaries()
      expect(member.zonePlacement?.conveyorId).toBe('PURGE')
    }
    expect(engine.getState().srsControl.tBypassBatch).toMatchObject({ purgeEPriorityDeferralCount: 100, purgeStarvedBehindE: true, enteredXCount: 0 })
    runtime.trays = runtime.trays.filter((tray) => tray.zonePlacement?.conveyorId !== 'E' && tray.zonePlacement?.conveyorId !== 'X')
    runtime.processReturnBoundaries()
    expect(member.zonePlacement?.conveyorId).toBe('X')
    expect(engine.getState().srsControl.tBypassBatch.purgeStarvedBehindE).toBe(false)
  })

  test('multiple E admissions interleave between purge members without reserving X ownership', () => {
    const { runtime } = setup()
    const first = zoned(1, 'PURGE', 11); first.purgeMember = true; first.tPurgeBatchId = 1
    const second = zoned(2, 'PURGE', 10); second.purgeMember = true; second.tPurgeBatchId = 1
    runtime.trays = [first, second, zoned(10, 'E', 27)]
    runtime.activePurgeBatch = { batchId: 1, authorizedTrayIds: [1, 2], authorizedCount: 2, divertedCount: 2, enteredPurgeCount: 2, authorizedAtSec: 0, completedAtSec: null, status: 'ACTIVE', phase: 'RETURNING_THROUGH_X', diversionCompletedAtSec: 0, enteredXCount: 0, exitedXCount: 0, purgeStarvedBehindE: false, purgeEPriorityDeferralCount: 0 }
    runtime.processReturnBoundaries()
    expect(runtime.trays.find((tray) => tray.id === 10)?.zonePlacement?.conveyorId).toBe('X')
    runtime.trays = runtime.trays.filter((tray) => tray.id !== 10)
    runtime.processReturnBoundaries()
    expect(first.zonePlacement?.conveyorId).toBe('X')
    first.zonePlacement = { conveyorId: 'X', zoneIndex: 3 }; first.returnDestination = 'C2'
    second.zonePlacement = { conveyorId: 'PURGE', zoneIndex: 11 }
    runtime.trays.push(zoned(11, 'E', 27))
    runtime.processReturnBoundaries()
    expect(runtime.trays.find((tray) => tray.id === 11)?.zonePlacement?.conveyorId).toBe('X')
    expect(second.zonePlacement?.conveyorId).toBe('PURGE')
    runtime.trays = runtime.trays.filter((tray) => tray.id !== 11)
    runtime.processReturnBoundaries()
    expect(second.zonePlacement?.conveyorId).toBe('X')
    expect(runtime.activePurgeBatch).toMatchObject({ enteredXCount: 2, exitedXCount: 1, purgeStarvedBehindE: false })
  })

  test('completes only after every frozen member exits X and retains history', () => {
    const { engine, runtime } = arrangeBatch()
    runtime.processZonedBoundaries()
    const member = runtime.trays.find((tray) => tray.id === 1)!
    member.zonePlacement = { conveyorId: 'PURGE', zoneIndex: 11 }
    runtime.processReturnBoundaries(0.1)
    expect(runtime.activePurgeBatch).toMatchObject({ enteredXCount: 1, exitedXCount: 0, status: 'ACTIVE' })
    member.zonePlacement = { conveyorId: 'X', zoneIndex: 3 }
    member.returnDestination = 'C2'
    runtime.processReturnBoundaries(0.1)
    expect(runtime.activePurgeBatch).toBeNull()
    expect(runtime.lastCompletedPurgeBatch).toMatchObject({ batchId: 1, enteredXCount: 1, exitedXCount: 1, phase: 'COMPLETE', status: 'COMPLETE' })
    expect(engine.getState().srsControl.tBypassBatch).toMatchObject({ phase: 'COMPLETE', downstreamRemainingCount: 0 })
  })

  test.each(['AUTHORIZED', 'DIVERTING_TO_PURGE', 'RETURNING_THROUGH_X', 'COMPLETE'] as const)('Reset and equivalent Start Scenario clear %s batch transients and restore batch ID baseline', (phase) => {
    const { engine, runtime } = arrangeBatch()
    runtime.activePurgeBatch!.phase = phase === 'COMPLETE' ? 'RETURNING_THROUGH_X' : phase
    runtime.activePurgeBatch!.purgeEPriorityDeferralCount = 24
    runtime.activePurgeBatch!.purgeStarvedBehindE = true
    if (phase === 'COMPLETE') {
      const member = runtime.trays.find((tray) => tray.id === 1)!
      member.zonePlacement = { conveyorId: 'X', zoneIndex: 3 }
      member.returnDestination = 'C2'
      runtime.activePurgeBatch!.enteredPurgeCount = 1
      runtime.activePurgeBatch!.enteredXCount = 1
      runtime.processReturnBoundaries()
    }
    engine.reset()
    const reset = engine.getState()
    expect(reset.returnSystem).toMatchObject({ activePurgeBatch: null, lastCompletedPurgeBatch: null })
    expect(reset.srsControl.tBypassBatch).toMatchObject({ recordKind: 'NONE', batchId: null, authorizedTrayIds: [], enteredCount: 0, enteredXCount: 0, exitedXCount: 0, purgeEPriorityDeferralCount: 0, purgeStarvedBehindE: false, sourceGrantPaused: false })
    expect(reset.trays.some((tray) => tray.tPurgeBatchId !== undefined)).toBe(false)
    expect(runtime.purgeBatchCounter).toBe(0)
    engine.startScenario(engine.getOperatingSettings(), 10)
    expect(engine.getState().srsControl.tBypassBatch).toEqual(reset.srsControl.tBypassBatch)
  })
})
