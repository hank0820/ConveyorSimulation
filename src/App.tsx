import { useEffect, useRef, useState } from 'react'
import './App.css'
import SimulationControls from './components/SimulationControls'
import ConveyorDiagram from './visualization/ConveyorDiagram'
import SimulationEngine from './simulation/SimulationEngine'

const CONVEYOR_CONFIG = {
  id: 'TEST_CONVEYOR',
  lengthFt: 120,
  speedFtPerMin: 120,
}

function App() {
  const engineRef = useRef<SimulationEngine | null>(null)
  const [state, setState] = useState(() => {
    // initial minimal state
    return { timeSec: 0, trayPositionFt: 0 }
  })
  const [playing, setPlaying] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)

  // create engine once
  useEffect(() => {
    engineRef.current = new SimulationEngine(CONVEYOR_CONFIG)
    setState({ timeSec: 0, trayPositionFt: 0 })
  }, [])

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
        setState({ timeSec: s.timeSec, trayPositionFt: s.tray.positionFt })
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
    setState({ timeSec: s.timeSec, trayPositionFt: s.tray.positionFt })
  }

  function handleReset() {
    const engine = engineRef.current
    if (!engine) return
    engine.reset()
    const s = engine.getState()
    setState({ timeSec: s.timeSec, trayPositionFt: s.tray.positionFt })
    setPlaying(false)
  }

  return (
    <div style={{ padding: 16 }}>
      <SimulationControls
        timeSec={state.timeSec}
        trayPositionFt={state.trayPositionFt}
        lengthFt={CONVEYOR_CONFIG.lengthFt}
        playing={playing}
        playbackSpeed={playbackSpeed}
        setPlaybackSpeed={setPlaybackSpeed}
        onPlayPause={handlePlayPause}
        onStep={handleStep}
        onReset={handleReset}
      />

      <div style={{ marginTop: 16 }}>
        <ConveyorDiagram lengthFt={CONVEYOR_CONFIG.lengthFt} trayPositionFt={state.trayPositionFt} />
      </div>
    </div>
  )
}

export default App
