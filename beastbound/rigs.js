// Beastbound Wilds — rigged, motion-captured models (glTF) layered over the procedural fallbacks.
(function(){
const BB=window.BB=window.BB||{};
const PI=Math.PI, V3=THREE.Vector3, Q=THREE.Quaternion;
const ASSETS={rpm:'assets/readyplayer.glb',soldier:'assets/Soldier.glb',fox:'assets/Fox.glb',parrot:'assets/Parrot.glb',stork:'assets/Stork.glb'};
const store={};

BB.loadAssets=function(onProgress){
  if(!THREE.GLTFLoader||!THREE.SkeletonUtils)return Promise.resolve(false);
  const L=new THREE.GLTFLoader(); const keys=Object.keys(ASSETS); let done=0;
  return Promise.all(keys.map(k=>new Promise(res=>L.load(ASSETS[k],g=>{store[k]=g;onProgress&&onProgress(++done/keys.length);res()},undefined,()=>{onProgress&&onProgress(++done/keys.length);res()}))))
    .then(()=>{BB.RIGS=!!(store.rpm&&store.soldier);prepClips();return BB.RIGS});
};

// ---------- clip retargeting: Mixamo (Soldier) -> Ready Player Me bone names ----------
let heroClips={}, wardenClips={};
function prepClips(){
  if(!store.soldier)return;
  store.soldier.animations.forEach(c=>{
    const name=c.name.toLowerCase();
    const w=c.clone();w.tracks=w.tracks.filter(t=>!t.name.endsWith('.position')&&!t.name.endsWith('.scale'));wardenClips[name]=w;
    const h=c.clone();h.tracks=h.tracks.filter(t=>t.name.endsWith('.quaternion')&&!/Hips\.quaternion$/.test(t.name)).map(t=>{t=t.clone();t.name=t.name.replace(/^mixamorig:?/,'');return t});heroClips[name]=h;
  });
}

// ---------- helpers ----------
const _v=new V3(),_v2=new V3(),_q=new Q(),_q2=new Q(),_m=new THREE.Matrix4();
function worldPos(o,out=new V3()){o.updateWorldMatrix(true,false);return out.setFromMatrixPosition(o.matrixWorld)}
function boneDir(b,child,out=new V3()){return worldPos(child,out).sub(worldPos(b,_v2)).normalize()}
// Attach obj to bone so that, in the current (rest) pose, obj sits at world position wp
// with its local +Y along Yw and local +Z as close as possible to Zhint. Counter-scales bone scale.
function attach(bone,obj,wp,Yw,Zhint){
  bone.updateWorldMatrix(true,false);
  const Y=Yw.clone().normalize(), X=new V3().crossVectors(Y,Zhint).normalize(), Z=new V3().crossVectors(X,Y);
  if(X.lengthSq()<1e-6){X.set(1,0,0)}
  const wq=new Q().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X,Y,Z));
  const bq=new Q(),bp=new V3(),bs=new V3();bone.matrixWorld.decompose(bp,bq,bs);
  const sock=new THREE.Group();
  sock.position.copy(bone.worldToLocal(wp.clone()));
  sock.quaternion.copy(bq.clone().invert().multiply(wq));
  sock.scale.set(1/bs.x,1/bs.y,1/bs.z);
  bone.add(sock);sock.add(obj);return sock;
}
function aimBone(b,child,dirW,w){
  if(w<=.001)return;
  b.updateWorldMatrix(true,true);
  const cur=boneDir(b,child,_v);
  const d=_q.setFromUnitVectors(cur,dirW);
  const bw=b.getWorldQuaternion(new Q());
  const nw=d.multiply(bw);
  const pw=b.parent.getWorldQuaternion(_q2).invert();
  const local=pw.multiply(nw);
  b.quaternion.slerp(local,w);
}
function normalizeHeight(root,h){root.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(root);const s=h/(box.max.y-box.min.y);root.scale.multiplyScalar(s);root.updateMatrixWorld(true);const b2=new THREE.Box3().setFromObject(root);root.position.y-=b2.min.y;return s}
// grayscale the texture, then tint: keeps fabric/skin detail but lets us recolor
function tintable(mat,color,lift=1.6){const m=mat.clone();m.color=new THREE.Color(color);m.userData.lift=lift;
  m.onBeforeCompile=sh=>{sh.fragmentShader=sh.fragmentShader.replace('#include <map_fragment>',
   `#ifdef USE_MAP
     vec4 sampledDiffuseColor = texture2D( map, vUv );
     float g = dot(sampledDiffuseColor.rgb, vec3(.299,.587,.114));
     diffuseColor.rgb *= vec3(g) * ${lift.toFixed(2)};
   #endif`)};
  m.customProgramCacheKey=()=>'tint'+lift;return m}

