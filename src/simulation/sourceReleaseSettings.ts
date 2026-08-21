import type { SourceId, SourceReleaseQuantities } from './types'

export const SOURCE_RELEASE_SOURCES: SourceId[] = ['A', 'B', 'C']
export const SOURCE_RELEASE_LIMITS: Readonly<Record<SourceId, number>> = Object.freeze({ A: 45, B: 38, C: 38 })
export const DEFAULT_SOURCE_RELEASE_QUANTITIES: SourceReleaseQuantities = Object.freeze({ A: 8, B: 8, C: 8 })

export function validateSourceReleaseQuantities(quantities: SourceReleaseQuantities): SourceReleaseQuantities {
  const validated = {} as Record<SourceId, number>
  for (const source of SOURCE_RELEASE_SOURCES) {
    const value = quantities[source]
    const maximum = SOURCE_RELEASE_LIMITS[source]
    if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`${source}1 release quantity must be an integer from 1 to ${maximum}`)
    validated[source] = value
  }
  return validated
}
