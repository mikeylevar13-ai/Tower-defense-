const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");

const livesEl = document.getElementById("lives");
const goldEl  = document.getElementById("gold");
const waveEl  = document.getElementById("wave");
const tipEl   = document.getElementById("tip");

const buildBtn = document.getElementById("buildBtn");
const startWaveBtn = document.getElementById("startWaveBtn");
const pauseBtn = document.getElementById("pauseBtn");

const overlay = document.getElementById("overlay");
const ovTitle = document.getElementById("ovTitle");
const ovText  = document.getElementById("ovText");
const resumeBtn = document.getElementById("resumeBtn");
const restartBtn = document.getElementById("restartBtn");

let DPR=1, W=0, H=0;

function resize(){
  DPR = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  const r = canvas.getBoundingClientRect();
  W = Math.floor(r.width * DPR);
  H = Math.floor(r.height * DPR);
  canvas.width = W;
  canvas.height = H;
}
window.addEventListener("resize", resize);

const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));

/* Grid */
const grid = {
  cols: 12,
  rows: 18,
  pad: 16,       // CSS px padding from canvas border
  cell: 0,       // computed CSS px
  ox: 0, oy: 0   // computed origin CSS px
};

function computeGrid(){
  const cssW = W/DPR, cssH = H/DPR;
  const usableW = cssW - grid.pad*2;
  const usableH = cssH - grid.pad*2;
  grid.cell = Math.floor(Math.min(usableW/grid.cols, usableH/grid.rows));
  grid.ox = Math.floor((cssW - grid.cell*grid.cols)/2);
  grid.oy = Math.floor((cssH - grid.cell*grid.rows)/2);
}

function cellRect(cx, cy){
  return {
    x: grid.ox + cx*grid.cell,
    y: grid.oy + cy*grid.cell,
    w: grid.cell,
    h: grid.cell
  };
}

function pointToCell(px, py){
  const cx = Math.floor((px - grid.ox)/grid.cell);
  const cy = Math.floor((py - grid.oy)/grid.cell);
  if(cx<0||cy<0||cx>=grid.cols||cy>=grid.rows) return null;
  return {cx, cy};
}

/* Path: a simple zig-zag route */
function makePath(){
  // Hardcoded path cells; enemies follow centers
  const p = [];
  // start top-left-ish to bottom-right-ish
  let x=1, y=2;
  for(let i=0;i<4;i++) p.push({cx:x+i, cy:y});
  x=4; for(let i=0;i<5;i++) p.push({cx:x, cy:y+i});
  y=7; for(let i=0;i<5;i++) p.push({cx:x+i, cy:y});
  x=9; for(let i=0;i<7;i++) p.push({cx:x, cy:y+i});
  y=13; for(let i=0;i<4;i++) p.push({cx:x- i, cy:y});
  x=6; for(let i=0;i<4;i++) p.push({cx:x, cy:y+i});
  // base near bottom
  p.push({cx:6, cy:17});
  return p;
}

const state = {
  running: true,
  paused: false,

  lives: 20,
  gold: 120,
  wave: 1,

  building: false,

  towers: [],
  projectiles: [],
  enemies: [],
  path: [],

  waveActive:false,
  waveSpawned:0,
  waveToSpawn:0,
  spawnTimer:0,

  t:0
};

const COST_TOWER = 50;

function reset(){
  state.running = true;
  state.paused = false;

  state.lives = 20;
  state.gold = 120;
  state.wave = 1;

  state.building = false;

  state.towers = [];
  state.projectiles = [];
  state.enemies = [];

  state.waveActive = false;
  state.waveSpawned = 0;
  state.waveToSpawn = 0;
  state.spawnTimer = 0;

  state.t = 0;

  hud();
  tipEl.textContent = "Tap “Tower” then tap a tile to place. Towers can’t be on the path.";
}

function hud(){
  livesEl.textContent = state.lives;
  goldEl.textContent  = state.gold;
  waveEl.textContent  = state.wave;
  buildBtn.textContent = state.building ? `Placing… (Tap a tile)` : `Tower (${COST_TOWER})`;
  startWaveBtn.disabled = state.waveActive;
  pauseBtn.textContent = state.paused ? "Resume" : "Pause";
}

