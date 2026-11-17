  /* ---------- 音频层（v2.7）：零素材，全部 WebAudio 合成 ----------
   *
   * 为什么不用音频文件：仓库不塞素材（体积 / 许可 / 同步三件事都不划算），
   * 而合成才能做到「下雨了雨声起来、夜里更静、走到塘边有水声」这种参数化。
   *
   * 三层结构（对应 game-feel 的 tier 表，不是三个各响各的音效）：
   *   ambient  常驻环境：风（全天）/ 雨（按天气）/ 夜虫（22-6 点）/ 塘水（靠近水边）
   *   sfx      事件音：small / medium / large 三档，一档一个配方，音高固定不随机
   *   tick     高频小音：脚步 / 打字（内部节流，调用方不用管频率）
   *
   * 全链路 fail-silent：没有 AudioContext、被自动播放策略拦住、用户静音 —— 一律安静地什么都不做，
   * 绝不抛错、绝不阻塞主循环（和 hub/network 的 fail-open 风格一致）。
   *
   * 其它片段这样用：
   *   Audio.fx("medium", state)          // 真实事件到达
   *   Audio.fx("small", zoneKey)         // 本地小动作落点
   *   Audio.footstep() / Audio.typeTick()
   *   Audio.setScene({ weather: "rainy" })
   */
  var Audio = (function () {
    var AC = window.AudioContext || window.webkitAudioContext;
    var ctx = null, master = null, ambBus = null, sfxBus = null;
    var noiseBuf = null, clickBuf = null, pinkBuf = null;
    var voices = null;                       // wind / rain / night / water 四个 GainNode
    var on = readPref();
    var scene = { weather: "sunny", hour: 12, room: "", lightsOn: true };
    var lastFoot = 0, lastType = 0, lastFx = {};
    var armed = false, built = false;

    function readPref() {
      try { var v = localStorage.getItem("office_audio"); return v === null ? true : v === "1"; }
      catch (e) { return true; }
    }
    function writePref() { try { localStorage.setItem("office_audio", on ? "1" : "0"); } catch (e) {} }

    /* 噪声源：白噪给风/雨/脚步，粉噪给水（低频更厚，不像白噪那样"嘶"） */
    function makeNoise(sec, pink) {
      var len = Math.floor(ctx.sampleRate * sec), buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = buf.getChannelData(0), last = 0;
      for (var i = 0; i < len; i++) {
        var w = Math.random() * 2 - 1;
        if (pink) { last = 0.97 * last + 0.03 * w; d[i] = last * 3.2; }
        else d[i] = w;
      }
      return buf;
    }
    function loopNoise(buf) {
      var s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0); return s;
    }
    /* 短包络：把 gain 从 0 拉到 peak 再衰减到 0，避免咔哒声与爆音 */
    function env(g, t0, peak, attack, dur) {
      var p = Math.max(0.0002, peak);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(p, t0 + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    }
    function ramp(param, v, sec) {
      try { param.setTargetAtTime(Math.max(0.0001, v), ctx.currentTime, Math.max(0.2, sec || 1.2)); }
      catch (e) { try { param.value = v; } catch (e2) {} }
    }

    /* 建图：只做一次。所有环境声部一次性接好，之后靠 gain 目标值切换（不用反复创建节点） */
    function build() {
      if (built || !AC) return;
      built = true;
      try { ctx = new AC(); } catch (e) { ctx = null; built = false; return; }
      master = ctx.createGain(); master.gain.value = on ? 0.35 : 0.0001; master.connect(ctx.destination);
      ambBus = ctx.createGain(); ambBus.gain.value = 1; ambBus.connect(master);
      sfxBus = ctx.createGain(); sfxBus.gain.value = 0.85; sfxBus.connect(master);
      noiseBuf = makeNoise(2, false);
      pinkBuf = makeNoise(2, true);
      clickBuf = makeNoise(0.06, false);

      // 风：白噪 → 带通；一个 0.05Hz 的 LFO 让中心频率慢慢呼吸（听感上"有风"而不是"电流声"）
      var windG = ctx.createGain(); windG.gain.value = 0.05; windG.connect(ambBus);
      var windF = ctx.createBiquadFilter(); windF.type = "bandpass"; windF.frequency.value = 480; windF.Q.value = 0.7;
      loopNoise(noiseBuf).connect(windF); windF.connect(windG);
      var lfo = ctx.createOscillator(); lfo.frequency.value = 0.05;
      var lfoG = ctx.createGain(); lfoG.gain.value = 140;
      lfo.connect(lfoG); lfoG.connect(windF.frequency); lfo.start(0);

      // 雨：白噪 → 高通 + 低通（切掉低频轰鸣与高频刺耳，只留"沙沙"）
      var rainG = ctx.createGain(); rainG.gain.value = 0.0001; rainG.connect(ambBus);
      var rainH = ctx.createBiquadFilter(); rainH.type = "highpass"; rainH.frequency.value = 1800;
      var rainL = ctx.createBiquadFilter(); rainL.type = "lowpass"; rainL.frequency.value = 6200;
      loopNoise(noiseBuf).connect(rainH); rainH.connect(rainL); rainL.connect(rainG);

      // 夜虫：两个不协和的高频正弦（4.2k / 4.7k），极轻
      var nightG = ctx.createGain(); nightG.gain.value = 0.0001; nightG.connect(ambBus);
      [4200, 4700].forEach(function (f) {
        var o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f;
        var g = ctx.createGain(); g.gain.value = 0.10;
        o.connect(g); g.connect(nightG); o.start(0);
      });

      // 塘水：粉噪 → 窄带通（Q 高一点就有"流动"感）
      var waterG = ctx.createGain(); waterG.gain.value = 0.0001; waterG.connect(ambBus);
      var waterF = ctx.createBiquadFilter(); waterF.type = "bandpass"; waterF.frequency.value = 1150; waterF.Q.value = 2;
      loopNoise(pinkBuf).connect(waterF); waterF.connect(waterG);

      voices = { wind: windG, rain: rainG, night: nightG, water: waterG };
      applyScene();
    }

    function applyScene() {
      if (!ctx || !voices) return;
      var h = Number(scene.hour); if (!isFinite(h)) h = 12;
      var night = (h < 6 || h >= 22);
      var rainy = (scene.weather === "rainy" || scene.weather === "storm");
      var cloudy = (scene.weather === "cloudy");
      ramp(voices.wind.gain, night ? 0.032 : (cloudy ? 0.062 : 0.05), 1.5);
      ramp(voices.rain.gain, rainy ? 0.075 : 0.0001, 2.2);
      ramp(voices.night.gain, night ? 0.011 : 0.0001, 2.5);
      ramp(voices.water.gain, (scene.room === "pond" || scene.room === "garden") ? 0.02 : 0.0001, 1.6);
    }

    // ---------- 事件音：三档配方 ----------
    function tone(freq, dur, type, peak, slideTo) {
      var t0 = ctx.currentTime;
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || "triangle";
      o.frequency.setValueAtTime(freq, t0);
      if (slideTo) { try { o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t0 + dur); } catch (e) {} }
      env(g, t0, peak, Math.min(0.02, dur * 0.35), dur);
      o.connect(g); g.connect(sfxBus); o.start(t0); o.stop(t0 + dur + 0.05);
    }
    function hiss(dur, freq, q, peak, type) {
      var t0 = ctx.currentTime;
      var s = ctx.createBufferSource(); s.buffer = clickBuf; s.loop = true;
      var f = ctx.createBiquadFilter(); f.type = type || "lowpass"; f.frequency.value = freq; f.Q.value = q || 1;
      var g = ctx.createGain(); env(g, t0, peak, 0.004, dur);
      s.connect(f); f.connect(g); g.connect(sfxBus); s.start(t0); s.stop(t0 + dur + 0.03);
    }
    var TIER = {
      small:  { peak: 0.09, dur: 0.07 },   // 点一下、小动作：只用一个音
      medium: { peak: 0.19, dur: 0.13 },   // 真实事件到达：双音 + 轻气声
      large:  { peak: 0.32, dur: 0.24 }    // 出错 / 大事件：低频扫频 + 气声
    };
    function fx(tier, kind) {
      if (!on || !ctx) return;
      var t = TIER[tier] || TIER.small, k = kind || "x", now = Date.now();
      if (lastFx[k] && now - lastFx[k] < 90) return;   // 同类音 90ms 内只响一次，防止叠成噪音墙
      lastFx[k] = now;
      try {
        if (tier === "large") { tone(220, t.dur, "sawtooth", t.peak * 0.5, 110); hiss(t.dur, 900, 0.8, t.peak * 0.5); }
        else if (tier === "medium") { tone(660, t.dur, "triangle", t.peak, 880); hiss(t.dur * 0.6, 2400, 1.2, t.peak * 0.22, "bandpass"); }
        else { tone(880, t.dur, "triangle", t.peak); }
      } catch (e) {}
    }
    function footstep() {
      if (!on || !ctx) return;
      var now = Date.now(); if (now - lastFoot < 300) return; lastFoot = now;
      try { hiss(0.05, 780, 0.9, 0.07); } catch (e) {}
    }
    function typeTick() {
      if (!on || !ctx) return;
      var now = Date.now(); if (now - lastType < 110) return; lastType = now;
      try { hiss(0.02, 2200, 2, 0.045, "bandpass"); } catch (e) {}
    }

    // ---------- 开关与首屏引导 ----------
    function updateBtn() {
      var b = document.getElementById("audio-toggle");
      if (!b) return;
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.textContent = on ? "🔊" : "🔇";
      b.title = on ? "声音：开（点击静音）" : "声音：关（点击开启）";
    }
    function setEnabled(v) {
      on = !!v; writePref();
      if (on) build();
      if (ctx && master) ramp(master.gain, on ? 0.35 : 0.0001, 0.25);
      updateBtn();
    }
    /* 自动播放策略：必须在用户手势里才能建/恢复 AudioContext。
     * 三种事件都挂 once，谁先来都行；之后再点开关不会重复建图。 */
    function unlock() {
      if (!on) return;   // v2.9：静音用户别建常驻音频图——不然手势一次就烧 CPU 到永远
      build();
      if (!ctx) return;
      try { if (ctx.state === "suspended") ctx.resume(); } catch (e) {}
      applyScene();
    }
    function arm() {
      if (armed) return;
      armed = true;
      ["pointerdown", "keydown", "touchstart"].forEach(function (ev) {
        window.addEventListener(ev, unlock, { once: true, passive: true });
      });
      window.addEventListener("click", unlock, { once: true, passive: true });
    }
    function init() {
      arm();
      updateBtn();
      var b = document.getElementById("audio-toggle");
      if (b) b.addEventListener("click", function (e) { e.stopPropagation(); setEnabled(!on); });
      scene.hour = (typeof bjHour === "function") ? bjHour() : 12;
      if (on) build();          // 没用户手势时建了也是 suspended，等 unlock 再 resume
      // 昼夜声场：每分钟按当前时辰重算一次（夜虫起落、风声变化都靠这条），不用别的片段来推
      setInterval(function () {
        scene.hour = (typeof bjHour === "function") ? bjHour() : scene.hour;
        applyScene();
      }, 60000);
    }

    /* 只读快照：调试台 / 自动走查断言用（不参与逻辑） */
    function snapshot() {
      return {
        enabled: on, built: built, ctxState: ctx ? ctx.state : "none",
        weather: scene.weather, hour: scene.hour, room: scene.room,
        levels: voices ? { wind: voices.wind.gain.value, rain: voices.rain.gain.value, night: voices.night.gain.value, water: voices.water.gain.value } : null
      };
    }
    try { window.__officeAudioState = snapshot; } catch (e) {}

    return {
      init: init,
      fx: fx,
      footstep: footstep,
      typeTick: typeTick,
      setEnabled: setEnabled,
      isOn: function () { return on; },
      snapshot: snapshot,
      setScene: function (s) {
        if (!s) return;
        for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k) && s[k] !== undefined) scene[k] = s[k];
        if (s.hour === undefined && typeof bjHour === "function") scene.hour = bjHour();
        applyScene();
      }
    };
  })();
  Audio.init();
