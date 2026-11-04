/*
 * Ask your notes: a question typed here, or one of the suggestions, opens the palette and asks it there,
 * across every note you have (calls and recordings in the room), in confidential compute.
 */
import { firstName, type NoteSummary, type Person } from '@alcove/api';
import { Card, Icon } from '@alcove/ui';
import { useState } from 'react';
import { useOpenPalette } from '~/features/shell/context';
import { isEmail } from '~/lib/parse';
import { sameEmail } from '~/lib/people';

const MONTH = 30 * 86_400_000;

/**
 * Questions worth asking of these notes: what you owe the person you've met most this month (when Alcove
 * knows their name), a catch-up on your latest written note with a short title, and this week's update.
 */
export function questionsFrom(notes: readonly NoteSummary[], me: string | undefined, now: number): string[] {
  const met = new Map<string, { person: Person; calls: number }>();
  for (const n of notes) {
    if (now - new Date(n.startedAt).getTime() > MONTH) continue;
    for (const p of n.people) {
      if ((me && sameEmail(p, { email: me })) || !p.name || isEmail(p.name)) continue;
      const k = p.email.toLowerCase();
      met.set(k, { person: p, calls: (met.get(k)?.calls ?? 0) + 1 });
    }
  }
  const most = [...met.values()].sort((a, b) => b.calls - a.calls)[0];
  const latest = notes.find((n) => n.status === 'ready' && n.excerpt && n.title.trim().length <= 24);
  return [
    ...(most ? [`What do I owe ${firstName(most.person.name)}?`] : []),
    ...(latest ? [`Catch me up on ${latest.title.trim()}`] : []),
    'Draft this week’s update'
  ];
}

export function Ask({ questions }: { questions: string[] }) {
  const openPalette = useOpenPalette();
  const [text, setText] = useState('');
  const ask = (question: string) => {
    const q = question.trim();
    openPalette(q ? { mode: 'find', ask: q } : { mode: 'find' });
  };
  return (
    <Card title="Ask your notes" className="hm-ask">
      <form className="hm-ask-line" onSubmit={(e) => { e.preventDefault(); ask(text); setText(''); }}>
        <Icon name="ask" size={18} />
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="What did we decide this week?" aria-label="Ask your notes a question"
          autoComplete="off" enterKeyHint="send" />
      </form>
      <div className="hm-ask-chips">
        {questions.map((q) => <button key={q} type="button" aria-haspopup="dialog" onClick={() => ask(q)}>{q}</button>)}
      </div>
      <p className="hm-ask-note"><Icon name="sealed" size={14} />Answers come from your notes only, in confidential compute.</p>
    </Card>
  );
}
