const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const store = require('../db/store');
const asyncHandler = require('../utils/asyncHandler');
const { authenticateToken, requireAdmin, ADMIN_ROLES, generateAuthToken } = require('../middleware/auth');

const router = express.Router();

// Yüklənmiş profil şəkillərinin saxlanacağı qovluq (məhsul şəkilləri ilə eyni qovluq)
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const ALLOWED_MIME_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
};
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const VALID_GENDERS = ['kişi', 'qadın', 'bildirmək istəmirəm'];
const PIN_REGEX = /^\d{4}$/;

// İstifadəçi obyektindən şifrə/PIN hash-lərini çıxarır və PIN-in
// təyin olunub-olunmadığını göstərən `pin_set` bayrağını əlavə edir.
// PIN dəyəri özü heç vaxt frontend-ə göndərilmir (yalnız **** kimi göstərilir).
function toSafeUser(user) {
  const { password_hash: _ph, security_pin_hash: _pin, ...safeUser } = user;
  return { ...safeUser, pin_set: Boolean(user.security_pin_hash) };
}

// POST /api/auth/register
router.post('/register', asyncHandler(async (req, res) => {
  const { name, surname, email, password, phone, address, pin, confirm_pin } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Ad, email və şifrə mütləqdir.' });
  }
  if (!pin || !confirm_pin) {
    return res.status(400).json({ error: 'PIN və PIN-in təkrarı mütləqdir.' });
  }
  if (!PIN_REGEX.test(String(pin))) {
    return res.status(400).json({ error: 'PIN 4 rəqəmdən ibarət olmalıdır.' });
  }
  if (String(pin) !== String(confirm_pin)) {
    return res.status(400).json({ error: 'PIN-lər uyğun gəlmir.' });
  }
  const existing = await store.where('users', (u) => u.email === email);
  if (existing.length > 0) {
    return res.status(409).json({ error: 'Bu email artıq qeydiyyatdan keçib.' });
  }
  const password_hash = bcrypt.hashSync(password, 10);
  const security_pin_hash = bcrypt.hashSync(String(pin), 10);
  const user = await store.insert('users', {
    name,
    surname: surname || '',
    email,
    password_hash,
    phone: phone || '',
    address: address || '',
    avatar_url: '',
    birth_date: '',
    gender: '',
    role: 'customer',
    security_pin_hash,
    token_version: 0,
    created_at: new Date().toISOString()
  });

  const token = generateAuthToken(user);
  res.status(201).json({ token, user: toSafeUser(user) });
}));

// POST /api/auth/login
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const matches = await store.where('users', (u) => u.email === email);
  const user = matches[0];
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Email və ya şifrə yanlışdır.' });
  }
  if (ADMIN_ROLES.includes(user.role) && (user.status || 'active') === 'inactive') {
    return res.status(403).json({ error: 'Bu admin hesabı deaktiv edilib. Zəhmət olmasa Super Admin ilə əlaqə saxlayın.' });
  }
  const token = generateAuthToken(user);
  res.json({ token, user: toSafeUser(user) });
}));

// ---------- Şifrəni unutdum ----------
// E-poçt/SMTP əsaslı bərpa YOXDUR. İstifadəçi qeydiyyat zamanı təyin
// etdiyi (və profilindən istənilən vaxt dəyişə bildiyi) 4 rəqəmli
// təhlükəsizlik PIN-ini bilməklə şifrəsini bərpa edir. PIN yalnız
// hash olunmuş formada (security_pin_hash) saxlanılır və heç vaxt
// açıq mətn kimi API cavabında qaytarılmır.
const PIN_RESET_MAX_ATTEMPTS = 5; // icazə verilən maksimum səhv cəhd sayı
const PIN_RESET_BLOCK_MS = 15 * 60 * 1000; // müvəqqəti blok müddəti (15 dəqiqə)

// POST /api/auth/forgot-password/check - email mövcuddursa və PIN təyin olunubsa təsdiqləyir
router.post('/forgot-password/check', asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email || !String(email).trim()) {
    return res.status(400).json({ error: 'Email tələb olunur.' });
  }

  const matches = await store.where('users', (u) => u.email === String(email).trim());
  const user = matches[0];
  if (!user) {
    return res.status(404).json({ error: 'Bu email ilə istifadəçi tapılmadı.' });
  }
  if (!user.security_pin_hash) {
    return res.status(400).json({ error: 'Bu hesab üçün təhlükəsizlik PIN-i təyin olunmayıb.' });
  }
  if (user.pin_reset_blocked_until && new Date(user.pin_reset_blocked_until).getTime() > Date.now()) {
    const remainingMin = Math.ceil((new Date(user.pin_reset_blocked_until).getTime() - Date.now()) / 60000);
    return res.status(429).json({ error: `Çoxlu səhv cəhd səbəbindən müvəqqəti bloklanıb. ${remainingMin} dəqiqə sonra yenidən cəhd edin.` });
  }

  res.json({ exists: true });
}));

