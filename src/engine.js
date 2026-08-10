/* ================================================================
   engine.js — 지도 화면의 동작 코드 전체

   원본: engine.html 의 <script> 블록([2]~[10] 섹션)을 그대로 옮긴 것.
   의존: ① src/vendor/d3.v7.min.js — 전역 `d3` (그리기·물리 시뮬레이션)
         ② src/engine.data.js      — 전역 `DATA` (기업 466곳 데이터)
   주의: 반드시 d3 → engine.data.js → engine.js 순서로 로드해야 한다.
         engine.html 맨 아래의 <script src=…> 세 줄이 그 순서다.
   구성: [2] 설정 → [3] 데이터 인덱스 → [4] 상태 → [5] 그래프 구성 →
         [6] 렌더링 → [7] 상호작용 → [8] 상세 패널 → [9] UI →
         [10] 부트스트랩(시작점)
   ================================================================ */

/* ================================================================
   [2] 설정 — 색·크기·기본 힘. [디자인 교체 지점]
   ----------------------------------------------------------------
   섹터별 색, 노드(원)의 크기, 물리 시뮬레이션 힘의 기본값을 모아 둔 곳.
   지도의 색감·크기·움직임을 바꾸고 싶으면 이 섹션의 값만 만지면 된다.
   ================================================================ */
const SECTOR_COLORS = {
  "물·수자원":"#4a90d9", "대기·공기질":"#56b8d0", "폐기물 처리":"#c98544",
  "재활용·순환경제":"#54b06a", "토양·지하수":"#9c7a52", "측정·분석·모니터링":"#8f7fd8",
  "기후·에너지":"#d8b13c", "탄소·ESG":"#4fae9c", "환경 엔지니어링·컨설팅":"#7e8ea6",
  "생태·해양·기타":"#c06fb0", "공공·연구":"#c25f5f",
  "대기업 환경·ESG 조직":"#dd8f6a", "ESG 공시·검증·자문":"#6f9fd8"
};
/* ── 내 메모 (브라우저 로컬 저장) ───────────────────────────── */
const NOTE_KEY = "econ:notes:v1";
let NOTES = {};
try { NOTES = JSON.parse(localStorage.getItem(NOTE_KEY) || "{}") || {}; } catch(e){ NOTES = {}; }
function saveNotes(){ try{ localStorage.setItem(NOTE_KEY, JSON.stringify(NOTES)); }catch(e){} }
function noteCount(){ return Object.keys(NOTES).length; }
function setNote(id, text){
  const t = (text||"").trim();
  if(t) NOTES[id] = { t, at: Date.now() }; else delete NOTES[id];
  saveNotes(); renderMemoList(); draw();
}
const REL_COLORS = {"계열":"#d8b45a","인수":"#d87a5a","투자":"#6ab4dc","협력":"#84c884","합작":"#c084d8"};
const REL_LIST = ["계열","인수","투자","협력","합작"];
const TYPE_LIST = ["대기업","대기업 환경조직","중견기업","중소기업","스타트업","공공·연구","해외 대표"];
// 규모 등급(4 대형 / 3 중견 / 2 중소 / 1 신생) → 기본 반지름. [디자인 교체 지점]
const SCALE_R = {4:9.5, 3:7.0, 2:5.2, 1:3.8};
const SCALE_LABEL = {4:"대형", 3:"중견", 2:"중소", 1:"신생"};
const LISTED_GROUPS = ["코스피","코스닥","비상장·기타"];
const CFG = {
  labelColor:"#123150", labelDim:"rgba(18,49,79,0.26)",
  affilEdge:"rgba(70,115,165,0.16)", structEdge:"rgba(55,100,155,0.32)",
  dimAlpha:0.10, rootColor:"#8aa3bd",
  localCap:250
};

/* ================================================================
   [3] 파생 데이터 인덱스
   ----------------------------------------------------------------
   engine.data.js 의 원본 DATA 를 빨리 찾아 쓸 수 있게 색인을 만든다.
   예: id 로 기업 찾기(compById), 기업마다 연결된 관계 목록(relAdj).
   화면이 바뀔 때마다 원본을 뒤지지 않도록 한 번만 계산해 둔다.
   ================================================================ */
const companies = DATA.companies;
const compById = new Map(companies.map(c=>[c.id,c]));
const relAdj = new Map();     // id -> [{id,rel}]
const relDeg = new Map();     // id -> 기업 간 관계 수
for(const e of DATA.edges){
  if(!relAdj.has(e.a)) relAdj.set(e.a,[]);
  if(!relAdj.has(e.b)) relAdj.set(e.b,[]);
  relAdj.get(e.a).push({id:e.b, rel:e.rel});
  relAdj.get(e.b).push({id:e.a, rel:e.rel});
  relDeg.set(e.a,(relDeg.get(e.a)||0)+1);
  relDeg.set(e.b,(relDeg.get(e.b)||0)+1);
}
const membersBySub = new Map();  // "sector|sub" -> [company]
for(const c of companies){
  const k = c.sector+"|"+c.subsector;
  if(!membersBySub.has(k)) membersBySub.set(k,[]);
  membersBySub.get(k).push(c);
}
function listedGroup(c){
  if(c.listed==="코스피") return "코스피";
  if(c.listed==="코스닥") return "코스닥";
  return "비상장·기타";
}

/* ================================================================
   [4] 상태
   ----------------------------------------------------------------
   "지금 화면이 어떤 상태인가"를 담는 단 하나의 객체(state).
   어떤 지도를 보는지, 검색어, 켜진 필터, 선택된 기업이 모두 여기
   기록되고, 나머지 코드는 이 객체를 읽어 화면을 다시 그린다.
   ================================================================ */
const state = {
  map:"all",                          // "all" 또는 sector 이름
  q:"",
  types:new Set(TYPE_LIST),
  listed:new Set(LISTED_GROUPS),
  conf:new Set(["확인","추정"]),
  sectorOn:new Set(DATA.sectors.map(s=>s.name)),  // 전체 지도용
  subOn:null,                         // 분야 지도용 Set (map 전환 시 재설정)
  rels:new Set(),
  showHubs:true,
  hideOrphans:false,
  labelMode:"auto",                   // auto | always | off
  sizeBy:"scale",                     // scale | degree | uniform
  sizeScale:1,
  forces:{repel:140, link:60, center:0.06},
  local:null,                         // {id, depth}
  selected:null, hover:null
};

