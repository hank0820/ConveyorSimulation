import type { Tray, ConveyorSegmentConfig, SimulationStateWithProgress, SourceConfig, SourceId, MergeState, SourceState } from './types'
import ConveyorSegment from './ConveyorSegment'

const INTERNAL_TICK_SECONDS = 0.1
const EPS = 1e-9
const DEFAULT_SOURCE_CONFIGS: SourceConfig[] = [
  { id: 'A', firstSegmentId: 'A1', initialOffsetSec: 0 },
  { id: 'B', firstSegmentId: 'B1', initialOffsetSec: 2 },
  { id: 'C', firstSegmentId: 'C1', initialOffsetSec: 4 },
]

export class SimulationEngine {
  private timeSec = 0
  private trays: Tray[] = []
  private segmentsMap: Map<string, ConveyorSegment>
  private segmentsOrder: ConveyorSegmentConfig[]

  // source + physical params
  private trayPitchFt: number
  private sourceHeadwaySec: number
  private sourcesConfig: SourceConfig[]
  private sourcesState: SourceState[]
  private totalTraysCreated = 0

  // Milestone 5 control / ASRS / Korber
  private missions: import('./types').Mission[] = []
  private missionCounter = 0
  private asrsNextAssign: SourceId = 'A'
  private asrsAssignedA = 0
  private asrsAssignedB = 0
  private asrsAssignedC = 0
  private asrsLastReleaseTime: Record<SourceId, number> = { A: -1e9, B: -1e9, C: -1e9 }
  private asrsHeadwaySec = 8 // exchanger release headway

  private korberLastConsumption: number = -Number.MAX_VALUE
  private korberTotalConsumed = 0
  private korberHeadwaySec = 3600 / 1050

  // control release RR pointer (distinct from ASRS assignment RR)
  private controlNextPriority: SourceId = 'A'

  // merge arbitration
  private mergeState: MergeState
  // compatibility: use legacy periodic source injection when topology is small
  private useLegacySources: boolean

  constructor(
    segmentConfigs: ConveyorSegmentConfig[],
    options?: {
      trayPitchFt?: number
      sourceRatePerHour?: number
      sourcesConfig?: SourceConfig[]
    }
  ) {
    this.segmentsMap = new Map(segmentConfigs.map((c) => [c.id, new ConveyorSegment(c)]))
    this.segmentsOrder = segmentConfigs
    this.trayPitchFt = options?.trayPitchFt ?? 3.0
    const rate = options?.sourceRatePerHour ?? 450
    this.sourceHeadwaySec = 3600 / rate
    this.sourcesConfig = options?.sourcesConfig ?? DEFAULT_SOURCE_CONFIGS
    this.useLegacySources = !(this.segmentsMap.has('B1') && this.segmentsMap.has('C1'))
    if (this.useLegacySources) {
      this.sourcesConfig = this.sourcesConfig.filter((cfg) => cfg.id === 'A')
    }
    this.sourcesState = this.sourcesConfig
      .filter((cfg) => this.segmentsMap.has(cfg.firstSegmentId))
      .map((cfg) => ({
        id: cfg.id,
        enabled: true,
        sourceReady: false,
        sourceBlocked: false,
        lastSourceReleaseTime: cfg.initialOffsetSec - this.sourceHeadwaySec,
        nextReleaseTime: cfg.initialOffsetSec,
        totalTraysCreated: 0,
        headwaySec: this.sourceHeadwaySec,
        initialOffsetSec: cfg.initialOffsetSec,
        firstSegmentId: cfg.firstSegmentId,
      }))
    this.mergeState = {
      nextPriority: 'A',
      eligibleA: false,
      eligibleB: false,
      eligibleC: false,
      selectedSource: 'NONE',
      cumulativeTransfersA: 0,
      cumulativeTransfersB: 0,
      cumulativeTransfersC: 0,
    }

    // determine legacy vs Milestone5 mode: legacy when B1/C1 absent
    this.useLegacySources = !(this.segmentsMap.has('B1') && this.segmentsMap.has('C1'))

    this.tryInjectSources()

    // initialize default runtime state (constructor creates initial legacy tray at t=0)
    this.reset()
    if (this.useLegacySources) this.processLegacySources()
  }

