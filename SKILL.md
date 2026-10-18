---
name: reverse-replica
description: >
  逆向理解已有网页、桌面应用或软件包的可观测行为，并独立重写和验证等价实现。
  适用于功能复刻、成品分析和行为兼容重建；普通完整源码仓库的架构阅读直接使用代码分析工具。
---

# Reverse Replica

交付可运行的重写项目、可追溯的行为依据和可复跑的对比验证。保留目标的已观测怪癖，区分观察、推断、未知，不把“工具安装成功”写成“能力已验证”。

## 范围与工具选择

先明确目标版本/commit、完整功能边界、重写技术栈及验收口径。用户未指定技术栈时优先选择易运行且依赖少的方案。用户已授权的确定性步骤连续完成，不在每一步重复索取确认；缺少目标授权或必须改变验收范围时才补充确认。

- **Replica Workbench MCP**：当前宿主提供 `replica_capabilities` 等 `replica_*` 工具，且任务是 Web/JavaScript 分析、取证或重建验证时，先读 [Workbench 协作规则](references/workbench-mcp.md)，再用其案件与证据流程执行下文步骤。Skill 负责行为依据、独立实现和验收判断，MCP 负责具体操作。MCP 未接入时使用下列工具分支；同一阶段选定一个执行后端，切换时记录原因与证据位置。
- **REA**：优先用已安装 CLI 或当前会话中的 MCP。静态 JS 不需要原生引擎；Web/CDP 需要实际浏览器端点；native、Android 分别检查对应 provider。仅修改当前客户端所需配置，保留已有配置与符号链接。
- **reverse-skill**：可选的场景方法库，非必需依赖。找到仓库后读其 RULES、PRIMARY 和所需引用；路由结果须按目标 skill 的适用范围复核。生成索引只是快照，不能替代 MCP 握手和实际调用。
- **PentAGI**：只在需要主动安全验证时使用。纯静态项目可做静态与本地运行时安全检查，无须为普通功能复刻强制启动渗透平台。若用户要求验证三工具，则三者分别留真实调用证据。

工具接入、MCP 验证和 PentAGI 的条件分支见 [工具验证](references/tool-verification.md)。

## 执行与验证

1. **预检**：Workbench MCP 路径调用 `replica_capabilities` 和 `replica_doctor`，按本次所需操作判定能力；使用 REA/其他外部工具的路径运行本技能的 `scripts/preflight.ps1 -TargetType web -CdpEndpoint http://127.0.0.1:9227 -Json`，或 `bash scripts/preflight.sh --target web --cdp-endpoint http://127.0.0.1:9227 --json`。静态 JS 用 `javascript`，原生用 `binary`，APK 用 `mobile`，安全栈用 `pentest`。自定义 PentAGI compose 项目同时指定 `-PentagiPath <目录> -ComposeFile <文件名>`。
   预检只调用本地安装，不下载、不安装、不会修改配置；子进程有超时。READY 仅指报告列出的先决条件；DEGRADED 说明可用替代路径和缺失能力。PentAGI 状态不会仅凭容器健康升为端到端 READY。
2. **授权与目标约束**：对本地样本记录来源、许可与用户任务；主动安全操作必须有明确授权和目标白名单。Workbench MCP 路径按其原生案件格式检查 `replica_status`，由 Workbench 验证有效期、目标和端点范围；接入与 operator 授权步骤见协作规则。REA/其他外部工具路径使用 [scope 格式](references/tool-verification.md#scope) 创建案件文件，运行 `python scripts/scope.py --scope <case.json> --action <static|runtime|network|pentest> --target <path-or-url>`；非零退出即停止相应操作。两套案件格式分别由各自检查器验证，授权不自动互通。路径按解析后的真实路径校验，URL 按精确 origin 校验，过期/pending 不放行。
   REA 静态 JS 路径优先使用同一检查器的 `--run-rea analyze-javascript-application` 入口，校验失败不会启动 REA。其他外部工具调用前也先过对应 scope；这个检查器不是操作系统沙箱，网络边界仍需独立验证。
3. **取证**：运行本地目标，在受控输入下采集状态、输出、存储和必要的网络行为。源码用于定位和交叉核对；说明每处测试注入，避免测量补丁改变被测逻辑。动画/随机过程才需要时钟与随机源对齐，普通业务不强制套用这些方法。
4. **依据清单**：每条核心行为附出处、预测、实测结果及限制。用正常、边界、错误和重复执行案例支持结论；一次命中不能代表全覆盖。关键未知先补观测，不能把推断写成事实。验收范围变化后重新检查随机消费者、初始状态和范围清单。
5. **重写并测试**：独立实现业务逻辑，记录复用的许可证资源。允许本地构建、单元测试和隔离运行；不要求等到最后才首次执行。逐步与目标对比，发现差异记录首个分歧和原因，再修复或明确约定偏差。
6. **安全验证与交付**：按项目实际风险验证输入、存储、依赖及网络行为。PentAGI 启用时先验模型工具调用、embedding 和实际 worker 网络，再对本地白名单目标执行有界任务，等待最终报告。交付项目、启动命令、证据、测试结果、范围外项和仍未验证的能力。历史结果与本次实测分开写。

## 可证伪的验收

- 指定相同输入、初始条件、目标版本、运行环境和容差；状态机/协议用精确值，视觉用声明区域与阈值。
- 同时覆盖核心逻辑和对外行为：输入、异常、重启/恢复、持久化、界面/动画，以及项目包含的后端接口。
- 对比失败时先核对测量环境、时钟/随机流、重复包装与初始状态，再改实现；不要一律认定原模型或测量工具正确。
- “完整”指已声明项目范围逐项通过，不意味着任意浏览器/平台、未知线上服务或全部安全性质已被证明。

脚本回归：`python scripts/test_preflight.py`。跨平台共用 Python 标准库核心，两个 shell 入口仅做参数转发。测试夹具不能替代真实 REA/CDP、MCP、embedding 或 PentAGI flow 验收。
