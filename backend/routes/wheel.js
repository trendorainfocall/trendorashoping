const express = require('express');
const store = require('../db/store');
const asyncHandler = require('../utils/asyncHandler');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { notify, NOTIFICATION_TYPES } = require('../utils/notify');

const router = express.Router();

// ---------- Köməkçi funksiyalar ----------

// Kampaniyanın hazırkı statusunu tarixə görə hesablayır (tam avtomatik: admin toggle + tarix aralığı)
function computeCampaignStatus(campaign) {
  if (!campaign.is_enabled) return 'deactivated';
  const now = Date.now();
  if (campaign.start_at && now < new Date(campaign.start_at).getTime()) return 'scheduled';
  if (campaign.end_at && now > new Date(campaign.end_at).getTime()) return 'expired';
  return 'active';
}

async function campaignWithExtras(campaign) {
  const sectors = (await store.where('wheel_sectors', (s) => s.campaign_id === campaign.id))
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const spins = await store.where('wheel_spins', (s) => s.campaign_id === campaign.id);
  return {
    ...campaign,
    status: computeCampaignStatus(campaign),
    sectors,
    spin_count: spins.length
  };
}

// Hazırda aktiv olan (tarixə görə açıq və admin tərəfindən aktivləşdirilmiş) kampaniyanı tapır
async function getActiveCampaign() {
  const campaigns = await store.all('wheel_campaigns');
  const active = campaigns.filter((c) => computeCampaignStatus(c) === 'active');
  if (active.length === 0) return null;
  // Ən son yaradılanı əsas götürürük
  return active.sort((a, b) => b.id - a.id)[0];
}

