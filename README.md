# 净记 PWA

无需 App Store、开发者会员或每 7 天重新签名。部署为 HTTPS 静态网站后，可在 iPhone Safari 中“添加到主屏幕”，首次打开并完成离线缓存后即可离线使用。

GitHub Pages 地址：<https://allenchangchang.github.io/jingji-pwa/>。
源码仓库：<https://github.com/allenchangchang/jingji-pwa>。

## 功能

- 消费、收入、退款、转入、转出，退款自动关联原消费并按原月份抵扣。
- 退款金额使用灰色剩余可退金额；留空为全额退款，直接输入为部分退款。
- 主账单和单层子账单，收入单独汇总，按月或自定义日期筛选。
- IndexedDB 本地存储，无账号、无服务端、不上传账单。
- Service Worker 离线启动。
- JSON v2 与原生 iOS 版兼容；支持读取原生 v1/v2 备份。
- 导入前保留上一份账本，可在设置中恢复。

## 本地运行与验证

不能直接双击 `index.html`，Service Worker 和 ES Modules 需要 HTTP/HTTPS：

```sh
cd PWA
npm test
python3 -m http.server 4173
```

浏览器打开 `http://127.0.0.1:4173/`。localhost 可测试离线能力；iPhone 安装必须使用 HTTPS 地址。

## 免费部署

整个 `PWA/` 目录是静态站点，没有构建步骤。任选一个支持 HTTPS 的免费静态托管：

### GitHub Pages

本目录就是待发布仓库的根目录，包含 `.nojekyll`，无需构建或 Jekyll。默认仓库名为 `jingji-pwa`。

1. 在 Mac 安装 GitHub CLI 并登录：`gh auth login --hostname github.com --git-protocol https --web`。密码和验证码只在 GitHub 官方页面输入。
2. 在 GitHub 登录账号下新建公开仓库 `jingji-pwa`，将本目录提交到 `main` 分支后推送。
3. 仓库 Settings → Pages → Deploy from a branch，选择 `main` 和 `/ (root)`。
4. 等待 Pages 部署成功，用 Safari 打开 `https://<用户名>.github.io/jingji-pwa/`。需确认首页、`manifest.webmanifest`、`sw.js` 和两个图标均能正常访问，再添加到主屏幕。

免费 GitHub Pages 使用公开仓库。只发布本目录的 PWA 源码、说明和合成测试夹具，不上传原生 App 构建产物、个人账本或备份。

后续更新继续推送同一仓库的 `main` 分支，Pages 会自动发布；修改应用资源时同步更新 `sw.js` 的缓存版本。保持仓库名和网址不变，以便继续访问本机已有账本。版本回滚通过新的 Git 提交恢复旧文件后推送，发布前先导出账本备份。

GitHub Pages 仓库可以公开；账本不会进入仓库，账本只存在访问者手机的 IndexedDB 中。代码公开不等于账单公开。

### Cloudflare Pages / Netlify

直接上传本目录或 `JingJi-PWA-1.0.0.zip` 的解压内容，构建命令留空，输出目录为根目录。平台提供的 HTTPS 域名即可安装。

## 安装到 iPhone

1. 用 Safari 打开部署后的 HTTPS 地址，等待首页显示。
2. Safari 底部“分享” → “添加到主屏幕”。
3. 打开“作为网页 App 打开”，点“添加”。
4. 从桌面启动一次。之后没有 7 天过期限制，离线也可记账。

首次缓存必须联网。若更换域名，浏览器会视为另一个 App，需先从旧地址导出备份，再在新地址恢复。

## 从原生版迁移

1. 原生净记：设置 → 导出账本备份。
2. PWA：设置 → 从原生版或 PWA 备份恢复。
3. 选择 JSON 文件并确认。日期、金额、退款关系、收入和子账单都会保留。

两个版本不会自动同步。切换前先导出备份，确认 PWA 数据正确后再决定是否继续使用原生版。

## 数据安全与限制

- 数据只在当前 HTTPS 域名和当前设备的浏览器存储中。
- 删除主屏幕 Web App、清理 Safari 网站数据、系统存储回收或更换域名，都可能导致本地数据不可用。
- 定期导出 JSON 到“文件”或 iCloud Drive。PWA 会请求持久存储，但 iOS 是否批准由系统决定。
- 本版本不包含云同步、登录、微信/支付宝个人账单 API 或后台自动导入。
- 更新代码时需修改 `sw.js` 的 `CACHE` 版本，确保设备取得新资源。
