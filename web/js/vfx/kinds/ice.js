import { rgba,rng } from "../../trails/glow/util.js";
import { mixRgb, blob } from "../common.js";
import { drawIceGrain } from "./icegrain.js";
import { iceSolid,iceSolidSides,iceMesh,iceRotate } from "./icegeometry.js";
import { drawIceSpear } from "./icemagic.js";

export function icePrism(r,roll,seed=1){
  const solid=iceSolid(r,seed);
  return iceMesh(solid.vertices.map(p=>iceRotate(p,0,roll,0)),iceSolidSides());
}

function polygon(g,points,fill){g.fillStyle=fill;g.beginPath();points.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));g.closePath();g.fill();}

// Fractures live in the crystal, so a full turn around its length brings them back.
export function iceCracks(r, seed, roll) {
  const P = rng(seed * 911 + 13), lines = [];
  for (let i = 0; i < 4; i++) {
    let x = -1.15 + P() * 1.4, y = (P() - 0.5) * 0.34, z = (P() - 0.5) * 0.22;
    const pts = [[x, y, z]];
    for (let k = 0; k < 3; k++) {
      x += 0.28 + P() * 0.42;
      y += (P() - 0.5) * 0.22;
      z += (P() - 0.5) * 0.16;
      pts.push([x, y, z]);
    }
    lines.push(pts.map((p) => iceRotate(p.map((v) => v * r), 0, roll, 0).slice(0, 2)));
  }
  return lines;
}

export function iceFaceCracks(points,seed){
  const P=rng(seed),mix=(a,b,t)=>a.map((n,k)=>n+(b[k]-n)*t),centre=[0,1].map(k=>points.reduce((s,p)=>s+p[k],0)/3);
  const a=mix(points[0],points[1],0.15+P()*0.55),b=mix(centre,points[2],P()*0.35),c=mix(points[1],points[2],0.2+P()*0.6);
  return [[a,mix(mix(a,b,0.5),centre,0.15+P()*0.3),b],[b,c]];
}

// The intact cone and its shards share dark ice, frosted cuts and reflections.
export function drawIceMesh(g,mesh,pal,seed,r,alpha=1){
  for(const face of mesh.faces){
    g.globalCompositeOperation="source-over";
    const deep=mixRgb(pal.cols[Math.min(1,pal.cols.length-1)],pal.cols[0],0.22);
    const body=mixRgb(deep,pal.rim,0.35+face.light*0.45),lit=mixRgb(body,pal.core,0.18+face.light*0.34+face.spec*0.62);
    const cover=alpha*(0.9+face.light*0.08);
    const pts=face.points,grad=g.createLinearGradient(...pts[0],...pts[2]);
    grad.addColorStop(0,rgba(body,cover));grad.addColorStop(1,rgba(lit,cover));polygon(g,pts,grad);
    const key=seed*419+face.id*17+7;
    drawIceGrain(g,pts,pal,key,alpha*(0.16+face.light*0.18));
    g.strokeStyle=rgba(mixRgb(pal.core,pal.rim,0.35),alpha*(0.12+face.spec*0.45));g.lineWidth=Math.max(0.35,r*0.01);
    for(const path of iceFaceCracks(pts,key)){g.beginPath();path.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));g.stroke();}
  }
  g.save();
  g.globalCompositeOperation=pal.dark?"source-over":"lighter";
  g.lineCap="round";
  for(const edge of mesh.edges){
    const rim=edge.front===1,bright=Math.pow(edge.light,6);
    g.strokeStyle=rgba(mixRgb(pal.core,pal.rim,rim?0.15:0.45),alpha*(rim?0.72+bright*0.28:0.16+bright*0.35));
    g.lineWidth=Math.max(0.6,r*(rim?0.034:0.014));
    g.beginPath();g.moveTo(...edge.points[0]);g.lineTo(...edge.points[1]);g.stroke();
  }
  g.restore();
}

// 飞行中的冰矛画成一把光刃（icePrism 的晶体网格只留给命中时的碎块）
export function drawIcePrism(g,c,r){
  drawIceSpear(g,c,r);
}
