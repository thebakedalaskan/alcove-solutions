import { Mark, TabAttentionIcon } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';

const meta = { title: 'Foundations/Tab attention', parameters: { layout: 'padded' } } satisfies Meta;
export default meta;

export const States: StoryObj = {
  name: 'Normal, unread and waiting for admission',
  render: () => <div style={{ display: 'grid', gap: 24 }}>
    {(['light', 'dark'] as const).map((theme) => <section key={theme} className={theme} style={{ background: 'var(--surface)', color: 'var(--ink)', padding: 24, borderRadius: 13 }} aria-label={`${theme} browser chrome`}>
      <h2>{theme === 'light' ? 'Light' : 'Dark'} browser chrome</h2>
      <div style={{ display: 'flex', gap: 32, alignItems: 'end', flexWrap: 'wrap' }}>
        {[16, 32, 64].map((size) => <div key={size} style={{ display: 'grid', gap: 12 }}>
          <span>{size}px</span><Mark size={size} />
          <TabAttentionIcon kind="information" count={3} size={size} colors={{ badge: 'var(--horizon)', ink: 'var(--surface)', rim: 'var(--surface)' }} />
          <TabAttentionIcon kind="action" count={2} size={size} colors={{ badge: 'var(--rose)', ink: 'var(--surface)', rim: 'var(--surface)' }} />
          <TabAttentionIcon kind="information" count={12} size={size} colors={{ badge: 'var(--horizon)', ink: 'var(--surface)', rim: 'var(--surface)' }} />
        </div>)}
        <p>Unread mentions use a circle. Admission requests use a square and take priority. More than nine shows +.</p>
      </div>
    </section>)}
  </div>
};
