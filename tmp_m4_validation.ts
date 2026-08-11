import SimulationEngine from './src/simulation/SimulationEngine.ts'

const SEGMENTS = [
  { id: 'A1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'A1T', maxOccupancy: 24 },
  { id: 'A1T', lengthFt: 59, speedFtPerMin: 120, nextSegmentId: 'T' },
  { id: 'B1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'B1T', maxOccupancy: 16 },
  { id: 'B1T', lengthFt: 44, speedFtPerMin: 120, nextSegmentId: 'T' },
  { id: 'C1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'T', maxOccupancy: 16 },
  { id: 'T', lengthFt: 33, speedFtPerMin: 120, nextSegmentId: 'D', maxOccupancy: 12 },
  { id: 'D', lengthFt: 235, speedFtPerMin: 120, maxOccupancy: 73 },
]

const engine = new SimulationEngine(SEGMENTS)

const maxOcc: Record<string, number> = {
  A1: 0,
  A1T: 0,
  B1: 0,
  B1T: 0,
  C1: 0,
  T: 0,
  D: 0,
}

const firstActual: Record<string, number | null> = {
  A: null,
  B: null,
  C: null,
}
const firstMerge: Record<string, number | null> = {
  A: null,
  B: null,
  C: null,
}
const firstBlockedT: { time: number | null } = { time: null }
const firstBlockedFeeder: { feeder: string | null } = { feeder: null }
const firstSourceBlocked: Record<string, number | null> = {
  A: null,
  B: null,
  C: null,
}

let maxMaterialError = 0

for (let step = 0; step < 20000; step++) {
  engine.step(0.1)
  const time = parseFloat(((step + 1) * 0.1).toFixed(1))
  const state = engine.getState()

  for (const seg of state.segments) {
    const count = state.trays.filter((tray) => tray.currentSegmentId === seg.id).length
    maxOcc[seg.id] = Math.max(maxOcc[seg.id], count)
  }

  for (const src of state.sources) {
    if (src.totalTraysCreated > 0 && firstActual[src.id] === null) {
      firstActual[src.id] = src.lastSourceReleaseTime
    }
    if (src.sourceBlocked && firstSourceBlocked[src.id] === null) {
      firstSourceBlocked[src.id] = time
    }
  }

  const mergeState = state.mergeState
  const counts = {
    A: mergeState.cumulativeTransfersA,
    B: mergeState.cumulativeTransfersB,
    C: mergeState.cumulativeTransfersC,
  }
  for (const id of ['A', 'B', 'C'] as const) {
    if (counts[id] > 0 && firstMerge[id] === null) {
      firstMerge[id] = time
    }
  }

  if (firstBlockedT.time === null) {
    const tCount = state.trays.filter((tray) => tray.currentSegmentId === 'T').length
    if (tCount >= 12) {
      firstBlockedT.time = time
    }
  }

  if (firstBlockedFeeder.feeder === null) {
    for (const feeder of ['A1T', 'B1T', 'C1']) {
      if (state.trays.some((tray) => tray.currentSegmentId === feeder && tray.status === 'BLOCKED')) {
        firstBlockedFeeder.feeder = feeder
        break
      }
    }
  }

  maxMaterialError = Math.max(maxMaterialError, Math.abs(state.materialBalanceError))
}

const final = engine.getState()
console.log(JSON.stringify({
  firstActual,
  firstMerge,
  mergeCounts: {
    A: final.mergeState.cumulativeTransfersA,
    B: final.mergeState.cumulativeTransfersB,
    C: final.mergeState.cumulativeTransfersC,
  },
  firstBlockedT: firstBlockedT.time,
  firstBlockedFeeder: firstBlockedFeeder.feeder,
  firstSourceBlocked,
  maxOcc,
  lastOccupancy: Object.fromEntries(final.segments.map((seg) => [seg.id, final.trays.filter((tray) => tray.currentSegmentId === seg.id).length])),
  totalCreated: final.totalTraysCreated,
  materialBalanceError: final.materialBalanceError,
  maxMaterialError,
  mergeState: final.mergeState,
}, null, 2))
