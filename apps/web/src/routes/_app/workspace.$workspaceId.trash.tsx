/* A workspace's Trash: the parent route holds the workspace and reads where you are. */
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/workspace/$workspaceId/trash')({});
