## NotePP v0.8.0 — 流式 AI / 更新检查 / 大文件模式 / 列编辑

四项一起交付，都是编辑器从「能用」到「顺手」的关键差距。

### 1. AI 流式输出
- 回复**边生成边显示**，长文本不必干等整段返回
- 后端用 SSE 逐段转发（Rust reqwest stream → `ai://chunk` 事件），前端增量拼接
- token 用量、模型名照旧显示，可随时关闭弹窗中断

### 2. 版本更新检查
- 启动时静默比对 GitHub 最新 Release，有新版本时菜单「更新」按钮高亮
- 弹窗显示版本对比、更新说明，「打开发布页」直接跳转下载
- **私有仓库**：可填只读 Token，或把「更新源」换成任何返回 `{"tag_name": "...", "html_url": "..."}` 的地址（自建清单）
- 说明：这是「检查 + 提示下载」，未做静默自动安装——那需要 Apple/Windows 代码签名与 updater 签名密钥，涉及证书成本，留作后续

### 3. 大文件模式
- 打开超过 **8MB** 的文件自动进入只读分块模式：先读 1MB，横幅显示「已加载 X / 共 Y」
- 「再加载 1MB」按需追加，内存占用可控，2GB 日志也不会卡死
- 分块读取在 Rust 侧做 UTF-8 边界对齐，不会切坏中文
- 只读保护：直接输入无效，Ctrl+S 会提示

### 4. 列编辑模式
- 菜单「列选」开启后，**拖拽即矩形选区**（不必按 Alt），多行同时输入
- 十字光标提示当前处于列选模式，状态持久化
- 实现要点：CodeMirror 默认不允许**多选区**，需显式开启 `allowMultipleSelections`，否则矩形选区会被折叠成单行——这版一并修好了多光标能力

### 安装
- macOS：`NotePP_0.8.0_aarch64.dmg`
- Windows：`.msi` / `_x64-setup.exe`
- Linux：`.deb` / `.rpm` / `.AppImage`

> ⚠️ macOS 首次打开提示「已损坏」是 Gatekeeper 拦截：`xattr -cr /Applications/NotePP.app`，详见 [docs/INSTALL.md](https://github.com/tomuchgold/noteapp/blob/main/docs/INSTALL.md)

### 质量验证
- Rust：`cargo check` 通过；新增 `ai_chat_stream` / `check_update` / `file_info` / `read_file_chunk` 四个命令
- 前端：**35 项 Playwright 测试全过**
  - AI 22 项（含配置导入导出、右键菜单、流式拼接、替换写入）
  - 新增 13 项（更新弹窗、流式输出、大文件横幅与分块加载、只读保护、列选开关与持久化）
  - 列编辑实测：三行同时插入字符，验证矩形多选区真实生效

---
- v0.7.0：AI 选中文本操作（多厂商配置）
- v0.6.2：文件列表可隐藏 + 面板拖宽
- v0.6.1：Ctrl/⌘ + 滚轮缩放字号
