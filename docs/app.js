
const KEEPER = 769891898;
const ALGOD = "https://testnet-api.algonode.cloud";
const SKIP = new Set([81]);
const PHOS = "#7dff9a";
const DIM = "#3d8f55";
const WARN = "#ffd36a";
const HOT = "#ff6b6b";

const clockEl = document.getElementById("clock");
const pingEl = document.getElementById("ping");
const hudEl = document.getElementById("radar-hud");
const radar = document.getElementById("radar-canvas");
const rtx = radar.getContext("2d");

let db = null;
let rings = [];
let lastRound = 0;
let charts = {};

function resizeRadar() {
  const dpr = window.devicePixelRatio || 1;
  radar.width = radar.clientWidth * dpr;
  radar.height = radar.clientHeight * dpr;
}
window.addEventListener("resize", resizeRadar);
resizeRadar();

function drawRadar() {
  const w = radar.width, h = radar.height;
  rtx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2, max = Math.min(w, h) * 0.42;
  rtx.strokeStyle = "rgba(125,255,154,0.18)";
  rtx.lineWidth = 1;
  for (let i = 1; i <= 4; i++) {
    rtx.beginPath();
    rtx.arc(cx, cy, max * i / 4, 0, Math.PI * 2);
    rtx.stroke();
  }
  rtx.beginPath();
  rtx.moveTo(cx - max, cy); rtx.lineTo(cx + max, cy);
  rtx.moveTo(cx, cy - max); rtx.lineTo(cx, cy + max);
  rtx.stroke();
  const t = performance.now() / 1000;
  rtx.strokeStyle = "rgba(125,255,154,0.55)";
  rtx.beginPath();
  rtx.moveTo(cx, cy);
  rtx.lineTo(cx + Math.cos(t) * max, cy + Math.sin(t) * max);
  rtx.stroke();
  rings = rings.filter((ring) => {
    ring.r += 0.012;
    const alpha = Math.max(0, 1 - ring.r);
    rtx.strokeStyle = "rgba(125,255,154," + alpha + ")";
    rtx.lineWidth = 2;
    rtx.beginPath();
    rtx.arc(cx, cy, max * ring.r, 0, Math.PI * 2);
    rtx.stroke();
    return ring.r < 1;
  });
  requestAnimationFrame(drawRadar);
}
drawRadar();

function beat() {
  rings.push({ r: 0.05 });
}

async function ping() {
  try {
    const st = await fetch(ALGOD + "/v2/status").then((r) => r.json());
    lastRound = st["last-round"] || lastRound;
    pingEl.classList.remove("dead");
    hudEl.textContent = "ROUND " + lastRound;
    clockEl.textContent = "live " + lastRound + " · keeper " + KEEPER;
    beat();
  } catch (err) {
    pingEl.classList.add("dead");
    hudEl.textContent = "NO PING · using snapshot";
  }
}

function phosChart(ctx, spec) {
  Chart.defaults.color = DIM;
  Chart.defaults.borderColor = "rgba(125,255,154,0.12)";
  Chart.defaults.font.family = "IBM Plex Mono, ui-monospace, monospace";
  return new Chart(ctx, spec);
}

function queryAll() {
  if (!db) return [];
  const res = db.exec("SELECT t, round, listed, due, skipped, unfunded, waiting, on_schedule, escrow_micro, source FROM samples ORDER BY round");
  if (!res[0]) return [];
  return res[0].values.map((v) => ({
    t: v[0], round: v[1], listed: v[2], due: v[3], skipped: v[4],
    unfunded: v[5], waiting: v[6], on_schedule: v[7], escrow_micro: v[8], source: v[9]
  }));
}

function drawCharts(rows) {
  if (typeof Chart === "undefined") { drawPlain(rows); return; }
  const latest = rows[rows.length - 1] || {};
  const labels = rows.map((r) => String(r.round));
  if (charts.mix) charts.mix.destroy();
  charts.mix = phosChart(document.getElementById("mix-canvas"), {
    type: "doughnut",
    data: {
      labels: ["on schedule", "waiting", "unfunded", "due"],
      datasets: [{
        data: [latest.on_schedule || 0, latest.waiting || 0, latest.unfunded || 0, latest.due || 0],
        backgroundColor: [PHOS, WARN, HOT, DIM],
        borderWidth: 0
      }]
    },
    options: { plugins: { legend: { position: "bottom", labels: { boxWidth: 10 } } }, cutout: "62%", animation: { animateRotate: true, duration: 1200 } }
  });
  if (charts.time) charts.time.destroy();
  charts.time = phosChart(document.getElementById("time-canvas"), {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "listed", data: rows.map((r) => r.listed), borderColor: PHOS, backgroundColor: "rgba(125,255,154,0.12)", fill: true, tension: 0.25, pointRadius: 2 },
        { label: "due", data: rows.map((r) => r.due), borderColor: WARN, tension: 0.25, pointRadius: 2 }
      ]
    },
    options: { plugins: { legend: { labels: { boxWidth: 10 } } }, scales: { y: { beginAtZero: true } }, animation: { duration: 900 } }
  });
  if (charts.escrow) charts.escrow.destroy();
  const algo = rows.map((r) => (r.escrow_micro == null ? null : r.escrow_micro / 1e6));
  charts.escrow = phosChart(document.getElementById("escrow-canvas"), {
    type: "line",
    data: { labels, datasets: [{ label: "ALGO", data: algo, borderColor: PHOS, backgroundColor: "rgba(125,255,154,0.18)", fill: true, tension: 0.3, spanGaps: true, pointRadius: 2 }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } }, animation: { duration: 900 } }
  });
}

