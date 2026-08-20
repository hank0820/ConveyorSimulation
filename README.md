# Conveyor Simulation

A deterministic React and TypeScript model of a three-source conveyor system with hybrid accumulation piles, authoritative zero-pressure MDR zones, SRS-based ASRS replenishment, Körber processing, cartbuild lanes, return conveyors, and ASRS robot dual cycles.

## Milestone status

Milestone 11 is implemented and validated. It builds on Milestone 10's cartbuild reservations, ASRS robots, exchanger queues, exact inbound reservations, and dual-cycle behavior without redesigning logical routing or control priority.

Milestone 11 delivers:

- Refined outbound A1/B1/C1 physical composition and detrayer placement
- Updated shared-conveyor zone counts
- Authoritative A2/B2/C2 inbound composite conveyors with spiral physics
- Configurable SRS `TargetSize` scenarios and target-based initialization
- A refined full-system topology visualization with schematic spiral coils

## Milestone 11 outbound topology

A1, B1, and C1 are hybrid accumulation piles in authoritative exchanger-to-discharge flow order.

| Pile | Pre-detrayer MDR | Detrayer | Post-detrayer MDR | Belt | Downstream MDR | Total length | Physical positions |
|---|---:|---|---:|---:|---:|---:|---:|
| A1 | 5 zones | Yes | 5 zones | 41 ft | 15 zones | 103.5 ft | 45 |
| B1 | 5 zones | Yes | 5 zones | 41 ft | 8 zones | 86 ft | 38 |
| C1 | 5 zones | Yes | 5 zones | 41 ft | 8 zones | 86 ft | 38 |

MDR zones are 2.5 feet long. At 120 ft/min, an unobstructed MDR transfer takes 1.25 simulated seconds. Each 41-foot belt holds at most 20 trays at two-foot pitch and has a 20.5-second nominal traversal.

A blocked downstream MDR zone 0 stops the whole belt and rejects new belt entry. Detraying occurs after the first five MDR zones, between pre-detrayer zone 4 and post-detrayer zone 0. A loaded `CARTBUILD` split is atomic and requires both post-detrayer zone 0 and carton-lane zone 0 to be available. The same tray continues as `EMPTY`, while one carton enters the associated cartbuild lane. `EMPTY` trays cross the detrayer without creating cartons.

### Shared conveyors

| Section | Physical zones | Length |
|---|---:|---:|
| `PRE_T` | 6 | 15 ft |
| `T` | 12 | 30 ft |
| `D` | 92 | 230 ft |
| `PURGE` | 12 | 30 ft |
| `E` | 28 | 70 ft |
| `X` | 4 | 10 ft |
| `S` | 8 | 20 ft |

A1 and B1 merge onto `PRE_T`; C1 enters `T` directly. `PURGE` remains the section name and has 12 physical zones, while its frozen physical T-bypass batch remains exactly six trays. Existing source-batch priority, slug control, T arbitration, E-over-PURGE merge priority, and return-sorter routing are unchanged.

Körber processes the tray in D's final physical zone 91 at 1,050 trays/hour. Processing preserves tray identity and changes `EMPTY` to `FULL`. If E zone 0 is unavailable, exactly one processed tray remains held at the Körber discharge and blocks further processing until it can enter E.

## Milestone 11 inbound topology

Inbound composite flow is from the return sorter toward the corresponding exchanger TAKE station.

| Composite | Sorter-side MDR | Spiral | Exchanger-side MDR | Total length | Physical positions |
|---|---:|---:|---:|---:|---:|
| A2 | 33 zones | 41 ft | 5 zones | 136 ft | 58 |
| B2 | 26 zones | 41 ft | 5 zones | 118.5 ft | 51 |
| C2 | 26 zones | 41 ft | 5 zones | 118.5 ft | 51 |

Each spiral uses the same whole-device stop/interlock model as an outbound belt. It has 20 physical tray positions at two-foot pitch and a 20.5-second nominal traversal. If exchanger-side zone 0 is blocked, the complete spiral stops and rejects entry from the sorter-side MDR bank. Restart preserves tray order and spacing.

Exchanger-side zone 4 is the exact inbound reservation and TAKE pickup point. A reserved tray remains physical until the matching robot takes that same tray ID. A2 and B2 continue through shared conveyor S; C2 remains the direct sorter branch. S retains head-of-line blocking. An inbound `CurrentCount` includes trays in the sorter-side MDR bank, spiral, and exchanger-side MDR bank exactly once.

