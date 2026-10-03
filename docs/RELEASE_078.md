# 0.7.8-dev 测试与交接

2026-09-25。应用 0.7.8-dev，Android versionCode 708，解析器 0.9.7。iOS 工程仅更新版本元数据 0.7.8/708，未在 Mac 编译，没有 IPA。未公开发行，也未覆盖 D 盘旧安装或此前测试包。

## 变化

- 配装册原子读改写，失败时保留旧记录，不切换数据库、不静默丢弃第 51 套以外的数据。
- 旧数据迁移等待提交；空库不复活旧记录；损坏记录不当作空库覆盖。
- 收藏、删除和初始加载有清晰错误提示与操作锁。
- 角色已保存／配装册未合并的部分成功单独提示，同版本可以重试，无需转存 JSON。
- 手机离开同步页暂停自动接收。保留原先的 Android 证书验证与同步协议保护。
- 完整说明见 BUILD_STORAGE_078.md；没有新增已验证的最终人物字段，也未改动 Figma 格局。

## 验证状态

- 前端 21 个文件、177 项测试通过；TypeScript 与网页生产构建通过。
- 113 项 Python 测试，112 通过、1 因 Windows 符号链接权限跳过；36 组 Java 二维码、16 组 DER 证书用例通过。
- 原生资源、Android assembleDebug 和 APK 验签通过，沿用原调试证书；Windows 构建、目录／ZIP 检查及新 EXE 合成档案 TLS 联调通过，测试进程已退出。
- 旧 Windows 构建缓存无法读取，保留原缓存，通过新的独立缓存目录离线安装已锁定哈希依赖完成构建；新增 `-DesktopRuntimePath` 参数并恢复调用方 PYTHONPATH。不更改系统权限。
- 源码包独立解压验证结果以包旁 VERIFIED.md 为准；不能用旧 0.7.7 包验证这些新修复。
- iOS 编译／真机、Windows 新窗口交互、Android 真机升级仍需验收；自动测试不能替代。

## 验收重点

保留旧应用及其设备数据。在新版本收藏两套不同名称配装，关闭再打开确认都在；通过电脑发布，手机扫码接收，再关闭电脑和手机网络查看。配装册满时应明确失败并保留已有记录。模拟写入失败已由自动测试覆盖，不要求用户填满手机。不要卸载旧 APK 或清除应用数据来“解决”错误。

## 产物

- Windows：`release/windows-0.7.8-dev/Nioh2SaveCompanion/Start-Sync-Test.cmd`。
- Windows ZIP：`release/仁王2存档伴侣-0.7.8-dev-windows-x64.zip`，SHA-256 `1D579D19AD83FC850EA88924A752A5E23BDBBF77F1DAFDCC81B647F0153B0FEB`。
- APK：`release/android-0.7.8-dev/nioh2-companion-0.7.8-dev-debug.apk`，SHA-256 `5C50A907A98EAE0672D38E56D1CF3564B58F59C23DA29F702AEBC1FA9F77FD0C`。
- APK 证书 SHA-256：`de1b03eb5af71041737b3c5c6918c461873edc892ad2de6579213a68017b3e59`；仍为内部调试签名，不是生产发布签名。
- 私有源码：`release/source-0.7.8-dev/nioh2-source-private.zip`，独立摘要与文件清单一并提供，不包含私人存档或研究报告。没有推送 GitHub。
