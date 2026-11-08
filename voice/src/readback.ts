import { spoken, spokenRoute, spokenUnit } from './spoken.js';

export type Unit = 'mg' | 'mcg' | 'g' | 'mL' | 'units' | 'J';
export type Route = 'IV' | 'IO' | 'IM' | 'IN' | 'SL' | 'PO' | 'neb';
export type ReadbackMatch = { kind: 'medication' | 'shock'; drug?: string; eventKind: string; dose: number; unit: Unit; unitAssumed: boolean; route?: Route; label: string; spoken: string };
export type MissingDose = { kind: 'missing_dose'; drug: string; eventKind: string; spoken: string };
export type ControlWord = 'correction' | 'confirm';
export const ECHO_PREFIXES = ['copy.', 'copy ', 'cancelled', 'confirmed', 'warning:'];

export const DRUGS: Record<string, { aliases: string[]; usualUnit: Unit }> = {
  epinephrine: { aliases: ['epinephrine', 'epinephrin', 'adrenaline', 'at the pen', 'epi'], usualUnit: 'mg' },
  amiodarone: { aliases: ['amiodarone', 'ami o', 'amio'], usualUnit: 'mg' },
  naloxone: { aliases: ['naloxone', 'narcan', 'nar can'], usualUnit: 'mg' },
  nitroglycerin: { aliases: ['nitroglycerin', 'nitro'], usualUnit: 'mg' },
  dextrose: { aliases: ['dextrose', 'd50', 'd 50'], usualUnit: 'g' },
  'sodium bicarbonate': { aliases: ['sodium bicarbonate', 'sodium bicarb', 'bicarbonate', 'bicarb'], usualUnit: 'mL' },
  aspirin: { aliases: ['aspirin', 'asa'], usualUnit: 'mg' },
  atropine: { aliases: ['atropine'], usualUnit: 'mg' },
  adenosine: { aliases: ['adenosine'], usualUnit: 'mg' },
  midazolam: { aliases: ['midazolam', 'versed'], usualUnit: 'mg' },
  fentanyl: { aliases: ['fentanyl'], usualUnit: 'mcg' },
  ondansetron: { aliases: ['ondansetron', 'zofran'], usualUnit: 'mg' },
  albuterol: { aliases: ['albuterol', 'proventil'], usualUnit: 'mg' },
  lidocaine: { aliases: ['lidocaine'], usualUnit: 'mg' },
  'calcium chloride': { aliases: ['calcium chloride', 'calcium'], usualUnit: 'g' },
  'magnesium sulfate': { aliases: ['magnesium sulfate', 'magnesium sulphate', 'magnesium', 'mag'], usualUnit: 'g' },
};

