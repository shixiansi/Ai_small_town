# AI 小镇 · 地图与布局规矩（交接文档）

> 面向"新开一个窗口接手"的场景。**先读这份，再动任何坐标。**
> 最后更新：第 40 轮结束时。当前仓库状态见 §9。

---

## 0. 一句话现状（别被门禁骗了）

门禁 31/31、审计 P0 0 / P1 0 / P2 1、真重叠 0、锚点对账全一致 —— **全部是绿的，但房间摆得仍然难看**。
原因：现有指标只验证"合法"，不验证"好看"。要改的是布局，判据是 §5.5 的 `layout-audit` 四个数字。

当前已知难看的地方（实测）：办公室贴墙率 **6%**、最长空段 **26 格**（整行空）；朝向违规 **12 处**。

---

## 1. 项目结构与工具链

```
office/
  web/src/*.js          ← 源码片段（office.js 由它们拼装）
  web/office.js         ← 构建产物，禁止手改
  web/map.json          ← 地图数据（家具/区域/墙/路/阻挡）
  hub/map.custom.json   ← 编辑器自定义层（floor/terrain/hide/light/shadow/move + 家具）
  tools/                ← 全部零依赖 Node 脚本
```

### 命令（每次改完 `web/src/*` 或 `web/map.json` 都要跑前三条）

```bash
node tools/build.mjs            # 拼装 web/office.js
node tools/bust.mjs             # 重写内容哈希版本号（index.html / boot.js 里的 ?v=）
node tools/check.mjs            # 31 项门禁；必须 "0 个错误"
```

**铁律：`bust` 必须在 `check` 之前跑。** 改了 `map.json` 不跑 `bust`，`check` 会在"版本号过期"上失败 —— 这是**假阴性**，会让人误判成几何问题（我为此浪费了两轮，见 §8 坑 1）。

---

## 2. 唯一事实源：`tools/map-model.mjs`

**所有工具都必须 import 它，不允许各自实现一套。**

```js
import { loadModel, parityWithCheck } from "./map-model.mjs";
const model = loadModel();
// model.items / solid(f) / cellsOf(f) / isBlocked(x,y) / rooms / roomOf(x,y)
// model.anchorCells / roadCells / anchors / conflictsOf(f) / protectedSet
```

它提供：房间矩形、地板材质（eval `room.js`）、自定义层、家具占格、阻挡格、道路格、锚点、碰撞判定。

`parityWithCheck(model)` 会把模型的判断和 `check.mjs` 的实际判定逐条对账 —— **改动模型后必须跑它，35 个锚点要全一致**。

### 取整口径（踩过两次的坑）

| 用途 | 口径 |
|---|---|
| 家具占格 | `Math.round(y - footH)`（与门禁一致，**不要用 floor**） |
| 房间归属 | `Math.floor(x), Math.floor(y)`（与 `map-audit` 的 H3 一致） |

**同一个概念只能有一个实现。** 曾经模型用 floor、门禁用 round，差半格导致"算着不压锚点，门禁说压了"，连续 3 次自动修复全部失败。

---

## 3. 数据模型

### `web/map.json`

```jsonc
{
  "room": { "tile": 48, "cols": 56, "rows": 30, "wallH": 48 },
  "furniture": [
    { "a": "office-desk", "x": 9, "y": 21, "id": "desk",
      "o": 1,        // 装饰：不占碰撞
      "wall": 1,     // 挂墙：不占地面碰撞
      "on": "desk",  // 叠加在 host 上：不占碰撞
      "sc": 1.3,     // 缩放
      "flipX": 1     // 水平镜像（唯一可用的"朝向"手段）
    }
  ],
  "zones": { "desk": { "anchor": [9, 19.8], "host": "desk", "sit": { "host": "chairA" } } },
  "walls": [ { "x": 10, "y": 1, "h": 14, "gap": [5, 7] } ],
  "roads": [ { "x": 26, "y": 16, "w": 30, "h": 3 } ],
  "blockers": { "pond": { ... } }
}
```

**每件家具必须有 `id`**（当前 223 件全部有）。没有 id 就无法"改一件、验一件、坏了只回退这一件"——这是逐件工作的前提。

### `hub/map.custom.json`（编辑器层，会在渲染时叠加）

| `a` 值 | 含义 |
|---|---|
| `floor` `{t:"wood\|tile\|grass\|stone\|road"}` | 逐格改写地板 |
| `terrain` `{t:"wall\|water"}` | 逐格叠地形，**同时不可走** |
| `house`/其他素材名 | 追加家具（与 base 同构） |
| `hide` `{k:"flowers@17.2,10.8"}` | 隐藏指定家具 |
| `light` `{r,a,tint,room}` | 灯池（第 3 层光照） |
| `shadow` `{id,x,y,w,h,night,lit,day}` / `del:1` | 房间级阴影块 / 删除内置块 |
| `move` `{k:"id:xxx"}` | 移动 base 里的家具 |

