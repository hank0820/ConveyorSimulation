# Conveyor Simulation

A deterministic React and TypeScript model of a three-source conveyor system with hybrid accumulation piles, authoritative zero-pressure MDR zones, SRS-based ASRS replenishment, Körber processing, downstream return conveyors, and outbound cartbuild lanes.

## Milestone status

Milestone 10 is implemented and validated on top of the published Milestone 9 cartbuild and SRS model. It adds cartbuild-lane capacity reservations; outbound and inbound-only ASRS robot missions; per-exchanger DROP queues and persistent blocking; one-second DROP-to-TAKE movement; exact inbound tray reservations and dual-cycle pickup; ten-second rack return; robot visualization; and ASRS robot/exchanger diagnostics.

Milestone 10 builds on the Milestone 9 SRS `PendingDemand` and lane `PurgeDemand` controller rather than replacing it. The established Milestone 7 outbound, Milestone 8 return-conveyor, and Milestone 9 cartbuild physics remain authoritative.

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

In the full Milestone 10 configuration, a tray in the final A2, B2, or C2 zone remains physical until an ASRS robot picks up that exact tray at TAKE. The earlier independent 450-tray/hour return sinks remain only as compatibility behavior when the robot-enabled return/cartbuild topology is not present.

## Milestone 9 cartbuild topology

`CARTBUILD_A`, `CARTBUILD_B`, and `CARTBUILD_C` are independent 30-zone carton conveyors associated with the shared A, B, and C ASRS exchangers. Each exchanger has one shared DROP-admission clock for outbound `EMPTY`, outbound `CARTBUILD`, and inbound-only robot work. Successful admissions are separated by at least eight simulated seconds; DROP-to-TAKE and return-to-rack timing are separate from this cadence.

Every outbound ASRS mission has a 180-simulated-second retrieval time. Matured work uses the Milestone 10 priority and fixed DROP-ownership rules below; a following `EMPTY` robot cannot bypass a blocked `CARTBUILD` robot that already owns DROP.

A `CARTBUILD` mission creates its loaded robot-carried tray at assignment. Successful DROP unload places that same tray at upstream MDR zone 0 of A1, B1, or C1. The loaded tray travels through upstream zones 0, 1, and 2. Detraying occurs atomically between zones 2 and 3:

- The same tray ID enters zone 3 as `EMPTY`.
- Exactly one anonymous carton marker enters zone 0 of the corresponding cartbuild lane.
- The transfer waits until both destinations are available; no partial split occurs.

The empty tray continues through the existing hybrid pile and outbound conveyor system. The carton advances independently through its 30-zone lane. Each lane's operator consumes a carton from its final zone at a maximum rate of 450 cartons/hour, using an independent eight-second clock.

## Milestone 10 cartbuild reservations

Each cartbuild lane has 30 physical positions. A `CARTBUILD` request reserves one position when its mission is created, and that commitment follows the carton through retrieval, robot transport, exchanger unload, detraying, cartbuild conveyor travel, and operator consumption.

```text
committedCartbuildPositions
=
pending CARTBUILD missions
+ CARTBUILD cartons attached to released trays
+ cartons physically on the cartbuild lane
```

```text
availableCartbuildPositions
=
max(0, 30 - committedCartbuildPositions)
```

The snapshot exposes these quantities as `pendingMissionReservations`, `attachedTrayReservations`, `physicalLaneOccupancy`, `committedPositions`, and `availablePositions`. Robot-carried outbound payloads remain pending mission reservations until successful DROP unload; afterward, an attached carton reservation persists on the released tray until the atomic detrayer split moves it into physical lane occupancy.

A `CARTBUILD` mission requires both applicable SRS capacity and an available cartbuild position. If cartbuild capacity is exhausted and KÖRBER is enabled, planning may fall back to `EMPTY`. `EMPTY` missions still require SRS capacity but are not throttled by cartbuild-lane capacity. A failed mission attempt creates no robot, payload, carton, or reservation and does not consume exchanger cadence.

## Milestone 10 ASRS robot lifecycle

The current model has infinite robot availability: every outbound mission immediately receives one unique robot and one unique payload tray. Assignment establishes ownership, increments the deterministic robot and tray IDs, and starts the 180-second retrieval/travel window. Robot-carried payloads are physical inventory but do not appear on a conveyor until a successful DROP unload.

At maturity, each exchanger orders its queue by:

1. `CARTBUILD`
2. `EMPTY`
3. `INBOUND_ONLY`
4. Oldest assignment and mission ID within a type

