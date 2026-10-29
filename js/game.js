(function () {
  'use strict';
  window.CB = window.CB || {};
  var cfg = window.CB.config;
  var world = window.CB.world;
  var audio = window.CB.audio;
  var T = cfg.TILES;

  var canvas, ctx2d, stageEl;
  var elDepth, elGold, elHearts, elHeatBar, elHeatFill, elRedTag;
  var elModalOver, elModalStart, elBoostHint, elStallWarn;
  var statDepth, statGold, statTiles, statBest;
  var shopBtns = {};

  var W = 0, H = 0, DPR = 1;
  var tileSize = 40, gridOriginX = 0;

  var running = false;
  var lastTime = 0;
  /* saw.wy — честная мировая координата Y (никакой путаницы с экраном!) */
  var saw = { x: 0, y: 0, wy: 0, vx: 0, r: 28, spin: 0, spinSpeed: 0 };
  var camY = 0;
  var heat = 0;
  var hp = 3, maxHp = 3;
  var gold = 0;
  var tilesCarved = 0;
  var bestDepth = 0;
  var boost = false;
  var steerTargetX = null;
  var pointerActive = false;
  var shake = 0;
  var contactThisFrame = false;

  var stallTimer = 0;
  var chainQuartz = [];
  var chainPitch = 0;
  var shockTimer = 0;
  var shockRings = [];
  var magmaHeatLatch = {};
  var spikeLatch = {};
  var meta = { dps: 0, radiator: 0, vacuum: 0, shock: 0 };
  var clinkStep = 0, clinkTimer = 0;

  var vaultActive = null;
  var lastMilestone = 0;
  var bannerT = 0;
  var renderDt = 1 / 60;   /* дельта последнего кадра — для затухания баннера в render() */
  var bannerText = '';
  var bannerColor = '#F2B705';

  var particles = [];
  var nuggets = [];
  var floaters = [];

  var tw = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;
  if (tw) { try { tw.ready(); tw.expand(); } catch (e) {} }

  function haptic(kind) {
    if (!tw || !tw.HapticFeedback) return;
    try {
      if (kind === 'heavy') tw.HapticFeedback.impactOccurred('heavy');
      else if (kind === 'light') tw.HapticFeedback.notificationOccurred('success');
      else tw.HapticFeedback.impactOccurred('medium');
    } catch (e) {}
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function rand(a, b) { return a + Math.random() * (b - a); }

  function loadBest() {
    try { return parseFloat(localStorage.getItem(cfg.STORAGE.BEST)) || 0; } catch (e) { return 0; }
  }
  function saveBest(v) {
    try { localStorage.setItem(cfg.STORAGE.BEST, String(Math.floor(v))); } catch (e) { return 0; }
  }

  function upgradeCost(key) {
    var u = cfg.UPGRADES[key];
    return Math.floor(u.baseCost * Math.pow(u.costMult, meta[key]));
  }

  function effectiveDPS() {
    /* Эволюция урона: линейный рост за уровень + мультипликативный
       Milestone бонус x1.25 за каждые 5 уровней зубьев */
    var tierBonus = Math.pow(1.25, Math.floor(meta.dps / 5));
    return cfg.SAW.DPS_BASE * (1 + meta.dps * cfg.UPGRADES.dps.effect) * tierBonus;
  }
  function sawTeethCount() { return cfg.SAW.TEETH + Math.floor(meta.dps / 5) * 4; }
  function sawRadiusMult() { return 1 + Math.floor(meta.dps / 5) * 0.10; }
  function coolingRate() { return cfg.HEAT.IDLE_COOL * (1 + meta.radiator * 0.18); }
  function heatBuildupFactor() { return Math.max(0.4, 1 - meta.radiator * cfg.HEAT.RAD_BUILD_REDUCE); }
  function redlineMin() { return meta.radiator >= 5 ? 70 : cfg.HEAT.REDLINE_MIN; }
  function redlineMax() { return meta.radiator >= 5 ? 96 : cfg.HEAT.REDLINE_MAX; }
  function nuggetValue() {
    return Math.max(1, Math.round((1 + meta.vacuum * 0.35) * (1 + Math.floor(currentDepthM() / 300))));
  }
  function extraNuggets() { return meta.vacuum >= 1 ? 1 : 0; }
  function suctionForce() { return cfg.NUGGET.SUCTION_BASE * (1 + meta.vacuum * 0.2); }
  function shockPeriod() {
    if (meta.shock <= 0) return Infinity;
    return Math.max(cfg.SHOCK.MIN_PERIOD, cfg.SHOCK.BASE_PERIOD - (meta.shock - 1) * cfg.SHOCK.PERIOD_PER_LEVEL);
  }
  function inRedline() { return heat >= redlineMin() && heat <= redlineMax(); }
  function anchorY() { return H * cfg.SAW.ANCHOR_Y_RATIO; }

  function rowAt(worldY) { return Math.floor(worldY / tileSize); }
  function colAt(worldX) { return Math.floor((worldX - gridOriginX) / tileSize); }
  function tileWorldX(col) { return gridOriginX + col * tileSize; }
  function tileWorldY(row) { return row * tileSize; }

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

  function resetRun() {
    world.reset();
    resize();
    saw.x = W / 2;
    saw.wy = 0;
    saw.y = anchorY();
    camY = -anchorY();
    saw.vx = 0; saw.spin = 0; saw.spinSpeed = cfg.SAW.SPIN_BASE;
    heat = 0;
    maxHp = cfg.PLAYER.START_HP;
    hp = maxHp;
    gold = cfg.PLAYER.START_GOLD;
    tilesCarved = 0;
    bestDepth = 0;
    stallTimer = 0;
    meta = { dps: 0, radiator: 0, vacuum: 0, shock: 0 };
    boost = false; pointerActive = false; steerTargetX = null;
    particles.length = 0; nuggets.length = 0; floaters.length = 0;
    shake = 0;
    chainQuartz.length = 0; chainPitch = 0;
    shockTimer = shockPeriod();
    shockRings.length = 0;
    magmaHeatLatch = {}; spikeLatch = {};
    vaultActive = null; lastMilestone = 0; bannerT = 0;
    elBoostHint.classList.remove('hidden');
    elStallWarn.style.display = 'none';
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
    elStallWarn.style.display = 'none';
    var best = loadBest();
    if (bestDepth > best) { best = bestDepth; saveBest(best); }
    statDepth.textContent = Math.floor(bestDepth) + 'м';
    statGold.textContent = gold;
    statTiles.textContent = tilesCarved;
    statBest.textContent = Math.floor(best) + 'м';
    elModalOver.classList.remove('hidden');
  }

  function currentDepthM() {
    return Math.max(0, saw.wy / tileSize * cfg.TILE_TO_METERS);
  }

  function updateHUD(forceHearts) {
    var depthM = Math.floor(currentDepthM());
    if (depthM > bestDepth) bestDepth = depthM;
    elDepth.textContent = depthM + 'м';
    elGold.textContent = gold;
    if (forceHearts) {
      var s = '';
      for (var i = 0; i < maxHp; i++) {
        s += i < hp ? '<span>♥</span>' : '<span class="lost">♥</span>';
      }
      elHearts.innerHTML = s;
    }
    elHeatFill.style.width = clamp(heat, 0, cfg.HEAT.MAX) + '%';
    elHeatBar.classList.toggle('redline', inRedline());
    elHeatBar.classList.toggle('danger', heat > redlineMax());
    elRedTag.classList.toggle('active', inRedline());
    refreshShop();
  }

  function refreshShop() {
    var lvlIds = { dps: 'lvl-dps', radiator: 'lvl-radiator', vacuum: 'lvl-vacuum', shock: 'lvl-shock' };
    Object.keys(shopBtns).forEach(function (key) {
      var btn = shopBtns[key];
      var u = cfg.UPGRADES[key];
      var costEl = btn.querySelector('.shop-btn-cost');
      var lvlEl = document.getElementById(lvlIds[key]);
      if (lvlEl) lvlEl.textContent = 'УР. ' + meta[key];
      if (meta[key] >= u.maxLevel) {
        costEl.textContent = 'МАКС';
        btn.classList.add('locked');
        btn.classList.remove('affordable');
      } else {
        var c = upgradeCost(key);
        costEl.textContent = c;
        btn.classList.toggle('affordable', gold >= c);
        btn.classList.remove('locked');
      }
    });
    /* Красная зона шкалы нагрева следует за апгрейдом радиатора */
    if (elHeatBar) {
      elHeatBar.style.setProperty('--rl-min', redlineMin() + '%');
      elHeatBar.style.setProperty('--rl-max', redlineMax() + '%');
    }
  }

  function buyUpgrade(key) {
    var u = cfg.UPGRADES[key];
    if (!u || meta[key] === undefined || meta[key] >= u.maxLevel) return;
    var c = upgradeCost(key);
    if (gold < c) return;
    gold -= c;
    meta[key]++;
    audio.uiClick();
    if (key === 'radiator') {
      if (hp < maxHp) hp++;
      updateHUD(true);
    }
    if (key === 'shock' && meta.shock === 1) {
      shockTimer = 1.5;
    }
    addFloater(u.name + ' УР.' + meta[key], '#F2B705');
    updateHUD(false);
  }

  function addParticle(x, y, vx, vy, color, size, life) {
    if (particles.length >= cfg.FX.MAX_PARTICLES) particles.shift();
    particles.push({ x: x, y: y, vx: vx, vy: vy, c: color, s: size, l: life, ml: life });
  }

  function burstDebris(wx, wy, tileDef, count) {
    for (var i = 0; i < count; i++) {
      var a = rand(0, Math.PI * 2), sp = rand(60, 240);
      addParticle(wx, wy, Math.cos(a) * sp, Math.sin(a) * sp - 70,
        Math.random() < 0.5 ? tileDef.base : tileDef.grit, rand(2, 4.5), rand(0.3, 0.65));
    }
  }

  function crackBurst(wx, wy, tileDef) {
    if (Math.random() > 0.45) return;
    var a = rand(-Math.PI, 0), sp = rand(40, 130);
    addParticle(wx, wy, Math.cos(a) * sp, Math.sin(a) * sp - 30,
      tileDef.grit || '#4C3D2E', rand(1.5, 3), rand(0.18, 0.35));
  }

  function steamPuff(wx, wy) {
    for (var i = 0; i < 14; i++) {
      addParticle(wx + rand(-14, 14), wy + rand(-10, 10),
        rand(-40, 40), rand(-150, -60), '#FFFFFF', rand(3, 6), rand(0.45, 0.85));
    }
  }

  function emeraldShower(wx, wy, count) {
    var palette = ['#1B998B', '#5BC0BE', '#A9E8DF', '#FFFFFF'];
    for (var i = 0; i < count; i++) {
      var a = rand(0, Math.PI * 2), sp = rand(80, 280);
      addParticle(wx, wy, Math.cos(a) * sp, Math.sin(a) * sp - 100,
        palette[i % palette.length], rand(2, 5), rand(0.35, 0.8));
    }
  }

  function spawnNugget(wx, wy, value, kind) {
    nuggets.push({
      x: wx,
      y: wy - camY,
      vx: rand(-cfg.NUGGET.SPAWN_JITTER, cfg.NUGGET.SPAWN_JITTER),
      vy: rand(-220, -120),
      v: value, kind: kind, t: 0
    });
  }

  function addFloater(text, color, screenX, screenY) {
    var fx = (screenX || W / 2) + rand(-45, 45);
    var fy = (screenY || H * 0.36) + rand(-15, 15);
    floaters.push({ text: text, c: color, t: 0, x: fx, y: fy });
  }

  function tileDefById(id) {
    for (var k in T) { if (T[k].id === id) return T[k]; }
    return T.DIRT;
  }

  function breakTile(row, col, viaExplosion) {
    var tile = world.getTile(row, col);
    if (!tile || tile.t === T.EMPTY.id) return;
    var def = tileDefById(tile.t);
    world.setTileEmpty(row, col);
    tilesCarved++;
    stallTimer = Math.max(0, stallTimer - 0.9);
    delete magmaHeatLatch[row + ':' + col];

    var cx = tileWorldX(col) + tileSize / 2;
    var cy = tileWorldY(row) + tileSize / 2;
    burstDebris(cx, cy, def, viaExplosion ? 9 : 6);

    var redlineMult = inRedline() ? cfg.HEAT.NUGGET_REDLINE_MULT : 1;
    var nv = nuggetValue();

    if (def.name === 'GOLD') {
      var count = (2 + extraNuggets()) * redlineMult;
      for (var i = 0; i < count; i++) spawnNugget(cx, cy, nv, 'gold');
    } else if (def.name === 'QUARTZ') {
      spawnNugget(cx, cy, cfg.NUGGET.QUARTZ_CHIP * nv, 'chip');
      startQuartzChain(row, col);
    } else if (def.name === 'TNT') {
      detonate(row, col, viaExplosion);
    } else if (def.name === 'ICE') {
      heat = clamp(heat - 35, 0, cfg.HEAT.MAX);
      steamPuff(cx, cy);
      audio.steamHiss();
      addFloater('-35 НАГРЕВ ❄', '#1B998B');
    } else if (def.name === 'MAGMA_ROCK') {
      audio.rockBreak(rand(-200, 200));
      if (Math.random() < 0.35) spawnNugget(cx, cy, nv, 'gold');
    } else {
      audio.rockBreak(rand(-200, 200));
      if (Math.random() < 0.14 * redlineMult) spawnNugget(cx, cy, nv, 'gold');
    }
  }

  function startQuartzChain(row, col) {
    var dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (var i = 0; i < dirs.length; i++) {
      var r = row + dirs[i][0], c = col + dirs[i][1];
      var t = world.getTile(r, c);
      if (t && t.t === T.QUARTZ.id) {
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
    for (var i = chainQuartz.length - 1; i >= 0; i--) {
      var q = chainQuartz[i];
      q.t -= dt;
      if (q.t <= 0) {
        chainQuartz.splice(i, 1);
        var t = world.getTile(q.r, q.c);
        if (t && t.t === T.QUARTZ.id) {
          chainPitch++;
          audio.goldClink(Math.min(chainPitch + 4, 24));
          var cx = tileWorldX(q.c) + tileSize / 2;
          var cy = tileWorldY(q.r) + tileSize / 2;
          emeraldShower(cx, cy, 10);
          gold += cfg.CHAIN.BONUS_GOLD;
          addFloater('+' + cfg.CHAIN.BONUS_GOLD + ' КВАРЦ!', '#1B998B');
          breakTile(q.r, q.c, true);
        }
      }
    }
  }

  function fireShockwave() {
    var sr = rowAt(saw.wy), sc = colAt(saw.x);
    var rad = cfg.SHOCK.RADIUS_TILES;
    shockRings.push({ x: saw.x, y: saw.wy, t: 0 });
    audio.boom();
    shake = Math.min(shake + 5, cfg.FX.MAX_SHAKE);
    addFloater('СЕЙСМО-УДАР!', '#D96B43');
    for (var r = sr - Math.ceil(rad); r <= sr + Math.ceil(rad); r++) {
      for (var c = sc - Math.ceil(rad); c <= sc + Math.ceil(rad); c++) {
        if (c < 0 || c >= cfg.COLS) continue;
        var dx = c - sc, dy = r - sr;
        if (Math.sqrt(dx * dx + dy * dy) > rad) continue;
        var tile = world.getTile(r, c);
        if (!tile || tile.t === T.EMPTY.id) continue;
        if (tile.t === T.TNT.id) {
          breakTile(r, c, true);
        } else {
          /* Урон сейсмо-удара растет от уровня пилы и самого шока */
          var shockDmg = cfg.SHOCK.DAMAGE * (1 + meta.dps * 0.25) * (1 + meta.shock * 0.2);
          if (world.damageTile(tile, shockDmg)) {
            breakTile(r, c, true);
          }
        }
      }
    }
  }

  function magmaTouch(key) {
    if (magmaHeatLatch[key]) return;
    magmaHeatLatch[key] = 1;
    heat = clamp(heat + cfg.HEAT.MAGMA_TOUCH_HEAT, 0, cfg.HEAT.MAX);
    addFloater('+' + cfg.HEAT.MAGMA_TOUCH_HEAT + ' МАГМА!', '#E63946');
    audio.uiClick();
    if (heat >= cfg.HEAT.MAX) overheatExplode();
  }

  function spikeHit(row, col) {
    var key = row + ':' + col;
    if (spikeLatch[key]) return;
    spikeLatch[key] = 1;
    var cx = tileWorldX(col) + tileSize / 2;
    var cy = tileWorldY(row) + tileSize / 2;
    if (inRedline()) {
      gold += cfg.SPIKE_SKILL_BONUS;
      addFloater('РАСПИЛ МИНЫ! +' + cfg.SPIKE_SKILL_BONUS, '#F2B705');
      audio.goldClink(10);
      emeraldShower(cx, cy, 10);
      world.setTileEmpty(row, col);
      tilesCarved++;
    } else {
      hp--;
      shake = cfg.FX.MAX_SHAKE;
      addFloater('МИНА! -1 СЕРДЦЕ', '#E63946');
      audio.overheat();
      haptic('heavy');
      world.setTileEmpty(row, col);
      updateHUD(true);
      if (hp <= 0) gameOver();
    }
  }

  var detonating = false;
  function detonate(row, col, viaChain) {
    if (detonating) return;
    detonating = true;
    audio.boom();
    haptic('heavy');
    shake = Math.min(shake + 10, cfg.FX.MAX_SHAKE);

    if (!viaChain && !inRedline()) {
      hp--;
      addFloater('ВЗРЫВ В УПОР! -1 СЕРДЦЕ', '#E63946');
      updateHUD(true);
      if (hp <= 0) { detonating = false; gameOver(); return; }
    } else if (!viaChain && inRedline()) {
      addFloater('ВЗРЫВ В ТУРБО!', '#F2B705');
    }

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
            queue.push([r, c]);
          } else {
            breakTile(r, c, true);
          }
        }
      }
    }
    detonating = false;
  }

  function overheatExplode() {
    hp--;
    heat = cfg.HEAT.OVERHEAT_RESET;
    audio.overheat();
    haptic('heavy');
    shake = cfg.FX.MAX_SHAKE;
    addFloater('ПЕРЕГРЕВ! -1 СЕРДЦЕ', '#E63946');
    var sr = rowAt(saw.wy), sc = colAt(saw.x);
    for (var r = sr - 2; r <= sr + 2; r++) {
      for (var c = sc - 2; c <= sc + 2; c++) {
        if (c < 0 || c >= cfg.COLS) continue;
        var tile = world.getTile(r, c);
        if (tile && tile.t !== T.EMPTY.id) breakTile(r, c, true);
      }
    }
    updateHUD(true);
    if (hp <= 0) gameOver();
  }

  function triggerCaveIn() {
    hp--;
    shake = 14;
    audio.overheat();
    haptic('heavy');
    addFloater('ОБВАЛ ПОРОДЫ! -1 СЕРДЦЕ', '#E63946');
    var sr = rowAt(saw.wy), sc = colAt(saw.x);
    for (var r = sr; r <= sr + 1; r++) {
      for (var c = Math.max(0, sc - 1); c <= Math.min(cfg.COLS - 1, sc + 1); c++) {
        var tile = world.getTile(r, c);
        if (tile && tile.t !== T.EMPTY.id) breakTile(r, c, true);
      }
    }
    updateHUD(true);
    if (hp <= 0) gameOver();
  }

  function showBanner(text, color) {
    bannerText = text;
    bannerColor = color || '#F2B705';
    bannerT = 2.4;
  }

  /* ---------- МЕХАНИКА БОСС-ШЛЮЗА (VAULT_GATE каждые 250м) ---------- */
  function vaultCoreCells(gv) {
    var cells = [];
    for (var dr = 0; dr < cfg.VAULT.CORE_SIZE; dr++) {
      for (var dc = 0; dc < cfg.VAULT.CORE_SIZE; dc++) {
        cells.push({ r: gv.coreRow + dr, c: gv.coreCol + dc });
      }
    }
    return cells;
  }

  function vaultCoreHP(gv) {
    var cur = 0, max = 0, alive = 0;
    var cells = vaultCoreCells(gv);
    for (var i = 0; i < cells.length; i++) {
      var t = world.getTile(cells[i].r, cells[i].c);
      if (t && t.t === T.VAULT_CORE.id) {
        cur += t.hp; max += (t.maxHp || t.hp); alive++;
      } else {
        max += cfg.VAULT.CORE_HP; /* уничтоженная клетка не учитывается в прогрессе */
      }
    }
    return { cur: cur, max: max, alive: alive };
  }

  function shatterVaultPlates(gv) {
    for (var r = gv.topRow; r <= gv.bottomRow; r++) {
      for (var c = 0; c < cfg.COLS; c++) {
        var t = world.getTile(r, c);
        if (t && t.t === T.VAULT_PLATE.id) breakTile(r, c, true);
      }
    }
  }

  function breachVault(gv) {
    gv.breached = true;
    vaultActive = null;
    shatterVaultPlates(gv);
    /* Фонтан из 30 золотых самородков из центра шлюза */
    var cx = tileWorldX(Math.floor(cfg.COLS / 2)) + tileSize / 2;
    var cy = tileWorldY(gv.topRow + Math.floor(cfg.VAULT.THICK_ROWS / 2));
    var nv = nuggetValue();
    for (var i = 0; i < 30; i++) {
      spawnNugget(cx + rand(-tileSize * 1.5, tileSize * 1.5), cy + rand(-8, 8), nv, 'gold');
    }
    /* +1 сердце прочности за прорыв */
    if (hp < maxHp) { hp++; updateHUD(true); }
    gold = Math.round(gold + cfg.VAULT.INTERVAL_M * 0.2);
    audio.boom();
    shake = Math.min(shake + 9, cfg.FX.MAX_SHAKE);
    haptic('heavy');
    addFloater('ЗОЛОТОЙ ШЛЮЗ ОТКРЫТ!', '#F2B705');
    showBanner('ШЛЮЗ ПРОБИТ! +БОНУС!', '#F2B705');
  }

  function vaultLaserFail(gv) {
    gv.breached = true;
    vaultActive = null;
    shatterVaultPlates(gv);
    hp -= cfg.VAULT.FAIL_HP_DAMAGE;
    updateHUD(true);
    audio.boom();
    shake = Math.min(shake + 12, cfg.FX.MAX_SHAKE);
    haptic('heavy');
    addFloater('ЛАЗЕР ШЛЮЗА!', '#E63946');
    showBanner('ЛАЗЕР ШЛЮЗА! -1 СЕРДЦЕ', '#E63946');
    if (hp <= 0) gameOver();
  }

  function updateVault(dt, sawR) {
    var sawBottomRow = rowAt(saw.wy + sawR);
    if (!vaultActive) {
      /* Активируем ближайший неразрушенный шлюз, когда пила долетела до его верха */
      var best = null;
      for (var i = 0; i < world.vaults.length; i++) {
        var gv = world.vaults[i];
        if (gv.breached) continue;
        if (sawBottomRow >= gv.topRow && (best === null || gv.topRow > best.topRow)) best = gv;
      }
      if (best) {
        vaultActive = { gate: best, timer: cfg.VAULT.TIMER_SECONDS };
        showBanner('⚠ ШЛЮЗ ' + best.depthM + 'м — ШТУРМ!', '#D96B43');
        addFloater('БОСС-ШЛЮЗ: БЕЙ ЯДРО!', '#E63946');
        audio.uiClick();
        haptic('heavy');
      }
    } else {
      var gate = vaultActive.gate;
      if (gate.breached) { vaultActive = null; return; }
      /* Ядро пробито? */
      var cores = vaultCoreHP(gate);
      if (cores.alive === 0) { breachVault(gate); return; }
      /* Таймер обратного отсчёта */
      vaultActive.timer -= dt;
      if (vaultActive.timer <= 0) { vaultLaserFail(gate); return; }
    }
  }

  /* Полоска HP ядра + таймер штурма над активным шлюзом (мирское пространство) */
  function drawVaultOverlay(g) {
    if (!vaultActive || !running) return;
    var gv = vaultActive.gate;
    if (gv.breached) return;
    var cores = vaultCoreHP(gv);
    var barW = tileSize * 3.2;
    var bx = tileWorldX(Math.floor(cfg.COLS / 2)) + tileSize / 2 - barW / 2;
    var by = tileWorldY(gv.topRow) - 26;
    var frac = clamp(cores.cur / (cores.max || 1), 0, 1);

    g.fillStyle = 'rgba(43,33,30,0.85)';
    g.fillRect(bx - 3, by - 3, barW + 6, 12);
    g.fillStyle = '#E63946';
    g.fillRect(bx, by, barW, 6);
    g.fillStyle = '#F2B705';
    g.fillRect(bx, by, barW * frac, 6);
    g.strokeStyle = '#2B211E';
    g.lineWidth = 1.5;
    g.strokeRect(bx - 3, by - 3, barW + 6, 12);

    g.font = '900 11px sans-serif';
    g.textAlign = 'center';
    var label = 'ШТУРМ ШЛЮЗА: ' + Math.max(0, vaultActive.timer).toFixed(1) + 'с';
    var lw = g.measureText(label).width;
    g.fillStyle = 'rgba(43,33,30,0.8)';
    g.fillRect(bx + barW / 2 - lw / 2 - 6, by - 22, lw + 12, 16);
    g.fillStyle = vaultActive.timer < 4 ? '#E63946' : '#FFF3C4';
    g.fillText(label, bx + barW / 2, by - 10);
  }

  /* ============================================================
     ПЛАВНЫЙ UPDATE БЕЗ ТЕЛЕПОРТОВ:
     Раздельные шаги по X и по Y с ограничением скорости спуска.
     ============================================================ */
  function update(dt) {
    var S = cfg.SAW;

    /* 1. Нагрев */
    if (boost) {
      heat += cfg.HEAT.BOOST_GAIN * heatBuildupFactor() * dt;
    } else {
      heat -= coolingRate() * dt;
    }
    heat = clamp(heat, 0, cfg.HEAT.MAX);
    if (heat >= cfg.HEAT.MAX) { overheatExplode(); if (!running) return; }

    var sawR = saw.r * sawRadiusMult();
    var dmgMult = 1;
    if (boost) dmgMult *= S.BOOST_DMG_MULT;
    if (inRedline()) dmgMult *= S.REDLINE_DMG_MULT;
    var dmg = effectiveDPS() * dmgMult * dt;

    /* 2. Горизонтальное руление (ось X) + мягкий упор в боковые стенки */
    if (steerTargetX !== null) {
      var err = steerTargetX - saw.x;
      saw.vx += clamp(err * 12, -S.STEER_ACCEL, S.STEER_ACCEL) * dt;
    }
    saw.vx -= saw.vx * S.STEER_DAMP * dt;
    saw.vx = clamp(saw.vx, -S.MAX_VX, S.MAX_VX);
    saw.x += saw.vx * dt;

    var minWallX = gridOriginX + sawR * 0.75;
    var maxWallX = gridOriginX + tileSize * cfg.COLS - sawR * 0.75;
    saw.x = clamp(saw.x, minWallX, maxWallX);

    /* Проверка боковых блоков на уровне центра пилы */
    var midRow = rowAt(saw.wy);
    var leftCol = colAt(saw.x - sawR * 0.85);
    var rightCol = colAt(saw.x + sawR * 0.85);
    if (leftCol >= 0 && leftCol < cfg.COLS) {
      var lt = world.getTile(midRow, leftCol);
      if (lt && lt.t !== T.EMPTY.id && tileDefById(lt.t).solid) {
        var rightEdge = tileWorldX(leftCol) + tileSize;
        if (saw.x - sawR * 0.85 < rightEdge) {
          saw.x = rightEdge + sawR * 0.85;
          if (saw.vx < 0) saw.vx = 0;
        }
      }
    }
    if (rightCol >= 0 && rightCol < cfg.COLS) {
      var rt = world.getTile(midRow, rightCol);
      if (rt && rt.t !== T.EMPTY.id && tileDefById(rt.t).solid) {
        var leftEdge = tileWorldX(rightCol);
        if (saw.x + sawR * 0.85 > leftEdge) {
          saw.x = leftEdge - sawR * 0.85;
          if (saw.vx > 0) saw.vx = 0;
        }
      }
    }
    saw.x = clamp(saw.x, minWallX, maxWallX);

    /* 3. Вертикальное опускание (ось Y) + жесткий упор в верхнюю грань породы */
    var grav = boost ? S.GRAVITY_BOOST : S.GRAVITY_BASE;
    var nextWY = saw.wy + grav * dt;
    contactThisFrame = false;

    var cMin = Math.max(0, colAt(saw.x - sawR * 0.72));
    var cMax = Math.min(cfg.COLS - 1, colAt(saw.x + sawR * 0.72));
    var rStart = Math.max(0, rowAt(saw.wy));
    var rEnd = rowAt(nextWY + sawR) + 1;

    var floorLimitWY = Infinity;
    for (var r = rStart; r <= rEnd; r++) {
      for (var c = cMin; c <= cMax; c++) {
        var under = world.getTile(r, c);
        if (!under || under.t === T.EMPTY.id) continue;
        var udef = tileDefById(under.t);
        if (!udef.solid) continue;

        var topY = tileWorldY(r);
        /* Если пила опирается сверху на этот ряд блоков — останавливаем падение на грани */
        if (topY >= saw.wy - sawR * 0.35) {
          var allowedWY = topY - sawR + 3;
          if (allowedWY < floorLimitWY) floorLimitWY = allowedWY;
        }
      }
    }

    if (nextWY >= floorLimitWY) {
      /* Плавный упор без рывков вверх или вниз */
      saw.wy = Math.max(saw.wy, floorLimitWY);
      contactThisFrame = true;
    } else {
      saw.wy = nextWY;
    }

    /* 4. Распил всех блоков, которых касается зубчатый диск пилы */
    var reachR = sawR + 4;
    var minR = Math.max(0, rowAt(saw.wy - reachR));
    var maxR = rowAt(saw.wy + reachR);
    var minC = Math.max(0, colAt(saw.x - reachR));
    var maxC = Math.min(cfg.COLS - 1, colAt(saw.x + reachR));

    for (var br = minR; br <= maxR; br++) {
      for (var bc = minC; bc <= maxC; bc++) {
        var tile = world.getTile(br, bc);
        if (!tile || tile.t === T.EMPTY.id) continue;
        var def = tileDefById(tile.t);
        if (!def.solid) continue;

        var tx = tileWorldX(bc), ty = tileWorldY(br);
        var nx = clamp(saw.x, tx, tx + tileSize);
        var ny = clamp(saw.wy, ty, ty + tileSize);
        var ddx = saw.x - nx, ddy = saw.wy - ny;

        if (ddx * ddx + ddy * ddy <= reachR * reachR) {
          contactThisFrame = true;
          if (def.name === 'SPIKE_MINE') {
            spikeHit(br, bc);
            if (!running) return;
            continue;
          }
          if (def.name === 'MAGMA_ROCK') magmaTouch(br + ':' + bc);
          if (!running) return;

          if (world.damageTile(tile, dmg)) {
            breakTile(br, bc, false);
          } else {
            crackBurst(nx, ny, def);
          }
        }
      }
    }

    /* 5. Справедливый таймер обвала:
       - штурм Босс-шлюза или активный режим Redline (ТУРБО в красной зоне)
         НЕ копят завал, а плавно разряжают его;
       - stallTimer растёт только при контакте с породой ВНЕ redline
         (игрок застрял / бросил управление на твёрдой плите). */
    var inVaultAssault = !!vaultActive;
    if (inVaultAssault || inRedline()) {
      stallTimer = Math.max(0, stallTimer - dt * 1.5);
      if (stallTimer <= 2.6) elStallWarn.style.display = 'none';
    } else if (contactThisFrame) {
      stallTimer += dt;
      if (stallTimer > 2.6) {
        elStallWarn.style.display = 'block';
        elStallWarn.textContent = '⚠️ ОПАСНОСТЬ ЗАВАЛА: ' + Math.max(0, (cfg.STALL_TIME_LIMIT - stallTimer)).toFixed(1) + 'с!';
      }
      if (stallTimer >= cfg.STALL_TIME_LIMIT) {
        stallTimer = 0;
        elStallWarn.style.display = 'none';
        triggerCaveIn();
        if (!running) return;
      }
    } else {
      stallTimer = Math.max(0, stallTimer - dt * 2.5);
      if (stallTimer <= 2.6) elStallWarn.style.display = 'none';
    }

    /* 6. Односторонний плавный скролл камеры вниз за пилой */
    var targetCamY = saw.wy - anchorY();
    if (targetCamY > camY) {
      camY = targetCamY;
    }
    saw.y = saw.wy - camY;

    /* 7. Вращение диска и дополнительный нагрев от трения */
    var targetSpin = S.SPIN_BASE * (boost ? S.SPIN_BOOST_MULT : 1) * (inRedline() ? 1.25 : 1);
    saw.spinSpeed += (targetSpin - saw.spinSpeed) * Math.min(1, dt * 8);
    saw.spin += saw.spinSpeed * dt;

    if (boost && contactThisFrame) {
      heat = clamp(heat + cfg.HEAT.CONTACT_GAIN * heatBuildupFactor() * dt, 0, cfg.HEAT.MAX);
      if (heat >= cfg.HEAT.MAX) { overheatExplode(); if (!running) return; }
    }

    /* 8. Сейсмо-удар и цепочки кварца */
    if (meta.shock > 0) {
      shockTimer -= dt;
      if (shockTimer <= 0) {
        fireShockwave();
        shockTimer = shockPeriod();
      }
    }
    updateChains(dt);

    for (var si = shockRings.length - 1; si >= 0; si--) {
      shockRings[si].t += dt;
      if (shockRings[si].t > 0.6) shockRings.splice(si, 1);
    }

    /* 9. Полет самородков в верхний приемник */
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
      n.vy += cfg.NUGGET.GRAVITY * dt * Math.max(0, 1 - n.t * 1.8);
      n.vx -= n.vx * 0.6 * dt;
      n.vy -= n.vy * 0.6 * dt;
      n.x += n.vx * dt;
      n.y += n.vy * dt;
      if (n.y < collectY + 18 && dist < 110) {
        gold = Math.round(gold + n.v);
        clinkStep = Math.min(clinkStep + 1, 14);
        clinkTimer = 0.22;
        audio.goldClink(clinkStep);
        addFloater('+' + n.v, n.kind === 'gold' ? '#F2B705' : '#1B998B');
        nuggets.splice(i, 1);
      } else if (n.t > 8) {
        nuggets.splice(i, 1);
      }
    }

    /* Затухание серии звона монет: пауза > 0.22с сбрасывает нарастание */
    if (clinkTimer > 0) {
      clinkTimer -= dt;
      if (clinkTimer <= 0) clinkStep = 0;
    }

    /* 10. Босс-шлюз каждые 250м: активация, таймер штурма, прорыв/лазер */
    updateVault(dt, sawR);

    /* 11. Частицы и всплывающий текст */
    for (var p = particles.length - 1; p >= 0; p--) {
      var pt = particles[p];
      pt.vy += cfg.FX.PARTICLE_GRAVITY * dt;
      pt.x += pt.vx * dt; pt.y += pt.vy * dt;
      pt.l -= dt;
      if (pt.l <= 0) particles.splice(p, 1);
    }
    for (var f = floaters.length - 1; f >= 0; f--) {
      floaters[f].t += dt;
      if (floaters[f].t > 1.1) floaters.splice(f, 1);
    }

    world.ensureRows(rowAt(camY + H) + cfg.ROWS_AHEAD);
    world.prune(rowAt(camY) - 4);
    shake = Math.max(0, shake - shake * cfg.FX.SHAKE_DECAY * dt - 2 * dt);
    audio.setHumIntensity(contactThisFrame ? 1 : 0.35, boost);
    updateHUD(false);
  }

  /* ============================================================
     ОТРИСОВКА
     ============================================================ */
  function render() {
    var g = ctx2d;
    g.clearRect(0, 0, W, H);
    /* Фон шахты меняется с глубиной — цвет текущего биома */
    var biome = cfg.BIOMES[world.biomeIndexAt(currentDepthM())];
    g.fillStyle = biome.tint || '#F4ECE1';
    g.fillRect(0, 0, W, H);

    var sx = 0, sy = 0;
    if (shake > 0.2) { sx = rand(-shake, shake); sy = rand(-shake, shake); }

    g.save();
    g.translate(sx, sy - camY);

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

    for (var ringI = 0; ringI < shockRings.length; ringI++) {
      var ring = shockRings[ringI];
      var rp = ring.t / 0.6;
      g.strokeStyle = 'rgba(217,107,67,' + (0.8 * (1 - rp)) + ')';
      g.lineWidth = 4;
      g.beginPath();
      g.arc(ring.x, ring.y, tileSize * cfg.SHOCK.RADIUS_TILES * rp + 6, 0, Math.PI * 2);
      g.stroke();
    }

    for (var i = 0; i < particles.length; i++) {
      var pt = particles[i];
      g.globalAlpha = clamp(pt.l / pt.ml, 0, 1);
      g.fillStyle = pt.c;
      g.fillRect(pt.x - pt.s / 2, pt.y - pt.s / 2, pt.s, pt.s);
    }
    g.globalAlpha = 1;

    drawVaultOverlay(g);   /* HP ядра шлюза + таймер штурма (поверх мира) */
    g.restore();

    g.save();
    g.translate(sx, sy);
    drawCollector(g);
    for (var nI = 0; nI < nuggets.length; nI++) {
      var n = nuggets[nI];
      g.fillStyle = n.kind === 'gold' ? '#F2B705' : '#1B998B';
      g.strokeStyle = '#2B211E';
      g.lineWidth = 1.5;
      g.beginPath(); g.arc(n.x, n.y, 5.5, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    drawRig(g);
    drawFloaters(g);
    g.restore();

    if (inRedline()) {
      var vg = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.75);
      vg.addColorStop(0, 'rgba(230,57,70,0)');
      vg.addColorStop(1, 'rgba(230,57,70,0.2)');
      g.fillStyle = vg;
      g.fillRect(0, 0, W, H);
    }

    /* Крупный баннер событий шлюза: ШЛЮЗ ПРОБИТ! / ЛАЗЕР ШЛЮЗА! */
    if (bannerT > 0) {
      bannerT -= renderDt;
      var bA = clamp(bannerT / 0.6, 0, 1);
      g.globalAlpha = bA;
      g.font = '900 ' + Math.round(Math.min(W * 0.062, 26)) + 'px sans-serif';
      g.textAlign = 'center';
      g.lineWidth = 5;
      g.strokeStyle = '#2B211E';
      g.strokeText(bannerText, W / 2, H * 0.28);
      g.fillStyle = bannerColor;
      g.fillText(bannerText, W / 2, H * 0.28);
      g.globalAlpha = 1;
    }
  }

  /* Латунно-эспрессо воронка приёмника руды (экранное пространство) */
  function drawCollector(g) {
    var cx = W / 2;
    var cy = H * cfg.NUGGET.COLLECT_Y_RATIO;
    var wTop = Math.min(W * 0.34, 150);
    var hgt = 26;

    g.save();
    g.translate(cx, cy);

    /* Воронка-чаша */
    g.beginPath();
    g.moveTo(-wTop / 2, -hgt * 0.45);
    g.lineTo(wTop / 2, -hgt * 0.45);
    g.lineTo(wTop * 0.22, hgt * 0.55);
    g.lineTo(-wTop * 0.22, hgt * 0.55);
    g.closePath();
    g.fillStyle = '#F2B705';
    g.fill();
    g.strokeStyle = '#2B211E';
    g.lineWidth = 3;
    g.stroke();

    /* Тёмная внутренняя тень жерла */
    g.beginPath();
    g.moveTo(-wTop * 0.38, -hgt * 0.3);
    g.lineTo(wTop * 0.38, -hgt * 0.3);
    g.lineTo(wTop * 0.16, hgt * 0.4);
    g.lineTo(-wTop * 0.16, hgt * 0.4);
    g.closePath();
    g.fillStyle = 'rgba(43,33,30,0.55)';
    g.fill();

    /* Верхняя латунная кромка-ободок */
    g.fillStyle = '#FFF3C4';
    g.fillRect(-wTop / 2 - 4, -hgt * 0.45 - 5, wTop + 8, 6);
    g.strokeStyle = '#2B211E';
    g.lineWidth = 2;
    g.strokeRect(-wTop / 2 - 4, -hgt * 0.45 - 5, wTop + 8, 6);

    /* Заклёпки по ободку */
    g.fillStyle = '#2B211E';
    for (var ri = -2; ri <= 2; ri++) {
      g.beginPath();
      g.arc(ri * (wTop / 5), -hgt * 0.45 - 2, 1.8, 0, Math.PI * 2);
      g.fill();
    }

    /* Основание-труба */
    g.fillStyle = '#6B5744';
    g.fillRect(-wTop * 0.14, hgt * 0.55, wTop * 0.28, 8);
    g.strokeStyle = '#2B211E';
    g.lineWidth = 2;
    g.strokeRect(-wTop * 0.14, hgt * 0.55, wTop * 0.28, 8);

    g.restore();
  }

  function drawTile(g, tile, x, y) {
    var def = tileDefById(tile.t);
    var pad = 1.5;
    var s = tileSize - pad * 2;
    var cx = x + tileSize / 2, cy = y + tileSize / 2;

    g.fillStyle = def.base;
    g.fillRect(x + pad, y + pad, s, s);
    g.fillStyle = 'rgba(255,255,255,0.2)';
    g.fillRect(x + pad, y + pad, s, 3);

    var name = def.name;
    if (name === 'GOLD') {
      g.fillStyle = '#FFF3C4';
      g.beginPath(); g.arc(cx - 5, cy - 4, 4, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(cx + 5, cy + 4, 4.5, 0, Math.PI * 2); g.fill();
    } else if (name === 'QUARTZ') {
      g.fillStyle = '#A9E8DF';
      g.beginPath();
      g.moveTo(cx, cy - 9); g.lineTo(cx + 7, cy); g.lineTo(cx, cy + 9); g.lineTo(cx - 7, cy);
      g.closePath(); g.fill();
    } else if (name === 'TNT') {
      g.fillStyle = '#2B211E';
      g.fillRect(x + pad, cy - 7, s, 14);
      g.fillStyle = '#F2B705';
      g.font = 'bold 10px sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('TNT', cx, cy + 1);
    } else if (name === 'ICE') {
      g.fillStyle = '#FFFFFF';
      g.font = 'bold 14px sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('❄', cx, cy + 1);
    } else if (name === 'MAGMA_ROCK') {
      g.strokeStyle = '#E63946';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x + 5, y + 6); g.lineTo(cx, cy); g.lineTo(x + s - 5, y + s - 5);
      g.stroke();
    } else if (name === 'SPIKE_MINE') {
      g.fillStyle = '#2B211E';
      g.beginPath(); g.arc(cx, cy, s * 0.28, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#E63946';
      g.beginPath(); g.arc(cx, cy, 3.5, 0, Math.PI * 2); g.fill();
    } else if (name === 'VAULT_PLATE') {
      /* Броневая плита босса: тёмная сталь + 4 золотые заклёпки по углам */
      var rpIn = 5;
      g.fillStyle = '#57453a';
      g.fillRect(x + pad + rpIn, y + pad + rpIn, s - rpIn * 2, s - rpIn * 2);
      g.strokeStyle = 'rgba(242,183,5,0.35)';
      g.lineWidth = 1.5;
      g.strokeRect(x + pad + rpIn, y + pad + rpIn, s - rpIn * 2, s - rpIn * 2);
      g.fillStyle = '#F2B705';
      var rv = rpIn + 3;
      g.beginPath(); g.arc(x + pad + rv, y + pad + rv, 2.2, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(x + s - rv, y + pad + rv, 2.2, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(x + pad + rv, y + s - rv, 2.2, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(x + s - rv, y + s - rv, 2.2, 0, Math.PI * 2); g.fill();
    } else if (name === 'VAULT_CORE') {
      /* Пульсирующее энергетическое ядро с прицелом в центре */
      var pulse = 0.65 + 0.35 * Math.sin(performance.now() / 180);
      var cg = g.createRadialGradient(cx, cy, 1, cx, cy, s * 0.55);
      cg.addColorStop(0, '#FFF3C4');
      cg.addColorStop(0.5, 'rgba(242,183,5,' + pulse + ')');
      cg.addColorStop(1, '#D96B43');
      g.fillStyle = cg;
      g.beginPath(); g.arc(cx, cy, s * 0.46, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#2B211E';
      g.lineWidth = 2;
      g.beginPath(); g.arc(cx, cy, s * 0.46, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(cx, cy, s * 0.26 * pulse + 2, 0, Math.PI * 2); g.stroke();
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(cx - s * 0.42, cy); g.lineTo(cx - s * 0.14, cy);
      g.moveTo(cx + s * 0.14, cy); g.lineTo(cx + s * 0.42, cy);
      g.moveTo(cx, cy - s * 0.42); g.lineTo(cx, cy - s * 0.14);
      g.moveTo(cx, cy + s * 0.14); g.lineTo(cx, cy + s * 0.42);
      g.stroke();
      g.fillStyle = '#2B211E';
      g.beginPath(); g.arc(cx, cy, 2, 0, Math.PI * 2); g.fill();
    }

    var maxHp = tile.maxHp || def.hp || 1;
    var dmgRatio = clamp(1 - (tile.hp / maxHp), 0, 1);
    if (dmgRatio > 0.08) {
      g.strokeStyle = 'rgba(43,33,30,0.85)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(cx - s * 0.3 * dmgRatio, cy - s * 0.3 * dmgRatio);
      g.lineTo(cx + s * 0.35 * dmgRatio, cy + s * 0.3 * dmgRatio);
      if (dmgRatio > 0.45) {
        g.moveTo(cx + s * 0.28 * dmgRatio, cy - s * 0.28 * dmgRatio);
        g.lineTo(cx - s * 0.25 * dmgRatio, cy + s * 0.32 * dmgRatio);
      }
      g.stroke();
    }

    g.strokeStyle = '#2B211E';
    g.lineWidth = 2;
    g.strokeRect(x + pad, y + pad, s, s);
  }

  function drawRig(g) {
    var aY = saw.y;
    var molten = inRedline();
    var r = saw.r * sawRadiusMult();

    if (heat > 50 || molten) {
      g.fillStyle = 'rgba(230,57,70,' + (molten ? 0.42 : 0.18) + ')';
      g.beginPath(); g.arc(saw.x, aY, r * 1.38, 0, Math.PI * 2); g.fill();
    }

    g.save();
    g.translate(saw.x, aY);
    g.rotate(saw.spin);

    var teeth = sawTeethCount();
    g.fillStyle = molten ? '#F2B705' : '#2B211E';
    for (var i = 0; i < teeth; i++) {
      var a = (i / teeth) * Math.PI * 2;
      g.save();
      g.rotate(a);
      g.beginPath();
      g.moveTo(r - 3, -5);
      g.lineTo(r + 7, 0);
      g.lineTo(r - 3, 5);
      g.closePath();
      g.fill();
      g.restore();
    }

    g.fillStyle = molten ? '#FF4E00' : '#8A7563';
    g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#2B211E'; g.lineWidth = 3; g.stroke();

    g.fillStyle = '#2B211E';
    g.beginPath(); g.arc(0, 0, r * 0.3, 0, Math.PI * 2); g.fill();
    g.restore();

    /* Бронированный Гиро-Кожух (Industrial Drill Hood):
       не вращается с зубьями, слегка наклоняется от горизонтальной скорости */
    var hoodTilt = clamp(saw.vx * 0.0005, -0.25, 0.25);
    g.save();
    g.translate(saw.x, aY);
    g.rotate(hoodTilt);

    /* Реактивные языки пламени из сопел при бусте — вдавливают пилу в грунт */
    if (boost) {
      var nozL = -r * 0.45, nozR = r * 0.45;
      var flameH = 10 + Math.random() * 12;
      for (var fi = 0; fi < 2; fi++) {
        var fx = fi === 0 ? nozL : nozR;
        var fh = flameH * (0.8 + Math.random() * 0.4);
        g.fillStyle = '#F2B705';
        g.beginPath();
        g.moveTo(fx - 4, -r - 15);
        g.lineTo(fx, -r - 15 - fh);
        g.lineTo(fx + 4, -r - 15);
        g.closePath();
        g.fill();
        g.fillStyle = '#E63946';
        g.beginPath();
        g.moveTo(fx - 2.2, -r - 15);
        g.lineTo(fx, -r - 15 - fh * 0.6);
        g.lineTo(fx + 2.2, -r - 15);
        g.closePath();
        g.fill();
      }
    }

    /* Стальная дуга-щиток над верхней половиной пилы */
    g.strokeStyle = '#2B211E';
    g.lineWidth = 6;
    g.lineCap = 'round';
    g.beginPath();
    g.arc(0, 0, r + 5, Math.PI * 1.1, Math.PI * 1.9);
    g.stroke();
    g.lineCap = 'butt';

    /* Латунная заклёпка по центру сверху кожуха */
    g.fillStyle = '#F2B705';
    g.beginPath(); g.arc(0, -(r + 5), 3.2, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#2B211E';
    g.lineWidth = 1.5;
    g.stroke();

    /* Два компактных реактивных сопла сверху по бокам кожуха (высота 10px) */
    g.fillStyle = '#6B5744';
    g.strokeStyle = '#2B211E';
    g.lineWidth = 2;
    var nozzleXs = [-r * 0.45, r * 0.45];
    for (var ni = 0; ni < 2; ni++) {
      var nx = nozzleXs[ni];
      g.beginPath();
      g.moveTo(nx - 4, -r - 5);
      g.lineTo(nx - 3, -r - 15);
      g.lineTo(nx + 3, -r - 15);
      g.lineTo(nx + 4, -r - 5);
      g.closePath();
      g.fill();
      g.stroke();
    }

    g.restore();
  }

  function drawFloaters(g) {
    for (var i = 0; i < floaters.length; i++) {
      var f = floaters[i];
      g.globalAlpha = clamp(1 - f.t / 1.1, 0, 1);
      g.font = '900 14px sans-serif';
      g.textAlign = 'center';
      g.lineWidth = 3;
      g.strokeStyle = '#2B211E';
      var fy = f.y - f.t * 35;
      g.strokeText(f.text, f.x, fy);
      g.fillStyle = f.c;
      g.fillText(f.text, f.x, fy);
    }
    g.globalAlpha = 1;
  }

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
    boost = true;
    steerTargetX = pointerPos(e).x;
    elBoostHint.classList.add('hidden');
  }

  function onMove(e) {
    if (!pointerActive || !running) return;
    e.preventDefault();
    steerTargetX = pointerPos(e).x;
  }

  function onUp() {
    pointerActive = false;
    boost = false;
    steerTargetX = null;
  }

  function loop(t) {
    if (!running) return;
    var dt = Math.min(0.033, (t - lastTime) / 1000);
    lastTime = t;
    renderDt = dt > 0 ? dt : renderDt;
    if (dt > 0) update(dt);
    if (running) {
      render();
      requestAnimationFrame(loop);
    }
  }

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
    elStallWarn = document.getElementById('stall-warning');
    statDepth = document.getElementById('stat-depth');
    statGold = document.getElementById('stat-gold');
    statTiles = document.getElementById('stat-tiles');
    statBest = document.getElementById('stat-best');

    Array.prototype.forEach.call(document.querySelectorAll('.shop-btn'), function (btn) {
      var key = btn.getAttribute('data-upgrade');
      shopBtns[key] = btn;
      btn.addEventListener('click', function () { audio.resume(); buyUpgrade(key); });
    });

    document.getElementById('btn-start').addEventListener('click', startGame);
    document.getElementById('btn-restart').addEventListener('click', startGame);

    var elMuteBtn = document.getElementById('btn-mute');
    if (elMuteBtn) {
      elMuteBtn.addEventListener('click', function () {
        audio.resume();
        audio.toggleMute();
        elMuteBtn.textContent = audio.isMuted() ? '🔇' : '🔊';
      });
    }

    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('touchstart', onDown, { passive: false });
    canvas.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
    window.addEventListener('resize', resize);

    resize();
    world.reset();
  }

  window.CB.game = { init: init };
})();
