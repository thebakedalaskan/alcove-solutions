/*
 * What's open over the call, one thing at a time: a device's menu, the captions' language, More and what it leads to (on a
 * phone, the board picker), the reaction picker and Share's steps. Settings, from More, is a window of its own.
 */
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { ShareStep } from './ShareMenu';

export type Pop = 'mic' | 'cam' | 'cap' | 'more' | 'board' | 'react' | 'reactMore' | ShareStep | null;

/** What's open over the call. The reaction picker is the dock's on a wide screen and More's on a phone: it closes when the screen flips between them. */
export function usePop(phone: boolean): [Pop, Dispatch<SetStateAction<Pop>>] {
  const [pop, setPop] = useState<Pop>(null);
  useEffect(() => { setPop((p) => (p === 'react' || p === 'reactMore' ? null : p)); }, [phone]);
  return [pop, setPop];
}