Each A/B/C exchanger has an independent, shared eight-second DROP-admission cadence. Admission gives the selected robot fixed DROP ownership. An outbound robot unloads its tray into upstream zone 0 of A1, B1, or C1; successful unload preserves tray identity, changes the mission from pending to released, and starts a one-second shift toward TAKE. If pile zone 0 is occupied, the DROP robot remains blocked with its payload and prevents following robots from passing. The failed unload does not advance the exchanger clock.

For `CARTBUILD`, DROP admission depends on the pile entrance, not on cartbuild-lane zone 0. Carton-lane availability is enforced later at the existing atomic detrayer split between upstream MDR zones 2 and 3.

## Inbound reservations and dual cycles

A tray waiting in the final zone of A2, B2, or C2 remains in conveyor-owned physical inventory until TAKE pickup. Inbound reservations bind a robot mission to an exact tray ID. If no active-at-exchanger or matured outbound robot can serve a waiting tray under the implemented eligibility rules, the exchanger dispatches an inbound-only robot. A merely retrieving outbound robot does not prevent this dispatch.

Inbound-only robots take the same 180-second approach, join the shared DROP queue behind matured `CARTBUILD` and `EMPTY` work, pass through DROP without an outbound payload, and shift to TAKE in one second. At TAKE:

- An outbound robot that collects an available return tray becomes `DUAL_CYCLE`; without a tray it becomes `OUTBOUND_ONLY`.
- An inbound-only robot that collects its reserved tray becomes `INBOUND_ONLY`.
- A qualifying outbound robot may claim a tray reserved for an approaching inbound-only robot.

Pre-admission cancellation removes the inbound-only robot from active work and records cancellation immediately. Post-admission cancellation preserves the admitted robot's DROP-to-TAKE/return lifecycle but prevents it from collecting the claimed tray. Cancelled robots are retained in history and are never reassigned.

All returning robots take ten simulated seconds from TAKE to rack arrival. A picked-up tray remains robot-carried physical inventory during that interval. `returnedToAsrsCount` increments only at rack arrival, never at TAKE pickup.

## Robot cycle history and diagnostics

Completed history uses `DUAL_CYCLE`, `OUTBOUND_ONLY`, `INBOUND_ONLY`, and the source-level cancellation classification `CANCELLED_INBOUND_ONLY`. The operations panel presents the last category as cancelled/history-only work.

Outbound dual utilization is:

```text
DUAL_CYCLE / (DUAL_CYCLE + OUTBOUND_ONLY)
```

`INBOUND_ONLY` and cancelled records are excluded. A zero denominator displays as `0%`.

The collapsible **ASRS Robots** diagnostics show global active lifecycle and carried-payload counts; completed classifications, cancellations, and dual utilization; independent A/B/C queue depth and four-robot visible caps; DROP identity, blocking reason/duration, TAKE/shift identity, returning counts, timings, and maximum queue depth; and cartbuild-position and exact inbound-tray reservations. Stable semantic attributes and full-ID tooltips support deterministic inspection while visible IDs remain compact.

## Robot visualization

The schematic includes one shared ASRS rack boundary and separate A/B/C paths with explicit DROP and TAKE positions. Each exchanger renders the next four authoritative queued robots individually on one staging line, with Q1 closest to DROP. A one-second queue-advancement progress value animates Q2 toward Q1, Q3 toward Q2, Q4 toward Q3, and the next aggregate member toward Q4 without changing queue order.

DROP, DROP-to-TAKE shift, TAKE, returning, and Q1-Q4 robots render individually. Outbound robots still in the 180-second travel window, matured queue overflow beginning at Q5, and other non-operationally positioned robots appear only in their exchanger's **ASRS Transit** aggregate. Aggregate transit robots intentionally do not claim individual travel coordinates.

Every active robot is represented exactly once, either individually or in one aggregate. Individual payload rendering preserves tray semantics and nests a carton when the payload state carries carton semantics. Robot, mission, exchanger, queue, lifecycle, payload, aggregate-membership, and position semantics are exposed through SVG attributes and tooltips.

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

**Start Scenario** clears and recreates all simulation and material state, applies the selected settings before planning, and runs the immediate time-zero planning cycle exactly once. It also clears robot missions, reservations, exchanger queues, cycle histories, and cancellations, then restarts mission, robot, tray, and carton IDs deterministically. **Pause** preserves the current run.

The normal **Reset** action performs the same clean robot/material initialization but restores all four toggles to ON and the default 10-second planning cadence before producing the default 27/26/26 time-zero `CARTBUILD` allocation. This preserves the distinction between default Reset and configured Start Scenario.

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

