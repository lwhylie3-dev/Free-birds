// Beastbound Wilds — game loop, controls, combat, companions, Crown forces.
window.BB=window.BB||{};
BB.boot=function(){
const BB=window.BB, PI=Math.PI, V3=THREE.Vector3;
const $=s=>document.querySelector(s);
const TOUCH=matchMedia('(pointer:coarse)').matches;
const QUALITY=(TOUCH||innerWidth<800)?'low':'high';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const angDiff=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));

// ---------- renderer ----------
const renderer=new THREE.WebGLRenderer({antialias:QUALITY==='high',powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,QUALITY==='high'?1.75:1.4));
renderer.setSize(innerWidth,innerHeight);
renderer.outputEncoding=THREE.sRGBEncoding; renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=1.08;
renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap;
$('#stage').appendChild(renderer.domElement);
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(62,innerWidth/innerHeight,.1,1600);
const world=BB.buildWorld(scene,QUALITY);
const H=BB.height;

// ---------- FX ----------
const fxList=[];
function fx(obj,dur,update,onEnd){scene.add(obj);fxList.push({obj,t:0,dur,update,onEnd});return obj}
const basic=(c,o=1)=>new THREE.MeshBasicMaterial({color:c,transparent:true,opacity:o,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide});
function ring(p,color,r0,r1,dur=.5,y=.15){const m=new THREE.Mesh(new THREE.RingGeometry(.8,1,48),basic(color,.9));m.rotation.x=-PI/2;m.position.set(p.x,p.y+y,p.z);
  return fx(m,dur,(f,k)=>{const r=r0+(r1-r0)*(1-Math.pow(1-k,2));m.scale.set(r,r,r);m.material.opacity=.9*(1-k)})}
const sparkGeo=new THREE.SphereGeometry(.08,5,4);
function burst(p,color,n=12,spd=6,size=1,up=2){for(let i=0;i<n;i++){const m=new THREE.Mesh(sparkGeo,basic(color,1));m.position.copy(p);m.scale.setScalar(size*(.6+Math.random()*.8));
  const v=new V3((Math.random()-.5)*spd,Math.random()*up+1,(Math.random()-.5)*spd);fx(m,.5+Math.random()*.4,(f,k,dt)=>{m.position.addScaledVector(v,dt);v.y-=9*dt;m.material.opacity=1-k})}}
function slashFx(e,color,len=2.6,flip=false){const g=new THREE.Mesh(new THREE.TorusGeometry(len*.7,.05,4,24,PI*.9),basic(color,.85));
  g.position.set(e.pos.x,e.pos.y+1.15*(e.h?.scale||1),e.pos.z);g.rotation.set(PI/2+(flip?.35:-.35),0,-e.yaw+PI*.55);
  fx(g,.22,(f,k)=>{g.material.opacity=.85*(1-k);g.scale.setScalar(1+k*.25)})}
function beam(a,b,color,dur=.25,w=.08){const d=b.clone().sub(a);const m=new THREE.Mesh(new THREE.CylinderGeometry(w,w,d.length(),6),basic(color,.9));
  m.position.copy(a).addScaledVector(d,.5);m.quaternion.setFromUnitVectors(new V3(0,1,0),d.clone().normalize());fx(m,dur,(f,k)=>{m.material.opacity=.9*(1-k)})}

// ---------- toast / HUD ----------
let toastT=0;
function toast(msg,secs=2.6){const t=$('#toast');t.textContent=msg;t.hidden=false;t.classList.remove('show');void t.offsetWidth;t.classList.add('show');toastT=secs}

// ---------- heroes ----------
const heroes=[];
function placeGear(h,def){
  const B=h.B; h.items={R:[],L:[]}; h.extra={};
  let backN=0;
  def.gear.forEach(([item,slot,opt])=>{
    const w=BB.W[item](opt||{});
    if(slot==='R'||slot==='L'){
      if(h.rig){
        if(item==='shield'||item==='segShield'){B['arm'+slot].add(w)}
        else if(item==='pistol'){B['gun'+slot].add(w);w.rotation.x=-PI/2}
        else B['grip'+slot].add(w);
      }
      else if(item==='shield'||item==='segShield'){B['el'+slot].add(w);w.position.set(slot==='L'?-.09:.09,-.16,0);w.rotation.set(0,slot==='L'?-PI/2:PI/2,0)}
      else{B['grip'+slot].add(w); if(item==='fan')w.rotation.set(0,0,0)}
      h.items[slot].push(w);
    }else if(slot.startsWith('back')){const sg=backN++%2?-1:1;B.back.add(w);
      if(item==='bow'){w.position.set(0,.05,.02);w.rotation.set(0,PI/2,.5)}
      else{w.position.set(.13*sg,h.rig?.22:.3,h.rig?.02:0);w.rotation.set(0,0,PI-.55*sg)}}
    else{B[slot].add(w);w.position.set(0,0,0);w.rotation.set(.15,0,PI-(slot==='hipL'?-.2:.2))}
    w.traverse(m=>{if(m.isMesh)m.castShadow=true});
  });
  if(def.id==='zay'){h.extra.swords=['R','L'].map(s=>{const w=BB.W.shortsword();w.visible=false;B['grip'+s].add(w);return w})}
  if(def.id==='daniel'){h.extra.long=['R','L'].map(s=>{const w=BB.W.mantisBlade({ext:true});w.visible=false;B['grip'+s].add(w);return w})}
  if(def.id==='danny'){const l=new THREE.PointLight(0xff6a1a,0,5,2);B.handR.add(l);h.extra.heat=l}
}
function makeHero(def,i){
  const h=BB.RIGS?BB.buildRiggedHero(def):BB.buildHuman(def.look); if(!h.rig)BB.buildMantle(h,def.mantle); placeGear(h,def);
  scene.add(h.root);
  const beast=(BB.RIGS&&BB.buildRiggedBeast(def.beast))||BB.BEASTS[def.beast](); scene.add(beast.root);
  const a=i/BB.ROSTER.length*PI*2+.2, r=12.5;
  const pos=new V3(BB.CAMP.x+Math.cos(a)*r,0,BB.CAMP.z+Math.sin(a)*r); pos.y=H(pos.x,pos.z);
  const e={def,h,beast,pos,home:pos.clone(),yaw:Math.atan2(BB.CAMP.x-pos.x,BB.CAMP.z-pos.z),vel:new V3(),grounded:true,
    st:{speed:0,attackT:-1,combo:0,grounded:true},bst:{speed:0},bpos:pos.clone().add(new V3(Math.cos(a)*(def.beast==='dragon'?8:3.4),0,Math.sin(a)*(def.beast==='dragon'?8:3.4))),byaw:0,
    hp:100,maxhp:100,breath:100,cds:{},buffs:{},mantleOn:false,marks:[],echo:0,radius:.45,team:'hero',idx:i,beastBusy:0,beastCd:0,lionRest:0};
  e.byaw=e.yaw;
  if(beast.kind==='bird'||beast.kind==='gbird'){e.bpos.y=pos.y+8}
  if(beast.kind==='snake'){beast.root.userData.headPos=e.bpos;for(let k=0;k<260;k++)beast.trail.push(new V3(e.bpos.x+Math.sin(k*.08)*1.6,0,e.bpos.z-k*.12));}
  if(def.extra==='harpy'){e.harpy=(BB.RIGS&&BB.buildRiggedBeast('harpy'))||BB.BEASTS.harpy();scene.add(e.harpy.root);e.hpos=pos.clone().add(new V3(0,12,0));e.hst={};e.hdive=null}
  heroes.push(e); return e;
}
BB.ROSTER.forEach((d,i)=>makeHero(d,i));
let active=heroes[0], party=false;

// ---------- Crown forces ----------
const enemies=[];
function makeEnemy(type,op,k){
  let model,isQuad=false;
  if(type==='warden'&&BB.RIGS){model=BB.buildRiggedWarden();model.B.gripR.add(BB.W.baton());}
  else if(type==='warden'){model=BB.buildHuman({skin:0x9a7a62,hair:'helm',hairC:0xd2d6da,top:0xbfc4c9,pants:0x5a5e64,boots:0x2a2c30,belt:0x8a8f96,sleeves:'long'});model.B.gripR.add(BB.W.baton());}
  else{model=BB.BEASTS.sentinel();isQuad=true}
  const root=isQuad?model.root:model.root; scene.add(root);
  const a=k*2.1+op.o.x, r=6+(k%3)*4;
  const pos=new V3(op.o.x+Math.cos(a)*r,0,op.o.z+Math.sin(a)*r); pos.y=H(pos.x,pos.z);
  const bar=new THREE.Group(); const bg=new THREE.Sprite(new THREE.SpriteMaterial({color:0x1b1b1b,depthTest:false,transparent:true,opacity:.7}));bg.scale.set(1.2,.12,1);
  const fg=new THREE.Sprite(new THREE.SpriteMaterial({color:0xe2574a,depthTest:false}));fg.center.set(0,.5);fg.position.x=-.6;fg.scale.set(1.2,.1,1);bar.add(bg,fg);bar.visible=false;bar.renderOrder=10;scene.add(bar);
  const maxhp=type==='warden'?80:140;
  const e={type,model,isQuad,root,pos,home:pos.clone(),yaw:Math.random()*6,vel:new V3(),knock:new V3(),hp:maxhp,maxhp,op,st:{speed:0,attackT:-1,combo:0,grounded:true},
    state:'idle',atk:0,wind:0,stun:0,rootT:0,burn:0,dead:0,bar,fg,radius:type==='warden'?.5:1,reveal:0,wander:new V3().copy(pos),wanderT:0,mark:null,coil:null,team:'crown'};
  enemies.push(e); return e;
}
world.pylons.forEach(p=>{for(let k=0;k<4;k++)makeEnemy('warden',p,k);for(let k=0;k<2;k++)makeEnemy('sentinel',p,k+4)});
let pylonsBroken=0;

