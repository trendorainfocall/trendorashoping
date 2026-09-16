const express = require('express');
const store = require('../db/store');
const asyncHandler = require('../utils/asyncHandler');
const { authenticateToken, requireAdmin, ADMIN_ROLES } = require('../middleware/auth');
const { notify, NOTIFICATION_TYPES } = require('../utils/notify');

const router = express.Router();

// Sifariş statusu dəyişəndə müştəriyə göndəriləcək bildiriş mətnləri
const STATUS_NOTIFICATIONS = {
  'qəbul edildi': {
    type: NOTIFICATION_TYPES.PAYMENT_CONFIRMED,
    title: 'Ödəniş təsdiqləndi',
    message: (code) => `${code} nömrəli sifarişinizin ödənişi təsdiqləndi, sifariş emala başladı.`
  },
  'hazırlanır': {
    type: NOTIFICATION_TYPES.GENERAL,
    title: 'Sifariş hazırlanır',
    message: (code) => `${code} nömrəli sifarişiniz hazırlanmağa başladı.`
  },
  'qablaşdırılır': {
    type: NOTIFICATION_TYPES.ORDER_READY,
    title: 'Sifariş hazırdır',
    message: (code) => `${code} nömrəli sifarişiniz hazırdır və qablaşdırılır.`
  },
  'kuryerə verildi': {
    type: NOTIFICATION_TYPES.ORDER_SHIPPED,
    title: 'Sifariş göndərildi',
    message: (code) => `${code} nömrəli sifarişiniz kuryerə verildi.`
  },
  'yoldadır': {
    type: NOTIFICATION_TYPES.ORDER_SHIPPED,
    title: 'Sifariş yoldadır',
    message: (code) => `${code} nömrəli sifarişiniz yoldadır.`
  },
  'çatdırıldı': {
    type: NOTIFICATION_TYPES.ORDER_DELIVERED,
    title: 'Sifariş çatdırıldı',
    message: (code) => `${code} nömrəli sifarişiniz uğurla çatdırıldı. Bizi seçdiyiniz üçün təşəkkürlər!`
  }
};

const VALID_STATUSES = ['qəbul edildi', 'hazırlanır', 'qablaşdırılır', 'kuryerə verildi', 'yoldadır', 'çatdırıldı'];
// Yalnız kartdan-karta (bank köçürməsi) ödəniş üsulu aktivdir.
const VALID_PAYMENT_METHODS = ['kartdan_karta'];

// Kartdan-karta (bank köçürməsi) seçiləndə sifariş bu statusda gözləyir -
// admin ödənişi təsdiqləyənə qədər emala başlamır, stokdan məhsul çıxılmır
// və maliyyə hesabatına daxil olunmur.
const PENDING_TRANSFER_STATUS = 'ödəniş gözlənilir';

// Sifariş ləğvi
const CANCELLED_STATUS = 'ləğv edildi';
// Müştəri sifarişi yalnız verdikdən sonra bu müddət ərzində özü ləğv edə bilər
const CUSTOMER_CANCEL_WINDOW_MS = 15 * 60 * 1000;

// Tam çatdırılma ünvanı forması sahələri (hamısı məcburidir)
const REQUIRED_ADDRESS_FIELDS = ['first_name', 'last_name', 'phone', 'city', 'district', 'street_address', 'postal_code'];
const OPTIONAL_ADDRESS_FIELDS = [];
const ADDRESS_FIELD_LABELS = {
  first_name: 'Ad',
  last_name: 'Soyad',
  phone: 'Telefon nömrəsi',
  city: 'Şəhər',
  district: 'Rayon',
  street_address: 'Küçə və ünvan',
  postal_code: 'Poçt indeksi'
};

