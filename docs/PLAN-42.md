# AI 小镇 · 地图布局方案（第 42 轮交接）

> 给"新开一个窗口接手"用。**先读这份，再动任何坐标。**
> 上一轮的交接文档是 `docs/RULES.md`（工具链/硬规则/坑表，仍然有效，本文件不重复）。
> 本文件只讲**接下来要做什么、按什么层级验收**。

---

## 0. 一句话现状

**结构层全绿，观感层未完工。**

```
门禁        32/32 · 0 错误 · 2 条警告（nginx 未配置 + 既定 D1）
地图审计    P0 0 / P1 0 / P2 1（仅既定 D1）
锚点对账    37 个全一致
朝向        0 违规
阴影        9/9
光照        九间房照亮 15%~47%，全部 ≥15% 达标
真重叠      16 处，全部是花园里花草树互叠（§4 豁免项），无一处是家具压家具
房间        9 间（office/bedroom/bath/kitchen/nbCat/nbChief/nbDoc/parkCourt/brickHall）
家具        324 件（落地 264）
```

---

## 1. 这一轮（第 41 轮）实际改了什么

按时间顺序，每条都可 `git log` 查：

1. **判据层去重**（§2 唯一实现）
   - `wallCells` / `wallTouch` / `cellsOf` 收敛进 `map-model`
   - `cellsOf` 改成运行时 `buildBlockedGrid` 的逐字复刻（含 `band` / `bboxRows` / `ox,oy`）
   - `check.mjs` 补回竖墙 `isH` 分叉、`map-audit` 锚点取整改 `round`、`parityWithCheck` 正则修好
   - 代价：判据变严后"突然变红"，修掉由此暴露的 10 处 P1

2. **朝向**：`facing-check` 接进门禁第 32 项（31/31 → 32/32），违规 16 → 0

3. **阴影重做**：删掉"复制本体贴图"的影子层（还修了它没登记 `p.shadow` 导致的累积重影），
   改接触椭圆；`shadow-audit` 从"锁死旧实现"改为正反向断言

4. **hub 根治**：`map.custom.json` 不再钉死在内存，按 mtime 对账 + 1.5s 轮询热重载
   （"改了地图还是旧的"的真因）

5. **模型认 `hide`/`move`**：以前所有判据都在算"游戏里不存在的那张图"

6. **布局**：
   - office 加隔断 `x=15`（门洞 y22..23）切成办公区/会客区
   - bedroom 书桌从房中央挪到东墙，读角排成竖列
   - kitchen 台面拉成一排、餐桌椅归位
   - 三户（nbCat/nbChief/nbDoc）按功能分区重摆，living 锚点坐进真实家具组
   - **新增两间房间 parkCourt/brickHall**（右上角）

7. **删掉三户房子精灵**（`homeCat/homeChief/homeDoc`，初版临时过渡的门面，一直被 hide）

---

## 2. 接下来要做的（按优先级）

### P0 · 把五个维度的验收补全（上一个窗口漏了三层）

这是**上次明确要求过、但没执行完**的。原话在 `docs/RULES.md` §4，
以及 2026-11-17 17:28 的"每一步都用门禁 + 实拍图双重验收"。

| # | 维度 | 工具 | 判据 | 上一轮状态 |
|---|---|---|---|---|
| 1 | 地板 / 道路 / 墙 | `map-annotate.mjs --only=<房>` | 材质逐格正确、道路不压阻挡、墙围合、门洞标黄 | ⚠ 只跑过两间新房，其余七间没跑 |
| 2 | 素材 / 碰撞 | 同上 + `conflictsOf()` | 真错重叠 = 0（同素材互叠豁免） | ⚠ 有 16 处，需逐条确认是豁免还是真错 |
| 3 | 光照 | `light-map.mjs --time=day\|dusk\|night` + `shot.mjs --url="...?overlay=light"` | 每间房照亮面积 ≥15%，光心落在功能区 | ✅ 九个房间全达标（修了 `light-map` 硬编码房间名单后才看得见新房） |
| 4 | 朝向 | `facing-check.mjs` | §5.3 四条规则 0 违规 | ✅ 0 |
| 5 | 阴影 | `shadow-audit.mjs` | 9 项断言 | ✅ 9/9 |

**要补的**：
- 维度 1：七间房逐间跑 `map-annotate --only=`，人眼看地板/路/墙/门洞
- 维度 2：16 处冲突逐条判定，写成清单（哪几处是密林豁免、哪几处要拆）
- 维度 3：补 dusk / day 两个时段（上一轮只跑了 night）

