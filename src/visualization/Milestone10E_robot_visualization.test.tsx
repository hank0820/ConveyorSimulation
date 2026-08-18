import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import SimulationEngine from '../simulation/SimulationEngine'
import type { InboundRobotSnapshot, OutboundRobotSnapshot, SimulationStateWithProgress, SourceId } from '../simulation/types'
import ConveyorDiagram from './ConveyorDiagram'

const SEGMENTS = [
  ['A1',81,24],['B1',81,16],['C1',81,16],['PRE_T',20,8],['T',30,12],['D',235,94],['PURGE',15,6],['E',87.5,35],['X',12.5,5],['S',20,8],['A2',90,36],['B2',72.5,29],['C2',72.5,29],['CARTBUILD_A',75,30],['CARTBUILD_B',75,30],['CARTBUILD_C',75,30],
].map(([id,lengthFt,maxOccupancy]) => ({ id: String(id), lengthFt: Number(lengthFt), speedFtPerMin: 120, maxOccupancy: Number(maxOccupancy) }))

const state = () => new SimulationEngine(SEGMENTS).getState()
const renderState = (snapshot: SimulationStateWithProgress) => renderToStaticMarkup(createElement(ConveyorDiagram, { segments: snapshot.segments, trays: snapshot.trays, state: snapshot }))
const values = (markup: string, attribute: string) => [...markup.matchAll(new RegExp(`${attribute}="([^"]*)"`, 'g'))].map((match) => match[1])
const robotTag = (markup: string, robotId: number) => {
  const tag = markup.match(new RegExp(`<g data-robot-id="${robotId}"[^>]*>`))?.[0]
  expect(tag, `robot ${robotId}`).toBeDefined()
  return tag!
}
const robotGroup = (markup: string, robotId: number) => {
  const group = markup.match(new RegExp(`<g data-robot-id="${robotId}"[\\s\\S]*?</g>`))?.[0]
  expect(group, `robot ${robotId}`).toBeDefined()
  return group!
}
const aggregateTag = (markup: string, source: SourceId) => {
  const tag = markup.match(new RegExp(`<g data-asrs-transit-exchanger="${source}"[^>]*>`))?.[0]
  expect(tag, `aggregate ${source}`).toBeDefined()
  return tag!
}
const numberAttribute = (tag: string, attribute: string) => Number(tag.match(new RegExp(`${attribute}="([^"]+)"`))?.[1])
const stringAttribute = (tag: string, attribute: string) => tag.match(new RegExp(`${attribute}="([^"]*)"`))?.[1] ?? ''
const containedIds = (markup: string, source: SourceId) => stringAttribute(aggregateTag(markup, source), 'data-contained-robot-ids').split(',').filter(Boolean).map(Number)
const representedIds = (markup: string) => [
  ...values(markup, 'data-robot-id').map(Number),
  ...(['A', 'B', 'C'] as SourceId[]).flatMap((source) => containedIds(markup, source)),
]

const outbound = (snapshot: SimulationStateWithProgress, source: SourceId = 'A') => ({ ...snapshot.asrsRobotSystem.outboundRobots.find((robot) => robot.assignedExchanger === source)! })
const inbound = (overrides: Partial<InboundRobotSnapshot> = {}): InboundRobotSnapshot => ({
  robotId: 900, missionId: 900, assignedExchanger: 'A', lifecycleState: 'TRAVELING_TO_DROP', reservedTrayId: 149,
  assignedAtSec: 0, maturityTimeSec: 180, travelProgress: 0, queuePosition: null, cancellationTimeSec: null,
  cancellationReason: null, cancelledAfterAdmission: false, ownsInboundTray: false, inboundTrayId: null,
  inboundTrayLoadState: null, takePickupTimeSec: null, rackArrivalTimeSec: null, returnProgress: 0, ...overrides,
})
const isolate = (snapshot: SimulationStateWithProgress, outboundRobots: OutboundRobotSnapshot[] = [], inboundOnlyRobots: InboundRobotSnapshot[] = []) => {
  snapshot.asrsRobotSystem.outboundRobots = outboundRobots
  snapshot.asrsRobotSystem.inboundOnlyRobots = inboundOnlyRobots
  for (const exchanger of Object.values(snapshot.asrsRobotSystem.exchangers)) {
    exchanger.dropRobotId = null
    exchanger.shiftingOrTakeRobotId = null
    exchanger.queue = []
  }
  return snapshot
}
const queued = (snapshot: SimulationStateWithProgress, source: SourceId, count: number, startId = 700) => {
  const base = outbound(snapshot, source)
  return Array.from({ length: count }, (_, index): OutboundRobotSnapshot => ({
    ...base, robotId: startId + index, missionId: startId + index, assignedExchanger: source,
    lifecycleState: index === 0 ? 'HEAD_OF_DROP_QUEUE' : 'QUEUED_FOR_DROP', queuePosition: index + 1,
  }))
}

