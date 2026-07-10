#!/usr/bin/env bash
set -euo pipefail

# 使用方式：
#   bash tests/site-smoke.sh http://127.0.0.1:4173/
#   bash tests/site-smoke.sh https://example.github.io/project/ <commit-sha>
#
# 複雜度：固定檢查 4 個資源，時間／空間皆為 O(1)（不含網路等待）。
# 替代方案比較：完整瀏覽器 E2E 能驗證互動但成本較高；此 smoke test 先以 HTTP
# 與部署 SHA 驗證「正確版本真的上線」，適合每次 Pages 部署後執行。

BASE_URL="${1:?請提供網站根網址}"
EXPECTED_SHA="${2:-}"
MAX_ATTEMPTS="${SMOKE_MAX_ATTEMPTS:-18}"
SLEEP_SECONDS="${SMOKE_SLEEP_SECONDS:-5}"

BASE_URL="${BASE_URL%/}/"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

fetch_with_retry() {
  local path="$1"
  local output="$2"
  local attempt
  local url

  for ((attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1)); do
    url="${BASE_URL}${path}?smoke=${EXPECTED_SHA:-local}-${attempt}"
    if curl --fail --silent --show-error --location \
      --connect-timeout 10 --max-time 25 \
      -H 'Cache-Control: no-cache' \
      "$url" > "$output"; then
      if [[ -s "$output" ]]; then
        return 0
      fi
    fi

    if (( attempt < MAX_ATTEMPTS )); then
      sleep "$SLEEP_SECONDS"
    fi
  done

  echo "Smoke test failed to fetch: ${BASE_URL}${path}" >&2
  return 1
}

INDEX_FILE="$TEMP_DIR/index.html"
SERVICES_FILE="$TEMP_DIR/services.html"
BOOKING_FILE="$TEMP_DIR/booking-verified.js"
DEPLOY_INFO_FILE="$TEMP_DIR/deploy-info.json"

fetch_with_retry "index.html" "$INDEX_FILE"
grep -Fq '<title>Evan Tarot｜塔羅占卜、文章與實驗室</title>' "$INDEX_FILE"
grep -Fq 'href="services.html"' "$INDEX_FILE"
grep -Fq 'href="lab.html"' "$INDEX_FILE"

fetch_with_retry "services.html" "$SERVICES_FILE"
grep -Fq 'id="booking-form"' "$SERVICES_FILE"
grep -Fq 'JS/booking-verified.js' "$SERVICES_FILE"

fetch_with_retry "JS/booking-verified.js" "$BOOKING_FILE"
grep -Fq 'bookingId' "$BOOKING_FILE"
grep -Fq 'handleVerifiedBooking' "$BOOKING_FILE"

if [[ -n "$EXPECTED_SHA" ]]; then
  fetch_with_retry "deploy-info.json" "$DEPLOY_INFO_FILE"

  python3 - "$DEPLOY_INFO_FILE" "$EXPECTED_SHA" <<'PY'
import json
import sys

path, expected = sys.argv[1], sys.argv[2]
with open(path, "r", encoding="utf-8") as handle:
    payload = json.load(handle)
actual = str(payload.get("sha", "")).strip()
if actual != expected:
    raise SystemExit(f"deployed SHA mismatch: expected {expected}, got {actual or '<empty>'}")
PY
fi

echo "Site smoke test passed: ${BASE_URL}"
