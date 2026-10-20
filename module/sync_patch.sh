#!/system/bin/sh
# AlwaysStrong — keep the security patch level consistent across:
#   1. /data/adb/tricky_store/security_patch.txt  — the patch level TEESimulator
#      stamps into the keystore hardware attestation. If this is missing or
#      stale the verdict drops to DEVICE even with a good keybox.
#   2. ro.build.version.security_patch system props — what Build.VERSION and
#      most app-side patch checks read.
#
# Source of truth: the SECURITY_PATCH=YYYY-MM-DD line from the active pif file
# (produced by autopif4). Falls back to the live system prop if no pif yet.
#
# Usage:
#   sh sync_patch.sh         # write security_patch.txt only (install / action)
#   sh sync_patch.sh boot    # also resetprop the system props (post-fs-data)

case "$0" in
    */*) MODPATH=$(cd "${0%/*}" 2>/dev/null && pwd) ;;
    *)   MODPATH="$PWD" ;;
esac
[ -z "$MODPATH" ] && MODPATH="$PWD"
CONFIG_DIR=/data/adb/tricky_store
[ -f "$MODPATH/as_store.sh" ] && . "$MODPATH/as_store.sh"
MODE="${1:-}"

# --- find the dotted patch (YYYY-MM-DD) from a pif file -------------------
# The engine's ACTIVE pif lives in the module dir ($MODPATH): engine_install_pif
# writes custom.pif.prop (Fork) / pif.prop (inject-s) there for every source —
# auto-fetch, beta pick and Import alike. The $CONFIG_DIR copies are secondary:
# $CONFIG_DIR/pif.prop is only the last *auto-fetch* written by pif_native_fetch,
# so after an Import / beta pick it is STALE (a different device + patch) and must
# NOT win, or the attested patch (and the RS /data/adb/pif.prop below) would come
# from the old auto-fetch instead of the imported fingerprint. Module dir first.
SP=""
SRC=""
for f in "$MODPATH/custom.pif.prop" "$MODPATH/pif.prop" \
         "$CONFIG_DIR/custom.pif.prop" "$CONFIG_DIR/pif.prop"; do
    [ -s "$f" ] || continue
    SP=$(grep -m1 '^SECURITY_PATCH=' "$f" | cut -d= -f2- | tr -d ' "'\''\r')
    [ -n "$SP" ] && { SRC="$f"; break; }
done

# Feed TEESimulator's PatchLevelManager its expected PIF prop at the global
# path it watches (/data/adb/pif.prop). It auto-derives the attestation patch
# level + resetprops ro.build.version.security_patch from this file, keeping
# the keystore attestation in lock-step with the Build/* fingerprint PIF
# spoofs. (The module-folder path it also checks no longer exists by design.)
# Only TEESimulator-RS's PatchLevelManager reads this global path. On the
# TrickyStoreOSS / TEESimulator(JingMatrix) engines it would just be a stray,
# world-readable copy of the spoofed pif, so write it only when RS is active —
# and clear any stale copy left from a previous engine.
if grep -q '^ATTEST=tee$' "$MODPATH/attest.sh" 2>/dev/null; then
    if [ -n "$SRC" ] && [ "$SRC" != "/data/adb/pif.prop" ]; then
        cp -f "$SRC" /data/adb/pif.prop 2>/dev/null && chmod 644 /data/adb/pif.prop 2>/dev/null
    fi
else
    rm -f /data/adb/pif.prop 2>/dev/null
fi
# fall back to whatever the device already reports
[ -z "$SP" ] && SP=$(getprop ro.build.version.security_patch 2>/dev/null)
[ -z "$SP" ] && exit 1

# normalise: RAW = 8 digits, DOT = YYYY-MM-DD, PACKED = YYYYMMDD
RAW=$(echo "$SP" | tr -cd '0-9')
[ ${#RAW} -ne 8 ] && exit 1
PACKED="$RAW"
DOT="$(echo "$RAW" | cut -c1-4)-$(echo "$RAW" | cut -c5-6)-$(echo "$RAW" | cut -c7-8)"

# The attested patch is the ACTIVE FINGERPRINT's own SECURITY_PATCH (DOT, read
# from the pif above). It is NOT bumped to the current month — a Pixel
# fingerprint claims a specific patch, and pushing past it makes the props and
# the attestation disagree and drops STRONG. Per-partition manual overrides from
# the WebUI (System / Vendor / Boot, empty = the fingerprint date) sit on top.
SYS="$DOT"; VEN="$DOT"; BOOT="$DOT"
MAN_SYS=""; MAN_VEN=""; MAN_BOOT=""
if [ -f "$MODPATH/patch_resolve.sh" ]; then
    . "$MODPATH/patch_resolve.sh"
    if command -v as_get >/dev/null 2>&1; then
        MAN_SYS=$(as_get patch_system); MAN_VEN=$(as_get patch_vendor); MAN_BOOT=$(as_get patch_boot)
    fi
    SYS=$(pr_partition "$MAN_SYS" "$DOT")
    VEN=$(pr_partition "$MAN_VEN" "$DOT")
    BOOT=$(pr_partition "$MAN_BOOT" "$DOT")
fi

mkdir -p "$CONFIG_DIR"

# --- 1. TEE attestation patch level (TrickyStore / TEESimulator-RS) --------
# TrickyStore's security_patch.txt accepts per-partition keys (system/boot/vendor,
# dotted). Written per-partition so a manual override for one lands exactly; with
# no override all three carry the single auto date.
printf 'system=%s\nvendor=%s\nboot=%s\n' "$SYS" "$VEN" "$BOOT" > "$CONFIG_DIR/security_patch.txt"

# --- 2. PIF wildcard prop: spoof ro.build/ro.vendor/ro.system .security_patch
# A single `*.security_patch=<date>` line makes PIF's zygisk hook report the
# patch to every app (this is what GMS / Play Integrity reads). It is one value,
# so use the system date.
for pf in "$MODPATH/custom.pif.prop" "$CONFIG_DIR/custom.pif.prop"; do
    [ -f "$pf" ] || continue
    if grep -qE '^[#]?\*\.security_patch=' "$pf"; then
        sed -i "s|^[#]\?\*\.security_patch=.*|*.security_patch=$SYS|" "$pf"
    else
        printf '*.security_patch=%s\n' "$SYS" >> "$pf"
    fi
done

# --- 3. real system props (boot only — needs resetprop) -------------------
# What every app that PIF does NOT hook reads: Build.VERSION.SECURITY_PATCH,
# getprop. Banking apps and attestation checkers compare that against the
# osPatchLevel in the hardware attestation (security_patch.txt above). They must
# be EQUAL, so the props are set to exactly the attested date — the fingerprint's
# own SECURITY_PATCH (or the manual override). This is set verbatim, including
# when it is OLDER than the device's real patch: a Pixel fingerprint attests a
# specific date, and the prop has to match it, not the device's real OTA level,
# or the two disagree and STRONG drops. Opt-out for users who want Settings to
# show the untouched date: spoof_patch_props=0 in alwaysstrong/config.
_wp() {   # _wp PROP VALUE — set the prop to VALUE exactly (the attested date)
    _p="$1"; _v="$2"
    cur=$(resetprop "$_p" 2>/dev/null)
    [ -n "$cur" ] || return 0
    [ "$cur" = "$_v" ] || resetprop -n "$_p" "$_v"
}
if [ "$MODE" = "boot" ] && as_on spoof_patch_props && \
   command -v resetprop >/dev/null 2>&1; then
    _wp ro.build.version.security_patch        "$SYS"
    _wp ro.vendor.build.security_patch         "$VEN"
    _wp ro.system.build.version.security_patch "$SYS"
fi

echo "$DOT"
