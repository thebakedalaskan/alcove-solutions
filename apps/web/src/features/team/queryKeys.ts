/*
 * The team's query keys: the company directory (`team`), people found by what's typed, the team you're on (`teams.mine`,
 * apart from the directory) and its notes, and an invite's link before joining.
 */
export const teamKeys = {
  team: ['team'] as const,
  people: (query: string) => ['people', query] as const,
  /** The team you're on (`teams.mine`), apart from `team`, the company directory. */
  myTeam: ['my-team'] as const,
  teamNotes: ['my-team', 'notes'] as const,
  teamInvite: (secret: string) => ['team-invite', secret] as const
};
