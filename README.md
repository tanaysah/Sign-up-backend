# Seraphic Atelier — Internship Application System

Two parts:
1. `apply-widget.html` (in the `internship-embed` folder) — paste into a Webflow **Embed** element on your internship page.
2. This backend — deployed separately on Render, handles storage, payment, and notifications.

## 1. Database (Neon — free tier)
1. Create a project at neon.tech.
2. Copy the connection string into `.env` as `DATABASE_URL`.
3. Run once: `node db.js` — creates the `applicants` table.

## 2. Resume storage (Cloudinary — free tier)
1. Create an account at cloudinary.com.
2. Copy Cloud Name, API Key, API Secret into `.env`.

## 3. Payments (Razorpay)
1. Get your `Key ID` and `Key Secret` from the Razorpay dashboard (Settings → API Keys).
2. Set `INTERNSHIP_FEE_PAISE` in `.env` (amount in paise, e.g. 99900 = ₹999).
3. In Razorpay Dashboard → Settings → Webhooks, add a webhook:
   - URL: `https://YOUR-BACKEND.onrender.com/api/webhook/razorpay`
   - Event: `payment.captured`
   - Copy the generated **Webhook Secret** into `.env` as `RAZORPAY_WEBHOOK_SECRET`.
4. Put your public `Key ID` into `apply-widget.html` (`RAZORPAY_KEY_ID` variable) — this one is safe to expose client-side. The `Key Secret` stays server-side only, never in the widget.

## 4. Email + SMS (Brevo — free tier)
1. Create an account at brevo.com.
2. Generate an API key (Settings → SMTP & API → API Keys) → put in `.env` as `BREVO_API_KEY`.
3. Verify your sender email domain/address for `BREVO_SENDER_EMAIL`.
4. SMS sender name (`BREVO_SMS_SENDER`) needs approval in some regions — check Brevo's SMS settings; a generic alphanumeric sender ID works for India in most cases.

## 5. Deploy backend to Render
1. Push this folder to a GitHub repo.
2. On Render: New → Web Service → connect the repo.
3. Build command: `npm install`
4. Start command: `npm start`
5. Add all `.env` values as Environment Variables in Render's dashboard (don't upload the `.env` file itself).
6. Once deployed, copy the Render URL (e.g. `https://seraphic-internship.onrender.com`) into:
   - `apply-widget.html` → `BACKEND_URL` variable
   - Razorpay webhook URL (step 3 above)

## 6. Add the widget to Webflow
1. On your internship page, add an **Embed** element where the application form should appear.
2. Paste the entire contents of `apply-widget.html` into it.
3. Publish the site.

## Notes
- Payment confirmation is only ever finalized by the **webhook** or the **direct signature verification** — not the browser popup alone — this prevents someone from faking a "successful" payment client-side.
- Free-tier Render services sleep after inactivity, causing a ~30–50 second delay on the first request after idle. Fine for low application volume; upgrade to a paid instance later if this becomes an issue during high-traffic periods (e.g. application deadline day).
- Resume PDFs are capped at 5MB in both the widget and the backend (`multer` limit) — adjust both together if you change this.

## Application Number, Combined PDF, and Master Excel

Every applicant gets a unique 6-digit **Application Number**, generated the moment they submit the form (returned in the `/api/apply` response). This number:
- Never repeats (checked against the database before assigning)
- Is used to name the final combined PDF (e.g. `482913.pdf`)
- Is included in the confirmation email and SMS sent once payment is verified

**The combined PDF** is generated automatically the instant payment is confirmed (via webhook or direct verification, whichever fires first). It contains, in one file:
1. A details page — all form fields, with the applicant's photo in the top-right corner
2. A payment receipt page — application number, amount paid, Razorpay order/payment IDs, date
3. The applicant's original resume, merged in as additional pages

It's uploaded to Cloudinary under `seraphic-atelier/applications/{application_number}.pdf`, and the URL is stored back on the applicant's database row (`application_pdf_url`).

**The master Excel export** (`seraphic-atelier/applications-master.xlsx` on Cloudinary) is **fully regenerated from the database** every time an application is submitted or paid — not incrementally appended. This is a deliberate design choice: incremental appends risk silently losing a row if two applications complete at nearly the same moment (a read-modify-write race condition). Regenerating the whole sheet from Postgres each time means it can never drift out of sync — Postgres is always the source of truth, and the Excel file is always a complete, consistent snapshot of it. The tradeoff is that this rebuild runs on every event, which is fine at the scale of an internship program (hundreds of applicants), but would need a smarter approach at much higher volume.

Each row includes every form field, the Application Number, and a "Payment Successful" column (Yes/Pending).

## New setup steps for this feature set
1. `npm install` again — two new dependencies were added (`pdf-lib` for PDF generation, `exceljs` for the spreadsheet)
2. Run `node db.js` again — two new columns were added (`application_number`, `application_pdf_url`)
3. No new environment variables needed — this reuses your existing Cloudinary and Brevo credentials
