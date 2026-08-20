import type { SrsPileId, SrsTargets } from './types'
export const SRS_TARGET_PILES: readonly SrsPileId[] = ['A1', 'B1', 'C1', 'T', 'D', 'A2', 'B2', 'C2']
export const DEFAULT_SRS_TARGETS: SrsTargets = Object.freeze({ A1: 24, B1: 16, C1: 16, T: 6, D: 92, A2: 36, B2: 29, C2: 29 })
export function validateSrsTargets(targets: SrsTargets): SrsTargets {
  for (const pile of SRS_TARGET_PILES) if (!Number.isInteger(targets[pile]) || targets[pile] < 1 || targets[pile] > 999) throw new Error(`${pile} target must be an integer from 1 through 999`)
  return { ...targets }
}
