import { spoken, spokenRoute, spokenUnit } from './spoken.js';

export type Unit = 'mg' | 'mcg' | 'g' | 'mL' | 'units' | 'J';
export type Route = 'IV' | 'IO' | 'IM' | 'IN' | 'SL' | 'PO' | 'neb';
export type ReadbackMatch = { kind: 'medication' | 'shock'; drug?: string; eventKind: string; dose: number; unit: Unit; unitAssumed: boolean; route?: Route; label: string; spoken: string };
export type MissingDose = { kind: 'missing_dose'; drug: string; eventKind: string; spoken: string };
/** A dose was heard but the drug name was garbled beyond recognition: ask, never guess. */
export type MissingDrug = { kind: 'missing_drug'; dose?: number; unit?: Unit; route?: Route; spoken: string };
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
const verb = /\b(?:administering|administered|giving|given|gave|pushing|pushed|deliver(?:ed|ing)?|defib|defibrillated|shocked)\b|\bin\s*[.!]?$/i;
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
/** `loose`: also try sound-alikes over up to three words; only where a medication is clearly being talked about. */
function findDrug(text: string, loose = false): { drug: string; index: number; end: number } | undefined {
  for (const { drug, alias } of aliases) {
    const match = new RegExp(`\\b${alias.replace(/ /g, '\\s+')}\\b`, 'i').exec(text);
    if (match) return { drug, index: match.index, end: match.index + match[0].length };
  }
  return fuzzyDrug(text) ?? (loose ? soundAlikeDrug(text) : undefined);
}

/** Spelling folded to sound: "ph" → "f", "y" → "i", doubled letters once, "h" after a consonant dropped. */
function sound(word: string): string {
  return word.toLowerCase().replace(/[^a-z]/g, '').replace(/ph/g, 'f').replace(/y/g, 'i').replace(/([bcdfgjklmnpqrstvwxz])h/g, '$1').replace(/(.)\1+/g, '$1');
}

/**
 * The ASR splits and respells long drug names ("a pine fine" for epinephrine). One to three adjacent words, joined
 * and folded to sound, within 30 % of a long alias's length count as that drug. Used only with a dose or an open
 * medication question around it, so ordinary speech can't become a drug.
 */
function soundAlikeDrug(text: string): { drug: string; index: number; end: number } | undefined {
  const long = aliases.filter(a => a.alias.length >= 6 && !a.alias.includes(' ')).map(a => ({ ...a, folded: sound(a.alias) }));
  const words = [...text.matchAll(/[A-Za-z]+/g)].map(m => ({ word: m[0], index: m.index!, end: m.index! + m[0].length }));
  let best: { drug: string; dist: number; index: number; end: number } | undefined;
  for (let i = 0; i < words.length; i++) {
    for (let n = 1; n <= 3 && i + n <= words.length; n++) {
      const folded = sound(words.slice(i, i + n).map(w => w.word).join(''));
      if (folded.length < 5) continue;
      for (const { drug, folded: target } of long) {
        const dist = editDistance(folded, target);
        if (dist <= Math.floor(target.length * 0.3) && (!best || dist < best.dist)) best = { drug, dist, index: words[i].index, end: words[i + n - 1].end };
      }
    }
  }
  return best && { drug: best.drug, index: best.index, end: best.end };
}

/** Damerau–Levenshtein distance (adjacent transpositions count once). */
function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/**
 * STT mangles long drug names ("aminoderone", "epinefrin"). A word of 6+ letters within a small edit distance of a
 * long alias counts as that drug. Short aliases (epi, amio, mag) are exact-only, so ordinary words never match.
 */
function fuzzyDrug(text: string): { drug: string; index: number; end: number } | undefined {
  const long = aliases.filter(a => a.alias.length >= 6 && !a.alias.includes(' '));
  // Single words, then adjacent pairs joined ("amino dirone" → "aminodirone"), which is how STT splits long names.
  const windows = [...text.matchAll(/[A-Za-z]{6,}/g)].map(m => ({ word: m[0], index: m.index!, end: m.index! + m[0].length }));
  const pairs = [...text.matchAll(/([A-Za-z]{3,})\s+([A-Za-z]{3,})/g)].map(m => ({ word: m[1] + m[2], index: m.index!, end: m.index! + m[0].length }));
  for (const m of [...windows, ...pairs]) {
    const word = m.word.toLowerCase();
    if (word.length < 6) continue;
    let best: { drug: string; dist: number } | undefined;
    for (const { drug, alias } of long) {
      const dist = editDistance(word, alias.toLowerCase());
      if (!best || dist < best.dist) best = { drug, dist };
    }
    const allowed = word.length >= 9 ? 3 : 2;
    if (best && best.dist <= allowed) return { drug: best.drug, index: m.index, end: m.end };
  }
  return undefined;
}

/** The drug a line names, exact, fuzzy or sound-alike, or undefined. For the brain's "Say again the drug" follow-up. */
export function recognizeDrug(text: string, loose = true): string | undefined {
  return findDrug(normalizeTranscript(text), loose)?.drug;
}

export type MedParts = { drug?: string; dose?: number; unit?: Unit; route?: Route };

