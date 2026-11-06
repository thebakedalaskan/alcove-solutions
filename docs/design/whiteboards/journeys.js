/*
 * Every journey, step by step. `node` is a moment of the product (scenes.js), `hot` what to press next, `did` how you
 * got here, `see` what happens, `mv` how it moves. `auto` moves on after that many ms; `fx` plays on the way out;
 * `alt` is another thing you can press here.
 */
window.J = {
  call: [
    { id: 'start', name: 'Start a board', eyebrow: 'In the main call', title: 'Start a board', blurb: 'One click opens it for everyone, the way a shared screen does.', steps: [
      { node: 'stage', hot: 'dockBoard', did: 'You’re in the call.', see: 'Board sits next to Share in the dock, because it does the same job: it puts something in front of everyone.', mv: 'Nothing moves until you press.' },
      { node: 'open', hot: 'tplRetro', fx: 'rise', did: 'Click Board, or press O.', see: 'A small menu rises from the button. Blank is one click. Boards your team already has are underneath.', mv: 'Rises 8 px and fades in, 240 ms.' },
      { node: 'b0', hot: 'spot', did: 'Click Retro.', see: 'It opens for everyone and the call carries on. People move to the strip, so you can still see them.', mv: 'The sheet rises through an arch, 560 ms, as tiles glide into the strip, 900 ms.' },
      { node: 'b1', auto: 2600, did: 'Double-click in Went well.', see: 'A sticky appears in that frame’s colour, ready to type. Tab starts the next one.', mv: 'The sticky pops in, 240 ms.' },
      { node: 'b2', auto: 3000, did: 'Press Esc when you’re done.', see: 'Everyone writes at once. Each pointer carries a face and a name, and dots show who’s typing.', mv: 'Stickies pop in as they land, 240 ms. Pointers glide.' },
      { node: 'full', did: 'A few minutes later.', see: 'Nobody installed anything, accepted anything or shared a screen.', mv: 'Nothing moves until someone does.' }
    ] },
    { id: 'together', name: 'Together', eyebrow: 'In the main call', title: 'Work together', blurb: 'The people in the call are how you find your way round the board.', steps: [
      { node: 'fullHot', hot: 'spot', did: 'The board is open.', see: 'Whoever is talking glows, on their tile and on their pointer. You hear Priya and see what Priya means.', mv: 'The glow follows the voice, 240 ms.' },
      { node: 'sel', hot: 'spot', did: 'Click Priya’s sticky.', see: 'A small bar sits above it: colour, size, line, copy, delete. Dots on each side start a line.', mv: 'The bar pops in, 140 ms.' },
      { node: 'draft', hot: 'spot', did: 'Drag from the right-hand dot.', see: 'A line follows your pointer. Drop it on a sticky and it stays attached when either one moves.', mv: 'The line tracks the pointer, with no delay.' },
      { node: 'linked', hot: 'tile:priya', did: 'Drop it on One owner for launch comms.', see: 'Done. Now say Priya has moved off somewhere. You don’t hunt for a pointer: you use their face.', mv: 'The line settles into a clean route, 140 ms.' },
      { node: 'tile', hot: 'followIt', did: 'Click Priya’s tile.', see: 'Go to jumps to where Priya is. Follow keeps you with Priya until you stop.', mv: 'The menu pops in, 140 ms.' },
      { node: 'follow', hot: 'pillAct', did: 'Click Follow Priya.', see: 'A ring in Priya’s colour says this view isn’t your own. Scroll, zoom or press Esc and it stops.', mv: 'The board glides to Priya, 420 ms.' },
      { node: 'free', did: 'Click Stop.', see: 'You’re back where you were. Undo only ever takes back your own changes, never someone else’s.', mv: 'The ring fades, 240 ms.' }
    ] },
    { id: 'screen', name: 'With a screen', eyebrow: 'In the main call', title: 'With a shared screen', blurb: 'The board is one more thing on the stage. Watch Priya’s screen and work on the board at the same time.', steps: [
      { node: 'sc0', hot: 'dockBoard', did: 'Priya is sharing a screen.', see: 'This is the call as it is today: the screen big, and everyone beside it.', mv: 'Nothing moves until you press.' },
      { node: 'sc1', hot: 'tplRetro', fx: 'rise', did: 'Click Board, or press O.', see: 'The same menu. Opening a board doesn’t stop anyone sharing.', mv: 'Rises 8 px and fades in, 240 ms.' },
      { node: 'sc2', hot: 'spot', did: 'Click Retro.', see: 'The board takes the main space. Priya’s screen moves to the top of the column, still live, with everyone under it.', mv: 'The sheet rises, 560 ms, as the screen and tiles glide over, 900 ms.' },
      { node: 'sc3', hot: 'divider', did: 'Everyone starts adding stickies.', see: 'You watch the screen and work on the board at once. Nobody has to choose.', mv: 'Stickies pop in as they land.' },
      { node: 'sc4', hot: 'shareMore', did: 'Drag the line between them.', see: 'It’s the same line as beside any share. More room for the screen, less for the board, and only your view changes.', mv: 'Both sides follow the pointer, with no delay.' },
      { node: 'sc5', hot: 'shareShot', did: 'Click ⋯ on Priya’s screen.', see: 'The share’s usual menu has one new item: Put on the board.', mv: 'The menu pops in, 140 ms.' },
      { node: 'sc6', hot: 'shareTile', did: 'Click Put on the board.', see: 'A picture of this moment lands on the board with its time on it, so people can mark it up while Priya carries on.', mv: 'The picture pops in, 240 ms.' },
      { node: 'sc7', hot: 'btile2', did: 'Click Priya’s screen.', see: 'Need to read it closely? The screen goes big and the board drops to a live tile above the faces.', mv: 'They trade places, 900 ms.' },
      { node: 'sc8', did: 'Click the board.', see: 'You’re back on the board, and Priya’s screen is beside it again.', mv: 'They trade places, 900 ms.' }
    ] },
    { id: 'help', name: 'The call helps', eyebrow: 'In the main call', title: 'Let the call help', blurb: 'A whiteboard that can hear the meeting, without anyone being able to read it.', steps: [
      { node: 'heard0', hot: 'heard', did: 'People talk, with notes on.', see: 'The call picks out ideas worth keeping and says so quietly. Nobody has to stop talking to write them down.', mv: 'The pill rises 10 px, 420 ms, and waits.' },
      { node: 'heard1', hot: 'addAll', did: 'Click 3 ideas from the call.', see: 'Each line says who said it. Add the ones you want. The same confidential compute writes these and the notes.', mv: 'The tray rises, 240 ms.' },
      { node: 'heard2', auto: 2800, did: 'Click Add all three.', see: 'They land in the frames they belong in.', mv: 'Stickies pop in one after another, 90 ms apart.' },
      { node: 'ideas0', hot: 'ctxSort', did: 'Later, drag round a pile of ideas.', see: 'With several stickies selected, the bar offers Sort into themes and Tidy.', mv: 'The bar pops in, 140 ms.' },
      { node: 'ideas1', did: 'Click Sort into themes.', see: 'Alcove reads them in confidential compute, names the themes and moves the stickies. One undo puts it all back.', mv: 'Stickies glide to their groups, 700 ms.' }
    ] },
    { id: 'run', name: 'Timer, votes', eyebrow: 'In the main call', title: 'Timer and votes', blurb: 'What a facilitator needs, in the top corner and nowhere else.', steps: [
      { node: 'full', hot: 'timer', did: 'You want five quiet minutes.', see: 'Timer, Vote and Present are the only tools for running the session.', mv: 'Nothing moves until you press.' },
      { node: 'timer0', hot: 'popGo', did: 'Click Timer.', see: 'Three lengths and Start. No form.', mv: 'The menu pops in, 140 ms.' },
      { node: 'timer1', hot: 'vote', did: 'Click Start.', see: 'One pill at the top of the board, the same for everyone. It chimes softly at the end.', mv: 'The pill drops in, 420 ms.' },
      { node: 'vote0', hot: 'popGo', did: 'Click Vote.', see: 'It votes on the frame you’re looking at. Nobody sees the count until you end it.', mv: 'The board glides to the frame, 420 ms.' },
      { node: 'vote1', hot: 'pillAct', did: 'Click Start the vote, then click a sticky.', see: 'Each click spends a vote and shows a dot only you can see. Click again to take it back.', mv: 'The dot pops in, 140 ms.' },
      { node: 'vote2', did: 'Click End the vote.', see: 'Counts appear for everyone at once. The top three stay bright and the rest step back.', mv: 'Counts pop in together, 240 ms.' }
    ] },
    { id: 'present', name: 'Present', eyebrow: 'In the main call', title: 'Present', blurb: 'A clean view for everyone, and a private one for whoever is presenting.', steps: [
      { node: 'full', hot: 'present', did: 'Time to walk through it.', see: 'Frames become slides, in order. There’s nothing to prepare.', mv: 'Nothing moves until you press.' },
      { node: 'pres1', hot: 'presNext', did: 'Click Present.', see: 'You see exactly what everyone sees, ringed, with the next frame and your own notes beside it.', mv: 'The board glides to the first frame, 420 ms.' },
      { node: 'aud1', hot: 'pillAct', did: 'What Priya sees.', see: 'No tools and no handles, just the frame, and it updates live. Priya can leave whenever Priya likes.', mv: 'Tools fade out, 240 ms.' },
      { node: 'aud2', did: 'Priya clicks Look around.', see: 'Priya has their own view back. Back to Art rejoins in one click, and Art’s view never pulls anyone back.', mv: 'Tools fade in, 240 ms.' }
    ] },
    { id: 'joined', name: 'Joining in', eyebrow: 'In the main call', title: 'When someone else starts it', blurb: 'What Priya sees when Art opens a board.', steps: [
      { node: 'pstage', auto: 2000, fx: 'rise', did: 'You’re in the call, listening to Art.', see: 'Art opens a board.', mv: 'Nothing moves yet.' },
      { node: 'pboard', hot: 'dockBoard', did: 'Art clicks Retro.', see: 'It rises on your stage too, with one line to say what it is. You can add to it straight away.', mv: 'The same rise as Art’s, 560 ms.' },
      { node: 'ptile', hot: 'btile', did: 'Click Board in your dock.', see: 'Only your view changes. The board drops to a live tile and faces get big again.', mv: 'Tiles glide back, 900 ms.' },
      { node: 'pfull', did: 'Click the tile.', see: 'You’re back on the board, where everyone has been working.', mv: 'The sheet rises again, 560 ms.' }
    ] },
    { id: 'saved', name: 'Saved board', eyebrow: 'In the main call', title: 'Open a saved board', blurb: 'Joining a call never opens someone’s private board to everyone. You’re asked first.', steps: [
      { node: 'open2', hot: 'rec0', did: 'Click Board in the dock.', see: 'The team’s recent boards are in the menu. A board attached when the call was scheduled comes first.', mv: 'Rises 8 px and fades in, 240 ms.' },
      { node: 'access', hot: 'letIn', alt: { notThem: 'flowNo' }, fx: 'rise', did: 'Click Onboarding flow.', see: 'Two people here can’t open it. You decide, in the same menu, before anything opens.', mv: 'The question opens in place, 240 ms.' },
      { node: 'flow1', did: 'Click Let them in for this call.', see: 'Everyone can work on it until the call ends. After that, Theo and Sam lose access again.', mv: 'The sheet rises, 560 ms.' }
    ] },
    { id: 'after', name: 'Close it', eyebrow: 'In the main call', title: 'Close it, and after the call', blurb: 'Closing never deletes anything. The board stays, and the notes know what’s on it.', steps: [
      { node: 'full', hot: 'title', did: 'You’re done with the board.', see: 'Everything about the board itself lives under its name.', mv: 'Nothing moves until you press.' },
      { node: 'tmenu', hot: 'popD', did: 'Click the board’s name.', see: 'Whoever opened it, or the organizer, can close it for everyone. Anyone else can just hide it for themselves.', mv: 'The menu pops in, 140 ms.' },
      { node: 'closed', auto: 2600, did: 'Click Close for everyone.', see: 'Faces come back, and one line says where the board went.', mv: 'The sheet sinks, 420 ms, and tiles glide back, 900 ms.' },
      { node: 'note1', hot: 'noteBoard', did: 'The call ends.', see: 'The note has the board in it, and follow-ups taken from the Actions frame. Everyone invited can open it.', mv: 'The note appears as it always does.' },
      { node: 'page1', did: 'Click Open the board.', see: 'It’s the same board on its own page, with no call around it, and people can keep adding. Bring it to the next call in one click.', mv: 'The page fades in, 240 ms.' }
    ] }
  ],
  rooms: [
    { id: 'setup', name: 'Set up rooms', eyebrow: 'In breakout rooms', title: 'Give rooms a board', blurb: 'One new row in the panel the organizer already uses.', steps: [
      { node: 'full', hot: 'dockRooms', did: 'The retro needs smaller groups.', see: 'Breakout rooms open from the same dock button as today.', mv: 'Nothing moves until you press.' },
      { node: 'rs0', hot: 'segEach', alt: { segShared: 'rs2' }, did: 'Click Breakout rooms.', see: 'The panel has one new row: Board. The board you’re on stays open beside it.', mv: 'The panel slides in, 420 ms, and the board makes room.' },
      { node: 'rs1', hot: 'openRooms', fx: 'move', did: 'Click In each room.', see: 'Each room gets its own board. One line says who sees it and what happens to it. Pick what it starts from.', mv: 'The line opens downward, 240 ms.' },
      { node: 'rl0', did: 'Click Open 3 rooms.', see: 'Everyone moves, and every room already has its board open. You stay in the main room and see who is where.', mv: 'The stage changes in 420 ms, as it does today.' }
    ] },
    { id: 'inroom', name: 'In a room', eyebrow: 'In breakout rooms', title: 'Inside a room', blurb: 'What Priya sees: a smaller call, a private board and a clock.', steps: [
      { node: 'ri0', auto: 2200, fx: 'move', did: 'Art opens rooms.', see: 'You’re told where you’re going before you go.', mv: 'The toast rises, 420 ms.' },
      { node: 'ri1', hot: 'seal', did: 'You arrive in Comms.', see: 'The board is open with its frames ready. The pill keeps the room and its time in view. Only Theo is here.', mv: 'The sheet rises, 560 ms.' },
      { node: 'ri2', auto: 3400, did: 'Click Sealed to this room.', see: 'Three plain lines say who can see this board now, and what happens when rooms close.', mv: 'The menu pops in, 140 ms.' },
      { node: 'ri3', auto: 3000, did: 'You and Theo add stickies.', see: 'A message from Art arrives as a toast, so nobody has to leave the board to read it.', mv: 'The toast rises, 420 ms.' },
      { node: 'ri4', hot: 'dockHand', did: 'One minute left.', see: 'The pill turns amber and says what’s coming. Stuck? Raise your hand to ask Art for help.', mv: 'The colour changes, 240 ms.' },
      { node: 'ri5', did: 'Click Raise your hand, and Art joins.', see: 'Art’s tile and pointer appear, and the room is told. Art can only see this board while Art is in this room.', mv: 'The pointer fades in, 240 ms.' }
    ] },
    { id: 'noboard', name: 'Start one in a room', eyebrow: 'In breakout rooms', title: 'Start a board in a room', blurb: 'If the organizer didn’t set one up, it works like the main call, for the room alone.', steps: [
      { node: 'rn0', hot: 'dockBoard', did: 'You’re in Staging with Maya, with no board.', see: 'The same Board button, in the same place.', mv: 'Nothing moves until you press.' },
      { node: 'rn1', hot: 'tplBlank', fx: 'rise', did: 'Click Board.', see: 'The same menu. It says this board is only for this room, and that it comes back when rooms close.', mv: 'Rises 8 px and fades in, 240 ms.' },
      { node: 'rn2', did: 'Click Blank.', see: 'It opens for Maya too, and nobody outside the room can see it, the organizer included, until they join.', mv: 'The sheet rises, 560 ms.' }
    ] },
    { id: 'oversee', name: 'While rooms are open', eyebrow: 'In breakout rooms', title: 'While rooms are open', blurb: 'The organizer sees who is where, and only sees a board by joining its room.', steps: [
      { node: 'rl2', hot: 'join:0', fx: 'move', did: 'You’re the organizer, in the main room.', see: 'Each card says the room is on its board. What’s on it stays sealed to the room, so there’s no preview.', mv: 'Nothing moves until you press.' },
      { node: 'rl1', hot: 'back:0', fx: 'move', did: 'Click Join room on Comms.', see: 'You’re in the room and on its board. Everyone there is told, as they are today.', mv: 'The stage changes in 420 ms.' },
      { node: 'rl2', did: 'Click Back to main room.', see: 'The board goes with the room’s keys. You see the overview again.', mv: 'The stage changes in 420 ms.' }
    ] },
    { id: 'close', name: 'Rooms close', eyebrow: 'In breakout rooms', title: 'When rooms close', blurb: 'Every room’s board comes back to the main room, side by side.', steps: [
      { node: 'rc0', auto: 2400, fx: 'move', did: 'Time’s nearly up.', see: 'The pill counts down the last seconds, the same as the room’s timer.', mv: 'Nothing else moves.' },
      { node: 'rc1', auto: 2600, did: 'Rooms close.', see: 'Everyone’s back in the main room, and each room’s board lands as a frame, named, with who was there.', mv: 'Frames land one by one, 700 ms each, 180 ms apart.' },
      { node: 'rc1b', hot: 'present', did: 'Everyone looks around.', see: 'Now the whole call can see all of it, like the room’s notes. Anyone can move stickies between frames.', mv: 'Pointers glide.' },
      { node: 'rc2', did: 'Click Present.', see: 'Each room’s frame is a slide. The room reports back and the organizer moves on.', mv: 'The board glides to the frame, 420 ms.' }
    ] },
    { id: 'shared', name: 'One board for all', eyebrow: 'In breakout rooms', title: 'One board for every room', blurb: 'For sessions where rooms should see each other work. Everyone is told.', steps: [
      { node: 'rs2', hot: 'openRooms', fx: 'move', did: 'Click Shared in the panel.', see: 'One board, a frame for each room. The line says plainly that everyone can see every frame.', mv: 'The line opens downward, 240 ms.' },
      { node: 'sh0', auto: 3400, did: 'Click Open 3 rooms.', see: 'The organizer stays on the board and can watch all three frames fill up, pointers included.', mv: 'Frames are ready at once.' },
      { node: 'sh1', auto: 3400, did: 'What Priya sees.', see: 'You land on your room’s frame. You hear your room only, and the pill says the board isn’t private.', mv: 'The board glides to the frame, 420 ms.' },
      { node: 'sh2', did: 'Rooms close.', see: 'Nothing has to come back. Everyone is simply on the same board, zoomed out.', mv: 'The board glides out, 420 ms.' }
    ] },
    { id: 'notes', name: 'In the notes', eyebrow: 'In breakout rooms', title: 'In the notes', blurb: 'Each room’s board sits with that room’s own notes.', steps: [
      { node: 'note2', hot: 'nroom:0', did: 'The call ends.', see: 'Every room has its sub-note in the call’s note, and each has its board. Everyone with the notes sees them all.', mv: 'The note appears as it always does.' },
      { node: 'page2', did: 'Click Comms.', see: 'A room’s board is a saved board like any other, and it can be opened in the next call.', mv: 'The page fades in, 240 ms.' }
    ] }
  ],
  phone: [
    { id: 'phone', name: 'Phone', eyebrow: 'On a phone', title: 'On a phone', blurb: 'Look round, add a sticky, follow someone. Drawing stays on bigger screens.', steps: [
      { node: 'ph0', hot: 'phAdd', did: 'You’re in a room on your phone.', see: 'Faces stay on top, and the board fills the rest. Pinch to zoom, drag to look round.', mv: 'The sheet rises, 560 ms.' },
      { node: 'ph1', hot: 'phPut', did: 'Tap +.', see: 'One sticky, a colour and a button. It says where it’s going.', mv: 'The sheet rises from the bottom, 420 ms.' },
      { node: 'ph2', did: 'Tap Add to Support.', see: 'It’s on the board, in Support.', mv: 'The sticky pops in, 240 ms.' }
    ] }
  ]
};
