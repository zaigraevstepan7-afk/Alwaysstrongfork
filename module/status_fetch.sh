#!/system/bin/sh
# Local status only. A saved checker verdict is explicitly marked as imported.
MODPATH="${MODPATH:-${0%/*}}"
. "$MODPATH/as_store.sh"
as_init
health=$(sh "$MODPATH/keybox_manage.sh" health 2>/dev/null)
case "$health" in complete) msg="Keybox file complete" ;; missing) msg="Keybox missing" ;; *) msg="Keybox invalid" ;; esac
verdict="$AS_DIR/verdict"
ts=$(sed -n 's/^timestamp=//p' "$verdict" 2>/dev/null | head -1)
case "$ts" in ''|*[!0-9]*) ts=0 ;; esac
now=$(date +%s)
if [ "$ts" -gt 0 ] && [ "$ts" -le "$((now + 60))" ] && [ "$((now-ts))" -le 86400 ]; then
  count=$(grep -cE '^(basic|device|strong)=1$' "$verdict" 2>/dev/null)
  stamp=$(date -u -d "@$ts" "+%m-%d %H:%MZ" 2>/dev/null || echo "$ts")
  msg="$msg; PI $count/3 (imported $stamp)"
else
  msg="$msg; device verdict unknown"
fi
if ! as_on status_indicator; then msg='Validated keybox updates and local recovery'; fi
prop="$MODPATH/module.prop"
[ -f "$prop" ] || exit 1
tmp=$(mktemp "$MODPATH/.status.XXXXXX") || exit 1
trap 'rm -f "$tmp"' EXIT
awk -v text="description=$msg. AlwaysStrong Repair." '
  /^description=/ { print text; next } { print }
' "$prop" > "$tmp" && chmod 644 "$tmp" && mv -f "$tmp" "$prop"
