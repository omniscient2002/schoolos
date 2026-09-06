import { readFileSync } from 'fs';
function tokens(css) {
  const m = {};
  for (const match of css.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) m[match[1]] = match[2].trim();
  return m;
}
const light = tokens(readFileSync('src/styles/tokens.css', 'utf8'));
const darkCss = readFileSync('src/styles/dark.css', 'utf8');
const attrBlock = darkCss.slice(darkCss.indexOf(':root[data-theme="dark"]'));
const dark = { ...light, ...tokens(attrBlock) };
function resolve(name, scope, seen = new Set()) {
  if (seen.has(name)) return null; seen.add(name);
  const v = scope[name];
  if (v === undefined) return null;
  const varRef = v.match(/var\(--([a-z0-9-]+)(?:,\s*([^)]+))?\)/);
  if (varRef) {
    const inner = resolve(varRef[1], scope, seen);
    if (inner !== null) return inner;
    return varRef[2] ? varRef[2].trim() : null;
  }
  return v;
}
const lum = v => {
  const hex = v.match(/^#([0-9a-f]{6})$/i);
  let r, g, b;
  if (hex) { const n = parseInt(hex[1], 16); r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255; }
  else { const m = v.match(/[\d.]+/g); if (!m) return null; [r, g, b] = m.slice(0, 3).map(Number); }
  const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => { const x = lum(a), y = lum(b); return x === null || y === null ? null : (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const cases = [
  ['text on bg', '--text', '--bg', 4.5], ['text on surface', '--text', '--surface', 4.5],
  ['text-2 on surface', '--text-2', '--surface', 4.5], ['text-3 on surface', '--text-3', '--surface', 4.5],
  ['text-2 on surface-2', '--text-2', '--surface-2', 4.5], ['text-3 on surface-3', '--text-3', '--surface-3', 4.5],
  ['white on accent (btn-primary, light)', '#ffffff', '--accent', 4.5, 'light'],
  ['btn-ink on accent (btn-primary, dark)', '#161511', '--accent', 4.5, 'dark'],
  ['white on gradient end (light)', '#ffffff', '#2E7D6F', 4.5, 'light'],
  ['ink on gradient ends (dark)', '#161511', '#46B5A2..#3FA795', 4.5, 'dark'],
  ['accent-text on surface', '--accent-text', '--surface', 4.5],
  ['accent-text on accent-weak', '--accent-text', '--accent-weak', 4.5],
  ['ai-text on ai-weak', '--ai-text', '--ai-weak', 4.5],
  ['success on success-weak', '--success', '--success-weak', 4.5],
  ['warning on warning-weak', '--warning', '--warning-weak', 4.5],
  ['danger on danger-weak', '--danger', '--danger-weak', 4.5],
  ['danger-text on surface', '--danger-text', '--surface', 4.5],
  ['danger-hover-text on warning-weak (badge-warning)', '--danger-hover-text', '--warning-weak', 4.5],
  ['info on info-weak', '--info', '--info-weak', 4.5],
  ['chart-amber on surface-2', '--chart-amber', '--surface-2', 3],
  ['chart-blue on surface-2', '--chart-blue', '--surface-2', 3],
  ['chart-red on surface-2', '--chart-red', '--surface-2', 3],
  ['chart-red-deep on surface-2', '--chart-red-deep', '--surface-2', 3],
  ['chart-violet on surface-2', '--chart-violet', '--surface-2', 3],
  ['chart-teal on surface-2', '--chart-teal', '--surface-2', 3],
  ['chart-slate on surface-2', '--chart-slate', '--surface-2', 3],
  ['chart-steel on surface-2', '--chart-steel', '--surface-2', 3],
  ['chart-amber on surface', '--chart-amber', '--surface', 3],
  ['accent on surface (dot/campus base)', '--accent', '--surface', 3],
];
let fails = 0;
const GRAD_DARK = ['#46B5A2', '#3FA795'];
for (const [mode, scope] of [['LIGHT', light], ['DARK ', dark]]) {
  console.log(`\n=== ${mode} ===`);
  for (const item of cases) {
    const [label, f, b, min, only] = item;
    if (only && !only.toLowerCase().startsWith(mode.trim().slice(0, 5).toLowerCase()) && !((mode.trim() === 'DARK' && only === 'dark') || (mode.trim() === 'LIGHT' && only === 'light'))) { continue; }
    if (b === '#46B5A2..#3FA795') {
      const rs = GRAD_DARK.map(g => ratio('#161511', g));
      const worst = Math.min(...rs);
      console.log(`${worst >= min ? 'pass' : 'FAIL'} ${worst.toFixed(2).padStart(5)}  (min ${min})  ${label}   [ink on both gradient ends]`);
      continue;
    }
    const fv = f.startsWith('#') ? f : resolve(f.slice(2), scope);
    const bv = b.startsWith('#') && b !== '#46B5A2..#3FA795' ? b : resolve(b.slice(2), scope);
    const r = ratio(fv ?? '', bv ?? '');
    const verdict = r === null ? 'N/A ' : r >= min ? 'pass' : 'FAIL';
    if (verdict === 'FAIL') fails++;
    console.log(`${verdict} ${r === null ? '  —  ' : r.toFixed(2).padStart(5)}  (min ${min})  ${label}   [${fv} on ${bv}]`);
  }
}
console.log(`\nFAILS=${fails}`);
