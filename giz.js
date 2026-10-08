/* Cursor de giz / canetão.
   - A setinha vira um giz (ou um canetão, quando o visitante escolhe "Quadro de canetão").
   - Só escreve enquanto o botão ESQUERDO do mouse estiver pressionado; o rabisco some do começo até a ponta.
   - Só ativa com mouse (não em celular/tablet) e respeita "reduzir movimento".
   - O estilo escolhido fica guardado em localStorage ('lousa.estilo' = 'g' giz | 'm' canetão). */
(()=>{
if(!matchMedia('(hover:hover) and (pointer:fine)').matches||matchMedia('(prefers-reduced-motion:reduce)').matches)return;
const KEY='lousa.estilo',root=document.documentElement,P=[];
let mode='g',run=false,down=false,fresh=false,W,H,D;
try{mode=localStorage.getItem(KEY)==='m'?'m':'g'}catch(e){}
const CFG={
 g:{rgb:'242,239,228',life:900,blur:5,tip:[3,31],
    w:k=>1.2+3.2*k,a:k=>k*k*.6,
    svg:'<svg viewBox="0 0 40 40"><path d="M6 28L28 6" stroke="#f2efe4" stroke-width="9" stroke-linecap="round"/><path d="M12 22L22 12" stroke="#cfcab8" stroke-width="2" stroke-linecap="round" opacity=".55"/><path d="M3.4 30.6L7 27" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".9"/></svg>'},
 m:{rgb:'255,90,77',life:1200,blur:1.5,tip:[4,36],
    w:k=>1.5+4.5*Math.pow(k,.6),a:k=>Math.min(.95,k*3),
    svg:'<svg viewBox="0 0 40 40"><g transform="translate(4 36) rotate(45)"><path d="M0 0L-3.2-8H3.2Z" fill="#ff5a4d"/><rect x="-5" y="-30" width="10" height="22" rx="2.5" fill="#f2efe4"/><rect x="-5" y="-23" width="10" height="5" fill="#ff5a4d"/><rect x="-5.6" y="-40" width="11.2" height="10" rx="2.5" fill="#2b3447"/></g></svg>'}
};
const st=document.createElement('style');
st.textContent='.gz-on,.gz-on *{cursor:none!important}.gz-on input,.gz-on textarea{cursor:text!important}'+
'.gz-ink,.gz-ink *{user-select:none!important;-webkit-user-select:none!important}'+
'#gz-c{position:fixed;inset:0;width:100%;height:100%;z-index:299;pointer-events:none}'+
'#gz{position:fixed;left:0;top:0;width:40px;height:40px;z-index:300;pointer-events:none;opacity:0;transition:opacity .2s;will-change:transform;filter:drop-shadow(0 3px 4px #0009)}'+
'#gz svg{display:block;width:100%;height:100%;transition:transform .12s}.gz-dn #gz svg{transform:scale(.88)}';
document.head.appendChild(st);
const cv=document.createElement('canvas');cv.id='gz-c';
const g=document.createElement('div');g.id='gz';g.setAttribute('aria-hidden','true');
document.body.append(cv,g);
const cx=cv.getContext('2d');
function skin(){const c=CFG[mode];g.innerHTML=c.svg;g.firstChild.style.transformOrigin=c.tip[0]+'px '+c.tip[1]+'px'}
skin();
window.addEventListener('gz-mode',e=>{mode=e.detail==='m'?'m':'g';skin();P.length=0});
function rs(){D=Math.min(devicePixelRatio||1,2);W=innerWidth;H=innerHeight;cv.width=W*D;cv.height=H*D;cx.setTransform(D,0,0,D,0,0)}
rs();addEventListener('resize',rs);
root.classList.add('gz-on');
function tick(){
 const c=CFG[mode],n=performance.now();
 while(P.length&&n-P[0].t>c.life)P.shift();
 cx.clearRect(0,0,W,H);cx.lineCap='round';cx.lineJoin='round';
 for(let i=1;i<P.length;i++){
  const a=P[i-1],b=P[i];if(b.s)continue;
  const k=1-(n-b.t)/c.life;if(k<=0)continue;
  const al=c.a(k);
  cx.strokeStyle='rgba('+c.rgb+','+al+')';cx.shadowColor='rgba('+c.rgb+','+al+')';cx.shadowBlur=c.blur;
  cx.lineWidth=c.w(k);
  cx.beginPath();cx.moveTo(a.x,a.y);cx.lineTo(b.x,b.y);cx.stroke();
 }
 if(P.length)requestAnimationFrame(tick);else{run=false;cx.clearRect(0,0,W,H)}
}
function push(x,y,s){P.push({x,y,t:performance.now(),s});if(!run){run=true;requestAnimationFrame(tick)}}
function stop(){down=false;root.classList.remove('gz-dn','gz-ink')}
addEventListener('pointerdown',e=>{
 if(e.pointerType!=='mouse'||e.button!==0)return;
 root.classList.add('gz-dn');
 if(e.target.closest&&e.target.closest('input,textarea,select,[contenteditable="true"]'))return;
 down=true;fresh=true;root.classList.add('gz-ink');
},{capture:true});
addEventListener('pointerup',stop);
addEventListener('pointercancel',stop);
addEventListener('blur',stop);
addEventListener('pointermove',e=>{
 if(e.pointerType!=='mouse')return;
 const x=e.clientX,y=e.clientY,t=CFG[mode].tip;
 g.style.opacity=1;g.style.transform='translate('+(x-t[0])+'px,'+(y-t[1])+'px)';
 if(!down)return;
 if(!(e.buttons&1)){stop();return}
 const l=P[P.length-1];
 if(!fresh&&l&&Math.hypot(x-l.x,y-l.y)<1.5)return;
 push(x,y,fresh);fresh=false;
},{passive:true});
root.addEventListener('mouseleave',()=>{g.style.opacity=0});
})();
