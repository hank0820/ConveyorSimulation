# Conveyor Simulation

A deterministic React and TypeScript model of a three-source conveyor system with hybrid accumulation piles, authoritative zero-pressure MDR zones, SRS-based ASRS replenishment, Körber processing, downstream return conveyors, and outbound cartbuild lanes.

## Milestone status

Milestone 9 is implemented and validated on top of the published Milestone 8A schematic UI. Its scope adds three physical cartbuild lanes, unified `EMPTY` and `CARTBUILD` ASRS missions, SRS `PendingDemand` and lane `PurgeDemand` control, selectable operating modes, clean scenario startup, detraying, carton movement, and independent operator sinks. The established Milestone 7 outbound and Milestone 8 return-conveyor physics remain in place.

Robot trips, dual-cycle exchanger coordination, returned-tray reintroduction, and deployment or scenario-sharing features are not implemented.

## Milestone 7 outbound topology

- A1 and B1 merge onto one shared `PRE_T` conveyor.
- C1 bypasses `PRE_T` and enters `T` directly.
- `PRE_T` contains 8 physical 2.5-foot zones.
- `T` contains 12 physical 2.5-foot zones.
- `D` contains 94 physical 2.5-foot zones.
- All conveyors run at 120 ft/min; a zone transfer takes 1.25 seconds.

A1, B1, and C1 retain their hybrid MDR/belt/MDR accumulation geometry. `PRE_T`, `T`, and `D` use zone placement as authoritative engine state, with at most one tray in each semantic zone (`<conveyor>:MDR:<index>`).

Reset creates 24 A trays, 16 B trays, 16 C trays, an empty `PRE_T` and `T`, and 94 D trays. IDs are globally unique and deterministic.

Source release is controlled by the Milestone 9 lane `PurgeDemand` priorities described below. Each authorization freezes a deterministic batch boundary; new exchanger arrivals cannot join an active batch, and completion occurs only when its final authorized tray enters T.

## Milestone 8 return lifecycle

ASRS-released `EMPTY` trays can flow through D to Körber. Körber processes only a tray physically occupying D zone 93, at 1,050 trays/hour. Processing preserves the tray ID and transforms its load state from `EMPTY` to `FULL`; it does not create or destroy a tray.

The completed `FULL` tray enters E when E zone 0 is available. If E is blocked, exactly one completed tray remains at the Körber discharge with an authoritative hold placement. While that tray is held, Körber cannot process another D tray. After the hold clears into E, Körber waits a complete processing interval and does not accumulate catch-up demand.

The return topology uses the same zero-pressure, one-tray-per-zone, residual-preserving 1.25-second MDR transfer model:

| Conveyor | Zones | Length | Purpose |
|---|---:|---:|---|
| `PURGE` | 6 | 15 ft | `EMPTY` diversion from T |
| `E` | 35 | 87.5 ft | `FULL` output from Körber |
| `X` | 5 | 12.5 ft | Shared `EMPTY`/`FULL` return path |
| `S` | 8 | 20 ft | Shared route to A2 and B2 |
| `A2` | 36 | 90 ft | A exchanger take side |
| `B2` | 29 | 72.5 ft | B exchanger take side |
| `C2` | 29 | 72.5 ft | Direct C exchanger take side |

### Return merge and sorter

E and PURGE merge into X. A physically ready `FULL` E tray has strict priority over a physically ready `EMPTY` PURGE tray. If E is not physically eligible, PURGE may proceed.

At the return sorter, an independent cursor cycles A2 → B2 → C2 → A2. It skips unavailable destinations and advances only after a successful physical transfer. The selected destination is frozen on the tray:

- C2-bound trays route directly from X to C2.
- A2- and B2-bound trays share S before entering their destination branch.
- The leading S tray controls discharge. If its destination is blocked, following trays cannot overtake it for the other branch.

Each A2, B2, and C2 final zone feeds an independent provisional exchanger sink at 450 trays/hour, with a minimum eight-second interval between acceptances. A starved exchanger accepts the next physically waiting final-zone tray immediately and does not accumulate missed capacity.

## Milestone 9 cartbuild topology

