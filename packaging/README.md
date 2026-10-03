# Windows 目录版构建

目录版将只读 Agent、生产网页、中文映射表和 Katana 解密工具放进同一个可移动目录。运行 `仁王2存档伴侣.exe` 后只监听 `127.0.0.1`，并在默认浏览器打开页面。快照写入 `%LOCALAPPDATA%\Nioh2SaveCompanion`，不会写入游戏存档目录。首次启动时会校验内置解密工具的 SHA-256，再复制到可写的应用数据目录；解密输出不会写进安装目录。

构建流程：

```powershell
.\build-windows.ps1
```

脚本默认先运行 Python 与网页回归测试，再生成版本化 ZIP 与 `.sha256.txt`，并再次检查 ZIP 顶层结构以及其中不存在 `SAVEDATA.BIN`、`BACKUP.BIN`、快照清单或 `.local` 数据。仅在已经单独完成同一轮测试时才使用 `-SkipTests`。

脚本会把 `requirements-build.txt` 中固定版本和哈希的构建依赖安装到项目内 `.build-tools`，不修改系统 Python。生成目录位于 `release\windows\Nioh2SaveCompanion`，并自动生成逐文件 SHA-256 清单；校验器会拒绝包含任何 `SAVEDATA.BIN`、`BACKUP.BIN` 或快照清单的发布目录。发布前仍需完成代码签名、恶意软件扫描、全新 Windows 虚拟机测试，以及 Katana 许可证复核。

这不是安装器，不会写注册表、创建系统服务或修改防火墙规则。局域网模式只用于受信任网络，可从命令行显式传入 `--lan`，也可在关闭普通模式后双击发布目录中的 `启动手机模式.cmd`。

测试或便携场景可用 `--data-dir <目录>` 覆盖数据位置；机器上有多个存档目录时可用 `--source <SteamID目录>` 明确选择。两者都不会放宽源文件只读校验。