  step(seconds: number) {
    if (seconds <= 0) return
    let remaining = seconds
    while (remaining > 0) {
      const delta = Math.min(INTERNAL_TICK_SECONDS, remaining)
      remaining -= delta
      this.timeSec += delta

      // for legacy topologies, inject periodic source trays
      if (this.useLegacySources) this.processLegacySources()

      // Control loop step order (deterministic):
      // 1. mature ASRS missions
      // 2. process Korber consumption
      // 3. create ASRS missions if needed
      // 4. calculate purge demands and select control release
      // 5. process physical movement
      // 6. attempt actual exchanger releases into A1/B1/C1
      this.matureMissions()
      this.processKorber()
      this.createAdditionalASRSMissionsIfNeeded()
      this.evaluateControlSelection()

      this.processTick(delta)
      this.attemptExchangerReleases()
    }
  }

  private tryInjectSources() {
    // Milestone 5 replaces periodic test sources with ASRS/exchanger missions.
    // For backwards compatibility, enable legacy periodic source injection when topology
    // doesn't include full A/B/C exchanger segments.
    for (const source of this.sourcesState) {
      if (this.useLegacySources) {
        source.sourceReady = true
        source.sourceBlocked = false
      } else {
        source.sourceReady = false
        source.sourceBlocked = false
      }
    }
  }

  private processLegacySources() {
    // release periodic source trays according to each source's schedule
    for (const src of this.sourcesState) {
      if (!src.enabled) continue
      // release as many as needed if time advanced beyond multiple headways
      while (this.timeSec + EPS >= src.nextReleaseTime) {
        // respect segment existence and entry rules
        if (this.segmentsMap.has(src.firstSegmentId) && this.canEnterSegment(src.firstSegmentId, 0)) {
          const tray = this.createTrayAt(src.firstSegmentId, 0, src.id)
          this.trays.push(tray)
          src.totalTraysCreated += 1
          this.totalTraysCreated += 0 // createTrayAt already increments
          src.lastSourceReleaseTime = this.timeSec
        }
        src.nextReleaseTime += src.headwaySec
      }
    }
  }

