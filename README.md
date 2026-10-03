# 仁王2 存档伴侣

一个从《仁王2》起步、计划扩展到多游戏的本地优先存档资产应用。现有流程：Windows 只读复制解析 → 主动发布 → 手机局域网扫码接收 → 离线查看。新目标：Windows 上传解析结果到自有服务器 → iPhone 同账号手动同步单个／全部支持游戏 → 不同步时保留离线版本。账号服务器流程尚未实现，两条路径都不要求玩家手动传 JSON。

## Mac 接手入口

2026-10-03：优先开发 iPhone，暂用自己的 Windows 电脑作为服务器。请先读 [Mac 开发入门与可复制提示词](docs/MAC_START_HERE.md)，再看 [技术交接](docs/MAC_HANDOFF.md) 和 [本次核验记录](docs/HANDOFF_20261003.md)。现有私有仓库是 `Jiezheshui369/nioh2-save-visualization`；此前上传暂停已解除，旧 Android 优先／10 月 2 日排期仅是历史记录。没有新安装包或已验证的 iPhone 成品。

## 2026-09-25：跨平台源码接续版 0.7.16-dev

以下记录既有源码能力。只上传筛选后的源码到私有 GitHub 仓库，不上传整个研究目录。游戏图片/文本公开再分发权限仍待核实。

- Windows 独立窗口、Android 同步与共用角色／配装／仓库／更多界面已有实现；JSON 仅保留为高级备份恢复。
- iOS 已加入 Capacitor/SPM 工程、扫码、Keychain 和证书指纹校验的局域网同步插件，**仍需 Mac 编译和 iPhone 实测**。不是可上架的 iOS 成品。
- 体力、精力、妖力仅显示上限，截图原始记录不改写；严格校验导入及同步数据，损坏档案不能替换已有角色。
- 人物全部最终数据尚未解析完成。解析器 0.9.9 核对三项魂核妖力、六项百分比与三个档位组合；截图值、来源词条与已验证最终字段严格分开。不开启推算面板值的计算器。
- 最新词条解码、技能候选研究及迁移进度见 [0.7.16 源码交接记录](docs/RELEASE_0716.md)。保留此前同步/离线/分享修复，本轮不改已确认 UI，不更新旧安装；没有新增 Windows/APK 安装包。
- 环境/测试/设备验收分别见 [Mac 交接](docs/MAC_HANDOFF.md)、[直传协议](docs/LOCAL_SYNC_PROTOCOL.md) 和 [项目状态](docs/PROJECT_STATUS.md)。

当前目标与验收标准见 [当前产品目标](docs/CURRENT_GOAL.md)，主架构和 Steam OAuth 备用路线见 [架构说明](docs/ARCHITECTURE.md)，移动端视觉范围见 [设计简报](docs/MOBILE_DESIGN_BRIEF.md)。

## 已有功能与兼容入口

- Android 原生工程：已有扫码同步、离线库和原生分享适配；用户已验证此前同步流程。新版本仍需设备回归，不能把构建通过等同于真机验收。

- Windows/Python 只读快照器：等待文件稳定、复制到独立目录，并在复制前后、解密前后和结构化快照发布前执行 SHA-256 校验。
- 本地只读 API：只绑定 `127.0.0.1`，提供健康状态和最新结构化快照。
- React PWA：以“我的角色、我的配装册、当前配装、资产仓库”为核心，展示等级、加点、装备、恩宠、物品、绘卷和安全记录。
- 设备配装册：可把当前装备命名、备注并保存为独立配装资产；记录使用 IndexedDB 保存，不随下一次存档读取或历史快照淘汰而消失，最多保存 50 套。
- 旧 iPhone/PWA 档案导入：保留文件导入兼容入口，不作为原生 App 的主业务流程；新 iOS 工程走电脑扫码直传。
- 安装引导：检测浏览器 PWA 安装能力、安全来源、网络与离线外壳状态，并分别说明桌面、Android 与 iOS 安装路径。
- 历史快照作为诊断与研究工具保留，可在网页底部切换此前读取结果，并选择更早基准进行比较。
- 档案包导入/导出与离线历史：安全页可在 Agent 在线时一键保存最近 20 份结构化快照；没有启动 Agent 时也能查看这些记录。内置演示数据完全合成，档案包默认移除原档与副本 SHA-256 指纹。
- 明确展示尚未完成的任务、技能树、收集品和武家字段，不输出推测值。

