# Chromium redistribution notice research

Research date: 2026-10-18 (Asia/Shanghai). Context7 quota was unavailable; primary source code, official project documentation, and local binary output were checked instead.

## Recommendation and verified evidence

Replace Chromium snapshot 1721402 with the pinned ungoogled-chromium Windows x64 release **155.0.8059.79-1.1**. Preserve its generated credits as an offline HTML notice, retain Chromium and ungoogled-chromium BSD licenses, and publish corresponding sources beside the binary release. This addresses the sample-credits defect without borrowing notices from a different browser version. The selected upstream Windows release and exact build flags are public: [release](https://github.com/ungoogled-software/ungoogled-chromium-windows/releases/tag/155.0.8059.79-1.1), [flags](https://github.com/ungoogled-software/ungoogled-chromium-windows/blob/155.0.8059.79-1.1/flags.windows.gn).

Observed locally: `verification/ungoogled-credits.html` is 8,842,096 bytes and contains 770 `class="product"` entries. SHA-256: `edd71d2d39fe0034dbefed4dee832eea337b8e8eaf920648f9dc8387755928a0`. Its source paragraph identifies ungoogled-chromium. This is the browser's generated notice inventory, which can include platform or tooling entries; it is not proof that all 770 projects are linked into this particular Windows executable.

The browser archive's verified SHA-256 is `2c7714cfab9791c522d891fc80a3539dc673f5897621a6ec3e90b181945c1f07`. [Pinned archive](https://github.com/ungoogled-software/ungoogled-chromium-windows/releases/download/155.0.8059.79-1.1/ungoogled-chromium_155.0.8059.79-1.1_windows_x64.zip).

For extraction on this host, the successful command shape was:

```text
chrome.exe --headless=new --disable-gpu --no-sandbox --no-first-run --allow-chrome-scheme-url --user-data-dir=<fresh temporary directory> --dump-dom chrome://credits/
```

The `--no-sandbox` switch was needed for this audit subprocess on this machine; it should not become the product's default browser launch policy. Convert the exported document into a standalone offline file by replacing `chrome://` stylesheet/script dependencies while preserving every product name, homepage, and complete license body. Check that all license bodies are visible without JavaScript and that the exported product count matches the browser output.

## Why snapshots had sample credits

Chromium's build source defaults `generate_about_credits` to `is_official_build`. When enabled it calls `tools/licenses/licenses.py`; otherwise it copies `sample_credits.html`. The ungoogled Windows release sets `is_official_build=true`. This is the relevant technical cause, rather than the Chromium BSD license file being a substitute for third-party notices. [Chromium build target](https://chromium.googlesource.com/chromium/src/+/refs/tags/155.0.8059.79/components/resources/BUILD.gn), [Chromium's credit generation documentation](https://chromium.googlesource.com/chromium/src/+/main/docs/adding_to_third_party.md#how-we-ensure-that-the-right-credits-are-displayed), [pinned ungoogled flags](https://raw.githubusercontent.com/ungoogled-software/ungoogled-chromium-windows/155.0.8059.79-1.1/flags.windows.gn).

Both Chromium's license and the Windows packaging project's BSD license require retaining their copyright, conditions, and disclaimer in the materials accompanying a binary. Keep both files, separately from the third-party credits. [Chromium license](https://chromium.googlesource.com/chromium/src/+/refs/tags/155.0.8059.79/LICENSE), [ungoogled Windows license](https://raw.githubusercontent.com/ungoogled-software/ungoogled-chromium-windows/155.0.8059.79-1.1/LICENSE).

## Exact source pins

| Item | Pin / location |
| --- | --- |
| Windows build and Windows-specific patches | `a1e3123c8d543b5c9a1eecfaf0f06cf242c0db37`, tag `155.0.8059.79-1.1` |
| Main ungoogled patches, flags, substitution rules | Git submodule `9f145d8815e6e50cc4a2537fcac40966d911e027` |
| Chromium | `refs/tags/155.0.8059.79` |
| Chromium FFmpeg fork | `ba5e7eaea38b6a54157870e0085b2e8c75aa6bcb` |

The Windows commit and submodule pin were verified with `git ls-remote` and `git ls-tree HEAD ungoogled-chromium` on a shallow clone. The submodule is **not** interchangeable with the similarly named main-project release tag. Source links: [Windows commit](https://github.com/ungoogled-software/ungoogled-chromium-windows/tree/a1e3123c8d543b5c9a1eecfaf0f06cf242c0db37), [exact main patches](https://github.com/ungoogled-software/ungoogled-chromium/tree/9f145d8815e6e50cc4a2537fcac40966d911e027), [Chromium DEPS](https://chromium.googlesource.com/chromium/src/+/refs/tags/155.0.8059.79/DEPS), [FFmpeg source](https://chromium.googlesource.com/chromium/third_party/ffmpeg/+/ba5e7eaea38b6a54157870e0085b2e8c75aa6bcb/).

The Windows builder obtains Chromium, applies the main ungoogled patch series, applies the Windows patch series, prunes files and substitutes domains, then combines the two flag files. These transformations and their exact versions belong in a source companion. A scan of Windows-specific patch text found no direct `third_party/ffmpeg` edits; this does not replace preserving the complete main patch series and transformation inputs. [Build implementation](https://github.com/ungoogled-software/ungoogled-chromium-windows/blob/a1e3123c8d543b5c9a1eecfaf0f06cf242c0db37/build.py), [main source configuration](https://github.com/ungoogled-software/ungoogled-chromium/blob/9f145d8815e6e50cc4a2537fcac40966d911e027/downloads.ini).

## Source obligations that notices alone do not discharge

FFmpeg includes LGPL-covered code. Its own compliance guidance calls for exact corresponding sources, build information and retained changes, with source available on the same download server. Chromium's fork documents its generated platform configuration and local patch history, which must be preserved rather than supplying an arbitrary upstream FFmpeg tarball. [FFmpeg legal guidance](https://www.ffmpeg.org/legal.html), [exact Chromium FFmpeg README](https://chromium.googlesource.com/chromium/third_party/ffmpeg/+/ba5e7eaea38b6a54157870e0085b2e8c75aa6bcb/README.chromium), [fork patch history](https://chromium.googlesource.com/chromium/third_party/ffmpeg/+/ba5e7eaea38b6a54157870e0085b2e8c75aa6bcb/chromium/patches/README).

MPL-covered code distributed in executable form must also have its covered source made available, with recipients told how to obtain it. The MPL permits combining it in a larger work; it does not impose the MPL on unrelated application source. [MPL 2.0 sections 3.1–3.3](https://www.mozilla.org/en-US/MPL/2.0/).

Examples confirmed in **the pinned Chromium metadata**, rather than inferred from a loose search for the word GPL inside license text:

| Component | Selected license in metadata | Corresponding source |
| --- | --- | --- |
| FFmpeg | LGPL-2.1 plus permissive portions | [Pinned fork](https://chromium.googlesource.com/chromium/third_party/ffmpeg/+/ba5e7eaea38b6a54157870e0085b2e8c75aa6bcb/README.chromium) |
| Eigen | MPL-2.0 | [Metadata and source tree](https://chromium.googlesource.com/chromium/src/+/refs/tags/155.0.8059.79/third_party/eigen3/README.chromium) |
| Hunspell | MPL-1.1 | [Chromium fork, including google.patch](https://chromium.googlesource.com/chromium/src/+/refs/tags/155.0.8059.79/third_party/hunspell/README.chromium) |
| AXE-CORE | MPL-2.0 | [Metadata](https://chromium.googlesource.com/chromium/src/+/refs/tags/155.0.8059.79/third_party/axe-core/README.chromium) |
| ISimpleDOM | MPL-1.1 | [Metadata](https://chromium.googlesource.com/chromium/src/+/refs/tags/155.0.8059.79/third_party/isimpledom/README.chromium) |
| Mozilla Personal Security Manager | MPL-1.1 | [Chromium fork](https://chromium.googlesource.com/chromium/src/+/refs/tags/155.0.8059.79/net/third_party/mozilla_security_manager/README.chromium) |
| url_parse | BSD-3-Clause and MPL-1.1 | [Chromium fork](https://chromium.googlesource.com/chromium/src/+/refs/tags/155.0.8059.79/url/third_party/mozilla/README.chromium) |
| Hyphenation patterns | Mixed, including LGPL-2.1, MPL-1.1, MPL-2.0 | [Metadata and generated data recipe](https://chromium.googlesource.com/chromium/src/+/refs/tags/155.0.8059.79/third_party/hyphenation-patterns/README.chromium) |

The exported credits also contain WebKit and the Symphonia crate family, as well as several Linux-specific libraries. Treat this table as verified examples, not an exhaustive link-map inventory. Text mentions of GPL inside a multi-license notice do not prove that Chromium selected GPL for the component. Preserving the complete matching source tree avoids trying to trim a source offer from this credits superset.

## Practical companion release assets

Publish these on the same GitHub release as the executable package:

1. The full [official Chromium source tar](https://commondatastorage.googleapis.com/chromium-browser-official/chromium-155.0.8059.79-lite.tar.xz), **2,021,030,800 bytes**. It is the source tar configured by the pinned ungoogled project, including Chromium dependencies and local modifications. Verify SHA-256 `fcb5be44f1f5916ac23309c706146819c792c0d0e9c1a8220b7fbc046d79f15e` against the [official hashes](https://commondatastorage.googleapis.com/chromium-browser-official/chromium-155.0.8059.79-lite.tar.xz.hashes). HEAD and hashes were fetched successfully during this research.
2. A [Windows build/patch archive at the exact commit](https://github.com/ungoogled-software/ungoogled-chromium-windows/archive/a1e3123c8d543b5c9a1eecfaf0f06cf242c0db37.tar.gz) and a separate [main ungoogled patch archive at the exact gitlink](https://github.com/ungoogled-software/ungoogled-chromium/archive/9f145d8815e6e50cc4a2537fcac40966d911e027.tar.gz). GitHub's parent repository source archive does not populate Git submodules; include both.
3. `SOURCE_CODE.md` mapping browser archive checksum to those source assets, identifying `third_party/ffmpeg` and its revision, documenting the pinned build procedure and transformations, and linking the source assets from the binary download page. Preserve existing license notices and permit the recipient's applicable modification/relinking rights.

These are source publishing steps in addition to the offline notice fix. Merely writing an unfulfilled source-offer sentence, or linking an unpinned current repository, is not equivalent to actually making the matching sources obtainable. The project's [pinned Windows build instructions](https://github.com/ungoogled-software/ungoogled-chromium-windows/blob/a1e3123c8d543b5c9a1eecfaf0f06cf242c0db37/README.md) and [exact source retrieval implementation](https://github.com/ungoogled-software/ungoogled-chromium/blob/9f145d8815e6e50cc4a2537fcac40966d911e027/utils/clone.py) describe reconstruction.

## Investigated fallback

Playwright v1.56.1 pins unbranded Chromium **141.0.7390.37**, revision **1194**. Its archive has 254 entries and no standalone LICENSE/ABOUT/credits file, but the locally executed browser produced a complete 15,061,163-byte credits document with 557 products (SHA-256 `a4dcf4843336cca913431c59af4b3836db797fa0da180fe5d9c1118b49f72fda`). The newer selected ungoogled version avoids moving to that older browser. [Playwright pinned browser manifest](https://raw.githubusercontent.com/microsoft/playwright/v1.56.1/packages/playwright-core/browsers.json), [official archive](https://cdn.playwright.dev/dbazure/download/playwright/builds/chromium/1194/chromium-win64.zip).
