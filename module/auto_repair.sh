#!/system/bin/sh
# Repair broken local files; refresh on a newly imported failing checker result.
# At most one network attempt per result and one attempt every six hours.
set -eu
umask 077
MODPATH=$(cd "${0%/*}" && pwd)
export MODPATH
. "$MODPATH/as_store.sh"
as_init
# Serialise local recovery and the verdict/cooldown decision. Native flock
# releases after crashes without ever deleting a live worker's lock.
if [ "${1:-}" != __locked ]; then
  rc=0
  as_lock_run "$AS_TMP/repair.flock" 0 sh "$MODPATH/auto_repair.sh" __locked || rc=$?
  [ "$rc" != 75 ] || exit 0
  exit "$rc"
fi
[ ! -f "$AS_DIR/keybox-removed" ] || exit 0
before=$(sh "$MODPATH/keybox_manage.sh" health)
if [ "$before" != complete ]; then
  if sh "$MODPATH/keybox_manage.sh" recover >/dev/null 2>&1; then
    st_set repair_status local-copy-restored
    if as_live_config; then killall com.google.android.gms.unstable 2>/dev/null || :; fi
  else
    st_set repair_status no-complete-local-copy
  fi
fi
as_on auto_repair || exit 0
report="$AS_DIR/verdict"
[ -s "$report" ] || exit 0
# Read one atomic snapshot, rather than mixing fields from two imports.
fields=$(cat "$report")
value() { printf '%s\n' "$fields" | sed -n "s/^$1=//p" | head -1; }
ts=$(value timestamp)
case "$ts" in ''|*[!0-9]*) exit 0 ;; esac
now=$(date +%s)
[ "$ts" -le "$((now + 60))" ] && [ "$((now - ts))" -le 900 ] || exit 0
if [ "$(value basic)$(value device)$(value strong)" = 111 ]; then
  st_set repair_status checker-reports-three
  exit 0
fi
[ "$(st_get repair_verdict)" != "$ts" ] || exit 0
last=$(st_get repair_attempt)
case "$last" in ''|*[!0-9]*) last=0 ;; esac
if [ "$last" -gt 0 ] && [ "$((now - last))" -lt 21600 ]; then
  st_set repair_status cooling-down
  exit 0
fi
st_set repair_attempt "$now"
st_set repair_verdict "$ts"
st_set repair_status downloading
rc=0
AS_REPAIR_FETCH=1 sh "$MODPATH/keybox_fetch.sh" > "$AS_LOGS/repair.log" 2>&1 || rc=$?
case "$rc" in
  0) st_set repair_status updated-check-again
     if as_live_config; then killall com.google.android.gms.unstable 2>/dev/null || :; fi ;;
  2) st_set repair_status unchanged-check-again ;;
  *) st_set repair_status download-failed-current-kept ;;
esac
