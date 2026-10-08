/* Cursor de giz: troca a setinha por um giz e deixa rabiscos suaves que somem do começo até o giz.
   Só ativa com mouse (não em celular/tablet) e respeita "reduzir movimento". */
(()=>{
if(!matchMedia('(hover:hover) and (pointer:fine)').matches||matchMedia('(prefers-reduced-motion:reduce)').matches)return;
const LIFE=900,GAP=160,P=[];let run=false,W,H,D;
const st=document.createElement('style');
st.textContent='.gz-on,.gz-on *{cursor:none!important}.gz-on input,.gz-on textarea{cursor:text!important}'+
'#gz-c{position:fixed;inset:0;width:100%;height:100%;z-index:299;pointer-events:none}'+
'#gz{position:fixed;left:0;top:0;width:34px;height:34px;z-index:300;pointer-events:none;opacity:0;transition:opacity .2s;will-change:transform;filter:drop-shadow(0 3px 4px #0009)}'+
'#gz svg{display:block;width:100%;height:100%;transform-origin:3px 31px;transition:transform .12s}.gz-dn #gz svg{transform:scale(.86)}';
document.head.appendChild(st);
const cv=document.createElement('canvas');cv.id='gz-c';
const g=document.createElement('div');g.id='gz';g.setAttribute('aria-hidden','true');
g.innerHTML='<svg viewBox="0 0 40 40"><path d="M6 28L28 6" stroke="#f2efe4" stroke-width="9" stroke-linecap="round"/><path d="M12 22L22 12" stroke="#cfcab8" stroke-width="2" stroke-linecap="round" opacity=".55"/><path d="M3.4 30.6L7 27" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".9"/></svg>';
document.body.append(cv,g);
const cx=cv.getContext('2d');
function rs(){D=Math.min(devicePixelRatio||1,2);W=innerWidth;H=innerHeight;cv.width=W*D;cv.height=H*D;cx.setTransform(D,0,0,D,0,0)}
rs();addEventListener('resize',rs);
document.documentElement.classList.add('gz-on');
function tick(){
 const n=performance.now();
 while(P.length&&n-P[0].t>LIFE)P.shift();
 cx.clearRect(0,0,W,H);cx.lineCap='round';cx.lineJoin='round';
 for(let i=1;i<P.length;i++){
  const a=P[i-1],b=P[i];if(b.s)continue;
  const k=1-(n-b.t)/LIFE;if(k<=0)continue;
  const al=k*k*.6;
  cx.strokeStyle='rgba(242,239,228,'+al+')';cx.shadowColor='rgba(242,239,228,'+al+')';cx.shadowBlur=5;
  cx.lineWidth=1.2+3.2*k;
  cx.beginPath();cx.moveTo(a.x,a.y);cx.lineTo(b.x,b.y);cx.stroke();
 }
 if(P.length)requestAnimationFrame(tick);else{run=false;cx.clearRect(0,0,W,H)}
}
addEventListener('pointermove',e=>{
 if(e.pointerType!=='mouse')return;
 const x=e.clientX,y=e.clientY,t=performance.now();
 g.style.opacity=1;g.style.transform='translate('+(x-3)+'px,'+(y-31)+'px)';
 const l=P[P.length-1];
 if(l&&Math.hypot(x-l.x,y-l.y)<1.5)return;
 P.push({x,y,t,s:!l||t-l.t>GAP});
 if(!run){run=true;requestAnimationFrame(tick)}
},{passive:true});
addEventListener('pointerdown',()=>document.documentElement.classList.add('gz-dn'));
addEventListener('pointerup',()=>document.documentElement.classList.remove('gz-dn'));
document.documentElement.addEventListener('mouseleave',()=>{g.style.opacity=0});
})();
