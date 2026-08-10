/* ================================================================
   hero.js — 홈 화면 배경 애니메이션 동작 코드

   원본: hero.html 의 <script> 블록을 그대로 옮긴 파일.
   내용: hero.data.js 의 LAYOUT 좌표를 캔버스에 그리고, 점들이
         숨 쉬듯 천천히 흔들리는 애니메이션을 돌린다.
   의존: src/hero.data.js (전역 `LAYOUT`) 가 먼저 로드되어야 한다.
   ================================================================ */
const N = LAYOUT.N, L = LAYOUT.L;
const cv = document.getElementById("c"), ctx = cv.getContext("2d", {alpha:true});
let W=1,H=1,K=1,CX=0,CY=0;

const P = N.map((n,i)=>({
  x:n[0], y:n[1], r:n[2], color:n[3], kind:n[4],
  a: (i*2.399963)%6.283185,
  s: 0.16 + (i%7)*0.021,
  d: n[4]===3 ? 3.4 : n[4]===2 ? 2.2 : 1.2
}));
let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;
for(const p of P){ if(p.x<x0)x0=p.x; if(p.x>x1)x1=p.x; if(p.y<y0)y0=p.y; if(p.y>y1)y1=p.y; }
const BW = x1-x0, BH = y1-y0, BX = (x0+x1)/2, BY = (y0+y1)/2;

function resize(){
  const dpr = Math.min(window.devicePixelRatio||1, 2);
  W = cv.clientWidth; H = cv.clientHeight;
  cv.width = Math.round(W*dpr); cv.height = Math.round(H*dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  K = Math.min(W/(BW*1.18), H/(BH*1.18));
  CX = W/2; CY = H/2;
  ctx.lineJoin = ctx.lineCap = "round";
}
addEventListener("resize", resize, {passive:true});

let rot = 0, last = 0, t = 0, raf = 0;
const px = new Float32Array(P.length), py = new Float32Array(P.length);

function frame(now){
  raf = requestAnimationFrame(frame);
  const dt = last ? Math.min((now-last)/1000, 0.05) : 0.016;
  last = now;
  t += dt; rot += dt*0.012;

  const cos = Math.cos(rot), sin = Math.sin(rot);
  for(let i=0;i<P.length;i++){
    const p = P[i];
    const ox = Math.sin(t*p.s + p.a) * p.d;
    const oy = Math.cos(t*p.s*0.83 + p.a*1.7) * p.d;
    const dx = (p.x + ox) - BX, dy = (p.y + oy) - BY;
    px[i] = CX + (dx*cos - dy*sin)*K;
    py[i] = CY + (dx*sin + dy*cos)*K;
  }

  ctx.clearRect(0,0,W,H);
  ctx.lineWidth = Math.max(0.55, 0.9*K);
  ctx.strokeStyle = "rgba(74,124,180,0.20)";
  ctx.beginPath();
  for(let i=0;i<L.length;i++){ const l=L[i]; if(l[2]) continue;
    ctx.moveTo(px[l[0]],py[l[0]]); ctx.lineTo(px[l[1]],py[l[1]]); }
  ctx.stroke();
  ctx.lineWidth = Math.max(0.8, 1.3*K);
  ctx.strokeStyle = "rgba(216,180,90,0.34)";
  ctx.beginPath();
  for(let i=0;i<L.length;i++){ const l=L[i]; if(!l[2]) continue;
    ctx.moveTo(px[l[0]],py[l[0]]); ctx.lineTo(px[l[1]],py[l[1]]); }
  ctx.stroke();

  for(let i=0;i<P.length;i++){
    const p = P[i], r = Math.max(1, p.r*K);
    ctx.beginPath();
    ctx.arc(px[i], py[i], r, 0, 6.283185);
    if(p.kind===2 || p.kind===0){
      ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.fill();
      ctx.strokeStyle = p.color; ctx.lineWidth = Math.max(0.7, 1.1*K); ctx.stroke();
    }else{
      ctx.globalAlpha = p.kind===1 ? 0.95 : 0.82;
      ctx.fillStyle = p.color; ctx.fill(); ctx.globalAlpha = 1;
    }
  }
}

document.addEventListener("visibilitychange", ()=>{
  if(document.hidden){ cancelAnimationFrame(raf); raf=0; }
  else if(!raf){ last=0; raf=requestAnimationFrame(frame); }
});
resize();
raf = requestAnimationFrame(frame);
