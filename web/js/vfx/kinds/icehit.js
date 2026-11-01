import { rng,rgba,smooth } from "../../trails/glow/util.js";
import { TAU,mixRgb,blob,ring,streak } from "../common.js";
import { drawPuff } from "../remotetrail.js";
import { drawIceMesh } from "./ice.js";
import { drawIceBurst } from "./icemagic.js";
import { iceSolid,iceCells,iceMesh,iceRotate } from "./icegeometry.js";
export { iceFaceCracks } from "./ice.js";

export function iceDebris(r,amount,seed,t,angle=0,bodyRadius=r*0.42,roll=seed){
  const P=rng(seed*227+61),cells=iceCells(iceSolid(bodyRadius,seed)),out=[];
  for(let j=0,count=12+Math.round(8*Math.max(0,Math.min(2,amount)));j<count;j++){
    const cell=cells[j%24],chip=j>=12,scale=chip?0.16+P()*0.28:1;
    const born=chip?0.02+P()*0.05:0,age=Math.max(0,t-born),drift=1-(1-Math.min(1,age/0.45))**2;
    const phi=angle+j*2.39996+(P()-0.5)*0.7,speed=r*(chip?2.4+P()*2.2:1.4+P()*1.7);
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

function strokePath(g, path) {
  g.beginPath(); path.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke();
}

export function drawIceImpact(g,c,radius,angle){
  const {t,pal}=c,flash=1-smooth(0,0.22,t),fade=(1-t)**1.15;
  g.save();g.translate(c.cx,c.cy);
  g.globalCompositeOperation=pal.dark?"source-over":"lighter";
  const wave=1-(1-Math.min(1,t/0.42))**2.2;
  ring(g,0,0,Math.max(0.6,wave*radius*1.25),Math.max(0.8,radius*0.045),0.62,pal.core,fade*0.85);
  ring(g,0,0,Math.max(0.4,wave*radius*0.72),Math.max(0.5,radius*0.02),0.5,pal.rim,fade*0.45);
  g.lineCap="round";g.lineJoin="round";
  for(const path of frostCracks(radius*1.15,c.seed,t)){
    g.strokeStyle=rgba(pal.rim,fade*0.28);g.lineWidth=Math.max(1.4,radius*0.04);strokePath(g,path);
    g.strokeStyle=rgba(mixRgb(pal.core,pal.rim,0.25),fade*0.9);g.lineWidth=Math.max(0.55,radius*0.014);strokePath(g,path);
  }
  const P=rng(c.seed*331+19);
  for(let j=0;j<5;j++){
    const a=P()*TAU,x=Math.cos(a)*radius*t*0.7,y=Math.sin(a)*radius*t*0.32;
    drawPuff(g,x,y,radius*(0.16+t*0.38),a,pal.rim,smooth(0,0.08,t)*fade*0.2*Math.min(1.5,c.amount),j+c.seed,1.6);
  }
  const pieces=iceDebris(radius,c.amount,c.seed,t,angle,c.bodyRadius,c.iceRoll).sort((a,b)=>a.depth-b.depth);
  for(const piece of pieces){
    if(piece.alpha<=0)continue;
    g.save();g.translate(...piece.at);g.globalCompositeOperation=pal.dark?"source-over":"lighter";blob(g,0,0,Math.max(1,piece.radius)*2.2,[[0,pal.rim,piece.alpha*0.35],[1,pal.rim,0]]);drawIceMesh(g,piece,pal,c.seed+piece.id*131,Math.max(1,piece.radius),piece.alpha*0.72);g.restore();
  }
  drawIceBurst(g,pal,radius,c.seed,t,angle,c.amount);
  g.globalCompositeOperation=pal.dark?"source-over":"lighter";
  const S=rng(c.seed*809+3);
  for(let j=0;j<7;j++){
    const a=angle+(S()-0.5)*2.4,len=radius*(0.35+S()*0.85)*wave,w=Math.max(0.6,radius*(0.012+S()*0.012));
    streak(g,[Math.cos(a)*len*0.15,Math.sin(a)*len*0.15],[Math.cos(a)*len,Math.sin(a)*len],pal.rim,pal.core,fade*(0.35+S()*0.4),w);
  }
  g.save();g.rotate(angle);g.scale(1.55,0.22);
  blob(g,radius*0.05,0,radius*0.95,[[0,pal.core,flash*0.95],[0.35,pal.rim,flash*0.4],[1,pal.rim,0]]);
  g.restore();
  blob(g,0,0,radius*(0.28+flash*0.55),[[0,pal.core,Math.max(flash,fade*0.35)],[0.3,pal.core,flash*0.55],[1,pal.rim,0]]);
  g.restore();
}
