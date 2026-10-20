# AlwaysStrong Repair 1.3

A new WebUI, versionCode 110, based on stable Repair 1.2.

- Light and dark themes, consistent colors, flexible cards, and bottom navigation.
- Animated transitions, lists, and dialogs. Reduced motion disables animations and replaces the video with a poster.
- Long labels wrap; the file picker is no longer constrained by a fixed row height.
- Menus fit the viewport, dialogs scroll when height is limited, and closed dialogs do not block scrolling.
- Duplicated CSS was removed from HTML; all styling is in `app.css`.
- Fixed a race when rapidly closing and reopening a dialog; added focus management and Escape-to-close.
- @SUKISU_ULTR4 remains first in the author list, with the banner preserved. The only support channel is https://t.me/alwaysstrongfork. There is no coffee button.

Installation: install the ZIP directly over Repair 1 / 1.1 / 1.2 through your root manager, then reboot. Do not delete `/data/adb/tricky_store`. If the manager retains the old WebUI in memory, close the WebUI window and reopen it.

The interface does not assign a Play Integrity result by itself: indicators remain unknown until a fresh checker result is imported. Structural keybox checks and Google verdicts are displayed separately.

Checks: JavaScript and shell syntax, three installer/WebUI tests, ZIP CRC, and comparison with the build stage. Browser checks covered widths of 320, 360, 390, 412, 768, and 844 px, Russian and long German labels, light/dark themes, language selection, file/menu controls, nested date dialogs, and the update interval. No horizontal overflow was observed at the tested sizes.

These are browser interface and host build checks. This ZIP was not installed on a physical Android device. Compatibility with every ROM cannot be guaranteed. The engine, native/DEX components, boot/service workers, keybox helpers, verdict handling, and media are byte-for-byte identical to Repair 1.2. Soter is unchanged in this version.

Source archive: `AlwaysStrong-Repair-1.3-source.zip`. Build: `bash build.sh --variant fork`. Original licenses and attribution are preserved. The next public versionCode must be greater than 110.
