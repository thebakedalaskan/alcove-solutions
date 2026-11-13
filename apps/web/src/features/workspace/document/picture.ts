/*
 * A document's picture, as a file card (the kit's `FileCard`) draws it, from what its preview says (`workspaceQueries.previews`):
 * the Drive's cards, what a call made on its page, and what a call ahead brings.
 */
import type { DocumentKind, DocumentPreview, PreviewLine } from '@alcove/api';
import type { IconName, ThumbKind, ThumbLine, ThumbProps } from '@alcove/ui';

const MARK: Partial<Record<PreviewLine['kind'], ThumbLine['mark']>> = { bullet: 'dot', todo: 'todo', done: 'done' };
/**
 * How a file's card draws it, from what its preview says: a board; a document of photos, a PDF, another file or a video when
 * that's all it holds; otherwise its page, with a heading it starts with as the page's title. Before the preview comes, an
 * empty page.
 */
export function pictureOf(file: { kind: DocumentKind }, preview: DocumentPreview | undefined): { kind: ThumbKind; icon?: IconName | undefined; thumb?: Omit<ThumbProps, 'kind' | 'size'> | undefined } {
  if (file.kind === 'board') return { kind: 'board' };
  if (preview && preview.lines.length === 0) {
    if (preview.pictures > 0) return { kind: 'photos', thumb: { count: preview.pictures } };
    if (preview.file === 'PDF') return { kind: 'pdf' };
    if (preview.file) return { kind: 'doc', icon: 'clip' };
    if (preview.videos > 0) return { kind: 'share', icon: 'film' };
  }
  const lines = preview?.lines ?? [];
  const [first, ...rest] = lines;
  const title = first?.kind === 'heading' ? first.text : undefined;
  return { kind: 'doc', thumb: { title, lines: (title === undefined ? lines : rest).map((l): ThumbLine => ({ text: l.text, mark: MARK[l.kind] })) } };
}
