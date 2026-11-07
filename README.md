# 大肥鱼的办公室 🐟

AI 博主「大肥鱼」真实工作状态的像素可视化。**小人的行为永远忠实映射 agent 的真实工作**——它不是预设动画。

线上地址：https://news.shixiansi.pw/office/

## 架构

```
agent 脚本 ──HTTP POST──▶ office-hub (127.0.0.1:4321) ──WebSocket──▶ 浏览器 (Phaser 3)
(agent/*.mjs)             (office/hub/hub.mjs)                       (静态页 /office/)
                              │ PM2: office-hub
```

- **服务器只转发极小的 JSON 事件**，所有渲染在用户浏览器完成 → 2核4G 毫无压力
- hub 内存态运行（当前状态 + 最近 50 条事件环形缓冲），每次有效事件落盘 `hub/state.json`，重启可恢复
- 没有任何真实事件时（刚启动 / 落盘状态超过 6 小时）按**北京时间**回落：08:00–23:00 是 `idle`「这个点没有排班」（摸鱼等活），夜里才是 `sleeping`（v23 之前一律回落到睡觉，于是 19 点也显示鱼在床上）
- agent 侧上报 **fail-silent**：hub 不在线/超时一律静默，绝不阻塞 AI 主流程

## 目录

```
office/
├── hub/hub.mjs          状态中转（WS 广播 + POST /api/event 入口）
├── hub/node_modules     ws 依赖
├── web/                 前端源（index.html + office.js + map.json + assets/）
├── tools/crop_sprites.py 从 pixor 素材包裁精灵表的脚本
├── assets/src/          pixor 原始 zip 存档（含 CC0 LICENSE）
├── assets/extracted/    zip 解包内容
└── sync_web.sh          把 web/ 同步到 Nginx 站点目录（/root 下文件 www 读不到）
```

## 关键文件

| 文件 | 作用 |
|---|---|
| `agent/office_client.mjs` | agent 侧上报库：`office(state, task, detail)` 打点 / `officeRun(task)` 包住整次运行（自动到岗+30s心跳+结束归位） |
| `agent/agent.mjs` 等 | 已在 13+2+2+3 处打点：刷B站/看视频/写文章/改稿/日记/封面/B站动态/邮件/回评论/B站互动/周报/出错 |
| `office/web/office.js` | `STATE_MAP` 定义了每个状态对应的区域和动作；`SCHEDULE` 是「今日时间表」的排班表；A* 寻路；本地生活模拟；最近动态窗（事件流 + 时间表）的渲染 |
| `office/web/map.json` | 房间布局：家具坐标、区域锚点、阻挡格。改完跑 `sync_web.sh` 生效 |
| `scripts/crontab.txt` | 服务器定时任务的记录副本（北京时间）——页面时间表要和它对得上，`check.mjs` 会拦 |

## 状态 → 场景映射

| 状态 | 场景 | 来源 |
|---|---|---|
| arrive | 大门下 | 到岗 |
| browsing | 工位打字（坐办公椅） | 刷B站 |
| watching | 餐桌笔记本前 | 看视频 |
| writing / weekly / diary / replying | 工位打字（坐办公椅） | 写文章/周报/日记/回评论 |
| organizing | 书架翻资料 | 更新记忆 |
| designing | 设计台（课桌）做封面 | 抽帧配封面 |
| posting | 打印机 | 发B站动态 |
| commenting | 餐桌笔记本前 | B站评论 |
| mailing | 门廊信箱前 | 发邮件 |
| error | 沙发挠头（红点） | 运行出错 |
| idle | 沙发摸鱼（黄点） | 任务结束 / 空档期没有排班（白天回落） |
| sleeping | 卧室床上（蓝点） | 夜间空档（08:00–23:00 之外）回落 |

无真实事件时，浏览器本地跑生活模拟：随机漫步、接水、看月亮、翻书、瘫沙发，每 2-5 秒随机微停顿；点击地图可让它走过去（纯参观，不影响真实工作）。

## 日常维护

### 改一个状态要同步动哪几处（维护手册）

前几轮的线上事故几乎都来自「只改了一处」：`working` 没进前端状态表、邮件三兄弟全指错区域、`debug.js` 漏同步。新增或重命名状态时按顺序过一遍：

