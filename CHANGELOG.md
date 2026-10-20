# AlwaysStrong changelog

## AlwaysStrongFork v1.0.5-repair.1.4.2

- Remove unsafe native font-memory replacement from the optional Isolation companion; old enable flags cannot restore it.
- Keep Isolation inactive until boot completion plus a 120-second settle period; validate current-boot readiness and disable/remove markers.
- Bound the complete native IPC exchange with one monotonic deadline; reject blocking/nonregular config inputs and SDK sandbox/child-zygote processes.
- Persist the TEE launch budget across supervisor crashes within a boot; use monotonic uptime, bound every pre-launch keybox check, and handle corrupted boot counters conservatively.
- Stop nested workers on caller loss, and stop the deadline helper from blocking in `wait()` after a timeout when a killed worker remains in kernel I/O.
- Serialize target-list rebuilds, bound PackageManager work, publish unique temporary files atomically and remove the watcher's in-place target truncation. Reject unsafe imported-file cleanup paths.
- Rebuild both ARM helpers from source in release CI. Run 64 Python + 6 Rust tests, including 10 new regression cases; cross-compile and validate all four ZIPs.
- This is a source audit and build-verified stability update. No physical Android boot test was performed; third-party TEE/PIF binaries and provider internals remain outside full source/runtime verification.

## AlwaysStrongFork v1.0.5-repair.1.4.1

- Add a separate experimental Zygisk isolation companion with exact per-package selection and protected UID/process exclusions.
- Add optional private read-only copies of module-provided font mappings, preserving addresses and bytes while removing the original file backing from those selected process mappings.
- Request per-process module unmounting and unload the companion library after specialization; keep the main PIF libraries unchanged.
- Add read-only Soter environment diagnostics without vendor key creation/deletion or placeholder success results.
- Add 4 tests covering native package policy, actual font mapping replacement, and config validation; total 54 Python + 6 Rust tests.
- Publish 3 main ZIP variants plus the separate experimental companion. No physical-device or all-clear detector claim.

## AlwaysStrongFork v1.0.5-repair.1.4.0

- Apply and verify one bounded session-only boot property policy before TEE startup and owned daemon restarts; remove the asynchronous startup race.
- Cover existing OEM verified-boot, lock, verity, warranty, debug, and build type/tag aliases without inventing properties or changing the product identity.
- Add opt-in WebUI synchronization of selected app targets and currently running package-prefixed processes to Magisk DenyList. Preserve existing entries and enforcement. A compatible external hider is required.
- Include property-policy and DenyList logs in diagnostic bundles.
- Add 10 isolated regression tests, for 50 Python and 6 Rust tests in total.
- Keep TEESimulator-RS v6.0.1-307 native libraries/DEX unchanged. No universal root-hiding, Play Integrity, or device-runtime guarantee.

The sections below are upstream historical notes; use the README for current fork behavior.

## v1.0.5

**New**
- **New WebUI design.** The whole panel is redrawn, with an Advanced tab, a theme picker (System / Light / Dark) and a native file picker that sorts, filters to `.xml` and remembers the last folder.
- **Beta fingerprint picker.** Advanced lists Google's current Pixel beta/canary fingerprints; the ones that still pass STRONG (the Pixel 6 series) are badged and sorted to the top.
- **Import your own fingerprint.** Drop a `pif.json` / `pif.prop` to use it as the active fingerprint; the WebUI shows its device name with a button to revert to automatic.
- **"Get security patch" button.** Fills the System / Vendor / Boot patch fields from the active fingerprint's own date.
- **Widevine L1 restore (opt-in).** Advanced action to restore Widevine L1 on Qualcomm devices that lost it.
- **DenyList hides root from the Play stack (Magisk).** The Google Play processes are added to the DenyList at boot so a hider scrubs the module's mounts out of them (entries only, Enforce is never touched).
- **15 languages, fully translated.** Every screen is covered in all 15 languages, not just English and Turkish.

**Changed**
- **The attested security patch follows the fingerprint.** It is written verbatim to system / vendor / boot instead of the current month, with per-partition manual overrides.
- **Automatic and manual fingerprint are mutually exclusive.** Turning Fingerprint on drops a picked or imported one; picking or importing one turns it off.
- **Faster Action on a manual tap.** The cosmetic pauses between steps are trimmed; the bounded network work is unchanged.
- **One config directory.** Every setting lives in one `key=value` file under `alwaysstrong/`, written out in full on install, boot and reset; old marker files are imported and cleared.
- **Faster WebUI.** The first screen loads in one root call and paints its last state instantly, and old WebViews / odd DPIs render correctly (plain `rgba`, font boosting off, long labels wrap).

