import { rng,rgba,smooth } from "../../trails/glow/util.js";
import { TAU,mixRgb,blob } from "../common.js";
import { drawPuff } from "../remotetrail.js";
import { drawIceMesh } from "./ice.js";
import { iceSolid,iceCells,iceMesh,iceRotate } from "./icegeometry.js";
export { iceFaceCracks } from "./ice.js";

export function iceDebris(r,amount,seed,t,angle=0,bodyRadius=r*0.42,roll=seed){
  const P=rng(seed*227+61),cells=iceCells(iceSolid(bodyRadius,seed)),out=[];
  for(let j=0,count=24+Math.round(20*Math.max(0,Math.min(2,amount)));j<count;j++){
    const cell=cells[j%24],chip=j>=24,scale=chip?0.12+P()*0.22:1;
    const born=chip?0.025+P()*0.055:0,age=Math.max(0,t-born),drift=age*(1-age*0.4);
    const phi=angle+j*2.39996+(P()-0.5)*0.7,speed=r*(chip?1.8+P()*1.9:0.8+P()*1.4);
    const spin=(P()<0.5?-1:1)*(chip?3+P()*4:0.8+P()*2.2),life=0.8+P()*0.2;
    const centre=iceRotate(cell.centre,0,roll,angle);
    const at=[centre[0]+(Math.cos(phi)*speed+Math.cos(angle)*r*0.3)*drift,centre[1]+(Math.sin(phi)*speed*0.85+Math.sin(angle)*r*0.3-r*0.35)*drift+r*age*age*0.9];
    const vertices=cell.vertices.map(p=>iceRotate(iceRotate(p.map(v=>v*scale),0,roll,0),spin*age*0.7,spin*age,angle+spin*age*0.5));
    const mesh=iceMesh(vertices,cell.sides);
    out.push({...mesh,id:j,at,depth:centre[2],radius:Math.max(...vertices.map(p=>Math.hypot(...p))),alpha:t<born?0:1-smooth(life*0.6,life,t)});
  }
  return out;
}

export function frostCracks(r,seed,t){
  const P=rng(seed*401+71),growth=smooth(0,0.18,t),paths=[],point=(a,l)=>[Math.cos(a)*l*growth,Math.sin(a)*l*growth*0.45];
  for(let j=0;j<6;j++){
    const a=j*TAU/6+(P()-0.5)*0.45,length=r*(0.55+P()*0.5),bend=(P()-0.5)*0.4,p=point(a+bend,length*0.55);
    paths.push([[0,0],point(a-bend,length*0.25),p,point(a,length)],[p,point(a+(j%2?-0.38:0.38),length*0.8)]);
  }
  return paths;
}

export function drawIceImpact(g,c,radius,angle){
  const {t,pal}=c,P=rng(c.seed*331+19),flash=1-smooth(0,0.12,t);
  g.save();g.translate(c.cx,c.cy);g.globalCompositeOperation=pal.dark?"source-over":"lighter";
  g.strokeStyle=rgba(mixRgb(pal.rim,pal.core,0.4),(1-t)**2*0.18);g.lineWidth=Math.max(0.35,radius*0.008);
  for(const path of frostCracks(radius,c.seed,t)){g.beginPath();path.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));g.stroke();}
  for(let j=0;j<3;j++){
    const a=P()*TAU,x=Math.cos(a)*radius*t*0.65,y=Math.sin(a)*radius*t*0.3;
    drawPuff(g,x,y,radius*(0.12+t*0.25),a,pal.rim,smooth(0,0.1,t)*(1-t)**2*0.065*Math.min(1.5,c.amount),j+c.seed,1.8);
  }
  const pieces=iceDebris(radius,c.amount,c.seed,t,angle,c.bodyRadius,c.iceRoll).sort((a,b)=>a.depth-b.depth);
  for(const piece of pieces){
    if(piece.alpha<=0)continue;
    g.save();g.translate(...piece.at);drawIceMesh(g,piece,pal,c.seed+piece.id*131,Math.max(1,piece.radius),piece.alpha);g.restore();
  }
  g.globalCompositeOperation=pal.dark?"source-over":"lighter";
  blob(g,0,0,radius*0.22,[[0,pal.core,flash*0.42],[0.25,pal.rim,flash*0.18],[1,pal.rim,0]]);
  g.restore();
}
