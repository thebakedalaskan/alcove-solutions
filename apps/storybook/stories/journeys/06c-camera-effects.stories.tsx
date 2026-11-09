/** The real camera-effects flows, on the story browser's synthetic camera, never hardware capture. */
import type { Meta } from '@storybook/react-vite';
import { phone } from '../../src/call';
import { pages, type PageArgs } from '../../src/page';
import { BeforeJoining, CameraOff, InTheCall } from '../calls/CameraEffects.stories';

const meta = { title: 'Journeys/6c Camera effects', ...pages } satisfies Meta<PageArgs>;
export default meta;

export const Preview = { ...BeforeJoining, name: '5.1 Preview a background before joining' };
export const ChangeInCall = { ...InTheCall, name: '6.29 Change your background during a call' };
export const ChooseWhileOff = { ...CameraOff, name: '6.29 Choose a background with the camera off' };
export const ChangeInCallPhone = phone(ChangeInCall);
export const ChooseWhileOffPhone = phone(ChooseWhileOff);
