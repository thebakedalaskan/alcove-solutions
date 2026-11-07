import {
  ALargeSmall, AudioWaveform, BringToFront, ChevronLeft, Diamond, Frame, Group, LayoutTemplate, Map as MapIcon, MessageCircle, MoveUpRight, Redo2, SendToBack, Shapes, Spline, Vote, Workflow,
  ArrowLeft, ArrowLeftRight, ArrowRight, ArrowUp, ArrowUpRight, Calendar, Check, ChevronDown, ChevronRight, Circle, Clock, Copy, DoorOpen, Ellipsis, Hand,
  House, KeyRound, Languages, LayoutGrid, Link, Lock, LogOut, Mail, MessageCircleQuestion, MessageSquare, Mic, MicOff, MonitorUp,
  NotebookText, PanelsTopLeft, Pause, Pencil, PhoneOff, Pin, PinOff, Plane, Play, Plus, Radio, Repeat, Search, Send, Server, Share, ShieldCheck,
  Smartphone, Split, Square, Trash2, UserPlus, Users, Video, VideoOff, Volume2, Wifi, X, type LucideIcon, type LucideProps,
  AppWindow, AudioLines, Captions, ChevronUp, Eye, FileText, Focus, Globe, GripVertical, HistoryIcon, LayoutDashboard, LayoutPanelLeft, Maximize2,
  Minimize2, Monitor, MonitorOff, MoveDiagonal2, NotebookPen, RotateCcw, SendHorizontal, Shuffle, Timer, Hash, ChevronsUpDown, PanelLeft, WifiOff,
  Bookmark, BookmarkCheck,
  CircleDot, Settings, BadgeCheck, UserCheck, CircleCheck, Compass, EyeOff, Keyboard, PictureInPicture2, Presentation, RotateCw, Volume1,
  VolumeX, TriangleAlert, SlidersHorizontal, SkipForward, PictureInPicture, Scan, StepBack, StepForward, ZoomIn, ZoomOut, Bell, BellOff, CircleUserRound,
  Coins, Palette, MapPin, MousePointer2, MousePointer2Off, Undo2, Eraser, HardDrive, CloudOff, Upload, AtSign, Bold, BuildingComplex, CloudUpload, CodeXml,
  CornerDownRight, Download, FilePlus, Film, Folder, FolderInput, FolderOpen, FolderPlus, Folders, Heading1, Heading2, Heading3, Highlighter, Image,
  ImageOff, ImagePlus, Info, Italic, Lightbulb, Link2, List, ListChecks, ListCollapse, ListOrdered, ListTodo, LocateFixed, Megaphone, MessageSquareText, Minus,
  Moon, Navigation, PanelRight, Paperclip, Pilcrow, Quote, SquareCheckBig, Strikethrough, Sun, Table, TextAlignStart, TextQuote, Type, CalendarClock, StickyNote, Hourglass, PhoneCall,
  CircleOff, Droplets, BellRing, Bot, Coffee, Ear, Gauge, Headphones, SmilePlus, Layers
} from 'lucide-react';
import { cn } from '../cn';

