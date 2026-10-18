---
name: reverse-everything
description: >
  使用 Reverse Everything 平台逆向理解网页、JavaScript、桌面应用和软件包，记录可追溯证据，独立重建并验证行为等价性。
---

# Reverse Everything

这个 skill 负责分析方法、证据判断、独立重建和验收口径；`replica-unified`
MCP 负责统一内核中的案件、授权、scope、观察、分析、运行和报告。

## 工作流程

1. 明确目标版本、授权来源、目标范围和验收标准。
2. 调用 `replica_capabilities`、`replica_doctor`，把 `ready`、`degraded` 和缺失依赖写入记录。
3. 调用 `replica_case_create` 创建 pending case；只有 operator 明确提供 basis、issuer、attestation 和 future expiry 后，才调用 `replica_case_authorize`。
4. 通过 `replica_scope_check` 检查每个动作和 target。pending、过期或超出 allowlist 的操作必须停止。
5. 先收集正常、边界、错误和重复执行的观察，再把原始输入、环境、来源和限制写入 `replica_evidence_append`。
6. 使用 `replica_run_start`、`replica_run_get`、`replica_verify` 运行重建、replay 和验证。每个 run 必须保留 policy snapshot 和 evidence IDs。
7. 使用 `replica_report_generate` 输出覆盖范围、通过/失败检查、限制和未验证项。

## 能力状态

JavaScript 静态分析、重建脚手架、确定性 replay、contract verification、报告、scenario 和 worker 是内置能力。浏览器/CDP、native、mobile 和主动 security 依赖环境或明确注册的 adapter；缺失时必须返回 typed `degraded`，不能把计划或工具安装成功写成已验证能力。

## 安全边界

MCP 不自行授予授权，不暴露任意 shell，不绕过 scope。主动网络或安全验证只能针对 operator 已授权的 loopback/allowlist 目标，并记录限制、输入、输出和证据来源。

## 交付标准

交付时说明目标版本、运行环境、授权和 scope、证据位置、测试命令、差异、限制和未验证能力。
