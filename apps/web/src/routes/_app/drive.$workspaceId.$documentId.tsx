/* A document in a workspace, and with a hash, a line in it: the parent route holds the workspace and reads where you are. */
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/drive/$workspaceId/$documentId')({});