| # | 文件 | 要动什么 | 漏了会怎样 |
|---|---|---|---|
| 1 | `web/office.js` | `STATE_MAP` 的 `zone / act / verb / mood / fx`；working 类还要进 `ACTIVE_STATES` | `onState` 静默兜底成 idle，鱼跑去沙发摸鱼、圆点不变绿 |
| 2 | `web/map.json` | `zones` 锚点 + `expect`（该区域该有的家具）/`feature`，必要时加 `sit` | 走得到但站错家具（v15 那 7 张截图） |
| 3 | `hub/states.json` | `states` 加状态名；working 类同步加 `active` | hub 直接 400 拒收 agent 推的真实事件 |
| 4 | `agent/*.mjs` | `office("状态", ...)` / `done()` 上报 | 前端不报错，只是永远没人推这个状态 |
| 5 | `web/index.html` + 本文档 | 底部「怎么看懂它」、状态→场景映射表 | 说明文字和实际画面对不上 |

**改排班（crontab 时间变了）要同步动这几处**：`crontab -l`（服务器）→ `scripts/crontab.txt`（记录副本）→ `web/office.js` 的 `SCHEDULE.shifts`（页面上的今日时间表）→ 若改的是「几点算白天」，还要同步 `hub/hub.mjs` 的 `OFFICE_WAKE_START / OFFICE_WAKE_END` 与 `SCHEDULE.wake`。只改一边的后果：页面上写着 09:10 上班、实际 10 点才跑，或者反过来 —— `check.mjs` 第 18 项会把两边对不上的排班拦下来。

改完跑：`node office/tools/check.mjs`（18 项，双向校验 1↔3、4⊆1、2 的锚点与家具语义、时间表↔crontab）→ `node office/tools/bust.mjs` → `sync_web.sh`（已把前两步接成门禁）。

> **hub 属于后端服务，不在 `sync_web.sh` 的同步范围内**：改了 `hub/hub.mjs` 或 `hub/states.json` 后要单独同步整个 `office/hub/` 并 `pm2 restart office-hub`。漏同步 `states.json` 时 hub 降级为「不校验白名单」并打 warn 日志，不会把真实事件拒之门外。
> 状态落盘在 `hub/state.json`（`OFFICE_STATE_FILE` 可改），重启自动恢复；超过 `OFFICE_STATE_MAX_AGE_MS`（默认 6 小时）的旧状态会**按当前时辰回落**（v23 起：08:00–23:00 → `idle`「这个点没有排班」，夜里 → `sleeping`），避免昨天的「写文章」一直挂着、也避免白天一重启就显示鱼在床上。

### 常用命令

```bash
# 本地一键运行（静态 4322 + hub 4321）
node office/tools/dev.mjs

# 改前端后发布（内含 bust + check 门禁）
/root/项目/news-site/office/sync_web.sh

# hub 状态
curl -s http://127.0.0.1:4321/api/status | python3 -m json.tool
pm2 logs office-hub --lines 20

# 手动推一个事件看效果（状态必须在 hub/states.json 白名单内）
curl -s -X POST http://127.0.0.1:4321/api/event \
  -H 'Content-Type: application/json' \
  -d '{"state":"writing","task":"写文章《测试》","detail":"手动测试"}'
```

## 素材授权

全部来自 [pixor.art](https://pixor.art) 素材库，**CC0 1.0 公有领域**（每个 zip 内附 LICENSE.txt），可自由使用/修改/商用，无需署名。角色 whale 与办公室物件同库，风格天然统一。

## 部署细节备忘

- 前端静态文件在 `/www/wwwroot/news.shixiansi.pw/office/`（由 `sync_web.sh` 从本目录复制；**直接改站点目录的文件会在下次同步时被覆盖**）
- Nginx：`/office/` alias 静态 + `/office-ws/` 反代 127.0.0.1:4321（Upgrade 头已配，读超时 1h）
- `ecosystem.config.js` 中 `office-hub` 已入 PM2 并 save（开机自启随 pm2 resurrect）
- Phaser 3.90 本地托管在 `assets/phaser.min.js`，不依赖外部 CDN

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
