import {readFile,mkdir,copyFile,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const target=path.join(root,'dist');
const source=await readFile(path.join(root,'service-worker.js'),'utf8');
const match=source.match(/const SHELL_FILES = (\[[\s\S]*?\]);/);
if(!match)throw new Error('Public shell list is missing.');
const files=JSON.parse(match[1]);
for(const name of files)if(!/^[a-z0-9][a-z0-9.-]*$/i.test(name)||/secret|private|\.env|wrangler/i.test(name))throw new Error('Invalid public asset: '+name);
// Only this fixed, generated directory may be replaced. Validate the resolved
// Windows target before recursive removal; never traverse a user-supplied path.
if(path.relative(root,target)!=='dist'||path.dirname(target)!==root)throw new Error('Unsafe build directory.');
await rm(target,{recursive:true,force:true});
await mkdir(target,{recursive:true});
for(const name of [...files,'service-worker.js','_headers'])await copyFile(path.join(root,name),path.join(target,name));
console.log('Prepared '+files.length+' application assets and public policy pages in dist/.');
