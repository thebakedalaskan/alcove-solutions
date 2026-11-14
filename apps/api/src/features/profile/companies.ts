/*
 * Someone's company, from their address alone (docs: Plans and usage › Team), never from their calls or calendar: the demo
 * company's directory (./demo-directory.ts) for vandelay.industries, the work domain for anyone else, and none at a personal
 * address. It names the company page (features/meetings/people.ts) and a team made for someone (features/billing/teams).
 */
import { nameFrom } from '../../providers/identity';
import { COMPANY, inCompany } from './demo-directory';

/** Email domains of people who have no company: nothing ties their contacts together. `personal.example` is for trying Alcove on your own with a demo account. */
const PERSONAL = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com', 'me.com', 'yahoo.com', 'aol.com', 'proton.me', 'protonmail.com', 'personal.example']);
export const domainOf = (email: string): string => email.slice(email.lastIndexOf('@') + 1);
const titled = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Whether someone signing in with this address has a company: the demo company's directory, or a work domain. None at a personal address. */
export const hasCompany = (email: string): boolean => inCompany(email) || !PERSONAL.has(domainOf(email));

/** The company someone at this address works at, as their company page names it: the directory's name, or the domain's first label, titled. */
export function companyOf(email: string): { name: string; domain: string } | null {
  if (inCompany(email)) return { name: COMPANY.name, domain: COMPANY.domain };
  if (!hasCompany(email)) return null;
  const domain = domainOf(email);
  return { name: titled(domain.split('.')[0] ?? domain), domain };
}

/** Someone's first name, as their name has it, or as their address does when that's all there is ("kofi@…" is Kofi). */
export function firstName(who: { name: string; email: string }): string {
  const name = who.name.trim() && who.name.trim() !== who.email ? who.name.trim() : nameFrom(who.email);
  return name.split(/\s+/)[0] ?? name;
}

/**
 * What a team made for someone is called: their company page's name, or "Sam’s team" at a personal address, no longer than a
 * team's name can be (TeamNameSchema).
 */
export const teamNameFor = (who: { name: string; email: string }): string => (companyOf(who.email)?.name ?? `${firstName(who)}’s team`).slice(0, 120);
