// Lead-in words people type or say before the actual task ("add task to
// finalise the firmware", "remind me to call mum") are about saving it, not
// part of what it is. Quick add, chat add and the Fix-it list all use this,
// and raspberry_pi/quick_add.py strip_lead_in mirrors it for Siri and email.

const LEAD_IN = new RegExp([
  // "add (a new) task to", "create a reminder for", "new todo:", "put a task that says"
  String.raw`(?:(?:please|pls|can\s+you|could\s+you)\s+)?(?:add|create|make|put|new|set\s+up|log)\s+(?:(?:a|an|the|one|another)\s+)?(?:new\s+)?(?:task|todo|to-do|reminder|item)\s*(?::|-|to\b|for\b|about\b|that\s+says\b)?\s*`,
  // "task: ", "todo - "
  String.raw`(?:task|todo|to-do|reminder)\s*[:\-]\s*`,
  // "remind me to", "remind me about"
  String.raw`remind\s+me\s+(?:to|about)\s+`,
  // "I need to", "don't forget to"
  String.raw`(?:i\s+(?:need|have|want)\s+to|i\s+should|i\s+must|need\s+to|have\s+to|gotta|got\s+to|don'?t\s+forget\s+to)\s+`,
].map(p => `^(?:${p})`).join('|'), 'i');

/** "Add task to finalise lumo's firmware" → "Finalise lumo's firmware". Unchanged when nothing would be left. */
export function stripLeadIn(title: string): string {
  let t = (title || '').trim();
  for (let i = 0; i < 3; i++) {
    const next = t.replace(LEAD_IN, '').trim();
    if (next === t || !next) break;
    t = next;
  }
  if (!t) return title;
  return t === title.trim() ? title : t[0].toUpperCase() + t.slice(1);
}

/** Whether a stored title still starts with lead-in words. */
export const hasLeadIn = (title: string) => !!title && stripLeadIn(title) !== title;