## Configurable SRS targets

The operations panel exposes selected scenario targets separately from the active targets used by the engine.

| Pile | Default `TargetSize` |
|---|---:|
| A1 | 24 |
| B1 | 16 |
| C1 | 16 |
| T | 6 |
| D | 92 |
| A2 | 36 |
| B2 | 29 |
| C2 | 29 |
| **Total** | **248** |

Inputs accept integers from 1 through 999. Blank, nonnumeric, fractional, out-of-range, or otherwise invalid drafts remain visible, display validation, and disable **Start Scenario**. Editing pauses playback but does not reset the simulation or alter active engine targets. When selected and active values differ, the UI displays **Apply with Start Scenario**.

**Start Scenario** atomically applies valid selected targets, selected operating toggles, and the planning cadence; clears prior physical and control state; initializes the new scenario at time zero; and runs immediate planning exactly once. **Reset** restores all eight target defaults, all four operating toggles to ON, the ten-second planning cadence, and deterministic default initialization.

### Target-based initialization

Only A1, B1, C1, and D initialize from their targets. T, A2, B2, C2, and transport sections start physically empty.

```text
initial physical count = min(TargetSize, physical capacity)
```

The configured `TargetSize` itself remains unclamped. For example, A1 may have an active target of 60 while its physical initialization remains 45. Partial initial inventory fills from the downstream discharge end backward without overlap. Active targets drive SRS capacity, `PendingDemand`, lane `PurgeDemand`, and diagnostics.

The default time-zero state is:

- Target total: 248
- Conveyor trays before planning: 148
- Global availability before planning: 100
- Immediate missions: 100
- Mission types: 90 `CARTBUILD`, 10 `EMPTY`
- Missions by exchanger: A = 34, B = 33, C = 33
- Total physical trays after planning: 248, consisting of 148 conveyor trays and 100 robot-carried trays

`CurrentCount` counts physical trays in the eight SRS piles regardless of load state. `PRE_T`, Körber-held trays, E, PURGE, X, S, and other transport locations remain physical inventory but are not included in those eight counts.

Global reserved capacity is:

```text
max(0, sum(TargetSize) - sum(CurrentCount) - sum(PendingDemand))
```

Lane release pressure remains:

```text
lanePurgeDemand = CurrentCount - TargetSize + PendingDemand
```

Lane `PurgeDemand` is a signed SRS control quantity and is distinct from the frozen six-tray physical T-bypass batch.

## Cartbuild and scenario controls

`CARTBUILD_A`, `CARTBUILD_B`, and `CARTBUILD_C` are independent 30-position carton conveyors. A cartbuild request reserves one position from mission creation through robot transport, exchanger unload, detraying, conveyor travel, and operator consumption.

```text
committedCartbuildPositions =
  pending CARTBUILD missions
  + CARTBUILD cartons attached to released trays
  + cartons physically on the cartbuild lane
```

Each cartbuild operator consumes from its final zone at no more than 450 cartons/hour. A `CARTBUILD` mission requires both SRS capacity and cartbuild capacity. If cartbuild capacity is exhausted and Körber is enabled, planning may select `EMPTY`; failed mission creation consumes no robot, tray, carton, reservation, or exchanger cadence.

The operations panel exposes `KORBER`, `CARTBUILD_A`, `CARTBUILD_B`, and `CARTBUILD_C`. Changing a toggle pauses playback but preserves the current engine state; the new value affects future eligibility without discarding pending or in-flight work.

## Milestone 10 ASRS robots and dual cycles

The model retains Milestone 10's infinite robot availability: every outbound mission receives a unique robot and payload tray and begins a 180-second retrieval window. Matured work at each exchanger is ordered by `CARTBUILD`, then `EMPTY`, then `INBOUND_ONLY`, with oldest assignment and mission ID breaking ties.

Each A/B/C exchanger has an independent shared eight-second DROP-admission cadence. Admission grants fixed DROP ownership. A blocked pile entrance leaves the outbound robot at DROP with its payload and prevents following robots from passing; a failed unload does not advance the cadence. Successful unloading preserves tray identity and begins a one-second DROP-to-TAKE shift.

Inbound reservations bind a robot mission to an exact tray in exchanger-side zone 4. If no eligible outbound robot can serve it, an inbound-only robot is dispatched. At TAKE:

