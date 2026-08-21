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
    selectedSourceReleases: { A: '8', B: '8', C: '8' }, onSourceReleaseChange: vi.fn(), onOperatingSettingChange: vi.fn(), onPlanningCadenceChange: vi.fn(), configurationNotice: null, collapsed: false, onToggleCollapsed: vi.fn(), ...overrides,
  }))

  test('renders the three selected drafts, active values, limits, and helper text', () => {
    const markup = render()
    expect(markup).toContain('Release Control')
    expect(markup).toContain('Maximum frozen batch released toward T/PRE_T.')
    expect((markup.match(/batch quantity"/g) ?? [])).toHaveLength(3)
    expect(markup).toContain('max="45"')
    expect((markup.match(/max="38"/g) ?? [])).toHaveLength(2)
    expect((markup.match(/Active: 8/g) ?? [])).toHaveLength(3)
  })

  test('preserves invalid selected text, reports the error, disables Start, and shows shared apply guidance', () => {
    const markup = render({ selectedSourceReleases: { A: '', B: '8', C: '8' }, sourceReleaseErrors: { A: 'Enter an integer from 1 to 45' }, sourceReleasesDirty: true })
    expect(markup).toContain('aria-label="A1 batch quantity"')
    expect(markup).toContain('aria-invalid="true"')
    expect(markup).toContain('Enter an integer from 1 to 45')
    expect(markup).toContain('disabled=""')
    expect(markup).toContain('Configuration edits are selected only. Apply with Start Scenario.')
  })
})
