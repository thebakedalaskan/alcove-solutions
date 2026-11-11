/*
 * Google Drive exports: the pieces Settings' Google Drive opens in place, and a call's own note uses. The files to export
 * (DriveExportFormats: three chips with a tick, one column on a phone), the Folder control (DriveFolderButton, Change at
 * its end, or Choose a folder), a folder to read (DriveFolderLocation), recent exports as lines under a small heading
 * (DriveExportHistory), and what happens to the copies in one line (DriveExportDisclosure), for a SettingFoot.
 */
import type { DriveExportFormat, DriveExportJob, DriveFolder } from '@alcove/api';
import {
  Button, DriveExportDisclosure, DriveExportFormats, DriveExportHistory, DriveFolderButton, DriveFolderLocation, ProviderMark,
  SettingFact, SettingFoot, SettingRow, SettingsPanel, Switch
} from '@alcove/ui';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { wentAt } from '~/lib/time';
import { iso } from '../../../src/world/clock';
import { Box, did } from '../../../src/component';

/** Settings' column, as the page lays it out. */
const column: Decorator = (Story) => <div className="set-groups" style={{ maxWidth: 940, margin: '0 auto' }}><Story /></div>;

const FOLDER: DriveFolder = { id: 'preview-folder', name: 'Call notes', driveId: 'preview-shared-drive' };
/** The demo clock's day: 4 November 2026. */
const jobs: DriveExportJob[] = [
  { id: 'preview-uploaded', noteId: 'design-review', format: 'notes-markdown', status: 'uploaded', reason: null, fileUrl: 'https://drive.google.com/file/d/alcove_preview/view', updatedAt: '2026-11-04T15:40:00Z', nextAt: null },
  { id: 'preview-transcript', noteId: 'design-review', format: 'transcript-text', status: 'uploaded', reason: null, fileUrl: null, updatedAt: '2026-11-04T15:40:00Z', nextAt: null },
  { id: 'preview-failed', noteId: 'pricing-sync', format: 'recording-zip', status: 'failed', reason: 'Too large for the folder’s space.', fileUrl: null, updatedAt: '2026-11-03T13:33:00Z', nextAt: null }
];
const states: DriveExportJob[] = [
  { id: 'preview-uploaded', noteId: 'design-review', format: 'notes-markdown', status: 'uploaded', reason: null, fileUrl: 'https://drive.google.com/file/d/alcove_preview/view', updatedAt: '2026-11-04T15:40:00Z', nextAt: null },
  { id: 'preview-uploading', noteId: 'design-review', format: 'transcript-text', status: 'uploading', reason: null, fileUrl: null, updatedAt: '2026-11-04T15:41:00Z', nextAt: null },
  { id: 'preview-pending', noteId: 'design-review', format: 'recording-zip', status: 'pending', reason: null, fileUrl: null, updatedAt: '2026-11-04T15:42:00Z', nextAt: null },
  // Went wrong in a way that may pass: why, quietly, and when it's tried next.
  { id: 'preview-retrying', noteId: 'pricing-sync', format: 'recording-zip', status: 'pending', reason: 'Google Drive could not confirm the upload. It will be checked before trying again.', fileUrl: null, updatedAt: iso(0, 16, 10), nextAt: iso(0, 16, 52) },
  { id: 'preview-failed', noteId: 'pricing-sync', format: 'notes-markdown', status: 'failed', reason: 'The folder can’t be written to. Choose another, then try again.', fileUrl: null, updatedAt: '2026-11-02T13:33:00Z', nextAt: null },
  { id: 'preview-reconnect', noteId: 'pricing-sync', format: 'transcript-text', status: 'reconnect', reason: 'Google access has ended. Reconnect Google Drive to go on.', fileUrl: null, updatedAt: '2026-11-02T13:34:00Z', nextAt: null }
];
const CALLS: Record<string, string> = { 'design-review': 'Design review', 'pricing-sync': 'Pricing sync' };
const source = (id: string) => <a href={`#${id}`} className="ac-clamp-1" onClick={(e) => e.preventDefault()}>{CALLS[id] ?? 'View call'}</a>;

/** Google Drive, opened in place in its panel: the folder, the files, exporting after each call, recent exports and the foot. */
function Manage({ folder: start }: { folder: DriveFolder | null }) {
  const [folder, setFolder] = useState(start);
  const [formats, setFormats] = useState<DriveExportFormat[]>(['notes-markdown', 'transcript-text']);
  const [auto, setAuto] = useState(start !== null);
  const ready = folder !== null && formats.length > 0;
  return (
    <SettingsPanel>
      <SettingRow label="Google Drive" mark={<ProviderMark provider="google" />}
        help={folder && auto ? 'After each call: notes and transcript to Call notes.' : 'Connected as art@vandelay.industries.'}
        control={<>{folder && auto && <SettingFact icon="check" tone="yes">Exporting</SettingFact>}<Button size="sm" iconRight="up" aria-expanded onClick={did('onDone')}>Done</Button></>} />
      <SettingRow sub wide label="Folder" help="For new exports. You can pick another on a call."
        control={<DriveFolderButton folder={folder} aria-label={folder ? `Folder: ${folder.name}. Change` : 'Choose a folder'} onClick={() => setFolder(FOLDER)} />} />
      <SettingRow sub wide label="Files" help="Each goes once the call’s notes are final." control={<DriveExportFormats selected={formats} onChange={setFormats} />} />
      <SettingRow sub label="Export after each call" help={ready ? 'For calls that end after you turn it on. Files upload in the background, even after you leave.' : 'Choose a folder first.'} off={!ready}
        onLabel={ready ? () => setAuto(!auto) : undefined} control={<Switch label="Export after each call" checked={ready && auto} disabled={!ready} onChange={setAuto} />} />
      {folder && <DriveExportHistory when={wentAt} jobs={jobs} source={source} onRetry={did('onRetry')} onReconnect={did('onReconnect')} />}
      <SettingFoot sub actions={<Button variant="quiet" onClick={did('onDisconnect')}>Disconnect Google Drive</Button>}><DriveExportDisclosure /></SettingFoot>
    </SettingsPanel>
  );
}

