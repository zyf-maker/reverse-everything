# Corresponding browser source and build information

The bundled browser is an unmodified copy of ungoogled Chromium Windows x64
155.0.8059.79-1.1. The packaging project does not modify or relink that browser.
All component copyright and license terms are preserved in
`chromium-THIRD-PARTY-NOTICES.html` and `.txt` (770 generated entries).

The following source companions are provided alongside the binary ZIP at
https://github.com/zyf-maker/reverse-everything/releases/tag/v0.2.1 :

- `chromium-155.0.8059.79-lite.tar.xz`: Chromium upstream's matching source
  distribution, including third-party sources and platform build configurations.
  SHA-256: `fcb5be44f1f5916ac23309c706146819c792c0d0e9c1a8220b7fbc046d79f15e`.
- `ungoogled-chromium-windows-a1e3123-source.zip`: Windows build scripts,
  configuration and Windows patches from commit
  `a1e3123c8d543b5c9a1eecfaf0f06cf242c0db37` (tag `155.0.8059.79-1.1`).
- `ungoogled-chromium-9f145d8-source.zip`: the exact patch/configuration
  submodule selected by that Windows build,
  `9f145d8815e6e50cc4a2537fcac40966d911e027`.

To obtain and build the browser, use the README and `build.py` in the Windows
source companion with the patch repository placed at its `ungoogled-chromium/`
subdirectory. These describe the upstream download, unpack, prune, patch,
configure, toolchain and build steps. The matching source tar can be supplied
as the Chromium download. Preserve `third_party/ffmpeg/chromium/config/` and
both patch sets; generic FFmpeg sources alone do not describe this build.
Rebuilding requires the Windows compiler/toolchain documented by upstream;
the source materials do not promise byte-identical binaries.

Pinned primary sources:

- Chromium: https://chromium.googlesource.com/chromium/src/+/refs/tags/155.0.8059.79
- Source archive: https://commondatastorage.googleapis.com/chromium-browser-official/chromium-155.0.8059.79-lite.tar.xz
- Source checksums: https://commondatastorage.googleapis.com/chromium-browser-official/chromium-155.0.8059.79-lite.tar.xz.hashes
- Windows build/patches: https://github.com/ungoogled-software/ungoogled-chromium-windows/tree/a1e3123c8d543b5c9a1eecfaf0f06cf242c0db37
- Core patches: https://github.com/ungoogled-software/ungoogled-chromium/tree/9f145d8815e6e50cc4a2537fcac40966d911e027
- FFmpeg revision from Chromium DEPS: https://chromium.googlesource.com/chromium/third_party/ffmpeg/+/ba5e7eaea38b6a54157870e0085b2e8c75aa6bcb

Components including FFmpeg (LGPL), Eigen (MPL), hunspell (MPL/LGPL), and WebKit
(LGPL/BSD portions) retain their individual terms in the generated notices.
Users may modify those components under those terms. No project restriction
is intended to prohibit modification or reverse engineering for debugging
such modifications where their licenses grant that right.

When mirroring the binary release, mirror these source companions and this
file as well. The upstream source contains components for multiple platforms;
the generated browser inventory is the notice record for this Windows build.
Node.js's combined license and Python's license are included separately;
JavaScript dependency licenses are retained with their package sources.
