// Five SYNTHETIC patients for the mock EHR (spec §17, X2). Not real people, not real records.
// FHIR R4 shapes: Patient, AllergyIntolerance, MedicationStatement, Condition.
// Code status is a Patient extension (urn:handoff:code-status).
// pt-0001 and pt-0002 share a name on purpose so the "ask, never guess" rule (X8) can be shown.

export type Resource = { resourceType: string; id: string; [key: string]: unknown };

const SYNTHETIC_TAG = { system: 'urn:handoff:tags', code: 'synthetic', display: 'Synthetic demo data' };
const CODE_STATUS_URL = 'urn:handoff:code-status';

type PatientSeed = {
  id: string;
  given: string;
  family: string;
  gender: 'male' | 'female' | 'other' | 'unknown';
  birthDate: string;
  codeStatus: string;
  contact: string;
  allergies: { substance: string; reaction: string; criticality: 'low' | 'high' }[];
  medications: { name: string; dosage: string }[];
  conditions: { name: string; onset?: string }[];
};

const SEEDS: PatientSeed[] = [
  {
    id: 'pt-0001',
    given: 'Jordan',
    family: 'Avery',
    gender: 'male',
    birthDate: '1968-03-14',
    codeStatus: 'Full code',
    contact: 'Sam Avery (spouse), 214-555-0143',
    allergies: [{ substance: 'amiodarone', reaction: 'severe hypotension', criticality: 'high' }],
    medications: [
      { name: 'warfarin', dosage: '5 mg by mouth once daily' },
      { name: 'metoprolol', dosage: '25 mg by mouth twice daily' },
    ],
    conditions: [{ name: 'Coronary artery disease' }, { name: 'Myocardial infarction', onset: '2021-06-02' }],
  },
  {
    id: 'pt-0002',
    given: 'Jordan',
    family: 'Avery',
    gender: 'female',
    birthDate: '1991-07-22',
    codeStatus: 'Full code',
    contact: 'Lee Avery (parent), 469-555-0178',
    allergies: [{ substance: 'penicillin', reaction: 'hives', criticality: 'low' }],
    medications: [{ name: 'albuterol inhaler', dosage: '2 puffs as needed' }],
    conditions: [{ name: 'Asthma' }],
  },
  {
    id: 'pt-0003',
    given: 'Maria',
    family: 'Delgado',
    gender: 'female',
    birthDate: '1955-11-02',
    codeStatus: 'Full code',
    contact: 'Ana Delgado (daughter), 972-555-0122',
    allergies: [{ substance: 'sulfonamide antibiotics', reaction: 'rash', criticality: 'low' }],
    medications: [
      { name: 'metformin', dosage: '1000 mg by mouth twice daily' },
      { name: 'lisinopril', dosage: '20 mg by mouth once daily' },
    ],
    conditions: [{ name: 'Type 2 diabetes' }, { name: 'Hypertension' }],
  },
  {
    id: 'pt-0004',
    given: 'Samuel',
    family: 'Okafor',
    gender: 'male',
    birthDate: '1979-05-09',
    codeStatus: 'Full code',
    contact: 'Grace Okafor (sister), 214-555-0190',
    allergies: [],
    medications: [{ name: 'levetiracetam', dosage: '500 mg by mouth twice daily' }],
    conditions: [{ name: 'Epilepsy', onset: '2004-01-01' }],
  },
  {
    id: 'pt-0005',
    given: 'Priya',
    family: 'Raman',
    gender: 'female',
    birthDate: '1986-01-30',
    codeStatus: 'Full code',
    contact: 'Arjun Raman (spouse), 972-555-0165',
    allergies: [],
    medications: [{ name: 'levothyroxine', dosage: '75 mcg by mouth once daily' }],
    conditions: [{ name: 'Hypothyroidism' }],
  },
];

const ref = (id: string) => ({ reference: `Patient/${id}` });

function patientResource(p: PatientSeed): Resource {
  return {
    resourceType: 'Patient',
    id: p.id,
    meta: { tag: [SYNTHETIC_TAG] },
    identifier: [{ system: 'urn:handoff:synthetic-mrn', value: p.id }],
    name: [{ use: 'official', family: p.family, given: [p.given], text: `${p.given} ${p.family}` }],
    gender: p.gender,
    birthDate: p.birthDate,
    contact: [{ relationship: [{ text: 'emergency contact' }], name: { text: p.contact } }],
    extension: [{ url: CODE_STATUS_URL, valueString: p.codeStatus }],
  };
}

function build() {
  const patients: Resource[] = [];
  const allergies: Resource[] = [];
  const medications: Resource[] = [];
  const conditions: Resource[] = [];

  for (const p of SEEDS) {
    patients.push(patientResource(p));
    p.allergies.forEach((a, i) =>
      allergies.push({
        resourceType: 'AllergyIntolerance',
        id: `${p.id}-allergy-${i + 1}`,
        meta: { tag: [SYNTHETIC_TAG] },
        clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical', code: 'active' }] },
        verificationStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification', code: 'confirmed' }] },
        type: 'allergy',
        category: ['medication'],
        criticality: a.criticality,
        code: { text: a.substance },
        patient: ref(p.id),
        reaction: [{ manifestation: [{ text: a.reaction }] }],
      })
    );
    p.medications.forEach((m, i) =>
      medications.push({
        resourceType: 'MedicationStatement',
        id: `${p.id}-med-${i + 1}`,
        meta: { tag: [SYNTHETIC_TAG] },
        status: 'active',
        medicationCodeableConcept: { text: m.name },
        subject: ref(p.id),
        dosage: [{ text: m.dosage }],
      })
    );
    p.conditions.forEach((c, i) =>
      conditions.push({
        resourceType: 'Condition',
        id: `${p.id}-cond-${i + 1}`,
        meta: { tag: [SYNTHETIC_TAG] },
        clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }] },
        code: { text: c.name },
        subject: ref(p.id),
        ...(c.onset ? { onsetDateTime: c.onset } : {}),
      })
    );
  }
  return { Patient: patients, AllergyIntolerance: allergies, MedicationStatement: medications, Condition: conditions };
}

export const STORE: Record<string, Resource[]> = build();
