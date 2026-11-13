import { CAPTION_LANGUAGES, notesAreOn, type CaptionLanguage, type CaptureMode } from '@alcove/api';
import { Avatar, Caption, Icon, Popover } from '@alcove/ui';
import type { ReactNode } from 'react';
import { callName } from '~/lib/people';
import type { CallCaptions, LiveCaption } from './captions';

export const captionLanguageName = (l: CaptionLanguage | null) => (l ? CAPTION_LANGUAGES.find((x) => x.code === l)?.name ?? l : 'As spoken');

export function CaptionLanguageMenu({ language: lang, modelPrivate, onPick }: { language: CaptionLanguage | null; modelPrivate: boolean; onPick: (language: CaptionLanguage | null) => void }) {
  return (
    <>
      <div className="ac-eyebrow">Captions in</div>
      {[null, ...CAPTION_LANGUAGES.map((l) => l.code)].map((code) => {
        const info = CAPTION_LANGUAGES.find((x) => x.code === code);
        return (
          <button key={code ?? 'spoken'} type="button" className="ic-opt" role="menuitemradio" aria-checked={lang === code}
            onClick={() => onPick(code)}>
            <span className="nm">{info ? info.name : 'As spoken'}{info && info.name !== info.english && <span className="sub"> · {info.english}</span>}</span><Icon name="check" size={16} className="tick" />
          </button>
        );
      })}
      <p className="hint">{modelPrivate ? 'Translated in confidential compute.' : 'Translated by an AI model outside a secure enclave.'} Everyone picks their own language. The call is still transcribed for notes when captions are off.</p>
    </>
  );
}

export function CallCaption({ caption, language: lang, hearing, mode, languageButton: capButton }: {
  caption: LiveCaption | null;
  language: CaptionLanguage | null;
  hearing: boolean;
  mode: CaptureMode;
  languageButton: ReactNode;
}) {
  return caption && hearing ? (
    <Caption who={<>{caption.line.speaker?.person && <Avatar person={caption.line.speaker.person} size={18} />}<span className="name">{caption.line.speaker ? callName(caption.line.speaker.person ?? { name: caption.line.speaker.name, email: '' }) : ''}</span>{caption.translated && lang && <span className="lang">→ {lang.toUpperCase()}</span>}{capButton}</>}
      original={caption.translated ? caption.line.text : undefined}>{caption.text}</Caption>
  ) : (
    <Caption who={<><Icon name="captions" size={15} /><span className="name">Captions</span>{capButton}</>}>
      <span className="ic-cap-wait">{hearing ? 'What’s said appears here as people talk.' : notesAreOn(mode) ? 'Nothing is transcribed for captions right now: the host’s browser can’t listen.' : mode === 'paused' ? 'Notes are paused, so nothing is transcribed for captions.' : 'Notes are off, so nothing is being transcribed for captions.'}</span>
    </Caption>
  );
}

/**
 * The captions over the stage, while they're on: the newest line of the part of the call you're in, in your language if you chose
 * one, with the language menu at its end (`open`: it's what's open over the call). While notes are paused or off nothing new is said
 * in them, so the last line isn't left up as if it were live (`hearing`, `mode`).
 */
export function CaptionsLine({ captions, hearing, mode, modelPrivate, open, onOpenChange }: {
  captions: CallCaptions;
  hearing: boolean;
  mode: CaptureMode;
  modelPrivate: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const langMenu = <CaptionLanguageMenu language={captions.language} modelPrivate={modelPrivate} onPick={(code) => { captions.pick(code); onOpenChange(false); }} />;
  const capButton = (
    <Popover open={open} onOpenChange={onOpenChange} side="top" align="end" label="Caption language" className="ic-dmenu"
      anchor={<button type="button" className="ic-capbtn" aria-label="Choose the caption language"><Icon name="translate" size={14} />{captionLanguageName(captions.language)}</button>}>{langMenu}</Popover>
  );
  return <CallCaption caption={captions.caption} language={captions.language} hearing={hearing} mode={mode} languageButton={capButton} />;
}
