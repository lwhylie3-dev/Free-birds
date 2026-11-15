// Beastbound Wilds — terrain, forest, sky, camp and Crown outposts.
(function(){
const BB = window.BB = window.BB || {};
const V3 = THREE.Vector3;
if(THREE.ColorManagement)THREE.ColorManagement.legacyMode=false; // treat hex colors as sRGB

// ---------- noise ----------
const P = new Uint8Array(512);
{ const p=[...Array(256).keys()]; let s=1337; for(let i=255;i>0;i--){ s=(s*16807)%2147483647; const j=s%(i+1); [p[i],p[j]]=[p[j],p[i]]; } for(let i=0;i<512;i++) P[i]=p[i&255]; }
const G=[[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
function n2(x,y){const F=.366025403,Gs=.211324865;const s=(x+y)*F,i=Math.floor(x+s),j=Math.floor(y+s),t=(i+j)*Gs;
 const x0=x-(i-t),y0=y-(j-t),i1=x0>y0?1:0,j1=1-i1;const x1=x0-i1+Gs,y1=y0-j1+Gs,x2=x0-1+2*Gs,y2=y0-1+2*Gs;
 const c=(gx,gy,xx,yy)=>{let tt=.5-xx*xx-yy*yy;if(tt<0)return 0;const g=G[P[gx+P[gy]]&7];tt*=tt;return tt*tt*(g[0]*xx+g[1]*yy)};
 const ii=i&255,jj=j&255;return 70*(c(ii,jj,x0,y0)+c(ii+i1,jj+j1,x1,y1)+c(ii+1,jj+1,x2,y2));}
const fbm=(x,y,o)=>{let a=0,f=1,amp=1,s=0;for(let k=0;k<o;k++){a+=amp*n2(x*f,y*f);s+=amp;f*=2.03;amp*=.5}return a/s};
const ridge=(x,y,o)=>{let a=0,f=1,amp=1,s=0,w=1;for(let k=0;k<o;k++){let v=1-Math.abs(n2(x*f,y*f));v*=v*w;w=Math.min(1,v*1.6);a+=amp*v;s+=amp;f*=2.1;amp*=.5}return a/s};
const ss=(e0,e1,x)=>{const t=Math.min(1,Math.max(0,(x-e0)/(e1-e0)));return t*t*(3-2*t)};
BB.noise={n2,fbm,ridge,ss};

let seed=11; const rnd=BB.rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;

// ---------- height ----------
const SIZE=BB.SIZE=3200, HALF=BB.HALF=SIZE/2;
function rawHeight(x,z){
  const r=Math.hypot(x,z)/HALF;
  const rolling=fbm(x*.0016,z*.0016,4)*16+fbm(x*.008,z*.008,3)*3.5;
  const mtn=Math.pow(ridge(x*.0011+9,z*.0011-3,6),2.2)*460;
  const bowl=ss(.3,.92,r);
  const river=Math.max(0,1-Math.abs(n2(x*.0013+40,z*.0013)*3.4))*-9;
  return rolling+river*(1-bowl)+mtn*(.05+.95*bowl)+bowl*bowl*170;
}
// flat zones: camp + outposts
const CAMP=BB.CAMP={x:0,z:40,r:34};
const OUTPOSTS=BB.OUTPOSTS=[
  {x:330,z:-180,r:30,name:'Ashscale Pylon'},
  {x:-360,z:-120,r:30,name:'Frostclaw Pylon'},
  {x:-190,z:380,r:30,name:'Redgrass Pylon'},
  {x:300,z:330,r:30,name:'Tidebreak Pylon'},
];
const ZONES=[CAMP,...OUTPOSTS];
ZONES.forEach(z=>z.h=Math.max(2,rawHeight(z.x,z.z)));
function height(x,z){
  let h=rawHeight(x,z);
  for(const zn of ZONES){const d=Math.hypot(x-zn.x,z-zn.z);if(d<zn.r*1.8){const k=ss(zn.r*1.8,zn.r*.9,d);h=h+(zn.h-h)*k;}}
  return h;
}
BB.height=height;
BB.groundNormal=(x,z,out)=>{const e=1.2;out.set(height(x-e,z)-height(x+e,z),2*e,height(x,z-e)-height(x,z+e)).normalize();return out};

BB.buildWorld=function(scene, quality){
  const lowQ=quality==='low';
  // ---- sky ----
  const FOG=new THREE.Color(0xaab8bb);
  scene.fog=new THREE.FogExp2(FOG,.0021);
  scene.background=FOG.clone();
  const skyMat=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,fog:false,
    uniforms:{top:{value:new THREE.Color(0x6c879a)},mid:{value:FOG.clone()},sun:{value:new V3(.45,.42,-.78).normalize()}},
    vertexShader:`varying vec3 d;void main(){d=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`uniform vec3 top,mid,sun;varying vec3 d;void main(){float h=clamp(d.y*2.4,0.,1.);vec3 c=mix(mid,top,h);c+=vec3(1.,.93,.8)*pow(max(dot(d,sun),0.),28.)*.4;gl_FragColor=vec4(c,1.);}`});
  const sky=new THREE.Mesh(new THREE.SphereGeometry(1400,32,16),skyMat); sky.renderOrder=-1; scene.add(sky);

  scene.add(new THREE.HemisphereLight(0xdfe8ee,0x3d4a38,.85));
  const sun=new THREE.DirectionalLight(0xfff0d8,1.55);
  sun.position.set(45,42,-78); sun.castShadow=true;
  const sm=lowQ?1024:2048; sun.shadow.mapSize.set(sm,sm);
  const sc=sun.shadow.camera; sc.left=-45;sc.right=45;sc.top=45;sc.bottom=-45;sc.near=1;sc.far=240;
  sun.shadow.bias=-.0006; sun.shadow.normalBias=.04;
  scene.add(sun); scene.add(sun.target);

  // ---- terrain ----
  const SEG=lowQ?220:340;
  const tg=new THREE.PlaneGeometry(SIZE,SIZE,SEG,SEG); tg.rotateX(-Math.PI/2);
  const pos=tg.attributes.position;
  for(let i=0;i<pos.count;i++) pos.setY(i,height(pos.getX(i),pos.getZ(i)));
  tg.computeVertexNormals();
  const nrm=tg.attributes.normal, cols=new Float32Array(pos.count*3), c=new THREE.Color();
  const grass=new THREE.Color(0x4f5c32),moss=new THREE.Color(0x2c3a22),rock=new THREE.Color(0x737069),rockD=new THREE.Color(0x4e4d4a),snow=new THREE.Color(0xf1f4f6),dirt=new THREE.Color(0x6f6650),path=new THREE.Color(0x7d7258);
  for(let i=0;i<pos.count;i++){
    const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i),ny=nrm.getY(i);
    const v=fbm(x*.03,z*.03,2)*.5+.5;
    c.copy(grass).lerp(moss,ss(.3,.75,v));
    if(y<1.5)c.lerp(dirt,.55);
    for(const zn of ZONES){const d=Math.hypot(x-zn.x,z-zn.z);if(d<zn.r)c.lerp(path,ss(zn.r,zn.r*.5,d)*.75);}
    const steep=1-ss(.66,.86,ny); c.lerp(v>.5?rock:rockD,steep);
    const snowLine=300+fbm(x*.008,z*.008,3)*45;
    c.lerp(snow,ss(snowLine-20,snowLine+20,y)*ss(.5,.75,ny));
    cols[i*3]=c.r;cols[i*3+1]=c.g;cols[i*3+2]=c.b;
  }
  tg.setAttribute('color',new THREE.BufferAttribute(cols,3));
  const terrain=new THREE.Mesh(tg,new THREE.MeshLambertMaterial({vertexColors:true}));
  terrain.receiveShadow=true; scene.add(terrain);

  const water=new THREE.Mesh(new THREE.PlaneGeometry(SIZE,SIZE),new THREE.MeshPhongMaterial({color:0x51676c,shininess:90,specular:0xa8bcbe,transparent:true,opacity:.86}));
  water.rotation.x=-Math.PI/2; water.position.y=-2.6; water.receiveShadow=true; scene.add(water);
  BB.WATER_Y=-2.6;

  // ---- pines (instanced, with trunk colliders on a grid) ----
  const TREES=lowQ?9000:17000;
  const grid=BB.treeGrid=new Map(); const CELL=BB.TREE_CELL=16;
  function cone(r,h,y,col){const g=new THREE.ConeGeometry(r,h,8,1);g.translate(0,y,0);const a=new Float32Array(g.attributes.position.count*3);
    for(let i=0;i<g.attributes.position.count;i++){const k=.7+.3*(g.attributes.position.getY(i)-y+h/2)/h;a[i*3]=col.r*k;a[i*3+1]=col.g*k;a[i*3+2]=col.b*k}g.setAttribute('color',new THREE.BufferAttribute(a,3));return g}
  const pc=new THREE.Color(0x22311d);
  const parts=[cone(3.2,6,4.5,pc),cone(2.6,5.4,7.8,pc),cone(1.9,4.6,10.8,pc),cone(1.1,3.6,13.4,pc),cone(.38,4,1.8,new THREE.Color(0x3d2d22))];
  const tMat=new THREE.MeshLambertMaterial({vertexColors:true});
  const meshes=parts.map((g,k)=>{const m=new THREE.InstancedMesh(g,tMat,TREES);m.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(TREES*3),3);m.castShadow=k<2&&!lowQ;m.receiveShadow=false;scene.add(m);return m});
  const dm=new THREE.Object3D(),tc=new THREE.Color(),white=new THREE.Color(1,1,1);
  let placed=0,guard=0;
  while(placed<TREES&&guard++<TREES*14){
    const x=(rnd()-.5)*SIZE*.94,z=(rnd()-.5)*SIZE*.94,y=height(x,z);
    if(y<0||y>270+fbm(x*.008,z*.008,3)*40)continue;
    let blocked=false; for(const zn of ZONES){if(Math.hypot(x-zn.x,z-zn.z)<zn.r*1.15){blocked=true;break}} if(blocked)continue;
    const e=2,sl=Math.abs(height(x+e,z)-y)+Math.abs(height(x,z+e)-y);if(sl>2.4)continue;
    const dens=fbm(x*.005,z*.005,3);if(dens<-.3+rnd()*.25)continue;
    const s=.75+rnd()*1.05;
    dm.position.set(x,y-.4,z);dm.rotation.set((rnd()-.5)*.06,rnd()*6.28,(rnd()-.5)*.06);dm.scale.set(s,s*(.85+rnd()*.5),s);dm.updateMatrix();
    tc.setHSL(.26+rnd()*.07,.28+rnd()*.15,.42+rnd()*.38);
    meshes.forEach((m,k)=>{m.setMatrixAt(placed,dm.matrix);m.setColorAt(placed,k===4?white:tc)});
    const key=Math.floor(x/CELL)+','+Math.floor(z/CELL); if(!grid.has(key))grid.set(key,[]); grid.get(key).push(x,z,.55*s);
    placed++;
  }
  meshes.forEach(m=>{m.count=placed;m.instanceMatrix.needsUpdate=true;m.instanceColor.needsUpdate=true});

  // ---- boulders ----
  const RC=lowQ?500:1100;
  const rg=new THREE.DodecahedronGeometry(1,1); {const p=rg.attributes.position;for(let i=0;i<p.count;i++){const k=1+n2(p.getX(i)*2.1,p.getZ(i)*2.1+p.getY(i))*.22;p.setXYZ(i,p.getX(i)*k,p.getY(i)*k*.7,p.getZ(i)*k)}rg.computeVertexNormals();}
  const rocks=new THREE.InstancedMesh(rg,new THREE.MeshStandardMaterial({color:0x7a7872,roughness:.95,flatShading:true}),RC);
  rocks.castShadow=!lowQ; rocks.receiveShadow=true;
  for(let i=0;i<RC;i++){const x=(rnd()-.5)*SIZE*.9,z=(rnd()-.5)*SIZE*.9,y=height(x,z);const s=.4+Math.pow(rnd(),3)*4.5;
    dm.position.set(x,y-s*.2,z);dm.rotation.set(rnd()*3,rnd()*6,rnd()*3);dm.scale.set(s,s,s*(.7+rnd()*.6));dm.updateMatrix();rocks.setMatrixAt(i,dm.matrix);
    if(s>1.5){const key=Math.floor(x/CELL)+','+Math.floor(z/CELL);if(!grid.has(key))grid.set(key,[]);grid.get(key).push(x,z,s*.85);}}
  scene.add(rocks);

  // ---- grass tufts near the valley floor ----
  if(!lowQ){
    const GC=26000, gg=new THREE.ConeGeometry(.09,.7,3,1); gg.translate(0,.35,0);
    const grassM=new THREE.InstancedMesh(gg,new THREE.MeshLambertMaterial({color:0x6b7a3c}),GC);
    let gi=0; for(let k=0;k<GC*3&&gi<GC;k++){const a=rnd()*6.28,r=Math.sqrt(rnd())*520,x=Math.cos(a)*r,z=Math.sin(a)*r+40,y=height(x,z);if(y<.2||y>120)continue;
      dm.position.set(x,y,z);dm.rotation.set((rnd()-.5)*.5,rnd()*6,(rnd()-.5)*.5);const s=.6+rnd()*.9;dm.scale.set(s,s,s);dm.updateMatrix();grassM.setMatrixAt(gi++,dm.matrix);}
    grassM.count=gi; scene.add(grassM);
  }

  // ---- mist ----
  const mc=document.createElement('canvas');mc.width=mc.height=128;const mx=mc.getContext('2d');
  const gr=mx.createRadialGradient(64,64,0,64,64,64);gr.addColorStop(0,'rgba(255,255,255,.5)');gr.addColorStop(1,'rgba(255,255,255,0)');mx.fillStyle=gr;mx.fillRect(0,0,128,128);
  const mistTex=new THREE.CanvasTexture(mc); const mists=[];
  for(let i=0;i<34;i++){const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:mistTex,color:0xe2e8ea,transparent:true,opacity:.2,depthWrite:false}));
    const x=(rnd()-.5)*SIZE*.7,z=(rnd()-.5)*SIZE*.7;sp.position.set(x,height(x,z)+40+rnd()*70,z);const s=160+rnd()*220;sp.scale.set(s,s*.4,1);scene.add(sp);mists.push(sp)}

  const lamps=[]; // flickering fire lights
  buildCamp(scene,lamps);
  const pylons=OUTPOSTS.map(o=>buildOutpost(scene,o));

  return {
    sky, sun, mists, lamps, pylons,
    update(dt,t,focus){
      sky.position.copy(focus);
      sun.position.set(focus.x+45,focus.y+42,focus.z-78); sun.target.position.copy(focus);
      mists.forEach((m,i)=>{m.position.x+=Math.sin(i)*dt*1.5;m.material.opacity=.2*Math.min(1,Math.max(0,(m.position.distanceTo(focus)-60)/180))});
      lamps.forEach((l,i)=>l.intensity=l.userData.base*(.85+.15*Math.sin(t*13+i*7)+.08*Math.sin(t*31+i)));
      pylons.forEach(p=>{if(!p.broken){p.rings.forEach((r,i)=>{r.rotation.z+=dt*(.4+i*.12)*(i%2?-1:1)});p.core.material.emissiveIntensity=1.6+Math.sin(t*3)*.5}});
    }
  };
};

function M(color,o={}){return new THREE.MeshStandardMaterial(Object.assign({color,roughness:.85,metalness:0},o))}
function add(parent,geo,mat,x=0,y=0,z=0,rx=0,ry=0,rz=0){const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.rotation.set(rx,ry,rz);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m}

function buildCamp(scene,lamps){
  const g=new THREE.Group(); g.position.set(CAMP.x,CAMP.h,CAMP.z); scene.add(g);
  // campfire
  const stoneM=M(0x6d6a63),logM=M(0x4a3526);
  for(let i=0;i<9;i++){const a=i/9*6.28;add(g,new THREE.DodecahedronGeometry(.32),stoneM,Math.cos(a)*1.1,.15,Math.sin(a)*1.1)}
  for(let i=0;i<4;i++){add(g,new THREE.CylinderGeometry(.11,.13,1.6,6),logM,0,.35,0,1.15,i*.8,0)}
  const flame=add(g,new THREE.ConeGeometry(.45,1.3,7),new THREE.MeshBasicMaterial({color:0xffa94d,transparent:true,opacity:.85}),0,.85,0); flame.castShadow=false;
  g.userData.flame=flame;
  const fire=new THREE.PointLight(0xff9a4a,2.2,26,1.6); fire.position.set(0,1.6,0); fire.userData.base=2.2; g.add(fire); lamps.push(fire);
  // tents in a ring
  const canvasCols=[0x8a7a5e,0x6e6a58,0x7d6550,0x5f6a5c,0x8c8068];
  for(let i=0;i<7;i++){const a=i/7*6.28+.3,r=17;const t=new THREE.Group();t.position.set(Math.cos(a)*r,0,Math.sin(a)*r);t.rotation.y=-a+Math.PI/2;g.add(t);
    const tent=add(t,new THREE.ConeGeometry(2.6,3.2,4,1,true),M(canvasCols[i%5],{side:THREE.DoubleSide}),0,1.6,0,0,Math.PI/4,0);
    add(t,new THREE.CylinderGeometry(.05,.05,3.6,5),logM,0,1.8,0)}
  // banner: lion painted over the Crown seal
  const pole=add(g,new THREE.CylinderGeometry(.08,.1,9,6),logM,6,4.5,-4);
  const bc=document.createElement('canvas');bc.width=256;bc.height=384;const x=bc.getContext('2d');
  x.fillStyle='#e9e4d8';x.fillRect(0,0,256,384);x.strokeStyle='#b8933a';x.lineWidth=6;x.beginPath();x.arc(128,170,78,0,7);x.stroke();
  x.fillStyle='#141414';x.beginPath();x.ellipse(128,175,70,58,0,0,7);x.fill();x.beginPath();x.ellipse(170,170,40,30,0,0,7);x.fill();
  for(let i=0;i<14;i++){const a=i/14*6.28;x.beginPath();x.ellipse(98+Math.cos(a)*42,150+Math.sin(a)*42,18,10,a,0,7);x.fill()}
  x.fillStyle='#bfe8ff';x.beginPath();x.arc(84,140,6,0,7);x.fill();
  x.fillStyle='#141414';x.font='bold 30px Georgia';x.textAlign='center';x.fillText('NO MASTER',128,330);
  const banner=add(g,new THREE.PlaneGeometry(2.4,3.6),new THREE.MeshStandardMaterial({map:new THREE.CanvasTexture(bc),side:THREE.DoubleSide,roughness:1}),7.25,6.9,-4);
  banner.material.map.encoding=THREE.sRGBEncoding;
  // supply crates & a lantern
  const crateM=M(0x6b5238);
  [[-6,-6],[-7.2,-5.2],[-6.4,-4.4]].forEach(([a,b],i)=>add(g,new THREE.BoxGeometry(1.1,1.1,1.1),crateM,a,.55+(i==2?1.1:0),b,0,i,0));
  const lamp=new THREE.PointLight(0xffc27a,1,14,1.8);lamp.position.set(-6,2.6,-5);lamp.userData.base=1;g.add(lamp);lamps.push(lamp);
  // accord stones: standing stones with carved glow
  const glyphM=M(0x5f6159,{emissive:0x7fd6c2,emissiveIntensity:.0});
  for(let i=0;i<12;i++){const a=i/12*6.28,r=29;const s=add(g,new THREE.BoxGeometry(1.2,3.4+((i*7)%3)*.6,.8),M(0x6a6b64,{flatShading:true}),Math.cos(a)*r,1.6,Math.sin(a)*r,0,-a,((i%3)-1)*.05);
    const gl=add(g,new THREE.PlaneGeometry(.5,1.4),new THREE.MeshBasicMaterial({color:0x8fe3cf,transparent:true,opacity:.55}),Math.cos(a)*(r-.42),2,Math.sin(a)*(r-.42),0,-a-Math.PI/2,0);gl.castShadow=false}
}

function buildOutpost(scene,o){
  const g=new THREE.Group(); g.position.set(o.x,o.h,o.z); scene.add(g);
  const white=M(0xd9dcdc,{roughness:.4,metalness:.3}), gold=M(0xc9a24a,{roughness:.3,metalness:.8,emissive:0x5a3b0a,emissiveIntensity:.4}), dark=M(0x3b3f44,{roughness:.6,metalness:.4});
  // palisade of white plates
  for(let i=0;i<22;i++){const a=i/22*6.28;if(i%11===0)continue;add(g,new THREE.BoxGeometry(5.2,4.2,.5),white,Math.cos(a)*22,2.1,Math.sin(a)*22,0,-a+Math.PI/2,0)}
  // pylon: obelisk + nine counter-rotating rings + resonance core
  add(g,new THREE.CylinderGeometry(3.2,4,1.2,9),dark,0,.6,0);
  const ob=add(g,new THREE.CylinderGeometry(.9,1.6,15,9),white,0,8.6,0);
  const core=add(g,new THREE.OctahedronGeometry(1.4),new THREE.MeshStandardMaterial({color:0xffffff,emissive:0xc9e8ff,emissiveIntensity:1.8,roughness:.2}),0,17.4,0);
  const rings=[];
  for(let i=0;i<9;i++){const r=add(g,new THREE.TorusGeometry(2.4+i*.32,.07,6,40),gold,0,17.4,0,Math.PI/2+i*.2,i*.7,0);r.castShadow=false;rings.push(r)}
  const light=new THREE.PointLight(0xbfe0ff,1.6,40,1.6);light.position.set(0,17,0);g.add(light);
  // collared cages
  const cageM=M(0x2d3034,{metalness:.6,roughness:.5});
  for(let k=0;k<3;k++){const a=k/3*6.28+.5,cx=Math.cos(a)*12,cz=Math.sin(a)*12;
    add(g,new THREE.BoxGeometry(4,.3,4),cageM,cx,.15,cz);add(g,new THREE.BoxGeometry(4,.3,4),cageM,cx,3.2,cz);
    for(let b=0;b<12;b++){const t=b/12*6.28;add(g,new THREE.CylinderGeometry(.05,.05,3,4),cageM,cx+Math.cos(t)*1.9,1.65,cz+Math.sin(t)*1.9)}}
  return {group:g,o,core,rings,light,ob,hp:400,maxhp:400,broken:false,pos:new V3(o.x,o.h,o.z)};
}
})();
