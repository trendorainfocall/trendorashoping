const jwt = require('jsonwebtoken');
const store = require('../db/store');

const JWT_SECRET = process.env.JWT_SECRET || 'trendora-dev-secret-CHANGE-IN-PRODUCTION';

// Admin tərəfli rol iyerarxiyası (ən yüksəkdən ən aşağıya)
// - super_admin: hər şeyə icazəlidir, o cümlədən admin yaratmaq/silmək
// - admin: gündəlik idarəetmə (məhsul, sifariş və s.) + admin redaktəsi/aktivləşdirmə
// - operator: yalnız məhdud, gündəlik əməliyyat işləri (admin siyahısına baxa bilər, dəyişiklik edə bilməz)
const ADMIN_ROLES = ['super_admin', 'admin', 'operator'];

// ---------------------------------------------------------------
// Sessiya siyasəti
// ---------------------------------------------------------------
// Login/register zamanı yaradılan token-in HEÇ BİR bitmə vaxtı (`exp`) yoxdur —
// istifadəçi brauzeri bağlayıb-açsa belə, token özlüyündə "vaxtı bitib" səbəbi
// ilə etibarsız olmur. İstifadəçi yalnız aşağıdakı iki halda hesabdan çıxarılır:
//   1) Özü "Çıxış (Logout)" düyməsini basır (frontend tokeni lokal silir)
//   2) Admin həmin istifadəçinin sessiyasını ləğv edir — bu zaman həmin
//      istifadəçinin `token_version` sahəsi 1 artırılır və artıq mövcud olan
//      bütün köhnə tokenlər (içindəki `tv` uyğun gəlmədiyi üçün) avtomatik
//      etibarsız hala düşür, hətta onların `exp`-i olmasa belə.
function generateAuthToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, tv: user.token_version || 0 },
    JWT_SECRET
  );
}

async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token tapılmadı. Zəhmət olmasa daxil olun.' });

  jwt.verify(token, JWT_SECRET, async (err, decoded) => {
    if (err) {
      return res.status(401).json({ error: 'Sessiya etibarsızdır. Zəhmət olmasa yenidən daxil olun.', session_ended: true });
    }

    try {
      const user = await store.find('users', decoded.id);
      if (!user) {
        return res.status(401).json({ error: 'İstifadəçi tapılmadı.', session_ended: true });
      }
      // Admin tərəfindən ləğv edilib (token_version artırılıb) - köhnə token artıq keçərsiz.
      if ((decoded.tv || 0) !== (user.token_version || 0)) {
        return res.status(401).json({ error: 'Sessiyanız admin tərəfindən sona çatdırılıb. Zəhmət olmasa yenidən daxil olun.', session_ended: true });
      }
      if (ADMIN_ROLES.includes(user.role) && (user.status || 'active') === 'inactive') {
        return res.status(403).json({ error: 'Bu admin hesabı deaktiv edilib. Zəhmət olmasa Super Admin ilə əlaqə saxlayın.', session_ended: true });
      }
      req.user = { id: user.id, email: user.email, role: user.role };
      next();
    } catch (e) {
      next(e);
    }
  });
}

// İstənilən admin tipli rol (super_admin | admin | operator) üçün açıq
function requireAdmin(req, res, next) {
  if (!req.user || !ADMIN_ROLES.includes(req.user.role)) {
    return res.status(403).json({ error: 'Bu əməliyyat üçün admin səlahiyyəti tələb olunur.' });
  }
  next();
}

// Yalnız super_admin və admin rollarına açıq (operator xaric)
function requireAdminManager(req, res, next) {
  if (!req.user || !['super_admin', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Bu əməliyyat üçün Admin və ya Super Admin səlahiyyəti tələb olunur.' });
  }
  next();
}

// Yalnız super_admin roluna açıq (yeni admin yaratmaq/silmək kimi kritik əməliyyatlar)
function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Bu əməliyyat üçün Super Admin səlahiyyəti tələb olunur.' });
  }
  next();
}

module.exports = {
  authenticateToken,
  requireAdmin,
  requireAdminManager,
  requireSuperAdmin,
  generateAuthToken,
  ADMIN_ROLES,
  JWT_SECRET
};
