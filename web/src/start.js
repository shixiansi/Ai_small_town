  // ---------- 启动 ----------
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

