window.CB = window.CB || {};
window.CB.config = {
  COLS: 9,
  ROWS_AHEAD: 14,
  CHUNK_ROWS: 16,
  TILE_TO_METERS: 0.5,

  TILES: {
    EMPTY:     { id: 0, name: 'EMPTY',     hp: 0,   solid: false, color: '#F4ECE1' },
    DIRT:      { id: 1, name: 'DIRT',      hp: 25,  solid: true,  color: '#C9A227', base: '#D9B36B', edge: '#A87F3E', grit: '#8C6239' },
    CLAY:      { id: 2, name: 'CLAY',      hp: 45,  solid: true,  color: '#D96B43', base: '#D96B43', edge: '#A94E2E', grit: '#7E3A22' },
    HARD_ROCK: { id: 3, name: 'HARD_ROCK', hp: 90,  solid: true,  color: '#8A7563', base: '#9C8770', edge: '#6B5744', grit: '#4C3D2E' },
    GOLD:      { id: 4, name: 'GOLD',      hp: 50,  solid: true,  color: '#F2B705', base: '#F2B705', edge: '#B8860B', grit: '#FFF3C4' },
    QUARTZ:    { id: 5, name: 'QUARTZ',    hp: 65,  solid: true,  color: '#1B998B', base: '#1B998B', edge: '#0E6BA8', grit: '#A9E8DF' },
    TNT:       { id: 6, name: 'TNT',       hp: 15,  solid: true,  color: '#E63946', base: '#E63946', edge: '#2B211E', grit: '#F2B705' },
    ICE:       { id: 7, name: 'ICE',       hp: 30,  solid: true,  color: '#5BC0BE', base: '#AEE4E2', edge: '#5BC0BE', grit: '#FFFFFF' },
    MAGMA_ROCK:{ id: 8, name: 'MAGMA_ROCK',hp: 110, solid: true,  color: '#7A1E12', base: '#5C1810', edge: '#7A1E12', grit: '#E63946' },
    SPIKE_MINE:{ id: 9, name: 'SPIKE_MINE',hp: 80,  solid: true,  color: '#6B5744', base: '#8A7563', edge: '#2B211E', grit: '#D96B43' },
    VAULT_PLATE:{ id: 10, name: 'VAULT_PLATE', hp: 800, solid: true, color: '#8A7563', base: '#6B5744', edge: '#2B211E', grit: '#F2B705' },
    VAULT_CORE: { id: 11, name: 'VAULT_CORE',  hp: 320, solid: true, color: '#F2B705', base: '#F2B705', edge: '#D96B43', grit: '#FFF3C4' }
  },

  /* Опасности появляются СРАЗУ с 35-50 метров! */
  MID_DEPTH_M: 25,
  DEEP_DEPTH_M: 60,
  MAGMA_DEPTH_M: 35,
  SPIKE_DEPTH_M: 50,

  MIX_EARLY:  { DIRT: 55, CLAY: 28, HARD_ROCK: 8, GOLD: 5, QUARTZ: 3, TNT: 1 },
  MIX_MID:    { DIRT: 32, CLAY: 26, HARD_ROCK: 18, GOLD: 8, QUARTZ: 6, TNT: 3, ICE: 2, MAGMA_ROCK: 5 },
  MIX_DEEP:   { DIRT: 18, CLAY: 22, HARD_ROCK: 26, GOLD: 10, QUARTZ: 7, TNT: 4, ICE: 3, MAGMA_ROCK: 6, SPIKE_MINE: 4 },
  MIX_MAGMA:  { DIRT: 15, CLAY: 20, HARD_ROCK: 25, GOLD: 10, QUARTZ: 8, TNT: 4, ICE: 3, MAGMA_ROCK: 9, SPIKE_MINE: 6 },
  MIX_SPIKE:  { DIRT: 12, CLAY: 16, HARD_ROCK: 25, GOLD: 12, QUARTZ: 8, TNT: 4, ICE: 3, MAGMA_ROCK: 10, SPIKE_MINE: 10 },
  MIX_QUARTZ_CAVES: { DIRT: 20, CLAY: 18, HARD_ROCK: 20, GOLD: 8, QUARTZ: 20, TNT: 4, ICE: 3, MAGMA_ROCK: 5, SPIKE_MINE: 2 },
  MIX_OBSIDIAN:     { DIRT: 10, CLAY: 12, HARD_ROCK: 42, GOLD: 10, QUARTZ: 6, TNT: 6, ICE: 4, MAGMA_ROCK: 6, SPIKE_MINE: 4 },
  MIX_MOLTEN:       { DIRT: 6,  CLAY: 8,  HARD_ROCK: 36, GOLD: 18, QUARTZ: 6, TNT: 5, ICE: 6, MAGMA_ROCK: 11, SPIKE_MINE: 4 },

  VEIN: {
    GOLD_CHANCE: 0.16, GOLD_LEN_MIN: 2, GOLD_LEN_MAX: 4,
    QUARTZ_CHANCE: 0.15, QUARTZ_SIZE_MIN: 3, QUARTZ_SIZE_MAX: 5,
    TNT_CHANCE: 0.08,
    ICE_CHANCE: 0.07
  },

  SAW: {
    RADIUS_RATIO: 0.085,
    ANCHOR_Y_RATIO: 0.22,
    GRAVITY_BASE: 110,
    GRAVITY_BOOST: 250,
    STEER_ACCEL: 2800,
    STEER_DAMP: 8.5,
    MAX_VX: 640,
    SPIN_BASE: 12,
    SPIN_BOOST_MULT: 2.6,
    DPS_BASE: 60,
    BOOST_DMG_MULT: 2.4,
    REDLINE_DMG_MULT: 3.0,
    TEETH: 12
  },

  HEAT: {
    MAX: 100,
    REDLINE_MIN: 75,
    REDLINE_MAX: 95,
    BOOST_GAIN: 22,      /* Нагрев в бусте идет быстрее: 4.5 сек до 100%! */
    CONTACT_GAIN: 12,
    IDLE_COOL: 8,
    OVERHEAT_RESET: 30,
    OVERHEAT_RADIUS: 1.6,
    NUGGET_REDLINE_MULT: 2,
    MAGMA_TOUCH_HEAT: 25,
    RAD_BUILD_REDUCE: 0.12,
    RAD_ZONE_MIN_L0: 75, RAD_ZONE_MIN_L5: 70,
    RAD_ZONE_MAX_L0: 95, RAD_ZONE_MAX_L5: 96
  },

  /* Опасность завала: если застрял на твердом камне дольше 4.5с — потолок рушится! */
  STALL_TIME_LIMIT: 4.5,

  CHAIN: { STEP_DELAY: 0.06, BONUS_GOLD: 3 },
  COMBO: { WINDOW: 1.5 },
  SHOCK: { BASE_PERIOD: 6, PERIOD_PER_LEVEL: 0.5, MIN_PERIOD: 3, RADIUS_TILES: 2.5, DAMAGE: 65 },

  NUGGET: {
    VALUE: 1,
    QUARTZ_CHIP: 2,
    GRAVITY: 260,
    SUCTION_BASE: 550,
    COLLECT_Y_RATIO: 0.05,
    SPAWN_JITTER: 120
  },

  PLAYER: { START_HP: 3, MAX_HP_CAP: 6, START_GOLD: 0 },

  UPGRADES: {
    dps:     { name: 'ЗУБЬЯ ПИЛЫ',   baseCost: 15, costMult: 1.5,  maxLevel: 25, effect: 0.35 },
    radiator:{ name: 'РАДИАТОР',    baseCost: 25, costMult: 1.55, maxLevel: 15, effect: 0.12 },
    vacuum:  { name: 'ВАКУУМ-РУДЫ', baseCost: 20, costMult: 1.5,  maxLevel: 20, effect: 0.25 },
    shock:   { name: 'СЕЙСМО-УДАР', baseCost: 30, costMult: 1.6,  maxLevel: 15, effect: 0.5 }
  },

  SPIKE_SKILL_BONUS: 25,

  FX: {
    SHAKE_DECAY: 6.5,
    MAX_SHAKE: 14,
    PARTICLE_GRAVITY: 640,
    MAX_PARTICLES: 320
  },

  BIOMES: [
    { name: 'КАСПИЙСКИЙ КАНЬОН',   minDepth: 0,    tint: '#F4ECE1', hpMult: 1.0,  hardBonus: 0 },
    { name: 'ИЗУМРУДНЫЕ ПЕЩЕРЫ',  minDepth: 250,  tint: '#E8F0E8', hpMult: 1.35, hardBonus: 15 },
    { name: 'ОБСИДИАНОВЫЙ ОПЛОТ', minDepth: 600,  tint: '#DFD9D2', hpMult: 1.8,  hardBonus: 40 },
    { name: 'ПЛАМЕННОЕ ЯДРО',     minDepth: 1000, tint: '#F7E3D4', hpMult: 2.6,  hardBonus: 80 }
  ],
  BIOME_BLEND_M: 60,
  CORE_HEAT_GAIN_MULT: 1.45,

  VAULT: {
    INTERVAL_M: 250,
    THICK_ROWS: 3,
    CORE_SIZE: 2,
    PLATE_HP: 800,
    CORE_HP: 320,
    TIMER_SECONDS: 12,
    REWARD_NUGGETS: 50,
    REWARD_HP: 1,
    FAIL_HP_DAMAGE: 1
  },

  MILESTONE_STEP_M: 250,
  HIGHSCORE_KEY: 'cb_high_score',
  STORAGE: { BEST: 'cb_best_depth', META: 'cb_meta_garage' }
};
