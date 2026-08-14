# Conveyor Simulation

A deterministic React and TypeScript model of a three-source conveyor system with hybrid accumulation piles, authoritative zero-pressure MDR zones, ASRS replenishment, slug release control, and Körber consumption.

## Milestone 7 topology

- A1 and B1 merge onto one shared `PRE_T` conveyor.
- C1 bypasses `PRE_T` and enters `T` directly.
- `PRE_T` contains 8 physical 2.5-foot zones.
- `T` contains 12 physical 2.5-foot zones.
- `D` contains 94 physical 2.5-foot zones.
- All conveyors run at 120 ft/min; a zone transfer takes 1.25 seconds.

A1, B1, and C1 retain their hybrid MDR/belt/MDR accumulation geometry. `PRE_T`, `T`, and `D` use zone placement as authoritative engine state, with at most one tray in each semantic zone (`<conveyor>:MDR:<index>`).

Reset creates 24 A trays, 16 B trays, 16 C trays, an empty `PRE_T` and `T`, and 94 D trays. IDs are globally unique and deterministic.

## Control and accounting

The slug controller scans A → B → C from its independent cursor. It selects a full eight-tray lane first, otherwise a frozen partial lane. Only the active source owns its merge path; ASRS replacement trays cannot join an already authorized slug. Completion occurs when the final authorized tray enters T.

Körber consumes only D zone 93 at 1,050 trays/hour. Its first request waits one full interval. If the final zone is empty at demand time, Körber waits for the next arrival and then schedules a fresh full interval without accumulating missed demand.

Material balance is:

```text
createdTrayCount = physicalTrayCount + consumedTrayCount
materialBalanceError = createdTrayCount - physicalTrayCount - consumedTrayCount
```

## Development

```bash
npm install
npm run dev
npm test -- --run
npm run lint
npm run build
```

Standalone type-check:

```bash
npx tsc -b
```

## Known limitations

- The schematic is intentionally compact and is not CAD geometry.
- Topology and physical/control parameters remain configured in source.
- Browser interaction is manually validated; engine and server-rendered SVG behavior are covered deterministically.
- No bypass-lane or further topology expansion is included in Milestone 7.
