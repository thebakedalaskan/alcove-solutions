/*
 * @alcove/ui: the one entry. It exports every component file directly, area by area, as packages/ui/AGENTS.md maps them;
 * no folder has an index of its own. Its stylesheet is the separate `@alcove/ui/styles.css`.
 */
import './css-vars';

/* What every area builds on. */
export { cn } from './foundation/cn';
export * from './foundation/icon';
export * from './foundation/primitives';
export * from './foundation/overlay';
export * from './foundation/toast';
export * from './foundation/motion';
export * from './foundation/theme';
export * from './foundation/people';
export * from './foundation/brand';
export * from './foundation/illustrations';
export * from './foundation/empty';
export * from './foundation/emoji';
export * from './foundation/calendar';
export * from './foundation/qr';
export * from './foundation/settle';
export * from './foundation/tab-attention';
export * from './foundation/app';

/* The evening behind every page, and the frame around it. */
export * from './evening/horizon';
export * from './evening/cove';
export * from './shell/sidebar';
export * from './you/you';
export * from './palette/palette';

/* A call. */
export * from './call/call';
export * from './call/call-over';
export * from './call/call-timer';
export * from './call/call-chat';
export * from './call/call-questions';
export * from './call/reactions';
export * from './call/capture';
export * from './call/backgrounds';
export * from './call/floating-call';

/* Making, scheduling and listing calls. */
export * from './calls/calls';
export * from './calls/calls-week';
export * from './calls/scheduler';
export * from './calls/flow';
export * from './calls/ringing';

/* Notes, the Drive, the workspace and the board. */
export * from './notes/notes-panel';
export * from './notes/transcript';
export * from './notes/note-card';
export * from './notes/screens';
export * from './notes/follow-ups';
export * from './drive/files';
export * from './workspace/list';
export * from './workspace/document';
export * from './workspace/popover';
export * from './workspace/sheets';
export * from './workspace/present';
export * from './workspace/live';
export * from './workspace/toasts';
export * from './workspace/frame';
export * from './board/board';

/* The rest of the app's pages. */
export * from './team/pick';
export * from './plans/plans';
export * from './plans/checkout';
export * from './plans/plan-doors';
export * from './plans/team-plan';
export * from './settings/settings';
export * from './settings/drive-exports';
export * from './agents/agents';
export * from './record/recorder';
export * from './onboarding/guidance';
export * from './welcome/scene';
