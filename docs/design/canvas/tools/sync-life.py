#!/usr/bin/env python3
"""Copies the real scene's visitors (horizon.tsx, horizon.css) onto the canvas, so the canvas mirrors the app."""
import re, sys, os
R = sys.argv[1]; P = sys.argv[2]
tsx = open(R + '/packages/ui/src/components/horizon.tsx', encoding='utf8').read()
css = open(R + '/packages/ui/src/styles/horizon.css', encoding='utf8').read()

def cut(a, b):
    i = tsx.index(a); j = tsx.index(b, i)
    return tsx[i + len(a):j]
SHIPS = cut('const SHIPS = ', ' as const satisfies')
LEAPERS = cut('const LEAPERS = ', ' as const;')
LEAPS = cut('const LEAPS = ', ' as const satisfies')
POSES = cut('const POSES = ', ' as const;')
FLOCK = cut('const FLOCK = ', ';\n')
LIFE = cut('const LIFE: Record<Moment, Life> = ', ';\n\nfunction quickVisit')
balloon = re.search(r'<svg className="hz-balloon".*?</svg>', tsx, re.S).group(0).replace('className=', 'class=')
balloon = re.sub(r'<path([^>]*?)\s*/>', r'<path\1></path>', balloon)
balloon = re.sub(r'\n\s*', '', balloon)
whale = re.search(r'<svg className="hz-tail".*?</svg>', tsx, re.S).group(0).replace('className=', 'class=').replace(' onAnimationEnd={gone}', ' onAnimationEnd="{{quickDone}}"')
whale = re.sub(r'<path([^>]*?)\s*/>', r'<path\1></path>', whale)

clouds = {}
block = cut('const MOMENTS: Record<Moment, Drawing> = {', '\n};\n')
for m in re.finditer(r'\b(home|team|notes|note|settings|record): \{.*?clouds: \[(.*?)\]', block, re.S):
    clouds[m.group(1)] = m.group(2)
cloudjs = '{' + ', '.join(f"{k}: [{v}]" for k, v in clouds.items()) + '}'

life = css[css.index('/* ------------------------------------------------------------ what passes through */'):]
life = life.replace('.dark .hz-lamp, .hz[data-moment="record"] .hz-lamp', '.lf[data-night="true"] .hz-lamp')
life = life.replace('.dark .hz-shoot, .hz[data-moment="record"] .hz-shoot', '.lf[data-night="true"] .hz-shoot')
life = life.replace('.hz[data-moment="notes"] .hz-sail, .hz[data-moment="settings"] .hz-sail', '.lf[data-moment="notes"] .hz-sail, .lf[data-moment="settings"] .hz-sail')
wind = re.search(r'@keyframes hz-wind \{.*?\n', css).group(0)
puff = css[css.index('/* A cloud rests where it'):css.index('@keyframes hz-rise')]
head = '''
/* What passes through, as in the real scene (packages/ui/src/styles/horizon.css). */
.lf { --hz-chop: var(--sc-chop); --hz-near: var(--sc-near); --hz-star: var(--sc-star); --hz-cloud: var(--sc-cloud); --hz-rim: var(--sc-rim); --hz-shape: var(--sc-shape); --hz-leaper: var(--sc-leaper); position: absolute; inset: 0; z-index: -1; overflow: hidden; pointer-events: none; }
.sc .lf { z-index: auto; }
.lf i { position: absolute; display: block; }
.lf svg { display: block; overflow: visible; }
.lf .hz-tail { overflow: visible; }
.lf-up { position: absolute; inset: 0 0 auto; height: var(--hz); overflow: hidden; }
.fl-in .lf { display: none; }
@media (prefers-reduced-motion: reduce) { .lf { display: none; } }
'''
p = open(P + '/pages.css', encoding='utf8').read()
mark = '\n/* What passes through, as in the real scene'
board_mark = '\n/* Everything that moves. */'
board = p[p.index(board_mark):] if board_mark in p else ''
if mark in p: p = p[:p.index(mark)]
open(P + '/pages.css', 'w', encoding='utf8').write(p + head + puff + wind + life + board)

tpl = open(os.path.dirname(os.path.abspath(__file__)) + '/Visitors.template.html', encoding='utf8').read()
out = (tpl.replace('/*@SHIPS*/', SHIPS).replace('/*@LEAPERS*/', LEAPERS).replace('/*@LEAPS*/', LEAPS).replace('/*@POSES*/', POSES)
       .replace('/*@FLOCK*/', FLOCK).replace('/*@LIFE*/', LIFE).replace('/*@CLOUDS*/', cloudjs).replace('<!--@BALLOON-->', balloon).replace('<!--@WHALE-->', whale))
open(P + '/Visitors.dc.html', 'w', encoding='utf8').write(out)
print('synced', len(life), 'bytes of css;', 'clouds for', sorted(clouds))
