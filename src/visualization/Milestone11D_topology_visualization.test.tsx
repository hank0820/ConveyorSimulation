import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import SimulationEngine from '../simulation/SimulationEngine'
import ConveyorDiagram from './ConveyorDiagram'

const SEGMENTS = [
  ['A1',103.5,45],['B1',86,38],['C1',86,38],['PRE_T',15,6],['T',30,12],['D',230,92],['PURGE',30,12],['E',70,28],['X',10,4],['S',20,8],['A2',136,58],['B2',118.5,51],['C2',118.5,51],
  ['CARTBUILD_A',75,30],['CARTBUILD_B',75,30],['CARTBUILD_C',75,30],
].map(([id,lengthFt,maxOccupancy]) => ({ id: String(id), lengthFt: Number(lengthFt), speedFtPerMin: 120, maxOccupancy: Number(maxOccupancy) }))

const state = () => new SimulationEngine(SEGMENTS).getState()
const render = (snapshot = state()) => renderToStaticMarkup(createElement(ConveyorDiagram, { segments: snapshot.segments, trays: snapshot.trays, state: snapshot }))
const values = (markup: string, attribute: string) => [...markup.matchAll(new RegExp(`${attribute}="([^"]*)"`, 'g'))].map((match) => match[1])
const tags = (markup: string, attributes: Record<string, string>) => [...markup.matchAll(/<g [^>]+>/g)].map((match) => match[0]).filter((tag) => Object.entries(attributes).every(([name, value]) => tag.includes(`${name}="${value}"`)))
const elementWith = (markup: string, attribute: string, value: string) => markup.match(new RegExp(`<(?:g|text) [^>]*${attribute}="${value}"[^>]*>`))?.[0] ?? ''
const bounds = (tag: string) => ({
  x: Number(tag.match(/data-bounds-x="([^"]+)"/)?.[1]), y: Number(tag.match(/data-bounds-y="([^"]+)"/)?.[1]),
  width: Number(tag.match(/data-bounds-width="([^"]+)"/)?.[1]), height: Number(tag.match(/data-bounds-height="([^"]+)"/)?.[1]),
})
const labelBounds = (tag: string) => ({
  x: Number(tag.match(/data-label-bounds-x="([^"]+)"/)?.[1]), y: Number(tag.match(/data-label-bounds-y="([^"]+)"/)?.[1]),
  width: Number(tag.match(/data-label-bounds-width="([^"]+)"/)?.[1]), height: Number(tag.match(/data-label-bounds-height="([^"]+)"/)?.[1]),
})
const intersects = (left: ReturnType<typeof bounds>, right: ReturnType<typeof bounds>) => left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y

