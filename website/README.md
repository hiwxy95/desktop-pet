# Desktop Pet 官方网站

这是 [Desktop Pet] 桌面陪伴宠物的官方宣传及下载落地页（Landing Page）。
项目采用了现代化的静态网页架构，具备自适应响应式设计，完美兼容桌面端与移动端。

## 🎨 技术栈

- **HTML5**：语义化结构设计
- **Tailwind CSS** (via CDN)：提供高效的原子化 CSS 与现代化排版布局
- **Alpine.js / Vanilla JS**：提供系统自动识别、平滑滚动、吸顶导航等轻量交互
- **FontAwesome**：图标支持

## 🚀 本地开发与预览

因为这是一个纯静态的网页项目，您无需复杂的 Node.js 构建流程即可预览。

### 方法一：使用 VS Code / Trae 插件（推荐）
如果您使用 Trae 或 VS Code 编辑器，您可以安装 `Live Server` 扩展：
1. 在编辑器中右键点击 `website/index.html` 文件。
2. 选择 **Open with Live Server**。
3. 浏览器会自动打开 `http://127.0.0.1:5500`。

### 方法二：使用 Python 或 Node 环境
如果您本地安装了 Python 3 或 Node.js，可在 `website` 目录下运行简单的 HTTP 服务：

- **使用 Node.js (npx serve)**:
  ```bash
  cd website
  npx serve -p 3000
  ```

- **使用 Python**:
  ```bash
  cd website
  python -m http.server 3000
  ```

然后在浏览器中访问：`http://localhost:3000`

## 📦 部署 (Vercel / GitHub Pages)

这个静态站点完美适配各种静态托管平台。
只需在 Vercel 中新建项目，将**根目录**设为 `website`，或者直接将本文件夹推送到 GitHub 仓库并开启 `GitHub Pages` 功能，即可在几秒钟内部署到线上。

## 🔧 下载文件替换说明
- Windows 安装包：请将最新的 `.exe` 文件覆盖放置于 `website/download/DesktopPet-Win.exe`。
- macOS 安装包：请将最新的 `.dmg` 文件覆盖放置于 `website/download/DesktopPet-Mac.dmg`。
网页上的 JS 会自动检测用户系统并正确触发上述下载链接。
