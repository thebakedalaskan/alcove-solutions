# Call attention and sound

Implements [issue #85](https://github.com/thebakedalaskan/the-privacy-suite/issues/85). The user approved the implementation description in this chat and authorized building, merging and deploying it.

> **Superseded in part (9 Nov 2026, the call fixes).** The Attention button, its panel and side view are gone. Raised hands
> stay, as the dock's button: a raised hand shows on the tile, People lists hands first in the order they went up, and
> whoever hosts lowers one from that person's ⋯ (there's no Lower all). Quiet feedback (Can't hear you, Slow down, Yes, No,
> Need a break, beside your own tile) is replaced by nudges: a word to one person in your room, which only they see, one
> note per kind however many send it within a minute. Statuses (Be right back, Listening only, On my phone) are new, on
> your own tile's ⋯. Waiting to join lives in People, and questions move to Chat. What's below is the original design;
> [user-flows](../../product/user-flows.md) (journeys 6.14 to 6.17, 6.34 and 6.35) and
> [privacy, keys and sessions](../../engineering/privacy-keys-and-sessions.md#attention-during-a-call) say what's built.

## Behavior

- Raised hands have stable request identities and server ordering, survive reconnect/device changes, and remain visible through a persistent queue/count. People lower their own hands; the current authorized host manages requests without clearing a newer raise by mistake.
- Q&A is explicit call data, distinct from chat and private AI questions. Questions have authors, text, creation time, open/answered/dismissed state, per-person votes and a pinned question. One signed-in account or stable guest identity gets one vote. Sorting preserves the reader's place while votes change. Since the call fixes (November 2026) questions are a tab in Chat; one can be asked anonymously, which no response names an author for, the host's included, and whoever asked can take theirs back.
- Questions, their votes/counts, temporary feedback and cues respect room audience permissions on reads and writes. A host must be allowed to read the question they pin; choosing it replaces the room's single pin, including prior pin metadata whose content that host cannot read. Replacing a pin reveals no earlier question and changes nobody's content access. Room content never becomes main-room content on room closure. Hosts only read content their audience permits.
- Feedback offers Can't hear you, Slow down, Yes, No and Need a break. It expires on the server and clears on departure/room change. Tile indicators and an authorized aggregate remain quiet by default.
- Existing admissions UI gains fresh host-only cues, persistent counts and safe resolved/withdrawn/expired behavior. Actual admission retains its existing MLS authority and row-lock checks.
- Shared state exposes a monotonic revision; clients discard stale replies and recover missed nudges. Typed cues have bounded IDs/sequences and audience filtering. Initial/reconnect/room-change synchronization shows outstanding state without replaying audio.
- Original gentle sounds cover successful local microphone transitions, room joins/leaves, hands, questions and host admissions. Existing timer/ringing sounds share the playback foundation. Playback uses the chosen speaker, never the outgoing/recording mix; failure leaves visual UI usable.
- One scheduler prevents overlap, groups bursts, bounds history and drops stale queued playback. Master volume, category switches, previews and a quiet preset are remembered in sealed account preferences or parsed guest-local preferences. Browser-notification permission is independent.
- Persistent controls work during sharing, documents, boards and focus mode; reusable stateless UI belongs in packages/ui. Phone/wide, light/dark, keyboard, screen readers and reduced motion are covered.

## Storage and verification

New content uses sealed records bound to owner and location, additive migrations and physical cleanup. Existing stored shapes gain defaults and retain their old labels/keys. No readable content, request secrets or content-derived identifiers enter SQL names, logs or errors. Real HTTP/client/Postgres/object-store integration flows cover authorization, state, races, voting, reconnects, expiry, upgrades and leakage. Storybook demonstrates states and journeys without assertions; sound/device/accessibility/layout checks are manual. Repository policy guards stay intact.
