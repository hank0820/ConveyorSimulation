import SimulationEngine from './src/simulation/SimulationEngine'

const SEGMENTS = [
  { id: 'A1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'A1T' },
  { id: 'A1T', lengthFt: 59, speedFtPerMin: 120, nextSegmentId: 'T' },
  { id: 'T', lengthFt: 33, speedFtPerMin: 120, nextSegmentId: 'D' },
  { id: 'D', lengthFt: 235, speedFtPerMin: 120 },
]

const engine = new SimulationEngine(SEGMENTS)
engine.step(70)
console.log('after70', engine.getState().trays[0])
for (let i=0;i<170;i++){
  engine.step(0.1)
  if (i%10===0) {
    const t = 70 + (i+1)*0.1
    const s = engine.getState()
    const first = s.trays[0]
    console.log(t.toFixed(1), first.currentSegmentId, first.positionFt.toFixed(4))
  }
}
console.log('final', engine.getState().trays[0])
