import { DRUGS, type ReadbackMatch } from './readback.js';

export type DoseVerdict = { verdict: 'in_range' | 'out_of_range' | 'no_range'; range?: string };
export type AllergyVerdict = { allergic: boolean; match?: string };

// RB4: only the two demo ranges are defined in §16.
export function checkDoseRange(drug: string, dose: number, unit: string): DoseVerdict {
  const ranges: Record<string, { min: number; max: number; range: string }> = {
    epinephrine: { min: 0.3, max: 1, range: '0.3–1 mg' },
    amiodarone: { min: 150, max: 300, range: '150–300 mg' },
  };
  const definition = ranges[drug.trim().toLowerCase()];
  if (!definition || !Number.isFinite(dose)) return { verdict: 'no_range' };
  const normalizedUnit = unit.trim().toLowerCase();
  const conversion: Record<string, number> = { mg: 1, mcg: 0.001, g: 1000 };
  if (!(normalizedUnit in conversion)) return { verdict: 'no_range' };
  const mg = dose * conversion[normalizedUnit];
  return { verdict: mg >= definition.min && mg <= definition.max ? 'in_range' : 'out_of_range', range: definition.range };
}

// RB7: compare whole names/aliases and first words, excluding absence-of-allergy entries.
export function checkAllergy(drug: string, allergies: string[]): AllergyVerdict {
  const clean = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, ' ').trim();
  const normalizedDrug = clean(drug);
  if (!normalizedDrug) return { allergic: false };
  const groups = [
    ...Object.entries(DRUGS).map(([generic, item]) => [generic, ...item.aliases].map(clean)),
    ['sulfa', 'sulfonamide', 'sulfonamide antibiotics'],
    ['penicillin', 'pcn'],
  ];
  const containsPhrase = (value: string, phrase: string) => (` ${value} `).includes(` ${phrase} `);
  for (const allergy of allergies) {
    const value = clean(allergy);
    if (!value || /^(?:none|nkda|nka|no known)(?:\b|$)/.test(value)) continue;
    const firstDrug = normalizedDrug.split(' ')[0];
    const firstAllergy = value.split(' ')[0];
    const direct = containsPhrase(value, firstDrug) || containsPhrase(normalizedDrug, firstAllergy);
    const equivalent = groups.some(group => group.some(alias => containsPhrase(normalizedDrug, alias)) && group.some(alias => containsPhrase(value, alias)));
    if (direct || equivalent) return { allergic: true, match: allergy };
  }
  return { allergic: false };
}

export function composeReadback(match: ReadbackMatch, dose: DoseVerdict, allergy: AllergyVerdict): { spoken: string; flagged: boolean; reason?: 'allergy' | 'dose' } {
  const restatement = match.spoken.replace(/^Copy\.\s*/, '');
  if (allergy.allergic && match.drug) {
    const article = /^[aeiou]/i.test(match.drug) ? 'an' : 'a';
    return { spoken: `${restatement} Warning: the record lists ${article} ${match.drug} allergy. Say confirm or correction.`, flagged: true, reason: 'allergy' };
  }
  if (dose.verdict === 'out_of_range') return { spoken: `${restatement} Outside the protocol range. Say confirm or correction.`, flagged: true, reason: 'dose' };
  return { spoken: match.spoken, flagged: false };
}
