// Oyuncu ve yönetici ekranlarının ortak parçaları.

// Etkinlik bilgileri: metinleri buradan değiştirebilirsin.
// Logo için public klasörüne logo.png (veya logo.svg) koyman yeterli; yoksa yazı gösterilir.
const BRAND = {
  org: 'IEEE OMÜ',
  orgFull: 'Ondokuz Mayıs Üniversitesi IEEE Öğrenci Topluluğu',
  event: 'Savunma Sanayi Günleri',
  tagline: 'Toplantı sonrası oyun gecesi',
};

function mountBrand() {
  document.querySelectorAll('[data-brand="org"], [data-brand="orgname"]').forEach((el) => { el.textContent = BRAND.org; });
  document.querySelectorAll('[data-brand="event"]').forEach((el) => { el.textContent = BRAND.event; });
  document.querySelectorAll('[data-brand="tagline"]').forEach((el) => { el.textContent = BRAND.tagline; });
  const tryLogo = (srcs) => {
    if (!srcs.length) return;
    const img = new Image();
    img.alt = `${BRAND.org} logosu`;
    img.onload = () => {
      document.querySelectorAll('[data-brand="org"]').forEach((el) => {
        el.textContent = '';
        el.classList.add('has-img');
        el.appendChild(img.cloneNode());
      });
    };
    img.onerror = () => tryLogo(srcs.slice(1));
    img.src = srcs[0];
  };
  tryLogo(['/logo.png', '/logo.svg', '/logo.jpg']);
}

// Ekran açık kalsın (desteklenen telefonlarda).
async function keepScreenOn() {
  try {
    if (!('wakeLock' in navigator)) return;
    await navigator.wakeLock.request('screen');
  } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') keepScreenOn();
});

// Ücretsiz sunucular istek gelmezse uykuya geçip oyunu sıfırlayabilir; açık her ekran ara ara haber verir.
setInterval(() => { fetch('/saglik', { cache: 'no-store' }).catch(() => {}); }, 4 * 60 * 1000);

const ROLE_INFO = {
  vampir: {
    name: 'Vampir',
    team: 'Vampirler',
    sigil: 'V',
    desc: 'Her gece diğer vampirlerle birlikte bir kurban seçersiniz. Gündüz köylü gibi davran, şüpheyi başkasının üstüne çek.',
  },
  koylu: {
    name: 'Köylü',
    team: 'Köy',
    sigil: 'K',
    desc: 'Özel bir gücün yok ama en kalabalık sizsiniz. Gündüz konuş, çelişkileri yakala, vampirleri oyla.',
  },
  doktor: {
    name: 'Doktor',
    team: 'Köy',
    sigil: 'D',
    desc: 'Her gece bir kişiyi korursun; o gece saldırıya uğrarsa ölmez. Kendini de koruyabilirsin ama aynı kişiyi iki gece üst üste koruyamazsın.',
  },
  gozcu: {
    name: 'Gözcü',
    team: 'Köy',
    sigil: 'G',
    desc: 'Her gece bir kişinin vampir olup olmadığını öğrenirsin. Bildiğini dikkatli paylaş: vampirler seni ilk hedef yapar.',
  },
  avci: {
    name: 'Avcı',
    team: 'Köy',
    sigil: 'A',
    desc: 'Öldüğünde son bir atış hakkın olur ve istediğin birini yanında götürürsün. İyi nişan al.',
  },
  cadi: {
    name: 'Cadı',
    team: 'Köy',
    sigil: 'C',
    desc: 'Bir hayat iksirin ve bir ölüm iksirin var. Hayat iksiri vampirlerin kurbanını kurtarır, ölüm iksiri seçtiğin birini öldürür. Her biri oyun boyunca bir kez.',
  },
  deli: {
    name: 'Deli',
    team: 'Tek başına',
    sigil: '?',
    desc: 'Tek amacın gündüz oylamasında asılmak. Köy seni asarsa oyunu tek başına kazanırsın. Şüpheli davran ama fazla belli etme.',
  },
};

const ROLE_ORDER = ['vampir', 'doktor', 'gozcu', 'avci', 'cadi', 'deli', 'koylu'];

const WINNER_TEXT = {
  vampir: 'Vampirler kazandı',
  koy: 'Köy kazandı',
  deli: 'Deli kazandı',
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function phaseLabel(phase, round) {
  return {
    lobby: 'Lobi',
    reveal: 'Roller dağıtıldı',
    night: `${round}. gece`,
    day: `${round}. gün`,
    ended: 'Oyun bitti',
  }[phase] || phase;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Sunucuya ulaşılamadı.'), { status: res.status });
  return data;
}

const store = {
  get(k) {
    try { return localStorage.getItem(k); } catch { return null; }
  },
  set(k, v) {
    try { localStorage.setItem(k, v); } catch {}
  },
  del(k) {
    try { localStorage.removeItem(k); } catch {}
  },
};

let toastTimer;
function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

// SSE bağlantısı; koparsa tarayıcı kendisi yeniden bağlanır.
function connect(query, onData, onStatus) {
  const es = new EventSource(`/events?${query}`);
  es.onopen = () => onStatus?.(true);
  es.onerror = () => onStatus?.(false);
  es.onmessage = (e) => onData(JSON.parse(e.data));
  return es;
}
