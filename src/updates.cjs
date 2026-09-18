const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFile, spawn} = require('node:child_process');
const {promisify} = require('node:util');
const run = promisify(execFile);
const REPO = 'ortusclub/ortus-profile-desk-team';
const ASSET = 'Ortus-Profile-Desk-universal.dmg';
const newer = (next, current) => {
  if (!/^\d+\.\d+\.\d+$/.test(next) || !/^\d+\.\d+\.\d+$/.test(current)) return false;
  const a = next.split('.').map(Number), b = current.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
};
function releaseInfo(release, current) {
  const version = String(release.tag_name || '').replace(/^v/, '');
  if (release.draft || release.prerelease || !newer(version, current)) return null;
  const asset = release.assets?.find(a => a.name === ASSET);
  if (!asset || !/^sha256:[a-f0-9]{64}$/.test(asset.digest || '')) throw new Error('This release has no verified Mac installer.');
  return {version, tag: release.tag_name, digest: asset.digest, size: Number(asset.size) || 0};
}
class Updates {
  constructor(app, notify) {
    this.app = app; this.notify = notify; this.run = run; this.busy = false; this.ready = null;
    this.state = {version: app.getVersion(), status: 'idle', message: 'Checks automatically; downloads updates in the background.'};
  }
  set(status, message, details = {}) {this.state = {...this.state, status, message, ...details}; this.notify(this.state); return this.state;}
  async check() {
    if (this.busy || this.ready) return this.state;
    if (!this.app.isPackaged) return this.set('unavailable', 'Updates are available in the installed app.');
    this.busy = true; this.set('checking', 'Looking for a newer version…', {progress:null, downloaded:0, total:0});
    let work, mount, attached = false;
    try {
      let stdout;
      try { ({stdout} = await this.run('/usr/bin/curl', ['-fsSL', '--proto', '=https', '--proto-redir', '=https', '--max-time', '25', `https://api.github.com/repos/${REPO}/releases/latest`], {timeout: 30000, maxBuffer: 4 * 1024 * 1024})); }
      catch {throw new Error('Cannot check for updates. Check your internet connection and try again shortly.');}
      const release = releaseInfo(JSON.parse(stdout), this.app.getVersion());
      if (!release) return this.set('current', 'You have the latest version.');
      this.set('downloading', `Downloading version ${release.version}. You can keep using the app.`, {targetVersion:release.version,total:release.size,progress:null});
      work = fs.mkdtempSync(path.join(os.tmpdir(), 'ortus-update-')); fs.chmodSync(work, 0o700);
      const report = () => {
        let downloaded = 0;
        try {downloaded = fs.statSync(path.join(work, ASSET)).size;} catch {}
        this.set('downloading', `Downloading version ${release.version}. You can keep using the app.`, {
          downloaded, total:release.size, progress:release.size ? Math.min(100,Math.floor(downloaded / release.size * 100)) : null
        });
      };
      const timer = setInterval(report, 500); timer.unref();
      try {await this.run('/usr/bin/curl', ['-fsSL', '--proto', '=https', '--proto-redir', '=https', '--connect-timeout', '20', '--max-time', '850', `https://github.com/${REPO}/releases/download/${release.tag}/${ASSET}`, '-o', path.join(work, ASSET)], {timeout: 15 * 60 * 1000});}
      finally {clearInterval(timer);}
      this.set('verifying', 'Download complete. Checking the file and application signature…', {progress:100, downloaded:release.size});
      const hash = crypto.createHash('sha256');
      for await (const chunk of fs.createReadStream(path.join(work, ASSET))) hash.update(chunk);
      if (`sha256:${hash.digest('hex')}` !== release.digest) throw new Error('The update failed download verification. Try again.');
      mount = path.join(work, 'mount');
      await this.run('/usr/bin/hdiutil', ['attach', path.join(work, ASSET), '-readonly', '-nobrowse', '-mountpoint', mount, '-quiet'], {timeout: 60000}); attached = true;
      const source = path.join(mount, 'Ortus Profile Desk.app');
      await this.run('/usr/bin/codesign', ['--verify', '--deep', '--strict', source], {timeout: 60000});
      for (const [key, expected] of [['CFBundleIdentifier', 'local.profiledesk.app'], ['CFBundleShortVersionString', release.version]]) {
        const {stdout: value} = await this.run('/usr/libexec/PlistBuddy', ['-c', `Print ${key}`, path.join(source, 'Contents/Info.plist')]);
        if (value.trim() !== expected) throw new Error('The update contains an unexpected application.');
      }
      this.set('preparing', 'Verified. Preparing the update on this Mac…');
      const destination = path.resolve(this.app.getAppPath(), '../../..');
      if (path.basename(destination) !== 'Ortus Profile Desk.app' || !['/Applications', path.join(os.homedir(), 'Applications')].includes(path.dirname(destination))) throw new Error('Move the app to Applications before updating.');
      fs.accessSync(path.dirname(destination), fs.constants.W_OK); fs.accessSync(destination, fs.constants.W_OK);
      const staging = fs.mkdtempSync(path.join(path.dirname(destination), '.ortus-update-')); fs.chmodSync(staging, 0o700);
      const prepared = path.join(staging, 'Ortus Profile Desk.app');
      try {
        await this.run('/usr/bin/ditto', [source, prepared], {timeout: 120000});
        await this.run('/usr/bin/codesign', ['--verify', '--deep', '--strict', prepared], {timeout: 60000});
        fs.copyFileSync(path.join(__dirname, 'update-install.sh'), path.join(staging, 'install.sh'));
      } catch (err) {fs.rmSync(staging, {recursive: true, force: true}); throw err;}
      this.ready = {staging, prepared, destination};
      return this.set('ready', `Version ${release.version} is ready. Close your profile windows, then click Restart to update. The app will reopen automatically.`);
    } catch (err) {
      // Never expose CLI stderr: it can contain local credentials or environment details.
      return this.set('error', err.message.startsWith('Command failed:') ? 'The update could not be downloaded or prepared. Check your connection and try again.' : err.message.slice(0, 250));
    } finally {
      if (attached) await this.run('/usr/bin/hdiutil', ['detach', mount, '-quiet'], {timeout: 30000}).catch(() => {});
      if (work && !fs.existsSync(path.join(work, 'mount', 'Ortus Profile Desk.app'))) fs.rmSync(work, {recursive: true, force: true});
      this.busy = false;
    }
  }
  async install() {
    if (!this.ready) throw new Error('Check for updates first.');
    const {staging, prepared, destination} = this.ready;
    const log = fs.openSync(path.join(staging, 'install.log'), 'a', 0o600);
    const child = spawn('/bin/bash', [path.join(staging, 'install.sh'), String(process.pid), prepared, destination, staging], {detached: true, stdio: ['ignore', log, log]});
    try {await new Promise((resolve, reject) => {child.once('spawn', resolve); child.once('error', reject);});}
    finally {fs.closeSync(log);}
    child.unref();
  }
}
module.exports = {Updates, newer, releaseInfo};