function drawSky(upkeeps, round) {
  const c = document.getElementById("sky-canvas");
  const x = c.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  c.width = c.clientWidth * dpr;
  c.height = c.clientHeight * dpr;
  x.clearRect(0, 0, c.width, c.height);
  const items = (upkeeps || []).filter((u) => !SKIP.has(u.id));
  if (!items.length) {
    x.fillStyle = DIM;
    x.fillText("no sky yet", 16, 28);
    return;
  }
  const maxNext = Math.max(...items.map((u) => u.next || 0));
  const minNext = Math.min(...items.map((u) => u.next || 0));
  const maxBal = Math.max(...items.map((u) => u.balance || 0), 1);
  items.forEach((u) => {
    const px = 20 + ((u.next - minNext) / Math.max(1, maxNext - minNext)) * (c.width - 40);
    const py = c.height - 20 - ((u.balance || 0) / maxBal) * (c.height - 40);
    const due = (u.next || 0) <= round;
    x.beginPath();
    x.arc(px, py, due ? 5 : 3.5, 0, Math.PI * 2);
    x.fillStyle = due ? WARN : PHOS;
    x.globalAlpha = 0.85;
    x.fill();
    x.globalAlpha = 0.25;
    x.beginPath();
    x.arc(px, py, due ? 12 : 8, 0, Math.PI * 2);
    x.fill();
    x.globalAlpha = 1;
  });
}

async function bootSql(rows) {
  const SQL = await initSqlJs({
    locateFile: (f) => "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.11.0/" + f
  });
  db = new SQL.Database();
  db.run("CREATE TABLE samples (t TEXT, round INTEGER, listed INTEGER, due INTEGER, skipped INTEGER, unfunded INTEGER, waiting INTEGER, on_schedule INTEGER, escrow_micro INTEGER, source TEXT);");
  const ins = db.prepare("INSERT INTO samples VALUES (?,?,?,?,?,?,?,?,?,?)");
  rows.forEach((r) => {
    ins.run([r.t, r.round, r.listed, r.due, r.skipped || 0, r.unfunded, r.waiting, r.on_schedule, r.escrow_micro, r.source]);
  });
  ins.free();
}

async function main() {
  let history = [];
  let live = {};
  try { history = await fetch("history.json").then((r) => r.json()); } catch (e) { history = []; }
  try { live = await fetch("live.json").then((r) => r.json()); } catch (e) { live = {}; }
  if (!Array.isArray(history)) history = [];
  try { await bootSql(history); } catch (e) { db = null; }
  const rows = queryAll();
  drawCharts(rows.length ? rows : history);
  drawSky((live.upkeeps || (live.ids||[]).filter(function(id){return id!==81;}).map(function(id,i){return {id:id,next:(live.last_round||0)+i*300,balance:400000};})), live.round || live.last_round || lastRound);
  live.round = live.round || live.last_round;
  if (live.round) {
    lastRound = live.round;
    hudEl.textContent = "ROUND " + live.round;
    clockEl.textContent = "snapshot " + live.round + " · sqlite " + rows.length + " samples";
  }
  await ping();
  setInterval(ping, 8000);
}

main();

function size(c) {
  const dpr = window.devicePixelRatio || 1;
  c.width = c.clientWidth * dpr;
  c.height = c.clientHeight * dpr;
  return c.getContext("2d");
}
function drawPlain(rows) {
  line(document.getElementById("time-canvas"), rows, ["listed", "due"]);
  line(document.getElementById("escrow-canvas"), rows, ["escrow_micro"]);
  pie(document.getElementById("mix-canvas"), rows[rows.length - 1] || {});
}
function line(c, rows, keys) {
  const x = size(c);
  const w = c.width, h = c.height;
  keys.forEach((k, ki) => {
    const vals = rows.map((r) => Number(r[k] || 0));
    const max = Math.max.apply(null, vals.concat([1]));
    x.beginPath();
    vals.forEach((v, i) => {
      const px = 16 + i * (w - 32) / Math.max(1, vals.length - 1);
      const py = h - 16 - (v / max) * (h - 32);
      if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
    });
    x.strokeStyle = ki ? WARN : PHOS;
    x.lineWidth = 2;
    x.stroke();
  });
}
function pie(c, latest) {
  const x = size(c);
  const w = c.width, h = c.height;
  const parts = [
    [latest.on_schedule || 0, PHOS],
    [latest.waiting || 0, WARN],
    [latest.unfunded || 0, HOT],
    [latest.due || 0, DIM]
  ];
  const sum = parts.reduce((a, p) => a + p[0], 0) || 1;
  let a = -Math.PI / 2;
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.32;
  parts.forEach((p) => {
    const d = (p[0] / sum) * Math.PI * 2;
    x.beginPath();
    x.moveTo(cx, cy);
    x.arc(cx, cy, r, a, a + d);
    x.closePath();
    x.fillStyle = p[1];
    x.fill();
    a += d;
  });
}
