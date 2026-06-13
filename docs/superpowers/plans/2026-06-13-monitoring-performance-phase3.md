# Monitoring Performance Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the processor and graphics detail pages off the shared hardware store so their heavy dynamic data is isolated in dedicated page-full stores.

**Architecture:** Keep the phase 1 scheduler and phase 2 overview-lite store intact, then add `useProcessorHardwareData` and `useGraphicsHardwareData` composables that own their own static bootstrapping, dynamic polling, metric history, and background throttling. Switch the two heaviest detail pages to these dedicated stores so the shared store no longer needs to serve their telemetry.

**Tech Stack:** Vue 3, TypeScript, Electron/uTools bridge services, existing monitoring scheduler utilities

---

## File Map

- Create: `src/composables/useProcessorHardwareData.ts`
- Create: `src/composables/useGraphicsHardwareData.ts`
- Modify: `src/components/Processor/index.vue`
- Modify: `src/components/GraphicsPage/index.vue`
- Modify: `src/composables/useHardwareData.ts`
- Create: `tests/detailStoreSelectors.test.ts`

## Task List

- [ ] Add a focused test file for page-detail selector and history expectations used by processor/graphics stores.
- [ ] Implement `useProcessorHardwareData.ts` with independent init, adaptive polling, and explicit refresh export for helper actions.
- [ ] Implement `useGraphicsHardwareData.ts` with independent init, adaptive polling, and GPU-only metric history.
- [ ] Switch `Processor/index.vue` to the processor store.
- [ ] Switch `GraphicsPage/index.vue` to the graphics store.
- [ ] Remove processor/graphics scope activation from the shared `useHardwareData.ts` path only where it is no longer needed.
- [ ] Re-run type checks, targeted tests, and full build.
