import {mkdir,cp} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
for(const p of ['index.html','favicon.svg','src'])await cp(p,`dist/${p}`,{recursive:true});
console.log('Build estático pronto em dist/.');
