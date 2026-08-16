import type { FC, ReactNode } from 'react'
import type { SimulationStateWithProgress } from '../simulation/types'

interface Props {
  state: SimulationStateWithProgress
  playing: boolean
  playbackSpeed: number
  setPlaybackSpeed: (speed: number) => void
  onPlayPause: () => void
  onStep: () => void
  onReset: () => void
  collapsed: boolean
  onToggleCollapsed: () => void
}

const Metric = ({ label, children, tone }: { label: string; children: ReactNode; tone?: 'ok' | 'alert' }) => (
  <><span>{label}</span><span className={`value ${tone ?? ''}`}>{children}</span></>
)

const SimulationControls: FC<Props> = ({
  state, playing, playbackSpeed, setPlaybackSpeed, onPlayPause, onStep, onReset, collapsed, onToggleCollapsed,
}) => {
  const purge = state.returnSystem.activePurgeBatch
  const frozenIds = purge?.authorizedTrayIds ?? state.returnSystem.lastCompletedPurgeBatch?.authorizedTrayIds ?? []

  return (
    <aside className="control-panel" data-panel-state={collapsed ? 'collapsed' : 'expanded'} aria-label="Simulation controls and diagnostics">
      <div className="panel-heading">
        <strong>Operations</strong>
        <button className="panel-toggle" type="button" onClick={onToggleCollapsed} aria-label={collapsed ? 'Expand diagnostics panel' : 'Collapse diagnostics panel'} aria-expanded={!collapsed}>
          {collapsed ? '‹' : '›'}
        </button>
      </div>
      {!collapsed && <div className="panel-body">
        <section className="diagnostic-group">
          <h2>Simulation</h2>
          <div className="diagnostic-grid">
            <Metric label="Time">{state.timeSec.toFixed(1)}s</Metric>
            <Metric label="State">{playing ? 'RUNNING' : 'PAUSED'}</Metric>
          </div>
          <div className="control-row">
            <button className="primary" type="button" onClick={onPlayPause}>{playing ? 'Pause' : 'Play'}</button>
            <button type="button" onClick={onStep}>Step +1s</button>
            <button type="button" onClick={onReset}>Reset</button>
          </div>
          <div className="speed-row" aria-label="Playback speed">
            {[1, 5, 20, 100].map((speed) => <button key={speed} type="button" className={`speed-button ${speed === playbackSpeed ? 'active' : ''}`} onClick={() => setPlaybackSpeed(speed)}>{speed}×</button>)}
          </div>
        </section>

        <section className="diagnostic-group">
          <h2>Material</h2>
          <div className="diagnostic-grid">
            <Metric label="Created">{state.createdTrayCount}</Metric>
            <Metric label="Physical">{state.physicalTrayCount}</Metric>
            <Metric label="Returned">{state.returnSystem.returnedToAsrsCount}</Metric>
            <Metric label="Balance" tone={state.materialBalanceError === 0 ? 'ok' : 'alert'}>{state.materialBalanceError}</Metric>
            <Metric label="Moving">{state.movingCount}</Metric>
            <Metric label="Blocked">{state.blockedCount}</Metric>
          </div>
        </section>

        <section className="diagnostic-group">
          <h2>Outbound</h2>
          <div className="diagnostic-grid">
            <Metric label="Slug cursor">{state.slugCursor}</Metric>
            <Metric label="Active slug">{state.activeSlug?.source ?? 'NONE'}</Metric>
            <Metric label="Progress">{state.activeSlug ? `${state.activeSlug.releasedCount}/${state.activeSlug.authorizedCount}` : '—'}</Metric>
            <Metric label="D entrance">{state.dEntranceAvailable ? 'OPEN' : 'BLOCKED'}</Metric>
            <Metric label="Körber">{state.returnSystem.korberHeldTrayId ? 'HOLDING' : state.korber.starved ? 'STARVED' : state.korber.ready ? 'READY' : 'WAITING'}</Metric>
          </div>
          <details>
            <summary>Belts and sources</summary>
            <ul className="detail-list">
              {state.beltDiagnostics.map((belt) => <li key={belt.pileId}>{belt.pileId}: {belt.beltRunning ? 'RUNNING' : 'STOPPED'} · {belt.beltTrayCount} trays</li>)}
              {state.sources.map((source) => <li key={source.id}>Source {source.id}: {source.sourceReady ? 'READY' : source.sourceBlocked ? 'BLOCKED' : 'WAITING'}</li>)}
            </ul>
          </details>
        </section>

        <section className="diagnostic-group">
          <h2>Return</h2>
          <div className="diagnostic-grid">
            <Metric label="Purge">{purge ? `${purge.enteredPurgeCount}/6 ACTIVE` : 'IDLE'}</Metric>
            <Metric label="E → X">{state.returnSystem.mergeCounts.eToXFull}</Metric>
            <Metric label="PURGE → X">{state.returnSystem.mergeCounts.purgeToXEmpty}</Metric>
            <Metric label="Sorter cursor">{state.returnSystem.sorterCursor}</Metric>
            <Metric label="A2 available">{state.returnSystem.sorterAvailability.A2 ? 'YES' : 'NO'}</Metric>
            <Metric label="B2 available">{state.returnSystem.sorterAvailability.B2 ? 'YES' : 'NO'}</Metric>
            <Metric label="C2 available">{state.returnSystem.sorterAvailability.C2 ? 'YES' : 'NO'}</Metric>
            <Metric label="A/B/C returns">{`${state.returnSystem.exchangerAcceptanceTimes.A2.length}/${state.returnSystem.exchangerAcceptanceTimes.B2.length}/${state.returnSystem.exchangerAcceptanceTimes.C2.length}`}</Metric>
          </div>
          <details>
            <summary>Return identities</summary>
            <ul className="detail-list">
              <li>Held ID: {state.returnSystem.korberHeldTrayId ?? 'none'}</li>
              <li>Frozen IDs: {frozenIds.length ? frozenIds.join(', ') : 'none'}</li>
              <li>S head: {state.returnSystem.sHeadTrayDestination ?? 'none'}</li>
              <li>Sorter block: {state.returnSystem.sorterBlockedReason ?? 'none'}</li>
            </ul>
          </details>
        </section>
      </div>}
    </aside>
  )
}

export default SimulationControls
