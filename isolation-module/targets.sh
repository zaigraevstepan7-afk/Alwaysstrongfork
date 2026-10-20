#!/system/bin/sh
set -eu
umask 077
MODDIR=$(cd "${0%/*}" && pwd)
case "${1:-get}" in
    get) cat "$MODDIR/targets.list" ;;
    fonts-get) printf '0\n' ;;
    fonts-set)
        case "${2:-}" in 0) printf '%s\n' "$2" > "$MODDIR/private-fonts" ;; *) exit 1 ;; esac
        ;;
    set)
        value=${2:-}
        [ "${#value}" -le 8192 ] || exit 1
        # Reject the entire edit on invalid input; never partially replace it.
        printf '%s\n' "$value" | awk '
            /^[[:space:]]*($|#)/ { next }
            !/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/ { exit 1 }
        ' || exit 1
        tmp=$(mktemp "$MODDIR/targets.list.XXXXXX")
        trap 'rm -f "$tmp"' EXIT INT TERM
        printf '%s\n' "$value" > "$tmp"
        chmod 600 "$tmp"
        mv -f "$tmp" "$MODDIR/targets.list"
        ;;
    *) exit 2 ;;
esac
