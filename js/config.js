/* ==========================================================
   CRUST BREAKER: DEEP CORE — config.js
   Global constants, tile types, upgrades, heat parameters.
   Namespace: window.CB
   ========================================================== */
window.CB = window.CB || {};

window.CB.config = {

  /* ---------- Grid ---------- */
  COLS: 9,
  ROWS_AHEAD: 14,          // rows generated ahead of the camera bottom
  CHUNK_ROWS: 16,          // generation chunk height in rows
  TILE_TO_METERS: 0.5,     // depth conversion: 1 tile row = 0.5 m

  /* ---------- Tile types ---------- */
  TILES: {
    EMPTY:     { id: 0, name: 'EMPTY',     hp: 0,   solid: false, color: '#F4ECE1' },
    DIRT:      { id: 1, name: 'DIRT',      hp: 30,  solid: true,  color: '#C9A227', base: '#D9B36B', edge: '#A87F3E', grit: '#8C6239' },
    CLAY:      { id: 2, name: 'CLAY',      hp: 55,  solid: true,  color: '#D96B43', base: '#D96B43', edge: '#A94E2E', grit: '#7E3A22' },
    HARD_ROCK: { id: 3, name: 'HARD_ROCK', hp: 110, solid: true,  color: '#8A7563', base: '#9C8770', edge: '#6B5744', grit: '#4C3D2E' },
    GOLD:      { id: 4, name: 'GOLD',      hp: 70,  solid: true,  color: '#F2B705', base: '#F2B705', edge: '#B8860B', grit: '#FFF3C4' },
    QUARTZ:    { id: 5, name: 'QUARTZ',    hp: 85,  solid: true,  color: '#E8E2D5', base: '#EDE6DA', edge: '#BFB4A0', grit: '#FFFFFF' },
    TNT:       { id: 6, name: 'TNT',       hp: 20,  solid: true,  color: '#E63946', base: '#E63946', edge: '#2B211E', grit: '#F2B705' },
    ICE:       { id: 7, name: 'ICE',       hp: 40,  solid: true,  color: '#5BC0BE', base: '#AEE4E2', edge: '#5BC0BE', grit: '#FFFFFF' },
    /* Stage 2 hazards */
    MAGMA_ROCK: { id: 8,  name: 'MAGMA_ROCK', hp: 130, solid: true, color: '#7A1E12', base: '#5C1810', edge: '#7A1E12', grit: '#E63946' },
    SPIKE_MINE: { id: 9,  name: 'SPIKE_MINE', hp: 95,  solid: true, color: '#6B5744', base: '#8A7563', edge: '#2B211E', grit: '#D96B43' }
  },

  /* ---------- Depth-based spawn weights [minDepth(m), type, weight] ---------- */
  MIX_EARLY:  { DIRT: 62, CLAY: 22, HARD_ROCK: 6, GOLD: 5, QUARTZ: 3, TNT: 1.5, ICE: 0.5 },
  MIX_MID:    { DIRT: 40, CLAY: 26, HARD_ROCK: 15, GOLD: 8, QUARTZ: 5, TNT: 4, ICE: 2 },
  MIX_DEEP:   { DIRT: 24, CLAY: 24, HARD_ROCK: 28, GOLD: 11, QUARTZ: 6, TNT: 4.5, ICE: 2.5 },
  /* Stage 2: hazard-laced mixes (weights are renormalized at runtime by world.js) */
  MIX_MAGMA:  { DIRT: 20, CLAY: 20, HARD_ROCK: 26, GOLD: 10, QUARTZ: 8, TNT: 4, ICE: 2.5, MAGMA_ROCK: 6 },
  MIX_SPIKE:  { DIRT: 16, CLAY: 16, HARD_ROCK: 24, GOLD: 10, QUARTZ: 8, TNT: 4, ICE: 2.5, MAGMA_ROCK: 8, SPIKE_MINE: 5 },
  MID_DEPTH_M: 40,     // switch early -> mid
  DEEP_DEPTH_M: 100,   // switch mid -> deep
  MAGMA_DEPTH_M: 150,  // Stage 2: magma rocks appear below this depth
  SPIKE_DEPTH_M: 250,  // Stage 2: spike mines appear below this depth

  /* ---------- Veins & features ---------- */
  VEIN: {
    GOLD_CHANCE: 0.16,   GOLD_LEN_MIN: 2,   GOLD_LEN_MAX: 4,
    QUARTZ_CHANCE: 0.14, QUARTZ_SIZE_MIN: 3, QUARTZ_SIZE_MAX: 5,
    TNT_CHANCE: 0.08,
    ICE_CHANCE: 0.07,
    MIN_GAP_ROWS: 2      // guaranteed breakable spacing safety
  },

  /* ---------- Gyro-Saw rig ---------- */
  SAW: {
    RADIUS_RATIO: 0.085,      // radius as fraction of canvas width
    ANCHOR_Y_RATIO: 0.22,     // saw sits at 22% of canvas height (top-center area)
    GRAVITY_BASE: 90,         // px/s downward drift (non-boost)
    GRAVITY_BOOST: 210,       // px/s downward push while boosting
    STEER_ACCEL: 2600,        // px/s^2 horizontal accel toward drag target
    STEER_DAMP: 8.5,          // horizontal damping
    MAX_VX: 620,
    SPIN_BASE: 11,            // rad/s idle spin
    SPIN_BOOST_MULT: 2.5,     // OVERDRIVE: spins 2.5x faster
    DPS_BASE: 55,             // contact damage per second (before multipliers)
    BOOST_DMG_MULT: 2.5,      // +150% damage while boosting
    REDLINE_DMG_MULT: 3.0,    // x3 damage in redline zone
    TEETH: 12
  },

  /* ---------- Heat system ---------- */
  HEAT: {
    MAX: 100,
    REDLINE_MIN: 75,          // base zone; RADIATOR widens it to 70%-96%
    REDLINE_MAX: 95,
    BOOST_GAIN: 16,           // heat/sec while overdrive held
    CONTACT_GAIN: 9,          // extra heat/sec while chewing solid tiles in boost
    IDLE_COOL: 7,             // heat/sec cooling when released
    COOL_UPGRADE_MULT: 0.30,  // legacy suction-style multiplier (kept for saves)
    OVERHEAT_RESET: 30,       // heat resets here on explosion
    OVERHEAT_RADIUS: 1.6,     // tile radii destroyed by overheat blast
    NUGGET_REDLINE_MULT: 2,   // 2x gold nuggets in redline
    MAGMA_TOUCH_HEAT: 18,     // Stage 2: instant heat from touching magma rock
    /* Stage 2 — RADIATOR upgrade parameters */
    RAD_BUILD_REDUCE: 0.12,   // -12% heat buildup per radiator level
    RAD_ZONE_MIN_L0: 75, RAD_ZONE_MIN_L5: 70,   // redline low end widens at L5+
    RAD_ZONE_MAX_L0: 95, RAD_ZONE_MAX_L5: 96    // redline high end widens at L5+
  },

  /* ---------- Stage 2: chain reactions & combo dopamine ---------- */
  CHAIN: {
    STEP_DELAY: 0.06,         // seconds between auto-shattered adjacent quartz
    BONUS_GOLD: 3             // bonus gold showered per chained quartz tile
  },
  COMBO: {
    WINDOW: 1.5,              // seconds a broken tile counts toward the streak
    TIERS: [                  // threshold -> big center-screen badge text
      { n: 25,  label: 'CRUSHING!' },
      { n: 80,  label: 'MEGA EXCAVATION!' },
      { n: 150, label: 'CORE MELTDOWN!' }
    ]
  },

  /* ---------- Stage 2: SHOCK DRILL passive seismic discharges ---------- */
  SHOCK: {
    BASE_PERIOD: 6,           // seconds between shockwaves at level 1
    PERIOD_PER_LEVEL: 0.5,    // each extra level fires 0.5s faster
    MIN_PERIOD: 3,
    RADIUS_TILES: 2.5,        // damages all blocks within 2.5 tile radii
    DAMAGE: 60                // flat damage dealt by the wave
  },

  /* ---------- Nuggets / collector ---------- */
  NUGGET: {
    VALUE: 1,
    QUARTZ_VALUE: 0,          // quartz gives debris, small cash chip
    QUARTZ_CHIP: 2,
    GRAVITY: 260,
    SUCTION_BASE: 520,        // pull strength toward collector
    SUCTION_UPGRADE_MULT: 0.35,
    COLLECT_Y_RATIO: 0.05,    // collector line near top of canvas
    SPAWN_JITTER: 120
  },

  /* ---------- Player / run ---------- */
  PLAYER: {
    START_HP: 3,
    MAX_HP_CAP: 6,
    START_GOLD: 0
  },

  /* ---------- Garage upgrades (Stage 2 economy) ---------- */
  UPGRADES: {
    dps:     { name: 'SAW TEETH',   baseCost: 15, costMult: 1.6, maxLevel: 10, effect: 0.35 }, // +35% DPS/level; visual tier every 5 levels
    radiator:{ name: 'RADIATOR',    baseCost: 25, costMult: 1.6, maxLevel: 8,  effect: 0.12 }, // widens redline 70-96 @L5+, -12% buildup/level, heals +1 HP
    vacuum:  { name: 'ORE VACUUM',  baseCost: 20, costMult: 1.55, maxLevel: 8, effect: 0.25 }, // +25% gold value/level, +1 nugget per Gold/Quartz tile
    shock:   { name: 'SHOCK DRILL', baseCost: 30, costMult: 1.7, maxLevel: 6,  effect: 0.5 }   // passive seismic discharge every ~6s (faster/level)
  },
  SPIKE_SKILL_BONUS: 25,   // Stage 2: gold awarded for slicing a spike mine in REDLINE

  /* ---------- Feel ---------- */
  FX: {
    SHAKE_DECAY: 6.5,
    MAX_SHAKE: 14,
    PARTICLE_GRAVITY: 640,
    MAX_PARTICLES: 320,
    HITSTOP_ON_BREAK: 0.0
  },

  /* ---------- Persistence keys ---------- */
  STORAGE: {
    BEST: 'cb_best_depth',
    META: 'cb_meta_garage'
  }
};