describe('Milestone 10E ASRS robot visualization', () => {
  test('renders no more than authoritative Q1-Q4 individually per exchanger', () => {
    const snapshot = state()
    const robots = queued(snapshot, 'A', 8).reverse()
    isolate(snapshot, robots)
    const markup = renderState(snapshot)
    const individual = values(markup, 'data-robot-id').map(Number)
    expect(individual).toHaveLength(4)
    expect(new Set(individual)).toEqual(new Set(robots.filter(({ queuePosition }) => queuePosition! <= 4).map(({ robotId }) => robotId)))
    for (const robot of robots.filter(({ queuePosition }) => queuePosition! <= 4)) expect(robotTag(markup, robot.robotId)).toContain(`data-queue-position="${robot.queuePosition}"`)
  })

  test('Q1-Q4 use one distinct staging line and advance continuously without reordering', () => {
    const snapshot = state()
    isolate(snapshot, queued(snapshot, 'A', 4))
    const restingMarkup = renderState(snapshot)
    const restingCoordinates = Array.from({ length: 4 }, (_, index) => {
      const tag = robotTag(restingMarkup, 700 + index)
      expect(robotGroup(restingMarkup, 700 + index)).toContain(`data-queue-slot-label="Q${index + 1}"`)
      return [numberAttribute(tag, 'data-robot-x'), numberAttribute(tag, 'data-robot-y')]
    })
    expect(new Set(restingCoordinates.map(([x, y]) => `${x},${y}`)).size).toBe(4)
    expect(new Set(restingCoordinates.map(([x]) => x)).size).toBe(1)
    for (let index = 1; index < 4; index++) expect(restingCoordinates[index][1] - restingCoordinates[index - 1][1]).toBeGreaterThanOrEqual(24)
    expect(restingCoordinates[0][1]).toBeLessThan(restingCoordinates[1][1])

    snapshot.asrsRobotSystem.exchangers.A.queueAdvancementState = 'ADVANCING'
    snapshot.asrsRobotSystem.exchangers.A.queueAdvanceProgress = 0.5
    const advancingMarkup = renderState(snapshot)
    const advancingCoordinates = Array.from({ length: 4 }, (_, index) => [
      numberAttribute(robotTag(advancingMarkup, 700 + index), 'data-robot-x'),
      numberAttribute(robotTag(advancingMarkup, 700 + index), 'data-robot-y'),
    ])
    for (let index = 0; index < 4; index++) {
      expect(advancingCoordinates[index][0]).toBe(restingCoordinates[index][0])
      expect(advancingCoordinates[index][1]).toBeGreaterThan(restingCoordinates[index][1])
      expect(advancingCoordinates[index][1]).toBeLessThan(restingCoordinates[index][1] + 24)
    }
    expect(values(advancingMarkup, 'data-queue-position')).toEqual(values(restingMarkup, 'data-queue-position'))
  })

  test('overflow begins at Q5 and the next aggregate robot emerges into Q4 without duplication', () => {
    const snapshot = state()
    isolate(snapshot, queued(snapshot, 'A', 5))
    const before = renderState(snapshot)
    expect(containedIds(before, 'A')).toEqual([704])
    expect(numberAttribute(aggregateTag(before, 'A'), 'data-matured-overflow-count')).toBe(1)
    expect(values(before, 'data-robot-id')).not.toContain('704')

    snapshot.asrsRobotSystem.outboundRobots = snapshot.asrsRobotSystem.outboundRobots.slice(1).map((robot, index) => ({ ...robot, queuePosition: index + 1 }))
    snapshot.asrsRobotSystem.exchangers.A.queueAdvancementState = 'ADVANCING'
    snapshot.asrsRobotSystem.exchangers.A.queueAdvanceProgress = 0
    const after = renderState(snapshot)
    expect(containedIds(after, 'A')).toEqual([])
    expect(values(after, 'data-robot-id').filter((id) => id === '704')).toHaveLength(1)
    expect(robotTag(after, 704)).toContain('data-queue-position="4"')
    expect(numberAttribute(robotTag(after, 704), 'data-robot-y')).toBe(996)
  })

  test('traveling outbound and inbound-only robots appear only in transit aggregates', () => {
    const snapshot = state()
    const travelingOutbound = { ...outbound(snapshot), robotId: 801, missionId: 801, lifecycleState: 'TRAVELING_OUTBOUND' as const, queuePosition: null }
    const travelingInbound = inbound({ robotId: 802, missionId: 802 })
    isolate(snapshot, [travelingOutbound], [travelingInbound])
    const markup = renderState(snapshot)
    expect(values(markup, 'data-robot-id')).toEqual([])
    expect(containedIds(markup, 'A')).toEqual([801, 802])
  })

  test('DROP, SHIFT, TAKE, and RETURN robots remain individual', () => {
    const snapshot = state()
    const drop = { ...outbound(snapshot), robotId: 811, missionId: 811, lifecycleState: 'BLOCKED_FROM_DROP' as const, queuePosition: null, blockedReason: 'PILE_ENTRANCE_OCCUPIED' as const }
    const shift = { ...outbound(snapshot), robotId: 812, missionId: 812, lifecycleState: 'SHIFTING_TO_TAKE' as const, queuePosition: null, ownsPayload: false }
    const take = inbound({ robotId: 813, missionId: 813, lifecycleState: 'RETURNING_TO_RACK', returnProgress: 0 })
    const returning = inbound({ robotId: 814, missionId: 814, lifecycleState: 'RETURNING_TO_RACK', returnProgress: 0.5 })
    isolate(snapshot, [drop, shift], [take, returning])
    snapshot.asrsRobotSystem.exchangers.A.dropRobotId = drop.robotId
    snapshot.asrsRobotSystem.exchangers.A.shiftingOrTakeRobotId = shift.robotId
    snapshot.asrsRobotSystem.exchangers.A.lastSuccessfulDropTime = snapshot.timeSec
    const markup = renderState(snapshot)
    expect(robotTag(markup, 811)).toContain('data-asrs-position="DROP"')
    expect(robotGroup(markup, 811)).toContain('data-blocked="true"')
    expect(robotGroup(markup, 811)).toContain('stroke="#bd2c2c"')
    expect(robotTag(markup, 812)).toContain('data-asrs-position="SHIFT"')
    expect(robotTag(markup, 813)).toContain('data-asrs-position="TAKE"')
    expect(robotTag(markup, 814)).toContain('data-asrs-position="RETURN"')
  })

  test('no robot is represented both individually and in an aggregate', () => {
    const snapshot = state()
    isolate(snapshot, queued(snapshot, 'A', 10), [inbound({ robotId: 900, missionId: 900 })])
    const markup = renderState(snapshot)
    const individual = new Set(values(markup, 'data-robot-id').map(Number))
    const aggregate = new Set((['A', 'B', 'C'] as SourceId[]).flatMap((source) => containedIds(markup, source)))
    expect([...individual].filter((id) => aggregate.has(id))).toEqual([])
  })

  test('every active robot is represented exactly once across both forms', () => {
    const snapshot = state()
    const robots = [...queued(snapshot, 'A', 10), ...queued(snapshot, 'B', 9, 800)]
    const inboundRobots = [inbound({ robotId: 900 }), inbound({ robotId: 901, missionId: 901, lifecycleState: 'RETURNING_TO_RACK', returnProgress: 0.4 })]
    isolate(snapshot, robots, inboundRobots)
    const represented = representedIds(renderState(snapshot))
    const expected = [...robots.map(({ robotId }) => robotId), ...inboundRobots.map(({ robotId }) => robotId)]
    expect(represented).toHaveLength(expected.length)
    expect(new Set(represented)).toEqual(new Set(expected))
  })

  test('aggregate total equals CARTBUILD plus EMPTY plus INBOUND_ONLY', () => {
    const snapshot = state()
    const base = outbound(snapshot)
    isolate(snapshot, [
      { ...base, robotId: 820, missionId: 820, missionType: 'CARTBUILD', lifecycleState: 'TRAVELING_OUTBOUND' },
      { ...base, robotId: 821, missionId: 821, missionType: 'EMPTY', lifecycleState: 'TRAVELING_OUTBOUND' },
    ], [inbound({ robotId: 822, missionId: 822 })])
    const tag = aggregateTag(renderState(snapshot), 'A')
    const counts = ['data-cartbuild-count', 'data-empty-count', 'data-inbound-only-count'].map((attribute) => numberAttribute(tag, attribute))
    expect(numberAttribute(tag, 'data-aggregate-robot-count')).toBe(counts.reduce((sum, count) => sum + count, 0))
    expect(counts).toEqual([1, 1, 1])
  })

  test('matured overflow count excludes non-queued transit robots', () => {
    const snapshot = state()
    const robots = queued(snapshot, 'A', 10)
    robots.push({ ...outbound(snapshot), robotId: 850, missionId: 850, lifecycleState: 'TRAVELING_OUTBOUND', queuePosition: null })
    isolate(snapshot, robots)
    const tag = aggregateTag(renderState(snapshot), 'A')
    expect(numberAttribute(tag, 'data-aggregate-robot-count')).toBe(7)
    expect(numberAttribute(tag, 'data-matured-overflow-count')).toBe(6)
  })

  test('aggregate contained IDs are unique, sorted, and deterministic', () => {
    const snapshot = state()
    const base = outbound(snapshot)
    isolate(snapshot, [
      { ...base, robotId: 903, missionId: 903 }, { ...base, robotId: 901, missionId: 901 }, { ...base, robotId: 902, missionId: 902 },
    ])
    const first = containedIds(renderState(snapshot), 'A')
    const second = containedIds(renderState(snapshot), 'A')
    expect(first).toEqual([901, 902, 903])
    expect(new Set(first).size).toBe(first.length)
    expect(second).toEqual(first)
  })

  test('A, B, and C own independent four-slot queues, aggregates, and advancement progress', () => {
    const snapshot = state()
    isolate(snapshot, [...queued(snapshot, 'A', 5, 700), ...queued(snapshot, 'B', 5, 800), ...queued(snapshot, 'C', 5, 900)])
    snapshot.asrsRobotSystem.exchangers.A.queueAdvancementState = 'ADVANCING'
    snapshot.asrsRobotSystem.exchangers.A.queueAdvanceProgress = 0.25
    snapshot.asrsRobotSystem.exchangers.B.queueAdvancementState = 'ADVANCING'
    snapshot.asrsRobotSystem.exchangers.B.queueAdvanceProgress = 0.75
    snapshot.asrsRobotSystem.exchangers.C.queueAdvancementState = 'IDLE'
    snapshot.asrsRobotSystem.exchangers.C.queueAdvanceProgress = 0
    const markup = renderState(snapshot)
    for (const [source, overflowId] of [['A', 704], ['B', 804], ['C', 904]] as const) {
      const individualCount = [...markup.matchAll(new RegExp(`<g data-robot-id="[^"]+"[^>]*data-exchanger-id="${source}"`, 'g'))].length
      expect(individualCount).toBe(4)
      expect(containedIds(markup, source)).toEqual([overflowId])
    }
    const aY = numberAttribute(robotTag(markup, 700), 'data-robot-y')
    const bY = numberAttribute(robotTag(markup, 800), 'data-robot-y')
    const cY = numberAttribute(robotTag(markup, 900), 'data-robot-y')
    expect(aY).toBeGreaterThan(bY)
    expect(bY).toBeGreaterThan(cY)
  })

  test('payload rendering remains correct for visible FULL, EMPTY, and inbound robots', () => {
    const snapshot = state()
    const base = outbound(snapshot)
    const full = { ...base, robotId: 910, missionId: 910, missionType: 'CARTBUILD' as const, payloadLoadState: 'FULL' as const, cartbuildCartonAttached: true, ownsPayload: true, lifecycleState: 'QUEUED_FOR_DROP' as const, queuePosition: 1 }
    const empty = { ...base, robotId: 911, missionId: 911, missionType: 'EMPTY' as const, payloadLoadState: 'EMPTY' as const, cartbuildCartonAttached: false, ownsPayload: true, lifecycleState: 'QUEUED_FOR_DROP' as const, queuePosition: 2 }
    const returned = inbound({ robotId: 912, missionId: 912, lifecycleState: 'RETURNING_TO_RACK', ownsInboundTray: true, inboundTrayId: 149, inboundTrayLoadState: 'FULL', returnProgress: 0.5 })
    isolate(snapshot, [full, empty], [returned])
    const markup = renderState(snapshot)
    expect(robotGroup(markup, 910)).toContain('data-robot-carton="true"')
    expect(robotGroup(markup, 911)).toContain('data-robot-tray="true"')
    expect(robotGroup(markup, 911)).not.toContain('data-robot-carton')
    expect(robotGroup(markup, 912)).toContain('data-inbound-tray-id="149"')
  })

  test('completed and pre-admission-cancelled robots are absent from both forms', () => {
    const snapshot = state()
    isolate(snapshot, [{ ...outbound(snapshot), robotId: 920, missionId: 920, lifecycleState: 'OUTBOUND_COMPLETE' }], [
      inbound({ robotId: 921, missionId: 921, lifecycleState: 'INBOUND_COMPLETE' }),
      inbound({ robotId: 922, missionId: 922, lifecycleState: 'CANCELLED', cancellationTimeSec: 50, cancellationReason: 'CLAIMED_BY_OUTBOUND_ROBOT' }),
    ])
    expect(representedIds(renderState(snapshot))).toEqual([])
  })

  test('rendering does not mutate earlier snapshots', () => {
    const snapshot = state()
    const frozen = JSON.stringify(snapshot)
    renderState(snapshot)
    expect(JSON.stringify(snapshot)).toBe(frozen)
    const later = structuredClone(snapshot)
    later.asrsRobotSystem.outboundRobots[0].travelProgress = 0.75
    renderState(later)
    expect(JSON.stringify(snapshot)).toBe(frozen)
  })

  test('Reset removes stale individual and aggregate representations deterministically', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const initial = engine.getState()
    const initialRepresented = representedIds(renderState(initial))
    const prior = structuredClone(initial)
    prior.asrsRobotSystem.inboundOnlyRobots.push(inbound({ robotId: 999, missionId: 999, lifecycleState: 'RETURNING_TO_RACK', returnProgress: 0.5 }))
    expect(representedIds(renderState(prior))).toContain(999)
    engine.reset()
    const resetRepresented = representedIds(renderState(engine.getState()))
    expect(resetRepresented).toEqual(initialRepresented)
    expect(resetRepresented).not.toContain(999)
  })

  test('existing ASRS paths and labels retain globally unique semantic IDs', () => {
    const markup = renderState(state())
    expect(values(markup, 'data-asrs-path-id')).toEqual(['ASRS_PATH_A', 'ASRS_PATH_B', 'ASRS_PATH_C'])
    const positions = values(markup, 'data-asrs-position-id')
    const labels = values(markup, 'data-asrs-label-id')
    expect(positions).toEqual(['A_DROP', 'A_TAKE', 'B_DROP', 'B_TAKE', 'C_DROP', 'C_TAKE'])
    expect(new Set([...positions, ...labels]).size).toBe(12)
  })

  test('existing conveyor, tray, carton, zone, and connector semantics remain valid', () => {
    const markup = renderState(state())
    expect(new Set(values(markup, 'data-tray-id')).size).toBe(values(markup, 'data-tray-id').length)
    expect(new Set(values(markup, 'data-zone-id')).size).toBe(values(markup, 'data-zone-id').length)
    expect(new Set(values(markup, 'data-connector-id')).size).toBe(values(markup, 'data-connector-id').length)
    expect(values(markup, 'data-cartbuild-lane').filter((value) => value.startsWith('CARTBUILD_')).length).toBeGreaterThanOrEqual(90)
  })
})