const aliases = Object.entries(DRUGS).flatMap(([drug, entry]) => entry.aliases.map(alias => ({ drug, alias }))).sort ( (a, b) => b.alias.length - a.alias.length);
// RB1: absence, questions and plans cannot be logged as completed treatment.
const negation = /\b(?:not|never|no|without|hold the|holding|haven['’]?t|didn['’]?t|don['’]?t)\b/i;
const question = /^(?:are you|did|do|should|can|could|will|have we|is it|what dose|how much)\b/i;
const plans = /\b(?:ready|prepare|prepping|draw up|drawing up|get|grab|set up|going to|gonna|let['’]?s|want to|about to|next)\b/i;
const verb = /\b(?:administering|administered|giving|given|gave|pushing|pushed|delivered|defib|defibrillated|shocked)\b|\bin\s*[.!]?$/i;
const numberWords: Record<string, number> = { zero: 0, one: 1, a: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const wordPattern = Object.keys(numberWords).filter(w => w !== 'a').join('|');
const numberPattern = new RegExp(`(?<![\\w.])(?:\\d+(?:\\.\\d+)?|\\.\\d+|(?:a\\s+hundred(?:[ -]+(?:and|${wordPattern}))*|(?:${wordPattern})(?:[ -]+(?:hundred|and|${wordPattern}))*)(?:\\s+point(?:[ -]+(?:${wordPattern}))+)?|point(?:[ -]+(?:${wordPattern}))+)(?!\\w|\\.\\d)`, 'gi');
const units: [RegExp, Unit][] = [[/^(?:mg|milligrams?)\b/i, 'mg'], [/^(?:mcg|micrograms?|mics?)\b/i, 'mcg'], [/^(?:g|grams?)\b/i, 'g'], [/^(?:ml|millilit(?:re|er)s?|cc)\b/i, 'mL'], [/^units?\b/i, 'units'], [/^(?:j|joules?)\b/i, 'J']];
const routes: [RegExp, Route][] = [[/\b(?:i\s*[- ]?\s*v|intravenous)\b/i, 'IV'], [/\b(?:i\s*[- ]?\s*o|intraosseous)\b/i, 'IO'], [/\b(?:i\s*[- ]?\s*m|intramuscular)\b/i, 'IM'], [/\b(?:intranasal|nasal)\b/i, 'IN'], [/\bIN\b/, 'IN'], [/\b(?:sublingual|s\s*[- ]?\s*l)\b/i, 'SL'], [/\b(?:p\s*[- ]?\s*o|by mouth)\b/i, 'PO'], [/\b(?:neb|nebulised|nebulized|nebulizer|nebuliser)\b/i, 'neb']];

function parseNumber(value: string): number {
  if (/^(?:\d|\.)/.test(value)) return Number(value);
  const [integer, fraction] = value.toLowerCase().split(/\s+point\s+|^point\s+/);
  const words = (integer || '').split(/[ -]+/);
  let sum = 0;
  for (const word of words) {
    if (word === 'hundred') sum = (sum || 1) * 100;
    else sum += numberWords[word] ?? 0;
  }
  if (fraction !== undefined) return Number(`${sum}.${fraction.split(/[ -]+/).map(w => numberWords[w]).join('')}`);
  return sum;
}

function title(value: string): string { return value.charAt(0).toUpperCase() + value.slice(1); }
function findDrug(text: string): { drug: string; index: number; end: number } | undefined {
  for (const { drug, alias } of aliases) {
    const match = new RegExp(`\\b${alias.replace(/ /g, '\\s+')}\\b`, 'i').exec(text);
    if (match) return { drug, index: match.index, end: match.index + match[0].length };
  }
}

export function parseReadback(text: string): ReadbackMatch | MissingDose | undefined {
  const input = text.trim();
  if (!input || /\?\s*$/.test(input) || question.test(input)) return;
  const found = findDrug(input);
  // Negation and plans count only in the administration clause: up to the first comma or full stop after the
  // drug ("Giving epi one milligram, no allergies" is a dose; "We have not given epi 1 mg" is not).
  const afterDrug = found ? input.slice(found.end) : '';
  const clauseBreak = afterDrug.search(/[,.;]/);
  const clause = found && clauseBreak >= 0 ? input.slice(0, found.end + clauseBreak) : input;
  if (negation.test(clause) || plans.test(clause)) return;
  const shockWord = /\bshock(?:ed)?\b/i.test(input);
  const shockContext = shockWord || /\b(?:defib|defibrillated|joules?|j)\b/i.test(input);
  if (!found && !shockContext) return;
  const hasVerb = verb.test(input) || /\bshock\s+delivered\b/i.test(input);
  if (!found && !hasVerb) return;
  const masked = found ? input.slice(0, found.index) + ' '.repeat(found.end - found.index) + input.slice(found.end) : input;
  const candidates = [...masked.matchAll(numberPattern)].map(m => {
    const start = m.index!;
    const end = start + m[0].length;
    const after = masked.slice(end);
    const unitMatch = units.map(([pattern, unit]) => ({ match: pattern.exec(after.trimStart()), unit })).find(item => item.match);
    const unitEnd = unitMatch ? end + after.length - after.trimStart().length + unitMatch.match![0].length : end;
    return { dose: parseNumber(m[0]), unit: unitMatch?.unit, start, end, unitEnd, after };
  }).filter(c => {
    if (!Number.isFinite(c.dose)) return false;
    // A time, age, percentage or duration is never a dose, even if it is nearby.
    if (/^\s*(?::|%|[- ]?years?\b|[- ]?year[- ]old\b|yo\b|percent\b|minutes?\b|min\b|seconds?\b|o['’]clock\b)/i.test(c.after) || /:\s*$/.test(masked.slice(0, c.start))) return false;
    if (!found) return c.unit === 'J' || (shockWord && !c.unit);
    if (c.start >= found.end) {
      const between = input.slice(found.end, c.start);
      return /^\s*$/.test(between);
    }
    if (c.unitEnd <= found.index) {
      const between = input.slice(c.unitEnd, found.index);
      return /^\s*(?:of\s+)?$/.test(between);
    }
    return false;
  });
  if (found) candidates.sort((a, b) => Math.min(Math.abs(a.unitEnd - found.index), Math.abs(a.start - found.end)) - Math.min(Math.abs(b.unitEnd - found.index), Math.abs(b.start - found.end)));
  const candidate = candidates[0];
  // §16 also accepts a standalone drug-first dose without a verb.
  if (!hasVerb) {
    if (!found || !candidate || found.index !== 0 || candidate.start < found.end || !candidate.unit) return;
    let remainder = input.slice(candidate.unitEnd).trim().replace(/[.!]+$/, '').trim();
    for (const [pattern] of routes) remainder = remainder.replace(pattern, '').trim();
    if (remainder) return;
  }
  if (!candidate) {
    if (!found || !hasVerb) return;
    return { kind: 'missing_dose', drug: found.drug, eventKind: `med_${found.drug.replace(/ /g, '_')}`, spoken: `${title(found.drug)}. Say again the dose.` };
  }
  const unit = candidate.unit ?? (found ? DRUGS[found.drug].usualUnit : 'J');
  const route = found ? routes.find(([pattern]) => pattern.test(input))?.[1] : undefined;
  const name = found ? title(found.drug) : 'Shock';
  const label = `${name} ${candidate.dose} ${unit}${route ? ` ${route}` : ''}`;
  const speech = `Copy. ${name}, ${spoken(candidate.dose)} ${spokenUnit(unit, candidate.dose)}${route ? `, ${spokenRoute(route)}` : ''}.`;
  return { kind: found ? 'medication' : 'shock', ...(found ? { drug: found.drug } : {}), eventKind: found ? `med_${found.drug.replace(/ /g, '_')}` : 'shock', dose: candidate.dose, unit, unitAssumed: !candidate.unit, ...(route ? { route } : {}), label, spoken: speech };
}

export function parseControl(text: string): ControlWord | undefined {
  const normalized = text.trim().toLowerCase().replace(/[.!?,]+$/g, '').trim();
  if (/^(?:correction|cancel(?: that)?|scratch that|disregard)$/.test(normalized)) return 'correction';
  if (/^(?:confirm|confirmed|yes confirm)$/.test(normalized)) return 'confirm';
}

export function parseIdentity(text: string): { name: string; birthDate: string } | undefined {
  const name = /\b(?:patient(?:'s|’s) name is|patient is|this is|name is)\s+([a-z]+(?:[-'][a-z]+)?(?:\s+[a-z]+(?:[-'][a-z]+)?){1,2})(?=\s*,|\s+(?:born|date of birth|dob)\b)/i.exec(text)?.[1];
  const date = /\b(?:born|date of birth|dob)\s*[:]?\s*(?:(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})|(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s+(\d{4}))/i.exec(text);
  if (!name || !date) return;
  const month = date[1] ? Number(date[1]) : ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'].indexOf(date[4].toLowerCase()) + 1;
  const day = Number(date[2] ?? date[5]);
  const year = Number(date[3] ?? date[6]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (year < 100 || check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return;
  return { name: name.split(/\s+/).map(part => title(part.toLowerCase())).join(' '), birthDate: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
}
