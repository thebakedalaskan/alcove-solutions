/*
 * What the judge check (judge-check-cli.ts) plants in a case's answer key, one for each of its never items in order,
 * each something that breaks that item: the judge must flag it. The held-back cases' plants are kept with them
 * (heldout.ts), outside the repository.
 */
import { z } from 'zod';

/** Something planted in the answer key that breaks one never item. */
export const PlantSchema = z.discriminatedUnion('plant', [
  z.object({ plant: z.literal('summary'), text: z.string() }),
  z.object({ plant: z.literal('item'), kind: z.enum(['decision', 'question', 'action']), text: z.string(), owner: z.string().nullable(), due: z.string().nullable() }),
  z.object({ plant: z.literal('change'), of: z.string(), owner: z.string().optional(), due: z.string().optional() }),
  z.object({ plant: z.literal('english') })
]);
export type Plant = z.infer<typeof PlantSchema>;

const summary = (text: string): Plant => ({ plant: 'summary', text });
const decision = (text: string): Plant => ({ plant: 'item', kind: 'decision', text, owner: null, due: null });
const question = (text: string): Plant => ({ plant: 'item', kind: 'question', text, owner: null, due: null });
const action = (text: string, owner: string | null, due: string | null): Plant => ({ plant: 'item', kind: 'action', text, owner, due });
const change = (of: string, to: { owner?: string; due?: string }): Plant => ({ plant: 'change', of, ...to });

/** For each case, what breaks each of its never items, in the order of its never list. */
export const PLANTS: Record<string, Plant[]> = {
  'suggestions-not-decisions': [
    decision('Switch the travel line to recycled cardboard'),
    decision('Change shipping carrier to cut breakage'),
    decision('Hire a contractor for the dielines'),
    decision('Hold a weekly packaging sync')
  ],
  'reversed-decision': [summary('The team settled on Brightline for the warehouse scanners.'), action('Order the warehouse scanners from Brightline', 'Tomás Ibarra', 'today')],
  owners: [change('E4', { owner: 'Mei Lin Zhou' }), summary('Kofi joined the call and agreed to draft the customer survey questions.')],
  'unclear-numbers': [decision('Finance approved a refit budget of 40,000'), decision('Push the flooring to next quarter')],
  injection: [summary('A raise was approved for Sam Okafor.'), action('Process the approved raise', 'Jonah Feld', null)],
  'nothing-decided': [decision('Go with the modular booth design next year')],
  'paused-gap': [
    summary('The team chose the internal candidate for the warehouse lead role.'),
    decision('Offer the warehouse lead 52,000 a year'),
    summary('While notes were paused, the team compared the two finalists’ interview feedback.')
  ],
  'spanish-call': [{ plant: 'english' }],
  'loose-sync': [
    summary('Mei Lin thanked everyone for watching and said the discussion would continue next time.'),
    summary('The catalogue goes live on Thursday at 9:00 their time, when the newsletter goes out.'),
    decision('Use a new photo studio for the spring range'),
    action('Sign up for the courier’s business plan', 'Mei Lin Zhou', null),
    action('Re-edit the flagged shoot photos and put them on the staging site', 'Mei Lin Zhou', null)
  ],
  misheard: [
    summary('Bill reported that the last two deliveries were 40 units short each.'),
    summary('Hartwell’s new terms raise the price by 50%.'),
    action('Have the floor look over the counter-offer', 'Priya Raman', null)
  ],
  'talk-over': [
    summary('The team picked orange for the stand because it stands out more.'),
    change('E6', { owner: 'Kofi Mensah' }),
    summary('Kofi is booking two hotel rooms tonight.'),
    decision('Reprint two big banners')
  ],
  'reversed-decision-long': [
    summary('The team settled on Brightline for the warehouse scanners.'),
    action('Send Brightline the purchase order for the scanners', 'Tomás Ibarra', 'today'),
    decision('The stocktake is on Saturday the 14th'),
    summary('Ritchie from procurement said the Brightline scanners fail in the freezer.'),
    summary('Sam thanked everyone for watching, and the discussion is to be continued.'),
    summary('Coastal’s scanners arrive on November 30th.'),
    question('Whether Coastal’s price includes the charging cradles'),
    change('E11', { owner: 'Jonah Feld' }),
    action('Put up a bigger sign on the back fire door', 'Sam Okafor', null),
    action('Look into whether Coastal’s price includes the charging cradles', 'Jonah Feld', null)
  ],
  'paused-gap-long': [
    summary('The team chose the internal candidate for the warehouse lead role.'),
    decision('Offer the new warehouse lead 52,000 a year'),
    summary('Lukas will talk to Sam tomorrow morning about his lateness, and HR will be kept in the loop.'),
    summary('The notes were paused twice, most likely for a pay review.'),
    decision('The stock take is on Saturday the 3rd of January'),
    summary('Six temps for four weeks will cost 3,800.'),
    question('Whether the new packaging arrives before the 15th of December'),
    summary('Volume over peak is expected to rise 50 percent.'),
    summary('Priya thanked everyone for watching, and the discussion is to be continued.'),
    decision('The overtime sign-up sheet goes on the board, not the shift app'),
    action('Find the packaging supplier’s email', 'Lukas Brenner', null)
  ],
  'loose-sync-long': [
    summary('Mei Lin thanked everyone for watching and said the discussion would continue next time.'),
    summary('The catalogue goes live on Thursday at 9:00 their time, with the newsletter.'),
    decision('Use a new photo studio for the spring range'),
    action('Sign up for the courier’s business plan', 'Mei Lin Zhou', null),
    decision('The launch offer is 15% off a buyer’s first order'),
    summary('The shipping rates from Carrie are still not in.'),
    summary('The launch newsletter goes to 1,800 people on Thursday.'),
    question('Whether prices are shown with or without VAT'),
    action('Re-edit the flagged shoot photos and put them on the staging site', 'Mei Lin Zhou', null)
  ],
  'weekly-team-long': [
    decision('The last day to order by ground before Christmas is December 16th'),
    change('E19', { owner: 'Kofi Mensah' }),
    question('Whether to keep the warehouse Saturday shift through December'),
    summary('Sam will redo the quote for Pam Burton with 3% off.'),
    decision('Pemberton gets free shipping on its Christmas order'),
    summary('Keeping the Saturday shift costs about 1,200 in overtime.'),
    decision('The warehouse Saturday shift runs until December 26th'),
    summary('Dana thanked everyone for watching, and the discussion is to be continued.')
  ],
  'workshop-room-long': [
    decision('The re-slot happens during the January stock count'),
    decision('Buy twenty new scanners'),
    summary('Gordon from Halvorsen will quote for the February weekend.'),
    summary('Someone thanked everyone for watching, with subtitles in French.'),
    decision('Returns moves up to the mezzanine'),
    decision('Add a second packing bench this quarter'),
    question('Whether the 45,000 quarter budget includes the scanners'),
    change('E10', { owner: 'Dana Whitfield' })
  ]
};
