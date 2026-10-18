---
name: reverse-replica
description: >
  使用统一 Replica 平台逆向理解网页、JavaScript、桌面应用和软件包，记录可追溯证据，独立重建并验证行为等价性。
---

# Reverse Replica

这个 skill 负责分析方法、证据判断、独立重建和验收口径；`replica-unified` MCP 负责统一内核中的案件、授权、scope、观察、分析、运行和报告。两者配合使用，不是两个互相竞争的后端。

## 统一平台

所有工作都使用 `replica-unified/v1`：

- `case`：目标、版本、生命周期和 operator authorization。
- `scope`：允许的动作、路径、origin、CDP endpoint 和网络模式。
- `observation` / `evidence` / `finding`：原始事实、来源、推断和限制。
- `action` / `scenario` / `run`：受控执行、确定性步骤、策略快照和输出。
- `verification` / `report`：有边界的复现结论和 provenance 链。

REA、PentAGI 和 reverse-skill 的有效方法已转为内部 capability contract。它们可以作为实现参考或未来 provider，但 MCP 不把它们暴露成平行路由，也不要求它们安装后才能建立案件、追加证据或生成报告。

## 工作流程

1. 明确目标版本、授权来源、目标范围和验收标准。
2. 调用 `replica_capabilities`、`replica_doctor`，把 `ready`、`degraded` 和缺失依赖写入记录。
3. 调用 `replica_case_create` 创建 pending case；只有 operator 明确提供 basis、issuer、attestation 和 future expiry 后，才调用 `replica_case_authorize`。
4. 通过 `replica_scope_check` 检查每个动作和 target。pending、过期或超出 allowlist 的操作必须停止。
5. 先收集正常、边界、错误和重复执行的观察，再把原始输入、环境、来源和限制写入 `replica_evidence_append`。
6. 使用 `replica_run_start`、`replica_run_get`、`replica_verify` 运行重建、replay 和验证。每个 run 必须保留 policy snapshot 和 evidence IDs。
7. 使用 `replica_report_generate` 输出覆盖范围、通过/失败检查、限制和未验证项。READY 只表示列出的验证点通过，不表示穷尽证明。

## 能力状态

JavaScript 静态分析、重建脚手架、确定性 replay、contract verification、报告、scenario 和 worker 是内置能力。浏览器/CDP、native、mobile 和主动 security 依赖环境或明确注册的 adapter；缺失时必须返回 typed `degraded`，不能把计划、占位或工具安装成功写成已验证能力。

## 安全边界

MCP 不自行授予授权，不暴露任意 shell，不绕过 scope。主动网络或安全验证只能针对 operator 已授权的 loopback/allowlist 目标，并记录限制、输入、输出和证据来源。历史 Workbench、REA 或 PentAGI 导出只能作为 evidence 导入，不能改变统一 authorization、scope 或 verdict。

## 交付标准

交付时说明目标版本、运行环境、授权和 scope、证据位置、测试命令、差异、限制和未验证能力。旧 `replica-workbench-mcp` v0.1.x 发行包是历史兼容版本，不得描述为统一重构完成品；迁移规则见 `docs/unified-platform-migration.md`。
