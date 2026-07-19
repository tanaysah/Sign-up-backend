require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const crypto = require('crypto');
const Razorpay = require('razorpay');

const pool = require('./db');
const { uploadResumeBuffer, uploadPhotoBuffer, uploadApplicationPdf, uploadMasterExcel } = require('./cloudinary');
const { sendConfirmationEmail, sendConfirmationSms, sendOtpEmail, sendOtpSms } = require('./notify');
const { generateApplicationPdf } = require('./pdfGenerator');
const { generateMasterExcel } = require('./excelGenerator');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || '*' }));

// ---- Shared: generate a unique 6-digit application number ----
async function generateUniqueApplicationNumber() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = String(Math.floor(100000 + Math.random() * 900000)); // 6 digits, never leading 0
    const existing = await pool.query(`SELECT 1 FROM applicants WHERE application_number = $1 LIMIT 1`, [candidate]);
    if (!existing.rows.length) return candidate;
  }
  throw new Error('Could not generate a unique application number after 10 attempts');
}

// ---- Shared: runs once, exactly when an applicant's payment is first confirmed ----
// Called from both the webhook and the direct verify-payment route. The UPDATE's
// "AND status != 'paid'" guard means only the first caller to reach this actually
// gets rows back — so PDF generation, Excel regeneration, and notifications only
// ever fire once per applicant, no matter which path (or both) triggers it.
async function finalizeApplicationOnPayment(orderId, paymentId, amountPaise, currency) {
  const result = await pool.query(
    `UPDATE applicants
     SET status = 'paid', razorpay_payment_id = $1, paid_at = NOW()
     WHERE razorpay_order_id = $2 AND status != 'paid'
     RETURNING *`,
    [paymentId, orderId]
  );

  if (!result.rows.length) return; // already finalized by the other path, or unknown order — nothing to do

  const applicant = result.rows[0];

  try {
    const pdfBuffer = await generateApplicationPdf(applicant, {
      amount: amountPaise, currency, orderId, paymentId
    });
    const pdfUrl = await uploadApplicationPdf(pdfBuffer, applicant.application_number);
    await pool.query(`UPDATE applicants SET application_pdf_url = $1 WHERE id = $2`, [pdfUrl, applicant.id]);
  } catch (e) {
    console.error('PDF generation/upload failed:', e.message);
  }

  try {
    const excelBuffer = await generateMasterExcel(pool);
    await uploadMasterExcel(excelBuffer);
  } catch (e) {
    console.error('Excel export failed:', e.message);
  }

  await Promise.all([
    sendConfirmationEmail({
      toEmail: applicant.email, toName: applicant.name, applicationNumber: applicant.application_number
    }).catch((e) => console.error('Email send failed:', e.message)),
    sendConfirmationSms({
      toPhone: applicant.phone, toName: applicant.name, applicationNumber: applicant.application_number
    }).catch((e) => console.error('SMS send failed:', e.message))
  ]);
}

// IMPORTANT: webhook route needs the raw body for signature verification,
// so it's registered BEFORE express.json() and uses its own raw parser.
app.post(
  '/api/webhook/razorpay',
  express.raw({ type: '*/*' }),
  async (req, res) => {
    try {
      const signature = req.headers['x-razorpay-signature'];
      const expected = crypto
        .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
        .update(req.body)
        .digest('hex');

      if (signature !== expected) {
        console.warn('Webhook signature mismatch — rejecting.');
        return res.status(400).json({ error: 'invalid_signature' });
      }

      const payload = JSON.parse(req.body.toString());

      if (payload.event === 'payment.captured') {
        const payment = payload.payload.payment.entity;
        await finalizeApplicationOnPayment(payment.order_id, payment.id, payment.amount, payment.currency);
      }

      res.json({ received: true });
    } catch (err) {
      console.error('Webhook processing error:', err);
      res.status(500).json({ error: 'webhook_processing_failed' });
    }
  }
);

// Normal JSON/multipart parsing for everything else.
app.use(express.json());

function countWords(str) {
  const trimmed = (str || '').trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
}

app.post('/api/send-otp', async (req, res) => {
  try {
    const { type, value } = req.body;
    if (!type || !value || !['email', 'phone'].includes(type)) {
      return res.status(400).json({ error: 'invalid_request' });
    }

    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await pool.query(
      `DELETE FROM otp_verifications WHERE contact_type = $1 AND contact_value = $2 AND verified = false`,
      [type, value]
    );
    await pool.query(
      `INSERT INTO otp_verifications (contact_type, contact_value, otp_code, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [type, value, otp, expiresAt]
    );

    if (type === 'email') {
      await sendOtpEmail({ toEmail: value, otp });
    } else {
      await sendOtpSms({ toPhone: value, otp });
    }

    res.json({ sent: true });
  } catch (err) {
    console.error('Send-OTP error:', err);
    res.status(500).json({ error: 'send_otp_failed' });
  }
});

app.post('/api/verify-otp', async (req, res) => {
  try {
    const { type, value, otp } = req.body;
    if (!type || !value || !otp) return res.status(400).json({ error: 'invalid_request' });

    const result = await pool.query(
      `SELECT id FROM otp_verifications
       WHERE contact_type = $1 AND contact_value = $2 AND otp_code = $3
         AND verified = false AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [type, value, otp]
    );

    if (!result.rows.length) {
      return res.json({ verified: false });
    }

    await pool.query(`UPDATE otp_verifications SET verified = true WHERE id = $1`, [result.rows[0].id]);
    res.json({ verified: true });
  } catch (err) {
    console.error('Verify-OTP error:', err);
    res.status(500).json({ error: 'verify_otp_failed' });
  }
});

