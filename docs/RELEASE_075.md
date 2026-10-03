# 0.7.5-dev 交接与测试记录

2026-09-25。内部开发版，未上传 GitHub，未正式发行。源码/Windows/Android 版本 0.7.5-dev，Android versionCode 705，解析器 0.9.6；iOS 标记 0.7.5/705，但没有已编译 IPA。

## 已完成的开发

- 基础体力、精力、妖力只显示上限；不修改截图原始证据或效果加成。没有改动已确认的 Figma 页面格局。
- 档案、装备、绘卷、物品、配装结构校验统一；非法新资料拒绝持久化，旧离线档案保留。防御性校验不等于反作弊，不以游戏属性上限拒绝修改存档。
- Android / TypeScript / Swift 共用 36 组配对测试向量：严格局域网 IPv4、端口、pin、token、字段唯一性。
- iOS SPM 工程、二维码相机界面、Keychain、TLS 固定证书桥接已接好。相机/本地网络声明和文件时间戳隐私清单已添加，尚不是 Apple 审核结论。
- 私有源码迁移允许列表、逐文件 SHA-256、包验证、Mac 接手指南与手动 CI。源目录未初始化 Git，不会自动 push 或发布。
- Windows 打包改为新版本独立目录；已存在的目录或同名 ZIP 会报错，不删除旧包。

## 本机验证

- 前端：18 文件、136 项测试通过；网页和共用原生资源构建通过。
- Python：92 项，91 通过、1 跳过（Windows 无权限创建测试符号链接）。其中 iOS 检查仅验证项目文件引用和清单，不是 Swift 编译。
- 原生 Java：36 组配对向量通过；Android 应用 assembleDebug 与 APK 签名验证通过。
- Windows：打包目录和 ZIP 内容检查通过；实际 Nioh2Console.exe 使用空来源目录和合成档案，完成发布、证书 pin + IP SAN、单次配对、拒绝重复邀请、拉取、隔离路由和撤销。测试进程退出，未读原始游戏存档。
- 旧 0.7.4 安装目录、旧 ZIP 与真实应用数据均保留；没有远程安装到手机。

首次 Android 全模块离线单测缺少第三方测试依赖，因此不计为通过；单独应用构建和自有 Java 协议测试通过。Windows 原旧依赖目录存在读取权限问题，使用新 `.local/build-tools-075` 离线安装锁定依赖后完成打包。没有通过更改原目录 ACL 解决。

## 本轮产物（位于原 Windows 项目的 release）

- `windows-0.7.5-dev/Nioh2SaveCompanion/Start-Sync-Test.cmd`：新电脑测试入口。先关闭旧程序，不要删除旧数据；使用相同应用数据目录。
- `仁王2存档伴侣-0.7.5-dev-windows-x64.zip`：Windows ZIP。
- `android-0.7.5-dev/nioh2-companion-0.7.5-dev-debug.apk`：新安卓测试包，同调试证书可覆盖旧测试版；不要为升级卸载或清除资料。
- Windows ZIP SHA-256：`C87E6307DD4C163A38392D3B2FC035491C1E2FC8CFEFA1719EB05E8D7DA73B8A`。
- APK SHA-256：`D5CF4B2175C76A640C93D622DB728D368BD5F15FB96DA541A2D2F0652DE13A84`。
- APK 证书 SHA-256：`de1b03eb5af71041737b3c5c6918c461873edc892ad2de6579213a68017b3e59`，调试签名，非正式发行签名。

迁移源码 ZIP 与上面安装包用途不同。Mac 要的是源码：根目录须有 package.json、src、agent、ios、android、docs、AGENTS.md。遵循 MAC_HANDOFF.md。不要把原工作目录或 release 程序包当源码上传。

## 仍未完成

- Mac 上 Swift 核心测试、Xcode 模拟器编译、iPhone 扫码/TLS 负例/权限/离线重启/系统分享/覆盖升级。
- iOS 模板 AppIcon 和启动图还需换成确认的品牌资源；未配置签名 Team 或上架账号。
- 本轮 Windows 真实窗口拖放和手机真机回归，API 测试不代替 UI 验收。
- 全部最终人物数据直接解析。扩大现有副本编码扫描后仍未新增可靠字段，候选不能当成正式面板或擅自计算。证据只留在本机私有研究目录。
- 图标/游戏文本公开再分发许可、正式签名、隐私政策与商店提交。源码先用私有 GitHub，不自动公开。
