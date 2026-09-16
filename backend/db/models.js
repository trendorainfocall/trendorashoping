/**
 * Trendora - Mongoose modelləri
 * ------------------------------------------------------------------
 * Köhnə fayl-əsaslı "cədvəl" strukturu (bax: köhnə `db/store.js`) sərbəst
 * formalı (schemaless) JSON qeydlərindən ibarət idi. Mövcud bütün
 * route-lar və frontend bu qeydlərə `id` (ədəd) sahəsi ilə istinad edir
 * (foreign key-lər də ədəddir, məs. `product.category_id`).
 *
 * Tam uyğunluğu qorumaq üçün hər "cədvəl" üçün çevik (strict:false) bir
 * Mongoose sxemi yaradılır — yalnız `id` sahəsi named/unikal ədəd kimi
 * tələb olunur, qalan bütün sahələr sərbəst saxlanılır. Bu yolla mövcud
 * bütün route-lar (CRUD məntiqi) demək olar ki, dəyişmədən işləyir.
 */

const mongoose = require('mongoose');

// Köhnə `DEFAULT_DATA`-dakı bütün "cədvəllər" (kolleksiyalar)
const COLLECTIONS = [
  'users',
  'categories',
  'products',
  'orders',
  'order_items',
  'order_status_history',
  'promo_codes',
  'chat_messages',
  'admin_logs',
  'warehouse_costs',
  'wheel_campaigns',
  'wheel_sectors',
  'wheel_spins',
  'brands',
  'brand_marquee_settings',
  'social_links',
  'payment_settings',
  'delivery_settings',
  'notifications',
  'sound_settings',
  'company_info',
  'favorites',
  'reviews',
  'general_sizes'
];

// ---- Avtomatik artan `id` sayğacı (auto-increment əvəzedicisi) ----
const counterSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // cədvəl adı
    seq: { type: Number, default: 0 }
  },
  { versionKey: false, collection: 'counters' }
);

function getCounterModel() {
  return mongoose.models.Counter || mongoose.model('Counter', counterSchema, 'counters');
}

/**
 * Verilmiş cədvəl üçün növbəti unikal, ardıcıl `id`-ni qaytarır.
 * (Atomik `$inc` əməliyyatı ilə - paralel sorğularda təhlükəsizdir.)
 */
async function nextId(table) {
  const Counter = getCounterModel();
  const counter = await Counter.findByIdAndUpdate(
    table,
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return counter.seq;
}

const modelCache = {};

// Tez-tez filtr edilən sahələr üçün əlavə indekslər - bunlar olmadan Mongo
// hər sorğuda bütün kolleksiyanı skan etməli olur (COLLSCAN). `id` sahəsi
// artıq unikal indekslidir, aşağıdakılar isə `findWhere`/`aggregate` ilə
// edilən tez-tez sorğular üçün (məs. bir məhsulun rəyləri/sevimliləri,
// kateqoriyaya/statusa görə məhsul filtri) sürəti artırır.
const EXTRA_INDEXES = {
  products: [{ category_id: 1 }, { status: 1 }],
  reviews: [{ product_id: 1 }],
  favorites: [{ product_id: 1 }, { user_id: 1 }],
  order_items: [{ order_id: 1 }, { product_id: 1 }],
  notifications: [{ user_id: 1 }],
  // `client_request_id` checkout sorğusunun idempotency açarıdır - eyni
  // sorğu (məs. 1 kliklə göndərilən, amma şəbəkə/UI səbəbindən bir neçə
  // dəfə backend-ə çatan sorğu) eyni açarla gələndə unikal indeks MongoDB
  // səviyyəsində ikinci sifarişin yaranmasının qarşısını alır (bax:
  // routes/orders.js POST /). `sparse: true` - açar göndərilməyən köhnə/başqa
  // qeydlərə (və ya açarsız sorğulara) mane olmasın deyə.
  orders: [{ client_request_id: 1, options: { unique: true, sparse: true } }]
};

/**
 * Verilmiş cədvəl (kolleksiya) adı üçün Mongoose modelini qaytarır,
 * lazım gələrsə yaradır. `strict: false` sayəsində hər cədvəlin öz sərbəst
 * sahələri (köhnə JSON-DB-dəki kimi) problemsiz saxlanılır.
 */
function getModel(table) {
  if (!COLLECTIONS.includes(table)) {
    throw new Error(`Naməlum cədvəl: "${table}"`);
  }
  if (modelCache[table]) return modelCache[table];

  const schema = new mongoose.Schema(
    {
      id: { type: Number, required: true, index: true, unique: true }
    },
    { strict: false, versionKey: false, collection: table }
  );

  (EXTRA_INDEXES[table] || []).forEach((idx) => {
    const { options, ...fields } = idx;
    schema.index(fields, options || {});
  });

  const model = mongoose.models[table] || mongoose.model(table, schema, table);
  modelCache[table] = model;
  return model;
}

module.exports = { getModel, nextId, COLLECTIONS };
