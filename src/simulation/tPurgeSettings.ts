import type { TPurgeSettings } from './types'

export const DEFAULT_T_PURGE_SETTINGS: Readonly<TPurgeSettings> = Object.freeze({ backupTrigger: 6, purgeQuantity: 6 })

export function validateTPurgeSettings(settings: TPurgeSettings, maximumPurgeQuantity: number): Readonly<TPurgeSettings> {
  if (!Number.isInteger(settings.backupTrigger) || settings.backupTrigger < 1 || settings.backupTrigger > 12) throw new Error('T backup trigger must be an integer from 1 to 12')
  if (!Number.isInteger(settings.purgeQuantity) || settings.purgeQuantity < 1 || settings.purgeQuantity > maximumPurgeQuantity) throw new Error(`T purge quantity must be an integer from 1 to ${maximumPurgeQuantity}`)
  return { backupTrigger: settings.backupTrigger, purgeQuantity: settings.purgeQuantity }
}
