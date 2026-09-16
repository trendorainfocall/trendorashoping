// ==========================================================
// Trendora - Admin Paneli
// ==========================================================
const API = '/api';
const STATUS_OPTIONS = ['qəbul edildi', 'hazırlanır', 'qablaşdırılır', 'kuryerə verildi', 'yoldadır', 'çatdırıldı'];
const CANCELLED_STATUS = 'ləğv edildi';
// Kartdan-karta seçildikdə admin ödənişi təsdiqləyənə qədər sifarişin qaldığı status
const PENDING_TRANSFER_STATUS = 'ödəniş gözlənilir';
const MAX_PRODUCT_IMAGES = 10;
const PRODUCT_UNITS = ['ml', 'L', 'q', 'kq', 'mq', 'sm', 'm', 'ədəd', 'paket', 'qutu', 'cüt'];
// Admin panelində şəkil üçün seçilə bilən en/hündürlük nisbətləri (backend-dəki
// ALLOWED_ASPECT_RATIOS siyahısı ilə uyğun olmalıdır).
const ASPECT_RATIO_OPTIONS = [
  { value: '1:1', label: 'Kvadrat (1:1)' },
  { value: '4:3', label: 'Albom (4:3)' },
  { value: '3:4', label: 'Portret (3:4)' },
  { value: '16:9', label: 'Enli ekran (16:9)' },
  { value: '9:16', label: 'Dar portret (9:16)' },
  { value: '3:2', label: 'Foto albom (3:2)' },
  { value: '2:3', label: 'Foto portret (2:3)' }
];

// Tam çatdırılma ünvanı forması sahələri (hamısı məcburidir)
const ADDRESS_FIELD_LABELS = {
  first_name: 'Ad', last_name: 'Soyad', phone: 'Telefon nömrəsi',
  city: 'Şəhər', district: 'Rayon', street_address: 'Küçə və ünvan', postal_code: 'Poçt indeksi'
};
const ADDRESS_FIELD_ORDER = ['first_name', 'last_name', 'phone', 'city', 'district', 'street_address', 'postal_code'];

let state = {
  token: localStorage.getItem('trendora_admin_token') || null,
  user: JSON.parse(localStorage.getItem('trendora_admin_user') || 'null'),
  products: [],
  categories: [],
  orders: [],
  ordersSearchTimer: null,
  customers: [],
  promocodes: [],
  chatConversations: [],
  chatActiveUserId: null,
  chatListPollTimer: null,
  chatMsgPollTimer: null,
  chatBadgeTimer: null,
  admins: [],
  adminsSearchTimer: null,
  productImageItems: [],
  warehouse: [],
  warehouseHistoryProductId: null,
  wheelCampaigns: [],
  wheelStats: null,
  brands: [],
  brandLogoItem: null,
  generalSizes: [],
  socialLinks: [],
  adminAvatarItem: null,
  adminNotifications: [],
  notifListPollTimer: null
};

const WHEEL_SECTOR_COLORS = ['#7c3aed', '#f59e0b', '#16a34a', '#dc2626', '#0ea5e9', '#db2777', '#65a30d', '#9333ea'];

const ADMIN_ROLES = ['super_admin', 'admin', 'operator'];
const ROLE_LABELS = { super_admin: 'Super Admin', admin: 'Admin', operator: 'Operator' };

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  // Admin panelinin heç bir sorğusu brauzer keşindən istifadə etməməlidir - əks halda
  // (məs. proxy/CDN Cache-Control-u dəyişərsə) admin məhsulu yadda saxladıqdan sonra
  // siyahını yenilədikdə köhnə (keşlənmiş) nəticə göstərilə bilər.
  return fetch(`${API}${path}`, { ...options, headers, cache: 'no-store' }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      // Backend token-in etibarsız olduğunu (başqa bir Super/Admin sessiyanı ləğv
      // edib, hesab deaktivdir və s.) bildirdikdə admin avtomatik lokal çıxarılır.
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

// ---------- Auth ----------
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const data = await apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    if (!ADMIN_ROLES.includes(data.user.role)) {
      toast('Bu hesabın admin icazəsi yoxdur.', true);
      return;
    }
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('trendora_admin_token', data.token);
    localStorage.setItem('trendora_admin_user', JSON.stringify(data.user));
    boot();
  } catch (err) {
    toast(err.message, true);
  }
});

// Lokal sessiyanı təmizləyir (token/user silinir, pollinglər dayandırılır) və
// Giriş görünüşünə keçir. Həm "Çıxış" düyməsi, həm də başqa admin tərəfindən
// sessiya ləğv edildikdə (bax: apiFetch -> session_ended) çağırılır.
function performLocalLogout(message) {
  state.token = null; state.user = null;
  localStorage.removeItem('trendora_admin_token');
  localStorage.removeItem('trendora_admin_user');
  // Sessiya bitdikdə yadda saxlanılmış "son görünüş" də silinir - başqa bir admin
  // (fərqli rol) daxil olanda əvvəlki istifadəçinin səhifəsinə deyil, Dashboard-a düşür.
  localStorage.removeItem('trendora_admin_current_view');
  stopChatListPolling();
  stopChatMsgPolling();
  stopChatBadgePolling();
  stopNotifListPolling();
  document.getElementById('app-shell').classList.add('hidden');
  document.getElementById('view-auth').classList.remove('hidden');
  if (message) toast(message, true);
}

document.getElementById('logout-btn').addEventListener('click', () => {
  performLocalLogout();
});

function boot() {
  document.getElementById('view-auth').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');
  applyRolePermissions();
  // F5 (səhifə yenilənməsi) edildikdə admin hara baxırdısa elə orada qalsın -
  // avtomatik olaraq Dashboard-a atılmasın. Son ziyarət edilən görünüş
  // localStorage-da saxlanılır (bax: showView) və mövcud/keçərli olduğu
  // (naviqasiyada belə bir düymə olduğu) yoxlanılaraq bərpa olunur.
  const validViews = Array.from(document.querySelectorAll('.side-btn[data-view]')).map((b) => b.dataset.view);
  const lastView = localStorage.getItem('trendora_admin_current_view');
  showView(validViews.includes(lastView) ? lastView : 'dashboard');
  startChatBadgePolling();
}

// Rola görə UI elementlərini göstər/gizlət
function applyRolePermissions() {
  const role = state.user ? state.user.role : null;
  // "Yeni admin" düyməsi yalnız Super Admin üçün görünür
  const newBtn = document.getElementById('admins-new-btn');
  if (newBtn) newBtn.classList.toggle('hidden', role !== 'super_admin');
  // Log tarixçəsi yalnız super_admin və admin üçün görünür
  const logsBtn = document.getElementById('admins-logs-btn');
  if (logsBtn) logsBtn.classList.toggle('hidden', !['super_admin', 'admin'].includes(role));
  // Ödəniş məlumatlarını redaktə etmək yalnız super_admin və admin üçün mümkündür (operator xaric)
  const psSaveBtn = document.getElementById('ps-save-btn');
  if (psSaveBtn) psSaveBtn.classList.toggle('hidden', !['super_admin', 'admin'].includes(role));
  document.querySelectorAll('#view-payment-settings input').forEach((el) => {
    el.disabled = !['super_admin', 'admin'].includes(role);
  });
  // Təhvilalma ünvanını redaktə etmək yalnız super_admin və admin üçün mümkündür (operator xaric)
  const dsSaveBtn = document.getElementById('ds-save-btn');
  if (dsSaveBtn) dsSaveBtn.classList.toggle('hidden', !['super_admin', 'admin'].includes(role));
  document.querySelectorAll('#view-delivery-settings input').forEach((el) => {
    el.disabled = !['super_admin', 'admin'].includes(role);
  });
}

// ---------- Naviqasiya ----------
document.querySelectorAll('.side-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    showView(btn.dataset.view);
    closeSidebar();
    closeMobileProfileMenu();
  });
});

// ---------- Mobil/tablet üçün yan panel (hamburger menyu) ----------
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-backdrop').classList.remove('hidden');
  closeMobileProfileMenu();
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-backdrop').classList.add('hidden');
}
const sidebarToggleBtn = document.getElementById('sidebar-toggle');
if (sidebarToggleBtn) sidebarToggleBtn.addEventListener('click', openSidebar);
const sidebarBackdrop = document.getElementById('sidebar-backdrop');
if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', closeSidebar);
const sidebarCloseBtn = document.getElementById('sidebar-close-btn');
if (sidebarCloseBtn) sidebarCloseBtn.addEventListener('click', closeSidebar);

// ---------- Mobil Header: Bildiriş + Profil düymələri ----------
function toggleMobileProfileMenu() {
  const menu = document.getElementById('mobile-profile-menu');
  if (!menu) return;
  menu.classList.contains('hidden') ? openMobileProfileMenu() : closeMobileProfileMenu();
}
function openMobileProfileMenu() {
  const menu = document.getElementById('mobile-profile-menu');
  const btn = document.getElementById('mobile-profile-btn');
  if (!menu || !btn) return;
  closeSidebar();
  if (state.user) {
    const fullName = `${state.user.name || ''} ${state.user.surname || ''}`.trim();
    document.getElementById('mpm-name').textContent = fullName || 'Admin';
    document.getElementById('mpm-email').textContent = state.user.email || '';
    const roleLabels = { super_admin: 'Super Admin', admin: 'Admin', operator: 'Operator' };
    const roleEl = document.getElementById('mpm-role');
    roleEl.textContent = roleLabels[state.user.role] || state.user.role || '';
    roleEl.className = `role-tag role-${state.user.role || ''}`;
  }
  menu.classList.remove('hidden');
  btn.setAttribute('aria-expanded', 'true');
}
function closeMobileProfileMenu() {
  const menu = document.getElementById('mobile-profile-menu');
  const btn = document.getElementById('mobile-profile-btn');
  if (menu) menu.classList.add('hidden');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}
const mobileProfileBtn = document.getElementById('mobile-profile-btn');
if (mobileProfileBtn) mobileProfileBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMobileProfileMenu(); });
document.addEventListener('click', (e) => {
  const menu = document.getElementById('mobile-profile-menu');
  const btn = document.getElementById('mobile-profile-btn');
  if (!menu || menu.classList.contains('hidden')) return;
  if (!menu.contains(e.target) && e.target !== btn && !btn.contains(e.target)) closeMobileProfileMenu();
});
const mobileLogoutBtn = document.getElementById('mobile-logout-btn');
if (mobileLogoutBtn) mobileLogoutBtn.addEventListener('click', () => document.getElementById('logout-btn').click());
const mobileNotifBtn = document.getElementById('mobile-notif-btn');
if (mobileNotifBtn) mobileNotifBtn.addEventListener('click', () => {
  closeSidebar();
  closeMobileProfileMenu();
  showView('notifications');
});

function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  document.getElementById(`view-${name}`).classList.remove('hidden');
  document.querySelectorAll('.side-btn').forEach((b) => b.classList.remove('active'));
  document.querySelector(`.side-btn[data-view="${name}"]`).classList.add('active');
  // Cari görünüş yadda saxlanılır ki, F5 edildikdə admin elə bu səhifədə qalsın (bax: boot()).
  localStorage.setItem('trendora_admin_current_view', name);

  if (name === 'dashboard') loadDashboard();
  if (name === 'finance') loadFinance();
  if (name === 'sales-analytics') loadSalesAnalytics();
  if (name === 'customer-analytics') loadCustomerAnalytics();
  if (name === 'products') loadProducts();
  if (name === 'warehouse') loadWarehouse();
  if (name === 'categories') loadCategories();
  if (name === 'brands') loadBrands();
  if (name === 'general-sizes') loadGeneralSizes();
  if (name === 'social-links') loadSocialLinks();
  if (name === 'orders') loadOrders();
  if (name === 'payment-settings') loadPaymentSettings();
  if (name === 'delivery-settings') loadDeliverySettings();
  if (name === 'cart-sound-settings') loadCartSoundSettings();
  if (name === 'company-info') loadCompanyInfo();
  if (name === 'customers') loadCustomers();
  if (name === 'promocodes') loadPromocodes();
  if (name === 'reviews') loadReviews();
  if (name === 'wheel') loadWheel();
  if (name === 'admins') loadAdmins();
  if (name === 'notifications') loadAdminNotifications();

  if (name === 'chat') {
    document.getElementById('chat-layout')?.classList.remove('mobile-chat-open');
    loadConversations();
    startChatListPolling();
  } else {
    stopChatListPolling();
    stopChatMsgPolling();
    state.chatActiveUserId = null;
  }

  if (name !== 'notifications') stopNotifListPolling();
}

// ---------- Modal ----------
function openModal(title, bodyHtml) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.querySelector('#modal-overlay .modal').classList.remove('modal-wide');
}
function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.querySelector('#modal-overlay .modal').classList.remove('modal-wide');
}

// ---------- Dashboard ----------
async function loadDashboard() {
  const [products, orders] = await Promise.all([apiFetch('/products'), apiFetch('/orders')]);
  state.products = products; state.orders = orders;

  const totalRevenue = orders.reduce((s, o) => s + o.total_price, 0);
  const lowStock = products.filter((p) => p.status !== 'archived' && p.stock_quantity <= 5);

  const pendingPayments = orders.filter((o) => o.payment_status === 'gözləyir').length;

  document.getElementById('stat-grid').innerHTML = `
    <div class="stat-card"><div class="stat-value">${products.filter(p=>p.status!=='archived').length}</div><div class="stat-label">Aktiv məhsul</div></div>
    <div class="stat-card"><div class="stat-value">${orders.length}</div><div class="stat-label">Ümumi sifariş</div></div>
    <div class="stat-card"><div class="stat-value">${totalRevenue.toFixed(2)} ₼</div><div class="stat-label">Ümumi dövriyyə</div></div>
    <div class="stat-card"><div class="stat-value">${products.filter(p=>p.status==='out_of_stock').length}</div><div class="stat-label">Stokda olmayan</div></div>
    <div class="stat-card"><div class="stat-value">${pendingPayments}</div><div class="stat-label">Gözləyən ödəniş</div></div>
  `;

  document.getElementById('low-stock-list').innerHTML = lowStock.length === 0
    ? '<p style="color:var(--text-muted);font-size:14px;">Stoku azalan məhsul yoxdur.</p>'
    : `<table class="data-table"><thead><tr><th>Məhsul</th><th>Stok</th></tr></thead><tbody>
        ${lowStock.map(p => `<tr><td>${p.name}</td><td>${p.stock_quantity}</td></tr>`).join('')}
      </tbody></table>`;
}

// ---------- Maliyyə Paneli ----------
// Sifarişlər (gəlir) və Anbar/Maya dəyəri (xərc) modullarını birləşdirərək
// xalis mənfəət və mənfəət marjasını hesablayır - backend /api/finance/summary tərəfindən hazırlanır.
async function loadFinance() {
  let data;
  try {
    data = await apiFetch('/finance/summary');
  } catch (err) {
    toast(err.message, true);
    return;
  }

  const fmt = (n) => `${Number(n).toFixed(2)} ₼`;
  const marginClass = (v) => (Number(v) < 0 ? 'profit-negative' : 'profit-positive');

  document.getElementById('finance-stat-grid').innerHTML = `
    <div class="stat-card"><div class="stat-value">${fmt(data.today.revenue)}</div><div class="stat-label">Bugünkü gəlir</div></div>
    <div class="stat-card"><div class="stat-value">${fmt(data.month.revenue)}</div><div class="stat-label">Bu ayın gəliri</div></div>
    <div class="stat-card"><div class="stat-value">${fmt(data.total.revenue)}</div><div class="stat-label">Ümumi gəlir</div></div>
    <div class="stat-card"><div class="stat-value ${marginClass(data.total.profit)}">${fmt(data.total.profit)}</div><div class="stat-label">Xalis mənfəət</div></div>
    <div class="stat-card"><div class="stat-value">${fmt(data.total.expenses)}</div><div class="stat-label">Xərclər</div></div>
    <div class="stat-card"><div class="stat-value ${marginClass(data.total.margin)}">${data.total.margin.toFixed(1)}%</div><div class="stat-label">Mənfəət marjası</div></div>
  `;

  const periodRow = (label, b) => `
    <tr>
      <td>${label}</td>
      <td>${fmt(b.revenue)}</td>
      <td>${fmt(b.expenses)}</td>
      <td><span class="${marginClass(b.profit)}">${fmt(b.profit)}</span></td>
      <td><span class="${marginClass(b.margin)}">${b.margin.toFixed(1)}%</span></td>
      <td>${b.orders_count}</td>
    </tr>`;
  document.getElementById('finance-period-tbody').innerHTML =
    periodRow('Bugün', data.today) + periodRow('Bu ay', data.month) + periodRow('Ümumi', data.total);

  const eb = data.total.expense_breakdown;
  document.getElementById('finance-breakdown-tbody').innerHTML = `
    <tr>
      <td>${fmt(eb.purchase)}</td>
      <td>${fmt(eb.cargo)}</td>
      <td>${fmt(eb.other)}</td>
      <td><b>${fmt(data.total.expenses)}</b></td>
    </tr>`;

  const noteEl = document.getElementById('finance-note');
  if (!data.has_cost_data) {
    noteEl.textContent = 'Hələ heç bir məhsul üçün "Anbar və Maya Dəyəri" bölməsində qeyd yaradılmayıb — buna görə xərclər 0 kimi göstərilir və xalis mənfəət faktiki ilə üst-üstə düşməyə bilər.';
  } else if (data.products_missing_cost > 0) {
    noteEl.textContent = `Diqqət: ${data.products_missing_cost} satılmış məhsulun maya dəyəri qeydi yoxdur - onlar üçün xərc 0 kimi hesablanıb. Dəqiq mənfəət üçün "Anbar və Maya Dəyəri" bölməsində bu məhsullara qeyd əlavə edin.`;
  } else {
    noteEl.textContent = 'Gəlir Sifarişlər, xərclər isə Anbar və Maya Dəyəri bölməsindəki qeydlər əsasında avtomatik hesablanır.';
  }
}

