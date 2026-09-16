// ==========================================================
// Trendora - Müştəri Paneli
// ==========================================================
const API = '/api';
const STATUS_STEPS = ['qəbul edildi', 'hazırlanır', 'qablaşdırılır', 'kuryerə verildi', 'yoldadır', 'çatdırıldı'];
const FINAL_STATUS = 'çatdırıldı';
const CANCELLED_STATUS = 'ləğv edildi';
// Kartdan-karta seçildikdə admin ödənişi təsdiqləyənə qədər sifarişin qaldığı status
const PENDING_TRANSFER_STATUS = 'ödəniş gözlənilir';
// Sifariş verildikdən sonra müştərinin özü ləğv edə biləcəyi müddət (backend ilə eyni)
const CUSTOMER_CANCEL_WINDOW_MS = 15 * 60 * 1000;

// Tam çatdırılma ünvanı forması sahələri (hamısı məcburidir)
const ADDRESS_FIELDS = [
  { id: 'first_name', label: 'Ad', required: true },
  { id: 'last_name', label: 'Soyad', required: true },
  { id: 'phone', label: 'Telefon nömrəsi', required: true },
  { id: 'city', label: 'Şəhər', required: true },
  { id: 'district', label: 'Rayon', required: true },
  { id: 'street_address', label: 'Küçə və ünvan', required: true },
  { id: 'postal_code', label: 'Poçt indeksi', required: true }
];

// Cins seçimləri
const GENDER_OPTIONS = [
  { value: '', label: 'Seçilməyib' },
  { value: 'kişi', label: 'Kişi' },
  { value: 'qadın', label: 'Qadın' },
  { value: 'bildirmək istəmirəm', label: 'Bildirmək istəmirəm' }
];

let state = {
  token: localStorage.getItem('trendora_token') || null,
  user: JSON.parse(localStorage.getItem('trendora_user') || 'null'),
  products: [],
  discountedProducts: [],
  productCache: {}, // id -> product (aktiv filtrdən asılı olmayaraq bütün görülmüş məhsulları saxlayır)
  favoriteIds: new Set(), // cari istifadəçinin sevimlilərinə əlavə etdiyi məhsul id-ləri
  favoriteProducts: [],
  categories: [],
  cart: JSON.parse(localStorage.getItem('trendora_cart') || '[]'),
  orders: [],
  pollTimers: {},
  cancelTimers: {},
  chatPollTimer: null,
  chatUnreadTimer: null,
  notifUnreadTimer: null,
  notifListPollTimer: null,
  notifications: [],
  paymentSettingsCache: null,
  soundSettings: { enabled: true, volume: 70, sound_url: '/audio/premium-chime.mp3' },
  chatUnreadPrev: null,
  notifUnreadPrev: null,
  currentModalProductId: null, // hazırda modalda açıq olan məhsulun id-si (variant seçimini ona bağlamaq üçün)
  selectedProductColorIndex: null, // modalda hazırda seçilmiş rəngin şəklinin indeksi - heç nə seçilməyibsə null
  selectedProductColorKey: null, // hazırda seçilmiş konkret rəng düyməsinin açarı (imageIndex-colorIndex)
  selectedProductColorName: '',
  selectedProductColorCode: '',
  selectedProductSize: null, // modalda hazırda seçilmiş ölçü
  selectedCategoryId: '', // mağazada hazırda aktiv olan kateqoriya filtri ('' = bütün kateqoriyalar)
  allShopProducts: [], // mağazadan yüklənmiş bütün (arxivlənməmiş) məhsullar - inkişaf etmiş filtrlər bunun üzərində tətbiq olunur
  shopFilters: { // "Filtrlər" panelindəki inkişaf etmiş filtr seçimləri
    name: '', minPrice: '', maxPrice: '', colors: new Set(), sizes: new Set(),
    unit: '', stock: '', discounted: false, bestseller: false, minRating: 0,
    delivery: '', sort: 'recommended'
  }
};

// Bir şəklin real rəng variantı (adı və ya kodu) daşıyıb-daşımadığını yoxlayır - sırf
// qalereya şəkli (rəngsiz, məs. detal fotosu) ilə həqiqi rəng variantını ayırd etmək üçün.
function imageHasColor(img) {
  return Boolean(img && ((img.colors && img.colors.length) || img.color_name || img.color_code));
}

// Bir məhsulun bütün şəkillərindəki rəngləri TƏK-TƏK (ayrı seçim variantı kimi) massivə çevirir.
// Bir şəkilə bir neçə rəng təyin edilibsə (məs. eyni fotoda "Qırmızı, Ağ, Yaşıl"), onlar burada
// ayrı-ayrı elementlər kimi qaytarılır ki, hər biri üçün ayrıca kliklənə bilən düymə yaradıla bilsin.
function buildColorOptions(images) {
  const options = [];
  images.forEach((img, imageIndex) => {
    const colors = (img.colors && img.colors.length)
      ? img.colors
      : ((img.color_name || img.color_code) ? [{ name: img.color_name || '', code: img.color_code || '' }] : []);
    colors.forEach((c, colorIndex) => {
      options.push({ imageIndex, colorIndex, name: c.name || '', code: c.code || '' });
    });
  });
  return options;
}

// Bildiriş növünə görə ikon
const NOTIFICATION_ICONS = {
  order_created: '🧾',
  payment_confirmed: '✅',
  order_ready: '📦',
  order_shipped: '🚚',
  order_delivered: '🏠',
  order_cancelled: '❌',
  promo_code_issued: '🎁',
  referral_reward: '🤝',
  admin_announcement: '📢',
  review_reply: '💬',
  favorite_discount: '❤️',
  general: '🔔'
};

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------- Köməkçi funksiyalar ----------
function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  return fetch(`${API}${path}`, { ...options, headers }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      // Backend token-in etibarsız olduğunu (admin tərəfindən ləğv edilib, hesab
      // deaktivdir və s.) bildirdikdə istifadəçini avtomatik lokal olaraq çıxarır.
      if (data.session_ended && state.token) {
        performLocalLogout('Sessiyanız sona çatdırılıb. Zəhmət olmasa yenidən daxil olun.');
      }
      const err = new Error(data.error || 'Xəta baş verdi.');
      Object.assign(err, data);
      throw err;
    }
    return data;
  });
}

// `apiFetch`-dən fərqli olaraq JSON deyil, `FormData` (fayl daxil olmaqla)
// göndərmək üçün istifadə olunur. `Content-Type` başlığı BİLƏRƏKDƏN təyin
// edilmir — brauzer onu multipart sərhəd (boundary) dəyəri ilə özü qoyur.
function apiUpload(path, method, formData) {
  const headers = {};
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  return fetch(`${API}${path}`, { method, headers, body: formData }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (data.session_ended && state.token) {
        performLocalLogout('Sessiyanız sona çatdırılıb. Zəhmət olmasa yenidən daxil olun.');
      }
      const err = new Error(data.error || 'Xəta baş verdi.');
      Object.assign(err, data);
      throw err;
    }
    return data;
  });
}

function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  el.classList.toggle('error', isError);
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}

function saveCart() {
  localStorage.setItem('trendora_cart', JSON.stringify(state.cart));
  renderCartBadge();
}

function renderCartBadge() {
  const count = state.cart.reduce((s, i) => s + i.quantity, 0);
  document.querySelectorAll('.cart-count-el').forEach((el) => { el.textContent = count; });
}

// ---------- Şifrə/PIN sahələri üçün Göstər/Gizlət düyməsi ----------
const PW_TOGGLE_ICONS =
  '<svg class="icon-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>' +
  '<svg class="icon-eye-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.6 21.6 0 0 1 5.06-6.06M9.9 4.24A10.4 10.4 0 0 1 12 4c7 0 11 8 11 8a21.6 21.6 0 0 1-3.22 4.6M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

// Verilən konteynerdəki bütün type="password" inputlarına Göstər/Gizlət düyməsi əlavə edir.
// Dinamik yaradılan formalarda (məs. profil) yenidən çağırıla bilər; artıq təchiz olunmuş
// inputları (data-pw-enhanced) yenidən sarımır.
function enhancePasswordToggles(root) {
  const scope = root || document;
  scope.querySelectorAll('input[type="password"]').forEach((input) => {
    if (input.dataset.pwEnhanced) return;
    input.dataset.pwEnhanced = '1';

    const wrap = document.createElement('div');
    wrap.className = 'password-field-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pw-toggle-btn';
    btn.setAttribute('aria-label', 'Göstər');
    btn.innerHTML = PW_TOGGLE_ICONS;
    btn.addEventListener('click', () => {
      const nowVisible = input.type === 'password';
      input.type = nowVisible ? 'text' : 'password';
      btn.classList.toggle('is-visible', nowVisible);
      btn.setAttribute('aria-label', nowVisible ? 'Gizlət' : 'Göstər');
    });
    wrap.appendChild(btn);
  });
}

// ---------- Görünüş idarəsi ----------
function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  document.getElementById(`view-${name}`).classList.remove('hidden');
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll(`.nav-btn[data-view="${name}"]`).forEach((b) => b.classList.add('active'));

  if (name === 'auth') showAuthForm('login');
  if (name === 'shop') { loadProducts(); loadBrands(); }
  if (name === 'discounts') loadDiscountedProducts();
  if (name === 'cart') renderCart();
  if (name === 'favorites') loadFavorites();
  if (name === 'orders') loadOrders();
  if (name === 'wheel') { loadWheelView(); }
  if (name === 'chat') { loadChatMessages(); startChatPolling(); }
  else stopChatPolling();
  if (name === 'profile') renderProfile();
  if (name === 'notifications') { loadNotifications(); startNotifListPolling(); }
  else stopNotifListPolling();
}

function requireAuthOr(view) {
  if (!state.token) {
    showView('auth');
    return false;
  }
  showView(view);
  return true;
}

// ---------- Auth ----------
document.querySelectorAll('.auth-tab').forEach((tab) => {
  tab.addEventListener('click', () => showAuthForm(tab.dataset.tab));
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  try {
    const data = await apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    onAuthSuccess(data);
  } catch (err) {
    toast(err.message, true);
  }
});

document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const pin = document.getElementById('reg-pin').value.trim();
    const confirmPin = document.getElementById('reg-confirm-pin').value.trim();
    if (!/^\d{4}$/.test(pin)) {
      toast('PIN 4 rəqəmdən ibarət olmalıdır.', true);
      return;
    }
    if (pin !== confirmPin) {
      toast('PIN-lər uyğun gəlmir.', true);
      return;
    }
    const payload = {
      name: document.getElementById('reg-name').value,
      surname: document.getElementById('reg-surname').value,
      email: document.getElementById('reg-email').value,
      phone: document.getElementById('reg-phone').value,
      address: document.getElementById('reg-address').value,
      password: document.getElementById('reg-password').value,
      pin,
      confirm_pin: confirmPin
    };
    const data = await apiFetch('/auth/register', { method: 'POST', body: JSON.stringify(payload) });
    onAuthSuccess(data);
  } catch (err) {
    toast(err.message, true);
  }
});

function onAuthSuccess(data) {
  state.token = data.token;
  state.user = data.user;
  localStorage.setItem('trendora_token', data.token);
  localStorage.setItem('trendora_user', JSON.stringify(data.user));
  toast(`Xoş gəldiniz, ${data.user.name}!`);
  loadFavoriteIds();
  showView('shop');
  startChatUnreadPolling();
  startNotifUnreadPolling();
  checkWheelAvailability();
}

// ---------- Şifrəni unutdum ----------
let forgotEmail = '';

function showAuthForm(name) {
  document.getElementById('login-form').classList.toggle('hidden', name !== 'login');
  document.getElementById('register-form').classList.toggle('hidden', name !== 'register');
  document.getElementById('forgot-email-form').classList.toggle('hidden', name !== 'forgot-email');
  document.getElementById('forgot-reset-form').classList.toggle('hidden', name !== 'forgot-reset');
  document.querySelectorAll('.auth-tab').forEach((t) => t.classList.remove('active'));
  if (name === 'login' || name === 'register') {
    const tab = document.querySelector(`.auth-tab[data-tab="${name}"]`);
    if (tab) tab.classList.add('active');
  }
}

document.getElementById('forgot-password-link').addEventListener('click', () => {
  document.getElementById('forgot-email').value = '';
  showAuthForm('forgot-email');
});

document.getElementById('forgot-back-to-login').addEventListener('click', () => showAuthForm('login'));
document.getElementById('forgot-reset-back').addEventListener('click', () => showAuthForm('login'));

document.getElementById('forgot-email-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('forgot-email').value.trim();
  try {
    await apiFetch('/auth/forgot-password/check', { method: 'POST', body: JSON.stringify({ email }) });
    forgotEmail = email;
    document.getElementById('forgot-pin-hint').textContent =
      'Hesabınız üçün təyin etdiyiniz 4 rəqəmli PIN kodunu daxil edin.';
    document.getElementById('forgot-pin').value = '';
    document.getElementById('forgot-new-password').value = '';
    document.getElementById('forgot-confirm-password').value = '';
    showAuthForm('forgot-reset');
  } catch (err) {
    toast(err.message, true);
  }
});

document.getElementById('forgot-reset-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pin = document.getElementById('forgot-pin').value.trim();
  const new_password = document.getElementById('forgot-new-password').value;
  const confirm_password = document.getElementById('forgot-confirm-password').value;
  if (new_password !== confirm_password) {
    toast('Şifrələr uyğun gəlmir.', true);
    return;
  }
  try {
    await apiFetch('/auth/forgot-password/reset', {
      method: 'POST',
      body: JSON.stringify({ email: forgotEmail, pin, new_password, confirm_password })
    });
    toast('Şifrəniz uğurla dəyişdirildi.');
    document.getElementById('login-email').value = forgotEmail;
    forgotEmail = '';
    showAuthForm('login');
  } catch (err) {
    toast(err.message, true);
  }
});

// Lokal sessiyanı təmizləyir (token/user silinir, pollinglər dayandırılır) və
// Giriş görünüşünə keçir. Həm "Çıxış" düyməsi, həm də admin tərəfindən sessiya
// ləğv edildikdə (bax: apiFetch -> session_ended) bu funksiya çağırılır.
function performLocalLogout(message) {
  state.token = null;
  state.user = null;
  localStorage.removeItem('trendora_token');
  localStorage.removeItem('trendora_user');
  stopChatPolling();
  stopChatUnreadPolling();
  stopNotifUnreadPolling();
  stopNotifListPolling();
  state.chatUnreadPrev = null;
  state.notifUnreadPrev = null;
  state.favoriteIds = new Set();
  state.favoriteProducts = [];
  document.querySelectorAll('.chat-badge-el').forEach((el) => el.classList.add('hidden'));
  document.querySelectorAll('.notif-badge-el').forEach((el) => el.classList.add('hidden'));
  showView('auth');
  if (message) toast(message, true);
}

document.getElementById('logout-btn').addEventListener('click', () => {
  performLocalLogout();
});

// ---------- Naviqasiya ----------
document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.view;
    if (view === 'shop' || view === 'discounts') showView(view);
    else requireAuthOr(view);
  });
});

// ---------- Mobil hamburger menyu ----------
(function () {
  const hamburgerBtn = document.getElementById('hamburger-btn');
  const navLinks = document.getElementById('nav-links');
  const navOverlay = document.getElementById('nav-overlay');
  if (!hamburgerBtn || !navLinks || !navOverlay) return;

  function openMenu() {
    document.body.classList.add('nav-open');
    hamburgerBtn.classList.add('active');
    hamburgerBtn.setAttribute('aria-expanded', 'true');
  }
  function closeMenu() {
    document.body.classList.remove('nav-open');
    hamburgerBtn.classList.remove('active');
    hamburgerBtn.setAttribute('aria-expanded', 'false');
  }

  hamburgerBtn.addEventListener('click', () => {
    document.body.classList.contains('nav-open') ? closeMenu() : openMenu();
  });
  navOverlay.addEventListener('click', closeMenu);
  navLinks.querySelectorAll('.nav-btn').forEach((btn) => btn.addEventListener('click', closeMenu));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });
})();

