import type { FC, ReactNode } from 'react'
import type { OperatingSettings, SimulationStateWithProgress, SourceId } from '../simulation/types'

interface Props {
  state: SimulationStateWithProgress
  playing: boolean
  playbackSpeed: number
  setPlaybackSpeed: (speed: number) => void
  onPlayPause: () => void
  onStep: () => void
  onReset: () => void
  onOperatingSettingChange: (setting: keyof OperatingSettings, enabled: boolean) => void
  onPlanningCadenceChange: (seconds: number) => void
  configurationNotice: string | null
  collapsed: boolean
  onToggleCollapsed: () => void
}

const Metric = ({ label, children, tone }: { label: string; children: ReactNode; tone?: 'ok' | 'alert' }) => (
  <><span>{label}</span><span className={`value ${tone ?? ''}`}>{children}</span></>
)

const EnablementToggle = ({ label, setting, enabled, onChange }: { label: string; setting: keyof OperatingSettings; enabled: boolean; onChange: (setting: keyof OperatingSettings, enabled: boolean) => void }) => (
  <label className={`enablement-toggle ${enabled ? 'enabled' : 'disabled'}`}>
    <span>{label}</span>
    <input type="checkbox" checked={enabled} onChange={(event) => onChange(setting, event.currentTarget.checked)} />
    <span className="toggle-state">{enabled ? 'ON' : 'OFF'}</span>
  </label>
)

