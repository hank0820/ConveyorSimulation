import { describe, expect, test } from 'vitest'
import SimulationEngine from '../SimulationEngine'
import type { ActiveSlugState, Mission, PurgeBatchState, SourceId, Tray } from '../types'

const SEGMENTS = [
  ['A1',81,24],['B1',81,16],['C1',81,16],['PRE_T',20,8],['T',30,12],['D',235,94],['PURGE',15,6],['E',87.5,35],['X',12.5,5],['S',20,8],['A2',90,36],['B2',72.5,29],['C2',72.5,29],['CARTBUILD_A',75,30],['CARTBUILD_B',75,30],['CARTBUILD_C',75,30],
].map(([id,lengthFt,maxOccupancy]) => ({ id: String(id), lengthFt: Number(lengthFt), speedFtPerMin: 120, maxOccupancy: Number(maxOccupancy) }))

type SrsState = ReturnType<SimulationEngine['getState']> & { srsControl: {
  targets: Record<string, number>; current: Record<string, number>; globalTarget: number; globalCurrent: number; globalPending: number; globalAvailableCapacity: number
  planningCadenceSec: number; nextPlanningTime: number; planningCursor: SourceId
  lanes: Record<SourceId, { pendingDemand: number; lanePurgeDemand: number; localAvailable: number; downstreamAvailable: number; laneMissionCapacity: number; pendingCartbuildMissions: number; pendingEmptyMissions: number }>
} }

const srs = (engine: SimulationEngine) => (engine.getState() as SrsState).srsControl
type Runtime = {
  timeSec: number
  trays: Tray[]
  missions: Mission[]
  asrsNextAssign: SourceId
  slugCursor: SourceId
  activeSlug: ActiveSlugState | null
  activePurgeBatch: PurgeBatchState | null
  nextPlanningTime: number
  planPendingDemand: () => void
  authorizeSlugIfPossible: () => void
  authorizePurgeIfNeeded: () => void
}
const runtimeOf = (engine: SimulationEngine) => (engine as unknown as { milestone7: Runtime }).milestone7
const pileTray = (id: number, source: SourceId, component: 'MDR_PRE_DETRAYER' | 'MDR_POST_DETRAYER' | 'MDR_DOWNSTREAM', zoneIndex: number): Tray => ({
  id, currentSegmentId: `${source}1`, positionFt: (zoneIndex + 0.5) * 2.5, status: 'BLOCKED', createdAtSec: 0,
  originSourceId: source, loadState: 'EMPTY', pilePlacement: { pileId: `${source}1`, component, zoneIndex },
})
const zonedTray = (id: number, conveyorId: 'T' | 'D' | 'A2' | 'B2' | 'C2', zoneIndex: number, loadState: 'EMPTY' | 'FULL' = 'EMPTY'): Tray => ({
  id, currentSegmentId: conveyorId, positionFt: (zoneIndex + 0.5) * 2.5, status: 'BLOCKED', createdAtSec: 0,
  originSourceId: 'A', loadState, zonePlacement: { conveyorId, zoneIndex },
})

