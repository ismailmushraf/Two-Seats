import fs from 'node:fs';
import ts from 'typescript';
import assert from 'node:assert/strict';
const js=ts.transpileModule(fs.readFileSync('app/lib/invites.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const {parseRoomInvite}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const origin='https://movie-night.example';
const id='a'.repeat(32),token='b'.repeat(64),link=`${origin}/#room=${id}&key=${token}`;
assert.deepEqual(parseRoomInvite(link,origin),{id,token,url:link});
assert.deepEqual(parseRoomInvite(`${origin}/#key=${token}&room=${id}`,origin),{id,token,url:link});
for(const bad of ['',origin,`${origin}/#room=${id}`,`${origin}/#key=${token}`,`${origin}/#room=bad&key=${token}`,`${origin}/#room=${id}&key=bad`,`https://different.example/#room=${id}&key=${token}`,`${origin}/other#room=${id}&key=${token}`,`${origin}/?room=${id}&key=${token}`])assert.equal(parseRoomInvite(bad,origin),null);
assert.equal(new URL(link).search,''); // Invite secrets stay out of request query strings.
console.log('PASS: valid invite extraction and canonicalization; malformed, incomplete, cross-origin, wrong-path and query-string invites rejected.');
