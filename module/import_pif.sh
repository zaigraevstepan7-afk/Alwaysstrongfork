#!/system/bin/sh
# Import a user-supplied fingerprint into the active engine.
#
# Accepts either a pif.prop (KEY=VALUE lines) or a pif.json (flat JSON object,
# the format PlayIntegrityFix / PlayIntegrityFork ship). JSON is converted to
# KEY=VALUE prop lines, then handed to the engine adapter so it lands in the
# exact file this build's zygisk reads (pif.prop for inject-s, custom.pif.prop
# for Fork via migrate.sh) with the STRONG spoof flags applied.
#
# Usage:  sh import_pif.sh /path/to/pif.json
# Prints "OK" and exits 0 on success; prints "ERR: <reason>" and exits 1 otherwise.

case "$0" in
    */*) MODPATH=$(cd "${0%/*}" 2>/dev/null && pwd) ;;
    *)   MODPATH="$PWD" ;;
esac
[ -z "$MODPATH" ] && MODPATH="$PWD"
CONFIG_DIR=/data/adb/tricky_store
[ -f "$MODPATH/as_store.sh" ] && . "$MODPATH/as_store.sh"
export MODPATH CONFIG_DIR

SRC="$1"
[ -s "$SRC" ] || { echo "ERR: file missing or empty"; exit 1; }
[ -f "$MODPATH/engine.sh" ] || { echo "ERR: engine.sh missing — reflash module"; exit 1; }
. "$MODPATH/engine.sh"

mkdir -p "$CONFIG_DIR"
TMP=$(as_tmp import.pif.prop)

# JSON if the first non-space byte is '{', else treat as a prop file.
FIRST=$(head -c 256 "$SRC" 2>/dev/null | tr -d ' \t\r\n' | cut -c1)
if [ "$FIRST" = "{" ]; then
    : > "$TMP"
    # "KEY":"value"  (string values, incl. FINGERPRINT / *.security_patch)
    grep -oE '"[A-Za-z0-9_.*]+"[[:space:]]*:[[:space:]]*"[^"]*"' "$SRC" | \
    while IFS= read -r pair; do
        k=$(printf '%s' "$pair" | sed -E 's/^"([^"]+)".*/\1/')
        v=$(printf '%s' "$pair" | sed -E 's/^"[^"]+"[[:space:]]*:[[:space:]]*"(.*)"$/\1/')
        printf '%s=%s\n' "$k" "$v"
    done >> "$TMP"
    # "KEY": <number|true|false>  (e.g. DEVICE_INITIAL_SDK_INT, spoofBuild)
    grep -oE '"[A-Za-z0-9_.*]+"[[:space:]]*:[[:space:]]*(true|false|[0-9]+)' "$SRC" | \
    while IFS= read -r pair; do
        k=$(printf '%s' "$pair" | sed -E 's/^"([^"]+)".*/\1/')
        v=$(printf '%s' "$pair" | sed -E 's/.*:[[:space:]]*//')
        printf '%s=%s\n' "$k" "$v"
    done >> "$TMP"
else
    cp -f "$SRC" "$TMP" 2>/dev/null
fi

if ! grep -q '^FINGERPRINT=google/' "$TMP" 2>/dev/null && \
   ! grep -q '^FINGERPRINT=' "$TMP" 2>/dev/null; then
    echo "ERR: no FINGERPRINT found in file"
    rm -f "$TMP"
    exit 1
fi

if engine_install_pif "$TMP"; then
    # An imported fingerprint is a custom pif, the fingerprint counterpart of a
    # custom keybox: turn the auto fingerprint refresh OFF so the next boot /
    # hourly / Action pass does not fetch over it, and remember the file name so
    # the WebUI and the Action screen can show which pif is loaded.
    if command -v as_set >/dev/null 2>&1; then
        as_set custom_pif 1
        as_set auto_fp 0
        st_set pif_name "${SRC##*/}"
        # The pif's own device identity (brand + model), shown next to the file
        # name in the WebUI and the Action — e.g. "Google Pixel 6a". MODEL keeps
        # its spaces, so grep/cut rather than word-splitting.
        _man=$(grep -m1 '^MANUFACTURER=' "$TMP" 2>/dev/null | cut -d= -f2- | tr -d '"\r')
        _mdl=$(grep -m1 '^MODEL=' "$TMP" 2>/dev/null | cut -d= -f2- | tr -d '"\r')
        case "$_mdl" in "$_man "*|"$_man") _dev="$_mdl" ;; *) _dev="$_man $_mdl" ;; esac
        _dev=$(echo "$_dev" | sed 's/^ *//;s/ *$//')
        [ -n "$_dev" ] && st_set pif_model "$_dev" || st_del pif_model
    fi
    # Drop the previous auto-fetch copy: it names a different device + patch, and
    # leaving it behind would let a stale fingerprint resurface (e.g. in the RS
    # attestation's /data/adb/pif.prop). The engine's own custom.pif.prop / pif.prop
    # in the module dir is the active one from here on.
    rm -f "$CONFIG_DIR/pif.prop" 2>/dev/null
    [ -f "$MODPATH/sync_patch.sh" ] && sh "$MODPATH/sync_patch.sh" >/dev/null 2>&1
    # On the teesim keystore engine the attested identity is baked into
    # /data/adb/teesim/config.json — regenerate it from the just-imported
    # fingerprint, or TEESimulator keeps attesting the OLD brand/model/patch and
    # Build(new) != attest(old) drops the verdict below STRONG. No-op on the other
    # engines (teesim_gen_config is undefined there). Mirrors lite_pif_sync.sh.
    if [ -f "$MODPATH/attest.sh" ]; then
        . "$MODPATH/attest.sh"
        command -v teesim_gen_config >/dev/null 2>&1 && teesim_gen_config
    fi
    killall -9 com.google.android.gms.unstable 2>/dev/null
    killall -9 com.android.vending 2>/dev/null
    rm -f "$TMP"
    echo "OK"
    exit 0
fi

echo "ERR: engine rejected the fingerprint"
rm -f "$TMP"
exit 1
