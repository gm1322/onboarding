import fs from 'node:fs';
import path from 'node:path';
import { buildPdf } from './pdf.js';
import { TEMPLATES, customerDisplayName } from './catalog.js';

const today = () => new Date().toISOString().slice(0, 10);

function templateContent(key, customer) {
  const name = customer ? customerDisplayName(customer) : '<Customer name>';
  const date = today();
  const common = {
    subtitle: `Customer: ${name}    Date: ${date}`,
    footer: [
      '_____________________________________________',
      'Place, date                                        Signature',
    ],
  };
  if (key === 'authorization') {
    return {
      title: 'Authorization (Vollmacht)',
      ...common,
      paragraphs: [
        `I, ${name}, hereby authorize the broker to act on my behalf in all matters concerning the arrangement, mediation and management of insurance contracts.`,
        'This authorization covers in particular: the collection and forwarding of personal data required for the preparation of offers, the request of information from insurers and authorities, and the receipt of contract documents.',
        'The authorization may be revoked at any time with effect for the future by written notice.',
      ],
    };
  }
  if (key === 'broker_contract') {
    return {
      title: 'Broker contract (Maklervertrag)',
      ...common,
      paragraphs: [
        `Brokerage agreement between ${name} ("Client") and the broker ("Broker").`,
        'The Broker provides independent advice and arranges insurance contracts between the Client and insurance companies. The Broker acts as the Client\'s fiduciary in the selection and review of suitable insurance cover.',
        'Remuneration: The Broker receives a commission from the insurer for arranged contracts; additionally, a fee according to the attached schedule may be agreed. The Client confirms receipt of the mandatory broker information pursuant to the applicable trade regulations.',
        'Term and termination: The contract runs for an indefinite period and may be terminated by either party with one month\'s notice to the end of a month.',
      ],
    };
  }
  return {
    title: 'Consent to processing of health data (GDPR Art. 9)',
    subtitle: `Customer: ${name}    Date: ${date}`,
    paragraphs: [
      `I, ${name}, expressly consent pursuant to Art. 9 (2) (a) GDPR to the processing of my health data (in particular data on health status, previous illnesses and treatments) by the broker and by the insurers commissioned by the broker, insofar as this is necessary for the preparation of offers and the arrangement of health, accident or life insurance contracts.`,
      'I have been informed that this consent is voluntary and may be revoked at any time with effect for the future, without giving reasons, and that revocation does not affect the lawfulness of processing carried out before the revocation.',
      'I have been informed of my rights under the GDPR, in particular the rights of access, rectification, erasure, restriction of processing, data portability and the right to lodge a complaint with a supervisory authority.',
    ],
    footer: [
      '_____________________________________________',
      'Place, date                                        Signature',
    ],
  };
}

export function renderTemplatePdf(key, customer) {
  const tpl = TEMPLATES.find((t) => t.key === key);
  if (!tpl) throw new Error(`Unknown template: ${key}`);
  return buildPdf(templateContent(key, customer));
}

export function ensureTemplateFiles(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const tpl of TEMPLATES) {
    const file = path.join(dir, tpl.file);
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, renderTemplatePdf(tpl.key, null));
    }
  }
  return dir;
}
