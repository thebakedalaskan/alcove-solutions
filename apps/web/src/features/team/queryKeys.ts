/*
 * The team's query keys: the company directory (`team`), people found by what's typed, the invite link to copy, the team
 * you're on (`teams.mine`, apart from the directory) and its notes, the invitations to your addresses, and what a secret
 * after /invite# says.
 */
export const teamKeys = {
  team: ['team'] as const,
  people: (query: string) => ['people', query] as const,
  /** The invite link to copy: the team's on a team, your own with none. */
  inviteLink: ['invite-link'] as const,
  /** The team you're on (`teams.mine`), apart from `team`, the company directory. */
  myTeam: ['my-team'] as const,
  teamNotes: ['my-team', 'notes'] as const,
  /** The invitations to your sign-in addresses, put aside or not. */
  invitations: ['team-invitations'] as const,
  /** What a secret after /invite# says: an invitation's own link, or a team's. */
  peek: (secret: string) => ['invite-peek', secret] as const
};
