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
    ['ACTIVE', true, 'ACTIVE · PHYSICALLY BLOCKED'],
    ['DRAINING', false, 'DRAINING'],
  ] as const)('renders authoritative %s blocked=%s diagnostics', (phase, physicallyBlocked, label) => {
    const state = new SimulationEngine(SEGMENTS).getState()
    state.srsControl.sourceGrant = { configuredWindowSec: 10, activeLane: 'A', phase, physicallyBlocked, remainingWindowSec: phase === 'ACTIVE' ? 4.5 : 0, releasedCount: 3, enteredTCount: 2, drainingElapsedSec: phase === 'DRAINING' ? 1.5 : 0, handoffWaitReason: phase === 'DRAINING' ? 'PRE_T_DRAINING' : 'NONE', selectionReason: 'NORMAL', purgeDemandRequestedCount: 0, purgeDemandSatisfiedCount: 0, purgeDemandRemainingCount: 0, purgeDemandRequestedAtSec: null, purgeDemandCompletedAtSec: null, purgeDemandOutcome: 'NOT_APPLICABLE', purgeDemandRecordKind: 'NONE' }
    const markup = render({ state, defaultOpenSections: ['srs-control'] })
    expect(markup).toContain(`data-source-grant-phase="${phase}"`)
    expect(markup).toContain(label)
    expect(markup).toContain('Authoritative time remaining')
    expect(markup).toContain('Released / entered T')
  })

  test('renders neutral IDLE demand and no-batch states in four accessible diagnostic groups', () => {
    const markup = render({ defaultOpenSections: ['srs-control'] })
    expect(markup).toContain('aria-label="Source timed grant"')
    expect(markup).toContain('aria-label="Frozen source PurgeDemand execution"')
    expect(markup).toContain('aria-label="T-bypass batch"')
    expect(markup).toContain('aria-label="X and PURGE downstream progress"')
    expect(markup).toContain('No active demand execution')
    expect(markup).toContain('No active or completed T-bypass batch')
    expect(markup).not.toContain('0/0 · PENDING')
  })

  test('renders authoritative ACTIVE demand progress without calculating it in React', () => {
    const state = new SimulationEngine(SEGMENTS).getState()
    Object.assign(state.srsControl.sourceGrant, { activeLane: 'B', phase: 'ACTIVE', selectionReason: 'POSITIVE_PURGE_DEMAND', purgeDemandRequestedCount: 7, purgeDemandSatisfiedCount: 3, purgeDemandRemainingCount: 4, purgeDemandRequestedAtSec: 1.25, purgeDemandCompletedAtSec: null, purgeDemandOutcome: null, purgeDemandRecordKind: 'ACTIVE' })
    const markup = render({ state, defaultOpenSections: ['srs-control'] })
    for (const expected of ['Requested</span><span class="value ">7', 'Satisfied</span><span class="value ">3', 'Remaining</span><span class="value ">4', 'Requested at</span><span class="value ">1.3s', 'Outcome</span><span class="value ">PENDING']) expect(markup).toContain(expected)
  })

  test('labels completed demand history with its outcome and timestamps', () => {
    const state = new SimulationEngine(SEGMENTS).getState()
    Object.assign(state.srsControl.sourceGrant, { selectionReason: 'POSITIVE_PURGE_DEMAND', purgeDemandRequestedCount: 5, purgeDemandSatisfiedCount: 2, purgeDemandRemainingCount: 3, purgeDemandRequestedAtSec: 2, purgeDemandCompletedAtSec: 9.5, purgeDemandOutcome: 'EXPIRED_WITH_REMAINDER', purgeDemandRecordKind: 'HISTORY' })
    const markup = render({ state, defaultOpenSections: ['srs-control'] })
    expect(markup).toContain('COMPLETED HISTORY')
    expect(markup).toContain('EXPIRED_WITH_REMAINDER')
    expect(markup).toContain('9.5s')
  })

  test('renders active and completed T batches from one internally consistent record', () => {
    const state = new SimulationEngine(SEGMENTS).getState()
    Object.assign(state.srsControl.tBypassBatch, { active: false, recordKind: 'HISTORY', batchId: 4, phase: 'COMPLETE', configuredQuantity: 6, authorizedCount: 6, authorizedTrayIds: [11, 10, 9, 8, 7, 6], enteredCount: 6, remainingCount: 0, enteredXCount: 6, exitedXCount: 6, downstreamRemainingCount: 0, purgeEPriorityDeferralCount: 12, authorizedAtSec: 3, completedAtSec: 20 })
    let markup = render({ state, defaultOpenSections: ['srs-control'] })
    expect(markup).toContain('Batch / phase: 4 / COMPLETE')
    expect(markup).toContain('Frozen members: 6 (11, 10, 9, 8, 7, 6)')
    expect(markup).toContain('X entered / exited: 6 / 6')
    expect(markup).toContain('E-priority deferrals: 12')
    Object.assign(state.srsControl.tBypassBatch, { active: true, recordKind: 'ACTIVE', batchId: 5, phase: 'AUTHORIZED', authorizedTrayIds: [21, 20, 19, 18, 17, 16], enteredCount: 0, enteredXCount: 0, exitedXCount: 0, downstreamRemainingCount: 6, authorizedAtSec: 21, completedAtSec: null })
    markup = render({ state, defaultOpenSections: ['srs-control'] })
    expect(markup).toContain('Batch / phase: 5 / AUTHORIZED')
    expect(markup).not.toContain('Batch / phase: 4 / COMPLETE')
  })
})
