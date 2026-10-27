// Vampir Köylü — topluluk içi oyun sunucusu.
// Bağımlılık yok: `node server.js` ile çalışır. Telefonlar aynı ağdan bağlanır.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || String(crypto.randomInt(1000, 10000));
const PUBLIC_DIR = path.join(__dirname, 'public');

const ROLES = {
  vampir: { name: 'Vampir', team: 'vampir' },
  koylu: { name: 'Köylü', team: 'koy' },
  doktor: { name: 'Doktor', team: 'koy' },
  gozcu: { name: 'Gözcü', team: 'koy' },
  avci: { name: 'Avcı', team: 'koy' },
  cadi: { name: 'Cadı', team: 'koy' },
  deli: { name: 'Deli', team: 'deli' },
};
const SPECIAL_ROLES = ['vampir', 'doktor', 'gozcu', 'avci', 'cadi', 'deli'];

// ---------- Oyun durumu ----------

const players = new Map(); // id -> { id, token, name, role, alive, joinedAt }
const tokens = new Map(); // token -> id

function emptyNight() {
  return { vampireVotes: {}, doctor: null, seer: null, witchSave: false, witchKill: null };
}

const game = {
  phase: 'lobby', // lobby | reveal | night | day | ended
  round: 0,
  counts: null, // null = oyuncu sayısına göre otomatik
  revealOnDeath: true,
  night: emptyNight(),
  lastProtected: null,
  witch: { saveUsed: false, killUsed: false },
  seerHistory: [], // { round, targetId, isVampire }
  votes: {}, // voterId -> targetId | 'pas'
  votingOpen: false,
  hunterQueue: [],
  winner: null, // vampir | koy | deli
  log: [], // { round, phase, text }
};

function suggestCounts(n) {
  return {
    vampir: Math.max(1, Math.floor(n / 4)),
    doktor: n >= 5 ? 1 : 0,
    gozcu: n >= 5 ? 1 : 0,
    avci: n >= 8 ? 1 : 0,
    cadi: n >= 10 ? 1 : 0,
    deli: n >= 12 ? 1 : 0,
  };
}

function effectiveCounts() {
  return game.counts || suggestCounts(players.size);
}

function specialTotal(counts) {
  return SPECIAL_ROLES.reduce((sum, r) => sum + (counts[r] || 0), 0);
}

const alivePlayers = () => [...players.values()].filter((p) => p.alive);
const nameOf = (id) => players.get(id)?.name || '?';

