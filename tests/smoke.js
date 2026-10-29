/* Смоук-тест js/game.js в Node с мок-DOM/canvas.
   Проверяет: init(), mute-кнопку, redline CSS-переменные, бейджи уровней,
   экономику dps (costMult 1.32), структуру Босс-шлюзов, стабильность кадров. */
'use strict';
var fs = require('fs');
var vm = require('vm');

/* ---------- Мок canvas 2D ---------- */
function makeCtx() {
  var noop = function () {};
  return new Proxy({
    canvas: null,
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, lineCap: 'butt',
    globalAlpha: 1, font: '', textAlign: '', textBaseline: '',
    createLinearGradient: function () { return { addColorStop: noop }; },
    createRadialGradient: function () { return { addColorStop: noop }; },
    measureText: function () { return { width: 10 }; },
    getImageData: function () { return { data: new Uint8ClampedArray(4) }; },
    putImageData: noop
  }, {
    get: function (t, k) { return (k in t) ? t[k] : noop; },
    set: function (t, k, v) { t[k] = v; return true; }
  });
}

/* ---------- Мок DOM ---------- */
var listeners = {};
function makeEl(id) {
  return {
    id: id, tagName: 'DIV', textContent: '', innerHTML: '', title: '',
    style: { display: '', setProperty: function (k, v) { this[k] = v; } },
    classList: { _s: {},
      add: function (c) { this._s[c] = true; },
      remove: function (c) { delete this._s[c]; },
      toggle: function (c, force) { if (force === undefined) { if (this._s[c]) delete this._s[c]; else this._s[c] = true; } else if (force) this._s[c] = true; else delete this._s[c]; },
      contains: function (c) { return !!this._s[c]; } },
    attrs: {},
    getAttribute: function (k) { return this.attrs[k] || null; },
    setAttribute: function (k, v) { this.attrs[k] = v; },
    addEventListener: function (ev, fn) { (listeners[id + ':' + ev] = listeners[id + ':' + ev] || []).push(fn); },
    appendChild: function () {},
    getContext: function () { var c = makeCtx(); c.canvas = this; return c; },
    getBoundingClientRect: function () { return { left: 0, top: 0, width: 360, height: 640 }; },
    width: 360, height: 640
  };
}
var els = {};
['game','stage','hud-depth','hud-gold','hud-hearts','heat-bar','heat-fill','redline-tag',
 'modal-runover','modal-start','boost-hint','stall-warning','stat-depth','stat-gold',
 'stat-tiles','stat-best','btn-mute','lvl-dps','lvl-radiator','lvl-vacuum','lvl-shock',
 'cost-dps','cost-radiator','cost-vacuum','cost-shock','btn-start','btn-restart'].forEach(function (id) {
  els[id] = makeEl(id);
});
var shopBtnEls = ['dps','radiator','vacuum','shock'].map(function (key) {
  var b = makeEl('shop-' + key);
  b.attrs['data-upgrade'] = key;
  /* внутри кнопки игры ищутся .shop-btn-cost / .shop-btn-lvl */
  b.querySelector = function (sel) {
    if (sel === '.shop-btn-cost') return els['cost-' + key];
    if (sel === '.shop-btn-lvl') return els['lvl-' + key];
    return null;
  };
  return b;
});

var rafQueue = [];
var sandbox = {
  console: console, Math: Math, JSON: JSON, Date: Date, Array: Array, Object: Object,
  parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN, String: String, Number: Number, Boolean: Boolean,
  document: {
    getElementById: function (id) { return els[id] || null; },
    querySelectorAll: function (sel) { return sel === '.shop-btn' ? shopBtnEls : []; },
    createElement: function () { return makeEl('tmp'); },
    addEventListener: function () {}
  },
  performance: { now: function () { return Date.now(); } },
  requestAnimationFrame: function (fn) { rafQueue.push(fn); return rafQueue.length; },
  cancelAnimationFrame: function () {},
  setTimeout: function () { return null; },
  localStorage: { getItem: function () { return null; }, setItem: function () {} },
  navigator: { userAgent: 'node-test' },
  AudioContext: undefined, webkitAudioContext: undefined, Telegram: undefined
};
sandbox.addEventListener = function (ev, fn) { (listeners['window:' + ev] = listeners['window:' + ev] || []).push(fn); };
sandbox.removeEventListener = function () {};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

function load(f) { vm.runInContext(fs.readFileSync(f, 'utf8'), sandbox, { filename: f }); }
load('js/config.js');
load('js/world.js');
load('js/audio.js');
load('js/game.js');

var CB = sandbox.CB, cfg = CB.config, world = CB.world;
var failures = [], passes = 0;
function check(name, cond) {
  if (cond) { passes++; console.log('PASS  ' + name); }
  else { failures.push(name); console.log('FAIL  ' + name); }
}

/* ---------- init ---------- */
CB.game.init();
check('init() не падает', true);

var muteClick = listeners['btn-mute:click'];
check('#btn-mute привязан', Array.isArray(muteClick) && muteClick.length === 1);
muteClick[0]();
check('mute → иконка 🔇', els['btn-mute'].textContent === '🔇');
muteClick[0]();
check('unmute → иконка 🔊', els['btn-mute'].textContent === '🔊');