const PERSONAL_EMAIL_DOMAINS = [
  'gmail.com', 'yahoo.com', 'yahoo.co.in', 'hotmail.com', 'outlook.com', 'live.com',
  'icloud.com', 'rediffmail.com', 'protonmail.com', 'aol.com', 'msn.com', 'yandex.com'
];
function isPersonalEmailDomain(value) {
  const parts = (value || '').trim().toLowerCase().split('@');
  if (parts.length !== 2) return true;
  return PERSONAL_EMAIL_DOMAINS.includes(parts[1]);
}

app.post('/api/apply', upload.fields([{ name: 'resume', maxCount: 1 }, { name: 'photo', maxCount: 1 }]), async (req, res) => {
  try {
    const {
      name, email, phone, dob, linkedin, referralCode,
      college, degree, specialization, semester, gradYear, cgpa,
      department, aboutYou, motivation, fitAnswer, achievement, aiExperience,
      portfolio,
      hasRecommendation, recommenderName, recommenderTitle, recommenderInstitution,
      recommenderEmail, recommenderPhone, pageUrl
    } = req.body;

    const requiredFields = { name, email, phone, dob, college, degree, specialization, semester, gradYear, cgpa, department, aboutYou, motivation, fitAnswer, achievement, aiExperience };
    for (const [key, value] of Object.entries(requiredFields)) {
      if (!value) return res.status(400).json({ error: 'missing_fields', field: key });
    }
    if (!req.files || !req.files.resume) return res.status(400).json({ error: 'missing_fields', field: 'resume' });
    if (!req.files.photo) return res.status(400).json({ error: 'missing_fields', field: 'photo' });

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!emailPattern.test((email || '').trim())) {
      return res.status(400).json({ error: 'invalid_email' });
    }

    const emailVerified = await pool.query(
      `SELECT 1 FROM otp_verifications WHERE contact_type = 'email' AND contact_value = $1 AND verified = true LIMIT 1`,
      [email]
    );
    if (!emailVerified.rows.length) {
      return res.status(400).json({ error: 'email_not_verified' });
    }
    const phoneVerified = await pool.query(
      `SELECT 1 FROM otp_verifications WHERE contact_type = 'phone' AND contact_value = $1 AND verified = true LIMIT 1`,
      [phone]
    );
    if (!phoneVerified.rows.length) {
      return res.status(400).json({ error: 'phone_not_verified' });
    }

    if (!dob || dob > '2009-12-31') {
      return res.status(400).json({ error: 'dob_out_of_range' });
    }

    const recommending = hasRecommendation === 'true';
    if (recommending) {
      if (!recommenderName || !recommenderTitle || !recommenderInstitution || !recommenderEmail || !recommenderPhone) {
        return res.status(400).json({ error: 'missing_recommender_fields' });
      }
      if (!emailPattern.test((recommenderEmail || '').trim())) {
        return res.status(400).json({ error: 'invalid_recommender_email' });
      }
      if (isPersonalEmailDomain(recommenderEmail)) {
        return res.status(400).json({ error: 'personal_email_not_allowed' });
      }
    }

    const wordLimits = { aboutYou: 200, motivation: 200, fitAnswer: 250, achievement: 250, aiExperience: 250 };
    for (const [field, limit] of Object.entries(wordLimits)) {
      if (countWords(req.body[field]) > limit) {
        return res.status(400).json({ error: 'word_limit_exceeded', field });
      }
    }

    const resumeUrl = await uploadResumeBuffer(req.files.resume[0].buffer, `${name}_resume`);
    const photoUrl = await uploadPhotoBuffer(req.files.photo[0].buffer, `${name}_photo`);
    const applicationNumber = await generateUniqueApplicationNumber();

    const feeAmount = parseInt(process.env.INTERNSHIP_FEE_PAISE || '99900', 10);
    const order = await razorpay.orders.create({
      amount: feeAmount,
      currency: 'INR',
      receipt: `internship_${Date.now()}`,
      notes: { name, email, department, applicationNumber, pageUrl: pageUrl || '' }
    });

    await pool.query(
      `INSERT INTO applicants
        (application_number, name, email, phone, dob, linkedin, referral_code, college, degree, specialization, semester, grad_year, cgpa,
         department, about_you, motivation, fit_answer, achievement, ai_experience, portfolio,
         resume_url, photo_url, has_recommendation, recommender_name, recommender_title,
         recommender_institution, recommender_email, recommender_phone, razorpay_order_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,'pending')`,
      [
        applicationNumber, name, email, phone, dob, linkedin || null, referralCode || null,
        college, degree, specialization, parseInt(semester, 10), parseInt(gradYear, 10), cgpa,
        department, aboutYou, motivation, fitAnswer, achievement, aiExperience, portfolio || null,
        resumeUrl, photoUrl, recommending,
        recommending ? recommenderName : null,
        recommending ? recommenderTitle : null,
        recommending ? recommenderInstitution : null,
        recommending ? recommenderEmail : null,
        recommending ? recommenderPhone : null,
        order.id
      ]
    );

    // Rebuild the master Excel so this applicant appears immediately (status: Pending), even before payment.
    generateMasterExcel(pool).then(uploadMasterExcel).catch((e) =>
      console.error('Excel export (post-apply) failed:', e.message)
    );

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      applicationNumber
    });
  } catch (err) {
    console.error('Apply error:', err);
    res.status(500).json({ error: 'apply_failed' });
  }
});