// Səbətdən/checkout-dan gələn bir sətrin variant seçimini (rəng/şəkil/ölçü) təmizləyir və
// məhsulun özünə qarşı doğrulayır. Heç bir halda məhsulun ilk (standart) şəkli/rəngi/ölçüsü
// avtomatik seçilmir - müştəri nə seçibsə məhz o saxlanılır.
// Bir şəkilin real rəng variantı (adı və ya kodu) daşıyıb-daşımadığını yoxlayır -
// sırf qalereya şəkli (rəngsiz) ilə həqiqi rəng variantını ayırd etmək üçün.
function imageHasColor(img) {
  return Boolean(img && ((img.colors && img.colors.length) || img.color_name || img.color_code));
}

function resolveVariant(product, rawVariant) {
  const v = (rawVariant && typeof rawVariant === 'object') ? rawVariant : {};
  const images = (product.images && product.images.length)
    ? product.images
    : (product.image_url ? [{ url: product.image_url, color_name: '', color_code: '', colors: [], sizes: [] }] : []);

  const hasColorOptions = images.some(imageHasColor);
  let imageIndex = Number.isInteger(v.image_index) ? v.image_index : null;
  const validIndex = imageIndex !== null && imageIndex >= 0 && imageIndex < images.length;

  if (hasColorOptions) {
    // Məhsulda real rəng variantları varsa, müştəri mütləq açıq şəkildə rəng seçməli idi -
    // heç bir standart (ilk) rəng avtomatik seçilib istifadə olunmur.
    if (!validIndex || !imageHasColor(images[imageIndex])) {
      return { error: `"${product.name}" üçün rəng seçimi tələb olunur.` };
    }
  } else if (!validIndex) {
    // Rəng variantı yoxdur, amma birdən çox şəkil (sırf qalereya) varsa yenə də seçim tələb olunur.
    if (images.length > 1) {
      return { error: `"${product.name}" üçün şəkil seçimi tələb olunur.` };
    }
    imageIndex = images.length ? 0 : -1;
  }
  const img = imageIndex >= 0 ? images[imageIndex] : null;

  // Bir şəkilə bir neçə rəng təyin edilmiş ola bilər (məs. eyni fotoda "Qırmızı, Ağ, Yaşıl") -
  // müştərinin göndərdiyi konkret rəng (ad+kod) həmin şəklin öz rənglər siyahısına qarşı
  // doğrulanır. Yalnız BİR rəng varsa (ən çox rast gəlinən hal), o avtomatik istifadə olunur.
  let colorName = '';
  let colorCode = '';
  if (img && imageHasColor(img)) {
    const colorList = (img.colors && img.colors.length) ? img.colors : [{ name: img.color_name || '', code: img.color_code || '' }];
    const reqName = typeof v.color_name === 'string' ? v.color_name.trim().slice(0, 40) : '';
    const reqCode = typeof v.color_code === 'string' ? v.color_code.trim().slice(0, 20) : '';
    const match = colorList.find((c) => (c.name || '') === reqName && (c.code || '') === reqCode) ||
      (colorList.length === 1 ? colorList[0] : null);
    if (!match) {
      return { error: `"${product.name}" üçün rəng seçimi tələb olunur.` };
    }
    colorName = match.name || '';
    colorCode = match.code || '';
  }

  // Ölçülər əvvəlcə seçilmiş şəklin (rəngin) öz siyahısından götürülür - hər rəng üçün
  // fərqli ölçülər ola bilər. Şəklin öz ölçü siyahısı yoxdursa (köhnə məhsullar üçün geriyə
  // uyğunluq), məhsulun ümumi (köhnə) `sizes` sahəsinə keçilir.
  const rawSizes = (img && Array.isArray(img.sizes) && img.sizes.length)
    ? img.sizes
    : (Array.isArray(product.sizes) ? product.sizes : []);
  // Hər ölçü indi `{ size, quantity }` obyekti kimi saxlanıla bilər (admin panelindəki
  // ayrıca stok sayı ilə) - köhnə sadə mətn ölçüləri ilə geriyə uyğunluq da qorunur.
  const sizes = rawSizes.map((s) => (typeof s === 'string' ? s : (s && s.size) || '')).filter(Boolean);
  let size = typeof v.size === 'string' ? v.size.trim().slice(0, 20) : '';
  if (sizes.length > 0) {
    if (!size || !sizes.includes(size)) {
      return { error: `"${product.name}" üçün ölçü seçimi tələb olunur.` };
    }
  } else {
    size = '';
  }

  return {
    variant: {
      image_index: imageIndex,
      image_url: img ? img.url : (product.image_url || ''),
      color_name: colorName,
      color_code: colorCode,
      size: size || null
    }
  };
}