function randomCode(prefix = 'WHEEL') {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}-${out}`;
}

async function generateUniqueCode() {
  let code;
  let tries = 0;
  do {
    code = randomCode();
    tries++;
  } while ((await store.where('promo_codes', (p) => p.code === code)).length > 0 && tries < 20);
  return code;
}

// Ehtimala görə çəkilmiş təsadüfi sektor seçimi
function pickWeightedSector(sectors) {
  const weights = sectors.map((s) => Math.max(0, Number(s.probability) || 0));
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) {
    // Hamısının ehtimalı 0-dırsa, bərabər paylanma tətbiq olunur
    return sectors[Math.floor(Math.random() * sectors.length)];
  }
  let r = Math.random() * sum;
  for (let i = 0; i < sectors.length; i++) {
    r -= weights[i];
    if (r <= 0) return sectors[i];
  }
  return sectors[sectors.length - 1];
}

// ==========================================================
// ADMIN - Kampaniyalar
// ==========================================================

// GET /api/wheel/campaigns - bütün kampaniyalar (sektor və statistika ilə)
router.get('/campaigns', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const campaigns = (await store.all('wheel_campaigns')).sort((a, b) => b.id - a.id);
  const result = [];
  for (const c of campaigns) result.push(await campaignWithExtras(c));
  res.json(result);
}));

// POST /api/wheel/campaigns - yeni kampaniya yarat
router.post('/campaigns', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { name, start_at, end_at, promo_validity_days, is_enabled } = req.body;
  if (!name) return res.status(400).json({ error: 'Kampaniya adı tələb olunur.' });

  const campaign = await store.insert('wheel_campaigns', {
    name,
    is_enabled: is_enabled !== undefined ? !!is_enabled : false,
    start_at: start_at || null,
    end_at: end_at || null,
    promo_validity_days: promo_validity_days ? Number(promo_validity_days) : null,
    created_at: new Date().toISOString()
  });
  res.status(201).json(await campaignWithExtras(campaign));
}));

// PUT /api/wheel/campaigns/:id - kampaniyanı redaktə et
router.put('/campaigns/:id', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { name, start_at, end_at, promo_validity_days, is_enabled } = req.body;
  const patch = {};
  if (name !== undefined) patch.name = name;
  if (start_at !== undefined) patch.start_at = start_at || null;
  if (end_at !== undefined) patch.end_at = end_at || null;
  if (promo_validity_days !== undefined) patch.promo_validity_days = promo_validity_days ? Number(promo_validity_days) : null;
  if (is_enabled !== undefined) patch.is_enabled = !!is_enabled;

  const updated = await store.update('wheel_campaigns', req.params.id, patch);
  if (!updated) return res.status(404).json({ error: 'Kampaniya tapılmadı.' });
  res.json(await campaignWithExtras(updated));
}));

// POST /api/wheel/campaigns/:id/toggle - admin paneldən sürətli aktiv/deaktiv
router.post('/campaigns/:id/toggle', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const campaign = await store.find('wheel_campaigns', req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Kampaniya tapılmadı.' });
  const updated = await store.update('wheel_campaigns', req.params.id, { is_enabled: !campaign.is_enabled });
  res.json(await campaignWithExtras(updated));
}));

// DELETE /api/wheel/campaigns/:id
router.delete('/campaigns/:id', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const sectors = await store.where('wheel_sectors', (s) => s.campaign_id === Number(req.params.id));
  for (const s of sectors) await store.remove('wheel_sectors', s.id);
  const ok = await store.remove('wheel_campaigns', req.params.id);
  if (!ok) return res.status(404).json({ error: 'Kampaniya tapılmadı.' });
  res.json({ success: true });
}));

// ==========================================================
// ADMIN - Sektorlar
// ==========================================================

// POST /api/wheel/campaigns/:id/sectors - kampaniyaya sektor əlavə et
router.post('/campaigns/:id/sectors', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const campaign = await store.find('wheel_campaigns', req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Kampaniya tapılmadı.' });

  const { label, type, discount_percent, gift_label, probability, color } = req.body;
  if (!label || !type) return res.status(400).json({ error: 'Sektor adı və növü tələb olunur.' });
  if (type === 'discount' && !discount_percent) {
    return res.status(400).json({ error: 'Endirim növü üçün faiz tələb olunur.' });
  }
  if (type === 'gift' && !gift_label) {
    return res.status(400).json({ error: 'Hədiyyə növü üçün hədiyyə adı tələb olunur.' });
  }

  const existing = await store.where('wheel_sectors', (s) => s.campaign_id === campaign.id);
  const sector = await store.insert('wheel_sectors', {
    campaign_id: campaign.id,
    label,
    type,
    discount_percent: type === 'discount' ? Number(discount_percent) : null,
    gift_label: type === 'gift' ? gift_label : null,
    probability: probability !== undefined ? Number(probability) : 10,
    color: color || '#7c3aed',
    sort_order: existing.length,
    created_at: new Date().toISOString()
  });
  res.status(201).json(sector);
}));

// PUT /api/wheel/sectors/:id - sektoru redaktə et
router.put('/sectors/:id', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { label, type, discount_percent, gift_label, probability, color, sort_order } = req.body;
  const patch = {};
  if (label !== undefined) patch.label = label;
  if (type !== undefined) patch.type = type;
  if (discount_percent !== undefined) patch.discount_percent = discount_percent ? Number(discount_percent) : null;
  if (gift_label !== undefined) patch.gift_label = gift_label || null;
  if (probability !== undefined) patch.probability = Number(probability);
  if (color !== undefined) patch.color = color;
  if (sort_order !== undefined) patch.sort_order = Number(sort_order);

  const updated = await store.update('wheel_sectors', req.params.id, patch);
  if (!updated) return res.status(404).json({ error: 'Sektor tapılmadı.' });
  res.json(updated);
}));

// DELETE /api/wheel/sectors/:id
router.delete('/sectors/:id', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const ok = await store.remove('wheel_sectors', req.params.id);
  if (!ok) return res.status(404).json({ error: 'Sektor tapılmadı.' });
  res.json({ success: true });
}));

// ==========================================================
// ADMIN - Statistika
// ==========================================================

router.get('/stats', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const campaigns = await store.all('wheel_campaigns');
  const spins = await store.all('wheel_spins');
  const wheelPromoCodes = await store.where('promo_codes', (p) => p.source === 'wheel');
  const usedWheelCodes = wheelPromoCodes.filter((p) => (p.used_count || 0) > 0);

  const discountSpins = [];
  for (const sp of spins) {
    const sector = await store.find('wheel_sectors', sp.sector_id);
    if (sector && sector.type === 'discount') discountSpins.push(sp);
  }

  const statuses = campaigns.map(computeCampaignStatus);

  res.json({
    total_spins: spins.length,
    discounts_won: discountSpins.length,
    gifts_won: spins.length - discountSpins.length,
    promo_codes_generated: wheelPromoCodes.length,
    promo_codes_used: usedWheelCodes.length,
    active_campaigns: statuses.filter((s) => s === 'active').length,
    scheduled_campaigns: statuses.filter((s) => s === 'scheduled').length,
    expired_campaigns: statuses.filter((s) => s === 'expired').length,
    total_campaigns: campaigns.length
  });
}));

// ==========================================================
// MÜŞTƏRİ - Aktiv çarx və fırlatma
// ==========================================================

// GET /api/wheel/active - müştəri panelində göstərmək üçün aktiv kampaniya
router.get('/active', authenticateToken, asyncHandler(async (req, res) => {
  const campaign = await getActiveCampaign();
  if (!campaign) return res.json({ campaign: null, sectors: [], already_spun: false, my_spin: null });

  const sectors = (await store.where('wheel_sectors', (s) => s.campaign_id === campaign.id))
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    .map((s) => ({ id: s.id, label: s.label, type: s.type, discount_percent: s.discount_percent, gift_label: s.gift_label, color: s.color }));

  if (sectors.length === 0) return res.json({ campaign: null, sectors: [], already_spun: false, my_spin: null });

  const mySpinMatches = await store.where('wheel_spins', (sp) => sp.campaign_id === campaign.id && sp.user_id === req.user.id);
  const mySpin = mySpinMatches[0] || null;
  let mySpinDetail = null;
  if (mySpin) {
    const sector = await store.find('wheel_sectors', mySpin.sector_id);
    const promo = await store.find('promo_codes', mySpin.promo_code_id);
    mySpinDetail = { sector, promo_code: promo };
  }

  res.json({
    campaign: { id: campaign.id, name: campaign.name, end_at: campaign.end_at },
    sectors,
    already_spun: !!mySpin,
    my_spin: mySpinDetail
  });
}));

// POST /api/wheel/spin - müştəri çarxı fırladır (yalnız 1 dəfə)
router.post('/spin', authenticateToken, asyncHandler(async (req, res) => {
  const campaign = await getActiveCampaign();
  if (!campaign) return res.status(400).json({ error: 'Hazırda aktiv endirim çarxı yoxdur.' });

  const sectors = await store.where('wheel_sectors', (s) => s.campaign_id === campaign.id);
  if (sectors.length === 0) return res.status(400).json({ error: 'Bu kampaniyada sektor tənzimlənməyib.' });

  const alreadyMatches = await store.where('wheel_spins', (sp) => sp.campaign_id === campaign.id && sp.user_id === req.user.id);
  const already = alreadyMatches[0];
  if (already) return res.status(409).json({ error: 'Siz artıq bu çarxı fırlatmısınız.' });

  const winner = pickWeightedSector(sectors);

  let validUntil = null;
  if (campaign.promo_validity_days) {
    validUntil = new Date(Date.now() + campaign.promo_validity_days * 24 * 60 * 60 * 1000).toISOString();
  } else if (campaign.end_at) {
    validUntil = campaign.end_at;
  }

  const promo = await store.insert('promo_codes', {
    code: await generateUniqueCode(),
    discount_percent: winner.type === 'discount' ? winner.discount_percent : 0,
    gift_label: winner.type === 'gift' ? winner.gift_label : null,
    valid_from: new Date().toISOString(),
    valid_until: validUntil,
    usage_limit: 1,
    used_count: 0,
    source: 'wheel',
    wheel_campaign_id: campaign.id
  });

  const spin = await store.insert('wheel_spins', {
    user_id: req.user.id,
    campaign_id: campaign.id,
    sector_id: winner.id,
    promo_code_id: promo.id,
    created_at: new Date().toISOString()
  });

  const winMessage = winner.type === 'discount'
    ? `Endirim Çarxından ${winner.discount_percent}% endirim kuponu qazandınız: ${promo.code}`
    : `Endirim Çarxından hədiyyə qazandınız: ${winner.gift_label} (kod: ${promo.code})`;
  await notify(
    req.user.id,
    NOTIFICATION_TYPES.PROMO_CODE_ISSUED,
    'Endirim kuponu qazandınız 🎁',
    winMessage,
    { promo_code_id: promo.id, campaign_id: campaign.id }
  );

  res.status(201).json({ sector: winner, promo_code: promo, spin_id: spin.id });
}));

module.exports = router;
