const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {pipeline} = require('node:stream/promises');
const {Transform} = require('node:stream');
const {Database, fail} = require('./database.cjs');
const MAX_SNAPSHOT = 128 * 1024 * 1024;
const PREFIX = '/profile-desk/v1';
function createService({root, storageKey, token, adminToken, sheetUrl, enableSnapshots = false}) {
  if (!token || token.length < 32 || !adminToken || adminToken.length < 32) throw new Error('Workspace and admin tokens are required.');
  const db = new Database(root, storageKey), uploads = new Set();
  const digest = value => crypto.createHash('sha256').update(value).digest();
  const matches = (a,b) => crypto.timingSafeEqual(digest(a), digest(b));
  const send = (res, status, value) => {res.writeHead(status, {'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); res.end(JSON.stringify(value));};
  async function json(req) {let size = 0, chunks = []; for await (const c of req) {size += c.length; if (size > 8*1024*1024) throw fail(413,'Request too large.'); chunks.push(c);} try {return JSON.parse(Buffer.concat(chunks).toString() || '{}');} catch {throw fail(400,'Invalid request.');}}
  const server = http.createServer(async (req,res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/healthz') return send(res,200,{ok:true});
      if (!url.pathname.startsWith(PREFIX+'/')) throw fail(404,'Not found.');
      const auth = String(req.headers.authorization || '').replace(/^Bearer /,'');
      const admin = matches(auth,adminToken);
      if (!admin && !matches(auth,token)) throw fail(401,'Workspace access denied. Install the latest private team build.');
      const route = url.pathname.slice(PREFIX.length);
      if (req.method === 'GET' && route === '/profiles') {
        if (req.headers['if-none-match'] === String(db.data.revision)) {res.writeHead(304,{'Cache-Control':'no-store'}); return res.end();}
        return send(res,200,{revision:db.data.revision,profiles:db.list(),sheet:db.data.sheet});
      }
      if (req.method === 'POST' && route === '/profiles') return send(res,201,db.create(await json(req)));
      if (req.method === 'POST' && route === '/sheet/sync') {
        if (!admin) throw fail(403,'Administrator access required.');
        if (!sheetUrl) throw fail(400,'No sheet configured.');
        return send(res,200,await db.syncSheet(sheetUrl));
      }
      const match = /^\/profiles\/([a-f0-9-]{36})(?:\/(lock|release|snapshot))?$/.exec(route);
      if (!match) throw fail(404,'Not found.');
      const [,id,action] = match;
      if (!action && req.method === 'GET') return send(res,200,db.get(id));
      if (!action && req.method === 'PUT') return send(res,200,db.update(id,await json(req)));
      if (!enableSnapshots) throw fail(405,'Session transfer is not enabled.');
      const owner = String(req.headers['x-device-id'] || ''), lockToken = String(req.headers['x-profile-lock'] || '');
      if (action === 'lock' && req.method === 'POST') return send(res,200,db.acquire(id,owner,lockToken));
      if (action === 'release' && req.method === 'POST') {
        if (uploads.has(id)) throw fail(409,'A save is in progress.');
        db.release(id,owner,lockToken); return send(res,200,{ok:true});
      }
      if (action === 'snapshot' && req.method === 'GET') {
        db.checkLock(id,owner,lockToken);
        const snapshot = db.get(id).snapshot;
        if (!snapshot) throw fail(404,'No saved session yet.');
        const file = path.join(root,'snapshots',snapshot.file), size = fs.statSync(file).size;
        const fd = fs.openSync(file,'r'), iv = Buffer.alloc(12), tag = Buffer.alloc(16);
        try {fs.readSync(fd,iv,0,12,0);fs.readSync(fd,tag,0,16,size-16);} finally {fs.closeSync(fd);}
        const decipher = crypto.createDecipheriv('aes-256-gcm',db.key,iv); decipher.setAuthTag(tag);
        res.writeHead(200,{'Content-Type':'application/zip','Cache-Control':'no-store','Content-Length':snapshot.size,'X-Snapshot-SHA256':snapshot.sha256});
        await pipeline(fs.createReadStream(file,{start:12,end:size-17}),decipher,res); return;
      }
      if (action === 'snapshot' && req.method === 'PUT') {
        db.checkLock(id,owner,lockToken);
        if (uploads.has(id) || uploads.size >= 2) throw fail(409,'A profile save is already in progress. Retry shortly.');
        uploads.add(id);
        const fileName = `${id}-${crypto.randomUUID()}.vault`, file = path.join(root,'snapshots',fileName), temp = file+'.tmp';
        try {
          let size = 0; const hash = crypto.createHash('sha256'); const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm',db.key,iv);
          fs.writeFileSync(temp,iv,{mode:0o600});
          const count = new Transform({transform(chunk,_encoding,cb) {size += chunk.length; if(size>MAX_SNAPSHOT) return cb(fail(413,'Session exceeds the 128 MB transfer limit.'));hash.update(chunk);cb(null,chunk);}});
          await pipeline(req,count,cipher,fs.createWriteStream(temp,{flags:'a',mode:0o600}));
          if (!size) throw fail(400,'Empty session snapshot.');
          fs.appendFileSync(temp,cipher.getAuthTag()); fs.renameSync(temp,file);
          const p = db.commit(id,owner,lockToken,{file:fileName,size,sha256:hash.digest('hex')});
          return send(res,200,{version:p.version});
        } finally {uploads.delete(id);fs.rmSync(temp,{force:true});}
      }
      throw fail(405,'Method not allowed.');
    } catch (error) {
      if (res.headersSent) res.destroy();
      else send(res,error.status || 500,{error:error.status ? error.message : 'Service could not complete this request. Your previous saved data is retained.'});
    }
  });
  server.requestTimeout = 300000; server.headersTimeout = 30000;
  return {server,db};
}
if (require.main === module) {
  const {server,db} = createService({root:process.env.DATA_DIR || '/data', storageKey:process.env.STORAGE_KEY,token:process.env.TEAM_TOKEN,adminToken:process.env.ADMIN_TOKEN,sheetUrl:process.env.SHEET_URL});
  server.listen(Number(process.env.PORT || 3000),'0.0.0.0',()=>console.log('Profile service listening.'));
  let syncing = false;
  const sync = async () => {if (!process.env.SHEET_URL || syncing) return;syncing=true;try {await db.syncSheet(process.env.SHEET_URL);console.log('Account sheet synchronized.');}catch {console.error('Sheet sync failed; existing profiles retained.');}finally{syncing=false;}};
  sync();setInterval(sync,300000).unref();
  process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
}
module.exports = {createService};
