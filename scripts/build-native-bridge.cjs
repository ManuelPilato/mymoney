'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
fs.copyFileSync(path.join(root,'src/native.js'),path.join(root,'app/native.js'));
console.log('Native bridge copied (inert in Safari).');