// ---------- heroes on the Ready Player Me body ----------
const SKIN_LIFT={};
BB.buildRiggedHero=function(def){
  const src=store.rpm.scene;
  const root=new THREE.Group();
  const model=THREE.SkeletonUtils.clone(src);
  root.add(model);
  const look=def.look, sc=look.scale||1, bw=look.build||1;
  const bones={};model.traverse(o=>{if(o.isBone)bones[o.name]=o});
  // materials
  model.traverse(o=>{if(!o.isMesh)return;o.castShadow=true;o.receiveShadow=false;o.frustumCulled=false;
    const n=o.material.name||'';
    if(n.includes('Skin')||n.includes('Body'))o.material=tintable(o.material,look.skin,2.2);
    else if(n.includes('Outfit_Top'))o.material=tintable(o.material,look.coat||look.top,1.5);
    else if(n.includes('Outfit_Bottom'))o.material=tintable(o.material,look.pants,1.6);
    else if(n.includes('Footwear'))o.material=tintable(o.material,look.boots||0x2a2420,1.3);
    else if(n.includes('Headwear')){o.material=tintable(o.material,look.hairC||0x161210,1.2);o.visible=look.hair==='rpm'}
    else if(n.includes('Beard')){o.material=tintable(o.material,look.hairC||0x161210,1.2);o.visible=!!look.beard}
    else if(n.includes('Eye')&&look.eyeGlow){o.material=o.material.clone();o.material.color=new THREE.Color(look.eye);o.material.emissive=new THREE.Color(look.eye);o.material.emissiveIntensity=.35}
  });
  normalizeHeight(model,1.8);
  model.scale.x*=bw;model.scale.z*=Math.sqrt(bw);
  root.scale.setScalar(sc);
  root.updateMatrixWorld(true);
  const B={root,body:model,bones};
  const hips=bones.Hips,spine=bones.Spine,chest=bones.Spine2,head=bones.Head,neck=bones.Neck;
  const arm={R:bones.RightArm,L:bones.LeftArm},fore={R:bones.RightForeArm,L:bones.LeftForeArm},hand={R:bones.RightHand,L:bones.LeftHand};
  const up=new V3(0,1,0),fwd=new V3(0,0,1);
  // sockets (all positioned in the rest pose)
  const hp=worldPos(head),hd=boneDir(head,bones.HeadTop_End||head.children[0]);
  const headH=worldPos(bones.HeadTop_End||head.children[0]).y-hp.y;
  const headC=hp.clone().addScaledVector(hd,headH*.5);
  B.headSock=attach(head,new THREE.Group(),headC,up,fwd);B.headSock.userData.r=headH*.5;
  ['R','L'].forEach(s=>{const hpos=worldPos(hand[s]);const hdir=boneDir(fore[s],hand[s]);
    const gp=hpos.clone().addScaledVector(hdir,.07).add(new V3(0,-.02,0));
    B['grip'+s]=attach(hand[s],new THREE.Group(),gp,fwd.clone().multiplyScalar(1.1).add(hdir).normalize(),hdir.clone().multiplyScalar(-1));
    B['gun'+s]=attach(hand[s],new THREE.Group(),gp,hdir,new V3(0,-1,0));
    const fp=worldPos(fore[s]).lerp(hpos,.45).add(new V3(0,.05,0));
    B['arm'+s]=attach(fore[s],new THREE.Group(),fp,new V3(0,0,1),new V3(0,1,0));
    B['hand'+s]=hand[s];
  });
  const cp=worldPos(chest);
  B.back=attach(chest,new THREE.Group(),cp.clone().add(new V3(0,.06,-.16)),up,new V3(0,0,-1));
  const hipP=worldPos(hips);
  B.hipL=attach(hips,new THREE.Group(),hipP.clone().add(new V3(.19,-.04,.03)),up,new V3(1,0,0));
  B.hipR=attach(hips,new THREE.Group(),hipP.clone().add(new V3(-.19,-.04,.03)),up,new V3(-1,0,0));
  const thighP={L:worldPos(bones.LeftUpLeg).lerp(worldPos(bones.LeftLeg),.4),R:worldPos(bones.RightUpLeg).lerp(worldPos(bones.RightLeg),.4)};
  B.thighL=attach(bones.LeftUpLeg,new THREE.Group(),thighP.L.add(new V3(.09,0,0)),up,new V3(1,0,0));
  B.thighR=attach(bones.RightUpLeg,new THREE.Group(),thighP.R.add(new V3(-.09,0,0)),up,new V3(-1,0,0));
  // procedural hair / headgear on the real head
  if(look.hair&&look.hair!=='rpm'&&BB.HAIR&&BB.HAIR[look.hair]){const g=new THREE.Group();const r=B.headSock.userData.r;g.scale.setScalar(r/.112);g.position.set(0,-r*.32,-r*.04);BB.HAIR[look.hair](g,BB.M(look.hairC||0x161210,{roughness:.95}));B.headSock.add(g)}
  // mixer
  const mixer=new THREE.AnimationMixer(model);const acts={};
  ['idle','walk','run'].forEach(n=>{if(heroClips[n]){const a=mixer.clipAction(heroClips[n]);a.play();a.setEffectiveWeight(n==='idle'?1:0);acts[n]=a}});
  const h={root,B,rig:true,scale:sc,mantle:[],mixer,acts,bones,arm,fore,hand,chest,poseW:{R:0,L:0}};
  h.animate=(st,dt)=>animateRig(h,st,dt);
  buildRigMantle(h,def);
  return h;
};

