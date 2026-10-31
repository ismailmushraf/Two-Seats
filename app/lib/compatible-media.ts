/** Local, incremental audio conversion. The existing video remains the playback clock. */
import type {PgsFrame} from './pgs';
import type { makeRemuxer } from 'libav-wasm';
import { MovieSubtitles, type SubtitleChoice } from './subtitles';
import { readMatroskaTracks, createMatroskaSubtitleReader } from './matroska-tracks';
type Remuxer = Awaited<ReturnType<typeof makeRemuxer>>;
type MediaSourceConstructor = typeof MediaSource;
export type MovieTrack = { streamIndex: number; language: string; title: string };
export type CompatibleMovie = {
  url: string;
  duration: number;
  tracks: MovieTrack[];
  hasAudio: boolean;
  subtitles: SubtitleChoice[];
  selectSubtitles: (index:number) => void;
  subtitleText: (time:number) => string;
  subtitleBitmap: (time:number) => PgsFrame|null;
  subtitleCueCount: () => number;
  subtitleDiagnostics: () => {codec:string;received:number;rejected:number;inferred:number;readerError:string};
  selectTrack: (index: number) => Promise<void>;
  destroy: () => void;
};

export function compatibilitySource(): MediaSourceConstructor | undefined {
  const scope = globalThis as typeof globalThis & { ManagedMediaSource?: MediaSourceConstructor };
  return scope.MediaSource || scope.ManagedMediaSource;
}
export function bufferedAhead(ranges: TimeRanges, time: number): number {
  for (let i = 0; i < ranges.length; i++) {
    if (ranges.start(i) <= time + 0.08 && ranges.end(i) > time) return ranges.end(i) - time;
  }
  return 0;
}
export function isMatroska(file: {name: string; type: string}) {
  return /\.(mkv|mka)$/i.test(file.name) || /matroska/i.test(file.type);
}
function cancelled() { return new DOMException('Movie selection changed.', 'AbortError'); }