// ---------- Satış Analizi ----------
async function loadSalesAnalytics() {
  let data;
  try {
    data = await apiFetch('/sales-analytics/summary');
  } catch (err) {
    toast(err.message, true);
    return;
  }

  const fmt = (n) => `${Number(n).toFixed(2)} ₼`;

  const bestSeller = data.top_products[0];
  const bestCategory = data.category_revenue[0];

  document.getElementById('sales-analytics-stat-grid').innerHTML = `
    <div class="stat-card"><div class="stat-value">${bestSeller ? escapeHtml(bestSeller.name) : '—'}</div><div class="stat-label">Ən çox satılan məhsul</div></div>
    <div class="stat-card"><div class="stat-value">${bestCategory ? escapeHtml(bestCategory.category_name) : '—'}</div><div class="stat-label">Ən gəlirli kateqoriya</div></div>
    <div class="stat-card"><div class="stat-value profit-negative">${fmt(data.discount_loss.total)}</div><div class="stat-label">Endirimlərdən itki</div></div>
    <div class="stat-card"><div class="stat-value profit-negative">${fmt(data.cancelled_orders.total.value)}</div><div class="stat-label">Ləğv olunan sifarişlərin dəyəri (ümumi)</div></div>
  `;

  document.getElementById('sales-top-products-tbody').innerHTML = data.top_products.length === 0
    ? '<tr><td colspan="5">Hələ satış qeydə alınmayıb.</td></tr>'
    : data.top_products.map((p) => `
        <tr>
          <td>${p.image_url ? `<img src="${escapeHtml(p.image_url)}" class="thumb" loading="lazy" decoding="async" />` : '—'}</td>
          <td>${escapeHtml(p.name)}</td>
          <td>${escapeHtml(p.category_name)}</td>
          <td>${p.quantity_sold}</td>
          <td>${fmt(p.revenue)}</td>
        </tr>`).join('');

  document.getElementById('sales-category-revenue-tbody').innerHTML = data.category_revenue.length === 0
    ? '<tr><td colspan="3">Məlumat yoxdur.</td></tr>'
    : data.category_revenue.map((c) => `
        <tr>
          <td>${escapeHtml(c.category_name)}</td>
          <td>${c.quantity_sold}</td>
          <td>${fmt(c.revenue)}</td>
        </tr>`).join('');

  document.getElementById('sales-discount-loss-tbody').innerHTML = data.discount_loss.by_product.length === 0
    ? '<tr><td colspan="4">Endirimli satış qeydə alınmayıb.</td></tr>'
    : data.discount_loss.by_product.map((d) => `
        <tr>
          <td>${escapeHtml(d.name)}</td>
          <td>${d.discount_percent}%</td>
          <td>${d.quantity_sold}</td>
          <td class="profit-negative">${fmt(d.loss)}</td>
        </tr>`).join('');
  document.getElementById('sales-discount-loss-total').textContent = fmt(data.discount_loss.total);

  const co = data.cancelled_orders;
  document.getElementById('sales-cancelled-summary-tbody').innerHTML = `
    <tr><td>Bugün</td><td>${co.today.count}</td><td class="profit-negative">${fmt(co.today.value)}</td></tr>
    <tr><td>Bu ay</td><td>${co.month.count}</td><td class="profit-negative">${fmt(co.month.value)}</td></tr>
    <tr><td>Ümumi</td><td>${co.total.count}</td><td class="profit-negative">${fmt(co.total.value)}</td></tr>
  `;

  document.getElementById('sales-cancelled-list-tbody').innerHTML = co.list.length === 0
    ? '<tr><td colspan="5">Ləğv olunan sifariş yoxdur.</td></tr>'
    : co.list.slice(0, 50).map((o) => `
        <tr>
          <td>${escapeHtml(o.code) || `#${o.id}`}</td>
          <td>${fmt(o.total_price)}</td>
          <td>${o.cancelled_by === 'admin' ? 'Admin' : (o.cancelled_by === 'customer' ? 'Müştəri' : '—')}</td>
          <td>${escapeHtml(o.cancellation_reason) || '—'}</td>
          <td>${new Date(o.updated_at || o.created_at).toLocaleString('az-AZ')}</td>
        </tr>`).join('');
}

// ---------- Müştəri Analizi ----------
async function loadCustomerAnalytics() {
  let data;
  try {
    data = await apiFetch('/customer-analytics/summary');
  } catch (err) {
    toast(err.message, true);
    return;
  }

  const fmt = (n) => `${Number(n).toFixed(2)} ₼`;
  const nc = data.new_customers;
  const rc = data.repeat_customers;
  const avg = data.average_order_value;

  document.getElementById('customer-analytics-stat-grid').innerHTML = `
    <div class="stat-card"><div class="stat-value">${nc.total}</div><div class="stat-label">Ümumi müştəri sayı</div></div>
    <div class="stat-card"><div class="stat-value">${nc.month}</div><div class="stat-label">Bu ay qoşulan yeni müştəri</div></div>
    <div class="stat-card"><div class="stat-value">${rc.count}</div><div class="stat-label">Təkrar alış edən müştəri</div></div>
    <div class="stat-card"><div class="stat-value">${fmt(avg.total.average)}</div><div class="stat-label">Orta sifariş məbləği (ümumi)</div></div>
  `;

  document.getElementById('customer-new-summary-tbody').innerHTML = `
    <tr><td>Bugün</td><td>${nc.today}</td></tr>
    <tr><td>Bu ay</td><td>${nc.month}</td></tr>
    <tr><td>Ümumi</td><td>${nc.total}</td></tr>
  `;

  document.getElementById('customer-new-list-tbody').innerHTML = nc.recent.length === 0
    ? '<tr><td colspan="3">Hələ müştəri qeydiyyatdan keçməyib.</td></tr>'
    : nc.recent.map((c) => `
        <tr>
          <td>${escapeHtml(c.name) || '—'}</td>
          <td>${escapeHtml(c.email)}</td>
          <td>${new Date(c.created_at).toLocaleString('az-AZ')}</td>
        </tr>`).join('');

  document.getElementById('customer-repeat-note').textContent =
    `Ümumi müştərilərin ${rc.percentage}%-i (${rc.count} nəfər) birdən çox sifariş verib.`;
  document.getElementById('customer-repeat-tbody').innerHTML = rc.list.length === 0
    ? '<tr><td colspan="4">Hələ təkrar alış edən müştəri yoxdur.</td></tr>'
    : rc.list.map((c) => `
        <tr>
          <td>${escapeHtml(c.name)}</td>
          <td>${escapeHtml(c.email) || '—'}</td>
          <td>${c.order_count}</td>
          <td>${fmt(c.total_spent)}</td>
        </tr>`).join('');

  document.getElementById('customer-avg-order-tbody').innerHTML = `
    <tr><td>Bugün</td><td>${avg.today.orders_count}</td><td>${fmt(avg.today.average)}</td></tr>
    <tr><td>Bu ay</td><td>${avg.month.orders_count}</td><td>${fmt(avg.month.average)}</td></tr>
    <tr><td>Ümumi</td><td>${avg.total.orders_count}</td><td>${fmt(avg.total.average)}</td></tr>
  `;

  document.getElementById('customer-top-tbody').innerHTML = data.top_customers.length === 0
    ? '<tr><td colspan="5">Hələ sifariş qeydə alınmayıb.</td></tr>'
    : data.top_customers.map((c) => `
        <tr>
          <td>${escapeHtml(c.name)}</td>
          <td>${escapeHtml(c.email) || '—'}</td>
          <td>${c.order_count}</td>
          <td>${fmt(c.total_spent)}</td>
          <td>${c.last_order_at ? new Date(c.last_order_at).toLocaleDateString('az-AZ') : '—'}</td>
        </tr>`).join('');
}

// ---------- Kateqoriyalar ----------
async function loadCategories() {
  state.categories = await apiFetch('/categories');
  const products = await apiFetch('/products');
  const tbody = document.getElementById('categories-tbody');
  tbody.innerHTML = state.categories.map((c) => {
    const count = products.filter((p) => p.category_id === c.id).length;
    return `
      <tr>
        <td>${c.name}</td>
        <td>${count}</td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="openCategoryModal(${c.id})">Redaktə</button>
          <button class="btn btn-danger btn-sm" onclick="deleteCategory(${c.id})">Sil</button>
        </td>
      </tr>`;
  }).join('') || '<tr><td colspan="3">Kateqoriya yoxdur.</td></tr>';
}

function openCategoryModal(id) {
  const cat = id ? state.categories.find((c) => c.id === id) : null;
  openModal(cat ? 'Kateqoriyanı redaktə et' : 'Yeni kateqoriya', `
    <div class="form-group"><label>Ad</label><input id="cat-name" value="${cat ? cat.name : ''}" /></div>
    <button class="btn btn-primary" style="width:100%" onclick="saveCategory(${id || 'null'})">Yadda saxla</button>
  `);
}

async function saveCategory(id) {
  const name = document.getElementById('cat-name').value.trim();
  if (!name) { toast('Ad daxil edin.', true); return; }
  try {
    if (id) await apiFetch(`/categories/${id}`, { method: 'PUT', body: JSON.stringify({ name }) });
    else await apiFetch('/categories', { method: 'POST', body: JSON.stringify({ name }) });
    closeModal(); toast('Kateqoriya yadda saxlanıldı.'); loadCategories();
  } catch (err) { toast(err.message, true); }
}

async function deleteCategory(id) {
  if (!confirm('Bu kateqoriyanı silmək istədiyinizə əminsiniz?')) return;
  try {
    await apiFetch(`/categories/${id}`, { method: 'DELETE' });
    toast('Kateqoriya silindi.'); loadCategories();
  } catch (err) { toast(err.message, true); }
}

// ---------- Ölçülər (Ümumi) ----------
async function loadGeneralSizes() {
  state.generalSizes = await apiFetch('/general-sizes');
  const tbody = document.getElementById('general-sizes-tbody');
  tbody.innerHTML = state.generalSizes.map((s, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${escapeHtml(s.name)}</td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="openGeneralSizeModal(${s.id})">Redaktə</button>
          <button class="btn btn-danger btn-sm" onclick="deleteGeneralSize(${s.id})">Sil</button>
        </td>
      </tr>`).join('') || '<tr><td colspan="3">Ölçü yoxdur.</td></tr>';
}

function openGeneralSizeModal(id) {
  const size = id ? state.generalSizes.find((s) => s.id === id) : null;
  openModal(size ? 'Ölçünü redaktə et' : 'Yeni ölçü', `
    <div class="form-group"><label>Ölçü adı</label><input id="general-size-name" maxlength="20" placeholder="Məs: M və ya 40" value="${size ? escapeHtml(size.name) : ''}" /></div>
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;">${size ? 'Adı dəyişdikdə bu ölçünü istifadə edən bütün məhsullarda avtomatik yenilənəcək.' : 'Bu ölçü əlavə edildikdən sonra avtomatik olaraq bütün məhsulların ümumi ölçü siyahısına əlavə olunacaq.'}</div>
    <button class="btn btn-primary" style="width:100%" onclick="saveGeneralSize(${id || 'null'})">Yadda saxla</button>
  `);
}

async function saveGeneralSize(id) {
  const name = document.getElementById('general-size-name').value.trim();
  if (!name) { toast('Ölçü adı daxil edin.', true); return; }
  try {
    if (id) await apiFetch(`/general-sizes/${id}`, { method: 'PUT', body: JSON.stringify({ name }) });
    else await apiFetch('/general-sizes', { method: 'POST', body: JSON.stringify({ name }) });
    closeModal(); toast('Ölçü yadda saxlanıldı.'); loadGeneralSizes();
  } catch (err) { toast(err.message, true); }
}

async function deleteGeneralSize(id) {
  if (!confirm('Bu ölçünü silmək istədiyinizə əminsiniz? Ölçü bütün məhsulların ümumi ölçü siyahısından da çıxarılacaq.')) return;
  try {
    await apiFetch(`/general-sizes/${id}`, { method: 'DELETE' });
    toast('Ölçü silindi.'); loadGeneralSizes();
  } catch (err) { toast(err.message, true); }
}

// ---------- Brendlər ----------
async function loadBrandMarqueeSpeed() {
  try {
    const settings = await apiFetch('/brand-marquee-settings');
    const input = document.getElementById('brand-marquee-speed');
    if (input) input.value = settings.speed_seconds ?? 30;
  } catch (err) { /* fərqli görünüşdə səssizcə keçilir */ }
}

async function saveBrandMarqueeSpeed() {
  const input = document.getElementById('brand-marquee-speed');
  const speed_seconds = Number(input.value);
  if (!speed_seconds || speed_seconds < 5 || speed_seconds > 120) {
    toast('Sürət 5-120 saniyə aralığında olmalıdır.', true);
    return;
  }
  try {
    await apiFetch('/brand-marquee-settings', { method: 'PUT', body: JSON.stringify({ speed_seconds }) });
    toast('Karuselin sürəti yadda saxlanıldı.');
  } catch (err) { toast(err.message, true); }
}

async function loadBrands() {
  state.brands = await apiFetch('/brands?all=1');
  loadBrandMarqueeSpeed();
  const tbody = document.getElementById('brands-tbody');
  const sorted = [...state.brands].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.id - b.id);
  tbody.innerHTML = sorted.map((b) => `
      <tr>
        <td class="brand-logo-cell"><img src="${b.logo_url}" alt="${escapeHtml(b.name)}" loading="lazy" decoding="async" /></td>
        <td>${escapeHtml(b.name) || '—'}</td>
        <td>${b.sort_order}</td>
        <td>
          <span class="tag tag-${b.is_active ? 'active' : 'archived'}">${b.is_active ? 'Aktiv' : 'Deaktiv'}</span>
        </td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="toggleBrandActive(${b.id})">${b.is_active ? 'Gizlət' : 'Aktivləşdir'}</button>
          <button class="btn btn-secondary btn-sm" onclick="openBrandModal(${b.id})">Redaktə</button>
          <button class="btn btn-danger btn-sm" onclick="deleteBrand(${b.id})">Sil</button>
        </td>
      </tr>`).join('') || '<tr><td colspan="5">Hələ brend əlavə edilməyib.</td></tr>';
}

function openBrandModal(id) {
  const b = id ? state.brands.find((x) => x.id === id) : null;
  state.brandLogoItem = b ? { url: b.logo_url, valid: null, checking: true } : null;

  openModal(b ? 'Brendi redaktə et' : 'Yeni brend', `
    <div class="form-group">
      <label>Loqo şəkli linki (URL)</label>
      <input id="brand-logo-url" type="url" placeholder="https://.../logo.png" value="${b ? escapeHtml(b.logo_url) : ''}" oninput="onBrandLogoUrlInput()" />
      <div id="brand-logo-preview-wrap"></div>
    </div>
    <div class="form-group"><label>Ad (opsional, daxili istinad üçün)</label><input id="brand-name" value="${b ? escapeHtml(b.name) : ''}" /></div>
    <div class="form-group"><label>Sıra nömrəsi</label><input id="brand-order" type="number" value="${b ? b.sort_order : state.brands.length}" /></div>
    <button class="btn btn-primary" style="width:100%" onclick="saveBrand(${id || 'null'})">Yadda saxla</button>
  `);
  renderBrandLogoPreview();
  if (b) checkImageUrl(b.logo_url, (result) => { state.brandLogoItem = { url: b.logo_url, valid: result.valid }; renderBrandLogoPreview(); });
}

// Şəkil linkinin real şəkil kimi yüklənib-yüklənmədiyini brauzerdə avtomatik yoxlayır
function checkImageUrl(url, callback) {
  if (!url || !url.trim()) { callback({ valid: false, empty: true }); return; }
  const img = new Image();
  img.onload = () => callback({ valid: true });
  img.onerror = () => callback({ valid: false });
  img.src = url.trim();
}

let brandLogoCheckTimer = null;
function onBrandLogoUrlInput() {
  const input = document.getElementById('brand-logo-url');
  const url = input.value.trim();
  state.brandLogoItem = { url, valid: null, checking: true };
  renderBrandLogoPreview();
  clearTimeout(brandLogoCheckTimer);
  brandLogoCheckTimer = setTimeout(() => {
    checkImageUrl(url, (result) => {
      // istifadəçi bu müddətdə linki dəyişibsə köhnə nəticəni tətbiq etmə
      if (document.getElementById('brand-logo-url')?.value.trim() !== url) return;
      state.brandLogoItem = { url, valid: result.valid, empty: result.empty };
      renderBrandLogoPreview();
    });
  }, 500);
}

function renderBrandLogoPreview() {
  const wrap = document.getElementById('brand-logo-preview-wrap');
  if (!wrap) return;
  const item = state.brandLogoItem;
  if (!item || item.empty) {
    wrap.innerHTML = '<div class="brand-logo-status muted">Şəkil linki daxil edin.</div>';
  } else if (item.checking || item.valid === null) {
    wrap.innerHTML = '<div class="brand-logo-status muted">Link yoxlanılır…</div>';
  } else if (item.valid) {
    wrap.innerHTML = `<img class="brand-logo-preview" src="${item.url}" alt="" /><div class="brand-logo-status ok">✓ Şəkil düzgün yüklənir.</div>`;
  } else {
    wrap.innerHTML = '<div class="brand-logo-status error">✕ Bu link üzrə şəkil yüklənə bilmədi. Linki yoxlayın.</div>';
  }
}

