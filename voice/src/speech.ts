// Is the model's free text something to say to the medic, or its working notes? (spec §19 agent rules; live test
// Sun: the agent read its own keep/drop reasoning aloud while drugs were being given.) Conservative on purpose: a
// one- or two-sentence conversational answer passes; lists, JSON, markdown, reasoning and tool talk never do.

const MAX_WORDS = 45;
/** "One or two sentences" (decision 24): a third short one is tolerated, a paragraph is not. */
const MAX_SENTENCES = 3;
/** How the model opens its reasoning ("The medic is talking to…", "KEEP. Document…", "Let me check…"). */
const REASONING_START = /^\W*(?:the medic|the line|this line|the new line|the user|i should|i will|i need|i'll|let me|first,|step \d|keep\b|drop\b|document|reasoning|analysis|decision:|thinking|okay, so|so the)/i;
const TOOL_TALK = /\b(?:log_event|set_status|search_ehr|pull_record|check_dose_range|check_allergy|get_state|get_timeline|get_recent_transcript)\b|\bspeak\s*\(/i;
const INTERNAL_WORDS = /\b(?:the state|voice log|tools?)\b/i;
const LIST_LINE = /(?:^|\n)\s*(?:[-*•]|\d+[.)])\s+/;
const MARKDOWN = /```|(?:^|\n)\s*#{1,6}\s/;

/** True when `text` reads like a short spoken reply rather than reasoning, a list, markup or tool talk. */
export function looksLikeSpeech(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.split(/\s+/).length > MAX_WORDS) return false;
  if (t.split(/[.!?]+/).filter(part => part.trim()).length > MAX_SENTENCES) return false;
  if (/\n/.test(t) && LIST_LINE.test(t)) return false;
  if (/[{}[\]]/.test(t) || MARKDOWN.test(t)) return false;
  if (REASONING_START.test(t) || TOOL_TALK.test(t) || INTERNAL_WORDS.test(t)) return false;
  return true;
}
