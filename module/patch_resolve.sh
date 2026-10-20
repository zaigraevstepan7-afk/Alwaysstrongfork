#!/system/bin/sh
# AlwaysStrong — patch_resolve.sh
# Helpers for the security-patch date. The attested patch is the ACTIVE
# FINGERPRINT's own SECURITY_PATCH (what the pif.prop claims) — it is NOT bumped
# to the current month: a Pixel fingerprint attests a specific patch, and pushing
# the props/attestation past that date makes the two disagree and drops STRONG.
# sync_patch.sh / teesim read SECURITY_PATCH from the pif and apply it as-is; the
# WebUI's optional manual System/Vendor/Boot fields override per partition.
#
# Source it, then:
#   . "$MODPATH/patch_resolve.sh"
#   SYS=$(pr_partition "$(as_get patch_system)" "$FINGERPRINT_PATCH")

# Normalise to dotted YYYY-MM-DD. Accepts YYYY-MM-DD / YYYYMMDD (8 digits) and
# YYYYMM / YYYY-MM (6 digits -> day 05, the Pixel convention). Empty otherwise.
pr_dot() {
    _raw=$(printf '%s' "$1" | tr -cd '0-9')
    case ${#_raw} in
        8) printf '%s-%s-%s' \
               "$(printf '%s' "$_raw" | cut -c1-4)" \
               "$(printf '%s' "$_raw" | cut -c5-6)" \
               "$(printf '%s' "$_raw" | cut -c7-8)" ;;
        6) printf '%s-%s-05' \
               "$(printf '%s' "$_raw" | cut -c1-4)" \
               "$(printf '%s' "$_raw" | cut -c5-6)" ;;
        *) return 0 ;;
    esac
}

# Per-partition value: a valid manual override ($1) wins; otherwise the auto
# value ($2, the fingerprint's SECURITY_PATCH). Empty/invalid manual = auto.
pr_partition() {
    _mm=$(pr_dot "$1")
    [ -n "$_mm" ] && printf '%s' "$_mm" || printf '%s' "$2"
}