  private processTick(deltaSec: number) {
    this.updateMergeEligibility()

    const segmentIndex: Record<string, number> = {}
    this.segmentsOrder.forEach((s, i) => (segmentIndex[s.id] = i))

    const traysOrder = this.trays.slice().sort((a, b) => {
      const ia = segmentIndex[a.currentSegmentId]
      const ib = segmentIndex[b.currentSegmentId]
      if (ia !== ib) return ib - ia
      return b.positionFt - a.positionFt
    })

    for (const t of traysOrder) {
      if (t.status !== 'MOVING' && t.status !== 'BLOCKED') continue
      const segConfig = this.segmentsMap.get(t.currentSegmentId)!.config
      let distance = (segConfig.speedFtPerMin / 60) * deltaSec
      let blocked = false
      while (distance > EPS && !blocked) {
        const seg = this.segmentsMap.get(t.currentSegmentId)!
        const remainingOnSegment = seg.config.lengthFt - t.positionFt

        if (remainingOnSegment <= EPS) {
          const nextId = seg.config.nextSegmentId
          if (nextId && this.tryTransferToNextSegment(t, seg.config.id, nextId, distance)) {
            continue
          }
          t.positionFt = seg.config.lengthFt
          t.status = 'BLOCKED'
          blocked = true
          break
        }

        const downstreamNeighbor = this.findDownstreamNeighborOnSameSegment(t)
        let maxByNeighbor = remainingOnSegment
        if (downstreamNeighbor) {
          const gap = downstreamNeighbor.positionFt - t.positionFt - this.trayPitchFt
          maxByNeighbor = Math.max(0, Math.min(maxByNeighbor, gap))
        }

        if (distance <= maxByNeighbor + EPS) {
          t.positionFt += distance
          distance = 0
          if (t.positionFt >= seg.config.lengthFt - EPS) {
            const nextId = seg.config.nextSegmentId
            if (nextId && this.tryTransferToNextSegment(t, seg.config.id, nextId, 0)) {
              continue
            }
            t.positionFt = seg.config.lengthFt
            t.status = 'BLOCKED'
            blocked = true
          } else {
            t.status = 'MOVING'
          }
          break
        }

        const isBlockedByNeighbor = maxByNeighbor + EPS < remainingOnSegment
        if (maxByNeighbor <= EPS && !isBlockedByNeighbor) {
          t.status = 'BLOCKED'
          blocked = true
          break
        }

        t.positionFt += maxByNeighbor
        distance -= maxByNeighbor

        if (isBlockedByNeighbor) {
          t.status = 'BLOCKED'
          blocked = true
          break
        }

        const nextId = seg.config.nextSegmentId
        if (nextId && this.tryTransferToNextSegment(t, seg.config.id, nextId, distance)) {
          continue
        }

        t.positionFt = seg.config.lengthFt
        t.status = 'BLOCKED'
        blocked = true
        break
      }
    }
  }

  private findDownstreamNeighborOnSameSegment(tray: Tray): Tray | undefined {
    const same = this.trays.filter((t) => t.currentSegmentId === tray.currentSegmentId && t.id !== tray.id)
    let candidates = same.filter((t) => t.positionFt > tray.positionFt + EPS)
    if (candidates.length === 0) return undefined
    candidates.sort((a, b) => a.positionFt - b.positionFt)
    return candidates[0]
  }

  private createTrayAt(segmentId: string, positionFt: number, origin: SourceId): Tray {
    this.totalTraysCreated += 1
    const tray: Tray = {
      id: this.totalTraysCreated,
      currentSegmentId: segmentId,
      positionFt,
      status: 'MOVING',
      createdAtSec: this.timeSec,
      originSourceId: origin,
    }
    return tray
  }

  private populateInitialPile(segmentId: string, count: number, origin: SourceId) {
    const seg = this.segmentsMap.get(segmentId)!.config
    // place downstream-most near end, then upstream with trayPitch spacing
    const epsilon = 0.01
    for (let i = 0; i < count; i++) {
      const pos = Math.max(0, seg.lengthFt - epsilon - i * this.trayPitchFt)
      const tray = this.createTrayAt(segmentId, pos, origin)
      this.trays.push(tray)
    }
  }

  private matureMissions() {
    for (const m of this.missions) {
      if (m.state === 'RETRIEVING' && this.timeSec + EPS >= m.readyAtSec) {
        m.state = 'READY_AT_EXCHANGER'
      }
    }
  }

  private processKorber() {
    if (this.useLegacySources) return
    // consume one tray from downstream-most of D if available and headway satisfied
    const dSeg = this.segmentsMap.get('D')
    if (!dSeg) return
    const traysOnD = this.trays.filter((t) => t.currentSegmentId === 'D')
    if (traysOnD.length === 0) return
    const headwayElapsed = this.timeSec - this.korberLastConsumption >= this.korberHeadwaySec
    if (this.korberLastConsumption === -Number.MAX_VALUE || headwayElapsed) {
      // consume downstream-most tray
      const lastTray = traysOnD.reduce((max, t) => (t.positionFt > max.positionFt ? t : max), traysOnD[0])
      const idx = this.trays.findIndex((t) => t.id === lastTray.id)
      if (idx >= 0) {
        this.trays.splice(idx, 1)
        this.korberTotalConsumed += 1
        this.korberLastConsumption = this.timeSec
      }
    }
  }

