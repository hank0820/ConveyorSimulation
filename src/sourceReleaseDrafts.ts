import { DEFAULT_SOURCE_RELEASE_QUANTITIES, SOURCE_RELEASE_LIMITS, SOURCE_RELEASE_SOURCES } from './simulation/sourceReleaseSettings'
import type { SourceId, SourceReleaseQuantities } from './simulation/types'

export type SourceReleaseDrafts = Record<SourceId, string>
export const defaultSourceReleaseDrafts = (): SourceReleaseDrafts => ({ A: String(DEFAULT_SOURCE_RELEASE_QUANTITIES.A), B: String(DEFAULT_SOURCE_RELEASE_QUANTITIES.B), C: String(DEFAULT_SOURCE_RELEASE_QUANTITIES.C) })

export function parseSourceReleaseDrafts(drafts: SourceReleaseDrafts): { quantities?: SourceReleaseQuantities; errors: Partial<Record<SourceId, string>> } {
  const errors: Partial<Record<SourceId, string>> = {}
  const values = {} as Record<SourceId, number>
  for (const source of SOURCE_RELEASE_SOURCES) {
    const value = Number(drafts[source])
    const maximum = SOURCE_RELEASE_LIMITS[source]
    if (drafts[source].trim() === '' || !Number.isInteger(value) || value < 1 || value > maximum) errors[source] = `Enter an integer from 1 to ${maximum}`
    else values[source] = value
  }
  return Object.keys(errors).length ? { errors } : { quantities: values, errors }
}

export const sourceReleasesAreDirty = (drafts: SourceReleaseDrafts, active: SourceReleaseQuantities) => SOURCE_RELEASE_SOURCES.some((source) => drafts[source] !== String(active[source]))
