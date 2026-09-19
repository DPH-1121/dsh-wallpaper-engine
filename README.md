# dsh-wallpaper-engine

Wallpaper Engine 创意工坊浏览器，作为 DSH Web GUI 里的一个侧栏面板。

![panel](assets/panel.png)

![detail modal](assets/detail-modal.png)

左侧栏底部会出现一个「壁纸工坊」图标，点开是一整面网格：搜索、类型筛选、四种排序、
总页数与跳页，每张卡片点开是详情弹窗（订阅数 / 收藏 / 浏览 / 大小 / 标签 / 简介），
订阅按钮直接唤起 `steam://` 协议打开 Steam 客户端。

**不需要登录 Steam 就能浏览和搜索公开资源。**

## 它做什么

| 能力 | 状态 |
| --- | --- |
| 浏览热门 / 最新 / 评分 / 订阅榜 | ✅ 免登录 |
| 关键词搜索 | ✅ 免登录 |
| 类型筛选（场景 / 视频 / 应用 / 网页 / 动漫 / 游戏等 14 类） | ✅ 免登录 |
| 翻页 + 总条数 + 总页数 + 跳页 | ✅ 免登录 |
| 详情弹窗（订阅数 / 收藏 / 浏览 / 大小 / 标签 / 简介） | ✅ 免登录（匿名 WebAPI） |
| `steam://` 一键唤起 Steam 客户端订阅 | ✅ 未登录时弹引导窗 |
| Steam 登录检测 + 首次使用引导 | ✅ 读 `loginusers.vdf` 昵称 |
| 缩略图 | ✅ 浏览器直连 Steam CDN |
| 成人内容过滤 | ⚠️ 见下 |
| 下载壁纸文件到本地 | ❌ **本插件不做**，见下 |
| 把壁纸设为 DSH 界面背景 | ❌ 本插件不做（这是另一个插件 `dsh-wallhaven-wallpaper` 的事） |

## 诚实的边界

三件事必须先说清楚，免得你装完发现不是想要的东西。

### 1. 下载壁纸需要 Steam 登录，本插件不碰你的账号

Steam 对匿名下载请求的回答是：

```json
{"success":15,"message":"No user"}
```

实测确认过。也就是说**免登录只能浏览，不能下载**——这不是本插件偷懒，是 Steam 的
设计。要下载必须有真实的 Steam 会话，而本插件**不索取、不存储、不读取你的任何
凭据**。

本插件只读 `loginusers.vdf` 里的**昵称**，用来告诉面板"这台机器有没有登录过
Steam"，好让提示准确而不是笼统地写"下载需要 Steam"。它不读令牌、不读 `ssfn`
文件、不发起任何需要登录的请求。

想下载，就走卡片链接到工坊页面，在那里点「订阅」——那才是 Wallpaper Engine 的
正规用法。

### 2. 成人内容：匿名状态拿不到

Steam 用 `Adult only` 标签标记受众，而这个标签**匿名请求不返回**。实测匿名访问
`requiredtags=Adult` 过滤器得到 0 条结果。

所以面板上的「成人内容：隐藏/显示」开关是**按标签过滤**：在能拿到标签的条目上它
是准确的，但匿名状态下大部分成人条目标签本身就不可见。要真正看到它们，需要在
Steam 账号设置里打开社区内容偏好并登录——这条路径本插件没有实现。

### 3. 场景类壁纸不能在浏览器里渲染

Wallpaper Engine 有两类壁纸：

- **视频 / 图片类**：本质是 mp4/webm/jpg，浏览器能播。
- **场景类（Scene）**：是一个包含 `scene.pkg` 和资源的包，**必须由 Wallpaper
  Engine 自己的渲染器解包**，用它的着色器和管线。纯 Web 无法还原。

这是原理上的限制，不是工程量问题。所以本插件不做"把壁纸渲染成界面背景"——
那是 `dsh-wallhaven-wallpaper` 那种在线图库插件的活。

## 安装

```sh
dsh plugin --profile web add dsh-wallpaper-engine
```

或从仓库直接装：

```sh
dsh plugin --profile web add github:HaydenSmith1121/dsh-wallpaper-engine
```

装完需要重启 DSH，或让 profile 的 `patchReload: live` 生效。

## 代理

`steamcommunity.com` 在很多网络下无法直连（DNS 污染、路由被过滤）。**实测
TUN 模式是可靠的解法**：仅开系统代理时，Clash 的 `fake-ip` 会让
`steamcommunity.com` 解析到 `198.18.x.x`，而 DSH 自己的 web 服务会把这个保留
网段判定为非公网地址并拒绝请求。

本插件的宿主半**自带 CONNECT 隧道**（见 `src/host/net.js`），不依赖 Node 的
`fetch`，也不要求进程带 `--use-env-proxy`：

- 面板里填了代理 → 用它；
- 没填 → 回落到进程环境的 `HTTPS_PROXY` / `ALL_PROXY` 等。

实测在 7897 端口、TUN 模式下的表现：首次页面 10/10 成功，搜索稳定返回 30 条。

## 配置

配置写在 `$DSH_HOME/storages/dsh-wallpaper-engine/config.json`，不写进 DSH 的
共享 `settings.yaml`——那是产品自己的文档，第三方插件的代理地址不该混进去。

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `sort` | `trend` | 默认排序 |
| `showAdult` | `false` | 成人内容开关 |
| `proxy` | `""` | 代理地址；留空读环境变量 |

## 开发

```sh
npm test           # 26 个用例
npm run build      # src/ → lib/
npm run build:check # CI 门禁：lib/ 与 src/ 是否一致
npm run pack       # 打成可安装的 tgz
```

`lib/` 是**提交进仓库**的：这个包可以从 git 直接安装，而 git 安装不会跑本仓库
的构建脚本。`build:check` 是让提交的那份老实的手段。

宿主半是源码的直接拷贝（纯 ESM，无打包）；客户端半被包进 DSH 的
`window.__ModuleLoader__` 外壳，共享词汇内联在前面。

## 结构

```
src/index.js            宿主半入口：注册 /plugins/dsh-wallpaper-engine
src/host/net.js         带 CONNECT 隧道的 HTTP（无依赖）
src/host/store.js       配置文档（原子写）
src/host/workshop.js    创意工坊抓取与解析
src/host/steam.js       读取 loginusers.vdf 报告登录态
src/host/routes.js      路由分发
src/shared/constants.js 两半共用：URL 构造、HTML 解析、配置规范化
src/client.js           侧栏面板
```

## 许可

MIT