// Bəzi klient tərəflər boş sahəni "-" (və ya "--", "—" kimi) placeholder ilə
// göndərir. Bunlar məzmunca boşdur - validasiyada "doldurulub" kimi qəbul
// edilməməli, əksinə uyğun "sahə mütləqdir" xətası qaytarılmalıdır.
function isBlankAddressValue(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return true;
  return /^[-–—_.\s]+$/.test(s); // yalnız tire/xətt/nöqtə/boşluqdan ibarətdirsə
}

function normalizeAddress(input) {
  const raw = input && typeof input === 'object' ? input : {};
  const missing = REQUIRED_ADDRESS_FIELDS.filter((f) => isBlankAddressValue(raw[f]));
  if (missing.length > 0) {
    const labels = missing.map((f) => ADDRESS_FIELD_LABELS[f]).join(', ');
    return { error: `Çatdırılma ünvanında bu sahələr mütləqdir: ${labels}.` };
  }
  const postalCode = String(raw.postal_code || '').trim().toUpperCase();
  if (!/^AZ\d{4}$/.test(postalCode)) {
    return { error: 'Poçt indeksi düzgün formatda deyil (məsələn: AZ1000).' };
  }
  const address = {};
  [...REQUIRED_ADDRESS_FIELDS, ...OPTIONAL_ADDRESS_FIELDS].forEach((f) => {
    address[f] = f === 'postal_code' ? postalCode : String(raw[f] || '').trim();
  });
  return { address };
}

function computeStatus(stock_quantity, currentStatus) {
  if (currentStatus === 'archived') return 'archived';
  return Number(stock_quantity) <= 0 ? 'out_of_stock' : 'active';
}

// Sifariş yaradılarkən (kart/nağd) stokdan məhsulları çıxarır və satış sayını artırır.
async function deductStockForItems(resolvedItems) {
  for (const { product, quantity } of resolvedItems) {
    const newStock = product.stock_quantity - quantity;
    await store.update('products', product.id, {
      stock_quantity: newStock,
      status: computeStatus(newStock, product.status),
      sold_count: (Number(product.sold_count) || 0) + quantity
    });
  }
}

// Kartdan-karta ödənişi admin təsdiqlədikdə, mövcud sifariş sətirlərinə görə stoku
// çıxarır və hər məhsulun satış sayını (sold_count) artırır. "Ən Çox Satılan" nişanı
// bu say müəyyən həddi keçəndə backend tərəfindən tamamilə avtomatik hesablanır.
async function deductStockForOrder(orderId) {
  const items = await store.where('order_items', (i) => i.order_id === orderId);
  for (const i of items) {
    const product = await store.find('products', i.product_id);
    if (product) {
      const newStock = product.stock_quantity - i.quantity;
      await store.update('products', product.id, {
        stock_quantity: newStock,
        status: computeStatus(newStock, product.status),
        sold_count: (Number(product.sold_count) || 0) + i.quantity
      });
    }
  }
}

// Sifariş ləğv olunduqda, əvvəlcədən stokdan çıxılmış məhsulları geri qaytarır və
// satış sayını (sold_count) müvafiq olaraq azaldır - "Ən Çox Satılan" hesabı yalnız
// faktiki tamamlanmış satışları əks etdirsin deyə.
async function restoreStockForOrder(orderId) {
  const items = await store.where('order_items', (i) => i.order_id === orderId);
  for (const i of items) {
    const product = await store.find('products', i.product_id);
    if (product) {
      const newStock = product.stock_quantity + i.quantity;
      const newSoldCount = Math.max(0, (Number(product.sold_count) || 0) - i.quantity);
      await store.update('products', product.id, {
        stock_quantity: newStock,
        status: computeStatus(newStock, product.status),
        sold_count: newSoldCount
      });
    }
  }
}