async function saveBrand(id) {
  const logo_url = (document.getElementById('brand-logo-url')?.value || '').trim();
  if (!logo_url) { toast('Zəhmət olmasa brend loqosu üçün şəkil linki daxil edin.', true); return; }
  if (state.brandLogoItem && state.brandLogoItem.valid === false) {
    toast('Daxil edilən link etibarlı bir şəkil göstərmir. Zəhmət olmasa linki yoxlayın.', true);
    return;
  }
  try {
    const payload = {
      name: document.getElementById('brand-name').value.trim(),
      sort_order: Number(document.getElementById('brand-order').value) || 0,
      logo_url
    };
    if (id) await apiFetch(`/brands/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    else await apiFetch('/brands', { method: 'POST', body: JSON.stringify(payload) });
    state.brandLogoItem = null;
    closeModal(); toast('Brend yadda saxlanıldı.'); loadBrands();
  } catch (err) { toast(err.message, true); }
}

async function toggleBrandActive(id) {
  const b = state.brands.find((x) => x.id === id);
  if (!b) return;
  try {
    await apiFetch(`/brands/${id}`, { method: 'PUT', body: JSON.stringify({ is_active: !b.is_active }) });
    loadBrands();
  } catch (err) { toast(err.message, true); }
}

async function deleteBrand(id) {
  if (!confirm('Bu brendi silmək istədiyinizə əminsiniz?')) return;
  try {
    await apiFetch(`/brands/${id}`, { method: 'DELETE' });
    toast('Brend silindi.'); loadBrands();
  } catch (err) { toast(err.message, true); }
}

// ---------- Sosial Şəbəkələr ----------
// Hər platform üçün göstərilən ad və müştəri panelindəki ilə eyni ikon (SVG)
const SOCIAL_PLATFORMS = {
  instagram: { label: 'Instagram', icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1"/></svg>' },
  facebook: { label: 'Facebook', icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M15 8h-2a2 2 0 0 0-2 2v10M9 13h4"/><path d="M15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3V3Z"/></svg>' },
  whatsapp: { label: 'WhatsApp', icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20.5 12a8.5 8.5 0 1 1-3.8-7.1L20.5 4l-.9 4.1c.6 1.2.9 2.5.9 3.9Z"/><path d="M8.5 9.5c.2 2.6 2.4 4.8 5 5"/></svg>' },
  tiktok: { label: 'TikTok', icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 3v10.5a3.5 3.5 0 1 1-3-3.46"/><path d="M14 3c.4 2.2 2 4 5 4"/></svg>' },
  telegram: { label: 'Telegram', icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m21 4-9 17-3-8-8-3 20-6Z"/><path d="M9 13l9-8"/></svg>' },
  youtube: { label: 'YouTube', icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2.5" y="6" width="19" height="12" rx="4"/><path d="m10.5 9.5 5 2.5-5 2.5Z" fill="currentColor" stroke="none"/></svg>' },
  twitter: { label: 'X (Twitter)', icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 4l16 16M20 4 4 20"/></svg>' },
  linkedin: { label: 'LinkedIn', icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7.5 10.5v6M7.5 7.5v.01M12 16.5v-3.7c0-1.5 1-2.3 2.2-2.3 1.2 0 1.8.8 1.8 2.3v3.7"/></svg>' },
  pinterest: { label: 'Pinterest', icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M9.5 18c1-3 1.5-5 1.5-7a2.5 2.5 0 1 1 5 0c0 2-1 4-2.5 4s-1.5-1-1.2-2.2"/></svg>' },
  snapchat: { label: 'Snapchat', icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3c2.5 0 4 1.8 4 4.2 0 1.4-.1 2.4 0 3 .1.5 1 1.3 2 1.3 0 1-1 1.5-2 1.8-.3 1.7-.6 2-1 2.2-.6.3-1.3-.2-2-.2s-1.6 1.2-3 1.2-2.3-1.2-3-1.2-1.4.5-2 .2c-.4-.2-.7-.5-1-2.2-1-.3-2-.8-2-1.8 1-.1 1.9-.8 2-1.3.1-.6 0-1.6 0-3C4 4.8 5.5 3 8 3h4Z"/></svg>' },
  other: { label: 'Digər', icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 14a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/></svg>' }
};

async function loadSocialLinks() {
  state.socialLinks = await apiFetch('/social-links?all=1');
  const tbody = document.getElementById('social-links-tbody');
  const sorted = [...state.socialLinks].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.id - b.id);
  tbody.innerHTML = sorted.map((l) => {
    const meta = SOCIAL_PLATFORMS[l.platform] || SOCIAL_PLATFORMS.other;
    return `
      <tr>
        <td class="social-icon-cell">${meta.icon}</td>
        <td>${meta.label}</td>
        <td>${escapeHtml(l.label) || '—'}</td>
        <td class="social-url-cell"><a href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${escapeHtml(l.url)}</a></td>
        <td>${l.sort_order}</td>
        <td><span class="tag tag-${l.is_active ? 'active' : 'archived'}">${l.is_active ? 'Aktiv' : 'Deaktiv'}</span></td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="toggleSocialLinkActive(${l.id})">${l.is_active ? 'Gizlət' : 'Aktivləşdir'}</button>
          <button class="btn btn-secondary btn-sm" onclick="openSocialLinkModal(${l.id})">Redaktə</button>
          <button class="btn btn-danger btn-sm" onclick="deleteSocialLink(${l.id})">Sil</button>
        </td>
      </tr>`;
  }).join('') || '<tr><td colspan="7">Hələ sosial şəbəkə əlavə edilməyib.</td></tr>';
}

function openSocialLinkModal(id) {
  const l = id ? state.socialLinks.find((x) => x.id === id) : null;
  const platformOptions = Object.entries(SOCIAL_PLATFORMS)
    .map(([key, meta]) => `<option value="${key}" ${l && l.platform === key ? 'selected' : ''}>${meta.label}</option>`)
    .join('');

  openModal(l ? 'Sosial şəbəkəni redaktə et' : 'Yeni sosial şəbəkə', `
    <div class="form-group">
      <label>Platform</label>
      <select id="social-platform">${platformOptions}</select>
    </div>
    <div class="form-group">
      <label>Ad (opsional, boş buraxsanız platform adı göstərilir)</label>
      <input id="social-label" value="${l ? escapeHtml(l.label) : ''}" placeholder="məs. Trendora İnstaqram" />
    </div>
    <div class="form-group">
      <label>Link (URL)</label>
      <input id="social-url" type="url" placeholder="https://instagram.com/..." value="${l ? escapeHtml(l.url) : ''}" />
    </div>
    <div class="form-group"><label>Sıra nömrəsi</label><input id="social-order" type="number" value="${l ? l.sort_order : state.socialLinks.length}" /></div>
    <button class="btn btn-primary" style="width:100%" onclick="saveSocialLink(${id || 'null'})">Yadda saxla</button>
  `);
}

async function saveSocialLink(id) {
  const url = (document.getElementById('social-url')?.value || '').trim();
  if (!url) { toast('Zəhmət olmasa sosial şəbəkə üçün link daxil edin.', true); return; }
  try {
    const payload = {
      platform: document.getElementById('social-platform').value,
      label: document.getElementById('social-label').value.trim(),
      sort_order: Number(document.getElementById('social-order').value) || 0,
      url
    };
    if (id) await apiFetch(`/social-links/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    else await apiFetch('/social-links', { method: 'POST', body: JSON.stringify(payload) });
    closeModal(); toast('Sosial şəbəkə yadda saxlanıldı.'); loadSocialLinks();
  } catch (err) { toast(err.message, true); }
}

async function toggleSocialLinkActive(id) {
  const l = state.socialLinks.find((x) => x.id === id);
  if (!l) return;
  try {
    await apiFetch(`/social-links/${id}`, { method: 'PUT', body: JSON.stringify({ is_active: !l.is_active }) });
    loadSocialLinks();
  } catch (err) { toast(err.message, true); }
}

async function deleteSocialLink(id) {
  if (!confirm('Bu sosial şəbəkəni silmək istədiyinizə əminsiniz?')) return;
  try {
    await apiFetch(`/social-links/${id}`, { method: 'DELETE' });
    toast('Sosial şəbəkə silindi.'); loadSocialLinks();
  } catch (err) { toast(err.message, true); }
}

// ---------- Məhsullar ----------
async function loadProducts() {
  if (state.categories.length === 0) state.categories = await apiFetch('/categories');
  state.products = await apiFetch('/products');
  populateProductCategoryFilter();
  renderProducts();
}

function populateProductCategoryFilter() {
  const select = document.getElementById('products-filter-category');
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">Bütün kateqoriyalar</option>' +
    state.categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  if (current && state.categories.some((c) => String(c.id) === current)) select.value = current;
}

function debouncedRenderProducts() {
  clearTimeout(state.productsSearchTimer);
  state.productsSearchTimer = setTimeout(renderProducts, 250);
}

function resetProductFilters() {
  document.getElementById('products-search').value = '';
  document.getElementById('products-filter-category').value = '';
  document.getElementById('products-filter-date-start').value = '';
  document.getElementById('products-filter-date-end').value = '';
  document.getElementById('products-sort').value = 'date_desc';
  renderProducts();
}

function renderProducts() {
  const tbody = document.getElementById('products-tbody');
  if (!tbody) return;

  const q = (document.getElementById('products-search')?.value || '').trim().toLowerCase();
  const categoryId = document.getElementById('products-filter-category')?.value || '';
  const dateStart = document.getElementById('products-filter-date-start')?.value || '';
  const dateEnd = document.getElementById('products-filter-date-end')?.value || '';
  const sort = document.getElementById('products-sort')?.value || 'date_desc';

  let list = [...state.products];

  if (q) list = list.filter((p) => (p.name || '').toLowerCase().includes(q));
  if (categoryId) list = list.filter((p) => p.category_id === Number(categoryId));
  if (dateStart) {
    const startTime = new Date(dateStart + 'T00:00:00').getTime();
    list = list.filter((p) => p.created_at && new Date(p.created_at).getTime() >= startTime);
  }
  if (dateEnd) {
    const endTime = new Date(dateEnd + 'T23:59:59.999').getTime();
    list = list.filter((p) => p.created_at && new Date(p.created_at).getTime() <= endTime);
  }

  list.sort((a, b) => {
    const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
    const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
    return sort === 'date_asc' ? timeA - timeB : timeB - timeA;
  });

  tbody.innerHTML = list.map((p, idx) => {
    const cat = state.categories.find((c) => c.id === p.category_id);
    return `
      <tr>
        <td>${idx + 1}</td>
        <td><img src="${p.image_url || ''}" alt="" loading="lazy" decoding="async" /></td>
        <td>${p.name}${p.size_label ? ` <span class="unit-tag">${escapeHtml(p.size_label)}</span>` : ''}${p.is_hidden ? ' <span class="tag tag-hidden" title="Bu məhsul müştəri panelində gizlədilib">🙈 Gizli</span>' : ''}</td>
        <td>${cat ? cat.name : '—'}</td>
        <td>${p.price.toFixed(2)} ₼</td>
        <td>${p.discount_percent}%</td>
        <td>${formatDiscountEnd(p)}</td>
        <td>
          <button class="featured-toggle-btn ${p.is_featured ? 'active' : ''}" title="${p.is_featured ? 'Avantajlı Məhsuldan çıxar' : 'Avantajlı Məhsul et'}" onclick="toggleFeatured(${p.id}, ${!p.is_featured})">
            ${p.is_featured ? '⭐' : '☆'}
          </button>
        </td>
        <td>
          <span title="Bu say sistem tərəfindən ödənişi təsdiqlənmiş sifarişlərə görə avtomatik hesablanır.">${p.sold_count || 0}</span>
          ${p.is_bestseller ? '<span class="bestseller-tag" title="Satış sayı həddi keçdiyi üçün sistem avtomatik təyin edib">🏆 Ən Çox Satılan</span>' : ''}
        </td>
        <td>${p.stock_quantity}${p.unit ? ` <span class="unit-tag">${escapeHtml(p.unit)}</span>` : ''}</td>
        <td><span class="tag tag-${p.status}">${statusLabel(p.status)}</span></td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="openProductModal(${p.id})">Redaktə</button>
          <button class="btn btn-secondary btn-sm" onclick="toggleHideProduct(${p.id}, ${!p.is_hidden})">${p.is_hidden ? 'Göstər' : 'Gizlət'}</button>
          <button class="btn btn-danger btn-sm" onclick="deleteProduct(${p.id})">Sil</button>
        </td>
      </tr>`;
  }).join('') || '<tr><td colspan="12">Məhsul yoxdur.</td></tr>';
}

// Məhsulun endirim bitmə tarixi/saatını cədvəldə göstərmək üçün formatlaşdırır.
// Hər iki sahə də könüllü olduğundan - heç biri doldurulmayıbsa "—" göstərilir.
// Yalnız informativ göstəricidir: vaxtı keçmiş olsa belə endirim faizi/qiymət
// hesablanmasına toxunmur (bu, gələcək mərhələdə edilə bilər).
function formatDiscountEnd(p) {
  if (!p.discount_end_date) return '—';
  const timePart = p.discount_end_time ? `T${p.discount_end_time}` : 'T23:59';
  const end = new Date(`${p.discount_end_date}${timePart}`);
  const label = p.discount_end_time ? `${p.discount_end_date} ${p.discount_end_time}` : p.discount_end_date;
  if (!isNaN(end.getTime()) && end.getTime() < Date.now()) {
    return `${escapeHtml(label)} <span class="tag tag-out_of_stock" title="Endirim bitmə vaxtı keçib">Bitib</span>`;
  }
  return escapeHtml(label);
}

async function toggleHideProduct(id, value) {
  try {
    await apiFetch(`/products/${id}/hide`, { method: 'PATCH', body: JSON.stringify({ is_hidden: value }) });
    toast(value ? 'Məhsul müştəri panelində gizlədildi.' : 'Məhsul yenidən göstərilir.');
    loadProducts();
  } catch (err) { toast(err.message, true); }
}

async function toggleFeatured(id, value) {
  try {
    await apiFetch(`/products/${id}/featured`, { method: 'PATCH', body: JSON.stringify({ is_featured: value }) });
    toast(value ? 'Məhsul Avantajlı Məhsul edildi.' : 'Avantajlı Məhsul nişanı silindi.');
    loadProducts();
  } catch (err) { toast(err.message, true); }
}

function statusLabel(status) {
  return { active: 'Aktiv', out_of_stock: 'Stokda yoxdur', archived: 'Arxivləndi' }[status] || status;
}

function productUnitSelectOptions(selectedUnit) {
  const isKnown = PRODUCT_UNITS.includes(selectedUnit);
  const known = PRODUCT_UNITS.map((u) =>
    `<option value="${u}" ${selectedUnit === u ? 'selected' : ''}>${u}</option>`
  ).join('');
  return `<option value="" ${!selectedUnit ? 'selected' : ''}>— Seçilməyib —</option>` +
    known +
    `<option value="__other__" ${selectedUnit && !isKnown ? 'selected' : ''}>Digər (manual yaz)</option>`;
}

function onProductUnitChange() {
  const select = document.getElementById('p-unit-select');
  const custom = document.getElementById('p-unit-custom');
  if (!select || !custom) return;
  if (select.value === '__other__') {
    custom.style.display = '';
    custom.focus();
  } else {
    custom.style.display = 'none';
    custom.value = '';
  }
}

function openProductModal(id) {
  const p = id ? state.products.find((x) => x.id === id) : null;
  const categoryOptions = state.categories.map((c) =>
    `<option value="${c.id}" ${p && p.category_id === c.id ? 'selected' : ''}>${c.name}</option>`
  ).join('');

  // Köhnə (tək URL sətri) və yeni (obyekt: {url, title, color_name, color_code, description,
  // features, composition, usage, notes}) formatlarını dəstəklə
  const existingImages = p ? (p.images && p.images.length ? p.images : (p.image_url ? [p.image_url] : [])) : [];
  state.productImageItems = existingImages.map((img) => (
    typeof img === 'string'
      ? { url: img, titles: [], colors: [], sizes: [], description: '', features: '', composition: '', usage: '', notes: '', aspect_ratio: '1:1' }
      : {
          url: img.url,
          // Yeni dinamik siyahılar (varsa) istifadə olunur; yoxdursa köhnə tək-dəyərli
          // `title`/`color_name`/`color_code` sahələrindən başlanğıc siyahı qurulur (geriyə uyğunluq).
          titles: (Array.isArray(img.titles) && img.titles.length) ? [...img.titles] : (img.title ? [img.title] : []),
          colors: (Array.isArray(img.colors) && img.colors.length)
            ? img.colors.map((c) => ({ name: c.name || '', code: c.code || '' }))
            : ((img.color_name || img.color_code) ? [{ name: img.color_name || '', code: img.color_code || '' }] : []),
          // Hər ölçü `{ size, quantity }` obyekti kimi saxlanılır - köhnə sadə mətn
          // ölçüləri (string) ilə geriyə uyğunluq üçün stok sayı 0 qəbul edilir.
          sizes: Array.isArray(img.sizes)
            ? img.sizes.map((s) => (typeof s === 'string' ? { size: s, quantity: 0 } : { size: s.size || '', quantity: Number(s.quantity) || 0 }))
            : [],
          description: img.description || '',
          features: img.features || '', composition: img.composition || '', usage: img.usage || '', notes: img.notes || '', aspect_ratio: img.aspect_ratio || '1:1'
        }
  ));
  // Köhnə məhsullarda ölçülər ümumi (məhsul səviyyəsində) saxlanılırdı - əgər bu məhsulun heç bir
  // şəklinin öz ölçü siyahısı yoxdursa, köhnə ümumi siyahını ilk şəklə köçürürük ki, admin redaktəyə
  // başlayanda məlumat itməsin (yeni sistemdə ölçülər hər şəkil/rəng üçün ayrıca saxlanılır).
  if (p && Array.isArray(p.sizes) && p.sizes.length && state.productImageItems.length &&
      !state.productImageItems.some((it) => it.sizes && it.sizes.length)) {
    state.productImageItems[0].sizes = p.sizes.map((s) => (typeof s === 'string' ? { size: s, quantity: 0 } : { size: s.size || '', quantity: Number(s.quantity) || 0 }));
  }

  openModal(p ? 'Məhsulu redaktə et' : 'Yeni məhsul', `
    <div class="form-group"><label>Ad</label><input id="p-name" value="${p ? p.name : ''}" /></div>
    <div class="form-group"><label>Təsvir</label><textarea id="p-desc" rows="2">${p ? p.description || '' : ''}</textarea></div>
    <div class="form-group"><label>Kateqoriya</label><select id="p-category"><option value="">—</option>${categoryOptions}</select></div>
    <div class="form-row">
      <div class="form-group"><label>Qiymət (₼)</label><input id="p-price" type="number" step="0.01" value="${p ? p.price : ''}" /></div>
      <div class="form-group"><label>Stok sayı</label><input id="p-stock" type="number" value="${p ? p.stock_quantity : ''}" /></div>
    </div>
    <div class="form-group"><label>Endirim faizi (%)</label><input id="p-discount" type="number" min="0" max="100" value="${p ? p.discount_percent : 0}" /></div>
    <div class="form-row">
      <div class="form-group"><label>Endirim bitmə tarixi (könüllü)</label><input id="p-discount-end-date" type="date" value="${p && p.discount_end_date ? p.discount_end_date : ''}" /></div>
      <div class="form-group"><label>Endirim bitmə saatı (könüllü)</label><input id="p-discount-end-time" type="time" value="${p && p.discount_end_time ? p.discount_end_time : ''}" /></div>
    </div>
    <div style="font-size:11px;color:var(--text-muted);margin-top:-8px;margin-bottom:8px;">Doldurulması məcburi deyil - boş saxlasanız endirimin bitmə vaxtı olmayacaq.</div>
    <div class="form-group">
      <label>Ölçü Vahidi</label>
      <select id="p-unit-select" onchange="onProductUnitChange()">${productUnitSelectOptions(p ? p.unit || '' : '')}</select>
      <input id="p-unit-custom" type="text" placeholder="Ölçü vahidini yazın (məs: dəst, m², litr...)"
        value="${p && p.unit && !PRODUCT_UNITS.includes(p.unit) ? escapeHtml(p.unit) : ''}"
        style="margin-top:8px;${p && p.unit && !PRODUCT_UNITS.includes(p.unit) ? '' : 'display:none;'}" />
    </div>
    <div class="form-group">
      <label>Çatdırılma növü</label>
      <select id="p-delivery-type">
        <option value="standard" ${(!p || !p.delivery_type || p.delivery_type === 'standard') ? 'selected' : ''}>Standart çatdırılma</option>
        <option value="express" ${p && p.delivery_type === 'express' ? 'selected' : ''}>Sürətli çatdırılma</option>
        <option value="pickup" ${p && p.delivery_type === 'pickup' ? 'selected' : ''}>Mağazadan götürmə</option>
      </select>
    </div>
    <div class="form-group form-group-checkbox">
      <label class="checkbox-label">
        <input id="p-featured" type="checkbox" ${p && p.is_featured ? 'checked' : ''} />
        <span>⭐ Avantajlı Məhsul</span>
      </label>
    </div>
    ${p ? `
    <div class="form-group">
      <label>Satış sayı (avtomatik hesablanır)</label>
      <input type="text" value="${p.sold_count || 0} ədəd${p.is_bestseller ? ' — 🏆 Ən Çox Satılan (avtomatik)' : ''}" readonly />
    </div>` : ''}
    <div class="form-group">
      <label>Ölçü</label>
      <input id="p-size-label" type="text" maxlength="30" placeholder="Məs: 20 ML, 50 ML, 100 ML, 250 q, 500 ml, 1 L, 2 kq"
        value="${p ? escapeHtml(p.size_label || '') : ''}" />
      <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Sərbəst mətn - istədiyiniz dəyəri yaza bilərsiniz. Bu ölçü məhsul səviyyəsində saxlanılır, bütün şəkillərə avtomatik tətbiq olunur (hər şəkil üçün ayrıca daxil etməyə ehtiyac yoxdur) və müştəri panelində məhsulun yanında göstərilir.</div>
    </div>
    <div class="form-group">
      <label>Şəkillər (maksimum ${MAX_PRODUCT_IMAGES})</label>
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">İlk şəkil məhsulun əsas (üz qabığı) şəkli olacaq. Hər şəkil üçün ayrıca Başlıq, Rəng adı, Rəng kodu, Ölçülər (məs: S, M, L, XL, XXL və ya 36, 37, 38...), Qısa təsvir, Xüsusiyyətlər, Tərkib, İstifadə qaydası və Qeydlər daxil edə bilərsiniz — bu məlumatlar şəkil dəyişdikdə avtomatik yenilənir və tam redaktə oluna bilir. Hər rəng üçün əlavə etdiyiniz ölçülər müştəri panelində həmin rəng seçildikdə seçim düymələri kimi göstəriləcək. Müştəri səbətə əlavə etməzdən əvvəl mütləq rəngi (varsa), sonra isə ölçünü (varsa) seçməlidir.</div>
      <div id="p-images-gallery" class="image-gallery"></div>
      <div class="form-row" style="align-items:flex-end;">
        <div class="form-group" style="flex:1;">
          <label>Şəkil Linki (Image URL)</label>
          <input id="p-image-url" type="text" placeholder="https://misal.com/sekil.jpg" onkeydown="if(event.key==='Enter'){event.preventDefault();addProductImageUrl();}" />
        </div>
        <button type="button" class="btn btn-secondary" onclick="addProductImageUrl()">Əlavə et</button>
      </div>
    </div>
    <button class="btn btn-primary" style="width:100%" onclick="saveProduct(${id || 'null'})">Yadda saxla</button>
  `);
  document.querySelector('#modal-overlay .modal').classList.add('modal-wide');
  renderProductImageGallery();
}

function renderProductImageGallery() {
  const container = document.getElementById('p-images-gallery');
  if (!container) return;
  if (state.productImageItems.length === 0) {
    container.innerHTML = '<div style="font-size:12px;color:var(--text-muted);">Şəkil seçilməyib.</div>';
    return;
  }
  container.innerHTML = state.productImageItems.map((item, idx) => `
    <div class="image-meta-card">
      <div class="image-meta-thumb" style="--img-ratio:${(item.aspect_ratio || '1:1').replace(':', '/')};">
        <img src="${item.url}" alt="" loading="lazy" decoding="async" />
        ${idx === 0 ? '<span class="cover-badge">Əsas</span>' : ''}
        <button type="button" class="thumb-remove" onclick="removeProductImage(${idx})">✕</button>
      </div>
      <div class="image-meta-fields">
        <div class="form-group">
          <label>Başlıqlar</label>
          <div class="dyn-field-list">
            ${item.titles.map((t, tIdx) => `
              <div class="dyn-field-row">
                <input type="text" placeholder="Məs: Ön görünüş" value="${escapeHtml(t)}" oninput="updateImageTitle(${idx},${tIdx},this.value)" />
                <button type="button" class="dyn-field-remove" title="Sil" onclick="removeImageTitle(${idx},${tIdx})">✕</button>
              </div>`).join('')}
          </div>
          <button type="button" class="btn btn-secondary btn-sm dyn-field-add" onclick="addImageTitle(${idx})">+ Başlıq əlavə et</button>
        </div>
        <div class="form-group">
          <label>Rənglər</label>
          <div class="dyn-field-list">
            ${item.colors.map((c, cIdx) => `
              <div class="dyn-field-row">
                <input type="color" value="${c.code || '#7c3aed'}" oninput="updateImageColor(${idx},${cIdx},'code',this.value)" style="width:44px;height:38px;padding:4px;flex:0 0 44px;" />
                <input type="text" placeholder="Məs: Qırmızı" value="${escapeHtml(c.name)}" oninput="updateImageColor(${idx},${cIdx},'name',this.value)" />
                <button type="button" class="dyn-field-remove" title="Sil" onclick="removeImageColor(${idx},${cIdx})">✕</button>
              </div>`).join('')}
          </div>
          <button type="button" class="btn btn-secondary btn-sm dyn-field-add" onclick="addImageColor(${idx})">+ Rəng əlavə et</button>
        </div>
        <div class="form-group">
          <label>Ölçülər və Stok Sayı (məs: S, M, L, XL, XXL və ya 36, 37, 38, 42, 43, 44)</label>
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">Bu şəkil/rəng üçün əlavə etdiyiniz ölçülər müştəri panelində bu rəng seçildikdə seçim düymələri kimi göstəriləcək. Hər ölçünün qarşısındakı sahədə həmin ölçüyə uyğun ayrıca stok sayını daxil edin.</div>
          <div id="p-image-sizes-${idx}" class="size-stock-list">${(item.sizes || []).map((s, sIdx) => `
            <div class="size-stock-row">
              <span class="size-stock-name">${escapeHtml(s.size)}</span>
              <input type="number" min="0" step="1" class="size-stock-qty" placeholder="Stok sayı" value="${Number(s.quantity) || 0}" oninput="updateImageSizeQuantity(${idx},${sIdx},this.value)" />
              <button type="button" class="dyn-field-remove" title="Sil" onclick="removeImageSize(${idx},${sIdx})">✕</button>
            </div>
          `).join('') || '<div style="font-size:12px;color:var(--text-muted);">Ölçü əlavə edilməyib.</div>'}</div>
          <div class="form-row" style="align-items:flex-end;">
            <div class="form-group" style="flex:1;">
              <input id="p-image-size-input-${idx}" type="text" placeholder="Məs: M" maxlength="20" onkeydown="if(event.key==='Enter'){event.preventDefault();addImageSize(${idx});}" />
            </div>
            <button type="button" class="btn btn-secondary" onclick="addImageSize(${idx})">Əlavə et</button>
          </div>
        </div>
        <div class="form-group"><label>Qısa təsvir</label><input type="text" placeholder="Bu şəkil haqqında qısa qeyd" value="${escapeHtml(item.description)}" oninput="updateProductImageField(${idx},'description',this.value)" /></div>
        <div class="form-group">
          <label>Şəkil ölçüsü (en:hündürlük nisbəti)</label>
          <select onchange="updateProductImageField(${idx},'aspect_ratio',this.value)">
            ${ASPECT_RATIO_OPTIONS.map((o) => `<option value="${o.value}" ${(item.aspect_ratio || '1:1') === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>Xüsusiyyətlər</label><textarea rows="2" placeholder="Bu şəkildəki məhsulun xüsusiyyətləri" oninput="updateProductImageField(${idx},'features',this.value)">${escapeHtml(item.features)}</textarea></div>
        <div class="form-group"><label>Tərkib</label><textarea rows="2" placeholder="Tərkib haqqında məlumat" oninput="updateProductImageField(${idx},'composition',this.value)">${escapeHtml(item.composition)}</textarea></div>
        <div class="form-group"><label>İstifadə qaydası</label><textarea rows="2" placeholder="Necə istifadə edilməlidir" oninput="updateProductImageField(${idx},'usage',this.value)">${escapeHtml(item.usage)}</textarea></div>
        <div class="form-group"><label>Qeydlər</label><textarea rows="2" placeholder="Əlavə qeydlər" oninput="updateProductImageField(${idx},'notes',this.value)">${escapeHtml(item.notes)}</textarea></div>
      </div>
    </div>
  `).join('');
}

function updateProductImageField(idx, field, value) {
  if (!state.productImageItems[idx]) return;
  state.productImageItems[idx][field] = value;
}

// ---- Şəklə aid dinamik Başlıq siyahısı ----
// Hər şəkil öz Başlıqlar siyahısını müstəqil idarə edir - "+" düyməsi yalnız
// klikləndiyi şəkil blokunun daxilinə yeni boş başlıq inputu əlavə edir.
function addImageTitle(imgIdx) {
  const item = state.productImageItems[imgIdx];
  if (!item) return;
  item.titles.push('');
  renderProductImageGallery();
}

function updateImageTitle(imgIdx, titleIdx, value) {
  const item = state.productImageItems[imgIdx];
  if (!item || !item.titles) return;
  item.titles[titleIdx] = value;
}

function removeImageTitle(imgIdx, titleIdx) {
  const item = state.productImageItems[imgIdx];
  if (!item || !item.titles) return;
  item.titles.splice(titleIdx, 1);
  renderProductImageGallery();
}

// ---- Şəklə aid dinamik Rəng siyahısı ----
// Hər şəkil öz Rənglər siyahısını müstəqil idarə edir - "+" düyməsi yalnız
// klikləndiyi şəkil blokunun daxilinə yeni boş rəng (ad + kod) girişi əlavə edir.
function addImageColor(imgIdx) {
  const item = state.productImageItems[imgIdx];
  if (!item) return;
  item.colors.push({ name: '', code: '#7c3aed' });
  renderProductImageGallery();
}

function updateImageColor(imgIdx, colorIdx, field, value) {
  const item = state.productImageItems[imgIdx];
  if (!item || !item.colors || !item.colors[colorIdx]) return;
  item.colors[colorIdx][field] = value;
}

function removeImageColor(imgIdx, colorIdx) {
  const item = state.productImageItems[imgIdx];
  if (!item || !item.colors) return;
  item.colors.splice(colorIdx, 1);
  renderProductImageGallery();
}

function removeProductImage(idx) {
  state.productImageItems.splice(idx, 1);
  renderProductImageGallery();
}

// ---- Şəklə (rəngə) aid dinamik Ölçü siyahısı ----
// Hər şəkil öz Ölçülər siyahısını müstəqil idarə edir - "+" düyməsi yalnız klikləndiyi
// şəkil/rəng blokunun daxilinə yeni ölçü əlavə edir (colors ilə eyni məntiq).
function addImageSize(imgIdx) {
  const item = state.productImageItems[imgIdx];
  if (!item) return;
  const input = document.getElementById(`p-image-size-input-${imgIdx}`);
  const value = (input && input.value || '').trim();
  if (!value) { toast('Zəhmət olmasa ölçü daxil edin.', true); return; }
  if (!item.sizes) item.sizes = [];
  if (item.sizes.some((s) => s.size.toLowerCase() === value.toLowerCase())) {
    toast('Bu ölçü artıq əlavə olunub.', true);
    return;
  }
  if (item.sizes.length >= 20) {
    toast('Bu rəng üçün maksimum 20 ölçü əlavə edə bilərsiniz.', true);
    return;
  }
  // Yeni ölçü stok sayı 0 ilə əlavə olunur - admin dərhal yanındakı sahədən uyğun sayı daxil edə bilər.
  item.sizes.push({ size: value, quantity: 0 });
  if (input) input.value = '';
  renderProductImageGallery();
}

function removeImageSize(imgIdx, sizeIdx) {
  const item = state.productImageItems[imgIdx];
  if (!item || !item.sizes) return;
  item.sizes.splice(sizeIdx, 1);
  renderProductImageGallery();
}

// Bir ölçünün qarşısındakı stok sayı (quantity) sahəsi dəyişəndə çağırılır - hər ölçü üçün
// ayrıca stok sayı təyin edilməsinə imkan verir.
function updateImageSizeQuantity(imgIdx, sizeIdx, value) {
  const item = state.productImageItems[imgIdx];
  if (!item || !item.sizes || !item.sizes[sizeIdx]) return;
  const qty = Math.max(0, Math.floor(Number(value)) || 0);
  item.sizes[sizeIdx].quantity = qty;
}

function isValidImageUrl(url) {
  return /^https?:\/\/.+/i.test(url) || /^\//.test(url);
}

function addProductImageUrl() {
  const input = document.getElementById('p-image-url');
  const url = (input.value || '').trim();
  if (!url) { toast('Zəhmət olmasa şəkil linkini daxil edin.', true); return; }
  if (!isValidImageUrl(url)) { toast('Düzgün bir link daxil edin (http:// və ya https:// ilə başlamalıdır).', true); return; }

  if (state.productImageItems.length >= MAX_PRODUCT_IMAGES) {
    toast(`Maksimum ${MAX_PRODUCT_IMAGES} şəkil əlavə edə bilərsiniz.`, true);
    return;
  }

  state.productImageItems.push({
    url, titles: [], colors: [], sizes: [], description: '',
    features: '', composition: '', usage: '', notes: '', aspect_ratio: '1:1'
  });
  input.value = '';
  renderProductImageGallery();
}

async function saveProduct(id) {
  const unitSelectValue = document.getElementById('p-unit-select').value;
  const unitCustomValue = document.getElementById('p-unit-custom').value.trim();
  const payload = {
    name: document.getElementById('p-name').value.trim(),
    description: document.getElementById('p-desc').value.trim(),
    category_id: document.getElementById('p-category').value ? Number(document.getElementById('p-category').value) : null,
    price: Number(document.getElementById('p-price').value),
    stock_quantity: Number(document.getElementById('p-stock').value),
    discount_percent: Number(document.getElementById('p-discount').value),
    // Könüllü sahələr - boş saxlansa endirimin bitmə vaxtı olmayacaq.
    discount_end_date: document.getElementById('p-discount-end-date').value || '',
    discount_end_time: document.getElementById('p-discount-end-time').value || '',
    size_label: document.getElementById('p-size-label').value.trim(),
    unit: unitSelectValue === '__other__' ? unitCustomValue : unitSelectValue,
    is_featured: document.getElementById('p-featured').checked,
    delivery_type: document.getElementById('p-delivery-type').value
  };
  if (!payload.name || isNaN(payload.price)) { toast('Ad və qiymət düzgün deyil.', true); return; }
  if (unitSelectValue === '__other__' && !unitCustomValue) { toast('Ölçü vahidini yazın və ya siyahıdan seçin.', true); return; }
  try {
    // Şəkillər artıq birbaşa link (URL) olaraq daxil edilir — sıranı saxlayaraq hər şəkil üçün
    // admin tərəfindən dinamik əlavə etdiyi Başlıqlar/Rənglər siyahıları və Qısa təsvir
    // məlumatları ilə birgə son siyahını qur. Hər şəkil öz siyahısını müstəqil saxlayır.
    const finalImages = state.productImageItems.map((item) => ({
      url: item.url,
      titles: (item.titles || []).map((t) => (t || '').trim()).filter(Boolean),
      colors: (item.colors || [])
        .map((c) => ({ name: (c.name || '').trim(), code: c.code || '' }))
        .filter((c) => c.name || c.code),
      sizes: (item.sizes || [])
        .map((s) => ({ size: (s.size || '').trim(), quantity: Math.max(0, Math.floor(Number(s.quantity)) || 0) }))
        .filter((s) => s.size),
      description: item.description || '',
      features: item.features || '',
      composition: item.composition || '',
      usage: item.usage || '',
      notes: item.notes || '',
      aspect_ratio: item.aspect_ratio || '1:1'
    }));
    payload.images = finalImages;
    payload.image_url = (finalImages[0] && finalImages[0].url) || '';
    // Köhnə (top-level) `sizes` sahəsi - geriyə uyğunluq üçün bütün şəkillərin ölçülərinin
    // birləşməsi kimi saxlanılır (real seçim indi hər şəkil/rəngin öz siyahısından gəlir).
    payload.sizes = [...new Set(finalImages.flatMap((img) => img.sizes.map((s) => s.size)))];

    if (id) await apiFetch(`/products/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    else await apiFetch('/products', { method: 'POST', body: JSON.stringify(payload) });
    state.productImageItems = [];
    closeModal(); toast('Məhsul yadda saxlanıldı.'); loadProducts();
  } catch (err) { toast(err.message, true); }
}

async function deleteProduct(id) {
  if (!confirm('Bu məhsul bazadan həmişəlik silinəcək və geri qaytarıla bilməyəcək. Silmək istədiyinizə əminsiniz?')) return;
  try {
    await apiFetch(`/products/${id}`, { method: 'DELETE' });
    toast('Məhsul bazadan silindi.'); loadProducts();
  } catch (err) { toast(err.message, true); }
}

// ---------- Anbar və Maya Dəyəri ----------
function profitClass(profit) {
  return Number(profit) < 0 ? 'profit-negative' : 'profit-positive';
}

async function loadWarehouse() {
  if (state.products.length === 0) state.products = await apiFetch('/products');
  try {
    state.warehouse = await apiFetch('/warehouse');
  } catch (err) {
    toast(err.message, true);
    return;
  }

  const tbody = document.getElementById('warehouse-tbody');
  tbody.innerHTML = state.warehouse.map((w) => {
    const l = w.latest;
    return `
      <tr>
        <td><img src="${w.product_image || ''}" alt="" loading="lazy" decoding="async" /></td>
        <td>${escapeHtml(w.product_name)}</td>
        <td>${l ? l.purchase_price.toFixed(2) + ' ₼' : '—'}</td>
        <td>${l ? l.cargo_cost.toFixed(2) + ' ₼' : '—'}</td>
        <td>${l ? l.other_costs.toFixed(2) + ' ₼' : '—'}</td>
        <td>${l ? '<b>' + l.total_cost.toFixed(2) + ' ₼</b>' : '—'}</td>
        <td>${l ? l.sale_price.toFixed(2) + ' ₼' : '—'}</td>
        <td>${l ? `<span class="${profitClass(l.profit)}">${l.profit.toFixed(2)} ₼</span>` : '—'}</td>
        <td>${l ? `<span class="${profitClass(l.profit)}">${l.profit_percent.toFixed(1)}%</span>` : '—'}</td>
        <td style="display:flex;gap:6px;flex-wrap:wrap;">
          <button class="btn btn-secondary btn-sm" onclick="openWarehouseModal(${w.product_id})">Yeni qeyd</button>
          <button class="btn btn-secondary btn-sm" onclick="openWarehouseHistoryModal(${w.product_id})">Tarixçə (${w.history_count})</button>
        </td>
      </tr>`;
  }).join('') || '<tr><td colspan="10">Məhsul yoxdur.</td></tr>';
}

function openWarehouseModal(productId) {
  const productOptions = state.products
    .filter((p) => p.status !== 'archived')
    .map((p) => `<option value="${p.id}" ${productId === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`)
    .join('');

  openModal('Maya dəyəri əlavə et', `
    <div class="form-group">
      <label>Məhsul seç</label>
      <select id="w-product">${productOptions}</select>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Alış qiyməti (₼)</label><input id="w-purchase" type="number" step="0.01" min="0" value="0" oninput="calcWarehousePreview()" /></div>
      <div class="form-group"><label>Karqo (gəliş) xərci (₼)</label><input id="w-cargo" type="number" step="0.01" min="0" value="0" oninput="calcWarehousePreview()" /></div>
    </div>
    <div class="form-group"><label>Digər xərclər (₼)</label><input id="w-other" type="number" step="0.01" min="0" value="0" oninput="calcWarehousePreview()" /></div>
    <div class="form-group">
      <label>Ümumi maya dəyəri (avtomatik)</label>
      <input id="w-total" type="text" value="0.00 ₼" readonly />
    </div>
    <div class="form-group"><label>Satış qiyməti (₼)</label><input id="w-sale" type="number" step="0.01" min="0" value="0" oninput="calcWarehousePreview()" /></div>
    <div class="form-row">
      <div class="form-group">
        <label>Mənfəət (avtomatik)</label>
        <input id="w-profit" type="text" value="0.00 ₼" readonly />
      </div>
      <div class="form-group">
        <label>Mənfəət faizi (avtomatik)</label>
        <input id="w-profit-percent" type="text" value="0.0%" readonly />
      </div>
    </div>
    <div class="calc-hint">Ümumi maya dəyəri = Alış qiyməti + Karqo xərci + Digər xərclər. Mənfəət = Satış qiyməti − Ümumi maya dəyəri.</div>
    <button class="btn btn-primary" style="width:100%;margin-top:14px;" onclick="saveWarehouseCost()">Yadda saxla</button>
  `);
  calcWarehousePreview();
}

function calcWarehousePreview() {
  const purchase = Number(document.getElementById('w-purchase').value) || 0;
  const cargo = Number(document.getElementById('w-cargo').value) || 0;
  const other = Number(document.getElementById('w-other').value) || 0;
  const sale = Number(document.getElementById('w-sale').value) || 0;

  const totalCost = purchase + cargo + other;
  const profit = sale - totalCost;
  const profitPercent = totalCost > 0 ? (profit / totalCost) * 100 : 0;

  document.getElementById('w-total').value = `${totalCost.toFixed(2)} ₼`;
  const profitInput = document.getElementById('w-profit');
  const profitPercentInput = document.getElementById('w-profit-percent');
  profitInput.value = `${profit.toFixed(2)} ₼`;
  profitPercentInput.value = `${profitPercent.toFixed(1)}%`;
  profitInput.style.color = profit < 0 ? 'var(--danger)' : 'var(--success)';
  profitPercentInput.style.color = profit < 0 ? 'var(--danger)' : 'var(--success)';
}

async function saveWarehouseCost() {
  const payload = {
    product_id: Number(document.getElementById('w-product').value),
    purchase_price: Number(document.getElementById('w-purchase').value),
    cargo_cost: Number(document.getElementById('w-cargo').value),
    other_costs: Number(document.getElementById('w-other').value),
    sale_price: Number(document.getElementById('w-sale').value)
  };
  if (!payload.product_id || isNaN(payload.purchase_price) || isNaN(payload.sale_price)) {
    toast('Məhsul, alış qiyməti və satış qiyməti düzgün deyil.', true);
    return;
  }
  try {
    await apiFetch('/warehouse', { method: 'POST', body: JSON.stringify(payload) });
    closeModal();
    toast('Maya dəyəri yadda saxlanıldı.');
    loadWarehouse();
  } catch (err) { toast(err.message, true); }
}

async function openWarehouseHistoryModal(productId) {
  state.warehouseHistoryProductId = productId;
  const product = state.products.find((p) => p.id === productId);
  let history = [];
  try {
    history = await apiFetch(`/warehouse/${productId}/history`);
  } catch (err) {
    toast(err.message, true);
    return;
  }

  const rows = history.map((h) => `
    <tr>
      <td>${new Date(h.created_at).toLocaleString('az-AZ')}</td>
      <td>${h.purchase_price.toFixed(2)} ₼</td>
      <td>${h.cargo_cost.toFixed(2)} ₼</td>
      <td>${h.other_costs.toFixed(2)} ₼</td>
      <td><b>${h.total_cost.toFixed(2)} ₼</b></td>
      <td>${h.sale_price.toFixed(2)} ₼</td>
      <td><span class="${profitClass(h.profit)}">${h.profit.toFixed(2)} ₼</span></td>
      <td><span class="${profitClass(h.profit)}">${h.profit_percent.toFixed(1)}%</span></td>
      <td><button class="btn btn-danger btn-sm" onclick="deleteWarehouseCost(${h.id}, ${productId})">Sil</button></td>
    </tr>`).join('') || '<tr><td colspan="9">Hələ heç bir qeyd yoxdur.</td></tr>';

  openModal(`Tarixçə — ${product ? escapeHtml(product.name) : ''}`, `
    <div style="max-height:60vh;overflow-y:auto;">
      <table class="data-table">
        <thead><tr>
          <th>Tarix</th><th>Alış</th><th>Karqo</th><th>Digər</th><th>Ümumi maya</th>
          <th>Satış</th><th>Mənfəət</th><th>Mənfəət (%)</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `);
  document.querySelector('#modal-overlay .modal').classList.add('modal-wide');
}

async function deleteWarehouseCost(id, productId) {
  if (!confirm('Bu qeydi tarixçədən silmək istədiyinizə əminsiniz?')) return;
  try {
    await apiFetch(`/warehouse/${id}`, { method: 'DELETE' });
    toast('Qeyd silindi.');
    openWarehouseHistoryModal(productId);
    loadWarehouse();
  } catch (err) { toast(err.message, true); }
}

// ---------- Ödəniş Məlumatları (Kartdan-karta) ----------
async function loadPaymentSettings() {
  try {
    const info = await apiFetch('/payment-settings');
    document.getElementById('ps-holder-name').value = info.holder_name || '';
    document.getElementById('ps-bank-name').value = info.bank_name || '';
    document.getElementById('ps-card-number').value = info.card_number || '';
    document.getElementById('ps-whatsapp-number').value = info.whatsapp_number || '';
  } catch (err) {
    toast(err.message, true);
  }
}

async function savePaymentSettings() {
  const payload = {
    holder_name: document.getElementById('ps-holder-name').value.trim(),
    bank_name: document.getElementById('ps-bank-name').value.trim(),
    card_number: document.getElementById('ps-card-number').value.trim(),
    whatsapp_number: document.getElementById('ps-whatsapp-number').value.trim()
  };
  try {
    await apiFetch('/payment-settings', { method: 'PUT', body: JSON.stringify(payload) });
    toast('Ödəniş məlumatları yadda saxlanıldı.');
  } catch (err) {
    toast(err.message, true);
  }
}

// ---------- Təhvilalma Ünvanı (Google Maps) ----------
async function loadDeliverySettings() {
  try {
    const info = await apiFetch('/delivery-settings');
    document.getElementById('ds-maps-link').value = info.maps_link || '';
  } catch (err) {
    toast(err.message, true);
  }
}

async function saveDeliverySettings() {
  const payload = {
    maps_link: document.getElementById('ds-maps-link').value.trim()
  };
  try {
    await apiFetch('/delivery-settings', { method: 'PUT', body: JSON.stringify(payload) });
    toast('Təhvilalma ünvanı yadda saxlanıldı.');
  } catch (err) {
    toast(err.message, true);
  }
}

// ---------- Səs Bildirişləri (səbət, bildiriş, dəstək söhbəti) ----------
let cartSoundPendingDataUrl = null;

async function loadCartSoundSettings() {
  cartSoundPendingDataUrl = null;
  document.getElementById('css-file').value = '';
  try {
    const info = await apiFetch('/sound-settings');
    document.getElementById('css-enabled').checked = info.enabled !== false;
    document.getElementById('css-volume').value = info.volume ?? 70;
    document.getElementById('css-volume-val').textContent = info.volume ?? 70;
    document.getElementById('css-current-url').textContent = info.sound_url || '—';
  } catch (err) {
    toast(err.message, true);
  }
}

function onCartSoundFileSelected(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    toast('Səs faylı 2MB-dan böyük ola bilməz.', true);
    event.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    cartSoundPendingDataUrl = reader.result;
    toast('Fayl seçildi - dəyişikliyi tətbiq etmək üçün "Yadda saxla" düyməsinə basın.');
  };
  reader.readAsDataURL(file);
}

async function saveCartSoundSettings() {
  try {
    if (cartSoundPendingDataUrl) {
      await apiFetch('/sound-settings/upload', {
        method: 'POST',
        body: JSON.stringify({ audio: cartSoundPendingDataUrl })
      });
      cartSoundPendingDataUrl = null;
      document.getElementById('css-file').value = '';
    }
    const payload = {
      enabled: document.getElementById('css-enabled').checked,
      volume: Number(document.getElementById('css-volume').value)
    };
    const saved = await apiFetch('/sound-settings', { method: 'PUT', body: JSON.stringify(payload) });
    document.getElementById('css-current-url').textContent = saved.sound_url || '—';
    toast('Səbət səs effekti ayarları yadda saxlanıldı.');
  } catch (err) {
    toast(err.message, true);
  }
}

function testCartSound() {
  const url = cartSoundPendingDataUrl || document.getElementById('css-current-url').textContent;
  if (!url || url === '—') { toast('Test ediləcək səs faylı tapılmadı.', true); return; }
  const volume = Number(document.getElementById('css-volume').value) / 100;
  const audio = new Audio(url);
  audio.volume = Math.min(Math.max(volume, 0), 1);
  audio.play().catch(() => toast('Səs oxudula bilmədi.', true));
}

// ---------- Footer / Əlaqə Məlumatları (Haqqımızda + Əlaqə) ----------
async function loadCompanyInfo() {
  try {
    const info = await apiFetch('/company-info');
    document.getElementById('ci-about-text').value = info.about_text || '';
    document.getElementById('ci-contact-email').value = info.contact_email || '';
    document.getElementById('ci-contact-phone').value = info.contact_phone || '';
    document.getElementById('ci-contact-address').value = info.contact_address || '';
  } catch (err) {
    toast(err.message, true);
  }
}

async function saveCompanyInfo() {
  const payload = {
    about_text: document.getElementById('ci-about-text').value.trim(),
    contact_email: document.getElementById('ci-contact-email').value.trim(),
    contact_phone: document.getElementById('ci-contact-phone').value.trim(),
    contact_address: document.getElementById('ci-contact-address').value.trim()
  };
  try {
    await apiFetch('/company-info', { method: 'PUT', body: JSON.stringify(payload) });
    toast('Footer məlumatları yadda saxlanıldı.');
  } catch (err) {
    toast(err.message, true);
  }
}

// ---------- Sifarişlər ----------
function paymentMethodLabel(method) {
  return 'Kartdan-karta';
}

async function loadOrders() {
  const [orders, customers] = await Promise.all([apiFetch('/orders'), apiFetch('/auth/users')]);
  state.orders = orders;
  state.customers = customers;
  populateOrderStatusFilter();
  renderOrders();
}

function populateOrderStatusFilter() {
  const select = document.getElementById('orders-filter-status');
  if (!select) return;
  const current = select.value;
  const allStatuses = [...STATUS_OPTIONS, PENDING_TRANSFER_STATUS, CANCELLED_STATUS];
  select.innerHTML = '<option value="">Bütün statuslar</option>' +
    allStatuses.map((s) => `<option value="${s}">${s}</option>`).join('');
  if (current && allStatuses.includes(current)) select.value = current;
}

function debouncedRenderOrders() {
  clearTimeout(state.ordersSearchTimer);
  state.ordersSearchTimer = setTimeout(renderOrders, 250);
}

function resetOrderFilters() {
  document.getElementById('orders-search').value = '';
  document.getElementById('orders-filter-date-start').value = '';
  document.getElementById('orders-filter-date-end').value = '';
  document.getElementById('orders-filter-status').value = '';
  renderOrders();
}

// Cari filtrlərə (axtarış, tarix aralığı, status) əsasən sifarişlər siyahısını qaytarır.
// Həm cədvəl render-i, həm də PDF ixracı eyni funksiyadan istifadə edir ki, ekranda
// görünən nəticə ilə PDF-ə düşən nəticə həmişə üst-üstə düşsün.
function getFilteredOrders() {
  const q = (document.getElementById('orders-search')?.value || '').trim().toLowerCase();
  const dateStart = document.getElementById('orders-filter-date-start')?.value || '';
  const dateEnd = document.getElementById('orders-filter-date-end')?.value || '';
  const statusFilter = document.getElementById('orders-filter-status')?.value || '';

  let list = [...state.orders];

  if (q) {
    list = list.filter((o) => {
      const customer = state.customers.find((c) => c.id === o.user_id);
      const customerLabel = customer ? `${customer.name} ${customer.surname || ''}`.trim() : '';
      const productNames = (o.items || []).map((i) => i.product_name || '').join(' ');
      const haystack = `${o.code || ''} ${customerLabel} ${productNames}`.toLowerCase();
      return haystack.includes(q);
    });
  }
  if (statusFilter) list = list.filter((o) => o.status === statusFilter);
  if (dateStart) {
    const startTime = new Date(dateStart + 'T00:00:00').getTime();
    list = list.filter((o) => o.created_at && new Date(o.created_at).getTime() >= startTime);
  }
  if (dateEnd) {
    const endTime = new Date(dateEnd + 'T23:59:59.999').getTime();
    list = list.filter((o) => o.created_at && new Date(o.created_at).getTime() <= endTime);
  }

  list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return list;
}

function renderOrders() {
  const tbody = document.getElementById('orders-tbody');
  if (!tbody) return;
  const filtered = getFilteredOrders();
  tbody.innerHTML = filtered.map((o, idx) => {
    const methodLabel = paymentMethodLabel(o.payment_method);
    const isPaid = o.payment_status === 'ödənildi';
    const isPendingTransfer = o.status === PENDING_TRANSFER_STATUS;
    const customer = state.customers.find((c) => c.id === o.user_id);
    const customerLabel = customer ? `${customer.name} ${customer.surname || ''}`.trim() : `İstifadəçi #${o.user_id}`;
    return `
    <tr>
      <td>${idx + 1}</td>
      <td>#${o.id}</td>
      <td>${o.code || '—'}</td>
      <td>
        <div style="display:flex;align-items:center;gap:8px;">
          ${customer && customer.avatar_url
            ? `<img src="${customer.avatar_url}" alt="" style="width:26px;height:26px;border-radius:50%;object-fit:cover;" loading="lazy" decoding="async" />`
            : ''}
          <span>${customerLabel}</span>
        </div>
      </td>
      <td>
        <div class="order-items-cell">
          ${(o.items || []).map((i) => {
            const variantParts = [i.color_name, i.size].filter(Boolean).join(' · ');
            return `<div class="order-item-line">
              ${i.image_url ? `<img src="${i.image_url}" alt="" loading="lazy" decoding="async" />` : ''}
              <span>${escapeHtml(i.product_name)}${variantParts ? ` <span class="order-item-variant">(${escapeHtml(variantParts)})</span>` : ''} × ${i.quantity}</span>
            </div>`;
          }).join('') || '<span style="color:var(--text-muted);font-size:12px;">—</span>'}
        </div>
      </td>
      <td>${new Date(o.created_at).toLocaleString('az-AZ')}</td>
      <td>${o.total_price.toFixed(2)} ₼</td>
      <td>
        <span class="pay-tag ${isPaid ? 'paid' : 'pending'}">${methodLabel} · ${o.payment_status}</span>
        ${!isPaid && o.status !== CANCELLED_STATUS ? `<button class="btn btn-secondary btn-sm" onclick="confirmTransferPayment(${o.id})">Ödənişi təsdiqlə</button>` : ''}
      </td>
      <td>
        <span class="tag ${o.status === CANCELLED_STATUS ? 'tag-inactive' : isPendingTransfer ? 'tag-pending' : 'tag-active'}">${o.status}</span>
        ${o.status === CANCELLED_STATUS && o.cancellation_reason ? `
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px;max-width:200px;">
            Səbəb: ${escapeHtml(o.cancellation_reason)}${o.cancelled_by ? ` (${o.cancelled_by === 'admin' ? 'admin' : 'müştəri'})` : ''}
          </div>` : ''}
      </td>
      <td>
        ${o.delivery_address
          ? `<button class="btn btn-secondary btn-sm" onclick="viewOrderAddress(${o.id})">Bax</button>`
          : '<span style="color:var(--text-muted);font-size:12px;">—</span>'}
      </td>
      <td>
        ${o.status === CANCELLED_STATUS ? `<span style="color:var(--text-muted);font-size:12px;">—</span>` : isPendingTransfer ? `
        <span style="color:var(--text-muted);font-size:12px;">Ödəniş təsdiqlənənədək gözləyir</span><br/>
        <button class="btn btn-danger btn-sm" onclick="openCancelOrderModal(${o.id})">Ləğv et</button>` : `
        <select class="status-select" id="status-${o.id}">
          ${STATUS_OPTIONS.map((s) => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
        <button class="btn btn-primary btn-sm" onclick="updateOrderStatus(${o.id})">Yenilə</button>
        <button class="btn btn-danger btn-sm" onclick="openCancelOrderModal(${o.id})">Ləğv et</button>`}
      </td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="printOrderInvoice(${o.id})">PDF çap et</button>
      </td>
      <td>
        <button class="btn btn-danger btn-sm" onclick="deleteOrder(${o.id})">Sil</button>
      </td>
    </tr>
  `;
  }).join('') || '<tr><td colspan="13">Sifariş yoxdur.</td></tr>';
}

// Sifariş qəbzini yeni pəncərədə açır və çap dialoqunu göstərir (admin "PDF olaraq saxla" seçə bilər)
function printOrderInvoice(orderId) {
  const order = (state.orders || []).find((o) => o.id === orderId);
  if (!order) { toast('Sifariş tapılmadı.', true); return; }
  const customer = (state.customers || []).find((c) => c.id === order.user_id);
  const customerLabel = customer ? `${customer.name} ${customer.surname || ''}`.trim() : `İstifadəçi #${order.user_id}`;

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

  const addr = order.delivery_address
    ? ADDRESS_FIELD_ORDER.filter((f) => order.delivery_address[f]).map((f) => `${ADDRESS_FIELD_LABELS[f]}: ${order.delivery_address[f]}`).join(', ')
    : '';

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
          <div class="muted">Sifariş qəbzi (Admin)</div>
        </div>
        <div style="text-align:right;">
          <div><b>Sifariş kodu:</b> ${order.code || '—'}</div>
          <div class="muted">ID: #${order.id}</div>
          <div class="muted">${new Date(order.created_at).toLocaleString('az-AZ')}</div>
        </div>
      </div>
      <div class="box">
        <div><b>Müştəri:</b> ${customerLabel}${customer && customer.email ? ` (${customer.email})` : ''}</div>
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

// Filtrlənmiş (axtarış/tarix/status) sifarişlər siyahısını yeni pəncərədə cədvəl
// şəklində açır və çap dialoqunu göstərir - admin "PDF olaraq saxla" seçərək yükləyə bilər.
function exportOrdersPDF() {
  const filtered = getFilteredOrders();
  if (filtered.length === 0) { toast('Filtrə uyğun sifariş tapılmadı.', true); return; }

  const rows = filtered.map((o, idx) => {
    const customer = state.customers.find((c) => c.id === o.user_id);
    const customerLabel = customer ? `${customer.name} ${customer.surname || ''}`.trim() : `İstifadəçi #${o.user_id}`;
    const productNames = (o.items || []).map((i) => `${i.product_name} × ${i.quantity}`).join(', ');
    return `
    <tr>
      <td>${idx + 1}</td>
      <td>#${o.id}</td>
      <td>${o.code || '—'}</td>
      <td>${customerLabel}</td>
      <td>${productNames || '—'}</td>
      <td>${new Date(o.created_at).toLocaleString('az-AZ')}</td>
      <td style="text-align:right;">${o.total_price.toFixed(2)} ₼</td>
      <td>${o.payment_status}</td>
      <td>${o.status}</td>
    </tr>`;
  }).join('');

  const grandTotal = filtered.reduce((sum, o) => sum + o.total_price, 0);

  const search = document.getElementById('orders-search')?.value || '';
  const dateStart = document.getElementById('orders-filter-date-start')?.value || '';
  const dateEnd = document.getElementById('orders-filter-date-end')?.value || '';
  const statusFilter = document.getElementById('orders-filter-status')?.value || '';
  const filterParts = [];
  if (search) filterParts.push(`Axtarış: "${search}"`);
  if (dateStart) filterParts.push(`Başlanğıc: ${dateStart}`);
  if (dateEnd) filterParts.push(`Bitmə: ${dateEnd}`);
  if (statusFilter) filterParts.push(`Status: ${statusFilter}`);
  const filterLabel = filterParts.length ? filterParts.join(' · ') : 'Bütün sifarişlər';

  const win = window.open('', '_blank', 'width=1000,height=900');
  if (!win) { toast('Pop-up bloklandı. Zəhmət olmasa bu sayt üçün pop-up-lara icazə verin.', true); return; }

  win.document.write(`
    <!DOCTYPE html>
    <html lang="az">
    <head>
      <meta charset="UTF-8" />
      <title>Sifarişlər — Trendora</title>
      <style>
        body { font-family: Arial, Helvetica, sans-serif; color: #222; padding: 32px; }
        h1 { margin: 0 0 4px; font-size: 22px; }
        .muted { color: #666; font-size: 13px; }
        .head-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; border-bottom: 2px solid #222; padding-bottom: 14px; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { border: 1px solid #ddd; padding: 8px 10px; font-size: 12px; }
        th { background: #f4f4f4; text-align: left; }
        .total-row td { font-weight: 700; }
        @media print { body { padding: 0; } }
      </style>
    </head>
    <body>
      <div class="head-row">
        <div>
          <h1>Trendora</h1>
          <div class="muted">Sifarişlər siyahısı (Admin)</div>
        </div>
        <div style="text-align:right;">
          <div class="muted">${filterLabel}</div>
          <div class="muted">Yaradılma tarixi: ${new Date().toLocaleString('az-AZ')}</div>
          <div class="muted">Say: ${filtered.length}</div>
        </div>
      </div>
      <table>
        <thead>
          <tr><th>№</th><th>ID</th><th>Kod</th><th>Müştəri</th><th>Məhsullar</th><th>Tarix</th><th style="text-align:right;">Yekun</th><th>Ödəniş</th><th>Status</th></tr>
        </thead>
        <tbody>
          ${rows}
          <tr class="total-row"><td colspan="6" style="text-align:right;">Ümumi məbləğ:</td><td style="text-align:right;">${grandTotal.toFixed(2)} ₼</td><td colspan="2"></td></tr>
        </tbody>
      </table>
    </body>
    </html>
  `);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 300);
}

function viewOrderAddress(orderId) {
  const order = state.orders.find((o) => o.id === orderId);
  const addr = order && order.delivery_address;
  if (!addr) { toast('Bu sifariş üçün ünvan qeyd olunmayıb.', true); return; }
  const rows = ADDRESS_FIELD_ORDER
    .filter((f) => addr[f])
    .map((f) => `<div class="profile-row"><span>${ADDRESS_FIELD_LABELS[f]}</span><span>${addr[f]}</span></div>`)
    .join('');
  openModal(`Sifariş #${orderId} — Çatdırılma ünvanı`, `<div class="profile-card" style="margin:0;max-width:100%;">${rows}</div>`);
}

function genderLabel(g) {
  return { 'kişi': 'Kişi', 'qadın': 'Qadın', 'bildirmək istəmirəm': 'Bildirmək istəmirəm' }[g] || '—';
}

// ---------- Müştərilər ----------
async function loadCustomers() {
  state.customers = await apiFetch('/auth/users');
  const tbody = document.getElementById('customers-tbody');
  tbody.innerHTML = state.customers.map((c) => `
    <tr>
      <td>${c.avatar_url
        ? `<img src="${c.avatar_url}" alt="" style="width:36px;height:36px;border-radius:50%;object-fit:cover;" loading="lazy" decoding="async" />`
        : `<div style="width:36px;height:36px;border-radius:50%;background:var(--accent-soft);color:var(--accent);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;">${((c.name || '')[0] || '') + ((c.surname || '')[0] || '')}</div>`}
      </td>
      <td>${c.name} ${c.surname || ''}</td>
      <td>${c.email}</td>
      <td>${c.phone || '—'}</td>
      <td>${c.birth_date ? new Date(c.birth_date).toLocaleDateString('az-AZ') : '—'}</td>
      <td>${genderLabel(c.gender)}</td>
      <td>${new Date(c.created_at).toLocaleDateString('az-AZ')}</td>
      <td><button class="btn btn-secondary btn-sm" onclick="forceLogoutCustomer(${c.id})">Sessiyanı ləğv et</button></td>
    </tr>
  `).join('') || '<tr><td colspan="8">Müştəri yoxdur.</td></tr>';
}

// Müştərinin cari sessiyasını (əlindəki tokeni) ləğv edir - növbəti sorğuda
// avtomatik çıxarılır və yenidən daxil olmalıdır. Hesabı silmir/deaktiv etmir.
async function forceLogoutCustomer(id) {
  if (!confirm('Bu müştərinin cari sessiyasını ləğv etmək istədiyinizə əminsiniz? Müştəri yenidən daxil olmalı olacaq.')) return;
  try {
    await apiFetch(`/auth/users/${id}/force-logout`, { method: 'PATCH' });
    toast('Müştərinin sessiyası ləğv edildi.');
  } catch (err) { toast(err.message, true); }
}

// Kartdan-karta (bank köçürməsi) ilə verilmiş sifarişin ödənişini admin təsdiqləyir -
// bundan sonra sifariş emala başlayır, stokdan məhsul çıxılır və maliyyə hesabatına daxil olur.
async function confirmTransferPayment(orderId) {
  if (!confirm('Bu sifariş üçün kartdan-karta köçürməsinin bank hesabına daxil olduğunu təsdiqləyirsiniz? Təsdiqdən sonra sifariş emala başlayacaq.')) return;
  try {
    await apiFetch(`/orders/${orderId}/confirm-transfer`, { method: 'PATCH' });
    toast(`Sifariş #${orderId} ödənişi təsdiqləndi, emala başladı.`);
    loadOrders();
  } catch (err) { toast(err.message, true); }
}

// Sifarişi ləğv etmək üçün modal açır - səbəb yazılması məcburidir, müştəri bunu görəcək
function openCancelOrderModal(orderId) {
  openModal(`Sifariş #${orderId} — Ləğv et`, `
    <div class="form-group">
      <label>Ləğv səbəbi (məcburidir, müştəriyə göstəriləcək) *</label>
      <textarea id="cancel-reason-${orderId}" rows="3" placeholder="Məs: Məhsul stokda bitib." style="width:100%;"></textarea>
    </div>
    <div style="margin-top:12px;display:flex;justify-content:flex-end;gap:8px;">
      <button class="btn btn-secondary btn-sm" onclick="closeModal()">İmtina</button>
      <button class="btn btn-danger btn-sm" onclick="submitCancelOrder(${orderId})">Sifarişi ləğv et</button>
    </div>
  `);
}

async function submitCancelOrder(orderId) {
  const noteEl = document.getElementById(`cancel-reason-${orderId}`);
  const note = (noteEl ? noteEl.value : '').trim();
  if (!note) {
    toast('Ləğv səbəbini qısaca qeyd etməlisiniz.', true);
    return;
  }
  try {
    await apiFetch(`/orders/${orderId}/cancel`, { method: 'PATCH', body: JSON.stringify({ note }) });
    toast(`Sifariş #${orderId} ləğv edildi. Müştəri səbəbi öz panelində görəcək.`);
    closeModal();
    loadOrders();
  } catch (err) {
    toast(err.message, true);
  }
}

async function updateOrderStatus(orderId) {
  const status = document.getElementById(`status-${orderId}`).value;
  try {
    await apiFetch(`/orders/${orderId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
    toast(`Sifariş #${orderId} statusu "${status}" olaraq yeniləndi. Müştəri paneldə görəcək.`);
    loadOrders();
  } catch (err) { toast(err.message, true); }
}

// Sifarişi bazadan həmişəlik silir (sətirləri və status tarixçəsi ilə birlikdə). Statusu
// dəyişməkdən/ləğv etməkdən fərqli olaraq geri qaytarıla bilməz.
async function deleteOrder(orderId) {
  if (!confirm(`#${orderId} nömrəli sifariş bazadan həmişəlik silinəcək və geri qaytarıla bilməyəcək. Silmək istədiyinizə əminsiniz?`)) return;
  try {
    await apiFetch(`/orders/${orderId}`, { method: 'DELETE' });
    toast(`Sifariş #${orderId} silindi.`);
    loadOrders();
  } catch (err) { toast(err.message, true); }
}

// Cari filtrə uyğun bütün sifarişləri bazadan həmişəlik silir ("Sifarişləri təmizlə").
async function clearFilteredOrders() {
  const filtered = getFilteredOrders();
  if (filtered.length === 0) { toast('Filtrə uyğun sifariş tapılmadı.', true); return; }
  if (!confirm(`Filtrə uyğun ${filtered.length} sifariş bazadan həmişəlik silinəcək və geri qaytarıla bilməyəcək. Davam edilsin?`)) return;
  try {
    for (const o of filtered) {
      await apiFetch(`/orders/${o.id}`, { method: 'DELETE' });
    }
    toast(`${filtered.length} sifariş silindi.`);
    loadOrders();
  } catch (err) { toast(err.message, true); }
}

// ---------- Söhbətlər ----------
function startChatListPolling() {
  stopChatListPolling();
  state.chatListPollTimer = setInterval(loadConversations, 5000);
}
function stopChatListPolling() {
  if (state.chatListPollTimer) { clearInterval(state.chatListPollTimer); state.chatListPollTimer = null; }
}

function startChatMsgPolling() {
  stopChatMsgPolling();
  state.chatMsgPollTimer = setInterval(loadActiveChatMessages, 3000);
}
function stopChatMsgPolling() {
  if (state.chatMsgPollTimer) { clearInterval(state.chatMsgPollTimer); state.chatMsgPollTimer = null; }
}

function startChatBadgePolling() {
  stopChatBadgePolling();
  pollChatBadge();
  state.chatBadgeTimer = setInterval(pollChatBadge, 8000);
}
function stopChatBadgePolling() {
  if (state.chatBadgeTimer) { clearInterval(state.chatBadgeTimer); state.chatBadgeTimer = null; }
}

async function pollChatBadge() {
  if (!state.token) return;
  try {
    const data = await apiFetch('/chat/unread-count');
    const badge = document.getElementById('admin-chat-badge');
    if (data.total > 0) { badge.textContent = data.total; badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');
  } catch (err) { console.warn('Söhbət bildiriş xətası:', err.message); }
}

function conversationInitials(c) {
  return (((c.name || '')[0] || '') + ((c.surname || '')[0] || '')).toUpperCase() || '?';
}

function closeMobileChatPanel() {
  document.getElementById('chat-layout')?.classList.remove('mobile-chat-open');
}

async function loadConversations() {
  try {
    state.chatConversations = await apiFetch('/chat/conversations');
  } catch (err) {
    console.warn('Söhbət siyahısı xətası:', err.message);
    return;
  }
  const list = document.getElementById('chat-conversations');
  if (!list) return;

  if (state.chatConversations.length === 0) {
    list.innerHTML = '<div class="empty-state">Hələ müştəri yoxdur.</div>';
    return;
  }

  list.innerHTML = state.chatConversations.map((c) => {
    const preview = c.last_message
      ? `${c.last_message.sender === 'admin' ? 'Siz: ' : ''}${escapeHtml(c.last_message.text)}`
      : 'Hələ mesaj yoxdur';
    const time = c.last_message ? new Date(c.last_message.created_at).toLocaleDateString('az-AZ') : '';
    return `
      <div class="chat-conv-item ${state.chatActiveUserId === c.user_id ? 'active' : ''}" onclick="openConversation(${c.user_id})">
        ${c.avatar_url
          ? `<img class="chat-conv-avatar" src="${c.avatar_url}" alt="" loading="lazy" decoding="async" />`
          : `<div class="chat-conv-avatar">${conversationInitials(c)}</div>`}
        <div class="chat-conv-info">
          <div class="chat-conv-name">
            <span>${escapeHtml(c.name)} ${escapeHtml(c.surname)}</span>
            <span class="chat-conv-time">${time}</span>
          </div>
          <div class="chat-conv-preview">${preview}</div>
        </div>
        ${c.unread_count > 0 ? `<span class="chat-conv-unread">${c.unread_count}</span>` : ''}
      </div>`;
  }).join('');

  pollChatBadge();
}

function openConversation(userId) {
  state.chatActiveUserId = userId;
  const conv = state.chatConversations.find((c) => c.user_id === userId);
  const panel = document.getElementById('chat-panel');
  document.getElementById('chat-layout')?.classList.add('mobile-chat-open');
  panel.innerHTML = `
    <div class="chat-panel-head">
      <button type="button" class="chat-back-btn" onclick="closeMobileChatPanel()" aria-label="Geri">‹</button>
      <span>${conv ? `${escapeHtml(conv.name)} ${escapeHtml(conv.surname)} · ${escapeHtml(conv.email)}` : `Müştəri #${userId}`}</span>
    </div>
    <div id="chat-messages" class="chat-messages"></div>
    <form id="admin-chat-form" class="chat-input-row">
      <input type="text" id="admin-chat-input" placeholder="Cavab yazın..." maxlength="2000" autocomplete="off" required />
      <button type="submit" class="btn btn-primary">Göndər</button>
    </form>
  `;
  document.getElementById('admin-chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('admin-chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    try {
      await apiFetch('/chat/messages', { method: 'POST', body: JSON.stringify({ user_id: state.chatActiveUserId, text }) });
      loadActiveChatMessages();
      loadConversations();
    } catch (err) {
      toast(err.message, true);
      input.value = text;
    }
  });

  loadActiveChatMessages();
  loadConversations();
  startChatMsgPolling();
}

async function loadActiveChatMessages() {
  if (!state.chatActiveUserId) return;
  try {
    const messages = await apiFetch(`/chat/messages?user_id=${state.chatActiveUserId}`);
    renderAdminChatMessages(messages);
  } catch (err) {
    console.warn('Söhbət yüklənmə xətası:', err.message);
  }
}

function renderAdminChatMessages(messages) {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;

  if (messages.length === 0) {
    container.innerHTML = '<div class="empty-state">Bu müştəri ilə hələ mesaj yoxdur. Aşağıdan ilk mesajı göndərə bilərsiniz.</div>';
    return;
  }

  container.innerHTML = messages.map((m) => `
    <div class="chat-msg ${m.sender === 'admin' ? 'mine' : 'theirs'}">
      <div class="chat-bubble">${escapeHtml(m.text)}</div>
      <div class="chat-time">${new Date(m.created_at).toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit' })}</div>
    </div>
  `).join('');

  if (nearBottom) container.scrollTop = container.scrollHeight;
}

// ---------- Promokodlar ----------
async function loadPromocodes() {
  state.promocodes = await apiFetch('/promocodes');
  const tbody = document.getElementById('promocodes-tbody');
  tbody.innerHTML = state.promocodes.map((p) => `
    <tr>
      <td><b>${p.code}</b></td>
      <td>${p.discount_percent}%</td>
      <td>${p.valid_until ? new Date(p.valid_until).toLocaleDateString('az-AZ') : 'Limitsiz'}</td>
      <td>${p.used_count}${p.usage_limit ? ' / ' + p.usage_limit : ''}</td>
      <td><button class="btn btn-danger btn-sm" onclick="deletePromo(${p.id})">Sil</button></td>
    </tr>
  `).join('') || '<tr><td colspan="5">Promokod yoxdur.</td></tr>';
}

function openPromoModal() {
  openModal('Yeni promokod', `
    <div class="form-group"><label>Kod</label><input id="promo-code" placeholder="MƏS: YAY2026" /></div>
    <div class="form-group"><label>Endirim faizi (%)</label><input id="promo-discount" type="number" min="1" max="100" /></div>
    <div class="form-group"><label>Bitmə tarixi (istəyə görə)</label><input id="promo-valid-until" type="date" /></div>
    <div class="form-group"><label>İstifadə limiti (istəyə görə)</label><input id="promo-limit" type="number" /></div>
    <button class="btn btn-primary" style="width:100%" onclick="savePromo()">Yadda saxla</button>
  `);
}

async function savePromo() {
  const payload = {
    code: document.getElementById('promo-code').value.trim(),
    discount_percent: Number(document.getElementById('promo-discount').value),
    valid_until: document.getElementById('promo-valid-until').value || null,
    usage_limit: document.getElementById('promo-limit').value ? Number(document.getElementById('promo-limit').value) : null
  };
  if (!payload.code || !payload.discount_percent) { toast('Kod və faiz tələb olunur.', true); return; }
  try {
    await apiFetch('/promocodes', { method: 'POST', body: JSON.stringify(payload) });
    closeModal(); toast('Promokod yaradıldı.'); loadPromocodes();
  } catch (err) { toast(err.message, true); }
}

async function deletePromo(id) {
  if (!confirm('Bu promokodu silmək istədiyinizə əminsiniz?')) return;
  try {
    await apiFetch(`/promocodes/${id}`, { method: 'DELETE' });
    toast('Promokod silindi.'); loadPromocodes();
  } catch (err) { toast(err.message, true); }
}

// ---------- Məhsul Rəyləri ----------
function reviewStarsHtml(rating) {
  const n = Math.round(Number(rating) || 0);
  let html = '<span class="review-stars">';
  for (let i = 1; i <= 5; i++) html += i <= n ? '★' : '☆';
  html += '</span>';
  return html;
}

async function loadReviews() {
  const rating = document.getElementById('reviews-filter-rating')?.value || '';
  const qs = rating ? `?rating=${rating}` : '';
  state.reviews = await apiFetch(`/reviews${qs}`);
  const tbody = document.getElementById('reviews-tbody');
  tbody.innerHTML = state.reviews.map((r) => `
    <tr>
      <td>${escapeHtml(r.product_name)}</td>
      <td>${escapeHtml(r.author_name)}</td>
      <td>${reviewStarsHtml(r.rating)}</td>
      <td><b>${escapeHtml(r.title)}</b><br /><span class="review-comment-cell">${escapeHtml(r.comment)}</span>
        ${Array.isArray(r.images) && r.images.length
          ? `<div class="review-images-admin">${r.images.map((img) => `<img class="review-image-thumb" src="${escapeHtml(img.url)}" alt="Rəy şəkli" loading="lazy" decoding="async" onclick="window.open('${escapeHtml(img.url)}', '_blank')" />`).join('')}</div>`
          : ''}
      </td>
      <td>${new Date(r.created_at).toLocaleDateString('az-AZ')}</td>
      <td>${r.admin_reply
        ? `<span class="tag tag-active">Cavablandı</span><br /><span class="review-comment-cell">${escapeHtml(r.admin_reply.message)}</span>`
        : '<span class="tag tag-pending">Cavabsız</span>'}</td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="openReviewReplyModal(${r.id})">${r.admin_reply ? 'Cavabı redaktə et' : 'Cavab yaz'}</button>
        <button class="btn btn-danger btn-sm" onclick="deleteReview(${r.id})">Sil</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="7">Hələ heç bir rəy yazılmayıb.</td></tr>';
}

function openReviewReplyModal(id) {
  const r = state.reviews.find((x) => x.id === id);
  if (!r) return;
  openModal('Rəyə cavab yaz', `
    <div class="form-group">
      <label>Rəy</label>
      <p class="calc-hint">${reviewStarsHtml(r.rating)} <b>${escapeHtml(r.title)}</b><br />${escapeHtml(r.comment)}</p>
    </div>
    <div class="form-group">
      <label>Cavabınız</label>
      <textarea id="review-reply-text" rows="4" placeholder="Müştəriyə cavabınızı yazın...">${r.admin_reply ? escapeHtml(r.admin_reply.message) : ''}</textarea>
    </div>
    <button class="btn btn-primary" style="width:100%" onclick="submitReviewReply(${id})">Cavabı göndər</button>
  `);
}

async function submitReviewReply(id) {
  const message = document.getElementById('review-reply-text').value.trim();
  if (!message) { toast('Cavab mətni tələb olunur.', true); return; }
  try {
    await apiFetch(`/reviews/${id}/reply`, { method: 'POST', body: JSON.stringify({ message }) });
    closeModal(); toast('Cavab göndərildi.'); loadReviews();
  } catch (err) { toast(err.message, true); }
}

async function deleteReview(id) {
  if (!confirm('Bu rəyi silmək istədiyinizə əminsiniz?')) return;
  try {
    await apiFetch(`/reviews/${id}`, { method: 'DELETE' });
    toast('Rəy silindi.'); loadReviews();
  } catch (err) { toast(err.message, true); }
}

// ---------- Bildirişlər (admin tərəfindən göndərilən elanlar) ----------
function notificationStatusTag(n) {
  return n.is_active
    ? '<span class="tag tag-active">Aktiv</span>'
    : '<span class="tag tag-archived">⏸️ Deaktiv</span>';
}

async function loadAdminNotifications() {
  state.adminNotifications = await apiFetch('/admin-notifications');
  renderAdminNotificationsTable();
  startNotifListPolling();
}

function renderAdminNotificationsTable() {
  const tbody = document.getElementById('admin-notifications-tbody');
  if (!tbody) return;
  tbody.innerHTML = state.adminNotifications.map((n) => `
    <tr>
      <td><b>${escapeHtml(n.title)}</b></td>
      <td>${escapeHtml(n.message)}</td>
      <td>${escapeHtml(n.target_label)}</td>
      <td>${n.read_count} / ${n.recipient_count}</td>
      <td>${notificationStatusTag(n)}</td>
      <td>${new Date(n.created_at).toLocaleString('az-AZ')}</td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="toggleNotificationActive(${n.broadcast_id})">${n.is_active ? 'Deaktiv et' : 'Aktivləşdir'}</button>
        <button class="btn btn-secondary btn-sm" onclick="openNotificationModal(${n.broadcast_id})">Redaktə</button>
        <button class="btn btn-danger btn-sm" onclick="deleteNotificationBroadcast(${n.broadcast_id})">Sil</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="7">Hələ bildiriş göndərilməyib.</td></tr>';
}

async function openNotificationModal(broadcastId) {
  const existing = broadcastId ? state.adminNotifications.find((n) => n.broadcast_id === broadcastId) : null;

  if (existing) {
    // Redaktə zamanı yalnız başlıq/mətn dəyişdirilə bilər - hədəf (kimə göndərildiyi) sabit qalır
    openModal('Bildirişi redaktə et', `
      <div class="form-group"><label>Hədəf</label><input value="${escapeHtml(existing.target_label)}" readonly /></div>
      <div class="form-group"><label>Başlıq</label><input id="notif-title" value="${escapeHtml(existing.title)}" /></div>
      <div class="form-group"><label>Mətn</label><textarea id="notif-message" rows="4">${escapeHtml(existing.message)}</textarea></div>
      <button class="btn btn-primary" style="width:100%" onclick="saveNotification(${broadcastId})">Yadda saxla</button>
    `);
    return;
  }

  // Yeni bildiriş - müştəri siyahısını təzədən çəkirik ki, dropdown həmişə güncəl olsun
  let customers = [];
  try {
    customers = await apiFetch('/auth/users');
  } catch (err) {
    toast(err.message, true);
  }
  state.customers = customers;

  const customerOptions = customers
    .map((c) => `<option value="${c.id}">${escapeHtml(`${c.name} ${c.surname || ''}`.trim())} (${escapeHtml(c.email)})</option>`)
    .join('');

  openModal('Yeni bildiriş göndər', `
    <div class="form-group">
      <label>Hədəf</label>
      <select id="notif-target" onchange="document.getElementById('notif-user-row').classList.toggle('hidden', this.value !== 'user')">
        <option value="all">Bütün müştərilər</option>
        <option value="user">Konkret müştəri</option>
      </select>
    </div>
    <div class="form-group hidden" id="notif-user-row">
      <label>Müştəri</label>
      <select id="notif-user-id">${customerOptions}</select>
    </div>
    <div class="form-group"><label>Başlıq</label><input id="notif-title" placeholder="Məs: Yeni endirim kampaniyası" /></div>
    <div class="form-group"><label>Mətn</label><textarea id="notif-message" rows="4" placeholder="Bildiriş mətni..."></textarea></div>
    <button class="btn btn-primary" style="width:100%" onclick="saveNotification()">Göndər</button>
  `);
}

async function saveNotification(broadcastId) {
  const title = document.getElementById('notif-title').value.trim();
  const message = document.getElementById('notif-message').value.trim();
  if (!title || !message) { toast('Başlıq və mətn tələb olunur.', true); return; }

  try {
    if (broadcastId) {
      await apiFetch(`/admin-notifications/${broadcastId}`, { method: 'PUT', body: JSON.stringify({ title, message }) });
      toast('Bildiriş yeniləndi.');
    } else {
      const target = document.getElementById('notif-target').value;
      const payload = { title, message, target };
      if (target === 'user') {
        payload.user_id = Number(document.getElementById('notif-user-id').value);
        if (!payload.user_id) { toast('Zəhmət olmasa müştəri seçin.', true); return; }
      }
      await apiFetch('/admin-notifications', { method: 'POST', body: JSON.stringify(payload) });
      toast('Bildiriş göndərildi.');
    }
    closeModal();
    loadAdminNotifications();
  } catch (err) {
    toast(err.message, true);
  }
}

async function toggleNotificationActive(broadcastId) {
  try {
    await apiFetch(`/admin-notifications/${broadcastId}/toggle`, { method: 'PATCH' });
    loadAdminNotifications();
  } catch (err) { toast(err.message, true); }
}

async function deleteNotificationBroadcast(broadcastId) {
  if (!confirm('Bu bildirişi bütün alıcılardan həmişəlik silmək istədiyinizə əminsiniz?')) return;
  try {
    await apiFetch(`/admin-notifications/${broadcastId}`, { method: 'DELETE' });
    toast('Bildiriş silindi.');
    loadAdminNotifications();
  } catch (err) { toast(err.message, true); }
}

// Bildirişlər ekranı açıqkən siyahını tez-tez yeniləyir - beləliklə başqa bir admin
// tərəfindən edilən dəyişiklik də (redaktə/silmə/status) avtomatik görünür.
function startNotifListPolling() {
  stopNotifListPolling();
  state.notifListPollTimer = setInterval(async () => {
    try {
      state.adminNotifications = await apiFetch('/admin-notifications');
      renderAdminNotificationsTable();
    } catch (err) {
      console.warn('Bildiriş siyahısı yenilənmə xətası:', err.message);
    }
  }, 5000);
}
function stopNotifListPolling() {
  if (state.notifListPollTimer) { clearInterval(state.notifListPollTimer); state.notifListPollTimer = null; }
}

// ---------- Endirim Çarxı ----------
function wheelStatusTag(status) {
  const map = {
    active: '<span class="tag tag-active">Aktiv</span>',
    scheduled: '<span class="tag tag-inactive">Planlaşdırılıb</span>',
    expired: '<span class="tag tag-inactive">⏹️ Bitib</span>',
    deactivated: '<span class="tag tag-inactive">Deaktiv</span>'
  };
  return map[status] || status;
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('az-AZ', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function loadWheel() {
  const [campaigns, stats] = await Promise.all([apiFetch('/wheel/campaigns'), apiFetch('/wheel/stats')]);
  state.wheelCampaigns = campaigns;
  state.wheelStats = stats;

  document.getElementById('wheel-stat-grid').innerHTML = `
    <div class="stat-card"><div class="stat-value">${stats.total_spins}</div><div class="stat-label">Ümumi fırlatma sayı</div></div>
    <div class="stat-card"><div class="stat-value">${stats.discounts_won}</div><div class="stat-label">Qazanılan endirimlər</div></div>
    <div class="stat-card"><div class="stat-value">${stats.gifts_won}</div><div class="stat-label">Qazanılan hədiyyələr</div></div>
    <div class="stat-card"><div class="stat-value">${stats.promo_codes_used} / ${stats.promo_codes_generated}</div><div class="stat-label">İstifadə olunan promo kodlar</div></div>
    <div class="stat-card"><div class="stat-value">${stats.active_campaigns}</div><div class="stat-label">Aktiv kampaniyalar</div></div>
    <div class="stat-card"><div class="stat-value">${stats.expired_campaigns}</div><div class="stat-label">Bitmiş kampaniyalar</div></div>
  `;

  const tbody = document.getElementById('wheel-campaigns-tbody');
  tbody.innerHTML = campaigns.map((c) => `
    <tr>
      <td><b>${escapeHtml(c.name)}</b></td>
      <td>${wheelStatusTag(c.status)}</td>
      <td>${fmtDateTime(c.start_at)}</td>
      <td>${fmtDateTime(c.end_at)}</td>
      <td>${c.promo_validity_days ? c.promo_validity_days + ' gün' : (c.end_at ? 'Kampaniya bitənədək' : 'Limitsiz')}</td>
      <td>${c.sectors.length}</td>
      <td>${c.spin_count}</td>
      <td style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="btn btn-secondary btn-sm" onclick="openSectorsModal(${c.id})">Sektorlar</button>
        <button class="btn btn-secondary btn-sm" onclick="openCampaignModal(${c.id})">Redaktə</button>
        <button class="btn btn-secondary btn-sm" onclick="toggleCampaign(${c.id})">${c.is_enabled ? 'Deaktiv et' : 'Aktiv et'}</button>
        <button class="btn btn-danger btn-sm" onclick="deleteCampaign(${c.id})">Sil</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="8">Hələ kampaniya yaradılmayıb.</td></tr>';
}

function toLocalInputValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function openCampaignModal(id) {
  const campaign = id ? state.wheelCampaigns.find((c) => c.id === id) : null;
  openModal(campaign ? 'Kampaniyanı redaktə et' : 'Yeni kampaniya', `
    <div class="form-group"><label>Kampaniya adı</label><input id="wc-name" value="${campaign ? escapeHtml(campaign.name) : ''}" placeholder="Məs: Yay Endirim Çarxı" /></div>
    <div class="form-row" style="display:flex;gap:12px;">
      <div class="form-group" style="flex:1;"><label>Başlanğıc tarixi/saatı</label><input id="wc-start" type="datetime-local" value="${toLocalInputValue(campaign?.start_at)}" /></div>
      <div class="form-group" style="flex:1;"><label>Bitmə tarixi/saatı</label><input id="wc-end" type="datetime-local" value="${toLocalInputValue(campaign?.end_at)}" /></div>
    </div>
    <div class="form-group"><label>Qazanılan promo kodun etibarlılıq müddəti (gün, istəyə görə)</label><input id="wc-validity" type="number" min="1" value="${campaign?.promo_validity_days || ''}" placeholder="Boş buraxsanız, kampaniyanın bitmə tarixinədək etibarlıdır" /></div>
    <div class="form-group">
      <label><input type="checkbox" id="wc-enabled" ${campaign && campaign.is_enabled ? 'checked' : ''} style="width:auto;margin-right:8px;" />Kampaniya aktivdir (tarix aralığına düşəndə çarx avtomatik açılıb-bağlanacaq)</label>
    </div>
    <button class="btn btn-primary" style="width:100%" onclick="saveCampaign(${campaign ? campaign.id : 'null'})">Yadda saxla</button>
  `);
}

async function saveCampaign(id) {
  const payload = {
    name: document.getElementById('wc-name').value.trim(),
    start_at: document.getElementById('wc-start').value ? new Date(document.getElementById('wc-start').value).toISOString() : null,
    end_at: document.getElementById('wc-end').value ? new Date(document.getElementById('wc-end').value).toISOString() : null,
    promo_validity_days: document.getElementById('wc-validity').value || null,
    is_enabled: document.getElementById('wc-enabled').checked
  };
  if (!payload.name) { toast('Kampaniya adı tələb olunur.', true); return; }
  try {
    if (id) await apiFetch(`/wheel/campaigns/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    else await apiFetch('/wheel/campaigns', { method: 'POST', body: JSON.stringify(payload) });
    closeModal(); toast('Kampaniya yadda saxlanıldı.'); loadWheel();
  } catch (err) { toast(err.message, true); }
}

async function toggleCampaign(id) {
  try {
    await apiFetch(`/wheel/campaigns/${id}/toggle`, { method: 'POST' });
    toast('Kampaniyanın statusu dəyişdirildi.'); loadWheel();
  } catch (err) { toast(err.message, true); }
}

async function deleteCampaign(id) {
  if (!confirm('Bu kampaniyanı və onun bütün sektorlarını silmək istədiyinizə əminsiniz?')) return;
  try {
    await apiFetch(`/wheel/campaigns/${id}`, { method: 'DELETE' });
    toast('Kampaniya silindi.'); loadWheel();
  } catch (err) { toast(err.message, true); }
}

function openSectorsModal(campaignId) {
  const campaign = state.wheelCampaigns.find((c) => c.id === campaignId);
  if (!campaign) return;
  renderSectorsModalBody(campaignId);
  document.querySelector('#modal-overlay .modal').classList.add('modal-wide');
}

function renderSectorsModalBody(campaignId) {
  const campaign = state.wheelCampaigns.find((c) => c.id === campaignId);
  const sectors = campaign.sectors;
  const probSum = sectors.reduce((s, x) => s + (Number(x.probability) || 0), 0);

  openModal(`Sektorlar — ${escapeHtml(campaign.name)}`, `
    <table class="data-table" style="margin-bottom:14px;">
      <thead><tr><th>Rəng</th><th>Ad</th><th>Növ</th><th>Dəyər</th><th>Ehtimal (%)</th><th>Əməliyyat</th></tr></thead>
      <tbody>
        ${sectors.map((s) => `
          <tr>
            <td><span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:${s.color};"></span></td>
            <td>${escapeHtml(s.label)}</td>
            <td>${s.type === 'discount' ? 'Endirim' : 'Hədiyyə'}</td>
            <td>${s.type === 'discount' ? s.discount_percent + '%' : escapeHtml(s.gift_label || '')}</td>
            <td>${s.probability}%</td>
            <td style="display:flex;gap:6px;">
              <button class="btn btn-secondary btn-sm" onclick="openSectorForm(${campaignId}, ${s.id})">Redaktə</button>
              <button class="btn btn-danger btn-sm" onclick="deleteSector(${campaignId}, ${s.id})">Sil</button>
            </td>
          </tr>`).join('') || '<tr><td colspan="6">Hələ sektor əlavə edilməyib.</td></tr>'}
      </tbody>
    </table>
    <p class="calc-hint">Ehtimalların cəmi: ${probSum}% ${probSum !== 100 ? '(100%-ə bərabər olmaq şərt deyil, sistem nisbətə görə çəkili seçim edir)' : ''}</p>
    <button class="btn btn-primary" style="width:100%" onclick="openSectorForm(${campaignId})">+ Yeni sektor</button>
  `);
}

function openSectorForm(campaignId, sectorId) {
  const campaign = state.wheelCampaigns.find((c) => c.id === campaignId);
  const sector = sectorId ? campaign.sectors.find((s) => s.id === sectorId) : null;
  const nextColor = WHEEL_SECTOR_COLORS[campaign.sectors.length % WHEEL_SECTOR_COLORS.length];

  openModal(sector ? 'Sektoru redaktə et' : 'Yeni sektor', `
    <div class="form-group"><label>Sektor adı</label><input id="ws-label" value="${sector ? escapeHtml(sector.label) : ''}" placeholder="Məs: 10% Endirim" /></div>
    <div class="form-group"><label>Növ</label>
      <select id="ws-type" onchange="toggleSectorTypeFields()">
        <option value="discount" ${sector && sector.type === 'discount' ? 'selected' : ''}>Endirim faizi</option>
        <option value="gift" ${sector && sector.type === 'gift' ? 'selected' : ''}>Hədiyyə</option>
      </select>
    </div>
    <div class="form-group" id="ws-discount-field"><label>Endirim faizi (%)</label>
      <select id="ws-discount">
        ${[5,10,15,20,25,30,50].map((p) => `<option value="${p}" ${sector && sector.discount_percent === p ? 'selected' : ''}>${p}%</option>`).join('')}
      </select>
    </div>
    <div class="form-group hidden" id="ws-gift-field"><label>Hədiyyənin adı</label><input id="ws-gift" value="${sector ? escapeHtml(sector.gift_label || '') : ''}" placeholder="Məs: Pulsuz çatdırılma" /></div>
    <div class="form-group"><label>Düşmə ehtimalı (%)</label><input id="ws-probability" type="number" min="0" max="100" value="${sector ? sector.probability : 10}" /></div>
    <div class="form-group"><label>Rəng</label><input id="ws-color" type="color" value="${sector ? sector.color : nextColor}" style="height:40px;padding:4px;" /></div>
    <button class="btn btn-primary" style="width:100%" onclick="saveSector(${campaignId}, ${sectorId || 'null'})">Yadda saxla</button>
  `);
  document.querySelector('#modal-overlay .modal').classList.add('modal-wide');
  toggleSectorTypeFields();
}

function toggleSectorTypeFields() {
  const type = document.getElementById('ws-type').value;
  document.getElementById('ws-discount-field').classList.toggle('hidden', type !== 'discount');
  document.getElementById('ws-gift-field').classList.toggle('hidden', type !== 'gift');
}

async function saveSector(campaignId, sectorId) {
  const type = document.getElementById('ws-type').value;
  const payload = {
    label: document.getElementById('ws-label').value.trim(),
    type,
    discount_percent: type === 'discount' ? Number(document.getElementById('ws-discount').value) : null,
    gift_label: type === 'gift' ? document.getElementById('ws-gift').value.trim() : null,
    probability: Number(document.getElementById('ws-probability').value),
    color: document.getElementById('ws-color').value
  };
  if (!payload.label) { toast('Sektor adı tələb olunur.', true); return; }
  if (type === 'gift' && !payload.gift_label) { toast('Hədiyyə adı tələb olunur.', true); return; }
  try {
    if (sectorId) await apiFetch(`/wheel/sectors/${sectorId}`, { method: 'PUT', body: JSON.stringify(payload) });
    else await apiFetch(`/wheel/campaigns/${campaignId}/sectors`, { method: 'POST', body: JSON.stringify(payload) });
    toast('Sektor yadda saxlanıldı.');
    await loadWheel();
    renderSectorsModalBody(campaignId);
  } catch (err) { toast(err.message, true); }
}

async function deleteSector(campaignId, sectorId) {
  if (!confirm('Bu sektoru silmək istədiyinizə əminsiniz?')) return;
  try {
    await apiFetch(`/wheel/sectors/${sectorId}`, { method: 'DELETE' });
    toast('Sektor silindi.');
    await loadWheel();
    renderSectorsModalBody(campaignId);
  } catch (err) { toast(err.message, true); }
}

// ---------- Admin İdarəetməsi ----------
function debouncedLoadAdmins() {
  clearTimeout(state.adminsSearchTimer);
  state.adminsSearchTimer = setTimeout(loadAdmins, 300);
}

function roleTag(role) {
  return `<span class="role-tag role-${role}">${ROLE_LABELS[role] || role}</span>`;
}

function statusTag(status) {
  const s = status || 'active';
  return s === 'active' ? '<span class="tag tag-active">Aktiv</span>' : '<span class="tag tag-inactive">Deaktiv</span>';
}

async function loadAdmins() {
  const q = document.getElementById('admins-search').value.trim();
  const role = document.getElementById('admins-filter-role').value;
  const status = document.getElementById('admins-filter-status').value;

  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (role) params.set('role', role);
  if (status) params.set('status', status);

  try {
    state.admins = await apiFetch(`/admins?${params.toString()}`);
  } catch (err) {
    toast(err.message, true);
    return;
  }

  const myRole = state.user.role;
  const canManage = ['super_admin', 'admin'].includes(myRole); // redaktə / aktiv-deaktiv
  const canCreateDelete = myRole === 'super_admin'; // yarat / sil

  const tbody = document.getElementById('admins-tbody');
  tbody.innerHTML = state.admins.map((a) => {
    const isSelf = a.id === state.user.id;
    // admin rolu olan istifadəçi super_admin hesabına toxuna bilməz
    const canEditThis = canManage && !(a.role === 'super_admin' && myRole !== 'super_admin');
    const canDeleteThis = canCreateDelete && !isSelf;
    const canToggleThis = canEditThis && !isSelf;

    return `
      <tr>
        <td>${a.avatar_url
          ? `<img src="${a.avatar_url}" alt="" style="width:32px;height:32px;border-radius:50%;object-fit:cover;" loading="lazy" decoding="async" />`
          : `<div style="width:32px;height:32px;border-radius:50%;background:var(--border);display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--text-muted);">${(a.name || '?')[0].toUpperCase()}</div>`}</td>
        <td>${escapeHtml(a.name)} ${escapeHtml(a.surname)}${isSelf ? ' <span style="color:var(--text-muted);font-size:11px;">(siz)</span>' : ''}</td>
        <td>${escapeHtml(a.email)}</td>
        <td>${escapeHtml(a.phone) || '—'}</td>
        <td>${roleTag(a.role)}</td>
        <td>${statusTag(a.status)}</td>
        <td>${new Date(a.created_at).toLocaleDateString('az-AZ')}</td>
        <td style="display:flex;gap:6px;flex-wrap:wrap;">
          ${canEditThis ? `<button class="btn btn-secondary btn-sm" onclick="openAdminModal(${a.id})">Redaktə</button>` : ''}
          ${canToggleThis ? `<button class="btn btn-secondary btn-sm" onclick="toggleAdminStatus(${a.id}, '${(a.status || 'active') === 'active' ? 'inactive' : 'active'}')">${(a.status || 'active') === 'active' ? 'Deaktiv et' : 'Aktiv et'}</button>` : ''}
          ${canToggleThis ? `<button class="btn btn-secondary btn-sm" onclick="forceLogoutAdmin(${a.id})">Sessiyanı ləğv et</button>` : ''}
          ${canDeleteThis ? `<button class="btn btn-danger btn-sm" onclick="deleteAdmin(${a.id})">Sil</button>` : ''}
        </td>
      </tr>`;
  }).join('') || '<tr><td colspan="8">Admin tapılmadı.</td></tr>';
}

function openAdminModal(id) {
  const a = id ? state.admins.find((x) => x.id === id) : null;
  const myRole = state.user.role;
  const isNew = !a;

  // Yalnız super_admin, super_admin rolunu təyin edə bilər
  const roleOptions = ADMIN_ROLES
    .filter((r) => r !== 'super_admin' || myRole === 'super_admin')
    .map((r) => `<option value="${r}" ${a && a.role === r ? 'selected' : ''}>${ROLE_LABELS[r]}</option>`)
    .join('');

  openModal(isNew ? 'Yeni admin' : 'Admini redaktə et', `
    <div class="form-row">
      <div class="form-group"><label>Ad</label><input id="a-name" value="${a ? escapeHtml(a.name) : ''}" /></div>
      <div class="form-group"><label>Soyad</label><input id="a-surname" value="${a ? escapeHtml(a.surname) : ''}" /></div>
    </div>
    <div class="form-group"><label>Email</label><input id="a-email" type="email" value="${a ? escapeHtml(a.email) : ''}" /></div>
    <div class="form-group"><label>Telefon</label><input id="a-phone" value="${a ? escapeHtml(a.phone) : ''}" /></div>
    <div class="form-group"><label>Rol</label><select id="a-role">${roleOptions}</select></div>
    <div class="form-group">
      <label>Profil şəkli linki (URL, opsional)</label>
      <input id="a-avatar-url" type="url" placeholder="https://.../sekil.jpg" value="${a ? escapeHtml(a.avatar_url || '') : ''}" oninput="onAdminAvatarUrlInput()" />
      <div id="admin-avatar-preview-wrap"></div>
    </div>
    <div class="form-group">
      <label>${isNew ? 'Şifrə' : 'Yeni şifrə (istəyə görə)'}</label>
      <input id="a-password" type="password" placeholder="${isNew ? 'ən azı 6 simvol' : 'dəyişmək istəmirsinizsə boş buraxın'}" />
    </div>
    <button class="btn btn-primary" style="width:100%" onclick="saveAdmin(${id || 'null'})">Yadda saxla</button>
  `);
  state.adminAvatarItem = a && a.avatar_url ? { url: a.avatar_url, valid: null } : null;
  renderAdminAvatarPreview();
  if (a && a.avatar_url) {
    checkImageUrl(a.avatar_url, (result) => {
      state.adminAvatarItem = { url: a.avatar_url, valid: result.valid };
      renderAdminAvatarPreview();
    });
  }
}

let adminAvatarCheckTimer = null;
function onAdminAvatarUrlInput() {
  const url = document.getElementById('a-avatar-url').value.trim();
  if (!url) { state.adminAvatarItem = null; renderAdminAvatarPreview(); return; }
  state.adminAvatarItem = { url, valid: null, checking: true };
  renderAdminAvatarPreview();
  clearTimeout(adminAvatarCheckTimer);
  adminAvatarCheckTimer = setTimeout(() => {
    checkImageUrl(url, (result) => {
      if (document.getElementById('a-avatar-url')?.value.trim() !== url) return;
      state.adminAvatarItem = { url, valid: result.valid };
      renderAdminAvatarPreview();
    });
  }, 500);
}

function renderAdminAvatarPreview() {
  const wrap = document.getElementById('admin-avatar-preview-wrap');
  if (!wrap) return;
  const item = state.adminAvatarItem;
  if (!item) {
    wrap.innerHTML = '';
  } else if (item.checking || item.valid === null) {
    wrap.innerHTML = '<div class="avatar-url-status muted">Link yoxlanılır…</div>';
  } else if (item.valid) {
    wrap.innerHTML = `<img class="brand-logo-preview" style="width:64px;height:64px;border-radius:50%;" src="${item.url}" alt="" /><div class="avatar-url-status ok">✓ Şəkil düzgün yüklənir.</div>`;
  } else {
    wrap.innerHTML = '<div class="avatar-url-status error">✕ Bu link üzrə şəkil yüklənə bilmədi. Linki yoxlayın.</div>';
  }
}

async function saveAdmin(id) {
  const name = document.getElementById('a-name').value.trim();
  const surname = document.getElementById('a-surname').value.trim();
  const email = document.getElementById('a-email').value.trim();
  const phone = document.getElementById('a-phone').value.trim();
  const role = document.getElementById('a-role').value;
  const password = document.getElementById('a-password').value;
  const avatar_url = document.getElementById('a-avatar-url').value.trim();

  if (!name || !email) { toast('Ad və email tələb olunur.', true); return; }
  if (!id && !password) { toast('Yeni admin üçün şifrə tələb olunur.', true); return; }
  if (avatar_url && state.adminAvatarItem && state.adminAvatarItem.valid === false) {
    toast('Profil şəkli linki etibarlı bir şəkil göstərmir. Zəhmət olmasa linki yoxlayın.', true);
    return;
  }

  const payload = { name, surname, email, phone, role, avatar_url };
  if (password) payload.password = password;

  try {
    if (id) await apiFetch(`/admins/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    else await apiFetch('/admins', { method: 'POST', body: JSON.stringify(payload) });
    closeModal(); toast('Admin yadda saxlanıldı.'); loadAdmins();
  } catch (err) { toast(err.message, true); }
}

async function toggleAdminStatus(id, newStatus) {
  const label = newStatus === 'active' ? 'aktiv' : 'deaktiv';
  if (!confirm(`Bu admini ${label} etmək istədiyinizə əminsiniz?`)) return;
  try {
    await apiFetch(`/admins/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: newStatus }) });
    toast(`Admin ${label} edildi.`); loadAdmins();
  } catch (err) { toast(err.message, true); }
}

// Admini deaktiv etmədən sadəcə cari sessiyasını (əlindəki tokeni) ləğv edir -
// növbəti sorğuda avtomatik çıxarılır və yenidən daxil olmalı olur.
async function forceLogoutAdmin(id) {
  if (!confirm('Bu adminin cari sessiyasını ləğv etmək istədiyinizə əminsiniz? Hesab aktiv qalacaq, sadəcə yenidən daxil olmalı olacaq.')) return;
  try {
    await apiFetch(`/admins/${id}/force-logout`, { method: 'PATCH' });
    toast('Adminin sessiyası ləğv edildi.');
  } catch (err) { toast(err.message, true); }
}

async function deleteAdmin(id) {
  if (!confirm('Bu admini silmək istədiyinizə əminsiniz? Bu əməliyyat geri qaytarıla bilməz.')) return;
  try {
    await apiFetch(`/admins/${id}`, { method: 'DELETE' });
    toast('Admin silindi.'); loadAdmins();
  } catch (err) { toast(err.message, true); }
}

async function openAdminLogsModal() {
  let logs = [];
  try {
    logs = await apiFetch('/admins/logs');
  } catch (err) {
    toast(err.message, true);
    return;
  }

  const actionLabels = { create: 'Yaradıldı', update: 'Redaktə edildi', delete: 'Silindi', activate: 'Aktiv edildi', deactivate: 'Deaktiv edildi' };

  const rows = logs.slice(0, 200).map((l) => `
    <tr>
      <td>${new Date(l.created_at).toLocaleString('az-AZ')}</td>
      <td>${escapeHtml(l.actor_name)} <span class="role-tag role-${l.actor_role}" style="margin-left:4px;">${ROLE_LABELS[l.actor_role] || l.actor_role}</span></td>
      <td>${actionLabels[l.action] || l.action}</td>
      <td>${escapeHtml(l.target_name) || '—'}</td>
      <td style="color:var(--text-muted);">${escapeHtml(l.details) || ''}</td>
    </tr>`).join('') || '<tr><td colspan="5">Hələ heç bir əməliyyat qeydə alınmayıb.</td></tr>';

  openModal('Admin əməliyyat log tarixçəsi', `
    <div style="max-height:60vh;overflow-y:auto;">
      <table class="data-table">
        <thead><tr><th>Tarix</th><th>İcra edən</th><th>Əməliyyat</th><th>Hədəf</th><th>Detal</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `);
  document.querySelector('#modal-overlay .modal').classList.add('modal-wide');
}

// ---------- Başlanğıc ----------
if (state.token && state.user) boot();
