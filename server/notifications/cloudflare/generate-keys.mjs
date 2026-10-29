// Run once during setup. Never print or commit the private VAPID key.
import {generateKeyPairSync} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
const {privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const jwk=privateKey.export({format:'jwk'});
const publicKey=Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]).toString('base64url');
await writeFile(new URL('.secrets.json',import.meta.url),JSON.stringify({VAPID_PRIVATE_KEY:jwk.d})+'\n',{mode:0o600,flag:'wx'});
console.log('Public VAPID key for wrangler.jsonc and MM_PUSH_CONFIG:\n'+publicKey);
console.log('Private key saved only to ignored cloudflare/.secrets.json. Keep it safe; do not regenerate for an existing deployment.');
