import { describe, expect, test } from 'vitest'
import { defaultSourceReleaseDrafts, parseSourceReleaseDrafts, sourceReleasesAreDirty } from './sourceReleaseDrafts'

describe('source release drafts', () => {
  test('defaults to 8/8/8 and produces a defensive parsed value', () => {
    const drafts = defaultSourceReleaseDrafts()
    const parsed = parseSourceReleaseDrafts(drafts)
    expect(drafts).toEqual({ A: '8', B: '8', C: '8' })
    expect(parsed).toEqual({ quantities: { A: 8, B: 8, C: 8 }, errors: {} })
    drafts.A = '9'
    expect(parsed.quantities?.A).toBe(8)
  })

  test.each([
    ['A', '', 45], ['A', '0', 45], ['A', '-1', 45], ['A', '1.5', 45], ['A', 'nope', 45], ['A', '46', 45],
    ['B', '39', 38], ['C', '39', 38],
  ] as const)('rejects invalid %s draft %s without correcting it', (source, value, maximum) => {
    const drafts = defaultSourceReleaseDrafts()
    drafts[source] = value
    const parsed = parseSourceReleaseDrafts(drafts)
    expect(parsed.quantities).toBeUndefined()
    expect(parsed.errors[source]).toBe(`Enter an integer from 1 to ${maximum}`)
    expect(drafts[source]).toBe(value)
  })

  test('accepts boundary values and detects selected-versus-active differences', () => {
    expect(parseSourceReleaseDrafts({ A: '45', B: '1', C: '38' }).quantities).toEqual({ A: 45, B: 1, C: 38 })
    expect(sourceReleasesAreDirty({ A: '8', B: '8', C: '8' }, { A: 8, B: 8, C: 8 })).toBe(false)
    expect(sourceReleasesAreDirty({ A: '9', B: '8', C: '8' }, { A: 8, B: 8, C: 8 })).toBe(true)
  })
})
