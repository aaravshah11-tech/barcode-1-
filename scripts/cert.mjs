// npm run cert            — make (or refresh) HQ's HTTPS certificate
// npm run cert -- --force — make a brand new one (phones keep working: the same CA is reused)
import { ensureCerts } from '../server/certs.js';
const c = ensureCerts({ force: process.argv.includes('--force') });
console.log(`
  Certificate ready (${c.meta.method}). It covers: ${[...c.meta.ips, ...c.meta.dns].join(', ')}
  Phones install this file once to trust HQ:  ${c.caPath}
  (They can also download it from the setup page: http://<HQ address>:8080)

  To trust it on THIS Mac too (so the Command Centre has no warning):
    open "${c.caPath}"   → Keychain Access → double-click "SENTINEL Local CA" → Trust → Always Trust
  (Not needed if you installed mkcert: it does this for you.)
`);
