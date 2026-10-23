/* ==========================================================
   CRUST BREAKER: DEEP CORE — game.js
   Main loop, camera scrolling, Gyro-Saw physics, circle-vs-grid
   tile destruction, flying nuggets, Heat & Redline systems.
   Namespace: window.CB.game
   ========================================================== */
(function () {
  'use strict';
  window.CB = window.CB || {};

  var cfg = window.CB.config;
  var world = window.CB.world;
  var audio = window.CB.audio;
  var T = cfg.TILES;

  /* ---------- DOM ---------- */
  var canvas, ctx2d, stageEl;
  var elDepth, elGold, elHearts, elHeatBar, elHeatFill, elRedTag;
  var elModalOver, elModalStart, elBoostHint, elStall;
  var statDepth, statGold, statTiles, statBest;
  var shopBtns = {};

  /* ---------- View ---------- */
  var W = 0, H = 0, DPR = 1;
  var tileSize = 40, gridOriginX = 0;

  /* ---------- Run state ---------- */
  var running = false;
  var lastTime = 0;

  var saw = { x: 0, y: 0, vx: 0, r: 30, spin: 0, spinSpeed: 0 };
  var camY = 0;                 // world y at top of viewport (px)
  var heat = 0;
  var hp = 3, maxHp = 3;
  var gold = 0;
  var tilesCarved = 0;
  var bestDepth = 0;            // meters reached this run
  var boost = false;
  var steerTargetX = null;      // screen-space target from drag
  var pointerActive = false;
  var shake = 0;
  var clinkStep = 0, clinkTimer = 0;
  var contactThisFrame = false;

  /* ---------- Stage 2 state ---------- */
  var comboCount = 0;           // tiles broken within the rolling window
  var comboWindowT = 0;         // time left in current window
  var comboBadgeT = 0;          // badge visibility timer
  var comboBadgeText = '';
  var chainQuartz = [];         // pending quartz chain steps {r,c,t}
  var chainPitch = 0;           // ascending pitch index across a chain
  var shockTimer = 0;           // SHOCK DRILL countdown
  var shockRings = [];          // expanding ring FX {x,y(world),t}
  var magmaHeatLatch = {};      // per-tile latch so magma heats once per touch
  var spikeLatch = {};          // per-tile latch so a mine only bites once

  var meta = loadMeta();        // garage levels persist between runs

  /* ---------- Stage 3 state: biomes, vaults, milestones, haptics ---------- */
  var lastDepthForStall = 0;
  var stallTimer = 0;
  var vaultActive = null;       // gate currently being drilled {gate, timer}
  var nextVaultCheckRow = 0;    // row at which the next gate top sits
  var lastMilestone = 0;        // last announced depth milestone (m)
  var bannerT = 0;              // big banner visibility timer
  var bannerText = '';
  var bannerColor = '#F2B705';
  var tw = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;
  if (tw) { try { tw.ready(); } catch (e) {} }

  function haptic(kind) {        // Telegram HapticFeedback with safe fallback
    if (!tw || !tw.HapticFeedback) return;
    try {
      if (kind === 'heavy') tw.HapticFeedback.impactOccurred('heavy');
      else if (kind === 'light') tw.HapticFeedback.notificationOccurred('success');
      else tw.HapticFeedback.impactOccurred('medium');
    } catch (e) {}
  }

  /* hex -> [r,g,b] */
  function hexRGB(hex) {
    var v = parseInt(hex.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  function mixHex(a, b, t) {
    var ca = hexRGB(a), cb = hexRGB(b);
    var r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
    var gg = Math.round(ca[1] + (cb[1] - ca[1]) * t);
    var bb = Math.round(ca[2] + (cb[2] - ca[2]) * t);
    return 'rgb(' + r + ',' + gg + ',' + bb + ')';
  }
  /* Biome tint of the current view center — smooth crossfade near boundaries */
  function biomeTintNow() {
    var m = currentDepthM() + (H / tileSize) * cfg.TILE_TO_METERS * 0.5;
    var idx = world.biomeIndexAt(m);
    var B = cfg.BIOMES;
    var t = world.biomeBlend(m, idx);
    var a = B[idx].tint;
    var b = B[idx + 1] ? B[idx + 1].tint : a;
    return { main: mixHex(a, b, t), deep: mixHex('#E5D5C3', '#D9C4AE', clamp((m - 250) / 900, 0, 1)) };
  }

  /* ---------- Entities ---------- */
  var particles = [];           // world space
  var nuggets = [];             // spawn in world space, fly in screen space
  var floaters = [];            // text popups, screen space

  /* ================= Helpers ================= */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function rand(a, b) { return a + Math.random() * (b - a); }

  function loadMeta() {
    try {
      var raw = localStorage.getItem(cfg.STORAGE.META);
      if (raw) {
        var m = JSON.parse(raw);
        // Stage 2: migrate legacy keys (hull/cooling/magnet -> radiator/vacuum/shock)
        return {
          dps:      m.dps | 0,
          radiator: m.radiator | 0 || Math.max(m.cooling | 0, m.hull | 0),
          vacuum:   m.vacuum | 0 || m.magnet | 0,
          shock:    m.shock | 0
        };
      }
    } catch (e) {}
    return { dps: 0, radiator: 0, vacuum: 0, shock: 0 };
  }
  function saveMeta() {
    try { localStorage.setItem(cfg.STORAGE.META, JSON.stringify(meta)); } catch (e) {}
  }
  function loadBest() {
    try { return parseFloat(localStorage.getItem(cfg.STORAGE.BEST)) || 0; } catch (e) { return 0; }
  }
  function saveBest(v) {
    try { localStorage.setItem(cfg.STORAGE.BEST, String(Math.floor(v))); } catch (e) {}
  }

  function upgradeCost(key) {
    var u = cfg.UPGRADES[key];
    return Math.floor(u.baseCost * Math.pow(u.costMult, meta[key]));
  }
  /* --- Stage 2 derived stats --- */
  function effectiveDPS() {
    return cfg.SAW.DPS_BASE * (1 + meta.dps * cfg.UPGRADES.dps.effect);
  }
  function sawTeethCount() {           // evolves every 5 levels
    return cfg.SAW.TEETH + Math.floor(meta.dps / 5) * 4;
  }
  function sawRadiusMult() {           // bigger blade at higher tiers
    return 1 + Math.floor(meta.dps / 5) * 0.12;
  }
  function sawVisualTier() {           // 0 brass -> 1 crimson -> 2 plasma rim
    return Math.min(2, Math.floor(meta.dps / 5));
  }
  function coolingRate() {             // RADIATOR speeds passive cooling too
    return cfg.HEAT.IDLE_COOL * (1 + meta.radiator * 0.18);
  }
  function heatBuildupFactor() {       // -12% per radiator level
    return Math.max(0.4, 1 - meta.radiator * cfg.HEAT.RAD_BUILD_REDUCE);
  }
  function redlineMin() {              // zone widens toward 70 at L5+
    var l = meta.radiator;
    if (l < 5) return cfg.HEAT.REDLINE_MIN;
    var t = Math.min(1, (l - 4) / 2);
    return cfg.HEAT.RAD_ZONE_MIN_L0 + (cfg.HEAT.RAD_ZONE_MIN_L5 - cfg.HEAT.RAD_ZONE_MIN_L0) * t;
  }
  function redlineMax() {              // ...and toward 96 at L5+
    var l = meta.radiator;
    if (l < 5) return cfg.HEAT.REDLINE_MAX;
    var t = Math.min(1, (l - 4) / 2);
    return cfg.HEAT.RAD_ZONE_MAX_L0 + (cfg.HEAT.RAD_ZONE_MAX_L5 - cfg.HEAT.RAD_ZONE_MAX_L0) * t;
  }
  function nuggetValue() {             // ORE VACUUM +25%/level + depth value ladder
    return Math.max(1, Math.round((1 + meta.vacuum * 0.35) * (1 + Math.floor(currentDepthM() / 300))));
  }
  function extraNuggets() {            // +1 per broken Gold/Quartz tile
    return meta.vacuum >= 1 ? 1 : 0;
  }
  function suctionForce() {            // vacuum also helps magnetism a bit
    return cfg.NUGGET.SUCTION_BASE * (1 + meta.vacuum * 0.15);
  }
  function shockPeriod() {             // SHOCK DRILL fires faster with levels
    if (meta.shock <= 0) return Infinity;
    return Math.max(cfg.SHOCK.MIN_PERIOD,
      cfg.SHOCK.BASE_PERIOD - (meta.shock - 1) * cfg.SHOCK.PERIOD_PER_LEVEL);
  }
  function inRedline() {
    return heat >= redlineMin() && heat <= redlineMax();
  }
  function anchorY() { return H * cfg.SAW.ANCHOR_Y_RATIO; }

  /* Grid <-> world conversions (world y grows downward into the crust) */
  function rowAt(worldY) { return Math.floor(worldY / tileSize); }
  function colAt(worldX) { return Math.floor((worldX - gridOriginX) / tileSize); }
  function tileWorldX(col) { return gridOriginX + col * tileSize; }
  function tileWorldY(row) { return row * tileSize; }

  /* ================= Resize ================= */
  function resize() {
    var rect = stageEl.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, Math.floor(rect.width));
    H = Math.max(1, Math.floor(rect.height));
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    ctx2d.setTransform(DPR, 0, 0, DPR, 0, 0);

    tileSize = Math.floor(W / cfg.COLS);
    gridOriginX = Math.floor((W - tileSize * cfg.COLS) / 2);
    saw.r = Math.max(18, W * cfg.SAW.RADIUS_RATIO);
  }

  /* ================= Input (1-finger) ================= */
  function pointerPos(e) {
    var rect = canvas.getBoundingClientRect();
    var p = (e.touches && e.touches.length) ? e.touches[0] : e;
    return { x: p.clientX - rect.left, y: p.clientY - rect.top };
  }

  function onDown(e) {
    if (!running) return;
    e.preventDefault();
    audio.resume();
    pointerActive = true;
    boost = true;                       // OVERDRIVE while held
    steerTargetX = pointerPos(e).x;
    elBoostHint.classList.add('hidden');
  }
  function onMove(e) {
    if (!pointerActive || !running) return;
    e.preventDefault();
    steerTargetX = pointerPos(e).x;     // drag left/right steers vx
  }
  function onUp() {
    pointerActive = false;
    boost = false;                      // released -> cool down slowly
    steerTargetX = null;
  }

  /* ================= Run lifecycle ================= */
  function resetRun() {
    world.reset();
    resize();
    saw.x = W / 2;
    saw.y = 0;                          // start right under the surface (world space)
    saw.vx = 0; saw.spin = 0; saw.spinSpeed = cfg.SAW.SPIN_BASE;
    camY = -anchorY();                  // negative until camera reaches 0
    heat = 0;
    maxHp = cfg.PLAYER.START_HP;
    hp = maxHp;
    gold = cfg.PLAYER.START_GOLD;
    tilesCarved = 0;
    bestDepth = 0;
    /* Stage 3 fix: every run starts with a clean slate — true roguelike.
       Persistent meta is NOT reloaded here; upgrades must be earned in-run. */
    meta = { dps: 0, radiator: 0, vacuum: 0, shock: 0 };
    refreshShop();
    boost = false; pointerActive = false; steerTargetX = null;
    particles.length = 0; nuggets.length = 0; floaters.length = 0;
    shake = 0; clinkStep = 0; clinkTimer = 0;
    /* Stage 2 resets */
    comboCount = 0; comboWindowT = 0; comboBadgeT = 0; comboBadgeText = '';
    chainQuartz.length = 0; chainPitch = 0;
    shockTimer = shockPeriod();         // first discharge after one full period
    shockRings.length = 0;
    magmaHeatLatch = {}; spikeLatch = {};
    /* Stage 3 resets */
    vaultActive = null; lastMilestone = 0; bannerT = 0; bannerText = '';
    stallTimer = 0; lastDepthForStall = currentDepthM();
    if (elStall) elStall.classList.remove('show');
    elBoostHint.classList.remove('hidden');
    updateHUD(true);
  }

  function startGame() {
    resetRun();
    elModalStart.classList.add('hidden');
    elModalOver.classList.add('hidden');
    running = true;
    audio.resume();
    audio.startHum();
    lastTime = performance.now();
    requestAnimationFrame(loop);
  }

  function gameOver() {
    running = false;
    audio.stopHum();
    var best = loadBest();
    if (bestDepth > best) { best = bestDepth; saveBest(best); }
    saveHighScore(gold);                  // Stage 3: persist high score (gold)
    statDepth.textContent = Math.floor(bestDepth) + '\u043c';
    statGold.textContent = gold;
    statTiles.textContent = tilesCarved;
    statBest.textContent = Math.floor(best) + '\u043c';
    elModalOver.classList.remove('hidden');
  }

  /* ================= HUD ================= */
  function currentDepthM() {
    // depth of the saw tip in meters
    return Math.max(0, (camY + saw.y) / tileSize * cfg.TILE_TO_METERS);
  }

  function updateHUD(forceHearts) {
    var depthM = Math.floor(currentDepthM());
    if (depthM > bestDepth) bestDepth = depthM;
    elDepth.textContent = depthM + '\u043c';
    elGold.textContent = gold;

    if (forceHearts) {
      var s = '';
      for (var i = 0; i < maxHp; i++) {
        s += i < hp ? '<span>&#9829;</span>' : '<span class="lost">&#9829;</span>';
      }
      elHearts.innerHTML = s;
    }

    elHeatFill.style.width = clamp(heat, 0, cfg.HEAT.MAX) + '%';
    elHeatBar.classList.toggle('redline', inRedline());
    elHeatBar.classList.toggle('danger', heat > redlineMax());
    elRedTag.classList.toggle('active', inRedline());
    /* Stage 2: move the CSS redline zone to match the widened RADIATOR zone */
    elHeatBar.style.setProperty('--rl-min', redlineMin() + '%');
    elHeatBar.style.setProperty('--rl-max', redlineMax() + '%');

    refreshShop();
  }

  function refreshShop() {
    Object.keys(shopBtns).forEach(function (key) {
      var btn = shopBtns[key];
      var u = cfg.UPGRADES[key];
      var costEl = btn.querySelector('.shop-btn-cost');
      var lvlEl = btn.querySelector('.lvl-dots');
      if (meta[key] >= u.maxLevel) {
        costEl.textContent = 'MAX';
        btn.classList.add('locked');
        btn.classList.remove('affordable');
      } else {
        var c = upgradeCost(key);
        costEl.textContent = c + 'g';
        btn.classList.toggle('affordable', gold >= c);
        btn.classList.remove('locked');
      }
      if (lvlEl) {
        var dots = '';
        for (var i = 0; i < u.maxLevel; i++) {
          dots += '<i class="lvl-dot' + (i < meta[key] ? ' on' : '') + '"></i>';
        }
        lvlEl.innerHTML = dots;
      }
    });
  }

  function buyUpgrade(key) {
    var u = cfg.UPGRADES[key];
    if (!u || meta[key] === undefined) return;
    if (meta[key] >= u.maxLevel) return;
    var c = upgradeCost(key);
    if (gold < c) return;
    gold -= c;
    meta[key]++;
    saveMeta();
    audio.uiClick();

    /* Stage 2: live mid-run effects */
    if (key === 'radiator') {
      // RADIATOR heals +1 Hull HP on purchase if below max, and also adds a
      // permanent +1 max plate every 3 levels (capped).
      if (meta.radiator % 3 === 0 && maxHp < cfg.PLAYER.MAX_HP_CAP) {
        maxHp++;
        hp = Math.min(hp + 1, maxHp);
      } else if (hp < maxHp) {
        hp++;
      }
      updateHUD(true);
    }
    if (key === 'shock' && meta.shock === 1) {
      shockTimer = 1.5;   // first discharge arrives quickly as a reward
    }
    addFloater(u.name + ' L' + meta[key], '#F2B705');
    var btn = shopBtns[key];
    btn.classList.remove('flash'); void btn.offsetWidth; btn.classList.add('flash');
    updateHUD(false);
  }

  /* ================= FX spawning ================= */
  function addParticle(x, y, vx, vy, color, size, life) {
    if (particles.length >= cfg.FX.MAX_PARTICLES) particles.shift();
    particles.push({ x: x, y: y, vx: vx, vy: vy, c: color, s: size, l: life, ml: life });
  }

  function burstDebris(wx, wy, tileDef, count) {
    for (var i = 0; i < count; i++) {
      var a = rand(0, Math.PI * 2), sp = rand(60, 260);
      addParticle(wx, wy, Math.cos(a) * sp, Math.sin(a) * sp - 80,
        Math.random() < 0.5 ? tileDef.base : tileDef.grit, rand(2, 5), rand(0.35, 0.7));
    }
  }

  function steamPuff(wx, wy) {
    for (var i = 0; i < 14; i++) {
      addParticle(wx + rand(-14, 14), wy + rand(-10, 10),
        rand(-40, 40), rand(-150, -60), '#FFFFFF', rand(3, 7), rand(0.5, 0.9));
    }
  }

  /* Stage 2: emerald shard shower for quartz chain reactions */
  function emeraldShower(wx, wy, count) {
    var palette = ['#1B998B', '#5BC0BE', '#A9E8DF', '#FFFFFF'];
    for (var i = 0; i < count; i++) {
      var a = rand(0, Math.PI * 2), sp = rand(90, 320);
      addParticle(wx, wy, Math.cos(a) * sp, Math.sin(a) * sp - 120,
        palette[i % palette.length], rand(2, 6), rand(0.4, 0.9));
    }
  }

  /* ================= Combo tracking (Stage 2) ================= */
  function registerBreak() {
    comboCount++;
    comboWindowT = cfg.COMBO.WINDOW;
    for (var i = cfg.COMBO.TIERS.length - 1; i >= 0; i--) {
      if (comboCount === cfg.COMBO.TIERS[i].n) {
        comboBadgeText = cfg.COMBO.TIERS[i].label.replace('!', ' x' + comboCount + '!');
        comboBadgeT = 1.6;
        audio.uiClick();
        break;
      }
    }
  }

  /* Flying gold nugget: spawns at the broken tile's SCREEN position and
     curves upward into the top collector (screen-space physics). */
  function spawnNugget(wx, wy, value, kind) {
    nuggets.push({
      x: wx,                        // screen-space (grid x == screen x)
      y: wy - camY,                 // converted from world at spawn time
      vx: rand(-cfg.NUGGET.SPAWN_JITTER, cfg.NUGGET.SPAWN_JITTER),
      vy: rand(-240, -140),
      v: value, kind: kind, t: 0
    });
  }

  function addFloater(text, color, screenX, screenY) {
    /* Random spread so stacked floaters don't collapse into one point */
    var fx = (screenX || W / 2) + rand(-55, 55);
    var fy = (screenY || H * 0.36) + rand(-20, 20);
    floaters.push({ text: text, c: color, t: 0, x: fx, y: fy });
  }

  function tileDefById(id) {
    for (var k in T) { if (T[k].id === id) return T[k]; }
    return T.DIRT;
  }

  /* ================= Tile break logic ================= */
  function breakTile(row, col, viaExplosion) {
    var tile = world.getTile(row, col);
    if (!tile || tile.t === T.EMPTY.id) return;
    var def = tileDefById(tile.t);
    world.setTileEmpty(row, col);
    tilesCarved++;
    delete magmaHeatLatch[row + ':' + col];   // Stage 2: latch dies with the tile

    /* Stage 3: vault gate bookkeeping — HP bar & breach detection */
    if (def.name === 'VAULT_PLATE' || def.name === 'VAULT_CORE') {
      checkVaultBreach();
    }

    var cx = tileWorldX(col) + tileSize / 2;
    var cy = tileWorldY(row) + tileSize / 2;

    burstDebris(cx, cy, def, viaExplosion ? 10 : 7);

    var redlineMult = inRedline() ? cfg.HEAT.NUGGET_REDLINE_MULT : 1;
    var nv = nuggetValue();                   // ORE VACUUM value scaling

    if (def.name === 'GOLD') {
      // Base 2 nuggets (+1 per ORE VACUUM level), doubled inside REDLINE => 2x GOLD NUGGETS
      var count = (2 + extraNuggets()) * redlineMult;
      for (var i = 0; i < count; i++) spawnNugget(cx, cy, nv, 'gold');
    } else if (def.name === 'QUARTZ') {
      spawnNugget(cx, cy, cfg.NUGGET.QUARTZ_CHIP * (nv / cfg.NUGGET.VALUE), 'chip');
      if (extraNuggets()) spawnNugget(cx, cy, nv, 'gold');
      /* Stage 2: emerald chain reaction — adjacent quartz shatters in a
         0.06s cascade with ascending pitch + bonus gold shower. */
      startQuartzChain(row, col);
    } else if (def.name === 'TNT') {
      haptic('heavy');                        // Stage 3: Telegram rumble on TNT
      detonate(row, col);
    } else if (def.name === 'ICE') {
      heat = clamp(heat - 35, 0, cfg.HEAT.MAX);
      steamPuff(cx, cy);
      audio.steamHiss();
      addFloater('-35 HEAT', '#1B998B');
    } else if (def.name === 'SPIKE_MINE') {
      // Broken safely (shockwave/TNT/overheat) or sliced in redline already
      // paid out at contact time; nothing extra here.
      audio.rockBreak(rand(-200, 200));
      spikeBoomFX(cx, cy);
    } else if (def.name === 'MAGMA_ROCK') {
      audio.rockBreak(rand(-200, 200));
      for (var mg = 0; mg < 8; mg++) {
        addParticle(cx + rand(-10, 10), cy + rand(-10, 10), rand(-30, 30), rand(-120, -40),
          Math.random() < 0.5 ? '#E63946' : '#F2B705', rand(2, 5), rand(0.3, 0.7));
      }
      if (Math.random() < 0.25) spawnNugget(cx, cy, nv, 'gold');
    } else {
      audio.rockBreak(rand(-200, 200));
      if (Math.random() < 0.12 * redlineMult) spawnNugget(cx, cy, nv, 'gold');
    }

    registerBreak();                          // Stage 2 combo dopamine
  }

  /* ---------- Stage 2: quartz chain cascade ---------- */
  function startQuartzChain(row, col) {
    queueQuartzNeighbors(row, col);
  }
  function queueQuartzNeighbors(row, col) {
    var dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (var i = 0; i < dirs.length; i++) {
      var r = row + dirs[i][0], c = col + dirs[i][1];
      var t = world.getTile(r, c);
      if (t && t.t === T.QUARTZ.id) {
        // dedupe: same cell may be queued from several sides.
        // FIX: flag-based check — `return` here used to abort the whole loop
        // and silently drop every remaining neighbor of the vein.
        var exists = false;
        for (var j = 0; j < chainQuartz.length; j++) {
          if (chainQuartz[j].r === r && chainQuartz[j].c === c) { exists = true; break; }
        }
        if (!exists) chainQuartz.push({ r: r, c: c, t: cfg.CHAIN.STEP_DELAY });
      }
    }
  }
  function updateChains(dt) {
    if (!chainQuartz.length) { chainPitch = 0; return; }
    // advance timers; fire every step that matured this frame
    var firedAny = false;
    for (var i = chainQuartz.length - 1; i >= 0; i--) {
      var q = chainQuartz[i];
      q.t -= dt;
      if (q.t <= 0) {
        chainQuartz.splice(i, 1);
        var t = world.getTile(q.r, q.c);
        if (t && t.t === T.QUARTZ.id) {
          chainPitch++;
          audio.goldClink(Math.min(chainPitch + 4, 24));  // ascending comboPitch
          var cx = tileWorldX(q.c) + tileSize / 2;
          var cy = tileWorldY(q.r) + tileSize / 2;
          emeraldShower(cx, cy, 12);
          gold += cfg.CHAIN.BONUS_GOLD;                   // instant bonus shimmer
          addFloater('+' + cfg.CHAIN.BONUS_GOLD + ' CHAIN', '#1B998B');
          breakTile(q.r, q.c, true);                      // recursive: chains keep chaining
          firedAny = true;
        }
      }
    }
    if (!firedAny && !chainQuartz.length) chainPitch = 0;
  }

  /* ---------- Stage 2: SHOCK DRILL seismic discharge ---------- */
  function fireShockwave() {
    var sawWorldY = camY + saw.y;                     // world-space blade Y
    var sr = rowAt(sawWorldY), sc = colAt(saw.x);
    var rad = cfg.SHOCK.RADIUS_TILES;
    shockRings.push({ x: saw.x, y: sawWorldY, t: 0 }); // world-space ring FX
    audio.boom();
    shake = Math.min(shake + 5, cfg.FX.MAX_SHAKE);
    addFloater('SHOCK DISCHARGE', '#D96B43');

    for (var r = sr - Math.ceil(rad); r <= sr + Math.ceil(rad); r++) {
      for (var c = sc - Math.ceil(rad); c <= sc + Math.ceil(rad); c++) {
        if (c < 0 || c >= cfg.COLS) continue;
        var dx = c - sc, dy = r - sr;
        if (Math.sqrt(dx * dx + dy * dy) > rad) continue;
        var tile = world.getTile(r, c);
        if (!tile || tile.t === T.EMPTY.id) continue;
        if (tile.t === T.TNT.id) {
          world.setTileEmpty(r, c);
          tilesCarved++;
          detonate(r, c);
        } else if (world.damageTile(tile, cfg.SHOCK.DAMAGE)) {
          breakTile(r, c, true);
        } else {
          // visible chip on survivors
          var px = tileWorldX(c) + tileSize / 2, py = tileWorldY(r) + tileSize / 2;
          addParticle(px, py, rand(-60, 60), rand(-100, -30), tileDefById(tile.t).grit, rand(2, 4), 0.3);
        }
      }
    }
  }

  /* ---------- Stage 2: hazard contact handlers ---------- */
  function magmaTouch(key) {
    if (magmaHeatLatch[key]) return;
    magmaHeatLatch[key] = 1;
    heat = clamp(heat + cfg.HEAT.MAGMA_TOUCH_HEAT, 0, cfg.HEAT.MAX);
    addFloater('+' + cfg.HEAT.MAGMA_TOUCH_HEAT + ' HEAT!', '#E63946');
    audio.uiClick();
    if (heat >= cfg.HEAT.MAX) { overheatExplode(); }
  }
  function spikeHit(row, col) {
    var key = row + ':' + col;
    if (spikeLatch[key]) return;          // already bit (or already sliced)
    spikeLatch[key] = 1;
    var cx = tileWorldX(col) + tileSize / 2;
    var cy = tileWorldY(row) + tileSize / 2;
    if (inRedline()) {
      // SKILL PLAY: molten blade slices straight through the mine
      gold += cfg.SPIKE_SKILL_BONUS;
      addFloater('SKILL! +' + cfg.SPIKE_SKILL_BONUS + 'G', '#F2B705');
      audio.goldClink(10);
      emeraldShower(cx, cy, 10);
      world.setTileEmpty(row, col);
      tilesCarved++;
      registerBreak();
    } else {
      hp--;
      shake = cfg.FX.MAX_SHAKE;
      spikeBoomFX(cx, cy);
      addFloater('MINE! -1 HULL', '#E63946');
      audio.overheat();
      updateHUD(true);
      if (hp <= 0) gameOver();
    }
  }
  function spikeBoomFX(wx, wy) {
    for (var i = 0; i < 12; i++) {
      var a = rand(0, Math.PI * 2), sp = rand(120, 300);
      addParticle(wx, wy, Math.cos(a) * sp, Math.sin(a) * sp,
        ['#8A7563', '#D96B43', '#2B211E'][i % 3], rand(2, 5), rand(0.3, 0.6));
    }
  }

  /* TNT crate: detonates a 3x3 radius with chain reactions */
  var detonating = false;
  function detonate(row, col) {
    if (detonating) return;
    detonating = true;
    audio.boom();
    haptic('heavy');                        // Telegram rumble on TNT explosions
    shake = Math.min(shake + 10, cfg.FX.MAX_SHAKE);

    var queue = [[row, col]];
    var seen = {};
    seen[row + ':' + col] = 1;

    while (queue.length) {
      var rc = queue.shift();
      var r0 = rc[0], c0 = rc[1];
      for (var dr = -1; dr <= 1; dr++) {
        for (var dc = -1; dc <= 1; dc++) {
          var r = r0 + dr, c = c0 + dc;
          if (c < 0 || c >= cfg.COLS) continue;
          var key = r + ':' + c;
          if (seen[key]) continue;
          seen[key] = 1;
          var tile = world.getTile(r, c);
          if (!tile || tile.t === T.EMPTY.id) continue;
          if (tile.t === T.TNT.id) {
            world.setTileEmpty(r, c);
            tilesCarved++;
            burstDebris(tileWorldX(c) + tileSize / 2, tileWorldY(r) + tileSize / 2, T.TNT, 8);
            queue.push([r, c]);
          } else {
            breakTile(r, c, true);
          }
        }
      }
    }

    var ex = tileWorldX(col) + tileSize / 2, ey = tileWorldY(row) + tileSize / 2;
    for (var i = 0; i < 20; i++) {
      var a = rand(0, Math.PI * 2), sp = rand(120, 380);
      addParticle(ex, ey, Math.cos(a) * sp, Math.sin(a) * sp,
        Math.random() < 0.5 ? '#F2B705' : '#E63946', rand(3, 6), rand(0.3, 0.6));
    }
    detonating = false;
  }

  /* Overheat explosion at the saw */
  function overheatExplode() {
    hp--;
    heat = cfg.HEAT.OVERHEAT_RESET;
    audio.overheat();
    haptic('heavy');                        // Stage 3: overheat warning rumble
    shake = cfg.FX.MAX_SHAKE;
    addFloater('OVERHEAT! -1 HULL', '#E63946');

    var sawWorldY = camY + saw.y;                      // world-space blade Y
    var sr = rowAt(sawWorldY), sc = colAt(saw.x);
    for (var r = sr - 2; r <= sr + 2; r++) {
      for (var c = sc - 2; c <= sc + 2; c++) {
        if (c < 0 || c >= cfg.COLS) continue;
        var dx = c - sc, dy = r - sr;
        if (Math.sqrt(dx * dx + dy * dy) <= cfg.HEAT.OVERHEAT_RADIUS * 1.4) {
          var tile = world.getTile(r, c);
          if (tile && tile.t !== T.EMPTY.id) {
            if (tile.t === T.TNT.id) {
              world.setTileEmpty(r, c);
              tilesCarved++;
              detonate(r, c);
            } else {
              breakTile(r, c, true);
            }
          }
        }
      }
    }
    for (var i = 0; i < 26; i++) {
      var a = rand(0, Math.PI * 2), sp = rand(100, 420);
      addParticle(saw.x, sawWorldY, Math.cos(a) * sp, Math.sin(a) * sp,   // world coords
        ['#F2B705', '#D96B43', '#E63946'][i % 3], rand(3, 7), rand(0.4, 0.8));
    }
    updateHUD(true);
    if (hp <= 0) gameOver();
  }

  /* ================= Update ================= */
  function update(dt) {
    var S = cfg.SAW;

    /* --- Heat model (first: it gates this frame's damage multipliers) --- */
    var biomeHeatMult = world.biomeIndexAt(currentDepthM()) === 3 ? cfg.CORE_HEAT_GAIN_MULT : 1; // Molten Core: fast buildup
    if (boost) {
      heat += cfg.HEAT.BOOST_GAIN * heatBuildupFactor() * biomeHeatMult * dt;   // RADIATOR slows buildup
    } else {
      heat -= coolingRate() * dt;                    // released -> slow cool
    }
    heat = clamp(heat, 0, cfg.HEAT.MAX);
    if (heat >= cfg.HEAT.MAX) { overheatExplode(); if (!running) return; }

    /* --- Horizontal steering (drag) --- */
    if (steerTargetX !== null) {
      var err = steerTargetX - saw.x;
      saw.vx += clamp(err * 12, -S.STEER_ACCEL, S.STEER_ACCEL) * dt;
    }
    saw.vx -= saw.vx * S.STEER_DAMP * dt;
    saw.vx = clamp(saw.vx, -S.MAX_VX, S.MAX_VX);
    saw.x += saw.vx * dt;
    saw.x = clamp(saw.x, gridOriginX + saw.r * 0.4,
                       gridOriginX + tileSize * cfg.COLS - saw.r * 0.4);

    /* --- Circle vs grid tile destruction --- */
    var dmgMult = 1;
    if (boost) dmgMult *= S.BOOST_DMG_MULT;         // +150% damage
    if (inRedline()) dmgMult *= S.REDLINE_DMG_MULT; // x3 damage
    var dmg = effectiveDPS() * dmgMult * dt;

    contactThisFrame = false;
    var sawR = saw.r * sawRadiusMult();             // blade grows with TEETH tier
    /* CRITICAL FIX: saw.y is a SCREEN-space coordinate (pinned to the anchor);
       every world calculation must use camY + saw.y. */
    var sawWorldY = camY + saw.y;
    var minR = rowAt(sawWorldY - sawR), maxR = rowAt(sawWorldY + sawR);
    var minC = colAt(saw.x - sawR), maxC = colAt(saw.x + sawR);
    for (var r = Math.max(0, minR); r <= maxR; r++) {
      for (var c = minC; c <= maxC; c++) {
        if (c < 0 || c >= cfg.COLS) continue;
        var tile = world.getTile(r, c);
        if (!tile || tile.t === T.EMPTY.id) continue;
        // closest point on tile AABB to circle center
        var tx = tileWorldX(c), ty = tileWorldY(r);
        var nx = clamp(saw.x, tx, tx + tileSize);
        var ny = clamp(sawWorldY, ty, ty + tileSize);
        var ddx = saw.x - nx, ddy = sawWorldY - ny;
        if (ddx * ddx + ddy * ddy <= sawR * sawR) {
          contactThisFrame = true;
          var def = tileDefById(tile.t);
          if (def.solid) {
            /* Stage 2 hazards first: magma bites heat, mines bite hull.
               A spike mine hit OUTSIDE redline destroys itself and costs HP —
               it must not be chewed like normal rock. */
            if (def.name === 'SPIKE_MINE') {
              spikeHit(r, c);
              if (!running) return;
              if (spikeLatch[r + ':' + c] && !inRedline()) {
                world.setTileEmpty(r, c);   // mine detonates after biting
                delete spikeLatch[r + ':' + c];
                tilesCarved++;
              }
              continue;
            }
            if (def.name === 'MAGMA_ROCK') magmaTouch(r + ':' + c);
            if (!running) return;
            if (world.damageTile(tile, dmg)) breakTile(r, c, false);
          }
        }
      }
    }

    /* --- Vertical descent + camera scroll (rig digs down, view follows) --- */
    var grav = boost ? S.GRAVITY_BOOST : S.GRAVITY_BASE;
    // Tiles in contact with the blade resist the descent: chew through them
    // instead of sliding past untouched (prevents "drilling ghosting").
    if (contactThisFrame) {
      var underRow = rowAt(sawWorldY + sawR * 0.9);   // world space!
      var underTile = world.getTile(underRow, colAt(saw.x));
      var defC = tileDefById(underTile ? underTile.t : T.EMPTY.id);
      if (defC.solid) grav *= clamp(60 / Math.max(defC.hp, 20), 0.18, 0.7);
    }
    saw.y += grav * dt;
    var aY = anchorY();
    if (saw.y > aY) {
      camY += saw.y - aY;   // transfer overflow into camera scroll
      saw.y = aY;           // saw stays pinned near top-center of screen
    }

    /* --- Spin (2.5x under overdrive) --- */
    var targetSpin = S.SPIN_BASE * (boost ? S.SPIN_BOOST_MULT : 1) * (inRedline() ? 1.25 : 1);
    saw.spinSpeed += (targetSpin - saw.spinSpeed) * Math.min(1, dt * 8);
    saw.spin += saw.spinSpeed * dt;

    // Extra friction heat while actually chewing solid rock under overdrive
    if (boost && contactThisFrame) {
      heat = clamp(heat + cfg.HEAT.CONTACT_GAIN * heatBuildupFactor() * dt, 0, cfg.HEAT.MAX);
      if (heat >= cfg.HEAT.MAX) { overheatExplode(); if (!running) return; }
    }

    /* --- Stage 2: SHOCK DRILL passive seismic discharges --- */
    if (meta.shock > 0) {
      shockTimer -= dt;
      if (shockTimer <= 0) {
        fireShockwave();
        shockTimer = shockPeriod();
      }
    }

    /* --- Stage 2: quartz chain cascade timers --- */
    updateChains(dt);

    /* --- Stage 3: boss vault gate timer & breach checks --- */
    updateVault(dt);

    /* --- Stage 3: depth milestone banners --- */
    checkMilestones();
    if (bannerT > 0) bannerT -= dt;

    /* --- Stage 2: combo window decay --- */
    if (comboWindowT > 0) {
      comboWindowT -= dt;
      if (comboWindowT <= 0) comboCount = 0;
    }
    if (comboBadgeT > 0) comboBadgeT -= dt;

    /* --- Stage 2: shock ring FX aging --- */
    for (var si = shockRings.length - 1; si >= 0; si--) {
      shockRings[si].t += dt;
      if (shockRings[si].t > 0.6) shockRings.splice(si, 1);
    }

    /* --- Nuggets: curve upward into the top Gold collector (screen space) --- */
    var collectY = H * cfg.NUGGET.COLLECT_Y_RATIO;
    var mouthX = W / 2;
    var suc = suctionForce();
    for (var i = nuggets.length - 1; i >= 0; i--) {
      var n = nuggets[i];
      n.t += dt;
      var pdx = mouthX - n.x, pdy = (collectY - 10) - n.y;
      var dist = Math.sqrt(pdx * pdx + pdy * pdy) + 1;
      var pull = suc * clamp(1.5 - dist / (H * 1.4), 0.2, 1.5);
      n.vx += (pdx / dist) * pull * dt;
      n.vy += (pdy / dist) * pull * dt;
      n.vy += cfg.NUGGET.GRAVITY * dt * Math.max(0, 1 - n.t * 1.8); // gravity fades as magnet grabs
      n.vx -= n.vx * 0.6 * dt;         // light air drag
      n.vy -= n.vy * 0.6 * dt;
      n.x += n.vx * dt;
      n.y += n.vy * dt;
      if (n.y < collectY + 16 && dist < 110) {
        gold = Math.round(gold + n.v);     // whole-number economy
        clinkStep = Math.min(clinkStep + 1, 24);   // rising pitch combo
        clinkTimer = 0.12;
        audio.goldClink(n.kind === 'gold' ? clinkStep : 0);
        addFloater('+' + n.v, n.kind === 'gold' ? '#F2B705' : '#BFB4A0');
        nuggets.splice(i, 1);
      } else if (n.t > 8) {
        nuggets.splice(i, 1);
      }
    }
    if (clinkTimer > 0) { clinkTimer -= dt; if (clinkTimer <= 0) clinkStep = 0; }

    /* --- Particles (world space) --- */
    for (var p = particles.length - 1; p >= 0; p--) {
      var pt = particles[p];
      pt.vy += cfg.FX.PARTICLE_GRAVITY * dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.l -= dt;
      if (pt.l <= 0) particles.splice(p, 1);
    }

    /* --- Floaters --- */
    for (var f = floaters.length - 1; f >= 0; f--) {
      floaters[f].t += dt;
      if (floaters[f].t > 1.1) floaters.splice(f, 1);
    }

    /* --- World streaming & pruning --- */
    world.ensureRows(rowAt(camY + H) + cfg.ROWS_AHEAD);
    world.prune(rowAt(camY) - 4);

    /* --- Shake decay --- */
    shake = Math.max(0, shake - shake * cfg.FX.SHAKE_DECAY * dt - 2 * dt);

    /* --- Audio hum follows effort --- */
    audio.setHumIntensity(contactThisFrame ? 1 : 0.35, boost);

    /* --- Stall warning: rig stuck and not digging (collapses if idle too long) --- */
    var dNow = currentDepthM();
    if (dNow - lastDepthForStall > 0.4) {
      lastDepthForStall = dNow;
      stallTimer = 0;
      if (elStall) elStall.classList.remove('show');
    } else {
      stallTimer += dt;
      if (elStall) elStall.classList.toggle('show', stallTimer > 3.5);
    }

    updateHUD(false);
  }

  /* Boost sparks (emitted each frame while OVERDRIVE is held) */
  function emitBoostSparks() {
    if (!boost || !running) return;
    var aYw = saw.y + camY; // world y of blade
    var molten = inRedline();
    for (var sp = 0; sp < 2; sp++) {
      var ang = rand(0, Math.PI * 2);
      addParticle(
        saw.x + Math.cos(ang) * saw.r, aYw + Math.sin(ang) * saw.r,
        Math.cos(ang) * rand(80, 200), Math.sin(ang) * rand(40, 120) + 60,
        molten ? '#E63946' : '#F2B705', rand(2, 4), rand(0.15, 0.35));
    }
  }

  /* ================= Render ================= */
  function render() {
    var g = ctx2d;
    g.clearRect(0, 0, W, H);

    var skyGrad = g.createLinearGradient(0, 0, 0, H);
    /* Stage 3: biome background tint — smooth crossfade by depth */
    var bt = biomeTintNow();
    skyGrad.addColorStop(0, bt.main);
    skyGrad.addColorStop(1, bt.deep);
    g.fillStyle = skyGrad;
    g.fillRect(0, 0, W, H);

    var sx = 0, sy = 0;
    if (shake > 0.2) { sx = rand(-shake, shake); sy = rand(-shake, shake); }

    /* ---- World layer (tiles, debris) ---- */
    g.save();
    g.translate(sx, sy - camY);

    /* Stage 2: big semi-transparent combo badge BEHIND the tiles */
    if (comboBadgeT > 0 && comboCount >= 10) drawComboBadge(g);

    var r0 = Math.max(0, rowAt(camY) - 1);
    var r1 = rowAt(camY + H) + 1;
    for (var r = r0; r <= r1; r++) {
      var rowArr = world.getRow(r);
      if (!rowArr) continue;
      for (var c = 0; c < cfg.COLS; c++) {
        var tile = rowArr[c];
        if (!tile || tile.t === T.EMPTY.id) continue;
        drawTile(g, tile, tileWorldX(c), tileWorldY(r));
      }
    }

    /* Stage 3: giant HP bar across the active boss vault gate */
    for (var gi = 0; gi < world.vaults.length; gi++) {
      var gvt = world.vaults[gi];
      if (!gvt.breached && gvt.bottomRow >= r0 - 1 && gvt.topRow <= r1 + 1) {
        drawVaultBar(g, gvt);
      }
    }

    /* Stage 2: expanding seismic shock rings (world space) */
    for (var ringI = 0; ringI < shockRings.length; ringI++) {
      var ring = shockRings[ringI];
      var rp = ring.t / 0.6;
      g.strokeStyle = 'rgba(217,107,67,' + (0.8 * (1 - rp)) + ')';
      g.lineWidth = 5 * (1 - rp) + 1;
      g.beginPath();
      g.arc(ring.x, ring.y, tileSize * cfg.SHOCK.RADIUS_TILES * rp + 6, 0, Math.PI * 2);
      g.stroke();
    }

    // shaft rails
    g.strokeStyle = 'rgba(43,33,30,0.25)';
    g.lineWidth = 3;
    g.setLineDash([10, 8]);
    g.beginPath();
    g.moveTo(gridOriginX - 4, camY); g.lineTo(gridOriginX - 4, camY + H);
    g.moveTo(gridOriginX + tileSize * cfg.COLS + 4, camY);
    g.lineTo(gridOriginX + tileSize * cfg.COLS + 4, camY + H);
    g.stroke();
    g.setLineDash([]);

    // particles
    for (var i = 0; i < particles.length; i++) {
      var pt = particles[i];
      g.globalAlpha = clamp(pt.l / pt.ml, 0, 1);
      g.fillStyle = pt.c;
      g.fillRect(pt.x - pt.s / 2, pt.y - pt.s / 2, pt.s, pt.s);
    }
    g.globalAlpha = 1;
    g.restore();

    /* ---- Screen layer (collector, nuggets, rig, floaters) ---- */
    g.save();
    g.translate(sx, sy);

    var collectY = H * cfg.NUGGET.COLLECT_Y_RATIO;
    drawCollector(g, W / 2, collectY);

    for (var nI = 0; nI < nuggets.length; nI++) {
      var n = nuggets[nI];
      var nx = n.x;
      var ny = n.y;
      if (n.kind === 'gold') {
        g.fillStyle = '#F2B705';
        g.strokeStyle = '#2B211E';
        g.lineWidth = 2;
        g.beginPath(); g.arc(nx, ny, 6, 0, Math.PI * 2); g.fill(); g.stroke();
        g.fillStyle = '#FFF3C4';
        g.beginPath(); g.arc(nx - 2, ny - 2, 2, 0, Math.PI * 2); g.fill();
      } else {
        g.fillStyle = '#EDE6DA';
        g.strokeStyle = '#2B211E';
        g.lineWidth = 2;
        g.fillRect(nx - 4, ny - 4, 8, 8);
        g.strokeRect(nx - 4, ny - 4, 8, 8);
      }
    }

    drawRig(g);
    drawFloaters(g);

    /* Stage 3: Laser Drill Timer + milestone/breach banners (screen layer) */
    if (vaultActive) drawVaultTimer(g);
    if (bannerT > 0) drawBanner(g);

    g.restore();

    /* ---- Redline vignette ---- */
    if (inRedline()) {
      var vg = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.75);
      vg.addColorStop(0, 'rgba(230,57,70,0)');
      vg.addColorStop(1, 'rgba(230,57,70,' + (0.16 + 0.08 * Math.sin(performance.now() / 120)) + ')');
      g.fillStyle = vg;
      g.fillRect(0, 0, W, H);
    }
  }

  function drawTile(g, tile, x, y) {
    var def = tileDefById(tile.t);
    var pad = 1.5;
    var s = tileSize - pad * 2;
    var cx = x + tileSize / 2, cy = y + tileSize / 2;

    g.fillStyle = def.base;
    g.fillRect(x + pad, y + pad, s, s);

    g.strokeStyle = '#2B211E';
    g.lineWidth = 2;
    g.strokeRect(x + pad, y + pad, s, s);

    g.fillStyle = 'rgba(255,255,255,0.22)';
    g.fillRect(x + pad, y + pad, s, 4);
    g.fillStyle = 'rgba(43,33,30,0.18)';
    g.fillRect(x + pad, y + s - 4, s, 4);

    var name = def.name;
    if (name === 'DIRT') {
      g.fillStyle = def.grit;
      gritDots(g, x + pad, y + pad, s, 5);
    } else if (name === 'CLAY') {
      g.strokeStyle = def.edge;
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(x + 6, cy - 6); g.lineTo(x + s - 2, cy - 6);
      g.moveTo(x + 4, cy + 6); g.lineTo(x + s - 6, cy + 6);
      g.stroke();
    } else if (name === 'HARD_ROCK') {
      g.fillStyle = def.edge;
      g.beginPath();
      g.moveTo(cx - 8, cy + 6); g.lineTo(cx - 2, cy - 8); g.lineTo(cx + 8, cy + 4);
      g.closePath(); g.fill();
      g.fillStyle = def.grit;
      g.fillRect(x + 6, y + s - 10, 8, 4);
    } else if (name === 'GOLD') {
      g.fillStyle = def.grit;
      g.beginPath(); g.arc(cx - 7, cy - 5, 4, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(cx + 6, cy + 3, 5, 0, Math.PI * 2); g.fill();
      g.fillStyle = def.edge;
      g.beginPath(); g.arc(cx + 1, cy - 8, 3, 0, Math.PI * 2); g.fill();
    } else if (name === 'QUARTZ') {
      g.fillStyle = '#FFFFFF';
      g.beginPath();
      g.moveTo(cx, cy - 10); g.lineTo(cx + 7, cy); g.lineTo(cx, cy + 10); g.lineTo(cx - 7, cy);
      g.closePath(); g.fill();
      g.strokeStyle = def.edge; g.lineWidth = 2; g.stroke();
    } else if (name === 'TNT') {
      g.fillStyle = '#2B211E';
      g.fillRect(x + pad, cy - 8, s, 16);
      g.fillStyle = '#F2B705';
      g.font = 'bold ' + Math.floor(tileSize * 0.3) + 'px Arial Black';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('TNT', cx, cy + 1);
      g.fillStyle = '#E63946';
      g.beginPath(); g.arc(cx, y + pad + 5, 3, 0, Math.PI * 2); g.fill();
    } else if (name === 'ICE') {
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.beginPath();
      g.moveTo(x + 8, y + 8); g.lineTo(cx, y + 6); g.lineTo(x + s - 8, y + 12);
      g.lineTo(cx + 4, cy + 4); g.closePath(); g.fill();
      g.strokeStyle = '#FFFFFF'; g.lineWidth = 2;
      g.beginPath();
      g.moveTo(cx, cy - 9); g.lineTo(cx, cy + 9);
      g.moveTo(cx - 8, cy - 4); g.lineTo(cx + 8, cy + 4);
      g.moveTo(cx - 8, cy + 4); g.lineTo(cx + 8, cy - 4);
      g.stroke();
    } else if (name === 'MAGMA_ROCK') {
      /* Stage 2: dark red glowing block with pulsing magma veins */
      var pulse = 0.5 + 0.5 * Math.sin(performance.now() / 300 + (x + y));
      g.fillStyle = 'rgba(230,57,70,' + (0.25 + 0.35 * pulse) + ')';
      g.fillRect(x + pad, y + pad, s, s);
      g.strokeStyle = '#E63946';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x + 5, y + 6); g.lineTo(cx - 3, cy); g.lineTo(x + 8, y + s - 6);
      g.moveTo(x + s - 5, y + 8); g.lineTo(cx + 4, cy - 2); g.lineTo(x + s - 9, y + s - 5);
      g.stroke();
      g.fillStyle = 'rgba(242,183,5,' + (0.35 + 0.4 * pulse) + ')';
      g.beginPath(); g.arc(cx, cy, 3 + 2 * pulse, 0, Math.PI * 2); g.fill();
    } else if (name === 'SPIKE_MINE') {
      /* Stage 2: metallic mine embedded in rock — brass drum + danger spikes */
      g.fillStyle = '#8A7563';
      g.fillRect(x + pad, y + pad, s, s);
      g.fillStyle = '#2B211E';
      g.beginPath(); g.arc(cx, cy, s * 0.28, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#D96B43';
      g.lineWidth = 2;
      for (var sk = 0; sk < 8; sk++) {
        var sa = sk * Math.PI / 4;
        g.beginPath();
        g.moveTo(cx + Math.cos(sa) * s * 0.28, cy + Math.sin(sa) * s * 0.28);
        g.lineTo(cx + Math.cos(sa) * s * 0.46, cy + Math.sin(sa) * s * 0.46);
        g.stroke();
      }
      var blink = (performance.now() % 800) < 400 ? 1 : 0.3;
      g.fillStyle = 'rgba(230,57,70,' + blink + ')';
      g.beginPath(); g.arc(cx, cy, 3, 0, Math.PI * 2); g.fill();
    } else if (name === 'VAULT_PLATE') {
      /* Stage 3: reinforced ancient gate plate — espresso steel with brass rivets */
      g.fillStyle = '#6B5744';
      g.fillRect(x + pad, y + pad, s, s);
      g.fillStyle = 'rgba(242,183,5,0.85)';
      var rv = Math.max(3, Math.floor(s * 0.12));
      g.fillRect(x + pad + 4, y + pad + 4, rv, rv);
      g.fillRect(x + pad + s - 4 - rv, y + pad + 4, rv, rv);
      g.fillRect(x + pad + 4, y + pad + s - 4 - rv, rv, rv);
      g.fillRect(x + pad + s - 4 - rv, y + pad + s - 4 - rv, rv, rv);
      g.strokeStyle = 'rgba(43,33,30,0.6)';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(x + pad + 6, cy); g.lineTo(x + pad + s - 6, cy);
      g.stroke();
    } else if (name === 'VAULT_CORE') {
      /* Stage 3: glowing Weak Core — pulsing brass/terracotta heart of the gate */
      var cpul = 0.5 + 0.5 * Math.sin(performance.now() / 180);
      g.fillStyle = mixHex('#F2B705', '#FF4E00', cpul);
      g.fillRect(x + pad, y + pad, s, s);
      g.fillStyle = 'rgba(255,253,249,' + (0.35 + 0.4 * cpul) + ')';
      g.beginPath(); g.arc(cx, cy, s * 0.3 + 3 * cpul, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#2B211E';
      g.lineWidth = 3;
      g.beginPath(); g.arc(cx, cy, s * 0.3 + 3 * cpul, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = 'rgba(43,33,30,0.85)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(cx, y + pad + 3); g.lineTo(cx, y + pad + s - 3);
      g.moveTo(x + pad + 3, cy); g.lineTo(x + pad + s - 3, cy);
      g.stroke();
    }

    var ratio = tile.hp / tile.maxHp;
    if (ratio < 0.999) drawCracks(g, x + pad, y + pad, s, ratio);
  }

  function gritDots(g, x, y, s, seedN) {
    g.globalAlpha = 0.5;
    for (var i = 0; i < seedN; i++) {
      var px = x + ((i * 37 + 13) % Math.max(1, s - 6)) + 3;
      var py = y + ((i * 53 + 7) % Math.max(1, s - 6)) + 3;
      g.fillRect(px, py, 3, 3);
    }
    g.globalAlpha = 1;
  }

  function drawCracks(g, x, y, s, ratio) {
    g.strokeStyle = 'rgba(43,33,30,0.85)';
    g.lineWidth = 2;
    g.beginPath();
    var cx = x + s / 2, cy = y + s / 2;
    var stages = ratio < 0.35 ? 3 : (ratio < 0.7 ? 2 : 1);
    for (var i = 0; i < stages; i++) {
      var a = (i * 2.4 + 0.7);
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a) * s * 0.45, cy + Math.sin(a) * s * 0.45);
      g.lineTo(cx + Math.cos(a + 0.5) * s * 0.3, cy + Math.sin(a + 0.5) * s * 0.3);
    }
    g.stroke();
  }

  function drawCollector(g, mouthX, collectY) {
    g.fillStyle = '#2B211E';
    g.fillRect(mouthX - 40, collectY - 8, 80, 12);
    g.fillStyle = '#F2B705';
    g.fillRect(mouthX - 34, collectY - 4, 68, 6);
    g.fillStyle = '#2B211E';
    g.beginPath();
    g.moveTo(mouthX - 40, collectY + 4);
    g.lineTo(mouthX - 26, collectY + 16);
    g.lineTo(mouthX + 26, collectY + 16);
    g.lineTo(mouthX + 40, collectY + 4);
    g.closePath();
    g.fill();
    g.strokeStyle = '#F2B705';
    g.lineWidth = 2;
    g.stroke();
  }

  function drawRig(g) {
    var aY = saw.y;   // screen-space y of the blade (camera-pinned)
    var molten = inRedline();
    var tier = sawVisualTier();          // Stage 2: brass -> crimson -> plasma
    var r = saw.r * sawRadiusMult();     // Stage 2: blade grows with TEETH level

    /* Gantry arms */
    g.strokeStyle = '#2B211E';
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(saw.x - r - 14, aY - 40); g.lineTo(saw.x - r - 14, aY + 6);
    g.moveTo(saw.x + r + 14, aY - 40); g.lineTo(saw.x + r + 14, aY + 6);
    g.stroke();
    g.fillStyle = '#F2B705';
    g.fillRect(saw.x - r - 20, aY - 46, r * 2 + 40, 10);
    g.strokeStyle = '#2B211E';
    g.lineWidth = 3;
    g.strokeRect(saw.x - r - 20, aY - 46, r * 2 + 40, 10);

    /* Molten glow when hot */
    if (heat > 50 || molten) {
      g.fillStyle = 'rgba(230,57,70,' + (molten ? 0.5 : 0.22) + ')';
      g.beginPath();
      g.arc(saw.x, aY, r * 1.5, 0, Math.PI * 2);
      g.fill();
    }

    /* Stage 2: plasma rim aura at highest visual tier */
    if (tier >= 2) {
      var pl = 0.5 + 0.5 * Math.sin(performance.now() / 90);
      g.strokeStyle = 'rgba(91,192,190,' + (0.35 + 0.35 * pl) + ')';
      g.lineWidth = 4;
      g.beginPath(); g.arc(saw.x, aY, r + 12, 0, Math.PI * 2); g.stroke();
    }

    /* Blade */
    g.save();
    g.translate(saw.x, aY);
    g.rotate(saw.spin);

    var bladeGrad = g.createRadialGradient(0, 0, r * 0.2, 0, 0, r);
    if (molten) {
      bladeGrad.addColorStop(0, '#FFD98A');
      bladeGrad.addColorStop(0.7, '#F2B705');
      bladeGrad.addColorStop(1, '#D96B43');
    } else if (tier === 2) {           // plasma-rimmed blade
      bladeGrad.addColorStop(0, '#EDE6DA');
      bladeGrad.addColorStop(0.7, '#5BC0BE');
      bladeGrad.addColorStop(1, '#1B998B');
    } else if (tier === 1) {           // crimson-tinted steel
      bladeGrad.addColorStop(0, '#F4ECE1');
      bladeGrad.addColorStop(0.75, '#D96B43');
      bladeGrad.addColorStop(1, '#E63946');
    } else {                            // stock brass/steel
      bladeGrad.addColorStop(0, '#EDE6DA');
      bladeGrad.addColorStop(0.75, '#BFB4A0');
      bladeGrad.addColorStop(1, '#8A7563');
    }
    g.fillStyle = bladeGrad;
    g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#2B211E'; g.lineWidth = 3; g.stroke();

    /* Teeth — count evolves every 5 SAW TEETH levels */
    var teeth = sawTeethCount();
    g.fillStyle = molten ? '#E63946' : (tier >= 1 ? '#D96B43' : '#2B211E');
    for (var i = 0; i < teeth; i++) {
      var a = (i / teeth) * Math.PI * 2;
      g.save();
      g.rotate(a);
      g.beginPath();
      g.moveTo(r - 2, -5);
      g.lineTo(r + 8, 0);
      g.lineTo(r - 2, 5);
      g.closePath();
      g.fill();
      g.restore();
    }

    /* Stage 3: motion-blur spinning teeth ring — Steel -> Brass -> Molten
       White-Orange as heat rises. Arcs trail opposite the spin direction. */
    var blurColor;
    if (heat > 75)      blurColor = mixHex('#F2B705', '#FF4E00', clamp((heat - 75) / 25, 0, 1));
    else if (heat > 35) blurColor = mixHex('#2B211E', '#F2B705', clamp((heat - 35) / 40, 0, 1));
    else                blurColor = '#2B211E';
    var blurAlpha = clamp(0.12 + (saw.spinSpeed / 30) * 0.5 + (boost ? 0.2 : 0), 0.1, 0.85);
    g.strokeStyle = blurColor;
    g.globalAlpha = blurAlpha;
    g.lineWidth = 5;
    for (var bl = 0; bl < 4; bl++) {
      var bStart = -saw.spin * (1.6 + bl * 0.35) + bl * 1.1;
      g.beginPath();
      g.arc(0, 0, r + 4 + bl * 3, bStart, bStart + 1.2 + bl * 0.2);
      g.stroke();
    }
    g.globalAlpha = 1;

    /* Hub + bolts */
    g.fillStyle = '#2B211E';
    g.beginPath(); g.arc(0, 0, r * 0.28, 0, Math.PI * 2); g.fill();
    g.fillStyle = molten ? '#F2B705' : '#F4ECE1';
    for (var b = 0; b < 4; b++) {
      var ba = b * Math.PI / 2;
      g.beginPath();
      g.arc(Math.cos(ba) * r * 0.5, Math.sin(ba) * r * 0.5, 3, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  /* Stage 2: big tactile combo badge rendered behind tiles (world layer,
     but positioned relative to the viewport center) */
  function drawComboBadge(g) {
    var cx = W / 2, cy = camY + H * 0.45;
    var pop = clamp((1.6 - comboBadgeT) * 6, 0, 1);
    var scale = 0.8 + 0.25 * pop;
    g.save();
    g.translate(cx, cy);
    g.scale(scale, scale);
    g.globalAlpha = clamp(comboBadgeT * 1.4, 0, 0.55);
    g.font = '900 ' + Math.floor(W * 0.09) + 'px Arial Black';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 10;
    g.strokeStyle = '#2B211E';
    g.strokeText(comboBadgeText, 0, 0);
    g.fillStyle = '#F2B705';
    g.fillText(comboBadgeText, 0, 0);
    // streak counter chip underneath
    g.font = '900 ' + Math.floor(W * 0.05) + 'px Arial Black';
    g.lineWidth = 8;
    g.strokeStyle = '#2B211E';
    var chip = 'x' + comboCount + ' STREAK';
    g.strokeText(chip, 0, Math.floor(W * 0.08));
    g.fillStyle = '#E63946';
    g.fillText(chip, 0, Math.floor(W * 0.08));
    g.restore();
    g.globalAlpha = 1;
  }

  function drawFloaters(g) {
    for (var i = 0; i < floaters.length; i++) {
      var f = floaters[i];
      g.globalAlpha = clamp(1 - f.t / 1.1, 0, 1);
      g.font = '900 16px Arial Black';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 4;
      g.strokeStyle = '#2B211E';
      var fy = f.y - f.t * 40;               // per-floater spawn Y (with jitter)
      var fx = f.x != null ? f.x : W / 2;    // per-floater spawn X (with jitter)
      g.strokeText(f.text, fx, fy);
      g.fillStyle = f.c;
      g.fillText(f.text, fx, fy);
    }
    g.globalAlpha = 1;
  }

  /* ---------- Stage 3 renderers: vault HP bar, laser timer, banners ---------- */
  function drawVaultBar(g, gate) {
    var total = gateTotalHP(gate);
    var rem = clamp(gateRemainingHP(gate), 0, total);
    var bx = gridOriginX + tileSize * 0.5;
    var bw = tileSize * (cfg.COLS - 1);
    var by = tileWorldY(gate.topRow) - 26;
    g.fillStyle = '#2B211E';
    g.fillRect(bx - 4, by - 4, bw + 8, 20);
    g.fillStyle = '#FFFDF9';
    g.fillRect(bx, by, bw, 12);
    var frac = rem / total;
    g.fillStyle = frac > 0.5 ? '#D96B43' : (frac > 0.2 ? '#F2B705' : '#E63946');
    g.fillRect(bx, by, bw * frac, 12);
    g.font = '900 11px Arial Black';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#2B211E';
    g.fillText('ANCIENT VAULT GATE — ' + gate.depthM + 'm', bx + bw / 2, by - 12);
  }

  function drawVaultTimer(g) {
    var t = Math.max(0, vaultActive.timer);
    var frac = t / cfg.VAULT.TIMER_SECONDS;
    var cxp = W / 2, cyp = H * 0.62;
    var urgent = t <= 3;
    g.save();
    if (urgent) g.translate(rand(-2, 2), rand(-2, 2));   // nervous jitter
    g.fillStyle = '#2B211E';
    g.fillRect(cxp - 92, cyp - 26, 184, 52);
    g.fillStyle = '#FFFDF9';
    g.fillRect(cxp - 88, cyp - 22, 176, 44);
    g.font = '900 12px Arial Black';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = urgent ? '#E63946' : '#2B211E';
    g.fillText('LASER DRILL TIMER', cxp, cyp - 12);
    g.font = '900 22px Arial Black';
    g.fillStyle = urgent ? '#E63946' : '#1B998B';
    g.fillText(t.toFixed(1) + 's', cxp, cyp + 8);
    // countdown strip
    g.fillStyle = '#E5D5C3';
    g.fillRect(cxp - 84, cyp + 20, 168, 4);
    g.fillStyle = urgent ? '#E63946' : '#F2B705';
    g.fillRect(cxp - 84, cyp + 20, 168 * frac, 4);
    g.restore();
  }

  function drawBanner(g) {
    var pop = clamp((2.2 - bannerT) * 5, 0, 1);
    var scale = 0.85 + 0.15 * pop;
    var alpha = clamp(bannerT * 1.2, 0, 1);
    g.save();
    g.translate(W / 2, H * 0.28);
    g.scale(scale, scale);
    g.globalAlpha = alpha;
    g.font = '900 ' + Math.floor(W * 0.075) + 'px Arial Black';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 9;
    g.strokeStyle = '#2B211E';
    g.strokeText(bannerText, 0, 0);
    g.fillStyle = bannerColor;
    g.fillText(bannerText, 0, 0);
    g.restore();
    g.globalAlpha = 1;
  }

  /* ---------- Stage 3: Boss Vault Gates — timer, breach, fail states ---------- */
  function gateRemainingHP(gate) {
    /* FIX: breach is decided by the Weak Core ONLY. The side VAULT_PLATE
       armor is shattered automatically on breach (see breachVault), so it
       must not count toward the drill target — otherwise 27 tiles x HP made
       the 12s Laser Drill Timer mathematically impossible. */
    var rem = 0;
    for (var r = gate.topRow; r <= gate.bottomRow; r++) {
      var rowArr = world.getRow(r);
      if (!rowArr) continue;
      for (var c = 0; c < cfg.COLS; c++) {
        var t = rowArr[c];
        if (t && t.t === T.VAULT_CORE.id) rem += Math.max(0, t.hp);
      }
    }
    return rem;
  }

  function gateTotalHP(gate) {
    /* Bar shows just the core pool (4 tiles), scaled with depth like plates */
    var hpScale = world.hpMultAt(gate.depthM);
    return cfg.VAULT.CORE_HP * hpScale * cfg.VAULT.CORE_SIZE * cfg.VAULT.CORE_SIZE;
  }

  function checkVaultBreach() {
    if (!vaultActive) return;
    if (gateRemainingHP(vaultActive.gate) <= 0) breachVault(true);
  }

  function breachVault(onTime) {
    var gate = vaultActive.gate;
    gate.breached = true;
    vaultActive = null;
    /* FIX: the core is dead — auto-shatter ALL remaining side plates of this
       gate in a fireworks salute (no ghost armor left in the corridor). */
    for (var gr = gate.topRow; gr <= gate.bottomRow; gr++) {
      var gRow = world.getRow(gr);
      if (!gRow) continue;
      for (var gc = 0; gc < cfg.COLS; gc++) {
        var gt = gRow[gc];
        if (gt && world.isVaultTile(gt)) breakTile(gr, gc, true);
      }
    }
    var gTopY = tileWorldY(gate.topRow);
    var gMidX = gridOriginX + tileSize * cfg.COLS / 2;

    /* Massive explosion of 50+ gold nuggets across the shattered gate */
    var nCount = cfg.VAULT.REWARD_NUGGETS + 4;
    for (var i = 0; i < nCount; i++) {
      spawnNugget(gMidX + rand(-tileSize * 4, tileSize * 4),
                  gTopY + rand(0, tileSize * cfg.VAULT.THICK_ROWS),
                  nuggetValue(), 'gold');
    }
    shake = Math.min(cfg.FX.MAX_SHAKE, cfg.FX.MAX_SHAKE * 0.9);
    audio.boom();
    haptic('heavy');                        // Telegram rumble on vault breach
    for (var p = 0; p < 26; p++) {
      addParticle(gMidX + rand(-120, 120), gTopY + rand(-20, 60),
        rand(-220, 220), rand(-320, -80),
        Math.random() < 0.6 ? '#F2B705' : '#D96B43', rand(3, 7), rand(0.4, 0.9));
    }

    if (onTime) {
      showBanner('VAULT BREACHED!', '#1B998B');
      addFloater('+' + nCount + ' GOLD', '#F2B705');
      if (hp < maxHp) { hp++; updateHUD(true); addFloater('+1 HULL HP', '#E63946'); }
    } else {
      /* Timer expired: gate still breaks, but the defense laser bites 1 HP */
      showBanner('GATE LASER HIT! -1 HULL', '#E63946');
      hp -= cfg.VAULT.FAIL_HP_DAMAGE;
      heat = clamp(heat + 20, 0, cfg.HEAT.MAX);
      haptic('heavy');
      updateHUD(true);
      if (hp <= 0) { gameOver(); }
    }
  }

  function updateVault(dt) {
    /* Activate a timer when the blade reaches an intact gate */
    if (!vaultActive) {
      var sawR = saw.r * sawRadiusMult();
      var tipRow = rowAt(camY + saw.y + sawR);   // world space!
      for (var vi = 0; vi < world.vaults.length; vi++) {
        var gv = world.vaults[vi];
        if (gv.breached) continue;
        if (tipRow >= gv.topRow && tipRow <= gv.bottomRow + 1) {
          vaultActive = { gate: gv, timer: cfg.VAULT.TIMER_SECONDS };
          showBanner('ANCIENT VAULT GATE — DRILL!', '#F2B705');
          break;
        }
      }
    }
    if (vaultActive) {
      /* FIX: hold the rig at gate level until the Weak Core is dead (or the
         12s timer expires) — otherwise gravity ghosts the blade straight
         through the breach hole while plates are still standing. */
      var vGate = vaultActive.gate;
      var coreRem = gateRemainingHP(vGate);
      var vSawR = saw.r * sawRadiusMult();
      var gateFloorWorldY = tileWorldY(vGate.bottomRow + 1);
      if (coreRem > 0 && camY + saw.y + vSawR * 0.85 > gateFloorWorldY) {
        saw.y = gateFloorWorldY - vSawR * 0.85 - camY;
      }
      vaultActive.timer -= dt;
      if (vaultActive.timer <= 3 && !vaultActive.warned) {
        vaultActive.warned = true;
        haptic('medium');                     // overheat-style warning rumble
      }
      if (vaultActive && vaultActive.timer <= 0) {
        /* Force-shatter every remaining gate tile, then apply the penalty */
        var gate = vaultActive.gate;
        for (var r = gate.topRow; r <= gate.bottomRow; r++) {
          for (var c = 0; c < cfg.COLS; c++) {
            var tl = world.getTile(r, c);
            if (tl && world.isVaultTile(tl)) breakTile(r, c, true);
          }
        }
        if (vaultActive) breachVault(false);
      }
    }
  }

  /* ---------- Stage 3: milestone banners & high score ---------- */
  function showBanner(text, color) {
    bannerText = text; bannerColor = color || '#F2B705'; bannerT = 2.2;
  }

  function checkMilestones() {
    var d = Math.floor(currentDepthM());
    var step = cfg.MILESTONE_STEP_M;
    var ms = Math.floor(d / step) * step;
    if (ms > lastMilestone && d >= ms) {
      lastMilestone = ms;
      showBanner(ms + 'm REACHED!', '#D96B43');
      var bi = world.biomeIndexAt(d);
      if (bi > 0 && Math.abs(d - cfg.BIOMES[bi].minDepth) < 15) {
        showBanner(cfg.BIOMES[bi].name, '#1B998B');
      }
    }
  }

  function loadHighScore() {
    try { return parseFloat(localStorage.getItem(cfg.HIGHSCORE_KEY)) || 0; } catch (e) { return 0; }
  }
  function saveHighScore(g) {
    try { if (g > loadHighScore()) localStorage.setItem(cfg.HIGHSCORE_KEY, String(Math.floor(g))); } catch (e) {}
  }

  /* ================= Main loop ================= */
  function loop(t) {
    if (!running) return;
    var dt = Math.min(0.033, (t - lastTime) / 1000);
    lastTime = t;
    if (dt > 0) {
      update(dt);
      emitBoostSparks();
    }
    if (running) {
      render();
      requestAnimationFrame(loop);
    }
  }

  /* ================= Init ================= */
  function init() {
    canvas = document.getElementById('game');
    ctx2d = canvas.getContext('2d');
    stageEl = document.getElementById('stage');

    elDepth = document.getElementById('hud-depth');
    elGold = document.getElementById('hud-gold');
    elHearts = document.getElementById('hud-hearts');
    elHeatBar = document.getElementById('heat-bar');
    elHeatFill = document.getElementById('heat-fill');
    elRedTag = document.getElementById('redline-tag');
    elModalOver = document.getElementById('modal-runover');
    elModalStart = document.getElementById('modal-start');
    elBoostHint = document.getElementById('boost-hint');
    elStall = document.getElementById('stall-warning');
    statDepth = document.getElementById('stat-depth');
    statGold = document.getElementById('stat-gold');
    statTiles = document.getElementById('stat-tiles');
    statBest = document.getElementById('stat-best');

    Array.prototype.forEach.call(document.querySelectorAll('.shop-btn'), function (btn) {
      var key = btn.getAttribute('data-upgrade');
      shopBtns[key] = btn;
      var dots = document.createElement('span');
      dots.className = 'lvl-dots';
      btn.appendChild(dots);
      btn.addEventListener('click', function () { audio.resume(); buyUpgrade(key); });
    });

    var muteBtn = document.getElementById('btn-mute');
    if (muteBtn) {
      muteBtn.addEventListener('click', function () {
        var m = audio.toggleMute();
        this.classList.toggle('off', m);
        if (!m && running) { audio.resume(); audio.startHum(); }
      });
    }

    document.getElementById('btn-start').addEventListener('click', startGame);
    document.getElementById('btn-restart').addEventListener('click', startGame);

    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('touchstart', onDown, { passive: false });
    canvas.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
    window.addEventListener('blur', onUp);

    window.addEventListener('resize', function () { resize(); if (!running) renderIdle(); });

    resize();
    world.reset();
    renderIdle();
  }

  /* Static preview behind the start modal */
  function renderIdle() {
    resize();
    tileSize = Math.max(8, tileSize);   // guard against zero-size during early layout
    saw.x = W / 2;
    saw.y = 0;
    camY = -anchorY();
    world.ensureRows(rowAt(camY + H) + 2);
    render();
  }

  window.CB.game = { init: init };
})();
