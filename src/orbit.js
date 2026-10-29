/* MyMoney's living backdrop. Input feedback shares the existing low-power render loop. */
(() => {
  'use strict';
  const canvas = document.querySelector('#orb-canvas');
  const stage = document.querySelector('#experience');
  if (!canvas || !stage) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const sceneTargets = {
    idle: [0, 1], pressing: [0, 1], listening: [.45, 1], data: [0, .72], modal: [0, .72]
  };
  let frame = 0, lastPaint = 0, time = 14, width = 1, height = 1;
  let energy = 0, luminosity = 1, lost = false, renderer = null, destroyed = false;
  let touchX = .5, touchY = .5, contactX = .5, contactY = .5;
  let attraction = 0, attractionTarget = 0, attractionVelocity = 0;
  let assistantMix = 0, assistantTarget = 0, assistantVelocity = 0, fallbackCanvas = null;
  let gathered = false;
  let bass=0,mid=0,treble=0,bassTarget=0,midTarget=0,trebleTarget=0;
  let probeX=0,probeY=0,probeTargetX=0,probeTargetY=0,probe=0,probeTarget=0,probePress=0,probePressTarget=0;
  const stretchX={value:0,velocity:0,target:0},stretchY={value:0,velocity:0,target:0};
  let grabbed=false,grabAnchorX=0,grabAnchorY=0,grabTargetX=0,grabTargetY=0,grabStartX=0,grabStartY=0;
  let grabBaseX=0,grabBaseY=0,rippleX=0,rippleY=0,rippleAmplitude=0,rippleAge=10;
  // Exact damped oscillator: release keeps its momentum at every display cadence.
  function elasticStep(axis,dt,frequency,damping){
    const decay=damping*frequency,w=frequency*Math.sqrt(1-damping*damping);
    const x=axis.value-axis.target,v=axis.velocity,envelope=Math.exp(-decay*dt);
    const c=Math.cos(w*dt),sn=Math.sin(w*dt);
    axis.value=axis.target+envelope*(x*c+(v+decay*x)/w*sn);
    axis.velocity=envelope*(v*c-(decay*v+frequency*frequency*x)/w*sn);
    if(Math.abs(axis.value-axis.target)<.00001&&Math.abs(axis.velocity)<.0001){axis.value=axis.target;axis.velocity=0;}
  }
  function resetElastic(){
    grabbed=false;stretchX.value=stretchX.velocity=stretchX.target=stretchY.value=stretchY.velocity=stretchY.target=0;
    grabAnchorX=grabAnchorY=grabTargetX=grabTargetY=0;rippleAmplitude=0;rippleAge=10;
  }
  function releaseElastic(){
    if(grabbed){
      rippleX=grabAnchorX;rippleY=grabAnchorY;
      rippleAmplitude=Math.min(1,.18+Math.hypot(stretchX.value,stretchY.value)*.7+Math.hypot(stretchX.velocity,stretchY.velocity)*.025);
      rippleAge=0;
    }
    grabbed=false;stretchX.target=stretchY.target=0;
  }
  let assistantActive = false, assistantListening = false, audioLevel = 0, audioTarget = 0, audioAt = 0;
  // Meaningful states share the material clock and renderer, never an overlay.
  let assistantPhase='idle',listenSignal=0,processSignal=0,expressionTime=0;
  let confirmation=0,confirmationAge=4;
  let holding = false, releasing = false, quietUntil = 0;
  // Only the soft fluid trades pixels for cadence; particle detail stays native.
  const saveData = !!navigator.connection?.saveData;
  let quality = saveData ? .78 : 1, bufferScale = quality, cadence = 1000 / 60;
  let sampleTime = 0, sampleCount = 0, lateFrames = 0;
  let scene = document.documentElement.dataset.scene || 'idle';
  let target = sceneTargets[scene] || sceneTargets.idle;
  const listeners = [];
  const on = (element, name, callback, options) => {
    element.addEventListener(name, callback, options);
    listeners.push(() => element.removeEventListener(name, callback, options));
  };

  const vertexSource = `
    attribute vec2 a_position;
    void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
  `;
  const compositeFragmentSource = `
    precision mediump float;
    uniform sampler2D u_fluid;
    uniform vec2 u_resolution;
    void main() { gl_FragColor = texture2D(u_fluid, gl_FragCoord.xy / u_resolution); }
  `;
  const fieldFunctions = `
    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                 mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x), f.y);
    }
    float cloud(vec2 p) {
      float value = noise(p) * .56;
      p = mat2(1.6, 1.2, -1.2, 1.6) * p;
      value += noise(p + 7.2) * .28;
      p = mat2(1.6, 1.2, -1.2, 1.6) * p;
      return value + noise(p + 3.1) * .14;
    }
  `;
  const fragmentSource = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
      precision highp float;
    #else
      precision mediump float;
    #endif
    uniform vec2 u_resolution;
    uniform float u_time;
    uniform float u_energy;
    uniform float u_light;
    uniform vec3 u_touch;
    uniform float u_morph;
    uniform float u_voice;
    uniform vec3 u_focus;

    ${fieldFunctions}
    float glow(float distance, float width) {
      return width / (abs(distance) + width);
    }
    void paintHome() {
      vec2 uv = gl_FragCoord.xy / u_resolution;
      vec2 p = (gl_FragCoord.xy - .5 * u_resolution) / u_resolution.y;
      vec2 screenP = p;
      vec2 touchPoint = (u_touch.xy - .5) * vec2(u_resolution.x / u_resolution.y, 1.0);
      vec2 contact = p - touchPoint;
      float t = u_time * .105;
      // Inverse-map the existing silk: nearby folds gather into the contact.
      // No independent disc, ring, particles, or additive light source is drawn.
      float reach = .20 + .13 * u_touch.z;
      vec2 field = contact * vec2(.92, 1.08);
      float gather = exp(-dot(field, field) / (reach * reach)) * u_touch.z;
      float sourceAxis = touchPoint.y * .29 - sin(touchPoint.y * 4.6 + t * .62) * .16;
      vec2 pickup = vec2((sourceAxis - touchPoint.x) * .64, 0.0);
      p += (contact * 1.65 + pickup) * gather;
      p += vec2(-contact.y, contact.x) * gather * .12;
      // A slow domain warp makes light behave like folded silk, without a mesh.
      vec2 q = vec2(cloud(p * 2.7 + vec2(.13 * t, -.17 * t)),
                    cloud(p * 2.5 + vec2(5.4 - .12 * t, 2.1 + .14 * t)));
      float fold = p.x - p.y * .29 + (q.x - .5) * .55
                 + sin(p.y * 4.6 + t * .62) * .16;
      float drift = sin(p.y * 5.0 + q.y * 4.5 - t * .5) * .038;
      float left = fold + .155 + drift;
      float right = fold - .19 + drift * .6;
      float leftFlow = .66 + .34 * sin(p.y * 6.0 + t * .46 + q.x * 3.0);
      float rightFlow = .67 + .33 * cos(p.y * 4.0 - t * .38 + q.y * 3.0);
      float activation = u_energy * (.82 + .18 * sin(u_time * 2.8));

      vec3 ink = vec3(.012, .019, .029);
      vec3 cyan = vec3(.29, .67, .73);
      vec3 silver = vec3(.69, .88, .91);
      vec3 blue = vec3(.19, .32, .62);
      vec3 mint = vec3(.29, .63, .56);
      vec3 color = ink;
      // Broad translucent bodies give the thin caustics room to breathe.
      float leftBody = exp(-abs(left - .028) * 12.0) * leftFlow;
      float rightBody = exp(-abs(right + .05) * 10.0) * rightFlow;
      color += mix(mint, cyan, smoothstep(-.4, .4, p.y)) * leftBody * .19;
      color += mix(cyan, blue, smoothstep(-.3, .4, p.y)) * rightBody * .25;
      color += blue * exp(-length(p - vec2(.2, .34)) * 4.8) * .12;

      float edge = glow(left, .0018) * .55 + glow(left - .016 - q.y * .02, .003) * .14;
      float opposite = glow(right, .0022) * .33 + glow(right + .018, .0034) * .12;
      color += silver * edge * leftFlow * (.8 + activation * .7);
      color += mix(blue, silver, .5) * opposite * rightFlow * (.85 + activation * .7);
      color += cyan * glow(left, .024) * .11;
      color += blue * glow(right, .04) * .14;

      // Soft luminous folds, deliberately sparse and irregular.
      float grainFold = sin(left * 155.0 + q.y * 9.0 + t * .4);
      float satin = pow(max(0.0, grainFold), 7.0) * exp(-abs(left - .022) * 24.0);
      color += cyan * satin * .045 * leftFlow;
      // Concentration brightens only the material already present in the folds.
      color = ink + (color - ink) * (1.0 + gather * .48);
      float breath = 1.0 + sin(u_time * .37) * .055;
      float centreQuiet = 1.0 - exp(-dot(screenP * vec2(3.0, 5.0), screenP * vec2(3.0, 5.0))) * .17;
      float vignette = 1.0 - smoothstep(.29, .79, length(screenP * vec2(.9, .82))) * .56;
      color = ink + (color - ink) * breath * centreQuiet * vignette * u_light;
      // Static sub-pixel dither prevents visible gradients on dark OLED displays.
      color += (hash(gl_FragCoord.xy * .01) - .5) / 255.0;
      gl_FragColor = vec4(color, 1.0);
    }
    // An inverse bend transports the original material through one continuous
    // coordinate field. At zero curvature it is exactly the original plane.
    vec3 ribbon(vec2 material, float side, float squeeze, float taper, float along) {
      float t = u_time * .105;
      vec2 q = vec2(cloud(material * 2.7 + vec2(.13*t,-.17*t)),
                    cloud(material * 2.5 + vec2(5.4-.12*t,2.1+.14*t)));
      float shapeFreedom=1.0-smoothstep(.25,.88,u_morph);
      float fold = material.x + (-material.y*.29 + (q.x-.5)*.55
                 + sin(material.y*4.6+t*.62)*.16)*shapeFreedom;
      float drift = sin(material.y*5.0+q.y*4.5-t*.5)*.038*shapeFreedom;
      float d = side > 0.0 ? fold+.155+drift : fold-.19+drift*.6;
      // Transport the edges as well as the broad body; don't dissolve a new logo in.
      float flow = side > 0.0 ? .66+.34*sin(material.y*6.0+t*.46+q.x*3.0)
                             : .67+.33*cos(material.y*4.0-t*.38+q.y*3.0);
      vec3 cyan=vec3(.29,.67,.73),silver=vec3(.69,.88,.91),blue=vec3(.19,.32,.62),mint=vec3(.29,.63,.56);
      float activation=u_energy*(.82+.18*sin(u_time*2.8));
      float minEdge=.65/u_resolution.y;
      float edgeWidth=max(.0018*squeeze,minEdge);
      float physical=d*squeeze;
      vec3 color;
      if(side>0.0){
        float body=exp(-abs(d-.028)*12.0)*flow;
        color=mix(mint,cyan,smoothstep(-.4,.4,material.y))*body*.19;
        float edge=glow(physical,edgeWidth)*.55+glow((d-.016-q.y*.02)*squeeze,max(.003*squeeze,minEdge))*.14;
        color+=silver*edge*flow*(.8+activation*.7);
        color+=cyan*glow(physical,.024*squeeze)*.11;
        float satin=pow(max(0.0,sin(d*155.0+q.y*9.0+t*.4)),7.0)*exp(-abs(d-.022)*24.0);
        color+=cyan*satin*.045*flow;
      }else{
        float body=exp(-abs(d+.05)*10.0)*flow;
        color=mix(cyan,blue,smoothstep(-.3,.4,material.y))*body*.25;
        float edge=glow(physical,max(.0022*squeeze,minEdge))*.33+glow((d+.018)*squeeze,max(.0034*squeeze,minEdge))*.12;
        color+=mix(blue,silver,.5)*edge*flow*(.85+activation*.7);
        color+=blue*glow(physical,.04*squeeze)*.14;
      }
      float solid=smoothstep(.48,1.0,u_morph);
      float inner=side*d;
      float volume=smoothstep(-.025,.045,inner)*(1.0-smoothstep(.19,.27,inner));
      float stream=.5+.5*sin(material.y*10.0+q.x*5.0-u_time*.72);
      color+=mix(cyan,blue,side>0.0?.14:.55)*volume*(.10+.07*stream)*solid;
      color+=mix(cyan,silver,.22)*glow((inner-.23)*squeeze,max(.0015*squeeze,minEdge))*.21*flow*solid;
      float vein=glow((inner-.105-.018*sin(material.y*8.0+u_time*.42+q.x*4.0))*squeeze,max(.0009*squeeze,minEdge));
      color+=cyan*vein*volume*.095*solid*flow;
      return color*taper*mix(1.0,1.35,u_morph);
    }
    vec3 foldedRibbon(vec2 p, float side, float morph, float radius, vec2 centre) {
      float k=morph/radius;
      vec2 rest=vec2(side>0.0?-.155:.19,0.0);
      vec2 anchor=mix(rest,centre+vec2(-side*radius,0.0),morph);
      vec2 z=side*(p-anchor);
      float h=length(vec2(1.0-k*z.x,k*z.y));
      float normal=(2.0*z.x-k*dot(z,z))/(1.0+h);
      float tangent=k<.0001?z.y:atan(k*z.y,1.0-k*z.x)/k;
      float lo=mix(-2.0,-1.65*radius,morph),hi=-lo;
      float branchLimit=3.14159265/max(k,.0001)-.06;
      lo=max(lo,-branchLimit);hi=min(hi,branchLimit);
      float cap=smoothstep(lo,lo+mix(.08,.018,morph),tangent)
               *(1.0-smoothstep(hi-mix(.08,.018,morph),hi,tangent));
      if(cap<.00001)return vec3(0.0);
      float sx=mix(1.0,.24,morph),sy=mix(1.0,.36,morph);
      vec2 material=rest+side*vec2(normal/sx,tangent/sy);
      return ribbon(material,side,sx,cap,tangent);
    }
    void main() {
      if(u_morph<.000001){paintHome();return;}
      if(u_morph>=.96){
        vec3 ink=vec3(.012,.019,.029)+(hash(gl_FragCoord.xy*.01)-.5)/255.0;
        gl_FragColor=vec4(ink,1.0);return;
      }
      vec2 p=(gl_FragCoord.xy-.5*u_resolution)/u_resolution.y;
      vec2 screenP=p;
      float m=u_morph;
      vec2 contactPoint=(u_touch.xy-.5)*vec2(u_resolution.x/u_resolution.y,1.0);
      vec2 contact=p-contactPoint;
      float reach=.20+.13*u_touch.z;
      vec2 field=contact*vec2(.92,1.08);
      float gather=exp(-dot(field,field)/(reach*reach))*u_touch.z*(1.0-m);
      float t=u_time*.105;
      float sourceAxis=contactPoint.y*.29-sin(contactPoint.y*4.6+t*.62)*.16;
      p+=(contact*1.65+vec2((sourceAxis-contactPoint.x)*.64,0.0))*gather;
      p+=vec2(-contact.y,contact.x)*gather*.12;
      vec2 centre=u_focus.xy;
      float radius=u_focus.z*(1.0+u_voice*.045);
      // Both streams bend into the very same spherical contour as the grains.
      vec3 ink=vec3(.012,.019,.029);
      vec3 color=foldedRibbon(p,1.0,m,radius,centre)+foldedRibbon(p,-1.0,m,radius,centre);
      color*=1.0-smoothstep(.38,.96,m);
      color+=vec3(.19,.32,.62)*exp(-length(p-mix(vec2(.2,.34),centre,m))*mix(4.8,15.0,m))*.12*(1.0-m);
      color*=1.0+gather*.48;
      float breath=1.0+sin(u_time*.37)*.055;
      float quiet=1.0-exp(-dot(screenP*vec2(3.0,5.0),screenP*vec2(3.0,5.0)))*.17*(1.0-m);
      float vignette=1.0-smoothstep(.29,.79,length(screenP*vec2(.9,.82)))*.56*(1.0-m);
      color=ink+color*breath*quiet*vignette*mix(u_light,1.08,m);
      color+=(hash(gl_FragCoord.xy*.01)-.5)/255.0;
      gl_FragColor=vec4(color,1.0);
    }

  `;


  const particleVertexSource = `
    precision highp float;
    attribute vec4 a_particle;
    uniform vec2 u_resolution;
    uniform vec3 u_focus;
    uniform float u_time,u_morph,u_voice,u_pixel;
    uniform vec3 u_bands;
    uniform vec4 u_probe,u_grab,u_ripple,u_state;
    uniform float u_expressionTime;
    varying vec3 v_color;
    varying float v_alpha,v_pointSize;
    ${fieldFunctions}
    float volumeNoise(vec3 p) {
      float plane=floor(p.z),f=fract(p.z);f=f*f*(3.0-2.0*f);
      vec2 stride=vec2(37.0,17.0);
      return mix(noise(p.xy+plane*stride),noise(p.xy+(plane+1.0)*stride),f);
    }
    void main() {
      float m=u_morph,radius=u_focus.z,t=u_time*.105;
      float seed=a_particle.z,phase=abs(a_particle.w),mote=1.0-step(0.0,a_particle.w);
      float drift=u_time*.035;
      float longitude=a_particle.x+u_time*.018;
      float z=a_particle.y;
      float latitude=sqrt(max(0.0,1.0-z*z));
      vec3 n=vec3(cos(longitude)*latitude,sin(longitude)*latitude,z);
      // True 3D circulation: points move around a shell, rather than flicker in place.
      float tilt=.46+sin(u_time*.025)*.065;
      n.yz=mat2(cos(tilt),-sin(tilt),sin(tilt),cos(tilt))*n.yz;
      float theta=atan(n.y,n.x);
      // Spatial detail and temporal speed are separate: intricate, unhurried motion.
      float macro=volumeNoise(n*3.1+vec3(drift,-drift*.6,drift*.35));
      float detail=volumeNoise(n*8.6+vec3(6.4,-drift*.5,drift*.3));
      float fine=volumeNoise(n*19.2+vec3(-drift*.3,3.7,drift*.2));
      float wavePhase=n.x*6.8+n.y*4.0+n.z*4.5-u_time*.24+macro*3.0;
      float crossPhase=n.y*9.0-n.x*3.0+n.z*6.4+u_time*.18+detail*2.0;
      float wave=sin(wavePhase),crossWave=sin(crossPhase);
      float folds=(macro-.5)*.32+(detail-.5)*.14+(fine-.5)*.045+wave*.040+crossWave*.026;
      float filaments=pow(.5+.5*sin(n.z*14.0+macro*5.0+n.y*4.0-u_time*.20),3.0);
      float ridges=pow(.5+.5*sin(theta*3.0+n.z*5.0-u_time*1.6),3.0);
      float lifted=smoothstep(.68,.98,seed);
      float audio=(u_voice*.045+u_bands.x*.14)*ridges
                 +u_bands.y*.025*sin(theta*12.0+n.z*8.0-u_time*4.0)
                 +lifted*u_voice*.065*(.5+.5*sin(phase*40.0+u_time*9.0));
      float jitter=u_bands.z*.016*sin(u_time*22.0+phase*75.0);
      float dust=mote*(.025+.14*pow(phase,3.0))*(.35+detail);
      // Listening breathes; processing gently concentrates the same surface.
      // A saved action releases one restrained material pulse, not a second orb.
      float breath=u_state.x*.008*sin(u_expressionTime*1.65);
      float shell=1.0+folds+(seed-.5)*mix(.012,.07,mote)+dust+audio+jitter
                 +breath-u_state.y*.018+u_state.z*.038;
      vec2 projected=n.xy*shell/(1.0-n.z*.10);
      // Front/back sheets form travelling creases inside the silhouette as well.
      float face=pow(abs(n.z),.65);
      projected+=vec2(wave*.115+crossWave*.035,crossWave*.095-wave*.035)*face;
      vec2 gripDelta=projected-u_grab.xy;
      float gripWidth=mix(2.4,.95,exp(-dot(u_grab.xy,u_grab.xy)*4.0));
      float grip=exp(-dot(gripDelta,gripDelta)*gripWidth);
      vec2 pull=u_grab.zw;
      float strain=length(pull);
      vec2 perpendicular=vec2(-pull.y,pull.x)/max(strain,.0001);
      projected+=pull*(.10+.90*grip);
      projected-=perpendicular*dot(gripDelta,perpendicular)*min(strain,.9)*grip*.13;
      // Let go: a wave travels out from the held patch, then fades naturally.
      float distanceToRelease=length(projected-u_ripple.xy),age=u_ripple.w;
      float envelope=exp(-pow((distanceToRelease-age*1.7)/.30,2.0))*exp(-age*2.6)*(1.0-exp(-age*20.0));
      projected+=normalize(projected+vec2(.0001))*sin(distanceToRelease*12.0-age*9.0)*envelope*u_ripple.z*.12;
      vec2 diff=projected-u_probe.xy;
      float local=(exp(-dot(diff,diff)*9.0)+.26*exp(-dot(u_probe.xy,u_probe.xy)*4.0))*u_probe.z;
      projected+=normalize(projected+vec2(.0001))*local*(.13+.08*u_probe.w);
      projected+=vec2(-diff.y,diff.x)*local*.095;
      float radial=length(projected);
      float side=projected.x<0.0?1.0:-1.0;
      vec2 rest=vec2(side>0.0?-.155:.19,0.0);
      float angle=atan(side*projected.y,-side*projected.x);
      float sx=mix(1.0,.24,m),sy=mix(1.0,.36,m);
      float tangent=mix(side*n.y*.69,angle*radius/.36,smoothstep(.35,.92,m))*sy;
      float y=side*tangent/sy;
      float freedom=1.0-smoothstep(.25,.88,m);
      float x=rest.x;
      // Solve the same bent fluid contour before giving the grains spherical depth.
      if(freedom>.0001)for(int i=0;i<3;i++) {
        vec2 q=vec2(cloud(vec2(x,y)*2.7+vec2(.13*t,-.17*t)),
                    cloud(vec2(x,y)*2.5+vec2(5.4-.12*t,2.1+.14*t)));
        float drift=sin(y*5.0+q.y*4.5-t*.5)*.038;
        x=rest.x+(y*.29-(q.x-.5)*.55-sin(y*4.6+t*.62)*.16-drift*(side>0.0?1.0:.6))*freedom;
      }
      float materialDepth=smoothstep(.70,1.0,m);
      float normal=(side*(x-rest.x)+(seed-.5)*.045*(1.0-materialDepth))*sx+radius*(1.0-radial)*materialDepth;
      float k=max(m,.0001)/radius;
      vec2 bent=vec2((1.0-(1.0-k*normal)*cos(k*tangent))/k,
                    (1.0-k*normal)*sin(k*tangent)/k);
      vec2 anchor=mix(rest,u_focus.xy+vec2(-side*radius,0.0),m);
      vec2 position=anchor+side*bent;
      gl_Position=vec4(position*vec2(2.0*u_resolution.y/u_resolution.x,2.0),0.0,1.0);
      float limb=pow(max(0.0,1.0-abs(n.z)),2.1);
      float corona=smoothstep(.44,.88,radial);
      float depth=mix(.42,1.0,smoothstep(-.7,.5,n.z));
      float light=(.18+.62*filaments+limb*.72+corona*.06)*depth;
      light*=mix(1.0,.48*smoothstep(.18,.65,detail)*(.25+limb),mote);
      // Lighting belongs to the deformed shell. Cursor/touch carries the light,
      // so it keeps travelling with the elastic patch after the finger lets go.
      vec3 surfaceNormal=normalize(vec3(projected,n.z));
      vec3 lightDirection=normalize(vec3(-.38+u_probe.x*.82,.48+u_probe.y*.82,1.15));
      float diffuse=max(0.0,dot(surfaceNormal,lightDirection));
      vec3 halfVector=normalize(lightDirection+vec3(0.0,0.0,1.0));
      float specular=pow(max(0.0,dot(surfaceNormal,halfVector)),18.0);
      float illumination=diffuse*(.11+u_probe.z*.32)+specular*(.12+u_probe.z*.48);
      float releasedLight=envelope*u_ripple.z*.32;
      // Processing is a low-contrast light travelling along existing grains.
      float scan=pow(.5+.5*cos(theta-u_expressionTime*1.75+n.z*.55),12.0)*u_state.y;
      float confirmedFront=exp(-pow((n.y-(.9-u_state.w*2.2))/.30,2.0))*u_state.z;
      float expression=u_state.x*.055+scan*.38+u_state.z*.28+confirmedFront*.44;
      v_alpha=light*smoothstep(.32,.88,m)*(1.0+local*.55+u_voice*lifted*.6+illumination+releasedLight+expression);
      vec3 teal=vec3(.21,.58,.55),cyan=vec3(.43,.76,.81),blue=vec3(.22,.37,.65);
      vec3 pigment=mix(teal,blue,.40+.32*sin(theta+.7+macro));
      v_color=mix(pigment*.95,cyan,clamp(smoothstep(.30,1.0,limb)*(.40+.45*seed)+filaments*.18,0.0,1.0));
      v_color=mix(v_color,vec3(.59,.84,.86),smoothstep(.97,1.0,seed)*.65);
      v_color=mix(v_color,vec3(.52,.82,.83),clamp(specular*u_probe.z*.45+scan*.18+confirmedFront*.28,0.0,.55));
      float speck=mix(1.25,2.40,seed)+filaments*.2+lifted*u_bands.z*.35;
      v_pointSize=max(1.0,speck*u_pixel);
      gl_PointSize=v_pointSize;
    }
  `;
  const particleFragmentSource = `
    precision mediump float;
    varying vec3 v_color;
    varying float v_alpha,v_pointSize;
    void main() {
      float d=length(gl_PointCoord-.5)*2.0;
      if(d>1.0)discard;
      // One physical pixel of edge coverage, with a defined core instead of haze.
      float edge=min(.65,2.0/v_pointSize);
      float core=1.0-smoothstep(1.0-edge,1.0,d);
      gl_FragColor=vec4(v_color,v_alpha*core);
    }
  `;
  // Curved rows form the fine woven surface; sparse motes lift beyond its silhouette.
  // Fixed seeds keep the grain stable between frames instead of temporal sparkle.
  const seedData=[],rows=saveData?62:88,equator=saveData?104:160;
  let seedIndex=0;
  const appendSeed=(longitude,z,mote=false)=>{
    const i=++seedIndex,seed=(i*.7548776662466927)%1,phase=.01+.98*((i*.5698402909980532)%1);
    seedData.push(longitude,z,seed,mote?-phase:phase);
  };
  for(let row=0;row<rows;row++){
    const latitude=Math.PI*(row+.5)/rows,columns=Math.max(12,Math.round(equator*Math.sin(latitude)));
    for(let col=0;col<columns;col++){
      const longitude=(col+(row%2)*.5)/columns*Math.PI*2+.16*Math.sin(latitude*4);
      appendSeed(longitude,Math.cos(latitude));
    }
  }
  const moteCount=saveData?700:1600;
  for(let i=0;i<moteCount;i++)appendSeed((i*2.399963229728653)%(Math.PI*2),.76*(1-2*(i+.5)/moteCount),true);
  const particleSeeds=new Float32Array(seedData),particleCount=particleSeeds.length/4;
  seedData.length=0;
  function orbGeometry(){
    const visible=Math.min(height,window.visualViewport?.height||height),short=visible<600;
    const diameter=short?Math.min(165,width*.62):Math.min(420,width<700?width*.75:visible*.46);
    return {x:width*.5,y:visible*(short?.25:.33),radius:diameter/2.3};
  }
  function syncOrbHitArea(){
    const hit=document.querySelector('#assistant-orb-hit');if(!hit)return;
    const g=orbGeometry(),r=g.radius*1.65,left=Math.max(0,g.x-r),top=Math.max(0,g.y-r);
    hit.style.left=left+'px';hit.style.top=top+'px';
    hit.style.width=(Math.min(width,g.x+r)-left)+'px';hit.style.height=(g.y+r-top)+'px';
  }

  function webGLRenderer() {
    const gl = canvas.getContext('webgl', {
      alpha: false, antialias: false, depth: false, stencil: false,
      preserveDrawingBuffer: false, powerPreference: 'low-power'
    });
    if (!gl) return null;
    const compiled = [];
    let program = null, buffer = null, pointsProgram=null, pointsBuffer=null;
    let compositeProgram=null,fluidTexture=null,fluidFramebuffer=null,fluidWidth=0,fluidHeight=0;
    try {
      const compile = (type, source) => {
        const shader = gl.createShader(type);
        if (!shader) throw new Error('Shader unavailable');
        compiled.push(shader);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Shader unsupported');
        return shader;
      };
      program = gl.createProgram();
      if (!program) throw new Error('Program unavailable');
      gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Program unsupported');
      gl.useProgram(program);
      buffer = gl.createBuffer();
      if (!buffer) throw new Error('Buffer unavailable');
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'a_position');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      const resolution = gl.getUniformLocation(program, 'u_resolution');
      const clock = gl.getUniformLocation(program, 'u_time');
      const activity = gl.getUniformLocation(program, 'u_energy');
      const light = gl.getUniformLocation(program, 'u_light');
      const touch = gl.getUniformLocation(program, 'u_touch');
      const morph = gl.getUniformLocation(program, 'u_morph'), voice = gl.getUniformLocation(program, 'u_voice'), focus = gl.getUniformLocation(program, 'u_focus');
      pointsProgram=gl.createProgram();
      if(!pointsProgram)throw Error('Particle shader unavailable');
      gl.attachShader(pointsProgram,compile(gl.VERTEX_SHADER,particleVertexSource));
      gl.attachShader(pointsProgram,compile(gl.FRAGMENT_SHADER,particleFragmentSource));
      gl.linkProgram(pointsProgram);
      if(!gl.getProgramParameter(pointsProgram,gl.LINK_STATUS))throw Error('Particle shader unsupported');
      pointsBuffer=gl.createBuffer();if(!pointsBuffer)throw Error('Particle buffer unavailable');
      gl.bindBuffer(gl.ARRAY_BUFFER,pointsBuffer);
      gl.bufferData(gl.ARRAY_BUFFER,particleSeeds,gl.STATIC_DRAW);
      const particlePosition=gl.getAttribLocation(pointsProgram,'a_particle');
      const pu={};for(const name of ['resolution','time','morph','voice','focus','bands','probe','grab','ripple','pixel','state','expressionTime'])pu[name]=gl.getUniformLocation(pointsProgram,'u_'+name);
      compositeProgram=gl.createProgram();if(!compositeProgram)throw Error('Composite shader unavailable');
      gl.attachShader(compositeProgram,compile(gl.VERTEX_SHADER,vertexSource));
      gl.attachShader(compositeProgram,compile(gl.FRAGMENT_SHADER,compositeFragmentSource));
      gl.linkProgram(compositeProgram);
      if(!gl.getProgramParameter(compositeProgram,gl.LINK_STATUS))throw Error('Composite shader unsupported');
      const compositePosition=gl.getAttribLocation(compositeProgram,'a_position');
      const compositeResolution=gl.getUniformLocation(compositeProgram,'u_resolution');
      const compositeSampler=gl.getUniformLocation(compositeProgram,'u_fluid');
      fluidTexture=gl.createTexture();fluidFramebuffer=gl.createFramebuffer();
      if(!fluidTexture||!fluidFramebuffer)throw Error('Fluid surface unavailable');
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,fluidTexture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER,fluidFramebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,fluidTexture,0);
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);
      // Read limits once, never synchronise with the GPU in the animation loop.
      const viewportLimit=gl.getParameter(gl.MAX_VIEWPORT_DIMS);
      const maxDimension=Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),gl.getParameter(gl.MAX_TEXTURE_SIZE),viewportLimit[0],viewportLimit[1]);
      const useAttribute=(attribute,size,data)=>{
        for(const other of [position,particlePosition,compositePosition])if(other!==attribute)gl.disableVertexAttribArray(other);
        gl.bindBuffer(gl.ARRAY_BUFFER,data);gl.enableVertexAttribArray(attribute);
        gl.vertexAttribPointer(attribute,size,gl.FLOAT,false,0,0);
      };
      compiled.forEach(shader => gl.deleteShader(shader));
      compiled.length = 0;
      return {
        maxDimension,
        resize(w,h) {
          if(w===fluidWidth&&h===fluidHeight)return;
          gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,fluidTexture);
          gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
          gl.bindFramebuffer(gl.FRAMEBUFFER,fluidFramebuffer);
          const complete=gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE;
          gl.bindFramebuffer(gl.FRAMEBUFFER,null);
          if(!complete)throw Error('Fluid surface incomplete');
          fluidWidth=w;fluidHeight=h;
        },
        draw() {
          const g=orbGeometry(),fx=(g.x/width-.5)*width/height,fy=.5-g.y/height,fr=g.radius/height;
          gl.bindFramebuffer(gl.FRAMEBUFFER,fluidFramebuffer);
          gl.viewport(0,0,fluidWidth,fluidHeight);
          gl.useProgram(program);useAttribute(position,2,buffer);
          gl.disable(gl.BLEND);
          gl.uniform2f(resolution,fluidWidth,fluidHeight);
          gl.uniform1f(clock, time);gl.uniform1f(activity, energy);gl.uniform1f(light, luminosity);
          gl.uniform3f(touch, touchX, 1 - touchY, attraction);
          gl.uniform1f(morph, assistantMix);gl.uniform1f(voice, audioLevel);
          gl.uniform3f(focus,fx,fy,fr);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          // Only the fluid is enlarged; the particles are drawn AFTER this copy.
          gl.bindFramebuffer(gl.FRAMEBUFFER,null);
          gl.viewport(0,0,canvas.width,canvas.height);
          gl.useProgram(compositeProgram);useAttribute(compositePosition,2,buffer);
          gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,fluidTexture);
          gl.uniform1i(compositeSampler,0);gl.uniform2f(compositeResolution,canvas.width,canvas.height);
          gl.drawArrays(gl.TRIANGLES,0,3);
          if(assistantMix>.2){
            gl.useProgram(pointsProgram);useAttribute(particlePosition,4,pointsBuffer);
            gl.uniform2f(pu.resolution,canvas.width,canvas.height);gl.uniform1f(pu.time,time);
            gl.uniform1f(pu.morph,assistantMix);gl.uniform1f(pu.voice,audioLevel);
            gl.uniform3f(pu.focus,fx,fy,fr);gl.uniform3f(pu.bands,bass,mid,treble);
            gl.uniform4f(pu.probe,probeX,probeY,probe,probePress);
            gl.uniform4f(pu.grab,grabAnchorX,grabAnchorY,stretchX.value,stretchY.value);
            gl.uniform4f(pu.ripple,rippleX,rippleY,rippleAmplitude,rippleAge);
            gl.uniform1f(pu.pixel,canvas.height/height);
            gl.uniform4f(pu.state,listenSignal,processSignal,confirmation,confirmationAge);
            gl.uniform1f(pu.expressionTime,expressionTime);
            gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE);
            gl.drawArrays(gl.POINTS,0,particleCount);gl.disable(gl.BLEND);
          }
        },
        dispose() {
          gl.deleteBuffer(buffer);
          gl.deleteProgram(program);
          gl.deleteBuffer(pointsBuffer);gl.deleteProgram(pointsProgram);
          gl.deleteProgram(compositeProgram);gl.deleteTexture(fluidTexture);gl.deleteFramebuffer(fluidFramebuffer);
        }
      };
    } catch (_) {
      compiled.forEach(shader => gl.deleteShader(shader));
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
      if(pointsBuffer)gl.deleteBuffer(pointsBuffer);if(pointsProgram)gl.deleteProgram(pointsProgram);
      if(compositeProgram)gl.deleteProgram(compositeProgram);
      if(fluidTexture)gl.deleteTexture(fluidTexture);if(fluidFramebuffer)gl.deleteFramebuffer(fluidFramebuffer);
      return null;
    }
  }

  function canvasRenderer() {
    // A second canvas is needed because a WebGL context cannot become a 2D one.
    const fallback = document.createElement('canvas');
    fallbackCanvas = fallback;
    fallback.className = 'ambient-fallback';
    fallback.setAttribute('aria-hidden', 'true');
    fallback.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
    fallback.style.opacity = String(fluidOpacity());
    canvas.insertAdjacentElement('afterend', fallback);
    const ctx = fallback.getContext('2d', { alpha: false });
    if (!ctx) { fallback.remove(); return { draw() {}, dispose() {} }; }
    return {
      draw() {
        if (fallback.width !== canvas.width || fallback.height !== canvas.height) {
          fallback.width = canvas.width;
          fallback.height = canvas.height;
        }
        const w = fallback.width, h = fallback.height, t = time * .12;
        const m=assistantMix,visible=Math.min(height,window.visualViewport?.height||height),short=visible<600;
        const cy=visible*(short?.25:.33)/height;
        const radius=(short?Math.min(165,width*.62):Math.min(420,width<700?width*.75:visible*.46))/(2.3*height);
        const mix=(a,b)=>a+(b-a)*m;
        const smooth=(a,b,x)=>{const u=Math.max(0,Math.min(1,(x-a)/(b-a)));return u*u*(3-2*u);};
        const silk=1-smooth(.38,.96,m);
        ctx.globalAlpha=silk;
        ctx.fillStyle = '#030507';
        ctx.globalAlpha=1;ctx.fillRect(0, 0, w, h);ctx.globalAlpha=silk;
        ctx.globalCompositeOperation = 'screen';
        const pull = (x, y) => {
          const dx = (touchX - x) * w / h, dy = touchY - y;
          const reach = .20 + .13 * attraction;
          const amount = attraction * .72 * Math.exp(-(dx * dx + dy * dy) / (reach * reach));
          x += (touchX - x) * amount;
          y += (touchY - y) * amount;
          return [x, y];
        };
        const glows = [
          [.15 + Math.sin(t) * .09, .65 + Math.cos(t * .7) * .09, '50,139,140'],
          [.9 + Math.cos(t * .6) * .12, .3 + Math.sin(t * .8) * .15, '53,82,155'],
          [.3, .07 + Math.sin(t * .4) * .07, '82,135,154']
        ];
        glows.forEach(([x, y, rgb]) => {
          [x, y] = pull(x, y);
          x=mix(x,.5);y=mix(y,cy);
          const r = h * mix(.55,radius*1.6), gradient = ctx.createRadialGradient(x * w, y * h, 0, x * w, y * h, r);
          gradient.addColorStop(0, `rgba(${rgb},${.19 * luminosity * (1 + energy * .4)})`);
          gradient.addColorStop(.45, `rgba(${rgb},${.055 * luminosity})`);
          gradient.addColorStop(1, `rgba(${rgb},0)`);
          ctx.fillStyle = gradient;
          ctx.fillRect(0, 0, w, h);
        });
        for (let i = 0; i < 5; i++) {
          ctx.beginPath();
          for (let step = 0; step <= 60; step++) {
            const y = step / 60;
            const x = .35 + Math.sin(y * 4.7 + t * .7) * .34 + (i - 2) * .018;
            let [px, py] = pull(x, y);
            const side=i<3?1:-1,angle=(1-y)*Math.PI-Math.PI/2;
            const r=radius+(i-(side>0?1:3.5))*.004;
            const tx=.5-side*Math.cos(angle)*r*height/width,ty=cy-side*Math.sin(angle)*r;
            px=mix(px,tx);py=mix(py,ty);
            if (step === 0) ctx.moveTo(px * w, py * h);
            else ctx.lineTo(px * w, py * h);
          }
          ctx.strokeStyle = `rgba(131,208,217,${(i === 2 ? .17 : .035) * luminosity * (1 + energy * .5)})`;
          ctx.lineWidth = (i === 2 ? 1.2 : 3) * h / height;
          ctx.stroke();
        }
        // Context-loss fallback: the same seeds and quiet centre, at a lower density.
        if(m>.2){
          const fade=smooth(.2,.84,m),cx=w*.5,centreY=cy*h,r=radius*h;
          ctx.fillStyle='#66b5bd';
          for(let i=0;i<particleCount;i+=8){
            const j=i*4,seed=particleSeeds[j+2],theta=particleSeeds[j]+time*.018;
            const z=particleSeeds[j+1],lat=Math.sqrt(1-z*z);
            const nx=Math.cos(theta)*lat,ny=Math.sin(theta)*lat;
            const wave=Math.sin(nx*6.8+ny*4+z*4.5-time*.24),crossWave=Math.sin(ny*9-nx*3+z*6.4+time*.18);
            const fold=.060*Math.sin(theta*5+z*7-time*.10)+.035*Math.sin(theta*9-z*5+time*.065)+wave*.04+crossWave*.026;
            const lift=(audioLevel*.045+bass*.14)*Math.pow(.5+.5*Math.sin(theta*3+z*5-time*1.6),3);
            const shell=1+fold+(seed-.5)*.052+lift+listenSignal*.008*Math.sin(expressionTime*1.65)-processSignal*.018+confirmation*.038;
            let ox=nx*shell/(1-z*.1),oy=ny*shell/(1-z*.1);
            const face=Math.pow(Math.abs(z),.65);
            ox+=(wave*.115+crossWave*.035)*face;oy+=(crossWave*.095-wave*.035)*face;
            const gx=ox-grabAnchorX,gy=oy-grabAnchorY,gripWidth=2.4-1.45*Math.exp(-(grabAnchorX*grabAnchorX+grabAnchorY*grabAnchorY)*4),influence=Math.exp(-(gx*gx+gy*gy)*gripWidth);
            ox+=stretchX.value*(.1+.9*influence);oy+=stretchY.value*(.1+.9*influence);
            const waveDistance=Math.hypot(ox-rippleX,oy-rippleY);
            const waveEnvelope=Math.exp(-Math.pow((waveDistance-rippleAge*1.7)/.30,2))*Math.exp(-rippleAge*2.6)*(1-Math.exp(-rippleAge*20));
            const recoil=Math.sin(waveDistance*12-rippleAge*9)*waveEnvelope*rippleAmplitude*.12;
            ox*=1+recoil;oy*=1+recoil;
            const dx=ox-probeX,dy=oy-probeY,local=(Math.exp(-(dx*dx+dy*dy)*9)+.26*Math.exp(-(probeX*probeX+probeY*probeY)*4))*probe;
            ox*=1+local*(.13+.08*probePress);oy*=1+local*(.13+.08*probePress);
            const homeY=(ny*.7+.5)*h,homeX=(.35+Math.sin(homeY/h*4.7+t*.7)*.34+(seed-.5)*.04)*w;
            const px=mix(homeX,cx+ox*r),py=mix(homeY,centreY-oy*r);
            const limb=Math.pow(1-Math.abs(z),2.7);
            const filament=Math.pow(.5+.5*Math.sin(z*14+ny*4-time*.20),3);
            const lightX=-.38+probeX*.82,lightY=.48+probeY*.82;
            const normalLength=Math.hypot(ox,oy,z)||1,lightLength=Math.hypot(lightX,lightY,1.15);
            const diffuse=Math.max(0,(ox*lightX+oy*lightY+z*1.15)/(normalLength*lightLength));
            const scan=Math.pow(.5+.5*Math.cos(Math.atan2(oy,ox)-expressionTime*1.75+z*.55),12)*processSignal;
            const confirmedFront=Math.exp(-Math.pow((ny-(.9-confirmationAge*2.2))/.30,2))*confirmation;
            ctx.globalAlpha=Math.min(1,(.08+filament*.25+limb*.64)*fade*(1+diffuse*(.11+probe*.32)+listenSignal*.055+scan*.38+confirmation*.28+confirmedFront*.44));
            const size=(1.25+seed*.7)*h/height;
            ctx.beginPath();ctx.arc(px,py,size*.5,0,Math.PI*2);ctx.fill();
          }
        }
        ctx.globalAlpha=1;
        ctx.globalCompositeOperation = 'source-over';
      },
      dispose() { fallback.remove(); if (fallbackCanvas === fallback) fallbackCanvas = null; }
    };
  }

  function draw() {
    const nextGathered=assistantMix>.12;
    if(nextGathered!==gathered){gathered=nextGathered;document.documentElement.classList?.toggle('fluid-gathered',gathered);}
    if (renderer && !lost) renderer.draw();
  }
  function sizeBuffer() {
    // Native Retina/4K dots, independent of adaptive fluid quality. Bound only
    // extreme display sizes/GPU limits (the pixel budget also fits native 5K).
    const limit=renderer?.maxDimension||4096;
    const ratio=Math.min(window.devicePixelRatio||1,limit/width,limit/height,Math.sqrt(16777216/(width*height)));
    const nextWidth = Math.max(1, Math.round(width * ratio));
    const nextHeight = Math.max(1, Math.round(height * ratio));
    if (canvas.width !== nextWidth) canvas.width = nextWidth;
    if (canvas.height !== nextHeight) canvas.height = nextHeight;
    const fluidRatio=Math.min(window.devicePixelRatio||1,1.25,900/Math.max(width,height),Math.sqrt(420000/(width*height)))*bufferScale;
    try { renderer?.resize?.(Math.max(1,Math.round(width*fluidRatio)),Math.max(1,Math.round(height*fluidRatio))); }
    catch (_) { renderer?.dispose();renderer=canvasRenderer(); }
  }
  function resize() {
    const rect = stage.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    sizeBuffer();
    syncOrbHitArea();
    draw();
  }
  function adaptResolution(interval, timestamp) {
    // Reallocate only the fluid texture between gestures, never during handoff.
    if (holding || releasing || assistantMix > 0 || timestamp < quietUntil || scene !== 'idle') {
      sampleTime = sampleCount = lateFrames = 0;
      return;
    }
    // Estimate the display cadence from timely frames. Long frames are load,
    // not evidence that a high-refresh display has suddenly become a 30 Hz one.
    if (interval >= 5 && interval < cadence * 1.15) {
      cadence += (Math.max(1000 / 144, interval) - cadence) * .08;
    }
    sampleTime += interval;
    sampleCount++;
    if (interval > cadence * 1.45) lateFrames++;
    if (sampleTime < 2000) return;
    const missed = lateFrames / sampleCount;
    if (missed > .18) quality = Math.max(.62, quality * .88);
    else if (missed < .035) quality = Math.min(saveData ? .78 : 1, quality + .025);
    // Similar pixel throughput at 60/120 Hz; never skip an animation callback.
    const nextScale = quality * Math.sqrt(Math.min(1, cadence / (1000 / 60)));
    if (Math.abs(nextScale - bufferScale) > .035) {
      bufferScale = nextScale;
      sizeBuffer();
    }
    sampleTime = sampleCount = lateFrames = 0;
  }
  function tick(timestamp) {
    frame = 0;
    if (document.hidden || reducedMotion.matches || lost || destroyed) return;
    const interval = Math.max(0, timestamp - lastPaint);
    const delta = Math.min(interval / 1000, .06);
    lastPaint = timestamp;
    adaptResolution(interval, timestamp);
    // Preserve velocity through early close/reopen; one critically damped spring.
    const rate=assistantTarget>assistantMix?6.8:5.4,decay=Math.exp(-rate*delta);
    const displacement=assistantMix-assistantTarget,velocity=assistantVelocity+rate*displacement;
    assistantMix=assistantTarget+(displacement+velocity*delta)*decay;
    assistantVelocity=(assistantVelocity-rate*velocity*delta)*decay;
    if(Math.abs(assistantMix-assistantTarget)<.00002&&Math.abs(assistantVelocity)<.0002){assistantMix=assistantTarget;assistantVelocity=0;}
    const fresh=assistantListening&&performance.now()-audioAt<220?audioTarget:0;
    audioLevel+=(fresh-audioLevel)*(1-Math.exp(-delta*(fresh>audioLevel?12:4)));
    expressionTime+=delta;
    const expressionEase=1-Math.exp(-delta*7.5);
    listenSignal+=((assistantActive&&assistantPhase==='listening'?1:0)-listenSignal)*expressionEase;
    processSignal+=((assistantActive&&assistantPhase==='processing'?1:0)-processSignal)*expressionEase;
    confirmationAge=Math.min(4,confirmationAge+delta);
    confirmation=confirmationAge<1.15?Math.sin(confirmationAge/1.15*Math.PI)*Math.exp(-confirmationAge*1.8):0;
    const spectralFresh=assistantListening&&performance.now()-audioAt<220;
    const spectralEase=1-Math.exp(-delta*10);
    bass+=((spectralFresh?bassTarget:0)-bass)*spectralEase;
    mid+=((spectralFresh?midTarget:0)-mid)*spectralEase;
    treble+=((spectralFresh?trebleTarget:0)-treble)*spectralEase;
    const probeEase=1-Math.exp(-delta*9);
    probe+=(probeTarget-probe)*probeEase;probePress+=(probePressTarget-probePress)*probeEase;
    probeX+=(probeTargetX-probeX)*probeEase;probeY+=(probeTargetY-probeY)*probeEase;
    const anchorEase=1-Math.exp(-delta*18);
    grabAnchorX+=(grabTargetX-grabAnchorX)*anchorEase;grabAnchorY+=(grabTargetY-grabAnchorY)*anchorEase;
    elasticStep(stretchX,delta,grabbed?24:11,grabbed?.78:.36);
    elasticStep(stretchY,delta,grabbed?24:11,grabbed?.78:.36);
    rippleAge=Math.min(10,rippleAge+delta);
    if(rippleAge>3)rippleAmplitude=0;
    time += delta * (1 + energy * .9);
    const ease = 1 - Math.exp(-delta * 4.5);
    energy += (target[0] - energy) * ease;
    luminosity += (target[1] - luminosity) * ease;
    const contactEase = 1 - Math.exp(-delta * 20);
    touchX += (contactX - touchX) * contactEase;
    touchY += (contactY - touchY) * contactEase;
    if (releasing) {
      // Exact critically damped solution: preserve the outgoing velocity, then
      // return continuously at half speed. No delayed reversal or frame-rate dependence.
      const speed = 7, decay = Math.exp(-speed * delta);
      const motion = attractionVelocity + speed * attraction;
      attraction = (attraction + motion * delta) * decay;
      attractionVelocity = (attractionVelocity - speed * motion * delta) * decay;
      if (attraction < .001 && Math.abs(attractionVelocity) < .01) {
        attraction = attractionVelocity = 0;
        releasing = false;
      }
    } else {
      const attractionEase = 1 - Math.exp(-delta * 15);
      attraction += (attractionTarget - attraction) * attractionEase;
      attractionVelocity = (attractionTarget - attraction) * 15;
    }
    draw();
    frame = requestAnimationFrame(tick);
  }
  function resume() {
    cancelAnimationFrame(frame);
    frame = 0;
    if (document.hidden || lost || destroyed) return;
    lastPaint = performance.now();
    sampleTime = sampleCount = lateFrames = 0;
    if (reducedMotion.matches) {
      resetElastic();
      assistantMix=assistantTarget;assistantVelocity=0;audioLevel=bass=mid=treble=probe=probePress=listenSignal=processSignal=confirmation=0;confirmationAge=4;
      energy = target[0];
      luminosity = target[1];
      attraction = attractionTarget = attractionVelocity = 0;
      releasing = false;
    }
    draw();
    if (!reducedMotion.matches) frame = requestAnimationFrame(tick);
  }

  const clamp = value => Math.max(0, Math.min(1, value));
  function move(point) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    contactX = clamp(point.x / width);
    contactY = clamp(point.y / height);
  }
  function begin(point) {
    move(point);
    holding = true;
    releasing = false;
    quietUntil = performance.now() + 500;
    if(attraction<.001){touchX=contactX;touchY=contactY;}
    attractionTarget = reducedMotion.matches ? 0 : Math.max(.18,attraction);
  }
  function charge(amount) {
    if (!holding || !Number.isFinite(amount) || reducedMotion.matches) return;
    attractionTarget = .18 + clamp(amount) * .82;
    // A long hold begins gathering before recognition opens. A quick tap keeps
    // the original local response; the spring hands its velocity into the form.
    if(!assistantActive)assistantTarget=.18*Math.pow(Math.max(0,(clamp(amount)-.45)/.55),2);
  }
  function handoff() {
    holding = false;if(!assistantActive)assistantTarget=0;
    if (reducedMotion.matches || releasing) return;
    // A short tap can land between animation frames. Give it a small impulse,
    // not a second rise/hold/reversal after the finger is already lifted.
    attractionVelocity = Math.max(attractionVelocity * .5, Math.max(0, .32 - attraction) * 7);
    attractionTarget = 0;
    releasing = true;
    quietUntil = performance.now() + 700;
  }
  function release(options = {}) {
    if (options?.handoff) { handoff(); return; }
    holding = false;if(!assistantActive)assistantTarget=0;
    if (!releasing) attractionVelocity *= .5;
    attractionTarget = 0;
    releasing = true;
    quietUntil = performance.now() + 700;
  }
  function fluidOpacity() { return 1; }
  function setAssistantMix(amount) {
    if(destroyed||!Number.isFinite(amount))return;
    assistantMix=assistantTarget=clamp(amount);assistantVelocity=0;
    draw();
  }
  function assistant(active) {
    assistantActive=!!active;assistantTarget=assistantActive?1:0;
    // The gesture hands over to the same renderer; releasing the finger does
    // not dismiss the listening form. Only the assistant close opens it again.
    if(!assistantActive){releaseElastic();assistantListening=false;assistantPhase='idle';audioTarget=bassTarget=midTarget=trebleTarget=probeTarget=probePressTarget=0;}
    quietUntil=performance.now()+1800;
    if(reducedMotion.matches){assistantMix=assistantTarget;assistantVelocity=0;draw();}
  }
  function setListening(active){
    assistantListening=!!active;
    if(assistantListening)setAssistantPhase('listening');
    else {if(assistantPhase==='listening')setAssistantPhase('idle');audioTarget=bassTarget=midTarget=trebleTarget=0;}
  }
  function setAssistantPhase(phase){
    const next=({ready:'idle',thinking:'processing',confirming:'confirmed',success:'confirmed'})[phase]||phase;
    if(!['idle','listening','processing','confirmed'].includes(next)||destroyed)return false;
    if(next==='confirmed')return confirm();
    assistantPhase=next;
    if(reducedMotion.matches){listenSignal=processSignal=0;draw();}
    return true;
  }
  function confirm(){
    if(!assistantActive||destroyed)return false;
    // Repeated confirmation callbacks cannot retrigger the same success pulse.
    if(assistantPhase==='confirmed'&&confirmationAge<1.15)return false;
    assistantPhase='confirmed';
    confirmationAge=reducedMotion.matches?4:0;confirmation=0;
    if(reducedMotion.matches)draw();
    return true;
  }
  function setAudioLevel(level,details={}){
    const active=assistantActive&&assistantListening;
    audioTarget=active&&Number.isFinite(level)?clamp(level):0;
    bassTarget=active&&Number.isFinite(details?.bass)?clamp(details.bass):0;
    midTarget=active&&Number.isFinite(details?.mid)?clamp(details.mid):0;
    trebleTarget=active&&Number.isFinite(details?.high)?clamp(details.high):0;
    audioAt=performance.now();
  }
  function orbHitTest(point){
    if(!assistantActive||!point||!Number.isFinite(point.x)||!Number.isFinite(point.y))return false;
    const g=orbGeometry(),x=(point.x-g.x)/g.radius,y=(g.y-point.y)/g.radius;
    const lobe=Math.hypot(x-grabAnchorX-stretchX.value,y-grabAnchorY-stretchY.value)<.48;
    return Math.hypot(x,y)<=1.23||(Math.hypot(stretchX.value,stretchY.value)>.08&&lobe);
  }
  function orbPointer(point,options={}){
    if(!options.active||!assistantActive||reducedMotion.matches){
      releaseElastic();probeTarget=probePressTarget=0;
      if(reducedMotion.matches)resetElastic();return;
    }
    if(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y))return;
    const g=orbGeometry(),px=(point.x-g.x)/g.radius,py=(g.y-point.y)/g.radius;
    probeTargetX=Math.max(-1.5,Math.min(1.5,px));probeTargetY=Math.max(-1.5,Math.min(1.5,py));
    if(options.pressed){
      if(!grabbed){
        grabbed=true;grabStartX=px;grabStartY=py;
        grabTargetX=probeTargetX;grabTargetY=probeTargetY;
        grabBaseX=stretchX.value;grabBaseY=stretchY.value;
        if(Math.hypot(stretchX.value,stretchY.value)<.001){grabAnchorX=grabTargetX;grabAnchorY=grabTargetY;}
      }
      const dx=px-grabStartX,dy=py-grabStartY,length=Math.hypot(dx,dy),resistance=1/(1+length/2.4);
      const tx=grabBaseX+dx*resistance,ty=grabBaseY+dy*resistance,limit=Math.max(1,Math.hypot(tx,ty));
      stretchX.target=tx/limit;stretchY.target=ty/limit;
    }else releaseElastic();
    probeTarget=1;probePressTarget=options.pressed?1:0;
  }
  // All points are CSS pixels relative to #experience. Gestures own timing;
  // this renderer owns continuous interpolation and the brief popup handoff.
  const api = Object.freeze({ begin, move, charge, release, handoff, assistant, setAssistantMix, setListening, setAudioLevel, setAssistantPhase, confirm, orbHitTest, orbPointer });
  window.MyMoneyOrbit = api;
  function sceneChanged() {
    const next = document.documentElement.dataset.scene || 'idle';
    if (next === scene) return;
    scene = next;
    target = sceneTargets[scene] || sceneTargets.idle;
    if (reducedMotion.matches) resume();
  }

  renderer = webGLRenderer() || canvasRenderer();
  const sceneObserver = new MutationObserver(sceneChanged);
  sceneObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-scene'] });
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  if (resizeObserver) resizeObserver.observe(stage);
  // A monitor/DPR change may leave the observed CSS size unchanged.
  on(window, 'resize', resize, { passive: true });
  if(window.visualViewport)on(window.visualViewport,'resize',()=>{syncOrbHitArea();draw();},{passive:true});
  on(document, 'visibilitychange', () => {
    if (document.hidden) {
      release();resetElastic();
      confirmation=listenSignal=processSignal=0;confirmationAge=4;
      attraction = attractionVelocity = 0;audioLevel=audioTarget=bass=mid=treble=bassTarget=midTarget=trebleTarget=probe=probeTarget=probePress=probePressTarget=0;
    }
    resume();
  });
  on(window, 'mm:touch', event => {
    // Legacy callers still get a local material response at their touch point.
    begin(event.detail);
    handoff();
  });
  on(window, 'mm:fluid', event => {
    const detail = event.detail || {};
    if (detail.phase === 'begin') begin(detail);
    else if (detail.phase === 'move') move(detail);
    else if (detail.phase === 'charge') charge(detail.amount);
    else if (detail.phase === 'handoff') handoff();
    else if (detail.phase === 'release') release(detail);
  });
  if (reducedMotion.addEventListener) on(reducedMotion, 'change', resume);
  else reducedMotion.addListener(resume);
  on(canvas, 'webglcontextlost', event => {
    event.preventDefault();
    lost = true;
    cancelAnimationFrame(frame);
    frame = 0;
    renderer?.dispose();
    renderer = canvasRenderer();
    // A lightweight ambient fallback keeps the scene alive while WebGL recovers.
    lost = false;
    resume();
  });
  on(canvas, 'webglcontextrestored', () => {
    renderer?.dispose();
    renderer = webGLRenderer() || canvasRenderer();
    resize();
    resume();
  });
  on(window, 'pagehide', event => {
    cancelAnimationFrame(frame);
    frame = 0;
    if (!event.persisted) {
      destroyed = true;
      resizeObserver?.disconnect();
      sceneObserver.disconnect();
      listeners.forEach(remove => remove());
      if (!reducedMotion.removeEventListener) reducedMotion.removeListener(resume);
      renderer?.dispose();
      if (window.MyMoneyOrbit === api) delete window.MyMoneyOrbit;
    }
  });
  on(window, 'pageshow', () => { if (!destroyed) { resize(); resume(); } });
  resize();
  resume();
})();