  private countPendingByBranch() {
    const pending = { A: 0, B: 0, C: 0 }
    for (const m of this.missions) {
      if (m.state !== 'RELEASED') pending[m.assignedExchanger] += 1
    }
    return pending
  }

  private createAdditionalASRSMissionsIfNeeded() {
    // compute counts
    const occA = this.trays.filter((t) => t.currentSegmentId === 'A1').length
    const occB = this.trays.filter((t) => t.currentSegmentId === 'B1').length
    const occC = this.trays.filter((t) => t.currentSegmentId === 'C1').length
    const currentCount = occA + occB + occC
    const targetA = this.segmentsMap.get('A1')?.config.maxOccupancy ?? 24
    const targetB = this.segmentsMap.get('B1')?.config.maxOccupancy ?? 16
    const targetC = this.segmentsMap.get('C1')?.config.maxOccupancy ?? 16
    const targetD = this.segmentsMap.get('D')?.config.maxOccupancy ?? 73
    const target = targetA + targetB + targetC + targetD
    const pending = this.countPendingByBranch()
    const totalPending = pending.A + pending.B + pending.C
    const additional = Math.max(0, target - currentCount - totalPending)
    if (additional <= 0) return
    for (let i = 0; i < additional; i++) {
      const assigned = this.asrsNextAssign
      const mission = {
        missionId: ++this.missionCounter,
        assignedExchanger: assigned,
        createdAtSec: this.timeSec,
        readyAtSec: this.timeSec + 180,
        state: 'RETRIEVING' as const,
      }
      this.missions.push(mission)
      // advance ASRS RR pointer and cumulative counters
      if (this.asrsNextAssign === 'A') {
        this.asrsAssignedA += 1
        this.asrsNextAssign = 'B'
      } else if (this.asrsNextAssign === 'B') {
        this.asrsAssignedB += 1
        this.asrsNextAssign = 'C'
      } else {
        this.asrsAssignedC += 1
        this.asrsNextAssign = 'A'
      }
    }
  }

  private evaluateControlSelection() {
    if (this.useLegacySources) {
      this.mergeState.selectedSource = 'NONE'
      return
    }
    // compute counts and purge demands
    const occA = this.trays.filter((t) => t.currentSegmentId === 'A1').length
    const occB = this.trays.filter((t) => t.currentSegmentId === 'B1').length
    const occC = this.trays.filter((t) => t.currentSegmentId === 'C1').length
    const pending = this.countPendingByBranch()

    const targetA = this.segmentsMap.get('A1')?.config.maxOccupancy ?? 24
    const targetB = this.segmentsMap.get('B1')?.config.maxOccupancy ?? 16
    const targetC = this.segmentsMap.get('C1')?.config.maxOccupancy ?? 16

    const purgeA = occA - targetA + pending.A
    const purgeB = occB - targetB + pending.B
    const purgeC = occC - targetC + pending.C

    // determine physically eligible feeders (feeder at end and T has entry)
    const feederEligibility: Record<SourceId, boolean> = { A: false, B: false, C: false }
    for (const src of ['A','B','C'] as SourceId[]) {
      const feederSegmentId = src === 'C' ? 'C1' : `${src}1T`
      const feederSeg = this.segmentsMap.get(feederSegmentId)
      if (!feederSeg) continue
      const feederTrays = this.trays.filter((t) => t.currentSegmentId === feederSegmentId)
      if (feederTrays.length === 0) continue
      const lastTray = feederTrays.reduce((max, t) => (t.positionFt > max.positionFt ? t : max), feederTrays[0])
      const atEnd = lastTray.positionFt >= feederSeg.config.lengthFt - EPS
      const canEnter = this.canEnterSegment('T', 0)
      feederEligibility[src] = atEnd && canEnter
    }

    // select among branches that have purgeDemand>0 and are physically eligible
    const candidates: SourceId[] = []
    if (purgeA > 0 && feederEligibility.A) candidates.push('A')
    if (purgeB > 0 && feederEligibility.B) candidates.push('B')
    if (purgeC > 0 && feederEligibility.C) candidates.push('C')

    let selected: SourceId | 'NONE' = 'NONE'
    if (candidates.length === 1) selected = candidates[0]
    else if (candidates.length > 1) {
      // pick highest purgeDemand then RR tie-break
      const demands: Record<SourceId, number> = { A: purgeA, B: purgeB, C: purgeC }
      let maxDemand = Math.max(...candidates.map(c => demands[c]))
      const top = candidates.filter(c => demands[c] === maxDemand)
      if (top.length === 1) selected = top[0]
      else {
        // tie-break by control RR pointer
        const order: SourceId[] = ['A','B','C']
        let idx = order.indexOf(this.controlNextPriority)
        for (let i=0;i<order.length;i++){
          const cand = order[(idx+i)%order.length]
          if (top.includes(cand)) { selected = cand; break }
        }
      }
    }

    this.mergeState.selectedSource = selected
    if (selected !== 'NONE') {
      // advance control pointer
      if (selected === 'A') this.controlNextPriority = 'B'
      else if (selected === 'B') this.controlNextPriority = 'C'
      else this.controlNextPriority = 'A'
    }
  }

