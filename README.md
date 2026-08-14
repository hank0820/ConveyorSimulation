# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

## Milestone 6 — Hybrid Accumulation Model

This project models A1/B1/C1 as hybrid accumulation piles composed of discrete MDR zones and a continuous belt.

Key assumptions:
- Tray length: 2.0 ft
- MDR zone length: 2.5 ft
- One tray maximum per MDR zone; trays are centered in zones when stopped
- MDR banks: discrete zone-by-zone cascade behavior (implemented incrementally)
- Middle belt: continuous driven belt, speed 120 ft/min (2 ft/s), may contain multiple trays
- TargetCount remains logical (A1=24, B1=16, C1=16) and is not a hard physical cap
- PurgeDemand authorizes logical-pile exits only; internal propagation is automatic

Internal layouts (derived from 81-ft total lengths):

- A1: 8 upstream MDR + 23.5-ft belt + 15 downstream MDR (23 MDR positions + 1 belt design position = 24 nominal positions)
- B1: 8 upstream MDR + 43.5-ft belt + 7 downstream MDR (15 MDR positions + 1 belt design position = 16 nominal positions)
- C1: same as B1

Notes:
- D remains on the older physical model for now.
- The belt and MDR rendering is visual-only; visualization geometry does not alter physical simulation geometry except where hybrid pile diagnostics are used.

## Hybrid Pile Vacancy Propagation (Runtime)

Important runtime guarantees implemented for Milestone 6:

- Initial trays produced at `reset()` are full-fledged `Tray` objects and participate in the same physics as dynamically released trays.
- The pile internals (upstream MDR, belt, downstream MDR) are governed by a discrete zone-by-zone model that enforces one tray per MDR zone and zone transfer timing.
- Vacancy originates at the downstream end and propagates upstream one zone at a time according to the MDR transfer time (zone length / speed).
- Exchanger entry is allowed only when the first upstream MDR zone is physically free (and not merely by logical counts). Ready missions remain `READY_AT_EXCHANGER` until physical induction is possible.
- Trays leaving a pile clear their internal `pilePlacement` and then rejoin the regular conveyor movement model.

See `src/simulation/SimulationEngine.ts` and `src/simulation/HybridAccumulationPile.ts` for implementation details.

