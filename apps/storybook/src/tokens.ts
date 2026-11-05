/*
 * The design system's tokens and type styles, read from packages/ui/src/styles.css itself as Storybook loads it, so the
 * foundations stories show what's there now and nothing copied by hand. A token is a custom property on `:root, .light`
 * (the light theme, and everything that doesn't change with it); the ones `.dark` redefines change with the theme.
 */
import styles from '@alcove/ui/styles.css?raw';

const css = styles.replace(/\/\*[\s\S]*?\*\//g, '');

/** The custom properties a rule declares, in order, with the value it gives each. */
function declared(rule: RegExp): { name: string; value: string }[] {
  const body = rule.exec(css)?.[1] ?? '';
  return body.split(';').flatMap((d) => {
    const m = /^\s*--([\w-]+)\s*:\s*([\s\S]+?)\s*$/.exec(d);
    return m?.[1] && m[2] ? [{ name: m[1], value: m[2] }] : [];
  });
}

/** Every token, as the light theme declares it. */
export const TOKENS = declared(/^:root, \.light \{([^}]*)\}/m);
/** The tokens the dark theme gives other values. */
export const THEMED: ReadonlySet<string> = new Set(declared(/^\.dark,[^{]*\{([^}]*)\}/m).map((t) => t.name));

/** Tokens whose names start with `prefix` (`space-`, `radius-`, ...), in the stylesheet's order. */
export const tokensNamed = (prefix: string): string[] => TOKENS.filter((t) => t.name.startsWith(prefix)).map((t) => t.name);

/** The colour tokens: every one whose value is a colour, and the cover gradients. */
export const COLOURS: readonly string[] = TOKENS.filter((t) => CSS.supports('color', t.value) || t.name.startsWith('cover-')).map((t) => t.name);

/** The shared type styles: every `ac-` class the stylesheet gives a `font`, in its order. */
export const TYPE_STYLES: readonly string[] = [...css.matchAll(/^\.(ac-[\w-]+)\s*\{[^}]*\bfont:/gm)].flatMap((m) => (m[1] ? [m[1]] : []));

/** What a token resolves to on `el`, where its theme is. */
export const valueOf = (el: Element, name: string): string => getComputedStyle(el).getPropertyValue(`--${name}`).trim();