function addLog(text) {
  game.log.push({ round: game.round, phase: game.phase, text });
  if (game.log.length > 200) game.log.shift();
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function resetRoundState() {
  game.night = emptyNight();
  game.lastProtected = null;
  game.witch = { saveUsed: false, killUsed: false };
  game.seerHistory = [];
  game.votes = {};
  game.votingOpen = false;
  game.hunterQueue = [];
  game.winner = null;
  game.log = [];
  game.round = 0;
}

function dealRoles() {
  const list = [...players.values()];
  const counts = effectiveCounts();
  if (list.length < 3) throw new Error('En az 3 oyuncu gerekli.');
  if (!counts.vampir) throw new Error('En az 1 vampir olmalı.');
  if (specialTotal(counts) > list.length) throw new Error('Özel rol sayısı oyuncu sayısından fazla.');
  const deck = [];
  for (const r of SPECIAL_ROLES) for (let i = 0; i < (counts[r] || 0); i++) deck.push(r);
  while (deck.length < list.length) deck.push('koylu');
  shuffle(deck);
  list.forEach((p, i) => {
    p.role = deck[i];
    p.alive = true;
  });
  resetRoundState();
  game.phase = 'reveal';
}

// Vampir oylarını sayar. randomTie: berabere kalınca rastgele seç (sabah çözümünde).
function vampireTally() {
  const tally = {};
  for (const [voterId, targetId] of Object.entries(game.night.vampireVotes)) {
    const voter = players.get(voterId);
    const target = players.get(targetId);
    if (!voter?.alive || voter.role !== 'vampir' || !target?.alive) continue;
    tally[targetId] = (tally[targetId] || 0) + 1;
  }
  const max = Math.max(0, ...Object.values(tally));
  const leaders = max ? Object.keys(tally).filter((id) => tally[id] === max) : [];
  return { tally, leaders };
}

function killPlayer(id) {
  const p = players.get(id);
  if (!p || !p.alive) return false;
  p.alive = false;
  if (p.role === 'avci') game.hunterQueue.push(p.id);
  return true;
}

function deathText(id) {
  const p = players.get(id);
  return game.revealOnDeath ? `${p.name} (${ROLES[p.role].name})` : p.name;
}

function checkWin() {
  if (game.phase === 'ended' || game.hunterQueue.length) return;
  const alive = alivePlayers();
  const vampires = alive.filter((p) => p.role === 'vampir').length;
  const others = alive.length - vampires;
  if (vampires === 0) endGame('koy');
  else if (vampires >= others) endGame('vampir');
}

function endGame(winner) {
  game.winner = winner;
  game.phase = 'ended';
  game.votingOpen = false;
  const text = {
    vampir: 'Vampirler kazandı. Köyde onlara karşı koyacak kimse kalmadı.',
    koy: 'Köylüler kazandı. Son vampir de yakalandı.',
    deli: 'Deli kazandı! Köy onu astı ve tam istediği oldu.',
  }[winner] || 'Oyun yönetici tarafından bitirildi.';
  addLog(text);
}

function startNight() {
  game.phase = 'night';
  game.round += 1;
  game.night = emptyNight();
  game.votes = {};
  game.votingOpen = false;
  addLog(`${game.round}. gece başladı.`);
}

function resolveNight() {
  const { leaders } = vampireTally();
  const victim = leaders.length ? leaders[crypto.randomInt(0, leaders.length)] : null;
  const protectedId = game.night.doctor;
  const deaths = [];
  let saved = false;

  if (victim) {
    if (victim === protectedId) saved = true;
    else if (game.night.witchSave) saved = true;
    else deaths.push(victim);
  }
  if (game.night.witchSave) game.witch.saveUsed = true;
  if (game.night.witchKill) {
    game.witch.killUsed = true;
    const wk = game.night.witchKill;
    if (wk !== protectedId && !deaths.includes(wk) && players.get(wk)?.alive) deaths.push(wk);
  }
  game.lastProtected = protectedId;

  game.phase = 'day';
  deaths.forEach(killPlayer);
  if (deaths.length) addLog(`Sabah oldu. Bu gece ölenler: ${deaths.map(deathText).join(', ')}.`);
  else addLog(saved ? 'Sabah oldu. Vampirler saldırdı ama kurban kurtarıldı. Kimse ölmedi.' : 'Sabah oldu. Bu gece kimse ölmedi.');
  checkWin();
}

function voteTally() {
  const tally = {};
  for (const [voterId, targetId] of Object.entries(game.votes)) {
    if (!players.get(voterId)?.alive) continue;
    if (targetId !== 'pas' && !players.get(targetId)?.alive) continue;
    (tally[targetId] ||= []).push(voterId);
  }
  return tally;
}

function closeVote() {
  game.votingOpen = false;
  const tally = voteTally();
  const entries = Object.entries(tally).filter(([id]) => id !== 'pas');
  const max = Math.max(0, ...entries.map(([, v]) => v.length));
  const leaders = entries.filter(([, v]) => v.length === max).map(([id]) => id);
  if (!max) return addLog('Oylama kapandı. Kimse oy almadı, kimse asılmadı.');
  if (leaders.length > 1) {
    return addLog(`Oylama berabere bitti (${leaders.map(nameOf).join(', ')}). Kimse asılmadı.`);
  }
  const hanged = players.get(leaders[0]);
  killPlayer(hanged.id);
  addLog(`Köy kararını verdi (${max} oy): ${deathText(hanged.id)} asıldı.`);
  if (hanged.role === 'deli') return endGame('deli');
  checkWin();
}

function hunterShoot(targetId) {
  const hunterId = game.hunterQueue.shift();
  if (!hunterId) return;
  if (targetId && players.get(targetId)?.alive && targetId !== hunterId) {
    killPlayer(targetId);
    addLog(`Avcı ${nameOf(hunterId)} son atışını yaptı: ${deathText(targetId)} öldü.`);
  } else {
    addLog(`Avcı ${nameOf(hunterId)} son atışını kullanmadı.`);
  }
  checkWin();
}

// ---------- Oyuncu eylemleri ----------

function playerAction(p, { type, target }) {
  const t = target ? players.get(target) : null;
  const needAliveTarget = () => {
    if (!t || !t.alive) throw new Error('Geçerli bir hedef seç.');
  };

  if (type === 'leave') {
    if (game.phase !== 'lobby') throw new Error('Oyun sürerken ayrılamazsın.');
    players.delete(p.id);
    tokens.delete(p.token);
    return;
  }
  if (type === 'hunter_shoot') {
    if (game.hunterQueue[0] !== p.id) throw new Error('Şu an atış sırası sende değil.');
    return hunterShoot(target || null);
  }
  if (type === 'day_vote') {
    if (game.phase !== 'day' || !game.votingOpen) throw new Error('Oylama açık değil.');
    if (!p.alive) throw new Error('Ölüler oy veremez.');
    if (target === null) delete game.votes[p.id];
    else if (target === 'pas') game.votes[p.id] = 'pas';
    else {
      needAliveTarget();
      game.votes[p.id] = t.id;
    }
    return;
  }

  if (game.phase !== 'night') throw new Error('Bu eylem sadece gece yapılabilir.');
  if (!p.alive) throw new Error('Ölüler gece eylemi yapamaz.');
  const n = game.night;

  switch (type) {
    case 'vampire_vote':
      if (p.role !== 'vampir') throw new Error('Bu eylem vampirlere özel.');
      if (target === null) return void delete n.vampireVotes[p.id];
      needAliveTarget();
      if (t.role === 'vampir') throw new Error('Başka bir vampiri hedef alamazsın.');
      n.vampireVotes[p.id] = t.id;
      return;
    case 'protect':
      if (p.role !== 'doktor') throw new Error('Bu eylem doktora özel.');
      needAliveTarget();
      if (t.id === game.lastProtected) throw new Error('Aynı kişiyi iki gece üst üste koruyamazsın.');
      n.doctor = t.id;
      return;
    case 'inspect':
      if (p.role !== 'gozcu') throw new Error('Bu eylem gözcüye özel.');
      if (n.seer) throw new Error('Bu gece zaten birine baktın.');
      needAliveTarget();
      if (t.id === p.id) throw new Error('Kendine bakamazsın.');
      n.seer = { targetId: t.id, isVampire: t.role === 'vampir' };
      game.seerHistory.push({ round: game.round, ...n.seer });
      return;
    case 'witch_save':
      if (p.role !== 'cadi') throw new Error('Bu eylem cadıya özel.');
      if (game.witch.saveUsed) throw new Error('Hayat iksirini zaten kullandın.');
      n.witchSave = !!target;
      return;
    case 'witch_kill':
      if (p.role !== 'cadi') throw new Error('Bu eylem cadıya özel.');
      if (game.witch.killUsed) throw new Error('Ölüm iksirini zaten kullandın.');
      if (target === null) return void (n.witchKill = null);
      needAliveTarget();
      if (t.id === p.id) throw new Error('Kendini zehirleyemezsin.');
      n.witchKill = t.id;
      return;
  }
  throw new Error('Bilinmeyen eylem.');
}

// ---------- Yönetici eylemleri ----------

function adminAction(body) {
  const { type } = body;
  switch (type) {
    case 'set_count': {
      const counts = { ...effectiveCounts() };
      if (!SPECIAL_ROLES.includes(body.role)) throw new Error('Bilinmeyen rol.');
      counts[body.role] = Math.max(0, Math.min(40, Number(body.value) || 0));
      game.counts = counts;
      return;
    }
    case 'auto_counts':
      game.counts = null;
      return;
    case 'toggle_reveal':
      game.revealOnDeath = !game.revealOnDeath;
      return;
    case 'deal':
      if (game.phase !== 'lobby') throw new Error('Roller sadece lobide dağıtılabilir.');
      return dealRoles();
    case 'start_night':
      if (!['reveal', 'day'].includes(game.phase)) throw new Error('Şu an geceye geçilemez.');
      if (game.hunterQueue.length) throw new Error('Önce avcının atışı tamamlanmalı.');
      return startNight();
    case 'end_night':
      if (game.phase !== 'night') throw new Error('Şu an gece değil.');
      return resolveNight();
    case 'open_vote':
      if (game.phase !== 'day') throw new Error('Oylama sadece gündüz açılır.');
      if (game.hunterQueue.length) throw new Error('Önce avcının atışı tamamlanmalı.');
      game.votes = {};
      game.votingOpen = true;
      addLog('Köy meydanında oylama başladı.');
      return;
    case 'close_vote':
      if (!game.votingOpen) throw new Error('Açık oylama yok.');
      return closeVote();
    case 'hunter_shoot':
      if (!game.hunterQueue.length) throw new Error('Bekleyen avcı yok.');
      return hunterShoot(body.target || null);
    case 'kill': {
      const p = players.get(body.id);
      if (!p || !p.alive) throw new Error('Oyuncu bulunamadı.');
      killPlayer(p.id);
      addLog(`Yönetici kararıyla ${deathText(p.id)} oyundan çıktı.`);
      return checkWin();
    }
    case 'revive': {
      const p = players.get(body.id);
      if (!p || p.alive) throw new Error('Oyuncu bulunamadı.');
      p.alive = true;
      game.hunterQueue = game.hunterQueue.filter((id) => id !== p.id);
      addLog(`${p.name} yönetici kararıyla geri döndü.`);
      return;
    }
    case 'kick': {
      const p = players.get(body.id);
      if (!p) throw new Error('Oyuncu bulunamadı.');
      players.delete(p.id);
      tokens.delete(p.token);
      game.hunterQueue = game.hunterQueue.filter((id) => id !== p.id);
      for (const c of clients) if (c.token === p.token) send(c, { kind: 'kicked' });
      if (game.phase !== 'lobby') checkWin();
      return;
    }
    case 'end_game':
      if (game.phase === 'lobby') throw new Error('Oyun henüz başlamadı.');
      game.hunterQueue = [];
      return endGame(null);
    case 'to_lobby':
      for (const p of players.values()) {
        p.role = null;
        p.alive = true;
      }
      resetRoundState();
      game.phase = 'lobby';
      return;
    case 'clear_players':
      if (game.phase !== 'lobby') throw new Error('Önce lobiye dön.');
      for (const c of clients) if (c.token) send(c, { kind: 'kicked' });
      players.clear();
      tokens.clear();
      return;
  }
  throw new Error('Bilinmeyen yönetici eylemi.');
}

// ---------- Görünümler (her istemci sadece görmesi gerekeni alır) ----------

function playerView(p) {
  const isVampire = p.role === 'vampir';
  const visibleRole = (q) => {
    if (game.phase === 'lobby') return null;
    if (game.phase === 'ended' || q.id === p.id) return q.role;
    if (!q.alive && game.revealOnDeath) return q.role;
    if (isVampire && q.role === 'vampir') return 'vampir';
    return null;
  };

  const view = {
    kind: 'player',
    phase: game.phase,
    round: game.round,
    me: { id: p.id, name: p.name, alive: p.alive, role: game.phase === 'lobby' ? null : p.role },
    players: [...players.values()].map((q) => ({ id: q.id, name: q.name, alive: q.alive, role: visibleRole(q) })),
    log: game.log.slice(-15),
    winner: game.winner,
    hunterTurn: game.hunterQueue[0] === p.id,
    hunterPending: game.hunterQueue.length > 0,
    voting: null,
    night: null,
  };

  if (game.phase === 'day') {
    const tally = voteTally();
    view.voting = { open: game.votingOpen, tally, myVote: game.votes[p.id] || null };
  }

  if (p.role === 'gozcu') view.seerHistory = game.seerHistory;

  if (game.phase === 'night' && p.alive) {
    const n = game.night;
    if (isVampire) view.night = { votes: n.vampireVotes, tally: vampireTally().tally };
    if (p.role === 'doktor') view.night = { choice: n.doctor, lastProtected: game.lastProtected };
    if (p.role === 'gozcu') view.night = { seer: n.seer };
    if (p.role === 'cadi') {
      view.night = {
        victims: vampireTally().leaders,
        save: n.witchSave,
        kill: n.witchKill,
        saveUsed: game.witch.saveUsed,
        killUsed: game.witch.killUsed,
      };
    }
  }
  return view;
}

function adminView() {
  const counts = effectiveCounts();
  return {
    kind: 'admin',
    phase: game.phase,
    round: game.round,
    players: [...players.values()].map(({ id, name, role, alive, joinedAt }) => ({ id, name, role, alive, joinedAt })),
    counts,
    autoCounts: !game.counts,
    revealOnDeath: game.revealOnDeath,
    night: { ...game.night, ...vampireTally() },
    lastProtected: game.lastProtected,
    witch: game.witch,
    seerHistory: game.seerHistory,
    voting: { open: game.votingOpen, tally: voteTally() },
    hunterQueue: game.hunterQueue,
    winner: game.winner,
    log: game.log,
  };
}

// ---------- Canlı bağlantılar (Server-Sent Events) ----------

const clients = new Set(); // { res, token, admin }

function send(client, data) {
  try {
    client.res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch {}
}

function viewFor(client) {
  if (client.admin) return adminView();
  const p = players.get(tokens.get(client.token));
  return p ? playerView(p) : { kind: 'unknown' };
}

let broadcastQueued = false;
function broadcast() {
  if (broadcastQueued) return;
  broadcastQueued = true;
  setImmediate(() => {
    broadcastQueued = false;
    for (const c of clients) send(c, viewFor(c));
  });
}

setInterval(() => {
  for (const c of clients) {
    try {
      c.res.write(': ping\n\n');
    } catch {}
  }
}, 20000);

// ---------- HTTP ----------

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/yonetici': ['yonetici.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/shared.js': ['shared.js', 'text/javascript; charset=utf-8'],
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 10000) reject(new Error('İstek çok büyük.'));
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('Geçersiz istek.'));
      }
    });
  });
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

