  /* ============ 自定义地图层 + 编辑模式（v37 / v37.1） ============
   * hub 的 map.custom.json 里存的是「用户在编辑模式下加的家具」，叠加在 web/map.json 之上。
   * 合并走 applyCustomFurniture()（幂等）→ 由 buildFurnitureLayer() 统一建精灵并重算碰撞格；
   * 编辑模式下鱼停下、点击语义从走位切换成放置/移动/删除。
   * hub 连不上时改动落在 localStorage 镜像里（v37.1），不再只是弹一句 Failed to fetch 就没了。 */
  var customFurniture = [];        // 自定义层条目（hub 是真相源；hub 不通时本机镜像代管）
  var customPlaceholders = [];     // { f, placement, spr } 建出来的实例
  var editMode = false;            // 编辑模式总开关
  var editTool = "select";         // select | add | move | delete
  var editAsset = null;            // add 工具当前选中的资产名
  var editDragItem = null;         // 正在拖动的条目
  var editGhost = null;            // add 模式跟随鼠标的半透明预览
  var editDirty = false;           // 本地有未保存改动
  var hubMapOk = null;             // hub 地图接口可达性：null=还没探过 true=通 false=不可达
  var hubMapErr = "";              // 最近一次失败原因（调试台/提示直接显示）
  /* "隐藏静态物件"（v37.4）：map.json 里的家具本来是只读的，用户想删掉挡路的那丛灌木却点不动。
   * 做法：不下发新的 hub 结构，而是在自定义层里追加一条 { a:"hide", k:"<key>" }；
   * hub 的校验认 a="hide"（合法小写字母），老客户端遇到未知资产会被 makePlacement 安全跳过。
   * hiddenKeys 每次从自定义层重算，applyCustomFurniture() 里据此过滤静态家具。 */
  var hiddenKeys = {};
  /* ---- 分层编辑数据（v38 独立地图编辑器）----
   * 一次 customFurniture（= hub 的 map.custom.json）里混装五种条目，按 a 分派：
   *   "<资产名>"             物品层：新增家具
   *   "hide"  { k }          物品层：隐藏静态家具
   *   "move"  { k, x, y }    物品层：移动静态家具（map.json 只读的也能挪）
   *   "floor" { t, x, y }    地板层：t = wood | tile | stone | grass | road
   *   "terrain" { t, x, y }  地形层：t = wall | water | farm
   * 全部复用现有 hub 的 add/set 接口（a 是合法小写资产名、坐标在范围内），hub 端零改动。 */
  var moveOverrides = {};          // key → { x, y }
  var floorEdits = {};             // "tx,ty" → entry
  var terrainEdits = {};           // "tx,ty" → entry
  /* v43：光源 = map.json 的 lights（内置，每盏路灯一个）+ 自定义层里的覆盖/新增
   *   { a:"light", id, x, y, r, al, tint }  覆盖或新增
   *   { a:"light", id:"bl_1", del:1 }        删掉某个内置光源 */
  var lightEdits = [];             // 合并后的光源列表
  var lightOverrides = {};         // id → 条目
  var lightDeleted = {};           // id → 1
  /* v42：阴影区域 = 内置 4 间房 + 用户拉的块，每块三档浓度（夜/开灯/白天），可改名/移动/删除。
   * 自定义层里的条目：
   *   { a:"shadow", id, x, y, w, h, night, lit, day }   新增或覆盖同名内置块
   *   { a:"shadow", id:"b:office", del:1 }               删除某个内置块
   * 内置块没被覆盖时用 BUILTIN_SHADOWS 里的默认几何与浓度。 */
  var BUILTIN_SHADOWS = [
    { id: "b_office",  label: "办公室", room: "office",  x: 0,  y: 15, w: 26, h: 15, night: 0.60, lit: 0.00, day: 0.00 },
    { id: "b_bedroom", label: "卧室",   room: "bedroom", x: 1,  y: 1,  w: 9,  h: 13, night: 0.60, lit: 0.00, day: 0.00 },
    { id: "b_bath",    label: "卫浴",   room: "bath",    x: 10, y: 1,  w: 6,  h: 13, night: 0.60, lit: 0.00, day: 0.00 },
    { id: "b_kitchen", label: "厨房",   room: "kitchen", x: 16, y: 1,  w: 9,  h: 13, night: 0.60, lit: 0.00, day: 0.00 },
    { id: "b_outdoor", label: "户外（花园/街道）", room: null, x: 26, y: 0, w: 30, h: 30, night: 0.00, lit: 0.00, day: 0.00 }
  ];
  var SHADOW_DEFAULTS = { night: 0.60, lit: 0.15, day: 0.00 };   // 新拉一块的默认浓度
  var shadowEdits = [];            // 合并后的阴影区域（内置覆盖 + 自定义），由 splitCustomLayer 生成
  var shadowOverrides = {};        // id → 覆盖条目
  var shadowDeleted = {};          // id → 1（内置块被删）
  /* ---------- 光照层（v40）----------
   * 灯源也是自定义层里的一条：{ a:"light", x, y, r, al, tint }（r=半径格数，al=亮度，tint=颜色）
   * hub 的 validateMapItem 只校验 a/x/y/id，多余字段原样保留 → 依旧 hub 零改动。
   * 夜间遮罩参数（暗度/外扩/预览）属于观感偏好，存 localStorage，不写 hub。 */
  var LIGHT_PRESETS = [
    { id: "street", label: "路灯暖光", tint: 0xffd9a0, r: 2.6, a: 0.55 },
    { id: "warm",   label: "室内暖光", tint: 0xffc98a, r: 2.0, a: 0.45 },
    { id: "cool",   label: "冷光",     tint: 0xbfd8f5, r: 2.2, a: 0.40 },
    { id: "big",    label: "大范围",   tint: 0xfff0c0, r: 4.2, a: 0.30 }
  ];
  var NIGHT_KEY = "office_night_cfg";
  var nightCfg = { alpha: 0.60, pad: 0, preview: "auto", roomMask: true };   // preview: auto|day|night；roomMask=是否用内置房间遮罩
  var nightPreset = "street";      // 下一次落灯用哪个预设
  var selectedLight = null;        // 正在编辑的灯 id
  function loadNightCfg() {
    try {
      var j = JSON.parse(localStorage.getItem(NIGHT_KEY) || "null");
      if (j) {
        if (j.alpha != null) nightCfg.alpha = Math.max(0, Math.min(0.9, Number(j.alpha)));
        if (j.pad != null) nightCfg.pad = Math.max(0, Math.min(96, Number(j.pad)));
        if (j.preview) nightCfg.preview = j.preview;
        if (j.roomMask != null) nightCfg.roomMask = !!j.roomMask;
      }
    } catch (e) {}
    forceNight = nightCfg.preview === "night" ? true : (nightCfg.preview === "day" ? false : null);
  }
  function saveNightCfg() {
    try { localStorage.setItem(NIGHT_KEY, JSON.stringify(nightCfg)); } catch (e) {}
    forceNight = nightCfg.preview === "night" ? true : (nightCfg.preview === "day" ? false : null);
  }
  function lightPreset() {
    return LIGHT_PRESETS.filter(function (p) { return p.id === nightPreset; })[0] || LIGHT_PRESETS[0];
  }
  loadNightCfg();   // 启动即读回上一次的昼夜预览/阴影参数（存 localStorage）
  var FLOOR_STYLE = {              // 地板/道路贴片配色（与 buildRoom 的材质色系对齐）
    wood: [0x9c7750, 0x8f6a45], tile: [0x8e9ca6, 0x8494a0], stone: [0x7c7e8c, 0x757786],
    grass: [0x6e9453, 0x688c4d], road: [0xb3a184, 0xa9977b]
  };
  var FLOOR_LABEL = { wood: "木地板", tile: "瓷砖", stone: "石板", grass: "草地", road: "道路" };
  var TERRAIN_LABEL = { wall: "墙", water: "水面", farm: "农田" };
  var EDIT_PICKABLE = [            // 编辑器可选资产白名单（全部在 manifest 里）
    "office-desk", "desk-wood", "school-desk", "dining-table", "round-table", "bookshelf-office",
    "sofa", "armchair", "chair", "office-chair", "double-bed", "bed", "nightstand", "wardrobe",
    "cabinet", "locker", "filing-cabinet", "book-stack", "open-book", "paper-stack", "pencil-cup",
    "computer", "laptop", "printer", "phone-desk", "desk-lamp", "coffee-mug", "stapler", "calculator",
    "globe-desk", "clock-desk", "fruit-bowl", "kettle", "fridge", "stove-kitchen", "kitchen-counter",
    "sink", "bathtub", "toilet", "mirror", "curtains", "plant-office", "floor-lamp", "arcade-cabinet",
    "gramophone", "blackboard", "whiteboard", "crown-cushion", "water-cooler", "mailbox", "trophy-cup",
    "bench-park", "street-lamp", "oak-tree", "bush", "flowers", "fence", "fence-picket", "market-stall",
    "stall-fruit", "well", "potion-shelf", "sign-inn", "cottage", "farmhouse", "house-modern", "coin",
    "amulet", "wizard-hat", "robe",
    // v39.2：窗也是一种"物品"——用 tiles/window.png 当贴图（boot.js 里注册进 MAN），
    // 摆放时带 wall:true（不产生碰撞、depth 贴地），所以能像家具一样随便挪随便删
    "window",
    "switch",                   // v50：墙上的灯开关（点它切对应房间的灯）
    "wall-lamp"                 // v52：墙上壁灯（随房间灯亮灭，也能点）
  ];
  /* 摆放物品时要额外加的默认字段（目前只有"窗"需要 wall 标记） */
  function placeExtraFor(asset) {
    if (asset === "window") return { wall: true };
    if (asset === "switch") return { wall: true };    // v50：开关挂墙上、不挡路
    if (asset === "wall-lamp") return { wall: true };  // v52：壁灯同理
    return null;
  }
  /* 资产分类（v39.3）：71 件全混在一格里太难找，按用途分组。
   * 约束：EDIT_PICKABLE 里的每一件必须**恰好**属于一个分类（check.mjs 有门禁）。 */
  var EDIT_CATS = [
    { id: "table",   label: "桌椅台", icon: "🪑", assets: ["office-desk", "desk-wood", "school-desk", "dining-table", "round-table", "chair", "office-chair"] },
    { id: "storage", label: "收纳柜", icon: "🗄", assets: ["bookshelf-office", "nightstand", "wardrobe", "cabinet", "locker", "filing-cabinet", "potion-shelf"] },
    { id: "soft",    label: "沙发床", icon: "🛋", assets: ["sofa", "armchair", "double-bed", "bed", "crown-cushion"] },
    { id: "device",  label: "电器",   icon: "🔌", assets: ["computer", "laptop", "printer", "arcade-cabinet", "gramophone", "phone-desk", "water-cooler", "clock-desk"] },
    { id: "tiny",    label: "桌面小物", icon: "🧸", assets: ["book-stack", "open-book", "paper-stack", "pencil-cup", "desk-lamp", "coffee-mug", "stapler", "calculator", "globe-desk", "fruit-bowl", "kettle", "trophy-cup", "coin", "amulet", "wizard-hat", "robe"] },
    { id: "kb",      label: "厨卫",   icon: "🍳", assets: ["fridge", "stove-kitchen", "kitchen-counter", "sink", "bathtub", "toilet", "mirror"] },
    { id: "decor",   label: "植物装饰", icon: "🪴", assets: ["plant-office", "floor-lamp", "curtains", "blackboard", "whiteboard"] },
    { id: "outdoor", label: "户外",   icon: "🌳", assets: ["bench-park", "street-lamp", "oak-tree", "bush", "flowers", "fence", "fence-picket", "mailbox", "well", "market-stall", "stall-fruit", "sign-inn"] },
    { id: "house",   label: "建筑",   icon: "🏠", assets: ["cottage", "farmhouse", "house-modern"] },
    { id: "misc",    label: "窗/开关", icon: "🪟", assets: ["window", "switch", "wall-lamp"] }
  ];
  function assetsOfCat(id) {
    var c = EDIT_CATS.filter(function (x) { return x.id === id; })[0];
    return c ? c.assets.slice(0) : EDIT_PICKABLE.slice(0);
  }
  /* hub 的 HTTP 地址（不是 WS）：
   *   本地/局域网 → 直连 hub:4321；线上 → Nginx 的 /office-hub-api/ 反代（与 postStatDelta 同一条路）。
   * 注意：这个函数永远返回非空串，所以「hub 不可达」不能用它判断，
   * 状态一律看 hubMapOk（probeMapHub() / 每次保存的结果），否则会撒谎。 */
  function hubMapBase() {
    if (hubBase()) return hubBase();
    var host = location.hostname || "";
    // 局域网 IP 打开时 hub 就在同一台机器上（hub 默认只 bind 127.0.0.1，绑 0.0.0.0 才能连上）
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return "http://" + host + ":4321";
    return "/office-hub-api";
  }
  function hubMapUrl() {
    var base = hubMapBase() || "";
    return base.indexOf("://") >= 0 ? base + "/api/map" : base + "/map";
  }
  /* 家具的显示坐标：on 叠加物（书架上的书/桌上的电脑）在 map.json 里没有 x/y，
   * 真实位置来自 placement（宿主台面 + dx/dy），这里反推成格子坐标，避免列表里出现 undefined,undefined */
  function furniturePosText(p) {
    var f = p.f || {};
    var x = (f.x === undefined || f.x === null) ? Math.round(((p.x - TILE / 2) / TILE) * 10) / 10 : f.x;
    var y = (f.y === undefined || f.y === null) ? Math.round(((p.y - WALL_H - TILE / 2) / TILE) * 10) / 10 : f.y;
    return x + "," + y;
  }
  /* 家具的稳定 key：有 id 用 id，没有就用「资产名@坐标」（map.json 里的静态家具大多没有 id）。
   * 被移动过的静态家具用 _key 记住原始 key，否则 hide/move 会互相打架。 */
  function furnitureKeyOf(f) {
    if (!f) return "";
    if (f._key) return f._key;
    if (f.id) return "id:" + f.id;
    // on 叠加物（桌上的电脑/书架上的书）没有 x/y，用「宿主 + 偏移」当 key，避免两条都变成 @undefined
    if (f.x === undefined || f.y === undefined) {
      return (f.a || "") + "@on:" + (f.on || "") + ":" + (f.dx || 0) + "," + (f.dy || 0);
    }
    return (f.a || "") + "@" + f.x + "," + f.y;
  }
  function isHideEntry(f) { return !!(f && f.a === "hide" && typeof f.k === "string"); }
  function isMoveEntry(f) { return !!(f && f.a === "move" && typeof f.k === "string"); }
  function isFloorEntry(f) { return !!(f && f.a === "floor" && typeof f.t === "string"); }
  function isTerrainEntry(f) { return !!(f && f.a === "terrain" && typeof f.t === "string"); }
  function isLightEntry(f) { return !!(f && f.a === "light"); }
  function isShadowEntry(f) { return !!(f && f.a === "shadow" && (typeof f.w === "number" || f.del)); }
  /* 把自定义层拆成「物品 / 隐藏 / 移动 / 地板 / 地形」五份，顺便刷新全局索引 */
  function splitCustomLayer() {
    var objects = [];
    hiddenKeys = {}; moveOverrides = {}; floorEdits = {}; terrainEdits = {}; lightOverrides = {}; lightDeleted = {}; shadowOverrides = {}; shadowDeleted = {};
    customFurniture.forEach(function (f) {
      if (!f || !f.a) return;
      if (isHideEntry(f)) { hiddenKeys[f.k] = 1; return; }
      if (isMoveEntry(f)) { moveOverrides[f.k] = { x: Number(f.x), y: Number(f.y) }; return; }
      var cellKey = f.x + "," + f.y + (f.band ? ",band" : "");
      if (isFloorEntry(f)) { floorEdits[cellKey] = f; return; }
      if (isTerrainEntry(f)) { terrainEdits[cellKey] = f; return; }
      if (isShadowEntry(f)) {
        if (f.del) { shadowDeleted[f.id] = 1; return; }
        shadowOverrides[f.id] = f;
        return;
      }
      if (isLightEntry(f)) {
        if (f.del) { lightDeleted[f.id] = 1; return; }
        lightOverrides[f.id] = f;
        return;
      }
      objects.push(f);
    });
    lightEdits = buildLightRegions();
    shadowEdits = buildShadowRegions();
    return objects;
  }
  function refreshHiddenKeys() { splitCustomLayer(); }
  function hideEntryFor(key) {
    var h = 0;
    for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return { a: "hide", k: key, x: 0, y: 0, id: "hide" + h.toString(36) };
  }
  function moveEntryFor(key, tx, ty) {
    var h = 0, s = key + "@" + tx + "," + ty;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return { a: "move", k: key, x: Math.round(tx * 10) / 10, y: Math.round(ty * 10) / 10, id: "mv" + h.toString(36) };
  }
  var TILE_ID_SEQ = 0;
  function tileEntryFor(kind, t, tx, ty, band) {
    var a = kind === "floor" ? "floor" : "terrain";
    // v60：id 必须唯一（原来按 tx/ty 拼，重复刷同一格会撞 id → hub "id 重复" 整批拒绝）
    var uid = "e" + a.slice(0, 3) + (band ? "b" : "") + tx.toString(36) + (band ? "" : "z" + ty.toString(36)) +
              t.slice(0, 2) + (++TILE_ID_SEQ % 1296).toString(36) + Math.floor(Math.random() * 1296).toString(36);
    var e = { a: a, t: t, x: tx, y: ty, id: uid };
    if (band) { e.y = 0; e.band = true; }
    return e;
  }
  function hiddenCount() {
    var n = 0;
    customFurniture.forEach(function (f) { if (isHideEntry(f)) n++; });
    return n;
  }
  /* 地板/地形叠加层（v39）：同样用 tiles 贴图，和底图一个材质体系（不再画彩色方块）。
   * 一个 RenderTexture（depth 6）就够：先铺地板贴片，再压地形（地形在上层）。 */
  function renderEditOverlays(s) {
    if (!s || !s.add) return;
    if (!s.editLayerGfx || !s.editLayerGfx.active) s.editLayerGfx = s.add.renderTexture(0, 0, W, H).setOrigin(0, 0).setDepth(6);
    var rt = s.editLayerGfx;
    if (s.editFloorGfx) { try { s.editFloorGfx.destroy(); } catch (e) {} s.editFloorGfx = null; }
    if (s.editTerrainGfx) { try { s.editTerrainGfx.destroy(); } catch (e) {} s.editTerrainGfx = null; }
    rt.clear();
    if (!Object.keys(floorEdits).length && !Object.keys(terrainEdits).length) return;
    rt.beginDraw();
    Object.keys(floorEdits).forEach(function (k) {
      var e = floorEdits[k];
      rt.batchDraw(tileTex(e.t), e.x * TILE, e.band ? 0 : WALL_H + e.y * TILE);   // v59：band 画在墙带
    });
    Object.keys(terrainEdits).forEach(function (k) {
      var e = terrainEdits[k];
      rt.batchDraw(tileTex(e.t === "wall" ? "wall" : e.t === "water" ? "water" : "farm"), e.x * TILE, e.band ? 0 : WALL_H + e.y * TILE);   // v59
    });
    rt.endDraw();
  }
  /* 手刷的夜间阴影（v41）：一个 Graphics，逐格填半透明黑，alpha = 全局暗度 × 浓淡系数。
   * 因为要"跟着暗度滑杆联动"，所以每次重画都用 nightCfg.alpha 现算。 */
  /* 内置光源（map.json 的 lights，一盏路灯一个）+ 覆盖 − 删除 + 自定义新增 */
  function buildLightRegions() {
    var out = [];
    var base = (scene && scene.mapdata && scene.mapdata.lights) || [];
    base.forEach(function (L, i) {
      var id = L.id || ("bl_" + (i + 1));
      if (lightDeleted[id]) return;
      var o = lightOverrides[id] || {};
      out.push({
        id: id, builtin: true,
        x: o.x != null ? Number(o.x) : Number(L.x),
        y: o.y != null ? Number(o.y) : Number(L.y),
        r: o.r != null ? Number(o.r) : Number(L.r || 3),
        a: (o.al != null ? Number(o.al) : (L.a != null ? Number(L.a) : 0.5)),
        tint: o.tint != null ? Number(o.tint) : (L.tint != null ? Number(L.tint) : 0xffd9a0)
      });
    });
    Object.keys(lightOverrides).forEach(function (id) {
      if (out.some(function (r) { return r.id === id; })) return;   // 已在上面合并
      var o = lightOverrides[id];
      out.push({
        id: id, builtin: false,
        x: Number(o.x) || 0, y: Number(o.y) || 0,
        r: Number(o.r || 2.4), a: Number(o.al == null ? 0.5 : o.al),
        tint: Number(o.tint == null ? 0xffd9a0 : o.tint)
      });
    });
    return out;
  }

  /* v49：一块阴影区域"属于哪个房间" —— 和内置房间矩形比重叠面积，取最大的那个。
   * 这样自己拉的块也能跟着对应房间的灯开关变亮/变暗（原来只是 room:null → 只跟全局灯）。 */
  function roomForRect(x, y, w, h) {
    var best = null, bestArea = 0;
    BUILTIN_SHADOWS.forEach(function (b) {
      if (!b.room) return;
      var ox = Math.max(0, Math.min(x + w, b.x + b.w) - Math.max(x, b.x));
      var oy = Math.max(0, Math.min(y + h, b.y + b.h) - Math.max(y, b.y));
      var area = ox * oy;
      if (area > bestArea) { bestArea = area; best = b.room; }
    });
    return best;   // 完全落在房间外（花园/街道）→ null，跟随全局灯
  }

  /* 内置 + 覆盖 → 最终的阴影区域列表（顺序稳定：内置在前，自定义在后） */
  function buildShadowRegions() {
    var out = [];
    BUILTIN_SHADOWS.forEach(function (b) {
      if (shadowDeleted[b.id]) return;
      var o = shadowOverrides[b.id];
      var r = Object.assign({}, b);
      if (o) {
        ["x", "y", "w", "h", "night", "lit", "day", "label", "room"].forEach(function (k) {
          if (o[k] !== undefined && o[k] !== null) r[k] = (k === "label" ? String(o[k]) : Number(o[k]));
        });
      }
      r.builtin = true;
      out.push(r);
    });
    Object.keys(shadowOverrides).forEach(function (id) {
      if (BUILTIN_SHADOWS.some(function (b) { return b.id === id; })) return;   // 已在上面合并
      var o = shadowOverrides[id];
      out.push({
        id: id, label: o.label || "", builtin: false,
        room: (o.room != null && o.room !== "" && o.room !== "auto") ? String(o.room) : roomForRect(Number(o.x) || 0, Number(o.y) || 0, Math.max(1, Number(o.w) || 1), Math.max(1, Number(o.h) || 1)),
        x: Number(o.x) || 0, y: Number(o.y) || 0,
        w: Math.max(1, Number(o.w) || 1), h: Math.max(1, Number(o.h) || 1),
        night: o.night == null ? SHADOW_DEFAULTS.night : Number(o.night),
        lit: o.lit == null ? SHADOW_DEFAULTS.lit : Number(o.lit),
        day: o.day == null ? SHADOW_DEFAULTS.day : Number(o.day)
      });
    });
    return out;
  }
  /* 当前这一刻这块该用"夜"还是"开灯"还是"白天"的浓度 */
  function shadowAlphaOf(r) {
    var night = isNightHour();
    if (!night) return Math.max(0, Math.min(0.95, r.day));
    // v49：预览只决定"是不是夜里"，不再强行当作关灯 —— 否则编辑器里怎么按开灯都不会变亮
    // v64：有房间归属 → 只看那个房间；没归属（花园/街道）→ 只有"全部房间都开着"才亮，
    // 否则厨房开个灯就把旁边草地阴影带亮（用户反馈"两块阴影互相影响"）
    var allRoomsOn = ["office", "bedroom", "bath", "kitchen"].every(function (k) { return roomLights[k] !== false; });
    var on = r.room ? (roomLights[r.room] !== false) : allRoomsOn;
    if (previewNight() === "day") return Math.max(0, Math.min(0.95, r.day));
    return Math.max(0, Math.min(0.95, on ? r.lit : r.night));
  }
  function previewNight() {
    return (typeof nightCfg !== "undefined") ? nightCfg.preview : "auto";
  }

  /* v73：房间矩形（和内置阴影区域同一套坐标）—— 用于判断"这个房间到底有没有阴影块" */
  var ROOM_RECTS = [
    { room: "office",  x: 0,  y: 15, w: 26, h: 15, label: "办公室" },
    { room: "bedroom", x: 1,  y: 1,  w: 9,  h: 13, label: "起居" },
    { room: "bath",    x: 10, y: 1,  w: 6,  h: 13, label: "卫浴" },
    { room: "kitchen", x: 16, y: 1,  w: 9,  h: 13, label: "厨房" }
  ];
  /* 某块阴影区域是否覆盖了这个房间（重叠面积 > 房间的 25% 就算覆盖） */
  function roomCovered(rr, edits) {
    var roomArea = rr.w * rr.h;
    for (var i = 0; i < edits.length; i++) {
      var e = edits[i];
      var ox = Math.max(0, Math.min(rr.x + rr.w, e.x + e.w) - Math.max(rr.x, e.x));
      var oy = Math.max(0, Math.min(rr.y + rr.h, e.y + e.h) - Math.max(rr.y, e.y));
      if (ox * oy > roomArea * 0.25) return true;
    }
    return false;
  }

  /* v72：夜色 = 单层 RenderTexture（环境光 + 区域阴影 + 灯光挖洞），一次全量重算。
   * 签名没变就跳过（避免每帧重画整张图）。 */
  function renderNightShadow(s) {
    if (!s || !s.add) return;
    if (!s.shadowRT || !s.shadowRT.active) {
      s.shadowRT = s.add.renderTexture(0, 0, W, H).setOrigin(0).setDepth(59100);
    }
    var rt = s.shadowRT;
    var amb = Math.max(0, Math.min(1, ambientCur || 0));
    var pv = previewNight();

    // ① 签名：决定要不要重画
    var sig = amb.toFixed(2) + "|" + pv + "|" + (isNightHour() ? 1 : 0) + "|" +
      ["office", "bedroom", "bath", "kitchen"].map(function (k) { return roomLights[k] === false ? 0 : 1; }).join("") + "|" +
      shadowEdits.map(function (r) {
        return r.id + ":" + r.x + "," + r.y + "," + r.w + "," + r.h + ":" + shadowAlphaOf(r).toFixed(2);
      }).join(";") + "|" +
      ROOM_RECTS.map(function (rr) {
        var covered = (typeof roomCovered === "function") ? roomCovered(rr, shadowEdits) : true;
        return rr.room + (covered ? "C" : (roomLights[rr.room] !== false ? "A" : "D"));
      }).join("") + "|" +
      lightEdits.map(function (L) { return L.id + ":" + (L.r || 3).toFixed(1) + ":" + (L.a == null ? 0.5 : L.a).toFixed(2); }).join(";");
    if (sig === s._nightSig) return;
    s._nightSig = sig;

    rt.clear();
    var painted = false;

    // ② 环境光：整图压暗（户外/街道靠它）
    if (amb > 0.004) {
      if (!s._ambPen) {
        s._ambPen = new Phaser.GameObjects.Rectangle(s, 0, 0, W, H, 0x0a1020);
        s._ambPen.setOrigin(0, 0);
      }
      s._ambPen.setSize(W, H).setAlpha(amb).setPosition(0, 0);
      rt.draw(s._ambPen);
      painted = true;
    }

    // ③ 阴影区域"自己有浓度"：先把它们的矩形从环境光里擦干净（否则房间永远被压黑）
    if (painted && shadowEdits.length && s.textures.exists("white1")) {
      if (!s._ambErase) {
        s._ambErase = new Phaser.GameObjects.Image(s, 0, 0, "white1");
        s._ambErase.setOrigin(0, 0);          // 关键：左上角对齐，否则擦除位置偏半个矩形
      }
      var er = s._ambErase;
      er.setOrigin(0, 0).setAlpha(1);
      shadowEdits.forEach(function (r) {
        var w = Math.max(1, r.w) * TILE, h = Math.max(1, r.h) * TILE;
        er.setDisplaySize(w, h);
        rt.erase(er, Math.round(Math.max(0, r.x * TILE)), Math.round(Math.max(0, WALL_H + r.y * TILE)));
      });
    }

    // ③.5 没有被任何阴影块覆盖的房间：自动补一块默认阴影（夜 0.6 / 开灯 0.15 / 白天 0）
    //      否则那些房间会一直泡在环境光里，开灯也没反应（用户反馈的核心问题）
    var autoRegions = [];
    if (pv !== "day") {
      ROOM_RECTS.forEach(function (rr) {
        if (roomCovered(rr, shadowEdits)) return;
        var on = roomLights[rr.room] !== false;
        autoRegions.push({
          x: rr.x, y: rr.y, w: rr.w, h: rr.h,
          a: on ? 0.15 : Math.min(1, Math.max(0.5, amb + 0.25))
        });
      });
    }

    // ④ 每块阴影自己的暗块（夜 / 开灯 / 白天 三档）
    if (shadowEdits.length || autoRegions.length) {
      if (!s._shadowPen) {
        s._shadowPen = new Phaser.GameObjects.Rectangle(s, 0, 0, TILE, TILE, 0x0a1020);
        s._shadowPen.setOrigin(0, 0);
      }
      var pen = s._shadowPen;
      // 自动房间阴影先进来（用户自建的块画在它上面，覆盖它）
      autoRegions.forEach(function (r) {
        pen.setSize(Math.max(1, r.w) * TILE, Math.max(1, r.h) * TILE);
        pen.setAlpha(r.a);
        pen.setPosition(Math.round(Math.max(0, r.x * TILE)), Math.round(Math.max(0, WALL_H + r.y * TILE)));
        rt.draw(pen);
        painted = true;
      });
      shadowEdits.forEach(function (r) {
        var a = shadowAlphaOf(r);
        if (a <= 0.004) return;
        pen.setSize(Math.max(1, r.w) * TILE, Math.max(1, r.h) * TILE);
        pen.setAlpha(a);
        pen.setPosition(Math.round(Math.max(0, r.x * TILE)), Math.round(Math.max(0, WALL_H + r.y * TILE)));
        rt.draw(pen);
        painted = true;
      });
    }

    // ⑤ 点光源挖洞（路灯 / 壁灯 / 自定义光源）
    if (painted && lightEdits.length) {
      if (!s._lightErase) {
        s._lightErase = new Phaser.GameObjects.Image(s, 0, 0, lightHoleTex);
        s._lightErase.setOrigin(0, 0);
      }
      var hole = s._lightErase;
      hole.setOrigin(0, 0);
      lightEdits.forEach(function (L) {
        var a = (L.a == null ? 0.5 : L.a);
        var radius = Math.max(0.4, Math.min(8, L.r || 3)) * 0.8;
        var size = radius * TILE * 2;
        hole.setDisplaySize(size, size).setAlpha(Math.min(1, 0.2 + a * 1.5));
        rt.erase(hole,
          Math.round(L.x * TILE + TILE / 2 - size / 2),
          Math.round(WALL_H + L.y * TILE + TILE / 2 - size / 2));
      });
    }

    rt.setVisible(painted);
  }

  /* 自定义光源（v40）：用 lightpool 那张径向渐变贴图，ADD 叠加，depth 50000（和内置光池同层）
   * 每次重建都整体销毁重画 —— 灯通常只有几盏，代价可以忽略。 */
  function renderCustomLights(s) {
    if (!s || !s.add) return;
    (s.customLightSprites || []).forEach(function (sp) { try { sp.destroy(); } catch (e) {} });
    s.customLightSprites = [];
    if (!lightEdits.length) return;
    if (!s.textures.exists(lightPoolTex)) makeLightTexture(s);
    var nightK = isNightHour() ? 1 : 0.18;   // v43：白天只留一点点提示，别把地板糊成光斑
    lightEdits.forEach(function (L) {
      var r = Math.max(0.4, Math.min(8, L.r || 3));
      var img = s.add.image(L.x * TILE + TILE / 2, WALL_H + L.y * TILE + TILE / 2, lightPoolTex)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDisplaySize(r * TILE * 2, r * TILE * 2)
        .setAlpha(Math.max(0, Math.min(1, (L.a == null ? 0.5 : L.a) * nightK)))
        .setTint(L.tint == null ? 0xffd9a0 : L.tint)
        .setDepth(59200);   // v64：光在阴影（59100）之上，否则灯被阴影盖住
      img.lightId = L.id;
      s.customLightSprites.push(img);
    });
  }

  /* 把当前自定义层并进 mapdata（幂等）。
   * 关键：静态层先备份到 s.staticFurniture —— 旧实现直接在 mapdata.furniture 上 filter，
   * 隐藏掉的静态家具就从这个数组里永久消失了，「全部恢复」自然再也救不回来。 */
  function applyCustomFurniture(s) {
    if (!s || !s.mapdata) return;
    if (!s.staticFurniture) {
      s.staticFurniture = s.mapdata.furniture.filter(function (f) {
        return !f._custom && !isHideEntry(f) && !isMoveEntry(f) && !isFloorEntry(f) && !isTerrainEntry(f) && !isLightEntry(f) && !isShadowEntry(f);
      });
    }
    var objects = splitCustomLayer();
    var list = [];
    s.staticFurniture.forEach(function (f) {
      var key = f._key || furnitureKeyOf(f);
      if (hiddenKeys[key]) return;                                   // 被隐藏
      var mv = moveOverrides[key];
      var copy = Object.assign({}, f, { _key: key });
      if (mv) { copy.x = mv.x; copy.y = mv.y; copy._moved = true; }   // 静态家具被挪过
      list.push(copy);
    });
    objects.forEach(function (f) {
      if (!f || !f.a) return;
      list.push(Object.assign({}, f, { _custom: true }));
    });
    s.mapdata.furniture = list;
    renderEditOverlays(s);
    renderCustomLights(s);
    renderNightShadow(s);
  }
  /* 自定义层变化后重建整层家具（唯一入口：buildFurnitureLayer 负责拆旧 + 重算碰撞） */
  function rebuildCustomLayer() {
    var s = scene;
    if (!s || !s.mapdata) return;
    clearEditSelection();     // 选中框指向的精灵马上会被销毁
    var gridWasOn = !!gridOverlay;
    applyCustomFurniture(s);
    buildFurnitureLayer(s);
    // 碰撞格叠加层按"用户当前的选择"重画，别每次都硬打开（v38.1 加了开关）
    if (gridOverlay) { gridOverlay.destroy(); gridOverlay = null; }
    if (gridWasOn) toggleGrid(true);
    farmGfxRedrawSafe();
    if (editMode && typeof renderEditList === "function") renderEditList();
  }
  function farmGfxRedrawSafe() { try { if (farm && farmGfxTopmost()) drawFarm(); } catch (e) {} }
  function farmGfxTopmost() { return true; }

  /* v58：保存前清洗 —— hub 会因为任何一条坐标越界把整批 set 打回（"坐标越界"）。
   * 这里把 x/y 夹到 0..56 / 0..30 并保留 2 位小数，顺便丢掉 a 缺失的脏数据，返回改了哪些。 */
  function sanitizeCustomLayer(list) {
    var fixed = [], out = [], byCell = {}, byId = {};
    (list || []).forEach(function (f) {
      if (!f || typeof f !== "object" || !f.a) return;
      var g = Object.assign({}, f);
      if (g.x != null) {
        var x = Number(g.x); if (!isFinite(x)) x = 0;
        var cx = Math.min(56, Math.max(0, Math.round(x * 100) / 100));
        if (cx !== x) fixed.push((f.a || "?") + " x " + x + "→" + cx);
        g.x = cx;
      }
      if (g.y != null) {
        var y = Number(g.y); if (!isFinite(y)) y = 0;
        var cy = Math.min(30, Math.max(0, Math.round(y * 100) / 100));
        if (cy !== y) fixed.push((f.a || "?") + " y " + y + "→" + cy);
        g.y = cy;
      }
      // 同格去重：**只对贴片**（floor / terrain）做 —— 它们一格只该有一条；
      // 隐藏/移动/阴影/灯/物品天然会共用坐标（多个阴影块可以同起点，hide 全是 0,0），绝不能去重
      if (g.a === "floor" || g.a === "terrain") {
        var ck = g.a + "|" + (g.x == null ? "" : g.x) + "|" + (g.y == null ? "" : g.y) + "|" + (g.band ? 1 : 0) + "|" + (g.t || "");
        if (byCell[ck] != null) { out[byCell[ck]] = null; fixed.push((g.a || "?") + " 同格重复 → 保留最后一条"); }
        byCell[ck] = out.length;
      }
      // id 去重（hub 要求唯一，重复的换成新 id）
      if (g.id) {
        if (byId[g.id]) { g.id = g.id + (Math.floor(Math.random() * 1296)).toString(36); fixed.push("id 重复重命名"); }
        byId[g.id] = 1;
      }
      out.push(g);
    });
    out = out.filter(Boolean);
    return { list: out, fixed: fixed };
  }
  /* ---------- 本机镜像（hub 不可达时的兜底） ----------
   * v37 的兜底分支（if (!base) ...）永远进不去，因为 hubMapBase() 恒为非空串；
   * 结果本地没起 hub（或线上没反代）时，所有编辑都只换来一句 "Failed to fetch"，画面上什么都没发生。
   * 现在：改动先本地生效并落 localStorage，hub 能连上就是真相源，连不上也不至于白点。 */
  var LOCAL_MAP_KEY = "office_map_custom_v1";
  var mirrorPending = false;        // 本地有 hub 还没收到的改动
  var mirrorAt = 0;                 // 镜像最后一次写入时间：只有比 hub 新才补传，避免旧镜像把新存档盖掉
  var inflightMapOps = 0;           // 正在推给 hub 的编辑数：期间忽略 WS 广播，别把自己刚做的改动盖掉
  var mirrorFlushTried = false;
  var mirrorRetryTimer = null;      // 失败重试定时器
  var mirrorRetryCount = 0;
  var MIRROR_RETRY_MAX = 20;     // 重连后补传只试一次，避免和 WS 广播互相打架
  var hubUpdatedAt = 0;             // hub 侧 map.custom.json 的时间戳
  /* 保存结果（v39.4）：编辑器侧栏直接显示"存了几条 / 什么时候 / 失败原因"，
   * 之前 addEditLog 写的是游戏内面板的 DOM，独立编辑器里根本不存在 → 保存失败静默。 */
  var lastSave = { at: 0, ok: null, count: 0, err: "", hubCount: null };
  function noteSave(ok, err, count, hubCount) {
    lastSave = { at: Date.now(), ok: ok, count: count == null ? customFurniture.length : count, err: err || "", hubCount: hubCount == null ? null : hubCount };
    try { if (typeof window.onMapSaveResult === "function") window.onMapSaveResult(lastSave); } catch (e) {}
    return lastSave;
  }
  function saveLocalMirror() {
    try {
      mirrorAt = Date.now();
      localStorage.setItem(LOCAL_MAP_KEY, JSON.stringify({ furniture: customFurniture, updatedAt: mirrorAt, pending: mirrorPending }));
    } catch (e) {}
  }
  function loadLocalMirror() {
    try {
      var j = JSON.parse(localStorage.getItem(LOCAL_MAP_KEY) || "null");
      if (j && Array.isArray(j.furniture)) return j;
    } catch (e) {}
    return null;
  }
  /* 首建后调用：hub 没给自定义层时，用本机镜像顶上（离线编辑过的内容刷新不丢） */
  function adoptLocalMirror() {
    if (customFurniture.length) return false;
    var m = loadLocalMirror();
    if (!m || !m.furniture.length) return false;
    var cleaned = sanitizeCustomLayer(m.furniture.filter(function (f) { return f && f.a; }));
    customFurniture = cleaned.list;
    if (cleaned.fixed.length) addEditLog("已修正镜像里的越界坐标：" + cleaned.fixed.join("；"));
    mirrorPending = !!m.pending;
    mirrorAt = Number(m.updatedAt) || 0;
    rebuildCustomLayer();
    return true;
  }
  /* WS hello / map 广播 / 手动重载：hub 是真相源 */
  function applyCustomMap(list, fromHub, updatedAt) {
    if (fromHub && (inflightMapOps > 0 || (typeof meEditing !== "undefined" && meEditing))) return;                       // 自己的改动正在推：本地状态更新，别回滚
    if (fromHub && mirrorPending) {
      // 只有「本机改动比 hub 新」才补传；否则以 hub 为准（v39.4：旧镜像曾把新存档整个盖掉）
      if (mirrorAt > hubUpdatedAt) { flushLocalMirror(); return; }
      mirrorPending = false;
    }
    customFurniture = (list || []).filter(function (f) { return f && f.a; });
    if (fromHub) {
      if (updatedAt) hubUpdatedAt = updatedAt;
      hubMapOk = true; hubMapErr = "";
      mirrorPending = false; mirrorFlushTried = false;
      saveLocalMirror();
    }
    if (scene && scene.mapdata) rebuildCustomLayer();
    if (typeof renderEditList === "function" && editMode) renderEditList();
  }
  /* 本地镜像 → hub（只在重连/收到广播时试一次） */
  function flushLocalMirror() {
    if (mirrorFlushTried) return;
    mirrorFlushTried = true;
    var cl = sanitizeCustomLayer(customFurniture);       // v58：补传前也纠正越界坐标
    if (cl.fixed.length) { customFurniture = cl.list; saveLocalMirror(); addEditLog("补传前修正：" + cl.fixed.join("；")); }
    postMapApi({ action: "set", item: customFurniture }, function (ok, err) {
      if (ok) { mirrorPending = false; saveLocalMirror(); addEditLog("已把本机改动同步到 hub（" + customFurniture.length + " 条）"); }
      else addEditLog("本机改动同步失败：" + err);
    });
  }
  /* 手动同步入口（排障三件套之一）：控制台跑 __officeMapSync() 强制把本机镜像推上 hub。
   * 与自动补传的区别：不判断 pending/时间戳，就是无条件覆盖——用户明确说"以我本地为准"时用。 */
  function forceSyncMirror() {
    if (!customFurniture.length) return "本机镜像为空，没有可同步的内容（若你认为本地有改动，先在编辑器里保存一次）";
    mirrorFlushTried = false;            // 允许重新补传
    var cl = sanitizeCustomLayer(customFurniture);
    if (cl.fixed.length) { customFurniture = cl.list; }
    postMapApi({ action: "set", item: customFurniture }, function (ok, err) {
      if (ok) {
        mirrorPending = false; mirrorAt = Date.now(); saveLocalMirror();
        editToast("已把本机改动同步到线上（" + customFurniture.length + " 条家具）");
      } else editToast("同步失败：" + err + "（稍后重试 __officeMapSync()）");
    });
    return "同步中…（看编辑器侧栏或稍后 __officeMapInfo() 确认 pending 变 false）";
  }
  try { window.__officeMapSync = forceSyncMirror; } catch (e) {}
  /* v57：hub 掉线时点的"保存/删除"不会丢，恢复后自动补传（最多 20 次，间隔 3 秒） */
  function scheduleMirrorRetry() {
    if (mirrorRetryTimer || mirrorRetryCount >= MIRROR_RETRY_MAX) return;
    mirrorRetryTimer = setTimeout(function () {
      mirrorRetryTimer = null;
      if (!mirrorPending) { mirrorRetryCount = 0; return; }
      mirrorRetryCount++;
      var cl2 = sanitizeCustomLayer(customFurniture);
      if (cl2.fixed.length) { customFurniture = cl2.list; saveLocalMirror(); }
      postMapApi({ action: "set", item: customFurniture }, function (ok, err) {
        if (ok) { mirrorRetryCount = 0; mirrorPending = false; saveLocalMirror(); addEditLog("已自动补传（" + customFurniture.length + " 条）"); }
        else scheduleMirrorRetry();
      });
    }, 3000);
  }
  function postMapApi(body, cb) {
    var sent = (body && Array.isArray(body.item)) ? body.item.length : customFurniture.length;
    fetch(hubMapUrl(), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().then(function (j) { return { status: r.status, j: j }; })
        .catch(function () { return { status: r.status, j: null }; });   // 反代/静态站返回 HTML 时别炸在 JSON.parse
    }).then(function (r) {
      if (r.j && r.j.ok) {
        hubMapOk = true; hubMapErr = "";
        if (r.j.updatedAt) hubUpdatedAt = r.j.updatedAt;
        noteSave(true, "", sent, typeof r.j.count === "number" ? r.j.count : null);
        if (cb) cb(true, "");
      } else {
        var e = (r.j && r.j.error) || ("HTTP " + r.status);
        hubMapOk = false; hubMapErr = e;
        noteSave(false, e, sent, null);
        if (cb) cb(false, e);
      }
    }).catch(function (e) {
      hubMapOk = false; hubMapErr = e.message || "网络错误";
      noteSave(false, hubMapErr, sent, null);
      if (cb) cb(false, hubMapErr);
    });
  }
  /* 启动探活：决定调试台显示"走 hub"还是"存本机" */
  function probeMapHub(cb) {
    fetch(hubMapUrl(), { method: "GET" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (j) {
      hubMapOk = true; hubMapErr = "";
      if (j && j.updatedAt) hubUpdatedAt = j.updatedAt;
      if (cb) cb(true, j);
    }).catch(function (e) {
      hubMapOk = false; hubMapErr = e.message || "网络错误";
      if (cb) cb(false, null);
    });
  }
  /* 保存并回读校验（v39.4）：写完立刻 GET 一次 hub，把「存了几条 / hub 现在几条」告诉调用方，
   * 这样"点了保存没反应"能当场看见到底写没写进去。 */
  function saveMapAndVerify(cb) {
    saveEditMap(false, null, function (ok, err) {
      if (!ok) { if (cb) cb(false, err, null); return; }
      fetch(hubMapUrl(), { method: "GET" }).then(function (r) { return r.json(); }).then(function (j) {
        var n = Array.isArray(j && j.furniture) ? j.furniture.length : null;
        if (j && j.updatedAt) hubUpdatedAt = j.updatedAt;
        lastSave.hubCount = n;
        if (cb) cb(true, "", n);
      }).catch(function (e) { if (cb) cb(true, "", null); });
    });
    return true;
  }
  /* 编辑模式开关：鱼停、点击语义切换、显示网格 */
  function setEditMode(on) {
    if (!scene || !fish) return editMode;
    editMode = !!on;
    var btn = document.getElementById("edit-mode-btn");
    if (btn) {
      btn.classList.toggle("active", editMode);
      btn.setAttribute("aria-pressed", String(editMode));
      btn.textContent = editMode ? "✏ 编辑中" : "✏ 编辑地图";
    }
    if (editMode) {
      stopIdleLife();
      hideBubble();
      if (scene.cameras) scene.cameras.main.stopFollow();   // 镜头交给用户，不再每帧被鱼拽走
      applyRoomLights(scene);                               // 编辑器里强制全亮：去掉夜间黑遮罩（灰蒙版）
      if (!gridOverlay && !editorMode) toggleGrid(true);    // 独立编辑器默认不显示碰撞格，侧栏里按需开
      buildEditPanel();
      renderEditList();
      var panel0 = document.getElementById("edit-panel");
      if (panel0 && !editorMode) panel0.style.display = "block";
      if (!editorMode) showBubble("（编辑模式：选资产后点地图放置；拖动物品移动；删除工具点物品移除）", "idle");
    } else {
      clearEditGhost();
      clearEditSelection();
      editDragItem = null;
      editTool = "select";
      setEditTool("select");
      var panel1 = document.getElementById("edit-panel");
      if (panel1) panel1.style.display = "none";
      if (scene && scene.cameras && fish) scene.cameras.main.startFollow(fish, true, 0.08, 0.08);   // 交还镜头
      startIdleLife(800);
      saveEditMap(true);   // 退出时若有改动顺手保存（静默）
    }
    return editMode;
  }
  function setEditTool(t) {
    editTool = t;
    ["select", "add", "move", "delete"].forEach(function (k) {
      var b = document.getElementById("edit-tool-" + k);
      if (b) b.classList.toggle("active", k === t);
    });
    if (t !== "add") clearEditGhost();
    if (t !== "select") clearEditSelection();
    updateEditHint();
  }
  function setEditAsset(a) {
    editAsset = a;
    [].forEach.call(document.querySelectorAll("#edit-assets button"), function (b) {
      b.classList.toggle("active", b.dataset.asset === a);
    });
    if (a) setEditTool("add");
    updateEditHint();
  }
  /* 面板底部那行"当前在干什么"：工具 / 资产 / 选中的物件（v37.2） */
  function updateEditHint() {
    var el = document.getElementById("edit-sel");
    if (!el) return;
    var label = { select: "🖱 选择", add: "➕ 放置", move: "✥ 移动", delete: "🗑 删除" }[editTool] || editTool;
    var t;
    if (editTool === "add") {
      t = editAsset ? "工具 " + label + " · 资产 " + editAsset + " → 点地图放置"
                    : "工具 " + label + " · 先在下面点一件资产";
    } else if (editTool === "move") {
      t = "工具 " + label + " · 点住自定义物品拖到新位置";
    } else if (editTool === "delete") {
      t = "工具 " + label + " · 点自定义物品即删除";
    } else {
      t = editSelItem ? ("工具 " + label + " · 已选中 " + (editSelItem.f && editSelItem.f.a) + " @ " + (editSelItem.f && (editSelItem.f.x + "," + editSelItem.f.y)))
                      : "工具 " + label + " · 点自定义物品可查看坐标";
    }
    el.textContent = t;
  }
  /* v44：坐标吸附（唯一入口）——map.json 里 f.x 的含义是「格中心」，world = f.x*TILE + TILE/2。
   * 旧代码放置时多加了 0.5 格，于是物品总是落在鼠标右下方半格（"摆放位置跟鼠标不一致"的根因）。 */
  function editSnapX(worldX) {
    var v = Math.round((worldX - TILE / 2) / TILE * 10) / 10;
    return Math.min(55.5, Math.max(0.5, v));
  }
  function editSnapY(worldY) {
    var v = Math.round((worldY - WALL_H - TILE / 2) / TILE * 10) / 10;
    return Math.min(29.5, Math.max(0.5, v));
  }
  function editSnapToWorld(sx, sy) {
    return { x: sx * TILE + TILE / 2, y: WALL_H + sy * TILE + TILE / 2 };
  }
  /* 朝向：0=南 1=东 2=北 3=西（与 manifest 的 rows 行序一致，帧号 = 行 × 8） */
  var EDIT_ROT = 0;
  var ROT_LABEL = ["南", "东", "北", "西"];
  var ROT_ROW = [0, 1, 3, 2];
  function editFrameFor(asset, rot) {
    var man = MAN && MAN[asset];
    if (!man || !man.rows) return 0;
    var keys = Object.keys(man.rows);
    if (keys.length < 2) return 0;                  // 只有一个朝向：没法转
    var per = man.rows.South || man.rows[keys[0]] || 1;   // 每行帧数（家具=1，角色=8）
    var row = ROT_ROW[rot & 3];                     // 南0 东1 北3 西2（manifest 行序：S,E,W,N）
    return row * per;
  }
  function rotatable(asset) {
    var man = MAN && MAN[asset];
    if (!man || !man.rows) return false;
    return Object.keys(man.rows).length >= 2;
  }
  function clearEditGhost() {
    if (editGhost) { editGhost.destroy(); editGhost = null; }
  }
  function updateEditGhost(worldX, worldY) {
    if (editTool !== "add" || !editAsset || !scene) return;
    if (!editGhost) {
      editGhost = scene.add.image(worldX, worldY, editAsset, 0).setAlpha(0.55);
      var m = MAN[editAsset];
      if (m) {
        var bbox = bboxForFrame(m, editFrameFor(editAsset, EDIT_ROT));   // v45：预览也按当前朝向的 bbox 校准脚点
        editGhost.setOrigin((bbox[0] + bbox[2] / 2) / m.frameW, (bbox[1] + bbox[3]) / m.frameH);
      }
    }
    editGhost.setTexture(editAsset);
    var fr = editFrameFor(editAsset, EDIT_ROT);
    if (fr && editGhost.setFrame) editGhost.setFrame(fr);
      var gm0 = MAN[editAsset];                    // v45：换行 → 内容框变了 → 脚点重算，否则转一次预览就歪
      if (gm0) {
        var gbb = bboxForFrame(gm0, fr || 0);
        editGhost.setOrigin((gbb[0] + gbb[2] / 2) / gm0.frameW, (gbb[1] + gbb[3]) / gm0.frameH);
      }
    // v51：落在墙带时预览也贴到墙带底边（和真实落点一致）
    var wp = (worldY < WALL_H && meWallAsset(editAsset))
      ? { x: editSnapX(worldX) * TILE + TILE / 2, y: WALL_H }
      : editSnapToWorld(editSnapX(worldX), editSnapY(worldY));   // v44：和落点用同一套坐标（所见即所得）
    editGhost.setPosition(wp.x, wp.y);
    editGhost.setDepth(96000);
  }
  /* ---------- 选中态（v37.2） ----------
   * 之前 select 工具点物件什么都不发生、资产/工具按钮点了也没有任何视觉变化
   * （.active 类有，CSS 却没有），看起来就像"选不了物件"。这里补三种反馈：
   * 画布上的虚线框 + 面板底部文字 + 列表行高亮。 */
  var editSelItem = null;
  var editSelMark = null;
  function clearEditSelection() {
    editSelItem = null;
    if (editSelMark) { editSelMark.destroy(); editSelMark = null; }
    [].forEach.call(document.querySelectorAll("#edit-list .ep-row"), function (r) { r.classList.remove("row-sel"); });
    updateEditHint();
  }
  function markEditSelection(p) {
    editSelItem = p;
    if (!p || !scene) return;
    var w = (p.bbox[2] || TILE) * (p.scale || 1), h = (p.bbox[3] || TILE) * (p.scale || 1);
    var x0 = p.x - w / 2 - 4, y0 = p.y - h - 4;
    if (!editSelMark) editSelMark = scene.add.graphics().setDepth(97000);
    var gfx = editSelMark;
    gfx.clear();
    gfx.lineStyle(2, 0x4a6cf7, 0.95);
    gfx.strokeRect(x0, y0, w + 8, h + 8);
    gfx.lineStyle(3, 0xffd43b, 0.9);
    gfx.beginPath(); gfx.moveTo(x0, y0 + 1); gfx.lineTo(x0 + w + 8, y0 + 1); gfx.strokePath();   // 顶边加重
    updateEditHint();
    var selKey = p.f ? furnitureKeyOf(p.f) : "";
    [].forEach.call(document.querySelectorAll("#edit-list .ep-row"), function (r) {
      r.classList.toggle("row-sel", !!selKey && r.dataset.key === selKey);
    });
  }
  /* 命中盒：内容 bbox（点家具身上就算中），旧版只认脚点 36px，衣柜/床点身子必然选不中。
   * v37.4 再放宽：四周 pad 8px、最小 0.7 格，小物件（硬币/护身符）也能点中。 */
  function hitBox(p, worldX, worldY, pad) {
    pad = pad == null ? 8 : pad;
    var w = (p.bbox[2] || 24) * (p.scale || 1), h = (p.bbox[3] || 24) * (p.scale || 1);
    var halfW = Math.max(w, TILE * 0.7) / 2 + pad;
    return worldX >= p.x - halfW && worldX <= p.x + halfW &&
      worldY >= p.y - h - pad && worldY <= p.y + pad;
  }
  function pickEditItem(worldX, worldY) {
    var best = null, bestDepth = -Infinity;
    customPlaceholders.forEach(function (p) {
      if (!p.spr || !p.spr.active || !hitBox(p, worldX, worldY)) return;
      var d = p.spr.depth || 0;
      if (d > bestDepth) { bestDepth = d; best = p; }
    });
    if (best) return best;
    var bestD = Infinity;   // 退路：脚点 0.9 格内（小物件/贴墙物件）
    customPlaceholders.forEach(function (p) {
      if (!p.spr || !p.spr.active) return;
      var d = Math.max(Math.abs(p.x - worldX), Math.abs(p.y - worldY));
      if (d <= TILE * 0.9 && d < bestD) { bestD = d; best = p; }
    });
    return best;
  }
  /* map.json 的静态家具：v37.4 起也能点中（可用 ✕/删除工具"隐藏"掉） */
  function hitStaticItem(worldX, worldY) {
    var best = null, bestDepth = -Infinity;
    (scene && scene.placed || []).forEach(function (p) {
      if (!p.spr || !p.spr.active || !p.f || p.f._custom || p.f.on) return;
      if (!hitBox(p, worldX, worldY)) return;
      var d = p.spr.depth || 0;
      if (d > bestDepth) { bestDepth = d; best = p; }
    });
    return best;
  }
  /* 画布上的短提示（贴在点击处，1.5s 淡出）。用 DOM 而不是鱼头顶的气泡——
   * 编辑时鱼可能在别的房间，气泡根本看不见，用户只会觉得"点了没反应"。 */
  var editToastTimer = null;
  function editToast(msg, worldX, worldY, clientX, clientY) {
    var host = document.getElementById("office-parent");
    if (!host) return;
    var el = document.getElementById("edit-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "edit-toast";
      el.style.cssText = "position:absolute;z-index:48;pointer-events:none;padding:5px 9px;border-radius:7px;" +
        "background:#11151ff2;border:1px solid #ffffff33;color:#ece8df;font:12px/1.5 'PingFang SC','Microsoft YaHei',system-ui,sans-serif;" +
        "box-shadow:0 4px 14px #0008;transform:translate(-50%,-120%);transition:opacity .25s;opacity:0;white-space:nowrap;max-width:260px;overflow:hidden;text-overflow:ellipsis;";
      host.appendChild(el);
    }
    var hostRect = host.getBoundingClientRect();
    var x = clientX != null ? clientX - hostRect.left : 120;
    var y = clientY != null ? clientY - hostRect.top : 120;
    el.textContent = msg;
    el.style.left = Math.max(60, Math.min(hostRect.width - 60, x)) + "px";
    el.style.top = Math.max(24, Math.min(hostRect.height - 24, y)) + "px";
    el.style.opacity = "1";
    clearTimeout(editToastTimer);
    editToastTimer = setTimeout(function () { el.style.opacity = "0"; }, 1500);
    addEditLog(msg);
  }
  /* 隐藏一件静态家具（写进自定义层，可一键恢复） */
  function hideStaticItem(p, clientX, clientY) {
    var key = furnitureKeyOf(p.f || p);
    if (hiddenKeys[key]) return;
    saveEditMap(false, { action: "add", item: hideEntryFor(key) }, function (ok, err) {
      if (ok) editToast("已隐藏 " + (p.f && p.f.a) + "（面板底部可一键恢复）", p.x, p.y, clientX, clientY);
      else editToast("已在本机隐藏（hub 未同步：" + err + "）", p.x, p.y, clientX, clientY);
    });
  }
  function focusOnPlacement(p) {
    var cam = scene && scene.cameras.main;
    if (!cam || !p) return;
    cam.stopFollow();
    cam.pan(p.x, Math.max(0, p.y - 24), 260, "Sine.easeInOut");
  }