describe('Milestone 9 SRS PendingDemand controller', () => {
  test('uses Milestone 11A targets with the 148-tray conveyor reset inventory', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const state = engine.getState() as SrsState
    expect(state.srsControl.targets).toEqual({ A1: 24, B1: 16, C1: 16, T: 6, D: 92, A2: 36, B2: 29, C2: 29 })
    expect(state.srsControl.globalTarget).toBe(248)
    expect(state.srsControl.globalCurrent).toBe(148)
    expect(state.trays).toHaveLength(148)
    expect(state.physicalTrayCount).toBe(248)
    expect(state.segments.find(({ id }) => id === 'T')?.maxOccupancy).toBe(12)
    expect(state.segments.find(({ id }) => id === 'D')?.maxOccupancy).toBe(92)
  })

  test('time-zero planner reserves 100 missions deterministically as 34/33/33 with 90 CARTBUILD', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const state = engine.getState() as SrsState
    expect(state.missions).toHaveLength(100)
    expect(state.missions.filter((mission) => (mission as Mission & { missionType: string }).missionType === 'CARTBUILD')).toHaveLength(90)
    expect([state.pendingA, state.pendingB, state.pendingC]).toEqual([34, 33, 33])
    expect(state.srsControl).toMatchObject({ globalPending: 100, globalAvailableCapacity: 0, planningCadenceSec: 10, nextPlanningTime: 10, planningCursor: 'B' })
  })

  test('missions retain the full 180-second retrieval delay and PendingDemand while matured and blocked', () => {
    const engine = new SimulationEngine(SEGMENTS)
    expect(engine.getState().missions.every((mission) => mission.readyAtSec - mission.createdAtSec === 180)).toBe(true)
    engine.step(179.9)
    expect(engine.getState().missions.every((mission) => mission.state === 'RETRIEVING')).toBe(true)
    const firstMission = engine.getState().missions[0]
    const pendingBefore = srs(engine).globalPending
    const runtime = engine as unknown as {
      milestone7: {
        asrsLastRelease: Record<SourceId, number>
        nextPlanningTime: number
      }
    }
    runtime.milestone7.asrsLastRelease = {
      A: Number.MAX_VALUE,
      B: Number.MAX_VALUE,
      C: Number.MAX_VALUE,
    }
    runtime.milestone7.nextPlanningTime = Number.MAX_VALUE
    engine.step(0.1)
    expect(engine.getState().missions.find((mission) => mission.missionId === firstMission.missionId)?.state).toBe('READY_AT_EXCHANGER')
    expect(srs(engine).globalPending).toBe(pendingBefore)
  })

  test('authoritative CurrentCount excludes PRE_T and non-SRS return sections and ignores payload state', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = (engine as unknown as { milestone7: { trays: Tray[] } }).milestone7
    runtime.trays = [
      { id: 1, currentSegmentId: 'A1', positionFt: 1.25, status: 'BLOCKED', createdAtSec: 0, originSourceId: 'A', loadState: 'FULL', payloadOrigin: 'CARTBUILD', pilePlacement: { pileId: 'A1', component: 'MDR_PRE_DETRAYER', zoneIndex: 0 } },
      { id: 2, currentSegmentId: 'PRE_T', positionFt: 1.25, status: 'BLOCKED', createdAtSec: 0, originSourceId: 'A', loadState: 'EMPTY', zonePlacement: { conveyorId: 'PRE_T', zoneIndex: 0 } },
      { id: 3, currentSegmentId: 'T', positionFt: 1.25, status: 'BLOCKED', createdAtSec: 0, originSourceId: 'A', loadState: 'FULL', zonePlacement: { conveyorId: 'T', zoneIndex: 0 } },
      { id: 4, currentSegmentId: 'D', positionFt: 1.25, status: 'BLOCKED', createdAtSec: 0, originSourceId: 'A', loadState: 'EMPTY', zonePlacement: { conveyorId: 'D', zoneIndex: 0 } },
      { id: 5, currentSegmentId: 'E', positionFt: 1.25, status: 'BLOCKED', createdAtSec: 0, originSourceId: 'A', loadState: 'FULL', zonePlacement: { conveyorId: 'E', zoneIndex: 0 } },
      { id: 6, currentSegmentId: 'A2', positionFt: 1.25, status: 'BLOCKED', createdAtSec: 0, originSourceId: 'A', loadState: 'FULL', zonePlacement: { conveyorId: 'A2', zoneIndex: 0 } },
      { id: 7, currentSegmentId: 'B1', positionFt: 1.25, status: 'BLOCKED', createdAtSec: 0, originSourceId: 'B', loadState: 'EMPTY', pilePlacement: { pileId: 'B1', component: 'BELT', beltPosFt: 1 } },
      { id: 8, currentSegmentId: 'C1', positionFt: 1.25, status: 'BLOCKED', createdAtSec: 0, originSourceId: 'C', loadState: 'FULL', pilePlacement: { pileId: 'C1', component: 'MDR_DOWNSTREAM', zoneIndex: 0 } },
      { id: 9, currentSegmentId: 'B2', positionFt: 1.25, status: 'BLOCKED', createdAtSec: 0, originSourceId: 'B', loadState: 'EMPTY', zonePlacement: { conveyorId: 'B2', zoneIndex: 0 } },
      { id: 10, currentSegmentId: 'C2', positionFt: 1.25, status: 'BLOCKED', createdAtSec: 0, originSourceId: 'C', loadState: 'FULL', zonePlacement: { conveyorId: 'C2', zoneIndex: 0 } },
    ]
    expect(srs(engine).current).toEqual({ A1: 1, B1: 1, C1: 1, T: 1, D: 1, A2: 1, B2: 1, C2: 1 })
    expect(srs(engine).globalCurrent).toBe(8)
  })

  test('mission typing follows toggles and pending work survives later disablement', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const originalB = engine.getState().missions.filter((mission) => mission.assignedExchanger === 'B')
    engine.setOperatingSetting('cartbuildBEnabled', false)
    expect(engine.getState().missions.filter((mission) => mission.assignedExchanger === 'B').slice(0, originalB.length)).toEqual(originalB)
    engine.step(180)
    expect(engine.getState().missions.some((mission) => mission.assignedExchanger === 'B' && (mission as Mission & { missionType: string }).missionType === 'CARTBUILD')).toBe(true)
  })

  test('pre-maturity CARTBUILD toggle-off drains retained work and plans only future EMPTY missions', () => {
    const engine = new SimulationEngine(SEGMENTS)
    engine.step(60)
    const before = engine.getState()
    const retainedB = before.missions.filter((mission) => mission.assignedExchanger === 'B' && mission.missionType === 'CARTBUILD')
    engine.setOperatingSetting('cartbuildBEnabled', false)
    engine.step(540)
    const after = engine.getState()
    expect(retainedB.length).toBeGreaterThan(0)
    expect(retainedB.every((mission) => after.missions.find((candidate) => candidate.missionId === mission.missionId)?.state === 'RELEASED')).toBe(true)
    expect(after.missions.filter((mission) => mission.assignedExchanger === 'B' && mission.createdAtSec > before.timeSec).every((mission) => mission.missionType === 'EMPTY')).toBe(true)
    expect(after.cartbuildSystem.exchangers.B.loadedReleases).toBe(retainedB.length)
    expect(after.materialBalanceError).toBe(0)
    expect(after.cartbuildSystem.cartonBalanceError).toBe(0)
  })

  test('cadence updates reject invalid values and schedule one full new interval without resetting state', () => {
    const engine = new SimulationEngine(SEGMENTS) as SimulationEngine & { setPendingDemandPlanningCadence: (seconds: number) => void }
    engine.step(3)
    const before = engine.getState()
    expect(() => engine.setPendingDemandPlanningCadence(0)).toThrow()
    expect(() => engine.setPendingDemandPlanningCadence(Number.NaN)).toThrow()
    engine.setPendingDemandPlanningCadence(7)
    const after = engine.getState() as SrsState
    expect(after.timeSec).toBe(before.timeSec)
    expect(after.trays).toEqual(before.trays)
    expect(after.srsControl).toMatchObject({ planningCadenceSec: 7, nextPlanningTime: 10 })
  })

  test('planner runs at exact cadence and advances its cursor only after successful creation', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    const removed = runtime.missions.pop()!
    const cursorBefore = runtime.asrsNextAssign
    engine.step(9.9)
    expect(runtime.missions).toHaveLength(99)
    expect(runtime.asrsNextAssign).toBe(cursorBefore)
    engine.step(0.1)
    expect(runtime.missions.length).toBeGreaterThan(99)
    expect(runtime.missions.slice(99).every((mission) => Math.abs(mission.createdAtSec - 10) < 1e-8 && mission.state === 'RETRIEVING')).toBe(true)
    expect(runtime.missions.slice(99).every((mission) => mission.missionId !== removed.missionId)).toBe(true)
    expect(runtime.asrsNextAssign).toBe(cursorBefore)
  })

  test('global and lane capacity subtract reservations and clamp each negative pile availability independently', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    runtime.trays = [
      ...Array.from({ length: 30 }, (_, index) => pileTray(index + 1, 'A', index < 5 ? 'MDR_PRE_DETRAYER' : index < 10 ? 'MDR_POST_DETRAYER' : 'MDR_DOWNSTREAM', index < 5 ? index : index < 10 ? index - 5 : index - 10)),
      ...Array.from({ length: 2 }, (_, index) => zonedTray(100 + index, 'T', index)),
      ...Array.from({ length: 80 }, (_, index) => zonedTray(200 + index, 'D', index)),
      ...Array.from({ length: 10 }, (_, index) => zonedTray(300 + index, 'A2', index)),
    ]
    runtime.missions = Array.from({ length: 5 }, (_, index) => ({ missionId: index + 1, assignedExchanger: 'A' as const, missionType: 'CARTBUILD' as const, createdAtSec: 0, readyAtSec: 180, state: 'RETRIEVING' as const }))
    const state = srs(engine)
    expect(state.lanes.A).toMatchObject({ localAvailable: 0, downstreamAvailable: 42, pendingDemand: 5, laneMissionCapacity: 37 })
    expect(state.globalAvailableCapacity).toBe(Math.max(0, 248 - 122 - 5))
  })

  test('mission type selection follows CARTBUILD, EMPTY, then ineligible priority', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    runtime.missions = []
    runtime.trays = []
    engine.setOperatingSetting('cartbuildAEnabled', true)
    engine.setOperatingSetting('cartbuildBEnabled', false)
    engine.setOperatingSetting('cartbuildCEnabled', false)
    engine.setOperatingSetting('korberEnabled', true)
    runtime.asrsNextAssign = 'A'
    runtime.planPendingDemand()
    expect(runtime.missions.some((mission) => mission.assignedExchanger === 'A' && mission.missionType === 'CARTBUILD')).toBe(true)
    expect(runtime.missions.some((mission) => mission.assignedExchanger === 'B' && mission.missionType === 'EMPTY')).toBe(true)
    expect(runtime.missions.some((mission) => mission.assignedExchanger === 'C' && mission.missionType === 'EMPTY')).toBe(true)

    runtime.missions = []
    engine.setOperatingSetting('korberEnabled', false)
    runtime.planPendingDemand()
    expect(runtime.missions.every((mission) => mission.assignedExchanger === 'A' && mission.missionType === 'CARTBUILD')).toBe(true)
  })

  test.each([
    [25, 0, 1],
    [24, 0, 0],
    [20, 0, -4],
    [20, 7, 3],
  ])('lane PurgeDemand uses current %i - target + pending %i = %i without clamping', (currentCount, pending, expected) => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    runtime.trays = Array.from({ length: currentCount }, (_, index) => pileTray(index + 1, 'A', index < 5 ? 'MDR_PRE_DETRAYER' : 'MDR_POST_DETRAYER', index < 5 ? index : index - 5))
    runtime.missions = Array.from({ length: pending }, (_, index) => ({ missionId: index + 1, assignedExchanger: 'A' as const, missionType: 'EMPTY' as const, createdAtSec: 0, readyAtSec: 180, state: 'RETRIEVING' as const }))
    expect(srs(engine).lanes.A.lanePurgeDemand).toBe(expected)
  })

  test('source arbitration chooses highest positive PurgeDemand and freezes the exact capped quantity', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    runtime.trays = [
      ...Array.from({ length: 3 }, (_, index) => pileTray(index + 1, 'A', 'MDR_DOWNSTREAM', 14 - index)),
      ...Array.from({ length: 8 }, (_, index) => pileTray(20 + index, 'B', 'MDR_DOWNSTREAM', 6 - Math.min(index, 6))),
      zonedTray(99, 'D', 0),
    ]
    runtime.missions = [
      ...Array.from({ length: 30 }, (_, index) => ({ missionId: index + 1, assignedExchanger: 'A' as const, missionType: 'CARTBUILD' as const, createdAtSec: 0, readyAtSec: 180, state: 'RETRIEVING' as const })),
      ...Array.from({ length: 10 }, (_, index) => ({ missionId: 100 + index, assignedExchanger: 'B' as const, missionType: 'CARTBUILD' as const, createdAtSec: 0, readyAtSec: 180, state: 'RETRIEVING' as const })),
    ]
    runtime.slugCursor = 'B'
    runtime.authorizeSlugIfPossible()
    expect(engine.getState().activeSlug).toMatchObject({ source: 'A', authorizedCount: 3, releasedCount: 0 })
    expect(engine.getState().activeSlug?.authorizedTrayIds).toEqual([1, 2, 3])
  })

  test.each([
    [1, 24, true, 1],
    [3, 24, true, 3],
    [12, 24, true, 8],
    [6, 0, false, 6],
    [10, 0, false, 8],
  ])('source authorization with %i trays, %i pending, D blocked=%s freezes %i', (trayCount, pending, dBlocked, expected) => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    runtime.trays = Array.from({ length: trayCount }, (_, index) => pileTray(index + 1, 'A', 'MDR_DOWNSTREAM', 14 - index))
    if (dBlocked) runtime.trays.push(zonedTray(500, 'D', 0))
    runtime.missions = Array.from({ length: pending }, (_, index) => ({ missionId: index + 1, assignedExchanger: 'A' as const, missionType: 'EMPTY' as const, createdAtSec: 0, readyAtSec: 180, state: 'RETRIEVING' as const }))
    runtime.slugCursor = 'A'
    runtime.authorizeSlugIfPossible()
    expect(engine.getState().activeSlug).toMatchObject({ source: 'A', authorizedCount: expected })
  })

  test('physical fullness then source round robin resolve non-positive PurgeDemand ties', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    runtime.trays = [
      ...Array.from({ length: 10 }, (_, index) => pileTray(index + 1, 'A', 'MDR_DOWNSTREAM', 14 - Math.min(index, 14))),
      ...Array.from({ length: 38 }, (_, index) => pileTray(30 + index, 'B', index < 5 ? 'MDR_PRE_DETRAYER' : index < 10 ? 'MDR_POST_DETRAYER' : 'MDR_DOWNSTREAM', index < 5 ? index : index < 10 ? index - 5 : (index - 10) % 8)),
    ]
    runtime.missions = []
    runtime.slugCursor = 'A'
    runtime.authorizeSlugIfPossible()
    expect(engine.getState().activeSlug?.source).toBe('B')

    runtime.activeSlug = null
    runtime.trays = [pileTray(1, 'A', 'MDR_DOWNSTREAM', 14), pileTray(2, 'B', 'MDR_DOWNSTREAM', 6)]
    runtime.slugCursor = 'B'
    runtime.authorizeSlugIfPossible()
    expect(engine.getState().activeSlug?.source).toBe('B')
  })

  test('T-full bypass freezes six downstream-most EMPTY identities and ignores FULL trays', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const runtime = runtimeOf(engine)
    runtime.trays = [
      ...Array.from({ length: 12 }, (_, index) => zonedTray(index + 1, 'T', index, index === 10 ? 'FULL' : 'EMPTY')),
      zonedTray(50, 'D', 0),
    ]
    runtime.authorizePurgeIfNeeded()
    expect(runtime.activePurgeBatch?.authorizedTrayIds).toEqual([12, 10, 9, 8, 7, 6])
    expect(runtime.activePurgeBatch?.authorizedTrayIds).not.toContain(11)
    runtime.trays.push(zonedTray(60, 'A2', 0))
    runtime.authorizePurgeIfNeeded()
    expect(runtime.activePurgeBatch?.authorizedTrayIds).toEqual([12, 10, 9, 8, 7, 6])
  })

  test('public KORBER-OFF cartbuild startup progresses through maturity, detraying, T bypass, and exact balances', () => {
    const engine = new SimulationEngine(SEGMENTS)
    engine.setOperatingSetting('korberEnabled', false)
    let sawMaturedRelease = false
    let sawDetraying = false
    let sawFullT = false
    let sawBypass = false
    let sawPausedSource = false
    let sawResumedCompletion = false
    let interruptedSource: SourceId | undefined
    for (let second = 0; second < 720; second++) {
      engine.step(1)
      const state = engine.getState()
      sawMaturedRelease ||= state.cartbuildSystem.cartbuildCartonsIntroduced > 0
      sawDetraying ||= Object.values(state.cartbuildSystem.detrayers).some((detrayer) => detrayer.splitCount > 0)
      sawFullT ||= state.zonedOccupancy.T === 12 && !state.dEntranceAvailable
      if (sawMaturedRelease && state.srsControl.tBypassBatch.active) {
        sawBypass = true
        if (state.activeSlug) {
          sawPausedSource = true
          interruptedSource ??= state.activeSlug.source
        }
      }
      if (interruptedSource && state.lastCompletedSlug?.source === interruptedSource && !state.srsControl.tBypassBatch.active) sawResumedCompletion = true
      expect(state.materialBalanceError).toBe(0)
      expect(state.cartbuildSystem.cartonBalanceError).toBe(0)
      expect(new Set(state.trays.map((tray) => tray.id)).size).toBe(state.trays.length)
      if (sawMaturedRelease && sawDetraying && sawFullT && sawBypass && sawPausedSource && sawResumedCompletion) break
    }
    expect({ sawMaturedRelease, sawDetraying, sawFullT, sawBypass, sawPausedSource, sawResumedCompletion }).toEqual({
      sawMaturedRelease: true, sawDetraying: true, sawFullT: true, sawBypass: true, sawPausedSource: true, sawResumedCompletion: true,
    })
  }, 30_000)
})