`CARTBUILD_A`, `CARTBUILD_B`, and `CARTBUILD_C` are independent 30-zone carton conveyors associated with the shared A, B, and C ASRS exchangers. Each exchanger has one combined outbound release clock for `EMPTY` and `CARTBUILD` tray missions. Actual combined releases are limited to 450 trays/hour per exchanger, or one physical entrance at least every eight simulated seconds.

Every ASRS mission has a 180-simulated-second retrieval time. At an eligible exchanger opportunity, the oldest matured `CARTBUILD` mission has priority. If that mission cannot physically enter but a matured `EMPTY` mission can, the `EMPTY` mission may use the opportunity. A failed attempt does not consume exchanger capacity.

A released `CARTBUILD` mission creates a loaded tray at upstream MDR zone 0 of A1, B1, or C1. The loaded tray travels through upstream zones 0, 1, and 2. Detraying occurs atomically between zones 2 and 3:

- The same tray ID enters zone 3 as `EMPTY`.
- Exactly one anonymous carton marker enters zone 0 of the corresponding cartbuild lane.
- The transfer waits until both destinations are available; no partial split occurs.

The empty tray continues through the existing hybrid pile and outbound conveyor system. The carton advances independently through its 30-zone lane. Each lane's operator consumes a carton from its final zone at a maximum rate of 450 cartons/hour, using an independent eight-second clock.

## Operating modes and scenario startup

The operations panel exposes four toggles:

- `KORBER`
- `CARTBUILD_A`
- `CARTBUILD_B`
- `CARTBUILD_C`

All four default to ON. Changing a toggle during a run pauses playback without resetting the engine, physical trays, cartons, missions, active source batch, T bypass, or timing clocks. The new value affects only future mission eligibility. Existing pending missions and in-flight material are not discarded: missions may still mature and release, while trays and cartons continue under the normal downstream physical constraints after their producer is turned OFF.

To start a clean operating scenario:

1. Select the four operating toggles.
2. Set the PendingDemand planning cadence in simulated seconds.
3. Select **Start Scenario**.
4. Confirm the new run is at time zero and remains paused.
5. Select **Play** to advance simulated time.

**Start Scenario** clears and recreates all simulation and material state, applies the selected settings before planning, and runs the immediate time-zero planning cycle exactly once. **Pause** preserves the current run. The normal **Reset** action instead restores all four toggles to ON, restores the default 10-second cadence, and produces the default 27/26/26 time-zero `CARTBUILD` allocation.

## SRS control model

The SRS controller uses eight logical `TargetSize` values:

| SRS pile | TargetSize |
|---|---:|
| A1 | 24 |
| B1 | 16 |
| C1 | 16 |
| T | 6 |
| D | 73 |
| A2 | 36 |
| B2 | 29 |
| C2 | 29 |
| **Total** | **229** |

These values are control targets only. They do not redefine physical conveyor zone counts, capacities, lengths, geometry, reset inventory, or visualization dimensions. For example, T remains a 12-zone physical conveyor and D remains a 94-zone physical conveyor.

`CurrentCount` counts authoritative physical trays in each of the eight SRS piles regardless of whether a tray is `EMPTY` or `FULL`. PRE_T, Körber-held trays, E, PURGE, X, S, and other non-SRS transport locations remain physical inventory but are not included in these eight SRS counts.

`PendingDemand` for A, B, or C counts every created mission for that exchanger until its tray physically enters upstream MDR zone 0 of A1, B1, or C1. A mission therefore remains pending while retrieving, after maturity while blocked, and while waiting for exchanger headway or higher-priority work.

Global reserved capacity is:

```text
max(0, sum(TargetSize) - sum(CurrentCount) - sum(PendingDemand))
```

Each lane also applies its positive local and downstream availability cap. Negative availability in one pile contributes zero and cannot cancel available space elsewhere.

Lane release pressure is calculated independently for A1, B1, and C1:

```text
lanePurgeDemand = CurrentCount - TargetSize + PendingDemand
```

Lane `PurgeDemand` is a signed control quantity and is not the physical six-tray T bypass batch.

