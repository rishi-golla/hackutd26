import type { Route, Unit } from './readback.js';

// Number wording follows the existing callouts (§15), with decimal digits spoken individually.
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const tens = TENS[Math.floor(n / 10)];
  return n % 10 ? `${tens}-${ONES[n % 10]}` : tens;
}

export function spoken(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n > 999) return String(n);
  if (!Number.isInteger(n)) {
    const [whole, fraction] = String(n).split('.');
    if (!fraction) return String(n);
    return `${spoken(Number(whole))} point ${[...fraction].map(d => ONES[Number(d)]).join(' ')}`;
  }
  if (n < 100) return twoDigits(n);
  const hundreds = ONES[Math.floor(n / 100)];
  const rest = n % 100;
  if (rest === 0) return `${hundreds} hundred`;
  if (rest < 10) return `${hundreds} oh ${ONES[rest]}`;
  return `${hundreds} ${twoDigits(rest)}`;
}

export function spokenUnit(unit: Unit, dose: number): string {
  const singular: Record<Unit, string> = { mg: 'milligram', mcg: 'microgram', g: 'gram', mL: 'millilitre', units: 'unit', J: 'joule' };
  return singular[unit] + (dose === 1 ? '' : 's');
}

export function spokenRoute(route: Route): string {
  return { IV: 'I-V', IO: 'I-O', IM: 'I-M', IN: 'intranasal', SL: 'sublingual', PO: 'by mouth', neb: 'nebulised' }[route];
}
