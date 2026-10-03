# 0.7.7 同步校验与状态修正

## Android 证书 IP 校验

0.7.6 的 Android 请求已固定证书指纹并检查有效期，但自定义 hostname verifier 只比较请求中的 IP 字符串，没有核对证书 IP SAN。0.7.7 将检查提取到纯 Java `LocalSyncTrust`：单证书、私网 IPv4、完整 DER 指纹、有效期、IP 类型 SAN 都须匹配。CN 或 DNS 类型 SAN 不能冒充 IP SAN，不进行 DNS 查询，不更改全局信任。

API 表示依据：[Java X509Certificate.getSubjectAlternativeNames](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/security/cert/X509Certificate.html#getSubjectAlternativeNames())。此方法按类型区分 IP 地址与 DNS 名；应用只接受类型 7 对应的同一地址。

`scripts/check-android-core.py` 用当前运行时生成临时合成 DER 证书，私钥仅在内存中。36 组二维码向量＋16 组证书测试覆盖合法单／多网卡 IP、错误指纹、错误 IP、DNS/CN 替代、过期、未生效、无关 IPv6、空／多证书链、非法主机及 pin。JVM 通过不等于 Android 设备握手或 iOS 验收完成。

## 电脑监听端

请求只接受单个规范 `Authorization: Bearer …`、单个 `Content-Length: 0`；拒绝重复字段、其他认证方式、非 ASCII token 和任意 Transfer-Encoding。畸形请求不消耗邀请、不替换已发布档案、不回显凭据。仅合成档案的环回 TLS 测试覆盖这些分支。

## 页面异步状态

- 手机第一次配对已成功但保存档案失败时，保留配对并允许“接收最新角色”重试；不用重用已经消耗的二维码。
- 每次请求清除上一次成功提示，失败不再同时显示旧的成功状态。
- 扫码只填写待确认信息，不自动联网；扫码过程中锁定重复操作。
- 初始配对状态的迟到响应不能覆盖新的配对或断开结果。
- 显示“已保存配对信息，不代表电脑当前在线”；自动拉取只在同步页面前台运行。
- 电脑轮询不重叠；发布／停止之后，旧轮询响应作废，不能重新显示已关闭的二维码。

React／前端技能的应用仅影响异步锁、稳定轮询回调和准确提示，沿用已批准的页面格局；本轮没有 Figma 写入。

## 仍需真机验收

安装新 APK 时覆盖升级而不是卸载，先保留已有资料；由用户操作测试配对、存储失败重试、断网与重启。不要把自动测试使用的环回连接或模拟插件当作真机结果。iOS 原生信任实现仍须 Mac/Xcode 编译及 iPhone 负面用例测试。
