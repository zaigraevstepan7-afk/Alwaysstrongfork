#!/system/bin/sh
# Import a fresh decoded checker/backend JSON. Never executes its contents.
set -eu
umask 077
MODPATH=$(cd "${0%/*}" && pwd)
. "$MODPATH/as_store.sh"
as_init
if [ "${1:-}" = __publish ]; then
  # Called only under verdict.flock. A slower import cannot overwrite a newer
  # report that completed first. The source contains normalized fields only.
  incoming=${2:-}
  [ -s "$incoming" ] || exit 1
  new_ts=$(sed -n 's/^timestamp=//p' "$incoming" | head -1)
  old_ts=$(sed -n 's/^timestamp=//p' "$AS_DIR/verdict" 2>/dev/null | head -1)
  case "$new_ts" in ''|*[!0-9]*) exit 1 ;; esac
  case "$old_ts" in ''|*[!0-9]*) old_ts=0 ;; esac
  [ "$new_ts" -gt "$old_ts" ] || exit 2
  mv -f "$incoming" "$AS_DIR/verdict"
  exit 0
fi
case "$(uname -m)" in aarch64) abi=arm64-v8a ;; armv7*|armv8l) abi=armeabi-v7a ;; *) abi=unsupported ;; esac
fetch=${AS_VERDICT_PARSER:-$MODPATH/bin/$abi/asfetch}
file=${1:-$AS_DIR/verdict-inbox.json}
[ -s "$file" ] || exit 1
work=$(mktemp -d "$AS_TMP/verdict.XXXXXX")
trap 'rm -rf "$work"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if [ "$file" = "$AS_DIR/verdict-inbox.json" ]; then
  # Claim the existing inode first. A new inbox atomically published while we
  # parse this one remains at the original path for the next watchdog pass.
  mv -f "$file" "$work/input.json"
  file="$work/input.json"
fi
"$fetch" verdict "$file" > "$work/fields"
# Preserve only normalized fields, never full tokens or application data.
cat "$work/fields" > "$work/report"
printf 'source=external-checker-json\nimported=%s\n' "$(date +%s)" >> "$work/report"
chmod 600 "$work/report"
rc=0
as_lock_run "$AS_DIR/verdict.flock" 15000 sh "$MODPATH/verdict_report.sh" __publish "$work/report" || rc=$?
if [ "$rc" = 2 ]; then printf 'Older checker result ignored; current report kept.\n'; exit 0; fi
[ "$rc" = 0 ] || exit "$rc"
sh "$MODPATH/status_fetch.sh" >/dev/null 2>&1 || :
printf 'Checker result imported; provenance is supplied by the checker.\n'
if as_on auto_repair; then
  (sh "$MODPATH/auto_repair.sh" >"$AS_LOGS/repair-worker.log" 2>&1 < /dev/null &)
fi
