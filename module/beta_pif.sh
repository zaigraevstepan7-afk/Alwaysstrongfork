#!/system/bin/sh
# AlwaysStrong — beta_pif.sh
# Browse and fetch the public Pixel beta fingerprints (the canary-miner repo),
# and hand a chosen one to import_pif.sh. All networking stays in shell
# (asfetch -> busybox wget -> curl -> wget), like keybox_fetch / status_fetch.
# The WebUI calls:
#   sh beta_pif.sh list        -> one device codename per line (e.g. "oriole")
#   sh beta_pif.sh get <code>  -> download <code>.pif.prop and import it; prints
#                                 import_pif.sh's "OK" or "ERR: <reason>".
#
# The chosen beta is a complete custom.pif.prop, so import_pif.sh records it as a
# custom pif (name + brand/model shown in the WebUI / Action, auto-fetch off).

case "$0" in
    */*) MODPATH=$(cd "${0%/*}" 2>/dev/null && pwd) ;;
    *)   MODPATH="$PWD" ;;
esac
[ -z "$MODPATH" ] && MODPATH="$PWD"
[ -f "$MODPATH/as_store.sh" ] && . "$MODPATH/as_store.sh"

# The `devices` folder holds the real Android *Canary* builds (`:CANARY/ZP11.…`),
# which are the identities that actually hold STRONG. The `betas/<track>` folder
# is the QPR beta track (`:17/DP11.…`) — a different, weaker build — so the
# picker points here, matching the auto-fetch in pif_native_fetch.sh.
API="https://api.github.com/repos/Vagelis1608/get_the_canary_miner/contents/devices"
RAW="https://raw.githubusercontent.com/Vagelis1608/get_the_canary_miner/main/devices"

case "$(uname -m)" in
    aarch64)        ABI=arm64-v8a ;;
    armv7*|armv8l)  ABI=armeabi-v7a ;;
    x86_64)         ABI=x86_64 ;;
    i?86)           ABI=x86 ;;
    *)              ABI="" ;;
esac
ASFETCH=""
[ -n "$ABI" ] && [ -x "$MODPATH/bin/$ABI/asfetch" ] && ASFETCH="$MODPATH/bin/$ABI/asfetch"
BB=""
for bb in /data/adb/magisk/busybox /data/adb/ksu/bin/busybox /data/adb/ap/bin/busybox \
          /data/adb/modules/busybox-ndk/system/*/busybox; do
    [ -x "$bb" ] && BB="$bb" && break
done

# Hard wall-clock cap so a stuck download can't hang the WebUI's root call.
TO=""
if timeout -k 1 5 true >/dev/null 2>&1; then TO="timeout -k 3"
elif timeout 5 true >/dev/null 2>&1; then TO="timeout"
elif [ -n "$BB" ] && "$BB" timeout -k 1 5 true >/dev/null 2>&1; then TO="$BB timeout -k 3"
elif [ -n "$BB" ] && "$BB" timeout 5 true >/dev/null 2>&1; then TO="$BB timeout"
fi
bounded() { _b="$1"; shift; if [ -n "$TO" ]; then $TO "$_b" "$@"; else "$@"; fi; }

dl_out() {
    if [ -n "$ASFETCH" ]; then bounded 60 $ASFETCH -T 20 "$1" 2>/dev/null && return 0; fi
    if [ -n "$BB" ]; then bounded 60 $BB wget -q -T 20 -O - "$1" 2>/dev/null && return 0; fi
    if command -v curl >/dev/null 2>&1; then bounded 60 curl -fsSL --connect-timeout 15 --max-time 55 "$1" 2>/dev/null && return 0; fi
    if command -v wget >/dev/null 2>&1; then bounded 60 wget -q -T 20 -O - "$1" 2>/dev/null && return 0; fi
    return 1
}
dl_to() {
    _o="$1"; _u="$2"; rm -f "$_o"
    if [ -n "$ASFETCH" ]; then bounded 90 $ASFETCH -T 30 -o "$_o" "$_u" 2>/dev/null; [ -s "$_o" ] && return 0; fi
    if [ -n "$BB" ]; then bounded 90 $BB wget -q -T 30 -O "$_o" "$_u" 2>/dev/null; [ -s "$_o" ] && return 0; fi
    if command -v curl >/dev/null 2>&1; then bounded 90 curl -fsSL --connect-timeout 15 --max-time 85 -o "$_o" "$_u" 2>/dev/null; [ -s "$_o" ] && return 0; fi
    if command -v wget >/dev/null 2>&1; then bounded 90 wget -q -T 30 -O "$_o" "$_u" 2>/dev/null; [ -s "$_o" ] && return 0; fi
    return 1
}

case "${1:-}" in
    list)
        # GitHub contents API -> one codename per line. The names are the only
        # field we need, so pull them without a JSON parser.
        dl_out "$API" 2>/dev/null | tr ',' '\n' \
            | sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([A-Za-z0-9_]*\)\.pif\.prop".*/\1/p'
        ;;
    get)
        _code=$(printf '%s' "$2" | tr -cd 'A-Za-z0-9_')
        [ -n "$_code" ] || { echo "ERR: bad name"; exit 1; }
        if command -v as_tmp >/dev/null 2>&1; then
            _tmp=$(as_tmp "$_code.pif.prop")
        else
            _tmp="/data/local/tmp/$_code.pif.prop"
        fi
        if ! dl_to "$_tmp" "$RAW/$_code.pif.prop"; then
            echo "ERR: download failed"; rm -f "$_tmp"; exit 1
        fi
        if ! grep -q '^FINGERPRINT=' "$_tmp" 2>/dev/null; then
            echo "ERR: not a fingerprint file"; rm -f "$_tmp"; exit 1
        fi
        # import_pif.sh applies the STRONG flags, sets custom_pif / pif_name /
        # pif_model and prints OK / ERR. pif_name becomes "<code>.pif.prop".
        sh "$MODPATH/import_pif.sh" "$_tmp"
        _rc=$?
        rm -f "$_tmp"
        exit $_rc
        ;;
    *)
        echo "usage: beta_pif.sh list | get <codename>"; exit 1
        ;;
esac