// Gerçek Wi-Fi/Ethernet adresini öne al; WSL, Hyper-V, VPN gibi sanal kartları sona at.
function lanUrls() {
  const found = [];
  for (const [ifName, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      let score = 0;
      if (/vethernet|wsl|hyper-v|virtualbox|vmware|docker|loopback|tailscale|zerotier|vpn/i.test(ifName)) score += 10;
      if (a.address.startsWith('192.168.')) score -= 2;
      else if (a.address.startsWith('10.')) score -= 1;
      found.push({ url: `http://${a.address}:${PORT}`, score });
    }
  }
  return found.sort((x, y) => x.score - y.score).map((x) => x.url);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  if (req.method === 'GET' && STATIC[url.pathname]) {
    const [file, type] = STATIC[url.pathname];
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    return fs.createReadStream(path.join(PUBLIC_DIR, file)).pipe(res);
  }

  // İsteğe bağlı logo: public/logo.png, logo.svg veya logo.jpg
  const logo = url.pathname.match(/^\/logo\.(png|svg|jpg)$/);
  if (req.method === 'GET' && logo) {
    const file = path.join(PUBLIC_DIR, `logo.${logo[1]}`);
    if (!fs.existsSync(file)) return json(res, 404, { error: 'Logo yok.' });
    const type = { png: 'image/png', svg: 'image/svg+xml', jpg: 'image/jpeg' }[logo[1]];
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'max-age=300' });
    return fs.createReadStream(file).pipe(res);
  }

  if (req.method === 'GET' && url.pathname === '/saglik') return json(res, 200, { ok: true });

  if (req.method === 'GET' && url.pathname === '/events') {
    const admin = url.searchParams.get('pin') === ADMIN_PIN;
    const token = url.searchParams.get('token');
    if (!admin && !token) return json(res, 401, { error: 'Yetkisiz.' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    const client = { res, token: admin ? null : token, admin };
    clients.add(client);
    send(client, viewFor(client));
    req.on('close', () => clients.delete(client));
    return;
  }

  if (req.method !== 'POST') return json(res, 404, { error: 'Bulunamadı.' });

  try {
    const body = await readBody(req);

    if (url.pathname === '/api/join') {
      const existing = players.get(tokens.get(body.token));
      if (existing) return json(res, 200, { token: existing.token });
      const name = String(body.name || '').replace(/\s+/g, ' ').trim().slice(0, 24);
      if (!name) throw new Error('Bir isim yaz.');
      if (game.phase !== 'lobby') throw new Error('Oyun başladı. Yönetici yeni el açınca katılabilirsin.');
      const taken = [...players.values()].some((p) => p.name.toLocaleLowerCase('tr') === name.toLocaleLowerCase('tr'));
      if (taken) throw new Error('Bu isim alınmış. Soyadının baş harfini ekleyebilirsin.');
      const p = { id: crypto.randomUUID(), token: crypto.randomUUID(), name, role: null, alive: true, joinedAt: Date.now() };
      players.set(p.id, p);
      tokens.set(p.token, p.id);
      broadcast();
      return json(res, 200, { token: p.token });
    }

    if (url.pathname === '/api/action') {
      const p = players.get(tokens.get(body.token));
      if (!p) return json(res, 401, { error: 'Oturumun bulunamadı, yeniden katıl.' });
      playerAction(p, body);
      broadcast();
      return json(res, 200, { ok: true });
    }

    if (url.pathname === '/api/admin') {
      if (body.pin !== ADMIN_PIN) return json(res, 401, { error: 'PIN hatalı.' });
      if (body.type === 'info') return json(res, 200, { urls: lanUrls() });
      adminAction(body);
      broadcast();
      return json(res, 200, { ok: true });
    }

    json(res, 404, { error: 'Bulunamadı.' });
  } catch (err) {
    json(res, 400, { error: err.message || 'Bir hata oluştu.' });
  }
});

server.listen(PORT, () => {
  const urls = lanUrls();
  console.log('\n  Vampir Köylü hazır.\n');
  console.log(`  Yönetici ekranı : http://localhost:${PORT}/yonetici`);
  console.log(`  Yönetici PIN    : ${ADMIN_PIN}\n`);
  console.log('  Oyuncular telefondan şu adrese girsin (aynı Wi-Fi):');
  for (const u of urls) console.log(`    ${u}`);
  if (!urls.length) console.log('    (ağ bağlantısı bulunamadı)');
  console.log('');
});
