/*
 * The languages a code block can say it's in. A block stores one of these short names in `lang`, or nothing for plain text.
 * Anything else, which can only come from another browser, is drawn as plain text and left as it is. A language named on
 * code that's pasted in (`class="language-python"`, as GitHub and most sites copy it out) sets it; nothing is guessed from
 * what the code says, which is unreliable on a few lines.
 */
import type { Node as PMNode } from 'prosemirror-model';

export const CODE_LANGS = [
  { id: 'javascript', name: 'JavaScript', names: ['javascript', 'js', 'jsx', 'mjs', 'cjs', 'typescript', 'ts', 'tsx'] },
  { id: 'python', name: 'Python', names: ['python', 'py', 'python3'] },
  { id: 'cpp', name: 'C++', names: ['cpp', 'c++', 'cxx', 'cc', 'hpp'] }
] as const;
export type CodeLang = (typeof CODE_LANGS)[number]['id'];

/** The language a code block says it's in, if it's one this release colours. */
export function codeLang(node: PMNode): CodeLang | null {
  const lang: unknown = node.attrs['lang'];
  return CODE_LANGS.find((l) => l.id === lang)?.id ?? null;
}

/** What a language is called, as the block's corner and its menu say it: Plain text for none. */
export const langName = (lang: CodeLang | null): string => CODE_LANGS.find((l) => l.id === lang)?.name ?? 'Plain text';

/** A language by any name it goes by: what's typed after ```, and what a pasted class says. */
export function langNamed(name: string): CodeLang | null {
  const said = name.toLowerCase();
  return CODE_LANGS.find((l) => l.names.some((n) => n === said))?.id ?? null;
}

/** The language pasted code says it's in: `language-…` or `lang-…` on its `<pre>` or `<code>`, or GitHub's `highlight-source-…` round it. */
export function langOfElement(pre: HTMLElement): CodeLang | null {
  const classes = [pre, pre.querySelector('code'), pre.parentElement].flatMap((el) => (el ? [...el.classList] : []));
  for (const c of classes) {
    const named = /^(?:language|lang|highlight-source)-(.+)$/.exec(c)?.[1];
    const lang = named ? langNamed(named) : null;
    if (lang) return lang;
  }
  return null;
}
