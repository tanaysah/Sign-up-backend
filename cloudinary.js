const cloudinary = require('cloudinary').v2;
require('dotenv').config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

function uploadResumeBuffer(buffer, filenameHint) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'raw', // PDFs are 'raw' in Cloudinary
        folder: 'seraphic-atelier/resumes',
        public_id: filenameHint.replace(/[^a-z0-9_-]/gi, '_') + '_' + Date.now() + '.pdf',
        overwrite: false
      },
      (err, result) => {
        if (err) return reject(err);
        resolve(result.secure_url);
      }
    );
    stream.end(buffer);
  });
}

function uploadPhotoBuffer(buffer, filenameHint) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'image',
        folder: 'seraphic-atelier/photos',
        public_id: filenameHint.replace(/[^a-z0-9_-]/gi, '_') + '_' + Date.now(),
        overwrite: false
      },
      (err, result) => {
        if (err) return reject(err);
        resolve(result.secure_url);
      }
    );
    stream.end(buffer);
  });
}

function uploadApplicationPdf(buffer, applicationNumber) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'raw',
        folder: 'seraphic-atelier/applications',
        public_id: `${applicationNumber}.pdf`,
        overwrite: true // re-generating for the same applicant replaces the old file
      },
      (err, result) => {
        if (err) return reject(err);
        resolve(result.secure_url);
      }
    );
    stream.end(buffer);
  });
}

function uploadMasterExcel(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'raw',
        folder: 'seraphic-atelier',
        public_id: 'applications-master', // fixed id — always overwrites, always one live file
        overwrite: true
      },
      (err, result) => {
        if (err) return reject(err);
        resolve(result.secure_url);
      }
    );
    stream.end(buffer);
  });
}

module.exports = { uploadResumeBuffer, uploadPhotoBuffer, uploadApplicationPdf, uploadMasterExcel };
