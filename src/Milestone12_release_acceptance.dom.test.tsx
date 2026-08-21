// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import App from './App'

const section = (id: string) => document.querySelector<HTMLElement>(`[data-sidebar-section="${id}"]`)!
const expanded = (id: string) => section(id).getAttribute('data-expanded') === 'true'

describe('Milestone 12 integrated release acceptance', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  test('live source and T draft editing pauses playback without mutating active simulation state', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Step +1s' }))
    await user.click(screen.getByRole('button', { name: 'SRS Control Diagnostics' }))
    await user.click(screen.getByRole('button', { name: 'ASRS Robot Diagnostics' }))
    await user.click(screen.getByRole('button', { name: 'Play' }))
    expect(within(section('simulation')).getByText('RUNNING')).toBeTruthy()

    const before = {
      simulation: section('simulation').textContent,
      status: section('system-status').textContent,
      srs: section('srs-control').textContent,
      asrs: section('asrs-robots').textContent,
      diagram: document.querySelector('.conveyor-diagram')?.outerHTML,
    }

    const sourceDraft = screen.getByRole('spinbutton', { name: 'A1 batch quantity' })
    await user.clear(sourceDraft)
    await user.type(sourceDraft, '10')
    const tDraft = screen.getByRole('spinbutton', { name: 'T purge quantity' })
    await user.clear(tDraft)
    await user.type(tDraft, '9')

    expect(within(section('simulation')).getByText('PAUSED')).toBeTruthy()
    expect(sourceDraft).toHaveProperty('value', '10')
    expect(tDraft).toHaveProperty('value', '9')
    expect(section('scenario-configuration').textContent).toContain('Active: 8')
    expect(section('scenario-configuration').textContent).toContain('Active: 6')
    expect(section('scenario-configuration').textContent).toContain('Apply with Start Scenario')
    expect(section('system-status').textContent?.replace('PAUSED', 'RUNNING')).toBe(before.status)
    expect(section('srs-control').textContent).toBe(before.srs)
    expect(section('asrs-robots').textContent).toBe(before.asrs)
    expect(document.querySelector('.conveyor-diagram')?.outerHTML).toBe(before.diagram)
    expect(section('simulation').textContent?.replace('PAUSED', 'RUNNING').replace('Play', 'Pause')).toBe(before.simulation)
  })

  test('Enter and Space operate primary and advanced disclosures with correct semantics and focus removal', async () => {
    const user = userEvent.setup()
    render(<App />)
    const scenario = screen.getByRole('button', { name: 'Scenario Configuration' })
    scenario.focus()
    await user.keyboard('{Enter}')
    expect(scenario.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(scenario)
    expect(document.querySelector('[data-sidebar-section-content="scenario-configuration"]')).toBeNull()
    await user.keyboard(' ')
    expect(scenario.getAttribute('aria-expanded')).toBe('true')
    expect(document.getElementById(scenario.getAttribute('aria-controls')!)).toBeTruthy()

    const exchanger = screen.getByRole('button', { name: 'Exchanger A' })
    exchanger.focus()
    await user.keyboard('{Enter}')
    expect(exchanger.getAttribute('aria-expanded')).toBe('true')
    expect(document.getElementById(exchanger.getAttribute('aria-controls')!)).toBeTruthy()
    await user.keyboard(' ')
    expect(exchanger.getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('[data-sidebar-section-content="exchanger-a"]')).toBeNull()
    expect(document.activeElement).toBe(exchanger)
  })

  test('chosen disclosure state survives playback, Start Scenario, and Reset rerenders', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'SRS Control Diagnostics' }))
    await user.click(screen.getByRole('button', { name: 'Exchanger B' }))
    await user.click(screen.getByRole('button', { name: 'System Status / Accounting' }))
    const choices = () => ({ srs: expanded('srs-control'), exchangerB: expanded('exchanger-b'), status: expanded('system-status') })
    expect(choices()).toEqual({ srs: true, exchangerB: true, status: false })

    const snapshotBeforeDisclosure = document.querySelector('.conveyor-diagram')?.outerHTML
    await user.click(screen.getByRole('button', { name: 'Exchanger C' }))
    await user.click(screen.getByRole('button', { name: 'Exchanger C' }))
    expect(document.querySelector('.conveyor-diagram')?.outerHTML).toBe(snapshotBeforeDisclosure)

    await user.click(screen.getByRole('button', { name: 'Play' }))
    expect(within(section('simulation')).getByText('RUNNING')).toBeTruthy()
    expect(choices()).toEqual({ srs: true, exchangerB: true, status: false })

    await user.click(screen.getByRole('button', { name: 'Start Scenario' }))
    expect(within(section('simulation')).getByText('0.0s')).toBeTruthy()
    expect(within(section('simulation')).getByText('PAUSED')).toBeTruthy()
    expect(choices()).toEqual({ srs: true, exchangerB: true, status: false })

    await user.click(screen.getByRole('button', { name: 'Step +1s' }))
    expect(within(section('simulation')).getByText('1.0s')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Reset' }))
    expect(within(section('simulation')).getByText('0.0s')).toBeTruthy()
    expect(choices()).toEqual({ srs: true, exchangerB: true, status: false })
  })
})
