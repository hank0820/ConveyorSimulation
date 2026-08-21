import SimulationEngine from './simulation/SimulationEngine'
import type { OperatingSettings, SimulationStateWithProgress, SourceReleaseQuantities, SrsTargets } from './simulation/types'

export function applyOperatingSettingChange(
  engine: SimulationEngine,
  setting: keyof OperatingSettings,
  enabled: boolean,
  pause: () => void,
  publishState: (state: SimulationStateWithProgress) => void,
  publishNotice: (notice: string) => void,
) {
  pause()
  engine.setOperatingSetting(setting, enabled)
  publishState(engine.getState())
  publishNotice('Simulation paused after configuration change')
}

export function applyPlanningCadenceChange(
  engine: SimulationEngine,
  seconds: number,
  pause: () => void,
  publishState: (state: SimulationStateWithProgress) => void,
  publishNotice: (notice: string) => void,
) {
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Planning cadence must be a positive finite number')
  pause()
  engine.setPendingDemandPlanningCadence(seconds)
  publishState(engine.getState())
  publishNotice('Simulation paused after planning cadence change')
}

export function applyStartScenario(
  engine: SimulationEngine,
  settings: OperatingSettings,
  planningCadenceSec: number,
  pause: () => void,
  publishState: (state: SimulationStateWithProgress) => void,
  publishNotice: (notice: string) => void,
  targets?: SrsTargets,
  sourceReleaseQuantities?: SourceReleaseQuantities,
) {
  pause()
  engine.startScenario(settings, planningCadenceSec, targets, sourceReleaseQuantities)
  publishState(engine.getState())
  publishNotice('Scenario started from selected settings')
}
