export const JOB_TYPES = [
  { key: 'school', label: 'School pupil' },
  { key: 'student', label: 'Student' },
  { key: 'self', label: 'Self-employed' },
  { key: 'employee', label: 'Employee' },
];

export const ORG_TYPES = [
  { key: 'private_company', label: 'Private company (GmbH, AG, KG, ...)' },
  { key: 'sole_proprietorship', label: 'Sole proprietorship' },
  { key: 'club', label: 'Club / association (Verein)' },
  { key: 'cooperative', label: 'Cooperative (Genossenschaft)' },
  { key: 'public_institution', label: 'Public institution' },
  { key: 'other', label: 'Other' },
];

export const COUNTRIES = [
  { key: 'AT', label: 'Austria' },
  { key: 'DE', label: 'Germany' },
  { key: 'CH', label: 'Switzerland' },
  { key: 'LI', label: 'Liechtenstein' },
  { key: 'other', label: 'Other' },
];

const opt = (keys) => keys.map((k) => ({ key: k, label: k.replace(/_/g, ' ') }));

export const INSURANCES = [
  {
    key: 'home',
    label: 'Home / building (Wohngebäude)',
    questions: [
      { key: 'square_meters', label: 'Living area (m²)', type: 'number', required: true },
      { key: 'building_type', label: 'Building type', type: 'select', options: opt(['single_family', 'semi_detached', 'row_house', 'multi_family', 'apartment', 'other']), required: true },
      { key: 'construction_year', label: 'Year of construction', type: 'number', required: false },
      { key: 'plan', label: 'Plan', type: 'select', options: opt(['existing', 'new_build', 'renovation']), required: true },
    ],
  },
  {
    key: 'content',
    label: 'Household contents (Hausrat)',
    questions: [
      { key: 'living_area_m2', label: 'Living area (m²)', type: 'number', required: true },
      { key: 'household_size', label: 'Persons in household', type: 'number', required: true },
    ],
  },
  {
    key: 'accident',
    label: 'Accident (Unfall)',
    questions: [
      { key: 'sports_activities', label: 'Sports activities', type: 'multiselect', options: opt(['football', 'skiing', 'snowboarding', 'cycling', 'climbing', 'martial_arts', 'horse_riding', 'motorsport', 'diving', 'other']), required: true },
      { key: 'risky_occupation', label: 'Does the job involve increased accident risk?', type: 'select', options: opt(['no', 'yes']), required: true },
    ],
  },
  {
    key: 'liability',
    label: 'Personal liability (Haftpflicht)',
    questions: [
      { key: 'family_status', label: 'Family status', type: 'select', options: opt(['single', 'couple', 'family_with_children']), required: true },
      { key: 'pets', label: 'Pets (dog, horse, ...)?', type: 'select', options: opt(['no', 'yes']), required: true },
    ],
  },
  {
    key: 'health',
    label: 'Health (Krankenversicherung)',
    questions: [
      { key: 'interest', label: 'Interest', type: 'select', options: opt(['supplementary', 'private_full', 'advice_only']), required: true },
      { key: 'current_insurance', label: 'Current insurer / tariff', type: 'text', required: false },
    ],
  },
  {
    key: 'life',
    label: 'Life (Lebensversicherung)',
    questions: [
      { key: 'sum_insured', label: 'Desired sum insured (EUR)', type: 'number', required: true },
      { key: 'term_years', label: 'Desired term (years)', type: 'number', required: false },
    ],
  },
  {
    key: 'legal',
    label: 'Legal expenses (Rechtsschutz)',
    questions: [
      { key: 'area', label: 'Area of cover', type: 'select', options: opt(['traffic', 'tenancy', 'work', 'all']), required: true },
    ],
  },
  {
    key: 'motor',
    label: 'Motor vehicle (Kfz)',
    questions: [
      { key: 'vehicle_count', label: 'Number of vehicles', type: 'number', required: true },
      { key: 'vehicle_type', label: 'Main vehicle type', type: 'select', options: opt(['car', 'motorcycle', 'van', 'other']), required: false },
    ],
  },
];

export const TEMPLATES = [
  { key: 'authorization', title: 'Authorization (Vollmacht)', file: 'authorization.pdf' },
  { key: 'broker_contract', title: 'Broker contract (Maklervertrag)', file: 'broker-contract.pdf' },
  { key: 'health_gdpr', title: 'Health data consent - GDPR Art. 9 (DSGVO)', file: 'health-gdpr-consent.pdf' },
];

export const PERSON_FIELDS = ['first_name', 'last_name', 'email', 'phone', 'street', 'zip', 'city', 'country', 'date_of_birth', 'job_type', 'job'];

export const ORG_FIELDS = ['company_name', 'org_type', 'firmenbuchnummer', 'gisa_number', 'rep_first_name', 'rep_last_name', 'rep_email', 'rep_phone', 'rep_street', 'rep_zip', 'rep_city', 'rep_country', 'rep_date_of_birth', 'rep_job_type', 'rep_job'];

export const ALL_CUSTOMER_FIELDS = [...PERSON_FIELDS, ...ORG_FIELDS];

export function customerDisplayName(c) {
  if (c.customer_type === 'organization') {
    const rep = [c.rep_first_name, c.rep_last_name].filter(Boolean).join(' ');
    return rep ? `${c.company_name || 'Organization'} (${rep})` : (c.company_name || 'Organization');
  }
  return [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || 'Customer';
}

export function customerEmail(c) {
  return c.customer_type === 'organization' ? (c.rep_email || c.email) : c.email;
}

export function insuranceLabel(key) {
  return INSURANCES.find((i) => i.key === key)?.label || key;
}
