#!/usr/bin/env bash
# Re-run every query behind the data appendix and print the results as TSV.
#
#   gcloud auth application-default login     # once, as a principal with BigQuery read
#   ./run.sh                                  # all queries
#   ./run.sh 02-harness-model-grid.sql        # one query
#
# Requires: gcloud, python3. Read-only -- these are SELECTs against a project you
# will not have access to unless you are on the Marblo team. The point of shipping
# them is that the numbers in ../dogfooding-2026-07.md can be audited line by line
# against the SQL that produced them, and that anyone can port the same definitions
# to their own telemetry.
set -euo pipefail
cd "$(dirname "$0")"
PROJECT="${MARBLO_BQ_PROJECT:-marblo-2253d}"
TOKEN="$(gcloud auth application-default print-access-token)"

run_one() {
  echo "===== $1 ====="
  python3 - "$TOKEN" "$PROJECT" "$(cat "$1")" <<'PY'
import json, sys, urllib.request, urllib.error
token, project, query = sys.argv[1], sys.argv[2], sys.argv[3]
req = urllib.request.Request(
    f"https://bigquery.googleapis.com/bigquery/v2/projects/{project}/queries",
    data=json.dumps({"query": query, "useLegacySql": False, "timeoutMs": 120000, "maxResults": 1000}).encode(),
    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
)
try:
    result = json.load(urllib.request.urlopen(req))
except urllib.error.HTTPError as err:
    sys.exit(f"HTTP {err.code}: {err.read().decode()[:1000]}")
print("\t".join(f["name"] for f in result.get("schema", {}).get("fields", [])))
for row in result.get("rows", []):
    print("\t".join("" if cell["v"] is None else str(cell["v"]) for cell in row["f"]))
print(f"-- rows: {result.get('totalRows')}")
PY
  echo
}

if [ $# -gt 0 ]; then for f in "$@"; do run_one "$f"; done
else for f in [0-9]*.sql; do run_one "$f"; done; fi
