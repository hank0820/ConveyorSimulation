import type { Tray, ConveyorSegmentConfig, SimulationStateWithProgress, SourceConfig, SourceId, MergeState, OperatingSettings, SourceReleaseQuantities, SourceState, SrsTargets, TPurgeSettings } from './types'
import ConveyorSegment from './ConveyorSegment'
import HybridAccumulationPile from './HybridAccumulationPile'
import Milestone7Simulation from './Milestone7Simulation'

const INTERNAL_TICK_SECONDS = 0.1
const EPS = 1e-9
const DEFAULT_SOURCE_CONFIGS: SourceConfig[] = [
  { id: 'A', firstSegmentId: 'A1', initialOffsetSec: 0 },
  { id: 'B', firstSegmentId: 'B1', initialOffsetSec: 2 },
  { id: 'C', firstSegmentId: 'C1', initialOffsetSec: 4 },
]

export class SimulationEngine {
  private milestone7?: Milestone7Simulation
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
  // hybrid pile models for A1/B1/C1
  private piles: Map<string, HybridAccumulationPile> = new Map()
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
    // physical tray length and MDR zone length for Milestone 6
    const trayLengthFt = 2.0
    const mdrZoneLengthFt = 2.5
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

    // create hybrid piles for A1/B1/C1 when present
    if (this.segmentsMap.has('A1')) {
      this.piles.set('A1', new HybridAccumulationPile({
        pileId: 'A1',
        totalLengthFt: 103.5,
        preDetrayerMdrCount: 5,
        postDetrayerMdrCount: 5,
        downstreamMdrCount: 15,
        beltLengthFt: 41,
        mdrZoneLengthFt,
        trayLengthFt,
      }))
    }
    if (this.segmentsMap.has('B1')) {
      this.piles.set('B1', new HybridAccumulationPile({
        pileId: 'B1',
        totalLengthFt: 86,
        preDetrayerMdrCount: 5,
        postDetrayerMdrCount: 5,
        downstreamMdrCount: 8,
        beltLengthFt: 41,
        mdrZoneLengthFt,
        trayLengthFt,
      }))
    }
    if (this.segmentsMap.has('C1')) {
      this.piles.set('C1', new HybridAccumulationPile({
        pileId: 'C1',
        totalLengthFt: 86,
        preDetrayerMdrCount: 5,
        postDetrayerMdrCount: 5,
        downstreamMdrCount: 8,
        beltLengthFt: 41,
        mdrZoneLengthFt,
        trayLengthFt,
      }))
    }

