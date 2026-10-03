# 电脑 → 手机直传协议 v1

本文件是 Android/iOS 接续实现的边界说明，不是互联网云同步设计。

2026-09-29：此处描述现有局域网实现。新的多游戏/账号服务器同步要求见 MULTI_GAME_SYNC_V1.md，尚未实现；下面的前台自动轮询行为不应直接沿用到要求“未点击不更新”的新云同步模式。

## 流程与所有权

1. Windows 程序复制并分析玩家存档，展示结果；原始文件不改写。
2. 玩家主动点击“发布当前角色到手机”。桌面生成隐私裁剪档案，移除存档哈希和本机路径。
3. 手机 App 扫描二维码或输入配对信息，用户确认后才建立连接。
4. 原生传输层校验证书和返回信封；共享 TypeScript 校验角色、装备、仓库和配装册结构。
5. IndexedDB 提交成功后显示成功。失败保留旧角色。配装册合并失败单独提示。
6. 同步后的手机可以断网查看。再次更新仍需同一可信局域网和电脑主动发布；不自动读取 Steam Cloud。

## 配对二维码

格式：`niohcompanion://pair#host=<IPv4>&port=<port>&pin=<sha256>&token=<invite>`。

- 恰好四个字段；拒绝重复、额外字段、畸形编码、路径、查询、用户信息或重定向地址。
- host 只能是规范十进制 RFC1918 IPv4：10/8、172.16/12、192.168/16。拒绝 DNS、回环、链路本地、IPv6、前导零和公网地址。
- 端口为规范整数 1024–65535；证书 SHA-256 是 64 个小写十六进制字符；token 是 43 个 base64url 字符。
- 邀请十分钟有效且单次使用；最多八台设备；电脑会话最长八小时。关闭电脑同步立即撤销会话中的所有设备。
- 二维码本身是临时秘密，不要截图发群，不打印在日志或 GitHub issue 中。协议不要求注册 URL Scheme 深链，二维码在 App 内解析即可。

## 网络层

| 请求 | 身份 | 返回 |
|---|---|---|
| `POST /v1/pair` | 邀请 token | archive、revision、新 deviceToken |
| `POST /v1/pull` | deviceToken | archive、revision；deviceToken 可为空 |

Header：`Authorization: Bearer <token>`；空请求体，`Content-Length: 0`。不接受文件上传，也不暴露解析、发现存档、任意文件或静态站点路由。

0.7.7 起严格拒绝重复认证／长度字段、任何 Transfer-Encoding、非 ASCII 或非 base64url 凭据。拒绝不消耗有效邀请；不将畸形凭据打印到日志。

只用 HTTPS，TLS 1.2 及以上。手机比对二维码中的完整 DER 证书 SHA-256，不是 SPKI 公钥指纹。信任仅作用于当前固定 IP/端口请求；禁止跟随 HTTP 重定向，不修改全局信任设置。iOS 使用唯一证书锚点和 SSL/IP 校验；Android 使用请求级 TrustManager 和指纹校验。iOS 的过期证书、错误 SAN、错误 pin 等负面实测仍必须在 Mac 完成。

HTTP 200 为成功，401 表示邀请/设备会话过期或撤销。错误不能删除手机已有角色。客户端限制响应为 26 MiB，服务端档案主体限制为 25 MiB；客户端还需完整结构校验。

revision 是电脑按已发布 JSON 字节计算的 SHA-256，手机把它当作不透明版本标记避免重复保存。不要重新 stringify 后比较哈希：两端 JSON 空格规则可能不同。真实性来自校验过的 TLS，而不是 revision 本身。

0.7.8 起，只有角色与附带配装均保存成功才把 revision 标记完整。角色已提交而配装合并失败属于部分成功，必须单独提示并允许同版本重试；手动“接收最新角色”始终重新执行保存，自动轮询只跳过完整成功的同版本。离开同步页暂停轮询，回到同步页后恢复。

## 原生桥接（两平台同名）

0.7.11 电脑控制状态增加可选 `publishedAt`、`publishedSnapshotId` 与 `revision`。每次成功发布清除 `lastSent`；它只记录当前版本的有效读取请求，不是手机存储回执。状态结构/二维码校验失败时隐藏旧配对信息，不当作同步仍正常。重进页面无法证明本机配装与已发布内容相同，需提示主动发布；不自动发送未确认变更。

手机本地档案发生提交/恢复后失效先前的版本去重标记；自身接收提交成功后才能重新记住该版本。发布结果采用显式字段投影，但保留玩家主动写入的名称/备注；不要声称该文字内容已匿名化。

0.7.15 起，导入和持久化在第一次异步等待前捕获独立角色/回执副本；回执须匹配角色身份且日期/数量有效。电脑发布同样先捕获隐私投影，再读取配装册。同页面中对比已发布 revision 对应的角色内容，不能只比较 snapshotId；同编号数据变化也提示主动重新发布。重进页面未保留内容基线时明确提示尚未核对，不声称内容相同，不自动发布。

`LocalSync` 的四个 Promise 方法：

- `scan()` → `{value: string}`，取消返回空字符串；不自动发送扫描结果。
- `status()` → `{paired: boolean, host: string}`，不得返回 token/pin。
- `receive({qr?: string})` → `{archive: unknown, revision: string}`；有 qr 时配对，无 qr 时读取已存凭据拉取。
- `forget()` → 空结果，只删除配对，不清空离线角色。

Android 凭据位于禁止系统备份的应用私有存储。iOS 使用 `AfterFirstUnlockThisDeviceOnly` Keychain，不同步 iCloud。重新安装后的 Keychain 留存行为需真机确认；失效的旧 token 只会被电脑拒绝，不能据此声称配对仍在线。

## 自动验证与真实设备边界

0.7.16 / parser0.9.9增加词条`grade/verified-id`类型，值仍是档位字符串，原始uint32单独保留；不是数字加成。旧客户端可能拒绝未知类型，须升级两端后重新解析/主动发布，不能静默删除证据或覆盖失败后的旧离线角色。协议信封、TLS及配对流程不变。

- `scripts/ios-tests/pairing-cases.json` 是共享合成测试向量，不含有效密钥；Java 与 TypeScript 已可在 Windows 验证，Swift 在 Mac 编译同一组向量。Java 脚本另生成 16 组临时 DER 证书测试指纹、有效期与 IP SAN；私钥不落盘。
- Python 测试服务端单次邀请、过期、撤销、发布、TLS 路由及只读权限。
- React 测试从电脑接收、损坏数据拒绝、写入失败保持旧角色、重新挂载后离线恢复。
- 以上不代替原生 TLS、相机权限、本地网络拒绝/重试、杀进程重启或分享面板真机验收。

实现依据：[Capacitor 自定义 iOS 插件](https://capacitorjs.com/docs/ios/custom-code)、[Apple 本地网络隐私说明](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)。iOS 网络访问由原生插件完成，不通过允许所有证书或全局关闭 ATS 来绕过验证。
