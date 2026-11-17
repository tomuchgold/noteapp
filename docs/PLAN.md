# NotePP 项目计划 — 类 Notepad++ 三端通用文本/代码编辑器

> 基于 Tauri 2，一套代码同时构建 **macOS (Apple Silicon)** / **Windows (x64)** / **Linux (x64)** 三端应用。

## 1. 目标

模仿 Notepad++ 的核心使用体验，做一个轻量、启动快、跨平台的文本/代码编辑器 NotePP：

| 特性 | 说明 |
|---|---|
| 多标签编辑 | 多文件同时打开、切换、关闭，未保存标记 `●` |
| 语法高亮 | JS/TS/JSX/HTML/CSS/JSON/Markdown/Python/Rust/C++/Go/Java/SQL/XML/YAML 等，按文件类型自动识别 |
| 编辑增强 | 行号、代码折叠、括号匹配、自动缩进、多光标、当前行高亮、字符/行列定位 |
| 查找替换 | 当前文件查找/替换，支持正则、大小写敏感、全部替换、匹配计数 |
| 文件操作 | 打开/保存/另存为（系统原生对话框）、拖拽打开、编码检测（UTF-8 / GBK）、换行符 CRLF/LF |
| 三端打包 | macOS aarch64 (.app/.dmg)、Windows x64 (.msi/.exe)、Linux (.deb/.AppImage) |

**不在首版范围**（记入 Roadmap）：插件系统、宏录制、大文件模式（>100MB）、文件对比、会话恢复。

## 2. 技术选型

| 层 | 选择 | 理由 |
|---|---|---|
| 应用框架 | **Tauri 2** | Rust 后端，产物体积小（~10MB），三端统一，安全（默认 deny-all capability） |
| 前端 | **Vite 7 + React 19 + TypeScript** | 快速 HMR，类型安全 |
| 编辑器内核 | **CodeMirror 6** | 模块化、性能好、语法包齐全（对标 Notepad++ 的 SciTE 内核体验） |
| 后端命令 | Rust：`read_file` / `write_file`（含 GBK↔UTF-8 转码、BOM 处理、换行符检测） | encoding_rs 处理中文编码 |
| 插件 | `@tauri-apps/plugin-dialog`（文件对话框）、`@tauri-apps/plugin-fs` | 官方维护 |
| 打包 | Tauri bundler + GitHub Actions 三平台矩阵 | CI 出安装包 |

## 3. 里程碑与任务拆解（对应看板）

1. **M1 项目计划与技术选型** — 本文档。
2. **M2 项目骨架** — Vite + React + TS + Tauri 2 脚手架、目录结构、`tauri.conf.json`。
3. **M3 核心编辑器** — CodeMirror 6 集成：行号/折叠/高亮/主题/语言自动识别。
4. **M4 多标签页** — TabBar 组件、脏状态、关闭确认、`Ctrl+Tab` 切换。
5. **M5 文件读写** — Rust 命令 + 编码检测 + 对话框 + 拖拽 + 最近文件。
6. **M6 查找替换/状态栏/快捷键** — 查找面板、状态栏（行:列/编码/行数/换行符）、全套快捷键。
7. **M7 三端构建** — bundle 配置、应用图标、GitHub Actions 矩阵、README 构建说明。
8. **M8 代码入库** — 全部源码归档到项目资产 `notepp/` 文件夹。

## 4. 目录结构

```
notepp/
├── src/                  # 前端 React
│   ├── components/       # Editor / TabBar / StatusBar / FindPanel
│   ├── lib/              # 语言检测、编码换行符工具、命令封装
│   └── styles/
├── src-tauri/            # Rust 后端
│   ├── src/              # main.rs / lib.rs / commands
│   ├── capabilities/     # Tauri 2 权限清单
│   ├── icons/
│   └── tauri.conf.json
├── .github/workflows/    # 三平台 CI 打包
├── docs/PLAN.md
└── README.md
```

## 5. 验收标准

- `pnpm tauri dev` 可运行；`pnpm tauri build` 三端（CI）产出安装包。
- 打开含 GBK 编码的中文文本不乱码；保存保留原编码与换行符。
- 标签页脏状态正确；关闭前弹保存确认。
- 查找替换支持正则与全部替换；状态栏行列实时更新。
