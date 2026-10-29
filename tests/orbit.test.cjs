/* Renderer lifecycle/continuity only: actual orbit.js with a deterministic RAF and WebGL sink. */
'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/orbit.js'), 'utf8');

function harness({reduced = false, script = source, width = 440, height = 956, dpr = 3, gpuLimit = 16384} = {}) {
  let now = 0, id = 0, writes = 0;
  const frames = new Map(), draws = [], uniforms = new Map();
  const allocations = [], deleted = {textures: [], framebuffers: [], programs: [], buffers: []};
  let currentProgram = null, framebuffer = null, viewport = [];
  class Target {
    constructor() {this.listeners = new Map();}
    addEventListener(type, fn) {if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn);}
    removeEventListener(type, fn) {this.listeners.set(type, (this.listeners.get(type) || []).filter(x => x !== fn));}
    emit(type, props = {}) {for (const fn of this.listeners.get(type) || []) fn(props);}
  }
  const gl = new Proxy({
    TRIANGLES: 4, POINTS: 0, MAX_VIEWPORT_DIMS: 1, MAX_RENDERBUFFER_SIZE: 2, MAX_TEXTURE_SIZE: 3, FRAMEBUFFER_COMPLETE: 4,
    getUniformLocation: (program, name) => {if (name === 'u_fluid') program.composite = true;return name;},
    getShaderParameter: () => true, getProgramParameter: () => true,
    createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}),
    createTexture: () => ({}), createFramebuffer: () => ({}),
    getParameter: key => key === 1 ? [gpuLimit, gpuLimit] : gpuLimit,
    checkFramebufferStatus: () => 4,
    bindFramebuffer: (_, value) => {framebuffer = value;},
    texImage2D: (_, level, format, width, height) => allocations.push([width, height]),
    useProgram: program => {currentProgram = program;},
    viewport: (...values) => {viewport = values;},
    deleteTexture: value => deleted.textures.push(value),
    deleteFramebuffer: value => deleted.framebuffers.push(value),
    deleteProgram: value => deleted.programs.push(value),
    deleteBuffer: value => deleted.buffers.push(value),
    getAttribLocation: () => 0,
    uniform1f: (key, value) => uniforms.set(key, value),
    uniform2f: (key, ...values) => uniforms.set(key, values),
    uniform3f: (key, ...values) => uniforms.set(key, values),
    uniform4f: (key, ...values) => uniforms.set(key, values),
    drawArrays: mode => draws.push({pass: mode === gl.POINTS ? 'orb' : currentProgram.composite ? 'composite' : 'fluid', framebuffer, viewport: [...viewport], resolution: [...uniforms.get('u_resolution')], pixel: uniforms.get('u_pixel'), time: now, touch: [...uniforms.get('u_touch')], light: uniforms.get('u_light'), morph: uniforms.get('u_morph'), voice: uniforms.get('u_voice'), bands: [...(uniforms.get('u_bands') || [0,0,0])], probe: [...(uniforms.get('u_probe') || [0,0,0,0])], grab: [...(uniforms.get('u_grab') || [0,0,0,0])], ripple: [...(uniforms.get('u_ripple') || [0,0,0,0])], expression: [...(uniforms.get('u_state') || [0,0,0,4])], expressionTime: uniforms.get('u_expressionTime'), clock: uniforms.get('u_time'), opacity: Number(canvas.style.opacity ?? 1)})
  }, {get(target, key) {return key in target ? target[key] : () => {};}});
  const canvas = new Target(); canvas.style = {};
  for (const key of ['width', 'height']) {let value = 1; Object.defineProperty(canvas, key, {get: () => value, set: n => {value = n; writes++;}});}
  canvas.getContext = type => type === 'webgl' ? gl : null;
  const stage = {getBoundingClientRect: () => ({width, height})};
  const media = new Target(); media.matches = reduced;
  const window = new Target(); window.matchMedia = () => media; window.devicePixelRatio = dpr;
  const document = new Target(); document.hidden = false; document.documentElement = {dataset: {scene: 'idle'}};
  document.querySelector = selector => selector === '#orb-canvas' ? canvas : selector === '#experience' ? stage : null;
  let sceneObserver;
  const context = {window, document, navigator: {}, performance: {now: () => now},
    MutationObserver: class {constructor(fn) {sceneObserver = fn;} observe() {} disconnect() {}},
    ResizeObserver: class {observe() {} disconnect() {}},
    requestAnimationFrame: fn => {const next = ++id; frames.set(next, fn); return next;},
    cancelAnimationFrame: key => frames.delete(key)};
  vm.runInNewContext(script, context, {filename: 'orbit.js'});
  const advance = delta => {now += delta; const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn(now);};
  const run = (duration, step = 1000 / 60) => {const count = Math.round(duration / step); for (let i = 0; i < count; i++) advance(duration / count);};
  const scene = value => {document.documentElement.dataset.scene = value; sceneObserver();};
  return {api: window.MyMoneyOrbit, advance, run, scene, draws, frames, document, window, media, allocations, deleted,
    canvas, get morph() {return draws.at(-1).morph;}, get audio() {return draws.at(-1).voice;}, get attraction() {return draws.at(-1).touch[2];}, get writes() {return writes;}};
}

