// The existing monitor owns this child and its process group. Core's plain
// JSON-RPC subscription supplies a real snapshot/ready receipt; no socket paths,
// screen scraping, one-shot waits, or reconnect runtime are needed.
export function hcMonitorCommand(terminalId: string): string {
  if (!/^(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)?t[0-9a-z]+$/.test(terminalId)) throw new Error("Use the terminal address returned by hc.");
  const script = String.raw`
import { spawn } from 'node:child_process';
const terminalId = ${JSON.stringify(terminalId)};
const child = spawn('hc', ['connect'], { stdio: ['pipe', 'pipe', 'pipe'] });
let pending = '';
let seq = -1;
let turn = 0;
// The root status that produced the latest status event, so a following turn
// event can carry the same question/permission content instead of a bare word.
let lastStatus = null;
let ready = false;
const timer = setTimeout(() => fail('Core subscription handshake timed out'), 10000);
function fail(message) {
  console.error(message);
  process.exitCode = 1;
  clearTimeout(timer);
  child.kill();
}
function report(status, detail = '') {
  console.log(JSON.stringify({monitorOutcome: {status, message: ('Core terminal ' + terminalId + ' turn ' + turn + (detail ? ': ' + detail : '')).slice(0, 1000)}}));
}
function clean(value) {
  return typeof value === 'string' ? value.replace(/[\r\n\t]+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : '';
}
function describe(status) {
  if (!status) return '';
  return [
    status.kind ? 'kind=' + clean(status.kind) : '',
    status.msg ? 'msg=' + clean(status.msg) : '',
    status.title && status.title !== status.msg ? 'title=' + clean(status.title) : '',
  ].filter(Boolean).join(' ');
}
function actionable(records) {
  return Object.entries(records ?? {}).filter(([, value]) => value && (value.state === 'blocked' || value.state === 'error'));
}
function hash(value) {
  // Two independent 32-bit accumulators keep the identity collision-resistant
  // without any length cap on the child detail.
  let a = 2166136261;
  let b = 2654435769;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    a ^= code; a = Math.imul(a, 16777619);
    b ^= code; b = Math.imul(b, 2246822519);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
function childDetail(id, child) {
  return 'child ' + clean(id) + ' state=' + clean(child.state) + (describe(child) ? ' ' + describe(child) : '');
}
// Core keeps the program's own words: kind/msg/title on the root status and
// child records by id. A supervisor needs that content, not just "working".
// When the root is working, every actionable child participates in this
// outcome, not only the first: a change in any of them must produce a distinct
// message instead of being deduplicated behind an unchanged earlier child. The
// compact identity prefix keeps that true even when the existing message bound
// trims the descriptive tail.
function reportStatus(status, records) {
  lastStatus = status ?? null;
  const children = actionable(records);
  if (status?.state === 'working' && children.length > 0) {
    const detail = children.map(([id, child]) => childDetail(id, child)).join('; ');
    const words = [...new Set(children.map(([, child]) => child.state))];
    const word = words.length === 1 ? words[0] : (words.includes('error') ? 'error' : 'blocked');
    report(word, 'children=' + children.length + ' hash=' + hash(detail) + '; ' + detail);
    return;
  }
  report(status?.state ?? 'unknown', describe(status));
}
function snapshot(value, initial = false) {
  if (!Array.isArray(value.terminals) || !Number.isSafeInteger(value.seq)) throw new Error('Invalid Core subscription snapshot');
  seq = value.seq;
  const terminal = value.terminals.find(t => t.address === terminalId);
  if (!terminal) throw new Error('Core terminal is absent from subscription snapshot');
  turn = terminal.turn ?? 0;
  lastStatus = terminal.status ?? null;
  if (initial) {
    ready = true;
    clearTimeout(timer);
    console.log('Core signal subscription ready for ' + terminalId);
  }
  if (terminal.state === 'finished') report('finished', 'inspect exit and output; not proof of task completion');
  else if (!initial) reportStatus(terminal.status, terminal.records);
  else if (['blocked', 'error'].includes(terminal.status?.state) || actionable(terminal.records).length > 0) reportStatus(terminal.status, terminal.records);
}
child.on('spawn', () => child.stdin.write(JSON.stringify({jsonrpc:'2.0', id:'core-monitor-subscribe', method:'events.subscribe', params:{terminal:terminalId}}) + '\n'));
child.stdout.on('data', chunk => {
  pending += chunk.toString();
  if (pending.length > 1048576) { fail('Core record too large'); return; }
  let end;
  while ((end = pending.indexOf('\n')) !== -1) {
    const line = pending.slice(0, end); pending = pending.slice(end + 1);
    try {
      const record = JSON.parse(line);
      if (record.error) throw new Error(record.error.message ?? 'Core subscription failed');
      if (record.id === 'core-monitor-subscribe') { snapshot(record.result, true); continue; }
      if (record.method === 'heartbeat') continue;
      if (record.method === 'missed') { snapshot(record.params); continue; }
      if (record.method !== 'event') continue;
      const event = record.params;
      if (!ready || !Number.isSafeInteger(event?.seq) || event.seq <= seq) continue;
      seq = event.seq;
      if (event.terminal !== terminalId) continue;
      const data = event.data ?? {};
      if (event.type === 'status') reportStatus(data.status, data.records);
      else if (event.type === 'turn') { turn = data.turn ?? turn; report(data.state ?? 'unknown', lastStatus && lastStatus.state === data.state ? describe(lastStatus) : ''); }
      else if (event.type === 'finished' || event.type === 'removed' || event.type === 'lost') report(event.type, data.reason ?? 'inspect terminal output');
      else if (event.type === 'restarted') report('unknown', 'terminal restarted as a shell; the assignment was not resumed');
    } catch (error) { fail(error.message); return; }
  }
});
child.stderr.on('data', chunk => process.stderr.write(chunk));
child.stdin.on('error', error => fail(error.message));
child.on('error', error => fail(error.message));
child.on('close', code => { clearTimeout(timer); console.error('Core signal subscription closed (' + code + ')'); process.exitCode = 1; });
`;
  return `node --input-type=module -e '${script.replaceAll("'", "'\\''")}'`;
}
