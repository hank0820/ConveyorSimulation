import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import SimulationEngine from '../simulation/SimulationEngine'
import ConveyorDiagram from './ConveyorDiagram'

const SEGMENTS = [
  { id: 'A1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'A1T', maxOccupancy: 24 },
  { id: 'A1T', lengthFt: 59, speedFtPerMin: 120, nextSegmentId: 'T' },
  { id: 'B1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'B1T', maxOccupancy: 16 },
  { id: 'B1T', lengthFt: 44, speedFtPerMin: 120, nextSegmentId: 'T' },
  { id: 'C1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'T', maxOccupancy: 16 },
  { id: 'T', lengthFt: 33, speedFtPerMin: 120, nextSegmentId: 'D', maxOccupancy: 12 },
  { id: 'D', lengthFt: 235, speedFtPerMin: 120, maxOccupancy: 73 },
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
  const match = markup.match(new RegExp(`<g data-tray-id="${trayId}"[^>]*><circle cx="([^"]+)"`))
  expect(match, `rendered tray ${trayId}`).not.toBeNull()
  return Number(match![1])
}

describe('ConveyorDiagram rendering integrity', () => {
  test('129 physical trays render once with unique stable tray IDs', () => {
    const markup = renderEngine(createEngine())
    const renderedIds = attributeValues(markup, 'data-tray-id').map(Number)

    expect(renderedIds).toHaveLength(129)
    expect(new Set(renderedIds).size).toBe(129)
    expect(renderedIds.sort((a, b) => a - b)).toEqual(Array.from({ length: 129 }, (_, index) => index + 1))
  })

  test('upstream and downstream zone identifiers are globally unique and semantic', () => {
    const markup = renderEngine(createEngine())
    const zoneIds = attributeValues(markup, 'data-zone-id')

    expect(zoneIds).toHaveLength(53)
    expect(new Set(zoneIds).size).toBe(zoneIds.length)
    expect(zoneIds).toContain('A1:MDR_UPSTREAM:0')
    expect(zoneIds).toContain('A1:MDR_DOWNSTREAM:0')
    expect(zoneIds).toContain('B1:MDR_UPSTREAM:0')
    expect(zoneIds).toContain('C1:MDR_DOWNSTREAM:6')
  })

  test('advancing replaces a tray position without retaining its former rendered element', () => {
    const engine = createEngine()
    const initialMarkup = renderEngine(engine)
    const initialX = renderedTrayX(initialMarkup, 129)

    engine.step(0.1)
    const advancedMarkup = renderEngine(engine)
    const advancedX = renderedTrayX(advancedMarkup, 129)

    expect(advancedX).not.toBe(initialX)
    expect(attributeValues(advancedMarkup, 'data-tray-id').filter((id) => id === '129')).toHaveLength(1)
  })

  test('reset removes runtime-created tray elements and restores initial rendering', () => {
    const engine = createEngine()
    engine.step(200)
    const advancedMarkup = renderEngine(engine)
    expect(attributeValues(advancedMarkup, 'data-tray-id').some((id) => Number(id) > 129)).toBe(true)

    engine.reset()
    const resetMarkup = renderEngine(engine)
    const resetIds = attributeValues(resetMarkup, 'data-tray-id').map(Number)
    expect(resetIds).toHaveLength(129)
    expect(resetIds.every((id) => id <= 129)).toBe(true)
  })

  test('an earlier snapshot is not mutated by later engine movement', () => {
    const engine = createEngine()
    const initial = engine.getState()
    const initialTray = initial.trays.find((tray) => tray.id === 9)!
    const initialBeltPosition = initialTray.pilePlacement?.beltPosFt

    engine.step(1)

    expect(initialTray.pilePlacement?.beltPosFt).toBe(initialBeltPosition)
  })
})
