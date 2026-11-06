import { AgentDisclosure } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box } from '../../../src/component';
const meta = { title: 'Components/Settings/AgentDisclosure', component: AgentDisclosure, render: () => <Box width={640} height="auto"><AgentDisclosure /></Box> } satisfies Meta<typeof AgentDisclosure>;
export default meta;
export const ReadableInformation: StoryObj<typeof meta> = {};
