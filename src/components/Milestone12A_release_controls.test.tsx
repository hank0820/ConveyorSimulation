import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import SimulationEngine from '../simulation/SimulationEngine'
import SimulationControls from './SimulationControls'

const SEGMENTS = [
  ['A1',103.5,45],['B1',86,38],['C1',86,38],['PRE_T',15,6],['T',30,12],['D',230,92],['PURGE',30,12],['E',70,28],['X',10,4],['S',20,8],['A2',136,58],['B2',118.5,51],['C2',118.5,51],['CARTBUILD_A',75,30],['CARTBUILD_B',75,30],['CARTBUILD_C',75,30],
].map(([id,lengthFt,maxOccupancy]) => ({ id: String(id), lengthFt: Number(lengthFt), speedFtPerMin: 120, maxOccupancy: Number(maxOccupancy) }))

describe('Milestone 12A Release Control UI', () => {
  const render = (overrides = {}) => renderToStaticMarkup(createElement(SimulationControls, {
    state: new SimulationEngine(SEGMENTS).getState(), playing: false, playbackSpeed: 1, setPlaybackSpeed: vi.fn(), onPlayPause: vi.fn(), onStep: vi.fn(), onReset: vi.fn(), onStartScenario: vi.fn(),
    selectedSourceReleaseWindow: '10', onSourceReleaseWindowChange: vi.fn(), onOperatingSettingChange: vi.fn(), onPlanningCadenceChange: vi.fn(), configurationNotice: null, collapsed: false, onToggleCollapsed: vi.fn(), ...overrides,
  }))

  test('renders the shared selected window, active value, limits, and helper text', () => {
    const markup = render()
    expect(markup).toContain('Release Control')
    expect(markup).toContain('shared timed window')
    expect(markup).toContain('aria-label="Source release window"')
    expect(markup).toContain('min="0.1"')
    expect(markup).toContain('max="600"')
    expect(markup).toContain('Active: 10s')
  })

  test('preserves invalid selected text, reports the error, disables Start, and shows shared apply guidance', () => {
    const markup = render({ selectedSourceReleaseWindow: '', sourceReleaseWindowError: 'Enter a number from 0.1 to 600', sourceReleaseWindowDirty: true })
    expect(markup).toContain('aria-label="Source release window"')
    expect(markup).toContain('aria-invalid="true"')
    expect(markup).toContain('Enter a number from 0.1 to 600')
    expect(markup).toContain('disabled=""')
    expect(markup).toContain('Configuration edits are selected only. Apply with Start Scenario.')
  })

  test.each([
    ['ACTIVE', false, 'ACTIVE'],
    ['ACTIVE', true, 'ACTIVE · BYPASS PAUSED'],
    ['DRAINING', false, 'DRAINING'],
  ] as const)('renders authoritative %s paused=%s diagnostics', (phase, pausedForBypass, label) => {
    const state = new SimulationEngine(SEGMENTS).getState()
    state.srsControl.sourceGrant = { configuredWindowSec: 10, activeLane: 'A', phase, pausedForBypass, remainingWindowSec: phase === 'ACTIVE' ? 4.5 : 0, releasedCount: 3, enteredTCount: 2, drainingElapsedSec: phase === 'DRAINING' ? 1.5 : 0, handoffWaitReason: phase === 'DRAINING' ? 'PRE_T_DRAINING' : 'NONE' }
    const markup = render({ state, defaultOpenSections: ['srs-control'] })
    expect(markup).toContain(`data-source-grant-phase="${phase}"`)
    expect(markup).toContain(label)
    expect(markup).toContain('Released / entered T')
  })
})
