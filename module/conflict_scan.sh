#!/system/bin/sh
# Scan installed modules for known conflicts without changing them.
# Called on boot (service.sh),
# because users do install conflicting modules after AlwaysStrong is already
# in place, and the symptoms (TEE getting hooked twice, target.txt fights,
# zygisk double-hooks) look like AlwaysStrong is broken.
#
# Report only. Installation asks the user to resolve an active conflict.
PIF_CONFLICTS='
playintegrityfix
playintegrityfork
play_integrity_fix
playcurl
playcurlNEXT
pif_strong
pif_force
'

# Keystore / TEE / target-list / global-prop modules. These fight the attestation
# engine (they hook keystore2 or rewrite the same target list / props) on EVERY
# line, Lite included, so they are always reported.
CONFLICTS='
tricky_store_v2
TrickyStore
tee_simulator
TEESimulator
TEESimulator-RS
safetynet-fix
Universal_SafetyNet_Fix
MagiskHidePropsConf
TA_utl
tricky_addon
TA_enhanced
tsupport-advance
Yurikey
specter
'

MODPATH="${MODPATH:-/data/adb/modules/tricky_store}"

# The Lite line (ENGINE=none) bundles no PIF, so a standalone Build-spoof module
# is a wanted companion, not a conflict — only fold the PIF family into the conflict
# list on the Fork/inject lines that DO bundle their own.
ENGINE=none
[ -f "$MODPATH/engine.sh" ] && . "$MODPATH/engine.sh" 2>/dev/null
[ "${ENGINE:-none}" != "none" ] && CONFLICTS="$CONFLICTS
$PIF_CONFLICTS"
LOG=${1:-/dev/null}
SELF_BASENAME=$(basename "$MODPATH")
removed=0

for c in $CONFLICTS; do
    [ "$c" = "$SELF_BASENAME" ] && continue
    d="/data/adb/modules/$c"
    [ -d "$d" ] || continue

    [ -f "$d/disable" ] && continue
    [ -f "$d/remove" ] && continue
    removed=$((removed + 1))
    echo "conflicting module detected (unchanged): $c" >> "$LOG" 2>/dev/null

done

# Shared-id special case: a full keystore/attestation toolkit (author MeowDump)
# ships under the SAME module id as osm0sis PlayIntegrityFork (playintegrityfix).
# The Lite line keeps playintegrityfix for the plain Build-spoof Fork, but that
# toolkit fights the engine, so report that one on every line. It is told apart by
# its module.prop: the real Fork says osm0sis/PlayIntegrityFork with no webuiIcon,
# the toolkit carries a MeowDump author or a webuiIcon field.
_ib=/data/adb/modules/playintegrityfix
if [ -d "$_ib" ] && [ "$SELF_BASENAME" != playintegrityfix ] \
   && grep -qiE 'MeowDump|webuiIcon|ntegrity.?[Bb]ox' "$_ib/module.prop" 2>/dev/null; then
    removed=$((removed + 1))
    echo "conflicting keystore module detected (unchanged): playintegrityfix" >> "$LOG" 2>/dev/null

fi

# Tell the caller how many we found, so service.sh can decide whether to log.
exit $removed
