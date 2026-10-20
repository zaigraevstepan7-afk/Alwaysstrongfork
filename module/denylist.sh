#!/system/bin/sh
# Add the Google Play stack (and a few known integrity / root-checker apps) to
# Magisk's DenyList so a hider (Shamiko, or the Zygisk-Next / ReZygisk denylist)
# scrubs the module's mounts out of them. This adds LIST ENTRIES ONLY and never
# touches the "Enforce DenyList" toggle — the two are independent: Shamiko reads
# the list while enforcement stays OFF, which is the recommended setup (see the
# note in post-fs-data.sh about never forcing enforcement on). Entries are added
# per process, so the specific GMS processes that run the integrity check
# (unstable / persistent / ui / snet) are each covered.
#
# Why the enforcement guard below: with enforcement OFF the entries are exactly
# what the hider wants. But with Magisk's *built-in* Zygisk and enforcement ON,
# a denylisted process gets no Zygisk modules at all — so denylisting GMS there
# would strip PlayIntegrityFork's own injection into com.google.android.gms and
# drop STRONG. A Shamiko/Zygisk-Next setup keeps enforcement OFF by design, so
# "enforcement is ON" means the classic path where adding GMS is harmful. In
# that one case we add nothing and leave the user's list exactly as it is.
MODDIR="${0%/*}"
[ -f "$MODDIR/as_store.sh" ] && . "$MODDIR/as_store.sh"

# Opt-out: denylist_gms=0 in alwaysstrong/config (default on). No WebUI toggle —
# this runs automatically; edit the config file to turn it off.
command -v as_on >/dev/null 2>&1 && { as_on denylist_gms || exit 0; }

# Magisk only — KernelSU / APatch keep their hide list in the manager, with no
# equivalent CLI, so there is nothing to drive there. Fail quietly.
command -v magisk >/dev/null 2>&1 || exit 0

# `ls` prints the list regardless of the enforcement toggle; it fails only when
# the DenyList is unavailable (Zygisk off entirely) — bail quietly there.
have=$(magisk --denylist ls 2>/dev/null) || exit 0

# Enforcement ON -> classic built-in Zygisk path where denylisting GMS removes
# its Zygisk injection. Leave the list untouched (never disable enforcement).
if magisk --denylist status >/dev/null 2>&1; then exit 0; fi

# "<package> <process>" per line. The Play stack is listed per process so the
# integrity-running GMS processes (unstable / persistent / ui / snet) are each
# denied; the three checker apps are added so they can't see root either (a
# no-op until they are installed).
ENTRIES="com.google.android.gms com.google.android.gms
com.google.android.gms com.google.android.gms.unstable
com.google.android.gms com.google.android.gms.persistent
com.google.android.gms com.google.android.gms.ui
com.google.android.gms com.google.android.gms:snet
com.google.android.gsf com.google.android.gsf
com.android.vending com.android.vending
com.android.vending com.android.vending:background
com.google.android.gm com.google.android.gm
com.anu.developers3k.rootchecker com.anu.developers3k.rootchecker
gr.nikolasspyr.integritycheck gr.nikolasspyr.integritycheck
io.github.vvb2060.keyattestation io.github.vvb2060.keyattestation"

# Optional per-app hiding policy. The generated target list already reflects
# WebUI exclusions and keybox assignments. Never interpret its contents as
# commands; ignore section headers, UID entries and malformed package names.
# Sync main processes plus currently running package-prefixed subprocesses.
# Newly started subprocesses are picked up by the next Action/target rebuild.
extra_targets() {
    as_on denylist_targets || return 0
    [ -f "$AS_CFG_ROOT/target.txt" ] || return 0
    packages=$(awk '
        { sub(/#.*/, ""); gsub(/[[:space:]]/, "");
          sub(/[!?]$/, ""); sub(/@[0-9]+$/, "");
          if ($0 ~ /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/) print }
        ' "$AS_CFG_ROOT/target.txt" | sort -u)
    processes=$(ps -A -o NAME 2>/dev/null | grep -E '^[A-Za-z0-9_.:]+$')
    for pkg in $packages; do
        printf '%s %s\n' "$pkg" "$pkg"
        for proc in $processes; do
            case "$proc" in "$pkg":*) printf '%s %s\n' "$pkg" "$proc" ;; esac
        done
    done
}

{ printf '%s\n' "$ENTRIES"; extra_targets; } | sort -u | while IFS=' ' read -r _pkg _proc; do
    [ -n "$_pkg" ] || continue
    printf '%s\n' "$have" | grep -qxF "$_pkg|$_proc" && continue
    magisk --denylist add "$_pkg" "$_proc" >/dev/null 2>&1 || \
        echo "DenyList entry not added: $_pkg $_proc"
done

# List management alone does not hide anything. A compatible external hider
# must consume the list with enforcement off; never claim universal concealment.
command -v log >/dev/null 2>&1 && \
    log -t "AlwaysStrong" "DenyList entries synced (enforcement left as-is)"
exit 0
