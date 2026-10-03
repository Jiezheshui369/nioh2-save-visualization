# Mac 技术交接

2026-10-03 最新确认：用户恢复向现有私有仓库上传筛选源码和文档，在 Mac 优先开发 iPhone，暂用自己的 Windows 电脑作为服务器。先看 [Mac 开发入门](MAC_START_HERE.md) 及其中可复制的接手提示词。目标仍是多游戏、同账号服务器同步、单游戏／全部游戏手动更新及离线保留，见 MULTI_GAME_SYNC_V1.md。本文的扫码验收仅用于现有局域网基线，不表示新服务器流程已实现；不再沿用旧的 Android 优先和已过去的 10 月 2 日排期。

更新：2026-09-25。源码 **0.7.16-dev**，存档解析器 **0.9.9**。这不是 App Store 发布版。本轮新增有截图证据的魂核妖力/百分比单位与稀疏档位解码，保留此前同步、离线和分享修复。最新交接及验证状态见 RELEASE_0716.md，源码包独立复验见包旁 VERIFIED.md。不是完整人物属性解析版；也没有新Windows/APK安装包。详见 EFFECT_VALUE_CONTRACT.md、SKILL_MARKER_RESEARCH.md。

## 你要迁移什么

以私有仓库本次交接提交为准，根目录应直接有 package.json、AGENTS.md 和 ios/。旧源码 ZIP 不含 10 月 3 日的交接决策；旧0.7.15迁移ZIP与安装包仍为解析器0.9.7。手机若仍是旧版，可能拒绝新增grade元数据：先将两端升级到同一新契约，再电脑重新解析、主动发布。不要靠删字段、手改档案或传JSON文件到手机来绕过主流程。私人截图和副本不迁移。

人物属性解析任务继续保留；Mac 接手先恢复现有工程的可构建基线，再开发账号／服务器手动同步。以 CURRENT_GOAL.md 顶部最新要求为准，不以额外打包替代解析成果，不得宣称现有源码已完整解析人物面板。

只迁移经过 `scripts/prepare_handoff.py` 筛选的源码。不要上传整个研究工作目录，不要带 `.local`、Steam 存档、解密输出、截图、签名密钥或依赖缓存。沿用现有 **私有 GitHub 仓库**：游戏图片和提取文本的公开再分发权限尚未确认。

迁移包包含界面、Windows Agent、Android 工程、iOS 工程、锁定的 npm 依赖清单、测试、协议和本说明。Katana 是已固定哈希并附许可的 Windows 工具，Mac 的 iOS 开发不需要运行它。私有真实样本不在包内；手机同步测试继续由原 Windows 电脑发布真实角色。

无需搬运整段聊天。`AGENTS.md`、`CURRENT_GOAL.md` 和本说明已记录关键产品决定、禁止事项和未完成点。历史 Figma 链接在 `MOBILE_UI_IMPLEMENTATION.md`。

## Windows 上传边界

现有仓库是 `https://github.com/Jiezheshui369/nioh2-save-visualization.git`。保留其提交历史，在核对远端基线后追加提交；不要重新初始化成无关历史或强制推送。只使用源码筛选清单，不在研究目录直接 `git add .`。不上传整个 ZIP、依赖缓存和安装包。

不要把 GitHub token 写进源码或发进聊天。工作流目前仅允许手动触发；本次没有要求启动云端构建或发布 Release。

## Mac 端：第一次启动

