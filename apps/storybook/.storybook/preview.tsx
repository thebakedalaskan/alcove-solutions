/*
 * Every story renders on the app's own stylesheet and fonts, in light or dark (the toolbar's Theme), with or without a
 * connection (its Connection), at any width (its viewports: phone, a narrow window, tablet, laptop, wide). Before a story
 * renders, its scenario starts: a fresh demo world for the stand-in API, the demo clock at the scenario's moment, and the
 * browser as the scenario says (src/api/scenarios.ts). A component story gets the providers the app's root would give it; a
 * page story (`parameters.page`) mounts the app's own root, which brings its own.
 */
import { ThemeProvider, ToastProvider, TooltipProvider } from '@alcove/ui';
import type { Decorator, Preview, StoryContext } from '@storybook/react-vite';
import '../src/styles.css';
import { begin, isScenario, type ScenarioName } from '../src/api/scenarios';
import { installBrowser, setOnline, type BrowserSetup } from '../src/browser';
import { installClock } from '../src/world/clock';
import type { Opening } from '../src/world';

installClock();
installBrowser();

/** Where the app's ThemeProvider reads the theme from when it mounts. */
const THEME_KEY = 'alcove-theme';
const themeOf = (ctx: StoryContext): 'light' | 'dark' => (ctx.globals['theme'] === 'dark' ? 'dark' : 'light');
const offlineIn = (ctx: StoryContext): boolean => ctx.globals['connection'] === 'offline';

/** The story's scenario: picked in Controls (`args.scenario`), set by the story (`parameters.scenario`), or the busy team. */
function scenarioOf(ctx: StoryContext): ScenarioName {
  const picked: unknown = ctx.args['scenario'];
  const set: unknown = ctx.parameters['scenario'];
  return isScenario(picked) ? picked : isScenario(set) ? set : 'busy';
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
/** A date, whichever `Date` made it: `on()` makes the browser's own, and `Date` here is the demo clock's by now. */
const isDate = (v: unknown): v is Date => Object.prototype.toString.call(v) === '[object Date]';
/** What the story changes about how its page opens (`parameters.opening`), on top of its scenario. */
function openingOf(ctx: StoryContext): Partial<Opening> {
  const o: unknown = ctx.parameters['opening'];
  if (!isRecord(o)) return offlineIn(ctx) ? { browser: { online: false } } : {};
  const b = isRecord(o['browser']) ? o['browser'] : {};
  const browser: Partial<BrowserSetup> = {
    ...(typeof b['online'] === 'boolean' ? { online: b['online'] } : {}),
    ...(b['devices'] === 'granted' || b['devices'] === 'prompt' || b['devices'] === 'denied' ? { devices: b['devices'] } : {}),
    ...(b['notifications'] === 'granted' || b['notifications'] === 'denied' || b['notifications'] === 'default' ? { notifications: b['notifications'] } : {}),
    ...(typeof b['sharedNotificationBrowser'] === 'boolean' ? { sharedNotificationBrowser: b['sharedNotificationBrowser'] } : {}),
    ...(b['notificationTransport'] === 'scripted' || b['notificationTransport'] === 'native' || b['notificationTransport'] === 'unsupported' || b['notificationTransport'] === 'failed' ? { notificationTransport: b['notificationTransport'] } : {}),
    ...(b['answer'] === 'granted' || b['answer'] === 'denied' || b['answer'] === 'default' ? { answer: b['answer'] } : {}),
    ...(b['floatingWindow'] === 'native' || b['floatingWindow'] === 'unsupported' || b['floatingWindow'] === 'blocked' ? { floatingWindow: b['floatingWindow'] } : {}),
    ...(offlineIn(ctx) ? { online: false } : {})
  };
  return {
    ...(isDate(o['now']) ? { now: o['now'] } : {}),
    ...(typeof o['signedInHere'] === 'boolean' ? { signedInHere: o['signedInHere'] } : {}),
    ...(typeof o['tourSeen'] === 'boolean' ? { tourSeen: o['tourSeen'] } : {}),
    ...(typeof o['latency'] === 'number' ? { latency: o['latency'] } : {}),
    browser
  };
}

/** The scenario running now, for which story and with which toolbar, and the toolbar's connection when it last changed. */
let running: { story: string; scenario: ScenarioName; toolbar: string } | null = null;
let connection: unknown = 'online';
const toolbarOf = (ctx: StoryContext): string => JSON.stringify(ctx.globals);

function start(ctx: StoryContext): void {
  const scenario = scenarioOf(ctx);
  begin(scenario, openingOf(ctx));
  running = { story: ctx.id, scenario, toolbar: toolbarOf(ctx) };
  connection = ctx.globals['connection'];
}
/** The toolbar's connection changed while the page is open: it goes, or comes back, with the event the browser sends. */
function follow(ctx: StoryContext): void {
  if (ctx.globals['connection'] === connection) return;
  connection = ctx.globals['connection'];
  setOnline(!offlineIn(ctx));
}

/** A scenario picked in Controls starts there and then. */
const withWorld: Decorator = (Story, ctx) => {
  const scenario = scenarioOf(ctx);
  if (running?.story !== ctx.id || running.scenario !== scenario) start(ctx);
  follow(ctx);
  return <Story key={scenario} />;
};

/** The theme as the app keeps it: the `.dark` class on the document, and in this browser for the app's ThemeProvider. */
const withTheme: Decorator = (Story, ctx) => {
  const theme = themeOf(ctx);
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* storage unavailable: the class still says */ }
  document.documentElement.classList.toggle('dark', theme === 'dark');
  return <Story key={theme} />;
};

