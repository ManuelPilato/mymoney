"""Focused gesture/voice regressions. Disposable storage and simulated speech only."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(ROOT/'app')))
Thread(target=server.serve_forever,daemon=True).start()
FAKE='''
window.sessions=[];
class Speech {
 start(){window.sessions.push(this);this.onstart?.();}
 stop(){this.onend?.();}
 abort(){this.aborted=true;this.onend?.();}
}
window.SpeechRecognition=Speech;
window.emitSpeech=(text,end=true)=>{let r=sessions.at(-1),result=[{transcript:text}];result.isFinal=true;r.onresult?.({results:[result]});if(end)r.onend?.();};
'''
checks=[];errors=[]
def check(name,value=True):
    assert value,name
    checks.append(name);print('PASS',name,flush=True)
def close(page,button,sheet):
    page.locator(button).click();expect(page.locator(sheet)).not_to_be_visible()
def settled(page,sheet):
    page.locator(sheet).evaluate('(e)=>Promise.all(e.getAnimations().map(a=>a.finished.catch(()=>{})))')
try:
 with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    context=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,locale='it-IT')
    context.route('https://**/*',lambda route:route.abort())
    context.add_init_script(FAKE)
    page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(f'http://127.0.0.1:{server.server_port}/')
    page.locator('#touch-surface').tap();settled(page,'#quick-sheet')
    bounds=page.locator('#quick-sheet').bounding_box()
    check('Phone popup centered; no input autofocus',abs(bounds['y']+bounds['height']/2-422)<3 and page.locator('#quick-title').evaluate('(e)=>e===document.activeElement'))
    page.locator('label[for="q-name"]').tap()
    check('Name label explicitly focuses its input',page.locator('#q-name').evaluate('(e)=>e===document.activeElement'))
    page.locator('#q-name').fill('Da scartare');page.locator('#q-amount').fill('99');page.locator('#quick-options').tap();page.locator('#q-date').fill('2026-11-02')
    close(page,'#close-quick','#quick-sheet');page.locator('#touch-surface').tap()
    check('Reopening discards the entire unsaved expense',page.locator('#q-name').input_value()=='' and page.locator('#q-amount').input_value()=='' and not page.locator('#quick-details').is_visible() and page.locator('#q-date').input_value()!='2026-11-02')
    phone_motion=page.locator('#quick-sheet').evaluate('(e)=>[getComputedStyle(e).animationName,getComputedStyle(e).animationDuration,getComputedStyle(e,"::backdrop").animationName]')
    close(page,'#close-quick','#quick-sheet')
    cdp=context.new_cdp_session(page)
    cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':112,'y':350,'id':1}]})
    page.wait_for_timeout(650)
    check('Holding starts recognition without a second tap',page.locator('#voice-sheet').is_visible() and page.evaluate('sessions.length===1') and page.locator('#mic').get_attribute('aria-pressed')=='true')
    check('Long hold blocks selection and feedback follows contact',page.evaluate('document.documentElement.classList.contains("surface-held") && getComputedStyle(document.querySelector("#natural")).userSelect==="none" && document.querySelector(".hold-ring").style.left==="112px"'))
    page.evaluate('window.dispatchEvent(new Event("blur"))')
    check('Permission-window blur does not abort recognition',page.evaluate('!sessions[0].aborted'))
    cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]});page.wait_for_timeout(80)
    page.evaluate('emitSpeech("caffè 2 euro oggi",false)')
    page.locator('#mic').tap() # End first recording, producing its preview.
    expect(page.locator('#command-preview')).to_be_visible()
    page.locator('#command-close').tap()
    check('Retry immediately starts fresh dictation',page.evaluate('sessions.length===2') and page.locator('#natural').input_value()=='')
    page.evaluate('emitSpeech("pane 3 euro oggi",false)')
    check('New recording replaces previous text',page.locator('#natural').input_value()=='pane 3 euro oggi')
    close(page,'#close-voice','#voice-sheet')
    page.locator('#accessible-voice').focus();page.locator('#accessible-voice').press('Enter')
    check('Reopened voice popup is clean; old callbacks are ignored',page.locator('#natural').input_value()=='' and not page.locator('#command-preview').is_visible())
    page.evaluate('sessions[1].onresult?.({results:[Object.assign([{transcript:"obsolete"}],{isFinal:true})]})')
    assert page.locator('#natural').input_value()==''
    close(page,'#close-voice','#voice-sheet')
    page.locator('#open-data').tap()
    check('Data opens without highlighting Preferences',page.locator('#data-title').evaluate('(e)=>e===document.activeElement') and not page.locator('#data-settings').evaluate('(e)=>e.matches(":focus-visible")'))
    page.locator('#data-settings').tap();page.locator('#s-salary').fill('9999');close(page,'#close-data','#data-sheet')
    page.locator('#open-data').tap();page.locator('#data-settings').tap()
    check('Dismissed preferences restore saved values',page.locator('#s-salary').input_value()=='0,00')
    close(page,'#close-data','#data-sheet')
    page.locator('#touch-surface').tap();settled(page,'#quick-sheet')
    page.screenshot(path='/private/tmp/mymoney-phone-popup-v6.1.png',scale='css')
    desktop=browser.new_context(viewport={'width':1440,'height':900});desktop.route('https://**/*',lambda r:r.abort());desktop.add_init_script(FAKE)
    mac=desktop.new_page();mac.on('pageerror',lambda e:errors.append(str(e)));mac.goto(f'http://127.0.0.1:{server.server_port}/');mac.locator('#desktop-add').click()
    motion=mac.locator('#quick-sheet').evaluate('(e)=>[getComputedStyle(e).animationName,getComputedStyle(e).animationDuration,getComputedStyle(e,"::backdrop").animationName]')
    check('Phone and Mac use identical popup and backdrop animation',phone_motion==motion)
    check('No JavaScript exceptions',not errors)
    browser.close()
finally: server.shutdown()
print(f'{len(checks)} focused checks passed')
