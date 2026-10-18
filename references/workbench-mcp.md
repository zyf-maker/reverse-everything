# Reverse Replica 与 Workbench MCP 协作

当宿主已提供 `replica_*` 工具且任务涉及 Web/JavaScript 分析或重建验证时，使用此分支。Skill 提供分析方法与验收判断；`replica-workbench` MCP 执行案件、静态分析、浏览器取证、回放、验证和报告。两者可以独立使用；同时安装并加载后才能按这里的规则配合。仅把文件放在同一仓库不会自动安装或连接。

## 执行顺序

1. 调用 `replica_capabilities` 与 `replica_doctor`，记录实际可用的工具、Workbench 根目录和本次所需能力。先确认宿主工具列表中确有这些工具；本地 doctor 成功不等于宿主已完成 MCP 握手。直接 capture/replay 需要已运行并列入案件白名单的 CDP 端点，verify 则自行启动隔离浏览器。
2. 使用该 Workbench 根目录下 `work/` 内的原生案件，通过 `replica_status` 核对目标、授权状态与有效期。`replica_init` 只创建 pending 案件；现有协议不能将 pending 案件提升为 authorized。需要授权时，由 operator 根据已确认范围通过原生 CLI 创建另一个已授权案件，具体命令见 [Agent 协议](../replica-workbench/docs/AGENT_PROTOCOL.md)。Agent 的 MCP 请求不能自行授予授权。
3. 选择本次所需的 `replica_analyze`、`replica_capture` 采集事实，用 `replica_add_evidence` 明确记录观察、推断、测试与限制。同一条证据使用一个主记录位置，跨后端时引用文件路径或证据标识。
4. 用 `replica_rebuild` 创建独立实现目录，由编码 Agent 完成具体实现。该工具仅生成脚手架，不能把它的成功当作功能复刻完成。按 Skill 的行为依据与验收标准编写实际实现和场景。
5. 用 `replica_verify`，或满足端点白名单条件时用 `replica_replay`，执行本次新验证；再调用 `replica_report`。根据本次场景结果和未覆盖项给出结论，保留必要的独立测试。

## 案件与外部工具边界

- Workbench 的 `work/<name>/case.json` 与技能 `scripts/scope.py` 使用的 scope 文件是不同格式。Workbench 操作使用其原生检查器；REA、PentAGI 等外部调用仍按 `tool-verification.md` 的 scope 路径分别验证，不能互相冒充已授权。
- Workbench MCP 当前提供本地静态分析与有界 CDP 流程。需要原生二进制、Android 专用 provider 或主动安全任务时，使用主技能的 REA/PentAGI 分支，并记录后端切换。
- 同一宿主选择一个 `replica-workbench` 注册入口。安装脚本、手写配置或插件同时启动同一服务可能导致重复进程、同名项覆盖或不同 Workbench 根目录；先核对宿主现有服务列表，再选择或更新已有注册。

MCP 接入方式、源码模式与成品模式的区别见 [插件接入说明](../replica-mcp-plugin/README.md#connection-paths)。技能被单独复制安装、相邻项目文档不存在时，查看[仓库中的同一说明](https://github.com/zyf-maker/reverse-replica/tree/master/replica-mcp-plugin#connection-paths)，并以宿主当前暴露的工具 schema 为准。