// ---------- input ----------
const keys={}; let camYaw=active.yaw+PI, camPitch=.28, camDist=7, started=false;
const move={x:0,y:0};
addEventListener('keydown',e=>{if(!started)return;const k=e.code;keys[k]=true;
  if(k==='KeyQ')useAbility(0);if(k==='KeyE')useAbility(1);if(k==='KeyR')useAbility(2);
  if(k==='KeyF')commandBeast();if(k==='KeyT'||k==='KeyM')toggleMantle();if(k==='Space'){jump();e.preventDefault()}
  if(k==='KeyJ')attack();if(k==='Tab'){openPanel('roster');e.preventDefault()}if(k==='KeyC')openPanel('codex');if(k==='KeyP')toggleParty();
  if(/^Digit[1-9]$/.test(k))switchTo(+k.slice(5)-1);if(k==='Digit0')switchTo(9);if(k==='Minus')switchTo(10);if(k==='Equal')switchTo(11);});
addEventListener('keyup',e=>keys[e.code]=false);
const cv=renderer.domElement;
let dragging=null, locked=false;
cv.addEventListener('contextmenu',e=>e.preventDefault());
if(!TOUCH){
  cv.addEventListener('mousedown',e=>{if(!started)return;
    if(!locked&&cv.requestPointerLock){try{const r=cv.requestPointerLock();if(r&&r.catch)r.catch(()=>{})}catch(_){}}
    if(e.button===0){dragging={x:e.clientX,y:e.clientY,moved:0}}
    if(e.button===2)commandBeast();});
  addEventListener('mouseup',e=>{if(e.button===0&&dragging){if(locked||dragging.moved<6)attack();dragging=null}});
  document.addEventListener('pointerlockchange',()=>{locked=document.pointerLockElement===cv});
  addEventListener('mousemove',e=>{if(locked){camYaw-=e.movementX*.0032;camPitch=clamp(camPitch+e.movementY*.0028,-.35,1.2)}
    else if(dragging){const dx=e.clientX-dragging.x,dy=e.clientY-dragging.y;dragging.moved+=Math.abs(dx)+Math.abs(dy);camYaw-=dx*.005;camPitch=clamp(camPitch+dy*.004,-.35,1.2);dragging.x=e.clientX;dragging.y=e.clientY}});
  cv.addEventListener('wheel',e=>{camDist=clamp(camDist+e.deltaY*.01,3,22)},{passive:true});
}
// touch: left = joystick, right = look
const joy=$('#joy'),knob=$('#knob'); let joyId=null,lookId=null,joyO={x:0,y:0},lookP={x:0,y:0};
cv.addEventListener('touchstart',e=>{if(!started)return;for(const t of e.changedTouches){
  if(t.clientX<innerWidth*.45&&joyId===null){joyId=t.identifier;joyO={x:t.clientX,y:t.clientY};joy.style.left=(t.clientX-60)+'px';joy.style.top=(t.clientY-60)+'px';joy.hidden=false;knob.style.transform='translate(0,0)'}
  else if(lookId===null){lookId=t.identifier;lookP={x:t.clientX,y:t.clientY}}}e.preventDefault()},{passive:false});
cv.addEventListener('touchmove',e=>{for(const t of e.changedTouches){
  if(t.identifier===joyId){let dx=t.clientX-joyO.x,dy=t.clientY-joyO.y;const l=Math.hypot(dx,dy),m=50;if(l>m){dx*=m/l;dy*=m/l}move.x=dx/m;move.y=dy/m;knob.style.transform=`translate(${dx}px,${dy}px)`}
  if(t.identifier===lookId){camYaw-=(t.clientX-lookP.x)*.008;camPitch=clamp(camPitch+(t.clientY-lookP.y)*.006,-.35,1.2);lookP={x:t.clientX,y:t.clientY}}}e.preventDefault()},{passive:false});
const tend=e=>{for(const t of e.changedTouches){if(t.identifier===joyId){joyId=null;move.x=move.y=0;joy.hidden=true}if(t.identifier===lookId)lookId=null}};
cv.addEventListener('touchend',tend);cv.addEventListener('touchcancel',tend);
document.querySelectorAll('[data-act]').forEach(b=>{const fn=()=>{const a=b.dataset.act;if(a==='atk')attack();else if(a==='jump')jump();else if(a==='beast')commandBeast();else if(a==='mantle')toggleMantle();else if(a==='sprint'){sprintLatch=!sprintLatch;b.classList.toggle('on',sprintLatch)}else useAbility(+a)};
  b.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();if(started)fn()})});
let sprintLatch=false;

// ---------- queries ----------
const tmp=new V3(),tmp2=new V3();
const alive=e=>e.dead<=0;
function fwd(yaw,out=new V3()){return out.set(Math.sin(yaw),0,Math.cos(yaw))}
function enemiesIn(p,r){return enemies.filter(e=>alive(e)&&e.pos.distanceTo(p)<r+e.radius)}
function enemiesCone(p,yaw,range,arc){return enemies.filter(e=>{if(!alive(e))return false;const dx=e.pos.x-p.x,dz=e.pos.z-p.z;const d=Math.hypot(dx,dz);if(d>range+e.radius)return false;return d<1.2||Math.abs(angDiff(Math.atan2(dx,dz),yaw))<arc/2})}
function nearestEnemy(p,maxD,yaw=null,arc=PI*2){let best=null,bd=maxD;for(const e of enemies){if(!alive(e))continue;const dx=e.pos.x-p.x,dz=e.pos.z-p.z,d=Math.hypot(dx,dz);if(d>bd)continue;if(yaw!==null&&Math.abs(angDiff(Math.atan2(dx,dz),yaw))>arc/2)continue;best=e;bd=d}return best}
function pylonsNear(p,r){return world.pylons.filter(y=>!y.broken&&Math.hypot(y.pos.x-p.x,y.pos.z-p.z)<r+3.5)}

// ---------- damage ----------
function hit(en,dmg,src,knock=0,opt={}){
  if(!alive(en))return;
  if(src&&src.buffs){if(src.mantleOn)dmg*=src.def.id==='trae'?2:1.35;if(src.buffs.veil>0){dmg*=3;src.buffs.veil=0;src.h.root.visible=true;toast('Umbral Veil breaks')}
    if(src.buffs.heat>0)en.burn=4;if(src.buffs.unfold>0)dmg*=1.4}
  en.hp-=dmg; en.state='chase'; en.bar.visible=true; en.fg.scale.x=1.2*Math.max(0,en.hp/en.maxhp);
  if(knock&&src){const d=tmp.set(en.pos.x-src.pos.x,0,en.pos.z-src.pos.z);if(d.lengthSq()<.01)fwd(src.yaw,d);d.normalize();en.knock.addScaledVector(d,knock*(en.type==='sentinel'?.6:1));en.knock.y+=knock*.35}
  if(opt.stun)en.stun=Math.max(en.stun,opt.stun); if(opt.root)en.rootT=Math.max(en.rootT,opt.root);
  burst(tmp2.copy(en.pos).setY(en.pos.y+1.1),opt.color||0xfff1c8,8,5,.8);
  if(en.hp<=0)kill(en);
}
function hitPylon(y,dmg){y.hp-=dmg;burst(tmp2.set(y.pos.x,y.pos.y+3,y.pos.z),0xbfe0ff,10,7);
  if(y.hp<=0&&!y.broken){y.broken=true;pylonsBroken++;y.light.intensity=0;y.core.material=BB.M(0x555555);y.rings.forEach((r,i)=>{r.position.y=.3+i*.08;r.rotation.set(PI/2,0,0)});
    ring(y.pos,0xffe7a8,2,40,1.4,1);burst(tmp2.set(y.pos.x,y.pos.y+17,y.pos.z),0xffffff,40,14,1.5,6);
    enemies.filter(e=>e.op===y&&alive(e)).forEach(e=>kill(e,true));
    toast(`${y.o.name} falls. The collars unlock. ${pylonsBroken}/4`,3.5);updateObjective();
    if(pylonsBroken===4)setTimeout(()=>toast('Every pylon is down. Sethoran Westin will answer for the Crown.',5),3600);}}
