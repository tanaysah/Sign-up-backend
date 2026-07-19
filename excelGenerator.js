const ExcelJS = require('exceljs');

async function generateMasterExcel(pool) {
  const result = await pool.query(
    `SELECT application_number, name, email, phone, dob, linkedin, referral_code,
            college, degree, specialization, semester, grad_year, cgpa,
            department, portfolio, resume_url, photo_url, application_pdf_url,
            has_recommendation, recommender_name, recommender_title, recommender_institution,
            recommender_email, recommender_phone,
            status, razorpay_order_id, razorpay_payment_id, created_at, paid_at
     FROM applicants
     ORDER BY created_at ASC`
  );

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Applications');

  sheet.columns = [
    { header: 'Application Number', key: 'application_number', width: 18 },
    { header: 'Payment Successful', key: 'payment_status', width: 16 },
    { header: 'Name', key: 'name', width: 22 },
    { header: 'Email', key: 'email', width: 26 },
    { header: 'Phone', key: 'phone', width: 16 },
    { header: 'Date of Birth', key: 'dob', width: 14 },
    { header: 'LinkedIn', key: 'linkedin', width: 24 },
    { header: 'Referral Code', key: 'referral_code', width: 12 },
    { header: 'College / University', key: 'college', width: 26 },
    { header: 'Degree', key: 'degree', width: 22 },
    { header: 'Specialization', key: 'specialization', width: 22 },
    { header: 'Semester', key: 'semester', width: 10 },
    { header: 'Graduation Year', key: 'grad_year', width: 14 },
    { header: 'CGPA', key: 'cgpa', width: 10 },
    { header: 'Department', key: 'department', width: 16 },
    { header: 'Portfolio', key: 'portfolio', width: 24 },
    { header: 'Resume URL', key: 'resume_url', width: 30 },
    { header: 'Photo URL', key: 'photo_url', width: 30 },
    { header: 'Application PDF URL', key: 'application_pdf_url', width: 30 },
    { header: 'Has Recommendation', key: 'has_recommendation', width: 16 },
    { header: 'Recommender Name', key: 'recommender_name', width: 20 },
    { header: 'Recommender Title', key: 'recommender_title', width: 20 },
    { header: 'Recommender Institution', key: 'recommender_institution', width: 24 },
    { header: 'Recommender Email', key: 'recommender_email', width: 26 },
    { header: 'Recommender Phone', key: 'recommender_phone', width: 16 },
    { header: 'Razorpay Order ID', key: 'razorpay_order_id', width: 24 },
    { header: 'Razorpay Payment ID', key: 'razorpay_payment_id', width: 24 },
    { header: 'Submitted At', key: 'created_at', width: 20 },
    { header: 'Paid At', key: 'paid_at', width: 20 }
  ];
  sheet.getRow(1).font = { bold: true };

  result.rows.forEach((r) => {
    sheet.addRow({
      ...r,
      payment_status: r.status === 'paid' ? 'Yes' : 'Pending',
      has_recommendation: r.has_recommendation ? 'Yes' : 'No',
      created_at: r.created_at ? r.created_at.toISOString() : '',
      paid_at: r.paid_at ? r.paid_at.toISOString() : ''
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

module.exports = { generateMasterExcel };