// ---------- Footer naviqasiyası ----------
document.querySelectorAll('.footer-link[data-view]').forEach((link) => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const view = link.dataset.view;
    if (view === 'shop' || view === 'discounts') showView(view);
    else requireAuthOr(view);

    if (link.dataset.focus === 'category') {
      setTimeout(() => {
        const bar = document.getElementById('category-filter');
        if (bar) bar.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 50);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
});

// ---------- Bottom Navigation: "Kateqoriyalar" seçim sahəsinə fokuslanma ----------
const bottomNavCategoriesBtn = document.getElementById('bottom-nav-categories');
if (bottomNavCategoriesBtn) {
  bottomNavCategoriesBtn.addEventListener('click', () => {
    setTimeout(() => {
      const bar = document.getElementById('category-filter');
      if (bar) bar.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
  });
}

const footerYearEl = document.getElementById('footer-year');
if (footerYearEl) footerYearEl.textContent = new Date().getFullYear();

// ---------- Footer sosial şəbəkələri (admin paneldən idarə olunur) ----------
const SOCIAL_PLATFORM_ICONS = {
  instagram: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1"/></svg>',
  facebook: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M15 8h-2a2 2 0 0 0-2 2v10M9 13h4"/><path d="M15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3V3Z"/></svg>',
  whatsapp: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20.5 12a8.5 8.5 0 1 1-3.8-7.1L20.5 4l-.9 4.1c.6 1.2.9 2.5.9 3.9Z"/><path d="M8.5 9.5c.2 2.6 2.4 4.8 5 5"/></svg>',
  tiktok: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 3v10.5a3.5 3.5 0 1 1-3-3.46"/><path d="M14 3c.4 2.2 2 4 5 4"/></svg>',
  telegram: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m21 4-9 17-3-8-8-3 20-6Z"/><path d="M9 13l9-8"/></svg>',
  youtube: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2.5" y="6" width="19" height="12" rx="4"/><path d="m10.5 9.5 5 2.5-5 2.5Z" fill="currentColor" stroke="none"/></svg>',
  twitter: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 4l16 16M20 4 4 20"/></svg>',
  linkedin: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7.5 10.5v6M7.5 7.5v.01M12 16.5v-3.7c0-1.5 1-2.3 2.2-2.3 1.2 0 1.8.8 1.8 2.3v3.7"/></svg>',
  pinterest: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M9.5 18c1-3 1.5-5 1.5-7a2.5 2.5 0 1 1 5 0c0 2-1 4-2.5 4s-1.5-1-1.2-2.2"/></svg>',
  snapchat: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3c2.5 0 4 1.8 4 4.2 0 1.4-.1 2.4 0 3 .1.5 1 1.3 2 1.3 0 1-1 1.5-2 1.8-.3 1.7-.6 2-1 2.2-.6.3-1.3-.2-2-.2s-1.6 1.2-3 1.2-2.3-1.2-3-1.2-1.4.5-2 .2c-.4-.2-.7-.5-1-2.2-1-.3-2-.8-2-1.8 1-.1 1.9-.8 2-1.3.1-.6 0-1.6 0-3C4 4.8 5.5 3 8 3h4Z"/></svg>',
  other: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 14a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/></svg>'
};
const SOCIAL_PLATFORM_LABELS = {
  instagram: 'Instagram', facebook: 'Facebook', whatsapp: 'WhatsApp', tiktok: 'TikTok',
  telegram: 'Telegram', youtube: 'YouTube', twitter: 'X (Twitter)', linkedin: 'LinkedIn',
  pinterest: 'Pinterest', snapchat: 'Snapchat', other: 'Link'
};

async function loadFooterSocialLinks() {
  const wrap = document.getElementById('footer-social');
  if (!wrap) return;
  try {
    const links = await apiFetch('/social-links');
    const sorted = [...links].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.id - b.id);
    if (!sorted.length) { wrap.classList.add('hidden'); return; }
    wrap.classList.remove('hidden');
    wrap.innerHTML = sorted.map((l) => {
      const icon = SOCIAL_PLATFORM_ICONS[l.platform] || SOCIAL_PLATFORM_ICONS.other;
      const label = l.label || SOCIAL_PLATFORM_LABELS[l.platform] || 'Sosial şəbəkə';
      return `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener" class="footer-social-btn" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${icon}</a>`;
    }).join('');
  } catch (err) {
    wrap.classList.add('hidden');
  }
}
loadFooterSocialLinks();

// ---------- Brend Karuseli ----------
let brandsLoaded = false;
async function loadBrands() {
  try {
    const [brands] = await Promise.all([
      apiFetch('/brands'),
      loadBrandMarqueeSpeed()
    ]);
    renderBrandMarquee(brands);
    brandsLoaded = true;
  } catch (err) {
    // Brendlər yüklənməsə belə mağaza görünüşü işləməyə davam etsin
    document.getElementById('brand-marquee').classList.add('hidden');
  }
}

async function loadBrandMarqueeSpeed() {
  try {
    const settings = await apiFetch('/brand-marquee-settings');
    const seconds = Number(settings.speed_seconds) || 30;
    document.getElementById('brand-marquee-track').style.setProperty('--brand-marquee-duration', `${seconds}s`);
  } catch (err) {
    // Sürət ayarı yüklənməsə standart (30s) sürətdə davam edir
  }
}

function renderBrandMarquee(brands) {
  const wrap = document.getElementById('brand-marquee');
  const track = document.getElementById('brand-marquee-track');
  if (!brands || brands.length === 0) {
    wrap.classList.add('hidden');
    track.innerHTML = '';
    return;
  }
  const itemsHtml = brands.map((b) => `
    <div class="brand-logo-item">
      <img src="${b.logo_url}" alt="${escapeHtml(b.name || 'brend')}" loading="lazy" decoding="async" />
    </div>
  `).join('');
  // Fasiləsiz sürüşmə effekti üçün siyahını 2 dəfə təkrarlayırıq
  track.innerHTML = itemsHtml + itemsHtml;
  wrap.classList.remove('hidden');
}

// ---------- Mağaza ----------
async function loadCategories() {
  state.categories = await apiFetch('/categories');
  renderCategoryBar();
}

function renderCategoryBar() {
  const bar = document.getElementById('category-filter');
  if (!bar) return;
  const items = [{ id: '', name: 'Hamısı' }, ...state.categories.map((c) => ({ id: String(c.id), name: c.name }))];
  bar.innerHTML = items.map((c) => `
    <button type="button" class="category-pill${state.selectedCategoryId === c.id ? ' active' : ''}" data-cat-id="${c.id}" role="tab" aria-selected="${state.selectedCategoryId === c.id}">${escapeHtml(c.name)}</button>
  `).join('');
}

function selectCategory(id) {
  if (state.selectedCategoryId === id) return;
  state.selectedCategoryId = id;
  renderCategoryBar();
  const activeBtn = document.querySelector(`#category-filter .category-pill[data-cat-id="${id}"]`);
  if (activeBtn) activeBtn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  const catSelect = document.getElementById('filter-category');
  if (catSelect) catSelect.value = id;
  if (state.allShopProducts.length) applyShopFilters();
  else loadProducts();
}

document.getElementById('category-filter').addEventListener('click', (e) => {
  const btn = e.target.closest('.category-pill');
  if (!btn) return;
  selectCategory(btn.dataset.catId || '');
});

async function loadProducts() {
  if (state.categories.length === 0) await loadCategories();
  const products = await apiFetch('/products');
  state.allShopProducts = products.filter((p) => p.status !== 'archived' && !p.is_hidden);
  cacheProducts(products);
  buildShopFilterOptions();
  applyShopFilters();
}

// ---------- Mağaza: inkişaf etmiş filtr sistemi ----------

// Bir məhsulun bütün şəkillərindəki rəng adlarını unikal siyahı kimi qaytarır
function productColorNames(p) {
  const set = new Set();
  (p.images || []).forEach((img) => {
    (img.colors || []).forEach((c) => {
      const name = (c.name || '').trim();
      if (name) set.add(name);
    });
  });
  return [...set];
}

// "Kateqoriya", "Ölçü vahidi", "Rəng", "Ölçü" seçimlərini hazırkı məhsul massivindən dinamik qurur
function buildShopFilterOptions() {
  const catSelect = document.getElementById('filter-category');
  if (catSelect) {
    const current = catSelect.value || state.selectedCategoryId || '';
    catSelect.innerHTML = '<option value="">Bütün kateqoriyalar</option>' +
      state.categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    catSelect.value = current;
  }

  const unitSelect = document.getElementById('filter-unit');
  if (unitSelect) {
    const current = unitSelect.value;
    const units = [...new Set(state.allShopProducts.map((p) => (p.unit || '').trim()).filter(Boolean))].sort();
    unitSelect.innerHTML = '<option value="">Hamısı</option>' +
      units.map((u) => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join('');
    unitSelect.value = current;
  }

  const colorsWrap = document.getElementById('filter-colors');
  if (colorsWrap) {
    const prevActive = new Set([...colorsWrap.querySelectorAll('.filter-chip.active')].map((el) => el.dataset.value));
    const colorMap = new Map();
    state.allShopProducts.forEach((p) => productColorNames(p).forEach((name) => {
      if (!colorMap.has(name.toLowerCase())) {
        const img = (p.images || []).find((im) => (im.colors || []).some((c) => (c.name || '').trim() === name));
        const colorEntry = img ? (img.colors || []).find((c) => (c.name || '').trim() === name) : null;
        colorMap.set(name.toLowerCase(), { name, code: (colorEntry && colorEntry.code) || '' });
      }
    }));
    const colors = [...colorMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'az'));
    colorsWrap.innerHTML = colors.length
      ? colors.map((c) => `
        <button type="button" class="filter-chip color-swatch-btn${prevActive.has(c.name) ? ' active' : ''}" data-value="${escapeHtml(c.name)}">
          ${c.code ? `<span class="color-swatch" style="background:${escapeHtml(c.code)}"></span>` : ''}<span>${escapeHtml(c.name)}</span>
        </button>`).join('')
      : '<span class="filter-empty-hint">Hazırda rəng məlumatı olan məhsul yoxdur.</span>';
  }

  const sizesWrap = document.getElementById('filter-sizes');
  if (sizesWrap) {
    const prevActive = new Set([...sizesWrap.querySelectorAll('.filter-chip.active')].map((el) => el.dataset.value));
    const sizes = [...new Set(state.allShopProducts.flatMap((p) => p.sizes || []))].filter(Boolean).sort();
    sizesWrap.innerHTML = sizes.length
      ? sizes.map((s) => `<button type="button" class="filter-chip size-btn${prevActive.has(s) ? ' active' : ''}" data-value="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('')
      : '<span class="filter-empty-hint">Hazırda ölçü məlumatı olan məhsul yoxdur.</span>';
  }
}

// Rəng/ölçü çipləri klik ediləndə seçili/seçilməmiş vəziyyəti dəyişdirir (tətbiq "Filtri tətbiq et" düyməsi ilə olur)
['filter-colors', 'filter-sizes'].forEach((id) => {
  const wrap = document.getElementById(id);
  if (!wrap) return;
  wrap.addEventListener('click', (e) => {
    const chip = e.target.closest('.filter-chip');
    if (chip) chip.classList.toggle('active');
  });
});

function defaultShopFilters() {
  return {
    name: '', minPrice: '', maxPrice: '', colors: new Set(), sizes: new Set(),
    unit: '', stock: '', discounted: false, bestseller: false, minRating: 0,
    delivery: '', sort: 'recommended'
  };
}

// Seçilmiş sıralama qaydasına görə məhsul siyahısını sıralayır
function sortShopProducts(list, sort) {
  const arr = [...list];
  switch (sort) {
    case 'newest': return arr.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    case 'oldest': return arr.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
    case 'price_asc': return arr.sort((a, b) => a.price - b.price);
    case 'price_desc': return arr.sort((a, b) => b.price - a.price);
    case 'bestselling': return arr.sort((a, b) => (b.sold_count || 0) - (a.sold_count || 0));
    case 'rating_desc': return arr.sort((a, b) => (b.rating_avg || 0) - (a.rating_avg || 0));
    case 'discount_desc': return arr.sort((a, b) => (b.discount_percent || 0) - (a.discount_percent || 0));
    default: // Tövsiyə olunan: avantajlı + ən çox satılan məhsullar önə çıxır
      return arr.sort((a, b) =>
        (Number(!!b.is_featured) - Number(!!a.is_featured)) ||
        (Number(!!b.is_bestseller) - Number(!!a.is_bestseller)) ||
        (b.id - a.id));
  }
}

// Hazırkı bütün filtrləri (kateqoriya, ad, qiymət, rəng, ölçü, ölçü vahidi, stok,
// endirim, ən çox satılan, reytinq, çatdırılma növü) və sıralamanı `state.allShopProducts`
// üzərinə tətbiq edib mağaza şəbəkəsini yeniləyir.
function applyShopFilters() {
  const f = state.shopFilters;
  let list = state.allShopProducts.slice();

  if (state.selectedCategoryId) list = list.filter((p) => String(p.category_id) === String(state.selectedCategoryId));
  if (f.name) {
    const q = f.name.toLowerCase();
    list = list.filter((p) => p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q));
  }
  if (f.minPrice !== '' && f.minPrice !== null && f.minPrice !== undefined) list = list.filter((p) => p.price >= Number(f.minPrice));
  if (f.maxPrice !== '' && f.maxPrice !== null && f.maxPrice !== undefined) list = list.filter((p) => p.price <= Number(f.maxPrice));
  if (f.colors && f.colors.size) list = list.filter((p) => productColorNames(p).some((c) => f.colors.has(c)));
  if (f.sizes && f.sizes.size) list = list.filter((p) => (p.sizes || []).some((s) => f.sizes.has(s)));
  if (f.unit) list = list.filter((p) => (p.unit || '') === f.unit);
  if (f.stock === 'in_stock') list = list.filter((p) => p.status !== 'out_of_stock');
  if (f.stock === 'out_of_stock') list = list.filter((p) => p.status === 'out_of_stock');
  if (f.discounted) list = list.filter((p) => Number(p.discount_percent) > 0);
  if (f.bestseller) list = list.filter((p) => p.is_bestseller);
  if (f.minRating) list = list.filter((p) => Number(p.rating_avg || 0) >= f.minRating);
  if (f.delivery) list = list.filter((p) => (p.delivery_type || 'standard') === f.delivery);

  state.products = sortShopProducts(list, f.sort);
  renderProducts();
  updateFilterCountBadge();
}

function updateFilterCountBadge() {
  const badge = document.getElementById('filter-count-badge');
  if (!badge) return;
  const f = state.shopFilters;
  let count = 0;
  if (state.selectedCategoryId) count++;
  if (f.name) count++;
  if (f.minPrice !== '') count++;
  if (f.maxPrice !== '') count++;
  if (f.colors && f.colors.size) count++;
  if (f.sizes && f.sizes.size) count++;
  if (f.unit) count++;
  if (f.stock) count++;
  if (f.discounted) count++;
  if (f.bestseller) count++;
  if (f.minRating) count++;
  if (f.delivery) count++;
  if (count > 0) { badge.textContent = String(count); badge.classList.remove('hidden'); }
  else badge.classList.add('hidden');
}

function toggleFilterPanel() {
  const panel = document.getElementById('shop-filter-panel');
  const btn = document.getElementById('filter-toggle-btn');
  if (!panel) return;
  const opening = panel.classList.contains('hidden');
  panel.classList.toggle('hidden');
  if (btn) btn.setAttribute('aria-expanded', String(opening));
  if (opening) {
    const shopView = document.getElementById('view-shop');
    if (shopView && shopView.classList.contains('hidden')) showView('shop');
    const nameField = document.getElementById('filter-name');
    if (nameField) nameField.value = document.getElementById('search-input').value;
    const catSelect = document.getElementById('filter-category');
    if (catSelect) catSelect.value = state.selectedCategoryId || '';
  }
}

function closeFilterPanel() {
  const panel = document.getElementById('shop-filter-panel');
  const btn = document.getElementById('filter-toggle-btn');
  if (panel) panel.classList.add('hidden');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

const filterToggleBtn = document.getElementById('filter-toggle-btn');
if (filterToggleBtn) filterToggleBtn.addEventListener('click', toggleFilterPanel);

const filterApplyBtn = document.getElementById('filter-apply-btn');
if (filterApplyBtn) filterApplyBtn.addEventListener('click', () => {
  const category = document.getElementById('filter-category').value;
  if (category !== state.selectedCategoryId) {
    state.selectedCategoryId = category;
    renderCategoryBar();
  }
  const nameVal = document.getElementById('filter-name').value.trim();
  document.getElementById('search-input').value = nameVal;
  state.shopFilters = {
    name: nameVal,
    minPrice: document.getElementById('filter-price-min').value,
    maxPrice: document.getElementById('filter-price-max').value,
    colors: new Set([...document.querySelectorAll('#filter-colors .filter-chip.active')].map((el) => el.dataset.value)),
    sizes: new Set([...document.querySelectorAll('#filter-sizes .filter-chip.active')].map((el) => el.dataset.value)),
    unit: document.getElementById('filter-unit').value,
    stock: document.getElementById('filter-stock').value,
    discounted: document.getElementById('filter-discounted').checked,
    bestseller: document.getElementById('filter-bestseller').checked,
    minRating: Number(document.getElementById('filter-rating').value) || 0,
    delivery: document.getElementById('filter-delivery').value,
    sort: document.getElementById('filter-sort').value
  };
  applyShopFilters();
  closeFilterPanel();
});

const filterResetBtn = document.getElementById('filter-reset-btn');
if (filterResetBtn) filterResetBtn.addEventListener('click', () => {
  document.getElementById('filter-name').value = '';
  document.getElementById('filter-price-min').value = '';
  document.getElementById('filter-price-max').value = '';
  document.getElementById('filter-unit').value = '';
  document.getElementById('filter-stock').value = '';
  document.getElementById('filter-rating').value = '0';
  document.getElementById('filter-delivery').value = '';
  document.getElementById('filter-sort').value = 'recommended';
  document.getElementById('filter-discounted').checked = false;
  document.getElementById('filter-bestseller').checked = false;
  document.querySelectorAll('#filter-colors .filter-chip.active, #filter-sizes .filter-chip.active')
    .forEach((el) => el.classList.remove('active'));
  document.getElementById('filter-category').value = '';
  document.getElementById('search-input').value = '';
  state.selectedCategoryId = '';
  renderCategoryBar();
  state.shopFilters = defaultShopFilters();
  applyShopFilters();
});

// Fetch edilmiş məhsulları id üzrə keşləyir ki, aktiv filtrdən kənarda olan məhsullar da
// (məs. Endirimli Məhsullar səhifəsindən) səbətə əlavə ediləndə/detalları açılanda tapıla bilsin.
function cacheProducts(list) {
  list.forEach((p) => {
    if (p.status === 'archived' || p.is_hidden) delete state.productCache[p.id];
    else state.productCache[p.id] = p;
  });
}

// ---------- Sevimlilər (Favorites) ----------

// Cari istifadəçinin sevimli məhsul id-lərini serverdən yükləyir (ürək ikonlarının
// düzgün vəziyyətdə (dolu/boş) göstərilməsi üçün). Giriş edilməyibsə boş dəst saxlanılır.
async function loadFavoriteIds() {
  if (!state.token) { state.favoriteIds = new Set(); return; }
  try {
    const ids = await apiFetch('/favorites/ids');
    state.favoriteIds = new Set(ids);
  } catch (err) {
    state.favoriteIds = new Set();
  }
}

function isFavorite(productId) {
  return state.favoriteIds.has(Number(productId));
}

// Sevimli düyməsinin (♡/♥) HTML markup-unu qurur - məhsul kartında və modal-da istifadə olunur.
function buildFavBtnHtml(productId) {
  const active = isFavorite(productId);
  return `<button type="button" class="fav-btn ${active ? 'active' : ''}" data-fav-id="${productId}" title="${active ? 'Sevimlilərdən sil' : 'Sevimlilərə əlavə et'}" onclick="toggleFavorite(event, ${productId})">${active ? '♥' : '♡'}</button>`;
}

// Ürək ikonuna klik edildikdə çağırılır: giriş edilməyibsə əvvəlcə hesaba daxil olmağı
// tələb edir, əks halda məhsulu sevimlilərə əlavə edir/sevimlilərdən silir.
async function toggleFavorite(e, productId) {
  if (e) e.stopPropagation();
  if (!state.token) {
    toast('Sevimlilərə əlavə etmək üçün əvvəlcə hesabınıza daxil olun.', true);
    showView('auth');
    return;
  }
  const id = Number(productId);
  const wasFavorite = isFavorite(id);
  try {
    if (wasFavorite) {
      await apiFetch(`/favorites/${id}`, { method: 'DELETE' });
      state.favoriteIds.delete(id);
      toast('Sevimlilərdən silindi.');
    } else {
      await apiFetch(`/favorites/${id}`, { method: 'POST' });
      state.favoriteIds.add(id);
      toast('Sevimlilərə əlavə edildi.');
    }
  } catch (err) {
    toast(err.message, true);
    return;
  }
  const nowActive = isFavorite(id);
  document.querySelectorAll(`.fav-btn[data-fav-id="${id}"]`).forEach((btn) => {
    btn.classList.toggle('active', nowActive);
    btn.innerHTML = nowActive ? '♥' : '♡';
    btn.title = nowActive ? 'Sevimlilərdən sil' : 'Sevimlilərə əlavə et';
    if (nowActive) {
      btn.classList.remove('fav-pop');
      // Reflow məcburi edir ki, animasiya təkrar klikdə də yenidən işə düşsün
      void btn.offsetWidth;
      btn.classList.add('fav-pop');
      btn.addEventListener('animationend', () => btn.classList.remove('fav-pop'), { once: true });
    }
  });
  const favView = document.getElementById('view-favorites');
  if (favView && !favView.classList.contains('hidden')) loadFavorites();
}

// Sevimlilər səhifəsini serverdən yükləyir və göstərir.
async function loadFavorites() {
  if (!state.token) return;
  try {
    const favs = await apiFetch('/favorites');
    cacheProducts(favs);
    state.favoriteIds = new Set(favs.map((p) => p.id));
    state.favoriteProducts = favs;
    renderFavorites();
  } catch (err) {
    toast(err.message, true);
  }
}

function renderFavorites() {
  const grid = document.getElementById('favorites-grid');
  if (!grid) return;
  if (!state.favoriteProducts || state.favoriteProducts.length === 0) {
    grid.innerHTML = '<div class="empty-state">Hələ sevimlilərə məhsul əlavə etməmisiniz.</div>';
    return;
  }
  grid.innerHTML = state.favoriteProducts.map(buildProductCardHtml).join('');
}

// ---------- Endirim bitmə vaxtı - canlı geri sayım ----------
// Backend `discount_ends_at` (ISO) sahəsini göndərirsə, qiymətin yanında
// "Endirimin bitməsinə: HH:MM:SS" formatında canlı geri sayım göstərir.
// Element `data-product-id` və `data-ends-at` atributları ilə işarələnir ki,
// qlobal `tickDiscountTimers()` funksiyası hər saniyə tapıb yeniləyə bilsin.
function buildDiscountTimerHtml(p) {
  if (!(p.discount_percent > 0) || !p.discount_ends_at) return '';
  return `<div class="discount-timer" data-product-id="${p.id}" data-ends-at="${p.discount_ends_at}">Endirimin bitməsinə: --:--:--</div>`;
}

function formatDiscountRemaining(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const s = String(totalSeconds % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

// Endirimin vaxtı bitdikdə - həmin məhsulu bütün yerli state-dən (kataloq, endirim
// siyahısı, sevimlilər, açıq modal) dərhal "endirimsiz" vəziyyətə keçirir. Backend
// artıq eyni kəsim anına əsasən avtomatik deaktiv etdiyi üçün burada sadəcə UI
// dərhal sinxronlaşdırılır - səhifə yenidən yüklənmədən.
function handleDiscountExpired(productId) {
  const applyExpired = (p) => {
    if (!p || Number(p.id) !== Number(productId)) return;
    p.discount_percent = 0;
    p.final_price = p.price;
    p.discount_ends_at = null;
  };
  applyExpired(state.productCache[productId]);
  (state.products || []).forEach(applyExpired);
  (state.favoriteProducts || []).forEach(applyExpired);

  const wasDiscounted = (state.discountedProducts || []).some((p) => Number(p.id) === Number(productId));
  if (wasDiscounted) {
    state.discountedProducts = state.discountedProducts.filter((p) => Number(p.id) !== Number(productId));
  }

  if (document.getElementById('product-grid')) renderProducts();
  if (wasDiscounted && document.getElementById('discount-grid')) renderDiscountedProducts();
  if (document.getElementById('favorites-grid') && state.favoriteProducts.length) renderFavorites();

  // Açıq məhsul modalı elə həmin məhsuldursa - qiymət sətrini yerində yeniləyir.
  if (state.currentModalProductId === productId) {
    const modalBody = document.getElementById('product-modal-body');
    const p = state.productCache[productId];
    if (modalBody && p) {
      const priceRow = modalBody.querySelector('.product-price-row');
      if (priceRow) {
        priceRow.innerHTML = `<span class="price-final">${p.final_price.toFixed(2)} ₼</span>`;
      }
      const timerEl = modalBody.querySelector('.discount-timer');
      if (timerEl) timerEl.remove();
    }
  }
}

// Hər saniyə çağırılır: səhifədəki bütün `.discount-timer` elementlərini tapıb
// mətnini yeniləyir; vaxtı bitmiş olanlar üçün `handleDiscountExpired` işə düşür.
function tickDiscountTimers() {
  const timers = document.querySelectorAll('.discount-timer[data-ends-at]');
  timers.forEach((el) => {
    const endsAt = new Date(el.dataset.endsAt).getTime();
    if (Number.isNaN(endsAt)) return;
    const remaining = endsAt - Date.now();
    if (remaining <= 0) {
      el.textContent = 'Endirim başa çatdı';
      el.classList.add('discount-timer-ended');
      handleDiscountExpired(Number(el.dataset.productId));
      return;
    }
    el.textContent = `Endirimin bitməsinə: ${formatDiscountRemaining(remaining)}`;
  });
}

function startDiscountTimers() {
  tickDiscountTimers();
  setInterval(tickDiscountTimers, 1000);
}

// Bir məhsul kartının HTML markup-unu qurur. Həm əsas mağaza şəbəkəsində,
// həm də "Endirimli Məhsullar" və "Sevimlilər" səhifələrində istifadə olunur.
function buildProductCardHtml(p) {
  const outOfStock = p.status === 'out_of_stock';
  const cardImages = (p.images && p.images.length)
    ? p.images
    : [{ url: p.image_url || 'https://picsum.photos/seed/' + p.id + '/400/400' }];
  const multiImage = cardImages.length > 1;
  const imgLayersHtml = cardImages.map((img, idx) => `
    <img class="product-img${idx === 0 ? ' active' : ''}" data-idx="${idx}" src="${img.url}" alt="${escapeHtml(p.name)}" loading="lazy" decoding="async" onclick="openProductDetail(${p.id})" />
  `).join('');
  const dotsHtml = multiImage ? `
    <div class="product-img-dots">
      ${cardImages.map((_, idx) => `<span class="product-img-dot${idx === 0 ? ' active' : ''}" onclick="pickCardImage(event, this.closest('.product-img-wrap'), ${idx})"></span>`).join('')}
    </div>` : '';
  return `
    <div class="product-card">
      <div class="product-img-wrap"${multiImage ? ' onmouseenter="startCardImageCycle(this)" onmouseleave="stopCardImageCycle(this)"' : ''}>
        ${imgLayersHtml}
        ${dotsHtml}
      </div>
      ${buildFavBtnHtml(p.id)}
      <button type="button" class="img-share-btn" title="Linki kopyala" onclick="shareProductCardImage(event, ${p.id})">🔗</button>
      <div class="card-badges">
        ${p.discount_percent > 0 ? `<span class="discount-tag">-${p.discount_percent}%</span>` : ''}
        ${p.is_bestseller ? '<span class="bestseller-badge">⭐ Ən Çox Satılan</span>' : ''}
      </div>
      <div class="product-body">
        <p class="product-name" style="cursor:pointer;" onclick="openProductDetail(${p.id})">${p.name}${p.size_label ? ` <span class="product-size-tag">${escapeHtml(p.size_label)}</span>` : ''}</p>
        ${p.review_count > 0 ? `<div class="product-card-rating">${renderStarsHtml(p.rating_avg, false)}<span class="review-summary-text">${p.rating_avg} (${p.review_count})</span></div>` : ''}
        <div class="product-price-row">
          ${p.discount_percent > 0
            ? `<span class="price-final">${p.final_price.toFixed(2)} ₼</span><span class="price-original">${p.price.toFixed(2)} ₼</span>`
            : `<span class="price-final">${p.price.toFixed(2)} ₼</span>`}
        </div>
        ${buildDiscountTimerHtml(p)}
        ${outOfStock
          ? '<span class="stock-out">Stokda yoxdur</span>'
          : `<button class="btn btn-primary btn-sm" onclick="quickAddToCart(${p.id})" style="width:100%">Səbətə at</button>`
        }
      </div>
    </div>`;
}

// ---------- Məhsul kartı - şəkillər arası keçid (hover ilə avtomatik, nöqtələrlə əl ilə) ----------
function setCardImage(wrap, idx) {
  if (!wrap) return;
  const imgs = wrap.querySelectorAll('.product-img');
  const dots = wrap.querySelectorAll('.product-img-dot');
  imgs.forEach((img, i) => img.classList.toggle('active', i === idx));
  dots.forEach((dot, i) => dot.classList.toggle('active', i === idx));
}

function startCardImageCycle(wrap) {
  if (!wrap) return;
  const imgs = wrap.querySelectorAll('.product-img');
  if (imgs.length <= 1) return;
  if (wrap._cycleTimer) clearInterval(wrap._cycleTimer);
  let idx = 0;
  wrap._cycleTimer = setInterval(() => {
    idx = (idx + 1) % imgs.length;
    setCardImage(wrap, idx);
  }, 1200);
}

function stopCardImageCycle(wrap) {
  if (!wrap) return;
  if (wrap._cycleTimer) {
    clearInterval(wrap._cycleTimer);
    wrap._cycleTimer = null;
  }
  setCardImage(wrap, 0);
}

function pickCardImage(event, wrap, idx) {
  event.stopPropagation();
  if (!wrap) return;
  if (wrap._cycleTimer) {
    clearInterval(wrap._cycleTimer);
    wrap._cycleTimer = null;
  }
  setCardImage(wrap, idx);
}

function renderProducts() {
  const grid = document.getElementById('product-grid');
  if (state.products.length === 0) {
    grid.innerHTML = '<div class="empty-state">Məhsul tapılmadı.</div>';
    return;
  }
  grid.innerHTML = state.products.map(buildProductCardHtml).join('');
}

// "Endirimli Məhsullar" səhifəsini yükləyir. Admin panelində hər hansı məhsula endirim
// tətbiq edildikdə (discount_percent > 0) həmin məhsul avtomatik bu siyahıda görünür;
// endirim ləğv ediləndə (0-a düşəndə) və ya məhsul arxivləşəndə isə siyahıdan avtomatik
// çıxır - çünki hər dəfə bu görünüş açılanda siyahı serverdən təzədən sorğulanır.
async function loadDiscountedProducts() {
  if (state.categories.length === 0) await loadCategories();
  const allProducts = await apiFetch('/products');
  cacheProducts(allProducts);
  state.discountedProducts = allProducts.filter(
    (p) => p.status !== 'archived' && !p.is_hidden && Number(p.discount_percent) > 0
  );
  renderDiscountedProducts();
}

function renderDiscountedProducts() {
  const grid = document.getElementById('discount-grid');
  if (!state.discountedProducts || state.discountedProducts.length === 0) {
    grid.innerHTML = '<div class="empty-state">Hazırda endirimli məhsul yoxdur.</div>';
    return;
  }
  grid.innerHTML = state.discountedProducts.map(buildProductCardHtml).join('');
}

// Məhsulun üzərinə/adına klikləyəndə ətraflı məlumat modalını açır
function openProductDetail(productId) {
  const p = state.productCache[productId] || state.products.find((x) => x.id === productId);
  if (!p) return;

  // Şəkillər həm köhnə (tək URL sətri) həm də yeni (obyekt: {url, title, color_name, color_code, description,
  // features, composition, usage, notes}) formatda ola bilər
  const images = ((p.images && p.images.length) ? p.images : (p.image_url ? [p.image_url] : []))
    .map((img) => (typeof img === 'string' ? { url: img, title: '', color_name: '', color_code: '', titles: [], colors: [], description: '', features: '', composition: '', usage: '', notes: '' } : img));
  state.currentProductImages = images;
  state.currentModalProductId = p.id;
  state.selectedProductColorIndex = null; // hər dəfə modal yenidən açılanda rəng seçimi sıfırlanır
  state.selectedProductColorKey = null; // hansı konkret rəng düyməsinin seçildiyini göstərir (eyni şəkildə bir neçə rəng ola bilər)
  state.selectedProductColorName = '';
  state.selectedProductColorCode = '';
  state.selectedProductSize = null; // hər dəfə modal yenidən açılanda ölçü seçimi sıfırlanır - əvvəlki məhsulun seçimi ötürülməsin
  const mainImg = images[0] ? images[0].url : `https://picsum.photos/seed/${p.id}/500/500`;
  const outOfStock = p.status === 'out_of_stock';
  const cat = state.categories.find((c) => c.id === p.category_id);

  // Rəng variantları - admin tərəfindən əlavə edilmiş HƏR bir rəng (eyni şəkildə bir neçə rəng
  // olsa belə) ayrıca kliklənə bilən düymə/dairə kimi göstərilir - heç vaxt bir yerdə birləşdirilmir.
  const colorOptions = buildColorOptions(images);
  const colorSelectorHtml = colorOptions.length > 0 ? `
    <div class="product-color-selector">
      <label class="product-size-label">Rəng seçin:</label>
      <div class="size-options" id="product-color-options">
        ${colorOptions.map((opt) => `
          <button type="button" class="size-btn color-swatch-btn" data-color-key="${opt.imageIndex}-${opt.colorIndex}" title="${escapeHtml(opt.name || '')}" onclick="selectProductColor(${opt.imageIndex}, ${opt.colorIndex}, ${JSON.stringify(opt.name).replace(/"/g, '&quot;')}, ${JSON.stringify(opt.code).replace(/"/g, '&quot;')})">
            ${opt.code ? `<span class="color-swatch" style="background:${escapeHtml(opt.code)}"></span>` : ''}<span>${opt.name ? escapeHtml(opt.name) : `Rəng ${opt.colorIndex + 1}`}</span>
          </button>`).join('')}
      </div>
    </div>` : '';

  const thumbsHtml = images.length > 1 ? `
    <div class="product-modal-thumbs">
      ${images.map((img, idx) => `
        <div class="product-modal-thumb-wrap">
          <img src="${img.url}" class="thumb ${idx === 0 ? 'active' : ''}" onclick="switchProductModalImage(${idx}, this)" alt="" loading="lazy" decoding="async" />
          <button type="button" class="img-share-btn" title="Linki kopyala" onclick="shareProductModalImage(event, ${idx})">🔗</button>
        </div>`).join('')}
    </div>` : '';

  state.currentModalImageIndex = 0;
  document.getElementById('product-modal-body').innerHTML = `
    <div class="product-modal-img-wrap">
      <img id="product-modal-main-img" src="${mainImg}" class="product-modal-main-img" alt="${escapeHtml(p.name)}" style="cursor:pointer;" decoding="async" onclick="openLightbox(state.currentModalImageIndex)" />
      ${buildFavBtnHtml(p.id)}
      <button type="button" class="img-share-btn" title="Linki kopyala" onclick="shareProductModalImage(event, state.currentModalImageIndex)">🔗</button>
    </div>
    <div id="product-modal-image-meta"></div>
    ${thumbsHtml}
    <div class="product-modal-info">
      ${cat ? `<span class="product-modal-cat">${escapeHtml(cat.name)}</span>` : ''}
      ${p.is_bestseller ? '<span class="bestseller-badge bestseller-badge-inline">⭐ Ən Çox Satılan</span>' : ''}
      <h3>${escapeHtml(p.name)}</h3>
      ${p.size_label ? `<span class="product-size-tag">${escapeHtml(p.size_label)}</span>` : ''}
      <div id="product-modal-rating-summary" class="product-modal-rating-summary"></div>
      <p class="product-modal-desc">${escapeHtml(p.description || 'Bu məhsul üçün təsvir əlavə olunmayıb.')}</p>
      <div class="product-price-row">
        ${p.discount_percent > 0
          ? `<span class="price-final">${p.final_price.toFixed(2)} ₼</span><span class="price-original">${p.price.toFixed(2)} ₼</span>`
          : `<span class="price-final">${p.price.toFixed(2)} ₼</span>`}
      </div>
      ${buildDiscountTimerHtml(p)}
      <div class="product-modal-stock">${outOfStock ? 'Stokda yoxdur' : `Stokda: ${p.stock_quantity} ədəd`}</div>
      ${colorSelectorHtml}
      <div id="product-size-section"></div>
      ${outOfStock
        ? '<span class="stock-out">Stokda yoxdur</span>'
        : `<button class="btn btn-primary" style="width:100%" onclick="addToCart(${p.id})">Səbətə at</button>`}
    </div>
    <div id="product-reviews-section" class="reviews-section"></div>
  `;
  renderProductModalImageMeta(0);
  renderProductSizeSection();
  document.getElementById('product-modal-overlay').classList.remove('hidden');
  loadProductReviews(p.id);
}

// ==== Məhsul Rəyləri ====

// 1-5 ulduz reytinqini ★/☆ şəklində göstərir. `interactive` true olduqda hər ulduz
// klikləndikdə `onStarClick(n)` çağırılır (rəy formundakı seçici üçün istifadə olunur).
function renderStarsHtml(rating, interactive) {
  const rounded = Math.round(Number(rating) || 0);
  let html = `<span class="review-stars${interactive ? ' review-stars-input' : ''}">`;
  for (let i = 1; i <= 5; i++) {
    const filled = i <= rounded;
    html += interactive
      ? `<span class="star ${filled ? 'filled' : ''}" onclick="selectReviewStar(${i})">${filled ? '★' : '☆'}</span>`
      : `<span class="star ${filled ? 'filled' : ''}">${filled ? '★' : '☆'}</span>`;
  }
  html += '</span>';
  return html;
}

async function loadProductReviews(productId) {
  const container = document.getElementById('product-reviews-section');
  if (!container) return;
  container.innerHTML = '<p class="reviews-loading">Rəylər yüklənir…</p>';
  try {
    const data = await apiFetch(`/reviews/product/${productId}`);
    state.currentProductReviews = data.reviews;
    state.currentProductId = productId;
    renderReviewsSection(data.reviews, data.summary, productId);
  } catch (err) {
    container.innerHTML = '<p class="reviews-loading">Rəylər yüklənə bilmədi.</p>';
  }
}

function renderReviewsSection(reviews, summary, productId) {
  const summaryEl = document.getElementById('product-modal-rating-summary');
  if (summaryEl) {
    summaryEl.innerHTML = summary.count > 0
      ? `${renderStarsHtml(summary.average, false)} <span class="review-summary-text">${summary.average} · ${summary.count} rəy</span>`
      : '<span class="review-summary-text muted">Hələ rəy yoxdur</span>';
  }

  const myReview = state.user ? reviews.find((r) => r.user_id === state.user.id) : null;
  const container = document.getElementById('product-reviews-section');
  if (!container) return;

  const listHtml = reviews.length
    ? reviews.map((r) => `
      <div class="review-item">
        <div class="review-item-head">
          ${renderStarsHtml(r.rating, false)}
          <span class="review-author">${escapeHtml(r.author_name)}</span>
          <span class="review-date">${new Date(r.created_at).toLocaleDateString('az-AZ')}</span>
        </div>
        <div class="review-title">${escapeHtml(r.title)}</div>
        <p class="review-comment">${escapeHtml(r.comment)}</p>
        ${Array.isArray(r.images) && r.images.length ? `
          <div class="review-images">
            ${r.images.map((img) => `<img class="review-image-thumb" src="${escapeHtml(img.url)}" alt="Rəy şəkli" loading="lazy" decoding="async" onclick="openReviewImageLightbox('${escapeHtml(img.url)}')" />`).join('')}
          </div>` : ''}
        ${r.admin_reply ? `
          <div class="admin-reply-box">
            <div class="admin-reply-head">🛍️ ${escapeHtml(r.admin_reply.admin_name)} cavab verdi</div>
            <p class="admin-reply-text">${escapeHtml(r.admin_reply.message)}</p>
          </div>` : ''}
        ${state.user && r.user_id === state.user.id ? `
          <div class="review-item-actions">
            <button class="btn btn-secondary btn-sm" onclick="editMyReview(${productId})">Redaktə et</button>
            <button class="btn btn-danger btn-sm" onclick="deleteMyReview(${r.id}, ${productId})">Sil</button>
          </div>` : ''}
      </div>`).join('')
    : '<p class="reviews-empty">Bu məhsul üçün hələ rəy yazılmayıb. İlk rəyi siz yazın!</p>';

  container.innerHTML = `
    <h4 class="reviews-heading">Müştəri rəyləri</h4>
    <div id="review-form-wrap"></div>
    <div class="reviews-list">${listHtml}</div>
  `;

  state.reviewFormRating = myReview ? myReview.rating : 0;
  state.reviewFormEditing = false;
  renderReviewFormWrap(productId, myReview);
}

function renderReviewFormWrap(productId, myReview) {
  const wrap = document.getElementById('review-form-wrap');
  if (!wrap) return;

  if (!state.token) {
    wrap.innerHTML = '<p class="reviews-login-hint">Rəy yazmaq üçün <a href="#" onclick="closeProductModal(); showView(\'auth\'); return false;">daxil olun</a>.</p>';
    return;
  }
  if (state.user && state.user.role !== 'customer') {
    wrap.innerHTML = '';
    return;
  }
  if (myReview && !state.reviewFormEditing) {
    wrap.innerHTML = '<p class="reviews-login-hint">Bu məhsula rəyiniz var. Yuxarıda "Redaktə et" düyməsi ilə dəyişə bilərsiniz.</p>';
    return;
  }

  const existingImages = myReview && Array.isArray(myReview.images) ? myReview.images : [];

  wrap.innerHTML = `
    <div class="review-form">
      <p class="section-title">${myReview ? 'Rəyinizi redaktə edin' : 'Rəy yazın'}</p>
      <div id="review-form-stars">${renderStarsHtml(state.reviewFormRating, true)}</div>
      <input id="review-form-title" type="text" maxlength="100" placeholder="Başlıq" value="${myReview ? escapeHtml(myReview.title) : ''}" />
      <textarea id="review-form-comment" maxlength="2000" rows="3" placeholder="Rəyinizi yazın…">${myReview ? escapeHtml(myReview.comment) : ''}</textarea>
      <div class="review-form-images-field">
        <label class="review-form-images-label" for="review-form-images">Şəkil əlavə et (ən çox 3, hər biri max 5MB)</label>
        <input id="review-form-images" type="file" accept="image/jpeg,image/png,image/webp" multiple onchange="previewReviewFormImages()" />
        <div id="review-form-images-preview" class="review-form-images-preview"></div>
        ${existingImages.length ? `
          <div class="review-form-existing-images">
            <div class="review-images">${existingImages.map((img) => `<img class="review-image-thumb" src="${escapeHtml(img.url)}" alt="Mövcud şəkil" loading="lazy" decoding="async" />`).join('')}</div>
            <label class="review-form-remove-images-label">
              <input id="review-form-remove-images" type="checkbox" /> Yeni şəkil seçilməzsə, mövcud şəkilləri sil
            </label>
          </div>` : ''}
      </div>
      <div class="review-form-error" id="review-form-error"></div>
      <div class="review-form-actions">
        <button class="btn btn-primary btn-sm" onclick="submitProductReview(${productId}, ${myReview ? myReview.id : 'null'})">${myReview ? 'Yenilə' : 'Göndər'}</button>
        ${myReview ? '<button class="btn btn-secondary btn-sm" onclick="cancelEditReview()">Ləğv et</button>' : ''}
      </div>
    </div>`;
}

// Seçilmiş şəkil fayllarının kiçik önizləməsini göstərir (max 3 fayl icazəlidir).
const REVIEW_IMAGE_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function previewReviewFormImages() {
  const input = document.getElementById('review-form-images');
  const preview = document.getElementById('review-form-images-preview');
  if (!input || !preview) return;

  let files = Array.from(input.files || []);

  const invalidCount = files.filter((f) => !REVIEW_IMAGE_ALLOWED_TYPES.includes(f.type)).length;
  files = files.filter((f) => REVIEW_IMAGE_ALLOWED_TYPES.includes(f.type));
  if (invalidCount > 0) {
    toast('Yalnız JPG, JPEG, PNG və WEBP formatlı şəkillərə icazə verilir.', true);
  }

  if (files.length > 3) {
    toast('Ən çox 3 şəkil seçə bilərsiniz. Yalnız ilk 3-ü götürüləcək.', true);
    files = files.slice(0, 3);
  }

  // Faylları düzgün siyahı ilə əvəz edirik ki, submit zamanı (invalid/artıq)
  // fayllar backend-ə göndərilməsin — input.files birbaşa dəyişdirilə bilmədiyi
  // üçün DataTransfer vasitəsilə yeni FileList qururuq.
  const dt = new DataTransfer();
  files.forEach((f) => dt.items.add(f));
  input.files = dt.files;

  preview.innerHTML = '';
  files.forEach((file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = document.createElement('img');
      img.className = 'review-image-thumb';
      img.src = e.target.result;
      img.alt = file.name;
      preview.appendChild(img);
    };
    reader.readAsDataURL(file);
  });
}

// Rəy şəklinə klikləndikdə tam ölçüdə yeni tabda açır.
function openReviewImageLightbox(url) {
  window.open(url, '_blank', 'noopener');
}

function selectReviewStar(n) {
  state.reviewFormRating = n;
  const el = document.getElementById('review-form-stars');
  if (el) el.innerHTML = renderStarsHtml(n, true);
}

function editMyReview(productId) {
  state.reviewFormEditing = true;
  const myReview = (state.currentProductReviews || []).find((r) => state.user && r.user_id === state.user.id);
  state.reviewFormRating = myReview ? myReview.rating : 0;
  renderReviewFormWrap(productId, myReview);
  document.getElementById('review-form-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function cancelEditReview() {
  state.reviewFormEditing = false;
  const myReview = state.user ? (state.currentProductReviews || []).find((r) => r.user_id === state.user.id) : null;
  renderReviewFormWrap(state.currentProductId, myReview);
}

async function submitProductReview(productId, reviewId) {
  const errEl = document.getElementById('review-form-error');
  if (errEl) errEl.textContent = '';
  const rating = state.reviewFormRating || 0;
  const title = document.getElementById('review-form-title').value.trim();
  const comment = document.getElementById('review-form-comment').value.trim();
  const fileInput = document.getElementById('review-form-images');
  const files = fileInput && fileInput.files ? Array.from(fileInput.files).slice(0, 3) : [];
  const removeImages = document.getElementById('review-form-remove-images')?.checked;

  if (!rating) { if (errEl) errEl.textContent = 'Zəhmət olmasa ulduz qiymətləndirməsi seçin.'; return; }
  if (!title || !comment) { if (errEl) errEl.textContent = 'Başlıq və şərh tələb olunur.'; return; }

  // Rəy şəkilləri Cloudinary-yə birbaşa backend vasitəsilə (multer +
  // multer-storage-cloudinary) yüklənir, ona görə həmişə FormData göndəririk —
  // şəkil seçilməsə də sahələr adi mətn kimi backend-də düzgün oxunur.
  const formData = new FormData();
  formData.append('rating', rating);
  formData.append('title', title);
  formData.append('comment', comment);
  files.forEach((file) => formData.append('images', file));
  if (removeImages) formData.append('remove_images', 'true');

  try {
    if (reviewId) {
      await apiUpload(`/reviews/${reviewId}`, 'PUT', formData);
      toast('Rəyiniz yeniləndi.');
    } else {
      await apiUpload(`/reviews/product/${productId}`, 'POST', formData);
      toast('Rəyiniz əlavə edildi.');
    }
    state.reviewFormEditing = false;
    loadProductReviews(productId);
  } catch (err) {
    if (errEl) errEl.textContent = err.message;
  }
}

async function deleteMyReview(reviewId, productId) {
  if (!confirm('Rəyinizi silmək istədiyinizə əminsiniz?')) return;
  try {
    await apiFetch(`/reviews/${reviewId}`, { method: 'DELETE' });
    toast('Rəyiniz silindi.');
    loadProductReviews(productId);
  } catch (err) {
    toast(err.message, true);
  }
}


// Seçilmiş şəklin admin tərəfindən daxil edilmiş Başlıq/Rəng/Qısa təsvir/Xüsusiyyətlər/Tərkib/
// İstifadə qaydası/Qeydlər məlumatını göstərir. Şəkil dəyişdikdə (switchProductModalImage vasitəsilə)
// bu funksiya yenidən çağırılır və bütün sahələr avtomatik yenilənir.
function renderProductModalImageMeta(idx) {
  const el = document.getElementById('product-modal-image-meta');
  if (!el) return;
  const img = (state.currentProductImages || [])[idx];
  const titles = (img && img.titles && img.titles.length) ? img.titles : (img && img.title ? [img.title] : []);
  const colors = (img && img.colors && img.colors.length) ? img.colors : (img && (img.color_name || img.color_code) ? [{ name: img.color_name, code: img.color_code }] : []);
  const hasAny = img && (titles.length || colors.length || img.description || img.features || img.composition || img.usage || img.notes);
  if (!hasAny) { el.innerHTML = ''; return; }

  const section = (label, value) => (value
    ? `<div class="product-image-meta-section">
         <div class="product-image-meta-label">${escapeHtml(label)}</div>
         <p class="product-image-meta-text">${escapeHtml(value)}</p>
       </div>`
    : '');

  el.innerHTML = `
    <div class="product-image-meta">
      ${titles.map((t) => `<div class="product-image-meta-title">${escapeHtml(t)}</div>`).join('')}
      ${colors.length ? `
        <div class="product-image-meta-colors">
          ${colors.map((c) => `
            <span class="product-image-meta-color">
              ${c.code ? `<span class="color-swatch" style="background:${escapeHtml(c.code)}"></span>` : ''}
              ${c.name ? `<span>${escapeHtml(c.name)}</span>` : ''}
            </span>`).join('')}
        </div>` : ''}
      ${img.description ? `<p class="product-image-meta-desc">${escapeHtml(img.description)}</p>` : ''}
      ${section('Xüsusiyyətlər', img.features)}
      ${section('Tərkib', img.composition)}
      ${section('İstifadə qaydası', img.usage)}
      ${section('Qeydlər', img.notes)}
    </div>`;
}

function switchProductModalImage(idx, el) {
  const img = (state.currentProductImages || [])[idx];
  if (!img) return;
  state.currentModalImageIndex = idx;
  const mainImgEl = document.getElementById('product-modal-main-img');
  mainImgEl.src = img.url;
  mainImgEl.setAttribute('onclick', `openLightbox(${idx})`);
  const shareBtn = document.querySelector('.product-modal-img-wrap .img-share-btn');
  if (shareBtn) shareBtn.setAttribute('onclick', `shareProductModalImage(event, ${idx})`);
  document.querySelectorAll('.product-modal-thumbs .thumb').forEach((t) => t.classList.remove('active'));
  el.classList.add('active');
  renderProductModalImageMeta(idx);
  // Əgər klikləndiyi şəkilə YALNIZ bir rəng təyin edilibsə, bu birmənalı şəkildə həmin rəngin
  // seçimi kimi qəbul olunur. Şəkilə bir neçə rəng təyin edilibsə (məs. "Qırmızı, Ağ, Yaşıl" eyni
  // fotoda), hansının seçildiyi birmənalı deyil - müştəri aşağıdakı rəng düymələrindən birini
  // özü açıq şəkildə seçməlidir.
  const colors = (img.colors && img.colors.length) ? img.colors : ((img.color_name || img.color_code) ? [{ name: img.color_name || '', code: img.color_code || '' }] : []);
  if (colors.length === 1) {
    selectProductColor(idx, 0, colors[0].name || '', colors[0].code || '');
    return;
  }
  // Bura çatdıqsa, bu şəkil üçün rəng ya heç yoxdur, ya da bir neçədir (birmənalı avtomatik seçim
  // yoxdur). Əvvəlki şəkildə seçilmiş rəng/ölçü artıq indi göstərilən şəklə aid olmaya bilər (hər
  // şəkil öz siyahısını müstəqil saxlayır) - ona görə köhnə seçimi sıfırlayıb, rəng düymələrini və
  // ölçü bölməsini bu şəklin öz məlumatları ilə YENİDƏN render edirik.
  if (state.selectedProductColorIndex !== idx) {
    state.selectedProductColorIndex = null;
    state.selectedProductColorKey = null;
    state.selectedProductColorName = '';
    state.selectedProductColorCode = '';
  }
  state.selectedProductSize = null;
  renderProductColorSwatches();
  renderProductSizeSection();
}

// Müştəri məhsul modalında AYRICA bir rəng düyməsi seçəndə çağırılır (hər rəng - eyni şəkildə
// bir neçə rəng olsa belə - öz ayrıca düyməsinə malikdir). Əsas şəkli dəyişir, konkret seçilmiş
// rəngi (ad+kod) yadda saxlayır və o rəngə aid ölçü seçimlərini yeniləyir.
function selectProductColor(imageIndex, colorIndex, name, code) {
  const img = (state.currentProductImages || [])[imageIndex];
  if (!img) return;
  state.selectedProductColorIndex = imageIndex;
  state.selectedProductColorKey = `${imageIndex}-${colorIndex}`;
  state.selectedProductColorName = name || '';
  state.selectedProductColorCode = code || '';
  state.selectedProductSize = null;
  state.currentModalImageIndex = imageIndex;
  const mainImgEl = document.getElementById('product-modal-main-img');
  if (mainImgEl) {
    mainImgEl.src = img.url;
    mainImgEl.setAttribute('onclick', `openLightbox(${imageIndex})`);
  }
  const shareBtn = document.querySelector('.product-modal-img-wrap .img-share-btn');
  if (shareBtn) shareBtn.setAttribute('onclick', `shareProductModalImage(event, ${imageIndex})`);
  document.querySelectorAll('.product-modal-thumbs .thumb').forEach((t, tIdx) => t.classList.toggle('active', tIdx === imageIndex));
  renderProductModalImageMeta(imageIndex);
  renderProductColorSwatches();
  renderProductSizeSection();
}

function renderProductColorSwatches() {
  document.querySelectorAll('#product-color-options .color-swatch-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.colorKey === state.selectedProductColorKey);
  });
}

// Cari seçimə (rəng varsa - seçilmiş rəngin şəkli; yoxdursa - hazırda EKRANDA göstərilən şəkil)
// uyğun ölçü siyahısını müəyyən edir. Rəng variantları mövcuddursa amma hələ seçilməyibsə, null
// qaytarır (ölçü seçimi rəng seçilməmiş göstərilməməlidir).
// Ölçü siyahısını `{ size, quantity }` obyektlərinə normallaşdırır. `quantity` admin
// panelində həmin ölçü üçün ayrıca təyin edilmiş stok sayıdır - null olduqda (köhnə
// məhsulun ümumi `sizes` sahəsindən gəldikdə) stok sayı izlənmir və ölçü həmişə seçilə bilər.
function normalizeSizeList(list, trackQuantity) {
  if (!Array.isArray(list)) return [];
  return list.map((s) => (
    typeof s === 'string'
      ? { size: s, quantity: null }
      : { size: s.size || '', quantity: trackQuantity && typeof s.quantity === 'number' ? s.quantity : null }
  )).filter((s) => s.size);
}

function currentSizesForModal(product, images) {
  const hasColorOptions = buildColorOptions(images).length > 0;
  if (hasColorOptions) {
    const key = state.selectedProductColorKey;
    const idx = state.selectedProductColorIndex;
    if (!key || idx === null || idx === undefined || !images[idx]) return null;
    const img = images[idx];
    return (Array.isArray(img.sizes) && img.sizes.length)
      ? normalizeSizeList(img.sizes, true)
      : normalizeSizeList(product.sizes, false);
  }
  // Rəng variantı yoxdur - ölçülər hazırda müştərinin baxdığı KONKRET şəklə aiddir (hər şəkil
  // öz siyahısını müstəqil saxlayır), sadəcə ilk şəklə deyil.
  const activeIdx = Number.isInteger(state.currentModalImageIndex) ? state.currentModalImageIndex : 0;
  const img = images[activeIdx] || images[0];
  return (img && Array.isArray(img.sizes) && img.sizes.length)
    ? normalizeSizeList(img.sizes, true)
    : normalizeSizeList(product.sizes, false);
}

function renderProductSizeSection() {
  const container = document.getElementById('product-size-section');
  if (!container) return;
  const p = state.productCache[state.currentModalProductId];
  if (!p) { container.innerHTML = ''; return; }
  const images = state.currentProductImages || [];
  const sizes = currentSizesForModal(p, images);
  if (sizes === null) {
    container.innerHTML = '<div class="product-size-hint">Ölçü seçimi üçün əvvəlcə rəng seçin.</div>';
    return;
  }
  if (!sizes.length) { container.innerHTML = ''; return; }
  container.innerHTML = `
    <div class="product-size-selector">
      <label class="product-size-label">Ölçü seçin:</label>
      <div class="size-options" id="product-size-options">
        ${sizes.map((s) => {
          const outOfStock = typeof s.quantity === 'number' && s.quantity <= 0;
          return `<button type="button" class="size-btn ${state.selectedProductSize === s.size ? 'active' : ''} ${outOfStock ? 'size-btn-out' : ''}" ${outOfStock ? 'disabled' : ''} onclick="selectProductSize(${JSON.stringify(s.size).replace(/"/g, '&quot;')}, this)">${escapeHtml(s.size)}${outOfStock ? ' <span class="size-out-label">(Bitib)</span>' : ''}</button>`;
        }).join('')}
      </div>
    </div>`;
}

// Müştəri məhsul modalında bir ölçü seçəndə çağırılır - seçim səbətə əlavə edilənə qədər yadda saxlanılır
function selectProductSize(size, el) {
  state.selectedProductSize = size;
  const wrap = document.getElementById('product-size-options');
  if (wrap) wrap.querySelectorAll('.size-btn').forEach((b) => b.classList.remove('active'));
  if (el) el.classList.add('active');
}

function closeProductModal() {
  document.getElementById('product-modal-overlay').classList.add('hidden');
}

// ==== Şəkil linkini paylaşma (kopyalama) ====
async function copyImageLink(url) {
  if (!url) return;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(url);
      toast('Şəkil linki kopyalandı!');
      return;
    }
    throw new Error('clipboard-api-unavailable');
  } catch (err) {
    try {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      toast('Şəkil linki kopyalandı!');
    } catch (err2) {
      if (navigator.share) {
        try {
          await navigator.share({ url });
          return;
        } catch (err3) { /* istifadəçi paylaşımı ləğv edib və ya dəstəklənmir */ }
      }
      toast('Linki kopyalamaq mümkün olmadı.', true);
    }
  }
}

function shareProductCardImage(e, productId) {
  if (e) e.stopPropagation();
  const p = state.productCache[productId] || state.products.find((x) => x.id === productId);
  if (!p) return;
  const url = p.image_url || `https://picsum.photos/seed/${p.id}/400/400`;
  copyImageLink(url);
}

