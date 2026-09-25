import { describe, expect, test } from 'vitest'
import SimulationEngine from '../SimulationEngine'
import type { PurgeBatchState, SourceReleaseGrantState, TPurgeSettings, Tray } from '../types'

const SEGMENTS = [['A1',103.5,45],['B1',86,38],['C1',86,38],['PRE_T',15,6],['T',30,12],['D',230,92],['PURGE',30,12],['E',70,28],['X',10,4],['S',20,8],['A2',136,58],['B2',118.5,51],['C2',118.5,51],['CARTBUILD_A',75,30],['CARTBUILD_B',75,30],['CARTBUILD_C',75,30]].map(([id,lengthFt,maxOccupancy]) => ({ id: String(id), lengthFt: Number(lengthFt), speedFtPerMin: 120, maxOccupancy: Number(maxOccupancy) }))
const SETTINGS = { korberEnabled: true, cartbuildAEnabled: true, cartbuildBEnabled: true, cartbuildCEnabled: true }
const zoned = (id: number, conveyorId: 'PRE_T' | 'T' | 'D' | 'PURGE' | 'E', zoneIndex: number, loadState: 'EMPTY' | 'FULL' = 'EMPTY'): Tray => ({ id, currentSegmentId: conveyorId, positionFt: (zoneIndex + 0.5) * 2.5, status: 'BLOCKED', createdAtSec: 0, originSourceId: 'A', loadState, zonePlacement: { conveyorId, zoneIndex } })
type Runtime = { timeSec: number; trays: Tray[]; activePurgeBatch: PurgeBatchState | null; inFlightPurgeBatches: PurgeBatchState[]; lastCompletedPurgeBatch: PurgeBatchState | null; activeSourceGrant: SourceReleaseGrantState | null; activeTPurgeSettings: TPurgeSettings; authorizePurgeIfNeeded: () => void; synchronizeSourceGrant: () => void; processZonedBoundaries: () => void; processZonedConveyors: (delta: number) => void }
const runtimeOf = (engine: SimulationEngine) => (engine as unknown as { milestone7: Runtime }).milestone7
const start = (settings: TPurgeSettings) => { const engine = new SimulationEngine(SEGMENTS); engine.startScenario(SETTINGS, 10, undefined, undefined, settings); return engine }
const arrange = (engine: SimulationEngine, tZones: number[], fullZone?: number) => {
  const runtime = runtimeOf(engine)
  runtime.trays = [...tZones.map((zone) => zoned(zone + 1, 'T', zone, zone === fullZone ? 'FULL' : 'EMPTY')), zoned(100, 'D', 0)]
  runtime.activePurgeBatch = null
  return runtime
}

