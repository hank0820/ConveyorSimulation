# Conveyor Simulation

A deterministic React and TypeScript model of a three-source conveyor system with hybrid accumulation piles, authoritative zero-pressure MDR zones, ASRS replenishment, slug release control, Körber processing, and downstream return conveyors.

## Milestone status

Milestone 8 is implemented and validated. It extends the published Milestone 7.1 outbound model with the physical return path from T/Körber to the A, B, and C exchanger take sides. The return-conveyor physics, control rules, accounting, diagnostics, and functional visualization are implemented. Dual-cycle robot coordination and returned-tray reintroduction are future work.

## Milestone 7 outbound topology

- A1 and B1 merge onto one shared `PRE_T` conveyor.
- C1 bypasses `PRE_T` and enters `T` directly.
- `PRE_T` contains 8 physical 2.5-foot zones.
- `T` contains 12 physical 2.5-foot zones.
- `D` contains 94 physical 2.5-foot zones.
- All conveyors run at 120 ft/min; a zone transfer takes 1.25 seconds.

A1, B1, and C1 retain their hybrid MDR/belt/MDR accumulation geometry. `PRE_T`, `T`, and `D` use zone placement as authoritative engine state, with at most one tray in each semantic zone (`<conveyor>:MDR:<index>`).

Reset creates 24 A trays, 16 B trays, 16 C trays, an empty `PRE_T` and `T`, and 94 D trays. IDs are globally unique and deterministic.

The slug controller scans A → B → C from its independent cursor. It selects a full eight-tray lane first, otherwise a frozen partial lane. Only the active source owns its merge path; ASRS replacement trays cannot join an already authorized slug. Completion occurs when the final authorized tray enters T.

## Milestone 8 return lifecycle

ASRS-released trays begin `EMPTY`. Körber processes only a tray physically occupying D zone 93, at 1,050 trays/hour. Processing preserves the tray ID and transforms its load state from `EMPTY` to `FULL`; it does not create or destroy a tray.

The completed `FULL` tray enters E when E zone 0 is available. If E is blocked, exactly one completed tray remains at the Körber discharge with an authoritative hold placement. While that tray is held, Körber cannot process another D tray. After the hold clears into E, Körber waits a complete processing interval and does not accumulate catch-up demand.

The return topology uses the same zero-pressure, one-tray-per-zone, residual-preserving 1.25-second MDR transfer model:

| Conveyor | Zones | Length | Purpose |
|---|---:|---:|---|
| `PURGE` | 6 | 15 ft | EMPTY diversion from T |
| `E` | 35 | 87.5 ft | FULL output from Körber |
| `X` | 5 | 12.5 ft | Shared EMPTY/FULL return path |
| `S` | 8 | 20 ft | Shared route to A2 and B2 |
| `A2` | 36 | 90 ft | A exchanger take side |
| `B2` | 29 | 72.5 ft | B exchanger take side |
| `C2` | 29 | 72.5 ft | Direct C exchanger take side |

### Purge controller

A purge batch is authorized only when all 12 T zones are occupied, D zone 0 is blocked, and no purge batch is active. Authorization freezes exactly the six downstream-most eligible `EMPTY` tray IDs in physical discharge order. Those six trays retain diversion ownership even if D reopens; later arrivals cannot join, no seventh tray can enter under the batch, and an authorized tray cannot enter D. The batch completes only after all six frozen IDs have physically entered `PURGE`.

### Return merge and sorter

E and PURGE merge into X. A physically ready `FULL` E tray has strict priority over a physically ready `EMPTY` PURGE tray. If E is not physically eligible, PURGE may proceed.

At the return sorter, an independent cursor cycles A2 → B2 → C2 → A2. It skips unavailable destinations and advances only after a successful physical transfer. The selected destination is frozen on the tray:

- C2-bound trays route directly from X to C2.
- A2- and B2-bound trays share S before entering their destination branch.
- The leading S tray controls discharge. If its destination is blocked, following trays cannot overtake it for the other branch.

Each A2, B2, and C2 final zone feeds an independent provisional exchanger sink at 450 trays/hour, with a minimum eight-second interval between acceptances. A starved exchanger accepts the next physically waiting final-zone tray immediately and does not accumulate missed capacity.

## Material accounting

Körber processing is a throughput event, not a material sink. A tray remains physical while moving from D to the Körber hold and from the hold into E. Only exchanger acceptance removes a tray from the conveyor collection and records it in returned-ASRS history.

```text
createdTrayCount = physicalTrayCount + returnedToAsrsCount
materialBalanceError = createdTrayCount - physicalTrayCount - returnedToAsrsCount
```

The same-ID `EMPTY` → `FULL` transformation changes neither created nor physical count. Purge and sorter routing also leave both sides of the equation unchanged.

## Validation and visualization

The current suite contains 63 deterministic tests covering the Milestone 7.1 regressions plus Milestone 8 topology, lifecycle, purge ownership, merge priority, sorter routing, exchanger timing, immutable snapshots, and long-running material/identity invariants.

The visualization displays the complete return topology and distinguishes `EMPTY`, `FULL`, Körber-held, purge-member, and A2/B2/C2-assigned trays through snapshot-driven semantic attributes and styling. It is functional and validated, but intentionally provisional pending a later front-end refinement pass.

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

## Implemented behavior versus future work

Implemented now:

- Authoritative outbound and return-conveyor physics
- Same-ID Körber transformation and blocked-discharge hold
- Frozen purge control, E-priority merge, return sorting, and exchanger sinks
- Returned-ASRS accounting, diagnostics, and functional visualization

Deferred:

- Dual-cycle robot coordination and robot availability
- Inbound/outbound mission pairing and exchanger synchronization
- Returned-tray reintroduction; a future milestone must use an explicit lifecycle transition rather than creating a duplicate tray ID
- Front-end polish, responsive layout refinement, and richer operator inspection tools

The schematic is intentionally compact and is not CAD geometry. Topology and physical/control parameters remain configured in source.