The default planning cadence is 10 simulated seconds. Planning runs once immediately at time zero and then at 10, 20, 30 seconds, and so on. Starting from its independent cursor, the planner considers A → B → C cyclically, creates one eligible mission, advances the cursor only after successful creation, recalculates capacity, and repeats until no reservable capacity or eligible lane remains.

Mission type selection for an eligible lane is:

1. Create `CARTBUILD` when that lane's cartbuild toggle is ON.
2. Otherwise create `EMPTY` when `KORBER` is ON.
3. Otherwise skip the lane.

## Source-release control and T bypass

When no source batch is active, A1/B1/C1 source selection uses this priority:

1. Highest positive lane `PurgeDemand`.
2. A physically full lane when positive `PurgeDemand` does not decide.
3. The independent source round-robin cursor to resolve remaining ties.

Every source authorization freezes its membership and is capped at eight trays. With positive lane `PurgeDemand`, the frozen quantity is limited by that positive demand, eight trays, and the physically releasable inventory. If D can accept and demand is not positive, up to eight physically releasable trays may be authorized. Positive lane `PurgeDemand` permits a source batch to discharge while D's entrance is blocked.

The physical T bypass is separate from lane `PurgeDemand`. When all 12 physical T zones are occupied and D's entrance is blocked, the controller freezes the six downstream-most eligible `EMPTY` tray IDs for diversion through the six-zone PURGE conveyor. Later arrivals cannot join, D reopening does not cancel the batch, and no selected tray may enter D.

If a source batch is blocked behind full T, the physical six-tray T bypass takes precedence without cancelling or reselecting that source. The interrupted source retains its frozen membership and resumes after the bypass creates capacity. Source priorities are recalculated only after the interrupted batch completes.

## Material accounting

Tray identity is preserved through cartbuild detraying and Körber processing. Detraying removes the carton payload without replacing the tray; Körber changes the same tray from `EMPTY` to `FULL`. Körber processing is a throughput event, not a material sink. Only downstream exchanger acceptance removes a tray from physical conveyor state and records it in returned-ASRS history.

Tray balance:

```text
createdTrayCount = physicalTrayCount + returnedToAsrsCount
```

Carton balance:

```text
cartbuildCartonsIntroduced =
  cartbuildCartonsAttachedToTrays
  + cartbuildCartonsOnConveyors
  + cartbuildCartonsConsumedByOperators
```

Both balance errors are exposed in diagnostics and are expected to remain zero.

## Validation and visualization

The current suite contains 133 deterministic tests across 16 files. Coverage includes earlier milestone regressions, SRS targets and reservations, mission typing and maturity, source arbitration, frozen source batches, T bypass ownership and resumption, exchanger timing and priority, scenario startup, detraying, carton flow, snapshot immutability, and long-running identity and material invariants.

The latest validation passed:

- Complete test suite
- Lint
- Standalone TypeScript compilation
- Production build
- Tray and carton material-balance checks

The functional schematic displays the full outbound, return, and cartbuild topology. Diagnostics expose operating toggles, scenario startup, planning cadence, SRS counts and reservations, mission types, lane `PurgeDemand`, active source batches, the physical T bypass, cartbuild occupancy, operator consumption, and material balances.

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

- Authoritative outbound, return, and cartbuild conveyor physics
- Unified `EMPTY` and `CARTBUILD` ASRS missions with SRS reserved-capacity control
- Same-ID Körber transformation and blocked-discharge hold
- Atomic cartbuild detraying, independent carton lanes, and operator sinks
- Frozen source batches, lane `PurgeDemand`, physical T bypass, E-priority merge, and return sorting
- Clean configurable scenario startup and runtime-preserving operating toggles
- Tray/carton accounting, diagnostics, and functional visualization

Known limitations and future backlog:

- ASRS robot trips and dual-cycle exchanger coordination
- Pairing inbound returns with outbound missions
- Scanner behavior
- Carton order and group metadata
- Operator interference through manual tray insertion or removal
- Variable machine, ASRS, and operator rates
- CAD-derived physical dimensions and routing
- Returned-tray reintroduction through an explicit lifecycle transition
- Team/vendor deployment and scenario sharing

The schematic is intentionally compact and does not claim CAD accuracy. Robot movement, dual-cycle behavior, returned-tray reintroduction, deployment, and scenario sharing are not simulated.