- An outbound robot taking a return tray becomes `DUAL_CYCLE`.
- An outbound robot without a return tray becomes `OUTBOUND_ONLY`.
- An inbound-only robot taking its reserved tray becomes `INBOUND_ONLY`.
- A qualifying outbound robot may claim a tray reserved for an approaching inbound-only robot under the existing cancellation rules.

All returning robots take ten simulated seconds from TAKE to rack arrival. A picked-up tray remains robot-carried physical inventory during that interval, and `returnedToAsrsCount` increments only at rack arrival.

Completed history uses `DUAL_CYCLE`, `OUTBOUND_ONLY`, `INBOUND_ONLY`, and `CANCELLED_INBOUND_ONLY`. Outbound dual utilization is:

```text
DUAL_CYCLE / (DUAL_CYCLE + OUTBOUND_ONLY)
```

## Visualization

The full system is rendered on one responsive SVG with a `1600 × 1040` logical viewBox. It is operationally proportional but intentionally schematic rather than CAD-scale.

- Every MDR zone and every physical conveyor tray is rendered exactly once.
- Long sections such as D use stronger visual compression while retaining distinct zone boundaries.
- Outbound 41-foot belts remain straight and visually distinct from MDR banks.
- Inbound 41-foot spirals use compact four-turn schematic coils.
- Spiral tray progress maps monotonically from `spiralPositionFt / 41` along the complete coil path.
- A/B/C exchangers, DROP and TAKE stations, four visible queued robots per exchanger, individual operating robots, transit aggregates, payloads, and the shared rack remain visible.
- Selected and active target controls remain beside the canvas.
- Full IDs and placement semantics are retained in SVG attributes and tooltips while visible labels remain compact.

Elevation, real spiral pitch, diameter, and exact revolutions are not simulated.

## Routing and control behavior retained from earlier milestones

Milestone 11 does not change:

- Körber processing rate
- Cartbuild operator rates
- Shared eight-second exchanger cadence
- Robot retrieval, DROP-to-TAKE, or ten-second return timing
- Dual-cycle and cancellation rules
- Source-batch priority and frozen membership
- Six-tray T-bypass quantity
- E-over-PURGE merge priority
- A2 → B2 → C2 return-sorter order
- Material-accounting definitions
- Logical conveyor connections

## Ownership and material accounting

At any instant, a tray has exactly one authoritative owner: a conveyor placement, an outbound robot payload, an inbound return robot payload, or returned history after rack arrival.

```text
materialBalanceError =
  createdTrayCount
  - physicalTrayCount
  - returnedToAsrsCount
```

Carton ownership moves atomically from robot-carried payload to conveyor tray, through detraying, along a cartbuild lane, and to operator consumption.

```text
cartonBalanceError =
  cartbuildCartonsIntroduced
  - cartbuildCartonsAttachedToTrays
  - cartbuildCartonsOnConveyors
  - cartbuildCartonsConsumedByOperators
```

Both balance errors are exposed in diagnostics and remain zero in validated scenarios. Snapshots are immutable, and ownership transitions do not duplicate tray or carton identity.

## Validation status

The latest committed Milestone 11 validation passed:

- 324/324 deterministic tests across 27 files
- Focused Milestone 11A–11D tests
- Lint
- Standalone TypeScript compilation
- Production build
- Tray and carton balance assertions
- No skipped or pending tests
- Manual desktop visualization acceptance at 1920 × 1080 and 1366 × 768

After a computer restart, contention-safe non-overlapping test batches were used once to cover the complete suite under each test's committed timeout configuration. The same full suite also passed with one worker. This was validation-environment contention, not a product defect.

## Development

```bash
npm install
npm run dev
npm test -- --run --maxWorkers=1
npm run lint
npm run build
```

Standalone type-check:

```bash
npx tsc --noEmit
```

## Known limitations and backlog

The following capabilities are not implemented:

- Operator interference and manual tray insertion or removal
- Variable machine, ASRS, robot, exchanger, and operator rates
- CAD-derived dimensions and routing
- Finite robot fleets and robot reuse
- Robot faults, recovery, and reassignment
- Scanner behavior
- Order grouping and carton metadata
- Returned-tray reintroduction through an explicit lifecycle
- Scenario saving and sharing
- Deployment for teams and vendors
- Exact elevation and physical spiral geometry
