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
  eventSource.onmessage({data:JSON.stringify({...initial,phase:'revealed',followupNumber:1,question:'En följdfråga'})});
  assert.match(app.innerHTML,/En följdfråga/);
  assert.doesNotMatch(app.innerHTML,/Göteborg|En ledtråd/);
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

test('lagets följdfråga har svarsfält och bara knappen Avsluta utanför frågan', async () => {
  const app = {innerHTML:''}, logout = {}, followupForm = {addEventListener(){}};
  const context = {
    document: {body:{},querySelector: selector => ({'#app':app,'#logout':logout,'#followupForm':followupForm}[selector] || null),addEventListener(){}},
    location:{pathname:'/view/dressin'},
    fetch: async url => ({ok:true,json:async()=>url === '/api/me' ? {role:'dressin'} : {role:'dressin',label:'Lag Dressin',theme:'dressin',phase:'revealed',type:'followup',followupIndex:0,round:1,score:7,question:'Vad heter älven?',locked:null,teams,activeTeams}}),
    EventSource: class {},
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'public/app.js'),'utf8'),Object.assign(context,browserTimers));
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(app.innerHTML,/Vad heter älven\?/);
  assert.match(app.innerHTML,/id="followupForm"/);
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
