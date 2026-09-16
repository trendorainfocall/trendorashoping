const express = require('express');
const bcrypt = require('bcryptjs');
const store = require('../db/store');
const asyncHandler = require('../utils/asyncHandler');
const {
  authenticateToken,
  requireAdmin,
  requireAdminManager,
  requireSuperAdmin,
  ADMIN_ROLES
} = require('../middleware/auth');
const { isValidImageUrlFormat, looksLikeNonImageFile } = require('../utils/imageUrl');

const router = express.Router();

// Profil şəkli linki (URL) doğrulanır - boş dəyərə icazə verilir (şəkilsiz profil)
function validateAvatarUrl(avatar_url) {
  if (avatar_url === undefined || avatar_url === null || !String(avatar_url).trim()) {
    return null;
  }
  const trimmed = String(avatar_url).trim();
  if (!isValidImageUrlFormat(trimmed)) {
    return 'Profil şəkli linki düzgün deyil. Link http:// və ya https:// ilə başlamalıdır.';
  }
  if (looksLikeNonImageFile(trimmed)) {
    return 'Daxil edilən link şəkil faylına oxşamır. Zəhmət olmasa şəkil linki daxil edin.';
  }
  return null;
}

// ---------------------------------------------------------------
// Admin İdarəetməsi
// ---------------------------------------------------------------
// Rol iyerarxiyası: super_admin > admin > operator
//  - Siyahı / axtarış / filtr:  hər üç rol görə bilər
//  - Redaktə / Aktiv-Deaktiv:   yalnız super_admin və admin
//  - Yeni admin yarat / Sil:    yalnız super_admin
// Bütün yaratma / redaktə / silmə / status dəyişmə əməliyyatları
// admin_logs cədvəlində qeydə alınır.
// ---------------------------------------------------------------

function safeAdmin(user) {
  const { password_hash: _, ...safe } = user;
  return safe;
}

async function logAction(actor, action, target, details) {
  await store.insert('admin_logs', {
    actor_id: actor.id,
    actor_name: `${actor.name || ''} ${actor.surname || ''}`.trim() || actor.email,
    actor_role: actor.role,
    action, // 'create' | 'update' | 'delete' | 'activate' | 'deactivate'
    target_id: target ? target.id : null,
    target_name: target ? `${target.name || ''} ${target.surname || ''}`.trim() || target.email : null,
    details: details || '',
    created_at: new Date().toISOString()
  });
}

// GET /api/admins - siyahı, axtarış (q) və filtr (role, status)
router.get('/', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { q, role, status } = req.query;
  const allUsers = await store.all('users');
  let admins = allUsers.filter((u) => ADMIN_ROLES.includes(u.role));

  if (role) admins = admins.filter((a) => a.role === role);
  if (status) admins = admins.filter((a) => (a.status || 'active') === status);
  if (q) {
    const query = q.toLowerCase();
    admins = admins.filter((a) =>
      `${a.name} ${a.surname}`.toLowerCase().includes(query) ||
      (a.email || '').toLowerCase().includes(query) ||
      (a.phone || '').toLowerCase().includes(query)
    );
  }

  admins = admins.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(admins.map(safeAdmin));
}));

// GET /api/admins/logs - admin əməliyyat tarixçəsi
router.get('/logs', authenticateToken, requireAdminManager, asyncHandler(async (req, res) => {
  const logs = (await store.all('admin_logs')).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(logs);
}));

// GET /api/admins/:id - tək admin
router.get('/:id', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const admin = await store.find('users', req.params.id);
  if (!admin || !ADMIN_ROLES.includes(admin.role)) {
    return res.status(404).json({ error: 'Admin tapılmadı.' });
  }
  res.json(safeAdmin(admin));
}));

// POST /api/admins - yeni admin yarat (yalnız super_admin)
router.post('/', authenticateToken, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { name, surname, email, password, phone, role, avatar_url } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Ad, email və şifrə tələb olunur.' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'Şifrə ən azı 6 simvol olmalıdır.' });
  }
  if (!role || !ADMIN_ROLES.includes(role)) {
    return res.status(400).json({ error: `Rol düzgün seçilməyib. Seçimlər: ${ADMIN_ROLES.join(', ')}` });
  }
  const avatarError = validateAvatarUrl(avatar_url);
  if (avatarError) return res.status(400).json({ error: avatarError });

  const existing = await store.where('users', (u) => u.email === email);
  if (existing.length > 0) {
    return res.status(409).json({ error: 'Bu email artıq istifadə olunur.' });
  }

  const password_hash = bcrypt.hashSync(password, 10);
  const admin = await store.insert('users', {
    name,
    surname: surname || '',
    email,
    password_hash,
    phone: phone || '',
    address: '',
    avatar_url: avatar_url ? String(avatar_url).trim() : '',
    birth_date: '',
    gender: '',
    role,
    status: 'active',
    token_version: 0,
    created_by: req.user.id,
    created_at: new Date().toISOString()
  });

  await logAction(req.user, 'create', admin, `Rol: ${role}`);
  res.status(201).json(safeAdmin(admin));
}));

