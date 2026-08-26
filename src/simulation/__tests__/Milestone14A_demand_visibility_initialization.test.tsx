import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import App from '../../App'
import ConveyorDiagram from '../../visualization/ConveyorDiagram'
import { HYBRID_PILE_CONFIGS, MDR_ZONE_LENGTH_FT, MDR_ZONE_TRANSFER_SEC } from '../Milestone7Simulation'
import SimulationEngine from '../SimulationEngine'
import { DEFAULT_SRS_TARGETS } from '../srsTargets'
import type { SourceId, Tray } from '../types'

const SEGMENTS = [
  ['A1',103.5,45],['B1',86,38],['C1',86,38],['PRE_T',15,6],['T',30,12],['D',230,92],['PURGE',30,12],['E',70,28],['X',10,4],['S',20,8],['A2',136,58],['B2',118.5,51],['C2',118.5,51],
  ['CARTBUILD_A',75,30],['CARTBUILD_B',75,30],['CARTBUILD_C',75,30],
].map(([id,lengthFt,maxOccupancy]) => ({ id: String(id), lengthFt: Number(lengthFt), speedFtPerMin: 120, maxOccupancy: Number(maxOccupancy) }))
const SETTINGS = { korberEnabled: true, cartbuildAEnabled: true, cartbuildBEnabled: true, cartbuildCEnabled: true }
const EXPECTED_MDR_COUNTS = { A1: { pre: 5, post: 5, downstream: 15 }, B1: { pre: 5, post: 5, downstream: 8 }, C1: { pre: 5, post: 5, downstream: 8 } } as const

const pileTrays = (trays: Tray[], pileId: string) => trays.filter((tray) => tray.pilePlacement?.pileId === pileId)
const placementKey = (tray: Tray) => tray.pilePlacement?.component === 'BELT'
  ? `${tray.pilePlacement.pileId}:BELT:${tray.pilePlacement.beltPosFt}`
  : `${tray.pilePlacement?.pileId}:${tray.pilePlacement?.component}:${tray.pilePlacement?.zoneIndex}`
const sequence = (trays: Tray[]) => trays.map((tray) => [tray.id, tray.originSourceId, tray.loadState, tray.pilePlacement])
const expectedPlacements = (downstream: number, count: number) => [
  ...Array.from({ length: downstream }, (_, index) => ({ component: 'MDR_DOWNSTREAM', zoneIndex: downstream - 1 - index })),
  { component: 'BELT', beltPosFt: 20.5 },
  ...Array.from({ length: 5 }, (_, index) => ({ component: 'MDR_POST_DETRAYER', zoneIndex: 4 - index })),
  ...Array.from({ length: 5 }, (_, index) => ({ component: 'MDR_PRE_DETRAYER', zoneIndex: 4 - index })),
].slice(0, count)
const render = (engine: SimulationEngine) => {
  const state = engine.getState()
  return renderToStaticMarkup(createElement(ConveyorDiagram, { segments: state.segments, trays: state.trays, state }))
}