function kill(en,standDown=false){en.dead=standDown?999999:40;en.hp=0;en.bar.visible=false;en.deathT=0;if(en.mark){en.mark.removeFromParent();en.mark=null}if(en.coil){scene.remove(en.coil);en.coil=null}
  heroes.forEach(h=>h.marks=h.marks.filter(m=>m!==en));burst(tmp2.copy(en.pos).setY(en.pos.y+1),0x9fb7ff,16,6,1)}
function hurtHero(h,dmg,src){
  if(h.buffs.wingshield>0){ring(h.pos,0xffb43a,1,3,.3,1);return}
  if(h.buffs.guard>0&&src){hit(src,10,h,12);ring(h.pos,0xfff0c0,1,3.5,.3,1);dmg*=.3}
  if(h.buffs.bulwark>0)dmg*=.2; if(h.mantleOn)dmg*=.65;
  h.hp-=dmg; h.hurtT=.25;
  if(h===active){$('#hurt').style.opacity=.5}
  if(h.hp<=0){h.hp=0;h.downT=3;h.h.root.visible=false;burst(tmp2.copy(h.pos).setY(h.pos.y+1),0xff6a5a,20,6);if(h===active)toast(`${h.def.name} is down. Back to camp.`)}
}

// ---------- actions ----------
const ATK_DUR={slash:.42,smash:.7,thrust:.45,shoot:.26,spin:.6,clap:.55};
const ATK_HIT={slash:.32,smash:.55,thrust:.33,shoot:.12,spin:.45,clap:.45};
function faceAim(e,range=5){if(e!==active)return;let yaw=camYaw+PI;const t=nearestEnemy(e.pos,range,yaw,1.6);if(t)yaw=Math.atan2(t.pos.x-e.pos.x,t.pos.z-e.pos.z);e.yaw=yaw;return t}
function curAttack(e){const a=e.def.attack;if(e.def.id==='zay'&&e.buffs.blades>0)return{kind:'slash',range:2.5,arc:1.7,dmg:22,dual:true};if(e.def.id==='daniel'&&e.buffs.unfold>0)return Object.assign({},a,{range:a.range+1.4});return a}
function attack(e=active){
  if(e.downT>0)return;const s=e.st;const a=curAttack(e);
  if(s.attackT>=0&&s.attackT<.62)return;
  s.attackT=0;s.combo++;s.attackKind=a.kind;s.hitDone=false;s.dual=!!a.dual;s.aimBoth=!!a.dual;s.atkDur=ATK_DUR[a.kind]||.45;
  faceAim(e,a.ranged?40:5);
}
function resolveAttack(e){
  const a=curAttack(e),s=e.st;
  if(a.ranged){const hand=s.combo%2?'L':'R';const p=new V3();e.h.B['hand'+hand].getWorldPosition(p);
    const t=nearestEnemy(e.pos,45,e.yaw,.5);const dir=t?tmp.copy(t.pos).setY(t.pos.y+1).sub(p).normalize():fwd(e.yaw,tmp).setY(0);
    shoot(e,p,dir,a.speed,a.dmg,hand==='R'?0x9fd8ff:0xffe08a);return}
  const col=e.def.mantle.glow;
  slashFx(e,e.buffs.heat>0?0xff7a2a:col,a.range*.75,s.combo%2);
  enemiesCone(e.pos,e.yaw,a.range,a.arc).forEach(en=>hit(en,a.dmg,e,a.kind==='smash'?7:3.5));
  pylonsNear(e.pos,a.range).forEach(y=>hitPylon(y,a.dmg));
}
const projs=[];
const projGeo=new THREE.CapsuleGeometry(.05,.5,2,6);
function shoot(e,p,dir,speed,dmg,color,opt={}){
  const m=opt.mesh||new THREE.Mesh(projGeo,basic(color,1));m.position.copy(p);m.quaternion.setFromUnitVectors(new V3(0,1,0),dir);scene.add(m);
  projs.push({m,vel:dir.clone().multiplyScalar(speed),dmg,life:opt.life||1.6,src:e,pierce:!!opt.pierce,hitSet:new Set(),spin:opt.spin||0,boomerang:opt.boomerang,t:0,color,radius:opt.radius||.6,knock:opt.knock||2});
}
function jump(e=active){if(e.downT>0)return;if(e.grounded){e.vel.y=7.5;e.grounded=false}}
function toggleParty(){party=!party;$('#partyBtn').classList.toggle('on',party);toast(party?'The whole team follows you':'The team holds at camp');if(!party)heroes.forEach(h=>{if(h!==active)h.returning=true})}
function toggleMantle(e=active){
  if(e.def.id==='trae'&&e.lionRest>0){toast(`The lion is resting. ${Math.ceil(e.lionRest)}s`);return}
  if(!e.mantleOn&&e.breath<25){toast('Not enough Breath for a Mantle');return}
  e.mantleOn=!e.mantleOn;
  e.h.mantle.forEach(m=>{m.visible=e.mantleOn;m.scale.set(.01,.01,.01)});e.mantleGrow=0;
  if(e.mantleOn){ring(e.pos,e.def.mantle.glow,.5,5,.6,.2);burst(tmp2.copy(e.pos).setY(e.pos.y+1.2),e.def.mantle.glow,26,5,1,3);toast(`${e.def.mantle.name} manifests`);
    if(e.def.id==='trae'){e.lastlight=10;toast('Lastlight Accord: ten seconds of everything')}}
  refreshHUD();
}
function commandBeast(e=active){
  if(e.def.id==='trae'&&e.lionRest>0){toast('The lion is resting');return}
  if(e.beastCd>0)return;const t=nearestEnemy(e.pos,30,camYaw+PI,1.8)||nearestEnemy(e.pos,30);
  if(!t){toast(`${e.def.beastName.split(',')[0]} has no target`);return}
  e.beastTarget=t;e.beastBusy=4;e.beastCd=3;toast(`${e.def.beastName.split(',')[0]} goes for it`,1.4);
}

