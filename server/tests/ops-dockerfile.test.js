/* OPS-18 — the image must be able to read its own code.
 *
 * The register's finding: `Dockerfile` did a plain `COPY src src` / `COPY scripts scripts` as root and
 * then `USER node`, while on the audited worktree 15 of 19 files in `scripts/` (and `src/index.js` /
 * `src/config.js`) were mode 600. COPY preserves source modes, so the runtime user could not read its
 * own entry script — a failure independent of, and potentially ahead of, OPS-1's boot ordering.
 *
 * WHY THE FIX IS OWNERSHIP AND NOT MODE. Version control records only the executable bit: mode 600 and
 * mode 644 are both `100644` to git and both materialise as 644 on a fresh clone under a normal umask.
 * So a `chmod 644` in the repository would not survive the next checkout and could not be the fix. The
 * durable fix is on the Docker build, where the modes of the build context are actually seen:
 * `COPY --chown=node:node` makes the runtime user the OWNER, so a 600 source is readable by `node`.
 *
 * WHAT THIS GATE WOULD HAVE CAUGHT, and why it is static: the repo's CI never builds the image
 * (register OPS-14), so a `docker build` assertion is impossible here. The failure shape is entirely
 * lexical — a COPY of the runtime sources without `--chown` — so reading the Dockerfile is sufficient
 * and exact, provided the positive half is also asserted (the `USER node` line that makes ownership
 * matter, and the CMD that proves an entry script is expected to be readable).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCKERFILE = readFileSync(join(HERE, '..', 'Dockerfile'), 'utf8');

/** The COPY instructions that place runtime source (not build deps) into the final image. */
const SOURCE_COPIES = [
  /^COPY\s+(--\S+\s+)*src\s+src\s*$/m,
  /^COPY\s+(--\S+\s+)*migrations\s+migrations\s*$/m,
  /^COPY\s+(--\S+\s+)*scripts\s+scripts\s*$/m,
  /^COPY\s+(--\S+\s+)*package\.json\s+\.\/\s*$/m,
];

describe('OPS-18 · every runtime source COPY is chowned to the user that runs it', () => {
  test('the image declares a non-root runtime user', () => {
    // The premise of the whole finding: if the container ran as root, root-owned 600 files would be
    // readable and there would be no defect. Asserting the user makes the COPY assertion meaningful.
    assert.match(DOCKERFILE, /^USER\s+node\s*$/m,
      'the image must run as a non-root user — otherwise this gate is asserting nothing');
  });

  test('each runtime source COPY uses --chown=node:node', () => {
    for (const re of SOURCE_COPIES) {
      const m = re.exec(DOCKERFILE);
      assert.ok(m, `expected a COPY line matching ${re} in the Dockerfile`);
      assert.match(m[0], /--chown=node:node/,
        `"${m[0].trim()}" copies runtime source without --chown=node:node. COPY runs as root and preserves `
        + 'source modes; a mode-600 source then cannot be read by `USER node`, so the container cannot '
        + 'start (OPS-18). Ownership is used rather than chmod because read bits are not tracked by git.');
    }
  });

  test('it is the only definition of these sources — a second, unguarded COPY cannot shadow the fix', () => {
    // A gate that only checks the first match can be defeated by appending a second COPY later. Count
    // the source COPY targets and require the chowned count to equal the total.
    const srcCopies = [...DOCKERFILE.matchAll(/^COPY\s+(--\S+\s+)*src\s+src\s*$/gm)];
    assert.equal(srcCopies.length, 1, 'there must be exactly one COPY of src/ — a duplicate could bypass the gate');
    const scriptCopies = [...DOCKERFILE.matchAll(/^COPY\s+(--\S+\s+)*scripts\s+scripts\s*$/gm)];
    assert.equal(scriptCopies.length, 1, 'there must be exactly one COPY of scripts/');
  });
});