describe('Milestone 11D topology visualization', () => {
  test('renders authoritative outbound regions and detrayer order', () => {
    const markup = render()
    for (const [pile, downstream] of [['A1', 15], ['B1', 8], ['C1', 8]] as const) {
      expect(tags(markup, { 'data-conveyor-id': pile, 'data-region': 'MDR_PRE_DETRAYER' })).toHaveLength(5)
      expect(tags(markup, { 'data-conveyor-id': pile, 'data-region': 'MDR_POST_DETRAYER' })).toHaveLength(5)
      expect(tags(markup, { 'data-conveyor-id': pile, 'data-region': 'BELT' })).toHaveLength(1)
      expect(tags(markup, { 'data-conveyor-id': pile, 'data-region': 'MDR_DOWNSTREAM' })).toHaveLength(downstream)
      expect(markup).toContain(`data-detrayer-id="DETRAYER_${pile[0]}"`)
      expect(markup).toContain(`DETRAYER ${pile[0]} between pre-detrayer zone 4 and post-detrayer zone 0`)
    }
    expect(values(markup, 'data-component-label').filter((value) => value.endsWith(':BELT'))).toEqual(['A1:BELT', 'B1:BELT', 'C1:BELT'])
    expect((markup.match(/>41 ft BELT<\/text>/g) ?? [])).toHaveLength(3)
  })

  test('renders every shared conveyor zone including all 92 distinct D zones', () => {
    const markup = render()
    for (const [id, count] of [['PRE_T',6],['T',12],['D',92],['PURGE',12],['E',28],['X',4],['S',8]] as const) {
      expect(tags(markup, { 'data-conveyor-id': id, 'data-region': 'MDR' })).toHaveLength(count)
    }
    const dIds = tags(markup, { 'data-conveyor-id': 'D', 'data-region': 'MDR' }).map((tag) => tag.match(/data-zone-id="([^"]+)"/)?.[1])
    expect(new Set(dIds).size).toBe(92)
  })

  test('renders authoritative inbound MDR banks and three unique labeled coil paths', () => {
    const markup = render()
    for (const [id, sorter] of [['A2',33],['B2',26],['C2',26]] as const) {
      expect(tags(markup, { 'data-conveyor-id': id, 'data-region': 'MDR_SORTER_SIDE' })).toHaveLength(sorter)
      expect(tags(markup, { 'data-conveyor-id': id, 'data-region': 'SPIRAL' })).toHaveLength(1)
      expect(tags(markup, { 'data-conveyor-id': id, 'data-region': 'MDR_EXCHANGER_SIDE' })).toHaveLength(5)
      expect(markup).toContain(`data-spiral-path-id="${id}_SPIRAL_PATH"`)
      expect(markup).toContain(`data-component-label="${id}:SPIRAL"`)
    }
    expect(new Set(values(markup, 'data-spiral-path-id')).size).toBe(3)
    expect((markup.match(/>41 ft SPIRAL<\/text>/g) ?? [])).toHaveLength(3)
  })

  test('maps spiral trays monotonically and distinctly while rendering every tray once', () => {
    const snapshot = state()
    for (const [index, position] of [1, 9, 19, 31, 40].entries()) {
      const tray = snapshot.trays[index]
      delete tray.pilePlacement
      delete tray.zonePlacement
      tray.currentSegmentId = 'A2'
      tray.inboundPlacement = { conveyorId: 'A2', component: 'SPIRAL', spiralPosFt: position }
    }
    const markup = render(snapshot)
    const spiralTags = snapshot.trays.slice(0, 5).map((tray) => markup.match(new RegExp(`<g data-tray-id="${tray.id}"[^>]*>[\\s\\S]*?<rect x="([^"]+)" y="([^"]+)"`))!)
    const coordinates = spiralTags.map((match) => `${match[1]},${match[2]}`)
    const y = spiralTags.map((match) => Number(match[2]))
    expect(y).toEqual([...y].sort((a, b) => a - b))
    expect(new Set(coordinates).size).toBe(5)
    expect(values(markup, 'data-tray-id')).toHaveLength(snapshot.trays.length)
    expect(new Set(values(markup, 'data-tray-id')).size).toBe(snapshot.trays.length)
  })

  test('preserves return routing, TAKE termination, unique semantics, bounds, and snapshot immutability', () => {
    const snapshot = state()
    const frozen = JSON.stringify(snapshot)
    const markup = render(snapshot)
    for (const source of ['A', 'B', 'C']) expect(markup).toContain(`data-connector-id="${source}2-to-${source}-exchanger"`)
    expect(markup).toContain('data-connector-id="S-to-A2"')
    expect(markup).toContain('data-connector-id="S-to-B2"')
    expect(markup).toContain('data-connector-id="X-to-C2"')
    for (const attribute of ['data-zone-id', 'data-tray-id', 'data-connector-id', 'data-spiral-path-id']) expect(new Set(values(markup, attribute)).size).toBe(values(markup, attribute).length)
    expect(markup).toContain('viewBox="0 0 1600 1040"')
    expect(JSON.stringify(snapshot)).toBe(frozen)
  })

  test('contains restored operator labels and keeps all return count labels clear of their spirals', () => {
    const markup = render()
    const operatorA = bounds(elementWith(markup, 'data-equipment-id', 'OPERATOR_A'))
    const a1 = bounds(elementWith(markup, 'data-conveyor-display-bounds', 'A1'))
    expect(operatorA).toEqual({ x: 300, y: 180, width: 70, height: 34 })
    expect(markup).toContain('data-connector-id="CARTBUILD-A-to-OPERATOR-A" data-flow-from="CARTBUILD_A" data-flow-to="OPERATOR_A" data-flow-direction="CARTBUILD_A-to-OPERATOR_A" d="M335 235 L335 214"')
    const operatorFontSizes: number[] = []
    for (const source of ['A', 'B', 'C']) {
      const equipment = bounds(elementWith(markup, 'data-equipment-id', `OPERATOR_${source}`))
      const labelTag = elementWith(markup, 'data-equipment-label', `OPERATOR_${source}`)
      const label = labelBounds(labelTag)
      operatorFontSizes.push(Number(labelTag.match(/font-size="([^"]+)"/)?.[1]))
      expect(label.x).toBeGreaterThanOrEqual(equipment.x)
      expect(label.y).toBeGreaterThanOrEqual(equipment.y)
      expect(label.x + label.width).toBeLessThanOrEqual(equipment.x + equipment.width)
      expect(label.y + label.height).toBeLessThanOrEqual(equipment.y + equipment.height)
      expect(label.x).toBeGreaterThanOrEqual(0)
      expect(label.y).toBeGreaterThanOrEqual(0)
      expect(label.x + label.width).toBeLessThanOrEqual(1600)
      expect(label.y + label.height).toBeLessThanOrEqual(1040)
    }
    expect(new Set(operatorFontSizes)).toEqual(new Set([7.5]))
    expect(intersects(labelBounds(elementWith(markup, 'data-equipment-label', 'OPERATOR_A')), a1)).toBe(false)

    for (const id of ['A2', 'B2', 'C2']) {
      const labelTag = elementWith(markup, 'data-section-label', id)
      const label = bounds(labelTag)
      const spiral = bounds(elementWith(markup, 'data-spiral-display-bounds', id))
      expect(labelTag).toContain('y="645"')
      expect(intersects(label, spiral)).toBe(false)
      expect(label.x).toBeGreaterThanOrEqual(0)
      expect(label.y).toBeGreaterThanOrEqual(0)
      expect(label.x + label.width).toBeLessThanOrEqual(1600)
      expect(label.y + label.height).toBeLessThanOrEqual(1040)
    }
    expect(operatorA.x + operatorA.width).toBeLessThanOrEqual(1600)
  })
})