function shareProductModalImage(e, idx) {
  if (e) e.stopPropagation();
  const img = (state.currentProductImages || [])[idx];
  if (!img) return;
  copyImageLink(img.url);
}

// ==== Lightbox (böyük ölçüdə şəkil baxışı) ====
function openLightbox(idx) {
  const images = state.currentProductImages || [];
  if (!images.length) return;
  state.lightboxImages = images;
  state.lightboxIndex = idx || 0;
  renderLightbox();
  document.getElementById('lightbox-overlay').classList.remove('hidden');
}

function renderLightbox() {
  const images = state.lightboxImages || [];
  const img = images[state.lightboxIndex];
  if (!img) return;
  document.getElementById('lightbox-img').src = img.url;
  document.getElementById('lightbox-counter').textContent = images.length > 1 ? `${state.lightboxIndex + 1} / ${images.length}` : '';
  const navDisplay = images.length > 1 ? 'flex' : 'none';
  document.querySelectorAll('.lightbox-nav').forEach((b) => { b.style.display = navDisplay; });
}

function lightboxNav(e, dir) {
  if (e) e.stopPropagation();
  const images = state.lightboxImages || [];
  if (!images.length) return;
  state.lightboxIndex = (state.lightboxIndex + dir + images.length) % images.length;
  renderLightbox();
}

