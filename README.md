# Reverse Replica Unified Platform

这是一个统一的逆向理解、证据管理、独立重建、回放验证和受控安全检查平台。`reverse-replica` skill、JavaScript 分析器、浏览器/CDP、桌面/native/mobile 能力和安全验证都遵循同一个 `replica-unified/v1` 案件、授权、scope、evidence、run、report 协议。

## 重构状态

截至 2026-10-18，统一内核和 MCP 接口已经重写并通过核心测试、MCP 生命周期测试和统一合约测试。REA、PentAGI、reverse-skill 的方法与能力类别已内化为 capability contract；它们不再是 MCP 的平行后端或必须安装的运行时。

可用能力会由 `replica_capabilities` 和 `replica_doctor` 如实报告。JavaScript 静态分析、重建脚手架、确定性 replay、verification、report、scenario 和 worker 在无外部 provider 时可运行；浏览器/CDP、native、mobile 和主动 security 在缺少对应工具链时返回 `degraded`，不会伪装成完成。

旧的 `replica-workbench-mcp` v0.1.x ZIP 是历史 Workbench-first 预览，不是这次统一重构的发行包。旧案件迁移时必须重新建立 unified case、operator authorization、scope、evidence chain、run 和 report，详见 [`docs/unified-platform-migration.md`](docs/unified-platform-migration.md)。

## Skill 与 MCP

`SKILL.md` 定义分析、取证、重建和验收流程；`replica-unified` MCP 执行统一内核中的具体操作。skill 不再把 REA、PentAGI 或 Workbench 当作互相竞争的路由分支。旧 `replica_*` 工具名仍作为兼容别名，但会映射到统一记录模型。

## 接入 Codex

轻量 npm 模式（发布到 npm 后）：

```powershell
npx -y replica-unified-mcp
codex mcp add replica-unified -- npx -y replica-unified-mcp
```

这个模式要求 Node.js 20+；npm 会下载 MCP 的 JavaScript 依赖。Python 和 Chromium 只在浏览器、Python Workbench 或对应 provider 能力需要时才需要。

源码模式：

```powershell
cd replica-mcp-plugin
npm ci
codex mcp add replica-unified -- node "$PWD/server/index.mjs"
codex mcp list
```

Windows x64 自包含包使用包内 Node：

```powershell
.\install-host.ps1 -Agent codex
# 或手动注册
codex mcp add replica-unified -- C:\path\to\package\runtime\node.exe C:\path\to\package\server\index.mjs
```

注册后重启 Codex，在 MCP 列表中确认 `replica-unified`，再调用 `replica_capabilities` 和 `replica_doctor`。插件本身通过 stdio 提供 MCP；Codex 是宿主，skill 需要单独安装或更新到同一版本。

当前 Codex 使用的是本地自包含包；npm 包入口已经加入仓库，但尚未替用户执行 `npm publish`。

## 统一工具

核心工具包括：

`replica_capabilities`、`replica_doctor`、`replica_case_create`、`replica_case_authorize`、`replica_case_get`、`replica_scope_check`、`replica_evidence_append`、`replica_run_start`、`replica_run_get`、`replica_report_generate`。

同时保留 `replica_observe`、`replica_analyze`、`replica_action`、`replica_scenario_define`、`replica_verify` 及旧 Workbench 别名。案件创建后默认是 pending；没有 operator attestation、有效期和 scope 的调用会被拒绝。

## Chromium notice

旧 snapshot 的 sample credits 缺口不能通过声明解决。发行构建必须从打包的确切 Chromium 二进制生成 credits，并把 HTML、纯文本、原始导出、组件哈希、许可证和源码来源放进 `licenses/`；notice 不完整时构建脚本直接失败。当前仓库保留生成器、锁定文件和验证脚本，但没有把未构建的源码 checkout 称为已发布的自包含包。

## 验证

```powershell
cd replica-core
npm test
cd ..\replica-mcp-plugin
npm test
cd ..
$env:REPLICA_UNIFIED_COMMAND_JSON='["node","replica-mcp-plugin/server/index.mjs"]'
node verification/unified-platform/contract-test.mjs
```

统一包契约：

```powershell
node verification/unified-platform/package-contract-test.mjs <extracted-package>
```

包结构、迁移规则和限制见 [`docs/unified-platform-architecture.md`](docs/unified-platform-architecture.md)、[`docs/unified-platform-migration.md`](docs/unified-platform-migration.md) 和 [`replica-mcp-plugin/README.md`](replica-mcp-plugin/README.md)。
