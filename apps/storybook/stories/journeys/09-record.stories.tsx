/*
 * Recording in the room (docs/product/user-flows.md › 9. Record in the room), as the canvas's Record board draws it
 * (docs/design/canvas/data-record.js, AH.RC.JOURNEYS). What's said comes from the stand-in's script; the microphone is
 * the browser's made-up one, which a journey can make fail the ways a real one does, and the connection comes and goes
 * when the journey says.
 */
import type { Meta } from '@storybook/react-vite';
import { screen, within } from 'storybook/test';
import { standIn } from '../../src/api/standin';
import { setOnline } from '../../src/browser';
import { page, pages, type PageArgs, type PageStory } from '../../src/page';
import { openBrowser } from '../../src/browser';
import { away, before, LATER, outage, pause, pressable, refusal, SOON, swap, unreachable } from './play';

const meta = { title: 'Journeys/9 Record in the room', ...pages } satisfies Meta<PageArgs>;
export default meta;

/* ---------- what the journeys find ---------- */

const stage = () => screen.findByRole('region', { name: 'Recording' }, LATER);
const said = () => screen.findByRole('log', { name: 'What’s been said' }, LATER);
const recorder = () => screen.findByRole('region', { name: 'Recorder' }, LATER);
const onThisDevice = () => screen.findByRole('region', { name: /^On this device/ }, LATER);
const level = (pressed: boolean) => screen.findByRole('button', { name: 'Check the level', pressed }, SOON);

async function start(click: (el: Element) => Promise<void>, name?: string): Promise<void> {
  const r = within(await recorder());
  if (name) await click(r.getByRole('textbox', { name: 'Name this recording' }));
  await click(r.getByRole('button', { name: /^Start recording/ }));
  // The stage comes up, then its controls with the orb.
  await within(await stage()).findByRole('button', { name: /^(Pause|Resume)$/ }, LATER);
}

/* ---------- the microphone, failing ---------- */

/** How the browser's microphone fails: one device that won't start, none that will, blocked, or none at all. */
let fault: { device?: string | undefined; name: 'NotReadableError' | 'NotAllowedError' | 'NotFoundError' } | null = null;
/** The microphone tracks the browser has handed out, so a journey can unplug them. */
const handedOut: MediaStreamTrack[] = [];
const asksFor = (audio: boolean | MediaTrackConstraints, device: string) => typeof audio === 'object' && JSON.stringify(audio.deviceId ?? '').includes(device);
const microphone = outage(() => {
  fault = null;
  handedOut.length = 0;
  const media = navigator.mediaDevices;
  const open = media.getUserMedia.bind(media);
  return swap(media, 'getUserMedia', async (c?: MediaStreamConstraints) => {
    const f = fault;
    if (f && c?.audio && (!f.device || asksFor(c.audio, f.device))) throw new DOMException('The microphone didn’t start.', f.name);
    const stream = await open(c);
    handedOut.push(...stream.getAudioTracks());
    return stream;
  });
});
/** The microphone in use stops, as one does when it's unplugged or another app takes it. */
function unplug(): void {
  for (const t of handedOut) { t.stop(); t.dispatchEvent(new Event('ended')); }
}

/* ---------- the journeys ---------- */

export const RecordAndGetTheNotes: PageStory = {
  name: '9.1 Record, and get the notes',
  ...page('/record', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Name it, or leave it: empty, it’s “Notes from the room”. Click Start recording, or press R', async () => {
      await userEvent.type(within(await recorder()).getByRole('textbox', { name: 'Name this recording' }), 'Floor walk');
      await userEvent.click(within(await recorder()).getByRole('button', { name: /^Start recording/ }));
    });
    await step('The page gives way to the stage. The orb fills, and the reminder holds its place for the first moments', async () => {
      await within(await stage()).findByText(/Let everyone here know/, {}, SOON);
    });
    await step('Your voice runs across the water. What’s said comes up under it, seconds later', async () => {
      await within(await said()).findByText(/cold store/, {}, LATER);
    });
    await step('Click Finish and write notes', async () => {
      await userEvent.click(within(await stage()).getByRole('button', { name: 'Finish and write notes' }));
    });
    await step('The orb sets while the last of it is saved. The note opens, and ticks off each step until it’s written', async () => {
      await screen.findByRole('heading', { name: 'Floor walk', level: 1 }, LATER);
      await screen.findByText(/the cold store alarm is the sensor, not the door/, {}, LATER);
    });
  }
};