export async function openCompatibleMovie(
  video: HTMLVideoElement, file: File, signal: AbortSignal, onError: (message: string) => void,
): Promise<CompatibleMovie> {
  const Source = compatibilitySource();
  if (!Source) throw new Error('This browser cannot run movie audio compatibility mode. Update your browser, or use an MP4 with H.264 video and AAC audio.');
  let remuxer: Remuxer | undefined, source: MediaSource | undefined, buffer: SourceBuffer | undefined;
  let closed = false, url = '', timer: ReturnType<typeof setInterval> | undefined;
  let subtitles:MovieSubtitles|undefined;
  let directSubtitles:ReturnType<typeof createMatroskaSubtitleReader>=null;
  let pendingSeek: number | null = null, pumping = false, finished = false, trackChange = false;
  let pendingTrack: {index: number; resolve: () => void; reject: (error: unknown) => void} | undefined;
  const abort = new AbortController();
  const check = () => { if (closed || signal.aborted) throw cancelled(); };
  const destroy = () => {
    if (closed) return;
    closed = true; abort.abort(); clearInterval(timer);
    video.removeEventListener('seeking', seeking);
    signal.removeEventListener('abort', destroy);
    pendingTrack?.reject(cancelled()); pendingTrack = undefined;
    subtitles?.destroy();
    directSubtitles?.destroy();
    // Terminate immediately, even if decoding is in flight. No old worker may append to a new movie.
    remuxer?.worker.terminate();
    if (url) URL.revokeObjectURL(url);
  };
  signal.addEventListener('abort', destroy, {once: true});
  async function bounded<T>(promise: Promise<T>, message: string): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let stop: () => void = () => {};
    try {
      check();
      return await Promise.race([promise, new Promise<never>((_,reject) => {
        stop = () => reject(cancelled());
        abort.signal.addEventListener('abort',stop,{once:true});
        timeout=setTimeout(()=>reject(new Error(message)),30000);
      })]);
    } finally { clearTimeout(timeout); abort.signal.removeEventListener('abort',stop); }
  }
  function event(target: EventTarget, name: string, operation?: () => void) {
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timeout); target.removeEventListener(name, done); target.removeEventListener('error', bad); abort.signal.removeEventListener('abort', stop); };
      const done = () => { cleanup(); resolve(); };
      const bad = () => { cleanup(); reject(new Error('Your browser could not decode this movie. Its video codec may also be unsupported. Try H.264 video with AAC audio in MP4.')); };
      const stop = () => { cleanup(); reject(cancelled()); };
      const timeout = setTimeout(() => { cleanup(); reject(new Error('Opening this movie took too long. Try a smaller file or an H.264/AAC MP4.')); }, 30000);
      target.addEventListener(name, done, {once: true}); target.addEventListener('error', bad, {once: true}); abort.signal.addEventListener('abort', stop, {once: true});
      try { check(); operation?.(); } catch (error) { cleanup(); reject(error); }
    });
  }
  const append = async (data: ArrayBuffer) => { check(); if (data.byteLength) await event(buffer!, 'updateend', () => buffer!.appendBuffer(data)); };
  const remove = async (start: number, end: number) => { check(); if (end > start) await event(buffer!, 'updateend', () => buffer!.remove(start, end)); };
  function seeking() {
    directSubtitles?.request(video.currentTime);
    if (!buffer || closed) return;
    // Buffered seeks need no worker restart. Unbuffered seeks are serialized with reads/appends.
    if (bufferedAhead(buffer.buffered, video.currentTime) < 0.08) pendingSeek = video.currentTime;
    void pump();
  }
  async function pump() {
    directSubtitles?.request(video.currentTime);
    if (closed || pumping || !buffer || !remuxer || !source || source.readyState === 'closed') return;
    pumping = true;
    try {
      check();
      if (pendingTrack) {
        const change = pendingTrack;
        await remuxer.setAudioStreamIndex(change.index); check();
        pendingSeek = video.currentTime; finished = false;
      }
      if (pendingSeek !== null) {
        const target = pendingSeek; pendingSeek = null;
        if (buffer.buffered.length) await remove(0, source.duration);
        buffer.abort();
        // Keep known cues and read a little before a new target to recover captions
        // that started before its video keyframe. The video still seeks to the exact target.
        const chunk = await bounded(remuxer.seek(subtitles?.choices.length?Math.max(0,target-8):target),'This device could not seek the movie in time. Try an H.264/AAC MP4.'); check();
        subtitles?.add(chunk.subtitles);
        buffer.timestampOffset = chunk.pts;
        await append(chunk.data); finished = chunk.finished;
        if (pendingTrack) { pendingTrack.resolve(); pendingTrack = undefined; }
      } else if (!finished && bufferedAhead(buffer.buffered, video.currentTime) < 15) {
        const chunk = await bounded(remuxer.read(),'This device could not prepare the next part of the movie in time.'); check();
        // A seek requested while this read ran takes precedence over its output.
        if (pendingSeek === null) { subtitles?.add(chunk.subtitles);await append(chunk.data); finished = chunk.finished; }
      }
      if (video.currentTime > 15 && buffer.buffered.length && buffer.buffered.start(0) < video.currentTime - 15) {
        await remove(0, video.currentTime - 10);
      }
      if (finished && pendingSeek === null && source.readyState === 'open' && !buffer.updating) source.endOfStream();
    } catch (error) {
      if (!closed) { video.pause(); onError(error instanceof Error ? error.message : 'Movie audio conversion failed.'); destroy(); }
    } finally { pumping = false; }
  }
  try {
    check();
    const trackInfoPromise=isMatroska(file)?readMatroskaTracks(file,signal).catch(()=>[]):Promise.resolve([]);
    const {makeRemuxer} = await import('libav-wasm'); check();
    // Restrict pass-through to AAC. AC-3, E-AC-3, DTS, TrueHD, etc. are converted to AAC.
    const opening = makeRemuxer({
      publicPath: new URL('/media-codecs/0.8.12/', location.origin).href,
      workerUrl: '/media-codecs/0.8.12/worker.js', workerOptions: {type: 'module'},
      length: file.size, bufferSize: 1_000_000, audioCodecs: ['aac'],
      read: async (offset, size) => { check(); return file.slice(offset, offset + size).arrayBuffer(); },
    });
    // Late startup after a change/timeout must still terminate its worker.
    opening.then(instance => { if (closed) instance.worker.terminate(); }, () => {});
    remuxer = await bounded(opening,'The local audio decoder could not start. Refresh and try again.');
    check();
    const header = await bounded(remuxer.init(),'This file could not be decoded in time. Try an H.264/AAC MP4.');
    check();
    const duration = header.info.input.duration;
    if (!Number.isFinite(duration) || duration <= 0 || duration > 86400) throw new Error('Choose a playable movie shorter than 24 hours.');
    const codecs = [header.info.output.videoMimeType, header.info.output.audioMimeType].filter(Boolean).join(',');
    const mime = `video/mp4; codecs="${codecs}"`;
    if (!header.info.output.videoMimeType || !Source.isTypeSupported(mime)) throw new Error('This device cannot decode the video in this file. Audio repair cannot convert video; use an MP4 with H.264 video and AAC audio.');
    source = new Source();
    // Required by ManagedMediaSource on iPhone when no AirPlay source is supplied.
    video.disableRemotePlayback = true;
    url = URL.createObjectURL(source);
    await event(source, 'sourceopen', () => { video.src = url; video.load(); }); check();
    buffer = source.addSourceBuffer(mime); source.duration = duration;
    const trackInfo=await trackInfoPromise;check();
    const subtitleInfo=trackInfo.filter(track=>track.type===17);
    subtitles=new MovieSubtitles(video,header.subtitles.map((subtitle,index)=>({...subtitle,codec:(trackInfo[subtitle.streamIndex]?.type===17?trackInfo[subtitle.streamIndex]:subtitleInfo[index])?.codec||''})));
    directSubtitles=createMatroskaSubtitleReader(file,trackInfo,packets=>subtitles?.add(packets),signal);
    directSubtitles?.selectPgs(subtitles.choices[0]?.streamIndex??null);directSubtitles?.request(0);
    await append(header.data);
    const first = await bounded(remuxer.read(),'This device could not prepare the movie audio in time.'); check();subtitles.add(first.subtitles); await append(first.data); finished = first.finished;
    if (video.readyState < 1) await event(video, 'loadedmetadata');
    video.addEventListener('seeking', seeking);
    timer = setInterval(() => void pump(), 200);
    return {
      url, duration, tracks: header.audioStreams, hasAudio: !!header.info.output.audioMimeType,
      subtitles:subtitles.choices,selectSubtitles:index=>{subtitles?.select(index);directSubtitles?.selectPgs(index);directSubtitles?.request(video.currentTime)},
      subtitleText:time=>subtitles?.caption(time)||'',subtitleBitmap:time=>subtitles?.bitmap(time)||null,subtitleCueCount:()=>subtitles?.cueCount||0,
      subtitleDiagnostics:()=>({...subtitles?.diagnostics||{codec:'',received:0,rejected:0,inferred:0},readerError:subtitles?.diagnostics.pgsError||directSubtitles?.error||''}),
      selectTrack: async index => {
        check();
        if (trackChange) throw new Error('Please wait for the previous audio track change.');
        if (!header.audioStreams.some(track => track.streamIndex === index)) throw new Error('That audio track is unavailable.');
        trackChange = true;
        try { await new Promise<void>((resolve,reject) => { pendingTrack = {index,resolve,reject}; void pump(); }); }
        finally { trackChange = false; }
      },
      destroy,
    };
  } catch (error) { destroy(); throw error; }
}
