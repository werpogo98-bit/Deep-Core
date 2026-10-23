/* ==========================================================
   CRUST BREAKER: DEEP CORE — world.js
   Procedural chunk-based vertical mine generator.
   Namespace: window.CB.world
   Grid model: rows of COLS tiles, generated on demand as the
   camera scrolls down. Tile object: { t: typeId, hp, maxHp }
   ========================================================== */
(function () {
  'use strict';
  window.CB = window.CB || {};

  var cfg = window.CB.config;
  var T = cfg.TILES;

  /* Deterministic-ish PRNG (mulberry32) so runs feel hand-tuned per seed */
  var seed = (Math.random() * 0xffffffff) >>> 0;
  function rng() {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function randInt(a, b) { return a + Math.floor(rng() * (b - a + 1)); }
  function pickWeighted(weightsObj) {
    var total = 0, k;
    for (k in weightsObj) total += weightsObj[k];
    var r = rng() * total;
    for (k in weightsObj) {
      r -= weightsObj[k];
      if (r <= 0) return k;
    }
    return 'DIRT';
  }

  /* rows stored in a Map keyed by absolute row index */
  var rows = new Map();
  var generatedUpTo = -1; // last fully generated row index

  function depthAtRow(row) { return row * cfg.TILE_TO_METERS; }

  /* ---------- Stage 3: biome lookup & blending ---------- */
  function biomeIndexAt(m) {
    var B = cfg.BIOMES;
    for (var i = B.length - 1; i >= 0; i--) {
      if (m >= B[i].minDepth) return i;
    }
    return 0;
  }

  /* Smooth blend factor between biome idx and idx+1 near the boundary. */
  function biomeBlend(m, idx) {
    var next = cfg.BIOMES[idx + 1];
    if (!next) return 0;
    if (m < next.minDepth) return 0;
    return Math.min(1, (m - next.minDepth) / cfg.BIOME_BLEND_M);
  }

  function mixForDepth(m) {
    /* Stage 3: biome-driven mixes with smooth late-game scaling. */
    var idx = biomeIndexAt(m);
    switch (idx) {
      case 3: return cfg.MIX_MOLTEN;                       // Molten Core 1000m+
      case 2: return cfg.MIX_OBSIDIAN;                     // Obsidian Bastion 600-1000m
      case 1: return cfg.MIX_QUARTZ_CAVES;                 // Emerald Quartz Caverns 250-600m
      default: break;
    }
    /* Canyon (0-250m): legacy stage-2 logic with magma/spike ramp-in */
    if (m >= cfg.SPIKE_DEPTH_M) return hazardMix(cfg.MIX_SPIKE, m, cfg.SPIKE_DEPTH_M);
    if (m >= cfg.MAGMA_DEPTH_M) return hazardMix(cfg.MIX_MAGMA, m, cfg.MAGMA_DEPTH_M);
    if (m >= cfg.DEEP_DEPTH_M) return cfg.MIX_DEEP;
    if (m >= cfg.MID_DEPTH_M) return cfg.MIX_MID;
    return cfg.MIX_EARLY;
  }

  /* Biome HP multiplier: hardness scales smoothly across biome boundaries. */
  function hpMultAt(m) {
    var idx = biomeIndexAt(m);
    var base = cfg.BIOMES[idx].hpMult;
    var t = biomeBlend(m, idx);
    var next = cfg.BIOMES[idx + 1];
    if (next) base += (next.hpMult - base) * t;
    /* endless sweat mode: gentle linear creep past 1000m so runs stay hard at 45 min */
    if (m > 1000) base += Math.min(1.2, (m - 1000) / 1800);
    return base;
  }

  var HAZARD_KEYS = ['MAGMA_ROCK', 'SPIKE_MINE'];
  var _hazardCache = {};
  function hazardMix(base, m, startDepth) {
    // ramp factor: 0.45 at the threshold depth -> 1.0 ten "depth units" later
    var ramp = Math.min(1, 0.45 + (m - startDepth) / (startDepth * 0.6));
    var key = base === cfg.MIX_SPIKE ? 'S' : 'M';
    var bk = key + Math.round(ramp * 20);
    if (_hazardCache[bk]) return _hazardCache[bk];
    var out = {};
    for (var k in base) out[k] = base[k];
    for (var i = 0; i < HAZARD_KEYS.length; i++) {
      var hk = HAZARD_KEYS[i];
      if (out[hk] !== undefined) out[hk] = Math.max(0.5, out[hk] * ramp);
    }
    _hazardCache[bk] = out;
    return out;
  }

  function makeTile(name) {
    var def = T[name];
    return { t: def.id, hp: def.hp, maxHp: def.hp };
  }

  /* Stage 3: biome-scaled tile factory (HP & hardness progression). */
  function makeTileScaled(name, m) {
    var def = T[name];
    var mult = hpMultAt(m);
    var hp = Math.round(def.hp * mult);
    if (name === 'HARD_ROCK') hp += cfg.BIOMES[biomeIndexAt(m)].hardBonus;
    return { t: def.id, hp: hp, maxHp: hp };
  }

  function isSolid(tile) {
    return !!tile && tile.t !== T.EMPTY.id;
  }

  /* ---------- Feature passers ---------- */
  function stampGoldVein(grid, row) {
    var len = randInt(cfg.VEIN.GOLD_LEN_MIN, cfg.VEIN.GOLD_LEN_MAX);
    var col = randInt(0, cfg.COLS - len);
    for (var i = 0; i < len; i++) grid[col + i] = makeTile('GOLD');
  }

  function stampQuartzCluster(grid, row) {
    var size = randInt(cfg.VEIN.QUARTZ_SIZE_MIN, cfg.VEIN.QUARTZ_SIZE_MAX);
    var col = randInt(1, cfg.COLS - 2);
    grid[col] = makeTile('QUARTZ');
    var placed = 1;
    // grow horizontally with occasional vertical bleed into next row handled simply here
    while (placed < size) {
      var dir = rng() < 0.5 ? -1 : 1;
      var nc = col + dir * placed;
      if (nc < 0 || nc >= cfg.COLS) break;
      grid[nc] = makeTile('QUARTZ');
      placed++;
    }
  }

  function stampTNTcrate(grid) {
    var col = randInt(0, cfg.COLS - 1);
    grid[col] = makeTile('TNT');
  }

  function stampIcePocket(grid) {
    var col = randInt(0, cfg.COLS - 2);
    grid[col] = makeTile('ICE');
    if (rng() < 0.6 && col + 1 < cfg.COLS) grid[col + 1] = makeTile('ICE');
  }

  /* ---------- Stage 3: Boss Vault Gates (every VAULT.INTERVAL_M meters) ---------- */
  var vaults = []; // active gate descriptors for the renderer/timer

  /* Stage 3 fix: gates are anchored to exact ROW indices so every vault
     spawns reliably at its target depth (250m, 500m, 750m, ...). The old
     meter-modulo check could miss a gate entirely when TILE_TO_METERS did
     not divide the interval thickness evenly. */
  function vaultTopRow(ivMeters) {
    return Math.round(ivMeters / cfg.TILE_TO_METERS);
  }

  function isVaultRow(row) {
    var iv = cfg.VAULT.INTERVAL_M;
    var perInterval = Math.round(iv / cfg.TILE_TO_METERS); // rows between gates
    if (row < 6 || row < vaultTopRow(iv)) return false;
    var k = Math.floor(row / perInterval);
    if (k < 1) return false;
    var top = vaultTopRow(k * iv);
    return row >= top && row <= top + cfg.VAULT.THICK_ROWS - 1;
  }

  function buildVaultGate(row) {
    var iv = cfg.VAULT.INTERVAL_M;
    var thick = cfg.VAULT.THICK_ROWS;
    var perInterval = Math.round(iv / cfg.TILE_TO_METERS);
    var k = Math.floor(row / perInterval);
    var gateTopRow = vaultTopRow(k * iv);
    var localRow = row - gateTopRow;                      // 0..thick-1
    var grid = new Array(cfg.COLS);
    for (var c = 0; c < cfg.COLS; c++) {
      grid[c] = { t: T.VAULT_PLATE.id, hp: cfg.VAULT.GATE_HP, maxHp: cfg.VAULT.GATE_HP };
    }
    // Glowing Weak Core: 2x2 in center on the middle band of the gate
    var coreCol = Math.floor(cfg.COLS / 2) - 1; // cols 3-4 of 9
    var midLocal = Math.floor(thick / 2);       // middle row band
    if (localRow === midLocal || localRow === midLocal + 1) {
      grid[coreCol] = { t: T.VAULT_CORE.id, hp: cfg.VAULT.GATE_HP, maxHp: cfg.VAULT.GATE_HP };
      grid[coreCol + 1] = { t: T.VAULT_CORE.id, hp: cfg.VAULT.GATE_HP, maxHp: cfg.VAULT.GATE_HP };
    }
    pushVaultDescriptor({
      topRow: gateTopRow,
      bottomRow: gateTopRow + thick - 1,
      coreCol: coreCol,
      coreRow: gateTopRow + midLocal,
      depthM: Math.round(gateTopRow * cfg.TILE_TO_METERS),
      breached: false
    });
    return grid;
  }

  /* Stage 3 fix: one descriptor per gate. buildVaultGate used to push a
     duplicate entry for every row of the gate (3x per vault), which made
     the game's "nearest unbreached gate" scan see stale entries after a
     breach. pushVaultDescriptor() dedupes by topRow. */
  function findVaultByTop(topRow) {
    for (var i = 0; i < vaults.length; i++) {
      if (vaults[i].topRow === topRow) return vaults[i];
    }
    return null;
  }

  function pushVaultDescriptor(desc) {
    if (!findVaultByTop(desc.topRow)) vaults.push(desc);
  }

  /* ---- Row generation ---- */
  function generateRow(row) {
    var m = depthAtRow(row);

    /* Stage 3: reinforced Ancient Vault Gate replaces normal terrain.
       Checked before the anti-wall safety passes so gates stay intact. */
    if (row >= 6 && isVaultRow(row)) {
      return buildVaultGate(row);
    }

    var mix = mixForDepth(m);
    var grid = new Array(cfg.COLS);

    for (var c = 0; c < cfg.COLS; c++) {
      grid[c] = makeTileScaled(pickWeighted(mix), m);
    }

    // Surface apron: first two rows are soft dirt, no hazards
    if (row <= 1) {
      for (c = 0; c < cfg.COLS; c++) grid[c] = makeTile('DIRT');
    }

    // Features (skip near-surface rows so early game is fair)
    if (row >= 3) {
      var qChance = biomeIndexAt(m) === 1 ? 0.34 : cfg.VEIN.QUARTZ_CHANCE; // dense branching veins in caverns
      if (rng() < cfg.VEIN.GOLD_CHANCE) stampGoldVein(grid, row);
      if (rng() < qChance) stampQuartzCluster(grid, row);
      if (rng() < cfg.VEIN.TNT_CHANCE * (biomeIndexAt(m) === 0 ? 1.6 : 1)) stampTNTcrate(grid);
      if (rng() < cfg.VEIN.ICE_CHANCE * (biomeIndexAt(m) === 0 ? 1.8 : 1)) stampIcePocket(grid);
    }

    /* ---- Anti-wall guarantee: never allow a fully solid row where every
       single tile is HARD_ROCK, and ensure at least 2 non-hard tiles per row
       early (< MID depth). Also carve a "drift channel": each row keeps at
       least one DIRT/CLAY tile adjacent to the previous row's soft column.
       Stage 2: hazard tiles (MAGMA/SPIKE) never count as soft fillers and
       are excluded from safety conversions. ---- */
    var softCount = 0;
    for (c = 0; c < cfg.COLS; c++) {
      if (grid[c].t === T.DIRT.id || grid[c].t === T.CLAY.id) softCount++;
    }
    if (softCount < 2 && m < cfg.DEEP_DEPTH_M) {
      // convert up to (2 - softCount) random hard tiles into clay/dirt
      var need = 2 - softCount;
      var guard = 0;
      while (need > 0 && guard < 40) {
        guard++;
        var cc = randInt(0, cfg.COLS - 1);
        if (grid[cc].t === T.HARD_ROCK.id) {
          grid[cc] = makeTile(rng() < 0.5 ? 'DIRT' : 'CLAY');
          need--;
        }
      }
    }

    // Drift channel continuity: keep the previous row's softest column reachable
    var prev = rows.get(row - 1);
    if (prev && m < cfg.MID_DEPTH_M) {
      var prevSoftCols = [];
      for (c = 0; c < cfg.COLS; c++) {
        if (prev[c].t === T.DIRT.id || prev[c].t === T.CLAY.id || prev[c].t === T.EMPTY.id) {
          prevSoftCols.push(c);
        }
      }
      if (prevSoftCols.length) {
        var target = prevSoftCols[randInt(0, prevSoftCols.length - 1)];
        // check own row has soft tile within +-1 of target
        var ok = false;
        for (var d = -1; d <= 1; d++) {
          var tc = target + d;
          if (tc >= 0 && tc < cfg.COLS &&
              (grid[tc].t === T.DIRT.id || grid[tc].t === T.CLAY.id)) { ok = true; break; }
        }
        if (!ok) {
          var fix = Math.max(0, Math.min(cfg.COLS - 1, target));
          if (grid[fix].t !== T.TNT.id && grid[fix].t !== T.ICE.id && grid[fix].t !== T.GOLD.id) {
            grid[fix] = makeTile('DIRT');
          }
        }
      }
    }

    /* ---- Stage 2: deep-drift safety channel. Below MAGMA depth rows can be
       brutally dense, so always leave ONE non-hazard column aligned with a
       safe (non-magma/non-spike/non-solid-wall) column above. Losing is still
       easy — you just can't get geometrically bricked by bad luck. ---- */
    if (m >= cfg.MAGMA_DEPTH_M && prev) {
      var hazardOf = function (tt) { return tt === T.MAGMA_ROCK.id || tt === T.SPIKE_MINE.id; };
      var safeAbove = [];
      for (c = 0; c < cfg.COLS; c++) {
        if (!hazardOf(prev[c].t)) safeAbove.push(c);
      }
      if (safeAbove.length) {
        var anchor = safeAbove[randInt(0, safeAbove.length - 1)];
        var clear = false;
        for (var w = -1; w <= 1 && !clear; w++) {
          var wc = anchor + w;
          if (wc >= 0 && wc < cfg.COLS && !hazardOf(grid[wc].t)) clear = true;
        }
        if (!clear) {
          // soften the anchor cell itself (never onto a hazard, never TNT-adjacent spam)
          grid[anchor] = makeTile(m > cfg.SPIKE_DEPTH_M + 60 && rng() < 0.3 ? 'HARD_ROCK' : (rng() < 0.5 ? 'CLAY' : 'DIRT'));
        }
      }
    }

    return grid;
  }

  /* Ensure all rows up to `upTo` exist. Called from game loop. */
  function ensureRows(upTo) {
    while (generatedUpTo < upTo) {
      generatedUpTo++;
      rows.set(generatedUpTo, generateRow(generatedUpTo));
    }
  }

  function getRow(row) { return rows.get(row) || null; }

  function getTile(row, col) {
    if (col < 0 || col >= cfg.COLS) return null;
    var g = rows.get(row);
    return g ? g[col] : null;
  }

  function setTileEmpty(row, col) {
    var g = rows.get(row);
    if (!g) return null;
    var old = g[col];
    g[col] = { t: T.EMPTY.id, hp: 0, maxHp: 0 };
    return old;
  }

  function damageTile(tile, amount) {
    if (!tile || tile.t === T.EMPTY.id) return false;
    tile.hp -= amount;
    return tile.hp <= 0;
  }

  /* Prune rows far above camera to keep memory flat */
  function prune(minRow) {
    var it = rows.keys();
    var step = it.next();
    while (!step.done) {
      var r = step.value;
      if (r < minRow) rows.delete(r);
      else break; // map preserves insertion order == ascending rows
      step = it.next();
    }
  }

  function reset(newSeed) {
    rows.clear();
    generatedUpTo = -1;
    vaults.length = 0;
    if (typeof newSeed === 'number') seed = newSeed >>> 0;
    else seed = (Math.random() * 0xffffffff) >>> 0;
    ensureRows(4);
  }

  window.CB.world = {
    reset: reset,
    ensureRows: ensureRows,
    getRow: getRow,
    getTile: getTile,
    setTileEmpty: setTileEmpty,
    damageTile: damageTile,
    prune: prune,
    isSolid: isSolid,
    depthAtRow: depthAtRow,
    /* Stage 3 API */
    biomeIndexAt: biomeIndexAt,
    biomeBlend: biomeBlend,
    hpMultAt: hpMultAt,
    vaults: vaults,
    isVaultTile: function (tile) {
      return !!tile && (tile.t === T.VAULT_PLATE.id || tile.t === T.VAULT_CORE.id);
    },
    generatedThrough: function () { return generatedUpTo; }
  };
})();