function shareLightboxImage(e) {
  if (e) e.stopPropagation();
  const images = state.lightboxImages || [];
  const img = images[state.lightboxIndex];
  if (img) copyImageLink(img.url);
}

function closeLightbox() {
  document.getElementById('lightbox-overlay').classList.add('hidden');
}

function handleLightboxOverlayClick(e) {
  if (e.target && e.target.id === 'lightbox-overlay') closeLightbox();
}

document.addEventListener('keydown', (e) => {
  const overlay = document.getElementById('lightbox-overlay');
  if (!overlay || overlay.classList.contains('hidden')) return;
  if (e.key === 'Escape') closeLightbox();
  else if (e.key === 'ArrowLeft') lightboxNav(null, -1);
  else if (e.key === 'ArrowRight') lightboxNav(null, 1);
});

document.getElementById('search-input').addEventListener('input', debounce(() => {
  const value = document.getElementById('search-input').value;
  state.shopFilters.name = value;
  const nameField = document.getElementById('filter-name');
  if (nameField) nameField.value = value;
  const shopView = document.getElementById('view-shop');
  if (shopView && shopView.classList.contains('hidden')) showView('shop');
  else if (state.allShopProducts.length) applyShopFilters();
  else loadProducts();
}, 300));

function debounce(fn, delay) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

