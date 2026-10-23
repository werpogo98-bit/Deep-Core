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
  var saw = { x: 0, y: 0, vx: 0, r: 28, spin: 0, spinSpeed: 0 };
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
  var clinkStep = 0, clinkTimer = 0;
  var contactThisFrame = false;

  var stallTimer = 0;
  var comboCount = 0;
  var comboWindowT = 0;
  var comboBadgeT = 0;
  var comboBadgeText = '';
  var chainQuartz = [];
  var chainPitch = 0;
  var shockTimer = 0;
  var shockRings = [];
  var magmaHeatLatch = {};
  var spikeLatch = {};
  var meta = { dps: 0, radiator: 0, vacuum: 0, shock: 0 };

  var vaultActive = null;
  var lastMilestone = 0;
  var bannerT = 0;
  var bannerText = '';
  var bannerColor = '#F2B705';

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

  function effectiveDPS() { return cfg.SAW.DPS_BASE * (1 + meta.dps * cfg.UPGRADES.dps.effect); }
  function sawTeethCount() { return cfg.SAW.TEETH + Math.floor(meta.dps / 5) * 4; }
  function sawRadiusMult() { return 1 + Math.floor(meta.dps / 5) * 0.12; }
  function sawVisualTier() { return Math.min(2, Math.floor(meta.dps / 5)); }
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
    saw.y = 0;
    saw.vx = 0; saw.spin = 0; saw.spinSpeed = cfg.SAW.SPIN_BASE;
    camY = -anchorY();
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
    shake = 0; clinkStep = 0; clinkTimer = 0;
    comboCount = 0; comboWindowT = 0; comboBadgeT = 0;
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
    var best = loadBest();
    if (bestDepth > best) { best = bestDepth; saveBest(best); }
    statDepth.textContent = Math.floor(bestDepth) + 'м';
    statGold.textContent = gold;
    statTiles.textContent = tilesCarved;
    statBest.textContent = Math.floor(best) + 'м';
    elModalOver.classList.remove('hidden');
  }

  function currentDepthM() {
    return Math.max(0, (camY + saw.y) / tileSize * cfg.TILE_TO_METERS);
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
    Object.keys(shopBtns).forEach(function (key) {
      var btn = shopBtns[key];
      var u = cfg.UPGRADES[key];
      var costEl = btn.querySelector('.shop-btn-cost');
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
    addFloater(u.name + ' УР.' + meta[key], '#F2B705');
    updateHUD(false);
  }

  var particles = [];
  var nuggets = [];
  var floaters = [];

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

  function emeraldShower(wx, wy, count) {
    var palette = ['#1B998B', '#5BC0BE', '#A9E8DF', '#FFFFFF'];
    for (var i = 0; i < count; i++) {
      var a = rand(0, Math.PI * 2), sp = rand(90, 320);
      addParticle(wx, wy, Math.cos(a) * sp, Math.sin(a) * sp - 120,
        palette[i % palette.length], rand(2, 6), rand(0.4, 0.9));
    }
  }

  function spawnNugget(wx, wy, value, kind) {
    nuggets.push({
      x: wx,
      y: wy - camY,
      vx: rand(-cfg.NUGGET.SPAWN_JITTER, cfg.NUGGET.SPAWN_JITTER),
      vy: rand(-240, -140),
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

  /* Эффект разлома: осколки породы разлетаются при каждом ПОРЧЕНОМ (не уничтоженном) блоке */
  function crackBurst(wx, wy, tileDef, dmgRatio) {
    var n = 2 + Math.round(clamp(dmgRatio, 0.05, 1) * 4);
    for (var i = 0; i < n; i++) {
      var a = rand(-Math.PI, 0); /* преимущественно вверх-в стороны от точки контакта */
      var sp = rand(40, 160);
      addParticle(wx, wy, Math.cos(a) * sp, Math.sin(a) * sp - 40,
        Math.random() < 0.6 ? tileDef.grit : tileDef.edge, rand(1.5, 3.5), rand(0.2, 0.45));
    }
  }

  function breakTile(row, col, viaExplosion) {
    var tile = world.getTile(row, col);
    if (!tile || tile.t === T.EMPTY.id) return;
    var def = tileDefById(tile.t);
    world.setTileEmpty(row, col);
    tilesCarved++;
    stallTimer = 0; /* Сброс таймера завала при разрушении породы! */

    var cx = tileWorldX(col) + tileSize / 2;
    var cy = tileWorldY(row) + tileSize / 2;
    burstDebris(cx, cy, def, viaExplosion ? 10 : 7);

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
      addFloater('-35 НАГРЕВ', '#1B998B');
    } else if (def.name === 'SPIKE_MINE') {
      audio.rockBreak(rand(-200, 200));
    } else if (def.name === 'MAGMA_ROCK') {
      audio.rockBreak(rand(-200, 200));
      if (Math.random() < 0.3) spawnNugget(cx, cy, nv, 'gold');
    } else {
      audio.rockBreak(rand(-200, 200));
      if (Math.random() < 0.12 * redlineMult) spawnNugget(cx, cy, nv, 'gold');
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
    if (!chainQuartz.length) return;
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
          addFloater('+' + cfg.CHAIN.BONUS_GOLD + ' ЦЕПЬ!', '#1B998B');
          breakTile(q.r, q.c, true);
        }
      }
    }
  }

  function fireShockwave() {
    var sawWorldY = camY + saw.y;
    var sr = rowAt(sawWorldY), sc = colAt(saw.x);
    var rad = cfg.SHOCK.RADIUS_TILES;
    shockRings.push({ x: saw.x, y: sawWorldY, t: 0 });
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
        } else if (world.damageTile(tile, cfg.SHOCK.DAMAGE)) {
          breakTile(r, c, true);
        }
      }
    }
  }

  function magmaTouch(key) {
    if (magmaHeatLatch[key]) return;
    magmaHeatLatch[key] = 1;
    heat = clamp(heat + cfg.HEAT.MAGMA_TOUCH_HEAT, 0, cfg.HEAT.MAX);
    addFloater('+' + cfg.HEAT.MAGMA_TOUCH_HEAT + ' НАГРЕВ!', '#E63946');
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
      updateHUD(true);
      if (hp <= 0) gameOver();
    }
  }

  /* Взрыв TNT: если пила врезалась в упор (не через цепочку взрывов) — теряем 1 сердце! */
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
      addFloater('РАСПИЛ БОЧКИ В ТУРБО!', '#F2B705');
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
    var sawWorldY = camY + saw.y;
    var sr = rowAt(sawWorldY), sc = colAt(saw.x);
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

  /* Обвал породы при застое на твердой плите */
  function triggerCaveIn() {
    hp--;
    shake = 14;
    audio.overheat();
    haptic('heavy');
    addFloater('ОБВАЛ ШАХТЫ! -1 СЕРДЦЕ', '#E63946');
    var sawWorldY = camY + saw.y;
    var sr = rowAt(sawWorldY), sc = colAt(saw.x);
    for (var c = Math.max(0, sc - 1); c <= Math.min(cfg.COLS - 1, sc + 1); c++) {
      var tile = world.getTile(sr + 1, c);
      if (tile && tile.t !== T.EMPTY.id) breakTile(sr + 1, c, true);
    }
    updateHUD(true);
    if (hp <= 0) gameOver();
  }

  function update(dt) {
    var S = cfg.SAW;

    /* Нагрев */
    if (boost) {
      heat += cfg.HEAT.BOOST_GAIN * heatBuildupFactor() * dt;
    } else {
      heat -= coolingRate() * dt;
    }
    heat = clamp(heat, 0, cfg.HEAT.MAX);
    if (heat >= cfg.HEAT.MAX) { overheatExplode(); if (!running) return; }

    var sawR = saw.r * sawRadiusMult();
    var sawWorldY = camY + saw.y;

    /* ЧЕСТНОЕ ГОРИЗОНТАЛЬНОЕ УПОРЕНИЕ: пила не проходит сквозь боковые стены породы */
    function solidTileAt(col, row) {
      if (col < 0 || col >= cfg.COLS) return false;
      var t = world.getTile(row, col);
      return !!(t && t.t !== T.EMPTY.id && tileDefById(t.t).solid);
    }

    if (steerTargetX !== null) {
      var err = steerTargetX - saw.x;
      saw.vx += clamp(err * 12, -S.STEER_ACCEL, S.STEER_ACCEL) * dt;
    }
    saw.vx -= saw.vx * S.STEER_DAMP * dt;
    saw.vx = clamp(saw.vx, -S.MAX_VX, S.MAX_VX);
    saw.x += saw.vx * dt;
    saw.x = clamp(saw.x, gridOriginX + saw.r * 0.5, gridOriginX + tileSize * cfg.COLS - saw.r * 0.5);

    /* Урон за кадр (нужен и для вертикального пропила, и для боковых стен) */
    var dmgMult = 1;
    if (boost) dmgMult *= S.BOOST_DMG_MULT;
    if (inRedline()) dmgMult *= S.REDLINE_DMG_MULT;
    var dmg = effectiveDPS() * dmgMult * dt;

    var sideRowMin = Math.max(0, rowAt(sawWorldY - sawR));
    var sideRowMax = rowAt(sawWorldY + sawR);
    var sideContactCol = null;
    if (saw.vx > 0) {
      var rightCol = colAt(saw.x + sawR);
      for (var rr = sideRowMin; rr <= sideRowMax; rr++) {
        if (solidTileAt(rightCol, rr)) {
          saw.x = Math.min(saw.x, tileWorldX(rightCol) - sawR - 1);
          saw.vx = 0;
          sideContactCol = rightCol;
          break;
        }
      }
    } else if (saw.vx < 0) {
      var leftCol = colAt(saw.x - sawR);
      for (var rl = sideRowMin; rl <= sideRowMax; rl++) {
        if (solidTileAt(leftCol, rl)) {
          saw.x = Math.max(saw.x, tileWorldX(leftCol) + tileSize + sawR + 1);
          saw.vx = 0;
          sideContactCol = leftCol;
          break;
        }
      }
    }
    /* Стена по бокам тоже пилится (медленнее, x0.55), иначе пила застрянет навсегда */
    if (sideContactCol !== null) {
      for (var rs = sideRowMin; rs <= sideRowMax; rs++) {
        var st = world.getTile(rs, sideContactCol);
        if (st && st.t !== T.EMPTY.id && tileDefById(st.t).solid) {
          if (world.damageTile(st, dmg * 0.55)) breakTile(rs, sideContactCol, false);
        }
      }
    }

    /* ЧЕСТНАЯ ФИЗИКА УПОРА В ПОРОДУ */
    var grav = boost ? S.GRAVITY_BOOST : S.GRAVITY_BASE;
    var nextWorldY = sawWorldY + grav * dt;

    var footRow = rowAt(nextWorldY + sawR);
    var footColMin = Math.max(0, colAt(saw.x - sawR * 0.65));
    var footColMax = Math.min(cfg.COLS - 1, colAt(saw.x + sawR * 0.65));

    var solidBelow = false;
    var highestTileTop = Infinity;

    for (var fc = footColMin; fc <= footColMax; fc++) {
      var underTile = world.getTile(footRow, fc);
      if (underTile && underTile.t !== T.EMPTY.id && tileDefById(underTile.t).solid) {
        solidBelow = true;
        var topY = tileWorldY(footRow);
        if (topY < highestTileTop) highestTileTop = topY;
      }
    }

    if (solidBelow && highestTileTop !== Infinity) {
      /* Пила уперлась в поверхность блока: она не падает сквозь него! */
      sawWorldY = Math.min(nextWorldY, highestTileTop - sawR + 2);
      contactThisFrame = true;
    } else {
      sawWorldY = nextWorldY;
      contactThisFrame = false;
    }

    /* Проверка таймера завала */
    if (contactThisFrame) {
      stallTimer += dt;
      if (stallTimer > 2.8) {
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
      if (stallTimer <= 2.8) elStallWarn.style.display = 'none';
    }

    /* Скролл камеры */
    saw.y = sawWorldY - camY;
    var aY = anchorY();
    if (saw.y > aY) {
      camY += saw.y - aY;
      saw.y = aY;
    }

    /* Вращение */
    var targetSpin = S.SPIN_BASE * (boost ? S.SPIN_BOOST_MULT : 1) * (inRedline() ? 1.25 : 1);
    saw.spinSpeed += (targetSpin - saw.spinSpeed) * Math.min(1, dt * 8);
    saw.spin += saw.spinSpeed * dt;

    /* УРОН ПО БЛОКАМ (dmg уже рассчитан выше) */
    var minR = rowAt(sawWorldY - sawR), maxR = rowAt(sawWorldY + sawR);
    var minC = colAt(saw.x - sawR), maxC = colAt(saw.x + sawR);

    for (var r = Math.max(0, minR); r <= maxR; r++) {
      for (var c = minC; c <= maxC; c++) {
        if (c < 0 || c >= cfg.COLS) continue;
        var tile = world.getTile(r, c);
        if (!tile || tile.t === T.EMPTY.id) continue;

        var tx = tileWorldX(c), ty = tileWorldY(r);
        var nx = clamp(saw.x, tx, tx + tileSize);
        var ny = clamp(sawWorldY, ty, ty + tileSize);
        var ddx = saw.x - nx, ddy = sawWorldY - ny;

        if (ddx * ddx + ddy * ddy <= sawR * sawR) {
          var def = tileDefById(tile.t);
          if (def.solid) {
            if (def.name === 'SPIKE_MINE') {
              spikeHit(r, c);
              if (!running) return;
              if (spikeLatch[r + ':' + c] && !inRedline()) {
                world.setTileEmpty(r, c);
                delete spikeLatch[r + ':' + c];
                tilesCarved++;
              }
              continue;
            }
            if (def.name === 'MAGMA_ROCK') magmaTouch(r + ':' + c);
            if (!running) return;
            /* Точка контакта пилы с блоком — там сыпятся осколки разлома.
               Урон копится в world.damageTile (tile.hp), трещины растут постепенно. */
            var beforeHp = tile.hp;
            if (world.damageTile(tile, dmg)) {
              breakTile(r, c, false);
            } else {
              var lostRatio = 1 - tile.hp / Math.max(1, beforeHp);
              crackBurst(nx, ny, def, lostRatio);
              /* Кумулятивный визуальный отклик: порода темнеет по мере накопления урона */
              tile.vd = Math.min(0.35, (tile.vd || 0) + lostRatio * 0.22);
            }
          }
        }
      }
    }

    /* Сейсмо-удар */
    if (meta.shock > 0) {
      shockTimer -= dt;
      if (shockTimer <= 0) {
        fireShockwave();
        shockTimer = shockPeriod();
      }
    }

    updateChains(dt);

    /* Самородки летят в счетчик */
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
      if (n.y < collectY + 16 && dist < 110) {
        gold = Math.round(gold + n.v);
        audio.goldClink(0);
        addFloater('+' + n.v, n.kind === 'gold' ? '#F2B705' : '#BFB4A0');
        nuggets.splice(i, 1);
      } else if (n.t > 8) {
        nuggets.splice(i, 1);
      }
    }

    /* Частицы и текст */
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

  function render() {
    var g = ctx2d;
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#F4ECE1';
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
    g.restore();

    g.save();
    g.translate(sx, sy);
    for (var nI = 0; nI < nuggets.length; nI++) {
      var n = nuggets[nI];
      g.fillStyle = n.kind === 'gold' ? '#F2B705' : '#1B998B';
      g.beginPath(); g.arc(n.x, n.y, 5, 0, Math.PI * 2); g.fill();
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
  }

  function drawTile(g, tile, x, y) {
    var def = tileDefById(tile.t);
    var pad = 1.5;
    var s = tileSize - pad * 2;
    g.fillStyle = def.base;
    g.fillRect(x + pad, y + pad, s, s);

    /* Трещины разлома: визуальный отклик на НАКОПЛЕННЫЙ урон блока */
    var maxHp = tile.maxHp || def.hp || 1;
    var dmgRatio = clamp(1 - (tile.hp / maxHp), 0, 1);
    if (dmgRatio > 0.08) {
      drawCracks(g, x + pad, y + pad, s, dmgRatio, tile);
    }

    g.strokeStyle = '#2B211E';
    g.lineWidth = 2;
    g.strokeRect(x + pad, y + pad, s, s);

    if (def.name === 'TNT') {
      g.fillStyle = '#2B211E';
      g.fillRect(x + pad, y + tileSize / 2 - 6, s, 12);
      g.fillStyle = '#F2B705';
      g.font = 'bold 9px sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('TNT', x + tileSize / 2, y + tileSize / 2 + 1);
    } else if (def.name === 'ICE') {
      g.fillStyle = '#FFFFFF';
      g.font = 'bold 12px sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('❄', x + tileSize / 2, y + tileSize / 2);
    }
  }

  /* Детерминированные трещины (по позиции блока в сетке), чтобы они не «мерцали» между кадрами */
  function hashRand(a, b, c) {
    var h = ((a * 73856093) ^ (b * 19349663) ^ (c * 83492791)) >>> 0;
    return (h % 1000) / 1000;
  }

  /* Ломаная линия трещины с ответвлениями — выглядит как реальный скол породы */
  function strokeCrackPath(g, bx, by, s, gr, gc, seed, len, depth) {
    var px = bx + s * (0.15 + 0.7 * hashRand(gr, gc, seed));
    var py = by + s * (0.1 + 0.8 * hashRand(gr, gc, seed + 1));
    g.beginPath();
    g.moveTo(px, py);
    for (var seg = 0; seg < depth; seg++) {
      var ang = hashRand(gr, gc, seed + 2 + seg) * Math.PI * 2;
      px += Math.cos(ang) * s * len;
      py += Math.sin(ang) * s * len;
      px = clamp(px, bx + 1, bx + s - 1);
      py = clamp(py, by + 1, by + s - 1);
      g.lineTo(px, py);
    }
    g.stroke();
    return { x: px, y: py };
  }

  function drawCracks(g, bx, by, s, dmgRatio, tile) {
    /* Привязка к сетке: одна и та же порода даёт одинаковые трещины */
    var gc = Math.round((bx - gridOriginX) / tileSize);
    var gr = Math.round(by / tileSize);
    /* Плавный рост: длина/толщина трещин зависят от % разрушения */
    var nCracks = dmgRatio > 0.66 ? 3 : (dmgRatio > 0.33 ? 2 : 1);
    var crackLen = 0.12 + dmgRatio * 0.22;   /* сегменты удлиняются по мере урона */
    var branches = dmgRatio > 0.5 ? 1 : 0;   /* при >50% появляются ответвления */

    g.save();
    g.beginPath();
    g.rect(bx, by, s, s);
    g.clip();

    /* Затемнение повреждённой породы (кумулятивный uron vd) */
    var dark = Math.min(0.3, dmgRatio * 0.3 + (tile && tile.vd ? tile.vd * 0.5 : 0));
    if (dark > 0.03) {
      g.fillStyle = 'rgba(43,33,30,' + dark.toFixed(3) + ')';
      g.fillRect(bx, by, s, s);
    }

    g.strokeStyle = 'rgba(43,33,30,0.9)';
    g.lineCap = 'round';
    for (var i = 0; i < nCracks; i++) {
      g.lineWidth = Math.max(1, s * (0.028 + dmgRatio * 0.03));
      var tip = strokeCrackPath(g, bx, by, s, gr, gc, i * 5, crackLen, 3);
      if (branches) {
        g.lineWidth = Math.max(1, s * 0.02);
        strokeCrackPathFrom(g, tip.x, tip.y, s, gr, gc, i * 5 + 100, crackLen * 0.7, 2);
      }
    }
    /* Светлый блик скола вдоль главной трещины при сильном повреждении */
    if (dmgRatio > 0.5) {
      g.strokeStyle = 'rgba(255,253,249,0.55)';
      g.lineWidth = Math.max(1, s * 0.02);
      strokeCrackPath(g, bx, by, s, gr, gc, 42, crackLen * 0.8, 3);
    }
    g.restore();
  }

  function strokeCrackPathFrom(g, px, py, s, gr, gc, seed, len, depth) {
    g.beginPath();
    g.moveTo(px, py);
    for (var seg = 0; seg < depth; seg++) {
      var ang = hashRand(gr, gc, seed + seg) * Math.PI * 2;
      px += Math.cos(ang) * s * len;
      py += Math.sin(ang) * s * len;
      g.lineTo(px, py);
    }
    g.stroke();
  }

  function drawRig(g) {
    var aY = saw.y;
    var molten = inRedline();
    var r = saw.r * sawRadiusMult();

    g.save();
    g.translate(saw.x, aY);
    g.rotate(saw.spin);
    g.fillStyle = molten ? '#FF4E00' : '#8A7563';
    g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#2B211E'; g.lineWidth = 3; g.stroke();

    var teeth = sawTeethCount();
    g.fillStyle = molten ? '#F2B705' : '#2B211E';
    for (var i = 0; i < teeth; i++) {
      var a = (i / teeth) * Math.PI * 2;
      g.save();
      g.rotate(a);
      g.fillRect(r - 2, -4, 8, 8);
      g.restore();
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