function setLocomotion(h,speed,dt,walkRef=1.6,runRef=6){
  const a=h.acts;if(!a.idle)return;
  const w=Math.min(1,speed/walkRef), r=Math.max(0,Math.min(1,(speed-walkRef)/(runRef-walkRef)));
  const wi=1-w, ww=w*(1-r), wr=w*r;
  a.idle.setEffectiveWeight(wi);a.walk&&a.walk.setEffectiveWeight(ww);a.run&&a.run.setEffectiveWeight(wr);
  if(a.walk)a.walk.timeScale=Math.max(.6,speed/walkRef*.9);
  if(a.run)a.run.timeScale=Math.max(.7,speed/runRef);
  h.mixer.update(dt);
}
const L=(x,y,z)=>new V3(x,y,z).normalize();
function lerpDir(a,b,t){return a.clone().lerp(b,t).normalize()}
const ease=t=>t<0?0:t>1?1:t*t*(3-2*t);
// character-local arm targets (character faces +Z; its right side is -X)
function poseFor(st){
  const R={},Lf={};let twist=0;
  if(st.attackT>=0){const t=st.attackT,k=st.attackKind;
    if(k==='thrust'){const e=ease(t/.35),b=ease((t-.35)/.5);R.u=lerpDir(L(-.6,-.3,-.5),L(-.1,.1,1),e);R.f=lerpDir(L(-.2,.4,-.6),L(0,.08,1),e);if(b>0){R.u.lerp(L(-.6,-.8,.2),b).normalize();R.f.lerp(L(-.3,-.7,.4),b).normalize()}twist=-.4*e}
    else if(k==='smash'){const e=ease(t/.4),d=ease((t-.4)/.2);[R,Lf].forEach((s,i)=>{const sx=i?1:-1;s.u=lerpDir(L(sx*.2,1,-.15),L(sx*.15,-.1,1),d);s.f=lerpDir(L(sx*-.1,.5,-.9),L(sx*-.15,-.6,.8),d)});R.w=Lf.w=e}
    else if(k==='spin'){R.u=L(-1,.15,.1);R.f=L(-1,.1,.3);Lf.u=L(1,.15,.1);Lf.f=L(1,.1,.3)}
    else if(k==='clap'){const e=ease(t/.45);R.u=lerpDir(L(-1,.1,.4),L(-.25,.05,1),e);R.f=lerpDir(L(-.6,.1,.8),L(.35,0,1),e);Lf.u=lerpDir(L(1,.1,.4),L(.25,.05,1),e);Lf.f=lerpDir(L(.6,.1,.8),L(-.35,0,1),e)}
    else if(k==='shoot'){R.u=L(-.05,.08,1);R.f=L(0,.08,1);if(st.aimBoth){Lf.u=L(.05,.08,1);Lf.f=L(0,.08,1)}}
    else{const sg=st.combo%2?-1:1;const e=ease(t/.3),d=ease((t-.3)/.3);
      const wind=sg>0?[L(-.7,.7,-.25),L(-.2,.4,-.9)]:[L(.3,.9,-.1),L(.5,.5,-.7)];
      const end=sg>0?[L(.35,-.25,1),L(.7,-.3,.6)]:[L(-.8,-.35,.6),L(-.9,-.2,.2)];
      R.u=lerpDir(L(-.3,-.9,.2),wind[0],e);R.f=lerpDir(L(-.2,-.6,.7),wind[1],e);
      if(d>0){R.u=lerpDir(R.u,end[0],d);R.f=lerpDir(R.f,end[1],d)}
      twist=sg*(.45*e-1.0*d);
      if(st.dual){Lf.u=new V3(-R.u.x,R.u.y,R.u.z);Lf.f=new V3(-R.f.x,R.f.y,R.f.z)}}
  }
  else if(st.aim){R.u=L(-.05,.08,1);R.f=L(0,.08,1);if(st.aimBoth){Lf.u=L(.05,.08,1);Lf.f=L(0,.08,1)}}
  if(st.block&&!Lf.u){Lf.u=L(.35,-.35,.85);Lf.f=L(-.6,.55,.6)}
  if(st.cast>0){R.u=L(-.35,1,.15);R.f=L(-.2,1,.25);Lf.u=L(.35,1,.15);Lf.f=L(.2,1,.25)}
  return {R,L:Lf,twist};
}
function animateRig(h,st,dt){
  setLocomotion(h,st.speed,dt);
  const p=poseFor(st);
  const rq=h.root.getWorldQuaternion(new Q());
  ['R','L'].forEach(s=>{const tg=p[s];const want=tg.u?1:0;h.poseW[s]+=(want-h.poseW[s])*Math.min(1,dt*16);
    const w=h.poseW[s]*(tg.w??1);
    if(tg.u){h['last'+s]=tg}
    const use=tg.u?tg:h['last'+s];
    if(!use||w<.01)return;
    aimBone(h.arm[s],h.fore[s],use.u.clone().applyQuaternion(rq),w);
    aimBone(h.fore[s],h.hand[s],use.f.clone().applyQuaternion(rq),w);
  });
  h.twist=(h.twist||0)+((p.twist||0)-(h.twist||0))*Math.min(1,dt*14);
  if(Math.abs(h.twist)>.01){h.chest.quaternion.premultiply(_q.setFromAxisAngle(new V3(0,1,0),h.twist*.6))}
  // the 'spin' attack rotates the whole body
  h.B.body.rotation.y=st.attackT>=0&&st.attackKind==='spin'?st.attackT*PI*2:0;
}