const meta = {
  title: 'Components/Settings/Drive exports', component: DriveExportFormats, decorators: [column],
  args: { selected: ['notes-markdown'], onChange: did('onChange') },
  argTypes: { selected: { control: false }, onChange: { control: false }, disabled: { control: 'boolean' }, unavailable: { control: false } },
  render: () => <Manage folder={FOLDER} />
} satisfies Meta<typeof DriveExportFormats>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Opened in place, set up: where, what, after each call, what went lately, and the way out. */
export const InThePanel: Story = { name: 'In the panel' };
export const InThePanelNight: Story = { ...InThePanel, name: 'In the panel, night', globals: { theme: 'dark' } };
export const InThePanelPhone: Story = { ...InThePanel, name: 'In the panel, phone', globals: { viewport: { value: 'phone' } } };
/** In a narrow panel (a narrow window, or the side panel open beside it): the folder and the files go under their labels, so the help keeps a readable measure. */
export const InANarrowPanel: Story = { name: 'In a narrow panel', render: () => <Box width={560} height="auto"><Manage folder={FOLDER} /></Box> };
/** Just connected: no folder yet, so nothing can go after each call. */
export const NoFolderYet: Story = { name: 'No folder yet', render: () => <Manage folder={null} /> };
/** The files on their own, as a Files row holds them. */
export const FileChoices: Story = {
  name: 'File choices',
  render: function Render(args) {
    const [selected, setSelected] = useState<DriveExportFormat[]>(['notes-markdown']);
    return <SettingsPanel><SettingRow wide label="Files" help="Each goes once the call’s notes are final." control={<DriveExportFormats {...args} selected={selected} onChange={setSelected} />} /></SettingsPanel>;
  }
};
export const FileChoicesNight: Story = { ...FileChoices, name: 'File choices, night', globals: { theme: 'dark' } };
export const FileChoicesPhone: Story = { ...FileChoices, name: 'File choices, phone', globals: { viewport: { value: 'phone' } } };
/** A file this call can't send says why, and can't be ticked: in a call's own narrow column. */
export const OriginalAudioOrganizerOnly: Story = {
  name: 'Original audio, organizer only',
  render: () => <Box width={320} height="auto"><div className="nd-drive-custom"><DriveExportFormats selected={['notes-markdown', 'recording-zip']} unavailable={{ 'recording-zip': 'Only the organizer can export original audio.' }} onChange={did('onChange')} /></div></Box>
};
/** Every state a recent export can be in: gone (its time opens it), uploading, waiting to upload, waiting to be tried again (why, and when), failed, and waiting on reconnecting. */
export const AllExportStates: Story = { name: 'All export states', render: () => <SettingsPanel><DriveExportHistory when={wentAt} jobs={states} source={source} onRetry={did('onRetry')} onReconnect={did('onReconnect')} /></SettingsPanel> };
export const AllExportStatesNight: Story = { ...AllExportStates, name: 'All export states, night', globals: { theme: 'dark' } };
/** Retrying one: the others wait. */
export const Retrying: Story = { render: () => <SettingsPanel><DriveExportHistory when={wentAt} jobs={jobs} source={source} retrying="preview-failed" onRetry={did('onRetry')} /></SettingsPanel> };
/** Nothing has gone yet. */
export const NoExportsYet: Story = { name: 'No exports yet', render: () => <SettingsPanel><DriveExportHistory when={wentAt} jobs={[]} onRetry={did('onRetry')} /></SettingsPanel> };
/** The Folder control, empty and chosen. */
export const FolderControl: Story = {
  name: 'Folder control',
  render: () => (
    <SettingsPanel>
      <SettingRow wide label="Folder" help="Nothing chosen yet." control={<DriveFolderButton folder={null} onClick={did('onChoose')} />} />
      <SettingRow wide label="Folder" help="For new exports. You can pick another on a call." control={<DriveFolderButton folder={FOLDER} aria-label="Folder: Call notes. Change" onClick={did('onChoose')} />} />
      <SettingRow wide label="Folder" help="In your own Drive." control={<DriveFolderButton folder={{ id: 'mine', name: 'Vandelay Industries / Product / Quarterly reviews and customer interviews', driveId: null }} onClick={did('onChoose')} />} />
    </SettingsPanel>
  )
};
export const FolderControlNight: Story = { ...FolderControl, name: 'Folder control, night', globals: { theme: 'dark' } };
/** A folder to read, as a list of folders shows it. */
export const SharedDriveLocation: Story = { name: 'Shared drive location', render: () => <Box width={360} height="auto"><DriveFolderLocation folder={{ id: 'preview-folder', name: 'Vandelay Industries / Product / Quarterly reviews and customer interviews', driveId: 'preview-shared-drive' }} /></Box> };
