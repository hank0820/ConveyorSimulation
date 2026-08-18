import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import SimulationEngine from '../simulation/SimulationEngine'
import ConveyorDiagram from './ConveyorDiagram'

const SEGMENTS = [
  { id: 'A1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'PRE_T', maxOccupancy: 24 },
  { id: 'B1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'PRE_T', maxOccupancy: 16 },
  { id: 'C1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'T', maxOccupancy: 16 },
  { id: 'PRE_T', lengthFt: 20, speedFtPerMin: 120, nextSegmentId: 'T', maxOccupancy: 8 },
  { id: 'T', lengthFt: 30, speedFtPerMin: 120, nextSegmentId: 'D', maxOccupancy: 12 },
  { id: 'D', lengthFt: 235, speedFtPerMin: 120, maxOccupancy: 94 },
]

const RETURN_SEGMENTS = [
  ...SEGMENTS,
  { id: 'PURGE', lengthFt: 15, speedFtPerMin: 120, nextSegmentId: 'X', maxOccupancy: 6 },
  { id: 'E', lengthFt: 87.5, speedFtPerMin: 120, nextSegmentId: 'X', maxOccupancy: 35 },
  { id: 'X', lengthFt: 12.5, speedFtPerMin: 120, maxOccupancy: 5 },
  { id: 'S', lengthFt: 20, speedFtPerMin: 120, maxOccupancy: 8 },
  { id: 'A2', lengthFt: 90, speedFtPerMin: 120, maxOccupancy: 36 },
  { id: 'B2', lengthFt: 72.5, speedFtPerMin: 120, maxOccupancy: 29 },
  { id: 'C2', lengthFt: 72.5, speedFtPerMin: 120, maxOccupancy: 29 },
]

const CARTBUILD_SEGMENTS = [
  ...RETURN_SEGMENTS,
  { id: 'CARTBUILD_A', lengthFt: 75, speedFtPerMin: 120, maxOccupancy: 30 },
  { id: 'CARTBUILD_B', lengthFt: 75, speedFtPerMin: 120, maxOccupancy: 30 },
  { id: 'CARTBUILD_C', lengthFt: 75, speedFtPerMin: 120, maxOccupancy: 30 },
]

function createEngine() {
  const engine = new SimulationEngine(SEGMENTS)
  engine.reset()
  return engine
}

function renderEngine(engine: SimulationEngine): string {
  const state = engine.getState()
  return renderToStaticMarkup(createElement(ConveyorDiagram, { segments: state.segments, trays: state.trays, state }))
}

function attributeValues(markup: string, attribute: string): string[] {
  return [...markup.matchAll(new RegExp(`${attribute}="([^"]+)"`, 'g'))].map((match) => match[1])
}

function renderedTrayX(markup: string, trayId: number): number {
  const match = markup.match(new RegExp(`<g data-tray-id="${trayId}"[^>]*>[\\s\\S]*?<rect x="([^"]+)"`))
  expect(match, `rendered tray ${trayId}`).not.toBeNull()
  return Number(match![1])
}

function numericAttributes(markup: string, selector: string, attributes: string[]): number[] {
  const element = markup.match(new RegExp(`<[^>]+${selector}[^>]*>`))?.[0]
  expect(element, selector).toBeDefined()
  return attributes.map((attribute) => {
    const value = element!.match(new RegExp(`${attribute}="([^"]+)"`))?.[1]
    expect(value, `${selector} ${attribute}`).toBeDefined()
    return Number(value)
  })
}

describe('ConveyorDiagram rendering integrity', () => {
  test('150 physical trays render once with unique stable tray IDs', () => {
    const markup = renderEngine(createEngine())
    const renderedIds = attributeValues(markup, 'data-tray-id').map(Number)

    expect(renderedIds).toHaveLength(150)
    expect(new Set(renderedIds).size).toBe(150)
    expect(renderedIds.sort((a, b) => a - b)).toEqual(Array.from({ length: 150 }, (_, index) => index + 1))
  })

  test('upstream and downstream zone identifiers are globally unique and semantic', () => {
    const markup = renderEngine(createEngine())
    const zoneIds = attributeValues(markup, 'data-zone-id')

    expect(zoneIds).toHaveLength(167)
    expect(new Set(zoneIds).size).toBe(zoneIds.length)
    expect(zoneIds).toContain('A1:MDR_UPSTREAM:0')
    expect(zoneIds).toContain('A1:MDR_DOWNSTREAM:0')
    expect(zoneIds).toContain('B1:MDR_UPSTREAM:0')
    expect(zoneIds).toContain('C1:MDR_DOWNSTREAM:6')
    expect(zoneIds).toContain('PRE_T:MDR:7')
    expect(zoneIds).toContain('T:MDR:11')
    expect(zoneIds).toContain('D:MDR:93')
  })

  test('advancing replaces a tray position without retaining its former rendered element', () => {
    const engine = createEngine()
    const initialMarkup = renderEngine(engine)
    const initialX = renderedTrayX(initialMarkup, 149)

    engine.step(5)
    const advancedMarkup = renderEngine(engine)
    const advancedX = renderedTrayX(advancedMarkup, 149)

    expect(advancedX).not.toBe(initialX)
    expect(attributeValues(advancedMarkup, 'data-tray-id').filter((id) => id === '149')).toHaveLength(1)
  })

  test('reset removes runtime-created tray elements and restores initial rendering', () => {
    const engine = createEngine()
    engine.step(200)
    const advancedMarkup = renderEngine(engine)
    expect(attributeValues(advancedMarkup, 'data-tray-id').some((id) => Number(id) > 150)).toBe(true)

    engine.reset()
    const resetMarkup = renderEngine(engine)
    const resetIds = attributeValues(resetMarkup, 'data-tray-id').map(Number)
    expect(resetIds).toHaveLength(150)
    expect(resetIds.every((id) => id <= 150)).toBe(true)
  })

  test('an earlier snapshot is not mutated by later engine movement', () => {
    const engine = createEngine()
    const initial = engine.getState()
    const initialTray = initial.trays.find((tray) => tray.id === 9)!
    const initialBeltPosition = initialTray.pilePlacement?.beltPosFt

    engine.step(1)

    expect(initialTray.pilePlacement?.beltPosFt).toBe(initialBeltPosition)
  })

  test('return topology renders every semantic zone and tray lifecycle attributes', () => {
    const engine = new SimulationEngine(RETURN_SEGMENTS)
    const runtime = (engine as unknown as { milestone7: { trays: ReturnType<SimulationEngine['getState']>['trays'] } }).milestone7
    const held = runtime.trays.find((tray) => tray.zonePlacement?.conveyorId === 'D' && tray.zonePlacement.zoneIndex === 93)!
    held.zonePlacement = undefined
    held.korberHeld = true
    held.loadState = 'FULL'
    held.returnDestination = 'B2'
    held.purgeMember = true
    const markup = renderEngine(engine)
    const zoneIds = attributeValues(markup, 'data-zone-id')
    expect(zoneIds).toHaveLength(315)
    expect(new Set(zoneIds).size).toBe(zoneIds.length)
    for (const id of ['PURGE:MDR:5', 'E:MDR:34', 'X:MDR:4', 'S:MDR:7', 'A2:MDR:35', 'B2:MDR:28', 'C2:MDR:28']) expect(zoneIds).toContain(id)
    expect(markup).toContain(`data-tray-id="${held.id}"`)
    expect(attributeValues(markup, 'data-tray-id').filter((id) => Number(id) === held.id)).toHaveLength(1)
    expect(markup).toContain('data-load-state="FULL"')
    expect(markup).toContain('data-return-destination="B2"')
    expect(markup).toContain('data-purge-member="true"')
  })

  test('renders exact return zone counts, hybrid regions, and section labels', () => {
    const engine = new SimulationEngine(RETURN_SEGMENTS)
    const markup = renderEngine(engine)
    const zoneIds = attributeValues(markup, 'data-zone-id')
    const expected = { PRE_T: 8, T: 12, D: 94, PURGE: 6, E: 35, X: 5, S: 8, A2: 36, B2: 29, C2: 29 }
    for (const [id, count] of Object.entries(expected)) expect(zoneIds.filter((zoneId) => zoneId.startsWith(`${id}:MDR:`))).toHaveLength(count)
    for (const pile of ['A1', 'B1', 'C1']) {
      expect(markup).toContain(`data-conveyor-id="${pile}" data-region="MDR_UPSTREAM"`)
      expect(markup).toContain(`data-conveyor-id="${pile}" data-region="BELT"`)
      expect(markup).toContain(`data-conveyor-id="${pile}" data-region="MDR_DOWNSTREAM"`)
    }
    for (const label of ['A1 · 24', 'B1 · 16', 'C1 · 16', 'PRE_T · 8 zones', 'T · 12 zones', 'D · 94 zones', 'PURGE · 6 zones', 'E · 35 zones', 'X · 5 zones', 'S · 8 zones', 'A2 · 36 zones', 'B2 · 29 zones', 'C2 · 29 zones', 'KÖRBER', 'A EXCHANGER', 'B EXCHANGER', 'C EXCHANGER']) expect(markup).toContain(label)
  })

  test('renders every implemented route as a unique semantic connector', () => {
    const markup = renderEngine(new SimulationEngine(RETURN_SEGMENTS))
    const connectorIds = attributeValues(markup, 'data-connector-id')
    expect(connectorIds).toEqual([
      'A1-to-PRE_T', 'B1-to-PRE_T', 'PRE_T-to-T', 'C1-to-T', 'T-to-D', 'T-to-PURGE', 'D-to-KORBER', 'KORBER-to-E',
      'E-to-X', 'PURGE-to-X', 'X-to-C2', 'X-to-S', 'S-to-A2', 'S-to-B2', 'A2-to-A-exchanger', 'B2-to-B-exchanger', 'C2-to-C-exchanger',
    ])
    expect(new Set(connectorIds).size).toBe(connectorIds.length)
    expect(attributeValues(markup, 'data-flow-from')).toHaveLength(connectorIds.length)
    expect(attributeValues(markup, 'data-flow-to')).toHaveLength(connectorIds.length)
    expect(markup).toContain('data-connector-id="X-to-S" data-flow-from="X" data-flow-to="S"')
    expect(markup).toContain('data-connector-id="S-to-A2" data-flow-from="S" data-flow-to="A2"')
    expect(markup).toContain('data-connector-id="S-to-B2" data-flow-from="S" data-flow-to="B2"')
    expect(markup).toContain('data-connector-id="X-to-C2" data-flow-from="X" data-flow-to="C2"')
  })

  test('fits all eight S zones and their trays between the B and C exchangers', () => {
    const engine = new SimulationEngine(RETURN_SEGMENTS)
    const runtime = (engine as unknown as { milestone7: { trays: ReturnType<SimulationEngine['getState']>['trays'] } }).milestone7
    const sTrays = runtime.trays.slice(0, 8)
    sTrays.forEach((tray, zoneIndex) => {
      tray.pilePlacement = undefined
      tray.zonePlacement = { conveyorId: 'S', zoneIndex }
      tray.currentSegmentId = 'S'
    })
    const markup = renderEngine(engine)
    const [sX, sY, sWidth, sHeight] = numericAttributes(markup, 'data-conveyor-bounds="S"', ['data-bounds-x', 'data-bounds-y', 'data-bounds-width', 'data-bounds-height'])
    const [bX, , bWidth] = numericAttributes(markup, 'data-equipment-id="B_EXCHANGER"', ['data-bounds-x', 'data-bounds-y', 'data-bounds-width'])
    const [cX] = numericAttributes(markup, 'data-equipment-id="C_EXCHANGER"', ['data-bounds-x'])
    const sZoneElements = [...markup.matchAll(/<g data-zone-id="S:MDR:[^"]+"[^>]*>[\s\S]*?<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g)]

    expect(sZoneElements).toHaveLength(8)
    expect(sX).toBeGreaterThanOrEqual(bX + bWidth)
    expect(sX + sWidth).toBeLessThanOrEqual(cX)
    for (const [, xValue, yValue, widthValue, heightValue] of sZoneElements) {
      const [x, y, width, height] = [xValue, yValue, widthValue, heightValue].map(Number)
      expect(x).toBeGreaterThanOrEqual(sX)
      expect(x + width).toBeLessThanOrEqual(sX + sWidth)
      expect(y).toBeGreaterThanOrEqual(sY)
      expect(y + height).toBeLessThanOrEqual(sY + sHeight)
    }

    for (const tray of sTrays) {
      const trayRect = markup.match(new RegExp(`<g data-tray-id="${tray.id}"[^>]*>[\\s\\S]*?<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"`))
      expect(trayRect, `S tray ${tray.id}`).not.toBeNull()
      const [trayX, trayY, trayWidth, trayHeight] = trayRect!.slice(1).map(Number)
      expect(trayX).toBeGreaterThanOrEqual(sX)
      expect(trayX + trayWidth).toBeLessThanOrEqual(sX + sWidth)
      expect(trayY).toBeGreaterThanOrEqual(sY)
      expect(trayY + trayHeight).toBeLessThanOrEqual(sY + sHeight)
    }
  })

  test('uses a fixed responsive viewBox and keeps rendered rectangles inside it without duplicate SVG IDs', () => {
    const markup = renderEngine(new SimulationEngine(RETURN_SEGMENTS))
    expect(markup).toContain('viewBox="0 0 1600 1040"')
    expect(markup).toContain('preserveAspectRatio="xMidYMid meet"')
    const ids = [...markup.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1])
    expect(new Set(ids).size).toBe(ids.length)
    for (const match of markup.matchAll(/<rect[^>]* x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g)) {
      const [, x, y, width, height] = match.map(Number)
      expect(x).toBeGreaterThanOrEqual(0)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(x + width).toBeLessThanOrEqual(1600)
      expect(y + height).toBeLessThanOrEqual(1040)
    }
  })

  test('renders three 30-zone cartbuild lanes, detrayers, operators, and additive semantic connectors', () => {
    const markup = renderEngine(new SimulationEngine(CARTBUILD_SEGMENTS))
    const zoneIds = attributeValues(markup, 'data-zone-id')
    for (const source of ['A', 'B', 'C']) {
      expect(zoneIds.filter((id) => id.startsWith(`CARTBUILD_${source}:MDR:`))).toHaveLength(30)
      expect(markup).toContain(`data-detrayer-id="DETRAYER_${source}"`)
      expect(markup).toContain(`data-equipment-id="OPERATOR_${source}"`)
      expect(markup).toContain(`CARTBUILD ${source} · 30 zones`)
      expect(markup).toContain(`DETRAYER ${source}`)
      expect(markup).toContain(`OPERATOR ${source}`)
      expect(markup).toContain(`data-connector-id="DETRAYER-${source}-to-CARTBUILD-${source}"`)
      expect(markup).toContain(`data-connector-id="CARTBUILD-${source}-to-OPERATOR-${source}"`)
    }
    for (const legacy of ['A1-to-PRE_T', 'T-to-D', 'KORBER-to-E', 'X-to-C2', 'X-to-S', 'S-to-A2', 'S-to-B2']) {
      expect(markup).toContain(`data-connector-id="${legacy}"`)
    }
    const connectorIds = attributeValues(markup, 'data-connector-id')
    expect(new Set(connectorIds).size).toBe(connectorIds.length)
    expect(attributeValues(markup, 'data-flow-from')).toHaveLength(connectorIds.length)
    expect(attributeValues(markup, 'data-flow-to')).toHaveLength(connectorIds.length)
    for (const match of markup.matchAll(/<rect[^>]* x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g)) {
      const [, x, y, width, height] = match.map(Number)
      expect(x).toBeGreaterThanOrEqual(0)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(x + width).toBeLessThanOrEqual(1600)
      expect(y + height).toBeLessThanOrEqual(1040)
    }
  })

  test('renders one attached carton on a loaded tray and one semantic marker per lane carton without business IDs', () => {
    const engine = new SimulationEngine(CARTBUILD_SEGMENTS)
    const runtime = (engine as unknown as { milestone7: { trays: ReturnType<SimulationEngine['getState']>['trays']; cartons: Array<{ internalKey: number; laneId: 'CARTBUILD_A' | 'CARTBUILD_B' | 'CARTBUILD_C'; zoneIndex: number }>; totalTraysCreated: number; cartonIntroduced: { A: number; B: number; C: number } } }).milestone7
    const tray = runtime.trays[0]
    tray.loadState = 'FULL'
    tray.payloadOrigin = 'CARTBUILD'
    tray.cartbuildCartonAttached = true
    runtime.cartons = [
      { internalKey: 901, laneId: 'CARTBUILD_A', zoneIndex: 0 },
      { internalKey: 902, laneId: 'CARTBUILD_B', zoneIndex: 14 },
      { internalKey: 903, laneId: 'CARTBUILD_C', zoneIndex: 29 },
    ]
    runtime.cartonIntroduced = { A: 2, B: 1, C: 1 }
    const markup = renderEngine(engine)
    expect(attributeValues(markup, 'data-attached-carton')).toEqual(['true'])
    expect(attributeValues(markup, 'data-carton-marker')).toHaveLength(3)
    expect(attributeValues(markup, 'data-cartbuild-lane').filter((value) => value.startsWith('CARTBUILD_')).length).toBeGreaterThanOrEqual(93)
    expect(markup).toContain('data-payload-origin="CARTBUILD"')
    expect(markup).toContain('data-carton-state="ON_CONVEYOR"')
    expect(markup).not.toContain('data-carton-id')
    expect(new Set(attributeValues(markup, 'data-tray-id')).size).toBe(attributeValues(markup, 'data-tray-id').length)
    expect(new Set(attributeValues(markup, 'data-zone-id')).size).toBe(attributeValues(markup, 'data-zone-id').length - 3)
  })
})
