import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import SimulationEngine from '../simulation/SimulationEngine'
import SimulationControls from './SimulationControls'

const SEGMENTS = [['A1',103.5,45],['B1',86,38],['C1',86,38],['PRE_T',15,6],['T',30,12],['D',230,92],['PURGE',30,12],['E',70,28],['X',10,4],['S',20,8],['A2',136,58],['B2',118.5,51],['C2',118.5,51],['CARTBUILD_A',75,30],['CARTBUILD_B',75,30],['CARTBUILD_C',75,30]].map(([id,lengthFt,maxOccupancy]) => ({ id: String(id), lengthFt: Number(lengthFt), speedFtPerMin: 120, maxOccupancy: Number(maxOccupancy) }))
const state = () => new SimulationEngine(SEGMENTS).getState()
const render = (overrides = {}) => renderToStaticMarkup(createElement(SimulationControls, { state: state(), playing: false, playbackSpeed: 1, setPlaybackSpeed: vi.fn(), onPlayPause: vi.fn(), onStep: vi.fn(), onReset: vi.fn(), onStartScenario: vi.fn(), selectedTargets: { A1:'24',B1:'16',C1:'16',T:'6',D:'92',A2:'36',B2:'29',C2:'29' }, selectedSourceReleases: { A:'8',B:'8',C:'8' }, selectedTPurge: { backupTrigger:'6',purgeQuantity:'6' }, onOperatingSettingChange: vi.fn(), onPlanningCadenceChange: vi.fn(), configurationNotice: null, collapsed: false, onToggleCollapsed: vi.fn(), ...overrides }))
const sectionIds = (markup: string) => [...markup.matchAll(/data-sidebar-section="([^"]+)"/g)].map((match) => match[1])
const section = (markup: string, id: string) => markup.match(new RegExp(`<section[^>]*data-sidebar-section="${id}"[\\s\\S]*?</section>`))?.[0] ?? ''

describe('Milestone 12C operations sidebar organization', () => {
  test('renders the exact eight-section order with Simulation first and exchangers last A/B/C', () => {
    expect(sectionIds(render())).toEqual(['simulation','scenario-configuration','system-status','srs-control','asrs-robots','exchanger-a','exchanger-b','exchanger-c'])
  })

  test('primary sections start open and advanced sections start collapsed', () => {
    const markup = render()
    for (const id of ['simulation','scenario-configuration','system-status']) expect(section(markup, id)).toContain('data-expanded="true"')
    for (const id of ['srs-control','asrs-robots','exchanger-a','exchanger-b','exchanger-c']) expect(section(markup, id)).toContain('data-expanded="false"')
  })

  test('every section uses a native keyboard-operable disclosure with expanded and controls semantics', () => {
    const markup = render()
    expect((markup.match(/class="sidebar-section-toggle"/g) ?? [])).toHaveLength(8)
    expect((markup.match(/aria-expanded=/g) ?? [])).toHaveLength(9)
    expect((markup.match(/aria-controls="sidebar-/g) ?? [])).toHaveLength(8)
  })

  test('collapsed advanced content is absent and therefore cannot be focused', () => {
    const markup = render()
    for (const id of ['srs-control','asrs-robots','exchanger-a','exchanger-b','exchanger-c']) expect(markup).not.toContain(`data-sidebar-section-content="${id}"`)
    expect(markup).not.toContain('data-exchanger-id=')
  })

  test.each(['srs-control','asrs-robots','exchanger-a','exchanger-b','exchanger-c'])('%s can be opened independently', (id) => {
    const markup = render({ defaultOpenSections: [id] })
    expect(markup).toContain(`data-sidebar-section-content="${id}"`)
    for (const other of ['srs-control','asrs-robots','exchanger-a','exchanger-b','exchanger-c'].filter((item) => item !== id)) expect(markup).not.toContain(`data-sidebar-section-content="${other}"`)
  })

  test('Simulation owns Play/Pause, Step, Start Scenario, Reset, and playback speed', () => {
    const paused = section(render(), 'simulation')
    const running = section(render({ playing: true }), 'simulation')
    for (const text of ['Play','Step +1s','Start Scenario','Reset','Playback speed']) expect(paused).toContain(text)
    expect(running).toContain('Pause')
  })

  test('Scenario Configuration owns all settings, validation, and selected-only guidance', () => {
    const markup = render({ targetErrors: { A1: 'invalid' }, targetsDirty: true })
    const scenario = section(markup, 'scenario-configuration')
    for (const text of ['Process enablement','Planning cadence','SRS target sizes','Release Control','T backup trigger','T purge quantity','Apply with Start Scenario']) expect(scenario).toContain(text)
    expect(section(markup, 'simulation')).toContain('disabled=""')
  })

  test('System Status owns high-level tray, carton, mission, robot, return, and balance values', () => {
    const status = section(render(), 'system-status')
    for (const text of ['Created / physical trays','Pending missions','Active robots','Returned to ASRS','Tray balance','Carton balance']) expect(status).toContain(text)
  })

  test('expanded SRS and ASRS sections retain detailed diagnostics', () => {
    const markup = render({ defaultOpenSections: ['srs-control','asrs-robots'] })
    for (const text of ['Target / current','PurgeDemand','Source batch','T bypass','Cartbuild reservations']) expect(section(markup, 'srs-control')).toContain(text)
    for (const text of ['Traveling outbound','Matured / queued','Shift / TAKE','Dual utilization']) expect(section(markup, 'asrs-robots')).toContain(text)
  })

  test('each expanded exchanger retains independent queue, DROP, TAKE, timing, history, and utilization details', () => {
    const markup = render({ defaultOpenSections: ['exchanger-a','exchanger-b','exchanger-c'] })
    for (const source of ['a','b','c']) for (const text of ['Queue / visible / overflow','DROP state','Shift / TAKE','Last successful unload','Completed D/O/I','dual util.']) expect(section(markup, `exchanger-${source}`)).toContain(text)
  })

  test('rendering any expansion combination does not mutate the simulation snapshot', () => {
    const snapshot = state()
    const frozen = JSON.stringify(snapshot)
    render({ state: snapshot, defaultOpenSections: ['srs-control','exchanger-b'] })
    expect(JSON.stringify(snapshot)).toBe(frozen)
  })
})