**Fixes**
- **TEESimulator reaches STRONG on an unlocked bootloader.** The adapter writes the `overrides.json` root of trust (Verified + locked, non-zero boot key, resolved VBMeta digest) on every config push.
- **The panel no longer freezes on a setting change.** Picking or importing a fingerprint, flipping a spoof flag or the patch toggle now runs its work in the background; the control updates at once.
- **An imported or beta fingerprint is the one attested.** The patch sync and Action read the engine's active fingerprint before the stale auto-fetch copy, and importing clears the old copy.
- **Action fetches a STRONG-capable fingerprint.** It pulls a Pixel 6-series Canary fingerprint (the identities that still hold STRONG) instead of the newest Pixel; fallbacks are Pixel 6a / 6.
- **Custom target apps survive a reboot.** The builder now reads the WebUI-added packages list, so a hand-added app sticks.
- **Stable vbmeta digest.** `ro.boot.vbmeta.digest` is resolved deterministically instead of ever falling back to a random value.
- **A shorter check interval takes effect at once.** Writing the interval tells the refresh loop to drop its current wait and restart.
- **Target list taps register.** A tap only has to stay within 12 px; the long-press (per-app keybox / mode) is unaffected, and no Copy / Share bar opens over the dialog.
- **Status indicator comes back at once.** Turning it on fetches and stamps the status right away instead of waiting for the next hourly run.
- **Reset to defaults.** One button puts every WebUI setting back to fresh-install state and re-runs Action, keeping your keybox.
- **Action works on newer Magisk Alpha.** It re-executes under the manager's busybox, so the ash-only line no longer kills it under `mksh`, and the Action rows line up again.
- **Honest keybox status.** Action asks the mirror every tap instead of trusting any keybox-looking file.
- **TEESimulator (JingMatrix) reloads on a keybox / target change** instead of waiting for the first hourly tick. Collect logs is richer and every probe is time-bounded so the button cannot hang.

**Upstream**
- PlayIntegrityFork CI #623 (post-v18, Canary-print fixes), PlayIntegrityFix inject-s v4.9 (from v4.7). TEESimulator-RS kept at v6.0.1-307 per the Telegram poll.

**Builds**
- Three release zips: `AlwaysStrong-<ver>.zip` (default / Fork), `-inject.zip`, `-nopif.zip` (Lite). The TrickyStoreOSS and TEESimulator (JingMatrix) engines stay nightly-only, see `docs/ADVANCED.md`.

## v1.0.4

**New**
- **Lite build** (`-nopif`): hardware attestation + auto keybox, no bundled fingerprint spoof — for setups where the bundled PlayIntegrityFork conflicts with Google Play Services. Drives your own PlayIntegrityFork / Fix if you have one.
- **WebUI Advanced tab**: import your own fingerprint (`pif.json` / `pif.prop`), toggle any spoof flag by name, add custom target packages, select all / unselect unnecessary.
- **Zero-touch first boot**: the first boot after install runs the Action by itself, so a fresh install lands `STRONG` without opening the module.
- Upstream releases now auto-publish (PlayIntegrityFork / PlayIntegrityFix / TEESimulator-RS bumps become a release on their own).

**Fixes**
- **Action no longer gets stuck on a black screen.** Every network step is bounded and falls back to the next downloader; limits are progress-based, so slow networks are never cut off. The native fetcher prefers IPv4 and retries over the other address family when a connection stalls.
- Custom ROMs: ROM version no longer shows "unknown", the LineageOS fast-charging toggle is back, and the security patch follows OTAs again (the aggressive hides are opt-in in the Advanced tab).
- Uninstalling a Lite build no longer removes your own PlayIntegrityFork / Fix.
- The system security-patch date follows the attested patch again (as in v1.0.3), so attestation checkers no longer report "OS patch differs". It never moves the date backwards, and a new **Advanced → Spoof security patch** toggle turns it off.

**Upstream**
- PlayIntegrityFork v18, TEESimulator-RS v6.0.1-307.

**Builds**
- Releases ship three zips: `AlwaysStrong-<ver>.zip` (default), `-inject.zip`, `-nopif.zip` (Lite). The TrickyStoreOSS / TEESimulator (JingMatrix) engines are nightly-only — see `docs/ADVANCED.md`.

## v1.0.3

