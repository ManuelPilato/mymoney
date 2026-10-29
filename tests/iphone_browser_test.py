"""iPhone UI regressions against the public build and disposable browser storage.

Run: /tmp/mymoney-test-env/bin/python tests/iphone_browser_test.py
Chrome emulates the viewport and touch input; this does not certify Safari,
the physical keyboard, microphone permission UI, or real speech recognition.
"""
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import json
import os

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests' / 'artifacts'
OUT.mkdir(exist_ok=True)
KEY = 'mymoney-local-v2'
checks, errors = [], []


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT / 'app')))
Thread(target=server.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{server.server_port}/'


def check(name, condition):
    assert condition, name
    checks.append(name)
    print('PASS', name, flush=True)


def state(page):
    return page.evaluate(f"JSON.parse(localStorage.getItem('{KEY}'))")


def quiet(page):
    return page.locator('dialog[open]').count() == 0


def touch(page, points, hold=0, cancel=False):
    """Use the browser's touch pipeline so generated pointer/click events are real."""
    cdp = page.context.new_cdp_session(page)
    try:
        for i, (x, y) in enumerate(points):
            cdp.send('Input.dispatchTouchEvent', {
                'type': 'touchStart' if i == 0 else 'touchMove',
                'touchPoints': [{'x': x, 'y': y, 'id': 1}],
            })
            if len(points) > 1:
                page.wait_for_timeout(22)
        if hold:
            page.wait_for_timeout(hold)
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchCancel' if cancel else 'touchEnd', 'touchPoints': []})
    finally:
        cdp.detach()


def tap_home(page):
    touch(page, [(page.viewport_size['width'] / 2, page.viewport_size['height'] * .45)])
    page.locator('#quick-sheet[open]').wait_for()
    page.locator('#quick-sheet').evaluate('(e)=>Promise.all(e.getAnimations().map(a=>a.finished.catch(()=>{})))')


def swipe_up(page):
    w, h = page.viewport_size['width'], page.viewport_size['height']
    touch(page, [(w / 2, h * .74), (w / 2, h * .68), (w / 2, h * .56), (w / 2, h * .41)])
    page.locator('#data-sheet[open]').wait_for()
    page.locator('#data-sheet').evaluate('(e)=>Promise.all(e.getAnimations().map(a=>a.finished.catch(()=>{})))')


def hold_home(page):
    touch(page, [(page.viewport_size['width'] / 2, page.viewport_size['height'] * .45)], hold=530)
    page.locator('#voice-sheet[open]').wait_for()


def close_sheet(page, name):
    selectors = {'quick': '#close-quick', 'data': '#close-data', 'voice': '#close-voice', 'editor': '#close-editor', 'rec-editor': '#close-rec'}
    ids = {'quick': 'quick-sheet', 'data': 'data-sheet', 'voice': 'voice-sheet', 'editor': 'editor', 'rec-editor': 'rec-editor'}
    page.locator(selectors[name]).click()
    page.locator(f"#{ids[name]}[open]").wait_for(state='detached')


def quick(page, name, amount, date=None, already_open=False):
    if not already_open:
        tap_home(page)
    page.locator('#q-name').fill(name)
    page.locator('#q-amount').fill(amount)
    if date:
        page.locator('#q-date').fill(date)
    page.locator('#quick-save').click()


def ready(page):
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.set_default_timeout(6000)
    page.clock.set_fixed_time(datetime(2026, 10, 27, 15, 0, tzinfo=timezone.utc))
    page.goto(URL)
    page.wait_for_function('window.MMUI && window.MM && document.documentElement.dataset.scene')


def disclose(page, label):
    summary = page.get_by_text(label, exact=True)
    if not summary.evaluate('(s)=>s.parentElement.open'):
        summary.click()


FAKE_SPEECH = """
window.speechSessions=[];
class FakeSpeech {
  start(){window.speechSessions.push(this);window.testRecognition=this;this.onstart?.();}
  stop(){this.onend?.();}
  abort(){this.wasAborted=true;this.onerror?.({error:'aborted'});this.onend?.();}
}
window.SpeechRecognition=FakeSpeech;
window.webkitSpeechRecognition=FakeSpeech;
window.emitSpeech=(r,text,finish=true)=>{const a=[{transcript:text}];a.isFinal=true;r.onresult?.({results:[a],resultIndex:0});if(finish)r.onend?.();};
"""


try:
    with sync_playwright() as p:
        chrome = os.environ.get('MYMONEY_TEST_BROWSER', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
        browser = p.chromium.launch(headless=True, **({'executable_path': chrome} if Path(chrome).exists() else {}))
        options = dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True,
                       has_touch=True, locale='it-IT', timezone_id='Europe/Rome', accept_downloads=True)
        context = browser.new_context(**options)
        page = context.new_page()
        ready(page)

        check('Idle shows only the MyMoney wordmark and no financial panel', quiet(page) and page.locator('.wordmark').is_visible() and not page.locator('#balance').is_visible() and not page.locator('#q-name').is_visible())
        check('Idle does not scroll or overflow horizontally', page.evaluate('document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight'))
        check('All gestures have accessible alternative controls', page.get_by_role('button', name='Aggiungi una spesa', exact=True).count() == 1 and page.get_by_role('button', name='Mostra i tuoi dati', exact=True).count() == 1 and page.get_by_role('button', name='Detta una spesa', exact=True).count() == 1)
        page.screenshot(path=str(OUT / 'iphone-home.png'), scale='css')

        tap_home(page)
        check('A real touch opens exactly one manual popup', page.locator('dialog[open]').count() == 1 and page.locator('#quick-sheet').is_visible())
        check('Manual entry keeps the keyboard closed and defaults to today', page.locator('#quick-title').evaluate('(e)=>document.activeElement===e') and page.locator('#q-date').input_value() == '2026-10-27')
        check('Only name amount and date are initially exposed', not page.locator('#quick-details').is_visible() and page.locator('#q-name').is_visible() and page.locator('#q-amount').is_visible() and page.locator('#q-date').is_visible())
        page.locator('#q-name').fill('Caffè')
        page.locator('#q-name').press('Enter')
        check('The keyboard Next action moves from name to amount', page.locator('#q-amount').evaluate('(e)=>document.activeElement===e') and page.locator('#quick-sheet').is_visible())
        page.locator('#q-amount').fill('1,50')
        page.wait_for_timeout(350)
        page.screenshot(path=str(OUT / 'iphone-expense.png'), scale='css')
        page.locator('#quick-save').click()
        page.locator('#quick-sheet[open]').wait_for(state='detached')
        check('One submit saves the inferred expense and returns home', quiet(page) and len(state(page)['transactions']) == 1 and state(page)['transactions'][0]['category'] == 'Mangiare fuori' and state(page)['transactions'][0]['amountCents'] == 150)
        page.locator('#toast button').click()
        check('Undo restores the previous archive', len(state(page)['transactions']) == 0)
        quick(page, 'Supermercato', '32,40')
        page.locator('#quick-sheet[open]').wait_for(state='detached')
        page.reload()
        check('Saved data survive reload without appearing on idle', len(state(page)['transactions']) == 1 and quiet(page) and not page.locator('#balance').is_visible())

        touch(page, [(180, 400), (186, 405)])
        page.locator('#quick-sheet[open]').wait_for()
        check('Small finger jitter still counts as a tap', page.locator('#quick-sheet').is_visible())
        close_sheet(page, 'quick')
        for name, points in [('Horizontal drag', [(180, 400), (230, 402), (280, 404)]), ('Downward swipe', [(180, 300), (182, 380), (184, 470)])]:
            touch(page, points)
            page.wait_for_timeout(510)
            check(name + ' opens neither voice nor manual input', quiet(page))
        touch(page, [(180, 400)], cancel=True)
        page.wait_for_timeout(510)
        check('Cancelled touch never triggers delayed hold or tap', quiet(page))
        page.locator('#touch-surface').dispatch_event('pointerdown', {'pointerId': 99, 'pointerType': 'touch', 'isPrimary': True, 'button': 0, 'clientX': 180, 'clientY': 400})
        page.locator('#touch-surface').dispatch_event('pointerdown', {'pointerId': 100, 'pointerType': 'touch', 'isPrimary': False, 'button': 0, 'clientX': 220, 'clientY': 400})
        page.wait_for_timeout(510)
        page.locator('#touch-surface').dispatch_event('pointerup', {'pointerId': 99, 'pointerType': 'touch', 'isPrimary': True, 'button': 0, 'clientX': 180, 'clientY': 400})
        check('A second finger cancels gesture recognition', quiet(page))

        swipe_up(page)
        check('Upward swipe reveals data without adding or recording', page.locator('#data-sheet').is_visible() and not page.locator('#quick-sheet').is_visible() and not page.locator('#voice-sheet').is_visible())
        check('Drawer exposes only the selected data view', page.locator('#view-home').is_visible() and not page.locator('#view-history').is_visible() and not page.locator('#view-plan').is_visible())
        page.screenshot(path=str(OUT / 'iphone-data.png'), scale='css')
        page.locator('.nav [data-go=history]').click()
        check('Movement tab lists saved expenses', page.locator('#view-history').is_visible() and page.locator('#all-transactions .row').count() == 1)
        page.locator('#all-transactions .row').click()
        check('Movement opens an editable modal above the drawer', page.locator('#editor').is_visible() and page.locator('[data-field=note]').input_value() == 'Supermercato')
        page.locator('[data-field=amount]').fill('35')
        page.locator('#save-drafts').click()
        page.locator('#editor[open]').wait_for(state='detached')
        check('Editing updates rather than duplicates a movement', len(state(page)['transactions']) == 1 and state(page)['transactions'][0]['amountCents'] == 3500)
        page.locator('.nav [data-go=plan]').click()
        page.locator('#new-recurring').click()
        page.locator('#r-name').fill('Netflix')
        page.locator('#r-amount').fill('13,99')
        page.locator('#r-date').fill('2026-11-01')
        page.locator('#rec-form button[type=submit]').click()
        page.locator('#rec-editor[open]').wait_for(state='detached')
        check('Recurring expenses remain configurable from the plan', len(state(page)['recurring']) == 1 and state(page)['recurring'][0]['amountCents'] == 1399)
        page.locator('#data-settings').click()
        check('Settings are available inside the drawer', page.locator('#view-settings').is_visible())
        page.locator('#s-budget').fill('1000')
        page.locator('#s-salary').fill('2000')
        page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
        check('Returning to the app preserves an unsaved settings draft', page.locator('#s-budget').input_value() == '1000' and page.locator('#s-salary').input_value() == '2000')
        page.locator('#settings-form button[type=submit]').click()
        check('Budget and expected salary save without a payment', state(page)['settings']['budgetCents'] == 100000 and state(page)['settings']['salaryCents'] == 200000 and len(state(page)['transactions']) == 1)
        scroll = page.locator('#data-scroll')
        box = scroll.bounding_box()
        touch(page, [(box['x'] + 160, box['y'] + 190), (box['x'] + 160, box['y'] + 110), (box['x'] + 160, box['y'] + 35)])
        check('Scrolling content keeps the data sheet open', page.locator('#data-sheet').is_visible() and scroll.evaluate('(e)=>e.scrollTop') > 0)
        disclose(page, 'Backup e trasferimento')
        with page.expect_download() as download:
            page.locator('#export-json').click()
        backup = json.loads(Path(download.value.path()).read_text())
        check('Backup exports the actual saved archive', len(backup['transactions']) == 1 and len(backup['recurring']) == 1)
        page.evaluate("""() => {
          window.originalUA=navigator.userAgent;
          Object.defineProperty(navigator,'userAgent',{configurable:true,value:'iPhone test browser'});
          Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});
          Object.defineProperty(navigator,'share',{configurable:true,value:()=>new Promise(resolve=>window.resolveShare=resolve)});
        }""")
        page.locator('#export-json').click()
        page.wait_for_function("typeof window.resolveShare==='function'")
        concurrent = context.new_page()
        ready(concurrent)
        quick(concurrent, 'Spesa durante backup', '7')
        concurrent.locator('#quick-sheet[open]').wait_for(state='detached')
        page.wait_for_function("JSON.parse(localStorage.getItem('mymoney-local-v2')).transactions.some(t=>t.note==='Spesa durante backup')")
        page.evaluate('() => {window.resolveShare()}')
        page.wait_for_timeout(120)
        check('Completing a delayed share preserves concurrent changes', len(state(page)['transactions']) == 2 and any(t['note'] == 'Spesa durante backup' for t in state(page)['transactions']))
        concurrent.close()
        page.evaluate("() => {Object.defineProperty(navigator,'userAgent',{configurable:true,value:window.originalUA});delete navigator.canShare;delete navigator.share}")
        page.locator('.nav [data-go=home]').click()
        handle = page.locator('#data-drag-handle').bounding_box()
        touch(page, [(195, handle['y'] + 18), (195, handle['y'] + 66), (195, handle['y'] + 140)])
        page.locator('#data-sheet[open]').wait_for(state='detached')
        check('Dragging the sheet handle down returns to the quiet home', quiet(page))

        tap_home(page)
        before = state(page)
        quick(page, 'Importo errato', '1,234', already_open=True)
        check('Invalid money retains the draft and cannot partially save', state(page) == before and page.locator('#quick-error').is_visible() and page.locator('#q-name').input_value() == 'Importo errato')
        page.evaluate("() => {window.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('Full','QuotaExceededError')}}")
        quick(page, 'Errore spazio', '10', already_open=True)
        check('Storage failure keeps the form and saved data intact', state(page) == before and page.locator('#quick-sheet').is_visible() and 'salvataggio' in page.locator('#quick-error').inner_text().lower())
        page.evaluate('() => {Storage.prototype.setItem=window.originalSetItem}')
        close_sheet(page, 'quick')

        # The mock validates lifecycle handling, not browser transcription quality.
        voice = context.new_page()
        voice.add_init_script(FAKE_SPEECH)
        ready(voice)
        hold_home(voice)
        check('First long press immediately starts one voice session', not voice.locator('#voice-consent').is_visible() and voice.evaluate('speechSessions.length') == 1 and voice.locator('#mic').get_attribute('aria-pressed') == 'true')
        voice.evaluate("emitSpeech(testRecognition,'Imposta budget a 1400 euro')")
        check('Final speech produces a reviewable proposal before mutation', voice.locator('#command-preview').is_visible() and state(voice)['settings']['budgetCents'] == 100000)
        voice.locator('#command-save').click()
        voice.locator('#voice-sheet[open]').wait_for(state='detached')
        check('Confirming speech applies the command and closes the modal', state(voice)['settings']['budgetCents'] == 140000 and quiet(voice))
        hold_home(voice)
        check('A later long press immediately starts listening once', voice.evaluate('speechSessions.length') == 2 and voice.locator('#mic').get_attribute('aria-pressed') == 'true' and not voice.locator('#quick-sheet').is_visible())
        voice.evaluate("testRecognition.onerror({error:'not-allowed'});testRecognition.onend()")
        check('Denied microphone recovers into usable text input', voice.locator('#natural').is_visible() and voice.locator('#mic').get_attribute('aria-pressed') == 'false' and 'autorizzato' in voice.locator('#voice-status').inner_text())
        close_sheet(voice, 'voice')
        hold_home(voice)
        voice.evaluate('window.oldRecognition=testRecognition')
        close_sheet(voice, 'voice')
        voice.evaluate("emitSpeech(oldRecognition,'Imposta budget a 9999 euro')")
        check('Late results after closing cannot reopen or save a proposal', quiet(voice) and state(voice)['settings']['budgetCents'] == 140000)
        hold_home(voice)
        voice.evaluate("oldRecognition.onend?.();oldRecognition.onerror?.({error:'network'})")
        check('Old callbacks cannot stop a newer voice session', voice.locator('#mic').get_attribute('aria-pressed') == 'true')
        voice.evaluate("emitSpeech(testRecognition,'Questo mese stipendio 2200 euro')")
        voice.locator('#command-save').click()
        voice.locator('#voice-sheet[open]').wait_for(state='detached')
        check('Voice salary creates the actual income without changing the forecast', state(voice)['settings']['salaryCents'] == 200000 and any(t['amountCents'] == 220000 and t['type'] == 'income' for t in state(voice)['transactions']))
        hold_home(voice)
        voice.evaluate("window.dispatchEvent(new Event('blur'))")
        check('Permission prompt blur keeps the microphone active', voice.evaluate('testRecognition.wasAborted!==true') and voice.locator('#mic').get_attribute('aria-pressed') == 'true')
        close_sheet(voice, 'voice')
        voice.close()

        fallback = context.new_page()
        fallback.add_init_script('window.SpeechRecognition=undefined;window.webkitSpeechRecognition=undefined;')
        ready(fallback)
        hold_home(fallback)
        check('Unavailable speech exposes a typed fallback', fallback.locator('#natural').is_visible() and fallback.locator('#voice-status').inner_text())
        fallback.locator('#natural').fill('Ho ricevuto la tredicesima di 1500 euro')
        fallback.locator('#interpret').click()
        fallback.locator('#command-save').click()
        fallback.locator('#voice-sheet[open]').wait_for(state='detached')
        check('Typed natural-language fallback records the thirteenth salary', any(t['amountCents'] == 150000 and t['type'] == 'income' for t in state(fallback)['transactions']))
        fallback.close()

        # Make the underlying origin update arrive before responsive checks.
        page.reload()
        for width, height in [(320, 568), (375, 667), (390, 844), (430, 932)]:
            page.set_viewport_size({'width': width, 'height': height})
            tap_home(page)
            check(f'Manual popup fits {width}x{height} iPhone viewport', page.evaluate('document.documentElement.scrollWidth<=innerWidth') and page.locator('#quick-sheet').bounding_box()['width'] <= width)
            check(f'Save stays reachable at {width}x{height}', page.locator('#quick-save').bounding_box()['y'] + page.locator('#quick-save').bounding_box()['height'] <= height + 1)
            close_sheet(page, 'quick')
            swipe_up(page)
            check(f'Data panel fits {width}x{height} without page overflow', page.evaluate('document.documentElement.scrollWidth<=innerWidth') and page.locator('#data-sheet').bounding_box()['width'] <= width)
            close_sheet(page, 'data')
        page.set_viewport_size({'width': 390, 'height': 844})
        tap_home(page)
        page.evaluate("Object.defineProperty(visualViewport,'height',{configurable:true,value:360});Object.defineProperty(visualViewport,'offsetTop',{configurable:true,value:0});visualViewport.dispatchEvent(new Event('resize'))")
        check('Visual viewport resize keeps the modal above the keyboard', page.locator('#quick-sheet').bounding_box()['y'] >= 0 and page.locator('#quick-save').bounding_box()['y'] + page.locator('#quick-save').bounding_box()['height'] <= 361)
        page.evaluate("delete visualViewport.height;delete visualViewport.offsetTop;visualViewport.dispatchEvent(new Event('resize'))")
        close_sheet(page, 'quick')
        page.locator('#touch-surface').focus()
        page.keyboard.press('Enter')
        page.locator('#quick-sheet[open]').wait_for()
        check('Keyboard activation is equivalent to a single tap', page.locator('#q-name').evaluate('(e)=>document.activeElement===e'))
        page.keyboard.press('Escape')
        page.locator('#quick-sheet[open]').wait_for(state='detached')
        page.locator('#touch-surface').focus()
        page.keyboard.press('ArrowUp')
        page.locator('#data-sheet[open]').wait_for()
        check('Keyboard alternative opens data and Escape dismisses it', page.locator('#data-sheet').is_visible())
        page.keyboard.press('Escape')
        page.locator('#data-sheet[open]').wait_for(state='detached')
        page.emulate_media(reduced_motion='reduce')
        tap_home(page)
        check('Reduced motion removes sheet animation', page.locator('#quick-sheet').evaluate('(e)=>getComputedStyle(e).animationName') == 'none')
        close_sheet(page, 'quick')

        page.evaluate('navigator.serviceWorker.ready')
        page.reload()
        page.wait_for_function('navigator.serviceWorker.controller!==null')
        context.set_offline(True)
        page.reload()
        check('The quiet app shell reloads offline', page.locator('#touch-surface').is_visible() and quiet(page))
        quick(page, 'Spesa offline', '4')
        page.locator('#quick-sheet[open]').wait_for(state='detached')
        check('Offline expense persists', state(page)['transactions'][-1]['note'] == 'Spesa offline')
        context.set_offline(False)
        check('Private seed is not exposed by the public server', page.request.get(URL + 'Dati_iniziali_PRIVATI.json').status == 404)
        check('No uncaught application exceptions', not errors)
        browser.close()
finally:
    server.shutdown()
    details = '\n'.join('PASS ' + name for name in checks)
    if errors:
        details += '\nBrowser errors:\n' + '\n'.join(errors)
    details += f'\n\n{len(checks)} checks completed. Chromium mobile emulation and synthetic speech adapter; physical iPhone, Safari keyboard, and real microphone not certified.\n'
    (OUT / 'iphone-results.txt').write_text(details)

print(f'\n{len(checks)} iPhone browser checks passed.')
