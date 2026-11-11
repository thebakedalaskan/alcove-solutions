import { crc32 } from 'node:zlib';
import type { DriveExportFormat, Note } from '@alcove/api';
import type { Owner } from '../../context';
import { b64u, sha, utf8 } from '../../crypto';
import { file, type AudioFile } from '../recordings/audio';
import { audioSource, get, locate } from './service';

export interface Artifact {
  name: string;
  mimeType: string;
  hash: string;
  size: number;
  bytes(): AsyncGenerator<Uint8Array>;
}
const hash = (text: string) => b64u(sha(utf8(text)));
function textArtifact(name: string, mimeType: string, text: string): Artifact {
  return { name, mimeType, hash: hash(text), size: utf8(text).length, async *bytes() { yield utf8(text); } };
}
const stamp = (at: number) => `${Math.floor(at / 60)}:${String(Math.floor(at % 60)).padStart(2, '0')}`;
/** The full summary's paragraphs, a blank line apart, as the note page shows them under the summary. */
const paragraphs = (details: string) => details.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).join('\n\n');
function markdown(note: Note): string {
  const section = (title: string, body: string) => body ? `\n## ${title}\n\n${body}\n` : '';
  const content = (n: Pick<Note, 'summary' | 'decisions' | 'questions' | 'actions'>, details = '') =>
    `${n.summary}\n${section('Full summary', paragraphs(details))}${section('Decisions', n.decisions.map((d) => `- ${d.text}`).join('\n'))}${section('Follow-ups', n.actions.map((a) => `- [${a.done ? 'x' : ' '}] ${a.text}`).join('\n'))}${section('Open questions', n.questions.map((q) => `- ${q.text}`).join('\n'))}`;
  return `# ${note.title}\n\n${content(note, note.details)}${note.rooms.map((r) => `\n## ${r.name}\n\n${content(r)}`).join('')}`;
}
/** The public reader defines the boundary. Personal notes and presenter notes are never inspected. */
export async function artifact(o: Owner, noteId: string, format: DriveExportFormat): Promise<Artifact | null> {
  const note = await get(o, noteId);
  if (note.kind !== 'call' || note.status !== 'ready') return null;
  const safeName = note.title.replace(/[\u0000-\u001f/\\]/g, ' ').trim().slice(0, 150) || 'Call';
  if (format === 'notes-markdown') {
    if (note.status !== 'ready' || !note.writtenAt || note.writingAgain) return null;
    return textArtifact(`${safeName} — notes.md`, 'text/markdown', markdown(note));
  }
  if (format === 'transcript-text') {
    if (!note.kept.transcript || note.transcript === null) return null;
    const lines = (values: NonNullable<Note['transcript']>) => values.map((line) => `[${stamp(line.at)}] ${line.speaker ? `${line.speaker.name}: ` : ''}${line.text}`).join('\n');
    const transcript = `${note.title}\n\n${lines(note.transcript)}${note.rooms.map((r) => `\n\n${r.name}\n\n${lines(r.transcript)}`).join('')}`;
    return textArtifact(`${safeName} — transcript.txt`, 'text/plain', transcript);
  }
  if (!note.kept.recording || !note.audio.length) return null;
  // Only the organizer may export all original audio. A shared note must never widen access to raw participant material.
  const location = await locate(o, noteId);
  try { if (!location.mine) return null; }
  finally { if (!location.mine) { location.owner.root.fill(0); location.owner.wrapKey.fill(0); } }
  const source = await audioSource(o, noteId);
  const files: { name: string; file: AudioFile }[] = [];
  for (const segment of note.audio) {
    const extension = segment.mimeType.includes('mp4') ? 'm4a' : segment.mimeType.includes('ogg') ? 'ogg' : segment.mimeType.includes('wav') ? 'wav' : 'webm';
    files.push({ name: `part-${String(segment.index + 1).padStart(3, '0')}.${extension}`, file: await file(source.owner, source.recordingId, segment.index, segment.pieces) });
  }
  const size = 98 + files.reduce((total, entry) => total + 148 + utf8(entry.name).length * 2 + entry.file.bytes, 0);
  return { name: `${safeName} — recording.zip`, mimeType: 'application/zip', hash: hash(JSON.stringify(note.audio)), size, async *bytes() { yield* zip(files); } };

}
function little(size: number, values: { offset: number; value: number; short?: boolean }[]): Uint8Array {
  const result = new Uint8Array(size);
  const view = new DataView(result.buffer);
  for (const value of values) if (value.short) view.setUint16(value.offset, value.value, true); else view.setUint32(value.offset, value.value, true);
  return result;
}
function wide(values: number[]): Uint8Array {
  const result = new Uint8Array(values.length * 8);
  const view = new DataView(result.buffer);
  for (const [index, value] of values.entries()) view.setBigUint64(index * 8, BigInt(value), true);
  return result;
}
/** ZIP64 stored entries, streamed with data descriptors: large retained calls never fill server memory. */
async function* zip(files: { name: string; file: { bytes: number; read(from: number, to: number): AsyncGenerator<Uint8Array> } }[]): AsyncGenerator<Uint8Array> {
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of files) {
    const name = utf8(entry.name);
    const start = offset;
    const sizes = wide([entry.file.bytes, entry.file.bytes]);
    const extra = little(4, [{ offset: 0, value: 1, short: true }, { offset: 2, value: sizes.length, short: true }]);
    const head = little(30, [{ offset: 0, value: 0x04034b50 }, { offset: 4, value: 45, short: true }, { offset: 6, value: 8, short: true }, { offset: 18, value: 0xffffffff }, { offset: 22, value: 0xffffffff }, { offset: 26, value: name.length, short: true }, { offset: 28, value: extra.length + sizes.length, short: true }]);
    yield head; yield name; yield extra; yield sizes;
    offset += head.length + name.length + extra.length + sizes.length;
    let checksum = 0;
    for await (const chunk of entry.file.read(0, entry.file.bytes - 1)) { checksum = crc32(chunk, checksum); offset += chunk.length; yield chunk; }
    const descriptor = little(8, [{ offset: 0, value: 0x08074b50 }, { offset: 4, value: checksum }]);
    yield descriptor; yield sizes;
    offset += descriptor.length + sizes.length;
    const details = wide([entry.file.bytes, entry.file.bytes, start]);
    central.push(little(46, [{ offset: 0, value: 0x02014b50 }, { offset: 4, value: 45, short: true }, { offset: 6, value: 45, short: true }, { offset: 8, value: 8, short: true }, { offset: 16, value: checksum }, { offset: 20, value: 0xffffffff }, { offset: 24, value: 0xffffffff }, { offset: 28, value: name.length, short: true }, { offset: 30, value: details.length + 4, short: true }, { offset: 42, value: 0xffffffff }]), name, little(4, [{ offset: 0, value: 1, short: true }, { offset: 2, value: details.length, short: true }]), details);
  }
  const centralStart = offset;
  for (const part of central) { yield part; offset += part.length; }
  const zip64Start = offset;
  const end = little(56, [{ offset: 0, value: 0x06064b50 }, { offset: 12, value: 45, short: true }, { offset: 14, value: 45, short: true }]);
  const endView = new DataView(end.buffer);
  endView.setBigUint64(4, 44n, true);
  endView.setBigUint64(24, BigInt(files.length), true);
  endView.setBigUint64(32, BigInt(files.length), true);
  endView.setBigUint64(40, BigInt(offset - centralStart), true);
  endView.setBigUint64(48, BigInt(centralStart), true);
  yield end;
  const locator = little(20, [{ offset: 0, value: 0x07064b50 }, { offset: 16, value: 1 }]);
  new DataView(locator.buffer).setBigUint64(8, BigInt(zip64Start), true);
  yield locator;
  yield little(22, [{ offset: 0, value: 0x06054b50 }, { offset: 8, value: 0xffff, short: true }, { offset: 10, value: 0xffff, short: true }, { offset: 12, value: 0xffffffff }, { offset: 16, value: 0xffffffff }]);
}
