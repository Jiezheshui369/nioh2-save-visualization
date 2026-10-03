# 本机 Android 开发环境安装记录

2026-09-23 更新：0.7.2 新测试入口为 D:\Android\apk-tests\Nioh2-PC-0.7.2\Start-Sync-Test.cmd 与同目录上一级的 nioh2-companion-0.7.2-dev-debug.apk。请遵循 ANDROID_SYNC_TEST.md：电脑导入、手机扫码同步，不再把 JSON 传入手机作为主流程。下方为历史安装记录。

安装日期：2026-09-21。用户指定 D 盘；未改动原始游戏、存档文件或系统全局 Java/PATH。

## 位置

- Android Studio 官方 ZIP 版：`D:\Android\android-studio`
- 建议启动入口：`D:\Android\Start-Android-Studio.cmd`
- 编译用 Java 21：`D:\Android\jdk-21`
- Android SDK：`D:\Android\sdk`
- Gradle 缓存：`D:\Android\gradle-cache`
- Android 工具配置：`D:\Android\user`
- 构建临时目录：`D:\Android\temp`
- Studio 配置、索引、插件和日志：`D:\Android\studio-*`（使用上方启动入口时生效）
- 原始安装 ZIP：`D:\Android\downloads`，保留以便重装与校验。

项目源码仍留在原来的 C 盘项目目录；此次没有迁移项目，也没有安装模拟器镜像或修改虚拟化/防火墙设置。

## 版本与校验

| 组件 | 安装版本 | 验证 |
| --- | --- | --- |
| Android Studio | Quail 4 / 2026.1.4 Patch 1，build 261.26222.65.2614.16379836 | 官方 SHA-256 一致，studio64.exe 的 Google LLC 签名有效 |
| Studio 自带运行时 | OpenJDK 25.0.3 | java -version 成功；仅运行 IDE，不用于当前 Gradle |
| Eclipse Temurin JDK | 21.0.12.1+1 LTS | 官方 SHA-256 一致，java.exe 的 Eclipse Foundation 签名有效 |
| SDK Command-line Tools | 22.0 | 官方 SHA-256 一致；sdkmanager 已提示未来改用 Android CLI |
| Android SDK Platform | Android 16 / API 36，revision 2 | source.properties 已核对 |
| Build-Tools | 35.0.0 | source.properties 已核对 |
| Platform-Tools | 37.0.1 | source.properties 已核对 |
| Gradle | 8.14.3 | 项目 wrapper 从官方分发站下载到 D 盘缓存 |

官方下载来源：[Android Studio](https://developer.android.com/studio)、[Eclipse Adoptium Java 21 元数据](https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse)。

安装包 SHA-256：

```text
android-studio-quail4-patch1-windows.zip
2b884e086b5afaa63049dc5ea79b1cf6fb1b885bad91b7ea226b8cd88bb37eb6

commandlinetools-win-15859902_latest.zip
90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a

OpenJDK21U-jdk_x64_windows_hotspot_21.0.12.1_1.zip
f9d6e191ab098c0d416e7d588a24420a8621cd2f4720dab2459b8b7b2d2d8b4e
```

SDK 安装流程中的 Android SDK License 已接受；没有注册 Google 账户、启用遥测或购买服务。

## 使用方式

双击 D 盘启动入口即可打开 Studio。首次运行可能仍出现欢迎/偏好向导；SDK 路径选 `D:\Android\sdk`，Gradle JDK 选 `D:\Android\jdk-21`。避免直接点程序目录内 exe，以免绕过 D 盘配置入口。

项目命令行构建：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\build-android.ps1 -CheckOnly
powershell -NoProfile -ExecutionPolicy Bypass -File .\build-android.ps1
```

构建脚本会自动发现 D 盘安装；只在当前进程设置环境变量，退出后恢复。第一次 Gradle 运行出现 Java NIO 临时套接字 `Unable to establish loopback connection`，将 TEMP/TMP、java.io.tmpdir 和 jdk.net.unixdomain.tmpdir 定向到 D 盘短路径后已能启动构建。此兼容设置已加入脚本和 Studio 启动入口，不需要关闭安全软件或修改防火墙。

## 首次 APK 构建验证

- Gradle `assembleDebug`：成功，154 个任务执行，首次耗时 2 分 39 秒。
- 前端自动测试：53 项通过。
- APK 签名：v2 验证通过（调试签名，不能作为正式发布签名）。
- APK 大小：4,414,658 字节；包名 `com.jiezheshuizz.niohcompanion`，版本 `0.7.1-dev`。
- 测试文件：`D:\Android\apk-tests\nioh2-companion-0.7.1-dev-debug.apk`。
- SHA-256：`82ef144a7a433a28a967ab0e6446ab35177990a9f56e6db3419676ea7e8b8617`。
- 检查包内资源路径：未包含原档、演示快照或 Katana 解析器；没有把真实角色数据打包进安装文件。
- 尚未安装到手机/模拟器；文件选择器、分享、离线重启仍需真机验收。