// ---------- Mantle armor on the rig ----------
function buildRigMantle(h,def){
  const o=def.mantle,b=h.bones,M=BB.M;
  const base=M(o.mantle,{metalness:.75,roughness:.32}),glow=M(o.glow,{emissive:o.glow,emissiveIntensity:1.8,roughness:.4});
  const parts=[];const up=new V3(0,1,0),fz=new V3(0,0,1);
  const put=(bone,mesh,wp,Y,Z)=>{attach(bone,mesh,wp,Y,Z);mesh.castShadow=true;parts.push(mesh);return mesh};
  const cp=worldPos(b.Spine2);
  put(b.Spine2,new THREE.Mesh(new THREE.SphereGeometry(.2,18,12),base),cp.clone().add(new V3(0,.02,.04)),up,fz).scale.set(1.15,.85,.75);
  put(b.Spine2,new THREE.Mesh(new THREE.BoxGeometry(.2,.025,.02),glow),cp.clone().add(new V3(0,.06,.19)),up,fz);
  put(b.Spine,new THREE.Mesh(new THREE.CylinderGeometry(.16,.15,.18,14),base),worldPos(b.Spine).add(new V3(0,.04,0)),up,fz).scale.set(1,1,.8);
  ['Left','Right'].forEach((s,i)=>{const sx=i?-1:1;
    const a=b[s+'Arm'],f=b[s+'ForeArm'],hd=b[s+'Hand'],ul=b[s+'UpLeg'],lg=b[s+'Leg'],ft=b[s+'Foot'];
    put(a,new THREE.Mesh(new THREE.SphereGeometry(.1,12,8),base),worldPos(a).add(new V3(sx*.03,.04,0)),up,fz).scale.set(1.2,.8,1.1);
    const fd=boneDir(f,hd);put(f,new THREE.Mesh(new THREE.CylinderGeometry(.055,.05,.17,10),base),worldPos(f).lerp(worldPos(hd),.55),fd,up);
    put(f,new THREE.Mesh(new THREE.TorusGeometry(.057,.008,4,14),glow),worldPos(f).lerp(worldPos(hd),.3),new V3(0,0,1).cross(fd).lengthSq()>0?fd.clone().cross(up).normalize():up,fd);
    const ld=boneDir(lg,ft);put(lg,new THREE.Mesh(new THREE.CylinderGeometry(.068,.06,.26,10),base),worldPos(lg).lerp(worldPos(ft),.45).add(new V3(0,0,.02)),ld,fz);
    put(ul,new THREE.Mesh(new THREE.SphereGeometry(.085,10,8),base),worldPos(ul).lerp(worldPos(lg),.35).add(new V3(0,0,.05)),boneDir(ul,lg),fz).scale.set(1,1.5,.7);
  });
  const hs=h.B.headSock;const r=hs.userData.r||.12;const helm=new THREE.Group();helm.scale.setScalar(r/.105);helm.position.set(0,-r*.3,-r*.03);hs.add(helm);
  const add=(geo,mat,x,y,z,rx=0,ry=0,rz=0,sx=1,sy=1,sz=1)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.rotation.set(rx,ry,rz);m.scale.set(sx,sy,sz);m.castShadow=true;helm.add(m);parts.push(m);return m};
  add(new THREE.SphereGeometry(.135,18,12,0,PI*2,0,PI*.62),base,0,.0,-.01,0,0,0,1,1.05,1.1);
  add(new THREE.BoxGeometry(.2,.028,.02),glow,0,.02,.125);
  const k=o.mantleKind;
  if(k==='lion'){for(let i=0;i<9;i++){const a=(i-4)*.32;add(new THREE.ConeGeometry(.025,.12,4),M(0xd9b45a,{metalness:.9,roughness:.25,emissive:0x7a5410,emissiveIntensity:.6}),Math.sin(a)*.12,.14+Math.cos(a)*.02,Math.cos(a)*.03-.02,-.2*Math.cos(a),0,-a*.6);
    add(new THREE.BoxGeometry(.012,.34,.006),M(0xffe6a8,{emissive:0xffd27a,emissiveIntensity:1.6,transparent:true,opacity:.8}),Math.sin(a)*.13,-.07,-.1-Math.cos(a)*.03,.35,a*.4,0)}}
  else if(k==='horn'){[-1,1].forEach(sx=>add(new THREE.TorusGeometry(.08,.025,6,12,PI*1.3),M(0xd8c9a0),sx*.12,.06,-.02,0,PI/2,0))}
  else if(k==='ears'){[-1,1].forEach(sx=>add(new THREE.ConeGeometry(.04,.12,4),base,sx*.08,.15,-.02,0,0,sx*-.25))}
  else if(k==='round'){[-1,1].forEach(sx=>add(new THREE.SphereGeometry(.04,8,6),base,sx*.1,.12,-.02))}
  else if(k==='crest'){for(let i=0;i<5;i++)add(new THREE.BoxGeometry(.012,.12-i*.012,.06),glow,0,.14-i*.01,-.02-i*.05,-.2-i*.12)}
  else if(k==='mantis'){[-1,1].forEach(sx=>add(new THREE.CylinderGeometry(.006,.006,.3,3),glow,sx*.05,.2,.06,-.6,0,sx*.3))}
  else if(k==='hood'){add(new THREE.SphereGeometry(.16,14,10),M(0x101015,{roughness:.9,side:THREE.DoubleSide}),0,.02,-.03,0,0,0,1,1.05,1.12)}
  parts.forEach(m=>{m.visible=false;m.userData.baseScale=m.scale.clone()});
  h.mantle=parts;
}

