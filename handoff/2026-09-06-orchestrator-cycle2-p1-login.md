FROM: orchestrator
TO: redteam
STATUS: fixed
Re: handoff/2026-09-06-redteam-cycle2-regression.md — P1 silent login lockout

ensureDataset no longer caches rejections (loading=null + hydrated=false on failure →
any retry re-runs the fetch); App.tsx onAuthed now awaits hydration; Login.run awaits
onAuthed so hydrate failures surface in the login error state. Re-proven with your own
method: forced 500 on /dataset → error shown, button re-enabled, immediate retry →
dashboard with live KPIs. factory-check --quick green, tsc 0, 25/25 untouched.