export const CheckTheLevel: PageStory = {
  name: '9.2 Check the level',
  ...page('/record', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Click Check the level. The page never opens the microphone by itself', async () => {
      await userEvent.click(await level(false));
    });
    await step('The reflection moves with your voice. The orb stays dark: nothing is recorded', async () => {
      await level(true);
    });
    await step('Click Stop. It lets go of the microphone, and the water goes still', async () => {
      await userEvent.click(await level(true));
      await level(false);
    });
  }
};

export const ChooseAMicrophone: PageStory = {
  name: '9.3 Choose a microphone',
  ...page('/record', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Click the microphone', async () => {
      await userEvent.click(within(await recorder()).getByRole('button', { name: /^Microphone:/ }));
    });
    await step('This browser’s microphones, the same choice calls use', async () => {
      await screen.findByRole('listbox', { name: 'Microphone' }, SOON);
    });
    await step('It’s chosen. Choosing one doesn’t open it', async () => {
      await userEvent.click(within(screen.getByRole('listbox', { name: 'Microphone' })).getByRole('option', { name: 'Desk microphone' }));
      await screen.findByRole('button', { name: 'Microphone: Desk microphone' }, SOON);
    });
  }
};

export const AMicrophoneThatFails: PageStory = {
  name: '9.4 A microphone that fails',
  ...page('/record', 'busy'),
  beforeEach: microphone.begin,
  play: async ({ userEvent, step }) => {
    const pick = async (name: string) => {
      await userEvent.click(within(await recorder()).getByRole('button', { name: /^Microphone:/ }));
      await userEvent.click(within(await screen.findByRole('listbox', { name: 'Microphone' }, SOON)).getByRole('option', { name }));
    };
    await step('While checking, pick another one', async () => {
      await userEvent.click(await level(false));
      await level(true);
      fault = { device: 'mic-headset', name: 'NotReadableError' };
      await pick('Headset microphone');
    });
    await step('It doesn’t start. It says so, and the one still in use stays shown', async () => {
      await within(await recorder()).findByText('That microphone didn’t start. Still using Built-in microphone.', {}, SOON);
    });
    await step('Nothing starts. It says what to do, with Try again', async () => {
      await userEvent.click(await level(true));
      await level(false);
      fault = { name: 'NotReadableError' };
      await userEvent.click(await level(false));
      const again = await within(await recorder()).findByRole('button', { name: 'Try again' }, SOON);
      fault = null;
      await userEvent.click(again);
      await level(true);
    });
    await step('Blocked in the browser: it says how to allow it', async () => {
      await userEvent.click(await level(true));
      await level(false);
      openBrowser({ devices: 'denied' });
      await userEvent.click(await level(false));
      await within(await recorder()).findByText(/Your browser is blocking the microphone/, {}, SOON);
    });
  }
};

export const PauseAndResume: PageStory = {
  name: '9.5 Pause and resume',
  ...page('/record', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Start recording, then click Pause', async () => {
      await start((el) => userEvent.click(el));
      await userEvent.click(within(await stage()).getByRole('button', { name: 'Pause' }));
    });
    await step('The orb empties and the water goes still. Nothing is heard. Click Resume', async () => {
      await userEvent.click(await within(await stage()).findByRole('button', { name: 'Resume' }, SOON));
    });
    await step('The orb fills again, and the time carries on from where it stopped', async () => {
      await within(await stage()).findByRole('button', { name: 'Pause' }, SOON);
    });
  }
};

