  /* ---------- 小地图（v2.7-c）----------
   *
   * 为什么需要：相机视口只有 1248×768 = 26×16 格，而地图 56×30 格（2688×1488px）——
   * 一次只能看到 24.8% 的面积。她的日程横跨卧室(5,5.6)→工位(9,23.6)→花园(31.5,12)→市集(49.6,14.2)，
   * 所以观众有 3/4 的时间在看一个空房间。这张图回答的只有一句话：「她现在在哪」。
   *
   * 设计取舍：
   *   - 不逐格画（1680 格 × 每 500ms 太浪费）：房间用色块，池塘/农田用形状，只画一次到离屏 canvas，之后整块 blit
   *   - 动态只有 5 个点：她（蓝）、3 个 NPC（白）、视口框（半透明矩形）
   *   - 点击地图 → 直接把镜头 pan 过去（并停跟随），这是最快回答"那边发生了什么"的方式
   */
  var Minimap = (function () {
    var W = 168, H = 90;                 // 56:30 等比（168/56 = 3px 一格）
    var T3 = W / 56;                     // 每格像素
    var cv = null, cx = null, base = null, bx = null;
    var timer = null, folded = false;
    var COLORS = {                       // 室内暖木 / 室内瓷砖 / 户外草地 / 街道石板
      office: "#b08a5e", bedroom: "#b08a5e", kitchen: "#9fb0b8", bath: "#9fb0b8",
      nbCat: "#b08a5e", nbChief: "#b08a5e", nbDoc: "#b08a5e"
    };

    function roomRects() {
      // furniture.js 定义的开关归属矩形就是房间矩形（真源）；这里只在它还没加载时兜底
      return window.__officeRoomRects || {
        office: [0, 15, 26, 15], bedroom: [1, 1, 9, 13], bath: [10, 1, 6, 13],
        kitchen: [16, 1, 9, 13], nbCat: [39, 19, 8, 10], nbChief: [47, 19, 4, 10], nbDoc: [51, 19, 4, 10]
      };
    }

    /* 底图只画一次：户外底色 → 街道 → 房间色块 → 农田 → 池塘 → 网格线 */
    function paintBase() {
      base = document.createElement("canvas");
      base.width = W * 2; base.height = H * 2;
      bx = base.getContext("2d");
      bx.scale(2, 2);
      bx.imageSmoothingEnabled = false;
      bx.fillStyle = "#7ea86a";                       // 户外草地打底
      bx.fillRect(0, 0, W, H);
      bx.fillStyle = "#a9a49a";                       // 街道：x≥26 的下半（主街 y16-18）
      bx.fillRect(26 * T3, 16 * T3, (56 - 26) * T3, 3 * T3);
      var r = roomRects();
      Object.keys(r).forEach(function (k) {
        var q = r[k];
        bx.fillStyle = COLORS[k] || "#b08a5e";
        bx.fillRect(q[0] * T3, q[1] * T3, q[2] * T3, q[3] * T3);
      });
      bx.fillStyle = "#8fbf5a";                       // 农田 x28-32 / y22-25
      bx.fillRect(28 * T3, 22 * T3, 5 * T3, 4 * T3);
      bx.fillStyle = "#4c8fd6";                       // 池塘（椭圆）中心 (36.7, 24.2)，半径 (1.5, 2)
      bx.beginPath();
      bx.ellipse(36.7 * T3, 24.2 * T3, 1.5 * T3, 2 * T3, 0, 0, Math.PI * 2);
      bx.fill();
      bx.strokeStyle = "rgba(0,0,0,.16)";             // 房间轮廓，让分区看得清
      bx.lineWidth = 1;
      Object.keys(r).forEach(function (k) {
        var q = r[k];
        bx.strokeRect(q[0] * T3 + .5, q[1] * T3 + .5, q[2] * T3 - 1, q[3] * T3 - 1);
      });
    }

    function dot(x, y, r, fill, ring) {
      cx.beginPath();
      cx.arc(x * T3, y * T3, r, 0, Math.PI * 2);
      cx.fillStyle = fill;
      cx.fill();
      if (ring) { cx.lineWidth = 1; cx.strokeStyle = ring; cx.stroke(); }
    }

    function draw() {
      if (!cv || folded) return;
      if (typeof scene === "undefined" || !scene || !scene.mapdata) return;
      if (!base) paintBase();
      cx.clearRect(0, 0, W, H);
      cx.drawImage(base, 0, 0, W, H);

      // 视口框：用相机真实 worldView，缩放到小地图坐标
      try {
        var vw = scene.cameras.main.worldView;
        cx.strokeStyle = "rgba(255,255,255,.9)";
        cx.lineWidth = 1;
        cx.strokeRect(vw.x / TILE * T3 + .5, (vw.y - WALL_H) / TILE * T3 + .5, vw.width / TILE * T3, vw.height / TILE * T3);
      } catch (e) {}

      // NPC 白点（__office.npcs 是像素坐标）
      var ns = (window.__office && window.__office.npcs) || [];
      ns.forEach(function (n) { if (n && n.x != null) dot(n.x / TILE, (n.y - WALL_H) / TILE, 1.8, "#ffffff", "rgba(0,0,0,.45)"); });

      // 她：蓝点 + 一圈呼吸光，最容易一眼找到
      var f = window.__office && window.__office.fishXY;
      if (f) {
        var fx = f[0] / TILE, fy = (f[1] - WALL_H) / TILE;
        var t = (Date.now() % 1600) / 1600;
        cx.beginPath(); cx.arc(fx * T3, fy * T3, 3 + t * 4, 0, Math.PI * 2);
        cx.fillStyle = "rgba(43,108,176," + (0.28 * (1 - t)).toFixed(3) + ")"; cx.fill();
        dot(fx, fy, 2.6, "#2b6cb0", "#ffffff");
      }
    }

    function toWorld(ev) {
      var rect = cv.getBoundingClientRect();
      var px = (ev.clientX - rect.left) / rect.width * W;
      var py = (ev.clientY - rect.top) / rect.height * H;
      return { x: px / T3 * TILE, y: WALL_H + py / T3 * TILE };
    }

    function onClick(ev) {
      if (typeof scene === "undefined" || !scene || !scene.cameras) return;
      var w = toWorld(ev);
      try {
        stopFollow();
        var b = scene.cameras.main.getBounds();
        scene.cameras.main.pan(
          Math.max(b.x + 60, Math.min(b.right - 60, w.x)),
          Math.max(b.y + 60, Math.min(b.bottom - 60, w.y)),
          420, "Sine.easeInOut"
        );
      } catch (e) {}
      ev.stopPropagation();
    }

    function setFolded(v) {
      folded = !!v;
      var box = document.getElementById("minimap");
      if (box) box.classList.toggle("folded", folded);
      var b = document.getElementById("mm-fold");
      if (b) { b.textContent = folded ? "▸" : "▾"; b.setAttribute("aria-expanded", String(!folded)); }
      try { localStorage.setItem("office_minimap", folded ? "0" : "1"); } catch (e) {}
      if (!folded) draw();
    }

    function init() {
      cv = document.getElementById("mm-canvas");
      if (!cv) return;
      cx = cv.getContext("2d");
      cv.width = W * 2; cv.height = H * 2;
      cx.scale(2, 2);
      cx.imageSmoothingEnabled = false;
      try { if (localStorage.getItem("office_minimap") === "0") folded = true; } catch (e) {}
      cv.addEventListener("click", onClick);
      var b = document.getElementById("mm-fold");
      if (b) b.addEventListener("click", function (e) { e.stopPropagation(); setFolded(!folded); });
      setFolded(folded);
      paintBase();
      // 500ms 足够：她最慢 2.2px/帧（≈130px/s ≈ 2.7 格/s），小地图上一格 3px，肉眼看得到移动
      timer = setInterval(draw, 500);
      draw();
      /* 只读快照：自动走查用（画了几次、她的位置、折叠态） */
      window.__officeMinimap = function () {
        return { folded: folded, w: W, h: H, tile: TILE, drawing: !!timer, size: cv ? [cv.width, cv.height] : null };
      };
    }

    if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", init);
    else init();

    return { draw: draw, setFolded: setFolded, isFolded: function () { return folded; }, _init: init };
  })();
