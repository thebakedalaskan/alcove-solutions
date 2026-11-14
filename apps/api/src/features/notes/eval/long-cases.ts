/*
 * The notes eval's long meetings: about 45 minutes each, with 15 to 25 expected items, in the cadence of real calls
 * (see the comment above `loose-sync` in cases.ts). The first three are longer versions of short cases; the rest are new.
 * Same format and rules as cases.ts. Some long cases are held back outside the repository (heldout.ts).
 */
import type { EvalCase } from './cases';

export const LONG_CASES: EvalCase[] = [
  {
    id: 'reversed-decision-long',
    checks: "The scanner vendor chosen early is overturned 24 minutes later, and the stocktake day moves too, in a 44-minute call full of fragments, noise and tangents: the notes keep only the final choices and find every follow-up.",
    title: 'Warehouse weekly: scanners and peak',
    kind: 'call',
    organizer: 'Tomás Ibarra',
    invited: ['Jonah Feld', 'Sam Okafor', 'Dana Whitfield'],
    language: 'call',
    writtenIn: 'en',
    gaps: [],
    transcript: `
  [00:02] Tomás Ibarra: Дякую за перегляд!
  [00:21] Tomás Ibarra: Продолжение следует...
  [00:37] Tomás Ibarra: Hello? (unclear)
  [00:41] Jonah Feld: Hey. Hey, yeah, I'm here.
  [00:46] Tomás Ibarra: Hey. Sam's not on yet.
  [00:52] Jonah Feld: No, he messaged, he's on the dock, he'll be like a few minutes.
  [00:56] Tomás Ibarra: Okay. (unclear)
  [01:03] Jonah Feld: Um...
  [01:08] Tomás Ibarra: How was your weekend?
  [01:11] Jonah Feld: Uh, fine. Painted the kid's room. Took the whole weekend, it's like, it's like a green
  [01:17] Jonah Feld: that looked fine on the tin and on the wall it's just... hospital.
  [01:25] Tomás Ibarra: Ha.
  [01:30] Jonah Feld: Like a hospital corridor. She loves it though.
  [01:34] Tomás Ibarra: Well, that's what matters.
  [01:40] Jonah Feld: That's what my wife said. (unclear)
  [01:45] Tomás Ibarra: Ha. (unclear)
  [01:52] Jonah Feld: You?
  [01:56] Tomás Ibarra: Uh, nothing. Football Sunday, we lost again.
  [02:01] Jonah Feld: The kids' one or yours?
  [02:07] Tomás Ibarra: Mine. The kids won. The kids always win.
  [02:11] Jonah Feld: Ha. (unclear)
  [02:18] Tomás Ibarra: My knee is, uh...
  [02:23] Tomás Ibarra: I'm getting too old for it, honestly.
  [02:26] Jonah Feld: Yeah. (unclear)
  [02:35] Tomás Ibarra: Okay, I'll just start, Sam can catch up. Scanners.
  [02:41] Jonah Feld: Yeah.
  [02:49] Tomás Ibarra: We have to pick, the old ones are dying, I had two more go
  [02:54] Tomás Ibarra: on Friday, just like, dead screen. (unclear)
  [02:58] Jonah Feld: Dead dead?
  [03:04] Tomás Ibarra: Dead dead. Won't charge, nothing.
  [03:09] Jonah Feld: So the quotes. Brightline and Coastal. (unclear)
  [03:16] Jonah Feld: Brightline's eighteen hundred a unit, Coastal's twenty-one hundred.
  [03:20] Tomás Ibarra: And we need, what, fourteen? (unclear)
  [03:25] Jonah Feld: Forty. Four zero.
  [03:31] Tomás Ibarra: Forty, yeah. So that's...
  [03:35] Tomás Ibarra: three hundred difference, times forty, that's like, twelve hundred. (unclear)
  [03:35] Jonah Feld: Twelve thousand.
  [03:42] Tomás Ibarra: Twelve thousand. Yeah. Sorry. Twelve grand, that's not nothing.
  [03:47] Jonah Feld: No. Not this year.
  [03:50] Tomás Ibarra: Not this year. (unclear)
  [03:57] Sam Okafor: Hey. Can you hear me? (unclear)
  [04:03] Tomás Ibarra: Yeah, there he is.
  [04:11] Sam Okafor: Sorry, sorry, a driver turned up with no booking, I had to
  [04:16] Sam Okafor: sort that out.
  [04:20] Sam Okafor: He had, like, a whole truck of garden furniture. In November. (unclear)
  [04:26] Jonah Feld: For who?
  [04:31] Sam Okafor: For nobody! Wrong warehouse. He was meant to be in, um, in the other one, by the ring road.
  [04:38] Tomás Ibarra: Ha.
  [04:42] Sam Okafor: He wanted me to sign for it anyway. I was like, mate, no.
  [04:47] Jonah Feld: Ha. (unclear)
  [04:53] Tomás Ibarra: No worries. We're on scanners.
  [04:57] Sam Okafor: Okay. (unclear)
  [05:04] Jonah Feld: So Brightline's the cheap one, and they can deliver in three weeks. Coastal's five.
  [05:09] Sam Okafor: Three weeks is good, that's before peak.
  [05:12] Tomás Ibarra: Yeah, that's... yeah.
  [05:18] Sam Okafor: Do the Brightline ones do the, like, the ring scanner thing?
  [05:26] Jonah Feld: No, they're just the normal handhelds. Gun type.
  [05:31] Sam Okafor: That's fine, the guys hate the rings anyway.
  [05:35] Jonah Feld: And the battery's, they say twelve hours.
  [05:41] Tomás Ibarra: They all say twelve hours.
  [05:46] Jonah Feld: Yeah, true. (unclear)
  [05:53] Sam Okafor: Ha.
  [05:57] Tomás Ibarra: Okay, that's pretty clear then. Let's go with Brightline.
  [06:02] Jonah Feld: Great.
  [06:08] Sam Okafor: Yeah. (unclear)
  [06:12] Tomás Ibarra: Jonah, can you send them the PO tomorrow?
  [06:19] Jonah Feld: Yeah, I'll do it in the morning.
  [06:24] Sam Okafor: Does the Coastal price, uh, does that include the cradles, the charging ones?
  [06:27] Jonah Feld: I don't know actually. I'd have to look.
  [06:33] Tomás Ibarra: Doesn't matter now if it's Brightline, right.
  [06:41] Sam Okafor: Yeah, I guess. (unclear)
  [06:46] Jonah Feld: I'll look anyway, I'm curious. (unclear)
  [06:54] Tomás Ibarra: Um.
  [06:58] Tomás Ibarra: Okay. Sam, anything on the floor?
  [07:04] Sam Okafor: Uh, just the night shift rota, I'll send it round, it's nearly done,
  [07:09] Sam Okafor: I just need to swap two people.
  [07:16] Tomás Ibarra: Okay good.
  [07:20] Sam Okafor: And the Ritchie truck is leaking again. (unclear)
  [07:25] Jonah Feld: Again?
  [07:31] Sam Okafor: Yeah, like a little puddle under it every morning. Hydraulic, I think.
  [07:35] Tomás Ibarra: Is it, is it safe?
  [07:42] Sam Okafor: It's fine, it's just messy. I've put a tray under it. (unclear)
  [07:47] Tomás Ibarra: Okay. Okay.
  [07:50] Jonah Feld: That thing's older than me.
  [07:56] Sam Okafor: Ha.
  [08:04] Sam Okafor: It's older than all of us. (unclear)
  [08:09] Tomás Ibarra: When's it due a service?
  [08:13] Sam Okafor: It was due in September. (unclear)
  [08:19] Tomás Ibarra: September.
  [08:24] Sam Okafor: The service guy cancelled twice.
  [08:31] Jonah Feld: Same guy as the CCTV? (unclear)
  [08:35] Sam Okafor: Different guy. Same energy. (unclear)
  [08:40] Jonah Feld: Ha.
  [08:46] Tomás Ibarra: Okay, just, just keep the tray under it.
  [08:50] Sam Okafor: Yeah. (unclear)
  [08:57] Tomás Ibarra: Um...
  [09:02] Tomás Ibarra: Overtime.
  [09:05] Sam Okafor: Yeah.
  [09:11] Tomás Ibarra: We're way over. Like, finance sent me the thing and it's
  [09:19] Tomás Ibarra: it's bad. So, uh, (unclear)
  [09:24] Jonah Feld: How bad?
  [09:28] Tomás Ibarra: Like, double what we said.
  [09:34] Jonah Feld: Ooh. (unclear)
  [09:39] Tomás Ibarra: So the freezer team keeps their overtime, they're short two people,
  [09:46] Tomás Ibarra: everyone else, no more overtime till the end of the month.
  [09:50] Sam Okafor: Yeah. Yeah, fine.
  [09:55] Jonah Feld: Mm. (unclear)
  [10:01] Sam Okafor: People won't love it. Some of the lads, like, they count on it, they've got
  [10:05] Sam Okafor: Christmas coming. (unclear)
  [10:12] Tomás Ibarra: I know. I know. I'll take the heat.
  [10:17] Sam Okafor: Okay.
  [10:20] Tomás Ibarra: It's not my call either, it's
  [10:26] Tomás Ibarra: it's the numbers.
  [10:34] Jonah Feld: Does that include Sundays? Like, the stocktake, if it's a weekend?
  [10:39] Tomás Ibarra: We'll see. Let's do the stocktake bit in a minute.
  [10:43] Jonah Feld: Okay.
  [10:49] Sam Okafor: Yeah.
  [10:54] Jonah Feld: What am I doing? Sorry, my laptop just... the whole screen went
  [10:59] Jonah Feld: purple. (unclear)
  [11:06] Tomás Ibarra: Purple?
  [11:10] Jonah Feld: Like, everything's purple. Hang on. (unclear)
  [11:15] Sam Okafor: Turn it off and on again, mate.
  [11:21] Jonah Feld: Yeah, yeah.
  [11:45] Jonah Feld: Okay. Okay it's back. It's still a bit purple.
  [11:49] Tomás Ibarra: Ha. Okay.
  [11:56] Sam Okafor: It's the new look. (unclear)
  [12:01] Jonah Feld: Anyway.
  [12:07] Tomás Ibarra: Okay so stocktake.
  [12:10] Tomás Ibarra: We said end of the month, but I think we have to do it before peak,
  [12:16] Tomás Ibarra: properly before.
  [12:24] Sam Okafor: This weekend?
  [12:29] Tomás Ibarra: Yeah. Saturday. Saturday the fourteenth.
  [12:33] Jonah Feld: Saturday's fine for me.
  [12:39] Sam Okafor: Yeah. Saturday. I'll need, like, eight people. (unclear)
  [12:44] Tomás Ibarra: You'll get eight. (unclear)
  [12:51] Tomás Ibarra: Okay so stocktake's Saturday. Okay.
  [12:55] Sam Okafor: Yeah.
  [13:00] Jonah Feld: Um...
  [13:06] Sam Okafor: Do we do the freezer first or last?
  [13:10] Tomás Ibarra: First. Get it over with.
  [13:17] Sam Okafor: Yeah, nobody wants to be in there at four o'clock.
  [13:22] Jonah Feld: Ha.
  [13:26] Jonah Feld: Okay, Kestrel.
  [13:29] Tomás Ibarra: Oh god.
  [13:35] Jonah Feld: Yeah. So the last delivery, eleven pallets came broken. Like,
  [13:43] Jonah Feld: properly broken, the boards just... yeah. (unclear)
  [13:48] Sam Okafor: Two of them I had to restack by hand, it took the whole
  [13:52] Sam Okafor: morning. Like, the whole morning.
  [13:58] Tomás Ibarra: That's the third time.
  [13:58] Jonah Feld: Fourth. (unclear)
  [14:03] Tomás Ibarra: Fourth. Fucking hell.
  [14:10] Sam Okafor: And one of my guys nearly got his foot under one.
  [14:14] Tomás Ibarra: Is he okay?
  [14:19] Sam Okafor: Yeah, he's fine, he jumped. But, like. (unclear)
  [14:25] Tomás Ibarra: Yeah.
  [14:29] Tomás Ibarra: Okay, no, that's it. From now on we just refuse them at the dock,
  [14:36] Tomás Ibarra: any broken pallet, it goes back on the truck.
  [14:41] Sam Okafor: Yeah. Good.
  [14:44] Jonah Feld: Yeah, agreed.
  [14:50] Tomás Ibarra: Jonah, can you chase them, and get a credit for the broken ones?
  [14:58] Jonah Feld: Yeah, I'll chase them, I'll have it done by Friday.
  [15:03] Tomás Ibarra: Okay.
  [15:07] Sam Okafor: I'll tell the dock about the pallets. (unclear)
  [15:13] Tomás Ibarra: Yeah. Thanks.
  [15:18] Jonah Feld: Their account guy is never there though, it's always voicemail.
  [15:25] Tomás Ibarra: Then email him. Put it in writing. (unclear)
  [15:29] Jonah Feld: Yeah. (unclear)
  [15:35] Sam Okafor: Uh...
  [15:40] Sam Okafor: Um, do you know when Kestrel's next one is? (unclear)
  [15:46] Jonah Feld: Saturday, I think. Saturday morning.
  [15:50] Sam Okafor: This Saturday?
  [15:57] Jonah Feld: Yeah. (unclear)
  [16:02] Sam Okafor: Hmm. (unclear)
  [16:05] Tomás Ibarra: Okay.
  [16:09] Tomás Ibarra: Returns.
  [16:15] Sam Okafor: Oh, don't.
  [16:23] Tomás Ibarra: How many are we at?
  [16:28] Sam Okafor: Like...
  [16:32] Sam Okafor: three hundred cartons? Something like that. It's the whole back corner. (unclear)
  [16:38] Jonah Feld: Three hundred?
  [16:43] Sam Okafor: Since October. Nobody has time to open them.
  [16:50] Tomás Ibarra: Okay. Someone should just do a returns day, like a whole day on it,
  [16:54] Tomás Ibarra: once the stocktake's done.
  [16:59] Sam Okafor: Yeah, maybe. If I've got people. (unclear)
  [17:05] Tomás Ibarra: Mm.
  [17:09] Jonah Feld: Half of them are probably just the wrong size, the shoes. (unclear)
  [17:16] Sam Okafor: It's always the shoes.
  [17:21] Jonah Feld: Ha.
  [17:24] Tomás Ibarra: Speaking of which, the Christmas thing. Is anyone doing the Christmas thing?
  [17:30] Sam Okafor: The party?
  [17:38] Tomás Ibarra: The party, yeah. Last year nobody organised it and we ended up in the canteen with, like,
  [17:43] Tomás Ibarra: crisps.
  [17:47] Jonah Feld: It was quite nice, honestly. (unclear)
  [17:53] Sam Okafor: It was not nice. Someone microwaved fish. (unclear)
  [17:58] Jonah Feld: Ha. Okay, that was bad.
  [18:05] Tomás Ibarra: Anyway, I'm not organising it.
  [18:09] Sam Okafor: Don't look at me. (unclear)
  [18:14] Jonah Feld: Uh... (unclear)
  [18:20] Tomás Ibarra: Okay, nobody. Great. That's a problem for December.
  [18:24] Sam Okafor: Ha. (unclear)
  [18:31] Jonah Feld: Mei Lin's lot did a bowling thing. (unclear)
  [18:36] Sam Okafor: Bowling's fun.
  [18:39] Tomás Ibarra: Yeah. Maybe. Anyway. (unclear)
  [18:45] Jonah Feld: Ha.
  [18:49] Tomás Ibarra: Peak. Temps.
  [18:57] Jonah Feld: Yeah.
  [19:02] Tomás Ibarra: So we need six. Six from the first of December. (unclear)
  [19:06] Sam Okafor: Six is tight, honestly. With the freezer short.
  [19:12] Tomás Ibarra: Six is what we've got budget for.
  [19:17] Jonah Feld: Has Dana asked the agency? (unclear)
  [19:24] Tomás Ibarra: Dana's off this week. She's back Monday. (unclear)
  [19:28] Sam Okafor: So we don't know if they can even do six.
  [19:33] Tomás Ibarra: No. We don't. The agency was weird last year, they sent four and then two of them (unclear)
  [19:39] Tomás Ibarra: just didn't come back after the first day.
  [19:43] Jonah Feld: Yeah, I remember. (unclear)
  [19:50] Sam Okafor: One of them went for lunch and just, gone.
  [19:55] Jonah Feld: Ha. Legend.
  [19:58] Tomás Ibarra: I'll ask her Monday when she's back.
  [20:04] Sam Okafor: Okay.
  [20:12] Jonah Feld: You should also ask if they can do, like, people with forklift tickets. (unclear)
  [20:17] Tomás Ibarra: Yeah, maybe. (unclear)
  [20:21] Sam Okafor: That'd help. My guys can't train three people in a week.
  [20:27] Jonah Feld: And the agency's rate went up, didn't it?
  [20:32] Tomás Ibarra: Did it?
  [20:39] Jonah Feld: I think Dana said, like, a pound an hour. Or more. (unclear)
  [20:43] Tomás Ibarra: Then six might be five.
  [20:48] Sam Okafor: Five is... no. (unclear)
  [20:54] Tomás Ibarra: I know. Let's just, let's see what Dana says.
  [20:58] Jonah Feld: Yeah.
  [21:05] Sam Okafor: Um... (unclear)
  [21:10] Tomás Ibarra: Mm. (unclear)
  [21:15] Sam Okafor: Wait, sorry. Go back.
  [21:18] Sam Okafor: Saturday, the Kestrel delivery. That's the same day as the stocktake.
  [21:24] Tomás Ibarra: Oh.
  [21:24] Jonah Feld: Oh, shit, yeah.
  [21:32] Sam Okafor: Like, I can't count the floor and take in twenty pallets at the same time. (unclear)
  [21:37] Tomás Ibarra: No. No.
  [21:41] Jonah Feld: Can we move Kestrel?
  [21:47] Sam Okafor: Not this late, they'll charge us.
  [21:52] Jonah Feld: They charge us for everything. (unclear)
  [21:59] Tomás Ibarra: Then we move the stocktake. Sunday. Sunday the fifteenth.
  [22:03] Sam Okafor: Yeah. Sunday's better anyway, nothing comes in on a Sunday.
  [22:08] Jonah Feld: Sunday's fine. (unclear)
  [22:14] Tomás Ibarra: Okay, Sunday. Not Saturday.
  [22:18] Sam Okafor: Okay. I'll need to pay them Sunday rate though. (unclear)
  [22:25] Tomás Ibarra: Yeah, that's fine, that's not overtime, that's the stocktake.
  [22:30] Sam Okafor: Okay. (unclear)
  [22:34] Tomás Ibarra: Um.
  [22:37] Tomás Ibarra: Uh, the fire inspection.
  [22:43] Sam Okafor: That's the nineteenth, isn't it?
  [22:51] Tomás Ibarra: Yeah, Thursday the nineteenth. (unclear)
  [22:56] Sam Okafor: The extinguishers need doing before, the tags are out of date on like half of them. (unclear)
  [23:00] Tomás Ibarra: Can you book the service for the eighteenth then?
  [23:06] Sam Okafor: Yeah. I'll book them for the eighteenth.
  [23:11] Tomás Ibarra: Okay.
  [23:18] Jonah Feld: Is that the same company as last year?
  [23:22] Sam Okafor: Same lot. (unclear)
  [23:27] Jonah Feld: Okay.
  [23:33] Sam Okafor: And the fire door at the back, the one by the bins, someone keeps propping it open.
  [23:37] Tomás Ibarra: Who?
  [23:44] Sam Okafor: Smokers. (unclear)
  [23:49] Tomás Ibarra: Course. (unclear)
  [23:52] Tomás Ibarra: Just, just put a sign up.
  [23:58] Sam Okafor: There is a sign. (unclear)
  [24:06] Tomás Ibarra: Ha. Okay. Bigger sign.
  [24:11] Jonah Feld: Red sign. (unclear)
  [24:15] Sam Okafor: And the first aid kits, two of them are basically empty. Someone keeps taking the plasters.
  [24:21] Tomás Ibarra: Who takes plasters?
  [24:26] Sam Okafor: Everyone takes plasters. (unclear)
  [24:33] Tomás Ibarra: Okay, just, just refill them, put it on the card.
  [24:37] Sam Okafor: Yeah.
  [24:41] Jonah Feld: Sorry, I've got, my phone's going, it's procurement, one sec.
  [24:46] Tomás Ibarra: Yeah.
  [24:52] Tomás Ibarra: Sam, the CCTV at the gate, is that fixed?
  [24:58] Sam Okafor: No. The guy came, he said it's the cable, he's coming back.
  [25:02] Tomás Ibarra: When?
  [25:09] Sam Okafor: He didn't say. They never say.
  [25:14] Tomás Ibarra: Great. (unclear)
  [25:17] Sam Okafor: Last week someone walked in at night, like, just walked in through the gate.
  [25:23] Tomás Ibarra: What? Who?
  [25:31] Sam Okafor: Some kid. Looking for his dad's van, he said.
  [25:36] Tomás Ibarra: At night?
  [25:40] Sam Okafor: At like eleven. The night lot found him by the bins.
  [25:46] Tomás Ibarra: Jesus. (unclear)
  [25:51] Sam Okafor: Yeah. So the camera would be nice.
  [25:58] Tomás Ibarra: Yeah. (unclear)
  [26:02] Tomás Ibarra: Um... (unclear)
  [26:24] Tomás Ibarra: Sam?
  [26:27] Tomás Ibarra: Sam, you froze.
  [26:36] Tomás Ibarra: Okay, he's gone.
  [26:41] Tomás Ibarra: Um... (unclear)
  [26:47] Tomás Ibarra: I'm just gonna get the Coastal quote, I printed it, it's in the other room.
  [27:34] Tomás Ibarra: Sous-titres réalisés par la communauté d'Amara.org
  [28:12] Tomás Ibarra: Okay.
  [28:23] Sam Okafor: Hello? Sorry, the wifi on the dock is just, it's (unclear)
  [28:27] Sam Okafor: rubbish. Did I miss anything?
  [28:34] Tomás Ibarra: No, I went to get something.
  [28:39] Sam Okafor: Okay. (unclear)
  [28:42] Tomás Ibarra: Jonah's on the phone. (unclear)
  [28:48] Sam Okafor: Okay.
  [29:07] Jonah Feld: Okay. Sorry. Um.
  [29:15] Jonah Feld: Okay so. That was procurement. (unclear)
  [29:20] Jonah Feld: Brightline's scanners aren't certified for the freezer. (unclear)
  [29:24] Tomás Ibarra: What?
  [29:30] Jonah Feld: They fail below minus ten. Like, the screens die, the battery,
  [29:35] Jonah Feld: they're just not rated for it.
  [29:42] Tomás Ibarra: Huh. That's half the warehouse.
  [29:46] Sam Okafor: Coastal's are rated to minus thirty. I checked that last month.
  [29:51] Tomás Ibarra: Are you sure?
  [29:57] Sam Okafor: Yeah, I've got the spec sheet, I looked because of the old ones dying in there.
  [30:01] Jonah Feld: Yeah, procurement said the same. Coastal's are gold rated. (unclear)
  [30:08] Tomás Ibarra: Okay. Then Brightline's out. We go with Coastal, even with the twelve grand.
  [30:13] Jonah Feld: Agreed. No point buying scanners we can't use.
  [30:16] Sam Okafor: Yeah. Yeah.
  [30:22] Tomás Ibarra: God. Okay.
  [30:30] Tomás Ibarra: Good thing you didn't send the PO yet.
  [30:35] Jonah Feld: Yeah, it was tomorrow.
  [30:39] Tomás Ibarra: I'll email Coastal today to accept the quote.
  [30:45] Jonah Feld: And I'll let Brightline know we're passing. Obviously not sending the PO.
  [30:50] Tomás Ibarra: Yeah, no PO.
  [30:57] Sam Okafor: Should we ask Coastal for a discount, though? At forty units?
  [31:01] Tomás Ibarra: Good point, I'll ask when I email them.
  [31:06] Sam Okafor: Okay.
  [31:11] Jonah Feld: And, so, the cradles. I did look, actually.
  [31:17] Tomás Ibarra: Oh yeah?
  [31:21] Jonah Feld: Coastal's price includes the cradles. One per four scanners.
  [31:28] Jonah Feld: And the three-year warranty.
  [31:33] Sam Okafor: Oh, nice.
  [31:36] Tomás Ibarra: So it's not as bad as twelve.
  [31:42] Jonah Feld: No, the Brightline cradles were extra, so it's like... closer to nine? (unclear)
  [31:50] Tomás Ibarra: Okay. That's better.
  [31:55] Sam Okafor: Nine I can live with. (unclear)
  [31:59] Tomás Ibarra: It's not your money. (unclear)
  [32:05] Sam Okafor: Ha.
  [32:10] Sam Okafor: But five weeks.
  [32:15] Tomás Ibarra: Yeah. Five weeks from today is... (unclear)
  [32:22] Tomás Ibarra: thirtieth? (unclear)
  [32:22] Jonah Feld: Seventh. Seventh of December.
  [32:26] Tomás Ibarra: Seventh. Yeah, sorry, thirtieth was four. Seventh.
  [32:31] Sam Okafor: So we're into peak with the old ones. (unclear)
  [32:37] Jonah Feld: A week of peak.
  [32:41] Tomás Ibarra: Yeah. The old ones just stay on till the Coastal ones come. Nothing we can do.
  [32:48] Sam Okafor: Yeah. I'll keep the two dead ones for parts.
  [32:53] Tomás Ibarra: Yeah, good.
  [32:56] Jonah Feld: You should also try the Coastal demo unit in the freezer, like, before the full lot comes.
  [33:02] Tomás Ibarra: Yeah, maybe. (unclear)
  [33:10] Jonah Feld: They offered one.
  [33:15] Tomás Ibarra: Mm.
  [33:20] Sam Okafor: God, I hate the stalker. (unclear)
  [33:24] Jonah Feld: What happened?
  [33:30] Sam Okafor: It crashed again this morning, right in the middle of the, the pick run.
  [33:35] Sam Okafor: Twenty minutes, nobody could scan anything.
  [33:42] Jonah Feld: Is it the stalker or the scanners?
  [33:46] Sam Okafor: It's the stalker. It's always the stalker. (unclear)
  [33:51] Tomás Ibarra: The update was supposed to fix that.
  [33:57] Sam Okafor: The update made it worse. The update, honestly, the update logged everyone out and then
  [34:01] Sam Okafor: half the pickers couldn't get back in because their passwords
  [34:08] Sam Okafor: expired at the same time. Like, who designs that?
  [34:13] Jonah Feld: Ha. (unclear)
  [34:16] Sam Okafor: And then the, the label printer wanted a, a palette jacket. (unclear)
  [34:22] Jonah Feld: A what?
  [34:30] Sam Okafor: I don't know, it said something, I just kicked it.
  [34:35] Jonah Feld: Ha.
  [34:39] Tomás Ibarra: I'll mention it to IT. Again.
  [34:45] Sam Okafor: Again. (unclear)
  [34:50] Jonah Feld: Again. (unclear)
  [34:50] Sam Okafor: Every week.
  [34:57] Tomás Ibarra: Every single week. (unclear)
  [35:03] Jonah Feld: So, um, peak shifts. Are we doing the split like last year? Early and late?
  [35:07] Sam Okafor: I'd rather three shifts. Early, late, and a short middle one for the, for the parents. (unclear)
  [35:12] Tomás Ibarra: A middle one?
  [35:18] Sam Okafor: Like ten till two. The school run people. We lose good people because they can't do six to two.
  [35:22] Jonah Feld: That's actually smart. (unclear)
  [35:29] Tomás Ibarra: Hmm. I need to think about it. How many people would that be?
  [35:34] Sam Okafor: Four? Five? (unclear)
  [35:37] Tomás Ibarra: Let me think about it. Write it up for me, like, a page, and I'll look.
  [35:43] Sam Okafor: Yeah, okay. Maybe. If I get time.
  [35:51] Tomás Ibarra: Okay.
  [35:55] Tomás Ibarra: Okay. Um...
  [36:00] Tomás Ibarra: Dock hours for peak.
  [36:04] Sam Okafor: Yeah.
  [36:10] Tomás Ibarra: I think we open at six instead of seven from December. The carriers keep turning up early anyway.
  [36:15] Sam Okafor: Six. Yeah. Yeah, that's fine, my morning lot are in by six anyway. (unclear)
  [36:22] Jonah Feld: Fine by me.
  [36:26] Tomás Ibarra: Okay. So from the first, dock opens at six.
  [36:31] Jonah Feld: Someone has to tell the suppliers.
  [36:37] Jonah Feld: I'll do it. I'll email them.
  [36:41] Tomás Ibarra: Thanks.
  [36:48] Sam Okafor: And the drivers, the regular ones, I'll just tell them.
  [36:53] Tomás Ibarra: Yeah.
  [36:56] Sam Okafor: Kestrel'll still turn up at nine. (unclear)
  [37:02] Jonah Feld: Ha. Kestrel.
  [37:08] Jonah Feld: Uh...
  [37:16] Tomás Ibarra: The freezer.
  [37:21] Sam Okafor: Yeah.
  [37:25] Tomás Ibarra: The door. So last Tuesday it went up to minus twelve overnight, the seal's
  [37:31] Tomás Ibarra: gone on the big door.
  [37:36] Jonah Feld: Minus twelve. That's, is that bad? (unclear)
  [37:43] Sam Okafor: For ice cream, yeah.
  [37:47] Tomás Ibarra: Nothing was lost, but the insurer wants the logs. The temperature logs.
  [37:52] Jonah Feld: I can do that, they're on the shared drive.
  [37:58] Tomás Ibarra: By Thursday, they said. (unclear)
  [38:02] Jonah Feld: Okay, by Thursday. I'll send them.
  [38:09] Tomás Ibarra: Okay.
  [38:14] Sam Okafor: And the seal itself? (unclear)
  [38:17] Tomás Ibarra: I'll order the new seal. I'll get it ordered by Wednesday.
  [38:23] Sam Okafor: Who pays for it though? The landlord or us?
  [38:31] Tomás Ibarra: I honestly don't know. It's the building's door, but it's our freezer.
  [38:36] Jonah Feld: Last time the landlord paid for the roof thing.
  [38:40] Tomás Ibarra: That was the roof. (unclear)
  [38:46] Sam Okafor: So...
  [38:51] Tomás Ibarra: I'll order it anyway. We'll fight about who pays later.
  [38:58] Sam Okafor: Ha. Okay. (unclear)
  [39:02] Sam Okafor: Oh, hang on, someone's waving at me. Two minutes.
  [39:07] Tomás Ibarra: Yeah, go.
  [39:48] Sam Okafor: Дякую за перегляд!
  [40:21] Jonah Feld: Is he back?
  [40:27] Tomás Ibarra: No.
  [40:31] Jonah Feld: Um... (unclear)
  [40:38] Jonah Feld: Did you see the email about Secret Santa?
  [40:43] Tomás Ibarra: Ten pounds again?
  [40:46] Jonah Feld: Fifteen this year.
  [40:52] Tomás Ibarra: Fifteen. Inflation.
  [41:00] Jonah Feld: Ha. Last year I got a, a candle that smelled like a car. (unclear)
  [41:05] Tomás Ibarra: Like a new car?
  [41:09] Jonah Feld: Like an old car. (unclear)
  [41:15] Tomás Ibarra: Ha.
  [41:29] Sam Okafor: Sorry. Sorry, back. A driver wanted to leave a pallet in the car park.
  [41:34] Tomás Ibarra: In the car park?
  [41:41] Sam Okafor: In the car park. I said no. (unclear)
  [41:45] Tomás Ibarra: Good.
  [41:50] Sam Okafor: People are mad today.
  [41:56] Jonah Feld: It's a Monday. (unclear)
  [42:02] Jonah Feld: Um... (unclear)
  [42:06] Jonah Feld: What am I doing. Okay.
  [42:13] Sam Okafor: Anything else? (unclear)
  [42:18] Tomás Ibarra: Uh, no, I think that's it. Let me just...
  [42:21] Tomás Ibarra: So, recap. I'm emailing Coastal today, and I'll ask about the discount.
  [42:27] Tomás Ibarra: Jonah, you're telling Brightline, chasing Kestrel by Friday,
  [42:35] Tomás Ibarra: the temperature logs by Thursday, and the suppliers about the dock.
  [42:40] Jonah Feld: Yep.
  [42:44] Tomás Ibarra: And, um, the rota, Jonah, you're sending round the...
  [42:50] Sam Okafor: No, that's me. The rota's mine.
  [42:55] Tomás Ibarra: Sorry. Sam, the rota. And the extinguishers. (unclear)
  [43:02] Sam Okafor: Yeah.
  [43:06] Tomás Ibarra: And can you tell the team the stocktake's Sunday now, not Saturday?
  [43:11] Sam Okafor: Yeah, I'll put it in the group chat.
  [43:17] Tomás Ibarra: And I've got the seal and asking Dana about the temps on Monday.
  [43:21] Jonah Feld: Yeah.
  [43:28] Sam Okafor: Okay. (unclear)
  [43:33] Tomás Ibarra: Okay. Thanks guys.
  [43:36] Jonah Feld: Cheers. (unclear)
  [43:42] Sam Okafor: Ciao. Bye-bye.`,
    expect: {
      decisions: [
        { what: "Coastal for the warehouse scanners, not Brightline, because Brightline's fail below minus ten in the freezer section, even at the higher price", at: '30:08' },
        { what: "The stocktake is on Sunday the 15th, moved from Saturday because Kestrel's delivery comes that Saturday", at: '21:59' },
        { what: "No more overtime until the end of the month, except for the freezer team", at: '09:46' },
        { what: "Broken pallets are refused at the dock from now on and go back on the truck", at: '14:29' },
        { what: "The old scanners stay in use until Coastal's arrive (about December 7th)", at: '32:41' },
        { what: "From December 1st the dock opens at six instead of seven", at: '36:26' }
      ],
      questions: [
        { what: "Whether the landlord or Vandelay pays for the freezer door seal", at: '38:31' }
      ],
      actions: [
        { what: "Email Coastal to accept the quote", owner: "Tom\u00e1s Ibarra", due: "today", at: '30:39' },
        { what: "Tell Brightline they are passing", owner: "Jonah Feld", due: null, at: '30:45' },
        { what: "Send round the night shift rota", owner: "Sam Okafor", due: null, at: '07:04' },
        { what: "Chase Kestrel about the broken pallets and get a credit for them", owner: "Jonah Feld", due: "Friday", at: '14:58' },
        { what: "Book the fire extinguisher service for the 18th, before the fire inspection on the 19th", owner: "Sam Okafor", due: null, at: '23:06' },
        { what: "Tell the team the stocktake is Sunday now, not Saturday", owner: "Sam Okafor", due: null, at: '43:11' },
        { what: "Ask Dana whether the agency can supply the six temps", owner: "Tom\u00e1s Ibarra", due: "Monday, or no due date (either is right)", at: '19:58' },
        { what: "Send the freezer temperature logs to the insurer", owner: "Jonah Feld", due: "Thursday", at: '38:02' },
        { what: "Order a new seal for the big freezer door", owner: "Tom\u00e1s Ibarra", due: "Wednesday", at: '38:17' },
        { what: "Email the suppliers about the new dock hours", owner: "Jonah Feld", due: null, at: '36:37' }
      ],
      acceptable: [
        "Brightline chosen first, then dropped for Coastal when procurement said its scanners fail in the freezer",
        "Coastal's price includes the charging cradles (one per four scanners) and a three-year warranty (as a fact, or as a question noted with its answer)",
        "The price gap of about 12,000 for 40 scanners, closer to 9,000 counting the cradles",
        "Coastal's scanners due around December 7th, five weeks out",
        "Ask Coastal for a volume discount (Tom\u00e1s, as its own follow-up or part of emailing Coastal)",
        "Stocktake first set for Saturday the 14th, then moved to Sunday the 15th",
        "Trying Coastal's demo unit in the freezer, a returns day after the stocktake, a three-shift peak pattern written up by Sam, and asking the agency for temps with forklift tickets (each as a suggestion, or a follow-up for whoever it was put to)",
        "Small jobs taken on in passing: Sam telling the dock to refuse broken pallets, telling the regular drivers about the dock hours, keeping the two dead scanners for parts and refilling the first aid kits; Tom\u00e1s raising the warehouse system's crashes with IT",
        "The fire inspection on Thursday the 19th",
        "Problems mentioned: the leaking reach truck, the warehouse system crashing, the broken gate camera, the propped-open fire door, the returns backlog",
        "Counting the freezer first on the stocktake day (as a decision)",
        "Paying the stocktake staff the Sunday rate, which isn't overtime (as a decision)"
      ],
      never: [
        "Brightline as the scanner vendor they settled on",
        "Any follow-up to send Brightline a purchase order, or to accept or order from Brightline",
        "Saturday as the stocktake's final date",
        "Ritchie as a person (the \"Ritchie truck\" is Whisper mishearing \"reach truck\": calling the truck that is fine)",
        "Anything from the Ukrainian, Russian or French lines (thanks for watching, to be continued, Amara.org subtitles)",
        "Coastal's scanners arriving on November 30th",
        "Whether Coastal's price includes the cradles, as an open question",
        "Jonah sending round the night shift rota",
        "A bigger sign for the back fire door, as a decision or follow-up: \"Bigger sign\" was a joke after \"There is a sign\" (the propped-open door as a problem mentioned is fine)",
        "Jonah looking into whether Coastal's price includes the cradles, as a follow-up: Tomás says then that it doesn't matter, and the call answers it later"
      ]
    }
  },
  {
    id: 'paused-gap-long',
    checks: 'A 45-minute warehouse call with notes paused twice for private matters: the notes keep everything said around the pauses and never guess at what was said inside them.',
    title: 'Warehouse lead hiring and holiday rota',
    kind: 'call',
    organizer: 'Priya Raman',
    invited: ['Lukas Brenner', 'Ana Sofía Reyes', 'Tomás Ibarra'],
    language: 'call',
    writtenIn: 'en',
    gaps: [
      { kind: 'paused', at: '05:41', minutes: 4 },
      { kind: 'paused', at: '31:52', minutes: 3 }
    ],
    transcript: `
  [00:02] Priya Raman: Дякую за перегляд!
  [00:19] Priya Raman: Sous-titres réalisés par la communauté d'Amara.org
  [00:41] Ana Sofía Reyes: Hello?
  [00:44] Priya Raman: Hi, hi. Sorry, I was on mute. Classic.
  [00:48] Ana Sofía Reyes: Ha. Is Lukas coming? (unclear)
  [00:51] Priya Raman: He said he's in the warehouse, he'll jump on from his phone.
  [00:56] Ana Sofía Reyes: Okay.
  [01:05] Ana Sofía Reyes: How was your weekend?
  [01:08] Priya Raman: Oh, fine, we went to my sister's, the kids just screamed the whole
  [01:13] Priya Raman: drive. Both ways. (unclear)
  [01:15] Ana Sofía Reyes: Oh no.
  [01:17] Priya Raman: It's fine. It's fine. I have a headache, but it's fine.
  [01:22] Ana Sofía Reyes: Ha.
  [01:29] Priya Raman: Okay, should we wait or... (unclear)
  [01:33] Ana Sofía Reyes: Give him a minute.
  [01:51] Lukas Brenner: Hello? Can you hear me?
  [01:54] Priya Raman: Yes! Hi.
  [01:55] Ana Sofía Reyes: Hey.
  [01:57] Lukas Brenner: Sorry, I'm by the dock, it's loud, there's a truck backing in. (unclear)
  [02:02] Priya Raman: That's fine. Can you go somewhere quieter?
  [02:05] Lukas Brenner: Hang on.
  [02:11] Lukas Brenner: Okay. Better? (unclear)
  [02:13] Priya Raman: Much better.
  [02:16] Priya Raman: Okay so, agenda. The warehouse lead, first,
  [02:20] Priya Raman: then the holiday rota, and then peak stuff. Temps, the stock take,
  [02:25] Priya Raman: the forklift, whatever else. (unclear)
  [02:28] Ana Sofía Reyes: And the packaging.
  [02:30] Priya Raman: And the packaging, yes.
  [02:34] Lukas Brenner: Okay. (unclear)
  [02:38] Priya Raman: So, the lead role.
  [02:41] Lukas Brenner: Yeah, so we're down to two finalists.
  [02:45] Lukas Brenner: Both did the, the floor walk on Thursday, (unclear)
  [02:49] Lukas Brenner: and both were, honestly, both were good.
  [02:53] Priya Raman: Okay.
  [03:00] Priya Raman: Did Tomás meet them? (unclear)
  [03:03] Lukas Brenner: Thomas met one of them, the other one came on his day off.
  [03:08] Priya Raman: Okay.
  [03:12] Lukas Brenner: So, yeah. Uh...
  [03:16] Lukas Brenner: What am I doing. Hang on, I'm trying to find my notes. (unclear)
  [03:24] Ana Sofía Reyes: It's fine.
  [03:31] Lukas Brenner: Okay here. So the thing is it really comes down to the
  [03:35] Lukas Brenner: the money. What they're each asking for. (unclear)
  [03:39] Ana Sofía Reyes: Yeah, um. Before we talk about the candidates' salaries,
  [03:43] Ana Sofía Reyes: can we pause the notes? That shouldn't be written down.
  [03:47] Priya Raman: Yeah. Yeah, good call.
  [03:50] Lukas Brenner: Oh, yeah, good point.
  [03:53] Priya Raman: Hang on, where's the... (unclear)
  [03:58] Priya Raman: The button moved. Why do they always move the button.
  [04:03] Ana Sofía Reyes: It's at the top. The top right.
  [04:07] Priya Raman: Oh. Okay.
  [04:10] Lukas Brenner: Ha. (unclear)
  [04:13] Priya Raman: Actually, wait, one thing before we pause. The, um,
  [04:18] Priya Raman: the start date. Whoever it is, we want them in before the first, right?
  [04:23] Lukas Brenner: Ideally, yeah. Before peak.
  [04:26] Priya Raman: Okay. That's not, that's not secret.
  [04:29] Ana Sofía Reyes: No. That's fine.
  [04:34] Priya Raman: Okay. Um... (unclear)
  [04:41] Lukas Brenner: The truck's leaving, sorry if it's loud again. (unclear)
  [04:47] Priya Raman: It's fine.
  [04:53] Ana Sofía Reyes: Okay. (unclear)
  [05:00] Priya Raman: Right. Pausing.
  [05:04] Lukas Brenner: Yeah.
  [05:21] Priya Raman: Where is... okay, here.
  [05:27] Ana Sofía Reyes: Top right. (unclear)
  [05:33] Priya Raman: Got it. Pausing now.
  [05:44] Priya Raman: Okay, notes are back on.
  [05:47] Priya Raman: So that's settled, and I'll let HR know.
  [05:51] Lukas Brenner: Yeah. Cool. (unclear)
  [05:54] Ana Sofía Reyes: Good. That was easier than I thought.
  [05:58] Priya Raman: Yeah. Um. (unclear)
  [06:03] Lukas Brenner: Should I tell Tomás, or (unclear)
  [06:06] Priya Raman: Wait till HR's done it. Then yes.
  [06:09] Lukas Brenner: Okay.
  [06:14] Priya Raman: Okay. Holiday rota next.
  [06:17] Ana Sofía Reyes: So, I've drafted it. It's in the shared drive, the, um,
  [06:22] Ana Sofía Reyes: the rota folder. (unclear)
  [06:25] Lukas Brenner: Which one, there's like four rota folders.
  [06:28] Ana Sofía Reyes: The one with twenty-six in the name. The new one.
  [06:32] Lukas Brenner: Okay. (unclear)
  [06:37] Ana Sofía Reyes: The only gap is the twenty-sixth. Nobody's on.
  [06:42] Priya Raman: Boxing Day. Of course.
  [06:45] Ana Sofía Reyes: Yeah, everyone put in for it.
  [06:49] Lukas Brenner: Um...
  [06:53] Lukas Brenner: I can take the twenty-sixth if I get the second off instead.
  [06:57] Priya Raman: The second of January?
  [06:59] Lukas Brenner: Yeah. (unclear)
  [07:02] Ana Sofía Reyes: The second's quiet, that's fine.
  [07:05] Priya Raman: That works. Lukas covers the twenty-sixth and has the second off.
  [07:10] Lukas Brenner: Deal.
  [07:13] Ana Sofía Reyes: Okay. I'll update the rota and send it out today.
  [07:17] Priya Raman: Thanks.
  [07:21] Ana Sofía Reyes: Oh, and the, the twenty-fourth is a half day, right? (unclear)
  [07:25] Priya Raman: Yes. Same as last year.
  [07:28] Ana Sofía Reyes: Okay. (unclear)
  [07:33] Lukas Brenner: Is Tomás on nights over Christmas still? (unclear)
  [07:37] Ana Sofía Reyes: He's on nights up to the twenty-third and then off till the twenty-ninth.
  [07:42] Lukas Brenner: Okay good. Good. (unclear)
  [07:48] Priya Raman: Um. Okay. (unclear)
  [07:53] Priya Raman: Peak stuff.
  [07:56] Priya Raman: Lukas, what's, like, the biggest worry.
  [08:00] Lukas Brenner: Honestly? Packaging.
  [08:03] Lukas Brenner: We're at, like, I'd say three weeks of boxes. The medium ones.
  [08:08] Ana Sofía Reyes: Three weeks at normal volume or at peak? (unclear)
  [08:11] Lukas Brenner: Normal. At peak it's, it's less. Two maybe.
  [08:16] Priya Raman: Shit. Okay.
  [08:19] Priya Raman: Is the packaging even arriving before the fifteenth? The new order.
  [08:24] Lukas Brenner: I don't know. They said early December, but they always say that.
  [08:29] Lukas Brenner: I'll check, I've got an email from them somewhere.
  [08:33] Priya Raman: Okay.
  [08:36] Ana Sofía Reyes: We could, um, we could look at another supplier, (unclear)
  [08:40] Ana Sofía Reyes: like the one Rafael uses for the retail side? (unclear)
  [08:44] Lukas Brenner: Maybe. They're more expensive though.
  [08:47] Priya Raman: Let's come back to it. Let's see what the email says first.
  [08:52] Lukas Brenner: Yeah.
  [08:58] Priya Raman: Okay, the stock take.
  [09:01] Ana Sofía Reyes: Yeah. So we need a date.
  [09:05] Ana Sofía Reyes: Usually it's the first weekend in January. (unclear)
  [09:09] Lukas Brenner: Which is, the third, fourth? (unclear)
  [09:12] Ana Sofía Reyes: Saturday the third.
  [09:15] Priya Raman: Can we do it the Saturday? Not the Sunday. Nobody wants a Sunday.
  [09:19] Lukas Brenner: Saturday's fine. (unclear)
  [09:22] Ana Sofía Reyes: Is the counting firm free?
  [09:25] Lukas Brenner: I think so? Tomás deals with them. (unclear)
  [09:29] Priya Raman: Okay, let's just say the third. Stock take on Saturday the third.
  [09:34] Ana Sofía Reyes: Okay. The third. (unclear)
  [09:37] Lukas Brenner: Yeah.
  [09:49] Lukas Brenner: Sorry, someone's waving at me. One sec.
  [09:53] Priya Raman: Sure.
  [10:31] Lukas Brenner: Продолжение следует...
  [10:58] Lukas Brenner: Okay, sorry, sorry. Someone stacked the pallets in front of door two again.
  [11:04] Ana Sofía Reyes: Again?
  [11:06] Lukas Brenner: Every. Single. Day. (unclear)
  [11:09] Priya Raman: Ha.
  [11:12] Lukas Brenner: It's the afternoon guys, I'm telling you. (unclear)
  [11:16] Priya Raman: Okay. Um. Where were we.
  [11:19] Ana Sofía Reyes: Temps. We didn't do temps.
  [11:22] Priya Raman: Temps, yes.
  [11:25] Priya Raman: How many did we have last year? (unclear)
  [11:29] Lukas Brenner: Last year was... five? Six? I don't remember.
  [11:33] Ana Sofía Reyes: I think six. And it wasn't enough.
  [11:37] Lukas Brenner: It wasn't, no. The last week was horrible. (unclear)
  [11:42] Priya Raman: But volume's up this year, right? Like the forecast.
  [11:46] Ana Sofía Reyes: The forecast says plus fifteen percent on last December.
  [11:51] Lukas Brenner: Fifty?
  [11:53] Ana Sofía Reyes: Fifteen. One five.
  [11:55] Lukas Brenner: Oh, okay. Jesus. I was gonna say. (unclear)
  [11:58] Priya Raman: Ha.
  [12:03] Priya Raman: So, eight? (unclear)
  [12:06] Lukas Brenner: Eight would be nice. But the budget.
  [12:10] Ana Sofía Reyes: The budget is, um, I have it here.
  [12:14] Ana Sofía Reyes: Twenty-four thousand for temps for December. (unclear)
  [12:18] Priya Raman: Okay, and what does the agency charge, per person?
  [12:22] Ana Sofía Reyes: Nine fifty a week. Per person. For full time. (unclear)
  [12:27] Priya Raman: So six people, four weeks, that's...
  [12:31] Priya Raman: thirty-eight hundred?
  [12:34] Ana Sofía Reyes: No that's, um,
  [12:36] Lukas Brenner: That's one person for four weeks.
  [12:38] Ana Sofía Reyes: six times four is twenty-four weeks, times nine fifty, (unclear)
  [12:44] Ana Sofía Reyes: twenty-two eight. Twenty-two thousand eight hundred.
  [12:48] Priya Raman: Right. Sorry. Headache. (unclear)
  [12:51] Lukas Brenner: Ha.
  [12:54] Priya Raman: So eight's thirty thousand-ish, we can't.
  [12:58] Ana Sofía Reyes: No. Six fits. Just. (unclear)
  [13:02] Lukas Brenner: Six and then I do overtime with the team, I guess.
  [13:07] Priya Raman: Okay, six temps, four weeks, from the first of December.
  [13:12] Lukas Brenner: Yeah. Fine.
  [13:14] Ana Sofía Reyes: Yeah.
  [13:17] Priya Raman: Ana, can you book them with the agency? Steadfast, is it?
  [13:21] Ana Sofía Reyes: Stead fast, yeah. I'll book them by Friday. (unclear)
  [13:26] Priya Raman: Thank you.
  [13:30] Lukas Brenner: Ask for the same people as last year if they can. Some of them were good. (unclear)
  [13:35] Ana Sofía Reyes: Yeah, I'll try. (unclear)
  [13:39] Lukas Brenner: There was the one guy, Marcus, he was great.
  [13:42] Ana Sofía Reyes: I'll ask.
  [13:47] Priya Raman: Um. Do the temps get the scanner training before they start or on the day?
  [13:52] Lukas Brenner: Last year it was on the day, and it was chaos.
  [13:56] Ana Sofía Reyes: I don't know if the agency does it. I can't remember who did it last time.
  [14:01] Lukas Brenner: It wasn't me. (unclear)
  [14:03] Priya Raman: Hm. Okay. We need to figure that out.
  [14:07] Ana Sofía Reyes: Yeah.
  [14:10] Lukas Brenner: Yeah. (unclear)
  [14:21] Ana Sofía Reyes: Oh. Sorry, my cat's on the keyboard.
  [14:24] Priya Raman: Ha! Hello cat.
  [14:27] Ana Sofía Reyes: She's called Biscuit. She hates meetings. (unclear)
  [14:31] Lukas Brenner: Same, Biscuit. (unclear)
  [14:34] Priya Raman: Ha.
  [14:39] Ana Sofía Reyes: Okay. She's gone.
  [14:45] Priya Raman: Okay, overtime. Lukas, you said overtime.
  [14:49] Lukas Brenner: Yeah. So, if we're six temps, the team will need to do, like, extra shifts.
  [14:54] Lukas Brenner: Last year we did Sundays, and honestly it nearly killed everyone. (unclear)
  [14:59] Ana Sofía Reyes: People were really unhappy about the Sundays.
  [15:03] Priya Raman: Okay, so what instead?
  [15:06] Lukas Brenner: Extra Saturdays. And longer weekdays, like, an extra two hours,
  [15:11] Lukas Brenner: the late shift goes to ten instead of eight.
  [15:15] Priya Raman: Is that legal? Like, the hours.
  [15:18] Ana Sofía Reyes: It's fine if it's voluntary and paid at the overtime rate. I checked last year. (unclear)
  [15:23] Priya Raman: Okay.
  [15:26] Priya Raman: So no Sundays this peak. Saturdays and longer weekday shifts.
  [15:31] Lukas Brenner: Yes. Thank you. The team will be so happy.
  [15:35] Ana Sofía Reyes: Yeah. (unclear)
  [15:39] Priya Raman: Lukas, can you put the overtime sign-up sheet up? On the board?
  [15:43] Lukas Brenner: Yep. I'll do it tomorrow.
  [15:46] Priya Raman: Thanks.
  [15:56] Lukas Brenner: Oh, it's... the sign up sheet, do I do it on the, the board or
  [16:01] Lukas Brenner: on the app thing? The shift app.
  [16:04] Ana Sofía Reyes: Nobody uses the app. (unclear)
  [16:06] Lukas Brenner: Nobody uses the app. Okay. The board. (unclear)
  [16:09] Priya Raman: Ha. The board.
  [16:14] Priya Raman: Okay. The forklift.
  [16:17] Lukas Brenner: Yeah, so, number two is making the noise again. The grinding noise.
  [16:22] Lukas Brenner: The service isn't due until January but I really don't want it dying in the
  [16:27] Lukas Brenner: middle of peak. (unclear)
  [16:30] Priya Raman: No. God, no.
  [16:33] Ana Sofía Reyes: Can we move the service forward?
  [16:36] Lukas Brenner: I think so, they're usually flexible.
  [16:40] Priya Raman: Then let's do that. Bring it forward, before December.
  [16:44] Lukas Brenner: Yeah. Agreed. (unclear)
  [16:47] Lukas Brenner: I'll book the service for the week of the twenty-fourth. (unclear)
  [16:52] Priya Raman: Of November.
  [16:53] Lukas Brenner: Of November, yeah. Before the temps start.
  [16:57] Priya Raman: Perfect.
  [17:01] Ana Sofía Reyes: What's it cost, the service? (unclear)
  [17:04] Lukas Brenner: It's in the contract. It's free. It's just the parts.
  [17:08] Ana Sofía Reyes: Okay.
  [17:13] Lukas Brenner: Okay, also the dock. Door three. (unclear)
  [17:17] Priya Raman: Still broken?
  [17:19] Lukas Brenner: Still broken. It goes up like halfway and then it just stops.
  [17:24] Lukas Brenner: So we're doing everything through one and two, which, at peak, no.
  [17:29] Priya Raman: That's the landlord's, right? Not ours.
  [17:32] Lukas Brenner: Yes. It's the building. (unclear)
  [17:35] Ana Sofía Reyes: I emailed them in October. Twice.
  [17:39] Priya Raman: And?
  [17:41] Ana Sofía Reyes: Nothing. Well, an auto reply.
  [17:44] Priya Raman: Fucking hell.
  [17:47] Lukas Brenner: Ha. Yeah.
  [17:51] Priya Raman: Okay. I'll ring them. I'll call the landlord this week, (unclear)
  [17:56] Priya Raman: someone with an actual phone number.
  [18:00] Ana Sofía Reyes: I'll send you the emails so you have the dates.
  [18:03] Priya Raman: Thanks. (unclear)
  [18:07] Lukas Brenner: But like, will they actually fix it before peak, I don't know.
  [18:12] Priya Raman: I don't know either. Honestly.
  [18:15] Ana Sofía Reyes: Yeah. (unclear)
  [18:21] Lukas Brenner: Um. If they don't, we, uh... (unclear)
  [18:26] Lukas Brenner: I don't know. We cry.
  [18:28] Priya Raman: Ha.
  [18:33] Ana Sofía Reyes: Okay.
  [18:38] Priya Raman: Um... what else. (unclear)
  [18:43] Lukas Brenner: Can you... hello? (unclear)
  [18:47] Priya Raman: Lukas? You froze.
  [18:50] Ana Sofía Reyes: He's frozen.
  [18:54] Priya Raman: Lukas, can you hear us?
  [19:02] Ana Sofía Reyes: I think he's gone.
  [19:06] Priya Raman: The warehouse wifi. It's always the warehouse wifi. (unclear)
  [19:11] Ana Sofía Reyes: Ha. Yeah.
  [19:17] Ana Sofía Reyes: While we wait, um, the Secret Santa. Are we doing it this year?
  [19:22] Priya Raman: Oh God. Yes, I think so? (unclear)
  [19:26] Ana Sofía Reyes: People were asking. Last year it was fifteen.
  [19:30] Priya Raman: Fifteen euros. Yeah, that's fine.
  [19:34] Ana Sofía Reyes: Someone should set it up. The, the names thing.
  [19:38] Priya Raman: Yeah, someone should. (unclear)
  [19:41] Ana Sofía Reyes: Ha. Okay.
  [20:02] Lukas Brenner: Hello? Sorry. Sorry, I dropped. (unclear)
  [20:05] Priya Raman: You're back!
  [20:07] Lukas Brenner: The wifi in here is so bad. I'm by the office now. (unclear)
  [20:12] Priya Raman: Okay. What did you miss... nothing. Secret Santa.
  [20:16] Lukas Brenner: Ha. Okay.
  [20:20] Lukas Brenner: Can you hear me okay now?
  [20:22] Ana Sofía Reyes: Yeah, it's good.
  [20:26] Priya Raman: Okay. Um. So, the packaging. Again. (unclear)
  [20:31] Priya Raman: If we did switch, Ana, the retail supplier, how fast are they?
  [20:35] Ana Sofía Reyes: I don't actually know. I can ask Rafael.
  [20:39] Lukas Brenner: Honestly I'd rather not switch now. (unclear)
  [20:43] Lukas Brenner: New boxes, new sizes, the, the packing stations are all set up for ours,
  [20:48] Lukas Brenner: and if they're a centimetre off the, the void fill's all wrong, and...
  [20:53] Ana Sofía Reyes: Yeah, that's true.
  [20:56] Priya Raman: Changing supplier five weeks before Christmas does sound insane.
  [21:00] Lukas Brenner: It's insane.
  [21:03] Priya Raman: Okay. We stay with ours this year. (unclear)
  [21:06] Ana Sofía Reyes: Okay.
  [21:08] Lukas Brenner: Yeah.
  [21:11] Priya Raman: And we look again in, like, February. (unclear)
  [21:15] Ana Sofía Reyes: Yeah.
  [21:20] Lukas Brenner: I still need to find that email. (unclear)
  [21:23] Priya Raman: Yeah, do.
  [21:34] Priya Raman: Okay, cut off date. For Christmas delivery.
  [21:38] Ana Sofía Reyes: Oh yeah. Last year it was the twentieth and that was too late. (unclear)
  [21:43] Lukas Brenner: Way too late. We had parcels going out on the twenty-third.
  [21:48] Priya Raman: So... the eighteenth? (unclear)
  [21:51] Ana Sofía Reyes: The courier's last guaranteed is the twenty-second. (unclear)
  [21:56] Lukas Brenner: So we need, like, two days to pick and pack the last orders,
  [22:00] Lukas Brenner: and they need two days. So if the cut-off's the eighteenth, that's... (unclear)
  [22:06] Lukas Brenner: that's fine, but it's tight.
  [22:09] Ana Sofía Reyes: Can we not just say the eighteenth? Wait. What day is the eighteenth?
  [22:14] Priya Raman: It's a, um... Thursday.
  [22:17] Ana Sofía Reyes: I'd rather not end it on a Thursday, people order on Friday night.
  [22:21] Priya Raman: We don't have to decide right now.
  [22:24] Ana Sofía Reyes: Okay.
  [22:27] Lukas Brenner: Okay. (unclear)
  [22:39] Lukas Brenner: Oh, I found it. The packaging email. No wait, that's the, (unclear)
  [22:44] Lukas Brenner: that's the pallet guys. Never mind. (unclear)
  [22:47] Priya Raman: Ha.
  [22:52] Priya Raman: Okay. Is there anything about the, the lead role, start date stuff,
  [22:57] Priya Raman: that we need, like, on the floor? Desk, login, that sort of thing?
  [23:01] Lukas Brenner: The login, yeah. And the keys. And the, uh, the safety induction.
  [23:06] Ana Sofía Reyes: I'll do the login and the induction. Once HR's sent the contract.
  [23:11] Priya Raman: Okay, thanks.
  [23:14] Lukas Brenner: I'll sort the keys. I've got the spare set. (unclear)
  [23:18] Priya Raman: Great.
  [23:27] Lukas Brenner: What am I doing... (unclear)
  [23:31] Lukas Brenner: Sorry, I'm still looking for the email, it's...
  [23:35] Lukas Brenner: the search in Outlook is just useless. (unclear)
  [23:39] Ana Sofía Reyes: Search for the supplier name.
  [23:41] Lukas Brenner: I did. It gives me a newsletter from twenty twenty-two.
  [23:45] Priya Raman: Ha!
  [23:48] Ana Sofía Reyes: Outlook. (unclear)
  [23:52] Lukas Brenner: I'll find it, keep going.
  [23:57] Priya Raman: Okay. Um. The induction for the temps.
  [24:01] Priya Raman: That's the scanner thing again. Ana, you didn't remember who did it last year?
  [24:06] Ana Sofía Reyes: No. Maybe it was Mei Lin? But she's in purchasing now. (unclear)
  [24:11] Lukas Brenner: It wasn't Mei Lin. I think it was, um...
  [24:16] Lukas Brenner: No. I don't know. (unclear)
  [24:19] Priya Raman: Okay. It's still open, then.
  [24:22] Ana Sofía Reyes: Yeah.
  [24:33] Ana Sofía Reyes: Oh. Tomás just messaged. On the chat. (unclear)
  [24:36] Priya Raman: What does he say?
  [24:39] Ana Sofía Reyes: He says, um, sorry, let me read it.
  [24:43] Ana Sofía Reyes: "The counting firm can't do the third, they're booked, the earliest they have is the tenth."
  [24:49] Lukas Brenner: The tenth. Saturday the tenth?
  [24:51] Ana Sofía Reyes: Yeah.
  [24:54] Priya Raman: Ugh. Okay. Is that a problem? A week later? (unclear)
  [24:58] Lukas Brenner: Not really. January's dead anyway.
  [25:02] Ana Sofía Reyes: The only thing is the returns. We'll have more returns in by the tenth. (unclear)
  [25:07] Lukas Brenner: We can count the returns separately. Put them in the cage.
  [25:11] Ana Sofía Reyes: Okay. Yeah, that works.
  [25:15] Priya Raman: Okay, so the stock take moves to Saturday the tenth.
  [25:20] Lukas Brenner: The tenth. Yep.
  [25:22] Ana Sofía Reyes: Yeah. (unclear)
  [25:26] Ana Sofía Reyes: And he says he'll do the count sheets. He says, "I'll do the count sheets like last year."
  [25:32] Priya Raman: Great. Tell him thank you.
  [25:35] Ana Sofía Reyes: I'll reply to him now and tell him the tenth's fine. (unclear)
  [25:40] Priya Raman: Thanks.
  [25:51] Priya Raman: Okay. Is there, um... (unclear)
  [25:57] Priya Raman: Oh, the parking. For the temps. Where do they park?
  [26:02] Lukas Brenner: They park on the street like everyone else. (unclear)
  [26:05] Ana Sofía Reyes: Ha.
  [26:07] Priya Raman: Okay, fair. (unclear)
  [26:19] Lukas Brenner: Sorry, I'm still... (unclear)
  [26:24] Lukas Brenner: No. Okay. I'll do it after. (unclear)
  [26:29] Priya Raman: Yeah, do it after.
  [26:35] Priya Raman: Okay, um. The, uh. Heating.
  [26:39] Lukas Brenner: Oh God, the heating.
  [26:41] Ana Sofía Reyes: It's freezing in there. Honestly. (unclear)
  [26:45] Lukas Brenner: The heaters on the floor, two of the four work.
  [26:50] Priya Raman: Can we just buy more? The, the standing ones?
  [26:53] Lukas Brenner: We could. They're like eighty euros each.
  [26:57] Priya Raman: Then get four. Seriously. People can't pack with frozen hands.
  [27:01] Lukas Brenner: Okay, yeah. I'll order four.
  [27:04] Ana Sofía Reyes: The good ones, though, not the ones from last time. (unclear)
  [27:08] Lukas Brenner: Ha. Not the ones that smell like burning, yeah.
  [27:12] Priya Raman: Ha.
  [27:23] Priya Raman: Okay. I think, um...
  [27:28] Priya Raman: What's left. The cut-off, we didn't, we didn't really land it.
  [27:33] Ana Sofía Reyes: No.
  [27:36] Lukas Brenner: Can we do it at the end? I need to think about the pick rates.
  [27:40] Priya Raman: Okay.
  [27:51] Lukas Brenner: Oh, while I think of it. The, the gate code. (unclear)
  [27:55] Lukas Brenner: For the yard. We should change it before the temps start. It's been the same for two years.
  [28:01] Ana Sofía Reyes: Yeah, probably.
  [28:04] Priya Raman: Yeah, sure. (unclear)
  [28:08] Lukas Brenner: Okay. (unclear)
  [28:21] Priya Raman: Sorry, my, my other screen just went black. (unclear)
  [28:25] Ana Sofía Reyes: Oh no.
  [28:27] Priya Raman: It does this. It does this every time I share something. Hang on.
  [28:33] Lukas Brenner: Have you tried turning it off and on.
  [28:35] Priya Raman: Shut up. (unclear)
  [28:37] Lukas Brenner: Ha!
  [28:42] Priya Raman: Okay. It's back. Whatever. (unclear)
  [28:48] Ana Sofía Reyes: Okay.
  [29:01] Ana Sofía Reyes: Did you two do the expenses thing yet? The new tool? (unclear)
  [29:05] Lukas Brenner: Don't. Don't get me started.
  [29:08] Priya Raman: Ha.
  [29:10] Lukas Brenner: It wants a photo of every receipt, and then it, it reads the
  [29:14] Lukas Brenner: date wrong. Every time. It thinks the fuel receipt is from twenty nineteen.
  [29:19] Ana Sofía Reyes: Mine said I bought a sandwich for four hundred euros.
  [29:23] Priya Raman: Four hundred?
  [29:25] Ana Sofía Reyes: Four euros. It lost the comma. (unclear)
  [29:28] Priya Raman: Ha! That's a good sandwich.
  [29:31] Lukas Brenner: Ha.
  [29:35] Ana Sofía Reyes: I had to email finance, and they said, "just retake the photo." (unclear)
  [29:40] Lukas Brenner: Yeah, they say that to everyone.
  [29:44] Priya Raman: I haven't even opened it. I'm scared. (unclear)
  [29:48] Ana Sofía Reyes: Don't. (unclear)
  [30:21] Lukas Brenner: Sorry, I'm just, I'm checking the truck's not at the gate.
  [30:26] Priya Raman: Sure.
  [30:47] Lukas Brenner: No, okay, not yet. (unclear)
  [30:51] Priya Raman: Okay.
  [30:55] Ana Sofía Reyes: Are you going to the, um, the lunch thing? The Christmas lunch.
  [30:59] Lukas Brenner: When is it?
  [31:01] Ana Sofía Reyes: I don't know. That's what I'm asking. Nobody knows. (unclear)
  [31:06] Priya Raman: Ha. I thought someone said the twelfth.
  [31:09] Lukas Brenner: The twelfth is a Friday, the warehouse can't go on a Friday.
  [31:14] Priya Raman: Okay, well, it's not ours to plan, thank God.
  [31:17] Ana Sofía Reyes: Yeah. (unclear)
  [31:19] Lukas Brenner: Uh, there's one more thing, um... (unclear)
  [31:24] Lukas Brenner: It's a, it's a people thing. With one of the team.
  [31:28] Lukas Brenner: It's, um, it's personal stuff, it's not really... (unclear)
  [31:32] Ana Sofía Reyes: Should we pause again?
  [31:35] Lukas Brenner: Yeah. Yeah, I think so. I'd rather it's not written down.
  [31:39] Priya Raman: Okay. Of course.
  [31:42] Priya Raman: Top right. I know where it is now. (unclear)
  [31:45] Ana Sofía Reyes: Ha.
  [31:49] Priya Raman: Okay, pausing.
  [32:01] Priya Raman: Okay. Notes are back on.
  [32:04] Ana Sofía Reyes: Okay. (unclear)
  [32:07] Priya Raman: So, Lukas, you'll have that conversation tomorrow, like we said,
  [32:11] Priya Raman: and I'll keep HR in the loop.
  [32:14] Lukas Brenner: Yeah. Tomorrow morning, before the shift. (unclear)
  [32:18] Priya Raman: Okay. Thank you. And thanks for flagging it.
  [32:22] Lukas Brenner: Yeah. (unclear)
  [32:33] Priya Raman: Okay. Um. (unclear)
  [32:38] Priya Raman: Sorry, I lost my place. Where was I. (unclear)
  [32:43] Ana Sofía Reyes: The cut-off.
  [32:45] Priya Raman: The cut-off, yes. Lukas, the pick rates.
  [32:49] Lukas Brenner: Yeah, so, okay. With six temps and the Saturdays,
  [32:54] Lukas Brenner: we can clear, like, one day's orders in a day. Normally. (unclear)
  [32:58] Lukas Brenner: But the last day before cut-off is always double. Like, double.
  [33:03] Ana Sofía Reyes: Everyone panics on the last day. (unclear)
  [33:06] Lukas Brenner: Yeah. So we need two days after the cut-off to clear it, then the courier needs two.
  [33:12] Priya Raman: So from the twenty-second, back two, back two,
  [33:16] Priya Raman: that's the... seventeenth? No.
  [33:20] Ana Sofía Reyes: Twenty-second minus four is the eighteenth.
  [33:23] Priya Raman: Eighteenth. Yeah. Sorry. (unclear)
  [33:26] Lukas Brenner: But Ana didn't want a Thursday.
  [33:29] Ana Sofía Reyes: I didn't want a Thursday. But, um... (unclear)
  [33:34] Ana Sofía Reyes: What if it's the eighteenth but midnight? Like, end of Thursday.
  [33:38] Lukas Brenner: Midnight's fine. We start picking Friday morning.
  [33:42] Priya Raman: Okay. The cut-off is midnight on the eighteenth.
  [33:46] Ana Sofía Reyes: Yeah, okay. That's good.
  [33:48] Lukas Brenner: Yeah. Fine. (unclear)
  [33:52] Priya Raman: Ana, can you put that on the website and in the order emails?
  [33:57] Ana Sofía Reyes: Yeah. Um, I'll get it up by the end of the week. (unclear)
  [34:01] Priya Raman: Thanks.
  [34:05] Lukas Brenner: And the, the, um, the banner on the homepage. (unclear)
  [34:09] Ana Sofía Reyes: Yeah. That's the same thing, I'll do both.
  [34:12] Lukas Brenner: Okay.
  [34:24] Lukas Brenner: Oh wait, here, I've got it. The packaging. Okay.
  [34:29] Lukas Brenner: Hang on. Let me read it.
  [34:52] Lukas Brenner: Дякую за перегляд!
  [35:21] Lukas Brenner: Okay so, they say, the order ships on the eighth,
  [35:26] Lukas Brenner: and it's with us on the twelfth. Of December.
  [35:30] Priya Raman: Before the fifteenth.
  [35:32] Lukas Brenner: Before the fifteenth. Just. (unclear)
  [35:35] Priya Raman: Oh, thank God.
  [35:38] Ana Sofía Reyes: And we have two weeks of boxes at peak, so that's... (unclear)
  [35:43] Ana Sofía Reyes: we run out around the, like, thirteenth, fourteenth? So it's fine. Barely.
  [35:48] Lukas Brenner: Barely, yeah. I'll keep an eye. (unclear)
  [35:51] Priya Raman: Okay. Good. Good.
  [36:03] Priya Raman: Okay, um, what else is on my list. (unclear)
  [36:09] Priya Raman: The temps' scanner thing we didn't solve, the, uh,
  [36:14] Priya Raman: the landlord I'm doing. (unclear)
  [36:17] Lukas Brenner: The keys I'm doing.
  [36:19] Priya Raman: The keys you're doing. (unclear)
  [36:24] Ana Sofía Reyes: Um. I was gonna say. The, the night shift.
  [36:28] Ana Sofía Reyes: Do we run nights over peak or not? Tomás was asking.
  [36:33] Lukas Brenner: I mean, we did last year.
  [36:36] Priya Raman: Did it help, though? Did nights actually help?
  [36:40] Lukas Brenner: Honestly I don't know. The numbers were weird. (unclear)
  [36:44] Ana Sofía Reyes: Tomás would know.
  [36:46] Priya Raman: Okay, then we ask him. I don't want to decide it without him.
  [36:51] Lukas Brenner: Yeah.
  [36:53] Ana Sofía Reyes: He's back Thursday. (unclear)
  [36:57] Priya Raman: Okay.
  [37:08] Ana Sofía Reyes: Uh, sorry, someone's at the door. One second. (unclear)
  [37:12] Priya Raman: Sure.
  [37:43] Ana Sofía Reyes: Sorry. Parcel. Ha. For once it's for me.
  [37:47] Priya Raman: Ha.
  [37:50] Lukas Brenner: Ha. (unclear)
  [37:56] Priya Raman: Okay, um. Secret Santa. Lukas, you missed it.
  [38:00] Lukas Brenner: Oh no.
  [38:02] Priya Raman: Fifteen euros, same as last year. (unclear)
  [38:05] Lukas Brenner: Fine by me. Who's doing the, the draw?
  [38:09] Ana Sofía Reyes: That's the question. (unclear)
  [38:11] Lukas Brenner: Not me. Last time I did it I gave myself.
  [38:15] Priya Raman: Ha! You gave yourself?
  [38:17] Lukas Brenner: I gave myself. I bought myself socks. (unclear)
  [38:21] Ana Sofía Reyes: Ha!
  [38:24] Priya Raman: Okay. Not Lukas.
  [38:27] Ana Sofía Reyes: I'll ask in the team channel if someone wants to do it.
  [38:31] Priya Raman: Okay. Sure.
  [38:42] Priya Raman: Okay, I think, I think that's most of it.
  [38:46] Priya Raman: Let me, let me just go over it. (unclear)
  [38:50] Lukas Brenner: Yeah.
  [38:53] Priya Raman: So, the lead role's done, I'm telling HR.
  [38:57] Priya Raman: Ana, you're sending the rota today,
  [39:01] Priya Raman: booking the six temps by Friday, and the cut-off on the website.
  [39:06] Ana Sofía Reyes: Yeah. And the login and induction for the, the new lead. (unclear)
  [39:11] Priya Raman: And that, yes.
  [39:14] Priya Raman: Lukas, you're doing the forklift for the, the week of the twenty-fourth,
  [39:19] Priya Raman: the heaters, the sign-up sheet,
  [39:22] Priya Raman: and the stock take on the third with Tomás.
  [39:26] Lukas Brenner: The tenth.
  [39:27] Ana Sofía Reyes: The tenth.
  [39:29] Priya Raman: The tenth! God. Sorry. The tenth. (unclear)
  [39:33] Lukas Brenner: Ha. And the keys.
  [39:35] Priya Raman: And the keys. And your, um, your conversation tomorrow.
  [39:39] Lukas Brenner: Yeah.
  [39:42] Priya Raman: And I'm calling the landlord about door three, and keeping HR posted.
  [39:47] Ana Sofía Reyes: And asking Tomás about nights.
  [39:50] Priya Raman: And asking Tomás about nights when he's back. (unclear)
  [39:54] Lukas Brenner: Okay.
  [39:58] Priya Raman: And the scanner training is still, like, nobody.
  [40:02] Ana Sofía Reyes: Nobody, yeah.
  [40:05] Lukas Brenner: Ask the agency? Maybe they do it now. (unclear)
  [40:08] Ana Sofía Reyes: I can ask when I book. (unclear)
  [40:11] Priya Raman: Okay, yeah, ask them. (unclear)
  [40:27] Lukas Brenner: Oh, and the gate code. Who's changing the gate code?
  [40:31] Priya Raman: Oh, the gate code. Um. (unclear)
  [40:35] Ana Sofía Reyes: I don't know how. Is it a, a thing on the box? (unclear)
  [40:39] Lukas Brenner: There's a, a code to change the code. I don't have it.
  [40:44] Priya Raman: Ha. Of course.
  [40:47] Lukas Brenner: Facilities might.
  [40:50] Priya Raman: Okay. Um. Let's... we'll figure it out. (unclear)
  [40:55] Ana Sofía Reyes: Okay.
  [41:01] Lukas Brenner: Um. (unclear)
  [41:07] Priya Raman: Okay, I think that's it. Anything else? Anyone?
  [41:12] Ana Sofía Reyes: No. I'm good. (unclear)
  [41:15] Lukas Brenner: No. Oh, wait, actually, yeah. The, the first aid kit in the, the packing area,
  [41:21] Lukas Brenner: it's like, empty. There's one plaster. (unclear)
  [41:25] Priya Raman: One plaster?
  [41:27] Lukas Brenner: One plaster. And it's a weird shape. (unclear)
  [41:31] Ana Sofía Reyes: Ha. I'll order a refill. It's on the safety supplier, I have the login.
  [41:36] Priya Raman: Thanks.
  [41:39] Lukas Brenner: Thanks. (unclear)
  [41:45] Priya Raman: Um... (unclear)
  [41:51] Priya Raman: Okay. Okay, I think we're done.
  [41:55] Ana Sofía Reyes: Yeah.
  [41:58] Lukas Brenner: Yeah. Okay, I gotta go back down, the afternoon truck's coming. (unclear)
  [42:03] Priya Raman: Go, go. And move the pallets off door two.
  [42:06] Lukas Brenner: Ha. Every single day. (unclear)
  [42:09] Priya Raman: Thanks both. Really.
  [42:12] Ana Sofía Reyes: Bye! Gracias.
  [42:14] Lukas Brenner: Tschüss. Bye bye. (unclear)
  [42:17] Priya Raman: Bye.`,
    expect: {
      decisions: [
        { what: 'Lukas covers the 26th and has the 2nd of January off', at: '07:05' },
        { what: 'Six temps from the agency, for four weeks from the 1st of December (22,800 of the 24,000 budget)', at: '13:07' },
        { what: 'No Sunday shifts this peak: extra Saturdays and longer weekday shifts instead, overtime voluntary and paid', at: '15:26' },
        { what: 'Bring the service of forklift two forward to before December', at: '16:40' },
        { what: 'Stay with the current packaging supplier this year (look again in February)', at: '21:03' },
        { what: 'The stock take is on Saturday the 10th of January (moved from the 3rd, which the counting firm can\'t do)', at: '25:15' },
        { what: 'The Christmas delivery cut-off is midnight on the 18th of December', at: '33:42' }
      ],
      questions: [],
      actions: [
        { what: 'Let HR know the outcome of the warehouse lead hiring discussion, saying nothing of what it was', owner: 'Priya Raman', due: null, at: '05:47' },
        { what: 'Update the holiday rota and send it out', owner: 'Ana Sofía Reyes', due: 'today', at: '07:13' },
        { what: 'Book the six temps with the agency', owner: 'Ana Sofía Reyes', due: 'Friday', at: '13:21' },
        { what: 'Put up the overtime sign-up sheet on the board', owner: 'Lukas Brenner', due: 'tomorrow', at: '15:43' },
        { what: 'Book the forklift service for the week of the 24th of November', owner: 'Lukas Brenner', due: null, at: '16:47' },
        { what: 'Call the landlord about dock door three', owner: 'Priya Raman', due: 'this week', at: '17:51' },
        { what: 'Set up the new lead\'s login and safety induction once HR has sent the contract', owner: 'Ana Sofía Reyes', due: null, at: '23:06' },
        { what: 'Sort the keys for the new lead', owner: 'Lukas Brenner', due: null, at: '23:14' },
        { what: 'Train the temps on the scanners, before day one or on the day: nobody has it yet', owner: null, due: null, at: '24:19' },
        { what: 'Do the stock take count sheets', owner: 'Tomás Ibarra', due: null, at: '25:26' },
        { what: 'Order four standing heaters for the warehouse floor', owner: 'Lukas Brenner', due: null, at: '27:01' },
        { what: 'Have the conversation agreed while notes were paused, saying nothing of what it is about', owner: 'Lukas Brenner', due: 'tomorrow morning, before the shift', at: '32:14' },
        { what: 'Keep HR in the loop on the matter discussed while notes were paused, saying nothing of what it was', owner: 'Priya Raman', due: null, at: '32:11' },
        { what: 'Put the Christmas cut-off on the website, the homepage banner and the order emails', owner: 'Ana Sofía Reyes', due: 'end of the week', at: '33:57' },
        { what: 'Ask Tomás whether night shifts helped last year, before deciding whether to run them over peak', owner: 'Priya Raman', due: 'Thursday, when he\'s back, or no due date (either is right)', at: '36:46' }
      ],
      acceptable: [
        'Ana replying to Tomás that the 10th is fine (as a follow-up)',
        'Ana asking for last year\'s temps, and asking the agency whether they do the scanner training (as part of booking or a follow-up)',
        'Ana sending Priya the earlier emails to the landlord (as a follow-up)',
        'Ana asking in the team channel who will run the Secret Santa draw, or Secret Santa at 15 euros (as a decision or follow-up)',
        'Ana ordering a first aid kit refill (as a follow-up)',
        'Changing the yard gate code before the temps start (as a suggestion, or a follow-up with no owner)',
        'Ana asking Rafael how fast the retail packaging supplier is (as a suggestion)',
        'The new packaging order arriving on the 12th of December, before the 15th (as a fact or an answered question)',
        'The stock take first set for Saturday the 3rd, then moved to the 10th',
        'The new lead should start before the 1st of December, before peak',
        'The 24th of December is a half day',
        'Lukas keeping an eye on box stock until the packaging arrives (as a follow-up)',
        'Lukas telling Tomás once HR has done it (as a follow-up), saying nothing of who was chosen'
      ],
      never: [
        'Which candidate was chosen, or anything about the candidates or the hire beyond what was said with notes on (two finalists, both good, a start before the 1st wanted, the matter settled, the new lead\'s login, induction and keys)',
        'Any salary figure',
        'Who the second paused matter is about, or what it is (anything beyond Lukas having a conversation tomorrow and HR being kept in the loop)',
        'A guess at what was said while notes were paused: who was chosen, a salary, or what was agreed. Saying what was said just before or after a pause is fine',
        'The stock take on Saturday the 3rd as the final date',
        'Six temps for four weeks costing 3,800',
        'Whether the packaging arrives before the 15th as an open question',
        'A 50 percent rise in volume',
        'Anything from the Ukrainian, Russian or French lines (thanks for watching, to be continued, subtitles by Amara.org)',
        'Where the overtime sign-up sheet goes (the board, not the shift app) as a decision: Lukas asked how to do his follow-up and was answered on the spot. "On the board" in that follow-up is fine',
        'Lukas finding or checking the packaging supplier\'s email, as a follow-up: he finds it later in the call (the order arrives on the 12th)'
      ]
    }
  },
  {
    id: 'loose-sync-long',
    checks: 'A rambling 45-minute launch-week working session (loose-sync, longer): a third person joins and drops off, a decision is reversed, an early question is answered half an hour later, and a long silence fills with Whisper noise; the notes keep only the final versions and the real follow-ups.',
    title: 'Catalogue launch week sync',
    kind: 'call',
    organizer: 'Lukas Brenner',
    invited: ['Mei Lin Zhou', 'Grace Adeyemi'],
    language: 'call',
    writtenIn: 'en',
    gaps: [],
    transcript: `
  [00:03] Mei Lin Zhou: Спасибо за просмотр!
  [00:21] Mei Lin Zhou: Продолжение следует...
  [00:38] Lukas Brenner: Hey.
  [00:40] Mei Lin Zhou: Hey. Can you hear me?
  [00:42] Lukas Brenner: Yeah, yeah.
  [00:45] Mei Lin Zhou: Okay so I went through the photos from the shoot, the ones you flagged, they're all
  [00:51] Mei Lin Zhou: re-edited, they should be up on the staging site. (unclear)
  [00:55] Lukas Brenner: Oh nice. Wait, all of them?
  [00:57] Mei Lin Zhou: All of them except the latex gloves, those were, those were cursed.
  [01:02] Lukas Brenner: Ha. Okay.
  [01:04] Lukas Brenner: Um... (unclear)
  [01:09] Lukas Brenner: So what are you on today, I lost track.
  [01:12] Mei Lin Zhou: Uh, product descriptions, and the... (unclear)
  [01:16] Mei Lin Zhou: the shipping table thing.
  [01:18] Lukas Brenner: Isn't Grace doing shipping? She said something in the chat about shipping.
  [01:22] Mei Lin Zhou: She's doing the checkout, like the pages and the, the flow. (unclear)
  [01:27] Mei Lin Zhou: The actual rates I'm still waiting on from the courier.
  [01:30] Lukas Brenner: Okay but she can't really finish without the rates, right?
  [01:33] Mei Lin Zhou: No, she can. She can just put in placeholder rates and we swap them when they come.
  [01:39] Lukas Brenner: Yeah okay. Yeah, fine, do that.
  [01:42] Mei Lin Zhou: Yeah.
  [01:46] Lukas Brenner: God, this week is... (unclear)
  [01:49] Lukas Brenner: I've been in the warehouse since like six, the forklift guy didn't show up, it's just been a fucking day.
  [01:56] Mei Lin Zhou: Oh no.
  [01:58] Lukas Brenner: Anyway. Anyway.
  [02:01] Lukas Brenner: The descriptions. How far are you?
  [02:04] Mei Lin Zhou: Like... a third? (unclear)
  [02:08] Mei Lin Zhou: Honestly I'm a bit stuck on the tone, like, are we writing for the
  [02:13] Mei Lin Zhou: buyers or the, like, end customers, I don't...
  [02:16] Lukas Brenner: Buyers. It's wholesale. It's always buyers.
  [02:19] Mei Lin Zhou: Okay. Okay buyers.
  [02:22] Lukas Brenner: You could pull from the sales emails, like what they actually ask us about,
  [02:27] Lukas Brenner: pack sizes, lead times, that kind of stuff.
  [02:30] Mei Lin Zhou: Yeah, that's a good idea. (unclear)
  [02:34] Lukas Brenner: Also is it just me or does the staging site keep logging me out?
  [02:38] Mei Lin Zhou: Oh my god, yes. I thought it was my laptop.
  [02:41] Lukas Brenner: No it's every like ten minutes. So annoying.
  [02:45] Mei Lin Zhou: Yeah. (unclear)
  [02:49] Lukas Brenner: Whatever, it's staging.
  [02:55] Mei Lin Zhou: Um. (unclear)
  [02:58] Mei Lin Zhou: We're only shipping inside the EU for launch, right?
  [03:02] Lukas Brenner: Yes.
  [03:03] Mei Lin Zhou: Okay. (unclear)
  [03:09] Lukas Brenner: Okay so it's Monday, we go live Thursday,
  [03:13] Lukas Brenner: so descriptions, shipping, then just fixing stuff. Nothing new goes in.
  [03:18] Mei Lin Zhou: Yeah. Agreed.
  [03:21] Mei Lin Zhou: What time Thursday though? Is it the morning?
  [03:25] Lukas Brenner: It's when the newsletter goes out, so... (unclear)
  [03:29] Lukas Brenner: the newsletter's set for ten UTC.
  [03:33] Mei Lin Zhou: So that's, we're plus one, so nine.
  [03:37] Mei Lin Zhou: No, eleven. Eleven for us.
  [03:40] Lukas Brenner: Eleven, yeah.
  [03:46] Mei Lin Zhou: Yeah. (unclear)
  [03:52] Lukas Brenner: Okay um.
  [03:55] Lukas Brenner: Can you also keep an eye on the inbox on launch day? Like if orders come in weird, (unclear)
  [04:01] Lukas Brenner: it would be really bad if a buyer's order just sat there.
  [04:05] Mei Lin Zhou: Yeah, fair. I can do that.
  [04:09] Mei Lin Zhou: I was also gonna say, the courier's got a business plan, it's like
  [04:14] Mei Lin Zhou: forty a month, but we don't ship anywhere near enough yet. (unclear)
  [04:18] Lukas Brenner: Yeah no, don't pay for it yet. We'll see after launch.
  [04:22] Mei Lin Zhou: Yeah.
  [04:26] Lukas Brenner: How are we on the photo budget, by the way?
  [04:29] Mei Lin Zhou: Um, let me look. (unclear)
  [04:37] Mei Lin Zhou: Uh...
  [04:44] Mei Lin Zhou: Three hundred and ten. Out of the twelve hundred.
  [04:48] Lukas Brenner: That's it? Damn.
  [04:50] Mei Lin Zhou: Yeah, the reshoot was basically free 'cause we did it in the office.
  [04:55] Lukas Brenner: You should try a couple of the other photo studios for the spring range then, see who's best,
  [05:00] Lukas Brenner: if money's not the problem.
  [05:02] Mei Lin Zhou: Yeah, maybe. (unclear)
  [05:05] Mei Lin Zhou: I need to fix my spreadsheet first, I think I added the reshoot twice. (unclear)
  [05:11] Lukas Brenner: Ha. Okay.
  [05:16] Lukas Brenner: Okay um. What else. (unclear)
  [05:20] Lukas Brenner: Oh, the launch code. The discount thing.
  [05:24] Mei Lin Zhou: Right, yeah.
  [05:27] Lukas Brenner: Did we say ten or fifteen? I can't remember what we said.
  [05:32] Mei Lin Zhou: I think you said fifteen in the, in the thing last week.
  [05:36] Lukas Brenner: Fifteen off the first order.
  [05:42] Lukas Brenner: Is that too much? It feels like a lot.
  [05:46] Mei Lin Zhou: I mean on wholesale margins...
  [05:49] Mei Lin Zhou: it's, it's fine for one order. They're gonna reorder at full price.
  [05:54] Lukas Brenner: Yeah. Okay. Fifteen on the first order, let's just do it.
  [05:58] Mei Lin Zhou: Yeah. Fine. (unclear)
  [06:01] Lukas Brenner: Grace has to set that up though.
  [06:04] Mei Lin Zhou: I'll tell her. Or you tell her, she's coming on later, isn't she?
  [06:08] Lukas Brenner: Supposedly. (unclear)
  [06:20] Mei Lin Zhou: Okay, and the other thing for the descriptions,
  [06:24] Mei Lin Zhou: the prices, do I put them with VAT or without?
  [06:28] Lukas Brenner: Uh...
  [06:31] Lukas Brenner: Without? I think without. It's B2B.
  [06:35] Mei Lin Zhou: But some of the small shops, like the, the florists, they're not
  [06:39] Mei Lin Zhou: they're not always VAT registered, so they'd see a price and then
  [06:43] Mei Lin Zhou: get a surprise at checkout.
  [06:46] Lukas Brenner: Hm. Yeah. Fuck. I don't know actually. (unclear)
  [06:51] Lukas Brenner: I'll ask Dana. She'll know, she does all the VAT stuff.
  [06:55] Mei Lin Zhou: Okay. So I leave the price bit empty for now.
  [06:58] Lukas Brenner: Yeah leave it.
  [07:05] Lukas Brenner: I'm texting her now. "Do. We. Show. VAT." (unclear)
  [07:14] Lukas Brenner: She's on holiday I think, so, who knows. (unclear)
  [07:27] Lukas Brenner: Um. What am I doing. (unclear)
  [07:31] Lukas Brenner: Okay sorry, my other screen just went black, hang on.
  [07:44] Lukas Brenner: Okay, no, it's, the cable. This monitor is held together with tape, honestly. (unclear)
  [07:50] Mei Lin Zhou: You should expense a new one.
  [07:53] Lukas Brenner: I've been saying that for a year.
  [08:00] Lukas Brenner: Okay. The catalogue. How many products are actually going in?
  [08:05] Mei Lin Zhou: So the sheet says fifty four. (unclear)
  [08:09] Mei Lin Zhou: But that's with the old ones, the ones we're not reordering.
  [08:13] Lukas Brenner: The discontinued ones.
  [08:15] Mei Lin Zhou: Yeah, there's eight of those.
  [08:18] Lukas Brenner: Do they need to go in? We've got, what, a handful left of each.
  [08:23] Mei Lin Zhou: Some of them we have like two boxes.
  [08:26] Lukas Brenner: Yeah, leave them out. If someone wants them they can email.
  [08:30] Mei Lin Zhou: Okay. Okay so fifty four minus eight is...
  [08:34] Mei Lin Zhou: forty four. (unclear)
  [08:37] Lukas Brenner: Forty six.
  [08:39] Mei Lin Zhou: Forty six. Yes. Sorry. My brain. (unclear)
  [08:47] Mei Lin Zhou: And I've done about... (unclear)
  [08:51] Mei Lin Zhou: fifteen. Fifteen descriptions.
  [08:54] Lukas Brenner: So thirty one to go.
  [08:56] Mei Lin Zhou: Thirty one to go. In three days. (unclear)
  [09:00] Lukas Brenner: You'll be fine. They're short, right? Like a paragraph?
  [09:04] Mei Lin Zhou: Like a paragraph and the, the bullet things. Pack size, case size, lead time.
  [09:12] Mei Lin Zhou: And then they all have to be emerged into the CSV for the import thing.
  [09:17] Lukas Brenner: Into the what?
  [09:19] Mei Lin Zhou: Merged. Merged into the CSV. The import file.
  [09:26] Mei Lin Zhou: Which I hate, because it breaks every time there's a comma in a description.
  [09:31] Lukas Brenner: Just don't use commas.
  [09:33] Mei Lin Zhou: Lukas.
  [09:35] Lukas Brenner: I'm joking. I'm joking. (unclear)
  [09:39] Mei Lin Zhou: It's actually, like, it's the quotes, it's... (unclear)
  [09:43] Mei Lin Zhou: whatever, I'll figure it out.
  [10:05] Lukas Brenner: Sorry, someone's at the door of the, the office.
  [10:09] Lukas Brenner: No, it's fine. It's for upstairs.
  [10:16] Lukas Brenner: The photos. You said they're on staging. All forty six have photos?
  [10:21] Mei Lin Zhou: Most. Some have one, some have three. (unclear)
  [10:25] Mei Lin Zhou: And the gloves have none because, cursed.
  [10:28] Lukas Brenner: Can you just shoot the gloves on your phone? Like on the white table?
  [10:32] Mei Lin Zhou: Yeah, maybe. They're so shiny though. (unclear)
  [10:36] Lukas Brenner: Just do it on a cloudy day. Ha.
  [10:39] Mei Lin Zhou: It's November. Every day's cloudy.
  [10:52] Mei Lin Zhou: Okay so the courier. Carrie still hasn't sent the rates. (unclear)
  [10:57] Lukas Brenner: Did you chase them?
  [10:59] Mei Lin Zhou: Twice. Friday and this morning.
  [11:03] Lukas Brenner: Christ. Okay. (unclear)
  [11:06] Lukas Brenner: Do they at least say when?
  [11:09] Mei Lin Zhou: The guy said "early this week." Which is, like, today's early this week, so.
  [11:15] Lukas Brenner: Yeah. Yeah. Great.
  [11:19] Lukas Brenner: If they don't come by Wednesday we go with the, the public ones from the website.
  [11:24] Mei Lin Zhou: The list prices? Those are way higher.
  [11:27] Lukas Brenner: Higher's fine, we'd rather overcharge shipping a bit than eat it.
  [11:32] Mei Lin Zhou: Okay. Yeah, okay.
  [11:36] Lukas Brenner: What else is on my list. (unclear)
  [11:45] Lukas Brenner: Oh, the UK thing.
  [11:47] Mei Lin Zhou: Oh god. Yes.
  [11:50] Lukas Brenner: So Calder and Moss emailed again. The Leeds people.
  [11:54] Mei Lin Zhou: The ones with the garden centres.
  [11:56] Lukas Brenner: Yeah. They want to order on launch day. And they're, they're, like, our third biggest.
  [12:02] Mei Lin Zhou: But we said EU only.
  [12:04] Lukas Brenner: We did say EU only.
  [12:07] Mei Lin Zhou: So do we just, like, do theirs by hand? Like the old way, an invoice, and Rafael books the pallet?
  [12:13] Lukas Brenner: Maybe. I don't know if customs is a whole thing now.
  [12:17] Mei Lin Zhou: It's a whole thing. It's definitely a whole thing.
  [12:20] Lukas Brenner: Yeah. Ugh. (unclear)
  [12:24] Lukas Brenner: I don't wanna say no to them. But I don't wanna promise something on launch day either.
  [12:31] Lukas Brenner: Let's, let's park it. I need to talk to Rafael, he's the one who knows them.
  [12:40] Lukas Brenner: Is Rafael even in this week?
  [12:43] Mei Lin Zhou: He's at the trade fair till Wednesday, I think. Or Thursday. (unclear)
  [12:47] Lukas Brenner: Course he is.
  [12:58] Mei Lin Zhou: Sorry, I'm just, I'm eating, I haven't had lunch.
  [13:02] Lukas Brenner: No, go for it.
  [13:05] Mei Lin Zhou: It's like three o'clock and I've had a coffee and a, a cracker.
  [13:10] Lukas Brenner: That's launch week.
  [13:16] Lukas Brenner: Did you do anything this weekend at least?
  [13:19] Mei Lin Zhou: I went to my sister's. We did, like, a whole, she made dumplings, like two hundred dumplings.
  [13:26] Lukas Brenner: Two hundred?
  [13:27] Mei Lin Zhou: For six people.
  [13:29] Lukas Brenner: That's a reasonable amount actually.
  [13:36] Lukas Brenner: I was at football all Saturday. The kid's team. They lost eight nil.
  [13:41] Mei Lin Zhou: Oh no.
  [13:43] Lukas Brenner: Eight nil. And the parents on the other side were cheering every single one. Like, mate. They're seven.
  [13:50] Mei Lin Zhou: Ha. That's brutal.
  [13:53] Lukas Brenner: It was brutal. He didn't care though. He got a juice box.
  [13:58] Mei Lin Zhou: That's the right attitude.
  [14:01] Lukas Brenner: Yeah. Anyway. (unclear)
  [14:12] Lukas Brenner: The newsletter. Who's writing the newsletter, is that, was that me?
  [14:16] Mei Lin Zhou: I think that was you. (unclear)
  [14:19] Lukas Brenner: Yeah. I think it was me.
  [14:22] Mei Lin Zhou: It goes to how many people?
  [14:24] Lukas Brenner: Eighteen hundred. (unclear)
  [14:27] Mei Lin Zhou: Eighteen hundred? I thought it was like eight hundred.
  [14:30] Lukas Brenner: Eight hundred, sorry, I said eight hundred. Eight hundred buyers. (unclear)
  [14:38] Lukas Brenner: I'll, yeah. I'll come back to it. Let me think about it.
  [14:49] Mei Lin Zhou: Hmm. (unclear)
  [15:04] Lukas Brenner: Okay. Let me just check... (unclear)
  [15:10] Lukas Brenner: Grace said she'd jump on at quarter past. It's quarter past.
  [15:14] Mei Lin Zhou: She's always like five minutes late. (unclear)
  [15:18] Lukas Brenner: She's in the agency thing, I think. (unclear)
  [15:29] Mei Lin Zhou: So, um... (unclear)
  [15:33] Mei Lin Zhou: Actually, the inbox thing on Thursday. Do I have to be in the office for that, or?
  [15:38] Lukas Brenner: No, no, from home is fine. Just, like, have it open.
  [15:42] Mei Lin Zhou: Okay. Good. 'Cause I've got the plumber coming Thursday morning.
  [15:47] Lukas Brenner: The plumber. On launch day.
  [15:49] Mei Lin Zhou: I booked it two months ago! It was the only slot!
  [15:53] Lukas Brenner: Ha. Okay. It's fine.
  [15:57] Mei Lin Zhou: It's the boiler. I've had no hot water for, like, a week and a half.
  [16:02] Lukas Brenner: Oh, that's grim.
  [16:04] Mei Lin Zhou: It's grim. I've been showering at the gym.
  [16:09] Lukas Brenner: That's commitment.
  [16:11] Mei Lin Zhou: Ha. It's not commitment, it's desperation.
  [16:24] Lukas Brenner: Okay um. While we wait. (unclear)
  [16:28] Lukas Brenner: The order confirmation emails. Have you seen what they look like?
  [16:32] Mei Lin Zhou: The default ones? They're awful. They say "Dear customer, your order has been received" in, like, Times New Roman.
  [16:39] Lukas Brenner: Can we change that?
  [16:41] Mei Lin Zhou: That's Grace's thing. But, like, isn't that new stuff?
  [16:45] Lukas Brenner: Hm. (unclear)
  [16:48] Lukas Brenner: It's... it's polish. It's just words.
  [16:51] Mei Lin Zhou: It's words and a template. (unclear)
  [16:55] Lukas Brenner: Let's ask her. If it's an hour, fine. If it's a day, no.
  [16:59] Mei Lin Zhou: Okay. Yeah.
  [17:05] Mei Lin Zhou: Hmm. (unclear)
  [17:22] Lukas Brenner: Okay I'm gonna message her. (unclear)
  [17:30] Lukas Brenner: "Are. You. Coming." (unclear)
  [17:41] Mei Lin Zhou: Um, while, while she, I was gonna say, the gloves,
  [17:45] Mei Lin Zhou: if I shoot them on the phone they'll look different to the rest. Like the light.
  [17:50] Lukas Brenner: Honestly nobody's gonna notice. They're gloves.
  [17:53] Mei Lin Zhou: I'll notice. (unclear)
  [17:55] Lukas Brenner: Ha. Okay, then do them properly after launch. Phone for now.
  [17:59] Mei Lin Zhou: Yeah, okay. Phone for now. (unclear)
  [18:21] Lukas Brenner: She's typing. (unclear)
  [18:26] Lukas Brenner: "Two mins." Okay.
  [18:41] Grace Adeyemi: Hello? (unclear)
  [18:44] Lukas Brenner: Oh hey, Grace.
  [18:46] Grace Adeyemi: Can you hear me? I'm on my phone, I'm walking. (unclear)
  [18:50] Mei Lin Zhou: Yeah we can hear you.
  [18:52] Grace Adeyemi: Okay, sorry, the agency call ran over, they always run over.
  [18:57] Lukas Brenner: No worries. So we were, um... (unclear)
  [19:01] Lukas Brenner: Grace? You froze.
  [19:06] Mei Lin Zhou: She's frozen. (unclear)
  [19:09] Lukas Brenner: Grace? (unclear)
  [19:22] Grace Adeyemi: ...sorry, I'm back, I'm at my desk now. Did I miss anything?
  [19:27] Lukas Brenner: No, nothing. We just said hi.
  [19:32] Lukas Brenner: So, checkout. Where are you.
  [19:35] Grace Adeyemi: So the pages are basically done. The cart, the checkout, the confirmation page.
  [19:41] Grace Adeyemi: I put in fake rates for shipping like Mei Lin said, a flat twelve euros,
  [19:46] Grace Adeyemi: but I want the real ones before Wednesday ideally.
  [19:50] Mei Lin Zhou: Yeah, the courier still hasn't sent them. (unclear)
  [19:54] Mei Lin Zhou: I'll forward them to you the second they come in.
  [19:58] Grace Adeyemi: Perfect. Whatever they send, a spreadsheet, a PDF, I'll deal with it.
  [20:03] Lukas Brenner: And we said, if they're not here by Wednesday we use the list prices off their website.
  [20:08] Grace Adeyemi: Okay. Fine by me. Those are on their site, right?
  [20:11] Mei Lin Zhou: Yeah, there's a PDF. (unclear)
  [20:18] Lukas Brenner: The staging site keeps logging us out, by the way. Is that, is that you?
  [20:23] Grace Adeyemi: Oh, yes. Ha. That's the session thing, it's on ten minutes.
  [20:27] Grace Adeyemi: I put it low for testing. I'll put it back up today.
  [20:33] Lukas Brenner: Yeah please. (unclear)
  [20:38] Lukas Brenner: Okay and the discount. The first order code. We said fifteen percent. (unclear)
  [20:43] Grace Adeyemi: Hmm. Yeah, so... about that. (unclear)
  [20:47] Grace Adeyemi: The checkout plugin can do codes, but it can't do first order only with a percentage.
  [20:53] Grace Adeyemi: It can do first order only with free shipping, or with a fixed amount off.
  [20:58] Lukas Brenner: Why would it do one and not the other.
  [21:01] Grace Adeyemi: I have no idea. It's a stupid plugin. I could write something custom but it's, like,
  [21:06] Grace Adeyemi: a day? Day and a half? Plus testing.
  [21:09] Mei Lin Zhou: That's new stuff. (unclear)
  [21:11] Lukas Brenner: That's new stuff. Yeah.
  [21:14] Lukas Brenner: Okay so... free shipping or a fixed amount.
  [21:18] Mei Lin Zhou: Free shipping's easier to explain. Like, your first order ships free.
  [21:23] Grace Adeyemi: And on a pallet that's actually worth a lot to them.
  [21:27] Lukas Brenner: Yeah. Yeah, okay. Free shipping on the first order. Forget the fifteen.
  [21:31] Grace Adeyemi: Okay. Free shipping, first order. (unclear)
  [21:37] Lukas Brenner: I'll have to change the newsletter then. It says fifteen in my draft.
  [21:41] Mei Lin Zhou: You have a draft?
  [21:43] Lukas Brenner: I have a, a subject line. (unclear)
  [21:50] Lukas Brenner: Okay, the emails. Mei Lin says the confirmation emails look like a ransom note.
  [21:55] Mei Lin Zhou: I did not say ransom note. (unclear)
  [21:57] Mei Lin Zhou: I said Times New Roman.
  [21:59] Grace Adeyemi: No, they're bad. They're the default ones. (unclear)
  [22:03] Lukas Brenner: Is it a lot to change them? Because if it's a day, no. Nothing new.
  [22:08] Grace Adeyemi: The text is easy. It's, like, twenty minutes. The design I'm not touching.
  [22:13] Lukas Brenner: Just the text is fine.
  [22:15] Grace Adeyemi: Okay, I'll do the text. Can someone write it though? I'm not a, a words person.
  [22:20] Mei Lin Zhou: I can write it. It's like three emails, right?
  [22:23] Grace Adeyemi: Order received, order shipped, and the, the invoice one. (unclear)
  [22:27] Mei Lin Zhou: Okay. I'll send you the words tomorrow. (unclear)
  [22:30] Grace Adeyemi: Great.
  [22:36] Grace Adeyemi: Okay, payments. So we're doing card and invoice, right? Nothing else?
  [22:40] Lukas Brenner: Card and invoice. Yes.
  [22:42] Grace Adeyemi: No PayPal.
  [22:44] Lukas Brenner: God, no PayPal.
  [22:44] Mei Lin Zhou: Ha. (unclear)
  [22:49] Grace Adeyemi: Okay and invoice, like, pay in thirty days, that's for everyone? Because anyone can sign up,
  [22:55] Grace Adeyemi: so some random person makes an account and orders two grand on invoice and never pays.
  [23:00] Lukas Brenner: Oh. Hm. Yeah, no. (unclear)
  [23:03] Mei Lin Zhou: Can it be just the people we already know?
  [23:06] Grace Adeyemi: Yeah, I can turn invoice on per account. So I'd turn it on for the existing ones.
  [23:11] Lukas Brenner: How many is that?
  [23:13] Mei Lin Zhou: Like... sixty? Seventy? Rafael's list has, um... (unclear)
  [23:18] Lukas Brenner: Okay. Yeah. Invoice only for existing accounts. New people pay by card.
  [23:22] Grace Adeyemi: And then, like, they can ask and we turn it on.
  [23:25] Lukas Brenner: Yeah, they email, we look at them, we turn it on.
  [23:31] Grace Adeyemi: I need that list then. (unclear)
  [23:33] Mei Lin Zhou: It's on the drive, I'll send you the link.
  [23:41] Grace Adeyemi: Oh, and the VAT. Do I show prices with or without? (unclear)
  [23:45] Lukas Brenner: Ha. That's the question. I asked Dana. She hasn't answered.
  [23:50] Grace Adeyemi: Okay, I'll leave it on without for now, it's one setting.
  [23:54] Lukas Brenner: Yeah.
  [24:00] Grace Adeyemi: Um. What else did I have. (unclear)
  [24:05] Grace Adeyemi: Oh, the test order. I want you both to do a test order, like a real one, start to finish,
  [24:11] Grace Adeyemi: on your phones and on your laptops. I'll send you a link.
  [24:15] Lukas Brenner: When?
  [24:16] Grace Adeyemi: Tomorrow. I'll send it tomorrow morning. (unclear)
  [24:22] Lukas Brenner: Yeah. And I'm doing my phone thing tonight anyway, so.
  [24:26] Grace Adeyemi: Your what thing?
  [24:28] Lukas Brenner: I'm going through the whole site on my phone tonight. Listing everything that's broken.
  [24:32] Grace Adeyemi: Oh god. Okay. Send it to me, not in the chat, like, in one list.
  [24:37] Lukas Brenner: One list. Yeah.
  [24:43] Grace Adeyemi: And Thursday. Who's, like, watching the site when it goes live?
  [24:47] Lukas Brenner: Mei Lin's on the inbox.
  [24:49] Mei Lin Zhou: From home, with the plumber. (unclear)
  [24:52] Grace Adeyemi: Ha. What?
  [24:53] Mei Lin Zhou: Long story.
  [24:56] Grace Adeyemi: I mean the site. If it falls over. (unclear)
  [24:59] Lukas Brenner: That should be you, right? You're the only one who can fix anything.
  [25:03] Grace Adeyemi: Yeah. Yeah, I'll be on. What time is it going?
  [25:06] Lukas Brenner: Eleven our time. Ten UTC. (unclear)
  [25:09] Grace Adeyemi: So that's ten for me, I'm in London till Friday. (unclear)
  [25:14] Grace Adeyemi: Okay, I'll be online from like nine thirty my time till lunch.
  [25:19] Lukas Brenner: Great. Thanks. (unclear)
  [25:24] Grace Adeyemi: Oh, and the UK people, Calder whatever. Rafael asked me if checkout can do UK.
  [25:29] Lukas Brenner: Ugh. What did you say?
  [25:31] Grace Adeyemi: I said not for launch. It can, technically, but then it's customs and duties and,
  [25:37] Grace Adeyemi: I'm not doing that this week. (unclear)
  [25:39] Lukas Brenner: No. Yeah. Good. We parked it. We don't know yet what we do with them.
  [25:50] Grace Adeyemi: Sorry, someone's... (unclear)
  [25:54] Grace Adeyemi: One sec. (unclear)
  [26:31] Grace Adeyemi: Sorry. Sorry. The agency again. They want to change the banner again.
  [26:36] Lukas Brenner: The banner's done.
  [26:38] Grace Adeyemi: I know the banner's done. I told them the banner's done.
  [26:42] Mei Lin Zhou: What do they want?
  [26:44] Grace Adeyemi: They want the, the green to be "more alive."
  [26:48] Lukas Brenner: More alive.
  [26:49] Grace Adeyemi: More alive.
  [26:49] Mei Lin Zhou: Ha. What does that mean. (unclear)
  [26:53] Grace Adeyemi: It means they want to bill another four hours. (unclear)
  [26:57] Lukas Brenner: Ha. Tell them no. The banner stays. Nothing new.
  [27:05] Lukas Brenner: Honestly that agency. (unclear)
  [27:08] Lukas Brenner: Every invoice from them is like a, a mystery novel.
  [27:11] Grace Adeyemi: Ha. "Consultation, two hours."
  [27:14] Lukas Brenner: Consultation with who? About what?
  [27:17] Mei Lin Zhou: About the green. (unclear)
  [27:19] Grace Adeyemi: About the green being dead. Ha.
  [27:23] Lukas Brenner: Okay. Okay. Anything else for Grace?
  [27:27] Mei Lin Zhou: Um... I don't think so. (unclear)
  [27:31] Grace Adeyemi: Okay. I've got to jump on another one anyway. I'll be in the chat.
  [27:35] Lukas Brenner: Cool. Thanks Grace.
  [27:37] Grace Adeyemi: Ciao ciao. Bye.
  [27:39] Mei Lin Zhou: Bye. (unclear)
  [27:50] Lukas Brenner: That went better than I thought.
  [27:53] Mei Lin Zhou: The discount thing is fine. Free shipping's better honestly.
  [27:57] Lukas Brenner: Yeah, I think so too.
  [28:09] Lukas Brenner: Okay the newsletter. Let me, let me think about the newsletter.
  [28:14] Lukas Brenner: So it's, like, a big photo, three lines, the free shipping, the link.
  [28:20] Mei Lin Zhou: And the, maybe a bit about the new range.
  [28:26] Mei Lin Zhou: Do you want me to send you photos for it? Like the best three?
  [28:30] Lukas Brenner: Yeah, that'd be great. (unclear)
  [28:32] Mei Lin Zhou: Okay. I'll pick three. (unclear)
  [28:37] Lukas Brenner: I'll write it tomorrow. It has to be in the tool by Wednesday night so it can go Thursday morning.
  [28:43] Mei Lin Zhou: Okay. Do you want me to read it?
  [28:46] Lukas Brenner: Yes please. Before Wednesday. (unclear)
  [28:49] Mei Lin Zhou: Okay.
  [28:58] Lukas Brenner: Oh shit, hang on, the delivery guy's here. I have to sign for the pallets.
  [29:03] Lukas Brenner: Two minutes. Don't go anywhere.
  [29:05] Mei Lin Zhou: Yeah, go. (unclear)
  [29:41] Lukas Brenner: Sous-titres réalisés par la communauté d'Amara.org
  [29:52] Mei Lin Zhou: What am I doing... (unclear)
  [30:20] Mei Lin Zhou: Okay. Okay. Comma. (unclear)
  [30:58] Lukas Brenner: Дякую за перегляд!
  [31:34] Mei Lin Zhou: Hmm. (unclear)
  [32:10] Lukas Brenner: Okay, sorry. Sorry. I'm back.
  [32:14] Mei Lin Zhou: All good?
  [32:16] Lukas Brenner: Yeah, it's the shelving for the new racks. Six pallets. Six! He brought six and the note says four.
  [32:23] Mei Lin Zhou: Ha. Free shelving.
  [32:25] Lukas Brenner: It's not free, it'll be on the invoice, trust me.
  [32:33] Lukas Brenner: And no forklift guy, so I'm doing it with the hand truck. (unclear)
  [32:37] Mei Lin Zhou: Oh no.
  [32:39] Lukas Brenner: Whatever. Tomorrow's problem. (unclear)
  [32:45] Lukas Brenner: Oh, and Dana answered. While I was down there.
  [32:49] Mei Lin Zhou: Oh. And?
  [32:51] Lukas Brenner: So, she says, um, let me read it...
  [32:55] Lukas Brenner: "Show them without VAT, it's a trade site, put 'prices exclude VAT' next to every price."
  [33:02] Mei Lin Zhou: Okay. And the florists?
  [33:04] Lukas Brenner: She says the checkout adds it on and shows it before they pay, so it's not a surprise.
  [33:10] Mei Lin Zhou: Okay. Fine. So without VAT, with the little line.
  [33:14] Lukas Brenner: Without VAT. With the line. Done.
  [33:17] Mei Lin Zhou: Okay. I'll put the prices back in the descriptions then.
  [33:21] Lukas Brenner: I'll tell Grace about the line. In the chat. (unclear)
  [33:30] Mei Lin Zhou: Um... (unclear)
  [33:36] Lukas Brenner: Okay. What's left on my list. (unclear)
  [33:41] Lukas Brenner: Samples.
  [33:43] Mei Lin Zhou: Samples. The boxes.
  [33:46] Lukas Brenner: Yeah, so the idea was, we send a box of the new range to the top buyers, launch week,
  [33:52] Lukas Brenner: so they've got it in their hands when the email comes.
  [33:56] Mei Lin Zhou: How many? You said twenty last time.
  [33:59] Lukas Brenner: Did I say twenty?
  [34:01] Mei Lin Zhou: You said twenty. (unclear)
  [34:01] Lukas Brenner: Hm.
  [34:04] Lukas Brenner: What does a box cost us, like, with the stuff and the postage?
  [34:08] Mei Lin Zhou: Uh, the stuff's about thirty, the postage is like... twelve? Fifteen? So forty five a box.
  [34:15] Lukas Brenner: Times twenty is... nine hundred.
  [34:18] Mei Lin Zhou: Nine hundred, yeah.
  [34:20] Lukas Brenner: That's a lot for this month. With the shelving.
  [34:24] Mei Lin Zhou: Ten, then? The top ten are like most of the orders anyway.
  [34:28] Lukas Brenner: Yeah. Ten. Top ten get a box. Four fifty.
  [34:32] Mei Lin Zhou: Okay. (unclear)
  [34:36] Lukas Brenner: Can you pack them? I'll be stuck with the pallets.
  [34:39] Mei Lin Zhou: Yeah. I'll do them Friday, after launch. (unclear)
  [34:43] Lukas Brenner: Friday's fine. As long as they're out this week.
  [34:46] Mei Lin Zhou: And the list is Rafael's top ten? Like by last year?
  [34:50] Lukas Brenner: By last year. It's on his sheet, the second tab.
  [34:54] Mei Lin Zhou: Okay. Calder and Moss are on there though.
  [34:57] Lukas Brenner: Ugh. They're UK.
  [34:59] Mei Lin Zhou: So skip them?
  [35:01] Lukas Brenner: I mean... (unclear)
  [35:04] Lukas Brenner: No, send them one. A box is just post, it's not, like, an order. (unclear)
  [35:09] Mei Lin Zhou: Okay. They get one.
  [35:13] Mei Lin Zhou: Um. (unclear)
  [35:20] Mei Lin Zhou: Okay, can I complain about the CSV for one minute.
  [35:23] Lukas Brenner: Go.
  [35:25] Mei Lin Zhou: So when you put a description in with quotes, like, "the, the classic" in quotes,
  [35:31] Mei Lin Zhou: the import thing just, it eats the rest of the row. Everything after it is gone.
  [35:36] Lukas Brenner: Brilliant.
  [35:38] Mei Lin Zhou: And it doesn't tell you. It just says "import successful." Forty six products imported.
  [35:44] Mei Lin Zhou: And then you look and half of them have no price.
  [35:47] Lukas Brenner: Fucking hell. (unclear)
  [35:50] Mei Lin Zhou: So I've been doing it, like, ten at a time and checking.
  [35:55] Lukas Brenner: Don't use quotes then. Like, really. Just say it without.
  [35:59] Mei Lin Zhou: Yeah, I'm doing that now. It's fine. It's just slow.
  [36:04] Lukas Brenner: Ask Grace, maybe she knows a trick. She's done imports before.
  [36:08] Mei Lin Zhou: Yeah, maybe. (unclear)
  [36:20] Lukas Brenner: Uh... (unclear)
  [36:34] Lukas Brenner: Sorry, I'm just writing all this down 'cause I won't remember. (unclear)
  [36:39] Mei Lin Zhou: Isn't the, the thing doing notes?
  [36:42] Lukas Brenner: Is it? Oh. Yeah. Okay. I'll write it anyway.
  [36:47] Mei Lin Zhou: Ha.
  [36:53] Mei Lin Zhou: Oh, the price list. The PDF one.
  [36:56] Lukas Brenner: What about it.
  [36:58] Mei Lin Zhou: When we go live, do we still send the PDF to people who ask? Like, half the buyers email for the PDF every season.
  [37:05] Lukas Brenner: Hm.
  [37:07] Mei Lin Zhou: Because if we keep the PDF, I have to update it too, with the new prices, and that's,
  [37:12] Mei Lin Zhou: that's another day.
  [37:14] Lukas Brenner: Yeah... (unclear)
  [37:17] Lukas Brenner: I mean, the whole point is they use the site.
  [37:20] Mei Lin Zhou: But some of them won't. The old ones. They'll want the PDF.
  [37:24] Lukas Brenner: Yeah. I don't know. Let me think about it. Not this week anyway.
  [37:28] Mei Lin Zhou: Okay, so I don't do it this week.
  [37:31] Lukas Brenner: No, don't touch it this week.
  [37:36] Mei Lin Zhou: Okay. (unclear)
  [37:42] Mei Lin Zhou: Um, one more for the descriptions. The lead times. (unclear)
  [37:47] Mei Lin Zhou: Where do I get them? The supplier sheet's from, like, March.
  [37:51] Lukas Brenner: They haven't changed. Most is two weeks. Ceramics is...
  [37:56] Lukas Brenner: four. No, six. Six weeks for the ceramics, since the kiln thing.
  [38:01] Mei Lin Zhou: Six for ceramics. Okay. (unclear)
  [38:04] Lukas Brenner: And the planters, the big ones, three.
  [38:07] Mei Lin Zhou: Three weeks for the big planters.
  [38:10] Lukas Brenner: Yeah. Everything else two. (unclear)
  [38:13] Mei Lin Zhou: Okay. That's easy. (unclear)
  [38:19] Lukas Brenner: Oh, my phone. Hang on, it's the agency. The forklift one.
  [38:23] Mei Lin Zhou: Take it. (unclear)
  [38:26] Lukas Brenner: Hello? Yeah. Yeah, hi. (unclear)
  [38:31] Lukas Brenner: Tomorrow? What time? (unclear)
  [38:35] Lukas Brenner: Seven. Okay. Okay, seven. Great. Thanks. Bye. (unclear)
  [38:41] Lukas Brenner: Forklift guy tomorrow at seven. Thank god.
  [38:44] Mei Lin Zhou: Oh nice. So the shelving's fine.
  [38:46] Lukas Brenner: The shelving's fine. (unclear)
  [38:52] Mei Lin Zhou: What happened to the guy today?
  [38:54] Lukas Brenner: They said he was sick. Which, fine, but tell me at five, not at nine.
  [39:03] Lukas Brenner: Anyway. Anyway. (unclear)
  [39:08] Mei Lin Zhou: Is your hot water okay? Ha. Sorry, I'm just, I'm obsessed now.
  [39:13] Lukas Brenner: Ha. Yeah. Mine's fine. Good luck Thursday.
  [39:16] Mei Lin Zhou: Thanks. I'll need it.
  [39:24] Mei Lin Zhou: Um... (unclear)
  [39:31] Lukas Brenner: Okay, so the UK thing, I'm gonna email Rafael tonight, (unclear)
  [39:36] Lukas Brenner: but I'm not gonna hear back till he's back from the fair, so.
  [39:40] Mei Lin Zhou: So we don't tell Calder and Moss anything yet.
  [39:43] Lukas Brenner: I mean, tell them we're on it. Don't say yes, don't say no.
  [39:47] Mei Lin Zhou: Do I tell them? Or you?
  [39:50] Lukas Brenner: I'll do it. I'll reply to them. (unclear)
  [39:53] Mei Lin Zhou: Okay.
  [40:00] Lukas Brenner: Okay. So. The list.
  [40:03] Lukas Brenner: You're on the descriptions, all forty six, with the prices back in and the lead times.
  [40:09] Mei Lin Zhou: Forty six. Yeah.
  [40:11] Lukas Brenner: The inbox Thursday, from home, with the plumber. (unclear)
  [40:15] Mei Lin Zhou: Ha. Yes.
  [40:17] Lukas Brenner: The email words for Grace, tomorrow. The rates to Grace when they come.
  [40:22] Mei Lin Zhou: Yep.
  [40:24] Lukas Brenner: And the sample boxes Friday. Top ten.
  [40:27] Mei Lin Zhou: Top ten. Friday. (unclear)
  [40:31] Lukas Brenner: Grace is on checkout, the login thing, the email text,
  [40:36] Lukas Brenner: and she's sending the test link Friday.
  [40:39] Mei Lin Zhou: Tomorrow. She said tomorrow morning. (unclear)
  [40:42] Lukas Brenner: Tomorrow. Right. Tomorrow. And she's on Thursday morning for the site.
  [40:47] Mei Lin Zhou: Yeah.
  [40:50] Lukas Brenner: And me, phone thing tonight, the list to Grace, the newsletter tomorrow, (unclear)
  [40:56] Lukas Brenner: Rafael and the UK people. And the pallets. God.
  [41:00] Mei Lin Zhou: And Dana's thing, you're telling Grace about the VAT line.
  [41:04] Lukas Brenner: Yes. Right. (unclear)
  [41:08] Mei Lin Zhou: And the PDF we're not doing.
  [41:11] Lukas Brenner: Not this week. I haven't decided about the PDF.
  [41:15] Mei Lin Zhou: Okay. Not this week.
  [41:21] Mei Lin Zhou: Um... (unclear)
  [41:27] Mei Lin Zhou: Oh and the gloves. Phone for now.
  [41:30] Lukas Brenner: Phone for now. Properly after launch. (unclear)
  [41:34] Mei Lin Zhou: Okay.
  [41:41] Lukas Brenner: I feel like I'm forgetting something. (unclear)
  [41:47] Mei Lin Zhou: The courier plan? The forty a month one?
  [41:50] Lukas Brenner: No, we said after launch. Not now. (unclear)
  [41:54] Mei Lin Zhou: Yeah.
  [42:02] Lukas Brenner: Hmm. (unclear)
  [42:10] Lukas Brenner: No. It'll come to me at like three in the morning.
  [42:14] Mei Lin Zhou: Ha. Write it in the chat.
  [42:17] Lukas Brenner: I will. (unclear)
  [42:22] Mei Lin Zhou: Okay, I'm gonna eat the rest of my, my cracker, and do descriptions.
  [42:27] Lukas Brenner: Ha. Eat something real.
  [42:30] Mei Lin Zhou: There's dumplings. Leftover. Like sixty dumplings.
  [42:34] Lukas Brenner: Of course there are.
  [42:37] Mei Lin Zhou: Ha. (unclear)
  [42:44] Lukas Brenner: Oh! That's what it was. The contact page. (unclear)
  [42:48] Lukas Brenner: It's got my mobile on it. My actual mobile.
  [42:51] Mei Lin Zhou: Ha. Do you want buyers calling you at the warehouse?
  [42:54] Lukas Brenner: God no. Put the office number. (unclear)
  [42:58] Mei Lin Zhou: I'll tell Grace. It's in the footer too, I think. (unclear)
  [43:02] Lukas Brenner: Everywhere. Kill it everywhere.
  [43:05] Mei Lin Zhou: Ha. Okay. (unclear)
  [43:12] Lukas Brenner: Okay. I think that's it. I think that's actually it.
  [43:16] Mei Lin Zhou: That's a lot.
  [43:18] Lukas Brenner: It's launch week. (unclear)
  [43:21] Mei Lin Zhou: It's launch week. Ha.
  [43:27] Lukas Brenner: Okay, I'm going back down to the pallets. (unclear)
  [43:31] Mei Lin Zhou: Good luck with the hand truck.
  [43:34] Lukas Brenner: Thanks. Cool. Okay. Bye.
  [43:37] Mei Lin Zhou: Ciao, bye bye.`,
    expect: {
      decisions: [
        { what: 'Grace builds the checkout with placeholder shipping rates, swapped for the real ones when the courier sends them', at: '01:33' },
        { what: 'The product descriptions are written for wholesale buyers', at: '02:16' },
        { what: 'Nothing new goes in before Thursday\'s launch: descriptions, shipping, then fixes', at: '03:13' },
        { what: 'Not paying for the courier\'s business plan yet; look again after launch', at: '04:18' },
        { what: 'The eight discontinued products are left out of the catalogue (46 products go in)', at: '08:26' },
        { what: 'If the courier\'s rates aren\'t in by Wednesday, launch with the courier\'s public list rates', at: '11:19' },
        { what: 'The launch offer is free shipping on a buyer\'s first order (not 15% off, which the checkout plugin can\'t do without custom work)', at: '21:27' },
        { what: 'Paying by invoice only for existing accounts; new buyers pay by card and can ask for invoice', at: '23:18' },
        { what: 'Prices are shown without VAT, with "prices exclude VAT" next to every price (Dana\'s answer)', at: '33:14' },
        { what: 'Sample boxes go to the top ten buyers (not twenty), about 450 in all', at: '34:28' }
      ],
      questions: [
        { what: 'Whether to keep sending (and updating) the PDF price list for buyers who ask for it (not this week either way)', at: '37:24' }
      ],
      actions: [
        { what: 'Watch the orders inbox on launch day', owner: 'Mei Lin Zhou', due: 'Thursday (launch day)', at: '04:05' },
        { what: 'Forward the courier\'s rates to Grace as soon as they arrive', owner: 'Mei Lin Zhou', due: null, at: '19:54' },
        { what: 'Put the staging site\'s session timeout back up so it stops logging people out', owner: 'Grace Adeyemi', due: 'today', at: '20:27' },
        { what: 'Change the text of the order emails (not the design)', owner: 'Grace Adeyemi', due: null, at: '22:15' },
        { what: 'Write the text for the three order emails (received, shipped, invoice) and send it to Grace', owner: 'Mei Lin Zhou', due: 'tomorrow', at: '22:27' },
        { what: 'Send Lukas and Mei Lin a link for a test order', owner: 'Grace Adeyemi', due: 'tomorrow morning', at: '24:16' },
        { what: 'Go through the whole site on his phone and send Grace one list of what\'s broken', owner: 'Lukas Brenner', due: 'tonight', at: '24:28' },
        { what: 'Be online to watch the site at launch, from 9:30 her time until lunch', owner: 'Grace Adeyemi', due: 'Thursday (launch morning)', at: '25:14' },
        { what: 'Write the launch newsletter (with free shipping) and have it in the tool', owner: 'Lukas Brenner', due: 'Wednesday night (written tomorrow)', at: '28:37' },
        { what: 'Pack and send the sample boxes to the top ten buyers on Rafael\'s list', owner: 'Mei Lin Zhou', due: 'Friday (out this week)', at: '34:39' },
        { what: 'Email Rafael about Calder & Moss and reply to Calder & Moss that it\'s being looked at, without a yes or no', owner: 'Lukas Brenner', due: 'tonight (the email to Rafael), or no due date (either is right)', at: '39:50' },
        { what: 'Finish the product descriptions for all 46 products, with prices and lead times', owner: 'Mei Lin Zhou', due: null, at: '40:03' },
        { what: 'Finish the checkout pages', owner: 'Grace Adeyemi', due: null, at: '40:31' }
      ],
      acceptable: [
        'Shipping only inside the EU for launch (as a decision or fact); the checkout not taking UK orders at launch',
        'Going live Thursday at 11:00 their time, 10:00 UTC, with the newsletter',
        'Using the sales emails for the descriptions (as a suggestion or a follow-up for Mei Lin)',
        'Trying other photo studios for the spring range (as a suggestion or a follow-up for Mei Lin)',
        'Mei Lin fixing her budget spreadsheet (as a follow-up)',
        '310 of the 1,200 photo budget spent',
        'The staging site logging people out (as an issue mentioned)',
        'A 15% first-order discount agreed early in the call, then replaced by free shipping on the first order',
        'Twenty sample boxes considered, then cut to ten (900 down to 450); Calder & Moss getting one though they are in the UK',
        'Mei Lin shooting the gloves on her phone for now and properly after launch (as a decision or a follow-up)',
        'Mei Lin sending Lukas three photos for the newsletter and reading his draft before Wednesday (as follow-ups)',
        'Lukas and Mei Lin each doing a test order from Grace\'s link (as a follow-up)',
        'Lukas telling Grace about the "prices exclude VAT" line, and Mei Lin putting the prices back in the descriptions (as follow-ups)',
        'Mei Lin sending Grace the link to the list of existing accounts (as a follow-up)',
        'Lukas asking Dana about VAT (as a follow-up already done in the call)',
        'The agency\'s banner change refused; the banner stays',
        'Not updating the PDF price list this week',
        'Lead times in the descriptions: six weeks for ceramics, three for the big planters, two for the rest',
        'Taking Lukas\'s mobile off the contact page and footer for the office number (as a decision or a follow-up for Mei Lin or Grace)',
        'Asking Grace about the CSV import losing text after quotes (as a suggestion, or as an issue mentioned)',
        'Payments by card and invoice only, no PayPal',
        'Mei Lin doing the shipping table (as a follow-up)',
        'Grace turning invoice payment on for the existing accounts (as a follow-up)',
        'Grace setting up free shipping on the first order in the checkout (as a follow-up)'
      ],
      never: [
        'Anything from the Russian, Ukrainian or French lines (thanks for watching, to be continued, subtitles by the Amara.org community)',
        'Going live at 9:00 their time',
        'A new photo studio chosen',
        'Paying for the courier\'s business plan',
        'A 15% first-order discount as the offer that launches',
        'A person or courier named Carrie',
        'The newsletter going to 1,800 people',
        'Whether prices include VAT as a question still open',
        'Re-editing the flagged shoot photos, or putting them on the staging site, as a follow-up: Mei Lin says at the start they\'re done'
      ]
    }
  },
  {
    id: 'weekly-team-long',
    checks: 'A rambling 45-minute operations weekly with five updates, a late joiner and a dropped connection: the notes keep only the final holiday cutoff, the dock-door quotes with the person who ended up owning them, and the Saturday-shift question as answered 25 minutes later.',
    title: 'Ops weekly',
    kind: 'call',
    organizer: 'Dana Whitfield',
    invited: ['Kofi Mensah', 'Grace Adeyemi', 'Rafael Ortega', 'Sam Okafor', 'Jonah Feld'],
    language: 'call',
    writtenIn: 'en',
    gaps: [],
    transcript: `
  [00:02] Kofi Mensah: Дякую за перегляд!
  [00:24] Kofi Mensah: Sous-titres réalisés par la communauté d'Amara.org
  [00:51] Dana Whitfield: Hello? (unclear)
  [00:55] Kofi Mensah: Hey. Hey Dana.
  [00:57] Grace Adeyemi: Hi, hi.
  [01:01] Dana Whitfield: Hey. Okay, who've we got. Kofi, Grace...
  [01:06] Rafael Ortega: I'm here, I'm just, my camera's doing the thing. (unclear)
  [01:11] Dana Whitfield: That's fine. Sam?
  [01:14] Grace Adeyemi: Sam's on a train I think. He said in the chat.
  [01:18] Dana Whitfield: Okay. We'll start, he'll jump in.
  [01:22] Kofi Mensah: Yeah.
  [01:26] Dana Whitfield: Um... (unclear)
  [01:29] Dana Whitfield: Same as always, round the room, warehouse, me, Grace, Rafael, then Sam if he's here by then.
  [01:37] Rafael Ortega: Sure.
  [01:40] Dana Whitfield: Kofi, go.
  [01:43] Kofi Mensah: Okay. So. Uh... (unclear)
  [01:48] Kofi Mensah: Big one first, dock door three is broken again. The,
  [01:53] Kofi Mensah: the motor on the roller thing, it just, it stopped halfway up on Thursday
  [01:59] Kofi Mensah: and now it doesn't go anywhere. (unclear)
  [02:03] Grace Adeyemi: Oh no.
  [02:05] Kofi Mensah: So we're running everything through two and four, which,
  [02:10] Kofi Mensah: is fine-ish, but in December? No.
  [02:14] Dana Whitfield: Is it the same thing as in the summer?
  [02:18] Kofi Mensah: Different. The guy said the summer one was the sensor, this is the motor.
  [02:24] Kofi Mensah: He reckons it's a full replacement. (unclear)
  [02:28] Dana Whitfield: Ugh. Okay.
  [02:31] Kofi Mensah: So I'll get some quotes for that. Like this week.
  [02:36] Dana Whitfield: Yeah.
  [02:39] Kofi Mensah: Um, second thing. (unclear)
  [02:44] Kofi Mensah: Aisle twelve. The count's off again. System says
  [02:49] Kofi Mensah: three hundred forty boxes of the medium nitrile, we've got, like, two eighty on the shelf.
  [02:55] Rafael Ortega: Sixty boxes?
  [02:57] Kofi Mensah: Sixty-ish. Could be they're just in the wrong bay. (unclear)
  [03:02] Kofi Mensah: Half of twelve got moved when we did the racking.
  [03:07] Dana Whitfield: Can you recount it properly?
  [03:11] Kofi Mensah: Yeah. Yeah, I'll do the whole aisle,
  [03:15] Kofi Mensah: I'll have it done by Thursday.
  [03:18] Dana Whitfield: Thanks.
  [03:22] Kofi Mensah: And then the, the thing I actually need an answer on.
  [03:27] Kofi Mensah: Are we keeping the Saturday shift through December or not?
  [03:32] Kofi Mensah: Because I've got four temps asking me and I keep saying I don't know.
  [03:37] Dana Whitfield: That's, um... that's a money question. (unclear)
  [03:41] Rafael Ortega: Yeah it's sitting with me, I'll, I'll get to it. (unclear)
  [03:46] Kofi Mensah: Okay but like, soon. They need to know.
  [03:49] Rafael Ortega: Yeah, yeah.
  [03:54] Kofi Mensah: Okay. Um. (unclear)
  [04:01] Kofi Mensah: The scanner guns. Two of them won't hold a charge.
  [04:06] Dana Whitfield: Is that Jonah's?
  [04:08] Kofi Mensah: It's Jonah's, but Jonah's off till Monday.
  [04:12] Grace Adeyemi: He's in Lisbon. He posted, like, forty pictures of tiles. (unclear)
  [04:17] Kofi Mensah: Ha. Course he did.
  [04:20] Kofi Mensah: I'll put a ticket in for him for when he's back.
  [04:24] Dana Whitfield: Yeah.
  [04:29] Kofi Mensah: Uh... what else. (unclear)
  [04:35] Kofi Mensah: Oh, the forklift battery thing. Sorted. Ignore my email.
  [04:40] Grace Adeyemi: I didn't read your email. (unclear)
  [04:43] Kofi Mensah: Good. Perfect.
  [04:45] Rafael Ortega: Ha.
  [04:50] Kofi Mensah: That's, I think that's me.
  [04:55] Kofi Mensah: Oh, wait, no. Sorry. One more.
  [04:59] Kofi Mensah: The racking inspection. The, the annual one.
  [05:04] Kofi Mensah: It's booked for the ninth. Of December. (unclear)
  [05:09] Dana Whitfield: In December? Who booked that in December?
  [05:12] Kofi Mensah: Me. Last year. I didn't think about it. (unclear)
  [05:17] Grace Adeyemi: Ha.
  [05:21] Kofi Mensah: It's half a day, they block off two aisles at a time.
  [05:27] Kofi Mensah: So it's like, it's annoying but it's not the end of the world. (unclear)
  [05:32] Dana Whitfield: Can you move it?
  [05:36] Kofi Mensah: I could try, but then it's January and in January we've got the stock take. (unclear)
  [05:42] Kofi Mensah: So, honestly, I'd just leave it.
  [05:46] Dana Whitfield: Yeah. Leave it. Fine. (unclear)
  [05:51] Kofi Mensah: Okay.
  [05:56] Rafael Ortega: Is that the one we pay for or the insurance pays?
  [06:01] Kofi Mensah: We pay. Insurance needs the certificate. (unclear)
  [06:06] Rafael Ortega: Okay. It's in the budget then.
  [06:10] Kofi Mensah: Uh... (unclear)
  [06:17] Kofi Mensah: And the new guy, Marcus, started Monday. He's good. He's quiet but he's good.
  [06:23] Grace Adeyemi: Is he the tall one?
  [06:26] Kofi Mensah: The tall one, yeah. (unclear)
  [06:29] Grace Adeyemi: He held the door for me. He seems nice.
  [06:34] Kofi Mensah: He's nice. He's very nice. He's slow on the reach truck, but.
  [06:41] Kofi Mensah: He'll get there. (unclear)
  [06:45] Dana Whitfield: Okay. Good.
  [06:52] Kofi Mensah: Okay, that's actually me.
  [07:00] Dana Whitfield: Okay. Anything from anyone for Kofi?
  [07:05] Grace Adeyemi: Just, um, the Pam Burton order, did that go out? (unclear)
  [07:10] Kofi Mensah: The what?
  [07:13] Grace Adeyemi: Pemberton. The hardware chain. Their last order.
  [07:16] Kofi Mensah: Oh. Yeah, Friday. Went Friday.
  [07:20] Grace Adeyemi: Okay cool, they were asking.
  [07:24] Dana Whitfield: Okay.
  [07:31] Dana Whitfield: Um... (unclear)
  [07:36] Dana Whitfield: Sorry, my, my dog is losing it at the postman. One sec.
  [08:16] Dana Whitfield: Продолжение следует...
  [08:48] Dana Whitfield: Sorry. Sorry. He's fine now. (unclear)
  [08:52] Kofi Mensah: What's his name again?
  [08:54] Dana Whitfield: Biscuit.
  [08:57] Grace Adeyemi: Aw.
  [09:01] Sam Okafor: Hello? Can you hear me? (unclear)
  [09:04] Dana Whitfield: Hey Sam, yeah, we can hear you.
  [09:07] Sam Okafor: Sorry, sorry, the train went in a tunnel and then the wifi just, yeah.
  [09:13] Sam Okafor: Did I miss much?
  [09:16] Kofi Mensah: Dock door's broken, aisle twelve's wrong, Jonah's in Lisbon.
  [09:20] Sam Okafor: Ha. Normal week then.
  [09:24] Kofi Mensah: Normal week.
  [09:28] Dana Whitfield: Okay, me. Purchasing. (unclear)
  [09:33] Dana Whitfield: So the gloves. The nitrile from the Penang supplier.
  [09:39] Dana Whitfield: The container that was meant to land the twentieth is now saying,
  [09:45] Dana Whitfield: the first week of December. Maybe. (unclear)
  [09:49] Kofi Mensah: Fuck's sake.
  [09:51] Dana Whitfield: Yeah. Same.
  [09:55] Dana Whitfield: So we're fine on large and small, we're tight on medium.
  [10:00] Kofi Mensah: Which is aisle twelve. Which is the one I can't count.
  [10:04] Dana Whitfield: Which is the one you can't count, yes. (unclear)
  [10:09] Grace Adeyemi: Ha.
  [10:13] Dana Whitfield: So, I was gonna wait to place the January order till this one lands,
  [10:19] Dana Whitfield: like we normally do, but honestly, if this one's three weeks late...
  [10:24] Rafael Ortega: Then January's late too.
  [10:26] Dana Whitfield: Then January's late too. Yeah.
  [10:31] Sam Okafor: Can't you just order more from the, the other one, the Ohio one? (unclear)
  [10:36] Dana Whitfield: They're like thirty percent more. Thirty, thirty-five.
  [10:41] Sam Okafor: Oof. Okay.
  [10:45] Dana Whitfield: You should, um, honestly I should get a third quote at some point. Someone domestic.
  [10:51] Rafael Ortega: Mm. (unclear)
  [10:56] Dana Whitfield: Anyway. Rafael, is there money to, like, place January now? Like this week?
  [11:02] Rafael Ortega: It's the same amount as normal?
  [11:05] Dana Whitfield: Same amount. Just earlier.
  [11:08] Rafael Ortega: Then yeah, it's the same money, it just leaves earlier. It's fine.
  [11:13] Dana Whitfield: Okay. So we place the January order now, not wait.
  [11:17] Kofi Mensah: Yeah. (unclear)
  [11:18] Grace Adeyemi: Yeah, makes sense.
  [11:23] Dana Whitfield: I'll get the PO out by Friday.
  [11:27] Rafael Ortega: Send it to me before it goes, just so I see it.
  [11:31] Dana Whitfield: Yep. (unclear)
  [11:36] Dana Whitfield: Um... (unclear)
  [11:42] Dana Whitfield: Boxes. Hollis Packaging sent the letter, everything goes up eight percent from January.
  [11:49] Sam Okafor: Eight?
  [11:51] Dana Whitfield: Eight. On corrugated. Tape's the same.
  [11:55] Rafael Ortega: Did they say if orders we put in now get the old price? (unclear)
  [12:00] Dana Whitfield: They didn't say. I'll ask them. I'll chase them on that this week.
  [12:05] Rafael Ortega: Because if we can front-load... (unclear)
  [12:09] Dana Whitfield: Yeah, but then Kofi has to store it.
  [12:12] Kofi Mensah: Where? Where would I put it?
  [12:14] Dana Whitfield: Exactly.
  [12:17] Kofi Mensah: In dock door three, I guess. It's not doing anything.
  [12:20] Grace Adeyemi: Ha!
  [12:23] Sam Okafor: Ha.
  [12:28] Dana Whitfield: Okay. Um. (unclear)
  [12:34] Dana Whitfield: I think that's mostly it for me. Oh, the, the new label stock came, it's in. That's done.
  [12:41] Kofi Mensah: Yep, got it. (unclear)
  [12:46] Dana Whitfield: Um, and the aprons. The, the poly aprons.
  [12:51] Dana Whitfield: Supplier put them up from, uh, four eighty a case to five forty. (unclear)
  [12:57] Rafael Ortega: Four forty?
  [13:00] Dana Whitfield: Five forty. Five, four, zero.
  [13:04] Rafael Ortega: Okay. That's, what, twelve percent? (unclear)
  [13:09] Dana Whitfield: Something like that. I'm, I'm living with it, the others are worse. (unclear)
  [13:15] Sam Okafor: Do I have to put that up on the price list then?
  [13:19] Dana Whitfield: Not yet. Not till January anyway.
  [13:24] Sam Okafor: Okay. Good. (unclear)
  [13:28] Dana Whitfield: Um... (unclear)
  [13:36] Dana Whitfield: Okay, that's me. For real.
  [13:45] Dana Whitfield: Okay. Grace?
  [13:48] Grace Adeyemi: Okay. Customer service. Um... (unclear)
  [13:55] Grace Adeyemi: So the returns. We've got a hundred and forty open.
  [13:59] Dana Whitfield: A hundred and forty?
  [14:02] Grace Adeyemi: A hundred and forty. Which, it was ninety two weeks ago.
  [14:07] Grace Adeyemi: And like half of them are phone ones where someone wrote it on a sticky note (unclear)
  [14:13] Grace Adeyemi: and then nobody can find the order number.
  [14:17] Sam Okafor: Oh god. Was that me? (unclear)
  [14:19] Grace Adeyemi: Some of it was you.
  [14:22] Sam Okafor: Sorry.
  [14:24] Grace Adeyemi: It's fine. It's not just you.
  [14:29] Grace Adeyemi: But I want to, um, I want to stop taking returns on the phone. Like at all.
  [14:35] Grace Adeyemi: Everything through the form on the site. The form makes them put the order number in.
  [14:42] Kofi Mensah: Yes. Please. (unclear)
  [14:44] Dana Whitfield: What about the older customers who, like, don't do the website?
  [14:49] Grace Adeyemi: We fill the form in for them. While they're on the phone. Same thing, it's just,
  [14:55] Grace Adeyemi: it goes in the form, not on a sticky note.
  [14:59] Dana Whitfield: Okay. Okay, yeah.
  [15:03] Sam Okafor: Yeah, fine.
  [15:05] Dana Whitfield: From when?
  [15:08] Grace Adeyemi: From December first.
  [15:11] Dana Whitfield: Okay. Do it. Returns go through the form only from the first.
  [15:16] Grace Adeyemi: Cool. (unclear)
  [15:20] Grace Adeyemi: Um, and I'll, I'll tell my team on Wednesday's huddle. (unclear)
  [15:26] Dana Whitfield: Yep.
  [15:31] Grace Adeyemi: Next. Christmas.
  [15:35] Grace Adeyemi: Customers keep asking what the last day is to order and get it before Christmas.
  [15:41] Grace Adeyemi: And I need a date to put on the banner and in the order emails.
  [15:46] Kofi Mensah: Ground or express?
  [15:49] Grace Adeyemi: Ground. Express is whatever, express is fine till like the twentieth.
  [15:55] Kofi Mensah: Okay so ground is, it's three days, mostly. Three, four. (unclear)
  [16:01] Kofi Mensah: So like, the twentieth, minus four... sixteenth?
  [16:06] Dana Whitfield: Sixteenth is a, what's the sixteenth?
  [16:10] Rafael Ortega: Wednesday.
  [16:12] Dana Whitfield: Wednesday. That's fine. That gives us the weekend before as buffer.
  [16:17] Grace Adeyemi: So, December sixteenth?
  [16:20] Dana Whitfield: Yeah, let's say the sixteenth.
  [16:23] Kofi Mensah: Yeah. (unclear)
  [16:26] Grace Adeyemi: Okay, sixteenth. I'll get it on the banner and the emails by Monday.
  [16:32] Dana Whitfield: Great.
  [16:36] Grace Adeyemi: Um. Okay. Then. (unclear)
  [16:42] Grace Adeyemi: The other thing is, uh, a couple of the big accounts are asking about free return shipping in January.
  [16:49] Grace Adeyemi: Like, because of all the Christmas stuff coming back. (unclear)
  [16:54] Sam Okafor: Who's asking?
  [16:57] Grace Adeyemi: Pemberton, and the, the dental group. Brightsmile.
  [17:02] Sam Okafor: Pemberton's asking for everything at the moment. (unclear)
  [17:07] Dana Whitfield: Do we do free returns? Like, can we, Rafael?
  [17:12] Rafael Ortega: I'd have to, I'd have to see what returns cost us last January. I don't know offhand.
  [17:18] Dana Whitfield: Hmm. (unclear)
  [17:22] Grace Adeyemi: So do we offer it or not?
  [17:25] Dana Whitfield: I don't know. Let's not decide that today. (unclear)
  [17:29] Grace Adeyemi: Okay. But they will ask again.
  [17:33] Dana Whitfield: I know. I know.
  [17:38] Grace Adeyemi: Okay. And then Christmas week. (unclear)
  [17:43] Grace Adeyemi: Who's on the phones, like the twenty-fourth to the twenty-sixth? Because my two are both off.
  [17:49] Dana Whitfield: The twenty-sixth we're closed, aren't we?
  [17:53] Grace Adeyemi: The warehouse is closed. The phones aren't. The phones are... I don't actually know.
  [17:59] Kofi Mensah: Rafael, did you just freeze? (unclear)
  [18:03] Sam Okafor: Yeah he's frozen. He's mid-blink. (unclear)
  [18:06] Grace Adeyemi: Ha. Oh no, that's a bad frame.
  [18:10] Dana Whitfield: Rafael? (unclear)
  [18:17] Kofi Mensah: He's gone. He's left.
  [18:21] Dana Whitfield: Okay, he'll come back. Um, phones. Grace, I don't know either.
  [18:27] Grace Adeyemi: Okay, well somebody needs to know.
  [18:31] Dana Whitfield: Yeah. Let's... I'll have a think. (unclear)
  [18:37] Grace Adeyemi: Okay. Um. (unclear)
  [18:45] Grace Adeyemi: Oh, and the, the inbox tool is still doing the thing where it,
  [18:50] Grace Adeyemi: marks things as answered when you just open them.
  [18:55] Sam Okafor: Oh it does that to me too. It's so bad.
  [18:58] Grace Adeyemi: So we've had like, three customers who just never got an answer
  [19:03] Grace Adeyemi: because it looked done. And one of them was really angry. Like really angry.
  [19:09] Kofi Mensah: Who sold us that tool?
  [19:13] Grace Adeyemi: I don't know! Somebody before me. (unclear)
  [19:17] Sam Okafor: It was a demo, like, two years ago, the guy had a ponytail. (unclear)
  [19:22] Kofi Mensah: Ha. Of course.
  [19:26] Grace Adeyemi: Anyway, I've told Jonah, it's on his list, but he's...
  [19:31] Kofi Mensah: In Lisbon.
  [19:32] Grace Adeyemi: In Lisbon. Looking at tiles.
  [19:36] Dana Whitfield: Ha. Okay.
  [19:43] Rafael Ortega: Hello? Okay, I'm back. Sorry. Can you hear me?
  [19:47] Dana Whitfield: Yeah, you're back.
  [19:49] Rafael Ortega: The whole building's wifi went. What did I miss?
  [19:54] Grace Adeyemi: Phones at Christmas. Nobody knows.
  [19:58] Rafael Ortega: Okay. Not me. (unclear)
  [20:00] Grace Adeyemi: Ha. Okay. That's me, I think.
  [20:05] Dana Whitfield: Okay. Thanks Grace.
  [20:11] Dana Whitfield: Um... (unclear)
  [20:16] Dana Whitfield: Rafael, you're up, since you're back.
  [20:20] Rafael Ortega: Okay. Um. Let me just get my, (unclear)
  [20:25] Rafael Ortega: my thing open. One second.
  [20:31] Rafael Ortega: Uh... (unclear)
  [20:39] Rafael Ortega: Okay. Month end. Close is the twenty-seventh this time, not the thirtieth,
  [20:45] Rafael Ortega: because of the, the audit people coming in.
  [20:49] Kofi Mensah: The twenty-seventh is a Friday?
  [20:51] Rafael Ortega: Friday, yeah.
  [20:54] Rafael Ortega: So I need everyone's November receipts by this Friday. Not next. This one.
  [21:00] Sam Okafor: In the new tool?
  [21:02] Rafael Ortega: In the new tool. (unclear)
  [21:05] Sam Okafor: The new tool hates me. It logs me out every time I take a picture.
  [21:10] Rafael Ortega: It hates everyone. Just, just do it. Please.
  [21:15] Sam Okafor: Fine. Fine. (unclear)
  [21:18] Grace Adeyemi: Can I just email them to you?
  [21:22] Rafael Ortega: No. In the tool. (unclear)
  [21:25] Grace Adeyemi: Ugh. Okay.
  [21:31] Rafael Ortega: Um, second, the Brightsmile invoice is now sixty days overdue.
  [21:37] Sam Okafor: Brightsmile? They told me they paid.
  [21:41] Rafael Ortega: They did not pay. (unclear)
  [21:44] Sam Okafor: They told me, like, two weeks ago, it's in the run.
  [21:48] Rafael Ortega: It's not in any run I've seen. (unclear)
  [21:52] Sam Okafor: Okay. I'll, I'll call Lorna there.
  [21:56] Rafael Ortega: Thanks. And they're also the ones asking for free returns, so.
  [22:01] Grace Adeyemi: Ha. Yeah.
  [22:03] Sam Okafor: Yeah, that's, that's rich. (unclear)
  [22:09] Rafael Ortega: Okay. Third. (unclear)
  [22:14] Rafael Ortega: The, uh, the reach truck lease. It's up in March. I'll, I'm looking at whether we buy it out or not.
  [22:22] Kofi Mensah: Buy it. It's a good truck.
  [22:24] Rafael Ortega: I'll look at the numbers, Kofi. (unclear)
  [22:28] Kofi Mensah: It's a good truck, is all I'm saying.
  [22:32] Rafael Ortega: Noted. Noted.
  [22:38] Rafael Ortega: Oh, and budgets. For next year.
  [22:43] Rafael Ortega: I'm sending everyone the sheet next week, it's the same as last year,
  [22:49] Rafael Ortega: just, please, don't put round numbers in everything. (unclear)
  [22:54] Sam Okafor: What's wrong with round numbers?
  [22:56] Rafael Ortega: Last year you put fifty thousand for travel. Exactly fifty.
  [23:03] Sam Okafor: That was a good estimate!
  [23:05] Rafael Ortega: You spent eleven. (unclear)
  [23:09] Kofi Mensah: Ha!
  [23:11] Sam Okafor: The flights were cheap. I can't help that. (unclear)
  [23:17] Rafael Ortega: Uh... and the audit people. They're in from the thirtieth, for a week.
  [23:24] Rafael Ortega: They'll want to walk the warehouse at some point, Kofi. (unclear)
  [23:29] Kofi Mensah: In December? Everyone wants the warehouse in December.
  [23:34] Rafael Ortega: I'll tell them to keep it short.
  [23:37] Kofi Mensah: Hi-vis. They have to wear hi-vis. Last time one of them walked under the (unclear)
  [23:44] Kofi Mensah: under a pallet on the forks. I nearly died.
  [23:48] Rafael Ortega: I'll tell them. Hi-vis. (unclear)
  [23:53] Dana Whitfield: Okay.
  [23:58] Rafael Ortega: Um... (unclear)
  [24:06] Rafael Ortega: Okay. Yeah, that's me.
  [24:16] Rafael Ortega: Um. Okay. That's, that's mostly me. (unclear)
  [24:21] Dana Whitfield: Okay. Sam, you want to go, or are you still on the train?
  [24:26] Sam Okafor: I'm off the train, I'm in a, I'm in a café now, it's a bit loud. (unclear)
  [24:31] Sam Okafor: Can you hear the coffee machine?
  [24:33] Grace Adeyemi: A little. (unclear)
  [24:36] Sam Okafor: Okay. Sorry. I'll be quick.
  [24:41] Sam Okafor: So. Pemberton. Big one. They want a Christmas order, forty pallets,
  [24:47] Sam Okafor: mostly the medium nitrile, mixed in with the aprons. (unclear)
  [24:52] Kofi Mensah: Medium. Of course it's medium.
  [24:54] Dana Whitfield: Of course it's medium.
  [24:57] Sam Okafor: What? What's wrong with medium?
  [24:59] Dana Whitfield: The container's late and aisle twelve's wrong. You missed it.
  [25:04] Sam Okafor: Oh. Oh no.
  [25:07] Sam Okafor: Okay, well, um, they want it before Christmas, obviously. (unclear)
  [25:13] Kofi Mensah: When do they want it to ship?
  [25:17] Sam Okafor: They said like, the middle of December. They haven't confirmed the quantity.
  [25:23] Dana Whitfield: Forty pallets of medium, we don't have forty pallets of medium. (unclear)
  [25:28] Dana Whitfield: Not until the container.
  [25:30] Sam Okafor: Okay, but if the container's the first week of December...
  [25:35] Dana Whitfield: Maybe. Maybe. It's not, it's not a promise.
  [25:40] Sam Okafor: Okay. (unclear)
  [25:45] Sam Okafor: And the other thing, they want free shipping on it. On the forty pallets.
  [25:50] Rafael Ortega: No. (unclear)
  [25:52] Sam Okafor: I know. I know. I said I'd ask.
  [25:56] Rafael Ortega: Forty pallets free shipping, that's, that's like four grand.
  [26:01] Sam Okafor: What if we gave them a discount instead? Like three percent off the order. (unclear)
  [26:07] Rafael Ortega: Three percent is, what's the order, like sixty thousand?
  [26:12] Sam Okafor: Sixty-two.
  [26:15] Rafael Ortega: So, eighteen hundred-ish. Less than the shipping. That's better.
  [26:20] Dana Whitfield: Yeah, do the three percent, not the free shipping.
  [26:23] Sam Okafor: Okay. Three percent off, they pay shipping.
  [26:27] Rafael Ortega: Yeah. (unclear)
  [26:28] Kofi Mensah: Yeah.
  [26:32] Sam Okafor: I'll redo the quote and send it over. Um, Wednesday. By Wednesday.
  [26:38] Dana Whitfield: Great.
  [26:43] Sam Okafor: Uh... (unclear)
  [26:48] Sam Okafor: Oh, and I had two new people ask about, like, a trial account. Small ones. A café chain and a, (unclear)
  [26:56] Sam Okafor: a vet. A vet place.
  [26:59] Dana Whitfield: Honestly, Sam, no new trial accounts till January. We can't ship them anything.
  [27:06] Sam Okafor: Yeah. Yeah, fine. That's fair. (unclear)
  [27:09] Sam Okafor: I'll tell them January.
  [27:13] Dana Whitfield: Thanks.
  [27:17] Sam Okafor: And, um, there's the trade show in February, the one in Columbus,
  [27:23] Sam Okafor: you should look at whether we get a stand, Dana, it's like... (unclear)
  [27:28] Dana Whitfield: Yeah, maybe. Send me the thing. (unclear)
  [27:32] Sam Okafor: Okay.
  [27:37] Sam Okafor: That's me. I think. Sorry, the coffee machine.
  [27:42] Dana Whitfield: It's fine. Okay. Um... (unclear)
  [27:49] Dana Whitfield: Okay, so before we go, um, anything else, anyone. (unclear)
  [27:55] Kofi Mensah: Uh, yeah. Rafael, sorry, the Saturday thing. Did you get anywhere?
  [28:01] Rafael Ortega: Oh, I was going to say it later. Yes. Hang on.
  [28:08] Rafael Ortega: Um... (unclear)
  [28:15] Rafael Ortega: Okay. Sorry, I wrote it down somewhere.
  [28:26] Rafael Ortega: Okay. Yes.
  [28:35] Kofi Mensah: Yes we keep it?
  [28:37] Rafael Ortega: Hang on. Let me just check the number.
  [28:44] Rafael Ortega: So four temps, six hours, twenty-two an hour. That's...
  [28:51] Rafael Ortega: five twenty-eight a Saturday. Times three Saturdays, that's, twelve hundred.
  [29:00] Grace Adeyemi: That's not twelve hundred.
  [29:02] Rafael Ortega: No, no, fifteen eighty-four. Fifteen eighty-four. Sorry. It's late. (unclear)
  [29:10] Kofi Mensah: Is that okay though?
  [29:12] Rafael Ortega: Yeah. It's in the budget. So, yes. Keep the Saturday shift
  [29:18] Rafael Ortega: through the nineteenth. Not the twenty-sixth, through the nineteenth.
  [29:23] Kofi Mensah: Through the nineteenth. Okay. Brilliant.
  [29:27] Dana Whitfield: Great.
  [29:31] Rafael Ortega: I'll email you the approval today, Kofi. In writing. So you've got it.
  [29:36] Kofi Mensah: Thanks. And I'll tell the temps tomorrow.
  [29:41] Kofi Mensah: They'll be happy. (unclear)
  [29:46] Rafael Ortega: Um... (unclear)
  [29:51] Rafael Ortega: Oh, and the dock door, Kofi. Whatever that costs, if it's over five grand
  [29:57] Rafael Ortega: it needs three quotes, and it has to go through purchasing. It's the policy now.
  [30:03] Kofi Mensah: Over five? It's definitely over five. (unclear)
  [30:07] Kofi Mensah: Ugh. Okay. Then... Dana, can you take the quotes?
  [30:12] Kofi Mensah: You've got all the vendors anyway.
  [30:15] Dana Whitfield: Yeah. Yeah, I'll take it. Send me the photos and the guy's number.
  [30:22] Kofi Mensah: Will do. Today. (unclear)
  [30:25] Dana Whitfield: Okay.
  [30:30] Dana Whitfield: Um... (unclear)
  [30:36] Grace Adeyemi: Can I go back to the returns thing for a sec?
  [30:40] Dana Whitfield: Sure.
  [30:43] Grace Adeyemi: For the form, I need, um, the form needs a reason dropdown, (unclear)
  [30:49] Grace Adeyemi: and I don't know who updates the site.
  [30:53] Dana Whitfield: That's Jonah.
  [30:54] Kofi Mensah: That's Jonah.
  [30:56] Grace Adeyemi: Of course it is. (unclear)
  [31:00] Dana Whitfield: Put it on his list for Monday.
  [31:04] Grace Adeyemi: Yeah. Yeah, okay. (unclear)
  [31:10] Sam Okafor: Sorry, can I, I think I'm breaking up. Am I breaking up? (unclear)
  [31:15] Dana Whitfield: You're okay. Little bit.
  [31:19] Sam Okafor: Okay. The café wifi is... yeah.
  [31:25] Kofi Mensah: Uh... (unclear)
  [31:32] Kofi Mensah: Did anyone else see the email about the car park? (unclear)
  [31:37] Grace Adeyemi: The barrier? Yes.
  [31:40] Kofi Mensah: It's been up for a week. Like, it's just up. Anyone can come in.
  [31:46] Grace Adeyemi: Someone parked a boat in it on Saturday.
  [31:50] Sam Okafor: A what?
  [31:51] Grace Adeyemi: A boat. On a trailer. In my spot.
  [31:55] Sam Okafor: Ha! No way. (unclear)
  [31:58] Kofi Mensah: I saw that. I thought it was, like, a delivery. (unclear)
  [32:04] Grace Adeyemi: Nobody's delivering us a boat, Kofi.
  [32:08] Kofi Mensah: You don't know that. Sam sells to anyone.
  [32:12] Sam Okafor: Hey. Fair. But hey.
  [32:17] Dana Whitfield: Okay. Okay. (unclear)
  [32:21] Rafael Ortega: The barrier's with facilities, it's not, not us. (unclear)
  [32:26] Dana Whitfield: Yeah.
  [32:32] Dana Whitfield: Um... (unclear)
  [32:38] Dana Whitfield: How was everyone's weekend, actually, I didn't even ask.
  [32:43] Sam Okafor: Wedding. My cousin's. In Dayton.
  [32:47] Grace Adeyemi: Oh fun!
  [32:49] Sam Okafor: It was nine hours. The ceremony alone was two. (unclear)
  [32:54] Kofi Mensah: Two hours?
  [32:57] Sam Okafor: Two hours. There was a, a sax solo. In the church.
  [33:02] Grace Adeyemi: Ha!
  [33:04] Sam Okafor: My uncle. He's been learning since March. (unclear)
  [33:10] Kofi Mensah: Since March. That's, that's brave.
  [33:14] Sam Okafor: It was very brave. It was very loud.
  [33:19] Rafael Ortega: I just did the garden. Leaves. So many leaves. (unclear)
  [33:25] Grace Adeyemi: Same. Well, not leaves. I slept.
  [33:29] Dana Whitfield: Honestly that's the dream.
  [33:33] Grace Adeyemi: It was the dream.
  [33:37] Kofi Mensah: I took the kids to the, um, the trampoline place. (unclear)
  [33:42] Kofi Mensah: I did one jump and my back went.
  [33:46] Sam Okafor: One jump?
  [33:47] Kofi Mensah: One jump. I'm forty-one. I'm done. (unclear)
  [33:52] Grace Adeyemi: Ha. Oh no.
  [33:57] Kofi Mensah: What about you, Dana?
  [34:01] Dana Whitfield: Biscuit ate a sock. So we were at the vet Sunday. (unclear)
  [34:06] Grace Adeyemi: Oh no! Is he okay?
  [34:08] Dana Whitfield: He's fine. The sock is, uh, no longer with us.
  [34:13] Sam Okafor: Ha!
  [34:16] Rafael Ortega: How much was the vet?
  [34:18] Dana Whitfield: Don't. Don't ask. (unclear)
  [34:22] Rafael Ortega: Spoken like finance. Sorry.
  [34:27] Dana Whitfield: Ha. It was three hundred dollars, for a sock.
  [34:33] Kofi Mensah: That's an expensive sock. (unclear)
  [34:37] Dana Whitfield: It was a very expensive sock.
  [34:47] Dana Whitfield: Okay, okay. Um. (unclear)
  [34:53] Dana Whitfield: Back to it. Anything else for, for this week?
  [34:59] Grace Adeyemi: Um... (unclear)
  [35:06] Grace Adeyemi: No, I think, no. Oh, wait, the Pemberton complaint.
  [35:10] Grace Adeyemi: The angry one from the inbox thing, that was Pemberton. (unclear)
  [35:15] Sam Okafor: Oh, great. While I'm trying to sell them forty pallets.
  [35:20] Grace Adeyemi: I know. I called them back, it's fine now. Mostly. (unclear)
  [35:25] Sam Okafor: Okay. Okay. Can you send me what it was? So I know before I call them.
  [35:32] Grace Adeyemi: Yeah, I'll forward you the thread.
  [35:35] Sam Okafor: Thanks.
  [35:40] Dana Whitfield: Okay.
  [35:45] Rafael Ortega: Uh, one more for me, sorry. (unclear)
  [35:50] Rafael Ortega: The, the free returns. For January. (unclear)
  [35:55] Rafael Ortega: I said I don't know what it cost last year. I still don't. I'll, I'll have to dig.
  [36:01] Grace Adeyemi: Okay. So still, still don't know. (unclear)
  [36:05] Rafael Ortega: Still don't know. Sorry.
  [36:09] Dana Whitfield: That's fine. It's not today.
  [36:15] Dana Whitfield: Um... (unclear)
  [36:25] Kofi Mensah: Hang on, someone's at the, the door. Sorry.
  [37:13] Kofi Mensah: Продолжение следует...
  [38:02] Kofi Mensah: Okay, sorry. That was the, the courier.
  [38:07] Kofi Mensah: Actually it's relevant. That was the carrier guy.
  [38:10] Dana Whitfield: Which carrier?
  [38:13] Kofi Mensah: Ridgeway. The ground one. He came in to drop the December schedule. (unclear)
  [38:19] Kofi Mensah: And he said, like, he said it twice so I'd get it,
  [38:24] Kofi Mensah: December, ground's not three days. It's five. Five working days. Because of the volume.
  [38:31] Grace Adeyemi: Five?
  [38:33] Kofi Mensah: Five. Every year they say three and every year it's five, he said. (unclear)
  [38:39] Grace Adeyemi: So the sixteenth doesn't work.
  [38:43] Kofi Mensah: The sixteenth doesn't work.
  [38:45] Dana Whitfield: Okay. So what, the, um... (unclear)
  [38:50] Dana Whitfield: If it's five working days, and the last delivery day is, like, the twenty-third...
  [38:57] Kofi Mensah: The twenty-third's a Wednesday. So back five working days, that's the,
  [39:04] Kofi Mensah: twenty-second, twenty-first, eighteenth... it's the sixteenth. (unclear)
  [39:10] Rafael Ortega: No. You have to count the day it ships.
  [39:14] Kofi Mensah: Ugh. Yes. And we pick and pack the day after the order.
  [39:20] Kofi Mensah: So order on the twelfth, we ship the fifteenth, Monday... (unclear)
  [39:26] Rafael Ortega: Hang on. Twelfth's a Saturday.
  [39:30] Kofi Mensah: Is it?
  [39:31] Rafael Ortega: Saturday. (unclear)
  [39:33] Kofi Mensah: Okay. Then, order by Friday the eleventh, we ship Monday the fourteenth,
  [39:41] Kofi Mensah: five working days, lands the... the twenty-first. Twenty-first, twenty-second.
  [39:47] Grace Adeyemi: Okay, so that's tight but it works.
  [39:51] Dana Whitfield: Hmm. (unclear)
  [39:54] Dana Whitfield: Wait. Rafael, you said the sixteenth was a Wednesday.
  [39:59] Rafael Ortega: Did I? (unclear)
  [40:02] Grace Adeyemi: You did.
  [40:04] Rafael Ortega: Then the twelfth's a Saturday, yeah, that holds. Wednesday sixteenth, Saturday twelfth.
  [40:11] Dana Whitfield: Okay.
  [40:14] Dana Whitfield: So, the eleventh. Friday the eleventh is the last day for ground.
  [40:20] Grace Adeyemi: Not the sixteenth.
  [40:23] Dana Whitfield: Not the sixteenth. Friday the eleventh. (unclear)
  [40:27] Kofi Mensah: Yeah. Yeah, the eleventh.
  [40:29] Sam Okafor: Yeah, fine.
  [40:33] Grace Adeyemi: Okay. Good, because the banner's not up yet. I'll put the eleventh on it.
  [40:39] Dana Whitfield: Thank god for that. (unclear)
  [40:44] Sam Okafor: Wait, so Pemberton. If they want it before Christmas, (unclear)
  [40:50] Sam Okafor: they're on the same, like, the same cutoff?
  [40:54] Kofi Mensah: For forty pallets? That's not ground parcels, that's a truck. That's different.
  [41:00] Sam Okafor: Okay, so when do they need to confirm by?
  [41:04] Kofi Mensah: I... honestly don't know. I'd have to ask Ridgeway freight, not parcels. (unclear)
  [41:10] Sam Okafor: Okay. Can you?
  [41:13] Kofi Mensah: Yeah, I'll ask him, I've got his number now. (unclear)
  [41:18] Sam Okafor: Cool. (unclear)
  [41:24] Dana Whitfield: Okay. Um... (unclear)
  [41:30] Dana Whitfield: Okay. Let me just, let me recap, because that was a lot.
  [41:36] Dana Whitfield: Kofi, you're recounting aisle twelve by Thursday, you're telling the temps,
  [41:42] Dana Whitfield: ticket for Jonah, and you're on the dock door quotes.
  [41:47] Kofi Mensah: No, you took the quotes. I'm sending you the photos.
  [41:51] Dana Whitfield: Oh. Right, I did. Yes. I'm on the dock door quotes.
  [41:57] Dana Whitfield: And the glove PO by Friday, and chasing Hollis on the box price.
  [42:03] Dana Whitfield: Grace, the banner and the emails with the eleventh, by Monday,
  [42:10] Dana Whitfield: and the returns form from the first. (unclear)
  [42:13] Grace Adeyemi: And the Pemberton thread to Sam.
  [42:16] Dana Whitfield: And the Pemberton thread to Sam.
  [42:21] Dana Whitfield: Rafael, the approval email to Kofi, today. (unclear)
  [42:26] Rafael Ortega: Today. Yep.
  [42:28] Dana Whitfield: Sam, the Pemberton quote by Wednesday, three percent,
  [42:34] Dana Whitfield: and call Brightsmile about the invoice.
  [42:38] Sam Okafor: Yep. Lorna. Yep.
  [42:42] Dana Whitfield: And everybody, receipts in the tool by Friday.
  [42:47] Sam Okafor: The tool. (unclear)
  [42:48] Grace Adeyemi: The tool. (unclear)
  [42:52] Rafael Ortega: The tool. Please.
  [42:55] Dana Whitfield: Ha. Okay.
  [42:59] Grace Adeyemi: And the phones at Christmas. (unclear)
  [43:03] Dana Whitfield: Still don't know. I said I'd think about it.
  [43:07] Grace Adeyemi: Okay. As long as it's on someone's, someone's mind.
  [43:12] Dana Whitfield: It's on my mind. (unclear)
  [43:17] Sam Okafor: Wait, sorry, one more. The eleventh. The cutoff.
  [43:22] Sam Okafor: My big accounts won't look at a banner. They don't go on the site. (unclear)
  [43:28] Grace Adeyemi: The order emails will have it.
  [43:31] Sam Okafor: Yeah, but by then they've already ordered late. (unclear)
  [43:36] Sam Okafor: I'll ring my top ten this week. Tell them the eleventh.
  [43:43] Dana Whitfield: Yeah, good. Good idea. (unclear)
  [43:46] Grace Adeyemi: Tell them it's ground. Express is still till the twentieth.
  [43:51] Sam Okafor: Ground the eleventh, express the twentieth. Got it.
  [43:56] Kofi Mensah: Express is till the twentieth if Ridgeway says so. I'll ask him that too. (unclear)
  [44:02] Grace Adeyemi: Okay. Okay.
  [44:07] Rafael Ortega: Uh... (unclear)
  [44:14] Dana Whitfield: Okay. Okay, now I'm actually stopping it.
  [44:24] Dana Whitfield: Okay, that's, that's us. Thanks everyone.
  [44:27] Kofi Mensah: Cheers.
  [44:28] Grace Adeyemi: Bye!
  [44:31] Rafael Ortega: Gracias, bye. (unclear)`,
    expect: {
      decisions: [
        { what: 'Place the January nitrile glove order now instead of waiting for the late container to land', at: '11:13' },
        { what: 'From December 1st returns go only through the form on the site, with staff filling it in for customers who phone; no more phone returns', at: '15:11' },
        { what: 'Pemberton gets 3% off its Christmas order instead of free shipping, and pays the shipping', at: '26:20' },
        { what: 'No new trial accounts until January', at: '26:59' },
        { what: 'The warehouse Saturday shift is kept through December 19th (about $1,584 for four temps over three Saturdays, in the budget)', at: '29:12' },
        { what: 'The last day to order by ground for delivery before Christmas is Friday, December 11th (the carrier needs five working days in December)', at: '40:14' }
      ],
      questions: [
        { what: 'Whether to offer the big accounts free return shipping in January (Rafael doesn\'t yet know what returns cost last January)', at: '17:25' }
      ],
      actions: [
        { what: 'Recount the whole of aisle 12 (the medium nitrile count is about 60 boxes short)', owner: 'Kofi Mensah', due: 'Thursday', at: '03:15' },
        { what: 'Send out the January glove PO, showing it to Rafael before it goes', owner: 'Dana Whitfield', due: 'Friday', at: '11:23' },
        { what: 'Ask Hollis Packaging whether orders placed now keep the old box price before the 8% rise', owner: 'Dana Whitfield', due: 'this week', at: '12:00' },
        { what: 'Brief the customer service team on form-only returns', owner: 'Grace Adeyemi', due: 'Wednesday, or no due date (either is right)', at: '15:20' },
        { what: 'Put the ground holiday cutoff (December 11th) on the site banner and in the order emails', owner: 'Grace Adeyemi', due: 'Monday', at: '16:26' },
        { what: 'Work out who covers the customer service phones from December 24th to 26th (Dana will have a think)', owner: 'Dana Whitfield', due: null, at: '17:43' },
        { what: 'Hand in November expense receipts in the expenses tool', owner: null, due: 'this Friday', at: '20:54' },
        { what: 'Call Brightsmile about their invoice, now 60 days overdue', owner: 'Sam Okafor', due: null, at: '21:52' },
        { what: 'Redo the Pemberton quote with 3% off and send it', owner: 'Sam Okafor', due: 'Wednesday', at: '26:32' },
        { what: 'Email Kofi the written approval for the Saturday shift', owner: 'Rafael Ortega', due: 'today', at: '29:31' },
        { what: 'Tell the temps the Saturday shift continues', owner: 'Kofi Mensah', due: 'tomorrow', at: '29:36' },
        { what: 'Get three quotes for replacing dock door 3\'s motor (over $5,000, so it goes through purchasing)', owner: 'Dana Whitfield', due: null, at: '30:15' },
        { what: 'Send Dana the dock door photos and the repair man\'s number', owner: 'Kofi Mensah', due: 'today', at: '30:22' },
        { what: 'Forward Sam the thread about Pemberton\'s complaint', owner: 'Grace Adeyemi', due: null, at: '35:32' },
        { what: 'Ask Ridgeway\'s freight side when Pemberton must confirm its 40-pallet order to arrive before Christmas', owner: 'Kofi Mensah', due: null, at: '41:13' },
        { what: 'Ring his top ten accounts about the December 11th ground cutoff', owner: 'Sam Okafor', due: 'this week', at: '43:36' }
      ],
      acceptable: [
        'The ground cutoff first set at December 16th, then changed to December 11th',
        'Kofi first taking the dock door quotes, then handing them to Dana',
        'Kofi putting in a ticket for Jonah about the scanner guns that won\'t hold a charge (as a follow-up)',
        'Grace getting the returns form\'s reason dropdown onto Jonah\'s list for Monday (as a follow-up)',
        'Rafael working out what returns cost last January (as a follow-up)',
        'Rafael looking at whether to buy out the reach truck lease in March (as a follow-up)',
        'Getting a third, domestic glove quote, or a stand at the Columbus trade show in February (as suggestions or follow-ups for Dana)',
        'Sam telling the trial-account leads to come back in January (as a follow-up)',
        'Kofi asking Ridgeway whether express runs until the 20th (as a follow-up)',
        'Express shipping running until about December 20th',
        'The Penang glove container slipping to the first week of December; medium nitrile running tight',
        'Hollis Packaging raising corrugated prices 8% from January; the apron price going from 480 to 540 a case',
        '140 open returns; the inbox tool marking messages answered when opened',
        'Month-end close on the 27th; Rafael sending next year\'s budget sheet next week',
        'The racking inspection staying on December 9th',
        'Pemberton\'s 40-pallet Christmas order (about 62,000) not yet confirmed and depending on the late container',
        'Rafael telling the auditors to keep the warehouse walk short and wear hi-vis (as a follow-up)'
      ],
      never: [
        'December 16th as the final ground cutoff',
        'Kofi as the one getting the dock door quotes in the end',
        'Whether to keep the Saturday shift as an open or unanswered question',
        'A person called Pam Burton',
        'Free shipping on Pemberton\'s order',
        'An overtime cost of 1,200',
        'A Saturday shift running to the 26th or 27th',
        'Anything from the Ukrainian, French or Russian lines (thanks for watching, subtitles, to be continued)'
      ]
    }
  },
  {
    id: 'workshop-room-long',
    checks: 'A 45-minute room recording of a planning workshop, where nobody can tell who spoke: owners only from names said aloud, a decision reversed after a speakerphone call, crosstalk, a break and a whiteboard nobody can see.',
    title: 'Q1 warehouse planning workshop',
    kind: 'room',
    organizer: 'Mei Lin Zhou',
    invited: ['Kofi Mensah', 'Lukas Brenner', 'Dana Whitfield', 'Tomás Ibarra', 'Rafael Ortega'],
    language: 'call',
    writtenIn: 'en',
    gaps: [],
    transcript: `
  [00:03] Sous-titres réalisés par la communauté d'Amara.org
  [00:27] Is it on? Is the little light...
  [00:33] Yeah, it's red, it's going.
  [00:39] Okay. Okay, it's recording, Mei Lin's got it on her phone.
  [00:46] Put it in the middle. Put it, yeah, there.
  [00:52] Um... (unclear)
  [01:00] Does this marker work? This one's dead.
  [01:03] Try the blue. (unclear)
  [01:09] The blue's dead too. Who keeps putting dead markers back?
  [01:15] Ha. (unclear)
  [01:18] It's always the same person.
  [01:24] It's not me.
  [01:27] It's definitely you, Lukas.
  [01:33] Okay, black. Black works.
  [01:40] Uh... (unclear)
  [01:48] Are we waiting for Tomás or...
  [01:54] He said he's on the floor, he'll be five minutes.
  [02:00] Let's just start, he can catch up.
  [02:03] Yeah.
  [02:10] Okay so. Next quarter. The idea today is we
  [02:16] get everything on the board, all the changes for the warehouse,
  [02:22] and figure out what actually happens and in what order.
  [02:28] Mm-hm. (unclear)
  [02:34] Because last quarter we said we'd do like nine things and we did, what, two.
  [02:40] Two and a half.
  [02:43] Ha. Two and a half. (unclear)
  [02:49] The half was the fridge.
  [02:52] The fridge counts. (unclear)
  [02:59] So, budget's forty-five thousand for the quarter. That's what Rafael sent.
  [03:05] Forty-five.
  [03:08] Forty-five. (unclear)
  [03:15] Okay, let me write the list. Re-slotting,
  [03:27] returns, the dock thing,
  [03:33] scanners, the packing bench... what else.
  [03:39] The stock count. (unclear)
  [03:42] The stock count's not really a change.
  [03:48] No but it gets in the way of everything else, so put it up.
  [03:54] Okay. Fair.
  [04:01] Uh... (unclear)
  [04:07] Can you write bigger? I can't read it from here.
  [04:10] It's my handwriting, it doesn't get bigger.
  [04:13] Ha. (unclear)
  [04:23] Hey. Sorry. Sorry, sorry.
  [04:26] Tomás!
  [04:29] The reach truck was blocking aisle four, I had to
  [04:35] move it myself, nobody else had the ticket.
  [04:41] Did I miss anything?
  [04:44] Just the list. And Lukas's markers.
  [04:47] They're not my markers.
  [04:53] Ha. (unclear)
  [04:59] Okay so, sit, sit.
  [05:05] Wait, before we go, the forty-five,
  [05:11] does that include the scanners? Or is that IT's money?
  [05:17] Um... (unclear)
  [05:20] I don't know actually.
  [05:26] Last time the scanners came out of IT.
  [05:32] I think. I don't know.
  [05:38] We'll ask Rafael. He said he'd be around after lunch.
  [05:44] Okay. Question mark next to it.
  [05:47] Yeah. (unclear)
  [05:54] Okay. Re-slotting.
  [06:00] So this is the big one.
  [06:06] Right now the fast movers are all over the place. Like the
  [06:12] nitrile gloves are in aisle eleven. Eleven! That's the back wall.
  [06:18] Yeah, the pickers walk the whole building for the gloves.
  [06:24] Which is like half our orders.
  [06:27] More than half. (unclear)
  [06:33] I did a pick run last week, I did eleven thousand steps before lunch.
  [06:36] That's good for you. (unclear)
  [06:42] It's not good for the orders.
  [06:49] So the idea is, the top, whatever, the top forty SKUs
  [06:55] go into aisles one to three, right next to packing.
  [07:01] Mm. (unclear)
  [07:04] Forty or fifty?
  [07:10] I said forty last time. (unclear)
  [07:16] Forty is what fits. Aisles one to three are like,
  [07:22] forty-two pick faces or something. Forty-two, forty-four.
  [07:29] Okay so forty.
  [07:32] Yeah.
  [07:38] How do we know what the top forty are though? Is it by orders or by units?
  [07:44] By picks. By how often someone walks to it.
  [07:50] Yeah, picks. Not units, because a pallet of
  [07:56] bin liners is one pick and it's like six hundred units.
  [08:02] Right.
  [08:09] The scanner logs have it. We can in fur it from the scan logs, every pick is a scan.
  [08:15] Can we though? Stockwise exports are a nightmare.
  [08:21] They are a nightmare but the data's in there.
  [08:28] Uh... (unclear)
  [08:34] Where do they go, the ones that are in one to three now?
  [08:40] Back. They swap. Whatever's slow goes to eleven.
  [08:46] The Christmas stuff can go to eleven forever.
  [08:49] Ha. Yes. (unclear)
  [08:55] Okay, so is everyone okay with that? Top forty by picks, aisles one to three.
  [08:58] Yeah.
  [09:01] Yeah, fine. (unclear)
  [09:04] Mm-hm.
  [09:10] Okay. Star on that one.
  [09:17] Who's pulling the list? The top forty.
  [09:24] Kofi, you did the export last time, right?
  [09:30] Ugh. Yes.
  [09:36] You're the only one who knows how.
  [09:42] That's not a compliment, that's a curse.
  [09:45] Ha. (unclear)
  [09:51] Fine. I'll pull the top forty. By Friday? I can do Friday.
  [09:57] Friday's great.
  [10:04] Um. (unclear)
  [10:12] And when do we actually move it? Because
  [10:18] that's like a whole weekend, you're moving forty locations,
  [10:24] relabelling everything, updating the system.
  [10:31] January. We do it with the stock count. Everything's
  [10:37] stopped anyway for the count, the whole floor is
  [10:43] counted, so we move stuff at the same time, one disruption, not two.
  [10:49] Oh, that's smart. (unclear)
  [10:55] Yeah. Kill two birds.
  [11:01] Hmm. (unclear)
  [11:04] Is that allowed? (unclear)
  [11:10] Why wouldn't it be allowed?
  [11:16] I don't know, I just... (unclear)
  [11:22] No, it's fine. January, with the count. Done.
  [11:29] Okay. January. Writing it. (unclear)
  [11:35] What's the date of the count again?
  [11:38] The ninth. Saturday the ninth.
  [11:44] Ninth. Okay.
  [11:54] Okay. Returns.
  [12:00] Ugh. Returns.
  [12:06] So returns right now is in the back corner, behind the
  [12:12] the cage, you know, where the old shrink-wrapper was.
  [12:18] And the problem is every return comes in through door six and then
  [12:24] someone pushes it all the way back there, across the whole floor,
  [12:30] through the picking aisles. (unclear)
  [12:36] Which, with the new aisles one to three, is gonna be right in the way.
  [12:39] Yeah. (unclear)
  [12:53] So, I drew two options. Can you see?
  [12:59] Option A, returns goes up to the mezzanine,
  [13:05] option B, it goes right by door six, where the empty pallets are now.
  [13:11] The mezzanine's a no.
  [13:14] Why?
  [13:20] You can't get a pallet jack up there. You'd be carrying every box up the stairs.
  [13:26] Oh, yeah. (unclear)
  [13:32] Right, no, the mezzanine's dead.
  [13:38] So it's that one. The second column.
  [13:41] B.
  [13:44] B, yeah. Door six.
  [13:50] And the empty pallets go where?
  [13:56] Outside. Under the canopy. They're fine outside.
  [14:02] They get wet.
  [14:08] They're pallets, Dana. (unclear)
  [14:11] Ha!
  [14:17] Okay, they go outside. (unclear)
  [14:24] But there's no power by door six. For returns you need the
  [14:30] label printer and the, um, the bench scanner, so you need sockets.
  [14:36] Oh. Yeah. (unclear)
  [14:42] So we need the electrician in before we move it.
  [14:48] Who's... (unclear)
  [14:51] I can call (unclear)
  [14:51] I'll ring the (unclear)
  [14:54] Sorry. (unclear)
  [15:00] Someone book the electrician. Before the move.
  [15:03] Yeah.
  [15:11] Um... (unclear)
  [15:18] Is there anything with the fire stuff, though? Like if
  [15:24] we move racks around and put a station by door six, door six is
  [15:30] basically a fire exit, isn't it? Do we have to get the inspection redone?
  [15:36] Hmm. (unclear)
  [15:42] Ask Gordon. He'll know. (unclear)
  [15:48] Who's Gordon?
  [15:54] The warden. The fire warden. (unclear)
  [15:57] Oh. Ha. (unclear)
  [16:03] I genuinely don't know if moving racks triggers it.
  [16:09] I think it's only if you change the exits.
  [16:15] Are we changing the exits?
  [16:21] We're putting stuff near one.
  [16:27] Yeah, I don't know. (unclear)
  [16:33] Okay, question mark. Another question mark.
  [16:39] The board is all question marks.
  [16:42] Ha. (unclear)
  [16:54] Dock.
  [17:00] Okay, so this one's mine. (unclear)
  [17:06] The carriers just turn up whenever. Like yesterday we had three
  [17:12] trucks at eight-fifteen and then nothing till three.
  [17:18] And at three everybody's packing outbound and the inbound truck's
  [17:24] sitting there. With the driver on his phone. Honking.
  [17:27] The honking. (unclear)
  [17:33] The honking guy! (unclear)
  [17:36] He's the worst.
  [17:43] So what I want is fixed slots. Inbound gets the mornings, like
  [17:49] seven to twelve, and outbound gets the afternoon. No inbound after twelve.
  [17:55] What about the, the Kessler deliveries, they always come at two.
  [18:01] Then they move. They can move. We're the customer.
  [18:07] Can they though? (unclear)
  [18:13] I've asked them. Their driver said mornings are actually better for him.
  [18:16] Oh. Okay.
  [18:22] So, morning inbound, afternoon outbound. Everyone?
  [18:25] Yeah.
  [18:28] Yeah, makes sense.
  [18:31] Yes. Fine.
  [18:38] Okay. So I'll do up the slots, like an actual schedule, with
  [18:44] who comes when, and send it to all the carriers.
  [18:50] By when?
  [18:56] By the eighteenth. So they have it before the holidays.
  [19:02] Great.
  [19:09] Um... (unclear)
  [19:17] We're still closed from the twenty-sixth to the first, right?
  [19:20] Yes.
  [19:23] Yeah, twenty-sixth to the first.
  [19:29] Okay, so that goes on the schedule too.
  [19:36] Uh... (unclear)
  [19:43] Did anyone do anything this weekend? I need a minute.
  [19:49] I went up the... the... (unclear)
  [19:55] the Catskills. It snowed. We didn't know it would snow.
  [20:01] You went hiking in the snow?
  [20:07] Not on purpose! (unclear)
  [20:10] Ha!
  [20:16] Tomás was in shorts.
  [20:22] I was in shorts. My legs were purple.
  [20:28] That's, yeah, that's on you.
  [20:34] It said twelve degrees.
  [20:40] Twelve Celsius or twelve Fahrenheit?
  [20:46] ...I didn't check. (unclear)
  [20:49] Oh, Tomás. (unclear)
  [20:55] Twelve Fahrenheit is like minus ten.
  [21:01] I know that now. (unclear)
  [21:04] Ha! (unclear)
  [21:24] Okay. Okay. Scanners.
  [21:30] So the scanners are dying. Like, half of them
  [21:36] won't hold a charge past lunch.
  [21:42] And the ones that do freeze when Stockwise updates.
  [21:48] Stockwise freezes when you look at it.
  [21:54] God, I hate Stockwise. I fucking hate it.
  [22:00] We all hate it.
  [22:06] Yesterday it logged me out four times in one pick run. Four.
  [22:12] And every time you log back in it forgets the batch, so you
  [22:18] start the batch again. (unclear)
  [22:21] Yeah.
  [22:27] And support just says clear your cache. Clear your cache! On a scanner!
  [22:33] Anyway, that's not this quarter, Stockwise is
  [22:39] a whole other... that's a next year problem.
  [22:42] Yeah. (unclear)
  [22:49] So how many scanners do we need?
  [22:55] We have twenty. All twenty are bad.
  [23:01] Not all twenty. Like, fourteen are bad.
  [23:07] So we replace twenty.
  [23:13] Twenty's a lot. (unclear)
  [23:19] What do they cost?
  [23:25] The Zebra ones were fourteen-fifty each.
  [23:31] Fourteen-fifty, times twenty.
  [23:37] Twenty-nine thousand. (unclear)
  [23:40] Twenty-nine?
  [23:46] Twenty-nine thousand. That's most of the forty-five.
  [23:52] If it comes out of the forty-five.
  [23:58] Right, if. (unclear)
  [24:04] That's why we need Rafael.
  [24:11] Okay, what if we just do twelve?
  [24:17] Like the worst twelve, and keep the six good ones and
  [24:23] the two spares. (unclear)
  [24:29] Twelve times fourteen-fifty is... fourteen five?
  [24:35] No, that's ten. Ten is fourteen five.
  [24:41] Twelve is, um... seventeen four.
  [24:47] Seventeen four. Yeah.
  [24:53] Seventeen four, okay.
  [24:59] If it's still fourteen-fifty. That was last year's price.
  [25:05] Tomás, can you check with Zebra it's still fourteen-fifty? You know the rep.
  [25:11] Yeah, I'll ask her today.
  [25:18] Um... (unclear)
  [25:25] You should also look at those label printers, Tomás, the
  [25:31] little belt ones, while you're talking to Zebra.
  [25:34] Yeah, maybe. (unclear)
  [25:40] The ones in packing are older than me.
  [25:46] Nothing's older than you.
  [25:49] Ha! (unclear)
  [25:56] Okay, I'm putting twelve, question mark, until we talk to Rafael.
  [26:02] Can we break? I need coffee. And the bathroom.
  [26:05] Yeah, ten minutes.
  [26:11] Ten minutes, and then we call Rafael.
  [26:17] I'll text him. (unclear)
  [26:24] Mm. (unclear)
  [26:42] Uh... (unclear)
  [27:09] Дякую за перегляд!
  [27:54] door's stuck again (unclear)
  [28:04] Is it still recording? (unclear)
  [28:10] Yeah, leave it.
  [28:30] Okay. (unclear)
  [28:42] Did he answer?
  [28:48] He says call him now, he's got ten minutes.
  [28:51] Okay. Put him on speaker.
  [28:59] Hello? (unclear)
  [29:05] Rafael? Can you hear us?
  [29:11] Yeah, I can... you're very far away. (unclear)
  [29:17] We're all in the meeting room, you're on the table.
  [29:23] Hi everyone. (unclear)
  [29:26] Hi!
  [29:26] Hey Rafael.
  [29:32] Okay quick one, the forty-five thousand,
  [29:38] is that all of it? Does it include the scanners?
  [29:45] Yes. Forty-five's everything for the quarter. (unclear)
  [29:51] Scanners, racking, all of it. IT's not paying for scanners anymore. (unclear)
  [29:57] Since when?
  [30:03] Since the budget thing in September. It all comes out of ops now. (unclear)
  [30:09] Ugh. Okay.
  [30:15] So twenty scanners is twenty-nine thousand and that's
  [30:21] that's two thirds. (unclear)
  [30:27] You can't do twenty. (unclear)
  [30:33] Yeah, no. So twelve.
  [30:39] Twelve. The worst twelve. That's seventeen four. (unclear)
  [30:45] Twelve's fine with me. (unclear)
  [30:51] Okay, twelve scanners.
  [30:54] Yeah. (unclear)
  [31:00] Rafael, can you send us the breakdown? What's left after the scanners? (unclear)
  [31:06] Yeah, I'll send it tomorrow. (unclear)
  [31:12] Thanks. (unclear)
  [31:18] And Tomás, you'll order them?
  [31:24] Yeah, I'll put the order in Monday.
  [31:30] One more thing for you, Rafael. (unclear)
  [31:36] We were gonna do the re-slot during the January count. (unclear)
  [31:42] Moving forty bin locations.
  [31:49] During the count? (unclear)
  [31:55] You can't move locations during the count. The auditors (unclear)
  [32:01] the auditors count by location, if things move while they're counting (unclear)
  [32:07] it's, you're (unclear)
  [32:13] Rafael? (unclear)
  [32:16] You froze. (unclear)
  [32:22] Rafael, we lost you.
  [32:28] hello? (unclear)
  [32:34] We lost you after the auditors.
  [32:40] location mismatch, they'll flag the whole count. Don't do it in January. Not during. (unclear)
  [32:46] Okay. Okay. (unclear)
  [32:52] My train's going in a tunnel, I have to (unclear)
  [32:58] Okay, thanks Rafael!
  [33:01] Bye! (unclear)
  [33:01] Thanks! (unclear)
  [33:16] Well. Shit. (unclear)
  [33:22] Yeah.
  [33:28] So January's out.
  [33:34] I mean, he didn't say January's out, he said not during the count.
  [33:40] We could do it the weekend before.
  [33:46] The weekend before the count is the second, third. We're closed till the first.
  [33:52] We come back on the second and move forty locations? No. No way.
  [33:58] Yeah, no. (unclear)
  [34:04] After then. After the count. (unclear)
  [34:10] The weekend after is the sixteenth.
  [34:16] That's when the January sale orders hit.
  [34:22] Oh, God, yes.
  [34:29] Um... (unclear)
  [34:36] So February. First weekend of February.
  [34:42] That's the, the thirty... no.
  [34:48] February first is a Monday, so the sixth. Sixth and seventh.
  [34:54] Sixth and seventh, yeah.
  [35:00] Is anyone against February? (unclear)
  [35:03] No.
  [35:06] No, better. Honestly better. (unclear)
  [35:12] Okay, re-slot is the first weekend of February. After the count. Crossing out January.
  [35:15] Yeah.
  [35:22] Then we need the racking guys for that weekend.
  [35:28] Lukas, you've got the racking contractor's number.
  [35:34] Yeah, Halvorsen. I'll get a quote off them for that weekend.
  [35:40] And ask what weekend costs, because last time
  [35:46] the weekend rate was like double.
  [35:52] I'll ask. I don't know what they'll say.
  [36:22] Uh... (unclear)
  [36:29] Who's actually doing the moving though? Our people. On a Saturday.
  [36:35] Night shift. Sam's lot. They're used to the weird hours.
  [36:41] Has anyone asked Sam? (unclear)
  [36:47] No.
  [36:53] Sam's on holiday till the fourteenth.
  [36:59] So we don't know if night shift can even do it.
  [37:05] No. (unclear)
  [37:11] Kofi, you're on with Sam, can you talk to him when he's back?
  [37:17] Yeah, I'll talk to Sam. (unclear)
  [37:20] Thanks.
  [37:27] Uh... (unclear)
  [38:07] Okay. The packing bench.
  [38:13] So, my thing. (unclear)
  [38:19] At peak we've got people packing on the floor. Literally on the floor. On cardboard.
  [38:25] That was one day.
  [38:31] It was four days. (unclear)
  [38:37] A second bench is, the quote was eight thousand. Eight with the
  [38:43] shelving and the, the scale. (unclear)
  [38:49] Eight thousand. After seventeen four for the scanners,
  [38:55] and the racking weekend which we don't know, and the electrician.
  [39:01] Yeah.
  [39:07] Peak's over though. Peak's December. The bench would arrive in, what, February.
  [39:13] For nothing.
  [39:19] Not for nothing, there's Valentine's, there's
  [39:25] There's no Valentine's in gloves, Dana.
  [39:28] Ha! (unclear)
  [39:34] There's a little bit. (unclear)
  [39:41] Okay, honestly. Not this quarter. Look again in April.
  [39:47] Yeah. I hate it, but yeah. (unclear)
  [39:50] Fine. (unclear)
  [39:56] No second bench this quarter, April.
  [40:03] Um... (unclear)
  [40:10] For returns, someone needs to tape the floor, so people stop parking pallets there.
  [40:16] I'll do it. I'll tape it out next week.
  [40:22] Thanks, Dana.
  [40:44] Okay. Are we, are we done? I think we're done.
  [40:50] Can someone recap? Because I'm gonna forget.
  [40:56] Okay. So. Re-slot, top forty by picks, aisles one to three,
  [41:02] first weekend of February. Kofi's pulling the list by Friday.
  [41:08] Returns to door six. Electrician before that.
  [41:14] Who's booking the electrician?
  [41:20] I thought you were. (unclear)
  [41:26] I thought you were. (unclear)
  [41:29] Ha. (unclear)
  [41:35] Okay, someone. Someone books the electrician. Moving on.
  [41:41] Dock slots, Kofi's doing the schedule by the eighteenth.
  [41:47] No, that's Dana. That's mine.
  [41:53] Sorry, Dana's doing the schedule. Kofi's on the list and Sam.
  [41:59] Yeah.
  [42:05] Tomás orders twelve scanners Monday.
  [42:08] Twelve. (unclear)
  [42:14] Lukas, the racking quote. Rafael sends the budget.
  [42:20] No bench, April. And the fire thing, still a question mark.
  [42:26] Can someone take a photo of the board?
  [42:32] Mei Lin, you're recording, can you send the photo too? With the recording?
  [42:38] Yeah, I'll send it round tonight.
  [42:44] Don't wipe it. Nobody wipe the board.
  [42:50] I'm writing do not wipe. (unclear)
  [42:56] Someone will wipe it. (unclear)
  [42:59] Lukas will wipe it.
  [43:05] I will not! (unclear)
  [43:08] Ha. (unclear)
  [43:14] Okay, thanks everyone. (unclear)
  [43:20] Obrigado. Tchau tchau. (unclear)
  [43:26] Bye. (unclear)`,
    expect: {
      decisions: [
        { what: 'The top forty SKUs by picks move into aisles one to three, next to packing', at: '09:10' },
        { what: 'Returns moves from the back corner to beside door six (option B, the second column on the whiteboard), not the mezzanine', at: '13:44' },
        { what: 'Fixed dock slots: inbound deliveries in the morning (seven to twelve), outbound in the afternoon, no inbound after twelve', at: '18:31' },
        { what: 'Replace only the worst twelve scanners (about 17,400), since the 45,000 quarter budget has to cover them', at: '30:51' },
        { what: 'The re-slot happens on the first weekend of February (the 6th and 7th), after the stock count, not during it', at: '35:12' },
        { what: 'No second packing bench this quarter; look at it again in April', at: '39:56' }
      ],
      questions: [],
      actions: [
        { what: 'Pull the top-forty list by picks from the scanner logs / Stockwise export', owner: 'Kofi Mensah', due: 'Friday', at: '09:51' },
        { what: 'Book the electrician to put sockets in by door six before returns moves there', owner: null, due: 'before the returns move, or no due date (either is right)', at: '15:00' },
        { what: 'Ask the fire warden whether moving the racks and putting returns by door six, a fire exit, means the fire inspection has to be redone', owner: null, due: null, at: '15:42', alsoAs: 'question' },
        { what: 'Draw up the dock slot schedule and send it to all the carriers', owner: 'Dana Whitfield', due: 'the 18th', at: '18:56' },
        { what: 'Check with the Zebra rep that the scanners are still 1,450 each', owner: 'Tomás Ibarra', due: 'today', at: '25:11' },
        { what: 'Send the budget breakdown: what is left after the scanners', owner: 'Rafael Ortega', due: 'tomorrow', at: '31:06' },
        { what: 'Order the twelve scanners', owner: 'Tomás Ibarra', due: 'Monday, or no due date (either is right)', at: '31:24' },
        { what: 'Get a quote from Halvorsen, the racking contractor, for the February weekend, including the weekend rate', owner: 'Lukas Brenner', due: null, at: '35:34' },
        { what: 'Talk to Sam, when he is back from holiday, about the night shift doing the re-slot', owner: 'Kofi Mensah', due: null, at: '37:17' },
        { what: 'Tape out the new returns area by door six so people stop parking pallets there', owner: 'Dana Whitfield', due: 'next week, or no due date (either is right)', at: '40:16' },
        { what: 'Send everyone the photo of the whiteboard with the recording', owner: 'Mei Lin Zhou', due: 'tonight', at: '42:38' }
      ],
      acceptable: [
        'The re-slot first planned for January during the stock count, then moved to February after Rafael warned the auditors would flag the count',
        'The 45,000 covers everything this quarter, scanners included, since IT no longer pays for them',
        'Twelve scanners at 1,450 each, about 17,400 (twenty would have been about 29,000)',
        'What Halvorsen will charge for a weekend, last time about double (as part of Lukas\'s quote)',
        'Looking at new label printers while talking to Zebra (as a suggestion or a follow-up for Tomás)',
        'The empty pallets go outside under the canopy (as a decision)',
        'Kessler moving its deliveries to the mornings',
        'The stock count is Saturday January 9th; the warehouse is closed from the 26th to the 1st',
        'Stockwise\'s freezing and log-outs, left for next year (mentioned)'
      ],
      never: [
        'Re-slotting during the January stock count as the final plan',
        'Buying twenty scanners',
        'Gordon as the owner of anything, or as someone in the meeting (naming him as the fire warden to ask is right)',
        'Anything from the French subtitle line or the Ukrainian "thanks for watching" line',
        'Returns moving to the mezzanine',
        'A second packing bench this quarter',
        'Whether the 45,000 includes the scanners, as an open question',
        'Anyone named as the owner of booking the electrician'
      ]
    }
  }
];