// ---------- abilities ----------
function useAbility(i,e=active){
  if(e.downT>0)return;const ab=e.def.abilities[i];if(!ab)return;
  if((e.cds[ab.id]||0)>0)return;
  if(e.breath<ab.cost){toast('Not enough Breath');return}
  const ok=ABIL[ab.id]?.(e,ab);
  if(ok===false)return;
  e.breath-=ab.cost;e.cds[ab.id]=ab.cd;refreshHUD();
}
function dash(e,dist,dur,onTick){e.dash={dir:fwd(e.yaw),spd:dist/dur,t:dur,hit:new Set(),onTick}}
const ABIL={
  // Trae
  prideglass(e){const crowd=enemiesIn(e.pos,15).length;const d=crowd>6?3.5:6;world.slowT=d;enemies.forEach(en=>{if(en.pos.distanceTo(e.pos)<70)en.reveal=d});
    ring(e.pos,0xbfeaff,1,30,1);$('#tint').className='tint pride';$('#tint').style.opacity=1;tintT=d;toast(crowd>6?'Prideglass: sensory fog, crowd too thick':'Prideglass: you can read them');},
  ninefold(e){const segs=[];const c=new V3(e.pos.x,e.pos.y+1.4,e.pos.z);
    for(let i=0;i<9;i++){const m=new THREE.Mesh(new THREE.ConeGeometry(.16,.5,4),BB.M(0xd9b45a,{metalness:.9,roughness:.2,emissive:0xffc24a,emissiveIntensity:1.4}));segs.push(m);
      const a0=i/9*PI*2;fx(m,1.1,(f,k)=>{const r=k<.45?1.3:1.3+(k-.45)/.55*11;const a=a0+k*6;m.position.set(c.x+Math.cos(a)*r,c.y+(k<.45?Math.sin(k*20+i)*.1:0),c.z+Math.sin(a)*r);m.rotation.set(PI/2,0,-a);m.scale.setScalar(1-Math.max(0,k-.8)*4)})}
    e.st.cast=.5;setTimeout(()=>{ring(e.pos,0xffd27a,1,12,.6,.3);enemiesIn(e.pos,12).forEach(en=>hit(en,32,e,11,{color:0xffd27a}));pylonsNear(e.pos,10).forEach(y=>hitPylon(y,30))},480)},
  razordive(e){if(!e.harpy)return false;const t=nearestEnemy(e.pos,35,camYaw+PI,1.6)||nearestEnemy(e.pos,35);const target=t?t.pos.clone():e.pos.clone().addScaledVector(fwd(camYaw+PI),14);target.y=H(target.x,target.z);
    e.hdive={t:0,from:e.hpos.clone(),target,hitDone:false};toast('Razor Dive')},
  // Josh
  mark(e){faceAim(e,14);const t=nearestEnemy(e.pos,14,e.yaw,1.4);if(!t||e.marks.includes(t)){toast('No new target to mark');return false}
    if(e.marks.length>=4){const o=e.marks.shift();if(o.mark){o.mark.removeFromParent();o.mark=null}}
    e.marks.push(t);const m=new THREE.Mesh(new THREE.TorusGeometry(.45,.05,6,20),basic(0x9fd8ff,1));m.rotation.x=PI/2;m.position.y=t.isQuad?2.3:2.2;t.root.add(m);t.mark=m;
    beam(new V3(e.pos.x,e.pos.y+1.3,e.pos.z),new V3(t.pos.x,t.pos.y+1.3,t.pos.z),0x9fd8ff,.2);e.st.attackT=0;e.st.attackKind='thrust';e.st.atkDur=.35;e.st.hitDone=true;toast(`Crossbeat mark ${e.marks.length}/4`,1)},
  clap(e){const ms=e.marks.filter(alive);if(!ms.length){toast('Plant a Crossbeat mark first');return false}
    e.st.attackT=0;e.st.attackKind='clap';e.st.atkDur=.55;e.st.hitDone=true;
    setTimeout(()=>{ring(e.pos,0x9fd8ff,.5,9,.5,1.3);
      for(let i=0;i<ms.length;i+=2){const a=ms[i],b=ms[i+1];
        if(b){const d=b.pos.clone().sub(a.pos);const L=d.length();d.normalize();a.knock.addScaledVector(d,L*1.6).setY(4);b.knock.addScaledVector(d,-L*1.6).setY(4);
          beam(a.pos.clone().setY(a.pos.y+1.3),b.pos.clone().setY(b.pos.y+1.3),0x9fd8ff,.35,.12);a.relay=b;b.relay=a;a.relayT=b.relayT=1.2}
        else{const d=a.pos.clone().sub(e.pos).setY(0).normalize();a.knock.addScaledVector(d,16).setY(8);hit(a,20,null)}}
      ms.forEach(m=>{if(m.mark){m.mark.removeFromParent();m.mark=null}});e.marks=[];},260)},
  sweep(e){e.st.attackT=0;e.st.attackKind='spin';e.st.atkDur=.6;e.st.hitDone=true;setTimeout(()=>{ring(e.pos,0x9fd8ff,1,4.5,.4,1);enemiesIn(e.pos,4.5).forEach(en=>hit(en,28,e,9))},300)},
  // Danny
  heat(e){e.buffs.heat=6;ring(e.pos,0xff7a2a,.5,3,.5,1);toast('Heat Wraps')},
  lunge(e){faceAim(e,12);e.st.attackT=0;e.st.attackKind='slash';e.st.atkDur=.42;e.st.hitDone=true;dash(e,9,.28,(en)=>hit(en,30,e,6));e.bpos.lerp(e.pos,.5);e.bst.pounce=1},
  flat(e){faceAim(e,5);e.st.attackT=0;e.st.attackKind='smash';e.st.atkDur=.7;e.st.hitDone=true;setTimeout(()=>{enemiesCone(e.pos,e.yaw,3.8,1.6).forEach(en=>hit(en,10,e,20));slashFx(e,0xffd2a0,3)},380)},
  // Mike
  wingshield(e){e.buffs.wingshield=4;e.beastShield=4;ring(e.pos,0xffb43a,1,5,.6,1);toast('Wing Shield')},
  spearline(e){faceAim(e,12);e.st.attackT=0;e.st.attackKind='thrust';e.st.atkDur=.45;e.st.hitDone=true;dash(e,8,.3,(en)=>hit(en,32,e,8))},
  gale(e){faceAim(e,16);e.beastGale=1.2;setTimeout(()=>{const f=fwd(e.yaw);for(let i=0;i<14;i++){const p=e.pos.clone().add(new V3((Math.random()-.5)*4,1+Math.random()*2,(Math.random()-.5)*4));
      const m=new THREE.Mesh(new THREE.BoxGeometry(.06,.06,1.6),basic(0xdfe8ee,.7));m.position.copy(p);m.lookAt(p.clone().add(f));const v=f.clone().multiplyScalar(26);fx(m,.7,(fo,k,dt)=>{m.position.addScaledVector(v,dt);m.material.opacity=.7*(1-k)})}
    enemiesCone(e.pos,e.yaw,17,1.3).forEach(en=>hit(en,12,e,20))},350)},
  // Ethan
  veil(e){e.buffs.veil=6;e.h.root.visible=false;burst(tmp2.copy(e.pos).setY(e.pos.y+1),0x9b7bff,24,4);enemies.forEach(en=>{if(en.target===e){en.state='idle';en.target=null}});toast('Umbral Veil')},
  shadowstep(e){const t=nearestEnemy(e.pos,25);if(!t){toast('No one to step behind');return false}burst(tmp2.copy(e.pos).setY(e.pos.y+1),0x9b7bff,16,4);
    const back=fwd(t.yaw).multiplyScalar(-1.7);e.pos.set(t.pos.x+back.x,0,t.pos.z+back.z);e.pos.y=H(e.pos.x,e.pos.z);e.yaw=t.yaw;camYaw=e.yaw+PI;burst(tmp2.copy(e.pos).setY(e.pos.y+1),0x9b7bff,16,4);
    e.bpos.copy(e.pos).add(back.clone().multiplyScalar(-1).setY(0))},
  flurry(e){faceAim(e,5);let n=0;const iv=setInterval(()=>{e.st.attackT=0;e.st.attackKind='slash';e.st.combo++;e.st.dual=true;e.st.atkDur=.18;e.st.hitDone=true;
    slashFx(e,0x9b7bff,2.2,n%2);enemiesCone(e.pos,e.yaw,2.6,1.8).forEach(en=>hit(en,11,e,1.5,{color:0x9b7bff}));if(++n>=6)clearInterval(iv)},140)},
  // Cason
  coil(e){const t=nearestEnemy(e.pos,26);if(!t){toast('Nothing to bind');return false}e.beastTarget=t;e.beastBusy=1.5;
    setTimeout(()=>{if(!alive(t))return;t.rootT=4;const g=new THREE.Group();for(let i=0;i<4;i++){const r=new THREE.Mesh(new THREE.TorusGeometry(t.isQuad?1.1:.6,.2,8,20),BB.M(0x3d4a2a,{roughness:.5}));r.rotation.x=PI/2;r.position.y=.4+i*.38;g.add(r)}
      g.position.copy(t.pos);scene.add(g);t.coil=g;setTimeout(()=>{scene.remove(g);if(t.coil===g)t.coil=null},4000);hit(t,12,null,0,{root:4})},600);toast('Coil Bind')},
  shuriken(e){faceAim(e,30);const p=new V3(e.pos.x,e.pos.y+1.3,e.pos.z);e.st.attackT=0;e.st.attackKind='thrust';e.st.atkDur=.3;e.st.hitDone=true;
    [-.18,0,.18].forEach(o=>{const m=new THREE.Group();[0,PI/4].forEach(r=>{const b=new THREE.Mesh(new THREE.BoxGeometry(.5,.03,.08),BB.M(0x1a1a20,{metalness:.8,emissive:0x5a3aa0,emissiveIntensity:.8}));b.rotation.y=r;m.add(b)});
      shoot(e,p,fwd(e.yaw+o),34,16,0,{mesh:m,spin:20,life:1})})},
  chakram(e){faceAim(e,30);const m=new THREE.Mesh(new THREE.TorusGeometry(.35,.05,6,20),BB.M(0xd8b13a,{metalness:.9,roughness:.2,emissive:0x8a6a10,emissiveIntensity:1}));
    shoot(e,new V3(e.pos.x,e.pos.y+1.3,e.pos.z),fwd(e.yaw),26,18,0,{mesh:m,spin:25,life:2.2,pierce:true,boomerang:true,radius:1})},
  // Thomas
  bulwark(e){e.buffs.bulwark=5;ring(e.pos,0xffa040,1,3,.5,1);toast('Bulwark')},
  slam(e){e.st.attackT=0;e.st.attackKind='smash';e.st.atkDur=.7;e.st.hitDone=true;setTimeout(()=>{ring(e.pos,0xffa040,1,7,.6,.2);burst(tmp2.copy(e.pos).addScaledVector(fwd(e.yaw),1.5),0x8a7a60,24,8,1.2,4);enemiesIn(e.pos,7).forEach(en=>hit(en,34,e,10));pylonsNear(e.pos,6).forEach(y=>hitPylon(y,34))},390)},
  roar(e){e.bst.roar=1.2;ring(e.bpos,0xffa040,1,11,.8,1.5);setTimeout(()=>ring(e.bpos,0xffa040,1,11,.8,1.5),200);enemiesIn(e.pos,11).forEach(en=>hit(en,6,null,0,{stun:2.5}));toast('Ironmaul roars')},
  // Mase
  charge(e){faceAim(e,14);dash(e,13,.55,(en)=>hit(en,22,e,16));e.bst.pounce=1},
  guard(e){e.buffs.guard=3;ring(e.pos,0xfff0c0,1,2.5,.5,1);toast('Horn Guard')},
  quake(e){faceAim(e,10);e.vel.y=10;const f=fwd(e.yaw);e.vel.x=f.x*7;e.vel.z=f.z*7;e.grounded=false;e.quake=true},
  // Zay
  track(e){e.bst.roar=1;enemies.forEach(en=>{if(alive(en)&&en.pos.distanceTo(e.pos)<120)en.reveal=10});e.buffs.haste=8;ring(e.pos,0xe8c24a,1,40,1.2,.5);toast('Pack Track: every Warden within 120m is marked')},
  direfang(e){let n=0;const iv=setInterval(()=>{e.st.attackT=0;e.st.attackKind='shoot';e.st.combo++;e.st.atkDur=.12;e.st.hitDone=true;e.st.aimBoth=true;faceAim(e,40);resolveAttack(e);if(++n>=6)clearInterval(iv)},100)},
  blades(e){e.buffs.blades=8;toast('Short swords drawn')},
  // Daniel
  unfold(e){e.buffs.unfold=8;toast('Blades unfold');burst(tmp2.copy(e.pos).setY(e.pos.y+1.2),0xc8ff7a,14,3)},
  strike(e){const t=nearestEnemy(e.pos,20);if(!t){toast('No target');return false}const d=t.pos.clone().sub(e.pos);const L=d.length();e.yaw=Math.atan2(d.x,d.z);
    e.st.attackT=0;e.st.attackKind='slash';e.st.dual=true;e.st.atkDur=.42;e.st.hitDone=true;dash(e,Math.max(0,L-1.4),.22,null);setTimeout(()=>{hit(t,40,e,5,{color:0xc8ff7a});slashFx(e,0xc8ff7a,2.4)},230);e.bst.strike=1},
  linecut(e){faceAim(e,30);const m=new THREE.Mesh(new THREE.PlaneGeometry(3.2,.12),basic(0xc8ff7a,.95));m.rotation.order='YXZ';
    shoot(e,new V3(e.pos.x,e.pos.y+1.1,e.pos.z),fwd(e.yaw),30,28,0,{mesh:m,life:.9,pierce:true,radius:1.6,knock:4});m.rotation.set(0,e.yaw,0);m.userData.flat=true},
  // Izzy
  record(e){if(e.echo>=3){toast('Three recordings held. Release them.');return false}e.echo++;ring(e.pos,0x9fd8ff,.3,2.5,.4,1.6);toast(`Blackwing Echo recorded ${e.echo}/3`,1.2);refreshEcho(e)},
  echo(e){if(!e.echo){toast('Nothing recorded yet');return false}const c=e.echo;e.echo=0;refreshEcho(e);faceAim(e,10);
    for(let i=0;i<c;i++)setTimeout(()=>{const p=e.pos.clone().addScaledVector(fwd(e.yaw),1.5);const m=new THREE.Mesh(new THREE.RingGeometry(.6,.8,32,1,0,PI),basic(0x9fd8ff,.8));m.position.copy(p).setY(p.y+1.2);m.rotation.set(0,e.yaw,0);
      const f=fwd(e.yaw);fx(m,.6,(fo,k,dt)=>{m.position.addScaledVector(f,22*dt);m.scale.setScalar(1+k*5);m.material.opacity=.8*(1-k)})},i*120);
    enemiesCone(e.pos,e.yaw,8+c*4,1.1).forEach(en=>hit(en,14*c,e,6*c,{stun:c>=3?1.5:0,color:0x9fd8ff}))},
  falsecue(e){const p=e.pos.clone().addScaledVector(fwd(camYaw+PI),16);p.y=H(p.x,p.z);world.decoy={p,t:6};
    const r=ring(p,0x9fd8ff,.5,4,.6,.2);let n=0;const iv=setInterval(()=>{ring(p,0x9fd8ff,.5,4,.6,.2);if(++n>8)clearInterval(iv)},650);
    enemies.forEach(en=>{if(alive(en)&&en.pos.distanceTo(p)<45){en.state='decoy'}});toast('False Cue thrown')},
  // Savannah
  bound(e){faceAim(e,12);const f=fwd(e.yaw);e.vel.set(f.x*15,11,f.z*15);e.grounded=false;e.bst.leap=1.5},
  volley(e){faceAim(e,40);e.st.attackT=0;e.st.attackKind='shoot';e.st.atkDur=.4;e.st.hitDone=true;e.st.aimBoth=true;const p=new V3(e.pos.x,e.pos.y+1.4,e.pos.z);
    for(let i=-2;i<=2;i++)shoot(e,p,fwd(e.yaw+i*.12),48,15,0xffe0a0)},
  rescue(e){e.hp=Math.min(e.maxhp,e.hp+40);e.buffs.haste=5;e.buffs.rush=5;burst(tmp2.copy(e.pos).setY(e.pos.y+1),0xbfffb0,20,4);toast('Rescue Run')},
};
function refreshEcho(e){if(!e.echoOrbs){e.echoOrbs=[0,1,2].map(()=>{const m=new THREE.Mesh(new THREE.SphereGeometry(.09,8,6),basic(0x9fd8ff,1));scene.add(m);return m})}e.echoOrbs.forEach((m,i)=>m.visible=i<e.echo)}