### P1 · 两间新房间还没有"用途"

`parkCourt`（西厢房 4×13）和 `brickHall`（东大厅 6×14）现在有：家具有坐席有灯有地板，
**但没有 zone、没有生活事件、没有归属**。NPC 不会去，鱼也不会去。

需要定：
- 谁住 / 做什么用（书房？会客厅？仓库？）
- 配什么 zone（`host` + `anchor` + `sit`）
- 挂什么生活事件（`hub/states.json` 或 `life.js` 的本地事件表）

**这是当前最大的"空转资产"**：花了两轮做出来的两个房间，玩家走进去没有任何事可做。

### P2 · 布局观感（指标已降级为参考）

`layout-audit` 的"最长空段"**已被证明会误导**（它奖励均布，照着摆就摆成散点）。
只剩三个指标仍有参考价值：贴墙率、最近邻中位、对齐率。

| 房间 | 贴墙率 | 最近邻 | 空段 | 对齐率 | 备注 |
|---|---|---|---|---|---|
| office | 60% | 1.4 | 14 | 100% | 26 宽只有 46 件，密度 15%，空是必然 |
| bedroom | 83% | 1.0 | 12 | 100% | 9×13 装 22 件，再补就是摆地毯 |
| bath | 100% | 1.4 | 6 | 90% | ✓ |
| kitchen | 82% | 1.0 | 8 | 96% | 比上一轮 91% 掉了，因为挪药水架离墙换空段 |
| nbCat | 50% | 1.3 | 8 | 83% | 猫的家只有 6 件 |
| nbChief | 80% | 1.0 | 8 | 100% | |
| nbDoc | 33% | 1.0 | 6 | 100% | 4 格宽书房，靠墙位真的少 |
| parkCourt | 57% | 1.4 | 10 | 91% | 新房间 |
| brickHall | 50% | 1.7 | 12 | 100% | 新房间 |

**判据顺序：实拍图 > 指标趋势 > 门禁。** 不要在没看图的情况下按指标调。

---

## 3. 五个维度的"层级"定义（这次要求的重点）

用户要求"层级重新定一份方案"，这里把验收层级固定下来，**不要再跳层**：

```
L0 数据层    cellsOf 占格 / wallCells 墙格 / hide,move 已应用 / 锚点 round 口径
             ↑ 唯一实现：tools/map-model.mjs。任何工具不许自己算，只能 import
L1 结构层    门禁 check.mjs 32 项 + map-audit P0/P1
             ↑ 断言"合法"，不保证"好看"
L2 碰撞层    conflictsOf 真重叠 = 0（同素材豁免）
L3 观感层    layout-audit 四指标（空段已降级）+ map-annotate 分层图
             ↑ 断言"像不像人摆的"
L4 感知层    光照 light-map 九间房 ≥15% / 阴影 shadow-audit 9 项
             ↑ 断言"夜里看不看得见、有没有投影"
L5 实拍层    shot.mjs --room=<房> + 同机位改前/改后对比
             ↑ 唯一能判断"好不好看"的一层，前面全绿也不代表这层过
```

**规矩**：
- 任何改动，L0 必须先对（改模型后跑 `map-model.mjs` 对账，37 锚点全一致）
- L1~L2 是硬门禁，红就是红，不许调宽松口径
- L3 的"空段 ≤6"**不再作为目标**（数学上对小房间以外达不到）
- L4 每加/改房间就必须重跑（`light-map` 的房间名单以前是硬编码的，会静默漏房间）
- **L5 必须贴图给用户看，且要同机位对比**，不许只报数字

---

## 3.5 每种改动的固定流程

```bash
# 改一件家具的位置（唯一正确姿势）
node tools/place.mjs --id=<id> --cell=<x>,<row>            # 先预览：报贴墙/叠件/占锚点/压路
node tools/place.mjs --id=<id> --cell=<x>,<row> --apply     # 落盘
node tools/bust.mjs                                         # 版本号（不跑 = 假阴性）
node tools/check.mjs                                        # 必须 0 错误
node tools/facing-check.mjs --room=<房>                      # 这一件的朝向违规消失了吗

# 改房间矩形（加房间 / 改范围）
#   1) web/src/furniture.js 的 SWITCH_ROOM_RECTS
#   2) web/src/mapedit.js   的 ROOM_RECTS（编辑器色块）
#   3) web/src/minimap.js   的配色与矩形
#   4) web/src/head.js      的 roomLights
#   5) web/src/editor-api.js 的两处房间名单
#   6) web/src/placement.js  的灯池（否则夜里是黑的）
#   → 六个地方，漏一个就出现"有房间但没地图/没灯/没开关"
#   （好消息：tools/ 里各工具现在都从 furniture.js 现解析房间名单，不会再漏）

# 验收（每次交付都跑）
node tools/build.mjs && node tools/bust.mjs
node tools/check.mjs            # 32/32
node tools/map-audit.mjs        # P0 0 / P1 0
node tools/map-model.mjs        # 37 锚点对账全一致
node tools/layout-audit.mjs     # 四指标
node tools/facing-check.mjs     # 0
node tools/shadow-audit.mjs     # 9/9
node tools/light-map.mjs --time=night   # 九间房 ≥15%
node tools/shot.mjs --room=<房>          # 实拍，贴图给用户
```

