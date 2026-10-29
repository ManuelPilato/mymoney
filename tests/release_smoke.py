"""Small visual-release smoke test. Browser state and artifacts stay in /tmp.

Run: /tmp/mymoney-test-env/bin/python tests/release_smoke.py
Chrome emulation does not certify physical iPhone Safari, keyboard or microphone.
"""
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import json
import os
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path('/tmp/mymoney-release')
OUT.mkdir(parents=True, exist_ok=True)
KEY = 'mymoney-local-v2'
checks, errors, failed_requests = [], [], []


class AppOnlyHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def translate_path(self, path):
        # Exercise the same relative asset URLs and worker scope as GitHub Pages.
        if path.startswith('/mymoney/'):
            path = path[len('/mymoney'):]
        return super().translate_path(path)


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(AppOnlyHandler, directory=str(ROOT / 'app')))
Thread(target=server.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{server.server_port}/mymoney/'


def check(name, condition):
    assert condition, name
    checks.append(name)
    print('PASS', name, flush=True)


def state(page):
    return page.evaluate(f"JSON.parse(localStorage.getItem('{KEY}'))")


def idle(page):
    return page.locator('dialog[open]').count() == 0


def in_view(page, selector, inset=0):
    box = page.locator(selector).bounding_box()
    size = page.viewport_size
    return bool(box and box['x'] >= inset - 1 and box['y'] >= inset - 1 and
                box['x'] + box['width'] <= size['width'] - inset + 1 and
                box['y'] + box['height'] <= size['height'] - inset + 1)


def centered(page, selector):
    box = page.locator(selector).bounding_box()
    size = page.viewport_size
    return in_view(page, selector, 16) and abs(box['x'] + box['width'] / 2 - size['width'] / 2) < 3 and abs(box['y'] + box['height'] / 2 - size['height'] / 2) < 3


def settled(page, selector):
    page.locator(selector + '[open]').wait_for()
    page.locator(selector).evaluate('(e)=>Promise.all(e.getAnimations().map(a=>a.finished.catch(()=>{})))')


def close(page, selector, button):
    page.locator(button).click()
    page.locator(selector + '[open]').wait_for(state='detached')


def touch(page, points, hold=0):
    cdp = page.context.new_cdp_session(page)
    try:
        for index, (x, y) in enumerate(points):
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart' if index == 0 else 'touchMove',
                     'touchPoints': [{'x': x, 'y': y, 'id': 1}]})
            if len(points) > 1:
                page.wait_for_timeout(25)
        if hold:
            page.wait_for_timeout(hold)
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    finally:
        cdp.detach()


FAKE_SPEECH = """
class SmokeSpeech {
  start(){window.smokeSpeech=this;this.onstart?.();}
  stop(){this.onend?.();}
  abort(){this.aborted=true;this.onerror?.({error:'aborted'});this.onend?.();}
}
window.SpeechRecognition=window.webkitSpeechRecognition=SmokeSpeech;
"""


def ready(context):
    context.add_init_script(FAKE_SPEECH)
    page = context.new_page()
    page.set_default_timeout(7000)
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('response', lambda response: failed_requests.append(f'{response.status} {urlsplit(response.url).path}')
            if response.status >= 400 and response.url.startswith(URL) else None)
    page.clock.set_fixed_time(datetime(2026, 10, 27, 15, tzinfo=timezone.utc))
    page.goto(URL)
    page.wait_for_function('window.MMUI && window.MM && document.documentElement.dataset.scene')
    return page


