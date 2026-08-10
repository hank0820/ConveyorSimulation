import type { FC } from 'react'
import type { SimulationStateWithProgress } from '../simulation/types'

interface Props {
  state: SimulationStateWithProgress
  playing: boolean
  playbackSpeed: number
  setPlaybackSpeed: (s: number) => void
  onPlayPause: () => void
  onStep: () => void
  onReset: () => void
}

const SimulationControls: FC<Props> = ({
  state,
  playing,
  playbackSpeed,
  setPlaybackSpeed,
  onPlayPause,
  onStep,
  onReset,
}) => {
  const { tray, totalRouteDistance, distanceCompleted } = state

  return (
    <div style={{ fontFamily: 'sans-serif' }}>
      <h1>Conveyor Simulation</h1>
      <div>Simulation Time: {state.timeSec.toFixed(1)} sec</div>

      <div style={{ marginTop: 8 }}>
        <strong>Tray ID:</strong> {tray.id}
      </div>
      <div>
        <strong>Current Segment:</strong> {tray.currentSegmentId}
      </div>
      <div>
        <strong>Position:</strong> {tray.positionFt.toFixed(1)} / {state.segments.find(s => s.id === tray.currentSegmentId)?.lengthFt} ft
      </div>
      <div>
        <strong>Tray Status:</strong> {tray.status}
      </div>

      <div style={{ marginTop: 8 }}>
        <strong>Total Route Distance:</strong> {totalRouteDistance} ft
      </div>
      <div>
        <strong>Distance Completed:</strong> {distanceCompleted.toFixed(1)} ft
      </div>
      <div>
        <strong>Route Progress:</strong> {state.routeProgress.toFixed(1)} %
      </div>

      <div style={{ marginTop: 8 }}>
        <button onClick={onPlayPause}>{playing ? 'Pause' : 'Play'}</button>
        <button onClick={onStep} style={{ marginLeft: 8 }}>Step +1 sec</button>
        <button onClick={onReset} style={{ marginLeft: 8 }}>Reset</button>
      </div>

      <div style={{ marginTop: 8 }}>
        Playback speed:
        {[1, 5, 20, 100].map((s) => (
          <label key={s} style={{ marginLeft: 8 }}>
            <input
              type="radio"
              checked={playbackSpeed === s}
              onChange={() => setPlaybackSpeed(s)}
            />
            {s}x
          </label>
        ))}
      </div>
    </div>
  )
}

export default SimulationControls
