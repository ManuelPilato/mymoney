'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = name => fs.readFileSync(path.join(__dirname, '../src/', name), 'utf8');
class Target {
  constructor() { this.listeners = new Map(); }
  addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(fn); }
  removeEventListener(name, fn) { this.listeners.set(name, (this.listeners.get(name) || []).filter(item => item !== fn)); }
  emit(name, event = {}) { for (const fn of this.listeners.get(name) || []) fn(event); }
}
function clock() {
  let now = 0, id = 0; const frames = new Map();
  return {
    frames, performance: {now: () => now},
    requestAnimationFrame: fn => { frames.set(++id, fn); return id; }, cancelAnimationFrame: key => frames.delete(key),
    advance(ms = 1000 / 60) { now += ms; const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(now)); },
    run(ms) { const n = Math.ceil(ms / (1000 / 60)); for (let i = 0; i < n; i++) this.advance(ms / n); }
  };
}
function meterHarness({gesture = true, userAgent = 'Chromium', sampleRate = 48000} = {}) {
  const time = clock(), document = new Target(), window = new Target(); document.hidden = false;
  const requests = [], contexts = [], frequencyBuffers = []; const frequencies = new Uint8Array(256); let amplitude = 0;
  class AudioContext extends Target {
    constructor() { super(); this.state = 'suspended'; this.closed = 0; this.sampleRate = sampleRate; contexts.push(this); }
    resume() { this.state = 'running'; return Promise.resolve(); }
    close() { this.state = 'closed'; this.closed++; return Promise.resolve(); }
    createAnalyser() { return {fftSize: 512, frequencyBinCount:256, disconnect() {}, getFloatTimeDomainData: samples => { for (let i = 0; i < samples.length; i++) samples[i] = i % 2 ? amplitude : -amplitude; }, getByteFrequencyData: values => {frequencyBuffers.push(values);values.set(frequencies);}}; }
    createMediaStreamSource() { return {connect() {}, disconnect() {}}; }
  }
  window.AudioContext = AudioContext;
  const navigator = {userAgent, userActivation: {isActive: gesture}, mediaDevices: {getUserMedia: () => new Promise((resolve, reject) => requests.push({resolve, reject}))}};
  const context = {window, document, navigator, ...time, setTimeout, clearTimeout};
  vm.runInNewContext(source('voice-meter.js'), context);
  function stream() {
    const track = new Target(); track.kind = 'audio'; track.readyState = 'live'; track.muted = false; track.stopped = 0;
    track.stop = () => {track.stopped++; track.readyState = 'ended';};
    return {track, getTracks: () => [track], getAudioTracks: () => [track]};
  }
  return {api: window.MMVoiceMeter, time, window, document, requests, contexts, stream, frequencyBuffers, spectrum: fn => {for(let i=0;i<frequencies.length;i++)frequencies[i]=fn(i*sampleRate/512);}, amplitude: value => {amplitude = value;}};
}
test('voice meter reports actual RMS and peak changes, including zero in silence', async () => {
  const h = meterHarness(), events = []; const pending = h.api.start((level, detail) => events.push({level, ...detail}));
  const stream = h.stream(); h.requests[0].resolve(stream); assert.equal((await pending).status, 'active');
  h.amplitude(.05); h.time.advance(); const quiet = events.at(-1);
  h.amplitude(.2); h.time.advance(); const loud = events.at(-1);
  assert.ok(Math.abs(quiet.rms - .05) < 1e-6); assert.ok(Math.abs(loud.peak - .2) < 1e-6);
  assert.ok(loud.level > quiet.level && quiet.level > 0);
  h.amplitude(0); h.time.advance(); assert.equal(events.at(-1).level, 0);
  h.api.stop(); assert.equal(stream.track.stopped, 1); assert.equal(h.contexts[0].closed, 1); assert.equal(h.time.frames.size, 0);
});
test('closing during a permission request cancels promptly and releases a late stream', async () => {
  const h = meterHarness(); const pending = h.api.start(() => {}); h.api.stop();
  assert.equal((await pending).status, 'cancelled'); assert.equal(h.contexts[0].closed, 1);
  const late = h.stream(); h.requests[0].resolve(late); await Promise.resolve(); await Promise.resolve();
  assert.equal(late.track.stopped, 1); assert.equal(h.time.frames.size, 0);
});
test('rapid restart never attaches the older capture to the newer session', async () => {
  const h = meterHarness(); const first = h.api.start(() => {}), second = h.api.start(() => {});
  const oldStream = h.stream(), currentStream = h.stream();
  h.requests[1].resolve(currentStream); assert.equal((await second).status, 'active');
  h.requests[0].resolve(oldStream); assert.equal((await first).status, 'cancelled'); await Promise.resolve();
  assert.equal(oldStream.track.stopped, 1); assert.equal(currentStream.track.stopped, 0); assert.equal(h.time.frames.size, 1);
  h.document.hidden = true; h.document.emit('visibilitychange'); assert.equal(currentStream.track.stopped, 1); assert.equal(h.time.frames.size, 0);
});
test('permission denial and capture mute release Web Audio without stopping speech recognition', async () => {
  const denied = meterHarness(); const rejected = denied.api.start(() => {});
  denied.requests[0].reject({name:'NotAllowedError'}); assert.equal((await rejected).status, 'denied'); assert.equal(denied.contexts[0].closed, 1);
  const safari = meterHarness({userAgent:'iPhone Safari'}), events = [];
  const pending = safari.api.start((level, detail) => events.push({level, ...detail}), {recognitionActive:true, allowConcurrent:true});
  assert.equal(safari.requests.length, 1, 'explicit Safari attempt requests real capture');
  const stream = safari.stream(); safari.requests[0].resolve(stream); assert.equal((await pending).status, 'active');
  stream.track.muted = true; stream.track.emit('mute');
  assert.equal(events.at(-1).status, 'unavailable'); assert.equal(events.at(-1).reason, 'capture-muted'); assert.equal(events.at(-1).level, 0);
  assert.equal(stream.track.stopped, 1); assert.equal(safari.time.frames.size, 0); assert.equal(safari.contexts[0].closed, 1);
});
test('capture never starts without a user gesture', async () => {
  const h = meterHarness({gesture:false}); const result = await h.api.start(() => {});
  assert.equal(result.reason, 'gesture-required'); assert.equal(h.requests.length, 0); assert.equal(h.contexts.length, 0);
});