---

## 4. 这一轮踩过、下一个人别再踩的坑

| # | 坑 | 表现 | 对策 |
|---|---|---|---|
| 1 | **房间名单散落在 6 个前端文件 + N 个 tools** | 加了 parkCourt/brickHall，工具仍按旧 7 间判，新房子里 39 件家具全算"户外"；`light-map` 更狠——**4 盏灯池直接丢了**，新房夜里全黑 | tools 一律从 `furniture.js` 现解析（`roomKeysOf`）；前端六处要手工同步，见 §3.5 |
| 2 | **矩形跨墙** | 第一版 `parkCourt [41,1,7,13]` 横跨了 `x=45/46` 的隔墙，变成"房间里套着墙" | 矩形按现有墙取，先画 `room-ascii` 看清边界再定 |
| 3 | **窄通道里的一件家具 = 一堵墙** | 补 `x=45` 东墙后出现 9 格孤岛，以为是墙的问题，实际是**一盏路灯 + 一棵橡树**堵在 2 格宽的通道里 | 连通性报错**先查家具**再改墙 |
| 4 | **`roomOf` 有 0.6 格容差** | `@45.3` 这种贴墙件会被算进房间，统计时容易误判 | 统计室内物件时看 `x` 的实际值，别只看 `roomOf` |
| 5 | 自定义层的家具 `place.mjs` 找不到 | 报"没有 id"，以为是数据丢了 | `place.mjs` 现在会区分"在 map.custom.json"和"真不存在"；改自定义层直接编辑文件，hub 会热重载 |
| 6 | 改完 `map.json` 没 `bust` | `check` 报"版本号过期"，误判成几何错 | 永远 `bust` → `check` |
| 7 | 判据变严后"突然变红" | 修好 `cellsOf` 后门禁掉到 30/31 | 红不是回退，是以前看不见的问题。逐件修，别改回宽松口径 |

---

## 5. 已知欠账（不修也能交付，但要知情）

1. **D1 大门走不出去**：`tx=12` 在第 0 行，而第 0 行整行不可走 —— 这是**既定装饰**，要么补出门演出，要么美术上封死
2. **两间新房间没有用途**（见 §2 P1）
3. **编辑器拖拽预览**的影子在 `spr.y + 1`，与渲染的 `+3` 差 2px（只影响拖动时）
4. **16 处真重叠**尚未逐条判定是否豁免（大概率全是花园密林）
5. **本地领先 `origin/main` 30 个 commit，一直没推**（需要 socks5 代理，见 `RULES.md` §7）

---

## 6. 新窗口开工清单

```bash
cd G:\news-site_BNFDy.tar\news-site_BNFDy\news-site\office

# 1) 确认基线（应完全等于 §0 的数字）
node tools/build.mjs && node tools/bust.mjs && node tools/check.mjs
node tools/map-model.mjs
node tools/map-audit.mjs
node tools/facing-check.mjs
node tools/shadow-audit.mjs

# 2) 起本地服务（截图必须，否者 shot.mjs 报"场景没就绪"）
npm run dev            # 4322 静态 + 4321 hub
# 若 4322 已被占用：Get-NetTCPConnection -LocalPort 4322 查 PID，必要时杀掉重启
# 注意：浏览器如果连的是**线上 hub**，看到的会是线上那份自定义层，不是本地改动

# 3) 补推（若代理可用）
git push origin main

# 4) 按 §2 的 P0 → P1 → P2 顺序推进
```

**最重要的一条**：判据要选对。门禁全绿 ≠ 摆得好看；
而当判据和现实不一致时，**先怀疑判据**——这一轮四个判据（`facing-check` / `layout-audit` /
`parityWithCheck` / `light-map`）全都错过一次。改判据必须留证据（改前/改后各跑一遍，
写清为什么旧的是错的），否则下一个人会以为你在凑数。