// ---------- Crown Wardens on the Soldier rig ----------
BB.buildRiggedWarden=function(){
  const root=new THREE.Group();const model=THREE.SkeletonUtils.clone(store.soldier.scene);root.add(model);
  model.traverse(o=>{if(o.isMesh){o.castShadow=true;o.frustumCulled=false;const n=o.material.name||'';
    o.material=n.includes('Visor')?BB.M(0x9fd2ff,{metalness:1,roughness:.05,emissive:0x264a6a,emissiveIntensity:.6}):tintable(o.material,0xdfe3e6,1.5)}});
  normalizeHeight(model,1.85);
  const bones={};model.traverse(o=>{if(o.isBone)bones[o.name.replace(/^mixamorig:?/,'')]=o});
  const mixer=new THREE.AnimationMixer(model);const acts={};
  ['idle','walk','run'].forEach(n=>{if(wardenClips[n]){const a=mixer.clipAction(wardenClips[n]);a.play();a.setEffectiveWeight(n==='idle'?1:0);acts[n]=a}});
  root.updateMatrixWorld(true);
  const B={root,body:model,bones};
  const hand=bones.RightHand,fore=bones.RightForeArm;
  const hp=worldPos(hand),hd=boneDir(fore,hand);
  B.gripR=attach(hand,new THREE.Group(),hp.clone().addScaledVector(hd,.07),new V3(0,0,1),hd.clone().multiplyScalar(-1));
  const h={root,B,rig:true,scale:1,mixer,acts,bones,arm:{R:bones.RightArm,L:bones.LeftArm},fore:{R:fore,L:bones.LeftForeArm},hand:{R:hand,L:bones.LeftHand},chest:bones.Spine2,poseW:{R:0,L:0}};
  h.animate=(st,dt)=>animateRig(h,st,dt);
  return h;
};