// ---------- movement ----------
function collide(p,r){const C=BB.TREE_CELL,cx=Math.floor(p.x/C),cz=Math.floor(p.z/C);
  for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++){const a=BB.treeGrid.get((cx+i)+','+(cz+j));if(!a)continue;
    for(let k=0;k<a.length;k+=3){const dx=p.x-a[k],dz=p.z-a[k+1],rr=r+a[k+2],d2=dx*dx+dz*dz;if(d2<rr*rr&&d2>1e-6){const d=Math.sqrt(d2),push=(rr-d)/d;p.x+=dx*push;p.z+=dz*push}}}}
function stepBody(e,wish,speed,dt){
  const accel=e.grounded?14:3;
  e.vel.x+= (wish.x*speed-e.vel.x)*Math.min(1,accel*dt);
  e.vel.z+= (wish.z*speed-e.vel.z)*Math.min(1,accel*dt);
  if(e.dash){const d=e.dash;e.vel.x=d.dir.x*d.spd;e.vel.z=d.dir.z*d.spd;d.t-=dt;
    if(d.onTick)enemiesIn(e.pos,1.8).forEach(en=>{if(!d.hit.has(en)){d.hit.add(en);d.onTick(en)}});
    if(d.t<=0){e.dash=null;e.vel.x*=.2;e.vel.z*=.2}}
  e.vel.y-=24*dt;
  e.pos.addScaledVector(e.vel,dt);
  collide(e.pos,e.radius);
  const r=Math.hypot(e.pos.x,e.pos.z),lim=BB.HALF*.82;if(r>lim){e.pos.x*=lim/r;e.pos.z*=lim/r}
  let g=H(e.pos.x,e.pos.z);const wy=BB.WATER_Y-1.15;if(g<wy)g=wy;
  if(e.pos.y<=g){if(!e.grounded&&e.quake){e.quake=false;ring(e.pos,0xfff0c0,1,8,.6,.2);burst(tmp2.copy(e.pos),0x8a7a60,26,9,1.2,4);enemiesIn(e.pos,7.5).forEach(en=>hit(en,36,e,12));pylonsNear(e.pos,7).forEach(y=>hitPylon(y,36))}
    e.pos.y=g;e.vel.y=0;e.grounded=true}else if(e.pos.y>g+.3)e.grounded=false;
}

