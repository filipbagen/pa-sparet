const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const teams = [
  { id: 'forsta', short: 'Första klass', theme: 'forsta', sound: 'forsta', letter: 'F', color: '#8e44ad' },
  { id: 'dressin', short: 'Dressinen', theme: 'dressin', sound: 'dressin', letter: 'D', color: '#168b53' },
  { id: 'x2000', short: 'X2000', theme: 'forsta', sound: 'forsta', letter: 'X', color: '#c0392b' },
  { id: 'malartag', short: 'Mälartåg', theme: 'dressin', sound: 'dressin', letter: 'M', color: '#2980b9' },
  { id: 'loket', short: 'Loket', theme: 'forsta', sound: 'forsta', letter: 'L', color: '#d68910' },
];
const activeTeams = ['dressin', 'forsta'];

const browserTimers = { setInterval() {}, performance: { now: () => 0 } };
test('startsidan ritas även när webbläsaren reserverar window.top', async () => {
  const app = { innerHTML: '' };
  const requests = [];
  const context = {
    document: {
      querySelector: selector => selector === '#app' ? app : null,
      addEventListener() {},
    },
    fetch: async url => {
      requests.push(url);
      return { ok: true, json: async () => ({ role: null }) };
    },
  };
  // window.top är en skrivskyddad, icke-konfigurerbar egenskap i webbläsaren.
  Object.defineProperty(context, 'top', { value: context, writable: false, configurable: false });
  const source = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
  assert.doesNotThrow(() => vm.runInNewContext(source, Object.assign(context, browserTimers)));
  await new Promise(resolve => setImmediate(resolve));
  assert.match(app.innerHTML, /id="login"/);
  assert.match(app.innerHTML, /Åtkomstkod/);
  assert.doesNotMatch(app.innerHTML, /<select|name="role"/);
  assert.deepEqual(requests, ['/api/me']);
  assert.equal(context.top, context);
});

test('storbilden spelar rätt bromsljud en gång per händelse', async () => {
  const app = { innerHTML: '' }, logout = {}, enableButton = {};
  const played = [], stopped = [];
  let eventSource, enable, now=1;
  enableButton.addEventListener = (name, callback) => { enable = callback; };
  const initial = { role:'screen', label:'Storbild', phase:'active', type:'destination', round:1, points:10, title:'Resa', clue:'En ledtråd', brakes:[], teams, activeTeams };
  const context = {
    document: { body:{}, querySelector: selector => ({'#app':app,'#logout':logout,'#enableSound':enableButton}[selector] || null), addEventListener() {} },
    location: {pathname:'/view/screen'},
    fetch: async url => ({ ok:true, json:async()=>url === '/api/me' ? {role:'screen'} : initial, arrayBuffer:async()=>url }),
    EventSource: class { constructor() { eventSource = this; } },
    AudioContext: class {
      state = 'running'; get currentTime(){return now;} destination = {};
      async resume() {}
      async decodeAudioData(file) { return {file,duration:2}; }
      createBufferSource() { const source = {connect(){},disconnect(){},stop(){stopped.push(source.buffer.file);},start(time,offset){played.push({file:source.buffer.file,time,offset,loop:!!source.loop});}}; return source; }
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'public/app.js'),'utf8'),Object.assign(context,browserTimers));
  await new Promise(resolve=>setImmediate(resolve));
  assert.doesNotMatch(app.innerHTML, /<header|En ledtråd|Resa/);
  await enable();
  assert.doesNotMatch(app.innerHTML, /Ljud aktiverat|<header/);
  assert.deepEqual(played,[{file:'/assets/resmal-loop.mp3',time:0,offset:0,loop:true}]);
  const emit = brakes => eventSource.onmessage({data:JSON.stringify({...initial,brakes})});
  emit(initial.brakes);
  assert.equal(played.length,1);
  const first = [{id:'new-dressin',team:'dressin'}];
  now=1.5;
  emit(first); emit(first);
  assert.deepEqual(played.slice(1),[{file:'/assets/dressin.ogg',time:1.5,offset:undefined,loop:false}]);
  assert.deepEqual(stopped,['/assets/resmal-loop.mp3']);
  assert.match(app.innerHTML,/Dressinen har dragit i nödbromsen/);
  assert.doesNotMatch(app.innerHTML,/Musiken är pausad/);
  eventSource.onmessage({data:JSON.stringify({...initial,points:8,brakes:[]})});
  assert.doesNotMatch(app.innerHTML,/har dragit i nödbromsen/);
  assert.deepEqual(played.at(-1),{file:'/assets/resmal-loop.mp3',time:0,offset:.5,loop:true});
  now=2;
  emit([{id:'new-forsta',team:'forsta'}]);
  assert.match(app.innerHTML,/Första klass har dragit i nödbromsen/);
  eventSource.onmessage({data:JSON.stringify({...initial,phase:'revealed',title:'Resa',clue:'En ledtråd',answer:'Göteborg'})});
  assert.deepEqual(stopped,['/assets/resmal-loop.mp3','/assets/resmal-loop.mp3']);
  assert.match(app.innerHTML,/Göteborg/);
  assert.doesNotMatch(app.innerHTML,/En ledtråd|poäng|Resa/);
  eventSource.onmessage({data:JSON.stringify({...initial,round:2,brakes:[]})});
  assert.equal(played.filter(item=>item.file==='/assets/resmal-loop.mp3').length,3);
  eventSource.onmessage({data:JSON.stringify({...initial,phase:'revealed',filmNumber:1,filmStage:'questions',questions:['Vad heter älven?','Vad heter nöjesfältet?']})});
  assert.match(app.innerHTML,/Resefilm 1/);
  assert.match(app.innerHTML,/Vad heter nöjesfältet\?/);
  assert.doesNotMatch(app.innerHTML,/Göteborg|En ledtråd|Rätt svar/);
  eventSource.onmessage({data:JSON.stringify({...initial,overlay:'scoreboard',type:undefined,scores:{dressin:4,forsta:9}})});
  assert.match(app.innerHTML,/Ställning/);
  assert.ok(app.innerHTML.indexOf('Första klass') < app.innerHTML.indexOf('Dressinen'));
  eventSource.onmessage({data:JSON.stringify({...initial,overlay:'blank',type:undefined})});
  assert.match(app.innerHTML,/tv-blank/);
  assert.doesNotMatch(app.innerHTML,/Ställning|Resefilm/);
});

