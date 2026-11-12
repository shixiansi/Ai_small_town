/* 本文件由 office/tools/build.mjs 从 web/src/*.js 拼接压缩生成，别直接改这里。改动请改 src/ 再 build。 */
(function () {
"use strict";
var TILE = 48;
var roomLights = { office: true, bedroom: false, kitchen: false, bath: false, nbCat: true, nbChief: true, nbDoc: true };   // v83：邻居三户默认开灯
function bboxForFrame(m, frame) {
if (!m) return [0, 0, 48, 48];
var rows = (m.rows && m.rows.South) || 1;
var row = Math.max(0, Math.floor((frame || 0) / rows));
if (m.bboxRows && m.bboxRows[row]) return m.bboxRows[row];
return m.bbox || [0, 0, m.frameW, m.frameH];
}
var COLS = 56, ROWS = 30, WALL_H = 48;   // 56x30：南排=办公室(0-24, rows16-29)；北排=卧室(2-9)/卫浴(11-15)；东侧=花园(27-37)/街道(39-55) 全高
var W = COLS * TILE, H = ROWS * TILE + WALL_H;
var forceNight = null;
var ASSET_V = "a2ac8525";
var TILE_V = "5bf6be12";
var STATE_MAP = {
arrive:    { zone: "door",    act: "walk",   verb: "到岗",      mood: "working" },
working:   { zone: "desk",    act: "typing", verb: "在忙",      mood: "working", fx: "pc" },
browsing:  { zone: "desk",    act: "typing", verb: "刷B站",     mood: "working", fx: "pc" },
watching:  { zone: "dining",  act: "watch",  verb: "看视频",    mood: "working" },
organizing:{ zone: "library", act: "fetch",  verb: "整理记忆",  mood: "working" },
writing:   { zone: "desk",    act: "typing", verb: "写文章",    mood: "working", fx: "pc" },
rewriting: { zone: "desk",    act: "typing", verb: "改稿",      mood: "working", fx: "pc" },
diary:     { zone: "desk",    act: "typing", verb: "写日记",    mood: "working", fx: "pc" },
designing: { zone: "tools",   act: "craft",  verb: "做封面",    mood: "working" },
posting:   { zone: "printer", act: "print",  verb: "发B站动态", mood: "working", fx: "printer" },
mailing:   { zone: "mail",    act: "mail",   verb: "发邮件",    mood: "working" },
replying:  { zone: "desk",    act: "typing", verb: "回评论",    mood: "working", fx: "pc" },
commenting:{ zone: "dining",  act: "typing", verb: "B站评论",   mood: "working" },
weekly:    { zone: "desk",    act: "typing", verb: "写周报",    mood: "working", fx: "pc" },
error:     { zone: "sofa",    act: "dizzy",  verb: "出错了",    mood: "error" },
idle:      { zone: "sofa",    act: "idle",   verb: "摸鱼中",    mood: "idle" },
sleeping:  { zone: "bed",     act: "sleep",  verb: "睡觉",      mood: "sleeping" },
washing:   { zone: "washup",  act: "watch",  verb: "洗漱",      mood: "working" },
eating:    { zone: "cook",    act: "fetch",  verb: "吃饭",      mood: "idle" },
snacking:  { zone: "fridge",  act: "fetch",  verb: "找吃的",    mood: "idle" },
relaxing:  { zone: "relax",   act: "rest",   verb: "放松",      mood: "idle" },
strolling: { zone: "garden",  act: "walk",   verb: "散步",      mood: "idle" },
browsing_market: { zone: "market", act: "fetch", verb: "逛市集", mood: "idle" },
recovering:{ zone: "recover", act: "rest",   verb: "充电恢复",  mood: "sleeping" },
listening: { zone: "relax",   act: "listen", verb: "听音乐",    mood: "idle" },
gaming:    { zone: "arcade",  act: "play",   verb: "打游戏",    mood: "idle" },
celebrating: { zone: "board",  act: "cheer",  verb: "庆祝上热门", mood: "happy" },
tired:     { zone: "sofa",    act: "rest",   verb: "累瘫了",    mood: "tired" },
};
var ACTIVE_STATES = ["arrive", "working", "browsing", "watching", "organizing", "writing", "rewriting",
"diary", "designing", "posting", "mailing", "replying", "commenting", "weekly",
"washing", "eating", "snacking", "relaxing", "strolling", "browsing_market", "recovering", "listening", "gaming",
"celebrating", "tired"];
var SCHEDULE = {
tz: "Asia/Shanghai",
wake: [8, 23],   // 这段时间里没有真实事件 → hub 回落成「摸鱼」；之外才回落到睡觉（见 hub/hub.mjs）
shifts: [
{ at: "08:00", dur: 1, label: "起床洗漱", note: "洗漱台 · 一天从这里开始", state: "washing" },
{ at: "08:30", dur: 1, label: "早饭", note: "厨房 · 煮点东西吃", state: "eating" },
{ at: "09:00", dur: 6, label: "上午的营生", note: "工位 · 写写画画，收拾小镇里的事", state: "working" },
{ at: "10:00", weekday: 0, dur: 3, label: "赶集日", note: "周日的市集更热闹，去逛一圈", state: "browsing_market" },
{ at: "12:00", dur: 1, label: "午饭", note: "餐桌 · 顺便看看窗外", state: "eating" },
{ at: "13:00", dur: 1, label: "午后小憩", note: "充电垫 · 回一回精力", state: "recovering" },
{ at: "15:00", dur: 2, label: "散步逛市集", note: "花园 / 市集 · 天气好就走远一点", state: "strolling" },
{ at: "18:00", dur: 1, label: "晚饭", note: "厨房 · 一天里最舍得花时间的一顿", state: "eating" },
{ at: "20:00", dur: 2, label: "放松时间", note: "沙发 / 留声机 · 听歌、翻书、打游戏", state: "relaxing" },
{ at: "22:00", dur: 1, label: "洗澡", note: "卫浴 · 睡前洗漱", state: "washing" },
{ at: "23:00", dur: 9, label: "睡觉", note: "卧室 · 灯留一盏，一直睡到明早 08:00", state: "sleeping" }
]
};
var ACT_ICON = {
arrive: "🚪", working: "🖥️", browsing: "🖥️", watching: "📺", organizing: "📚", writing: "✍️",
rewriting: "✍️", diary: "📔", designing: "🎨", posting: "🖨️", mailing: "📮", replying: "💬",
commenting: "💬", weekly: "📊", error: "❌", idle: "🛋️", sleeping: "😴", washing: "🚿",
eating: "🍚", snacking: "🧊", relaxing: "😌", strolling: "🌳", browsing_market: "🛒",
recovering: "🔋", listening: "🎵", gaming: "🎮", celebrating: "🎉", tired: "🥱"
};
var SCALE_TABLE = {
"coffee-mug": 0.32, "stapler": 0.4, "calculator": 0.4, "open-book": 0.45,
"paper-stack": 0.5, "book-stack": 0.5, "pencil-cup": 0.55, "desk-lamp": 0.6,
"phone-desk": 0.5, "globe-desk": 0.65, "clock-desk": 0.65, "laptop": 0.55,
"trophy-cup": 0.65, "computer": 1.05, "printer": 0.85,
"bookshelf-office": 1.0, "office-chair": 1.0,
"sofa": 1.0, "round-table": 0.9, "cabinet": 1.0, "filing-cabinet": 1.0,
"locker": 1.0, "water-cooler": 1.0, "plant-office": 1.0, "floor-lamp": 1.0,
"blackboard": 1.0, "whiteboard": 1.0,
"office-desk": 1.3, "dining-table": 1.0, "desk-wood": 1.3, "nightstand": 0.8,
"school-desk": 0.9, "chair": 0.85,
"double-bed": 1.1, "wardrobe": 1.0, "curtains": 1.0, "mirror": 0.95, "toilet": 0.9,
"bathtub": 1.0, "fridge": 1.0, "stove-kitchen": 1.0, "kitchen-counter": 1.0,
"sink": 0.95, "fruit-bowl": 0.5, "kettle": 0.45, "mailbox": 0.9, "armchair": 1.0,
"gramophone": 0.95, "arcade-cabinet": 1.0, "crown-cushion": 0.6, "bench-park": 1.0,
"oak-tree": 1.6, "street-lamp": 1.1, "market-stall": 1.15, "stall-fruit": 1.15,
"coin": 0.4, "potion-shelf": 1.0, "fence": 0.7, "sign-inn": 1.0, "fence-picket": 0.9,
"bush": 0.9, "flowers": 0.7
};
var game = null;
var scene = null;
var fish = null;
var fishState = "boot";       // boot | walking | acting | idle
var curPlan = null;
var bubble = null, bubbleText = null;
var ws = null, wsTimer = null, reconnectDelay = 2000;
var lastServerTs = 0;
var lastEventState = "", lastEventTask = "";   // 心跳/重复事件去重：不让鱼原地重走一遍
var idleTimer = null;
var actTickTimer = null;
var MAN = null;               // manifest 引用
function px2tx(p) { return Math.floor(p / TILE); }
function px2ty(p) { return Math.floor((p - WALL_H) / TILE); }
var loadErrors = [];
function onLoadError(file) {
var k = (file && (file.key || file.src)) || "未知资源";
if (loadErrors.indexOf(k) < 0) loadErrors.push(k);
}
function showLoadError(errs) {
var el = document.getElementById("loading");
if (!el) { console.error("[office] 资源加载失败:", errs); return; }
el.classList.remove("hide");
el.style.cssText += ";flex-direction:column;padding:24px;text-align:center;line-height:1.8;";
el.textContent = "";
var h = document.createElement("div");
h.textContent = "办公室资源加载失败";
h.style.cssText = "color:#ff8787;font-size:15px;margin-bottom:8px";
var d = document.createElement("div");
d.style.cssText = "color:#9a9daa;font-size:12px;max-width:520px";
d.textContent = "有 " + errs.length + " 个资源没能加载：" + errs.slice(0, 6).join("、") +
(errs.length > 6 ? " 等" : "") + "。线上多半是漏同步了 assets/（跑一次 sync_web.sh），本地请确认 assets 目录完整。";
var a = document.createElement("a");
a.textContent = "点此刷新重试";
a.href = "#";
a.onclick = function (e) { e.preventDefault(); location.reload(); };
a.style.cssText = "color:#4a6cf7;margin-top:12px;font-size:13px";
el.appendChild(h); el.appendChild(d); el.appendChild(a);
console.error("[office] 资源加载失败:", errs);
}
function SceneBoot() { Phaser.Scene.call(this, { key: "boot" }); }
SceneBoot.prototype = Object.create(Phaser.Scene.prototype);
SceneBoot.prototype.constructor = SceneBoot;
SceneBoot.prototype.preload = function () {
loadErrors = [];
this.load.off("loaderror", onLoadError);
this.load.on("loaderror", onLoadError);
this.load.json("manifest", "assets/manifest.json?v=eb7ab1a1");
this.load.json("mapdata", "map.json?v=3c831e6e");
};
SceneBoot.prototype.create = function () {
var manifest = this.cache.json.get("manifest");
var mapdata = this.cache.json.get("mapdata");
if (loadErrors.length || !manifest || !mapdata) {
showLoadError(loadErrors.length ? loadErrors : ["manifest.json / map.json 读取失败"]);
return;   // 不带缺失纹理启动 office 场景
}
Object.keys(manifest).forEach(function (k) {
var m = manifest[k];
this.load.spritesheet(k, "assets/" + k + ".png?v=" + ASSET_V, { frameWidth: m.frameW, frameHeight: m.frameH });
}, this);
TILE_MATS.forEach(function (mat) {
this.load.image("tile-" + mat, "assets/tiles/" + mat + ".png?v=" + TILE_V);
}, this);
this.load.image("window", "assets/tiles/window.png?v=" + TILE_V);
this.load.image("switch", "assets/tiles/switch-off.png?v=" + TILE_V);
this.load.image("switch-on", "assets/tiles/switch-on.png?v=" + TILE_V);
this.load.image("lamp-off", "assets/tiles/lamp-off.png?v=" + TILE_V);
this.load.image("lamp-on", "assets/tiles/lamp-on.png?v=" + TILE_V);
this.load.image("window-night", "assets/tiles/window-night.png?v=" + TILE_V);
manifest["switch"] = { frameW: TILE, frameH: TILE, rows: { South: 1 }, anim: null, bbox: [13, 12, 22, 26], px: TILE,
states: { on: "switch-on", off: "switch" } };
manifest["wall-lamp"] = { frameW: TILE, frameH: TILE, rows: { South: 1 }, anim: null, bbox: [13, 7, 22, 30], px: TILE,
states: { on: "lamp-on", off: "lamp-off" } };
manifest.window = { frameW: TILE, frameH: TILE, rows: { South: 1 }, anim: null, bbox: [0, 0, TILE, TILE], px: TILE,
states: { night: "window-night", day: "window" } };
this.load.once("complete", function () {
if (loadErrors.length) { showLoadError(loadErrors); return; }
this.scene.start("office", { manifest: manifest, mapdata: mapdata });
}, this);
this.load.start();
};
function SceneOffice() { Phaser.Scene.call(this, { key: "office" }); }
SceneOffice.prototype = Object.create(Phaser.Scene.prototype);
SceneOffice.prototype.constructor = SceneOffice;
SceneOffice.prototype.init = function (data) {
this.manifest = data.manifest;
this.mapdata = data.mapdata;
MAN = data.manifest;
};
SceneOffice.prototype.create = function () {
scene = this;
var cv = this.game.canvas;
if (cv) {
cv.setAttribute("role", "img");
cv.setAttribute("aria-label",
"大肥鱼的像素办公室：蓝发鲸鱼女仆按真实工作状态在工位、餐桌、书架、沙发等区域走动。点地图让她走过去，点沙发、床、冰箱等家具会触发互动小动作。");
}
buildRoom(this);
buildFurniture(this);   // 家具先建（含碰撞推导）
buildFish(this);
buildLights(this);
try { adoptLocalMirror(); } catch (e) {}
window.__officeMapInfo = function () {
try {
var m = JSON.parse(localStorage.getItem("office_map_custom_v1") || "null");
return { local: m ? { count: (m.furniture || []).length, updatedAt: new Date(m.updatedAt || 0).toLocaleString(), pending: !!m.pending } : null,
hubCount: (window.__officeHubCount != null) ? window.__officeHubCount : "未知（连接 hub 后可见）" };
} catch (e) { return { error: String(e) } }
};
window.__officeMapReset = function () {
try { localStorage.removeItem("office_map_custom_v1"); } catch (e) {}
location.reload();
return "本地镜像已清空，页面刷新后以 hub 为准";
};
probeMapHub(function (ok, j) {
if (!ok) return;
if (mirrorPending) { flushLocalMirror(); return; }   // 上次离线改的：hub 这次通了就补传上去
if (!customFurniture.length && j && Array.isArray(j.furniture) && j.furniture.length) {
applyCustomMap(j.furniture, true);
}
});
this.trophyLayer = this.add.container(0, 0).setDepth(30);      // 灯光：初始 = 关灯（hello 初始态"办公室还没开灯"）
this.cameras.main.setBounds(0, 0, W, H);
if (!editorMode) this.cameras.main.startFollow(fish, true, 0.08, 0.08);   // 编辑器里镜头不跟鱼
this.cameras.main.setDeadzone(300, 300);
buildRoomTabs(this);    // 房间切换 UI
buildWeather(this);     // 天气层
buildNPCs(this);        // 小镇居民（方案 §3）
farmLoad();             // 农场/鱼塘/料理（v36）：读档 + 画田地 + 塘面鱼影
drawFarm(this);
buildPondLife(this);
var loading = document.getElementById("loading");
if (loading) loading.classList.add("hide");
var ppClose = document.getElementById("pp-close");
if (ppClose) ppClose.onclick = hidePerfPanel;
bindClick(this);
connectWS();
if (!editorMode) startIdleLife(1500);   // 独立编辑器里鱼不用自己溜达
if (editorMode) { try { setEditMode(true); } catch (e) { console.warn("[editor] 进入编辑模式失败", e); } }
};
var weather = "sunny";   // sunny | rainy
var rainParts = [];
function buildWeather(s) {
for (var i = 0; i < 80; i++) {
var r = s.add.rectangle(Math.random() * W, Math.random() * H, 1.5, 10, 0x9db8e8, 0.5).setDepth(55000);
r.visible = false;
rainParts.push(r);
}
s.overcast = s.add.rectangle(0, 0, 1248, 768, 0x3a4a66, 0.22).setOrigin(0.5).setDepth(54000).setVisible(false).setScrollFactor(0);
s.overcast.setDisplaySize(1248 * 4, 768 * 4);
}
function setWeather(s, w) {
weather = w;
rainParts.forEach(function (r) { r.visible = (w === "rainy"); });
if (s.overcast) s.overcast.setVisible(w === "rainy" || w === "cloudy");
}
window.__officeSetWeather = function (w) {
if (w !== "sunny" && w !== "rainy" && w !== "cloudy" && w !== "snowy") return;
if (scene) setWeather(scene, w === "snowy" ? "sunny" : w);
};
function tickWeather(s) {
if (s.overcast && s.overcast.visible) {
var c = s.cameras.main;
s.overcast.setPosition(c.midPoint.x, c.midPoint.y);
}
if (weather !== "rainy" || !rainParts.length) return;
rainParts.forEach(function (r) {
r.y += 7 + r.height * 0.4;
r.x -= 1.2;
if (r.y > H) { r.y = -10; r.x = Math.random() * W; }
});
}
window.addEventListener("keydown", function (e) {
if (e.key === "r" || e.key === "R") {
if (scene) setWeather(scene, weather === "sunny" ? "rainy" : "sunny");
}
});
var NPCS = [
{ id: "cat",   name: "喵酱", skin: "whale_cat",   bed: "catBed",      bedAt: [41.3, 21.2], roam: [40, 54], homeHours: [23, 7],  desc: "镇上的橘猫" },
{ id: "chief", name: "村长", skin: "whale_chief", bed: "chiefChair1", bedAt: [47.4, 23.3], roam: [41, 54], homeHours: [20, 8],  desc: "热心的水豚村长" },
{ id: "doc",   name: "博士", skin: "whale_doc",   bed: "docArm",      bedAt: [54.3, 27.2], roam: [42, 54], homeHours: [21, 13], desc: "研究潮汐的章鱼" }
];
function npcBedPos(def) {
var md = scene && scene.mapdata;
if (md && md.furniture) {
for (var i = 0; i < md.furniture.length; i++) {
var f = md.furniture[i];
if (f && f.id === def.bed && f.x != null && f.y != null) return { x: Number(f.x), y: Number(f.y) };
}
}
return { x: def.bedAt[0], y: def.bedAt[1] };
}
var NPC_DIALOGS = {
cat: {
morning: ["喵！（蹭蹭裤脚）", "喵呜～（尾巴卷成一个问号）", "喵！（今天鱼干还没着落）"],
day:     ["喵？（你手里有好吃的吗）", "呼噜呼噜…（晒太阳中）", "喵！（井边有只蟋蟀！）"],
night:   ["喵～（夜晚的眼睛亮晶晶）", "喵…（困了，要回窝了）"]
},
chief: {
morning: ["早上好，年轻人！今天也是好天气。", "早啊！记得吃早饭。"],
day:     ["今天市集进了新果子，去瞧瞧？", "镇口的灯我昨天刚修好。", "有烦恼就说出来，别憋着。"],
night:   ["天黑了，早点回去休息。", "夜里散步小心脚下。"]
},
doc: {
morning: ["我在想一个关于潮汐的问题…你不会懂的。", "早上好。（眼睛没离开书）"],
day:     ["你知道吗，月亮每天挪 50 分钟。", "潮汐表画到第三张了。", "问你个事…算了，你大概不感兴趣。"],
night:   ["夜里的海面更平静，适合思考。", "别吵，灵感要来了。"]
}
};
var npcLayer = [];
function npcHourBucket() {
var h = bjHour();
if (h >= 6 && h < 11) return "morning";
if (h >= 11 && h < 19) return "day";
return "night";
}
function npcIsHome(def) {
if (!def.homeHours) return false;
var h = bjHour();
var a = def.homeHours[0], b = def.homeHours[1];
return a <= b ? (h >= a && h < b) : (h >= a || h < b);
}
function buildNPCs(s) {
if (!s.mapdata) return;
NPCS.forEach(function (def) {
var bp = npcBedPos(def);                     // v77：真实床位（map.json）
def._bed = bp;
var bx = bp.x * TILE + TILE / 2;
var by = WALL_H + bp.y * TILE + TILE * 0.72;   // v83.3：初始也在床上（与 npcWalkHome 一致）
var spr = s.add.sprite(bx, by, def.skin || "whale")
.setScale(0.82).setOrigin(0.5, 1).setDepth(by + 1);
var tag = null;
tag = s.add.text(0, 0, def.name, {
fontFamily: "PingFang SC, Microsoft YaHei, sans-serif",
fontSize: "15px", color: "#fff8e1", backgroundColor: "#15182699",
padding: { x: 4, y: 2 }
}).setOrigin(0.5, 1).setDepth(by + 3);
var npc = { def: def, spr: spr, tag: tag, state: "home", timer: null,
path: null, pathIdx: 0, homeX: bx, homeY: by, indoor: true, act: "sleep",
motives: npcInitMotives() };   // v84 动机条
if (typeof editorMode !== "undefined" && editorMode) tag.setVisible(false);   // v48：地图编辑页不显示名牌
npc.dot = s.add.circle(0, 0, 3.2, npcIsHome(def) ? 0x51cf66 : 0xffd43b)
.setStrokeStyle(1, 0x151826, 0.5).setDepth(by + 3);
npcLayer.push(npc);
positionNpcParts(npc);
scheduleNpc(npc, 2000 + Math.random() * 3000);
});
}
function positionNpcParts(npc) {
if (!npc.spr || !npc.spr.active) return;
var x = npc.spr.x, topY = npc.spr.y - npc.spr.displayHeight;
if (npc.tag) npc.tag.setPosition(x, topY - 6).setDepth(npc.spr.depth + 3);
if (npc.dot) npc.dot.setPosition(x + (npc.tag ? npc.tag.width / 2 + 7 : 0), topY - 6).setDepth(npc.spr.depth + 3);
if (npc.say) npc.say.setPosition(x, topY - 26).setDepth(npc.spr.depth + 4);   // v84 动机气泡跟随
}
function setNpcIndoor(npc, indoor) {
npc.indoor = !!indoor;
var z = null;   // v76：不再用 zone 定位，统一走床位（见 npcWalkHome）
if (z && indoor) {
npc.spr.x = z.anchor[0] * TILE + 18;   // 半步偏移：主人和客人不叠影
npc.spr.y = WALL_H + z.anchor[1] * TILE - 6;
npc.spr.setDepth(npc.spr.y + 1);
}
if (npc.tag) npc.tag.setVisible(!indoor);
if (npc.dot) npc.dot.setVisible(!indoor);
positionNpcParts(npc);
}
function npcWalkTo(npc, tx, ty, speed, onDone) {
if (!npc.spr || !npc.spr.active || !scene || !scene.grid) { if (onDone) onDone(); return; }
var sx = Math.round((npc.spr.x - TILE / 2) / TILE);
var sy = Math.round((npc.spr.y - WALL_H - TILE / 2) / TILE);
var ex = Math.round(tx), ey = Math.round(ty);
var path = astar(sx, sy, ex, ey);
if (!path || !path.length) { if (onDone) onDone(); return; }
npc.path = path; npc.pathIdx = 0;
if (npc.timer) { clearTimeout(npc.timer); npc.timer = null; }
var stepMs = speed || 420;
var advance = function () {
if (!npc.spr || !npc.spr.active) return;
if (!npc.path || npc.pathIdx >= npc.path.length) {
npc.path = null;
if (onDone) onDone();
return;
}
var node = npc.path[npc.pathIdx++];
var wx = node.x * TILE + TILE / 2, wy = WALL_H + node.y * TILE + TILE / 2;
scene.tweens.add({
targets: npc.spr, x: wx, y: wy, duration: stepMs, ease: "Linear",
onUpdate: function () { positionNpcParts(npc); },
onComplete: advance
});
};
advance();
}
var NPC_ACTS = {
sleep:  { label: "睡觉中",   ms: [9000, 16000] },
idle:   { label: "发呆中",   ms: [3000, 6000] },
wander: { label: "走动着",   ms: [5000, 9000] },
look:   { label: "四处张望", ms: [2500, 5000] }
};
var NPC_MOTIVES = {
hunger:  { trigger: 72, zones: ["cook", "dining", "fridge"],
lines: ["肚子有点饿了…去灶台那边看看", "好像闻到饭香了", "冰箱里应该还有吃的吧"] },
social:  { trigger: 78, zones: ["visit", "market", "garden"],
lines: ["一个人待着好闷，去找{other}聊两句", "{other}在忙吗？去瞧瞧", "街上应该挺热闹的吧"] },
energy:  { trigger: 85, zones: ["home"],
lines: ["眼皮打架了…回去躺一会儿", "困了困了，回窝", "今天走的路够多了，歇了"] }
};
function npcMotiveLine(def, motive) {
var others = NPCS.map(function (d) { return d.name; }).filter(function (n) { return n !== def.name; });
var line = motive.lines[Math.floor(Math.random() * motive.lines.length)];
return line.replace("{other}", others.length ? others[Math.floor(Math.random() * others.length)] : "村长");
}
function npcInitMotives() {
return { hunger: 20 + Math.random() * 40, social: 10 + Math.random() * 50, energy: 10 + Math.random() * 30 };
}
function npcTickMotives(m) {
m.hunger = Math.min(100, m.hunger + 1.6 + Math.random() * 1.2);
m.social = Math.min(100, m.social + 1.2 + Math.random());
m.energy = Math.min(100, m.energy + 0.8 + Math.random() * 0.8);
}
function npcRelieveMotives(m, which) {
if (which === "hunger") m.hunger = 10 + Math.random() * 15;
else if (which === "social") m.social = 15 + Math.random() * 20;
else if (which === "energy") m.energy = 5 + Math.random() * 10;
}
function npcMotiveTarget(def, motive) {
for (var i = 0; i < motive.zones.length; i++) {
var z = motive.zones[i];
if (z === "visit") {
var homes = ["living_cat", "living_chief", "living_doc"].filter(function (k) {
return scene.mapdata.zones[k] && k !== "living_" + def.id;
});
if (homes.length) return scene.mapdata.zones[homes[Math.floor(Math.random() * homes.length)]].anchor;
} else if (z === "home") {
return null;   // home 走原有 npcGoHome 流程
} else if (scene.mapdata.zones[z]) {
return scene.mapdata.zones[z].anchor;
}
}
return null;
}
function npcSay(npc, text) {
if (!scene || !npc.spr || typeof editorMode !== "undefined" && editorMode) return;
if (npc.say) { npc.say.destroy(); npc.say = null; }
var t = scene.add.text(npc.spr.x, npc.spr.y - 42, text, {
fontFamily: "PingFang SC, Microsoft YaHei, sans-serif",
fontSize: "13px", color: "#1a1a2e", backgroundColor: "#fff8e1dd",
padding: { x: 6, y: 3 }, wordWrap: { width: 180 }
}).setOrigin(0.5, 1).setDepth(94001);
npc.say = t;
scene.time.delayedCall(4500, function () {
if (npc.say === t) { npc.say.destroy(); npc.say = null; }
});
}
function npcSetAct(npc, act) {
npc.act = act;
var flat = act === "sleep";
if (npc.spr) npc.spr.setScale(0.82, flat ? 0.45 : 0.82);
if (npc.zzz) { npc.zzz.destroy(); npc.zzz = null; }
if (flat && scene) {
npc.zzz = scene.add.text(npc.spr.x + 12, npc.spr.y - 30, "z z", {
fontFamily: "PingFang SC, Microsoft YaHei, sans-serif",
fontSize: "13px", color: "#cfe3ff"
}).setOrigin(0.5).setDepth(94000);
scene.tweens.add({ targets: npc.zzz, y: npc.zzz.y - 16, alpha: 0.2, duration: 2200, yoyo: true, repeat: -1 });
}
positionNpcParts(npc);
}
function npcTileOf(npc) {
return { x: Math.round((npc.spr.x - TILE / 2) / TILE), y: Math.round((npc.spr.y - WALL_H - TILE / 2) / TILE) };
}
function npcWalkHome(npc, onDone) {
npc.indoor = true;
var bp = npcBedPos(npc.def);          // v77：每次都取真实床位（床可被编辑移动）
npc.def._bed = bp;
npc.homeX = bp.x * TILE + TILE / 2;
npc.homeY = WALL_H + bp.y * TILE + TILE * 0.72;
npcWalkTo(npc, bp.x, bp.y + 0.6, 360, function () {
npc.spr.x = npc.homeX;
npc.spr.y = npc.homeY;
npc.spr.setDepth(npc.homeY + 1);
npcSetAct(npc, "sleep");
if (onDone) onDone();
});
}
function npcGoHome(npc) {
npc.state = "home";
npcWalkHome(npc);
scheduleNpc(npc, 18000 + Math.random() * 12000);
}
function scheduleNpc(npc, delay) {
if (npc.timer) clearTimeout(npc.timer);
npc.timer = setTimeout(function () { npcStep(npc); }, delay);
}
function npcStep(npc) {
if (!npc.spr || !npc.spr.active) return;
if (typeof editorMode !== "undefined" && editorMode) return;   // 编辑页 NPC 站桩
npcTickMotives(npc.motives || (npc.motives = npcInitMotives()));
var motiveKeys = ["hunger", "social", "energy"];
for (var mi = 0; mi < motiveKeys.length; mi++) {
var mk = motiveKeys[mi];
if (!npc.motives[mk] || npc.motives[mk] < NPC_MOTIVES[mk].trigger) continue;
if (npc.act === "sleep" || npc.state === "home") continue;   // 睡觉/在家时段不动机
if (mk === "energy") {                                       // 困了 → 回家（复用回家链路）
npcRelieveMotives(npc.motives, "energy");
npcSay(npc, npcMotiveLine(npc.def, NPC_MOTIVES.energy));
npcGoHome(npc);
return;
}
var anchor = npcMotiveTarget(npc.def, NPC_MOTIVES[mk]);
if (!anchor) continue;
npcRelieveMotives(npc.motives, mk);
npc.state = "roaming";
npcSetAct(npc, mk === "hunger" ? "wander" : "look");
npcSay(npc, npcMotiveLine(npc.def, NPC_MOTIVES[mk]));
npcWalkTo(npc, Math.round(anchor[0]), Math.round(anchor[1]), 400, function () { npcSetAct(npc, "idle"); });
scheduleNpc(npc, 9000 + Math.random() * 7000);
return;
}
var shouldHome = npcIsHome(npc.def);
if (shouldHome && npc.state !== "home") { npcGoHome(npc); return; }
if (npc.state === "home") {
if (!shouldHome) {                       // 起床出门
npc.indoor = false;
npcSetAct(npc, "idle");
var gx = npc.def.roam[0] + Math.random() * (npc.def.roam[1] - npc.def.roam[0]);
var gy = 8.5 + Math.random() * 4.5;
npc.state = "roaming";
npcWalkTo(npc, gx, gy, 420, function () { npcSetAct(npc, "idle"); });
scheduleNpc(npc, 9500 + Math.random() * 8000);
return;
}
var t = npcTileOf(npc);
var farFromBed = Math.abs(t.x - (npc.def._bed || npc.def.bedAt)[0]) + Math.abs(t.y - (npc.def._bed || npc.def.bedAt)[1]) > 2;
if (!farFromBed && Math.random() < 0.35) {
var ax = (npc.def._bed || npc.def.bedAt)[0] + (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 2));
var ay = (npc.def._bed || npc.def.bedAt)[1] + (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 2));
npcSetAct(npc, "wander");
npcWalkTo(npc, ax, ay, 420, function () { npcSetAct(npc, "look"); });
scheduleNpc(npc, 6000 + Math.random() * 6000);
} else {
npcSetAct(npc, "sleep");
scheduleNpc(npc, 9000 + Math.random() * 8000);
}
return;
}
if (npc.state === "roaming") {
if (Math.random() < 0.55) {
var gx2 = npc.def.roam[0] + Math.random() * (npc.def.roam[1] - npc.def.roam[0]);
var gy2 = 8.5 + Math.random() * 4.5;
npcSetAct(npc, "wander");
npcWalkTo(npc, gx2, gy2, 430, function () { npcSetAct(npc, "idle"); });
scheduleNpc(npc, 8000 + Math.random() * 7000);
} else {
npcSetAct(npc, Math.random() < 0.5 ? "idle" : "look");
scheduleNpc(npc, 4500 + Math.random() * 5000);
}
return;
}
scheduleNpc(npc, 6000 + Math.random() * 6000);
}
function npcInteractCheck() {
if (!npcLayer.length) return null;
if (fishState !== "idle" && fishState !== "acting") return null;
for (var i = 0; i < npcLayer.length; i++) {
var npc = npcLayer[i];
if (npc.state === "home" || npc.indoor) continue;   // 回了屋的人街上当然碰不到
if (npc.act === "sleep") continue;                  // v76：睡着的别叫醒
var dx = Math.abs(npc.spr.x - fish.x), dy = Math.abs(npc.spr.y - fish.y);
if (dx < TILE * 2.2 && dy < TILE * 1.8) return npc;
}
return null;
}
var lastNpcChat = 0;
function tryNpcChat() {
var npc = npcInteractCheck();
if (!npc) return;
var now = Date.now();
if (now - lastNpcChat < 25000) return;
lastNpcChat = now;
var bucket = npcHourBucket();
var pool = (NPC_DIALOGS[npc.def.id] || {})[bucket] || ["…"];
var line = pool[Math.floor(Math.random() * pool.length)];
showBubble(line, "idle");
var replyPool = (NPC_DIALOGS[npc.def.id] || {})[bucket] || ["…"];
var reply = replyPool[Math.floor(Math.random() * replyPool.length)];
var bub = scene.add.text(npc.spr.x, npc.spr.y - npc.spr.displayHeight - 6, reply, {
fontFamily: "PingFang SC, Microsoft YaHei, sans-serif",
fontSize: "15px", color: "#151826", backgroundColor: "#fffdf8ee",
padding: { x: 7, y: 4 }, align: "center", wordWrap: { width: 200 }
}).setOrigin(0.5, 1).setDepth(94000);
bub.setAlpha(0);
scene.tweens.add({ targets: bub, alpha: 1, duration: 200, delay: 500 });
scene.tweens.add({ targets: bub, alpha: 0, duration: 400, delay: 2800, onComplete: function () { bub.destroy(); } });
var mark = scene.add.text(npc.spr.x, npc.spr.y - npc.spr.displayHeight - 8, "❢", { fontSize: "16px", color: "#f59f00" }).setOrigin(0.5).setDepth(9500);
scene.tweens.add({ targets: mark, y: mark.y - 10, alpha: 0, duration: 1200, onComplete: function () { mark.destroy(); } });
postStatDelta({ social: 10, mood: 3 });
renderStatsBar();
}
try {
window.__officeNpcs = function () {
return npcLayer.map(function (n) {
return {
id: n.def ? n.def.id : null, act: n.act, state: n.state, indoor: !!n.indoor,
say: n.say ? n.say.text : null,
x: Math.round((n.spr ? n.spr.x : 0) / 48), y: Math.round(((n.spr ? n.spr.y : 0) - 48) / 48 - 1),
m: n.motives ? { hunger: Math.round(n.motives.hunger), social: Math.round(n.motives.social), energy: Math.round(n.motives.energy) } : null
};
});
};
} catch (e) {}
var ROOMS = [
{ id: "office",  label: "办公室", cx: 13 * TILE, cy: 23.5 * TILE },
{ id: "bedroom", label: "起居",   cx: 13 * TILE, cy: 7 * TILE },    // 北排整排（卧室+卫浴+厨房）
{ id: "garden",  label: "花园",   cx: 32 * TILE, cy: 15 * TILE },
{ id: "town",    label: "小镇",   cx: 47 * TILE, cy: 15 * TILE }
];
var NEIGHBOR_HOMES = [
{ id: "cat",   home: "homeCat",   door: "doorCat",   living: "living_cat",   cx: 42.4 * TILE, cy: WALL_H + 23.2 * TILE, zm: 1.25 },
{ id: "chief", home: "homeChief", door: "doorChief", living: "living_chief", cx: 48.5 * TILE, cy: WALL_H + 23.6 * TILE, zm: 1.25 },
{ id: "doc",   home: "homeDoc",   door: "doorDoc",   living: "living_doc",   cx: 53.0 * TILE, cy: WALL_H + 24.0 * TILE, zm: 1.25 }
];
function npcHomeState(npcId) {
for (var i = 0; i < npcLayer.length; i++) {
if (npcLayer[i].def.id !== npcId) continue;
var npc = npcLayer[i];
return (npc.state === "home" || npc.indoor) ? "home" : "out";
}
return "out";
}
var visitingHome = null;     // 正在串门的 NEIGHBOR_HOMES 项
var visitSitCount = 0;       // 在屋里已小坐的轮数（坐满两轮自己出门回家）
function enterNeighborHome(s, h) {
var zDoor = s.mapdata.zones[h.door], zLiving = s.mapdata.zones[h.living];
if (!zDoor || !zLiving) return false;
stopIdleLife();
unsit();
hideBubble();
hidePerfPanel();
var npcId = h.id;
var isHome = npcHomeState(npcId) === "home";
var verb = isHome ? "敲" + (INFO_CARDS[h.home] || {}).name + "的门" : "去" + (INFO_CARDS[h.home] || {}).name + "看看";
var path = astar(px2tx(fish.x), px2ty(fish.y), Math.round(zDoor.anchor[0]), Math.round(zDoor.anchor[1]));
if (!path) return false;
curPlan = {
path: path, i: 0, local: true, st: null,
cfg: { act: "idle_wave", mood: "idle" },
task: verb, bubbleText: isHome ? "咚咚咚——有人在家吗？" : "（门没锁，自己进去看看）",
face: "s", zone: null, statFill: null,
visit: { home: h, living: zLiving, isHome: isHome }
};
fishState = "walking";
showBubble(curPlan.bubbleText, "idle");
postStatDelta(isHome ? { social: 6 } : { social: 2 });
renderStatsBar();
return true;
}
function arriveVisit() {
var v = curPlan.visit, h = v.home;
visitingHome = h;
fishState = "acting";        // 收掉 walking：否则 stepWalk 每帧重新 arriveAct→arriveVisit
hideBubble();                // 敲门气泡完成使命，进屋后换主人的欢迎语
var thisPlan = curPlan;      // 进屋演出 ~2.6s 后回到 idle（idleStep 的串门小坐分支接管）
setTimeout(function () {
if (curPlan === thisPlan && fishState === "acting") { fishState = "idle"; }
}, 2600);
var hp = scene.hostMap[h.home];
if (hp) {
var mark = scene.add.text(hp.x, hp.y - hp.bbox[3] - 6, "❢", { fontSize: "18px", color: "#ffd43b" })
.setOrigin(0.5).setDepth(hp.footY + 30);
scene.tweens.add({ targets: mark, y: mark.y - 12, alpha: 0, duration: 1400, onComplete: function () { mark.destroy(); } });
}
fish.x = v.living.anchor[0] * TILE + TILE / 2;
fish.y = WALL_H + v.living.anchor[1] * TILE + TILE / 2;
fish.setDepth(fish.y);
fish.face(v.living.face || "s");
fish.still();
var cam = scene.cameras.main;
cam.stopFollow();
cam.setZoom(h.zm);
cam.pan(h.cx, h.cy, 700);
cam.once("camerapancomplete", function () {
if (visitingHome === h) scene.time.delayedCall(1600, function () {
if (visitingHome === h) cam.startFollow(fish, true, 0.08, 0.08);
});
});
if (v.isHome) {
var npc = null;
for (var i = 0; i < npcLayer.length; i++) if (npcLayer[i].def.id === h.id) npc = npcLayer[i];
if (npc) {
var bucket = npcHourBucket();
var pool = (NPC_DIALOGS[npc.def.id] || {})[bucket] || ["…"];
var line = pool[Math.floor(Math.random() * pool.length)];
var bub = scene.add.text(fish.x, fish.y - 58, (npc.def.name + "：「" + line + "」"), {
fontFamily: "PingFang SC, Microsoft YaHei, sans-serif",
fontSize: "15px", color: "#151826", backgroundColor: "#fffdf8ee",
padding: { x: 8, y: 5 }, align: "center", wordWrap: { width: 230 }
}).setOrigin(0.5, 1).setDepth(94000);
bub.setAlpha(0);
scene.tweens.add({ targets: bub, alpha: 1, duration: 250, delay: 500 });
scene.tweens.add({ targets: bub, alpha: 0, duration: 500, delay: 3400, onComplete: function () { bub.destroy(); } });
}
}
lastNpcChat = Date.now();
visitSitCount = 0;
startIdleLife(11000 + Math.random() * 7000);   // 小坐一阵再继续过日子（真实事件来了仍会被叫走）
}
function exitNeighborHome() {
if (!visitingHome) return;
visitingHome = null;
if (scene) {
var cam = scene.cameras.main;
cam.stopFollow();
cam.setZoom(1.25);                 // 出屋先回到小镇停靠视角，再交给后续逻辑
cam.pan(47 * TILE, 15 * TILE, 600);
}
}
function buildRoomTabs(s) {
var bar = document.getElementById("room-tabs");
if (!bar) return;
bar.innerHTML = "";
ROOMS.forEach(function (r) {
var b = document.createElement("button");
b.className = "room-tab";
b.type = "button";
b.dataset.room = r.id;
b.title = "把镜头移到" + r.label;
b.setAttribute("aria-label", "切换到" + r.label);
b.setAttribute("aria-pressed", "false");
b.textContent = r.label;
b.onclick = function () {
exitNeighborHome();   // 从邻居屋里出来：切房间即退出串门视角
var cam = s.cameras.main;
cam.stopFollow();   // 统一 pan 停靠（评审 #8：办公室 tab 跟随鱼曾把用户带到花园）；要看鱼另点"跟随"按钮
var zm = (r.id === "garden" || r.id === "town") ? 1.25 : 1;   // 窄区 zoom 补边界（评审 #9）
cam.setZoom(zm);
cam.pan(r.cx, r.cy || H / 2, 600);
[].forEach.call(bar.children, function (c) {
c.classList.remove("active");
c.setAttribute("aria-pressed", "false");
});
b.classList.add("active");
b.setAttribute("aria-pressed", "true");
};
bar.appendChild(b);
});
NEIGHBOR_HOMES.forEach(function (h) {
var nb = document.createElement("button");
nb.className = "room-tab";
nb.type = "button";
nb.dataset.room = "nb-" + h.id;
nb.title = "把镜头移到" + (INFO_CARDS[h.home] || {}).name + "门口（再拖动可环视）";
nb.setAttribute("aria-label", "视角移动到邻居家：" + (INFO_CARDS[h.home] || {}).name);
nb.textContent = (INFO_CARDS[h.home] || {}).name || h.id;
nb.onclick = function () {
exitNeighborHome();
camDragOn = false;   // 切换停靠视角时退出拖动模式
var cam = s.cameras.main;
cam.stopFollow();
cam.setZoom(1.4);
cam.pan(h.cx, h.cy - 2 * TILE, 600);
syncTabActive(nb);
nb.classList.add("active");
};
bar.appendChild(nb);
});
var fb = document.createElement("button");
fb.className = "room-tab";
fb.textContent = "🐟跟随";
fb.title = "镜头回到 AI 身上";
fb.onclick = function () {
exitNeighborHome();
camDragOn = false;
var cam = s.cameras.main;
cam.stopFollow(); cam.startFollow(fish, true, 0.08, 0.08); cam.setZoom(1);
syncTabActive(fb);
};
bar.appendChild(fb);
var db = document.createElement("button");
db.className = "room-tab";
db.id = "cam-drag-btn";
db.textContent = "✋ 拖动";
db.title = "自由拖动视角：开启后按住画布拖动平移镜头，滚轮缩放（ESC 或再点一次退出）";
db.setAttribute("aria-pressed", "false");
db.onclick = function () {
camDragOn = !camDragOn;
exitNeighborHome();
var cam = s.cameras.main;
if (camDragOn) {
cam.stopFollow();                       // 拖动模式 = 脱离鱼的跟随，镜头完全交给手
if (cam.__dragPan) { cam.__dragPan.destroy(); cam.__dragPan = null; }
cam.setZoom(Math.max(1, cam.zoom));     // 缩小态拖动会露出世界外，钳到 1
db.classList.add("active");
db.setAttribute("aria-pressed", "true");
showBubble("（拖动视角已开启，按住画布拖一拖，滚轮缩放）", "idle");
} else {
db.classList.remove("active");
db.setAttribute("aria-pressed", "false");
if (editMode || editorMode) {
cam.stopFollow();          // 编辑中：关掉"拖动视角"只是回到可落笔状态，镜头留在原地别弹回鱼身上
} else {
cam.startFollow(fish, true, 0.08, 0.08);
cam.setZoom(1);
}
}
syncDragBtn();
};
bar.appendChild(db);
function syncTabActive(btn) {
[].forEach.call(bar.children, function (c) {
c.classList.remove("active");
if (c.setAttribute) c.setAttribute("aria-pressed", "false");
});
btn.classList.add("active");
}
function syncDragBtn() { db.classList.toggle("active", camDragOn); }
bar.children[0].classList.add("active");
bar.children[0].setAttribute("aria-pressed", "true");
bindCamDrag(s);
bindCamWheel(s);
}
SceneOffice.prototype.update = update;
var camDragOn = false;
var camDragSuppress = 0;   // 拖动结束后的点击抑制窗口（ms 时间戳）
function bindCamDrag(s) {
var cam = s.cameras.main;
var dragging = false, moved = false, lx = 0, ly = 0;
var rightDrag = false;                 // v48：按住右键临时平移，松手自动恢复
try {
s.game.canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
} catch (e) {}
s.input.on("pointerdown", function (p) {
if (p.rightButtonDown && p.rightButtonDown()) {   // 右键：任何模式下都能拖视角
rightDrag = true; dragging = true; moved = false; lx = p.x; ly = p.y;
return;
}
if (!camDragOn) return;
dragging = true; moved = false; lx = p.x; ly = p.y;
});
s.input.on("pointermove", function (p) {
if ((!camDragOn && !rightDrag) || !dragging || !p.isDown) return;
var dx = p.x - lx, dy = p.y - ly;
if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
if (!moved) return;
cam.stopFollow();                      // 一动就脱跟随，镜头完全交给手
cam.scrollX -= dx / cam.zoom;
cam.scrollY -= dy / cam.zoom;
lx = p.x; ly = p.y;
if (cam.__dragPan) { cam.__dragPan.remove(); cam.__dragPan = null; }   // 拖动打断 pan 停靠
});
var stop = function () {
dragging = false;
rightDrag = false;                     // 松手就恢复：不需要再点按钮取消
if (moved) {
camDragSuppress = Date.now() + 350;
moved = false;
}
};
s.input.on("pointerup", stop);
s.input.on("pointerupoutside", stop);
s.input.on("pointermove", function (p) {
if (!editMode) return;
if (editorMode) mapEditorPointerMove(p.worldX, p.worldY);
editPointerMove(p.worldX, p.worldY);
});
s.input.on("pointerup", function () { if (editMode) { if (editorMode) mapEditorPointerUp(); editPointerUp(); } });
s.input.on("pointerupoutside", function () { if (editMode) { if (editorMode) mapEditorPointerUp(); editPointerUp(); } });
}
var camDragSuppress = 0;   // 拖动结束后的点击抑制窗口（ms 时间戳）
function bindCamWheel(s) {
var cam = s.cameras.main;
var cv = s.game.canvas;
cv.addEventListener("wheel", function (e) {
if (!camDragOn && !camDragWheelAlways) return;
e.preventDefault();
var nz = Phaser.Math.Clamp(cam.zoom * (e.deltaY < 0 ? 1.12 : 0.89), 0.8, 2.2);
cam.setZoom(nz);
}, { passive: false });
}
var camDragWheelAlways = true;   // 滚轮缩放任何视角都可用（拖动模式外也允许）
function makePlacement(f, hostMap) {
var m = MAN[f.a];
if (!m) {   // 资产名不在 manifest（map.json 手改错了 / hub 里残留旧资产名）：跳过，别让整层家具炸掉
if (typeof console !== "undefined") console.warn("[office] 未知资产，已跳过：", f && f.a);
return null;
}
var bbox = bboxForFrame(m, f.frame);   // v45：旋转后取那一行的 bbox（影子 / 碰撞 / 脚点一起跟着变）
var x, y, footY, depth;
if (f.on && hostMap && hostMap[f.on]) {
var h = hostMap[f.on];
x = h.x + (f.dx || 0);
y = (h.y - h.bbox[3]) + (f.dy || 0);
footY = h.footY + 1;
depth = footY;
} else {
x = f.x * TILE + TILE / 2 + (f.ox || 0);
y = f.band ? WALL_H + (f.oy || 0) : (WALL_H + f.y * TILE + TILE / 2 + (f.oy || 0));
footY = y;
depth = f.wall ? 60 : footY;   // v83.2：wall 开关/壁灯要盖在墙 tile（底图 RT depth 6）之上，-5 时被墙吞掉
}
var cap = SCALE_TABLE[f.a];
var scale = 1;
if (cap) {
scale = Math.min(1.15, (cap * TILE) / Math.max(bbox[3], 1));
}
return {
m: m, key: f.a, o: !!f.o, wall: !!f.wall, floor: !!f.floor, id: f.id,
x: x, y: y,
originX: (bbox[0] + bbox[2] / 2) / m.frameW,
originY: (bbox[1] + bbox[3]) / m.frameH,
footY: footY, depth: depth, bbox: bbox, scale: scale
};
}
var lightsOn = false;          // 当前灯状态
var lightsManual = false;      // 用户手动切换过
var ambient = null;            // 环境光覆盖 graphics（每帧重画 alpha）
var ambientTarget = 0.42, ambientCur = 0.42;
var lightPoolTex = "lightpool";
var lightHoleTex = "light-hole-v1";   // v68：挖阴影用的柔边贴图
function makeLightTexture(s) {
if (s.textures.exists(lightPoolTex)) return;
var size = 256, cv = document.createElement("canvas");
cv.width = cv.height = size;
var ctx = cv.getContext("2d");
var g = ctx.createRadialGradient(size / 2, size / 2, 8, size / 2, size / 2, size / 2);
g.addColorStop(0, "rgba(255,244,214,0.95)");
g.addColorStop(0.4, "rgba(255,238,196,0.5)");
g.addColorStop(1, "rgba(255,236,190,0)");
ctx.fillStyle = g;
ctx.fillRect(0, 0, size, size);
s.textures.addCanvas(lightPoolTex, cv);
makeHoleTexture(s);
if (!s.textures.exists("white1")) {          // v71：矩形擦除用的纯白贴图
var wcv = document.createElement("canvas");
wcv.width = wcv.height = 2;
var wctx = wcv.getContext("2d");
wctx.fillStyle = "#ffffff"; wctx.fillRect(0, 0, 2, 2);
s.textures.addCanvas("white1", wcv);
}
}
function makeHoleTexture(s) {
if (s.textures.exists(lightHoleTex)) return;
var size = 256, cv = document.createElement("canvas");
cv.width = cv.height = size;
var ctx = cv.getContext("2d");
var img = ctx.createImageData(size, size);
var half = size / 2;
for (var y = 0; y < size; y++) {
for (var x = 0; x < size; x++) {
var dx = (x + 0.5 - half) / half, dy = (y + 0.5 - half) / half;
var d = Math.sqrt(dx * dx + dy * dy);
var a = d < 1 ? (function (t) { return t * t * (3 - 2 * t); })(1 - d) : 0;   // smoothstep
var i = (y * size + x) * 4;
img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255;
img.data[i + 3] = Math.round(a * 255);
}
}
ctx.putImageData(img, 0, 0);
s.textures.addCanvas(lightHoleTex, cv);
}
function buildLights(s) {
makeLightTexture(s);   // 光晕纹理生成（v31 重构时误删调用 → Phaser __MISSING 绿色贴图冒充光池）
s.lightPools = [];
var poolDefs = [
{ x: 9.0,  y: 21.4, r: 2.6, a: 0.22, tint: 0xffe2a8, room: "office" },   // 主工位
{ x: 11.4, y: 21.2, r: 2.0, a: 0.16, tint: 0xffe2a8, room: "office" },   // 木桌
{ x: 20.5, y: 21.4, r: 2.2, a: 0.18, tint: 0xffedd0, room: "office" },   // 产出簇
{ x: 4.5,  y: 27.8, r: 2.0, a: 0.16, tint: 0xffe2a8, room: "office" },   // 休息簇
{ x: 5.0,  y: 4.0,  r: 2.0, a: 0.20, tint: 0xffe2a8, room: "bedroom" },  // 卧室床头灯
{ x: 12.7, y: 3.2,  r: 1.8, a: 0.18, tint: 0xffe2a8, room: "bath" },     // 卫浴镜前灯
{ x: 20.5, y: 3.2,  r: 2.0, a: 0.18, tint: 0xffe2a8, room: "kitchen" },  // 厨房操作台灯
];
poolDefs.forEach(function (d) {
var img = s.add.image(d.x * TILE, WALL_H + d.y * TILE, lightPoolTex)
.setBlendMode(Phaser.BlendModes.ADD)
.setDisplaySize(d.r * TILE * 2, d.r * TILE * 2)
.setAlpha(roomLights[d.room] ? d.a : 0)
.setTint(d.tint || 0xffe2a8)
.setDepth(59200);
img.poolAlpha = d.a;
img.room = d.room;
s.lightPools.push(img);
});
var moon = s.add.image((s.mapdata.window.tx + 1) * TILE, WALL_H + 16.6 * TILE, lightPoolTex)
.setBlendMode(Phaser.BlendModes.ADD)
.setDisplaySize(4.5 * TILE, 6 * TILE)
.setAlpha(roomLights.office ? 0.14 : 0.05)
.setDepth(49999)
.setTint(0xbfddf5);
moon.room = "office";
s.moonPool = moon;
s.roomOverlays = {};
var cv = s.textures.createCanvas("ambientcv", W, H);
var ctx = cv.getContext();
ctx.fillStyle = "#0a1020";
ctx.fillRect(0, 0, W, H);
cv.refresh();
ambient = null;
ambientTarget = 0;   // 全屏滤镜取消（v32）：关灯房间的暗度由 roomOverlays 黑遮罩承担，开灯房间显示原色——不再有"蒙一层"感
}
function setLights(s, on) {
lightsOn = on;
roomLights.office = on; roomLights.bedroom = on; roomLights.kitchen = on; roomLights.bath = on;
applyRoomLights(s);
}
function applyRoomLights(s) {
if (!s || !s.roomOverlays) return;
renderNightShadow(s);
syncSwitchVisuals(s);   // v50：灯开关的面板/指示灯跟着亮灭
(s.lightPools || []).forEach(function (p) {
var preview2 = (typeof nightCfg !== "undefined") ? nightCfg.preview : "auto";
var rl = (preview2 === "day") ? false : roomLights[p.room] !== false;
s.tweens.add({ targets: p, alpha: rl ? p.poolAlpha : 0, duration: editorMode ? 0 : 600 });
});
}
var NIGHT_AMBIENT = 0.62;   // v82：0.42 太黑——缩小视野时户外像蒙黑遮罩（用户反馈），提到 0.62 保留夜感但不压抑
function updateAmbient(s) {
var pv = (typeof nightCfg !== "undefined") ? nightCfg.preview : "auto";
var target;
if (pv === "day") target = 0;
else if (pv === "night") {
target = (typeof nightCfg !== "undefined" && nightCfg.ambient != null) ? nightCfg.ambient : NIGHT_AMBIENT;
} else if (typeof editorMode !== "undefined" && editorMode) {
target = 0;                     // v75：编辑器「自动」= 不加任何蒙版（原来被 ambient 覆盖成 0.42，整图发灰）
} else {
target = isNightHour() ? NIGHT_AMBIENT : 0;
}
ambientTarget = target;
var prev = ambientCur;
ambientCur += (ambientTarget - ambientCur) * 0.08;
if (Math.abs(ambientCur - prev) < 0.002) ambientCur = ambientTarget;   // 收敛，别一直微抖
if (Math.abs(ambientCur - prev) >= 0.002 || Math.abs(ambientCur - ambientTarget) < 0.002) {
try { renderNightShadow(s); } catch (e) {}
}
}
function applyRoomLights(s) {
if (!s || !s.roomOverlays) return;
renderNightShadow(s);
syncSwitchVisuals(s);   // v50：灯开关的面板/指示灯跟着亮灭
(s.lightPools || []).forEach(function (p) {
var preview2 = (typeof nightCfg !== "undefined") ? nightCfg.preview : "auto";
var rl = (preview2 === "day") ? false : roomLights[p.room] !== false;
s.tweens.add({ targets: p, alpha: rl ? p.poolAlpha : 0, duration: editorMode ? 0 : 600 });
});
}
function disposeFurnitureLayer(s) {
(s.placed || []).forEach(function (p) {
if (p.spr) { try { p.spr.destroy(); } catch (e) {} }
if (p.shadow) { try { p.shadow.destroy(); } catch (e) {} }
});
s.placed = [];
customPlaceholders = [];   // 指向被销毁的实例，必须一起清
s.props = s.props ? s.props.filter(function (p) { return p.isFish; }) : [];   // 深度排序列表（含鱼）
s.fxDirect = {};           // 工作特效：{ pc, printer, chair }
s.hostMap = {};            // id → placement（供 on: 引用）
}
var SWITCH_ROOMS = { office: 1, bedroom: 1, bath: 1, kitchen: 1, nbCat: 1, nbChief: 1, nbDoc: 1 };
var SWITCH_ROOM_RECTS = {
office:  [0, 15, 26, 15],
bedroom: [1, 1, 9, 13],
bath:    [10, 1, 6, 13],
kitchen: [16, 1, 9, 13],
nbCat:   [39, 1, 8, 13],    // v83：喵酱家（右上左新房）
nbChief: [48, 1, 7, 13],    // v83：村长家（右上右新房）
nbDoc:   [51, 20, 4, 9]     // v83：博士家（右下）
};
function roomOfProp(p) {
var want = p.f && p.f.room;
if (want === "none") return null;
if (want && SWITCH_ROOMS[want]) return want;
var tx = (p.x - TILE / 2) / TILE, ty = (p.y - WALL_H - TILE / 2) / TILE;
var best = null, bestD = 1e9;
Object.keys(SWITCH_ROOM_RECTS).forEach(function (k) {
var r = SWITCH_ROOM_RECTS[k];
var dx = Math.max(r[0] - tx, 0, tx - (r[0] + r[2]));
var dy = Math.max(r[1] - ty, 0, ty - (r[1] + r[3]));
var d = dx * dx + dy * dy;
if (d < bestD) { bestD = d; best = k; }
});
return best;
}
var LIGHT_STATE_ASSETS = { switch: 1, "wall-lamp": 1 };   // 随房间灯亮灭
var NIGHT_STATE_ASSETS = { window: 1 };                    // 随昼夜（窗内天色）
function applyPropStates(s) {
if (!s || !s.placed) return;
s.placed.forEach(function (p) {
var a = p.f && p.f.a;
var man = MAN[a];
if (!a || !man || !man.states || !p.spr || !p.spr.setTexture) return;
var key = null;
if (LIGHT_STATE_ASSETS[a]) {
var room = roomOfProp(p);
var on = room ? (roomLights[room] !== false) : (lightsOn === true);
key = on ? man.states.on : (man.states.off || a);
p.room = room; p.switchOn = on;
} else if (NIGHT_STATE_ASSETS[a]) {
key = isNightHour() ? man.states.night : (man.states.day || a);
}
if (key && s.textures.exists(key) && p.spr.texture && p.spr.texture.key !== key) p.spr.setTexture(key);
});
}
function syncSwitchVisuals(s) { applyPropStates(s); }   // v52: 统一入口
function flashAt(s, x, y, color) {
try {
var ring = s.add.circle(x, y - 14, 16, 0xfff3c4, 0.55).setDepth(97000);
var ring2 = s.add.circle(x, y - 14, 6, 0xffffff, 0.8).setDepth(97001);
s.tweens.add({ targets: ring, scale: 2.2, alpha: 0, duration: 480, onComplete: function () { ring.destroy(); } });
s.tweens.add({ targets: ring2, scale: 1.6, alpha: 0, duration: 380, onComplete: function () { ring2.destroy(); } });
} catch (e) {}
}
function toggleSwitchAt(worldX, worldY) {
var s = scene;
if (!s || !s.placed) return false;
var hit = null;
s.placed.forEach(function (p) {
if (!p.f || (p.f.a !== "switch" && p.f.a !== "wall-lamp") || !p.spr) return;
var bb = p.bbox || [0, 0, 24, 24];
var halfW = (bb[2] || 24) / 2 + 8, top = p.y - (bb[3] || 24) - 8, bottom = p.y + 8;
if (worldX > p.x - halfW && worldX < p.x + halfW && worldY > top && worldY < bottom) hit = p;
});
if (!hit) return false;
var room = hit.room || roomOfProp(hit);
if (!room) { showBubble("这个开关没连到房间（编辑器里给它选一个）", "error"); return true; }
roomLights[room] = roomLights[room] === false ? true : false;
lightsOn = ["office", "bedroom", "bath", "kitchen", "nbCat", "nbChief", "nbDoc"].some(function (k) { return roomLights[k] !== false; });
applyRoomLights(s);
syncSwitchVisuals(s);
flashAt(s, hit.spr.x, hit.spr.y, roomLights[room] ? 0xfff3c4 : 0x6b7385);
showBubble((roomLights[room] ? "💡 开灯：" : "⚫ 关灯：") + ({ office: "办公室", bedroom: "起居", bath: "卫浴", kitchen: "厨房", nbCat: "喵酱家", nbChief: "村长家", nbDoc: "博士家" }[room] || room), "idle");
return true;
}
function buildFurnitureLayer(s) {
disposeFurnitureLayer(s);
s.mapdata.furniture.forEach(function (f) {
if (!f.on) {
var p = makePlacement(f, null);
if (!p) return;   // 资产名不在 manifest 里：跳过而不是炸整层
p.f = f;
s.hostMap[f.id] = p;
}
});
s.mapdata.furniture.forEach(function (f) {
var p = makePlacement(f, s.hostMap);
if (!p) return;
p.f = f;
var m = p.m;
var f0 = f.frame || 0;
var spr;
if (m.anim && m.rows && m.rows.East > 1) {
spr = s.add.sprite(p.x, p.y, f.a, f0).setOrigin(p.originX, p.originY).setDepth(p.depth);
} else {
spr = s.add.image(p.x, p.y, f.a, f0).setOrigin(p.originX, p.originY).setDepth(p.depth);
}
if (p.scale !== 1) spr.setScale(p.scale);   // 大小关系：按格子归一化
if (!p.wall && !p.o && !f.on) {
var shW = p.bbox[2] * (p.scale || 1) * 1.1;
p.shadow = s.add.ellipse(p.x, p.y + 1, shW, 8, 0x3a2a1a, 0.25).setDepth(p.depth - 1);
}
p.spr = spr;
s.props.push(p);
s.placed.push(p);
if (f.id) s.hostMap[f.id] = p;   // 叠加物也可能被别人叠（如书架上的书）
if (f._custom) customPlaceholders.push(p);
if (f.a === "computer") s.fxDirect.pc = { spr: spr, m: m, f: f };
if (f.a === "printer") s.fxDirect.printer = { spr: spr, m: m, f: f };
if (f.a === "office-chair") s.fxDirect.chair = { spr: spr, m: m, f: f };
});
syncSwitchVisuals(s);   // v50：建完家具层同步开关外观（必须在 return 之前）
buildBlockedGrid(s);
return s;
}
function buildFurniture(s) {
s.props = [];
s.placed = [];
applyCustomFurniture(s);   // 自定义层必须先并进 mapdata：放在两遍创建之后会漏掉它们的精灵
buildFurnitureLayer(s);
}
function buildBlockedGrid(s) {
var grid = [];
for (var y = 0; y < ROWS; y++) grid.push(new Array(COLS).fill(0));
for (var x0 = 0; x0 < COLS; x0++) grid[0][x0] = 1;   // 贴墙根不可走
(s.mapdata.walls || []).forEach(function (wl) {
var isH = wl.x0 !== undefined;   // 横墙带 x0/x1；竖墙带 x/y/h
if (!isH) {   // 竖墙 {x, y, h, gap}
for (var wy = wl.y; wy < wl.y + wl.h; wy++) {
if (wl.gap && wy >= wl.gap[0] && wy <= wl.gap[1]) continue;
if (grid[wy]) grid[wy][wl.x] = 1;
}
} else {      // 横墙 {y, x0, x1, gap}
for (var wx = wl.x0; wx <= wl.x1; wx++) {
if (wl.gap && wx >= wl.gap[0] && wx <= wl.gap[1]) continue;
if (grid[wl.y]) grid[wl.y][wx] = 1;
}
}
});
var propBlocked = {};   // 家具压住的格子：地板贴片不能把这些格放行
s.props.forEach(function (p) {
if (p.isFish || p.wall || p.o || p.f?.on) return;   // 鱼/墙饰/叠加物不产生碰撞（v37：rebuildCustomLayer 保留鱼重跑本函数时，鱼对象没有 bbox）
var m = p.m, bbox = p.bbox;
var footH = Math.min(12, bbox[3]);
var left = p.x - m.frameW / 2 + bbox[0];
var right = left + bbox[2];
var top = p.y - footH;
for (var gy = Math.floor((top - WALL_H) / TILE); gy <= Math.floor((p.y - WALL_H - 1) / TILE); gy++) {
for (var gx = Math.floor(left / TILE); gx <= Math.floor((right - 1) / TILE); gx++) {
if (gy >= 0 && gy < ROWS && gx >= 0 && gx < COLS) { grid[gy][gx] = 1; propBlocked[gy + "," + gx] = 1; }
}
}
});
(s.mapdata.blockers || []).forEach(function (b) {
if (b.t !== "pond") return;
var bx0 = Math.max(0, Math.floor(b.x0)), bx1 = Math.min(COLS - 1, Math.ceil(b.x1) - 1);
var by0 = Math.max(0, Math.floor(b.y0)), by1 = Math.min(ROWS - 1, Math.ceil(b.y1) - 1);
var ex = (b.x0 + b.x1) / 2, ey = (b.y0 + b.y1) / 2;
var rx = (b.x1 - b.x0) / 2 + 0.12, ry = (b.y1 - b.y0) / 2 + 0.12;
for (var py = by0; py <= by1; py++) {
if (!grid[py]) continue;
for (var px = bx0; px <= bx1; px++) {
var cx = px + 0.5, cy = py + 0.5;
if (Math.pow((cx - ex) / rx, 2) + Math.pow((cy - ey) / ry, 2) <= 1) grid[py][px] = 1;
}
}
});
var solidTerrain = {};
Object.keys(terrainEdits).forEach(function (k) {
var e = terrainEdits[k];
if (e.t !== "wall" && e.t !== "water") return;
solidTerrain[e.y + "," + e.x] = 1;
});
Object.keys(floorEdits).forEach(function (k) {
var e = floorEdits[k];
if (!grid[e.y] || grid[e.y][e.x] === undefined) return;
if (e.y === 0) return;
if (propBlocked[e.y + "," + e.x]) return;
if (solidTerrain[e.y + "," + e.x]) return;   // v83.1：墙/水格不许地板放行
grid[e.y][e.x] = 0;
});
Object.keys(solidTerrain).forEach(function (k) {
var p = k.split(",");
var gy = Number(p[0]), gx = Number(p[1]);
if (grid[gy] && grid[gy][gx] !== undefined) grid[gy][gx] = 1;
});
s.grid = grid;
}
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
var hiddenKeys = {};
var moveOverrides = {};          // key → { x, y }
var floorEdits = {};             // "tx,ty" → entry
var terrainEdits = {};           // "tx,ty" → entry
var lightEdits = [];             // 合并后的光源列表
var lightOverrides = {};         // id → 条目
var lightDeleted = {};           // id → 1
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
"window",
"switch",                   // v50：墙上的灯开关（点它切对应房间的灯）
"wall-lamp"                 // v52：墙上壁灯（随房间灯亮灭，也能点）
];
function placeExtraFor(asset) {
if (asset === "window") return { wall: true };
if (asset === "switch") return { wall: true };    // v50：开关挂墙上、不挡路
if (asset === "wall-lamp") return { wall: true };  // v52：壁灯同理
return null;
}
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
function hubMapBase() {
if (hubBase()) return hubBase();
var host = location.hostname || "";
if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return "http://" + host + ":4321";
return "/office-hub-api";
}
function hubMapUrl() {
var base = hubMapBase() || "";
return base.indexOf("://") >= 0 ? base + "/api/map" : base + "/map";
}
function furniturePosText(p) {
var f = p.f || {};
var x = (f.x === undefined || f.x === null) ? Math.round(((p.x - TILE / 2) / TILE) * 10) / 10 : f.x;
var y = (f.y === undefined || f.y === null) ? Math.round(((p.y - WALL_H - TILE / 2) / TILE) * 10) / 10 : f.y;
return x + "," + y;
}
function furnitureKeyOf(f) {
if (!f) return "";
if (f._key) return f._key;
if (f.id) return "id:" + f.id;
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
function shadowAlphaOf(r) {
var night = isNightHour();
if (!night) return Math.max(0, Math.min(0.95, r.day));
var allRoomsOn = ["office", "bedroom", "bath", "kitchen"].every(function (k) { return roomLights[k] !== false; });
var on = r.room ? (roomLights[r.room] !== false) : allRoomsOn;
if (previewNight() === "day") return Math.max(0, Math.min(0.95, r.day));
return Math.max(0, Math.min(0.95, on ? r.lit : r.night));
}
function previewNight() {
return (typeof nightCfg !== "undefined") ? nightCfg.preview : "auto";
}
var ROOM_RECTS = [
{ room: "office",  x: 0,  y: 15, w: 26, h: 15, label: "办公室" },
{ room: "bedroom", x: 1,  y: 1,  w: 9,  h: 13, label: "起居" },
{ room: "bath",    x: 10, y: 1,  w: 6,  h: 13, label: "卫浴" },
{ room: "kitchen", x: 16, y: 1,  w: 9,  h: 13, label: "厨房" },
{ room: "nbCat",   x: 39, y: 1,  w: 8,  h: 13, label: "喵酱家" },
{ room: "nbChief", x: 48, y: 1,  w: 7,  h: 13, label: "村长家" },
{ room: "nbDoc",   x: 51, y: 20, w: 4,  h: 9,  label: "博士家" }
];
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
function renderNightShadow(s) {
if (!s || !s.add) return;
if (!s.shadowRT || !s.shadowRT.active) {
s.shadowRT = s.add.renderTexture(0, 0, W, H).setOrigin(0).setDepth(59100);
}
var rt = s.shadowRT;
var amb = Math.max(0, Math.min(1, ambientCur || 0));
var pv = previewNight();
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
if (amb > 0.004) {
if (!s._ambPen) {
s._ambPen = new Phaser.GameObjects.Rectangle(s, 0, 0, W, H, 0x0a1020);
s._ambPen.setOrigin(0, 0);
}
s._ambPen.setSize(W, H).setAlpha(amb).setPosition(0, 0);
rt.draw(s._ambPen);
painted = true;
}
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
if (shadowEdits.length || autoRegions.length) {
if (!s._shadowPen) {
s._shadowPen = new Phaser.GameObjects.Rectangle(s, 0, 0, TILE, TILE, 0x0a1020);
s._shadowPen.setOrigin(0, 0);
}
var pen = s._shadowPen;
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
function rebuildCustomLayer() {
var s = scene;
if (!s || !s.mapdata) return;
clearEditSelection();     // 选中框指向的精灵马上会被销毁
var gridWasOn = !!gridOverlay;
applyCustomFurniture(s);
buildFurnitureLayer(s);
if (gridOverlay) { gridOverlay.destroy(); gridOverlay = null; }
if (gridWasOn) toggleGrid(true);
farmGfxRedrawSafe();
if (editMode && typeof renderEditList === "function") renderEditList();
}
function farmGfxRedrawSafe() { try { if (farm && farmGfxTopmost()) drawFarm(); } catch (e) {} }
function farmGfxTopmost() { return true; }
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
if (g.a === "floor" || g.a === "terrain") {
var ck = g.a + "|" + (g.x == null ? "" : g.x) + "|" + (g.y == null ? "" : g.y) + "|" + (g.band ? 1 : 0) + "|" + (g.t || "");
if (byCell[ck] != null) { out[byCell[ck]] = null; fixed.push((g.a || "?") + " 同格重复 → 保留最后一条"); }
byCell[ck] = out.length;
}
if (g.id) {
if (byId[g.id]) { g.id = g.id + (Math.floor(Math.random() * 1296)).toString(36); fixed.push("id 重复重命名"); }
byId[g.id] = 1;
}
out.push(g);
});
out = out.filter(Boolean);
return { list: out, fixed: fixed };
}
var LOCAL_MAP_KEY = "office_map_custom_v1";
var mirrorPending = false;        // 本地有 hub 还没收到的改动
var mirrorAt = 0;                 // 镜像最后一次写入时间：只有比 hub 新才补传，避免旧镜像把新存档盖掉
var inflightMapOps = 0;           // 正在推给 hub 的编辑数：期间忽略 WS 广播，别把自己刚做的改动盖掉
var mirrorFlushTried = false;
var mirrorRetryTimer = null;      // 失败重试定时器
var mirrorRetryCount = 0;
var MIRROR_RETRY_MAX = 20;     // 重连后补传只试一次，避免和 WS 广播互相打架
var hubUpdatedAt = 0;             // hub 侧 map.custom.json 的时间戳
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
function applyCustomMap(list, fromHub, updatedAt) {
if (fromHub && (inflightMapOps > 0 || (typeof meEditing !== "undefined" && meEditing))) return;                       // 自己的改动正在推：本地状态更新，别回滚
if (fromHub && mirrorPending) {
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
var wp = (worldY < WALL_H && meWallAsset(editAsset))
? { x: editSnapX(worldX) * TILE + TILE / 2, y: WALL_H }
: editSnapToWorld(editSnapX(worldX), editSnapY(worldY));   // v44：和落点用同一套坐标（所见即所得）
editGhost.setPosition(wp.x, wp.y);
editGhost.setDepth(96000);
}
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
var editorMode = /[?&]editor=1/.test(location.search) || /(^|\/)editor\.html$/i.test(location.pathname);
var ME = { layer: "object", tool: "paint", asset: null, floor: "wood", terrain: "wall", painting: false, lastCell: "", continuous: false };
var meFlushTimer = null;
var meEditing = 0;
var meUndoStack = [], meRedoStack = [];
var ME_HISTORY_MAX = 80;
var meApplyingHistory = false;
var meSyncLock = false;      // 本笔已压过快照：紧接着的 saveEditMap 别再压第二次
function meBeginMutation() { mePushHistory(); meSyncLock = true; }
function meSnapshot() { return JSON.parse(JSON.stringify(customFurniture)); }
function mePushHistory() {
if (meApplyingHistory) return;
meUndoStack.push(meSnapshot());
if (meUndoStack.length > ME_HISTORY_MAX) meUndoStack.shift();
meRedoStack.length = 0;
}
function meApplySnapshot(list) {
meApplyingHistory = true;
saveEditMap(false, { action: "set", item: JSON.parse(JSON.stringify(list)) }, function () { meApplyingHistory = false; });
}
function meUndo() {
if (!meUndoStack.length) return { ok: false, why: "没有可撤销的操作" };
meRedoStack.push(meSnapshot());
var prev = meUndoStack.pop();
meApplySnapshot(prev);
return { ok: true, undo: meUndoStack.length, redo: meRedoStack.length, count: prev.length };
}
function meRedo() {
if (!meRedoStack.length) return { ok: false, why: "没有可重做的操作" };
meUndoStack.push(meSnapshot());
var next = meRedoStack.pop();
meApplySnapshot(next);
return { ok: true, undo: meUndoStack.length, redo: meRedoStack.length, count: next.length };
}
function meClearLayer(kind) {
meBeginMutation();
var before = customFurniture.length;
var keep = customFurniture.filter(function (f) {
if (!f || !f.a) return false;
if (kind === "all") return false;
if (kind === "floor") return !isFloorEntry(f);
if (kind === "terrain") return !isTerrainEntry(f);
if (kind === "light") return !isLightEntry(f);
if (kind === "shadow") return !isShadowEntry(f);
if (kind === "object") return !(!isHideEntry(f) && !isMoveEntry(f) && !isFloorEntry(f) && !isTerrainEntry(f) && !isLightEntry(f) && !isShadowEntry(f));
return true;
});
if (kind !== "object" && keep.length === before) { meSyncLock = false; return { ok: false, removed: 0 }; }
customFurniture = keep;
meQueueSave();
return { ok: true, removed: before - keep.length, left: keep.length };
}
var ME_LIGHTMODE = "light";     // v41：光照层子模式 —— "light"（灯源）/ "shadow"（拉框阴影）
var ME_DRAW = null;             // 正在拉的框 {x0,y0,x1,y1}
var ME_DRAG_SHADOW = null;      // 正在拖动的阴影块 {id,dx,dy}
var ME_SHADOW_SEL = null;       // 选中的阴影块 id      // 1 = 本地正有一笔贴片/灯改动还没落盘：期间忽略 hub 广播
function meTileAt(wx, wy) {
return { tx: Math.floor(wx / TILE), ty: Math.floor((wy - WALL_H) / TILE) };
}
function meWallAsset(a) {
var ex = placeExtraFor(a);
return !!(ex && ex.wall);
}
function meInBounds(c) { return c.tx >= 0 && c.ty >= 0 && c.tx < COLS && c.ty < ROWS; }
function meRefreshTiles() {
if (!scene) return;
var gridWasOn = !!gridOverlay;
splitCustomLayer();
renderEditOverlays(scene);
renderCustomLights(scene);
buildBlockedGrid(scene);
if (gridOverlay) { gridOverlay.destroy(); gridOverlay = null; }
if (gridWasOn) toggleGrid(true);
}
function meQueueSave() {
mirrorPending = true;
meEditing = 1;                    // 从改动发生到 POST 返回，忽略 hub 的 map 广播
meRefreshTiles();
saveLocalMirror();
clearTimeout(meFlushTimer);
meFlushTimer = setTimeout(function () {
meFlushTimer = null;
var snapshot = customFurniture.slice();   // 快照：避免这 120ms 里被广播换掉
saveEditMap(true, { action: "set", item: snapshot }, function (ok, err) {
meEditing = 0;
if (!ok) addEditLog("同步失败：" + err);
});
}, 120);
}
function meLightAt(tx, ty) {
var best = null, bestD = 1.2;   // 1.2 格内算点到
lightEdits.forEach(function (L) {
var d = Math.max(Math.abs(L.x - tx), Math.abs(L.y - ty));
if (d < bestD) { bestD = d; best = L; }
});
return best;
}
function meAddLight(tx, ty) {
meBeginMutation();
var p = lightPreset();
var id = "lt" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
customFurniture = customFurniture.concat([{ a: "light", x: Math.round((tx + 0.5) * 10) / 10, y: Math.round((ty + 0.5) * 10) / 10,
r: p.r, al: p.a, tint: p.tint, id: id }]);
selectedLight = id;
meQueueSave();
return { id: id, x: tx + 0.5, y: ty + 0.5 };
}
function meRemoveLight(id) {
meBeginMutation();
var cur = lightEdits.filter(function (L) { return L.id === id; })[0];
if (!cur) return false;
if (cur.builtin) {
customFurniture = customFurniture.filter(function (f) { return !(isLightEntry(f) && f.id === id); })
.concat([{ a: "light", id: id, del: 1, x: cur.x, y: cur.y }]);
} else {
customFurniture = customFurniture.filter(function (f) { return !(isLightEntry(f) && f.id === id); });
}
if (selectedLight === id) selectedLight = null;
meQueueSave();
return true;
}
function mePatchLight(id, patch) {
meBeginMutation();
var cur = lightEdits.filter(function (L) { return L.id === id; })[0];
if (!cur) return false;
var base = { a: "light", id: id, x: cur.x, y: cur.y, r: cur.r, al: cur.a, tint: cur.tint };
var next = Object.assign(base, patch || {});
next.a = "light"; next.id = id;
customFurniture = customFurniture.filter(function (f) { return !(isLightEntry(f) && f.id === id); }).concat([next]);
meQueueSave();
return true;
}
function meMoveLight(id, tx, ty) {
return mePatchLight(id, { x: Math.round(tx * 10) / 10, y: Math.round(ty * 10) / 10 });
}
function meShadowAt(tx, ty) {
for (var i = shadowEdits.length - 1; i >= 0; i--) {
var r = shadowEdits[i];
if (tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h) return r;
}
return null;
}
function meUpsertShadow(id, patch) {
var cur = shadowEdits.filter(function (r) { return r.id === id; })[0];
if (!cur) return false;
var base = { a: "shadow", id: id, x: cur.x, y: cur.y, w: cur.w, h: cur.h,
night: cur.night, lit: cur.lit, day: cur.day };
if (cur.label) base.label = cur.label;
var next = Object.assign(base, patch || {});
next.a = "shadow"; next.id = id;
customFurniture = customFurniture.filter(function (f) { return !(isShadowEntry(f) && f.id === id); }).concat([next]);
meQueueSave();
return true;
}
function meAddShadow(x0, y0, x1, y1) {
meBeginMutation();
var x = Math.max(0, Math.min(x0, x1)), y = Math.max(0, Math.min(y0, y1));
var w = Math.max(1, Math.abs(x1 - x0) + 1), h = Math.max(1, Math.abs(y1 - y0) + 1);
w = Math.min(w, COLS - x); h = Math.min(h, ROWS - y);
var id = "s" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
customFurniture = customFurniture.filter(function (f) { return !(isShadowEntry(f) && f.id === id); })
.concat([{ a: "shadow", id: id, x: x, y: y, w: w, h: h,
night: SHADOW_DEFAULTS.night, lit: SHADOW_DEFAULTS.lit, day: SHADOW_DEFAULTS.day }]);
ME_SHADOW_SEL = id;
meQueueSave();
return { id: id, x: x, y: y, w: w, h: h };
}
function mePatchShadow(id, patch) { return meUpsertShadow(id, patch); }
function meRemoveShadow(id) {
meBeginMutation();
var cur = shadowEdits.filter(function (r) { return r.id === id; })[0];
if (!cur) return false;
if (cur.builtin) {
customFurniture = customFurniture.filter(function (f) { return !(isShadowEntry(f) && f.id === id); })
.concat([{ a: "shadow", id: id, del: 1, x: cur.x, y: cur.y, w: cur.w, h: cur.h }]);
} else {
customFurniture = customFurniture.filter(function (f) { return !(isShadowEntry(f) && f.id === id); });
}
if (ME_SHADOW_SEL === id) ME_SHADOW_SEL = null;
meQueueSave();
return true;
}
function meClearShadows() {
meBeginMutation();
customFurniture = customFurniture.filter(function (f) { return !isShadowEntry(f); });
meQueueSave();
return true;
}
function meDrawPreview() {
if (!scene) return;
if (!scene.shadowPreviewGfx || !scene.shadowPreviewGfx.active) {
scene.shadowPreviewGfx = scene.add.graphics().setDepth(59150);
}
var g = scene.shadowPreviewGfx;
g.clear();
if (!ME_DRAW) return;
var x = Math.min(ME_DRAW.x0, ME_DRAW.x1), y = Math.min(ME_DRAW.y0, ME_DRAW.y1);
var w = Math.abs(ME_DRAW.x1 - ME_DRAW.x0) + 1, h = Math.abs(ME_DRAW.y1 - ME_DRAW.y0) + 1;
g.fillStyle(0x4a6cf7, 0.22);
g.fillRect(x * TILE, WALL_H + y * TILE, w * TILE, h * TILE);
g.lineStyle(2, 0x4a6cf7, 0.95);
g.strokeRect(x * TILE, WALL_H + y * TILE, w * TILE, h * TILE);
}
function meSetNight(patch) {
if (patch.alpha != null) nightCfg.alpha = Math.max(0, Math.min(0.9, Number(patch.alpha)));
if (patch.pad != null) nightCfg.pad = Math.max(0, Math.min(96, Number(patch.pad)));
if (patch.preview) nightCfg.preview = (patch.preview === "day" || patch.preview === "night") ? patch.preview : "auto";
saveNightCfg();
if (scene) applyRoomLights(scene);   // 立刻按新参数重画夜间遮罩
return nightCfg;
}
function meSetTile(layer, t, tx, ty, band) {
meBeginMutation();
var a = layer === "floor" ? "floor" : "terrain";
var next = customFurniture.filter(function (e) {
return !(e.a === a && Number(e.x) === tx && Number(e.y) === ty && !!e.band === !!band);
});
next.push(tileEntryFor(layer, t, tx, ty, band));
customFurniture = next;
meQueueSave();
return true;
}
function meEraseAt(layer, tx, ty, band) {
meBeginMutation();
var a = layer === "floor" ? "floor" : "terrain";
var before = customFurniture.length;
var tyy = (band || ty < 0) ? 0 : ty;
customFurniture = customFurniture.filter(function (e) {
return !(e.a === a && Number(e.x) === tx && Number(e.y) === tyy);
});
if (customFurniture.length === before) return false;
meQueueSave();
return true;
}
function meApplyCell(tx, ty, band) {
ME.lastCell = tx + "," + ty + (band ? ",band" : "");
var layer = ME.layer;
if (layer !== "floor" && layer !== "terrain") return;
var t = layer === "floor" ? ME.floor : ME.terrain;
if (ME.tool === "erase") meEraseAt(layer, tx, ty, band);
else meSetTile(layer, t, tx, ty, band);
}
function mapEditorPointerDown(wx, wy, pointer) {
if (pointer && pointer.rightButtonDown && pointer.rightButtonDown()) return false;   // v48：右键只平移
if (camDragOn) return false;      // 「拖动视角」模式下不落笔（交给 bindCamDrag 平移镜头）
var c = meTileAt(wx, wy);
var inBand = (c.ty === -1);
var bandPaint = inBand && ME.layer === "terrain" && (ME.tool === "erase" || ME.tool === "paint");
if (!meInBounds(c) && !bandPaint && !(inBand && (meWallAsset(ME.asset) || ME.tool === "select" || ME.tool === "erase" || ME.tool === "move"))) return true;   // v51/v59：墙带里也要能选中/拖动/删除/画墙
if (ME.layer === "light" && ME_LIGHTMODE === "shadow") {
var sel = meShadowAt(c.tx, c.ty);
if (ME.tool === "erase") { if (sel) meRemoveShadow(sel.id); return true; }
if (ME.tool === "move") {
if (sel) { ME_DRAG_SHADOW = { id: sel.id, dx: c.tx - sel.x, dy: c.ty - sel.y }; ME_SHADOW_SEL = sel.id; }
return true;
}
ME_DRAW = { x0: c.tx, y0: c.ty, x1: c.tx, y1: c.ty };   // 拉框
meDrawPreview();
return true;
}
if (ME.layer === "light") {
var hit = meLightAt(c.tx, c.ty);
if (ME.tool === "erase") { if (hit) meRemoveLight(hit.id); return true; }
if (ME.tool === "move") { if (hit) { selectedLight = hit.id; ME.dragLight = hit.id; } return true; }
meAddLight(c.tx, c.ty);
return true;
}
if (ME.layer === "object") {
if (ME.tool !== "erase" && ME.tool !== "move") {
var swHit = null;
(scene.placed || []).forEach(function (p) {
if (!p.f || (p.f.a !== "switch" && p.f.a !== "wall-lamp") || !p.spr) return;
var bb = p.bbox || [0, 0, 24, 24];
var halfW = (bb[2] || 24) / 2 + 8;
if (wx > p.x - halfW && wx < p.x + halfW && wy > p.y - (bb[3] || 24) - 10 && wy < p.y + 10) swHit = p;
});
if (swHit) {
meToggleSwitchAt(wx, wy);
if (swHit.f.id) { editSelItem = swHit; if (typeof markEditSelection === "function") markEditSelection(swHit); }
return true;
}
}
var tool = ME.tool === "erase" ? "delete"
: ME.tool === "move" ? "move"
: ME.tool === "select" ? "select"
: (ME.asset ? "add" : "select");
if (editTool !== tool) setEditTool(tool);
if (tool === "add") editAsset = ME.asset;
editPointerDown(wx, wy, pointer);
return true;
}
ME.painting = true;
ME.lastCell = "";
meApplyCell(c.tx, c.ty, inBand);
return true;
}
function mapEditorPointerMove(wx, wy) {
if (ME.dragLight && ME.layer === "light") {
var c0 = meTileAt(wx, wy);
if (meInBounds(c0)) meMoveLight(ME.dragLight, c0.tx + 0.5, c0.ty + 0.5);
return;
}
if (ME.layer === "light" && ME_LIGHTMODE === "shadow") {
var cs = meTileAt(wx, wy);
if (!meInBounds(cs)) return;
if (ME_DRAW) { ME_DRAW.x1 = cs.tx; ME_DRAW.y1 = cs.ty; meDrawPreview(); return; }
if (ME_DRAG_SHADOW) {
mePatchShadow(ME_DRAG_SHADOW.id, { x: Math.max(0, Math.min(COLS - 1, cs.tx - ME_DRAG_SHADOW.dx)),
y: Math.max(0, Math.min(ROWS - 1, cs.ty - ME_DRAG_SHADOW.dy)) });
return;
}
return;
}
if (!ME.painting || ME.layer === "object") return;
var c = meTileAt(wx, wy);
var inBand2 = (c.ty === -1) && ME.layer === "terrain" && ME.tool !== "select" && ME.tool !== "move";
if (!meInBounds(c) && !inBand2) return;
if (c.tx + "," + c.ty + (inBand2 ? ",band" : "") === ME.lastCell) return;
meApplyCell(c.tx, c.ty, inBand2);
}
function mapEditorPointerUp() {
if (ME_DRAW) {
var d = ME_DRAW; ME_DRAW = null;
meDrawPreview();
meAddShadow(d.x0, d.y0, d.x1, d.y1);      // 只点一下也能落 1×1
}
ME_DRAG_SHADOW = null;
ME.dragLight = null;
ME.painting = false;
ME.lastCell = "";
if (meFlushTimer) { clearTimeout(meFlushTimer); meFlushTimer = null; saveEditMap(true, null, function () {}); }
}
function meMoveTo(p, tx, ty) {
var f = p.f;
if (!f) return;
if (f._custom) {
saveEditMap(false, { action: "move", item: { id: f.id, x: tx, y: ty } }, function (ok, err) {
editToast(ok ? "已移动" : "已在本机移动（hub 未同步：" + err + "）");
});
return;
}
var key = furnitureKeyOf(f);
var next = customFurniture.filter(function (e) { return !(isMoveEntry(e) && e.k === key); });
next.push(moveEntryFor(key, tx, ty));
saveEditMap(false, { action: "set", item: next }, function (ok, err) {
editToast(ok ? "已移动静态物件 " + f.a : "已在本机移动（hub 未同步：" + err + "）");
});
}
window.__mapEditor = {
isEditor: editorMode,
state: function () {
splitCustomLayer();
return {
layer: ME.layer, tool: ME.tool, asset: ME.asset, floor: ME.floor, terrain: ME.terrain,
floorCount: Object.keys(floorEdits).length, terrainCount: Object.keys(terrainEdits).length,
objectCount: customFurniture.filter(function (f) { return f.a && !isHideEntry(f) && !isMoveEntry(f) && !isFloorEntry(f) && !isTerrainEntry(f) && !isLightEntry(f) && !isShadowEntry(f); }).length,
moveCount: Object.keys(moveOverrides).length, hidden: hiddenCount(),
grid: !!gridOverlay, continuous: !!ME.continuous,
undoCount: meUndoStack.length, redoCount: meRedoStack.length,
roomLights: Object.assign({}, roomLights), lightsOn: !!lightsOn,
selF: editSelItem && editSelItem.f ? { id: editSelItem.f.id || "", a: editSelItem.f.a, room: editSelItem.f.room || "", band: !!editSelItem.f.band } : null,
rot: EDIT_ROT, rotLabel: ROT_LABEL[EDIT_ROT], canRotate: !!(ME.asset && rotatable(ME.asset)),
hub: hubMapOk === true, hubError: hubMapErr, mirror: mirrorPending,
lastSave: { at: lastSave.at, ok: lastSave.ok, count: lastSave.count, err: lastSave.err, hubCount: lastSave.hubCount },
lightCount: lightEdits.length,
shadowCount: shadowEdits.length, lightMode: ME_LIGHTMODE, selectedShadow: ME_SHADOW_SEL,
shadowDefaults: { night: SHADOW_DEFAULTS.night, lit: SHADOW_DEFAULTS.lit, day: SHADOW_DEFAULTS.day },
night: { alpha: nightCfg.alpha, pad: nightCfg.pad, preview: nightCfg.preview, roomMask: nightCfg.roomMask !== false, ambient: nightCfg.ambient == null ? 0.42 : nightCfg.ambient },
lightPreset: nightPreset, lightPresets: LIGHT_PRESETS.map(function (p) { return { id: p.id, label: p.label, tint: p.tint, r: p.r, a: p.a }; }),
selectedLight: selectedLight,
assets: EDIT_PICKABLE.slice(0), floorStyles: Object.keys(FLOOR_STYLE), floorLabels: FLOOR_LABEL, terrainLabels: TERRAIN_LABEL,
categories: EDIT_CATS.map(function (c) { return { id: c.id, label: c.label, icon: c.icon, assets: c.assets.slice(0) }; })
};
},
setLayer: function (l) { ME.layer = l; if (l === "object" && editTool === "delete") setEditTool("select"); return ME.layer; },
setTool: function (t) { ME.tool = t; return ME.tool; },
setAsset: function (a) { ME.asset = a; if (a) { ME.tool = "paint"; setEditTool("add"); editAsset = a; } else { setEditTool("select"); clearEditGhost(); } return ME.asset; },
setContinuous: function (on) { ME.continuous = !!on; return ME.continuous; },
selfCheck: function () { return meSelfCheck(); },
listBackups: function () { return meListBackups(); },
restoreBackup: function (name, cb) { return meRestoreBackup(name, cb); },
localMirror: function () { return meLocalMirrorInfo(); },
restoreFromMirror: function (cb) { return meRestoreFromMirror(cb); },
setRoomLight: function (room, on) { return meSetRoomLight(room, on); },
patchObject: function (id, patch) { return mePatchObject(id, patch); },
toggleSwitchAt: function (wx, wy) { return meToggleSwitchAt(wx, wy); },
focusAt: function (wx, wy) { return meFocusAt(wx, wy); },
locateObject: function (key) { return meLocateObject(key); },
locateLight: function (id) { return meLocateLight(id); },
locateShadow: function (id) { return meLocateShadow(id); },
undo: function () { return meUndo(); },
redo: function () { return meRedo(); },
clearLayer: function (kind) { return meClearLayer(kind || "all"); },
rotate: function () {
var r = meRotateSelected();
if (editGhost) { var fr = editFrameFor(editAsset || (editGhost && editGhost.texture && editGhost.texture.key), r); if (fr && editGhost.setFrame) editGhost.setFrame(fr); }
return { rot: r, label: ROT_LABEL[r] };
},
setRot: function (r) { EDIT_ROT = (Number(r) || 0) & 3; return EDIT_ROT; },
setFloor: function (t) { ME.floor = t; ME.layer = "floor"; ME.tool = "paint"; return ME.floor; },
setTerrain: function (t) { ME.terrain = t; ME.layer = "terrain"; ME.tool = "paint"; return ME.terrain; },
paint: function (layer, t, tx, ty, band) { return meSetTile(layer, t, tx, ty, !!band); },
lights: function () {
splitCustomLayer();
return lightEdits.map(function (L) {
return { id: L.id, builtin: !!L.builtin, x: L.x, y: L.y, r: L.r, a: L.a, tint: L.tint, selected: L.id === selectedLight };
});
},
addLight: function (tx, ty) { return meAddLight(tx, ty); },
removeLight: function (id) { return meRemoveLight(id); },
selectLight: function (id) { selectedLight = id; return true; },
patchLight: function (id, patch) { return mePatchLight(id, patch); },
moveLight: function (id, tx, ty) { return meMoveLight(id, tx, ty); },
setLightPreset: function (id) { nightPreset = id; return nightPreset; },
setNight: function (patch) { return meSetNight(patch); },
setNightAmbient: function (v) {
if (typeof nightCfg !== "undefined") { nightCfg.ambient = Math.max(0, Math.min(0.6, Number(v))); saveNightCfg(); }
if (scene) applyRoomLights(scene);
return nightCfg.ambient;
},
setLightMode: function (m) { ME_LIGHTMODE = (m === "shadow" ? "shadow" : "light"); ME_DRAW = null; meDrawPreview(); return ME_LIGHTMODE; },
setShadowLv: function (lv) { ME_SHADOW_LV = Math.max(1, Math.min(3, Number(lv) || 2)); return ME_SHADOW_LV; },
shadows: function () {
splitCustomLayer();
return shadowEdits.map(function (r) {
return { id: r.id, label: r.label || "", builtin: !!r.builtin, room: r.room || null, roomLabel: ({office:"办公室",bedroom:"起居",bath:"卫浴",kitchen:"厨房"})[r.room] || "全局",
x: r.x, y: r.y, w: r.w, h: r.h,
night: +Number(r.night).toFixed(2), lit: +Number(r.lit).toFixed(2), day: +Number(r.day).toFixed(2),
selected: r.id === ME_SHADOW_SEL, alphaNow: +shadowAlphaOf(r).toFixed(2) };
});
},
addShadow: function (x, y, w, h) { return meAddShadow(x, y, x + (w || 1) - 1, y + (h || 1) - 1); },
patchShadow: function (id, patch) { return mePatchShadow(id, patch); },
removeShadow: function (id) { return meRemoveShadow(id); },
selectShadow: function (id) { ME_SHADOW_SEL = id; return true; },
clearShadows: function () { return meClearShadows(); },
setShadowDefaults: function (patch) {
["night", "lit", "day"].forEach(function (k) {
if (patch && patch[k] != null) SHADOW_DEFAULTS[k] = Math.max(0, Math.min(0.95, Number(patch[k])));
});
return SHADOW_DEFAULTS;
},
entries: function () {
splitCustomLayer();
return {
floor: Object.keys(floorEdits).map(function (k) { return { x: floorEdits[k].x, y: floorEdits[k].y, t: floorEdits[k].t }; }),
terrain: Object.keys(terrainEdits).map(function (k) { return { x: terrainEdits[k].x, y: terrainEdits[k].y, t: terrainEdits[k].t }; }),
moves: Object.keys(moveOverrides).map(function (k) { return { k: k, x: moveOverrides[k].x, y: moveOverrides[k].y }; })
};
},
objects: function () {
if (!scene || !scene.placed) return [];
var cam = scene.cameras.main, vw = cam.worldView, out = [];
scene.placed.forEach(function (p) {
if (!p || !p.f || !p.spr || !p.spr.active) return;
if (p.x < vw.x - 64 || p.x > vw.x + vw.width + 64) return;
if (p.y < vw.y - 64 || p.y > vw.y + vw.height + 64) return;
var pos = furniturePosText(p);
out.push({ key: furnitureKeyOf(p.f), a: p.f.a,
x: Math.round(p.x), y: Math.round(p.y), pos: pos,   // x/y 供排序用（世界像素），pos 是格子坐标文本
custom: !!p.f._custom, moved: !!p.f._moved,
icon: assetIconUrl(p.f.a, p.f.frame || 0) });
});
out.sort(function (a, b) {
var cx = vw.x + vw.width / 2, cy = vw.y + vw.height / 2;
return (Math.abs(a.x - cx) + Math.abs(a.y - cy)) - (Math.abs(b.x - cx) + Math.abs(b.y - cy));
});
return out.slice(0, 40);
},
focus: function (key) {
var p = (scene && scene.placed || []).filter(function (q) { return q.f && furnitureKeyOf(q.f) === key; })[0];
if (!p) return false;
markEditSelection(p);
focusOnPlacement(p);
return true;
},
deleteObject: function (key) {
var p = (scene && scene.placed || []).filter(function (q) { return q.f && furnitureKeyOf(q.f) === key; })[0];
if (!p) return false;
if (p.f._custom) return saveEditMap(false, { action: "remove", item: { id: p.f.id } }, function () {}) || true;
hideStaticItem(p);
return true;
},
restoreHidden: function () {
var kept = customFurniture.filter(function (f) { return !isHideEntry(f); });
saveEditMap(false, { action: "set", item: kept }, function () {});
return true;
},
clearAll: function () { saveEditMap(false, { action: "set", item: [] }, function () {}); return true; },
save: function () { saveEditMap(false, null, function () {}); return true; },
saveNow: function (cb) { return saveMapAndVerify(cb); },
grid: function (on) {
if (typeof on === "boolean") {
if (on && !gridOverlay) toggleGrid(true);
else if (!on && gridOverlay) toggleGrid(false);
}
return !!gridOverlay;
},
icon: assetIconUrl,
camera: function (dx, dy, zoom) {
if (!scene) return null;
var cam = scene.cameras.main;
cam.stopFollow();
if (dx || dy) { cam.scrollX += dx; cam.scrollY += dy; }
if (zoom) {
cam.setZoom(Phaser.Math.Clamp(cam.zoom + zoom, minZoomNoVoid(), 3));   // v78：不允许缩到露底
clampScroll(cam);
}
return { scrollX: Math.round(cam.scrollX), scrollY: Math.round(cam.scrollY), zoom: +cam.zoom.toFixed(2) };
}
};
function meRotateSelected() {
EDIT_ROT = (EDIT_ROT + 1) & 3;
var p = editSelItem;
if (p && p.f && p.f._custom && p.f.id) {
var fr = editFrameFor(p.f.a, EDIT_ROT);
saveEditMap(false, { action: "update", item: { id: p.f.id, frame: fr } }, function () {});   // 只写 frame
}
return EDIT_ROT;
}
function editPointerDown(worldX, worldY, pointer) {
var cx = pointer && pointer.event ? pointer.event.clientX : null;
var cy = pointer && pointer.event ? pointer.event.clientY : null;
if (editTool === "add" && editAsset) {
var item = { a: editAsset, x: editSnapX(worldX), y: editSnapY(worldY) };
if (worldY < WALL_H && meWallAsset(editAsset)) { item.y = 0; item.band = true; }   // v51：贴到顶部墙带
var fr = editFrameFor(editAsset, EDIT_ROT);
if (fr) item.frame = fr;                      // 有朝向的素材：记帧号
var extra = placeExtraFor(editAsset);        // 窗：wall:true（不挡路、贴底图，可随意摆放）
if (extra) { for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) item[k] = extra[k]; }
var shiftHeld = !!(pointer && pointer.event && pointer.event.shiftKey);
if (!ME.continuous && !shiftHeld) {           // v46：按住 Shift = 连续摆放；否则放一次就交还选择工具
ME.asset = null;
ME.tool = "select";
setEditTool("select");
clearEditGhost();
}
saveEditMap(false, { action: "add", item: item }, function (ok, err) {
if (ok) editToast("已放置 " + editAsset, worldX, worldY, cx, cy);
else editToast("已放在本机（hub 未同步：" + err + "）", worldX, worldY, cx, cy);
});
return true;
}
var hit = pickEditItem(worldX, worldY);
var st = hit ? null : hitStaticItem(worldX, worldY);
if (editTool === "delete") {
if (!hit) {
if (st) { hideStaticItem(st, cx, cy); return true; }      // 静态家具：直接隐藏（可恢复）
editToast("这里没有物件（点家具身上再试，或用面板里的物件列表）", worldX, worldY, cx, cy);
return true;
}
var fid = hit.f.id;
clearEditSelection();
saveEditMap(false, { action: "remove", item: { id: fid } }, function (ok, err) {
editToast(ok ? "已删除 " + (hit.f && hit.f.a) : "已在本机删除（hub 未同步：" + err + "）", worldX, worldY, cx, cy);
});
return true;
}
if (editTool === "move") {
if (!hit) {
if (st) { editDragItem = st; markEditSelection(st); return true; }
editToast("这里没有物件", worldX, worldY, cx, cy);
return true;
}
editDragItem = hit;
markEditSelection(hit);
return true;
}
if (hit) {
markEditSelection(hit);
editToast("已选中 " + (hit.f && hit.f.a) + " @ " + (hit.f && (hit.f.x + "," + hit.f.y)), worldX, worldY, cx, cy);
return true;
}
if (st) {
markEditSelection(st);
editToast("静态家具 " + (st.f && st.f.a) + "（🗑 或列表 ✕ 可隐藏）", worldX, worldY, cx, cy);
return true;
}
clearEditSelection();
return false;
}
function editPointerMove(worldX, worldY) {
if (editDragItem && editDragItem.spr) {
var gx = editSnapX(worldX), gy = editSnapY(worldY);   // v44：与放置同一套吸附
if (worldY < WALL_H && editDragItem && editDragItem.f && editDragItem.f.a &&
meWallAsset(editDragItem.f.a)) gy = 0;            // v51：拖到墙带 → y=0
var wp = editSnapToWorld(gx, gy);
editDragItem.spr.x = wp.x;
editDragItem.spr.y = wp.y;
editDragItem.spr.setDepth(editDragItem.spr.y);
if (editDragItem.shadow) { editDragItem.shadow.x = editDragItem.spr.x; editDragItem.shadow.y = editDragItem.spr.y + 1; editDragItem.shadow.setDepth(editDragItem.spr.depth - 1); }
editDragItem._dragX = gx; editDragItem._dragY = gy;
if (editSelItem === editDragItem) markEditSelection(editDragItem);   // 框跟着手指走
return true;
}
if (editTool === "add") { updateEditGhost(worldX, worldY); return true; }
return false;
}
function editPointerUp() {
if (editDragItem && editDragItem._dragX != null) {
var f = editDragItem.f;
var nx = editDragItem._dragX, ny = editDragItem._dragY;
if (f && !f._custom) {
meMoveTo(editDragItem, nx, ny);        // 静态家具：写 move 覆盖
} else if (f) {
var wallish = meWallAsset(f.a);
var patch = { id: f.id, x: nx, y: ny };
if (wallish) patch.band = ny < 0.9;
saveEditMap(false, { action: wallish ? "update" : "move", item: patch }, function (ok, err) {
editToast(ok ? "已移动" : "已在本机移动（hub 未同步：" + err + "）");
});
}
editDragItem._dragX = editDragItem._dragY = null;
}
editDragItem = null;
}
function minZoomNoVoid() {
if (!scene) return 0.6;
var cam = scene.cameras.main;
return Math.max(cam.width / W, cam.height / H, 0.1);
}
function clampScroll(cam) {
var b = cam.getBounds ? cam.getBounds() : null;
if (!b || !b.width) return;
var vw = cam.width / cam.zoom, vh = cam.height / cam.zoom;
var maxX = Math.max(0, b.x + b.width - vw);
var maxY = Math.max(0, b.y + b.height - vh);
cam.scrollX = Math.min(Math.max(cam.scrollX, b.x), maxX);
cam.scrollY = Math.min(Math.max(cam.scrollY, b.y), maxY);
}
function meFocusAt(wx, wy) {
if (!scene || !scene.cameras) return false;
var cam = scene.cameras.main;
cam.stopFollow();
var halfW = cam.width / 2 / cam.zoom, halfH = cam.height / 2 / cam.zoom;
var tx = Math.min(Math.max(wx, halfW), W - halfW);
var ty = Math.min(Math.max(wy, halfH), H - halfH);
if (cam.pan) cam.pan(tx, ty, 320, "Sine.easeInOut");
else { cam.scrollX = tx - halfW; cam.scrollY = ty - halfH; }
try { if (typeof flashAt === "function") flashAt(scene, wx, wy, 0xfff3c4); } catch (err) {}
return true;
}
function meLocateObject(key) {
var hit = null;
(scene && scene.placed || []).forEach(function (p) {
if (!p.f || !p.spr) return;
if (furnitureKeyOf(p.f) === key) hit = p;
});
if (!hit) return false;
return meFocusAt(hit.spr.x, hit.spr.y - 12);
}
function meLocateLight(id) {
var L = lightEdits.filter(function (q) { return q.id === id; })[0];
if (!L) return false;
return meFocusAt(L.x * TILE + TILE / 2, WALL_H + L.y * TILE + TILE / 2);
}
function meLocateShadow(id) {
var r = shadowEdits.filter(function (q) { return q.id === id; })[0];
if (!r) return false;
return meFocusAt((r.x + r.w / 2) * TILE, WALL_H + (r.y + r.h / 2) * TILE);
}
function meToggleSwitchAt(wx, wy) {
if (!scene) return false;
var hit = null;
(scene.placed || []).forEach(function (p) {
if (!p.f || (p.f.a !== "switch" && p.f.a !== "wall-lamp") || !p.spr) return;
var bb = p.bbox || [0, 0, 24, 24];
var halfW = (bb[2] || 24) / 2 + 8;
var top = p.y - (bb[3] || 24) - 10, bottom = p.y + 10;
if (wx > p.x - halfW && wx < p.x + halfW && wy > top && wy < bottom) hit = p;
});
if (!hit) return false;
var ok = toggleSwitchAt(wx, wy);
if (ok) {
var room = hit.room || (typeof roomOfProp === "function" ? roomOfProp(hit) : null);
var msg = (room ? ({ office: "办公室", bedroom: "起居", bath: "卫浴", kitchen: "厨房" }[room] || room) : "灯光") +
(roomLights[room] === false ? "：关灯 ⚫" : "：开灯 💡");
editToast(msg, wx, wy);
try { if (typeof window.onEditorNotice === "function") window.onEditorNotice(msg); } catch (err) {}
if (typeof renderEditList === "function" && editMode) renderEditList();
}
return ok;
}
function mePatchObject(id, patch) {
if (!id) return false;
var ok = false;
customFurniture = customFurniture.map(function (f) {
if (f.id !== id) return f;
ok = true;
return Object.assign({}, f, patch);
});
if (!ok) return false;
meBeginMutation();
rebuildCustomLayer();
saveEditMap(false, { action: "update", item: Object.assign({ id: id }, patch) }, function () {});
return true;
}
function meSetRoomLight(room, on) {
if (room === "all") {
["office", "bedroom", "bath", "kitchen", "nbCat", "nbChief", "nbDoc"].forEach(function (k) { roomLights[k] = !!on; });
lightsOn = !!on;
} else if (roomLights[room] !== undefined) {
roomLights[room] = !!on;
lightsOn = ["office", "bedroom", "bath", "kitchen", "nbCat", "nbChief", "nbDoc"].some(function (k) { return roomLights[k]; });
}
if (scene) applyRoomLights(scene);
return { lights: Object.assign({}, roomLights), on: lightsOn };
}
function meSelfCheck() {
var out = {
local: customFurniture.length, hubOk: hubMapOk, hubError: hubMapErr,
lastSave: lastSave, mirror: mirrorPending, editing: meEditing,
undo: meUndoStack.length, forward: meRedoStack.length,
objects: 0, floor: Object.keys(floorEdits).length, terrain: Object.keys(terrainEdits).length
};
return fetch(hubMapUrl(), { method: "GET" })
.then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
.then(function (j) {
out.hubCount = (j.furniture || []).length;
out.hubUpdatedAt = j.updatedAt || 0;
out.hubReachable = true;
return fetch(hubMapUrl(), { method: "POST", headers: { "Content-Type": "application/json" },
body: JSON.stringify({ action: "set", item: customFurniture }) })
.then(function (r2) { return r2.json().then(function (j2) { return { s: r2.status, j: j2 }; }); })
.then(function (res) {
out.writeOk = !!(res.j && res.j.ok);
out.writeError = (res.j && res.j.error) || (out.writeOk ? "" : ("HTTP " + res.s));
out.writeCount = res.j && res.j.count;
return out;
});
})
.catch(function (err) {
out.hubReachable = false;
out.writeOk = false;
out.writeError = (err && err.message) || "网络错误";
return out;
});
}
function meListBackups() {
return fetch(hubMapUrl().replace(/\/api\/map$/, "/api/map/backups"), { method: "GET" })
.then(function (r) { return r.json(); })
.catch(function () { return { dir: "", list: [] }; });
}
function meRestoreBackup(name, cb) {
fetch(hubMapUrl().replace(/\/api\/map$/, "/api/map/restore"), {
method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name })
}).then(function (r) { return r.json(); }).then(function (j) {
if (j && j.ok) probeMapHub(function () {});
if (cb) cb(!!(j && j.ok), j && (j.error || ("已恢复 " + j.count + " 条")));
}).catch(function (err) { if (cb) cb(false, (err && err.message) || "网络错误"); });
}
function meLocalMirrorInfo() {
var m = loadLocalMirror();
if (!m) return null;
return { count: (m.furniture || []).length, updatedAt: m.updatedAt || 0, pending: !!m.pending, furniture: m.furniture || [] };
}
function meRestoreFromMirror(cb) {
var m = loadLocalMirror();
if (!m || !Array.isArray(m.furniture) || !m.furniture.length) { if (cb) cb(false, "本机没有可用副本"); return false; }
meBeginMutation();
customFurniture = m.furniture.slice();
rebuildCustomLayer();
saveEditMap(false, { action: "set", item: customFurniture }, function (ok, err) {
if (cb) cb(ok, ok ? ("已用本机副本覆盖 hub（" + customFurniture.length + " 条）") : err);
});
return true;
}
function saveEditMap(silent, payload, cb) {
var clean = sanitizeCustomLayer(customFurniture);
if (clean.fixed.length) {
customFurniture = clean.list;
saveLocalMirror();
addEditLog("已修正越界坐标：" + clean.fixed.join("；"));
if (typeof renderEditList === "function" && editMode) renderEditList();
}
var act = payload ? String(payload.action || "") : "set";
if (!meApplyingHistory && !meSyncLock) mePushHistory();   // v46：写操作前留快照（改前改后各留一次就够）
meSyncLock = false;
var item = payload ? payload.item : null;
var mutated = false;
if (act === "add" && item) {
var it = Object.assign({}, item);
if (!it.id) it.id = "cu" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
if (payload) payload.item = it;              // id 由前端生成：本地与 hub 用同一个（hub 有 id 就不重发）
customFurniture = customFurniture.concat([it]);
mutated = true;
} else if (act === "remove" && item) {
var n0 = customFurniture.length;
customFurniture = customFurniture.filter(function (f) { return f.id !== item.id; });
mutated = customFurniture.length !== n0;
if (!mutated) { if (cb) cb(false, "未找到 " + (item && item.id)); return; }
} else if ((act === "move" || act === "update") && item) {
var hit = false;
customFurniture = customFurniture.map(function (f) {
if (f.id !== item.id) return f;
hit = true;
return Object.assign({}, f, item);
});
mutated = hit;
if (!mutated) { if (cb) cb(false, "未找到 " + (item && item.id)); return; }
} else if (act === "set" && Array.isArray(item)) {
customFurniture = item.slice();
mutated = true;
}
if (mutated) {
inflightMapOps++;
rebuildCustomLayer();     // 立刻可见，不等 WS 回显
}
var body = payload || { action: "set", item: customFurniture };
var done = function (ok, err) {
if (mutated) inflightMapOps = Math.max(0, inflightMapOps - 1);
if (ok) {
hubMapOk = true; hubMapErr = "";
mirrorPending = false; mirrorFlushTried = false;
saveLocalMirror();
if (!silent) addEditLog("已保存到 hub（" + customFurniture.length + " 条）");
} else {
hubMapOk = false; hubMapErr = err || "hub 不可达";
if (mutated) { mirrorPending = true; saveLocalMirror(); }
mirrorFlushTried = false;
scheduleMirrorRetry();      // v57：失败自动重试（hub 恢复后自己补上）
if (!silent) addEditLog("hub 未同步：" + hubMapErr + "（改动存在本机，稍后自动重试）");
}
if (cb) cb(ok, ok ? "" : hubMapErr);
};
postMapApi(body, done);
}
function addEditLog(msg) {
var box = document.getElementById("edit-log");
if (!box) return;
var d = document.createElement("div");
d.textContent = new Date().toLocaleTimeString("zh-CN", { hour12: false }) + " " + msg;
box.prepend(d);
while (box.children.length > 8) box.removeChild(box.lastChild);
}
var iconUrlCache = {};
function assetIconUrl(key, frame) {
if (!key) return "";
var ck = key + "#" + (frame || 0);
if (iconUrlCache[ck] !== undefined) return iconUrlCache[ck];
var url = "";
try {
var m = MAN && MAN[key];
var tex = scene && scene.textures && scene.textures.exists(key) ? scene.textures.get(key) : null;
if (m && tex) {
var fr = tex.get(frame || 0) || tex.get(0);
var src = tex.getSourceImage();
var bb = m.bbox || [0, 0, m.frameW || 24, m.frameH || 24];
if (fr && src && bb[2] > 0 && bb[3] > 0) {
var k = Math.max(1, Math.floor(22 / Math.max(bb[2], bb[3])));
var cv = document.createElement("canvas");
cv.width = Math.round(bb[2]) * k;
cv.height = Math.round(bb[3]) * k;
var ctx = cv.getContext("2d");
ctx.imageSmoothingEnabled = false;
ctx.drawImage(src, fr.cutX + bb[0], fr.cutY + bb[1], bb[2], bb[3], 0, 0, cv.width, cv.height);
url = cv.toDataURL("image/png");
}
}
} catch (e) { url = ""; }
iconUrlCache[ck] = url;
return url;
}
function buildEditPanel() {
if (editorMode) return;   // 独立编辑器有自己的侧栏（web/editor.js），不重复建游戏内小面板
if (document.getElementById("edit-panel")) return;
var host = document.getElementById("office-parent");
if (!host) return;
var panel = document.createElement("div");
panel.id = "edit-panel";
panel.style.cssText = "position:absolute;z-index:45;left:14px;top:52px;width:262px;max-height:calc(100% - 64px);overflow:auto;" +
"border-radius:10px;background:#1d2130f2;border:1px solid #ffffff33;color:#ece8df;box-shadow:0 6px 20px #0008;display:none;" +
"font:12px/1.6 'PingFang SC','Microsoft YaHei',system-ui,sans-serif;padding:10px 12px;";
panel.innerHTML =
'<style>' +
'#edit-panel button.ep-btn:hover{border-color:#4a6cf7 !important;color:#fff !important}' +
'#edit-panel button.ep-btn.active{background:#4a6cf7 !important;border-color:#4a6cf7 !important;color:#fff !important;box-shadow:0 0 0 1px #ffffff55 inset !important}' +
'#edit-panel #edit-assets button{display:flex;align-items:center;gap:4px;text-align:left}' +
'#edit-panel #edit-assets .ep-asset-ico{width:18px;height:18px;flex:none;object-fit:contain;image-rendering:pixelated}' +
'#edit-panel #edit-assets .ep-asset-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
'#edit-panel #edit-list .ep-row{display:flex;align-items:center;gap:6px;padding:2px 4px;border-bottom:1px dashed #ffffff12}' +
'#edit-panel #edit-list .ep-row .ep-ico{width:22px;height:22px;flex:none;display:flex;align-items:center;justify-content:center;background:#ffffff12;border-radius:4px;overflow:hidden;color:#6b7280}' +
'#edit-panel #edit-list .ep-row .ep-ico img{max-width:100%;max-height:100%;display:block;image-rendering:pixelated}' +
'#edit-panel #edit-list .ep-row .ep-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
'#edit-panel #edit-list .ep-row .ep-pos{flex:none;color:#9aa3b8;font-variant-numeric:tabular-nums}' +
'#edit-panel #edit-list .ep-row .ep-del{flex:none;border:0;background:transparent;color:#ff8787;cursor:pointer;padding:0 2px}' +
'#edit-panel #edit-list .ep-row .ep-tag{flex:none;font-style:normal;font-size:9.5px;padding:0 3px;margin-left:4px;border-radius:4px;background:#ffffff1a;color:#9aa3b8}' +
'#edit-panel #edit-list .ep-row .ep-tag.cus{background:#4a6cf7aa;color:#fff}' +
'#edit-panel #edit-list .ep-row:hover{background:#ffffff14;border-radius:5px}' +
'#edit-panel #edit-list .ep-row.row-sel{background:#4a6cf7;border-radius:5px;color:#fff}' +
'#edit-panel #edit-list .ep-row.row-sel .ep-pos{color:#dbe4ff}' +
'</style>' +
'<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px"><b style="color:#ffd43b">地图编辑</b>' +
'<button id="edit-close" style="margin-left:auto;border:0;background:transparent;color:#9aa3b8;cursor:pointer;font-size:15px">×</button></div>' +
'<div style="display:flex;gap:5px;margin-bottom:8px">' +
["select|🖱 选择", "add|➕ 放置", "move|✥ 移动", "delete|🗑 删除"].map(function (p) {
var kv = p.split("|");
return '<button id="edit-tool-' + kv[0] + '" data-tool="' + kv[0] + '" class="ep-btn" style="flex:1;padding:4px 2px;border-radius:6px;border:1px solid #ffffff33;background:#2a2e3d;color:#ece8df;cursor:pointer;font-size:11.5px">' + kv[1] + "</button>";
}).join("") + "</div>" +
'<div id="edit-sel" style="color:#ffd43b;margin-bottom:6px;font-size:11px;min-height:16px"></div>' +
'<select id="edit-cat" style="width:100%;margin-bottom:5px;padding:3px 6px;border-radius:6px;border:1px solid #ffffff33;background:#2a2e3d;color:#ece8df;font-size:11.5px"></select>' +
'<div id="edit-assets" style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;max-height:170px;overflow:auto;margin-bottom:8px"></div>' +
'<div style="display:flex;gap:5px;margin-bottom:6px">' +
'<button id="edit-save" style="flex:1;padding:5px;border-radius:6px;border:0;background:#4a6cf7;color:#fff;cursor:pointer;font-weight:700">💾 保存到服务器</button>' +
'<button id="edit-clear" style="flex:none;padding:5px 8px;border-radius:6px;border:1px solid #ffffff33;background:transparent;color:#ff8787;cursor:pointer">清空</button></div>' +
'<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">' +
'<span style="color:#9aa3b8">物件列表（视口内 <span id="edit-obj-count">0</span> 件）</span>' +
'<button id="edit-obj-refresh" class="ep-btn" title="刷新列表（镜头移动后点一下）" style="margin-left:auto;padding:1px 6px;border-radius:5px;border:1px solid #ffffff33;background:#2a2e3d;color:#c3c9d9;cursor:pointer;font-size:11px">↻</button>' +
"</div>" +
'<div style="color:#9aa3b8;margin-bottom:4px">已放置 <span id="edit-count">0</span> 件自定义 · 上限 6000</div>' +
'<div id="edit-hub" style="color:#9aa3b8;margin-bottom:4px;font-size:11px"></div>' +
'<div id="edit-list" style="max-height:150px;overflow:auto;margin-bottom:4px"></div>' +
'<div id="edit-hidden" style="display:none;color:#ffc078;margin-bottom:4px;font-size:11px">' +
'已隐藏 <span id="edit-hidden-count">0</span> 件静态物件 <button id="edit-unhide" class="ep-btn" style="padding:0 6px;border-radius:5px;border:1px solid #ffffff33;background:transparent;color:#ffd43b;cursor:pointer;font-size:11px">全部恢复</button></div>' +
'<div id="edit-log" style="color:#8ce99a;min-height:16px;font-size:11px"></div>';
host.appendChild(panel);
panel.querySelector("#edit-close").onclick = function () { setEditMode(false); };
panel.querySelector("#edit-obj-refresh").onclick = function () { renderEditList(); };
panel.querySelector("#edit-hub").onclick = function () { probeMapHub(function () { renderEditList(); }); };
panel.querySelector("#edit-unhide").onclick = function () {
var kept = customFurniture.filter(function (f) { return !isHideEntry(f); });
saveEditMap(false, { action: "set", item: kept }, function (ok, err) {
addEditLog(ok ? "已恢复全部静态物件" : "已在本地恢复（hub 未同步：" + err + "）");
});
};
panel.querySelector("#edit-save").onclick = function () { saveEditMap(false, null, function (ok, err) { addEditLog(ok ? "全量已保存到 hub" : "hub 未同步：" + err + "（清单已存本机浏览器）"); }); };
panel.querySelector("#edit-clear").onclick = function () {
var n = customFurniture.filter(function (f) { return !isHideEntry(f); }).length;
if (!confirm("清空全部 " + n + " 件自定义物品？\n（隐藏的静态物件也会一起恢复）")) return;
clearEditSelection();
saveEditMap(false, { action: "set", item: [] }, function (ok, err) { addEditLog(ok ? "已清空" : "已在本机清空（hub 未同步：" + err + "）"); });
};
["select", "add", "move", "delete"].forEach(function (k) {
var b = panel.querySelector("#edit-tool-" + k);
b.onclick = function () { setEditTool(k); };
});
var wrap = panel.querySelector("#edit-assets");
var catSel = panel.querySelector("#edit-cat");
var catOf = {};
EDIT_CATS.forEach(function (c) { c.assets.forEach(function (a) { catOf[a] = c.id; }); });
var opts = [{ id: "all", label: "全部（" + EDIT_PICKABLE.length + "）" }].concat(EDIT_CATS.map(function (c) {
return { id: c.id, label: c.icon + " " + c.label + "（" + c.assets.length + "）" };
}));
opts.forEach(function (o) {
var op = document.createElement("option");
op.value = o.id; op.textContent = o.label;
catSel.appendChild(op);
});
EDIT_PICKABLE.forEach(function (a) {
var b = document.createElement("button");
b.dataset.asset = a;
b.dataset.cat = catOf[a] || "misc";
b.title = a;
b.className = "ep-btn";   // 注意：类名要在 classList.toggle("active") 之前设好
b.style.cssText = "padding:3px 4px;border-radius:5px;border:1px solid #ffffff22;background:#2a2e3d;color:#c3c9d9;cursor:pointer;font-size:10px;overflow:hidden;white-space:nowrap";
var ico = assetIconUrl(a, 0);   // 图标用第 0 帧（静止朝向），够认物件了
b.innerHTML = (ico ? '<img class="ep-asset-ico" src="' + ico + '" alt="">' : "") +
'<span class="ep-asset-name">' + a.replace(/^(office|kitchen|market|round|school|dining|double|bench|stall|sign|filing|floor|desk|crown|house)-/, "") + "</span>";
b.onclick = function () { setEditAsset(a); };
wrap.appendChild(b);
});
catSel.onchange = function () {
var v = catSel.value;
[].forEach.call(wrap.querySelectorAll("button"), function (b) {
b.style.display = (v === "all" || b.dataset.cat === v) ? "" : "none";
});
};
catSel.value = "all";
setEditTool("select");
}
function visibleFurniture() {
var s = scene;
if (!s || !s.placed || !s.cameras) return [];
var vw = s.cameras.main.worldView, pad = 64;
var out = [];
s.placed.forEach(function (p) {
if (!p || !p.f || !p.spr || !p.spr.active) return;
if (p.x < vw.x - pad || p.x > vw.x + vw.width + pad) return;
if (p.y < vw.y - pad || p.y > vw.y + vw.height + pad) return;
out.push(p);
});
var cx = vw.x + vw.width / 2, cy = vw.y + vw.height / 2;
out.sort(function (a, b) {
return (Math.abs(a.x - cx) + Math.abs(a.y - cy)) - (Math.abs(b.x - cx) + Math.abs(b.y - cy));
});
return out.slice(0, 60);
}
function renderEditList() {
var el = document.getElementById("edit-list");
var cnt = document.getElementById("edit-count");
if (cnt) cnt.textContent = String(customFurniture.filter(function (f) { return !isHideEntry(f); }).length);
var hubEl = document.getElementById("edit-hub");
if (hubEl) {
var txt, color;
if (hubMapOk === true) { txt = mirrorPending ? "hub 已连（有本机改动待同步）" : "hub 已连：改动会写进 map.custom.json"; color = "#8ce99a"; }
else if (hubMapOk === false) { txt = "hub 未连接（" + (hubMapErr || "网络错误") + "）：改动只存本机浏览器"; color = "#ffc078"; }
else { txt = "正在探测 hub…"; color = "#9aa3b8"; }
hubEl.textContent = txt;
hubEl.style.color = color;
}
var hidEl = document.getElementById("edit-hidden");
var hidN = hiddenCount();
if (hidEl) hidEl.style.display = hidN ? "block" : "none";
var hidCnt = document.getElementById("edit-hidden-count");
if (hidCnt) hidCnt.textContent = String(hidN);
if (!el) return;
var rows = visibleFurniture();
var objCnt = document.getElementById("edit-obj-count");
if (objCnt) objCnt.textContent = String(rows.length);
el.innerHTML = rows.map(function (p) {
var f = p.f;
var key = furnitureKeyOf(f);
var isCus = !!f._custom;
var selCls = (editSelItem === p) ? " row-sel" : "";
var ico = assetIconUrl(f.a, f.frame || 0);
return '<div class="ep-row' + selCls + '" data-key="' + key + '">' +
'<span class="ep-ico">' + (ico ? '<img src="' + ico + '" alt="" title="' + f.a + '">' : "▢") + "</span>" +
'<span class="ep-name">' + f.a + '<i class="ep-tag' + (isCus ? " cus" : "") + '">' + (isCus ? "自建" : "静态") + "</i></span>" +
'<span class="ep-pos">' + furniturePosText(p) + "</span>" +
'<button class="ep-del" data-key="' + key + '" title="' + (isCus ? "删除" : "隐藏（可恢复）") + '">✕</button></div>';
}).join("") || '<div style="color:#9aa3b8;padding:6px 2px">视口里没有物件</div>';
[].forEach.call(el.querySelectorAll(".ep-row"), function (row) {
row.onclick = function (ev) {
if (ev.target && ev.target.closest && ev.target.closest("button")) return;
var key = row.dataset.key;
var p = (scene.placed || []).filter(function (q) { return q.f && furnitureKeyOf(q.f) === key; })[0];
if (!p) return;
markEditSelection(p);
focusOnPlacement(p);
editToast("已选中 " + p.f.a + " @ " + p.f.x + "," + p.f.y);
};
row.onmouseenter = function () {
var key = row.dataset.key;
var p = (scene.placed || []).filter(function (q) { return q.f && furnitureKeyOf(q.f) === key; })[0];
if (p) markEditSelection(p);
};
});
[].forEach.call(el.querySelectorAll("button.ep-del"), function (b) {
b.onclick = function (ev) {
ev.stopPropagation();
var key = b.dataset.key;
var p = (scene.placed || []).filter(function (q) { return q.f && furnitureKeyOf(q.f) === key; })[0];
if (!p) return;
if (p.f._custom) {
if (editSelItem === p) clearEditSelection();
saveEditMap(false, { action: "remove", item: { id: p.f.id } }, function (ok, err) {
editToast(ok ? "已删除 " + p.f.a : "已在本机删除（hub 未同步：" + err + "）");
});
} else {
hideStaticItem(p);
}
};
});
}
function astar(sx, sy, ex, ey) {
if (!scene || !scene.grid) return null;
if (sx === ex && sy === ey) return [{ x: ex, y: ey }];
if (scene.grid[ey] && scene.grid[ey][ex]) {
var alt = nearestFree(ex, ey);
if (!alt) return null;
ex = alt.x; ey = alt.y;
}
var open = [{ x: sx, y: sy, g: 0, f: 0, p: null }];
var closed = {};
var best = null, guard = 0;
while (open.length && guard++ < 4000) {
var bi = 0;
for (var i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
var cur = open.splice(bi, 1)[0];
var key = cur.x + "," + cur.y;
if (closed[key]) continue;
closed[key] = 1;
if (cur.x === ex && cur.y === ey) { best = cur; break; }
var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
for (var d = 0; d < 4; d++) {
var nx = cur.x + dirs[d][0], ny = cur.y + dirs[d][1];
if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
if (scene.grid[ny][nx]) continue;
open.push({ x: nx, y: ny, g: cur.g + 1, f: cur.g + 1 + Math.abs(nx - ex) + Math.abs(ny - ey), p: cur });
}
}
if (!best) return null;
var path = [], n = best;
while (n) { path.unshift({ x: n.x, y: n.y }); n = n.p; }
return path;
}
function nearestFree(ex, ey) {
for (var r = 1; r <= 3; r++) {
for (var dy = -r; dy <= r; dy++) {
for (var dx = -r; dx <= r; dx++) {
var nx = ex + dx, ny = ey + dy;
if (nx < 1 || ny < 1 || nx >= COLS || ny >= ROWS) continue;
if (!scene.grid[ny][nx]) return { x: nx, y: ny };
}
}
}
return null;
}
var ACT_RATE = {
idle: 4, idle_back: 4, typing: 9, typing_back: 9, read: 3, sleep: 2,
drink: 4, wave: 8, lounge: 2, cheer: 7, sit: 3, think: 3,
play: 8, eat: 5, dizzy: 8, reach: 5
};
var ACT_ANIM = {
walk: "idle", idle: "idle", rest: "idle", watch: "idle",
typing: "typing", print: "reach", mail: "reach", craft: "think",
fetch: "reach", listen: "idle", play: "play", dizzy: "dizzy",
sleep: "sleep", drink: "drink", read: "read", lounge: "lounge",
cheer: "cheer", sit: "sit", think: "think", eat: "eat",
wave: "wave", reach: "reach"   // 本地生活事件直接用动作行名
};
function actRow(act) {
var name = ACT_ANIM[act] || "idle";
if (fish && fish.lastFace === "n") {
if (name === "idle") name = "idle_back";
else if (name === "typing") name = "typing_back";
}
return name;
}
function buildFish(s) {
var m = MAN.whale;
var acts = m.acts || {};
var mk = function (key, row, rate) {
if (!s.anims.exists(key)) {
s.anims.create({
key: key,
frames: s.anims.generateFrameNumbers("whale", { start: row * 8, end: row * 8 + 7 }),
frameRate: rate || 10, repeat: -1
});
}
};
mk("fish_s", 0); mk("fish_e", 1); mk("fish_w", 2); mk("fish_n", 3);
Object.keys(acts).forEach(function (name) {
if (name.indexOf("walk_") === 0) return;
mk("act_" + name, acts[name], ACT_RATE[name]);
});
var bbox = m.bbox;   // [20,15,24,40] 内容中心 x=32(帧中心), 底边 y=55
var bodyOffX = m.frameW / 2 - (bbox[0] + bbox[2] / 2);   // ≈ 0
var bodyOffY = m.frameH / 2 - (bbox[1] + bbox[3]);       // 负值，把帧中心抬到脚点上方
fish = s.add.container(TILE * 3, WALL_H + TILE * 3);
var body = s.add.sprite(bodyOffX, bodyOffY, "whale", 0);
var shadow = s.add.ellipse(0, 0, 30, 9, 0x000000, 0.22);
var badge = s.add.circle(0, -46, 5, 0x4a4e60).setStrokeStyle(1, 0x151826, 0.4);
fish.add([shadow, body, badge]);
fish.bodySpr = body;
fish.badge = badge;
fish.baseY = bodyOffY;   // stopActAnim/update 复位用
fish.setScale(0.95);
fish.lastFace = "s";
fish.face = function (dir) {
fish.lastFace = dir;
body.play(dir === "e" ? "fish_e" : dir === "w" ? "fish_w" : dir === "n" ? "fish_n" : "fish_s");
};
fish.still = function () {
body.anims.stop();
var row = fish.lastFace === "e" ? 1 : fish.lastFace === "w" ? 2 : fish.lastFace === "n" ? 3 : 0;
body.setFrame(row * 8);
};
fish.playAct = function (name) {
var row = acts[name];
if (row === undefined) return false;
body.play("act_" + name, true);
return true;
};
fish.setBadge = function (hex) { badge.fillColor = parseInt(hex.replace("#", ""), 16); };
s.props.push({ spr: fish, footY: fish.y, isFish: true });
}
function depthSort() {
if (!scene || !fish) return;
if (fish.sitting) return;   // 坐进家具时深度已手动指定，不被 y 覆盖
fish.setDepth(fish.y);
}
var roadsVisible = true;
var TILE_MATS = ["wood", "tile", "stone", "grass", "road", "wall", "window", "window-night", "sky", "water", "bank", "farm"];
function tileTex(mat) { return "tile-" + mat; }
function baseMaterialAt(tx, ty) {
if (tx <= 26) {                                         // 西北大屋：办公室/卧室/卫浴/厨房
if (ty < 15 && tx >= 10 && tx <= 15) return "tile";   // 卫浴瓷砖
if (ty < 15 && tx >= 17 && tx <= 24) return "tile";   // 厨房地砖
return "wood";
}
if (tx <= 38) return "grass";                            // 花园草地
if (ty >= 19) {                                          // 三户邻居室内
if (tx >= 40 && tx <= 45) return "wood";
if (tx >= 46 && tx <= 50) return "tile";
if (tx >= 51) return "stone";
}
return "stone";                                          // 小镇石板街
}
function paintRoads(s, rt) {
if (!roadsVisible) return;
var roads = (s.mapdata && s.mapdata.roads) || [];
if (roads.length) {
roads.forEach(function (rr) {
for (var ty = rr.y; ty < rr.y + rr.h; ty++) {
for (var tx = rr.x; tx < rr.x + rr.w; tx++) {
if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) continue;
rt.batchDraw(tileTex("road"), tx * TILE, WALL_H + ty * TILE);
}
}
});
return;
}
for (var ty2 = 8; ty2 <= 9; ty2++) {
for (var tx2 = 39; tx2 < COLS; tx2++) rt.batchDraw(tileTex("road"), tx2 * TILE, WALL_H + ty2 * TILE);
}
(s.mapdata.walls || []).forEach(function (wl) {
if (wl.x0 === undefined || wl.y !== 19 || !wl.gap) return;
for (var gx = wl.gap[0]; gx <= wl.gap[1]; gx++)
for (var gy = 10; gy <= 19; gy++) rt.batchDraw(tileTex("road"), gx * TILE, WALL_H + gy * TILE);
});
}
function paintPond(rt) {
var cx = (POND.x0 + POND.x1) / 2, cy = (POND.y0 + POND.y1) / 2;
var rx = (POND.x1 - POND.x0) / 2 + 0.12, ry = (POND.y1 - POND.y0) / 2 + 0.12;
for (var ty = 0; ty < ROWS; ty++) {
for (var tx = 0; tx < COLS; tx++) {
if (floorEdits[tx + "," + ty] || terrainEdits[tx + "," + ty]) continue;
var nx = (tx + 0.5 - cx) / rx, ny = (ty + 0.5 - cy) / ry;
var d = nx * nx + ny * ny;
if (d <= 1) rt.batchDraw(tileTex("water"), tx * TILE, WALL_H + ty * TILE);
else if (d <= 1.12) rt.batchDraw(tileTex("bank"), tx * TILE, WALL_H + ty * TILE);   // v43：沙岸收窄成一圈
}
}
var dockX = Math.floor(POND.x0 * TILE - 26), dockY = Math.floor(WALL_H + cy * TILE - 24);
rt.batchDraw(tileTex("road"), dockX, dockY);
rt.batchDraw(tileTex("road"), dockX + TILE, dockY);
}
function paintFarm(rt) {
for (var i = 0; i < FARM.cols * FARM.rows; i++) {
var t = plotTile(i);
rt.batchDraw(tileTex("farm"), t.x * TILE, WALL_H + t.y * TILE);
}
}
function paintWalls(s, rt) {
(s.mapdata.walls || []).forEach(function (wl) {
var isH = wl.x0 !== undefined;
var gapLo = wl.gap ? wl.gap[0] : -1e9, gapHi = wl.gap ? wl.gap[1] : -1e9;
if (isH) {
for (var x = wl.x0; x <= wl.x1; x++) {
if (x >= gapLo && x <= gapHi) continue;
rt.batchDraw(tileTex("wall"), x * TILE, WALL_H + wl.y * TILE);
}
} else {
for (var y = wl.y; y < wl.y + wl.h; y++) {
if (y >= gapLo && y <= gapHi) continue;
rt.batchDraw(tileTex("wall"), wl.x * TILE, WALL_H + y * TILE);
}
}
});
}
function paintTopBand(s, rt) {
var door = s.mapdata.door;
var indoorRight = 26.5;                                  // 室内北墙到 x=26.5，往东露天
for (var tx = 0; tx < COLS; tx++) {
var mat = tx < indoorRight ? "wall" : "sky";
rt.batchDraw(tileTex(mat), tx * TILE, 0);
}
for (var dx = 0; dx < door.tw; dx++) rt.batchDraw(tileTex("road"), (door.tx + dx) * TILE, 0);
}
function buildRoom(s) {
if (s.baseGfx) { try { s.baseGfx.destroy(); } catch (e) {} }   // rebuildRoomBase 旧层先拆
var rt = s.add.renderTexture(0, 0, W, H).setOrigin(0, 0).setDepth(-100);
rt._isBaseGfx = true;    // 兼容 rebuildRoomBase 的可见性自愈
s.baseGfx = rt;
rt.beginDraw();
for (var ty = 0; ty < ROWS; ty++) {
for (var tx = 0; tx < COLS; tx++) {
rt.batchDraw(tileTex(baseMaterialAt(tx, ty)), tx * TILE, WALL_H + ty * TILE);
}
}
paintRoads(s, rt);
paintPond(rt);
paintFarm(rt);
paintWalls(s, rt);
paintTopBand(s, rt);
rt.endDraw();
}
function toggleRoads(force) {
if (!scene || !scene.mapdata) return roadsVisible;
if (force === true && roadsVisible) return true;          // 已开
if (force === false && !roadsVisible) return false;       // 已关
roadsVisible = !roadsVisible;
rebuildRoomBase();   // 整层贴图重画（一次性，代价很小）
return roadsVisible;
}
function rebuildRoomBase() {
if (!scene || !scene.mapdata) return;
buildRoom(scene);
if (scene.baseGfx) scene.baseGfx.setVisible(true);
}
var FARM = {
x0: 28, y0: 22, cols: 5, rows: 4,          // 田地区（tile 坐标）
crops: [                                    // 种子 → 产出（也是料理食材）
{ id: "wheat",   name: "小麦",   seed: "麦种",   stages: 4, growMin: 90,  color: 0xd8b45a },
{ id: "tomato",  name: "番茄",   seed: "番茄苗", stages: 4, growMin: 110, color: 0xd64541 },
{ id: "carrot",  name: "胡萝卜", seed: "萝卜籽", stages: 3, growMin: 80,  color: 0xe8862c },
{ id: "corn",    name: "玉米",   seed: "玉米种", stages: 4, growMin: 130, color: 0xe8c832 },
{ id: "cabbage", name: "卷心菜", seed: "菜苗",   stages: 3, growMin: 100, color: 0x8fbf5a }
],
FERTILIZER_BOOST: 0.5   // 施肥：剩余生长时间 -50%
};
var farm = null;   // { plots: [{soil,watered,fed,crop,stage,progress,rot}], inv: {seeds:{}, crops:{}, feed}, day }
function farmNew() {
var plots = [];
for (var i = 0; i < FARM.cols * FARM.rows; i++) plots.push({ soil: false, watered: false, fed: false, crop: null, stage: 0, progress: 0 });
return { plots: plots, inv: { seeds: { wheat: 2, carrot: 1 }, crops: {}, feed: 1 }, day: bjDayKey(), fish: 0 };
}
function farmLoad() {
try {
var j = JSON.parse(localStorage.getItem("office_farm_v1") || "null");
if (j && j.plots && j.plots.length === FARM.cols * FARM.rows) {
if (j.day !== bjDayKey()) {         // 跨天：浇过水的地干掉，作物按存活天数推进
j.plots.forEach(function (p) { p.watered = false; p.fed = false; p.progress = (p.crop ? p.progress + 0.5 : 0); });
j.day = bjDayKey();
}
farm = j;
return;
}
} catch (e) {}
farm = farmNew();
farmSave();
}
function farmSave() { try { localStorage.setItem("office_farm_v1", JSON.stringify(farm)); } catch (e) {} }
function plotTile(i) { return { x: FARM.x0 + (i % FARM.cols), y: FARM.y0 + Math.floor(i / FARM.cols) }; }
function cropDef(id) { for (var i = 0; i < FARM.crops.length; i++) if (FARM.crops[i].id === id) return FARM.crops[i]; return null; }
function farmAct(act, slot) {
if (!farm) farmLoad();
var plots = farm.plots, order = [];
if (typeof slot === "number" && plots[slot]) order = [slot];
else for (var i = 0; i < plots.length; i++) order.push(i);
for (var k = 0; k < order.length; k++) {
var p = plots[order[k]];
if (act === "till" && !p.soil && !p.crop) {
p.soil = true; farmSave(); return { ok: true, slot: order[k], text: "翻开了一块生土" };
}
if (act === "water" && p.soil && !p.watered) {
p.watered = true; p.progress += 0.12; farmSave(); return { ok: true, slot: order[k], text: "浇水：土壤喝饱了" };
}
if (act === "sow" && p.soil && !p.crop) {
var ids = Object.keys(farm.inv.seeds).filter(function (id) { return farm.inv.seeds[id] > 0; });
if (!ids.length) return { ok: false, text: "种子用完了（去市集/翻农场可能找到）" };
var id = ids[Math.floor(Math.random() * ids.length)];
farm.inv.seeds[id]--;
p.crop = id; p.stage = 0; p.progress = 0; p.watered = false;
farmSave(); return { ok: true, slot: order[k], text: "播下了" + (cropDef(id) || {}).name };
}
if (act === "feed" && p.crop && !p.fed) {
if (!(farm.inv.feed > 0)) return { ok: false, text: "没有肥料了（钓鱼有时能捞到）" };
farm.inv.feed--; p.fed = true; p.progress = Math.min(1, p.progress + 0.2);
farmSave(); return { ok: true, slot: order[k], text: "施肥：" + (cropDef(p.crop) || {}).name + "长势更好了" };
}
if (act === "harvest" && p.crop && p.progress >= 1) {
var cd = cropDef(p.crop);
farm.inv.crops[p.crop] = (farm.inv.crops[p.crop] || 0) + 1;
p.crop = null; p.stage = 0; p.progress = 0; p.watered = false; p.fed = false;
farmSave(); return { ok: true, slot: order[k], text: "收获了" + (cd ? cd.name : "作物") + "×1" };
}
}
return { ok: false, text: actText(act) };
}
function actText(act) {
return {
till: "没有可开垦的生土了", water: "没有干着的耕地", sow: "没有空耕地可播种",
feed: "没有可施肥的作物", harvest: "还没有成熟的作物"
}[act] || "这里暂时没什么可做的";
}
function farmTick() {
if (!farm) return;
var dirty = false;
farm.plots.forEach(function (p) {
if (!p.crop || p.progress >= 1) return;
if (!p.watered) return;
var cd = cropDef(p.crop);
p.progress = Math.min(1, p.progress + 1 / ((cd ? cd.growMin : 100) * (p.fed ? FARM.FERTILIZER_BOOST : 1)) * 3);
p.stage = Math.min((cd ? cd.stages : 3) - 1, Math.floor(p.progress * (cd ? cd.stages : 3)));
dirty = true;
});
if (dirty) { farmSave(); drawFarm(); }
}
function farmSummary() {
if (!farm) farmLoad();
var tilled = 0, growing = 0, ready = 0;
farm.plots.forEach(function (p) {
if (p.soil) tilled++;
if (p.crop) growing++;
if (p.crop && p.progress >= 1) ready++;
});
return { tilled: tilled, growing: growing, ready: ready, seeds: farm.inv.seeds, crops: farm.inv.crops, feed: farm.inv.feed, fish: farm.fish };
}
var POND = { x0: 35.2, y0: 22.2, x1: 38.2, y1: 26.2, cx: 36.7 * TILE, cy: WALL_H + 24.2 * TILE };
var fishShadows = [];      // 水面鱼影 { spr, vx, phase }
var fishing = null;        // { wait, bite, t, excl } 钓鱼小游戏状态
function pondTileFree(tx, ty) {   // 塘面格 → 阻挡（画水不画地，A* 天然绕开）
return tx >= Math.floor(POND.x0) && tx <= Math.ceil(POND.x1) - 1 &&
ty >= Math.floor(POND.y0) && ty <= Math.ceil(POND.y1) - 1;
}
function buildPondGfx(s) {
rebuildRoomBase();
}
function buildPondLife(s) {
if (!s || !s.mapdata) return;
clearPondLife();
for (var i = 0; i < 4; i++) {
var sh = s.add.ellipse(0, 0, 26, 10, 0x2a4a6e, 0.55).setDepth(3);
var shd = { spr: sh, vx: (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.35), phase: Math.random() * 6.28 };
respawnShadow(shd);
fishShadows.push(shd);
}
}
function respawnShadow(d) {
var mx = POND.x0 * TILE + 24, Mx = POND.x1 * TILE - 24;
var my = WALL_H + POND.y0 * TILE + 20, My = WALL_H + POND.y1 * TILE - 20;
d.spr.x = mx + Math.random() * (Mx - mx);
d.spr.y = my + Math.random() * (My - my);
d.spr.alpha = 0.35 + Math.random() * 0.3;
}
function clearPondLife() {
fishShadows.forEach(function (d) { if (d.spr) d.spr.destroy(); });
fishShadows.length = 0;
}
function tickPondLife() {
var mx = POND.x0 * TILE + 24, Mx = POND.x1 * TILE - 24;
fishShadows.forEach(function (d) {
d.spr.x += d.vx;
d.spr.y += Math.sin((d.phase += 0.02)) * 0.15;
if (d.spr.x < mx || d.spr.x > Mx) { d.vx *= -1; respawnShadow(d); }
if (fishing && fishing.bite) {   // 咬钩瞬间：鱼影游向浮标
d.spr.x += (fishing.bx - d.spr.x) * 0.05;
d.spr.y += (fishing.by - d.spr.y) * 0.05;
}
});
}
function fishStart() {
if (fishing) return { ok: false, text: "已经在钓鱼了，等浮标下沉再点一次起竿" };
fishing = {
t: 0, wait: 2 + Math.random() * 3, bite: false, biteLeft: 0,
bx: POND.cx + (Math.random() * 60 - 30), by: POND.cy + (Math.random() * 40 - 20),
bobber: null, excl: null
};
fishing.bobber = scene.add.circle(fishing.bx, fishing.by, 4, 0xff6b6b).setStrokeStyle(2, 0xffffff, 0.9).setDepth(4);
return { ok: true, text: "抛竿了…盯着浮标！" };
}
function fishTick(dt) {
if (!fishing) return;
fishing.t += dt;
if (fishing.bobber) fishing.bobber.y = fishing.by + Math.sin(fishing.t * 3) * 1.4;   // 浮标轻漂
if (!fishing.bite && fishing.t >= fishing.wait) {
fishing.bite = true; fishing.biteLeft = 1.1;
fishing.excl = scene.add.text(fishing.bx, fishing.by - 26, "！", {
fontFamily: "PingFang SC, Microsoft YaHei, sans-serif", fontSize: "26px",
color: "#ffd43b", fontStyle: "bold", stroke: "#151826", strokeThickness: 5
}).setOrigin(0.5).setDepth(95000);
scene.tweens.add({ targets: fishing.excl, scale: 1.25, yoyo: true, repeat: -1, duration: 160 });
}
if (fishing.bite) {
fishing.biteLeft -= dt;
if (fishing.biteLeft <= 0) fishAbort("鱼跑掉了…下次要更快！");
}
}
function fishReel() {
if (!fishing) return { ok: false, text: "先在鱼塘边点「钓鱼」抛竿" };
if (!fishing.bite) { fishAbort("太心急了，鱼还没咬钩…"); return { ok: false, text: "太心急了，鱼还没咬钩" }; }
if (fishing.excl) { fishing.excl.destroy(); }
if (fishing.bobber) { fishing.bobber.destroy(); }
var roll = Math.random(), got;
if (roll < 0.78) { got = "鲜鱼"; farm.fish++; }
else if (roll < 0.93) { got = "肥料"; farm.inv.feed++; }
else { got = "河童的旧怀表"; farm.inv.feed += 2; }
farmSave();
fishing = null;
postStatDelta({ mood: 5, hunger: 1 });
renderStatsBar();
return { ok: true, text: "钓到了" + got + "！" };
}
function fishAbort(msg) {
if (fishing && fishing.excl) fishing.excl.destroy();
if (fishing && fishing.bobber) fishing.bobber.destroy();
fishing = null;
if (msg && bubbleText === null) showBubble(msg, "idle");
}
var RECIPES = [
{ id: "bread",   name: "烤面包",     need: { wheat: 2 },                     stat: { hunger: 22, mood: 3 },  verb: "揉面、进炉，烤得金黄" },
{ id: "salad",   name: "田园沙拉",   need: { tomato: 1, cabbage: 1 },        stat: { hunger: 16, mood: 6 },  verb: "把今天的菜洗干净拌好" },
{ id: "soup",    name: "蔬菜浓汤",   need: { carrot: 1, cabbage: 1 },        stat: { hunger: 20, mood: 4 },  verb: "小火咕嘟了半天" },
{ id: "fishgrill", name: "盐烤鲜鱼", need: { fish: 1, wheat: 1 },            stat: { hunger: 30, mood: 6 },  verb: "炭火滋滋作响，香气扑鼻" },
{ id: "sushi",   name: "鱼寿司",     need: { fish: 1, wheat: 2 },            stat: { hunger: 34, mood: 8 },  verb: "刀工利落，米粒紧实" },
{ id: "popcorn", name: "爆米花",     need: { corn: 2 },                      stat: { hunger: 10, mood: 8 },  verb: "噼里啪啦，满锅都是响声" },
{ id: "juice",   name: "番茄汁",     need: { tomato: 2 },                    stat: { hunger: 8, mood: 7 },   verb: "榨出一杯鲜红的晨光" },
{ id: "stew",    name: "大杂烩",     need: { fish: 1, tomato: 1, carrot: 1 },stat: { hunger: 38, mood: 5 },  verb: "有什么就扔什么，意外地好喝" }
];
function pantryCount(id) {
if (!farm) farmLoad();
if (id === "fish") return farm.fish || 0;
return farm.inv.crops[id] || 0;
}
function pantryUse(id, n) {
if (id === "fish") farm.fish = Math.max(0, farm.fish - n);
else farm.inv.crops[id] = Math.max(0, (farm.inv.crops[id] || 0) - n);
farmSave();
}
function cookable() {
return RECIPES.map(function (r) {
var ok = true, missing = [];
Object.keys(r.need).forEach(function (k) {
if (pantryCount(k) < r.need[k]) { ok = false; missing.push(k); }
});
return { id: r.id, ok: ok, missing: missing };
});
}
function cook(recipeId) {
var r = null;
for (var i = 0; i < RECIPES.length; i++) if (RECIPES[i].id === recipeId) r = RECIPES[i];
if (!r) return { ok: false, text: "没有这道菜" };
var can = cookable().filter(function (c) { return c.id === recipeId; })[0];
if (!can.ok) return { ok: false, text: "食材不够：" + can.missing.join("、") };
Object.keys(r.need).forEach(function (k) { pantryUse(k, r.need[k]); });
postStatDelta(r.stat);
onStatsDeltaLocal(r.stat);
renderStatsBar();
return { ok: true, text: "做好了「" + r.name + "」：" + r.verb };
}
function onStatsDeltaLocal(d) {
Object.keys(d || {}).forEach(function (k) {
if (typeof stats[k] === "number") stats[k] = Math.max(0, Math.min(100, stats[k] + d[k]));
});
}
function kitchenSummary() {
return {
pantry: { fish: farm ? farm.fish : 0, crops: farm ? farm.inv.crops : {}, seeds: farm ? farm.inv.seeds : {}, feed: farm ? farm.inv.feed : 0 },
recipes: cookable().map(function (c, i) { return { id: c.id, name: RECIPES[i].name, ok: c.ok, missing: c.missing }; })
};
}
function cookAuto() {
var canDo = cookable().filter(function (c) { return c.ok; });
if (!canDo.length) return "";
canDo.sort(function (a, b) {
var ra = RECIPES.filter(function (r) { return r.id === a.id; })[0], rb = RECIPES.filter(function (r) { return r.id === b.id; })[0];
return (rb ? rb.stat.hunger : 0) - (ra ? ra.stat.hunger : 0);
});
var pick = RECIPES.filter(function (r) { return r.id === canDo[0].id; })[0];
var res = cook(pick.id);
return res.ok ? res.text : "";
}
var cookPanelEl = null;
function renderCookPanel() {
var host = document.getElementById("office-parent");
if (!host) return;
if (!cookPanelEl) {
cookPanelEl = document.createElement("div");
cookPanelEl.id = "cook-panel";
cookPanelEl.style.cssText = "position:absolute;z-index:41;left:14px;top:52px;width:250px;border-radius:10px;" +
"background:#1d2130f5;border:1px solid #ffffff33;color:#ece8df;overflow:hidden;display:none;box-shadow:0 6px 20px #0008;";
cookPanelEl.innerHTML =
'<div style="display:flex;align-items:center;gap:6px;padding:6px 10px;font-size:12px;background:#2a2e3d;border-bottom:1px solid #ffffff22;">' +
'<span>🍳</span><span style="font-weight:700" id="ck-title">料理台</span>' +
'<button id="ck-close" type="button" style="margin-left:auto;border:0;background:transparent;color:#9aa3b8;cursor:pointer;font-size:14px;line-height:1">×</button></div>' +
'<div id="ck-body" style="padding:8px 12px;font-size:12px;line-height:1.7"></div>';
host.appendChild(cookPanelEl);
cookPanelEl.querySelector("#ck-close").onclick = hideCookPanel;
}
var s = kitchenSummary();
var row = function (n, ok, note) {
return '<div style="padding:2px 0;border-bottom:1px dashed #ffffff12;display:flex;gap:6px">' +
'<span style="flex:none">' + (ok ? "✅" : "⬜") + "</span><span style=\"flex:none;font-weight:600\">" + n + "</span>" +
'<span style="color:#9aa3b8;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + note + "</span></div>";
};
var html = '<div style="color:#8ce99a;margin-bottom:4px">🐟 鲜鱼×' + (s.pantry.fish || 0) + " · 肥料×" + (s.pantry.feed || 0) + "</div>";
var cropNames = { wheat: "小麦", tomato: "番茄", carrot: "胡萝卜", corn: "玉米", cabbage: "卷心菜" };
Object.keys(s.pantry.crops).forEach(function (k) {
if (s.pantry.crops[k] > 0) html += '<div style="color:#c3c9d9">' + (cropNames[k] || k) + "×" + s.pantry.crops[k] + "</div>";
});
html += '<div style="margin-top:6px;color:#ffd43b;font-weight:700">今日菜谱</div>';
s.recipes.forEach(function (r) {
html += row(r.name, r.ok, r.ok ? "可以做" : "缺 " + (r.missing || []).join("、"));
});
var body = cookPanelEl.querySelector("#ck-body");
body.innerHTML = html;
cookPanelEl.style.display = "block";
}
function hideCookPanel() {
if (cookPanelEl) cookPanelEl.style.display = "none";
}
var farmGfx = null, farmCropGfx = null;
function drawFarm() {
if (!scene || !scene.mapdata) return;
if (farmGfx) { farmGfx.destroy(); farmGfx = null; }
if (farmCropGfx) { farmCropGfx.destroy(); farmCropGfx = null; }
if (!farm) farmLoad();
var g = scene.add.graphics().setDepth(2);
var gc = scene.add.graphics().setDepth(3);
farm.plots.forEach(function (p, i) {
var t = plotTile(i);
var px = t.x * TILE, py = WALL_H + t.y * TILE;
if (p.soil) {
if (p.watered) { g.fillStyle(0x3a5a8a, 0.35); g.fillRect(px + 3, py + 3, TILE - 6, TILE - 6); }
if (p.fed) {
g.fillStyle(0x2e5c34, 0.5); g.fillRect(px + 3, py + 3, 6, 6);
}
}
if (p.crop) {
var cd = cropDef(p.crop);
var color = cd.color;
if (p.progress >= 1) {   // 成熟：顶一颗亮果
gc.fillStyle(color, 1);
gc.fillCircle(px + TILE / 2, py + TILE / 2 - 8, 6);
gc.fillStyle(0x4a7a3a, 1);
gc.fillRect(px + TILE / 2 - 2, py + TILE / 2 - 4, 4, 10);
} else {                 // 幼苗/生长中：苗 + 大小按 stage
var r = 3 + p.stage * 2.4;
gc.fillStyle(0x5a9a4a, 1);
gc.fillCircle(px + TILE / 2, py + TILE / 2 - 2, r);
}
}
});
farmGfx = g; farmCropGfx = gc;
}
function isNightHour() {   // 北京时间 18:00-6:00 = 夜（窗外昼夜按真实时间，与灯开关解耦——评审 v31 用户反馈）
if (forceNight !== null && forceNight !== undefined) return !!forceNight;   // 编辑器里的昼夜预览
var bj = new Date(Date.now() + 8 * 3600 * 1000).getUTCHours();
return bj >= 18 || bj < 6;
}
var today = new Date().toISOString().slice(0, 10);
var evidence = { done: 0, current: "", lastTask: "", lastMood: "" };
try {
var saved = JSON.parse(localStorage.getItem("office_evidence") || "{}");
if (saved.day === today) evidence.done = saved.done || 0;
} catch (e) {}
function saveEvidence() {
try { localStorage.setItem("office_evidence", JSON.stringify({ day: today, done: evidence.done })); } catch (e) {}
}
function updateEvidence(cfg, taskText, detail) {
if (!scene) return;
evidence.current = taskText;
if (cfg.mood !== "sleeping" && evidence.current && evidence.current !== evidence.lastTask) {
if (evidence.lastTask && evidence.lastMood && evidence.lastMood !== "sleeping") { evidence.done++; saveEvidence(); }
evidence.lastTask = evidence.current;
evidence.lastMood = cfg.mood;
}
redrawBoard();
refreshTrophies();
}
function redrawBoard() {
if (!scene || !scene.mapdata) return;
if (scene.boardText) { scene.boardText.destroy(); scene.boardText = null; }
var b = scene.mapdata.zones.board || { anchor: [15.2, 1.0] };
var bx = b.anchor[0] * TILE, by = WALL_H + b.anchor[1] * TILE;
var lines = [
"今日完成 " + evidence.done + " 件",
(evidence.current || "待命中").slice(0, 12)
];
var k = uiK();
var t = scene.add.text(bx, by, lines.join("\n"), {
fontFamily: "monospace", fontSize: uiFont(14) + "px", color: "#f4f1ea",
backgroundColor: "#3a2f26ee",
padding: { x: Math.round(8 * k), y: Math.round(4 * k) },
align: "center", lineSpacing: Math.round(4 * k)
}).setOrigin(0.5, 0.5).setDepth(9000);   // 高于所有家具 footY，否则任务卡会被黑板/书架盖住
scene.boardText = t;
}
function refreshTrophies() {
if (!scene || !scene.trophyLayer) return;
scene.trophyLayer.removeAll(true);
var n = Math.min(evidence.done, 6);
for (var i = 0; i < n; i++) {
var tx = 20.15 * TILE + i * 15;
var ty = WALL_H + 2.6 * TILE;
scene.trophyLayer.add(scene.add.image(tx, ty, "trophy-cup", 0).setScale(0.4).setOrigin(0.5, 1));
}
}
function canvasScale() {
var c = document.querySelector("#office-parent canvas");
if (!c) return 1;
var r = c.getBoundingClientRect();
return r.width > 0 ? Math.max(0.2, Math.min(1, r.width / c.width)) : 1;
}
function uiK() { return 1 / canvasScale(); }              // 1 CSS px = 多少世界 px
function uiFont(cssPx) { return Math.round(cssPx * uiK()); }
var lastBubble = null, textResizeTimer = null;
function refreshCanvasText() {
if (bubble && lastBubble) { var lb = lastBubble; showBubble(lb.text, lb.mood); }
if (scene && scene.mapdata) redrawBoard();
}
window.addEventListener("resize", function () {
if (game && game.scale) game.scale.refresh();
clearTimeout(textResizeTimer);
textResizeTimer = setTimeout(refreshCanvasText, 160);
});
setTimeout(refreshCanvasText, 400);   // 首屏 canvas 完成布局后按真实缩放比重绘任务板
var bubbleOff = { x: 0, y: -46 };
function calcBubbleOff() {
if (!fish || fish.lastFace !== "n") return { x: 0, y: fish && fish.sitting ? -62 : -46 };
var sx = scene ? fish.x - scene.cameras.main.scrollX : fish.x;
var side = sx > 980 ? -46 : 46;
return { x: side, y: fish.sitting ? -58 : -52 };
}
function showBubble(text, mood) {
if (typeof editorMode !== "undefined" && editorMode) return;   // v48：编辑页不弹气泡
if (!scene || !fish) return;
hideBubble();
var k = uiK();
var txt = text.length > 20 ? text.slice(0, 19) + "…" : text;
bubbleText = scene.add.text(0, 0, txt, {
fontFamily: "PingFang SC, Microsoft YaHei, sans-serif",
fontSize: uiFont(13) + "px", color: "#151826", align: "center",
wordWrap: { width: Math.round(200 * k) }
}).setOrigin(0.5, 1);
var bw = Math.max(60 * k, bubbleText.width + 24 * k), bh = bubbleText.height + 16 * k;
var bg = scene.add.graphics();
bg.fillStyle(0xfffdf8, 0.96);
bg.fillRoundedRect(-bw / 2, -bh, bw, bh, 7 * k);
bg.lineStyle(Math.max(1, 1.5 * k), mood === "error" ? 0xe03131 : 0x8a97ad, 1);
bg.strokeRoundedRect(-bw / 2, -bh, bw, bh, 7 * k);
bg.fillStyle(0xfffdf8, 0.96);
bubbleOff = calcBubbleOff();
var triX = 0;
if (bubbleOff.x) {
var t = Math.min(Math.abs(bubbleOff.x), bw / 2 - 16 * k);
triX = bubbleOff.x > 0 ? -t : t;   // 气泡在右 → 三角靠左；反之靠右
}
bg.fillTriangle(triX - 6 * k, -1 * k, triX + 6 * k, -1 * k, triX, 8 * k);
bubble = scene.add.container(fish.x + bubbleOff.x, fish.y + bubbleOff.y, [bg, bubbleText]);
bubbleText.setPosition(0, -8 * k);
bubble.setDepth(90000);
bubble.setScale(0.6);
scene.tweens.add({ targets: bubble, scale: 1, duration: 180, ease: "Back.Out" });
lastBubble = { text: text, mood: mood };
}
function hideBubble() {
if (bubble) { bubble.destroy(); bubble = null; }
if (bubbleText) { bubbleText.destroy(); bubbleText = null; }
lastBubble = null;
}
function playFx(fx) {
stopFx();
if (!fx) return;
var fxDefs = {
pc:      { host: "pc",      tex: "computer",     fpsKey: "anim" },
printer: { host: "printer", tex: "printer",      fpsKey: "anim" },
chair:   { host: "chair",   tex: "office-chair", fpsKey: null }
};
var def = fxDefs[fx];
if (!def || !scene.fxDirect[def.host]) return;
var d = scene.fxDirect[def.host];
if (!d.m.anim || !(d.m.rows && d.m.rows.East > 1)) return;
var key = "fx_" + fx;
if (!scene.anims.exists(key)) {
var frames = [];
for (var i = 0; i < d.m.rows.East; i++) frames.push({ key: def.tex, frame: i });
scene.anims.create({
key: key, frames: frames,
frameRate: fx === "chair" ? 10 : d.m.anim.fps,
repeat: fx === "chair" ? 0 : -1
});
}
d.spr.play(key);
}
function stopFx() {
["pc", "printer", "chair"].forEach(function (k) {
var d = scene.fxDirect && scene.fxDirect[k];
if (d && d.spr.anims) {
d.spr.anims.stop();
var f0 = (d.f && d.f.frame) || 0;
d.spr.setFrame(f0);
}
});
}
function onState(st, zoneOverride, force) {
if (!scene || !fish) return;
var rawState = String(st.state || "");
var cfg = STATE_MAP[rawState] || STATE_MAP.idle;
var taskText = st.task || cfg.verb;
lastServerTs = st.ts || Date.now();
actCur = { state: rawState, task: taskText, at: Number(st.ts) || Date.now() };   // 最近动态窗据此解释「为什么现在是这样」
if (rawState === "writing") writerFeed(taskText, st.detail || "");   // 打字机：去抖也要喂（每行 detail 不同）
if (!force && !zoneOverride && lastEventState === rawState && lastEventTask === taskText) {
updateStatusbar(rawState, taskText, st.detail || "");
renderPlan();
return;
}
lastEventState = rawState;
lastEventTask = taskText;
if ((fishState === "walking" || fishState === "acting") && curPlan && !curPlan.stInterrupted) {
showBubble("！", "error");
if (curPlan) curPlan.stInterrupted = true;
}
stopIdleLife();
updateStatusbar(rawState, taskText, st.detail || "");
lightsManual = false;
var h = bjHour();
if (cfg.mood === "sleeping") {
roomLights.office = false; roomLights.kitchen = false; roomLights.bath = false;
roomLights.bedroom = (h >= 18 || h < 23);   // 睡前开卧室灯，深夜全关
} else {
roomLights.office = true; roomLights.kitchen = (h >= 6 && h < 10) || (h >= 17 && h < 21);
roomLights.bath = false;                     // 清醒时段卫浴默认关（washing 状态时临时开）
roomLights.bedroom = false;
}
applyRoomLights(scene);
unsit();   // 起身：同时取消未走完的坐席 tween，避免新状态把鱼又拉回沙发
fish.setBadge(cfg.mood === "error" ? "#e03131" :
cfg.mood === "sleeping" ? "#4c6ef5" :
cfg.mood === "idle" ? "#f59f00" : "#2f9e44");
var zone = (zoneOverride && scene.mapdata.zones[zoneOverride]) || scene.mapdata.zones[cfg.zone];
if (!zone) {   // 状态表引用了不存在的区域时不再让整个 onState 崩掉
console.warn("[office] 状态 " + st.state + " 的区域 " + cfg.zone + " 不存在，回退到 sofa");
zone = scene.mapdata.zones.sofa;
}
var ex = Math.round(zone.anchor[0]), ey = Math.round(zone.anchor[1]);
var path = astar(px2tx(fish.x), px2ty(fish.y), ex, ey);
if (!path) path = [{ x: ex, y: ey }];
curPlan = { path: path, cfg: cfg, task: taskText, st: st, i: 0, local: false, face: zone.face || "s", zone: zone };
fishState = "walking";
var cam = scene.cameras.main;
if (editMode) {
cam.stopFollow();
} else if (visitingHome) {
visitSitCount = 0;   // 真实事件优先，鱼随时可以被带走
} else {
cam.stopFollow();
var zx = zone.anchor[0] * TILE, zy = WALL_H + zone.anchor[1] * TILE;
cam.pan(Phaser.Math.Clamp(zx, 624, W - 624), Phaser.Math.Clamp(zy - 96, 384, H - 384), 600);
cam.once("camerapancomplete", function () {
scene.time.delayedCall(1800, function () {
if (!visitingHome) cam.startFollow(fish, true, 0.08, 0.08);   // 无条件兜底：pan 被新事件打断也能恢复跟随
});
});
}
updateEvidence(cfg, taskText, st.detail || "");
if (cfg.mood === "working" || cfg.mood === "error") playFx(cfg.fx);
else stopFx();
if (cfg.mood === "idle") {
setTimeout(function () {
if (fishState === "acting" && curPlan && curPlan.cfg === cfg) {
fishState = "idle";
stopFx();
startIdleLife(800);
}
}, 6000);
}
}
function stepWalk() {
if (!curPlan) { fishState = "idle"; return; }
var p = curPlan.path;
if (curPlan.i >= p.length) { arriveAct(); return; }
var node = p[curPlan.i];
var targetX = node.x * TILE + TILE / 2;
var targetY = WALL_H + node.y * TILE + TILE / 2;
var dx = targetX - fish.x, dy = targetY - fish.y;
var dist = Math.sqrt(dx * dx + dy * dy);
if (dist < 3) { curPlan.i++; return; }
var speed = (p.length - curPlan.i) > 14 ? 4.0 : 2.2;
if (Math.abs(dx) > Math.abs(dy)) fish.face(dx > 0 ? "e" : "w");
else fish.face(dy > 0 ? "s" : "n");
fish.x += (dx / dist) * speed;
fish.y += (dy / dist) * speed;
}
function applySit(zone) {
var sit = zone && zone.sit;
if (!sit || !scene || !scene.hostMap || !scene.hostMap[sit.host]) return false;
var h = scene.hostMap[sit.host];
var tx = h.x + (sit.dx || 0), ty = h.y + (sit.dy || 0);  // dy 负值 = 坐进坐垫
var dist = Math.sqrt(Math.pow(tx - fish.x, 2) + Math.pow(ty - fish.y, 2));
scene.tweens.killTweensOf(fish);
scene.tweens.add({ targets: fish, x: tx, y: ty,
duration: Math.min(700, 220 + dist * 1.5), ease: "Sine.InOut" });   // 距离越远滑得越久，不再瞬移
fish.setScale(sit.lounge ? 0.86 : 0.8);
fish.setDepth(h.footY + 2);   // 画在家具之上；depthSort 坐席期间不覆盖
fish.sitting = true;
fish.lounge = !!sit.lounge;   // 沙发/床 = 真的躺下，工位椅子只是坐直
if (fish.badge) fish.badge.setPosition(fish.lounge ? 20 : 0, fish.lounge ? -14 : -30);
fish.face(sit.face || (fish.lounge ? "s" : (zone && zone.face) || "s"));
fish.still();
return true;
}
function unsit() {
if (!fish || !fish.sitting) { if (fish) fish.lounge = false; return; }
if (scene) scene.tweens.killTweensOf(fish);
fish.sitting = false;
fish.lounge = false;
fish.setScale(0.95);
fish.setDepth(fish.y);
if (fish.badge) fish.badge.setPosition(0, -46);
if (fish.bodySpr) {
fish.bodySpr.setAngle(0);
fish.bodySpr.setScale(1);
fish.bodySpr.setPosition(fish.bodySpr.x, fish.baseY);
}
}
function setLoungePose() {
var b = fish.bodySpr;
b.setAngle(0);
b.setScale(1);
b.setPosition(b.x, fish.baseY);
fish.playAct("lounge");
}
function arriveAct() {
if (!curPlan) { fishState = "idle"; return; }
if (curPlan.local) { arriveLocal(); return; }
fishState = "acting";
fish.face(curPlan.face || "s");
applySit(curPlan.zone);
startActAnim(curPlan.cfg.act);
showBubble(curPlan.task, curPlan.cfg.mood);
}
function startActAnim(act) {
stopActAnim();
if (fish.lounge) {
setLoungePose();
if (act === "sleep" || act === "rest" || act === "idle" || act === "lounge") {
actTickTimer = scene.time.addEvent({
delay: 1500, loop: true, callback: function () {
if (Math.random() < 0.7) spawnZzz();
}
});
}
return;
}
if (!fish.playAct(actRow(act))) fish.still();   // 老版精灵表没有动作行时优雅降级
if (act === "listen") {
actTickTimer = scene.time.addEvent({
delay: 500, loop: true, callback: function () {
var nk = uiK();
var note = scene.add.text(fish.x + (Math.random() * 30 - 15) * nk, fish.y - 44 * nk, "♪",
{ fontSize: uiFont(14) + "px", color: "#4a6cf7" }).setDepth(9000);
scene.tweens.add({ targets: note, y: note.y - 24 * nk, alpha: 0, duration: 1100, onComplete: function () { note.destroy(); } });
}
});
} else if (act === "sleep" || act === "rest") {
actTickTimer = scene.time.addEvent({
delay: 1400, loop: true, callback: function () {
if (Math.random() < 0.8) spawnZzz();
}
});
}
}
function stopActAnim() {
if (actTickTimer) { actTickTimer.remove(); actTickTimer = null; }
scene.tweens.killTweensOf(fish.bodySpr);
if (fish && fish.bodySpr) {
fish.bodySpr.setPosition(
MAN.whale.frameW / 2 - (MAN.whale.bbox[0] + MAN.whale.bbox[2] / 2),
fish.baseY
);
fish.bodySpr.setAngle(0);
fish.bodySpr.setScale(1);
fish.still();     // 停掉上一组动作帧，回到当前朝向的站立首帧
}
}
function spawnZzz() {
var k = uiK();
var z = scene.add.text(fish.x + 18 * k, fish.y - 40 * k, "z", {
fontSize: uiFont(15) + "px", color: "#aab4c8", fontStyle: "bold"
}).setDepth(90000);
scene.tweens.add({ targets: z, y: z.y - 36 * k, x: z.x + 10 * k, alpha: 0, duration: 2600, ease: "Sine.Out",
onComplete: function () { z.destroy(); } });
}
var EVENT_NEED = {
tea:      { need: "hunger",  label: "解渴" },
dining:   { need: "hunger",  label: "加餐" },
cook:     { need: "hunger",  label: "做饭" },
fridge:   { need: "hunger",  label: "零食" },
market:   { need: "hunger",  label: "采买" },
cookmeal: { need: "hunger",  label: "料理" },
farm:     { need: "hunger",  label: "种地" },
fishing:  { need: "hunger",  label: "钓鱼" },
relax:    { need: "mood",    label: "窝着" },
arcade:   { need: "mood",    label: "玩乐" },
garden:   { need: "mood",    label: "赏花" },
stroll:   { need: "mood",    label: "歇脚" },
window:   { need: "mood",    label: "看月亮" },
sofa:     { need: "energy",  label: "小憩" },
bed:      { need: "energy",  label: "打盹" },
recover:  { need: "energy",  label: "回血" },
dizzy:    { need: "energy",  label: "迷糊" },
door:     { need: "social",  label: "打招呼" },
mail:     { need: "social",  label: "看信" },
washup:   { need: "hygiene", label: "洗脸" },
mirror:   { need: "hygiene", label: "整容" },
townbench:{ need: "mood",    label: "歇脚" }
};
function needBoost(need, v) {
if (v == null) return 1;
if (v >= 88) return 0.05;          // 饱和：饱食 100 还吃点心（用户抓包）→ 几乎不选
if (v >= 75) return 0.3;           // 很满足
if (v >= 65) return 0.75;
if (v >= 40) return 1.0;
if (v >= 25) return 2.2;
if (v >= 15) return 3.5;
return 5.0;                         // 急需
}
var stats = { hunger: 70, mood: 65, energy: 80, social: 55, hygiene: 75, ts: 0 };  // hub 推过来后覆盖
var lastStats = null;   // 上一帧数值（检测变化方向，浮字用）
function onStats(s) {
if (!s) return;
var changed = [];
["hunger", "mood", "energy", "social", "hygiene"].forEach(function (k) {
if (typeof s[k] !== "number") return;
var v = s[k];
if (lastStats && typeof lastStats[k] === "number" && v !== lastStats[k]) {
changed.push({ key: k, from: lastStats[k], to: v, delta: v - lastStats[k] });
}
stats[k] = v;
});
stats.ts = s.ts || Date.now();
renderStatsBar();
if (changed.length && lastStats) changed.forEach(showStatDelta);
lastStats = JSON.parse(JSON.stringify(stats));
}
function showStatDelta(c) {
var cell = document.querySelector('.stat-cell[data-key="' + c.key + '"]');
if (!cell) return;
var meta = STAT_META.filter(function (m) { return m.key === c.key; })[0];
var f = document.createElement("span");
f.className = "stat-delta " + (c.delta > 0 ? "up" : "down");
f.textContent = (c.delta > 0 ? "+" : "") + c.delta;
cell.appendChild(f);
setTimeout(function () { f.remove(); }, 1800);
cell.classList.add("bump");
setTimeout(function () { cell.classList.remove("bump"); }, 1200);
}
var LOCAL_EVENTS = [
{ key: "tea",      zone: "tea",      label: "接水",   icon: "🥤", text: "去接杯水喝",       act: "idle_sip",   face: "n", w: 1.2, room: "office" },
{ key: "window",   zone: "window",   label: "看窗景", icon: "🌙", text: "趴窗台看看月亮",   textDay: "趴窗台晒晒太阳", textNight: "趴窗台看看月亮", act: "idle_look",  face: "n", w: 1.0, room: "office" },
{ key: "library",  zone: "library",  label: "翻书",   icon: "📖", text: "随手翻翻书",       act: "idle_read",  face: "n", w: 1.1, room: "office" },
{ key: "sofa",     zone: "sofa",     label: "瘫沙发", icon: "🛋", text: "瘫在沙发上",       act: "idle_rest",  face: "s", w: 1.3, room: "office" },
{ key: "desk",     zone: "desk",     label: "敲键盘", icon: "⌨", text: "回工位敲两行字",   act: "idle_type",  face: "n", w: 1.1, room: "office" },
{ key: "printer",  zone: "printer",  label: "取纸",   icon: "🖨", text: "去取打印好的纸",   act: "idle_reach", face: "n", w: 0.8, room: "office" },
{ key: "mail",     zone: "mail",     label: "看信箱", icon: "✉", text: "翻翻信箱",         act: "idle_reach", face: "n", w: 0.8, room: "office" },
{ key: "board",    zone: "board",    label: "任务板", icon: "📋", text: "盯着任务板发呆",   act: "idle_think", face: "s", w: 0.9, room: "office" },
{ key: "screen",   zone: "screen",   label: "想点子", icon: "💡", text: "对着白板想点子",   act: "idle_think", face: "n", w: 0.8, room: "office" },
{ key: "tools",    zone: "tools",    label: "工具书", icon: "📚", text: "翻两页工具书",     act: "idle_read",  face: "n", w: 0.7, room: "office" },
{ key: "dining",   zone: "dining",   label: "吃点心", icon: "🍰", text: "在餐桌吃点点心",   act: "idle_eat",   face: "n", w: 0.9, room: "office" },
{ key: "cook",     zone: "cook",     label: "下厨",   icon: "🍳", text: "下厨煮点东西",     act: "idle_eat",   face: "n", w: 0.8, room: "office" },
{ key: "fridge",   zone: "fridge",   label: "翻冰箱", icon: "🧊", text: "开冰箱找零食",     act: "idle_reach", face: "n", w: 0.9, room: "office" },
{ key: "door",     zone: "door",     label: "看门外", icon: "🚪", text: "到门口看看外面",   act: "idle_think", face: "n", w: 0.7, room: "office" },
{ key: "balcony",  zone: "balcony",  label: "伸懒腰", icon: "🌤", text: "到阳台伸个懒腰",   act: "idle_cheer", face: "n", w: 0.8, room: "office" },
{ key: "dizzy",    zone: "tools",    label: "犯迷糊", icon: "💫", text: "忽然有点犯迷糊",   act: "idle_dizzy", face: "s", w: 0.5, room: "office" },
{ key: "relax",    zone: "relax",    label: "扶手椅", icon: "🪑", text: "窝进扶手椅",       act: "idle_rest",  face: "s", w: 0.9, room: "bedroom" },
{ key: "arcade",   zone: "arcade",   label: "打街机", icon: "🕹", text: "打两把街机",       act: "idle_play",  face: "n", w: 0.8, room: "bedroom" },
{ key: "bed",      zone: "bed",      label: "赖床",   icon: "🛏", text: "赖在床上打个盹",   act: "idle_nap",   face: "s", w: 0.9, room: "bedroom" },
{ key: "wardrobe", zone: "wardrobe", label: "挑衣服", icon: "👗", text: "挑今天穿什么",     act: "idle_think", face: "n", w: 0.7, room: "bedroom" },
{ key: "washup",   zone: "washup",   label: "洗脸",   icon: "🧼", text: "洗把脸清醒一下",   act: "idle_reach", face: "n", w: 0.8, room: "bedroom" },
{ key: "mirror",   zone: "washup",   label: "照镜子", icon: "🪞", text: "对着镜子发会儿呆", act: "idle_think", face: "n", w: 0.6, room: "bedroom" },
{ key: "recover",  zone: "recover",  label: "回血",   icon: "🔋", text: "蹲充电垫上回血",   act: "idle_nap",   face: "n", w: 0.7, room: "bedroom" },
{ key: "garden",   zone: "garden",   label: "看花",   icon: "🌷", text: "去花园看看花",     act: "idle_cheer", face: "n", w: 0.7, room: "garden" },
{ key: "stroll",   zone: "stroll",   label: "坐长椅", icon: "🌳", text: "在长椅上坐一会儿", act: "idle_sit",   face: "s", w: 0.7, room: "garden" },
{ key: "market",   zone: "market",   label: "逛摊位", icon: "🍎", text: "逛逛水果摊",       act: "idle_reach", face: "n", w: 0.6, room: "garden" },
{ key: "farm",     zone: "farm",     label: "巡农田", icon: "🌾", text: "去田里转一圈，看看庄稼", act: "idle_farm", face: "n", w: 0.9, room: "garden" },
{ key: "fishing",  zone: "pond",     label: "钓鱼",   icon: "🎣", text: "去鱼塘边钓会儿鱼", act: "idle_reach", face: "e", w: 0.7, room: "garden" },
{ key: "cookmeal", zone: "kitchenprep", label: "做料理", icon: "🍳", text: "进厨房琢磨做点什么吃的", act: "idle_eat", face: "n", w: 0.8, room: "office" },
{ key: "townwell", zone: "town",     label: "井边站站", icon: "💭", text: "在井边发会儿呆",   act: "idle_think", face: "s", w: 0.8, room: "town" },
{ key: "townbench",zone: "town_bench",label: "街边长椅", icon: "🪑", text: "在街边长椅坐坐",  act: "idle_sit",   face: "n", w: 0.7, room: "town" }
];
(function () {
var outdoor = ["garden", "stroll", "market", "balcony"], quiet = ["window", "tea", "library", "mirror", "board"];
LOCAL_EVENTS.forEach(function (e) {
if (outdoor.indexOf(e.key) >= 0) e.outdoor = true;
if (quiet.indexOf(e.key) >= 0) e.quiet = true;
});
})();
var LOCAL_ACTS = {
idle_sip:   { anim: "drink",  dur: 2600 },   // 接水 → 举杯
idle_look:  { anim: "idle",   dur: 3000 },   // 面朝北 → actRow 自动切 idle_back
idle_read:  { anim: "read",   dur: 2800 },   // 捧书翻页
idle_rest:  { anim: "lounge", dur: 4200 },   // 沙发/扶手椅：专用横躺帧
idle_nap:   { anim: "sleep",  dur: 4600 },   // 床/充电垫：躺姿 + Zzz
idle_type:  { anim: "typing", dur: 3200 },   // 工位：面朝北自动切 typing_back
idle_reach: { anim: "reach",  dur: 2400 },   // 取纸/翻冰箱/洗脸/逛摊
idle_think: { anim: "think",  dur: 3000 },   // 任务板/白板/镜子/衣柜
idle_eat:   { anim: "eat",    dur: 3200 },   // 吃点心/下厨
idle_play:  { anim: "play",   dur: 3400 },   // 打街机
idle_wave:  { anim: "wave",   dur: 2400 },   // 挥手
idle_cheer: { anim: "cheer",  dur: 2600 },   // 伸懒腰/看花
idle_sit:   { anim: "sit",    dur: 3200 },   // 长椅
idle_dizzy: { anim: "dizzy",  dur: 2200 },   // 犯迷糊
idle_farm:  { anim: "reach",  dur: 2600 }    // 农活：锄地/播种/浇水/施肥/收割
};
var STAT_FILLS = {
tea: { social: 1 }, dining: { hunger: 12, mood: 2 }, cook: { hunger: 18, mood: 3 },
fridge: { hunger: 8 }, market: { hunger: 10, social: 3 },
farm: { mood: 2 }, fishing: { mood: 3 }, cookmeal: { hunger: 6, mood: 2 },
relax: { mood: 4, energy: 3 }, arcade: { mood: 7, energy: -2 }, garden: { mood: 5 },
stroll: { mood: 4 }, window: { mood: 3 }, sofa: { energy: 8 }, bed: { energy: 10 },
recover: { energy: 12 }, dizzy: {}, door: { social: 6, mood: 2 }, mail: { social: 3 },
washup: { hygiene: 12, mood: 2 }, mirror: { hygiene: 2, mood: 1 },
tea2: { hunger: 4 },
townwell: { mood: 3 }, townbench: { mood: 4, energy: 2 }
};
function statFillFor(key) { return STAT_FILLS[key] || null; }
function localText(e) {
if (!e) return "";
if (e.textDay || e.textNight) return lightsOn ? (e.textDay || e.text) : (e.textNight || e.text);
return e.text;
}
var EVENT_SCRIPTS = {
delivery:       { zone: "door",    act: "idle_reach", text: "签收了一个大包裹！",        fills: { mood: 6 } },
rain_sudden:    { zone: "garden",  act: "idle_look",  text: "赶紧把花挪到屋檐下…",      fills: { mood: -3, hygiene: 2 }, outdoor: true },
cat_visit:      { zone: "door",    act: "idle_wave",  text: "喵酱！今天也来蹭饭吗～",   fills: { mood: 8, social: 4 } },
neighbor_knock: { zone: "door",    act: "idle_wave",  text: "村长请进，工具在墙上挂着", fills: { social: 10 } },
power_flicker:  { zone: "board",   act: "idle_think", text: "刚才灯闪了…应该没事",      fills: { mood: -2 } },
snack_craving:  { zone: "fridge",  act: "idle_eat",   text: "偷偷吃块小饼干",           fills: { hunger: 8, hygiene: -2 } },
inspiration:    { zone: "screen",  act: "idle_type",  text: "记下来了！明天就试",       fills: { mood: 5 } },
phone_buzz:     { zone: "sofa",    act: "idle_sip",   text: "哈哈，这条消息好笑",       fills: { social: 5, mood: 3 } },
plant_dry:      { zone: "garden",  act: "idle_reach", text: "来，浇水啦～",             fills: { mood: 4 }, outdoor: true },
bug_report:     { zone: "desk",    act: "idle_type",  text: "小 bug 而已，马上修好",    fills: { mood: -6 } },
memory_flash:   { zone: "window",  act: "idle_look",  text: "那时候真是好啊…",          fills: { mood: 3 } },
market_day:     { zone: "market",  act: "idle_reach", text: "新到的果子看着真新鲜",     fills: { hunger: 10, social: 4 }, outdoor: true }
};
var pendingEvent = null;   // 正事中被打断不丢事件，排队等空档演
var INFO_CARDS = {
gramoA:    { name: "留声机", desc: "镇上淘来的旧货，摇一摇还能唱。喵酱最喜欢趴在旁边听。" },
arcadeA:   { name: "街机《深海弹幕》", desc: "博士从老家寄来的，说是淘汰的实验机。摇杆有点涩。", dyn: function () { return "最高分 " + arcadeBest() + "（今天第 " + arcadePlaysToday() + " 局）"; } },
bedA:      { name: "床", desc: "被子是紫色的，有晒过太阳的味道。赖床概率 100%。" },
fridgeA:   { name: "冰箱", desc: "常备：酸奶、昨天的鱼、左上角那盒不敢动的神秘盒子。", dyn: function () { return "饱食度 " + stats.hunger + " / 100"; } },
stoveA:    { name: "灶台", desc: "火候还行，就是每次煎鱼都粘锅。" },
benchA:    { name: "花园长椅", desc: "第三块木板翘起来了，村长说下周来修。" },
rechargeA: { name: "充电垫", desc: "AI 的回血方式：蹲上去 20 分钟 ≈ 睡两小时。", dyn: function () { return "精力 " + stats.energy + " / 100"; } },
armA:      { name: "扶手椅", desc: "扶手被磨得发亮，是全屋最爱坐的位置。" },
sofaA:     { name: "沙发", desc: "瘫上去就不想起来。茶几上永远有半杯水。" },
desk:      { name: "工位", desc: "键盘有三颗键帽发白：空格、E、删。", dyn: function () { return "今日完成 " + (evidence ? evidence.done : 0) + " 件"; } },
woodA:     { name: "木桌", desc: "桌上永远摊着没收拾的草稿纸。" },
shelfA:    { name: "记忆架", desc: "整理过的记忆都在这里，按日期排。" },
blackboardA:{ name: "黑板", desc: "写着今日待办，擦了又写。", dyn: function () { return "今日完成 " + (evidence ? evidence.done : 0) + " 件"; } },
whiteboardA:{ name: "白板", desc: "灵感来了就写两笔，擦掉的速度比写快。" },
schA:      { name: "小书桌", desc: "上学时用的旧课桌，现在专门放漫画。" },
wardA:     { name: "衣柜", desc: "门一开就掉下来一件外套——收纳能力堪忧。" },
cabA:      { name: "储物柜", desc: "里面整齐地堆着'总有一天会用'的东西。" },
cabB:      { name: "文件柜", desc: "抽屉卡住了，得用特定的角度才拉得开。" },
fileA:     { name: "文件架", desc: "放账单和说明书的地方，从没整理过。" },
chairA:    { name: "办公椅", desc: "滚轮有一颗不太灵，转圈的时候会歪。" },
tableB:    { name: "小圆桌", desc: "上面永远有一杯没喝完的水和半包饼干。" },
printA:    { name: "打印机", desc: "今天也很乖，就是偶尔吞纸。", dyn: function () { return "状态良好"; } },
bedstandA: { name: "床头柜", desc: "台灯+一本翻到一半的书+闹钟（从没叫醒过谁）。" },
bathA:     { name: "浴缸", desc: "泡进去就不想出来的那种。水温自动加热。" },
shoecabA:  { name: "鞋柜", desc: "进门第一眼看到的家具，常年只有两双鞋。" },
bathcabA:  { name: "浴室小柜", desc: "囤着三条一样的浴巾——买的时候忘了家里有。" },
counterA:  { name: "料理台", desc: "水果碗和水壶的固定车位，切菜区永远干净（因为不吃切菜）。" },
stallA:    { name: "杂货摊", desc: "红白棚子是镇长的，摆什么全看心情。" },
stallB:    { name: "水果摊", desc: "今天的橙子很新鲜——猫爪印数量：2。" },
townWell:  { name: "镇口水井", desc: "据说扔硬币能许愿。博士说是伪科学，但还是扔了。" },
townBench: { name: "街边长椅", desc: "喵酱的地盘。坐之前要跟它打招呼。" },
homeCat:   { name: "喵酱家", desc: "门垫上永远有鱼干渣。主人是只好脾气的橘猫。点击房子可以进去串门。",
dyn: function () { return npcHomeState("cat") === "home" ? "● 喵酱在家（点房子进屋）" : "○ 喵酱出门遛弯了"; } },
homeChief: { name: "村长家", desc: "水豚村长的宅子，门口的灯是全镇最亮的。点击房子可以进去串门。",
dyn: function () { return npcHomeState("chief") === "home" ? "● 村长在家（点房子进屋）" : "○ 村长在镇上转悠"; } },
homeDoc:   { name: "博士家", desc: "章鱼博士的研究所，窗户里贴满潮汐表。点击房子可以进去串门。",
dyn: function () { return npcHomeState("doc") === "home" ? "● 博士在家（点房子进屋）" : "○ 博士去海边观测了"; } },
farmField: { name: "自家农田", desc: "五列四排的耕地：锄地 → 播种 → 浇水 → 施肥 → 等它熟。点田地就会干对应的活。",
dyn: function () { var s = farmSummary(); return "熟了 " + s.ready + " 株 · 在长 " + s.growing + " 株 · 已开垦 " + s.tilled + " 块"; } },
pondWater: { name: "鱼塘", desc: "花园东南角的小水塘，扔根线就能坐一下午。看见「！」浮起来就点一下起竿。",
dyn: function () { return "今天钓了 " + (farm ? farm.fish : 0) + " 条鱼"; } }
};
var BOOKS = [
{ title: "潮汐与月亮（章鱼博士 著）", lines: ["月球每天推迟 50 分钟升起——", "所以每天的潮，", "都是昨天的海迟到的样子。"] },
{ title: "像素生存指南", lines: ["第 3 章：", "当你只有一个 8×8 的脑袋，", "记得把重要的东西画得更大。"] },
{ title: "云的饲养手册", lines: ["积云每天要喂 3 小时阳光，", "阴天请改喂情绪。"] },
{ title: "服务器里的鱼（佚名）", lines: ["它住在机房，", "但它以为那是海。", "——这话对了一半。"] },
{ title: "懒散的艺术", lines: ["瘫着不是什么都不做，", "是在给灵感腾地方。"] },
{ title: "猫语入门", lines: ["「喵」上扬 = 可以蹭；", "降调 = 鱼干没了，", "事情很严重。"] }
];
var ARCADE_GAMES = [
{ title: "深海弹幕", frame: function (score, wave) {
return [
"+----------------+",
"|  o  o   o  o   |",
"| o  o  o   o    |  波次 " + wave,
"|    o   o  o    |",
"|       ^        |  得分 " + score,
"|   ~~鱼~~       |",
"+----------------+"
];
} },
{ title: "像素水族箱", frame: function (score, wave) {
return [
"+----------------+",
"| ~ ~ ~ ~ ~ ~ ~  |",
"|   ><(((*>      |  波次 " + wave,
"|        ><(((*> |  得分 " + score,
"| ><(((*>        |",
"+----------------+"
];
} }
];
var perfState = { mode: null, tick: null };
function arcadeBest() { try { return +(localStorage.getItem("office_arcade_best") || 0); } catch (e) { return 0; } }
function arcadePlaysToday() { try { return +(localStorage.getItem("office_arcade_plays") || 0); } catch (e) { return 0; } }
function showInfoCard(hostId, sx, sy) {
var info = INFO_CARDS[hostId];
var card = document.getElementById("info-card");
if (!card || !info) { if (card) card.classList.remove("show"); return; }
var dyn = info.dyn ? '<div class="ic-dyn">' + info.dyn() + "</div>" : "";
card.innerHTML = '<div class="ic-name">' + info.name + '</div><div class="ic-desc">' + info.desc + "</div>" + dyn +
'<div class="ic-hint">鱼正走过去互动…</div>';
card.style.left = Math.max(6, Math.min(sx + 12, card.parentElement.clientWidth - 280)) + "px";
card.style.top = Math.max(6, sy - 130) + "px";
card.classList.add("show");
clearTimeout(showInfoCard._t);
showInfoCard._t = setTimeout(function () { card.classList.remove("show"); }, 3600);
}
function showPerfPanel(mode) {
var panel = document.getElementById("perf-panel");
if (!panel) return;
if (perfState.tick) { clearInterval(perfState.tick); perfState.tick = null; }
if (mode === "read") {
var book = BOOKS[Math.floor(Math.random() * BOOKS.length)];
document.getElementById("pp-icon").textContent = "📖";
document.getElementById("pp-title").textContent = "正在读：" + book.title;
document.getElementById("pp-body").innerHTML =
book.lines.map(function (l) { return "<div>" + l + "</div>"; }).join("") +
'<div class="pp-progress"><i id="pp-bar" style="width:8%"></i></div>';
var prog = 8;
perfState.tick = setInterval(function () {
prog = Math.min(100, prog + 9 + Math.random() * 8);
var bar = document.getElementById("pp-bar");
if (bar) bar.style.width = prog + "%";
}, 700);
} else if (mode === "play") {
var game = ARCADE_GAMES[Math.floor(Math.random() * ARCADE_GAMES.length)];
var score = 0, wave = 1;
document.getElementById("pp-icon").textContent = "🕹";
document.getElementById("pp-title").textContent = "正在玩：" + game.title;
perfState.tick = setInterval(function () {
score += 10 + Math.floor(Math.random() * 40);
if (Math.random() < 0.25) wave++;
var best = arcadeBest();
if (score > best) { try { localStorage.setItem("office_arcade_best", String(score)); } catch (e) {} }
var body = document.getElementById("pp-body");
if (body) body.innerHTML =
'<div class="pp-screen">' + game.frame(score, wave).join("\n") + "</div>" +
'<div style="margin-top:6px;color:#9aa3b8">最高分 ' + Math.max(best, score) + "（实时）</div>";
}, 550);
} else { panel.classList.remove("show"); return; }
panel.classList.add("show");
perfState.mode = mode;
}
var writerState = { title: "", lines: [], current: "", total: 0 };
var writerHideTimer = null;
function writerOpen() {
var p = document.getElementById("writer-panel");
if (p) p.classList.add("show");
if (writerHideTimer) { clearTimeout(writerHideTimer); writerHideTimer = null; }
}
function writerClose() {
var p = document.getElementById("writer-panel");
if (p) p.classList.remove("show");
}
function writerEsc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function writerRender() {
var body = document.getElementById("wp-body");
if (!body) return;
var html = writerState.lines.map(function (l) { return '<div class="wp-line">' + writerEsc(l) + "</div>"; }).join("");
if (writerState.current) html += '<div class="wp-line current">' + writerEsc(writerState.current) + "\u258c</div>";
body.innerHTML = html || '<div class="wp-line">\u7b49 AI \u5f00\u59cb\u5199\u2026</div>';
body.scrollTop = body.scrollHeight;
var meta = document.getElementById("wp-meta");
if (meta) meta.textContent = writerState.total ? "进度 " + writerState.lines.length + "/" + writerState.total + " 行 · 敲完自动存稿待发布" : "写完后按随机时间发布";
var t = document.getElementById("wp-title");
if (t) t.textContent = writerState.title || "写作板";
}
function writerFeed(task, detail) {
var m = /《(.+?)》/.exec(task || "");
var pm = /\[(\d+)\/(\d+)\]/.exec(detail || "");
if (!pm) return false;
writerState.title = "敲文章《" + (m ? m[1] : "") + "》";
writerState.total = Number(pm[2]) || 0;
var idx = Number(pm[1]) || 0;
var line = (detail || "").replace(/^\[\d+\/\d+\]\s*/, "");
while (writerState.lines.length < idx - 1) writerState.lines.push("…");
writerState.lines[idx - 1] = line;
writerState.lines.length = idx;
writerState.current = "";
writerRender();
writerOpen();
if (writerHideTimer) clearTimeout(writerHideTimer);
writerHideTimer = setTimeout(writerClose, 90000);
return true;
}
function hidePerfPanel() {
var panel = document.getElementById("perf-panel");
if (panel) panel.classList.remove("show");
if (perfState.tick) { clearInterval(perfState.tick); perfState.tick = null; }
perfState.mode = null;
}
function onRandomEvent(msg) {
var script = EVENT_SCRIPTS[msg.eventKey];
if (!script || !scene || !scene.mapdata.zones[script.zone]) return;
if (script.outdoor && weather === "rainy" && msg.eventKey !== "rain_sudden") return;  // 雨天 gate 二次确认
if (fishState === "walking" || fishState === "acting") {
try {
var prevBubble = (curPlan && curPlan.task) || bubbleText;
showBubble("✉ " + (script.text || msg.label || msg.eventKey), "idle");
scene.time.delayedCall(2500, function () {
if (bubbleText && bubbleText.text && bubbleText.text.indexOf("✉") === 0 && prevBubble) showBubble(prevBubble, "idle");
});
} catch (e) {}
pendingEvent = script; return;
}
stopIdleLife();
goLocal(script.zone, script.text, script.act, null, false, script.fills || null);
}
function postStatDelta(deltas) {
try {
fetch("/office-hub-api/stats", {   // nginx 需反代；失败静默（数值层是增强不是依赖）
method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(deltas)
}).catch(function () {});
} catch (e) {}
}
var recentLocal = [];       // 最近触发过的 key，避免连着重复同一个小动作
var lastLocalKey = null;
var localActTimer = null;   // 当前本地表演的结束定时器（新事件开始时必须清掉旧的）
function findLocalEvent(key) {
for (var i = 0; i < LOCAL_EVENTS.length; i++) if (LOCAL_EVENTS[i].key === key) return LOCAL_EVENTS[i];
return null;
}
function pickLocalEvent() {
if (!scene || !fish || !scene.mapdata) return null;
var fx = px2tx(fish.x), fy = px2ty(fish.y);
var pool = LOCAL_EVENTS.filter(function (e) {
return recentLocal.indexOf(e.key) < 0 && scene.mapdata.zones[e.zone];
});
if (!pool.length) { recentLocal.length = 0; pool = LOCAL_EVENTS.filter(function (e) { return scene.mapdata.zones[e.zone]; }); }
if (!pool.length) return null;
var hourNow = bjHour();
var weights = [], total = 0;
pool.forEach(function (e) {
var a = scene.mapdata.zones[e.zone].anchor;
var d = Math.abs(a[0] - fx) + Math.abs(a[1] - fy) * 0.4;
var w = e.w / (1 + d * 0.16);
var nd = EVENT_NEED[e.key];
if (nd) w *= needBoost(nd.need, stats[nd.need]);            // 需求驱动（方案 §4）
if (e.outdoor) {                                            // 天气联动
if (weather === "rainy") w *= 0.15;
if (hourNow >= 21 || hourNow < 6) w *= 0.3;               // 深夜不出门
}
if (e.quiet && (hourNow >= 23 || hourNow < 7)) w *= 3;      // 夜里偏好安静事件
if (nd && nd.need === "mood") w *= (stats.mood < 30 ? 1.8 : 1);
if (nd && nd.need === "energy" && (hourNow >= 13 && hourNow < 15)) w *= 1.6;  // 午后困
w *= 0.6 + Math.random() * 0.9;                             // 扰动：同配置不同选择
weights.push(w); total += w;
});
var r = Math.random() * total;
for (var i = 0; i < pool.length; i++) {
r -= weights[i];
if (r <= 0) return pool[i];
}
return pool[pool.length - 1];
}
function noteLocalEvent(key) {
lastLocalKey = key;
recentLocal.push(key);
if (recentLocal.length > 6) recentLocal.shift();
}
function startIdleLife(firstDelay) {
stopIdleLife();
if (editorMode) return;    // 独立地图编辑器：鱼站桩不动，别在编辑时到处走
idleTimer = setTimeout(idleStep, firstDelay || 1500);
}
function stopIdleLife() {
if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
}
function idleStep() {
if (!scene || !fish) return;
if (fishState === "walking" || fishState === "acting") { scheduleIdle(2200); return; }
if (visitingHome && px2ty(fish.y) >= 19 && px2tx(fish.x) >= 40) {
fishState = "idle";
visitSitCount++;
if (visitSitCount >= 2) {
visitSitCount = 0;
var zd = scene.mapdata.zones[visitingHome.door];
exitNeighborHome();   // 镜头回到小镇停靠位
if (zd) walkLocalTo(Math.round(zd.anchor[0]), Math.round(zd.anchor[1]), null);   // 走出门
scheduleIdle(4200);
} else scheduleIdle(5000 + Math.random() * 5000);
return;
}
fishState = "idle";
if (pendingEvent) {   // 排队中的随机事件优先演（方案 §2.2）
var pe = pendingEvent; pendingEvent = null;
goLocal(pe.zone, pe.text, pe.act, null, false, pe.fills || null);
scheduleIdle(3200 + Math.random() * 2500);
return;
}
tryNpcChat();         // 走到居民附近自动搭话（social+10）
var e = Math.random() < 0.26 ? null : pickLocalEvent();   // 26% 纯散步，74% 有内容的小动作
if (e) {
noteLocalEvent(e.key);
var ex = e.key === "cookmeal" ? { cookJob: true } : (e.key === "fishing" ? { pond: true } : (e.key === "farm" ? { farmJob: "water" } : null));
goLocal(e.zone, localText(e), e.act, e.face, false, statFillFor(e.key), ex);
} else {
wanderToRandomPoint();
}
scheduleIdle(2600 + Math.random() * 3000);
}
function scheduleIdle(delay) {
stopIdleLife();
idleTimer = setTimeout(idleStep, delay);
}
function wanderToRandomPoint() {
if (stats.social < 60 && Math.random() < 0.45 && npcLayer.length) {
var candidates = npcLayer.filter(function (n) { return n.state !== "home" && n.spr && n.spr.active; });
if (candidates.length) {
var npc = candidates[Math.floor(Math.random() * candidates.length)];
var gx = Math.floor(npc.spr.x / TILE), gy = Math.floor((npc.spr.y - WALL_H) / TILE);
var spot = nearestFree(gx, gy) || { x: gx, y: gy };
walkLocalTo(spot.x, spot.y, { text: "去找" + npc.def.name + "聊聊天", act: "idle", face: "s", zone: null, statFill: null });
return;
}
}
for (var tries = 0; tries < 24; tries++) {
var gx2 = 1 + Math.floor(Math.random() * (COLS - 2));
var gy2 = 3 + Math.floor(Math.random() * (ROWS - 3));
if (!scene.grid[gy2][gx2]) { walkLocalTo(gx2, gy2, null); return; }
}
}
function goLocal(zoneKey, text, pseudoAct, face, instant, statFill, extra) {
var zone = scene.mapdata.zones[zoneKey];
if (!zone) return;
if (instant) {
fish.x = Math.round(zone.anchor[0]) * TILE + TILE / 2;
fish.y = WALL_H + Math.round(zone.anchor[1]) * TILE + TILE / 2;
fish.setDepth(fish.y);
}
walkLocalTo(Math.round(zone.anchor[0]), Math.round(zone.anchor[1]),
{ text: text, act: pseudoAct, face: face || zone.face || "s", zone: zone, statFill: statFill || null, extra: extra || null });
}
function walkLocalTo(gx, gy, act) {
unsit();   // 本地动作开始前先起身，避免上一轮瘫坐的 scale/深度/角度带进走路
exitNeighborHome();   // 新行为开始 = 串门结束（视角回到小镇，鱼走自己的路）
if (localActTimer) { clearTimeout(localActTimer); localActTimer = null; }
var path = astar(px2tx(fish.x), px2ty(fish.y), gx, gy);
if (!path) return;
curPlan = {
path: path, i: 0, local: true, st: null,
cfg: { act: (act && act.act) || "idle", mood: "idle" },
task: act ? act.text : "散步中",
bubbleText: act ? act.text : null,
face: act ? act.face : "s",
zone: act ? act.zone : null,
statFill: act ? act.statFill || null : null,
cookJob: !!(act && act.extra && act.extra.cookJob),
farmJob: (act && act.extra && act.extra.farmJob) || null,
farmSlot: (act && act.extra && act.extra.farmSlot) != null ? act.extra.farmSlot : null,
pond: !!(act && act.extra && act.extra.pond)
};
fishState = "walking";
}
function arriveLocal() {
if (curPlan && curPlan.statFill) postStatDelta(curPlan.statFill);
if (curPlan && curPlan.visit) { arriveVisit(); return; }   // 点邻居房屋 → 进屋串门
if (curPlan && (curPlan.farmJob || curPlan.pond)) {
fishState = "acting";
fish.face(curPlan.face || "s");
fish.still();
var res;
if (curPlan.pond) {
res = fishStart();
showBubble(res.ok ? "钓鱼中…盯紧浮标" : res.text, "idle");
} else {
res = farmAct(curPlan.farmJob, curPlan.farmSlot);
showBubble(res.text, "idle");
if (res.ok) {
drawFarm();
postStatDelta({ mood: 2, energy: -1 });
onStatsDeltaLocal({ mood: 2, energy: -1 });
renderStatsBar();
}
}
var thisPlan2 = curPlan;
setTimeout(function () {
if (curPlan === thisPlan2 && fishState === "acting") { fishState = "idle"; hideBubble(); }
}, 2600);
return;
}
if (curPlan && curPlan.cookJob) {
fishState = "acting";
fish.face(curPlan.face || "s");
var laCook = LOCAL_ACTS.idle_eat;
startActAnim(laCook.anim);
var done = cookAuto();
showBubble(done || "（食材不够，翻翻冰箱吧）", "idle");
if (done) { renderCookPanel(); var thisPlan3 = curPlan;
setTimeout(function () { if (curPlan === thisPlan3) hideCookPanel(); }, 5200);
}
var thisPlanC = curPlan;
setTimeout(function () {
if (curPlan === thisPlanC && fishState === "acting") { fishState = "idle"; hideBubble(); }
}, laCook.dur);
return;
}
fishState = "acting";
fish.face(curPlan.face || "s");
if (curPlan.task && curPlan.task.indexOf("聊聊天") >= 0) {
var near = npcInteractCheck();
if (near) {
var dx2 = near.spr.x - fish.x;
fish.face(Math.abs(dx2) < 20 ? "n" : dx2 > 0 ? "e" : "w");
lastNpcChat = 0;   // 允许立即对话
}
}
var la = LOCAL_ACTS[curPlan.cfg.act] || { anim: "idle", dur: 1800 };
applySit(curPlan.zone);   // 「瘫在沙发上」真的落到沙发坐垫上
startActAnim(la.anim);
if (curPlan.bubbleText) showBubble(curPlan.bubbleText, "idle");
if (curPlan.cfg.act === "idle_read") showPerfPanel("read");
else if (curPlan.cfg.act === "idle_play") {
showPerfPanel("play");
try { localStorage.setItem("office_arcade_plays", String(arcadePlaysToday() + 1)); } catch (e) {}
} else hidePerfPanel();
if (localActTimer) { clearTimeout(localActTimer); localActTimer = null; }
var thisPlan = curPlan;
localActTimer = setTimeout(function () {
localActTimer = null;
if (curPlan === thisPlan && fishState === "acting" && curPlan && curPlan.local) {
stopActAnim();
fishState = "idle";
hideBubble();
hidePerfPanel();
}
}, la.dur);
}
var pondTickAcc = 0, farmTickAcc = 0;
var s_baseGuard = null;   // v36：地板层自愈哨兵（scene 引用）
function update(time, delta) {
if (scene && rainParts.length) tickWeather(scene);
if (!scene || !fish) return;
updateAmbient(scene);
depthSort();   // 只做一次 setDepth，不会抛错，无需每帧 try/catch
try {
if (fishState === "walking") stepWalk();
} catch (e) { console.error("stepWalk:", e.message); }
if (fishState === "walking") {
fish.bodySpr.setY(fish.baseY + Math.sin(time / 90) * 1.2);
fish.bodySpr.setAngle(0);
}
if (bubble) bubble.setPosition(fish.x + bubbleOff.x, fish.y + bubbleOff.y);
if (s_baseGuard && s_baseGuard !== scene) s_baseGuard = null;
if (!s_baseGuard && scene && scene.baseGfx && scene.baseGfx._isBaseGfx) s_baseGuard = scene;
if (s_baseGuard && (!s_baseGuard.baseGfx.visible || !s_baseGuard.children.list.includes(s_baseGuard.baseGfx))) {
s_baseGuard.baseGfx.setVisible(true);
if (!s_baseGuard.children.list.includes(s_baseGuard.baseGfx)) s_baseGuard.children.add(s_baseGuard.baseGfx);
}
tickPondLife();
if (fishing) { fishTick(Math.min(delta || 16, 50) / 1000); if (fishing && fishing.bobber) fishing.bobber.setDepth(4); }
farmTickAcc += (delta || 16);
if (farmTickAcc >= 30000) { farmTickAcc = 0; farmTick(); }
if (editMode && scene.cameras && now0() - lastListRefreshAt > 400) {
var vw0 = scene.cameras.main.worldView;
if (Math.abs(vw0.x - lastListVX) > 24 || Math.abs(vw0.y - lastListVY) > 24) {
lastListVX = vw0.x; lastListVY = vw0.y; lastListRefreshAt = now0();
renderEditList();
}
}
}
var lastListVX = -1e9, lastListVY = -1e9, lastListRefreshAt = 0;
function now0() { return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now(); }
function showFishActivityCard() {
var card = document.getElementById("info-card");
if (!card || typeof actRows === "undefined") return;
var rows = actRows.slice(-5).reverse();
var html = '<div class="ic-name">🐟 大肥鱼</div>';
if (actCur && actCur.state) {
html += '<div class="ic-desc">此刻：<b>' + escHtml(actCur.task || "（无任务名）") + "</b></div>";
}
if (rows.length) {
html += '<div style="margin-top:4px">' + rows.map(function (r) {
var cfg = STATE_MAP[r.state] || STATE_MAP.idle;
return '<div style="font-size:12px;color:#aab4c8;margin:2px 0">' + (ACT_ICON[r.state] || "🐟") +
" " + escHtml(r.task || cfg.verb) + ' <span style="opacity:.6">' + agoText(r.at) + "</span></div>";
}).join("") + "</div>";
} else {
html += '<div class="ic-desc">最近没有真实事件，自己在小镇里过日子</div>';
}
html += '<div class="ic-hint">点别处继续 · 事件来自 hub</div>';
var cam = scene.cameras.main;
var sx = (fish.x - cam.scrollX) * cam.zoom, sy = (fish.y - cam.scrollY) * cam.zoom;
card.innerHTML = html;
card.style.left = Math.max(6, Math.min(sx - 120, card.parentElement.clientWidth - 280)) + "px";
card.style.top = Math.max(6, sy - 170) + "px";
card.classList.add("show");
clearTimeout(showFishActivityCard._t);
showFishActivityCard._t = setTimeout(function () { card.classList.remove("show"); }, 4200);
}
var lastPointer = null;   // 调试探针：最近一次点击的世界坐标（__office.lastPointer）
function bindClick(s) {
s.input.on("pointerdown", function (p) {
lastPointer = { wx: Math.round(p.worldX), wy: Math.round(p.worldY), sx: Math.round(p.x), sy: Math.round(p.y) };
if (p.rightButtonDown && p.rightButtonDown()) return;   // v48：右键只用来平移视角
if (editMode && editorMode && mapEditorPointerDown(p.worldX, p.worldY, p)) return;
if (editMode && editPointerDown(p.worldX, p.worldY, p)) return;
if (Date.now() < camDragSuppress) { camDragSuppress = 0; return; }
if (toggleSwitchAt(p.worldX, p.worldY)) return;
if (fishing) {
var rr = fishReel();
showBubble(rr.text, rr.ok ? "idle" : "error");
return;
}
var fw = 40, fh = 44;   // 鱼身命中盒（世界像素），比精灵显示宽略小防误触
if (Math.abs(p.worldX - fish.x) < fw / 2 && p.worldY > fish.y - fh && p.worldY < fish.y + 10) {
showFishActivityCard();
return;
}
var gx = px2tx(p.worldX), gy = px2ty(p.worldY);
if (gx < 0 || gy < 0 || gx >= COLS || gy >= ROWS) return;
if (fishState === "acting" && curPlan && !curPlan.local) return;
var homeHit = null;
NEIGHBOR_HOMES.forEach(function (h) {
var hp = s.hostMap[h.home];
if (!hp || !hp.spr) return;
var dw = hp.spr.displayWidth || 48, dh = hp.spr.displayHeight || 48;
if (p.worldX > hp.x - dw / 2 - 12 && p.worldX < hp.x + dw / 2 + 12 &&
p.worldY > hp.y - dh - 12 && p.worldY < hp.y + 14) homeHit = h;
});
if (homeHit) {
if (visitingHome === homeHit) {
var zdOut = s.mapdata.zones[homeHit.door];
exitNeighborHome();
if (zdOut) walkLocalTo(Math.round(zdOut.anchor[0]), Math.round(zdOut.anchor[1]), null);
return;
}
if (enterNeighborHome(s, homeHit)) return;
}
var farmHit = null, pondHit = false;
if (farm && !fishing) {
for (var pi = 0; pi < farm.plots.length; pi++) {
var pt = plotTile(pi);
var pcx = pt.x * TILE + TILE / 2, pcy = WALL_H + pt.y * TILE + TILE / 2;
if (Math.abs(p.worldX - pcx) < TILE * 0.75 && Math.abs(p.worldY - pcy) < TILE * 0.75) {
var pl = farm.plots[pi];
var actF = !pl.soil ? "till" : (!pl.crop ? "sow" : (pl.progress >= 1 ? "harvest" : (!pl.watered ? "water" : (!pl.fed ? "feed" : "harvest"))));
farmHit = { slot: pi, act: actF };
farmHit.verb = { till: "锄地", sow: "播种", water: "浇水", feed: "施肥", harvest: "收割" }[actF];
break;
}
}
}
if (!farmHit && p.worldY > WALL_H + (POND.y0 - 0.9) * TILE && p.worldY < WALL_H + (POND.y1 + 0.6) * TILE &&
p.worldX > (POND.x0 - 1.2) * TILE && p.worldX < (POND.x1 + 0.5) * TILE) pondHit = true;
if (farmHit || pondHit) {
var gxf = farmHit ? 30 : 34, gyf = farmHit ? 27 : 24;   // 田边过道 / 塘西栈道旁
var pathF = astar(px2tx(fish.x), px2ty(fish.y), gxf, gyf);
if (pathF) {
stopIdleLife();
unsit();
var verbF = pondHit ? "钓鱼" : farmHit.verb;
curPlan = {
path: pathF, i: 0, local: true, st: null,
cfg: { act: pondHit ? "idle_reach" : "idle_farm", mood: "idle" },
task: verbF, bubbleText: verbF, face: pondHit ? "e" : "n", zone: null,
statFill: null, farmJob: farmHit ? farmHit.act : null, farmSlot: farmHit ? farmHit.slot : null,
pond: pondHit
};
fishState = "walking";
showBubble(verbF, "idle");
startIdleLife(12000);
return;
}
}
var hotspots = [
{ host: "gramoA",  state: "listening", verb: "听音乐" },
{ host: "arcadeA", state: "gaming",    verb: "打游戏" },
{ host: "bedA",    state: "sleeping", verb: "躺一会儿" },
{ host: "fridgeA", state: "snacking",  verb: "找吃的" },
{ host: "stoveA",  state: "eating",    verb: "做饭吃" },
{ host: "benchA",  state: "strolling", verb: "坐下歇会" },
{ host: "rechargeA", state: "recovering", verb: "充电恢复" },
{ host: "armA",    state: "relaxing",  verb: "放松一下" },
{ host: "sofaA",   state: "idle",      verb: "瘫一会儿" }
];
var cssW = s.game.canvas.getBoundingClientRect().width;
var gameW = (s.scale && s.scale.gameSize && s.scale.gameSize.width) || s.game.canvas.width;
var cssPerWorld = gameW > 0 ? cssW / gameW : 1;
var radius = Math.min(Math.max(TILE * 0.9, 22 / (cssPerWorld || 1)), TILE * 1.8);
var bestCard = null, bestCardD = Infinity;
for (var hostId in INFO_CARDS) {
var hp0 = s.hostMap[hostId];
if (!hp0) continue;
var d0 = Math.max(Math.abs(hp0.x - p.worldX), Math.abs(hp0.y - p.worldY));
if (d0 < radius && d0 < bestCardD) { bestCardD = d0; bestCard = hostId; }
}
var cardOnly = false;   // 点的是"只能看"的物品（无行为）
if (bestCard) {
var rectC = s.game.canvas.getBoundingClientRect();
var gwC = (s.scale && s.scale.gameSize && s.scale.gameSize.width) || s.game.canvas.width;
var ghC = (s.scale && s.scale.gameSize && s.scale.gameSize.height) || s.game.canvas.height;
showInfoCard(bestCard, (p.worldX - s.cameras.main.scrollX) * (rectC.width / gwC), (p.worldY - s.cameras.main.scrollY) * (rectC.height / ghC));
}
var best = null, bestD = Infinity;
for (var hi = 0; hi < hotspots.length; hi++) {
var hp = s.hostMap[hotspots[hi].host];
if (!hp) continue;
var d = Math.max(Math.abs(hp.x - p.worldX), Math.abs(hp.y - p.worldY));
if (d < radius && d < bestD) { bestD = d; best = hotspots[hi]; }
}
if (best) {
var zc = { listening: "relax", gaming: "arcade", sleeping: "bed", snacking: "fridge",
eating: "cook", strolling: "garden", recovering: "recover", relaxing: "relax",
idle: "sofa" }[best.state];
var z = s.mapdata.zones[zc];
if (!z) return;
var ex2 = Math.round(z.anchor[0]), ey2 = Math.round(z.anchor[1]);
var path2 = astar(px2tx(fish.x), px2ty(fish.y), ex2, ey2);  // 旧版误把 fish.y 传给了 px2tx
if (!path2) path2 = [{ x: ex2, y: ey2 }];
stopIdleLife();
unsit();
var cfg2 = STATE_MAP[best.state] || STATE_MAP.idle;
curPlan = { path: path2, i: 0, local: true, cfg: cfg2, task: best.verb, face: z.face || "s", zone: z };
if (best.state === "eating") curPlan.cookJob = true;
fishState = "walking";
showBubble(best.verb, "idle");
startIdleLife(6000);
return;
}
if (bestCard) {
var hpLook = s.hostMap[bestCard];
var canAct = false;
for (var hk = 0; hk < hotspots.length; hk++) if (hotspots[hk].host === bestCard) { canAct = true; break; }
if (!canAct && hpLook) {
var lookGx = Math.round(hpLook.x / TILE), lookGy = Math.round((hpLook.y - WALL_H) / TILE) + 1;
var spot2 = null;
for (var off = 0; off <= 2 && !spot2; off++) {
[[0, off], [0, -off], [off, 0], [-off, 0]].forEach(function (o2) {
var cx2 = lookGx + o2[0], cy2 = lookGy + o2[1];
if (!spot2 && cx2 >= 0 && cy2 >= 0 && cx2 < COLS && cy2 < ROWS && s.grid[cy2] && !s.grid[cy2][cx2]) spot2 = { x: cx2, y: cy2 };
});
}
if (spot2) {
var path3 = astar(px2tx(fish.x), px2ty(fish.y), spot2.x, spot2.y);
if (path3 && path3.length >= 2) {
stopIdleLife();
unsit();
curPlan = { path: path3, i: 0, local: true, st: null, cfg: { act: "idle", mood: "idle" }, task: "看看" + INFO_CARDS[bestCard].name, bubbleText: null, face: "s" };
fishState = "walking";
startIdleLife(4000);
return;
}
}
return;   // 走不过去也只看卡，不落回普通走位
}
}
if (s.grid[gy][gx] && !editMode) return;   // 普通走位只允许点可走格
var path = astar(px2tx(fish.x), px2ty(fish.y), gx, gy);
if (!path || path.length < 2) return;
stopIdleLife();
unsit();
curPlan = { path: path, i: 0, local: true, st: null, cfg: { act: "idle", mood: "idle" }, task: "", bubbleText: null, face: "s" };
fishState = "walking";
hideBubble();
startIdleLife(3000);
});
}
function getWsUrl() {
var q = new URLSearchParams(location.search);
var override = q.get("ws");
try { override = override || localStorage.getItem("office_ws"); } catch (e) {}
if (override) return override;
if (/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(location.host)) {
return "ws://127.0.0.1:" + (q.get("hub") || "4321") + "/";
}
return (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/office-ws/";
}
function setOffline(off) {
var badge = document.getElementById("st-offline");
if (badge) badge.hidden = !off;
if (off) {
var t = document.getElementById("st-task");
if (t && (t.textContent === "连接中…" || /^离线/.test(t.textContent))) {
t.textContent = "离线 · 本地生活模拟中";
}
}
}
function connectWS() {
var url = getWsUrl();
try { ws = new WebSocket(url); } catch (e) { setOffline(true); retryWS(); return; }
ws.onopen = function () { reconnectDelay = 2000; setOffline(false); };
ws.onmessage = function (ev) {
var msg;
try { msg = JSON.parse(ev.data); } catch (e) { return; }
if (msg.type === "hello") {
if (Array.isArray(msg.recent)) msg.recent.forEach(pushEvent);
if (msg.stats) onStats(msg.stats);
if (msg.state) onState(msg.state);
if (Array.isArray(msg.customMap)) applyCustomMap(msg.customMap, true, msg.updatedAt);   // v37：hub 里的自定义家具层
if (msg.weather && window.__officeSetWeather) window.__officeSetWeather(msg.weather);   // P6：真实天气初始值
if (msg.customMap) window.__officeHubCount = msg.customMap.length;   // 排障：hub 侧家具数
} else if (msg.type === "map" && Array.isArray(msg.furniture)) {
applyCustomMap(msg.furniture, true, msg.updatedAt);   // v37：编辑保存后的热更新广播
} else if (msg.type === "state" && msg.state) {
if (msg.stats) onStats(msg.stats);
onState(msg.state);
pushEvent(msg.state);            // 实时事件进流水
} else if (msg.type === "stats" && msg.stats) {
onStats(msg.stats);              // 数值层广播（60s 节奏，方案 §1.2）
} else if (msg.type === "event" && msg.eventKey) {
onRandomEvent(msg);              // B 层随机事件（hub 2~6h 一掷）
} else if (msg.type === "weather" && msg.weather) {
if (window.__officeSetWeather) window.__officeSetWeather(msg.weather);   // P6：整点天气刷新
} else if (msg.type === "ts") {
lastServerTs = msg.ts; updateAgo();
} else if (msg.type === "viewers") {
var v = document.getElementById("st-viewers");
if (v) v.textContent = msg.viewers > 1 ? msg.viewers + " 人在围观" : "";
}
};
ws.onclose = function () { setOffline(true); retryWS(); };
ws.onerror = function () { try { ws.close(); } catch (e) {} };
}
function retryWS() {
clearTimeout(wsTimer);
wsTimer = setTimeout(connectWS, reconnectDelay);
reconnectDelay = Math.min(reconnectDelay * 1.5, 30000);   // 离线时降频，避免日志刷屏
}
function reconnectWS(url) {
try { if (url) localStorage.setItem("office_ws", url); else localStorage.removeItem("office_ws"); } catch (e) {}
if (ws) { ws.onclose = null; ws.onmessage = null; try { ws.close(); } catch (e) {} }
clearTimeout(wsTimer);
reconnectDelay = 2000;
connectWS();
}
function updateStatusbar(state, task, detail) {
var dot = document.getElementById("st-dot");
var t = document.getElementById("st-task");
var d = document.getElementById("st-detail");
if (dot) {
var dotKey = ACTIVE_STATES.indexOf(state) >= 0 ? "working" : (STATE_MAP[state] ? state : "idle");
dot.className = "dot " + dotKey;
}
if (t) t.textContent = task;
if (d) d.textContent = detail || "";
updateAgo();
}
function updateAgo() {
var ago = document.getElementById("st-ago");
if (ago && lastServerTs) {
var mins = Math.floor((Date.now() - lastServerTs) / 60000);
ago.textContent = mins <= 0 ? "刚刚" : mins + " 分钟前上报";
}
}
setInterval(updateAgo, 30000);
var STAT_META = [
{ key: "hunger",  icon: "🍚", label: "饱食" },
{ key: "mood",    icon: "😄", label: "心情" },
{ key: "energy",  icon: "⚡", label: "精力" },
{ key: "social",  icon: "💬", label: "社交" },
{ key: "hygiene", icon: "🫧", label: "卫生" }
];
var statsBarBuilt = false;
function buildStatsBar() {
if (statsBarBuilt) return;
var bar = document.getElementById("stats-bar");
if (!bar) return;
bar.innerHTML = "";
STAT_META.forEach(function (m) {
var cell = document.createElement("span");
cell.className = "stat-cell";
cell.dataset.key = m.key;
cell.title = m.label;
cell.innerHTML = m.icon + '<i class="stat-track"><i class="stat-fill"></i></i>';
bar.appendChild(cell);
});
statsBarBuilt = true;
}
function renderStatsBar() {
buildStatsBar();
STAT_META.forEach(function (m) {
var cell = document.querySelector('.stat-cell[data-key="' + m.key + '"]');
if (!cell) return;
var v = Math.max(0, Math.min(100, stats[m.key] || 0));
var fill = cell.querySelector(".stat-fill");
if (fill) {
fill.style.width = v + "%";
fill.className = "stat-fill" + (v < 30 ? " low" : "");
}
cell.classList.toggle("low", v < 30);
cell.title = m.label + " " + v;
});
}
var BJ_MS = 8 * 3600 * 1000;          // 作息按北京时间显示（小镇时区固定，不跟访客本地时区漂）
var ACT_MAX = 40;                     // 本地最多留 40 条
var ACT_SHOW = 20;                    // 面板最多显示 20 条
var ACT_STORE = "office_activity_v1";
var ACT_UI = "office_activity_ui";
var actRows = [];                                          // 事件流水（旧的在前）
var actCur = { state: "", task: "", at: 0 };                // 状态条当前这条（判断「为什么在睡觉」用）
var actTab = "events", actFolded = false;
var WEEK_CN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
function pad2(n) { return (n < 10 ? "0" : "") + n; }
function bjDate(ts) { return new Date((ts || Date.now()) + BJ_MS); }   // 用 UTC getter 读 = 北京墙钟
function bjHour(ts) { return bjDate(ts).getUTCHours(); }
function bjMinuteOfDay(ts) { var d = bjDate(ts); return d.getUTCHours() * 60 + d.getUTCMinutes(); }
function bjWeekday(ts) { return bjDate(ts).getUTCDay(); }
function bjClock(ts) { var d = bjDate(ts); return pad2(d.getUTCHours()) + ":" + pad2(d.getUTCMinutes()); }
function bjDayKey(ts) { var d = bjDate(ts); return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate()); }
function hhmmToMin(s) { var p = String(s).split(":"); return (Number(p[0]) || 0) * 60 + (Number(p[1]) || 0); }
function minToClock(m) { return pad2(Math.floor(m / 60) % 24) + ":" + pad2(m % 60); }
function escHtml(s) {
return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
});
}
function agoText(at) {
var m = Math.max(0, Math.round((Date.now() - (at || 0)) / 60000));
if (m < 1) return "刚刚";
if (m < 60) return m + " 分钟前";
var h = Math.floor(m / 60);
if (h < 24) return h + " 小时前";
return Math.floor(h / 24) + " 天前";
}
function gapText(targetMin) {                 // 距离 targetMin 还有多久
var d = ((targetMin - bjMinuteOfDay(Date.now())) + 1440) % 1440;
if (d < 1) return "不到 1 分钟";
if (d < 60) return d + " 分钟";
return Math.floor(d / 60) + " 小时" + (d % 60 ? " " + (d % 60) + " 分" : "");
}
function actLoad() {
try {
var j = JSON.parse(localStorage.getItem(ACT_STORE) || "{}");
if (Array.isArray(j.rows)) {
actRows = j.rows.filter(function (r) {
return r && r.at && r.state && STATE_MAP[r.state];
}).slice(-ACT_MAX);
}
} catch (e) { actRows = []; }
}
function actSave() {
try { localStorage.setItem(ACT_STORE, JSON.stringify({ rows: actRows.slice(-ACT_MAX) })); } catch (e) {}
}
function pushEvent(ev) {
if (!ev || !ev.state) return false;
var at = Number(ev.at || ev.ts) || Date.now();
var row = {
key: String(ev.state) + "|" + String(ev.task || "") + "|" + String(Number(ev.ts) || at),
at: at,
state: String(ev.state),
task: String(ev.task || ""),
detail: String(ev.detail || "")
};
for (var i = 0; i < actRows.length; i++) if (actRows[i].key === row.key) return false;
actRows.push(row);
while (actRows.length > ACT_MAX) actRows.shift();
actSave();
renderEvents();
renderPlan();      // 「最近一次真实事件」这一行跟着变
return true;
}
function renderEvents() {
var ol = document.getElementById("act-list");
if (!ol) return;
var cnt = document.getElementById("act-count");
if (cnt) cnt.textContent = actRows.length ? "共 " + actRows.length + " 条 · 北京时间" : "";
var today = bjDayKey(Date.now());
var rows = actRows.slice(-ACT_SHOW).reverse();      // 最新的在最上面
if (!rows.length) {
ol.innerHTML = '<li class="act-empty">还没有收到真实事件。hub 在线时，它每次刷B站 / 写文章 / 回评论都会出现在这里；' +
'如果一直是空的，检查 office-hub 是否在跑（本地 <code>node office/tools/dev.mjs</code>）。</li>';
return;
}
ol.innerHTML = rows.map(function (r) {
var cfg = STATE_MAP[r.state] || STATE_MAP.idle;
var day = bjDayKey(r.at) === today ? "" : bjDayKey(r.at).slice(5) + " ";
return '<li class="act-row' + (cfg.mood === "error" ? " act-row-error" : "") + '">' +
'<span class="act-time">' + day + bjClock(r.at) + '</span>' +
'<span class="act-icon" aria-hidden="true">' + (ACT_ICON[r.state] || "🐟") + '</span>' +
'<span class="act-verb">' + escHtml(cfg.verb) + '</span>' +
'<span class="act-task">' + escHtml(r.task || cfg.verb) + '</span>' +
(r.detail ? '<span class="act-detail" title="' + escHtml(r.detail) + '">' + escHtml(r.detail) + '</span>' : "") +
'<span class="act-ago">' + agoText(r.at) + '</span>' +
'</li>';
}).join("");
}
function shiftsToday() {
var dow = bjWeekday(Date.now()), out = [];
SCHEDULE.shifts.forEach(function (s) {
if (s.weekday != null && s.weekday !== dow) return;
var base = hhmmToMin(s.at), step = (s.every || 0) * 60;
var n = step ? Math.max(1, Math.round(1440 / step)) : 1, occ = [];
for (var k = 0; k < n; k++) occ.push((base + k * step) % 1440);
occ.sort(function (a, b) { return a - b; });
out.push({
start: base, clock: s.at, occ: occ, every: s.every || 0,
label: s.label, note: s.note || "", dur: s.dur || 2, silent: !!s.silent, state: s.state || ""
});
});
out.sort(function (a, b) { return a.start - b.start; });   // 表按「几点开这一班」排，不按今天第一次触发的时刻
return out;
}
function currentShift(groups) {
var nowMin = bjMinuteOfDay(Date.now()), active = null, next = null, nextMin = 1e9;
groups.forEach(function (g) {
g.occ.forEach(function (m) {
if (nowMin >= m && nowMin < m + g.dur) active = { group: g, min: m, clock: minToClock(m) };
if (m > nowMin && m < nextMin) { nextMin = m; next = { group: g, min: m, clock: minToClock(m) }; }
});
});
return { nowMin: nowMin, active: active, next: next };
}
function shiftName(s) { return s.clock + " " + (s.group ? s.group.label : s.label) + (s.group && s.group.every ? "（每 " + s.group.every + " 小时一班）" : ""); }
function whyHtml(groups, now, active, next) {
var lines = [];
var wake = SCHEDULE.wake || [8, 23];
var awake = bjHour(now) >= wake[0] && bjHour(now) < wake[1];
var last = actRows.length ? actRows[actRows.length - 1] : null;
var st = actCur.state;
if (!last) {
lines.push("本地还没有任何真实事件记录：hub 只在小镇真的有状态发生时上报，刚打开页面 / 服务刚重启都会这样。");
} else {
var quiet = Math.round((now - last.at) / 60000);
lines.push("最近一次真实事件：<b>" + bjClock(last.at) + "</b>（" + agoText(last.at) + "）" +
(quiet >= 60 ? "，已经安静了 " + (quiet / 60).toFixed(1) + " 小时" : "") + "。");
}
if (active) {
lines.push("按时间表，<b>此刻正在进行</b>：" + shiftName(active) +
(active.group.silent ? "（静默任务，不上报状态）" : "") + "。");
} else if (next) {
lines.push("按时间表，此刻<b>不在班次里</b>；下一班 <b>" + shiftName(next) + "</b>，还有 " + gapText(next.min) + "。");
} else {
lines.push("今天的班次已经全部跑完，最后一班是 " + (groups.length ? groups[groups.length - 1].clock + " " + groups[groups.length - 1].label : "-") + "。");
}
if (st === "sleeping") {
lines.push(awake
? "<b>" + bjClock(now) + " 这个点不该睡</b>：它不是主动睡的 —— 没有真实事件、hub 又刚重启或状态超过 6 小时，" +
"默认态就回落成了「睡觉」。现在 " + pad2(wake[0]) + ":00–" + pad2(wake[1]) + ":00 的空档回落成「摸鱼」，" +
"只有 " + pad2(wake[1]) + ":00 之后才真的睡。"
: "现在确实是夜里（" + pad2(wake[1]) + ":00 之后），睡着是正常的，明早第一班 " + (groups.length ? groups[0].clock : "08:00") + "。");
} else if (st === "idle") {
lines.push("状态是「摸鱼」= 这会儿没有真实事件，它在小镇里自己过日子（散步、喝水、翻书），等下一班。");
} else if (st === "error") {
lines.push("上一次真实事件<b>报错了</b>，原因见事件流里那条红色的。");
} else if (st) {
lines.push("状态「" + (STATE_MAP[st] ? STATE_MAP[st].verb : st) + "」是真实上报的事件，不是模拟。");
}
return lines.join("<br>");
}
var planScrollPending = false;
function renderPlan() {
var nowEl = document.getElementById("act-now");
var listEl = document.getElementById("act-plan");
var whyEl = document.getElementById("act-why");
if (!nowEl || !listEl) return;
var now = Date.now(), groups = shiftsToday(), cur = currentShift(groups);
var cfg = STATE_MAP[actCur.state] || null;
nowEl.innerHTML = "现在 <b>" + bjClock(now) + "</b>（北京时间 · " + WEEK_CN[bjWeekday(now)] + "）" +
" · 当前状态：<b>" + (cfg ? cfg.verb : "未知") + "</b>" +
(actCur.at ? "（" + agoText(actCur.at) + "上报）" : "");
listEl.innerHTML = groups.map(function (g) {
var lastMin = g.occ[g.occ.length - 1] + g.dur;
var cls = (cur.nowMin >= lastMin) ? "past" : (cur.active && cur.active.group === g ? "live" : "");
var occTitle = g.every ? "今天的班次：" + g.occ.map(minToClock).join(" / ") : "";
return '<li class="' + cls + '"' + (occTitle ? ' title="' + occTitle + '"' : "") + '>' +
'<span class="plan-time">' + g.clock + '</span>' +
'<span class="plan-label">' + (g.silent ? "🔇 " : "") + escHtml(g.label) +
(g.every ? ' <span class="plan-every">每 ' + g.every + ' 小时</span>' : "") + '</span>' +
'<span class="plan-note">' + escHtml(g.note) + '</span></li>';
}).join("");
if (whyEl) whyEl.innerHTML = whyHtml(groups, now, cur.active, cur.next);
if (planScrollPending) {
planScrollPending = false;
var idx = 0;
groups.some(function (g, i) { if (cur.next && cur.next.group === g) { idx = i; return true; } return false; });
var live = listEl.querySelector("li.live") || listEl.children[Math.max(0, idx)];
if (live && listEl.scrollHeight > listEl.clientHeight) {
var br = listEl.getBoundingClientRect(), lr = live.getBoundingClientRect();
if (lr.bottom > br.bottom) listEl.scrollTop += (lr.bottom - br.bottom) + 8;
else if (lr.top < br.top) listEl.scrollTop -= (br.top - lr.top) + 8;
}
}
}
function actSetTab(which) {
actTab = which === "plan" ? "plan" : "events";
var ev = document.getElementById("act-pane-events"), pl = document.getElementById("act-pane-plan");
var tbl = document.getElementById("act-tab-events"), tpl = document.getElementById("act-tab-plan");
if (ev) ev.hidden = actTab !== "events";
if (pl) pl.hidden = actTab !== "plan";
if (tbl) { tbl.classList.toggle("active", actTab === "events"); tbl.setAttribute("aria-selected", String(actTab === "events")); }
if (tpl) { tpl.classList.toggle("active", actTab === "plan"); tpl.setAttribute("aria-selected", String(actTab === "plan")); }
if (actTab === "plan") { planScrollPending = true; renderPlan(); }
actSaveUI();
}
function actSetFold(folded) {
actFolded = !!folded;
var box = document.getElementById("activity"), btn = document.getElementById("act-fold");
if (box) box.classList.toggle("folded", actFolded);
if (btn) { btn.textContent = actFolded ? "展开" : "收起"; btn.setAttribute("aria-expanded", String(!actFolded)); }
actSaveUI();
}
function actSaveUI() {
try { localStorage.setItem(ACT_UI, JSON.stringify({ tab: actTab, folded: actFolded })); } catch (e) {}
}
function initActivity() {
var tabE = document.getElementById("act-tab-events");
var tabP = document.getElementById("act-tab-plan");
var fold = document.getElementById("act-fold");
if (!tabE || !tabP) return;                 // 老版本 index.html 里没有这块 DOM 时安静退出
try {
var ui = JSON.parse(localStorage.getItem(ACT_UI) || "{}");
if (ui.tab) actTab = ui.tab;
if (ui.folded != null) actFolded = !!ui.folded;
} catch (e) {}
tabE.addEventListener("click", function () { actSetTab("events"); });
tabP.addEventListener("click", function () { actSetTab("plan"); });
if (fold) fold.addEventListener("click", function () { actSetFold(!actFolded); });
actLoad();
actSetTab(actTab);
actSetFold(actFolded);
renderEvents();
renderPlan();
}
setInterval(function () {
renderEvents();
if (actTab === "plan") renderPlan();
}, 30000);
if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", initActivity);
else initActivity();
window.addEventListener("DOMContentLoaded", function () {
game = new Phaser.Game({
type: Phaser.CANVAS,
parent: "office-parent",
width: 1248, height: 768,          // 视口 = 单房间大小；世界 2112 宽由相机跟随
pixelArt: true,
backgroundColor: "#2a2e3d",
scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
scene: [SceneBoot, SceneOffice]
});
});
Object.defineProperty(window, "__office", { get: function () {
return {
fishState: fishState,
hasBubble: !!bubble,
bubbleText: bubbleText ? bubbleText.text : null,
fishXY: fish ? [Math.round(fish.x), Math.round(fish.y)] : null,
cam: scene && scene.cameras ? [Math.round(scene.cameras.main.scrollX), Math.round(scene.cameras.main.scrollY)] : null,
npcs: npcLayer.length ? npcLayer.map(n => ({ id: n.def.id, state: n.state, x: Math.round(n.spr.x), y: Math.round(n.spr.y), tint: n.spr.tintTopLeft })) : [],
lastPointer: lastPointer,
sceneRef: scene,   // 调试：直接访问 scene（displayList 排查用）
hostKeys: scene && scene.hostMap ? Object.keys(scene.hostMap).length : 0,
hostHas: function (id) { return scene && scene.hostMap ? !!scene.hostMap[id] : null; },
toggleSwitch: function (wx, wy) { return toggleSwitchAt(wx, wy); },   // v50：点墙上的灯开关（调试/自动化）
plan: curPlan ? { i: curPlan.i, len: curPlan.path && curPlan.path.length, local: !!curPlan.local, task: curPlan.task } : null,
ws: ws ? ws.readyState : -1,
blockedCount: scene && scene.grid ? scene.grid.flat().filter(Boolean).length : 0,
texInfo: scene && scene.textures && scene.textures.exists("whale") ? (function () {
var t = scene.textures.get("whale");
var names = t.getFrameNames();
return { total: names.length, last: names.slice(-3), sw: t.source[0].width, sh: t.source[0].height };
})() : null,
fx: scene && scene.fxDirect ? {
pc: scene.fxDirect.pc ? { isSprite: !!scene.fxDirect.pc.spr.anims, playing: scene.fxDirect.pc.spr.anims ? scene.fxDirect.pc.spr.anims.isPlaying : false, frame: scene.fxDirect.pc.spr.frame.name } : null,
printer: scene.fxDirect.printer ? { isSprite: !!scene.fxDirect.printer.spr.anims, playing: scene.fxDirect.printer.spr.anims ? scene.fxDirect.printer.spr.anims.isPlaying : false, frame: scene.fxDirect.printer.spr.frame.name } : null
} : null,
props: scene && scene.props ? scene.props.filter(function (p) { return !p.isFish; }).map(function (p) {
return { a: p.key, x: Math.round(p.x), y: Math.round(p.y), depth: Math.round(p.depth), o: p.o, on: p.f && p.f.on || null };
}) : null
};
} });
var gridOverlay = null;
function frameAudit() {
if (!scene || !scene.mapdata) return [];
var bad = [];
scene.mapdata.furniture.forEach(function (f) {
if (f.frame == null || !f.a) return;
var t = scene.textures.get(f.a);
var total = t ? (t.frameTotal || 0) : 0;
if (f.frame >= total) bad.push({ id: f.id || "", asset: f.a, frame: f.frame, frames: total });
});
return bad;
}
function zoneAudit() {
if (!scene || !scene.mapdata || !scene.grid) return null;
var z = scene.mapdata.zones, hm = scene.hostMap || {};
var issues = [], rows = [];
var propTiles = (scene.props || []).filter(function (p) { return !p.isFish; }).map(function (p) {
return { key: p.key, tx: (p.x - TILE / 2) / TILE, ty: (p.y - WALL_H - TILE / 2) / TILE };
});
Object.keys(z).forEach(function (name) {
var zone = z[name], a = zone.anchor || [0, 0];
var ex = Math.round(a[0]), ey = Math.round(a[1]);
var oob = ex < 0 || ey < 0 || ex >= COLS || ey >= ROWS;
if (oob && !zone.decorative) issues.push("区域 " + name + " 的目标格 [" + ex + "," + ey + "] 越出地图 " + COLS + "×" + ROWS + "，A* 会把鱼送出场外");
var blocked = !!(scene.grid[ey] && scene.grid[ey][ex]);
var reached = blocked ? nearestFree(ex, ey) : (oob ? null : { x: ex, y: ey });
var free = [];
for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) {
var nx = ex + dx, ny = ey + dy;
if (nx >= 1 && ny >= 1 && nx < COLS && ny < ROWS && !scene.grid[ny][nx]) free.push([nx, ny]);
}
var row = {
zone: name, anchor: a, target: [ex, ey], blocked: blocked, oob: oob,
reached: reached ? [reached.x, reached.y] : null, free: free,
sit: null
};
if (blocked && !zone.decorative) issues.push("区域 " + name + " 的锚点落在阻挡格里，A* 会漂到 " + (reached ? reached.x + "," + reached.y : "无解"));
if (!reached && !zone.decorative) issues.push("区域 " + name + " 周围 3 格内没有可走格");
if (zone.sit) {
var h = hm[zone.sit.host];
if (!h) { issues.push("区域 " + name + " 的坐席宿主 " + zone.sit.host + " 不存在"); row.sit = { host: zone.sit.host, exists: false }; }
else {
var htx = (h.x - TILE / 2) / TILE, hty = (h.y - WALL_H - TILE / 2) / TILE;
var d = Math.sqrt(Math.pow(htx - a[0], 2) + Math.pow(hty - a[1], 2));
row.sit = { host: zone.sit.host, exists: true, hostTile: [Number(htx.toFixed(2)), Number(hty.toFixed(2))], dist: Number(d.toFixed(2)), dx: zone.sit.dx || 0, dy: zone.sit.dy || 0, lounge: !!zone.sit.lounge };
if (d > 2.6) issues.push("区域 " + name + " 锚点距坐席 " + zone.sit.host + " " + d.toFixed(1) + " 格，落座 tween 会拉得很远");
}
}
if (zone.expect && zone.expect.length) {
var found = [];
zone.expect.forEach(function (asset) {
var best = null;
propTiles.forEach(function (p) {
if (p.key !== asset) return;
var pd = Math.sqrt(Math.pow(p.tx - a[0], 2) + Math.pow(p.ty - a[1], 2));
if (!best || pd < best.d) best = { asset: asset, d: pd };
});
if (best) found.push(best);
});
var ok = found.some(function (m) { return m.d <= 2.2; });
row.expect = { want: zone.expect, found: found.map(function (m) {
return m.asset + "@" + m.d.toFixed(1) + "格";
}), ok: ok };
if (!ok) issues.push("区域 " + name + " 锚点 2.2 格内找不到期望家具 [" + zone.expect.join("/") + "]" +
(found.length ? "（最近：" + found.map(function (m) { return m.asset + " " + m.d.toFixed(1) + "格"; }).join("、") + "）" : "（场景无此素材）"));
} else if (zone.feature) {
row.expect = { feature: zone.feature, exists: !!scene.mapdata[zone.feature] };
if (!scene.mapdata[zone.feature]) issues.push("区域 " + name + " 的背景设施 " + zone.feature + " 未配置");
}
rows.push(row);
});
Object.keys(STATE_MAP).forEach(function (k) {
if (!z[STATE_MAP[k].zone]) issues.push("状态 " + k + " 引用了不存在的区域 " + STATE_MAP[k].zone);
});
var ids = Object.create(null);
scene.mapdata.furniture.forEach(function (f) {
if (f.id) { if (ids[f.id]) issues.push("家具 id 重复: " + f.id); ids[f.id] = 1; }
if (f.on && !hm[f.on]) issues.push("家具 " + (f.id || f.a) + " 的 on 宿主 " + f.on + " 不存在");
});
var states = Object.keys(STATE_MAP).map(function (k) {
var cfg = STATE_MAP[k], zz = z[cfg.zone];
return {
state: k, verb: cfg.verb, zone: cfg.zone,
label: zz ? (zz.label || cfg.zone) : "区域缺失",
target: zz ? [Math.round(zz.anchor[0]), Math.round(zz.anchor[1])] : null,
sit: !!(zz && zz.sit),
expected: zz && zz.expect ? zz.expect : (zz && zz.feature ? [zz.feature] : [])
};
});
return { zones: rows, issues: issues, frames: frameAudit(), states: states };
}
function toggleGrid(force) {
if (!scene || !scene.grid) return false;
if (gridOverlay && force !== true) { gridOverlay.destroy(); gridOverlay = null; return false; }
if (gridOverlay) return true;
var g = scene.add.graphics().setDepth(65000);   // 高于环境遮罩，调试层始终清晰
for (var y = 0; y < ROWS; y++) {
for (var x = 0; x < COLS; x++) {
if (!scene.grid[y][x]) continue;
g.fillStyle(0xff4d4f, 0.30);
g.fillRect(x * TILE + 1, WALL_H + y * TILE + 1, TILE - 2, TILE - 2);
}
}
Object.keys(scene.mapdata.zones).forEach(function (k) {
var a = scene.mapdata.zones[k].anchor;
g.fillStyle(0x4dabf7, 0.95);
g.fillCircle((a[0] + 0.5) * TILE, WALL_H + (a[1] + 0.5) * TILE, 5);
});
gridOverlay = g;
return true;
}
function hubBase() {
if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(location.host)) return "";
var p = new URLSearchParams(location.search).get("hub") || "4321";
return "http://127.0.0.1:" + (/^\d{2,5}$/.test(p) ? p : "4321");
}
function hubFetch(p, opt) {
var base = hubBase();
if (!base) return Promise.reject(new Error("线上未开放 hub HTTP 接口（Nginx 只反代 /office-ws/）"));
return fetch(base + p, opt);
}
Object.defineProperty(window, "__officeCtl", {
value: {
states: function () {
return Object.keys(STATE_MAP).map(function (k) {
return { id: k, verb: STATE_MAP[k].verb, zone: STATE_MAP[k].zone, mood: STATE_MAP[k].mood };
});
},
hubStatus: function () { return hubFetch("/api/status").then(function (r) { return r.json(); }); },
hubBase: hubBase,
zones: function () { return scene && scene.mapdata ? Object.keys(scene.mapdata.zones) : []; },
rooms: function () { return ROOMS.map(function (r) { return r.id; }); },
emit: function (state, task, detail, zone) {
onState({ state: state, task: task || "", detail: detail || "", ts: Date.now() }, zone, true);
return true;
},
pushHub: function (state, task, detail) {
return hubFetch("/api/event", {
method: "POST", headers: { "Content-Type": "application/json" },
body: JSON.stringify({ state: state, task: task || "", detail: detail || "" })
});
},
setLights: function (on) {
if (!scene) return false;
lightsManual = true;
setLights(scene, !!on);
if (scene.switchLever && scene.switchY != null) scene.switchLever.y = scene.switchY + (on ? -4 : 4);
return lightsOn;
},
setWeather: function (w) { if (!scene) return false; setWeather(scene, w === "rainy" ? "rainy" : "sunny"); return weather; },
toggleRoads: function () { return toggleRoads(); },
roadsVisible: function () { return roadsVisible; },
farm: function () { return farmSummary(); },
farmAct: function (act, slot) { return farmAct(act, slot); },
farmGrowAll: function () {           // 调试：把所有已种作物直接催熟（走查收割用）
if (!farm) farmLoad();
farm.plots.forEach(function (p) { if (p.crop) { p.progress = 1; p.watered = true; } });
farmSave(); drawFarm();
return farmSummary();
},
pond: function () { return { fishing: !!fishing, bite: !!(fishing && fishing.bite), fish: farm ? farm.fish : 0, shadows: fishShadows.length }; },
fishOnce: function () {
if (!fishing) fishStart();
if (fishing && !fishing.bite) { fishing.t = fishing.wait; fishTick(0.01); }
return fishReel();
},
kitchen: kitchenSummary,
cook: cook,
cookAuto: function () { var t = cookAuto(); if (t) renderCookPanel(); return t || "（食材不够）"; },
setEditMode: function (on) { return setEditMode(on); },
editState: function () {
var realCount = customFurniture.filter(function (f) { return !isHideEntry(f); }).length;
return {
on: editMode, tool: editTool, asset: editAsset, count: realCount,
hidden: hiddenCount(),
hub: hubMapOk === true,          // 真实连通性（旧版是 !!hubMapBase()，恒为 true，会撒谎）
hubChecked: hubMapOk, hubError: hubMapErr,
mirror: mirrorPending,           // 有改动还没写进 hub
ws: !!ws && ws.readyState === 1,
mapUrl: hubMapUrl()
};
},
editSetTool: function (t) { setEditTool(t); return editTool; },
editSetAsset: function (a) { setEditAsset(a); return editAsset; },
editSave: function () { saveEditMap(false, null, function (ok, err) { addEditLog(ok ? "已保存" : "hub 未同步：" + err); }); return true; },
mapReload: function () {
probeMapHub(function (ok, j) {
if (ok) { mirrorFlushTried = false; applyCustomMap((j && j.furniture) || [], true); }
});
return true;
},
neighborRooms: function () { return NEIGHBOR_HOMES.map(function (h) { return { id: "nb-" + h.id, home: h.home, cx: h.cx, cy: h.cy }; }); },
gotoNeighbor: function (id) {
var b = document.querySelector('.room-tab[data-room="nb-' + id + '"]');
if (b) { b.click(); return true; }
return false;
},
camDrag: function (on) {
var b = document.getElementById("cam-drag-btn");
if (!b) return camDragOn;
if (typeof on === "boolean" && on !== camDragOn) b.click();
return camDragOn;
},
gotoRoom: function (id) {
var b = document.querySelector('.room-tab[data-room="' + id + '"]');
if (b) { b.click(); return true; }
return false;
},
showCard: function (hostId) { if (scene) { showInfoCard(hostId, 300, 200); return !!INFO_CARDS[hostId]; } return false; },
localAct: function (key, instant) {
var e = findLocalEvent(key);
if (!e || !scene || !fish) return false;
stopIdleLife(); unsit(); exitNeighborHome();
noteLocalEvent(e.key);
goLocal(e.zone, localText(e), e.act, e.face, !!instant, statFillFor(e.key));
startIdleLife(9000);
return true;
},
localEvents: function () {
return LOCAL_EVENTS.map(function (e) {
return { key: e.key, zone: e.zone, label: e.label, icon: e.icon,
text: e.text, act: e.act, face: e.face, room: e.room };
});
},
setWs: function (url) { reconnectWS(url); return getWsUrl(); },
wsUrl: function () { return getWsUrl(); },
toggleGrid: toggleGrid,
frameAudit: frameAudit,
zoneAudit: zoneAudit,
gridMap: function () {
return scene && scene.grid ? scene.grid.map(function (r) {
return r.map(function (v) { return v ? 1 : 0; });
}) : null;
},
resetEvidence: function () {
try { localStorage.removeItem("office_evidence"); } catch (e) {}
evidence.done = 0; evidence.current = ""; evidence.lastTask = "";
redrawBoard(); refreshTrophies();
return true;
},
activity: function () {
var groups = shiftsToday(), cur = currentShift(groups);
return {
rows: actRows.slice(),
current: { state: actCur.state, task: actCur.task, at: actCur.at },
tab: actTab, folded: actFolded,
dom: {
list: document.querySelectorAll("#act-list li").length,
plan: document.querySelectorAll("#act-plan li").length
},
now: bjClock(Date.now()),
activeShift: cur.active ? shiftName(cur.active) : null,
nextShift: cur.next ? shiftName(cur.next) : null,
why: (document.getElementById("act-why") || {}).innerText || ""
};
},
schedule: function () {
var groups = shiftsToday(), cur = currentShift(groups);
return {
tz: SCHEDULE.tz, wake: SCHEDULE.wake, now: bjClock(Date.now()),
groups: groups, active: cur.active ? shiftName(cur.active) : null, next: cur.next ? shiftName(cur.next) : null
};
},
resetActivity: function () {
try { localStorage.removeItem(ACT_STORE); } catch (e) {}
actRows = []; actCur = { state: "", task: "", at: 0 };
renderEvents(); renderPlan();
return true;
},
setActivityTab: function (which) { actSetTab(which); return actTab; },
foldActivity: function (folded) { actSetFold(folded !== false); return actFolded; },
screenshot: function () {
var c = document.querySelector("#office-parent canvas");
return c ? c.toDataURL("image/png") : null;
},
snapshot: function () {
var c = document.querySelector("#office-parent canvas");
return {
ready: !!scene,
fishState: fishState,
visiting: visitingHome ? visitingHome.id : null,   // 正在串门哪户（调试走查用）
localEvent: lastLocalKey,
fish: fish ? { x: Math.round(fish.x), y: Math.round(fish.y), face: fish.lastFace, sitting: !!fish.sitting } : null,
sprite: fish && fish.bodySpr ? {
anim: fish.bodySpr.anims.currentAnim ? fish.bodySpr.anims.currentAnim.key : null,
frame: fish.bodySpr.frame.name,
angle: fish.bodySpr.angle,
scale: [Number(fish.bodySpr.scaleX.toFixed(2)), Number(fish.bodySpr.scaleY.toFixed(2))]
} : null,
lightsOn: lightsOn, lightsManual: lightsManual, ambient: Number(ambientCur.toFixed(2)), weather: weather,
ws: { url: getWsUrl(), readyState: ws ? ws.readyState : -1 },
fps: scene ? Math.round(scene.game.loop.actualFps) : 0,
props: scene ? scene.props.length : 0,
assets: MAN ? Object.keys(MAN).length : 0,
blocked: scene && scene.grid ? scene.grid.flat().filter(Boolean).length : 0,
evidence: { done: evidence.done, current: evidence.current },
activity: { rows: actRows.length, state: actCur.state, tab: actTab, folded: actFolded },
camera: scene ? { scrollX: scene.cameras.main.scrollX, scrollY: scene.cameras.main.scrollY, zoom: scene.cameras.main.zoom } : null,
statusbar: document.querySelector(".statusbar") ? document.querySelector(".statusbar").innerText.replace(/\s+/g, " ").trim() : "",
bubble: bubbleText ? bubbleText.text : null,
canvas: c ? { w: c.width, h: c.height, cssW: Math.round(c.getBoundingClientRect().width) } : null,
farm: farmSummary(),
fishing: fishing ? { bite: fishing.bite, t: Number(fishing.t.toFixed(1)) } : null,
roads: roadsVisible,
camDrag: camDragOn,
edit: { on: editMode, tool: editTool, asset: editAsset, count: customFurniture.length, hub: hubMapOk, hubError: hubMapErr, mirror: mirrorPending },
frameIssues: frameAudit(),
gridOverlay: !!gridOverlay
};
}
}
});
})();
