/**
 * Trendora - Nümunə məlumatlarla MongoDB Atlas bazasını doldurur.
 * İşə salmaq: npm run seed
 *
 * QEYD: Bu skript mövcud "users", "categories", "products" və "promo_codes"
 * kolleksiyalarını təmizləyib yenidən doldurur (digər kolleksiyalara toxunmur).
 */
require('dotenv').config();

const bcrypt = require('bcryptjs');
const { connectDB, disconnectDB, mongoose } = require('./mongoose');
const store = require('./store');
const { getModel } = require('./models');

async function resetCollections() {
  await getModel('users').deleteMany({});
  await getModel('categories').deleteMany({});
  await getModel('products').deleteMany({});
  await getModel('promo_codes').deleteMany({});
  // Sayğacları da sıfırla ki, id-lər 1-dən başlasın
  const Counter = mongoose.models.Counter;
  if (Counter) {
    await Counter.deleteMany({ _id: { $in: ['users', 'categories', 'products', 'promo_codes'] } });
  }
}

async function seed() {
  await connectDB();
  console.log('✅ MongoDB Atlas-a qoşuldu, bazanı doldururuq...');

  await resetCollections();

  // ---- Admin istifadəçilər (rol iyerarxiyası: super_admin > admin > operator) ----
  const superAdminPass = bcrypt.hashSync('admin123', 10);
  await store.insert('users', {
    name: 'Admin',
    surname: 'Trendora',
    email: 'admin@trendora.az',
    password_hash: superAdminPass,
    phone: '+994501234567',
    role: 'super_admin',
    status: 'active',
    address: '',
    avatar_url: '',
    birth_date: '',
    gender: '',
    created_at: new Date().toISOString()
  });

  const adminPass = bcrypt.hashSync('admin123', 10);
  await store.insert('users', {
    name: 'Elvin',
    surname: 'Quliyev',
    email: 'elvin.admin@trendora.az',
    password_hash: adminPass,
    phone: '+994551234567',
    role: 'admin',
    status: 'active',
    address: '',
    avatar_url: '',
    birth_date: '',
    gender: '',
    created_at: new Date().toISOString()
  });

  const operatorPass = bcrypt.hashSync('admin123', 10);
  await store.insert('users', {
    name: 'Nərmin',
    surname: 'Əliyeva',
    email: 'nermin.operator@trendora.az',
    password_hash: operatorPass,
    phone: '+994701234567',
    role: 'operator',
    status: 'active',
    address: '',
    avatar_url: '',
    birth_date: '',
    gender: '',
    created_at: new Date().toISOString()
  });

  // ---- Nümunə müştəri ----
  const customerPass = bcrypt.hashSync('musteri123', 10);
  await store.insert('users', {
    name: 'Aysel',
    surname: 'Məmmədova',
    email: 'aysel@example.com',
    password_hash: customerPass,
    phone: '+994551112233',
    role: 'customer',
    address: 'Bakı, Nərimanov r.',
    avatar_url: '',
    birth_date: '',
    gender: 'qadın',
    created_at: new Date().toISOString()
  });

  // ---- Kateqoriyalar ----
  const elektronika = await store.insert('categories', { name: 'Elektronika', parent_id: null });
  const geyim = await store.insert('categories', { name: 'Geyim', parent_id: null });
  const evEshya = await store.insert('categories', { name: 'Ev əşyaları', parent_id: null });

  // ---- Məhsullar ----
  async function addProduct(p) {
    return store.insert('products', {
      category_id: p.category_id,
      name: p.name,
      description: p.description,
      price: p.price,
      stock_quantity: p.stock_quantity,
      discount_percent: p.discount_percent || 0,
      status: p.stock_quantity > 0 ? 'active' : 'out_of_stock',
      image_url: p.image_url || '',
      created_at: new Date().toISOString()
    });
  }

  await addProduct({
    category_id: elektronika.id,
    name: 'Simsiz Qulaqlıq X200',
    description: 'Aktiv səs-küy söndürmə ilə simsiz qulaqlıq',
    price: 89.99,
    stock_quantity: 25,
    discount_percent: 10,
    image_url: 'https://picsum.photos/seed/headphones/400/400'
  });

  await addProduct({
    category_id: elektronika.id,
    name: 'Ağıllı Saat Pro',
    description: 'Nəbz ölçmə, GPS və bildiriş dəstəyi olan ağıllı saat',
    price: 149.5,
    stock_quantity: 0,
    discount_percent: 0,
    image_url: 'https://picsum.photos/seed/smartwatch/400/400'
  });

  await addProduct({
    category_id: geyim.id,
    name: 'Kişi Pambıq Köynək',
    description: '100% pambıq, rahat kəsim',
    price: 24.99,
    stock_quantity: 60,
    discount_percent: 15,
    image_url: 'https://picsum.photos/seed/shirt/400/400'
  });

  await addProduct({
    category_id: evEshya.id,
    name: 'Aromatik Şam Dəsti (3 ədəd)',
    description: 'Lavanda, vanil və sedr ətirli əl işi şamlar',
    price: 19.0,
    stock_quantity: 40,
    discount_percent: 0,
    image_url: 'https://picsum.photos/seed/candles/400/400'
  });

  // ---- Promokodlar ----
  await store.insert('promo_codes', {
    code: 'TRENDORA10',
    discount_percent: 10,
    valid_from: new Date().toISOString(),
    valid_until: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    usage_limit: 100,
    used_count: 0
  });

  console.log('✅ Seed tamamlandı.');
  console.log('Super Admin login: admin@trendora.az / admin123');
  console.log('Admin login: elvin.admin@trendora.az / admin123');
  console.log('Operator login: nermin.operator@trendora.az / admin123');
  console.log('Müştəri login: aysel@example.com / musteri123');
  console.log('Promokod: TRENDORA10 (10% endirim)');

  await disconnectDB();
  process.exit(0);
}

seed().catch((err) => {
  console.error('❌ Seed zamanı xəta baş verdi:', err);
  process.exit(1);
});
