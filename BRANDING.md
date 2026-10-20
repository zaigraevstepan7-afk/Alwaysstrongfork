# Fork credit and local banner

The module author field starts with `@SUKISU_ULTR4` so narrow manager cards show
the fork author's handle before the upstream credit list. Original contributors
remain credited in module.prop and the upstream documentation.

`banner.png` is a frame exported from the owner's supplied 10-second video.
The manager uses this ordinary PNG. WebUI includes the original local
`banner.mp4`, its matching poster, and a visible fork credit below the title.
No remote media URL is required.

The video is muted and loops while visible. It pauses when the page is hidden
or scrolled away. Reduced-motion preferences and playback failures show the
poster. These appearance changes do not change the attestation engine, keybox,
boot scripts, or Play Integrity verdict handling.

The Community & support section contains only the fork channel,
https://t.me/alwaysstrongfork. The same channel is used by module.prop support
and the Action footer. The coffee/donation entry and its metadata are removed.
