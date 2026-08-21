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
    const common = { state, playing: true, playbackSpeed: 20, setPlaybackSpeed: vi.fn(), onPlayPause: vi.fn(), onStep: vi.fn(), onReset: vi.fn(), onStartScenario: vi.fn(), onOperatingSettingChange: vi.fn(), onPlanningCadenceChange: vi.fn(), configurationNotice: null, onToggleCollapsed: vi.fn() }
    const expanded = renderToStaticMarkup(createElement(SimulationControls, { ...common, collapsed: false }))
    const collapsed = renderToStaticMarkup(createElement(SimulationControls, { ...common, collapsed: true }))
    expect(expanded).toContain('data-panel-state="expanded"')
    expect(expanded).toContain('System Status / Accounting')
    expect(expanded).toContain('Scenario Configuration')
    expect(expanded).toContain('SRS Control Diagnostics')
    expect(collapsed).toContain('data-panel-state="collapsed"')
    expect(collapsed).not.toContain('class="panel-body"')
    expect(JSON.stringify(state)).toBe(frozen)
    expect(engine.getState()).toEqual(state)
  })

  test('renders four accessible ON enablement controls and the configuration-pause notice', () => {
    const engine = new SimulationEngine(SEGMENTS)
    const state = engine.getState()
    const markup = renderToStaticMarkup(createElement(SimulationControls, {
      state, playing: false, playbackSpeed: 1, setPlaybackSpeed: vi.fn(), onPlayPause: vi.fn(), onStep: vi.fn(), onReset: vi.fn(), onStartScenario: vi.fn(),
      onOperatingSettingChange: vi.fn(), onPlanningCadenceChange: vi.fn(), configurationNotice: 'Simulation paused after configuration change', collapsed: false, onToggleCollapsed: vi.fn(),
    }))
    expect(markup).toContain('Process enablement')
    expect(markup).toContain('>Start Scenario</button>')
    for (const label of ['Körber', 'Cartbuild A', 'Cartbuild B', 'Cartbuild C']) expect(markup).toContain(label)
    expect((markup.match(/type="checkbox" checked=""/g) ?? [])).toHaveLength(4)
    expect((markup.match(/class="toggle-state">ON/g) ?? [])).toHaveLength(4)
    expect(markup).toContain('role="status">Simulation paused after configuration change')
  })

  test('renders SRS reservation, lane, bypass, and cadence diagnostics', () => {
    const state = new SimulationEngine([...SEGMENTS,
      { id: 'CARTBUILD_A', lengthFt: 75, speedFtPerMin: 120, maxOccupancy: 30 },
      { id: 'CARTBUILD_B', lengthFt: 75, speedFtPerMin: 120, maxOccupancy: 30 },
      { id: 'CARTBUILD_C', lengthFt: 75, speedFtPerMin: 120, maxOccupancy: 30 },
    ]).getState()
    const markup = renderToStaticMarkup(createElement(SimulationControls, {
      state, playing: false, playbackSpeed: 1, setPlaybackSpeed: vi.fn(), onPlayPause: vi.fn(), onStep: vi.fn(), onReset: vi.fn(), onStartScenario: vi.fn(),
      onOperatingSettingChange: vi.fn(), onPlanningCadenceChange: vi.fn(), configurationNotice: null, collapsed: false, onToggleCollapsed: vi.fn(), defaultOpenSections: ['srs-control'],
    }))
    expect(markup).toContain('SRS Control Diagnostics')
    expect(markup).toContain('aria-label="PendingDemand planning cadence"')
    expect(markup).toContain('value="10"')
    expect(markup).toContain('Target / current')
    expect((markup.match(/data-srs-lane=/g) ?? [])).toHaveLength(3)
    expect(markup).toContain('PurgeDemand')
    expect(markup).toContain('T bypass')
  })

  test('renders eight accessible target drafts, validation, dirty guidance, and disables Start', () => {
    const state = new SimulationEngine(SEGMENTS).getState()
    const selectedTargets = { A1: 'oops', B1: '16', C1: '16', T: '6', D: '92', A2: '36', B2: '29', C2: '29' }
    const markup = renderToStaticMarkup(createElement(SimulationControls, {
      state, playing: false, playbackSpeed: 1, setPlaybackSpeed: vi.fn(), onPlayPause: vi.fn(), onStep: vi.fn(), onReset: vi.fn(), onStartScenario: vi.fn(),
      selectedTargets, targetErrors: { A1: 'Enter an integer from 1 to 999' }, targetsDirty: true, onTargetChange: vi.fn(),
      onOperatingSettingChange: vi.fn(), onPlanningCadenceChange: vi.fn(), configurationNotice: null, collapsed: false, onToggleCollapsed: vi.fn(),
    }))
    expect(markup).toContain('data-srs-target-controls="true"')
    expect((markup.match(/aria-label="[A-Z0-9]+ target size"/g) ?? [])).toHaveLength(8)
    expect(markup).toContain('aria-invalid="true"')
    expect(markup).toContain('role="alert"')
    expect(markup).toContain('Start Scenario</button>')
    expect(markup).toContain('disabled=""')
    expect(markup).toContain('Apply with Start Scenario')
  })
})