function showOverlay(title, text){
  ovTitle.textContent = title;
  ovText.textContent = text;
  overlay.classList.remove("hidden");
}
function hideOverlay(){
  overlay.classList.add("hidden");
}

function isPathCell(cx, cy){
  return state.path.some(p => p.cx===cx && p.cy===cy);
}

function isOccupied(cx, cy){
  return state.towers.some(t => t.cx===cx && t.cy===cy);
}

function placeTower(cx, cy){
  if(isPathCell(cx,cy)) { tipEl.textContent = "You can’t build on the path."; return; }
  if(isOccupied(cx,cy)) { tipEl.textContent = "That tile already has a tower."; return; }
  if(state.gold < COST_TOWER){ tipEl.textContent = "Not enough gold."; return; }

  state.gold -= COST_TOWER;

  state.towers.push({
    cx, cy,
    range: 2.6,          // in cells
    fireRate: 1.3,       // shots/sec
    cd: 0,
    dmg: 10
  });

  state.building = false;
  tipEl.textContent = "Tower placed. Start the wave!";
  hud();
}

function spawnEnemy(){
  const start = state.path[0];
  const end = state.path[state.path.length-1];
  state.enemies.push({
    // progress along path segments
    seg: 0,
    t: 0,
    speed: 0.55 + state.wave*0.03,  // cells/sec-ish (scaled later)
    hp: 40 + state.wave*12,
    maxHp: 40 + state.wave*12,
    reward: 10 + Math.floor(state.wave/2),
    // convenience
    start, end
  });
}

function cellCenter(cx, cy){
  const r = cellRect(cx,cy);
  return { x: r.x + r.w/2, y: r.y + r.h/2 };
}

function enemyPos(e){
  const a = state.path[e.seg];
  const b = state.path[Math.min(e.seg+1, state.path.length-1)];
  const A = cellCenter(a.cx,a.cy);
  const B = cellCenter(b.cx,b.cy);
  return { x: A.x + (B.x-A.x)*e.t, y: A.y + (B.y-A.y)*e.t };
}

function dist(a,b){
  const dx=a.x-b.x, dy=a.y-b.y;
  return Math.hypot(dx,dy);
}

function update(dt){
  state.t += dt;

  // Wave logic
  if(state.waveActive){
    state.spawnTimer += dt;
    const spawnEvery = clamp(0.65 - state.wave*0.02, 0.22, 0.65);
    if(state.waveSpawned < state.waveToSpawn && state.spawnTimer >= spawnEvery){
      state.spawnTimer = 0;
      state.waveSpawned++;
      spawnEnemy();
    }
    // done when all spawned + all cleared
    if(state.waveSpawned >= state.waveToSpawn && state.enemies.length === 0){
      state.waveActive = false;
      state.wave++;
      state.gold += 25 + Math.floor(state.wave*2);
      tipEl.textContent = "Wave cleared! Place more towers or start the next wave.";
      hud();
    }
  }

  // Move enemies along path
  for(const e of state.enemies){
    // speed is in "cells per second", convert to segment t per second based on segment length
    const a = state.path[e.seg];
    const b = state.path[Math.min(e.seg+1, state.path.length-1)];
    const A = cellCenter(a.cx,a.cy);
    const B = cellCenter(b.cx,b.cy);
    const segLen = Math.max(1, dist(A,B));
    // Want e.speed cells/sec -> pixels/sec:
    const pxPerSec = e.speed * grid.cell;
    e.t += (pxPerSec * dt) / segLen;

    while(e.t >= 1 && e.seg < state.path.length-1){
      e.t -= 1;
      e.seg++;
      if(e.seg >= state.path.length-1){
        // reached base
        e.t = 1;
        break;
      }
    }
  }

  // Handle reaching base
  const survivors = [];
  for(const e of state.enemies){
    if(e.seg >= state.path.length-1 && e.t >= 1){
      state.lives--;
    } else {
      survivors.push(e);
    }
  }
  state.enemies = survivors;

  if(state.lives <= 0){
    gameOver();
    return;
  }

  // Towers shoot
  for(const tw of state.towers){
    tw.cd -= dt;
    if(tw.cd > 0) continue;

    const twPos = cellCenter(tw.cx, tw.cy);
    // find nearest enemy in range
    let best = null, bestD = 1e9;
    for(const e of state.enemies){
      const ep = enemyPos(e);
      const d = dist(twPos, ep);
      if(d <= tw.range*grid.cell && d < bestD){
        bestD = d;
        best = { e, ep };
      }
    }

    if(best){
      tw.cd = 1 / tw.fireRate;
      state.projectiles.push({
        x: twPos.x, y: twPos.y,
        vx: (best.ep.x - twPos.x),
        vy: (best.ep.y - twPos.y),
        speed: 920, // px/sec
        dmg: tw.dmg,
        target: best.e
      });
      // normalize
      const m = Math.hypot(state.projectiles.at(-1).vx, state.projectiles.at(-1).vy) || 1;
      state.projectiles.at(-1).vx /= m;
      state.projectiles.at(-1).vy /= m;
    }
  }

  // Move projectiles + hits
  const newProj = [];
  for(const p of state.projectiles){
    p.x += p.vx * p.speed * dt;
    p.y += p.vy * p.speed * dt;

    // if target dead, drop
    if(!state.enemies.includes(p.target)) continue;

    const tp = enemyPos(p.target);
    if(dist({x:p.x,y:p.y}, tp) < 14){
      p.target.hp -= p.dmg;
      continue; // consumed
    }
    // out of bounds
    if(p.x < -50 || p.y < -50 || p.x > (W/DPR)+50 || p.y > (H/DPR)+50) continue;

    newProj.push(p);
  }
  state.projectiles = newProj;

  // Remove dead enemies + rewards
  const alive = [];
  for(const e of state.enemies){
    if(e.hp <= 0){
      state.gold += e.reward;
    } else {
      alive.push(e);
    }
  }
  state.enemies = alive;

  hud();
}

