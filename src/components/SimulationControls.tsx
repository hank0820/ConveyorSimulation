import type { FC } from 'react'

interface Props {
  timeSec: number
  trayPositionFt: number
  lengthFt: number
  playing: boolean
  playbackSpeed: number
  setPlaybackSpeed: (s: number) => void
  onPlayPause: () => void
  onStep: () => void
  onReset: () => void
}

const SimulationControls: FC<Props> = ({
  timeSec,
  trayPositionFt,
  lengthFt,
  playing,
  playbackSpeed,
  setPlaybackSpeed,
  onPlayPause,
  onStep,
  onReset,
}) => {
  return (
    <div style={{ fontFamily: 'sans-serif' }}>
      <h1>Conveyor Simulation</h1>
      <div>Simulation Time: {timeSec.toFixed(1)} sec</div>
      <div>Tray Position: {trayPositionFt.toFixed(1)} / {lengthFt} ft</div>

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
