/* 大肥鱼的办公室 · 调试工作台
 * 由 index.html 的右下角按钮 / D 键 / ?debug=1 动态加载，线上访客不加载。
 * 依赖 office.js 暴露的 window.__officeCtl（只读诊断 + 本地注入 + 场景开关）。
 */
(function () {
  "use strict";
  var C = window.__officeCtl;
  if (!C) { console.error("[office] __officeCtl 未就绪，调试工作台无法启动"); return; }

  /* ---------- 样式 ---------- */
  var css = `
  #dbg-panel{position:fixed;top:14px;right:14px;bottom:14px;width:360px;z-index:100;display:none;flex-direction:column;
    background:var(--card,#fffdf8);color:var(--ink,#151826);border:1px solid var(--line,#d9d3c5);border-radius:12px;
    box-shadow:0 14px 48px rgba(0,0,0,.28);font:12px/1.55 "PingFang SC","Microsoft YaHei",system-ui,sans-serif;overflow:hidden}
  #dbg-panel.open{display:flex}
  .dbg-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line,#d9d3c5);flex:none}
  .dbg-head strong{font-size:13px;letter-spacing:.5px}
  .dbg-head .dbg-sp{flex:1}
  .dbg-pill{font-size:11px;border-radius:10px;padding:1px 8px;border:1px solid var(--line,#d9d3c5);color:var(--muted,#5a5d6b)}
  .dbg-pill.on{background:#e6f7ec;border-color:#9ad6ae;color:#197c3c}
  .dbg-pill.off{background:#fff0e6;border-color:#f0c19a;color:#a8531b}
  .dbg-x{border:0;background:transparent;color:inherit;font-size:20px;line-height:1;cursor:pointer;padding:0 4px}
  .dbg-body{flex:1;overflow:auto;padding:4px 12px 14px}
  #dbg-panel details{border-bottom:1px solid var(--line,#d9d3c5);padding:6px 0}
  #dbg-panel summary{cursor:pointer;font-weight:600;font-size:12px;padding:4px 0;user-select:none}
  .dbg-sec{padding:6px 0 8px}
  .dbg-label{display:block;color:var(--muted,#5a5d6b);margin:6px 0 3px;font-size:11px}
  .dbg-input,.dbg-select{width:100%;box-sizing:border-box;padding:5px 7px;border:1px solid var(--line,#d9d3c5);
    border-radius:6px;background:var(--paper,#f4f1ea);color:var(--ink,#151826);font:12px inherit;font-size:12px}
  .dbg-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}
  .dbg-btn{border:1px solid var(--line,#d9d3c5);background:var(--paper,#f4f1ea);color:var(--ink,#151826);
    border-radius:6px;padding:5px 9px;font-size:11.5px;cursor:pointer;white-space:nowrap}
  .dbg-btn:hover{border-color:#4a6cf7;color:#4a6cf7}
  .dbg-btn.primary{background:#4a6cf7;border-color:#4a6cf7;color:#fff}
  .dbg-btn.primary:hover{background:#3f5fe0;color:#fff}
  .dbg-btn.danger{color:#c92a2a}
  .dbg-quick{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;max-height:150px;overflow:auto;margin-top:6px}
  .dbg-quick .dbg-btn{padding:4px 2px;text-align:center;font-size:11px}
  .dbg-pre{margin:6px 0 0;padding:7px 8px;border-radius:6px;background:#11141f;color:#d7dbe8;
    font:11px/1.5 ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-all;max-height:130px;overflow:auto}
  #dbg-audit-out{max-height:270px}
  .dbg-kv{display:grid;grid-template-columns:1fr 1fr;gap:5px}
  .dbg-kv div{background:var(--paper,#f4f1ea);border:1px solid var(--line,#d9d3c5);border-radius:6px;padding:4px 7px;min-width:0}
  .dbg-kv span{display:block;color:var(--muted,#5a5d6b);font-size:10.5px}
  .dbg-kv b{display:block;font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .dbg-warn{color:#c92a2a;font-weight:600}
  .dbg-log{height:150px;overflow:auto;background:#11141f;color:#d7dbe8;border-radius:6px;padding:6px 8px;
    font:11px/1.5 ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-all}
  .dbg-log .e{color:#ff8787}.dbg-log .w{color:#ffd43b}.dbg-log .i{color:#a5d8ff}
  /* 宽屏并排：面板打开时页面让出右侧，不遮挡画布/状态条/说明文字。
   * 画布固定 1248:768，按视口高度反算内容宽度上限（210px ≈ header+状态条+说明），
   * 避免超宽屏把画布撑到 900px 高、把状态条挤到首屏外；宽度由可用空间与上限取小。 */
  @media (min-width:1200px){body.dbg-open .wrap{max-width:calc((100vh - 210px) * 1248 / 768 + 32px);margin:0 392px 0 16px}}
  @media (max-width:600px){#dbg-panel{left:8px;right:8px;top:8px;bottom:8px;width:auto}}
  `;
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  /* ---------- DOM ---------- */
  var panel = document.createElement("aside");
  panel.id = "dbg-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "办公室调试工作台");
  panel.setAttribute("aria-modal", "false");
  panel.setAttribute("tabindex", "-1");
  panel.innerHTML = `
  <div class="dbg-head">
    <strong>🛠 调试工作台</strong>
    <span class="dbg-pill" id="dbg-conn">检测中</span><span class="dbg-sp"></span>
    <button class="dbg-x" id="dbg-close" title="关闭 (Esc)" aria-label="关闭调试工作台">×</button>
  </div>
  <div class="dbg-body">
    <details open><summary>① 连接 / WebSocket</summary><div class="dbg-sec">
      <label class="dbg-label">WS 地址（本地默认直连 hub:4321，可用 ?ws= 覆盖）</label>
      <input class="dbg-input" id="dbg-ws" spellcheck="false">
      <div class="dbg-row">
        <button class="dbg-btn primary" id="dbg-ws-go">连接</button>
        <button class="dbg-btn" id="dbg-ws-reset">恢复默认</button>
        <button class="dbg-btn" id="dbg-hub">查 hub 状态</button>
      </div>
      <pre class="dbg-pre" id="dbg-hub-out">点「查 hub 状态」看当前状态 / 围观人数 / 最近事件</pre>
    </div></details>

    <details open><summary>② 事件注入（模拟 agent 打点）</summary><div class="dbg-sec">
      <label class="dbg-label">状态</label><select class="dbg-select" id="dbg-state"></select>
      <label class="dbg-label">任务名</label><input class="dbg-input" id="dbg-task" value="调试：写文章《测试》">
      <label class="dbg-label">详情</label><input class="dbg-input" id="dbg-detail" value="来自调试工作台">
      <label class="dbg-label">目标区域（留空 = 按状态默认）</label><select class="dbg-select" id="dbg-zone"></select>
      <div class="dbg-row">
        <button class="dbg-btn primary" id="dbg-emit">本地注入</button>
        <button class="dbg-btn" id="dbg-push">推送到 hub</button>
        <button class="dbg-btn" id="dbg-seq">▶ 模拟一轮工作</button>
      </div>
      <label class="dbg-label">一键切换常用状态</label>
      <div class="dbg-quick" id="dbg-quick"></div>
    </div></details>

    <details open><summary>③ 场景控制</summary><div class="dbg-sec">
      <div class="dbg-row">
        <button class="dbg-btn" id="dbg-rain">🌧 晴/雨切换</button>
        <button class="dbg-btn" id="dbg-grid">▦ 碰撞格叠加</button>
        <button class="dbg-btn" id="dbg-roads">🛣 道路层</button>
      </div>
      <label class="dbg-label">农场 / 鱼塘 / 料理（v36）</label>
      <div class="dbg-row">
        <button class="dbg-btn" id="dbg-farm-act">🌾 农活一轮</button>
        <button class="dbg-btn" id="dbg-farm-grow">⚡ 催熟全部</button>
        <button class="dbg-btn" id="dbg-fish">🎣 钓一条</button>
        <button class="dbg-btn" id="dbg-cook">🍳 做道菜</button>
      </div>
      <pre class="dbg-pre" id="dbg-farm-out">点上面按钮试农活/钓鱼/料理；farm()/kitchen() 可看全量状态</pre>
      <label class="dbg-label">地图编辑（v37）</label>
      <div class="dbg-row">
        <button class="dbg-btn primary" id="dbg-edit">✏ 编辑地图</button>
        <button class="dbg-btn" id="dbg-map-reload">↺ 重载自定义层</button>
      </div>
      <label class="dbg-label">镜头 / 走位</label>
      <div class="dbg-row" id="dbg-rooms"></div>
      <div class="dbg-row">
        <select class="dbg-select" id="dbg-gozone" style="flex:1;width:auto"></select>
        <button class="dbg-btn" id="dbg-go">走过去</button>
      </div>
      <label class="dbg-label">本地生活模拟（不经 hub，直接触发小动作）</label>
      <div class="dbg-row" id="dbg-local"></div>
      <label class="dbg-label" style="display:flex;align-items:center;gap:6px;cursor:pointer">
        <input type="checkbox" id="dbg-instant" style="width:auto;margin:0"> ⚡ 就地播放（跳过走位，直接看动作帧）
      </label>
      <details><summary>全部本地事件 <span id="dbg-local-count"></span> · 按房间</summary>
        <div class="dbg-sec" id="dbg-local-all"></div>
      </details>
      <div class="dbg-row">
        <button class="dbg-btn" id="dbg-shot">📷 保存截图</button>
        <button class="dbg-btn danger" id="dbg-reset">重置今日产出</button>
      </div>
    </div></details>

    <details open><summary>④ 实时诊断</summary><div class="dbg-sec">
      <div class="dbg-kv" id="dbg-kv"></div>
      <div class="dbg-row">
        <button class="dbg-btn" id="dbg-audit">布局 / 素材审计</button>
        <button class="dbg-btn" id="dbg-copy">复制诊断</button>
        <button class="dbg-btn" id="dbg-pause">暂停刷新</button>
      </div>
      <pre class="dbg-pre" id="dbg-audit-out">点「布局 / 素材审计」检查帧号越界、素材数量与碰撞格。</pre>
    </div></details>

    <details><summary>⑤ 控制台日志</summary><div class="dbg-sec">
      <div class="dbg-log" id="dbg-log"></div>
      <div class="dbg-row">
        <button class="dbg-btn" id="dbg-log-clear">清空</button>
        <button class="dbg-btn" id="dbg-log-copy">复制日志</button>
      </div>
    </div></details>
  </div>`;
  document.body.appendChild(panel);

  var $ = function (id) { return document.getElementById(id); };
  var open = false, paused = false, seqTimer = null, lastSnap = null;
  var logs = [];

  /* ---------- 日志收集 ---------- */
  function fmt(v) {
    if (typeof v === "object" && v !== null) { try { return JSON.stringify(v); } catch (e) { return String(v); } }
    return String(v);
  }
  function addLog(level, text) {
    var line = new Date().toLocaleTimeString("zh-CN", { hour12: false }) + " " + text;
    logs.push({ level: level, text: line });
    if (logs.length > 120) logs.shift();
    var box = $("dbg-log");
    if (!box) return;
    if (box.childElementCount > 120) box.removeChild(box.firstChild);
    var d = document.createElement("div");
    d.className = level === "error" ? "e" : level === "warn" ? "w" : "i";
    d.textContent = line;
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
  }
  ["error", "warn", "log"].forEach(function (k) {
    var orig = console[k].bind(console);
    console[k] = function () {
      addLog(k === "log" ? "info" : k, Array.prototype.map.call(arguments, fmt).join(" "));
      orig.apply(console, arguments);
    };
  });
  window.addEventListener("error", function (e) {
    addLog("error", (e.message || "error") + " @" + (e.filename || "").split("/").pop() + ":" + (e.lineno || 0));
  });
  window.addEventListener("unhandledrejection", function (e) { addLog("error", "unhandledrejection: " + fmt(e.reason)); });
  addLog("info", "调试工作台已就绪");

  /* ---------- 下拉初始化 ---------- */
  var states = C.states();
  var zones = C.zones();
  var stateSel = $("dbg-state");
  states.forEach(function (s) {
    var o = document.createElement("option"); o.value = s.id; o.textContent = s.id + " · " + s.verb;
    stateSel.appendChild(o);
  });
  stateSel.value = "writing";
  var zoneSel = $("dbg-zone"), goSel = $("dbg-gozone");
  [zoneSel, goSel].forEach(function (sel, idx) {
    if (idx === 0) { var o = document.createElement("option"); o.value = ""; o.textContent = "（按状态默认）"; sel.appendChild(o); }
    zones.forEach(function (z) { var op = document.createElement("option"); op.value = z; op.textContent = z; sel.appendChild(op); });
  });
  var quick = $("dbg-quick");
  states.forEach(function (s) {
    var b = document.createElement("button");
    b.className = "dbg-btn"; b.textContent = s.verb; b.title = s.id + " → " + s.zone;
    b.onclick = function () { C.emit(s.id, "调试：" + s.verb, "来自调试工作台快捷按钮"); flash(b); };
    quick.appendChild(b);
  });
  var rooms = C.rooms();
  var roomLabels = { office: "办公室", bedroom: "卧室", bath: "卫浴", garden: "花园" };
  rooms.forEach(function (r) {
    var b = document.createElement("button");
    b.className = "dbg-btn"; b.textContent = roomLabels[r] || r;
    b.onclick = function () { C.gotoRoom(r); flash(b); };
    $("dbg-rooms").appendChild(b);
  });
  /* 本地生活事件全部由 office.js 的 LOCAL_EVENTS 驱动，这里只按房间分组渲染按钮，
   * 以后加事件不用再改调试台；常用 4 条放在外面，其余收进折叠区避免面板被撑爆。 */
  var localEvents = C.localEvents ? C.localEvents() : [];
  function localButton(e) {
    var b = document.createElement("button");
    b.className = "dbg-btn";
    b.textContent = e.icon + " " + e.label;
    b.title = e.key + " → " + e.zone + " · " + e.text;
    b.onclick = function () {
      var instant = !!($("dbg-instant") && $("dbg-instant").checked);
      C.localAct(e.key, instant);
      addLog("info", "本地生活 → " + e.text + (instant ? "（就地）" : ""));
      flash(b);
    };
    return b;
  }
  ["sofa", "tea", "dining", "cook", "fridge", "arcade", "bed", "window", "library", "garden"].forEach(function (k) {
    localEvents.forEach(function (e) { if (e.key === k) $("dbg-local").appendChild(localButton(e)); });
  });
  var roomNames = { office: "办公室", bedroom: "卧室", bath: "卫浴", garden: "花园", town: "小镇" };
  var allLocal = $("dbg-local-all");
  $("dbg-local-count").textContent = "(" + localEvents.length + ")";
  Object.keys(roomNames).forEach(function (r) {
    var list = localEvents.filter(function (e) { return e.room === r; });
    if (!list.length) return;
    var lab = document.createElement("label");
    lab.className = "dbg-label";
    lab.textContent = roomNames[r] + " · " + list.length + " 条";
    var row = document.createElement("div");
    row.className = "dbg-row";
    list.forEach(function (e) { row.appendChild(localButton(e)); });
    allLocal.appendChild(lab);
    allLocal.appendChild(row);
  });
  function flash(b) { var t = b.textContent; b.textContent = "✓"; setTimeout(function () { b.textContent = t; }, 450); }

  /* ---------- 线上环境：hub 的 HTTP 接口未开放 ---------- */
  // 旧版点「推送到 hub」会 fetch 博客主站的 /api/event，404 后报一句误导性的 CORS/JSON 错误。
  var HUB_OK = !!C.hubBase();
  if (!HUB_OK) {
    ["dbg-push", "dbg-hub"].forEach(function (id) {
      var b = $(id);
      b.disabled = true;
      b.style.opacity = ".5";
      b.style.cursor = "not-allowed";
      b.title = "线上未开放 hub HTTP 接口；本地开发请用 node office/tools/dev.mjs";
    });
    $("dbg-hub-out").textContent =
      "线上部署未开放 hub 的 HTTP 接口（Nginx 只反代 /office-ws/）。\n" +
      "「推送到 hub / 查 hub 状态」已停用。\n" +
      "本地开发：node office/tools/dev.mjs；\n" +
      "服务器上推事件：SSH 后 curl -X POST 127.0.0.1:4321/api/event -d '{...}'。";
  }

  /* ---------- 操作 ---------- */
  function payload() {
    return {
      state: stateSel.value,
      task: $("dbg-task").value || "调试：" + stateSel.value,
      detail: $("dbg-detail").value,
      zone: zoneSel.value || undefined
    };
  }
  $("dbg-emit").onclick = function () {
    var p = payload(); C.emit(p.state, p.task, p.detail, p.zone);
    addLog("info", "本地注入 " + p.state + " / " + p.task + (p.zone ? " @" + p.zone : ""));
  };
  $("dbg-push").onclick = function () {
    var p = payload();
    C.pushHub(p.state, p.task, p.detail).then(function (r) {
      addLog(r.ok ? "info" : "error", "推送到 hub: HTTP " + r.status + (r.ok ? "（WS 在线会自动广播）" : ""));
    }).catch(function (e) { addLog("error", "推送 hub 失败：" + e.message + "（hub 未启动或 CORS 未生效）"); });
  };
  var SEQ = ["arrive", "browsing", "watching", "writing", "designing", "posting", "mailing", "idle"];
  $("dbg-seq").onclick = function () {
    if (seqTimer) {
      clearInterval(seqTimer); seqTimer = null; this.textContent = "▶ 模拟一轮工作";
      addLog("info", "已停止演示"); return;
    }
    var btn = this, i = 0;
    btn.textContent = "■ 停止演示";
    var run = function () {
      if (i >= SEQ.length) { clearInterval(seqTimer); seqTimer = null; btn.textContent = "▶ 模拟一轮工作"; return; }
      var s = SEQ[i++];
      C.emit(s, "演示：" + (states.filter(function (x) { return x.id === s; })[0] || {}).verb, "模拟一轮工作 " + i + "/" + SEQ.length);
    };
    run(); seqTimer = setInterval(run, 3200);
    addLog("info", "开始模拟一轮工作（共 " + SEQ.length + " 步，每 3.2 秒）");
  };  $("dbg-rain").onclick = function () {
    var w = C.snapshot().weather === "rainy" ? "sunny" : "rainy";
    C.setWeather(w); addLog("info", "天气 → " + w);
  };
  $("dbg-grid").onclick = function () { addLog("info", "碰撞格叠加 → " + (C.toggleGrid() ? "开" : "关")); };
  /* 道路层开关（v36）：单独显示/隐藏道路，用于检查路网与地块的压盖 */
  $("dbg-roads").onclick = function () {
    var v = C.toggleRoads();
    this.textContent = v ? "🛣 道路层 ✓" : "🛣 道路层 ✗";
    addLog("info", "道路层 → " + (v ? "显示" : "隐藏"));
  };
  /* 农场/钓鱼/料理快试（v36） */
  function farmOut(text) { $("dbg-farm-out").textContent = text; }
  $("dbg-farm-act").onclick = function () {
    var order = ["till", "sow", "water", "feed", "harvest"], out = [];
    var self = this;
    order.forEach(function (act) { var r = C.farmAct(act); if (r) out.push(act + ": " + r.text); });
    var s = C.farm();
    farmOut(out.join("\n") + "\n—— 熟" + s.ready + " · 长" + s.growing + " · 种子 " + JSON.stringify(s.seeds));
    addLog("info", "农场一轮完成");
  };
  $("dbg-farm-grow").onclick = function () {
    var s = C.farmGrowAll();
    farmOut("已催熟 " + s.ready + " 株（点田地或「农活一轮」收）");
    addLog("info", "全部作物已催熟");
  };
  $("dbg-fish").onclick = function () {
    var r = C.fishOnce();
    farmOut("钓鱼： " + r.text + (r.ok ? "（塘里累计 " + C.farm().fish + " 条）" : ""));
    addLog("info", "fishOnce → " + r.text);
  };
  $("dbg-cook").onclick = function () {
    var t = C.cookAuto();
    var k = C.kitchen();
    farmOut((t ? t : "食材不够") + "\n可做: " + k.recipes.filter(function (r) { return r.ok; }).map(function (r) { return r.name; }).join("、"));
    addLog("info", "cookAuto → " + t);
  };
  /* 地图编辑模式（v37）：进入后画布上直接增删移物品；hub 不通时改动存本机浏览器 */
  $("dbg-edit").onclick = function () {
    var on = C.setEditMode(!C.editState().on);
    this.textContent = on ? "✏ 编辑中…" : "✏ 编辑地图";
    var st = C.editState();
    // 旧版这里恒显示"保存走 hub"（editState().hub = !!hubMapBase() 永远为真），失败时极易误判
    addLog("info", "编辑模式 → " + (on ? "开" : "关") +
      (st.hub ? "（保存走 hub " + (st.mapUrl || "/api/map") + "）"
              : "（hub 不可达：" + (st.hubError || "未连接") + " → 改动存本机浏览器，重连后自动补传）"));
  };
  $("dbg-map-reload").onclick = function () {
    C.mapReload();
    var st = C.editState();
    addLog("info", st.hub ? "已从 hub 重载自定义层（" + st.count + " 条）" : "hub 不可达（" + (st.hubError || "未连接") + "），当前用本机镜像：" + st.count + " 条");
  };
  $("dbg-go").onclick = function () {
    var z = goSel.value; if (!z) return;
    C.emit("idle", "调试：前往 " + z, "", z); addLog("info", "走位 → " + z);
  };
  $("dbg-shot").onclick = function () {
    var d = C.screenshot(); if (!d) { addLog("error", "canvas 未就绪"); return; }
    var a = document.createElement("a"); a.href = d;
    a.download = "office-" + new Date().toISOString().replace(/[:.]/g, "-") + ".png";
    a.click(); addLog("info", "截图已保存");
  };
  $("dbg-reset").onclick = function () { C.resetEvidence(); addLog("warn", "今日产出计数已清零"); };
  $("dbg-ws").value = C.wsUrl();
  $("dbg-ws-go").onclick = function () {
    var u = $("dbg-ws").value.trim();
    addLog("info", "切换 WS → " + (u || "默认"));
    $("dbg-ws").value = C.setWs(u);
  };
  $("dbg-ws-reset").onclick = function () { $("dbg-ws").value = C.setWs(""); addLog("info", "WS 地址已恢复默认"); };
  $("dbg-hub").onclick = function () {
    C.hubStatus().then(function (j) {
      $("dbg-hub-out").textContent =
        "当前: " + j.state.state + " / " + (j.state.task || "") + "\n" +
        "围观: " + j.viewers + " 人 · 最近事件 " + j.recent.length + " 条\n" +
        j.recent.slice(-5).reverse().map(function (e) {
          return "  " + new Date(e.at).toLocaleTimeString("zh-CN", { hour12: false }) + " " + e.state + " " + (e.task || "");
        }).join("\n");
    }).catch(function (e) { $("dbg-hub-out").textContent = "hub 不可达：" + e.message + "\n本地请确认 node hub/hub.mjs 已在 4321 运行"; });
  };
  $("dbg-audit").onclick = function () {
    var s = C.snapshot(), bad = s.frameIssues, a = C.zoneAudit();
    var zi = a ? a.issues : ["区域审计不可用（场景未就绪）"];
    var sits = a ? a.zones.filter(function (z) { return z.sit; }) : [];
    var sem = a ? a.zones.filter(function (z) { return z.expect && !z.expect.feature; }) : [];
    var semBad = sem.filter(function (z) { return !z.expect.ok; });
    var groups = {}, groupOrder = [];
    (a ? a.states : []).forEach(function (st) {
      var key = "  " + st.label + " (" + (st.target ? st.target.join(",") : "?") + ")" + (st.sit ? " · 坐" : "") + "：";
      if (!groups[key]) { groups[key] = []; groupOrder.push(key); }
      groups[key].push(st.verb);
    });
    $("dbg-audit-out").textContent =
      "场景就绪: " + s.ready + " · 素材 " + s.assets + " 件 · 物件 " + s.props + " 个 · 阻挡格 " + s.blocked + "\n" +
      "帧号越界: " + (bad.length ? bad.length + " 处 ⚠" : "0 ✓") +
      (bad.length ? "\n" + bad.map(function (b) { return "  ✗ " + (b.id || b.asset) + " (" + b.asset + ") frame=" + b.frame + "，实际仅 " + b.frames + " 帧"; }).join("\n") : "") +
      "\n区域锚点: " + (zi.length ? zi.length + " 处 ⚠" : "0 ✓（全部落在可走格、坐席可达）") +
      (zi.length ? "\n" + zi.map(function (x) { return "  ✗ " + x; }).join("\n") : "") +
      "\n坐席 " + sits.length + " 处：" +
      (sits.length ? "\n" + sits.map(function (z) {
        return "  " + z.zone + " → " + z.sit.host + " · " + z.sit.dist + " 格" + (z.sit.lounge ? " · 瘫躺" : " · 坐直");
      }).join("\n") : "") +
      "\n区域语义: " + (sem.length - semBad.length) + "/" + sem.length + " 处锚点贴着对应家具" +
      (semBad.length ? "\n" + semBad.map(function (z) {
        return "  ✗ " + z.zone + " 期望 [" + z.expect.want.join("/") + "]，实际 " + (z.expect.found.join("、") || "无");
      }).join("\n") : " ✓") +
      "\n状态 → 落点 (" + (a ? a.states.length : 0) + " 个)：" +
      (groupOrder.length ? "\n" + groupOrder.map(function (k) { return k + groups[k].join("、"); }).join("\n") : "") +
      "\n碰撞格叠加: " + (s.gridOverlay ? "开" : "关") + " · 红=阻挡 蓝=区域锚点";
    if (bad.length + zi.length) addLog("warn", "审计发现 " + (bad.length + zi.length) + " 处问题");
  };
  function copy(text, label) {
    navigator.clipboard.writeText(text).then(function () { addLog("info", label + "已复制"); })
      .catch(function (e) { addLog("error", "复制失败：" + e.message); });
  }
  $("dbg-copy").onclick = function () { copy(JSON.stringify(lastSnap || C.snapshot(), null, 2), "诊断 JSON"); };
  $("dbg-log-copy").onclick = function () { copy(logs.map(function (l) { return "[" + l.level + "] " + l.text; }).join("\n"), "日志"); };
  $("dbg-log-clear").onclick = function () { logs = []; $("dbg-log").innerHTML = ""; };
  $("dbg-pause").onclick = function () { paused = !paused; this.textContent = paused ? "继续刷新" : "暂停刷新"; };
  $("dbg-close").onclick = close;
  window.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });

  /* ---------- 实时诊断刷新 ---------- */
  var WS_TEXT = ["连接中", "在线", "关闭中", "离线"];
  function render() {
    if (!open || paused) return;
    var s = C.snapshot(); lastSnap = s;
    var pill = $("dbg-conn");
    pill.textContent = "WS " + (WS_TEXT[s.ws.readyState] || "未知") + " · " + s.fps + " FPS";
    pill.className = "dbg-pill " + (s.ws.readyState === 1 ? "on" : "off");
    var kv = [
      ["场景", s.ready ? "就绪" : "加载中"], ["FPS", s.fps],
      ["鱼状态", s.fishState], ["鱼坐标", s.fish ? s.fish.x + "," + s.fish.y + " " + s.fish.face : "-"],
      ["灯光", (s.lightsOn ? "开" : "关") + (s.lightsManual ? " (手动)" : "")], ["环境亮度", s.ambient],
      ["天气", s.weather], ["WS", WS_TEXT[s.ws.readyState] || "未知"],
      ["素材 / 物件", s.assets + " / " + s.props], ["阻挡格", s.blocked],
      ["今日完成", s.evidence.done], ["当前任务", s.evidence.current || "-"],
      ["气泡", s.bubble || "-"], ["画布", s.canvas ? s.canvas.w + "×" + s.canvas.h : "-"],
      ["农场", "熟" + (s.farm ? s.farm.ready : 0) + "/长" + (s.farm ? s.farm.growing : 0) + "/鱼" + (s.farm ? s.farm.fish : 0)],
      ["道路层", s.roads ? "显示" : "隐藏"], ["拖动视角", s.camDrag ? "开" : "关"]
    ];
    $("dbg-kv").innerHTML = kv.map(function (p) {
      return "<div><span>" + p[0] + "</span><b title=\"" + String(p[1]).replace(/"/g, "") + "\">" + p[1] + "</b></div>";
    }).join("");
  }
  setInterval(render, 1000);

  /* 宽屏并排时开/关面板会改变 .wrap 宽度（1504px ↔ 1100px），但 CSS 变化不会触发
   * window.resize。手动派发一次：Phaser 重算画布尺寸，画布内文字按新缩放比反算字号。 */
  function relayout() {
    setTimeout(function () { window.dispatchEvent(new Event("resize")); }, 60);
  }
  function show() {
    open = true; panel.classList.add("open"); document.body.classList.add("dbg-open");
    var t = document.getElementById("debug-toggle");
    if (t) t.setAttribute("aria-expanded", "true");
    panel.focus(); render(); relayout();
  }
  function close() {
    if (!open) return;
    open = false; panel.classList.remove("open"); document.body.classList.remove("dbg-open");
    var t = document.getElementById("debug-toggle");
    if (t) { t.setAttribute("aria-expanded", "false"); if (!t.hidden) t.focus(); }
    relayout();
  }
  function toggle() { open ? close() : show(); }
  window.__officeDebug = { open: show, close: close, toggle: toggle, snapshot: function () { return C.snapshot(); } };
})();
