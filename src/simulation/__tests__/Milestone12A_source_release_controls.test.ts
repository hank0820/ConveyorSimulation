import { describe, expect, test } from 'vitest'
import SimulationEngine from '../SimulationEngine'
import { DEFAULT_SRS_TARGETS } from '../srsTargets'
import type { ActiveSlugState, Mission, SourceId, SourceReleaseQuantities, Tray } from '../types'

const SEGMENTS = [
  ['A1',103.5,45],['B1',86,38],['C1',86,38],['PRE_T',15,6],['T',30,12],['D',230,92],['PURGE',30,12],['E',70,28],['X',10,4],['S',20,8],['A2',136,58],['B2',118.5,51],['C2',118.5,51],['CARTBUILD_A',75,30],['CARTBUILD_B',75,30],['CARTBUILD_C',75,30],
].map(([id,lengthFt,maxOccupancy]) => ({ id: String(id), lengthFt: Number(lengthFt), speedFtPerMin: 120, maxOccupancy: Number(maxOccupancy) }))
const SETTINGS = { korberEnabled: true, cartbuildAEnabled: true, cartbuildBEnabled: true, cartbuildCEnabled: true }
type Runtime = { trays: Tray[]; missions: Mission[]; activeSlug: ActiveSlugState | null; activeTargets: typeof DEFAULT_SRS_TARGETS; activeSourceReleaseQuantities: SourceReleaseQuantities; authorizeSlugIfPossible: () => void }
const runtimeOf = (engine: SimulationEngine) => (engine as unknown as { milestone7: Runtime }).milestone7
const pile = (source: SourceId, count: number): Tray[] => Array.from({ length: count }, (_, index) => {
  const pre = index < 5
  const post = index >= 5 && index < 10
  return { id: index + 1, currentSegmentId: `${source}1`, positionFt: index * 2.5, status: 'BLOCKED', createdAtSec: 0, originSourceId: source, loadState: 'EMPTY', pilePlacement: { pileId: `${source}1`, component: pre ? 'MDR_PRE_DETRAYER' : post ? 'MDR_POST_DETRAYER' : 'MDR_DOWNSTREAM', zoneIndex: pre ? index : post ? index - 5 : index - 10 } } as Tray
})

describe('Milestone 12A configurable source release quantities', () => {
  test('defaults, reset, start application, validation, and snapshot immutability are exact', () => {
    const engine = new SimulationEngine(SEGMENTS)
    expect(engine.getState().srsControl.sourceReleaseQuantities).toEqual({ A: 8, B: 8, C: 8 })
    expect(() => engine.startScenario(SETTINGS, 10, DEFAULT_SRS_TARGETS, { A: 0, B: 8, C: 8 })).toThrow(/A1 release quantity/)
    expect(() => engine.startScenario(SETTINGS, 10, DEFAULT_SRS_TARGETS, { A: 8, B: 39, C: 8 })).toThrow(/B1 release quantity/)
    engine.startScenario(SETTINGS, 10, DEFAULT_SRS_TARGETS, { A: 45, B: 1, C: 38 })
    const snapshot = engine.getState()
    expect(snapshot.srsControl.sourceReleaseQuantities).toEqual({ A: 45, B: 1, C: 38 })
    ;(snapshot.srsControl.sourceReleaseQuantities as Record<SourceId, number>).A = 2
    expect(engine.getState().srsControl.sourceReleaseQuantities.A).toBe(45)
    engine.reset()
    expect(engine.getState().srsControl.sourceReleaseQuantities).toEqual({ A: 8, B: 8, C: 8 })
  })

  test.each([['A', 45, 12], ['B', 38, 11], ['C', 38, 10]] as const)('%s authorization uses its configured maximum', (source, capacity, configured) => {
    const engine = new SimulationEngine(SEGMENTS)
    const quantities = { A: 8, B: 8, C: 8, [source]: configured }
    engine.startScenario(SETTINGS, 10, DEFAULT_SRS_TARGETS, quantities)
    const runtime = runtimeOf(engine)
    runtime.trays = pile(source, capacity)
    runtime.activeSlug = null
    runtime.authorizeSlugIfPossible()
    const activeSlug = runtime.activeSlug as ActiveSlugState | null
    expect(activeSlug).toMatchObject({ source, configuredMaximum: configured, authorizedCount: configured, releasedCount: 0 })
    expect(activeSlug?.authorizedTrayIds).toHaveLength(configured)
    expect(engine.getState().srsControl.lanes[source]).toMatchObject({ activeReleaseQuantity: configured, activeBatchConfiguredMaximum: configured, frozenSourceBatchQuantity: configured, sourceBatchReleasedCount: 0, sourceBatchRemainingCount: configured })
  })

  test('partial positive purge demand and available inventory cap authorization', () => {
    const engine = new SimulationEngine(SEGMENTS)
    engine.startScenario(SETTINGS, 10, { ...DEFAULT_SRS_TARGETS, A1: 42 }, { A: 12, B: 8, C: 8 })
    const runtime = runtimeOf(engine)
    runtime.missions = []
    runtime.trays = pile('A', 45)
    runtime.activeSlug = null
    runtime.authorizeSlugIfPossible()
    expect((runtime.activeSlug as ActiveSlugState | null)?.authorizedCount).toBe(3)
    runtime.activeSlug = null
    runtime.activeTargets = { ...DEFAULT_SRS_TARGETS, A1: 1 }
    runtime.trays = pile('A', 5)
    runtime.authorizeSlugIfPossible()
    expect((runtime.activeSlug as ActiveSlugState | null)?.authorizedCount).toBe(4)
  })

  test('an active batch freezes its maximum and authorized tray identities', () => {
    const engine = new SimulationEngine(SEGMENTS)
    engine.startScenario(SETTINGS, 10, DEFAULT_SRS_TARGETS, { A: 9, B: 8, C: 8 })
    const runtime = runtimeOf(engine)
    runtime.trays = pile('A', 45)
    runtime.activeSlug = null
    runtime.authorizeSlugIfPossible()
    const frozen = { ...runtime.activeSlug!, authorizedTrayIds: [...runtime.activeSlug!.authorizedTrayIds] }
    ;(runtime.activeSourceReleaseQuantities as Record<SourceId, number>).A = 2
    expect(runtime.activeSlug).toEqual(frozen)
    expect(engine.getState().activeSlug).toEqual(frozen)
  })
})
