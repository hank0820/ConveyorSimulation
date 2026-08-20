import { DEFAULT_SRS_TARGETS, SRS_TARGET_PILES } from './simulation/srsTargets'
import type { SrsPileId, SrsTargets } from './simulation/types'

export type SrsTargetDrafts = Record<SrsPileId, string>
export const defaultSrsTargetDrafts = (): SrsTargetDrafts => Object.fromEntries(SRS_TARGET_PILES.map((pile) => [pile, String(DEFAULT_SRS_TARGETS[pile])])) as SrsTargetDrafts
export function parseSrsTargetDrafts(drafts: SrsTargetDrafts): { targets?: SrsTargets; errors: Partial<Record<SrsPileId, string>> } {
  const errors: Partial<Record<SrsPileId, string>> = {}
  const values = {} as Record<SrsPileId, number>
  for (const pile of SRS_TARGET_PILES) {
    const value = Number(drafts[pile])
    if (drafts[pile].trim() === '' || !Number.isInteger(value) || value < 1 || value > 999) errors[pile] = 'Enter an integer from 1 to 999'
    else values[pile] = value
  }
  return Object.keys(errors).length ? { errors } : { targets: values, errors }
}
export const targetsAreDirty = (drafts: SrsTargetDrafts, active: SrsTargets) => SRS_TARGET_PILES.some((pile) => drafts[pile] !== String(active[pile]))