// ---------- Səs bildirişləri (səbətə əlavə, yeni bildiriş, yeni dəstək mesajı) ----------
// Ayarlar admin panelindən idarə olunur: aktiv/deaktiv, səviyyə və səs faylı.
// Eyni ayar/səs 3 yerdə istifadə olunur: addToCart(), pollNotifUnread() və pollChatUnread().
async function loadSoundSettings() {
  try {
    const settings = await apiFetch('/sound-settings');
    state.soundSettings = settings;
  } catch (err) {
    // Ayarlar yüklənməsə belə standart səs sazlaması ilə davam edilir.
  }
}

function playAlertSound() {
  const s = state.soundSettings;
  if (!s || s.enabled === false || !s.sound_url) return;
  try {
    const audio = new Audio(s.sound_url);
    audio.volume = Math.min(Math.max(Number(s.volume ?? 70) / 100, 0), 1);
    audio.play().catch(() => {}); // brauzer avtoplay qadağası kimi hallarda səssiz uğursuz olur
  } catch (err) {
    /* səs oxudula bilmədi - müştəri təcrübəsini pozmasın deyə xəta göstərilmir */
  }
}

// ---------- Səbət ----------

// Verilmiş məhsulun neçə fərqli variantı (rəng/şəkil, ölçü) olduğunu müəyyən edir.
function productHasVariants(product) {
  const images = (product.images && product.images.length)
    ? product.images
    : (product.image_url ? [{ url: product.image_url }] : []);
  const hasColors = images.some(imageHasColor);
  const hasSizes = images.some((img) => Array.isArray(img.sizes) && img.sizes.length > 0) ||
    (Array.isArray(product.sizes) && product.sizes.length > 0);
  return hasColors || hasSizes || images.length > 1;
}

// Kart üzərindəki "Səbətə at" düyməsi üçün: məhsulun seçilə bilən rəng/şəkil və ya ölçü
// variantı varsa, standart variantı səssizcə səbətə əlavə etmək əvəzinə məhsul detalını
// açır ki, müştəri özü seçsin (heç bir standart seçim avtomatik istifadə olunmasın).
function quickAddToCart(productId) {
  const product = state.productCache[productId] || state.products.find((x) => x.id === productId);
  if (!product) return;
  if (productHasVariants(product)) {
    openProductDetail(productId);
    return;
  }
  addToCart(productId);
}

// Səbətə əlavə et. Əgər məhsul modalı açıqdırsa (istifadəçi rəng/şəkil və ölçü seçibsə),
// məhz həmin seçimlər istifadə olunur. Heç bir mərhələdə standart (ilk) şəkil/rəng/ölçü
// avtomatik seçilib istifadə olunmur - variant tələb olunursa və seçilməyibsə, xəbərdarlıq
// edilib seçim üçün modal açılır.
function addToCart(productId) {
  if (!state.token) { toast('Zəhmət olmasa əvvəlcə daxil olun.', true); showView('auth'); return; }
  const product = state.productCache[productId] || state.products.find((x) => x.id === productId);
  if (!product) return;

  const images = (product.images && product.images.length)
    ? product.images
    : (product.image_url ? [{ url: product.image_url, color_name: '', color_code: '' }] : []);
  const colorOptions = buildColorOptions(images);
  const modalActive = state.currentModalProductId === productId;

  let imageIndex = 0;
  let colorName = '';
  let colorCode = '';

  if (colorOptions.length > 0) {
    // Rəng variantları var - müştəri modal daxilində açıq şəkildə AYRICA bir rəng düyməsi
    // seçməli idi. Heç bir standart (ilk) rəng avtomatik seçilib istifadə olunmur.
    if (!modalActive || !state.selectedProductColorKey) {
      toast('Zəhmət olmasa əvvəlcə rəng seçin.', true);
      openProductDetail(productId);
      return;
    }
    const chosen = colorOptions.find((o) => `${o.imageIndex}-${o.colorIndex}` === state.selectedProductColorKey);
    if (!chosen) {
      toast('Zəhmət olmasa əvvəlcə rəng seçin.', true);
      return;
    }
    imageIndex = chosen.imageIndex;
    colorName = chosen.name;
    colorCode = chosen.code;
  } else if (images.length > 1 && !modalActive) {
    // Rəng variantı yoxdur, amma birdən çox şəkil (sırf qalereya) var - seçim üçün modalı aç
    openProductDetail(productId);
    return;
  } else if (modalActive) {
    imageIndex = Number.isInteger(state.currentModalImageIndex) ? state.currentModalImageIndex : 0;
  }

  const img = images[imageIndex] || images[0] || null;
  const sizes = (img && Array.isArray(img.sizes) && img.sizes.length) ? img.sizes : (Array.isArray(product.sizes) ? product.sizes : []);
  const size = modalActive ? (state.selectedProductSize || null) : null;

  if (sizes.length > 0 && !size) {
    toast('Zəhmət olmasa ölçü seçin.', true);
    if (!modalActive) openProductDetail(productId);
    return;
  }

  const variant = {
    image_index: img ? imageIndex : -1,
    image_url: img ? img.url : '',
    color_name: colorName,
    color_code: colorCode,
    size: size || null
  };
  const variantKey = JSON.stringify(variant);

  // Yalnız məhsul ID-si VƏ bütün variant seçimləri (rəng, ölçü, şəkil) tamamilə eyni olan
  // sətir varsa miqdarı artırırıq; əks halda ayrıca sətir kimi əlavə edilir.
  const existing = state.cart.find((i) => i.product_id === productId && i.variant_key === variantKey);
  if (existing) existing.quantity += 1;
  else state.cart.push({ product_id: productId, quantity: 1, variant, variant_key: variantKey });
  saveCart();
  playAlertSound();
  toast('Məhsul səbətə əlavə edildi.');
  if (modalActive) closeProductModal();
}

function changeQty(idx, delta) {
  const item = state.cart[idx];
  if (!item) return;
  item.quantity += delta;
  if (item.quantity <= 0) state.cart.splice(idx, 1);
  saveCart();
  renderCart();
}