test('lokal karta använder geografidata utan externa kartanrop', () => {
  const context={window:{},Map};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'public/map.js'),'utf8'),context);
  const data=JSON.parse(fs.readFileSync(path.join(__dirname,'public/assets/land.geojson'),'utf8'));
  assert.ok(data.features.length>1000);
  assert.ok(data.features.every(feature=>['Polygon','MultiPolygon'].includes(feature.geometry.type)));
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname,'public/map.js'),'utf8'),/unpkg|tiles\.openfreemap/);
  assert.equal(context.window.GameMap.bounds.world.west,-180);
});

test('lagets resefilm har två svarsfält och bara knappen Avsluta utanför frågan', async () => {
  const app = {innerHTML:''}, logout = {}, filmForm = {addEventListener(){}};
  const context = {
    document: {body:{},querySelector: selector => ({'#app':app,'#logout':logout,'#filmForm':filmForm}[selector] || null),addEventListener(){}},
    location:{pathname:'/view/dressin'},
    fetch: async url => ({ok:true,json:async()=>url === '/api/me' ? {role:'dressin'} : {role:'dressin',label:'Lag Dressin',theme:'dressin',phase:'revealed',type:'film',filmIndex:0,filmStage:'questions',round:1,score:7,questions:['Vad heter älven?','Vilket år?'],locked:null,teams,activeTeams}}),
    EventSource: class {},
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'public/app.js'),'utf8'),Object.assign(context,browserTimers));
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(app.innerHTML,/Vad heter älven\?/);
  assert.match(app.innerHTML,/id="filmForm"/);
  assert.match(app.innerHTML,/name="answer0"[\s\S]*name="answer1"/);
  assert.match(app.innerHTML,/Lagets poäng <strong>7<\/strong>/);
  assert.match(app.innerHTML,/>Avsluta<\/button>/);
  assert.doesNotMatch(app.innerHTML,/<header|Logga ut|Huvudmeny/);
});

