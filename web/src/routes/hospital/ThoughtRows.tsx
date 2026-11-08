// The agents' reasoning inside the event timeline (spec §14, H5): a live thought is one line at the top that swaps
// to each new step with a short crossfade; a finished thought is one row that expands to its steps.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { clock } from '../../db/time';
import { Stamp } from './Stamp';
import { agentLabel, decisionUpdate, headline, stepSentence, type Thought } from './thoughts';

const SWAP_MS = 200; // the outgoing copy's CSS animation is 140 ms

/** The line under way right now: the agent, then its current step as a sentence. */
export function LiveThought({ thought }: { thought: Thought }) {
  const step = thought.steps[thought.steps.length - 1];
  const { phrase, detail } = stepSentence(step, 'now');
  return (
    <li className="thought thought--live">
      <span className="timeline__time">{clock(step.ts)}</span>
      <div className="thought__line" aria-live="polite">
        <span className="thought__agent">{agentLabel(thought)}</span>
        {/* Keyed by position, so a step that only refreshes its numbers updates in place without a crossfade. */}
        <Swap id={`${thought.key}:${thought.steps.length}`}>
          <Sentence phrase={phrase} detail={detail} />
        </Swap>
      </div>
    </li>
  );
}

/** A finished thought: one row named by its most telling step; click to see every step. */
export function ThoughtRow({ thought, open, onToggle, active = false, videoStart }: { thought: Thought; open: boolean; onToggle: () => void; active?: boolean; videoStart?: number }) {
  const { phrase, detail } = stepSentence(headline(thought), active ? 'now' : 'done');
  const label = agentLabel(thought);
  const many = thought.steps.length > 1;
  const line = (
    <>
      <span className="thought__agent">{label}</span>
      <span className="thought__text" title={detail ? `${phrase} · ${detail}` : phrase}>
        <Sentence phrase={phrase} detail={detail} />
      </span>
      {many && <span className="thought__count">{open ? 'Hide' : `${thought.steps.length} steps`}</span>}
    </>
  );
  return (
    <li className="thought">
      <span className="timeline__time">{videoStart === undefined ? new Date(thought.startMs).toLocaleTimeString([], { hour12: false }) : <Stamp t={thought.startMs} videoStart={videoStart} />}</span>
      <div className="thought__body">
        {many ? (
          <button type="button" className="thought__line thought__line--button" aria-expanded={open} onClick={onToggle}>
            {line}
          </button>
        ) : (
          <div className="thought__line">{line}</div>
        )}
        {many && open && (
          <ol className="thought__steps">
            {thought.steps.map(s => {
              const st = stepSentence(s, decisionUpdate(s)?.phase === 'progress' ? 'now' : 'done');
              return (
                <li key={String(s.id)}>
                  <span className="thought__tool">{decisionUpdate(s)?.phase === 'progress' ? 'Working' : decisionUpdate(s)?.phase === 'error' ? 'Issue' : decisionUpdate(s) ? 'Decision' : 'Activity'}</span>
                  <span>
                    <Sentence phrase={st.phrase} detail={st.detail} />
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </li>
  );
}

function Sentence({ phrase, detail }: { phrase: string; detail: string }) {
  return (
    <>
      {phrase}
      {detail && <span className="thought__detail"> · {detail}</span>}
    </>
  );
}

/**
 * Crossfades from the previous content to the new one whenever `id` changes. Under prefers-reduced-motion the CSS
 * turns the animation off and hides the outgoing copy, so the text simply swaps.
 */
function Swap({ id, children }: { id: string; children: ReactNode }) {
  const last = useRef<{ id: string; node: ReactNode }>({ id, node: children });
  const [leaving, setLeaving] = useState<{ id: string; node: ReactNode } | null>(null);

  useLayoutEffect(() => {
    if (last.current.id === id) return;
    setLeaving(last.current);
    const timer = setTimeout(() => setLeaving(null), SWAP_MS);
    return () => clearTimeout(timer);
  }, [id]);
  useEffect(() => {
    last.current = { id, node: children };
  });

  return (
    <span className="swap">
      {leaving && (
        <span key={`out-${leaving.id}`} className="swap__out" aria-hidden="true">
          {leaving.node}
        </span>
      )}
      <span key={`in-${id}`} className="swap__in">
        {children}
      </span>
    </span>
  );
}
