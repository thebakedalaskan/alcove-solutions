/* A workspace with nothing chosen: its parent route holds the workspace, which opens what you had open last. */
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/drive/$workspaceId/')({});
