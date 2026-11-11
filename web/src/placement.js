  /* ============ 渲染核心：基于 bbox 的定位 ============
   * 每个精灵帧内含透明留白；bbox = 内容真实范围 [x,y,w,h]（帧内坐标）。
   * 放置约定：map.json 的 (x,y) 是物品"落脚点"（底部中心的格子坐标）。
   * 叠加物用 "on": "宿主id" + dx/dy：坐标 = 宿主表面点（bbox 顶边中心）+ 偏移，
   * 深度 = 宿主 footY + 1，保证永远画在宿主之上、被更近的家具正确遮挡。
   */
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
      // 宿主 sprite 的 (x,y) 就是其内容底边中心（origin 已按 bbox 校准）：
      //   宿主内容中心世界 x = h.x；内容顶边世界 y = h.y - 宿主内容高度
      // 叠加物：内容中心落在 (h.x+dx, 宿主台面+dy)，dy 从宿主内容顶边往下量
      x = h.x + (f.dx || 0);
      y = (h.y - h.bbox[3]) + (f.dy || 0);
      footY = h.footY + 1;
      depth = footY;
    } else {
      x = f.x * TILE + TILE / 2 + (f.ox || 0);
      // v51：band=true 表示"贴在顶部墙带（0–48px 那条北墙）"，脚点落在墙带底边
      y = f.band ? WALL_H + (f.oy || 0) : (WALL_H + f.y * TILE + TILE / 2 + (f.oy || 0));
      footY = y;
      depth = f.wall ? -5 : footY;
    }
    // 大小关系：内容高度相对 48px 格的期望比例（SCALE_TABLE 给的是"内容渲染高度目标"）
    var cap = SCALE_TABLE[f.a];
    var scale = 1;
    if (cap) {
      // 目标：内容渲染高度 = cap * TILE。当前内容高度 bbox[3] → scale = cap*TILE/bbox[3]
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

  // ---------- 灯光系统 ----------
  /* 场景明暗：ambientCur = 亮度（1=全亮）；遮罩 alpha = 1 - ambientCur。
   * - state=sleeping（或 hello 初始态"还没开灯"）→ 关灯：遮罩 40%（评审建议 35~45%）
   * - 其他状态 → 开灯：遮罩 0
   * - 墙上开关可点击手动切换（手动优先，直到下一次真实状态事件把它带回自动）
   * 注意：旧版把 0.32 当成"遮罩 alpha"传给了亮度，实际得到 68% 黑，夜里几乎全黑。
   */
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

  /* v68：专门给"挖阴影"用的贴图 —— 中心接近全透、边缘 smoothstep 平滑衰减，
   * 这样灯照出来的洞是柔和过渡，不会有"一圈硬边"。 */
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
    /* v56：原来用 triangle/circle 画死的 3 盏吊灯（墙带上的橙色三角）也删掉了，
     * 需要灯就用物品层的 wall-lamp / switch，或光照层的自定义光源。 */
    // 灯光表达（v33 恢复 ADD 光晕池，用户拍板；α 压低避免刺眼）
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
    // 窗边冷光（柔和）——主窗在办公室南墙上方
    var moon = s.add.image((s.mapdata.window.tx + 1) * TILE, WALL_H + 16.6 * TILE, lightPoolTex)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDisplaySize(4.5 * TILE, 6 * TILE)
      .setAlpha(roomLights.office ? 0.14 : 0.05)
      .setDepth(49999)
      .setTint(0xbfddf5);
    moon.room = "office";
    s.moonPool = moon;

    /* v39：路灯的"光源定位"（建一圈 ADD 光圈标出每盏路灯位置）已按要求去掉 —— 灯只留素材本身 */

    /* 每房间暗色遮罩（v31 用户反馈：开关只影响本房间亮度）
     * office: rows 16-29 / bedroom: cols 1-9 rows 1-14 / bath: cols 10-15 rows 1-14 / kitchen: cols 17-25 rows 1-14 */
    /* v42：内置 4 个房间矩形遮罩退休 —— 夜间暗度统一由"阴影区域"（mapedit.js 的 shadowRegions）绘制，
     * 这样每一块都能单独改名/移动/删除/分别设置"夜/开灯/白天"三种浓度。这里只留空壳给旧代码判空。 */
    s.roomOverlays = {};

    // 环境遮罩：全屏黑 image，alpha = 夜间基础暗度（昼夜真实时间），开灯房间再被 roomOverlays 单独照亮
    var cv = s.textures.createCanvas("ambientcv", W, H);
    var ctx = cv.getContext();
    ctx.fillStyle = "#0a1020";
    ctx.fillRect(0, 0, W, H);
    cv.refresh();
    // v66：环境光滤镜必须压在灯光之下（原来 60000 > 灯 59200，会把灯光整体压暗）
    /* v72：环境光已并入阴影 RT（59100），这里不再单独建层 */
    ambient = null;
    ambientTarget = 0;   // 全屏滤镜取消（v32）：关灯房间的暗度由 roomOverlays 黑遮罩承担，开灯房间显示原色——不再有"蒙一层"感

    // 每房间一个灯开关（v31 用户反馈：开关只影响本房间）
    // 位置：贴各房间上墙右侧；switchDefs [房间, x格, 说明]
    /* v56：原来的"代码画死的房间灯开关"（米色面板 + 橙色拨杆，depth 60001，自带点击）已删除。
     * 现在用物品层里的 switch / wall-lamp 素材，可摆放、可拖动、可删。 */
  }

  /* 路灯地灯圈已删除（v39 用户要求：去掉路灯的光源定位） */

  function setLights(s, on) {
    /* 兼容入口：一次性设置全部房间灯（旧调用点），实际亮度走 applyRoomLights */
    lightsOn = on;
    roomLights.office = on; roomLights.bedroom = on; roomLights.kitchen = on; roomLights.bath = on;
    applyRoomLights(s);
  }

  /* 分房间灯光（v31 用户反馈：每房间一个开关只影响本房间；AI 夜间自主开关部分灯） */
  function applyRoomLights(s) {
    if (!s || !s.roomOverlays) return;
    // 各房间遮罩：开灯=ADD 暖提亮片 0.20；关灯=黑遮罩 0.55（切换含 blend/颜色，不能用 tween 渐变 blend——直接 set + alpha tween）
    // v42：房间黑遮罩已并入"阴影区域"模型，这里重画一次即可（每块按 夜/开灯/白天 取各自浓度）
    renderNightShadow(s);
    syncSwitchVisuals(s);   // v50：灯开关的面板/指示灯跟着亮灭
    // 灯池分房间
    (s.lightPools || []).forEach(function (p) {
      var preview2 = (typeof nightCfg !== "undefined") ? nightCfg.preview : "auto";
      // v49：黑夜预览也跟随真实开关，这样"按一下房间灯"能立刻看到灯池亮灭
      var rl = (preview2 === "day") ? false : roomLights[p.room] !== false;
      s.tweens.add({ targets: p, alpha: rl ? p.poolAlpha : 0, duration: editorMode ? 0 : 600 });
    });
  }

  /* v39.5：画死的旧窗已删除（窗改成物品层可摆放的 window），不再需要重绘窗户 */

  /* v72：夜色只维护一个数值 ambientCur，具体合成交给 mapedit.js 的 renderNightShadow
   * （环境光 + 区域暗块 + 灯光挖洞都在那一层 RT 里一次算完，避免两层各自重画导致状态错乱）。 */
  var NIGHT_AMBIENT = 0.42;
  function updateAmbient(s) {
    var pv = (typeof nightCfg !== "undefined") ? nightCfg.preview : "auto";
    var target;
    if (pv === "day") target = 0;
    else if (pv === "night") {
      // 只有显式「黑夜预览」才用自定义强度
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
    // 数值变了才重算整层（renderNightShadow 自己也有签名判断）
    if (Math.abs(ambientCur - prev) >= 0.002 || Math.abs(ambientCur - ambientTarget) < 0.002) {
      try { renderNightShadow(s); } catch (e) {}
    }
  }

  function applyRoomLights(s) {
    if (!s || !s.roomOverlays) return;
    // 各房间遮罩：开灯=ADD 暖提亮片 0.20；关灯=黑遮罩 0.55（切换含 blend/颜色，不能用 tween 渐变 blend——直接 set + alpha tween）
    // v42：房间黑遮罩已并入"阴影区域"模型，这里重画一次即可（每块按 夜/开灯/白天 取各自浓度）
    renderNightShadow(s);
    syncSwitchVisuals(s);   // v50：灯开关的面板/指示灯跟着亮灭
    // 灯池分房间
    (s.lightPools || []).forEach(function (p) {
      var preview2 = (typeof nightCfg !== "undefined") ? nightCfg.preview : "auto";
      // v49：黑夜预览也跟随真实开关，这样"按一下房间灯"能立刻看到灯池亮灭
      var rl = (preview2 === "day") ? false : roomLights[p.room] !== false;
      s.tweens.add({ targets: p, alpha: rl ? p.poolAlpha : 0, duration: editorMode ? 0 : 600 });
    });
  }

  /* v39.5：画死的旧窗已删除（窗改成物品层可摆放的 window），不再需要重绘窗户 */





