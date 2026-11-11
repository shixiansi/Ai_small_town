/* 独立地图编辑器侧栏（v38）
 * 依赖 office.js 暴露的 window.__mapEditor（图层语义 + 图标 + 保存）与 window.__officeCtl（视角）。
 * 三层：地板（地板/道路贴片）· 物品（家具：放置/移动/删除-隐藏）· 地形（墙/水/农田）。
 * 图层与条目全部落在 hub 的 map.custom.json，前端由 applyCustomFurniture() 叠加渲染。
 */
(function () {
  var M = null, S = null;           // M = __mapEditor API，S = 最近一次 state()
  var curCat = "all";               // 资产分类筛选（v39.3）：all 或 EDIT_CATS 的 id
  var LAYERS = [
    { id: "floor", label: "地板层", tip: "铺地板 / 道路（点一下铺一格，按住可以拖着刷）" },
    { id: "object", label: "物品层", tip: "家具：放置 / 拖动 / 删除（静态家具也能挪，删=隐藏可恢复）" },
    { id: "terrain", label: "地形层", tip: "墙 / 水面 / 农田（墙和水会挡路）" },
    { id: "light", label: "光照层", tip: "昼夜预览 + 阴影区域（每块独立设 夜/开灯/白天 浓度，可移动删除）+ 自定义灯源" }
  ];
  var FLOOR_CHIP = { wood: "#9c7750", tile: "#8e9ca6", stone: "#7c7e8c", grass: "#6e9453", road: "#b3a184" };
  var TERRAIN_CHIP = { wall: "#3b4459", water: "#2f6f9e", farm: "#7a5334" };

  var $ = function (id) { return document.getElementById(id); };
  var body = $("ed-body");

  function el(tag, css, html) {
    var e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function assetName(a) {
    return a.replace(/^(office|kitchen|market|round|school|dining|double|bench|stall|sign|filing|floor|desk|crown|house)-/, "");
  }

  /* ---------------- 侧栏骨架（只建一次） ---------------- */
  var ui = {};
  function buildShell() {
    body.innerHTML = "";
    // 图层 tab
    var layerWrap = el("div", "margin-bottom:10px");
    var tabs = el("div"); tabs.id = "ed-layers";
    LAYERS.forEach(function (L) {
      var b = el("button", "", L.label);
      b.className = "btn";
      b.dataset.layer = L.id;
      b.title = L.tip;
      b.onclick = function () { M.setLayer(L.id); refresh(); };
      tabs.appendChild(b);
    });
    layerWrap.appendChild(tabs);
    ui.layerTip = el("div", "color:#9aa3b8;font-size:11px;line-height:1.6");
    layerWrap.appendChild(ui.layerTip);
    body.appendChild(layerWrap);

    // 工具
    ui.toolSec = el("div", "margin-bottom:12px");
    ui.toolLbl = el("div", "color:#9aa3b8;font-size:11.5px;margin-bottom:5px", "工具");
    ui.toolRow = el("div"); ui.toolRow.className = "row";
    ui.toolSec.appendChild(ui.toolLbl);
    ui.toolSec.appendChild(ui.toolRow);
    body.appendChild(ui.toolSec);

    // 调色板（按图层换内容）
    ui.palSec = el("div", "margin-bottom:12px");
    ui.palLbl = el("div", "color:#9aa3b8;font-size:11.5px;margin-bottom:5px");
    ui.palWrap = el("div");
    ui.palSec.appendChild(ui.palLbl);
    ui.palSec.appendChild(ui.palWrap);
    body.appendChild(ui.palSec);

    // 物件列表（只在物品层显示）
    ui.objSec = el("div", "margin-bottom:10px");
    var objLbl = el("div", "display:flex;align-items:center;gap:6px;color:#9aa3b8;font-size:11.5px;margin-bottom:5px");
    objLbl.innerHTML = '<span class="obj-head">物件列表（视口内 <b id="ed-obj-n">0</b> 件）</span>';
    var objRefresh = el("button", "margin-left:auto;padding:1px 6px;border-radius:5px;border:1px solid #ffffff33;background:#242938;color:#c3c9d9;cursor:pointer;font-size:11px", "↻");
    objRefresh.onclick = function () { renderObjects(); };
    objLbl.appendChild(objRefresh);
    ui.objSec.appendChild(objLbl);
    ui.shadowEdit = el("div", "display:none;margin-bottom:6px;padding:6px;border:1px dashed #ffffff2e;border-radius:6px");
    ui.shadowEdit.id = "ed-shadow-edit";
    ui.objSec.appendChild(ui.shadowEdit);
    ui.switchEdit = el("div", "display:none;margin-bottom:6px;padding:6px;border:1px dashed #ffffff2e;border-radius:6px");
    ui.switchEdit.id = "ed-switch-edit";
    ui.objSec.appendChild(ui.switchEdit);
    ui.objList = el("div"); ui.objList.id = "ed-objs";
    ui.objSec.appendChild(ui.objList);
    ui.hiddenRow = el("div", "margin-top:5px;font-size:11.5px;color:#ffc078;display:none");
    ui.objSec.appendChild(ui.hiddenRow);
    body.appendChild(ui.objSec);


    // 统计
    ui.stats = el("div", "color:#9aa3b8;font-size:11.5px;line-height:1.7;border-top:1px dashed #ffffff1f;padding-top:8px");
    body.appendChild(ui.stats);
  }

  /* ---------------- 渲染 ---------------- */
  function refresh() {
    S = M.state();
    var L = S.layer;
    // 图层 tab
    [].forEach.call(document.querySelectorAll("#ed-layers .btn"), function (b) {
      b.classList.toggle("on", b.dataset.layer === L);
    });
    var def = LAYERS.filter(function (x) { return x.id === L; })[0] || LAYERS[1];
    ui.layerTip.textContent = def.tip;

    // 工具
    ui.toolRow.innerHTML = "";
    var tools = L === "object"
      ? [{ id: "select", label: "🎯 选择" }, { id: "paint", label: "➕ 放置" }, { id: "move", label: "✥ 移动" }, { id: "erase", label: "🗑 删除" }]
      : (L === "light"
        ? ((S.lightMode === "shadow")
          ? [{ id: "paint", label: "▭ 拉框" }, { id: "move", label: "✥ 移动块" }, { id: "erase", label: "🗑 删块" }]
          : [{ id: "paint", label: "💡 落灯" }, { id: "move", label: "✥ 拖动" }, { id: "erase", label: "🗑 删灯" }])
        : [{ id: "paint", label: "🖌 画笔" }, { id: "erase", label: "🧽 擦除" }]);
    tools.forEach(function (t) {
      var b = el("button", "", t.label);
      b.className = "btn" + (S.tool === t.id ? " on" : "");
      b.onclick = function () { M.setTool(t.id); refresh(); };
      ui.toolRow.appendChild(b);
    });
    // v44：旋转（只对有多朝向的素材有效）+ 连续放置开关
    if (L === "object") {
      var rb = el("button", "", "⟳ 旋转 · " + (S.rotLabel || "南"));
      rb.className = "btn";
      rb.title = "旋转 90°（快捷键 R）：先选资产 → 转下一次要放的；已选中自建物品 → 直接转那件";
      rb.onclick = function () { M.rotate(); refresh(); };
      ui.toolRow.appendChild(rb);
      var cb = el("label", "display:flex;align-items:center;gap:5px;font-size:11.5px;color:#9aa3b8;margin:6px 0 0;cursor:pointer");
      var cbi = document.createElement("input");
      cbi.type = "checkbox"; cbi.checked = !!S.continuous;
      cbi.style.cssText = "width:auto;margin:0;accent-color:#4a6cf7";
      cbi.onchange = function () { M.setContinuous(this.checked); };
      cb.appendChild(cbi);
      cb.appendChild(el("span", "", "连续放置（也可以**按住 Shift** 临时连放；默认放一次就交还「选择」）"));
      ui.palWrap.appendChild(cb);
    }

    // 调色板
    ui.palWrap.innerHTML = "";
    if (L === "object") {
      ui.palLbl.textContent = "资产（先选类别 → 点一件 → 点地图放置）";
      // v39.3：按类别分开展示，71 件不再混成一格
      var cats = [{ id: "all", label: "全部", icon: "＊", assets: S.assets || [] }].concat(S.categories || []);
      if (!cats.some(function (c) { return c.id === curCat; })) curCat = "all";
      var chips = el("div");
      chips.id = "ed-cats";
      cats.forEach(function (c) {
        var b = el("button", "", (c.icon || "") + " " + c.label + '<i>' + (c.assets ? c.assets.length : 0) + "</i>");
        b.className = curCat === c.id ? "on" : "";
        b.title = c.label + " · " + (c.assets ? c.assets.length : 0) + " 件";
        b.onclick = function () { curCat = c.id; refresh(); };
        chips.appendChild(b);
      });
      ui.palWrap.appendChild(chips);

      var cur = cats.filter(function (c) { return c.id === curCat; })[0] || cats[0];
      var grid = el("div"); grid.id = "ed-assets";
      (cur.assets || []).forEach(function (a) {
        var b = document.createElement("button");
        b.className = S.asset === a ? "on" : "";
        var ico = M.icon(a, 0);
        b.innerHTML = (ico ? '<img src="' + ico + '" alt="">' : "") + "<span>" + assetName(a) + "</span>";
        b.title = a;
        b.onclick = function () { M.setAsset(a); refresh(); };
        grid.appendChild(b);
      });
      ui.palWrap.appendChild(grid);
    } else if (L === "floor") {
      ui.palLbl.textContent = "地板 / 道路";
      var tg = el("div"); tg.id = "ed-tiles";
      (S.floorStyles || []).forEach(function (t) {
        var b = document.createElement("button");
        b.className = S.floor === t ? "on" : "";
        b.innerHTML = '<span class="chip" style="background:' + (FLOOR_CHIP[t] || "#888") + '"></span>' + (S.floorLabels[t] || t);
        b.onclick = function () { M.setFloor(t); refresh(); };
        tg.appendChild(b);
      });
      ui.palWrap.appendChild(tg);
    } else if (L === "light") {
      var ngt = S.night || { alpha: 0.6, pad: 0, preview: "auto", roomMask: true };
      var shadowMode = (S.lightMode || "light") === "shadow";

      // ① 子模式：灯源 / 阴影区域
      var modeRow = el("div", "display:flex;gap:4px;margin-bottom:8px");
      [["light", "💡 灯源"], ["shadow", "🌑 阴影区域"]].forEach(function (mo) {
        var b = el("button", "flex:1;padding:5px 2px;border-radius:6px;border:1px solid #ffffff33;background:#242938;color:#dfe3ee;cursor:pointer;font-size:11.5px", mo[1]);
        if ((S.lightMode || "light") === mo[0]) { b.style.background = "#4a6cf7"; b.style.borderColor = "#4a6cf7"; b.style.color = "#fff"; }
        b.onclick = function () { M.setLightMode(mo[0]); refresh(); };
        modeRow.appendChild(b);
      });
      ui.palWrap.appendChild(modeRow);

      // ② 昼夜预览
      ui.palLbl.textContent = "昼夜预览";
      var prevRow = el("div", "display:flex;gap:4px;margin-bottom:8px");
      [["auto", "🕒 自动"], ["day", "☀ 白天"], ["night", "🌙 黑夜"]].forEach(function (p) {
        var b = el("button", "flex:1;padding:4px 2px;border-radius:6px;border:1px solid #ffffff33;background:#242938;color:#dfe3ee;cursor:pointer;font-size:11.5px", p[1]);
        if (ngt.preview === p[0]) { b.style.background = "#4a6cf7"; b.style.borderColor = "#4a6cf7"; b.style.color = "#fff"; }
        b.onclick = function () { M.setNight({ preview: p[0] }); refresh(); };
        prevRow.appendChild(b);
      });
      ui.palWrap.appendChild(prevRow);

      // ③.5 房间灯开关（v49）：拨一下就能对比 夜 / 开灯 两档浓度
      ui.palWrap.appendChild(el("div", "color:#9aa3b8;font-size:11.5px;margin:8px 0 4px", "房间灯（直接在编辑器里试开关）"));
      var lrRow = el("div", "display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px");
      [["office", "办公室"], ["bedroom", "起居"], ["bath", "卫浴"], ["kitchen", "厨房"]].forEach(function (kv) {
        var on = !!(S.roomLights && S.roomLights[kv[0]]);
        var b = el("button", "padding:4px 8px;border-radius:6px;border:1px solid #ffffff33;background:" + (on ? "#4a6cf7" : "#242938") + ";color:" + (on ? "#fff" : "#8b93a7") + ";cursor:pointer;font-size:11.5px", (on ? "💡 " : "⚫ ") + kv[1]);
        b.onclick = function () { M.setRoomLight(kv[0], !on); refresh(); };
        lrRow.appendChild(b);
      });
      ui.palWrap.appendChild(lrRow);
      var allRow = el("div", "display:flex;gap:4px;margin-bottom:8px");
      [["all", true, "全部开灯"], ["all", false, "全部关灯"]].forEach(function (kv) {
        var b = el("button", "flex:1;padding:4px 2px;border-radius:6px;border:1px solid #ffffff33;background:#242938;color:#dfe3ee;cursor:pointer;font-size:11px", kv[2]);
        b.onclick = function () { M.setRoomLight(kv[0], kv[1]); refresh(); };
        allRow.appendChild(b);
      });
      ui.palWrap.appendChild(allRow);

      // ④ 阴影区域（拉框）
      if (shadowMode) {
        ui.palLbl.textContent = "阴影区域（按住拖一个框 → 松手落一块）";
        var dft = S.shadowDefaults || { night: 0.6, lit: 0.15, day: 0 };
        ui.palWrap.appendChild(el("div", "color:#9aa3b8;font-size:11px;margin-bottom:6px",
          "新拉一块的默认浓度：夜 " + dft.night.toFixed(2) + " · 开灯 " + dft.lit.toFixed(2) + " · 白天 " + dft.day.toFixed(2)));
        ["night", "lit", "day"].forEach(function (k) {
          var label = { night: "夜", lit: "开灯", day: "白天" }[k];
          var row = el("div", "display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:11.5px");
          row.appendChild(el("span", "color:#c3c9d9;width:38px", label));
          var inp = document.createElement("input");
          inp.type = "range"; inp.min = "0"; inp.max = "0.95"; inp.step = "0.05"; inp.value = String(dft[k]);
          inp.style.cssText = "flex:1;accent-color:#4a6cf7";
          var out = el("span", "width:32px;text-align:right;color:#8ce99a", (+dft[k]).toFixed(2));
          inp.oninput = function () {
            out.textContent = (+this.value).toFixed(2);
            var patch = {}; patch[k] = +this.value;
            M.setShadowDefaults(patch);
            var cur = M.state().selectedShadow;
            if (cur) M.patchShadow(cur, patch);      // 选中某块时顺手改它
          };
          row.appendChild(inp); row.appendChild(out);
          ui.palWrap.appendChild(row);
        });
        var clr = el("button", "width:100%;padding:4px;border-radius:6px;border:1px solid #ffffff33;background:transparent;color:#ff8787;cursor:pointer;font-size:11.5px;margin-bottom:8px", "清空全部阴影块（" + (S.shadowCount || 0) + "）");
        clr.onclick = function () { M.clearShadows(); setTimeout(refresh, 240); };
        ui.palWrap.appendChild(clr);
      } else {
        // ⑤ 灯源预设 + 选中灯的半径/亮度
        ui.palLbl.textContent = "灯源预设（选中后点地图落灯）";
        var pg = el("div"); pg.id = "ed-lights";
        (S.lightPresets || []).forEach(function (p) {
          var b = el("button", "", '<span class="chip" style="background:#' + ("000000" + p.tint.toString(16)).slice(-6) + '"></span>' + p.label);
          if (S.lightPreset === p.id) { b.style.background = "#4a6cf7"; b.style.borderColor = "#4a6cf7"; b.style.color = "#fff"; }
          b.onclick = function () { M.setLightPreset(p.id); refresh(); };
          pg.appendChild(b);
        });
        ui.palWrap.appendChild(pg);
        var sel = (S.lights || []).filter(function (x) { return x.id === S.selectedLight; })[0];
        if (sel) {
          var rWrap = el("div", "display:flex;align-items:center;gap:6px;margin-top:8px;font-size:11.5px");
          rWrap.appendChild(el("span", "color:#c3c9d9;width:52px", "半径"));
          var rIn = document.createElement("input");
          rIn.type = "range"; rIn.min = "0.6"; rIn.max = "8"; rIn.step = "0.2"; rIn.value = String(sel.r);
          rIn.style.cssText = "flex:1;accent-color:#4a6cf7";
          rIn.oninput = function () { M.patchLight(sel.id, { r: +this.value }); };
          rWrap.appendChild(rIn);
          ui.palWrap.appendChild(rWrap);
          var lWrap = el("div", "display:flex;align-items:center;gap:6px;margin-top:4px;font-size:11.5px");
          lWrap.appendChild(el("span", "color:#c3c9d9;width:52px", "亮度"));
          var lIn = document.createElement("input");
          lIn.type = "range"; lIn.min = "0.05"; lIn.max = "1"; lIn.step = "0.05"; lIn.value = String(sel.a);
          lIn.style.cssText = "flex:1;accent-color:#4a6cf7";
          lIn.oninput = function () { M.patchLight(sel.id, { al: +this.value }); };
          lWrap.appendChild(lIn);
          ui.palWrap.appendChild(lWrap);
        }
      }
    } else {
      ui.palLbl.textContent = "地形（墙/水面会挡路，农田可走）";
      var tg2 = el("div"); tg2.id = "ed-tiles";
      ["wall", "water", "farm"].forEach(function (t) {
        var b = document.createElement("button");
        b.className = S.terrain === t ? "on" : "";
        b.innerHTML = '<span class="chip" style="background:' + TERRAIN_CHIP[t] + '"></span>' + (S.terrainLabels[t] || t);
        b.onclick = function () { M.setTerrain(t); refresh(); };
        tg2.appendChild(b);
      });
      ui.palWrap.appendChild(tg2);
    }

    // 物件列表只对物品层有意义
    // v50：选中"灯的开关"时，给它指定控制哪个房间
    var swBox = document.getElementById("ed-switch-edit");
    if (swBox) {
      var sf = S.selF;
      if (L === "object" && sf && sf.a === "switch" && sf.id) {
        swBox.style.display = "block";
        swBox.innerHTML = "";
        swBox.appendChild(el("div", "color:#9aa3b8;font-size:11.5px;margin-bottom:4px", "控制房间（点开关时切哪盏灯）· " + (sf.id ? "" : "先保存一次")));
        var row = el("div", "display:flex;flex-wrap:wrap;gap:4px");
        [["office", "办公室"], ["bedroom", "起居"], ["bath", "卫浴"], ["kitchen", "厨房"], ["none", "不绑定"]].forEach(function (kv) {
          var on = (sf.room || "none") === kv[0] || (kv[0] === "office" && !sf.room);
          var b = el("button", "padding:3px 8px;border-radius:5px;border:1px solid #ffffff33;background:" + (on ? "#4a6cf7" : "#242938") + ";color:" + (on ? "#fff" : "#8b93a7") + ";cursor:pointer;font-size:11px", kv[1]);
          b.onclick = function () { M.patchObject(sf.id, { room: kv[0] === "none" ? "none" : kv[0] }); setTimeout(refresh, 260); };
          row.appendChild(b);
        });
        swBox.appendChild(row);
      } else {
        swBox.style.display = "none";
      }
    }
    ui.objSec.style.display = (L === "object" || L === "light") ? "block" : "none";
    var oh = document.querySelector("#ed-body .obj-head");
    if (oh) oh.innerHTML = (L === "light" ? ((S.lightMode === "shadow") ? "阴影块（<b id='ed-obj-n'>0</b> 块）" : "灯光列表（<b id='ed-obj-n'>0</b> 盏）") : "物件列表（视口内 <b id='ed-obj-n'>0</b> 件）");
    if (typeof syncHistoryButtons === "function") syncHistoryButtons();
    if (L === "object") renderObjects();
    if (L === "light") { if (S.lightMode === "shadow") renderShadows(); else renderLights(); }


    // 统计 + hub
    ui.stats.innerHTML =
      "地板贴片 <b>" + S.floorCount + "</b> · 地形 <b>" + S.terrainCount + "</b> · 自建物品 <b>" + S.objectCount + "</b>" +
      " · 移动覆盖 <b>" + S.moveCount + "</b> · 隐藏 <b>" + S.hidden + "</b>";
    var hub = $("ed-hub");
    if (S.hub) { hub.textContent = S.mirror ? "hub 已连（有改动待同步）" : "hub 已连：改动写进 map.custom.json"; hub.style.color = "#8ce99a"; }
    else if (S.hubError) { hub.textContent = "hub 未连接（" + S.hubError + "）：改动只存本机浏览器"; hub.style.color = "#ffc078"; }
    else { hub.textContent = "正在探测 hub…"; hub.style.color = "#9aa3b8"; }
  }

  /* 保存状态条（v39.4）：成功显示条数 + hub 实际条数 + 时间；失败显示原因 */
  var noticeTimer = null;
  window.onEditorNotice = function (msg) {
    var el0 = $("ed-save-status");
    if (!el0) return;
    el0.style.color = "#ffe066";
    el0.textContent = "💡 " + msg;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(function () {
      var st = M.state();
      if (st.lastSave && st.lastSave.at) setSaveStatus(st.lastSave.ok, st.lastSave.err, st.lastSave.hubCount, st.lastSave.at);
      else { el0.style.color = "#9aa3b8"; el0.textContent = "尚未保存"; }
    }, 2600);
  };

  function setSaveStatus(ok, err, hubCount, at) {
    var el0 = $("ed-save-status");
    if (!el0) return;
    var t = at ? new Date(at) : new Date();
    var hh = ("0" + t.getHours()).slice(-2) + ":" + ("0" + t.getMinutes()).slice(-2) + ":" + ("0" + t.getSeconds()).slice(-2);
    if (ok) {
      el0.style.color = "#8ce99a";
      el0.textContent = "✔ " + hh + " 已写入 hub" + (hubCount != null && hubCount >= 0 ? "（hub 现有 " + hubCount + " 条）" : "");
    } else if (ok === false) {
      el0.style.color = "#ff8787";
      el0.textContent = "✖ 保存失败：" + (err || "未知原因") + "（改动已存本机浏览器）";
    }
  }

  /* 阴影块列表（v41）：点行选中（可改浓淡），✕ 删除整块 */
  /* v53：侧栏每 900ms 会轻量刷新；如果用户正在输入框里打字，绝不能重建 DOM（否则每输入一个字就丢焦点） */
  var sidebarHover = false;
  function editingNow() {
    var a = document.activeElement;
    if (!a) return false;
    var tag = (a.tagName || "").toUpperCase();
    if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") return false;
    var box = document.getElementById("ed-shadow-edit");
    var box2 = document.getElementById("ed-switch-edit");
    return !!((box && box.contains(a)) || (box2 && box2.contains(a)));
  }

  function renderShadows() {
    if (editingNow()) return;                 // 正在输入：这一轮跳过
    if (ui.listKind !== "shadow") { ui.listKind = "shadow"; ui.shadowSig = ""; }
    var list = M.shadows ? M.shadows() : [];
    var sigS = "s:" + list.map(function (r) { return r.id + "|" + r.x + "," + r.y + "|" + r.w + "x" + r.h + "|" + r.night + "," + r.lit + "," + r.day + "|" + (r.selected ? 1 : 0) + "|" + r.alphaNow; }).join("#");
    if (sigS === ui.shadowSig) return;
    ui.shadowSig = sigS;
    var n = $("ed-obj-n"); if (n) n.textContent = String(list.length);
    ui.objList.innerHTML = list.map(function (r, i) {
      var tag = (r.builtin ? "内置" : "自建") + " · " + r.w + "×" + r.h + " · 跟" + (r.roomLabel || "全局") + " ";
      return '<div class="obj" data-sid="' + r.id + '"' + (r.selected ? ' style="background:#4a6cf777;border-radius:5px"' : "") + ">" +
        '<span style="flex:none;width:14px;height:14px;border-radius:3px;background:#0a1020;border:1px solid #ffffff44"></span>' +
        '<span class="nm">' + (r.label || ("阴影 #" + (i + 1))) + '<span class="tag">' + tag + '</span>' +
        '<span class="tag" style="background:#ffffff10">夜 ' + r.night.toFixed(2) + " · 灯 " + r.lit.toFixed(2) + " · 昼 " + r.day.toFixed(2) + "</span></span>" +
        '<span class="pos" title="当前生效浓度">' + r.alphaNow.toFixed(2) + "</span>" +
        '<button class="x" data-del="' + r.id + '" title="删除这一块">✕</button></div>';
    }).join("") || '<div class="hint" style="padding:6px 2px">还没有阴影块（切到「阴影区域」，按住拖一个框）</div>';
    [].forEach.call(ui.objList.querySelectorAll(".obj"), function (row) {
      row.onclick = function (ev) {
        if (ev.target && ev.target.closest && ev.target.closest("button")) return;
        M.locateShadow(row.dataset.sid);    // v63：定位到这块区域中心
        M.selectShadow(row.dataset.sid); refresh();
      };
    });
    // 选中块：改名 + 三档浓度滑杆
    var selRow = list.filter(function (r) { return r.selected; })[0];
    var box = document.getElementById("ed-shadow-edit");
    if (box && selRow && box.dataset.sid === selRow.id) {
      // v53：同一块的面板已经在，只原地更新数值，**不动输入框**（否则每 900ms 丢一次焦点）
      [].forEach.call(box.querySelectorAll("[data-out]"), function (o) {
        var k = o.dataset.out;
        if (k && selRow[k] != null) o.textContent = Number(selRow[k]).toFixed(2);
      });
      [].forEach.call(box.querySelectorAll("[data-inp]"), function (i2) {
        var k = i2.dataset.inp;
        if (k && selRow[k] != null && document.activeElement !== i2) i2.value = String(selRow[k]);
      });
      return;
    }
    if (box) { box.innerHTML = ""; box.dataset.sid = ""; }
    if (selRow && box) {
      box.dataset.sid = selRow.id;
      box.style.display = "block";
      var nameRow = el("div", "display:flex;gap:6px;align-items:center;margin-bottom:6px");
      nameRow.appendChild(el("span", "color:#9aa3b8;font-size:11.5px;flex:none", "名称"));
      var nm = document.createElement("input");
      nm.type = "text"; nm.value = selRow.label || "";
      nm.placeholder = "（可留空）";
      nm.style.cssText = "flex:1;min-width:0;padding:2px 6px;border-radius:5px;border:1px solid #ffffff33;background:#242938;color:#ece8df;font-size:11.5px";
      var nameTimer = null;
      nm.oninput = function () {
        var v = this.value;
        clearTimeout(nameTimer);
        nameTimer = setTimeout(function () { M.patchShadow(selRow.id, { label: v.trim() }); }, 400);   // 防抖保存，不重建 DOM
      };
      nameRow.appendChild(nm);
      box.appendChild(nameRow);
      // 跟随哪个房间的灯（决定"开灯"那一档什么时候生效）
      var roomRow = el("div", "display:flex;align-items:center;gap:4px;margin-bottom:6px");
      roomRow.appendChild(el("span", "color:#9aa3b8;font-size:11.5px;flex:none;width:52px", "跟随灯"));
      [["auto", "自动"], ["office", "办公室"], ["bedroom", "起居"], ["bath", "卫浴"], ["kitchen", "厨房"], ["none", "全局"]].forEach(function (kv) {
        var cur = selRow.builtin ? (selRow.room || "none") : (selRow.room || "auto");
        var on = (cur === kv[0]) || (kv[0] === "auto" && selRow.room && !selRow.builtin && !selRow._explicitRoom);
        var b = el("button", "padding:3px 6px;border-radius:5px;border:1px solid #ffffff33;background:" + (on ? "#4a6cf7" : "#242938") + ";color:" + (on ? "#fff" : "#8b93a7") + ";cursor:pointer;font-size:10.5px", kv[1]);
        b.onclick = function () {
          M.patchShadow(selRow.id, { room: kv[0] === "auto" ? "" : (kv[0] === "none" ? "" : kv[0]) });
          refresh();
        };
        roomRow.appendChild(b);
      });
      box.appendChild(roomRow);
      [["night", "夜"], ["lit", "开灯"], ["day", "白天"]].forEach(function (kv) {
        var row = el("div", "display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:11.5px");
        row.appendChild(el("span", "color:#c3c9d9;width:38px;flex:none", kv[1]));
        var inp = document.createElement("input");
        inp.type = "range"; inp.min = "0"; inp.max = "0.95"; inp.step = "0.05"; inp.value = String(selRow[kv[0]]);
        inp.style.cssText = "flex:1;accent-color:#4a6cf7";
        var out = el("span", "width:32px;text-align:right;color:#8ce99a", selRow[kv[0]].toFixed(2));
        out.dataset.out = kv[0];
        inp.dataset.inp = kv[0];
        inp.oninput = function () {
          out.textContent = (+this.value).toFixed(2);
          var patch = {}; patch[kv[0]] = +this.value;
          M.patchShadow(selRow.id, patch);
        };
        row.appendChild(inp); row.appendChild(out);
        box.appendChild(row);
      });
      box.appendChild(el("div", "color:#6b7280;font-size:10.5px", "移动：切「✥ 移动块」后在画布上拖这块；删除：列表里的 ✕"));
    } else if (box) {
      box.style.display = "none";
    }
    [].forEach.call(ui.objList.querySelectorAll("button[data-del]"), function (b) {
      b.onclick = function (ev) { ev.stopPropagation(); M.removeShadow(b.dataset.del); setTimeout(refresh, 200); };
    });
  }

  /* 光照层的灯列表（v40）：点行选中，✕ 删除 */
  function renderLights() {
    if (editingNow()) return;                 // v53：同上
    if (ui.listKind !== "light") { ui.listKind = "light"; ui.lightSig = ""; }
    var list = M.lights ? M.lights() : [];
    var sigL = "l:" + list.map(function (l) { return l.id + "|" + l.x + "," + l.y + "|" + l.r + "|" + l.a + "|" + (l.selected ? 1 : 0); }).join("#");
    if (sigL === ui.lightSig) return;
    ui.lightSig = sigL;
    var n = $("ed-obj-n"); if (n) n.textContent = String(list.length);
    var head = document.querySelector("#ed-body .obj-head");
    if (head) head.textContent = "灯光列表（" + list.length + " 盏）";
    ui.objList.innerHTML = list.map(function (L, i) {
      var col = "#" + ("000000" + L.tint.toString(16)).slice(-6);
      return '<div class="obj" data-lid="' + L.id + '"' + (L.selected ? ' style="background:#4a6cf777;border-radius:5px"' : "") + ">" +
        '<span style="flex:none;width:14px;height:14px;border-radius:50%;background:' + col + ';box-shadow:0 0 6px ' + col + '"></span>' +
        '<span class="nm">灯 ' + (i + 1) + '<span class="tag">r' + L.r + " / a" + L.a + "</span></span>" +
        '<span class="pos">' + L.x + "," + L.y + "</span>" +
        '<button class="x" data-del="' + L.id + '" title="删除这盏灯">✕</button></div>';
    }).join("") || '<div class="hint" style="padding:6px 2px">还没有自定义灯源（选个预设，点地图落灯）</div>';
    [].forEach.call(ui.objList.querySelectorAll(".obj"), function (row) {
      row.onclick = function (ev) {
        if (ev.target && ev.target.closest && ev.target.closest("button")) return;
        M.locateLight(row.dataset.lid);     // v63：定位
        M.selectLight(row.dataset.lid); refresh();
      };
    });
    [].forEach.call(ui.objList.querySelectorAll("button[data-del]"), function (b) {
      b.onclick = function (ev) { ev.stopPropagation(); M.removeLight(b.dataset.del); setTimeout(refresh, 180); };
    });
  }

  function renderObjects() {
    if (editingNow()) return;                 // v53：正在输入时别重建
    if (ui.listKind !== "obj") { ui.listKind = "obj"; ui.objSig = ""; }
    var list = M.objects();
    // v57：内容没变就不重建 —— 900ms 定时刷新时重建会"吃掉"正在按下的 ✕（表现为删除没反应）
    var sig = "o:" + list.map(function (o) { return o.key + "|" + o.pos + "|" + (o.custom ? 1 : 0) + "|" + (o.moved ? 1 : 0); }).join("#");
    if (sig === ui.objSig) return;
    ui.objSig = sig;
    var n = $("ed-obj-n"); if (n) n.textContent = String(list.length);
    ui.objList.innerHTML = list.map(function (o) {
      return '<div class="obj" data-key="' + o.key + '">' +
        (o.icon ? '<img src="' + o.icon + '" alt="">' : '<i class="ph">▢</i>') +
        '<span class="nm">' + o.a + '<span class="tag' + (o.custom ? " cus" : "") + '">' + (o.custom ? "自建" : (o.moved ? "已挪" : "静态")) + "</span></span>" +
        '<span class="pos">' + o.pos + "</span>" +
        '<button class="x" data-del="' + o.key + '" title="' + (o.custom ? "删除" : "隐藏（可恢复）") + '">✕</button></div>';
    }).join("") || '<div class="hint" style="padding:6px 2px">视口里没有物件</div>';
    [].forEach.call(ui.objList.querySelectorAll(".obj"), function (row) {
      row.onclick = function (ev) {
        if (ev.target && ev.target.closest && ev.target.closest("button")) return;
        M.locateObject(row.dataset.key);   // v63：点行 → 镜头飞过去 + 闪一下
        M.focus(row.dataset.key);
      };
    });
    [].forEach.call(ui.objList.querySelectorAll("button[data-del]"), function (b) {
      b.onclick = function (ev) {
        ev.stopPropagation();
        M.deleteObject(b.dataset.del);
        setTimeout(refresh, 220);
      };
    });
    // 已隐藏
    if (S && S.hidden > 0) {
      ui.hiddenRow.style.display = "block";
      ui.hiddenRow.innerHTML = "已隐藏 " + S.hidden + " 件静态物件 ";
      var rb = el("button", "padding:0 6px;border-radius:5px;border:1px solid #ffffff33;background:transparent;color:#ffd43b;cursor:pointer;font-size:11px", "全部恢复");
      rb.onclick = function () { M.restoreHidden(); setTimeout(refresh, 260); };
      ui.hiddenRow.appendChild(rb);
    } else if (ui.hiddenRow) {
      ui.hiddenRow.style.display = "none";
    }
  }

  /* ---------------- 画布：拖动视角开关 ---------------- */
  var panOn = false;
  function setPan(on) {
    panOn = on;
    var b = $("ed-pan");
    if (b) b.classList.toggle("on", on);
    if (window.__officeCtl && window.__officeCtl.camDrag) {
      try { window.__officeCtl.camDrag(on); } catch (e) {}
    }
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    M = window.__mapEditor;
    if (!M) return setTimeout(init, 200);
    if (!(window.__office && window.__office.sceneRef && window.__office.sceneRef.mapdata)) return setTimeout(init, 200);
    // 独立编辑模式：进来就开编辑（office.js 里 editor=1 已经做过一次，这里兜一次）
    try { window.__officeCtl.setEditMode(true); } catch (e) {}
    buildShell();
    refresh();
    // 每 900ms 轻量刷新（镜头移动 / 广播回包后列表和统计跟上）
    setInterval(function () {
      if (!M) return;
      if (S && S.layer === "object") renderObjects();
      if (S && S.layer === "light") { if (S.lightMode === "shadow") renderShadows(); else renderLights(); }
      var hub = $("ed-hub");
      if (hub) {
        var s2 = M.state();
        if (s2.hub !== S.hub || s2.mirror !== S.mirror || s2.hidden !== S.hidden) { S = s2; refresh(); }
      }
    }, 900);

    $("ed-save").onclick = function () {
      var btn = this;
      btn.disabled = true; btn.textContent = "⏳ 保存中…";
      M.saveNow(function (ok, err, hubCount) {
        btn.disabled = false; btn.textContent = "💾 保存";
        setSaveStatus(ok, err, hubCount);
        refresh();
      });
    };
    $("ed-clear").onclick = function () {
    var st = M.state();
    var menu = [
      ["floor", "地板层（" + st.floorCount + "）"],
      ["terrain", "地形层（" + st.terrainCount + "）"],
      ["object", "物品层：自建物品（" + st.objectCount + "）"],
      ["light", "灯源（" + st.lightCount + "）"],
      ["shadow", "阴影区域覆盖（" + st.shadowCount + "）"],
      ["all", "全部（含隐藏/移动记录）"]
    ];
    var txt = "要清空哪一层？输入序号：\n\n" + menu.map(function (m, i) { return (i + 1) + ". " + m[1]; }).join("\n") +
              "\n\n（清空后可以按 Ctrl+Z 撤销）";
    var ans = window.prompt(txt, "1");
    if (!ans) return;
    var idx = parseInt(ans, 10) - 1;
    if (!(idx >= 0 && idx < menu.length)) return;
    var kind = menu[idx][0];
    if (kind === "all" && !confirm("清空全部自定义层记录？（含隐藏/移动/贴片/灯/阴影，可 Ctrl+Z 撤销）")) return;
    var r = M.clearLayer(kind);
    setSaveStatus(r.ok !== false, r.ok === false ? "这一层本来就是空的" : "");
    setTimeout(refresh, 300);
  };
  // v46：撤销 / 重做
  var uiUndo = $("ed-undo"), uiRedo = $("ed-redo");
  window.syncHistoryButtons = function () {
    var st = M.state();
    if (uiUndo) {
      uiUndo.textContent = "↶ 撤销" + (st.undoCount ? "（" + st.undoCount + "）" : "");
      uiUndo.disabled = !st.undoCount;
    }
    if (uiRedo) {
      uiRedo.textContent = "↷ 重做" + (st.redoCount ? "（" + st.redoCount + "）" : "");
      uiRedo.disabled = !st.redoCount;
    }
  };
  if (uiUndo) uiUndo.onclick = function () { var r = M.undo(); setSaveStatus(r.ok, r.ok ? "" : r.why); refresh(); };
  if (uiRedo) uiRedo.onclick = function () { var r = M.redo(); setSaveStatus(r.ok, r.ok ? "" : r.why); refresh(); };
  syncHistoryButtons();
  // v57：版本号（判断你是不是在用最新构建）+ 全局错误提示
  (function () {
    var ver = "?";
    try {
      var sc = document.currentScript || [].slice.call(document.scripts).filter(function (t) { return /editor\.js/.test(t.src); })[0];
      if (sc && sc.src) { var mm = sc.src.match(/v=([0-9a-f]+)/); if (mm) ver = mm[1]; }
    } catch (e) {}
    window.__editorBuild = ver;
    var el0 = $("ed-ver"); if (el0) el0.textContent = "build " + ver;
    window.addEventListener("error", function (ev) {
      var box = $("ed-save-status");
      if (box) { box.style.color = "#ff8787"; box.textContent = "✖ 脚本错误：" + (ev.message || "unknown") + "（截图给开发者）"; }
    });
  })();

  $("ed-selfcheck").onclick = function () {
    var btn = this;
    btn.disabled = true; btn.textContent = "检查中…";
    M.selfCheck().then(function (r) {
      btn.disabled = false; btn.textContent = "🩺 自检";
      var ok = r.hubReachable && r.writeOk && r.writeCount === r.local;
      var box = $("ed-save-status");
      if (box) {
        box.style.color = ok ? "#8ce99a" : "#ff8787";
        box.textContent = (ok ? "✔ 自检通过：" : "✖ 自检异常：") +
          "本地 " + r.local + " 条 / hub " + (r.hubCount == null ? "?" : r.hubCount) + " 条" +
          (r.writeOk ? "，写入 OK（" + r.writeCount + " 条）" : "，写入失败：" + (r.writeError || "?"));
        setTimeout(function () { setSaveStatus(true, ""); }, 5000);
      }
      alert("自检结果：\n\n" + JSON.stringify(r, null, 2));
    });
  };

  // v47：历史存档 / 本机副本
  $("ed-backups").onclick = function () {
    var btn = this;
    btn.disabled = true; btn.textContent = "读取…";
    M.listBackups().then(function (r) {
      btn.disabled = false; btn.textContent = "🗂 历史存档";
      var list = (r && r.list) || [];
      if (!list.length) { alert("还没有历史存档。\n\n从现在起 hub 每次覆盖 map.custom.json 之前都会自动备份（保留最近 30 份），下次改坏了就能从这里回滚。"); return; }
      var txt = "历史存档（新 → 旧）：\n\n" + list.slice(0, 20).map(function (b, i) {
        var t = new Date(b.mtime);
        var hh = ("0" + t.getHours()).slice(-2) + ":" + ("0" + t.getMinutes()).slice(-2) + ":" + ("0" + t.getSeconds()).slice(-2);
        return (i + 1) + ". " + hh + "  " + (b.count == null ? "?" : b.count) + " 条  (" + Math.round(b.bytes / 1024) + "KB)";
      }).join("\n") + "\n\n输入序号恢复（会先把当前状态也备份一份）：";
      var ans = window.prompt(txt, "1");
      if (!ans) return;
      var idx = parseInt(ans, 10) - 1;
      if (!(idx >= 0 && idx < Math.min(list.length, 20))) return;
      var b = list[idx];
      if (!confirm("恢复到 " + b.name + "（" + (b.count == null ? "?" : b.count) + " 条）？")) return;
      M.restoreBackup(b.name, function (ok, msg) {
        setSaveStatus(ok, ok ? "" : msg);
        refresh();
      });
    });
  };
  $("ed-mirror").onclick = function () {
    var info = M.localMirror();
    if (!info || !info.count) { alert("本机浏览器里没有副本（localStorage 的 office_map_custom_v1 为空）。"); return; }
    var t = info.updatedAt ? new Date(info.updatedAt) : null;
    var when = t ? (t.toLocaleString("zh-CN", { hour12: false })) : "时间未知";
    var kinds = {};
    info.furniture.forEach(function (f) { kinds[f.a] = (kinds[f.a] || 0) + 1; });
    var summary = Object.keys(kinds).slice(0, 12).map(function (k) { return k + "×" + kinds[k]; }).join("、");
    if (!confirm("本机副本：" + info.count + " 条（" + when + (info.pending ? "，未同步" : "") + "）\n\n" + summary +
                 "\n\n要用它覆盖 hub 当前的存档吗？（会先备份 hub 现有内容）")) return;
    M.restoreFromMirror(function (ok, msg) {
      setSaveStatus(ok, ok ? "" : msg);
      refresh();
    });
  };
  $("ed-zoom-in").onclick = function () { M.camera(0, 0, 0.15); };
    $("ed-zoom-out").onclick = function () { M.camera(0, 0, -0.15); };
    $("ed-grid").onclick = function () {
      var on = M.grid(!M.state().grid);
      this.classList.toggle("on", on);
      refresh();
    };
    $("ed-pan").onclick = function () { setPan(!panOn); };
    $("ed-back").onclick = function () { location.href = "./"; };
    /* hub 每次保存回包都会调它（office.js 的 noteSave）→ 底部状态条立即更新 */
    window.onMapSaveResult = function (r) { setSaveStatus(r.ok, r.err, r.hubCount, r.at); };
    window.addEventListener("keydown", function (e) {
      var tag = document.activeElement ? document.activeElement.tagName : "";
      if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        var rr = e.shiftKey ? M.redo() : M.undo();
        setSaveStatus(rr.ok, rr.ok ? "" : rr.why);
        refresh();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        var ry = M.redo(); setSaveStatus(ry.ok, ry.ok ? "" : ry.why); refresh(); return;
      }
      if (e.key === "1") { M.setLayer("floor"); refresh(); }
      else if (e.key === "2") { M.setLayer("object"); refresh(); }
      else if (e.key === "3") { M.setLayer("terrain"); refresh(); }
      else if (e.key === "r" || e.key === "R") { M.rotate(); refresh(); }
      else if (e.key === "e" || e.key === "E") { M.setTool("erase"); refresh(); }
      else if (e.key === "b" || e.key === "B") { M.setTool("paint"); refresh(); }
    });
    // v65：画布角标 —— build 号 + 光的 depth / 阴影的 depth，截图即可判断是否最新构建
  (function stamp() {
    var sc = window.__office && window.__office.sceneRef;
    if (!sc || !sc.add) { setTimeout(stamp, 400); return; }
    var pool = (sc.lightPools || [])[0];
    var shadow = sc.shadowRT || sc.shadowGfx;
    var amb = sc.children.list.filter(function (o) { return o.texture && o.texture.key === "ambientcv"; })[0];
    var vg = sc.children.list.filter(function (o) { return o.texture && o.texture.key === "vignetteTex"; })[0];
    var txt = "build " + (window.__editorBuild || "?") +
              "   影 " + (shadow ? Math.round(shadow.depth) : "无") +
              "   滤镜 " + (amb ? Math.round(amb.depth) : (vg ? Math.round(vg.depth) : "无")) +
              "   光 " + (pool ? Math.round(pool.depth) : "无");
    var t = sc.add.text(8, 8, txt, {
      fontFamily: "Consolas, monospace", fontSize: "12px", color: "#8ce99a",
      backgroundColor: "#000000cc", padding: { x: 5, y: 3 }
    }).setScrollFactor(0).setDepth(99999);
    t.setAlpha(0.9);
  })();

  console.log("[editor] 独立地图编辑器就绪");
  }
  init();
})();







