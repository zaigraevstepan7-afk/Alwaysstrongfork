# Build verification — October 20, 2026

Historical local build results, recorded before the first repository release:

- The default `fork` variant was built successfully from this tree.
- Android `asfetch` was rebuilt from Rust sources for `arm64-v8a` and `armeabi-v7a` using NDK r27c.
- Watcher used the four-ABI prebuilts supplied in the original source archive.
- All 6 Rust unit tests passed.
- 38 of 40 Python tests passed locally. `test_duplicate_supervisor_cannot_start_second_daemon` and `test_observed_keystore_restart_churn_pauses_owned_daemon` timed out. The local environment returned different PIDs from `getpid()` and `/proc/self/stat`; these tests depend on consistent `/proc` PIDs. The tests were kept enabled for GitHub Actions.
- Shell/JavaScript syntax checks and YAML parsing passed.
- Installation ZIP CRC, required files, ELF headers, and ZIP contents against the build stage were verified.
- The module was not tested on a physical Android device; no Play Integrity verdict was measured in this build run.

Historical installation ZIP: `AlwaysStrongFork-v1.0.5-repair.1.3.zip`.
SHA256: `086709662f624cf7d57986c9db861352e13318a3ca0f9cf70f76049f07d5eff6`.

The subsequent [GitHub Actions build](https://github.com/zaigraevstepan7-afk/Alwaysstrongfork/actions/runs/39393952126) passed all 40 Python and 6 Rust tests. Current installation assets and their checksums are available in [Releases](https://github.com/zaigraevstepan7-afk/Alwaysstrongfork/releases/latest); the historical filename and hash above do not identify the current release ZIP.

For authenticated command-line publishing, run `gh auth login`, then `bash scripts/publish-github.sh`.