// ---------- companions ----------
const bTmp=new V3();
function beastSize(e){const k=e.def.beast;return k==='dragon'?5:k==='lion'?2.6:k==='snake'?2:k==='bear'?2:1.6}
function updateBeast(e,dt,t){
  const R=e.beast,kind=R.kind,size=beastSize(e);
  if(e.beastCd>0)e.beastCd-=dt; if(e.beastBusy>0)e.beastBusy-=dt;
  const resting=e.lionRest>0;
  // decide target
  let tgt=null,attackMode=false;
  if(e.beastTarget&&alive(e.beastTarget)&&e.beastBusy>0&&!resting){tgt=e.beastTarget.pos;attackMode=true}
  else{e.beastTarget=null;
    // auto-assist when the owner is fighting
    if(!resting&&e.beastCd<=0){const n=nearestEnemy(e.pos,9);if(n&&n.state!=='idle'){e.beastTarget=n;e.beastBusy=3;e.beastCd=2.6}}}
  if(e.beastShield>0){e.beastShield-=dt;tgt=e.pos.clone().addScaledVector(fwd(e.yaw),-2.2);attackMode=false}
  if(!tgt){const side=fwd(e.yaw-PI/2).multiplyScalar(size*.9+.6),back=fwd(e.yaw).multiplyScalar(-size*.5);tgt=bTmp.copy(e.pos).add(side).add(back)}
  if(kind==='bird'||kind==='gbird'){
    const ty=(attackMode?H(tgt.x,tgt.z)+1.5:e.pos.y+7+Math.sin(t*.7+e.idx)*1.5);
    const orbit=attackMode?0:1;const ox=Math.cos(t*.6+e.idx)*6*orbit,oz=Math.sin(t*.6+e.idx)*6*orbit;
    const goal=new V3(tgt.x+ox,ty,tgt.z+oz);const d=goal.clone().sub(e.bpos);const dist=d.length();
    const spd=attackMode?30:Math.min(16,dist*1.5);if(dist>.1)e.bpos.addScaledVector(d.normalize(),Math.min(dist,spd*dt));
    const yaw=Math.atan2(d.x,d.z);e.byaw+=angDiff(yaw,e.byaw)*Math.min(1,dt*3);
    if(attackMode&&dist<1.8){hit(e.beastTarget,18,e,3,{color:0x9fd8ff});e.beastBusy=0;e.beastTarget=null}
    R.root.position.copy(e.bpos);R.root.rotation.y=e.byaw;animAny(R,{flap:attackMode?.4:1,bank:angDiff(yaw,e.byaw)*.6,dive:attackMode&&dist<8},dt,t);
    return;
  }
  const d=bTmp.copy(tgt).sub(e.bpos);d.y=0;const dist=d.length();
  const reach=attackMode?(size*.6+1):1.2;
  let speed=0;
  if(dist>60){e.bpos.copy(tgt);e.bpos.y=H(tgt.x,tgt.z)}
  else if(dist>reach){speed=attackMode?14:Math.min(13,Math.max(2,(dist-reach)*2.2));if(e.def.beast==='dragon')speed*=1.1;
    const yaw=Math.atan2(d.x,d.z);e.byaw+=angDiff(yaw,e.byaw)*Math.min(1,dt*(kind==='snake'?3:5));
    const step=Math.min(dist-reach*.9,speed*dt);e.bpos.x+=Math.sin(e.byaw)*step;e.bpos.z+=Math.cos(e.byaw)*step;}
  else if(attackMode){const en=e.beastTarget;e.byaw+=angDiff(Math.atan2(d.x,d.z),e.byaw)*.3;e.bst.pounce=1;e.bst.roar=1;e.bst.strike=1;
    hit(en,e.def.beast==='dragon'?40:28,{pos:e.bpos,buffs:null},8,{color:0xffe6c8});if(e.def.beast==='snake')en.rootT=Math.max(en.rootT,1.5);
    e.beastBusy=0;e.beastTarget=null}
  else{const yaw=e.yaw;e.byaw+=angDiff(yaw,e.byaw)*Math.min(1,dt*1.5)}
  if(kind!=='snake')collide(e.bpos,size*.35);
  e.bpos.y=Math.max(H(e.bpos.x,e.bpos.z),BB.WATER_Y-1.4);
  ['pounce','roar','strike','leap'].forEach(k=>{if(e.bst[k]>0)e.bst[k]=Math.max(0,e.bst[k]-dt*2.5)});
  e.bst.speed=speed;e.bst.yaw=e.byaw;e.bst.crouch=resting?1:0;
  if(e.def.beast==='dragon'){const gale=e.beastGale>0;if(gale)e.beastGale-=dt;e.bst.wingsOpen=THREE.MathUtils.damp(e.bst.wingsOpen||0,(e.beastShield>0||gale)?1:0,6,dt);e.bst.flap=gale?1:.15}
  if(kind==='snake'){R.root.position.set(e.bpos.x,e.bpos.y,e.bpos.z);R.root.userData.headPos=e.bpos;e.bst.rear=attackMode&&dist<6?.8:0}
  else{R.root.position.copy(e.bpos);R.root.rotation.y=e.byaw;
    // align body pitch with slope
    const ahead=H(e.bpos.x+Math.sin(e.byaw)*size*.5,e.bpos.z+Math.cos(e.byaw)*size*.5),behind=H(e.bpos.x-Math.sin(e.byaw)*size*.5,e.bpos.z-Math.cos(e.byaw)*size*.5);
    R.root.rotation.x=-Math.atan2(ahead-behind,size)*.8;}
  animAny(R,e.bst,dt,t);
}
function animAny(R,st,dt,t){if(R.mixer)BB.animRiggedBeast(R,st,dt);else BB.animBeast(R,st,dt,t)}
function updateHarpy(e,dt,t){
  const R=e.harpy;let goal,dive=false;
  if(e.hdive){const d=e.hdive;d.t+=dt;
    if(d.t<.6){goal=d.from.clone().lerp(d.target,.3).setY(d.target.y+28)}
    else{goal=d.target.clone().setY(d.target.y+1);dive=true}
    const v=goal.clone().sub(e.hpos);const L=v.length();const spd=dive?55:30;e.hpos.addScaledVector(v.normalize(),Math.min(L,spd*dt));
    if(dive&&L<1.5&&!d.hitDone){d.hitDone=true;ring(d.target,0xeeeeea,1,7,.6,.4);burst(d.target.clone().setY(d.target.y+1),0xffffff,30,12,1.2,5);
      enemiesIn(d.target,6).forEach(en=>hit(en,42,e,12,{color:0xffffff}));pylonsNear(d.target,5).forEach(y=>hitPylon(y,40));e.hdive=null}
    if(d.t>3)e.hdive=null}
  else{goal=new V3(e.pos.x+Math.cos(t*.45)*11,e.pos.y+14+Math.sin(t*.9)*2,e.pos.z+Math.sin(t*.45)*11);const v=goal.sub(e.hpos);const L=v.length();e.hpos.addScaledVector(v.normalize(),Math.min(L,18*dt))}
  const prev=R.root.position.clone();R.root.position.copy(e.hpos);const mv=e.hpos.clone().sub(prev);
  if(mv.lengthSq()>1e-5)R.root.rotation.y=Math.atan2(mv.x,mv.z);
  animAny(R,{flap:dive?0:.8,bank:-.35,dive},dt,t);
}

// ---------- enemies ----------
function updateEnemy(en,dt,t){
  if(en.dead>0){en.dead-=dt;en.deathT=(en.deathT||0)+dt;
    if(en.deathT<1.2){en.root.rotation.z=Math.min(PI/2,en.deathT*3)*(en.isQuad?.5:1);en.root.position.y=en.pos.y-(en.isQuad?en.deathT*.3:0)}
    else en.root.visible=false;
    if(en.dead<=0){if(en.op.broken){en.dead=999999;return}en.hp=en.maxhp;en.pos.copy(en.home);en.root.visible=true;en.root.rotation.z=0;en.state='idle';en.fg.scale.x=1.2}
    return}
  const slow=world.slowT>0?.5:1; dt*=slow;
  if(en.burn>0){en.burn-=dt;en.hp-=6*dt;en.fg.scale.x=1.2*Math.max(0,en.hp/en.maxhp);if(Math.random()<.3)burst(tmp2.copy(en.pos).setY(en.pos.y+1),0xff7a2a,1,1,.6);if(en.hp<=0){kill(en);return}}
  // target: nearest visible hero
  let target=null,td=en.state==='idle'?28:45;
  for(const h of heroes){if(h.downT>0||h.buffs.veil>0)continue;const d=h.pos.distanceTo(en.pos);if(d<td){td=d;target=h}}
  if(world.decoy&&en.state==='decoy'){target=null}
  const wish=new V3();let speed=0;
  if(en.stun>0){en.stun-=dt;en.st.attackT=-1}
  else if(en.state==='decoy'&&world.decoy){const d=world.decoy.p.clone().sub(en.pos).setY(0);if(d.length()>1.5){wish.copy(d.normalize());speed=5}}
  else if(target){en.state='chase';en.target=target;const d=target.pos.clone().sub(en.pos).setY(0);const L=d.length();const reach=en.type==='warden'?1.9:2.6;
    en.yaw+=angDiff(Math.atan2(d.x,d.z),en.yaw)*Math.min(1,dt*6);
    if(L>reach){wish.copy(d.normalize());speed=en.type==='warden'?5.4:6.5}
    else if(en.wind<=0&&en.atk<=0){en.wind=.55;en.st.attackT=0;en.st.attackKind=en.type==='warden'?'slash':'smash';en.st.atkDur=.7;en.st.combo++}
  } else {en.state='idle';en.wanderT-=dt;if(en.wanderT<=0){en.wanderT=3+Math.random()*4;en.wander.set(en.home.x+(Math.random()-.5)*16,0,en.home.z+(Math.random()-.5)*16)}
    const d=en.wander.clone().sub(en.pos).setY(0);if(d.length()>1){wish.copy(d.normalize());speed=1.6;en.yaw+=angDiff(Math.atan2(d.x,d.z),en.yaw)*Math.min(1,dt*3)}}
  if(en.wind>0){en.wind-=dt;if(en.wind<=0){en.atk=1.1;if(target&&target.pos.distanceTo(en.pos)<(en.type==='warden'?2.6:3.3))hurtHero(target,en.type==='warden'?8:13,en)}}
  if(en.atk>0)en.atk-=dt;
  if(en.rootT>0){en.rootT-=dt;speed=0}
  // movement + knockback
  en.vel.x=wish.x*speed+en.knock.x;en.vel.z=wish.z*speed+en.knock.z;
  en.pos.x+=en.vel.x*dt;en.pos.z+=en.vel.z*dt;en.pos.y+=en.knock.y*dt;
  en.knock.x*=Math.pow(.02,dt);en.knock.z*=Math.pow(.02,dt);en.knock.y-=20*dt;
  collide(en.pos,en.radius);
  const g=Math.max(H(en.pos.x,en.pos.z),BB.WATER_Y-1.2);if(en.pos.y<=g){en.pos.y=g;en.knock.y=0}
  if(en.relayT>0){en.relayT-=dt;const o=en.relay;if(o&&alive(o)&&o.pos.distanceTo(en.pos)<2.2){hit(en,36,null,0,{color:0x9fd8ff});hit(o,36,null,0,{color:0x9fd8ff});ring(en.pos,0x9fd8ff,.5,4,.4,1);en.knock.set(0,5,0);o.knock.set(0,5,0);en.relayT=o.relayT=0}}
  if(en.coil)en.coil.position.copy(en.pos);
  en.root.position.copy(en.pos);en.root.rotation.y=en.yaw;
  if(en.st.attackT>=0){en.st.attackT+=dt/en.st.atkDur;if(en.st.attackT>1)en.st.attackT=-1}
  en.st.speed=Math.hypot(en.vel.x,en.vel.z);en.st.grounded=true;
  if(en.isQuad){en.st.pounce=en.wind>0?1:0;BB.animBeast(en.model,en.st,dt,t)}else if(en.model.animate)en.model.animate(en.st,dt);else BB.animHuman(en.model,en.st,dt);
  en.bar.position.set(en.pos.x,en.pos.y+(en.isQuad?2.6:2.35),en.pos.z);
  if(en.reveal>0){en.reveal-=dt;en.bar.visible=true;if(!en.revealMark){const m=new THREE.Mesh(new THREE.RingGeometry(.9,1.1,24),basic(0xff5a4a,.9));m.rotation.x=-PI/2;m.material.depthTest=false;m.renderOrder=9;scene.add(m);en.revealMark=m}
    en.revealMark.visible=true;en.revealMark.position.set(en.pos.x,en.pos.y+.1,en.pos.z);en.revealMark.scale.setScalar(1+Math.sin(t*6)*.1)}
  else if(en.revealMark)en.revealMark.visible=false;
}

