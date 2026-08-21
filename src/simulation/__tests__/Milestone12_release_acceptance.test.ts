import { describe, expect, test } from 'vitest'
import SimulationEngine from '../SimulationEngine'
import type { ActiveSlugState, PurgeBatchState, SourceId, Tray } from '../types'

const SEGMENTS = [['A1',103.5,45],['B1',86,38],['C1',86,38],['PRE_T',15,6],['T',30,12],['D',230,92],['PURGE',30,12],['E',70,28],['X',10,4],['S',20,8],['A2',136,58],['B2',118.5,51],['C2',118.5,51],['CARTBUILD_A',75,30],['CARTBUILD_B',75,30],['CARTBUILD_C',75,30]].map(([id,lengthFt,maxOccupancy]) => ({ id: String(id), lengthFt: Number(lengthFt), speedFtPerMin: 120, maxOccupancy: Number(maxOccupancy) }))
const SETTINGS = { korberEnabled: false, cartbuildAEnabled: true, cartbuildBEnabled: true, cartbuildCEnabled: true }
const zoned = (id: number, conveyorId: 'T' | 'D' | 'PURGE', zoneIndex: number): Tray => ({ id, currentSegmentId: conveyorId, positionFt: (zoneIndex + 0.5) * 2.5, status: 'BLOCKED', createdAtSec: 0, originSourceId: 'A', loadState: 'EMPTY', zonePlacement: { conveyorId, zoneIndex } })
const pile = (id: number, source: SourceId, zoneIndex: number): Tray => ({ id, currentSegmentId: `${source}1`, positionFt: (zoneIndex + 0.5) * 2.5, status: 'BLOCKED', createdAtSec: 0, originSourceId: source, loadState: 'EMPTY', pilePlacement: { pileId: `${source}1`, component: 'MDR_DOWNSTREAM', zoneIndex } })
type Runtime = {
  trays: Tray[]; missions: unknown[]; nextPlanningTime: number; nextConsumptionTime: number; totalTraysCreated: number; cartonIntroduced: Record<SourceId, number>
  activeSlug: ActiveSlugState | null; lastCompletedSlug: ActiveSlugState | null; activePurgeBatch: PurgeBatchState | null; lastCompletedPurgeBatch: PurgeBatchState | null
  authorizeSlugIfPossible: () => void; authorizePurgeIfNeeded: () => void; processZonedBoundaries: () => void; processZonedConveyors: (delta: number) => void; releaseActivePileTray: () => void; recordEnteredT: (tray: Tray) => void
}
const runtimeOf = (engine: SimulationEngine) => (engine as unknown as { milestone7: Runtime }).milestone7
const reconcileFixtureAccounting = (runtime: Runtime) => {
  runtime.totalTraysCreated = runtime.trays.length
  runtime.cartonIntroduced = { A: 0, B: 0, C: 0 }
}