/* One icon family: Lucide, 1.8 stroke, round caps and joins, sized by the caller. Filled glyphs say so. */
const ICONS = {
  shapes: Shapes, line: MoveUpRight, frame: Frame, square: Square, circle: Circle, diamond: Diamond, elbow: CornerDownRight,
  spline: Spline, textSize: ALargeSmall, group: Group, vote: Vote, redo: Redo2, map: MapIcon,
  workflow: Workflow, commentBubble: MessageCircle, layoutTemplate: LayoutTemplate, waveform: AudioWaveform,
  chevronLeft: ChevronLeft, bringToFront: BringToFront, sendToBack: SendToBack,
  moment: AudioLines, plus: Plus, home: House, notes: NotebookText, search: Search, video: Video, videoOff: VideoOff, mic: Mic, micOff: MicOff,
  screen: MonitorUp, chat: MessageSquare, react: SmilePlus, people: Users, leave: PhoneOff, pen: Pencil, dot: Circle, pause: Pause, stop: Square,
  check: Check, x: X, right: ArrowRight, left: ArrowLeft, down: ChevronDown, chevron: ChevronRight, link: Link, copy: Copy,
  cal: Calendar, clock: Clock, lock: Lock, key: KeyRound, trash: Trash2, more: Ellipsis, play: Play, speaker: Volume2,
  ask: MessageCircleQuestion, share: Share, send: Send, room: Radio, server: Server, hand: Hand, mail: Mail,
  addUser: UserPlus, signOut: LogOut, door: DoorOpen, rooms: Split, layout: PanelsTopLeft, grid: LayoutGrid, translate: Languages,
  sealed: ShieldCheck, external: ArrowUpRight, arrowUp: ArrowUp, swap: ArrowLeftRight, phone: Smartphone, plane: Plane, wifi: Wifi, pin: Pin, pinOff: PinOff,
  captions: Captions, up: ChevronUp, viewAuto: LayoutDashboard, viewSpeaker: LayoutPanelLeft, reset: RotateCcw, history: HistoryIcon,
  spotlight: Focus, grow: Maximize2, shrink: Minimize2, notesPen: NotebookPen, globe: Globe, window: AppWindow, monitor: Monitor,
  stopShare: MonitorOff, grip: GripVertical, shuffle: Shuffle, timer: Timer, noise: AudioLines, resize: MoveDiagonal2, transcript: FileText,
  sendLine: SendHorizontal, eye: Eye, hash: Hash, chevronsUpDown: ChevronsUpDown, panel: PanelLeft, wifiOff: WifiOff, recordDot: CircleDot,
  settings: Settings, badgeCheck: BadgeCheck, userCheck: UserCheck, circleCheck: CircleCheck, repeat: Repeat, compass: Compass, eyeOff: EyeOff,
  keyboard: Keyboard, pip: PictureInPicture2, presenter: Presentation, speakerLow: Volume1, speakerOff: VolumeX, retry: RotateCw, alert: TriangleAlert,
  bookmark: Bookmark, bookmarked: BookmarkCheck,
  sliders: SlidersHorizontal, live: SkipForward, popIn: PictureInPicture, zoomIn: ZoomIn, zoomOut: ZoomOut, whole: Scan, stepBack: StepBack,
  stepForward: StepForward, user: CircleUserRound, bell: Bell, bellOff: BellOff, palette: Palette, coins: Coins, mapPin: MapPin, pointer: MousePointer2,
  pointerOff: MousePointer2Off, undo: Undo2, eraser: Eraser, hardDrive: HardDrive, cloudOff: CloudOff, upload: Upload, at: AtSign, bold: Bold,
  building: BuildingComplex, bulb: Lightbulb, clip: Paperclip, cloudUpload: CloudUpload, code: CodeXml, comment: MessageSquareText, cornerRight: CornerDownRight, download: Download,
  filePlus: FilePlus, fileText: FileText, film: Film, folder: Folder, folderInput: FolderInput, folderOpen: FolderOpen, folderPlus: FolderPlus, folders: Folders,
  gripVertical: GripVertical, h1: Heading1, h2: Heading2, h3: Heading3, highlighter: Highlighter, image: Image, imageOff: ImageOff, imagePlus: ImagePlus, info: Info, italic: Italic,
  link2: Link2, list: List, listChecks: ListChecks, listOrdered: ListOrdered, locate: LocateFixed, megaphone: Megaphone, message: MessageSquareText, minus: Minus,
  moon: Moon, navigate: Navigation, panelRight: PanelRight, para: Pilcrow, presentation: Presentation, quote: Quote, strike: Strikethrough, sun: Sun, table: Table,
  textLines: TextAlignStart, textQuote: TextQuote, todo: SquareCheckBig, todos: ListTodo, toggle: ListCollapse, type: Type, calClock: CalendarClock, stickyNote: StickyNote, hourglass: Hourglass, phoneCall: PhoneCall,
  circleOff: CircleOff, droplets: Droplets,
  nudge: BellRing, agent: Bot, away: Coffee, hear: Ear, pace: Gauge, listening: Headphones, layers: Layers
} satisfies Record<string, LucideIcon>;

const FILLED = new Set<IconName>(['dot', 'stop', 'play']);

export type IconName = keyof typeof ICONS;
/** Every icon's name, in the map's order: for showing them all. */
export const ICON_NAMES: readonly IconName[] = Object.keys(ICONS).filter((k): k is IconName => k in ICONS);

export function Icon({ name, size = 18, className, ...rest }: { name: IconName; size?: number } & Omit<LucideProps, 'name' | 'size' | 'ref'>) {
  const Glyph = ICONS[name];
  return <Glyph size={size} strokeWidth={1.8} fill={FILLED.has(name) ? 'currentColor' : 'none'} aria-hidden="true" className={cn('ac-i', className)} {...rest} />;
}
