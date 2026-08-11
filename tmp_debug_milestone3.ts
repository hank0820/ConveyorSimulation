import SimulationEngine from './src/simulation/SimulationEngine'

const SEGMENTS = [
  { id: 'A1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'A1T' },
  { id: 'A1T', lengthFt: 59, speedFtPerMin: 120, nextSegmentId: 'T' },
  { id: 'T', lengthFt: 33, speedFtPerMin: 120, nextSegmentId: 'D' },
  { id: 'D', lengthFt: 235, speedFtPerMin: 120 },
]

const engine = new SimulationEngine(SEGMENTS)
const checkpoints = [0, 40, 40.5, 41, 70, 86.5, 100, 204, 300]
let last = 0
for (const t of checkpoints) {
  engine.step(t - last)
  last = t
  const s = engine.getState()
  const first = s.trays[0]
  console.log(`t=${t} first=${first ? `${first.currentSegmentId}@${first.positionFt.toFixed(3)}` : 'none'} total=${s.totalTraysCreated} trays=${s.trays.length}`)
}
