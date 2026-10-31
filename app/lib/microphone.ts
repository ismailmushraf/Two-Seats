export type MicrophoneIssue={code:string;title:string;steps:string[]};
export function microphoneIssue(name:string,context:{embedded:boolean;secure:boolean;policy:boolean;platform:string}):MicrophoneIssue {
 if(!context.secure)return {code:'mic_context',title:'Open the secure website to use your microphone.',steps:['Open the HTTPS Two Seats link in your browser.']};
 if(!context.policy)return {code:'mic_context',title:'This embedded page is not allowed to request the microphone.',steps:['Open Two Seats directly in Safari or Chrome using the button below.','Enable voice there and allow microphone access.']};
 const mac=/Macintosh|Mac OS X/.test(context.platform)&&!/iPhone|iPad/.test(context.platform);
 if(name==='NotAllowedError'||name==='PermissionDeniedError'||name==='SecurityError')return {code:'mic_denied',title:'Microphone permission is blocked.',steps:[...(context.embedded?['Open Two Seats directly in Safari or Chrome, outside the app preview.']:[]),'Allow Microphone for this website in your browser’s site settings.',...(mac?['In macOS System Settings → Privacy & Security → Microphone, allow your browser.']:[]),'Reload this tab, then tap Enable voice again.']};
 if(name==='NotFoundError'||name==='DevicesNotFoundError')return {code:'mic_missing',title:'No microphone was found.',steps:['Connect or enable a microphone, then retry.']};
 if(name==='NotReadableError'||name==='TrackStartError'||name==='AbortError')return {code:'mic_busy',title:'The browser could not start the microphone.',steps:['Close other apps or tabs using the microphone.','Check your browser’s microphone permission, then retry.']};
 if(name==='Unsupported')return {code:'mic_context',title:'This browser cannot provide microphone access here.',steps:['Open Two Seats directly in Safari or Chrome using the button below.']};
 return {code:'mic_stopped',title:'Microphone access was interrupted.',steps:['Keep this browser tab open in the foreground.','Tap Enable voice to start a new connection.']};
}