function gameOver(){
  state.running = false;
  state.waveActive = false;
  showOverlay("Game Over", `You ran out of lives.\n\nMade it to wave ${state.wave}.\nGold: ${state.gold}`);
}

function draw(){
  ctx.clearRect(0,0,W,H);
  ctx.save();
  ctx.scale(DPR, DPR);

  const cssW = W/DPR, cssH = H/DPR;

  // Background vignette
  const g = ctx.createRadialGradient(cssW*0.5, cssH*0.2, cssW*0.1, cssW*0.5, cssH*0.7, cssW*0.95);
  g.addColorStop(0, "rgba(96,165,250,0.12)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0,0,cssW,cssH);

  // Grid
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = "#eaf0ff";
  ctx.lineWidth = 1;
  for(let x=0;x<=grid.cols;x++){
    const px = grid.ox + x*grid.cell;
    ctx.beginPath(); ctx.moveTo(px, grid.oy); ctx.lineTo(px, grid.oy + grid.rows*grid.cell); ctx.stroke();
  }
  for(let y=0;y<=grid.rows;y++){
    const py = grid.oy + y*grid.cell;
    ctx.beginPath(); ctx.moveTo(grid.ox, py); ctx.lineTo(grid.ox + grid.cols*grid.cell, py); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Path
  for(const pc of state.path){
    const r = cellRect(pc.cx, pc.cy);
    roundRect(r.x+2, r.y+2, r.w-4, r.h-4, 10, "rgba(96,165,250,0.18)", "rgba(96,165,250,0.35)");
  }

  // Base (last cell)
  const base = state.path[state.path.length-1];
  {
    const r = cellRect(base.cx, base.cy);
    roundRect(r.x+2, r.y+2, r.w-4, r.h-4, 12, "rgba(52,211,153,0.18)", "rgba(52,211,153,0.40)");
    ctx.fillStyle = "rgba(52,211,153,0.85)";
    ctx.font = "700 12px system-ui";
    ctx.fillText("BASE", r.x + 8, r.y + 18);
  }

  // Towers
  for(const t of state.towers){
    const r = cellRect(t.cx,t.cy);
    roundRect(r.x+6, r.y+6, r.w-12, r.h-12, 12, "rgba(167,139,250,0.85)", "rgba(255,255,255,0.35)");
    // core glow
    const c = cellCenter(t.cx,t.cy);
    const gg = ctx.createRadialGradient(c.x,c.y,2,c.x,c.y, r.w*0.6);
    gg.addColorStop(0, "rgba(255,255,255,0.35)");
    gg.addColorStop(1, "rgba(167,139,250,0)");
    ctx.fillStyle = gg;
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }

  // Enemies
  for(const e of state.enemies){
    const p = enemyPos(e);
    const size = 18;
    roundRect(p.x-size, p.y-size, size*2, size*2, 10, "rgba(251,113,133,0.88)", "rgba(255,255,255,0.35)");
    // HP bar
    const w = 34, h = 5;
    const x = p.x - w/2, y = p.y - size - 10;
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(x,y,w,h);
    ctx.fillStyle = "rgba(52,211,153,0.85)";
    ctx.fillRect(x,y,w*(e.hp/e.maxHp),h);
  }

  // Projectiles
  ctx.fillStyle = "rgba(234,240,255,0.9)";
  for(const p of state.projectiles){
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.2, 0, Math.PI*2);
    ctx.fill();
  }

  // Placement preview
  if(state.building && lastPointer){
    const cc = pointToCell(lastPointer.x, lastPointer.y);
    if(cc){
      const r = cellRect(cc.cx, cc.cy);
      const bad = isPathCell(cc.cx,cc.cy) || isOccupied(cc.cx,cc.cy) || state.gold < COST_TOWER;
      roundRect(r.x+3, r.y+3, r.w-6, r.h-6, 12,
        bad ? "rgba(251,113,133,0.12)" : "rgba(167,139,250,0.14)",
        bad ? "rgba(251,113,133,0.45)" : "rgba(167,139,250,0.55)"
      );
    }
  }

  ctx.restore();
}

function roundRect(x,y,w,h,r,fill,stroke){
  const rr = Math.min(r, w/2, h/2);
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x+rr,y);
  ctx.arcTo(x+w,y,x+w,y+h,rr);
  ctx.arcTo(x+w,y+h,x,y+h,rr);
  ctx.arcTo(x,y+h,x,y,rr);
  ctx.arcTo(x,y,x+w,y,rr);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

let last = 0;
let lastPointer = null;

function frame(ms){
  requestAnimationFrame(frame);
  if(!state.running) { draw(); return; }
  if(state.paused) { draw(); return; }

  const now = ms/1000;
  const dt = Math.min(0.033, now-last);
  last = now;

  update(dt);
  draw();
}

function startWave(){
  if(state.waveActive) return;
  state.waveActive = true;
  state.waveSpawned = 0;
  state.waveToSpawn = 8 + state.wave*3;
  state.spawnTimer = 0;
  tipEl.textContent = `Wave ${state.wave} started!`;
  hud();
}

function boot(){
  resize();
  computeGrid();
  state.path = makePath();
  reset();
  showOverlay("Tower Defense", "Tap “Tower” then tap a tile to place.\nHit “Start Wave” to begin.\n\nGood luck!");
  overlay.classList.remove("hidden");
  hud();

  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("./sw.js").catch(()=>{});
  }

  // Input
  canvas.addEventListener("pointermove", (e)=>{
    const r = canvas.getBoundingClientRect();
    lastPointer = { x: e.clientX - r.left, y: e.clientY - r.top };
  }, {passive:true});

  canvas.addEventListener("pointerdown", (e)=>{
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    lastPointer = { x, y };

    if(state.building){
      const cc = pointToCell(x,y);
      if(!cc) return;
      placeTower(cc.cx, cc.cy);
    }
  }, {passive:false});

  buildBtn.addEventListener("click", ()=>{
    state.building = !state.building;
    tipEl.textContent = state.building
      ? "Tap a tile to place a tower (not on the path)."
      : "Build canceled.";
    hud();
  });

  startWaveBtn.addEventListener("click", startWave);

  pauseBtn.addEventListener("click", ()=>{
    state.paused = !state.paused;
    hud();
    if(state.paused){
      showOverlay("Paused", "Tap Resume to continue.");
    } else {
      hideOverlay();
      last = performance.now()/1000;
    }
  });

  resumeBtn.addEventListener("click", ()=>{
    state.paused = false;
    hideOverlay();
    last = performance.now()/1000;
    hud();
  });

  restartBtn.addEventListener("click", ()=>{
    hideOverlay();
    resize(); computeGrid();
    reset();
    last = performance.now()/1000;
  });

  // Keep grid correct if canvas size changes
  window.addEventListener("resize", ()=>{
    resize(); computeGrid();
  });

  last = performance.now()/1000;
  requestAnimationFrame(frame);
}

boot();