try:
    with sync_playwright() as p:
        chrome = os.environ.get('MYMONEY_TEST_BROWSER', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
        browser = p.chromium.launch(headless=True, executable_path=chrome)
        common = dict(locale='it-IT', timezone_id='Europe/Rome', device_scale_factor=1)
        phone = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, **common)
        page = ready(phone)
        check('iPhone starts with the wordmark, hidden financial panels and no horizontal overflow', idle(page) and
              page.locator('.wordmark').is_visible() and not page.locator('#balance').is_visible() and
              page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        page.screenshot(path=str(OUT / 'iphone-home.png'), scale='css')

        touch(page, [(195, 380)])
        settled(page, '#quick-sheet')
        check('Tap opens one popup, focuses name and shows only three essential fields',
              page.locator('dialog[open]').count() == 1 and page.locator('#q-name').evaluate('(e)=>document.activeElement===e') and
              page.locator('#q-date').input_value() == '2026-10-27' and not page.locator('#quick-details').is_visible() and
              all(page.locator(selector).is_visible() for selector in ['#q-name', '#q-amount', '#q-date']))
        page.locator('#q-name').fill('Caffè')
        page.locator('#q-amount').fill('1,50')
        check('iPhone popup and save action fit inside the viewport', in_view(page, '#quick-sheet') and in_view(page, '#quick-save'))
        page.screenshot(path=str(OUT / 'iphone-quick.png'), scale='css')
        page.locator('#quick-save').click()
        page.locator('#quick-sheet[open]').wait_for(state='detached')
        saved = state(page)['transactions']
        check('Submit saves one correctly inferred expense and returns to the home screen', idle(page) and len(saved) == 1 and
              saved[0]['amountCents'] == 150 and saved[0]['category'] == 'Mangiare fuori')
        page.reload()
        check('Expense persists across reload while financial data stay hidden', idle(page) and
              len(state(page)['transactions']) == 1 and not page.locator('#balance').is_visible())

        touch(page, [(195, 680), (195, 610), (195, 480), (195, 350)])
        settled(page, '#data-sheet')
        check('Swipe up opens only the data panel within the phone viewport', page.locator('dialog[open]').count() == 1 and in_view(page, '#data-sheet'))
        page.locator('.nav [data-go=history]').click()
        page.locator('#all-transactions .row').click()
        settled(page, '#editor')
        check('Existing movement opens in a usable editor above the data panel', page.locator('[data-field=note]').input_value() == 'Caffè' and
              in_view(page, '#editor') and in_view(page, '#save-drafts'))
        page.locator('[data-field=amount]').fill('2,50')
        page.locator('#save-drafts').click()
        page.locator('#editor[open]').wait_for(state='detached')
        check('Editing updates the movement without duplication', len(state(page)['transactions']) == 1 and state(page)['transactions'][0]['amountCents'] == 250)
        close(page, '#data-sheet', '#close-data')
        touch(page, [(195, 380)])
        settled(page, '#quick-sheet')
        page.set_viewport_size({'width': 390, 'height': 480})
        page.locator('#q-amount').focus()
        page.wait_for_timeout(100)
        page.locator('#quick-save').scroll_into_view_if_needed()
        check('Short keyboard-sized viewport keeps the primary action reachable without horizontal overflow',
              in_view(page, '#quick-save') and page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        page.set_viewport_size({'width': 390, 'height': 844})
        close(page, '#quick-sheet', '#close-quick')
        page.evaluate("localStorage.setItem('mymoney-voice-consent','yes')")
        touch(page, [(195, 380)], hold=530)
        settled(page, '#voice-sheet')
        started = page.evaluate('!!window.smokeSpeech')
        close(page, '#voice-sheet', '#close-voice')
        check('Long press starts simulated speech and closing cancels it without reopening another popup',
              started and page.evaluate('window.smokeSpeech.aborted===true') and idle(page))

        desktop = browser.new_context(viewport={'width': 1440, 'height': 900}, **common)
        mac = ready(desktop)
        check('Mac exposes its compact three-action dock with no page overflow',
              all(mac.locator(selector).is_visible() for selector in ['#desktop-add', '#desktop-voice', '#desktop-data']) and
              mac.evaluate('document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight'))
        mac.locator('#desktop-add').click()
        settled(mac, '#quick-sheet')
        mac.locator('#q-name').fill('Treno')
        mac.locator('#q-amount').fill('12,40')
        check('Mac manual popup is centered and keeps focus and primary action accessible', centered(mac, '#quick-sheet') and in_view(mac, '#quick-save'))
        mac.screenshot(path=str(OUT / 'mac-quick.png'), scale='css')
        mac.locator('#quick-save').click()
        mac.locator('#quick-sheet[open]').wait_for(state='detached')
        mac.keyboard.press('Meta+k')
        settled(mac, '#quick-sheet')
        check('Cmd+K opens manual entry; saved desktop data remain intact',
              mac.locator('#q-name').evaluate('(e)=>document.activeElement===e') and state(mac)['transactions'][0]['amountCents'] == 1240)
        mac.keyboard.press('Escape')
        mac.locator('#quick-sheet[open]').wait_for(state='detached')
        check('Escape dismisses the popup and restores the home scene', idle(mac) and mac.evaluate('document.documentElement.dataset.scene') == 'idle')
        mac.locator('#desktop-data').click()
        settled(mac, '#data-sheet')
        check('Mac data panel is centered, bounded and displays the saved movement', centered(mac, '#data-sheet') and mac.locator('#recent .row').count() == 1)
        mac.screenshot(path=str(OUT / 'mac-data.png'), scale='css')
        close(mac, '#data-sheet', '#close-data')
        mac.locator('#desktop-voice').click()
        settled(mac, '#voice-sheet')
        check('Mac voice action opens a centered popup with a usable typed fallback', centered(mac, '#voice-sheet') and
              (mac.locator('#voice-write').is_visible() or mac.locator('#natural').is_visible()))
        close(mac, '#voice-sheet', '#close-voice')

        worker_scope = mac.evaluate('navigator.serviceWorker.ready.then(r=>r.scope)')
        manifest = mac.evaluate("fetch('manifest.webmanifest').then(r=>r.json())")
        check('Published subpath resolves the manifest and scopes offline assets to /mymoney/',
              worker_scope.endswith('/mymoney/') and manifest.get('start_url') in ('./', '.', './index.html'))
        check('Both journeys finish without JavaScript errors or failed public assets', not errors and not failed_requests)
        browser.close()
finally:
    server.shutdown()
    report = {'passed': len(checks), 'checks': checks, 'javascript_errors': errors, 'failed_requests': failed_requests,
              'artifacts': str(OUT), 'scope': 'Chrome viewport emulation; speech mocked; no physical Safari or microphone certification.'}
    (OUT / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(f'{len(checks)}/18 essential checks passed. Report: {OUT / "results.json"}', flush=True)
