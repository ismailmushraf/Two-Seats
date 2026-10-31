import {pgsFixture,supBytes} from './media/pgs-fixture.mjs';
// Reproducible browser QA with synthetic, non-user media. Clean before production builds.
import {mkdirSync,readFileSync,writeFileSync,copyFileSync,existsSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const marker='// GENERATED MEDIA QA — remove with node tests/prepare-media-qa.mjs --clean\n';
const route='app/media-qa/page.tsx', assets='public/__media-qa';
if(process.argv.includes('--clean')){
 if(existsSync(route)&&!readFileSync(route,'utf8').startsWith(marker))throw new Error('Refusing to remove an unrecognized route');
 rmSync('app/media-qa',{recursive:true,force:true});rmSync(assets,{recursive:true,force:true});
}else{
 if(existsSync(route)&&!readFileSync(route,'utf8').startsWith(marker))throw new Error('Media QA route already exists');
 mkdirSync('app/media-qa',{recursive:true});mkdirSync(assets,{recursive:true});
 writeFileSync(route,marker+readFileSync(process.argv.includes('--pgs')?'tests/media/pgs-qa-page.tsx':process.argv.includes('--auth')?'tests/media/auth-qa-page.tsx':process.argv.includes('--features')?'tests/media/feature-qa-page.tsx':'tests/media/qa-page.tsx','utf8').replaceAll("from '../../app/lib/","from '../lib/").replaceAll("from '../../app/components/","from '../components/").replaceAll("from '../../app/page'","from '../page'"));
 for(const file of ['worker.js','worker-fallback.js'])copyFileSync(`tests/media/${file}`,`${assets}/${file}`);
 function ff(...args){const run=spawnSync('ffmpeg',['-hide_banner','-loglevel','error',...args],{stdio:'inherit'});if(run.status!==0)throw new Error('Fixture generation failed');}
 ff('-f','lavfi','-i','testsrc2=size=320x180:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','32','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-g','48','-c:a','ac3','-b:a','192k','-y',`${assets}/ac3.mkv`);
 for(const [name,codec] of [['eac3','eac3'],['dts','dca'],['truehd','truehd']])ff('-i',`${assets}/ac3.mkv`,'-c:v','copy','-c:a',codec,'-strict','-2','-y',`${assets}/${name}.mkv`);
 ff('-i',`${assets}/ac3.mkv`,'-f','lavfi','-i','sine=frequency=880:sample_rate=48000','-map','0:v','-map','0:a','-map','1:a','-t','32','-c:v','copy','-c:a','ac3','-metadata:s:a:0','language=eng','-metadata:s:a:1','language=mal','-y',`${assets}/multi.mkv`);
 writeFileSync(`${assets}/subs.srt`,'1\n00:00:00,200 --> 00:00:06,000\nHello from embedded SRT\n\n2\n00:00:22,000 --> 00:00:28,000\nSubtitle after seek\n');
 ff('-i',`${assets}/subs.srt`,'-y',`${assets}/subs.ass`);
 ff('-i',`${assets}/ac3.mkv`,'-i',`${assets}/subs.srt`,'-i',`${assets}/subs.ass`,'-map','0:v','-map','0:a','-map','1:s','-map','2:s','-c','copy','-metadata:s:s:0','language=eng','-metadata:s:s:1','language=mal','-y',`${assets}/subtitles.mkv`);
 ff('-i',`${assets}/subtitles.mkv`,'-map','0:v','-map','0:a','-map','0:s:0','-c:v','copy','-c:a','aac','-c:s','mov_text','-y',`${assets}/subtitles.mp4`);
 writeFileSync(`${assets}/captions.sup`,supBytes(pgsFixture().packets));
 ff('-i',`${assets}/ac3.mkv`,'-i',`${assets}/captions.sup`,'-map','0:v','-map','0:a','-map','1:s','-c','copy','-metadata:s:s:0','language=eng','-y',`${assets}/pgs.mkv`);
 console.log('Open /media-qa in the managed preview and click Run codec checks. Also run ?fallback=1.');
}
