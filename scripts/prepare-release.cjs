const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {version} = require('../package.json');
(async () => {
 const root = path.join(__dirname,'../dist');
 const source = path.join(root,`Ortus Profile Desk-${version}-universal.dmg`);
 const target = path.join(root,'Ortus-Profile-Desk-universal.dmg');
 fs.copyFileSync(source,target);
 const hash=crypto.createHash('sha256');
 for await (const chunk of fs.createReadStream(target)) hash.update(chunk);
 fs.writeFileSync(path.join(root,'install.json'),JSON.stringify({version,sha256:hash.digest('hex'),size:fs.statSync(target).size},null,2)+'\n');
 console.log('Release prepared: publish both Ortus-Profile-Desk-universal.dmg and install.json.');
})().catch(err=>{console.error(err.message);process.exitCode=1;});
