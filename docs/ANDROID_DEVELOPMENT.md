# Android 开发与首轮验收

2026-09-23 更新：已实现 0.7.2 原生 LocalSync 插件，使用 JourneyApps 扫码、单请求 TLS 指纹绑定、私有应用设置保存临时设备凭据；网页不持有设备令牌、不调用旧 HTTP 存档接口。主流程是电脑导入解析、扫码直传、离线展示。构建及自动化测试通过，真机待验收。请按 ANDROID_SYNC_TEST.md 测试；下方手动档案导入通路保留为兼容备份，不是主流程。

状态：2026-09-21 已按用户要求将开发环境安装至 D 盘，并首次成功编译调试 APK。APK 签名与资源路径检查通过，尚未运行模拟器或完成真机验收。安装明细见 `ANDROID_INSTALLATION.md`；编译成功不代表功能已经真机验证。

## 已实现的数据路径

电脑只读解析独立副本 → 导出 `nioh2-character-assets` 1.0.0 JSON → 通过用户选择的文件传输方式送到手机 → 应用内“导入档案包” → 系统文件选择器 → IndexedDB 本机保存 → 离线查看。

- 手机不调用电脑 `/api`，不轮询电脑，不使用 Steam 登录或云存档接口。
- 原生包内置前端资源，不注册 Web Service Worker，不依赖域名和局域网。
- 首次安装为空档案；APK 不包含测试人物、用户存档或解析器。
- 明确导入时，角色、来源元数据与索引在同一事务提交；失败保留旧记录，不提示成功。
- 配装册为独立数据库：角色保存成功但配装合并失败时明确提示部分成功，可重试。两库并非一个原子事务。
- 档案包、配装图片与文字使用 Android 系统分享面板；文件暂存于应用私有 `cache/shares/`，只授予接收应用临时 URI 读取权限。不会自动上传。
- 分享缓存暂由系统缓存回收管理；为了接收应用继续读取，不在分享结束后立即删除。长期清理策略仍待补充。
- 禁用 Android 自动云备份和设备迁移备份；卸载或清除应用数据会丢失本机资料，请保留导出的 JSON。
- 尚未实现从聊天软件“用此应用打开”直接接收文件；本轮入口是应用内文件选择器。

## Windows 构建前置条件

1. Node.js 22 或更高版本（当前电脑为 24.14.0）。
2. Android Studio 2025.2.1 或更新版本，以及用于本项目编译的 JDK 21。本机已装 Studio 2026.1.4 Patch 1；其自带 Java 25 仅供 IDE 使用，编译使用单独安装的 Temurin 21。
3. SDK Manager 安装 Android SDK Platform 36、Build-Tools 和 Platform-Tools。
4. 模拟器或 Android 真机，用于安装与离线重启测试。

官方环境要求：[Capacitor 环境设置](https://capacitorjs.com/docs/getting-started/environment-setup)。工程当前使用 minSdk 24、target/compileSdk 36；最低平台配置不代表所有旧设备都已验证，WebView 兼容性必须实测。

在项目目录运行：

```powershell
npm ci
powershell -NoProfile -ExecutionPolicy Bypass -File .\build-android.ps1 -CheckOnly
powershell -NoProfile -ExecutionPolicy Bypass -File .\build-android.ps1
```

JDK/SDK 安装在其他位置时传 `-JdkPath` 和 `-SdkPath`。脚本只在当前进程设置环境变量，退出后恢复；自动识别本机 D 盘安装，Gradle 缓存使用 `D:\Android\gradle-cache`（其他设备无 D 盘配置时回退到项目 `.build/gradle`），也可传 `-GradleCachePath`。首次构建需联网下载 Gradle 和 Maven 依赖，不会下载或上传存档。

成功后的调试 APK：`android/app/build/outputs/apk/debug/app-debug.apk`。这不是供 GitHub 正式发布的已签名发行包。包名暂定 `com.jiezheshuizz.niohcompanion`，正式分发前确认；不要随意修改已分发应用的包名和签名密钥。

仅构建/同步前端不需要 JDK：

```powershell
npm test
npm run build:android
npm run android:sync
npm run android:open
```

最后一条需要 Android Studio。`dist-android` 与现有网页 `dist` 隔离；打包只允许前端 bundle 与列出的公共图标，不复制 `.local`、`public/data`、原档或研究副本。

## 真机验收清单（全部待实测）

1. 安装调试 APK，确认应用名称和空档案页；没有示例等级或他人配装。
2. 电脑导出本人 JSON，经文件传输保存到手机“下载”；不要传原始 `SAVEDATA.BIN`。
3. 在应用内导入，核对等级、八项加点、当前武器、仓库和绘卷，并查看导入时间。
4. 开启飞行模式、强制停止应用再打开，确认角色和已收藏配装仍可查看。
5. 关闭电脑、换网络后重复第 4 步；不应出现配对/电脑连接提示。
6. 分别分享配装文字、PNG、档案包，验证接收应用能打开内容，取消分享不会改动档案。
7. 导入乱码、非档案 JSON、超过 25 MB 文件；旧角色必须保留，错误可见，可再次导入正确文件。
8. 再导入一个更新档案，确认角色更新、已有配装保留；同一个档案多次导入不重复收藏。
9. 测试窄屏、长装备名、系统返回键、底部手势栏及旋转；现有工程还没有完整落地已审阅的 Figma 页面。
10. 同签名覆盖安装新调试版本，确认本机数据保留；卸载测试前先保存档案包。

## 发布前未完成项

- Android lint、模拟器与真机文件选择器/分享/重启验收（本机 JDK/SDK 编译已通过）。
- Figma 暂定布局完整落地、应用图标与启动画面（当前原生启动素材仍为模板），缺图和素材许可核对。
- 档案格式更深入的嵌套校验、设备数据管理、分享缓存清理。
- 发布签名密钥安全保存、版本号升级、CI、APK 校验和与 GitHub Release。
- 安装和升级说明；不得把调试 APK 当作正式首发。

验证结果：53 项前端测试通过；网站与 Android 前端构建成功；`cap sync android` 和 Gradle `assembleDebug` 成功。生成的 APK 为 4,414,658 字节，包名 `com.jiezheshuizz.niohcompanion`、版本 `0.7.1-dev`、minSdk 24、targetSdk 36。APK v2 签名验证通过；包内资源路径检查没有存档、演示快照或解析器。测试副本位于 `D:\Android\apk-tests\nioh2-companion-0.7.1-dev-debug.apk`。

依赖审计：本轮 `npm audit --omit=dev` 为 0 个已知漏洞；完整 `npm audit` 报告 3 个 moderate 条目，来自开发工具链 `@capacitor/cli → xcode → uuid`，非应用生产依赖。未执行破坏性强制修复；发布流水线前需复查上游修复。原生 Maven 依赖尚未做漏洞审计。
