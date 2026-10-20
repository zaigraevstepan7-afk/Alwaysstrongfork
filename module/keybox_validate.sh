#!/system/bin/sh
# Completeness validation only. Does NOT claim Google trust or a PI verdict.
set -eu
umask 077
V_DIR=$(cd "${0%/*}" && pwd)
. "$V_DIR/repair_runtime.sh"
[ "$#" = 1 ] && [ -s "$1" ] || { echo 'keybox: missing file' >&2; exit 1; }
V_SIZE=$(wc -c < "$1" | tr -d ' ')
[ "$V_SIZE" -le 524288 ] || { echo 'keybox: size limit exceeded' >&2; exit 1; }
V_TMP=$(mktemp -d "${TMPDIR:-/data/local/tmp}/as-keybox-check.XXXXXX")
trap 'rm -rf "$V_TMP"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
awk -v emit=1 -f "$V_DIR/keybox_validate.awk" "$1" > "$V_TMP/records" || {
  echo 'keybox: incomplete or unsupported XML/PEM' >&2; exit 1;
}
while IFS=: read -r V_KIND V_BODY; do
  printf '%s' "$V_BODY" | base64 -d > "$V_TMP/der" 2>/dev/null || {
    echo 'keybox: invalid Base64' >&2; exit 1;
  }
  # Reject truncated DER even if an XML/PEM footer was appended after truncation.
  set -- $(od -An -tu1 -N6 "$V_TMP/der")
  [ "${1:-0}" = 48 ] && [ "$#" -ge 2 ] || { echo 'keybox: invalid DER sequence' >&2; exit 1; }
  shift; V_LEN=$1; shift; V_HEAD=2
  if [ "$V_LEN" -ge 128 ]; then
    V_N=$((V_LEN - 128)); [ "$V_N" -ge 1 ] && [ "$V_N" -le 4 ] && [ "$#" -ge "$V_N" ] || exit 1
    V_LEN=0; V_HEAD=$((2 + V_N))
    while [ "$V_N" -gt 0 ]; do V_LEN=$((V_LEN * 256 + $1)); shift; V_N=$((V_N - 1)); done
  fi
  V_ACTUAL=$(wc -c < "$V_TMP/der" | tr -d ' ')
  [ "$V_ACTUAL" -eq "$((V_HEAD + V_LEN))" ] || { echo 'keybox: truncated DER object' >&2; exit 1; }
  # Where provided by the device, use the real X.509/private-key parser too.
  if command -v openssl >/dev/null 2>&1; then
    if [ "$V_KIND" = C ]; then
      openssl x509 -inform DER -in "$V_TMP/der" -noout >/dev/null 2>&1 || exit 1
    else
      openssl pkey -inform DER -in "$V_TMP/der" -noout >/dev/null 2>&1 || exit 1
    fi
  fi
done < "$V_TMP/records"
exit 0
