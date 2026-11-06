# Contract ownership

Read root rules and `docs/engineering/folder-ownership.md`.

- This package owns schemas, inferred types, wire shapes, shared document protocol shapes and API interfaces.
  It never imports apps, browser HTTP implementations or UI. Feature schemas and feature interfaces live in their
  owning directories; `client.ts` aggregates the feature interfaces, and `errors.ts` owns shared errors.
- Preserve the deliberate public `@alcove/api` surface and `@alcove/api/retire` subpath. Internal files import the
  owning file directly; no folder barrels, forwarding old paths or wildcard internal export trees.
- New fields on stored schemas follow the root stored-data rules. A source move leaves declarations, defaults,
  refinements, discriminators, record kinds and key labels unchanged. Avoid runtime schema import cycles.
- Any real contract change updates server, client and existing app consumers together; a folder refactor changes
  no wire or stored shapes. Run typing/structure and real API/client integration checks.

- Agent scopes, grants, OAuth and tool schemas belong in `src/agents`; Google sign-in wire shapes belong in `src/identity`.