function charged(h) {h.api.begin({x: 170, y: 410}); h.api.charge(1); h.run(500);}

test('handoff retains the live position and decays without a delayed second rise', () => {
  const h = harness(); charged(h); const before = h.attraction;
  h.api.handoff(); assert.equal(h.attraction, before, 'event must not snap the field');
  h.advance(1); assert.ok(Math.abs(h.attraction - before) < .002);
  h.run(240); assert.ok(h.attraction < before * .6, 'slower release still returns continuously');
  const tail = []; for (let i = 0; i < 120; i++) {h.advance(1000 / 60); tail.push(h.attraction);}
  assert.ok(tail.every((x, i) => x >= 0 && (!i || x <= tail[i - 1])));
  assert.equal(h.attraction, 0);
});

test('release reaches the same field at 60 and 120 Hz', () => {
  const slow = harness(), fast = harness(); charged(slow); charged(fast);
  slow.api.handoff(); fast.api.handoff(); slow.run(300, 1000 / 60); fast.run(300, 1000 / 120);
  assert.ok(Math.abs(slow.attraction - fast.attraction) < 1e-10);
});

test('duplicate handoff from the trigger and modal does not restart the release', () => {
  const once = harness(), twice = harness(); charged(once); charged(twice);
  once.api.handoff(); twice.api.handoff(); once.advance(16); twice.advance(16); twice.api.handoff();
  once.run(240); twice.run(240); assert.equal(once.attraction, twice.attraction);
});

test('quick tap has a modest response and no negative overshoot', () => {
  const h = harness(); h.api.begin({x: 170, y: 410}); h.api.handoff();
  let peak = 0; for (let i = 0; i < 200; i++) {h.advance(10); peak = Math.max(peak, h.attraction); assert.ok(h.attraction >= 0);}
  assert.ok(peak > .1 && peak < .2); assert.equal(h.attraction, 0);
});

test('adaptive quality affects only fluid pixels and never reallocates during hold, release, or an open panel', () => {
  const h = harness(); h.run(1900, 1000 / 120); const initial = h.allocations.length, nativeWrites = h.writes;
  h.api.begin({x: 170, y: 410}); h.api.charge(1); h.run(400, 1000 / 120); assert.equal(h.allocations.length, initial);
  h.api.handoff(); h.run(800, 1000 / 120); assert.equal(h.allocations.length, initial);
  h.scene('modal'); h.run(3000, 1000 / 120); assert.equal(h.allocations.length, initial);
  h.scene('idle'); h.run(3000, 1000 / 120); assert.ok(h.allocations.length > initial, 'idle fluid adaptation remains enabled');
  assert.equal(h.writes, nativeWrites, 'adaptive fluid quality must never resize or soften the particle surface');
  assert.deepEqual([h.canvas.width, h.canvas.height], [1320, 2868]);
});

test('reduced motion keeps the renderer still through contact and release', () => {
  const h = harness({reduced: true}); h.api.begin({x: 170, y: 410}); h.api.charge(1); h.api.handoff(); h.api.release(); h.run(1000);
  assert.equal(h.frames.size, 0); assert.equal(h.attraction, 0);
});

