/* Plans' query keys: the plan, what's on offer, and adding money. `plan` is the offers' prefix: reading it again reads both. */
export const planKeys = {
  plan: ['plan'] as const,
  offers: ['plan', 'offers'] as const,
  topUpRoutes: ['top-ups', 'routes'] as const,
  topUps: ['top-ups', 'list'] as const,
  topUp: (id: string) => ['top-ups', 'one', id] as const
};