app.get('/health', (req, res) => res.json({ ok: true }));

// One-time DB setup, usable from a browser when shell access isn't available (e.g. Render free tier).
// Protected by a secret so random visitors can't trigger it. Safe to call more than once —
// every statement is "CREATE TABLE IF NOT EXISTS", so it never overwrites or duplicates anything.
app.get('/api/admin/init-schema', async (req, res) => {
  if (!process.env.ADMIN_INIT_SECRET || req.query.secret !== process.env.ADMIN_INIT_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  try {
    await pool.initSchema();
    res.json({ success: true, message: 'Schema ready.' });
  } catch (err) {
    console.error('Schema init failed:', err);
    res.status(500).json({ error: 'init_failed', message: err.message });
  }
});

// ---- Direct client-side payment verification ----
// Complementary to the webhook above: this verifies the signature Razorpay
// Checkout hands back to the browser on payment success. Both paths funnel
// into the same finalizeApplicationOnPayment(), which is idempotent — whichever
// fires first does the real work; the other becomes a no-op.
app.post('/api/verify-payment', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'missing_fields' });
    }

    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      console.warn('Payment signature mismatch — not marking as paid.');
      return res.status(400).json({ verified: false, error: 'invalid_signature' });
    }

    // Fetch authoritative amount/currency from Razorpay (the client only sends IDs + signature).
    const payment = await razorpay.payments.fetch(razorpay_payment_id);
    await finalizeApplicationOnPayment(razorpay_order_id, razorpay_payment_id, payment.amount, payment.currency);

    res.json({ verified: true });
  } catch (err) {
    console.error('Verify-payment error:', err);
    res.status(500).json({ error: 'verification_failed' });
  }
});

// ---- Redirect-based payment confirmation ----
// Razorpay Checkout auto-submits a POST here (via callback_url + redirect:true) after
// a successful payment. This is more reliable than the in-page JS handler above, because
// on mobile — especially UPI app-switching — the browser can reload or lose JS state
// entirely; a real HTTP redirect survives that, while in-memory JS variables don't.
app.post('/api/payment-callback', express.urlencoded({ extended: true }), async (req, res) => {
  const FALLBACK_ORIGIN = process.env.FRONTEND_ORIGIN || 'https://seraphicatelier.com';
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    let pageUrl = FALLBACK_ORIGIN;
    try {
      const order = await razorpay.orders.fetch(razorpay_order_id);
      if (order.notes && order.notes.pageUrl) pageUrl = order.notes.pageUrl;
    } catch (e) {
      console.error('Could not fetch order for redirect target:', e.message);
    }
    // Strip any existing query string so we don't accumulate duplicate params on retries.
    const baseUrl = pageUrl.split('?')[0];

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.redirect(`${baseUrl}?payment=failed`);
    }

    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      console.warn('Callback signature mismatch — not marking as paid.');
      return res.redirect(`${baseUrl}?payment=failed`);
    }

    const payment = await razorpay.payments.fetch(razorpay_payment_id);
    await finalizeApplicationOnPayment(razorpay_order_id, razorpay_payment_id, payment.amount, payment.currency);

    const applicantResult = await pool.query(
      `SELECT application_number FROM applicants WHERE razorpay_order_id = $1 LIMIT 1`,
      [razorpay_order_id]
    );
    const applicationNumber = applicantResult.rows[0] ? applicantResult.rows[0].application_number : '';

    res.redirect(`${baseUrl}?payment=success&app=${applicationNumber}`);
  } catch (err) {
    console.error('Payment callback error:', err);
    res.redirect(`${FALLBACK_ORIGIN}?payment=failed`);
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
