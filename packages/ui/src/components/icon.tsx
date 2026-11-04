import {
  ArrowLeft, ArrowLeftRight, ArrowRight, ArrowUpRight, Calendar, Check, ChevronDown, ChevronRight, Circle, Clock, Copy, DoorOpen, Ellipsis, Hand,
  House, KeyRound, Languages, LayoutGrid, Link, Lock, LogOut, Mail, MessageCircleQuestion, MessageSquare, Mic, MicOff, MonitorUp, Moon,
  NotebookText, PanelsTopLeft, Pause, Pencil, PhoneOff, Pin, PinOff, Plane, Play, Plus, Radio, Repeat, Search, Send, Server, Share, ShieldCheck,
  Smartphone, Split, Square, Sun, Trash2, UserPlus, Users, Video, VideoOff, Volume2, Wifi, X, type LucideIcon, type LucideProps,
  AppWindow, AudioLines, Captions, ChevronUp, Eye, FileText, Focus, Globe, GripVertical, HistoryIcon, LayoutDashboard, LayoutPanelLeft, Maximize2,
  Minimize2, Monitor, MonitorOff, MoveDiagonal2, NotebookPen, RotateCcw, SendHorizontal, Shuffle, Timer, Hash, ChevronsUpDown, PanelLeft, WifiOff,
  CircleDot, Settings, Compass, EyeOff, Keyboard, PictureInPicture2, Presentation, RotateCw, Volume1, VolumeX, TriangleAlert, SlidersHorizontal, SkipForward,
  PictureInPicture, Scan, StepBack, StepForward, ZoomIn, ZoomOut, MousePointer2, MousePointer2Off, Undo2, Eraser
} from 'lucide-react';
import { cn } from '../cn';

/* One icon family: Lucide, 1.8 stroke, round caps and joins, sized by the caller. Filled glyphs say so. */
const ICONS = {
  plus: Plus, home: House, notes: NotebookText, search: Search, video: Video, videoOff: VideoOff, mic: Mic, micOff: MicOff,
  screen: MonitorUp, chat: MessageSquare, people: Users, leave: PhoneOff, pen: Pencil, dot: Circle, pause: Pause, stop: Square,
  check: Check, x: X, right: ArrowRight, left: ArrowLeft, down: ChevronDown, chevron: ChevronRight, link: Link, copy: Copy,
  cal: Calendar, clock: Clock, lock: Lock, key: KeyRound, trash: Trash2, more: Ellipsis, play: Play, speaker: Volume2, sun: Sun,
  moon: Moon, ask: MessageCircleQuestion, share: Share, send: Send, room: Radio, server: Server, hand: Hand, mail: Mail,
  addUser: UserPlus, signOut: LogOut, door: DoorOpen, rooms: Split, layout: PanelsTopLeft, grid: LayoutGrid, translate: Languages,
  sealed: ShieldCheck, external: ArrowUpRight, swap: ArrowLeftRight, phone: Smartphone, plane: Plane, wifi: Wifi, pin: Pin, pinOff: PinOff,
  captions: Captions, up: ChevronUp, viewAuto: LayoutDashboard, viewSpeaker: LayoutPanelLeft, reset: RotateCcw, history: HistoryIcon,
  spotlight: Focus, grow: Maximize2, shrink: Minimize2, notesPen: NotebookPen, tab: Globe, window: AppWindow, monitor: Monitor,
  stopShare: MonitorOff, grip: GripVertical, shuffle: Shuffle, timer: Timer, noise: AudioLines, resize: MoveDiagonal2, transcript: FileText,
  sendLine: SendHorizontal, eye: Eye, hash: Hash, chevronsUpDown: ChevronsUpDown, panel: PanelLeft, wifiOff: WifiOff, recordDot: CircleDot,
  settings: Settings, repeat: Repeat, compass: Compass, eyeOff: EyeOff, keyboard: Keyboard,
  pip: PictureInPicture2, presenter: Presentation, speakerLow: Volume1, speakerOff: VolumeX, retry: RotateCw, alert: TriangleAlert,
  sliders: SlidersHorizontal, live: SkipForward, popIn: PictureInPicture, zoomIn: ZoomIn, zoomOut: ZoomOut, whole: Scan, stepBack: StepBack,
  stepForward: StepForward, pointer: MousePointer2, pointerOff: MousePointer2Off, undo: Undo2, eraser: Eraser
} satisfies Record<string, LucideIcon>;

const FILLED = new Set<IconName>(['dot', 'stop', 'play']);

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 18, className, ...rest }: { name: IconName; size?: number } & Omit<LucideProps, 'name' | 'size' | 'ref'>) {
  const Glyph = ICONS[name];
  return <Glyph size={size} strokeWidth={1.8} fill={FILLED.has(name) ? 'currentColor' : 'none'} aria-hidden="true" className={cn('ac-i', className)} {...rest} />;
}
