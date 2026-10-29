"""Focused two-device sync checks against local Firebase emulators only.

Requires Authentication on 127.0.0.1:9099 and Firestore on 127.0.0.1:8088,
with the project's rules loaded for demo-mymoney. Run after python3 build.py:
  /tmp/mymoney-test-env/bin/python tests/sync_browser_test.py

The test SDK replaces the Google popup with an emulator-only synthetic Google
credential. Production sources and app files are never changed. No real account,
financial data, Firebase project or external network is used.
"""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import urlopen
import json
import os
import re
import subprocess
import time

from playwright.sync_api import sync_playwright, expect


ROOT = Path(__file__).resolve().parents[1]
PROJECT = 'demo-mymoney'
AUTH = 'http://127.0.0.1:9099'
FIRESTORE = 'http://127.0.0.1:8088'
KEY = 'mymoney-local-v2'
OUT = Path('/private/tmp/mymoney-sync-browser')
OUT.mkdir(parents=True, exist_ok=True)
checks, page_errors, external_requests = [], [], []
USER = f'browser-alice-{time.time_ns()}'
OTHER_USER = f'browser-bob-{time.time_ns()}'


def check(name, condition=True):
    assert condition, name
    checks.append(name)
    print('PASS', name, flush=True)


def emulator_ready(origin):
    try:
        urlopen(origin, timeout=3).close()
    except HTTPError:
        pass  # A responding emulator need not expose a root page.


def test_sdk(output):
    # Preserve the production SDK exports, replacing just the connection and
    # sign-in entry points. The resulting bundle exists only in a temp folder.
    entry = (ROOT / 'src/firebase-sdk-entry.js').read_text()
    for name in ['getAuth', 'getFirestore', 'signInWithPopup']:
        entry = re.sub(r'\b' + name + r'\s*,\s*', '', entry)
    entry += r'''
import { getAuth as productionGetAuth, connectAuthEmulator,
  signInWithCredential, GoogleAuthProvider as TestGoogle } from 'firebase/auth';
import { getFirestore as productionGetFirestore, connectFirestoreEmulator }
  from 'firebase/firestore';
const auths = new WeakSet(), stores = new WeakSet();
export function getAuth(app) {
  const auth = productionGetAuth(app);
  if (!auths.has(auth)) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', {disableWarnings:true});
    auths.add(auth);
  }
  return auth;
}
export function getFirestore(app) {
  const store = productionGetFirestore(app);
  if (!stores.has(store)) {
    connectFirestoreEmulator(store, '127.0.0.1', 8088);
    stores.add(store);
  }
  return store;
}
export async function signInWithPopup(auth) {
  const subject = window.__syncTestUser;
  if (!subject?.startsWith('browser-')) throw Error('Synthetic test user required');
  const now = Math.floor(Date.now()/1000);
  const b64 = value => btoa(JSON.stringify(value)).replace(/=/g,'')
    .replace(/\+/g,'-').replace(/\//g,'_');
  const credential = b64({alg:'none',typ:'JWT'}) + '.' + b64({
    iss:'https://accounts.google.com',aud:'test-google-client',sub:subject,
    email:subject+'@example.test',email_verified:true,name:'Sync test user',
    iat:now,exp:now+3600
  }) + '.';
  return signInWithCredential(auth, TestGoogle.credential(credential));
}
'''
    build = """const fs=require('fs');require('esbuild').buildSync({
      stdin:{contents:fs.readFileSync(0,'utf8'),resolveDir:process.cwd(),loader:'js'},
      bundle:true,format:'esm',target:'safari16',minify:true,
      outfile:process.argv[1],logLevel:'silent'});"""
    subprocess.run(['node', '-e', build, str(output)], input=entry, text=True,
                   cwd=ROOT, check=True)


def state(page):
    return page.evaluate('(key)=>JSON.parse(localStorage.getItem(key))', KEY)


def until(predicate, message, timeout=20):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(.1)
    raise AssertionError(message)


