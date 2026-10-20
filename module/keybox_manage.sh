#!/system/bin/sh
# One writer for download, import and recovery. All replacements are atomic.
set -eu
umask 077
MODPATH=$(cd "${0%/*}" && pwd)
CONFIG_DIR=${AS_CFG_ROOT:-/data/adb/tricky_store}
export AS_CFG_ROOT="$CONFIG_DIR"
. "$MODPATH/as_store.sh"
as_init
KB_TARGET="$CONFIG_DIR/keybox.xml"
KB_WORK=''
kb_valid() { TMPDIR="$AS_TMP" sh "$MODPATH/keybox_validate.sh" "$1" >/dev/null 2>&1; }
kb_cleanup() {
  [ -z "$KB_WORK" ] || rm -rf "$KB_WORK"
}
trap kb_cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
kb_replace() {
  cp "$1" "$KB_WORK/keybox.xml" || return 1
  kb_valid "$KB_WORK/keybox.xml" || { echo 'keybox: replacement rejected; current file kept' >&2; return 1; }
  if [ -s "$KB_TARGET" ] && cmp -s "$KB_WORK/keybox.xml" "$KB_TARGET"; then
    if ! kb_valid "$CONFIG_DIR/keybox.xml.good"; then
      cp "$KB_WORK/keybox.xml" "$KB_WORK/good.xml" || return 1
      chmod 600 "$KB_WORK/good.xml" || return 1
      mv -f "$KB_WORK/good.xml" "$CONFIG_DIR/keybox.xml.good" || return 1
    fi
    return 2
  fi
  if kb_valid "$KB_TARGET"; then
    cp "$KB_TARGET" "$KB_WORK/good.xml" || return 1
    chmod 600 "$KB_WORK/good.xml" || return 1
    mv -f "$KB_WORK/good.xml" "$CONFIG_DIR/keybox.xml.good" || return 1
  elif [ -s "$KB_TARGET" ]; then
    cp "$KB_TARGET" "$CONFIG_DIR/keybox.xml.rejected" || return 1
    chmod 600 "$CONFIG_DIR/keybox.xml.rejected" || return 1
  fi
  chmod 600 "$KB_WORK/keybox.xml" || return 1
  mv -f "$KB_WORK/keybox.xml" "$KB_TARGET" || return 1
  if ! kb_valid "$CONFIG_DIR/keybox.xml.good"; then
    cp "$KB_TARGET" "$KB_WORK/good.xml"
    mv -f "$KB_WORK/good.xml" "$CONFIG_DIR/keybox.xml.good"
  fi
  return 0
}
# Only mutating commands need the lock. The descriptor is inherited by this
# re-entered writer, so killing its supervising process cannot unlock it early.
if [ "${1:-}" = __locked ]; then
  shift
  KB_WORK=$(mktemp -d "$AS_TMP/keybox-write.XXXXXX")
else
  case "${1:-health}" in
    health|check) ;;
    *) KB_RC=0
       as_lock_run "$AS_TMP/keybox.flock" 0 sh "$MODPATH/keybox_manage.sh" __locked "$@" || KB_RC=$?
       if [ "$KB_RC" = 75 ]; then echo 'keybox: another writer is busy' >&2; exit 1; fi
       exit "$KB_RC" ;;
  esac
fi
KB_CMD=${1:-health}
case "$KB_CMD" in
  health)
    if [ ! -s "$KB_TARGET" ]; then echo missing
    elif kb_valid "$KB_TARGET"; then echo complete
    else echo invalid; fi ;;
  check) kb_valid "${2:-$KB_TARGET}" ;;
  clear)
    if kb_valid "$KB_TARGET"; then
      cp "$KB_TARGET" "$KB_WORK/good.xml"
      mv -f "$KB_WORK/good.xml" "$CONFIG_DIR/keybox.xml.good"
    fi
    touch "$AS_DIR/keybox-removed"
    rm -f "$KB_TARGET"
    st_del keybox_name ;;
  import)
    KB_SOURCE=${2:-}; KB_NAME=${3:-}
    case "$KB_NAME" in ''|.*|keybox.xml|*[!A-Za-z0-9_.-]*) exit 1 ;; esac
    [ "${KB_NAME%.xml}" != "$KB_NAME" ] || exit 1
    cp "$KB_SOURCE" "$KB_WORK/import.xml"
    kb_valid "$KB_WORK/import.xml" || { echo 'keybox: import rejected' >&2; exit 1; }
    chmod 600 "$KB_WORK/import.xml"
    mv -f "$KB_WORK/import.xml" "$CONFIG_DIR/$KB_NAME" ;;
  install)
    KB_SOURCE=${2:-}; KB_MODE=${3:-auto}; KB_NAME=${4:-keybox.xml}
    [ -s "$KB_SOURCE" ] || exit 1
    case "$KB_MODE" in auto|custom) ;; *) exit 1 ;; esac
    # Recheck after lock acquisition: a user can enable custom mode mid-download.
    if [ "$KB_MODE" = auto ] && as_on custom_keybox; then exit 2; fi
    KB_RC=0; kb_replace "$KB_SOURCE" || KB_RC=$?
    [ "$KB_RC" -eq 0 ] || [ "$KB_RC" -eq 2 ] || exit "$KB_RC"
    if [ "$KB_MODE" = custom ]; then as_set custom_keybox 1; as_set auto_keybox 0; fi
    rm -f "$AS_DIR/keybox-removed"
    st_set keybox_name "$KB_NAME"
    exit "$KB_RC" ;;
  recover)
    [ ! -f "$AS_DIR/keybox-removed" ] || exit 2
    if kb_valid "$KB_TARGET"; then
      if ! kb_valid "$CONFIG_DIR/keybox.xml.good"; then
        cp "$KB_TARGET" "$KB_WORK/good.xml"; mv -f "$KB_WORK/good.xml" "$CONFIG_DIR/keybox.xml.good"
      fi
      exit 0
    fi
    for KB_CANDIDATE in "$CONFIG_DIR/keybox.xml.good" "$CONFIG_DIR/keybox.xml.bak" "$CONFIG_DIR/keybox.xml.bak.1"; do
      if kb_valid "$KB_CANDIDATE"; then
        kb_replace "$KB_CANDIDATE"
        st_set keybox_name "recovered-${KB_CANDIDATE##*/}"
        echo 'keybox: recovered a structurally complete local copy'
        exit 0
      fi
    done
    echo 'keybox: no complete local copy; import or fetch a valid file' >&2
    exit 1 ;;
  *) echo 'usage: keybox_manage.sh health|check [FILE]|install FILE auto|custom [NAME]|recover' >&2; exit 1 ;;
esac