// ---------- hero update ----------
function updateHero(e,dt,t){
  for(const k in e.cds)if(e.cds[k]>0)e.cds[k]-=dt;
  for(const k in e.buffs)if(e.buffs[k]>0){e.buffs[k]-=dt;if(e.buffs[k]<=0)onBuffEnd(e,k)}
  if(e.hurtT>0)e.hurtT-=dt;
  if(e.downT>0){e.downT-=dt;if(e.downT<=0){e.hp=e.maxhp;e.breath=100;e.pos.copy(e.home);e.vel.set(0,0,0);e.h.root.visible=true;if(e.mantleOn)toggleMantle(e)}return}
  // breath & mantle
  if(e.mantleOn){e.breath-=(e.def.id==='trae'?0:4)*dt;if(e.lastlight>0){e.lastlight-=dt;if(e.lastlight<=0){toggleMantle(e);e.lionRest=15;toast('Lastlight spent. The lion collapses and needs rest.',3)}}
    if(e.breath<=0&&e.mantleOn){e.breath=0;toggleMantle(e)}}
  else e.breath=Math.min(100,e.breath+9*dt);
  if(e.lionRest>0)e.lionRest-=dt;
  if(!e.mantleOn&&e.hp<e.maxhp&&!(e.hurtT>0))e.hp=Math.min(e.maxhp,e.hp+2*dt);
  if(e.mantleGrow<1){e.mantleGrow=Math.min(1,(e.mantleGrow||0)+dt*4);e.h.mantle.forEach(m=>m.scale.copy(m.userData.baseScale).multiplyScalar(Math.max(.01,e.mantleGrow)))}
  let wish=new V3(),speed=0;
  const base=(e.buffs.haste>0?1.3:1)*(e.buffs.rush>0?1.5:1)*(e.mantleOn?(e.def.id==='trae'?1.4:1.1):1);
  if(e===active){
    let ix=(keys.KeyD||keys.ArrowRight?1:0)-(keys.KeyA||keys.ArrowLeft?1:0)+move.x, iz=(keys.KeyW||keys.ArrowUp?1:0)-(keys.KeyS||keys.ArrowDown?1:0)-move.y;
    const L=Math.hypot(ix,iz);if(L>1){ix/=L;iz/=L}
    const cy=camYaw+PI;const f=fwd(cy),r=fwd(cy-PI/2);
    wish.set(f.x*iz+r.x*ix,0,f.z*iz+r.z*ix);
    const sprint=keys.ShiftLeft||keys.ShiftRight||sprintLatch;
    speed=(sprint?11:6.2)*base*Math.min(1,L+(L>0?.25:0));
    if(e.buffs.bulwark>0)speed*=.5;
    if(wish.lengthSq()>.001&&e.st.attackT<0&&!e.dash){const yaw=Math.atan2(wish.x,wish.z);e.yaw+=angDiff(yaw,e.yaw)*Math.min(1,dt*12)}
    if(e.st.attackT>=0)speed*=.35;
    if(wish.lengthSq()>.001)wish.normalize();
  } else if(party||e.returning){
    const goal=party?active.pos.clone().add(formation(e)):e.home;
    const d=goal.clone().sub(e.pos).setY(0);const L=d.length();
    if(L>60&&party){e.pos.copy(goal);e.pos.y=H(goal.x,goal.z);e.bpos.copy(e.pos)}
    if(L>1.2){wish.copy(d.normalize());speed=Math.min(11,L*1.4)*base;const yaw=Math.atan2(wish.x,wish.z);e.yaw+=angDiff(yaw,e.yaw)*Math.min(1,dt*8)}
    else if(e.returning&&!party)e.returning=false;
    // simple helper AI: hit nearby Wardens
    const n=nearestEnemy(e.pos,party?7:4);if(n&&n.state!=='idle'){const d2=n.pos.clone().sub(e.pos);e.yaw=Math.atan2(d2.x,d2.z);if(d2.length()<curAttack(e).range+.4||curAttack(e).ranged){speed=0;attack(e)}}
  }
  stepBody(e,wish,speed,dt);
  // attack timeline
  const s=e.st;
  if(s.attackT>=0){const prev=s.attackT;s.attackT+=dt/(s.atkDur||.45);const hitAt=ATK_HIT[s.attackKind]||.35;
    if(!s.hitDone&&prev<hitAt&&s.attackT>=hitAt){s.hitDone=true;resolveAttack(e)}
    if(s.attackT>1){s.attackT=-1;s.dual=false;s.aimBoth=false}}
  if(s.cast>0)s.cast-=dt;
  s.speed=Math.hypot(e.vel.x,e.vel.z);s.grounded=e.grounded;
  s.aim=e.def.attack.ranged&&!(e.buffs.blades>0)&&(s.attackT>=0||(e===active&&e.aimHold>0));
  s.aimBoth=s.aim?true:s.aimBoth;
  s.block=e.buffs.bulwark>0||e.buffs.guard>0;
  e.h.root.position.copy(e.pos);e.h.root.rotation.y=e.yaw;
  if(e.h.animate)e.h.animate(s,dt);else BB.animHuman(e.h,s,dt);
  // per-hero visuals
  if(e.extra?.swords){}
  if(e.h.extra.swords){const on=e.buffs.blades>0;e.h.extra.swords.forEach(w=>w.visible=on);e.h.items.R.concat(e.h.items.L).forEach(w=>w.visible=!on)}
  if(e.h.extra.long){const on=e.buffs.unfold>0;e.h.extra.long.forEach(w=>w.visible=on);e.h.items.R.concat(e.h.items.L).forEach(w=>w.visible=!on)}
  if(e.h.extra.heat){e.h.extra.heat.intensity=e.buffs.heat>0?2.2+Math.sin(t*20)*.4:0;if(e.buffs.heat>0&&Math.random()<.4){const p=new V3();e.h.B.handR.getWorldPosition(p);burst(p,0xff7a2a,1,1,.6,1)}}
  if(e.mantleOn&&Math.random()<.15){const p=e.pos.clone();p.y+=.4+Math.random()*1.4;p.x+=(Math.random()-.5)*.8;p.z+=(Math.random()-.5)*.8;burst(p,e.def.mantle.glow,1,.5,.5,1)}
  if(e.buffs.veil>0&&Math.random()<.3)burst(tmp2.copy(e.pos).setY(e.pos.y+Math.random()*1.6),0x7a5adf,1,.6,.7,.5);
  if(e.echoOrbs)e.echoOrbs.forEach((m,i)=>{const a=t*3+i*2.1;m.position.set(e.pos.x+Math.cos(a)*.8,e.pos.y+1.9+Math.sin(t*4+i)*.1,e.pos.z+Math.sin(a)*.8)});
  updateBeast(e,dt,t);
  if(e.harpy)updateHarpy(e,dt,t);
}
function formation(e){const i=heroes.indexOf(e)-(heroes.indexOf(e)>heroes.indexOf(active)?1:0);const row=Math.floor(i/3)+1,col=(i%3)-1;const b=fwd(active.yaw).multiplyScalar(-row*3.2),s=fwd(active.yaw+PI/2).multiplyScalar(col*3.4);return b.add(s)}
function onBuffEnd(e,k){if(k==='veil')e.h.root.visible=true}