// Hər sifariş üçün unikal, insan-oxunaqlı kod yaradır (məs. TRD-20260724-00007)
function generateOrderCode(order) {
  const d = new Date(order.created_at || Date.now());
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `TRD-${y}${m}${day}-${String(order.id).padStart(5, '0')}`;
}

async function attachItemsAndHistory(order) {
  let ord = order;
  // Köhnə sifarişlərdə kod ola bilməz - ilk dəfə görəndə yaradıb bazaya yazırıq
  if (!ord.code) {
    const code = generateOrderCode(ord);
    ord = (await store.update('orders', ord.id, { code })) || { ...ord, code };
  }
  const items = await store.where('order_items', (i) => i.order_id === ord.id);
  const itemsWithProduct = [];
  for (const i of items) {
    const product = await store.find('products', i.product_id);
    itemsWithProduct.push({ ...i, product_name: product ? product.name : '(silinmiş məhsul)' });
  }
  const history = (await store.where('order_status_history', (h) => h.order_id === ord.id))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  return { ...ord, items: itemsWithProduct, history };
}

// POST /api/orders - sifariş yaratmaq (müştəri)
router.post('/', authenticateToken, asyncHandler(async (req, res) => {
  const { items, promo_code, payment_method, delivery_address, client_request_id } = req.body; // items: [{product_id, quantity}]
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Səbət boşdur.' });
  }
  if (!VALID_PAYMENT_METHODS.includes(payment_method)) {
    return res.status(400).json({
      error: `Ödəniş üsulu tələb olunur: ${VALID_PAYMENT_METHODS.join(' və ya ')}.`
    });
  }
  const addressResult = normalizeAddress(delivery_address);
  if (addressResult.error) {
    return res.status(400).json({ error: addressResult.error });
  }

  // ---- Idempotency (duplikasiyanın qarşısı) ----
  // Frontend hər checkout cəhdi üçün bir dəfə `client_request_id` (UUID)
  // yaradır və düymə neçə dəfə klik olunsa/sorğu təkrarlansa da eyni id-ni
  // göndərir. Əgər bu id ilə artıq sifariş yaradılıbsa, YENİ sifariş açmadan
  // mövcud olanı qaytarırıq - beləliklə 1 checkout cəhdindən yalnız 1 order,
  // 1 dəst order_items, 1 bildiriş və 1 status tarixçəsi yaranır.
  if (client_request_id) {
    const existing = (await store.where(
      'orders',
      (o) => o.client_request_id === client_request_id && o.user_id === req.user.id
    ))[0];
    if (existing) {
      return res.status(200).json(await attachItemsAndHistory(existing));
    }
  }

  // Stok yoxlanışı + variant (rəng/şəkil/ölçü) doğrulaması
  const resolvedItems = [];
  for (const it of items) {
    const product = await store.find('products', it.product_id);
    if (!product) return res.status(404).json({ error: `Məhsul tapılmadı (id: ${it.product_id}).` });
    if (product.status === 'out_of_stock' || product.stock_quantity < it.quantity) {
      return res.status(400).json({ error: `"${product.name}" üçün kifayət qədər stok yoxdur.` });
    }
    const variantResult = resolveVariant(product, it.variant);
    if (variantResult.error) return res.status(400).json({ error: variantResult.error });
    resolvedItems.push({ product, quantity: it.quantity, variant: variantResult.variant });
  }

  // Ümumi qiymət (məhsulun öz endirimi ilə)
  let total = 0;
  for (const { product, quantity } of resolvedItems) {
    const finalPrice = +(product.price - (product.price * (product.discount_percent || 0)) / 100).toFixed(2);
    total += finalPrice * quantity;
  }

  // Promokod tətbiqi
  let promo = null;
  if (promo_code) {
    const matches = await store.where('promo_codes', (p) => p.code === promo_code.toUpperCase());
    promo = matches[0] || null;
    if (promo) {
      const now = new Date();
      const expired = promo.valid_until && new Date(promo.valid_until) < now;
      const overLimit = promo.usage_limit !== null && promo.used_count >= promo.usage_limit;
      if (!expired && !overLimit) {
        total = +(total - (total * promo.discount_percent) / 100).toFixed(2);
      } else {
        promo = null;
      }
    }
  }

  total = +total.toFixed(2);

  // ---- Ödəniş emalı ----
  // Kartdan-karta (bank köçürməsi): admin ödənişi qəbul edib təsdiqləyənə qədər sifariş
  // "ödəniş gözlənilir" statusunda qalır - bu mərhələdə emal başlamır, stokdan məhsul
  // çıxılmır və maliyyə hesabatına daxil olunmur.
  let payment_status = 'gözləyir';
  let payment_transaction_id = null;
  let orderStatus = PENDING_TRANSFER_STATUS;
  let stockDeducted = false;

  // Sifarişi yarat.
  // QEYD: `client_request_id` sahəsində DB səviyyəsində unikal indeks var
  // (bax: db/models.js EXTRA_INDEXES.orders). Bu, yuxarıdakı yoxlama ilə
  // sifarişin yaradılması arasında (paralel/yarış vəziyyəti) eyni id ilə
  // 2-ci sorğu gəlsə belə, MongoDB-nin özünün ikinci sənədin yazılmasının
  // qarşısını almasını təmin edir - beləliklə "check-then-insert" arasındakı
  // boşluqdan (məs. eyni anda göndərilən 2 sorğu) sui-istifadə mümkün olmur.
  let order;
  try {
    // DİQQƏT: `client_request_id` sahəsi bazada unikal + sparse indekslidir
    // (bax: db/models.js). Sparse indeks yalnız sahə sənəddə HEÇ OLMADIQDA
    // onu buraxır - əgər sahəni açıq şəkildə `null` kimi yazsaq, sparse
    // indeks bunu YENƏ DƏ indeksləyir və client_request_id göndərilməyən
    // (və ya boş gələn) 2-ci sifarişdə E11000 (duplicate key) xətası ilə
    // sorğu çökürdü. Düzəliş: sahəni yalnız həqiqətən dəyər olduqda əlavə et,
    // əks halda sənəddə ümumiyyətlə yaratma (undefined/null yox).
    const orderRecord = {
      user_id: req.user.id,
      total_price: total,
      promo_code_id: promo ? promo.id : null,
      status: orderStatus,
      payment_method,
      payment_status,
      payment_transaction_id,
      stock_deducted: stockDeducted,
      delivery_address: addressResult.address,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    if (client_request_id) {
      orderRecord.client_request_id = client_request_id;
    }
    order = await store.insert('orders', orderRecord);
  } catch (err) {
    console.error('❌ POST /api/orders - sifariş yaradılarkən xəta:', err.message);
    console.error(err.stack);
    // E11000 = unikal indeks pozuntusu (eyni client_request_id ilə artıq
    // sifariş yaradılıb - başqa paralel sorğu bizi qabaqlayıb). Yeni sifariş
    // açmaq əvəzinə mövcud olanı qaytarırıq.
    if (err && err.code === 11000 && client_request_id) {
      const existing = (await store.where(
        'orders',
        (o) => o.client_request_id === client_request_id && o.user_id === req.user.id
      ))[0];
      if (existing) {
        return res.status(200).json(await attachItemsAndHistory(existing));
      }
    }
    throw err;
  }

  try {
    // Sifariş kodu (id yarandıqdan sonra hesablanır, çünki koda daxildir)
    order = await store.update('orders', order.id, { code: generateOrderCode(order) });

    // Sifariş sətirlərini yarat (hər zaman) + stoku azalt (yalnız stockDeducted true olduqda)
    for (const { product, quantity, variant } of resolvedItems) {
      await store.insert('order_items', {
        order_id: order.id,
        product_id: product.id,
        quantity,
        price_at_purchase: product.price,
        image_url: variant.image_url,
        color_name: variant.color_name,
        color_code: variant.color_code,
        size: variant.size
      });
    }
    if (stockDeducted) {
      await deductStockForItems(resolvedItems);
    }

    // Promokod istifadə sayını artır
    if (promo) {
      await store.update('promo_codes', promo.id, { used_count: (promo.used_count || 0) + 1 });
    }

    // İlk status tarixçəsi
    await store.insert('order_status_history', {
      order_id: order.id,
      status: orderStatus,
      note: 'Sifariş qeydə alındı, kartdan-karta ödənişi gözlənilir.',
      created_at: new Date().toISOString()
    });
  } catch (err) {
    // Sifarişin özü artıq yaradılıb (order.id mövcuddur) - bu blokdakı xəta
    // sətir/stok/tarixçə mərhələsindədir. Dəqiq diaqnostika üçün ətraflı log.
    console.error(`❌ POST /api/orders - order #${order.id} yaradıldı, lakin items/stock/history mərhələsində xəta:`, err.message);
    console.error(err.stack);
    throw err;
  }

  // Bildiriş göndərmək əməliyyatı sifarişin uğurunu poza bilməz - notify() xəta
  // versə belə, müştəriyə 500 qaytarılmamalı, sifariş artıq bazada mövcuddur.
  try {
    await notify(
      order.user_id,
      NOTIFICATION_TYPES.ORDER_CREATED,
      'Sifariş yaradıldı',
      `${order.code} nömrəli sifarişiniz uğurla qeydə alındı.`,
      { order_id: order.id }
    );
  } catch (err) {
    console.error(`❌ POST /api/orders - order #${order.id} yaradıldı, lakin bildiriş (notify) göndərilərkən xəta:`, err.message);
    console.error(err.stack);
    // qəsdən rethrow edilmir - sifariş özü uğurla yaradılıb
  }

  res.status(201).json(await attachItemsAndHistory(order));
}));

