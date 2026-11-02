import { errorMessage } from '@alcove/api';
import { Button, Menu, useToast, type ButtonProps } from '@alcove/ui';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect } from 'react';
import { api } from '~/lib/api';
import { useDialogs } from './dialogs';

export function useStartInstant() {
  const navigate = useNavigate();
  const toast = useToast();
  return useCallback(async () => {
    try { const { code } = await api.calls.createInstant(); await navigate({ to: '/join/$code', params: { code }, search: { instant: true } }); }
    catch (e) { toast(errorMessage(e), 'x'); }
  }, [navigate, toast]);
}

export function NewCallMenu({ align = 'start', ...button }: { align?: 'start' | 'end' } & ButtonProps) {
  const dialogs = useDialogs();
  const start = useStartInstant();
  return (
    <Menu align={align} trigger={<Button icon="plus" {...button}>New call</Button>} items={[
      { icon: 'cam', label: 'Start a call now', description: 'Opens full screen with a link to share', shortcut: 'N', onSelect: () => void start() },
      { icon: 'link', label: 'Get a link to share', description: 'For now or for later', onSelect: () => dialogs.open({ kind: 'link' }) },
      { icon: 'cal', label: 'Schedule for later', description: 'Invites go out from your calendar', onSelect: () => dialogs.open({ kind: 'schedule' }) }
    ]} />
  );
}

/** Press N anywhere in the app (outside a text field) to start a call. */
export function useNewCallShortcut() {
  const start = useStartInstant();
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const inField = e.target instanceof Element && !!e.target.closest('input,textarea,[contenteditable],[role=dialog]');
      if (e.key.toLowerCase() !== 'n' || e.metaKey || e.ctrlKey || e.altKey || inField) return;
      e.preventDefault(); void start();
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, [start]);
}
