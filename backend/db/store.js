/**
 * Trendora - MongoDB (Mongoose) əsaslı "verilənlər bazası" köməkçisi
 * ------------------------------------------------------------------
 * Bu modul əvvəllər fayl-əsaslı (JSON) idi, indi isə MongoDB Atlas-a
 * (Mongoose vasitəsilə) qoşulur. Route-larda dəyişiklik minimuma
 * endirmək üçün əsas funksiyaların adları və davranışı (all, find,
 * where, insert, update, remove) qorunub — yalnız fərq budur ki, indi
 * hamısı `async` funksiyalardır və `await` ilə çağırılmalıdır.
 */

const { getModel, nextId } = require('./models');

// Mongo-ya xas `_id`/`__v` sahələrini çıxarıb, köhnə JSON-DB formatına
// uyğun sadə object qaytarır (yalnız `id` + öz sahələri).
function clean(doc) {
  if (!doc) return null;
  const plain = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const { _id, __v, ...rest } = plain;
  return rest;
}

async function all(table) {
  const Model = getModel(table);
  const docs = await Model.find({}).lean();
  return docs.map(clean);
}

async function find(table, id) {
  const Model = getModel(table);
  const doc = await Model.findOne({ id: Number(id) }).lean();
  return clean(doc);
}

async function where(table, predicate) {
  const rows = await all(table);
  return rows.filter(predicate);
}

/**
 * `where`-dən fərqli olaraq filtri Node yaddaşında deyil, birbaşa MongoDB
 * sorğusu kimi verilənlər bazası üzərində icra edir (yəni bütün kolleksiyanı
 * yaddaşa yükləmədən yalnız uyğun sənədləri qaytarır). Böyük kolleksiyalarda
 * (məs. `reviews`, `favorites`) təkrar-təkrar bütün cədvəli oxumaqdansa
 * bunu istifadə etmək lazımdır - məs. tək bir məhsulun rəylərini/sevimlilərini
 * tapmaq üçün bütün rəylər/sevimlilər kolleksiyasını oxumağa ehtiyac yoxdur.
 */
async function findWhere(table, mongoFilter) {
  const Model = getModel(table);
  const docs = await Model.find(mongoFilter).lean();
  return docs.map(clean);
}

/**
 * Verilmiş aggregation pipeline-ı kolleksiya üzərində icra edir. Məs. rəylərin
 * hər məhsul üzrə orta bal/sayını Node-da bütün sənədləri yükləyib hesablamaq
 * əvəzinə, birbaşa MongoDB-nin özündə (`$group`) hesablamaq üçün istifadə olunur -
 * bu həm şəbəkə trafikini, həm də CPU işini azaldır.
 */
async function aggregate(table, pipeline) {
  const Model = getModel(table);
  return Model.aggregate(pipeline);
}

async function insert(table, record) {
  const Model = getModel(table);
  const id = await nextId(table);
  const created = await Model.create({ id, ...record });
  return clean(created);
}

async function update(table, id, patch) {
  const Model = getModel(table);
  const doc = await Model.findOneAndUpdate(
    { id: Number(id) },
    { $set: patch },
    { new: true }
  ).lean();
  return clean(doc);
}

async function remove(table, id) {
  const Model = getModel(table);
  const res = await Model.deleteOne({ id: Number(id) });
  return res.deletedCount > 0;
}

/**
 * Verilmiş şərtə (predicate) uyğun bütün qeydləri eyni `patch` ilə yeniləyir.
 * Köhnə kodda birbaşa `load()`/`save()` ilə edilən toplu mutasiyaları
 * (məs. çat mesajlarını "oxunmuş" kimi işarələmək) əvəz edir.
 */
async function updateWhere(table, predicate, patch) {
  const rows = await where(table, predicate);
  if (rows.length === 0) return [];
  const Model = getModel(table);
  await Model.updateMany({ id: { $in: rows.map((r) => r.id) } }, { $set: patch });
  return where(table, predicate);
}

module.exports = { all, find, where, findWhere, aggregate, insert, update, remove, updateWhere };
