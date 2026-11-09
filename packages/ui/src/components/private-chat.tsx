import { type DirectMessage, type Person, DIRECT_MESSAGE_MAX } from '@alcove/api';
import { Avatar } from './people';
import { Button, IconButton } from './primitives';
import { Icon } from './icon';
import { cn } from '../cn';

/** Recipient-only chat uses the same conversation parts in a call, its states and its journeys. */
export function PrivateMessage({ message, person, mine, time, onRetry }: {
  message: DirectMessage; person: Person; mine: boolean; time: string; onRetry: () => void;
}) {
  return <article className={cn('ac-private-message', mine && 'is-mine', message.state === 'failed' && 'has-failed')}>
    <Avatar person={person} size={28} />
    <div className="ac-private-message-body">
      <div className="ac-private-message-meta"><b>{mine ? 'You' : person.name}</b><time>{message.state === 'sending' ? 'Sending…' : time}</time></div>
      <p>{message.text}</p>
      {mine && <div className="ac-private-message-state" role={message.state === 'failed' ? 'status' : undefined}>
        <Icon name={message.state === 'failed' ? 'alert' : message.state === 'sending' ? 'clock' : 'check'} size={12} />
        <span>{message.state === 'failed' ? 'Not confirmed' : message.state === 'delivered' ? 'Delivered' : message.state === 'sent' ? 'Sent' : 'Sending'}</span>
        {message.state === 'failed' && <Button variant="quiet" size="xs" onClick={onRetry}>Retry privately</Button>}
      </div>}
      {message.error && <small className="ac-private-message-error">{message.error}</small>}
    </div>
  </article>;
}

export function PrivateChatComposer({ name, value, available, onChange, onSend }: {
  name: string; value: string; available: boolean; onChange: (text: string) => void; onSend: () => void;
}) {
  return <form className="ac-private-composer" autoComplete="off" onSubmit={(e) => { e.preventDefault(); if (available && value.trim()) onSend(); }}>
    <div className="ac-private-audience"><Icon name="lock" size={14} /><span>Only you and {name}</span></div>
    {!available && <p className="ac-private-unavailable" role="status">Unavailable in this room. Your draft stays here.</p>}
    <div className="ac-private-composer-row"><input className="ac-input" value={value} maxLength={DIRECT_MESSAGE_MAX} disabled={!available}
      aria-label={`Message only ${name}`} placeholder={available ? `Message ${name} privately…` : 'This conversation is unavailable'} onChange={(e) => onChange(e.currentTarget.value)} />
      <IconButton icon="sendLine" label={`Send only to ${name}`} disabled={!available || !value.trim()} onClick={onSend} /></div>
  </form>;
}
