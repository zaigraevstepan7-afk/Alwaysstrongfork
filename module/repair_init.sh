#!/system/bin/sh
set -eu
umask 077
MODPATH=$(cd "${0%/*}" && pwd)
. "$MODPATH/as_store.sh"
as_init
if [ "${1:-}" = reset-spoof ] || [ "$(st_get repair_version)" != 1 ]; then
  if [ "${1:-}" != reset-spoof ]; then
    [ ! -f "$AS_CONF" ] || cp -p "$AS_CONF" "$AS_DIR/config.before-repair1"
    [ ! -f "$AS_SPOOF" ] || cp -p "$AS_SPOOF" "$AS_DIR/spoof.before-repair1"
  fi
  tmp=$(mktemp "$AS_DIR/.spoof.XXXXXX")
  trap 'rm -f "$tmp"' EXIT
  if [ -f "$AS_SPOOF" ]; then
    awk '!/^[[:space:]]*(spoofProvider|spoofSignature|spoofVendingSdk)[[:space:]]*=/' "$AS_SPOOF" > "$tmp"
  fi
  if grep -q '^ENGINE=inject' "$MODPATH/engine.sh"; then off=false; else off=0; fi
  printf '%s\n' "spoofProvider=$off" "spoofSignature=$off" "spoofVendingSdk=$off" >> "$tmp"
  chmod 600 "$tmp"; mv -f "$tmp" "$AS_SPOOF"
  as_set logcat_cleanup 0
  st_set repair_version 1
fi
# Remove only the diagnostic-suppression properties written by this module.
if command -v resetprop >/dev/null 2>&1 && ! as_on logcat_cleanup; then
  for tag in AlwaysStrong AlwaysStrong-boot AlwaysStrong-hourly AlwaysStrong-unify AlwaysStrong-proc AlwaysStrong-keybox; do
    prop="persist.log.tag.$tag"
    [ "$(getprop "$prop" 2>/dev/null)" != S ] || resetprop -p --delete "$prop" 2>/dev/null || :
  done
fi
