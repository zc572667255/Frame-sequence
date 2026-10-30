import { rng } from "../../trails/glow/util.js";

export function iceRotate([x, y, z], yaw, pitch, roll) {
  const ax=x*Math.cos(yaw)+z*Math.sin(yaw), az=z*Math.cos(yaw)-x*Math.sin(yaw);
  const by=y*Math.cos(pitch)-az*Math.sin(pitch), bz=y*Math.sin(pitch)+az*Math.cos(pitch);
  return [ax*Math.cos(roll)-by*Math.sin(roll),ax*Math.sin(roll)+by*Math.cos(roll),bz];
}

// Unequal cross-sections fixed in object space. Impact splits this same solid.
export function iceSolid(r, seed) {
  const P=rng(seed*359+29), vertices=[], rings=[], centres=[];
  const angles=Array.from({length:6},(_,j)=>j*Math.PI/3+(P()-0.5)*0.25);
  const widths=Array.from({length:6},()=>0.8+P()*0.32);
  for(const [band,[x,width]] of [[-1.35,0.62],[-0.65,0.94],[0.38,0.52],[1.35,0.23]].entries()){
    const cy=(P()-0.5)*0.14,cz=(P()-0.5)*0.14,ring=[];
    for(let j=0;j<6;j++){
      const rough=0.88+P()*0.24,px=x+(P()-0.5)*(band<2?0.34:0.22),angle=angles[j]+band*0.065;
      ring.push(vertices.length);vertices.push([px*r,(cy+Math.sin(angle)*width*widths[j]*rough)*r,(cz+Math.cos(angle)*width*widths[j]*rough)*r]);
    }
    rings.push(ring);centres.push([x*r,cy*r,cz*r]);
  }
  const tip=[r*(2.45+P()*0.3),r*0.04,-r*0.06];vertices.push(tip);
  return {vertices,rings,centres,tip};
}

export function iceMesh(vertices,sides){
  const centre=[0,1,2].map(k=>vertices.reduce((s,p)=>s+p[k],0)/vertices.length),edges=new Map(),faces=[];
  for(const [id,input] of sides.entries()){
    const side=[...input],a=vertices[side[0]],b=vertices[side[1]],c=vertices[side[2]],u=b.map((v,k)=>v-a[k]),v=c.map((v,k)=>v-a[k]);
    let normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    const length=Math.hypot(...normal);if(length<1e-9)continue;
    if(normal.reduce((s,n,k)=>s+n*(a[k]-centre[k]),0)<0){normal=normal.map(n=>-n);side.reverse();}
    normal=normal.map(n=>n/length);
    const visible=normal[2]>0.000001,light=Math.max(0,-normal[0]*0.22-normal[1]*0.7+normal[2]*0.68),spec=Math.pow(Math.max(0,-normal[1]*0.38+normal[2]*0.925),24);
    for(let j=0;j<3;j++){
      const a=side[j],b=side[(j+1)%3],key=Math.min(a,b)*vertices.length+Math.max(a,b),edge=edges.get(key)||{points:[vertices[a].slice(0,2),vertices[b].slice(0,2)],front:0,light:0};
      if(visible){edge.front++;edge.light=Math.max(edge.light,light);}edges.set(key,edge);
    }
    if(visible)faces.push({id,points:side.map(i=>vertices[i].slice(0,2)),depth:side.reduce((s,i)=>s+vertices[i][2],0)/3,light,spec});
  }
  faces.sort((a,b)=>a.depth-b.depth);
  return {vertices,faces,edges:[...edges.values()].filter(e=>e.front)};
}

export function iceSolidSides(){
  const sides=[];
  for(let band=0;band<3;band++)for(let j=0;j<6;j++){
    const a=band*6+j,b=band*6+(j+1)%6,c=b+6,d=a+6;
    sides.push(...((band+j)%2?[[a,b,d],[b,c,d]]:[[a,b,c],[a,c,d]]));
  }
  for(let j=0;j<6;j++)sides.push([18+j,18+(j+1)%6,24]);
  for(let j=1;j<5;j++)sides.push([0,j,j+1]);
  return sides;
}

export function iceCells(solid){
  const cells=[];
  for(let band=0;band<4;band++)for(let j=0;j<6;j++){
    const k=(j+1)%6,v=[solid.centres[band],solid.vertices[band*6+j],solid.vertices[band*6+k]];let sides;
    if(band===3){v.push(solid.tip);sides=[[0,1,2],[0,1,3],[1,2,3],[2,0,3]];}
    else{
      v.push(solid.centres[band+1],solid.vertices[(band+1)*6+j],solid.vertices[(band+1)*6+k]);
      sides=[[0,1,2],[3,4,5],[0,1,4],[0,4,3],[0,2,5],[0,5,3],...((band+j)%2?[[1,2,4],[2,5,4]]:[[1,2,5],[1,5,4]])];
    }
    const centre=[0,1,2].map(k=>v.reduce((s,p)=>s+p[k],0)/v.length);
    cells.push({vertices:v.map(p=>p.map((n,k)=>n-centre[k])),centre,sides,band});
  }
  return cells;
}