function renderCart() {
  const container = document.getElementById('cart-items');
  const summary = document.getElementById('cart-summary');

  // Artıq mövcud olmayan (silinmiş / bazası sıfırlanmış) məhsullara aid səbət
  // sətirlərini burda təmizləyirik - əks halda onlar UI-da görünmür, amma
  // sifariş göndəriləndə backend-ə yenə göndərilib "Məhsul tapılmadı" xətası verir.
  const validCart = state.cart.filter((item) => Boolean(state.productCache[item.product_id]));
  if (validCart.length !== state.cart.length) {
    state.cart = validCart;
    saveCart();
  }

  if (state.cart.length === 0) {
    container.innerHTML = '<div class="empty-state">Səbətiniz boşdur.</div>';
    summary.innerHTML = '';
    return;
  }

  let subtotal = 0;
  container.innerHTML = state.cart.map((item, idx) => {
    const product = state.productCache[item.product_id];
    if (!product) return '';
    const lineTotal = product.price * item.quantity;
    subtotal += lineTotal;
    const variant = item.variant || {};
    const lineImg = variant.image_url || product.image_url || '';
    const variantLabel = [
      variant.color_name ? `Rəng: ${variant.color_name}` : '',
      variant.size ? `Ölçü: ${variant.size}` : ''
    ].filter(Boolean).join(' · ');
    return `
      <div class="cart-item">
        <div class="cart-item-info">
          <img src="${lineImg}" alt="${escapeHtml(product.name)}" loading="lazy" decoding="async" />
          <div>
            <p style="margin:0;font-weight:600;font-size:14px;">${escapeHtml(product.name)}</p>
            ${variantLabel ? `<p class="cart-item-variant" style="margin:2px 0 0;color:var(--text-muted);font-size:12px;">${escapeHtml(variantLabel)}</p>` : ''}
            <p style="margin:0;color:var(--text-muted);font-size:13px;">${product.price.toFixed(2)} ₼ / ədəd</p>
          </div>
        </div>
        <div class="qty-controls">
          <button onclick="changeQty(${idx}, -1)">−</button>
          <span>${item.quantity}</span>
          <button onclick="changeQty(${idx}, 1)">+</button>
        </div>
        <div style="font-weight:700;">${lineTotal.toFixed(2)} ₼</div>
      </div>`;
  }).join('');

  summary.innerHTML = `
    <div class="promo-row">
      <input type="text" id="promo-input" placeholder="Promokod (məs. TRENDORA10)" />
      <button class="btn btn-secondary" onclick="applyPromo()">Tətbiq et</button>
    </div>
    <div id="promo-feedback" style="font-size:13px;margin-bottom:10px;"></div>
    <div class="summary-row"><span>Ara cəm</span><span id="subtotal-val">${subtotal.toFixed(2)} ₼</span></div>
    <div class="summary-row total"><span>Yekun</span><span id="total-val">${subtotal.toFixed(2)} ₼</span></div>
    <button class="btn btn-primary" style="width:100%;margin-top:10px;" onclick="checkout()">Sifarişi tamamla</button>
  `;
  window._cartSubtotal = subtotal;
  window._appliedPromo = null;
}

async function applyPromo() {
  const code = document.getElementById('promo-input').value.trim();
  if (!code) return;
  try {
    const res = await apiFetch('/promocodes/validate', { method: 'POST', body: JSON.stringify({ code }) });
    window._appliedPromo = code;
    const discounted = window._cartSubtotal - (window._cartSubtotal * res.discount_percent) / 100;
    document.getElementById('promo-feedback').innerHTML = `<span style="color:var(--success)">✓ ${res.discount_percent}% endirim tətbiq olundu</span>`;
    document.getElementById('total-val').textContent = `${discounted.toFixed(2)} ₼`;
  } catch (err) {
    document.getElementById('promo-feedback').innerHTML = `<span style="color:var(--danger)">${err.message}</span>`;
    window._appliedPromo = null;
  }
}

function checkout() {
  openPaymentModal();
}

// ---------- Çatdırılma ünvanı ----------
function loadSavedAddress() {
  try { return JSON.parse(localStorage.getItem('trendora_last_address') || 'null') || {}; }
  catch { return {}; }
}

function renderAddressFormHtml() {
  const saved = loadSavedAddress();
  const field = (f, extraAttrs = '') => `
    <div>
      <label for="addr-${f.id}">${f.label}${f.required ? ' *' : ''}</label>
      <input id="addr-${f.id}" type="text" value="${(saved[f.id] || '').replace(/"/g, '&quot;')}" ${extraAttrs} />
    </div>`;
  const byId = (id) => ADDRESS_FIELDS.find((f) => f.id === id);

  // Poçt indeksi sahəsi: "AZ" prefiksi sabit görünür, istifadəçi yalnız rəqəm daxil edir (məs: AZ1000)
  const savedPostalDigits = String(saved.postal_code || '').toUpperCase().replace(/^AZ/, '').replace(/\D/g, '').slice(0, 4);

  return `
    <div class="section-title-row">
      <p class="section-title">📍 Çatdırılma ünvanı</p>
      <a id="view-map-btn" class="view-map-btn hidden" href="#" target="_blank" rel="noopener noreferrer">🗺️ Xəritədə bax</a>
    </div>
    <div class="address-form">
      <div class="address-form-row">${field(byId('first_name'))}${field(byId('last_name'))}</div>
      <div class="address-form-row">${field(byId('phone'), 'type="tel" placeholder="+994 XX XXX XX XX"')}</div>
      <div class="address-form-row">${field(byId('city'))}${field(byId('district'))}</div>
      <div>${field(byId('street_address'), 'placeholder="Küçə adı, ev/bina, mənzil və s."')}</div>
      <div>
        <label for="addr-postal_code">Poçt indeksi *</label>
        <div class="postal-code-field">
          <span class="postal-code-prefix">AZ</span>
          <input id="addr-postal_code" type="text" inputmode="numeric" maxlength="4" placeholder="1000"
            value="${savedPostalDigits}"
            oninput="this.value=this.value.replace(/\\D/g,'').slice(0,4)" />
        </div>
      </div>
    </div>
    <div class="address-error" id="address-error"></div>
    <hr class="address-divider" />
  `;
}

function getAddressFormValues() {
  const values = {};
  ADDRESS_FIELDS.forEach((f) => {
    if (f.id === 'postal_code') return;
    const el = document.getElementById(`addr-${f.id}`);
    values[f.id] = el ? el.value.trim() : '';
  });
  const postalEl = document.getElementById('addr-postal_code');
  const postalDigits = postalEl ? postalEl.value.replace(/\D/g, '').slice(0, 4) : '';
  values.postal_code = postalDigits ? `AZ${postalDigits}` : '';
  return values;
}

function validateAddressValues(values) {
  const missing = ADDRESS_FIELDS.filter((f) => f.required && !values[f.id]);
  if (missing.length > 0) {
    return `Zəhmət olmasa doldurun: ${missing.map((f) => f.label).join(', ')}.`;
  }
  if (!/^AZ\d{4}$/.test(values.postal_code || '')) {
    return 'Poçt indeksini düzgün daxil edin (məsələn: AZ1000).';
  }
  return null;
}

function formatAddressLine(addr) {
  if (!addr) return '';
  const parts = [addr.street_address, addr.district, addr.city].filter(Boolean);
  return parts.join(', ');
}

// Müştərinin çatdırılma ünvanı üçün Google Maps axtarış linki qurur (koordinat yoxdur,
// ona görə ünvan mətni ilə axtarış edilir).
function orderDeliveryMapsUrl(order) {
  if (!order || !order.delivery_address) return null;
  const line = formatAddressLine(order.delivery_address);
  if (!line) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${line}, Azərbaycan`)}`;
}

// "Xəritədə bax" düyməsi yalnız sifariş "hazırlanır" mərhələsinə çatdıqdan sonra
// (və ləğv edilməyibsə, ödəniş gözlənilmirsə) göstərilir.
function canShowOrderMap(status) {
  if (status === CANCELLED_STATUS || status === PENDING_TRANSFER_STATUS) return false;
  const idx = STATUS_STEPS.indexOf(status);
  const readyIdx = STATUS_STEPS.indexOf('hazırlanır');
  return idx !== -1 && idx >= readyIdx;
}

// ---------- Ödəniş modalı ----------
// Bir checkout "cəhdi" üçün tək dəfə yaradılan unikal açar - istifadəçi
// "Ödənişi Təsdiqlə" düyməsinə bir neçə dəfə klik etsə (və ya sorğu
// şəbəkə problemi üzündən təkrarlansa) belə, HƏMİN sorğular eyni açarla
// gedir ki, backend onları eyni sifariş kimi tanıyıb duplikat yaratmasın.
function generateRequestId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function openPaymentModal() {
  state.checkoutRequestId = generateRequestId();
  const total = document.getElementById('total-val') ? document.getElementById('total-val').textContent : '';
  document.getElementById('payment-modal-body').innerHTML = `
    <p style="font-size:13px;color:var(--text-muted);margin-top:0;">Ödəniləcək məbləğ: <b style="color:var(--text);">${total}</b></p>
    ${renderAddressFormHtml()}
    <div class="pay-method-options">
      <label class="pay-method-card selected" id="opt-kartdan-karta">
        <input type="radio" name="pay-method" value="kartdan_karta" checked />
        <div>
          <div class="pay-method-title">🏦 Kartdan-karta</div>
          <div class="pay-method-desc">Bank kartından köçürmə — admin ödənişi təsdiqlədikdən sonra sifariş hazırlanmağa başlayır</div>
        </div>
      </label>
    </div>

    <div id="transfer-info-wrap"></div>

    <button class="btn btn-primary" id="payment-submit-btn" style="width:100%;margin-top:14px;" onclick="submitOrder()">Ödənişi Təsdiqlə</button>
  `;
  document.getElementById('payment-modal-overlay').classList.remove('hidden');
  loadDeliveryMapButton();
  loadTransferInfo();
}

// Admin tərəfindən idarə olunan təhvilalma ünvanının Google Maps linkini gətirib
// "Xəritədə bax" düyməsinə bağlayır. Link mövcud deyilsə düymə gizli qalır.
async function loadDeliveryMapButton() {
  const btn = document.getElementById('view-map-btn');
  if (!btn) return;
  try {
    const info = await apiFetch('/delivery-settings');
    if (info && info.maps_link) {
      btn.href = info.maps_link;
      btn.classList.remove('hidden');
    } else {
      btn.classList.add('hidden');
    }
  } catch (err) {
    btn.classList.add('hidden');
  }
}

function closePaymentModal() {
  document.getElementById('payment-modal-overlay').classList.add('hidden');
}

// Admin tərəfindən idarə olunan bank köçürmə məlumatlarını gətirir
async function loadTransferInfo() {
  const wrap = document.getElementById('transfer-info-wrap');
  wrap.innerHTML = '<p style="font-size:13px;color:var(--text-muted);">Yüklənir...</p>';
  try {
    const info = await apiFetch('/payment-settings');
    state.paymentSettingsCache = info;
    if (!info || !info.card_number) {
      wrap.innerHTML = '<p style="font-size:13px;color:var(--danger);">Kartdan-karta ödəniş məlumatları hələ əlavə olunmayıb. Zəhmət olmasa digər ödəniş üsulunu seçin.</p>';
      return;
    }
    wrap.innerHTML = `
      <div class="transfer-info-box">
        <p class="section-title">🏦 Bank köçürmə məlumatları</p>
        <div><span>Kart sahibi:</span> <b>${escapeHtml(info.holder_name || '')}</b></div>
        <div><span>Bank:</span> <b>${escapeHtml(info.bank_name || '')}</b></div>
        <div><span>Kart nömrəsi:</span> <b>${escapeHtml(info.card_number || '')}</b></div>
        <div><span>WhatsApp:</span> <b>${escapeHtml(info.whatsapp_number || '')}</b></div>
      </div>
      <p class="secure-note">💡 Məbləği yuxarıdakı kart nömrəsinə köçürün. Sifarişi yerləşdirdikdən sonra ödəniş çekini birbaşa WhatsApp ilə göndərə biləcəksiniz — admin çeki yoxlayıb təsdiqlədikdən sonra sifarişiniz hazırlanmağa başlayacaq.</p>
    `;
  } catch (err) {
    wrap.innerHTML = `<p style="font-size:13px;color:var(--danger);">${escapeHtml(err.message)}</p>`;
  }
}

// WhatsApp loqosu (sadə SVG işarə)
const WHATSAPP_ICON_SVG = `<svg viewBox="0 0 32 32" width="18" height="18" fill="currentColor" aria-hidden="true">
  <path d="M16.02 3C9.4 3 4.02 8.37 4.02 15c0 2.23.61 4.36 1.76 6.24L3 29l7.94-2.72A11.94 11.94 0 0 0 16.02 27C22.65 27 28 21.63 28 15S22.65 3 16.02 3Zm0 21.8a9.7 9.7 0 0 1-4.96-1.36l-.36-.21-4.71 1.61 1.58-4.6-.24-.38A9.72 9.72 0 0 1 6.26 15c0-5.37 4.4-9.77 9.76-9.77 5.37 0 9.77 4.4 9.77 9.77 0 5.37-4.4 9.8-9.77 9.8Zm5.36-7.32c-.29-.15-1.73-.85-2-.95-.27-.1-.46-.15-.66.15-.2.29-.75.95-.92 1.14-.17.2-.34.22-.63.07-.29-.15-1.23-.45-2.34-1.44-.87-.77-1.45-1.72-1.62-2.01-.17-.29-.02-.45.13-.6.13-.13.29-.34.44-.51.15-.17.2-.29.29-.49.1-.2.05-.37-.02-.51-.07-.15-.66-1.59-.9-2.17-.24-.57-.48-.5-.66-.5-.17 0-.37-.02-.56-.02-.2 0-.51.07-.78.37-.27.29-1.02 1-1.02 2.44 0 1.44 1.05 2.83 1.19 3.02.15.2 2.06 3.15 5 4.42.7.3 1.24.48 1.67.61.7.22 1.34.19 1.84.12.56-.08 1.73-.71 1.97-1.39.24-.68.24-1.27.17-1.39-.07-.12-.26-.2-.55-.34Z"/>
</svg>`;

// Sifariş nömrəsi ilə hazır mesaj yaradıb WhatsApp linkini qurur (https://wa.me/...)
function buildWhatsAppReceiptUrl(settings, order) {
  if (!settings || !settings.whatsapp_number) return null;
  const digits = String(settings.whatsapp_number).replace(/\D/g, '');
  if (!digits) return null;
  const orderRef = order.code || `#${order.id}`;
  const amount = Number(order.total_price || 0).toFixed(2);
  const message = `Salam! Sifariş nömrəm: ${orderRef}. Ödəniş məbləği: ${amount} ₼. Ödəniş çekini əlavə edirəm.`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

// Kartdan-karta sifarişləri üçün: kart məlumatları + "Çeki WhatsApp ilə Göndər" düyməsini birlikdə göstərir.
// Müştəri düyməyə basdıqda birbaşa şirkətin WhatsApp nömrəsinə yönləndirilir, söhbət sifariş
// nömrəsi hazır mesaj kimi açılır - müştəriyə yalnız ödəniş çekini əlavə edib göndərmək qalır.
function renderTransferBoxWithWhatsapp(settings, order) {
  const cardHtml = settings && settings.card_number
    ? `
      <div class="transfer-info-box">
        <p class="section-title">🏦 Bank köçürmə məlumatları</p>
        <div><span>Kart sahibi:</span> <b>${escapeHtml(settings.holder_name || '')}</b></div>
        <div><span>Bank:</span> <b>${escapeHtml(settings.bank_name || '')}</b></div>
        <div><span>Kart nömrəsi:</span> <b>${escapeHtml(settings.card_number || '')}</b></div>
      </div>`
    : '';

  const waUrl = buildWhatsAppReceiptUrl(settings, order);
  const waHtml = waUrl
    ? `<a class="whatsapp-send-btn" href="${waUrl}" target="_blank" rel="noopener noreferrer">${WHATSAPP_ICON_SVG}<span>Çeki WhatsApp ilə Göndər</span></a>`
    : `<p style="font-size:12px;color:var(--danger);margin:8px 0 0;">WhatsApp nömrəsi hələ təyin olunmayıb.</p>`;

  return `${cardHtml}${waHtml}`;
}

async function submitOrder() {
  // Sorğu artıq göndərilibsə (əvvəlki klikdən cavab gözlənilir), təkrar
  // klikləri tamamilə görməzdən gəl - bu, 1 kliklə bir neçə eyni sifarişin
  // frontend tərəfindən göndərilməsinin qarşısını alır.
  if (state.orderSubmitInProgress) return;

  const addressValues = getAddressFormValues();
  const addressError = validateAddressValues(addressValues);
  if (addressError) {
    document.getElementById('address-error').textContent = addressError;
    return;
  }
  document.getElementById('address-error').textContent = '';

  const submitBtn = document.getElementById('payment-submit-btn');
  const originalBtnText = submitBtn ? submitBtn.textContent : '';
  state.orderSubmitInProgress = true;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Göndərilir...';
  }

  try {
    // Modal açılanda yaradılan sabit `client_request_id` göndərilir - əgər
    // bu funksiya (retry və ya təsadüfi ikiqat sorğu səbəbindən) eyni
    // sifariş üçün bir daha çağırılsa da, backend eyni açarla artıq
    // yaradılmış sifarişi tanıyıb təkrar yaratmır.
    if (!state.checkoutRequestId) state.checkoutRequestId = generateRequestId();
    const payload = {
      items: state.cart.map((i) => ({ product_id: i.product_id, quantity: i.quantity, variant: i.variant })),
      promo_code: window._appliedPromo || undefined,
      payment_method: 'kartdan_karta',
      delivery_address: addressValues,
      client_request_id: state.checkoutRequestId
    };
    const order = await apiFetch('/orders', { method: 'POST', body: JSON.stringify(payload) });
    localStorage.setItem('trendora_last_address', JSON.stringify(addressValues));
    state.cart = [];
    state.checkoutRequestId = null;
    saveCart();
    closePaymentModal();
    toast(`Sifariş #${order.id} qeydə alındı! Ödəniş çekini "Sifarişlərim" bölməsindəki WhatsApp düyməsi ilə göndərin.`);
    showView('orders');
  } catch (err) {
    toast(err.message, true);
  } finally {
    state.orderSubmitInProgress = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalBtnText;
    }
  }
}

