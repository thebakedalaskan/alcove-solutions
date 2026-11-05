/*
 * A whiteboard's Y.Doc and the logic the app and the API both need: its shape, reading and writing it, connector
 * routes, templates, its text, and landing rooms' boards. Pure TypeScript on plain Y.Docs, with no React and nothing
 * from the workspace, so it can run in a browser and on the server alike.
 */
export {
  BOARD_COMMENTS, BOARD_LIMITS, BOARD_OBJECTS, BOARD_REACH, BoardIdSchema, BoardObjectSchema, INK_COLOURS, LINE_SIDES, LINE_STYLES, LineEndSchema, SHAPE_KINDS, STICKY_COLOURS, TABLE_MAX,
  cellKey, hasBox, isAttached, layerOf, newId
} from './shape';
export type {
  BoardObject, BoardView, Box, FrameObject, ImageObject, InkColour, InkObject, LineEnd, LineObject, LineSide, LineStyle, LinkObject, NewObject, NodeObject, NoteObject, PlacedObject,
  ShapeKind, ShapeObject, ShotObject, StickyColour, TableLine, TableObject, TextObject
} from './shape';
export { objectText, observeBoard, readBoard } from './read';
export { bounds, centre, colourIn, contains, fit, frameAt, hit, inside } from './geometry';
export type { Camera, Pad } from './geometry';
export { freeRoute, route, shapePath, sides } from './routes';
export type { Route } from './routes';
export {
  addObject, addReply, addTableLine, addThread, applyThemes, duplicateObjects, makeUndo, moveObjects, redoStep, removeObjects, removeTableLine, resizeObject, setObjects, sizeTableLine, tableCell, tidyObjects, undoStep
} from './write';
export type { Move, ObjectPatch, StepResult, TableAxis } from './write';
export { TEMPLATES, fillTemplate } from './templates';
export type { TemplateName } from './templates';
export { boardFollowUps, boardText } from './text';
export { landBoards } from './land';
export { BoardPresenceSchema, NO_PRESENCE } from './presence';
export type { BoardPresence } from './presence';