// Compare against the previous return constants without relying on screen timing.
test('tap and hold returns take twice the previous time without increasing their amplitude', () => {
  const previous = source.replace('const speed = 7,', 'const speed = 14,')
    .replace('Math.max(attractionVelocity * .5, Math.max(0, .32 - attraction) * 7)', 'Math.max(attractionVelocity, Math.max(0, .32 - attraction) * 14)')
    .replace('if (!releasing) attractionVelocity *= .5;', '');
  for (const duration of [0, 60, 500]) {
    const now = harness(), before = harness({script: previous});
    for (const h of [now, before]) {h.api.begin({x: 170, y: 410}); h.api.charge(1); if (duration) h.run(duration); h.api.handoff();}
    for (const elapsed of [60, 120, 180]) {
      now.run(elapsed * 2); before.run(elapsed);
      assert.ok(Math.abs(now.attraction - before.attraction) < 1e-10, `time scaling at hold ${duration}`);
    }
  }
});

test('data and entry panels retain the same visible background illumination', () => {
  const data = harness(), modal = harness(); data.scene('data'); modal.scene('modal');
  data.run(3000); modal.run(3000);
  assert.equal(data.draws.at(-1).light, modal.draws.at(-1).light);
  assert.ok(data.draws.at(-1).light >= .72);
});

test('a prolonged contact, cancellation and page visibility cycle keep one live animation loop', () => {
  const h = harness(); charged(h); h.run(10000);
  assert.equal(h.frames.size, 1);
  h.api.release(); h.api.release(); h.run(2500);
  assert.equal(h.attraction, 0); assert.equal(h.frames.size, 1);
  h.document.hidden = true; h.document.emit('visibilitychange'); assert.equal(h.frames.size, 0);
  h.document.hidden = false; h.document.emit('visibilitychange');
  h.api.begin({x: 170, y: 410}); h.api.charge(1); h.run(500);
  assert.ok(h.attraction > .9); assert.equal(h.frames.size, 1);
});

test('assistant is the same visible, continuously moving renderer from start to finish', () => {
  const h = harness(), initialClock = h.draws.at(-1).clock;
  h.api.assistant(true); h.run(3000);
  assert.equal(h.frames.size, 1);
  assert.ok(h.morph > .999);
  const settledClock = h.draws.at(-1).clock, count = h.draws.length;
  h.run(500);
  assert.ok(h.draws.length > count, 'the compressed material must keep flowing');
  assert.ok(h.draws.at(-1).clock > settledClock && settledClock > initialClock);
  assert.ok(h.draws.every(draw => draw.opacity === 1), 'no opacity dip or replacement scene');
  h.api.assistant(false); h.run(3500);
  assert.equal(h.morph, 0); assert.equal(h.frames.size, 1);
  assert.ok(h.draws.every((draw, i) => !i || draw.clock >= h.draws[i - 1].clock), 'never rewind/reset the material clock');
});

test('early close and reopen preserve the live morph and outgoing velocity', () => {
  const h = harness();h.api.assistant(true);h.run(300);
  const before = h.morph;
  h.api.assistant(false); assert.equal(h.morph, before, 'closing must not reset position');
  h.advance(1);const after = h.morph;
  assert.ok(after > before && after - before < .004, 'preserve forward velocity before smoothly reversing');
  h.run(240); const returning = h.morph;
  h.api.assistant(true); assert.equal(h.morph, returning, 'reopening must not reset position');
  h.advance(1); assert.ok(Math.abs(h.morph - returning) < .004);
  h.run(3000);assert.ok(h.morph > .999);
  assert.ok(h.draws.every(draw => draw.morph >= 0 && draw.morph <= 1));
  assert.equal(h.frames.size, 1);
});

test('morph, reversal and reopening match at 60 and 120 Hz', () => {
  const slow = harness(), fast = harness();
  for (const [active, duration] of [[true,300],[false,240],[true,420],[false,600]]) {
    slow.api.assistant(active);fast.api.assistant(active);
    slow.run(duration,1000/60);fast.run(duration,1000/120);
    assert.ok(Math.abs(slow.morph-fast.morph)<1e-10, `frame independence after ${active}/${duration}`);
  }
});

