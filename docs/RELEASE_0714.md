# 0.7.14-dev 持续开发记录

2026-09-25。应用 0.7.14-dev / native build 714；解析器 0.9.7 不变。

## 修复

- 装备/绘卷详情仅保存选择身份，从当前档案获取字段；同编号档案更新不显示旧值。
- 配装槽位还需物品身份相符；仓库沿用当前装备优先规则。记录移除、角色切换后清除详情，之后恢复同角色不自行重开。
- 返回仓库保留搜索/筛选状态。主页面布局和 Figma 不改动。
- 图片分享生成期间即时加锁；切换配装或离开页面后不打开迟到的系统分享面板，旧结果不附到新配装，旧定时器不清掉新结果。
- 主动取消仍是中性状态；失败可重试。图片默认文件名不带快照身份。
- 导出时间无效时提前拒绝，避免生成无法接收的档案。

## 验证

- 354 项前端测试、网页和共享原生前端构建通过。
- Python 140 项中 139 通过、1 因 Windows 符号链接权限跳过。
- Java 36 项配对、16 项 DER 证书测试通过；跨平台版本/标识/SPM 静态契约通过。
- Windows 311 文件目录、312 ZIP 成员检查通过；实际 EXE 合成档案 TLS 配对、读取、再次发布、撤销及请求隔离通过。
- Android APK 构建及 v2 验签通过，沿用旧调试证书；不是生产签名。
- 源码独立解压验证以 source-0.7.14-dev/VERIFIED.md 为准，未写入前不得视为完成。
- 本版未做实体 Android/iPhone 或 Mac Xcode 验收；没有公开上传、替换 D 盘安装或写入原始游戏/存档。

## 解析

518 个已解包容器的任意排列搜索无完整匹配，未截断且输入哈希未变，详见 GUARDIAN_LINK_RESEARCH.md。164 行截图分类仍为 11 直接匹配、37 最终面板待验证、58 效果来源候选、58 未定位，不实现面板推算。

## 产物

- Windows：`release/windows-0.7.14-dev/Nioh2SaveCompanion/Start-Sync-Test.cmd`
- ZIP：`release/仁王2存档伴侣-0.7.14-dev-windows-x64.zip`，SHA-256 `52F63784AA08E61E291CFE9DB0A243981D4B9EC5E7A10AB76EE94C344474D969`
- APK：`release/android-0.7.14-dev/nioh2-companion-0.7.14-dev-debug.apk`，SHA-256 `E2C1DF2E9E74A4F4B01E04A9E714089F1C7480B26FE5E8318683C8C0683C91AF`
- 私有 Mac 源码交接：`release/source-0.7.14-dev/nioh2-source-private.zip`，配合清单和 VERIFIED.md；不迁移真实角色、密钥或研究副本。
