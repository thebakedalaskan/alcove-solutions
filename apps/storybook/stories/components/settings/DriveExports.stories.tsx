import type { DriveExportFormat, DriveExportJob } from '@alcove/api';
import { DriveExportDisclosure, DriveExportFormats, DriveExportHistory, DriveFolderLocation } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';
import { Box } from '../../../src/component';

function Formats() {
  const [selected, setSelected] = useState<DriveExportFormat[]>(['notes-markdown']);
  return <Box width={780} height="auto"><DriveExportFormats selected={selected} onChange={setSelected} /></Box>;
}
const jobs: DriveExportJob[] = [
  { id: 'preview-uploaded', noteId: 'preview-call', format: 'notes-markdown', status: 'uploaded', reason: null, fileUrl: 'https://drive.google.com/file/d/alcove_preview/view', updatedAt: '2026-11-08T13:30:00Z' },
  { id: 'preview-uploading', noteId: 'preview-call', format: 'transcript-text', status: 'uploading', reason: null, fileUrl: null, updatedAt: '2026-11-08T13:31:00Z' },
  { id: 'preview-pending', noteId: 'preview-call', format: 'recording-zip', status: 'pending', reason: null, fileUrl: null, updatedAt: '2026-11-08T13:32:00Z' },
  { id: 'preview-failed', noteId: 'preview-call', format: 'notes-markdown', status: 'failed', reason: 'The destination is unavailable. Choose a folder you can write to, then retry.', fileUrl: null, updatedAt: '2026-11-08T13:33:00Z' },
  { id: 'preview-reconnect', noteId: 'preview-call', format: 'transcript-text', status: 'reconnect', reason: 'Google access has ended. Reconnect Google Drive to continue.', fileUrl: null, updatedAt: '2026-11-08T13:34:00Z' }
];
const retry = fn();
const reconnect = fn();
const meta = { title: 'Components/Settings/Drive exports', component: DriveExportFormats, render: () => <Formats />,
  args: { selected: [], onChange: fn() } } satisfies Meta<typeof DriveExportFormats>;
export default meta;
type Story = StoryObj<typeof meta>;

export const FileChoices: Story = {};
export const FileChoicesNight: Story = { globals: { theme: 'dark' } };
export const FileChoicesPhone: Story = { globals: { viewport: { value: 'phone', isRotated: false } } };
export const AllExportStates: Story = { render: () => <Box width={640} height="auto"><DriveExportHistory jobs={jobs} onRetry={retry} onReconnect={reconnect} /></Box> };
export const NoExportsYet: Story = { render: () => <Box width={640} height="auto"><DriveExportHistory jobs={[]} onRetry={retry} /></Box> };
export const CopyDisclosure: Story = { render: () => <Box width={640} height="auto"><DriveExportDisclosure /></Box> };
export const SharedDriveDestination: Story = { render: () => <Box width={360} height="auto"><DriveFolderLocation folder={{ id: 'preview-folder', name: 'Vandelay Industries / Product / Quarterly reviews and customer interviews', driveId: 'preview-shared-drive' }} /></Box> };

export const OriginalAudioOrganizerOnly: Story = { render: () => <Box width={780} height="auto"><DriveExportFormats selected={['notes-markdown', 'recording-zip']} unavailable={{ 'recording-zip': 'Only the organizer can export original audio.' }} onChange={fn()} /></Box> };
export const OriginalAudioNotRetained: Story = { render: () => <Box width={780} height="auto"><DriveExportFormats selected={['notes-markdown']} unavailable={{ 'recording-zip': 'This call did not retain its original audio.' }} onChange={fn()} /></Box> };
