import { useEffect, useRef, useState } from 'react'
import './App.css'
import SimulationControls from './components/SimulationControls'
import ConveyorDiagram from './visualization/ConveyorDiagram'
import SimulationEngine from './simulation/SimulationEngine'
import type { SimulationStateWithProgress } from './simulation/types'

const SEGMENTS = [
  { id: 'A1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'A1T' },
  { id: 'A1T', lengthFt: 59, speedFtPerMin: 120, nextSegmentId: 'T' },
  { id: 'T', lengthFt: 33, speedFtPerMin: 120, nextSegmentId: 'D' },
  { id: 'D', lengthFt: 235, speedFtPerMin: 120 },
]

function App() {
  const engineRef = useRef<SimulationEngine | null>(null)
  const [state, setState] = useState<SimulationStateWithProgress>(() => ({
    timeSec: 0,
    trays: [],
    segments: SEGMENTS,
    source: { enabled: true, sourceReady: true, sourceBlocked: false, lastSourceReleaseTime: -8, totalTraysCreated: 0, headwaySec: 8 },
    segmentStats: [],
    movingCount: 0,
    blockedCount: 0,
    totalTraysCreated: 0,
    materialBalanceError: 0,
    totalRouteDistance: SEGMENTS.reduce((a, s) => a + s.lengthFt, 0),
  }))
  const [playing, setPlaying] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)

  // create engine once
  useEffect(() => {
    engineRef.current = new SimulationEngine(SEGMENTS)
    const s = engineRef.current.getState()
    setState(s)
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
    <div style={{ padding: 16 }}>
      <SimulationControls
        state={state}
        playing={playing}
        playbackSpeed={playbackSpeed}
        setPlaybackSpeed={setPlaybackSpeed}
        onPlayPause={handlePlayPause}
        onStep={handleStep}
        onReset={handleReset}
      />

      <div style={{ marginTop: 16 }}>
        <ConveyorDiagram segments={state.segments} trays={state.trays} />
      </div>
    </div>
  )
}

export default App
