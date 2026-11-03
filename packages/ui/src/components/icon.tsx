import {
  ArrowLeft, ArrowLeftRight, ArrowRight, Calendar, Check, ChevronDown, ChevronRight, Circle, Clock, Copy, DoorOpen, Ellipsis, Hand,
  House, KeyRound, Languages, LayoutGrid, Link, Lock, LogOut, Mail, MessageCircleQuestion, MessageSquare, Mic, MicOff, MonitorUp, Moon,
  NotebookText, PanelsTopLeft, Pause, Pencil, PhoneOff, Pin, PinOff, Plane, Play, Plus, Radio, Search, Send, Server, Share, ShieldCheck,
  Smartphone, Split, Square, Sun, Trash2, UserPlus, Users, Video, VideoOff, Volume2, Wifi, X, type LucideIcon, type LucideProps
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
  sealed: ShieldCheck, swap: ArrowLeftRight, phone: Smartphone, plane: Plane, wifi: Wifi, pin: Pin, pinOff: PinOff
} satisfies Record<string, LucideIcon>;

const FILLED = new Set<IconName>(['dot', 'stop', 'play']);

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 18, className, ...rest }: { name: IconName; size?: number } & Omit<LucideProps, 'name' | 'size' | 'ref'>) {
  const Glyph = ICONS[name];
  return <Glyph size={size} strokeWidth={1.8} fill={FILLED.has(name) ? 'currentColor' : 'none'} aria-hidden="true" className={cn('ac-i', className)} {...rest} />;
}
