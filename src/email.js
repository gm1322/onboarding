import { addEmail } from './db.js';

export function createEmailService(db) {
  return {
    send({ to, subject, body, link = null, customerId = null }) {
      const mail = addEmail(db, { customerId, to, subject, body, link, status: 'queued' });
      console.log(`[email queued] to=${to} subject="${subject}"${link ? ` link=${link}` : ''}`);
      return mail;
    },
  };
}

export function registrationEmail(config, token) {
  const link = `${config.baseUrl}/register/${token}`;
  return {
    link,
    subject: 'Please complete your registration',
    body: [
      'Hello,',
      '',
      'An employee has started your registration with us. Please complete the remaining information using the link below:',
      '',
      link,
      '',
      'If the link does not work, copy it into your browser. The link is personal and valid until your registration is completed.',
      '',
      'Best regards,',
      'Your broker team',
    ].join('\n'),
  };
}

export function signatureEmail(config, customerName, docs) {
  const links = docs.map((d) => `- ${d.title}: ${d.signingUrl}`).join('\n');
  return {
    subject: 'Your documents are ready for signature',
    body: [
      `Hello ${customerName},`,
      '',
      'Please sign the following documents electronically:',
      '',
      links,
      '',
      'Best regards,',
      'Your broker team',
    ].join('\n'),
  };
}
