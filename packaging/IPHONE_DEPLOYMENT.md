# iPhone HTTPS 部署

`build-mobile.ps1` 生成纯静态 HTTPS 发布包。包内只有网页、图标、PWA 清单、Service Worker 和安全响应头配置，不包含原始存档、结构化角色档案、历史快照或配装册。

## 构建

```powershell
.\build-mobile.ps1
```

生成文件位于 `release/仁王2存档伴侣-<版本>-iphone-web.zip`。解压后的文件必须部署在一个独立 HTTPS 站点的根目录，不能放在 `/subfolder/`，因为当前 PWA 的作用域是 `/`。

## 推荐的首次验证方式

1. 在 Cloudflare Pages、Netlify 或同类静态托管中创建一个站点。
2. 上传 ZIP 解压后的全部内容，不要上传 ZIP 本身。
3. 用 iPhone Safari 打开 HTTPS 地址。
4. 点 Safari 分享按钮，选择“添加到主屏幕”。
5. 从电脑端 0.7.0 点击“导出档案包”，把 JSON 保存到 iCloud Drive。
6. 从 iPhone 主屏幕启动应用，点击“导入我的档案包”。
7. 强制关闭应用、关闭电脑并开启飞行模式，再次从主屏幕打开。

第 7 步仍能看到真实角色和配装，才算首版离线闭环验收通过。

## 隐私边界

静态托管只接收通用应用外壳。角色档案包由 Safari 在设备本地解析并保存到 IndexedDB，应用没有上传档案包的 API。部署时不要把任何导出的 JSON、`SAVEDATA.BIN`、`BACKUP.BIN` 或项目 `.local` 目录加入站点文件。
