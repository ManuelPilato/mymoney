'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const app=fs.readFileSync(require('node:path').join(__dirname,'../src/app.js'),'utf8');
const source=app.slice(app.indexOf('  let composerMeasure='),app.indexOf('  function composeState()'));
function harness(){
  let id=0,visible=true,content=46;const frames=new Map(),mirrors=[];
  const field={value:'',style:{height:'48px'},getClientRects:()=>visible?[{}]:[],getBoundingClientRect:()=>({width:280})};
  const context={window:{innerHeight:850,visualViewport:{height:850}},$:()=>field,
    requestAnimationFrame:fn=>{frames.set(++id,fn);return id;},cancelAnimationFrame:key=>frames.delete(key),
    getComputedStyle:()=>({font:'16px sans-serif',lineHeight:'24px',letterSpacing:'0px',padding:'10px 0 12px',border:'0px solid',borderTopWidth:'0',borderBottomWidth:'1',minHeight:'48px',boxSizing:'border-box',whiteSpace:'pre-wrap',wordBreak:'normal',overflowWrap:'break-word'}),
    document:{createElement:()=>({style:{},setAttribute(){},get scrollHeight(){return content;}}),body:{append:e=>mirrors.push(e)}}};
  vm.runInNewContext(source+'\nglobalThis.resize=resizeAssistantText;',context);
  return{field,frames,mirrors,window:context.window,resize:context.resize,content:n=>{content=n;},visible:v=>{visible=v;},flush(){const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn());}};
}
test('composer measures offscreen, grows and shrinks without clearing the live field',()=>{
  const h=harness();h.resize();assert.equal(h.field.style.height,'48px');h.flush();assert.equal(h.field.style.height,'48px');
  h.field.value='A long question that wraps';h.content(94);h.resize();assert.equal(h.field.style.height,'48px');h.flush();assert.equal(h.field.style.height,'95px');assert.equal(h.field.value,'A long question that wraps');
  h.field.value='Fuel';h.content(46);h.resize();h.flush();assert.equal(h.field.style.height,'48px');assert.equal(h.mirrors.length,1);
});
test('composer caps long input to keyboard viewport and scrolls the content',()=>{
  const h=harness();h.window.visualViewport.height=400;h.content(400);h.resize();h.flush();assert.ok(Math.abs(parseFloat(h.field.style.height)-112)<.001);assert.equal(h.field.style.overflowY,'auto');
  h.content(46);h.resize();h.flush();assert.equal(h.field.style.overflowY,'hidden');
});
test('rapid updates coalesce and hidden composer is not resized by a late frame',()=>{
  const h=harness();h.content(140);h.resize();h.resize();assert.equal(h.frames.size,1);h.visible(false);h.flush();assert.equal(h.field.style.height,'48px');assert.equal(h.mirrors.length,0);
});