test('measured voice shapes the silk only while listening and stale levels decay', () => {
  const h=harness();h.api.assistant(true);h.run(2000);
  h.api.setAudioLevel(.8);h.run(100);assert.equal(h.audio,0);
  h.api.setListening(true);h.api.setAudioLevel(.8);h.run(100);
  assert.ok(h.audio>.5 && h.audio<.8);
  h.run(2300);assert.ok(h.audio<.001, 'a stalled meter cannot leave the form expanded');
  h.api.setAudioLevel(.8);h.run(100);h.api.setListening(false);h.run(2000);assert.ok(h.audio<.001);
  h.api.setListening(true);h.api.setAudioLevel(.8);h.run(100);h.api.assistant(false);h.run(2000);assert.ok(h.audio<.001);
});

test('reduced motion settles into the same form without idle or audio animation', () => {
  const h=harness({reduced:true});h.api.assistant(true);
  assert.equal(h.morph,1);assert.equal(h.frames.size,0);
  h.api.setListening(true);h.api.setAudioLevel(1);h.run(2000);
  assert.equal(h.audio,0);assert.equal(h.frames.size,0);
  h.api.assistant(false);assert.equal(h.morph,0);assert.equal(h.frames.size,0);
});

test('hiding and resuming during a morph does not jump the clock or leak a loop', () => {
  const h=harness();h.api.assistant(true);h.run(300);const before=h.morph, clock=h.draws.at(-1).clock;
  h.document.hidden=true;h.document.emit('visibilitychange');assert.equal(h.frames.size,0);
  h.run(10000);assert.equal(h.morph,before);
  h.document.hidden=false;h.document.emit('visibilitychange');assert.equal(h.frames.size,1);
  h.advance(1);assert.ok(Math.abs(h.morph-before)<.004);assert.ok(h.draws.at(-1).clock-clock<.01);
});

test('long hold gathers the same material before opening and canceled hold returns it', () => {
  const h=harness();h.api.begin({x:170,y:410});h.api.charge(.3);h.run(200);assert.equal(h.morph,0,'quick contact must retain the local touch response');
  h.api.charge(1);h.run(300);assert.ok(h.morph>0 && h.morph<.2,'prelude gathers only a little of the field');
  const before=h.morph;h.api.release();assert.equal(h.morph,before);h.run(3500);assert.equal(h.morph,0);
});

test('a hold hands its current form into the assistant; lifting does not reset the active form', () => {
  const h=harness();h.api.begin({x:170,y:410});h.api.charge(1);h.run(300);const before=h.morph;
  h.api.handoff();h.api.assistant(true);assert.equal(h.morph,before);h.run(400);assert.ok(h.morph>before);
  const opened=h.morph;h.api.release();assert.equal(h.morph,opened);h.run(3000);assert.equal(h.morph,1);
});

test('pressing again during release preserves the local material instead of snapping',()=>{
  const h=harness();charged(h);h.api.handoff();h.run(80);
  const before=h.attraction,point=h.draws.at(-1).touch;
  h.api.begin({x:300,y:200});h.advance(1);
  assert.ok(Math.abs(h.attraction-before)<.01);
  assert.ok(Math.abs(h.draws.at(-1).touch[0]-point[0])<.01);
  h.api.charge(1);h.api.handoff();h.api.assistant(true);h.run(2000);
  assert.equal(h.frames.size,1);
});

const orbDraw = h => h.draws.findLast(draw => draw.pass === 'orb');
const orbCenter = {x: 220, y: 956 * .33};

test('orb hit testing uses CSS stage coordinates and rejects inactive or invalid points', () => {
  const h = harness();
  assert.equal(h.api.orbHitTest(orbCenter), false);
  h.api.assistant(true);h.run(2000);
  assert.equal(h.api.orbHitTest(orbCenter), true);
  assert.equal(h.api.orbHitTest({x: 330, y: orbCenter.y}), true);
  for (const point of [{x: 0, y: 0}, {x: 220, y: 800}, {x: NaN, y: 315}, {x: 220, y: Infinity}, null]) {
    assert.equal(h.api.orbHitTest(point), false);
  }
  h.api.assistant(false);assert.equal(h.api.orbHitTest(orbCenter), false);
});

