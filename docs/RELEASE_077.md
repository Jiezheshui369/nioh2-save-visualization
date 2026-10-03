# 0.7.7-dev 测试与交接

2026-09-25。应用 0.7.7-dev、Android versionCode 707、解析器 0.9.7。iOS 工程标记 0.7.7/707，Windows 无法验证其 Swift/Xcode 构建，没有 IPA。不属于公开发行。

## 本轮变化

- Android 补齐二维码固定证书的 IP SAN 校验；16 组合成 DER 证书正／负面用例。细节见 SYNC_HARDENING_077.md。
- 手机配对成功但本地保存失败可直接拉取重试，清除过期成功提示；重复扫码和轮询有锁；迟到状态不覆盖新的配对或断开结果。
- 电脑发布／停止后丢弃旧轮询响应，避免已关闭的同步界面被“复活”。TLS 服务端严格校验认证与空请求体头。
- 应用比较两个副本时只统计变化，不再建立完整字节索引和十六进制列表。研究 CLI 强制副本边界、新输出、大小及预览限额。
- 守护灵／魂核关系工具取得结构候选，未接入正式角色数据；最终面板／佩戴绘卷仍未完整解析。见 GUARDIAN_LINK_RESEARCH.md。
- 沿用已确认布局；React／前端技能仅用于异步状态与提示的实现。本轮未更改 Figma。

## 自动验证

- 20 个前端文件，157 项测试通过。
- 113 项 Python 测试，112 通过、1 因 Windows 符号链接权限跳过。
- 36 组 Java 二维码、16 组 DER 证书用例通过。
- 网页生产构建、Android 原生资源同步和 assembleDebug 通过；APK 验签通过，调试证书与 0.7.6 相同。
- Windows EXE、目录／ZIP 内容校验通过。实际新 EXE 的合成档案 TLS 联调通过：证书 pin＋IP SAN、单次邀请、拉取、路由隔离、撤销；测试进程已退出。
- 两份不同内容的已有副本比较得到 283 个变化字节／52 个合并区段，读取前后哈希一致。164 行截图核对仍为 11 直接匹配、37 最终面板待验证、58 效果有来源候选、58 无同名来源；没有虚增解析覆盖。
- 迁移包以独立 `SHA256SUMS.txt`、`HANDOFF_MANIFEST.json` 和最终 `VERIFIED.md` 为准；iOS 编译／真机与新版 Android／Windows 真机 UI 验收尚未完成。

## 产物（旧包均保留）

- Windows：`release/windows-0.7.7-dev/Nioh2SaveCompanion/Start-Sync-Test.cmd`。
- Windows ZIP：`release/仁王2存档伴侣-0.7.7-dev-windows-x64.zip`。
- Windows ZIP SHA-256：`94290CAC5F4C7980656A86A34B8DE7404833B9576DA3CE87058C22E0552D274B`。
- Android：`release/android-0.7.7-dev/nioh2-companion-0.7.7-dev-debug.apk`。
- APK SHA-256：`1365D2BAE765065DB5ED3C4DF4E998C82D2D0BAE8333FD8C7B495865C31CEF44`。
- APK 证书 SHA-256：`de1b03eb5af71041737b3c5c6918c461873edc892ad2de6579213a68017b3e59`，仍是内部调试签名。
- Mac 私有源码：`release/source-0.7.7-dev/nioh2-source-private.zip`；不是完整研究目录，不包含个人存档或报告。

包内说明是构建时快照；最新结果看源码 docs 和 VERIFIED.md。没有安装／覆盖 D 盘旧应用，没有操作原始存档，没有公开 GitHub。

## 升级验收

1. 保留旧版本和手机资料；不要卸载旧 APK 或清除应用数据。
2. 新 Windows 包开启后，导入存档只生成独立副本；主动发布角色到手机。
3. 使用新 APK 在同一可信 Wi-Fi 扫码并确认，核对角色／装备信息。
4. 再次接收失败时不应同时显示旧成功提示；已有离线档案仍在。
5. 断开配对只删连接凭据，不删除手机角色；重新配对使用电脑的新二维码。
6. 关闭电脑／断网后重启手机 App，仍可查看已经成功持久保存的角色。

存储耗尽不建议通过塞满个人手机来制造；自动测试覆盖写入失败，后续可在受控测试设备验证。任何 Java 或浏览器模拟都不等于完成真机权限、TLS、相机、离线重启验收。