  private attemptExchangerReleases() {
    // try to release READY_AT_EXCHANGER missions into A1/B1/C1 respecting 8s headway
    const exchangers: SourceId[] = ['A','B','C']
    for (const ex of exchangers) {
      // find oldest ready mission for this exchanger
      const idx = this.missions.findIndex(m => m.assignedExchanger === ex && m.state === 'READY_AT_EXCHANGER')
      if (idx === -1) continue
      const lastRel = this.asrsLastReleaseTime[ex]
      if (this.timeSec - lastRel < this.asrsHeadwaySec - EPS) continue
      const firstMission = this.missions[idx]
      const targetSeg = ex === 'A' ? 'A1' : ex === 'B' ? 'B1' : 'C1'
      if (!this.canEnterSegment(targetSeg, 0)) continue
      // create a physical tray at entrance
      const tray = this.createTrayAt(targetSeg, 0, ex)
      this.trays.push(tray)
      firstMission.state = 'RELEASED'
      this.asrsLastReleaseTime[ex] = this.timeSec
    }
  }

  private updateMergeEligibility() {
    if (this.useLegacySources) {
      this.mergeState.eligibleA = false
      this.mergeState.eligibleB = false
      this.mergeState.eligibleC = false
      this.mergeState.selectedSource = 'NONE'
      return
    }
    const eligible = {
      A: false,
      B: false,
      C: false,
    }

    for (const source of this.sourcesState) {
      const feederSegmentId = source.id === 'C' ? 'C1' : `${source.id}1T`
      const feederSeg = this.segmentsMap.get(feederSegmentId)
      if (!feederSeg) continue
      const feederTrays = this.trays.filter((t) => t.currentSegmentId === feederSegmentId)
      if (feederTrays.length === 0) continue
      const lastTray = feederTrays.reduce((max, t) => (t.positionFt > max.positionFt ? t : max), feederTrays[0])
      const atEnd = lastTray.positionFt >= feederSeg.config.lengthFt - EPS
      const canEnter = this.canEnterSegment('T', 0)
      eligible[source.id] = atEnd && canEnter
    }

    this.mergeState.eligibleA = eligible.A
    this.mergeState.eligibleB = eligible.B
    this.mergeState.eligibleC = eligible.C

    // prefer control-selected source if set and eligible
    if (this.mergeState.selectedSource !== 'NONE') {
      const sel = this.mergeState.selectedSource
      if (eligible[sel]) {
        this.transferFromFeederToT(sel)
        return
      }
    }

    // fallback to physical RR selection
    const selected = this.selectMergeSource(eligible)
    if (selected !== 'NONE') {
      this.mergeState.selectedSource = selected
      this.transferFromFeederToT(selected)
    }
  }