test('orb hover and press interpolate without jumps and release or close clears their feedback', () => {
  const h = harness();h.api.assistant(true);h.run(2000);
  const before = orbDraw(h).probe;
  h.api.orbPointer({x: 280, y: orbCenter.y - 40}, {active: true});
  assert.deepEqual(orbDraw(h).probe, before, 'pointer events do not draw or snap the field');
  h.advance(16);
  const hover = orbDraw(h).probe;
  assert.ok(hover[0] > 0 && hover[1] > 0 && hover[2] > 0 && hover[2] < .2);assert.equal(hover[3], 0);
  h.api.orbPointer({x: 1e6, y: -1e6}, {active: true, pressed: true});h.run(100);
  assert.ok(orbDraw(h).probe[3] > 0 && orbDraw(h).probe[3] < 1);
  h.api.orbPointer({x: NaN, y: Infinity}, {active: true, pressed: true});h.run(100);
  assert.ok(orbDraw(h).probe.every(Number.isFinite));
  assert.ok(orbDraw(h).probe.slice(0, 2).every(value => Math.abs(value) <= 1.5));
  const pressed = orbDraw(h).probe[3];h.api.orbPointer(null, {active: false});h.advance(16);
  assert.ok(orbDraw(h).probe[3] > 0 && orbDraw(h).probe[3] < pressed, 'release decays instead of snapping');
  h.run(2000);assert.ok(orbDraw(h).probe.slice(2).every(value => value < 1e-6));
  h.api.orbPointer(orbCenter, {active: true, pressed: true});h.run(250);
  const active = orbDraw(h).probe[2];h.api.assistant(false);h.run(100);
  assert.ok(orbDraw(h).probe[2] < active);
  h.run(2000);h.api.assistant(true);h.run(2000);
  assert.ok(orbDraw(h).probe.slice(2).every(value => value < 1e-6), 'a reopened assistant never retains a pressed orb');
});

test('spectral bands are measured, clamped, listening-gated and decay when their meter stalls', () => {
  const h = harness();h.api.assistant(true);h.run(2000);
  h.api.setAudioLevel(1, {bass: 1, mid: 1, high: 1});h.run(100);
  assert.deepEqual(orbDraw(h).bands, [0,0,0]);
  h.api.setListening(true);h.api.setAudioLevel(.6, {bass: 4, mid: -2, high: .4});h.run(100);
  const bands = orbDraw(h).bands;
  assert.ok(bands[0] > .5 && bands[0] < 1);assert.equal(bands[1], 0);assert.ok(bands[2] > 0 && bands[2] < .4);
  h.run(2300);assert.ok(orbDraw(h).bands.every(value => value >= 0 && value < 1e-6));
  h.api.setAudioLevel(NaN, {bass: NaN, mid: Infinity, high: -Infinity});h.run(100);
  assert.ok(orbDraw(h).bands.every(value => Number.isFinite(value) && value < 1e-6));
  h.api.setAudioLevel(1, {bass: 1, mid: 1, high: 1});h.run(100);h.api.setListening(false);h.run(1800);
  assert.ok(orbDraw(h).bands.every(value => value < 1e-6));
  h.api.setListening(true);h.api.setAudioLevel(1, {bass: 1, mid: 1, high: 1});h.run(100);h.api.assistant(false);h.run(2000);
  h.api.assistant(true);h.run(2000);assert.ok(orbDraw(h).bands.every(value => value < 1e-6));
});

test('reduced motion suppresses orb pointer and spectral movement without starting a loop', () => {
  const h = harness({reduced: true});h.api.assistant(true);
  h.api.orbPointer(orbCenter, {active: true, pressed: true});h.api.setListening(true);
  h.api.setAudioLevel(1, {bass: 1, mid: 1, high: 1});h.run(2000);
  assert.deepEqual(orbDraw(h).probe, [0,0,0,0]);assert.deepEqual(orbDraw(h).bands, [0,0,0]);
  assert.equal(h.frames.size, 0);h.api.assistant(false);assert.equal(h.frames.size, 0);
});

