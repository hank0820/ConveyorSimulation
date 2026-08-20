import { expect, test } from 'vitest'
import HybridAccumulationPile from '../HybridAccumulationPile'

const createPile = (pileId: 'A1' | 'B1' | 'C1', downstreamMdrCount: number, totalLengthFt: number) => new HybridAccumulationPile({
  pileId,
  totalLengthFt,
  preDetrayerMdrCount: 5,
  postDetrayerMdrCount: 5,
  downstreamMdrCount,
  beltLengthFt: 41,
  mdrZoneLengthFt: 2.5,
  trayLengthFt: 2,
})

test('A1/B1/C1 geometry exposes the Milestone 11A physical capacities', () => {
  const a1 = createPile('A1', 15, 103.5)
  expect(a1.getMdrPositions()).toBe(25)
  expect(a1.getBeltPositions()).toBe(20)
  expect(a1.getPhysicalCapacity()).toBe(45)
  expect(a1.getNominalBeltTraversalSec(120)).toBeCloseTo(20.5)

  for (const pileId of ['B1', 'C1'] as const) {
    const pile = createPile(pileId, 8, 86)
    expect(pile.getMdrPositions()).toBe(18)
    expect(pile.getBeltPositions()).toBe(20)
    expect(pile.getPhysicalCapacity()).toBe(38)
  }
})