完整的已完成/待研究边界见 [项目状态](docs/PROJECT_STATUS.md)，数据流与移动端路线见 [架构说明](docs/ARCHITECTURE.md)，只读不变量与隐私说明见 [安全说明](docs/SECURITY.md)，任务与收集品的采样方法见 [受控样本研究流程](docs/RESEARCH_PROTOCOL.md)。

套装与恩宠的中英文本地化策略及核对来源见 [本地化说明](docs/LOCALIZATION.md)。

## 安全承诺

Agent 不包含写回、重签名或修改游戏存档的代码。`snapshot` 命令只用二进制只读模式打开源文件，并在复制前后校验源文件哈希。解析器只能接收快照目录中的副本。

## 开发运行

源码开发需要 Node.js 22+ 与 Python 3.11+。使用已构建的 `dist` 时只需要 Python 3.11+。

```powershell
npm ci
npm run dev
```

另开终端导入示例快照并启动本地 API：

```powershell
python -m agent.nioh2_agent import-json --input public/data/demo-snapshot.json --store .local/snapshots
python -m agent.nioh2_agent serve --store .local/snapshots
```

创建真实存档的只读快照时，应选择与源目录完全分离的目标目录：

```powershell
python -m agent.nioh2_agent snapshot `
  --source "C:\Users\你的用户名\Documents\KoeiTecmo\NIOH2\Savedata\SteamID" `
  --workspace "D:\Nioh2Research\snapshots"
```

当前 `snapshot` 只负责安全复制和校验，不会直接解密。后续二进制解析模块也必须只处理该快照副本。

已经解密的研究副本可以只读解析，并可同时比较备份档：

```powershell
python -m agent.nioh2_agent parse-decrypted `
  --input "D:\Nioh2Research\unpacked\decrypted\snapshot\SAVEDATA00\SAVEDATA.BIN" `
  --backup "D:\Nioh2Research\unpacked\decrypted\snapshot\SAVEDATA00\BACKUP.BIN" `
  --snapshot-root "D:\Nioh2Research\unpacked\decrypted\snapshot" `
  --store ".local\snapshots"
```

完整本地管线会先建立独立快照，然后只对快照调用固定的解密模式：

```powershell
python -m agent.nioh2_agent pipeline `
  --source "C:\Users\你的用户名\Documents\KoeiTecmo\NIOH2\Savedata\SteamID" `
  --snapshot-workspace ".local\encrypted-snapshots" `
  --store ".local\snapshots"
```

该命令在解密前后都会重新校验快照文件。项目没有暴露加密、重签名或写回命令。

## 构建与测试

```powershell
npm test
npm run build
python -m unittest discover -s agent/tests -v
```

构建完成后，可用单一进程同时提供页面和本地 API：

```powershell
.\run-local.ps1
```

然后访问 `http://127.0.0.1:13252/`。服务仅监听本机回环地址。

### Windows 目录版

执行 `build-windows.ps1` 可生成无需另装 Python 的 x64 目录版。构建依赖使用固定版本与 SHA-256，并只安装到项目内 `.build-tools-v2`；发布目录会自动检查不得混入任何原始/备份存档。详细说明见 [Windows 打包说明](packaging/README.md)。

Agent 会扫描 Steam 账户目录下的 `SAVEDATAxx` 角色槽位。如果发现多个槽位，可在“安全记录”页选择下一次要读取的角色；手机 API 只返回账户尾号、槽位名和写入时间，不返回 Windows 完整路径。选择角色不会直接解析原档，而是继续执行“只读稳定性检查 → 独立复制 → 双哈希校验 → 副本解密与解析”。

### 历史浏览器局域网测试

本节是旧浏览器 HTTP 兼容入口，不是原生 App 的 TLS 配对流程，也不是新账号服务器方案。iPhone 接手应使用 [Mac 交接指南](docs/MAC_HANDOFF.md) 的原生工程验收步骤。

手机与电脑连接同一个可信任的家庭 Wi-Fi，然后显式开启局域网模式：

```powershell
.\run-local.ps1 -Lan
```

使用 Windows 目录版时不需要输入命令：先关闭普通模式，再双击发布目录中的 `启动手机模式.cmd`，它会开启手机测试模式并在电脑上打开二维码页。

