/*
 * Where a video in the call's workspace is read from, for the one player everyone in the call hears (sharedVideo.ts): the
 * workspace's media, through the document the video is in, which a player reads by range. The URL is asked for with the
 * call's pass, which reaches what the seat was given and nothing more, and afresh each time the player needs one.
 */
import { api } from '~/lib/api';
import type { VideoSource } from './sharedVideo';

export const videoSourceFor = (pass: string): VideoSource => (video) => api.workspaces.media.url(video.workspaceId, video.documentId, video.mediaId, { pass });
