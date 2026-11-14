/**
 * `pnpm --filter @alcove/server operator <command>`: operating Alcove from outside the enclave, by requests signed with
 * the operator's own key (keys/operator-keys.ts), which the API checks (http/operator.ts). It runs on an operator's own
 * machine, needs no .env, and says each answer's request ID and the instance that answered. Each command is one
 * operator route; this is the table of them, and features/operator/cli/cli.ts runs it.
 */
import { core, runCli, type CliCommand } from './features/operator/cli/cli';
import { callsAndNotes } from './features/operator/cli/calls';
import { checks } from './features/operator/cli/checks';
import { diagnostics } from './features/operator/cli/diagnostics';
import { support } from './features/operator/cli/support';

const COMMANDS: CliCommand[] = [...core, ...diagnostics, ...checks, ...support, ...callsAndNotes];

process.exitCode = await runCli(process.argv.slice(2), COMMANDS);
