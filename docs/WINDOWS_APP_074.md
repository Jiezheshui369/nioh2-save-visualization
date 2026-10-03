# 0.7.4 独立电脑窗口测试

## 本轮改变

默认“仁王2存档伴侣.exe”使用 WebView2 显示独立窗口，不弹浏览器标签页、不需要保留命令窗口。内容仍是此前已确认的四页面设计。Start-Sync-Test.cmd 也启动此窗口。

兼容入口为 Start-Browser-Mode.cmd；它运行 Nioh2Console.exe --browser，仍需保留命令窗口。不要同时开启新窗口和旧版本占用 13254；新版会提示冲突，不会接管或关闭旧程序。

窗口关闭或初始化失败时，仅停止自己启动的本地服务，撤销全部临时手机配对并释放端口。手机已接收的离线档案不删除。再次打开后，重新发布并扫码。

## 测试步骤

1. 先关闭旧电脑程序。安卓已有资料不要卸载或清除。
2. 打开 D:\Android\apk-tests\Nioh2-PC-0.7.4\Start-Sync-Test.cmd。应出现标题“Nioh · 存档伴侣”的独立窗口，左侧版本为 0.7.4。
3. 进入“更多”，拖入已有 SAVEDATA.BIN 备份，核对角色与装备。原始文件只读，仍只解析独立副本。
4. 在配装点击装备、仓库筛选魂核或物品，确认与 0.7.3 的四页格局一致。分享没有系统分享支持时，改为保存可读 TXT；档案与分享卡导出会弹出文件保存对话框。
5. 更多中开启同步，用安卓 App 扫码接收。不需要把 JSON 导入手机。当前仍是同一可信 Wi-Fi 下的同步。
6. 关闭电脑独立窗口；手机应保留离线档案，不再能获取该次同步的新数据。
7. 重新打开电脑窗口，已保存的配装/本机档案应可恢复；重新开启同步并配对。
8. 缺少 WebView2 或启动失败时，不要卸载/清空数据；使用 Start-Browser-Mode.cmd，并反馈错误信息。

## 原资料与迁移

Windows 应用数据仍默认保存在 %LOCALAPPDATA%\Nioh2SaveCompanion；WebView2 profile 放在其 webview-profile 子目录。测试隔离目录不参与交付。

浏览器与 WebView2 的 IndexedDB 是两个独立空间。本机已解析快照可从同一个 Agent 数据目录恢复，但浏览器中收藏的配装和截图扩展不会自动复制：先在旧浏览器“更多 → 高级”导出备份，再到新窗口同一入口恢复。不要删浏览器资料。本项仅用于电脑迁移，不改变手机扫码主流程。

更换 --port 会改变网页 origin，可能使该端口的前端收藏看起来为空；日常使用保持 13254。更换数据目录也会启用独立 profile。

## 验证边界

开发自动测试覆盖持久化配置、不暴露自定义文件系统 JS API、仅本机监听、服务关闭、初始化失败清理和端口冲突；不等于真实 WebView2 窗口的拖放、存储和系统对话框已经验收。请按以上步骤做一次桌面实测。

原始 SAVEDATA、用户档案和 WebView2 profile 不进入 Windows 或 APK 安装包。游戏素材许可未确认，因此仍仅内部测试，未公开发布。

技术依据：pywebview 官方说明 [Windows 安装要求](https://pywebview.flowrl.com/guide/installation.html)、[持久存储参数](https://pywebview.flowrl.com/api/)、[打包说明](https://pywebview.flowrl.com/guide/freezing.html)。依赖及 wheel 哈希锁定在 packaging/requirements-desktop.txt；不自动安装或修改系统 WebView2。
