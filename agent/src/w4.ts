// W4 · Generate Handoff (spec §19, §20, H7, D4, X6, E4).
// gather → draft MIST (Nemotron) → self-check drops any line without a valid source or with a number its sources
// don't contain → fill empty sections from the template → save_report. No key or a failure: template only.
import type { Conn } from './db';
import { step } from './db';
import { CONFIG, llmConfigured } from './config';
import { chat, numbersSupported, unsupportedClaim } from './llm';
import { ageOn, buildFacts, hhmm, hhmmMs, isTreatment, snapshot, type Fact, type Snapshot } from './facts';

const W = 'W4';

export type ReportLine = { text: string; sources: string[] };
export type SectionKey = 'M' | 'I' | 'S' | 'T' | '!';
const KEYS: SectionKey[] = ['M', 'I', 'S', 'T', '!'];
const TITLES: Record<SectionKey, string> = {
  M: 'Mechanism · patient',
  I: 'Information · history',
  S: 'Signs',
  T: 'Treatment',
  '!': 'Outstanding',
};
type Sections = Record<SectionKey, ReportLine[]>;

const empty = (): Sections => ({ M: [], I: [], S: [], T: [], '!': [] });

/** The report from the tables only (also the fallback when Nemotron is down). */
export function templateReport(s: Snapshot): Sections {
  const out = empty();
  const ev = (kindTest: (k: string) => boolean) => s.events.filter(e => kindTest(e.kind));
  const id = (e: { id: bigint }) => `ev:${e.id}`;

  const identified = ev(k => k === 'patient_identified')[0];
  if (s.record) {
    const age = ageOn(s.record.birthDate);
    out.M.push({
      text: `${s.record.name}${age !== undefined ? `, ${age}` : ''}${identified ? ` (identified by ${identified.sources[0]?.kind ?? 'crew'})` : ''}.`,
      sources: identified ? ['ehr', id(identified)] : ['ehr'],
    });
    out.I.push({
      text:
        `History from the record: ${s.record.conditions.join(', ') || 'none recorded'}; ` +
        `takes ${s.record.medications.join(', ') || 'no recorded medications'}; ` +
        `allergies: ${s.record.allergies.join(', ') || 'none recorded'}. Code status: ${s.record.codeStatus || 'not recorded'}.`,
      sources: ['ehr'],
    });
  } else {
    out.M.push({ text: 'Patient not identified.', sources: ['incident'] });
  }
  for (const e of ev(k => k === 'mark' || k === 'finding')) out.I.push({ text: `${e.label} (${hhmm(e.ts)}).`, sources: [id(e)] });

  const statusLines = ev(k => k.startsWith('status_') && k !== 'status_on_scene' && k !== 'status_closed');
  if (statusLines.length) {
    out.S.push({ text: statusLines.map(e => `${e.label} ${hhmm(e.ts)}`).join('. ') + '.', sources: statusLines.map(id) });
  }
  const vitalsFact = s.latestValid;
  if (vitalsFact) {
    const parts = [
      vitalsFact.hr !== undefined ? `HR ${Math.round(vitalsFact.hr)}` : undefined,
      vitalsFact.spo2 !== undefined ? `SpO₂ ${Math.round(vitalsFact.spo2)} (experimental)` : undefined,
      vitalsFact.tempC !== undefined ? `temperature ${vitalsFact.tempC.toFixed(1)} °C` : undefined,
    ].filter(Boolean);
    out.S.push({
      text: `Latest vitals ${hhmm(vitalsFact.ts)}: ${parts.join(', ')}${vitalsFact.simulated ? ' (simulated)' : ''}.`,
      sources: [`vitals:${vitalsFact.id}`],
    });
  }
  for (const e of ev(k => k.startsWith('vitals_alarm'))) out.S.push({ text: `${e.label} at ${hhmm(e.ts)}.`, sources: [id(e)] });

  const c = s.cpr;
  if (c && (c.rateSamples > 0 || c.count > c.countBase)) {
    const avg = c.rateSamples > 0 ? Math.round(c.rateSum / c.rateSamples) : undefined;
    out.T.push({
      text:
        `CPR${s.incident?.arrestStartedAt ? ` from ${hhmm(s.incident.arrestStartedAt)}` : ''}` +
        (avg !== undefined ? `, average rate ${avg}/min` : '') +
        `, longest pause ${Math.round(c.longestPauseS)} s, ${c.count - c.countBase} compressions` +
        (c.source === 'override' ? ' (demo override, simulated)' : '') +
        '.',
      sources: ['cpr'],
    });
  }
  // Flagged items (an allergy warning, a drug seen but not said) are not confirmed as given: they go under "!".
  for (const e of ev(isTreatment).filter(x => x.status !== 'flagged')) {
    out.T.push({ text: `${e.label} at ${hhmm(e.ts)}.`, sources: [id(e)] });
  }

  if (s.record?.allergies.length) {
    out['!'].push({
      text: `Allergy on record${s.record.source === 'cached' ? ' (cached record)' : ''}: ${s.record.allergies.join(', ')}.`,
      sources: ['ehr'],
    });
  }
  for (const e of s.events.filter(x => x.status === 'flagged')) {
    out['!'].push({ text: `Flagged, not confirmed as given: ${e.label} (${hhmm(e.ts)}); dose as stated by the crew only.`, sources: [id(e)] });
  }
  return out;
}

