/* Local microphone amplitude and spectrum only. No recording, upload or synthesized levels. */
(() => {
  'use strict';
  let current = null, destroyed = false;
  const finite = value => Number.isFinite(value) ? value : 0;
  function emit(session, level, details) {
    try { session.callback(level, details); } catch (_) { /* UI failure must not retain the microphone. */ }
  }
  function releaseStream(stream) { stream?.getTracks().forEach(track => { try { track.stop(); } catch (_) {} }); }
  function dispose(session, status = 'cancelled', reason = 'stopped') {
    if (!session || session.disposed) return;
    session.disposed = true;
    cancelAnimationFrame(session.frame);
    clearTimeout(session.timeout);
    session.remove.forEach(remove => remove());
    try { session.source?.disconnect(); session.analyser?.disconnect(); } catch (_) {}
    releaseStream(session.stream);
    if (session.context && session.context.state !== 'closed') {
      try { Promise.resolve(session.context.close()).catch(() => {}); } catch (_) {}
    }
    session.cancel({ status, reason });
    if (current === session) current = null;
    emit(session, 0, { status, reason, rms: 0, peak: 0, bass: 0, mid: 0, high: 0 });
  }
  function stop(reason = 'stopped') { dispose(current, 'cancelled', reason); }
  function unavailable(callback, reason) {
    try { callback(0, { status: 'unavailable', reason, rms: 0, peak: 0, bass: 0, mid: 0, high: 0 }); } catch (_) {}
    return { status: 'unavailable', reason };
  }
  function listen(session, target, name, handler) {
    target.addEventListener(name, handler);
    session.remove.push(() => target.removeEventListener(name, handler));
  }
  async function start(callback, options = {}) {
    stop('restarted');
    if (typeof callback !== 'function') return { status: 'unavailable', reason: 'missing-callback' };
    if (destroyed || document.hidden) return unavailable(callback, 'inactive-page');
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext || !navigator.mediaDevices?.getUserMedia) return unavailable(callback, 'unsupported');
    if (navigator.userActivation?.isActive === false) return unavailable(callback, 'gesture-required');
    const agent = navigator.userAgent || '';
    const webKit = /iPhone|iPad|iPod/.test(agent) || /Safari/.test(agent) && !/Chrome|Chromium|Edg|Android/.test(agent);
    // Some WebKit versions mute a second capture track during recognition.
    // A caller may opt into a real attempt; mute/interruption then tears down
    // only this meter, leaving the browser recognizer entirely untouched.
    if (options.recognitionActive && webKit && options.allowConcurrent !== true) return unavailable(callback, 'concurrent-capture');
    const session = { callback, disposed: false, frame: 0, timeout: 0, context: null, stream: null, source: null, analyser: null, remove: [], cancel: null };
    const cancellation = new Promise(resolve => { session.cancel = resolve; });
    current = session;
    emit(session, 0, { status: 'starting', rms: 0, peak: 0, bass: 0, mid: 0, high: 0 });
    try {
      // Both calls happen synchronously in start(), before its first await, so
      // the original click/press can unlock Web Audio and request capture.
      session.context = new AudioContext({ latencyHint: 'interactive' });
      const resumed = Promise.resolve(session.context.resume()).then(() => true, () => false);
      const capture = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false }, video: false });
      const media = Promise.resolve(capture).then(stream => {
        if (session.disposed || current !== session) { releaseStream(stream); return { status: 'cancelled', reason: 'stale-capture' }; }
        return { stream };
      }, error => ({ error }));
      const acquired = await Promise.race([media, cancellation]);
      if (!acquired.stream) {
        if (acquired.error) throw acquired.error;
        return { status: acquired.status || 'cancelled', reason: acquired.reason || 'stopped' };
      }
      session.stream = acquired.stream;
      if (session.disposed || current !== session) { releaseStream(session.stream); return { status: 'cancelled', reason: 'stale-capture' }; }
      const ready = await Promise.race([resumed, cancellation, new Promise(resolve => { session.timeout = setTimeout(() => resolve(false), 1800); })]);
      clearTimeout(session.timeout); session.timeout = 0;
      if (session.disposed || current !== session) return { status: 'cancelled', reason: 'stopped' };
      if (ready !== true || session.context.state !== 'running') {
        dispose(session, 'unavailable', 'audio-context-suspended');
        return { status: 'unavailable', reason: 'audio-context-suspended' };
      }
      const tracks = session.stream.getAudioTracks();
      if (!tracks.length || tracks.some(track => track.muted || track.readyState !== 'live')) {
        dispose(session, 'unavailable', 'capture-muted');
        return { status: 'unavailable', reason: 'capture-muted' };
      }
      session.analyser = session.context.createAnalyser();
      session.analyser.fftSize = 512;
      session.analyser.smoothingTimeConstant = 0;
      session.analyser.minDecibels = -90;
      session.analyser.maxDecibels = -20;
      session.source = session.context.createMediaStreamSource(session.stream);
      session.source.connect(session.analyser); // Deliberately never connect to speakers.
      const samples = new Float32Array(session.analyser.fftSize);
      const spectrum = new Uint8Array(session.analyser.frequencyBinCount);
      const binHz = session.context.sampleRate / session.analyser.fftSize;
      const bandRange = (low, high) => [Math.max(1, Math.ceil(low / binHz)), Math.min(spectrum.length, Math.ceil(high / binHz))];
      const bassRange = bandRange(80, 300), midRange = bandRange(300, 2000), highRange = bandRange(2000, 8000);
      function band(range, gate) {
        if (!gate || range[1] <= range[0]) return 0;
        let square = 0;
        for (let i = range[0]; i < range[1]; i++) { const magnitude = spectrum[i] / 255; square += magnitude * magnitude; }
        return Math.min(1, Math.sqrt(square / (range[1] - range[0])) * gate);
      }
      // This callback view is reused; consumers read it synchronously, without
      // retaining audio buffers or allocating a spectrum/details object per frame.
      const detail = { status: 'active', rms: 0, peak: 0, bass: 0, mid: 0, high: 0 };
      tracks.forEach(track => {
        listen(session, track, 'mute', () => dispose(session, 'unavailable', 'capture-muted'));
        listen(session, track, 'ended', () => dispose(session, 'unavailable', 'capture-ended'));
      });
      listen(session, session.context, 'statechange', () => {
        if (session.context.state !== 'running') dispose(session, 'unavailable', 'audio-context-interrupted');
      });
      function sample() {
        session.frame = 0;
        if (session.disposed || current !== session) return;
        if (document.hidden) { dispose(session, 'cancelled', 'hidden'); return; }
        try {
          session.analyser.getFloatTimeDomainData(samples);
          let mean = 0, square = 0, peak = 0;
          for (let i = 0; i < samples.length; i++) mean += finite(samples[i]);
          mean /= samples.length;
          for (let i = 0; i < samples.length; i++) { const amplitude = finite(samples[i]) - mean; square += amplitude * amplitude; peak = Math.max(peak, Math.abs(amplitude)); }
          const rms = Math.sqrt(square / samples.length);
          const level = Math.min(1, Math.max(0, rms - .006) * 5.5 + Math.max(0, peak - .02) * .45);
          const gate = Math.min(1, Math.max(0, rms - .006) * 10);
          if (gate) session.analyser.getByteFrequencyData(spectrum);
          detail.rms = rms; detail.peak = peak;
          detail.bass = band(bassRange, gate); detail.mid = band(midRange, gate); detail.high = band(highRange, gate);
          emit(session, level, detail);
          if (!session.disposed && current === session) session.frame = requestAnimationFrame(sample);
        } catch (_) { dispose(session, 'unavailable', 'analysis-failed'); }
      }
      emit(session, 0, { status: 'active', rms: 0, peak: 0, bass: 0, mid: 0, high: 0 });
      if (!session.disposed && current === session) session.frame = requestAnimationFrame(sample);
      return { status: 'active' };
    } catch (error) {
      if (session.disposed || current !== session) return { status: 'cancelled', reason: 'stopped' };
      const status = error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError' ? 'denied' : 'unavailable';
      const reason = status === 'denied' ? 'permission-denied' : 'capture-failed';
      dispose(session, status, reason);
      return { status, reason };
    }
  }
  function visibility() { if (document.hidden) stop('hidden'); }
  function pagehide() { stop('pagehide'); }
  function destroy() {
    destroyed = true; stop('destroyed');
    document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', pagehide);
    if (window.MMVoiceMeter === api) delete window.MMVoiceMeter;
  }
  const api = Object.freeze({ start, stop, destroy });
  window.MMVoiceMeter = api;
  document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', pagehide);
})();
