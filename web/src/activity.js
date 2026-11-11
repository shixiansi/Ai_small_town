  /* ============ 最近动态窗：事件流 + 今日时间表 ============
   * 两条数据线：
   *   1) 事件流 —— hub 的 hello.recent（内存里最近 20 条，重启会从 state.json 恢复）+ 实时 WS 事件；
   *      浏览器再留 40 条到 localStorage，刷新页面/上线新版本后不至于只剩一句「睡觉」。
   *   2) 时间表 —— office.js 里的 SCHEDULE（小镇作息，真相源 hub/schedule.json，见文件头注释），
   *      负责回答「现在该不该有活 / 下一班几点 / 为什么在睡觉」。
   * 渲染一律 DOM：canvas 里的字在手机上是糊块（v21），这种长列表更不能进画布。
   */
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

  // ---------- 事件流水 ----------
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
  /* 收一条真实事件。key 用 state|task|ts：hub 的 hello.recent 与实时广播同一条事件的 ts 相同，
   * 所以刷新/重连补发 hello 时不会重复；同一条状态的重复上报（心跳，30s 一次）hub 压根不广播
   * （去抖在 hub 侧），也不会刷屏。 */
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

  // ---------- 时间表 ----------
  /* 一班一行：`every` 的班次（每 2 小时回评论、每 4 小时看B站）在表里只占一行，
   * 但内部展开成今天的所有时刻 —— 「此刻是否正在进行 / 下一班几点」要靠展开后的结果算，
   * 否则会把「每 2 小时」误判成只有早上那一班。 */
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

    // 一打开时间表就把「此刻 / 下一班」那行带到视野里：只在真的看不见时才挪，
    // 而且只挪刚好够的距离 —— 上方的「现在几点 / 为什么是这样」固定不动，只有列表自己滚。
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

  // ---------- 面板交互（标签 / 折叠，状态记在本地） ----------
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
  // 每 30s 只刷「几分钟前 / 现在几点 / 这一班是否进行中」，不重新拉数据
  setInterval(function () {
    renderEvents();
    if (actTab === "plan") renderPlan();
  }, 30000);
  if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", initActivity);
  else initActivity();
