# NotePP

类 Notepad++ 的轻量跨平台文本 / 代码编辑器，基于 **Tauri 2 + React 19 + CodeMirror 6**，  
一套代码同时构建 **macOS (Apple Silicon)** / **Windows (x64)** / **Linux** 三端应用。

![平台](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue)
[![三端构建](https://github.com/tomuchgold/noteapp/actions/workflows/build.yml/badge.svg)](https://github.com/tomuchgold/noteapp/actions/workflows/build.yml)

> 仓库：https://github.com/tomuchgold/noteapp ｜ 安装包：见 Releases 或 Actions 构建产物
>
> 📖 **安装说明**（macOS「已损坏」/ Windows SmartScreen 提示的解决办法）见 [docs/INSTALL.md](docs/INSTALL.md)

## 功能特性

- ✅ 备忘录式三栏布局：左侧**分类侧栏** + 中间**文件列表** + 右侧编辑器，`Ctrl+B` 折叠侧栏
- ✅ 编辑器样式设置：字号 / 行高 / Tab 宽度 / 自动换行 / 空白符可视化 / 当前行高亮 / 暗亮主题，实时生效并持久化
- ✅ 文件夹浏览：侧栏内置目录树，打开文件夹后逐层展开、直接点开文件（隐藏文件自动过滤）
- ✅ 文件分类管理：打开过的文件自动进入文件库，可新建分类（带颜色）、右键归类、收藏置顶、搜索过滤；所有数据本地持久化
- ✅ 多标签编辑：多文件同时打开、`Ctrl+Tab` 切换、中键关闭、未保存 `●` 标记
- ✅ 语法高亮：JS/TS/JSX/HTML/CSS/JSON/Markdown/Python/Rust/C/C++/Java/Go/SQL/XML/YAML/Shell/Lua/Pascal/Fortran/Perl/Ruby 等 25+ 语言，按扩展名自动识别
- ✅ 编辑增强：行号、代码折叠、括号匹配/补全、自动缩进、当前行高亮、选区匹配高亮、多光标
- ✅ 查找替换：`Ctrl+F` 打开搜索面板，支持正则、大小写敏感、全部替换
- ✅ 文件操作：系统原生打开/保存对话框、拖拽文件入窗、最近文件列表（10 条）
- ✅ 编码支持：UTF-8（含 BOM）/ GBK / UTF-16 自动检测，状态栏一键切换保存编码
- ✅ 换行符：LF / CRLF / CR 识别与保存时归一化
- ✅ 会话恢复：重启后自动还原上次打开的标签页
- ✅ 文件对比：任意两个文件左右分栏 Diff 视图，删除/新增高亮，未变化区域自动折叠
- ✅ 宏录制与回放：录制输入与按键动作后一键重放，`Ctrl+Shift+R` 录制 / `Ctrl+Shift+P` 回放
- ✅ 状态栏：行列号、选中字符数、总行数、语言、编码、换行符实时显示

## 快捷键

| 快捷键                    | 功能   |
| ---------------------- | ---- |
| `Ctrl/Cmd + N`         | 新建文件 |
| `Ctrl/Cmd + O`         | 打开文件 |
| `Ctrl/Cmd + S`         | 保存   |
| `Ctrl/Cmd + Shift + S` | 另存为  |
| `Ctrl/Cmd + F`         | 查找替换 |
| `Ctrl/Cmd + W`         | 关闭标签 |
| `Ctrl + Tab`           | 切换标签 |
| `Ctrl + Shift + R`     | 录制宏 / 停止录制 |
| `Ctrl + Shift + P`     | 回放宏 |
| `Ctrl + B`             | 显示/隐藏侧栏 |

菜单栏「对比」可打开文件对比视图：从已打开标签或磁盘选择两个文件，左右分栏查看差异。

## 本地开发

```bash
git clone https://github.com/tomuchgold/noteapp.git && cd noteapp

# 前置依赖：
#   Node.js 22+ / pnpm 10+ / Rust stable
#   Linux: sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
#   macOS: xcode-select --install
#   Windows: WebView2（Win10/11 自带）

pnpm install
pnpm tauri dev     # 开发模式（热重载）
pnpm tauri build   # 构建当前平台安装包
```

构建产物位于 `src-tauri/target/release/bundle/`：

| 平台                    | 产物                                |
| --------------------- | --------------------------------- |
| macOS (Apple Silicon) | `dmg/*.dmg`、`macos/*.app`         |
| Windows               | `msi/*.msi`、`nsis/*.exe`          |
| Linux                 | `deb/*.deb`、`appimage/*.AppImage` |

## 安装常见问题

macOS 首次打开提示「已损坏」、Windows SmartScreen 拦截均为未签名应用的标准提示，解决办法见 **[docs/INSTALL.md](docs/INSTALL.md)**。

## 三端打包（CI）

推送到 `v*` 标签或手动触发 GitHub Actions（`.github/workflows/build.yml`），  
矩阵自动在 macOS / Windows / Ubuntu 三平台构建并发布 Release 附带安装包。

```bash
git tag v0.1.0 && git push --tags
```

## 目录结构

```
notepp/
├── src/                     # 前端 React
│   ├── components/          # Editor / TabBar / StatusBar
│   ├── lib/                 # 语言检测、文件命令封装、类型
│   └── styles/app.css
├── src-tauri/               # Rust 后端
│   ├── src/commands.rs      # read_text_file / write_text_file 命令（编码检测与转码）
│   ├── capabilities/        # Tauri 2 权限清单
│   ├── icons/               # 三端图标（icns / ico / png）
│   └── tauri.conf.json
├── .github/workflows/       # 三平台 CI 打包
└── docs/PLAN.md             # 项目计划
```

## Roadmap

- [x] 会话恢复（重启后还原上次打开的标签）
- [x] 文件对比（Diff 视图）
- [x] 宏录制与回放
- [ ] 插件系统（类比 Notepad++ 插件生态）
- [ ] 大文件模式（>100MB 分块加载）
- [ ] 列编辑模式（Alt+拖拽块选）
- [ ] 自动更新（内置升级检查）