// ---------- Sifarişlər / Tracking ----------
function statusToClass(status) {
  return status.replace(/\s+/g, '-');
}

function paymentMethodLabel(method) {
  return '🏦 Kartdan-karta';
}

async function loadOrders() {
  Object.values(state.pollTimers).forEach(clearInterval);
  state.pollTimers = {};
  Object.values(state.cancelTimers).forEach(clearTimeout);
  state.cancelTimers = {};

  const orders = await apiFetch('/orders');
  state.orders = orders;

  // Kartdan-karta ilə "ödəniş gözlənilir" statusunda sifariş varsa, kart məlumatları
  // və WhatsApp düyməsi üçün admin tərəfindən idarə olunan ayarları gətiririk.
  if (orders.some((o) => o.status === PENDING_TRANSFER_STATUS)) {
    try {
      state.paymentSettingsCache = await apiFetch('/payment-settings');
    } catch (err) {
      state.paymentSettingsCache = null;
    }
  }

  const container = document.getElementById('orders-list');
  if (orders.length === 0) {
    container.innerHTML = '<div class="empty-state">Hələ sifarişiniz yoxdur.</div>';
    return;
  }
  container.innerHTML = orders.map(renderOrderCard).join('');

  orders.forEach((o) => {
    // Hər aktiv sifariş üçün polling başlat (5 saniyədə bir status yoxlanır)
    if (o.status !== FINAL_STATUS && o.status !== CANCELLED_STATUS) {
      state.pollTimers[o.id] = setInterval(() => pollOrderStatus(o.id), 5000);
    }
    // "Sifarişi ləğv et" düyməsi 15 dəqiqəlik müddət bitəndə avtomatik yox olsun
    const remaining = CUSTOMER_CANCEL_WINDOW_MS - (Date.now() - new Date(o.created_at).getTime());
    if (remaining > 0 && o.status !== FINAL_STATUS && o.status !== CANCELLED_STATUS) {
      state.cancelTimers[o.id] = setTimeout(() => {
        const btn = document.getElementById(`cancel-btn-${o.id}`);
        if (btn) btn.remove();
      }, remaining);
    }
  });
}

function renderOrderCard(order) {
  const statusClass = statusToClass(order.status);
  const currentIdx = STATUS_STEPS.indexOf(order.status);
  const isCancelled = order.status === CANCELLED_STATUS;

  const tracker = STATUS_STEPS.map((step, idx) => {
    let cls = '';
    if (idx < currentIdx) cls = 'done';
    else if (idx === currentIdx) cls = 'current';
    return `
      <div class="track-step ${cls}">
        <div class="track-line"></div>
        <div class="track-dot">${idx < currentIdx ? '✓' : idx + 1}</div>
        <div class="track-label">${step}</div>
      </div>`;
  }).join('');

  const isPendingTransfer = order.status === PENDING_TRANSFER_STATUS;

  const trackerOrCancelledHtml = isCancelled
    ? `<div class="cancelled-banner" id="tracker-${order.id}">
        ❌ Sifariş ləğv edilib${order.cancelled_by === 'admin' ? ' (admin tərəfindən)' : ''}.
        ${order.cancellation_reason ? `<br/><b>Səbəb:</b> ${escapeHtml(order.cancellation_reason)}` : ''}
      </div>`
    : isPendingTransfer
    ? `<div class="pending-transfer-banner" id="tracker-${order.id}">
        ⏳ Ödəniş gözlənilir — admin kartdan-karta köçürməni təsdiqlədikdən sonra sifariş hazırlanmağa başlayacaq.
        ${renderTransferBoxWithWhatsapp(state.paymentSettingsCache, order)}
      </div>`
    : `<div class="tracker" id="tracker-${order.id}">${tracker}</div>`;

  const elapsedMs = Date.now() - new Date(order.created_at).getTime();
  const canCustomerCancel = !isCancelled && order.status !== FINAL_STATUS && elapsedMs < CUSTOMER_CANCEL_WINDOW_MS;

  const historyHtml = (order.history || []).map((h) => `
    <div class="history-item"><span class="dot">●</span> <b>${h.status}</b> — ${new Date(h.created_at).toLocaleString('az-AZ')} ${h.note ? `— ${h.note}` : ''}</div>
  `).join('');

  return `
    <div class="order-card" id="order-card-${order.id}">
      <div class="order-head">
        <div>
          <span class="order-id">Sifariş #${order.id}</span>
          ${order.code ? `<span class="order-code" style="color:var(--text-muted);font-size:12px;"> · Kod: ${order.code}</span>` : ''}
          <span class="order-date"> · ${new Date(order.created_at).toLocaleDateString('az-AZ')}</span>
        </div>
        <span class="status-pill status-${statusClass}" id="status-pill-${order.id}">${order.status}</span>
      </div>
      ${trackerOrCancelledHtml}
      <div style="font-size:14px;color:var(--text-muted);">${order.items.map((i) => {
        const variantParts = [i.color_name, i.size].filter(Boolean).join(' · ');
        return `${i.product_name}${variantParts ? ` (${escapeHtml(variantParts)})` : ''} × ${i.quantity}`;
      }).join(', ')}</div>
      <div style="margin-top:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <span style="font-weight:700;">Yekun: ${order.total_price.toFixed(2)} ₼</span>
        <span class="payment-badge ${order.payment_status === 'ödənildi' ? 'paid' : 'pending'}">
          ${paymentMethodLabel(order.payment_method)} · ${order.payment_status}
        </span>
      </div>
      ${order.delivery_address ? `
        <div class="order-address">
          <b>📍 Çatdırılma ünvanı:</b> ${formatAddressLine(order.delivery_address)}
          ${order.delivery_address.postal_code ? ` · Poçt indeksi: ${order.delivery_address.postal_code}` : ''}
          ${(order.delivery_address.first_name || order.delivery_address.last_name) ? `<br/>Alıcı: ${[order.delivery_address.first_name, order.delivery_address.last_name].filter(Boolean).join(' ')}` : ''}
          ${order.delivery_address.phone ? ` · Tel: ${order.delivery_address.phone}` : ''}
          <br/><a id="order-map-btn-${order.id}" class="view-map-btn ${canShowOrderMap(order.status) ? '' : 'hidden'}"
            href="${orderDeliveryMapsUrl(order) || '#'}" target="_blank" rel="noopener noreferrer">🗺️ Xəritədə bax</a>
        </div>` : ''}
      <div class="history-list" id="history-${order.id}">${historyHtml}</div>
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-secondary btn-sm" onclick="printOrderInvoice(${order.id})">🖨️ PDF çap et</button>
        ${canCustomerCancel ? `<button class="btn btn-danger btn-sm" id="cancel-btn-${order.id}" onclick="cancelOrderByCustomer(${order.id})">✖ Sifarişi ləğv et</button>` : ''}
      </div>
    </div>
  `;
}

// Müştəri öz sifarişini ləğv edir (yalnız sifariş verdikdən sonra 15 dəqiqə ərzində mümkündür)
async function cancelOrderByCustomer(orderId) {
  if (!confirm('Bu sifarişi ləğv etmək istədiyinizə əminsiniz?')) return;
  try {
    await apiFetch(`/orders/${orderId}/cancel`, { method: 'PATCH', body: JSON.stringify({}) });
    toast(`Sifariş #${orderId} ləğv edildi.`);
    loadOrders();
  } catch (err) {
    toast(err.message, true);
  }
}

// Sifariş qəbzini yeni pəncərədə açır və çap dialoqunu göstərir (istifadəçi "PDF olaraq saxla" seçə bilər)
function printOrderInvoice(orderId) {
  const order = (state.orders || []).find((o) => o.id === orderId);
  if (!order) { toast('Sifariş tapılmadı.', true); return; }

  const itemsRows = (order.items || []).map((i) => {
    const variantParts = [i.color_name, i.size].filter(Boolean).join(' · ');
    return `
    <tr>
      <td>${i.product_name}${variantParts ? `<br/><span style="color:#666;font-size:11px;">${variantParts}</span>` : ''}</td>
      <td style="text-align:center;">${i.quantity}</td>
      <td style="text-align:right;">${Number(i.price_at_purchase).toFixed(2)} ₼</td>
      <td style="text-align:right;">${(Number(i.price_at_purchase) * i.quantity).toFixed(2)} ₼</td>
    </tr>`;
  }).join('');

  const addr = order.delivery_address ? formatAddressLine(order.delivery_address) : '';

  const win = window.open('', '_blank', 'width=800,height=900');
  if (!win) { toast('Pop-up bloklandı. Zəhmət olmasa bu sayt üçün pop-up-lara icazə verin.', true); return; }

  win.document.write(`
    <!DOCTYPE html>
    <html lang="az">
    <head>
      <meta charset="UTF-8" />
      <title>Sifariş ${order.code || '#' + order.id} — Trendora</title>
      <style>
        body { font-family: Arial, Helvetica, sans-serif; color: #222; padding: 32px; }
        h1 { margin: 0 0 4px; font-size: 22px; }
        .muted { color: #666; font-size: 13px; }
        .head-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; border-bottom: 2px solid #222; padding-bottom: 14px; }
        .box { margin-top: 14px; font-size: 13px; line-height: 1.6; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { border: 1px solid #ddd; padding: 8px 10px; font-size: 13px; }
        th { background: #f4f4f4; text-align: left; }
        .total-row td { font-weight: 700; }
        @media print { body { padding: 0; } }
      </style>
    </head>
    <body>
      <div class="head-row">
        <div>
          <h1>Trendora</h1>
          <div class="muted">Sifariş qəbzi</div>
        </div>
        <div style="text-align:right;">
          <div><b>Sifariş kodu:</b> ${order.code || '—'}</div>
          <div class="muted">ID: #${order.id}</div>
          <div class="muted">${new Date(order.created_at).toLocaleString('az-AZ')}</div>
        </div>
      </div>
      <div class="box">
        <div><b>Status:</b> ${order.status}</div>
        <div><b>Ödəniş:</b> ${paymentMethodLabel(order.payment_method)} · ${order.payment_status}</div>
        ${addr ? `<div><b>Çatdırılma ünvanı:</b> ${addr}</div>` : ''}
      </div>
      <table>
        <thead>
          <tr><th>Məhsul</th><th style="text-align:center;">Say</th><th style="text-align:right;">Qiymət</th><th style="text-align:right;">Cəm</th></tr>
        </thead>
        <tbody>
          ${itemsRows}
          <tr class="total-row"><td colspan="3" style="text-align:right;">Yekun məbləğ:</td><td style="text-align:right;">${order.total_price.toFixed(2)} ₼</td></tr>
        </tbody>
      </table>
    </body>
    </html>
  `);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 300);
}

// Polling: server-dən sifarişin cari statusunu yoxlayır və UI-ı yeniləyir
async function pollOrderStatus(orderId) {
  try {
    const data = await apiFetch(`/orders/${orderId}/status`);
    const pill = document.getElementById(`status-pill-${orderId}`);
    if (!pill) return;

    if (pill.textContent.trim() !== data.status) {
      toast(`Sifariş #${orderId} statusu yeniləndi: ${data.status}`);
      pill.textContent = data.status;
      pill.className = `status-pill status-${statusToClass(data.status)}`;

      const tracker = document.getElementById(`tracker-${orderId}`);
      if (data.status === CANCELLED_STATUS) {
        tracker.className = 'cancelled-banner';
        tracker.innerHTML = `
          ❌ Sifariş ləğv edilib${data.cancelled_by === 'admin' ? ' (admin tərəfindən)' : ''}.
          ${data.cancellation_reason ? `<br/><b>Səbəb:</b> ${escapeHtml(data.cancellation_reason)}` : ''}
        `;
        const cancelBtn = document.getElementById(`cancel-btn-${orderId}`);
        if (cancelBtn) cancelBtn.remove();
        if (state.cancelTimers[orderId]) {
          clearTimeout(state.cancelTimers[orderId]);
          delete state.cancelTimers[orderId];
        }
      } else if (data.status === PENDING_TRANSFER_STATUS) {
        const order = (state.orders || []).find((o) => o.id === orderId) || { id: orderId };
        tracker.className = 'pending-transfer-banner';
        tracker.innerHTML = `⏳ Ödəniş gözlənilir — admin kartdan-karta köçürməni təsdiqlədikdən sonra sifariş hazırlanmağa başlayacaq.
          ${renderTransferBoxWithWhatsapp(state.paymentSettingsCache, order)}`;
      } else {
        const currentIdx = STATUS_STEPS.indexOf(data.status);
        tracker.className = 'tracker';
        tracker.innerHTML = STATUS_STEPS.map((step, idx) => {
          let cls = '';
          if (idx < currentIdx) cls = 'done';
          else if (idx === currentIdx) cls = 'current';
          return `
            <div class="track-step ${cls}">
              <div class="track-line"></div>
              <div class="track-dot">${idx < currentIdx ? '✓' : idx + 1}</div>
              <div class="track-label">${step}</div>
            </div>`;
        }).join('');
      }

      const historyEl = document.getElementById(`history-${orderId}`);
      historyEl.innerHTML = data.history.map((h) => `
        <div class="history-item"><span class="dot">●</span> <b>${h.status}</b> — ${new Date(h.created_at).toLocaleString('az-AZ')} ${h.note ? `— ${h.note}` : ''}</div>
      `).join('');

      // Sifariş "hazırlanır" mərhələsinə çatanda "Xəritədə bax" düyməsini göstər/gizlət
      const mapBtn = document.getElementById(`order-map-btn-${orderId}`);
      if (mapBtn) {
        mapBtn.classList.toggle('hidden', !canShowOrderMap(data.status));
      }

      if ((data.status === FINAL_STATUS || data.status === CANCELLED_STATUS) && state.pollTimers[orderId]) {
        clearInterval(state.pollTimers[orderId]);
        delete state.pollTimers[orderId];
      }
    }
  } catch (err) {
    // sakit uğursuzluq - polling növbəti dövrədə yenidən cəhd edəcək
    console.warn('Polling xətası:', err.message);
  }
}

// ---------- Dəstək söhbəti ----------
function startChatPolling() {
  stopChatPolling();
  state.chatPollTimer = setInterval(loadChatMessages, 3000);
}

function stopChatPolling() {
  if (state.chatPollTimer) {
    clearInterval(state.chatPollTimer);
    state.chatPollTimer = null;
  }
}

function startChatUnreadPolling() {
  stopChatUnreadPolling();
  pollChatUnread();
  state.chatUnreadTimer = setInterval(pollChatUnread, 8000);
}

function stopChatUnreadPolling() {
  if (state.chatUnreadTimer) {
    clearInterval(state.chatUnreadTimer);
    state.chatUnreadTimer = null;
  }
}

