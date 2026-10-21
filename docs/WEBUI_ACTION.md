# WebUI Action architecture

The main module is assembled by `build.sh`: shared files in `module/`, a Play
Integrity adapter from `module-variants/{fork,inject,nopif}/ship/engine.sh`, and
one attestation adapter from `attest/`. Upstream PIF/TEE libraries and DEX are
packaged with the selected adapters. `native/asfetch` supplies downloads,
kernel locks and process-group deadlines; `native/watcher` observes packages.
The optional `isolation-module/` and `native/isolation/` are a separate ZIP.

`post-fs-data.sh`, `service.sh` and the boot safety/supervision helpers manage
startup. Manual refresh lives in `action.sh`: it refreshes the target list,
keybox and fingerprint, applies settings, and restarts the Play Integrity apps.
Settings, state and logs belong to `as_store.sh` under
`/data/adb/tricky_store/alwaysstrong/`. The WebUI is static HTML/CSS/JavaScript;
`ksu.exec` supplies root shell access through the installed WebUI host.

## Manual Action flow

1. The Action button calls `webui_action.sh start` through the existing bridge.
2. The native helper acquires `tmp/webui-action.flock`. Under that lock the
   wrapper initializes a private log/status pair and detaches its worker with
   stdin, stdout and stderr redirected. The worker inherits the lock descriptor.
3. The worker runs the existing Action under a 480-second native deadline and
   records stdout, stderr and its real exit code. Every Action entry, including
   manager/boot/reset entry, now shares `tmp/action.flock` to reject overlaps.
4. Short `status` requests return status plus the last 64 KiB of output. The
   JavaScript renders output with `textContent` and refreshes while running.
   Closing the dialog/WebUI leaves the worker running; reopening reads the
   saved state. When no worker owns the lock, a stale running state is marked
   interrupted. No lock file is deleted and no PID is trusted for ownership.

The complete output and exit status are saved as `logs/action-webui.log` and
`logs/action-webui.status`. A new accepted run replaces them. Duplicate starts
keep the active output. The diagnostic collector includes both files.
Bridge requests have a 10-second UI timeout; a missing reply does not claim the
background work stopped. Code 75 indicates another Action owns the global
lock; code 124 indicates the eight-minute deadline expired.

Action completion is a script result, not a Play Integrity verdict. The UI
directs the user to run an independent checker after completion.

## Verification

`tests/test_webui_action.py` exercises the actual shell wrapper and native
lock/deadline helper, with Android work replaced by deterministic shell fixtures:
live output, duplicate clicks, reconnect, failure/retry, interrupted runs,
deadline cleanup, manager/WebUI exclusion and bounded bridge output.
The existing installer tests check the WebUI assets across supported managers;
ZIP verification requires the new backend script. Device verification still
requires the installed module and a compatible root WebUI host.
