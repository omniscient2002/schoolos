/* ============================================================================
   audit-lib.mjs — persistent shared helpers for UI a11y audits (unit 8+).
   NOT scratch: created at the orchestrator's instruction so the detector
   heuristics are permanent and documented, not re-typed per batch.

   CANONICAL FOCUS-VISIBILITY DETECTOR (unit 7 finding, permanently encoded):
   An element shows focus when EITHER
     (a) outline: width !== '0px' && style !== 'none'  (traditional ring), OR
     (b) box-shadow !== 'none'                          (halo treatment —
        .input/.select/.textarea get `border-color: accent + 0 0 0 3px halo`
        via .input:focus in components.css:65; outline-only detectors caused
        the batch-1 false-positive class), OR
     (c) border-color changes to the accent token on :focus (form fields).
   The (b)+(c) counting is MANDATORY in every future audit — see
   handoff/2026-09-06-ui-orchestrator-unit7-batch1.md (finding 7–8).
   ========================================================================== */

export const FOCUS_RING_SNIPPET = `
  const ringOf = (el) => {
    const cs = getComputedStyle(el);
    const outline = cs.outlineWidth !== '0px' && cs.outlineStyle !== 'none';
    const halo = cs.boxShadow !== 'none';                       // (b) mandatory
    const accentBorder = cs.borderColor && cs.borderColor !== 'rgb(229, 231, 235)' && el.matches('input, select, textarea');
    return outline || halo || !!accentBorder;
  };`;

export const CONTRAST_SNIPPET = `
  const lum = (rgb) => {
    const m = rgb.match(/rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)/);
    if (!m) return null;
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(+m[1]) + 0.7152 * f(+m[2]) + 0.0722 * f(+m[3]);
  };
  const contrast = (a, b) => {
    const x = lum(a), y = lum(b);
    return x === null || y === null ? null : (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  /* effective background: walk ancestors to the first non-transparent bg */
  const bgOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const b = getComputedStyle(n).backgroundColor;
      if (b && !/rgba?\\(\\s*\\d+,\\s*\\d+,\\s*\\d+,\\s*0\\)/.test(b)) return b;
      n = n.parentElement;
    }
    return 'rgb(255, 255, 255)';
  };`;

export const COARSE_POINTER_CDP = {
  /* Chromium: emulate coarse pointer so @media (pointer: coarse) applies */
  setCoarse: async (client) => client.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'pointer', value: 'coarse' }],
  }),
};