## Ownership and material accounting

Tray identity is preserved across conveyor and robot ownership. At any instant a tray belongs to exactly one authoritative category:

- Conveyor-owned in `trays`, including hybrid piles, zoned conveyors, KÖRBER hold, and return final zones
- Outbound robot-carried as `robotPayload`
- Inbound return robot-carried as `inboundPayload`
- Removed from physical inventory and retained in `returnSystem.returnedHistory` after rack arrival

`createdTrayCount` is the total deterministic tray population created, including outbound robot payload trays created at mission assignment. `physicalTrayCount` is the sum of conveyor trays, outbound robot-carried trays, and inbound return robot-carried trays. `returnSystem.returnedToAsrsCount` is the number of trays whose robot has reached the rack. The implemented tray balance is:

```text
materialBalanceError =
  createdTrayCount
  - physicalTrayCount
  - returnSystem.returnedToAsrsCount
```

Equivalently, while the return model is enabled:

```text
createdTrayCount = physicalTrayCount + returnSystem.returnedToAsrsCount
```

Carton identity follows its `CARTBUILD` payload from robot-carried tray to conveyor tray, through atomic detraying, along the cartbuild conveyor, and finally to operator consumption:

```text
cartonBalanceError =
  cartbuildCartonsIntroduced
  - cartbuildCartonsAttachedToTrays
  - cartbuildCartonsOnConveyors
  - cartbuildCartonsConsumedByOperators
```

`cartbuildCartonsAttachedToTrays` includes applicable outbound robot payloads, conveyor trays, and inbound return robot payloads. Robot-to-conveyor DROP and conveyor-to-robot TAKE transitions move ownership atomically; neither tray nor carton identities are duplicated. Both balance errors are exposed in diagnostics and are expected to remain zero.

## Validation status

The current suite contains 263 deterministic tests across 22 files, with no skipped tests. Focused Milestone 10 coverage includes cartbuild capacity reservation, outbound robot ownership and maturity, persistent exchanger DROP/TAKE pipelines, inbound-only and dual-cycle behavior, cancellation history, exact tray/carton accounting, queue animation and exact-once visualization, diagnostics semantics, resets, and immutable snapshots. Earlier milestone regression coverage remains in the complete suite.

The latest validation passed:

- 263/263 tests across 22 files
- Focused Milestone 10 tests
- Lint
- Standalone TypeScript compilation
- Production build
- Tray and carton material-balance checks

One parallel full-suite run encountered wall-clock contention in an unchanged long-duration KÖRBER test. That test passed independently, and the complete 263-test suite passed with one worker and unchanged assertions, simulation durations, and timeout budgets. This was a test-execution contention event, not a production defect.

The functional schematic displays the complete conveyor, cartbuild, and robot topology. The operations panel exposes operating settings, scenario startup, SRS control, lane `PurgeDemand`, the separate physical T bypass, material balances, robot lifecycle and payload counts, exchanger queue/DROP/TAKE/return state, reservations, completed classifications, cancellations, and dual utilization.

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
- Thirty-position cartbuild-lane commitment and fallback control
- Outbound and inbound-only ASRS robot missions with exact payload ownership
- Independent exchanger DROP queues, persistent blocking, shared eight-second admission, and one-second DROP-to-TAKE movement
- Exact inbound tray reservations, dual-cycle pickup, cancellation history, and ten-second rack return
- Same-ID Körber transformation and blocked-discharge hold
- Atomic cartbuild detraying, independent carton lanes, and operator sinks
- Frozen source batches, lane `PurgeDemand`, physical T bypass, E-priority merge, and return sorting
- Clean configurable scenario startup and runtime-preserving operating toggles
- Tray/carton accounting, exact-once robot visualization, and ASRS operations diagnostics

Known limitations and future backlog:

- Finite robot fleet capacity and robot reuse
- Smarter robot reassignment and cancellation policies
- Detailed rack navigation and CAD-derived robot travel paths
- Robot faults and recovery behavior
- More complete exchanger-side dependencies
- Scanner behavior
- Carton order and group metadata
- Operator interference through manual tray insertion or removal
- Variable robot, machine, ASRS, and operator rates
- Exact CAD-derived conveyor dimensions and routing
- Returned-tray reintroduction through an explicit lifecycle transition
- Team/vendor deployment and scenario sharing

The schematic is intentionally compact and does not claim CAD accuracy. Robot movement and current dual-cycle coordination are simulated at the documented abstraction level; finite fleets, detailed rack routing, fault recovery, returned-tray reintroduction, deployment, and scenario sharing are not implemented.