const SYSTEM = `You write the MIST handoff report for Handoff, a prototype paramedic assistant. All data is synthetic.
Use ONLY the numbered facts you are given. Every line must cite, in "sources", the ids of the facts it uses.
Never invent anything: no vitals, times, doses, names, sex, mechanism, findings, treatments or transport status
that are not in the facts.
Copy numbers and times exactly as they appear in the facts. Say "(experimental)" after SpO₂ values and "(simulated)"
after anything a fact marks as simulated. Never mention compression depth. Give no orders or advice.
Sections: "M" who the patient is and what happened; "I" history from the record, findings, MARK notes;
"S" signs: status times (arrest, ROSC) and vitals; "T" treatment: CPR numbers, medications, shocks, airway;
"!" outstanding items for the ER: allergies, flagged items (not confirmed as given), anything still pending.
Short lines (under 30 words). An empty list is fine when there are no facts for a section.
Reply with JSON only, no prose:
{"M":[{"text":"...","sources":["id"]}],"I":[],"S":[],"T":[],"!":[]}`;

function parseDraft(content: string): Sections {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON in the reply');
  const raw = JSON.parse(content.slice(start, end + 1)) as Record<string, unknown>;
  const out = empty();
  for (const key of KEYS) {
    const lines = Array.isArray(raw[key]) ? (raw[key] as unknown[]) : [];
    for (const l of lines) {
      const line = l as { text?: unknown; sources?: unknown };
      if (typeof line.text !== 'string') continue;
      out[key].push({
        text: line.text.trim(),
        sources: Array.isArray(line.sources) ? line.sources.map(String) : [],
      });
    }
  }
  return out;
}

/** Keep a line only if it cites known facts and every number in it appears in those facts. */
function selfCheck(draft: Sections, facts: Map<string, Fact>) {
  const kept = empty();
  let dropped = 0;
  for (const key of KEYS) {
    for (const line of draft[key]) {
      const cited = line.sources.filter(id => facts.has(id));
      const ok =
        line.text.length > 0 &&
        cited.length > 0 &&
        cited.length === line.sources.length &&
        numbersSupported(line.text, cited.map(id => facts.get(id)!.text).join(' '));
      const citedText = cited.map(id => facts.get(id)?.text ?? '').join(' ');
      // Also dropped: compression depth, and claims (sex, transport, shocks…) its cited facts don't contain.
      if (!ok || /depth/i.test(line.text) || unsupportedClaim(line.text, citedText)) {
        dropped++;
        continue;
      }
      // Labels the cited facts carry must survive into the line (decision 10, §24).
      let text = line.text;
      if (/simulated/i.test(citedText) && !/simulated/i.test(text)) text += ' (simulated)';
      if (/SpO₂ \d+ \(experimental\)/.test(citedText) && /spo/i.test(text) && !/experimental/i.test(text)) {
        text += ' (SpO₂ experimental)';
      }
      kept[key].push({ ...line, text });
    }
  }
  return { kept, dropped };
}

