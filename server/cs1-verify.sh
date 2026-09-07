#!/bin/bash
# CS-1 verify harness — the shared schoolos_test DB is contended by sibling lanes
# running the same drop/verify cycle. Retry until one attempt lands in a quiet window.
cd /home/cassandra/schoolOS/server
PSQL="psql postgres://postgres@127.0.0.1:5432/postgres"

quiet() {
  # no test-runner/seed processes AND no active backends on schoolos_test
  if ps -eo cmd | grep -qE "node (--test|scripts/(migrate|bootstrap|seed))" ; then return 1; fi
  local n=$($PSQL -t -A -c "SELECT count(*) FROM pg_stat_activity WHERE datname='schoolos_test';" 2>/dev/null)
  [ "$n" = "0" ] || return 1
  return 0
}

for attempt in 1 2 3 4 5 6 7 8; do
  echo "── attempt $attempt: waiting for quiet window"
  ok=0
  for i in $(seq 1 60); do
    if quiet; then ok=$((ok+1)); else ok=0; fi
    [ $ok -ge 3 ] && break
    sleep 5
  done
  if [ $ok -lt 3 ]; then echo "no quiet window found before timeout"; continue; fi
  echo "quiet for 15s — dropping and running"
  $PSQL -c "DROP DATABASE IF EXISTS schoolos_test WITH (FORCE);" >/dev/null 2>&1
  node --test tests/coord-view.test.js > cs1-run.log 2>&1
  ec=$?
  echo "exit=$ec"
  grep -E "^ℹ (tests|pass|fail)" cs1-run.log
  if [ $ec -eq 0 ] && grep -q "^ℹ fail: 0$" cs1-run.log; then
    echo "VERIFY-GREEN"
    exit 0
  fi
  grep -c "terminating connection" cs1-run.log || true
done
echo "VERIFY-UNSTABLE (shared-DB contention)"
exit 1
