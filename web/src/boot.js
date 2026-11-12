  // ---------- 全局 ----------
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

  // ---------- 启动场景 ----------
  /* 资源加载兜底：Phaser 的 loaderror 不会阻止 complete 事件，缺纹理会让 office 场景
   * 连锁抛错，而 #loading 遮罩永远停在「办公室布置中…」。这里统一收集失败项，
   * 在 complete 时拦下启动，并把可读原因写回遮罩。 */
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
    this.load.json("mapdata", "map.json?v=f8e26c78");
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
    // v39：地图贴图（地板/墙/路/水/农田/天空/窗）——生成脚本 office/tools/gen_tiles.mjs
    TILE_MATS.forEach(function (mat) {
      this.load.image("tile-" + mat, "assets/tiles/" + mat + ".png?v=" + TILE_V);
    }, this);
    // v39.2：把"窗"注册成一个普通家具资产（贴图复用 tiles/window.png），
    // 这样它就能像其它物品一样被随意摆放/移动/删除，而不是只能整体隐藏。
    this.load.image("window", "assets/tiles/window.png?v=" + TILE_V);
    // v50：灯的开关（关 / 开 两张，当"物品"摆；点它切对应房间的灯）
    this.load.image("switch", "assets/tiles/switch-off.png?v=" + TILE_V);
    this.load.image("switch-on", "assets/tiles/switch-on.png?v=" + TILE_V);
    this.load.image("lamp-off", "assets/tiles/lamp-off.png?v=" + TILE_V);
    this.load.image("lamp-on", "assets/tiles/lamp-on.png?v=" + TILE_V);
    this.load.image("window-night", "assets/tiles/window-night.png?v=" + TILE_V);
    // v50：开关注册成一件"物品"（贴图来自 tiles/switch-off.png，开启时换成 switch-on）
    /* v52：会变化的素材 —— states 里写"在什么条件下换哪张贴图"，运行时统一切换 */
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

  // ---------- 主场景 ----------
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
    // 自定义层（v37）：hub 的 hello 可能比场景先到（那时 scene 还是 null，应用不了），
    // 所以这里补一次本机镜像；再探一次 hub，让调试台/编辑面板能显示真实连通状态。
    try { adoptLocalMirror(); } catch (e) {}
    // 排障入口：本地镜像（localStorage）和 hub 存档打架时用——
    // 控制台跑 __officeMapReset() 清空本机镜像并重新以 hub 为准；__officeMapInfo() 看两边状态
    window.__officeMapInfo = function () {
      try {
        var m = JSON.parse(localStorage.getItem("office_map_custom_v1") || "null");
        return { local: m ? { count: (m.furniture || []).length, updatedAt: new Date(m.updatedAt || 0).toLocaleString(), pending: !!m.pending } : null,
                 hubCount: (window.__officeHubCount != null) ? window.__officeHubCount : "未知（连接 hub 后可见）" };
      } catch (e) { return { error: String(e) } }
    };
    // __officeMapSync 在 mapedit.js 内部挂载（forceSyncMirror 是模块私有函数）
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
    // v82：暗角层整个移除（用户反馈缩放时黑色遮罩反复出现，宁可不要氛围也要干净画面）。
    this.trophyLayer = this.add.container(0, 0).setDepth(30);      // 灯光：初始 = 关灯（hello 初始态"办公室还没开灯"）
    // 相机：视口 1248x768，世界 2112x768 → 跟随鱼 + 边界钳制
    this.cameras.main.setBounds(0, 0, W, H);
    if (!editorMode) this.cameras.main.startFollow(fish, true, 0.08, 0.08);   // 编辑器里镜头不跟鱼
    // 死区：鱼在中间 1/3 移动时相机不动，减少晃动
    this.cameras.main.setDeadzone(300, 300);
    buildRoomTabs(this);    // 房间切换 UI
    buildWeather(this);     // 天气层
    buildNPCs(this);        // 小镇居民（方案 §3）
    farmLoad();             // 农场/鱼塘/料理（v36）：读档 + 画田地 + 塘面鱼影
    drawFarm(this);
    buildPondLife(this);
    // loading 提前隐藏（评审 P1-3）：场景本体已就绪，WS/事件后续异步补——中途异常不再滞留"办公室布置中…"
    var loading = document.getElementById("loading");
    if (loading) loading.classList.add("hide");
    var ppClose = document.getElementById("pp-close");
    if (ppClose) ppClose.onclick = hidePerfPanel;
    bindClick(this);
    connectWS();
    if (!editorMode) startIdleLife(1500);   // 独立编辑器里鱼不用自己溜达
    if (editorMode) { try { setEditMode(true); } catch (e) { console.warn("[editor] 进入编辑模式失败", e); } }
  };

  // ---------- 天气系统（场景清单：天气层；玩家干预：R 键切换 晴/雨） ----------
  var weather = "sunny";   // sunny | rainy
  var rainParts = [];
  function buildWeather(s) {
    for (var i = 0; i < 80; i++) {
      var r = s.add.rectangle(Math.random() * W, Math.random() * H, 1.5, 10, 0x9db8e8, 0.5).setDepth(55000);
      r.visible = false;
      rainParts.push(r);
    }
    // v82.3：4 倍视口大 + scrollFactor 0 —— zoom<1 时缩放层视觉缩小，超大尺寸保证任何 zoom 都盖满；
    // 位置由 tickWeather 每帧锚相机中点（zoomchange 在 buildWeather 之前不可靠，v82.2 曾因此失效）
    s.overcast = s.add.rectangle(0, 0, 1248, 768, 0x3a4a66, 0.22).setOrigin(0.5).setDepth(54000).setVisible(false).setScrollFactor(0);
    s.overcast.setDisplaySize(1248 * 4, 768 * 4);
  }
  function setWeather(s, w) {
    weather = w;
    rainParts.forEach(function (r) { r.visible = (w === "rainy"); });
    if (s.overcast) s.overcast.setVisible(w === "rainy" || w === "cloudy");
    // v39.5：画死的旧窗已删除，天气不再需要重绘窗户
  }
  // P6 真实天气接入：hub 每小时广播 wttr.in 实况。snowy 暂按 sunny（无雪演出），
  // cloudy 开阴天层不下雨，rainy 全套雨演。R 键手动切换仍可用（覆盖真实值直到下次广播）。
  window.__officeSetWeather = function (w) {
    if (w !== "sunny" && w !== "rainy" && w !== "cloudy" && w !== "snowy") return;
    if (scene) setWeather(scene, w === "snowy" ? "sunny" : w);
  };
  function tickWeather(s) {
    // 阴天层锚相机中点（每帧校正，zoom/滚动变化都稳）
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