export const WhileItRecords: PageStory = {
  name: '9.6 While it records',
  ...page('/record', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Start recording, and click the name', async () => {
      await start((el) => userEvent.click(el));
      await userEvent.click(within(await stage()).getByRole('textbox', { name: 'Name these notes' }));
    });
    await step('Type. It keeps recording, and the name saves when you click away', async () => {
      await userEvent.type(within(await stage()).getByRole('textbox', { name: 'Name these notes' }), 'Cold store walk');
      await userEvent.click(within(await stage()).getByRole('timer', { name: 'Time recorded' }));
      await within(await said()).findByText(/cold store/, {}, LATER);
    });
  }
};

export const Discard: PageStory = {
  name: '9.7 Discard',
  ...page('/record', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Recording. Click Home', async () => {
      await start((el) => userEvent.click(el));
      await userEvent.click(within(await stage()).getByRole('button', { name: 'Home' }));
    });
    await step('It asks first: finish, or discard', async () => {
      await screen.findByRole('dialog', { name: 'Leave the room' }, SOON);
    });
    await step('Discard recording. Nothing is kept, and you’re back on Record', async () => {
      await userEvent.click(within(screen.getByRole('dialog', { name: 'Leave the room' })).getByRole('button', { name: /^Discard recording/ }));
      await recorder();
    });
  }
};

export const TheConnectionDrops: PageStory = {
  name: '9.8 The connection drops mid-recording',
  ...page('/record', 'busy'),
  play: async ({ userEvent, step }) => {
    await step('Recording, online', async () => {
      await start((el) => userEvent.click(el));
      await within(await said()).findByText(/cold store/, {}, LATER);
    });
    await step('Offline shows at the top. It keeps recording, and saves here', async () => {
      setOnline(false);
      await within(await stage()).findByText('Offline', {}, SOON);
      await screen.findByText(/Saved on this device/, {}, LATER);
    });
    await step('Back while still recording: the rest goes up as it’s recorded, and the words catch up', async () => {
      setOnline(true);
      await within(await said()).findByText(/handover sheet/, {}, LATER);
      await within(await stage()).findByRole('button', { name: 'Finish and write notes' }, LATER);
    });
  }
};

export const FinishAndSaveOffline: PageStory = {
  name: '9.9 Finish and save, offline',
  ...page('/record', 'offline'),
  play: async ({ userEvent, step }) => {
    await step('Recording without a connection', async () => {
      await start((el) => userEvent.click(el));
    });
    await step('Still offline, the button says what it will do. Click Finish and save', async () => {
      await userEvent.click(await pressable('button', 'Finish and save', LATER));
    });
    await step('It stays on this device, and you’re back on Record', async () => {
      await within(await onThisDevice()).findByText(/Waiting for a connection/, {}, SOON);
    });
    await step('Back online, they upload by themselves, the oldest first', async () => {
      setOnline(true);
      await away('region', /^On this device/, LATER);
    });
  }
};

export const Starting: PageStory = {
  name: '9.10 Starting',
  ...page('/record', 'offline'),
  beforeEach: microphone.begin,
  play: async ({ userEvent, step }) => {
    await step('Offline, Record says recording still works', async () => {
      await within(await recorder()).findByText('Offline. Recording still works.', {}, SOON);
    });
    await step('Start recording, and it works the same way, with the reminder first', async () => {
      await start((el) => userEvent.click(el));
      await within(await stage()).findByText(/Let everyone here know/, {}, SOON);
    });
    await step('After the first moments it says it’s saving here. Words wait for the connection', async () => {
      await screen.findByText(/Saved on this device/, {}, LATER);
    });
    await step('If it can’t start at all, it says why, and the way back is one click', async () => {
      await userEvent.click(within(await stage()).getByRole('button', { name: 'Home' }));
      await userEvent.click(within(await screen.findByRole('dialog', { name: 'Leave the room' }, SOON)).getByRole('button', { name: /^Discard recording/ }));
      fault = { name: 'NotAllowedError' };
      await userEvent.click(within(await recorder()).getByRole('button', { name: /^Start recording/ }));
      await within(await stage()).findByText(/isn’t letting the browser use the microphone/, {}, LATER);
      await userEvent.click(within(await stage()).getByRole('button', { name: 'Home' }));
      await pause(600);
      const leave = screen.queryByRole('dialog', { name: 'Leave the room' });
      if (leave) await userEvent.click(within(leave).getByRole('button', { name: /^Discard recording/ }));
      await recorder();
    });
  }
};