/**
 * Whatever pieces of a medication statement a line carries, in any order and without needing a verb: for filling
 * in a medication the brain is still collecting ("one milligram of" … "epinephrine" … "IV"). Questions carry none.
 */
export function medParts(text: string): MedParts {
  const input = normalizeTranscript(text).trim();
  if (!input || /\?\s*$/.test(input) || question.test(input)) return {};
  const found = findDrug(input, true);
  const masked = found ? input.slice(0, found.index) + ' '.repeat(found.end - found.index) + input.slice(found.end) : input;
  // A number without a unit counts only when it is nearly the whole line ("One." after "What dose?"), so a year
  // or a count elsewhere in a sentence never becomes a dose.
  const shortLine = input.split(/\s+/).length <= 3;
  const dose = [...masked.matchAll(numberPattern)].map(m => {
    const after = masked.slice(m.index! + m[0].length).trimStart();
    return { dose: parseNumber(m[0]), unit: units.find(([pattern]) => pattern.test(after))?.[1], after };
  }).find(c => Number.isFinite(c.dose) && c.dose > 0 && !/^(?::|%|[- ]?years?\b|percent\b|minutes?\b|min\b|seconds?\b|o['’]clock\b)/i.test(c.after) && (c.unit || shortLine));
  const route = routes.find(([pattern]) => pattern.test(masked))?.[1];
  return { ...(found ? { drug: found.drug } : {}), ...(dose ? { dose: dose.dose, ...(dose.unit ? { unit: dose.unit } : {}) } : {}), ...(route ? { route } : {}) };
}

/** Riva mishearings seen at the table, mapped to the words the parser knows (spec §16). */
const MISHEARINGS: [RegExp, string][] = [
  [/\b(?:f\s?p\s?i\s?o|fpio|feio|feo|fio|fbi|f\.?e\.?o|epio|ebio|evio|eppio|eppy\s?o|epi\s?o|happy\s?o|epi\s?eye\s?oh|f\s?e\s?i\s?o)\b/gi, 'epi IO'],
  [/\b(?:epi\s?i\s?v|epiv|eppy\s?v)\b/gi, 'epi IV'],
  [/\bministering\b/gi, 'administering'],
  [/\b(?:a\s+)?pine\s*(?:f|ph)(?:ine|rine|rin|ren|reen)\b/gi, 'epinephrine'],
  [/\bepi\s+(?:nephrine|nefrine|fine|frin|phrine)\b/gi, 'epinephrine'],
  [/\b(?:ebi|evi|epe|eppy|epee|e\s?p\s?i)\b/gi, 'epi'],
  [/\b(?:ammio|amy\s?o|ami\s?o)\b/gi, 'amio'],
  [/\b(?:nar\s?can|narcon)\b/gi, 'Narcan'],
  [/\b(?:i\s?gel|eye\s?gel|igel)\b/gi, 'i-gel'],
];
export function normalizeTranscript(text: string): string {
  let out = text.replace(/\b(?:uh|um|erm)\b[,.]?\s*/gi, '');
  // "one a milligram", "three hundred a milligrams": a stray article inside a dose.
  out = out.replace(/\b(\d+(?:\.\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten|hundred|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|point)\s+(?:a|an|the)\s+(mg|mcg|milligrams?|micrograms?|grams?|units?|joules?|m(?:illi)?l)\b/gi, '$1 $2');
  for (const [pattern, replacement] of MISHEARINGS) out = out.replace(pattern, replacement);
  return out;
}

export function parseReadback(text: string): ReadbackMatch | MissingDose | MissingDrug | undefined {
  const input = normalizeTranscript(text).trim();
  if (!input || /\?\s*$/.test(input) || question.test(input)) return;
  // Sound-alikes only when the line is clearly a dose being given (a verb and a dose unit).
  const doseGiven = verb.test(input) && /\b(?:\d+(?:\.\d+)?\s*(?:mg|mcg|g)|milligrams?|micrograms?|grams?|units?)\b/i.test(input);
  const found = findDrug(input, doseGiven);
  // Negation and plans count only in the administration clause: up to the first comma or full stop after the
  // drug ("Giving epi one milligram, no allergies" is a dose; "We have not given epi 1 mg" is not).
  const afterDrug = found ? input.slice(found.end) : '';
  const clauseBreak = afterDrug.search(/[,.;]/);
  const clause = found && clauseBreak >= 0 ? input.slice(0, found.end + clauseBreak) : input;
  if (negation.test(clause) || plans.test(clause)) return;
  const shockWord = /\bshock(?:ed)?\b/i.test(input);
  const shockContext = shockWord || /\b(?:defib|defibrillated|joules?|j)\b/i.test(input);
  const hasVerb = verb.test(input) || /\bshock\s+delivered\b/i.test(input);
  // A dose with a drug-style unit after an administration verb, but no drug we know: ask, never guess.
  // Mass units only: fluids ("500 mL saline") are not tracked drugs and must not prompt.
  if (!found && !shockContext && hasVerb && /\b\d+(?:\.\d+)?\s*(?:mg|mcg|milligrams?|micrograms?|grams?)\b|\b(?:milligrams?|micrograms?)\b/i.test(input)) {
    const heard = [...input.matchAll(numberPattern)].map(m => ({ dose: parseNumber(m[0]), after: input.slice(m.index! + m[0].length).trimStart() })).find(c => Number.isFinite(c.dose));
    const unit = heard ? units.find(([pattern]) => pattern.test(heard.after))?.[1] : undefined;
    const route = routes.find(([pattern]) => pattern.test(input))?.[1];
    return { kind: 'missing_drug', ...(heard && unit ? { dose: heard.dose, unit } : {}), ...(route ? { route } : {}), spoken: 'Say again the drug.' };
  }
  if (!found && !shockContext) return;
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
    if (!found || !candidate || !candidate.unit) return;
    // Drug-first with the dose statement alone ("Epi ten milligrams"), or any order when the unit is explicit
    // ("one milligram of epi IO": the verb fell into the previous turn). Questions and plans were filtered above.
    if (found.index === 0 && candidate.start >= found.end) {
      let remainder = input.slice(candidate.unitEnd).trim().replace(/[.!]+$/, '').trim();
      for (const [pattern] of routes) remainder = remainder.replace(pattern, '').trim();
      if (remainder) return;
    } else if (input.split(/\s+/).length > 8) {
      return;
    }
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

/**
 * The medic's answer to "Log it?". The whole line must be the answer, so "No pulse, starting compressions" or
 * "Yes, and get the pads on" are never taken as one; the brain only asks this within a short window.
 */
export function parseAnswer(text: string): 'yes' | 'no' | undefined {
  const t = text.trim().toLowerCase().replace(/[.!?,]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^(?:(?:yes|yeah|yep|yup|affirmative|correct|sure|please|ok|okay)(?: (?:please|log it|go ahead|do it|log that|confirm|that's right|thats right))*|log it|log that|go ahead|do it)$/.test(t)) return 'yes';
  if (/^(?:(?:no|nope|negative)(?: (?:don't log it|do not log it|don't|cancel(?: it| that)?|that's wrong|thats wrong|wrong))*|don't log it|do not log it|don't log that)$/.test(t)) return 'no';
}

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth', 'twentieth'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** "fourteenth" → "14", "twenty-third" → "23", "nineteen sixty-eight" → "1968", "two thousand five" → "2005". */
function spokenDateWords(text: string): string {
  const units = 'one|two|three|four|five|six|seven|eight|nine';
  const ord = (w: string) => ORDINALS.indexOf(w.toLowerCase()) + 1;
  return text
    .replace(new RegExp(`\\b(twenty|thirty)[ -](${ORDINALS.slice(0, 9).join('|')})\\b`, 'gi'), (_m, tens: string, o: string) => String((tens.toLowerCase() === 'twenty' ? 20 : 30) + ord(o)))
    .replace(/\bthirtieth\b/gi, '30')
    .replace(new RegExp(`\\b(${ORDINALS.join('|')})\\b`, 'gi'), o => String(ord(o)))
    .replace(new RegExp(`\\bnineteen[ -](twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[ -](${units}))?\\b`, 'gi'), (_m, tens: string, unit?: string) => String(1900 + (numberWords[tens.toLowerCase()] ?? 0) + (unit ? numberWords[unit.toLowerCase()] : 0)))
    .replace(new RegExp(`\\btwo thousand(?: and)?(?:[ -](${units}|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty))?\\b`, 'gi'), (_m, unit?: string) => String(2000 + (unit ? numberWords[unit.toLowerCase()] : 0)));
}

export function parseIdentity(raw: string): { name: string; birthDate: string } | undefined {
  const text = spokenDateWords(raw);
  const name = /\b(?:patient(?:'s|’s) name is|patient is|this is|name is)\s+([a-z]+(?:[-'][a-z]+)?(?:\s+[a-z]+(?:[-'][a-z]+)?){1,2})(?=\s*,|\s+(?:born|date of birth|dob)\b)/i.exec(text)?.[1];
  const month = `(${MONTHS.join('|')})`;
  const date = new RegExp(`\\b(?:born|date of birth|dob)\\s*(?:[:,]|\\s(?:in|on|is))?\\s*(?:(\\d{1,2})[\\/-](\\d{1,2})[\\/-](\\d{4})|${month}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*,?\\s+(\\d{4})|(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${month}\\s*,?\\s+(\\d{4}))`, 'i').exec(text);
  if (!name || !date) return;
  const monthOf = (m: string) => MONTHS.indexOf(m.toLowerCase()) + 1;
  const monthNo = date[1] ? Number(date[1]) : date[4] ? monthOf(date[4]) : monthOf(date[8]);
  const day = Number(date[2] ?? date[5] ?? date[7]);
  const year = Number(date[3] ?? date[6] ?? date[9]);
  const check = new Date(Date.UTC(year, monthNo - 1, day));
  if (year < 100 || check.getUTCFullYear() !== year || check.getUTCMonth() !== monthNo - 1 || check.getUTCDate() !== day) return;
  return { name: name.split(/\s+/).map(part => title(part.toLowerCase())).join(' '), birthDate: `${year}-${String(monthNo).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
}
