// W1 · Destination and pre-arrival alert (spec §19, §21 E1).
// Trigger: incident status becomes arrest or en_route and no destination is set yet.
// Nemotron chooses the hospital and writes the alert through tools; the rule below finishes anything it
// didn't do (no key, error, timeout), so the alert always appears within 20 s.
import type { Conn } from './db';
import { step } from './db';
import { CONFIG, llmConfigured } from './config';
import { chat, numbersSupported, unsupportedClaim, type ChatMessage, type ToolDef } from './llm';
import { ageOn, hhmm, isTreatment, snapshot, type Snapshot } from './facts';

const W = 'W1';

type Hospital = Snapshot['hospitals'][number];

/** The rule: cardiac arrest needs a cath lab (PCI); otherwise the nearest ED. Free beds required. */
export function chooseHospital(s: Snapshot): Hospital | undefined {
  const needsCathLab = s.incident?.status === 'arrest' || s.events.some(e => e.kind === 'status_arrest');
  const withBeds = s.hospitals.filter(h => h.bedsFree > 0);
  const fit = withBeds.filter(h => !needsCathLab || h.capabilities.split(',').includes('cath_lab'));
  const pool = fit.length ? fit : withBeds;
  return [...pool].sort((a, b) => a.driveMin - b.driveMin)[0];
}

/** E1 alert from the tables only: unit, patient name and age, problem, key treatments, allergies, ETA. */
export function templateAlert(s: Snapshot, h: Hospital): string {
  const inc = s.incident!;
  const problem =
    inc.status === 'arrest' ? 'cardiac arrest, CPR in progress' : inc.status === 'en_route' ? 'transporting' : inc.status;
  const age = s.record ? ageOn(s.record.birthDate) : undefined;
  const who = s.record ? `${s.record.name}${age !== undefined ? `, ${age}` : ''}` : 'patient not yet identified';
  // Flagged items (an allergy warning, a drug seen but not said) are not confirmed as given.
  const treatments = s.events.filter(e => isTreatment(e.kind) && e.status !== 'flagged').map(e => `${e.label} ${hhmm(e.ts)}`);
  const cached = s.record?.source === 'cached' ? ' (cached record)' : '';
  const allergies = s.record?.allergies.length ? ` Allergy on record${cached}: ${s.record.allergies.join(', ')}.` : '';
  return (
    `${inc.unit}: ${problem}. ${who}.` +
    (treatments.length ? ` Given: ${treatments.join('; ')}.` : '') +
    allergies +
    ` ETA ${h.driveMin} min to ${h.name}.`
  );
}

function incidentFacts(s: Snapshot) {
  const inc = s.incident!;
  const age = s.record ? ageOn(s.record.birthDate) : undefined;
  return {
    unit: inc.unit,
    status: inc.status,
    started: hhmm(inc.startedAt),
    arrest_started: inc.arrestStartedAt ? hhmm(inc.arrestStartedAt) : null,
    patient: s.record
      ? {
          name: s.record.name,
          age,
          allergies: s.record.allergies,
          medications: s.record.medications,
          conditions: s.record.conditions,
          code_status: s.record.codeStatus,
          source: s.record.source,
        }
      : null,
    treatments_so_far: s.events
      .filter(e => isTreatment(e.kind) && e.status !== 'flagged')
      .map(e => ({ time: hhmm(e.ts), what: e.label })),
    flagged_not_confirmed_as_given: s.events
      .filter(e => e.status === 'flagged')
      .map(e => ({ time: hhmm(e.ts), what: e.label })),
    timeline: s.events.map(e => ({ time: hhmm(e.ts), what: e.label })),
  };
}

const TOOLS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'get_incident',
      description: 'The incident: unit, status, patient record (if identified), treatments and timeline so far.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_hospitals',
      description: 'Receiving hospitals with capabilities (ed, cath_lab), drive time in minutes and free beds.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_destination',
      description: 'Set the destination hospital. The ETA is the hospital drive time.',
      parameters: {
        type: 'object',
        properties: { hospital_id: { type: 'integer', description: 'id from list_hospitals' } },
        required: ['hospital_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'post_er_message',
      description: 'Post the pre-arrival alert to the receiving ER (display-only). Call once.',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string', description: 'The alert, at most 45 words, facts from the tools only' } },
        required: ['text'],
      },
    },
  },
];

const SYSTEM = `You are the dispatch agent in Handoff, a prototype paramedic assistant. All data is synthetic.
An incident's status just changed. Do exactly this, using the tools:
1. Call get_incident and list_hospitals.
2. Choose the destination: for cardiac arrest, the closest hospital with a cath lab (cath_lab) and free beds;
   otherwise the closest emergency department with free beds.
3. Call set_destination with that hospital's id.
4. Call post_er_message once with the pre-arrival alert: the unit, the patient's name and age if known (otherwise
   "patient not yet identified"), the problem, key treatments so far, recorded allergies if any, and the ETA in
   minutes. At most 45 words, plain text.
Describe the status exactly as get_incident gives it: "arrest" is a cardiac arrest on scene with CPR in progress;
say "transporting" only when the status is "en_route".
Use only facts returned by the tools. Never invent vitals, names, doses, times or findings. Do not give orders.`;

