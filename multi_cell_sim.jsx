import { useState, useRef, useEffect, useCallback } from "react";
import * as THREE from "three";

const UI = {
  bg:"#060a16", panel:"#0c1222", border:"#172040",
  accent:"#00e5ff", accentD:"#007a8a", text:"#d0daea", dim:"#3e506e",
  danger:"#ff2e50", warn:"#ffb020", success:"#00e676", purple:"#b388ff",
};

function pL(p){if(p<100)return p.toFixed(1)+" Pa";if(p<1e5)return(p/1e3).toFixed(1)+" kPa";return(p/1e6).toFixed(2)+" MPa";}
function pC(t){t=Math.min(Math.max(t,0),1);let r,g,b;if(t<0.25){const s=t/0.25;r=.08+.12*s;g=.4+.4*s;b=.7+.15*s;}else if(t<.5){const s=(t-.25)/.25;r=.2+.6*s;g=.8-.05*s;b=.2+.2*s;}else if(t<.75){const s=(t-.5)/.25;r=.8+.2*s;g=.75-.4*s;b=.1;}else{const s=(t-.75)/.25;r=1;g=.35-.25*s;b=.1;}return new THREE.Color(r,g,b);}
const GCOL=[new THREE.Color(.2,.6,.9),new THREE.Color(.2,.85,.5),new THREE.Color(.95,.7,.15),new THREE.Color(.9,.3,.5),new THREE.Color(.65,.4,1),new THREE.Color(.1,.9,.85)];

class Cell{
  constructor(x,y,z,r,id){this.id=id;this.pos=new THREE.Vector3(x,y,z);this.vel=new THREE.Vector3();this.radius=r;this.baseR=r;this.pressure=0;this.contacts=[];this.membrane=1;this.isDead=false;this.mitosisType=null;this.maxP=0;this.gen=0;this.age=0;this.dividing=false;this.divP=0;this.divAxis=new THREE.Vector3(1,0,0);this.divType=null;this.canDiv=true;this.tsd=0;this.cooldown=200;this.stress=0;this.creep=0;this.bonds=[];this.pHist=[];}
}

class Sim{
  constructor(){this.cells=[];this.nid=0;this.E=500;this.nu=.45;this.fric=.12;this.memS=2000;this.cR=1;this.grav=0;this.dt=.018;this.bnd=8;this.wC=0;this.useW=false;this.autoDiv=true;this.divInt=300;this.divSpd=.008;this.maxC=100;this.adhS=50;this.adhR=.3;this.visc=.02;this.sc=0;}
  add(x,y,z,r,g){const c=new Cell(x,y,z,r||this.cR,this.nid++);c.gen=g||0;this.cells.push(c);return c;}
  
  // Presets
  tightPack(n){
    this.cells=[];this.nid=0;
    const cols=Math.ceil(Math.cbrt(n));const gap=this.cR*1.95;let k=0;
    for(let x=0;x<cols&&k<n;x++)for(let y=0;y<cols&&k<n;y++)for(let z=0;z<cols&&k<n;z++){
      const ox=x%2===1?.3:0,oz=y%2===1?.3:0;
      this.add((x-cols/2)*gap+ox,(y-cols/2)*gap,(z-cols/2)*gap+oz,this.cR*(.9+Math.random()*.2));k++;
    }
  }
  loosePack(n){
    this.cells=[];this.nid=0;
    const cols=Math.ceil(Math.cbrt(n));const gap=this.cR*2.8;let k=0;
    for(let x=0;x<cols&&k<n;x++)for(let y=0;y<cols&&k<n;y++)for(let z=0;z<cols&&k<n;z++){
      this.add((x-cols/2)*gap+(Math.random()-.5)*.5,(y-cols/2)*gap+(Math.random()-.5)*.5,(z-cols/2)*gap+(Math.random()-.5)*.5,this.cR*(.85+Math.random()*.3));k++;
    }
  }
  monolayer(n){
    this.cells=[];this.nid=0;
    const cols=Math.ceil(Math.sqrt(n));const gap=this.cR*2;let k=0;
    for(let x=0;x<cols&&k<n;x++)for(let z=0;z<cols&&k<n;z++){
      const ox=z%2===1?gap*.5:0;
      this.add((x-cols/2)*gap+ox,0,(z-cols/2)*gap,this.cR*(.9+Math.random()*.2));k++;
    }
  }

  hF(d,r1,r2){if(d<=0)return 0;const rE=(r1*r2)/(r1+r2),eS=this.E/(2*(1-this.nu*this.nu));return(4/3)*eS*Math.sqrt(rE)*Math.pow(d,1.5);}
  hP(d,r1,r2){if(d<=0)return 0;const rE=(r1*r2)/(r1+r2),a=Math.sqrt(rE*d);if(a<1e-6)return 0;return this.hF(d,r1,r2)/(Math.PI*a*a);}