// GET /api/orders - müştəri öz sifarişlərini, admin hamısını görür
router.get('/', authenticateToken, asyncHandler(async (req, res) => {
  let orders = await store.all('orders');
  if (!ADMIN_ROLES.includes(req.user.role)) {
    orders = orders.filter((o) => o.user_id === req.user.id);
  }
  orders = orders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const result = [];
  for (const o of orders) {
    result.push(await attachItemsAndHistory(o));
  }
  res.json(result);
}));

// GET /api/orders/:id
router.get('/:id', authenticateToken, asyncHandler(async (req, res) => {
  const order = await store.find('orders', req.params.id);
  if (!order) return res.status(404).json({ error: 'Sifariş tapılmadı.' });
  if (!ADMIN_ROLES.includes(req.user.role) && order.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Bu sifarişə baxmaq icazəniz yoxdur.' });
  }
  res.json(await attachItemsAndHistory(order));
}));

/**
 * GET /api/orders/:id/status
 * Yüngül "polling" endpoint-i - müştəri panelindəki
 * Sifariş İzləmə modulu bunu hər bir neçə saniyədən bir çağırır.
 */
router.get('/:id/status', authenticateToken, asyncHandler(async (req, res) => {
  const order = await store.find('orders', req.params.id);
  if (!order) return res.status(404).json({ error: 'Sifariş tapılmadı.' });
  if (!ADMIN_ROLES.includes(req.user.role) && order.user_id !== req.user.id) {
    return res.status(403).json({ error: 'İcazə yoxdur.' });
  }
  const history = (await store.where('order_status_history', (h) => h.order_id === order.id))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  res.json({
    id: order.id,
    status: order.status,
    updated_at: order.updated_at,
    cancelled_by: order.cancelled_by || null,
    cancellation_reason: order.cancellation_reason || null,
    history
  });
}));

