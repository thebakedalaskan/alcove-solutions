/*
 * A whiteboard's Y.Doc and the logic the app and the API both need: its shape, reading and writing it, connector
 * routes, templates, its text, and landing rooms' boards. Pure TypeScript on plain Y.Docs, with no React and nothing
 * from the workspace, so it can run in a browser and on the server alike.
 */
export {
  BOARD_COMMENTS, BOARD_LIMITS, BOARD_OBJECTS, BOARD_PLACES, BOARD_REACH, BoardAuthorSchema, BoardIdSchema, BoardObjectSchema, BoardReplySchema, INK_COLOURS, LINE_SIDES, LINE_STYLES, LineEndSchema, SHAPE_KINDS, STICKY_COLOURS, TABLE_MAX,
  cellKey, hasBox, isAttached, layerOf, newId
} from './shape';
export type {
  BoardAuthor, BoardObject, BoardReply, BoardThread, BoardView, Box, FrameObject, ImageObject, InkColour, InkObject, LineEnd, LineObject, LineSide, LineStyle, LinkObject, NewObject, NodeObject, NoteObject, PlacedObject,
  ShapeKind, ShapeObject, ShotObject, StickyColour, TableLine, TableObject, TextObject
} from './shape';
export { objectText, observeBoard, observeComments, readBoard, readThreads } from './read';
export { bounds, centre, colourIn, contains, fit, frameAt, hit, holds, inside } from './geometry';
export type { Camera, Pad } from './geometry';
export { freeRoute, route, shapePath, sides } from './routes';
export type { Route } from './routes';
export {
  addObject, addReply, addTableLine, addThread, afterMove, afterResize, applyThemes, duplicateObjects, moveObjects, removeObjects, removeTableLine, resizeObject, resolveThread, setObjects, sitsIn, sizeTableLine, stackObjects, tableCell, tidyObjects
} from './write';
export type { BoardTheme, Move, ObjectPatch, TableAxis } from './write';
export { BoardStep, makeHistory } from './history';
export type { BoardHistory, StepResult } from './history';
export { TEMPLATES, fillTemplate } from './templates';
export type { TemplateName } from './templates';
export { boardFollowUps, boardText, difference } from './text';
export type { TextChange } from './text';
export { landBoards } from './land';
export { BOARD_VIEW_WIDTH, BoardPresenceSchema, NO_PRESENCE } from './presence';
export type { BoardPresence } from './presence';