const SimulationControls: FC<Props> = ({
  state, playing, playbackSpeed, setPlaybackSpeed, onPlayPause, onStep, onReset, onOperatingSettingChange, onPlanningCadenceChange, configurationNotice, collapsed, onToggleCollapsed,
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
        <section className="diagnostic-group enablement-group">
          <h2>Process enablement</h2>
          <div className="enablement-list">
            <EnablementToggle label="Körber" setting="korberEnabled" enabled={state.operatingSettings.korberEnabled} onChange={onOperatingSettingChange} />
            <EnablementToggle label="Cartbuild A" setting="cartbuildAEnabled" enabled={state.operatingSettings.cartbuildAEnabled} onChange={onOperatingSettingChange} />
            <EnablementToggle label="Cartbuild B" setting="cartbuildBEnabled" enabled={state.operatingSettings.cartbuildBEnabled} onChange={onOperatingSettingChange} />
            <EnablementToggle label="Cartbuild C" setting="cartbuildCEnabled" enabled={state.operatingSettings.cartbuildCEnabled} onChange={onOperatingSettingChange} />
          </div>
          {configurationNotice && <p className="configuration-notice" role="status">{configurationNotice}</p>}
        </section>

        <section className="diagnostic-group" data-srs-diagnostics>
          <h2>SRS demand control</h2>
          <label className="cadence-control">
            <span>Planning cadence</span>
            <span><input aria-label="PendingDemand planning cadence" type="number" min="0.1" step="0.1" value={state.srsControl.planningCadenceSec} onChange={(event) => {
              const seconds = Number(event.currentTarget.value)
              if (Number.isFinite(seconds) && seconds > 0) onPlanningCadenceChange(seconds)
            }} /> sim s</span>
          </label>
          <div className="diagnostic-grid">
            <Metric label="Next planning">{state.srsControl.nextPlanningTime.toFixed(1)}s</Metric>
            <Metric label="Planning cursor">{state.srsControl.planningCursor}</Metric>
            <Metric label="Target / current">{`${state.srsControl.globalTarget}/${state.srsControl.globalCurrent}`}</Metric>
            <Metric label="Pending / available">{`${state.srsControl.globalPending}/${state.srsControl.globalAvailableCapacity}`}</Metric>
          </div>
          {(['A', 'B', 'C'] as SourceId[]).map((source) => {
            const lane = state.srsControl.lanes[source]
            return <details key={source} data-srs-lane={source}>
              <summary>{`${source}1 · current ${lane.currentCount}/${lane.targetSize} · pending ${lane.pendingDemand} · PurgeDemand ${lane.lanePurgeDemand}`}</summary>
              <div className="diagnostic-grid detail-grid">
                <Metric label="Local / downstream avail.">{`${lane.localAvailable}/${lane.downstreamAvailable}`}</Metric>
                <Metric label="Mission capacity">{lane.laneMissionCapacity}</Metric>
                <Metric label="Pending EMPTY / CARTBUILD">{`${lane.pendingEmptyMissions}/${lane.pendingCartbuildMissions}`}</Metric>
                <Metric label="Matured EMPTY / CARTBUILD">{`${lane.maturedEmptyMissions}/${lane.maturedCartbuildMissions}`}</Metric>
                <Metric label="Last / next release">{`${lane.lastActualExchangerReleaseTime?.toFixed(1) ?? 'none'}/${lane.nextEligibleExchangerReleaseTime.toFixed(1)}s`}</Metric>
                <Metric label="Source batch">{lane.activeSourceBatch ? `${lane.sourceBatchReleasedCount}/${lane.frozenSourceBatchQuantity} (${lane.sourceBatchRemainingCount} left)` : 'IDLE'}</Metric>
              </div>
            </details>
          })}
          <details data-srs-downstream>
            <summary>Downstream SRS piles</summary>
            <ul className="detail-list">
              {(['T', 'D', 'A2', 'B2', 'C2'] as const).map((pile) => <li key={pile}>{pile}: {state.srsControl.current[pile]}/{state.srsControl.targets[pile]}</li>)}
            </ul>
          </details>
          <details data-t-bypass>
            <summary>{`T bypass · ${state.srsControl.tBypassBatch.active ? 'ACTIVE' : 'IDLE'} · ${state.srsControl.tBypassBatch.enteredCount}/6 entered`}</summary>
            <ul className="detail-list">
              <li>Frozen IDs: {state.srsControl.tBypassBatch.authorizedTrayIds.length ? state.srsControl.tBypassBatch.authorizedTrayIds.join(', ') : 'none'}</li>
              <li>Remaining: {state.srsControl.tBypassBatch.remainingCount}</li>
              <li>Source paused: {state.srsControl.tBypassBatch.sourceBatchPaused ? 'YES' : 'NO'}</li>
            </ul>
          </details>
        </section>

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

        <section className="diagnostic-group">
          <h2>Cartbuild</h2>
          <div className="diagnostic-grid">
            <Metric label="Carton balance" tone={state.cartbuildSystem.cartonBalanceError === 0 ? 'ok' : 'alert'}>{state.cartbuildSystem.cartonBalanceError}</Metric>
            <Metric label="Attached / lanes">{`${state.cartbuildSystem.cartbuildCartonsAttachedToTrays}/${state.cartbuildSystem.cartbuildCartonsOnConveyors}`}</Metric>
            <Metric label="Operator consumed">{state.cartbuildSystem.cartbuildCartonsConsumedByOperators}</Metric>
          </div>
          {(['A', 'B', 'C'] as SourceId[]).map((source) => {
            const lane = state.cartbuildSystem.lanes[`CARTBUILD_${source}` as keyof typeof state.cartbuildSystem.lanes]
            const exchanger = state.cartbuildSystem.exchangers[source]
            const detrayer = state.cartbuildSystem.detrayers[source]
            return <details key={source} data-cartbuild-diagnostics={source}>
              <summary>{`Cartbuild ${source} · ${lane.enabled ? 'ON' : 'OFF'} · ${lane.occupancy}/30 cartons`}</summary>
              <div className="diagnostic-grid detail-grid">
                <Metric label="Loaded / empty releases">{`${exchanger.loadedReleases}/${exchanger.emptyReleases}`}</Metric>
                <Metric label="Last release">{exchanger.mostRecentReleaseType ?? 'NONE'}</Metric>
                <Metric label="Detrayer">{detrayer.loadedTrayWaiting ? `WAITING ${detrayer.trayId}` : 'CLEAR'}</Metric>
                <Metric label="Operator consumed">{lane.operatorConsumedCount}</Metric>
                <Metric label="Pending empty">{exchanger.pendingEmptyMissions}</Metric>
              </div>
            </details>
          })}
        </section>
      </div>}
    </aside>
  )
}

export default SimulationControls
