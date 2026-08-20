import { useEffect, useRef, useState } from 'react'
import './App.css'
import SimulationControls from './components/SimulationControls'
import ConveyorDiagram from './visualization/ConveyorDiagram'
import SimulationEngine from './simulation/SimulationEngine'
import { applyOperatingSettingChange, applyPlanningCadenceChange, applyStartScenario } from './operatingSettings'
import type { SimulationStateWithProgress } from './simulation/types'
import type { OperatingSettings } from './simulation/types'

const SEGMENTS = [
  { id: 'A1', lengthFt: 103.5, speedFtPerMin: 120, nextSegmentId: 'PRE_T', maxOccupancy: 45 },
  { id: 'B1', lengthFt: 86, speedFtPerMin: 120, nextSegmentId: 'PRE_T', maxOccupancy: 38 },
  { id: 'C1', lengthFt: 86, speedFtPerMin: 120, nextSegmentId: 'T', maxOccupancy: 38 },
  { id: 'PRE_T', lengthFt: 15, speedFtPerMin: 120, nextSegmentId: 'T', maxOccupancy: 6 },
  { id: 'T', lengthFt: 30, speedFtPerMin: 120, nextSegmentId: 'D', maxOccupancy: 12 },
  { id: 'D', lengthFt: 230, speedFtPerMin: 120, maxOccupancy: 92 },
  { id: 'PURGE', lengthFt: 30, speedFtPerMin: 120, nextSegmentId: 'X', maxOccupancy: 12 },
  { id: 'E', lengthFt: 70, speedFtPerMin: 120, nextSegmentId: 'X', maxOccupancy: 28 },
  { id: 'X', lengthFt: 10, speedFtPerMin: 120, maxOccupancy: 4 },
  { id: 'S', lengthFt: 20, speedFtPerMin: 120, maxOccupancy: 8 },
  { id: 'A2', lengthFt: 136, speedFtPerMin: 120, maxOccupancy: 58 },
  { id: 'B2', lengthFt: 118.5, speedFtPerMin: 120, maxOccupancy: 51 },
  { id: 'C2', lengthFt: 118.5, speedFtPerMin: 120, maxOccupancy: 51 },
  { id: 'CARTBUILD_A', lengthFt: 75, speedFtPerMin: 120, maxOccupancy: 30 },
  { id: 'CARTBUILD_B', lengthFt: 75, speedFtPerMin: 120, maxOccupancy: 30 },
  { id: 'CARTBUILD_C', lengthFt: 75, speedFtPerMin: 120, maxOccupancy: 30 },
]

function App() {
  const engineRef = useRef<SimulationEngine>(new SimulationEngine(SEGMENTS))
  const [state, setState] = useState<SimulationStateWithProgress>(() => engineRef.current.getState())
  const [playing, setPlaying] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [configurationNotice, setConfigurationNotice] = useState<string | null>(null)

  // animation loop
  useEffect(() => {
    let raf = 0
    let last = performance.now()

    function tick(now: number) {
      const engine = engineRef.current
      if (!engine) return
      const dtMs = now - last
      last = now
      if (playing) {
        const simAdvance = (dtMs / 1000) * playbackSpeed
        engine.step(simAdvance)
        const s = engine.getState()
        setState(s)
      }
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, playbackSpeed])

  function handlePlayPause() {
    setPlaying((p) => !p)
  }

  function handleStep() {
    const engine = engineRef.current
    if (!engine) return
    engine.step(1)
    const s = engine.getState()
    setState(s)
  }

  function handleReset() {
    const engine = engineRef.current
    if (!engine) return
    engine.reset()
    const s = engine.getState()
    setState(s)
    setPlaying(false)
    setConfigurationNotice(null)
  }

  function handleOperatingSetting(setting: keyof OperatingSettings, enabled: boolean) {
    applyOperatingSettingChange(engineRef.current, setting, enabled, () => setPlaying(false), setState, setConfigurationNotice)
  }

  function handlePlanningCadence(seconds: number) {
    applyPlanningCadenceChange(engineRef.current, seconds, () => setPlaying(false), setState, setConfigurationNotice)
  }

  function handleStartScenario() {
    applyStartScenario(
      engineRef.current,
      state.operatingSettings,
      state.srsControl.planningCadenceSec,
      () => setPlaying(false),
      setState,
      setConfigurationNotice,
    )
  }

  return (
    <main className={`simulation-app ${panelCollapsed ? 'panel-collapsed' : ''}`}>
      <section className="schematic-workspace" aria-label="Conveyor schematic workspace">
        <header className="app-header">
          <div>
            <span className="eyebrow">Material flow control</span>
            <h1>Conveyor Simulation</h1>
          </div>
          <div className={`system-status ${state.materialBalanceError === 0 ? 'status-ok' : 'status-alert'}`}>
            {state.materialBalanceError === 0 ? 'SYSTEM BALANCED' : 'BALANCE ALERT'}
          </div>
        </header>
        <div className="diagram-frame">
          <ConveyorDiagram segments={state.segments} trays={state.trays} state={state} />
        </div>
      </section>
      <SimulationControls
        state={state}
        playing={playing}
        playbackSpeed={playbackSpeed}
        setPlaybackSpeed={setPlaybackSpeed}
        onPlayPause={handlePlayPause}
        onStep={handleStep}
        onReset={handleReset}
        onStartScenario={handleStartScenario}
        onOperatingSettingChange={handleOperatingSetting}
        onPlanningCadenceChange={handlePlanningCadence}
        configurationNotice={configurationNotice}
        collapsed={panelCollapsed}
        onToggleCollapsed={() => setPanelCollapsed((collapsed) => !collapsed)}
      />
    </main>
  )
}

export default App