  startDiv(c){
    if(c.dividing||c.isDead||!c.canDiv||this.cells.filter(x=>!x.isDead).length>=this.maxC)return;
    c.dividing=true;c.divP=0;c.divType=c.pressure/this.memS>.3?"closed":"open";
    c.divAxis.set(Math.random()-.5,Math.random()-.5,Math.random()-.5).normalize();c.canDiv=false;c.tsd=0;
  }
  endDiv(c){
    const off=c.divAxis.clone().multiplyScalar(c.radius*.6);
    const ch=this.add(c.pos.x+off.x,c.pos.y+off.y,c.pos.z+off.z,c.baseR*(.8+Math.random()*.15),c.gen+1);
    ch.vel.copy(c.divAxis).multiplyScalar(.5);ch.cooldown=200+Math.random()*100;
    c.pos.sub(off.multiplyScalar(.5));c.radius=c.baseR*(.8+Math.random()*.15);c.baseR=c.radius;
    c.dividing=false;c.divP=0;c.gen++;c.cooldown=200+Math.random()*100;c.membrane=Math.max(.5,c.membrane-.1);c.vel.copy(c.divAxis).multiplyScalar(-.5);
  }

  step(){
    const live=this.cells.filter(c=>!c.isDead);const N=live.length;const _t=new THREE.Vector3();
    for(const c of live){c.pressure=0;c.contacts=[];c.bonds=[];}
    for(let i=0;i<N;i++)for(let j=i+1;j<N;j++){
      const a=live[i],b=live[j];_t.copy(b.pos).sub(a.pos);const dist=_t.length()||1e-6;const ov=a.radius+b.radius-dist;
      if(ov>0){
        const F=this.hF(ov,a.radius,b.radius),P=this.hP(ov,a.radius,b.radius);
        const rE=(a.radius*b.radius)/(a.radius+b.radius),cR=Math.sqrt(rE*ov);
        const nx=_t.x/dist,ny=_t.y/dist,nz=_t.z/dist;
        const rv=(b.vel.x-a.vel.x)*nx+(b.vel.y-a.vel.y)*ny+(b.vel.z-a.vel.z)*nz;
        const dF=rv*this.E*.001;const fx=(F-dF)*nx,fy=(F-dF)*ny,fz=(F-dF)*nz;
        a.vel.x-=fx*this.dt;a.vel.y-=fy*this.dt;a.vel.z-=fz*this.dt;
        b.vel.x+=fx*this.dt;b.vel.y+=fy*this.dt;b.vel.z+=fz*this.dt;
        a.contacts.push({point:new THREE.Vector3(a.pos.x+nx*a.radius,a.pos.y+ny*a.radius,a.pos.z+nz*a.radius),pressure:P,cR,normal:new THREE.Vector3(nx,ny,nz)});
        b.contacts.push({point:new THREE.Vector3(b.pos.x-nx*b.radius,b.pos.y-ny*b.radius,b.pos.z-nz*b.radius),pressure:P,cR,normal:new THREE.Vector3(-nx,-ny,-nz)});
        a.pressure+=P;b.pressure+=P;
      }
      const gap=dist-a.radius-b.radius;const aR2=(a.radius+b.radius)*this.adhR;
      if(gap>0&&gap<aR2&&this.adhS>0){
        const aF=this.adhS*(1-gap/aR2);const nx=_t.x/dist,ny=_t.y/dist,nz=_t.z/dist;
        a.vel.x+=aF*nx*this.dt;a.vel.y+=aF*ny*this.dt;a.vel.z+=aF*nz*this.dt;
        b.vel.x-=aF*nx*this.dt;b.vel.y-=aF*ny*this.dt;b.vel.z-=aF*nz*this.dt;
        a.bonds.push(b.id);b.bonds.push(a.id);
      }
    }
    const bnd=this.useW?this.bnd-this.wC:this.bnd;
    for(const c of live){
      c.vel.y-=this.grav*this.dt;
      for(const w of [{a:'x',s:1},{a:'x',s:-1},{a:'y',s:1},{a:'y',s:-1},{a:'z',s:1},{a:'z',s:-1}]){
        const lim=w.a==='y'?this.bnd:bnd;const coord=c.pos[w.a]*w.s;const ov=c.radius-(lim-coord);
        if(ov>0){
          const F=this.hF(ov,c.radius,c.radius*20),P=this.hP(ov,c.radius,c.radius*20);
          c.vel[w.a]-=w.s*F*this.dt;c.pressure+=P;
          const cp=c.pos.clone();cp[w.a]+=w.s*c.radius;const n=new THREE.Vector3();n[w.a]=w.s;
          const rE2=(c.radius*c.radius*20)/(c.radius+c.radius*20);
          c.contacts.push({point:cp,pressure:P,cR:Math.sqrt(rE2*ov),normal:n});
        }
      }
      c.vel.multiplyScalar(1-this.fric);
      if(c.pressure>0){c.stress=c.stress*.98+c.pressure*.02;c.creep+=c.stress*this.visc*this.dt;c.radius=c.baseR*(1+Math.min(c.creep*.01,.15));}
      if(c.creep>0&&c.pressure<c.stress*.5)c.creep*=(1-0.005);
      c.pos.add(_t.copy(c.vel).multiplyScalar(this.dt));
      c.pos.clamp(new THREE.Vector3(-bnd,-this.bnd,-bnd).addScalar(c.radius),new THREE.Vector3(bnd,this.bnd,bnd).subScalar(c.radius));
      if(c.pressure>this.memS*.5)c.membrane-=(c.pressure-this.memS*.5)/this.memS*.003;
      else c.membrane=Math.min(1,c.membrane+.0008);
      if(c.membrane<=0)c.isDead=true;
      c.maxP=Math.max(c.maxP,c.pressure);
      c.mitosisType=c.pressure/this.memS>.4?"closed":c.pressure/this.memS>.05?"open":null;
      c.age++;c.tsd++;
      if(this.sc%5===0){c.pHist.push(c.pressure);if(c.pHist.length>60)c.pHist.shift();}
      if(c.dividing){c.divP+=this.divSpd;if(c.divP>=1)this.endDiv(c);}
      if(!c.canDiv&&c.tsd>c.cooldown)c.canDiv=true;
      if(this.autoDiv&&!c.dividing&&c.canDiv&&c.age>100&&c.tsd>this.divInt&&c.membrane>.4&&Math.random()<.003)this.startDiv(c);
    }
    this.sc++;
  }
}