const notAnswering = outage(() => {
  const was = standIn.recordings.start;
  return swap(standIn.recordings, 'start', async (input) => {
    const r = await was(input);
    swap(r, 'appendAudio', () => Promise.reject(unreachable()));
    return r;
  });
});
export const WhenItCantGetThrough: PageStory = {
  name: '9.11 When it can’t get through, or can’t keep going',
  ...page('/record', 'busy'),
  beforeEach: [notAnswering.begin, microphone.begin],
  play: async ({ userEvent, step }) => {
    await step('Online, but Alcove isn’t answering. It’s sent when it does', async () => {
      await start((el) => userEvent.click(el));
      await screen.findByText(/isn’t answering/, {}, LATER);
    });
    await step('The microphone stops, and none will start. What’s wrong, and Try again', async () => {
      notAnswering.end();
      fault = { name: 'NotReadableError' };
      unplug();
      const again = await within(await stage()).findByRole('button', { name: 'Try again' }, LATER);
      fault = null;
      await userEvent.click(again);
      await within(await stage()).findByRole('button', { name: 'Pause' }, SOON);
    });
  }
};

export const RecordingsWaitingOnThisDevice: PageStory = {
  name: '9.12 Recordings waiting on this device',
  ...page('/record', 'offline'),
  play: async ({ userEvent, step }) => {
    await step('Record without a connection, and Finish and save', async () => {
      await start((el) => userEvent.click(el));
      await userEvent.click(await pressable('button', 'Finish and save', LATER));
    });
    await step('Offline, they wait for a connection', async () => {
      await within(await onThisDevice()).findByText(/Waiting for a connection/, {}, SOON);
    });
    await step('Back online, they upload by themselves, the oldest first. A toast says when one’s done', async () => {
      setOnline(true);
      await screen.findByText('“Notes from the room” uploaded. Its notes are being written.', {}, LATER);
    });
    await step('Nothing left to upload: the list goes, and the notes are there', async () => {
      await away('region', /^On this device/, LATER);
      await within(await screen.findByRole('region', { name: 'Recorded before' }, LATER)).findByRole('link', { name: /^Notes from the room/ }, LATER);
    });
  }
};

const uploadsRefused = outage(() => swap(standIn.recordings, 'start', () => Promise.reject(refusal('Alcove can’t take recordings for a moment. Try again shortly.'))));
export const UploadNowOrDelete: PageStory = {
  name: '9.13 Upload now, or delete from this device',
  ...page('/record', 'offline'),
  beforeEach: uploadsRefused.begin,
  play: async ({ userEvent, step }) => {
    const menu = async () => {
      await userEvent.click(await within(await onThisDevice()).findByRole('button', { name: /^More for / }, SOON));
      return within(await screen.findByRole('dialog', {}, SOON));
    };
    await step('Two recordings wait on this device: the connection is back, but Alcove can’t take them yet', async () => {
      await start((el) => userEvent.click(el), 'Loading bay');
      await userEvent.click(await pressable('button', 'Finish and save', LATER));
      await onThisDevice();
      await start((el) => userEvent.click(el), 'Cold store');
      await userEvent.click(await pressable('button', 'Finish and save', LATER));
      setOnline(true);
      await within(await onThisDevice()).findAllByText(/Can’t upload yet/, {}, LATER);
    });
    await step('Click the menu on a row: Upload now. It goes straight away', async () => {
      uploadsRefused.end();
      await userEvent.click((await menu()).getByRole('button', { name: /^Upload now/ }));
    });
    await step('Or Delete from this device. It asks first, in the same menu', async () => {
      await userEvent.click((await menu()).getByRole('button', { name: /^Delete from this device/ }));
      await userEvent.click(await within(await screen.findByRole('dialog', {}, SOON)).findByRole('button', { name: /^Delete/ }, SOON));
    });
    await step('Gone, here and on Alcove', async () => {
      await away('region', /^On this device/, LATER);
    });
  }
};

