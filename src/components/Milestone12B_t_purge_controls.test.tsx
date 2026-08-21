import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import SimulationEngine from '../simulation/SimulationEngine'
import SimulationControls from './SimulationControls'

const SEGMENTS = [['A1',103.5,45],['B1',86,38],['C1',86,38],['PRE_T',15,6],['T',30,12],['D',230,92],['PURGE',30,12],['E',70,28],['X',10,4],['S',20,8],['A2',136,58],['B2',118.5,51],['C2',118.5,51]].map(([id,lengthFt,maxOccupancy]) => ({ id: String(id), lengthFt: Number(lengthFt), speedFtPerMin: 120, maxOccupancy: Number(maxOccupancy) }))
const render = (overrides = {}) => renderToStaticMarkup(createElement(SimulationControls, { state: new SimulationEngine(SEGMENTS).getState(), playing: false, playbackSpeed: 1, setPlaybackSpeed: vi.fn(), onPlayPause: vi.fn(), onStep: vi.fn(), onReset: vi.fn(), onStartScenario: vi.fn(), selectedSourceReleases: { A: '8', B: '8', C: '8' }, selectedTPurge: { backupTrigger: '6', purgeQuantity: '6' }, onOperatingSettingChange: vi.fn(), onPlanningCadenceChange: vi.fn(), configurationNotice: null, collapsed: false, onToggleCollapsed: vi.fn(), ...overrides }))

describe('Milestone 12B T purge controls', () => {
  test('renders selected and active defaults with understandable helper text and diagnostics', () => {
    const markup = render()
    expect(markup).toContain('aria-label="T backup trigger"')
    expect(markup).toContain('aria-label="T purge quantity"')
    expect(markup).toContain('Consecutive occupied T zones measured upstream from D while D is blocked.')
    expect(markup).toContain('6 means the 6 T zones nearest D must be occupied.')
    expect(markup).toContain('Maximum frozen batch released from T into PURGE.')
    expect(markup).toContain('Downstream backup depth')
    expect(markup).toContain('Paused source')
  })

  test('keeps invalid drafts visible, reports inline validation, disables Start, and reuses pending guidance', () => {
    const markup = render({ selectedTPurge: { backupTrigger: '', purgeQuantity: '13' }, tPurgeErrors: { backupTrigger: 'Enter an integer from 1 to 12', purgeQuantity: 'Enter an integer from 1 to 12' }, tPurgeDirty: true })
    expect((markup.match(/aria-invalid="true"/g) ?? [])).toHaveLength(2)
    expect((markup.match(/role="alert"/g) ?? [])).toHaveLength(2)
    expect(markup).toContain('disabled=""')
    expect(markup).toContain('Configuration edits are selected only. Apply with Start Scenario.')
  })
})