启动时会为本次进程生成新的高强度临时口令，并输出 `Phone pairing URL`。电脑网页的“手机连接”页也会显示完全在本机生成的二维码和配对地址。用手机相机扫码或打开完整地址即可；配对成功后，地址片段中的口令会保存在该浏览器本地并从地址栏移除。Windows 防火墙询问时只允许“专用网络”。关闭 Agent 后口令立即失效，再次启动需要重新配对。

局域网模式使用普通 HTTP，适合当前真机功能验证，但不等同于最终可安装 PWA 所需的 HTTPS 发布环境。默认启动方式仍只绑定 `127.0.0.1`，不会开放局域网访问。

### 历史 PWA 文件恢复路径

本节保留旧版备份恢复说明，不作为当前主流程。不要让玩家按此节搬运 JSON 来代替电脑解析与手机同步。

0.7.1 已完成数据层闭环：电脑读取真实存档后点击“导出档案包”，把生成的 JSON 文件保存到 iCloud Drive 或发送到 iPhone“文件”，再在手机页面点击“导入档案包”。导入完成后角色和配装不再依赖电脑在线；首页会显示当前手机档案的导入时间与来源存档时间，配装册也可生成中文图片卡并打开 iPhone 分享面板。

要让网页本身在 iPhone 断网后仍能启动，还需把同一套静态前端部署到可信 HTTPS 地址，再由 Safari“分享 → 添加到主屏幕”。局域网 `http://192.168...` 地址不满足 iOS Service Worker 的安全来源要求。原生 `.ipa` 则需要 macOS、Xcode 和苹果签名；当前 Windows 环境不伪造该构建链。

运行 `build-mobile.ps1` 会生成版本化的 `release/仁王2存档伴侣-<版本>-iphone-web.zip`。它只含通用应用外壳、安全响应头与离线缓存，不含演示人物、真实角色档案或任何存档文件。部署及飞行模式验收步骤见 [iPhone HTTPS 部署说明](packaging/IPHONE_DEPLOYMENT.md)。

## 数据状态

当前真实快照来自已验证的研究数据。等级、八项加点、金钱、精华、熟练度、装备预设名称、11 个当前装备槽位、269 件装备仓库记录、366 个堆叠物品槽位与 39 条百鬼绘卷记录已经过单一样本验证；1,620 条装备/绘卷词条中有 1,562 条命中中文，1,123 条可安全显示平面数值或百分比。技能树节点、任务、收集品和武家字段仍待多样本研究。

Agent 会只读查找 Steam App 1325200 的本机 `remotecache.vdf`，以本地文件大小和写入时间对照云端元数据，显示“已同步”“等待 Steam 上传”或“云端版本较新”。该检查不调用 Steam 网络接口，也不会把 Steam 路径、云端 SHA 或账户完整路径发送给手机。

### 使用副本做回归测试

每次“读取存档”都会先在 `.local/encrypted-snapshots` 创建独立加密副本，解密输出也只位于项目的工具目录。原始存档不会被写回。可用下面的只读工具比较两个已解密副本：

从 0.5.0 起，若同一份游戏快照包含 `BACKUP.BIN`，结构化结果会自动记录两份副本之间的变化字节数、变化区域数、装备槽是否变化，以及逐项物品数量差异。网页“旅途进度”中的“副本实验室”会直接展示这些结果。安全记录只显示本地保护副本份数，不返回电脑路径。

开发时可对所有结构化副本快照执行一键回归审计；它不打开原始存档，并会检查只读安全标志、装备槽唯一性、中英文词条数组对齐和最新样本的翻译覆盖率：

```powershell
python -m agent.tools.audit_snapshot_corpus --store .local\snapshots `
  --min-equipment 98 --min-inventory 98 --min-effects 96
```

```powershell
python -m agent.tools.validate_decrypted_pair <改变前的SAVEDATA.BIN> <改变后的SAVEDATA.BIN>
```

工具会在解析前后复核两个输入的 SHA-256，并输出装备槽和紧凑二进制差异数量；真实副本及其指纹不进入发布包。

## 许可

项目源代码计划采用 MIT 许可。游戏名称、商标与游戏数据归各自权利人所有。本项目与 Koei Tecmo、Team Ninja 或 Valve 无隶属关系。
