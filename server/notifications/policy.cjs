'use strict';
const crypto=require('node:crypto');
const {clean}=require('./validation.cjs');
const key=s=>crypto.createHash('sha256').update(s.endpoint).digest('hex');
module.exports={clean,key};