test('musikvideo startar på storbilden och ersätts av vald fråga', async () => {
  const app={innerHTML:''}, logout={}, playButton={hidden:true};
  let played=0, events;
  const video={play(){played++;return Promise.resolve();}};
  const initial={role:'screen',label:'Storbild',phase:'active',round:2,type:'music',points:1,video:'/api/video/test.mp4',brakes:[],teams,activeTeams};
  const context={
    document:{body:{},querySelector: selector => ({'#app':app,'#logout':logout,'#musicVideo':app.innerHTML.includes('<video') ? video : null,'#playVideo':app.innerHTML.includes('<video') ? playButton : null}[selector] || null),addEventListener(){}},
    location:{pathname:'/view/screen'},
    fetch:async url=>({ok:true,json:async()=>url==='/api/me'?{role:'screen'}:initial}),
    EventSource:class{constructor(){events=this;}},
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'public/app.js'),'utf8'),Object.assign(context,browserTimers));
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(app.innerHTML,/<video/);
  assert.match(app.innerHTML,/music-screen media-screen/);
  assert.doesNotMatch(app.innerHTML,/Lyssna och njut/);
  assert.equal(played,1);
  events.onmessage({data:JSON.stringify({...initial,brakes:[{id:'silent',team:'dressin'}]})});
  assert.equal(played,1);
  events.onmessage({data:JSON.stringify({...initial,questions:['Vilken grupp?','Vilken låt?']})});
  assert.match(app.innerHTML,/music-question-screen|screen-music-questions/);
  assert.match(app.innerHTML,/Vilken grupp\?/);
  assert.match(app.innerHTML,/Vilken låt\?/);
  assert.doesNotMatch(app.innerHTML,/<video/);
  events.onmessage({data:JSON.stringify({...initial,questions:['Vilken grupp?','Vilken låt?'],answers:['ABBA','Waterloo']})});
  assert.match(app.innerHTML,/screen-music-answer/);
  assert.match(app.innerHTML,/Rätt svar<\/span><strong>ABBA/);
});

test('storbilden visar bild, karta, lagnålar och facit i rätt ordning', async () => {
  const app={innerHTML:''}, logout={}, soundButton={addEventListener(){}};
  const mapElement={}, draws=[]; let events;
  const viewport={west:17,east:19,south:59,north:60};
  const initial={role:'screen',label:'Storbild',phase:'active',round:3,type:'closest',scope:'sweden',viewport,stage:0,image:'/api/image/example.png',clue:'En stor sjö',teams,activeTeams};
  const context={
    window:{GameMap:{draw(element,options){draws.push(options);}}},
    document:{body:{},querySelector:selector=>({'#app':app,'#logout':logout,'#enableSound':soundButton,'#screenMap':app.innerHTML.includes('id="screenMap"')?mapElement:null}[selector]||null),addEventListener(){}},
    location:{pathname:'/view/screen'},
    fetch:async url=>({ok:true,json:async()=>url==='/api/me'?{role:'screen'}:initial}),
    EventSource:class{constructor(){events=this;}},
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'public/app.js'),'utf8'),Object.assign(context,browserTimers));
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(app.innerHTML,/api\/image\/example.png/);
  assert.match(app.innerHTML,/En stor sjö/);
  assert.doesNotMatch(app.innerHTML,/id="screenMap"|Rätt plats/);
  events.onmessage({data:JSON.stringify({...initial,stage:1,image:undefined,remainingMs:10000})});
  assert.match(app.innerHTML,/id="countdown"/);
  assert.match(app.innerHTML,/id="screenMap"/);
  assert.deepEqual(JSON.parse(JSON.stringify(draws.at(-1).viewport)),viewport);
  assert.equal(draws.at(-1).locked,true);
  assert.equal(draws.at(-1).pins && Object.keys(draws.at(-1).pins).length,0);
  const pins={dressin:{lat:59.34,lon:18.07},forsta:{lat:60.5,lon:15}};
  events.onmessage({data:JSON.stringify({...initial,stage:2,image:undefined,pins})});
  assert.equal(draws.at(-1).pins.dressin.lat,59.34);
  assert.doesNotMatch(app.innerHTML,/Närmast:/);
  events.onmessage({data:JSON.stringify({...initial,stage:3,image:undefined,pins,correct:{lat:59.33,lon:18.06},result:{winner:'dressin',winners:['dressin'],points:10,distances:{dressin:1.2,forsta:200}}})});
  assert.equal(draws.at(-1).correct.lat,59.33);
  assert.match(app.innerHTML,/Närmast: Dressinen/);
  assert.match(app.innerHTML,/<td>200 km<\/td>/);
  assert.match(app.innerHTML,/\+10/);
});