test('the orb composites once per frame on the existing canvas and keeps one RAF owner', () => {
  const h = harness();let count = h.draws.length;h.advance(16);
  assert.deepEqual(h.draws.slice(count).map(draw => draw.pass), ['fluid', 'composite']);
  h.api.assistant(true);h.run(2000);count = h.draws.length;h.advance(16);
  const frame = h.draws.slice(count);
  assert.deepEqual(frame.map(draw => draw.pass), ['fluid', 'composite', 'orb']);assert.equal(h.frames.size, 1);
  assert.ok(frame[0].framebuffer, 'fluid must render offscreen');
  assert.equal(frame[1].framebuffer, null);assert.equal(frame[2].framebuffer, null, 'particles must bypass the low-resolution texture');
  assert.deepEqual(frame[0].viewport.slice(2), h.allocations.at(-1));
  assert.deepEqual(frame[2].viewport.slice(2), [1320, 2868]);
  h.api.assistant(false);h.run(3000);count = h.draws.length;h.advance(16);
  assert.deepEqual(h.draws.slice(count).map(draw => draw.pass), ['fluid', 'composite']);assert.equal(h.frames.size, 1);
});

test('Retina and 4K particles use physical pixels while fluid stays within its small pixel budget', () => {
  for (const [width, height, dpr, pixels] of [[440,956,3,[1320,2868]], [1920,1080,2,[3840,2160]], [3840,2160,1,[3840,2160]]]) {
    const h = harness({width, height, dpr});h.api.assistant(true);h.run(2000);
    assert.deepEqual([h.canvas.width, h.canvas.height], pixels);
    assert.deepEqual(orbDraw(h).resolution, pixels);assert.equal(orbDraw(h).pixel, dpr, 'dot diameter scales with physical pixels, not adaptive fluid quality');
    assert.ok(h.allocations.every(([w, h]) => w * h <= 421000 && w <= 901 && h <= 901));
    assert.equal(h.allocations.length, 1, 'normal animation allocates no new textures');
  }
});

test('monitor density changes update native output without reallocating an unchanged fluid texture', () => {
  const h = harness({width:1920, height:1080, dpr:1});h.api.assistant(true);h.run(2000);
  const allocated = h.allocations.length;
  h.window.devicePixelRatio=2;h.window.emit('resize');
  assert.deepEqual([h.canvas.width, h.canvas.height], [3840,2160]);assert.equal(orbDraw(h).pixel, 2);
  assert.equal(h.allocations.length, allocated);
  const writes=h.writes;h.window.emit('resize');assert.equal(h.writes,writes, 'duplicate resize must not clear the drawing buffer');
});

test('native output respects GPU bounds and releases the additional surface at teardown', () => {
  const h = harness({width:1920, height:1080, dpr:3, gpuLimit:2048});h.api.assistant(true);h.run(2000);
  assert.deepEqual([h.canvas.width,h.canvas.height],[2048,1152]);assert.equal(orbDraw(h).pixel,1152/1080);
  assert.equal(h.deleted.textures.length,0);assert.equal(h.deleted.framebuffers.length,0);
  h.window.emit('pagehide',{persisted:false});
  assert.equal(h.frames.size,0);assert.equal(h.deleted.textures.length,1);assert.equal(h.deleted.framebuffers.length,1);
  assert.equal(h.deleted.programs.length,3);assert.equal(h.deleted.buffers.length,2);
});

function grabOrb(h, step = 1000 / 60) {
  h.api.assistant(true);h.run(2000, step);
  h.api.orbPointer(orbCenter, {active: true, pressed: true});h.run(100, step);
  h.api.orbPointer({x: orbCenter.x + 100, y: orbCenter.y}, {active: true, pressed: true});h.run(400, step);
  assert.ok(orbDraw(h).grab[2] > .2, 'begin with a real visible drag, not an unimplemented or zero-valued uniform');
}

test('drag latches one material anchor and elastically stretches it instead of following with a glow', () => {
  const h = harness();h.api.assistant(true);h.run(2000);
  const start = {x: orbCenter.x + 30, y: orbCenter.y - 20};
  h.api.orbPointer(start, {active: true, pressed: true});h.run(100);
  const anchor = orbDraw(h).grab.slice(0, 2), before = orbDraw(h).grab.slice(2);
  h.api.orbPointer({x: start.x + 100, y: start.y}, {active: true, pressed: true});
  assert.deepEqual(orbDraw(h).grab.slice(2), before, 'a pointer move cannot snap the live deformation');
  h.advance(1);assert.ok(Math.abs(orbDraw(h).grab[2] - before[0]) < .01);
  h.run(400);assert.deepEqual(orbDraw(h).grab.slice(0, 2), anchor, 'the grabbed material point stays anchored');
  assert.ok(orbDraw(h).grab[2] > .2, 'a 100 px drag must visibly stretch the material');
  h.api.orbPointer({x: start.x + 1e6, y: start.y}, {active: true, pressed: true});h.run(1500);
  assert.ok(orbDraw(h).grab.every(Number.isFinite));
  assert.ok(Math.hypot(...orbDraw(h).grab.slice(2)) <= 1.01, 'long drags have a bounded elastic extent');
  assert.equal(h.frames.size, 1);
});

