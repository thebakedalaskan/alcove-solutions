/*
 * The team's query keys: the company directory (`team`), people found by what's typed, your own invite link, the team you're
 * on (`teams.mine`, apart from the directory) and its notes, an invite's link before joining, and who an invite link is from.
 */
export const teamKeys = {
  team: ['team'] as const,
  people: (query: string) => ['people', query] as const,
  /** Your own invite link, and who joined from it. */
  inviteLink: ['invite-link'] as const,
  /** The team you're on (`teams.mine`), apart from `team`, the company directory. */
  myTeam: ['my-team'] as const,
  teamNotes: ['my-team', 'notes'] as const,
  teamInvite: (secret: string) => ['team-invite', secret] as const,
  /** Who someone's invite link is from. */
  invitedBy: (secret: string) => ['invited-by', secret] as const
};
