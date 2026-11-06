# 净记 PWA 验证记录

当前版本：1.0.1。

## 2026-11-06 历史记录导入显示修复（1.0.1）

- 复现：原生 v1 的 7 笔 9 月测试记录可以导入，但原页面仍保留 11 月和已有筛选条件，显示 0 笔。导入并未失败，记录被日期筛选隐藏。
- 导入成功或恢复上次导入前账本后，切换至账本完整日期范围、全部类型、清空搜索，并关闭设置页。
- 空账本直接显示原生账本导入入口；已有记录但当前筛选为空时显示总笔数，并可查看全部记录。
- 15 项 Node 检查通过，新增 v1/v2 历史导入显示、重新打开后的全部记录入口、空备份、取消与存储失败时状态保留验证。新增检查执行实际 app.js 函数，使用 DOM 和存储替身，不能替代真实 Safari 与 IndexedDB 验收。
- app.js、sw.js 语法检查通过，离线缓存版本更新为 jingji-pwa-1.0.1。
- 原生与 PWA 存储仍独立，真实账本需先通过原生 App 导出或从原手机取出后再导入；没有从项目或测试夹具自动生成个人记录。

## 1.0.0 已通过


- 11 项 Node 原生测试：金额精度、日期、跨月退款、转账与收入隔离、子账单不重复统计、超额退款和删除保护、部分退款后默认剩余全额退款、原生 v1 迁移、原生/PWA 共用 v2 夹具、DOM 引用、离线缓存资源、Manifest 与图标。
- `app.js`、`ledger-core.js`、`storage.js`、`sw.js` 语法检查。
- HTTP 资源检查：HTML、CSS、四个 JavaScript/Service Worker 文件、Manifest、192/512 图标均返回 200，MIME 类型正确。
- Manifest 使用 `standalone`、相对 `start_url`/`scope`，可部署在域名根目录或 GitHub Pages 子路径。
- Service Worker 预缓存清单中的文件全部存在，导航离线时回退到 `index.html`。
- 192/512 图标为无透明通道 PNG。
- 账本不包含外部请求、第三方脚本、分析 SDK 或服务端写入。
- PWA 可以读取此前原生版实际导出的 7 笔 v2 账本；Swift 原生核心也通过同一份 PWA v2 夹具读取跨月退款、工资和两个子账单，共 88 项原生核心验收通过。

## 未完成的验证

当前会话没有可用的受控浏览器实例，因此没有执行真实浏览器点击、iPhone Safari 安装、IndexedDB 写入、Service Worker 离线切换或主屏幕启动验收。不能用上述静态检查替代这些结果。

部署到 HTTPS 后需在 iPhone 上完成：添加到主屏幕、飞行模式重启、消费/退款/收入/转账/子账单、JSON 导入导出、清理 Safari 网站数据前的备份提醒，以及从原生版备份迁移。

## 重跑

```sh
cd PWA
npm test
node --check app.js
node --check ledger-core.js
node --check storage.js
node --check sw.js
python3 -m http.server 4173
```
