import { spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';

/** Inherit real OS file handles. The child never depends on this Node event
 * loop to drain stdout/stderr. Handles are duplicated by spawn before closure. */
export function spawnSurfaceFileLogged(command, args, { stdoutPath, stderrPath, ...options }) {
  const descriptors=[];
  try {
    descriptors.push(openSync(stdoutPath,'w'));
    descriptors.push(openSync(stderrPath,'w'));
    return spawn(command,args,{...options,stdio:['ignore',...descriptors]});
  } finally {
    for(const descriptor of descriptors)closeSync(descriptor);
  }
}

/** Parse only after the child has exited. Raw bytes remain authoritative in the
 * files; parsing accepts a final unterminated line and UTF-8 without splitting
 * multi-byte characters at arbitrary stdout chunks. */
export function parseSurfaceNativeLogs(stdout,stderr) {
  const events=[],errors=[];
  for(const [stream,text]of[['stdout',stdout],['stderr',stderr]])for(const line of text.split(/\r?\n/)){
    if(/(?:SCRIPT|SHADER) ERROR|ERROR:|Live terrain unavailable/.test(line))errors.push({stream,line});
    try { const event=JSON.parse(line);if(event&&typeof event==='object'&&event.event)events.push(event); }catch{}
  }
  return{events,errors};
}
