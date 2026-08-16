import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import SimulationEngine from '../simulation/SimulationEngine'
import SimulationControls from './SimulationControls'

const SEGMENTS = [
  { id: 'A1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'PRE_T', maxOccupancy: 24 }, { id: 'B1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'PRE_T', maxOccupancy: 16 }, { id: 'C1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'T', maxOccupancy: 16 }, { id: 'PRE_T', lengthFt: 20, speedFtPerMin: 120, nextSegmentId: 'T', maxOccupancy: 8 }, { id: 'T', lengthFt: 30, speedFtPerMin: 120, nextSegmentId: 'D', maxOccupancy: 12 }, { id: 'D', lengthFt: 235, speedFtPerMin: 120, maxOccupancy: 94 }, { id: 'PURGE', lengthFt: 15, speedFtPerMin: 120, nextSegmentId: 'X', maxOccupancy: 6 }, { id: 'E', lengthFt: 87.5, speedFtPerMin: 120, nextSegmentId: 'X', maxOccupancy: 35 }, { id: 'X', lengthFt: 12.5, speedFtPerMin: 120, maxOccupancy: 5 }, { id: 'S', lengthFt: 20, speedFtPerMin: 120, maxOccupancy: 8 }, { id: 'A2', lengthFt: 90, speedFtPerMin: 120, maxOccupancy: 36 }, { id: 'B2', lengthFt: 72.5, speedFtPerMin: 120, maxOccupancy: 29 }, { id: 'C2', lengthFt: 72.5, speedFtPerMin: 120, maxOccupancy: 29 },
]

describe('SimulationControls panel', () => {
  test('expanded and collapsed rendering preserves the same simulation snapshot', () => {
    const engine = new SimulationEngine(SEGMENTS)
    engine.step(12.3)
    const state = engine.getState()
    const frozen = JSON.stringify(state)
    const common = { state, playing: true, playbackSpeed: 20, setPlaybackSpeed: vi.fn(), onPlayPause: vi.fn(), onStep: vi.fn(), onReset: vi.fn(), onToggleCollapsed: vi.fn() }
    const expanded = renderToStaticMarkup(createElement(SimulationControls, { ...common, collapsed: false }))
    const collapsed = renderToStaticMarkup(createElement(SimulationControls, { ...common, collapsed: true }))
    expect(expanded).toContain('data-panel-state="expanded"')
    expect(expanded).toContain('Material')
    expect(expanded).toContain('Outbound')
    expect(expanded).toContain('Return')
    expect(collapsed).toContain('data-panel-state="collapsed"')
    expect(collapsed).not.toContain('class="panel-body"')
    expect(JSON.stringify(state)).toBe(frozen)
    expect(engine.getState()).toEqual(state)
  })
})
