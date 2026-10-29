/* Direct manipulation, interruptible panels, and quiet keyboard/pointer focus. */
(function(){
  'use strict';
  const $=s=>document.querySelector(s),root=document.documentElement;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)'),desktop=matchMedia('(min-width:900px) and (hover:hover) and (pointer:fine)');
  const motions=new WeakMap(),returnFocus=new WeakMap();
  const surface=$('#touch-surface'),sheet=$('#data-sheet'),experience=$('#experience');
  const scrim=document.createElement('div');scrim.className='data-scrim';scrim.setAttribute('aria-hidden','true');document.body.append(scrim);
  let callbacks={},gesture=null,drag=null,holdTimer=0,chargeFrame=0,paintFrame=0,voiceActive=false,assistantActive=false,heldPointerId=null,pendingTap=false,suppressClick=false,preview=false,origin=null,viewAnimation=null,assistantTap=null,orbGesture=null,orbHover=false,orbLastPoint=null;
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  const ease='cubic-bezier(.22,1,.36,1)';
  function dialogs(){return [...document.querySelectorAll('dialog[open]')].filter(d=>!d.classList.contains('is-closing'));}
  function scene(){
    const active=dialogs();const assistant=active.some(d=>d.id==='voice-sheet');root.classList.toggle('assistant-open',assistant);if(assistant!==assistantActive){assistantActive=assistant;fluid('assistant',assistant);}root.dataset.scene=voiceActive?'listening':active.some(d=>d!==sheet)?'modal':active.length?'data':gesture&&!gesture.moved?'pressing':'idle';
  }
  function fluid(method,...args){window.MyMoneyOrbit?.[method]?.(...args);}
  function point(e){const b=experience.getBoundingClientRect();return {x:e.clientX-b.left,y:e.clientY-b.top};}
  function focusHeading(dialog){const heading=dialog.querySelector('h2');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}}
  function stopMotion(element){
    const a=motions.get(element);if(!a)return;
    const s=getComputedStyle(element);element.style.transform=s.transform;element.style.opacity=s.opacity;
    motions.delete(element);a.cancel();element.style.willChange='';
  }
  function animate(element,frames,duration,finish){
    stopMotion(element);
    if(reduced.matches||!element.animate){finish?.();return;}
    element.style.willChange='transform, opacity';
    const a=element.animate(frames,{duration,easing:ease,fill:'both'});motions.set(element,a);
    a.finished.then(()=>{if(motions.get(element)!==a)return;motions.delete(element);a.cancel();element.style.willChange='';finish?.();}).catch(()=>{});
  }
  function backdrop(value,animated=false){
    const from=Number(getComputedStyle(scrim).opacity);stopMotion(scrim);scrim.style.opacity=String(value);
    if(animated)animate(scrim,[{opacity:from},{opacity:value}],value?260:200,()=>{scrim.style.opacity=String(value);});
  }
  function nativeOpen(dialog,asPreview=false){
    if(dialog.id==='voice-sheet'){assistantTap=null;clearOrbPointer();}
    returnFocus.set(dialog,document.activeElement);
    const heading=dialog.querySelector('h2');if(heading){heading.tabIndex=-1;heading.setAttribute('autofocus','');}
    if(asPreview){dialog.dataset.dragPreview='true';dialog.show();}else dialog.showModal();
    heading?.removeAttribute('autofocus');
    // During a drag, focus must remain on the pointer-capturing surface.
    if(!asPreview)focusHeading(dialog);
    dialog.scrollTop=0;
  }
  function open(dialog,focus){
    const wasClosing=dialog.classList.contains('is-closing');
    if(dialog.open&&!wasClosing){if(focus)focus.focus({preventScroll:true});return;}
    const previous=wasClosing?{transform:getComputedStyle(dialog).transform,opacity:getComputedStyle(dialog).opacity}:null;
    stopMotion(dialog);dialog.classList.remove('is-closing');dialog.style.transform='';dialog.style.opacity='';
    if(!dialog.open)nativeOpen(dialog,dialog===sheet&&preview);
    scene();
    if(dialog===sheet&&preview)return;
    const b=dialog.getBoundingClientRect(),isDrawer=dialog===sheet&&!desktop.matches;
    let start=isDrawer?`translate3d(0,${b.height+32}px,0)`:'translate3d(0,12px,0) scale(.965)';
    if(origin&&dialog!==sheet){
      const dx=clamp((origin.x-b.left-b.width/2)*.2,-64,64),dy=clamp((origin.y-b.top-b.height/2)*.2,-76,76);
      start=`translate3d(${dx}px,${dy}px,0) scale(.94)`;origin=null;fluid('handoff');
    }
    if(dialog.id==='voice-sheet')start='translate3d(0,0,0)';
    if(dialog===sheet)backdrop(1,true);
    animate(dialog,[previous||{transform:start,opacity:isDrawer?1:0},{transform:'translate3d(0,0,0) scale(1)',opacity:1}],isDrawer?300:260,()=>{dialog.style.transform='';dialog.style.opacity='';});
    if(focus)focus.focus({preventScroll:true});
  }
  function restoreFocus(dialog){
    const target=returnFocus.get(dialog);returnFocus.delete(dialog);
    if(root.dataset.inputModality==='keyboard'&&target?.isConnected&&!target.closest('dialog:not([open])'))target.focus({preventScroll:true});
    else {const parent=dialogs().at(-1);if(parent)focusHeading(parent);else if(document.activeElement instanceof HTMLElement)document.activeElement.blur();}
  }
  function finishClose(dialog){
    motions.delete(dialog);delete dialog.dataset.dragPreview;dialog.close();dialog.classList.remove('is-closing','is-dragging');dialog.style.transform='';dialog.style.opacity='';dialog.style.willChange='';
    if(dialog===sheet)backdrop(0);restoreFocus(dialog);scene();
  }
  function close(dialog,{immediate=false}={}){
    if(!dialog.open||dialog.classList.contains('is-closing'))return;
    const s=getComputedStyle(dialog),from={transform:s.transform==='none'?'translate3d(0,0,0)':s.transform,opacity:s.opacity};
    const content=dialog.querySelector('.assistant-content');if(content)stopMotion(content);
    if(dialog.id==='voice-sheet'){assistantTap=null;clearOrbPointer();}
    stopMotion(dialog);dialog.dispatchEvent(new CustomEvent('mm:closing',{bubbles:true}));dialog.classList.add('is-closing');
    if(dialog===sheet)backdrop(0,!immediate);
    const end=dialog===sheet&&!desktop.matches?`translate3d(0,${dialog.getBoundingClientRect().height+32}px,0)`:'translate3d(0,14px,0) scale(.975)';
    if(immediate){finishClose(dialog);return;}
    if(dialog.id==='voice-sheet'){
      // The background owns the reverse morph; the controls can leave promptly.
      scene();animate(dialog,[{opacity:from.opacity,transform:'none'},{opacity:0,transform:'none'}],180,()=>finishClose(dialog));return;
    }
    animate(dialog,[from,{transform:end,opacity:dialog===sheet?1:0}],dialog===sheet?240:180,()=>finishClose(dialog));
  }
  function stopCharge(){clearTimeout(holdTimer);holdTimer=0;cancelAnimationFrame(chargeFrame);chargeFrame=0;}
  function charge(now){if(!gesture||gesture.moved||gesture.held)return;fluid('charge',clamp((now-gesture.time)/430,0,1));chargeFrame=requestAnimationFrame(charge);}
  function activate(kind,p){
    markHint(kind);origin=p?{x:p.x,y:p.y}:null;if(p)fluid('handoff');callbacks[kind]?.();origin=null;
  }
  function cancelGesture(){
    stopCharge();gesture=null;heldPointerId=null;pendingTap=false;root.classList.remove('surface-held');fluid('release');scene();
  }
  function down(e){
    if(!e.isPrimary||e.button!==0||dialogs().length||gesture)return;
    e.preventDefault();stopCharge();pendingTap=false;
    gesture={id:e.pointerId,x:e.clientX,y:e.clientY,time:performance.now(),moved:false,held:false,element:e.currentTarget};
    heldPointerId=e.pointerId;root.classList.add('surface-held');fluid('begin',point(e));chargeFrame=requestAnimationFrame(charge);
    try{e.currentTarget.setPointerCapture(e.pointerId);}catch(_){}
    scene();if(e.currentTarget!==surface)return;holdTimer=setTimeout(()=>{
      if(!gesture||gesture.moved||dialogs().length)return;
      gesture.held=true;stopCharge();suppressClick=true;activate('voice',{x:gesture.x,y:gesture.y});scene();
    },430);
  }
  function drawerDistance(){return sheet.getBoundingClientRect().height+32;}
  function startPreview(g){
    stopCharge();fluid('release');preview=true;
    try{callbacks.data?.();}finally{preview=false;}
    if(!sheet.open)return;
    stopMotion(sheet);stopMotion(scrim);sheet.classList.add('is-dragging');
    const distance=drawerDistance();drag={id:g.id,element:g.element,dialog:sheet,startY:g.y,startOffset:distance,offset:distance,distance,lastY:g.y,lastTime:g.time,velocity:0,fromHome:true};
  }
  function rubber(value,max){if(value<0)return -Math.min(28,Math.sqrt(-value)*2.3);if(value>max)return max+Math.min(24,Math.sqrt(value-max)*2);return value;}
  function paintDrag(){
    paintFrame=0;if(!drag)return;const d=drag;
    d.dialog.style.transform=`translate3d(0,${rubber(d.offset,d.distance)}px,0)`;
    if(d.dialog===sheet)scrim.style.opacity=String(clamp(1-d.offset/d.distance,0,1));
  }
  function trackDrag(e){
    if(!drag||drag.id!==e.pointerId)return;const now=performance.now(),dt=now-drag.lastTime;
    if(dt>0){const speed=(e.clientY-drag.lastY)/dt;drag.velocity=dt>90?speed:drag.velocity*.35+speed*.65;}
    drag.offset=drag.startOffset+e.clientY-drag.startY;drag.lastY=e.clientY;drag.lastTime=now;
    if(!paintFrame)paintFrame=requestAnimationFrame(paintDrag);
  }
  function move(e){
    if(!gesture||e.pointerId!==gesture.id)return;
    const dx=e.clientX-gesture.x,dy=e.clientY-gesture.y;
    if(!gesture.held&&Math.hypot(dx,dy)>10){gesture.moved=true;stopCharge();
      if(!drag&&dy< -10&&Math.abs(dy)>Math.abs(dx)*1.2)startPreview(gesture);
      else if(!drag)fluid('release');
    }
    if(drag){e.preventDefault();trackDrag(e);}else if(!gesture.moved&&!gesture.held)fluid('move',point(e));
  }
  function settleDrag(cancelled=false){
    if(!drag)return;cancelAnimationFrame(paintFrame);paintDrag();const d=drag;drag=null;
    const velocity=performance.now()-d.lastTime<100?d.velocity:0;
    const closes=cancelled?d.fromHome:(velocity>.45?true:velocity<-.45?false:d.offset>d.distance*.5);
    d.dialog.classList.remove('is-dragging');
    if(closes){close(d.dialog);return;}
    const from=d.dialog.style.transform;
    if(d.fromHome){
      // A non-modal preview keeps capture alive. Promote only after release.
      const heading=d.dialog.querySelector('h2');heading?.setAttribute('autofocus','');
      d.dialog.close();delete d.dialog.dataset.dragPreview;d.dialog.showModal();heading?.removeAttribute('autofocus');focusHeading(d.dialog);markHint('data');
    }
    if(d.dialog===sheet)backdrop(1,true);
    animate(d.dialog,[{transform:from,opacity:1},{transform:'translate3d(0,0,0)',opacity:1}],Math.max(160,Math.min(290,Math.abs(d.offset)*.35)),()=>{d.dialog.style.transform='';d.dialog.style.opacity='';});scene();
  }
  function up(e){
    if(!gesture||e.pointerId!==gesture.id)return;
    const g=gesture,elapsed=performance.now()-g.time;stopCharge();gesture=null;root.classList.remove('surface-held');
    if(drag){trackDrag(e);settleDrag();suppressClick=true;scene();return;}
    if(g.held){suppressClick=true;scene();return;}
    if(!g.moved&&elapsed<430){pendingTap={x:e.clientX,y:e.clientY};fluid('handoff');}else fluid('release');scene();
  }
  function cancelPointer(e){if(e&&heldPointerId!==null&&e.pointerId!==heldPointerId)return;if(e&&gesture&&e.pointerId!==gesture.id)return;if(e&&drag&&e.pointerId!==drag.id)return;if(drag)settleDrag(true);cancelGesture();}
  function panelDown(e){
    if(!e.isPrimary||e.button!==0||drag||desktop.matches||e.target.closest('button,input,textarea,select,a'))return;
    const dialog=e.currentTarget.closest('dialog');if(!dialog?.open||dialog.id==='voice-sheet'||dialog.classList.contains('is-closing'))return;
    e.preventDefault();stopMotion(dialog);stopMotion(scrim);
    const transform=getComputedStyle(dialog).transform,offset=transform==='none'?0:new DOMMatrixReadOnly(transform).m42;
    drag={id:e.pointerId,element:e.currentTarget,dialog,startY:e.clientY,startOffset:offset,offset,distance:dialog===sheet?drawerDistance():Math.min(dialog.offsetHeight*.7,260),lastY:e.clientY,lastTime:performance.now(),velocity:0,fromHome:false};
    dialog.classList.add('is-dragging');try{e.currentTarget.setPointerCapture(e.pointerId);}catch(_){}
  }
  function transitionView(previous,next,update){
    viewAnimation?.cancel();viewAnimation=null;
    if(previous===next||!sheet.open||reduced.matches){update();return;}
    const container=$('#data-scroll'),fromOpacity=getComputedStyle(container).opacity;
    const direction=['home','history','plan','settings'].indexOf(next)>['home','history','plan','settings'].indexOf(previous)?1:-1;
    const out=container.animate([{opacity:fromOpacity,transform:'translate3d(0,0,0)'},{opacity:0,transform:`translate3d(${-6*direction}px,0,0)`}],{duration:80,easing:'ease-out',fill:'forwards'});viewAnimation=out;
    out.finished.then(()=>{if(viewAnimation!==out)return;update();out.cancel();
      const enter=container.animate([{opacity:0,transform:`translate3d(${8*direction}px,0,0)`},{opacity:1,transform:'translate3d(0,0,0)'}],{duration:180,easing:ease});viewAnimation=enter;
      enter.finished.then(()=>{if(viewAnimation===enter)viewAnimation=null;}).catch(()=>{});
    }).catch(()=>{});
  }
  function swapContent(dialog,update){
    const owner=dialog.closest('dialog')||dialog;
    if(!owner.open||owner.classList.contains('is-closing')||reduced.matches){update();return;}
    const from=getComputedStyle(dialog).opacity;
    animate(dialog,[{opacity:from},{opacity:0}],70,()=>{
      if(!owner.open||owner.classList.contains('is-closing'))return;
      update();
      animate(dialog,[{opacity:0,transform:'translate3d(0,4px,0) scale(.99)'},{opacity:1,transform:'translate3d(0,0,0) scale(1)'}],170,()=>{dialog.style.transform='';dialog.style.opacity='';});
    });
  }
  function viewport(){
    const v=window.visualViewport,height=v?v.height:innerHeight,top=v?v.offsetTop:0;
    root.style.setProperty('--vv-height',`${height}px`);
    // Safari chrome / safe area gaps are not the software keyboard.
    const input=document.activeElement?.matches('input,textarea,[contenteditable=true]');
    const difference=Math.max(0,innerHeight-height-top),keyboard=input&&difference>100?difference:0;
    root.style.setProperty('--keyboard-bottom',`${keyboard}px`);root.classList.toggle('keyboard-open',keyboard>0);
  }
  const hintKey='mymoney-gestures-v1';let learned={};try{const saved=JSON.parse(localStorage.getItem(hintKey)||'{}');if(saved&&typeof saved==='object'&&!Array.isArray(saved))learned=saved;}catch(_){}
  function markHint(kind){learned[kind]=true;try{localStorage.setItem(hintKey,JSON.stringify(learned));}catch(_){}renderHints();}
  function renderHints(){
    const container=$('#gesture-hints');if(!container)return;
    const t=window.MyMoneyI18n?.t||((x)=>x),fine=matchMedia('(hover:hover) and (pointer:fine)').matches;
    for(const kind of ['manual','voice','data']){const item=container.querySelector(`[data-hint="${kind}"]`);if(!item)continue;item.hidden=!!learned[kind];item.querySelector('span').textContent=t(kind==='manual'?(fine?'Clicca per scrivere':'Tocca per scrivere'):kind==='voice'?'Tieni premuto e parla':'Scorri per i tuoi dati');}
    container.hidden=Object.values(learned).filter(Boolean).length>=3;
  }
  // Only a fresh tap that starts AND ends on empty assistant space dismisses it.
  // The release/click of the home long-press can be retargeted into this dialog.
  function assistantBlank(target,dialog){
    return !!target?.closest&&dialog.contains(target)&&!target.closest('button,input,textarea,select,a,label,summary,details,p,h1,h2,h3,h4,[role=button],[contenteditable=true],#advisor-answer,#command-preview,#voice-consent,#voice-text,#voice-status');
  }
  function assistantOrbHit(e,dialog){
    return assistantBlank(e.target,dialog)&&window.MyMoneyOrbit?.orbHitTest?.(point(e))===true;
  }
  function orbFeedback(position,active,pressed=false){
    if(position)orbLastPoint=position;
    if(active||orbHover)fluid('orbPointer',orbLastPoint||{x:0,y:0},{active,pressed});
    orbHover=active;
  }
  function clearOrbPointer(){
    const previous=orbGesture;orbGesture=null;
    if(previous){assistantTap=null;suppressClick=true;}
    orbFeedback(null,false);
    if(previous){try{if(previous.element.hasPointerCapture(previous.id))previous.element.releasePointerCapture(previous.id);}catch(_){}}
  }
  function finishOrbPointer(e,cancelled=false){
    if(orbGesture?.id!==e.pointerId)return false;
    const previous=orbGesture;orbGesture=null;assistantTap=null;suppressClick=true;
    const hover=!cancelled&&previous.type!=='touch'&&previous.element.open&&!previous.element.classList.contains('is-closing')&&assistantOrbHit(e,previous.element);
    orbFeedback(point(e),hover,false);
    try{if(previous.element.hasPointerCapture(previous.id))previous.element.releasePointerCapture(previous.id);}catch(_){}
    return true;
  }
  function assistantDown(e){
    const dialog=e.currentTarget;
    if(e.isPrimary===false||e.button!==0||!dialog.open||dialog.classList.contains('is-closing')||heldPointerId!==null||gesture||drag||orbGesture||!assistantBlank(e.target,dialog))return;
    if(assistantOrbHit(e,dialog)){
      e.preventDefault();assistantTap=null;
      orbGesture={id:e.pointerId,element:dialog,type:e.pointerType||'mouse'};
      try{dialog.setPointerCapture(e.pointerId);}catch(_){}
      orbFeedback(point(e),true,true);return;
    }
    orbFeedback(null,false);
    assistantTap={id:e.pointerId,x:e.clientX,y:e.clientY,time:performance.now(),released:false};
  }
  function assistantMove(e){
    if(orbGesture){if(orbGesture.id===e.pointerId){e.preventDefault();orbFeedback(point(e),true,true);}return;}
    if(e.isPrimary===false)return;
    if(assistantTap?.id===e.pointerId&&Math.hypot(e.clientX-assistantTap.x,e.clientY-assistantTap.y)>8)assistantTap=null;
    const dialog=e.currentTarget;
    const hover=e.pointerType!=='touch'&&dialog.open&&!dialog.classList.contains('is-closing')&&heldPointerId===null&&!gesture&&assistantOrbHit(e,dialog);
    orbFeedback(point(e),hover,false);
  }
  function assistantUp(e){
    if(finishOrbPointer(e))return;
    if(assistantTap?.id!==e.pointerId)return;
    assistantMove(e);
    if(assistantTap)assistantTap.released=assistantBlank(e.target,e.currentTarget)&&!assistantOrbHit(e,e.currentTarget);
  }
  function init(actions){
    callbacks=actions;root.dataset.inputModality='pointer';viewport();scene();renderHints();
    window.addEventListener('mm:languagechange',renderHints);
    window.addEventListener('pointerdown',e=>{if(e.isPrimary===false)return;root.dataset.inputModality='pointer';suppressClick=false;pendingTap=false;assistantTap=null;},true);
    document.addEventListener('keydown',e=>{if(e.key==='Tab')root.dataset.inputModality='keyboard';},true);
    const releaseHold=e=>{if(e&&heldPointerId!==null&&e.pointerId!==heldPointerId)return;heldPointerId=null;root.classList.remove('surface-held');if(gesture?.held){stopCharge();gesture=null;scene();}};
    // A modal or native microphone prompt may retarget the end of a touch away
    // from its original surface. Always finish the owning pointer at the window.
    window.addEventListener('pointerup',e=>{
      finishOrbPointer(e);
      if(gesture?.id===e.pointerId){if(gesture.element.contains(e.target))up(e);else cancelPointer(e);}
      releaseHold(e);
    },true);
    window.addEventListener('pointercancel',e=>{
      finishOrbPointer(e,true);
      if(gesture?.id===e.pointerId||drag?.id===e.pointerId||heldPointerId===e.pointerId)cancelPointer(e);
      releaseHold(e);
    },true);
    document.addEventListener('selectstart',e=>{if(root.classList.contains('surface-held'))e.preventDefault();});
    document.addEventListener('contextmenu',e=>{if(root.classList.contains('surface-held'))e.preventDefault();});
    window.addEventListener('click',e=>{if(suppressClick&&e.detail!==0){suppressClick=false;e.preventDefault();e.stopImmediatePropagation();}},true);
    for(const element of [surface,$('#open-data')]){
      element.addEventListener('pointerdown',down);element.addEventListener('pointermove',move);element.addEventListener('pointerup',up);
      element.addEventListener('pointercancel',cancelPointer);element.addEventListener('lostpointercapture',e=>{if(gesture?.id!==e.pointerId)return;if(gesture.held){stopCharge();gesture=null;}else cancelPointer(e);});
      element.addEventListener('contextmenu',e=>e.preventDefault());
    }
    surface.addEventListener('click',e=>{e.preventDefault();const p=pendingTap;pendingTap=false;if((e.detail===0||p)&&!dialogs().length)activate('manual',p||null);});
    surface.addEventListener('keydown',e=>{if(e.key==='ArrowUp'){e.preventDefault();activate('data');}});
    $('#open-data').addEventListener('click',()=>{pendingTap=false;fluid('release');activate('data');});
    $('#desktop-add').addEventListener('click',()=>activate('manual'));$('#desktop-voice').addEventListener('click',()=>activate('voice'));$('#desktop-data').addEventListener('click',()=>activate('data'));
    $('#gesture-hints')?.addEventListener('click',e=>{if(e.target.closest('#dismiss-hints')){['manual','voice','data'].forEach(markHint);}});
    $('#replay-hints')?.addEventListener('click',()=>{learned={};try{localStorage.removeItem(hintKey);}catch(_){}renderHints();close(sheet);});
    document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'&&!e.isComposing){e.preventDefault();if(!dialogs().some(d=>d!==sheet))activate('manual');}});
    if(!/Mac|iPhone|iPad/.test(navigator.platform))$('#desktop-add kbd').textContent='Ctrl K';$('#accessible-voice').addEventListener('click',()=>activate('voice'));
    $('#close-data').addEventListener('click',()=>close(sheet));
    for(const dialog of document.querySelectorAll('dialog')){
      dialog.addEventListener('cancel',e=>{e.preventDefault();close(dialog);});dialog.addEventListener('close',scene);
      if(dialog.id==='voice-sheet'){
        dialog.addEventListener('pointerdown',assistantDown);dialog.addEventListener('pointermove',assistantMove);dialog.addEventListener('pointerup',assistantUp);
        dialog.addEventListener('pointercancel',e=>{if(assistantTap?.id===e.pointerId)assistantTap=null;});
        dialog.addEventListener('pointerleave',()=>{if(!orbGesture)orbFeedback(null,false);});
        dialog.addEventListener('lostpointercapture',e=>finishOrbPointer(e,true));
      }
      dialog.addEventListener('click',e=>{
        if(dialog.id==='voice-sheet'){
          const tap=assistantTap;assistantTap=null;
          if(!tap?.released||drag||(Number.isFinite(e.pointerId)&&e.pointerId>0&&e.pointerId!==tap.id)||performance.now()-tap.time>700||!assistantBlank(e.target,dialog)||assistantOrbHit(e,dialog))return;
          e.preventDefault();e.stopImmediatePropagation();close(dialog);return;
        }
        if(e.target!==dialog||drag)return;const b=dialog.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)close(dialog);
      });
      const header=dialog.querySelector('.data-header,.dialog-head');if(!header)continue;
      header.addEventListener('pointerdown',panelDown);header.addEventListener('pointermove',e=>{if(drag?.id===e.pointerId){e.preventDefault();trackDrag(e);}});
      header.addEventListener('pointerup',e=>{if(drag?.id===e.pointerId){trackDrag(e);settleDrag();suppressClick=true;}});
      header.addEventListener('pointercancel',e=>{if(drag?.id===e.pointerId)settleDrag(true);});header.addEventListener('lostpointercapture',e=>{if(drag?.id===e.pointerId)settleDrag(true);});
    }
    window.visualViewport?.addEventListener('resize',viewport);window.visualViewport?.addEventListener('scroll',viewport);window.addEventListener('resize',viewport);
    document.addEventListener('focusin',viewport);document.addEventListener('focusout',()=>requestAnimationFrame(viewport));
    window.addEventListener('blur',()=>{clearOrbPointer();cancelPointer();releaseHold();});
    document.addEventListener('visibilitychange',()=>{if(document.hidden){clearOrbPointer();cancelPointer();releaseHold();callbacks.suspend?.();}else viewport();});
  }
  window.MMUI={init,open,close,scene,dialogs,transitionView,swapContent,setVoice(active){voiceActive=active;scene();}};
})();
