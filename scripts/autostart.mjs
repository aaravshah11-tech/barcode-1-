// npm run autostart            — start HQ automatically when this computer starts (and restart it if it stops)
// npm run autostart -- remove  — undo that
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, DATA_DIR } from '../server/config.js';

const remove = process.argv.includes('remove');
const node = process.execPath;
const entry = path.join(ROOT, 'server', 'index.js');
const run = (cmd, args) => { try { return execFileSync(cmd, args, { stdio: 'pipe' }).toString(); } catch (e) { return e.stderr?.toString() || e.message; } };
fs.mkdirSync(DATA_DIR, { recursive: true });

if (process.platform === 'darwin') {
  const label = 'uk.sentinel.hq';
  const plist = path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
  const uid = String(process.getuid());
  run('launchctl', ['bootout', `gui/${uid}/${label}`]);
  if (remove) { fs.rmSync(plist, { force: true }); console.log('\n  HQ will no longer start on its own.\n'); process.exit(0); }
  fs.mkdirSync(path.dirname(plist), { recursive: true });
  fs.writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array><string>${node}</string><string>--disable-warning=ExperimentalWarning</string><string>${entry}</string></array>
  <key>WorkingDirectory</key><string>${ROOT}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${path.join(DATA_DIR, 'hq.log')}</string>
  <key>StandardErrorPath</key><string>${path.join(DATA_DIR, 'hq.log')}</string>
</dict></plist>
`);
  run('launchctl', ['bootstrap', `gui/${uid}`, plist]);
  console.log(`\n  Done. HQ now starts when you log in to this Mac, and restarts if it stops.\n  Log file: ${path.join(DATA_DIR, 'hq.log')}\n  (Close any "npm start" window first — only one HQ can run at a time.)\n`);
} else if (process.platform === 'linux') {
  const unit = path.join(os.homedir(), '.config', 'systemd', 'user', 'sentinel-hq.service');
  if (remove) { run('systemctl', ['--user', 'disable', '--now', 'sentinel-hq']); fs.rmSync(unit, { force: true }); console.log('\n  HQ will no longer start on its own.\n'); process.exit(0); }
  fs.mkdirSync(path.dirname(unit), { recursive: true });
  fs.writeFileSync(unit, `[Unit]\nDescription=SENTINEL HQ\nAfter=network-online.target\n\n[Service]\nWorkingDirectory=${ROOT}\nExecStart=${node} --disable-warning=ExperimentalWarning ${entry}\nRestart=always\nRestartSec=5\n\n[Install]\nWantedBy=default.target\n`);
  run('systemctl', ['--user', 'daemon-reload']);
  console.log(run('systemctl', ['--user', 'enable', '--now', 'sentinel-hq']));
  console.log(`\n  Done. HQ starts with your user session. On a Raspberry Pi with no screen, also run once:\n    sudo loginctl enable-linger ${os.userInfo().username}\n  so it starts at boot without anyone logging in. Logs: journalctl --user -u sentinel-hq -f\n`);
} else if (process.platform === 'win32') {
  console.log(`\n  On Windows, run this once in a Command Prompt:\n    schtasks /Create /SC ONLOGON /TN "SENTINEL HQ" /TR "\\"${node}\\" --disable-warning=ExperimentalWarning \\"${entry}\\"" /RL LIMITED\n  To undo:  schtasks /Delete /TN "SENTINEL HQ" /F\n`);
}