/**
 * PATCH /api/orders/:id/cancel
 * Sifarişi ləğv edir. Həm müştəri özü, həm də admin ləğv edə bilər:
 *  - Müştəri: yalnız sifariş verdikdən sonra 15 dəqiqə ərzində, özününkü olmalıdır.
 *  - Admin: istənilən vaxt, lakin səbəbi qısa qeyd şəklində yazmaq MƏCBURİDİR
 *    (müştəri bunu öz panelində görəcək).
 * Ləğv olunanda stok geri qaytarılır.
 */
router.patch('/:id/cancel', authenticateToken, asyncHandler(async (req, res) => {
  const order = await store.find('orders', req.params.id);
  if (!order) return res.status(404).json({ error: 'Sifariş tapılmadı.' });

  const isAdmin = ADMIN_ROLES.includes(req.user.role);
  if (!isAdmin && order.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Bu sifarişi ləğv etmək icazəniz yoxdur.' });
  }

  if (order.status === CANCELLED_STATUS) {
    return res.status(400).json({ error: 'Bu sifariş artıq ləğv edilib.' });
  }
  if (order.status === 'çatdırıldı') {
    return res.status(400).json({ error: 'Çatdırılmış sifarişi ləğv etmək olmaz.' });
  }

  let note;
  if (isAdmin) {
    note = String(req.body.note || '').trim();
    if (!note) {
      return res.status(400).json({ error: 'Ləğv səbəbini qısaca qeyd etməlisiniz.' });
    }
  } else {
    const elapsed = Date.now() - new Date(order.created_at).getTime();
    if (elapsed > CUSTOMER_CANCEL_WINDOW_MS) {
      return res.status(400).json({ error: 'Sifarişi ləğv etmək müddəti bitib (sifariş verildikdən sonra 15 dəqiqə).' });
    }
    note = String(req.body.note || '').trim() || 'Müştəri tərəfindən ləğv edildi.';
  }

  // Stoku geri qaytar - yalnız əvvəlcədən stokdan çıxılıbsa (kartdan-karta sifarişləri
  // ödəniş təsdiqlənənə qədər stoku heç vaxt azaltmır, ona görə geri qaytarılmamalıdır)
  const wasStockDeducted = order.stock_deducted !== false;
  if (wasStockDeducted) {
    await restoreStockForOrder(order.id);
  }

  const updated = await store.update('orders', order.id, {
    status: CANCELLED_STATUS,
    cancelled_by: isAdmin ? 'admin' : 'customer',
    cancellation_reason: note,
    stock_deducted: false,
    updated_at: new Date().toISOString()
  });
  await store.insert('order_status_history', {
    order_id: order.id,
    status: CANCELLED_STATUS,
    note,
    created_at: new Date().toISOString()
  });

  await notify(
    order.user_id,
    NOTIFICATION_TYPES.ORDER_CANCELLED,
    'Sifariş ləğv edildi',
    `${updated.code || order.code} nömrəli sifarişiniz ləğv edildi. Səbəb: ${note}`,
    { order_id: order.id }
  );

  res.json(await attachItemsAndHistory(updated));
}));