export const RecordedBefore: PageStory = {
  name: '9.14 Recorded before',
  ...page('/record', 'writing'),
  play: async ({ userEvent, step }) => {
    const before = () => screen.findByRole('region', { name: 'Recorded before' }, LATER);
    await step('One still recording elsewhere, and the newest written ones', async () => {
      await within(await before()).findByRole('link', { name: /^Harbourline walkthrough/ }, SOON);
    });
    await step('Click a recording, and its note opens', async () => {
      await userEvent.click(within(await before()).getByRole('link', { name: /^Interview: Jonas Weber/ }));
      await screen.findByRole('heading', { name: 'Interview: Jonas Weber', level: 1 }, LATER);
    });
    await step('The four newest show on Record. In Calls has the rest, recorded in the room', async () => {
      await userEvent.click(within(await screen.findByRole('complementary', { name: 'Side panel' })).getByRole('link', { name: /^Record/ }));
      await userEvent.click(within(await before()).getByRole('link', { name: 'In Calls' }));
      await screen.findByRole('heading', { name: 'Recorded in the room', level: 2 }, LATER);
    });
    await step('Offline, a note doesn’t open, and it says so', async () => {
      await userEvent.click(within(screen.getByRole('complementary', { name: 'Side panel' })).getByRole('link', { name: /^Record/ }));
      setOnline(false);
      await userEvent.click(within(await before()).getByRole('link', { name: /^Site visit, Harbourline/ }));
      await screen.findByText('Notes open when you’re back online.', {}, SOON);
    });
  }
};

export const HowARecordingCanStand: PageStory = {
  name: '9.15 How a recording on this device can stand',
  ...page('/record', 'offline'),
  beforeEach: uploadsRefused.begin,
  play: async ({ userEvent, step }) => {
    await step('Waiting for a connection', async () => {
      await start((el) => userEvent.click(el));
      await userEvent.click(await pressable('button', 'Finish and save', LATER));
      await within(await onThisDevice()).findByText(/Waiting for a connection/, {}, SOON);
    });
    await step('Can’t upload yet, with Alcove’s reason', async () => {
      setOnline(true);
      await within(await onThisDevice()).findByText(/Can’t upload yet/, {}, LATER);
    });
    await step('Uploading, once Alcove takes it. The menu goes while it’s busy, and the column stays', async () => {
      uploadsRefused.end();
      await userEvent.click(await within(await onThisDevice()).findByRole('button', { name: /^More for / }, SOON));
      await userEvent.click(within(await screen.findByRole('dialog', {}, SOON)).getByRole('button', { name: /^Upload now/ }));
      await away('region', /^On this device/, LATER);
    });
  }
};

const keepNothing = before((w) => { w.prefs.recordOffline = false; });
export const RecordWithoutAConnectionOff: PageStory = {
  name: '9.16 Record without a connection, off',
  ...page('/record', 'busy'),
  beforeEach: keepNothing,
  play: async ({ userEvent, step }) => {
    await step('Off in Settings: nothing is kept here, and the line says a dropped connection pauses it', async () => {
      await screen.findByText(/If the connection drops, recording pauses/, {}, LATER);
    });
    await step('Offline, it can’t start. Start recording waits for the connection', async () => {
      setOnline(false);
      await within(await recorder()).findByText('Offline. Recording needs a connection.', {}, SOON);
      setOnline(true);
      await pressable('button', /^Start recording/, LATER);
    });
    await step('The connection drops mid-recording, and it pauses. Resume waits for the connection', async () => {
      await start((el) => userEvent.click(el));
      setOnline(false);
      await screen.findByText(/Paused: you’re offline/, {}, LATER);
    });
    await step('Back online, Resume is yours to press', async () => {
      setOnline(true);
      await userEvent.click(await pressable('button', 'Resume', LATER));
      await within(await stage()).findByRole('button', { name: 'Pause' }, SOON);
    });
  }
};

export const FirstDay: PageStory = {
  name: '9.17 First day',
  ...page('/record', 'first-day'),
  play: async ({ step }) => {
    await step('Nothing recorded yet. The sky has the job, and the water says what will show up', async () => {
      await recorder();
      await screen.findByText(/what you record shows up here, with its notes/, {}, SOON);
    });
  }
};
