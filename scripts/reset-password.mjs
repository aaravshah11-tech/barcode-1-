// npm run reset-password — forget the Command Centre password. Then open https://localhost:8443 on THIS computer to set a new one.
import path from 'node:path';
import { DATA_DIR } from '../server/config.js';
import { openDb } from '../server/db.js';
const db = openDb(path.join(DATA_DIR, 'sentinel.db'));
db.raw.exec("delete from settings where key = 'adminHash'");
db.removeAllSessions();
db.close();
console.log('\n  Password cleared. Open https://localhost:8443 on the HQ computer to choose a new one.\n');