def settled(page, selector):
    page.locator(selector + '[open]').wait_for()
    page.locator(selector).evaluate(
        '(e)=>Promise.all(e.getAnimations().map(a=>a.finished.catch(()=>{})))')


def close_data(page):
    if page.locator('#data-sheet').get_attribute('open') is not None:
        page.locator('#close-data').click()
        page.locator('#data-sheet[open]').wait_for(state='detached')


def data_view(page, view):
    if page.locator('#data-sheet').get_attribute('open') is None:
        page.locator('#open-data' if page.viewport_size['width'] < 900 else '#desktop-data').click()
        settled(page, '#data-sheet')
    page.locator('#data-settings' if view == 'settings' else f'.nav [data-go="{view}"]').click()
    page.locator(f'#view-{view}').wait_for(state='visible')


def expense(page, name, amount):
    close_data(page)
    page.locator('#touch-surface' if page.viewport_size['width'] < 900 else '#desktop-add').click()
    settled(page, '#quick-sheet')
    page.locator('#q-name').fill(name)
    page.locator('#q-amount').fill(amount)
    page.locator('#quick-save').click()
    page.locator('#quick-sheet[open]').wait_for(state='detached')


def edit_expense(page, name, amount):
    data_view(page, 'history')
    page.locator('#all-transactions .row').filter(has_text=name).click()
    settled(page, '#editor')
    page.locator('[data-field=amount]').fill(amount)
    page.locator('#save-drafts').click()
    page.locator('#editor[open]').wait_for(state='detached')


def wait_transaction(page, name, cents=None, absent=False):
    def matches():
        tx = next((t for t in (state(page) or {}).get('transactions', []) if t['note'] == name), None)
        return not tx if absent else bool(tx and (cents is None or tx['amountCents'] == cents))
    until(matches, f'Transaction did not converge: {name}, cents={cents}, absent={absent}')


def wait_synced(page):
    try:
        expect(page.locator('#sync-status')).to_have_attribute('data-state', 'synced', timeout=20000)
    except Exception:
        print('SYNC DIAGNOSTIC', page.locator('.sync-settings').inner_text(), page_errors, flush=True)
        raise


def login(page, require_merge=False):
    data_view(page, 'settings')
    page.locator('#sync-connect').click()
    if require_merge:
        page.locator('#sync-import').wait_for(state='visible')
        check('First connection asks before uploading the existing local archive')
        page.locator('#sync-import-merge').click()
    else:
        until(lambda: page.locator('#sync-import').is_visible() or
              page.locator('#sync-status').get_attribute('data-state') == 'synced', 'Sign-in did not complete')
        if page.locator('#sync-import').is_visible():
            page.locator('#sync-import-cloud').click()
    wait_synced(page)


def prepare(context, url):
    context.add_init_script('window.__syncTestUser=' + json.dumps(USER))
    page = context.new_page()
    page.set_default_timeout(20000)
    page.on('pageerror', lambda error: page_errors.append(str(error)))
    page.on('dialog', lambda dialog: dialog.accept())
    page.goto(url)
    until(lambda: page.evaluate('()=>!!(window.MM && window.MMUI && window.MMSync)'), 'App did not initialize')
    page.evaluate('()=>navigator.serviceWorker.ready')
    until(lambda: page.evaluate('()=>!!navigator.serviceWorker.controller'), 'Offline shell did not activate')
    return page


