"""Focused visual release check: 4K desktop and Retina mobile.

Run after ``python3 build.py`` with Python + Playwright installed:
    python3 tests/retina_browser_test.py
Uses CHROME_PATH, an installed Chrome/Chromium, or Playwright Chromium.
All data is synthetic in disposable storage; external requests are blocked.
Screenshots and audit.json go to ignored tests/artifacts/retina/.
This checks browser rendering, not physical iPhone/Safari or microphone behavior.
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import json
import os
import shutil

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tests" / "artifacts" / "retina"


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def chrome_path():
    explicit = os.environ.get("CHROME_PATH")
    if explicit:
        if not Path(explicit).is_file():
            raise FileNotFoundError(f"CHROME_PATH does not exist: {explicit}")
        return explicit
    for candidate in [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        shutil.which("google-chrome"), shutil.which("chromium"),
        shutil.which("chromium-browser"),
    ]:
        if candidate and Path(candidate).is_file():
            return candidate
    return None


SEED = """() => {
    const m=window.MM, state=m.blank(), today=m.today();
    Object.assign(state.settings,{initialized:true,openingDate:m.shiftDays(today,-7),
      openingBalanceCents:245000,salaryCents:180000,budgetCents:110000,
      savingsGoalCents:20000,separateSavingsCents:350000,payday:27});
    state.transactions=[['Spesa dimostrativa','Spesa',4250],
      ['Cena dimostrativa','Mangiare fuori',2800],['Trasporto dimostrativo','Trasporti',1800]]
      .map(([note,category,amountCents],i)=>({id:'visual-demo-'+i,note,category,amountCents,
        date:m.shiftDays(today,-i),type:'expense',status:'paid',includedInOpening:false,
        countBudget:true,recurringId:null,dueDate:null}));
    state.recurring=[['Casa dimostrativa','Casa',40000,1],
      ['Abbonamento dimostrativo','Abbonamenti',1200,1],
      ['Assicurazione dimostrativa','Assicurazioni',24000,6]]
      .map(([name,category,amountCents,months],i)=>({id:'visual-rec-'+i,name,category,
        amountCents,months,startDate:m.shiftDays(today,3+i*10),active:true,
        automatic:true,estimated:false}));
    state.notes=['Dati dimostrativi per la verifica grafica.'];
    localStorage.setItem('mymoney-local-v2',JSON.stringify(m.validate(state)));
    localStorage.setItem(window.MMSync.archiveKey(),JSON.stringify(state));
    localStorage.setItem('mymoney-language-v1','it');
    localStorage.setItem('mymoney-gestures-v1',JSON.stringify({manual:true,voice:true,data:true}));
}"""


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(ROOT / "app")))
    Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_port}/"
    records = []
    try:
        with sync_playwright() as p:
            executable = chrome_path()
            browser = p.chromium.launch(headless=True, **({"executable_path": executable} if executable else {}))
            for name, width, height, dpr, mobile in [
                ("desktop-4k", 1920, 1080, 2, False),
                ("mobile-retina", 440, 956, 3, True),
            ]:
                context = browser.new_context(viewport={"width": width, "height": height},
                    device_scale_factor=dpr, has_touch=mobile, is_mobile=mobile,
                    locale="it-IT", timezone_id="Europe/Rome", service_workers="block")
                context.route("**/*", lambda r: r.continue_() if r.request.url.startswith(url) else r.abort())
                page = context.new_page()
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.goto(url)
                page.wait_for_function("window.MM && window.MMUI && window.MyMoneyOrbit")
                page.evaluate(SEED)
                page.reload()
                page.wait_for_function("window.MMUI && window.MyMoneyOrbit")
                page.evaluate("async()=>{await document.fonts.ready}")

                def capture(view, selector=None):
                    # Tab changes chain exit and entry animations. A fixed sleep can
                    # catch the second phase on a slower software-rendered CI runner.
                    page.mouse.move(2, 2)
                    page.evaluate("""async selector => {
                      const root=selector?document.querySelector(selector):document.body;
                      const pending=()=>root.getAnimations({subtree:true}).filter(a=>
                        a.playState!=='finished' && a.playState!=='idle' &&
                        Number.isFinite(a.effect?.getComputedTiming().endTime));
                      for(let pass=0;pass<12;pass++){
                        await Promise.all(pending().map(a=>a.finished.catch(()=>{})));
                        // Finished callbacks can start a new animation in the chain.
                        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
                        if(!pending().length)return;
                      }
                      throw new Error('Panel motion did not settle before visual audit');
                    }""", selector)
                    report = page.evaluate("""selector => {
                      const root=selector?document.querySelector(selector):document.body;
                      const visible=e=>e.getClientRects().length && getComputedStyle(e).visibility!=='hidden';
                      const text=[...root.querySelectorAll('h1,h2,h3,p,label,button,input,select,textarea')].filter(visible);
                      const blurred=text.filter(e=>getComputedStyle(e).filter!=='none').map(e=>e.id||e.tagName);
                      const icons=[...root.querySelectorAll('[data-icon]')].filter(visible);
                      const panel=selector?getComputedStyle(root):null, rect=root.getBoundingClientRect();
                      const canvas=document.querySelector('#orb-canvas');
                      return {fonts:document.fonts.status,zoom:getComputedStyle(document.body).zoom,
                        blurred,missingSVG:icons.filter(e=>!e.querySelector('svg')).map(e=>e.dataset.icon),
                        rasterImages:root.querySelectorAll('img').length,iconCount:icons.length,
                        pageOverflow:document.documentElement.scrollWidth>innerWidth+1,
                        panelOverflow:selector?root.scrollWidth>root.clientWidth+1:false,
                        panelWidths:selector?{client:root.clientWidth,scroll:root.scrollWidth}:null,
                        contentTransform:root.querySelector('#data-scroll')?getComputedStyle(root.querySelector('#data-scroll')).transform:null,
                        panelOutside:selector?(rect.x < -1 || rect.right>innerWidth+1):false,
                        transform:panel?.transform||'none',willChange:panel?.willChange||'auto',
                        filter:panel?.filter||'none',backdrop:panel?.backdropFilter||'none',
                        canvas:[canvas.width,canvas.height],dpr:devicePixelRatio};
                    }""", selector)
                    # Preserve the failing frame and its measurements in CI artifacts.
                    path = OUT / f"{name}-{view}.png"
                    page.screenshot(path=str(path), scale="device")
                    report.update(profile=name,view=view,screenshot=str(path.relative_to(ROOT)),syntheticData=True)
                    records.append(report)
                    (OUT / "audit.json").write_text(json.dumps(records, indent=2), encoding="utf-8")
                    assert report["fonts"] == "loaded", report
                    assert report["zoom"] == "1", report
                    assert not report["blurred"] and not report["missingSVG"], report
                    assert not report["pageOverflow"] and not report["panelOverflow"] and not report["panelOutside"], report
                    assert report["transform"] == "none" and report["willChange"] == "auto" and report["filter"] == "none", report
                    assert report["canvas"] == [width*dpr, height*dpr], report
                    assert not errors, errors
                    print(f"PASS {name}: {view}", flush=True)

                def close(selector):
                    page.evaluate("s=>MMUI.close(document.querySelector(s),{immediate:true})", selector)

                capture("home")
                page.evaluate("MMUI.open(document.querySelector('#data-sheet'))")
                assert page.locator('#recent .row').count() == 3, 'Synthetic archive did not load'
                capture("summary", "#data-sheet")
                page.locator('.nav [data-go="history"]').click()
                page.locator('#search-options summary').click()
                capture("movements", "#data-sheet")
                page.locator('.nav [data-go="plan"]').click()
                capture("plan", "#data-sheet")
                page.locator('#new-recurring').click()
                page.locator('#r-name').fill('Ricorrenza dimostrativa')
                page.locator('#r-amount').fill('29,90')
                page.locator('#r-name').evaluate('(e)=>e.blur()')
                capture("new-recurring", "#rec-editor")
                close('#rec-editor')
                page.locator('#data-settings').click()
                capture("preferences", "#data-sheet")
                page.locator('#settings-form').scroll_into_view_if_needed()
                capture("preferences-budget", "#data-sheet")
                close('#data-sheet')
                page.evaluate("MMUI.open(document.querySelector('#quick-sheet'))")
                page.locator('#q-name').fill('Spesa dimostrativa')
                page.locator('#q-amount').fill('18,50')
                page.locator('#q-amount').evaluate('(e)=>e.blur()')
                capture("manual", "#quick-sheet")
                close('#quick-sheet')
                # Open the visual surface directly: never request microphone access.
                page.evaluate("MMUI.open(document.querySelector('#voice-sheet'))")
                page.wait_for_timeout(1200)
                capture("assistant", "#voice-sheet")
                page.locator('#assistant-type').click()
                page.locator('#natural').fill('Posso permettermi una spesa di 80 euro questo mese?')
                page.locator('#natural').evaluate('(e)=>e.blur()')
                capture("assistant-typed", "#voice-sheet")
                context.close()
            browser.close()
        (OUT / "audit.json").write_text(json.dumps(records, indent=2), encoding="utf-8")
        print(f"PASS {len(records)} visual states; screenshots: {OUT}", flush=True)
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