**注意**：这层能盖掉 base 的一切。曾经 9 格刷出来的墙堵死办公室东出口、379 格地板刷盖掉草坪 —— 而只看 `map.json` 的审计完全看不出来。`map-model` 已经把它并进来，别再绕过去。

---

## 4. 五个维度（每层都有工具与判据）

| # | 维度 | 工具 | 判据 |
|---|---|---|---|
| 1 | 地板 / 道路 / 墙 | `map-annotate.mjs --only=<房>` | 材质逐格正确、道路不压阻挡、墙围合、门洞标黄 |
| 2 | 素材 / 碰撞 | 同上 + `conflictsOf()` | **真错重叠 = 0**（同素材互叠豁免，如密林） |
| 3 | 光照 | `light-map.mjs --time=day\|dusk\|night` + `shot.mjs --url="...?overlay=light"` | 每间房**被照亮面积 ≥15%**，光心落在功能区 |
| 4 | 朝向 | `facing-check.mjs` | 见 §5.3 四条规则；目标 0 违规 |
| 5 | 阴影 | `shadow-audit.mjs` | 渲染层常量 9 项全过 |

### 房间截图（比 8 等分好用）

```bash
node tools/shot.mjs --room=office                       # 整间房
node tools/shot.mjs --room=bedroom --url="http://127.0.0.1:4322/?overlay=light"
node tools/shot.mjs --only=c1r1 --margin=2              # 8 等分某一块
```

截图工具的两个坑已修：必须取"面积最大的 canvas"（页面上有两个，小地图会先命中）；必须 `scene.pause()`（否则 `states.js` 的延时 `beginFollow` 会把镜头抢回去）。

---

## 5. 硬规则（违反就会好看不了）

### 5.1 贴墙 ≠ 站在墙上

```
错：背靠墙 = 上下左右 1 格内有墙        ← "自己就在墙格上"也成立 → 家具被推到墙里
对：背靠墙 = 与墙相邻 且 本格不是墙
```
`facing-check.mjs` 与所有修正器目前还是错的版本，**接手第一件事就是改这条**。

### 5.2 锚点 = host + 朝向 1.2 格

`zones[*].anchor` 不靠几何猜，靠 `zones[*].host`（家具 id）推导：

```
anchor = host 位置 + 朝房间内侧 1.2 格，且必须可走（isBlocked=false）
```

`tools/anchor-from-host.mjs` 已实现。**已通过门禁的锚点不要动** —— 实测 23 个里有 15 个本来合法，用公式去"改好"反而推坏。

### 5.3 朝向规则（只有这四条可判定，其余一律不算错）

| 规则 | 适用 | 要求 |
|---|---|---|
| R1 背靠墙 | 柜 / 书架 / 文件柜 / 衣柜 / 马桶 / 洗手盆 / 灶台 / 操作台 / 储物柜 | 与墙相邻且不在墙格 |
| R2 头靠墙 | 床 / 双人床 | 同上 |
| R3 面桌 | 椅子 / 办公椅 | 2 格内必须有桌 |
| R4 面茶几 | 沙发 / 单人沙发 | 2.5 格内必须有茶几 |

**上下朝向做不到**：74 个素材都是单朝向，`flipX` 只能表达"朝左/朝右"。要上下朝向必须补美术，别假装实现。

### 5.4 房间布局的两层结构

```
y = 室内首行        ← 家具本体（贴墙那一排）
y = 室内首行 + 1.2  ← 锚点/站立位（鱼站这儿）
y = 中间            ← 2 格宽动线，不许放东西
```

**"家具贴墙"与"锚点要可站"是同一块地**，必须联合求解；分开做必然互相打架（我为此失败 6 次）。

### 5.5 布局四指标（`layout-audit.mjs`）

```
贴墙率 ≥50%（大件靠墙）· 最近邻中位 ≤3.2（成组而非散点）
最长空段 ≤6 格 · 对齐率 ≥35%（成排）
```

当前基线：office 贴墙 6% / 空段 26 格 / 最近邻 1.6 —— **散点式摆放的典型**。

### 5.6 阴影常量（`shadow-audit.mjs` 守着）

```
tint 0x000000 · alpha 0.22 · 偏移 +6/+10 px（全局光向）
depth = 本体 - 1 · flipX/sc 跟随本体 · 只给 !o && !wall && !on 的件加
```
房间级阴影是另一套（`mapedit.js`）：`{ night: 0.60, lit: 0.15, day: 0.00 }`，**白天浓度就是 0**，别在白天截图里找房间阴影。

---

## 6. 逐件作业规程（必须遵守）