function bridgeHarness({orbit=true}={}) {
  const calls=[],window={};let frames=0,canvases=0;
  if(orbit)window.MyMoneyOrbit={assistant:value=>calls.push(['active',value]),setListening:value=>calls.push(['listening',value]),setAudioLevel:(value,details)=>calls.push(['audio',value,details])};
  vm.runInNewContext(source('assistant-particles.js'),{window,document:{createElement(){canvases++;throw Error('A second canvas is forbidden');}},requestAnimationFrame(){frames++;throw Error('The adapter must not schedule frames');}});
  return {api:window.MMParticles,window,calls,get frames(){return frames;},get canvases(){return canvases;}};
}
test('assistant compatibility adapter forwards to the single material without canvas or RAF',()=>{
  const h=bridgeHarness(),bands={bass:.7,mid:.4,high:.1};h.api.setActive(true);h.api.setListening(true);h.api.setAudioLevel(.72,bands);h.api.setListening(false);h.api.setActive(false);
  assert.deepEqual(h.calls,[['active',true],['listening',true],['audio',.72,bands],['listening',false],['active',false]]);
  assert.equal(h.canvases,0);assert.equal(h.frames,0);
  h.api.destroy();assert.equal(h.window.MMParticles,undefined);assert.deepEqual(h.calls.at(-1),['active',false]);
});
test('adapter tolerates unavailable renderer and does not delete a replacement instance',()=>{
  const absent=bridgeHarness({orbit:false});assert.doesNotThrow(()=>{absent.api.setActive(true);absent.api.setListening(true);absent.api.setAudioLevel(.5);absent.api.destroy();});
  const h=bridgeHarness(),replacement={};h.window.MMParticles=replacement;h.api.destroy();assert.equal(h.window.MMParticles,replacement);
});


test('real frequency bands follow the supplied spectrum and reuse one FFT buffer', async () => {
  const h=meterHarness(),events=[],views=[];
  const pending=h.api.start((level,detail)=>{events.push({level,...detail});if(detail.status==='active'&&level)views.push(detail);});
  h.requests[0].resolve(h.stream());await pending;h.amplitude(.2);
  h.spectrum(hz=>hz>=80&&hz<300?255:0);h.time.advance();
  assert.equal(events.at(-1).bass,1);assert.equal(events.at(-1).mid,0);assert.equal(events.at(-1).high,0);
  h.spectrum(hz=>hz>=300&&hz<2000?128:hz>=2000&&hz<8000?64:0);h.time.advance();
  assert.equal(events.at(-1).bass,0);assert.ok(Math.abs(events.at(-1).mid-128/255)<1e-6);assert.ok(Math.abs(events.at(-1).high-64/255)<1e-6);
  assert.equal(h.frequencyBuffers.length,2);assert.equal(h.frequencyBuffers[0],h.frequencyBuffers[1]);assert.equal(views[0],views[1]);
  h.api.stop();for(const key of ['bass','mid','high'])assert.equal(events.at(-1)[key],0);
});
test('RMS gate silences all bands without running FFT even if stale spectral bins are loud', async () => {
  const h=meterHarness(),events=[];const pending=h.api.start((level,detail)=>events.push({level,...detail}));h.requests[0].resolve(h.stream());await pending;
  h.spectrum(()=>255);
  for(const amplitude of [0,.004,NaN,Infinity]){h.amplitude(amplitude);h.time.advance();for(const key of ['level','bass','mid','high'])assert.equal(events.at(-1)[key],0);}
  assert.equal(h.frequencyBuffers.length,0);
  h.amplitude(.02);h.time.advance();const quiet=events.at(-1);assert.ok(quiet.bass>0&&quiet.bass<1);
  h.amplitude(3);h.time.advance();for(const key of ['level','bass','mid','high'])assert.equal(events.at(-1)[key],1);
  h.api.stop();
});
test('frequency ranges respect the actual sample rate and Nyquist limit', async () => {
  for(const sampleRate of [44100,4000]){
    const h=meterHarness({sampleRate}),events=[];const pending=h.api.start((level,detail)=>events.push({...detail}));h.requests[0].resolve(h.stream());await pending;
    h.amplitude(.2);h.spectrum(hz=>hz>=300&&hz<2000?255:0);h.time.advance();
    assert.equal(events.at(-1).mid,1);assert.equal(events.at(-1).bass,0);assert.equal(events.at(-1).high,0);
    h.api.stop();
  }
});
test('unavailable capture reports explicit zero bands', async () => {
  const h=meterHarness({gesture:false}),events=[];await h.api.start((level,detail)=>events.push({...detail}));
  for(const key of ['bass','mid','high'])assert.equal(events.at(-1)[key],0);
});