// PUT /api/admins/:id - admini redaktə et (super_admin və admin)
router.put('/:id', authenticateToken, requireAdminManager, asyncHandler(async (req, res) => {
  const existing = await store.find('users', req.params.id);
  if (!existing || !ADMIN_ROLES.includes(existing.role)) {
    return res.status(404).json({ error: 'Admin tapılmadı.' });
  }

  // admin rolu olan istifadəçi yalnız super_admin tərəfindən redaktə oluna bilər
  if (existing.role === 'super_admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Super Admin hesabını yalnız başqa bir Super Admin redaktə edə bilər.' });
  }

  const { name, surname, email, phone, role, password, avatar_url } = req.body;

  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Ad tələb olunur.' });
  if (!email || !String(email).trim()) return res.status(400).json({ error: 'Email tələb olunur.' });
  const avatarError = validateAvatarUrl(avatar_url);
  if (avatarError) return res.status(400).json({ error: avatarError });

  const emailTaken = await store.where('users', (u) => u.id !== existing.id && u.email === email);
  if (emailTaken.length > 0) {
    return res.status(409).json({ error: 'Bu email artıq başqa hesab tərəfindən istifadə olunur.' });
  }

  const patch = {
    name: String(name).trim(),
    surname: surname !== undefined ? String(surname).trim() : existing.surname,
    email: String(email).trim(),
    phone: phone !== undefined ? String(phone).trim() : existing.phone,
    avatar_url: avatar_url !== undefined ? String(avatar_url).trim() : existing.avatar_url
  };

  // Rol dəyişikliyi
  if (role !== undefined && role !== existing.role) {
    if (!ADMIN_ROLES.includes(role)) {
      return res.status(400).json({ error: `Rol düzgün seçilməyib. Seçimlər: ${ADMIN_ROLES.join(', ')}` });
    }
    // Yalnız super_admin başqasına super_admin rolu verə bilər
    if ((role === 'super_admin' || existing.role === 'super_admin') && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Yalnız Super Admin, Super Admin rolunu təyin edə və ya dəyişə bilər.' });
    }
    patch.role = role;
  }

  // İstəyə bağlı şifrə sıfırlama
  if (password) {
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Yeni şifrə ən azı 6 simvol olmalıdır.' });
    }
    patch.password_hash = bcrypt.hashSync(password, 10);
  }

  const updated = await store.update('users', existing.id, patch);
  await logAction(req.user, 'update', updated, role && role !== existing.role ? `Rol dəyişdi: ${existing.role} → ${role}` : 'Məlumatlar yeniləndi');
  res.json(safeAdmin(updated));
}));

// PATCH /api/admins/:id/status - aktiv/deaktiv et (super_admin və admin)
router.patch('/:id/status', authenticateToken, requireAdminManager, asyncHandler(async (req, res) => {
  const existing = await store.find('users', req.params.id);
  if (!existing || !ADMIN_ROLES.includes(existing.role)) {
    return res.status(404).json({ error: 'Admin tapılmadı.' });
  }

  const { status } = req.body;
  if (!['active', 'inactive'].includes(status)) {
    return res.status(400).json({ error: "Status 'active' və ya 'inactive' olmalıdır." });
  }

  if (existing.id === req.user.id) {
    return res.status(400).json({ error: 'Öz hesabınızın statusunu dəyişə bilməzsiniz.' });
  }
  if (existing.role === 'super_admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Super Admin hesabının statusunu yalnız başqa bir Super Admin dəyişə bilər.' });
  }
  if (existing.role === 'super_admin' && status === 'inactive') {
    const activeSuperAdmins = await store.where('users', (u) => u.role === 'super_admin' && (u.status || 'active') === 'active');
    if (activeSuperAdmins.length <= 1) {
      return res.status(400).json({ error: 'Sistemdə ən azı bir aktiv Super Admin qalmalıdır.' });
    }
  }

  // Deaktiv edildikdə əlindəki bütün köhnə tokenlər dərhal etibarsız olsun deyə
  // sessiyası da ləğv edilir (token_version artırılır).
  const patch = { status };
  if (status === 'inactive') {
    patch.token_version = (existing.token_version || 0) + 1;
  }
  const updated = await store.update('users', existing.id, patch);
  await logAction(req.user, status === 'active' ? 'activate' : 'deactivate', updated);
  res.json(safeAdmin(updated));
}));

// PATCH /api/admins/:id/force-logout - hesabı deaktiv etmədən sadəcə cari sessiyasını ləğv edir
// (super_admin və admin). İstifadəçi əlindəki tokenlə bir daha sorğu göndərə bilməz və
// yenidən email/şifrə ilə daxil olmalıdır.
router.patch('/:id/force-logout', authenticateToken, requireAdminManager, asyncHandler(async (req, res) => {
  const existing = await store.find('users', req.params.id);
  if (!existing || !ADMIN_ROLES.includes(existing.role)) {
    return res.status(404).json({ error: 'Admin tapılmadı.' });
  }
  if (existing.role === 'super_admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Super Admin hesabının sessiyasını yalnız başqa bir Super Admin ləğv edə bilər.' });
  }

  const updated = await store.update('users', existing.id, { token_version: (existing.token_version || 0) + 1 });
  await logAction(req.user, 'force_logout', updated, 'Sessiya admin tərəfindən ləğv edildi');
  res.json(safeAdmin(updated));
}));

// DELETE /api/admins/:id - admini sil (yalnız super_admin)
router.delete('/:id', authenticateToken, requireSuperAdmin, asyncHandler(async (req, res) => {
  const existing = await store.find('users', req.params.id);
  if (!existing || !ADMIN_ROLES.includes(existing.role)) {
    return res.status(404).json({ error: 'Admin tapılmadı.' });
  }
  if (existing.id === req.user.id) {
    return res.status(400).json({ error: 'Öz hesabınızı silə bilməzsiniz.' });
  }
  if (existing.role === 'super_admin') {
    const superAdmins = await store.where('users', (u) => u.role === 'super_admin');
    if (superAdmins.length <= 1) {
      return res.status(400).json({ error: 'Sistemdə ən azı bir Super Admin qalmalıdır.' });
    }
  }

  await store.remove('users', existing.id);
  await logAction(req.user, 'delete', existing);
  res.json({ success: true });
}));

module.exports = router;
