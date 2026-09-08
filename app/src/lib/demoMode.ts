/* ============================================================
   demoMode.ts — the single demo-affordance gate (P0 audit fix 2).

   Every demo-only surface (Login role-grid, /demo* + /live routes,
   "Switch demo role" menu, demo personas in chrome) renders ONLY
   when the build carries VITE_DEMO_MODE=1. Dev keeps it via
   app/.env.development; a production build gets no demo UI.

   One constant, imported everywhere — do not read
   import.meta.env.VITE_DEMO_MODE ad hoc, so grepping this file
   proves the gate is uniform.
   ============================================================ */

export const DEMO_MODE: boolean = import.meta.env.VITE_DEMO_MODE === '1';
