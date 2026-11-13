# AI 小镇（AI Small Town）🐟

像素小镇 + 一条住在里面的 AI 居民。**她自己过日子**（有作息、有需求、有随机事件），也能被任何外部程序用一条 HTTP 事件驱动 —— 前端不认识任何业务方。

仓库：<https://github.com/shixiansi/Ai_small_town>

> 本项目**独立**：不 import 任何其它项目的代码，也不假设自己放在谁家的目录下。所有路径由本目录推导，部署位置用 `OFFICE_*` 环境变量覆盖（见《部署》一节）。

## 架构

```
任意事件源 ──HTTP POST /api/event──▶ office-hub (127.0.0.1:4321) ──WebSocket──▶ 浏览器 (Phaser 3)
（小镇自己的调度 / 你的脚本）          （hub/hub.mjs，PM2: office-hub）            （静态页，Nginx）
```

- **服务器只转发极小的 JSON 事件**，所有渲染在用户浏览器完成 → 小机器毫无压力
- hub 内存态运行（当前状态 + 最近 50 条事件环形缓冲），每次有效事件落盘 `hub/state.json`，重启可恢复
- 没有真实事件时（刚启动 / 落盘状态超过 6 小时）按**北京时间**回落：08:00–23:00 是 `idle`「这个点没有排班」（摸鱼等活），夜里才是 `sleeping`（v23 之前一律回落到睡觉，于是 19 点也显示鱼在床上）
- **作息表**（几点起床 / 吃饭 / 睡觉）的唯一事实源是 `hub/schedule.json`，前端 `SCHEDULE` 与它双向核对（`tools/check.mjs` 第 18 项）
- 对外只暴露一个通用入口：`POST /api/event`，状态名必须在 `hub/states.json` 白名单内。推送方**零依赖**：hub 不在线/超时一律静默，绝不阻塞它

## 目录

```
office/                      ← 本仓库根目录
├── package.json             npm scripts（dev / build / bust / check / verify / sync）
├── ecosystem.config.js      PM2：只挂 office-hub（路径全部按本目录推导）
├── sync_web.sh              把 web/ 同步到站点目录（含 bust + check 上线门禁）
├── hub/hub.mjs              状态中转（WS 广播 + POST /api/event 入口）
├── hub/states.json          状态白名单（唯一事实源，与前端双向校验）
├── hub/schedule.json        小镇作息表（唯一事实源，与前端 SCHEDULE 双向校验）
├── hub/random_events.json   随机事件表（B 层）
├── hub/map.custom.json      地图自定义层存档（hub 自动备份到 hub/map.backups/）
├── web/src/*.js             前端源码 19 个片段（build.mjs 拼成 web/office.js）
├── web/                     index.html / office.js（产物）/ map.json / assets/
├── tools/                   build / bust / check / dev / gen_* 等脚本
├── assets/src/              pixor 原始 zip 存档（含 CC0 LICENSE）
└── assets/extracted/        zip 解包内容
```

## 关键文件

| 文件 | 作用 |
|---|---|
| `web/src/head.js` | `STATE_MAP`（状态→区域/动作/动词）、`SCHEDULE`（页面上的今日作息，真相源是 `hub/schedule.json`）、常量与缩放表 |
| `web/src/life.js` | 本地生活模拟：无事件时按需求权重挑小动作（散步/接水/翻书/瘫沙发…） |
| `web/src/npc.js` | 小镇居民（喵酱 / 村长 / 博士）各自的状态机与作息 |
| `web/src/activity.js` | 最近动态窗：事件流 + 今日作息表 + 「为什么现在是这样」 |
| `hub/hub.mjs` | 状态中转：白名单校验、去抖、落盘、WS 广播、数值层、随机事件、地图自定义层 API |
| `hub/schedule.json` | 小镇作息表：几点起床/早饭/营生/午饭/小憩/散步/晚饭/放松/洗澡/睡觉 |
| `web/map.json` | 小镇布局：家具坐标、区域锚点、阻挡格、道路层。改完跑 `npm run bust` |
| 外部事件源（可选） | 任何程序都能 `POST /api/event` 推一条状态；本项目不含、也不依赖任何具体业务方 |

## 状态 → 场景映射

| 状态 | 场景 | 一般由谁触发 |
|---|---|---|
| arrive | 大门下 | 外部事件源「开始了」 |
| working | 工位打字（坐办公椅） | 上午的营生 |
| writing / weekly / diary / replying | 工位打字（坐办公椅） | 写点东西 / 回信 |
| browsing / watching / commenting | 工位 / 餐桌笔记本前 | 看点什么、聊两句 |
| organizing | 书架翻资料 | 整理东西 |
| designing | 设计台（课桌）动手做东西 | 做手工 |
| posting | 打印机 | 打印 / 发布 |
| mailing | 门廊信箱前 | 寄信 |
| error | 沙发挠头（红点） | 出错了 |
| idle | 沙发摸鱼（黄点） | 空档期没有班次（白天回落） |
| sleeping | 卧室床上（蓝点） | 夜间空档（08:00–23:00 之外）回落 / 23:00 睡觉班 |
| washing / eating / snacking | 洗漱台 / 灶台 / 冰箱 | 起床洗漱、正餐、翻零食 |
| relaxing / listening / gaming | 沙发 / 留声机 / 街机 | 放松时间 |
| strolling / browsing_market | 花园 / 市集 | 散步、赶集日 |
| recovering | 充电垫 | 午后小憩 |

无真实事件时，浏览器本地跑生活模拟：随机漫步、接水、看月亮、翻书、瘫沙发，每 2-5 秒随机微停顿；点击地图可让她走过去（纯参观，不影响真实状态）。

## 日常维护

### 改一个状态要同步动哪几处（维护手册）

前几轮的线上事故几乎都来自「只改了一处」：`working` 没进前端状态表、邮件三兄弟全指错区域、`debug.js` 漏同步。新增或重命名状态时按顺序过一遍：

| # | 文件 | 要动什么 | 漏了会怎样 |
|---|---|---|---|
| 1 | `web/src/head.js` | `STATE_MAP` 的 `zone / act / verb / mood / fx`；working 类还要进 `ACTIVE_STATES` | `onState` 静默兜底成 idle，鱼跑去沙发摸鱼、圆点不变绿 |
| 2 | `web/map.json` | `zones` 锚点 + `expect`（该区域该有的家具）/`feature`，必要时加 `sit` | 走得到但站错家具（v15 那 7 张截图） |
| 3 | `hub/states.json` | `states` 加状态名；working 类同步加 `active` | hub 直接 400 拒收外部推来的事件 |
| 4 | `web/src/debug.js` | 「🎬 演示一轮」的 `SEQ` 序列（可选） | 前端不报错，只是演示里没有这个状态 |
| 5 | `web/index.html` + 本文档 | 底部「怎么看懂它」、状态→场景映射表 | 说明文字和实际画面对不上 |

**改作息要同步动这几处**：`hub/schedule.json`（真相源）→ `web/src/head.js` 的 `SCHEDULE.shifts`（页面上的今日时间表）→ 若改的是「几点算白天」，还要同步 `hub/hub.mjs` 的 `OFFICE_WAKE_START / OFFICE_WAKE_END` 与 `SCHEDULE.wake` / `schedule.json.wake`。只改一边的后果：页面上写着 09:00 营生、实际 10 点才动，或者反过来 —— `check.mjs` 第 18 项会把两边对不上的班次拦下来。

改完跑：`npm run verify`（= `bust --check` + `build --check` + `check.mjs`，双向校验 STATE_MAP↔states.json、SCHEDULE↔schedule.json、锚点与家具语义、资源版本号）→ `npm run sync`（`sync_web.sh` 已把前两步接成门禁）。

> **hub 属于后端服务，不在 `sync_web.sh` 的同步范围内**：改了 `hub/hub.mjs`、`hub/states.json`、`hub/schedule.json` 后要单独同步 `hub/` 目录并 `pm2 restart office-hub`。漏同步 `states.json` 时 hub 降级为「不校验白名单」并打 warn 日志，不会把事件拒之门外。
> 状态落盘在 `hub/state.json`（`OFFICE_STATE_FILE` 可改），重启自动恢复；超过 `OFFICE_STATE_MAX_AGE_MS`（默认 6 小时）的旧状态会**按当前时辰回落**（08:00–23:00 → `idle`「这个点没有排班」，夜里 → `sleeping`），避免昨天那条状态一直挂着、也避免白天一重启就显示鱼在床上。

### 常用命令

```bash
# 第一次：装依赖（只有 hub 需要一个 ws，npm workspace 会一并装好）
npm install

# 本地一键运行（静态 4322 + hub 4321）
npm run dev

# 改前端后：刷新版本号 + 拼产物
npm run bust

# 全量自检（bust --check + build --check + check.mjs）
npm run verify

# 发布到站点目录（内含 bust + check 门禁）
npm run sync
#   OFFICE_DEPLOY_DIR=/srv/www/town npm run sync        # 换部署目录
#   OFFICE_AUTO_PUSH=1 npm run sync                     # 顺手推 git 远程

# hub 状态
curl -s http://127.0.0.1:4321/api/status | python3 -m json.tool
pm2 logs office-hub --lines 20

# 手动推一个事件看效果（状态必须在 hub/states.json 白名单内）
curl -s -X POST http://127.0.0.1:4321/api/event \
  -H 'Content-Type: application/json' \
  -d '{"state":"working","task":"在整理院子","detail":"外部程序推来的事件"}'
```

## 素材授权

