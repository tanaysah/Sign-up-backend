const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const https = require('https');

const PAGE_W = 595.28; // A4 width in points
const PAGE_H = 841.89; // A4 height in points
const MARGIN = 48;
const NAVY = rgb(0.043, 0.122, 0.227); // #0B1F3A
const GOLD = rgb(0.71, 0.556, 0.302);  // #B58D4C
const GREY = rgb(0.36, 0.39, 0.45);

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchBuffer(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode >= 400) return reject(new Error('Fetch failed: ' + res.statusCode + ' for ' + url));
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy(new Error('Fetch timed out after 15s for ' + url));
    });
  });
}

// Wraps a line of text to fit within maxWidth, returns an array of lines.
function wrapText(text, font, size, maxWidth) {
  const words = (text || '').split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    const trial = current ? current + ' ' + word : word;
    if (font.widthOfTextAtSize(trial, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = trial;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

class PageWriter {
  constructor(doc, fontRegular, fontBold) {
    this.doc = doc;
    this.fontRegular = fontRegular;
    this.fontBold = fontBold;
    this.page = null;
    this.y = 0;
    this.reserveTopRight = 0; // no longer used (photo removed), kept for structural simplicity
  }
  newPage(reserveTopRight) {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.reserveTopRight = reserveTopRight || 0;
    this.y = PAGE_H - MARGIN;
    return this.page;
  }
  ensureSpace(height) {
    if (this.y - height < MARGIN) this.newPage(0);
  }
  contentWidth() {
    return this.reserveTopRight && this.y > PAGE_H - MARGIN - 140
      ? PAGE_W - 2 * MARGIN - this.reserveTopRight
      : PAGE_W - 2 * MARGIN;
  }
  heading(text) {
    this.ensureSpace(26);
    this.page.drawText(text, { x: MARGIN, y: this.y, size: 18, font: this.fontBold, color: NAVY });
    this.y -= 26;
  }
  subheading(text) {
    this.ensureSpace(20);
    this.page.drawText(text, { x: MARGIN, y: this.y, size: 12.5, font: this.fontBold, color: GOLD });
    this.y -= 18;
  }
  field(label, value) {
    const text = `${label}: ${value == null || value === '' ? '—' : value}`;
    const lines = wrapText(text, this.fontRegular, 10, this.contentWidth());
    for (const line of lines) {
      this.ensureSpace(14);
      this.page.drawText(line, { x: MARGIN, y: this.y, size: 10, font: this.fontRegular, color: NAVY });
      this.y -= 14;
    }
    this.y -= 2;
  }
  paragraph(label, value) {
    this.ensureSpace(14);
    this.page.drawText(label + ':', { x: MARGIN, y: this.y, size: 10, font: this.fontBold, color: GOLD });
    this.y -= 14;
    const lines = wrapText(value || '—', this.fontRegular, 9.5, this.contentWidth());
    for (const line of lines) {
      this.ensureSpace(13);
      this.page.drawText(line, { x: MARGIN, y: this.y, size: 9.5, font: this.fontRegular, color: NAVY });
      this.y -= 13;
    }
    this.y -= 6;
  }
  rule() {
    this.ensureSpace(12);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y }, end: { x: PAGE_W - MARGIN, y: this.y },
      thickness: 0.6, color: rgb(0.85, 0.8, 0.7)
    });
    this.y -= 14;
  }
}

const DEPARTMENT_LABELS = {
  'R&D': 'Research & Development Department',
  'Technology': 'Technology Department'
};

async function generateApplicationPdf(applicant, paymentInfo) {
  const doc = await PDFDocument.create();
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new PageWriter(doc, fontRegular, fontBold);

  // ---- Page 1: header (brand / program / big department name) + core details ----
  w.newPage(0);

  w.page.drawRectangle({ x: MARGIN, y: w.y, width: 40, height: 2, color: GOLD });
  w.y -= 22;

  w.page.drawText('SERAPHIC ATELIER', { x: MARGIN, y: w.y, size: 16, font: fontBold, color: NAVY });
  w.y -= 18;

  w.page.drawText('INTERNSHIP PROGRAM — SEPTEMBER 2026', { x: MARGIN, y: w.y, size: 10.5, font: fontBold, color: GOLD });
  w.y -= 30;

  const deptDisplay = (DEPARTMENT_LABELS[applicant.department] || applicant.department || '').toUpperCase();
  const deptLines = wrapText(deptDisplay, fontBold, 19, w.contentWidth());
  deptLines.forEach((line) => {
    w.page.drawText(line, { x: MARGIN, y: w.y, size: 19, font: fontBold, color: NAVY });
    w.y -= 24;
  });
  w.y -= 8;

  w.page.drawText(`Application Number: ${applicant.application_number}`, {
    x: MARGIN, y: w.y, size: 11, font: fontRegular, color: GREY
  });
  w.y -= 20;

  w.rule();
  w.subheading('Personal Information');
  w.field('Full Name', applicant.name);
  w.field('Email', applicant.email);
  w.field('Mobile', applicant.phone);
  w.field('Date of Birth', applicant.dob);
  w.field('LinkedIn', applicant.linkedin);
  w.field('Referral Code', applicant.referral_code);

  w.rule();
  w.subheading('Academic Information');
  w.field('College / University', applicant.college);
  w.field('Degree', applicant.degree);
  w.field('Specialization', applicant.specialization);
  w.field('Current Semester', applicant.semester);
  w.field('Expected Graduation Year', applicant.grad_year);
  w.field('CGPA', applicant.cgpa);
  w.field('Latest Semester Marks (%)', applicant.semester_marks);
  w.field('12th / HSC Marks (%)', applicant.twelfth_marks);

  w.rule();
  w.subheading('Internship Application');
  w.field('Department', applicant.department);
  w.field('Portfolio', applicant.portfolio);

  if (applicant.has_recommendation) {
    w.rule();
    w.subheading('Faculty Recommendation');
    w.field('Recommender', applicant.recommender_name);
    w.field('Title', applicant.recommender_title);
    w.field('Institution', applicant.recommender_institution);
    w.field('Email', applicant.recommender_email);
    w.field('Phone', applicant.recommender_phone);
  }

  // ---- Payment receipt page ----
  w.newPage(0);
  w.heading('Payment Receipt');
  w.field('Application Number', applicant.application_number);
  w.field('Applicant Name', applicant.name);
  w.field('Amount Paid', `${(paymentInfo.amount / 100).toFixed(2)} ${paymentInfo.currency}`);
  w.field('Razorpay Order ID', paymentInfo.orderId);
  w.field('Razorpay Payment ID', paymentInfo.paymentId);
  w.field('Payment Date', new Date().toISOString());
  w.field('Status', 'Paid');

  // ---- Merge in the resume PDF, if it is a PDF (Cloudinary stores it as 'raw') ----
  try {
    const resumeBytes = new Uint8Array(await fetchBuffer(applicant.resume_url));
    const resumeDoc = await PDFDocument.load(resumeBytes);
    const copied = await doc.copyPages(resumeDoc, resumeDoc.getPageIndices());
    copied.forEach((p) => doc.addPage(p));
  } catch (e) {
    console.error('Resume merge failed (resume may not be a valid PDF):', e.message);
  }

  const finalBytes = await doc.save();
  return Buffer.from(finalBytes);
}

module.exports = { generateApplicationPdf };