  private selectMergeSource(eligible: Record<SourceId, boolean>): SourceId | 'NONE' {
    const order: SourceId[] = ['A', 'B', 'C']
    let idx = order.indexOf(this.mergeState.nextPriority)
    for (let i = 0; i < order.length; i++) {
      const sourceId = order[(idx + i) % order.length]
      if (eligible[sourceId]) return sourceId
    }
    return 'NONE'
  }

  private transferFromFeederToT(sourceId: SourceId) {
    const feederSegmentId = sourceId === 'C' ? 'C1' : `${sourceId}1T`
    const feederSeg = this.segmentsMap.get(feederSegmentId)
    const targetTrays = this.trays.filter((t) => t.currentSegmentId === feederSegmentId)
    if (!feederSeg || targetTrays.length === 0) return
    const lastTray = targetTrays.reduce((max, t) => (t.positionFt > max.positionFt ? t : max), targetTrays[0])
    if (lastTray.positionFt < feederSeg.config.lengthFt - EPS) return
    const allowedIntoNext = this.allowedEntryDistance('T')
    if (allowedIntoNext <= EPS) return
    if (sourceId === 'A' || sourceId === 'B' || sourceId === 'C') {
      lastTray.currentSegmentId = 'T'
      lastTray.positionFt = Math.min(allowedIntoNext, 0)
      lastTray.status = 'MOVING'
      this.advanceMergePointer(sourceId)
      if (sourceId === 'A') this.mergeState.cumulativeTransfersA += 1
      if (sourceId === 'B') this.mergeState.cumulativeTransfersB += 1
      if (sourceId === 'C') this.mergeState.cumulativeTransfersC += 1
    }
  }

  private advanceMergePointer(sourceId: SourceId) {
    if (sourceId === 'A') this.mergeState.nextPriority = 'B'
    else if (sourceId === 'B') this.mergeState.nextPriority = 'C'
    else this.mergeState.nextPriority = 'A'
  }

  private tryTransferToNextSegment(t: Tray, currentSegmentId: string, nextId: string, distance: number): boolean {
    const isMergeFeeder = ['A1T', 'B1T', 'C1'].includes(currentSegmentId)
    if (nextId === 'T' && isMergeFeeder) {
      // determine feeder source id
      const feederMap: Record<string, SourceId> = { A1T: 'A', B1T: 'B', C1: 'C' }
      const feeder = feederMap[currentSegmentId as keyof typeof feederMap]
      if (!this.useLegacySources && this.mergeState.selectedSource !== feeder) return false
    }
    const allowedIntoNext = this.allowedEntryDistance(nextId)
    if (allowedIntoNext <= EPS) return false
    t.currentSegmentId = nextId
    const enterDist = Math.min(distance, allowedIntoNext)
    t.positionFt = enterDist
    return true
  }

  private allowedEntryDistance(segmentId: string): number {
    const segCfg = this.segmentsMap.get(segmentId)?.config
    if (!segCfg) return 0
    const traysOn = this.trays.filter((t) => t.currentSegmentId === segmentId)
    const occupancy = traysOn.length
    if (segCfg.maxOccupancy !== undefined && occupancy >= segCfg.maxOccupancy) return 0
    if (traysOn.length === 0) return Infinity
    const nearest = traysOn.reduce((min, t) => (t.positionFt < min.positionFt ? t : min), traysOn[0])
    const allowed = nearest.positionFt - this.trayPitchFt
    return Math.max(0, allowed)
  }

