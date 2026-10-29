/* Compatibility bridge: the assistant IS the ambient silk, not a second scene.
   Kept under the existing API name so voice capture stays unchanged. */
(() => {
  'use strict';
  const api=Object.freeze({
    setActive:active=>window.MyMoneyOrbit?.assistant(active),
    setListening:active=>window.MyMoneyOrbit?.setListening(active),
    setAudioLevel:(level,details)=>window.MyMoneyOrbit?.setAudioLevel(level,details),
    destroy(){window.MyMoneyOrbit?.assistant(false);if(window.MMParticles===api)delete window.MMParticles;}
  });
  window.MMParticles=api;
})();