环境：Node.js 22.12+（建议 22 系列当前补丁版）、Python 3.11+；完整 Xcode 26.0+ 与其 iOS 模拟器。Capacitor 8 的要求已在 2026-10-03 核对[官方说明](https://capacitorjs.com/docs/getting-started/environment-setup)，安装前还需检查 Mac 的系统是否支持所选 Xcode。项目使用 SPM，不需要改成 CocoaPods。不要复制 Windows 的 node_modules、JDK 或 Gradle 缓存到 Mac。

```sh
git clone https://github.com/Jiezheshui369/nioh2-save-visualization.git
cd nioh2-save-visualization
npm ci
npm test
npm run build
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r packaging/requirements-runtime.txt
python scripts/check_project_contract.py
python -m unittest discover -s agent/tests -v
node scripts/check-effect-contract.mjs --python python
sh scripts/check-ios-core.sh
npm run ios:sync
npm run ios:open
```

`ios:sync` 目前复用 `build:android` 生成的安全原生前端包（目录名 `dist-android` 是历史命名），没有安卓专属 UI，不会把演示数据、Service Worker 或个人档案拷进 iOS。已有 `ios/` 工程，**不要再次 `cap add ios` 或删除重建工程**，否则会丢失原生插件接线。

先构建模拟器：

```sh
xcodebuild -project ios/App/App.xcodeproj -scheme App \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath .local/ios-build CODE_SIGNING_ALLOWED=NO build
```

然后在 Xcode 选择 iPhone 模拟器运行。真机时再选择自己的签名 Team、连接 iPhone、按照 Xcode 提示设置开发设备；不要把 Team 私钥或 provisioning profile 提交进仓库。本轮没有申请证书、配置 Apple 账号、发布 TestFlight 或 App Store。

## iOS 已写好什么，仍需验证什么

- 共用已确认的 React UI、IndexedDB 离线库和系统分享插件。
- `LocalSyncPairing.swift`：严格二维码解析；`LocalSyncConnection.swift`：限量 HTTPS 拉取、证书 pin、拒绝重定向；`LocalSyncKeychain.swift`：设备本地凭据。
- `LocalSyncPlugin.swift`：与 Android 相同的四方法桥接；`LocalSyncScanner.swift`：只读 QR 相机界面。
- SceneDelegate 和 Main.storyboard 都接到自定义桥接控制器，Swift 文件已加入 Sources。
- 已声明中文相机/本地网络权限用途、局域网 ATS 配置和文件时间戳 API 的隐私清单。**不等于已经通过 Apple 审核**。
- **尚未在本轮 Windows 上编译 Swift/Xcode，也未做 iPhone 实测。** 初始 AppIcon/启动图仍是模板资源，需要替换为确认的 Nioh 品牌资源并检查 1024px 图标。

## Mac 首轮验收清单

1. 空设备启动，不应出现虚构人物；显示连接电脑入口。
2. Windows 开启已有的“同步到手机”，电脑与 iPhone 同一可信 Wi-Fi，扫码后确认。
3. 允许相机和本地网络权限；角色等级、加点、装备明细与电脑一致。全程无需 JSON 文件传手机。
4. 拒绝相机后可取消/手动输入；拒绝本地网络后有明确错误，旧档案仍可看；重新授权可重试。
5. 配对成功后关闭 Windows、关闭手机 Wi-Fi、杀掉 App 再打开，应能查看上次成功保存的角色。
6. 电脑发布另一个测试结果、手机接收后更新；未经电脑发布不改变手机内容。
7. 测试非法二维码、重复字段、非局域网地址、过期邀请、重复使用邀请、撤销配对、错误 pin、过期证书、错误 IP SAN、重定向和超大响应，均应失败且保留旧角色。
8. 新建配装册、展开装备和绘卷、仓库筛选、长词条、横竖屏/安全区、分享文字与图片。
9. 升级覆盖安装后离线库仍在；卸载/清除数据会丢失本地角色，应提前备份。Safari/PWA 数据不会自动出现在原生 App 中。

## 解析研究不能误报

用户要求完整直接读取人物存档，不需要属性计算器。现有截图校准共 164 行：11 个既有直接字段匹配，37 个最终面板字段待验证，116 个特殊效果中 58 有来源候选、58 待定位。后两类都不是完成的角色总效果。

后续词条编码核对与技能扫描仍未新增可靠最终面板字段；研究报告仅在Windows私有`.local`。不要把报告地址或截图常量塞进生产解析器；没有真实副本时可以运行合成单测，不能宣称完成真实存档研究。

关联研究确认了三枚魂核副本与库存索引的结构一致性，并找到守护灵候选表与两处选择编号；新增截图确认此配装的主副名称、三魂核与佩戴绘卷，但可跨角色使用的选择语义仍未验证，不接入正式活动槽字段。通用布局与边界见 GUARDIAN_LINK_RESEARCH.md，具体玩家编号及报告不迁移。不要把研究工具输出作为手机档案导入。

截图中体力、精力、妖力的 UI 仅显示上限；装备负重仍保留当前重量/上限，特殊效果加成不裁掉。用户不想反复提供无必要样本，也不应要求重新收集已收集完的木灵。确需对照时解释验证目的，优先只读现有副本。

## 给 Mac 上接手助手的开场任务

请复制 [MAC_START_HERE.md](MAC_START_HERE.md) 中的完整提示词。它区分已有局域网兼容验收和待开发的同账号服务器手动同步；不要只完成扫码就报告新第一版完成。
