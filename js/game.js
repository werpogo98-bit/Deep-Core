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
  var elModalOver, elModalStart, elBoostHint;
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

  var meta = loadMeta();        // garage levels persist between runs

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
        return { dps: m.dps | 0, hull: m.hull | 0, cooling: m.cooling | 0, magnet: m.magnet | 0 };
      }
    } catch (e) {}
    return { dps: 0, hull: 0, cooling: 0, magnet: 0 };
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
  function effectiveDPS() {
    return cfg.SAW.DPS_BASE * (1 + meta.dps * cfg.UPGRADES.dps.effect);
  }
  function coolingRate() {
    return cfg.HEAT.IDLE_COOL * (1 + meta.cooling * cfg.HEAT.COOL_UPGRADE_MULT);
  }
  function suctionForce() {
    return cfg.NUGGET.SUCTION_BASE * (1 + meta.magnet * cfg.NUGGET.SUCTION_UPGRADE_MULT);
  }
  function inRedline() {
    return heat >= cfg.HEAT.REDLINE_MIN && heat <= cfg.HEAT.REDLINE_MAX;
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
    maxHp = Math.min(cfg.PLAYER.START_HP + meta.hull * cfg.UPGRADES.hull.effect, cfg.PLAYER.MAX_HP_CAP);
    hp = maxHp;
    gold = cfg.PLAYER.START_GOLD;
    tilesCarved = 0;
    bestDepth = 0;
    boost = false; pointerActive = false; steerTargetX = null;
    particles.length = 0; nuggets.length = 0; floaters.length = 0;
    shake = 0; clinkStep = 0; clinkTimer = 0;
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
    statDepth.textContent = Math.floor(bestDepth) + 'm';
    statGold.textContent = gold;
    statTiles.textContent = tilesCarved;
    statBest.textContent = Math.floor(best) + 'm';
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
    elDepth.textContent = depthM + 'm';
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
    elHeatBar.classList.toggle('danger', heat > cfg.HEAT.REDLINE_MAX);
    elRedTag.classList.toggle('active', inRedline());

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
    if (meta[key] >= u.maxLevel) return;
    var c = upgradeCost(key);
    if (gold < c) return;
    gold -= c;
    meta[key]++;
    saveMeta();
    audio.uiClick();
    if (key === 'hull') {
      maxHp = Math.min(cfg.PLAYER.START_HP + meta.hull * cfg.UPGRADES.hull.effect, cfg.PLAYER.MAX_HP_CAP);
      hp = Math.min(hp + 1, maxHp);   // new plate also repairs 1
      updateHUD(true);
    }
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

  function addFloater(text, color) {
    floaters.push({ text: text, c: color, t: 0 });
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

    var cx = tileWorldX(col) + tileSize / 2;
    var cy = tileWorldY(row) + tileSize / 2;

    burstDebris(cx, cy, def, viaExplosion ? 10 : 7);

    var redlineMult = inRedline() ? cfg.HEAT.NUGGET_REDLINE_MULT : 1;

    if (def.name === 'GOLD') {
      // Base 2 nuggets, doubled inside REDLINE => 2x GOLD NUGGETS
      var count = 2 * redlineMult;
      for (var i = 0; i < count; i++) spawnNugget(cx, cy, cfg.NUGGET.VALUE, 'gold');
    } else if (def.name === 'QUARTZ') {
      spawnNugget(cx, cy, cfg.NUGGET.QUARTZ_CHIP, 'chip');
    } else if (def.name === 'TNT') {
      detonate(row, col);
    } else if (def.name === 'ICE') {
      heat = clamp(heat - 35, 0, cfg.HEAT.MAX);
      steamPuff(cx, cy);
      audio.steamHiss();
      addFloater('-35 HEAT', '#1B998B');
    } else {
      audio.rockBreak(rand(-200, 200));
      if (Math.random() < 0.12 * redlineMult) spawnNugget(cx, cy, cfg.NUGGET.VALUE, 'gold');
    }
  }

  /* TNT crate: detonates a 3x3 radius with chain reactions */
  var detonating = false;
  function detonate(row, col) {
    if (detonating) return;
    detonating = true;
    audio.boom();
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
    shake = cfg.FX.MAX_SHAKE;
    addFloater('OVERHEAT! -1 HULL', '#E63946');

    var sr = rowAt(saw.y), sc = colAt(saw.x);
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
      addParticle(saw.x, saw.y, Math.cos(a) * sp, Math.sin(a) * sp,
        ['#F2B705', '#D96B43', '#E63946'][i % 3], rand(3, 7), rand(0.4, 0.8));
    }
    updateHUD(true);
    if (hp <= 0) gameOver();
  }

  /* ================= Update ================= */
  function update(dt) {
    var S = cfg.SAW;

    /* --- Heat model (first: it gates this frame's damage multipliers) --- */
    if (boost) {
      heat += cfg.HEAT.BOOST_GAIN * dt;
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
    var minR = rowAt(saw.y - saw.r), maxR = rowAt(saw.y + saw.r);
    var minC = colAt(saw.x - saw.r), maxC = colAt(saw.x + saw.r);
    for (var r = Math.max(0, minR); r <= maxR; r++) {
      for (var c = minC; c <= maxC; c++) {
        if (c < 0 || c >= cfg.COLS) continue;
        var tile = world.getTile(r, c);
        if (!tile || tile.t === T.EMPTY.id) continue;
        // closest point on tile AABB to circle center
        var tx = tileWorldX(c), ty = tileWorldY(r);
        var nx = clamp(saw.x, tx, tx + tileSize);
        var ny = clamp(saw.y, ty, ty + tileSize);
        var ddx = saw.x - nx, ddy = saw.y - ny;
        if (ddx * ddx + ddy * ddy <= saw.r * saw.r) {
          contactThisFrame = true;
          var def = tileDefById(tile.t);
          if (def.solid) {
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
      var defC = tileDefById(world.getTile(rowAt(saw.y + saw.r * 0.9), colAt(saw.x)) ?
        world.getTile(rowAt(saw.y + saw.r * 0.9), colAt(saw.x)).t : T.EMPTY.id);
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
      heat = clamp(heat + cfg.HEAT.CONTACT_GAIN * dt, 0, cfg.HEAT.MAX);
      if (heat >= cfg.HEAT.MAX) { overheatExplode(); if (!running) return; }
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
        gold += n.v;
        clinkStep = Math.min(clinkStep + 1, 12);   // rising pitch combo
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
    skyGrad.addColorStop(0, '#F4ECE1');
    skyGrad.addColorStop(1, '#E5D5C3');
    g.fillStyle = skyGrad;
    g.fillRect(0, 0, W, H);

    var sx = 0, sy = 0;
    if (shake > 0.2) { sx = rand(-shake, shake); sy = rand(-shake, shake); }

    /* ---- World layer (tiles, debris) ---- */
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

    /* Gantry arms */
    g.strokeStyle = '#2B211E';
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(saw.x - saw.r - 14, aY - 40); g.lineTo(saw.x - saw.r - 14, aY + 6);
    g.moveTo(saw.x + saw.r + 14, aY - 40); g.lineTo(saw.x + saw.r + 14, aY + 6);
    g.stroke();
    g.fillStyle = '#F2B705';
    g.fillRect(saw.x - saw.r - 20, aY - 46, saw.r * 2 + 40, 10);
    g.strokeStyle = '#2B211E';
    g.lineWidth = 3;
    g.strokeRect(saw.x - saw.r - 20, aY - 46, saw.r * 2 + 40, 10);

    /* Molten glow when hot */
    if (heat > 50 || molten) {
      g.fillStyle = 'rgba(230,57,70,' + (molten ? 0.5 : 0.22) + ')';
      g.beginPath();
      g.arc(saw.x, aY, saw.r * 1.5, 0, Math.PI * 2);
      g.fill();
    }

    /* Blade */
    g.save();
    g.translate(saw.x, aY);
    g.rotate(saw.spin);

    var bladeGrad = g.createRadialGradient(0, 0, saw.r * 0.2, 0, 0, saw.r);
    if (molten) {
      bladeGrad.addColorStop(0, '#FFD98A');
      bladeGrad.addColorStop(0.7, '#F2B705');
      bladeGrad.addColorStop(1, '#D96B43');
    } else {
      bladeGrad.addColorStop(0, '#EDE6DA');
      bladeGrad.addColorStop(0.75, '#BFB4A0');
      bladeGrad.addColorStop(1, '#8A7563');
    }
    g.fillStyle = bladeGrad;
    g.beginPath(); g.arc(0, 0, saw.r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#2B211E'; g.lineWidth = 3; g.stroke();

    /* Teeth */
    g.fillStyle = molten ? '#E63946' : '#2B211E';
    for (var i = 0; i < cfg.SAW.TEETH; i++) {
      var a = (i / cfg.SAW.TEETH) * Math.PI * 2;
      g.save();
      g.rotate(a);
      g.beginPath();
      g.moveTo(saw.r - 2, -5);
      g.lineTo(saw.r + 8, 0);
      g.lineTo(saw.r - 2, 5);
      g.closePath();
      g.fill();
      g.restore();
    }

    /* Hub + bolts */
    g.fillStyle = '#2B211E';
    g.beginPath(); g.arc(0, 0, saw.r * 0.28, 0, Math.PI * 2); g.fill();
    g.fillStyle = molten ? '#F2B705' : '#F4ECE1';
    for (var b = 0; b < 4; b++) {
      var ba = b * Math.PI / 2;
      g.beginPath();
      g.arc(Math.cos(ba) * saw.r * 0.5, Math.sin(ba) * saw.r * 0.5, 3, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
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
      var fy = H * 0.34 - f.t * 40;
      g.strokeText(f.text, W / 2, fy);
      g.fillStyle = f.c;
      g.fillText(f.text, W / 2, fy);
    }
    g.globalAlpha = 1;
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

    document.getElementById('btn-mute').addEventListener('click', function () {
      var m = audio.toggleMute();
      this.classList.toggle('off', m);
      if (!m && running) { audio.resume(); audio.startHum(); }
    });

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