describe('Milestone 14A demand visibility and hybrid-pile initialization', () => {
  test('keeps authoritative 30-inch MDR geometry, 1.25-second travel, and zone counts', () => {
    expect(MDR_ZONE_LENGTH_FT * 12).toBe(30)
    expect(MDR_ZONE_TRANSFER_SEC).toBe(1.25)
    expect(Object.fromEntries(Object.entries(HYBRID_PILE_CONFIGS).map(([pileId, config]) => [pileId, { pre: config.preDetrayerMdrCount, post: config.postDetrayerMdrCount, downstream: config.downstreamMdrCount }]))).toEqual(EXPECTED_MDR_COUNTS)
  })

  test('initializes exactly one centered belt tray and all remaining trays in unique valid MDR positions', () => {
    const state = new SimulationEngine(SEGMENTS).getState()
    const ids = state.trays.map(({ id }) => id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const pileId of ['A1', 'B1', 'C1'] as const) {
      const trays = pileTrays(state.trays, pileId)
      const belt = trays.filter((tray) => tray.pilePlacement?.component === 'BELT')
      const mdr = trays.filter((tray) => tray.pilePlacement?.component !== 'BELT')
      const counts = EXPECTED_MDR_COUNTS[pileId]
      expect(trays).toHaveLength(DEFAULT_SRS_TARGETS[pileId])
      expect(belt).toHaveLength(1)
      expect(belt[0].pilePlacement?.beltPosFt).toBe(20.5)
      expect(mdr).toHaveLength(DEFAULT_SRS_TARGETS[pileId] - 1)
      expect(new Set(trays.map(placementKey)).size).toBe(trays.length)
      for (const tray of mdr) {
        const placement = tray.pilePlacement!
        const limit = placement.component === 'MDR_PRE_DETRAYER' ? counts.pre : placement.component === 'MDR_POST_DETRAYER' ? counts.post : counts.downstream
        expect(placement.zoneIndex).toBeGreaterThanOrEqual(0)
        expect(placement.zoneIndex).toBeLessThan(limit)
      }
    }
    expect(state.materialBalanceError).toBe(0)
  })

  test('reset and Start Scenario reproduce deterministic tray identity, ownership, and placement', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const initial = sequence(engine.getState().trays)
    let startingId = 1
    for (const [pileId, source, downstream] of [['A1', 'A', 15], ['B1', 'B', 8], ['C1', 'C', 8]] as const) {
      const trays = pileTrays(engine.getState().trays, pileId)
      expect(trays.map(({ id }) => id)).toEqual(Array.from({ length: DEFAULT_SRS_TARGETS[pileId] }, (_, index) => startingId + index))
      expect(trays.map(({ pilePlacement }) => {
        const { component, zoneIndex, beltPosFt } = pilePlacement!
        return component === 'BELT' ? { component, beltPosFt } : { component, zoneIndex }
      })).toEqual(expectedPlacements(downstream, DEFAULT_SRS_TARGETS[pileId]))
      expect(trays.every((tray) => tray.originSourceId === source && tray.loadState === 'EMPTY')).toBe(true)
      startingId += DEFAULT_SRS_TARGETS[pileId]
    }
    engine.step(5)
    engine.reset()
    expect(sequence(engine.getState().trays)).toEqual(initial)
    engine.step(5)
    engine.startScenario(SETTINGS, 10, DEFAULT_SRS_TARGETS)
    expect(sequence(engine.getState().trays)).toEqual(initial)
  })

  test('renders accessible authoritative Pending Demand badges and updates them through real playback', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const before = engine.getState()
    const beforeMarkup = render(engine)
    for (const source of ['A', 'B', 'C'] as SourceId[]) {
      const pileId = `${source}1`
      expect(beforeMarkup).toContain(`data-pending-demand-pile="${pileId}" data-pending-demand="${before.srsControl.lanes[source].pendingDemand}"`)
      expect(beforeMarkup).toContain(`Pending Demand: ${before.srsControl.lanes[source].pendingDemand}`)
      expect(beforeMarkup).toContain(`aria-label="${pileId} Pending Demand: ${before.srsControl.lanes[source].pendingDemand}"`)
    }

    engine.step(181)
    const after = engine.getState()
    const afterMarkup = render(engine)
    expect(after.timeSec).toBeCloseTo(181)
    expect(after.srsControl.lanes.B.pendingDemand).not.toBe(before.srsControl.lanes.B.pendingDemand)
    expect(after.srsControl.lanes.B.pendingDemand).toBe(after.missions.filter((mission) => mission.assignedExchanger === 'B' && mission.state !== 'RELEASED').length)
    for (const source of ['A', 'B', 'C'] as SourceId[]) {
      const pileId = `${source}1`
      expect(afterMarkup).toContain(`data-pending-demand-pile="${pileId}" data-pending-demand="${after.srsControl.lanes[source].pendingDemand}"`)
      expect(afterMarkup).toContain(`aria-label="${pileId} Pending Demand: ${after.srsControl.lanes[source].pendingDemand}"`)
    }
  })

  test.each([['A1', 26], ['B1', 19], ['C1', 19]] as const)('%s accepts its exact derived initialization capacity of %i', (pileId, capacity) => {
    const engine = new SimulationEngine(SEGMENTS)
    engine.startScenario(SETTINGS, 10, { ...DEFAULT_SRS_TARGETS, [pileId]: capacity })
    expect(pileTrays(engine.getState().trays, pileId)).toHaveLength(capacity)
  })

  test.each([['A1', 27, 25], ['B1', 20, 18], ['C1', 20, 18]] as const)('%s atomically rejects %i initial trays', (pileId, invalid, mdrPositions) => {
    const engine = new SimulationEngine(SEGMENTS)
    engine.step(1)
    const before = engine.getState()
    expect(() => engine.startScenario(SETTINGS, 10, { ...DEFAULT_SRS_TARGETS, [pileId]: invalid })).toThrow(`${pileId} initial tray count ${invalid} exceeds one belt position plus ${mdrPositions} MDR positions`)
    expect(engine.getState()).toEqual(before)
  })

  test('narrow viewports use a local horizontal scroller and preserve a 1200px schematic width', () => {
    const appMarkup = renderToStaticMarkup(createElement(App))
    expect(appMarkup).toContain('class="diagram-frame" data-schematic-scroll-container="true" data-narrow-schematic-min-width="1200" style="overflow-x:auto;overflow-y:hidden"')
    expect(render(new SimulationEngine(SEGMENTS))).toContain('data-responsive-min-width="1200"')
  })
})