test('release preserves the live stretch then overshoots gently and settles without an extra RAF', () => {
  const h = harness();grabOrb(h);const stretched = orbDraw(h).grab[2];assert.ok(stretched > .2);
  h.api.orbPointer(null, {active: false, pressed: false});assert.equal(orbDraw(h).grab[2], stretched);
  h.advance(1);assert.ok(Math.abs(orbDraw(h).grab[2] - stretched) < .01);
  const wave = orbDraw(h).ripple;assert.ok(wave.every(Number.isFinite));assert.ok(wave[2] > 0 && wave[2] <= 1);
  const path = [];for (let i = 0; i < 210; i++) {
    const age = orbDraw(h).ripple[3];if (i === 6) h.api.orbPointer(null, {active: false});
    h.advance(1000 / 60);path.push(orbDraw(h).grab[2]);
    if (i === 6) assert.ok(orbDraw(h).ripple[3] > age, 'duplicate release does not restart the traveling wave');
  }
  assert.ok(path.every(Number.isFinite));assert.ok(path.some(value => value < -1e-4), 'elastic return crosses its resting position');
  assert.ok(Math.abs(path.at(-1)) < 1e-4, 'the return must finish rather than remain displaced');
  assert.ok(Math.max(...path.map(Math.abs)) <= stretched + .02, 'release adds no sudden energy spike');
  assert.ok(orbDraw(h).ripple[3] > 3, 'the release wave keeps aging toward its visual decay');
  assert.equal(h.frames.size, 1);
});

test('reversing a drag and grabbing again during its return preserve the live deformation', () => {
  const h = harness();grabOrb(h);const forward = orbDraw(h).grab[2];
  h.api.orbPointer({x: orbCenter.x - 100, y: orbCenter.y}, {active: true, pressed: true});
  assert.equal(orbDraw(h).grab[2], forward);h.advance(1);assert.ok(Math.abs(orbDraw(h).grab[2] - forward) < .01);
  h.run(350);assert.ok(orbDraw(h).grab[2] < -.2);
  h.api.orbPointer(null, {active: false});h.run(80);const returning = orbDraw(h).grab.slice(2);
  h.api.orbPointer({x: orbCenter.x + 30, y: orbCenter.y + 20}, {active: true, pressed: true});
  assert.deepEqual(orbDraw(h).grab.slice(2), returning, 'regrab does not erase the outgoing deformation');
  h.advance(1);assert.ok(Math.hypot(...orbDraw(h).grab.slice(2).map((value, i) => value - returning[i])) < .02);
  h.api.orbPointer(null, {active: false});h.run(3500);
  assert.ok(orbDraw(h).grab.slice(2).every(value => Math.abs(value) < 1e-4));assert.equal(h.frames.size, 1);
});

test('elastic drag and release agree at 60 and 120 Hz including the first overshoot', () => {
  const slow = harness(), fast = harness();grabOrb(slow, 1000 / 60);grabOrb(fast, 1000 / 120);
  slow.api.orbPointer(null, {active: false});fast.api.orbPointer(null, {active: false});
  for (const duration of [100, 150, 250, 500]) {
    slow.run(duration, 1000 / 60);fast.run(duration, 1000 / 120);
    assert.ok(orbDraw(slow).grab.slice(2).every((value, i) => Math.abs(value - orbDraw(fast).grab[i + 2]) < 1e-5));
  }
});

