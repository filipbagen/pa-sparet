(() => {
'use strict';
const app = document.querySelector('#app');
let state = null, editing = null, brakeOpen = false, editingPin = null, editingViewport = null, draftPin = null, closestDeadline = 0;
let asScreen = false, localHost = false, showLogin = false, hostTab = 'show', hostFocus = '', stepPending = false, videoSeq = null, lastReport = 0, videoMemory = null, lastHadVideo = null;
let brakePending = false, audioContext = null, audioReady = false, audioLoading = false, audioError = '', audioNextTime = 0, destinationSource = null, destinationRound = null, destinationPlaybackRound = null, destinationOffset = 0, destinationStartedAt = 0;
const soundBuffers = {}, seenBrakes = new Set();
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const teamMeta = id => (state?.teams || []).find(t => t.id === id);
const activeTeamList = () => (state?.activeTeams || []).map(id => teamMeta(id)).filter(Boolean);
const teamLabel = id => teamMeta(id)?.short || id;
const answerSlots = getter => activeTeamList().map(t => `<div>${esc(t.short)}: ${getter(t.id)}</div>`).join('');
async function api(path, data) {
  const res = await fetch('/api/' + path, { method: data === undefined ? 'GET' : 'POST', headers: data === undefined ? {} : {'Content-Type':'application/json'}, body: data === undefined ? undefined : JSON.stringify(data) });
  const json = await res.json(); if (!res.ok) throw Error(json.error || 'Något gick fel.'); return json;
}
let pinSending = false, pinPending = null;
function pushPin(point) { pinPending = {...point}; if (pinSending) return; pinSending = true; (async () => { while (pinPending) { const next = pinPending; pinPending = null; try { await api('closest-answer', {...next, round: state.round}); } catch {} } pinSending = false; })(); }
const trackDeadline = data => { if (data?.remainingMs > 0) closestDeadline = performance.now() + (data.remainingMs || 0); };
async function action(path, data = {}) { try { state = await api(path, data); trackDeadline(state); render(); } catch (e) { alert(e.message); } }
function render() {
  if (!state?.role) {
    if (state?.guest) document.body.className = 'guest';
    app.innerHTML = state?.guest && !showLogin ? joinView() : `<section class="login card"><h1>På resande fot</h1><p>Ange din kod för att komma till rätt vy.</p><form id="login"><label>Åtkomstkod<input name="code" type="password" required autocomplete="current-password" autocapitalize="none" spellcheck="false"></label><button>Logga in</button></form>${state?.guest ? '<p class="hint"><a href="#" id="backToTeams">Tillbaka till lagvalet</a></p>' : ''}</section>`;
    bindGuest(); return;
  }
  document.body.className = state.theme || state.role;
  const oldVideo = document.querySelector('#musicVideo');
  if (oldVideo?.getAttribute) videoMemory = { src: oldVideo.getAttribute('src'), time: oldVideo.currentTime, paused: oldVideo.paused };
  app.innerHTML = (state.role === 'host' ? host() : state.role === 'screen' ? screen() : `<div class="team-score" aria-live="polite">Lagets poäng <strong>${state.score ?? 0}</strong></div>` + team()) + (localHost && state.role === 'host' ? '' : `<button class="exit-button" id="logout">${asScreen ? 'Stäng storbild' : 'Avsluta'}</button>`);
  // Storbilden som spelledaren öppnat delar inloggning med spelledaren: stäng fliken i stället för att logga ut.
  const logout = document.querySelector('#logout');
  if (logout) logout.onclick = async () => { if (asScreen) { window.close(); return; } await api('logout', {}); location.href = '/'; };
  if (state.role === 'host') bindHost();
  if (state.teams?.some(t => t.id === state.role)) bindTeam();
  if (state.role === 'screen') document.querySelector('#enableSound')?.addEventListener('click', enableSound);
  mountMaps();
  const video = document.querySelector('#musicVideo');
  if (video) {
    const playButton = document.querySelector('#playVideo');
    // Samma video som innan (t.ex. efter Ställning/Svart skärm) fortsätter där den var, i samma läge.
    const resume = videoMemory && video.getAttribute && videoMemory.src === video.getAttribute('src') ? videoMemory : null;
    if (resume) { video.currentTime = resume.time; }
    if (resume?.paused) { video.autoplay = false; video.pause?.(); }
    else video.play().catch(() => { playButton.hidden = false; });
    playButton.onclick = () => video.play().then(() => { playButton.hidden = true; }).catch(() => { playButton.hidden = false; });
    video.onplay = video.onpause = video.onended = video.onloadedmetadata = () => reportTv(true);
    video.ontimeupdate = () => reportTv(false);
  } else videoMemory = null;
  if (state.role === 'screen' && !!video !== lastHadVideo) { lastHadVideo = !!video; reportTv(true); }
}
// Storbilden berättar för spelledaren om videon spelar och om ljudet är aktiverat.
function reportTv(force) {
  if (state?.role !== 'screen') return;
  const now = performance.now(); if (!force && now - lastReport < 1000) return; lastReport = now;
  const v = document.querySelector('#musicVideo');
  try { fetch('/api/tv/status', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({video:!!v, playing:!!v && !v.paused && !v.ended, ended:!!v?.ended, time:v?.currentTime || 0, duration:v?.duration || 0, audioReady})})?.catch?.(() => {}); } catch {}
}
function applyVideoCmd() {
  const cmd = state?.videoCmd; if (state?.role !== 'screen' || !cmd) return;
  if (videoSeq === null || cmd.seq < videoSeq) { videoSeq = cmd.seq; return; }
  if (cmd.seq === videoSeq) return; videoSeq = cmd.seq;
  const v = document.querySelector('#musicVideo'); if (!v) return;
  if (cmd.action === 'pause') v.pause?.(); else { if (cmd.action === 'restart') v.currentTime = 0; v.play?.()?.catch?.(() => { const b = document.querySelector('#playVideo'); if (b) b.hidden = false; }); }
}
// Telefonens lagval: alla lag visas, upptagna lag är låsta.
function joinView() {
  const claimed = state.claimed || [], teams = state.teams || [], list = state.lobby ? teams : teams.filter(t => (state.activeTeams || []).includes(t.id));
  const free = list.filter(t => !claimed.includes(t.id));
  const title = state.lobby ? 'Välj ert lag' : free.length ? 'Spelet är igång – välj ert lag' : 'Spelet har redan börjat';
  return `<section class="join card"><div class="eyebrow">På resande fot</div><h1>${title}</h1>${list.length && (state.lobby || free.length) ? `<div class="join-grid">${list.map(t => { const taken = claimed.includes(t.id); return `<button class="join-team" style="--team:${esc(t.color)}" data-join="${esc(t.id)}" ${taken ? 'disabled' : ''}><b>${esc(t.short)}</b><small>${taken ? 'Upptaget' : 'Tryck för att välja'}</small></button>`; }).join('')}</div>` : '<p>Be spelledaren öppna lobbyn igen om ni vill vara med.</p>'}<p class="hint"><a href="#" id="codeLogin">Logga in med kod</a></p></section>`;
}
function bindGuest() {
  (document.querySelectorAll?.('[data-join]') || []).forEach(b => b.addEventListener('click', async () => { b.disabled = true; try { await api('join', { team: b.dataset.join }); location.href = '/view/' + b.dataset.join; } catch (e) { alert(e.message); b.disabled = false; } }));
  document.querySelector('#codeLogin')?.addEventListener('click', e => { e.preventDefault(); showLogin = true; render(); });
  document.querySelector('#backToTeams')?.addEventListener('click', e => { e.preventDefault(); showLogin = false; render(); });
}
const qrSvg = text => { try { return typeof window !== 'undefined' && window.QR && text ? window.QR.svg(text) : ''; } catch { return ''; } };
function screenKey(data) { return JSON.stringify([data.round,data.phase,data.type,data.points,data.overlay,data.scores,data.lobby,data.claimed,data.joinUrl,data.filmNumber,data.filmStage,data.answer,data.video,data.questions,data.answers,data.stage,data.image,data.clue,data.pins,data.correct,data.result,data.type==='destination'?data.brakes:undefined]); }
function resultText(result) {
  if (!result) return '';
  const winners = result.winners || [];
  const title = !winners.length ? 'Inget lag satte en nål' : winners.length > 1 ? 'Oavgjort: ' + winners.map(teamLabel).join(' och ') : 'Närmast: ' + teamLabel(winners[0]);
  const rows = activeTeamList().map(t => ({ t, d: result.distances?.[t.id] })).sort((a,b) => (a.d ?? Infinity) - (b.d ?? Infinity));
  return `<div class="closest-result"><h2>${esc(title)}</h2><table class="closest-table"><thead><tr><th>#</th><th>Lag</th><th>Avstånd</th><th>Poäng</th></tr></thead><tbody>${rows.map(({t,d}) => `<tr${winners.includes(t.id) ? ' class="winner"' : ''}><td>${d == null ? '–' : rows.findIndex(r => r.d === d) + 1}</td><td>${esc(t.short)}</td><td>${d == null ? '–' : d + ' km'}</td><td>${winners.includes(t.id) ? '+' + result.points : '–'}</td></tr>`).join('')}</tbody></table></div>`;
}
function mountMaps() {
  if (typeof window === 'undefined' || !window.GameMap) return;
  window.GameMap.cleanup?.();
  const editorMap=document.querySelector('#correctMap');
  if (editorMap) {
    const scope='world';
    const question=state.questions.find(item=>item.id===editing);
    const saved=question?.viewport || null;
    // Obs: sidan har även <meta name="viewport">, så fälten måste sökas inom formuläret.
    const viewport=document.querySelector('#questionForm [name="viewport"]').value;
    const draw=()=>window.GameMap.draw(editorMap,{scope,viewport:viewport?JSON.parse(viewport):saved,key:'editor',pins:editingPin?{mine:editingPin}:{},onViewport:area=>{editingViewport=area;document.querySelector('#questionForm [name="viewport"]').value=JSON.stringify(area);},onPick:point=>{editingPin=point;document.querySelector('#questionForm [name="answerLat"]').value=point.lat;document.querySelector('#questionForm [name="answerLon"]').value=point.lon;draw();}});
    draw();
  }
  const teamMap=document.querySelector('#teamMap');
  if (teamMap) {
    if (state.stage===1 && !draftPin && !state.pin) { const v=state.viewport; draftPin={lat:+((v.north+v.south)/2).toFixed(5),lon:+((v.east+v.west)/2).toFixed(5)}; pushPin(draftPin); }
    const pin=state.stage===1?(draftPin||state.pin):state.pin;
    window.GameMap.draw(teamMap,{scope:state.scope,viewport:state.viewport,locked:true,key:'team:'+state.round,pins:pin?{mine:{...pin}}:{},correct:state.correct,onDrag:state.stage===1?(point,final)=>{ if (performance.now()>closestDeadline) return; draftPin={...point}; pushPin(draftPin); }:null});
  }
  const screenMap=document.querySelector('#screenMap');
  if (screenMap) window.GameMap.draw(screenMap,{scope:state.scope,viewport:state.viewport,locked:true,key:'screen:'+state.round,pins:state.pins||{},correct:state.correct});
  const previewMap=document.querySelector('#previewMap'), sv=state.screenView;
  if (previewMap && sv) window.GameMap.draw(previewMap,{scope:sv.scope,viewport:sv.viewport,locked:true,key:'preview:'+sv.round,pins:sv.pins||{},correct:sv.correct});
}
const typeName = t => ({destination:'Resmål',music:'Musikfråga',closest:'Närmast vinner'})[t] || t;
const filmUsed = f => !!(f?.video || f?.questions?.some(x => x.question || x.answer));
const CLUE_POINTS = [10,8,6,4,2];
const fmtTime = s => { s = Math.floor(s || 0); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
function nextQuestion() {
  const qs = state.questions || [], played = state.played || [], ref = state.game.questionId || state.game.lastQuestionId;
  const from = qs.findIndex(q => q.id === ref);
  return qs.slice(from + 1).find(q => !played.includes(q.id)) || qs.find(q => !played.includes(q.id)) || null;
}
// Ett enda ställe som bestämmer vad "nästa steg" är, både för stora knappen och mellanslag.
function nextStep() {
  const g = state.game, q = state.activeQuestion;
  if (state.lobby) { const c = (state.claimed || []).length, n = (state.questions || []).find(x => !(state.played || []).includes(x.id)); return c < 2 ? { label: `Väntar på lag… ${c} av minst 2 ombord`, disabled: true } : { label: `Kör! ${c} lag ombord${n ? ' · starta ' + n.title : ''}`, path: 'lobby/go' }; }
  const end = () => { const n = nextQuestion(); return { label: 'Avsluta frågan' + (n ? ' · nästa: ' + n.title : ''), path: 'game/wait' }; };
  if (!q || g.phase === 'waiting') { const n = nextQuestion(); return n ? { label: `Starta ${typeName(n.type).toLowerCase()}: ${n.title}`, path: 'game/start', data: { id: n.id } } : { label: 'Alla frågor är spelade', disabled: true }; }
  if (q.type === 'destination') {
    if (g.phase === 'active') return g.clueIndex < 4 ? { label: `Visa ledtråd ${g.clueIndex + 2} · ${CLUE_POINTS[g.clueIndex + 1]} p`, path: 'game/next' } : { label: 'Avslöja resmålet', path: 'game/reveal' };
    const fi = g.filmIndex;
    if (Number.isInteger(fi) && g.filmStage === 'video') return { label: `Visa frågorna till Resefilm ${fi + 1}`, path: 'game/film-questions' };
    if (Number.isInteger(fi) && g.filmStage === 'questions') return { label: `Avslöja facit för Resefilm ${fi + 1}`, path: 'game/film-reveal' };
    const ni = [0,1,2].find(i => i > (fi ?? -1) && filmUsed(q.films?.[i]));
    return ni !== undefined ? { label: `Starta Resefilm ${ni + 1}`, path: 'game/film', data: { index: ni } } : end();
  }
  if (q.type === 'music') return !g.musicShown ? { label: 'Visa musikfrågorna', path: 'game/music-question' } : !g.musicRevealed ? { label: 'Avslöja facit', path: 'game/music-reveal' } : end();
  const stage = g.closestStage || 0;
  return stage === 0 ? { label: 'Starta 10 sekunder', path: 'game/closest-stage', data: { stage: 1 } } : stage === 1 ? (performance.now() < closestDeadline ? { label: 'Lagen placerar sina nålar…', disabled: true } : { label: 'Visa nålar nu', path: 'game/closest-stage', data: { stage: 2 } }) : stage === 2 ? { label: 'Visa rätt plats och resultat', path: 'game/closest-stage', data: { stage: 3 } } : end();
}
async function runStep(step) { if (!step || step.disabled || stepPending) return; stepPending = true; try { await action(step.path, step.data || {}); } finally { stepPending = false; } }
const liveTeams = () => state.lobby ? (state.teams || []).filter(t => (state.claimed || []).includes(t.id)) : activeTeamList();
const scoreChips = () => liveTeams().map(t => `<span class="cr-chip" style="--team:${esc(t.color)}"><i></i>${esc(t.short)}<b>${state.scores?.[t.id] ?? 0}</b></span>`).join('');
function tvPill() {
  const on = state.screenOnline > 0, mode = state.tv?.mode;
  const warn = !on ? 'Storbilden är inte öppen. Klicka för att öppna den i en ny flik (eller tryck N).' : !state.tvStatus?.audioReady ? 'Ljudet är av. Klicka på Aktivera ljud på storbilden.' : '';
  return `<span class="cr-pill ${warn ? 'warn' : 'ok'}"${!on ? ' data-open-screen role="button" tabindex="0"' : ''} title="${esc(warn || 'Storbilden är ansluten och ljudet är på.')}"><i></i>TV ${!on ? 'frånkopplad' : warn ? 'ljud av' : 'redo'}${mode && mode !== 'game' ? ' · ' + (mode === 'blank' ? 'svart' : 'ställning') : ''}</span>`;
}
const videoPct = () => { const s = state.tvStatus; return s?.duration ? Math.min(100, s.time / s.duration * 100) : 0; };
const videoText = () => { const s = state.tvStatus; return !s?.video ? 'Väntar på videon…' : s.ended ? 'Videon är slut' : `${s.playing ? 'Spelar' : 'Pausad'} ${fmtTime(s.time)} / ${fmtTime(s.duration)}`; };
function host() {
  const g = state.game, q = state.activeQuestion, qs = state.questions, live = q && g.phase !== 'waiting';
  const where = state.lobby ? 'Lobby · lagen väljer lag' : live ? `Fråga ${qs.findIndex(x => x.id === q.id) + 1}/${qs.length} · ${typeName(q.type)} · <b>${esc(q.title)}</b>` : 'Mellan frågorna';
  const top = `<header class="cr-top"><div class="cr-brand"><span class="cr-logo">På resande fot</span><span class="cr-where">${where}</span></div><nav class="cr-tabs">${[['show','Show'],['prepare','Förbered']].map(([id,l]) => `<button class="${hostTab === id ? 'on' : ''}" data-tab="${id}">${l}</button>`).join('')}</nav><div class="cr-scores">${scoreChips()}</div><div id="tvPill">${tvPill()}</div></header>`;
  return `<div class="cr">${top}${hostTab === 'show' ? hostShow() : hostPrepare()}</div>`;
}
function hostShow() {
  const step = nextStep(), g = state.game, q = state.activeQuestion, live = q && g.phase !== 'waiting';
  const alt = state.lobby ? '' : live ? `${q.type === 'destination' && g.phase === 'active' && g.clueIndex < 4 ? '<button class="ghost" id="reveal">Avslöja resmålet nu <kbd>R</kbd></button>' : ''}${step.path !== 'game/wait' ? '<button class="ghost" id="wait">Avbryt frågan</button>' : ''}` : '<button class="ghost" data-tab="prepare">Välj en annan fråga</button>';
  return `<main class="cr-show"><section class="cr-manus">${manus()}</section><aside class="cr-side"><section class="cr-panel"><h2>Lagen</h2>${teamCards()}</section>${tvPanel()}</aside><footer class="cr-next"><button id="nextStep" class="cr-go${state.tvStatus?.ended ? ' pulse' : ''}" ${step.disabled ? 'disabled' : ''}><span>▶ ${esc(step.label)}</span><kbd>Mellanslag</kbd></button><div class="cr-alt">${alt}</div></footer></main>`;
}
function stageLabel(q, g) {
  if (q.type === 'destination') return g.phase === 'active' ? `Ledtråd ${g.clueIndex + 1} av 5 · ${CLUE_POINTS[g.clueIndex]} p` : Number.isInteger(g.filmIndex) ? `Resefilm ${g.filmIndex + 1}` : 'Resmålet avslöjat';
  if (q.type === 'music') return !g.musicShown ? 'Videon spelas' : !g.musicRevealed ? 'Lagen svarar' : 'Facit visas';
  return ['Ledtråd visas','Nedräkning','Nålar visas','Resultat'][g.closestStage || 0];
}
function notes(q, g) {
  if (q.type === 'destination') {
    const ci = g ? g.clueIndex : -1, revealed = g?.phase === 'revealed';
    const clues = q.clues.map((c,i) => `<li class="${revealed || i < ci ? 'done' : i === ci ? 'now' : ''}"><span class="cr-pts">${CLUE_POINTS[i]}</span><p>${esc(c)}</p></li>`).join('');
    const films = (q.films || []).map((f,i) => {
      if (!filmUsed(f)) return '';
      const cls = !g || !Number.isInteger(g.filmIndex) || i > g.filmIndex ? '' : i < g.filmIndex || g.filmStage === 'revealed' ? 'done' : 'now';
      return `<div class="cr-film ${cls}"><div class="cr-film-head"><b>Resefilm ${i + 1}</b>${f.video ? '<span>🎬 video</span>' : '<span class="warn">⚠ ingen video</span>'}${g?.filmIndex === i ? `<span class="cr-tag live">${{video:'Videon spelas',questions:'Lagen svarar',revealed:'Facit visas'}[g.filmStage] || ''}</span>` : ''}</div><ol class="cr-qs">${f.questions.map(x => `<li>${esc(x.question)}<small>Facit: <b>${esc(x.answer)}</b></small></li>`).join('')}</ol></div>`;
    }).join('');
    return `<div class="cr-facit${revealed ? ' shown' : ''}"><span>Facit${revealed ? ' · visas på TV' : ''}</span><strong>${esc(q.answer)}</strong></div><ol class="cr-clues">${clues}</ol>${films ? `<h2 class="cr-sub">Resefilm <small>0 rätt = 0 p · 1 rätt = 1 p · 2 rätt = 3 p</small></h2>${films}` : ''}`;
  }
  if (q.type === 'music') return `<p class="cr-muted">${q.video ? '🎬 Videon visas på storbilden tills du visar frågorna.' : '⚠ Ingen video uppladdad.'}</p><ol class="cr-qs big">${q.musicQuestions.map(x => `<li>${esc(x.question)}<small>Facit: <b>${esc(x.answer)}</b></small></li>`).join('')}</ol>`;
  const stage = g?.closestStage || 0;
  return `${q.clue ? `<p class="cr-big">${esc(q.clue)}</p>` : ''}${q.image ? '<p class="cr-muted">🖼 Ledtrådsbilden visas på storbilden.</p>' : ''}<div class="cr-facit"><span>Rätt plats · ${q.points || 10} p till närmaste lag</span><strong>${(+q.answerLat).toFixed(3)}, ${(+q.answerLon).toFixed(3)}</strong></div>${g && stage === 1 ? '<div class="cr-count"><strong id="countdown"></strong><span>sekunder kvar</span></div>' : ''}${g && stage === 3 ? resultText(state.closestResult) + '<p class="cr-muted">Poängen har delats ut automatiskt.</p>' : ''}`;
}
function manus() {
  const g = state.game, q = state.activeQuestion;
  if (state.lobby) {
    const claimed = state.claimed || [];
    return `<div class="cr-kicker">Lobby · ${claimed.length} av ${state.teams.length} lag ombord</div><h1>Välkomna ombord!</h1><p class="cr-muted">Storbilden visar en QR-kod. Telefonerna skannar den (eller öppnar <b>${esc(state.joinUrl)}</b>) och trycker på sitt lag. Tryck <b>Kör</b> när alla är ombord.</p><div class="cr-lobby">${state.teams.map(t => { const on = claimed.includes(t.id); return `<div class="cr-lobby-team${on ? ' on' : ''}" style="--team:${esc(t.color)}"><b>${esc(t.short)}</b><span>${on ? '✓ Ombord' : 'Ledigt'}</span>${on ? `<button class="ghost small" data-release="${esc(t.id)}" title="Släpp laget så att en annan telefon kan ta det">Frigör</button>` : ''}</div>`; }).join('')}</div><p class="cr-lobby-actions"><button class="ghost small" id="resetGame">Nytt spel: nollställ poäng och spelade frågor</button></p>`;
  }
  if (!q || g.phase === 'waiting') {
    const n = nextQuestion();
    return `<div class="cr-kicker">Nästa fråga${n ? ' · ' + typeName(n.type) : ''}</div>${n ? `<h1>${esc(n.title)}</h1>${notes(n, null)}` : '<h1>Alla frågor är spelade</h1><p class="cr-muted">Gå till Förbered för att starta en fråga eller nollställa listan.</p>'}<section class="cr-panel cr-inline"><h2>Lag i spel</h2>${teamPickerForm()}</section>`;
  }
  return `<div class="cr-kicker">${typeName(q.type)} · ${stageLabel(q, g)}</div><h1>${esc(q.title)}</h1>${notes(q, g)}`;
}
const awardBtns = (key, team, options) => options.map(([value, label]) => { const cur = state.game.awards?.[key]?.[team], on = !!cur && cur.value === value; return `<button class="cr-award${on ? ' on' : ''}" data-award="${key}" data-team="${esc(team)}" data-value="${esc(JSON.stringify(on ? null : value))}" title="${on ? 'Klicka igen för att ångra' : ''}">${label}</button>`; }).join('');
const FILM_CHIPS = [[0,'0 rätt'],[1,'1 rätt · +1'],[2,'2 rätt · +3']], MUSIC_CHIPS = [[0,'0 rätt'],[1,'1 rätt · +1'],[2,'2 rätt · +2']];
function teamBody(id) {
  const g = state.game, q = state.activeQuestion;
  if (q.type === 'destination') {
    const a = g.answers?.[id], brake = g.brakes?.[id];
    let html = a ? `<div class="cr-ans"><q>${esc(a.answer)}</q><small>låst på ${a.points} p</small></div><div class="cr-awards">${awardBtns('dest', id, [[true, `✓ Rätt +${a.points}`], [false, '✗ Fel']])}</div>`
      : brake ? '<div class="cr-brake">🚨 Drog nödbromsen – skriver sitt svar…</div>' : `<div class="cr-wait">${g.phase === 'revealed' ? 'Svarade inte på resmålet' : 'Inget svar ännu'}</div>`;
    const fi = g.filmIndex;
    if (g.phase === 'revealed' && Number.isInteger(fi)) {
      const earlier = [0,1,2].filter(i => i < fi && filmUsed(q.films?.[i])).map(i => { const aw = g.awards?.['film' + i]?.[id]; return `R${i + 1}: ${aw ? '+' + aw.points : 'ej rättad'}`; }).join(' · ');
      const ans = g.filmAnswers?.[fi]?.[id];
      html += `<div class="cr-filmans"><div class="cr-film-label">Resefilm ${fi + 1}${earlier ? ` <small>${earlier}</small>` : ''}</div>${g.filmStage === 'video' ? '<div class="cr-wait">Tittar på filmen…</div>' : ans ? `<ol>${ans.map((x,i) => `<li>${esc(x || '–')}<small>Facit: ${esc(q.films[fi].questions[i].answer)}</small></li>`).join('')}</ol><div class="cr-awards">${awardBtns('film' + fi, id, FILM_CHIPS)}</div>` : `<div class="cr-wait">${g.filmStage === 'revealed' ? 'Svarade inte' : 'Skriver svar…'}</div>`}</div>`;
    }
    return html;
  }
  if (q.type === 'music') {
    if (!g.musicShown) return '<div class="cr-wait">Lyssnar…</div>';
    const ans = g.musicAnswers?.[id];
    return ans ? `<div class="cr-ans pre">${esc(ans)}</div><div class="cr-awards">${awardBtns('music', id, MUSIC_CHIPS)}</div>` : '<div class="cr-wait">Skriver svar…</div>';
  }
  const stage = g.closestStage || 0, r = state.closestResult;
  if (stage === 3 && r) return r.distances?.[id] == null ? '<div class="cr-wait">Ingen nål</div>' : `<div class="cr-ans"><q>${r.distances[id]} km</q>${r.winners?.includes(id) ? `<small class="win">Närmast · +${r.points}</small>` : ''}</div>`;
  return `<div class="cr-wait">${g.closestAnswers?.[id] ? '📍 Nål satt' : stage === 0 ? 'Väntar på kartan' : 'Ingen nål ännu'}</div>`;
}
function teamCards() {
  const g = state.game, q = state.activeQuestion, live = q && g.phase !== 'waiting';
  return liveTeams().map(t => `<div class="cr-team" style="--team:${esc(t.color)}"><div class="cr-team-head"><b>${esc(t.short)}</b><span>${state.scores?.[t.id] ?? 0} p</span></div>${live ? teamBody(t.id) : ''}</div>`).join('');
}
function tvPanel() {
  const s = state.screenView || {}, mode = state.tv?.mode || 'game', st = state.tvStatus;
  const video = mode === 'game' && !!s.video;
  return `<section class="cr-panel cr-tv"><div class="cr-panel-head"><h2>Storbild</h2><button class="ghost small" data-open-screen>${state.screenOnline > 0 ? 'Öppna igen' : 'Öppna storbild'} <kbd>N</kbd></button></div><div class="cr-preview" id="tvPreview"><div class="cr-preview-inner screen">${screen(s, true)}</div></div><div class="cr-seg">${[['game','Spel',''],['scoreboard','Ställning','S'],['blank','Svart skärm','B']].map(([m,l,k]) => `<button data-tv="${m}" class="${mode === m ? 'on' : ''}">${l}${k ? ` <kbd>${k}</kbd>` : ''}</button>`).join('')}</div>${video ? `<div class="cr-video"><button id="videoToggle" data-video="${st?.playing ? 'pause' : 'play'}">${st?.playing ? '⏸ Pausa' : '▶ Spela'} <kbd>P</kbd></button><button data-video="restart" class="ghost">⟲ Från början</button><span id="tvStatus" class="cr-vtime">${videoText()}</span></div><div class="cr-bar"><i id="tvBar" style="width:${videoPct()}%"></i></div>` : ''}</section>`;
}
// Uppdaterar bara TV-statusen (skickas ca 1 gång/s när video spelas) utan att rita om hela vyn.
function patchTv() {
  const q = sel => document.querySelector(sel);
  if (q('#tvStatus')) q('#tvStatus').textContent = videoText();
  if (q('#tvBar')) q('#tvBar').style.width = videoPct() + '%';
  if (q('#tvPill')) q('#tvPill').innerHTML = tvPill();
  const toggle = q('#videoToggle'); if (toggle) { toggle.dataset.video = state.tvStatus?.playing ? 'pause' : 'play'; toggle.innerHTML = (state.tvStatus?.playing ? '⏸ Pausa' : '▶ Spela') + ' <kbd>P</kbd>'; }
  q('#nextStep')?.classList.toggle('pulse', !!state.tvStatus?.ended);
  const scores = q('.cr-scores'); if (scores) scores.innerHTML = scoreChips();
}
const hostKey = s => JSON.stringify({ ...s, tvStatus: undefined });
function teamPickerForm() {
  if (state.lobby) return '<p class="hint">Lagen väljer själva lag i lobbyn via QR-koden på storbilden.</p>';
  return state.phase === 'waiting' ? `<form id="teamsForm"><div class="team-picker">${(state.teams || []).map(t => `<label class="team-pick" style="--team:${esc(t.color)}"><input type="checkbox" name="team" value="${esc(t.id)}" ${state.activeTeams.includes(t.id) ? 'checked' : ''}> ${esc(t.short)}</label>`).join('')}</div><button class="ghost">Spara lag</button><p class="hint">Välj 2–5 lag. Kan ändras mellan frågorna.</p></form>` : `<p class="hint">Aktiva lag: ${activeTeamList().map(t => esc(t.short)).join(', ')}. Lagen kan ändras mellan frågorna.</p>`;
}
function hostPrepare() {
  const played = state.played || [], cur = state.game.phase !== 'waiting' ? state.game.questionId : null;
  const rows = state.questions.map((q,i) => {
    const warn = q.type === 'music' && !q.video ? 'Video saknas' : q.type === 'destination' ? (q.films || []).map((f,k) => filmUsed(f) && !f.video ? `Resefilm ${k + 1} saknar video` : '').filter(Boolean).join(', ') : '';
    const status = q.id === cur ? '<span class="cr-tag live">▶ Pågår</span>' : played.includes(q.id) ? '<span class="cr-tag">✓ Spelad</span>' : '';
    return `<div class="cr-row${editing === q.id ? ' sel' : ''}"><span class="cr-num">${i + 1}</span><div class="cr-row-main"><b>${esc(q.title)} ${status}</b><small>${typeName(q.type)}${q.type === 'destination' ? ((n => ` · ${n} ${n === 1 ? 'resefilm' : 'resefilmer'}`)((q.films || []).filter(filmUsed).length)) : ''}</small>${warn ? `<small class="warn">⚠ ${esc(warn)}</small>` : ''}</div><div class="cr-row-actions"><button class="ghost icon" data-move="${esc(q.id)}" data-direction="-1" aria-label="Flytta ${esc(q.title)} upp" title="Flytta upp" ${i === 0 ? 'disabled' : ''}>↑</button><button class="ghost icon" data-move="${esc(q.id)}" data-direction="1" aria-label="Flytta ${esc(q.title)} ned" title="Flytta ned" ${i === state.questions.length - 1 ? 'disabled' : ''}>↓</button><button data-start="${esc(q.id)}">Starta</button><button class="ghost" data-edit="${esc(q.id)}">Redigera</button><button class="ghost danger" data-delete="${esc(q.id)}">Ta bort</button></div></div>`;
  }).join('');
  const scores = activeTeamList().map(t => `<form class="cr-score" data-score="${esc(t.id)}" style="--team:${esc(t.color)}"><span class="cr-score-name"><i></i>${esc(t.short)} <b>${state.scores[t.id]} p</b></span><button type="button" class="ghost icon" data-quick="${esc(t.id)}" data-delta="-1" aria-label="Dra av 1 poäng för ${esc(t.short)}">−1</button><button type="button" class="ghost icon" data-quick="${esc(t.id)}" data-delta="1" aria-label="Ge 1 poäng till ${esc(t.short)}">+1</button><input name="delta" type="number" min="1" max="100" value="5" aria-label="Poäng för ${esc(t.short)}" required><button name="sign" value="1">Lägg till</button><button name="sign" value="-1" class="ghost">Dra av</button></form>`).join('');
  const claimedNow = state.claimed || [];
  const phones = state.lobby ? '' : `<h2>Telefoner</h2>${activeTeamList().map(t => `<div class="cr-phone" style="--team:${esc(t.color)}"><span class="cr-score-name"><i></i>${esc(t.short)}</span>${claimedNow.includes(t.id) ? `<span class="cr-tag live">ansluten</span><button class="ghost small" data-release="${esc(t.id)}">Frigör</button>` : '<span class="cr-tag">ingen telefon – kan väljas via QR-koden</span>'}</div>`).join('')}`;
  const side = editing !== null ? editorPanel() : `<section class="cr-panel"><h2>Lag i spel</h2>${teamPickerForm()}${state.lobby ? '' : '<p><button class="ghost small" id="openLobby">Tillbaka till lobbyn (lagval och QR-kod)</button></p>'}${phones}<h2>Rätta poäng manuellt</h2>${scores}</section>`;
  return `<main class="cr-prep"><section class="cr-panel"><div class="cr-panel-head"><h2>Frågor i spelordning</h2><button class="ghost small" id="resetPlayed">Nollställ spelade</button></div>${rows || '<p>Inga frågor ännu.</p>'}<div class="actions cr-add"><button id="addDest">+ Resmål</button><button id="addMusic" class="ghost">+ Musikfråga</button><button id="addClosest" class="ghost">+ Närmast vinner</button></div></section>${side}</main>`;
}
function editorPanel() {
  const e = editing && state.questions.find(q => q.id === editing);
  const editorType = e?.type || editing?.type;
  const editorFields = editorType === 'closest'
    ? `<label>Ledtråd som text (valfri om du väljer bild)<textarea name="clue" maxlength="300">${esc(e?.clue||'')}</textarea></label><label>Ledtråd som bild (valfri om du skriver text; PNG, JPG eller WebP)<input name="imageFile" type="file" accept="image/png,image/jpeg,image/webp"></label><label>Poäng till närmaste lag<input name="points" type="number" min="1" max="100" value="${esc(e?.points||10)}" required></label>${e?.image?'<p class="hint">En bild är redan sparad. Välj en fil om du vill byta den.</p>':''}<p class="hint">Zooma och flytta kartan till det utsnitt lagen ska se. Klicka sedan på rätt plats. Det synliga utsnittet sparas när du sparar frågan.</p><div id="correctMap" class="map-wrap"></div><input type="hidden" name="viewport" value="${esc(editingViewport?JSON.stringify(editingViewport):e?.viewport?JSON.stringify(e.viewport):'')}"><input type="hidden" name="answerLat" value="${esc(editingPin?.lat ?? e?.answerLat ?? '')}"><input type="hidden" name="answerLon" value="${esc(editingPin?.lon ?? e?.answerLon ?? '')}">`
    : editorType === 'music'
    ? `<label>MP4-video<input name="videoFile" type="file" accept="video/mp4,.mp4" ${e?.video ? '' : 'required'}></label>${e?.video ? '<p class="hint">En video är redan sparad. Välj en fil om du vill byta den.</p>' : ''}${[0,1].map(i => `<label>Musikfråga ${i + 1}<textarea name="musicQuestion${i}" required>${esc(e?.musicQuestions?.[i]?.question || '')}</textarea></label><label>Facit till musikfråga ${i + 1}<input name="musicAnswer${i}" required value="${esc(e?.musicQuestions?.[i]?.answer || '')}"></label>`).join('')}`
    : `<label>Facit (resmålet)<input name="answer" required value="${esc(e?.answer || '')}"></label>` + CLUE_POINTS.map((p,i) => `<label>${p} poäng<textarea name="clue${i}" required>${esc(e?.clues?.[i] || '')}</textarea></label>`).join('')
      + [0,1,2].map(i => { const f = e?.films?.[i]; return `<fieldset class="cr-fs"><legend>Resefilm ${i + 1}</legend><label>Video (MP4)<input name="filmVideo${i}" type="file" accept="video/mp4,.mp4"></label>${f?.video ? `<p class="hint">En video är sparad. Välj en fil för att byta den. <label class="inline"><input type="checkbox" name="filmVideoRemove${i}"> Ta bort videon</label></p>` : ''}${[0,1].map(j => `<label>Fråga ${j + 1}<textarea name="film${i}q${j}">${esc(f?.questions?.[j]?.question || '')}</textarea></label><label>Facit ${j + 1}<input name="film${i}a${j}" value="${esc(f?.questions?.[j]?.answer || '')}"></label>`).join('')}</fieldset>`; }).join('') + '<p class="hint">Lämna en resefilm helt tom om den inte ska användas.</p>';
  return `<section class="cr-panel" id="editor"><h2>${e ? 'Redigera ' + typeName(editorType).toLowerCase() : 'Ny ' + typeName(editorType).toLowerCase()}</h2><form id="questionForm"><input type="hidden" name="id" value="${esc(e?.id || '')}"><input type="hidden" name="type" value="${esc(editorType || 'destination')}"><label>Titel<input name="title" required value="${esc(e?.title || '')}"></label>${editorFields}<div class="actions cr-editor-actions"><button id="saveQuestion">Spara fråga</button><button type="button" id="cancel" class="ghost">Avbryt</button></div></form></section>`;
}
function team() {
  if (state.lobby) return `<section class="hero card"><div class="eyebrow">Ni är ombord</div><h1>${esc(teamMeta(state.role)?.short || state.label)}</h1><p>Titta på storbilden. Resan börjar när spelledaren trycker kör.</p><button id="leaveTeam" class="secondary">Byt lag</button></section>`;
  if (state.phase === 'waiting') return `<section class="hero card"><div class="eyebrow">Redo för avfärd</div><h1>Väntar på nästa fråga</h1><p>Spelledaren startar snart.</p></section>`;
  if (state.type === 'closest') return `<section class="hero card closest-team"><div class="eyebrow">Närmast vinner</div><h1>${state.stage===0?'Gör er redo':state.stage===1?'Placera er nål!':state.stage===2?'Tiden är ute':'Resultat'}</h1>${state.stage===1?'<div id="countdown" class="countdown"></div>':''}<div id="teamMap" class="map-wrap"></div>${state.stage===0?'<p>Titta på storbilden. Ledtråden visas där. Kartan öppnas när spelledaren startar tiden.</p>':state.stage===1?'<p>Dra nålen med fingret dit ni tror att platsen ligger. Ni kan flytta den tills tiden går ut.</p>':state.stage===2?'<p>'+(state.pin?'Er nål är låst.':'Ni hann inte sätta någon nål.')+'</p>':''}${state.correct ? resultText(state.result) : ''}</section>`;
  if (state.type === 'music') return `<section class="hero card"><h1>Lyssna och njut</h1></section>`;
  if (state.type === 'music-question') return `<section class="hero card"><div class="eyebrow">Musikfrågor</div><ol class="music-questions">${state.questions.map(question => `<li>${esc(question)}</li>`).join('')}</ol>${state.locked ? `<div class="locked"><strong>Ert svar är låst</strong><p class="preserve-lines">${esc(state.locked)}</p></div>` : state.answers ? '' : `<form id="musicAnswerForm"><label>Skriv svaren på alla frågor i samma ruta<textarea name="answer" required maxlength="2000" rows="6"></textarea></label><button>Lås svar</button></form>`}${state.answers ? `<div class="reveal"><strong>Rätta svar</strong><ol>${state.answers.map(answer => `<li>${esc(answer)}</li>`).join('')}</ol></div>` : ''}</section>`;
  if (state.type === 'film') {
    const head = `<div class="eyebrow">Resefilm ${state.filmIndex + 1}</div>`;
    if (state.filmStage === 'video') return `<section class="hero card">${head}<h1>Titta på storbilden</h1><p>Frågorna om filmen kommer när den är slut.</p></section>`;
    const list = (state.questions || []).map((question,i) => `<li>${esc(question)}${state.locked ? `<br><strong>Ert svar: ${esc(state.locked[i] || '–')}</strong>` : ''}${state.answers ? `<br>Rätt svar: <strong>${esc(state.answers[i])}</strong>` : ''}</li>`).join('');
    return `<section class="hero card">${head}<h1>Frågor om filmen</h1>${state.locked || state.answers ? `<ol class="music-questions">${list}</ol>${state.locked ? '<div class="locked"><strong>Era svar är låsta</strong></div>' : ''}` : `<form id="filmForm">${state.questions.map((question,i) => `<label>${i + 1}. ${esc(question)}<input name="answer${i}" maxlength="200" autocomplete="off"></label>`).join('')}<button>Lås svaren</button></form>`}<p class="hint">Ett rätt ger 1 poäng, två rätt ger 3 poäng.</p></section>`;
  }
  const locked = state.locked;
  if (locked) return `<section class="hero card"><div class="eyebrow">${state.type === 'destination' ? 'Resmål' : 'Musikfråga'}</div><h1>Svaret är låst</h1><div class="points">${locked.points} poäng</div><div class="locked"><strong>Ert svar</strong><p>${esc(locked.answer)}</p></div>${state.phase === 'revealed' ? `<div class="reveal">Rätt svar: <strong>${esc(state.answer)}</strong></div>` : ''}</section>`;
  return `<section class="hero card"><h1>${state.type === 'destination' ? 'Vart är vi påväg?' : 'Musikfråga'}</h1><div class="points">${state.points} poäng</div>${state.phase === 'revealed' ? `<div class="reveal">Rätt svar: <strong>${esc(state.answer)}</strong></div>` : state.brakeBlocked ? '<div class="locked">Nödbromsen är dragen. Vänta på nästa poängnivå.</div>' : `${state.type === 'destination' && !state.pulled ? `<div class="brake" id="brake" role="slider" tabindex="0" aria-label="Dra nödbromsen nedåt eller tryck Enter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><img class="brake-image" src="/assets/nodbroms.png" alt="Nödbroms" draggable="false"><strong>Dra nedåt för att bromsa</strong></div>` : ''}<form id="answerForm" ${state.type === 'destination' && !state.pulled ? 'hidden' : ''}><label>Ert svar<input name="answer" required maxlength="200" autocomplete="off"></label><button>Lås svar och ${state.points} poäng</button></form>`}</section>`;
}
// Ritar storbilden från en vy. preview=true används för spelledarens miniatyr (ingen video, inget ljud, egna id:n).
function screen(s = state, preview = false) {
  const soundControl = preview || audioReady ? '' : `<div class="sound-control"><button id="enableSound" ${audioLoading ? 'disabled' : ''}>${audioLoading ? 'Laddar ljud…' : 'Aktivera ljud'}</button><p>${esc(audioError || 'Klicka en gång för att höra resmålsmusiken och lagens nödbromsar.')}</p></div>`;
  if (s.overlay === 'blank') return soundControl + `<section class="screen-card tv-blank"><div class="tv-logo">På resande fot</div></section>`;
  if (s.overlay === 'scoreboard') { const rows = activeTeamList().map(t => ({ t, p: s.scores?.[t.id] ?? 0 })).sort((a,b) => b.p - a.p); return soundControl + `<section class="screen-card tv-scores"><div class="eyebrow">Ställning</div><ol>${rows.map(({t,p}) => `<li style="--team:${esc(t.color)}"><span class="tv-rank">${rows.findIndex(r => r.p === p) + 1}</span><span class="tv-name">${esc(t.short)}</span><strong>${p}</strong></li>`).join('')}</ol></section>`; }
  if (s.lobby) {
    const claimed = s.claimed || [];
    return soundControl + `<section class="screen-card tv-lobby"><div class="eyebrow">På resande fot</div><h1>Skanna och välj ert lag</h1><div class="tv-lobby-grid"><div class="tv-qr">${qrSvg(s.joinUrl)}<p>${esc((s.joinUrl || '').replace(/^https?:\/\//, '').replace(/\/$/, ''))}</p></div><ol class="tv-teams">${(s.teams || []).map(t => { const on = claimed.includes(t.id); return `<li class="${on ? 'on' : ''}" style="--team:${esc(t.color)}"><span>${esc(t.short)}</span><b>${on ? '✓ Ombord' : 'Ledigt'}</b></li>`; }).join('')}</ol></div><p class="tv-lobby-hint">${claimed.length ? `${claimed.length} av ${(s.teams || []).length} lag ombord` : 'Inget lag ombord ännu'}</p></section>`;
  }
  const countdown = preview ? '<div data-countdown class="countdown countdown-screen"></div>' : '<div id="countdown" class="countdown countdown-screen"></div>';
  const videoCard = label => preview ? `<section class="screen-card media-screen cr-vph"><span>🎬</span>${esc(label)}</section>` : `<section class="screen-card music-screen media-screen"><video id="musicVideo" src="${esc(s.video)}" autoplay playsinline></video><button id="playVideo" class="video-play" hidden>Starta video</button></section>`;
  const questionCard = (eyebrow, title) => `<section class="screen-card music-question-screen"><div class="eyebrow">${esc(eyebrow)}</div><h1>${s.answers ? 'Rätta svar' : esc(title)}</h1><ol class="screen-music-questions">${s.questions.map((question,index) => `<li><div class="music-question-copy">${esc(question)}</div>${s.answers ? `<div class="screen-music-answer"><span>Rätt svar</span><strong>${esc(s.answers[index])}</strong></div>` : ''}</li>`).join('')}</ol></section>`;
  const brakes=s.type==='destination' && s.phase==='active' ? s.brakes||[] : [];
  const brakeNotice=brakes.length ? `<div class="screen-brake-notices" aria-live="polite">${brakes.map((event,index)=>{const meta=teamMeta(event.team);return `<div class="screen-brake-notice ${(meta?.theme||'dressin')+'-brake'} ${index===brakes.length-1?'latest-brake':''}"><img src="/assets/nodbroms.png" alt=""><div><strong>${esc(meta?.short||event.team)} har dragit i nödbromsen!</strong></div></div>`;}).join('')}</div>` : '';
  if (s.phase === 'waiting' || !s.type) return soundControl + `<section class="screen-card"><div class="eyebrow">På resande fot</div><h1>Väntar på nästa fråga</h1></section>`;
  if (s.type === 'closest') { const clue = `${s.image?(preview?'<div class="cr-vph">🖼 Bild</div>':`<img class="closest-image" src="${esc(s.image)}" alt="Ledtråd">`):''}${s.clue?`<p class="closest-clue">${esc(s.clue)}</p>`:''}`; return soundControl + (s.stage===0 ? `<section class="screen-card closest-screen"><div class="eyebrow">Närmast vinner</div><div class="closest-clue-box">${clue}</div></section>` : `<section class="screen-card closest-screen"><div class="eyebrow">Närmast vinner</div>${s.stage===1?countdown:''}<div class="closest-split"><div class="closest-clue-box">${clue}</div><div id="${preview?'previewMap':'screenMap'}" class="map-wrap"></div></div>${s.stage>=2?`<p class="map-legend">${activeTeamList().map(t=>`<span style="color:${esc(t.color)}">● ${esc(t.short)}</span>`).join(' ')}${s.stage>=3?' <span class="correct-dot">● Rätt plats</span>':''}</p>`:''}${s.stage===3?resultText(s.result):''}</section>`); }
  if (s.type === 'music') return soundControl + (s.questions ? questionCard('Musikfrågor', 'Vad hörde ni?') : videoCard('Musikvideo'));
  if (s.filmNumber) return soundControl + (s.filmStage === 'video' ? videoCard('Resefilm ' + s.filmNumber) : questionCard('Resefilm ' + s.filmNumber, 'Frågor om filmen'));
  if(s.phase==='revealed')return `<section class="screen-card answer-screen"><div class="reveal">Rätt svar: <strong>${esc(s.answer)}</strong></div></section>`;
  return soundControl + `<section class="screen-card"><div class="eyebrow">Resmål</div><h1>Vart är vi påväg?</h1><div class="points">${s.points} poäng</div>${brakeNotice}</section>`;
}
async function enableSound() {
  if (audioLoading) return;
  audioLoading = true; audioError = '';
  try {
    audioContext ||= new AudioContext();
    await audioContext.resume();
    render();
    await Promise.all(['dressin', 'forsta', 'destination'].map(async key => {
      const response = await fetch(key === 'destination' ? '/assets/resmal-loop.mp3' : '/assets/' + (key === 'forsta' ? 'forstaklass' : key) + '.ogg');
      if (!response.ok) throw Error('Ljudfilen kunde inte laddas.');
      soundBuffers[key] = await audioContext.decodeAudioData(await response.arrayBuffer());
    }));
    audioReady = true;
    syncDestinationMusic(state);
  } catch (error) { audioError = 'Ljudet kunde inte aktiveras. Försök igen.'; }
  audioLoading = false; render(); reportTv(true);
}
function syncDestinationMusic(next) {
  if (next.role !== 'screen') return;
  const shouldPlay = next.type === 'destination' && next.phase === 'active' && !(next.brakes||[]).length && audioReady && soundBuffers.destination && audioContext?.state === 'running';
  if (destinationSource && (!shouldPlay || destinationRound !== next.round)) {
    destinationOffset = destinationRound===next.round && next.type==='destination' && next.phase==='active' ? Math.max(0,(audioContext.currentTime-destinationStartedAt)%soundBuffers.destination.duration) : 0;
    destinationSource.stop(); destinationSource.disconnect(); destinationSource = null; destinationRound = null;
  }
  if(destinationPlaybackRound!==next.round){destinationPlaybackRound=next.round;destinationOffset=0;}
  if(next.type!=='destination'||next.phase!=='active')destinationOffset=0;
  if (shouldPlay && !destinationSource) {
    destinationSource = audioContext.createBufferSource();
    destinationSource.buffer = soundBuffers.destination;
    destinationSource.loop = true;
    destinationSource.connect(audioContext.destination);
    destinationSource.start(0,destinationOffset); destinationStartedAt=audioContext.currentTime-destinationOffset;destinationRound = next.round;
  }
}
function handleBrakes(next, initial = false) {
  if (next.role !== 'screen') return;
  for (const event of next.brakes || []) {
    if (seenBrakes.has(event.id)) continue;
    seenBrakes.add(event.id);
    const soundKey = (next.teams || []).find(t => t.id === event.team)?.sound || event.team;
    if (initial || !audioReady || !soundBuffers[soundKey]) continue;
    if (audioContext.state !== 'running') {
      audioReady = false; audioError = 'Ljudet pausades av webbläsaren. Aktivera ljud igen.'; continue;
    }
    const source = audioContext.createBufferSource();
    source.buffer = soundBuffers[soundKey]; source.connect(audioContext.destination);
    const startsAt = Math.max(audioContext.currentTime, audioNextTime);
    source.start(startsAt); audioNextTime = startsAt + source.buffer.duration;
  }
}
async function uploadVideo(file) {
  if (!file.name.toLowerCase().endsWith('.mp4')) throw Error('Välj en MP4-fil.');
  const response = await fetch('/api/video/upload', {method:'POST',headers:{'Content-Type':'video/mp4'},body:file});
  const result = await response.json(); if (!response.ok) throw Error(result.error || 'Videon kunde inte laddas upp.');
  return result.video;
}
// Storbilden öppnas i en egen flik/ett eget fönster med spelledarens inloggning; dra den till TV:n.
function openScreen() { const w = window.open('/view/screen', 'storbild'); if (!w) alert('Webbläsaren blockerade fliken. Tillåt popup-fönster för sidan eller tryck N i terminalen.'); }
function scalePreview() { const box = document.querySelector('#tvPreview'); if (box) box.style.setProperty('--s', box.clientWidth / 1280); }
function bindHost() {
  const on = (sel, fn) => document.querySelector(sel)?.addEventListener('click', fn);
  const all = (sel, fn) => document.querySelectorAll(sel).forEach(el => el.addEventListener('click', () => fn(el)));
  const openEditor = value => { editing = value; hostTab = 'prepare'; render(); document.querySelector('#editor')?.scrollIntoView({block:'nearest'}); };
  all('[data-tab]', b => { hostTab = b.dataset.tab; render(); });
  on('#nextStep', () => runStep(nextStep()));
  on('#reveal', () => action('game/reveal'));
  on('#wait', () => { if (confirm('Avbryta frågan och gå tillbaka till väntläget?')) action('game/wait'); });
  all('[data-award]', b => action('game/award', { key: b.dataset.award, team: b.dataset.team, value: JSON.parse(b.dataset.value) }));
  all('[data-tv]', b => action('tv', { mode: b.dataset.tv }));
  all('[data-video]', b => action('tv/video', { action: b.dataset.video }));
  all('[data-quick]', b => action('score/add', { team: b.dataset.quick, delta: Number(b.dataset.delta) }));
  all('[data-release]', b => { if (confirm(`Frigöra ${teamLabel(b.dataset.release)}? Telefonen loggas ut och laget kan väljas igen.`)) action('lobby/release', { team: b.dataset.release }); });
  on('#resetGame', () => { if (confirm('Starta ett nytt spel? Alla poäng nollställs och alla frågor markeras som ospelade.')) action('lobby/reset'); });
  on('#openLobby', () => { if (state.game.phase !== 'waiting' && !confirm('En fråga pågår. Avbryta den och gå till lobbyn?')) return; hostTab = 'show'; action('lobby/open'); });
  on('#resetPlayed', () => { if (confirm('Markera alla frågor som ospelade?')) action('played/reset'); });
  document.querySelector('#teamsForm')?.addEventListener('submit', async event => { event.preventDefault(); await action('teams', { teams: [...new FormData(event.target).getAll('team')] }); });
  document.querySelectorAll('[data-score]').forEach(form=>form.addEventListener('submit',async event=>{event.preventDefault();const amount=Number(new FormData(form).get('delta'));const sign=Number(event.submitter?.value||1);await action('score/add',{team:form.dataset.score,delta:amount*sign});}));
  all('[data-start]', b => { if (state.game.phase !== 'waiting' && !confirm('En fråga pågår. Starta den här i stället?')) return; hostTab = 'show'; editing = null; action('game/start', {id:b.dataset.start}); });
  all('[data-move]', b => action('question/move', {id:b.dataset.move,direction:Number(b.dataset.direction)}));
  all('[data-edit]', b => { const q=state.questions.find(item=>item.id===b.dataset.edit); editingPin=q?.type==='closest'?{lat:q.answerLat,lon:q.answerLon}:null; editingViewport=q?.viewport||null; openEditor(b.dataset.edit); });
  all('[data-delete]', b => { if (confirm('Ta bort frågan?')) action('question/delete', {id:b.dataset.delete}); });
  on('#addDest', () => openEditor({type:'destination'}));
  on('#addMusic', () => openEditor({type:'music'}));
  on('#addClosest', () => { editingPin=null; editingViewport=null; openEditor({type:'closest'}); });
  on('#cancel', () => { editing = null; editingViewport=null; render(); });
  document.querySelector('#questionForm')?.addEventListener('submit', async e => {
    e.preventDefault(); const f = new FormData(e.target), saveButton = document.querySelector('#saveQuestion');
    const q = {id:f.get('id') || undefined,type:f.get('type'),title:f.get('title'),answer:f.get('answer')};
    const saved = state.questions.find(item => item.id === q.id);
    if (saveButton) { saveButton.disabled = true; saveButton.textContent = 'Sparar…'; }
    try {
      if (q.type === 'music') {
        const file = f.get('videoFile');
        q.video = file?.size ? await uploadVideo(file) : saved?.video;
        q.musicQuestions = [0,1].map(i => ({question:f.get('musicQuestion'+i),answer:f.get('musicAnswer'+i)}));
      } else if (q.type === 'closest') {
        const file=f.get('imageFile');
        q.image=saved?.image;
        if (file?.size) {
          const mime={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[file.type];
          if (!mime) throw Error('Välj en PNG-, JPG- eller WebP-bild.');
          const response=await fetch('/api/image/upload',{method:'POST',headers:{'Content-Type':file.type},body:file});
          const result=await response.json(); if (!response.ok) throw Error(result.error||'Bilden kunde inte laddas upp.');
          q.image=result.image;
        }
        q.clue=f.get('clue'); q.points=f.get('points'); q.answerLat=f.get('answerLat'); q.answerLon=f.get('answerLon'); q.viewport=f.get('viewport')?JSON.parse(f.get('viewport')):null;
      } else {
        q.clues = [0,1,2,3,4].map(i => f.get('clue'+i));
        q.films = [];
        for (const i of [0,1,2]) {
          const file = f.get('filmVideo'+i);
          if (saveButton && file?.size) saveButton.textContent = `Laddar upp Resefilm ${i + 1}…`;
          const video = file?.size ? await uploadVideo(file) : f.get('filmVideoRemove'+i) ? '' : saved?.films?.[i]?.video || '';
          q.films.push({video, questions:[0,1].map(j => ({question:f.get(`film${i}q${j}`),answer:f.get(`film${i}a${j}`)}))});
        }
      }
      state = await api('question/save',q); editing = null;editingViewport=null; render();
    } catch (error) { alert(error.message); if (saveButton) { saveButton.disabled = false; saveButton.textContent = 'Spara fråga'; } }
  });
  scalePreview();
  // När steget byts rullar manuset till aktuell ledtråd eller resefilm.
  const g = state.game, focus = JSON.stringify([hostTab, g.questionId, g.phase, g.clueIndex, g.filmIndex, g.filmStage]);
  if (focus !== hostFocus) { hostFocus = focus; document.querySelector('.cr-manus .now')?.scrollIntoView?.({block:'center', behavior:'smooth'}); }
}
// Kortkommandon för spelledaren i Show-läget; ignoreras när man skriver i ett fält.
document.addEventListener('keydown', e => {
  if (state?.role !== 'host' || hostTab !== 'show' || e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '')) return;
  const k = (e.key || '').toLowerCase(), g = state.game, q = state.activeQuestion;
  if (k === ' ' || k === 'arrowright') { e.preventDefault(); runStep(nextStep()); }
  else if (k === 'r' && q?.type === 'destination' && g.phase === 'active') action('game/reveal');
  else if (k === 's' || k === 'b') { const mode = k === 's' ? 'scoreboard' : 'blank'; action('tv', { mode: state.tv?.mode === mode ? 'game' : mode }); }
  else if (k === 'n') openScreen();
  else if (k === 'p' && state.screenView?.video && state.tv?.mode === 'game') action('tv/video', { action: state.tvStatus?.playing ? 'pause' : 'play' });
});
if (typeof window !== 'undefined') window.addEventListener?.('resize', scalePreview);
document.addEventListener('click', e => { if (state?.role === 'host' && e.target?.closest?.('[data-open-screen]')) openScreen(); });
function bindTeam() {
  document.querySelector('#leaveTeam')?.addEventListener('click', async () => { try { await api('leave', {}); location.href = '/'; } catch (e) { alert(e.message); } });

  document.querySelector('#musicAnswerForm')?.addEventListener('submit', async e => { e.preventDefault(); const answer = new FormData(e.target).get('answer'); await action('music-answer', {answer, round:state.round}); });
  document.querySelector('#filmForm')?.addEventListener('submit', async e => { e.preventDefault(); const f = new FormData(e.target); await action('film-answer', { answers:[f.get('answer0'), f.get('answer1')], round:state.round, index:state.filmIndex }); });
  const brake = document.querySelector('#brake');
  if (brake) {
    let start = null;
    brake.onpointerdown = e => { start = e.clientY; brake.setPointerCapture(e.pointerId); };
    brake.onpointermove = e => { if (start === null) return; const travel = Math.max(0, Math.min(100, e.clientY - start)); brake.style.setProperty('--pull', travel+'px'); brake.setAttribute('aria-valuenow', String(travel)); };
    const pull = async () => {
      if (brakePending) return;
      brakePending = true;
      try { state = await api('brake', { round: state.round }); render(); document.querySelector('#answerForm input')?.focus(); }
      catch (error) { alert(error.message); }
      finally { brakePending = false; }
    };
    brake.onpointerup = e => { const pulled = start !== null && e.clientY - start > 60; start = null; brake.style.setProperty('--pull','0px'); brake.setAttribute('aria-valuenow','0'); if (pulled) pull(); };
    brake.onpointercancel = () => { start = null; brake.style.setProperty('--pull','0px'); brake.setAttribute('aria-valuenow','0'); };
    brake.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pull(); } };
  }
  document.querySelector('#answerForm')?.addEventListener('submit', async e => { e.preventDefault(); const answer = new FormData(e.target).get('answer'); await action('answer', {answer}); brakeOpen = false; });
}
document.addEventListener('submit', async e => { if (e.target.id !== 'login') return; e.preventDefault(); const f = new FormData(e.target); try { const result = await api('login', {code:f.get('code')}); location.href = '/view/' + result.role; } catch(err) { alert(err.message); } });
render();
setInterval(() => { const left = Math.max(0, Math.ceil((closestDeadline - performance.now()) / 1000)); document.querySelectorAll('#countdown,[data-countdown]').forEach(el => { el.textContent = left; }); }, 100);
(async () => {
  try {
    const me = await api('me');
    if (!me.role) {
      // Gäst: visa lagvalet och uppdatera live när andra lag tas.
      state = { ...await api('lobby'), guest: true }; render();
      const guestEvents = new EventSource('/api/events');
      guestEvents.onmessage = e => { const next = JSON.parse(e.data); if (next.role) { location.reload(); return; } state = { ...next, guest: true }; if (!showLogin) render(); };
      return;
    }
    localHost = !!me.local;
    const requested = location.pathname.split('/')[2];
    asScreen = me.role === 'host' && requested === 'screen';
    if (location.pathname.startsWith('/view/') && requested !== me.role && !asScreen) { app.textContent = 'Ingen åtkomst.'; return; }
    const as = asScreen ? '?view=screen' : '';
    state = await api('state' + as); trackDeadline(state); handleBrakes(state, true); syncDestinationMusic(state); render(); applyVideoCmd();
    const events = new EventSource('/api/events' + as);
    events.onmessage = e => {
      const next = JSON.parse(e.data);
      if (next.role === 'host') {
        // Rita inte om redigeraren medan spelledaren skriver; TV-status uppdateras på plats.
        trackDeadline(next); const same = hostKey(next) === hostKey(state); state = next;
        if (same || (hostTab === 'prepare' && editing !== null)) patchTv(); else render();
        return;
      }
      if (next.role !== state.role) { location.href = '/'; return; } // laget frigjordes av spelledaren
      const draft = document.querySelector('#answerForm input, #musicAnswerForm textarea')?.value;
      const filmDraft = [...(document.querySelectorAll?.('#filmForm input') || [])].map(input => input.value);
      if (next.round !== state.round || next.phase !== state.phase || next.stage !== state.stage) { brakeOpen = false; draftPin = null; }
      trackDeadline(next);
      const keepTeamMap = next.type === 'closest' && state.type === 'closest' && next.role !== 'screen' && next.role !== 'host' && next.stage === 1 && state.stage === 1 && next.round === state.round && next.phase === state.phase;
      const shouldRender = !keepTeamMap && (next.role !== 'screen' || screenKey(next) !== screenKey(state));
      handleBrakes(next); syncDestinationMusic(next); state = next; if (shouldRender) render();
      applyVideoCmd();
      const currentInput = document.querySelector('#answerForm input, #musicAnswerForm textarea');
      if (draft && currentInput) currentInput.value = draft;
      if (filmDraft.length) [...(document.querySelectorAll?.('#filmForm input') || [])].forEach((input,i) => { if (filmDraft[i]) input.value = filmDraft[i]; });
    };
  } catch (err) {
    app.innerHTML = `<section class="login card"><h1>Kunde inte ladda appen</h1><p>${esc(err.message)}</p><p>Kontrollera att servern körs och öppna adressen som visas i terminalen.</p></section>`;
  }
})();
})();