// POST /api/auth/forgot-password/reset - hesabın öz 4 rəqəmli PIN-i düzgündürsə şifrəni yeniləyir
router.post('/forgot-password/reset', asyncHandler(async (req, res) => {
  const { email, pin, new_password, confirm_password } = req.body;
  if (!email || !pin || !new_password || !confirm_password) {
    return res.status(400).json({ error: 'Bütün sahələr tələb olunur.' });
  }
  if (!PIN_REGEX.test(String(pin))) {
    return res.status(400).json({ error: 'PIN 4 rəqəmdən ibarət olmalıdır.' });
  }
  if (new_password !== confirm_password) {
    return res.status(400).json({ error: 'Şifrələr uyğun gəlmir.' });
  }
  if (String(new_password).length < 6) {
    return res.status(400).json({ error: 'Yeni şifrə ən azı 6 simvol olmalıdır.' });
  }

  const matches = await store.where('users', (u) => u.email === String(email).trim());
  const user = matches[0];
  if (!user) {
    return res.status(404).json({ error: 'Bu email ilə istifadəçi tapılmadı.' });
  }
  if (!user.security_pin_hash) {
    return res.status(400).json({ error: 'Bu hesab üçün təhlükəsizlik PIN-i təyin olunmayıb.' });
  }

  if (user.pin_reset_blocked_until && new Date(user.pin_reset_blocked_until).getTime() > Date.now()) {
    const remainingMin = Math.ceil((new Date(user.pin_reset_blocked_until).getTime() - Date.now()) / 60000);
    return res.status(429).json({ error: `Çoxlu səhv cəhd səbəbindən müvəqqəti bloklanıb. ${remainingMin} dəqiqə sonra yenidən cəhd edin.` });
  }
  if (!bcrypt.compareSync(String(pin).trim(), user.security_pin_hash)) {
    const attempts = (user.pin_reset_attempts || 0) + 1;
    if (attempts >= PIN_RESET_MAX_ATTEMPTS) {
      await store.update('users', user.id, {
        pin_reset_attempts: attempts,
        pin_reset_blocked_until: new Date(Date.now() + PIN_RESET_BLOCK_MS).toISOString()
      });
      const blockMin = Math.round(PIN_RESET_BLOCK_MS / 60000);
      return res.status(429).json({ error: `Çoxlu səhv cəhd səbəbindən müvəqqəti bloklandınız. ${blockMin} dəqiqə sonra yenidən cəhd edin.` });
    }
    await store.update('users', user.id, { pin_reset_attempts: attempts });
    return res.status(400).json({ error: 'PIN kodu yanlışdır.' });
  }

  const password_hash = bcrypt.hashSync(new_password, 10);
  await store.update('users', user.id, {
    password_hash,
    pin_reset_attempts: 0,
    pin_reset_blocked_until: ''
  });

  res.json({ success: true });
}));

// GET /api/auth/me
router.get('/me', authenticateToken, asyncHandler(async (req, res) => {
  const user = await store.find('users', req.user.id);
  if (!user) return res.status(404).json({ error: 'İstifadəçi tapılmadı.' });
  res.json(toSafeUser(user));
}));

// POST /api/auth/upload-avatar - daxil olmuş istifadəçi öz profil şəklini yükləyir
router.post('/upload-avatar', authenticateToken, asyncHandler(async (req, res) => {
  const { image } = req.body;
  if (!image || typeof image !== 'string') {
    return res.status(400).json({ error: 'Şəkil məlumatı tələb olunur.' });
  }

  const match = image.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  if (!match) {
    return res.status(400).json({ error: 'Şəkil formatı düzgün deyil.' });
  }

  const ext = ALLOWED_MIME_EXT[match[1]];
  if (!ext) {
    return res.status(400).json({ error: 'Yalnız JPG, PNG, WEBP və ya GIF formatına icazə verilir.' });
  }

  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > MAX_IMAGE_SIZE) {
    return res.status(400).json({ error: 'Şəkil ölçüsü 5MB-dan böyük ola bilməz.' });
  }

  const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);

  res.status(201).json({ avatar_url: `/uploads/${filename}` });
}));

