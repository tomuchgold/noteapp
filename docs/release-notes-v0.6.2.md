## NotePP v0.6.2 — 文件列表可隐藏 + 面板拖宽

响应需求：**左侧文件列表应该能隐藏，或用鼠标拖动大小**。

### 新增
- **文件列表显隐开关**：菜单栏「列表」按钮 / 快捷键 `Ctrl+Shift+B`（侧栏仍是 `Ctrl+B`）
- **面板拖动条（Splitter）**：侧栏与文件列表之间、文件列表与编辑器之间各有一条，鼠标拖动即可调整宽度
  - 侧栏宽度范围 140–400px，文件列表 180–520px
  - **双击拖动条复位**默认宽度
- **布局持久化**：显隐状态与宽度存入本地（`notepp.layout`），重启后保持
- 顺带修复：`Ctrl+B` 快捷键的陈旧闭包问题（隐藏后再按可能失效）

### 交互细节
- 拖动条悬停/拖拽时高亮为蓝色，宽 5px
- 隐藏某个面板时，它旁边的拖动条一并隐藏
- 最小宽度钳制，不会把面板拖没或把编辑器挤扁

### 安装
- macOS（Apple Silicon / Intel）：`.dmg`（`NotePP_0.6.2_aarch64.dmg`）
- Windows：`.msi` 或 `_x64-setup.exe`
- Linux：`.deb` / `.rpm` / `.AppImage`

> ⚠️ macOS 首次打开若提示「已损坏」，是 Gatekeeper 对未签名应用的拦截，非文件损坏。
> 最快解决：`xattr -cr /Applications/NotePP.app`，更多见 [docs/INSTALL.md](https://github.com/tomuchgold/noteapp/blob/main/docs/INSTALL.md)

### 质量验证
10 项 UI 自动化测试全部通过：显隐按钮、快捷键、拖宽（264→384px）、刷新持久化、双击复位、隐藏联动。

---
- v0.6.1：Ctrl/⌘ + 滚轮缩放字号
- v0.6.0：三栏布局 / 文件分类 / 文件夹浏览树 / 样式设置面板
