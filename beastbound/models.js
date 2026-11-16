// Beastbound Wilds — hand-built, procedurally animated models.
(function(){
const BB = window.BB = window.BB || {};
const PI=Math.PI;

// ---------- shared helpers ----------
const matCache=new Map();
function M(color,o={}){const k=color+JSON.stringify(o);if(!matCache.has(k))matCache.set(k,new THREE.MeshStandardMaterial(Object.assign({color,roughness:.8,metalness:0},o)));return matCache.get(k)}
BB.M=M;
const geoCache=new Map();
function G(key,fn){if(!geoCache.has(key))geoCache.set(key,fn());return geoCache.get(key)}
// limb: capsule hanging DOWN from its pivot
function limbGeo(r,len){return G('limb'+r.toFixed(3)+len.toFixed(3),()=>{const g=new THREE.CapsuleGeometry(r,len,4,10);g.translate(0,-len/2,0);return g})}
function capGeo(r,len){return G('cap'+r.toFixed(3)+len.toFixed(3),()=>new THREE.CapsuleGeometry(r,len,4,10))}
function sph(r,ws=14,hs=10){return G('s'+r+ws,()=>new THREE.SphereGeometry(r,ws,hs))}
function box(x,y,z){return G('b'+x+y+z,()=>new THREE.BoxGeometry(x,y,z))}
function cyl(a,b,h,s=10){return G('c'+a+b+h+s,()=>new THREE.CylinderGeometry(a,b,h,s))}
function cone(r,h,s=8){return G('k'+r+h+s,()=>new THREE.ConeGeometry(r,h,s))}
function mesh(parent,geo,mat,x=0,y=0,z=0,rx=0,ry=0,rz=0,sx=1,sy=1,sz=1){const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.rotation.set(rx,ry,rz);m.scale.set(sx,sy,sz);m.castShadow=true;parent.add(m);return m}
function grp(parent,x=0,y=0,z=0){const g=new THREE.Group();g.position.set(x,y,z);parent.add(g);return g}
BB.mesh=mesh;BB.grp=grp;

function stripeTex(base,stripe,n=14){const c=document.createElement('canvas');c.width=256;c.height=128;const x=c.getContext('2d');x.fillStyle=base;x.fillRect(0,0,256,128);x.fillStyle=stripe;
  for(let i=0;i<n;i++){const px=i/n*256+Math.random()*6;x.beginPath();x.moveTo(px,0);x.quadraticCurveTo(px+10,40,px-4,70);x.lineTo(px+5,64);x.quadraticCurveTo(px+16,30,px+9,0);x.fill();
    x.beginPath();x.moveTo(px,128);x.quadraticCurveTo(px+8,96,px-2,70);x.lineTo(px+6,74);x.quadraticCurveTo(px+14,100,px+10,128);x.fill()}
  const t=new THREE.CanvasTexture(c);t.encoding=THREE.sRGBEncoding;t.wrapS=t.wrapT=THREE.RepeatWrapping;return t}
function furTex(base,dark,light){const c=document.createElement('canvas');c.width=c.height=128;const x=c.getContext('2d');x.fillStyle=base;x.fillRect(0,0,128,128);
  for(let i=0;i<900;i++){x.strokeStyle=Math.random()<.5?dark:light;x.globalAlpha=.25;x.lineWidth=1;const a=Math.random()*128,b=Math.random()*128;x.beginPath();x.moveTo(a,b);x.lineTo(a+(Math.random()-.5)*3,b+4+Math.random()*4);x.stroke()}
  const t=new THREE.CanvasTexture(c);t.encoding=THREE.sRGBEncoding;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(3,3);return t}
function fur(color,dark,light,extra={}){const k='fur'+color+dark+light;if(!matCache.has(k))matCache.set(k,new THREE.MeshStandardMaterial(Object.assign({color:0xffffff,map:furTex(color,dark,light),roughness:.95},extra)));return matCache.get(k)}

// ======================================================================
// WEAPONS — each built along +Y from the grip at origin
// ======================================================================
const steel=()=>M(0xc9ced3,{metalness:.85,roughness:.28}), darkSteel=()=>M(0x45494f,{metalness:.8,roughness:.35}), leather=()=>M(0x3a2a1e,{roughness:.9}), wood=()=>M(0x5b4130,{roughness:.85});
const W={
  sword(o={}){const g=new THREE.Group();const L=o.len||1.0;mesh(g,cyl(.022,.022,.2,6),leather(),0,0,0);mesh(g,box(.22,.035,.05),darkSteel(),0,.11,0);
    const b=mesh(g,box(.065,L,.012),o.mat||steel(),0,.12+L/2,0);mesh(g,cone(.033,.12,4),o.mat||steel(),0,.12+L+.06,0,0,PI/4,0,1,1,.2);mesh(g,sph(.03),darkSteel(),0,-.11,0);return g},
  greatsword(o={}){const g=W.sword({len:1.45,mat:o.mat});g.children[0].scale.set(1.2,1.8,1.2);g.children[0].position.y=-.08;g.children[2].scale.set(1.4,1,1.4);return g},
  shortsword(){return W.sword({len:.62})},
  shield(o={}){const g=new THREE.Group();const r=o.r||.42;mesh(g,cyl(r,r,.05,24),o.mat||M(0x2b2b2e,{metalness:.6,roughness:.4}),0,0,0,PI/2);mesh(g,new THREE.TorusGeometry(r,.025,6,28),M(0xb08a3a,{metalness:.8,roughness:.3}),0,0,.0);
    if(o.emblem)mesh(g,sph(r*.32,12,8),M(o.emblem,{metalness:.7,roughness:.3}),0,0,.03,0,0,0,1,1,.35);return g},
  segShield(){const g=new THREE.Group();for(let i=0;i<5;i++){mesh(g,box(.16,.7,.04),M(0x4d5560,{metalness:.7,roughness:.35}),(i-2)*.15,0,Math.abs(i-2)*-.03,0,(i-2)*.18,0)}return g},
  axe(o={}){const g=new THREE.Group();const L=o.len||.8;mesh(g,cyl(.022,.026,L,6),wood(),0,L/2-.1,0);const h=new THREE.Shape();h.moveTo(0,0);h.quadraticCurveTo(.22,.05,.26,.2);h.lineTo(.26,-.2);h.quadraticCurveTo(.22,-.05,0,-.08);
    mesh(g,new THREE.ExtrudeGeometry(h,{depth:.02,bevelEnabled:false}),steel(),.02,L-.18,-.01);return g},
  hammer(o={}){const g=new THREE.Group();const L=o.len||1.5;mesh(g,cyl(.028,.032,L,6),wood(),0,L/2-.2,0);mesh(g,box(o.w||.38,.2,.2),darkSteel(),0,L-.2,0);mesh(g,box(.06,.24,.24),M(0xb08a3a,{metalness:.8,roughness:.3}),(o.w||.38)/2,L-.2,0);return g},
  chainHammer(){const g=W.hammer({len:.55,w:.46});for(let i=0;i<5;i++)mesh(g,new THREE.TorusGeometry(.035,.01,4,8),darkSteel(),0,-.12-i*.06,0,0,i%2?PI/2:0,0);return g},
  spear(){const g=new THREE.Group();mesh(g,cyl(.02,.022,2.1,6),wood(),0,.55,0);mesh(g,cone(.05,.32,4),steel(),0,1.75,0);mesh(g,box(.14,.03,.03),M(0xb08a3a,{metalness:.8}),0,1.58,0);return g},
  pistol(o={}){const g=new THREE.Group();mesh(g,box(.04,.12,.05),leather(),0,0,0,.3);mesh(g,box(.045,.06,.24),M(o.c||0x222225,{metalness:.7,roughness:.3}),0,.07,.08);mesh(g,cyl(.012,.012,.08,6),darkSteel(),0,.08,.22,PI/2);return g},
  bow(){const g=new THREE.Group();mesh(g,new THREE.TorusGeometry(.62,.02,5,20,PI*.9),wood(),0,0,0,0,0,PI*.55);mesh(g,cyl(.004,.004,1.15,3),M(0xdddddd),.1,0,0);return g},
  fan(){const g=new THREE.Group();const s=new THREE.Shape();s.moveTo(0,0);s.absarc(0,0,.42,PI*.15,PI*.85,false);s.lineTo(0,0);
    mesh(g,new THREE.ShapeGeometry(s),M(0x18181c,{side:THREE.DoubleSide,metalness:.3,roughness:.5}),0,.02,0,0,0,0);for(let i=0;i<7;i++){const a=PI*.15+i/6*PI*.7;mesh(g,box(.012,.44,.01),darkSteel(),Math.cos(a)*.21,Math.sin(a)*.21,.005,0,0,a-PI/2)}return g},
  mantisBlade(o={}){const g=new THREE.Group();const L=o.ext?1.35:.55;mesh(g,box(.05,.16,.05),darkSteel(),0,0,0);
    const s=new THREE.Shape();s.moveTo(0,0);s.lineTo(.06,0);s.quadraticCurveTo(.09,L*.6,0,L);for(let i=8;i>=0;i--){const y=i/8*L*.9;s.lineTo(-.025,y);s.lineTo(-.045,y-.03)}s.lineTo(0,0);
    const b=mesh(g,new THREE.ExtrudeGeometry(s,{depth:.012,bevelEnabled:false}),M(0x9fb89a,{metalness:.7,roughness:.25}),-.01,.08,-.006);g.userData.blade=b;return g},
  club(){const g=new THREE.Group();mesh(g,cyl(.03,.03,.3,6),leather(),0,0,0);mesh(g,cyl(.09,.05,.75,8),M(0x2a2630,{roughness:.6,metalness:.3}),0,.5,0);return g},
  whip(){const g=new THREE.Group();for(let i=0;i<8;i++)mesh(g,sph(.035-i*.002,6,5),M(0xdedad0,{roughness:.6}),0,-i*.06,0);return g},
  gauntlet(){const g=new THREE.Group();mesh(g,sph(.08,10,8),M(0x8b7a5a,{metalness:.5,roughness:.4}),0,0,0,0,0,0,1.1,1,1.2);mesh(g,new THREE.TorusGeometry(.07,.025,6,10,PI*1.4),M(0xd8c9a0,{roughness:.5}),0,.02,-.03,0,PI/2,0);return g},
  baton(){const g=new THREE.Group();mesh(g,cyl(.025,.025,.6,6),M(0x2b2f33,{metalness:.6}),0,.25,0);mesh(g,cyl(.03,.03,.08,6),M(0x7fb6ff,{emissive:0x7fb6ff,emissiveIntensity:1.4}),0,.55,0);return g},
  cane(){const g=new THREE.Group();mesh(g,cyl(.016,.016,.9,6),M(0x111111,{metalness:.4,roughness:.3}),0,.4,0);mesh(g,sph(.035),M(0xd8d8d8,{metalness:.9,roughness:.2}),0,-.06,0);return g},
};
BB.W=W;

// ======================================================================
// HUMAN
// ======================================================================
const HAIR={
  curls(head,m){for(let i=0;i<46;i++){const u=Math.random(),v=Math.random()*.55;const th=u*PI*2,ph=v*PI*.62;const r=.122;mesh(head,sph(.028,6,5),m,Math.sin(ph)*Math.cos(th)*r,.04+Math.cos(ph)*r*1.05,Math.sin(ph)*Math.sin(th)*r-.008)}},
  durag(head,m){mesh(head,sph(.128,16,10),m,0,.035,-.005,0,0,0,1,.92,1.05);mesh(head,box(.06,.02,.16),m,0,.0,-.18,.7,0,0);mesh(head,box(.05,.015,.14),m,.03,-.05,-.2,1.1,.3,0)},
  short(head,m){mesh(head,sph(.124,16,10,),m,0,.04,-.01,0,0,0,1,.9,1.04)},
  long(head,m){mesh(head,sph(.128,16,10),m,0,.035,-.012,0,0,0,1,.95,1.06);mesh(head,capGeo(.1,.28),m,0,-.1,-.07,.15,0,0,1.15,1,.6)},
  braids(head,m){mesh(head,sph(.125,16,10),m,0,.04,-.01,0,0,0,1,.9,1.04);for(let i=0;i<6;i++)mesh(head,capGeo(.018,.26),m,(i-2.5)*.035,-.08,-.1,.2,0,0)},
  bun(head,m){mesh(head,sph(.124,16,10),m,0,.04,-.01,0,0,0,1,.9,1.04);mesh(head,sph(.06),m,0,.12,-.1)},
  crop(head,m){mesh(head,sph(.122,16,10),m,0,.05,-.01,0,0,0,1,.82,1.02)},
  helm(head,m){mesh(head,sph(.135,18,12),m,0,.02,0,0,0,0,1,1.08,1.1);mesh(head,box(.2,.06,.02),M(0x9fd2ff,{metalness:1,roughness:.05,emissive:0x264a6a,emissiveIntensity:.6}),0,.01,.13)},
};

BB.HAIR=HAIR;
BB.buildHuman=function(o){
  const s=o.scale||1, w=o.build||1;
  const root=new THREE.Group(), B={root};
  const skin=M(o.skin,{roughness:.6}), top=M(o.top,{roughness:.85}), pants=M(o.pants,{roughness:.9}), boots=M(o.boots||0x2a2420,{roughness:.7});
  const body=B.body=grp(root,0,0,0); body.scale.setScalar(s);
  const hips=B.hips=grp(body,0,.98,0);
  mesh(hips,sph(.17),pants,0,0,0,0,0,0,1.15*w,.75,.85);
  mesh(hips,new THREE.TorusGeometry(.17,.025,6,18),M(o.belt||0x2a1f17),0,.05,0,PI/2,0,0,1.12*w,1,.85);
  const spine=B.spine=grp(hips,0,.06,0);
  mesh(spine,capGeo(.165,.26),top,0,.2,0,0,0,0,1.18*w,1,.82);
  const chest=B.chest=grp(spine,0,.4,0);
  mesh(chest,sph(.19),top,0,-.02,0,0,0,0,1.22*w,.85,.85);
  if(o.coat) mesh(spine,cyl(.21*w,.27*w,.5,12,),M(o.coat,{roughness:.9,side:THREE.DoubleSide}),0,-.04,0);
  mesh(chest,capGeo(.055,.06),skin,0,.16,0);
  const head=B.head=grp(chest,0,.29,0);
  mesh(head,sph(.115,18,14),skin,0,0,0,0,0,0,.95,1.1,1.02);
  mesh(head,sph(.075,12,8),skin,0,-.065,.035,0,0,0,1,.75,1);
  const eyeM=o.eyeGlow?M(o.eye,{emissive:o.eye,emissiveIntensity:1.6}):M(o.eye||0x2a1d14,{roughness:.2});
  mesh(head,sph(.026,8,6),M(0xf2f2ee),-.042,.012,.092);mesh(head,sph(.026,8,6),M(0xf2f2ee),.042,.012,.092);
  mesh(head,sph(.015,8,6),eyeM,-.042,.012,.112);mesh(head,sph(.015,8,6),eyeM,.042,.012,.112);
  mesh(head,box(.03,.05,.03),skin,0,-.02,.113,-.25);
  mesh(head,sph(.025,6,6),skin,-.115,0,0,0,0,0,.6,1,1);mesh(head,sph(.025,6,6),skin,.115,0,0,0,0,0,.6,1,1);
  mesh(head,box(.08,.012,.02),M(0x5a3a32),0,-.068,.098);
  if(o.hair)HAIR[o.hair](head,M(o.hairC||0x161210,{roughness:.95}));
  if(o.beard)mesh(head,sph(.09,12,8),M(o.hairC||0x161210,{roughness:.95}),0,-.085,.03,0,0,0,1,.7,.9);
  // arms
  ['L','R'].forEach((sd,i)=>{const sx=i?1:-1;
    const sh=B['sh'+sd]=grp(chest,sx*.215*w,.06,0);
    const cyber=o.cyberArm===sd;
    const am=cyber?M(0x3a3f46,{metalness:.85,roughness:.3}):(o.sleeves===false?skin:top);
    mesh(sh,sph(.07),cyber?am:top,0,0,0);
    mesh(sh,limbGeo(.058*w,.2),am,0,0,0);
    const el=B['el'+sd]=grp(sh,0,-.29,0);
    const fm=cyber?am:(o.sleeves==='long'?top:skin);
    mesh(el,limbGeo(.05,.19),fm,0,0,0);
    if(cyber){for(let k=0;k<3;k++)mesh(el,new THREE.TorusGeometry(.053,.006,4,14),M(0x7fd8ff,{emissive:0x5fc8ff,emissiveIntensity:2}),0,-.05-k*.06,0,PI/2);
      mesh(sh,new THREE.TorusGeometry(.06,.006,4,14),M(0x7fd8ff,{emissive:0x5fc8ff,emissiveIntensity:2}),0,-.12,0,PI/2)}
    if(o.wraps)mesh(el,limbGeo(.054,.12),M(o.wraps,{roughness:.9}),0,-.1,0);
    const hd=B['hand'+sd]=grp(el,0,-.27,0);
    mesh(hd,sph(.048,10,8),cyber?am:skin,0,-.02,.0,0,0,0,.9,1.15,.75);
    B['grip'+sd]=grp(hd,0,-.045,.02);B['grip'+sd].rotation.x=PI/2;
  });
  // legs
  ['L','R'].forEach((sd,i)=>{const sx=i?1:-1;
    const th=B['th'+sd]=grp(hips,sx*.1*w,-.03,0);
    mesh(th,limbGeo(.078*w,.3),pants,0,0,0);
    const kn=B['kn'+sd]=grp(th,0,-.44,0);
    mesh(kn,limbGeo(.062,.31),pants,0,0,0);
    const ft=B['ft'+sd]=grp(kn,0,-.45,0);
    mesh(ft,box(.11,.09,.25),boots,0,-.02,.05);
    mesh(kn,limbGeo(.066,.12),boots,0,-.3,0);
  });
  if(o.skirt){for(let k=0;k<8;k++){const a=k/8*PI*2;mesh(hips,box(.13,.36,.025),M(o.skirt,{metalness:.5,roughness:.45}),Math.sin(a)*.2*w,-.2,Math.cos(a)*.17,-.15*Math.cos(a),a,0)}}
  // sockets for stowed gear
  B.back=grp(chest,0,0,-.17); B.hipL=grp(hips,-.2*w,0,.02); B.hipR=grp(hips,.2*w,0,.02);
  B.thighL=grp(B.thL,-.085,-.15,0); B.thighR=grp(B.thR,.085,-.15,0);
  root.traverse(m=>{if(m.isMesh){m.castShadow=true}});
  return {root,B,height:1.82*s,scale:s,mantle:null};
};

// Mantle: animal-themed armor manifested through an Accord
BB.buildMantle=function(h,o){
  const B=h.B, g=[], base=M(o.mantle,{metalness:.75,roughness:.32}), glow=M(o.glow,{emissive:o.glow,emissiveIntensity:1.8,roughness:.4});
  const add=(parent,geo,mat,...a)=>{const m=mesh(parent,geo,mat,...a);g.push(m);return m};
  add(B.chest,sph(.21),base,0,0,.03,0,0,0,1.25,.9,.85);
  add(B.chest,box(.2,.025,.02),glow,0,.04,.2);
  add(B.spine,box(.3,.18,.3),base,0,.12,0,0,0,0,1,1,1);
  ['L','R'].forEach((sd,i)=>{const sx=i?1:-1;
    add(B['sh'+sd],sph(.11,12,8,),base,sx*.02,.03,0,0,0,sx*.3,1.1,.8,1.1);
    add(B['el'+sd],cyl(.064,.058,.16,10),base,0,-.11,0);
    add(B['el'+sd],new THREE.TorusGeometry(.064,.008,4,14),glow,0,-.04,0,PI/2);
    add(B['kn'+sd],cyl(.075,.068,.24,10),base,0,-.2,.0);
    add(B['th'+sd],sph(.09,10,8),base,0,-.14,.05,0,0,0,1,1.4,.7);
  });
  const hm=add(B.head,sph(.135,18,12),base,0,.025,-.005,0,0,0,1,1.06,1.1);
  add(B.head,box(.18,.03,.02),glow,0,.015,.135);
  const k=o.mantleKind;
  if(k==='lion'){ // Ninefold Crown: nine crown segments + nine luminous mane-streamers
    for(let i=0;i<9;i++){const a=(i-4)*.32;add(B.head,cone(.025,.12,4),M(0xd9b45a,{metalness:.9,roughness:.25,emissive:0x7a5410,emissiveIntensity:.6}),Math.sin(a)*.12,.14+Math.cos(a)*.02,Math.cos(a)*.03-.02,-.2*Math.cos(a),0,-a*.6);
      add(B.head,box(.012,.34,.006),M(0xffe6a8,{emissive:0xffd27a,emissiveIntensity:1.6,transparent:true,opacity:.8}),Math.sin(a)*.13,-.07,-.1-Math.cos(a)*.03,.35,a*.4,0)}
  } else if(k==='horn'){for(const sx of[-1,1])add(B.head,new THREE.TorusGeometry(.08,.025,6,12,PI*1.3),M(0xd8c9a0),sx*.12,.06,-.02,0,PI/2,0)}
  else if(k==='ears'){for(const sx of[-1,1])add(B.head,cone(.04,.12,4),base,sx*.08,.15,-.02,0,0,sx*-.25)}
  else if(k==='round'){for(const sx of[-1,1])add(B.head,sph(.04),base,sx*.1,.12,-.02)}
  else if(k==='crest'){for(let i=0;i<5;i++)add(B.head,box(.012,.12-i*.012,.06),glow,0,.14-i*.01,-.02-i*.05,-.2-i*.12)}
  else if(k==='mantis'){for(const sx of[-1,1])add(B.head,cyl(.006,.006,.3,3),glow,sx*.05,.2,.06,-.6,0,sx*.3)}
  else if(k==='hood'){add(B.head,sph(.15,14,10),M(0x101015,{roughness:.9,side:THREE.DoubleSide}),0,.03,-.03,0,0,0,1,1.05,1.12)}
  g.forEach(m=>{m.visible=false;m.userData.baseScale=m.scale.clone()});
  h.mantle=g;
};

// ======================================================================
// BEASTS
// ======================================================================
// Generic quadruped
BB.buildQuad=function(sp){
  const root=new THREE.Group(), R={root,sp};
  const body=R.body=grp(root,0,sp.h,0);
  const furM=sp.mat||M(sp.color,{roughness:.95});
  const belly=M(sp.belly||sp.color,{roughness:.95});
  const L=sp.len, gr=sp.girth;
  const torso=mesh(body,capGeo(gr,L),furM,0,0,0,PI/2,0,0,1,1,sp.flat||1);
  mesh(body,sph(gr*1.12),furM,0,gr*.08*(sp.hump||1),L*.42,0,0,0,1,1.05*(sp.hump||1),1);
  mesh(body,sph(gr*1.02),furM,0,0,-L*.42);
  mesh(body,capGeo(gr*.75,L*.8),belly,0,-gr*.35,0,PI/2,0,0,1,.6,1);
  // legs
  R.legs=[];
  const fl=sp.frontLeg||1, bl=sp.backLeg||1;
  [[-1,1],[1,1],[-1,-1],[1,-1]].forEach(([sx,sz],i)=>{
    const front=sz>0, k=front?fl:bl;
    const hip=grp(body,sx*gr*.62,-gr*.25,sz*L*.44);
    const up=sp.h*.5*k, lo=sp.h*.5*k;
    mesh(hip,limbGeo(sp.legR*1.25,up*.75),furM,0,0,0);
    const knee=grp(hip,0,-up,0);
    mesh(knee,limbGeo(sp.legR,lo*.7),furM,0,0,0);
    const paw=mesh(knee,sph(sp.legR*1.35,10,6),sp.pawMat||furM,0,-lo+sp.legR*.6,sp.legR*.5,0,0,0,1,.6,1.4);
    if(sp.hoof)paw.material=M(0x2a2420,{roughness:.5});
    R.legs.push({hip,knee,front,phase:(i===0||i===3)?0:PI,up});
  });
  // neck & head
  const neck=R.neck=grp(body,0,gr*.35,L*.5+gr*.4);
  neck.rotation.x=-(sp.neckTilt??.6);
  mesh(neck,capGeo(gr*.6,sp.neckLen||gr*.6),furM,0,(sp.neckLen||gr*.6)*.4,0);
  const head=R.head=grp(neck,0,(sp.neckLen||gr*.6)*.9+gr*.2,gr*.1);
  head.rotation.x=(sp.neckTilt??.6)*.9;
  const hr=sp.headR||gr*.55;
  mesh(head,sph(hr,16,12),furM,0,0,0,0,0,0,1,.92,1.05);
  const mz=sp.muzzle||1;
  mesh(head,capGeo(hr*.55,hr*.7*mz),furM,0,-hr*.25,hr*.75*mz,PI/2,0,0,1.1,1,.85);
  mesh(head,sph(hr*.18,8,6),M(0x151515,{roughness:.4}),0,-hr*.12,hr*(1.15+.4*(mz-1)));
  const jaw=R.jaw=grp(head,0,-hr*.45,hr*.2);
  mesh(jaw,capGeo(hr*.4,hr*.6*mz),sp.belly?belly:furM,0,0,hr*.5*mz,PI/2,0,0,1,.7,1);
  const eL=sp.eyes?.[0]??0x2a1a0a, eR=sp.eyes?.[1]??eL;
  [[-1,eL],[1,eR]].forEach(([sx,c])=>{const glow=sp.eyeGlow&&(c!==0xdddddd);mesh(head,sph(hr*.13,8,6),glow?M(c,{emissive:c,emissiveIntensity:2.2}):M(c,{roughness:.15}),sx*hr*.45,hr*.18,hr*.75)});
  if(sp.ears==='round')[-1,1].forEach(sx=>mesh(head,sph(hr*.28,8,6),furM,sx*hr*.62,hr*.7,-hr*.1,0,0,0,1,1,.5));
  if(sp.ears==='point')[-1,1].forEach(sx=>mesh(head,cone(hr*.25,hr*.75,4),furM,sx*hr*.5,hr*.95,-hr*.05,0,0,sx*-.2));
  if(sp.sabers)[-1,1].forEach(sx=>mesh(head,cone(hr*.07,hr*.95,6),M(0xf0ebdf,{roughness:.3}),sx*hr*.22,-hr*.75,hr*.95,PI,0,0));
  if(sp.mane){const mm=M(sp.mane,{roughness:1});for(let i=0;i<38;i++){const a=i/38*PI*2;const r=hr*1.1;mesh(head,cone(hr*.42,hr*1.3,5),mm,Math.cos(a)*r*.9,Math.sin(a)*r*.95-hr*.05,-hr*.35,-PI/2+Math.sin(a)*.4,0,-a+PI/2,1,1,1)}
    for(let i=0;i<10;i++)mesh(neck,sph(gr*.62,8,6),mm,0,i*.08*gr,-gr*.1+i*.02,0,0,0,1.25,1,1.1)}
  if(sp.horns==='curl')[-1,1].forEach(sx=>{const h=mesh(head,new THREE.TorusGeometry(hr*.5,hr*.17,8,16,PI*1.6),M(0xcdbd98,{roughness:.6}),sx*hr*.75,hr*.35,-hr*.2,0,sx*PI/2,PI*.15)});
  if(sp.horns==='dragon')[-1,1].forEach(sx=>{mesh(head,cone(hr*.16,hr*1.4,6),M(0x2b2a28,{roughness:.4}),sx*hr*.45,hr*.75,-hr*.55,-1.1,0,sx*-.25)});
  // tail
  R.tail=[];let prev=grp(body,0,gr*.2,-L*.5-gr*.6);prev.rotation.x=sp.tailLift??-.9;
  const tn=sp.tailSegs||5, tl=sp.tailLen||L*.8;
  for(let i=0;i<tn;i++){const r=(sp.tailR||gr*.15)*(1-i/tn*.6);mesh(prev,limbGeo(r,tl/tn),furM,0,0,0);R.tail.push(prev);const n=grp(prev,0,-tl/tn,0);prev=n}
  if(sp.tuft)mesh(prev,sph((sp.tailR||gr*.15)*1.8,8,6),M(sp.tuft,{roughness:1}),0,0,0);
  if(sp.spikes){for(let i=0;i<9;i++)mesh(body,cone(gr*.12,gr*.45,4),M(sp.spikes,{roughness:.5}),0,gr*.95,L*.45-i*L*.11)}
  if(sp.wings){R.wings=[-1,1].map(sx=>{const wg=grp(body,sx*gr*.7,gr*.75,L*.15);const shape=new THREE.Shape();const S=sp.wings;
      shape.moveTo(0,0);shape.lineTo(S,S*.15);shape.lineTo(S*.95,-S*.15);shape.lineTo(S*.75,-S*.05);shape.lineTo(S*.6,-S*.45);shape.lineTo(S*.45,-S*.12);shape.lineTo(S*.25,-S*.5);shape.lineTo(S*.12,-S*.1);shape.lineTo(0,-S*.3);
      const m=mesh(wg,new THREE.ShapeGeometry(shape),M(sp.wingC||sp.color,{side:THREE.DoubleSide,roughness:.8}),0,0,0,PI/2,0,0,sx,1,1);
      mesh(wg,cyl(gr*.06,gr*.04,S,6),furM,sx*S/2,0,S*.07,0,0,PI/2);
      return wg})}
  if(sp.mech){root.traverse(m=>{if(m.isMesh&&m.material===furM)m.material=M(0x8d9298,{metalness:.8,roughness:.35})})}
  root.traverse(m=>{if(m.isMesh)m.castShadow=true});
  R.kind='quad'; R.stride=sp.h*1.6; return R;
};

// Bird (raven / razorbill-harpy)
BB.buildBird=function(sp){
  const root=new THREE.Group(),R={root,sp,kind:'bird'};
  const body=R.body=grp(root,0,0,0); const s=sp.size;
  const f=M(sp.color,{roughness:.8}), bel=M(sp.belly||sp.color,{roughness:.8});
  mesh(body,sph(s*.3,14,10),f,0,0,0,0,0,0,1,.9,1.7);
  mesh(body,sph(s*.24,12,8),bel,0,-s*.08,s*.1,0,0,0,1,.8,1.4);
  const head=R.head=grp(body,0,s*.18,s*.5);
  mesh(head,sph(s*.17,12,10),f,0,0,0);
  mesh(head,cone(s*.07,s*.32,6),M(sp.beak||0x222222,{roughness:.4}),0,-s*.03,s*.24,PI/2);
  [-1,1].forEach(sx=>mesh(head,sph(s*.03,6,6),M(sp.eye||0x111111,{emissive:sp.eye||0,emissiveIntensity:sp.eye?1.5:0}),sx*s*.11,s*.04,s*.1));
  if(sp.crest)for(let i=0;i<7;i++)mesh(head,cone(s*.035,s*.3,4),M(sp.crest),(i-3)*s*.035,s*.17,-s*.06,-.6,0,(i-3)*.15);
  const tail=grp(body,0,0,-s*.45);for(let i=0;i<5;i++)mesh(tail,box(s*.07,s*.01,s*.4),f,(i-2)*s*.06,0,-s*.18,0,(i-2)*.12,0);
  R.wings=[-1,1].map(sx=>{const wg=grp(body,sx*s*.2,s*.08,s*.05);const inner=grp(wg,0,0,0);
    for(let i=0;i<7;i++){mesh(inner,box(s*.22,s*.02,s*(.55-i*.03)),i>4?f:(sp.wingInner?M(sp.wingInner):f),sx*(s*.12+i*s*.2),0,-i*s*.04,0,sx*-i*.05,0)}
    const tip=grp(inner,sx*s*1.4,0,-s*.25);for(let i=0;i<5;i++)mesh(tip,box(s*.05,s*.01,s*.6),f,sx*i*s*.08,0,-s*.15,0,sx*(-.3+i*.12),0);
    return wg});
  [-1,1].forEach(sx=>{const leg=grp(body,sx*s*.12,-s*.22,s*.05);mesh(leg,limbGeo(s*.03,s*.18),M(sp.talon||0x2b2b2b),0,0,0)});
  root.traverse(m=>{if(m.isMesh)m.castShadow=true});
  return R;
};

// Snake
BB.buildSnake=function(sp){
  const root=new THREE.Group(),R={root,sp,kind:'snake',segs:[]};
  const n=sp.segs||30, r=sp.r;
  const tex=stripeTex('#3d4a2a','#1b2213',10); tex.repeat.set(1,1);
  const m1=M(0xffffff,{map:tex,roughness:.5,metalness:.1}), m2=M(sp.belly||0xb0a37a,{roughness:.6});
  for(let i=0;i<n;i++){const rr=r*(i<3?.85+i*.05:1-Math.max(0,(i-n*.6)/(n*.4))*.8);const sg=new THREE.Group();mesh(sg,sph(rr,12,8),m1,0,rr,0,0,0,0,1,.85,1.5);mesh(sg,sph(rr*.9,10,6),m2,0,rr*.55,0,0,0,0,1,.5,1.4);root.add(sg);R.segs.push(sg)}
  const head=R.head=R.segs[0];
  mesh(head,sph(r*1.2,14,10),m1,0,r*1.1,r*.6,0,0,0,1,.7,1.6);
  [-1,1].forEach(sx=>{mesh(head,sph(r*.2,8,6),M(0xd8b13a,{emissive:0x9a7a10,emissiveIntensity:1}),sx*r*.65,r*1.4,r*1.3);mesh(head,cone(r*.07,r*.5,5),M(0xf2efe6),sx*r*.3,r*.7,r*2.2,PI*.9,0,0)});
  root.traverse(m=>{if(m.isMesh)m.castShadow=true});
  R.spacing=r*1.6; R.trail=[];
  return R;
};

// Mantis
BB.buildMantis=function(sp){
  const root=new THREE.Group(),R={root,sp,kind:'mantis',legs:[]};
  const g=M(0x5d7a3a,{roughness:.55,metalness:.1}),g2=M(0x8aa25a,{roughness:.6});
  const body=R.body=grp(root,0,1.3,0);
  mesh(body,capGeo(.22,1.3),g,0,-.1,-.9,PI/2-.25,0,0,1,1,.9);
  const thorax=R.thorax=grp(body,0,0,0);thorax.rotation.x=-.9;
  mesh(thorax,capGeo(.12,.9),g2,0,.5,0);
  const head=R.head=grp(thorax,0,1.05,0);
  mesh(head,new THREE.ConeGeometry(.2,.32,3),g,0,0,.05,PI/2+.3,0,0,1,1,.6);
  [-1,1].forEach(sx=>{mesh(head,sph(.08,10,8),M(0x2b3d1a,{roughness:.1,metalness:.4}),sx*.15,.05,0);mesh(head,cyl(.008,.004,.6,3),g,sx*.05,.32,.05,-.4,0,sx*.25)});
  R.arms=[-1,1].map(sx=>{const a=grp(thorax,sx*.14,.8,.05);mesh(a,limbGeo(.06,.5),g2,0,0,0);const f=grp(a,0,-.62,0);
    for(let i=0;i<6;i++)mesh(f,cone(.02,.08,3),M(0xd8e2b0),0,-.08-i*.08,.05,-PI/2);mesh(f,limbGeo(.045,.55),g,0,0,0);return {a,f}});
  [[-1,.3],[1,.3],[-1,-.5],[1,-.5]].forEach(([sx,z],i)=>{const hip=grp(body,sx*.15,-.1,z);hip.rotation.z=sx*.9;mesh(hip,limbGeo(.03,.7),g,0,0,0);const k=grp(hip,0,-.78,0);k.rotation.z=-sx*1.6;mesh(k,limbGeo(.025,.85),g,0,0,0);R.legs.push({hip,k,sx,phase:i%3?PI:0})});
  root.traverse(m=>{if(m.isMesh)m.castShadow=true});
  return R;
};

// Kangaroo (biped hopper)
BB.buildKangaroo=function(sp){
  const root=new THREE.Group(),R={root,sp,kind:'roo'};
  const f=fur('#9b6b46','#6d4a30','#c49a74'), b=M(0xd9c0a0,{roughness:.95});
  const body=R.body=grp(root,0,1.05,0);body.rotation.x=.35;
  mesh(body,capGeo(.32,.7),f,0,.2,0);mesh(body,sph(.3),b,0,.15,.12,0,0,0,.9,1.2,.7);mesh(body,sph(.4),f,0,-.25,-.05);
  const head=R.head=grp(body,0,.85,.05);head.rotation.x=-.35;
  mesh(head,sph(.16,12,10),f,0,0,0);mesh(head,capGeo(.09,.18),f,0,-.04,.18,PI/2-.2);mesh(head,sph(.035),M(0x111111),0,-.02,.33);
  [-1,1].forEach(sx=>{mesh(head,cone(.07,.28,5),f,sx*.09,.22,-.05,0,0,sx*-.25);mesh(head,sph(.025,6,6),M(0x111111,{roughness:.1}),sx*.09,.03,.13)});
  R.arms=[-1,1].map(sx=>{const a=grp(body,sx*.2,.45,.18);a.rotation.x=-.6;mesh(a,limbGeo(.05,.32),f,0,0,0);return a});
  R.legs=[-1,1].map(sx=>{const th=grp(body,sx*.24,-.3,0);mesh(th,limbGeo(.15,.35),f,0,0,0);const kn=grp(th,0,-.48,0);mesh(kn,limbGeo(.07,.4),f,0,0,0);const ft=grp(kn,0,-.5,0);mesh(ft,box(.13,.07,.55),f,0,0,.2);return {th,kn,ft}});
  R.tail=grp(body,0,-.45,-.25);R.tail.rotation.x=-2.1;mesh(R.tail,limbGeo(.12,1.1),f,0,0,0);
  root.traverse(m=>{if(m.isMesh)m.castShadow=true});root.scale.setScalar(sp.scale||1.2);
  return R;
};

// Gorilla (knuckle-walker)
BB.buildGorilla=function(sp){
  const R=BB.buildQuad(Object.assign({len:.9,h:1.15,girth:.62,legR:.15,frontLeg:1.35,backLeg:.75,neckLen:.15,neckTilt:.1,headR:.32,muzzle:.7,ears:'round',tailSegs:0,tailLen:.01,hump:1.3,
    mat:fur('#151515','#0a0a0a','#2c2c2c'),belly:0x262626,eyes:[0x3a2a14]},sp));
  R.body.rotation.x=-.45; R.kind='quad'; R.gorilla=true;
  return R;
};

// ---------- beast catalog ----------
BB.BEASTS={
  lion:()=>BB.buildQuad({len:2.2,h:1.55,girth:.72,legR:.16,headR:.48,muzzle:1.05,neckLen:.4,ears:'round',sabers:true,mane:0x0d0d0f,tuft:0x0a0a0a,tailLen:1.7,tailR:.08,
    mat:fur('#1b1b1e','#0c0c0d','#34343a'),belly:0x232326,eyes:[0x7fe4ff,0xdddddd],eyeGlow:true}),
  tiger:()=>{const t=stripeTex('#c9752c','#1a120c',16);t.repeat.set(2,1);return BB.buildQuad({len:1.6,h:1.1,girth:.5,legR:.11,headR:.36,ears:'round',tailLen:1.3,tailR:.06,mat:M(0xffffff,{map:t,roughness:.9}),belly:0xece2cf,eyes:[0xd4a20c]})},
  panther:()=>BB.buildQuad({len:1.4,h:.95,girth:.4,legR:.09,headR:.3,ears:'round',tailLen:1.4,tailR:.05,mat:fur('#111114','#050506','#222230'),belly:0x16161a,eyes:[0x9b7bff],eyeGlow:true}),
  wolf:()=>BB.buildQuad({len:1.3,h:1.05,girth:.38,legR:.085,headR:.28,muzzle:1.45,ears:'point',tailLen:.9,tailR:.1,tailLift:-1.2,mat:fur('#6c6f73','#3e4044','#a5a8ab'),belly:0xc8c9c6,eyes:[0xe8c24a],eyeGlow:true}),
  bear:()=>BB.buildQuad({len:1.6,h:1.25,girth:.72,legR:.19,headR:.4,muzzle:1.1,ears:'round',tailSegs:1,tailLen:.15,tailR:.12,hump:1.25,mat:fur('#2a1f18','#140f0b','#40312a'),belly:0x2e241d}),
  ram:()=>BB.buildQuad({len:1.1,h:.95,girth:.46,legR:.08,headR:.28,muzzle:1.1,horns:'curl',ears:'none',hoof:true,tailSegs:1,tailLen:.15,mat:fur('#8a7458','#5d4c38','#b8a284'),belly:0xd6c9b1}),
  gorilla:()=>BB.buildGorilla({}),
  dragon:()=>BB.buildQuad({len:4.2,h:2.6,girth:1.15,legR:.3,headR:.7,muzzle:1.6,neckLen:1.8,neckTilt:.9,horns:'dragon',ears:'none',tailLen:5.5,tailSegs:8,tailR:.38,tailLift:-1.35,spikes:0x2c2a28,wings:6.5,
    mat:M(0x46525e,{roughness:.55,metalness:.15}),belly:0x8a8370,wingC:0x323a44,eyes:[0xffb43a],eyeGlow:true}),
  raven:()=>BB.buildBird({size:1.1,color:0x0b0b10,beak:0x1a1a1a,eye:0x9fd8ff}),
  harpy:()=>BB.buildBird({size:1.7,color:0x111214,belly:0xeeeeea,wingInner:0xe8e8e2,beak:0x2a2622,crest:0xdedad0,eye:0xffcf5a,talon:0xc9b04a}),
  snake:()=>BB.buildSnake({r:.42,segs:34,belly:0xb8ab7e}),
  mantis:()=>BB.buildMantis({}),
  kangaroo:()=>BB.buildKangaroo({scale:1.25}),
  sentinel:()=>BB.buildQuad({len:1.6,h:1.2,girth:.55,legR:.12,headR:.3,muzzle:1.3,ears:'none',tailSegs:0,tailLen:.01,mech:true,mat:M(0x8d9298,{metalness:.8,roughness:.35}),belly:0x5a5f66,eyes:[0xff3a2a],eyeGlow:true}),
};

// ======================================================================
// ANIMATION
// ======================================================================
const lerp=(a,b,t)=>a+(b-a)*t;
BB.animHuman=function(h,st,dt){
  const B=h.B; st.phase=(st.phase||0)+dt*Math.min(st.speed,14)*1.15/(h.scale||1);
  const run=Math.min(1,st.speed/6), walk=Math.min(1,st.speed/1.5);
  const p=st.phase, a=(.45+.45*run)*walk;
  const air=!st.grounded;
  let thL=Math.sin(p)*a, thR=-Math.sin(p)*a;
  let knL=Math.max(0,-Math.sin(p-.6))*a*1.6+.05, knR=Math.max(0,Math.sin(p-.6))*a*1.6+.05;
  if(air){thL=-.7;thR=.25;knL=1.2;knR=.4}
  B.thL.rotation.x=lerp(B.thL.rotation.x,-thL,.35);B.thR.rotation.x=lerp(B.thR.rotation.x,-thR,.35);
  B.knL.rotation.x=lerp(B.knL.rotation.x,knL,.35);B.knR.rotation.x=lerp(B.knR.rotation.x,knR,.35);
  B.hips.position.y=.98-Math.abs(Math.cos(p))*.05*walk-(air?.05:0);
  B.spine.rotation.x=lerp(B.spine.rotation.x,.12*run+(st.attackT>=0?.15:0),.2);
  B.chest.rotation.y=Math.sin(p)*.12*walk;
  const breathe=Math.sin(performance.now()*.002)*.015;
  B.chest.scale.set(1,1+breathe,1);
  // arms
  let shL=-Math.sin(p)*a*.9,shR=Math.sin(p)*a*.9,elL=-.25-.5*run,elR=-.25-.5*run,shLz=-.08,shRz=.08,shRy=0,shLy=0;
  if(air){shL=-1.2;shR=-1.2;shLz=-.5;shRz=.5}
  if(st.block){shL=-1.3;elL=-1.2;shLy=.6}
  if(st.aim){shR=-1.5;elR=0;shRy=-.1; if(st.aimBoth){shL=-1.5;elL=0;shLy=.1}}
  if(st.cast>0){shL=shR=-2.8;shLz=-.3;shRz=.3;elL=elR=-.2}
  if(st.attackT>=0){const t=st.attackT,k=st.attackKind;
    if(k==='thrust'){const e=t<.35?t/.35:1-(t-.35)/.65;shR=-.4-1.2*e;elR=-1.4+1.4*e;B.chest.rotation.y=-.5*e}
    else if(k==='smash'){const e=t<.4?t/.4:1;const d=t<.4?0:Math.min(1,(t-.4)/.25);shR=shL=-2.9+2.6*d;elR=elL=-.3;B.spine.rotation.x=.4*d}
    else if(k==='spin'){B.root.children[0].rotation.y=t*PI*2;shR=-1.5;shRz=1.2;shL=-1.5;shLz=-1.2;elR=elL=0}
    else if(k==='clap'){const e=t<.5?t/.5:1;shL=shR=-1.5;elL=elR=-.2;shLy=-.9+1.2*e;shRy=.9-1.2*e}
    else if(k==='shoot'){shR=-1.55;elR=0;if(st.aimBoth){shL=-1.55;elL=0}}
    else{const e=t<.3?t/.3:1;const d=t<.3?0:Math.min(1,(t-.3)/.3);const sgn=st.combo%2?-1:1;
      shR=-2.3*e+2.6*d-.3;elR=-.6+ .5*d;shRy=sgn*(-.6+1.4*d);B.chest.rotation.y=sgn*(.5-1.1*d);
      if(st.dual){shL=shR;elL=elR;shLy=-shRy}}
  } else if(B.root.children[0])B.root.children[0].rotation.y=0;
  const k=.3;
  B.shL.rotation.x=lerp(B.shL.rotation.x,shL,k);B.shR.rotation.x=lerp(B.shR.rotation.x,shR,k);
  B.shL.rotation.z=lerp(B.shL.rotation.z,shLz,k);B.shR.rotation.z=lerp(B.shR.rotation.z,shRz,k);
  B.shL.rotation.y=lerp(B.shL.rotation.y,shLy,k);B.shR.rotation.y=lerp(B.shR.rotation.y,shRy,k);
  B.elL.rotation.x=lerp(B.elL.rotation.x,elL,k);B.elR.rotation.x=lerp(B.elR.rotation.x,elR,k);
  B.head.rotation.x=-B.spine.rotation.x*.6;
};

BB.animBeast=function(R,st,dt,t){
  const sp=R.sp;
  if(R.kind==='quad'){
    st.phase=(st.phase||0)+dt*st.speed/R.stride*PI*1.4;
    const mv=Math.min(1,st.speed/1.2), run=Math.min(1,st.speed/7);
    R.legs.forEach(l=>{const p=st.phase+l.phase+(run>.5&&!l.front?.8:0);const a=(.45+.25*run)*mv;
      l.hip.rotation.x=Math.sin(p)*a; l.knee.rotation.x=(l.front?-1:1)*Math.max(0,Math.sin(p+(l.front?-1:1)))*a*1.3+(l.front?0:-.1)});
    R.body.position.y=sp.h+(R.gorilla?-.1:0)-Math.abs(Math.cos(st.phase))*.05*mv*sp.h-(st.crouch||0)*sp.h*.25;
    if(!R.gorilla)R.body.rotation.x=Math.sin(st.phase*2)*.03*run-(st.pounce||0)*.25;
    R.neck.rotation.y=Math.sin(t*.4+R.root.id)*.25*(1-mv);
    R.tail.forEach((s,i)=>{s.rotation.z=Math.sin(t*2+i*.6)*(.15+.1*mv);if(i>0)s.rotation.x=.15});
    if(R.jaw)R.jaw.rotation.x=(st.roar||0)*.6+Math.max(0,Math.sin(t*.7+R.root.id))*.05;
    if(R.wings){const open=st.wingsOpen||0;R.wings.forEach((w,i)=>{const sx=i?1:-1;w.rotation.z=sx*lerp(-1.2,.15+Math.sin(t*6)*.5*(st.flap||0),open);w.rotation.y=sx*lerp(.9,0,open)})}
  } else if(R.kind==='bird'){
    const f=st.flap??1;R.wings.forEach((w,i)=>{const sx=i?1:-1;w.rotation.z=sx*(Math.sin(t*(4+f*4))*.7*f+(1-f)*-.2)+(st.dive?sx*-.9:0)});
    R.body.rotation.z=st.bank||0;R.body.rotation.x=st.dive?.9:(st.pitch||0);
  } else if(R.kind==='snake'){
    // segments follow a breadcrumb trail of the head
    const tr=R.trail; const hp=R.root.userData.headPos;
    if(!tr.length||tr[0].distanceToSquared(hp)>.04){tr.unshift(hp.clone());if(tr.length>R.segs.length*8)tr.pop()}
    let acc=0,j=0;R.segs.forEach((sg,i)=>{const want=i*R.spacing;while(j<tr.length-1&&acc+tr[j].distanceTo(tr[j+1])<want){acc+=tr[j].distanceTo(tr[j+1]);j++}
      const a=tr[j]||hp,b=tr[j+1]||a;const seg=a.distanceTo(b)||1;const k=Math.min(1,(want-acc)/seg);
      const wx=a.x+(b.x-a.x)*k,wz=a.z+(b.z-a.z)*k;const sw=Math.sin(t*4-i*.5)*.18*Math.min(1,st.speed/2);
      sg.position.set(wx-R.root.position.x+sw*Math.cos(st.yaw||0),BB.height(wx,wz)-R.root.position.y+(i===0?(st.rear||0):0),wz-R.root.position.z-sw*Math.sin(st.yaw||0));
      if(i>0){const p=R.segs[i-1].position;sg.rotation.y=Math.atan2(p.x-sg.position.x,p.z-sg.position.z)}});
    R.segs[0].rotation.y=(st.yaw||0)-R.root.rotation.y;
  } else if(R.kind==='mantis'){
    st.phase=(st.phase||0)+dt*st.speed*2.4;const mv=Math.min(1,st.speed/1);
    R.legs.forEach(l=>{l.hip.rotation.x=Math.sin(st.phase+l.phase)*.35*mv});
    const strike=st.strike||0;R.arms.forEach((a,i)=>{a.a.rotation.x=-.4-strike*1.6+Math.sin(t*1.3+i)*.04;a.f.rotation.x=lerp(-2.6,-.3,strike)});
    R.head.rotation.y=Math.sin(t*.8)*.4*(1-mv);R.body.position.y=1.3+Math.sin(st.phase*2)*.03;
  } else if(R.kind==='roo'){
    st.phase=(st.phase||0)+dt*Math.min(st.speed,12)*.9;const mv=Math.min(1,st.speed/1);const hop=Math.abs(Math.sin(st.phase));
    R.root.children[0].position.y=1.05+hop*.6*mv+(st.leap||0);
    R.legs.forEach(l=>{l.th.rotation.x=-.6+hop*.9*mv;l.kn.rotation.x=1.3-hop*1.1*mv;l.ft.rotation.x=-.5+hop*.6*mv});
    R.tail.rotation.x=-2.1+hop*.3*mv;R.head.rotation.x=-.35+Math.sin(t*.9)*.05;
  }
};
})();