  private canEnterSegment(segmentId: string, desiredEntryDist: number): boolean {
    const segCfg = this.segmentsMap.get(segmentId)?.config
    if (!segCfg) return false
    const traysOn = this.trays.filter((t) => t.currentSegmentId === segmentId)
    const occupancy = traysOn.length
    if (segCfg.maxOccupancy !== undefined && occupancy >= segCfg.maxOccupancy) return false
    if (traysOn.length === 0) return true
    const nearest = traysOn.reduce((min, t) => (t.positionFt < min.positionFt ? t : min), traysOn[0])
    return nearest.positionFt - this.trayPitchFt >= desiredEntryDist - EPS
  }

  reset() {
    this.timeSec = 0
    this.trays = []
    this.totalTraysCreated = 0
    // reset sources (exchangers)
    this.sourcesState = this.sourcesConfig.map((cfg) => ({
      id: cfg.id,
      enabled: true,
      sourceReady: false,
      sourceBlocked: false,
      lastSourceReleaseTime: cfg.initialOffsetSec - this.sourceHeadwaySec,
      nextReleaseTime: cfg.initialOffsetSec,
      totalTraysCreated: 0,
      headwaySec: this.sourceHeadwaySec,
      initialOffsetSec: cfg.initialOffsetSec,
      firstSegmentId: cfg.firstSegmentId,
    }))

    // reset merge state
    this.mergeState = {
      nextPriority: 'A',
      eligibleA: false,
      eligibleB: false,
      eligibleC: false,
      selectedSource: 'NONE',
      cumulativeTransfersA: 0,
      cumulativeTransfersB: 0,
      cumulativeTransfersC: 0,
    }

    // reset ASRS / missions
    this.missions = []
    this.missionCounter = 0
    this.asrsNextAssign = 'A'
    this.asrsAssignedA = 0
    this.asrsAssignedB = 0
    this.asrsAssignedC = 0
    this.asrsLastReleaseTime = { A: -1e9, B: -1e9, C: -1e9 }

    // reset Korber
    this.korberLastConsumption = -Number.MAX_VALUE
    this.korberTotalConsumed = 0

    // control pointer
    this.controlNextPriority = 'A'

    // initial physical piles per Milestone 5 (only populate when full A/B/C/D topology exists)
    // A1 = 24, B1 = 16, C1 = 16, D = 73
    if (this.segmentsMap.has('A1') && this.segmentsMap.has('B1') && this.segmentsMap.has('C1') && this.segmentsMap.has('D')) {
      this.populateInitialPile('A1', 24, 'A')
      this.populateInitialPile('B1', 16, 'B')
      this.populateInitialPile('C1', 16, 'C')
      this.populateInitialPile('D', 73, 'A')
    }
  }

