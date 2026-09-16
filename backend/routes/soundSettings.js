/**
 * Trendora - Ümumi səs bildirişi ayarları
 * ------------------------------------------------------------------
 * Tək bir (singleton) səs effekti ayarı - müştəri panelində 3 fərqli
 * hadisədə istifadə olunur: 1) məhsul səbətə əlavə edildikdə,
 * 2) yeni bildiriş (sifariş statusu və s.) gəldikdə, 3) dəstək
 * söhbətinə admin tərəfindən yeni mesaj yazıldıqda. Admin panelindən
 * səs faylı, aktiv/deaktiv vəziyyəti və səviyyəsi idarə olunur.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('../db/store');
const asyncHandler = require('../utils/asyncHandler');
const { authenticateToken, requireAdminManager } = require('../middleware/auth');

const router = express.Router();

// Yüklənmiş səs fayllarının saxlanacağı qovluq (məhsul şəkilləri ilə eyni qovluq məntiqi)
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const ALLOWED_MIME_EXT = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm'
};
const MAX_AUDIO_SIZE = 2 * 1024 * 1024; // 2MB - qısa effekt səsi üçün kifayətdir

// Standart (fabrika) səs effekti - admin heç nə dəyişməyibsə bu istifadə olunur.
const DEFAULT_SOUND_URL = '/audio/premium-chime.mp3';
const DEFAULT_SETTINGS = { enabled: true, volume: 70, sound_url: DEFAULT_SOUND_URL };

async function getSettings() {
  const rows = await store.all('sound_settings');
  return rows[0] || null;
}

// GET /api/sound-settings
// Açıqdır (auth tələb olunmur) - müştəri paneli hələ giriş etməmiş ziyarətçi üçün
// belə (səbətə əlavə, bildiriş, dəstək mesajı) səs ayarlarını bilməlidir.
router.get('/', asyncHandler(async (req, res) => {
  const settings = await getSettings();
  if (!settings) return res.json(DEFAULT_SETTINGS);
  res.json({
    enabled: settings.enabled !== false,
    volume: settings.volume ?? DEFAULT_SETTINGS.volume,
    sound_url: settings.sound_url || DEFAULT_SOUND_URL
  });
}));

// PUT /api/sound-settings - yalnız Admin və Super Admin (operator xaric)
router.put('/', authenticateToken, requireAdminManager, asyncHandler(async (req, res) => {
  const { enabled, volume, sound_url } = req.body;

  const patch = { updated_at: new Date().toISOString() };

  if (enabled !== undefined) patch.enabled = Boolean(enabled);

  if (volume !== undefined) {
    const v = Number(volume);
    if (Number.isNaN(v) || v < 0 || v > 100) {
      return res.status(400).json({ error: 'Səs səviyyəsi 0-100 aralığında olmalıdır.' });
    }
    patch.volume = v;
  }

  if (sound_url !== undefined) {
    const url = String(sound_url || '').trim();
    if (!url) {
      return res.status(400).json({ error: 'Səs faylı ünvanı boş ola bilməz.' });
    }
    patch.sound_url = url;
  }

  const existing = await getSettings();
  const saved = existing
    ? await store.update('sound_settings', existing.id, patch)
    : await store.insert('sound_settings', { ...DEFAULT_SETTINGS, ...patch });

  res.json(saved);
}));

// POST /api/sound-settings/upload - yalnız Admin və Super Admin
// Admin öz səs faylını (mp3/wav/ogg) birbaşa yükləyib sound_url kimi təyin edə bilər.
router.post('/upload', authenticateToken, requireAdminManager, asyncHandler(async (req, res) => {
  const { audio } = req.body;
  if (!audio || typeof audio !== 'string') {
    return res.status(400).json({ error: 'Səs faylı məlumatı tələb olunur.' });
  }

  const match = audio.match(/^data:(audio\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    return res.status(400).json({ error: 'Səs faylı formatı düzgün deyil.' });
  }

  const ext = ALLOWED_MIME_EXT[match[1]];
  if (!ext) {
    return res.status(400).json({ error: 'Yalnız MP3, WAV, OGG və ya WEBM formatına icazə verilir.' });
  }

  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > MAX_AUDIO_SIZE) {
    return res.status(400).json({ error: 'Səs faylı ölçüsü 2MB-dan böyük ola bilməz.' });
  }

  const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);
  const sound_url = `/uploads/${filename}`;

  const existing = await getSettings();
  const saved = existing
    ? await store.update('sound_settings', existing.id, { sound_url, updated_at: new Date().toISOString() })
    : await store.insert('sound_settings', { ...DEFAULT_SETTINGS, sound_url });

  res.status(201).json(saved);
}));

module.exports = router;
