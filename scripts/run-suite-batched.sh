#!/usr/bin/env bash
# Run the server suite in bounded batches instead of one process.
#
# WHY
#   One `node --test tests/*.test.js` holds enough memory on a modest box to be OOM-killed,
#   and a run that dies quietly is the worst kind: I checked for it with a glob that never
#   matches (the parent's command line holds the EXPANDED file list, not the glob), concluded
#   it had finished, started a second one — and two runners then DROP/CREATE schoolos_test over
#   each other. That manufactures ~20 phantom failures across unrelated areas, because every
#   file's `before` calls setupTestDb(), which is DROP DATABASE ... WITH (FORCE) + CREATE.
#
#   Batches are separate processes that exit, so memory returns between them. Batches run
#   STRICTLY sequentially — never two at once, for the reason above.
#
#   A batch that produced no `ℹ tests` totals did not fail its assertions; its setup died.
#   That is reported as an abort, not counted as a result.
#
# USAGE   scripts/run-suite-batched.sh [batch-size]      # default 12
set -uo pipefail

cd "$(dirname "$0")/.."
SIZE="${1:-12}"
OUT="${SUITE_LOG_DIR:-/tmp/schoolos-suite-batched}"
rm -rf "$OUT"; mkdir -p "$OUT"

mapfile -t FILES < <(ls server/tests/*.test.js | sort)
TOTAL=${#FILES[@]}
echo "batch size $SIZE over $TOTAL files → $OUT"
echo "note: the suite takes ~80 min in total; that is normal, not a hang."
echo

# Refuse to run if another suite is already alive — this is the check whose absence
# produced the phantom failures described above.
running=$(ps -eo args= | grep -F -- '--test-concurrency' | grep -c 'tests/[a-z0-9-]*\.test\.js tests/' || true)
if [ "${running:-0}" -gt 0 ]; then
  echo "ABORT: $running other suite runner(s) already alive. Kill them first." >&2
  ps -eo pid=,args= | grep -F -- '--test-concurrency' | grep 'tests/[a-z0-9-]*\.test\.js tests/' | cut -c1-140 >&2
  exit 1
fi

pass=0; fail=0; done=0; aborted=0
for ((i = 0; i < TOTAL; i += SIZE)); do
  chunk=("${FILES[@]:i:SIZE}")
  b=$((i / SIZE)); n=$((b + 1))
  log="$OUT/batch-$(printf '%02d' "$b").log"
  printf '── batch %d/%d  %s … %s\n' "$n" "$(((TOTAL + SIZE - 1) / SIZE))" \
    "$(basename "${chunk[0]}")" "$(basename "${chunk[-1]}")"

  # The file list is built from the REPO ROOT (server/tests/*.test.js) and node is run from inside
  # server/, so the paths are made relative here. Passing "server/tests/x.test.js" to a process whose
  # cwd is server/ asks it for server/server/tests/x.test.js — node then reports ONE comma-joined
  # "Could not find" for the whole batch, which the abort guard below (correctly) refuses to count.
  rel=()
  for f in "${chunk[@]}"; do rel+=("${f#server/}"); done

  ( cd server && NODE_ENV=test OTP_DEV_ECHO= node --test --test-concurrency=1 \
      --test-timeout=120000 "${rel[@]}" ) > "$log" 2>&1

  if ! grep -qE '^ℹ tests ' "$log"; then
    aborted=$((aborted + 1))
    echo '   !! no totals — batch aborted during setup, NOT counted as a result'
    grep -oE 'error: database "[^"]+" does not exist|Command failed: [a-z/. ]*|being accessed by other users' "$log" \
      | sort -u | head -2 | sed 's/^/      /'
    continue
  fi

  p=$(grep -oE '^ℹ pass [0-9]+' "$log" | tail -1 | grep -oE '[0-9]+' || echo 0)
  f=$(grep -oE '^ℹ fail [0-9]+' "$log" | tail -1 | grep -oE '[0-9]+' || echo 0)
  pass=$((pass + p)); fail=$((fail + f)); done=$((done + 1))
  echo "   pass $p · fail $f"
  if [ "$f" -gt 0 ]; then
    grep -E '^✖ ' "$log" | sed 's/^✖ /      ✖ /;s/ ([0-9.]*ms)$//' | sort -u
  fi
done

echo
echo "════ batches completed $done · aborted $aborted · pass $pass · fail $fail ════"
[ "$aborted" -gt 0 ] && { echo "an aborted batch means the database was disturbed — re-run before trusting this"; exit 2; }
[ "$fail" -gt 0 ] && exit 1
exit 0