// ---------- projectiles ----------
function updateProjs(dt){
  for(let i=projs.length-1;i>=0;i--){const p=projs[i];p.t+=dt;p.life-=dt;
    if(p.boomerang&&p.t>p.life*.0+.6&&!p.back){p.back=true;p.hitSet.clear()}
    if(p.back){const home=p.src.pos.clone().setY(p.src.pos.y+1.3);const d=home.sub(p.m.position);if(d.length()<1.2){scene.remove(p.m);projs.splice(i,1);continue}p.vel.lerp(d.normalize().multiplyScalar(30),Math.min(1,dt*8))}
    p.m.position.addScaledVector(p.vel,dt);
    if(p.spin)p.m.rotation.y+=p.spin*dt;
    if(!p.m.userData.flat&&!p.spin)p.m.quaternion.setFromUnitVectors(new V3(0,1,0),tmp.copy(p.vel).normalize());
    let gone=p.life<=0||p.m.position.y<H(p.m.position.x,p.m.position.z)-.2;
    for(const en of enemies){if(!alive(en)||p.hitSet.has(en))continue;const dy=p.m.position.y-(en.pos.y+1);if(Math.abs(dy)>1.6)continue;
      if(Math.hypot(en.pos.x-p.m.position.x,en.pos.z-p.m.position.z)<en.radius+p.radius){p.hitSet.add(en);hit(en,p.dmg,p.src,p.knock,{color:p.color||0xffffff});if(!p.pierce){gone=true;break}}}
    for(const y of world.pylons){if(y.broken||p.hitSet.has(y))continue;if(Math.hypot(y.pos.x-p.m.position.x,y.pos.z-p.m.position.z)<2.2&&p.m.position.y<y.pos.y+18){p.hitSet.add(y);hitPylon(y,p.dmg);if(!p.pierce)gone=true}}
    if(gone){scene.remove(p.m);projs.splice(i,1)}}
}

// ---------- HUD ----------
const abBtns=[...document.querySelectorAll('.ab[data-act]')].filter(b=>/^\d$/.test(b.dataset.act));
function refreshHUD(){const d=active.def;
  $('#heroName').textContent=d.name;$('#heroRole').textContent=d.role;$('#heroBeast').textContent=d.beastName+(d.extra==='harpy'?' · Razorbill-Harpy':'');
  abBtns.forEach((b,i)=>{const a=d.abilities[i];b.querySelector('.nm').textContent=a.name;b.title=a.name+': '+a.desc});
  $('#mantleBtn').classList.toggle('on',active.mantleOn);$('#mantleBtn .nm').textContent=d.mantle.name;
  $('#swatch').style.background='#'+d.mantle.glow.toString(16).padStart(6,'0');
}
function hudTick(){const e=active;
  $('#hpFill').style.width=(e.hp/e.maxhp*100)+'%';$('#brFill').style.width=e.breath+'%';
  abBtns.forEach((b,i)=>{const a=e.def.abilities[i];const cd=Math.max(0,e.cds[a.id]||0);const k=cd/a.cd;b.style.setProperty('--cd',(k*360)+'deg');b.classList.toggle('cool',cd>0);b.classList.toggle('poor',e.breath<a.cost);b.querySelector('.t').textContent=cd>0?Math.ceil(cd):''});
  const bb=$('#beastBtn');bb.classList.toggle('cool',e.beastCd>0||e.lionRest>0);
}
function updateObjective(){$('#obj').innerHTML=`Crown pylons broken <b>${pylonsBroken}/4</b>`}
function buildPanels(){
  const grid=$('#rosterGrid');grid.innerHTML='';
  BB.ROSTER.forEach((d,i)=>{const b=document.createElement('button');b.className='card';b.innerHTML=`<span class="dot" style="background:#${d.mantle.glow.toString(16).padStart(6,'0')}"></span><b>${d.name}</b><small>${d.beastName}</small><em>${d.role}</em><kbd>${i<9?i+1:i===9?0:i===10?'−':'='}</kbd>`;
    b.onclick=()=>{switchTo(i);closePanels();if(!started)begin()};grid.appendChild(b)});
}
function fillCodex(){const d=active.def;$('#codexBody').innerHTML=`<h2>${d.name}</h2><p class="role">${d.role} · ${d.beastName}${d.extra==='harpy'?' · Razorbill-Harpy Accord':''}</p><p>${d.bio}</p><h3>Weapons</h3><p>${d.weapons}</p><h3>Abilities</h3>`+
  d.abilities.map(a=>`<div class="abl"><kbd>${a.key}</kbd><div><b>${a.name}</b><span>${a.cd}s cooldown · ${a.cost} Breath</span><p>${a.desc}</p></div></div>`).join('')+
  `<div class="abl"><kbd>T</kbd><div><b>${d.mantle.name}</b><span>Toggle · drains Breath</span><p>${d.id==='trae'?'Ten seconds of peak power: double damage, faster, hits harder. The lion collapses afterward and needs rest.':'Animal-themed armor manifested through the Accord. More damage dealt, less taken.'}</p></div></div>`+
  `<div class="abl"><kbd>F</kbd><div><b>Companion</b><span>Command</span><p>Send ${d.beastName.split(',')[0].toLowerCase()} at the nearest target. It also joins in on its own when you fight.</p></div></div>`}
function openPanel(which){closePanels();$('#'+which).hidden=false;if(which==='codex')fillCodex();if(document.pointerLockElement)document.exitPointerLock()}
function closePanels(){$('#roster').hidden=true;$('#codex').hidden=true}
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=closePanels);
$('#rosterBtn').onclick=()=>openPanel('roster');$('#codexBtn').onclick=()=>openPanel('codex');$('#partyBtn').onclick=toggleParty;
function switchTo(i){if(!heroes[i]||heroes[i]===active)return;const prev=active;active=heroes[i];
  if(!party)prev.returning=false;
  camYaw=active.yaw+PI;refreshHUD();toast(`${active.def.name} and ${active.def.beastName.split(',')[0].toLowerCase()}`,1.8);
  if(!$('#codex').hidden)fillCodex()}

// ---------- start ----------
buildPanels();refreshHUD();updateObjective();
function begin(){started=true;$('#intro').hidden=true;document.body.classList.add('playing');toast('Break the four Crown pylons. Free the collared.',3.5)}
$('#beginBtn').onclick=begin;$('#beginBtn').disabled=false;$('#beginBtn').textContent='Enter as Trae';

// ---------- main loop ----------
let last=performance.now(),tintT=0,hudT=0;
world.slowT=0;
function loop(now){
  const dt=Math.min(.05,(now-last)/1000);last=now;const t=now/1000;
  if(world.slowT>0)world.slowT-=dt;
  if(world.decoy){world.decoy.t-=dt;if(world.decoy.t<=0){world.decoy=null;enemies.forEach(e=>{if(e.state==='decoy')e.state='idle'})}}
  if(tintT>0){tintT-=dt;if(tintT<=0)$('#tint').style.opacity=0}
  if(toastT>0){toastT-=dt;if(toastT<=0)$('#toast').classList.remove('show')}
  heroes.forEach(h=>{const far=h.pos.distanceTo(active.pos)>140&&h!==active;h.h.root.visible=!far&&!(h.buffs.veil>0)&&!(h.downT>0);h.beast.root.visible=!far;if(!far||party)updateHero(h,dt,t)});
  enemies.forEach(en=>{const far=en.pos.distanceTo(active.pos)>160;en.root.visible=!far&&(en.dead<=0||en.deathT<1.2);if(!far)updateEnemy(en,dt,t);else en.bar.visible=false});
  updateProjs(dt);
  for(let i=fxList.length-1;i>=0;i--){const f=fxList[i];f.t+=dt;const k=Math.min(1,f.t/f.dur);f.update&&f.update(f,k,dt);if(k>=1){scene.remove(f.obj);f.obj.geometry&&f.obj.geometry!==sparkGeo&&f.obj.geometry.dispose&&f.obj.geometry.dispose();fxList.splice(i,1);f.onEnd&&f.onEnd()}}
  // camera
  const e=active;const tgtH=(e.def.id==='josh'||e.def.id==='thomas')?1.75:1.6;
  const focus=new V3(e.pos.x,e.pos.y+tgtH,e.pos.z);
  const cd=camDist*(e.mantleOn?1.08:1);
  const off=new V3(Math.sin(camYaw)*Math.cos(camPitch)*cd,Math.sin(camPitch)*cd,Math.cos(camYaw)*Math.cos(camPitch)*cd);
  const right=fwd(camYaw+PI/2).multiplyScalar(-.55);
  const want=focus.clone().add(off).add(right);
  const gy=H(want.x,want.z)+.5;if(want.y<gy)want.y=gy;
  camera.position.lerp(want,1-Math.pow(.0001,dt));
  camera.lookAt(focus.x+right.x,focus.y,focus.z+right.z);
  world.update(dt,t,e.pos);
  if((hudT+=dt)>.1){hudT=0;hudTick();$('#hurt').style.opacity=Math.max(0,parseFloat($('#hurt').style.opacity||0)-.1)}
  renderer.render(scene,camera);
  requestAnimationFrame(loop);
}
// idle camera drift on the intro screen
camYaw=active.yaw+PI+.6;camPitch=.22;camDist=9;
requestAnimationFrame(loop);
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
BB.debug={renderer,heroes,enemies,get active(){return active},switchTo,useAbility,attack,world,camera,scene,setCam(y,p,d){camYaw=y;camPitch=p;camDist=d}};
};
