import { describe, expect, test } from 'vitest'
import { defaultSourceReleaseWindowDraft, parseSourceReleaseWindowDraft, sourceReleaseWindowIsDirty } from './sourceReleaseWindowDraft'

describe('source release window draft', () => {
  test('defaults to ten seconds', () => {
    expect(defaultSourceReleaseWindowDraft()).toBe('10')
    expect(parseSourceReleaseWindowDraft('10')).toEqual({ value: 10 })
  })

  test.each(['', '0', '-1', 'nope', 'Infinity', '0.09', '600.1'])('rejects invalid draft %s without correcting it', (draft) => {
    expect(parseSourceReleaseWindowDraft(draft)).toEqual({ error: 'Enter a number from 0.1 to 600' })
  })

  test.each([['0.1', 0.1], ['7.25', 7.25], ['600', 600]] as const)('accepts %s', (draft, value) => {
    expect(parseSourceReleaseWindowDraft(draft)).toEqual({ value })
  })

  test('detects selected-versus-active differences', () => {
    expect(sourceReleaseWindowIsDirty('10', 10)).toBe(false)
    expect(sourceReleaseWindowIsDirty('10.0', 10)).toBe(true)
  })
})
