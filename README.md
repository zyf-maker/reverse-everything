# Reverse Replica / Replica Workbench

用于获得授权后的行为分析、独立重建、确定性回放与验证。仓库包含技能、Python Workbench、JavaScript 静态分析器/CDP runtime，以及供 Codex、Claude Code 和其他 MCP host 使用的插件。

## 下载与使用

Windows x64 成品见 [v0.1.1 Release](https://github.com/zyf-maker/reverse-replica/releases/tag/v0.1.1)。下载 `replica-workbench-mcp-win-x64-v0.1.1.zip` 并核对 `.sha256`，解压后执行：

```powershell
.\install-host.ps1 -Agent codex
# 或 .\install-host.ps1 -Agent claude
.\runtime\node.exe .\server\doctor.mjs
```

成品包含 Node.js、Python、无品牌 Chromium 和依赖；仍需安装支持本地 stdio MCP 的 Agent host。通用 host 可使用包内 `mcp.json`。这是 Windows x64 发行包，macOS/Linux 构建尚未验证。

## 目录

- `SKILL.md`、`scripts/`、`references/`：原有 Reverse Replica 技能。
- `replica-mcp-plugin/`：11 个 MCP 工具、host 注册脚本、发行构建与许可证校验。
- `replica-workbench/`：case、授权范围、证据、回放验证和报告。
- `own-reverse-platform/`：静态分析器与 CDP runtime。
- `target-2048/`、`replica-2048/`：对照 fixture 与独立实现，保留各自许可。
- `docs/research/chromium-notices.md`：Chromium notice 问题的依据和修复记录。

## Chromium notice 修复

v0.1.1 已更换旧 snapshot，固定使用 ungoogled Chromium `155.0.8059.79-1.1`，核对上游 archive SHA-256。构建从实际打包的浏览器导出 770 条 credits，提供离线 HTML、纯文本、原始导出和组件/哈希清单，并附 Chromium、ungoogled Chromium 的许可。遇到样例 credits、缺失许可或组件数量不符时停止打包。

同一 Release 提供 Chromium 对应源码（约 2 GB）和两个精确版本的补丁/构建源码包。转发二进制时同时提供这些源码材料和 `licenses/SOURCE_CODE.md`。这是对已发现缺口的技术修复，不表示取得独立法律认证。详细内容见 [插件文档](replica-mcp-plugin/README.md)。

## 从源码运行和检查

安装 Python 3.10+、Node.js 20+，在 `own-reverse-platform/runtime` 与 `replica-mcp-plugin` 分别执行 `npm ci`。工作目录保留空的 `replica-workbench/work/` 用来存放新建 case。插件的源码模式安装见其 README。

```powershell
cd replica-mcp-plugin
npm test
python -m unittest discover -s test -p test_browser_notices.py -v
.\build.ps1
```

完整发行材料校验（`verification/` 放入 `source-lock.json` 列出的三个源码包）：

```powershell
python replica-mcp-plugin/scripts/verify_release.py --archive replica-mcp-plugin/dist/replica-workbench-mcp-win-x64-v0.1.1.zip --sources verification
node verification/plugin-package-smoke.mjs replica-mcp-plugin/dist/replica-workbench-mcp-win-x64-v0.1.1
```

项目运行过程中仍须记录目标授权与范围；MCP 端不能自行授予授权。