function Sparkline({data,maxV,w=130,h=24,color=UI.accent}){
  if(!data||data.length<2)return null;
  const pts=data.map((v,i)=>`${(i/(data.length-1))*w},${h-(Math.min(v/maxV,1)*(h-2))-1}`).join(" ");
  return <svg width={w} height={h} style={{display:"block"}}><polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round"/></svg>;
}

function Sl({label,value,min,max,step,onChange,unit,color}){
  const pct=((value-min)/(max-min))*100;
  return(
    <div style={{marginBottom:6}}>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:UI.dim,marginBottom:1}}>
        <span>{label}</span>
        <span style={{color:color||UI.accent,fontFamily:"monospace",fontSize:9}}>{value>=1000?(value/1000).toFixed(1)+"k":step>=1?value:value.toFixed(2)}{unit?` ${unit}`:""}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(parseFloat(e.target.value))}
        style={{width:"100%",height:3,appearance:"none",background:`linear-gradient(to right,${color||UI.accent} ${pct}%,${UI.border} ${pct}%)`,borderRadius:2,outline:"none",cursor:"pointer"}}/>
    </div>
  );
}

export default function MultiCellSim(){
  const mountRef=useRef(null),simRef=useRef(null),sceneRef=useRef({}),animRef=useRef(null);
  const mouseRef=useRef({down:false,x:0,y:0,btn:-1,moved:false});
  const camRef=useRef({th:.6,ph:.8,d:20,tgt:new THREE.Vector3()});
  const runRef=useRef(false);

  const [running,setRunning]=useState(false);
  const [preset,setPreset]=useState("tight");
  const [nc,setNc]=useState(20);
  const [eM,setEM]=useState(500);
  const [mS,setMS]=useState(2000);
  const [cR,setCR]=useState(1);
  const [grav,setGrav]=useState(2);
  const [fric,setFric]=useState(.12);
  const [wC,setWC]=useState(0);
  const [useW,setUseW]=useState(false);
  const [pS,setPS]=useState(2000);
  const [autoDiv,setAutoDiv]=useState(true);
  const [divInt,setDivInt]=useState(300);
  const [divSpd,setDivSpd]=useState(.008);
  const [maxC,setMaxC]=useState(80);
  const [adhS,setAdhS]=useState(50);
  const [adhR,setAdhR]=useState(.3);
  const [visc,setVisc]=useState(.02);
  const [spd,setSpd]=useState(2);
  const [vm,setVm]=useState("pressure");
  const [stats,setStats]=useState({avg:0,max:0,dead:0,open:0,closed:0,total:0,div:0});
  const [selId,setSelId]=useState(null);
  const [selI,setSelI]=useState(null);

  useEffect(()=>{
    const m=mountRef.current;if(!m)return;
    const w=m.clientWidth,h=m.clientHeight;
    const ren=new THREE.WebGLRenderer({antialias:true});ren.setSize(w,h);ren.setPixelRatio(Math.min(devicePixelRatio,2));ren.setClearColor(0x060a16);m.appendChild(ren.domElement);
    const sc=new THREE.Scene();sc.fog=new THREE.FogExp2(0x060a16,.01);
    const cam=new THREE.PerspectiveCamera(50,w/h,.1,200);cam.position.set(12,10,16);cam.lookAt(0,0,0);
    sc.add(new THREE.AmbientLight(0x404060,.5));const dl=new THREE.DirectionalLight(0xffffff,.8);dl.position.set(8,14,6);sc.add(dl);
    sc.add(new THREE.HemisphereLight(0x88aaff,0x443322,.25));
    const gr=new THREE.GridHelper(18,18,0x162040,0x0e1630);gr.position.y=-8;sc.add(gr);
    const bx=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(16,16,16)),new THREE.LineBasicMaterial({color:0x162040,transparent:true,opacity:.4}));sc.add(bx);
    const ag=new THREE.Group();sc.add(ag);
    sceneRef.current={ren,sc,cam,m,cms:[],dhs:[],bx,ag};
    const onR=()=>{const nw=m.clientWidth,nh=m.clientHeight;cam.aspect=nw/nh;cam.updateProjectionMatrix();ren.setSize(nw,nh);};
    window.addEventListener("resize",onR);
    return()=>{window.removeEventListener("resize",onR);m.removeChild(ren.domElement);ren.dispose();};
  },[]);

  useEffect(()=>{
    const m=mountRef.current;if(!m)return;
    const onD=e=>{mouseRef.current={down:true,x:e.clientX,y:e.clientY,btn:e.button,moved:false};};
    const onU=()=>{mouseRef.current.down=false;};
    const onM=e=>{
      if(!mouseRef.current.down)return;
      const dx=e.clientX-mouseRef.current.x,dy=e.clientY-mouseRef.current.y;
      if(Math.abs(dx)>2||Math.abs(dy)>2)mouseRef.current.moved=true;
      mouseRef.current.x=e.clientX;mouseRef.current.y=e.clientY;
      camRef.current.th-=dx*.007;camRef.current.ph=Math.max(.1,Math.min(Math.PI-.1,camRef.current.ph-dy*.007));
    };
    const onW=e=>{camRef.current.d=Math.max(5,Math.min(60,camRef.current.d+e.deltaY*.02));e.preventDefault();};
    m.addEventListener("mousedown",onD);window.addEventListener("mouseup",onU);window.addEventListener("mousemove",onM);
    m.addEventListener("wheel",onW,{passive:false});m.addEventListener("contextmenu",e=>e.preventDefault());
    return()=>{m.removeEventListener("mousedown",onD);window.removeEventListener("mouseup",onU);window.removeEventListener("mousemove",onM);m.removeEventListener("wheel",onW);};
  },[]);

  const initSim=useCallback(()=>{
    const s=new Sim();s.E=eM;s.memS=mS;s.cR=cR;s.grav=grav;s.fric=fric;s.useW=useW;s.wC=wC;
    s.autoDiv=autoDiv;s.divInt=divInt;s.divSpd=divSpd;s.maxC=maxC;s.adhS=adhS;s.adhR=adhR;s.visc=visc;
    if(preset==="tight")s.tightPack(nc);else if(preset==="loose")s.loosePack(nc);else s.monolayer(nc);
    simRef.current=s;setSelId(null);setSelI(null);
    const{sc,cms,dhs}=sceneRef.current;
    if(sc){for(const m of cms){sc.remove(m);m.geometry.dispose();m.material.dispose();}for(const h of dhs){sc.remove(h);if(h.geometry)h.geometry.dispose();if(h.material)h.material.dispose();}cms.length=0;dhs.length=0;}
  },[nc,eM,mS,cR,grav,fric,useW,wC,autoDiv,divInt,divSpd,maxC,adhS,adhR,visc,preset]);

  useEffect(()=>{initSim();},[]);

  useEffect(()=>{
    if(!simRef.current)return;const s=simRef.current;
    s.E=eM;s.memS=mS;s.grav=grav;s.fric=fric;s.useW=useW;s.wC=wC;
    s.autoDiv=autoDiv;s.divInt=divInt;s.divSpd=divSpd;s.maxC=maxC;s.adhS=adhS;s.adhR=adhR;s.visc=visc;
  },[eM,mS,grav,fric,useW,wC,autoDiv,divInt,divSpd,maxC,adhS,adhR,visc]);

  const updateScene=useCallback(()=>{
    const{sc,cms,dhs,bx,ag}=sceneRef.current;const sim=simRef.current;if(!sc||!sim)return;
    const cells=sim.cells;const md=18;
    while(cms.length>cells.length){const m=cms.pop();sc.remove(m);m.geometry.dispose();m.material.dispose();}
    for(const h of dhs){sc.remove(h);if(h.geometry)h.geometry.dispose();if(h.material)h.material.dispose();}dhs.length=0;
    while(ag.children.length>0){const c=ag.children[0];ag.remove(c);if(c.geometry)c.geometry.dispose();if(c.material)c.material.dispose();}

    for(let i=0;i<cells.length;i++){
      const c=cells[i];let mesh=cms[i];
      if(!mesh){
        const geo=new THREE.SphereGeometry(1,md,md);
        const mat=new THREE.MeshPhongMaterial({vertexColors:true,shininess:50,transparent:true,opacity:.82,side:THREE.DoubleSide});
        const cols=new Float32Array(geo.attributes.position.count*3);geo.setAttribute("color",new THREE.BufferAttribute(cols,3));
        mesh=new THREE.Mesh(geo,mat);sc.add(mesh);cms[i]=mesh;
      }
      if(c.isDead){mesh.material.opacity=.1;mesh.material.wireframe=true;mesh.position.copy(c.pos);mesh.scale.setScalar(c.radius*.6);continue;}
      mesh.material.opacity=c.dividing?.65:.82;mesh.material.wireframe=false;mesh.position.copy(c.pos);

      if(c.dividing){
        const t=c.divP,sq=1-t*.35,st=1+t*.2;
        const q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),c.divAxis);
        mesh.quaternion.copy(q);mesh.scale.set(c.radius*st,c.radius*sq,c.radius*st);
        const rg=new THREE.TorusGeometry(c.radius*st*(.5+.5*(1-t)),.04,8,24);
        const rc=c.divType==="closed"?0xffb020:0x00e676;
        const rm=new THREE.MeshBasicMaterial({color:rc,transparent:true,opacity:.5+.4*Math.sin(Date.now()*.01)});
        const ring=new THREE.Mesh(rg,rm);ring.position.copy(c.pos);ring.quaternion.copy(q);ring.rotateX(Math.PI/2);sc.add(ring);dhs.push(ring);
        if(c.divType==="closed"){
          const ng=new THREE.SphereGeometry(c.radius*.3,8,8);const nm=new THREE.MeshBasicMaterial({color:0xffb020,transparent:true,opacity:.35});
          const n1=new THREE.Mesh(ng,nm);n1.position.copy(c.pos);sc.add(n1);dhs.push(n1);
          if(t>.5){const o=c.divAxis.clone().multiplyScalar(c.radius*.4*(t-.5)*2);
            const n2=n1.clone();n2.position.copy(c.pos).add(o);sc.add(n2);dhs.push(n2);
            const n3=n1.clone();n3.position.copy(c.pos).sub(o);sc.add(n3);dhs.push(n3);
          }
        }else if(t>.2){
          const eg=new THREE.SphereGeometry(c.radius*.35*(1-t*.5),6,6);
          const em=new THREE.MeshBasicMaterial({color:0x00e676,wireframe:true,transparent:true,opacity:.25*(1-t)});
          const env=new THREE.Mesh(eg,em);env.position.copy(c.pos);sc.add(env);dhs.push(env);
        }
      }else{mesh.scale.setScalar(c.radius);mesh.quaternion.identity();}

      const geo=mesh.geometry,posA=geo.attributes.position,colA=geo.attributes.color;
      for(let v=0;v<posA.count;v++){
        const vv=new THREE.Vector3(posA.getX(v)*mesh.scale.x,posA.getY(v)*mesh.scale.y,posA.getZ(v)*mesh.scale.z).applyQuaternion(mesh.quaternion);
        const wx=c.pos.x+vv.x,wy=c.pos.y+vv.y,wz=c.pos.z+vv.z;
        let vP=0;
        for(const ct of c.contacts){const dx=wx-ct.point.x,dy=wy-ct.point.y,dz=wz-ct.point.z;const d=Math.sqrt(dx*dx+dy*dy+dz*dz);const a=ct.cR*2.8;if(d<a){const r=d/a;vP+=ct.pressure*Math.sqrt(Math.max(0,1-r*r));}}
        let col;
        if(vm==="pressure")col=pC(vP/pS);
        else if(vm==="mitosis"){const base=c.divType==="closed"||c.mitosisType==="closed"?new THREE.Color(1,.7,.1):c.divType==="open"||c.mitosisType==="open"?new THREE.Color(0,.9,.45):pC(vP/pS);col=base.clone().lerp(pC(vP/pS),.35);}
        else if(vm==="generation"){col=GCOL[c.gen%GCOL.length].clone().lerp(pC(vP/pS),.25);}
        else if(vm==="membrane"){col=new THREE.Color().setHSL(c.membrane*.33,.85,.45).lerp(pC(vP/pS),.2);}
        else col=pC(vP/pS);
        colA.setXYZ(v,col.r,col.g,col.b);
      }
      colA.needsUpdate=true;
      if(selId===c.id){mesh.material.emissive=new THREE.Color(0x00e5ff);mesh.material.emissiveIntensity=.12;}
      else{mesh.material.emissive=new THREE.Color(0);mesh.material.emissiveIntensity=0;}
    }
    if(adhS>0){const drawn=new Set();for(const c of cells){if(c.isDead)continue;for(const bid of c.bonds){const key=Math.min(c.id,bid)+"-"+Math.max(c.id,bid);if(drawn.has(key))continue;drawn.add(key);const b=cells.find(x=>x.id===bid);if(!b)continue;const g=new THREE.BufferGeometry().setFromPoints([c.pos.clone(),b.pos.clone()]);ag.add(new THREE.Line(g,new THREE.LineBasicMaterial({color:0x00e5ff,transparent:true,opacity:.12})));}}}
    if(bx){const bn=useW?sim.bnd-sim.wC:sim.bnd;bx.scale.set(bn*2/16,1,bn*2/16);}
    let tP=0,mP=0,dN=0,oN=0,cN=0,dvN=0;
    for(const c of cells){if(c.isDead){dN++;continue;}tP+=c.pressure;mP=Math.max(mP,c.pressure);if(c.mitosisType==="open")oN++;if(c.mitosisType==="closed")cN++;if(c.dividing)dvN++;}
    const lN=cells.length-dN;
    setStats({avg:lN>0?tP/lN:0,max:mP,dead:dN,open:oN,closed:cN,total:cells.length,div:dvN});
    if(selId!=null){const sc2=cells.find(c=>c.id===selId);if(sc2&&!sc2.isDead)setSelI({p:sc2.pressure,mem:sc2.membrane,ct:sc2.contacts.length,maxP:sc2.maxP,mit:sc2.mitosisType,r:sc2.radius,gen:sc2.gen,age:sc2.age,div:sc2.dividing,divP:sc2.divP,divT:sc2.divType,creep:sc2.creep,bonds:sc2.bonds.length,hist:sc2.pHist});else setSelI(null);}
  },[pS,vm,selId,useW,adhS]);

  useEffect(()=>{runRef.current=running;},[running]);
  useEffect(()=>{
    const{ren,sc,cam}=sceneRef.current;if(!ren)return;let act=true;
    const loop=()=>{if(!act)return;
      if(runRef.current&&simRef.current){for(let i=0;i<spd;i++)simRef.current.step();}
      updateScene();
      const c=camRef.current;cam.position.x=c.tgt.x+c.d*Math.sin(c.ph)*Math.cos(c.th);cam.position.y=c.tgt.y+c.d*Math.cos(c.ph);cam.position.z=c.tgt.z+c.d*Math.sin(c.ph)*Math.sin(c.th);cam.lookAt(c.tgt);
      ren.render(sc,cam);animRef.current=requestAnimationFrame(loop);
    };loop();
    return()=>{act=false;if(animRef.current)cancelAnimationFrame(animRef.current);};
  },[updateScene,spd]);

  const handleClick=e=>{
    if(mouseRef.current.moved)return;
    const{cam}=sceneRef.current;const m=mountRef.current;if(!m||!cam)return;
    const rect=m.getBoundingClientRect();
    const ms=new THREE.Vector2(((e.clientX-rect.left)/rect.width)*2-1,-((e.clientY-rect.top)/rect.height)*2+1);
    const rc=new THREE.Raycaster();rc.setFromCamera(ms,cam);
    const hits=rc.intersectObjects(sceneRef.current.cms||[]);
    if(hits.length>0){const idx=(sceneRef.current.cms||[]).indexOf(hits[0].object);if(idx>=0&&simRef.current)setSelId(simRef.current.cells[idx]?.id??null);}
    else{setSelId(null);setSelI(null);}
  };

  const forceAll=(a,v)=>{if(!simRef.current)return;for(const c of simRef.current.cells)if(!c.isDead)c.vel[a]+=v;};
  const trigDiv=()=>{if(!simRef.current)return;const l=simRef.current.cells.filter(c=>!c.isDead&&!c.dividing&&c.canDiv);if(l.length>0)simRef.current.startDiv(l[Math.floor(Math.random()*l.length)]);};

  const bs=a=>({padding:"4px 8px",fontSize:9,border:`1px solid ${a?UI.accent:UI.border}`,background:a?UI.accentD+"25":"transparent",color:a?UI.accent:UI.dim,borderRadius:3,cursor:"pointer",fontFamily:"monospace"});

  return(
    <div style={{background:UI.bg,height:"100vh",color:UI.text,fontFamily:"'IBM Plex Sans',sans-serif",display:"flex",flexDirection:"column"}}>
      <div style={{padding:"7px 12px",borderBottom:`1px solid ${UI.border}`,display:"flex",alignItems:"center",gap:6,flexShrink:0,flexWrap:"wrap"}}>
        <div style={{width:6,height:6,borderRadius:"50%",background:running?UI.success:UI.danger,boxShadow:running?`0 0 6px ${UI.success}`:"none"}}/>
        <span style={{fontSize:13,fontWeight:700,fontFamily:"monospace"}}>Multi-Cell 3D</span>
        <div style={{display:"flex",gap:3,marginLeft:12}}>
          <button onClick={()=>setRunning(!running)} style={{...bs(running),borderColor:running?UI.danger:UI.accent,color:running?UI.danger:UI.accent}}>{running?"⏸ Pause":"▶ Run"}</button>
          <button onClick={()=>{if(simRef.current)simRef.current.step()}} style={bs(false)}>Step</button>
          <button onClick={()=>{setRunning(false);setTimeout(initSim,50)}} style={bs(false)}>Reset</button>
          <button onClick={trigDiv} style={{...bs(false),borderColor:UI.purple,color:UI.purple}}>÷ Divide</button>
        </div>
        <div style={{display:"flex",gap:3,marginLeft:12}}>
          <span style={{fontSize:8,color:UI.dim,alignSelf:"center",marginRight:2}}>PRESET:</span>
          {[["tight","Tight Pack"],["loose","Loose"],["mono","Monolayer"]].map(([k,l])=>
            <button key={k} onClick={()=>{setPreset(k);}} style={bs(preset===k)}>{l}</button>
          )}
        </div>
        <div style={{display:"flex",gap:3,marginLeft:12}}>
          <span style={{fontSize:8,color:UI.dim,alignSelf:"center",marginRight:2}}>VIEW:</span>
          {[["pressure","P"],["mitosis","Mit"],["generation","Gen"],["membrane","Mem"]].map(([k,l])=>
            <button key={k} onClick={()=>setVm(k)} style={bs(vm===k)}>{l}</button>
          )}
        </div>
        <div style={{display:"flex",gap:3,marginLeft:"auto"}}>
          {[["x",-3,"←"],["y",3,"↑"],["x",3,"→"],["y",-3,"↓"],["z",-3,"⊙"],["z",3,"⊗"]].map(([a,v,l],i)=>
            <button key={i} onClick={()=>forceAll(a,v)} style={{...bs(false),padding:"3px 6px",fontSize:8}}>{l}</button>
          )}
        </div>
      </div>

      <div style={{display:"flex",flex:1,overflow:"hidden"}}>
        <div style={{width:185,background:UI.panel,borderRight:`1px solid ${UI.border}`,overflowY:"auto",padding:8,flexShrink:0}}>
          <Sl label="Cells" value={nc} min={4} max={60} step={1} onChange={setNc}/>
          <Sl label="Radius" value={cR} min={.4} max={2} step={.1} onChange={setCR}/>
          <Sl label="Elastic Mod" value={eM} min={50} max={5000} step={50} onChange={setEM} unit="Pa"/>
          <Sl label="Membrane" value={mS} min={200} max={10000} step={100} onChange={setMS} unit="Pa" color={UI.danger}/>
          <Sl label="Gravity" value={grav} min={0} max={20} step={.5} onChange={setGrav}/>
          <Sl label="Friction" value={fric} min={0} max={.5} step={.01} onChange={setFric}/>
          <Sl label="P Scale" value={pS} min={200} max={10000} step={100} onChange={setPS} unit="Pa" color={UI.warn}/>
          <Sl label="Speed" value={spd} min={1} max={6} step={1} onChange={setSpd} unit="x"/>
          <div style={{borderTop:`1px solid ${UI.border}`,margin:"6px 0",paddingTop:6}}>
            <button onClick={()=>setUseW(!useW)} style={{...bs(useW),width:"100%",textAlign:"left"}}>
              {useW?"☑":"☐"} Walls
            </button>
            {useW&&<Sl label="Compress" value={wC} min={0} max={5} step={.2} onChange={setWC} color={UI.danger}/>}
          </div>
          <div style={{borderTop:`1px solid ${UI.border}`,margin:"6px 0",paddingTop:6}}>
            <button onClick={()=>setAutoDiv(!autoDiv)} style={{...bs(autoDiv),width:"100%",textAlign:"left"}}>
              {autoDiv?"☑":"☐"} Auto Division
            </button>
            <Sl label="Interval" value={divInt} min={50} max={800} step={10} onChange={setDivInt}/>
            <Sl label="Div Speed" value={divSpd} min={.002} max={.03} step={.001} onChange={setDivSpd}/>
            <Sl label="Max Cells" value={maxC} min={20} max={200} step={5} onChange={setMaxC}/>
          </div>
          <div style={{borderTop:`1px solid ${UI.border}`,margin:"6px 0",paddingTop:6}}>
            <Sl label="Adhesion" value={adhS} min={0} max={200} step={5} onChange={setAdhS}/>
            <Sl label="Adh Range" value={adhR} min={0} max={1} step={.05} onChange={setAdhR}/>
            <Sl label="Viscosity" value={visc} min={0} max={.1} step={.002} onChange={setVisc}/>
          </div>
        </div>

        <div style={{flex:1,position:"relative"}}>
          <div ref={mountRef} onClick={handleClick} style={{width:"100%",height:"100%",cursor:"grab"}}/>
          <div style={{position:"absolute",bottom:0,left:0,right:0,background:UI.panel+"e8",borderTop:`1px solid ${UI.border}`,padding:"5px 10px",display:"flex",gap:14,fontSize:9,fontFamily:"monospace",flexWrap:"wrap"}}>
            <div><span style={{color:UI.dim}}>CELLS </span><span>{stats.total-stats.dead}</span></div>
            <div><span style={{color:UI.dim}}>AVG </span><span style={{color:UI.accent}}>{pL(stats.avg)}</span></div>
            <div><span style={{color:UI.dim}}>MAX </span><span style={{color:UI.warn}}>{pL(stats.max)}</span></div>
            <div><span style={{color:UI.dim}}>DIV </span><span style={{color:UI.purple}}>{stats.div}</span></div>
            <div><span style={{color:UI.dim}}>DEAD </span><span style={{color:stats.dead>0?UI.danger:UI.dim}}>{stats.dead}</span></div>
            <div style={{marginLeft:"auto"}}><span style={{color:UI.dim}}>O:</span><span style={{color:UI.success}}>{stats.open}</span> <span style={{color:UI.dim}}>C:</span><span style={{color:UI.warn}}>{stats.closed}</span></div>
          </div>
        </div>

        <div style={{width:170,background:UI.panel,borderLeft:`1px solid ${UI.border}`,overflowY:"auto",padding:8,flexShrink:0}}>
          <div style={{display:"flex",height:8,borderRadius:2,overflow:"hidden",marginBottom:2}}>
            {Array.from({length:20},(_,i)=>{const c=pC(i/19);return<div key={i} style={{flex:1,background:`rgb(${c.r*255|0},${c.g*255|0},${c.b*255|0})`}}/>;}).concat()}
          </div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:7,color:UI.dim,marginBottom:8}}><span>0</span><span>{pL(pS)}</span></div>

          {selI?(
            <div>
              <div style={{fontSize:8,textTransform:"uppercase",color:UI.dim,marginBottom:3}}>Selected Cell</div>
              <div style={{fontSize:9,lineHeight:1.8,fontFamily:"monospace"}}>
                <div><span style={{color:UI.dim}}>P:</span> <span style={{color:UI.accent}}>{pL(selI.p)}</span></div>
                <div><span style={{color:UI.dim}}>Peak:</span> {pL(selI.maxP)}</div>
                <div><span style={{color:UI.dim}}>Mem:</span> <span style={{color:selI.mem>.5?UI.success:UI.danger}}>{(selI.mem*100)|0}%</span></div>
                <div><span style={{color:UI.dim}}>Mit:</span> <span style={{color:selI.mit==="closed"?UI.warn:UI.success}}>{selI.mit||"—"}</span></div>
                <div><span style={{color:UI.dim}}>Gen:</span> <span style={{color:UI.purple}}>{selI.gen}</span></div>
                <div><span style={{color:UI.dim}}>Ct:</span> {selI.ct} <span style={{color:UI.dim}}>Bonds:</span> {selI.bonds}</div>
                {selI.div&&<div style={{color:UI.purple}}>Dividing {(selI.divP*100)|0}% ({selI.divT})</div>}
              </div>
              {selI.hist&&selI.hist.length>2&&<div style={{marginTop:4,background:UI.bg,borderRadius:3,padding:"3px"}}><Sparkline data={selI.hist} maxV={pS} w={140} h={26}/></div>}
            </div>
          ):(
            <div style={{fontSize:8,color:UI.dim,lineHeight:1.7}}>
              <p style={{margin:"0 0 3px"}}>🖱 Drag: orbit</p>
              <p style={{margin:"0 0 3px"}}>🔄 Scroll: zoom</p>
              <p style={{margin:"0 0 3px"}}>👆 Click: select</p>
              <p style={{margin:"0 0 6px"}}>÷ : trigger division</p>
              <div style={{fontSize:8,color:UI.dim,marginTop:6}}>
                <div style={{display:"flex",alignItems:"center",gap:3,marginBottom:2}}><div style={{width:6,height:6,borderRadius:"50%",background:UI.warn}}/> Closed mitosis</div>
                <div style={{display:"flex",alignItems:"center",gap:3,marginBottom:2}}><div style={{width:6,height:6,borderRadius:"50%",background:UI.success}}/> Open mitosis</div>
                <div style={{display:"flex",alignItems:"center",gap:3}}><div style={{width:6,height:6,borderRadius:"50%",background:UI.purple}}/> Dividing</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
