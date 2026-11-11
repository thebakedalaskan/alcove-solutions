import { IDSchema, ISODateSchema } from '../shared/ids';
import { z } from '../shared/zod';
import { type WorkspaceReadOptions } from './schema';
/** A file travels and is kept in pieces of this size: every piece but the last is exactly this long. */
export const MEDIA_PIECE_BYTES = 4 * 1024 * 1024;

/**
 * The most a file can ever be. The limit in force is lower, 512 MiB unless it's been changed, and can change at any time
 * without a release, so a file over it is refused when its upload starts, with `invalid` and words that say how big a file
 * can be.
 */
export const MAX_MEDIA_BYTES = 4 * 1024 * 1024 * 1024;

/** What anything off the list below is served as, and only ever as a download. */
export const FILE_TYPE = 'application/octet-stream';

/** What can be shown in place: pictures, video and audio a browser plays. Nothing here can run. */
const SHOWN = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'video/mp4', 'video/webm', 'audio/mpeg', 'audio/mp4', 'audio/webm', 'audio/ogg']);

/** Other names browsers use for the same formats. */
const SAME_AS = new Map([['image/jpg', 'image/jpeg'], ['audio/mp3', 'audio/mpeg'], ['audio/m4a', 'audio/mp4'], ['audio/x-m4a', 'audio/mp4']]);

/** The type a file is kept and served under, whatever a browser called it. */
export function servedType(declared: string): string {
  const bare = (declared.split(';')[0] ?? '').trim().toLowerCase();
  const type = SAME_AS.get(bare) ?? bare;
  return SHOWN.has(type) ? type : FILE_TYPE;
}


/** How long a file's name can be. */
const MAX_NAME = 255;

const Pixels = z.number().int().min(1).max(100_000);

/** What's said about a file before any of it is sent. `width` and `height` are for what has them, when the browser knows. */
export const MediaInputSchema = z.object({
  name: z.string().transform((s) => s.replace(/\s+/g, ' ').trim()).pipe(z.string().min(1).max(MAX_NAME)),
  type: z.string().max(255).transform(servedType),
  /** At most the limit in force, which the API checks, so it can say how big a file can be: never more than MAX_MEDIA_BYTES. */
  size: z.number().int().min(1),
  width: Pixels.nullable().default(null),
  height: Pixels.nullable().default(null)
});

export type MediaInput = z.input<typeof MediaInputSchema>;


/** A file in a workspace, as one reader has it. */
export const WorkspaceMediaSchema = z.object({
  id: IDSchema,
  name: z.string(),
  /** What it's served as: something shown in place, or `FILE_TYPE`, which only downloads. */
  type: z.string(),
  /** In bytes. */
  size: z.number(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  createdAt: ISODateSchema,
  /** The documents and boards you can reach it through: never one you can't open. */
  documents: z.array(IDSchema)
});

export type WorkspaceMedia = z.infer<typeof WorkspaceMediaSchema>;


/**
 * A picture's preview: a small JPEG of it, at most this many pixels on its longer side and this many bytes, made by the
 * browser that uploads it and sealed beside it, so a picker shows thumbnails without reading whole photos. Pictures
 * uploaded before previews have none.
 */
export const MEDIA_PREVIEW_PIXELS = 320;

export const MAX_MEDIA_PREVIEW_BYTES = 128 * 1024;


/** A file's token: `/media/<token>` is where it's read. */
export const MediaTokenAnswerSchema = z.object({ token: z.string() });


export interface MediaPictureOptions extends WorkspaceReadOptions {
  /** Stops reading it, for a block that went before its picture came. */
  signal?: AbortSignal | undefined;
}

export interface MediaUrlOptions extends WorkspaceReadOptions {
  /** It comes as a download, under its own name, whatever it is: a picture or a film saves rather than opening. */
  download?: boolean | undefined;
}


export interface MediaUploadOptions extends WorkspaceReadOptions {
  /** After each piece: how many bytes of the file are stored. */
  onProgress?: ((p: { sent: number; total: number }) => void) | undefined;
  /** In pixels, for what has a size, so everyone can hold its space before it loads. */
  width?: number | undefined;
  height?: number | undefined;
  /** Gives up on the upload, taking back whatever of it was stored. */
  signal?: AbortSignal | undefined;
  /** A picture's preview (`MEDIA_PREVIEW_PIXELS`, a JPEG), kept beside it once it's finished. One that can't be kept doesn't fail the upload. */
  preview?: Blob | undefined;
}
