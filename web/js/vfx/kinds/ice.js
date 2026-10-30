import { rgba,rng } from "../../trails/glow/util.js";
import { mixRgb } from "../common.js";
import { drawIceGrain } from "./icegrain.js";
import { iceSolid,iceSolidSides,iceMesh,iceRotate } from "./icegeometry.js";

export function icePrism(r,roll,seed=1){
  const solid=iceSolid(r,seed);
  return iceMesh(solid.vertices.map(p=>iceRotate(p,0,roll,0)),iceSolidSides());
}

export function iceTrailProfile(r,roll,seed=1){
  const vertices=icePrism(r,roll,seed).vertices,lo=Math.min(...vertices.map(p=>p[1])),hi=Math.max(...vertices.map(p=>p[1]));
  return {half:(hi-lo)/2,offset:(hi+lo)/2};
}
export const iceTrailHalfWidth=(r,roll,seed=1)=>iceTrailProfile(r,roll,seed).half;

function polygon(g,points,fill){g.fillStyle=fill;g.beginPath();points.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));g.closePath();g.fill();}

export function iceFaceCracks(points,seed){
  const P=rng(seed),mix=(a,b,t)=>a.map((n,k)=>n+(b[k]-n)*t),centre=[0,1].map(k=>points.reduce((s,p)=>s+p[k],0)/3);
  const a=mix(points[0],points[1],0.15+P()*0.55),b=mix(centre,points[2],P()*0.35),c=mix(points[1],points[2],0.2+P()*0.6);
  return [[a,mix(mix(a,b,0.5),centre,0.15+P()*0.3),b],[b,c]];
}

// The intact cone and its shards share dark ice, frosted cuts and reflections.
export function drawIceMesh(g,mesh,pal,seed,r,alpha=1){
  for(const face of mesh.faces){
    g.globalCompositeOperation="source-over";
    const deep=pal.cols[0].map(v=>Math.round(v*0.48)),blue=mixRgb(deep,pal.rim,0.12+face.light*0.38),lit=mixRgb(blue,pal.core,0.05+face.light*face.light*0.38+face.spec*0.24);
    const pts=face.points,grad=g.createLinearGradient(...pts[0],...pts[2]);
    grad.addColorStop(0,rgba(blue,alpha*0.94));grad.addColorStop(1,rgba(lit,alpha*0.94));polygon(g,pts,grad);
    const key=seed*419+face.id*17+7;
    drawIceGrain(g,pts,pal,key,alpha*(0.3+face.light*0.35));
    g.strokeStyle=rgba(mixRgb(pal.rim,pal.core,0.55),alpha*(0.08+face.spec*0.25));g.lineWidth=Math.max(0.3,r*0.009);
    for(const path of iceFaceCracks(pts,key)){g.beginPath();path.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));g.stroke();}
  }
  g.globalCompositeOperation=pal.dark?"source-over":"lighter";
  for(const edge of mesh.edges){
    const rim=edge.front===1,bright=Math.pow(edge.light,8);
    g.strokeStyle=rgba(mixRgb(pal.rim,pal.core,0.42),alpha*(rim?0.24+bright*0.35:0.015+bright*0.13));g.lineWidth=Math.max(0.35,r*(rim?0.018:0.009));
    g.beginPath();g.moveTo(...edge.points[0]);g.lineTo(...edge.points[1]);g.stroke();
  }
}

export function drawIcePrism(g,c,r){drawIceMesh(g,icePrism(r,c.t*Math.PI*2+c.seed,c.seed),c.pal,c.seed,r);}
