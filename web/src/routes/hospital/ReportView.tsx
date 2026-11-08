// The handoff report (spec §20, H7): MIST lines, each with its source chips. Rendered from report.contentJson,
// which the agent (W4) writes. Hover a chip to see the evidence.

type Line = { text: string; sources: string[] };
type Section = { key: string; title: string; lines: Line[] };
type SourceInfo = { chips: string[]; time: string | null; text: string };
type ReportContent = {
  version: number;
  generatedAt: string;
  generator: 'nemotron' | 'template';
  model: string | null;
  header: { unit: string; destination: string | null; time: string };
  sections: Section[];
  sources: Record<string, SourceInfo>;
  dropped: number;
};

function parse(json: string): ReportContent | undefined {
  try {
    const value = JSON.parse(json) as ReportContent;
    // Defensive: another writer (e.g. the voice agent) may store a partial report.
    if (!value || !Array.isArray(value.sections)) return undefined;
    return { ...value, header: value.header ?? { unit: '', destination: null, time: '' }, sources: value.sources ?? {} };
  } catch {
    return undefined;
  }
}

export default function ReportView({ contentJson }: { contentJson: string }) {
  const report = parse(contentJson);
  if (!report) {
    return (
      <div className="report">
        <p className="muted">The report couldn't be read.</p>
      </div>
    );
  }
  const { header } = report;
  return (
    <div className="report">
      <div className="report__header">
        <h2 className="report__title">Handoff report</h2>
        <span>
          {header.unit} → {header.destination ?? 'destination not set'} · {header.time}
        </span>
        <span className="report__meta">
          Written by {report.generator === 'nemotron' ? 'Nemotron' : 'a template from the tables'}
          {report.dropped > 0 ? ` · ${report.dropped} line${report.dropped > 1 ? 's' : ''} dropped by the self-check` : ''}
          {' · '}Prototype · synthetic data · not for clinical use
        </span>
      </div>
      <table className="report__table">
        <tbody>
          {report.sections.map(section =>
            !Array.isArray(section.lines) || section.lines.length === 0 ? null : (
              section.lines.map((line, i) => (
                <tr key={`${section.key}-${i}`}>
                  <th title={section.title}>{i === 0 ? section.key : ''}</th>
                  <td className="report__text">{line.text}</td>
                  <td className="report__chips">
                    {(line.sources ?? []).map(id => {
                      const src = report.sources[id];
                      const label = src?.chips?.length ? src.chips.join(' · ') : id;
                      return (
                        <span key={id} className="chip" title={src ? `${src.time ?? ''} ${src.text}`.trim() : id}>
                          {label}
                          {src?.time ? ` ${src.time}` : ''}
                        </span>
                      );
                    })}
                  </td>
                </tr>
              ))
            )
          )}
        </tbody>
      </table>
    </div>
  );
}
