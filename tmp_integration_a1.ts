import SimulationEngine from './src/simulation/SimulationEngine'

const SEGMENTS = [
  { id: 'A1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'A1T', maxOccupancy: 24 },
  { id: 'A1T', lengthFt: 59, speedFtPerMin: 120, nextSegmentId: 'T' },
  { id: 'B1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'B1T', maxOccupancy: 16 },
  { id: 'B1T', lengthFt: 44, speedFtPerMin: 120, nextSegmentId: 'T' },
  { id: 'C1', lengthFt: 81, speedFtPerMin: 120, nextSegmentId: 'T', maxOccupancy: 16 },
  { id: 'T', lengthFt: 33, speedFtPerMin: 120, nextSegmentId: 'D', maxOccupancy: 12 },
  { id: 'D', lengthFt: 235, speedFtPerMin: 120, maxOccupancy: 73 },
]

const e = new SimulationEngine(SEGMENTS)
 e.reset()
console.log('Initial state diagnostics:', JSON.stringify(e.getState(), null, 2).slice(0,800))
const maxTime = 600
const dt = 0.25
let prevState = e.getState()
// print initial downstream A tray ids
const initDownA = prevState.trays.filter(t=>t.pilePlacement && t.pilePlacement.pileId==='A1' && t.pilePlacement.component==='MDR_DOWNSTREAM').map(t=>t.id)
console.log('initial A downstream ids', initDownA)
const counts = prevState.trays.reduce((acc:any, t:any)=>{ acc[t.currentSegmentId] = (acc[t.currentSegmentId]||0)+1; return acc }, {})
console.log('initial segment counts', counts)
console.log('initial missions', prevState.missions.length, 'pendingA/B/C', prevState.pendingA, prevState.pendingB, prevState.pendingC)
let korberAt = -1
let a1DownExitAt = -1
let a1UpFreeAt = -1
let a1ReplacementAt = -1
let materialMax = prevState.materialBalanceError
const events: any[] = []
for (let i = 0; i < Math.ceil(maxTime / dt); i++) {
  e.step(dt)
  const s = e.getState()
  if (i < 4) console.log('tick', i, 'time', s.timeSec, 'upA', s.upstreamMdrA, 'beltA', s.beltCountA, 'downA', s.downstreamMdrA, 'purgeA', s.purgeDemandA)
  if (i===0) {
    const afterDownA = s.trays.filter(t=>t.pilePlacement && t.pilePlacement.pileId==='A1' && t.pilePlacement.component==='MDR_DOWNSTREAM').map(t=>t.id)
    console.log('after step0 A downstream ids', afterDownA)
    const counts2 = s.trays.reduce((acc:any, t:any)=>{ acc[t.currentSegmentId] = (acc[t.currentSegmentId]||0)+1; return acc }, {})
    console.log('after step0 segment counts', counts2)
    const missing = initDownA.filter(id=>!afterDownA.includes(id))
    if (missing.length>0) {
      console.log('missing ids', missing)
      for (const m of missing) {
        const found = s.trays.find(t=>t.id===m)
        console.log('tray',m,'now',found)
      }
    }
  }
  materialMax = Math.max(materialMax, s.materialBalanceError)
  // detect korber consumption
  if (korberAt < 0 && s.trays.filter(t => t.currentSegmentId === 'D').length < prevState.trays.filter(t => t.currentSegmentId === 'D').length) {
    korberAt = s.timeSec
    events.push({ time: s.timeSec, event: 'KorberConsumed' })
  }
  // detect A1 downstream exit
  if (a1DownExitAt < 0) {
    if (s.downstreamMdrA < prevState.downstreamMdrA) {
      a1DownExitAt = s.timeSec
      events.push({ time: s.timeSec, event: 'A1DownstreamReleased' })
    } else {
      const prevPileA = new Set(prevState.trays.filter(t => t.pilePlacement && t.pilePlacement.pileId === 'A1').map(t => t.id))
      for (const t of s.trays) {
        if (!prevPileA.has(t.id) && t.originSourceId === 'A' && t.currentSegmentId !== 'A1') {
          // not used
        }
      }
    }
  }
  // detect A1 upstream zone0 free
  if (a1UpFreeAt < 0 && s.upstreamMdrA < prevState.upstreamMdrA) {
    a1UpFreeAt = s.timeSec
    events.push({ time: s.timeSec, event: 'A1UpstreamZone0Free' })
  }
  // detect replacement entry
  if (a1ReplacementAt < 0) {
    const newCreated = s.totalTraysCreated - prevState.totalTraysCreated
    if (newCreated > 0) {
      const createdIds = s.trays.map(t => t.id)
      const lastId = s.totalTraysCreated
      if (createdIds.includes(lastId)) {
        const lastTray = s.trays.find(t => t.id === lastId)
        if (lastTray && lastTray.originSourceId === 'A') {
          a1ReplacementAt = s.timeSec
          events.push({ time: s.timeSec, event: 'A1ReplacementEntered', trayId: lastId })
        }
      }
    }
  }
  prevState = s
  if (korberAt > 0 && a1DownExitAt > 0 && a1UpFreeAt > 0 && a1ReplacementAt > 0) break
}

console.log(JSON.stringify({ korberAt, a1DownExitAt, a1UpFreeAt, a1ReplacementAt, materialMax, events }, null, 2))
