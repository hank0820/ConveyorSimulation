import { DEFAULT_SOURCE_RELEASE_WINDOW_SEC, SOURCE_RELEASE_WINDOW_MAX_SEC, SOURCE_RELEASE_WINDOW_MIN_SEC } from './simulation/sourceReleaseWindowSettings'

export const defaultSourceReleaseWindowDraft = () => String(DEFAULT_SOURCE_RELEASE_WINDOW_SEC)

export function parseSourceReleaseWindowDraft(draft: string): { value?: number; error?: string } {
  const value = Number(draft)
  if (draft.trim() === '' || !Number.isFinite(value) || value < SOURCE_RELEASE_WINDOW_MIN_SEC || value > SOURCE_RELEASE_WINDOW_MAX_SEC) {
    return { error: `Enter a number from ${SOURCE_RELEASE_WINDOW_MIN_SEC} to ${SOURCE_RELEASE_WINDOW_MAX_SEC}` }
  }
  return { value }
}

export const sourceReleaseWindowIsDirty = (draft: string, active: number) => draft !== String(active)
