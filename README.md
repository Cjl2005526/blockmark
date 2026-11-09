# 色块标注（BlockMark）

在手机上把图片里「需要 AI 修改的区域」框出来，导出一张带半透明色块和编号的 PNG，
发给会看图的 AI（GPT-Image、Nano Banana、即梦等）当区域提示。

- 三种形状：矩形、圆形、三角形
- 拖四边单向拉伸，拖四角自由变形（桌面按住 Shift 锁等比）
- 2～5 个色块，自动编号，删除后编号自动补位
- 撤销 / 重做 / 换色 / 删除
- 导出原图像素的 PNG（超大图自动降到 4096 长边）
- 零依赖、无构建、可离线、可添加到主屏幕

## 跑起来

```bash
node server.mjs . 4173
```

终端会打印两个地址：

```
本机：  http://localhost:4173
手机：  http://192.168.x.x:4173
```

手机与电脑连同一个 Wi-Fi，用「手机」那行地址打开即可。

## 测试

```bash
node --test
```

纯几何、状态与撤销、导出尺寸决策都有单元测试，不需要浏览器。

## 端到端自检（可选）

需要本机装了 Chrome。先起一个有调试端口的无头 Chrome：

```powershell
$tmp = Join-Path $env:TEMP "blockmark-cdp"
Start-Process "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  -ArgumentList '--headless=new','--disable-gpu','--remote-debugging-port=9334',"--user-data-dir=$tmp",'--no-first-run','about:blank'
```

然后：

```bash
$env:CDP_PORT=9334
node qa/visual-check.mjs   # 截图 + 拖动/拉伸/导出/撤销的真实事件回放
node qa/photo-check.mjs    # 通过真实的文件选择框载入一张本地照片再导出
node qa/pwa-check.mjs      # Service Worker 与 manifest
```

截图落在 `.superpowers/shots/`（已 gitignore）。

## 开发用的小机关

- `http://localhost:4173/?demo=1` 自动载入一张示例图并放好三个色块，方便调样式
- `window.__blockmark` 暴露了 `store` / `view` / `exportPng()`，可在控制台里玩
- `dev/preview.html` 是不带交互的渲染预览床，用来单独核对色块与编号的视觉效果

## 已知限制

- **iOS 保存**：走系统分享面板（"存储图像"），网页版的先天限制，不是 bug
- **离线 / 安装**：Service Worker 只在 HTTPS 或 localhost 下生效。手机通过局域网 HTTP 打开时功能完全正常，但没有离线和安装能力；部署到任意静态托管（Vercel / Netlify / Cloudflare Pages）后即可获得
- **不自动保存**：刷新或关闭前会弹系统确认，但没有草稿恢复
- **导出只有 PNG**：不做黑白遮罩、不做 JSON 坐标导出
- **不支持旋转**：色块只能平移与拉伸

## 结构

| 文件 | 职责 |
| --- | --- |
| `src/shapes.js` | 纯几何：创建、移动、八向拉伸、等比、形状路径、颜色工具 |
| `src/state.js` | 形状列表、选中、编号、撤销重做（最多 50 步） |
| `src/view.js` | 图片等比适配、SVG 形状层、编号徽标、选中框与控制点 |
| `src/gestures.js` | 指针状态机：点选 / 拖动 / 八向拉伸 |
| `src/export.js` | 导出尺寸决策、Canvas 绘制、保存与分享 |
| `src/ui.js` | 工具栏、色板、计数、提示、toast |
| `src/main.js` | 装配、选图、导出流程、PWA 注册 |
| `server.mjs` | 零依赖静态服务器（可被测试直接 import） |
| `sw.js` | 网络优先 + 缓存兜底 |

坐标约定：每个色块的 `x, y, w, h` 都是相对图片显示区域的 0～1 比例值，因此转屏、换设备、导出高分辨率都不会错位。
