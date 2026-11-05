/*
 * The keyboard list, as the canvas's Keyboard board has it, from the foot of Find or ?. What only means something in a call
 * shows in a call. A key joins this list with what it does: opening a board with boards, and the next section, →, with
 * presenting.
 */
import { WsKeyboard, type WsKeyGroup } from '@alcove/ui';
import { shortcut } from '~/lib/keys';
import { useWs } from './context';

const WRITING: WsKeyGroup = {
  name: 'Writing',
  keys: [
    { label: 'All the blocks', key: '/' }, { label: 'Tag a person, document or date', key: '@' }, { label: 'Heading 1, 2, 3', key: '# ## ###' }, { label: 'Bulleted list', key: '-' },
    { label: 'Numbered list', key: '1.' }, { label: 'Checklist', key: '[]' }, { label: 'Quote', key: '>' }, { label: 'Divider', key: '---' }
  ]
};

export function Keys({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const inCall = useWs().mode === 'call';
  const groups: WsKeyGroup[] = [
    {
      name: inCall ? 'In the call' : 'In the workspace',
      keys: [
        ...(inCall ? [{ label: 'Open or close the workspace', key: 'W' }] : []),
        { label: 'Find anything', key: shortcut('K') },
        { label: 'Show or hide the list', key: shortcut('\\') },
        ...(inCall ? [{ label: 'Hide or show people', key: '⇧P' }, { label: 'Just the document', key: shortcut('⇧F') }, { label: 'Stop following', key: 'Esc' }] : []),
        { label: 'New document', key: 'N' },
        { label: 'New folder', key: '⇧N' }
      ]
    },
    WRITING,
    {
      name: 'Editing',
      keys: [
        { label: 'Bold', key: shortcut('B') }, { label: 'Italic', key: shortcut('I') }, { label: 'Comment', key: shortcut('⇧M') }, { label: 'Indent', key: 'Tab' },
        { label: 'Undo your own changes', key: shortcut('Z') }, { label: 'New line in the same block', key: '⇧↵' }
      ]
    }
  ];
  return <WsKeyboard open={open} onOpenChange={onOpenChange} groups={groups} note={inCall ? 'While your caret is in a document, the call’s single-letter keys sleep, so typing an M never mutes you.' : undefined} />;
}
