  // ---------- A* ----------
  function astar(sx, sy, ex, ey) {
    if (!scene || !scene.grid) return null;
    if (sx === ex && sy === ey) return [{ x: ex, y: ey }];
    // 目标格被堵：找目标周围最近的可达格
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

  // ---------- 鱼（鲸鱼女仆） ----------
  /* whale.png 前 4 行仍是四方向 × 8 帧行走（索引不变），第 4 行起是一整套动作帧。
   * 行号表在 manifest.json / whale.json 的 whale.acts，由 tools/gen_whale.py 生成。 */
  var ACT_RATE = {
    idle: 4, idle_back: 4, typing: 9, typing_back: 9, read: 3, sleep: 2,
    drink: 4, wave: 8, lounge: 2, cheer: 7, sit: 3, think: 3,
    play: 8, eat: 5, dizzy: 8, reach: 5
  };
  // 状态里的 act → 动作行；背对镜头时自动切到背面行
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
    // 容器原点 = 鱼脚点（内容底边中心）。body 的帧中心相对脚点的偏移：
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
    // still(): 停在"当前朝向"那行的第 0 帧（而不是永远 South）
    fish.still = function () {
      body.anims.stop();
      var row = fish.lastFace === "e" ? 1 : fish.lastFace === "w" ? 2 : fish.lastFace === "n" ? 3 : 0;
      body.setFrame(row * 8);
    };
    // 播放一整行动作帧；返回 false 表示精灵表没这一行（老版本资源时兜底到静态朝向帧）
    fish.playAct = function (name) {
      var row = acts[name];
      if (row === undefined) return false;
      body.play("act_" + name, true);
      return true;
    };
    fish.setBadge = function (hex) { badge.fillColor = parseInt(hex.replace("#", ""), 16); };
    s.props.push({ spr: fish, footY: fish.y, isFish: true });
  }

  // ---------- 深度排序（每帧：只调鱼与家具的相对关系） ----------
  function depthSort() {
    if (!scene || !fish) return;
    if (fish.sitting) return;   // 坐进家具时深度已手动指定，不被 y 覆盖
    fish.setDepth(fish.y);
  }
