# MCP stdio transport verification

Checked against the official MCP specification and the official TypeScript SDK
source on **October 18, 2026**. Context7 was unavailable for this check, so the
repository and release notes use the primary sources below.

## Wire contract

The standard MCP stdio binding is newline-delimited JSON-RPC over the child
process's stdin/stdout. Each message is one UTF-8 JSON-RPC request,
notification, or response; messages must not contain embedded newlines. The
server may log to stderr, but stdout must contain only valid MCP messages. The
client launches the server as a subprocess and keeps stdin open while requests
are in flight.

Primary source: [MCP Transports specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#stdio).

This means a test harness must write:

```text
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}\n
```

It must not send HTTP `Content-Length` headers. The earlier Workbench contract
fixture used Content-Length framing; it has been corrected to newline JSON.

## TypeScript SDK entry points

The v2 package exposes `McpServer` from `@modelcontextprotocol/server` and the
process transport from `@modelcontextprotocol/server/stdio`. The basic server
pattern is:

```js
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

const server = new McpServer({ name: 'replica', version: '1.0.0' });
// server.registerTool(...)
await server.connect(new StdioServerTransport());
```

The SDK's `StdioServerTransport` uses a read buffer, parses one JSON message
per line, serializes responses as JSON followed by `\n`, and closes when stdin
reaches EOF. It does not use Content-Length framing for stdio. The SDK source
also documents the basic `server.connect(transport)` lifecycle.

Primary sources:

- [Official stdio implementation](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/server/src/server/stdio.ts)
- [Official stdio example](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/server/src/server/stdio.examples.ts)
- [Official `McpServer.connect` implementation](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/server/src/server/mcp.ts)
- [Official package layout and v2 entry points](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/get-started/packages.md)

## Protocol-era note

The ordinary `server.connect(new StdioServerTransport())` pattern serves the
legacy/2025-era lifecycle in the current SDK. The SDK's newer `serveStdio`
entry is required only when opting into the separately documented
`2026-07-28` protocol era and its connection-pinned negotiation. The unified
Replica package currently targets the stable 2025-era MCP handshake unless its
manifest explicitly declares the newer entry and includes a compatibility test.

Primary source: [SDK support for the 2026-07-28 era](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md).

## Packaging consequences

1. The package entry must keep stdout clean. Diagnostics go to stderr or a file.
2. MCP smoke tests must exercise `initialize`, `notifications/initialized`,
   `tools/list`, and at least one `tools/call` over newline JSON.
3. The host must launch the bundled server as a subprocess and keep the pipe
   open until the response arrives.
4. A package manifest must state its protocol era. A server using the basic
   `StdioServerTransport` must not claim 2026-era support.
5. If the package later adopts `serveStdio`, add a pinned-era handshake test
   and retain a legacy fallback test when backward compatibility is promised.

The offline test at `verification/unified-platform/contract-test.mjs` follows
the stable newline JSON stdio contract and intentionally does not require an
external MCP client SDK.