async function pollChatUnread() {
  if (!state.token) return;
  try {
    const data = await apiFetch('/chat/unread-count');
    document.querySelectorAll('.chat-badge-el').forEach((badge) => {
      if (data.total > 0) {
        badge.textContent = data.total;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    });
    // Yalnız say əvvəlki bilinən dəyərdən artıbsa səs çal - beləliklə səhifə
    // ilk açılanda mövcud oxunmamış say üçün deyil, YENİ mesaj gələndə səslənir.
    if (state.chatUnreadPrev !== null && data.total > state.chatUnreadPrev) {
      playAlertSound();
    }
    state.chatUnreadPrev = data.total;
  } catch (err) {
    console.warn('Söhbət bildiriş xətası:', err.message);
  }
}

// ---------- Bildirişlər ----------
function startNotifUnreadPolling() {
  stopNotifUnreadPolling();
  pollNotifUnread();
  state.notifUnreadTimer = setInterval(pollNotifUnread, 8000);
}

function stopNotifUnreadPolling() {
  if (state.notifUnreadTimer) {
    clearInterval(state.notifUnreadTimer);
    state.notifUnreadTimer = null;
  }
}

async function pollNotifUnread() {
  if (!state.token) return;
  try {
    const data = await apiFetch('/notifications/unread-count');
    document.querySelectorAll('.notif-badge-el').forEach((badge) => {
      if (data.total > 0) {
        badge.textContent = data.total;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    });
    // Yalnız say əvvəlki bilinən dəyərdən artıbsa səs çal - beləliklə səhifə
    // ilk açılanda mövcud oxunmamış say üçün deyil, YENİ bildiriş gələndə səslənir.
    if (state.notifUnreadPrev !== null && data.total > state.notifUnreadPrev) {
      playAlertSound();
    }
    state.notifUnreadPrev = data.total;
  } catch (err) {
    console.warn('Bildiriş sayı xətası:', err.message);
  }
}

// Profil görünüşü açıq olduğu müddətdə siyahını tez-tez yeniləyir - beləliklə
// admin panelindən edilən redaktə/silmə/aktiv-deaktiv dəyişiklikləri avtomatik görünür.
function startNotifListPolling() {
  stopNotifListPolling();
  state.notifListPollTimer = setInterval(loadNotifications, 5000);
}

function stopNotifListPolling() {
  if (state.notifListPollTimer) {
    clearInterval(state.notifListPollTimer);
    state.notifListPollTimer = null;
  }
}

// Profil bölməsi açılanda çağırılır - bildirişləri yükləyir və avtomatik oxunmuş kimi işarələyir
async function loadNotifications() {
  try {
    const items = await apiFetch('/notifications');
    state.notifications = items;
    renderNotifications(items);

    const hadUnread = items.some((n) => !n.is_read);
    if (hadUnread) {
      await apiFetch('/notifications/read-all', { method: 'PATCH' });
      state.notifications = items.map((n) => ({ ...n, is_read: true }));
    }
    pollNotifUnread();
  } catch (err) {
    console.warn('Bildirişlər yüklənmə xətası:', err.message);
  }
}

function renderNotifications(items) {
  const list = document.getElementById('notifications-list');
  const label = document.getElementById('notifications-unread-label');
  const unreadCount = items.filter((n) => !n.is_read).length;
  label.textContent = unreadCount > 0 ? `${unreadCount} oxunmamış` : '';

  if (items.length === 0) {
    list.innerHTML = '<p class="hint">Hələ bildirişiniz yoxdur.</p>';
    return;
  }

  list.innerHTML = items.map((n) => `
    <div class="notification-item ${n.is_read ? '' : 'unread'}">
      <span class="notification-icon">${NOTIFICATION_ICONS[n.type] || '🔔'}</span>
      <div class="notification-body">
        <div class="notification-title">${escapeHtml(n.title)}</div>
        <div class="notification-message">${escapeHtml(n.message)}</div>
        <div class="notification-time">${new Date(n.created_at).toLocaleString('az-AZ')}</div>
      </div>
    </div>
  `).join('');
}

async function loadChatMessages() {
  try {
    const messages = await apiFetch('/chat/messages');
    renderChatMessages(messages);
    pollChatUnread();
  } catch (err) {
    console.warn('Söhbət yüklənmə xətası:', err.message);
  }
}

function renderChatMessages(messages) {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;

  if (messages.length === 0) {
    container.innerHTML = '<div class="empty-state">Hələ mesaj yoxdur. Sualınızı bura yazın, Trendora dəstək komandası tezliklə cavab verəcək.</div>';
    return;
  }

  container.innerHTML = messages.map((m) => `
    <div class="chat-msg ${m.sender === 'customer' ? 'mine' : 'theirs'}">
      <div class="chat-bubble">${escapeHtml(m.text)}</div>
      <div class="chat-time">${m.sender === 'admin' ? 'Trendora Dəstək · ' : ''}${new Date(m.created_at).toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit' })}</div>
    </div>
  `).join('');

  if (nearBottom) container.scrollTop = container.scrollHeight;
}

document.getElementById('chat-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  try {
    await apiFetch('/chat/messages', { method: 'POST', body: JSON.stringify({ text }) });
    loadChatMessages();
  } catch (err) {
    toast(err.message, true);
    input.value = text;
  }
});

// ---------- Profil ----------
function initialsOf(u) {
  const a = (u.name || '').trim()[0] || '';
  const b = (u.surname || '').trim()[0] || '';
  return (a + b).toUpperCase() || '?';
}

function renderProfile() {
  const u = state.user;

  document.getElementById('profile-info').innerHTML = `
    <div class="profile-avatar-row">
      ${u.avatar_url
        ? `<img id="avatar-preview" class="profile-avatar" src="${u.avatar_url}" alt="Profil şəkli" decoding="async" />`
        : `<div id="avatar-preview-placeholder" class="profile-avatar-placeholder">${initialsOf(u)}</div>`}
      <div class="profile-avatar-actions">
        <label for="avatar-url-input" class="profile-avatar-label">Profil şəkli linki</label>
        <input id="avatar-url-input" type="url" placeholder="https://..." value="${(u.avatar_url || '').replace(/"/g, '&quot;')}" oninput="onAvatarUrlInput(event)" />
        <p class="profile-avatar-hint">Şəklin birbaşa linkini (URL) yapışdırın</p>
      </div>
    </div>

    <div class="profile-form">
      <div>
        <label for="p-name">Ad *</label>
        <input id="p-name" type="text" value="${(u.name || '').replace(/"/g, '&quot;')}" />
      </div>
      <div>
        <label for="p-surname">Soyad</label>
        <input id="p-surname" type="text" value="${(u.surname || '').replace(/"/g, '&quot;')}" />
      </div>
      <div>
        <label for="p-email">Email *</label>
        <input id="p-email" type="email" value="${(u.email || '').replace(/"/g, '&quot;')}" />
      </div>
      <div>
        <label for="p-phone">Telefon</label>
        <input id="p-phone" type="tel" value="${(u.phone || '').replace(/"/g, '&quot;')}" />
      </div>
      <div class="profile-form-row">
        <div>
          <label for="p-birthdate">Doğum tarixi</label>
          <input id="p-birthdate" type="date" value="${u.birth_date || ''}" />
        </div>
        <div>
          <label for="p-gender">Cins</label>
          <select id="p-gender">
            ${GENDER_OPTIONS.map((g) => `<option value="${g.value}" ${u.gender === g.value ? 'selected' : ''}>${g.label}</option>`).join('')}
          </select>
        </div>
      </div>
    </div>
    <div class="address-error" id="profile-error"></div>
    <button class="btn btn-primary" style="width:100%" onclick="saveProfile()">Profili yadda saxla</button>

    <hr class="profile-section-divider" />

    <p class="section-title">🔒 Şifrəni dəyiş</p>
    <div class="profile-form">
      <div>
        <label for="p-current-password">Cari şifrə</label>
        <input id="p-current-password" type="password" />
      </div>
      <div class="profile-form-row">
        <div>
          <label for="p-new-password">Yeni şifrə</label>
          <input id="p-new-password" type="password" />
        </div>
        <div>
          <label for="p-new-password-confirm">Yeni şifrə (təkrar)</label>
          <input id="p-new-password-confirm" type="password" />
        </div>
      </div>
    </div>
    <div class="address-error" id="password-error"></div>
    <button class="btn btn-secondary" style="width:100%" onclick="changePassword()">Şifrəni yenilə</button>

    <hr class="profile-section-divider" />

    <p class="section-title">🔐 Təhlükəsizlik — PIN</p>
    <div class="profile-row">
      <span>Cari PIN</span>
      <span>${u.pin_set ? '****' : 'Təyin olunmayıb'}</span>
    </div>
    <div class="profile-form" style="margin-top:10px;">
      ${u.pin_set ? `
        <div>
          <label for="p-current-pin">Cari PIN</label>
          <input id="p-current-pin" type="password" maxlength="4" inputmode="numeric" placeholder="****" />
        </div>
      ` : ''}
      <div class="profile-form-row">
        <div>
          <label for="p-new-pin">${u.pin_set ? 'Yeni PIN' : 'PIN təyin et'}</label>
          <input id="p-new-pin" type="password" maxlength="4" inputmode="numeric" placeholder="4 rəqəm" />
        </div>
        <div>
          <label for="p-new-pin-confirm">Yeni PIN (təkrar)</label>
          <input id="p-new-pin-confirm" type="password" maxlength="4" inputmode="numeric" placeholder="4 rəqəm" />
        </div>
      </div>
    </div>
    <div class="address-error" id="pin-error"></div>
    <button class="btn btn-secondary" style="width:100%" onclick="submitPin()">${u.pin_set ? 'PIN-i yenilə' : 'PIN təyin et'}</button>
  `;

  enhancePasswordToggles(document.getElementById('profile-info'));
}

function onAvatarUrlInput(event) {
  const url = event.target.value.trim();
  const img = document.getElementById('avatar-preview');
  const placeholder = document.getElementById('avatar-preview-placeholder');
  if (!url) return;
  if (img) {
    img.src = url;
  } else if (placeholder) {
    placeholder.outerHTML = `<img id="avatar-preview" class="profile-avatar" src="${url}" alt="Profil şəkli" decoding="async" />`;
  }
}

async function saveProfile() {
  const errorEl = document.getElementById('profile-error');
  errorEl.textContent = '';

  const name = document.getElementById('p-name').value.trim();
  const email = document.getElementById('p-email').value.trim();
  if (!name || !email) {
    errorEl.textContent = 'Ad və email tələb olunur.';
    return;
  }

  const payload = {
    name,
    surname: document.getElementById('p-surname').value.trim(),
    email,
    phone: document.getElementById('p-phone').value.trim(),
    birth_date: document.getElementById('p-birthdate').value,
    gender: document.getElementById('p-gender').value,
    avatar_url: document.getElementById('avatar-url-input').value.trim()
  };

  try {
    const updated = await apiFetch('/auth/me', { method: 'PUT', body: JSON.stringify(payload) });
    state.user = updated;
    localStorage.setItem('trendora_user', JSON.stringify(updated));
    toast('Profil yadda saxlanıldı.');
    renderProfile();
  } catch (err) {
    errorEl.textContent = err.message;
  }
}

async function changePassword() {
  const errorEl = document.getElementById('password-error');
  errorEl.textContent = '';

  const current_password = document.getElementById('p-current-password').value;
  const new_password = document.getElementById('p-new-password').value;
  const confirm = document.getElementById('p-new-password-confirm').value;

  if (!current_password || !new_password) {
    errorEl.textContent = 'Cari və yeni şifrəni daxil edin.';
    return;
  }
  if (new_password.length < 6) {
    errorEl.textContent = 'Yeni şifrə ən azı 6 simvol olmalıdır.';
    return;
  }
  if (new_password !== confirm) {
    errorEl.textContent = 'Yeni şifrələr uyğun gəlmir.';
    return;
  }

  try {
    await apiFetch('/auth/me/password', { method: 'PATCH', body: JSON.stringify({ current_password, new_password }) });
    toast('Şifrə yeniləndi.');
    document.getElementById('p-current-password').value = '';
    document.getElementById('p-new-password').value = '';
    document.getElementById('p-new-password-confirm').value = '';
  } catch (err) {
    errorEl.textContent = err.message;
  }
}

async function submitPin() {
  const errorEl = document.getElementById('pin-error');
  errorEl.textContent = '';

  const pinSet = Boolean(state.user.pin_set);
  const currentPinInput = document.getElementById('p-current-pin');
  const current_pin = pinSet && currentPinInput ? currentPinInput.value.trim() : undefined;
  const new_pin = document.getElementById('p-new-pin').value.trim();
  const confirm_pin = document.getElementById('p-new-pin-confirm').value.trim();

  if (pinSet && !current_pin) {
    errorEl.textContent = 'Cari PIN-i daxil edin.';
    return;
  }
  if (!/^\d{4}$/.test(new_pin)) {
    errorEl.textContent = 'PIN 4 rəqəmdən ibarət olmalıdır.';
    return;
  }
  if (new_pin !== confirm_pin) {
    errorEl.textContent = 'Yeni PIN-lər uyğun gəlmir.';
    return;
  }

  try {
    const updated = await apiFetch('/auth/me/pin', {
      method: 'PATCH',
      body: JSON.stringify({ current_pin, new_pin, confirm_pin })
    });
    state.user = updated;
    localStorage.setItem('trendora_user', JSON.stringify(updated));
    toast(pinSet ? 'PIN yeniləndi.' : 'PIN təyin edildi.');
    renderProfile();
  } catch (err) {
    errorEl.textContent = err.message;
  }
}

// ---------- Endirim Çarxı ----------
let wheelData = null;

async function checkWheelAvailability() {
  const navBtn = document.getElementById('wheel-nav-btn');
  if (!state.token) { navBtn.classList.add('hidden'); return; }
  try {
    const data = await apiFetch('/wheel/active');
    navBtn.classList.toggle('hidden', !data.campaign);
  } catch (err) {
    navBtn.classList.add('hidden');
  }
}

async function loadWheelView() {
  const container = document.getElementById('wheel-container');
  container.innerHTML = '<div class="empty-state">Yüklənir...</div>';
  try {
    wheelData = await apiFetch('/wheel/active');
  } catch (err) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`;
    return;
  }
  renderWheelView();
}

function renderWheelView() {
  const container = document.getElementById('wheel-container');
  if (!wheelData.campaign) {
    container.innerHTML = '<div class="empty-state">🎡 Hazırda aktiv endirim çarxı kampaniyası yoxdur. Daha sonra yenidən yoxlayın!</div>';
    return;
  }

  if (wheelData.already_spun) {
    const spin = wheelData.my_spin;
    const won = spin.sector.type === 'discount'
      ? `${spin.sector.discount_percent}% endirim`
      : spin.sector.gift_label;
    container.innerHTML = `
      <div class="wheel-result-card">
        <p class="wheel-result-emoji">🎉</p>
        <h3>Siz artıq fırlatmısınız!</h3>
        <p>Qazandığınız: <b>${escapeHtml(won)}</b></p>
        <div class="wheel-code-box">
          <span id="wheel-won-code">${escapeHtml(spin.promo_code.code)}</span>
          <button class="btn btn-secondary btn-sm" onclick="copyWheelCode()">Kopyala</button>
        </div>
        <p class="hint">${spin.promo_code.valid_until ? 'Etibarlıdır: ' + new Date(spin.promo_code.valid_until).toLocaleDateString('az-AZ') + ' tarixinədək' : 'Müddət limiti yoxdur'}</p>
        <p class="hint">Kodu səbətdə "Promokod" xanasına daxil edərək istifadə edə bilərsiniz.</p>
      </div>`;
    return;
  }

  const sectors = wheelData.sectors;
  const n = sectors.length;
  const slice = 360 / n;
  const gradientParts = sectors.map((s, i) => `${s.color} ${i * slice}deg ${(i + 1) * slice}deg`).join(', ');
  const labels = sectors.map((s, i) => {
    const center = i * slice + slice / 2;
    const rawText = s.type === 'discount' ? `${s.discount_percent}%` : (s.gift_label || '');
    const text = rawText.length > 12 ? rawText.slice(0, 10) + '…' : rawText;
    return `<div class="wheel-label" style="transform: rotate(${center}deg) translate(0,-108px) rotate(${-center}deg);">${escapeHtml(text)}</div>`;
  }).join('');

  container.innerHTML = `
    <div class="wheel-wrap">
      <div class="wheel-pointer">▼</div>
      <div class="wheel-disc" id="wheel-disc" style="background: conic-gradient(${gradientParts});">
        ${labels}
      </div>
    </div>
    <button class="btn btn-primary wheel-spin-btn" id="wheel-spin-btn" onclick="spinWheel()">Çarxı Fırlat!</button>
    <p class="hint">Hər istifadəçi yalnız 1 dəfə fırlada bilər.</p>
  `;
}

async function spinWheel() {
  const btn = document.getElementById('wheel-spin-btn');
  if (!btn || btn.disabled) return;
  btn.disabled = true;

  let result;
  try {
    result = await apiFetch('/wheel/spin', { method: 'POST' });
  } catch (err) {
    toast(err.message, true);
    btn.disabled = false;
    return;
  }

  const sectors = wheelData.sectors;
  const n = sectors.length;
  const slice = 360 / n;
  const idx = sectors.findIndex((s) => s.id === result.sector.id);
  const center = idx * slice + slice / 2;
  const jitter = (Math.random() - 0.5) * slice * 0.6;
  const rotation = 360 * 6 + ((360 - (center + jitter)) % 360);

  const disc = document.getElementById('wheel-disc');
  disc.style.transition = 'transform 4.5s cubic-bezier(0.17, 0.67, 0.12, 0.99)';
  disc.style.transform = `rotate(${rotation}deg)`;

  setTimeout(() => {
    wheelData.already_spun = true;
    wheelData.my_spin = { sector: result.sector, promo_code: result.promo_code };
    renderWheelView();
    toast('Təbriklər! Kampaniyanı qazandınız 🎉');
  }, 4700);
}

function copyWheelCode() {
  const el = document.getElementById('wheel-won-code');
  if (!el) return;
  navigator.clipboard.writeText(el.textContent).then(() => toast('Promo kod kopyalandı.')).catch(() => {});
}

// ---------- Footer: Haqqımızda + Əlaqə məlumatları (admin panelindən idarə olunur) ----------
async function loadCompanyInfo() {
  try {
    const info = await apiFetch('/company-info');
    const aboutEl = document.getElementById('footer-about-text');
    if (aboutEl && info.about_text) aboutEl.textContent = info.about_text;

    const emailEl = document.getElementById('footer-email-link');
    if (emailEl && info.contact_email) {
      emailEl.textContent = info.contact_email;
      emailEl.href = `mailto:${info.contact_email}`;
    }

    const phoneEl = document.getElementById('footer-phone-link');
    if (phoneEl && info.contact_phone) {
      phoneEl.textContent = info.contact_phone;
      phoneEl.href = `tel:${info.contact_phone.replace(/[^\d+]/g, '')}`;
    }

    const addressEl = document.getElementById('footer-address-text');
    if (addressEl && info.contact_address) addressEl.textContent = info.contact_address;
  } catch (err) {
    // Yüklənməsə standart (statik) footer mətnləri qalır
  }
}

// ---------- Başlanğıc ----------
enhancePasswordToggles(document);
renderCartBadge();
loadSoundSettings();
loadCompanyInfo();
startDiscountTimers();
if (state.token && state.user) {
  loadFavoriteIds().then(() => showView('shop'));
  startChatUnreadPolling();
  startNotifUnreadPolling();
  checkWheelAvailability();
} else {
  showView('auth');
}
