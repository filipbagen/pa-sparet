(() => {
'use strict';
const bounds={sweden:{west:10,east:25,south:55,north:70},europe:{west:-12,east:35,south:35,north:72},world:{west:-180,east:180,south:-60,north:85}};
const active=new Map();
let landPromise;
const mercator=lat=>-Math.log(Math.tan(Math.PI/4+Math.max(-85,Math.min(85,lat))*Math.PI/360))*180/Math.PI;
const latitude=y=>(2*Math.atan(Math.exp(-y*Math.PI/180))-Math.PI/2)*180/Math.PI;
const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
function land() {
  landPromise ||= fetch('/assets/land.geojson').then(response=>{
    if(!response.ok) throw Error('Kartdatan kunde inte laddas.');
    return response.json();
  }).then(data=>data.features.flatMap(feature=>{
    const geometry=feature.geometry;
    return geometry.type==='Polygon'?[geometry.coordinates]:geometry.type==='MultiPolygon'?geometry.coordinates:[];
  }).map(rings=>rings.map(ring=>ring.map(([lon,lat])=>[lon,mercator(lat)]))));
  return landPromise;
}
function cleanup() {
  for(const [key,entry] of active) if(!entry.element.isConnected){entry.destroy();active.delete(key);}
}
async function draw(element,{scope='world',viewport=null,locked=false,pins={},correct=null,onPick=null,onViewport=null,key='map'}={}) {
  cleanup();
  const b=locked && viewport ? viewport : bounds[scope]||bounds.world;
  const previous=active.get(key);
  const camera=previous && !locked && previous.scope===scope ? previous.camera : null;
  previous?.destroy();
  const entry={element,scope,camera:null,destroy(){this.resizeObserver?.disconnect();this.canvas?.remove();this.controls?.remove();this.credit?.remove();}};
  active.set(key,entry);
  element.innerHTML='<div class="real-map-loading">Laddar karta…</div>';
  let polygons;
  try { polygons=await land(); }
  catch(error) { if(active.get(key)===entry)element.innerHTML='<div class="real-map-error">Kartan kunde inte laddas från spelservern. Ladda om sidan.</div>'; return; }
  if(active.get(key)!==entry || !element.isConnected)return;
  element.innerHTML='';
  const canvas=document.createElement('canvas');
  canvas.className='local-map';canvas.setAttribute('aria-label','Karta utan ortnamn och landgränser');
  element.append(canvas);entry.canvas=canvas;
  const ctx=canvas.getContext('2d');
  if(!ctx){element.innerHTML='<div class="real-map-error">Webbläsaren kan inte visa kartan.</div>';return;}
  const limits={west:b.west,east:b.east,top:mercator(b.north),bottom:mercator(b.south)};
  let width=0,height=0;
  const view=entry.camera=camera||{cx:0,cy:0,scale:1};
  const initial=locked?b:viewport||bounds.europe;
  let fitted=false;
  function fit(area) {
    const left=area.west,right=area.east,top=mercator(area.north),bottom=mercator(area.south);
    view.cx=(left+right)/2;view.cy=(top+bottom)/2;
    view.scale=Math.min(width/(right-left),height/(bottom-top));
  }
  function minimumScale(){return Math.min(width/(limits.east-limits.west),height/(limits.bottom-limits.top));}
  function constrain() {
    view.scale=clamp(view.scale,minimumScale(),12000);
    const halfX=width/(2*view.scale),halfY=height/(2*view.scale);
    view.cx=halfX*2>limits.east-limits.west?(limits.west+limits.east)/2:clamp(view.cx,limits.west+halfX,limits.east-halfX);
    view.cy=halfY*2>limits.bottom-limits.top?(limits.top+limits.bottom)/2:clamp(view.cy,limits.top+halfY,limits.bottom-halfY);
    if(!locked && pins.mine){
      const margin=Math.min(24,Math.min(width,height)/4)/view.scale;
      view.cx=clamp(view.cx,pins.mine.lon-halfX+margin,pins.mine.lon+halfX-margin);
      const pinY=mercator(pins.mine.lat);
      view.cy=clamp(view.cy,pinY-halfY+margin,pinY+halfY-margin);
    }
  }
  function coordinates(x,y){return {lon:view.cx+(x-width/2)/view.scale,lat:latitude(view.cy+(y-height/2)/view.scale)};}
  function report() {
    if(!onViewport)return;
    const top=latitude(view.cy-height/(2*view.scale)),bottom=latitude(view.cy+height/(2*view.scale));
    onViewport({west:+clamp(view.cx-width/(2*view.scale),b.west,b.east).toFixed(5),east:+clamp(view.cx+width/(2*view.scale),b.west,b.east).toFixed(5),south:+clamp(bottom,b.south,b.north).toFixed(5),north:+clamp(top,b.south,b.north).toFixed(5)});
  }
  function paint() {
    const dpr=Math.min(window.devicePixelRatio||1,2);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.fillStyle='#a8d2e2';ctx.fillRect(0,0,width,height);
    ctx.save();ctx.translate(width/2-view.cx*view.scale,height/2-view.cy*view.scale);ctx.scale(view.scale,view.scale);
    ctx.beginPath();ctx.rect(limits.west,limits.top,limits.east-limits.west,limits.bottom-limits.top);ctx.clip();
    ctx.fillStyle='#e1dfbf';ctx.strokeStyle='#6a8e80';ctx.lineWidth=1/view.scale;
    for(const polygon of polygons){
      ctx.beginPath();
      for(const ring of polygon){ring.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();}
      ctx.fill('evenodd');ctx.stroke();
    }
    ctx.restore();
    for(const [name,point] of [...Object.entries(pins),...(correct?[['correct',correct]]:[])]){
      if(!point || !Number.isFinite(point.lat)||!Number.isFinite(point.lon))continue;
      const x=width/2+(point.lon-view.cx)*view.scale,y=height/2+(mercator(point.lat)-view.cy)*view.scale;
      if(x<0||x>width||y<0||y>height)continue;
      const pinStyle={dressin:['#168b53','D'],forsta:['#8e44ad','F'],x2000:['#c0392b','X'],malartag:['#2980b9','M'],loket:['#d68910','L'],correct:['#e7bc24','✓'],mine:['#d83027','●']}[name]||['#d83027','●'];
      ctx.beginPath();ctx.arc(x,y,15,0,Math.PI*2);ctx.fillStyle=pinStyle[0];ctx.fill();ctx.strokeStyle='white';ctx.lineWidth=3;ctx.stroke();
      ctx.fillStyle='white';ctx.font='bold 16px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(pinStyle[1],x,y);
    }
  }
  function refresh(){constrain();paint();report();}
  function resize(){
    width=element.clientWidth;height=element.clientHeight;
    if(!width||!height)return;
    const dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
    if(!fitted){if(!camera)fit(initial);fitted=true;}
    refresh();
  }
  const pointers=new Map();let gesture=null;
  canvas.onpointerdown=event=>{
    canvas.setPointerCapture(event.pointerId);pointers.set(event.pointerId,{x:event.offsetX,y:event.offsetY,startX:event.offsetX,startY:event.offsetY});
    if(pointers.size===2){const [a,c]=[...pointers.values()];gesture={distance:Math.hypot(a.x-c.x,a.y-c.y),scale:view.scale};}
  };
  canvas.onpointermove=event=>{
    const pointer=pointers.get(event.pointerId);if(!pointer)return;
    const x=event.offsetX,y=event.offsetY,dx=x-pointer.x,dy=y-pointer.y;pointer.x=x;pointer.y=y;
    if(pointers.size===2&&gesture){const [a,c]=[...pointers.values()];view.scale=gesture.scale*Math.hypot(a.x-c.x,a.y-c.y)/Math.max(1,gesture.distance);refresh();}
    else {view.cx-=dx/view.scale;view.cy-=dy/view.scale;refresh();}
  };
  canvas.onpointerup=event=>{
    const pointer=pointers.get(event.pointerId);pointers.delete(event.pointerId);if(pointers.size<2)gesture=null;
    if(pointer&&Math.hypot(pointer.x-pointer.startX,pointer.y-pointer.startY)<7&&onPick){const point=coordinates(pointer.x,pointer.y);if(point.lat>=b.south&&point.lat<=b.north&&point.lon>=b.west&&point.lon<=b.east)onPick({lat:+point.lat.toFixed(5),lon:+point.lon.toFixed(5)});}
    report();
  };
  canvas.onpointercancel=event=>{pointers.delete(event.pointerId);gesture=null;};
  canvas.onwheel=event=>{event.preventDefault();const {lon,lat}=coordinates(event.offsetX,event.offsetY);view.scale*=Math.exp(-event.deltaY*.002);constrain();view.cx=lon-(event.offsetX-width/2)/view.scale;view.cy=mercator(lat)-(event.offsetY-height/2)/view.scale;refresh();};
  const controls=document.createElement('div');controls.className='local-map-controls';
  for(const [label,factor] of [['+',1.6],['−',1/1.6]]){const button=document.createElement('button');button.type='button';button.textContent=label;button.setAttribute('aria-label',factor>1?'Zooma in':'Zooma ut');button.onclick=()=>{view.scale*=factor;refresh();};controls.append(button);}
  element.append(controls);entry.controls=controls;
  const credit=document.createElement('div');credit.className='real-map-attribution';credit.innerHTML='Kartdata: <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener noreferrer">Natural Earth</a>';element.append(credit);entry.credit=credit;
  if(typeof ResizeObserver!=='undefined'){entry.resizeObserver=new ResizeObserver(resize);entry.resizeObserver.observe(element);}else window.addEventListener('resize',resize);
  resize();
}
window.GameMap={draw,bounds,cleanup};
})();
