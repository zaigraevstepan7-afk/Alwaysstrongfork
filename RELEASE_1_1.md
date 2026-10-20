# AlwaysStrong Repair 1.1

A visual update based on Repair 1 (versionCode 108).

- @SUKISU_ULTR4 is listed first in the author field and installer output, and appears below the WebUI title.
- The manager card banner is replaced with a PNG frame from the supplied video.
- The original ten-second MP4 is bundled locally in WebUI. It plays muted and loops, pauses offscreen, and is replaced by a poster when reduced motion is enabled.
- Only `banner.png`, `customize.sh` (credits and resource installation), `module.prop`, `webroot/index.html`, and `webroot/main.js` changed; `webroot/banner.png` and `webroot/banner.mp4` were added.
- TEE/PIF, native helpers, boot/service scripts, keybox handling, and verdict handling are byte-for-byte identical to the Repair 1 ZIP. Experimental Repair 2 RC1 changes are not included.

Installation: install this ZIP over the existing AlwaysStrong module through your root manager, then reboot. The Repair 1 installer preserves keys and settings. Do not delete `/data/adb/tricky_store`. Refresh the module list or reopen the manager if the new card does not appear.

Checks: ZIP CRC, comparison of every file against Repair 1, shell/JavaScript syntax, and the three existing installer/WebUI tests. All five WebUI/media resources were extracted for Magisk/KernelSU/APatch on the host, with contents and permissions verified. In a 390×844 mobile browser preview, the author was visible, no horizontal overflow occurred, the video played muted and looped, paused when scrolled offscreen, and resumed on return. No console errors were observed. Reduced-motion behavior was checked in code/CSS; it was not separately run on Android.

Installation of this new ZIP and its card display in a specific root manager version have not been tested on a phone. This is a visual update, not new Play Integrity evidence or a Duck fix.

Source archive: `AlwaysStrong-Repair-1.1-source.zip`. Build: `bash build.sh --variant fork`. Upstream licenses and credits are preserved. The next public release must use a versionCode greater than 108.
