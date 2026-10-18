# Own Static Analyzer

This package provides an independent, offline JavaScript/TypeScript lexical analyzer for authorized reconstruction work. It uses Node.js built-ins only and deliberately reports observable structure instead of reproducing a third-party implementation.

## Usage

```powershell
npm test
node .\src\cli.js ..\..\target-2048 --out analysis.json
node .\src\cli.js .\sample --out sample-result.json
```

The JSON schema contains stable, sorted file entries with SHA-256, function declarations, call references, browser/runtime API references, and review signals. Directories skip `node_modules`, VCS metadata, and common build output by default.

This is a lexical signal generator, not a proof of program equivalence. Dynamic code, minified sources, generated bundles, and syntax outside the supported lexical patterns require runtime evidence or a parser adapter.
