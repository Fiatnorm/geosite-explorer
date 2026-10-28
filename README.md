# GeoSite Explorer

[![CI](https://github.com/Fiatnorm/geosite-explorer/actions/workflows/ci.yml/badge.svg)](https://github.com/Fiatnorm/geosite-explorer/actions/workflows/ci.yml)

Sing-box 域名规则浏览器。直接浏览、搜索、查看 SagerNet 官方 GeoSite 规则，查看实际 `.srs` 文件中的完整域名、域名后缀、关键词和正则。使用与 Argo-Singbox 订阅中心一致的紫色 Material 3 配色、圆角及深浅主题，适配手机。

只有平铺的规则列表与域名明细，没有额外用途分类、分类映射或其他数据源。

## 本地运行

需要 Node.js 22 或更新版本及 npm。

```powershell
npm ci
npm run dev
```

打开终端显示的本地地址，通常为 `http://localhost:8787`。搜索支持 `openai`、`geosite:openai`、`geosite-openai.srs`。打开页面即显示全部规则集。每行依次提供复制名称、查看域名弹窗、跳转官方文件三个按钮；弹窗列出完整域名并支持检索。名称可直接复制到 Argo-Singbox 的 GeoSite 输入中。

```powershell
npm run check
npm test
npm run build
```

`build` 生成 `dist/`，包含网页资源、Pages Functions 的 `_worker.js` 和仅匹配 `/api/*` 的 `_routes.json`，不发布任何资源。该目录会在每次构建时重建，请勿存放手工文件。

## 部署到 Cloudflare Pages

项目使用 [Pages Functions 高级模式](https://developers.cloudflare.com/pages/functions/advanced-mode/)，网页与 API 同域运行，无需数据库、KV、R2 或定时任务。只有 `/api/*` 请求进入 Function，其他文件由 Pages 静态资源服务处理。

在 Cloudflare 控制台选择 **Workers & Pages → Create application → Pages → Connect to Git**，授权并选择此 GitHub 仓库，填写：

| 设置 | 值 |
| --- | --- |
| Production branch | `main` |
| Framework preset | `None` |
| Root directory | 留空（仓库根目录） |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Environment variable | `NODE_VERSION=22` |

Pages 会安装 `package-lock.json` 中的依赖，再执行构建。不要将输出目录设置为 `public`，否则 `/api/` 不会作为 Pages Functions 发布。构建后会生成服务端 `_worker.js`，其实现来自 `src/worker.js`，不需要手动同步两份代码。

默认读取公开的 SagerNet GitHub 接口。若遇到 GitHub API 限流，可在 Pages 项目的 **Settings → Variables and Secrets** 添加 `GITHUB_TOKEN` Secret（Production 和 Preview 按需分别设置），只授予读取公开仓库所需权限，然后重新部署。不要在构建变量、客户端代码或仓库中填写 Token；服务端只将它发送到 GitHub API，不发送到 Raw 下载地址。

本地运行 `npm run dev` 会先构建再启动 Pages 开发服务。修改 `public/` 或 `src/` 后重新运行此命令以更新构建产物。本地 Secret 可写入已被忽略的 `.dev.vars`。

本仓库已准备 Pages 配置，但尚未创建 Cloudflare 项目或验证公网部署。

## 数据与更新

- 唯一规则来源：[SagerNet/sing-geosite 的 rule-set 分支](https://github.com/SagerNet/sing-geosite/tree/rule-set)。通过 Git Tree API 获取全部文件，不使用有文件数量上限的目录列表；目录截断或为空会报错。
- 首次打开获取目录，Cloudflare 边缘缓存最多 5 分钟。页面可点击“检查更新”，前台运行时也每 5 分钟检查，重新切回标签页时再检查。检查更新会遵循边缘缓存，因此不承诺每次点击都直接请求 GitHub。
- 先读取 `rule-set` 最新提交，再读取该提交对应的完整目录树。目录返回树 SHA、提交 SHA、官方提交时间与检查时间。明细从提交 SHA 的固定路径读取，避免目录、更新时间和规则在更新时混用版本。固定版本文件缓存一年；新提交自动切换新文件，不需要重新部署。
- 无访问时不主动同步；下次请求在缓存过期后检查最新分支。上游失败时显示错误；已经打开的页面保留已加载目录，不伪称更新成功。未实现跨会话离线快照。
- 英文界面标题为 `🌳Sing-Geosite Tree`，浏览器标签为 `Geosite-Explorer`。标题下方以 `Last updated: YYYY-MM-DD HH:mm:ss | Version abc1234` 居中显示元数据。更新时间来自 `rule-set` 分支最新提交的 committer 时间（UTC+8），7 位版本来自该提交 SHA；标题下方 `Checked at` 是本网站检查目录的时间。
- 浏览器 Web Worker 使用 `DecompressionStream` 解压并解析 SRS，避免在 Cloudflare 请求中消耗解析 CPU，也避免阻塞页面主线程。无需 Go、Sing-box 可执行文件或服务端二进制转换。

## 解析边界

解析依据 [Sing-box SRS 格式实现](https://github.com/SagerNet/sing-box/blob/testing/common/srs/binary.go) 和 [Sing 域名匹配器序列化格式](https://github.com/SagerNet/sing/blob/main/common/domain/matcher.go)，包含 succinct trie 的域名还原和旧版后缀合并。实现按格式独立编写。

支持 SRS v1–v3 中 sing-geosite 使用的默认域名规则：`domain`、`domain_suffix`、`domain_keyword`、`domain_regex`。域名后缀 `example.com` 包含根域名和子域名，`.example.com` 只包含子域名；关键词和正则按原始文本显示。二进制中的最终规则不保留原始 include 层级，因此页面不推造引用树。

这不是通用 SRS 编辑器；遇到未知版本、非域名字段、逻辑或反向规则时明确报错，不把它们误展示为无条件域名。损坏、截断或解压超过 64 MiB 的文件也报错。需要支持模块 Web Worker 和 DecompressionStream 的现代浏览器。

## 验证记录

2026-10-28，新增 Cloudflare Pages 构建配置、API 路由清单和构建产物回归测试。9 项测试、语法检查和 Pages Worker 编译通过；Wrangler 更新至 4.154.0，依赖审计为 0 项漏洞。Pages 本地服务实测成功加载 1,994 个规则集并打开 OpenAI 的 25 条规则。公网部署留待连接 Cloudflare 后验证。

2026-10-28，globe 改为内联 SVG，不再通过 PNG 遮罩显示。规则搜索复用目录行，域名搜索复用域名行并防抖；解析结果使用最多 8 个文件的 LRU 内存缓存。解析超时、运行错误和消息错误会释放等待任务并重建解析器；已关闭弹窗不再渲染迟到的结果。目录请求等待时间调整为 45 秒，覆盖两次各最长 20 秒的上游请求；切回标签页按 5 分钟间隔限制重复检查。手机操作按钮为 44px，输入字号为 16px，域名类型和内容上下排列。

语法检查、8 项测试及打包预检通过。Chromium 验证 1,994 行全部显示、内联 SVG、搜索前后行节点复用、搜索后弹窗缓存、域名检索、905 条大规则集、下载失败重试，以及 320/360/390/768px 页面和弹窗无横向溢出。使用模拟挂起的 Worker 和加速计时验证解析超时后重试成功。本机同一浏览器清空搜索恢复列表的三次均值由约 165ms 降至 124ms（包含 100ms 防抖），仅为小样本观察，不代表跨设备基准。回归脚本和截图在 `output/playwright/`。未进行长期压力测试、真机 Safari 验证或公网部署；GitHub 网络、限流及上游格式变更仍会影响可用性。

2026-10-24，更新网站图标、globe 列表图标、顶部来源信息及 Copy / View domains / Official file 操作。移除行内展开、文件大小和分页按钮。语法检查、8 项自动测试及 Wrangler 打包预检通过；实际 Chromium 验证全部 1,899 个规则集首屏加载后均在列表中、复制内容、固定版本官方文件链接、域名弹窗检索及空结果、Esc 关闭、主题保存、390px 手机无横向溢出、下载失败重试和目录刷新失败恢复。弹窗中的 904 条大规则集域名完整列出。界面截图位于 `output/playwright/`；未发布到 Cloudflare。

2026-10-23，本地对上游树 `e1fbb8bade32b99664896c0ec072705f16ac3b2a` 的全部 1,899 个文件进行解析，并逐文件与官方 Sing-box 1.13.18 的 `rule-set decompile` 输出比较：123,364 条规则的类型和内容全部一致。该数量是本次验证快照，不是程序内置清单。

语法检查、7 项自动测试及 Wrangler 部署打包预检通过。在实际 Chromium 浏览器中验证了展开、规则名与域名搜索、名称复制、明暗主题保存、390px 手机布局、大规则分页、首次加载失败重试、规则下载失败重试，以及目录刷新失败保留数据和恢复。截图及本地对照报告位于忽略的 `output/verification/`。尚未向 Cloudflare 账户实际发布，也未验证公网部署或其他浏览器。

## 目录

```text
public/             页面、主题、后台解析器与 SRS 解析实现
src/worker.js       官方清单和固定版本 SRS 的同源接口
tests/              解析格式、错误边界及接口测试
scripts/build.mjs   生成 Pages 静态资源和服务端入口
wrangler.jsonc      Cloudflare Pages 部署配置
.github/workflows/  GitHub Actions 检查、测试和 Pages 打包验证
```