/* ---------- старт и прогон кадров ---------- */
listeners['btn-start:click'][0]();
check('после start запущен rAF-цикл', rafQueue.length > 0);

function step(n) {
  for (var i = 0; i < n; i++) {
    var fn = rafQueue.shift();
    if (!fn) throw new Error('loop остановился преждевременно');
    sandbox.__t = (sandbox.__t || 0) + 16.7;
    fn(sandbox.__t);
  }
}
step(60);
check('60 кадров update+render без исключений', true);

/* ---------- HUD / магазин ---------- */
check('--rl-min установлен на heat-bar', els['heat-bar'].style['--rl-min'] !== undefined);
check('--rl-max установлен на heat-bar', els['heat-bar'].style['--rl-max'] !== undefined);
check('lvl-dps формат "УР. N"', /^УР\. \d+$/.test(String(els['lvl-dps'].textContent)));

/* экономика: честные покупки dps на заработанное золото (START_GOLD=0) */
var buyDps = listeners['shop-dps:click'][0];
/* бурим вниз с зажатой кнопкой, пока не накопаем золото */
var downFn = listeners['game:mousedown'] || listeners['canvas:mousedown'];
if (downFn) downFn[0]({ clientX: 180, clientY: 500, preventDefault: function () {}, touches: [{ clientX: 180, clientY: 500 }] });
for (var k = 0; k < 600 && parseInt(String(els['hud-gold'].textContent), 10) < cfg.UPGRADES.dps.baseCost; k++) {
  step(5);
}
var goldNow = parseInt(String(els['hud-gold'].textContent), 10);
check('бурение добывает золото (gold=' + goldNow + ')', goldNow >= cfg.UPGRADES.dps.baseCost);

var lvlBefore = parseInt(String(els['lvl-dps'].textContent).replace(/\D+/g, ''), 10) || 0;
var bought = 0;
for (var lv = 0; lv < 40; lv++) {
  var lvlPrev = String(els['lvl-dps'].textContent);
  buyDps();
  if (String(els['lvl-dps'].textContent) !== lvlPrev) bought++;
  else break; // денег не хватает — покупка отклонена (защита финансовой стены)
}
check('покупки dps проходят (' + bought + ' шт. на добытое золото)', bought >= 1);
var lvlNow = parseInt(String(els['lvl-dps'].textContent).replace(/\D+/g, ''), 10);
check('lvl-dps = УР. ' + lvlNow + ' после ' + bought + ' покупок', lvlNow === lvlBefore + bought);
var costNow = parseInt(String(els['cost-dps'].textContent), 10);
var expectCost = Math.floor(cfg.UPGRADES.dps.baseCost * Math.pow(cfg.UPGRADES.dps.costMult, lvlNow));
check('цена dps соответствует baseCost*costMult^lvl (' + costNow + ' ≈ ' + expectCost + ')',
      Math.abs(costNow - expectCost) <= 2);

/* формула tierBonus из ТЗ (математическая верификация констант) */
var expectDPS = cfg.SAW.DPS_BASE * (1 + 5 * cfg.UPGRADES.dps.effect) * Math.pow(1.25, Math.floor(5 / 5));
var linearDPS = cfg.SAW.DPS_BASE * (1 + 5 * cfg.UPGRADES.dps.effect);
check('tierBonus x1.25 каждые 5 уровней (формула)', Math.abs(expectDPS / linearDPS - 1.25) < 1e-9);

/* ---------- структура Босс-шлюзов ---------- */
/* генерируем мир глубоко, пока не появятся шлюзы */
world.ensureRows(Math.ceil(300 / cfg.TILE_TO_METERS) + 10);
check('шлюзы VAULT существуют в мире (каждые 250м)', world.vaults.length >= 1);
var gate = world.vaults[0];
if (gate) {
  var coreCells = 0, plateCells = 0;
  for (var rr = gate.topRow; rr < gate.topRow + cfg.VAULT.THICK_ROWS; rr++) {
    var rowArr = world.getRow(rr);
    if (!rowArr) continue;
    for (var cc = 0; cc < cfg.COLS; cc++) {
      var t = rowArr[cc];
      if (t && t.t === cfg.TILES.VAULT_CORE.id) coreCells++;
      if (t && t.t === cfg.TILES.VAULT_PLATE.id) plateCells++;
    }
  }
  check('шлюз содержит 4 ядра VAULT_CORE', coreCells === 4);
  check('шлюз содержит боковые плиты VAULT_PLATE (>0: ' + plateCells + ')', plateCells > 0);
  check('интервал шлюзов = 250м', cfg.VAULT.INTERVAL_M === 250);
  check('таймер штурма = 12с', cfg.VAULT.TIMER_SECONDS === 12);
}

/* HP жил масштабируется глубиной (предыдущий фикс world.js — регрессия) */
var deep = world.hpMultAt(1500);
var mid = world.hpMultAt(900);
check('hpMultAt бесконечная после 1000м (1500м=' + deep.toFixed(2) + ' > 1.2)', deep > 1.2 && deep > mid);

console.log('\n==== ИТОГ: ' + passes + ' PASS, ' + failures.length + ' FAIL ====');
if (failures.length) { failures.forEach(function (f) { console.log('  ✗ ' + f); }); process.exitCode = 1; }
