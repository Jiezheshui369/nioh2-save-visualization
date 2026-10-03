# 在 Mac 继续开发 iPhone 应用

更新：2026-10-03，Australia/Sydney。本文供项目所有者和 Mac 上的 Codex 接手使用，不需要翻旧聊天。当前源码版本为 0.7.16-dev，解析器为 0.9.9；本次是源码和文档交接，不是已经编译完成的 iPhone 安装包。

## 先做这三件事

1. 在 Mac 登录 GitHub，克隆私有仓库 [nioh2-save-visualization](https://github.com/Jiezheshui369/nioh2-save-visualization)。不会命令行也可以使用 GitHub Desktop 的克隆功能，选择这个仓库和一个新的本地文件夹。
2. 在 Mac 的 Codex 中打开克隆后的项目文件夹。应直接看到 `package.json`、`AGENTS.md`、`src/`、`agent/` 和 `ios/`，不要只打开 `ios/` 或只把 GitHub 链接粘进一个空项目。
3. 在该项目中新建对话，把下一节整段提示词发给 Codex。先让它检查环境，不需要你自行整理全部开发命令。

GitHub 网页登录、Mac 本地 Git 访问和 Codex 的 GitHub 连接可能各自需要登录。出现私有仓库无权限时，确认登录的是有权访问此仓库的账号；不要把仓库改成公开，也不要发密码或令牌到聊天。GitHub 同步代码和已提交文档，不会同步 Windows 的运行进程、全部聊天或私人存档。

## 复制给 Mac 上 Codex 的提示词

```text
请接手当前本地仓库 nioh2-save-visualization。先完整阅读根目录 AGENTS.md，
再阅读 docs/MAC_START_HERE.md、docs/CURRENT_GOAL.md、docs/MAC_HANDOFF.md、
docs/MULTI_GAME_SYNC_V1.md、docs/LOCAL_SYNC_PROTOCOL.md 和 docs/HANDOFF_20261003.md。
本次接手不依赖之前的聊天记录；以 2026-10-03 的最新确认优先于旧排期。

我的目标是一个多游戏存档资产应用，仁王2是第一个解析器。当前优先在 Mac
开发 iPhone 端，暂时用我自己的 Windows 电脑作为服务器，不购买云服务器。
主流程是 Windows 读取并解析经过校验的存档副本，把解析结果上传到服务器；
手机登录同一账号后，用户点击同步某个游戏或全部支持的已管理游戏。
没有点击同步就保留上次成功保存的离线数据，不在启动或恢复网络时悄悄替换。
电脑自动上传按游戏单独授权，默认关闭，并保留手动上传。
只上传解析结果，不上传原始存档，不提供写回游戏存档的功能。
第二款游戏只保留仁王3“暂未支持”占位，不假装能解析或参加同步。

已有源码是 React + TypeScript + Capacitor 8.5.2，iOS 使用 SPM，
并已有原生扫码、TLS pinning、Keychain 等代码。保留现有 React UI 和 Android
兼容性，不改写成另一套 SwiftUI 界面，不删除重建 ios/ 工程。
保留已确认中文 Figma 格局及角色、配装、仓库、更多四入口。
体力、精力、妖力只显示上限；装备重量和特殊效果仍保留原有表示。

请先检查 git 状态、Node 22.12+、Python 3.11+、完整 Xcode 26.0+、
SDK 和模拟器，在保留用户改动的前提下安装锁定依赖，运行现有测试。
接着执行 ios:sync，构建现有 Xcode 工程并修复实际编译问题。
先跑模拟器和离线库；需要我的 iPhone、签名 Team 或 Windows 联调时明确告诉我。
不要声称在 Windows 上已编译 Swift，不把模拟测试当成真机测试。

旧的同一 Wi-Fi 扫码流程只是已有兼容基线，不是新服务器流程已经完成。
恢复基线后，继续设计并实现独立账号鉴权、账号/游戏/角色隔离、版本化快照、
单游戏/全部游戏手动同步、失败保留旧数据，以及 Windows 自托管启动说明。
不要直接把旧局域网配对服务开放到公网，也不要关闭 TLS 或任意放宽 host 校验。
VPN/域名接入需要独立安全设计与确认，不能假设现有二维码支持它。

原始存档始终只读，只研究已校验的独立副本。37项最终面板字段和116条
角色总效果尚未完成；截图转录、候选匹配、装备词条不是最终属性已解析。
未知项保持“未解析”，不做猜算面板的计算器，不伪造技能或守护灵活动槽。
私人样本和截图没有上传 GitHub，缺样本时先做合成测试并说明证据限制。

不要上传私人存档、截图、密钥或内部研究报告，不公开仓库，不购买服务、
修改 DNS 或发布 TestFlight/App Store。旧的10月2日截止日期已过，新日期未定。
先汇报仓库版本、实际环境、可构建性和第一步任务，然后继续可执行的开发。
每轮分别报告：实现了什么、自动测试、模拟器验证、真机验证、未完成事项。
```

## 目前有什么和还缺什么

| 部分 | 接手状态 |
| --- | --- |
| Windows 只读解析、共享网页 UI、Android 工程 | 已有实现，保留现有成果 |
| iOS 工程、扫码、Keychain、固定证书校验 | 已有源码，尚待 Mac 编译及 iPhone 验证 |
| 手机离线档案与配装存储 | 已有实现，iPhone 上仍需断网重启和升级回归 |
| 同账号服务器、单游戏与全部游戏手动同步 | 尚未实现，不能用旧扫码代替验收 |
| 多游戏框架与仁王3占位 | 已确认需求，尚未落地；仁王3不解析 |
| 人物全部最终属性 | 尚未完成；37项最终面板和116条总效果不能冒充已解析 |
| Windows 作为服务器 | 已选择此部署方向，尚未部署新账号服务或打通外网 |

旧 Windows 已安装版本与 GitHub 源码不是一回事；更新仓库不会自动升级 Windows 或手机。真实联调应先核对两端契约，保留旧离线数据和可回退安装，不要清库排错。

## Mac 环境与启动

需要 Git、Node 22 系列（至少22.12）、Python 3.11+、完整 Xcode 26.0+ 和 iOS 模拟器。不要只安装 Command Line Tools 就以为具备 iOS 构建环境。先检查 macOS 能否安装所需 Xcode；不满足时让 Codex 说明阻塞，不擅自降级项目依赖。项目使用 SPM，不需主动改成 CocoaPods。

若使用终端克隆，在你选定的开发目录执行：

```sh
git clone https://github.com/Jiezheshui369/nioh2-save-visualization.git
cd nioh2-save-visualization
git status --short
git log -1 --oneline
node --version
python3 --version
xcodebuild -version
xcode-select -p
```

已经用 GitHub Desktop 克隆就不用再克隆。依赖、测试和构建顺序：

```sh
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

`ios:sync` 复用了历史名为 `build:android` 的原生网页资源构建，不代表把 Android 应用装到 iPhone。不要再次运行 `cap add ios`；既有原生插件接线必须保留。详细模拟器构建命令和真机测试见 [MAC_HANDOFF.md](MAC_HANDOFF.md)。

只看页面可先执行 `npm run dev`，打开终端实际显示的本机网址。这不等于原生 iPhone 联调。Mac 不运行 Windows 的 Katana EXE；真实存档解密和采集继续留在 Windows。

## Windows 服务器的工作边界

Windows 后续承担两种逻辑职责：只读采集与解析器，以及存储已上传快照的账号服务。两者可以在同一台电脑，但仍需独立鉴权、数据目录和接口边界。手机同步服务器已有版本，不远程命令 Windows 重新抓取存档。

Windows 关闭、休眠、断网或服务停止时，手机不能获取新数据，但应能查看最后一次成功同步的数据。Mac 独立开发界面和模拟器不要求 Windows 一直在线；真实设备同步验收才需要 Windows 和相应服务可用。

跨网络访问方案尚未部署。不要立即转发路由器端口或改域名。此前讨论的 VPN 只是候选；旧配对校验限于 RFC1918 地址，不能直接接受 Tailscale 常用的100.64.0.0/10地址。需要单独设计服务器地址、证书和授权，不能简单关闭检查。

## 开发先后顺序与完成标准

1. 恢复 Mac 构建：锁定依赖、测试通过、iOS 模拟器真实运行，修复可复现的编译错误。
2. 回归现有能力：四入口布局、详情与分享、离线重启、数据保存失败仍保留旧档案；旧扫码作为兼容验收。
3. 实现服务器闭环：账号、隔离、版本、Windows 手动上传、iPhone 手动单个／全部下载、无操作不替换、部分失败逐项提示。
4. 自托管验收：先受控环境验证，再经用户确认处理跨网络访问。文档记录服务启动／停止、缓存备份、错误处理和回退方式。
5. 持续完善有证据的解析。没有真实私有样本就明确说明，不能拿合成测试证明人物全解析。

新第一版需证明“不扫码也能通过账号服务手动同步”，而不只是再次证明旧扫码可用。不能把网页构建、模拟器运行和真机验收混为一谈。10月2日排期是历史记录，新日期需重新确认。

## 文档和设计入口

- [当前目标](CURRENT_GOAL.md)：最新需求优先级。
- [技术交接](MAC_HANDOFF.md)：iOS 文件、命令、真机清单。
- [多游戏与手动同步规则](MULTI_GAME_SYNC_V1.md)：待开发主流程。
- [旧局域网协议](LOCAL_SYNC_PROTOCOL.md)：兼容和安全约束，不是新服务器协议。
- [本次核验](HANDOFF_20261003.md)：Windows 能确认的范围。
- [UI 实现记录](MOBILE_UI_IMPLEMENTATION.md) 与 [Figma 角色稿](https://www.figma.com/design/C2ZR4s4ksIkNmTLXWnsHtG/?node-id=2-72)：沿用现有设计。Figma 访问授权独立于 GitHub；打不开时不要凭空重画。

操作依据：[OpenAI 桌面应用说明](https://learn.chatgpt.com/docs/app)、[AGENTS.md 项目规则](https://learn.chatgpt.com/docs/agent-configuration/agents-md)、[Capacitor 环境要求](https://capacitorjs.com/docs/getting-started/environment-setup)。本说明不要求修改系统级 Codex 配置或开启无限权限。