全部来自 [pixor.art](https://pixor.art) 素材库，**CC0 1.0 公有领域**（每个 zip 内附 LICENSE.txt），可自由使用/修改/商用，无需署名。角色 whale 与小镇物件同库，风格天然统一。

## 部署

本项目不假设放哪、也不认识任何其它项目，所有路径都由自身目录推导，需要外部决定的只有下面这些环境变量：

| 变量 | 默认 | 作用 |
|---|---|---|
| `OFFICE_DEPLOY_DIR` | `/www/wwwroot/ai-town` | `sync_web.sh` 的静态站点目录 |
| `OFFICE_DEPLOY_OWNER` | `www:www` | 同步后 chown 的属主（仅 root 生效） |
| `OFFICE_AUTO_PUSH` | `0` | `sync_web.sh` 末尾是否 `git push origin HEAD` |
| `OFFICE_PORT` / `OFFICE_HOST` | `4321` / `127.0.0.1` | hub 监听地址 |
| `OFFICE_STATE_FILE` / `OFFICE_MAP_FILE` | `hub/state.json` / `hub/map.custom.json` | 落盘位置（测试用 `npm run test:hub` 会指到临时目录） |
| `OFFICE_WAKE_START` / `OFFICE_WAKE_END` | `8` / `23` | 空档回落的清醒时段，须与 `hub/schedule.json` 的 `wake` 一致 |
| `OFFICE_NGINX_CONF` | 无 | 指向站点 nginx 配置；设了才检查 `/office-hub-api/` 反代 |
| `OFFICE_CRONTAB_FILE` | 无 | 可选：想让作息跟某台机器的 crontab 对一下时指过去（仅告警） |

要点：

- 前端静态文件由 `sync_web.sh` 从本目录复制到 `$OFFICE_DEPLOY_DIR`；**直接改站点目录的文件会在下次同步时被覆盖**
- Nginx：静态目录 alias 到 `$OFFICE_DEPLOY_DIR`，并把 `/office-ws/` 反代到 `127.0.0.1:4321`（Upgrade 头 + 读超时 1h）；hub 的 HTTP 接口默认不对外，需要调试台/编辑器保存时再加 `/office-hub-api/` 反代
- PM2 由本项目自己的 `office/ecosystem.config.js` 管理（`pm2 start ecosystem.config.js && pm2 save`），与其它项目互不影响
- Phaser 3.90 本地托管在 `assets/phaser.min.js`，不依赖外部 CDN

## 开发日志（历史记录，按当时原样保留）

> 本项目早期是另一个仓库里的一个子目录，被一个真实的 AI 博主 agent 直接驱动（那些条目里出现的 `agent/*.mjs`、`agent/office_client.mjs`、`scripts/crontab.txt` 都已在解耦时移除，不再是本仓库的一部分）。
> 现在小镇**只认两件事**：`POST /api/event` 推来的状态事件，和自己 `hub/schedule.json` 里的作息。下面这些条目保留原样，作为踩坑记录查阅。

## v2 渲染修正（2026-11-06）

针对首版"素材摆放/穿模/常动"问题的重构：

1. **bbox 实测定位**：crop_sprites.py 测量每个精灵第 0 帧的内容包围盒写入 manifest（`bbox:[x,y,w,h]`）。渲染 origin = 内容底边中心（不是帧底），物品"脚踏实地"。
2. **on: 引用叠加**：桌上物用 `"on":"宿主id" + dx/dy`，坐标由宿主台面推导（`y = 宿主y - 宿主内容高 + dy`），不再手填绝对坐标。深度 = 宿主 footY + 1。
3. **占地碰撞**：每件落地家具的 bbox 底部 12px 投影映射到格子 → A* 网格阻挡（约 65 格）。叠加物/墙饰不产生碰撞。鱼无法穿模；点击阻挡格会被拒绝。
4. **深度 = 内容底边 y**：家具与鱼统一 depth 排序，正确前后遮挡。
5. **动画只在用时播放**：computer/printer/chair 等常驻静止第 0 帧；仅当对应工作状态（writing→电脑屏、posting→打印机）时 play，结束 stopFx 复位。椅子 anim repeat=0 只转一圈。
6. **四朝向**：whale South/East/West/North 四行（看窗边/书架时背对镜头）。
7. **缓存**：index.html 引用 `office.js?v=N`，SceneBoot 加载 `assets/*.png?v=2`、`map.json?v=2`——**素材更新后必须递增版本号**（Cloudflare 缓存 max-age=3600）。

## v3 大小关系 + 灯光系统（2026-11-06）

1. **大小关系**：SCALE_TABLE 定义每件物品内容高度相对 48px 格的期望比例（如咖啡杯 0.55、电脑 0.85、大件家具 1.0），渲染时按 `cap*TILE/内容高` 缩放——杯子不会和桌子一样高。
2. **灯光系统**：
   - 环境遮罩层（深夜蓝黑）alpha 平滑渐变（0.18 暗 ↔ 1.0 亮，每帧 6% 趋近）
   - 5 个暖光池（工位/茶水台/打印机/落地灯/门口，ADD 混合径向渐变纹理）+ 窗边冷色月光
   - **自动**：`sleeping` → 关灯（hello 初始态"办公室还没开灯"现在是真的黑），其余状态 → 开灯
   - **手动**：墙上开关（门右侧，黄杆=开）可点击切换，悬停放大；下一次真实事件回到自动模式

## v4 定位精修（2026-11-06）

逐状态"进行时"截图核对后的修正：

1. **坐姿系统**：zone 增加 `sit` 引用（host + dx/dy）。arriveAct 时鱼 tween 滑进宿主家具（椅子/沙发），坐姿 setScale(0.8) 比站姿小，depth 手动提到家具之上且不被 y 排序覆盖；离开 acting 恢复 0.95。
   - 工位：鱼坐进办公椅（dy=-14），背对镜头面向桌子，头+背鳍露出椅背
   - 沙发：鱼陷进坐垫（dy=-2），头和背鳍露出，摸鱼/出错/睡觉都在沙发上
2. **朝向保持**：fish.still() 修复为停在"当前朝向行"的第 0 帧（原来强制回 South 帧，导致 face n 后被重置面向镜头）。
3. **锚点校准**：desk face n（面向桌子）、tea 贴近圆桌、printer/window/library/tools 贴墙根。

## v5 细节修正（2026-11-06，用户手机截图反馈）

1. **光池过曝**：5 个光池 alpha 全下调（工位 0.75→0.5、茶水台 0.5→0.35、打印机 0.45→0.32、落地灯 0.6→0.45、门口 0.4→0.3）且半径收窄——开灯后不再有刺眼亮斑。
2. **小物比例**：咖啡杯 0.55→0.32、laptop 0.7→0.55、纸堆/书堆 0.65→0.5、铅笔筒 0.7→0.55 等——马克杯现在约桌面的 1/3 高，符合真实比例。
3. **椅子朝向**：新增 `frame` 字段支持指定初始帧；椅子用 North 行首帧（24）= 座面朝北面向电脑。修复 stopFx 强制 setFrame(0) 把椅子打回 South 的 bug——现在 fx 停止后回到各自的基准帧。

## v6 叠加物重叠清理（2026-11-06，用户截图反馈"一坨"）

系统性审计：每条 `on:` 叠加记录核对"叠加物占宽 + dx 范围 ≤ 宿主台面内容宽"：
- 会议桌 tableA：3 件(66px)挤 42px 台面 → 只留居中 laptop，纸堆移到桌旁地面
- 打印机(台面仅 20px)：纸堆/书堆全部移到打印机两侧地面
- filing-cabinet(16px)：电话(28px)移到柜旁地面
- 工位：台灯 dx-20→-16、铅笔筒 dx+19→+14（右缘原本超出桌沿悬空）
- 会议桌杯子移除（茶水圆桌已有）
最终 8 组叠加全部通过宽度审计（含 2px 容差），无悬空、无重叠。

## v7 桌型扩展与电话归位（2026-11-06）

用户反馈"电话在地上"+"放大桌子/加桌型"：

1. **新素材 5 件**（pixor CC0）：desk-wood 木桌（64px，台面 52px）、dining-table 大会议桌（58px 台面+自带四椅）、school-desk 小书桌、chair 木椅、nightstand 备用。
2. **主工位放大**：office-desk scale 1.0→1.25，台面有效宽度 42→52px。
3. **电话归位**：红色办公电话（含纸笔）放到门口新木桌 desk-wood 上（台面审计 ✓），旁边配木椅；mail 区域锚点同步移到木桌前。
4. **会议桌升级**：round-table → dining-table 大长桌（带四把椅子），laptop 居中。
5. **新增学习角**：窗边 school-desk + 木椅 + 书堆（窄台面只放一件，审计通过）。
6. 布局脚本 bug 修复：desk-wood 曾被自己的替换逻辑跳过导致不渲染。

10 组叠加全部通过台面宽度审计。

## v8 加载兜底与缓存策略（2026-11-06）

用户反馈手机端"一直显示办公室布置中"（loading 永驻）。排查：

- 服务端与桌面/手机模拟均正常（场景 ready、WS 连通、资源全 200），定位为**手机端缓存/弱网**导致资源加载链失败，Phaser 未启动。
- 修复：
  1. **nginx 缓存分层**：index.html `no-cache, must-revalidate`（每次 revalidate，更新即时生效）；`assets/*.png|json` 7 天；`js/css` 1 天（带 ?v= 版本键）。
  2. **loading 兜底**：8 秒未就绪自动显示"加载太慢？点此刷新"，不再永久卡死。
- 注意：CF 边缘可能仍有旧 index.html 缓存（最长 1 小时），过期后即走新策略。

## v9 美术评审整改（2026-11-06）

依据《办公室场景-美术评审报告》落地修复（P0 全部 + P1 三项 + P2 一项）：

- **#3 P0 接触阴影**：每个落地物件底部加椭圆软影（内容宽×1.1、高 8px、#3A2A1A/25%），物件不再悬浮；墙面物件与叠加物不加。
- **#3 P0 光源对齐**：新增 3 盏吸顶吊灯（灯线+灯罩+灯泡），光池只挂在实体光源下方（吊灯×3 + 落地灯×1），删除"门厅"等无源光晕；灯泡随开关亮/灭。
- **#2 P0 昼夜收敛**：窗外天空由同一状态变量驱动——关灯=深蓝星空弯月+冷月光，开灯=蓝天白云+日光；状态切换时重绘。关灯环境叠加从 18% 提到 32%（评审建议 35~45%），剪影可辨且与台词一致。
- **#5 P1 明度阶梯**：地板深格 L147→L105（双色差 17→42/255 ≥40），家具与背景分层清晰。
- **#6 P1 空间围合**：左右墙加宽至 10px + 5px 踢脚线暗带；顶部墙下沿加 2px 深色描边。
- **#7/#8 P1 摆放与负空间**：孤立盆栽移至饮水机旁成对；中部加 7.5×4.6 格暖驼色椭圆地毯作视觉重心（纯视觉层，无碰撞）。
- **#9 P2 顶部栏**：压暗一档（L≈150→135）+ 下沿描边，与地板明度分离。

评审未采纳/已提前完成项：#1 透视体系（评审建议二选一重做——当前 3/4 视角家具+俯视地板是像素办公室游戏常见惯例，且 36 件资产已按统一 bbox/origin 规范对齐，暂保留）；#4 同族规格表（现有素材全部来自 pixor 同一画师 office/interior 库，风格同源）；#10 气泡指向（v3 已实现气泡尾锚定说话者头顶）。

10% 缩略图复测：能辨认"有桌椅灯光的房间"，地毯/光池形成视觉重心。

## v10 证据系统（2026-11-06）

依据《AI 自主生活·场景与资产清单》§3"补证据"落地——AI 干了什么必须能被看见：

1. **任务板**：黑板上方挂任务卡（深底衬保证可读），实时显示「今日完成 N 件 + 当前任务名」。
2. **产出物架**：每完成 1 件任务，右侧原奖杯下方的地板上多 1 个金色小奖杯（一排最多 6 个），产出有可见累积。
3. **计数持久化**：完成数按日期存 localStorage，刷新/重开浏览器不丢，跨天自动清零。
4. 完成判定：相邻两个非睡眠任务切换时 +1。

清单其余部分（卧室/餐厨/客厅新场景、房间切换 UI、P1 场景）属新场景扩建，待排期。

## v11 场景扩建：自主生活全场景（2026-11-06）

按《AI 自主生活·场景与资产清单》完成 P0+P1 场景扩建：

### 世界扩展：26 格 → 44 格宽，3 房间 + 门洞连通
- office(0-24) | 隔墙+门洞 | bedroom(26-34) | 隔墙+门洞 | bath(36-43)
- 相机视口 1248×768，跟随鱼移动（死区 300px 防抖）；右上角房间切换按钮（办公室/卧室/卫浴）点击平移相机

### 新增场景
- **卧室**（P0 作息）：双人床、衣柜、床头柜+台灯、窗帘、木椅、绿植——sleeping 态鱼走回卧室**坐进床里**（Z 字特效）
- **卫浴**（P1 卫生）：洗手池+镜子+挂钟、浴缸（蓝色水）、马桶、绿植——washing 态站在镜子前洗漱
- **餐厨角**（P0 补给，位于 office 左下）：冰箱、灶台、料理台+水果碗+水壶——eating 站灶台前、snacking 开冰箱
- **放松角**（P1 情绪）：绿色单人沙发——relaxing 坐进沙发
- **门廊补充**：鞋柜（小柜）、信箱（挂墙）

### 新增状态
sleeping→bed(坐床)、washing→washup、eating→cook、snacking→fridge、relaxing→relax(坐 armchair)

### 新素材 14 件（pixor CC0）
double-bed、bed、wardrobe、curtains、mirror、toilet、bathtub、fridge、stove-kitchen、kitchen-counter、sink、fruit-bowl、kettle、mailbox、armchair（合计 49 件素材）

### 跨房间验证
鱼从办公室横穿 2 道门洞到卧室入睡：A* 自动绕墙寻路 ✓；房间切换按钮平移相机 ✓；昼夜两态截图核对 ✓

清单余项：阳台窗边（现有窗+栏杆可后续补）、娱乐角音响、P2 场景——体验增强项，核心闭环（作息/补给/产出/情绪/社交/记忆）已全部有落点。

## v12 清单全量完成（2026-11-06）

《AI 自主生活》清单 P1 剩余 + P2 全部落地，世界扩展至 56 格：

### 新增场景
- **小花园**（P2 探索）：真草地（双色绿格+土色小径）、橡树、公园长椅、路灯、灌木、花丛、栅栏——露天无顶墙（顶部画天空）
- **市集**（P2 经济）：红白棚 market-stall + 水果摊 stall-fruit + 金币（摊上）——browsing_market 逛市集
- **恢复角**（P2 恢复）：药架（potion-shelf 挂墙）+ 充电坐垫——recovering 坐垫上"充电恢复"（mood=sleeping 自动关灯）
- **娱乐角补齐**（P1）：留声机、街机、坐垫——listening 坐 armchair 听音乐（♪音符粒子飘出）、gaming 坐垫上打游戏（手柄抖动）
- **阳台/门廊补全**（P1）：栅栏、招牌

### 天气系统（清单状态层第三层）
- R 键切换晴/雨（玩家干预点）；雨天：80 条雨丝粒子下落 + 全屏阴天色罩 + 窗景变灰蓝雨丝
- 天气独立于昼夜/灯光，三层叠加互不干扰

### 玩家干预点（清单要求每场景≥1）
- 房间切换按钮（右上）、R 键天气、墙上灯开关
- **点击互动家具**：留声机→听音乐、街机→打游戏、床→躺一会儿、冰箱→找吃的、灶台→做饭吃、长椅→坐下歇会、充电垫→充电恢复、单人沙发→放松——点击后鱼自动走过去执行

### 新素材 15 件（累计 64 件）
gramophone、arcade-cabinet、crown-cushion、bench-park、oak-tree、street-lamp、market-stall、stall-fruit、coin、potion-shelf、fence、sign-inn、fence-picket、bush、flowers

### 新状态 7 个
strolling（花园散步）、browsing_market（逛市集）、recovering（充电恢复）、listening（听音乐♪）、gaming（打游戏）+ 对应 zone 路由

至此清单 §2 场景表全部 13 项中：P0 5/5 ✓、P1 4/4 ✓、P2 4/4（恢复角/花园/市集/留言板以门廊信箱+招牌承担）✓。§8 桌面小窗口约束（单房间切换、薄 UI、快切换、插件产出可见）全部满足。

## v13 本地运行 + 调试工作台 + 界面走查修复（2026-11-06）

### 本地运行（只需 Node 22+，无需 Nginx / 数据库）

```bash
node office/tools/dev.mjs
# 静态页      http://127.0.0.1:4322/
# 调试工作台  http://127.0.0.1:4322/?debug=1   （或页面右下角 🛠 / 按 D / Esc 关闭）
# 状态 hub    http://127.0.0.1:4321/api/status
```

- `tools/dev.mjs` 自动起 hub（已运行则复用）+ 静态服务，响应带 `no-store`，改完刷新即生效
- 本地页的 WebSocket 自动直连 `ws://127.0.0.1:4321/`，**不需要** Nginx 的 `/office-ws/` 反代；
  可用 `?ws=ws://host:port/`、`?hub=端口` 或调试台的输入框覆盖
- hub 已允许 CORS，调试台可从 4322 直接 `POST /api/event` 走完整真实链路
- 调试工作台（`web/debug.js`，按需动态加载）：状态注入 / 推 hub / 一轮工作演示、灯光·天气·房间·走位控制、
  碰撞格与锚点叠加、素材帧号与布局审计、1 秒刷新的实时诊断、画布截图、控制台日志捕获

### 无头浏览器走查发现并修复的界面问题

| # | 问题 | 原因 | 修复 |
|---|---|---|---|
| 1 | 房间切换按钮变成白底默认按钮、移动端挤占画布 | `.room-tab` 样式写在 `#room-tabs` 内，被 `buildRoomTabs()` 的 `innerHTML=""` 一起清掉 | 样式移到 `<head>`，补 ≤600px 尺寸与 flex-wrap |
| 2 | 关灯态几乎全黑，家具完全看不清 | `ambient.setAlpha(1 - ambientCur)` 中把"亮度"当成"遮罩比例"，0.32 得到 68% 黑（初始 0.18 → 82%） | 统一为关灯 40% 遮罩（亮度 0.60），开灯 0 |
| 3 | 控制台反复警告 `Texture "chair" has no frame "24"` | `chair` 素材只有 4 帧，`map.json` 两处沿用 32 帧 whale/chair 的 `frame:24` | 两处改 `frame:3`（North 行首帧），map 版本号 17→18 |
| 4 | 本地打开时 WS 每 2s 重连刷屏，状态条永远"连接中…" | 本地静态服务没有 `/office-ws/` 反代，且无离线态 | 本地自动直连 4321、离线徽章 +「离线·本地生活模拟中」、重连降频到 30s 上限 |
| 5 | v11/v12 扩建的花园/市集/恢复角没有直达入口 | `ROOMS` 只有 3 个 | 新增第 4 个「花园」标签 |
| 6 | `window.__office.props` 末尾输出一项 NaN 噪音 | 鱼的占位对象被当成家具读 key/x/y | 诊断输出过滤 `isFish` |
| 7 | 任务板「今日完成 N 件 / 当前任务」被黑板、书架等家具盖住半行 | `boardText.setDepth(20)` 低于家具 footY(120~768) | 深度提到 9000、字号 13→14px、底衬不透明度提高 |
| 8 | 中央地毯像一块灰色污渍；视口右缘有突兀亮蓝竖条 | 地毯比地板更暗且偏灰；隔墙色 `0x76839a` 与顶墙 `0x66738a` 不一致 | 地毯改亮暖驼色 + 同心细纹；隔墙与顶部墙统一同色 |

宽屏（≥1200px）打开调试台时页面自动让出右侧 392px，画布/状态条/说明文字不再被面板遮挡；移动端面板全屏覆盖，Esc 关闭。

**无头 Chrome 走查结果（2026-11-06，1440px + 375px）**：改后控制台 0 error / 0 warning（改前 2 条 chair 帧警告 + 持续 WS 404）；
素材帧号审计 0 处越界；真实链路 `POST /api/event → WS → 鱼走到工位坐下 → 开灯 → 气泡/状态条` 全通；
雨天、碰撞格叠加、花园相机平移、离线降级、移动端无横向溢出均验证通过。截图在 `logs/v13-*.png`。

同时新增 `window.__officeCtl` 控制接口（供调试台使用）：`states/zones/rooms/emit/pushHub/hubStatus/setLights/setWeather/gotoRoom/setWs/toggleGrid/frameAudit/resetEvidence/screenshot/snapshot`。

## v14 坐席定位修复 + 区域锚点全量审计（2026-11-06）

用户反馈「瘫坐在沙发上，根本没定位到沙发」。走查后发现这不是单点问题，而是**整条状态→区域→落座链路**都有偏移，于是补了一层审计把同类问题一次性量出来。

### 根因

`idleStep()` 里的本地生活小动作 `goLocal("sofa", "瘫在沙发上", "idle_rest")` 走 `walkLocalTo → arriveLocal`，
而 `arriveLocal()` **完全没有坐席逻辑**：只有真实事件 `onState → arriveAct` 才会读 `zone.sit`。
结果鱼只是走到 `sofa` 锚点、站在沙发前的地板上，气泡却写着「瘫在沙发上」。
叠加 `sofa` 锚点 `[4.4,12]` 本身落在阻挡格里（`A*` 再漂到 `[4,11]`），偏移更明显。

### 无头浏览器区域锚点审计（新增）发现并修复的问题

| # | 问题 | 修复 |
|---|---|---|
| 1 | 本地生活「瘫在沙发上」不落座，只站到沙发前空地 | 抽出统一 `applySit(zone)`，真实事件与本地生活共用；新增 `unsit()` 统一起身 |
| 2 | 坐上去仍像「竖着插进沙发」，气泡盖住鱼头 | 坐席新增 `lounge` 标记（沙发/床/单人沙发/充电垫）：身体横躺 74°、缩小压扁、呼吸 + Zzz、气泡上移到 -62、状态圆点贴回鱼身；工位椅子保持坐直、背对镜头打字 |
| 3 | `sofa/mail/cook/fridge/relax` 五个锚点落在阻挡格，被 `nearestFree` 随机漂走 | `map.json` 锚点全部改到对应家具前的可走格 |
| 4 | `bed` 锚点距床 2.3 格，落座 tween 横向瞬移 | 落座 tween 时长按距离动态计算（220ms~700ms） |
| 5 | **`arrive` 状态引用了不存在的 `door` 区域**，`onState` 直接抛 `Cannot read properties of undefined (reading 'anchor')` | 新增 `door` 区域；`onState` 增加区域兜底与告警，不再让单个坏配置打断整条状态链路 |
| 6 | `board` 锚点被误报为不可走 | 标记 `decorative: true`（它只用于任务板文字定位，不参与寻路） |
| 7 | **点击互动家具永远无效**：`bindClick` 先 `if (grid[gy][gx]) return`，而家具本身就在阻挡格 | 热点检测移到阻挡格检查之前；顺手补 `sofaA → idle「瘫一会儿」` 热点 |
| 8 | 热点寻路把 `fish.y` 传给了 `px2tx()`（旧的冗余三元表达式） | 改为 `px2ty(fish.y)` |
| 9 | 快速连续注入状态时，上一次落座 tween 没取消，会把鱼拉回沙发 | `applySit`/`unsit` 都 `killTweensOf(fish)` |
| 10 | 坐过沙发后再走路，scale 0.8 / sitting / 躺姿角度残留 | `walkLocalTo`、点击、热点路径统一先 `unsit()` |
| 11 | 本地生活动作恰好已在目标格时 `path.length < 2` 直接 return，气泡和动作全哑火 | 只在 `astar` 返回 null 时放弃 |
| 12 | 跨房间移动固定 2.2px/帧（≈132px/s），横跨世界要 15s+，状态早变了鱼还在路上 | 长路径（>14 格）提速到 4.0px/帧，短距离保持原节奏 |
| 13 | `SCALE_TABLE` 里 `office-desk` 重复定义（1.0 与 1.25） | 删除重复键 |

### 调试工作台增强

- ③ 场景控制新增「本地生活模拟」四个快捷键：🛋 瘫沙发 / 🥤 接水 / 🌙 看月亮 / 📖 翻书，一键复现随机小动作（对应 `__officeCtl.localAct(key)`）
- ④ 审计按钮现在同时输出：**帧号越界 + 区域锚点问题 + 5 处坐席的宿主/距离/躺坐类型 + 阻挡格统计**（对应 `__officeCtl.zoneAudit()`）
- 碰撞格叠加里蓝点 = 区域锚点，配合审计可直接看出哪个状态会漂到哪

### 验证（1440px + 375px，无头 Chrome）

- `zoneAudit()`：**0 处锚点问题、0 处帧号越界**（改前 8 处）；23 个区域全部落在可走格
- 本地生活 `localAct('sofa')`：3.6s 后鱼落到 `(187,646)` = 沙发坐垫中心，`sitting=true`、气泡「瘫在沙发上」；8.4s 后起身离席 `sitting=false`
- 真实事件链路：`writing`（工位，`face=n` 背对打字）→ `idle`（沙发横躺，`face=s`）→ `sleeping`（床上，`(1488,277)`）→ `arrive`（门口 `(168,361)`，不再抛错）全通
- 真实鼠标点击沙发 → 气泡「瘫一会儿」、鱼走回沙发落座（改前被阻挡格检查吞掉）
- 控制台 **0 error / 0 warning**；移动端 375px 无横向溢出，调试台新增按钮不挤出面板

改动文件：`web/map.json`（v18→v19，锚点 + `door` + `lounge`）、`web/office.js`（v33→v34）、`web/debug.js`（v1→v2）、`web/index.html`。
截图见 `logs/v14-final-*.png`。线上生效仍需 `sync_web.sh`（版本号已递增）。

---

## v15 · 状态落点语义校准（2026-11-06）

复现方式：用调试台的 26 个状态快捷键逐个注入，比对气泡文字与鱼实际站的位置。发现**沙发修好后，其余工作状态普遍"站错地方"**：

| 状态 | 改前实际落点 | 改后 |
|---|---|---|
| 发邮件 / 回评论 / B站评论 | 全部挤在 `(217,456)` = 冰箱、灶台、果盘中间的厨房 | 分别为信箱前、工位办公椅、餐桌笔记本前 |
| 看视频 / 写日记 | 同为 `(792,169)` = 书架墙前的空地 | 餐桌笔记本前 / 工位办公椅 |
| 做封面 | `(981,168)` = 奖杯与储物柜前 | 设计台（课桌 + 书本）前 |
| 到岗 | `(168,359)` = 餐桌旁，离大门 6 格 | 大门下 `(169,216)` |

**根因**：`map.json` 的 `window / tools / mail / door` 锚点是早期按"墙分区"估的坐标，v11/v12 扩建家具后没有跟着挪；`STATE_MAP` 又长期把邮件三兄弟都指向 `mail`。v14 的 `zoneAudit()` 只校验「锚点是否可走 / 坐席距离」，所以这种"能走得到、但站错家具"的错误全部漏检，审计一直报 0 问题。

### 修复

1. **区域与家具绑定**：每个 zone 增加 `expect`（该区域名字所指的家具资产名）或 `feature`（门/窗这类背景设施），并新增 `screen`（白板）、`dining`（餐桌 + laptop）两个区域；所有办公区锚点重算到对应家具前的可走格。
2. **状态表重排**：`watching→dining`、`diary→desk`、`designing→tools`、`mailing→mail`、`replying→desk`、`commenting→dining`、`arrive→door`；写日记/回评论现在真的坐上办公椅打字。
3. **气泡避让**：鱼面朝北（背对镜头）时正前方就是要互动的家具，气泡原本整块盖住电脑/课桌/餐桌；改为侧移 88px + 小三角斜指回鱼，靠近画布右缘时自动改往左移，避免被裁切。到岗锚点下移一格，气泡不再压住「今日完成 N 件」任务板文字。
4. **街机越界**：`gaming` 锚点 `y=14.8` 四舍五入成 15，超出 `ROWS=15`（合法行 0–14），A* 会把鱼送到画布外；改为 `y=14.0`。
5. **审计升级**：`zoneAudit()` 新增「锚点 2.2 格内是否存在 `expect` 家具」「目标格是否越出地图」两项校验，并返回 `states`（25 个状态 → 区域 → 落点 → 是否坐席）；调试台审计面板按区域分组列出状态落点，新增 `gridMap()` 只读接口。

### 验证（1440px + 375px，无头 Chrome）

- `zoneAudit()`：**0 issues**、23 个区域语义校验全通过（21 个 `expect` + 2 个 `feature`）、0 帧号越界
- 25 个状态逐个 `emit` 无异常；控制台 **0 error / 0 warning**，60fps
- 用户反馈的 7 个状态重跑：到岗 `(169,216)` 门下、看视频 `(599,408)` 餐桌笔记本前、写日记 `(384,384)` 坐办公椅、做封面 `(1080,362)` 设计台前、发邮件 `(360,218)` 信箱前、回评论坐办公椅、B站评论餐桌前；目标家具均完整可见、无穿模
- `gaming` 落点 `(1175,744)` 在 768 高画布内；花园右缘 `strolling` 气泡左移后完整可见
- 页面说明文字与状态表同步更新

改动文件：`web/map.json`（v19→v20）、`web/office.js`（v34→v35）、`web/debug.js`（v2→v3）、`web/index.html`、`README.md`。
截图见 `logs/v15-*.png`。线上生效仍需 `sync_web.sh`。

## v16 巡检补充：跨模块状态名与线上调试入口（2026-11-06）

前几轮只查了前端 `office.js` + `map.json`，把范围扩到 `agent/` 和 `sync_web.sh` 后又抓到两个线上问题：

1. **`working` 状态前端没有映射**：`agent/office_client.mjs` 的 `officeRun()` 每次运行都推 `office("arrive")` 后紧跟 `office("working")`，而 `STATE_MAP` 里没有 `working`，`onState` 静默兜底成 `idle` —— 鱼刚到岗就跑去沙发摸鱼、亮黄点，直到几十秒后第一条真实业务状态到达；且两条事件同一 tick 到达，「到岗」走位会被立刻打断。
   修：前端补 `working → desk / typing / fx:pc` 并加入 `ACTIVE_STATES`（兼容任意事件源）；agent 侧删掉紧随 `arrive` 的那条 `working`，「开始干活」交给随后的真实业务状态。
2. **线上调试台 404**：`sync_web.sh` 只 cp 了 `index.html / office.js / map.json`，漏了 `debug.js`；但 `index.html` 上的 🛠 按钮和 `?debug=1` 在生产环境依然存在，点了只报一行 script error、毫无反应。
   修：`sync_web.sh` 补 `debug.js`；`index.html` 在非 localhost 时隐藏 🛠 按钮并屏蔽 D 键，`?debug=1` 保留给主人排查线上问题（此时 debug.js 已可加载）。注意 `hubBase()` 线上返回空串，调试台的「推到 hub / hub 状态」走同源 `/api/*`，Nginx 未反代这两条路径，属于已知限制。

验证：`node --check` 全过；agent 侧 14 个状态名 ⊆ 前端 26 个状态（0 缺失）；浏览器注入 `working` → 鱼坐到工位 `(384,384)`、背对镜头打字、气泡正常；`zoneAudit` 0 issues、0 帧越界、60fps、控制台 0 error / 0 warning；本地调试入口仍可见。

改动文件：`agent/office_client.mjs`、`web/office.js`（v35→v36）、`web/index.html`、`sync_web.sh`、`README.md`。线上生效仍需 `sync_web.sh`。

## v17 上线门禁与工程化（2026-11-06）

### 1. `tools/check.mjs` — 静态自检，不开浏览器

```bash
node office/tools/check.mjs        # 11 项检查，任一失败退出码 1
```

判定逻辑与浏览器内 `__officeCtl.zoneAudit()` 同源：坐标推导复刻 `makePlacement()`，碰撞格复刻 `buildBlockedGrid()`，避免「静态 0 问题、画面全错」。覆盖：JSON / `map.room` 与 `office.js` 常量一致性 / 状态→区域引用 / 锚点越界与阻挡 / 区域语义家具 2.2 格 / 坐席宿主距离 / 家具资产·`on` 引用·PNG 帧号·重复 id / **agent 推送状态 ⊆ STATE_MAP** / 圆点样式 / `sync_web.sh` 文件清单 / 资源版本号。

负向验证：在临时副本里注入「`desk.expect` 指向不存在的素材、`arcade` 锚点 `y=14.8` 越界、agent 推一个 `ghost_state`」→ 3 个错误全部被拦下，退出码 1。

### 2. `tools/bust.mjs` — 版本号按内容 hash 自动生成

```bash
node office/tools/bust.mjs           # 幂等改写 web/office.js + web/index.html
node office/tools/bust.mjs --check   # 只比对，过期退出码 1
```

原先 `office.js?v=36`、`debug.js?v=3`、`map.json?v=20`、`manifest.json?v=2`、`*.png?v=2` 五处手工递增，漏一次线上就是缓存旧版（前四轮已手改 4 次）。现在 5 个版本号全部由内容算 sha256 前 8 位：`office.js` / `debug.js` 写在 `index.html`，`map.json` / `manifest.json` / 64 张 PNG 的合并 hash 写成 `office.js` 里的 `ASSET_V`。

注意自引用：`index.html` 存着 `office.js` 的 hash，而 `office.js` 里又存着别的 hash。按「先算不依赖 office.js 的三个 → 虚拟改写 office.js → 再算它的 hash → 最后改写 index.html」单向执行，一次收敛，重复跑内容不变（具体值由 `bust.mjs` 运行时打印，不要写死在文档里）。

### 3. 资源加载失败兜底

`SceneBoot` 原先没有 `loaderror` 处理：任一 PNG/JSON 缺失时 Phaser 仍会触发 `complete`，`office` 场景带着缺失纹理连锁报错，而 `#loading` 永远停在「办公室布置中…」。现在统一收集失败项，在 `complete` 里拦下启动，把失败资源名、可能原因和刷新链接写回遮罩。

实测：移走 `assets/plant-office.png` → 显示「办公室资源加载失败 / 有 1 个资源没能加载：plant-office / 线上多半是漏同步了 assets/…」，场景不启动；恢复文件后重新加载正常，控制台 0 error / 0 warning。

### 上线门禁

`sync_web.sh` 现在按 `bust.mjs → check.mjs → cp` 顺序执行，任一失败即中止同步；工具目录缺失时只警告、保持旧流程可用。

> ⚠️ 服务器上必须存在 `office/tools/{bust,check}.mjs` 以及 `agent/` 目录：`check.mjs` 会扫描 agent 的状态名，工具缺失时门禁会被跳过。**同步到服务器时请把 `office/tools/` 一并带上**，否则等于没有门禁。

另清理了 `.dot.browsing / .dot.watching` 两条永不生效的 CSS（这两个状态在 `ACTIVE_STATES` 里，圆点统一走 `.working`），自检因此从 2 条警告降到 0。

改动文件：`tools/check.mjs`（新增）、`tools/bust.mjs`（新增）、`tools/dev.mjs`、`web/office.js`、`web/index.html`、`sync_web.sh`、`README.md`。

---

## v18 hub 健壮性 + 线上调试台 + 无障碍（2026-11-06）

P2 backlog 全量落地，外加两项低成本无障碍改进。

### 1. 状态白名单与单一清单 `hub/states.json`

新增 26 个状态 / 23 个 active 的清单，hub 启动时读取并拒收未登记状态（400 + 明确错误与允许列表），`dot.className` 也不再拿任意字符串直接拼 DOM。读不到清单时降级为不校验并打 warn，避免漏同步文件导致真实事件全被拒。`check.mjs` 新增「states.json ↔ STATE_MAP / ACTIVE_STATES 双向一致」与「线上保护 / 白名单 / 持久化 / aria 防回退」两项（总数 11 → 13 项）；负向注入「漏 gaming、多 ghost_active」→ 4 个错误、退出码 1。

### 2. 去抖与心跳

旧版 `(state, task)` 相同就不广播、但 `recent` 每次都 push，列表堆满重复；且 detail 变化被吞掉。现在按 `state + task + detail` 三元组判定：完全相同视为心跳，只刷新 `ts`、不广播、不进 recent；detail 变化仍广播。前端 `onState` 再兜一层：同一 `state + task` 只刷新状态条与时间戳，不重新寻路、不重复计「今日完成」、不打断当前动作（调试台 `emit(..., force=true)` 仍能一键复现走位）。

实测（独立端口 4399）：合法事件 204 → 心跳 recent 仍 1 且无重复广播 → detail 变 v2 广播 1 次 → `ghost_state` 与空状态各 400 且不污染当前状态；WS 广播恰为 3 次。

### 3. 轻量持久化

每次有效事件原子写 `hub/state.json`，重启恢复 `cur` 与最近 50 条事件；超过 `OFFICE_STATE_MAX_AGE_MS`（默认 6h）的旧状态回落 sleeping，非法状态也会过滤。实测重启后 `idle / 下班 + 3 条 recent` 完整恢复，把 ts 改成 2 天前则回到 sleeping 且 recent 清空。`/api/status` 新增 `allowedStates / persisted / startedAt`。

### 4. 线上调试台不再给出误导性报错

Nginx 只反代 `/office-ws/`，线上点「推送到 hub / 查 hub 状态」原本会 fetch 主站 `/api/event` 404 后报一句 CORS/JSON 错误。现在 `hubBase()` 非 localhost 返回空，`hubFetch()` 直接 reject；调试台把两个按钮禁用变灰并显示替代做法（本地 `dev.mjs` / SSH 上 curl）。本地 `?hub=端口` 覆盖也同步生效。`index.html` 线上隐藏 🛠 入口、屏蔽 D 键的逻辑保持不变。

### 5. 无障碍与小清理

canvas 加 `role=img + aria-label`，房间按钮加 `aria-pressed`（切换时同步更新），`#st-task` 加 `aria-live="polite"`，调试台 `role=dialog`、打开时焦点进面板、Esc 关闭后焦点还给入口按钮、`aria-expanded` 同步。375px 下家具热点按「屏幕直径 ≥44px」把判定半径换算回世界像素（0.275 倍缩放下约 80 世界 px / 44 CSS px，上限 1.8 格），并改为「最近优先」避免放大后误触相邻家具 —— 实测移动端真实点击沙发命中「瘫一会儿」。

清理 `update()` 里被下一行立刻覆盖的 `bodySpr.setY()`、未使用的 `sortTick`、包住单次 `setDepth` 的每帧 try/catch。

**验证**：`check.mjs` 13/13 · 0 错误 0 警告；`bust --check` 通过；6 个文件 `node --check`；浏览器 1440px 全链路（aria / 焦点 / 去重 / force / 白名单 / 圆点兜底 / 审计 0 issues）控制台 0 条；375px 无横向溢出且热点可点；主 hub 已重启到新代码、状态 sleeping。

改动文件：`hub/hub.mjs`、`hub/states.json`（新增）、`web/office.js`、`web/debug.js`、`web/index.html`、`tools/check.mjs`、`tools/dev.mjs`、`sync_web.sh`、`README.md`。**线上生效需 `sync_web.sh` + 单独同步 `office/hub/` 并 `pm2 restart office-hub`**。

---

## v19 形象替换：鲸鱼女仆 + 一整套动作帧（2026-11-06）

把原来那只深蓝色小鲸鱼换成用户三视图设定稿里的 Q 版**蓝发鲸鱼女仆**（蓝渐变长发、白色蕾丝发箍、呆毛、鲸鱼鳍耳、鲸尾、深蓝裙 + 白围裙），并第一次给角色做了真正的动作帧，不再靠 tween 抖身体假装动。

> 初版曾用 Pillow 逐像素程序化绘制（`tools/gen_whale_procedural.py` 留档），效果偏"手工"；**v19 最终版改用生图模型出立绘**，程序只负责工程化拼表。

### 1. AI 立绘素材 `tools/preview/ai/`

共 15 张 1024×1024 硬边像素立绘，白底、单角色、风格统一，由生图模型按用户三视图裁剪出的 `ref-front/side/back.png` 图生图得到：

- 方向定妆：`front.png` / `side.png` / `back.png`（正面大蓝眼、侧面长发全拖身后、背面整片渐变长发）
- 动作立绘：`typing / read / drink / wave / lounge / cheer / play / sleep / dizzy / think / eat / sit`
- `contact.png` 是 15 张的总览；生成用的提示词要点记录在 `tools/gen_whale.py` 文件头与本节。

### 2. 精灵表 `web/assets/whale.png`

`tools/gen_whale.py` 把这 15 张 AI 立绘工程化成 **512×1280 = 20 行 × 8 帧，每帧 64×64** 的精灵表，`bbox` 仍是 `[20,15,24,40]`（脚点 y=55 不变，家具/寻路/气泡全部不用改坐标）。处理链：

1. **抠白底**：从四角做连通域 floodfill，只删与边缘连通的白色，围裙/头饰内部的白不会被误抠；
2. **裁内容框 → 预乘 alpha 的 LANCZOS 降采样**到 48px 内容高（1024→48 直接最近邻会满屏杂色）；
3. **统一 25 色调色板量化 + 去孤立噪点 + 轻提亮**，再补 1px 深色外轮廓；
4. 按脚点居中贴进 64×64 帧；每行由基础帧派生 8 帧微动（整体起伏 + 上半身 1px 轻摆）。

`side.png` 水平翻转得到 West，`back.png` 复用给 `idle_back` / `typing_back`，`wave.png` 复用给 `reach`。

| 行 | 内容 | 行 | 内容 |
|---|---|---|---|
| 0–3 | 行走 South / East / West / North（**索引与旧版完全兼容**，`fish.face()` 仍按 `row*8` 取帧） | 10–11 | drink 举杯 / wave 挥手 |
| 4–5 | idle 正面呼吸眨眼 / idle_back 背面 | 12–13 | lounge 横躺 / cheer 举手欢呼 |
| 6–7 | typing 正面打字 / typing_back 背面打字 | 14–15 | sit 坐姿 / think 托腮思考 |
| 8–9 | read 捧书翻页 / sleep 闭眼睡觉 | 16–19 | play 手柄 / eat 吃饭 / dizzy 晕眼 / reach 伸手取物 |

行号表写在 `assets/whale.json` 与 `assets/manifest.json` 的 `whale.acts`（两个文件由脚本同步生成，必须一致）。预览图在 `tools/preview/`：`maid-portrait.png`（6× 定妆）、`maid-keys.png`（关键帧对比）、`maid-actions.png`（20 行首帧）、`maid-sheet.png`（整表 2×）；旧版原图备份为 `whale-original.png`。

### 3. 代码接入

`buildFish()` 按 `whale.acts` 为每个动作行注册 `act_<name>` 动画（帧率见 `ACT_RATE`），新增 `fish.playAct(name)`；`ACT_ANIM` 把 `STATE_MAP.act` 映射到动作行，`lastFace === "n"` 时自动切 `idle_back` / `typing_back`。`startActAnim()` 现在只做三件事：选行播放、瘫躺特例、补音符/Zzz 粒子；原来那一大段 typing/watch/play/fetch 的 `setAngle/setX` 抖动全部删除。`stopActAnim()` 复位后调 `fish.still()`，动作结束回到朝向站立帧。

**`setLoungePose()` 不再 `setAngle(74)`** —— 旧版靠把竖直的鱼转过来假装躺下，人形角色转 74° 会变成歪倒；现在直接播第 12 行专用横躺帧（含枕头与呼吸浮动）。`LOCAL_ACTS` 也换成贴切动作：接水→drink、看月亮→idle(背面)、翻书→read、瘫沙发→lounge（v20 已扩成 14 种，见下）。页面 `aria-label` 与说明文字同步为「蓝发鲸鱼女仆」。

若部署时漏带新 `whale.png` / 忘跑 `bust.mjs`，`playAct()` 找不到行会返回 false，代码优雅降级成静态朝向帧，不会白屏。

### 4. 门禁与复现

`check.mjs` 新增「鲸鱼女仆精灵表 / 动作帧」一项（13 → 14 项）：校验两个 json 一致、PNG 宽高与 `frameRows`、帧尺寸与 `bbox` 防回退、行号唯一且不越界、四方向固定在前 4 行、关键背面/横躺行存在、`ACT_ANIM` 与 `STATE_MAP.act` / `LOCAL_ACTS.anim` 全覆盖、生成脚本存在。

```bash
# 需要 office/tools/preview/ai/*.png 这 15 张 AI 立绘；只调整抠底/配色/帧动效时不用重新生图
python office/tools/gen_whale.py             # 重新生成 whale.png + 两个 json + 预览
python office/tools/gen_whale.py --preview  # 只出预览，不动 assets
node office/tools/bust.mjs                  # 改完 PNG / office.js 必须跑，否则线上缓存旧图
node office/tools/check.mjs
```

> 尺寸取舍：办公室一格地砖 48 世界 px，角色内容约 48px 高，屏幕实际约 39 CSS px。这个尺度下 AI 立绘的蕾丝、眼睛高光会被压掉，属于 64×64 sprite 的固有限制；若想更清楚，可以调大 `buildFish()` 里 `fish.setScale(0.95)`（需同步 `applySit()` / `unsit()` 与气泡偏移）。

回滚：`tools/preview/whale-original.png` 是旧版 512×256 四方向表；恢复它后要把两个 json 的 `whale` 条目改回 `{"frameW":64,"frameH":64,"rows":{...},"anim":null,"bbox":[20,15,24,40],"px":64}`（去掉 `acts`），代码会自动降级到旧动作表现，再跑一次 `bust.mjs`。

**验证**：`check.mjs` 14/14 · 0 错误 0 警告；`bust --check` 通过；`node --check` 全绿；无头 Chrome 走查 1440px / 375px 控制台 0 error 0 warning，`zoneAudit 0 issues`、`frameAudit []`，实机确认 `act_typing_back` / `act_lounge` / `act_drink` 帧动画正确播放、横躺落在沙发坐垫上、气泡不裁切。

改动文件：`tools/gen_whale.py`（新增，AI 素材版）、`tools/gen_whale_procedural.py`（初版留档）、`tools/preview/ai/*`（15 张 AI 立绘 + 裁好的三视图参考）、`tools/preview/*`（预览）、`web/assets/whale.png`、`web/assets/whale.json`、`web/assets/manifest.json`、`web/office.js`、`web/index.html`、`tools/check.mjs`、`README.md`。**线上生效只需 `sync_web.sh`**（角色资源在 `assets/` 内，hub 无需动；AI 素材只在 tools 下，不进 web 部署目录）。

---

## v20 · 本地生活事件 4 条 → 26 条（2026-11-06）

用户反馈「除了喝水就其他三项」：旧版 `idleStep()` 把 4 条小动作写死在 `if/else` 里，另外 42% 概率还是纯散步，25 个区域 / 20 行动作帧几乎全闲着。现在改成数据驱动。

### 1. 事件表 `web/office.js` → `LOCAL_EVENTS`

一条事件就是一行：`{ key, zone, label, icon, text, act, face, w, room }`。

| 房间 | 条数 | 举例 |
|---|---|---|
| 办公室 | 16 | 接水、看月亮、翻书、瘫沙发、回工位敲键盘、取打印纸、翻信箱、盯任务板、白板想点子、吃点心、下厨、翻冰箱、跟人挥手、阳台伸懒腰、犯迷糊 |
| 卧室 | 4 | 扶手椅、打街机、赖床、挑衣服 |
| 卫浴 | 3 | 洗脸、照镜子、充电回血 |
| 花园 | 3 | 看花、坐长椅、逛水果摊 |

14 种动作帧全部用上（drink / idle_back / read / lounge / sleep / typing_back / reach / think / eat / play / wave / cheer / sit / dizzy）。`ACT_ANIM` 补了 `wave` / `reach` 两个自映射 —— 原来它们只作为 `print` / `mail` / `fetch` 的目标行，直接当 act 名传会兜底成 idle。

躺在沙发/床/扶手椅/充电垫上时会命中 `applySit()` 的 `lounge` 分支，统一播横躺帧 + Zzz，靠文案和时长区分「瘫沙发」「赖床」「回血」，不要再给这些区域配站立动作。

### 2. 抽选策略

`pickLocalEvent()` 按「离鱼当前位置的距离」加权：`w / (1 + d * 0.16)`，就近活动为主，远处房间仍有机会被抽到；最近 6 次触发过的 key 先排除，避免连着两次瘫沙发。散步概率从 42% 降到 26%，74% 的空闲时刻都有具体小动作。`snapshot().localEvent` 报出当前事件 key，方便自动走查断言。

### 3. 调试台与门禁

调试台 ③ 保留 4 个常用按钮，新增「全部本地事件 (26) · 按房间」折叠区，按钮从 `C.localEvents()` 自动生成 —— 以后加事件不用改 `debug.js`。`__officeCtl.localAct(key, instant)` 改为查表，26 条都能一行注入复现；`instant = true` 会把鱼直接放到目标格跳过寻路（跨房间事件正常要走十几秒，勾选「⚡ 就地播放」即可快速逐个预览动作帧），默认 `false` 不影响正常走位。

`check.mjs` 新增第 15 项门禁：事件数 ≥18、key 唯一、zone ∈ `map.json.zones`、act ∈ `LOCAL_ACTS`、anim ∈ `ACT_ANIM`、face / room / w 合法、每个房间 ≥2 条、动作覆盖 ≥10 种、常用 4 个 key 与 `C.localEvents()` 接口存在。挡住「又缩回 4 条」和「写了不存在的区域」。

**加一条事件**：在 `LOCAL_EVENTS` 加一行即可（区域用 `map.json.zones` 里已有的 key，动作从 `LOCAL_ACTS` 里选；要全新动作得先在 `whale.acts` 加行并补 `ACT_ANIM` 映射）。改完跑 `node office/tools/bust.mjs && node office/tools/check.mjs`。

### 4. 顺带修掉的真 bug：本地表演定时器互相误杀

`arriveLocal()` 旧版每次到达都注册一个裸 `setTimeout` 来结束表演。连续触发两条本地事件（调试台连点、或点击事件插入）时，上一条的定时器会在新事件表演途中把 `fishState` 改成 `idle` 并清掉气泡 —— 动作帧还在播，状态却已经结束。现在用 `localActTimer` 记录句柄，回调里校验 `curPlan === thisPlan` 只结束自己那一轮；`walkLocalTo()` 开始新事件前先清旧定时器。逐条走查时正是它让 `tools` / `garden` 两条偶发 FAIL，修复后 26/26 稳定通过。

**验证**：`check.mjs` 15/15 · 0 错 0 警告；`bust --check` / `node --check` / `bash -n` 全绿；负向测试（注入不存在的 zone）正确 FAIL 并已还原。无头 Chrome 逐条就地播放 26 个事件：**26/26 动作帧与预期一致**（14 种动作行全覆盖）、气泡文案正确、控制台 0 error 0 warning、`frameAudit []`、`zoneAudit 0 issues`，调试台 26 个按钮与四组分组正常。证据在 `logs/v20-*.png`、`logs/v20-events.json`。

改动文件：`web/office.js`、`web/debug.js`、`tools/check.mjs`、`README.md`。**线上生效只需 `sync_web.sh`**（hub 不用动）。

---

## v21 · 画布内文字发虚、手机上完全看不清（2026-11-06）

**根因**：`office.js` 用 `type: Phaser.CANVAS` + 固定 `1248×768` + `scale.mode: FIT` + `pixelArt: true`。FIT 会把整张画布缩到容器宽度：实测 1440px 桌面 **0.856×**（调试台打开时 0.788×），375px 手机只有 **0.275×**。画布里 `scene.add.text()` 用的是「世界像素」，写死 13px 到手机上实际只剩 **3.6 CSS px**；再叠加 `pixelArt` 设的 `image-rendering: pixelated`（最近邻采样），中文细笔画的抗锯齿灰阶被采成灰块、带虚边重影。DOM 文字（状态条、说明、调试台）不经过 canvas，所以一直是清楚的 —— 这就是「只有画里的字糊」的原因。

**修复**：新增 `canvasScale()` / `uiK()` / `uiFont(cssPx)`，按实时 `getBoundingClientRect().width / canvas.width` 反算 `k = 1 / scale`，画布内所有 UI 文字与几何都乘 k。屏幕呈现尺寸恒定，但笔画拿到足够像素：

- 气泡：字号 `uiFont(13)`、`wordWrap` 宽度、padding、圆角、描边、小三角、文字位置、侧移/上移偏移全部乘 k；
- 任务板 `redrawBoard()`：字号 `uiFont(14)`、padding、lineSpacing 乘 k；
- Zzz / 音符粒子：字号与漂浮位移乘 k，避免大字压住角色。

实测：桌面 k=1.17 → 气泡 15 世界 px（屏幕 13 CSS px）；手机 k=3.64 → 气泡 47 世界 px（屏幕仍是 13 CSS px）。`window.resize` 与首屏 400ms 后重绘气泡与任务板，缩放比变化时不会留着旧字号。

`check.mjs` 新增第 16 项门禁：缺 `canvasScale()` / `uiFont()`、气泡或任务板写死字号、没有 resize 重绘、气泡偏移没换算，都会 FAIL，防止改回去。

**验证**：16/16 · 0 错 0 警告；无头 Chrome 1440px / 375px 截图确认桌面文字笔画完整锐利（灰边重影消失）、移动端 1× 下「忽然有点犯迷糊」可读；控制台 0 error、`frameAudit []`、`zoneAudit 0 issues`、26 条本地事件不受影响。修复前对照 `logs/v20-zoom-dizzy.png`，修复后 `logs/v21-*.png`。

> 若以后把气泡改成 DOM 浮层，可以删掉整套 `uiK()`：DOM 文字天然按 CSS 像素渲染、还能吃 devicePixelRatio，是更彻底的方案，但要自己处理相机跟随与深度，且 canvas 截图里会没有气泡。

改动文件：`web/office.js`、`tools/check.mjs`、`README.md`。**线上生效只需 `sync_web.sh`**。

---

## v22 · 宽屏打开调试台，画布缩在中间、左右两大块空白（2026-11-06）

**现象**：1912×966 视口 + 调试台打开时，地图只占内容区中间约 55% 宽，左右各露出约 200–350px 的 `#2a2e3d` 容器底色，角色和家具显得很小。

**根因（两个叠加）**：

1. `debug.js` 里 `@media (min-width:1200px){body.dbg-open .wrap{max-width:none;margin:0 392px 0 16px}}` 把内容区从 `1100px` 拉到 `1504px`。但**改 CSS 类不会触发 `window.resize`**，Phaser 的 `ScaleManager` 仍按初始化时的 parentSize（1068×657）算，canvas 保持 `1073×660` 并用 `CENTER_BOTH` 居中 —— 左右各 199px 空白就这么来的（实测 `canvasInline marginLeft:199px`）。
2. 即使手动 refresh 也修不好：`#office-parent` 的高度是 canvas 撑出来的，宽 1472 而高只有 657，FIT 取 `min(1472/1248, 657/768) = 0.855`，canvas 仍是 1068 宽、继续居中。**容器高度被 canvas 锁死，形成循环依赖**。

**修复（三处）**：

- `index.html`：`#office-parent` 加 `aspect-ratio: 1248 / 768`，高度由宽度按游戏比例决定，不再被 canvas 反锁；`#office-parent canvas` 用 `width/height:100% !important; margin:0 !important` 强制铺满，绕过 Phaser inline 尺寸滞后一拍的问题。
- `office.js`：`resize` 处理里加 `game.scale.refresh()`，让 Phaser 重算 parentSize / 输入缩放。
- `debug.js`：`show()` / `close()` 都调 `relayout()`，60ms 后派发 `new Event("resize")`，触发 Phaser 重排 + `refreshCanvasText()` 按新缩放比反算气泡字号。同时把宽屏 `.wrap` 的 `max-width:none` 换成 `calc((100vh - 210px) * 1248 / 768 + 32px)`，按视口高度反算内容宽度上限，避免超宽屏把画布撑到 900px 高、把状态条挤到首屏外。

`check.mjs` 新增第 17 项门禁：缺 aspect-ratio、canvas 没强制铺满、resize 没 refresh、面板没派发 resize、`show/close` 漏 relayout、或又把 `.wrap` 设成 `max-width:none`，都会 FAIL。

**实测（无头 Chrome，`canvas.x - parent.x` / `parent.right - canvas.right`）**：

| 场景 | 修复前左右留白 | 修复后左右留白 | 修复后缩放比 |
|---|---|---|---|
| 1912 调试台开 | `199 / 199 px` | `1 / 1 px` | 0.983（原 0.86） |
| 1912 调试台关 | 无 | `1 / 1 px` | 0.854 |
| 1440 调试台开 | 未单独测 | `1 / 1 px` | 0.80 |
| 375 手机 | 无 | `1 / 1 px` | 0.273 |

`1px` 是容器边框。同时确认：真实鼠标点击画布中心，期望世界坐标 `(966,422)`、鱼走到 `(984,406)`（偏差 24px ≈ 半格吸附），**CSS 强制缩放没有破坏 Phaser 输入坐标换算**；气泡「忽然有点犯迷糊」笔画锐利、`act_dizzy` 正确播放；`frameAudit []`、`zoneAudit 0 issues`、控制台 0 error/0 warning。截图 `logs/v22-*.png`。

**验证**：`check.mjs` 17/17 · 0 错 0 警告；`bust --check` / `node --check` / `bash -n` 全绿；负向测试（去掉 aspect-ratio / 去掉 refresh / 恢复 `max-width:none`）均正确 FAIL 并已还原。

改动文件：`web/index.html`、`web/office.js`、`web/debug.js`、`tools/check.mjs`、`README.md`。**线上生效只需 `sync_web.sh`**（hub 不用动）。

---

## v23 · 最近动态窗 + 今日时间表（"怎么 19 点就睡觉了"）

**用户问**：「给 office 添加一个最近事件窗口，可以看到 AI 最近干的事，还有现在的时间表是什么，怎么 19 点就睡觉了」。

前两问都是**信息缺口**：页面上只有一行状态条，刷新一下只剩「睡觉」，既看不出「刚才干了什么」，也看不出「这个点该不该有活」。第三问是**真 bug**：19 点显示睡觉不是它真睡了，而是 hub 的默认态写死了 `sleeping`。

### 1. 最近动态窗（`web/index.html` + `web/office.js`）

状态条下面新增一块面板，两个标签：

- **🕒 最近在做的事**：真实事件流水，一行 = 一条 agent 上报（时间 · 图标 · 动作 · 任务名 · detail · 几分钟前），最新的在最上面。
  - 数据来自 WS `hello.recent`（hub 内存最近 50 条，重启从 `state.json` 恢复后回放最近 20 条）+ 实时 `state` 广播；
  - 浏览器再存 40 条到 `localStorage.office_activity_v1`，刷新页面 / 发版后历史不丢；
  - 按 `state|task|ts` 去重，所以重连补发 hello、agent 30s 心跳都不会刷屏。
- **📅 今日时间表**：`SCHEDULE`（= 服务器 crontab 的影子）按北京时间列出今天所有班次，并直接回答三个问题：
  - 「现在 20:51（北京时间 · 周五）· 当前状态：摸鱼中」
  - 「此刻不在班次里；下一班 21:10 每日 agent（第二场），还有 19 分钟」
  - 「状态是『摸鱼』= 没有真实任务在跑……」/ 睡觉时则是「**20:51 这个点不该睡**：它不是主动睡的……」——**把「为什么现在是这样」直接写在面板上**，不靠人猜。
  - `every: N` 的班次（每 2 小时回评论、每 4 小时看B站）在表里只占一行（带「每 2 小时」角标，hover 看今天全部触发时刻），但内部展开成今天所有时刻，所以「此刻是否正在进行 / 下一班几点」算得准。

渲染全部走 **DOM**，不进画布：v21 已经证明 canvas 里的字在手机上是 3~4 CSS px 的糊块，这种长列表更不能进去。列表**各自限高自己滚**，上方的「现在 / 为什么」永远看得见（窄屏把 detail 列隐藏、列表限 150px）。

### 2. hub 空档回落按时钟（`hub/hub.mjs`）

根因：`initialState()` 写死 `{ state: "sleeping" }`。白天（例如 19:00）只要没有真实事件 —— 刚部署重启、或落盘状态超过 `OFFICE_STATE_MAX_AGE_MS`（6h）—— 页面就显示鱼躺在床上，而它其实只是「没活」。

现在按北京时间分档回落，时间窗与前端 `SCHEDULE.wake` 一致：

| 时刻（北京） | 无真实事件时显示 | 文案 |
|---|---|---|
| 08:00–23:00 | `idle`（沙发摸鱼，黄点） | 「这个点没有排班」+「空档期 · 等下一班」 |
| 23:00–08:00 | `sleeping`（卧室床上，蓝点） | 「办公室还没开灯…」+「夜里没有排班 · 明早 09:10 上班」 |

真实事件仍优先：agent 推什么都以 agent 为准，回落只在「一条事件都没有」时生效。`/api/status` 多返回 `wake: [8, 23]`，启动日志会打一行「空档回落：8:00–23:00 显示「idle」」，运维一眼能看出是哪一档。`OFFICE_WAKE_START / OFFICE_WAKE_END` 可覆盖（例如把白天拉长到 08:00–24:00）。

### 3. 排班表落成可核对的副本（`scripts/crontab.txt`）

以前「这个 AI 一天什么时候上班」只散在 `部署说明.md` 的文字和 `logs/*.log` 的时间戳里。现在 `scripts/crontab.txt` 记录完整排班（北京时间；权威来源仍是服务器 `crontab -l`），页面的 `SCHEDULE` 必须和它对得上 —— `check.mjs` 第 18 项逐班核对「分钟字段 / 小时字段（含 `*/N` 与 `9,21` 列表）/ 星期字段」，只改一边就 FAIL；反向发现「crontab 里有、页面表里没有」只告警，方便以后加新定时任务时提醒补一行。

今天的真实排班（北京时间）：

| 时刻 | 班次 | 说明 |
|---|---|---|
| 00:45 起每 4 小时 | B站互动 | `bili_interact.mjs`：看评论 / 回赞 / 私信 |
| 03:30 | 备份数据 | `scripts/backup.sh`（静默，不上报状态） |
| 08:25 起每 2 小时 | 回博客评论 | `agent.mjs reply-comments`，有新评论才上报 |
| 09:00 | 每日运营 | PocketBase cron：AI 写文 → 写库 → 发B站动态 |
| 09:10 | 每日 agent（第一场） | 刷B站 → 看视频 → 做封面 → 整理记忆 → 写文章 → 日记 → 发动态 → 日报邮件 |
| 20:00（仅周日） | 鱼缸周报 | `agent/weekly.mjs` |
| 21:10 | 每日 agent（第二场） | 同上，素材不与上午重复 |

**19:00 落在 18:25 与 20:45 之间**，本来就没有班次 —— 所以那一刻页面显示「睡觉」既不是它在偷懒也不是它在睡觉，而是「没有事件 + 默认态」的假象。现在同样的时刻会显示「摸鱼 · 这个点没有排班」，时间表里也直接写着下一班几点。

### 4. 门禁与诊断接口

`check.mjs` 新增第 18 项「最近动态窗（事件流 / 今日时间表 / crontab 对齐）」，共 12 类断言：面板 DOM 与 aria、`pushEvent` / `hello.recent` 合并 / 本地留档 / 30s 刷新、北京时间换算（出现 `getHours()` 就 FAIL，防止跟着访客本地时区漂）、必含班次、crontab 双向核对、hub 空档回落按时钟且与 `SCHEDULE.wake` 一致、列表各自限高（防止「现在 / 为什么」被滚出视野）。

`__officeCtl` 新增 `activity()`（流水 + 当前状态 + 面板 DOM 计数 + 此刻/下一班 + why 文案）、`schedule()`（今天的班次组与进行中/下一班）、`setActivityTab()`、`foldActivity()`、`resetActivity()`；`snapshot()` 里也带上 `activity` 摘要，自动走查能直接断言。

**验证**（本地 4321 hub + 4322 静态页，无头 Chrome 经 CDP 驱动）：

- `check.mjs` **18/18 · 0 错 0 警告**；`bust --check` / `node --check` 全绿
- 真实链路：hub 推 10 条事件 → 面板 10 行、时间图标动作 detail 齐全、`localStorage` 落 10 条、折叠状态与标签页记忆生效（`{"tab":"events","folded":true}`）
- 时间表：`现在 20:51（北京时间 · 周五）· 当前状态：摸鱼中` + 6 行班次（周日专属的周报当天不出现在表里）+「下一班 21:10 每日 agent（第二场），还有 19 分钟」；`activity().dom.plan === 6`
- 睡觉文案：注入 `sleeping` → 面板显示「20:48 这个点不该睡：它不是主动睡的 —— 没有真实事件、hub 又刚重启或状态超过 6 小时，默认态就回落成了『睡觉』」，同时画面关灯、鱼在卧室床上
- hub 空档回落（临时端口 4407 独立 state 文件，9 条用例全通过）：全新启动 → `idle / 这个点没有排班`；真实 `sleeping` 事件优先；重启未超时 → 恢复 `sleeping`；落盘 8 小时前的状态 → 回落 `idle` 且 `recent` 清空；把窗口设成 23–8 → 回落 `sleeping`
- 1440px / 375px 控制台 **0 error / 0 warning**，375px 无横向溢出（`scrollWidth === clientWidth`），窄屏隐藏 detail 列、时间表仍能看到「现在」与下一班

截图：`logs/v23-events-desktop.png`、`logs/v23-plan-desktop.png`、`logs/v23-sleeping.png`、`logs/v23-mobile.png`、`logs/v23-mobile-plan.png`。

改动文件：`web/index.html`、`web/office.js`、`hub/hub.mjs`、`scripts/crontab.txt`、`tools/check.mjs`、`README.md`。**线上生效需 `sync_web.sh`，外加单独同步 `office/hub/hub.mjs` 并 `pm2 restart office-hub`**（回落逻辑在后端）。
## v13 自主生活升级：数值层 / 随机事件 / 小镇居民（2026-11-07）

按《自主生活升级方案 v1》完成 P1~P4 全部四阶段：

### P1 内在状态层
- 五词条：饱食 hunger / 心情 mood / 精力 energy / 社交 social / 卫生 hygiene
- **真相源在 hub**：每 60s 衰减（清醒全额、睡眠减半、mood 回归均值 60、地板 15），落盘 state.json，离线衰减按 updatedAt 补算
- `POST /api/stats` 增量入口（agent/前端钩子）+ WS `stats` 广播（hello/state/60s 节奏三路携带）
- 前端状态条右侧 5 个迷你条，<30 闪橙光
- 18 条本地事件挂 need 标签：`pickLocalEvent` 权重 = 基础×需求系数×时段×天气×扰动——数值低的行为被放大（饿了 5 倍想觅食）
- 本地小动作结束回报增量（STAT_FILLS 表，经 nginx /office-hub-api/ 反代）

### P2 随机事件
- `hub/random_events.json` 12 条事件（快递/猫来了/停电/灵感/线上 bug/市集日…），带时段/天气/数值条件
- hub 每 2~6 小时加权掷 1 条，`{type:"event"}` 广播；`POST /api/random-event` 手动/agent 触发
- 前端 `EVENT_SCRIPTS` 编排：走到 zone → 播动作 → 气泡文案 → 数值增量；正事中被触发不丢弃（pendingEvent 排队，空档优先演）

### P3 小镇与居民
- 世界 56→72 格：新增小镇街道（石板路/三栋屋/井/街灯×2/长椅/花丛灌木/入口招牌）
- 3 个 NPC（whale 表换色）：**喵酱·橘猫**（全天出没）、**村长·水豚**（20-8 在家）、**博士·章鱼**（21-13 在家）
- NPC 前端状态机：在家→出门溜达→街面挪窝→回家（真实时间驱动）
- 鱼走近 1.5 格自动搭话：双方气泡（NPC_DIALOGS 按早/昼/夜分档 25 条）+ social+10（25s 冷却）
- 房间切换按钮增至 5 个（办公室/卧室/卫浴/花园/小镇）

### P4 记忆联动
- agent 每日日记流程随机抽一条小镇见闻（TOWN_TIDBITS 8 条）写进日记——居民进入 AI 的记忆

### 门禁
- check.mjs 新增第 19 项：stats 五词条 / /api/stats 端点 / 前端 onStats/渲染函数 / nginx 反代 / EVENT_NEED 键引用 全量防回退，19/19 通过
- crop_sprites.py 加 whale 跳过保护（crop 不得覆盖 gen_whale.py 产物）

## v14 物品信息卡 + 内容画面（2026-11-07）

1. **点击物品显示信息卡**：19 件可点物品（家具/设施/居民住宅/水井）各有名字+描述+动态状态行
   （冰箱显示实时饱食度、工位显示今日完成数、街机显示最高分）；点物品时鱼照常走过去互动，卡片 3.6s 自动消失。
2. **看书内容画面**：idle_read 触发时右上角画中画显示"正在读：《…》"+书摘+阅读进度条（6 本书单，章鱼博士的《潮汐与月亮》等）。
3. **打游戏内容画面**：idle_play 触发时显示伪像素游戏屏（深海弹幕/像素水族箱两选一），实时跳分+波次推进，最高分存 localStorage。
4. 表演结束/新事件开始自动收起面板；面板可手动关闭。

## v15 事件全面体检修复（2026-11-07）

对 28 条本地事件逐条 instant 截图检查，修出 3 类问题：

1. **调试台缺小镇分组**：debug.js roomNames 没有 town → "小镇 · 2 条"事件（井边/街边长椅）不显示。已补。
2. **墙挂物件碰撞泄漏**：map 里 10 件墙饰（信箱/水槽/镜子/窗帘/栅栏/药架/招牌）用了 `w:true`，而引擎约定是 `f.wall`——这些物件被当地面家具产生碰撞和阴影（信箱把门口格堵死、鱼只能站在 2 格外"翻信箱"）。全部改名 `wall:true`。
3. **锚点离家具太远**：window（趴窗台却站在 2 格外）、mail（翻信箱却站在房中央）anchor 收紧到贴墙一格。wardrobe/dining 复核后确认原位置即贴身格（格中心+footH 投影算出来的阻挡区比直觉多一格），未改。

朝向判定：window 等 face=n 事件动画走 `idle_back` 背影帧（snapshot 证实 anim=act_idle_back），视觉圆胖背影被误读为正面，实际正确。
气泡侧移逻辑（face=n 时侧移 88px 防挡互动对象）工作正常。

## v16 气泡对齐修复 + debug 台快捷区扩容（2026-11-07）

1. **气泡对齐（用户报"气泡不对齐角色"）**：`calcBubbleOff` 的位置偏移（侧移 88 / 抬高 -46/-58/-62）原来乘了缩放系数 k——k 是给"画布内文字字号"补偿缩小屏用的，偏移量本就是世界尺寸，乘 k 后在 0.85 缩放屏上侧移被推到 103 世界 px（2 个多身位），气泡看起来悬在别的家具上。改为位置不乘 k、字号/边框/圆角照旧乘 k。同时侧移量 88→46（斜上 45° 贴角色），三角放大。check.mjs 对应规则反转（偏移乘 k 反而报错，防回归）。
   - face=n 打字坐姿 / 窗边站姿 / face=s 正面三场景截图验证全部贴合角色。
2. **debug 台快捷区扩容**：常用按钮 4 条 → 10 条（瘫沙发/接水/吃点心/下厨/翻冰箱/打街机/赖床/看月亮/翻书/看花），"在餐桌吃点点心"不再要翻折叠区。

## v17 事件合理性修复（2026-11-07）

用户截图抓出三处不合常理的行为：

1. **花园长椅坐不上去**：stroll 区域没有 sit 定义（文案却是"在长椅上坐一会儿"）——补 `sit host=benchA`，鱼现在真的坐进长椅（截图验证）。
2. **餐桌不坐凳**：dining 区域补 `sit host=tableA dy=-14 face=n`——鱼坐进餐桌凳面向桌子吃东西。
3. **挥手挥给空气**：门口室内"跟路过的人挥挥手"不合理——改为"到门口看看外面"（idle_think 动作）。
4. **白天看月亮**（用户二次抓包）：window 事件加 textDay/textNight 昼夜文案——白天"趴窗台晒晒太阳"、夜里"趴窗台看看月亮"，按灯光状态切换；抽 `localText()` 统一供 idleStep 与 debug 台 localAct 使用。

## v18 数值链路修复（2026-11-07）

用户反馈"事件好像完全不影响数值"。排查发现**关键 bug**：`walkLocalTo` 构造 `curPlan` 时把 `statFill` 字段弄丢了——每个本地事件表演完后的数值上报从未发出过（fetch 0 次），数值层只剩 60s 衰减在跑。修复后实测：
- 触发"吃点心" → `POST {hunger:12,mood:2}` → hub 饱食度 75→87（肉眼可见）
- 触发"洗脸" → hygiene 75→87；"看花" → mood +5

体验补强：
- 数值条上方浮动数字（+12↑ 绿 / -3↓ 红）+ 条发光 1.2s——变化肉眼可见
- emoji 字体 fallback（Noto Color Emoji 等）
- debug 台 localAct 触发也带 statFill（此前只有生活循环带）

之前 v13 上线时端到端只验证了"手动 POST /api/stats"通，没验证"生活循环→上报"这段——教训：链路中间的丢字段必须用 hook fetch 全链路实测。

## v19 写作打字机 + 随机发布（2026-11-07）

用户反馈"AI 不是吃就是睡不工作、发文章是固定时间"。改造文章生产-发布全链路：

### 打字机写作
- agent 写文章流程：AI 先完整成稿 → 存 PocketBase **草稿**（status=draft，publish_at=20~50 分钟后随机；跨夜顺延次日 9:30-9:50）→ 然后在办公室里**逐行敲出来**：每 2.6~5.8s 推一行 `office("writing", 敲文章《标题》, "[n/N] 行内容")`
- 前端**写作板**面板（右上画中画）：标题 + 逐行累积正文（等宽字体+光标▌）+ 进度 n/N · 敲完自动存稿待发布；观众能实时看到 AI 在写什么
- 写作板喂入挂在 onState 去抖**之前**（每行 detail 不同但 task 相同，去抖不能拦）

### 随机时间发布
- 新增 `agent/publish_dispatch.mjs`：crontab 每分钟扫描 `status=draft && published_at<=now` → 翻 published（博客上线）→ 发 B 站动态 → 办公室广播"发布"事件；幂等（重复跑不会重发）
- 发布管道端到端演练：造到期草稿 → dispatch 转 published + B 站动态真实发出 → 测试内容已清理（B 站动态撤回、文章删除）

### 链路教训
crontab 从"每天 2 次"变为"每分钟轻量检查"——AI 工作流与办公室事件的耦合从"整块脚本"拆为"事件流"。

## v20 NPC 身份区分（2026-11-07）

用户反馈"邻居没有区分度、对话完全没有、饱食 100 还吃点心"：

1. **NPC 身份**：名牌（喵酱/村长/博士，深底浅字永远可见）+ 头饰（喵酱头花、村长红金王冠、博士金色书叠）+ 衣色带（橙/绿/蓝半透明椭圆贴鱼身下半）。尝试过整张精灵色相偏移换肤，用户否决（"皮肤不要染色"）——已回退，whale.png 保持原版。
2. **对话激活**：social<60 时自由时间 45% 概率主动走向最近的出门邻居（原来只能撞上）；到达后面向 NPC、解除冷却立即对话；互动半径 1.5→2.2 格；对话升级为**双向**——鱼一句 + NPC 头顶回应气泡（2.6s 消失）。
3. **需求饱和抑制**：needBoost 加 v>=88 → ×0.05（饱食 100 几乎不会选觅食类）、v>=75 → ×0.3；sofa/bed/recover 挂 energy 需求，精力满时不再"瘫沙发/打盹"。

## v21 NPC 换色精灵皮肤（2026-11-07）

用户拍板"直接改精灵图"区分邻居身份（此前试过 tint 染色、色块衣带、robe 穿搭，均不满意）：

- `tools/gen_npc_skins.py`：从 whale.png 色相重映射生成三份皮肤——**whale_cat**（30° 棕橙，橘猫感）、**whale_chief**（120° 绿）、**whale_doc**（250° 紫）；白脸/白肚/线稿/腮红（低饱和区 s<0.15 或色相带外）保留原样；帧结构/尺寸与 whale 完全一致，动画/朝向/坐姿全套复用。
- 修复了重映射链路的两个 HSV bug：六段 RGB 还原表错位（蓝→黄），后修正 table[4]（250° 蓝紫验证通过）。
- 前端 NPC 用各自 skin 精灵 + 名牌；robe/wizard-hat/amulet 穿搭方案废弃（色块感被否），素材保留在 assets 备用。
- `generated-images/` 的鲸鱼女仆立绘即该形象的原始设计稿，换色 = 换发色/衣色的实现思路与之相符。

## v22 物品信息卡修复（2026-11-07）

用户报"物品无法点击看到信息介绍"。三个叠加问题：

1. **INFO_CARDS 与 hotspots 耦合**：只有 9 件行为物品能弹卡，衣柜/书架/水井/居民住宅等 10 件有卡文案但点击没反应——解耦：点击任何 INFO_CARDS 登记的 host 都弹卡（行为仍由 hotspots 决定）。
2. **4 个键名对不上真实 id**：deskA→desk、libraryA→shelfA、blackboard→blackboardA（map.json 补了 id），并新增 whiteboard/schA/wardA 卡文案——现在 22 件物品全覆盖。
3. 排查过程中的假阳性：跨房间测试脚本的坐标换算漏了 cam scroll 偏移（产品代码用 Phaser p.worldX 是对的）；中途引入的双重换算 fix 已回退。新增 __office.lastPointer 调试探针与 __officeCtl.showCard(hostId) 强制弹卡 API。

## v23 信息卡全量 + 房间设计复审（2026-11-07）

1. **信息卡全量覆盖**：INFO_CARDS 22→36 件（储物柜/文件架/办公椅/小圆桌/床头柜/浴缸/鞋柜/料理台/市集摊位等全部有介绍）；
   点击"只能看"的物品 → 弹卡 + 鱼走到旁边看一眼（不再落回普通走位）。
2. **房间/街景设计复审（高级设计师视角）**，已落地：
   - 卧室：床贴上墙（床头墙构图：帘幕+床头柜+床三件对齐），床尾加木椅对景
   - 卫浴：独立浅青灰瓷砖材质分区（原先全屋同地板）、浴缸贴墙、洗手池+镜+药架集中成洗漱面
   - 街道：三屋进深错落打破呆板均等（喵酱家提前/博士家后退）、屋前小径主次分明（村长家主径 34px）、
     井从主路中央移到路缘、街灯错位、花园与石板街之间加土路肩软过渡
   - 花园：长椅面向橡树对景
3. 设计约束工具化：check.mjs 区域语义/阻挡格检查在改布局时拦下 6 次错误（坐席瞬移/锚点落阻挡/语义家具超距）——布局改动必须过门禁。

## v24 房间比例真实化（2026-11-07）

用户批评"房屋布局完全不像真实房间，卫浴又大又空"。房间按真实住宅比例重划：

| 空间 | 旧 | 新 |
|---|---|---|
| 卧室 | 26-33.5（8.5 格）| 26-33（8 格）紧凑，床贴上墙+双床头柜对称+衣柜+床尾椅+绿植 |
| 卫浴 | 36-44（9 格，比卧室还大）| **35-39（5 格）**：浴缸横置贴墙+马桶+洗漱面（钟/盆/镜/药架一条线）+充电垫+磅秤语义 |
| 花园 | 45-55 | 41-55（吸收卫浴缩小的部分，户外更完整）|
| 街道 | 57-71 | 不变 |

- 三扇窗（办公室主窗/卧室窗/卫浴高窗），redrawWindow 统一重绘（昼夜切换三扇同步）
- 门禁拦截 6 次（坐席瞬移/锚点阻挡/语义超距/帧号越界/重复装饰椅），最终 19/19

## v25 回字形平面布局（2026-11-07）

用户质疑"为啥一定要竖着排房间"——一条 72 格长条上从左到右排 5 个空间确实不是住宅。重构成**2D 平面组合**：

```
┌───────────────────────────┐
│ 卧室(2-9) │卫浴(11-15)│ 走廊  │  rows 1-9   北排
├──────────┬────────────────┤
│ 卧室/卫浴南墙（横墙+门洞）      │  row 15
│ 办公室 (0-24)  │ 花园 │ 小镇   │  rows 16-29 南排+东侧全高
└───────────────────────────┘
```

- 世界 72x15 长条 → **56x30 平面**；办公室整体下移 16 行（原布局/工位带/沙发区/娱乐角全部保留，只是搬到南排）
- 卧室 2-9 列、卫浴 11-15 列在北排并肩，共用走廊；花园 27-37 / 街道 39-55 在东侧全高
- 墙系统支持**双格式**：竖墙 {x,y0,h,gap} + 横墙 {y,x0,x1,gap}；横墙带 48px 立面（遮挡看向隔壁房间的视线，真实内墙感）+ 门洞地板亮条
- 房间切换 tabs 带独立 cy（卧室/卫浴相机停在北排）
- 三扇窗同步迁移（办公室主窗 + 卧室窗 + 卫浴高窗在北排上墙）
- 门禁在迁移中拦下 9 次（zone 越界/坐席瞬移/锚点阻挡），19/19 通过

教训：做"多房间"时先画户型图再放家具——家具坐标迁移是机械的，动线（走廊+门洞）和视线（墙立面）才是布局的灵魂。

## v26 墙体修复 + 厨房填充（2026-11-07）

用户截图抓出回字形布局的三个硬伤：

1. **卧室|卫浴之间没有墙**：竖墙判据 `wl.y === undefined` 对 `{x:10, y:1, h:9}` 这种带 y 字段的竖墙失效（被当横墙）——判据改为 `wl.x0 !== undefined`（横墙才有 x0/x1），碰撞与渲染两处同步修复。
2. **大片空白**：cols 16-25 rows 1-15 是无功能空地——填充为**厨房+餐厅**（冰箱/灶台/料理台/餐桌/橱柜/文件柜从办公室左下迁上来，办公室恢复纯办公），淡暖灰地砖材质分区；办公室窗边改为走廊阳台（花+灌木）。
3. **窗户错乱**：三扇窗挤在顶部一条线——本来就是平面布局的正确画法（俯视视角每房间窗画在各自上墙），配合墙体修复后视觉逻辑成立。

北排现在：卧室(2-9) | 卫浴(11-15) | 厨房餐厅(17-24)，三种地板材质、三面完整墙、各房间窗。门禁 19/19。

## v26b 场景美术评审落地（2026-11-07）

收到外部《场景美术评审报告》（结论：布局层重做、91 件资产冻结复用）。核实报告硬数据全部属实后按 P0→P1 落地：

### P0-1 花园名不副实 → 草地 12 件家具
橡树×3、长椅×2（gardenBench1/2）、花丛×4、井、路灯、栅栏边界；`garden/stroll` 锚点回草地，`stroll` 坐进 gardenBench1，`market` 标签改「小镇市集」。

### P0-2 一房一屏镜头
ROOMS 停靠点改四屏：办公室(13,22.5) / 起居(13,7) / 花园(32,15) / 小镇(47,15)——每个 tab 只装一个房间，不再一屏四色地板腰斩。

### P0-3 三簇 + 主动线
办公室重排为三簇：工作簇（工位/电脑/椅/书架/看板，地毯中心 (10.5,22.5) 半径 5.5×3.2 圈住）、休息簇（沙发×2/茶几/街机/留声机/地灯）、产出簇（设计台/打印机/充电垫/扶手椅/柜/奖杯）；原 y17.1 一排 16 件拆成 y17/y19/y21 三档。

### P0-4 地板降对比
五套双色棋盘全部压差（木 9C7750/98734C、草 6E9453/6B8F50、石板 7C7E8C/79808B、瓷砖/厨砖同步），删除全图 1px 每格格线，家具从"棋盘上的小色点"变主体。

### P1 系列
door 锚点对齐横墙通道 (12.5,17.5)、board 脱困 (4.5,18.5)、LOCAL_EVENTS room 标签跟 ROOMS 对齐（bath→bedroom 起居）。

### P2 系列
computer 1.05、office-chair 1.0——工作簇略高于环境（主体尺度第一步）。

验收：四 tab 各自一房一屏 ✓、花园有树/椅/花 ✓、三簇成型 ✓、19/19 门禁。评审 P2-1（三级明度/光位/暗角）与 P1-3（UI 安全带/loading 时机）列入下一批。

## v27 评审 P2-1/P1-3/观景模式 落地（2026-11-07）

场景美术评审剩余三项全部完成：

### P2-1 三级明度与光位
- 灯池重排到三簇：主工位暖光 #FFE2A8 α0.55（主焦点最亮）、木桌副光、产出簇 #FFEDD0、休息簇暖光
- 窗边冷光 #BFDDF5 移到办公室主窗正下方（夜里月光/白天日光）
- **径向暗角**：canvas 纹理一次生成（中心透明→四角 28% 黑），v1 的嵌套矩形方案会形成方块条纹已废弃
- 夜景瓷砖压暗 #8E9CA6（不再比主体亮）、厨砖同步
- 验收：三层明度清晰（暗走廊→家具带→工位暖光池）

### P1-3 UI 安全带
- loading 提前到 buildRoom 成功后隐藏（弱网/中途异常不再滞留"办公室布置中…"）
- 信息卡就近弹出（贴物品上方 8px，不再飞固定右上角盖工作簇）

### 观景模式（方案 B 精华）
真实事件 → 相机 600ms 缓动到目标 zone（鱼继续走它的路），pan 完成后自动恢复跟随——观众"先看到 AI 要去的房间"，到达无缝回到鱼身。Clamp 防止出界。

### 验收口径对照
- y16-18.5 贴墙件 16→11（剩余为书架/黑板等"本应贴墙"的陈列，并已错落两档）
- 主动线 3 格带内仅剩沙发区主角（sofaA/sofa，动线绕行）
- 暗角+灯池+压色地板 → 三层明度可分，10% 缩略下工位暖光池是最亮焦点

## v28 复评报告 P1/P2 全部落地（2026-11-07）

复评报告（重做→小改）剩余 9 项全部修复：

| 项 | 修复 |
|---|---|
| P1-1 board 仍 blocked | 绿植 (5.0,19.2)→(1.5,19.2)、anchor [4.0,19.0]；zoneAudit 的 blocked 本就进 issues（运行时实测 29 zone 全 blocked=false, issues=[]）|
| P1-2 花园 o:true 无碰撞/阴影 | 树×5/长椅×2/井/路灯共 14 件去 o:true，恢复 bbox 落地阴影与碰撞（花丛保留 o 防卡路）|
| P1-3 花园下半全空 | y16-28 补 8 件（树×2/花×2/长椅/路灯/栅栏×2）|
| P1-4 暗角挂世界坐标 | `setScrollFactor(0)` 锁视口，任何房间都是"中心 0/四角 28%" |
| P1-5 观景 pan 弹回 | pan 完成后 `delayedCall(1800)` 停留 1.8s 再恢复跟随，且无条件兜底（pan 被新事件打断也能恢复）|
| P2-1 格线未删 | 全图 1px 每格格线删除 |
| P2-2 卫浴色差反向 | #8E9CA6/#909FA9（ΔL≈1.5）、厨房 #C7BBA5 |
| P2-3 冷光无实体窗 | 横墙 y14.6 x16 补 curtains 室内帘 |
| P2-4 一房一屏未彻底 | 办公室 cy 22.5→23.5（视口从 15.5 起，不露横墙立面）|
| P2-5 地毯空/尺度 | 书架移进地毯边缘（椭圆内落地家具 3→4 件）、office-desk/desk-wood 1.3 |

实测：zoneAudit 29 zones 全 blocked=false issues=[]；观景 pan +900ms 镜头停在花园、+3.1s 恢复跟随（停留时序正确）。

## v29 墙体专项评审落地（2026-11-07）

第三轮墙体专项评审（结论"重做墙体层"）全部落地：

### P0（同批修，避免堵死去花园的路径）
- **竖墙碰撞判定**：`buildBlockedGrid` 判据 `wl.y===undefined` → `wl.x0!==undefined`（竖墙带 y 被误判为横墙 → 三条竖墙 31 格零碰撞）。运行时实测墙格 49/58 阻挡（差值=门洞格），**门洞 11/11 全部可走**
- **W4 gap 越界**：办公室|花园墙 gap[4,6]（越界）→ [20,22]；同时 x25 墙补全高 y0..30

### P1 门洞空缺表达（#3#4#5）
- 删 gap 亮条填充 → 门洞露原地板，两侧地板连续
- 横墙立面**分段绘制**（gap 列完全不画，不再被墙帽封死）
- 北墙大门删门扇 → 墙带在门口断开 + 2px 门框（上亮 #8492AC/下暗 #3B4459）+ 4px 门槛线 #D9C49A
- 室内墙统一三段式：顶线 4px #8492AC / 墙身 #3B4459（vs 木地板 ΔL*23.9）/ 脚线 4px #22283A

### P1 补墙闭合（#6）
W1 卧室|卫浴 h9→14（补 y10-14）、W2 横墙 x1..25（补 x16-25）、W4 全高——室内 4 房+花园各自闭合。

### P1 tab 停靠统一（#8#9）
4 tab 全部 `cam.pan` 固定停靠（办公室不再 startFollow 把用户带到花园）；办公室 zoom 1.15（配合 cy 彻底不露横墙）、花园/小镇 zoom 1.25；新增 **🐟跟随** 按钮。

### P2 密度/窗帘/暗角（#10#11#12#13）
- 厨房 5→11 件（上墙柜/备餐柜/水槽/果盘/菜谱/绿植）、卫浴 7→11 件（浴缸边柜+漱口杯/叠毛巾/绿植）
- 窗帘移到 D2 门洞左侧
- 暗角 setPosition(624,384) setDisplaySize(1248,768)（评审 #12）

验收：墙格 49/58 阻挡、门洞 11/11 开、zoneAudit 29 全绿 issues=0、四 tab 截图核对。

## v30 灯光与窗帘修正（2026-11-07）

用户反馈三处：

1. **主工位暖光刺眼**：α0.55 → 0.30、半径 3.0 → 2.6，其余三池同步降（0.34/0.38/0.36 → 0.24/0.28/0.26）——不再一枝独秀，四池协调。
2. **D2 门洞上的窗帘删除**：门洞本身就是"空缺"表达，门上挂帘既误导又遮挡。
3. **卧室帘幕贴墙**：y 2.2 → 1.4（curtains 素材自带"窗帘+窗框"组合，底边贴上墙后床与帘之间露出墙面——"挂在床上"消失）。

### v30 补充（同日）
- office.js 在应用灯光修改时发生 0 字节损坏（python 编辑异常截断），从服务器 19:23 版本恢复后重放灯光 α 修改（四池 0.55/0.34/0.38/0.36 → 0.30/0.24/0.28/0.26）。
- 办公室 tab pan 目标 cy 23.5 被 zoom 后 bounds 钳制拉回北排（cam=[0,237]）——改为 **pan 底边对齐**（panY=H*zoom-384），办公室视图必显示办公室南排全部。
- 教训：长文件 python 字符串替换必须在 assert 后立即 write，且每次编辑后立刻 node --check + git/备份。

## v31 灯光表达重构（2026-11-07）

用户反馈"强光太不自然"。根因：ADD 混合的径向渐变光晕贴图在像素风里是"照片打光"，怎么调 α 都是泛白椭圆色块。

**最终方案：去掉全部光晕层，灯光改由"明暗对比"表达**（像素游戏经典做法）：
- 地毯圈住工作簇 = 亮区（地板色阶本身比四周亮）
- 径向暗角压暗四周 = 灯光集中感（中心亮边缘暗）
- 吊灯 fixture 提示光源位置，夜里灯泡熄灭
- 窗边冷阶删除（走廊上的大灰椭圆同样突兀）
- 中间尝试的"离散两档亮阶椭圆"也废弃（与地毯/地板边界交叠处生硬，且窗光压在走廊上像大灰斑）

setLights 里 lightPools/moonPool 改为 no-op 对象保持兼容。验收：白天干净明亮无色块，夜晚压暗+暗角+灯灭三重氛围成立。

## v32 地毯单色化（2026-11-07）

用户指出"一圈一圈的光晕"仍来自地毯本身的两层椭圆+两条描边环。改为：
- 地毯=**单一纯色椭圆**（#B08A5E，无内外圈、无描边）
- 办公室地板整体提亮一档（#A8815A/#A47D57）——地毯与地板只差"亮一档"的平缓明度差，色相相同
- 灯光的"亮区"表达=地毯亮度+暗角对比，画面里不再出现任何环形

### v30 补充 2（同日晚）—— "绿框"真凶
用户截图与无头截图出现"绿色方框+阶梯对角线"。逐层排查（隐藏 props/各 depth graphics/暗角/环境遮罩/白 tint 全部无效）后用 **textures.get('lightpool').getSourceImage() 读纹理像素**定位：lightpool 纹理 = **32×32 纯绿（Phaser __MISSING 贴图）**——`makeLightTexture(s)` 调用在 v31 重构 buildLights 时被误删，`textures.get('lightpool')` 找不到 key 返回 MISSING 绿色贴图冒充光池。补回调用后纹理恢复正常 (255,243,214)、绿框消失（办公室内 0 绿像素），暖光池柔和生效。

## v31b 分房间灯光系统（2026-11-07 深夜）

用户反馈四项全部落地：

1. **每房间一个灯开关**（办公室/卧室/卫浴/厨房 4 个开关贴各自上墙），点击只切换本房间亮度——`applyRoomLights()` 按房间 tween 暗色遮罩与灯池
2. **窗外昼夜按真实时间**（北京时间 18-6 点为夜），与灯开关解耦；开灯房间的玻璃有反光提亮+窗棂十字（不再"黑洞"）
3. **AI 自主开关灯**：清醒态开办公室灯（厨房按做饭时段开）、卫浴/卧室关；睡觉态只开卧室灯（18-23 点），深夜全关；washing 临时开卫浴
4. 分房间暗色遮罩（office/bedroom/bath/kitchen 四块矩形，depth 59000），开关切换 600ms 渐变
5. 修复：旧单开关残留引用（swLever）导致的 ReferenceError

实测：办公室亮+北排暗（同屏对比）、夜窗有月+窗棂、门禁 19/19、git 自动快照 2 个。

### v31c 亮度调整（用户反馈：开灯后环境太暗）
- 夜间基础环境暗度 0.42 → 0.38（白天 0.12 → 0.10）
- 开灯房间 ADD 暖提亮片 alpha 0.20 → 0.34、色 #FFE4B8——开灯房间与关灯房间对比更明显，开灯侧明亮可辨
- 修复一个隐藏 bug：ambientTarget 无人更新（旧 setLights 重构时删掉了赋值），导致全局遮罩恒定 60% 黑——现在按真实时间昼夜动态设置

### v32b "暗色滤镜"根因修复（用户截图反馈）
全屏 ambient 遮罩的 **alpha 语义反了**：`updateAmbient` 里写的是 `setAlpha(1 - ambientCur)`，而 ambientTarget 被设为 0（取消滤镜）后 cur→0 → alpha→**1.0 全屏黑**——"取消滤镜"反而变成"永久蒙黑"。
修正：alpha = ambientCur（cur 即不透明度，target 恒 0 = 无滤镜）。开灯房间原色、关灯房间由 roomOverlays 黑遮罩压暗、暗角只管四角——"蒙一层"感消失。

## v33 路网对齐 + 户外天黑 + 路灯（2026-11-07）

用户指出"路没连到门口，AI 家的路对着墙"+ 户外天黑 + 路灯：

1. **大门对齐**：map.door tx 2→12——办公室主入口与横墙 gap[12,13] 同一开口（之前大门画在实心墙上，鱼根本进不来）
2. **路网连通**：花园竖支路（cols 20.2-21.8, rows 10-22）连 x25 墙门洞 gap[20,22]；花园横径 y8.8 与街道主路同带——办公室→走廊→花园→街道全程有路
3. **户外天黑**：roomOverlays 加 `outdoor` 遮罩（花园+街道 cols 26.5-55.5），夜里 0.45 压暗、白天 0——按真实时间 isNightHour() 联动
4. **路灯**：5 盏 street-lamp，夜里每盏下方两档暖色椭圆光圈（depth 59500 在夜间遮罩之上），白天自动消失；昼夜切换随 applyRoomLights 重建

### v33 补充（同日）—— 路网真连通
- 用户红圈指出花园左下 x25 门洞处没有路。排查：①花园竖支路画在 buildRoom graphics（depth -100）被夜间户外遮罩（59000）压暗不可见 → 移到独立层 59500（与路灯光圈同层，昼夜重建）；②发现 map.json 被外部会话并发写入 6 条外来墙（街道南半 rows 19-29 的 3 横 3 竖），已清理；③外来新增的"喵酱窝"（catBed/catGramo/catStand + living_cat zone）保留并修复其 frame 越界与锚点距离。
- 门洞-路连通验证（相机对准 x25 门洞特写）：办公室地板→竖支路→门洞断开→花园草地，全程连续。
- 并发写入提示：map.json 正在被其他会话同时编辑，后续改动前需 git diff 核对。

### v33 补充 3（同日）—— "路跑进室内"修复
用户截图指出办公室内出现两条浅色竖带。根因：花园竖支路画在了 **cols 20.2-21.8（办公室内部列）**，而 x25 门洞 gap[20,22] 的 "20-22" 是**行号**——把"行列语义"搞混了。
修正为正确路网：
- 门洞连接段（横）：cols 24.6-28, rows 20-22（横穿墙洞）
- 花园竖径（纵）：cols 30.4-32.2, rows 9.4-21.4（连花园横径）
- 办公室室内**无任何路绘**（室内地板即路）
特写验证：墙洞断开处地板连续，办公室→连接段→花园竖径→花园横径全程连通。

## v34 路网重设计（2026-11-07 深夜）

用户连续指出"路完全有问题"。停止打补丁，用**真实坐标渲染俯视结构图**（render_map.py）整体核查，发现结构性缺陷：

- 卧室/卫浴/厨房三房间**全部被墙围死没有门**（W1/W3 只到 y14，横墙 y15 只有一个门洞在浴室外）——走廊是死走廊，三房间不可达
- 花园竖支路画错行列（跑进办公室室内）

**重设计路网**：
- 横墙 y15 拆成 4 段，留 3 个门洞：卧室门 gap[4,6]、办公室门 gap[12,13]（原有）、厨房门 gap[19,21]
- 保留 W1 卧室↔卫浴门、W2 卫浴↔厨房门
- 路径：走廊横带（cols 1-25, rows 15.2-16.7）贯通 + 三条竖门径（卧室门 4.9 / 办公室门 12.9 / 厨房门 20.2 向上）+ 花园路网（横径/竖径/D6 门洞连接段）
- 办公室室内无路绘（地板即路）

最终格局：**每个房间至少一门、走廊贯通三扇门、办公室双出口（北门+东门直通花园）、花园路网接街道主路**。
俯视结构图与游戏实拍双重验证，门禁 19/19。

## v37 鱼塘碰撞 + 编辑地图界面（2026-11-08）

用户需求："池塘没有加碰撞；新增编辑地图界面，可以自定义编辑地图，添加物品，删除物品，移动物品。"

### 鱼塘碰撞（map.json blockers + buildBlockedGrid）
- map.json 新增 `blockers: [{t:"pond", x0:35.2, y0:22.2, x1:38.2, y1:26.2}]`；碰撞格按**椭圆方程**逐格判定，水面格进 A* 阻挡，岸边保持可走（钓鱼 zone 在塘西 [34,24]）
- check.mjs 的 buildGrid 复刻同一公式（静态自检与运行时碰撞不漂移）；第 20 项门禁校验 blockers↔POND 常量一致 + pond 锚点不被水格堵死

### 编辑地图界面（hub /api/map + office.js 编辑层）
- **存储**：`hub/map.custom.json`（与只读的 web/map.json 分离），hub 校验资产名/坐标范围/id 去重/400 条上限，重启自动恢复，保存时 WS 广播 `{type:"map"}` 全员热更新
- **前端叠加**：`applyCustomFurniture` 把自定义条目合入 mapdata（`_custom` 标记），`rebuildCustomLayer` 整层重建家具 + 重算碰撞；hello 带 `customMap` 字段刷新即恢复
- **编辑模式**（`__officeCtl.setEditMode(true)`，debug 台「✏ 编辑地图」进入）：
  - ➕ 放置：选资产（74 件白名单）→ 点画布即放，半透明 ghost 跟手
  - ✥ 移动：点物品拖到新格松手
  - 🗑 删除：点物品移除；面板带条目列表逐条删 + 清空按钮
  - 💾 保存到服务器：本地直连 hub:4321，线上走 Nginx `/office-hub-api/` 反代（hubMapBase 双形态）
  - 编辑中鱼停走、碰撞格常显辅助对齐
- **修一个重建崩溃**：rebuildCustomLayer 保留鱼重跑 buildBlockedGrid 时，鱼对象没有 bbox 直接 throw（线上验证时抓到 3 个 pageerror）——props 循环加 `isFish` 跳过；线上回归：连续 3 次增删重建零报错、鱼塘碰撞不丢、鱼存活

### 验证
- check.mjs 20/20；本地 + 线上（news.shixiansi.pw）无头走查：鱼塘 blockedCount=11、绕水路径 pathOk、编辑增删移经反代落 hub、刷新恢复、清理归零，PAGE_ERRORS: none

## v37.1 地图编辑器：本地兜底 + 修家具重影（2026-11-08）

用户反馈："地图编辑器用不了。" 无头 Chrome 实跑定位到四个问题（编辑器逻辑本身没坏，是**失败路径全都不吭声**）：

### 1. hub 不通时整个编辑器静默失效（本地最常见）
- `hubMapBase()` 恒返回非空串（本地 `http://127.0.0.1:4321`、线上 `/office-hub-api`），所以"hub 不在线就只改本地镜像"那段兜底 `if (!base)` **是死代码**。没起 hub 时点一下就只剩 `Failed to fetch`，画面毫无变化 —— 看起来就是"点了没反应"
- 现在改动**先本地生效**（立刻可见）→ 再推 hub；推失败就落 `localStorage.office_map_custom_v1`（带 `pending` 标记），下次页面加载/重连自动补传（`probeMapHub` → `flushLocalMirror`，只试一次防抖）
- 前端生成 item id 再发给 hub（hub 有 id 就不重发），保证本地与 hub 的 id 一致，后续 move/remove 不会错位

### 2. 保存成功却不回显
- 旧版只 POST，等 WS 广播回来才更新 `customFurniture`；WS 没连到同一个 hub（离线、或调试台里改过 WS 地址→存进 localStorage）时日志写着"已保存"而画面/列表都不动
- 现在本地状态自己维护，`inflightMapOps` 计数挡掉推送期间的广播回显，避免自己盖掉刚做的改动

### 3. 重建家具层留下一份旧精灵 → 全屋重影
- `rebuildCustomLayer` 旧实现只把 `s.props` 过滤成"只剩鱼"，上一层的精灵/阴影对象仍在 displayList：实测 hub 里只要有 1 件自定义物品，页面加载后 **149 件家具全部画两遍**（148 组重复、sprite 313 个而 props 只有 152），每编辑一次再叠一层
- 现在家具层只有 `buildFurnitureLayer()` 一个创建入口：所有 placement 登记进 `s.placed`（**含阴影**），重建前统一 destroy；`applyCustomFurniture` 幂等（先剔 `_custom` 再压入）；`buildFurniture` 里改为**先合并自定义层再建**（旧代码把 `applyCustomFurniture(s)` 放在两遍创建循环之后，注释说的"再建一遍"并没生效）
- 回归：edits 前后 `dupGroups` 恒为 0，sprite 数 163→165→164 与家具数一致；fish 行走 / 房间切换 / `hostMap` 62 个宿主 / 瘫沙发语义全部正常

### 4. 谎报连通状态 + 入口在局域网看不到
- `editState().hub` 旧值是 `!!hubMapBase()`（恒真），调试台永远显示"保存走 hub /api/map"；现在返回真实探活结果（`hubChecked` / `hubError` / `mirror` / `ws` / `mapUrl`），编辑面板也多一行状态："hub 已连：改动会写进 map.custom.json" 或 "hub 未连接（Failed to fetch）：改动只存本机浏览器"
- `index.html` 的 `isLocal` 放行私网地址（`10./192.168./172.16-31.`）：手机或用局域网 IP 开预览时也能点右下角 🛠（原来只有 127.0.0.1/localhost，入口直接被隐藏）；线上公网域名行为不变
- `editPointerDown` / `editPointerUp` 的气泡文案改诚实："已放在本机（hub 未同步：…）"，不再和画面对不上说"放置失败"
- `makePlacement` 遇到不在 manifest 的资产名改为跳过 + `console.warn`，不再一层家具全炸

### 验证（本地 Windows，无头 Chrome 经 CDP 真实点击）
- hub 关：进编辑台 → 面板显示"hub 未连接" → 放一件 → 立刻出现、`mirror:true`、日志"改动存在本机浏览器" → 刷新仍在（localStorage）→ hub 起来后重新加载：自动 set 补传，`mirror:false`
- hub 开：add / move / delete 各一次，hub 日志一操作一条（无重复 set）、`map.custom.json` 同步、`dupGroups` 恒 0、`frameAudit`/`zoneAudit` 0 问题、鱼照常走位
- check.mjs 20/20（`bust.mjs` 已刷新 `?v=`）

## v37.2 地图编辑：选中反馈 + 命中判定（2026-11-08）

用户反馈："地图编辑选择不了物件。" 实测三个原因，全是"点了没有任何反馈"：

### 1. 按钮有 `.active` 类，却没有对应 CSS
- `setEditAsset` / `setEditTool` 一直在加 `.active`，但面板按钮全是 inline 背景色、样式表里没有任何 `.active` 规则：点完资产/工具，`className` 变成 `ep-btn active`，而背景、边框、文字颜色**一点没变** —— 看起来就是"选不中"
- 现在面板内嵌 `#edit-panel button.ep-btn.active` 样式（蓝底白字 + hover），资产按钮和四个工具按钮都挂 `ep-btn`
- 面板新增一行状态提示 `#edit-sel`：「工具 ➕ 放置 · 资产 desk-wood → 点地图放置」/「工具 ✥ 移动 · 点住自定义物品拖到新位置」/「工具 🖱 选择 · 已选中 wardrobe @ 16.1,22.6」

### 2. 只有"脚点 36px 内"才算命中
- `pickEditItem` 旧判定是 `max(|dx|,|dy|) < TILE*0.75`，而 `p.y` 是物品**落脚点**：衣柜/床这类高家具点身子（离脚点 30~50px）必然选不中
- 改成先按**内容 bbox 命中**（点在家具身上就算中，取 depth 最大的那件），没中再退到"脚点 0.85 格"；移动/删除/选择三个工具共用同一判定

### 3. `select` 工具压根没有"选中"这回事
- 旧版 select 分支直接 `return false` 走默认点击语义：点自定义物品既不选中也没提示（点静态家具更是完全静默）
- 现在：点中自定义物品 → 画布画蓝色虚线框（顶边加重的黄色线）+ 面板显示名称/坐标 + 列表对应行高亮；拖动时框跟着走
- 点中 **map.json 的静态家具** → 气泡明确告知"这是 map.json 里的静态家具，编辑器只能改「自定义层」的物品（➕ 放置的那些才能删/移）"（README 早就写了这个意图，代码里一直没实现）
- 点空地才退回"让它走过去"的默认语义

### 验证
- 资产/工具按钮：点击后 `background` 由 `rgb(42,46,61)` → `rgb(74,108,247)`、文字变白（真比对了 computed style）
- 放衣柜 → move 工具点身体（脚点上方 24px）→ 抓起并成功从 x=648 移到 768，气泡"已移动"
- delete 工具点身体 → 删除，`count` 归零
- select 工具点身体 → 出现高亮框（Graphics depth=97000）+ 面板「已选中 wardrobe @ 16.1,22.6」+ 列表行高亮
- 点静态 mailbox/sofa → 气泡提示"这是 map.json 里的静态家具…"，不再静默
- check.mjs 20/20

## v37.3 物件列表/资产选择带图标（2026-11-08）

用户反馈："物件列表显示物品的图标。"（列表只有资产名，认不出是哪件）

### 图标怎么来的
- 不新增任何图片文件、也不额外发请求：`assetIconUrl(key, frame)` 直接把**已加载的 Phaser 贴图**按 manifest 的 `bbox` 裁出内容区，画到 canvas 再 `toDataURL()`（`scene.textures.get(key)` → frame 的 `cutX/cutY` + bbox 偏移）
- 小物件（硬币 15×15、护身符 8×8）按**整数倍放大**（`k = max(1, floor(22/max(w,h)))`）再出图，避免在 22px 盒子里缩成一个点；`imageSmoothingEnabled=false` + CSS `image-rendering:pixelated` 保持像素风清晰
- 结果按 `资产名#帧号` 缓存（`iconUrlCache`），`renderEditList()` 每次重渲染不再重复裁图；贴图/清单缺失时回退成 `▢` 占位，不报错

### 界面变化
- **物件列表**（已添加的每一条）：`[图标] 名字 ………… x,y ✕`，图标 22×22 圆角底衬；选中行仍是蓝底高亮
- **资产选择网格**：每个按钮改成 `[18px 图标] 名字`，列数 4 → 3（给图标和文字留宽度），网格高度 170px，面板整体不再撑爆
- 面板 CSS 全部走 `#edit-panel ...` 前缀的样式表，不再散落 inline 样式

### 验证
- 70/70 个资产按钮都有图标（`img.ep-asset-ico`）；列表 4 条记录 4 个图标，`naturalWidth×Height` 分别 96×101（oak-tree）/ 20×31（wardrobe）/ 15×15×2（coin，整数放大）/ 12×22（desk-lamp）
- 选中/删除/清空后图标与行高亮都正确重渲染；`hub after clear: furniture []`
- check.mjs 20/20

## v37.4 物件列表覆盖全部家具 + 静态家具可隐藏（2026-11-08）

用户反馈："比如这里我想点绿色的这个物品删掉，完全就点不到，实在不行地图编辑都独立出来。"（附截图：草丛挡在房间里）
逐条查下来是三个叠加的问题，不是"点得不准"这么简单：

### 1. 那丛灌木是 map.json 的**静态家具**，编辑器压根不认
- 旧逻辑 `pickEditItem()` 只遍历 `customPlaceholders`（用户自己放的），静态家具彻底不参与命中；`delete` 工具点上去 `return true` 走人 —— 连"不行"都不会说
- 现在：`hitStaticItem()` 也参与判定，三个工具都能点中静态家具
- **静态家具现在也能删**：不再要求改 hub 的 schema，而是在自定义层追加一条 `{ a:"hide", k:"bush@24,10.6" }`。hub 的 `validateMapItem` 认 `a="hide"`（合法小写资产名）、坐标 0,0 合法、id 由 key 哈希生成 → 现有接口零改动；老客户端遇到未知资产会被 `makePlacement` 安全跳过
- 面板底部出现「已隐藏 N 件静态物件 · 全部恢复」，`editState()` 也多了 `hidden` 字段
- 修一个由此引出的坑：`applyCustomFurniture()` 原来直接在 `mapdata.furniture` 上 filter，隐藏掉的静态条目会**永久消失**（"全部恢复"救不回来）——现在先把原始静态层备份到 `s.staticFurniture`，每次重建都从备份派生

### 2. 物件列表从"只有自定义"变成"视口内全部物件"
- 每行：`[图标] 资产名 [静态|自建] 坐标 ✕`，按离镜头中心远近排序，最多 60 行，标题显示「物件列表（视口内 N 件）」
- **点行即选中**（画布高亮框 + 镜头 `cam.pan` 对准），悬停也会高亮——完全不用点准画布
- 行内 ✕：自建 → 删除；静态 → 隐藏（可恢复）
- 镜头挪动超过 24px 自动刷新列表（400ms 节流），另有 ↻ 手动刷新按钮

### 3. 镜头在编辑时被鱼拽走 → 点空
- `onState()` 收到真实事件时会 `stopFollow + pan + 1.8s 后 startFollow`，编辑过程中视图会自己甩到鱼那边，刚对准就点空
- 现在编辑模式下：进入即 `stopFollow()`，`onState` 的相机段直接跳过（`if (editMode) cam.stopFollow()`），退出编辑再交还跟随

### 4. 反馈改成"点哪儿说哪儿"
- 新增 `editToast()`：贴在点击位置的 DOM 小提示（1.5s 淡出）+ 同时写进面板日志。原来用的是鱼头顶的气泡，编辑时鱼常在别的房间，等于没提示
- 点空、点静态、拖动静态、删除/隐藏成功，都有明确一句话

### 验证（无头 Chrome，真实鼠标点击）
- 编辑模式 `cam._follow === false`；发一条真实事件后 `scroll` 前后一致（`same: true`），视图不再被抢
- 列表 51 行（含 `bush 静态 24,10.6`、`book-stack 静态 24.2,6.6` 等），图标齐全、标签正确
- 点 `bush` 行的 ✕ → 画布上 `bush@24,10.6` 消失、`hidden: 1`、hub 收到 `{a:"hide",k:"bush@24,10.6",id:"hide18cgveh"}`；点「全部恢复」→ 草丛回来、hub 归空
- 画布上用 🗑 直接点草丛 → 同样隐藏，并弹出"已隐藏 bush（面板底部可一键恢复）"
- 放一件 armchair → 列表出现 `armchair [自建] ✕` → 点 ✕ 删除成功
- check.mjs 20/20

> 关于"地图编辑独立出来"：暂时不用了 —— 现在不依赖像素级命中（列表可选可删），镜头也不会自己跑；真要做独立页/更大的编辑画布，可以后续在这个面板基础上加"全屏编辑"开关。

## v38 独立地图编辑器：三图层（2026-11-08）

用户需求："地图编辑器直接独立开来，同时现在显示静态物品无法移动，也没有道路和墙以及地板的摆放与删除，地图分层编辑，地板层放地板和路，物品层显示物品，还有地形层摆放墙以及湖泊水流以及农田。"

### 1. 独立页面 `web/editor.html`
- 全屏画布 + 右侧 344px 侧栏（`web/editor.js`）。游戏本体的状态条/动态窗/调试入口用一个 `#game-chrome` 空壳藏起来（id 都留着，office.js 判空不炸）
- 画布保持 1248:768 比例（`max-width/height:100%` + flex 居中），不再被拉伸
- 打开即 `setEditMode(true)`；office.js 用**路径**也认编辑器模式（`/(^|\/)editor\.html$/`），不只是 `?editor=1`——否则直接开 `/editor.html` 会走游戏语义、点了没反应
- 鱼在编辑器里不溜达（`startIdleLife` 直接 return），镜头锁定，状态事件不再抢视角
- 踩过的坑：`#loading` 的 `.hide` 样式原来只写在 index.html，editor.html 缺它 → 那层「地图载入中…」一直盖着画布，**所有点击都被吃掉**（表现就是"点了没反应"）

### 2. 三图层数据模型（全部走 hub 现有 add/set，hub 零改动）
- 一次 `map.custom.json` 里混装五种条目，按 `a` 分派：
 | 条目 | 含义 |
 |---|---|
 | `{a:"<资产名>", x, y, id}` | 物品层：新增家具 |
 | `{a:"hide", k}` | 物品层：隐藏静态家具 |
 | `{a:"move", k, x, y}` | 物品层：**移动静态家具**（map.json 保持只读，靠覆盖） |
 | `{a:"floor", t, x, y}` | 地板层：`t = wood｜tile｜stone｜grass｜road` |
 | `{a:"terrain", t, x, y}` | 地形层：`t = wall｜water｜farm` |
- hub 的 `validateMapItem` 认 `a` 为小写资产名、坐标 0..56/0..30、id 唯一 → 现有接口直接用；老客户端遇到这些"未知资产"会被 `makePlacement` 安全跳过
- 静态家具移动：`applyCustomFurniture()` 里按 `_key` 把 move 覆盖贴回静态层副本（`_moved` 标记），列表里显示成"已挪"

### 3. 渲染与碰撞
- 新增两个叠加 Graphics：地板层 depth `-99`（在 baseGfx `-100` 之上、家具之下）、地形层 depth `-95`
- 地形 `wall/water` 进 `buildBlockedGrid()` 变阻挡；`farm` 可走（和农场一致）
- **地板贴片会把该格改成可走** → 这就是"删墙/删水"的方式：在墙上铺地板即可（家具压着的格、以及第 0 行贴墙根除外，避免把家具顶掉/穿出屋外）
- 刷一片地不需要每格都发请求：`meQueueSave()` 本地立刻重画叠加层+重算碰撞，260ms 合并成一次全量 `set` 打给 hub

### 4. 侧栏交互（editor.js）
- 图层 tab：`地板层 / 物品层 / 地形层`（快捷键 1/2/3）
- 工具：地板/地形层 = 🖌 画笔、🧽 擦除；物品层 = ➕ 放置、✥ 移动、🗑 删除（删除静态家具=隐藏，可一键恢复）
- 调色板：地板 5 种材质色块、地形 3 种、物品 70 件带图标网格
- 物件列表（视口内，按镜头距离排序）：`[图标] 名字 [静态|自建|已挪] 坐标 ✕`，点行=选中+镜头对准，✕=删除/隐藏；底部显示各类条目计数
- 底部：💾 保存、清空自定义层、±缩放、✋ 拖动视角（复用游戏的 `camDrag`，`mapEditorPointerDown` 在拖动模式下不落笔）、← 回游戏
- `on` 叠加物（桌上的电脑、书架上的书）在 map.json 里没有 x/y，列表坐标改用 placement 反推，不再出现 `undefined,undefined`；它们的 key 改成 `资产@on:宿主:dx,dy`

### 5. 验证（无头 Chrome，真实鼠标点击 /editor.html）
- 画布比例 1240×763 = 1.625（=1248/768）✓
- 地板层点一格 → `entries().floor` 出现 `{x:13,y:7,t:"wood"}`，hub 收到 `floor:wood:13,7` ✓
- 地形：空格画墙 → `grid=1`；擦掉 → `0`；农田 → `0`（可走）；水面 → `1`；水面再铺石板地板 → `0`（放行规则）✓
- 物品层：`moveStatic('bush@46.2,12.4', 21, 12)` → hub 出现 `{a:"move",k,x:21,y:12}`，场景里 bush 变成 `moved:true` ✓
- 擦除：地形/地板条目都能逐格删掉，hub 同步为空 ✓
- 游戏页回归：`editorMode=false`、`dupGroups=0`、props 150、鱼照常走位、无 pageerror ✓
- check.mjs **21/21**（新增第 21 项：独立编辑器三图层防回退）

## v38.1 编辑器可用性修复：去灰蒙版 / 碰撞格开关 / 窗与鱼塘可选 / 镜头不再弹回（2026-11-08）

用户反馈四条，逐条对应：

### 1. "把画面中的灰色蒙版去掉"
- 灰蒙版不是编辑器画的，是**夜间房间遮罩**：`applyRoomLights()` 在关灯时给每个房间盖 0.55~0.60 黑遮罩、户外 0.45，再加一层 vignette 暗角（depth 60000）
- 编辑模式下 `applyRoomLights` 一律按"开灯"算（`lit = true`），并且**不创建暗角那层**；实测 `roomOverlays` 四个房间 alpha 全 0、`vignetteTex` 对象数 0
- 游戏页不受影响：`emit('sleeping')` 后房间遮罩仍然回到 0.60（回归验证过）

### 2. "碰撞显示添加一个开关"
- 侧栏底部新增 **▦ 碰撞格** 按钮（`__mapEditor.grid(on)`），独立编辑器**默认关闭**（进编辑器先看干净地图）
- `rebuildCustomLayer()` / `meRefreshTiles()` 原来会无条件 `toggleGrid(true)`，现在按"当前是否开着"还原，不会再被悄悄打开
- 游戏内调试台的编辑模式仍然默认打开碰撞格（行为不变）

### 3. "墙上的窗户没法选择"
- 窗户画在 `buildRoom` 的 base graphics 上（压根不是家具），所以既点不中也进不了物件列表
- 新增"底图结构"概念：`STRUCTS = win:office / win:bedroom / win:bath / pond:main`，写一条 `{a:"hide", k:"win:office"}` 就能隐藏；`buildRoom()` 与 `redrawWindow()`、池塘层都会认这个 key
- 侧栏新增「底图结构（窗 / 鱼塘）」一栏：每行 `名称 + 显示中·隐藏 / 已隐藏·恢复`，改完自动 `rebuildRoomBase()` 重画底图

### 4. "鱼塘是一体的选择不了"
- 鱼塘由 `drawPond` 画在 depth=1 的 graphics 上 + `mapdata.blockers` 椭圆阻挡，所以点不到也删不掉
- 拆成 `buildPondGfx()`：可整层隐藏（连带取消水面阻挡，blocked 320→309）；显示时重建
- 想局部改形状：地板/地形叠加层 depth 提到 **6/7**（在池塘 1、农田 2/3、水影 3 之上、家具 footY≥72 之下）→ 直接在水面上铺地板/水面/农田就能覆盖，铺地板还会把该格改成可走

### 5. "去除拖动视角又自动把视角弹回办公室"
- 根因：`#cam-drag-btn` 的关闭分支无条件 `cam.startFollow(fish)` + `setZoom(1)`
- 现在编辑模式（编辑中或独立编辑器）关掉拖动只 `stopFollow()`，镜头留在原地、缩放不动；非编辑状态行为不变
- 实测：平移到 x=300 → 开关拖动视角一次 → 仍是 x=300 且 `follow:false`

### 验证
- 编辑器：`roomOverlays` 全 0、无 vignette、`grid` 默认 false 且可开可关、窗/鱼塘 隐藏→hub 落 `hide:win:office` 与 `hide:pond:main`、恢复后 blocked 回到 320
- 游戏页回归：pond/winRedraw 都在、props 150 / blocked 320、鱼照常走位、睡觉时房间遮罩仍是 0.60、无 pageerror
- check.mjs 21/21；`?v=` 已刷新（office.js / editor.html）

## v39 源码拆分 web/src + 地图全面贴图化 + 去掉路灯光源（2026-11-08）

用户反馈："现在全部功能全塞进一个 office 文件太奇怪了，优化拆分，同时地图上所有使用代码画的东西全部去掉，用现有的素材，包括墙体、水、地面，同时去除路灯的光源定位。"

> 追加反馈（同日晚）："office.js 还是 255kb，你优化了啥，src 那些名字是什么玩意怎么还带数字的" → 见下面 v39.1。

### 1. office.js 拆成 19 个片段（web/src/）+ 拼接产物
- 片段按**功能命名**（不带序号，顺序由 `build.mjs` 的 `ORDER` 数组显式写死）：
 `head`（IIFE 开头 + 常量/工具）→ `boot`（Boot 预载 + 主场景 create）→ `npc` → `view`（房间 tab / 拖动视角）→ `placement`（bbox 定位 + 灯光）→ `furniture`（家具层 + 碰撞格）→ `mapedit`（自定义层 + 游戏内面板）→ `editor-api`（三图层编辑）→ `pathfind`（A* + 鱼）→ `room`（底图贴图）→ `farm`（农场/鱼塘/料理）→ `hud` → `states`（事件/行走/动作）→ `life`（本地生活）→ `loop`（主循环 + 点击）→ `net`（WS + 状态条）→ `activity`（动态窗）→ `start`（Phaser 启动）→ `api`（`window.__office*` + IIFE 收尾）
- `office/tools/split_office.mjs` 按段落标题机械切片（**一个字符都没改**）；切片方案跑过**字节级比对**：拼回去与原文件完全一致，拆分零行为风险
- 为什么不改 ES module：office.js 是一个 ~5000 行的 IIFE，上百个闭包变量互相引用；改成 ES 导出绑定属于等价重写，风险远大于收益。片段 + 拼接既解决"全塞一个文件"，产物行为又不漂
- `check.mjs` 第 22 项：`office.js` 必须等于 `build()` 结果、片段数 ≥10、关键片段齐全、ORDER 与磁盘文件必须一一对应
- `bust.mjs` 重写为"改 src 的版本号 → 拼产物 → 算产物 hash → 改两个 html"，避免直接改产物又被 build 覆盖

### 2. 地图全面贴图化（不再用 Graphics 画）
- 新增 `office/tools/gen_tiles.mjs`：node 内置 zlib 自己编码 PNG，生成 12 张 48×48 贴图到 `web/assets/tiles/`：`wood / tile / stone / grass / road / wall / window / window-night / sky / water / bank / farm`
- `80-room.js` 重写：底图 = 一张 **RenderTexture（2688×1488）**，`beginDraw/batchDraw/endDraw` 铺格子贴图——地板（按区域：木地板/瓷砖/石板/草/道路）→ 道路 → 池塘（水面+沙岸+栈道）→ 农田 → 隔墙 → 顶部墙带（墙 + 窗 + 天空）；原来的 `fillRect/fillStyle` 全删，check.mjs 加门禁："80-room.js 不许再出现 fillStyle"
- 池塘从"独立 graphics"并入底图贴图（隐藏/恢复 = 重建底图）；农田田土也是贴图，`drawFarm()` 只保留状态层（浇水/施肥/作物）
- 编辑器叠加层（地板/地形）同样改用同一套贴图（一张 RenderTexture，depth 6）
- 部署：`sync_web.sh` 增加 `assets/tiles/`；`TILE_V` 由 bust 按 tiles 内容 hash 自动刷新

### 3. 路灯的光源定位已删除
- `buildLampGlows()`（在每盏路灯位置画 ADD 光圈标位置）连同两处调用一起删掉，`s.lampGlows` 不再存在；check.mjs 门禁：office.js 里出现 `lampGlows` 即报错

### 验证
- 底图 `baseGfx.type === "RenderTexture"`（2688×1488）、12 张 tile 贴图全部加载、`lampGlows` 不存在
- 家具/碰撞照常：props 141（用户自己隐藏了 9 件静态物）、blocked 307、鱼照常走位、`dupGroups 0`、无 pageerror
- 编辑器：刷 3 格路 + 3 格水 + 2 格墙 → `editLayerGfx` 是 RenderTexture、条目全部落 hub
- check.mjs **22/22**；`web/office.js` 与 src 一致（`build.mjs --check` OK）

### v39.1 片段改名 + 产物压缩
- **片段名去掉数字前缀**：原先 `00-head.js / 10-core.js / …` 是机械切片时按行号起的临时名字，现已改成功能名（见上表），顺序改由 `build.mjs` 的 `ORDER` 显式声明（磁盘上多出/漏掉片段会直接报错）
- **产物压缩**：拆分本身不减小体积（`office.js` 是拼接产物，还是同一份代码）。真正省体积靠 `build()` 里的安全压缩——删整行注释、删空行、去掉行首缩进（代码里没有多行模板字符串；压缩后还会跑一遍 `node --check`，语法不过就自动退回未压缩）
 - `web/office.js`：**261,030 → 196,685 字节（−25%）**；未压缩拼接 225,456 字符 → 产物 182,331 字符（省 19% 换行+注释+缩进）
 - 标识符和字符串一个字不动，所以 `check.mjs` 的特征串（`function applyCustomMap(` 等）在产物里照样搜得到；源码检查改为读**未压缩拼接** `buildRaw()`
- 三个命令：`node office/tools/build.mjs`（拼+压缩）、`--check`（产物是否最新）、`--raw`（打印未压缩拼接，排查用）

## v36 农场 / 鱼塘 / 料理 + 调试道路层 + 视角自由拖动（2026-11-08）

用户需求："debug 中能直接单独显示道路层；添加农场系统：锄地、浇水、播种、施肥、收割；添加鱼塘以及钓鱼；添加料理制作；邻居没有视角导航，没有自由拖动视角的按钮。"

### 农场（office.js FARM 模块 + map.json zones.farm）
- 花园 rows22-26 cols28-34 = 5×4=20 格耕地；点耕地按地块状态自动干对应农活：生土→锄地，空地→播种（随机消耗仓库种子），旱地→浇水，未施肥→施肥（肥料+50% 生长速度），成熟→收割入库
- 作物 5 种（小麦/番茄/胡萝卜/玉米/卷心菜），浇水才长（farmTick 每 30s 推进），进度条按 stage 画苗/熟果
- 仓库（种子/作物/肥料/鲜鱼）持久化 localStorage（office_farm_v1），跨天浇水自动干掉、生长 +0.5
- 本地生活事件表新增 farm（巡农田）/fishing（钓鱼）/cookmeal（做料理）三条，需求系统按饱食度加权

### 鱼塘（POND 模块 + zones.pond）
- 花园东南 (35.2-38.2, 22.2-26.2) 椭圆水面 + 木栈道 + 芦苇；4 条鱼影来回游动，咬钩时游向浮标
- 点塘面抛竿：2~5s 后浮标冒「！」（1.1s 咬钩窗口），再点一下起竿——78% 鲜鱼 / 15% 肥料 / 7% 河童旧怀表（肥料+2）
- 钓鱼中任何点击都是起竿；错过窗口鱼跑掉

### 料理（RECIPES + 灶台/料理台联动）
- 8 道菜谱：烤面包/田园沙拉/蔬菜浓汤/盐烤鲜鱼/鱼寿司/爆米花/番茄汁/大杂烩，食材=农场作物+鲜鱼
- 点灶台或触发 cookmeal 事件：走到灶台 → eat 动作 → 自动做一道食材够的菜（按饱食恢复排序）→ 弹料理面板（食材存货 + 今日菜谱可做状态）

### debug 台（debug.js）
- ③ 场景控制新增：🛣 道路层（单独显示/隐藏主路+门径，检查路网压盖）、🌾 农活一轮、⚡ 催熟全部、🎣 钓一条、🍳 做道菜
- 实时诊断新增 农场（熟/长/鱼）· 道路层 · 拖动视角 三行；__officeCtl 暴露 farm/farmAct/farmGrowAll/pond/fishOnce/kitchen/cook/cookAuto/toggleRoads/gotoNeighbor/camDrag

### 视角导航（buildRoomTabs + bindCamDrag/bindCamWheel）
- 顶栏新增 喵酱家/村长家/博士家 三个邻居视角 tab（zoom 1.4 停靠门口），✋ 拖动 按钮进入自由视角：按住画布拖动平移（>6px 算拖、松手 350ms 内抑制误走位），滚轮缩放 0.8~2.2，ESC 语义=再点一次退出回跟随

### 修一个 v36 自伤的 P0
- drawRoads 在 buildRoom 中段+末尾各调一次，函数内 `roadsGfx.destroy()` 第二次把 baseGfx 自己销毁了（active=false 不再渲染）→ 整屏只剩背景色。修复：drawRoads 不再持有/销毁 graphics，只往传入的 g 上画

## v35 路网重设计：只留花园街道，房间路全部拆除（2026-11-08）

用户需求："把房间里画出来的道路删掉，只需要构建花园街道各个邻居家门口的线路图"。v34 画在夜间遮罩上的"路"（depth 59500）覆盖了室内地板，看着像房间被路穿过；花园里的横径/竖径与 D6 连接段之间还断着 2.8 格草地；旧屋前小径只伸到活动带 y15，离 y19 门洞差 4 格且 x 与门洞错位。

### 删（office.js buildLampGlows / buildRoom）
- **室内路网全拆**：走廊横带 rows15.2（cols 1-25）+ 三条竖门径（4.9/12.9/20.2）——房间回归纯净地板，鱼走 A* 不依赖画出来的路
- **花园路网全拆**：横径 y8.8 / 竖径 30.6-32.3 / D6 门洞连接段——花园回归纯草地，草皮直通街道主路（土路肩过渡带保留）

### 留 + 改（buildRoom 街道段）
- **街心主路**：暖石板横穿 cols 38.5-55.5（北缘 y8.6 贴房子南缘）
- **门径改为数据驱动**：不再写死三组坐标，从 `map.walls` 的 y19 横墙 `gap` 动态推导——向北接到主路南缘 y9.8、向南铺出门洞 1.4 格当迎宾垫。另一窗口调整邻居布局/挪门洞时，小径自动跟着 gap 走
- 路灯光圈层（buildLampGlows）回归纯灯，depth 59500 不再画路

### 验证
- 门禁 19/19；before/after 六屏截图对照（logs/office-road-shots/）
- 走查：逛市集落点 (50.7,18.0)≡market 锚点、散步落点 (32.0,12.0)≡garden 锚点——路是纯视觉层，删路不断走法

## v34 邻居的房间布局：点击房屋进屋串门（2026-11-08）

用户需求："邻居的房间布局也要做，点击邻居房屋可以查看邻居家的情况"。此前三户邻居只有一张外景贴图（o:true 无碰撞，鱼能穿房而过），屋里是空的，点击只能弹一句静态信息卡。全部落地：

### 户型与家具（map.json）
- 南排 rows19-28 划给三户：喵酱家 cols40-45 / 村长家 46-50 / 博士家 51-55，每户一面带门洞的前墙 + 户间隔墙（W5-W10 共 6 面）
- **喵酱家**（暖木地板）：猫窝床、床头柜、留声机、门帘、圆桌+马克杯、软垫——"门垫上永远有鱼干渣"
- **村长家**（暖黄地砖）：饭桌+两把椅子+果盘、料理台、灶台、冰箱——热心理家的水豚
- **博士家**（蓝灰地毯）：书桌+地球仪+书堆、书架、潮汐黑板、药剂架、扶手椅+落地灯——研究所
- 三栋房屋精灵去掉 o:true：恢复 bbox 落地阴影与碰撞（原来鱼能穿进贴图）
- doorCat/doorChief/doorDoc 敲门锚点（正对各户门洞）+ living_cat/living_chief/living_doc 屋内落点，zoneAudit 语义校验（expect 家具 2.2 格内）全绿
- 静态 BFS 复核：三户屋内 ↔ 街道连通、门洞可走、门口格在连通域

### office.js 进屋机制
- `NEIGHBOR_HOMES`：每户 home/door/living/相机停靠(cx,cy,zm) 一行配置；`bindClick` 里用**房屋精灵整块包围盒**判定点击（大目标不怕点偏），点击优先级最高
- 进屋不是瞬移：鱼先 A* 走到那家门口敲门（❢ 浮标 + 「咚咚咚」气泡），再切到屋内落点，相机 pan+zoom 1.25 推进屋里；主人在家时按时段从 NPC_DIALOGS 抽一句欢迎语
- `visitingHome` 串门态：idleStep 在屋里小坐（两轮后自己走出门回家）；真实事件到 = 客人该走了（状态更新照常，观景镜头让位）；再点同一栋房子 / 切房间 / 点跟随 / 任意本地行为 = 出屋，镜头回小镇停靠位
- NPC 在家 = **真的在屋里**：回家动线 门口→穿门洞→屋内锚点半步偏移（不与客人叠影），名牌/圆点收起；出门反向穿门洞再 roam。名牌旁新增 🟢在家/🟡在街上 状态圆点
- 修复三处既有 bug：①npcGoHome 起手 `npc.state="home"` 导致第二段 tween 的守卫永远通过（现在用 npcDoorTween 单一出口）；②NPC roam 区 [58,71] 是 72 格时代的遗留坐标、会散步到地图外（56 格世界里改 [40,54]）；③onState 的观景 pan 恢复跟随的兜底会在串门时把镜头拽走
- 信息卡三户动态化：`● 在家（点房子进屋）/ ○ 出门了`；页脚补玩法说明
- `__officeCtl.snapshot().visiting` 暴露串门对象（自动走查断言用）

### 验证
- node tools/check.mjs 19/19（区域锚点/阻挡/语义/事件表/版本号全绿）
- 无头 Chromium 全链路走查：三户 点击→敲门气泡→进屋→欢迎语→切房间出屋 全部通过，JS 0 错误
- 屋内截图核对：三户专属地板/家具/欢迎气泡均正确呈现


### v39.2 窗变成可摆放的物品 / 鱼塘可逐格自定义
- **窗**：`boot.js` 在预载时把 `tiles/window.png` 注册成资产 `window`（并补一条 `manifest.window: {frameW:48, frameH:48, bbox:[0,0,48,48]}`），同时进 `EDIT_PICKABLE`。摆放时 `placeExtraFor("window")` 会带上 `wall:true` → `makePlacement` 走"墙饰"分支：depth -5、不投影、**不产生碰撞**。于是窗和家具完全同权限：拖放、移动、删除、进物件列表（带图标）、id 落 hub。侧栏「底图结构」里那三行改成"（自带）"，只用于关掉 map.json 原生的三扇窗。
- **鱼塘**：`paintPond()` 先看该格有没有用户条目（`floorEdits` / `terrainEdits`），有就跳过 → **用户手改的格子优先**。改形状的方法：地形层「水面」刷子加水扩大，地板层「草地/石板」刷子把多余的水填掉（填掉后该格同时解除阻挡）。整片不想要还能用「底图结构 → 鱼塘水面（自带椭圆）·隐藏」一刀关掉。
- 验证：放两扇窗 → hub 收到 `{"a":"window","wall":true}`、`blocked` 311→311（不挡路）、列表出现 `window`、拖动从 x=710 移到 830；池塘中心格填草地后 `grid=0`、旁边加水面后 `grid=1`。


### v39.3 物品分类展示
- 71 件资产原来全挤在一个网格里，现在按用途分成 10 类（`mapedit.js` 的 `EDIT_CATS`）：🪑桌椅台 7 · 🗄收纳柜 7 · 🛋沙发床 5 · 🔌电器 8 · 🧸桌面小物 16 · 🍳厨卫 7 · 🪴植物装饰 5 · 🌳户外 12 · 🏠建筑 3 · 🪟窗/其它 1
- 独立编辑器侧栏：类别 chips（带件数）→ 点类别只显示该类资产；默认「全部 71」，选中类别高亮，当前选中的资产在哪个类别里都还能用
- 游戏内面板：资产网格上方加「分类下拉」，按 `data-cat` 过滤
- `state().categories` 把分类+资产下发给前端；`check.mjs` 加了三条门禁：**每件资产必须恰好属于一个分类**（漏分类会让它在编辑器里找不到、重分类会重复显示）+ editor.html 必须有 `#ed-cats` 样式 + editor.js 必须有分类状态
- 验证：chips 渲染 11 个（含全部）、点「沙发床」后网格只剩 sofa/armchair/double-bed/bed/crown-cushion 5 件并高亮、选中 sofa 后点地图能正常放置


### v39.4 删掉「底图结构」+ 保存必须看得见（保存没反应的真因）
- **删掉「底图结构（窗 / 鱼塘）」整栏**：`STRUCTS` / `__mapEditor.structs()` / `setStruct()` 全部移除，`room.js`、`placement.js`、`furniture.js` 里对应的 `win:*` / `pond:main` 隐藏分支一并删掉。窗本来就已是可摆放的物品，鱼塘可直接用刷子改形状，那栏只剩"隐藏开关"，容易误导。
- **保存"没反应"的真因**：独立编辑器里保存结果只写进 `addEditLog`，而它写的是**游戏内面板的 `#edit-log`**，editor.html 里根本没这个 DOM → 成功/失败都静默；加上贴片保存是 260ms 防抖，改完立刻刷新就丢。修法：
 - 侧栏底部新增 **保存状态条**：`✔ 12:03:44 已写入 hub（hub 现有 N 条）` / `✖ 保存失败：原因（改动已存本机浏览器）`；「💾 保存」按钮变成 保存中… → 结果
 - 新增 `__mapEditor.saveNow(cb)`：POST 完**回读 GET /api/map** 校验条数，写入 `state().lastSave`，并通过 `window.onMapSaveResult` 推给侧栏
 - 贴片防抖 260ms → **120ms**，并且**抬手就立刻 flush**（`mapEditorPointerUp`），改完马上刷新也不会丢
 - 本机镜像修一个坑：`flushLocalMirror()` 原来只要 `pending` 就无脑推，**旧镜像会把 hub 新存档盖掉**；现在记录 `mirrorAt` 与 hub 的 `updatedAt` 比较，只有本机更新才补传，否则以 hub 为准
- 验证：铺石板+水+放沙发 → 状态条 `✔ 已写入 hub（hub 现有 3 条）`；刷新后 `entries` 仍是 1 地板 / 1 地形 / 1 物品；拦截 fetch 模拟离线 → 状态条变红 `✖ 保存失败：offline-sim`；侧栏已无「底图结构」，`typeof __mapEditor.structs === 'undefined'`


### v39.5 删掉代码里画死的旧窗
- `room.js` 的 `paintTopBand()` 不再画窗：顶部墙带只剩「墙 + 天空 + 大门门洞」，`winCells/winMat` 一并删掉
- `placement.js` 的 `redrawWindow()` 整个删除（它原本负责昼夜重绘那三扇窗），`applyRoomLights()` 与 `weather.setWeather()` 里的两处调用同步移除；`s.winRedraw` 不再存在
- `head.js` 的 `EXTRA_WINDOWS`（卧室窗/卫浴高窗的坐标表）删除；`boot.js` 里 `redrawWindow()` 的兜底调用删除
- 窗只剩一种来源：物品层里的 **window** 资产（`wall:true`，不挡路，可拖可删）。想要几扇、摆哪里，都自己放
- `check.mjs` 加门禁：office.js 里再出现 `EXTRA_WINDOWS / redrawWindow / winRedraw`，或 room.js 里再有 `winCells/winMat` → 直接报错
- 验证：`scene.winRedraw === undefined`、`EXTRA_WINDOWS` 未定义、顶部墙带截图无窗、关灯仍正常（roomOverlays 0.60）、物品层放窗仍能落 hub（`{"a":"window","wall":true}`）


### v40 光照层：昼夜预览 + 夜间阴影可调 + 自定义灯源
编辑器新增第 4 个图层「🌙 光照层」（独立编辑器里点 tab 进入）：

**1. 昼夜预览**（`🕒 自动 / ☀ 白天 / 🌙 黑夜`）
- `head.js` 加 `var forceNight = null`，`isNightHour()` 认它 → 预览直接影响夜景判定
- `applyRoomLights()` 语义改为：`day`=全亮 / `night`=按关灯画（能看到阴影和灯光）/ `auto`=编辑器全亮、游戏按真实状态
- 黑夜预览时内置灯池（lightPools）保持点亮，方便对着灯光位置调参

**2. 夜间阴影可调**（两条滑杆，存 localStorage `office_night_cfg`）
- **暗度** 0→0.9：`roomOverlays` 的 alpha（原来写死 0.60，户外 0.45 = 0.75×）
- **外扩** 0→96px：遮罩矩形四边同时外扩（`ov._base` 存原始矩形，`setPosition/setSize` 重算），于是阴影能盖过相邻房间/墙
- 刷新后参数保留（`loadNightCfg()` 在启动时读回）

**3. 自定义灯源**（`{a:"light", x, y, r, al, tint, id}`，hub 零改动）
- 预设 4 种：路灯暖光 / 室内暖光 / 冷光 / 大范围（半径+亮度+色温各不相同）
- 工具：`💡 落灯`（点地图放）、`✥ 拖动`（按住拖灯）、`🗑 删灯`（点灯删除）
- 灯光列表：色点 + 半径/亮度 + 坐标 + ✕；选中灯后出现「半径 / 亮度」两条滑杆实时改
- 渲染：复用 `lightpool` 径向渐变贴图 + ADD 叠加，depth 50000（与内置光池同层），整体重建
- 修了两个 bug：①灯 id 用 `Date.now()` 会在同一毫秒内重复 → hub 报「id 重复」整批保存失败；②贴片/灯保存的 120ms 防抖窗口里，hub 广播会把刚改的列表清掉 → 新增 `meEditing` 标记，改动落盘前忽略广播

**验证**（无头 Chrome）：黑夜预览 `roomOverlays` 0.6；暗度 0.35 + 外扩 32 → alpha 0.35、宽 1312（1248+64）；白天预览 → 全 0；落 3 盏灯 → hub 3 条（r/al/tint 齐全）、场景 3 个精灵；改半径 5/亮度 0.8、拖到 (21,12)、删 1 盏 → hub 同步；刷新后 `alpha 0.35 / pad 32 / preview night` 与剩余 2 盏灯都在


### v41 阴影区域改成「拉框」（矩形块，不是逐格刷）
- 数据模型：`{a:"shadow", x, y, w, h, lv, id}`（x,y=左上格，w/h=格数，lv=1..3 浓淡），hub 零改动
- **交互**（光照层 → 子模式「🌑 阴影区域」）：
 - `▭ 拉框`：在画布上按住拖一个矩形 → 拖动中有蓝色半透明预览框 → 松手落一块阴影（只点一下就是 1×1）
 - `✥ 移动块`：按住已有阴影块拖动整体移动
 - `🗑 删块`：点一下删掉整块
 - 浓淡 `淡 / 中 / 浓`：设画笔浓度；**若已选中某块，顺手改那一块**
 - `清空全部阴影块（N）` 一键清空
- 侧栏「阴影块（N）」列表：`阴影 #1  9×4 · 淡  2,2  ✕`，点行选中（高亮）
- 夜间阴影两个滑杆旁边新增 **「用内置房间遮罩」开关**：关掉后只剩自己拉的阴影块，不再叠加 4 个房间矩形
- 渲染：一块一个 `fillRect`（depth 59100），alpha = 全局暗度 × 浓淡系数（淡 0.5× / 中 1× / 浓 1.5×，上限 0.92）
- 验证：拖 8×5 → hub `{x:2,y:2,w:9,h:4,lv:2}`；第二块用「浓」→ lv=3；选中第一块点「淡」→ lv 变 1；删一块 → hub 剩 1；刷新后仍在，场景 `shadowGfx` 存在


### v42 阴影区域列表化：内置房间也进列表，每块独立「夜 / 开灯 / 白天」三档浓度
之前是"4 个写死的房间矩形 + 全局暗度/外扩 + 手刷块"三套东西混在一起，确实乱。现在统一成一个模型：

**数据**（`mapedit.js`）
- `BUILTIN_SHADOWS`：内置 5 块 —— 办公室 26×15 / 卧室 9×13 / 卫浴 6×13 / 厨房 9×13 / 户外(花园+街道) 30×30，默认 `night 0.60 / lit 0 / day 0`（户外全 0，不改变现有效果）
- 自定义层条目：`{a:"shadow", id, x, y, w, h, night, lit, day}` = 新增块或覆盖内置块；`{a:"shadow", id:"b_kitchen", del:1}` = 删除内置块
- `buildShadowRegions()` 把「内置 + 覆盖 − 删除 + 自定义」合并成最终列表；`shadowAlphaOf(r)` 按当前时刻取值：
 `白天(非夜间)` → `day` ｜ `夜间 + 该房间灯开` → `lit` ｜ `夜间 + 灯关` → `night`
- 三个值分开存放，互不影响；`room` 字段让内置块跟着对应房间的灯状态走，自定义块跟全局灯状态

**渲染**（`placement.js`）
- 原来 4 个 `roomOverlays` 矩形退休（`roomOverlays = {}`），暗度全部由 `renderNightShadow()` 一个 Graphics 按区域绘制（depth 59100）
- `applyRoomLights()` 里那句"重画房间遮罩"改成 `renderNightShadow(s)` —— 开关灯/昼夜变化立刻反映

**编辑器 UI**（光照层 → 阴影区域，截图见 `logs/office-v37-shots/map-v42-shadow-list.png`）
- 顶部删掉了重复控制的「暗度 / 外扩 / 用内置房间遮罩」三条
- **新拉一块的默认浓度**：夜 / 开灯 / 白天 三条滑杆（`setShadowDefaults`）
- **阴影块列表**（内置 + 自建都在里面）：`办公室 [内置·26×15] 夜0.80·灯0.15·昼0.05  0.80 ✕`，末尾是"当前生效浓度"
- 点某块 → 上方出现编辑面板：**改名字** + **夜/开灯/白天三条滑杆**（改哪条存哪条）
- 内置块同样可：改名、移动（切「✥ 移动块」拖）、删除（✕ 写 del 标记，删了就不再出现）
- 拉框预览、移动块、删块、清空（只清自建，内置恢复默认）都在

**验证**：默认列出 5 块内置；改办公室 `0.8/0.15/0.05` → hub 落 `{id:"b_office",...}`，黑夜预览生效 0.8、白天预览生效 0.05；删「厨房」→ hub 落 `b_kitchen:DEL` 且列表消失；改「卧室」名字为"主卧"并移到 (2,2) 8×10、浓度 0.75 → 刷新后全部保留。


### v43 地图重建：道路 / 农田 / 鱼塘 / 路灯 / 光源 / 邻居家
用 `office/tools/gen_map.mjs` 重新生成 `web/map.json`（数据驱动，可重跑），逐项修掉原来的不合理：

| 原来的问题 | 现在 |
|---|---|
| 三户房屋外观在 y≈9（路北），室内在 rows20-28（路南），靠 10 格"门径"硬连 | 房屋外观挪到各自室内正上方（y=19.6，踩在 y19 墙上），门洞正对门前的路 |
| 道路只有一条 y8.6 横街贴着房顶，门径 10 格长 | **mapdata.roads 数据驱动**：主街 y16-18 紧贴房前 + 每户 1 格迎宾垫 + 花园纵向小径（x33-34 → 塘边）+ 办公室东门石板小院；`paintRoads()` 改成读这个数组（老地图没 roads 字段时走兜底） |
| 路灯 5 盏散在四处，其中两盏(52,13.6 / 53,12.4)几乎重叠，还有一盏落在花园里 | 沿主街等距 5 盏（x=30.5/38.5/44.5/50.5/55，y15.2 人行道）+ 花园小径 1 盏 + 塘边栈道 1 盏 |
| 光源只有内置光池 + 编辑器手加，和灯对不上 | 新增 **mapdata.lights**：一盏灯一个光斑，位置跟着灯走（7 个）；编辑器「灯源列表」里以 `内置` 出现，可改半径/亮度/拖动/删除（删=写 del 标记，改=写覆盖条目，hub 零改动） |
| 白天也亮着大光斑，把地板糊成一片 | 光源按昼夜缩放：夜里 1.0×、白天 0.18× |
| 池塘沙岸 1.55 倍太宽，把花园东南整片铺成沙子 | 收窄到 1.12（一圈薄沙岸） |
| 家具压墙 / 压水 / 压田 / 压路 | 脚本自动检测：能挪的挪（6 件：两个摊位、花、窗帘、博士家黑板/药水架），挪不动的剔除；新增"固定位置"表处理长椅 |
| 市集/长椅锚点落在新马路上 | 锚点跟着家具走：market → (49.6,14.2)、town_bench → (47.4,14.1) |
| 邻居家隔墙 x40/45/50 与室内不对齐 | 统一成 39/45/51 三道隔墙 + 每户北墙 y19 带 2 格门洞 |

**验证**：`zoneAudit` 0 问题；market/town_bench/farm/pond/三户门口/garden/town 锚点全部可走；props 150 / blocked 327；7 个内置光斑；编辑器灯源列表出现 `bl_1..bl_7(内置)`，改半径/删灯分别落 `{id:"bl_1",r:4.5,al:0.7}` 与 `{id:"bl_3",del:1}`；`check.mjs` 22/22。


### v44 编辑器三连修：坐标对不上 / 不能旋转 / 一直锁在放置态
用户报的三个问题，根因都在坐标与工具状态机：

**① 物品落在鼠标右下方半格**
- `map.json` 里 `f.x` 的语义是"格中心"（`world = f.x*TILE + TILE/2`），但放置代码写成了 `x = (wx - TILE/2)/TILE + 0.5` —— 多加了半格
- 现在统一走 `editSnapX/editSnapY`（0.1 格精度吸附，落点即光标位置），**放置 / 拖动 / 半透明预览三处共用同一套坐标**；预览原来吸附"格中心"、落点偏半格，所以看起来永远对不上
- 验证：点格 (20,10) 中心 → hub 落 `{x:20,y:10}`；预览坐标 = `22*48+24, 48+9*48+24` 与落点一致

**② 不能旋转**
- 新增朝向状态 `EDIT_ROT`（0=南 1=东 2=北 3=西）+ `editFrameFor()`：帧号 = 行 × 每行帧数（家具每行 1 帧、角色每行 8 帧），行序按 manifest 的 `South/East/West/North`
- 侧栏物品层多一个 **`⟳ 旋转 · 东`** 按钮，快捷键 **R**；先选资产 → 转"下一次要放的"；已选中自建物品 → 直接转那一件（走 hub `update` 写 `frame`）
- 4 个朝向连放验证：hub 依次得到 `frame:1 / 3 / 2 / (默认0)` ✓

**③ 一直锁在放置态 / 点删除还在摆东西**
- 根因：`tool` 的判定把"资产还选着"放在最高优先级 —— `ME.asset ? "add" : "select"`，所以选了资产后点「选择」「删除」都会被改回"放置"
- 现在改为工具优先：`erase→delete`、`move→move`、`select→select`，只有 `paint` 且选了资产才是 `add`
- 另外**默认"放一次就交还选择工具"**（放完 `asset` 清空、工具切 `select`、预览销毁），想连续摆就勾「连续放置」
- 物品层工具行补了「🎯 选择」；选定资产后立刻进入"放置+预览"，鼠标一动就能看到跟手的半透明预览

`check.mjs` 22/22；三处回归都用无头 Chrome 真点验证（落点、四向帧号、放完再点不重复、切删除能删掉）。


### v45 旋转后影子 / 碰撞 / 脚点跟着变
用户反馈"虽然旋转了，但影子和碰撞距离没改"，根因是 **manifest 里只存了第一行（正面）的 bbox**：

- 贴图是 4 行（South/East/West/North，每行 1 帧），每行内容尺寸完全不同（沙发正面 46×25、侧面 21×44；桌子正面 52×42、侧面 28×60）
- 而 `makePlacement` 一直用 `m.bbox`（= 正面那行）算：脚点 origin、`p.bbox`，再由 `p.bbox` 推导**接触阴影宽度**（`furniture.js:49`）和**碰撞格投影**（`furniture.js:99`）→ 转完还是按正面尺寸

修法：
- 新增 `office/tools/gen_bboxrows.ps1`：把每张家具图**每行第一格**的 alpha 包围盒算出来，写进 `assets/manifest.json` 的 `bboxRows`（74 个资产，72 个各行尺寸不同；whale.json 同步补上 20 行）
- 新增 `bboxForFrame(m, frame)`（head.js）：`row = floor(frame / 每行帧数)` → 取那一行的 bbox，缺 `bboxRows` 时退回 `m.bbox`
- `makePlacement` 改用它 → 脚点 / 影子 / 碰撞 / 命中盒 / 选中框全部自动跟着朝向走
- 编辑器半透明预览也按当前朝向取 bbox，并在换帧后重算 origin（否则转一次预览就歪）
- 顺带把 payload 里的 `rot` 去掉：hub 白名单不含 `rot`，留着只会出现"frame=1 但 rot=0"的自相矛盾，**frame 是唯一真相**

**验证**（无头 Chrome，真点真转）：
- 沙发：南向 `bbox [1,11,46,25]`、影子宽 58px → 转 90° 后 `bbox [13,2,21,44]`、影子宽 **25px**
- 桌子：南向 `bbox [6,11,52,42]`、影子 66px、占地 **3 格**(19,9/20,9/21,9) → 转 90° 后 `bbox [18,2,28,60]`、影子 32px、占地 **1 格**(20,9)
- `check.mjs` 新增 4 条门禁：必须有 `bboxForFrame`、placement 必须按行取、预览必须按朝向取、多行资产必须有 `bboxRows`


### v46 Shift 连放 / 撤销重做 / 按层清空
用户三点：Shift 连放、别一刀切清空、要能撤销上一步。

**① 按住 Shift 连续摆放**
- `editPointerDown` 读到 `pointer.event.shiftKey` → 这一次放完不交还工具，可以接着点下一个位置
- 不按 Shift 仍是"放一次就回「选择」"；侧栏「连续放置」勾选则是永久连放
- 验证：按住 Shift 点 3 个格子 → 3 把椅子且仍是 `tool=paint / asset=chair`；松开 Shift 再点一次 → 放下并自动切回 `select`

**② 撤销 / 重做（`↶ 撤销` / `↷ 重做`，Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y）**
- `editor-api.js` 加了内存历史栈（最多 80 步）：`mePushHistory()` 在每次写操作**之前**压一份整层快照
- 关键点：`meSetTile / meEraseAt / meAddLight / mePatchLight / meRemoveLight / meAddShadow / mePatchShadow / meRemoveShadow / meClearShadows / meClearLayer` 这些"先改数据再存"的路径，必须调 `meBeginMutation()`（压快照 + 锁住紧接着 `saveEditMap` 的二次压栈），否则撤销拿到的是"改完"的状态 = 撤销无效
- 撤销/重做都是把快照整层 `set` 回 hub，所以 hub 与画面同步（实测 4→3→2 把、hub 也 3→2）
- 历史只在内存里：刷新页面后栈会清空（存档本身不受影响）

**③ 清空不再一刀切**
- 底部「🧹 清空…」弹序号菜单：`地板层 / 地形层 / 物品层（自建物品）/ 灯源 / 阴影区域覆盖 / 全部`
- 只清对应种类，其他层原样保留（实测清物品层：removed 3、floor 1 / terrain 1 仍在）
- 清完还能 `Ctrl+Z` 撤回来（实测 objs 0 → 3）
- 顺手修了 `objectCount` 把灯源/阴影算成物品的统计错

**验证**：Shift 连放 3 把 → 撤两次 → 重做；铺 2 块地板 → 撤 2 次归零；加 1 盏灯 → 撤销回 7 盏；按层清空/撤销全部通过；`check.mjs` 22/22


### v47 存档保护：自动备份 / 一键回滚 / 本机副本（道歉 + 补漏）
**先说结论**：`map.custom.json` 里目前只剩 14 条（9 条旧 hide + 3 条花园家具 move + 2 条 hide），**没有你的花圃**。原因是我的测试脚本反复直接写这份文件（`clearAll` / `clearLayer('all')`），把它冲掉了——这是我的问题，不是"没保存"。

#### 现在加的保护（三道）
1. **hub 每次覆盖前自动备份**
   - `hub.mjs` 新增 `backupMapFile()`：写 `map.custom.json` 之前先 `copy` 到 `office/hub/map.backups/map-<时间戳>-<条数>条.json`，保留最近 **30** 份
   - 新增 `GET /api/map/backups`（列表，带条数/大小/时间）与 `POST /api/map/restore {name}`（恢复，恢复前也会备份当前状态；文件名白名单校验，禁止路径穿越）
2. **编辑器里一键回滚**：底部新增 `🗂 历史存档`（弹列表选序号恢复）、`↺ 本机副本`（用浏览器 `localStorage.office_map_custom_v1` 覆盖 hub，离线编辑的兜底 / 也可能是丢失前的最后一份）
3. **仍然保留**：`Ctrl+Z` 内存撤销栈、按层清空（不再一刀切）

#### 我的测试从此不再碰你的存档
- `hub.mjs` 早就支持 `OFFICE_MAP_FILE` 环境变量；本轮验证全程用 `C:\...\Temp\mapdiag\tmp-map.json`，备份落在同目录 `map.backups/`
- 验证结果：写 3 条 → 写 5 条 → 清空 0 条，备份列表拿到 `0条 / 3条 / 5条` 三份，`restore` 选 5 条那份 → hub 回到 5 条且内容正确

#### 你的花圃
从截图看是 **3 格泥土（农田贴片）+ 一盏路灯**。两种恢复办法：
- 你打开编辑器点 `↺ 本机副本`，如果当年那份还在浏览器里，会直接回来（会自动先备份 hub 现状）
- 或者告诉我大概位置（哪一格附近），我用一条 `set` 直接写回去：`terrain farm @(x,y)×N + street-lamp`


#### 用你自己的话收尾：只做"不再被覆盖"这件事
你的选择：**花圃你自己重画；备份策略保持"每次写都备份 + 保留 30 份"**。所以这一轮只加固保护，不再动你的数据：

1. **基线备份已建立**：`office/hub/map.backups/map-20261109-130325-14条.json`（你现在这份 14 条状态），
   这样「🗂 历史存档」一开始就不是空的，任何时候都能回到今天这一步
2. **hub 运行中的保护**：从今以后每次写 `map.custom.json` 之前都会先备份（保留 30 份，带时间戳+条数）
3. **新增测试专用入口** `office/tools/test-hub.mjs`：
   `node office/tools/test-hub.mjs` 起一个数据文件指向 `%TEMP%\office-hub-test-*` 的 hub，
   **绝不读写你的真实存档**。以后所有自动化验证（包括我）都走这个入口，不再直连你的 4321 数据文件
4. **客户端防旧覆盖**：`applyCustomMap` 已有 `mirrorAt > hubUpdatedAt` 判定 —— 浏览器里的旧副本不会把新存档盖回去

#### 如果你重画完发现"又没了"，按这个顺序查
1. 编辑器底部看那行状态：`✔ 已写入 hub（hub 现有 N 条）` —— 记下 N
2. 点 `🗂 历史存档`：列表里有时间戳和条数，选你重画完那一步恢复即可
3. 还不行点 `↺ 本机副本`：用浏览器里的副本覆盖 hub（会先备份 hub 现状）
4. 再不行看 `office/hub/map.backups/` 目录，直接把某个 json 复制成 `map.custom.json` 重启 hub


### v48 编辑页清场 + 右键拖动画面
**① 屏蔽游戏原有 UI（编辑页专用）**
- `#game-chrome`（标题栏 / 房间标签 / 底部状态条）本来就在 editor.html 里 `display:none`
- 画布内的东西也清掉了：
 - **NPC 名牌**（喵酱/村长/博士）：`npc.js` 建 tag 后 `if (editorMode) tag.setVisible(false)`
 - **鱼的气泡**：`showBubble()` 在 `editorMode` 直接 return（编辑器用自己的 `editToast`）
- 结果：编辑页只剩地图本体 + 右侧侧栏（见 `logs/office-v37-shots/map-v48-editor.png`）

**② 右键拖动画面，松手自动恢复**
- `bindCamDrag` 加了 `rightDrag`：`pointerdown` 时若 `p.rightButtonDown()` → 直接进入平移，**与「拖动视角」按钮状态无关**
- `pointermove`：`(!camDragOn && !rightDrag)` 才返回，所以右键拖同样走"超过 6px 才算拖"的判定
- `pointerup`：`rightDrag = false;` → 松手即恢复，不需要再点一次按钮
- 画布上 `contextmenu` 已被 `preventDefault`，右键不会弹浏览器菜单
- 右键不落笔：`loop.js` 的点击分发与 `mapEditorPointerDown` 都加了 `rightButtonDown()` 早退，**右键拖动不会误放物品**
- 侧栏「✋ 拖动视角」保留（给触屏/触控板常开用），标题改成「拖动视角（右键临时拖）」

**验证**（临时 hub，不碰真实存档）：右键按下 → 拖 6 步 → 松开，镜头 `scrollX/Y` 从 `0,0` → `150,72`；hub 条数不变（没误放）；随后左键点地图仍能正常放置（+1）。`check.mjs` 新增 5 条门禁（rightDrag / contextmenu / 右键拦截 / 气泡 / 名牌），22/22 通过。


### v49 灯开关为什么没用：两层原因 + 修法
用户报"框选区域打开灯后亮度没变化"，追下去是两个问题叠在一起：

**① 编辑器「黑夜预览」把开灯状态强行当关灯**
`shadowAlphaOf()` 里有一行 `if (previewNight() === "night") on = false;` —— 我当初为了让"黑夜预览"能看见暗部写的，结果预览黑夜时永远按"关灯"取值，按开灯也不会变。已删除该行：预览只决定"是不是夜里"，开灯与否看真实开关。
同时 `applyRoomLights()` 里灯池也改回跟随真实开关（原来黑夜预览强制点亮），这样按一下房间灯能立刻看到灯池亮灭。

**② 自己拉的阴影区域没绑定房间（这是用户这次的主因）**
- 区域的浓度分三档：`夜 / 开灯 / 白天`。"开灯"那一档什么时候用，取决于这块区域"属于哪个房间"
- 自定义块原来写死 `room: null` → 只跟**全局**灯（`lightsOn`）；而调试台的房间灯是**分房间**开的 → 区域永远停在"夜"值，看起来就是"开灯没反应"
- 现在：`roomForRect(x,y,w,h)` 和内置 4 个房间矩形**比重叠面积**自动归属；条目里存了 `room` 则优先用
- 没有归属的块（花园/街道）改为跟随"任意房间开着灯"，不再死盯全局开关
- 编辑器侧栏：阴影块列表行显示 `跟起居 / 跟卫浴 / 跟全局`；选中块后多一排「跟随灯」按钮可手动指定（自动/办公室/起居/卫浴/厨房/全局）
- 光照层还加了 **房间灯开关** 一排按钮（办公室/起居/卫浴/厨房 + 全部开/关），可以在编辑器里直接验证"夜 ↔ 开灯"两档

**验证**（用你真实存档的副本）：你画的 `smw8vrltza4`（10×15 @0,0，夜0.65 / 灯0.10）原来 `alphaNow` 恒为 0.65；
现在自动归属"起居"→ 开起居灯变 **0.10**、关回去变 0.65；手动改成"跟卫浴"后只有卫浴灯能驱动它（开起居不影响）。

**注意**：你的存档里 5 个内置区域（办公室/卧室/卫浴/厨房/户外）都被标了 `del:1`（之前用 ✕ 删掉了），所以现在只有这一块在产生暗部。要恢复"整栋房子晚上变暗"，在阴影块列表里把它们加回来即可（需要我直接写回也行）。


### v50 灯开关做成素材：可摆放 / 可移动 / 单独控制
之前"开灯/关灯"只是调试台的全局按钮，地图上没有任何开关实体。现在有了一件正经的**素材**：

**① 贴图（新）**
- `office/tools/gen_tiles.mjs` 新增 `drawSwitch()`，生成两张 48×48：`tiles/switch-off.png`（面板 + 拨杆朝下）、`tiles/switch-on.png`（拨杆朝上 + 绿色指示灯）
- `boot.js` 里 `load.image("switch" / "switch-on")`，并 `manifest["switch"] = { frameW:48, frameH:48, rows:{South:1}, bbox:[13,12,22,26] }` —— 于是它和窗一样是"可摆放的物品"

**② 摆进地图**
- 编辑器 → 物品层 → 分类 **「🪟 窗/开关」** 里多了 `switch`
- 放置时自动带 `wall: true`（挂墙上、不挡路、不产生碰撞），深度贴墙
- 可拖动、可旋转、可删除（和其它物品一样）；`房间归属` 默认按位置自动判断（离哪个房间矩形最近）

**③ 单独控制某个房间**
- 选中开关后，右侧出现 **「控制房间（点开关时切哪盏灯）」**：办公室 / 起居 / 卫浴 / 厨房 / 不绑定
- 数据落在物品条目的 `room` 字段（hub `update` 白名单已加 `room`）
- 游戏里点开关：切换该房间的灯 → `roomLights[room]` 取反 → `applyRoomLights()` 重画阴影/灯池 → 开关自己的贴图也换成 `switch-on/off`
- 点击优先级放在最前面（鱼在忙、有气泡时也能按）

**验证**：游戏页真鼠标点开关 → 贴图 `switch-on → switch`、`office` 灯池 alpha `0.16 → 0`（真的关灯）；再点回 `switch-on`、灯池恢复；API `__office.toggleSwitch(wx,wy)` 同样两次都成功。

**注意**：调试台原有的「开灯/关灯」按钮是全屋总开关，仍然保留；现在你可以在地图上按房间放多个开关，各管各的。


### v51 窗 / 开关终于能贴到墙上了
**为什么之前放不上去**：顶部那条 48px 的北墙带在"格子坐标"里是 `ty = -1`，而编辑器的 `meInBounds()` 只认 `ty ≥ 0` —— 点墙带直接被当成"界外"吞掉，连预览都不显示。

**改法**
- 新增 `band` 标记：墙带里落笔 → 物品存 `{x, y: 0, band: true}`
- `makePlacement()`：`band` 时脚点落在墙带底边（世界 y = 48），配合 `wall: true` 的 depth = -5，正好贴在墙带里
- 编辑器 `meInBounds()`：`ty = -1` 时，如果资产是挂墙类（窗/开关，`placeExtraFor().wall`）或当前工具是 选择/移动/删除，就放行
- 半透明预览也贴墙带（`worldY < WALL_H && meWallAsset(asset)` → 预览 y=48），所见即所得
- 拖动：从墙带拖到地面 → `band: false`（正常摆在地上）；从地面拖回墙带 → `band: true`；hub `update` 白名单加了 `band`
- 顺带修：`move` 工具在墙带里原来也会被吞（只放行了 select/erase），现在一并放行

**验证**（临时 hub，未碰你的存档）：
- 点墙带 (7.5, 26px) 放窗 → hub `{a:"window", x:7.5, y:0, band:true, wall:true}`，场景里 sprite 在 `(384, 48)`、depth -5
- 点墙带 (18, 26px) 放开关 → `{a:"switch", x:18, y:0, band:true}`，同样贴在墙带上
- 预览坐标 `(288, 48)` —— 和落点一致
- 墙体里的窗能被选中（`selF.band = true`），拖到地面后 `band: false, y: 10`


### v52 会变化的素材：窗 昼夜 / 开关 · 壁灯 亮灭（+ 新素材壁灯）
用户要"能变化的素材"，所以把"多状态贴图"做成机制，而不是只给开关写死一段逻辑。

**① 机制：`manifest[a].states`**
```js
manifest.window    = { ..., states: { night: "window-night", day: "window" } };   // 随昼夜
manifest.switch    = { ..., states: { on: "switch-on",  off: "switch" } };        // 随房间灯
manifest["wall-lamp"] = { ..., states: { on: "lamp-on", off: "lamp-off" } };      // 随房间灯
```
- `furniture.js::applyPropStates(s)` 统一处理：遍历 `s.placed`，按分类取"当前该用哪张图"，`setTexture` 换掉
- 分类表：`LIGHT_STATE_ASSETS = { switch, wall-lamp }`（跟房间灯）、`NIGHT_STATE_ASSETS = { window }`（跟昼夜，含编辑器黑夜预览）
- 调用点：建完家具层、`applyRoomLights()`（开关灯/昼夜切换都会走到）
- 想再加会变的素材：`gen_tiles` 画两张 PNG → boot 里 `load.image` + `manifest[x].states` → 塞进上面两个分类表即可

**② 新素材：墙上壁灯（wall-lamp）**
- `gen_tiles.mjs::drawLamp()`：墙座 + 支架 + 灯罩；亮起时灯罩暖黄 + 三层光晕
- 编辑器「🪟 窗/开关」分类里多一项；放置自带 `wall:true`（可贴墙带）、可拖动、点它也能切房间灯

**③ 验证（临时 hub，未碰存档）**
| 状态 | window | switch | wall-lamp |
|---|---|---|---|
| 白天 / 关灯 | `window` | `switch` | `lamp-off` |
| 夜间 / 关灯 | `window-night` | `switch` | `lamp-off` |
| 夜间 / 开灯 | `window-night` | `switch-on` | `lamp-on` |
| 白天 / 开灯 | `window` | `switch-on` | `lamp-on` |

（实机是北京时间 18:00 后，所以"放置后"直接就是 `window-night`；切「☀ 白天」预览立刻回 `window`。）


### v53 阴影名称打不了字：900ms 自动刷新把输入框重建了
**原因**：侧栏每 900ms 跑一次轻量刷新 → `renderShadows()` 每次 `box.innerHTML = ""` 重建整个"选中块编辑面板"，刚聚焦的名称输入框就被销毁 → 每按一个字都丢焦点；而且 `onchange` 需要 blur 才触发，面板一重建连保存都不会发生。

**改法**
- `editingNow()`：若当前焦点在 `#ed-shadow-edit` / `#ed-switch-edit` 里的输入控件上，`renderShadows / renderObjects / renderLights` 这一轮**直接跳过**
- 编辑面板按 `box.dataset.sid` 记住"这是哪一块"：同一块选中时只**原地更新**数值（`data-out` / `data-inp` 标记），不再重建输入框
- 名称输入改成 `oninput` + 400ms 防抖保存（不再依赖 blur），且不调 `refresh()`

**验证**：选中一块 → 聚焦名称框 → 逐个输入 4 个字（中间跨过一整轮自动刷新）→ 焦点仍在输入框、内容完整保留；hub 里该块 `label` 已写入。


### v54 新开关点不了 + 删掉旧开关
**为什么点不了**：游戏页的点击链路（`bindClick` → `toggleSwitchAt`）一直是通的，但**编辑器页**的点击被 `mapEditorPointerDown` 先接走了（编辑语义=放置/选择/移动/删除），所以站在编辑器里点开关毫无反应 —— 你看到的"新开关点不了"就是这个。

**改法**
- 编辑器物品层：选择工具（或"放置"但没选资产）点到 `switch` / `wall-lamp` → 直接调同一个 `toggleSwitchAt()` 切房间灯，同时把它设为选中对象（右侧可继续改"控制房间"），并弹一个"起居：开灯"的 toast
- 暴露 `__mapEditor.toggleSwitchAt(wx, wy)` 方便自动化验证
- 顺带修：`renderObjects()` 里 v53 插守卫时把 `var list = M.objects();` 挤到同一行，导致侧栏报 `list is not defined`（编辑器打开就抛异常），已恢复

**删旧开关**：调试台「③ 场景控制」里的 `💡 开灯 / 🌙 关灯` 两个按钮连同事件一起删除（`__officeCtl.setLights()` 接口保留给自动化）。地图上的开关/壁灯现在是唯一的开关入口。

**验证**（用你存档的副本，两个页面都试）
| 位置 | 操作 | 结果 |
|---|---|---|
| 编辑器 | 选择工具点开关 | `bedroom` 灯 false→true→false，`switch`↔`switch-on`、`lamp-off`↔`lamp-on` |
| 游戏页 | 鼠标点开关 | `switch`→`switch-on`+`lamp-on`，再点回灭 |
| 调试台 | — | `#dbg-light-on` / `#dbg-light-off` 已不存在 |


### v55 为什么"还是没变化"：点开关变成了"又放一个开关"
上一版只在**选择工具**下才切灯；而编辑器默认是「放置」+ 刚选过的资产（`switch` 还亮着），于是：

1. 点开关 → 走"放置"分支，在同一个位置又叠了一个开关 → 看起来毫无变化（其实物件数在涨）
2. 编辑器里 `showBubble` 被屏蔽 → 连"开关灯"的提示都没有

**改法**
- 编辑器物品层：**除了「移动 / 删除」，任何工具点中 `switch` / `wall-lamp` 都直接切灯**（并选中它），不会再多放一个
- 点中时加**视觉反馈**：开关位置闪一圈暖色光晕（`flashAt`，游戏页/编辑器都可见）+ 编辑器底部状态行显示「💡 起居：开灯」（2.6 秒后恢复保存状态）
- 顺带修 v53 引入的 `renderObjects` 结构破坏（`list is not defined`，会让侧栏列表直接崩）

**验证**（你存档的副本，模拟"放置工具 + 已选 switch"这个原始状态）
| 操作 | 灯 | 开关贴图 | 物件数 |
|---|---|---|---|
| 点一下 | bedroom: on | `switch-on` / `lamp-on` | 3（不变，没多放） |
| 再点 | bedroom: off | `switch` / `lamp-off` | 3 |

像素级对比也做了：点击前后截图字节不同（124188 vs 128130），确实有变化。


### v56 旧开关原来真是"代码写死的"——已删除
你猜得对。墙带上那三块米色面板 + 橙色拨杆**不是素材**，是 `placement.js::buildLights()` 里用 `add.rectangle` 画死的：

```js
var switchDefs = [ {room:"office",x:24.2}, {room:"bedroom",x:8.6}, {room:"bath",x:15.2}, {room:"kitchen",x:24.4} ];
switchDefs.forEach(sd => {
  var plate = s.add.rectangle(sd.x*TILE, sy, 18, 28, 0xe8e4da).setDepth(60001).setInteractive(...);  // 米色面板
  var lever = s.add.rectangle(..., 10, 10, roomLights[sd.room] ? 0xf5b942 : 0x8a8578).setDepth(60002); // 橙色拨杆
  plate.on("pointerdown", ...切房间灯...);   // 所以它能点、但既不能移也不能删
});
```
同一函数里还有 3 盏 `add.triangle` + `add.circle` 画死的**吊灯**（墙带上的橙色三角）。

**v56 删除**
- `switchDefs` 整段（4 个固定位置的面板/拨杆 + 点击逻辑）
- 吊灯那 3 盏（triangle 灯罩 + circle 灯泡）
- 都换成注释说明：要灯就用物品层的 `switch` / `wall-lamp`（可摆、可拖、可删、可点）

**顺带修**：删完后 `*/  }` 这种"注释和右花括号同一行"会让压缩器把整行当注释删掉 → 压缩产物语法报错（build 会退回未压缩版）。把 `}` 单独放一行解决。

**验证**（你存档的副本）
- 墙带对象清单：只剩 `window / switch / wall-lamp` 三个素材（+ 全屏 ambient），长方形/三角/圆全部消失
- 点素材开关仍正常：`bedroom` 灯 on/off、贴图 `switch-on ↔ switch`、`lamp-on ↔ lamp-off`
- `check.mjs` 新增 2 条门禁：`placement.js` 不得再出现 `roomSwitches / switchDefs / ceilingLamps`、不得再用 `add.rectangle(sd.x) / add.triangle(lx)`


### v57 "突然删不掉、存不了"：hub 被我重启 + 失败没有自愈
排查结论：**你的存档没坏**（当时 35 条，含 3 个 switch、9 个 shadow）。真正原因是：

1. 我为了验证，反复起停 4321 上的 hub；你页面开着的时候 hub 恰好不在，写入就失败
2. 失败的提示只有侧栏底部一行小字（很容易看不见），于是表现为"点了没反应/删了又回来"
3. 失败后只在**同一次会话内**补传一次，之后要刷新才再试

**这轮修的三件事**
- **失败自动重传**：`scheduleMirrorRetry()` —— 保存/删除失败后每 3 秒重试（最多 20 次），hub 一恢复就自动补上。实测：拦截 fetch 模拟掉线 → 删除（本地生效，状态行红字）→ 恢复网络 → 4.5 秒后 hub 自动变成 34 条、状态行变绿
- **🩺 自检按钮**（编辑器底部）：一次说清 hub 能不能读、能不能写、本地与 hub 条数是否一致、最后一次保存的错误，并用弹窗给出 JSON。以后出问题点它就能定位
- **列表不再无脑重建**：`renderObjects/renderLights/renderShadows` 加了内容签名（`ui.objSig` 等），内容没变就不动 DOM；鼠标停在侧栏上时也暂停刷新 —— 之前 900ms 一次的重建会把正在按下的 ✕ 吃掉（这也是"删除有时没反应"的一半原因）
- 另外：侧栏底部显示 **build 哈希**，全局脚本错误会红字提示

**验证**：列表 ✕ 删除（35→34）、画布删除工具删墙上的开关（34→33）、保存按钮（✔ 已写入 hub）、离线→自动补传、自检全绿。

**注意**：我测试期间会临时停掉 4321 的 hub，这就是那几次"存不上"的来源。现在恢复运行了（你的 35 条都在）。


### v58 "坐标越界"保存失败：一条脏数据把整批 set 打回
**原因**：hub 的 `validateMapItem` 要求每条 `x∈0..56 / y∈0..30`，**只要有一条越界，整批 `set` 就 400 回滚**。而客户端把这份"含脏数据"的列表存在 localStorage 镜像里，于是每次保存都是同一个错误 —— 刷新也没用（镜像还在）。
hub 侧我查过了：35 条**全部合法**，所以脏数据只存在于你浏览器那份镜像里（某个时刻被写进了越界坐标，比如拖到边界外）。

**修法**
- 新增 `sanitizeCustomLayer()`：把 `x/y` 夹回 `0..56 / 0..30`（保留 2 位小数），丢掉 `a` 缺失的脏条目，并记录"改了哪几条"
- 在**三条写入路径**上调用：`saveEditMap()`（保存/删除/放置）、`flushLocalMirror()`（重连补传）、`scheduleMirrorRetry()`（失败重试），以及 `adoptLocalMirror()`（采用本机镜像时）
- 修正后照常保存，`edit-log` 里会写明 `已修正越界坐标：chair y 41.9→30`

**验证**（临时 hub + 往镜像里塞 `{a:"chair", x:-3.2, y:41.9}`）
| 步骤 | 结果 |
|---|---|
| 刷新页面 | 状态行直接是 `✔ 已写入 hub（38 条）`，不再报越界 |
| hub 里那条 | `{a:"chair", x:0, y:30}`（自动夹回范围） |
| 自检 | `hubReachable:true, writeOk:true, 本地=hub=38` |

**你这边怎么恢复**：硬刷新（`Ctrl+F5`）拿到新构建（`office.js=c2a4e7c1`），点一次「💾 保存」—— 那条越界记录会被自动夹回范围内并写进 hub。如果状态行还报错，点「🩺 自检」把弹窗内容发我。


### v60 墙带上画不了墙（连带修掉"id 重复"导致的整批保存失败）
**现象**：门洞那格（顶部 48px 墙带）用「地形层 → 墙」画笔点不动。

**两个原因**
1. 墙带在格子坐标里是 `ty = -1`，而地形画笔的门禁只认 `ty ≥ 0` → 落笔直接被丢掉
2. 更关键：瓦片条目的 id 是按 `tx/ty` 拼的（`eter…`），**同一格重复刷就会撞 id** → hub 报 `id 重复: eterbawa` → 整批 `set` 被拒 → 表现为"画了没反应 / 存不上"

**改法**
- 地形层允许在墙带落笔：条目存 `{a:"terrain", t, x, y:0, band:true}`，叠加层画在 `0..48px`
- `terrainEdits` 的键带上 `,band`，墙带那格和 y=0 那格互不覆盖
- 墙带里也能**按住拖着连续刷**
- 瓦片 id 改成 `…+序号+随机`，彻底避免撞车；`sanitizeCustomLayer` 增加**同格去重**（同 `a/x/y/band/t` 只留最后一条）与 **id 去重**
- 擦除把 `ty = -1` 折算成 `y = 0`，所以墙带上的墙也擦得掉

**验证**（临时 hub）
| 操作 | 结果 |
|---|---|
| 地形层画笔在墙带从 x=10 拖到 15 | hub 出现 `10,11,12,13,14,15` 六条 band 地形，`lastSave ok` |
| 门洞中心像素 | `(51,60,80)` = 墙色（之前是 `(188,171,142)` 路面色） |
| 橡皮擦掉 x=12、13 | 两条从 hub 消失，像素变回路面色 → 门洞恢复 |


### v61 阴影删不掉单个：我上一步的去重误伤
**原因**：v60 为了修"同格重复"给 `sanitizeCustomLayer` 加了"同 a + x + y + band 只留最后一条"，但它**没区分条目类型** —— 而阴影块、隐藏记录、移动覆盖天然会共用坐标（阴影可以两块同起点；hide 全是 `x:0,y:0`）。于是保存时这些条目被"去重合并"，你删掉一块再保存，另一块（或它自己）又被并回来，看起来就是"删不掉单个"。

**改法**
- 同格去重**只对贴片**（`a === "floor" || "terrain"`）生效；其他类型完全不去重
- 其余保护（坐标夹取、id 去重）不变

**验证**（用你存档的副本）
| 操作 | 结果 |
|---|---|
| API 删自建块 `smw8wdd0lde` | 列表 3 → 2，hub 里该条消失 |
| UI 点列表里的 ✕（滚进视口真点） | 该块从列表与 hub 同时消失，`lastSave ok` |
| 连删多块 | 每次只少一块，其余不受影响 |


### v61 补记：那次误伤还把 11 条 hide 记录吃掉了（已恢复）
v60 的"同格去重"没区分类型，把**坐标相同的隐藏记录**也合并了 —— 你原本 12 条 `hide`（5 盏路灯 + 邻居三家 + 花/bush）被并成 1 条。

- 从 `office/hub/map.backups/map-20261109-171118-40条.json`（hide=12 的最后一份）里取出缺失的 11 条，按 id 去重后合并回当前存档
- 现在存档 **41 条**：`floor 5 / hide 12 / move 3 / shadow 8 / switch 3 / terrain 8 / wall-lamp 1 / window 1`
- 同格去重已限定为只对 `floor` / `terrain` 生效，并加了 check 门禁防止再次误伤


### v62 灯源列表显示成物品列表：缓存串了
**现象**：光照层 → 灯源，标题写着"灯光列表（0 盏）"，下面却是 `bench-park / oak-tree / flowers …` 这些物品。

**原因**：v57 为了防"900ms 刷新吃掉点击"，给三个列表加了内容签名缓存（`ui.objSig / ui.lightSig / ui.shadowSig`）。但三者**共用同一块 `#ed-objs` 容器** —— 从"物品层"切到"光照层"时，`renderLights()` 算出签名和上次相同（灯数据没变）就直接 return，DOM 里留着的还是物品列表，只有标题被 `refresh()` 改成了"灯光列表"。

**改法**：每个渲染函数先认"这份 DOM 现在装的是哪一类"，类型一变就清空该类签名强制重画：
```js
if (ui.listKind !== "light") { ui.listKind = "light"; ui.lightSig = ""; }
```

**验证**（真点 tab 来回切）
| 步骤 | 标题 / 内容 |
|---|---|
| 物品层 | 物件列表（视口内 40 件）/ nightstand… |
| 光照层 | **灯光列表（7 盏）/ 灯 1 r3 a0.5 @30.5,15.8 …** |
| 阴影区域 | 阴影块（5 块）/ 卫浴 自建 7×15 … |
| 回灯源 | 灯光列表（7 盏）✓ |
| 回物品层 | 物件列表（40 件）✓ |
| 再进光照层 | 灯光列表（7 盏）✓ |


### v63 列表点行 → 直接定位到图上
之前点列表只是"选中"，眼睛还得自己在地图里找。现在三处列表（物件 / 灯源 / 阴影块）点一行：

- 镜头**平滑飞过去**（`cam.pan(320ms, Sine.easeInOut)`），并**夹在地图边界内**，不会推到墙带外
- 目标位置**闪一圈暖光**（复用 `flashAt`），远处也能一眼看到
- 同时保持原来的选中行为（右侧面板照旧显示该对象的参数）

实现（`editor-api.js`）
- `meFocusAt(wx, wy)`：`stopFollow()` + pan + flash
- `meLocateObject(key)`：按 `furnitureKeyOf` 找场景精灵，定位到它脚下
- `meLocateLight(id)`：灯的格子坐标 → 世界像素
- `meLocateShadow(id)`：取矩形中心
- 公开为 `__mapEditor.focusAt / locateObject / locateLight / locateShadow`

**验证**（真点列表行）
| 列表 | 点之前镜头 | 点之后 |
|---|---|---|
| 灯源（第 7 盏 @34.4,26 → 世界 1651,1304） | (0,0) | (1051,720)，且 `selectedLight = bl_7` |
| 阴影块（卫浴 7×15） | (1051,720) | (24,24) —— 移到该块中心 |
| 物件 | — | 同 `M.focus()` 选中 + 定位 |

说明：物件列表是"视口内 40 件"，镜头飞走后列表会按新视口重算，这是预期行为。

### v64 灯光被阴影盖住 + 厨房灯影响草地阴影
**① 灯画在阴影下面**
- 灯池（`lightPools`）、自定光源（`renderCustomLights`）原来都是 `depth 50000`，而阴影区域画在 `59100` → 阴影压在光上面，暗区里的灯完全看不见
- 改：灯统一提到 **59200**（阴影之上、HUD 之下）。实测场景里 `pools/custom = 59200`，`shadowGfx = 59100`

**② 没有房间归属的阴影块跟着"任意房间"一起亮**
- 原来 `room === null` 时取 `lightsOn === true || anyRoomOn`，而任何单房间开灯都会让 `anyRoomOn` 为真 → 你厨房开灯，草地那块（`smw928rcz8p @26,0 13×16`，不在任何房间矩形内，所以 `room = null`）也跟着从 0.7 变 0.5
- 改：有归属 → 只看那个房间；没归属 → **只有四个房间全开**（`allRoomsOn`）才切到"开灯"档

**验证**（用你存档的副本）
| 操作 | 卫浴 | 起居 | 厨房 | 办公室 | 草地（全局） |
|---|---|---|---|---|---|
| 全关灯 | 0.6 | 0.6 | 0.6 | 0.6 | 0.7 |
| **只开厨房** | 0.6 | 0.6 | **0.15** | 0.6 | **0.7（不变）** |
| 全屋开灯 | 0.2 | 0.2 | 0.15 | 0.15 | **0.5** |

想让草地那块更亮，选中它把「开灯」那档从 0.5 调小（或直接点「跟随灯 → 全局」保持全屋联动）。


### v65 画布角标：一眼看出跑的是哪个构建
连着几次"没变化"其实是**页面还在用旧构建**。为了不再靠猜，编辑页画布左上角常驻一行：

```
build dac06da9   光 59200   影 59100
```

- `build` = 当前 `editor.js` 的 hash（和 `?v=` 一致）
- `光 / 影` = 灯池与阴影图层的实际 depth（v64 修复后应为 **59200 / 59100**；旧构建是 `50000 / 59100`，光会被压住）

**验证（最新构建，夜里）**：花园的暗区里能看到两个暖色光斑穿出来 —— 说明"光在阴影之上"生效。
`check.mjs` 加门禁：`placement.js` 里不许再出现 `setDepth(50000)`、必须 `59200`、必须有画布角标。

**注意**：草地那块阴影（`smw928rcz8p`）你自己的设定是 `夜 0.7 / 开灯 0.5` —— 全屋开灯时它只从 0.7 降到 0.5，**肉眼看差别很小**。想明显变亮就把它「开灯」调到 0.15~0.2，或给它指定一个房间。


### v66 灯光真的被"滤镜"压着（不是阴影）
角标显示 `影 59100 / 光 59200` 已经把阴影排除，但还有两层**全屏滤镜**在灯之上：

- `ambient`（夜间环境光，`placemen.js` 里 `ambientcv` 图）→ `depth 60000`
- `vignette`（暗角，`boot.js` 里 `vignetteTex`）→ `depth 60000`

两者都 ≥ 灯光的 59200，所以整屏被压暗一层，看起来像"灯被阴影盖住"。

**改**：两层都降到 **59150**（阴影 59100 之上、灯光 59200 之下）。最终层次：

```
底图 -100 → 房间阴影 59100 → 环境光/暗角 59150 → 灯光 59200 → HUD
```

**画布角标同步升级**：`build xxx   影 59100   滤镜 59150   光 59200` —— 三个数字一眼就能确认层次对不对。

**验证**（游戏页，夜里，开灯）：花园暗区里的路灯光斑清晰可见（见 `logs/office-v37-shots/map-v66-light-above-filters.png`）；`check.mjs` 新增门禁：`placement.js`/`boot.js` 不许再出现 `setDepth(60000)`。


### v67 灯光不再"叠在阴影上"，而是把阴影挖掉
你指出的问题是对的：之前只是把光 **ADD 叠在暗块之上**，所以有光的位置仍然是"暗底 + 一团光" —— 看起来像被切。

**改法**：阴影从 `Graphics` 换成 **RenderTexture**（depth 59100）：
1. 先把每块阴影用暗色矩形画进 RT（`rt.draw(pen)`，颜色 0x0a1020，alpha 按 夜/开灯/白天 取值）
2. 再把每盏灯的位置用 **`rt.erase(hole)`** 擦掉 —— 用光晕贴图（径向渐变）当"橡皮"，灯越亮擦得越透

于是：**有光的地方阴影被削掉**，光斑边缘自然过渡；再在上面叠一层淡的暖色光（59200）做色温。

最终图层顺序：

```
底图 -100 → 阴影 RT 59100（灯已挖洞）→ 环境光/暗角 59150 → 灯光 59200 → HUD
```

**实测数据**（同一块阴影里）
| 位置 | 阴影 RT 像素 alpha | 屏幕颜色 |
|---|---|---|
| 灯光中心 | 30（几乎清空） | [255,255,234] 暖白 |
| 同块阴影远处 | 204（保留） | [30,43,43] 暗绿 |

全关灯 → 办公室 [74,63,56]（暗）；全开灯 → [146,115,83]（亮）。

坑：这个 Phaser 构建里 `RenderTexture.fill()` 不出图、`scene.make.rectangle/image` 不存在，所以改成 `new Phaser.GameObjects.Rectangle/Image` + `rt.draw/erase`。


### v68~v71 夜色系统重做（效果太差 → 重新设计）
用户反馈"效果太差"，问题拆成四点逐条修：

**① 灯光只是"叠亮"在阴影上 → 改成把阴影挖掉**
- 阴影从 `Graphics` 换成 **RenderTexture(59100)**：先铺暗块（`rt.draw(pen)`），再用 `rt.erase(hole)` 按灯的位置擦洞
- 新增 `lightHoleTex`：256×256 的 **smoothstep 径向渐变**（中心全透、边缘平滑到 0），擦出来的洞是柔和过渡，不是硬圆
- 实测同一块阴影里：灯心 alpha **30**、阴影远处 alpha **204**

**② 房间整屋变成一团团光斑 → 房间灯池不再挖洞**
- 房间亮度只由该块阴影的「开灯」档决定（0.15 左右 = 基本全亮）
- 只有真正的点光源（路灯 / 壁灯 / 自定义光源）在阴影上挖光斑

**③ 街道/户外完全没有夜色（像白天）→ 环境光重新启用，并做成"能擦洞"的 RT**
- `ambientRT`（59150）：整图铺一层夜色（默认 0.42），再把**用户画的阴影区域矩形从里面擦掉**
- 于是：区域自己管明暗（夜/开灯/白天三档），环境光只管没被区域覆盖的地方（街道、户外）
- 实测：全关灯 office `[68,58,51]`、bedroom `[43,41,43]`、street `[139,130,114]`；全开灯 office `[135,103,73]`

**④ 路灯太亮太大 → 数据层收小**
- `gen_map.mjs` 里路灯 `r: 3.0 → 1.8`、`a: 0.5 → 0.45`，重新生成 `map.json`
- 代码里挖洞半径再乘 0.8

最终图层：`底图 -100 → 阴影 RT 59100 → 环境光 RT 59150 → 灯光 59200 → HUD`

截图：`logs/office-v37-shots/map-v71-night-off.png` / `map-v71-night-on.png`（整图，zoom 0.36）


### v72/v73 夜色重做：蒙黑、状态错乱、开灯不亮 三个问题一起修

**① 整图被"蒙了一层黑"且开灯只到 10% 也不亮**
- 原因：环境光是一整块全屏黑，房间没有阴影块时**没有任何东西把这块黑擦掉** → 房间永远泡在黑暗里，开灯档（lit）根本没机会生效
- 修法：**没有被任何阴影块覆盖的房间，自动补一块默认阴影**（`ROOM_RECTS` + `roomCovered()`）
 - 关灯：alpha = `max(0.5, 环境光+0.25)`（≈0.67，明显暗）
 - 开灯：alpha = **0.15**（基本全亮）
 - 用户自己画了块（覆盖房间 >25%）就完全以用户的为准，不叠加
- 实测：办公室关灯 `[38,36,40]` → 开灯 `[82,67,56]`；卧室 `[68,58,51]` → `[141,109,75]`

**② 点"自动"再点"白天"，有块区域莫名亮起来、点"黑夜"回不去**
- 真因：我的补丁留下了**两个同名 `updateAmbient()`**（v71 旧版在 v72 新版后面，覆盖了它），旧版只重画环境光 RT、不重画阴影 RT，于是两层不同步 → 状态错乱
- 修法：删掉旧的重复函数（`updateAmbient` 现在唯一）；**环境光合并进阴影那一层 RT**，一次全量重算：
 ```
 夜色 RT(59100) = 环境光铺底 → 擦掉各阴影区域矩形 → 画各区域暗块 → 点光源挖洞
 ```
 签名（预览模式 + 各房间灯 + 各块浓度 + 各灯参数）不变就跳过重画

**③ 状态机全量回归（同一份存档，5 个状态来回切）**
| 步骤 | 办公室 | 卧室 | 街道 | 正确性 |
|---|---|---|---|---|
| 黑夜+关灯 | 38,36,40 | 68,58,51 | 140,131,115 | ✓ 暗 |
| 黑夜+开灯 | 82,67,56 | 141,109,75 | 140,131,115 | ✓ 房间变亮、街道不变 |
| 自动 | 82,67,56 | 141,109,75 | 140,131,115 | ✓ 与黑夜一致（当前是夜里） |
| 白天 | 156,119,80 | 156,119,80 | 214,195,161 | ✓ 全亮、RT 隐藏 |
| 回黑夜+关灯 | **38,36,40** | **68,58,51** | 140,131,115 | ✓ **与第 1 步完全一致，可逆** |

截图：`map-v73-night-off.png` / `map-v73-night-on.png` / `map-v73-day.png`

**门禁**：`renderNightShadow` 与 `updateAmbient` 都必须只有一份定义（防再次重复），必须有 `ROOM_RECTS` 与 `autoRegions`。22/22 通过。


### v74 "超过上限 400 条"：上限本身设小了
**原因**：`hub.mjs` 里 `MAP_MAX_ITEMS = 400`，而地图是 **56×30 = 1680 格** —— 光把地板和地形各铺满就是 `1680 × 2 = 3360` 条，400 条根本不够。你现在的数据是**真实的**（不是重复脏数据）：

| 类型 | 条数 |
|---|---|
| terrain（墙/水/农田） | 125 |
| floor（地板/路） | 120 |
| oak-tree | 79 |
| hide | 36 |
| light | 11 |
| flowers | 10 |
| shadow | 9 |
| switch / move / 其它 | 10 |

**改法**
- hub 上限 **400 → 6000**（够铺满地形 + 地板 + 大量装饰，仍防滥用）
- 客户端面板文案同步成「上限 6000」
- `check.mjs` 加门禁：`MAP_MAX_ITEMS` 不得低于 4000（防止有人改回去）

**验证（打到你真实的 4321 hub 上）**
- `/api/map` 返回 `max: 6000`
- `saveNow()` → `{ok:true, hub:400}`，状态行 `✔ 已写入 hub（hub 现有 400 条）`
- 之前那条"超过上限 400 条"不再出现

**注意**：hub 是 Node 进程，改完上限必须**重启 hub** 才生效（我已经重启了）。你那边只需 `Ctrl+F5` 刷新页面，然后正常保存即可。


### v75 灰蒙版 + 邻居家重新定位

**① 屏幕中心的灰蒙版**
- 原因：`updateAmbient()` 里这一行 `if (pv !== "day" && nightCfg.ambient != null) target = nightCfg.ambient;` —— 在「自动」模式下**无条件**把目标设成 0.42，于是即使是白天、即使在编辑器里，也整图压一层黑
- 修法：只有显式「🌙 黑夜预览」才用自定义强度；**编辑器「自动」= 0（不加任何蒙版）**；游戏页「自动」才按真实时间
- 验证：`shadowRT.visible === false`（白天/编辑器无任何夜色层）

**② 邻居家不见了 —— 被 5 条 hide + 14 条 move 搞散**
排查发现两个原因同时存在：
- `id:homeCat` / `id:homeChief` / `id:homeDoc` 三条 hide 把**房子本体**藏了
- 另有 14 条 `move` 把邻居的家具（catBed/catTable/catGramo/chiefTable/chiefFridge/docDesk/docChair…）**全挪到了北排 y=1~13**，房子却在南排 y=19.6
- 还漏了两条：`id:docDesk` / `id:docChair` 被单独 hide

**修法（按新地图重新定位，不用旧建筑）**
- 删除 5 条邻居 hide（houseCat/Chief/Doc + docDesk + docChair）
- 删除 17 条邻居相关 move 覆盖 → 家具回到 `map.json` 定义的南排位置（y=20~27）
- `NEIGHBOR_HOMES` 的镜头聚焦点改成新地图的 living zone 锚点：
 ```
 cat   → 42.4, WALL_H+23.2     chief → 48.5, WALL_H+23.6     doc → 53.0, WALL_H+24.0
 ```
 （原来是旧的 43/48/53 × 24，且漏掉了 `WALL_H` 偏移）

**验证**
| 检查 | 结果 |
|---|---|
| 三栋房子 | `homeCat/house-modern/homeDoc` 全部 `visible: true`，位于 (2050,1013) (2338,1013) (2587,1013) |
| 室内家具格子 | catBed (41,21)、chiefTable (49,23)、docDesk (53,23)、docChair (53,24)、catGramo (45,20) |
| 邻居 hide | 0 条 |
| 灰蒙版 | `shadowRT.visible === false` |

截图：`map-v75-neighbors.png`（三户齐全）、`map-v75-no-mask.png`（无灰蒙版）


### v76 还原存档 + NPC 定位到床 + 修穿墙 + 加行为

**① 存档还原到"改邻居之前"**
- 从 `map.before-neighbor-fix.json` 恢复：**721 条**（三座旧房子仍是 `hide` 状态 —— 符合"不要旧房子"）
- 未恢复：我上一轮擅自取消的 17 条 move/hide（那次是错误理解）

**② 邻居定位到各房间的床（不再依赖旧房子）**
- `NPCS` 删掉 `home/homeZone/indoor` 字段，改成 **`bedAt` 床位格坐标**：
 | NPC | 床 | 格坐标 |
 |---|---|---|
 | 喵酱 | catBed | (41.3, 21.2) |
 | 村长 | chiefBed | (47.5, 25.6) |
 | 博士 | docBed | (54.2, 26.4) |
- `buildNPCs` 不再 `s.hostMap[def.home]`（房子被 hide 也不影响 NPC）
- 实测出生位置：`cat world(2005,1115)` / `chief (2304,1325)` / `doc (2616,1368)`，与床位误差 ≤1 格

**③ 穿墙修复（根因）**
- 原来 NPC 走动是 `tweens.add({x,y})` **直线插值** —— 完全不看碰撞，必然穿墙
- 新增 `npcWalkTo(npc, tx, ty, speed, onDone)`：调 **`astar()`** 拿路径，一格一格推进；无路径就放弃不动
- `npcWalkHome()`：走 A* 回到床位，再躺下

**④ 自主行为系统**
| 行为 | 表现 |
|---|---|
| `sleep` | 身体压扁（scaleY 0.45）+ 头顶飘 `z z` |
| `idle` | 站着发呆 |
| `wander` | 走 A* 到附近格子 |
| `look` | 原地张望 |

状态机：`home`（到点在床睡 → 偶尔起身在床边活动 → 回去睡）↔ `roaming`（出门沿街逛 → 发呆/张望）。按 `homeHours`（喵酱 23-7、村长 20-8、博士 21-13）自动切换；睡着的 NPC 不会被叫醒聊天。

**⑤ 验证（连续观察 20 秒 / 每 2.5 秒采样）**
```
cat:roaming@41,12 → 46,11     穿墙次数: 0
chief:home@48,26（床边）
doc:home@54,27（床边）
```
全程没有任何 NPC 落在阻挡格上。


### v77 灰蒙版真因 + NPC 睡到正确的床

**① 灰色蒙版的真因：缩到最小时相机视口 > 地图**
- 缩小到 0.6 以下后，`worldView`（世界可视范围）比地图 2688×1488 还大 → 相机 `setBounds` 钳制后四周露出**画布底色**（就是那层灰）
- 修法两条：
 1. `minZoomNoVoid()` = `max(cam.width / W, cam.height / H)`，缩放下限锁在"视口刚好等于地图" → 实测 `zoom 0.516 = minAllowed 0.516`，`voids: false`
 2. `#office-parent` 加 `background:#1b2233`（地图夜空色），万一露边也不是灰色

**② 两个 NPC 挤一间房、不在床上 —— 三层原因**
1. **村长家和博士家根本没有床**：`map.json` 里只有 `catBed`，我上一版写的 `chiefBed`/`docBed` 坐标是凭空造的
 → `gen_map.mjs` 新增 `EXTRA_BEDS`，给两家补真床：`chiefBed @47.4,26.2`、`docBed @54.3,22`
2. **喵酱的床被一条 move 挪进了墙里**：存档里有 `{"a":"move","k":"id:catBed","x":43.7,"y":1.8}` —— 43.7,1.8 是北排墙格，所以喵酱"睡在墙里"（检测显示 `onWall: true`）
 → 删掉 4 条把猫家家具搬进北排的 move（catBed/catStand/catTable/catGramo）
3. **床位坐标写死**：NPC 原来用硬编码 `bedAt`
 → 新增 `npcBedPos(def)`，**运行时从 `mapdata.furniture` 按 bed id 查真实坐标**；床被编辑器挪了也跟着走
 → `npcWalkHome()` 先 A* 到床旁，再精确吸附到床中心

**③ 验证（24 秒连续采样）**
```
cat:home@41,22   chief:home@47,27   doc:home@54,23     穿墙: 0
```
三人分别在**各自房间的床上**，全程无穿墙；缩小到最小 `voids: false`（无灰边）。

截图：`logs/office-v37-shots/map-v77-zoom-min.png`


### v78 还原房间布局 + 缩到最小不再有灰边 + 每人固定床位

**① 家具被扔到屋外 → 已还原**
排查发现存档里有 **19 条 move** 把邻居家具从南排房间搬到了北排（y=1~13）：

| 被搬走的 | 原位置（正确） | 被挪到 |
|---|---|---|
| catBed | (41.3, 21.2) | (43.7, 1.8) ← 北排墙里 |
| catStand / catTable / catGramo | 41~45, 20~27 | 45~47, 7~11 |
| chiefCounter / chiefTable / chiefChair1/2 / chiefStove / chiefFridge | 46~50, 20~27 | 51~54, 1~4 |
| docDesk / docChair / docPotion / docArm | 52~55, 20~27 | 46~53, 20~25（串到别人家） |
| plant-office / crown-cushion / curtains / book-stack | 南排室内 | 北排 3~14 |

- 从 721 条备份恢复，**删掉这 19 条 move** → 家具全部回到 `map.json` 定义的房间位置
- 花园长椅/井的 3 条 move 是布景调整，保留
- 三座旧房子仍是 `hide`（你明确不要）

**② 不再私自加家具 / 不自造床**
- 撤回 `gen_map.mjs` 里的 `EXTRA_BEDS`，并从 `map.json` 删掉我之前加的 `chiefBed` / `docBed`
- 现在全图只有 `bedA`（办公室）和 `catBed`（喵酱家）两张真床

**③ 每个邻居固定一个床位（全部用房间里已有的家具）**
| NPC | 固定床位 | 位置 |
|---|---|---|
| 喵酱 | `catBed`（床） | (41.3, 21.2) |
| 村长 | `chiefChair1`（餐椅） | (47.4, 23.3) |
| 博士 | `docArm`（扶手椅） | (54.3, 27.2) |

`npcBedPos()` 运行时按 id 从 `mapdata` 查坐标 → 床/椅子被编辑器挪了，NPC 也跟着换位置。

**④ 缩到最小的灰边（这次真修好）**
- 原来只限制 zoom 下限，但 `setZoom` 后相机 `scroll` 仍可能停在越界位置 → 露边
- 新增 `clampScroll(cam)`：每次缩放后把 `scrollX/scrollY` 夹进 `[bounds]`
- 实测：缩到最小 `zoom 0.516`，`view 2418×1488` ≤ `bounds 2688×1488`，`overflow 0,0`，**无灰边**

**⑤ 验证**
```
喵酱家 inside=3 / outside=[]      全部家具在室内
村长家 inside=6 / outside=[]      （stallA 是市集摊位，不属任何房间）
博士家 inside=5 / outside=[]
NPC: cat:home@41,22  chief:home@47,24  doc:home@54,28
```
截图：`logs/office-v37-shots/map-v78-zoom-min.png`


## v84 · NPC 动机层（2026-11-13）

- 每只 NPC 三条动机条：`hunger`（饿了→cook/dining/fridge）、`social`（无聊→串门/市集/花园）、
  `energy`（困了→回家睡觉），`scheduleNpc` 每跳涨 0.8~2.8，触发阈值 72/78/85，触发后回落
- 触发时气泡说「为什么去」（模板口气×内容组合，`npcSay` 4.5s 淡出、跟随 NPC 移动）
- 与原 homeHours 作息叠加：在家/睡觉时段不触发外出动机
- 调试：URL `?debug-awake=1` 强制全员醒着；控制台 `__officeNpcs()` 返回动机/台词/位置只读快照
- headless 300s 实测 6 次动机台词自然触发（"好像闻到饭香了""去找村长聊两句"…）
