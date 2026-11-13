(() => {
'use strict';
const app = document.querySelector('#app');
let state = null, editing = null, brakeOpen = false, editingPin = null, editingViewport = null, draftPin = null;
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
async function action(path, data = {}) { try { state = await api(path, data); render(); } catch (e) { alert(e.message); } }
function render() {
  if (!state?.role) { app.innerHTML = `<section class="login card"><h1>På resande fot</h1><p>Ange din kod för att komma till rätt vy.</p><form id="login"><label>Åtkomstkod<input name="code" type="password" required autocomplete="current-password" autocapitalize="none" spellcheck="false"></label><button>Logga in</button></form></section>`; return; }
  document.body.className = state.theme || state.role;
  app.innerHTML = (state.role === 'host' ? host() : state.role === 'screen' ? screen() : `<div class="team-score" aria-live="polite">Lagets poäng <strong>${state.score ?? 0}</strong></div>` + team()) + '<button class="exit-button" id="logout">Avsluta</button>';
  document.querySelector('#logout').onclick = async () => { await api('logout', {}); location.href = '/'; };
  if (state.role === 'host') bindHost();
  if (state.teams?.some(t => t.id === state.role)) bindTeam();
  if (state.role === 'screen') document.querySelector('#enableSound')?.addEventListener('click', enableSound);
  mountMaps();
  const video = document.querySelector('#musicVideo');
  if (video) {
    const playButton = document.querySelector('#playVideo');
    video.play().catch(() => { playButton.hidden = false; });
    playButton.onclick = () => video.play().then(() => { playButton.hidden = true; }).catch(() => { playButton.hidden = false; });
  }
}
function screenKey(data) { return JSON.stringify([data.round,data.phase,data.type,data.points,data.followupNumber,data.question,data.answer,data.video,data.questions,data.answers,data.stage,data.image,data.pins,data.correct,data.result,data.type==='destination'?data.brakes:undefined]); }
function resultText(result) { if (!result) return ''; const winner=result.winner==='tie'?'Oavgjort':result.winner?teamLabel(result.winner):'Inget lag'; const distances=activeTeamList().map(t=>`${esc(t.short)}: ${result.distances?.[t.id] ?? '–'} km`).join(' · '); return `<div class="closest-result"><h2>Närmast: ${esc(winner)}</h2><p>${distances}</p></div>`; }
function mountMaps() {
  if (typeof window === 'undefined' || !window.GameMap) return;
  window.GameMap.cleanup?.();
  const editorMap=document.querySelector('#correctMap');
  if (editorMap) {
    const scope='world';
    const question=state.questions.find(item=>item.id===editing);
    const saved=question?.viewport || null;
    const viewport=document.querySelector('[name="viewport"]').value;
    const draw=()=>window.GameMap.draw(editorMap,{scope,viewport:viewport?JSON.parse(viewport):saved,key:'editor',pins:editingPin?{mine:editingPin}:{},onViewport:area=>{editingViewport=area;document.querySelector('[name="viewport"]').value=JSON.stringify(area);},onPick:point=>{editingPin=point;document.querySelector('[name="answerLat"]').value=point.lat;document.querySelector('[name="answerLon"]').value=point.lon;draw();}});
    draw();
  }
  const teamMap=document.querySelector('#teamMap');
  if (teamMap) {
    const pin=state.pin||draftPin;
    const draw=()=>window.GameMap.draw(teamMap,{scope:state.scope,viewport:state.viewport,locked:true,key:'team:'+state.round,pins:(state.pin||draftPin)?{mine:state.pin||draftPin}:{},correct:state.correct,onPick:state.pin||state.correct?null:point=>{draftPin=point;draw();document.querySelector('#saveClosest').disabled=false;}});
    draw();
  }
  const screenMap=document.querySelector('#screenMap');
  if (screenMap) window.GameMap.draw(screenMap,{scope:state.scope,viewport:state.viewport,locked:true,key:'screen:'+state.round,pins:state.pins||{},correct:state.correct});
}
function host() {
  const g = state.game, q = state.activeQuestion;
  let current = `<div class="card"><h2>Pågående spel</h2><p>Väntar på nästa fråga.</p></div>`;
  if (q && g.phase !== 'waiting') {
    current = q.type === 'closest'
      ? `<div class="card"><div class="eyebrow">Närmast vinner</div><h2>${esc(q.title)}</h2><p>${activeTeamList().map(t=>`${esc(t.short)}: ${g.closestAnswers?.[t.id] ? 'Kartnål låst' : 'Väntar på svar'}`).join(' · ')}</p><div class="actions">${g.closestStage===0 ? `<button id="closestMap" ${activeTeamList().some(t=>!g.closestAnswers?.[t.id]) ? 'disabled' : ''}>Visa karta på storbilden</button>` : ''}${g.closestStage===1 ? '<button id="closestPins">Visa lagens nålar</button>' : ''}${g.closestStage===2 ? '<button id="closestAnswer">Visa rätt plats och resultat</button>' : ''}<button id="wait">Nästa fråga</button></div>${g.closestStage===3 ? resultText(state.closestResult) : ''}</div>`
      : q.type === 'music'
      ? `<div class="card"><div class="eyebrow">Musikfråga · Pågår</div><h2>${esc(q.title)}</h2><p>Videon visas på storbilden tills du visar frågorna.</p>${g.musicShown ? `<div class="eyebrow">Alla musikfrågor</div><ol class="music-questions">${q.musicQuestions.map(item => `<li>${esc(item.question)}<br><small>Facit: ${esc(item.answer)}</small></li>`).join('')}</ol><div class="answers">${answerSlots(id => g.musicAnswers?.[id] ? esc(g.musicAnswers[id]) : 'Inget låst svar')}</div>${!g.musicRevealed ? '<button id="revealMusic">Avslöja facit</button>' : ''}` : '<button id="showMusicQuestions">Visa alla musikfrågor</button>'}<button id="wait">Nästa fråga</button></div>`
      : `<div class="card"><div class="eyebrow">Resmål · ${g.phase === 'revealed' ? 'Avslöjad' : 'Pågår'}</div><h2>${esc(q.title)}</h2><div class="points">${[10,8,6,4,2][g.clueIndex]} poäng</div><p class="clue">${esc(q.clues[g.clueIndex])}</p><div class="actions">${g.phase === 'active' && g.clueIndex < 4 ? '<button id="next">Nästa ledtråd</button>' : ''}${g.phase === 'active' ? '<button id="reveal">Avslöja facit</button>' : '<button id="wait">Nästa fråga</button>'}</div>${g.phase === 'revealed' ? `<p class="answer">Rätt svar: ${esc(q.answer)}</p>` : ''}<div class="answers">${answerSlots(id => g.answers[id] ? `${esc(g.answers[id].answer)} · ${g.answers[id].points} p` : 'Inget låst svar')}</div></div>`;
  }
  if (q?.type === 'destination' && g.phase === 'revealed') {
    const index = g.followupIndex;
    const nextIndex = Number.isInteger(index) ? index + 1 : 0;
    const followup = Number.isInteger(index) ? q.followups?.[index] : null;
    current += `<div class="card"><h2>Följdfrågor</h2>${followup ? `<div class="eyebrow">Fråga ${index + 1} på storbilden</div><p class="clue">${esc(followup.question)}</p><p>Facit: <strong>${esc(followup.answer)}</strong></p><div class="answers">${answerSlots(id => g.followupAnswers?.[index]?.[id] ? esc(g.followupAnswers[index][id]) : 'Inget låst svar')}</div>${!g.followupRevealed ? '<button id="revealFollowup">Avslöja följdfrågans facit</button>' : ''}` : '<p>Välj en följdfråga att visa.</p>'}${nextIndex < 2 && q.followups?.[nextIndex]?.question && (index === undefined || g.followupRevealed) ? `<button data-followup="${nextIndex}">Visa följdfråga ${nextIndex + 1}</button>` : ''}</div>`;
  }
  const rows = state.questions.map((q,index) => `<div class="question-row"><div><strong>${index + 1}. ${esc(q.title)}</strong><small>${q.type === 'destination' ? 'Resmål' : q.type === 'closest' ? 'Närmast vinner' : 'Musikfråga'}</small></div><div class="actions"><button class="secondary move-button" data-move="${esc(q.id)}" data-direction="-1" aria-label="Flytta ${esc(q.title)} upp" title="Flytta upp" ${index === 0 ? 'disabled' : ''}>↑</button><button class="secondary move-button" data-move="${esc(q.id)}" data-direction="1" aria-label="Flytta ${esc(q.title)} ned" title="Flytta ned" ${index === state.questions.length - 1 ? 'disabled' : ''}>↓</button><button data-start="${esc(q.id)}">Starta</button><button class="secondary" data-edit="${esc(q.id)}">Redigera</button><button class="secondary" data-delete="${esc(q.id)}">Ta bort</button></div></div>`).join('');
  const e = editing && state.questions.find(q => q.id === editing);
  const editorType=e?.type || editing?.type;
  const isMusic = editorType === 'music';
  const editorFields = editorType === 'closest'
    ? `<label>Bild (PNG, JPG eller WebP)<input name="imageFile" type="file" accept="image/png,image/jpeg,image/webp" ${e?.image?'':'required'}></label>${e?.image?'<p>En bild är redan sparad. Välj en fil om du vill byta den.</p>':''}<p>Zooma och flytta kartan till det utsnitt lagen ska se. Klicka sedan på rätt plats. Det synliga utsnittet sparas när du sparar frågan.</p><div id="correctMap" class="map-wrap"></div><input type="hidden" name="viewport" value="${esc(editingViewport?JSON.stringify(editingViewport):e?.viewport?JSON.stringify(e.viewport):'')}"><input type="hidden" name="answerLat" value="${esc(editingPin?.lat ?? e?.answerLat ?? '')}"><input type="hidden" name="answerLon" value="${esc(editingPin?.lon ?? e?.answerLon ?? '')}">`
    : isMusic
    ? `<label>MP4-video<input name="videoFile" type="file" accept="video/mp4,.mp4" ${e?.video ? '' : 'required'}></label>${e?.video ? '<p>En video är redan sparad. Välj en fil om du vill byta den.</p>' : ''}${[0,1].map(i => `<label>Musikfråga ${i + 1}<textarea name="musicQuestion${i}" required>${esc(e?.musicQuestions?.[i]?.question || '')}</textarea></label><label>Facit till musikfråga ${i + 1}<input name="musicAnswer${i}" required value="${esc(e?.musicQuestions?.[i]?.answer || '')}"></label>`).join('')}`
    : [10,8,6,4,2].map((p,i) => `<label>${p} poäng<textarea name="clue${i}" required>${esc(e?.clues?.[i] || '')}</textarea></label>`).join('') + [0,1].map(i => `<label>Följdfråga ${i + 1}<textarea name="followupQuestion${i}">${esc(e?.followups?.[i]?.question || '')}</textarea></label><label>Facit till följdfråga ${i + 1}<input name="followupAnswer${i}" value="${esc(e?.followups?.[i]?.answer || '')}"></label>`).join('') + `<label>Facit<input name="answer" required value="${esc(e?.answer || '')}"></label>`;
  const teamPicker = state.phase === 'waiting' ? `<form id="teamsForm"><div class="team-picker">${(state.teams||[]).map(t=>`<label class="team-pick"><input type="checkbox" name="team" value="${esc(t.id)}" ${state.activeTeams.includes(t.id)?'checked':''}> ${esc(t.short)}</label>`).join('')}</div><button>Spara lag</button><p class="hint">Välj 2–5 lag. Kan ändras mellan frågorna.</p></form>` : `<p class="hint">Aktiva lag: ${activeTeamList().map(t=>esc(t.short)).join(', ')}</p>`;
  return `<div class="layout">${current}<section class="card scoreboard"><h2>Poäng</h2>${teamPicker}${activeTeamList().map(t=>`<form data-score="${t.id}"><strong>${esc(t.short)}: ${state.scores[t.id]} p</strong><input name="delta" type="number" min="1" max="100" value="1" aria-label="Poäng för ${esc(t.short)}" required><button name="sign" value="1">Lägg till</button><button name="sign" value="-1" class="secondary">Dra av</button></form>`).join('')}</section><section class="card"><h2>Frågor</h2>${rows || '<p>Inga frågor ännu.</p>'}<button id="addDest">Nytt resmål</button> <button id="addMusic" class="secondary">Ny musikfråga</button> <button id="addClosest" class="secondary">Ny Närmast vinner</button></section><section class="card" id="editor" ${editing === null ? 'hidden' : ''}><h2>${e ? 'Redigera fråga' : 'Ny fråga'}</h2><form id="questionForm"><input type="hidden" name="id" value="${esc(e?.id || '')}"><input type="hidden" name="type" value="${esc(e?.type || editing?.type || 'destination')}"><label>Titel<input name="title" required value="${esc(e?.title || '')}"></label>${editorFields}<div class="actions"><button>Spara fråga</button><button type="button" id="cancel" class="secondary">Avbryt</button></div></form></section></div>`;
}
function team() {
  if (state.phase === 'waiting') return `<section class="hero card"><div class="eyebrow">Redo för avfärd</div><h1>Väntar på nästa fråga</h1><p>Spelledaren startar snart.</p></section>`;
  if (state.type === 'closest') return `<section class="hero card closest-team"><div class="eyebrow">Närmast vinner</div><h1>Sätt er kartnål</h1><div id="teamMap" class="map-wrap"></div>${state.pin ? '<div class="locked">Er kartnål är låst.</div>' : `<p>Tryck på kartan där ni tror att bilden är tagen.</p><button id="saveClosest" ${draftPin?'':'disabled'}>Lås kartnål</button>`}${state.correct ? resultText(state.result) : ''}</section>`;
  if (state.type === 'music') return `<section class="hero card"><h1>Lyssna och njut</h1></section>`;
  if (state.type === 'music-question') return `<section class="hero card"><div class="eyebrow">Musikfrågor</div><ol class="music-questions">${state.questions.map(question => `<li>${esc(question)}</li>`).join('')}</ol>${state.locked ? `<div class="locked"><strong>Ert svar är låst</strong><p class="preserve-lines">${esc(state.locked)}</p></div>` : state.answers ? '' : `<form id="musicAnswerForm"><label>Skriv svaren på alla frågor i samma ruta<textarea name="answer" required maxlength="2000" rows="6"></textarea></label><button>Lås svar</button></form>`}${state.answers ? `<div class="reveal"><strong>Rätta svar</strong><ol>${state.answers.map(answer => `<li>${esc(answer)}</li>`).join('')}</ol></div>` : ''}</section>`;
  if (state.type === 'followup') return `<section class="hero card"><div class="eyebrow">Följdfråga ${state.followupIndex + 1}</div><h1>${esc(state.question)}</h1>${state.locked ? `<div class="locked"><strong>Ert svar är låst</strong><p>${esc(state.locked)}</p></div>` : state.answer ? '' : `<form id="followupForm"><label>Ert svar<input name="answer" required maxlength="200" autocomplete="off"></label><button>Lås svar</button></form>`}${state.answer ? `<div class="reveal">Rätt svar: <strong>${esc(state.answer)}</strong></div>` : ''}</section>`;
  const locked = state.locked;
  if (locked) return `<section class="hero card"><div class="eyebrow">${state.type === 'destination' ? 'Resmål' : 'Musikfråga'}</div><h1>Svaret är låst</h1><div class="points">${locked.points} poäng</div><div class="locked"><strong>Ert svar</strong><p>${esc(locked.answer)}</p></div>${state.phase === 'revealed' ? `<div class="reveal">Rätt svar: <strong>${esc(state.answer)}</strong></div>` : ''}</section>`;
  return `<section class="hero card"><h1>${state.type === 'destination' ? 'Vart är vi påväg?' : 'Musikfråga'}</h1><div class="points">${state.points} poäng</div>${state.phase === 'revealed' ? `<div class="reveal">Rätt svar: <strong>${esc(state.answer)}</strong></div>` : state.brakeBlocked ? '<div class="locked">Nödbromsen är dragen. Vänta på nästa poängnivå.</div>' : `${state.type === 'destination' && !state.pulled ? `<div class="brake" id="brake" role="slider" tabindex="0" aria-label="Dra nödbromsen nedåt eller tryck Enter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><img class="brake-image" src="/assets/nodbroms.png" alt="Nödbroms" draggable="false"><strong>Dra nedåt för att bromsa</strong></div>` : ''}<form id="answerForm" ${state.type === 'destination' && !state.pulled ? 'hidden' : ''}><label>Ert svar<input name="answer" required maxlength="200" autocomplete="off"></label><button>Lås svar och ${state.points} poäng</button></form>`}</section>`;
}
function screen() {
  const soundControl = audioReady ? '' : `<div class="sound-control"><button id="enableSound" ${audioLoading ? 'disabled' : ''}>${audioLoading ? 'Laddar ljud…' : 'Aktivera ljud'}</button><p>${esc(audioError || 'Klicka en gång för att höra resmålsmusiken och lagens nödbromsar.')}</p></div>`;
  const brakes=state.type==='destination' && state.phase==='active' ? state.brakes||[] : [];
  const brakeNotice=brakes.length ? `<div class="screen-brake-notices" aria-live="polite">${brakes.map((event,index)=>{const meta=teamMeta(event.team);return `<div class="screen-brake-notice ${(meta?.theme||'dressin')+'-brake'} ${index===brakes.length-1?'latest-brake':''}"><img src="/assets/nodbroms.png" alt=""><div><strong>${esc(meta?.short||event.team)} har dragit i nödbromsen!</strong></div></div>`;}).join('')}</div>` : '';
  if (state.phase === 'waiting') return soundControl + `<section class="screen-card"><div class="eyebrow">På resande fot</div><h1>Väntar på nästa fråga</h1></section>`;
  if (state.type === 'closest') return soundControl + (state.stage===0 ? `<section class="screen-card closest-screen media-screen"><img class="closest-image" src="${esc(state.image)}" alt="Bild för Närmast vinner"></section>` : `<section class="screen-card closest-screen"><div class="eyebrow">Närmast vinner</div><div id="screenMap" class="map-wrap"></div>${state.stage>=2?`<p class="map-legend">${activeTeamList().map(t=>`<span style="color:${esc(t.color)}">● ${esc(t.short)}</span>`).join(' ')}${state.stage>=3?' <span class="correct-dot">● Rätt plats</span>':''}</p>`:''}${state.stage===3?resultText(state.result):''}</section>`);
  if (state.type === 'music') {
    if (state.questions) return soundControl + `<section class="screen-card music-question-screen"><div class="eyebrow">Musikfrågor</div><h1>${state.answers?'Rätta svar':'Vad hörde ni?'}</h1><ol class="screen-music-questions">${state.questions.map((question,index) => `<li><div class="music-question-copy">${esc(question)}</div>${state.answers ? `<div class="screen-music-answer"><span>Rätt svar</span><strong>${esc(state.answers[index])}</strong></div>` : ''}</li>`).join('')}</ol></section>`;
    return soundControl + `<section class="screen-card music-screen media-screen"><video id="musicVideo" src="${esc(state.video)}" autoplay playsinline controls></video><button id="playVideo" class="video-play" hidden>Starta video</button></section>`;
  }
  if (state.followupNumber) return soundControl + `<section class="screen-card"><div class="eyebrow">Följdfråga ${state.followupNumber}</div><h1>${esc(state.question)}</h1>${state.answer ? `<div class="reveal">Svar: <strong>${esc(state.answer)}</strong></div>` : ''}</section>`;
  if(state.phase==='revealed')return `<section class="screen-card answer-screen"><div class="reveal">Rätt svar: <strong>${esc(state.answer)}</strong></div></section>`;
  return soundControl + `<section class="screen-card"><div class="eyebrow">Resmål</div><h1>Vart är vi påväg?</h1><div class="points">${state.points} poäng</div>${brakeNotice}</section>`;
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
  audioLoading = false; render();
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
function bindHost() {
  for (const [id,stage] of [['closestMap',1],['closestPins',2],['closestAnswer',3]]) document.querySelector('#'+id)?.addEventListener('click',()=>action('game/closest-stage',{stage}));
  document.querySelector('#teamsForm')?.addEventListener('submit', async event => { event.preventDefault(); await action('teams', { teams: [...new FormData(event.target).getAll('team')] }); });
  document.querySelectorAll('[data-score]').forEach(form=>form.addEventListener('submit',async event=>{event.preventDefault();const amount=Number(new FormData(form).get('delta'));const sign=Number(event.submitter?.value||1);await action('score/add',{team:form.dataset.score,delta:amount*sign});}));
  document.querySelector('#next')?.addEventListener('click', () => action('game/next'));
  document.querySelector('#reveal')?.addEventListener('click', () => action('game/reveal'));
  document.querySelector('#wait')?.addEventListener('click', () => action('game/wait'));
  document.querySelector('#revealFollowup')?.addEventListener('click', () => action('game/followup-reveal'));
  document.querySelector('#revealMusic')?.addEventListener('click', () => action('game/music-reveal'));
  document.querySelector('#showMusicQuestions')?.addEventListener('click', () => action('game/music-question'));
  document.querySelectorAll('[data-followup]').forEach(b => b.onclick = () => action('game/followup', { index:Number(b.dataset.followup) }));
  document.querySelectorAll('[data-start]').forEach(b => b.onclick = () => action('game/start', {id:b.dataset.start}));
  document.querySelectorAll('[data-move]').forEach(b => b.onclick = () => action('question/move', {id:b.dataset.move,direction:Number(b.dataset.direction)}));
  document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { editing = b.dataset.edit; const q=state.questions.find(item=>item.id===editing); editingPin=q?.type==='closest'?{lat:q.answerLat,lon:q.answerLon}:null;editingViewport=q?.viewport||null; render(); document.querySelector('#editor').scrollIntoView(); });
  document.querySelectorAll('[data-delete]').forEach(b => b.onclick = () => { if (confirm('Ta bort frågan?')) action('question/delete', {id:b.dataset.delete}); });
  document.querySelector('#addDest').onclick = () => { editing = {type:'destination'}; render(); document.querySelector('#editor').scrollIntoView(); };
  document.querySelector('#addMusic').onclick = () => { editing = {type:'music'}; render(); document.querySelector('#editor').scrollIntoView(); };
  document.querySelector('#addClosest').onclick = () => { editing = {type:'closest'}; editingPin=null;editingViewport=null; render(); document.querySelector('#editor').scrollIntoView(); };
  document.querySelector('#cancel')?.addEventListener('click', () => { editing = null;editingViewport=null; render(); });
  document.querySelector('#questionForm')?.addEventListener('submit', async e => {
    e.preventDefault(); const f = new FormData(e.target);
    const q = {id:f.get('id') || undefined,type:f.get('type'),title:f.get('title'),answer:f.get('answer')};
    try {
      if (q.type === 'music') {
        const file = f.get('videoFile');
        q.video = state.questions.find(item => item.id === q.id)?.video;
        if (file?.size) {
          if (!file.name.toLowerCase().endsWith('.mp4')) throw Error('Välj en MP4-fil.');
          const response = await fetch('/api/video/upload', {method:'POST',headers:{'Content-Type':'video/mp4'},body:file});
          const result = await response.json(); if (!response.ok) throw Error(result.error || 'Videon kunde inte laddas upp.');
          q.video = result.video;
        }
        q.musicQuestions = [0,1].map(i => ({question:f.get('musicQuestion'+i),answer:f.get('musicAnswer'+i)}));
      } else if (q.type === 'closest') {
        const file=f.get('imageFile');
        q.image=state.questions.find(item=>item.id===q.id)?.image;
        if (file?.size) {
          const mime={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[file.type];
          if (!mime) throw Error('Välj en PNG-, JPG- eller WebP-bild.');
          const response=await fetch('/api/image/upload',{method:'POST',headers:{'Content-Type':file.type},body:file});
          const result=await response.json(); if (!response.ok) throw Error(result.error||'Bilden kunde inte laddas upp.');
          q.image=result.image;
        }
        q.answerLat=f.get('answerLat'); q.answerLon=f.get('answerLon'); q.viewport=f.get('viewport')?JSON.parse(f.get('viewport')):null;
      } else {
        q.clues = [0,1,2,3,4].map(i => f.get('clue'+i));
        q.followups = [0,1].map(i => ({question:f.get('followupQuestion'+i),answer:f.get('followupAnswer'+i)}));
      }
      state = await api('question/save',q); editing = null;editingViewport=null; render();
    } catch (error) { alert(error.message); }
  });
}
function bindTeam() {
  document.querySelector('#saveClosest')?.addEventListener('click',async()=>{if (!draftPin) return;await action('closest-answer',{...draftPin,round:state.round});});
  document.querySelector('#musicAnswerForm')?.addEventListener('submit', async e => { e.preventDefault(); const answer = new FormData(e.target).get('answer'); await action('music-answer', {answer, round:state.round}); });
  document.querySelector('#followupForm')?.addEventListener('submit', async e => { e.preventDefault(); const answer = new FormData(e.target).get('answer'); await action('followup-answer', { answer, round:state.round, index:state.followupIndex }); });
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
(async () => {
  try {
    const me = await api('me');
    if (!me.role) return;
    const requested = location.pathname.split('/')[2];
    if (location.pathname.startsWith('/view/') && requested !== me.role) { app.textContent = 'Ingen åtkomst.'; return; }
    state = await api('state'); handleBrakes(state, true); syncDestinationMusic(state); render();
    const events = new EventSource('/api/events');
    events.onmessage = e => {
      const next = JSON.parse(e.data);
      const draft = document.querySelector('#answerForm input, #followupForm input, #musicAnswerForm textarea')?.value;
      if (next.round !== state.round || next.phase !== state.phase) { brakeOpen = false; draftPin = null; }
      const shouldRender = next.role !== 'screen' || screenKey(next) !== screenKey(state);
      handleBrakes(next); syncDestinationMusic(next); state = next; if (shouldRender) render();
      const currentInput = document.querySelector('#answerForm input, #followupForm input, #musicAnswerForm textarea');
      if (draft && currentInput) currentInput.value = draft;
    };
  } catch (err) {
    app.innerHTML = `<section class="login card"><h1>Kunde inte ladda appen</h1><p>${esc(err.message)}</p><p>Kontrollera att servern körs och öppna adressen som visas i terminalen.</p></section>`;
  }
})();
})();