// PUT /api/auth/me - daxil olmuş istifadəçi öz profilini redaktə edir
router.put('/me', authenticateToken, asyncHandler(async (req, res) => {
  const existing = await store.find('users', req.user.id);
  if (!existing) return res.status(404).json({ error: 'İstifadəçi tapılmadı.' });

  const { name, surname, email, phone, birth_date, gender, avatar_url } = req.body;

  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Ad tələb olunur.' });
  }
  if (!email || !String(email).trim()) {
    return res.status(400).json({ error: 'Email tələb olunur.' });
  }
  if (gender && !VALID_GENDERS.includes(gender)) {
    return res.status(400).json({ error: 'Cins düzgün seçilməyib.' });
  }
  if (birth_date) {
    const d = new Date(birth_date);
    if (isNaN(d.getTime()) || d > new Date()) {
      return res.status(400).json({ error: 'Doğum tarixi düzgün deyil.' });
    }
  }

  const emailTaken = await store.where('users', (u) => u.id !== existing.id && u.email === email);
  if (emailTaken.length > 0) {
    return res.status(409).json({ error: 'Bu email artıq başqa hesab tərəfindən istifadə olunur.' });
  }

  const updated = await store.update('users', req.user.id, {
    name: String(name).trim(),
    surname: surname !== undefined ? String(surname).trim() : existing.surname,
    email: String(email).trim(),
    phone: phone !== undefined ? String(phone).trim() : existing.phone,
    birth_date: birth_date !== undefined ? birth_date : existing.birth_date,
    gender: gender !== undefined ? gender : existing.gender,
    avatar_url: avatar_url !== undefined ? avatar_url : existing.avatar_url
  });

  res.json(toSafeUser(updated));
}));

// PATCH /api/auth/me/password - daxil olmuş istifadəçi öz şifrəsini dəyişir
router.patch('/me/password', authenticateToken, asyncHandler(async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Cari və yeni şifrə tələb olunur.' });
  }
  if (String(new_password).length < 6) {
    return res.status(400).json({ error: 'Yeni şifrə ən azı 6 simvol olmalıdır.' });
  }

  const user = await store.find('users', req.user.id);
  if (!user) return res.status(404).json({ error: 'İstifadəçi tapılmadı.' });
  if (!bcrypt.compareSync(current_password, user.password_hash)) {
    return res.status(401).json({ error: 'Cari şifrə yanlışdır.' });
  }

  const password_hash = bcrypt.hashSync(new_password, 10);
  await store.update('users', req.user.id, { password_hash });
  res.json({ success: true });
}));

// ---------- Təhlükəsizlik PIN-i (4 rəqəm) ----------
// Qeyd: PIN dəyəri şifrə kimi hash-lənərək saxlanılır və heç vaxt açıq
// şəkildə geri qaytarılmır. Frontend yalnız `pin_set` bayrağına əsasən
// PIN-i "****" kimi göstərir.

// PATCH /api/auth/me/pin - daxil olmuş müştəri öz PIN-ini təyin edir/dəyişir
router.patch('/me/pin', authenticateToken, asyncHandler(async (req, res) => {
  const { current_pin, new_pin, confirm_pin } = req.body;
  if (!new_pin || !confirm_pin) {
    return res.status(400).json({ error: 'Yeni PIN və təkrarı tələb olunur.' });
  }
  if (!PIN_REGEX.test(String(new_pin))) {
    return res.status(400).json({ error: 'PIN 4 rəqəmdən ibarət olmalıdır.' });
  }
  if (String(new_pin) !== String(confirm_pin)) {
    return res.status(400).json({ error: 'Yeni PIN-lər uyğun gəlmir.' });
  }

  const user = await store.find('users', req.user.id);
  if (!user) return res.status(404).json({ error: 'İstifadəçi tapılmadı.' });

  // Əgər əvvəllər PIN təyin olunubsa, dəyişmək üçün cari PIN təsdiqlənməlidir.
  if (user.security_pin_hash) {
    if (!current_pin) {
      return res.status(400).json({ error: 'Cari PIN tələb olunur.' });
    }
    if (!bcrypt.compareSync(String(current_pin), user.security_pin_hash)) {
      return res.status(401).json({ error: 'Cari PIN yanlışdır.' });
    }
  }

  const security_pin_hash = bcrypt.hashSync(String(new_pin), 10);
  const updated = await store.update('users', req.user.id, { security_pin_hash });
  res.json(toSafeUser(updated));
}));

// GET /api/auth/users - yalnız admin, bütün müştəriləri görür
router.get('/users', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const allUsers = await store.all('users');
  const users = allUsers
    .filter((u) => u.role === 'customer')
    .map(toSafeUser)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(users);
}));

// PATCH /api/auth/users/:id/force-logout - admin bir müştərinin sessiyasını ləğv edir.
// `token_version` artırılır, ona görə həmin istifadəçinin əlindəki köhnə token(lər)
// (heç vaxt bitmə tarixi olmasa belə) dərhal etibarsız olur və növbəti sorğuda
// yenidən daxil olmağa məcbur qalır.
router.patch('/users/:id/force-logout', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const existing = await store.find('users', req.params.id);
  if (!existing || existing.role !== 'customer') {
    return res.status(404).json({ error: 'Müştəri tapılmadı.' });
  }
  const updated = await store.update('users', existing.id, { token_version: (existing.token_version || 0) + 1 });
  res.json({ success: true, user: toSafeUser(updated) });
}));

module.exports = router;
