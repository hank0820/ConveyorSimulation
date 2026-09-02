export const DEFAULT_SOURCE_RELEASE_WINDOW_SEC = 10
export const SOURCE_RELEASE_WINDOW_MIN_SEC = 0.1
export const SOURCE_RELEASE_WINDOW_MAX_SEC = 600

export function validateSourceReleaseWindowSec(value: number): number {
  if (!Number.isFinite(value) || value < SOURCE_RELEASE_WINDOW_MIN_SEC || value > SOURCE_RELEASE_WINDOW_MAX_SEC) {
    throw new Error(`Source release window must be a finite number from ${SOURCE_RELEASE_WINDOW_MIN_SEC} to ${SOURCE_RELEASE_WINDOW_MAX_SEC} seconds`)
  }
  return value
}