/** What the app's root gives every screen, for a component on its own. */
const withKit: Decorator = (Story, ctx) => (ctx.parameters['page'] === true ? <Story /> : (
  <ThemeProvider>
    <TooltipProvider>
      <ToastProvider>
        <Story />
      </ToastProvider>
    </TooltipProvider>
  </ThemeProvider>
));

const preview: Preview = {
  decorators: [withKit, withTheme, withWorld],
  beforeEach: (ctx) => {
    // The toolbar (theme, connection, viewport) renders the story again: the page carries on, as an open page would.
    if (running?.story === ctx.id && running.scenario === scenarioOf(ctx) && running.toolbar !== toolbarOf(ctx)) {
      running.toolbar = toolbarOf(ctx);
      follow(ctx);
      return;
    }
    start(ctx);
  },
  globalTypes: {
    theme: {
      description: 'Light or dark',
      toolbar: { title: 'Theme', icon: 'mirror', items: [{ value: 'light', icon: 'sun', title: 'Light' }, { value: 'dark', icon: 'moon', title: 'Dark' }], dynamicTitle: true }
    },
    connection: {
      description: 'Whether the browser has a connection',
      toolbar: { title: 'Connection', icon: 'globe', items: [{ value: 'online', title: 'Online' }, { value: 'offline', title: 'Offline' }], dynamicTitle: true }
    }
  },
  initialGlobals: { theme: 'light', connection: 'online' },
  parameters: {
    layout: 'padded',
    controls: { expanded: true },
    viewport: {
      options: {
        phone: { name: 'Phone', styles: { width: '390px', height: '844px' }, type: 'mobile' },
        narrow: { name: 'Narrow window', styles: { width: '700px', height: '820px' }, type: 'desktop' },
        tablet: { name: 'Tablet', styles: { width: '1024px', height: '768px' }, type: 'tablet' },
        laptop: { name: 'Laptop', styles: { width: '1440px', height: '900px' }, type: 'desktop' },
        wide: { name: 'Wide', styles: { width: '1920px', height: '1080px' }, type: 'desktop' }
      }
    },
    options: { storySort: { order: ['Foundations', ['Colour', 'Type', 'Icons', 'Scales', 'The evening'], 'Components', ['Icons and marks', 'Actions', 'Forms', 'Feedback', 'Overlays', 'Layout', 'Motion', 'The evening', 'People', 'Starting a call', 'Ringing and waiting', 'In a call', 'Notes and transcript', 'Record', 'Settings', 'Plans', 'Checkout', 'Workspace', 'Board'], 'Pages', 'Calls', 'Board', ['Surface', 'States', 'Presence'], 'Journeys'] } }
  }
};

export default preview;
