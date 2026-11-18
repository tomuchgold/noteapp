# NotePP v0.10.0 发布说明

发布日期：2026-11-18

## 新功能

### 查找替换（重做）
- 全新**中文查找栏**（Ctrl+F / Ctrl+H）：实时高亮全部命中，当前命中橙色标注，`n / N` 或 Enter / Shift+Enter 循环跳转
- **全部替换**带结果提示（「已替换 N 处」），非正则模式保留大小写（`foo → bar` 得 `bar BAR Bar`）
- 区分大小写（Aa）/ 全字匹配（ab）/ 正则（.*）三开关；非法正则实时标红
- **在文件夹中查找**：对左侧打开的文件夹全局搜索，结果按文件分组、显示行号与内容，双击直达对应行；上限 2000 条、单文件 4MB、自动跳过 node_modules/.git/target/dist
- Ctrl+F 自动带入选中文本；Esc 关闭；原英文内置面板停用

### Android APK
- GitHub Actions 自动构建**自签名通用 APK**（arm64 / armv7 / x86_64），随 Release 发布
- 移动端响应式布局：窄屏下侧栏/文件列表变抽屉（带遮罩，点击关闭），菜单栏横向滚动，文件打开后自动收起抽屉

### 修复 / 其他
- Rust `search_in_folder` 命令（递归 + 后缀白名单 + 大小写/全字/正则）
- 查找计数与跳转共用同一份匹配逻辑，杜绝「面板 12 处、实际 9 处」的口径问题

## 安装 / 升级

- 桌面端：见 [INSTALL.md](./INSTALL.md)；macOS「已损坏」执行 `xattr -cr /Applications/NotePP.app`
- Android：下载 `app-universal-release.apk`，允许「安装未知来源应用」（自签名，构建脚本见 `.github/workflows/android.yml`）

## 已知限制
- Android APK 为自签名，不能上 Google Play；移动端布局为 v1，触摸右键菜单体验待打磨
- 官网 https://notepp.ambook.vip 为纯静态发布页（仓库 site/ 目录）
