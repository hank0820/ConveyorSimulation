import { describe, expect, test } from 'vitest'
import { defaultTPurgeDrafts, parseTPurgeDrafts, tPurgeDraftsAreDirty } from './tPurgeDrafts'

describe('T purge drafts', () => {
  test('defaults to 6/6, accepts boundaries, and detects dirty drafts', () => {
    expect(defaultTPurgeDrafts()).toEqual({ backupTrigger: '6', purgeQuantity: '6' })
    expect(parseTPurgeDrafts({ backupTrigger: '1', purgeQuantity: '12' }).settings).toEqual({ backupTrigger: 1, purgeQuantity: 12 })
    expect(parseTPurgeDrafts({ backupTrigger: '12', purgeQuantity: '1' }).settings).toEqual({ backupTrigger: 12, purgeQuantity: 1 })
    expect(tPurgeDraftsAreDirty({ backupTrigger: '6', purgeQuantity: '6' }, { backupTrigger: 6, purgeQuantity: 6 })).toBe(false)
    expect(tPurgeDraftsAreDirty({ backupTrigger: '7', purgeQuantity: '6' }, { backupTrigger: 6, purgeQuantity: 6 })).toBe(true)
  })

  test.each(['', '0', '-1', '1.5', 'nope', '13'])('preserves and rejects invalid value %j for both fields', (value) => {
    const drafts = { backupTrigger: value, purgeQuantity: value }
    const parsed = parseTPurgeDrafts(drafts)
    expect(parsed.settings).toBeUndefined()
    expect(parsed.errors).toEqual({ backupTrigger: 'Enter an integer from 1 to 12', purgeQuantity: 'Enter an integer from 1 to 12' })
    expect(drafts).toEqual({ backupTrigger: value, purgeQuantity: value })
  })

  test('derives the purge validation maximum from the supplied physical limit', () => {
    expect(parseTPurgeDrafts({ backupTrigger: '6', purgeQuantity: '9' }, 8).errors.purgeQuantity).toBe('Enter an integer from 1 to 8')
  })
})