/* ================================================================
   [5] 그래프 구성 (필터 → 노드/링크)
   ----------------------------------------------------------------
   state 의 필터 조건에 맞는 기업만 골라 노드/링크 목록으로 바꾼다.
   필터·검색이 바뀔 때마다 다시 실행되어 지도에 보일 것을 정한다.
   ================================================================ */
const posCache = new Map();           // id -> {x,y}
let nodes=[], links=[], nodeById=new Map(), adj=new Map(), visCompanyCount=0;

function matchQ(c,q){
  if(!q) return true;
  const hay = (c.name+" "+c.subsector+" "+(c.desc||"")+" "+(c.tags||[]).join(" ")).toLowerCase();
  return q.toLowerCase().split(/\s+/).every(w=>hay.includes(w));
}
function baseVisible(c){
  if(state.memoOnly && !NOTES[c.id]) return false;
  return state.types.has(c.type) && state.listed.has(listedGroup(c)) && state.conf.has(c.conf);
}
function renderMemoList(){
  const el = document.getElementById("memoList"); if(!el) return;
  const ids = Object.keys(NOTES).sort((a,b)=>(NOTES[b].at||0)-(NOTES[a].at||0)).filter(id=>compById.has(id));
  const cnt = document.getElementById("memoCnt");
  if(cnt) cnt.textContent = ids.length ? ids.length + "개" : "";
  const only = document.getElementById("memoOnly");
  if(only){ only.classList.toggle("on", !!state.memoOnly); only.textContent = state.memoOnly ? "전체 다시 보기" : "메모한 기업만 보기"; }
  if(!ids.length){ el.innerHTML = '<div class="empty">기업을 클릭해 상세 카드 아래에 메모를 남겨보세요. 이 브라우저에만 저장됩니다.</div>'; return; }
  el.innerHTML = ids.map(id=>{
    const c = compById.get(id);
    return `<div class="mi" data-id="${id}"><span class="dot" style="background:${SECTOR_COLORS[c.sector]}"></span><div class="tx"><b>${esc(c.name)}</b><span>${esc(NOTES[id].t)}</span></div></div>`;
  }).join("");
  el.querySelectorAll(".mi").forEach(d=> d.onclick=()=>{
    const id = d.dataset.id;
    if(!nodeById.has(id)){ state.local=null; state.memoOnly=false; state.map="all"; rebuild(); }
    setTimeout(()=>{ select(id); centerOn(id); }, 30);
  });
}
function neighborsOf(id){
  // 로컬 그래프용 인접: 직접 관계 + 같은 세부분야
  const c = compById.get(id); if(!c) return [];
  const out = new Set((relAdj.get(id)||[]).map(x=>x.id));
  for(const m of membersBySub.get(c.sector+"|"+c.subsector)||[]) if(m.id!==id) out.add(m.id);
  return [...out];
}
function localSet(){
  const {id, depth} = state.local;
  const seen = new Set([id]);
  let frontier = [id];
  for(let d=0; d<depth; d++){
    const next=[];
    for(const f of frontier){
      for(const n of neighborsOf(f)){
        if(!seen.has(n) && seen.size < CFG.localCap){ seen.add(n); next.push(n); }
      }
    }
    frontier = next;
  }
  return seen;
}

function buildGraph(){
  let vis;
  if(state.local && compById.has(state.local.id)){
    const ls = localSet();
    vis = companies.filter(c=>ls.has(c.id) && baseVisible(c));
  }else{
    vis = companies.filter(c=>{
      if(!baseVisible(c)) return false;
      if(state.map==="all"){ if(!state.sectorOn.has(c.sector)) return false; }
      else{
        if(c.sector!==state.map) return false;
        if(state.subOn && !state.subOn.has(c.subsector)) return false;
      }
      return matchQ(c,state.q);
    });
  }
  visCompanyCount = vis.length;

  nodes=[]; links=[];
  const nById = new Map();
  const addNode = n=>{ nodes.push(n); nById.set(n.id,n); return n; };

  // 기업 노드 — 반지름은 state.sizeBy 기준
  for(const c of vis){
    const deg = relDeg.get(c.id)||0;
    let base;
    if(state.sizeBy==="degree")      base = 3.8 + Math.min(deg,10)*1.1;
    else if(state.sizeBy==="uniform") base = 5.5;
    else                              base = (SCALE_R[c.scale]||5) + Math.min(deg,6)*0.35;
    addNode({id:c.id, kind:"company", name:c.name, ref:c,
      color:SECTOR_COLORS[c.sector]||"#999",
      r: base * state.sizeScale});
  }

  // 분류 허브 노드 + 소속/구조 링크
  if(state.showHubs){
    const secCount = new Map(), subCount = new Map();
    for(const c of vis){
      secCount.set(c.sector,(secCount.get(c.sector)||0)+1);
      const sk = c.sector+"|"+c.subsector;
      subCount.set(sk,(subCount.get(sk)||0)+1);
    }
    const multiSector = state.map==="all" || state.local;
    for(const [sec,cnt] of secCount){
      addNode({id:"S|"+sec, kind:"sector", name:sec, sector:sec,
        color:SECTOR_COLORS[sec]||"#999", r:(11+Math.min(cnt*0.12,9))*state.sizeScale, members:cnt});
    }
    for(const [sk,cnt] of subCount){
      const [sec,sub] = sk.split("|");
      addNode({id:"B|"+sk, kind:"sub", name:sub, sector:sec, sub:sub,
        color:SECTOR_COLORS[sec]||"#999", r:(6.5+Math.min(cnt*0.35,8))*state.sizeScale, members:cnt});
      links.push({source:"B|"+sk, target:"S|"+sec, etype:"구조"});
    }
    for(const c of vis){
      links.push({source:c.id, target:"B|"+c.sector+"|"+c.subsector, etype:"소속"});
    }
    if(multiSector && secCount.size>1){
      addNode({id:"ROOT", kind:"root", name:"환경산업", color:CFG.rootColor, r:20*state.sizeScale});
      for(const [sec] of secCount) links.push({source:"S|"+sec, target:"ROOT", etype:"구조"});
    }
  }

  // 기업 간 관계 링크
  for(const e of DATA.edges){
    if(!state.rels.has(e.rel)) continue;
    if(nById.has(e.a) && nById.has(e.b)) links.push({source:e.a, target:e.b, etype:e.rel});
  }

  // 고아 숨기기
  if(state.hideOrphans){
    const linked = new Set();
    for(const l of links){ linked.add(l.source); linked.add(l.target); }
    const drop = new Set(nodes.filter(n=>n.kind==="company" && !linked.has(n.id)).map(n=>n.id));
    if(drop.size){
      nodes = nodes.filter(n=>!drop.has(n.id));
      for(const id of drop) nById.delete(id);
      visCompanyCount -= drop.size;
    }
  }

  // 위치 시드: 캐시 → 허브 주변 → 원형 배치
  const secIdx = new Map(DATA.sectors.map((s,i)=>[s.name,i]));
  const R = 620;
  for(const n of nodes){
    const p = posCache.get(n.id);
    if(p){ n.x=p.x; n.y=p.y; continue; }
    let ax=0, ay=0;
    const i = secIdx.get(n.sector ?? n.ref?.sector) ?? 0;
    const ang = (i/11)*Math.PI*2;
    if(n.kind==="root"){ ax=0; ay=0; }
    else if(n.kind==="sector"){ ax=Math.cos(ang)*R; ay=Math.sin(ang)*R; }
    else { ax=Math.cos(ang)*R*1.25; ay=Math.sin(ang)*R*1.25; }
    n.x = ax + (Math.random()-0.5)*140;
    n.y = ay + (Math.random()-0.5)*140;
  }
  nodeById = nById;

  // 하이라이트용 인접표 (현재 링크 기준)
  adj = new Map();
  for(const l of links){
    const a = typeof l.source==="object" ? l.source.id : l.source;
    const b = typeof l.target==="object" ? l.target.id : l.target;
    if(!adj.has(a)) adj.set(a,new Set());
    if(!adj.has(b)) adj.set(b,new Set());
    adj.get(a).add(b); adj.get(b).add(a);
  }

  if(state.selected && !nodeById.has(state.selected)) { state.selected=null; renderDetail(); }
  if(state.hover && !nodeById.has(state.hover)) state.hover=null;
}

