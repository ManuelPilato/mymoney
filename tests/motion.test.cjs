/* Isolated lifecycle tests for the actual interaction.js. No browser, CDP, or network. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../src/interaction.js'), 'utf8');

function createHarness({reduced = false, desktop = false, orb = false} = {}) {
  let now = 0, nextId = 0;
  const timers = new Map(), frames = new Map(), allAnimations = [], focusLog = [], fluid = [];
  const counts = {manual: 0, voice: 0, data: 0, suspend: 0};
  let document, window;
  class Element {
    constructor(id, tag = 'div', parent = null) {
      this.id = id; this.tagName = tag.toUpperCase(); this.parentElement = parent;
      this.listeners = new Map(); this.dataset = {}; this.attributes = new Map();
      this.children = []; this.open = false; this.isConnected = true; this.offsetHeight = 600;
      this.style = {setProperty(name, value) {this[name] = value;}};
      const classes = new Set();
      this.classList = {add: (...names) => names.forEach(n => classes.add(n)), remove: (...names) => names.forEach(n => classes.delete(n)), toggle: (name,force) => {const on=force===undefined?!classes.has(name):force;if(on)classes.add(name);else classes.delete(name);return on;}, contains: name => classes.has(name)};
      this.animations = []; this.captures = new Set(); this.showCalls = 0; this.modalCalls = 0;
      if (parent) parent.children.push(this);
    }
    addEventListener(type, fn, options) {if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push({fn, capture: options === true || !!options?.capture});}
    removeEventListener(type, fn) {this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item.fn !== fn));}
    append(element) {element.parentElement = this; this.children.push(element);}
    contains(element) {return element === this || this.children.some(child => child.contains(element));}
    setAttribute(name, value) {this.attributes.set(name, value);}
    removeAttribute(name) {this.attributes.delete(name);}
    matches(selector) {return selector.split(',').some(part => {const s=part.trim();return s === this.tagName.toLowerCase() || s === '#'+this.id || s === '[role=button]' && this.attributes.get('role')==='button' || s === '[contenteditable=true]' && this.contentEditable === 'true';});}
    closest(selector) {
      if (selector === 'dialog:not([open])') return this.tagName === 'DIALOG' && !this.open ? this : this.parentElement?.closest(selector) || null;
      if (this.matches(selector)) return this;
      return this.parentElement?.closest(selector) || null;
    }
    querySelector(selector) {
      if (selector === 'h2') return this.heading || null;
      if (selector === '.data-header,.dialog-head') return this.header || null;
      return null;
    }
    getBoundingClientRect() {return {left: 0, top: 0, right: 390, bottom: 600, width: 390, height: 600};}
    setPointerCapture(id) {this.captures.add(id);}
    hasPointerCapture(id) {return this.captures.has(id);}
    releasePointerCapture(id) {this.captures.delete(id);}
    focus() {document.activeElement = this; focusLog.push(this.id);}
    blur() {if (document.activeElement === this) document.activeElement = document.body;}
    show() {this.open = true; this.modal = false; this.showCalls++; this.nativeFocus();}
    showModal() {if (this.open && !this.modal) throw new Error('Cannot promote an open non-modal dialog'); this.open = true; this.modal = true; this.modalCalls++; this.nativeFocus();}
    nativeFocus() {
      // Model the autofocus path and an input-first fallback. This exposes any
      // opening path that could briefly focus a form control before a heading.
      const candidate = this.heading?.attributes.has('autofocus') ? this.heading : this.input;
      candidate?.focus();
    }
    close() {this.open = false; this.modal = false; this.dispatchEvent({type: 'close'});}
    dispatchEvent(event) {dispatch(this, event); return !event.defaultPrevented;}
    animate(keyframes, options) {
      let resolve;
      const animation = {keyframes, options, cancelled: false, settled: false, finished: new Promise(r => {resolve = r;}),
        cancel: () => {animation.cancelled = true; if (this.activeAnimation === animation) this.activeAnimation = null;},
        finish: () => {animation.settled = true; resolve();}};
      this.activeAnimation = animation; this.animations.push(animation); allAnimations.push(animation); return animation;
    }
  }
  const nodes = new Map();
  window = new Element('window'); document = new Element('document'); document.parentElement = window;
  const html = new Element('html', 'html', document), body = new Element('body', 'body', html);
  document.documentElement = html; document.body = body; document.activeElement = body; document.hidden = false;
  const add = (id, tag = 'div', parent = body) => {const element = new Element(id, tag, parent); nodes.set(id, element); return element;};
  const surface = add('touch-surface', 'button'), sheet = add('data-sheet', 'dialog'), quick = add('quick-entry', 'dialog'), voice = add('voice-sheet', 'dialog');
  const dialogList = [sheet, quick, voice];
  for (const dialog of dialogList) {dialog.header = add(dialog.id + '-header', 'div', dialog); dialog.heading = add(dialog.id + '-heading', 'h2', dialog.header); dialog.input = add(dialog.id + '-input', 'input', dialog);}
  for (const id of ['experience', 'data-scroll', 'open-data', 'desktop-add', 'desktop-voice', 'desktop-data', 'accessible-voice', 'close-data']) add(id, id === 'experience' || id === 'data-scroll' ? 'div' : 'button');
  const trigger = add('trigger', 'button');
  document.querySelector = selector => selector.startsWith('#') ? nodes.get(selector.slice(1)) || null : null;
  document.querySelectorAll = selector => selector === 'dialog[open]' ? dialogList.filter(d => d.open) : selector === 'dialog' ? dialogList : [];
  document.createElement = tag => new Element('created-' + tag, tag);
  window.MyMoneyOrbit = new Proxy({}, {get: (_, name) => name==='orbHitTest' ? position=>orb&&Math.hypot(position.x-195,position.y-240)<=90 : (...args) => fluid.push({name, args})});
  const storage = new Map();
  function dispatch(target, input) {
    const event = {button: 0, pointerId: 1, isPrimary: true, clientX: 195, clientY: 550, detail: 1, bubbles: true, ...input, target: input.target || target,
      preventDefault() {this.defaultPrevented = true;}, stopImmediatePropagation() {this.stopped = true;}};
    const chain = []; for (let node = target; node; node = node.parentElement) chain.unshift(node);
    for (const capture of [true, false]) {
      const order = capture ? chain : [...chain].reverse();
      for (const node of order) {
        if (!capture && node !== target && !event.bubbles) continue;
        event.currentTarget = node;
        for (const listener of node.listeners.get(event.type) || []) if (listener.capture === capture) {listener.fn(event); if (event.stopped) return event;}
      }
    }
    return event;
  }
  const context = {window, document, HTMLElement: Element, navigator: {platform: 'iPhone'}, innerHeight: 844,
    performance: {now: () => now}, matchMedia: query => ({matches: query.includes('reduced-motion') ? reduced : query.includes('900px') ? desktop : false}),
    localStorage: {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key)},
    getComputedStyle: element => ({transform: element.activeAnimation?.keyframes[0]?.transform ?? element.style.transform ?? 'none', opacity: element.activeAnimation?.keyframes[0]?.opacity ?? element.style.opacity ?? (element.className === 'data-scrim' ? '0' : '1')}),
    DOMMatrixReadOnly: class {constructor(value) {this.m42 = Number(value.match(/translate3d\(0,([-.\d]+)px/)?.[1] || 0);}},
    CustomEvent: class {constructor(type, options) {this.type = type; Object.assign(this, options);}},
    setTimeout: (fn, delay) => {const id = ++nextId; timers.set(id, {fn, at: now + delay}); return id;}, clearTimeout: id => timers.delete(id),
    requestAnimationFrame: fn => {const id = ++nextId; frames.set(id, fn); return id;}, cancelAnimationFrame: id => frames.delete(id)};
  vm.runInNewContext(source, context, {filename: 'interaction.js'});
  const UI = window.MMUI;
  UI.init({manual: () => {counts.manual++; UI.open(quick);}, voice: () => {counts.voice++; UI.open(voice);}, data: () => {counts.data++; UI.open(sheet);}, suspend: () => {counts.suspend++;}});
  const advance = ms => {now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) {timers.delete(id); timer.fn();} const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(now));};
  const finish = async animation => {animation.finish(); await Promise.resolve(); await Promise.resolve();};
  const finishAll = async () => {for (const animation of allAnimations.filter(a => !a.settled && !a.cancelled)) animation.finish(); await Promise.resolve(); await Promise.resolve();};
  const emit = (target, type, options = {}) => dispatch(target, {type, ...options});
  return {UI, window, document, html, surface, sheet, quick, voice, trigger, nodes, counts, fluid, focusLog, emit, advance, finish, finishAll, timers, frames, add};
}

function beginSwipe(h) {h.emit(h.surface, 'pointerdown', {clientY: 550}); h.advance(20); h.emit(h.surface, 'pointermove', {clientY: 200}); h.advance(16);}

test('home drag stays non-modal and can reverse before release', async () => {
  const h = createHarness(); beginSwipe(h);
  assert.equal(h.sheet.open, true); assert.equal(h.sheet.modal, false); assert.equal(h.sheet.modalCalls, 0);
  h.advance(20); h.emit(h.surface, 'pointermove', {clientY: 530}); h.advance(16);
  assert.match(h.sheet.style.transform, /612px/); assert.equal(h.sheet.open, true);
  h.emit(h.surface, 'pointerup', {clientY: 530}); await h.finishAll();
  assert.equal(h.sheet.open, false); assert.equal(h.counts.data, 1);
});

test('upward release promotes preview only after the gesture ends', async () => {
  const h = createHarness(); beginSwipe(h);
  h.advance(20); h.emit(h.surface, 'pointermove', {clientY: 40}); h.advance(16);
  assert.equal(h.sheet.modalCalls, 0);
  h.emit(h.surface, 'pointerup', {clientY: 40}); await h.finishAll();
  assert.equal(h.sheet.open, true); assert.equal(h.sheet.modal, true); assert.equal(h.sheet.modalCalls, 1);
  assert.equal(h.sheet.classList.contains('is-dragging'), false);
});

test('canceling a home preview closes it and permits another gesture', async () => {
  const h = createHarness(); beginSwipe(h);
  h.emit(h.surface, 'pointercancel'); await h.finishAll();
  assert.equal(h.sheet.open, false);
  h.emit(h.surface, 'pointerdown'); h.advance(40); h.emit(h.surface, 'pointerup'); h.emit(h.surface, 'click');
  assert.equal(h.counts.manual, 1); assert.equal(h.counts.voice, 0);
});

test('canceling a drag of an existing drawer restores the open drawer', async () => {
  const h = createHarness(); h.UI.open(h.sheet); await h.finishAll();
  h.emit(h.sheet.header, 'pointerdown', {clientY: 100}); h.advance(20); h.emit(h.sheet.header, 'pointermove', {clientY: 500}); h.advance(16);
  h.emit(h.sheet.header, 'pointercancel'); await h.finishAll();
  assert.equal(h.sheet.open, true); assert.equal(h.sheet.classList.contains('is-dragging'), false); assert.equal(h.sheet.style.transform, '');
});

test('secondary pointer cancellation does not cancel the primary home preview', async () => {
  const h = createHarness(); beginSwipe(h);
  h.emit(h.surface, 'pointerdown', {pointerId: 2, isPrimary: false});
  h.emit(h.surface, 'pointercancel', {pointerId: 2, isPrimary: false}); await h.finishAll();
  assert.equal(h.sheet.open, true); assert.equal(h.sheet.classList.contains('is-dragging'), true);
  h.emit(h.surface, 'pointercancel', {pointerId: 1}); await h.finishAll(); assert.equal(h.sheet.open, false);
});

test('secondary cancellation does not settle a primary drawer drag', async () => {
  const h = createHarness(); h.UI.open(h.sheet); await h.finishAll();
  h.emit(h.sheet.header, 'pointerdown', {clientY: 100}); h.advance(20); h.emit(h.sheet.header, 'pointermove', {clientY: 200}); h.advance(16);
  h.emit(h.sheet.header, 'pointercancel', {pointerId: 2, isPrimary: false});
  assert.equal(h.sheet.classList.contains('is-dragging'), true);
});

test('canceled press cannot activate a late hold callback', () => {
  const h = createHarness(); h.emit(h.surface, 'pointerdown'); h.advance(100); h.emit(h.surface, 'pointercancel'); h.advance(500);
  assert.equal(h.counts.voice, 0); assert.equal(h.counts.manual, 0); assert.equal(h.html.classList.contains('surface-held'), false);
});

test('lost capture after long press cannot strand the next home gesture', () => {
  const h = createHarness(); h.emit(h.surface, 'pointerdown'); h.advance(431); assert.equal(h.counts.voice, 1);
  h.emit(h.surface, 'lostpointercapture'); h.UI.close(h.voice, {immediate: true});
  h.emit(h.window, 'pointerup');
  h.emit(h.surface, 'pointerdown'); h.advance(40); h.emit(h.surface, 'pointerup'); h.emit(h.surface, 'click');
  assert.equal(h.counts.manual, 1);
});

test('late completion of an interrupted close cannot close a reopened modal', async () => {
  const h = createHarness(); h.UI.open(h.quick); await h.finishAll(); h.UI.close(h.quick);
  const oldClose = h.quick.animations.at(-1); h.UI.open(h.quick);
  assert.equal(oldClose.cancelled, true); await h.finish(oldClose);
  assert.equal(h.quick.open, true); assert.equal(h.quick.classList.contains('is-closing'), false);
  await h.finishAll(); assert.equal(h.quick.open, true);
});

test('modal open and preview promotion never focus a form control', async () => {
  const h = createHarness(); h.UI.open(h.quick); h.UI.close(h.quick, {immediate: true});
  beginSwipe(h); h.advance(20); h.emit(h.surface, 'pointermove', {clientY: 40}); h.advance(16); h.emit(h.surface, 'pointerup', {clientY: 40});
  assert.deepEqual(h.focusLog.filter(id => id.endsWith('-input')), []);
});

test('keyboard close restores its connected trigger while pointer close leaves no stale form focus', () => {
  const h = createHarness(); h.trigger.focus(); h.emit(h.document, 'keydown', {key: 'Tab'}); h.UI.open(h.quick); h.UI.close(h.quick, {immediate: true});
  assert.equal(h.document.activeElement, h.trigger);
  h.emit(h.window, 'pointerdown'); h.UI.open(h.quick); h.UI.close(h.quick, {immediate: true});
  assert.equal(h.document.activeElement, h.document.body);
});

test('reduced motion closes synchronously without scheduling panel animations', () => {
  const h = createHarness({reduced: true}); h.UI.open(h.quick); h.UI.close(h.quick);
  assert.equal(h.quick.open, false); assert.equal(h.quick.animations.length, 0);
});

test('a 98 percent opened preview can still reverse and close before release', async () => {
  const h=createHarness(); h.emit(h.surface,'pointerdown',{clientY:700});h.advance(20);
  h.emit(h.surface,'pointermove',{clientY:81});h.advance(16);
  assert.equal(h.sheet.modalCalls,0);assert.match(h.sheet.style.transform,/13px/);
  h.advance(20);h.emit(h.surface,'pointermove',{clientY:700});h.advance(16);
  h.emit(h.surface,'pointerup',{clientY:700});await h.finishAll();assert.equal(h.sheet.open,false);
});

test('secondary release keeps the primary long hold unselectable', () => {
  const h=createHarness();h.emit(h.surface,'pointerdown');h.advance(431);h.emit(h.surface,'lostpointercapture');
  h.emit(h.window,'pointerup',{pointerId:2,isPrimary:false});assert.equal(h.html.classList.contains('surface-held'),true);
  h.emit(h.window,'pointerup',{pointerId:1});assert.equal(h.html.classList.contains('surface-held'),false);
});

test('closing a panel cancels its pending content transition', async () => {
  const h=createHarness();h.UI.open(h.voice);await h.finishAll();let updates=0;
  h.UI.swapContent(h.voice,()=>updates++);const pending=h.voice.animations.at(-1);
  h.UI.close(h.voice,{immediate:true});await h.finish(pending);assert.equal(updates,0);assert.equal(h.voice.open,false);
});


test('tap release hands the field back even when Safari omits the compatibility click', () => {
  const h=createHarness(); h.emit(h.surface,'pointerdown'); h.advance(80); h.emit(h.surface,'pointerup');
  assert.equal(h.fluid.at(-1).name,'handoff'); assert.equal(h.timers.size,0); assert.equal(h.frames.size,0);
  assert.equal(h.counts.manual,0); h.emit(h.surface,'click'); assert.equal(h.counts.manual,1);
});

test('retargeted touch release cancels a pending hold and permits the next gesture', () => {
  const h=createHarness(); h.emit(h.surface,'pointerdown'); h.advance(100); h.UI.open(h.quick);
  h.emit(h.quick.heading,'pointerup'); assert.equal(h.fluid.at(-1).name,'release');
  h.advance(500); assert.equal(h.counts.voice,0); assert.equal(h.html.classList.contains('surface-held'),false);
  h.UI.close(h.quick,{immediate:true}); h.emit(h.surface,'pointerdown'); h.advance(431);
  assert.equal(h.counts.voice,1);
});

test('retargeted pointer cancellation ends the owning gesture without a stranded charge', () => {
  const h=createHarness(); h.emit(h.surface,'pointerdown'); h.advance(100); h.emit(h.window,'pointercancel');
  assert.equal(h.fluid.at(-1).name,'release'); h.advance(500); assert.equal(h.counts.voice,0);
  h.emit(h.surface,'pointerdown'); h.advance(50); h.emit(h.surface,'pointerup'); h.emit(h.surface,'click');
  assert.equal(h.counts.manual,1);
});

test('secondary cancellation after hold capture is lost keeps the primary shield', () => {
  const h=createHarness(); h.emit(h.surface,'pointerdown'); h.advance(431); h.emit(h.surface,'lostpointercapture');
  h.emit(h.surface,'pointercancel',{pointerId:2,isPrimary:false}); assert.equal(h.html.classList.contains('surface-held'),true);
  h.emit(h.window,'pointerup',{pointerId:1}); assert.equal(h.html.classList.contains('surface-held'),false);
});


test('assistant closes on the reverse scene timeline and can reopen without a late close', async () => {
  const h=createHarness();h.UI.open(h.voice);await h.finishAll();
  h.UI.close(h.voice);
  assert.equal(h.voice.open,true);
  assert.equal(h.fluid.filter(event=>event.name==='assistant').at(-1).args[0],false);
  const closing=h.voice.animations.at(-1);
  h.UI.open(h.voice);await h.finish(closing);
  assert.equal(h.voice.open,true);
});


function assistantTap(h,target,options={}){
  h.emit(target,'pointerdown',options);h.advance(40);h.emit(target,'pointerup',options);h.emit(target,'click',options);
}
test('fresh taps on empty assistant space close through the normal cleanup path',async()=>{
  for(const desktop of [false,true]){
    const h=createHarness({desktop});let closing=0;h.voice.addEventListener('mm:closing',()=>closing++);
    h.UI.open(h.voice);await h.finishAll();assistantTap(h,h.voice);assert.equal(closing,1);await h.finishAll();assert.equal(h.voice.open,false);
    h.UI.open(h.voice);await h.finishAll();const empty=h.add('empty-assistant-space','div',h.voice);
    assistantTap(h,empty);await h.finishAll();assert.equal(h.voice.open,false);assert.equal(closing,2);
    h.UI.open(h.voice);await h.finishAll();assistantTap(h,h.voice.header);await h.finishAll();assert.equal(h.voice.open,false);assert.equal(closing,3);
  }
});
test('assistant controls, text, answers and drags never dismiss the assistant',async()=>{
  const h=createHarness();h.UI.open(h.voice);await h.finishAll();
  const targets=[h.voice.input,h.add('mic','button',h.voice),h.add('voice-status','p',h.voice),h.add('voice-text','div',h.voice)];
  const answer=h.add('advisor-answer','section',h.voice);targets.push(h.add('answer-copy','span',answer));
  for(const target of targets){assistantTap(h,target);assert.equal(h.voice.classList.contains('is-closing'),false);}
  h.emit(h.voice,'pointerdown',{clientY:200});h.emit(h.voice,'pointermove',{clientY:240});h.emit(h.voice,'pointerup',{clientY:200});h.emit(h.voice,'click');
  assert.equal(h.voice.classList.contains('is-closing'),false);
  h.emit(h.voice.input,'pointerdown');h.emit(h.voice,'pointerup');h.emit(h.voice,'click');assert.equal(h.voice.classList.contains('is-closing'),false);
});
test('retargeted long-press release cannot dismiss the just-opened assistant',async()=>{
  const h=createHarness();h.emit(h.surface,'pointerdown');h.advance(431);assert.equal(h.voice.open,true);
  h.emit(h.voice,'pointerup');h.emit(h.voice,'click');await h.finishAll();assert.equal(h.voice.open,true);
  // Even an extra compatibility click has no fresh press inside the assistant.
  h.emit(h.voice,'click');assert.equal(h.voice.classList.contains('is-closing'),false);
  assistantTap(h,h.voice);await h.finishAll();assert.equal(h.voice.open,false);
});
test('cancelled or stale empty-space presses do not become a later dismiss',async()=>{
  const h=createHarness();h.UI.open(h.voice);await h.finishAll();
  h.emit(h.voice,'pointerdown');h.emit(h.voice,'pointercancel');h.emit(h.voice,'pointerup');h.emit(h.voice,'click');assert.equal(h.voice.classList.contains('is-closing'),false);
  h.emit(h.voice,'pointerdown');h.advance(800);h.emit(h.voice,'pointerup');h.emit(h.voice,'click');assert.equal(h.voice.classList.contains('is-closing'),false);
  assistantTap(h,h.voice);await h.finishAll();assert.equal(h.voice.open,false);
});


const lastOrbEvent=h=>h.fluid.filter(event=>event.name==='orbPointer').at(-1);
test('orb mouse hover responds only on the sphere and leaves protected controls usable',async()=>{
  const h=createHarness({desktop:true,orb:true});h.UI.open(h.voice);await h.finishAll();
  h.emit(h.voice,'pointermove',{clientX:195,clientY:240,pointerType:'mouse'});
  assert.equal(lastOrbEvent(h).args[1].active,true);assert.equal(lastOrbEvent(h).args[1].pressed,false);
  h.emit(h.voice.input,'pointermove',{clientX:195,clientY:240,pointerType:'mouse'});assert.equal(lastOrbEvent(h).args[1].active,false);
  const before=h.fluid.filter(event=>event.name==='orbPointer').length;assistantTap(h,h.voice.input,{clientX:195,clientY:240,pointerType:'mouse'});
  assert.equal(h.fluid.filter(event=>event.name==='orbPointer').length,before);assert.equal(h.voice.open,true);
  h.emit(h.voice,'pointermove',{clientX:195,clientY:240,pointerType:'mouse'});h.emit(h.voice,'pointerleave',{bubbles:false});assert.equal(lastOrbEvent(h).args[1].active,false);
});
test('orb taps keep the assistant open and mouse hover survives release while touch releases fully',async()=>{
  for(const pointerType of ['mouse','touch']){
    const h=createHarness({orb:true});h.UI.open(h.voice);await h.finishAll();
    h.emit(h.voice,'pointerdown',{clientX:195,clientY:240,pointerType});assert.equal(h.voice.hasPointerCapture(1),true);assert.equal(lastOrbEvent(h).args[1].pressed,true);
    h.emit(h.voice,'pointerup',{clientX:195,clientY:240,pointerType});h.emit(h.voice,'click',{clientX:195,clientY:240,pointerType});
    assert.equal(h.voice.classList.contains('is-closing'),false);assert.equal(h.voice.hasPointerCapture(1),false);
    assert.equal(lastOrbEvent(h).args[1].active,pointerType==='mouse');assert.equal(lastOrbEvent(h).args[1].pressed,false);
  }
});
test('orb drag ending outside never dismisses, including a retargeted release',async()=>{
  const h=createHarness({orb:true});h.UI.open(h.voice);await h.finishAll();
  h.emit(h.voice,'pointerdown',{clientX:195,clientY:240,pointerType:'touch'});
  h.emit(h.voice,'pointermove',{clientX:350,clientY:550,pointerType:'touch'});assert.equal(lastOrbEvent(h).args[1].pressed,true);assert.equal(lastOrbEvent(h).args[0].x,350);
  const dragging=lastOrbEvent(h);h.emit(h.voice,'pointerleave',{bubbles:false,pointerType:'touch'});
  assert.equal(lastOrbEvent(h),dragging,'leaving during captured drag must not release or relatch the material anchor');assert.equal(h.voice.hasPointerCapture(1),true);
  h.emit(h.window,'pointerup',{clientX:350,clientY:550,pointerType:'touch'});h.emit(h.voice,'click',{clientX:350,clientY:550,pointerType:'touch'});await h.finishAll();
  assert.equal(h.voice.open,true);assert.equal(lastOrbEvent(h).args[1].active,false);assert.equal(h.voice.hasPointerCapture(1),false);
  assistantTap(h,h.voice,{clientX:350,clientY:550,pointerType:'touch'});await h.finishAll();assert.equal(h.voice.open,false,'fresh tap outside still dismisses');
});
test('orb feedback clears on close, lost capture and suspension without canceling a different pointer',async()=>{
  const h=createHarness({orb:true});h.UI.open(h.voice);await h.finishAll();
  h.emit(h.voice,'pointerdown',{clientX:195,clientY:240,pointerType:'touch'});
  h.emit(h.window,'pointercancel',{pointerId:2,isPrimary:false,pointerType:'touch'});assert.equal(lastOrbEvent(h).args[1].pressed,true);assert.equal(h.voice.hasPointerCapture(1),true);
  h.emit(h.voice,'lostpointercapture',{pointerId:1,pointerType:'touch'});assert.equal(lastOrbEvent(h).args[1].active,false);h.emit(h.voice,'click');assert.equal(h.voice.classList.contains('is-closing'),false);
  h.emit(h.voice,'pointermove',{clientX:195,clientY:240,pointerType:'mouse'});h.UI.close(h.voice,{immediate:true});assert.equal(lastOrbEvent(h).args[1].active,false);
  h.UI.open(h.voice);h.emit(h.voice,'pointerdown',{clientX:195,clientY:240,pointerType:'touch'});h.document.hidden=true;h.emit(h.document,'visibilitychange');assert.equal(lastOrbEvent(h).args[1].active,false);assert.equal(h.voice.hasPointerCapture(1),false);assert.equal(h.counts.suspend,1);
});
