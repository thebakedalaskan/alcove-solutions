/* The people and notes every page of the rest of the app shares, so they tell one story. All made up. */
window.AH.D = {
  me: { id: 'art', name: 'Art Vandelay', first: 'Art', email: 'art@vandelay.industries' },
  company: 'Vandelay Industries', domain: 'vandelay.industries',
  people: [
    { id: 'priya', name: 'Priya Raman', first: 'Priya', title: 'Product', on: true, next: 'Next call · 17:30' },
    { id: 'kofi', name: 'Kofi Asante', first: 'Kofi', title: 'Design lead', on: true, next: 'Next call · 17:30' },
    { id: 'aiko', name: 'Aiko Tanaka', first: 'Aiko', title: 'Engineering', on: true, last: 'Last call · Yesterday' },
    { id: 'maya', name: 'Maya Chen', first: 'Maya', title: 'Finance', on: true, last: 'Last call · Today' },
    { id: 'ines', name: 'Ines Moreau', first: 'Ines', title: 'Co-founder', on: true, last: 'Last call · Today' },
    { id: 'lena', name: 'Lena Fischer', first: 'Lena', title: 'Research', on: false, meetings: '2 meetings coming up' },
    { id: 'sam', name: 'Sam Ortiz', first: 'Sam', title: 'Product design', on: false, meetings: '3 meetings coming up' },
    { id: 'diego', name: 'Diego Ruiz', first: 'Diego', title: 'Sales', on: false, invited: true }
  ],
  groups: [
    { id: 'g1', name: 'Leads', people: ['priya', 'kofi', 'ines'], calls: 12 },
    { id: 'g2', name: 'Product', people: ['priya', 'kofi', 'aiko', 'maya'], calls: 7 }
  ],
  /* `open`: decisions to confirm; `todo`: follow-ups still open. `kind`: call, room or shared. */
  notes: [
    { id: 'n2', title: 'Team standup', group: 'Today', time: '09:00', day: 'Today', length: '20 min', kind: 'call', faces: 'priya,kofi,maya', summary: 'The new onboarding ships behind a flag on 12 November, and support gets the help article first.', open: 1, todo: 1 },
    { id: 'n1', title: 'Art’s call', group: 'Today', time: '11:58', day: 'Today', length: '14 min', kind: 'call', faces: 'ines', summary: 'Orders before the move ship from the old warehouse, and the movers come first.', open: 1, todo: 2 },
    { id: 'n3', title: 'Pricing sync', group: 'Yesterday', time: '15:00', day: 'Yesterday', length: '32 min', kind: 'call', faces: 'maya,lena', summary: 'The team plan gets a monthly option. Free minutes stay as they are.', open: 0, todo: 1 },
    { id: 'n4', title: 'Design review', group: 'Yesterday', time: '11:00', day: 'Yesterday', length: '45 min', kind: 'call', faces: 'priya,kofi,aiko', summary: 'The sidebar reads better dark. One filled button per view from now on.', open: 0, todo: 0, pinned: true },
    { id: 'n5', title: 'Interview: Jonas Weber', group: 'This week', time: '14:10', day: 'Mon', length: '52 min', kind: 'room', faces: '', summary: 'Strong on distributed systems. Wants to stay close to customers.', open: 0, todo: 1 },
    { id: 'n6', title: 'Site visit, Harbourline', group: 'This week', time: '10:30', day: 'Mon', length: '1 h 12 min', kind: 'room', faces: '', summary: 'The Harbourline team records every handover. They need notes in Portuguese.', open: 0, todo: 0, pinned: true },
    { id: 'n7', title: 'Launch planning', group: 'Last week', time: '16:00', day: 'Tue 27 Oct', length: '38 min', kind: 'call', faces: 'priya,ines', summary: 'The launch moves to the 18th. Sign-ups are back up after the pricing change.', open: 0, todo: 0, series: 'Every Tuesday' },
    { id: 'n8', title: 'Board prep', group: 'Last week', time: '09:30', day: 'Mon 26 Oct', length: '41 min', kind: 'shared', sharedBy: 'Ines', faces: 'ines,maya', summary: 'Runway is 22 months. The ask stays at the same size.', open: 0, todo: 0 }
  ]
};
