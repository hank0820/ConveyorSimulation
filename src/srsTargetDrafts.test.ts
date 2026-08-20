import { describe, expect, test } from 'vitest'
import { defaultSrsTargetDrafts, parseSrsTargetDrafts, targetsAreDirty } from './srsTargetDrafts'
import { DEFAULT_SRS_TARGETS } from './simulation/srsTargets'

describe('SRS target drafts', () => {
  test('preserves invalid text while reporting per-field errors', () => {
    const drafts = { ...defaultSrsTargetDrafts(), A1: '12.5', B1: '', C1: '1000' }
    const result = parseSrsTargetDrafts(drafts)
    expect(drafts).toMatchObject({ A1: '12.5', B1: '', C1: '1000' })
    expect(result.targets).toBeUndefined()
    expect(result.errors).toEqual({ A1: expect.any(String), B1: expect.any(String), C1: expect.any(String) })
  })
  test('parses valid values and tracks selected-versus-active dirtiness', () => {
    const drafts = defaultSrsTargetDrafts()
    expect(parseSrsTargetDrafts(drafts).targets).toEqual(DEFAULT_SRS_TARGETS)
    expect(targetsAreDirty(drafts, DEFAULT_SRS_TARGETS)).toBe(false)
    drafts.A2 = '37'
    expect(targetsAreDirty(drafts, DEFAULT_SRS_TARGETS)).toBe(true)
  })
})
