# Third-party notices

The core workbench in `src/replica_platform` uses only the Python standard library.

Optional adapters may invoke locally installed runtimes, browsers, container engines, or analysis tools. Those components are not bundled into the core package. When distributing an adapter or binary, include its license text and source attribution here and in the distribution manifest.

The workbench does not copy third-party source code. It stores observations, hashes, and test results produced by authorized analysis.

The repository also contains optional independent components under `../own-reverse-platform/`:

- `static-analyzer`: Node.js built-in lexical analysis.
- `runtime`: public Chrome DevTools Protocol collector. Its package manifest identifies the WebSocket client dependency and its license must be retained when redistributed.
