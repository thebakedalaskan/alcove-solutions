/*
 * Workspaces' query keys: your workspaces, what you can bring to a call, and each workspace's people, tree, items, files,
 * documents' sharing and versions, previews and Trash. Most are under `workspaces`, so reading that again reads them all.
 */
export const workspaceKeys = {
  workspaces: ['workspaces'] as const,
  documents: ['documents'] as const,
  workspacePeople: (id: string) => ['workspaces', id, 'people'] as const,
  personIds: (id: string, emails: readonly string[]) => ['workspaces', id, 'ids', ...emails] as const,
  workspaceMedia: (id: string) => ['workspaces', id, 'media'] as const,
  mentions: ['workspaces', 'mentions'] as const,
  documentShare: (id: string, documentId: string) => ['workspaces', id, 'share', documentId] as const,
  documentVersions: (id: string, documentId: string) => ['workspaces', id, 'versions', documentId] as const,
  documentVersion: (id: string, documentId: string, version: string) => ['workspaces', id, 'versions', documentId, version] as const,
  /** Your own notes beside a board's frames: never anyone else's, and gone with the cache when someone else signs in. */
  presenterFrameNotes: (id: string, boardId: string) => ['workspaces', id, 'presenter-notes', boardId, 'frames'] as const,
  workspaceItem: (id: string, itemId: string) => ['workspaces', id, 'items', itemId] as const,
  workspaceTree: (id: string) => ['workspaces', id, 'tree'] as const,
  boardsToBring: ['workspaces', 'boards'] as const,
  /** What documents say at the top, for the Drive's cards: the IDs asked about, in the order asked. */
  previews: (id: string, ids: readonly string[]) => ['workspaces', id, 'previews', ...ids] as const,
  /** What's in Trash in every workspace, for the Drive's Trash. */
  trashed: ['workspaces', 'trashed'] as const,
  /** What the documents on a workspace's Home say at the top, for their cards. */
  workspacePreviews: (id: string, items: readonly string[]) => ['workspaces', id, 'previews', items.join(',')] as const,
  /** The line on what a workspace is for. */
  workspaceAbout: (id: string) => ['workspaces', id, 'about'] as const
};