// ---------- real rigged animals ----------
function animal(key,len,opts={}){
  const g=store[key];if(!g)return null;
  const root=new THREE.Group();const model=THREE.SkeletonUtils.clone(g.scene);
  const inner=new THREE.Group();inner.add(model);root.add(inner);
  model.traverse(o=>{if(o.isMesh){o.castShadow=true;o.frustumCulled=false;if(opts.mat)o.material=opts.mat(o.material)}});
  model.rotation.y=opts.yaw||0;
  model.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(model);const sz=box.getSize(new V3());
  const s=len/Math.max(sz.x,sz.z);model.scale.multiplyScalar(s);model.updateMatrixWorld(true);
  const b2=new THREE.Box3().setFromObject(model);model.position.y-=b2.min.y;model.position.x-=(b2.min.x+b2.max.x)/2;model.position.z-=(b2.min.z+b2.max.z)/2;
  const mixer=new THREE.AnimationMixer(model);const acts={};
  g.animations.forEach(c=>{const a=mixer.clipAction(c);a.play();a.setEffectiveWeight(0);acts[c.name.toLowerCase()]=a});
  return {root,inner,model,mixer,acts};
}
BB.buildRiggedBeast=function(kind){
  if(kind==='wolf'&&store.fox){
    const r=animal('fox',2.0,{mat:m=>tintable(m,0x9a9ea3,1.25)});
    r.kind='gquad';r.loco={idle:r.acts.survey,walk:r.acts.walk,run:r.acts.run};r.loco.idle.setEffectiveWeight(1);return r}
  if(kind==='raven'&&store.parrot){
    const r=animal('parrot',2.2,{mat:m=>{m=m.clone();m.vertexColors=false;m.color=new THREE.Color(0x121218);m.roughness=.55;m.metalness=.15;return m}});
    r.kind='gbird';Object.values(r.acts).forEach(a=>a.setEffectiveWeight(1));return r}
  if(kind==='harpy'&&store.stork){
    const r=animal('stork',3.4,{mat:m=>{m=m.clone();m.color=new THREE.Color(0xd8d8d2);return m}});
    // razorbill crest
    const crest=new THREE.Group();for(let i=0;i<5;i++){const c=new THREE.Mesh(new THREE.ConeGeometry(.03,.32,4),BB.M(0x151515));c.position.set((i-2)*.03,0,0);c.rotation.set(-.9,0,(i-2)*.2);crest.add(c)}
    r.model.add(crest);crest.position.set(0,.35/r.model.scale.x,.9/r.model.scale.x);crest.scale.setScalar(1/r.model.scale.x);
    r.kind='gbird';Object.values(r.acts).forEach(a=>a.setEffectiveWeight(1));return r}
  return null;
};
BB.animRiggedBeast=function(R,st,dt){
  if(R.kind==='gquad'){const l=R.loco,s=st.speed||0;
    const w=Math.min(1,s/1.5),r=Math.max(0,Math.min(1,(s-2.5)/5));
    l.idle.setEffectiveWeight(1-w);l.walk.setEffectiveWeight(w*(1-r));l.run.setEffectiveWeight(w*r);
    l.walk.timeScale=Math.max(.6,s/2.2);l.run.timeScale=Math.max(.7,s/8);
    R.inner.rotation.x=-(st.pounce||0)*.2;R.mixer.update(dt);}
  else if(R.kind==='gbird'){const f=st.flap??1;R.mixer.update(dt*(st.dive?.15:.6+f*.8));R.inner.rotation.z=st.bank||0;R.inner.rotation.x=st.dive?.9:0}
};
})();
