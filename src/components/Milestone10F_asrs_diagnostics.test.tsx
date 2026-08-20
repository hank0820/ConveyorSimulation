import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import SimulationEngine from '../simulation/SimulationEngine'
import type { CompletedOutboundCycle, InboundRobotSnapshot, OutboundRobotSnapshot, SimulationStateWithProgress, SourceId } from '../simulation/types'
import SimulationControls from './SimulationControls'

const SEGMENTS = [
  { id: 'A1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'PRE_T', maxOccupancy: 24 }, { id: 'B1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'PRE_T', maxOccupancy: 16 }, { id: 'C1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'T', maxOccupancy: 16 },
  { id: 'PRE_T', lengthFt: 20, speedFtPerMin: 120, nextSegmentId: 'T', maxOccupancy: 8 }, { id: 'T', lengthFt: 30, speedFtPerMin: 120, nextSegmentId: 'D', maxOccupancy: 12 }, { id: 'D', lengthFt: 235, speedFtPerMin: 120, maxOccupancy: 94 },
  { id: 'PURGE', lengthFt: 15, speedFtPerMin: 120, nextSegmentId: 'X', maxOccupancy: 6 }, { id: 'E', lengthFt: 87.5, speedFtPerMin: 120, nextSegmentId: 'X', maxOccupancy: 35 }, { id: 'X', lengthFt: 12.5, speedFtPerMin: 120, maxOccupancy: 5 }, { id: 'S', lengthFt: 20, speedFtPerMin: 120, maxOccupancy: 8 },
  { id: 'A2', lengthFt: 90, speedFtPerMin: 120, maxOccupancy: 36 }, { id: 'B2', lengthFt: 72.5, speedFtPerMin: 120, maxOccupancy: 29 }, { id: 'C2', lengthFt: 72.5, speedFtPerMin: 120, maxOccupancy: 29 },
  { id: 'CARTBUILD_A', lengthFt: 75, speedFtPerMin: 120, maxOccupancy: 30 }, { id: 'CARTBUILD_B', lengthFt: 75, speedFtPerMin: 120, maxOccupancy: 30 }, { id: 'CARTBUILD_C', lengthFt: 75, speedFtPerMin: 120, maxOccupancy: 30 },
]

const engine = () => new SimulationEngine(SEGMENTS)
const clone = <T,>(value: T): T => structuredClone(value)
const blankState = () => {
  const state = clone(engine().getState())
  state.asrsRobotSystem.outboundRobots = []
  state.asrsRobotSystem.inboundOnlyRobots = []
  state.asrsRobotSystem.returningRobots = []
  state.asrsRobotSystem.inboundReservations = []
  state.asrsRobotSystem.cancelledInboundOnlyRobots = []
  state.asrsRobotSystem.completedCycles = []
  state.asrsRobotSystem.completedOutboundCycles = []
  state.asrsRobotSystem.completedCountByClassification = { OUTBOUND_ONLY: 0, INBOUND_ONLY: 0, DUAL_CYCLE: 0, CANCELLED_INBOUND_ONLY: 0 }
  for (const source of ['A', 'B', 'C'] as SourceId[]) {
    const exchanger = state.asrsRobotSystem.exchangers[source]
    exchanger.dropRobotId = null
    exchanger.shiftingOrTakeRobotId = null
    exchanger.dropBlocked = false
    exchanger.dropBlockedReason = null
    exchanger.dropBlockedDurationSec = 0
    exchanger.queue = []
    exchanger.queueLength = 0
    exchanger.currentQueueDepth = 0
    exchanger.completedCountByClassification = { OUTBOUND_ONLY: 0, INBOUND_ONLY: 0, DUAL_CYCLE: 0, CANCELLED_INBOUND_ONLY: 0 }
  }
  return state
}

const outbound = (source: SourceId, robotId: number, lifecycleState: OutboundRobotSnapshot['lifecycleState'] = 'TRAVELING_OUTBOUND'): OutboundRobotSnapshot => ({
  robotId, missionId: robotId + 1000, missionType: 'CARTBUILD', assignedExchanger: source, lifecycleState,
  assignedAtSec: 0, maturityTimeSec: 180, travelProgress: 0.5, queuePosition: null, blockedReason: null, blockedDurationSec: 0,
  payloadTrayId: robotId + 2000, payloadLoadState: 'FULL', cartbuildCartonAttached: true, ownsPayload: true,
  inboundTrayId: null, inboundTrayLoadState: null, takePickupTimeSec: null, rackArrivalTimeSec: null, returnProgress: 0,
})

const inbound = (source: SourceId, robotId: number, lifecycleState: InboundRobotSnapshot['lifecycleState'] = 'TRAVELING_TO_DROP'): InboundRobotSnapshot => ({
  robotId, missionId: robotId + 1000, assignedExchanger: source, lifecycleState, reservedTrayId: robotId + 2000,
  assignedAtSec: 0, maturityTimeSec: 180, travelProgress: 0.5, queuePosition: null, cancellationTimeSec: null,
  cancellationReason: null, cancelledAfterAdmission: false, ownsInboundTray: false, inboundTrayId: null,
  inboundTrayLoadState: null, takePickupTimeSec: null, rackArrivalTimeSec: null, returnProgress: 0,
})

const render = (state: SimulationStateWithProgress, collapsed = false) => renderToStaticMarkup(createElement(SimulationControls, {
  state, playing: false, playbackSpeed: 1, setPlaybackSpeed: vi.fn(), onPlayPause: vi.fn(), onStep: vi.fn(), onReset: vi.fn(), onStartScenario: vi.fn(),
  onOperatingSettingChange: vi.fn(), onPlanningCadenceChange: vi.fn(), configurationNotice: null, collapsed, onToggleCollapsed: vi.fn(),
}))
const attr = (markup: string, name: string) => markup.match(new RegExp(`${name}="([^"]*)"`))?.[1]
const card = (markup: string, source: SourceId) => markup.match(new RegExp(`<article[^>]*data-exchanger-id="${source}"[\\s\\S]*?</article>`))?.[0] ?? ''

describe('Milestone 10F ASRS operations diagnostics', () => {
  test('global active count matches the immutable robot snapshot', () => {
    const state = engine().getState()
    const expected = state.asrsRobotSystem.outboundRobots.filter((robot) => robot.lifecycleState !== 'OUTBOUND_COMPLETE').length
      + state.asrsRobotSystem.inboundOnlyRobots.filter((robot) => robot.lifecycleState !== 'INBOUND_COMPLETE' && robot.lifecycleState !== 'CANCELLED').length
    expect(Number(attr(render(state), 'data-active-robot-count'))).toBe(expected)
  })

  test('lifecycle category counts reconcile without double counting', () => {
    const state = blankState()
    const traveling = outbound('A', 1)
    const queued = { ...outbound('A', 2, 'QUEUED_FOR_DROP'), queuePosition: 1 }
    const drop = outbound('B', 3, 'AT_DROP')
    const take = outbound('B', 4, 'SHIFTING_TO_TAKE')
    const returning = { ...outbound('C', 5, 'RETURNING_TO_RACK'), ownsPayload: false, returnProgress: 0.5 }
    state.asrsRobotSystem.outboundRobots = [traveling, queued, drop, take, returning]
    state.asrsRobotSystem.exchangers.B.dropRobotId = 3
    state.asrsRobotSystem.exchangers.B.shiftingOrTakeRobotId = 4
    const markup = render(state)
    const categories = ['data-traveling-count', 'data-queued-count', 'data-drop-count', 'data-shift-take-count', 'data-returning-count']
    expect(categories.reduce((sum, name) => sum + Number(attr(markup, name)), 0)).toBe(5)
  })

  test('A, B, and C cards report independent exchanger state', () => {
    const state = blankState()
    for (const [source, depth] of [['A', 1], ['B', 2], ['C', 3]] as Array<[SourceId, number]>) state.asrsRobotSystem.exchangers[source].queueLength = depth
    const markup = render(state)
    expect(attr(card(markup, 'A'), 'data-queue-depth')).toBe('1')
    expect(attr(card(markup, 'B'), 'data-queue-depth')).toBe('2')
    expect(attr(card(markup, 'C'), 'data-queue-depth')).toBe('3')
  })

  test('queue depth and four-robot visible cap are reported', () => {
    const state = blankState()
    state.asrsRobotSystem.exchangers.A.queueLength = 7
    const markup = card(render(state), 'A')
    expect(attr(markup, 'data-queue-depth')).toBe('7')
    expect(attr(markup, 'data-visible-queue-depth')).toBe('4')
  })

  test('queue overflow starts after authoritative queue position four', () => {
    const state = blankState()
    state.asrsRobotSystem.exchangers.B.queueLength = 9
    expect(attr(card(render(state), 'B'), 'data-queue-overflow')).toBe('5')
  })

  test('DROP robot identity and mission type render with full semantics', () => {
    const state = blankState()
    const robot = outbound('A', 12001, 'AT_DROP')
    state.asrsRobotSystem.outboundRobots = [robot]
    state.asrsRobotSystem.exchangers.A.dropRobotId = robot.robotId
    const markup = card(render(state), 'A')
    expect(attr(markup, 'data-drop-robot-id')).toBe('12001')
    expect(attr(markup, 'data-drop-mission-type')).toBe('CARTBUILD')
    expect(markup).toContain('R001 CARTBUILD')
  })

  test('blocked DROP status includes reason and duration', () => {
    const state = blankState()
    const robot = outbound('B', 22, 'BLOCKED_FROM_DROP')
    state.asrsRobotSystem.outboundRobots = [robot]
    Object.assign(state.asrsRobotSystem.exchangers.B, { dropRobotId: 22, dropBlocked: true, dropBlockedReason: 'PILE_ENTRANCE_OCCUPIED', dropBlockedDurationSec: 3.5 })
    const markup = card(render(state), 'B')
    expect(attr(markup, 'data-drop-blocked')).toBe('true')
    expect(markup).toContain('PILE_ENTRANCE_OCCUPIED 3.5s')
    expect(markup).toContain('asrs-status blocked')
  })

  test('SHIFT and TAKE robot identity renders', () => {
    const state = blankState()
    const robot = outbound('C', 33, 'SHIFTING_TO_TAKE')
    state.asrsRobotSystem.outboundRobots = [robot]
    state.asrsRobotSystem.exchangers.C.shiftingOrTakeRobotId = 33
    expect(attr(card(render(state), 'C'), 'data-take-robot-id')).toBe('33')
  })

  test('returning robot counts include outbound and inbound-only returns', () => {
    const state = blankState()
    state.asrsRobotSystem.outboundRobots = [{ ...outbound('A', 1, 'RETURNING_TO_RACK'), returnProgress: 0.4 }]
    state.asrsRobotSystem.inboundOnlyRobots = [{ ...inbound('A', 2, 'RETURNING_TO_RACK'), returnProgress: 0.7 }]
    expect(attr(card(render(state), 'A'), 'data-returning-count')).toBe('2')
  })

  test('inbound tray reservations expose count and full tray IDs', () => {
    const state = blankState()
    state.asrsRobotSystem.inboundReservations = [{ trayId: 7001, loadState: 'EMPTY', exchanger: 'B', robotId: 81, missionId: 91, reservedAtSec: 20 }]
    const markup = render(state)
    const row = markup.match(/<div class="asrs-reservation-row"[^>]*data-asrs-reservation-exchanger="B"[^>]*>/)?.[0] ?? ''
    expect(attr(row, 'data-reserved-inbound-count')).toBe('1')
    expect(attr(row, 'data-reserved-inbound-ids')).toBe('7001')
  })

  test('cartbuild committed and available positions match lane state', () => {
    const state = blankState()
    Object.assign(state.cartbuildSystem.lanes.CARTBUILD_C, { committedPositions: 12, availablePositions: 18 })
    const row = render(state).match(/<div class="asrs-reservation-row"[^>]*data-asrs-reservation-exchanger="C"[^>]*>/)?.[0] ?? ''
    expect(attr(row, 'data-cartbuild-committed')).toBe('12')
    expect(attr(row, 'data-cartbuild-available')).toBe('18')
  })

  test('completed classifications reconcile to completed history', () => {
    const state = blankState()
    state.asrsRobotSystem.completedCycles = [
      { cycleType: 'DUAL_CYCLE' } as CompletedOutboundCycle,
      { cycleType: 'OUTBOUND_ONLY' } as CompletedOutboundCycle,
      { cycleType: 'INBOUND_ONLY' } as CompletedOutboundCycle,
    ]
    state.asrsRobotSystem.completedCountByClassification = { DUAL_CYCLE: 1, OUTBOUND_ONLY: 1, INBOUND_ONLY: 1, CANCELLED_INBOUND_ONLY: 0 }
    const markup = render(state)
    expect(markup).toContain('Completed total</span><span class="value ">3')
    expect(markup).toContain('Dual / outbound / inbound</span><span class="value ">1/1/1')
  })

  test('dual utilization excludes inbound-only and cancelled history', () => {
    const state = blankState()
    state.asrsRobotSystem.completedCountByClassification = { DUAL_CYCLE: 3, OUTBOUND_ONLY: 1, INBOUND_ONLY: 40, CANCELLED_INBOUND_ONLY: 20 }
    expect(attr(render(state), 'data-dual-utilization')).toBe('75.0')
  })

  test('zero-denominator dual utilization renders as 0%', () => {
    const markup = render(blankState())
    expect(attr(markup, 'data-dual-utilization')).toBe('0.0')
    expect(markup).toContain('Dual utilization</span><span class="value ">0%')
  })

  test('cancelled robots remain history-only and are not active', () => {
    const state = blankState()
    state.asrsRobotSystem.inboundOnlyRobots = [{ ...inbound('A', 51, 'CANCELLED'), cancellationTimeSec: 10, cancellationReason: 'CLAIMED_BY_OUTBOUND_ROBOT' }]
    state.asrsRobotSystem.cancelledInboundOnlyRobots = [{ robotId: 51, missionId: 1051, exchanger: 'A', reservedTrayId: 2051, cancellationTimeSec: 10, cancellationReason: 'CLAIMED_BY_OUTBOUND_ROBOT', cancelledAfterAdmission: false, rackArrivalTimeSec: null }]
    const markup = render(state)
    expect(attr(markup, 'data-active-robot-count')).toBe('0')
    expect(attr(markup, 'data-cancelled-count')).toBe('1')
  })

  test('full IDs remain in tooltips when visible robot IDs are abbreviated', () => {
    const state = blankState()
    const robot = outbound('C', 987654, 'AT_DROP')
    state.asrsRobotSystem.outboundRobots = [robot]
    state.asrsRobotSystem.exchangers.C.dropRobotId = robot.robotId
    const markup = card(render(state), 'C')
    expect(markup).toContain('R654 CARTBUILD')
    expect(markup).toContain('title="Robot 987654 / mission 988654"')
  })

  test('collapsing and expanding does not mutate the snapshot', () => {
    const state = engine().getState()
    const before = JSON.stringify(state)
    expect(render(state, true)).not.toContain('data-asrs-robot-summary')
    expect(render(state, false)).toContain('data-asrs-robot-summary')
    expect(JSON.stringify(state)).toBe(before)
  })

  test('runtime advancement replaces diagnostics without stale values', () => {
    const runtime = engine()
    const before = render(runtime.getState())
    runtime.step(181)
    const after = render(runtime.getState())
    expect(attr(before, 'data-queued-count')).toBe('0')
    expect(Number(attr(after, 'data-queued-count'))).toBeGreaterThan(0)
    expect((after.match(/data-asrs-robot-summary/g) ?? [])).toHaveLength(1)
  })

  test('reset clears robot history and restores deterministic diagnostics', () => {
    const runtime = engine()
    runtime.step(230)
    runtime.reset()
    const state = runtime.getState()
    const markup = render(state)
    expect(state.asrsRobotSystem.completedCycles).toHaveLength(0)
    expect(attr(markup, 'data-cancelled-count')).toBe('0')
    expect(attr(markup, 'data-active-robot-count')).toBe('100')
  })

  test('existing control and material diagnostics remain present and balanced', () => {
    const markup = render(engine().getState())
    for (const heading of ['Process enablement', 'SRS demand control', 'Simulation', 'Material', 'Outbound', 'Return', 'Cartbuild']) expect(markup).toContain(heading)
    expect(markup).toContain('Balance</span><span class="value ok">0')
    expect(markup).toContain('Carton balance</span><span class="value ok">0')
  })
})
