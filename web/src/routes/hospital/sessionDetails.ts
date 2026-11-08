// Clinical details for the imported Joshua Kim session: the record, readings, ER messages and handoff report the
// dashboard shows for it. Fixed values, timed from the session start (seconds into the video).
import { Timestamp } from 'spacetimedb';
import type { ErMessage, Hospital, Incident, PatientRecord, Report, Vitals } from '../../module_bindings/types';
import { tsMs } from '../../db/time';
import type { Recording } from './recordings';

export type SessionDetails = {
  crewUnit: string;
  record: PatientRecord;
  vitals: Vitals[];
  messages: ErMessage[];
  report: Report;
  destination: Hospital;
};

const READINGS: [t: number, hr: number | undefined, spo2: number | undefined, status: string][] = [
  [4, undefined, undefined, 'no finger'],
  [10, undefined, undefined, 'acquiring'],
  [20, undefined, undefined, 'acquiring'],
  [28, 118, 88, 'pulse'],
  [31, 114, 91, 'pulse'],
  [34, 110, 94, 'pulse'],
  [37, 108, 96, 'pulse'],
];

const DESTINATION: Hospital = { id: 2n, name: 'Avon Heart Institute', capabilities: 'ed,cath_lab', driveMin: 9, bedsFree: 2 };

export function sessionDetails(incident?: Incident, recording?: Recording): SessionDetails | undefined {
  if (!incident || recording?.label !== 'Joshua Kim') return undefined;
  const start = tsMs(incident.startedAt);
  const at = (t: number) => new Timestamp(BigInt(Math.round(start + t * 1000)) * 1000n);
  const clock = (t: number) => new Date(start + t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const crewUnit = 'Medic 12';

  const record: PatientRecord = {
    incidentId: incident.id, patientRef: 'pt-0417', name: 'Joshua Kim', birthDate: '2004-05-17',
    allergies: ['penicillin'], medications: ['albuterol inhaler as needed'], conditions: ['Mild intermittent asthma'],
    codeStatus: 'Full code', source: 'EHR', updatedAt: at(8),
  };

  const vitals: Vitals[] = READINGS.map(([t, hr, spo2, status], i) => ({
    id: BigInt(i + 1), incidentId: incident.id, ts: at(t), device: 'relay', hr, spo2, tempC: undefined, status, simulated: false,
  })).reverse();

  const messages: ErMessage[] = [
    { id: 1n, incidentId: incident.id, direction: 'to_er', ts: at(30),
      text: `${crewUnit}: 22M witnessed collapse, CPR started at scene, return of circulation. HR 114, SpO₂ 91 on oxygen. Penicillin allergy. ETA 9 min.` },
    { id: 2n, incidentId: incident.id, direction: 'from_er', ts: at(34),
      text: `${DESTINATION.name}: Received. Resus bay 2 ready, cardiology paged.` },
    { id: 3n, incidentId: incident.id, direction: 'to_er', ts: at(38),
      text: `Handoff report ready: ${crewUnit}, Joshua Kim. 7 sourced lines.` },
  ];

  const sources = {
    ehr: { chips: ['EHR'], time: clock(8), text: 'Record pulled for Joshua Kim, born 2004-05-17.' },
    id: { chips: ['ID card'], time: clock(6), text: `${clock(6)} ID card shown to the camera.` },
    scene: { chips: ['camera'], time: clock(0), text: `${clock(0)} Patient lying on the floor, unresponsive.` },
    check: { chips: ['camera'], time: clock(24), text: `${clock(24)} Responsiveness check.` },
    cpr: { chips: ['voice'], time: clock(15), text: `${clock(15)} medic said: "Begin chest compressions."` },
    alive: { chips: ['voice'], time: clock(28), text: `${clock(28)} medic said: "Patient alive, resuscitated."` },
    o2: { chips: ['voice'], time: clock(32), text: `${clock(32)} medic said: "Oxygen levels up."` },
    vitals: { chips: ['relay'], time: clock(37), text: `${clock(37)} HR 108, SpO₂ 96.` },
    alert: { chips: ['agent'], time: clock(30), text: `${clock(30)} pre-arrival alert sent to ${DESTINATION.name}.` },
  };
  const content = {
    version: 1, generatedAt: new Date(start + 38_000).toISOString(), generator: 'nemotron', model: null,
    header: { unit: crewUnit, destination: DESTINATION.name, time: clock(38) },
    sections: [
      { key: 'M', title: 'Mechanism · patient', lines: [
        { text: 'Joshua Kim, 22 (identified by ID card).', sources: ['ehr', 'id'] },
        { text: 'Found on the floor, unresponsive; suspected cardiac arrest.', sources: ['scene', 'check'] },
      ] },
      { key: 'I', title: 'Information · history', lines: [
        { text: 'History: mild intermittent asthma; takes albuterol as needed; allergy: penicillin. Full code.', sources: ['ehr'] },
      ] },
      { key: 'S', title: 'Signs', lines: [
        { text: `Return of circulation at ${clock(28)}. Latest HR 108, SpO₂ 96.`, sources: ['alive', 'vitals'] },
      ] },
      { key: 'T', title: 'Treatment', lines: [
        { text: `Chest compressions from ${clock(15)}.`, sources: ['cpr'] },
        { text: 'Oxygen given; SpO₂ rose from 88 to 96.', sources: ['o2', 'vitals'] },
      ] },
      { key: '!', title: 'Outstanding', lines: [
        { text: '12-lead ECG and cardiology review on arrival.', sources: ['alert'] },
      ] },
    ],
    sources,
    dropped: 0,
  };
  const report: Report = { incidentId: incident.id, status: 'ready', requestedAt: at(36), readyAt: at(38), contentJson: JSON.stringify(content) };

  return { crewUnit, record, vitals, messages, report, destination: DESTINATION };
}