  getState(): SimulationStateWithProgress {
    const segments = this.segmentsOrder.map((s) => ({ ...s }))
    const totalRouteDistance = segments.reduce((acc, s) => acc + s.lengthFt, 0)
    const segmentStats = segments.map((s) => {
      const occ = this.trays.filter((t) => t.currentSegmentId === s.id).length
      const capacity = s.maxOccupancy ?? Math.floor(s.lengthFt / this.trayPitchFt)
      const pct = capacity > 0 ? (occ / capacity) * 100 : undefined
      return { id: s.id, occupancy: occ, capacity: s.maxOccupancy, occupancyPct: pct }
    })
    const movingCount = this.trays.filter((t) => t.status === 'MOVING').length
    const blockedCount = this.trays.filter((t) => t.status === 'BLOCKED').length
    const materialBalanceError = this.trays.length - this.totalTraysCreated
    const sources = this.sourcesState.map((s) => ({ ...s }))
    const sourceState = sources[0] ?? {
      id: 'A' as SourceId,
      enabled: false,
      sourceReady: false,
      sourceBlocked: false,
      lastSourceReleaseTime: -this.sourceHeadwaySec,
      nextReleaseTime: 0,
      totalTraysCreated: 0,
      headwaySec: this.sourceHeadwaySec,
      initialOffsetSec: 0,
      firstSegmentId: this.segmentsOrder[0]?.id ?? '',
    }

    // diagnostics
    const pendingBy = this.countPendingByBranch()
    const retrievingA = this.missions.filter(m => m.assignedExchanger === 'A' && m.state === 'RETRIEVING').length
    const retrievingB = this.missions.filter(m => m.assignedExchanger === 'B' && m.state === 'RETRIEVING').length
    const retrievingC = this.missions.filter(m => m.assignedExchanger === 'C' && m.state === 'RETRIEVING').length
    const readyA = this.missions.filter(m => m.assignedExchanger === 'A' && m.state === 'READY_AT_EXCHANGER').length
    const readyB = this.missions.filter(m => m.assignedExchanger === 'B' && m.state === 'READY_AT_EXCHANGER').length
    const readyC = this.missions.filter(m => m.assignedExchanger === 'C' && m.state === 'READY_AT_EXCHANGER').length

    const occA = this.trays.filter((t) => t.currentSegmentId === 'A1').length
    const occB = this.trays.filter((t) => t.currentSegmentId === 'B1').length
    const occC = this.trays.filter((t) => t.currentSegmentId === 'C1').length
    const occD = this.trays.filter((t) => t.currentSegmentId === 'D').length
    const occA1T = this.trays.filter((t) => t.currentSegmentId === 'A1T').length
    const occB1T = this.trays.filter((t) => t.currentSegmentId === 'B1T').length
    const occT = this.trays.filter((t) => t.currentSegmentId === 'T').length

    const targetA = this.segmentsMap.get('A1')?.config.maxOccupancy ?? 24
    const targetB = this.segmentsMap.get('B1')?.config.maxOccupancy ?? 16
    const targetC = this.segmentsMap.get('C1')?.config.maxOccupancy ?? 16
    const targetD = this.segmentsMap.get('D')?.config.maxOccupancy ?? 73

    const globalTargetCount = targetA + targetB + targetC + targetD
    const globalCurrentCount = occA + occB + occC + occD
    const transportInventory = occA1T + occB1T + occT
    const physicalPreKorberInventory = occA + occA1T + occB + occB1T + occC + occT + occD

    const purgeDemandA = occA - targetA + pendingBy.A
    const purgeDemandB = occB - targetB + pendingBy.B
    const purgeDemandC = occC - targetC + pendingBy.C

    const totalPending = pendingBy.A + pendingBy.B + pendingBy.C
    const additionalASRSDemand = Math.max(0, globalTargetCount - globalCurrentCount - totalPending)

    return {
      timeSec: this.timeSec,
      trays: this.trays.map((t) => ({ ...t })),
      segments,
      source: sourceState,
      sources,
      mergeState: { ...this.mergeState },
      missions: this.missions.map(m => ({ ...m })),
      korber: {
        lastConsumptionTime: this.korberLastConsumption === -Number.MAX_VALUE ? null : this.korberLastConsumption,
        totalConsumed: this.korberTotalConsumed,
        ready: true,
        starved: false,
      },
      pendingA: pendingBy.A,
      pendingB: pendingBy.B,
      pendingC: pendingBy.C,
      retrievingA,
      retrievingB,
      retrievingC,
      readyA,
      readyB,
      readyC,
      additionalASRSDemand,
      globalTargetCount,
      globalCurrentCount,
      transportInventory,
      physicalPreKorberInventory,
      purgeDemandA,
      purgeDemandB,
      purgeDemandC,
      asrsNextAssign: this.asrsNextAssign,
      asrsAssignedA: this.asrsAssignedA,
      asrsAssignedB: this.asrsAssignedB,
      asrsAssignedC: this.asrsAssignedC,
      segmentStats,
      movingCount,
      blockedCount,
      totalTraysCreated: this.totalTraysCreated,
      materialBalanceError,
      totalRouteDistance,
    }
  }
}

export default SimulationEngine
