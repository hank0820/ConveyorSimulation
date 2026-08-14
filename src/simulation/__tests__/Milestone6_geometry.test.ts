import { test, expect } from 'vitest'
import HybridAccumulationPile from '../HybridAccumulationPile'

test('A1/B1/C1 geometry sums to 81 ft and expected MDR counts', () => {
  const a1 = new HybridAccumulationPile({
    pileId: 'A1',
    totalLengthFt: 81,
    upstreamMdrCount: 8,
    downstreamMdrCount: 15,
    beltLengthFt: 23.5,
    mdrZoneLengthFt: 2.5,
    trayLengthFt: 2.0,
  })

  expect(a1.getMdrPositions()).toBe(23)
  expect(a1.getDesignPositions()).toBe(24)
  const totalA = a1.config.upstreamMdrCount * a1.config.mdrZoneLengthFt + a1.config.beltLengthFt + a1.config.downstreamMdrCount * a1.config.mdrZoneLengthFt
  expect(totalA).toBeCloseTo(81.0)

  const b1 = new HybridAccumulationPile({
    pileId: 'B1',
    totalLengthFt: 81,
    upstreamMdrCount: 8,
    downstreamMdrCount: 7,
    beltLengthFt: 43.5,
    mdrZoneLengthFt: 2.5,
    trayLengthFt: 2.0,
  })

  expect(b1.getMdrPositions()).toBe(15)
  expect(b1.getDesignPositions()).toBe(16)
  const totalB = b1.config.upstreamMdrCount * b1.config.mdrZoneLengthFt + b1.config.beltLengthFt + b1.config.downstreamMdrCount * b1.config.mdrZoneLengthFt
  expect(totalB).toBeCloseTo(81.0)

  const c1 = new HybridAccumulationPile({
    pileId: 'C1',
    totalLengthFt: 81,
    upstreamMdrCount: 8,
    downstreamMdrCount: 7,
    beltLengthFt: 43.5,
    mdrZoneLengthFt: 2.5,
    trayLengthFt: 2.0,
  })
  expect(c1.getMdrPositions()).toBe(15)
  const totalC = c1.config.upstreamMdrCount * c1.config.mdrZoneLengthFt + c1.config.beltLengthFt + c1.config.downstreamMdrCount * c1.config.mdrZoneLengthFt
  expect(totalC).toBeCloseTo(81.0)
})
