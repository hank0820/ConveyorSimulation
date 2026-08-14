# Conveyor Simulation

A deterministic React and TypeScript simulation of a three-branch conveyor system. The application models ASRS retrieval missions, exchanger induction, hybrid accumulation piles, strict round-robin merge arbitration, downstream accumulation, and Körber consumption.

## Current status

Milestone 6A stabilizes the existing Milestone 6 model. It adds deterministic validation for tray identity, physical placement, pile spacing, material balance, merge fairness, and SVG rendering integrity. It does not add new conveyor topology.

## Implemented topology

The browser application uses these configured segments:

- A1 → A1T → T → D
- B1 → B1T → T → D
- C1 → T → D

All configured conveyors run at 120 ft/min, or 2 ft/s. The simulation advances internally in deterministic 0.1-second ticks regardless of the UI playback multiplier.

### Hybrid accumulation piles

A1, B1, and C1 are hybrid piles containing discrete MDR zones and a continuous middle belt. MDR zones allow one tray each. A stopped tray is centered in its zone, and a downstream vacancy propagates upstream one zone at a time.

| Pile | Upstream MDR | Belt | Downstream MDR | Nominal positions |
| --- | ---: | ---: | ---: | ---: |
| A1 | 8 × 2.5 ft | 23.5 ft | 15 × 2.5 ft | 24 |
| B1 | 8 × 2.5 ft | 43.5 ft | 7 × 2.5 ft | 16 |
| C1 | 8 × 2.5 ft | 43.5 ft | 7 × 2.5 ft | 16 |

Each pile is 81 ft long. Trays are 2 ft long. Initialized trays and exchanger-created trays use the same authoritative pile-placement representation and movement rules.

D remains on the legacy accumulation model and is initialized with 73 trays.

## Control behavior

### ASRS and exchangers

Consumption creates replenishment demand. ASRS missions are assigned across A, B, and C, take 180 simulated seconds to retrieve, and then wait at their assigned exchanger. An exchanger enforces an eight-second release headway and may induct a tray only when upstream MDR zone 0 is physically free.

Pile exits require positive purge demand. Internal vacancy propagation does not require separate purge authorization.

### Merge arbitration

Eligible A, B, and C feeders use strict round-robin arbitration. The cursor starts at A, advances only after a successful transfer, skips ineligible branches, and allows a skipped branch to re-enter when the cursor next reaches it. Reset restores the cursor to A.

### Körber consumption

Körber removes the downstream-most available tray from D at 1,050 trays/hour. Successful removal increments the consumed-tray count and drives replenishment demand.

## Accounting and physical invariants

The engine reports:

- `createdTrayCount`: initial inventory plus trays introduced at runtime;
- `physicalTrayCount`: trays currently present in the conveyor system;
- `consumedTrayCount`: trays successfully removed by Körber.

Material balance is:

```text
materialBalanceError = createdTrayCount - physicalTrayCount - consumedTrayCount
```

Normal operation enforces:

```text
createdTrayCount = physicalTrayCount + consumedTrayCount
```

Automated invariants also require:

- globally unique tray IDs;
- one tray ID in one physical location;
- valid segment and pile-region boundaries;
- no overlap within hybrid piles;
- downstream blocking propagating upstream;
- initialized and runtime-created trays following the same pile rules;
- immutable state snapshots for rendering.

## User interface

The application provides:

- play and pause;
- a one-second manual step;
- reset;
- 1×, 5×, 20×, and 100× playback;
- source, merge, occupancy, movement, and material-balance diagnostics;
- a schematic SVG view of exchangers, hybrid piles, transport conveyors, and trays.

## Development

Requirements: Node.js and npm.

```bash
npm install
npm run dev
npm test -- --run
npm run lint
npm run build
```

`npm run build` runs TypeScript project compilation before producing the Vite production bundle. A standalone type-check can be run with:

```bash
npx tsc -b
```

The current suite contains 42 deterministic tests across engine and SVG-rendering behavior.

## Known limitations

- D remains on the legacy accumulation model.
- Topology and most physical/control parameters remain substantially hard-coded.
- Browser-level interactive control behavior is source-audited and manually inspectable but is not DOM-tested.
- The visualization is schematic and is not derived from CAD geometry.
- Full piles produce dense tray-number labels.
- No bypass-lane expansion is implemented.

## Next planned milestone

The next milestone should be scoped after the Milestone 6A baseline is accepted. Likely work includes deciding whether D should adopt the hybrid model and adding browser-level interaction coverage; neither is implemented in the current baseline.
