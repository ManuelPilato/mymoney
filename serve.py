"""Serve only public app assets at a stable local address for persistent storage."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import urlopen
import argparse
import webbrowser

HOST, PORT = '127.0.0.1', 8765
URL = f'http://{HOST}:{PORT}/'
ROOT = Path(__file__).resolve().parent

class AppHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # Updates can be detected online; the service worker supplies offline files.
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Apri MyMoney sul Mac')
    parser.add_argument('--open', action='store_true', help='Apri il browser predefinito')
    args = parser.parse_args()
    try:
        server = ThreadingHTTPServer((HOST, PORT), partial(AppHandler, directory=str(ROOT / 'app')))
    except OSError:
        try:
            with urlopen(URL, timeout=2) as response:
                html = response.read(10000).decode('utf-8')
            if 'MyMoney' not in html or 'orb-canvas' not in html:
                # The bundled inline stylesheet comes before the body, so also
                # recognize the app's unique style marker in the first bytes.
                if 'MyMoney: quiet surfaces' not in html:
                    raise RuntimeError('La porta 8765 è occupata da un altro programma.')
        except Exception as error:
            raise SystemExit(f'Impossibile avviare MyMoney: {error}\nLibera la porta 8765 e riprova. Non cambio indirizzo, per conservare lo stesso archivio.')
        if args.open:
            webbrowser.open(URL)
        print(f'MyMoney è già aperto su {URL}')
    else:
        print(f'MyMoney: {URL}\nLascia questa finestra aperta mentre usi l’app. Ctrl+C per arrestare il server.', flush=True)
        if args.open:
            webbrowser.open(URL)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print('\nMyMoney chiuso. I dati restano nel browser.')
        finally:
            server.server_close()
