/*
 * RecPrint: a recording's own print, at the start of its row in Record's list of what was recorded before. Seven bars
 * drawn from its ID, so the same recording always has the same print and no two look alike. It's a mark to know it by,
 * not its sound. Record is night in both themes.
 */
import { Icon, RecPrint } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box, Row, onStage } from '../../../src/component';

/** Art's room recordings, as Record lists them: one going on now on another device, and two from Monday. */
const RECORDED = [
  { id: 'r0', title: 'Harbourline walkthrough', gist: 'Recording now', when: 'Today', open: 0 },
  { id: 'n5', title: 'Interview: Jonas Weber', gist: 'Strong on distributed systems. Wants to stay close to customers.', when: 'Mon · 52 min', open: 1 },
  { id: 'n6', title: 'Site visit, Harbourline', gist: 'The Harbourline team records every handover. They need notes in Portuguese.', when: 'Mon · 1 h 12 min', open: 0 }
] as const;

const meta = {
  title: 'Components/Record/RecPrint',
  component: RecPrint,
  ...onStage,
  args: { id: 'n5' },
  argTypes: { id: { control: 'text' } }
} satisfies Meta<typeof RecPrint>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The interview with Jonas. Change the ID in Controls and the print changes with it. */
export const Print: Story = {};
/** Different recordings, different prints. */
export const SeveralRecordings: Story = {
  name: 'Several recordings',
  render: () => <Row>{['r0', 'n5', 'n6', 'n1', 'n2', 'n3', 'n4'].map((id) => <RecPrint key={id} id={id} />)}</Row>
};
/** At the start of each row, as Record lists what was recorded before. */
export const InTheList: Story = {
  name: 'In the list',
  render: () => (
    <Box width="min(600px, 100%)" height="auto">
      <section className="rec-list" aria-label="Recorded before">
        <div className="rec-h"><h2>Recorded before</h2><a href="#notes" className="rec-more-link">In Calls<Icon name="right" size={15} /></a></div>
        <ul className="rec-before">
          {RECORDED.map((r) => (
            <li key={r.id}>
              <a href={`#${r.id}`} className="rec-n">
                <RecPrint id={r.id} />
                <span className="rec-t"><b className="ac-clamp-1">{r.title}</b><small className="ac-clamp-1">{r.gist}</small></span>
                <span className="rec-f">
                  {r.open > 0 && <span className="rec-todo"><Icon name="userCheck" size={13} /><span aria-hidden="true">{r.open}</span><span className="sr-only">{r.open} follow-up still open</span></span>}
                </span>
                <span className="rec-w"><span>{r.when}</span><small><Icon name="lock" size={13} />Only you</small></span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </Box>
  )
};