export async function runW1(conn: Conn, incidentId: bigint, trigger: string) {
  const deadline = Date.now() + CONFIG.w1DeadlineMs;
  await step(conn, W, '', `Trigger: status became ${trigger.toUpperCase()}`);

  const state = { destination: undefined as Hospital | undefined, alertPosted: false };
  const corpus: string[] = []; // everything the tools returned, for the facts-only check on the alert

  const setDestination = async (h: Hospital, how: string) => {
    await conn.reducers.setDestination({ hospitalId: h.id, etaMin: h.driveMin });
    state.destination = h;
    await step(conn, W, 'set_destination', `${h.name}, ${h.driveMin} min (${how})`);
  };
  const postAlert = async (text: string, how: string) => {
    // X7: a record from the cached copy must say so.
    const rec = snapshot(conn, incidentId).record;
    if (rec?.source === 'cached' && !/cached/i.test(text)) text += ' (patient record from cached copy)';
    await conn.reducers.erMessageOut({ text });
    state.alertPosted = true;
    await step(conn, W, 'post_er_message', `Pre-arrival alert posted (${how})`);
  };

  const runTool = async (name: string, args: Record<string, unknown>): Promise<string> => {
    const s = snapshot(conn, incidentId);
    if (!s.incident || s.incident.status === 'closed') return JSON.stringify({ error: 'incident is closed' });
    switch (name) {
      case 'get_incident': {
        const out = JSON.stringify(incidentFacts(s));
        corpus.push(out);
        await step(conn, W, 'get_incident', s.record ? `${s.record.name}; status ${s.incident.status}` : `status ${s.incident.status}; patient not identified`);
        return out;
      }
      case 'list_hospitals': {
        const out = JSON.stringify(
          s.hospitals.map(h => ({ id: Number(h.id), name: h.name, capabilities: h.capabilities, drive_min: h.driveMin, beds_free: h.bedsFree }))
        );
        corpus.push(out);
        await step(conn, W, 'list_hospitals', `${s.hospitals.length} hospitals`);
        return out;
      }
      case 'set_destination': {
        if (state.destination) return JSON.stringify({ ok: true, note: `already set to ${state.destination.name}` });
        const h = s.hospitals.find(x => Number(x.id) === Number(args.hospital_id));
        if (!h) return JSON.stringify({ error: 'unknown hospital_id' });
        if (h.bedsFree === 0) return JSON.stringify({ error: `${h.name} has no free beds` });
        const ruleChoice = chooseHospital(s);
        if (s.incident.status === 'arrest' && !h.capabilities.split(',').includes('cath_lab') && ruleChoice) {
          return JSON.stringify({ error: `cardiac arrest needs a cath lab; ${h.name} has none` });
        }
        await setDestination(h, 'Nemotron');
        return JSON.stringify({ ok: true, hospital: h.name, eta_min: h.driveMin });
      }
      case 'post_er_message': {
        if (state.alertPosted) return JSON.stringify({ ok: true, note: 'already posted' });
        if (!state.destination) return JSON.stringify({ error: 'call set_destination first' });
        const text = String(args.text ?? '').trim();
        const words = text.split(/\s+/).filter(Boolean).length;
        if (!text || words > 55) return JSON.stringify({ error: 'alert must be at most 45 words' });
        if (!numbersSupported(text, corpus.join(' '))) {
          await step(conn, W, 'self_check', 'Alert rejected: a number in it is not in the tool results');
          return JSON.stringify({ error: 'every number must come from the tool results; rewrite it' });
        }
        const claim = unsupportedClaim(text, corpus.join(' '));
        if (claim) {
          await step(conn, W, 'self_check', `Alert rejected: "${claim}" is not in the tool results`);
          return JSON.stringify({ error: `"${claim}" is not supported by the tool results (status is ${s.incident.status}); rewrite it` });
        }
        await postAlert(text, 'Nemotron');
        return JSON.stringify({ ok: true });
      }
      default:
        return JSON.stringify({ error: `unknown tool ${name}` });
    }
  };

  if (llmConfigured()) {
    await step(conn, W, 'plan', 'Pick a hospital that fits the problem, set the destination, alert the ER');
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Incident ${incidentId}: status became ${trigger}.` },
    ];
    try {
      for (let turn = 0; turn < 6 && !(state.destination && state.alertPosted); turn++) {
        const remaining = deadline - Date.now();
        if (remaining < 1500) throw new Error('W1 deadline reached');
        const reply = await chat(messages, { tools: TOOLS, timeoutMs: Math.min(remaining, CONFIG.llmTimeoutMs) });
        if (reply.toolCalls.length === 0) break;
        messages.push({ role: 'assistant', content: reply.content || null, tool_calls: reply.toolCalls });
        for (const call of reply.toolCalls) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(call.function.arguments || '{}');
          } catch {
            // leave empty; the tool reports what's missing
          }
          const result = await runTool(call.function.name, args);
          messages.push({ role: 'tool', tool_call_id: call.id, content: result });
        }
      }
    } catch (err) {
      await step(conn, W, 'fallback', `Nemotron: ${(err as Error).message.slice(0, 120)}`);
    }
  } else {
    await step(conn, W, 'fallback', 'Nemotron not configured (no NVIDIA_API_KEY); using the rule');
  }

  // Finish whatever the model didn't do, from the tables only.
  const s = snapshot(conn, incidentId);
  if (!s.incident || s.incident.status === 'closed') return;
  if (!state.destination) {
    const h = chooseHospital(s);
    if (!h) {
      await step(conn, W, 'choose_hospital', 'No hospital with free beds');
      return;
    }
    await step(conn, W, 'choose_hospital', `${h.name}: ${h.capabilities.includes('cath_lab') ? 'cath lab, ' : ''}${h.driveMin} min, ${h.bedsFree} beds`);
    await setDestination(h, 'rule');
  }
  if (!state.alertPosted) await postAlert(templateAlert(snapshot(conn, incidentId), state.destination!), 'template');
}
