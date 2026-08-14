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
  const { trays, segmentStats, sources, movingCount, blockedCount, totalTraysCreated, materialBalanceError } = state

  return (
    <div style={{ fontFamily: 'sans-serif' }}>
      <h1>Conveyor Simulation</h1>
      <div>Simulation Time: {state.timeSec.toFixed(1)} sec</div>

      <div style={{ marginTop: 8 }}>
        <strong>Total Physical Trays:</strong> {trays.length}
      </div>
      <div>
        <strong>Total Trays Created:</strong> {totalTraysCreated}
      </div>
      <div>
        <strong>Material Balance Error:</strong> {materialBalanceError}
      </div>

      <div style={{ marginTop: 8 }}>
        <strong>Sources:</strong>
        <ul>
          {sources.map((source) => (
            <li key={source.id}>
              Source {source.id}: {source.sourceReady ? 'READY' : source.sourceBlocked ? 'BLOCKED' : 'WAITING'}
              {' '}({source.totalTraysCreated} created)
            </li>
          ))}
        </ul>
      </div>

      <div style={{ marginTop: 8 }}>
        <strong>Slug Cursor:</strong> {state.slugCursor}
      </div>

      <div>
        <strong>Active Slug:</strong> {state.activeSlug?.source ?? 'NONE'}
        {state.activeSlug && ` (${state.activeSlug.releasedCount}/${state.activeSlug.authorizedCount} released, ${state.activeSlug.enteredTCount} entered T)`}
      </div>

      <div>
        <strong>D Entrance:</strong> {state.dEntranceAvailable ? 'AVAILABLE' : 'BLOCKED'}
      </div>

      <div>
        <strong>D Final Zone:</strong> {state.dFinalZoneOccupied ? 'OCCUPIED' : 'EMPTY'};{' '}
        <strong>Körber:</strong> {state.korber.starved ? 'STARVED' : state.korber.ready ? 'READY' : 'WAITING'}
      </div>

      <div style={{ marginTop: 8 }}>
        <strong>Segment Occupancy:</strong>
        <ul>
          {segmentStats.map(s => (
            <li key={s.id}>{s.id}: {s.occupancy}{s.capacity ? ` / ${s.capacity}` : ''}</li>
          ))}
        </ul>
      </div>

      <div>
        <strong>Moving Trays:</strong> {movingCount} &nbsp; <strong>Blocked Trays:</strong> {blockedCount}
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