describe('Milestone 12 frozen-batch release acceptance', () => {
  test('later source arrivals cannot join an active authorization and remain future-eligible', () => {
    const engine = new SimulationEngine(SEGMENTS)
    engine.startScenario(SETTINGS, 10, undefined, { A: 4, B: 8, C: 8 })
    const runtime = runtimeOf(engine)
    runtime.missions = []
    runtime.trays = [0, 1, 2, 3, 4, 5].map((zone) => pile(zone + 1, 'A', zone + 9))
    reconcileFixtureAccounting(runtime)
    runtime.activeSlug = null
    runtime.authorizeSlugIfPossible()
    const activeSlug = () => runtime.activeSlug as ActiveSlugState | null
    const original = { ...activeSlug()!, authorizedTrayIds: [...activeSlug()!.authorizedTrayIds] }
    const arrival = pile(99, 'A', 8)
    runtime.trays.push(arrival)

    expect(runtime.activeSlug).toEqual(original)
    expect(activeSlug()?.authorizedTrayIds).not.toContain(arrival.id)
    const lane = engine.getState().srsControl.lanes.A
    expect(lane.sourceBatchReleasedCount + lane.sourceBatchRemainingCount).toBe(original.authorizedCount)
    expect(lane.activeBatchConfiguredMaximum).toBe(original.configuredMaximum)

    for (const id of original.authorizedTrayIds) runtime.recordEnteredT(runtime.trays.find((tray) => tray.id === id)!)
    expect(runtime.activeSlug).toBeNull()
    expect(runtime.lastCompletedSlug?.authorizedTrayIds).toEqual(original.authorizedTrayIds)
    expect(runtime.trays.some((tray) => tray.id === arrival.id)).toBe(true)
    runtime.trays = runtime.trays.filter((tray) => tray.id === arrival.id)
    runtime.authorizeSlugIfPossible()
    expect(activeSlug()?.authorizedTrayIds).toContain(arrival.id)
  })

  test.each(['A', 'B', 'C'] as const)('%s1 cannot release or reauthorize across multiple ticks of a physically blocked purge', (source) => {
    const engine = new SimulationEngine(SEGMENTS)
    engine.startScenario(SETTINGS, 10, undefined, { A: 8, B: 8, C: 8 }, { backupTrigger: 6, purgeQuantity: 6 })
    const runtime = runtimeOf(engine)
    runtime.missions = []
    runtime.nextPlanningTime = Number.MAX_VALUE
    runtime.nextConsumptionTime = Number.MAX_VALUE
    const finalZone = source === 'A' ? 14 : 7
    const sourceIds = Array.from({ length: 4 }, (_, index) => 200 + index)
    runtime.activeSlug = { source, configuredMaximum: 8, authorizedCount: 4, releasedCount: 1, authorizedTrayIds: sourceIds, enteredTCount: 1, finalAuthorizedTrayId: sourceIds[3], authorizedAtSec: 1, completedAtSec: null, status: 'ACTIVE' }
    runtime.trays = [
      ...Array.from({ length: 6 }, (_, index) => zoned(10 + index, 'T', 6 + index)),
      zoned(100, 'D', 0), zoned(101, 'PURGE', 0),
      pile(sourceIds[1], source, finalZone), pile(sourceIds[2], source, finalZone - 1), pile(sourceIds[3], source, finalZone - 2),
    ]
    reconcileFixtureAccounting(runtime)
    runtime.authorizePurgeIfNeeded()
    const frozen = { ...runtime.activeSlug!, authorizedTrayIds: [...runtime.activeSlug!.authorizedTrayIds] }
    const purgeIds = [...runtime.activePurgeBatch!.authorizedTrayIds]

    for (let tick = 0; tick < 10; tick++) engine.step(0.1)

    expect(runtime.activeSlug).toEqual(frozen)
    expect(runtime.activePurgeBatch).toMatchObject({ authorizedTrayIds: purgeIds, enteredPurgeCount: 0, status: 'ACTIVE' })
    expect(engine.getState().srsControl.lanes[source]).toMatchObject({ sourceBatchReleasedCount: 1, sourceBatchRemainingCount: 3 })
    expect(new Set(engine.getState().trays.map((tray) => tray.id)).size).toBe(engine.getState().trays.length)
    expect(engine.getState().materialBalanceError).toBe(0)
    expect(engine.getState().cartbuildSystem.cartonBalanceError).toBe(0)
  })

  test('physical T completion preserves and resumes the exact interrupted source batch', () => {
    const engine = new SimulationEngine(SEGMENTS)
    engine.startScenario(SETTINGS, 10, undefined, { A: 8, B: 7, C: 8 }, { backupTrigger: 6, purgeQuantity: 6 })
    const runtime = runtimeOf(engine)
    runtime.missions = []
    runtime.nextPlanningTime = Number.MAX_VALUE
    runtime.nextConsumptionTime = Number.MAX_VALUE
    const sourceTrayIds = [201, 202, 203, 204, 205, 206, 207]
    runtime.activeSlug = { source: 'B', configuredMaximum: 7, authorizedCount: 7, releasedCount: 2, authorizedTrayIds: sourceTrayIds, enteredTCount: 2, finalAuthorizedTrayId: 207, authorizedAtSec: 1, completedAtSec: null, status: 'ACTIVE' }
    const frozenSource = { ...runtime.activeSlug, authorizedTrayIds: [...runtime.activeSlug.authorizedTrayIds] }
    runtime.trays = [
      ...Array.from({ length: 6 }, (_, index) => zoned(10 + index, 'T', 6 + index)),
      zoned(100, 'D', 0),
      pile(203, 'B', 7), pile(204, 'B', 6), pile(205, 'B', 5), pile(206, 'B', 4), pile(207, 'B', 3),
    ]
    reconcileFixtureAccounting(runtime)
    runtime.authorizePurgeIfNeeded()
    expect(runtime.activeSlug).toEqual(frozenSource)
    expect(engine.getState().srsControl.tBypassBatch).toMatchObject({ sourceBatchPaused: true, pausedSource: 'B' })

    const seenOwners = () => {
      const ids = engine.getState().trays.map((tray) => tray.id)
      expect(new Set(ids).size).toBe(ids.length)
      expect(engine.getState().materialBalanceError).toBe(0)
      expect(engine.getState().cartbuildSystem.cartonBalanceError).toBe(0)
    }
    for (let tick = 0; tick < 200 && runtime.activePurgeBatch; tick++) {
      engine.step(0.1)
      if (runtime.activePurgeBatch) expect(runtime.activeSlug).toEqual(frozenSource)
      seenOwners()
    }
    expect(runtime.activePurgeBatch).toBeNull()
    expect(runtime.lastCompletedPurgeBatch).toMatchObject({ authorizedCount: 6, enteredPurgeCount: 6, status: 'COMPLETE' })
    expect(runtime.activeSlug).toEqual(frozenSource)

    engine.step(0.1)
    expect(runtime.activeSlug).toMatchObject({ source: 'B', authorizedTrayIds: sourceTrayIds, authorizedCount: 7, configuredMaximum: 7, releasedCount: 3 })
    seenOwners()
  })

  test('completion cannot duplicate-authorize until a later eligible controller cycle', () => {
    const engine = new SimulationEngine(SEGMENTS)
    engine.startScenario(SETTINGS, 10, undefined, undefined, { backupTrigger: 1, purgeQuantity: 1 })
    const runtime = runtimeOf(engine)
    runtime.missions = []
    runtime.trays = [zoned(1, 'T', 10), zoned(2, 'T', 11), zoned(100, 'D', 0)]
    runtime.activeSlug = null
    runtime.authorizePurgeIfNeeded()
    const firstIds = [...runtime.activePurgeBatch!.authorizedTrayIds]
    expect(firstIds).toEqual([2])

    runtime.processZonedBoundaries()
    expect(runtime.activePurgeBatch).toBeNull()
    expect(runtime.lastCompletedPurgeBatch?.authorizedTrayIds).toEqual(firstIds)
    expect(runtime.lastCompletedPurgeBatch?.authorizedCount).toBe(1)

    runtime.processZonedConveyors(1.25)
    expect(runtime.activePurgeBatch).toBeNull()
    const remaining = runtime.trays.find((tray) => tray.id === 1)!
    remaining.zonePlacement = { conveyorId: 'T', zoneIndex: 11 }
    remaining.positionFt = 28.75
    runtime.authorizePurgeIfNeeded()
    expect(runtime.activePurgeBatch?.authorizedTrayIds).toEqual([1])
    expect(runtime.activePurgeBatch?.authorizedTrayIds.some((id) => firstIds.includes(id))).toBe(false)
  })
})
