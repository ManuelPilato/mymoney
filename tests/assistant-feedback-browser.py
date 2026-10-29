"""Focused assistant/notification UI checks with synthetic, disposable records.

Run after building the app:
    python3 tests/assistant-feedback-browser.py
Requires Playwright and Chrome (same setup as retina_browser_test.py).
No microphone, notification permission, Firebase data or external network is used.
This is Chromium mobile emulation, not a physical iPhone/Safari certification.
"""
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import json

from playwright.sync_api import sync_playwright, expect
from retina_browser_test import QuietHandler, chrome_path, SEED

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests' / 'artifacts' / 'assistant-feedback'
GUARDS = """(() => {
  window.__feedbackAudit={permissionRequests:0,microphoneRequests:0,phases:[],pulses:0};
  if(window.Notification){
    Object.defineProperty(Notification,'permission',{get:()=> 'default'});
    Notification.requestPermission=()=>{__feedbackAudit.permissionRequests++;return Promise.resolve('denied');};
  }
  if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=()=>{
    __feedbackAudit.microphoneRequests++;return Promise.reject(new Error('Real microphone disabled in test'));
  };
})();"""


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT / 'app')))
    Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}/'
    records = []
    try:
        with sync_playwright() as p:
            executable = chrome_path()
            browser = p.chromium.launch(headless=True, **({'executable_path': executable} if executable else {}))
            for name, width, height, dpr, mobile in [
                ('desktop-retina', 1512, 982, 2, False),
                ('mobile-retina', 440, 956, 3, True),
            ]:
                context = browser.new_context(viewport={'width': width, 'height': height},
                    device_scale_factor=dpr, is_mobile=mobile, has_touch=mobile,
                    locale='it-IT', timezone_id='Europe/Rome', service_workers='block')
                context.route('**/*', lambda route: route.continue_() if route.request.url.startswith(base) else route.abort())
                context.add_init_script(GUARDS)
                page = context.new_page()
                errors, dialogs, checks, screenshots = [], [], [], []
                page.on('pageerror', lambda error: errors.append(str(error)))
                def dialog_handler(dialog):
                    dialogs.append(dialog.message)
                    dialog.accept()
                page.on('dialog', dialog_handler)
                page.goto(base)
                page.wait_for_function('window.MM && window.MMUI && window.MyMoneyOrbit && window.MMNotificationUI')
                page.evaluate(SEED)
                page.reload()
                page.wait_for_function('window.MMUI && window.MyMoneyOrbit && window.MMNotificationUI')
                page.evaluate("""() => {
                  const orb=window.MyMoneyOrbit,phase=orb.setAssistantPhase,confirm=orb.confirm;
                  window.MyMoneyOrbit={...orb,
                    setAssistantPhase:(value)=>{__feedbackAudit.phases.push(value);return phase(value);},
                    confirm:()=>{__feedbackAudit.pulses++;return confirm();}};
                }""")

                def check(label, condition=True):
                    assert condition, f'{name}: {label}'
                    checks.append(label)
                    print(f'PASS {name}: {label}', flush=True)

                def count():
                    return page.evaluate("JSON.parse(localStorage.getItem('mymoney-local-v2')).transactions.length")

                def open_typed():
                    page.evaluate("MMUI.open(document.querySelector('#voice-sheet'))")
                    expect(page.locator('#voice-sheet')).to_be_visible()
                    page.locator('#assistant-type').click()
                    expect(page.locator('#natural')).to_be_visible()

                def submit(text):
                    page.locator('#natural').fill(text)
                    page.locator('#interpret').click()

                def close():
                    page.locator('#close-voice').click()
                    expect(page.locator('#voice-sheet')).not_to_be_visible()

                def capture(view):
                    page.mouse.move(1, 1)
                    page.wait_for_timeout(350)
                    audit = page.evaluate("""() => ({
                      overflow:document.documentElement.scrollWidth>innerWidth+1,
                      canvas:[document.querySelector('#orb-canvas').width,document.querySelector('#orb-canvas').height],
                      fonts:document.fonts.status,
                      blurryText:[...document.querySelectorAll('#voice-sheet h3,#voice-sheet p,#voice-sheet button,#notification-settings p,#notification-settings button')]
                        .filter(e=>e.getClientRects().length&&getComputedStyle(e).filter!=='none').map(e=>e.id)
                    })""")
                    assert not audit['overflow'] and not audit['blurryText'], audit
                    assert audit['canvas'] == [width*dpr,height*dpr] and audit['fonts']=='loaded', audit
                    file=OUT/f'{name}-{view}.png'
                    page.screenshot(path=str(file),scale='device')
                    screenshots.append(str(file.relative_to(ROOT)))

                baseline = count()
                check('Synthetic archive loaded', baseline == 3)
                open_typed()
                submit('benzina 20 euro oggi')
                expect(page.locator('#command-preview')).to_be_visible()
                check('One confirmation action; details stay folded',
                      page.locator('#command-save:visible').count()==1 and
                      page.locator('#command-save').inner_text()=='Conferma' and
                      not page.locator('#command-details').evaluate('(e)=>e.open') and
                      not page.locator('#command-edit').is_visible())
                check('Processing state reaches the orb', 'processing' in page.evaluate('__feedbackAudit.phases'))
                capture('expense-confirmation')
                page.evaluate("{const button=document.querySelector('#command-save');button.click();button.click();}")
                expect(page.locator('#voice-sheet')).not_to_be_visible()
                check('A repeated confirm event commits exactly once', count()==baseline+1)
                check('Save produces one success impulse', page.evaluate('__feedbackAudit.pulses')==1)

                open_typed()
                check('Reopening resets the assistant session',
                      page.locator('#natural').input_value()=='' and not page.locator('#command-preview').is_visible())
                submit('benzina 20 euro oggi')
                expect(page.locator('#command-preview')).to_be_visible()
                page.locator('#command-save').click()
                expect(page.locator('#voice-sheet')).not_to_be_visible()
                check('A separate identical expense is permitted after confirmation',count()==baseline+2 and len(dialogs)==1)

                open_typed()
                submit('Posso permettermi scarpe da 80 euro?')
                expect(page.locator('#advisor-answer')).to_be_visible()
                check('A complete scenario has no irrelevant primary action',
                      not page.locator('#advisor-action').is_visible() and
                      page.locator('#advisor-voice').is_visible() and
                      'quiet' not in (page.locator('#advisor-voice').get_attribute('class') or '').split())
                check('Financial details are folded and the question creates no expense',
                      not page.locator('#advisor-details').evaluate('(e)=>e.open') and count()==baseline+2)
                capture('financial-answer')
                close()

                open_typed()
                submit('Posso permettermi un iPhone?')
                expect(page.locator('#advisor-answer')).to_be_visible()
                check('An incomplete scenario exposes its relevant action',
                      page.locator('#advisor-action').is_visible() and
                      page.locator('#advisor-action').inner_text()=='Riformula' and
                      'quiet' in (page.locator('#advisor-voice').get_attribute('class') or '').split())
                page.locator('#advisor-action').click()
                expect(page.locator('#natural')).to_be_visible()
                submit('Quanto fa 2 più 2?')
                expect(page.locator('#advisor-answer')).to_be_visible()
                check('Out-of-domain requests never become transactions',
                      'Mi occupo solo di MyMoney' in page.locator('#advisor-explanation').inner_text() and
                      not page.locator('#command-preview').is_visible() and count()==baseline+2)
                close()

                open_typed()
                page.locator('#natural').fill('pane 3 euro oggi')
                pending = page.evaluate("""() => {
                  document.querySelector('#interpret').click();
                  const pending=document.querySelector('#voice-sheet').getAttribute('aria-busy');
                  document.querySelector('#close-voice').click();return pending;
                }""")
                expect(page.locator('#voice-sheet')).not_to_be_visible()
                page.wait_for_timeout(250)
                check('Closing during analysis cancels the result instead of reopening',
                      pending=='true' and not page.locator('#voice-sheet').is_visible() and count()==baseline+2)

                page.evaluate("MMUI.open(document.querySelector('#data-sheet'))")
                page.locator('#data-settings').click()
                page.locator('#notification-settings summary').click()
                expect(page.locator('#notification-status')).to_contain_text('Invio automatico da collegare')
                check('Italian notification setup is explicit and opt-in',
                      page.locator('#notification-enable').is_disabled() and
                      not page.locator('#notification-details').is_checked() and
                      not page.locator('#notification-test').is_disabled())
                capture('notifications-it')
                page.locator('#s-language').select_option('en')
                expect(page.locator('#notification-status')).to_contain_text('Automatic delivery still needs to be connected')
                check('Notification preferences follow English language selection',
                      page.locator('#notification-settings summary').inner_text()=='Notifications' and
                      page.locator('#notification-test').inner_text()=='Test notification')
                capture('notifications-en')
                guards = page.evaluate('__feedbackAudit')
                check('No permission prompts or microphone access during normal use',
                      guards['permissionRequests']==0 and guards['microphoneRequests']==0)
                check('No browser JavaScript exceptions',not errors)
                records.append({'profile':name,'checks':checks,'screenshots':screenshots,
                    'permissionRequests':guards['permissionRequests'],'microphoneRequests':guards['microphoneRequests'],
                    'transactionCount':count(),'errors':errors,'syntheticData':True})
                context.close()
            browser.close()
        (OUT/'audit.json').write_text(json.dumps(records,indent=2),encoding='utf-8')
        print(f'PASS {sum(len(r["checks"]) for r in records)} focused browser checks; {OUT}',flush=True)
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    main()
