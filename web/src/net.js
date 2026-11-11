  // ---------- WebSocket ----------
  // 本地开发默认直连 hub(127.0.0.1:4321)，无需 Nginx /office-ws/ 反代；
  // 也可通过 ?ws=ws://host:port/ 或 localStorage.office_ws 覆盖（调试工作台内可配置）。
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
        // hub 内存里最近 20 条真实事件（重启后从 state.json 恢复）：刷新/重连时补齐历史，
        // 否则最近动态窗永远只有当前这一条，「最近干了什么」就看不出来。
        if (Array.isArray(msg.recent)) msg.recent.forEach(pushEvent);
        if (msg.stats) onStats(msg.stats);
        if (msg.state) onState(msg.state);
        if (Array.isArray(msg.customMap)) applyCustomMap(msg.customMap, true, msg.updatedAt);   // v37：hub 里的自定义家具层
        if (msg.weather && window.__officeSetWeather) window.__officeSetWeather(msg.weather);   // P6：真实天气初始值
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

  // ---------- 状态条 ----------
  function updateStatusbar(state, task, detail) {
    var dot = document.getElementById("st-dot");
    var t = document.getElementById("st-task");
    var d = document.getElementById("st-detail");
    // 状态名只用于拼 class：未登记的字符串一律落到默认灰点，避免 hub 推脏数据污染 DOM
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

  /* ---------- 内在状态条（方案 §1.3）：5 词条迷你条，低于阈值闪橙光 ---------- */
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