test('closing, hiding and reduced motion cannot leave a stale grab on the next assistant', () => {
  const closing = harness();grabOrb(closing);closing.api.assistant(false);closing.run(3000);
  closing.api.assistant(true);closing.run(2000);
  assert.ok(orbDraw(closing).grab.slice(2).every(value => Math.abs(value) < 1e-4));
  const hidden = harness();grabOrb(hidden);hidden.document.hidden = true;hidden.document.emit('visibilitychange');
  assert.equal(hidden.frames.size, 0);hidden.run(5000);hidden.document.hidden = false;hidden.document.emit('visibilitychange');hidden.run(500);
  assert.ok(orbDraw(hidden).grab.slice(2).every(value => Math.abs(value) < 1e-4));assert.equal(orbDraw(hidden).ripple[2], 0);assert.equal(hidden.frames.size, 1);
  const reduced = harness();grabOrb(reduced);reduced.media.matches = true;reduced.media.emit('change');
  assert.equal(reduced.frames.size, 0);assert.ok(orbDraw(reduced).grab.slice(2).every(value => Math.abs(value) < 1e-4));assert.equal(orbDraw(reduced).ripple[2], 0);
  reduced.api.orbPointer({x: orbCenter.x + 100, y: orbCenter.y}, {active: true, pressed: true});
  reduced.media.matches = false;reduced.media.emit('change');reduced.run(1000);
  assert.ok(orbDraw(reduced).grab.slice(2).every(value => Math.abs(value) < 1e-4));assert.equal(reduced.frames.size, 1);
});


test('assistant expressions ease between listening and processing without resetting geometry or adding loops', () => {
  const h=harness();h.api.assistant(true);h.run(1800);const before=h.morph;
  h.api.setAssistantPhase('listening');h.advance(1);
  assert.ok(h.draws.at(-1).expression[0]>0&&h.draws.at(-1).expression[0]<.01);
  h.run(700);assert.ok(h.draws.at(-1).expression[0]>.99);
  h.api.setAssistantPhase('processing');h.api.setListening(false);h.run(700);
  const state=h.draws.at(-1).expression;
  assert.ok(state[0]<.01&&state[1]>.99,'stopping recognition must not clear a newer processing phase');
  assert.ok(h.morph>=before);assert.equal(h.frames.size,1);
  h.api.assistant(false);h.run(2500);h.api.assistant(true);h.run(2500);
  assert.ok(h.draws.at(-1).expression.slice(0,3).every(value=>value<.001),'reopening must not retain busy or success signals');
});

test('confirmation is one bounded material impulse and duplicate callbacks do not restart it', () => {
  const h=harness();assert.equal(h.api.confirm(),false,'closed scenes cannot flash');
  h.api.assistant(true);h.run(1800);const writes=h.writes;
  assert.equal(h.api.confirm(),true);h.run(180);
  const pulse=h.draws.at(-1).expression[2],age=h.draws.at(-1).expression[3];
  assert.ok(pulse>.25&&pulse<.5);assert.equal(h.api.confirm(),false);
  h.advance(1);assert.ok(h.draws.at(-1).expression[3]>age,'duplicate must not rewind pulse');
  h.api.assistant(false);h.advance(16);
  assert.ok(h.draws.at(-1).expression[2]>0,'confirmation follows the closing material instead of being reset');
  h.run(1500);assert.ok(h.morph<.2);h.api.assistant(true);h.run(1200);assert.equal(h.draws.at(-1).expression[2],0);
  assert.equal(h.frames.size,1);assert.equal(h.writes,writes);
});

test('expressions are frame independent and cannot flash after visibility or reduced-motion changes', () => {
  const slow=harness(),fast=harness();
  for(const h of [slow,fast]){h.api.assistant(true);h.run(1800);h.api.setAssistantPhase('thinking');h.api.confirm();}
  slow.run(300,1000/60);fast.run(300,1000/120);
  slow.draws.at(-1).expression.forEach((value,i)=>assert.ok(Math.abs(value-fast.draws.at(-1).expression[i])<1e-10));
  slow.document.hidden=true;slow.document.emit('visibilitychange');slow.document.hidden=false;slow.document.emit('visibilitychange');
  assert.equal(slow.draws.at(-1).expression[2],0);
  const still=harness({reduced:true});still.api.assistant(true);still.api.setAssistantPhase('processing');still.api.confirm();still.run(1000);
  assert.deepEqual(still.draws.at(-1).expression,[0,0,0,4]);assert.equal(still.frames.size,0);
  assert.equal(still.api.setAssistantPhase('unrecognised'),false);
});
