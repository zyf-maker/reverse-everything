# 工具接入和真实验证

## 预检与修复

预检只使用本地 `rea`，不隐式执行 `npx @latest`。Python 3 为共享预检依赖；缺失时报告 BLOCKED。安装方案由 agent 根据当前缺口准备具体命令，按用户已授权范围执行，保留已有文件，失败需可见，完成后重跑检测。旧 `-Install -Approve` 不再执行任意 shell 文本：`-Install` 只展示计划，`-Approve` 返回 BLOCKED 并解释原因。

REA 用 `rea doctor --client codex --json` 检查当前客户端。`identity.skill.state=aligned` 是已对齐；全环境 healthy=false 不等于静态 JS 不可用。native 与 JADX 分开判。修复先 `rea setup --client codex --dry-run --json`，只作用于选定客户端；如现有配置是符号链接，先核实真实目标、所有者和备份，保留用户的链接结构，不能静默替换为普通文件。

MCP 真实验证必须完成 initialize、tools/list 和至少一次安全工具调用，分别保留结果；配置已写入和独立客户端握手不表示当前已打开的聊天已热加载工具。无法热加载时继续用已验证 CLI，明确新会话可能需要重连。

jshook 按官方 package.json 核对 Node engines；已有符合要求的独立 Node 可供该服务使用，无需升级系统 Node。使用精确版本和现有浏览器。`search` 工具档通过 search_tools/describe_tool/call_tool 暴露能力，不能因首轮 tools/list 只有元工具就判缺少浏览器能力。握手后再对本地页面实际取标题/运行状态。

## scope

案件文件示例（目标必须替换为实际已授权资产，不能照抄授权依据）：

```json
{
  "auth": {
    "status": "granted",
    "basis": "用户明确要求分析和验证本地自有或许可样本的证据",
    "expires_at": "2099-01-01T00:00:00Z"
  },
  "actions": ["static", "runtime", "network"],
  "network": {"mode": "loopback"},
  "targets": {"paths": ["/absolute/local/sample"], "origins": ["http://127.0.0.1:8765"]}
}
```

期限按本次任务选择，不实际使用示例中的长期日期。`offline` 禁止URL；`loopback` 只接受精确白名单中的数值回环地址；`lab_only`/`allowlist` 接受精确 origin。脚本不负责防火墙或 DNS 绑定，实际网络边界需后续检查。

reverse-skill 可同时使用自己的 case-init/case-guard；不要把一个系统的 scope 自动当作另一系统已授权。显式提供已定位仓库路径。路由自测通过也可能有自然语言误路由，要复核 PRIMARY 的适用范围。

## PentAGI 验收

1. 保留原 `.env`、数据卷和历史任务。优先使用单独项目名/数据库/网络的新验证环境；避免启动后自动恢复历史任务。核对 worker 命名/端口，防止同 daemon 上的不同实例相互覆盖。
2. 核验真实已安装二进制 `ctester -help`、`etester -help`。从最小角色测试开始，检查 ctester 逐项报告，不能只看退出码。`etester test` 验 DB 与 embedding；不要运行 flush/reindex 来修简单连通问题。
3. 核对 backend 能访问模型/嵌入服务，实际 worker/scraper 则使用已授权隔离网络。官方 PROXY_URL 不覆盖所有 worker/scraper 流量；只配置 backend 代理或创建一个 internal 网络不构成隔离完成。
4. 对**实际任务容器**检查网络挂载、特权、host网络、host PID和Docker socket；将 worker 保持无宿主Docker访问。出网验证使用同一阴性目的地：对照网络可达、任务网络被阻断，允许目标同时可达；DNS/工具缺失不能算阻断成功。验证多个实际外部目的地及宿主机受限入口，记录边界，不把一次HTTP阻断写成所有网络完全安全。
5. 有界任务只访问白名单中的本地靶标。禁用不需要的研究/搜索/主动利用能力，并保留尝试但未成立的结果。等最终报告或明确失败，不能把 flow running/HTTP 200 当作完成。

需要可复用的实际 worker 验证时，使用 `scripts/verify-network.py`；脚本输出实际容器身份、网络和探针结果，失败不能进入目标测试。它不证明 Docker 内核、平台本身或任意新容器永远安全。