describe('Milestone 12B configurable T purge', () => {
  test('defaults, valid Start Scenario, Reset, and defensive snapshots are exact', () => {
    const engine = new SimulationEngine(SEGMENTS)
    expect(engine.getState().srsControl.tPurgeSettings).toEqual({ backupTrigger: 6, purgeQuantity: 6 })
    engine.startScenario(SETTINGS, 10, undefined, undefined, { backupTrigger: 1, purgeQuantity: 12 })
    const snapshot = engine.getState()
    expect(snapshot.srsControl.tPurgeSettings).toEqual({ backupTrigger: 1, purgeQuantity: 12 })
    ;(snapshot.srsControl.tPurgeSettings as TPurgeSettings).backupTrigger = 9
    expect(engine.getState().srsControl.tPurgeSettings.backupTrigger).toBe(1)
    engine.reset()
    expect(engine.getState().srsControl.tPurgeSettings).toEqual({ backupTrigger: 6, purgeQuantity: 6 })
  })

  test.each([{ backupTrigger: 0, purgeQuantity: 6 }, { backupTrigger: 13, purgeQuantity: 6 }, { backupTrigger: 6, purgeQuantity: 0 }, { backupTrigger: 6, purgeQuantity: 13 }])('rejects invalid active settings $backupTrigger/$purgeQuantity', (settings) => {
    expect(() => start(settings)).toThrow(/T (backup trigger|purge quantity)/)
  })

  test('requires D blockage and consecutive occupancy from the downstream end', () => {
    const engine = start({ backupTrigger: 6, purgeQuantity: 6 })
    let runtime = arrange(engine, [6, 7, 8, 9, 10, 11])
    runtime.trays = runtime.trays.filter((tray) => tray.currentSegmentId !== 'D')
    runtime.authorizePurgeIfNeeded()
    expect(runtime.activePurgeBatch).toBeNull()
    runtime = arrange(engine, [0, 1, 2, 3, 4, 11])
    runtime.authorizePurgeIfNeeded()
    expect(runtime.activePurgeBatch).toBeNull()
    runtime = arrange(engine, [7, 8, 9, 10, 11])
    runtime.authorizePurgeIfNeeded()
    expect(runtime.activePurgeBatch).toBeNull()
    runtime = arrange(engine, [6, 7, 8, 9, 10, 11])
    runtime.authorizePurgeIfNeeded()
    expect(runtime.activePurgeBatch?.authorizedTrayIds).toEqual([12, 11, 10, 9, 8, 7])
  })

  test('trigger boundaries 1 and 12 retain downstream and old full-T semantics', () => {
    let engine = start({ backupTrigger: 1, purgeQuantity: 1 })
    let runtime = arrange(engine, [11])
    runtime.authorizePurgeIfNeeded()
    expect(runtime.activePurgeBatch?.authorizedCount).toBe(1)
    engine = start({ backupTrigger: 12, purgeQuantity: 6 })
    runtime = arrange(engine, Array.from({ length: 12 }, (_, index) => index))
    runtime.authorizePurgeIfNeeded()
    expect(runtime.activePurgeBatch?.authorizedCount).toBe(6)
  })

  test.each([[6, false], [8, false], [12, true]] as const)('trigger 6 quantity 10 with %i available authorizes: %s', (available, authorizes) => {
    const engine = start({ backupTrigger: 6, purgeQuantity: 10 })
    const zones = Array.from({ length: available }, (_, index) => 12 - available + index)
    const runtime = arrange(engine, zones, 10)
    runtime.authorizePurgeIfNeeded()
    if (!authorizes) expect(runtime.activePurgeBatch).toBeNull()
    else {
      expect(runtime.activePurgeBatch?.authorizedCount).toBe(10)
      expect(runtime.activePurgeBatch?.authorizedTrayIds).toHaveLength(10)
      expect(runtime.activePurgeBatch?.authorizedTrayIds).toContain(11)
    }
  })

  test('frozen identities and quantity survive later arrivals, D reopening, and a lower backup depth', () => {
    const engine = start({ backupTrigger: 6, purgeQuantity: 6 })
    const runtime = arrange(engine, [6, 7, 8, 9, 10, 11])
    runtime.authorizePurgeIfNeeded()
    const frozen = { ...runtime.activePurgeBatch!, authorizedTrayIds: [...runtime.activePurgeBatch!.authorizedTrayIds] }
    runtime.trays.push(zoned(50, 'T', 0))
    runtime.trays = runtime.trays.filter((tray) => tray.id !== 100 && tray.id !== 7)
    runtime.authorizePurgeIfNeeded()
    expect(runtime.activePurgeBatch).toEqual(frozen)
  })

  test('blocked PURGE prevents transfer without decrementing or resizing the frozen batch', () => {
    const engine = start({ backupTrigger: 6, purgeQuantity: 6 })
    const runtime = arrange(engine, [6, 7, 8, 9, 10, 11])
    runtime.authorizePurgeIfNeeded()
    runtime.trays.push(zoned(200, 'PURGE', 0))
    runtime.processZonedBoundaries()
    expect(runtime.activePurgeBatch).toMatchObject({ authorizedCount: 6, enteredPurgeCount: 0, divertedCount: 0 })
    runtime.trays = runtime.trays.filter(({ id }) => id !== 200)
    runtime.processZonedBoundaries()
    expect(runtime.inFlightPurgeBatches[0]).toMatchObject({ batchId: 1, authorizedCount: 6, enteredPurgeCount: 1, divertedCount: 1 })
    expect(runtime.trays.find(({ id }) => id === 12)?.zonePlacement).toEqual({ conveyorId: 'PURGE', zoneIndex: 0 })
  })

  test.each(['ACTIVE', 'DRAINING'] as const)('trigger authorizes and diverts immediately while source grant is %s', (phase) => {
    const engine = start({ backupTrigger: 1, purgeQuantity: 1 })
    const runtime = arrange(engine, [11])
    runtime.activeSourceGrant = { grantId: 44, source: 'A', releasedCount: phase === 'DRAINING' ? 1 : 0, enteredTCount: 0, startedAtSec: 0, expiresAtSec: 10, drainingStartedAtSec: phase === 'DRAINING' ? 0 : null, completedAtSec: null, phase, selectionReason: 'NORMAL', purgeDemandExecution: null }
    runtime.authorizePurgeIfNeeded()
    const batchId = runtime.activePurgeBatch?.batchId
    runtime.processZonedBoundaries()
    expect(batchId).toBe(1)
    expect(runtime.timeSec).toBe(0)
    expect(runtime.inFlightPurgeBatches[0]).toMatchObject({ batchId, authorizedAtSec: 0, enteredPurgeCount: 1, divertedCount: 1 })
    expect(runtime.trays.find(({ id }) => id === 12)?.zonePlacement).toEqual({ conveyorId: 'PURGE', zoneIndex: 0 })
  })

  test('E readiness at X does not delay the first physically legal T-to-PURGE transfer', () => {
    const engine = start({ backupTrigger: 1, purgeQuantity: 1 })
    const runtime = arrange(engine, [11])
    runtime.trays.push(zoned(300, 'E', 27, 'FULL'))
    runtime.authorizePurgeIfNeeded()
    runtime.processZonedBoundaries()
    expect(runtime.trays.find(({ id }) => id === 12)?.zonePlacement).toEqual({ conveyorId: 'PURGE', zoneIndex: 0 })
    expect(runtime.inFlightPurgeBatches[0]).toMatchObject({ enteredPurgeCount: 1, enteredXCount: 0 })
  })

  test('PRE_T admission during diversion does not contaminate frozen membership', () => {
    const engine = start({ backupTrigger: 1, purgeQuantity: 1 })
    const runtime = arrange(engine, [11])
    runtime.authorizePurgeIfNeeded()
    const frozenIds = [...runtime.activePurgeBatch!.authorizedTrayIds]
    const newcomer = zoned(300, 'PRE_T', 5)
    newcomer.sourceGrantId = 77
    runtime.trays.push(newcomer)
    runtime.activeSourceGrant = { grantId: 77, source: 'A', releasedCount: 1, enteredTCount: 0, startedAtSec: 0, expiresAtSec: 10, drainingStartedAtSec: null, completedAtSec: null, phase: 'ACTIVE', selectionReason: 'NORMAL', purgeDemandExecution: null }
    runtime.processZonedBoundaries()
    expect(newcomer.zonePlacement).toEqual({ conveyorId: 'T', zoneIndex: 0 })
    expect(newcomer.purgeMember).toBeUndefined()
    expect(newcomer.tPurgeBatchId).toBeUndefined()
    expect(runtime.inFlightPurgeBatches[0].authorizedTrayIds).toEqual(frozenIds)
    runtime.processZonedBoundaries()
    expect(runtime.inFlightPurgeBatches[0]).toMatchObject({ authorizedTrayIds: frozenIds, enteredPurgeCount: 1, divertedCount: 1 })
    expect(newcomer.zonePlacement?.conveyorId).toBe('T')
  })

  test('T purge leaves the exact active source deadline running', () => {
    const engine = start({ backupTrigger: 6, purgeQuantity: 6 })
    const runtime = arrange(engine, [6, 7, 8, 9, 10, 11])
    runtime.trays.push({ id: 300, currentSegmentId: 'B1', positionFt: 1.25, status: 'BLOCKED', createdAtSec: 0, originSourceId: 'B', loadState: 'EMPTY', pilePlacement: { pileId: 'B1', component: 'MDR_PRE_DETRAYER', zoneIndex: 0 } })
    runtime.activeSourceGrant = { grantId: 1, source: 'B', releasedCount: 2, enteredTCount: 2, startedAtSec: 0, expiresAtSec: 10, drainingStartedAtSec: null, completedAtSec: null, phase: 'ACTIVE', selectionReason: 'NORMAL', purgeDemandExecution: null }
    runtime.authorizePurgeIfNeeded()
    runtime.synchronizeSourceGrant()
    expect(runtime.activeSourceGrant).toMatchObject({ source: 'B', expiresAtSec: 10 })
    expect(engine.getState().srsControl.tBypassBatch).toMatchObject({ remainingCount: 6 })
    runtime.activePurgeBatch = null
    runtime.synchronizeSourceGrant()
    expect(runtime.activeSourceGrant).toMatchObject({ source: 'B', expiresAtSec: 10 })
  })

  test('diagnostics expose depth, blockage, qualification, identities, and active quantities', () => {
    const engine = start({ backupTrigger: 6, purgeQuantity: 6 })
    const runtime = arrange(engine, [6, 7, 8, 9, 10, 11])
    let state = engine.getState()
    expect(state.srsControl.tBypassBatch).toMatchObject({ consecutiveDownstreamBackupDepth: 6, dEntranceBlocked: true, triggerQualifies: true })
    runtime.authorizePurgeIfNeeded()
    state = engine.getState()
    expect(state.srsControl.tPurgeSettings).toEqual({ backupTrigger: 6, purgeQuantity: 6 })
    expect(state.srsControl.tBypassBatch).toMatchObject({ active: true, triggerQualifies: false, remainingCount: 6, authorizedTrayIds: [12,11,10,9,8,7] })
  })

  test('repeated trigger evaluation cannot duplicate the currently diverting batch', () => {
    const engine = start({ backupTrigger: 1, purgeQuantity: 1 })
    const runtime = arrange(engine, [11])
    for (let attempt = 0; attempt < 10; attempt++) runtime.authorizePurgeIfNeeded()
    expect(runtime.activePurgeBatch).toMatchObject({ batchId: 1, authorizedTrayIds: [12] })
    expect(runtime.inFlightPurgeBatches).toHaveLength(1)
  })

  test('diversion completion permits a distinct batch while the first remains downstream', () => {
    const engine = new SimulationEngine(SEGMENTS)
    engine.startScenario(engine.getOperatingSettings(), 10, undefined, undefined, { backupTrigger: 1, purgeQuantity: 1 })
    const runtime = runtimeOf(engine)
    runtime.trays = [zoned(1, 'T', 10), zoned(2, 'T', 11), zoned(100, 'D', 0)]
    runtime.activeSourceGrant = null
    runtime.authorizePurgeIfNeeded()
    expect(runtime.activePurgeBatch?.authorizedTrayIds).toEqual([2])

    runtime.processZonedBoundaries()
    expect(runtime.activePurgeBatch).toBeNull()
    expect(runtime.inFlightPurgeBatches[0]).toMatchObject({ authorizedTrayIds: [2], phase: 'RETURNING_THROUGH_X' })
    expect(runtime.lastCompletedPurgeBatch).toBeNull()
    runtime.processZonedConveyors(1.25)
    expect(runtime.inFlightPurgeBatches).toHaveLength(1)

    const remaining = runtime.trays.find((tray) => tray.id === 1)!
    remaining.zonePlacement = { conveyorId: 'T', zoneIndex: 11 }
    remaining.positionFt = 28.75
    runtime.authorizePurgeIfNeeded()
    expect(runtime.activePurgeBatch?.authorizedTrayIds).toEqual([1])
    expect(runtime.inFlightPurgeBatches.map(({ authorizedTrayIds }) => authorizedTrayIds)).toEqual([[2], [1]])
  })
})