/**
 * Nothing the template knows may go missing: within each section, every template line whose sources the model
 * didn't cite in that section is added. That keeps the CPR numbers (D4), the EHR history (X6), the allergy under
 * "!" and every treatment, even when the model cited the same fact elsewhere.
 */
function fillFromTemplate(kept: Sections, template: Sections): Sections {
  const out = empty();
  for (const key of KEYS) {
    out[key] = [...kept[key]];
    for (const line of template[key]) {
      const citedHere = new Set(out[key].flatMap(l => l.sources));
      if (!line.sources.some(id => citedHere.has(id))) out[key].push(line);
    }
  }
  return out;
}

export async function runW4(conn: Conn, incidentId: bigint, trigger: string) {
  const deadline = Date.now() + CONFIG.w4DeadlineMs;
  await step(conn, W, '', `Trigger: ${trigger}`);

  const s = snapshot(conn, incidentId);
  if (!s.incident) return;
  const facts = buildFacts(s);
  const factMap = new Map(facts.map(f => [f.id, f]));
  await step(conn, W, 'gather', `${facts.length} facts from the timeline, vitals, CPR, transcript and record`);

  const template = templateReport(s);
  let sections = template;
  let generator: 'nemotron' | 'template' = 'template';
  let dropped = 0;

  if (llmConfigured()) {
    try {
      const reply = await chat(
        [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `Facts:\n${facts.map(f => `[${f.id}] ${f.text}`).join('\n')}` },
        ],
        { timeoutMs: Math.min(deadline - Date.now() - 2000, 22000), maxTokens: 1500 }
      );
      const draft = parseDraft(reply.content);
      await step(conn, W, 'draft', `Nemotron drafted ${KEYS.reduce((n, k) => n + draft[k].length, 0)} lines`);
      const checked = selfCheck(draft, factMap);
      dropped = checked.dropped;
      await step(conn, W, 'self_check', `Kept ${KEYS.reduce((n, k) => n + checked.kept[k].length, 0)} lines, dropped ${dropped} (no valid source, or a number or claim its sources don't support)`);
      sections = fillFromTemplate(checked.kept, template);
      generator = 'nemotron';
    } catch (err) {
      await step(conn, W, 'fallback', `Nemotron: ${(err as Error).message.slice(0, 120)}; template from the tables`);
    }
  } else {
    await step(conn, W, 'fallback', 'Nemotron not configured (no NVIDIA_API_KEY); template from the tables');
  }

  // Only facts the report cites go into its source list (what the chips resolve to).
  const cited = new Set(KEYS.flatMap(k => sections[k].flatMap(l => l.sources)));
  const content = {
    version: 1,
    generatedAt: new Date().toISOString(),
    generator,
    model: generator === 'nemotron' ? CONFIG.model : null,
    header: {
      unit: s.incident.unit,
      destination: s.destination?.name ?? null,
      time: hhmmMs(Date.now()),
    },
    sections: KEYS.map(key => ({ key, title: TITLES[key], lines: sections[key] })),
    sources: Object.fromEntries(facts.filter(f => cited.has(f.id)).map(f => [f.id, { chips: f.chips, time: f.time ?? null, text: f.text }])),
    dropped,
  };
  const lineCount = KEYS.reduce((n, k) => n + sections[k].length, 0);

  // E4: the summary posts when the handoff is generated (before save_report closes the incident).
  const who = s.record ? s.record.name : 'unidentified patient';
  await conn.reducers.erMessageOut({ text: `Handoff report ready: ${s.incident.unit}, ${who}. ${lineCount} sourced lines.` });
  await step(conn, W, 'save_report', `${lineCount} lines (${generator}); incident closes`);
  await conn.reducers.saveReport({ incidentId, contentJson: JSON.stringify(content) });
}
