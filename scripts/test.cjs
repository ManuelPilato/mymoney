'use strict';
const {readdirSync}=require('node:fs');
const {join}=require('node:path');
const {spawnSync}=require('node:child_process');
// Emulator tests are explicit: the ordinary test suite never contacts Firebase.
const files=readdirSync(join(__dirname,'../tests'))
  .filter(name=>name.endsWith('.test.cjs')&&name!=='firestore_rules.test.cjs')
  .sort().map(name=>join(__dirname,'../tests',name));
const result=spawnSync(process.execPath,['--test',...files],{stdio:'inherit'});
if(result.error)throw result.error;
process.exit(result.status??1);