/* ================================================================
   [6] 시뮬레이션 + 캔버스 렌더링
   ----------------------------------------------------------------
   d3-force 물리 시뮬레이션으로 노드들이 서로 밀고 당기며 자리를
   잡게 하고, 그 결과를 <canvas> 에 매 프레임 직접 그린다.
   화면에 실제로 보이는 모든 그림은 이 섹션이 담당한다.
   ================================================================ */
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
let transform = d3.zoomIdentity;
let W=0,H=0,DPR=1;

const sim = d3.forceSimulation()
  .force("link", d3.forceLink().id(d=>d.id))
  .force("charge", d3.forceManyBody())
  .force("x", d3.forceX(0))
  .force("y", d3.forceY(0))
  .force("collide", d3.forceCollide())
  .on("tick", draw);

function applyForces(){
  const L = state.forces.link;
  sim.force("link")
    .distance(l=> l.etype==="구조" ? L*1.9 : l.etype==="소속" ? L : L*1.35)
    .strength(l=> l.etype==="구조" ? 0.55 : l.etype==="소속" ? 0.4 : 0.22);
  sim.force("charge").strength(d=> d.kind==="company" ? -state.forces.repel : -state.forces.repel*2.4);
  sim.force("x").strength(state.forces.center);
  sim.force("y").strength(state.forces.center);
  sim.force("collide").radius(d=>d.r+3).strength(0.8);
}

function restart(alpha=0.3, presettle=false){
  sim.nodes(nodes);
  sim.force("link").links(links);
  applyForces();
  if(presettle){
    sim.alpha(1).stop();
    for(let i=0;i<160;i++) sim.tick();
    cachePos(); fit(false); draw();
    sim.alpha(0.12).restart();
  }else{
    sim.alpha(alpha).restart();
  }
}
function cachePos(){ for(const n of nodes) posCache.set(n.id,{x:n.x,y:n.y}); }

function resize(){
  DPR = window.devicePixelRatio||1;
  W = canvas.clientWidth; H = canvas.clientHeight;
  canvas.width = W*DPR; canvas.height = H*DPR;
  draw();
}

function highlightSet(){
  const focus = state.hover || state.selected;
  if(!focus || !nodeById.has(focus)) return null;
  const s = new Set([focus]);
  for(const n of adj.get(focus)||[]) s.add(n);
  return s;
}

