const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const root = __dirname;
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const dataFile = path.join(dataDir, 'game.json');
const codeFile = path.join(dataDir, 'codes.json');
const mediaDir = path.join(dataDir, 'media');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(mediaDir, { recursive: true });
const TEAMS = [
  { id: 'forsta', label: 'Lag Första klass', short: 'Första klass', theme: 'forsta', sound: 'forsta', letter: 'F', color: '#8e44ad' },
  { id: 'dressin', label: 'Lag Dressin', short: 'Dressinen', theme: 'dressin', sound: 'dressin', letter: 'D', color: '#168b53' },
  { id: 'x2000', label: 'Lag X2000', short: 'X2000', theme: 'forsta', sound: 'forsta', letter: 'X', color: '#c0392b' },
  { id: 'malartag', label: 'Lag Mälartåg', short: 'Mälartåg', theme: 'dressin', sound: 'dressin', letter: 'M', color: '#2980b9' },
  { id: 'loket', label: 'Lag Loket', short: 'Loket', theme: 'forsta', sound: 'forsta', letter: 'L', color: '#d68910' },
];
const teamIds = TEAMS.map(t => t.id);
const isTeam = role => teamIds.includes(role);
const teamById = id => TEAMS.find(t => t.id === id);
const roles = ['host', ...teamIds, 'screen'];
const labels = { host: 'Spelledare', screen: 'Storbild', ...Object.fromEntries(TEAMS.map(t => [t.id, t.label])) };
const defaultCodes = { host: 'ledare', forsta: 'förstaklass', dressin: 'dressin', x2000: 'x2000', malartag: 'mälartåg', loket: 'loket', screen: 'storbild' };
const teamPublic = () => TEAMS.map(({ id, short, theme, sound, letter, color }) => ({ id, short, theme, sound, letter, color }));
const sample = [
  { id: crypto.randomUUID(), type: 'destination', title: 'Exempelresa 1', clues: [
    'Vi reser mot en stad där salt luft möter en lång tradition av handel.',
    'Här finns ett berömt nöjesfält och ett stort konstmuseum.',
    'En kanal delar delar av centrum, och hamnen har präglat staden.',
    'Staden kallas ibland Lilla London.',
    'Här ligger Liseberg och Scandinavium.'
  ], answer: 'Göteborg' },
  { id: crypto.randomUUID(), type: 'music', title: 'Exempelmusik: artist', musicQuestions: [{question:'Vilken grupp hör vi?',answer:'ABBA'}], video: null }
];
const fresh = () => ({ questions: sample, game: { phase: 'waiting', questionId: null, clueIndex: 0, answers: {}, round: 0 } });
let db = fs.existsSync(dataFile) ? JSON.parse(fs.readFileSync(dataFile, 'utf8')) : fresh();
function save() { const temp = dataFile + '.tmp'; fs.writeFileSync(temp, JSON.stringify(db, null, 2)); fs.renameSync(temp, dataFile); }
let migrated = false;
for (const q of db.questions) {
  if (q.type === 'music' && !q.musicQuestions) {
    q.musicQuestions = [{question:q.prompt || 'Vilken musik hör vi?',answer:q.answer || ''}];
    migrated = true;
  }
  if (q.type === 'destination' && !Array.isArray(q.films)) {
    // Gamla följdfrågor blir Resefilm 1 (utan video) så att inget innehåll försvinner.
    const old = (q.followups || []).filter(item => item?.question);
    q.films = [0,1,2].map(i => ({ video: '', questions: [0,1].map(j => ({ question: i === 0 ? old[j]?.question || '' : '', answer: i === 0 ? old[j]?.answer || '' : '' })) }));
    delete q.followups; migrated = true;
  }
}
db.tv ||= { mode: 'game', videoSeq: 0, videoAction: null };
db.played ||= [];
if (!fs.existsSync(dataFile) || migrated) save();
let codes;
if (fs.existsSync(codeFile)) codes = { ...defaultCodes, ...JSON.parse(fs.readFileSync(codeFile, 'utf8')) };
else codes = { ...defaultCodes };
fs.writeFileSync(codeFile, JSON.stringify(Object.fromEntries(roles.map(role => [role, codes[role]])), null, 2));
const normalizeCode = code => code.trim().normalize('NFC');
if (roles.some(role => typeof codes[role] !== 'string' || !normalizeCode(codes[role])) || new Set(roles.map(role => normalizeCode(codes[role]))).size !== roles.length) {
  throw new Error('Alla roller i data/codes.json måste ha olika, icke-tomma koder.');
}
const sessions = new Map();
const streams = new Set();
const scores = [10, 8, 6, 4, 2];
const mapScopes = { sweden:{south:55,north:70,west:10,east:25}, europe:{south:35,north:72,west:-12,east:35}, world:{south:-60,north:85,west:-180,east:180} };
db.scores ||= {};
for (const id of teamIds) { if (db.scores[id] == null) { db.scores[id] = 0; migrated = true; } }
function activeTeams() {
  const picked = [...new Set((Array.isArray(db.activeTeams) ? db.activeTeams : []).filter(isTeam))];
  return picked.length >= 2 && picked.length <= 5 ? picked : ['dressin', 'forsta'];
}
if (!Array.isArray(db.activeTeams) || db.activeTeams.length !== activeTeams().length || db.activeTeams.some((id, i) => id !== activeTeams()[i])) {
  db.activeTeams = activeTeams();
  migrated = true;
}
if (migrated) save();
const getQuestion = () => db.questions.find(q => q.id === db.game.questionId);
const clean = s => String(s ?? '').trim().slice(0, 3000);
const inScope = (lat,lon,scope) => Number.isFinite(lat) && Number.isFinite(lon) && lat >= mapScopes[scope].south && lat <= mapScopes[scope].north && lon >= mapScopes[scope].west && lon <= mapScopes[scope].east;
const validViewport = (v,scope) => v && ['west','east','south','north'].every(key => typeof v[key] === 'number' && Number.isFinite(v[key])) && v.west < v.east && v.south < v.north && inScope(v.south,v.west,scope) && inScope(v.north,v.east,scope);
const inViewport = (lat,lon,v) => lat >= v.south && lat <= v.north && lon >= v.west && lon <= v.east;
function distanceKm(a,b) { const toRad = n => n * Math.PI / 180, dLat=toRad(b.lat-a.lat), dLon=toRad(b.lon-a.lon); const h=Math.sin(dLat/2)**2+Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLon/2)**2; return Math.round(6371.0088*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h))*10)/10; }
const CLOSEST_MS = Number(process.env.CLOSEST_MS) || 10000;
function closestResult(g,q) { const target={lat:q.answerLat,lon:q.answerLon}; const distances=Object.fromEntries(activeTeams().filter(team=>g.closestAnswers?.[team]).map(team=>[team,distanceKm(g.closestAnswers[team],target)])); const entries=Object.entries(distances).sort((a,b)=>a[1]-b[1]); const winners=entries.filter(item=>item[1]-entries[0][1] < .1).map(item=>item[0]); return {distances,winners,points:q.points || 10,winner:!entries.length ? null : winners.length > 1 ? 'tie' : entries[0][0]}; }
const closestRemaining = g => (g.closestStage || 0) === 1 ? Math.max(0, (g.closestEndsAt || 0) - Date.now()) : 0;
const filmUsed = f => !!(f?.video || f?.questions?.some(x => x.question || x.answer));
const FILM_POINTS = [0, 1, 3], MUSIC_POINTS = [0, 1, 2];
let tvStatus = null; // senaste rapport från storbilden (video, ljud); sparas inte
const screenOnline = () => [...streams].filter(s => s.role === 'screen').length;
function view(role) {
  const g = db.game, q = getQuestion(), active = !!q && g.phase !== 'waiting', teams = activeTeams();
  const base = { role, label: labels[role], phase: g.phase, round: g.round, teams: teamPublic(), activeTeams: teams, ...(isTeam(role) ? { score: db.scores[role], theme: teamById(role).theme } : {}) };
  if (role === 'host') return { ...base, game: g, scores:db.scores, questions: db.questions, played: db.played, activeQuestion: q || null, remainingMs: closestRemaining(g), closestResult:q?.type==='closest' && g.closestStage === 3 ? closestResult(g,q) : undefined, tv: db.tv, tvStatus, screenOnline: screenOnline(), screenView: view('screen') };
  if (role === 'screen' && db.tv.mode === 'blank') return { ...base, overlay: 'blank' };
  if (role === 'screen' && db.tv.mode === 'scoreboard') return { ...base, overlay: 'scoreboard', scores: Object.fromEntries(teams.map(t => [t, db.scores[t]])) };
  if (!active) return base;
  if (q.type === 'closest') {
    const scope=q.scope;
    if (role === 'screen') {
      const stage=g.closestStage || 0;
      return { ...base, type:'closest', scope, viewport:q.viewport || mapScopes[scope], stage, image:q.image ? `/api/image/${q.image}` : undefined, clue:q.clue || undefined, remainingMs:closestRemaining(g),
        pins:stage >= 2 ? g.closestAnswers : undefined,
        correct:stage >= 3 ? {lat:q.answerLat,lon:q.answerLon} : undefined,
        result:stage >= 3 ? closestResult(g,q) : undefined };
    }
    return { ...base, type:'closest', scope, viewport:q.viewport || mapScopes[scope], stage:g.closestStage || 0, remainingMs:closestRemaining(g), pin:g.closestAnswers?.[role] || null,
      correct:g.closestStage === 3 ? {lat:q.answerLat,lon:q.answerLon} : undefined,
      result:g.closestStage === 3 ? closestResult(g,q) : undefined };
  }
  const visible = { type: q.type, title: q.title, points: q.type === 'destination' ? scores[g.clueIndex] : 1,
    clue: q.type === 'destination' ? q.clues[g.clueIndex] : q.prompt };
  if (role === 'screen') {
    const screenBase = { ...base, type: q.type, points: visible.points, brakes: Object.values(g.brakes || {}) };
    const videoCmd = { seq: db.tv.videoSeq, action: db.tv.videoAction };
    if (q.type === 'music') {
      if (g.musicShown) return { ...screenBase, questions: q.musicQuestions.map(item => item.question),
        answers: g.musicRevealed ? q.musicQuestions.map(item => item.answer) : undefined };
      return { ...screenBase, video: q.video ? `/api/video/${q.video}` : undefined, videoCmd };
    }
    if (g.phase !== 'revealed') return screenBase;
    const film = q.type === 'destination' && Number.isInteger(g.filmIndex) ? q.films?.[g.filmIndex] : null;
    if (film) {
      if (g.filmStage === 'video') return { ...screenBase, filmNumber: g.filmIndex + 1, filmStage: 'video', video: `/api/video/${film.video}`, videoCmd };
      return { ...screenBase, filmNumber: g.filmIndex + 1, filmStage: g.filmStage, questions: film.questions.map(item => item.question),
        answers: g.filmStage === 'revealed' ? film.questions.map(item => item.answer) : undefined };
    }
    return { ...screenBase, answer: q.answer };
  }
  if (q.type === 'music') {
    if (!g.musicShown) return { ...base, type: 'music', listening: true };
    return { ...base, type: 'music-question', questions: q.musicQuestions.map(item => item.question),
      locked: g.musicAnswers?.[role] || null,
      answers: g.musicRevealed ? q.musicQuestions.map(item => item.answer) : undefined };
  }
  if (q.type === 'destination' && g.phase === 'revealed' && Number.isInteger(g.filmIndex) && q.films?.[g.filmIndex]) {
    const film = q.films[g.filmIndex];
    if (g.filmStage === 'video') return { ...base, type: 'film', filmIndex: g.filmIndex, filmStage: 'video' };
    return { ...base, type: 'film', filmIndex: g.filmIndex, filmStage: g.filmStage, questions: film.questions.map(item => item.question),
      locked: g.filmAnswers?.[g.filmIndex]?.[role] || null,
      answers: g.filmStage === 'revealed' ? film.questions.map(item => item.answer) : undefined };
  }
  const mine = g.answers[role];
  if (mine) return { ...base, type: q.type, locked: mine, answer: g.phase === 'revealed' ? q.answer : undefined };
  return { ...base, type: q.type, points: visible.points, pulled: !!g.brakes?.[role], brakeBlocked:q.type==='destination' && !!Object.keys(g.brakes||{}).length && !g.brakes?.[role], locked: null, answer: g.phase === 'revealed' ? q.answer : undefined };
}
const seesScreen = role => role === 'screen' || role === 'host';
function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}
function cookie(req) { return (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('sid='))?.slice(4); }
function roleOf(req) { return sessions.get(cookie(req))?.role; }
function broadcast(only) { for (const stream of streams) { if (only && stream.role !== only) continue; try { stream.res.write(`data: ${JSON.stringify(view(stream.role))}\n\n`); } catch { streams.delete(stream); } } }
function body(req) { return new Promise((resolve, reject) => { let raw = ''; req.on('data', c => { raw += c; if (raw.length > 100000) { reject(new Error('För stor begäran')); req.destroy(); } }); req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { reject(new Error('Ogiltig JSON')); } }); }); }
function validQuestion(input) {
  const type = ['music','closest'].includes(input.type) ? input.type : 'destination';
  const q = { id: input.id || crypto.randomUUID(), type, title: clean(input.title).slice(0, 120), answer: clean(input.answer).slice(0, 200) };
  if (type === 'destination') q.clues = Array.isArray(input.clues) ? input.clues.map(clean).slice(0, 5) : [];
  if (type === 'destination') {
    const films = Array.isArray(input.films) ? input.films : [];
    q.films = [0,1,2].map(i => ({ video: clean(films[i]?.video), questions: [0,1].map(j => ({ question: clean(films[i]?.questions?.[j]?.question).slice(0, 500), answer: clean(films[i]?.questions?.[j]?.answer).slice(0, 200) })) }));
    for (const [i, film] of q.films.entries()) {
      if (film.video && (!/^[a-f0-9-]{36}\.mp4$/.test(film.video) || !fs.existsSync(path.join(mediaDir, film.video)))) throw new Error(`Videon till Resefilm ${i + 1} finns inte. Ladda upp den igen.`);
      if (filmUsed(film) && film.questions.some(item => !item.question || !item.answer)) throw new Error(`Fyll i två frågor med facit för Resefilm ${i + 1}, eller lämna den helt tom.`);
    }
  }
  if (type === 'music') {
    q.video = clean(input.video);
    q.musicQuestions = Array.isArray(input.musicQuestions) ? input.musicQuestions.slice(0, 2).map(item => ({question:clean(item?.question).slice(0,500),answer:clean(item?.answer).slice(0,200)})).filter(item => item.question || item.answer) : [];
    if (!/^[a-f0-9-]{36}\.mp4$/.test(q.video) || !fs.existsSync(path.join(mediaDir,q.video))) throw new Error('Ladda upp en MP4-fil för musikfrågan.');
    if (q.musicQuestions.length !== 2 || q.musicQuestions.some(item => !item.question || !item.answer)) throw new Error('Fyll i två musikfrågor med facit.');
  }
  if (type === 'closest') {
    q.image = clean(input.image); q.clue = clean(input.clue).slice(0, 300); q.points = Number(input.points ?? 10); q.scope = 'world';
    q.answerLat = Number(input.answerLat); q.answerLon = Number(input.answerLon);
    if ((!q.image && !q.clue) || (q.image && (!/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(q.image) || !fs.existsSync(path.join(mediaDir,q.image)))) || !Number.isInteger(q.points) || q.points < 1 || q.points > 100 || input.answerLat === '' || input.answerLon === '' || input.answerLat == null || input.answerLon == null || !inScope(q.answerLat,q.answerLon,q.scope)) throw new Error('Ange ledtråd (bild och/eller text), 1–100 poäng och rätt plats på kartan.');
    q.viewport = input.viewport;
    if (!validViewport(q.viewport,q.scope) || !inViewport(q.answerLat,q.answerLon,q.viewport)) throw new Error('Kartutsnittet måste ligga inom området och innehålla rätt plats.');
  }
  if (!q.title || (type === 'destination' && (!q.answer || q.clues.length !== 5 || q.clues.some(x => !x)))) throw new Error('Fyll i titel, facit och alla ledtrådar.');
  return q;
}
async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const role = roleOf(req);
  if (p === '/api/login' && req.method === 'POST') {
    const input = await body(req);
    const matchedRole = typeof input.code === 'string' && roles.find(role => normalizeCode(input.code) === normalizeCode(codes[role]));
    if (!matchedRole) return send(res, 401, { error: 'Fel kod.' });
    if (isTeam(matchedRole) && !activeTeams().includes(matchedRole)) return send(res, 403, { error: 'Laget är inte aktivt i den här omgången.' });
    const sid = crypto.randomBytes(32).toString('hex'); sessions.set(sid, { role: matchedRole });
    return send(res, 200, { role: matchedRole }, { 'Set-Cookie': `sid=${sid}; HttpOnly; SameSite=Strict; Path=/` });
  }
  if (p === '/api/logout' && req.method === 'POST') { sessions.delete(cookie(req)); return send(res, 200, {}, { 'Set-Cookie': 'sid=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict' }); }
  if (p === '/api/me') return send(res, 200, { role: role || null });
  if (p === '/api/image/upload' && req.method === 'POST') {
    if (role !== 'host' || req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return send(res,403,{error:'Ingen åtkomst.'});
    const extensions={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'};
    const extension=extensions[req.headers['content-type']];
    if (!extension) return send(res,415,{error:'Välj en PNG-, JPG- eller WebP-bild.'});
    const file=`${crypto.randomUUID()}.${extension}`, target=path.join(mediaDir,file);
    let bytes=0;
    try {
      await pipeline(req,new Transform({transform(chunk,encoding,done){bytes+=chunk.length;done(bytes>20*1024*1024?new Error('Bilden får vara högst 20 MB.'):null,chunk);}}),fs.createWriteStream(target,{flags:'wx'}));
      const head=Buffer.alloc(12),fd=fs.openSync(target,'r'); try { fs.readSync(fd,head,0,12,0); } finally { fs.closeSync(fd); }
      const valid=extension==='png' ? head.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : extension==='jpg' ? head[0]===255 && head[1]===216 && head[2]===255 : head.toString('ascii',0,4)==='RIFF' && head.toString('ascii',8,12)==='WEBP';
      if (!valid) throw new Error('Filen verkar inte vara en giltig bild.');
      return send(res,200,{image:file});
    } catch(error) { try { fs.rmSync(target,{force:true}); } catch {} if (!res.headersSent) return send(res,400,{error:error.message}); return; }
  }
  if (p.startsWith('/api/image/') && req.method === 'GET') {
    const file=p.slice('/api/image/'.length), q=getQuestion();
    if (!seesScreen(role) || q?.type!=='closest' || q.image!==file || db.game.phase!=='active' || !/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(file)) return send(res,403,{error:'Ingen åtkomst.'});
    const target=path.join(mediaDir,file);
    if (!fs.existsSync(target)) return send(res,404,{error:'Bilden finns inte.'});
    const mime=file.endsWith('.png')?'image/png':file.endsWith('.jpg')?'image/jpeg':'image/webp';
    res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store'});
    return fs.createReadStream(target).pipe(res);
  }
  if (p === '/api/video/upload' && req.method === 'POST') {
    if (role !== 'host' || req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return send(res, 403, { error: 'Ingen åtkomst.' });
    if (req.headers['content-type'] !== 'video/mp4') return send(res, 415, { error: 'Välj en MP4-fil.' });
    const file = `${crypto.randomUUID()}.mp4`, target = path.join(mediaDir,file);
    let bytes = 0;
    try {
      await pipeline(req, new Transform({transform(chunk, encoding, done) { bytes += chunk.length; done(bytes > 250 * 1024 * 1024 ? new Error('Videon får vara högst 250 MB.') : null, chunk); }}), fs.createWriteStream(target, {flags:'wx'}));
      const head = Buffer.alloc(12);
      const fd = fs.openSync(target,'r'); try { fs.readSync(fd,head,0,12,0); } finally { fs.closeSync(fd); }
      if (bytes < 12 || head.toString('ascii',4,8) !== 'ftyp') throw new Error('Filen verkar inte vara en MP4-video.');
      return send(res, 200, { video:file });
    } catch (error) { try { fs.rmSync(target,{force:true}); } catch {} if (!res.headersSent) return send(res,400,{error:error.message}); return; }
  }
  if (p.startsWith('/api/video/') && req.method === 'GET') {
    const file = p.slice('/api/video/'.length);
    const vq = getQuestion(), vg = db.game;
    const allowed = vq?.type === 'music' ? vg.phase === 'active' && vq.video === file
      : vq?.type === 'destination' && vg.phase === 'revealed' && vg.filmStage === 'video' && vq.films?.[vg.filmIndex]?.video === file;
    if (!seesScreen(role) || !allowed || !/^[a-f0-9-]{36}\.mp4$/.test(file)) return send(res,403,{error:'Ingen åtkomst.'});
    const target = path.join(mediaDir,file);
    if (!fs.existsSync(target)) return send(res,404,{error:'Videon finns inte.'});
    const size = fs.statSync(target).size;
    const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    const start = match ? Number(match[1]) : 0;
    const end = match ? Math.min(match[2] ? Number(match[2]) : size - 1,size - 1) : size - 1;
    if (start >= size || end < start) return send(res,416,{error:'Ogiltigt videointervall.'},{'Content-Range':`bytes */${size}`});
    res.writeHead(match ? 206 : 200, {'Content-Type':'video/mp4','Content-Length':end-start+1,'Accept-Ranges':'bytes','Cache-Control':'no-store',...(match ? {'Content-Range':`bytes ${start}-${end}/${size}`} : {})});
    return fs.createReadStream(target,{start,end}).pipe(res);
  }
  if (p.startsWith('/api/')) {
    if (!role) return send(res, 401, { error: 'Logga in.' });
    // Spelledaren kan öppna storbilden i en egen flik med samma inloggning (?view=screen).
    const viewRole = role === 'host' && url.searchParams.get('view') === 'screen' ? 'screen' : role;
    if (p === '/api/state' && req.method === 'GET') return send(res, 200, view(viewRole));
    if (p === '/api/events' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify(view(viewRole))}\n\n`);
      const stream = { res, role: viewRole }; streams.add(stream);
      if (viewRole === 'screen') broadcast('host');
      req.on('close', () => { streams.delete(stream); if (viewRole === 'screen') { if (!screenOnline()) tvStatus = null; broadcast('host'); } }); return;
    }
    if (req.method !== 'POST' || req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return send(res, 403, { error: 'Ingen åtkomst.' });
    const input = await body(req);
    if (p === '/api/brake' && activeTeams().includes(role)) {
      const g = db.game;
      if (g.phase !== 'active' || getQuestion()?.type !== 'destination' || input.round !== g.round || g.answers[role] || (Object.keys(g.brakes||{}).length && !g.brakes?.[role])) return send(res, 409, { error: 'Nödbromsen är redan dragen på den här poängnivån.' });
      g.brakes ||= {};
      if (!g.brakes[role]) {
        g.brakes[role] = { id: crypto.randomUUID(), team: role };
        save(); broadcast();
      }
      return send(res, 200, view(role));
    }
    if (p === '/api/answer' && activeTeams().includes(role)) {
      const g = db.game, q = getQuestion();
      if (g.phase !== 'active' || !q || g.answers[role]) return send(res, 409, { error: 'Svaret är redan låst eller frågan är stängd.' });
      if (q.type === 'destination' && !g.brakes?.[role]) return send(res, 409, { error: 'Dra nödbromsen innan ni svarar.' });
      const answer = clean(input.answer).slice(0, 200);
      if (!answer) return send(res, 400, { error: 'Skriv ett svar.' });
      g.answers[role] = { answer, points: q.type === 'destination' ? scores[g.clueIndex] : 1 };
      save(); broadcast(); return send(res, 200, view(role));
    }
    if (p === '/api/film-answer' && activeTeams().includes(role)) {
      const g = db.game, index = g.filmIndex;
      if (g.phase !== 'revealed' || getQuestion()?.type !== 'destination' || !Number.isInteger(index) || input.round !== g.round || input.index !== index || g.filmStage !== 'questions' || g.filmAnswers?.[index]?.[role]) return send(res, 409, { error: 'Resefilmens frågor är stängda eller svaret redan låst.' });
      const answers = [0,1].map(i => clean(Array.isArray(input.answers) ? input.answers[i] : '').slice(0, 200));
      if (!answers.some(Boolean)) return send(res, 400, { error: 'Skriv minst ett svar.' });
      g.filmAnswers ||= {};
      g.filmAnswers[index] ||= {};
      g.filmAnswers[index][role] = answers;
      save(); broadcast(); return send(res, 200, view(role));
    }
    if (p === '/api/tv/status' && seesScreen(role)) {
      const num = v => Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v) * 10) / 10) : 0;
      tvStatus = { video: !!input.video, playing: !!input.playing, ended: !!input.ended, time: num(input.time), duration: num(input.duration), audioReady: !!input.audioReady };
      broadcast('host'); return send(res, 200, {});
    }
    if (p === '/api/music-answer' && activeTeams().includes(role)) {
      const g = db.game;
      if (g.phase !== 'active' || getQuestion()?.type !== 'music' || !g.musicShown || input.round !== g.round || g.musicRevealed || g.musicAnswers?.[role]) return send(res,409,{error:'Musikfrågan är stängd eller svaret redan låst.'});
      const answer = clean(input.answer).slice(0,2000);
      if (!answer) return send(res,400,{error:'Skriv ett svar.'});
      g.musicAnswers ||= {}; g.musicAnswers[role] = answer;
      save(); broadcast(); return send(res,200,view(role));
    }
    if (p === '/api/closest-answer' && activeTeams().includes(role)) {
      const g=db.game,q=getQuestion(),lat=Number(input.lat),lon=Number(input.lon);
      if (g.phase!=='active' || q?.type!=='closest' || input.round!==g.round || g.closestStage!==1 || Date.now() > (g.closestEndsAt || 0) + 500) return send(res,409,{error:'Tiden är ute eller nålen kan inte flyttas nu.'});
      if (input.lat == null || input.lon == null || input.lat === '' || input.lon === '' || !inScope(lat,lon,q.scope) || !inViewport(lat,lon,q.viewport || mapScopes[q.scope])) return send(res,400,{error:'Sätt kartnålen inom det sparade kartutsnittet.'});
      g.closestAnswers ||= {}; g.closestAnswers[role]={lat,lon};
      save(); broadcast(); return send(res,200,view(role));
    }
    if (role !== 'host') return send(res, 403, { error: 'Ingen åtkomst.' });
    if (p === '/api/teams') {
      const teams = Array.isArray(input.teams) ? [...new Set(input.teams.filter(isTeam))] : [];
      if (db.game.phase !== 'waiting') return send(res, 409, { error: 'Lagen kan bara ändras mellan frågorna.' });
      if (teams.length < 2 || teams.length > 5) return send(res, 400, { error: 'Välj mellan 2 och 5 lag.' });
      db.activeTeams = teams; save(); broadcast(); return send(res, 200, view(role));
    }
    if (p === '/api/score/add') {
      const delta=Number(input.delta);
      if (!activeTeams().includes(input.team) || !Number.isInteger(delta) || delta===0 || Math.abs(delta)>100 || db.scores[input.team]+delta<0) return send(res,400,{error:'Ange lag och 1–100 poäng. Poängen kan inte bli negativa.'});
      db.scores[input.team]+=delta; save(); broadcast(); return send(res,200,view(role));
    }
    if (p === '/api/tv') {
      if (!['game','scoreboard','blank'].includes(input.mode)) return send(res,400,{error:'Okänt läge för storbilden.'});
      db.tv.mode = input.mode; save(); broadcast(); return send(res,200,view(role));
    }
    if (p === '/api/tv/video') {
      if (!['play','pause','restart'].includes(input.action)) return send(res,400,{error:'Okänt videokommando.'});
      db.tv.videoSeq++; db.tv.videoAction = input.action; save(); broadcast(); return send(res,200,view(role));
    }
    if (p === '/api/played/reset') { db.played = []; save(); broadcast(); return send(res,200,view(role)); }
    if (p === '/api/question/save') {
      const q = validQuestion(input);
      const i = db.questions.findIndex(x => x.id === q.id);
      if (i < 0) db.questions.push(q); else db.questions[i] = q;
      save(); broadcast(); return send(res, 200, view(role));
    }
    if (p === '/api/question/delete') {
      if (db.game.questionId === input.id && db.game.phase !== 'waiting') return send(res, 409, { error: 'Aktiv fråga kan inte tas bort.' });
      db.questions = db.questions.filter(x => x.id !== input.id); save(); broadcast(); return send(res, 200, view(role));
    }
    if (p === '/api/question/move') {
      const index = db.questions.findIndex(q => q.id === input.id);
      if (index < 0 || ![-1,1].includes(input.direction) || index + input.direction < 0 || index + input.direction >= db.questions.length) return send(res,409,{error:'Frågan kan inte flyttas dit.'});
      [db.questions[index],db.questions[index + input.direction]] = [db.questions[index + input.direction],db.questions[index]];
      save(); broadcast(); return send(res,200,view(role));
    }
    const g = db.game;
    if (p === '/api/game/start') {
      const startQuestion = db.questions.find(q => q.id === input.id);
      if (!startQuestion) return send(res, 404, { error: 'Frågan finns inte.' });
      if (startQuestion.type === 'music' && (!startQuestion.video || startQuestion.musicQuestions?.length !== 2)) return send(res,409,{error:'Redigera musikfrågan och lägg till MP4-video samt två frågor först.'});
      db.game = { phase: 'active', questionId: input.id, clueIndex: 0, answers: {}, filmAnswers: {}, musicAnswers: {}, closestAnswers: {}, closestStage: 0, closestEndsAt: 0, closestScored: false, brakes: {}, awards: {}, round: g.round + 1 };
      db.tv.mode = 'game';
      if (!db.played.includes(input.id)) db.played.push(input.id);
    } else if (p === '/api/game/next') {
      if (g.phase !== 'active' || getQuestion()?.type !== 'destination' || g.clueIndex >= 4) return send(res, 409, { error: 'Ingen ytterligare ledtråd.' });
      g.clueIndex++;
      g.brakes = {};
    } else if (p === '/api/game/reveal') {
      if (g.phase !== 'active' || getQuestion()?.type !== 'destination') return send(res, 409, { error: 'Ingen aktiv resa.' });
      g.phase = 'revealed';
    } else if (p === '/api/game/music-question') {
      if (g.phase !== 'active' || getQuestion()?.type !== 'music' || g.musicShown) return send(res,409,{error:'Musikfrågorna kan inte visas ännu.'});
      g.musicShown = true; g.musicRevealed = false;
    } else if (p === '/api/game/music-reveal') {
      if (g.phase !== 'active' || getQuestion()?.type !== 'music' || !g.musicShown || g.musicRevealed) return send(res,409,{error:'Inga musikfrågor att avslöja.'});
      g.musicRevealed = true;
    } else if (p === '/api/game/closest-stage') {
      const stage=Number(input.stage);
      const q=getQuestion();
      if (g.phase!=='active' || q?.type!=='closest' || ![1,2,3].includes(stage) || stage!==(g.closestStage||0)+1 || (stage===2 && Date.now() < (g.closestEndsAt || 0))) return send(res,409,{error:'Kartan kan inte visas i det steget ännu.'});
      g.closestStage=stage;
      if (stage===1) { g.closestEndsAt=Date.now()+CLOSEST_MS; const round=g.round; setTimeout(() => { const cur=db.game; if (cur.round===round && cur.phase==='active' && cur.closestStage===1) { cur.closestStage=2; save(); broadcast(); } }, CLOSEST_MS+50).unref(); }
      if (stage===3 && !g.closestScored) { g.closestScored=true; const result=closestResult(g,q); for (const team of result.winners) db.scores[team]+=result.points; }
    } else if (p === '/api/game/film') {
      // Resefilmer körs i ordning; tomma filmer får hoppas över, men en påbörjad film måste avslöjas först.
      const index = Number(input.index), film = getQuestion()?.films?.[index];
      if (g.phase !== 'revealed' || getQuestion()?.type !== 'destination' || !Number.isInteger(index) || index < 0 || index > 2 || !filmUsed(film) || index <= (g.filmIndex ?? -1) || (Number.isInteger(g.filmIndex) && g.filmStage !== 'revealed')) return send(res, 409, { error: 'Resefilmen kan inte startas ännu.' });
      g.filmIndex = index; g.filmStage = film.video ? 'video' : 'questions'; g.filmAnswers ||= {};
    } else if (p === '/api/game/film-questions') {
      if (g.phase !== 'revealed' || g.filmStage !== 'video') return send(res, 409, { error: 'Ingen resefilm visas just nu.' });
      g.filmStage = 'questions';
    } else if (p === '/api/game/film-reveal') {
      if (g.phase !== 'revealed' || g.filmStage !== 'questions') return send(res, 409, { error: 'Inga resefilmsfrågor att avslöja.' });
      g.filmStage = 'revealed';
    } else if (p === '/api/game/award') {
      // Sätter (inte adderar) ett lags poäng för en del av frågan, så att ett nytt tryck rättar ett tidigare.
      const q = getQuestion(), team = input.team, key = String(input.key || ''), value = input.value, film = /^film([0-2])$/.exec(key);
      if (g.phase === 'waiting' || !q || !activeTeams().includes(team) || !/^(dest|music|film[0-2])$/.test(key)) return send(res, 409, { error: 'Ingen aktiv fråga att dela ut poäng för.' });
      let points = null;
      if (value === null) points = 0;
      else if (key === 'dest' && q.type === 'destination' && g.answers?.[team] && typeof value === 'boolean') points = value ? g.answers[team].points : 0;
      else if (film && q.type === 'destination' && g.phase === 'revealed' && Number(film[1]) <= (g.filmIndex ?? -1) && filmUsed(q.films?.[film[1]]) && [0,1,2].includes(value)) points = FILM_POINTS[value];
      else if (key === 'music' && q.type === 'music' && g.musicShown && [0,1,2].includes(value)) points = MUSIC_POINTS[value];
      if (points === null) return send(res, 400, { error: 'Poängen kan inte delas ut för det här svaret.' });
      g.awards ||= {}; g.awards[key] ||= {};
      const previous = g.awards[key][team]?.points || 0;
      if (db.scores[team] + points - previous < 0) return send(res, 409, { error: 'Poängen kan inte bli negativa.' });
      db.scores[team] += points - previous;
      if (value === null) delete g.awards[key][team]; else g.awards[key][team] = { value, points };
    } else if (p === '/api/game/wait') {
      db.game = { phase: 'waiting', questionId: null, clueIndex: 0, answers: {}, round: g.round, lastQuestionId: g.questionId || g.lastQuestionId || null };
    } else return send(res, 404, { error: 'Hittades inte.' });
    save(); broadcast(); return send(res, 200, view(role));
  }
  const assets = { '/assets/nodbroms.png': ['nodbroms.png', 'image/png'], '/assets/dressin.ogg': ['dressin.ogg', 'audio/ogg'], '/assets/forstaklass.ogg': ['forstaklass.ogg', 'audio/ogg'], '/assets/resmal-loop.mp3': ['resmal-loop.mp3', 'audio/mpeg'], '/assets/land.geojson': ['land.geojson', 'application/geo+json'] };
  if (assets[p]) {
    if ((p.endsWith('.ogg') || p.endsWith('.mp3')) && !seesScreen(role)) return send(res, role ? 403 : 401, { error: 'Ingen åtkomst.' });
    res.writeHead(200, { 'Content-Type': assets[p][1], 'Cache-Control': 'no-store' });
    return fs.createReadStream(path.join(root, 'public', 'assets', assets[p][0])).pipe(res);
  }
  if (p === '/' || p === '/app.js' || p === '/map.js' || p === '/style.css' || p.startsWith('/view/')) {
    if (p.startsWith('/view/') && !role) { res.writeHead(302, { Location: '/', 'Cache-Control': 'no-store' }); return res.end(); }
    if (p.startsWith('/view/') && p.split('/')[2] !== role && !(p === '/view/screen' && role === 'host')) return send(res, 403, { error: 'Ingen åtkomst.' });
    const file = p === '/app.js' ? 'app.js' : p === '/map.js' ? 'map.js' : p === '/style.css' ? 'style.css' : 'index.html';
    res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return fs.createReadStream(path.join(root, 'public', file)).pipe(res);
  }
  send(res, 404, { error: 'Hittades inte.' });
}
const server = http.createServer((req, res) => Promise.resolve(handler(req, res)).catch(e => { if (!res.headersSent) send(res, 400, { error: e.message }); }));
if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const openUrl = target => { const { spawn } = require('node:child_process'); const [cmd, args] = process.platform === 'darwin' ? ['open', [target]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', target]] : ['xdg-open', [target]]; spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => console.log('Kunde inte öppna webbläsaren. Öppna ' + target + ' själv.')).unref(); };
  server.listen(port, '0.0.0.0', () => {
    console.log(`Öppna http://localhost:${port} | Koder: ${codeFile}`);
    if (!process.stdin.isTTY) return;
    // Kortkommandon i terminalen: O = spelledarvyn, N = storbilden i en ny flik (samma inloggning som spelledaren).
    console.log('Tryck O för att öppna spelledarvyn, N för att öppna storbilden i en ny flik, Q för att avsluta.');
    process.stdin.setRawMode(true); process.stdin.resume();
    process.stdin.on('data', key => {
      const k = String(key).toLowerCase();
      if (k === '\u0003' || k === 'q') process.exit(0);
      if (k === 'o') openUrl(`http://localhost:${port}/`);
      if (k === 'n') { openUrl(`http://localhost:${port}/view/screen`); console.log('Storbilden öppnas. Dra fliken till TV:n, gör den till helskärm och klicka Aktivera ljud.'); }
    });
  });
}
module.exports = { server };
