const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Run once (e.g. `node db.js`) to create the table on Neon.
async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS applicants (
      id SERIAL PRIMARY KEY,
      application_number TEXT UNIQUE,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      dob DATE NOT NULL,
      linkedin TEXT,
      referral_code TEXT,
      college TEXT NOT NULL,
      degree TEXT NOT NULL,
      specialization TEXT NOT NULL,
      semester INTEGER NOT NULL,
      grad_year INTEGER NOT NULL,
      cgpa TEXT,
      department TEXT NOT NULL,
      about_you TEXT NOT NULL,
      motivation TEXT NOT NULL,
      fit_answer TEXT NOT NULL,
      achievement TEXT NOT NULL,
      ai_experience TEXT NOT NULL,
      portfolio TEXT,
      resume_url TEXT,
      photo_url TEXT,
      application_pdf_url TEXT,
      has_recommendation BOOLEAN NOT NULL DEFAULT false,
      recommender_name TEXT,
      recommender_title TEXT,
      recommender_institution TEXT,
      recommender_email TEXT,
      recommender_phone TEXT,
      razorpay_order_id TEXT UNIQUE,
      razorpay_payment_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending', -- pending | paid | failed
      created_at TIMESTAMP DEFAULT NOW(),
      paid_at TIMESTAMP
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS otp_verifications (
      id SERIAL PRIMARY KEY,
      contact_type TEXT NOT NULL, -- 'email' | 'phone'
      contact_value TEXT NOT NULL,
      otp_code TEXT NOT NULL,
      verified BOOLEAN NOT NULL DEFAULT false,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leads (
      id SERIAL PRIMARY KEY,
      name TEXT,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'completed'
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(email, phone)
    );
  `);
  await pool.query(`ALTER TABLE applicants ADD COLUMN IF NOT EXISTS semester_marks TEXT;`);
  await pool.query(`ALTER TABLE applicants ADD COLUMN IF NOT EXISTS twelfth_marks TEXT;`);
  console.log('Schema ready.');
}

if (require.main === module) {
  initSchema()
    .then(() => pool.end())
    .catch((err) => {
      console.error('Schema init failed:', err);
      process.exit(1);
    });
}

module.exports = pool;
module.exports.initSchema = initSchema;