function draw(){
  cachePos();
  ctx.setTransform(DPR,0,0,DPR,0,0);
  ctx.clearRect(0,0,W,H);
  ctx.translate(transform.x, transform.y);
  ctx.scale(transform.k, transform.k);
  const k = transform.k;
  const H_ = highlightSet();

  // 연결선
  for(const l of links){
    const a=l.source, b=l.target;
    const inH = H_ && (H_.has(a.id)&&H_.has(b.id)) && (a.id===(state.hover||state.selected)||b.id===(state.hover||state.selected));
    let stroke, w;
    if(l.etype==="구조"){ stroke=CFG.structEdge; w=1.5; }
    else if(l.etype==="소속"){ stroke=CFG.affilEdge; w=1; }
    else { stroke=REL_COLORS[l.etype]||"#aaa"; w=1.8; }
    ctx.globalAlpha = H_ ? (inH?1:0.06) : 1;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = w/k;
    if(l.etype==="투자") ctx.setLineDash([6/k,4/k]);
    else if(l.etype==="협력"||l.etype==="합작") ctx.setLineDash([2/k,3/k]);
    else ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
  }
  ctx.setLineDash([]);

  // 노드
  for(const n of nodes){
    const dim = H_ && !H_.has(n.id);
    ctx.globalAlpha = dim ? CFG.dimAlpha : 1;
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r, 0, Math.PI*2);
    if(n.kind==="sub"){
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.fill();
      ctx.strokeStyle = n.color; ctx.lineWidth = 2/Math.sqrt(k);
      ctx.stroke();
    }else{
      ctx.fillStyle = n.color;
      ctx.fill();
    }
    if(n.ref && n.ref.conf==="추정" && !dim){
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = "rgba(20,60,100,0.38)"; ctx.lineWidth=1/k;
      ctx.setLineDash([2/k,2/k]);
      ctx.beginPath(); ctx.arc(n.x,n.y,n.r+2.5/k,0,Math.PI*2); ctx.stroke();
      ctx.setLineDash([]);
    }
    if(n.kind==="co" && NOTES[n.id] && !dim){
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#e0a32c"; ctx.lineWidth = 2/k;
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 3.2/k, 0, Math.PI*2); ctx.stroke();
      ctx.fillStyle = "#e0a32c";
      ctx.beginPath(); ctx.arc(n.x + (n.r+3.2/k)*0.72, n.y - (n.r+3.2/k)*0.72, 2.6/k, 0, Math.PI*2); ctx.fill();
    }
    if(state.selected===n.id){
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#0d2740"; ctx.lineWidth = 2.2/k;
      ctx.beginPath(); ctx.arc(n.x,n.y,n.r+4/k,0,Math.PI*2); ctx.stroke();
    }
  }

  // 라벨
  const showCompanyLabels = state.labelMode==="always" || (state.labelMode==="auto" && k>=1.35);
  for(const n of nodes){
    const isFocus = H_ && H_.has(n.id);
    let show=false, size=11, bold=false;
    if(n.kind==="root"){ show=true; size=15; bold=true; }
    else if(n.kind==="sector"){ show=k>=0.28; size=13; bold=true; }
    else if(n.kind==="sub"){ show=k>=0.65 || isFocus; size=11.5; bold=true; }
    else { show=showCompanyLabels || isFocus || state.selected===n.id; }
    if(!show) continue;
    const dim = H_ && !H_.has(n.id);
    ctx.globalAlpha = dim ? 0.15 : 1;
    ctx.fillStyle = CFG.labelColor;
    ctx.font = (bold?"600 ":"") + (size/k) + "px sans-serif";
    ctx.textAlign="center";
    ctx.fillText(n.name, n.x, n.y + n.r + 12/k);
  }
  ctx.globalAlpha=1;

  document.getElementById("zoomPct").textContent = Math.round(k*100)+"%";
  positionPopup();
  updateStats();
}

function updateStats(){
  document.getElementById("emptyMsg").style.display = nodes.length? "none":"block";
}

/* ================================================================
   [7] 상호작용 — 줌·팬·드래그·호버·클릭·검색
   ----------------------------------------------------------------
   마우스·터치 입력 처리를 모두 여기서 연결한다: 확대/축소(줌),
   화면 끌기(팬), 노드 드래그, 올려놓기(호버) 강조, 클릭 선택, 검색.
   ================================================================ */
function findNode(wx,wy){
  let best=null, bestD=Infinity;
  const hitR = Math.max(10/transform.k, 6);
  for(const n of nodes){
    const dx=n.x-wx, dy=n.y-wy, d=Math.sqrt(dx*dx+dy*dy);
    if(d < Math.max(n.r+3/transform.k, hitR) && d<bestD){ best=n; bestD=d; }
  }
  return best;
}
function nodeAtEvent(ev){
  const [mx,my] = d3.pointer(ev, canvas);
  const p = transform.invert([mx,my]);
  return findNode(p[0],p[1]);
}

const zoom = d3.zoom()
  .scaleExtent([0.08, 8])
  .filter(ev=> ev.type==="wheel" ? true : (!ev.button && !nodeAtEvent(ev)))
  .on("zoom", ev=>{ transform = ev.transform; draw(); });

const drag = d3.drag()
  .filter(ev=> !ev.button && !!nodeAtEvent(ev))
  .subject(ev=>{ const n=nodeAtEvent(ev.sourceEvent||ev); return n; })
  .on("start", ev=>{
    if(!ev.active) sim.alphaTarget(0.25).restart();
    ev.subject.fx=ev.subject.x; ev.subject.fy=ev.subject.y;
  })
  .on("drag", ev=>{
    const [mx,my]=d3.pointer(ev.sourceEvent, canvas);
    const p=transform.invert([mx,my]);
    ev.subject.fx=p[0]; ev.subject.fy=p[1];
  })
  .on("end", ev=>{
    if(!ev.active) sim.alphaTarget(0);
    ev.subject.fx=null; ev.subject.fy=null;
  });

d3.select(canvas).call(drag).call(zoom).on("dblclick.zoom",null);

let downPos=null;
canvas.addEventListener("pointerdown", ev=>{ downPos=[ev.clientX,ev.clientY]; });
canvas.addEventListener("click", ev=>{
  if(downPos){
    const dx=ev.clientX-downPos[0], dy=ev.clientY-downPos[1];
    if(dx*dx+dy*dy>25) return;                 // 드래그였음
  }
  const n = nodeAtEvent(ev);
  select(n? n.id : null);
});
canvas.addEventListener("pointermove", ev=>{
  const n = nodeAtEvent(ev);
  const id = n? n.id : null;
  canvas.style.cursor = n? "pointer" : "default";
  if(id!==state.hover){ state.hover=id; draw(); }
});
canvas.addEventListener("pointerleave", ()=>{ if(state.hover){ state.hover=null; draw(); } });
window.addEventListener("keydown", ev=>{
  if(ev.key==="Escape"){
    if(state.selected) select(null);
    else if(state.local) exitLocal();
  }
});

function fit(animate=true){
  if(!nodes.length) return;
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const n of nodes){
    x0=Math.min(x0,n.x); y0=Math.min(y0,n.y);
    x1=Math.max(x1,n.x); y1=Math.max(y1,n.y);
  }
  const bw=Math.max(x1-x0,10), bh=Math.max(y1-y0,10);
  const k = Math.max(0.08, Math.min(2.2, 0.88*Math.min(W/bw, H/bh)));
  const t = d3.zoomIdentity.translate(W/2 - k*(x0+x1)/2, H/2 - k*(y0+y1)/2).scale(k);
  const sel = d3.select(canvas);
  if(animate) sel.transition().duration(350).call(zoom.transform, t);
  else sel.call(zoom.transform, t);
}
function centerOn(id){
  const n = nodeById.get(id); if(!n) return;
  const k = Math.max(transform.k, 1.6);
  const t = d3.zoomIdentity.translate(W/2 - k*n.x, H/2 - k*n.y).scale(k);
  d3.select(canvas).transition().duration(400).call(zoom.transform, t);
}

