# 2048 Behavioral Reconstruction

This directory contains an independent JavaScript implementation of the local game behavior observed from `gabrielecirulli/2048` at commit `478b6ec346e3787f589e4af751378d06ded4cbbc`.

## Run

Serve this directory with any static HTTP server, for example:

```powershell
python -m http.server 8765
```

Open `http://127.0.0.1:8765/` in a browser. No build step or package installation is required.

## Scope

The reconstruction covers the 4x4 game engine, tile spawning and merging, score and best-score persistence, win/continue/loss states, keyboard input, touch input, restart/retry controls, and the observed board presentation. The original stylesheet and media assets are retained for visual comparison; `engine.js` and `app.js` are independent implementation code.

## Verification

Run the comparison commands from the parent directory:

```powershell
node verification/compare-core.mjs
node verification/compare-browser.mjs
python verification/check-images.py
```

The measured results are recorded in `verification/FINAL-REPORT.md` and `verification/core-comparison.json`, `verification/browser-comparison.json`, and `verification/visual-comparison.json`.

## License

The retained upstream assets and license text follow the original MIT-licensed project. The independent implementation is provided for local verification of behavior and is not presented as the upstream source code.