// PATCH /api/orders/:id/status - yalnız admin, statusu dəyişir
router.patch('/:id/status', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { status, note } = req.body;
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Status yalnız bunlardan biri ola bilər: ${VALID_STATUSES.join(', ')}` });
  }
  const order = await store.find('orders', req.params.id);
  if (!order) return res.status(404).json({ error: 'Sifariş tapılmadı.' });

  const updated = await store.update('orders', req.params.id, { status, updated_at: new Date().toISOString() });
  await store.insert('order_status_history', {
    order_id: order.id,
    status,
    note: note || '',
    created_at: new Date().toISOString()
  });

  const notifInfo = STATUS_NOTIFICATIONS[status];
  if (notifInfo) {
    await notify(
      order.user_id,
      notifInfo.type,
      notifInfo.title,
      notifInfo.message(updated.code || order.code),
      { order_id: order.id, status }
    );
  }

  res.json(await attachItemsAndHistory(updated));
}));

/**
 * PATCH /api/orders/:id/confirm-transfer
 * Yalnız admin. Kartdan-karta (bank köçürməsi) ilə verilmiş sifarişlər üçün —
 * admin köçürmənin bank hesabına daxil olduğunu təsdiqləyəndə çağırılır.
 * Bu andan etibarən: sifariş emala başlayır ('qəbul edildi'), stokdan məhsul
 * çıxılır və sifariş maliyyə hesabatına daxil olur (payment_status = 'ödənildi').
 */
router.patch('/:id/confirm-transfer', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const order = await store.find('orders', req.params.id);
  if (!order) return res.status(404).json({ error: 'Sifariş tapılmadı.' });
  if (order.payment_method !== 'kartdan_karta') {
    return res.status(400).json({ error: 'Bu əməliyyat yalnız kartdan-karta ödənişli sifarişlər üçündür.' });
  }
  if (order.status === CANCELLED_STATUS) {
    return res.status(400).json({ error: 'Ləğv edilmiş sifarişin ödənişi təsdiqlənə bilməz.' });
  }
  if (order.payment_status === 'ödənildi') {
    return res.status(400).json({ error: 'Bu sifarişin ödənişi artıq təsdiqlənib.' });
  }

  // Stok yenidən yoxlanılır (təsdiq gecikə bilər, bu müddətdə stok dəyişmiş ola bilər)
  const items = await store.where('order_items', (i) => i.order_id === order.id);
  for (const i of items) {
    const product = await store.find('products', i.product_id);
    if (!product || product.stock_quantity < i.quantity) {
      return res.status(400).json({
        error: `"${product ? product.name : 'Məhsul'}" üçün kifayət qədər stok yoxdur, ödəniş təsdiqlənə bilmədi.`
      });
    }
  }

  await deductStockForOrder(order.id);

  const updated = await store.update('orders', order.id, {
    payment_status: 'ödənildi',
    status: 'qəbul edildi',
    stock_deducted: true,
    updated_at: new Date().toISOString()
  });
  await store.insert('order_status_history', {
    order_id: order.id,
    status: 'qəbul edildi',
    note: 'Kartdan-karta ödənişi admin tərəfindən təsdiqləndi, sifariş emala başladı.',
    created_at: new Date().toISOString()
  });

  await notify(
    order.user_id,
    NOTIFICATION_TYPES.PAYMENT_CONFIRMED,
    'Ödəniş təsdiqləndi',
    `${updated.code || order.code} nömrəli sifarişinizin ödənişi təsdiqləndi, sifariş emala başladı.`,
    { order_id: order.id }
  );

  res.json(await attachItemsAndHistory(updated));
}));

// DELETE /api/orders/:id - yalnız admin, sifarişi (və ona aid sətir/tarixçəni) bazadan tam silir.
// Diqqət: bu, ləğv etməkdən fərqlidir - sifariş tam silinir, stok geri qaytarılmır
// (silinən sifarişlər adətən artıq tamamlanmış/arxivlənməli qeydlərdir).
router.delete('/:id', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const order = await store.find('orders', req.params.id);
  if (!order) return res.status(404).json({ error: 'Sifariş tapılmadı.' });

  const items = await store.where('order_items', (i) => i.order_id === order.id);
  for (const i of items) {
    await store.remove('order_items', i.id);
  }
  const history = await store.where('order_status_history', (h) => h.order_id === order.id);
  for (const h of history) {
    await store.remove('order_status_history', h.id);
  }
  await store.remove('orders', order.id);

  res.json({ success: true });
}));

module.exports = router;
