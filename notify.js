const SibApiV3Sdk = require('sib-api-v3-sdk');
require('dotenv').config();

const defaultClient = SibApiV3Sdk.ApiClient.instance;
defaultClient.authentications['api-key'].apiKey = process.env.BREVO_API_KEY;

const emailApi = new SibApiV3Sdk.TransactionalEmailsApi();
const smsApi = new SibApiV3Sdk.TransactionalSMSApi();

async function sendConfirmationEmail({ toEmail, toName, applicationNumber }) {
  const email = {
    sender: { email: process.env.BREVO_SENDER_EMAIL, name: process.env.BREVO_SENDER_NAME },
    to: [{ email: toEmail, name: toName }],
    subject: `Application Confirmed — Your Application Number: ${applicationNumber}`,
    htmlContent: `
      <div style="font-family: 'Raleway', sans-serif; color:#0B1F3A; max-width:520px; margin:0 auto;">
        <div style="height:3px; width:48px; background:#B58D4C; margin-bottom:20px;"></div>
        <h2 style="font-family: 'Georgia', serif;">Application Confirmed</h2>
        <p>Hi ${toName},</p>
        <p>Thank you for applying to the Seraphic Atelier Internship Program. Your payment has been received
        and your application is now officially registered.</p>
        <p style="font-size:20px; font-weight:700; letter-spacing:1px; margin:20px 0;">
          Application Number: ${applicationNumber}
        </p>
        <p>Please keep this number for your reference — you may need it for any future correspondence.</p>
        <p>Our team will review your application and reach out with next steps shortly.</p>
        <p style="margin-top:32px; color:#0B1F3A;">— Team Seraphic Atelier</p>
      </div>
    `
  };
  return emailApi.sendTransacEmail(email);
}

async function sendConfirmationSms({ toPhone, toName, applicationNumber }) {
  const sms = {
    sender: process.env.BREVO_SMS_SENDER,
    recipient: toPhone.startsWith('+') ? toPhone : `+91${toPhone}`,
    content: `Hi ${toName}, your Seraphic Atelier internship application & payment are confirmed. Your Application Number is ${applicationNumber}. Keep this for reference.`,
    type: 'transactional'
  };
  return smsApi.sendTransacSms(sms);
}

async function sendOtpEmail({ toEmail, otp }) {
  const email = {
    sender: { email: process.env.BREVO_SENDER_EMAIL, name: process.env.BREVO_SENDER_NAME },
    to: [{ email: toEmail }],
    subject: `Your Seraphic Atelier verification code: ${otp}`,
    htmlContent: `
      <div style="font-family: 'Raleway', sans-serif; color:#0B1F3A; max-width:420px; margin:0 auto;">
        <div style="height:3px; width:48px; background:#B58D4C; margin-bottom:20px;"></div>
        <p>Your verification code is:</p>
        <p style="font-size:28px; font-weight:700; letter-spacing:4px;">${otp}</p>
        <p style="color:#5B6472; font-size:13px;">This code expires in 10 minutes. If you didn't request this, you can ignore this email.</p>
      </div>
    `
  };
  return emailApi.sendTransacEmail(email);
}

async function sendOtpSms({ toPhone, otp }) {
  const sms = {
    sender: process.env.BREVO_SMS_SENDER,
    recipient: toPhone,
    content: `Your Seraphic Atelier verification code is ${otp}. It expires in 10 minutes.`,
    type: 'transactional'
  };
  return smsApi.sendTransacSms(sms);
}

module.exports = { sendConfirmationEmail, sendConfirmationSms, sendOtpEmail, sendOtpSms };
