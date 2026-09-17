// India Standard Time — ONE definition (DAT-7, PERFECT-100 §5.4/§5.6).
//
// THE DEFECT: `routes.js` already contained a correct IST helper for dunning, but the two attendance doors
// defaulted the register date to `new Date().toISOString().slice(0,10)` — UTC — and `people.admin`'s withdraw
// effective date did the same. Postgres runs `Asia/Kolkata`, so between 00:00 and 05:30 IST the UTC date is
// the previous day: a client omitting `date` wrote and read YESTERDAY's register, and the attendance unique
// conflict target absorbed it silently. The fix is one kernel definition every door defaults through.
//
// IST is a FIXED +05:30 offset (no DST), so a date in IST is `Date.now() + 5.5h` read as UTC.
export const IST_OFFSET_MS = 5.5 * 3600 * 1000;

/** The current instant shifted so that UTC getters read IST wall-clock fields. */
export const istNow = () => new Date(Date.now() + IST_OFFSET_MS);

/** Today's date in IST as `YYYY-MM-DD`. */
export const istToday = () => istNow().toISOString().slice(0, 10);
