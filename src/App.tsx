import { useEffect, useRef, useState } from 'react'
import './App.css'
import SimulationControls from './components/SimulationControls'
import ConveyorDiagram from './visualization/ConveyorDiagram'
import SimulationEngine from './simulation/SimulationEngine'
import type { SimulationStateWithProgress } from './simulation/types'

const SEGMENTS = [
  { id: 'A1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'PRE_T', maxOccupancy: 24 },
  { id: 'B1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'PRE_T', maxOccupancy: 16 },
  { id: 'C1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'T', maxOccupancy: 16 },
  { id: 'PRE_T', lengthFt: 20, speedFtPerMin: 120, nextSegmentId: 'T', maxOccupancy: 8 },
  { id: 'T', lengthFt: 30, speedFtPerMin: 120, nextSegmentId: 'D', maxOccupancy: 12 },
  { id: 'D', lengthFt: 235, speedFtPerMin: 120, maxOccupancy: 94 },
  { id: 'PURGE', lengthFt: 15, speedFtPerMin: 120, nextSegmentId: 'X', maxOccupancy: 6 },
  { id: 'E', lengthFt: 87.5, speedFtPerMin: 120, nextSegmentId: 'X', maxOccupancy: 35 },
  { id: 'X', lengthFt: 12.5, speedFtPerMin: 120, maxOccupancy: 5 },
  { id: 'S', lengthFt: 20, speedFtPerMin: 120, maxOccupancy: 8 },
  { id: 'A2', lengthFt: 90, speedFtPerMin: 120, maxOccupancy: 36 },
  { id: 'B2', lengthFt: 72.5, speedFtPerMin: 120, maxOccupancy: 29 },
  { id: 'C2', lengthFt: 72.5, speedFtPerMin: 120, maxOccupancy: 29 },
]

function App() {
  const engineRef = useRef<SimulationEngine>(new SimulationEngine(SEGMENTS))
  const [state, setState] = useState<SimulationStateWithProgress>(() => engineRef.current.getState())
  const [playing, setPlaying] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const [panelCollapsed, setPanelCollapsed] = useState(false)

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
        collapsed={panelCollapsed}
        onToggleCollapsed={() => setPanelCollapsed((collapsed) => !collapsed)}
      />
    </main>
  )
}

export default App
