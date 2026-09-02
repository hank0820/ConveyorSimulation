import { describe, expect, test } from 'vitest'
import SimulationEngine from '../SimulationEngine'
import type { PurgeBatchState, SourceReleaseGrantState, TPurgeSettings, Tray } from '../types'

const SEGMENTS = [['A1',103.5,45],['B1',86,38],['C1',86,38],['PRE_T',15,6],['T',30,12],['D',230,92],['PURGE',30,12],['E',70,28],['X',10,4],['S',20,8],['A2',136,58],['B2',118.5,51],['C2',118.5,51],['CARTBUILD_A',75,30],['CARTBUILD_B',75,30],['CARTBUILD_C',75,30]].map(([id,lengthFt,maxOccupancy]) => ({ id: String(id), lengthFt: Number(lengthFt), speedFtPerMin: 120, maxOccupancy: Number(maxOccupancy) }))
const SETTINGS = { korberEnabled: true, cartbuildAEnabled: true, cartbuildBEnabled: true, cartbuildCEnabled: true }
const zoned = (id: number, conveyorId: 'T' | 'D' | 'PURGE', zoneIndex: number, loadState: 'EMPTY' | 'FULL' = 'EMPTY'): Tray => ({ id, currentSegmentId: conveyorId, positionFt: (zoneIndex + 0.5) * 2.5, status: 'BLOCKED', createdAtSec: 0, originSourceId: 'A', loadState, zonePlacement: { conveyorId, zoneIndex } })
type Runtime = { timeSec: number; trays: Tray[]; activePurgeBatch: PurgeBatchState | null; lastCompletedPurgeBatch: PurgeBatchState | null; activeSourceGrant: SourceReleaseGrantState | null; activeTPurgeSettings: TPurgeSettings; authorizePurgeIfNeeded: () => void; synchronizeSourceGrant: () => void; processZonedBoundaries: () => void; processZonedConveyors: (delta: number) => void }
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

  test.each([[6, 6], [8, 8], [12, 10]] as const)('trigger 6 quantity 10 with %i available freezes %i', (available, expected) => {
    const engine = start({ backupTrigger: 6, purgeQuantity: 10 })
    const zones = Array.from({ length: available }, (_, index) => 12 - available + index)
    const runtime = arrange(engine, zones, 10)
    runtime.authorizePurgeIfNeeded()
    expect(runtime.activePurgeBatch?.authorizedCount).toBe(expected)
    expect(runtime.activePurgeBatch?.authorizedTrayIds).toHaveLength(expected)
    expect(runtime.activePurgeBatch?.authorizedTrayIds).toContain(11)
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
  })

  test('T purge pauses and preserves the exact active source grant and diagnostics', () => {
    const engine = start({ backupTrigger: 6, purgeQuantity: 6 })
    const runtime = arrange(engine, [6, 7, 8, 9, 10, 11])
    runtime.trays.push({ id: 300, currentSegmentId: 'B1', positionFt: 1.25, status: 'BLOCKED', createdAtSec: 0, originSourceId: 'B', loadState: 'EMPTY', pilePlacement: { pileId: 'B1', component: 'MDR_PRE_DETRAYER', zoneIndex: 0 } })
    runtime.activeSourceGrant = { grantId: 1, source: 'B', releasedCount: 2, enteredTCount: 2, startedAtSec: 0, expiresAtSec: 10, pausedAtSec: null, remainingSecWhenPaused: null, drainingStartedAtSec: null, completedAtSec: null, phase: 'ACTIVE' }
    runtime.authorizePurgeIfNeeded()
    runtime.synchronizeSourceGrant()
    expect(runtime.activeSourceGrant).toMatchObject({ source: 'B', pausedAtSec: 0, remainingSecWhenPaused: 10 })
    expect(engine.getState().srsControl.tBypassBatch).toMatchObject({ sourceGrantPaused: true, pausedSource: 'B', remainingCount: 6 })
    runtime.activePurgeBatch = null
    runtime.synchronizeSourceGrant()
    expect(runtime.activeSourceGrant).toMatchObject({ source: 'B', pausedAtSec: null, expiresAtSec: 10 })
  })

  test('diagnostics expose depth, blockage, qualification, identities, and active quantities', () => {
    const engine = start({ backupTrigger: 6, purgeQuantity: 10 })
    const runtime = arrange(engine, [6, 7, 8, 9, 10, 11])
    let state = engine.getState()
    expect(state.srsControl.tBypassBatch).toMatchObject({ consecutiveDownstreamBackupDepth: 6, dEntranceBlocked: true, triggerQualifies: true })
    runtime.authorizePurgeIfNeeded()
    state = engine.getState()
    expect(state.srsControl.tPurgeSettings).toEqual({ backupTrigger: 6, purgeQuantity: 10 })
    expect(state.srsControl.tBypassBatch).toMatchObject({ active: true, triggerQualifies: false, remainingCount: 6, authorizedTrayIds: [12,11,10,9,8,7] })
  })

  test('completion cannot duplicate-authorize until a later eligible controller cycle', () => {
    const engine = new SimulationEngine(SEGMENTS)
    engine.startScenario(engine.getOperatingSettings(), 10, undefined, undefined, { backupTrigger: 1, purgeQuantity: 1 })
    const runtime = runtimeOf(engine)
    runtime.trays = [zoned(1, 'T', 10), zoned(2, 'T', 11), zoned(100, 'D', 0)]
    runtime.activeSourceGrant = null
    runtime.authorizePurgeIfNeeded()
    expect(runtime.activePurgeBatch?.authorizedTrayIds).toEqual([2])

    runtime.processZonedBoundaries()
    expect(runtime.activePurgeBatch).toBeNull()
    expect(runtime.lastCompletedPurgeBatch).toMatchObject({ authorizedTrayIds: [2], authorizedCount: 1, status: 'COMPLETE' })
    runtime.processZonedConveyors(1.25)
    expect(runtime.activePurgeBatch).toBeNull()

    const remaining = runtime.trays.find((tray) => tray.id === 1)!
    remaining.zonePlacement = { conveyorId: 'T', zoneIndex: 11 }
    remaining.positionFt = 28.75
    runtime.authorizePurgeIfNeeded()
    expect(runtime.activePurgeBatch?.authorizedTrayIds).toEqual([1])
  })
})