test('spelledarens Show-vy visar manus, facit, lagens svar, storbildsförhandsvisning och nästa steg', async () => {
  const app = {innerHTML:''}, logout = {}, posts = [], listeners = {};
  let events;
  const q = {id:'q1',type:'destination',title:'Västervik',answer:'Västervik',clues:['L1','L2','L3','L4','L5'],films:[{video:'v.mp4',questions:[{question:'Vad heter ön?',answer:'Stora Grindö'},{question:'Vilket år?',answer:'1433'}]},{video:'',questions:[{question:'',answer:''},{question:'',answer:''}]},{video:'',questions:[{question:'',answer:''},{question:'',answer:''}]}]};
  const game = {phase:'active',questionId:'q1',clueIndex:1,round:4,answers:{forsta:{answer:'Kalmar',points:8}},brakes:{dressin:{id:'b',team:'dressin'}},awards:{}};
  const initial = {role:'host',label:'Spelledare',phase:'active',round:4,teams,activeTeams,game,scores:{dressin:3,forsta:12},questions:[q,{id:'q2',type:'music',title:'Timbuktu',musicQuestions:[]}],played:['q1'],activeQuestion:q,tv:{mode:'game'},tvStatus:{audioReady:true},screenOnline:1,screenView:{role:'screen',phase:'active',type:'destination',points:8,brakes:[{id:'b',team:'dressin'}],teams,activeTeams}};
  const context = {
    document:{body:{},querySelector:selector=>({'#app':app,'#logout':logout}[selector]||null),querySelectorAll:()=>[],addEventListener(name,fn){listeners[name]=fn;}},
    location:{pathname:'/view/host'},
    fetch:async (url,opts)=>{ if (opts?.method==='POST') posts.push([url,JSON.parse(opts.body)]); return {ok:true,json:async()=>url==='/api/me'?{role:'host'}:initial}; },
    EventSource:class{constructor(){events=this;}},
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'public/app.js'),'utf8'),Object.assign(context,browserTimers));
  await new Promise(resolve=>setImmediate(resolve));
  const html = app.innerHTML;
  assert.match(html,/class="cr-facit"[\s\S]*Västervik/);
  for (const clue of ['L1','L2','L3','L4','L5']) assert.match(html,new RegExp(`<p>${clue}</p>`));
  assert.match(html,/class="now"><span class="cr-pts">8<\/span><p>L2/);
  assert.match(html,/Stora Grindö/);
  assert.match(html,/Visa ledtråd 3 · 6 p/);
  assert.match(html,/Drog nödbromsen/);
  assert.match(html,/Kalmar[\s\S]*✓ Rätt \+8/);
  assert.match(html,/cr-preview[\s\S]*Dressinen har dragit i nödbromsen/);
  assert.doesNotMatch(html,/Aktivera ljud/);
  assert.match(html,/Fråga 1\/2/);
  listeners.keydown({key:' ',target:{tagName:'INPUT'},preventDefault(){}});
  assert.equal(posts.length,0);
  listeners.keydown({key:' ',target:{tagName:'BODY'},preventDefault(){}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(posts.at(-1),['/api/game/next',{}]);
  listeners.keydown({key:'s',target:{tagName:'BODY'},preventDefault(){}});
  assert.deepEqual(posts.at(-1),['/api/tv',{mode:'scoreboard'}]);
  // Bara ändrad TV-status ritar inte om vyn.
  app.innerHTML = 'orörd';
  events.onmessage({data:JSON.stringify({...initial,tvStatus:{audioReady:true,video:true,playing:true,time:3,duration:10}})});
  assert.equal(app.innerHTML,'orörd');
  events.onmessage({data:JSON.stringify({...initial,game:{...game,phase:'revealed',filmIndex:0,filmStage:'questions',filmAnswers:{0:{dressin:['Grindö','1433']}}}})});
  assert.match(app.innerHTML,/Avslöja facit för Resefilm 1/);
  assert.match(app.innerHTML,/Grindö[\s\S]*2 rätt · \+3/);
  events.onmessage({data:JSON.stringify({...initial,phase:'waiting',game:{phase:'waiting',lastQuestionId:'q1',answers:{}},activeQuestion:null})});
  assert.match(app.innerHTML,/Starta musikfråga: Timbuktu/);
});
