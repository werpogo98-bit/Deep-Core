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

  function mixForDepth(m) {
    if (m >= cfg.DEEP_DEPTH_M) return cfg.MIX_DEEP;
    if (m >= cfg.MID_DEPTH_M) return cfg.MIX_MID;
    return cfg.MIX_EARLY;
  }

  function makeTile(name) {
    var def = T[name];
    return { t: def.id, hp: def.hp, maxHp: def.hp };
  }

  function isSolid(tile) {
    return tile && tile.t !== T.EMPTY.id;
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

  /* ---------- Row generation ---------- */
  function generateRow(row) {
    var m = depthAtRow(row);
    var mix = mixForDepth(m);
    var grid = new Array(cfg.COLS);

    for (var c = 0; c < cfg.COLS; c++) {
      grid[c] = makeTile(pickWeighted(mix));
    }

    // Surface apron: first two rows are soft dirt, no hazards
    if (row <= 1) {
      for (c = 0; c < cfg.COLS; c++) grid[c] = makeTile('DIRT');
    }

    // Features (skip near-surface rows so early game is fair)
    if (row >= 3) {
      if (rng() < cfg.VEIN.GOLD_CHANCE) stampGoldVein(grid, row);
      if (rng() < cfg.VEIN.QUARTZ_CHANCE) stampQuartzCluster(grid, row);
      if (rng() < cfg.VEIN.TNT_CHANCE) stampTNTcrate(grid);
      if (rng() < cfg.VEIN.ICE_CHANCE) stampIcePocket(grid);
    }

    /* ---- Anti-wall guarantee: never allow a fully solid row where every
       single tile is HARD_ROCK, and ensure at least 2 non-hard tiles per row
       early (< MID depth). Also carve a "drift channel": each row keeps at
       least one DIRT/CLAY tile adjacent to the previous row's soft column. ---- */
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
    generatedThrough: function () { return generatedUpTo; }
  };
})();
