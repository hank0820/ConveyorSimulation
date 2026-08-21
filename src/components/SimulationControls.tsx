import type { FC, ReactNode } from 'react'
import type { OperatingSettings, SimulationStateWithProgress, SourceId, SrsPileId } from '../simulation/types'
import type { SrsTargetDrafts } from '../srsTargetDrafts'
import type { SourceReleaseDrafts } from '../sourceReleaseDrafts'
import type { TPurgeDrafts } from '../tPurgeDrafts'
import { SRS_TARGET_PILES } from '../simulation/srsTargets'

interface Props {
  state: SimulationStateWithProgress
  playing: boolean
  playbackSpeed: number
  setPlaybackSpeed: (speed: number) => void
  onPlayPause: () => void
  onStep: () => void
  onReset: () => void
  onStartScenario: () => void
  selectedTargets?: SrsTargetDrafts
  targetErrors?: Partial<Record<SrsPileId, string>>
  targetsDirty?: boolean
  onTargetChange?: (pile: SrsPileId, value: string) => void
  selectedSourceReleases?: SourceReleaseDrafts
  sourceReleaseErrors?: Partial<Record<SourceId, string>>
  sourceReleasesDirty?: boolean
  onSourceReleaseChange?: (source: SourceId, value: string) => void
  selectedTPurge?: TPurgeDrafts
  tPurgeErrors?: Partial<Record<keyof TPurgeDrafts, string>>
  tPurgeDirty?: boolean
  tPurgeMaximum?: number
  onTPurgeChange?: (field: keyof TPurgeDrafts, value: string) => void
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

type RobotCategory = 'TRAVELING' | 'QUEUED' | 'DROP' | 'SHIFT_TAKE' | 'RETURNING'
type ActiveRobotDiagnostic = {
  robotId: number
  missionId: number
  source: SourceId
  missionType: 'CARTBUILD' | 'EMPTY' | 'INBOUND_ONLY'
  lifecycleState: string
  queuePosition: number | null
  returnProgress: number
  outboundPayloadCarried: boolean
  inboundPayloadCarried: boolean
  category: RobotCategory
}

const activeRobotDiagnostics = (state: SimulationStateWithProgress): ActiveRobotDiagnostic[] => {
  const candidates = [
    ...state.asrsRobotSystem.outboundRobots
      .filter((robot) => robot.lifecycleState !== 'OUTBOUND_COMPLETE')
      .map((robot) => ({
        robotId: robot.robotId, missionId: robot.missionId, source: robot.assignedExchanger, missionType: robot.missionType,
        lifecycleState: robot.lifecycleState, queuePosition: robot.queuePosition, returnProgress: robot.returnProgress,
        outboundPayloadCarried: robot.ownsPayload, inboundPayloadCarried: robot.lifecycleState === 'RETURNING_TO_RACK' && robot.inboundTrayId !== null,
      })),
    ...state.asrsRobotSystem.inboundOnlyRobots
      .filter((robot) => robot.lifecycleState !== 'INBOUND_COMPLETE' && robot.lifecycleState !== 'CANCELLED')
      .map((robot) => ({
        robotId: robot.robotId, missionId: robot.missionId, source: robot.assignedExchanger, missionType: 'INBOUND_ONLY' as const,
        lifecycleState: robot.lifecycleState, queuePosition: robot.queuePosition, returnProgress: robot.returnProgress,
        outboundPayloadCarried: false, inboundPayloadCarried: robot.ownsInboundTray,
      })),
  ]
  return candidates.map((robot) => {
    const exchanger = state.asrsRobotSystem.exchangers[robot.source]
    let category: RobotCategory
    if (robot.lifecycleState === 'RETURNING_TO_RACK') category = robot.returnProgress <= 0 ? 'SHIFT_TAKE' : 'RETURNING'
    else if (robot.lifecycleState === 'SHIFTING_TO_TAKE' || exchanger.shiftingOrTakeRobotId === robot.robotId) category = 'SHIFT_TAKE'
    else if (robot.lifecycleState === 'AT_DROP' || robot.lifecycleState === 'BLOCKED_FROM_DROP' || exchanger.dropRobotId === robot.robotId) category = 'DROP'
    else if (robot.queuePosition !== null || robot.lifecycleState === 'QUEUED_FOR_DROP' || robot.lifecycleState === 'HEAD_OF_DROP_QUEUE') category = 'QUEUED'
    else category = 'TRAVELING'
    return { ...robot, category }
  })
}

const utilization = (dual: number, outboundOnly: number) => {
  const denominator = dual + outboundOnly
  return denominator === 0 ? 0 : dual / denominator * 100
}
const utilizationText = (value: number) => value === 0 ? '0%' : `${value.toFixed(1)}%`
const abbreviatedId = (id: number | null) => id === null ? '—' : `R${String(id).slice(-3)}`
const abbreviatedTrayId = (id: number | null) => id === null ? '—' : `T${String(id).slice(-3)}`
const secondsText = (seconds: number | null) => seconds === null ? '—' : `${seconds.toFixed(1)}s`

const SimulationControls: FC<Props> = ({
  state, playing, playbackSpeed, setPlaybackSpeed, onPlayPause, onStep, onReset, onStartScenario, selectedTargets, targetErrors = {}, targetsDirty = false, onTargetChange, selectedSourceReleases, sourceReleaseErrors = {}, sourceReleasesDirty = false, onSourceReleaseChange, selectedTPurge, tPurgeErrors = {}, tPurgeDirty = false, tPurgeMaximum = 12, onTPurgeChange, onOperatingSettingChange, onPlanningCadenceChange, configurationNotice, collapsed, onToggleCollapsed,
}) => {
  const purge = state.returnSystem.activePurgeBatch
  const frozenIds = purge?.authorizedTrayIds ?? state.returnSystem.lastCompletedPurgeBatch?.authorizedTrayIds ?? []
  const activeRobots = activeRobotDiagnostics(state)
  const activeCategoryCount = (category: RobotCategory) => activeRobots.filter((robot) => robot.category === category).length
  const completed = state.asrsRobotSystem.completedCountByClassification
  const globalDualUtilization = utilization(completed.DUAL_CYCLE, completed.OUTBOUND_ONLY)
  const outboundPayloadsCarried = activeRobots.filter((robot) => robot.outboundPayloadCarried).length
  const inboundPayloadsCarried = activeRobots.filter((robot) => robot.inboundPayloadCarried).length
  const cancelledRobotCount = state.asrsRobotSystem.cancelledInboundOnlyRobots.length

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
          {selectedTargets && <fieldset className="srs-target-controls" data-srs-target-controls>
            <legend>SRS target sizes</legend>
            {SRS_TARGET_PILES.map((pile) => <label key={pile}><span>{pile}</span><input aria-label={`${pile} target size`} aria-invalid={Boolean(targetErrors[pile])} aria-describedby={targetErrors[pile] ? `${pile}-target-error` : undefined} type="number" min="1" max="999" step="1" value={selectedTargets[pile]} onChange={(event) => onTargetChange?.(pile, event.currentTarget.value)} />{targetErrors[pile] && <small id={`${pile}-target-error`} role="alert">{targetErrors[pile]}</small>}</label>)}
          </fieldset>}
          {selectedSourceReleases && <fieldset className="srs-target-controls" data-source-release-controls>
            <legend>Release Control</legend>
            <small>Maximum frozen batch released toward T/PRE_T.</small>
            {(['A', 'B', 'C'] as SourceId[]).map((source) => <label key={source}><span>{source}1 batch quantity</span><input aria-label={`${source}1 batch quantity`} aria-invalid={Boolean(sourceReleaseErrors[source])} aria-describedby={sourceReleaseErrors[source] ? `${source}-release-error` : undefined} type="number" min="1" max={source === 'A' ? '45' : '38'} step="1" value={selectedSourceReleases[source]} onChange={(event) => onSourceReleaseChange?.(source, event.currentTarget.value)} /><small>Active: {state.srsControl.sourceReleaseQuantities[source]}</small>{sourceReleaseErrors[source] && <small id={`${source}-release-error`} role="alert">{sourceReleaseErrors[source]}</small>}</label>)}
            {selectedTPurge && <>
              <label><span>T backup trigger</span><input aria-label="T backup trigger" aria-invalid={Boolean(tPurgeErrors.backupTrigger)} type="number" min="1" max="12" step="1" value={selectedTPurge.backupTrigger} onChange={(event) => onTPurgeChange?.('backupTrigger', event.currentTarget.value)} /><small>Active: {state.srsControl.tPurgeSettings.backupTrigger}. Consecutive occupied T zones measured upstream from D while D is blocked. {state.srsControl.tPurgeSettings.backupTrigger} means the {state.srsControl.tPurgeSettings.backupTrigger} T zones nearest D must be occupied.</small>{tPurgeErrors.backupTrigger && <small role="alert">{tPurgeErrors.backupTrigger}</small>}</label>
              <label><span>T purge quantity</span><input aria-label="T purge quantity" aria-invalid={Boolean(tPurgeErrors.purgeQuantity)} type="number" min="1" max={tPurgeMaximum} step="1" value={selectedTPurge.purgeQuantity} onChange={(event) => onTPurgeChange?.('purgeQuantity', event.currentTarget.value)} /><small>Active: {state.srsControl.tPurgeSettings.purgeQuantity}. Maximum frozen batch released from T into PURGE.</small>{tPurgeErrors.purgeQuantity && <small role="alert">{tPurgeErrors.purgeQuantity}</small>}</label>
            </>}
          </fieldset>}
          <button className="start-scenario-button" type="button" disabled={Object.keys(targetErrors).length > 0 || Object.keys(sourceReleaseErrors).length > 0 || Object.keys(tPurgeErrors).length > 0} onClick={onStartScenario}>Start Scenario</button>
          {(targetsDirty || sourceReleasesDirty || tPurgeDirty) && <p className="configuration-notice" role="status">Configuration edits are selected only. Apply with Start Scenario.</p>}
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
                <Metric label="Source batch">{lane.activeSourceBatch ? `${source} max ${lane.activeBatchConfiguredMaximum} · ${lane.sourceBatchReleasedCount}/${lane.frozenSourceBatchQuantity} (${lane.sourceBatchRemainingCount} left)` : 'IDLE'}</Metric>
                <Metric label="Release quantity">{lane.activeReleaseQuantity}</Metric>
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
            <summary>{`T bypass · ${state.srsControl.tBypassBatch.active ? 'ACTIVE' : 'IDLE'} · ${state.srsControl.tBypassBatch.enteredCount}/${state.srsControl.tPurgeSettings.purgeQuantity} entered`}</summary>
            <ul className="detail-list">
              <li>Downstream backup depth: {state.srsControl.tBypassBatch.consecutiveDownstreamBackupDepth}</li>
              <li>D entrance blocked: {state.srsControl.tBypassBatch.dEntranceBlocked ? 'YES' : 'NO'}</li>
              <li>Trigger qualifies: {state.srsControl.tBypassBatch.triggerQualifies ? 'YES' : 'NO'}</li>
              <li>Frozen IDs: {state.srsControl.tBypassBatch.authorizedTrayIds.length ? state.srsControl.tBypassBatch.authorizedTrayIds.join(', ') : 'none'}</li>
              <li>Remaining: {state.srsControl.tBypassBatch.remainingCount}</li>
              <li>Source paused: {state.srsControl.tBypassBatch.sourceBatchPaused ? 'YES' : 'NO'}</li>
              <li>Paused source: {state.srsControl.tBypassBatch.pausedSource ?? 'none'}</li>
            </ul>
          </details>
        </section>

        <section
          className="diagnostic-group asrs-diagnostic-group"
          data-asrs-robot-summary
          data-active-robot-count={activeRobots.length}
          data-traveling-count={activeCategoryCount('TRAVELING')}
          data-queued-count={activeCategoryCount('QUEUED')}
          data-drop-count={activeCategoryCount('DROP')}
          data-shift-take-count={activeCategoryCount('SHIFT_TAKE')}
          data-returning-count={activeCategoryCount('RETURNING')}
          data-dual-cycle-count={completed.DUAL_CYCLE}
          data-outbound-only-count={completed.OUTBOUND_ONLY}
          data-inbound-only-count={completed.INBOUND_ONLY}
          data-cancelled-count={cancelledRobotCount}
          data-dual-utilization={globalDualUtilization.toFixed(1)}
        >
          <details className="asrs-diagnostics" open>
            <summary className="asrs-section-heading">
              <span>ASRS Robots</span>
              <span className={`asrs-status ${activeRobots.length ? 'active' : 'idle'}`}>{activeRobots.length} active</span>
            </summary>
            <div className="diagnostic-grid asrs-global-grid">
              <Metric label="Traveling outbound">{activeCategoryCount('TRAVELING')}</Metric>
              <Metric label="Matured / queued">{activeCategoryCount('QUEUED')}</Metric>
              <Metric label="DROP">{activeCategoryCount('DROP')}</Metric>
              <Metric label="Shift / TAKE">{activeCategoryCount('SHIFT_TAKE')}</Metric>
              <Metric label="Returning">{activeCategoryCount('RETURNING')}</Metric>
              <Metric label="Outbound payloads">{outboundPayloadsCarried}</Metric>
              <Metric label="Inbound payloads">{inboundPayloadsCarried}</Metric>
              <Metric label="Completed total">{state.asrsRobotSystem.completedCycles.length}</Metric>
              <Metric label="Dual / outbound / inbound">{`${completed.DUAL_CYCLE}/${completed.OUTBOUND_ONLY}/${completed.INBOUND_ONLY}`}</Metric>
              <Metric label="Cancelled">{cancelledRobotCount}</Metric>
              <Metric label="Dual utilization">{utilizationText(globalDualUtilization)}</Metric>
            </div>

            <div className="asrs-exchanger-list">
              {(['A', 'B', 'C'] as SourceId[]).map((source) => {
                const exchanger = state.asrsRobotSystem.exchangers[source]
                const sourceRobots = activeRobots.filter((robot) => robot.source === source)
                const dropRobot = sourceRobots.find((robot) => robot.robotId === exchanger.dropRobotId)
                const takeRobot = sourceRobots.find((robot) => robot.robotId === exchanger.shiftingOrTakeRobotId)
                  ?? sourceRobots.find((robot) => robot.lifecycleState === 'RETURNING_TO_RACK' && robot.returnProgress <= 0)
                const reservations = state.asrsRobotSystem.inboundReservations.filter((reservation) => reservation.exchanger === source)
                const sourceCompleted = exchanger.completedCountByClassification
                const sourceCancelled = state.asrsRobotSystem.cancelledInboundOnlyRobots.filter((robot) => robot.exchanger === source).length
                const sourceDualUtilization = utilization(sourceCompleted.DUAL_CYCLE, sourceCompleted.OUTBOUND_ONLY)
                const queueDepth = exchanger.queueLength
                const visibleQueueDepth = Math.min(queueDepth, 4)
                const queueOverflow = Math.max(0, queueDepth - 4)
                const returningCount = sourceRobots.filter((robot) => robot.lifecycleState === 'RETURNING_TO_RACK').length
                const isBlocked = exchanger.dropBlocked
                const status = isBlocked ? 'blocked' : sourceRobots.length ? 'active' : 'idle'
                return <article
                  className={`asrs-exchanger-card ${status}`}
                  key={source}
                  data-exchanger-id={source}
                  data-active-robot-count={sourceRobots.length}
                  data-outbound-traveler-count={sourceRobots.filter((robot) => robot.category === 'TRAVELING').length}
                  data-queue-depth={queueDepth}
                  data-visible-queue-depth={visibleQueueDepth}
                  data-queue-overflow={queueOverflow}
                  data-drop-robot-id={dropRobot?.robotId ?? ''}
                  data-drop-mission-id={dropRobot?.missionId ?? ''}
                  data-drop-mission-type={dropRobot?.missionType ?? ''}
                  data-drop-blocked={isBlocked}
                  data-drop-blocked-reason={exchanger.dropBlockedReason ?? ''}
                  data-take-robot-id={takeRobot?.robotId ?? ''}
                  data-reserved-inbound-tray-ids={reservations.map((reservation) => reservation.trayId).join(',')}
                  data-returning-count={returningCount}
                  data-dual-cycle-count={sourceCompleted.DUAL_CYCLE}
                  data-outbound-only-count={sourceCompleted.OUTBOUND_ONLY}
                  data-inbound-only-count={sourceCompleted.INBOUND_ONLY}
                  data-cancelled-count={sourceCancelled}
                  data-dual-utilization={sourceDualUtilization.toFixed(1)}
                >
                  <div className="asrs-card-heading">
                    <strong>Exchanger {source}</strong>
                    <span className={`asrs-status ${status}`}>{status.toUpperCase()}</span>
                  </div>
                  <div className="diagnostic-grid detail-grid">
                    <Metric label="Active / traveling">{`${sourceRobots.length}/${sourceRobots.filter((robot) => robot.category === 'TRAVELING').length}`}</Metric>
                    <Metric label="Queue / visible / overflow">{`${queueDepth}/${visibleQueueDepth}/${queueOverflow}`}</Metric>
                    <Metric label="DROP robot">{dropRobot ? <span title={`Robot ${dropRobot.robotId} / mission ${dropRobot.missionId}`}>{`${abbreviatedId(dropRobot.robotId)} ${dropRobot.missionType}`}</span> : '—'}</Metric>
                    <Metric label="DROP state" tone={isBlocked ? 'alert' : undefined}>{isBlocked ? `${exchanger.dropBlockedReason} ${secondsText(exchanger.dropBlockedDurationSec)}` : 'CLEAR'}</Metric>
                    <Metric label="Shift / TAKE">{takeRobot ? <span title={`Robot ${takeRobot.robotId} / mission ${takeRobot.missionId}`}>{abbreviatedId(takeRobot.robotId)}</span> : '—'}</Metric>
                    <Metric label="Reserved inbound">{reservations.length ? reservations.map((reservation) => <span key={reservation.trayId} title={`Tray ${reservation.trayId} / robot ${reservation.robotId} / mission ${reservation.missionId}`}>{abbreviatedTrayId(reservation.trayId)}</span>) : '—'}</Metric>
                    <Metric label="Returning">{returningCount}</Metric>
                    <Metric label="Last successful unload">{secondsText(exchanger.lastSuccessfulDropTime)}</Metric>
                    <Metric label="Next DROP admission">{secondsText(exchanger.nextEligibleCycleAdmissionTime)}</Metric>
                    <Metric label="Maximum queue">{exchanger.maximumObservedQueueLength}</Metric>
                    <Metric label="Completed D/O/I">{`${sourceCompleted.DUAL_CYCLE}/${sourceCompleted.OUTBOUND_ONLY}/${sourceCompleted.INBOUND_ONLY}`}</Metric>
                    <Metric label="Cancelled / dual util.">{`${sourceCancelled}/${utilizationText(sourceDualUtilization)}`}</Metric>
                  </div>
                </article>
              })}
            </div>

            <div className="asrs-reservation-list" aria-label="Cartbuild reservations">
              <strong>Cartbuild reservations</strong>
              {(['A', 'B', 'C'] as SourceId[]).map((source) => {
                const lane = state.cartbuildSystem.lanes[`CARTBUILD_${source}` as keyof typeof state.cartbuildSystem.lanes]
                const reservations = state.asrsRobotSystem.inboundReservations.filter((reservation) => reservation.exchanger === source)
                return <div
                  className="asrs-reservation-row"
                  key={source}
                  data-asrs-reservation-exchanger={source}
                  data-cartbuild-capacity={lane.positionCapacity}
                  data-cartbuild-committed={lane.committedPositions}
                  data-cartbuild-available={lane.availablePositions}
                  data-pending-cartbuild={lane.pendingMissionReservations}
                  data-attached-payloads={lane.attachedTrayReservations}
                  data-physical-cartons={lane.physicalLaneOccupancy}
                  data-reserved-inbound-count={reservations.length}
                  data-reserved-inbound-ids={reservations.map((reservation) => reservation.trayId).join(',')}
                >
                  <span>{source}</span>
                  <span>{`cap ${lane.positionCapacity} / committed ${lane.committedPositions} / avail ${lane.availablePositions}`}</span>
                  <span>{`pending ${lane.pendingMissionReservations} / attached ${lane.attachedTrayReservations} / physical ${lane.physicalLaneOccupancy}`}</span>
                  <span title={reservations.length ? reservations.map((reservation) => `tray ${reservation.trayId} / robot ${reservation.robotId}`).join(', ') : undefined}>{`inbound ${reservations.length}`}</span>
                </div>
              })}
            </div>
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