    if (this.segmentsMap.has('PRE_T')) {
      const required = ['A1', 'B1', 'C1', 'PRE_T', 'T', 'D']
      if (!required.every((id) => this.segmentsMap.has(id))) throw new Error('Milestone 7 topology requires A1, B1, C1, PRE_T, T, and D')
      this.milestone7 = new Milestone7Simulation(segmentConfigs)
    } else {
      this.tryInjectSources()
      this.reset()
      if (this.useLegacySources) this.processLegacySources()
    }
  }

  step(seconds: number) {
    if (this.milestone7) {
      this.milestone7.step(seconds)
      return
    }
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

  setOperatingSetting(setting: keyof OperatingSettings, enabled: boolean) {
    this.milestone7?.setOperatingSetting(setting, enabled)
  }

  getOperatingSettings(): OperatingSettings {
    return this.milestone7?.getOperatingSettings() ?? { korberEnabled: true, cartbuildAEnabled: true, cartbuildBEnabled: true, cartbuildCEnabled: true }
  }

  setPendingDemandPlanningCadence(seconds: number) {
    if (this.milestone7) this.milestone7.setPendingDemandPlanningCadence(seconds)
    else if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('PendingDemand planning cadence must be a positive finite number')
  }

  startScenario(settings: OperatingSettings, planningCadenceSec: number, targets?: SrsTargets, sourceReleaseQuantities?: SourceReleaseQuantities, tPurgeSettings?: TPurgeSettings) {
    if (!this.milestone7) throw new Error('Scenario startup requires the Milestone 7+ topology')
    this.milestone7.startScenario(settings, planningCadenceSec, targets, sourceReleaseQuantities, tPurgeSettings)
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

    // process hybrid pile internal physics first when hybrid mode is active
    if (!this.useLegacySources) this.processPilesTick(deltaSec)

    // only move trays that are NOT managed by hybrid piles using generic segment movement
    const traysOrder = this.trays
      .filter((t) => !t.pilePlacement)
      .slice()
      .sort((a, b) => {
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

  // Handle per-pile runtime: discrete MDR zone transfers, belt motion, and downstream exits
  private processPilesTick(deltaSec: number) {
    if (this.useLegacySources) return
    for (const [pileId, pile] of this.piles.entries()) {
      const cfg = pile.config
      const speedFtPerSec = (this.segmentsMap.get(pileId)?.config.speedFtPerMin ?? 120) / 60
      const transferTime = cfg.mdrZoneLengthFt / speedFtPerSec

      // helpers to find trays in zones
      const preDetrayerZones: (Tray | null)[] = Array(cfg.preDetrayerMdrCount).fill(null)
      const postDetrayerZones: (Tray | null)[] = Array(cfg.postDetrayerMdrCount).fill(null)
      const downstreamZones: (Tray | null)[] = Array(cfg.downstreamMdrCount).fill(null)
      const beltTrays: Tray[] = []
      const refreshOccupancy = () => {
        preDetrayerZones.fill(null)
        postDetrayerZones.fill(null)
        downstreamZones.fill(null)
        beltTrays.length = 0
        for (const t of this.trays) {
          if (!t.pilePlacement || t.pilePlacement.pileId !== pileId) continue
          if (t.pilePlacement.component === 'MDR_PRE_DETRAYER') {
            preDetrayerZones[t.pilePlacement.zoneIndex ?? 0] = t
          } else if (t.pilePlacement.component === 'MDR_POST_DETRAYER') {
            postDetrayerZones[t.pilePlacement.zoneIndex ?? 0] = t
          } else if (t.pilePlacement.component === 'MDR_DOWNSTREAM') {
            downstreamZones[t.pilePlacement.zoneIndex ?? 0] = t
          } else if (t.pilePlacement.component === 'BELT') {
            beltTrays.push(t)
          }
        }
      }
      refreshOccupancy()

      // 1) attempt downstream exit: final downstream zone -> next segment
      const finalIdx = cfg.downstreamMdrCount - 1
      const finalTray = downstreamZones[finalIdx]
      if (finalTray) {
        const nextSeg = this.segmentsMap.get(pileId)?.config.nextSegmentId
        if (nextSeg) {
          // tryTransferToNextSegment will enforce PurgeDemand and allowedEntryDistance
          this.tryTransferToNextSegment(finalTray, pileId, nextSeg, 0)
          // if transfer succeeded, tryTransferToNextSegment will have cleared pilePlacement
        }
      }

      // 2) process in-progress transfers: decrement timers and complete zone moves
      for (const t of this.trays) {
        if (!t.pilePlacement) continue
        if (t.pilePlacement.pileId !== pileId) continue
        if (t.pileRuntime && t.pileRuntime.transferRemainingSec !== undefined && t.pileRuntime.transferRemainingSec > 0) {
          t.pileRuntime.transferRemainingSec = Math.max(0, t.pileRuntime.transferRemainingSec - deltaSec)
          if (t.pileRuntime.transferRemainingSec === 0) {
            // finalize movement: move to next zone or onto belt
            if (t.pilePlacement.component === 'MDR_PRE_DETRAYER') {
              const zi = t.pilePlacement.zoneIndex ?? 0
              if (zi + 1 < cfg.preDetrayerMdrCount) {
                t.pilePlacement.zoneIndex = zi + 1
              } else {
                t.pilePlacement.component = 'MDR_POST_DETRAYER'
                t.pilePlacement.zoneIndex = 0
              }
            } else if (t.pilePlacement.component === 'MDR_POST_DETRAYER') {
              const zi = t.pilePlacement.zoneIndex ?? 0
              if (zi + 1 < cfg.postDetrayerMdrCount) t.pilePlacement.zoneIndex = zi + 1
              else t.pilePlacement = { pileId, component: 'BELT', beltPosFt: cfg.trayLengthFt / 2 }
            } else if (t.pilePlacement.component === 'MDR_DOWNSTREAM') {
              const zi = t.pilePlacement.zoneIndex ?? 0
              if (zi + 1 < cfg.downstreamMdrCount) {
                t.pilePlacement.zoneIndex = zi + 1
              } else {
                // already at final downstream; do nothing here (exit handled above)
              }
            }
            t.pileRuntime = undefined
          }
        }
      }
      // Transfer completion changes authoritative zone placement. Rebuild the
      // occupancy snapshot before deciding which destinations are available.
      refreshOccupancy()

      // 3) start new downstream cascades (downstream zones move toward final)
      for (let i = cfg.downstreamMdrCount - 2; i >= 0; i--) {
        const src = downstreamZones[i]
        const dst = downstreamZones[i + 1]
        if (src && !dst && !(src.pileRuntime && src.pileRuntime.transferRemainingSec && src.pileRuntime.transferRemainingSec > 0)) {
          // start transfer from src -> dst
          src.pileRuntime = { transferring: true, transferRemainingSec: transferTime }
        }
      }

      // 4) belt -> downstream transfer: if downstreamZones[0] free and any belt tray at downstream end
      const downstream0 = downstreamZones[0]
      if (!downstream0 && beltTrays.length > 0) {
        // find belt tray closest to downstream end
        beltTrays.sort((a, b) => (b.pilePlacement!.beltPosFt ?? 0) - (a.pilePlacement!.beltPosFt ?? 0))
        const front = beltTrays[0]
        const frontPos = front.pilePlacement!.beltPosFt ?? 0
        // if front sufficiently at downstream end, move into downstream zone 0
        if (frontPos >= cfg.beltLengthFt - cfg.trayLengthFt - 1e-6) {
          // remove belt placement, set downstream placement
          front.pilePlacement = { pileId, component: 'MDR_DOWNSTREAM', zoneIndex: 0 }
          front.pileRuntime = undefined
          beltTrays.splice(beltTrays.indexOf(front), 1)
        }
      }

      // 5) post-detrayer -> belt transfer: entry shares the belt discharge interlock
      const postDetrayerLastIdx = cfg.postDetrayerMdrCount - 1
      const postLast = postDetrayerZones[postDetrayerLastIdx]
      const beltEntranceCenter = cfg.trayLengthFt / 2
      const nearestBeltTray = beltTrays.length === 0
        ? Infinity
        : Math.min(...beltTrays.map((bt) => bt.pilePlacement!.beltPosFt ?? 0))
      const beltHasSpace = nearestBeltTray - beltEntranceCenter >= cfg.trayLengthFt - EPS
      if (!downstream0 && postLast && beltHasSpace && !(postLast.pileRuntime && postLast.pileRuntime.transferRemainingSec && postLast.pileRuntime.transferRemainingSec > 0)) {
        postLast.pileRuntime = { transferring: true, transferRemainingSec: transferTime }
      }

      for (let i = cfg.postDetrayerMdrCount - 2; i >= 0; i--) {
        const src = postDetrayerZones[i]
        const dst = postDetrayerZones[i + 1]
        if (src && !dst && !(src.pileRuntime && src.pileRuntime.transferRemainingSec && src.pileRuntime.transferRemainingSec > 0)) {
          src.pileRuntime = { transferring: true, transferRemainingSec: transferTime }
        }
      }
      const preLast = preDetrayerZones[cfg.preDetrayerMdrCount - 1]
      if (preLast && !postDetrayerZones[0] && !(preLast.pileRuntime && preLast.pileRuntime.transferRemainingSec && preLast.pileRuntime.transferRemainingSec > 0)) {
        preLast.pileRuntime = { transferring: true, transferRemainingSec: transferTime }
      }
      for (let i = cfg.preDetrayerMdrCount - 2; i >= 0; i--) {
        const src = preDetrayerZones[i]
        const dst = preDetrayerZones[i + 1]
        if (src && !dst && !(src.pileRuntime && src.pileRuntime.transferRemainingSec && src.pileRuntime.transferRemainingSec > 0)) {
          src.pileRuntime = { transferring: true, transferRemainingSec: transferTime }
        }
      }

      // 6) belt motion: advance belt trays if beltRunning; enforce spacing and stop if blocked by downstream fullness
      const pendingBy = this.countPendingByBranch()
      const occDown = downstreamZones.filter(z => z !== null).length
      const purgeDemand = (this.trays.filter((t) => t.currentSegmentId === pileId).length) - (this.segmentsMap.get(pileId)?.config.maxOccupancy ?? 0) + pendingBy[(pileId[0] as SourceId)]
      const beltRunning = downstream0 === null && !(occDown >= cfg.downstreamMdrCount && purgeDemand <= 0)
      if (beltTrays.length > 0 && beltRunning) {
        const speed = speedFtPerSec
        // sort ascending from upstream to downstream
        beltTrays.sort((a, b) => (a.pilePlacement!.beltPosFt ?? 0) - (b.pilePlacement!.beltPosFt ?? 0))
        for (let i = 0; i < beltTrays.length; i++) {
          const bt = beltTrays[i]
          const prevPos = bt.pilePlacement!.beltPosFt ?? 0
          let desired = prevPos + speed * deltaSec
          // enforce not passing downstream end
          desired = Math.min(desired, cfg.beltLengthFt - cfg.trayLengthFt / 2)
          // enforce spacing with next downstream tray
          if (i < beltTrays.length - 1) {
            const next = beltTrays[i + 1]
            const nextPos = next.pilePlacement!.beltPosFt ?? 0
            desired = Math.min(desired, nextPos - cfg.trayLengthFt)
          }
          bt.pilePlacement!.beltPosFt = Math.max(beltEntranceCenter, desired)
        }
      }
    }
  }

  private findDownstreamNeighborOnSameSegment(tray: Tray): Tray | undefined {
    const same = this.trays.filter((t) => t.currentSegmentId === tray.currentSegmentId && t.id !== tray.id && !t.pilePlacement)
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
    // if creating directly into a hybrid pile and hybrid mode active, represent it as a pile-placed tray occupying upstream zone 0
    if (!this.useLegacySources && this.piles.has(segmentId)) {
      tray.pilePlacement = { pileId: segmentId, component: 'MDR_PRE_DETRAYER', zoneIndex: 0 }
      tray.status = 'BLOCKED'
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
    const occD = this.trays.filter((t) => t.currentSegmentId === 'D').length
    const currentCount = occA + occB + occC + occD
    const targetA = this.segmentsMap.get('A1')?.config.maxOccupancy ?? 24
    const targetB = this.segmentsMap.get('B1')?.config.maxOccupancy ?? 16
    const targetC = this.segmentsMap.get('C1')?.config.maxOccupancy ?? 16
    const targetD = this.segmentsMap.get('D')?.config.maxOccupancy ?? 92
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
        missionType: 'EMPTY' as const,
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

    // Physical merge arbitration is strict round-robin from the cursor.
    this.mergeState.selectedSource = 'NONE'
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
    // If transferring from a hybrid pile final downstream MDR to its transport
    // endpoint, require a positive PurgeDemand for that pile (authorization).
    // Map pileId -> branch letter
    const pileToBranch: Record<string, SourceId> = { A1: 'A', B1: 'B', C1: 'C' }
    if (this.piles.has(currentSegmentId) && (nextId === 'A1T' || nextId === 'B1T' || nextId === 'T')) {
      const branch = pileToBranch[currentSegmentId as keyof typeof pileToBranch]
      // compute current occupancy for the pile
      const occ = this.trays.filter((tr) => tr.currentSegmentId === currentSegmentId).length
      const target = this.segmentsMap.get(currentSegmentId)?.config.maxOccupancy ?? 0
      const pending = this.countPendingByBranch()[branch]
      const purgeDemand = occ - target + pending
      if (purgeDemand <= 0) return false
    }
    const allowedIntoNext = this.allowedEntryDistance(nextId)
    if (allowedIntoNext <= EPS) return false
    if (this.piles.has(nextId)) {
      if (!this.canEnterSegment(nextId, 0)) return false
      const pile = this.piles.get(nextId)!
      t.currentSegmentId = nextId
      t.positionFt = pile.config.mdrZoneLengthFt / 2
      t.pilePlacement = { pileId: nextId, component: 'MDR_PRE_DETRAYER', zoneIndex: 0 }
      t.pileRuntime = undefined
      t.status = 'BLOCKED'
      return true
    }
    t.currentSegmentId = nextId
    const enterDist = Math.min(distance, allowedIntoNext)
    t.positionFt = enterDist
    // when leaving a hybrid pile, clear pilePlacement/runtime so generic segment movement applies
    if (this.piles.has(currentSegmentId)) {
      t.pilePlacement = undefined
      t.pileRuntime = undefined
      t.status = 'MOVING'
    }
    return true
  }

  private allowedEntryDistance(segmentId: string): number {
    const segCfg = this.segmentsMap.get(segmentId)?.config
    if (!segCfg) return 0
    if (this.piles.has(segmentId)) {
      const pile = this.piles.get(segmentId)!
      const cfg = pile.config
      const physicalPositions = this.trays
        .filter((t) => t.currentSegmentId === segmentId)
        .map((t) => {
          const placement = t.pilePlacement
          if (!placement) return t.positionFt
          if (placement.component === 'MDR_PRE_DETRAYER') {
            return ((placement.zoneIndex ?? 0) + 0.5) * cfg.mdrZoneLengthFt
          }
          if (placement.component === 'MDR_POST_DETRAYER') {
            return (cfg.preDetrayerMdrCount + (placement.zoneIndex ?? 0) + 0.5) * cfg.mdrZoneLengthFt
          }
          if (placement.component === 'BELT') {
            return (cfg.preDetrayerMdrCount + cfg.postDetrayerMdrCount) * cfg.mdrZoneLengthFt + (placement.beltPosFt ?? 0)
          }
          return (cfg.preDetrayerMdrCount + cfg.postDetrayerMdrCount) * cfg.mdrZoneLengthFt
            + cfg.beltLengthFt
            + ((placement.zoneIndex ?? 0) + 0.5) * cfg.mdrZoneLengthFt
        })
      if (physicalPositions.length === 0) return segCfg.lengthFt
      const nearestTrayAhead = Math.min(...physicalPositions)
      return Math.max(0, Math.min(segCfg.lengthFt, nearestTrayAhead - this.trayPitchFt))
    }
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
    // for hybrid piles, entering means the first upstream MDR zone must accept the tray
    if (this.piles.has(segmentId)) {
      // check whether upstream MDR zone 0 is free (no tray occupying zoneIndex 0)
      const occupied = this.trays.some((t) => t.pilePlacement && t.pilePlacement.pileId === segmentId && t.pilePlacement.component === 'MDR_PRE_DETRAYER' && t.pilePlacement.zoneIndex === 0)
      return !occupied
    }
    const traysOn = this.trays.filter((t) => t.currentSegmentId === segmentId)
    const occupancy = traysOn.length
    if (segCfg.maxOccupancy !== undefined && occupancy >= segCfg.maxOccupancy) return false
    if (traysOn.length === 0) return true
    const nearest = traysOn.reduce((min, t) => (t.positionFt < min.positionFt ? t : min), traysOn[0])
    return nearest.positionFt - this.trayPitchFt >= desiredEntryDist - EPS
  }

  reset() {
    if (this.milestone7) {
      this.milestone7.reset()
      return
    }
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
    // Legacy Milestone 6 topology retains its original D reset inventory.
    if (this.segmentsMap.has('A1') && this.segmentsMap.has('B1') && this.segmentsMap.has('C1') && this.segmentsMap.has('D')) {
      // populate new hybrid piles for A1/B1/C1 using HybridAccumulationPile
      const startId = this.totalTraysCreated + 1
      let nextId = startId
      const pA = this.piles.get('A1')
      if (pA) {
        const res = pA.initialTrays(nextId, 'A', 24)
        this.trays.push(...res.trays)
        nextId = res.nextId
      } else {
        this.populateInitialPile('A1', 24, 'A')
      }

      const pB = this.piles.get('B1')
      if (pB) {
        const res = pB.initialTrays(nextId, 'B', 16)
        this.trays.push(...res.trays)
        nextId = res.nextId
      } else {
        this.populateInitialPile('B1', 16, 'B')
      }

      const pC = this.piles.get('C1')
      if (pC) {
        const res = pC.initialTrays(nextId, 'C', 16)
        this.trays.push(...res.trays)
        nextId = res.nextId
      } else {
        this.populateInitialPile('C1', 16, 'C')
      }

      // Register hybrid-pile IDs before legacy D creates trays through createTrayAt.
      this.totalTraysCreated = nextId - 1

      // D remains legacy
      this.populateInitialPile('D', 73, 'A')
    }
  }

  getState(): SimulationStateWithProgress {
    if (this.milestone7) return this.milestone7.getState()
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
    const createdTrayCount = this.totalTraysCreated
    const physicalTrayCount = this.trays.length
    const consumedTrayCount = this.korberTotalConsumed
    const materialBalanceError = createdTrayCount - physicalTrayCount - consumedTrayCount
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

    // pile diagnostics (Milestone 6)
    const preDetrayerMdrA = this.trays.filter((t) => t.pilePlacement && t.pilePlacement.pileId === 'A1' && t.pilePlacement.component === 'MDR_PRE_DETRAYER').length
    const postDetrayerMdrA = this.trays.filter((t) => t.pilePlacement && t.pilePlacement.pileId === 'A1' && t.pilePlacement.component === 'MDR_POST_DETRAYER').length
    const downstreamMdrA = this.trays.filter((t) => t.pilePlacement && t.pilePlacement.pileId === 'A1' && t.pilePlacement.component === 'MDR_DOWNSTREAM').length
    const beltCountA = this.trays.filter((t) => t.pilePlacement && t.pilePlacement.pileId === 'A1' && t.pilePlacement.component === 'BELT').length
    const preDetrayerMdrB = this.trays.filter((t) => t.pilePlacement && t.pilePlacement.pileId === 'B1' && t.pilePlacement.component === 'MDR_PRE_DETRAYER').length
    const postDetrayerMdrB = this.trays.filter((t) => t.pilePlacement && t.pilePlacement.pileId === 'B1' && t.pilePlacement.component === 'MDR_POST_DETRAYER').length
    const downstreamMdrB = this.trays.filter((t) => t.pilePlacement && t.pilePlacement.pileId === 'B1' && t.pilePlacement.component === 'MDR_DOWNSTREAM').length
    const beltCountB = this.trays.filter((t) => t.pilePlacement && t.pilePlacement.pileId === 'B1' && t.pilePlacement.component === 'BELT').length
    const preDetrayerMdrC = this.trays.filter((t) => t.pilePlacement && t.pilePlacement.pileId === 'C1' && t.pilePlacement.component === 'MDR_PRE_DETRAYER').length
    const postDetrayerMdrC = this.trays.filter((t) => t.pilePlacement && t.pilePlacement.pileId === 'C1' && t.pilePlacement.component === 'MDR_POST_DETRAYER').length
    const downstreamMdrC = this.trays.filter((t) => t.pilePlacement && t.pilePlacement.pileId === 'C1' && t.pilePlacement.component === 'MDR_DOWNSTREAM').length
    const beltCountC = this.trays.filter((t) => t.pilePlacement && t.pilePlacement.pileId === 'C1' && t.pilePlacement.component === 'BELT').length

    const beltRunningA = !(downstreamMdrA >= (this.piles.get('A1')?.config.downstreamMdrCount ?? 0) && purgeDemandA <= 0)
    const beltRunningB = !(downstreamMdrB >= (this.piles.get('B1')?.config.downstreamMdrCount ?? 0) && purgeDemandB <= 0)
    const beltRunningC = !(downstreamMdrC >= (this.piles.get('C1')?.config.downstreamMdrCount ?? 0) && purgeDemandC <= 0)

    const pileAuthorizedExitA = purgeDemandA > 0
    const pileAuthorizedExitB = purgeDemandB > 0
    const pileAuthorizedExitC = purgeDemandC > 0

    return {
      timeSec: this.timeSec,
      trays: this.trays.map((t) => ({
        ...t,
        pilePlacement: t.pilePlacement ? { ...t.pilePlacement } : undefined,
        pileRuntime: t.pileRuntime ? { ...t.pileRuntime } : undefined,
      })),
      segments,
      source: sourceState,
      sources,
      mergeState: { ...this.mergeState },
      missions: this.missions.map(m => ({ ...m })),
      asrsRobotSystem: {
        outboundRobots: [], maturedQueues: { A: [], B: [], C: [] }, robotCarriedTrayCount: 0, completedOutboundCycles: [], completedCycles: [],
        inboundReservations: [], inboundOnlyRobots: [], returningRobots: [], cancelledInboundOnlyRobots: [],
        completedCountByClassification: { OUTBOUND_ONLY: 0, INBOUND_ONLY: 0, DUAL_CYCLE: 0, CANCELLED_INBOUND_ONLY: 0 }, dualCyclePercentage: 0,
        exchangers: Object.fromEntries((['A', 'B', 'C'] as SourceId[]).map((source) => [source, { source, dropRobotId: null, shiftingOrTakeRobotId: null, dropBlocked: false, dropBlockedReason: null, dropBlockedDurationSec: 0, lastSuccessfulDropTime: null, nextEligibleCycleAdmissionTime: 0, queue: [], queueLength: 0, maximumObservedQueueLength: 0, queueAdvancementState: 'IDLE', queueAdvanceProgress: 0, successfulOutboundOnlyCycleCount: 0, currentQueueDepth: 0, completedCountByClassification: { OUTBOUND_ONLY: 0, INBOUND_ONLY: 0, DUAL_CYCLE: 0, CANCELLED_INBOUND_ONLY: 0 }, dualCyclePercentage: 0 }])) as unknown as SimulationStateWithProgress['asrsRobotSystem']['exchangers'],
      },
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
      createdTrayCount,
      physicalTrayCount,
      consumedTrayCount,
      materialBalanceError,
      preDetrayerMdrA,
      postDetrayerMdrA,
      beltCountA,
      downstreamMdrA,
      beltRunningA,
      preDetrayerMdrB,
      postDetrayerMdrB,
      beltCountB,
      downstreamMdrB,
      beltRunningB,
      preDetrayerMdrC,
      postDetrayerMdrC,
      beltCountC,
      downstreamMdrC,
      beltRunningC,
      pileAuthorizedExitA,
      pileAuthorizedExitB,
      pileAuthorizedExitC,
      beltDiagnostics: [],
      operatingSettings: this.getOperatingSettings(),
      cartbuildSystem: {
        enabled: false,
        settings: this.getOperatingSettings(),
        lanes: {
          CARTBUILD_A: { id: 'CARTBUILD_A', enabled: false, positionCapacity: 30, pendingMissionReservations: 0, attachedTrayReservations: 0, physicalLaneOccupancy: 0, committedPositions: 0, availablePositions: 30, lengthFt: 75, zoneCount: 30, speedFtPerMin: 120, zoneTransferSec: 1.25, markers: [], occupancy: 0, introducedCount: 0, operatorConsumedCount: 0, operatorConsumptionTimes: [], finalZoneOccupied: false, nextEligibleConsumptionTime: 0, lastConsumedTime: null, configuredRatePerHour: 450 },
          CARTBUILD_B: { id: 'CARTBUILD_B', enabled: false, positionCapacity: 30, pendingMissionReservations: 0, attachedTrayReservations: 0, physicalLaneOccupancy: 0, committedPositions: 0, availablePositions: 30, lengthFt: 75, zoneCount: 30, speedFtPerMin: 120, zoneTransferSec: 1.25, markers: [], occupancy: 0, introducedCount: 0, operatorConsumedCount: 0, operatorConsumptionTimes: [], finalZoneOccupied: false, nextEligibleConsumptionTime: 0, lastConsumedTime: null, configuredRatePerHour: 450 },
          CARTBUILD_C: { id: 'CARTBUILD_C', enabled: false, positionCapacity: 30, pendingMissionReservations: 0, attachedTrayReservations: 0, physicalLaneOccupancy: 0, committedPositions: 0, availablePositions: 30, lengthFt: 75, zoneCount: 30, speedFtPerMin: 120, zoneTransferSec: 1.25, markers: [], occupancy: 0, introducedCount: 0, operatorConsumedCount: 0, operatorConsumptionTimes: [], finalZoneOccupied: false, nextEligibleConsumptionTime: 0, lastConsumedTime: null, configuredRatePerHour: 450 },
        },
        exchangers: {
          A: { source: 'A', cartbuildEnabled: false, lastActualReleaseTime: null, nextEligibleReleaseTime: 0, loadedReleases: 0, emptyReleases: 0, blockedLoadedAttempts: 0, blockedEmptyAttempts: 0, pendingEmptyMissions: 0, mostRecentReleaseType: null, releaseTimes: [] },
          B: { source: 'B', cartbuildEnabled: false, lastActualReleaseTime: null, nextEligibleReleaseTime: 0, loadedReleases: 0, emptyReleases: 0, blockedLoadedAttempts: 0, blockedEmptyAttempts: 0, pendingEmptyMissions: 0, mostRecentReleaseType: null, releaseTimes: [] },
          C: { source: 'C', cartbuildEnabled: false, lastActualReleaseTime: null, nextEligibleReleaseTime: 0, loadedReleases: 0, emptyReleases: 0, blockedLoadedAttempts: 0, blockedEmptyAttempts: 0, pendingEmptyMissions: 0, mostRecentReleaseType: null, releaseTimes: [] },
        },
        detrayers: Object.fromEntries((['A', 'B', 'C'] as SourceId[]).map((source) => [source, { source, loadedTrayWaiting: false, trayId: null, postDetrayerZone0Available: true, cartonLaneZone0Available: true, splitCount: 0, blockedTicks: 0, blockedDurationSec: 0, mostRecentSplitTime: null }])) as SimulationStateWithProgress['cartbuildSystem']['detrayers'],
        cartbuildCartonsIntroduced: 0, cartbuildCartonsAttachedToTrays: 0, cartbuildCartonsOnConveyors: 0, cartbuildCartonsConsumedByOperators: 0, cartonBalanceError: 0,
      },
      srsControl: {
        targets: { A1: 24, B1: 16, C1: 16, T: 6, D: 73, A2: 36, B2: 29, C2: 29 },
        sourceReleaseQuantities: { A: 8, B: 8, C: 8 },
        tPurgeSettings: { backupTrigger: 6, purgeQuantity: 6 },
        current: { A1: occA, B1: occB, C1: occC, T: occT, D: occD, A2: 0, B2: 0, C2: 0 },
        globalTarget: 229, globalCurrent: occA + occB + occC + occT + occD,
        globalPending: pendingBy.A + pendingBy.B + pendingBy.C,
        globalAvailableCapacity: Math.max(0, 229 - occA - occB - occC - occT - occD - pendingBy.A - pendingBy.B - pendingBy.C),
        planningCadenceSec: 10, nextPlanningTime: 0, planningCursor: this.asrsNextAssign,
        lanes: Object.fromEntries((['A', 'B', 'C'] as SourceId[]).map((source) => [source, { source, activeReleaseQuantity: 8, targetSize: source === 'A' ? 24 : 16, currentCount: source === 'A' ? occA : source === 'B' ? occB : occC, pendingDemand: pendingBy[source], lanePurgeDemand: 0, localAvailable: 0, downstreamAvailable: 0, laneMissionCapacity: 0, pendingEmptyMissions: pendingBy[source], pendingCartbuildMissions: 0, maturedEmptyMissions: 0, maturedCartbuildMissions: 0, lastActualExchangerReleaseTime: null, nextEligibleExchangerReleaseTime: 0, activeSourceBatch: false, activeBatchConfiguredMaximum: 0, frozenSourceBatchQuantity: 0, sourceBatchReleasedCount: 0, sourceBatchRemainingCount: 0 }])) as SimulationStateWithProgress['srsControl']['lanes'],
        tBypassBatch: { active: false, consecutiveDownstreamBackupDepth: 0, dEntranceBlocked: false, triggerQualifies: false, authorizedTrayIds: [], enteredCount: 0, remainingCount: 0, sourceBatchPaused: false, pausedSource: null },
      },
      returnSystem: {
        enabled: false,
        korberProcessedCount: 0,
        korberHeldTrayId: null,
        returnedToAsrsCount: 0,
        returnedHistory: [],
        purgeTriggerReady: false,
        activePurgeBatch: null,
        lastCompletedPurgeBatch: null,
        sorterCursor: 'A2',
        sorterSelectedDestination: null,
        sorterAvailability: { A2: false, B2: false, C2: false },
        sorterBlockedReason: null,
        sHeadTrayDestination: null,
        assignments: { A2: { EMPTY: 0, FULL: 0 }, B2: { EMPTY: 0, FULL: 0 }, C2: { EMPTY: 0, FULL: 0 } },
        mergeCounts: { eToXFull: 0, purgeToXEmpty: 0, blockedE: 0, blockedPurge: 0 },
        exchangerAcceptanceTimes: { A2: [], B2: [], C2: [] },
        conveyorOccupancy: { PURGE: 0, E: 0, X: 0, S: 0, A2: 0, B2: 0, C2: 0 },
      },
      slugCursor: this.mergeState.nextPriority,
      activeSlug: null,
      lastCompletedSlug: null,
      dEntranceAvailable: false,
      dFinalZoneOccupied: false,
      korberNextConsumptionTime: 0,
      korberLastConsumedTrayId: null,
      zonedOccupancy: { PRE_T: 0, T: occT, D: occD },
      totalRouteDistance,
    }
  }
}

export default SimulationEngine
