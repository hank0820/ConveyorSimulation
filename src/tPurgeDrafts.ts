import { DEFAULT_T_PURGE_SETTINGS } from './simulation/tPurgeSettings'
import type { TPurgeSettings } from './simulation/types'

export type TPurgeDrafts = { backupTrigger: string; purgeQuantity: string }
export const defaultTPurgeDrafts = (): TPurgeDrafts => ({ backupTrigger: String(DEFAULT_T_PURGE_SETTINGS.backupTrigger), purgeQuantity: String(DEFAULT_T_PURGE_SETTINGS.purgeQuantity) })

export function parseTPurgeDrafts(drafts: TPurgeDrafts, maximumPurgeQuantity = 12): { settings?: TPurgeSettings; errors: Partial<Record<keyof TPurgeDrafts, string>> } {
  const errors: Partial<Record<keyof TPurgeDrafts, string>> = {}
  const trigger = Number(drafts.backupTrigger)
  const quantity = Number(drafts.purgeQuantity)
  if (drafts.backupTrigger.trim() === '' || !Number.isInteger(trigger) || trigger < 1 || trigger > 12) errors.backupTrigger = 'Enter an integer from 1 to 12'
  if (drafts.purgeQuantity.trim() === '' || !Number.isInteger(quantity) || quantity < 1 || quantity > maximumPurgeQuantity) errors.purgeQuantity = `Enter an integer from 1 to ${maximumPurgeQuantity}`
  return Object.keys(errors).length ? { errors } : { settings: { backupTrigger: trigger, purgeQuantity: quantity }, errors }
}

export const tPurgeDraftsAreDirty = (drafts: TPurgeDrafts, active: TPurgeSettings) => drafts.backupTrigger !== String(active.backupTrigger) || drafts.purgeQuantity !== String(active.purgeQuantity)