```bash
# 改一件 → 立刻验
node tools/fix-facing-pair.mjs      # 现成的"家具+锚点成对移动 + 逐件回退"骨架
```

循环里**每改一个候选位**必须：

1. 写 `map.json`
2. `bust`（重写版本号，否则假阴性）
3. `check`（0 错误才继续）
4. 判"**这一件**的违规消失"（不是"全图总数下降"——家具互相依赖，挪桌子会让椅子违规）
5. 不通过 → **只回退这一件**，记录原因，继续下一件

**禁止批量改**：23 个锚点一起动，只要 1 个坏，整批作废，而且看不出是哪个（我为此浪费 4 轮）。

---

## 7. 验收流程（每次交付）

```bash
node tools/build.mjs && node tools/bust.mjs
node tools/check.mjs                       # 31/31 · 0 错误
node tools/map-audit.mjs                   # P0 0 / P1 0
node tools/map-model.mjs                   # 35 锚点对账全一致
node tools/layout-audit.mjs                # 四指标（改布局时必须变好）
node tools/facing-check.mjs                # 朝向违规数
node tools/shadow-audit.mjs                # 9 项常量
node tools/shot.mjs --room=<房>            # 实拍，肉眼确认
git commit && git push
```

推送需要代理（`github.com:443` 直连不通）：

```bash
git config --local http.proxy  socks5://127.0.0.1:7897
git config --local https.proxy socks5://127.0.0.1:7897
git push origin main
```

> **必须用 `socks5://`**，`http://127.0.0.1:7897` 会报 `SSL_ERROR_SYSCALL`。偶发失败重试一次。

---

## 8. 已知的坑（都踩过，别再踩）

| # | 坑 | 表现 | 对策 |
|---|---|---|---|
| 1 | 版本号污染判据 | 每次改动后 `check` 报"版本号过期"，被误判为几何错 | 判门禁前先 `bust` |
| 2 | floor vs round | 模型算的格与门禁算的格差半格 | 统一到 `map-model`，占格用 round、房间归属用 floor |
| 3 | 自定义层隐形 | 只看 `map.json`，画面完全不同 | 一律用 `map-model`（已并层） |
| 4 | 批量改锚点 | 一处坏，整批废，且定位不到 | 逐件改、逐件验、单件回退 |
| 5 | "站墙上"当"贴墙" | 家具被推进墙格，警告增加 | 规则加"本格不是墙" |
| 6 | 无 id 的家具 | 无法精确回退，只能整批回滚 | 已全部补 id（`f0001`…） |
| 7 | 白天找房间阴影 | 看不到，以为没渲染 | `day: 0.00`，要夜里看 |
| 8 | 上面 8 条之外 | —— | 先跑 `map-model.mjs` 对账，再怀疑数据 |

---

## 9. 当前状态与欠账

```
门禁        31/31 · 0 错误 · 2 条警告
地图审计    P0 0 / P1 0 / P2 1（仅既定的装饰大门 D1）
模型对账    35 锚点全一致 · 阻挡格 528
真重叠      0（全图 + 逐房）
朝向违规    12（从 34 降下来，未清零）
布局指标    office 贴墙 6% / 空段 26 格 / 最近邻 1.6 ← 仍是散点
光照        七间房照亮面积 15%~27%（达标）
git         本地领先 origin/main 8 个 commit（推送长期被网络阻断）
```

### 未完成

1. **房间布局重排**（办公室 → 卧室 → 厨房 → 卫浴）—— 你最初想要的东西，一步没动
2. `facing-check` 接进门禁成第 32 项（注意：加了之后所有"31/31"要改成"32/32"）
3. 朝向违规 12 → 0
4. 地图当前处于**中间状态**（逐件修正留下的散点）。若要重排，建议先从某个干净提交起重做，别在现状上叠：`git log --oneline -20` 选一个点，`git checkout <sha> -- web/map.json`

---

## 10. 新会话开工清单

```bash
cd G:\news-site_BNFDy.tar\news-site_BNFDy\news-site\office

# 1) 先确认基线
node tools/build.mjs && node tools/bust.mjs && node tools/check.mjs
node tools/map-model.mjs
node tools/layout-audit.mjs
node tools/facing-check.mjs

# 2) 补推积压
git push origin main          # 若失败，检查 socks5://127.0.0.1:7897

# 3) 起本地服务拍图（改布局必须看图）
npm run dev                   # 静态 4322 + hub 4321
node tools/shot.mjs --room=office

# 4) 做布局：先定房间的"两排 + 动线"，再逐件落位
#    判据不是门禁，是 layout-audit 的四个数字 + 实拍
```

**最重要的一条**：判据要选对。门禁全绿≠摆得好看；`layout-audit` 的四个数字和实拍图才是"像不像人摆的"。