def main():
    emulator_ready(AUTH)
    emulator_ready(FIRESTORE)
    with TemporaryDirectory(prefix='mymoney-sync-test-') as temp:
        temp = Path(temp)
        test_sdk(temp / 'firebase-sdk.js')
        html = (ROOT / 'app/index.html').read_text()
        assert '/*__SYNC__*/' not in html, 'Run python3 build.py before the test'
        config = dict(apiKey='fake-emulator-api-key', projectId=PROJECT,
                      authDomain=PROJECT + '.firebaseapp.com', appId='1:123:web:sync-test')
        html, count = re.subn(r'window\.MM_FIREBASE_CONFIG\s*=\s*[^;]+;',
                             'window.MM_FIREBASE_CONFIG = ' + json.dumps(config) + ';', html, count=1)
        assert count == 1, 'Firebase config must be present exactly once'
        html = html.replace("connect-src 'self'", "connect-src 'self' " + AUTH + ' ' + FIRESTORE)
        (temp / 'index.html').write_text(html)

        class TestHandler(SimpleHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def translate_path(self, path):
                name = urlsplit(path).path.removeprefix('/mymoney/').lstrip('/')
                if name in ['', 'index.html']:
                    return str(temp / 'index.html')
                if name == 'firebase-sdk.js':
                    return str(temp / name)
                # Public release files only. Never expose the project/private seed.
                if name in ['sw.js', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png']:
                    return str(ROOT / 'app' / name)
                return str(temp / 'missing')

        server = ThreadingHTTPServer(('127.0.0.1', 0), TestHandler)
        Thread(target=server.serve_forever, daemon=True).start()
        url = f'http://127.0.0.1:{server.server_port}/mymoney/'
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True, executable_path=os.environ.get(
                    'MYMONEY_TEST_BROWSER', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'))
                common = dict(locale='it-IT', timezone_id='Europe/Rome')
                phone_context = browser.new_context(viewport={'width':390,'height':844},
                                                    is_mobile=True, has_touch=True, **common)
                mac_context = browser.new_context(viewport={'width':1440,'height':900}, **common)
                for context in [phone_context, mac_context]:
                    # Requests to anything except localhost are rejected and recorded.
                    def guard(route):
                        host = urlsplit(route.request.url).hostname
                        if host not in ['127.0.0.1', 'localhost']:
                            external_requests.append(route.request.url)
                            route.abort()
                        else:
                            route.continue_()
                    context.route('**/*', guard)
                phone, mac = prepare(phone_context, url), prepare(mac_context, url)
                expense(phone, 'Caffè test sync', '1,50')
                login(phone, require_merge=True)
                login(mac)
                wait_transaction(mac, 'Caffè test sync', 150)
                check('Same Google identity opens the same archive in two isolated browser contexts')

                expense(phone, 'Treno test sync', '12,40')
                wait_transaction(mac, 'Treno test sync', 1240)
                check('An iPhone expense reaches the Mac without a reload')

                data_view(phone, 'settings')
                phone.locator('#s-salary').fill('2450')
                phone.locator('#s-budget').fill('900')
                phone.locator('#settings-form button[type=submit]').click()
                until(lambda: state(mac)['settings']['salaryCents'] == 245000, 'Salary did not sync')
                check('Salary and budget settings propagate between devices', state(mac)['settings']['budgetCents'] == 90000)

                data_view(mac, 'settings')
                mac.locator('#s-salary').fill('3000')
                phone.locator('#s-budget').fill('1100')
                phone.locator('#settings-form button[type=submit]').click()
                until(lambda: state(mac)['settings']['budgetCents'] == 110000, 'Remote settings did not reach the dirty form')
                assert mac.locator('#s-salary').input_value() == '3000', 'A remote update erased an unsaved settings draft'
                mac.locator('#settings-form button[type=submit]').click()
                expect(mac.locator('#toast')).to_contain_text('I dati sono cambiati')
                check('A remote update preserves an unsaved settings draft and blocks stale submission',
                      state(mac)['settings']['salaryCents'] == 245000 and state(mac)['settings']['budgetCents'] == 110000)
                mac.reload()
                until(lambda: mac.evaluate('()=>!!(window.MM && window.MMSync)'), 'Mac app did not reinitialize')
                wait_synced(mac)

                wait_synced(phone)
                wait_synced(mac)
                phone_context.set_offline(True)
                expense(phone, 'Spesa offline test', '8,20')
                wait_transaction(phone, 'Spesa offline test', 820)
                phone.reload()
                until(lambda: phone.evaluate('()=>!!(window.MM && window.MMSync)'), 'Offline app did not initialize')
                wait_transaction(phone, 'Spesa offline test', 820)
                check('An offline write survives a full reload of the installed shell')
                phone_context.set_offline(False)
                wait_transaction(mac, 'Spesa offline test', 820)
                wait_synced(phone)
                check('Reconnecting flushes the persisted queue without duplicating the expense',
                      len([t for t in state(mac)['transactions'] if t['note'] == 'Spesa offline test']) == 1)

                wait_synced(mac)
                mac_context.set_offline(True)
                edit_expense(mac, 'Caffè test sync', '2,00')
                edit_expense(phone, 'Caffè test sync', '3,00')
                wait_synced(phone)
                mac_context.set_offline(False)
                data_view(mac, 'settings')
                mac.locator('#sync-conflicts').wait_for(state='visible')
                check('Concurrent changes to the same expense require an explicit choice')
                mac.locator('#sync-use-local').click()
                wait_transaction(phone, 'Caffè test sync', 200)
                wait_synced(mac)
                check('Keeping the local conflict version converges on both devices')

                data_view(phone, 'history')
                phone.locator('#all-transactions .row').filter(has_text='Treno test sync').click()
                settled(phone, '#editor')
                phone.locator('#delete-transaction').click()
                phone.locator('#editor[open]').wait_for(state='detached')
                wait_transaction(mac, 'Treno test sync', absent=True)
                check('Deleting an expense syncs its deletion to the other device')

                data_view(mac, 'settings')
                wait_synced(mac)
                mac.locator('#sync-disconnect').click()
                mac.locator('#sync-connect').wait_for(state='visible')
                check('Signing out restores the isolated local archive',
                      not any(t['note'] == 'Caffè test sync' for t in (state(mac) or {}).get('transactions', [])))
                mac.evaluate('window.__syncTestUser=' + json.dumps(OTHER_USER))
                login(mac)
                check('A different account does not inherit the previous account’s records or settings',
                      not state(mac)['transactions'] and state(mac)['settings']['salaryCents'] == 0)

                # Both clients know an empty account before creating any remote
                # document. Identical default settings must not turn independent
                # first expenses into a user-visible conflict.
                data_view(phone, 'settings')
                wait_synced(phone)
                phone.locator('#sync-disconnect').click()
                phone.locator('#sync-connect').wait_for(state='visible')
                phone.evaluate('window.__syncTestUser=' + json.dumps(OTHER_USER))
                login(phone)
                assert not state(phone)['transactions'] and not state(mac)['transactions']
                phone_context.set_offline(True)
                mac_context.set_offline(True)
                expense(phone, 'Primo acquisto iPhone', '4,50')
                expense(mac, 'Primo acquisto Mac', '6,70')
                phone_context.set_offline(False)
                wait_synced(phone)
                mac_context.set_offline(False)
                wait_synced(mac)
                wait_transaction(phone, 'Primo acquisto Mac', 670)
                wait_transaction(mac, 'Primo acquisto iPhone', 450)
                check('Independent first expenses on an empty account converge without a false settings conflict',
                      len(state(phone)['transactions']) == 2 and len(state(mac)['transactions']) == 2)

                check('No application exceptions or external cloud requests occurred', not page_errors and not external_requests)
                data_view(phone, 'settings')
                phone.screenshot(path=str(OUT / 'iphone-synced.png'))
                mac.screenshot(path=str(OUT / 'mac-other-account.png'))
                browser.close()
        finally:
            server.shutdown()
    (OUT / 'results.json').write_text(json.dumps(dict(checks=checks, page_errors=page_errors,
        external_requests=external_requests), ensure_ascii=False, indent=2))
    print(f'{len(checks)} synchronization browser checks passed.', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        (OUT / 'results.json').write_text(json.dumps(dict(checks=checks,
            page_errors=page_errors, external_requests=external_requests,
            failure=str(error)), ensure_ascii=False, indent=2))
        raise