document.getElementById("zoomIn").onclick = ()=> d3.select(canvas).transition().duration(150).call(zoom.scaleBy, 1.4);
document.getElementById("zoomOut").onclick = ()=> d3.select(canvas).transition().duration(150).call(zoom.scaleBy, 1/1.4);
document.getElementById("zoomFit").onclick = ()=> fit();
document.getElementById("fitView").onclick = ()=> fit();

/* ================================================================
   [8] 선택·상세 패널·로컬 그래프
   ----------------------------------------------------------------
   기업을 클릭했을 때의 처리: 왼쪽 상세 패널을 그 기업 정보로 채우고,
   그 기업과 직접 연결된 이웃만 모아 보여 주는 "로컬 그래프" 모드를
   다룬다.
   ================================================================ */
function select(id){
  state.selected = id;
  renderDetail();
  draw();
}
function esc(s){ return String(s??"").replace(/[&<>"]/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[m])); }

/* 말풍선을 선택 노드 옆에 붙여 위치시킴. draw()마다 호출되어 노드를 따라다닌다. */
function positionPopup(){
  const pop = document.getElementById("popup"), tail = document.getElementById("tail");
  const n = state.selected ? nodeById.get(state.selected) : null;
  if(!n){ pop.classList.remove("open"); tail.classList.remove("open"); return; }
  pop.classList.add("open");
  const k = transform.k;
  const sx = transform.applyX(n.x), sy = transform.applyY(n.y);
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  const gap = 14, edge = 8, rr = n.r * k;

  let top, above;
  if(sy - rr - gap - ph >= edge){ top = sy - rr - gap - ph; above = true; }   // 노드 위
  else { top = sy + rr + gap; above = false; }                                // 아래로 뒤집기
  top = Math.max(edge, Math.min(top, H - ph - edge));
  let left = Math.max(edge, Math.min(sx - pw/2, W - pw - edge));

  pop.style.left = left + "px";
  pop.style.top  = top + "px";

  // 꼬리: 노드 쪽을 가리키되 말풍선 폭 안에 머무름
  const tx = Math.max(left + 14, Math.min(sx, left + pw - 14)) - 6;
  const overlapY = (sy > top && sy < top + ph);   // 화면 경계로 밀려 노드와 겹치면 꼬리 숨김
  tail.style.left = tx + "px";
  tail.style.top  = (above ? top + ph - 6 : top - 6) + "px";
  tail.style.transform = above ? "rotate(225deg)" : "rotate(45deg)";
  tail.classList.toggle("open", !overlapY);
}

function renderDetail(){
  const body = document.getElementById("detailBody");
  if(!state.selected || !nodeById.has(state.selected)){
    positionPopup(); return;
  }
  const n = nodeById.get(state.selected);

  if(n.kind!=="company"){
    // 허브 노드 상세
    let membersHtml="", extra="";
    if(n.kind==="root"){
      body.innerHTML = `<h3>환경산업 (전체)</h3>
        <p class="desc">국내 환경산업 생태계 전체를 묶는 최상위 허브 노드다.</p>
        <h4>구성</h4><div class="linklist">${DATA.sectors.map(s=>`<div class="lk" data-map="${esc(s.name)}"><span class="dot" style="background:${SECTOR_COLORS[s.name]}"></span>${esc(s.name)}</div>`).join("")}</div>`;
      body.querySelectorAll("[data-map]").forEach(el=> el.onclick=()=> setMap(el.dataset.map));
      positionPopup(); return;
    }
    const members = n.kind==="sector"
      ? companies.filter(c=>c.sector===n.sector)
      : (membersBySub.get(n.sector+"|"+n.sub)||[]);
    membersHtml = members.slice(0,40).map(c=>{
      const on = nodeById.has(c.id);
      return `<div class="lk ${on?"":"off"}" data-id="${c.id}"><span class="dot" style="background:${SECTOR_COLORS[c.sector]}"></span>${esc(c.name)}<span class="rel">${esc(c.type)}</span></div>`;
    }).join("") + (members.length>40? `<div class="muted small" style="padding:4px 6px;">외 ${members.length-40}개</div>`:"");
    if(n.kind==="sector") extra = `<div class="btnrow"><button id="gotoMap">이 분야 지도로 이동</button></div>`;
    else extra = `<div class="btnrow"><button id="gotoMap">이 세부분야만 지도로 보기</button></div>`;
    const sObj = DATA.sectors.find(s=>s.name===n.sector) || null;
    const subTxt = (n.kind==="sub" && sObj && sObj.subAbout) ? sObj.subAbout[n.sub] : null;
    const secTxt = sObj ? sObj.about : null;
    const mainTxt = n.kind==="sector" ? secTxt : (subTxt || secTxt);
    let aboutHtml = "";
    if(mainTxt){
      aboutHtml = `<div class="hubAbout"><span class="lead">${n.kind==="sector"?"이 분야는":"이 세부분야는"}</span>${esc(mainTxt)}` +
        ((n.kind==="sub" && subTxt && secTxt)? `<span class="parent"><b>${esc(n.sector)}</b> · ${esc(secTxt)}</span>`:"") +
        `</div>`;
    }
    body.innerHTML = `<h3>${esc(n.name)}</h3>
      <div class="badges"><span class="badge hl">${n.kind==="sector"?"분야 허브":"세부분야 허브"}</span><span class="badge">소속 ${members.length}개</span></div>
      ${aboutHtml}${extra}<h4>소속 기관</h4><div class="linklist">${membersHtml}</div>`;
    body.querySelector("#gotoMap").onclick = ()=>{
      setMap(n.sector);
      if(n.kind==="sub"){ state.subOn = new Set([n.sub]); refreshSubFilter(); rebuild(); }
    };
    body.querySelectorAll(".lk[data-id]").forEach(el=>{
      el.onclick = ()=>{ if(nodeById.has(el.dataset.id)){ select(el.dataset.id); centerOn(el.dataset.id);} };
    });
    positionPopup(); return;
  }

  const c = n.ref;
  const rels = (relAdj.get(c.id)||[]);
  const relGroups = {};
  for(const r of rels){ (relGroups[r.rel]=relGroups[r.rel]||[]).push(r.id); }
  const relHtml = REL_LIST.filter(r=>relGroups[r]).map(r=>
    relGroups[r].map(tid=>{
      const t = compById.get(tid); const on = nodeById.has(tid);
      return `<div class="lk ${on?"":"off"}" data-id="${tid}" title="${on?"":"현재 필터에서 숨김"}"><span class="dot" style="background:${SECTOR_COLORS[t.sector]}"></span>${esc(t.name)}<span class="rel">${r}</span></div>`;
    }).join("")
  ).join("");
  const extHtml = (c.ext||[]).map(x=>`<div class="lk off"><span class="dot" style="background:#555"></span>${esc(x.n)}<span class="rel">${esc(x.rel)} · 외부</span></div>`).join("");

  body.innerHTML = `
    <h3>${esc(c.name)}</h3>
    <div class="badges">
      <span class="badge hl" style="border-color:${SECTOR_COLORS[c.sector]}">${esc(c.sector)}</span>
      <span class="badge hl">${esc(c.subsector)}</span>
      <span class="badge">${esc(c.type)}</span>
      ${(c.type==="해외 대표" && c.hq)? `<span class="badge">${esc(c.hq)}</span>`:""}
    </div>
    <p class="desc">${esc(c.desc)}</p>
    ${c.url? `<div class="btnrow" style="margin-bottom:6px;"><a class="extlink" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">공식 홈페이지 열기<span class="host">${esc(c.url.replace(/^https?:\/\//,"").replace(/\/$/,""))}</span></a></div>`:""}
    ${relHtml? `<h4>확인된 관계</h4><div class="linklist">${relHtml}</div>`:""}
    ${extHtml? `<h4>지도 밖 관계 (외부 기업·투자사)</h4><div class="linklist">${extHtml}</div>`:""}
    <div class="memoBox">
      <div class="memoHead"><h4>내 메모</h4><span class="memoState" id="memoState"></span></div>
      <textarea id="memoInput" placeholder="이 기업에 대해 기억할 것을 적어두세요. 이 브라우저에만 저장됩니다.">${esc((NOTES[c.id]||{}).t || "")}</textarea>
      <div class="btnrow">
        <button id="memoSave">저장</button>
        <button id="memoDel" class="del">삭제</button>
      </div>
    </div>
  `;
  const ta = body.querySelector("#memoInput"), stt = body.querySelector("#memoState");
  const stamp = () => {
    const n = NOTES[c.id];
    stt.textContent = n ? new Date(n.at).toLocaleDateString("ko-KR",{month:"numeric",day:"numeric"}) + " 저장됨" : "저장된 메모 없음";
  };
  stamp();
  let tmr = null;
  ta.oninput = () => { clearTimeout(tmr); stt.textContent = "입력 중…"; tmr = setTimeout(()=>{ setNote(c.id, ta.value); stamp(); }, 700); };
  ta.onkeydown = (e) => { e.stopPropagation(); if((e.metaKey||e.ctrlKey) && e.key==="Enter"){ clearTimeout(tmr); setNote(c.id, ta.value); stamp(); } };
  body.querySelector("#memoSave").onclick = () => { clearTimeout(tmr); setNote(c.id, ta.value); stamp(); };
  body.querySelector("#memoDel").onclick = () => { clearTimeout(tmr); ta.value=""; setNote(c.id, ""); stamp(); };
  body.querySelectorAll(".lk[data-id]").forEach(el=> el.onclick=()=>{
    if(nodeById.has(el.dataset.id)){ select(el.dataset.id); centerOn(el.dataset.id); }
  });
  positionPopup();
}

function enterLocal(id,depth){
  state.local = {id, depth};
  const c = compById.get(id);
  const banner = document.getElementById("localBanner");
  banner.style.display="flex";
  banner.innerHTML = `로컬 그래프: <b>${esc(c.name)}</b> · 깊이 ${depth} <button id="lbDepth">깊이 ${depth===1?2:1}로</button> <button id="lbExit">해제</button>`;
  document.getElementById("lbDepth").onclick = ()=> enterLocal(id, depth===1?2:1);
  document.getElementById("lbExit").onclick = exitLocal;
  rebuild(true);
  select(id);
}
function exitLocal(){
  state.local = null;
  document.getElementById("localBanner").style.display="none";
  rebuild(true);
  renderDetail();
}

/* ================================================================
   [9] UI 구성 — 지도 목록·필터·옵션·검색
   ----------------------------------------------------------------
   왼쪽 패널의 UI 를 코드로 만들어 붙인다: 지도(섹터) 목록,
   유형·상장 여부 필터 체크박스, 표시 옵션, 검색창.
   ================================================================ */
function chk(id, labelHtml, checked, onchange, cnt){
  const w = document.createElement("label"); w.className="row";
  w.innerHTML = `<input type="checkbox" ${checked?"checked":""}> ${labelHtml} ${cnt!=null?`<span class="cnt">${cnt}</span>`:""}`;
  w.querySelector("input").addEventListener("change", ev=> onchange(ev.target.checked));
  document.getElementById(id).appendChild(w);
  return w;
}
function setMap(m){
  state.map = m;
  state.local = null;
  document.getElementById("localBanner").style.display="none";
  state.subOn = null;  // 분야 지도 진입 시 전체 선택 상태
  refreshMapButtons(); refreshSubFilter();
  rebuild(true);
}
function refreshMapButtons(){
  document.querySelectorAll("#mapList button").forEach(b=>{
    b.classList.toggle("active", b.dataset.map===state.map);
  });
  const ab = document.getElementById("mapAbout");
  if(ab){
    const s = DATA.sectors.find(x=>x.name===state.map);
    if(s && s.about){ ab.textContent = s.about; ab.style.display="block"; }
    else { ab.textContent=""; ab.style.display="none"; }
  }
}
function buildMapList(){
  const el = document.getElementById("mapList");
  el.innerHTML="";
  const mk=(name,label,cnt,color)=>{
    const b=document.createElement("button");
    b.dataset.map=name;
    b.innerHTML = `${color?`<span class="dot" style="background:${color}"></span>`:`<span class="dot" style="background:#888"></span>`}<span>${label}</span><span class="cnt">${cnt}</span>`;
    b.onclick=()=> setMap(name);
    el.appendChild(b);
  };
  mk("all","전체 생태계",companies.length,null);
  for(const s of DATA.sectors){
    mk(s.name, s.name, companies.filter(c=>c.sector===s.name).length, SECTOR_COLORS[s.name]);
  }
  refreshMapButtons();
}
function refreshSubFilter(){
  const el = document.getElementById("subFilter");
  const title = document.getElementById("subFilterTitle");
  el.innerHTML="";
  if(state.map==="all"){
    title.textContent="분야";
    for(const s of DATA.sectors){
      const cnt = companies.filter(c=>c.sector===s.name).length;
      const w = document.createElement("label"); w.className="row";
      w.innerHTML = `<input type="checkbox" ${state.sectorOn.has(s.name)?"checked":""}> <span class="dot" style="background:${SECTOR_COLORS[s.name]}"></span>${esc(s.name)} <span class="cnt">${cnt}</span>`;
      w.querySelector("input").addEventListener("change", ev=>{
        ev.target.checked ? state.sectorOn.add(s.name) : state.sectorOn.delete(s.name);
        rebuild();
      });
      el.appendChild(w);
    }
  }else{
    title.textContent="세부분야";
    const sec = DATA.sectors.find(s=>s.name===state.map);
    if(!sec) return;
    if(!state.subOn) state.subOn = new Set(sec.subsectors);
    for(const sub of sec.subsectors){
      const cnt = (membersBySub.get(state.map+"|"+sub)||[]).length;
      const w = document.createElement("label"); w.className="row";
      w.innerHTML = `<input type="checkbox" ${state.subOn.has(sub)?"checked":""}> ${esc(sub)} <span class="cnt">${cnt}</span>`;
      w.querySelector("input").addEventListener("change", ev=>{
        ev.target.checked ? state.subOn.add(sub) : state.subOn.delete(sub);
        rebuild();
      });
      el.appendChild(w);
    }
  }
}
document.getElementById("subAll").onclick=()=>{
  if(state.map==="all") state.sectorOn = new Set(DATA.sectors.map(s=>s.name));
  else state.subOn = new Set((DATA.sectors.find(s=>s.name===state.map)||{subsectors:[]}).subsectors);
  refreshSubFilter(); rebuild();
};
document.getElementById("subNone").onclick=()=>{
  if(state.map==="all") state.sectorOn = new Set();
  else state.subOn = new Set();
  refreshSubFilter(); rebuild();
};

function buildFilters(){
  for(const t of TYPE_LIST){
    const cnt = companies.filter(c=>c.type===t).length;
    chk("typeFilter", esc(t), true, on=>{ on? state.types.add(t):state.types.delete(t); rebuild(); }, cnt);
  }
  for(const g of LISTED_GROUPS){
    const cnt = companies.filter(c=>listedGroup(c)===g).length;
    chk("listedFilter", esc(g), true, on=>{ on? state.listed.add(g):state.listed.delete(g); rebuild(); }, cnt);
  }
  // 연결선
  chk("edgeFilter", `분류 연결 (허브 구조)`, true, on=>{ state.showHubs=on; rebuild(true); });
  for(const r of REL_LIST){
    const cnt = DATA.edges.filter(e=>e.rel===r).length;
    chk("edgeFilter", `<span class="dot" style="background:${REL_COLORS[r]}"></span>${r}`, false,
      on=>{ on? state.rels.add(r):state.rels.delete(r); rebuild(); }, cnt);
  }
  // 노드 크기 기준
  const sbo = document.getElementById("sizeByOpts");
  sbo.querySelectorAll("[data-sb]").forEach(b=> b.onclick=()=>{
    state.sizeBy = b.dataset.sb;
    sbo.querySelectorAll("button").forEach(x=>x.classList.toggle("active", x===b));
    renderSizeLegend(); rebuild();
  });
  renderSizeLegend();
  // 표시
  chk("displayOpts","연결 없는 노드 숨기기", false, on=>{ state.hideOrphans=on; rebuild(); });
  const lm = document.createElement("div");
  lm.className="btnrow";
  lm.innerHTML = `<span class="muted small" style="align-self:center;">라벨:</span>
    <button data-lm="auto" class="active">자동</button><button data-lm="always">항상</button><button data-lm="off">숨김</button>`;
  document.getElementById("displayOpts").appendChild(lm);
  lm.querySelectorAll("[data-lm]").forEach(b=> b.onclick=()=>{
    state.labelMode=b.dataset.lm;
    lm.querySelectorAll("button").forEach(x=>x.classList.toggle("active",x===b));
    draw();
  });
}

function renderSizeLegend(){
  const el = document.getElementById("sizeLegend");
  if(state.sizeBy==="uniform"){ el.innerHTML = `<span>모든 기업 노드를 같은 크기로 표시한다.</span>`; return; }
  if(state.sizeBy==="degree"){
    el.innerHTML = [1,3,6,10].map(d=>{
      const r = (3.8 + Math.min(d,10)*1.1);
      return `<div class="it"><div class="cir" style="width:${r*2}px;height:${r*2}px"></div><span>${d}${d===10?"+":""}</span></div>`;
    }).join("") + `<span style="align-self:center;">확인된 관계 수</span>`;
    return;
  }
  const cnt = {};
  for(const c of companies) cnt[c.scale] = (cnt[c.scale]||0)+1;
  el.innerHTML = [4,3,2,1].map(s=>
    `<div class="it"><div class="cir" style="width:${SCALE_R[s]*2}px;height:${SCALE_R[s]*2}px"></div>
     <span>${SCALE_LABEL[s]}</span><span class="cnt">${cnt[s]||0}</span></div>`).join("");
}

/* 슬라이더 */
function bindSlider(id, valId, fn, fmt){
  const el=document.getElementById(id), v=document.getElementById(valId);
  el.addEventListener("input",()=>{ v.textContent=fmt(el.value); fn(parseFloat(el.value)); });
  v.textContent=fmt(el.value);
}
bindSlider("sizeScale","sizeScaleV", x=>{ state.sizeScale=x; rebuild(); }, x=>parseFloat(x).toFixed(1));
bindSlider("fRepel","fRepelV", x=>{ state.forces.repel=x; applyForces(); sim.alpha(0.3).restart(); }, x=>x);
bindSlider("fLink","fLinkV", x=>{ state.forces.link=x; applyForces(); sim.alpha(0.3).restart(); }, x=>x);
bindSlider("fCenter","fCenterV", x=>{ state.forces.center=x; applyForces(); sim.alpha(0.3).restart(); }, x=>x);
document.getElementById("reheat").onclick=()=>{ sim.alpha(0.9).restart(); };

/* 검색 */
const searchInput = document.getElementById("searchInput");
searchInput.addEventListener("input", ()=>{
  state.q = searchInput.value;
  refreshSearchResults();
  rebuild();
});
document.getElementById("clearSearch").onclick=()=>{
  searchInput.value=""; state.q="";
  refreshSearchResults(); rebuild();
};
function refreshSearchResults(){
  const el = document.getElementById("searchResults");
  const q = state.q.trim();
  if(!q){ el.style.display="none"; el.innerHTML=""; return; }
  const res = companies.filter(c=>matchQ(c,q)).slice(0,15);
  el.style.display="block";
  el.innerHTML = res.map(c=>`<div class="item" data-id="${c.id}"><span class="dot" style="background:${SECTOR_COLORS[c.sector]}"></span>${esc(c.name)}<span class="sub">${esc(c.subsector)}</span></div>`).join("")
    || `<div class="item muted">결과 없음</div>`;
  el.querySelectorAll("[data-id]").forEach(item=> item.onclick=()=>{
    const id=item.dataset.id;
    if(!nodeById.has(id)){
      // 현재 지도에 없으면 전체 지도로 전환 후 선택
      setMap("all");
    }
    select(id); centerOn(id);
  });
}

/* 도구 버튼 */
document.getElementById("resetFilters").onclick=()=>{
  state.types=new Set(TYPE_LIST); state.listed=new Set(LISTED_GROUPS);
  state.conf=new Set(["확인","추정"]); state.rels=new Set();
  state.sectorOn=new Set(DATA.sectors.map(s=>s.name)); state.subOn=null;
  state.hideOrphans=false; state.showHubs=true; state.q=""; state.sizeBy="scale";
  document.querySelectorAll("#sizeByOpts button").forEach(b=>b.classList.toggle("active", b.dataset.sb==="scale"));
  renderSizeLegend();
  searchInput.value="";
  document.querySelectorAll("#typeFilter input,#listedFilter input").forEach(i=>i.checked=true);
  document.querySelectorAll("#edgeFilter input").forEach((i,ix)=>i.checked = ix===0);
  document.querySelector("#displayOpts input").checked=false;
  refreshSubFilter(); refreshSearchResults(); rebuild(true);
};
document.getElementById("memoOnly").onclick=()=>{
  state.memoOnly = !state.memoOnly;
  if(state.memoOnly && !noteCount()){ state.memoOnly=false; renderMemoList(); return; }
  renderMemoList(); rebuild();
};
document.getElementById("memoExport").onclick=()=>{
  const rows = Object.keys(NOTES).filter(id=>compById.has(id))
    .sort((a,b)=>(NOTES[b].at||0)-(NOTES[a].at||0))
    .map(id=>{ const c=compById.get(id);
      return `## ${c.name}\n- 분야: ${c.sector} · ${c.subsector}\n- 유형: ${c.type}\n- 저장: ${new Date(NOTES[id].at).toLocaleDateString("ko-KR")}\n\n${NOTES[id].t}\n`; });
  const md = "# ECOnomy 생태계 지도 — 내 메모\n\n" + (rows.join("\n") || "_아직 메모가 없습니다._\n");
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([md],{type:"text/markdown"}));
  a.download="econolmy-memo.md"; a.click(); URL.revokeObjectURL(a.href);
};
document.getElementById("exportBtn").onclick=()=>{
  const vis = companies.filter(c=>nodeById.has(c.id));
  const blob = new Blob([JSON.stringify(vis,null,2)],{type:"application/json"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download="환경생태계_필터결과.json";
  a.click();
};
document.getElementById("closeDetail").onclick=()=> select(null);
document.getElementById("menuBtn").onclick=()=> document.getElementById("left").classList.toggle("open");

/* ================================================================
   [10] 부트스트랩
   ----------------------------------------------------------------
   시작 절차: 창 크기 반영 → 그래프 첫 구성 → 첫 그리기.
   페이지가 열리면 여기서 모든 것이 출발한다.
   ================================================================ */
let resizeTimer=null;
function resizeSoon(){ clearTimeout(resizeTimer); resizeTimer=setTimeout(resize,60); }
window.addEventListener("resize", resizeSoon);

function rebuild(presettle=false){
  buildGraph();
  renderMemoList();
  restart(presettle? 1 : 0.3, presettle);
  draw();
}

document.getElementById("totalCnt").textContent = companies.length;
buildMapList();
buildFilters();
refreshSubFilter();
resize();
rebuild(true);
window.__GRAPH_READY__ = true;

window.addEventListener("message", (ev)=>{
  const d = ev.data || {};
  if(d.type === "econ:setMap" && typeof d.map === "string"){
    try{ setMap(d.map); }catch(e){}
  }
  if(d.type === "econ:setSub" && typeof d.sector === "string"){
    try{
      setMap(d.sector);
      if(d.sub){ state.subOn = new Set([d.sub]); refreshSubFilter(); rebuild(true); }
    }catch(e){}
  }
  if(d.type === "econ:search"){
    const el = document.getElementById("searchInput");
    if(el){ el.value = d.q || ""; el.dispatchEvent(new Event("input")); el.focus(); }
  }
});
try{ parent.postMessage({type:"econ:ready", total: companies.length}, "*"); }catch(e){}

