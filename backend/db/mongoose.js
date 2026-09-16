/**
 * Trendora - MongoDB Atlas qoşulması (Mongoose)
 * ------------------------------------------------------------------
 * Yalnız `process.env.MONGODB_URI` istifadə olunur (bax: `.env`).
 * Şifrə (DB_PASSWORD) heç vaxt kodda yazılmır — yalnız `.env` faylından oxunur.
 */

const mongoose = require('mongoose');

let connectionPromise = null;

/**
 * MongoDB Atlas-a qoşulur. Tətbiq boyu tək bir qoşulma paylaşılır
 * (server.js işə düşəndə çağırılır, lazım gələrsə digər skriptlər də
 * çağıra bilər, məs. `db/seed.js`).
 */
function connectDB() {
  if (connectionPromise) return connectionPromise;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      'MONGODB_URI mühit dəyişəni tapılmadı. Zəhmət olmasa `.env` faylında MONGODB_URI təyin edin ' +
        '(bax: `.env.example`).'
    );
  }

  mongoose.set('strictQuery', true);

  connectionPromise = mongoose
    .connect(uri, {
      serverSelectionTimeoutMS: 10000
    })
    .then((conn) => {
      mongoose.connection.on('error', (err) => {
        console.error('❌ MongoDB bağlantı xətası:', err.message);
      });
      mongoose.connection.on('disconnected', () => {
        console.warn('⚠️  MongoDB bağlantısı kəsildi.');
      });
      return conn;
    })
    .catch((err) => {
      // Növbəti çağırışlarda yenidən cəhd edilə bilsin deyə sıfırlayırıq
      connectionPromise = null;
      throw err;
    });

  return connectionPromise;
}

async function disconnectDB() {
  await mongoose.disconnect();
  connectionPromise = null;
}

module.exports = { connectDB, disconnectDB, mongoose };
