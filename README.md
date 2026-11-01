# Obsidian Bilibili Player（自用）

在 Obsidian 笔记里内嵌播放 B站视频：**扫码登录后 1080p 流式播放**（MSE + sidx 分片拉流，无本地缓存），支持时间戳⇄笔记联动。桌面 + 安卓（BRAT 安装）。

## 功能

- 阅读视图里自动识别 B站链接（`bilibili.com/video/BVxx`、`b23.tv` 短链、裸 BV 号、`?p=` 分P），替换为封面卡片，点 ▶ 播放
- 登录后按设置清晰度拉流（普通账号最高 1080p），在线流式，不落盘
- 时间戳联动：`[03:24](https://www.bilibili.com/video/BVxx&t=204)` 点击直接跳转；播放器右上「⧗ 复制时间戳」把当前时刻写回剪贴板
- 「⤢ 放大」应用内假全屏
- MSE 失败自动回退官方 iframe 播放器（无登录态，480p 兜底）

## 登录

设置 → Bilibili Player → 扫码登录（手机B站App扫一扫）；扫码不可用时手动粘贴 SESSDATA。

## 开发

```bash
npm install
npm run dev        # 构建插件（dev 模式）
npm run build      # 生产构建
npm run test:api   # 真实 API 链路验证（node）
npm run page && npm run test:server  # MSE 引擎浏览器验证（http://127.0.0.1:8377）
```

装进 vault：把 `main.js`、`manifest.json`、`styles.css` 复制到 `<vault>/.obsidian/plugins/bilibili-embed/`。

## 已知限制

- 时间戳链接 seek 依赖播放器已打开（同一笔记先点主链接）
- Live Preview（实时预览）模式不渲染内嵌卡，需切到阅读视图
- 番剧/课程/直播链接暂不支持（走不到 BV 解析的会显示原链接）
- B站接口有风控不确定性：插件已做克制（buvid 引导、结果缓存 30min、CDN 回退链），异常时回退 iframe

## 架构速记

- `src/bilibili/`：API 客户端（WBI 签名、扫码登录、buvid 引导、playurl→DASH 挑流）
- `src/player/dash-stream.ts`：MSE 引擎（头部 2MB 解析 sidx 建时间→字节索引；Range 分块 2MB 拉流 appendBuffer；双轨独立泵；seek 定位分片清缓冲续拉；无 sidx 退渐进模式）
- `src/player/embed.ts`：markdown 后处理器（链接→卡片/播放器/时间戳 seek）
- 传输层 `src/obsidian-transport.ts`：requestUrl + 完整 Chrome 头（B站 WAF 要求 Referer 配套 sec-ch-ua，否则 412）