- Added a second build, `-inject`, running on PlayIntegrityFix inject-s. A lot of you asked for it. Try it if the default doesn't reach STRONG on your device.
- Per-app keybox: assign a different keybox to specific apps from the WebUI, instead of one keybox for everything. Import your own keybox files, pick which app gets which, and the rest keep using the default — handy when one app needs a separate key.
- Collect logs button in the WebUI (also `sh action.sh logs`) that saves a diagnostic report to `/sdcard` for issue reports.
- Updated TEESimulator-RS to v6.0.1-307.
- Bug fixes.

## v1.0.2

New keybox mirror, a far more reliable fetcher, a custom-keybox file picker in the WebUI, strong-integrity fixes, and a faster, steadier Action.

**Strong integrity**
- **The fingerprint reaches PlayIntegrityFork.** PIF's zygisk reads `custom.pif.prop` from the module dir; every fetch path — native, autopif4, and the shipped fallback — now runs `migrate.sh` to produce that file and enforces the STRONG spoof settings (`spoofProvider=0`, `spoofVendingFinger=1`), so STRONG holds with a valid keybox (3 green).
- **Strong survives the hourly refresh.** The hourly fingerprint refresh regenerated `custom.pif.prop` but skipped re-applying the STRONG spoof settings, so ~1 h after boot the fingerprint silently reverted to a weak config (`spoofProvider=1`, `spoofVendingFinger=0`) and STRONG dropped even though the WebUI still showed 3 green. The native fetch now enforces the STRONG settings itself, and the hourly loop re-enforces them, so every refresh stays strong.
- **Faster fingerprint.** The fast native crawl (~10s) is primary; autopif4 — whose crawl stalls up to ~1 min on some devices — is the fallback.

**ROM spoof**
- The disable list now matches PlayIntegrityFork's current engines (adds `persist.sys.pp.*`, plus AOSPA / PixelOS / Afterlife detection). Uninstalling AlwaysStrong now restores the ROM's own spoof engines — the persist props it set are cleared on uninstall (only if still unchanged), so removing the module frees PixelProps / pihooks / entryhooks again.

**Keybox & status**
- Moved to the new mirror: keybox from `http://evoker.qzz.io/key`, status from `/status`.
- The WebUI status now shows which keybox is in use (e.g. `evokerrkey27`) alongside the health.

**Custom keybox (WebUI)**
- New "Custom keybox" toggle — use your own keybox instead of the auto one.
- Built-in file manager to pick a keybox from storage: breadcrumb path, folder navigation, file size + date, and sort (name / newest / oldest).
- While custom keybox is on, the module stops auto-fetching (Action shows "custom keybox — skip fetch").

**Fingerprint**
- The fingerprint is now fetched by a native crawl of the same Google servers PlayIntegrityFork uses — fast and reliable on devices where autopif4's busybox-wget crawl used to hang. autopif4 is kept as a bounded fallback, and shipped static fingerprints guarantee one always lands.
- The Action never shows a bare "offline": a failed primary is shown once as "trying with fallback", and it drops through quickly (bounded timeouts).

**Fetcher (asfetch)**
- Rewritten to connect IPv4-first — fixes "keybox missing" and stuck downloads on networks that advertise IPv6 in DNS but have no working IPv6 route.
- Handles http + https, redirects, chunked responses, and custom request headers.
- Every download (keybox, status, fingerprint crawl, WebUI) falls back across asfetch → busybox wget → curl → wget, so it works on every device.

**Misc**
- Removed the "recheck in ~1 min" line from the Action output.

## v1.0.1

Hotfix, same upstream as v1.0.0.

- Added a native fetcher (Rust/rustls) so the keybox downloads on every device — busybox's TLS was stalling on the mirror.
- Action button no longer hangs, and it stops force-enabling Magisk's Enforce DenyList.
- Smaller banner / lighter zip.

## v1.0.0

Initial release.

- Bundles TEESimulator-RS v6.0.1-282 (Rust TEE simulator, hardware attestation injection)
- Bundles PlayIntegrityFork v17 (zygisk Build/property spoofing for GMS DroidGuard)
- Installer removes conflicting standalone modules (TrickyStore, PIF, USNF, MHPC, etc.)
- Bootloader / verified-boot prop spoofing in `post-fs-data.sh`
- Late OEM-specific prop spoofing in `service.sh` (Samsung, Realme, OnePlus, Xiaomi, Oppo)
- Action button refreshes fingerprint via `autopif4` and restarts PI processes via `killpi`
- Optional keybox auto-fetch (`keybox_fetch.sh`) — set `KEYBOX_URL` to any raw HTTPS URL
- Daemon classpath renamed to `tee_classes.dex` so PIF zygisk's `classes.dex` lookup doesn't collide
- `build.sh` / `build.ps1` download pinned upstream release ZIPs and repackage — rebuild on any upstream release by bumping the version variables
