/*
 * The notes eval's cases built to show missing notes: three long, dense meetings, kept out of the default run. They run
 * with `eval:notes --suite missing`, or one at a time with `--case`. The first ends with a recap that leaves out jobs
 * and reverses one, after two people have left; the second has more decisions and follow-ups than the notes keep; the
 * third is a room recording long enough that the middle of its transcript is cut before the notes model reads it.
 * Same format and rules as cases.ts.
 */
import type { EvalCase } from './cases';

export const MISSING_CASES: EvalCase[] = [
  {
    id: 'planning-recap-missing',
    checks: 'A 61-minute planning call that ends with a recap of twelve jobs, after Dana and Rafael have left and with Kofi away all call: the recap leaves out eight jobs given earlier (Rafael\'s budget sheet, Dana\'s power and wi-fi, Kofi\'s graphics, Sam\'s van height, Lukas\'s shelf and the three nobody took on) and scraps the catalogue print run for QR cards. The notes still find every job, with the person it was given to, and keep only the final catalogue plan.',
    title: 'Spring range and Harrowgate fair planning',
    kind: 'call',
    organizer: 'Grace Adeyemi',
    invited: ['Mei Lin Zhou', 'Sam Okafor', 'Lukas Brenner', 'Dana Whitfield', 'Rafael Ortega', 'Kofi Mensah'],
    language: 'call',
    writtenIn: 'en',
    gaps: [{ kind: 'paused', at: '32:22', minutes: 3 }],
    transcript: `
  [00:02] Grace Adeyemi: Дякую за перегляд!
  [00:24] Grace Adeyemi: Sous-titres réalisés par la communauté d'Amara.org
  [00:43] Mei Lin Zhou: Hello? (unclear)
  [00:46] Grace Adeyemi: Hi Mei Lin. Hi. Can you hear me okay?
  [00:50] Mei Lin Zhou: Yeah, you're a bit quiet but yeah.
  [00:54] Grace Adeyemi: Hang on. Is that better? (unclear)
  [00:57] Mei Lin Zhou: Better.
  [01:03] Rafael Ortega: Hi all. Sorry, I'm on the train, I might cut out.
  [01:07] Grace Adeyemi: No worries. Where are you off to?
  [01:12] Rafael Ortega: Back from the bank thing in town. The train's just sitting outside the station, so. (unclear)
  [01:18] Mei Lin Zhou: Classic.
  [01:23] Dana Whitfield: Hiya.
  [01:25] Grace Adeyemi: Hi Dana.
  [01:28] Dana Whitfield: Sorry, the dog's going mad, someone's at the door. One sec. (unclear)
  [01:41] Sam Okafor: Hello. I'm here. I'm in the warehouse office so it's a bit loud.
  [01:45] Grace Adeyemi: Hi Sam.
  [01:50] Dana Whitfield: Okay, sorry. It was the post. He hates the post.
  [01:54] Mei Lin Zhou: Ha. They all hate the post. (unclear)
  [02:00] Grace Adeyemi: Okay so, Lukas is at the depot, he said he'll be late, and Kofi's off till Wednesday,
  [02:06] Grace Adeyemi: so it's just us for now. Let's start.
  [02:10] Rafael Ortega: Okay.
  [02:14] Grace Adeyemi: So today is the spring range and Harrowgate. The fair. I want to get through
  [02:20] Grace Adeyemi: the range, the stand, the catalogue, prices, samples, and then who's going and how. (unclear)
  [02:26] Sam Okafor: That's a lot.
  [02:28] Grace Adeyemi: It's a lot. It's an hour. Maybe more.
  [02:33] Dana Whitfield: I've got a hard stop at quarter to, just so you know. Ostrander. (unclear)
  [02:37] Grace Adeyemi: Okay. Then let's do your bits early.
  [02:41] Mei Lin Zhou: Um, can I start with the range, because it changes the catalogue?
  [02:45] Grace Adeyemi: Go.
  [02:49] Mei Lin Zhou: Are we putting the bamboo kitchen range in the spring launch? Because if we are I need
  [02:55] Mei Lin Zhou: the photos this week. (unclear)
  [02:58] Grace Adeyemi: No. The bamboo waits for autumn. The supplier still hasn't fixed the lids.
  [03:04] Mei Lin Zhou: Okay. Autumn. Good, honestly.
  [03:07] Sam Okafor: The lids are bad. They just pop off. (unclear)
  [03:11] Grace Adeyemi: Yeah. So, autumn. It's out of spring.
  [03:15] Mei Lin Zhou: Okay.
  [03:22] Grace Adeyemi: Okay, the stand. Penfold asked again if we want to share with them.
  [03:28] Dana Whitfield: Again? (unclear)
  [03:31] Grace Adeyemi: Again. They'd pay half, we'd get half the space.
  [03:37] Rafael Ortega: Half the cost is nice.
  [03:40] Dana Whitfield: But their buyers are our buyers. Half the people who'd come to us would just
  [03:46] Dana Whitfield: stand on Penfold's half and order from them. (unclear)
  [03:50] Sam Okafor: And last time they took the whole front. (unclear)
  [03:54] Grace Adeyemi: Yeah. No, I agree. We do our own stand. Not sharing with Penfold this year.
  [04:01] Rafael Ortega: Fine. It's in the budget anyway.
  [04:04] Grace Adeyemi: Which is... remind me?
  [04:08] Rafael Ortega: Eighteen thousand. All in. Stand, travel, hotel, samples, the lot. (unclear)
  [04:14] Grace Adeyemi: Eighteen. Okay.
  [04:17] Rafael Ortega: I've got a sheet with it all split out. I'll send it to you Friday.
  [04:22] Grace Adeyemi: Great, thanks.
  [04:28] Grace Adeyemi: And the floor plan. Kofi's doing the stand floor plan with the organisers,
  [04:34] Grace Adeyemi: he said he'll do it Wednesday when he's back.
  [04:38] Sam Okafor: Does he know it's a corner this year? (unclear)
  [04:41] Grace Adeyemi: He knows. He picked it.
  [04:45] Sam Okafor: Okay.
  [04:51] Sam Okafor: Last year at Harrowgate, do you remember the forklift? (unclear)
  [04:55] Dana Whitfield: Oh god. The forklift.
  [04:58] Sam Okafor: It wouldn't fit under the loading door. We carried the whole stand in by hand.
  [05:04] Mei Lin Zhou: I wasn't there for that. (unclear)
  [05:07] Sam Okafor: You were lucky. Took three hours. Rafael's back's never been the same.
  [05:12] Rafael Ortega: It hasn't. (unclear)
  [05:15] Grace Adeyemi: Ha.
  [05:19] Sam Okafor: Oh, that reminds me, the venue wants our van's height for the loading form. I'll send them that.
  [05:25] Grace Adeyemi: Thanks.
  [05:29] Sam Okafor: It's in the logbook somewhere. (unclear)
  [05:36] Grace Adeyemi: Okay. Um. The range itself. Mei Lin, what's in it now?
  [05:41] Mei Lin Zhou: So without the bamboo it's... sixty-four products. (unclear)
  [05:46] Mei Lin Zhou: The stoneware planters, big and small, the linen napkins, the glass jars,
  [05:52] Mei Lin Zhou: the new candles, and the, um, the enamel trays. (unclear)
  [05:56] Grace Adeyemi: The trays are lovely.
  [05:59] Sam Okafor: The trays are heavy. (unclear)
  [06:03] Mei Lin Zhou: They're not that heavy.
  [06:06] Sam Okafor: Forty of them in a box is heavy. (unclear)
  [06:10] Grace Adeyemi: Ha. Okay. Do we have stock of all of it for the fair?
  [06:15] Sam Okafor: Mostly. The big planters come in on the twentieth of Feb, the rest is in. (unclear)
  [06:21] Grace Adeyemi: Twentieth. That's tight.
  [06:24] Sam Okafor: It's fine, it's three weeks before. If the boat's on time. (unclear)
  [06:29] Rafael Ortega: Is the boat ever on time?
  [06:31] Sam Okafor: Sometimes. Once. (unclear)
  [06:35] Grace Adeyemi: Ha. Okay.
  [06:41] Mei Lin Zhou: The candles, do we have the final scents? I've got four in the catalogue draft.
  [06:46] Dana Whitfield: Five. They added the fig one. (unclear)
  [06:49] Mei Lin Zhou: Oh. Okay, five, then.
  [06:53] Dana Whitfield: The fig one smells like a, like a garden centre. In a good way. (unclear)
  [06:58] Mei Lin Zhou: Ha.
  [07:04] Grace Adeyemi: Um...
  [07:09] Grace Adeyemi: Where were we. Range, yeah. So sixty-four, five candles.
  [07:13] Mei Lin Zhou: Sixty-five then, with the fig. (unclear)
  [07:16] Grace Adeyemi: Sixty-five.
  [07:21] Rafael Ortega: Sorry, I'm going into a tunnel, if I go, I'll come back. (unclear)
  [07:25] Grace Adeyemi: Okay.
  [07:31] Dana Whitfield: While he's gone, can I do the accounts bit? Because of my hard stop.
  [07:35] Grace Adeyemi: Yeah, go.
  [07:39] Dana Whitfield: So I spoke to six of the top twenty, and four of them are going to Harrowgate.
  [07:45] Dana Whitfield: Ostrander, Bellwood, Marchetti, and, um, the Crane Street lot. (unclear)
  [07:50] Grace Adeyemi: Good. And the other two?
  [07:53] Dana Whitfield: Not going. They'll do the spring orders by email like last year.
  [07:58] Grace Adeyemi: Okay.
  [08:02] Dana Whitfield: And they all asked the same thing. When are the new terms coming.
  [08:07] Grace Adeyemi: Yeah. The terms. Hang on, let's do that when Rafael's back, it's money.
  [08:11] Dana Whitfield: Okay.
  [08:17] Sam Okafor: Can I ask, are we taking the big van or the small van? (unclear)
  [08:21] Grace Adeyemi: Let's do travel later. Lukas will want a say.
  [08:25] Sam Okafor: Fair.
  [08:31] Lukas Brenner: Hello? Hi, sorry. Sorry, sorry.
  [08:34] Grace Adeyemi: Hey Lukas.
  [08:37] Lukas Brenner: The depot had a, the gate was stuck, I had to wait for them to open it by hand. (unclear)
  [08:42] Sam Okafor: The gate again.
  [08:45] Lukas Brenner: The gate again. What did I miss?
  [08:49] Grace Adeyemi: Bamboo's out, it's autumn. Own stand, no Penfold. Kofi's doing the floor plan.
  [08:55] Grace Adeyemi: Sixty-five products. That's it so far.
  [08:58] Lukas Brenner: Okay. Great. (unclear)
  [09:04] Rafael Ortega: Hello? I'm back. Out of the tunnel. (unclear)
  [09:07] Grace Adeyemi: Welcome back. Lukas is here too.
  [09:10] Rafael Ortega: Hi Lukas.
  [09:12] Lukas Brenner: Hi.
  [09:18] Grace Adeyemi: Okay. Prices. Rafael.
  [09:21] Rafael Ortega: Yeah. So. Costs are up on everything, freight mostly. (unclear)
  [09:27] Rafael Ortega: I'd modelled four percent and six percent on the spring range, wholesale.
  [09:32] Rafael Ortega: Six gets the margin back to where it was. Four gets us most of the way.
  [09:37] Dana Whitfield: Six puts us above Penfold on the planters. Like, properly above.
  [09:42] Grace Adeyemi: By how much?
  [09:45] Dana Whitfield: On the big planter, we'd be, um, two pounds over theirs? (unclear)
  [09:50] Rafael Ortega: Two forty. (unclear)
  [09:53] Dana Whitfield: Two forty. And the buyers compare. They have both catalogues open.
  [09:58] Sam Okafor: They literally do. I've seen them do it. (unclear)
  [10:03] Grace Adeyemi: Hm.
  [10:07] Rafael Ortega: Four is fine for me. I'd rather sell them.
  [10:12] Grace Adeyemi: Okay. Four then. Four percent on the spring range, wholesale.
  [10:17] Dana Whitfield: Thank you.
  [10:19] Rafael Ortega: Okay, four. (unclear)
  [10:24] Grace Adeyemi: Can you update the price list?
  [10:27] Rafael Ortega: Yeah. I'll have it updated by the fifteenth.
  [10:31] Grace Adeyemi: Great.
  [10:36] Mei Lin Zhou: The fifteenth works for the catalogue. I need prices before it goes anywhere. (unclear)
  [10:41] Rafael Ortega: You'll have them.
  [10:47] Grace Adeyemi: And the terms, Dana was asking. The new trade terms.
  [10:51] Rafael Ortega: They're with legal. They said two weeks, which was a week ago. (unclear)
  [10:56] Dana Whitfield: So a week.
  [10:58] Rafael Ortega: So a week. Or three. It's legal. (unclear)
  [11:03] Grace Adeyemi: Ha. Okay, let's come back to that.
  [11:09] Grace Adeyemi: Samples. Dana.
  [11:12] Dana Whitfield: Yeah. Do we give out free samples at the stand, or do we sell sample packs like Penfold do?
  [11:18] Lukas Brenner: Penfold sell them? (unclear)
  [11:20] Dana Whitfield: Five pounds a pack.
  [11:24] Grace Adeyemi: Free. Small ones. But only to trade, only people with a trade badge.
  [11:30] Dana Whitfield: Good. Selling them is tacky. (unclear)
  [11:33] Sam Okafor: Last year the public took the lot by eleven.
  [11:37] Grace Adeyemi: That's why trade only. Trade badges only, small free samples.
  [11:42] Mei Lin Zhou: Okay.
  [11:47] Lukas Brenner: How many packs are we talking?
  [11:51] Grace Adeyemi: Last year was what, a hundred and fifty?
  [11:55] Sam Okafor: And we ran out on day two. (unclear)
  [11:58] Grace Adeyemi: Two hundred then.
  [12:02] Lukas Brenner: I'll get the sample packs made up. Two hundred, by the end of Feb.
  [12:07] Grace Adeyemi: Perfect.
  [12:10] Lukas Brenner: What goes in them? (unclear)
  [12:13] Mei Lin Zhou: A napkin, a mini candle, a tray coaster and the card with the QR code to the catalogue.
  [12:19] Lukas Brenner: Okay. Napkin, candle, coaster, card. (unclear)
  [12:24] Dana Whitfield: The mini candles, are they the fig? (unclear)
  [12:27] Mei Lin Zhou: Whatever we've got most of.
  [12:30] Dana Whitfield: Ha. Okay.
  [12:36] Grace Adeyemi: Um...
  [12:41] Mei Lin Zhou: Can I say something about photos?
  [12:43] Grace Adeyemi: Yeah.
  [12:47] Mei Lin Zhou: The planter photos are awful. Like, really awful. They're from the supplier, they're dark,
  [12:53] Mei Lin Zhou: one of them has a, there's a man's thumb in it. (unclear)
  [12:57] Sam Okafor: Ha. Whose thumb?
  [13:00] Mei Lin Zhou: Nobody knows. The supplier's thumb.
  [13:04] Dana Whitfield: Someone should really redo the planter photos before the fair. Properly.
  [13:09] Grace Adeyemi: Yeah. They're bad.
  [13:12] Lukas Brenner: Mm.
  [13:15] Mei Lin Zhou: Yeah.
  [13:21] Grace Adeyemi: Okay. Um.
  [13:26] Grace Adeyemi: The catalogue then. Mei Lin, where are we?
  [13:30] Mei Lin Zhou: Draft's done apart from the prices and the fig candle. (unclear)
  [13:35] Mei Lin Zhou: The question is how many we print. The printer needs it by the twentieth for the fair.
  [13:41] Grace Adeyemi: Last year?
  [13:43] Mei Lin Zhou: Three hundred, and we ran out.
  [13:46] Sam Okafor: We run out of everything. (unclear)
  [13:49] Grace Adeyemi: Five hundred then.
  [13:52] Rafael Ortega: Five hundred's about, um, nine hundred pounds? (unclear)
  [13:57] Mei Lin Zhou: Eight sixty.
  [13:59] Rafael Ortega: Fine. It's in the eighteen.
  [14:03] Grace Adeyemi: Okay, five hundred printed. Mei Lin, you send it to the printer by the twentieth.
  [14:08] Mei Lin Zhou: Yep. The twentieth.
  [14:12] Lukas Brenner: Do they deliver to the venue or to us?
  [14:16] Mei Lin Zhou: To us. Then they go in the van. (unclear)
  [14:20] Lukas Brenner: Okay.
  [14:26] Grace Adeyemi: Okay, Rafael, the terms. Before Dana goes.
  [14:30] Rafael Ortega: Yeah. So legal's got them. Nothing goes out till they sign them off.
  [14:35] Grace Adeyemi: Okay. Once legal's signed off the new terms, Dana, can you send them to the top twenty accounts?
  [14:41] Dana Whitfield: Yes. Once legal's done it, I'll send them out.
  [14:45] Grace Adeyemi: Thanks.
  [14:48] Dana Whitfield: With a nice email. Not just the PDF. (unclear)
  [14:52] Rafael Ortega: Please. Last time we just sent the PDF and three of them rang me. (unclear)
  [14:57] Dana Whitfield: Ha. Yeah.
  [15:03] Grace Adeyemi: Okay. And Dana, the stand. Power and wi-fi.
  [15:07] Dana Whitfield: Oh yeah. The organisers sent the order form to me, I don't know why.
  [15:12] Grace Adeyemi: Because you booked it last year.
  [15:15] Dana Whitfield: Right. Okay, I'll book the stand's power and the wi-fi with them. End of the month.
  [15:21] Grace Adeyemi: Great.
  [15:24] Sam Okafor: Get the sixteen amp. Last year the lights kept tripping. (unclear)
  [15:28] Dana Whitfield: Sixteen amp. Okay.
  [15:33] Lukas Brenner: Was it the lights or the kettle?
  [15:36] Sam Okafor: It was the kettle. But don't tell anyone. (unclear)
  [15:40] Dana Whitfield: Ha.
  [15:46] Grace Adeyemi: Okay.
  [15:52] Grace Adeyemi: The stand itself. Sam, what have we got from last year?
  [15:56] Mei Lin Zhou: Sorry, my, um... (unclear)
  [15:59] Mei Lin Zhou: My internet is doing (unclear)
  [16:03] Grace Adeyemi: Mei Lin? You've frozen.
  [16:08] Lukas Brenner: She's gone.
  [16:13] Grace Adeyemi: Okay. We'll carry on, she'll be back.
  [16:19] Sam Okafor: So from last year we've got the four white shelving units, the counter, and the, the
  [16:25] Sam Okafor: light boxes. Two of the light boxes work. (unclear)
  [16:29] Grace Adeyemi: Two out of how many?
  [16:31] Sam Okafor: Four. (unclear)
  [16:34] Lukas Brenner: What happened to the other two?
  [16:38] Sam Okafor: One got dropped and one just, I don't know, it just stopped. It's in the cage. (unclear)
  [16:44] Grace Adeyemi: Is the counter okay?
  [16:47] Sam Okafor: The counter's fine. It's got a scratch down the front but the graphics cover it.
  [16:53] Grace Adeyemi: Okay.
  [16:58] Rafael Ortega: How big is the stand this year? It's on the invoice as... (unclear)
  [17:03] Grace Adeyemi: Six by four. Corner.
  [17:06] Rafael Ortega: Six by four. Okay, that matches.
  [17:10] Sam Okafor: Six by four's bigger than last year. We'll need more than four shelving units. (unclear)
  [17:16] Grace Adeyemi: Let's see what Kofi draws.
  [17:19] Sam Okafor: Yeah. (unclear)
  [17:25] Lukas Brenner: When's the build? The day before?
  [17:28] Sam Okafor: The tenth. The fair opens on the eleventh, so we build on the tenth, all day.
  [17:34] Lukas Brenner: The tenth. Okay. And it runs till the thirteenth?
  [17:38] Grace Adeyemi: Eleventh to the thirteenth. Three days. (unclear)
  [17:42] Lukas Brenner: Okay.
  [17:48] Dana Whitfield: Did anyone see Penfold's new stuff, by the way? They posted it yesterday. (unclear)
  [17:53] Rafael Ortega: The terracotta?
  [17:55] Dana Whitfield: The terracotta. It's basically our planters in orange.
  [18:00] Sam Okafor: Ha. Cheeky.
  [18:03] Grace Adeyemi: Is it actually the same?
  [18:07] Dana Whitfield: It's the same shape. It's not the same. Ours are better. (unclear)
  [18:11] Rafael Ortega: Ours are more expensive.
  [18:13] Dana Whitfield: Better and more expensive. Like everything good.
  [18:17] Lukas Brenner: Ha.
  [18:23] Grace Adeyemi: Okay, well, that's why the four percent and not the six.
  [18:27] Dana Whitfield: Exactly.
  [18:33] Lukas Brenner: Um, the venue. Parking. Do we know anything about parking this year? (unclear)
  [18:38] Sam Okafor: Exhibitors get the back car park. It's on the pack.
  [18:42] Lukas Brenner: The back one, the gravel one?
  [18:45] Sam Okafor: The gravel one. (unclear)
  [18:48] Lukas Brenner: Last year my car was white by the end of it. Just dust.
  [18:53] Rafael Ortega: Ha.
  [18:57] Lukas Brenner: And the traffic coming off the ring road, at eight in the morning, it's (unclear)
  [19:02] Lukas Brenner: it's forty minutes to do two miles.
  [19:06] Grace Adeyemi: Then we leave early.
  [19:09] Lukas Brenner: Yeah. (unclear)
  [19:15] Mei Lin Zhou: Hello? I'm back. Sorry. The router just, the whole house went.
  [19:19] Grace Adeyemi: Welcome back.
  [19:22] Mei Lin Zhou: What did I miss?
  [19:25] Grace Adeyemi: The stand's six by four, a corner, we build on the tenth. Sam's got the old furniture.
  [19:31] Grace Adeyemi: Two of the four light boxes work. And Penfold copied the planters.
  [19:36] Mei Lin Zhou: They what? (unclear)
  [19:38] Dana Whitfield: In orange.
  [19:40] Mei Lin Zhou: Oh my god.
  [19:44] Grace Adeyemi: Ha. Yeah. Um.
  [19:50] Rafael Ortega: Can I go back to the money for a sec? The hotel. Last year was what, two thousand four hundred? (unclear)
  [19:56] Grace Adeyemi: Something like that.
  [19:59] Rafael Ortega: It's gone up. The Crown wants more this year, I looked. Like three thousand. (unclear)
  [20:04] Sam Okafor: For the Crown? The Crown with the carpet?
  [20:07] Rafael Ortega: The Crown with the carpet.
  [20:10] Lukas Brenner: Ha. That carpet. (unclear)
  [20:14] Grace Adeyemi: Let's do hotels in a bit. I want to do people first.
  [20:18] Rafael Ortega: Sure.
  [20:24] Dana Whitfield: Can I just say, for Thursday at the fair, Ostrander want a proper meeting, like a sit-down,
  [20:30] Dana Whitfield: not just standing at the counter. Half an hour. (unclear)
  [20:34] Grace Adeyemi: We can do that at the back of the stand. If Kofi gives us a back.
  [20:39] Dana Whitfield: Okay. Ten o'clock Thursday, they said.
  [20:42] Grace Adeyemi: Fine.
  [20:48] Mei Lin Zhou: Um...
  [20:53] Sam Okafor: Sorry, one of the lads is waving at me, two minutes. (unclear)
  [20:57] Grace Adeyemi: Go.
  [21:24] Grace Adeyemi: ご視聴ありがとうございました
  [21:51] Sam Okafor: Sorry. Back. Someone parked a pallet in front of the fire door.
  [21:55] Lukas Brenner: Again?
  [21:58] Sam Okafor: Again. (unclear)
  [22:03] Grace Adeyemi: Okay. People. Staffing. Who's on the stand.
  [22:08] Sam Okafor: How many on the stand at once, though? That's the first thing.
  [22:12] Grace Adeyemi: Two. Two at a time, we swap at lunch.
  [22:17] Sam Okafor: Two at a time. Okay.
  [22:20] Dana Whitfield: Two's enough. Three and you just stand there talking to each other. (unclear)
  [22:25] Grace Adeyemi: Exactly.
  [22:28] Sam Okafor: I'll do the rota then. Who's going?
  [22:32] Grace Adeyemi: Me, you, Lukas, Mei Lin. Dana for the Thursday if she can.
  [22:37] Dana Whitfield: I can do Thursday morning. For Ostrander. (unclear)
  [22:41] Sam Okafor: Okay. Rota. (unclear)
  [22:47] Lukas Brenner: And are we taking payments on the stand? Like, do we need a card machine?
  [22:52] Grace Adeyemi: No. Orders only. We take the order on the stand and we invoice after.
  [22:58] Lukas Brenner: Okay. No card machine.
  [23:01] Rafael Ortega: Thank god. Last time the card machine charged us a monthly fee for a year. (unclear)
  [23:06] Dana Whitfield: For a card machine we used for three days.
  [23:09] Rafael Ortega: For three days. (unclear)
  [23:13] Grace Adeyemi: Yeah, orders only, invoiced. Normal terms.
  [23:17] Mei Lin Zhou: Okay.
  [23:24] Rafael Ortega: Which brings me to the fair offer. Do we do one?
  [23:28] Dana Whitfield: We have to. Everyone does one. If we don't, they just wait for Penfold's. (unclear)
  [23:33] Grace Adeyemi: What did we do last year?
  [23:36] Rafael Ortega: Free delivery on anything over a thousand.
  [23:40] Dana Whitfield: Which nobody noticed, because over a thousand is free delivery anyway. (unclear)
  [23:44] Sam Okafor: Ha. Yeah.
  [23:47] Rafael Ortega: Right. So I'd say a discount. Five percent.
  [23:52] Dana Whitfield: Five's good. Ten's too much with the four on top. (unclear)
  [23:57] Grace Adeyemi: How long for?
  [24:00] Rafael Ortega: Till the end of March? So they've got a few weeks after.
  [24:05] Grace Adeyemi: Okay. Five percent off orders placed at the fair, valid till the end of March.
  [24:11] Dana Whitfield: Good.
  [24:13] Rafael Ortega: I'll set the code up in the order system.
  [24:17] Grace Adeyemi: Thanks.
  [24:20] Rafael Ortega: Something like HARROW5. (unclear)
  [24:23] Mei Lin Zhou: That sounds like a disease.
  [24:26] Rafael Ortega: Ha. Fine, I'll think of something. (unclear)
  [24:32] Grace Adeyemi: Um...
  [24:38] Dana Whitfield: Sorry, the dog's eating something. Oh no. (unclear)
  [24:42] Grace Adeyemi: What's he eating?
  [24:46] Dana Whitfield: A candle. He's eating one of the sample candles. The fig one.
  [24:51] Sam Okafor: Ha! (unclear)
  [24:53] Mei Lin Zhou: Is that safe?
  [24:56] Dana Whitfield: It's soy, it's fine. He's fine. He looks very happy. (unclear)
  [25:01] Lukas Brenner: Garden centre dog.
  [25:04] Dana Whitfield: Ha. He smells like a garden centre now.
  [25:09] Lukas Brenner: Speaking of samples, the showroom's full of them. And the shelf in the showroom's still broken,
  [25:15] Lukas Brenner: the one that collapsed. The buyers are coming in after the fair. (unclear)
  [25:19] Grace Adeyemi: Oh, yeah, the shelf.
  [25:22] Lukas Brenner: I'll get the shelf fixed before they come. I know a guy.
  [25:26] Grace Adeyemi: Thanks, Lukas.
  [25:29] Sam Okafor: Everyone knows a guy. (unclear)
  [25:32] Lukas Brenner: My guy is good.
  [25:35] Dana Whitfield: Ha.
  [25:41] Grace Adeyemi: Okay. Hotels. Rafael said the Crown's gone up.
  [25:45] Rafael Ortega: Three thousand. For four rooms, three nights. (unclear)
  [25:50] Mei Lin Zhou: For the carpet.
  [25:52] Sam Okafor: Ha.
  [25:56] Lukas Brenner: I could just sleep in the van. Save us a room.
  [26:00] Sam Okafor: I'll bring you a pillow.
  [26:03] Lukas Brenner: I'll bring my own pillow. (unclear)
  [26:06] Grace Adeyemi: Ha. Nobody's sleeping in the van.
  [26:11] Rafael Ortega: There's a, there's a cheaper place by the station, I think. (unclear)
  [26:15] Grace Adeyemi: I'll book the hotel. Four rooms, three nights, I'll find something cheaper than the Crown.
  [26:21] Rafael Ortega: Great.
  [26:24] Dana Whitfield: Not with a shared bathroom. (unclear)
  [26:27] Grace Adeyemi: Not with a shared bathroom.
  [26:32] Mei Lin Zhou: Are we driving up or getting the train?
  [26:36] Grace Adeyemi: Train. Sam drives the van up with the stand, everyone else gets the train.
  [26:42] Sam Okafor: Fine by me. I like the van. (unclear)
  [26:45] Mei Lin Zhou: Train's good. I can work on the train.
  [26:49] Lukas Brenner: Okay, train. (unclear)
  [26:54] Lukas Brenner: Then I'll book the van. The ninth to the thirteenth, so Sam can load on the ninth.
  [27:00] Sam Okafor: The big one. Not the Transit.
  [27:03] Lukas Brenner: The big one. The Luton. (unclear)
  [27:07] Sam Okafor: With the tail lift.
  [27:10] Lukas Brenner: With the tail lift. Yes. (unclear)
  [27:14] Grace Adeyemi: Okay.
  [27:20] Dana Whitfield: Do I get a train ticket? For Thursday?
  [27:24] Grace Adeyemi: You're driving up Thursday, aren't you?
  [27:27] Dana Whitfield: Oh, yeah. I'm driving. Ignore me. (unclear)
  [27:31] Grace Adeyemi: Ha.
  [27:37] Mei Lin Zhou: Um, the... (unclear)
  [27:41] Mei Lin Zhou: Sorry, it's gone. I'll remember. (unclear)
  [27:47] Grace Adeyemi: Okay. Um. So, the stand furniture, Sam, do we need to buy anything? (unclear)
  [27:52] Sam Okafor: Depends on the floor plan. If Kofi gives us a back wall, we need a table and chairs for the
  [27:58] Sam Okafor: meetings. The Ostrander thing. (unclear)
  [28:02] Grace Adeyemi: We've got the folding ones.
  [28:05] Sam Okafor: The folding ones are, they're from like two thousand and ten. (unclear)
  [28:10] Dana Whitfield: They're fine. Put a cloth on the table.
  [28:13] Sam Okafor: Okay, cloth. (unclear)
  [28:19] Rafael Ortega: Don't buy chairs. Please. (unclear)
  [28:22] Grace Adeyemi: Nobody's buying chairs.
  [28:25] Rafael Ortega: Ha. Thank you.
  [28:31] Dana Whitfield: Oh, that's Ostrander ringing. They're early. I'm so sorry, I have to go.
  [28:36] Grace Adeyemi: Go, go. Thanks Dana.
  [28:38] Dana Whitfield: The terms once legal's done, and the power and wi-fi. Got it. Bye all.
  [28:42] Mei Lin Zhou: Bye.
  [28:43] Sam Okafor: Bye. (unclear)
  [28:49] Grace Adeyemi: Okay. Um...
  [28:55] Mei Lin Zhou: Can I ask something? Should we do a launch party in the showroom? For the spring range,
  [29:01] Mei Lin Zhou: like, invite the local buyers, wine, the new range out. (unclear)
  [29:05] Lukas Brenner: That could be nice.
  [29:08] Rafael Ortega: That could be expensive. (unclear)
  [29:11] Grace Adeyemi: Maybe. Let's think about it after the fair. I can't think about two things.
  [29:16] Mei Lin Zhou: Okay. After the fair.
  [29:19] Lukas Brenner: The shelf'll be fixed by then. (unclear)
  [29:22] Grace Adeyemi: Ha. Yes.
  [29:28] Sam Okafor: Can I ask about insurance? Does the fair's insurance cover our stock on the stand?
  [29:34] Sam Okafor: Last year someone walked off with two trays on the last day. (unclear)
  [29:38] Lukas Brenner: Two trays? I didn't know that.
  [29:41] Sam Okafor: Two of the big enamel ones. Just gone. (unclear)
  [29:45] Rafael Ortega: No idea, honestly. Ours covers the warehouse, I don't know about a stand. We'd have to ask the organisers.
  [29:51] Grace Adeyemi: Hm. Yeah.
  [29:54] Mei Lin Zhou: Mm.
  [29:59] Grace Adeyemi: Okay. Um.
  [30:05] Sam Okafor: And do we even bring the big planters? They're huge. If Kofi's plan's tight they won't fit.
  [30:11] Grace Adeyemi: I don't know. Depends on the floor plan.
  [30:14] Mei Lin Zhou: They're the best thing in the range though.
  [30:17] Sam Okafor: They're the best thing and they're the biggest thing. (unclear)
  [30:21] Grace Adeyemi: Yeah. I don't know. We'll see.
  [30:25] Sam Okafor: Okay.
  [30:31] Grace Adeyemi: And the graphics. The backdrop and the counter front.
  [30:35] Grace Adeyemi: Kofi can sort the stand graphics with the printer, he knows the guy there.
  [30:40] Sam Okafor: The Brinkley guy? (unclear)
  [30:42] Grace Adeyemi: The Brinkley guy. Martin or whatever.
  [30:45] Sam Okafor: Okay.
  [30:51] Mei Lin Zhou: Can the graphics use the new photos? If anyone does new photos?
  [30:55] Grace Adeyemi: If anyone does new photos. (unclear)
  [30:58] Mei Lin Zhou: Ha. Okay.
  [31:04] Rafael Ortega: Sorry, I need to go at ten to, it's the school run. Anything else from me?
  [31:09] Grace Adeyemi: I don't think so. Price list by the fifteenth, the budget sheet, the code.
  [31:14] Rafael Ortega: Budget sheet Friday, price list the fifteenth, the code. Yep.
  [31:18] Grace Adeyemi: Great.
  [31:22] Rafael Ortega: And keep receipts. All of them. Please.
  [31:25] Sam Okafor: Ha. Every year.
  [31:28] Rafael Ortega: Every year. Because every year. (unclear)
  [31:33] Mei Lin Zhou: Um...
  [31:39] Lukas Brenner: What's the train from here, is it the seven-something? (unclear)
  [31:43] Grace Adeyemi: There's a seven twelve. We'll sort it.
  [31:46] Lukas Brenner: Okay.
  [31:52] Rafael Ortega: Okay, I've got to go. Bye all. Good luck with it. (unclear)
  [31:56] Grace Adeyemi: Bye Rafael.
  [31:57] Lukas Brenner: Bye.
  [32:04] Grace Adeyemi: Okay. Um.
  [32:10] Sam Okafor: Grace, before we do the next bit, I need to say something about one of the lads on the build team.
  [32:16] Sam Okafor: Can we pause the notes for that? It's a personal thing.
  [32:20] Grace Adeyemi: Sure. Pausing now.
  [32:27] Grace Adeyemi: Okay, notes are back on. Thanks for telling me, Sam.
  [32:31] Sam Okafor: Yeah. Thanks. (unclear)
  [32:36] Grace Adeyemi: Okay. Um. Where were we. The build.
  [32:40] Sam Okafor: The build. So the tenth. I need four people for the build, at least.
  [32:46] Sam Okafor: Me, two from the build team, and one of you. (unclear)
  [32:50] Lukas Brenner: I can do the tenth. I'm going up anyway.
  [32:53] Sam Okafor: You're on the train though. (unclear)
  [32:56] Lukas Brenner: I'll get an early one.
  [32:59] Sam Okafor: Okay. Lukas on the build. Good.
  [33:04] Grace Adeyemi: What time do they let you in?
  [33:07] Sam Okafor: Seven. And everything has to be finished by eight at night or they charge you. (unclear)
  [33:12] Lukas Brenner: Charge you what?
  [33:14] Sam Okafor: I don't know, last year we finished at seven fifty. (unclear)
  [33:18] Mei Lin Zhou: Ha. Of course.
  [33:22] Sam Okafor: The light boxes are the slow bit. The wiring. (unclear)
  [33:27] Grace Adeyemi: And we only have two that work.
  [33:30] Sam Okafor: Two that work. So either two light boxes or we get new ones, or we rent them there.
  [33:36] Grace Adeyemi: Let's see Kofi's plan first. If it's a corner, maybe we only need two anyway.
  [33:41] Sam Okafor: Fair. (unclear)
  [33:47] Lukas Brenner: Who's taking the tools? The drills and stuff.
  [33:51] Sam Okafor: They're in the van already, they live in the van. (unclear)
  [33:55] Lukas Brenner: The van we haven't booked yet.
  [33:58] Sam Okafor: The tool box lives in the cage then. It goes in whichever van. (unclear)
  [34:03] Lukas Brenner: Okay.
  [34:09] Mei Lin Zhou: Um...
  [34:15] Mei Lin Zhou: Can I just check, is our stand number confirmed? I've got to put it on the catalogue and the emails.
  [34:21] Grace Adeyemi: Let me look, the organisers sent something Tuesday. Hang on. (unclear)
  [34:29] Grace Adeyemi: Yes. C14. Hall C, stand fourteen. It's confirmed in the email.
  [34:34] Mei Lin Zhou: C14. Great. (unclear)
  [34:37] Sam Okafor: Hall C's the one with the café?
  [34:40] Grace Adeyemi: Hall C's the one with the café. (unclear)
  [34:43] Sam Okafor: Good. Coffee.
  [34:46] Lukas Brenner: Ha.
  [34:52] Grace Adeyemi: Okay. What else. (unclear)
  [34:57] Lukas Brenner: Deliveries. Thinking about it, everything's coming to the office. The catalogues, the
  [35:03] Lukas Brenner: sample bits, the graphics probably. (unclear)
  [35:06] Sam Okafor: The napkins for the samples. Two hundred mini candles. (unclear)
  [35:10] Lukas Brenner: Reception's going to get a mountain of boxes. Someone needs to tell reception there'll be fair deliveries coming.
  [35:16] Grace Adeyemi: Yeah. Good point.
  [35:19] Mei Lin Zhou: Mm.
  [35:22] Sam Okafor: Last time they sent the catalogues back. They thought it was a mistake.
  [35:26] Mei Lin Zhou: They what?
  [35:28] Sam Okafor: Sent them back to the printer. We had to get them re-delivered. (unclear)
  [35:33] Mei Lin Zhou: Oh my god.
  [35:36] Grace Adeyemi: Ha. Okay. (unclear)
  [35:42] Grace Adeyemi: Okay. The tables. For the display. How many do we need?
  [35:47] Sam Okafor: Depends on the plan. Again. Everything depends on the plan. (unclear)
  [35:51] Grace Adeyemi: Everything depends on Kofi. (unclear)
  [35:54] Lukas Brenner: Poor Kofi.
  [35:57] Grace Adeyemi: Mei Lin, once Kofi's done the floor plan, can you work out how many display tables we need?
  [36:03] Mei Lin Zhou: Yeah. Once I've got the plan, yes.
  [36:06] Grace Adeyemi: Thanks.
  [36:09] Mei Lin Zhou: The round ones or the long ones? (unclear)
  [36:12] Grace Adeyemi: Whatever fits.
  [36:15] Mei Lin Zhou: Okay.
  [36:21] Sam Okafor: Can I just say, the coffee machine in the office is broken again. (unclear)
  [36:25] Lukas Brenner: Again? It was fixed on Monday.
  [36:28] Sam Okafor: It was fixed Monday and broken Tuesday. It just makes hot water now. (unclear)
  [36:33] Mei Lin Zhou: That's just tea.
  [36:35] Sam Okafor: Ha. It's not even hot. (unclear)
  [36:39] Lukas Brenner: Who fixes it?
  [36:41] Sam Okafor: A man. From the coffee company. Comes once a month. (unclear)
  [36:46] Mei Lin Zhou: Oh, and speaking of the office, I'll put the fair on the team calendar. People keep asking me the dates.
  [36:52] Grace Adeyemi: Yes, please.
  [36:55] Mei Lin Zhou: Eleventh to thirteenth, and the build on the tenth. (unclear)
  [36:59] Grace Adeyemi: Yep.
  [37:03] Sam Okafor: And the coffee man.
  [37:05] Mei Lin Zhou: I'm not putting the coffee man on the calendar.
  [37:08] Lukas Brenner: Ha.
  [37:14] Grace Adeyemi: Okay. Leads. How we take people's details at the stand.
  [37:19] Mei Lin Zhou: Last year it was the paper cards, the little forms.
  [37:23] Sam Okafor: And half of them we couldn't read. (unclear)
  [37:26] Lukas Brenner: Half of them were just a name and "nice stand".
  [37:29] Mei Lin Zhou: Ha. One said "bring back the blue jugs". (unclear)
  [37:33] Grace Adeyemi: We've got the two tablets from the showroom. Can we just use those?
  [37:38] Mei Lin Zhou: We could. It's just a form. It goes straight into the list.
  [37:42] Sam Okafor: As long as they're charged. (unclear)
  [37:45] Lukas Brenner: There's sockets. We've got the sixteen amp. (unclear)
  [37:49] Sam Okafor: If Dana books it.
  [37:51] Lukas Brenner: If Dana books it. (unclear)
  [37:55] Grace Adeyemi: Okay. Tablets this year, not paper cards. We use the tablets for sign-ups.
  [38:00] Mei Lin Zhou: Good. No more handwriting.
  [38:03] Sam Okafor: Bring the paper ones as a backup though. (unclear)
  [38:06] Grace Adeyemi: There's a box of them somewhere. Fine. (unclear)
  [38:12] Lukas Brenner: Um.
  [38:18] Grace Adeyemi: What happens after the fair, with the leads? Do we have a plan?
  [38:23] Mei Lin Zhou: Normally Dana takes the big ones and the rest get the newsletter.
  [38:27] Grace Adeyemi: That's fine. Let's do that again. (unclear)
  [38:31] Lukas Brenner: The newsletter that goes out once a quarter.
  [38:34] Mei Lin Zhou: When I have time. (unclear)
  [38:37] Lukas Brenner: Ha.
  [38:43] Grace Adeyemi: Okay. Um...
  [38:49] Mei Lin Zhou: Can I raise something bigger? It's been bugging me since we started. (unclear)
  [38:54] Grace Adeyemi: Go.
  [38:57] Mei Lin Zhou: The launch. We launch the spring range on the second of March. On the website, the catalogue,
  [39:04] Mei Lin Zhou: everything. And the fair's on the eleventh.
  [39:07] Grace Adeyemi: Yeah.
  [39:10] Mei Lin Zhou: So every buyer at Harrowgate has already seen the range online for nine days.
  [39:15] Mei Lin Zhou: There's nothing new on the stand. We're launching it to nobody, and then showing it to everyone after. (unclear)
  [39:21] Sam Okafor: Hm. That's true actually.
  [39:24] Lukas Brenner: Penfold launched theirs at the fair last year. On the stand. (unclear)
  [39:28] Grace Adeyemi: And it worked for them.
  [39:31] Lukas Brenner: It worked for them. Their stand was rammed. (unclear)
  [39:36] Grace Adeyemi: What would we launch after, then? When?
  [39:40] Mei Lin Zhou: The Monday after. The sixteenth.
  [39:43] Sam Okafor: That helps me too. The big planters come in on the twentieth of Feb. If the boat's late,
  [39:49] Sam Okafor: launching on the second with no big planters is a disaster. The sixteenth gives me three more weeks. (unclear)
  [39:55] Grace Adeyemi: What about the accounts? Dana told them spring orders open on the second.
  [40:00] Mei Lin Zhou: They can still order. They just order at the fair. With the five percent.
  [40:05] Lukas Brenner: Which is better for them. (unclear)
  [40:08] Grace Adeyemi: Hm.
  [40:13] Grace Adeyemi: And the website? The homepage is booked for the second. (unclear)
  [40:18] Mei Lin Zhou: It's a date in the system. I can move it.
  [40:22] Grace Adeyemi: Okay.
  [40:27] Grace Adeyemi: Okay. You're right. We move the launch. The spring range launches on the sixteenth of March,
  [40:33] Grace Adeyemi: after the fair. Not the second.
  [40:36] Mei Lin Zhou: Yes.
  [40:37] Sam Okafor: Good.
  [40:39] Lukas Brenner: Good call. (unclear)
  [40:45] Sam Okafor: Dana and Rafael have gone though. They don't know.
  [40:49] Grace Adeyemi: They'll see it in the notes. And Dana will want to tell the accounts herself,
  [40:55] Grace Adeyemi: so that's hers. Dana tells the top accounts the launch is the sixteenth.
  [41:00] Mei Lin Zhou: She'll be fine with it. She hates launching before the fair anyway. (unclear)
  [41:05] Grace Adeyemi: Ha. True.
  [41:11] Lukas Brenner: Does that change the five percent? Till the end of March is still fine?
  [41:16] Grace Adeyemi: Still fine. Two weeks after the launch. (unclear)
  [41:19] Lukas Brenner: Okay.
  [41:25] Mei Lin Zhou: So for the website I'd just swap the date, the homepage banner stays the same, it just goes up later.
  [41:31] Grace Adeyemi: Yeah. (unclear)
  [41:34] Mei Lin Zhou: And the newsletter for the launch goes on the sixteenth too.
  [41:38] Grace Adeyemi: Makes sense.
  [41:43] Sam Okafor: Can I say, the sixteenth is a Monday, and Monday's our biggest delivery day. (unclear)
  [41:48] Sam Okafor: If orders pile in on launch day, I'll want two extra pickers.
  [41:52] Grace Adeyemi: Will they pile in? Most of them will have ordered at the fair.
  [41:56] Sam Okafor: Then maybe not. We'll see. (unclear)
  [42:00] Grace Adeyemi: Okay.
  [42:06] Mei Lin Zhou: Um...
  [42:12] Mei Lin Zhou: Small question. In the catalogue, do I say "stoneware" or "ceramic" for the planters?
  [42:17] Grace Adeyemi: Stoneware. It's stoneware.
  [42:19] Mei Lin Zhou: Okay. Everyone says ceramic. (unclear)
  [42:23] Sam Okafor: Everyone's wrong.
  [42:26] Mei Lin Zhou: Ha. Okay, stoneware.
  [42:32] Lukas Brenner: And the napkins. Linen, or linen blend? Because they're, I think they're blend. (unclear)
  [42:37] Mei Lin Zhou: They're blend. Sixty forty.
  [42:40] Lukas Brenner: Then say blend. Or we'll get emails.
  [42:43] Mei Lin Zhou: Yeah, true. (unclear)
  [42:49] Grace Adeyemi: Okay. While we're on it, how did last year's fair actually go? Rafael sent me numbers and I never looked.
  [42:56] Sam Okafor: Good, I thought. Busy. (unclear)
  [43:00] Mei Lin Zhou: Forty-two orders, I think. It was on the sales report.
  [43:05] Grace Adeyemi: Forty-two. And the value?
  [43:08] Mei Lin Zhou: Thirty-one thousand. About. (unclear)
  [43:12] Lukas Brenner: That's not bad for three days.
  [43:15] Grace Adeyemi: And new accounts?
  [43:18] Mei Lin Zhou: Nine new ones. Two of them are big now, the Crane Street lot was one. (unclear)
  [43:24] Grace Adeyemi: Oh, Crane Street came from the fair?
  [43:27] Mei Lin Zhou: Crane Street came from the fair. They stopped at the stand because of the trays.
  [43:32] Sam Okafor: The trays sell. I keep saying. Put the trays at the front. (unclear)
  [43:37] Grace Adeyemi: Kofi's drawing it. That's Kofi's call.
  [43:40] Sam Okafor: Kofi never listens to me. (unclear)
  [43:43] Lukas Brenner: He'll put them at the back to spite you.
  [43:46] Sam Okafor: Ha. He would.
  [43:52] Grace Adeyemi: Um...
  [43:58] Grace Adeyemi: What sold, apart from the trays?
  [44:02] Mei Lin Zhou: The jars. The jars always sell. And the napkins in the, the grey. (unclear)
  [44:07] Lukas Brenner: The grey's discontinued.
  [44:09] Mei Lin Zhou: The grey's discontinued, yeah. The oat replaced it. (unclear)
  [44:13] Grace Adeyemi: Okay.
  [44:18] Lukas Brenner: The candles weren't in last year, were they?
  [44:21] Mei Lin Zhou: No, the candles are new. That's the new thing this year. Them and the big planters. (unclear)
  [44:27] Grace Adeyemi: Then the candles and the big planters are what we talk about. That's the story.
  [44:32] Mei Lin Zhou: That's the story. (unclear)
  [44:38] Lukas Brenner: The Ostrander meeting, what are we showing them? Do we know? (unclear)
  [44:42] Grace Adeyemi: Dana's running it. She knows what they want. They buy a lot of the jars.
  [44:47] Lukas Brenner: And their new buyer, the woman from last time, she asked about the trays in other colours.
  [44:53] Grace Adeyemi: Then we bring the colours. We've got the blue and the green, haven't we, Sam?
  [44:58] Sam Okafor: Blue and green. Three hundred of the blue, about a hundred and twenty of the green. (unclear)
  [45:04] Grace Adeyemi: Plenty.
  [45:06] Sam Okafor: Plenty of the blue. (unclear)
  [45:12] Mei Lin Zhou: Um, sorry, how's the new flat, Lukas? I never asked.
  [45:16] Lukas Brenner: Oh. Fine. Good. The neighbour plays drums. (unclear)
  [45:20] Mei Lin Zhou: Oh no.
  [45:22] Lukas Brenner: Every evening at seven. For an hour. The same song. (unclear)
  [45:27] Sam Okafor: What song?
  [45:29] Lukas Brenner: I don't know. Something with a lot of cymbals. (unclear)
  [45:34] Mei Lin Zhou: Ha.
  [45:37] Lukas Brenner: He's getting better though. Honestly. He's getting better. (unclear)
  [45:42] Grace Adeyemi: That's nice of you.
  [45:45] Lukas Brenner: I've got no choice. (unclear)
  [45:50] Sam Okafor: Ha.
  [45:56] Grace Adeyemi: Okay. Um.
  [46:02] Mei Lin Zhou: Should I be posting from the stand? Like on Instagram, during the fair?
  [46:07] Grace Adeyemi: Yeah, post whatever looks good. Not the build, the build looks like a building site.
  [46:12] Mei Lin Zhou: Ha. Okay, nothing from the build. (unclear)
  [46:16] Mei Lin Zhou: I was also thinking maybe a countdown, like the week before. Ten days to Harrowgate.
  [46:21] Grace Adeyemi: Maybe. Let's see how busy you are.
  [46:24] Mei Lin Zhou: Yeah. Let's see. (unclear)
  [46:31] Lukas Brenner: Did you hear Penfold hired the guy from Crane and Co? (unclear)
  [46:35] Sam Okafor: The tall one?
  [46:37] Lukas Brenner: The tall one. Head of sales now.
  [46:40] Grace Adeyemi: Huh. Good for him. (unclear)
  [46:44] Mei Lin Zhou: That's why they copied the planters. He knows our range.
  [46:48] Grace Adeyemi: Maybe. Anyway. (unclear)
  [46:52] Sam Okafor: He used to buy from us. Every month. (unclear)
  [46:56] Lukas Brenner: Yeah.
  [47:02] Sam Okafor: Oh, the forklift thing. I asked the venue already for a pallet truck this year instead. They said yes.
  [47:08] Grace Adeyemi: Good. So no carrying.
  [47:11] Sam Okafor: Less carrying. (unclear)
  [47:14] Lukas Brenner: Rafael's back will be pleased.
  [47:17] Sam Okafor: Ha.
  [47:23] Grace Adeyemi: Um...
  [47:31] Mei Lin Zhou: Sorry, I'm just writing the stoneware thing down. (unclear)
  [47:38] Mei Lin Zhou: Okay.
  [47:44] Lukas Brenner: What about music on the stand? Last year it was silent. It was a bit sad.
  [47:49] Sam Okafor: You can DJ, Lukas.
  [47:51] Lukas Brenner: I'll bring my decks.
  [47:53] Mei Lin Zhou: Ha. Please don't.
  [47:56] Grace Adeyemi: Nobody's DJing. The hall has its own music anyway. (unclear)
  [48:00] Lukas Brenner: Ha. Fine.
  [48:06] Grace Adeyemi: Okay. Um.
  [48:12] Sam Okafor: The trays, just so you know, the green ones, some of them have a mark on the rim. A little chip.
  [48:18] Sam Okafor: From the supplier. I've put them aside. (unclear)
  [48:22] Grace Adeyemi: How many?
  [48:24] Sam Okafor: Like fifteen. Out of the hundred and twenty. (unclear)
  [48:28] Grace Adeyemi: Don't take those to the fair.
  [48:31] Sam Okafor: No. They're aside. They're in the seconds cage.
  [48:35] Grace Adeyemi: Okay.
  [48:41] Mei Lin Zhou: We could sell the seconds at the staff sale.
  [48:44] Sam Okafor: There's always a staff sale. There's never a staff sale. (unclear)
  [48:48] Lukas Brenner: Ha.
  [48:54] Grace Adeyemi: Okay.
  [49:00] Lukas Brenner: The sample cards, the ones with the QR code in the packs. Do they go to the website or a page?
  [49:05] Mei Lin Zhou: The website. The catalogue page. The online one. (unclear)
  [49:09] Lukas Brenner: Okay. Just checking it works on the, on the old phones. (unclear)
  [49:13] Mei Lin Zhou: It works. I tested it on my mum's phone.
  [49:17] Sam Okafor: That's the real test. (unclear)
  [49:20] Mei Lin Zhou: Ha. It is.
  [49:26] Grace Adeyemi: Um...
  [49:32] Sam Okafor: The light boxes. If we rent them at the venue, do we know what that costs? (unclear)
  [49:37] Grace Adeyemi: No idea. It'll be on the exhibitor pack somewhere.
  [49:41] Sam Okafor: It's a hundred and something each I think. (unclear)
  [49:45] Grace Adeyemi: Let's see Kofi's plan. If we need two, we use the two that work.
  [49:49] Sam Okafor: Okay.
  [49:55] Lukas Brenner: Kofi's going to have a busy Wednesday.
  [49:58] Grace Adeyemi: Kofi's going to have a busy week. (unclear)
  [50:02] Mei Lin Zhou: Ha.
  [50:08] Grace Adeyemi: Okay. Um. Before I forget. Mei Lin, the stoneware, the blend. Anything else on the catalogue copy?
  [50:14] Mei Lin Zhou: No, just those. And the fig. (unclear)
  [50:17] Grace Adeyemi: And the fig.
  [50:22] Mei Lin Zhou: Oh, the sizes. Do I give the planters in centimetres or inches?
  [50:26] Grace Adeyemi: Centimetres. Always centimetres.
  [50:29] Mei Lin Zhou: Okay.
  [50:32] Sam Okafor: The Americans will ask. (unclear)
  [50:35] Grace Adeyemi: The Americans don't come to Harrowgate.
  [50:38] Sam Okafor: Ha. Fair.
  [50:44] Lukas Brenner: Um...
  [50:50] Lukas Brenner: The trays at four percent, what's the big blue one going to be? Roughly? (unclear)
  [50:55] Mei Lin Zhou: It's twelve, so twelve forty-eight. I'll know when Rafael sends the list.
  [51:00] Lukas Brenner: Twelve forty-eight. Okay. (unclear)
  [51:03] Sam Okafor: Penfold's is eleven ninety-nine.
  [51:06] Lukas Brenner: For the orange one?
  [51:08] Sam Okafor: For the orange one. (unclear)
  [51:12] Grace Adeyemi: Ours is better.
  [51:14] Sam Okafor: Ours is better. (unclear)
  [51:20] Grace Adeyemi: Okay, I think we've done the stand. Um. (unclear)
  [51:27] Mei Lin Zhou: Can I ask, is anyone else going to the Thursday dinner? The exhibitors' thing?
  [51:32] Grace Adeyemi: I'm going. Dana's going, she said. (unclear)
  [51:36] Lukas Brenner: Is it the same as last year? The, um, the cold chicken?
  [51:40] Grace Adeyemi: I hope not. (unclear)
  [51:43] Sam Okafor: The cold chicken was fine.
  [51:46] Lukas Brenner: The cold chicken was not fine. (unclear)
  [51:50] Mei Lin Zhou: Ha. I'll go. If there's not chicken.
  [51:54] Grace Adeyemi: Ha. We'll find out. Okay. (unclear)
  [52:00] Grace Adeyemi: Um.
  [52:06] Sam Okafor: Sorry, the lads want to know if they get a day off after the build. The build team.
  [52:11] Grace Adeyemi: The build's a Tuesday. They can have the Wednesday morning, that's normal.
  [52:16] Sam Okafor: That's what we did last year. Okay. (unclear)
  [52:20] Grace Adeyemi: Yeah. Same as last year.
  [52:23] Sam Okafor: They'll be happy. (unclear)
  [52:29] Lukas Brenner: Um...
  [52:35] Mei Lin Zhou: Okay. I'm sorry, I'm still thinking about the launch. It's better. It's so much better. (unclear)
  [52:41] Grace Adeyemi: It is. Good catch.
  [52:44] Mei Lin Zhou: I've been stressing about the second for weeks.
  [52:48] Lukas Brenner: Ha. Now stress about the sixteenth. (unclear)
  [52:51] Mei Lin Zhou: Thanks, Lukas.
  [52:57] Grace Adeyemi: Okay. Um...
  [53:02] Grace Adeyemi: Sorry, Dana's just sent me something, I need to read it. One sec.
  [53:44] Sam Okafor: Дякую за перегляд!
  [54:59] Grace Adeyemi: Um, okay. (unclear)
  [55:06] Grace Adeyemi: Sorry, someone's knocking. Hang on.
  [55:32] Grace Adeyemi: Obrigado.
  [55:51] Lukas Brenner: Is she back?
  [55:54] Mei Lin Zhou: Don't think so. (unclear)
  [55:59] Lukas Brenner: Sam, how was the, the thing on Saturday? The wedding?
  [56:03] Sam Okafor: Long. Really long. Three speeches and the best man cried. (unclear)
  [56:08] Mei Lin Zhou: Aw.
  [56:11] Sam Okafor: And then the groom cried. And then I cried, honestly. (unclear)
  [56:16] Lukas Brenner: Ha.
  [56:20] Sam Okafor: The food was good though. They had a, like, a whole pig. (unclear)
  [56:25] Mei Lin Zhou: A whole pig?
  [56:27] Sam Okafor: On a spit. In a field. In November. (unclear)
  [56:32] Lukas Brenner: Ha. Brave.
  [56:38] Grace Adeyemi: Sorry. Sorry, that was the plumber. We have a leak. (unclear)
  [56:42] Mei Lin Zhou: Oh no.
  [56:45] Grace Adeyemi: It's fine. It's under the sink. He's on it. Where were we?
  [56:50] Lukas Brenner: Stoneware. Blend. Centimetres. (unclear)
  [56:53] Grace Adeyemi: Ha. Okay.
  [56:59] Grace Adeyemi: The look of the stand. I want to talk colours before Kofi starts drawing.
  [57:04] Mei Lin Zhou: The catalogue's all the sage green this year. The cover, the headers.
  [57:09] Grace Adeyemi: Then the stand should be the sage. The backdrop. (unclear)
  [57:13] Sam Okafor: Sage and white? The shelving's white.
  [57:16] Mei Lin Zhou: Sage and white is nice.
  [57:19] Lukas Brenner: What was last year? The navy?
  [57:22] Sam Okafor: Navy. It looked like a bank. (unclear)
  [57:25] Mei Lin Zhou: Ha. It did look like a bank.
  [57:29] Grace Adeyemi: Kofi will see it in the notes, but it's his call really, he's doing the drawing. (unclear)
  [57:34] Sam Okafor: Okay.
  [57:40] Lukas Brenner: Um, can I ask, for the sample packs, do they need a bag? Or just the box? (unclear)
  [57:45] Mei Lin Zhou: Just a little kraft box. We've got them, there's a whole pallet of them from the Christmas boxes.
  [57:51] Lukas Brenner: Oh, the brown ones. Okay. Great.
  [57:54] Sam Okafor: There's like two thousand of those. (unclear)
  [57:57] Mei Lin Zhou: Use them. Please.
  [58:00] Lukas Brenner: Ha. Okay.
  [58:06] Grace Adeyemi: Okay. Um...
  [58:12] Sam Okafor: What about lunch on the stand? Last year we just didn't eat.
  [58:16] Lukas Brenner: There's the café now. Hall C. (unclear)
  [58:19] Sam Okafor: Oh yeah, the café. Okay. Problem solved.
  [58:23] Mei Lin Zhou: If it's open. (unclear)
  [58:26] Sam Okafor: Don't.
  [58:32] Grace Adeyemi: Okay. Anything else, before I go through who's doing what? (unclear)
  [58:37] Mei Lin Zhou: Not from me.
  [58:39] Sam Okafor: No. (unclear)
  [58:41] Lukas Brenner: No.
  [58:47] Grace Adeyemi: Okay, so, let me go through it. I'm booking the hotel.
  [58:52] Grace Adeyemi: Lukas, sample packs, two hundred, end of Feb. And you're booking the van, ninth to the thirteenth.
  [58:59] Lukas Brenner: Yep. (unclear)
  [59:01] Grace Adeyemi: Lukas, and the rota, you're
  [59:03] Sam Okafor: No, the rota's me.
  [59:05] Grace Adeyemi: Sorry. Sam, the rota. Two at a time.
  [59:09] Sam Okafor: Yep.
  [59:13] Grace Adeyemi: Mei Lin. The catalogue to the printer by the twentieth. And, um.
  [59:19] Grace Adeyemi: Actually, hang on. If we launch on the sixteenth, the catalogue says "spring range, from the second of March"
  [59:26] Grace Adeyemi: on every page, doesn't it?
  [59:29] Mei Lin Zhou: On the cover and the price pages. I can change it. (unclear)
  [59:33] Grace Adeyemi: But then we're printing five hundred catalogues for a fair where the buyers order on the stand,
  [59:39] Grace Adeyemi: and the prices change in a year anyway. And last year's are still in a box in the cage.
  [59:44] Sam Okafor: Two boxes. (unclear)
  [59:47] Grace Adeyemi: You know what, scrap the print run. No printed catalogue. We put QR code cards on the stand
  [59:54] Grace Adeyemi: that go to the online catalogue. We can change that any time.
  [59:57] Mei Lin Zhou: Oh, thank god. Honestly.
  [60:00] Lukas Brenner: And Rafael gets his eight hundred and sixty back. (unclear)
  [60:04] Grace Adeyemi: Ha. Yes.
  [60:07] Mei Lin Zhou: So I'll get the QR code cards made instead. Like, a few hundred, business card size.
  [60:12] Grace Adeyemi: Yes please. So Mei Lin, the QR cards, not the printer.
  [60:16] Mei Lin Zhou: QR cards. Got it. (unclear)
  [60:20] Grace Adeyemi: And the display tables once Kofi's done the plan, and the calendar.
  [60:25] Mei Lin Zhou: Yep. (unclear)
  [60:28] Grace Adeyemi: Rafael's got the price list by the fifteenth and the discount code.
  [60:33] Grace Adeyemi: Kofi, the floor plan, Wednesday.
  [60:36] Grace Adeyemi: And Dana's got the terms once legal's done, and telling the accounts about the sixteenth.
  [60:42] Sam Okafor: That's a lot of Dana for someone who left. (unclear)
  [60:45] Grace Adeyemi: Ha. She'll cope.
  [60:49] Lukas Brenner: Is that everything? (unclear)
  [60:52] Grace Adeyemi: I think that's everything.
  [60:56] Mei Lin Zhou: Okay.
  [61:00] Sam Okafor: Okay. I'd better get back to the floor. (unclear)
  [61:04] Grace Adeyemi: Ha. Good luck. Thanks everyone.
  [61:07] Lukas Brenner: Bye.
  [61:08] Mei Lin Zhou: Bye bye. (unclear)
  [61:13] Mei Lin Zhou: Продолжение следует...`,
    expect: {
      decisions: [
        { what: 'The bamboo kitchen range waits for autumn and isn\'t in the spring launch (the supplier hasn\'t fixed the lids)', at: '02:58' },
        { what: 'Their own stand at Harrowgate this year, not shared with Penfold', at: '03:54' },
        { what: 'Spring range wholesale prices go up 4%, not 6% (6% would put the planters well above Penfold\'s)', at: '10:12' },
        { what: 'Free small samples on the stand, only for trade visitors with a trade badge, not sample packs for sale', at: '11:24' },
        { what: 'Two people on the stand at a time, swapping at lunch', at: '22:12' },
        { what: 'No payments taken on the stand: orders only, invoiced afterwards', at: '22:52' },
        { what: '5% off orders placed at the fair, valid until the end of March', at: '24:05' },
        { what: 'Everyone takes the train to the fair except Sam, who drives the van up with the stand', at: '26:36' },
        { what: 'Sign-ups at the stand on the two showroom tablets this year, not paper cards', at: '37:55' },
        { what: 'The spring range launches on the 16th of March, after the fair, instead of the 2nd', at: '40:27' },
        { what: 'No printed catalogue: QR code cards on the stand link to the online catalogue, instead of 500 printed copies', at: '59:47' }
      ],
      questions: [
        { what: 'Whether to bring the big planters, which may not fit on the stand (it depends on Kofi\'s floor plan)', at: '30:05' }
      ],
      actions: [
        { what: 'Send Grace the fair budget sheet, split out', owner: 'Rafael Ortega', due: 'Friday', at: '04:17' },
        { what: 'Do the stand floor plan with the organisers', owner: 'Kofi Mensah', due: 'Wednesday, when he\'s back', at: '04:28' },
        { what: 'Send the venue the van\'s height for the loading form', owner: 'Sam Okafor', due: null, at: '05:19' },
        { what: 'Update the price list with the 4% rise', owner: 'Rafael Ortega', due: 'the 15th', at: '10:27' },
        { what: 'Make up 200 sample packs (a napkin, a mini candle, a tray coaster and the QR code card)', owner: 'Lukas Brenner', due: 'end of February', at: '12:02' },
        { what: 'Redo the planter photos before the fair', owner: null, due: 'before the fair, or no due date (either is right)', at: '13:04' },
        { what: 'Send the new trade terms to the top twenty accounts, with an email, once legal has signed them off', owner: 'Dana Whitfield', due: 'once legal has signed them off, or no due date (either is right)', at: '14:41' },
        { what: 'Book the stand\'s power (sixteen amp) and wi-fi with the organisers', owner: 'Dana Whitfield', due: 'end of the month', at: '15:15' },
        { what: 'Draw up the stand rota', owner: 'Sam Okafor', due: null, at: '22:28' },
        { what: 'Set up the fair discount code in the order system', owner: 'Rafael Ortega', due: null, at: '24:13' },
        { what: 'Get the broken showroom shelf fixed before the buyers visit after the fair', owner: 'Lukas Brenner', due: 'before the buyers visit after the fair, or no due date (either is right)', at: '25:22' },
        { what: 'Book the hotel: four rooms, three nights, somewhere cheaper than the Crown', owner: 'Grace Adeyemi', due: null, at: '26:15' },
        { what: 'Book the big van (the Luton with the tail lift) from the 9th to the 13th of March', owner: 'Lukas Brenner', due: 'the hire dates (the 9th to the 13th of March), or no due date (either is right)', at: '26:54' },
        { what: 'Ask the organisers whether their insurance covers the stock on the stand', owner: null, due: null, at: '29:28', alsoAs: 'question' },
        { what: 'Sort the stand graphics (the backdrop and the counter front) with the printer', owner: 'Kofi Mensah', due: null, at: '30:35' },
        { what: 'Tell reception there will be fair deliveries coming to the office', owner: null, due: null, at: '35:10' },
        { what: 'Work out how many display tables are needed, once Kofi has done the floor plan', owner: 'Mei Lin Zhou', due: 'once Kofi has done the floor plan, or no due date (either is right)', at: '36:03' },
        { what: 'Put the fair dates on the team calendar', owner: 'Mei Lin Zhou', due: null, at: '36:46' },
        { what: 'Tell the top accounts the spring launch has moved to the 16th of March', owner: 'Dana Whitfield', due: null, at: '40:49' },
        { what: 'Get the QR code cards made for the stand, linking to the online catalogue', owner: 'Mei Lin Zhou', due: null, at: '60:07' }
      ],
      acceptable: [
        'The fair budget of 18,000, all in',
        'The stand is C14 in Hall C (as a fact)',
        'The stand is six by four metres, on a corner',
        'The stand is built on the 10th of March (as a decision or a fact)',
        'The fair runs from the 11th to the 13th of March',
        'Whether to hold a launch party in the showroom, put off until after the fair (as an open question)',
        'Whether to use the two working light boxes or rent more, until the floor plan is done (as an open question)',
        'Setting up the tablets for sign-ups (as a follow-up with no owner)',
        'Sam driving the van up with the stand (as a follow-up)',
        'Lukas helping with the build on the 10th (as a follow-up)',
        'Dana on the stand on Thursday morning (as a fact or a follow-up)',
        'Ostrander\'s half-hour meeting at the stand at ten on Thursday, which Dana runs',
        'Mei Lin moving the website\'s launch date to the 16th (as a follow-up)',
        'The launch newsletter going out on the 16th (as a decision or a fact)',
        'Whether launch day on the 16th needs two extra pickers (as an open question)',
        'Leads from the fair handled as last year, the big ones to Dana and the rest to the newsletter (as a decision)',
        'The green trays with chipped rims kept back from the fair (as a decision)',
        'The sample packs going in the kraft boxes left over from Christmas (as a decision)',
        'The build team getting the Wednesday morning off after the build (as a decision)',
        'Keeping every receipt from the fair (as a follow-up for everyone, or with no owner)',
        'A pallet truck at the venue this year, already arranged by Sam (as a fact)'
      ],
      never: [
        'Printing the catalogue, or sending it to the printer, as a follow-up or as what was settled: the recap scraps the print run',
        'The spring launch on the 2nd of March as the final date',
        'A 6% price rise as settled',
        'Sharing the stand with Penfold as settled',
        'The bamboo kitchen range in the spring launch or at the fair',
        'Taking payments, or a card machine, on the stand as settled',
        'A launch party as a decision or a follow-up: it was put off until after the fair',
        'A social media countdown before the fair as a decision or a follow-up: it was only a maybe',
        'Lukas sleeping in the van, or anyone bringing him a pillow (a joke)',
        'Lukas DJing on the stand or bringing his decks (a joke)',
        'Checking or confirming the stand number as a follow-up: Grace checked it in the call (C14)',
        'Lukas drawing up the stand rota',
        'A guess at what Sam said while notes were paused, or anything about the person on the build team beyond Sam asking to pause for something personal',
        'Anything from the Ukrainian, French, Japanese, Portuguese or Russian lines (thanks for watching, subtitles, to be continued)'
      ]
    }
  },
  {
    id: 'ops-review-missing',
    checks: 'A dense 62-minute operations review with 17 decisions and 28 follow-ups, more than the notes keep (12 and 20): six decisions in the middle third, seven given as one-line answers to questions, early ones crowded by later ones, and jobs for Grace, who is away, and Tomás, who leaves. Recall is capped by design; what matters is which items the notes keep and that they invent nothing to fill the lists.',
    title: 'November operations review',
    kind: 'call',
    organizer: 'Priya Raman',
    invited: ['Tomás Ibarra', 'Jonah Feld', 'Ana Sofía Reyes', 'Lukas Brenner', 'Sam Okafor', 'Grace Adeyemi'],
    language: 'call',
    writtenIn: 'en',
    gaps: [{ kind: 'paused', at: '42:50', minutes: 3 }],
    transcript: `
  [00:03] Priya Raman: Продолжение следует...
  [00:26] Priya Raman: Sous-titres réalisés par la communauté d'Amara.org
  [00:44] Jonah Feld: Morning. (unclear)
  [00:47] Priya Raman: Morning Jonah.
  [00:51] Ana Sofía Reyes: Hi everyone. Can you hear me? I'm on the laptop in the CS room.
  [00:56] Priya Raman: Loud and clear.
  [01:00] Tomás Ibarra: Hola. Hello. (unclear)
  [01:04] Lukas Brenner: Hi. I'm in the yard, so if there's a reversing beep, that's me.
  [01:09] Priya Raman: Ha. Okay.
  [01:14] Jonah Feld: Is Sam coming?
  [01:17] Tomás Ibarra: He's on the dock, he said five minutes.
  [01:21] Priya Raman: And Grace sent apologies, she's at the web agency all morning.
  [01:26] Ana Sofía Reyes: Okay.
  [01:31] Priya Raman: Okay, let's go. It's the monthly, so it's the usual order. Safety, stock, suppliers,
  [01:37] Priya Raman: transport, customers, people, the building, peak. I want us out in an hour and a bit. (unclear)
  [01:43] Lukas Brenner: An hour and a bit. Ha.
  [01:46] Priya Raman: I'm being optimistic.
  [01:50] Jonah Feld: You're always optimistic. (unclear)
  [01:54] Priya Raman: Safety. Tomás.
  [01:57] Tomás Ibarra: Yes. So, first, the safety walk. (unclear)
  [02:02] Tomás Ibarra: Nobody comes on Saturdays any more. Last two Saturdays it was just me and the clipboard.
  [02:08] Jonah Feld: It's a Saturday. (unclear)
  [02:11] Tomás Ibarra: Exactly, it's a Saturday.
  [02:16] Priya Raman: So is the Saturday safety walk still on, or what are we doing with it?
  [02:21] Tomás Ibarra: No. We move it to Fridays, first thing. Seven o'clock, before the shift gets going.
  [02:27] Priya Raman: Fridays, seven. Fine by me.
  [02:30] Lukas Brenner: Fridays work. The drivers are in at seven anyway. (unclear)
  [02:34] Tomás Ibarra: Good. Fridays.
  [02:39] Priya Raman: Okay. Um.
  [02:45] Tomás Ibarra: Second thing. The near miss on Tuesday. At dock two.
  [02:50] Ana Sofía Reyes: I heard about that. Is everyone okay? (unclear)
  [02:53] Tomás Ibarra: Everyone's okay. But it was close. One of the pickers walked through dock two with the doors open,
  [03:00] Tomás Ibarra: and the reach truck was coming in off the trailer, and the driver just didn't see her.
  [03:05] Priya Raman: How close?
  [03:08] Tomás Ibarra: Like, a metre. Less. (unclear)
  [03:11] Jonah Feld: Jesus.
  [03:14] Tomás Ibarra: She's fine. She was shaking. We sat her down, she had a tea. (unclear)
  [03:19] Priya Raman: Did it go in the book?
  [03:21] Tomás Ibarra: It's in the book. I did the form the same day.
  [03:25] Priya Raman: Okay. Good.
  [03:30] Tomás Ibarra: The problem is people use dock two as a shortcut. To the canteen. (unclear)
  [03:35] Lukas Brenner: Everyone does. My drivers do it.
  [03:38] Tomás Ibarra: Everyone does. So I want a rule.
  [03:42] Priya Raman: Go on.
  [03:45] Tomás Ibarra: From Monday, nobody walks through dock two while the doors are open. Nobody. You use the side door.
  [03:52] Priya Raman: Agreed. From Monday, side door, no walking through dock two with the doors open.
  [03:57] Lukas Brenner: Even drivers?
  [03:59] Tomás Ibarra: Especially drivers. (unclear)
  [04:02] Lukas Brenner: Ha. Okay. Fair.
  [04:07] Priya Raman: It needs to be told to people properly though. Not just a sign.
  [04:12] Tomás Ibarra: Sam's dock team mostly. When he's on.
  [04:15] Priya Raman: Okay, when Sam's on. (unclear)
  [04:21] Jonah Feld: Do we need a barrier? Like a physical thing?
  [04:25] Tomás Ibarra: Maybe later. A rule first. See if it works. (unclear)
  [04:29] Priya Raman: Okay.
  [04:35] Ana Sofía Reyes: Sorry, someone's at my desk. One second.
  [04:41] Priya Raman: Sure.
  [04:47] Lukas Brenner: There's a lorry here that wants to reverse into the gatehouse. (unclear)
  [04:51] Jonah Feld: Ha. Don't let it.
  [04:54] Lukas Brenner: I'm waving at him. He's waving back. That's all that's happening. (unclear)
  [04:59] Priya Raman: Ha.
  [05:06] Sam Okafor: Hello. Sorry. Sorry I'm late, a driver turned up two hours early and wanted unloading.
  [05:11] Priya Raman: Hi Sam. We were just on you, actually.
  [05:14] Sam Okafor: Uh oh. (unclear)
  [05:17] Tomás Ibarra: The near miss. New rule from Monday, nobody through dock two while the doors are open. Side door.
  [05:23] Sam Okafor: Oh. Yeah. Good. Finally.
  [05:26] Priya Raman: Can you make sure the dock team actually know? Properly, before Monday?
  [05:31] Sam Okafor: Yeah. I'll brief the dock team before Monday. I'll do it at the Friday huddle.
  [05:36] Priya Raman: Thanks.
  [05:39] Sam Okafor: They'll moan. (unclear)
  [05:41] Tomás Ibarra: They can moan through the side door.
  [05:44] Sam Okafor: Ha. Yeah.
  [05:50] Tomás Ibarra: And the walkway. From the side door to the canteen, there's no line on the floor. It's just
  [05:56] Tomás Ibarra: concrete, people don't know where to walk. I'll get the walkway painted. Yellow lines.
  [06:02] Priya Raman: When?
  [06:04] Tomás Ibarra: The painters are in anyway for the car park, so... soon. (unclear)
  [06:08] Priya Raman: Okay.
  [06:14] Ana Sofía Reyes: Sorry, I'm back. (unclear)
  [06:17] Priya Raman: No worries.
  [06:22] Tomás Ibarra: And last thing on safety, honestly, aisle nine. The lighting in aisle nine. It's like a cave.
  [06:28] Sam Okafor: It is. Two of the tubes are out and one flickers.
  [06:32] Jonah Feld: Since when?
  [06:34] Sam Okafor: Since September? (unclear)
  [06:37] Tomás Ibarra: Someone should really look at the lighting in aisle nine. Before someone picks the wrong thing.
  [06:42] Priya Raman: Yeah.
  [06:45] Sam Okafor: Mm.
  [06:48] Jonah Feld: Yeah, it's bad.
  [06:53] Priya Raman: Okay. Um...
  [06:59] Priya Raman: That's safety? (unclear)
  [07:02] Tomás Ibarra: That's safety.
  [07:07] Priya Raman: Stock. Scanners first, because that's the thing.
  [07:11] Jonah Feld: Yeah, so. The new scanners. We ordered forty from Coastal. They said end of November.
  [07:17] Jonah Feld: Now they're saying "early December". Which means mid-December. (unclear)
  [07:22] Tomás Ibarra: Which means January.
  [07:24] Jonah Feld: Ha. Maybe.
  [07:28] Sam Okafor: The old ones are dying. I had two go this week. (unclear)
  [07:32] Priya Raman: Can we limp?
  [07:35] Sam Okafor: We can limp. We've got the spares from the, the, the ones we kept for parts.
  [07:41] Priya Raman: Okay. Are we keeping the old scanners, then? Or do we hire some in the meantime?
  [07:46] Tomás Ibarra: Yeah, we keep the old ones till the new ones come. Hiring's silly money for a month.
  [07:52] Priya Raman: Okay. Old ones stay till the Coastal ones arrive.
  [07:56] Sam Okafor: Yeah. (unclear)
  [07:59] Jonah Feld: I'll chase Coastal for a proper delivery date. A date, not "early December".
  [08:04] Priya Raman: Please.
  [08:07] Jonah Feld: A date with a number in it. (unclear)
  [08:10] Lukas Brenner: Ha.
  [08:16] Priya Raman: Okay, stock counts. Tomás, you wanted to change something.
  [08:20] Tomás Ibarra: Yes. So we do a full cycle count every month, all SKUs. It takes three days and by the time
  [08:27] Tomás Ibarra: we finish, the first aisle is wrong again.
  [08:31] Jonah Feld: Ha. It's true. (unclear)
  [08:34] Tomás Ibarra: The errors are all in the fast movers. The top hundred. The slow stuff is always right.
  [08:40] Priya Raman: So what do you want?
  [08:43] Tomás Ibarra: Count the top hundred every week. Instead of everything every month.
  [08:48] Sam Okafor: That's way less work. A morning a week. (unclear)
  [08:52] Priya Raman: And the slow stuff?
  [08:54] Tomás Ibarra: Once a quarter. It never moves anyway.
  [08:59] Jonah Feld: The auditors won't mind?
  [09:02] Tomás Ibarra: I don't know. (unclear)
  [09:05] Priya Raman: Hm.
  [09:08] Priya Raman: Let's do it. Weekly counts for the top hundred SKUs, instead of the monthly full count.
  [09:14] Tomás Ibarra: Good.
  [09:16] Sam Okafor: Yes. Thank you. (unclear)
  [09:20] Tomás Ibarra: I'll set the weekly counts up in the system. It's a setting, it's not hard.
  [09:25] Priya Raman: Great.
  [09:29] Jonah Feld: But the auditors. We should ask the auditors whether weekly counts change anything for the year-end count.
  [09:35] Jonah Feld: Last year they made us count everything twice because of the, the thing. (unclear)
  [09:40] Priya Raman: Yeah. Good point.
  [09:43] Tomás Ibarra: Mm.
  [09:46] Ana Sofía Reyes: Mm.
  [09:51] Priya Raman: Okay. Um.
  [09:57] Sam Okafor: Can I just say, the weekly counts, can they be Tuesday mornings? Monday's deliveries. (unclear)
  [10:02] Tomás Ibarra: Tuesday's fine.
  [10:04] Sam Okafor: Okay.
  [10:09] Priya Raman: Okay. Suppliers. Jonah.
  [10:12] Jonah Feld: Yeah. Big one first, Hollis. The packaging.
  [10:16] Jonah Feld: They want an answer on the renewal. One year or three. Three is two percent cheaper a year.
  [10:22] Priya Raman: When does the contract end, actually? I can never remember.
  [10:26] Jonah Feld: Let me look. Hang on. (unclear)
  [10:33] Jonah Feld: The thirty-first of December. It's here. Thirty-first of December.
  [10:37] Priya Raman: Okay. So we need to answer this month.
  [10:40] Jonah Feld: This month.
  [10:44] Lukas Brenner: Are they any good though? The last two deliveries were late. (unclear)
  [10:48] Jonah Feld: They're okay. They're late in November because everyone's late in November. (unclear)
  [10:53] Tomás Ibarra: And the boxes are fine. The boxes are good.
  [10:56] Sam Okafor: The tape's rubbish. (unclear)
  [10:59] Jonah Feld: The tape's from someone else.
  [11:02] Sam Okafor: Oh. Then the tape's rubbish and it's not their fault. (unclear)
  [11:06] Priya Raman: Ha.
  [11:11] Jonah Feld: So. Do we renew with Hollis? And for how long?
  [11:15] Priya Raman: Yes, we renew. One year. Not three. If they're late again next November I want to be able to leave.
  [11:22] Jonah Feld: One year. Okay. I'll send them the renewal for one year.
  [11:26] Priya Raman: Thanks.
  [11:29] Tomás Ibarra: Two percent's not nothing though. (unclear)
  [11:32] Priya Raman: It's not nothing. But three years is a long time.
  [11:35] Tomás Ibarra: Okay. Fair.
  [11:41] Jonah Feld: Oh, and their rep, Gareth, the Hollis guy, he's retiring. End of the month.
  [11:46] Ana Sofía Reyes: No! Gareth?
  [11:48] Jonah Feld: Gareth. Thirty years. He's moving to Portugal.
  [11:52] Ana Sofía Reyes: Oh, good for him. He was so nice to my team. He always sent the chocolates. (unclear)
  [11:58] Sam Okafor: The good chocolates.
  [12:00] Jonah Feld: The good chocolates. Yeah.
  [12:04] Ana Sofía Reyes: Who's the new one? My team ring Gareth for everything. (unclear)
  [12:08] Jonah Feld: A woman called, um, Fenna? Something. I'll send you the new rep's number, Ana Sofía.
  [12:14] Ana Sofía Reyes: Thank you.
  [12:17] Lukas Brenner: Portugal. Nice. (unclear)
  [12:20] Jonah Feld: He's got a, like, a farm. Olives.
  [12:23] Lukas Brenner: Ha. Gareth with olives. (unclear)
  [12:27] Priya Raman: Okay. Um...
  [12:33] Priya Raman: Gloves. That's the other big one, isn't it?
  [12:37] Jonah Feld: Gloves. Yeah. So the Penang container. It was meant to land the first week of December.
  [12:43] Jonah Feld: Now it's the second week of January. (unclear)
  [12:47] Tomás Ibarra: January?
  [12:49] Jonah Feld: January. Something at the port. They won't say what. (unclear)
  [12:54] Sam Okafor: We're already short on the mediums. The nitrile mediums.
  [12:58] Priya Raman: How short?
  [13:01] Sam Okafor: Like, three weeks of stock? If December's like last December.
  [13:06] Tomás Ibarra: Last December was mad. (unclear)
  [13:09] Sam Okafor: Last December was mad. So maybe two weeks.
  [13:14] Priya Raman: Okay. So what are the options, Jonah?
  [13:18] Jonah Feld: Option one, we wait for Penang and we run out for, like, three weeks in January. (unclear)
  [13:24] Jonah Feld: Option two, we get it all from Corran, the domestic people. They can do it in ten days.
  [13:30] Jonah Feld: But they're eighteen percent dearer. (unclear)
  [13:33] Lukas Brenner: Eighteen?
  [13:35] Jonah Feld: Eighteen. On the mediums. Bit less on the larges.
  [13:40] Tomás Ibarra: And Corran's quality? I heard the mediums tear. (unclear)
  [13:44] Jonah Feld: That was two years ago, the old factory. They moved. I've had samples, they're fine.
  [13:50] Sam Okafor: I tried them. They're fine. A bit thicker. The pickers didn't complain. (unclear)
  [13:55] Ana Sofía Reyes: Customers will notice if they're different though. We had complaints when the box changed colour.
  [14:01] Jonah Feld: The box changed colour and people thought they were fakes. (unclear)
  [14:05] Ana Sofía Reyes: Twelve calls. Twelve calls about a box.
  [14:08] Lukas Brenner: Ha.
  [14:13] Priya Raman: Is there an option three?
  [14:16] Jonah Feld: Option three is we split it. Most from Penang, some from Corran to cover the gap.
  [14:22] Jonah Feld: Like seventy thirty. That covers January and we only pay the eighteen on thirty percent.
  [14:28] Tomás Ibarra: That's the sensible one.
  [14:31] Sam Okafor: Yeah.
  [14:34] Priya Raman: How much is the order? Roughly?
  [14:37] Jonah Feld: The January order's about forty thousand. Normally. (unclear)
  [14:41] Priya Raman: So thirty percent at eighteen more is...
  [14:45] Jonah Feld: About two thousand extra. Two point one. (unclear)
  [14:49] Priya Raman: That's fine. That's cheaper than running out.
  [14:53] Tomás Ibarra: Much cheaper. (unclear)
  [14:57] Ana Sofía Reyes: And we tell customers the Corran ones might look a bit different?
  [15:01] Priya Raman: If they look different. Jonah, do they?
  [15:04] Jonah Feld: Same blue. Different box. (unclear)
  [15:07] Ana Sofía Reyes: Oh no. The box.
  [15:09] Sam Okafor: Ha. Here we go.
  [15:13] Priya Raman: We'll cross that bridge. (unclear)
  [15:19] Priya Raman: Okay. So we split it. Seventy percent Penang, thirty percent Corran, for January.
  [15:25] Jonah Feld: Okay. Seventy thirty.
  [15:28] Tomás Ibarra: Good.
  [15:31] Jonah Feld: But I need the real numbers before I place it. What we've actually got. (unclear)
  [15:36] Tomás Ibarra: The month-end count's next Thursday. It'll be done Friday.
  [15:40] Jonah Feld: Then I'll place the January glove order once the count's in. Next week, after Friday.
  [15:46] Priya Raman: Perfect.
  [15:49] Jonah Feld: Otherwise I'm guessing.
  [15:52] Tomás Ibarra: You're always guessing.
  [15:54] Jonah Feld: Ha. Educated guessing.
  [16:00] Priya Raman: Um.
  [16:06] Priya Raman: Anything else on suppliers?
  [16:09] Jonah Feld: Small things. Brannock, the pallets, their price stays the same for next year. Which is a miracle.
  [16:15] Tomás Ibarra: A miracle. (unclear)
  [16:18] Jonah Feld: And the label people moved, they're in a new unit, same everything, just a new address. (unclear)
  [16:23] Priya Raman: Okay.
  [16:26] Jonah Feld: And the tape. Since Sam asked. We're on the cheap tape because the good tape doubled in price in the summer.
  [16:33] Sam Okafor: The cheap tape doesn't stick in the cold. The dock's freezing in the morning, it just peels off. (unclear)
  [16:39] Jonah Feld: I know. I know. (unclear)
  [16:42] Sam Okafor: We're taping everything twice. So we're not saving anything.
  [16:46] Jonah Feld: Ha. Fair point.
  [16:49] Priya Raman: Hm. Is the good tape still double?
  [16:53] Jonah Feld: It's come down a bit. Like fifty percent more, not double. (unclear)
  [16:57] Priya Raman: Hm.
  [17:00] Tomás Ibarra: If we tape twice, fifty percent more is cheaper.
  [17:04] Jonah Feld: Ha. Okay, maths. (unclear)
  [17:07] Priya Raman: Leave it with me, I'll think about the tape. It's not urgent. (unclear)
  [17:12] Sam Okafor: It's urgent to me. (unclear)
  [17:15] Priya Raman: Ha. Noted.
  [17:21] Jonah Feld: Um...
  [17:27] Lukas Brenner: Sorry, can I just, the lorry's actually reversing now. Give me ten seconds.
  [17:31] Priya Raman: Go.
  [17:48] Lukas Brenner: Okay. He's in. He's in the right place. Sorry.
  [17:52] Jonah Feld: Ha. Did he hit the gatehouse?
  [17:55] Lukas Brenner: He missed it by that much. (unclear)
  [17:59] Tomás Ibarra: Ha.
  [18:04] Priya Raman: How was the match, Jonah? Your son's thing?
  [18:08] Jonah Feld: They lost. Seven nil. (unclear)
  [18:11] Ana Sofía Reyes: Oh no.
  [18:13] Jonah Feld: He scored though. An own goal. But he scored. (unclear)
  [18:18] Sam Okafor: Ha! That counts.
  [18:20] Jonah Feld: That's what I told him. It counts. He was very upset.
  [18:25] Tomás Ibarra: My daughter's team, they won eleven nil and they still cried. Something about the oranges.
  [18:31] Lukas Brenner: Ha. The oranges. (unclear)
  [18:34] Tomás Ibarra: Someone forgot the oranges. It was a tragedy. (unclear)
  [18:39] Priya Raman: Ha. Okay.
  [18:45] Priya Raman: Um. Before transport. Stock levels for peak generally. Sam, Tomás, anything that worries you?
  [18:51] Sam Okafor: Gloves, we've done. Aprons are fine. The big bin liners are tight.
  [18:56] Jonah Feld: The bin liners are on the way, they land Monday.
  [18:59] Sam Okafor: Monday. Okay. Then fine. (unclear)
  [19:03] Tomás Ibarra: The hand towels. We're overstocked, actually. Way over. Like, four months.
  [19:09] Priya Raman: Why?
  [19:11] Tomás Ibarra: Someone ordered twice in September. (unclear)
  [19:14] Jonah Feld: Not me.
  [19:16] Tomás Ibarra: The system ordered twice. Nobody's fault. (unclear)
  [19:20] Priya Raman: Do we need to do anything?
  [19:23] Tomás Ibarra: No, they don't go off. We just won't order till March. It's just space. (unclear)
  [19:28] Sam Okafor: It's a lot of space. A whole bay.
  [19:31] Tomás Ibarra: A whole bay of hand towels. (unclear)
  [19:35] Priya Raman: Okay. Noted.
  [19:40] Sam Okafor: And the seconds, the damaged stuff. The cage is full again. (unclear)
  [19:44] Priya Raman: We'll do that with returns, later. It's on the list.
  [19:48] Sam Okafor: Okay.
  [19:53] Priya Raman: Um...
  [19:58] Ana Sofía Reyes: Can I ask about the mediums? If we're short in December, what do I tell customers who order big?
  [20:04] Priya Raman: How big?
  [20:06] Ana Sofía Reyes: Like, the cleaning companies. They order a hundred cases at a time.
  [20:10] Sam Okafor: A hundred cases is, that's a third of what we've got.
  [20:14] Priya Raman: Hm.
  [20:17] Jonah Feld: Corran's ten days, so even the thirty percent lands mid-December. If I can order it.
  [20:22] Jonah Feld: Which is after the count. So, mid-December, roughly. (unclear)
  [20:26] Ana Sofía Reyes: So for the first two weeks, what do I say?
  [20:30] Priya Raman: Say what's true. We've got stock, but big orders might ship in two parts. (unclear)
  [20:35] Ana Sofía Reyes: Okay. Two parts. They hate two parts. (unclear)
  [20:38] Tomás Ibarra: They hate nothing more. (unclear)
  [20:41] Priya Raman: They'll hate nothing at all more. Two parts. (unclear)
  [20:46] Ana Sofía Reyes: Ha. Okay.
  [20:51] Priya Raman: Okay. Um.
  [20:57] Lukas Brenner: Is it me now? Transport? (unclear)
  [21:00] Priya Raman: Almost. Two minutes, I want to check the numbers from last month. Sorry.
  [21:05] Lukas Brenner: Sure.
  [21:31] Priya Raman: Дякую за перегляд!
  [21:52] Priya Raman: Okay. Sorry. Found it. On-time delivery last month was ninety-one percent.
  [21:58] Lukas Brenner: Ninety-one. Down from ninety-four.
  [22:02] Priya Raman: Why?
  [22:05] Lukas Brenner: The six o'clock run, mostly. I'll come to it.
  [22:09] Priya Raman: Okay. Transport. Go.
  [22:13] Lukas Brenner: So the six o'clock run. The last van. It goes out at six to the industrial estates on the east side.
  [22:19] Lukas Brenner: And it hits the ring road at quarter past six, which is the worst fifteen minutes of the day. (unclear)
  [22:24] Jonah Feld: The worst. (unclear)
  [22:26] Lukas Brenner: So it gets to the estates at seven, quarter past. And half of them close at quarter to seven.
  [22:32] Tomás Ibarra: So it arrives and nobody's there.
  [22:35] Lukas Brenner: Nobody's there. Fourteen failed deliveries last month. Just on that van. (unclear)
  [22:40] Priya Raman: Fourteen.
  [22:42] Lukas Brenner: That's most of the drop from ninety-four to ninety-one.
  [22:46] Ana Sofía Reyes: And every one of those is a call to my team. "Where's my order." (unclear)
  [22:50] Lukas Brenner: Yeah.
  [22:55] Priya Raman: Is the late van still going out at six, then? Next month?
  [22:59] Lukas Brenner: No. I want to drop the six o'clock run. Last van leaves at half four, it does the estates first.
  [23:05] Priya Raman: Okay. Drop it. Half four.
  [23:08] Tomás Ibarra: Half four's better for the dock too. We're loading that van at the worst time. (unclear)
  [23:13] Sam Okafor: We are. Right on top of the evening pick. (unclear)
  [23:17] Jonah Feld: Do the customers on that route mind getting it earlier?
  [23:21] Lukas Brenner: Earlier is what they want. They're there at five.
  [23:25] Priya Raman: Okay.
  [23:30] Ana Sofía Reyes: But they need to know. Some of them have someone waiting at six because that's when we come.
  [23:36] Priya Raman: Can you let them know?
  [23:38] Ana Sofía Reyes: Yes. I'll email the customers on the six o'clock route about the earlier van. There's about thirty.
  [23:44] Priya Raman: Thanks.
  [23:47] Lukas Brenner: Thirty-two. They're all on the route sheet. (unclear)
  [23:50] Ana Sofía Reyes: Thanks. (unclear)
  [23:55] Priya Raman: And the drivers?
  [23:58] Lukas Brenner: I'll change the drivers' schedule for the half-four van. It's two drivers, they'll be happy, they finish earlier.
  [24:05] Priya Raman: Good.
  [24:08] Tomás Ibarra: Happy drivers. Rare. (unclear)
  [24:11] Lukas Brenner: Ha. Very rare.
  [24:16] Priya Raman: Um.
  [24:21] Lukas Brenner: Second thing. Fuel cards.
  [24:24] Priya Raman: Go.
  [24:27] Lukas Brenner: We're on Fuelserve. They put the fee up again, it's now two percent on every fill. (unclear)
  [24:33] Lukas Brenner: Ardent do a card with no fee, and they're two pence a litre cheaper at their own stations.
  [24:38] Jonah Feld: Where are their stations though? (unclear)
  [24:41] Lukas Brenner: There's one on the ring road and two near the estates. That's eighty percent of our fills.
  [24:47] Tomás Ibarra: What about the long runs? The Bristol one?
  [24:50] Lukas Brenner: That's once a week. They'd use a, the card works at other stations, just without the discount. (unclear)
  [24:56] Priya Raman: How much does it save? A year?
  [25:00] Lukas Brenner: About four thousand. Maybe four and a half.
  [25:04] Jonah Feld: That's real money.
  [25:06] Priya Raman: Is there a contract? A minimum?
  [25:09] Lukas Brenner: No minimum. A month's notice. (unclear)
  [25:13] Priya Raman: Then yes. From January the vans move to Ardent fuel cards.
  [25:18] Lukas Brenner: Great.
  [25:20] Jonah Feld: About time. (unclear)
  [25:24] Lukas Brenner: I'll order the Ardent cards then. Eight. One for each van.
  [25:29] Priya Raman: Thanks. And cancel the other ones after?
  [25:32] Lukas Brenner: After January, yeah. When the new ones work. (unclear)
  [25:36] Priya Raman: Okay.
  [25:41] Tomás Ibarra: Do the Ardent cards work at motorway services though? Because the Bristol van fills up at the services.
  [25:47] Lukas Brenner: Hm. I don't know, honestly. I didn't look. (unclear)
  [25:51] Jonah Feld: Some cards don't. My old company's card didn't. (unclear)
  [25:55] Priya Raman: Hm.
  [25:58] Lukas Brenner: Hm. (unclear)
  [26:02] Priya Raman: Okay. Um...
  [26:08] Lukas Brenner: Oh, and. This is not a thing, but. One of the drivers got a parking ticket outside Crane Street.
  [26:14] Priya Raman: Again?
  [26:16] Lukas Brenner: Again. Fifty quid. There's nowhere to stop, it's a red route.
  [26:21] Jonah Feld: Who pays?
  [26:23] Lukas Brenner: We pay. We always pay. (unclear)
  [26:26] Tomás Ibarra: Can't they deliver round the back?
  [26:29] Lukas Brenner: The back's a car park for a gym. The gym clamps. (unclear)
  [26:33] Sam Okafor: Ha. Of course it does.
  [26:36] Lukas Brenner: So we pay the fifty and move on. It's like a delivery fee. (unclear)
  [26:41] Priya Raman: Ha. Okay.
  [26:46] Lukas Brenner: That's me, I think. Oh, the MOTs. All the vans passed. Number six needed tyres. Done. (unclear)
  [26:52] Priya Raman: Great.
  [26:57] Priya Raman: Ana Sofía, customers.
  [27:00] Ana Sofía Reyes: Yes. So the Christmas hours. We need to (unclear)
  [27:04] Ana Sofía Reyes: decide the (unclear)
  [27:07] Priya Raman: Ana Sofía? You're breaking up.
  [27:12] Jonah Feld: She's frozen. (unclear)
  [27:16] Tomás Ibarra: She's gone. The CS room wifi.
  [27:19] Priya Raman: Okay. Let's wait a sec. (unclear)
  [27:25] Sam Okafor: While we wait, the seconds cage, can I...
  [27:28] Priya Raman: Later, Sam. Returns. It's on the list.
  [27:31] Sam Okafor: Okay, okay. (unclear)
  [27:37] Jonah Feld: Um...
  [27:43] Tomás Ibarra: Lukas, the gatehouse lorry. Did he leave?
  [27:46] Lukas Brenner: He left. He gave me a thumbs up. Like we're friends now. (unclear)
  [27:51] Tomás Ibarra: Ha.
  [28:02] Ana Sofía Reyes: Hello? I'm back. Sorry. I'm on my phone now. (unclear)
  [28:06] Priya Raman: Welcome back. You were saying, Christmas hours.
  [28:10] Ana Sofía Reyes: Yes. Christmas. Last year we were open on the twenty-fourth all day and nobody rang. Nobody.
  [28:16] Ana Sofía Reyes: Four people sat there all day. And on the twenty-seventh, everybody rang. (unclear)
  [28:21] Jonah Feld: Ha. Classic.
  [28:24] Ana Sofía Reyes: So I'd like closed on the twenty-fifth and twenty-sixth, obviously, and nine to one on the
  [28:30] Ana Sofía Reyes: twenty-fourth and the thirty-first. And normal hours the rest. (unclear)
  [28:34] Priya Raman: That sounds right.
  [28:37] Tomás Ibarra: Does the warehouse match it?
  [28:39] Priya Raman: The warehouse does its own thing, Tomás, that's peak, that's later.
  [28:43] Tomás Ibarra: Okay.
  [28:46] Priya Raman: Okay. Customer service: closed the twenty-fifth and twenty-sixth, nine to one on the twenty-fourth and the thirty-first.
  [28:53] Ana Sofía Reyes: Thank you.
  [28:56] Priya Raman: It needs to go on the website.
  [28:59] Ana Sofía Reyes: That's Grace.
  [29:01] Priya Raman: That's Grace. She's not here, but it's hers. Grace puts the Christmas hours on the website.
  [29:07] Ana Sofía Reyes: She did it last year, she knows where. (unclear)
  [29:10] Priya Raman: Okay.
  [29:14] Ana Sofía Reyes: And I'll brief my team on the hours. They'll want to know who's on the twenty-fourth.
  [29:19] Priya Raman: Great.
  [29:22] Ana Sofía Reyes: Nobody wants the twenty-fourth. (unclear)
  [29:25] Sam Okafor: Nobody wants the thirty-first either.
  [29:27] Ana Sofía Reyes: Nobody wants anything in December. (unclear)
  [29:31] Priya Raman: Ha.
  [29:36] Ana Sofía Reyes: Next. Ostrander. The damaged order. (unclear)
  [29:40] Priya Raman: Remind me.
  [29:42] Ana Sofía Reyes: Their October order came with four cases crushed. We sent new ones. But they're asking for the
  [29:48] Ana Sofía Reyes: shipping back, and they're asking us not to charge the restocking fee on the crushed ones they sent back. (unclear)
  [29:54] Jonah Feld: Were they crushed by us or the courier? (unclear)
  [29:57] Lukas Brenner: The courier. It was a pallet that went on the Northfield job. Not our vans.
  [30:02] Ana Sofía Reyes: Either way, it's not their fault.
  [30:05] Priya Raman: How much is it?
  [30:07] Ana Sofía Reyes: Shipping's a hundred and ten. The restocking fee is sixty. (unclear)
  [30:11] Jonah Feld: And they spend what, eighty thousand a year?
  [30:14] Ana Sofía Reyes: About that.
  [30:16] Priya Raman: Do we refund them?
  [30:18] Ana Sofía Reyes: I think we have to.
  [30:21] Priya Raman: Yes. Refund the shipping and the restocking fee. Both. It's a hundred and seventy pounds.
  [30:27] Ana Sofía Reyes: Okay. I'll do the Ostrander refund today.
  [30:31] Priya Raman: And claim it from the courier?
  [30:34] Lukas Brenner: We can try. They never pay. (unclear)
  [30:37] Priya Raman: No, they never do. Leave it. (unclear)
  [30:40] Lukas Brenner: Ha. Yeah.
  [30:45] Priya Raman: Um.
  [30:51] Priya Raman: Complaints. Ana Sofía, how many in November so far?
  [30:55] Ana Sofía Reyes: I don't have the number in front of me, I'm on my phone. (unclear)
  [30:59] Priya Raman: For the board pack I need them by Thursday.
  [31:03] Ana Sofía Reyes: I'll send you the November complaint numbers by Thursday. By category.
  [31:08] Priya Raman: Thanks.
  [31:11] Ana Sofía Reyes: Most of them are the six o'clock van. So that's, that's fixed now. (unclear)
  [31:16] Lukas Brenner: You're welcome. (unclear)
  [31:18] Ana Sofía Reyes: Ha.
  [31:24] Priya Raman: Okay.
  [31:29] Ana Sofía Reyes: Oh, one more. The returns form on the website. People keep putting the order number in the wrong box.
  [31:35] Ana Sofía Reyes: It's not a big thing. It's just annoying.
  [31:38] Priya Raman: That's Grace again.
  [31:40] Ana Sofía Reyes: That's Grace again. She knows, I've told her twice. (unclear)
  [31:44] Priya Raman: Okay.
  [31:50] Priya Raman: Um...
  [31:56] Priya Raman: People. Temps first. Sam.
  [32:00] Sam Okafor: Yeah. So last month we said the temps start on the eighth of December.
  [32:05] Sam Okafor: The eighth's too late. The orders are already up. We were picking till eight last night.
  [32:11] Tomás Ibarra: We were. (unclear)
  [32:13] Priya Raman: What do you want?
  [32:15] Sam Okafor: The first. The first of December. A week earlier. (unclear)
  [32:19] Priya Raman: Can the agency do the first?
  [32:22] Sam Okafor: They said yes. I asked Monday. Same six people. (unclear)
  [32:26] Priya Raman: And the money? A week more of six temps?
  [32:30] Jonah Feld: About three thousand. Three two. (unclear)
  [32:33] Priya Raman: It's in the peak budget. Just.
  [32:36] Priya Raman: Okay. The temps start on the first of December, not the eighth.
  [32:41] Sam Okafor: Thank you.
  [32:43] Tomás Ibarra: Good. (unclear)
  [32:47] Priya Raman: They need the induction, though. The safety one. Day one.
  [32:51] Sam Okafor: HR hasn't sent their contracts back yet. They can't do the induction without them.
  [32:56] Priya Raman: Okay. Once HR has the contracts back, I'll book the temps' induction. For their first morning.
  [33:02] Sam Okafor: Great.
  [33:05] Priya Raman: HR said this week. HR always says this week. (unclear)
  [33:09] Jonah Feld: Ha.
  [33:12] Sam Okafor: And I'll put together a buddy list. Each temp with one of ours. So they're not just lost.
  [33:18] Priya Raman: Yes. Good.
  [33:21] Sam Okafor: Last year two of them got lost in the freezer aisle. (unclear)
  [33:25] Lukas Brenner: Ha. Lost?
  [33:27] Sam Okafor: Lost. Like, for twenty minutes. They thought it was a shortcut. (unclear)
  [33:32] Tomás Ibarra: It's not a shortcut.
  [33:34] Sam Okafor: It's not a shortcut. (unclear)
  [33:39] Tomás Ibarra: Priya. Before the next bit. I need to talk about one of my team. It's a disciplinary.
  [33:45] Tomás Ibarra: Can we pause the notes for it?
  [33:47] Priya Raman: Yes. Pausing now.
  [33:55] Priya Raman: Okay, notes are back on. Thanks, Tomás.
  [33:58] Tomás Ibarra: Thanks. (unclear)
  [34:03] Priya Raman: Okay. Um. Where are we. (unclear)
  [34:07] Tomás Ibarra: The forklift. That's mine too.
  [34:10] Priya Raman: Go on.
  [34:13] Tomás Ibarra: Halden, the leasing people, they rang. They want to know if we're taking the second forklift for peak.
  [34:19] Tomás Ibarra: Like last year. The short lease, December to February.
  [34:23] Jonah Feld: What did that cost last year?
  [34:26] Tomás Ibarra: About four thousand for the three months. (unclear)
  [34:30] Sam Okafor: And we barely used it. It sat by the charging bay most of January.
  [34:35] Tomás Ibarra: It did. With the new reach truck we've got more than last year anyway. (unclear)
  [34:40] Priya Raman: So do we need the second forklift lease this year?
  [34:44] Tomás Ibarra: No. One's enough till March. The reach truck and the old one cover peak.
  [34:50] Priya Raman: Okay. No second forklift. Not till March at least.
  [34:54] Sam Okafor: As long as the old one doesn't die.
  [34:57] Tomás Ibarra: It won't die. It's had its service. (unclear)
  [35:01] Sam Okafor: It's older than me.
  [35:03] Tomás Ibarra: Everything's older than you. (unclear)
  [35:06] Sam Okafor: Ha.
  [35:09] Tomás Ibarra: I'll tell Halden we don't need it. They'll be sad.
  [35:13] Priya Raman: They'll survive.
  [35:16] Jonah Feld: They'll call again in January. They always do. (unclear)
  [35:20] Tomás Ibarra: Ha. Yes.
  [35:26] Priya Raman: Um...
  [35:31] Priya Raman: Before the building and peak, let me do the numbers. Quickly. The dashboard.
  [35:36] Jonah Feld: The dashboard. (unclear)
  [35:39] Priya Raman: Pick accuracy, ninety-nine point one. Down from ninety-nine point four.
  [35:45] Sam Okafor: That's the new starters. And aisle nine. You can't read the labels in aisle nine.
  [35:50] Priya Raman: How many mispicks were in aisle nine?
  [35:53] Sam Okafor: I'd have to look. A lot. Like a third? (unclear)
  [35:57] Jonah Feld: A third, from one aisle?
  [35:59] Sam Okafor: It's dark. People guess. (unclear)
  [36:03] Priya Raman: Hm.
  [36:07] Priya Raman: Dispatch on time, ninety-six. That's fine. That's the warehouse, not the vans.
  [36:12] Lukas Brenner: The vans are the ninety-one. (unclear)
  [36:15] Priya Raman: The vans are the ninety-one. We've done that.
  [36:19] Lukas Brenner: We've done that. Half four. (unclear)
  [36:24] Priya Raman: Absence. Four point two percent. Up from three.
  [36:28] Sam Okafor: Flu. It went round the whole night shift. (unclear)
  [36:32] Ana Sofía Reyes: And my team. Two of mine were off the same week.
  [36:36] Jonah Feld: I had it. I still have it a bit. (unclear)
  [36:39] Lukas Brenner: Don't breathe on the laptop.
  [36:41] Jonah Feld: Ha.
  [36:46] Priya Raman: Stock accuracy. Ninety-seven point eight. Which is why we're changing the counts.
  [36:51] Sam Okafor: The weekly ones will fix that.
  [36:54] Priya Raman: I hope so. The board likes that number.
  [36:57] Jonah Feld: The board likes every number. (unclear)
  [37:01] Priya Raman: The board likes numbers that go up.
  [37:04] Jonah Feld: Ha. Fair.
  [37:09] Priya Raman: Complaints, I'll have Thursday. Returns rate, two point one percent. Normal.
  [37:14] Ana Sofía Reyes: Normal for November. December's always higher. Christmas presents. (unclear)
  [37:18] Priya Raman: Gloves as Christmas presents?
  [37:21] Ana Sofía Reyes: You'd be surprised. The aprons go as presents. People buy the aprons for their dads. (unclear)
  [37:26] Lukas Brenner: Ha. Really?
  [37:28] Ana Sofía Reyes: The butcher's aprons. They're nice. They come back in January. (unclear)
  [37:33] Sam Okafor: Because the dads don't want them.
  [37:35] Ana Sofía Reyes: Because the dads don't want them. (unclear)
  [37:39] Priya Raman: Ha. Okay.
  [37:44] Priya Raman: And safety incidents, one. The near miss. Which we've done. (unclear)
  [37:49] Sam Okafor: One's not bad for November.
  [37:52] Priya Raman: One is one too many. But yes.
  [37:56] Priya Raman: Okay, that's the dashboard. It's all in the pack anyway.
  [38:00] Jonah Feld: Okay.
  [38:06] Jonah Feld: Is the Christmas party the nineteenth? I've had two different emails. (unclear)
  [38:10] Priya Raman: The nineteenth. The bowling place. HR sent the second email because the first one said the ninth.
  [38:16] Lukas Brenner: Bowling again.
  [38:18] Ana Sofía Reyes: I like the bowling.
  [38:20] Lukas Brenner: You like it because you win. (unclear)
  [38:23] Ana Sofía Reyes: I like it because I win. Yes.
  [38:26] Sam Okafor: Ha. She's very good. It's scary. (unclear)
  [38:30] Jonah Feld: Do the night shift get to come?
  [38:33] Priya Raman: They're doing a breakfast for the night shift. The morning after. HR's idea. (unclear)
  [38:38] Sam Okafor: Breakfast is better than bowling, honestly.
  [38:41] Lukas Brenner: Breakfast is better than most things. (unclear)
  [38:44] Priya Raman: Ha. Okay.
  [38:50] Priya Raman: Sorry, I need to get a coffee or I'll die. Two minutes. Talk amongst yourselves.
  [38:55] Sam Okafor: Ha. Okay.
  [39:03] Lukas Brenner: Sam, did you see the lorry under the yard barrier this morning?
  [39:07] Sam Okafor: I saw it. It was properly stuck. The driver just stood there looking at it. (unclear)
  [39:13] Jonah Feld: Ha. Thinking.
  [39:15] Sam Okafor: Hands on his hips. The thinking pose.
  [39:20] Lukas Brenner: That's the low one, by the yard?
  [39:24] Sam Okafor: The low one. Two point eight metres. It says it on it. In big letters. (unclear)
  [39:30] Lukas Brenner: They never read it. (unclear)
  [39:34] Tomás Ibarra: It took us an hour to get it out. We let the tyres down in the end.
  [39:39] Jonah Feld: Ha. Really? (unclear)
  [39:52] Ana Sofía Reyes: Sous-titres réalisés par la communauté d'Amara.org
  [40:24] Priya Raman: Okay. Back. Sorry. The machine's out of milk so it's black, so I'm angry now. (unclear)
  [40:29] Jonah Feld: Ha.
  [40:33] Priya Raman: Okay. Where were we. (unclear)
  [40:37] Jonah Feld: Oh, before you go on. I went to see Corran last week, actually. The factory.
  [40:42] Priya Raman: Oh yeah? How was it?
  [40:44] Jonah Feld: Good. Much better than I expected. It's all new, the new site, they moved in in the spring. (unclear)
  [40:50] Jonah Feld: And they showed me the testing, they pull a glove off every line every hour and stretch it on a machine.
  [40:56] Sam Okafor: That's more than Penang does.
  [40:58] Jonah Feld: That's way more than Penang does. Penang does it by the batch. (unclear)
  [41:03] Lukas Brenner: Did you get a free glove?
  [41:05] Jonah Feld: I got a box of free gloves. And a pen. (unclear)
  [41:08] Lukas Brenner: Ha. A pen.
  [41:11] Jonah Feld: A good pen though. (unclear)
  [41:15] Priya Raman: So we're comfortable with the thirty percent.
  [41:18] Jonah Feld: Very comfortable. If anything we could do more. But the price. (unclear)
  [41:22] Priya Raman: The price. Yeah. Let's see how January goes. (unclear)
  [41:26] Jonah Feld: Okay.
  [41:31] Lukas Brenner: Can I raise something? Not for now, for next year. (unclear)
  [41:35] Priya Raman: Go on.
  [41:37] Lukas Brenner: The council's clean air zone. It starts in the autumn. Two of our vans aren't compliant.
  [41:43] Lukas Brenner: So should we look at an electric van next year? For the town runs? They're short runs, it'd work.
  [41:49] Jonah Feld: Electric vans are expensive.
  [41:51] Lukas Brenner: The charge for the zone is twelve pounds a day. Per van. That's expensive too. (unclear)
  [41:57] Priya Raman: Hm. Maybe. After peak. Not now. I can't think about vans in December.
  [42:02] Lukas Brenner: No, no, I know. After peak. (unclear)
  [42:05] Priya Raman: January. Not before. (unclear)
  [42:08] Lukas Brenner: Ha. Okay.
  [42:14] Ana Sofía Reyes: Can I tell you my favourite call this week? It's quick. (unclear)
  [42:18] Priya Raman: Go on, we need it.
  [42:20] Ana Sofía Reyes: A woman ordered three hundred cases of gloves. Three hundred. She meant three. (unclear)
  [42:26] Sam Okafor: Oh no.
  [42:28] Ana Sofía Reyes: She typed three and the box added the zeros. Or she did. Nobody knows. (unclear)
  [42:33] Lukas Brenner: Did it go out?
  [42:35] Ana Sofía Reyes: It nearly went out. The pickers flagged it. Thank god for the pickers.
  [42:40] Sam Okafor: Darren flagged it. He said nobody needs three hundred cases of small. (unclear)
  [42:45] Ana Sofía Reyes: Darren is right. Nobody needs three hundred cases of small.
  [42:49] Jonah Feld: Ha. Give Darren a raise.
  [42:52] Priya Raman: Ha. Give Darren a biscuit. (unclear)
  [42:56] Sam Okafor: He'll take the biscuit. (unclear)
  [43:02] Priya Raman: Um...
  [43:08] Sam Okafor: Also, the canteen microwave. Someone put a tin in it.
  [43:12] Lukas Brenner: A tin?
  [43:14] Sam Okafor: A tin. Of soup. Unopened. It went bang. (unclear)
  [43:18] Ana Sofía Reyes: Oh my god. Is everyone okay?
  [43:21] Sam Okafor: Everyone's okay. The microwave is not okay. Facilities know. (unclear)
  [43:25] Jonah Feld: Who puts a tin in a microwave?
  [43:28] Sam Okafor: We don't know. Nobody's saying. (unclear)
  [43:31] Lukas Brenner: It's always the quiet ones.
  [43:34] Sam Okafor: Ha.
  [43:40] Priya Raman: Okay. Um. One more thing before the building. The insurer.
  [43:45] Priya Raman: They're coming on the ninth of December, to walk the site. It's the yearly one.
  [43:50] Sam Okafor: Do they want the near miss book?
  [43:52] Priya Raman: They'll want everything. The book, the training records, the forklift service sheets. (unclear)
  [43:57] Priya Raman: I've got it all together already. It's in a folder on my desk.
  [44:01] Jonah Feld: A physical folder?
  [44:03] Priya Raman: A physical folder. They like paper. (unclear)
  [44:06] Jonah Feld: Ha. Unlike the board.
  [44:09] Priya Raman: Unlike the board. (unclear)
  [44:14] Sam Okafor: The ninth's a Tuesday. Good. Not a delivery day.
  [44:17] Priya Raman: That's why I picked it. (unclear)
  [44:21] Priya Raman: Okay. Um...
  [44:27] Priya Raman: Let me just go through last month's list quickly. What we said we'd do.
  [44:32] Jonah Feld: The list of shame. (unclear)
  [44:35] Priya Raman: Ha. It's not that bad. The racking inspection.
  [44:38] Tomás Ibarra: Done. Passed. Two beams to replace, they're replaced. (unclear)
  [44:43] Priya Raman: The fire drill.
  [44:45] Sam Okafor: Done. Four minutes. Everyone out. Even the night shift, we did a second one.
  [44:51] Priya Raman: Good. The new starter packs, Ana Sofía?
  [44:54] Ana Sofía Reyes: Done. They're in the drawer in reception. (unclear)
  [44:58] Priya Raman: The Brightsmile invoice?
  [45:01] Jonah Feld: Paid. Finally. Sixty-three days late but paid. (unclear)
  [45:05] Lukas Brenner: Ha. Sixty-three.
  [45:08] Priya Raman: And the van seven sat nav.
  [45:11] Lukas Brenner: Still sending them down the closed road by the river. I've reported it twice. (unclear)
  [45:16] Priya Raman: Twice?
  [45:18] Lukas Brenner: Twice. The drivers just ignore it now. They know the road. (unclear)
  [45:22] Priya Raman: Okay. So everything except the sat nav.
  [45:25] Jonah Feld: That's a good month. (unclear)
  [45:28] Priya Raman: That's a good month.
  [45:34] Ana Sofía Reyes: Can I ask about the new phones? For the CS room? We were told November. (unclear)
  [45:39] Priya Raman: IT said the second week of December now. The handsets are in. It's the line.
  [45:44] Ana Sofía Reyes: The second week of December is peak.
  [45:47] Priya Raman: I know. They'll do it on a Sunday. They promised.
  [45:51] Ana Sofía Reyes: Okay. If it's a Sunday. (unclear)
  [45:54] Jonah Feld: IT promised. (unclear)
  [45:56] Ana Sofía Reyes: Ha. Yeah.
  [46:02] Sam Okafor: The new hi-vis came, by the way. (unclear)
  [46:05] Priya Raman: Oh good.
  [46:07] Sam Okafor: All XXL. Every single one. Two hundred XXL vests. (unclear)
  [46:12] Lukas Brenner: Ha! For who?
  [46:14] Sam Okafor: For giants. Darren put one on, it went to his knees. Like a dress. (unclear)
  [46:19] Ana Sofía Reyes: Oh no.
  [46:21] Jonah Feld: That was the supplier. I sent them back already, the right ones come Monday. (unclear)
  [46:26] Sam Okafor: Darren wants to keep his.
  [46:28] Jonah Feld: Ha. Darren can keep his.
  [46:34] Priya Raman: Um...
  [46:41] Tomás Ibarra: The budgets for next year. Is that this month or next? Rafael said something. (unclear)
  [46:46] Priya Raman: Next month. He's sending the template next week. December's for budgets.
  [46:51] Tomás Ibarra: December. Of course. (unclear)
  [46:54] Jonah Feld: Everything's December.
  [46:57] Priya Raman: Everything's December. (unclear)
  [47:03] Lukas Brenner: Um.
  [47:09] Ana Sofía Reyes: Sorry, my team's waving at me. Someone wants me. One second.
  [47:13] Priya Raman: Sure.
  [47:47] Ana Sofía Reyes: Продолжение следует...
  [48:20] Ana Sofía Reyes: Sorry. Back. Someone wanted to know if they can give a customer a discount. I said no. (unclear)
  [48:25] Jonah Feld: Ha. What discount?
  [48:27] Ana Sofía Reyes: Fifty percent. Because he was nice on the phone. (unclear)
  [48:31] Lukas Brenner: Ha. That's a lot of nice.
  [48:34] Ana Sofía Reyes: He's new. He's lovely. He'll learn. (unclear)
  [48:39] Priya Raman: Ha. Okay.
  [48:45] Priya Raman: Um, where was I.
  [48:50] Sam Okafor: The building, I think. You said the building.
  [48:53] Priya Raman: The building. Yes. Okay. (unclear)
  [48:58] Tomás Ibarra: Before the building, can I say, the yard lights. They come on at six. It's dark at half four now. (unclear)
  [49:04] Priya Raman: They're on a timer?
  [49:06] Tomás Ibarra: A timer from the summer. Nobody changed it. (unclear)
  [49:10] Sam Okafor: Oh, I changed it. Yesterday. They come on at four now. (unclear)
  [49:14] Tomás Ibarra: Oh. You did? Thank you.
  [49:16] Sam Okafor: I tripped over a pallet in the dark. So. (unclear)
  [49:20] Lukas Brenner: Ha. Motivation.
  [49:23] Sam Okafor: Motivation. (unclear)
  [49:28] Priya Raman: Okay. Good.
  [49:34] Jonah Feld: Um...
  [49:41] Priya Raman: Sorry, I've lost my agenda. The coffee's in my, it's on the paper. (unclear)
  [49:47] Jonah Feld: Ha.
  [49:52] Priya Raman: Okay, I can read it. Barely. (unclear)
  [50:03] Tomás Ibarra: Takes me back to the paper KPI pack. (unclear)
  [50:06] Priya Raman: Ha. Don't.
  [50:12] Lukas Brenner: Um.
  [50:18] Ana Sofía Reyes: Sorry, I'm just answering the discount guy. Fifty percent. Honestly. (unclear)
  [50:24] Sam Okafor: Ha.
  [50:30] Priya Raman: Okay. So. (unclear)
  [50:41] Priya Raman: Sorry, someone's put a meeting over the end of this one. I'm just declining it. (unclear)
  [50:47] Jonah Feld: Ha. Who?
  [50:49] Priya Raman: Me. I booked it. Months ago.
  [50:53] Lukas Brenner: Ha!
  [50:58] Priya Raman: Okay. Declined. Right.
  [51:26] Priya Raman: Um...
  [51:31] Lukas Brenner: Can I tell you about Monday? It's sort of the building. (unclear)
  [51:35] Priya Raman: Go on.
  [51:37] Lukas Brenner: So Monday morning, one of the Kestrel drivers, the big guy with the beard, he gets to the car park barrier
  [51:44] Lukas Brenner: and the code doesn't work. Because facilities changed it on Friday. And nobody told anyone. (unclear)
  [51:49] Sam Okafor: Oh, that was him? I heard the horn.
  [51:52] Lukas Brenner: That was him. He sat there forty minutes. He ate his sandwich. He ate my sandwich, I gave him my sandwich. (unclear)
  [51:59] Ana Sofía Reyes: Ha! Why?
  [52:01] Lukas Brenner: I felt bad. He was singing to himself. Something from a musical. (unclear)
  [52:06] Jonah Feld: Which musical?
  [52:08] Lukas Brenner: I don't know. One with a lot of high notes. (unclear)
  [52:12] Tomás Ibarra: Ha.
  [52:15] Lukas Brenner: Anyway. Oh, actually, I'll send round the new barrier code. To everyone, the drivers too, the regular ones.
  [52:21] Priya Raman: Yes, please. Before another sandwich goes.
  [52:24] Lukas Brenner: Ha. My sandwich.
  [52:28] Sam Okafor: Facilities should send it themselves really. (unclear)
  [52:31] Lukas Brenner: Facilities should do a lot of things.
  [52:34] Jonah Feld: Ha.
  [52:40] Priya Raman: Okay. Um. Building and IT. Jonah, you had the wi-fi.
  [52:44] Jonah Feld: Yeah. So the dock wi-fi. The scanners keep dropping off on the dock. Like every ten minutes.
  [52:50] Sam Okafor: Every five.
  [52:52] Jonah Feld: Every five. IT came and looked. It's the access points. They're the original ones, from when we moved in. (unclear)
  [52:58] Tomás Ibarra: Two thousand and fourteen.
  [53:01] Jonah Feld: Two thousand and fourteen. So IT quoted to replace the dock ones. Four access points. (unclear)
  [53:06] Priya Raman: How much?
  [53:08] Jonah Feld: Two thousand three hundred. Fitted. (unclear)
  [53:12] Priya Raman: And that fixes it?
  [53:14] Jonah Feld: They say so. They tested a new one on the dock for a day and nothing dropped. (unclear)
  [53:19] Sam Okafor: It was a good day. Nobody shouted at a scanner. (unclear)
  [53:23] Lukas Brenner: Ha.
  [53:26] Priya Raman: Could we wait till after peak?
  [53:29] Sam Okafor: Please no. Peak is when it matters. Every drop is a pick that goes wrong. (unclear)
  [53:34] Tomás Ibarra: And the new scanners need it anyway. When they come.
  [53:38] Priya Raman: Okay. Fair.
  [53:42] Priya Raman: Then yes. We replace the dock access points. IT's quote, the two thousand three hundred.
  [53:48] Jonah Feld: Okay. I'll raise the PO today so they can book it in.
  [53:52] Priya Raman: Thanks.
  [53:55] Jonah Feld: They said a morning. Before eight. (unclear)
  [53:58] Sam Okafor: Before eight's fine.
  [54:03] Priya Raman: Okay. Um.
  [54:08] Jonah Feld: And, the landlord asked again about solar panels. On the roof. They'd pay half.
  [54:14] Tomás Ibarra: Again?
  [54:16] Jonah Feld: Third time. They really want to. (unclear)
  [54:19] Lukas Brenner: Would it save anything?
  [54:22] Jonah Feld: Over ten years, yes. In the first two, no. (unclear)
  [54:26] Priya Raman: Hm. Maybe. It's not a peak thing. Let's park it till next year.
  [54:31] Jonah Feld: Okay. Next year. (unclear)
  [54:35] Priya Raman: Yeah.
  [54:41] Tomás Ibarra: Sorry. Sorry, my radio. The gate says another truck's stuck under the barrier. The height one.
  [54:47] Sam Okafor: Another one?
  [54:49] Tomás Ibarra: Another one. Like, wedged. I have to go. I'm sorry, Priya. (unclear)
  [54:53] Priya Raman: Go. We'll do the rest.
  [54:55] Tomás Ibarra: The forklift, Halden, I've got it. The walkway, the counts. Okay. Bye. (unclear)
  [54:59] Jonah Feld: Bye. Good luck.
  [55:02] Lukas Brenner: Take a photo.
  [55:06] Priya Raman: Ha. Okay.
  [55:12] Priya Raman: Um...
  [55:17] Sam Okafor: Is that a Kestrel truck as well? (unclear)
  [55:20] Lukas Brenner: Probably. Kestrel's having a week.
  [55:23] Sam Okafor: Ha.
  [55:29] Priya Raman: Okay. Peak. Sam, overtime.
  [55:32] Sam Okafor: Yeah. So, last year, overtime was voluntary, and it was unlimited. And some of the lads did twenty hours a week extra.
  [55:40] Sam Okafor: For six weeks. And by January they were broken. Two of them were off sick in January. (unclear)
  [55:45] Ana Sofía Reyes: Twenty hours extra? That's a second job.
  [55:48] Sam Okafor: It's a second job. They want the money, and fair enough, but it's not safe. (unclear)
  [55:53] Jonah Feld: What were the mistakes like? Picking? (unclear)
  [55:56] Sam Okafor: Up. Way up. In the second half of December, double. (unclear)
  [56:01] Priya Raman: What do you want to do?
  [56:03] Sam Okafor: A cap. Eight hours a week extra per person. Max. Over peak.
  [56:08] Priya Raman: Will we have enough hours with a cap?
  [56:11] Sam Okafor: With the temps from the first, yes. That's why the first matters. (unclear)
  [56:15] Lukas Brenner: Does it count for drivers?
  [56:17] Sam Okafor: Drivers have their own hours. The law does that for you.
  [56:21] Lukas Brenner: Ha. True.
  [56:25] Priya Raman: Okay. Overtime over peak is capped at eight hours a week per person.
  [56:30] Sam Okafor: Thank you.
  [56:33] Sam Okafor: I'll set up the overtime sign-up with the cap in it. On the board in the canteen. So people can see.
  [56:39] Priya Raman: Great.
  [56:41] Sam Okafor: They'll moan.
  [56:43] Priya Raman: Everyone moans. (unclear)
  [56:46] Ana Sofía Reyes: Ha.
  [56:51] Priya Raman: Um. Peak, the website side. Next-day delivery.
  [56:55] Ana Sofía Reyes: Yes. Last year we kept next-day on the site till the twenty-third, and the orders from the
  [57:01] Ana Sofía Reyes: twenty-second and twenty-third didn't arrive till the twenty-seventh. I had eighty calls. (unclear)
  [57:06] Lukas Brenner: The courier stops on the twenty-second. Nobody delivers on the twenty-third. (unclear)
  [57:10] Priya Raman: So we said last month, next-day comes off from the twenty-second. That stands.
  [57:15] Ana Sofía Reyes: Yes. But it has to actually come off the site.
  [57:18] Priya Raman: That's Grace. Grace turns off next-day delivery on the site from the twenty-second.
  [57:23] Ana Sofía Reyes: She'll need reminding. It's a toggle somewhere. (unclear)
  [57:27] Priya Raman: She knows the toggle. (unclear)
  [57:30] Ana Sofía Reyes: Okay.
  [57:35] Jonah Feld: Um...
  [57:41] Priya Raman: And the count. The month-end count next Thursday. Sam, if it's right this time, you're buying pizza.
  [57:47] Sam Okafor: Ha. I'll get the pizza. With pineapple. For everyone. (unclear)
  [57:51] Lukas Brenner: No. No pineapple.
  [57:53] Sam Okafor: Pineapple or no pizza.
  [57:56] Ana Sofía Reyes: Ha!
  [57:58] Priya Raman: Ha. Okay.
  [58:04] Priya Raman: Um.
  [58:09] Sam Okafor: Returns. Can I do returns now? The cage. (unclear)
  [58:12] Priya Raman: Yes, Sam. Returns. Go.
  [58:15] Sam Okafor: Thank you. So the seconds cage and the returns bay are full. Like, full full. I can't close the cage.
  [58:21] Sam Okafor: There's stuff in there from June. Returns that nobody checked, they just sit there waiting to go back to stock. (unclear)
  [58:27] Jonah Feld: From June?
  [58:29] Sam Okafor: From June. Half of it's out of date packaging anyway, it can't go back to stock. (unclear)
  [58:34] Ana Sofía Reyes: And the customers have had their refunds, so it's all just ours now.
  [58:38] Priya Raman: Hm. What's normal? How long do returns usually sit?
  [58:42] Sam Okafor: Most are checked in a week. The ones that sit, they sit forever. (unclear)
  [58:47] Jonah Feld: What do other places do?
  [58:49] Sam Okafor: Everywhere I've worked had a cut-off. After so long, it goes to clearance. Sold off cheap. (unclear)
  [58:54] Priya Raman: What cut-off?
  [58:57] Sam Okafor: Sixty days? (unclear)
  [58:59] Ana Sofía Reyes: Sixty's fair. Customers have thirty days to return, so sixty days after it's back, it's ours.
  [59:05] Priya Raman: Okay. Returns older than sixty days go to the clearance pallet. Not back to stock.
  [59:11] Sam Okafor: Yes. Thank you.
  [59:13] Jonah Feld: Who buys clearance?
  [59:16] Sam Okafor: The market traders. There's two who come every month. They'll take anything.
  [59:20] Lukas Brenner: They took the broken chairs once. (unclear)
  [59:23] Sam Okafor: They took the broken chairs. And paid for them.
  [59:26] Ana Sofía Reyes: Ha.
  [59:31] Priya Raman: We need a clearance area, though. Marked out. Not the cage.
  [59:35] Sam Okafor: That's Tomás. The floor plan's his.
  [59:38] Priya Raman: Tomás has gone, but it's his. Tomás marks out and labels a clearance pallet area. He'll see it in the notes.
  [59:44] Sam Okafor: By the back door. There's space by the back door. (unclear)
  [59:48] Priya Raman: He'll find it.
  [59:52] Ana Sofía Reyes: And I'll tell the returns team about the sixty days. They'll need to know what to do when something's old.
  [59:57] Priya Raman: Thanks.
  [60:00] Ana Sofía Reyes: Two people. It's a quick message. (unclear)
  [60:03] Priya Raman: Okay.
  [60:08] Sam Okafor: Oh, and while we're on the floor. The first aid certificates. Three of ours run out in January.
  [60:14] Sam Okafor: Somebody needs to renew the first aid certificates. Or we're short of first aiders over Christmas.
  [60:19] Priya Raman: Hm. Yeah.
  [60:21] Jonah Feld: Mm.
  [60:24] Lukas Brenner: Yeah.
  [60:29] Priya Raman: Okay. Um...
  [60:35] Priya Raman: Nearly done. Any other business?
  [60:39] Jonah Feld: One thing. Are we still printing the KPI pack? For the board? (unclear)
  [60:43] Priya Raman: No. PDF only from now on. Nobody reads the paper one.
  [60:47] Jonah Feld: Good. It was forty pages. (unclear)
  [60:50] Priya Raman: Forty pages that went in a drawer.
  [60:53] Sam Okafor: Ha.
  [60:56] Priya Raman: I'll send this month's KPI pack as a PDF. To everyone.
  [61:01] Jonah Feld: Thanks.
  [61:05] Priya Raman: And the December review. It's on the twenty-second at the moment, which is mad. (unclear)
  [61:10] Ana Sofía Reyes: The twenty-second is when everything's on fire.
  [61:13] Lukas Brenner: The twenty-second I'll be in a van.
  [61:16] Priya Raman: Exactly. So we move it. The fifteenth?
  [61:19] Jonah Feld: The fifteenth works.
  [61:21] Sam Okafor: Fifteenth's fine.
  [61:24] Priya Raman: Okay. The December review moves to the fifteenth. I'll move the invite.
  [61:29] Ana Sofía Reyes: Thanks.
  [61:33] Priya Raman: Tomás will see all of this in the notes.
  [61:37] Lukas Brenner: If he's not still under the truck. (unclear)
  [61:40] Priya Raman: Ha. If he's not.
  [61:44] Priya Raman: Okay. Thanks everyone. That's a lot. That's a good one. (unclear)
  [61:48] Jonah Feld: Thanks Priya.
  [61:49] Ana Sofía Reyes: Thank you, bye.
  [61:51] Sam Okafor: Bye. Pizza Thursday. (unclear)
  [61:53] Lukas Brenner: No pineapple.
  [61:58] Priya Raman: ご視聴ありがとうございました`,
    expect: {
      decisions: [
        { what: 'The weekly safety walk moves from Saturdays to Fridays at seven, before the shift', at: '02:21' },
        { what: 'From Monday nobody walks through dock two while its doors are open: people use the side door', at: '03:52' },
        { what: 'The old scanners stay in use until the new Coastal ones arrive, rather than hiring some', at: '07:46' },
        { what: 'The top hundred SKUs are counted every week instead of a full count every month (the slow stock once a quarter)', at: '09:08' },
        { what: 'Renew Hollis Packaging for one year, not three', at: '11:15' },
        { what: 'The January glove order is split 70% Penang, 30% Corran, to cover the late container', at: '15:19' },
        { what: 'Drop the six o\'clock van: the last van leaves at half past four and does the estates first', at: '22:59' },
        { what: 'From January the vans move to Ardent fuel cards', at: '25:13' },
        { what: 'Customer service is closed on the 25th and 26th of December, and open nine to one on the 24th and 31st', at: '28:46' },
        { what: 'Refund Ostrander the shipping and the restocking fee on the crushed cases (about 170)', at: '30:21' },
        { what: 'The temps start on the 1st of December, not the 8th', at: '32:36' },
        { what: 'No second forklift lease for peak: one is enough until March', at: '34:44' },
        { what: 'Replace the four dock wi-fi access points on IT\'s quote of 2,300', at: '53:42' },
        { what: 'Overtime over peak is capped at eight hours a week per person', at: '56:25' },
        { what: 'Returns older than sixty days go to the clearance pallet, not back to stock', at: '59:05' },
        { what: 'The KPI pack goes out as a PDF only from now on, not printed', at: '60:43' },
        { what: 'The December review moves from the 22nd to the 15th', at: '61:24' }
      ],
      questions: [
        { what: 'Whether the Ardent cards work at motorway services, where the Bristol van fills up', at: '25:41' }
      ],
      actions: [
        { what: 'Brief the dock team on the side-door rule before Monday, at the Friday huddle', owner: 'Sam Okafor', due: 'before Monday (at the Friday huddle)', at: '05:31' },
        { what: 'Get the walkway from the side door to the canteen painted with yellow lines', owner: 'Tomás Ibarra', due: 'soon, while the painters are in for the car park, or no due date (either is right)', at: '05:56' },
        { what: 'Look at the lighting in aisle nine', owner: null, due: null, at: '06:37' },
        { what: 'Chase Coastal for a firm delivery date for the new scanners', owner: 'Jonah Feld', due: null, at: '07:59' },
        { what: 'Set up the weekly counts in the system', owner: 'Tomás Ibarra', due: null, at: '09:20' },
        { what: 'Ask the auditors whether weekly counts change anything for the year-end count', owner: null, due: null, at: '09:29', alsoAs: 'question' },
        { what: 'Send Hollis the one-year renewal', owner: 'Jonah Feld', due: null, at: '11:22' },
        { what: 'Send Ana Sofía the new Hollis rep\'s number', owner: 'Jonah Feld', due: null, at: '12:08' },
        { what: 'Place the January glove order (70/30) once the month-end count is in', owner: 'Jonah Feld', due: 'next week, once the count is in', at: '15:40' },
        { what: 'Email the 32 customers on the six o\'clock route about the earlier van', owner: 'Ana Sofía Reyes', due: null, at: '23:38' },
        { what: 'Change the drivers\' schedule for the half-four van', owner: 'Lukas Brenner', due: null, at: '23:58' },
        { what: 'Order eight Ardent fuel cards, one per van, and cancel the old ones once they work', owner: 'Lukas Brenner', due: null, at: '25:24' },
        { what: 'Put the Christmas customer service hours on the website', owner: 'Grace Adeyemi', due: null, at: '29:01' },
        { what: 'Brief the customer service team on the Christmas hours', owner: 'Ana Sofía Reyes', due: null, at: '29:14' },
        { what: 'Refund Ostrander the shipping and the restocking fee', owner: 'Ana Sofía Reyes', due: 'today', at: '30:27' },
        { what: 'Send Priya the November complaint numbers by category', owner: 'Ana Sofía Reyes', due: 'Thursday', at: '31:03' },
        { what: 'Book the temps\' safety induction for their first morning, once HR has their contracts back', owner: 'Priya Raman', due: 'once HR has the contracts back, or no due date (either is right)', at: '32:56' },
        { what: 'Put together a buddy list pairing each temp with one of the team', owner: 'Sam Okafor', due: null, at: '33:12' },
        { what: 'Tell Halden they don\'t need the second forklift', owner: 'Tomás Ibarra', due: null, at: '35:09' },
        { what: 'Send round the new car park barrier code to everyone, the regular drivers too', owner: 'Lukas Brenner', due: null, at: '52:15' },
        { what: 'Raise the PO for the dock access points', owner: 'Jonah Feld', due: 'today', at: '53:48' },
        { what: 'Set up the overtime sign-up with the eight-hour cap on the canteen board', owner: 'Sam Okafor', due: null, at: '56:33' },
        { what: 'Turn off next-day delivery on the website from the 22nd', owner: 'Grace Adeyemi', due: 'from the 22nd', at: '57:18' },
        { what: 'Mark out and label a clearance pallet area', owner: 'Tomás Ibarra', due: null, at: '59:38' },
        { what: 'Tell the returns team about the sixty-day rule', owner: 'Ana Sofía Reyes', due: null, at: '59:52' },
        { what: 'Renew the first aid certificates, three of which run out in January', owner: null, due: 'January (when three run out), or no due date (either is right)', at: '60:14' },
        { what: 'Send this month\'s KPI pack to everyone as a PDF', owner: 'Priya Raman', due: null, at: '60:56' },
        { what: 'Move the December review invite to the 15th', owner: 'Priya Raman', due: null, at: '61:24' }
      ],
      acceptable: [
        'The Hollis contract ends on the 31st of December (as a fact)',
        'A three-year Hollis deal would have been 2% a year cheaper',
        'The weekly counts on Tuesday mornings (as a decision)',
        'Big December glove orders may ship in two parts (as a decision, or a follow-up for Ana Sofía)',
        'The glove split costing about 2,100 extra',
        'Whether to tell customers the Corran gloves come in a different box (as an open question)',
        'No more hand towels ordered until March (as a decision)',
        'Whether to go back to the better tape (as an open question)',
        'Next-day delivery comes off the site from the 22nd (as a decision or a fact)',
        'On-time delivery at 91%, down from 94%, mostly from the six o\'clock van',
        'The Ardent cards saving about 4,000 to 4,500 a year',
        'The temps\' extra week costing about 3,200, within the peak budget',
        'Whether to get an electric van for the town runs, put off until after peak (as an open question)',
        'Whether to put solar panels on the roof, put off until next year (as an open question)',
        'The insurer\'s site visit on the 9th of December (as a fact)',
        'The near miss at dock two, written up the same day (as a problem mentioned)',
        'The access points fitted one morning before eight (as a fact)'
      ],
      never: [
        'The safety walk staying on Saturdays',
        'The temps starting on the 8th of December as settled',
        'A second forklift lease taken for peak',
        'The six o\'clock van kept',
        'Hiring scanners until the new ones come',
        'Renewing Hollis for three years',
        'The whole January glove order from Penang alone, or from Corran alone, as settled',
        'The KPI pack still printed on paper as settled',
        'Sam buying pizza, with pineapple or without, as a decision or a follow-up (a joke)',
        'Solar panels on the roof as a decision or a follow-up: put off until next year',
        'An electric van as a decision or a follow-up: put off until after peak',
        'Changing the tape as settled, or as a follow-up for Priya: she only said she would think about it',
        'Checking when the Hollis contract ends as a follow-up: Jonah looked it up in the call (the 31st of December)',
        'Changing the yard lights\' timer as a follow-up: Sam already did it',
        'Sending back the XXL hi-vis vests as a follow-up: Jonah already did',
        'Claiming the Ostrander refund back from the courier as a follow-up: Priya said to leave it',
        'A guess at what Tomás said while notes were paused, or anything about the disciplinary beyond Tomás asking to pause for one',
        'That Grace was in the call, or said or agreed to anything in it (follow-ups she was given are fine)',
        'Anything from the Russian, French, Ukrainian or Japanese lines (to be continued, subtitles, thanks for watching)'
      ]
    }
  },
  {
    id: 'room-relay-missing',
    checks: 'A 126-minute room recording of a move workshop, about 127,600 characters as the notes model reads it, so its middle is cut: L679 [55:42] to L765 [65:22] never reach the model. Inside the cut are the ownerless post redirect (56:24), the alarm decision and Rafael\'s job (58:11, 58:32) and Tomás\'s rota once Halvorsen confirm (63:44); all but the post redirect are read out again from the board at 79:03 and 122:47. Owners come only from names said aloud: Dana\'s and Jonah\'s jobs arrive as relayed messages, Kofi never speaks and nods to his, and Ana Sofía is away.',
    title: 'Brookfield move workshop',
    kind: 'room',
    organizer: 'Mei Lin Zhou',
    invited: ['Lukas Brenner', 'Tomás Ibarra', 'Kofi Mensah', 'Rafael Ortega', 'Jonah Feld', 'Dana Whitfield', 'Ana Sofía Reyes'],
    language: 'call',
    writtenIn: 'en',
    gaps: [{ kind: 'paused', at: '32:40', minutes: 4 }],
    transcript: `
  [00:02] Продолжение следует...
  [00:19] Sous-titres réalisés par la communauté d'Amara.org
  [00:34] Is it recording? Is that the red dot, or is that just the battery thing? (unclear)
  [00:39] It's recording, it says recording, the little timer's going, look, nine seconds, ten seconds.
  [00:45] Okay. Put it in the middle of the table so it gets everyone, not next to Lukas, he's got the loud voice.
  [00:51] I haven't got a loud voice, I've got a normal voice, everyone else whispers.
  [00:56] Ha.
  [01:01] Does the projector work? I've got the floor plan on my laptop and it just keeps saying no signal, no signal.
  [01:08] It never works. It's never worked. There's an adapter in the drawer that's for a different laptop. (unclear)
  [01:14] Okay, forget the projector, we'll do it on the whiteboard like animals.
  [01:19] Like animals. Okay. Who's got a pen that works? (unclear)
  [01:24] This one's okay. It's a bit pale but it's okay.
  [01:29] Is Rafael coming? He said he'd be here at ten and it's ten past. (unclear)
  [01:34] He's driving back from the bank. The ring road, so, he'll be late, he'll be twenty minutes, he always says ten.
  [01:41] And Jonah's dialling in from the other site, he said he'll ring the conference phone at quarter past.
  [01:47] Does the conference phone work? The spider thing?
  [01:51] It worked last week. Kofi used it last week for the supplier thing, didn't you, Kofi? (unclear)
  [01:57] He's nodding. It works. Okay. (unclear)
  [02:03] And Dana's not coming, she's working from home, her kid's sick, but she said she'll keep an eye on her phone.
  [02:10] And Ana Sofía's on holiday till Monday, she's in Valencia, she said don't call her, so nobody call her.
  [02:17] Lucky Ana Sofía. (unclear)
  [02:21] Very lucky. It's twenty degrees in Valencia. I looked. I looked this morning, out of spite.
  [02:27] Ha.
  [02:33] Okay. Coffee, everyone's got coffee? There's more in the pot, it's the one from the morning so it's, it's strong. (unclear)
  [02:40] It's tar. It's actually tar. I can stand the spoon up in it.
  [02:45] It's fine. It's fine, it's character. (unclear)
  [02:51] Okay. So. Brookfield. I'm going to write the list and then we just go through it, and I want to come out of here
  [02:58] with every single thing that has to happen for the move on the board with a name next to it. That's the goal.
  [03:04] With a name. Not "someone". (unclear)
  [03:07] Not someone. Someone is nobody. Okay, so: the date. Racking. Phones and the IT. Stock. People. The customers.
  [03:15] The old unit, getting out of here. And the money, which Rafael will tell us about when he gets here. (unclear)
  [03:21] The money's the scary one.
  [03:24] The money's always the scary one. Okay. Date first, because everything hangs off the date. (unclear)
  [03:31] Is it definitely the weekend of the seventh? Because I heard someone say the fourteenth, in the canteen, yesterday.
  [03:37] Yes. It's the seventh and the eighth of February. That's fixed. The lease starts on the first, we get the keys on the first,
  [03:44] we use the first week to get ready, and we move the weekend of the seventh and eighth. Not the fourteenth.
  [03:50] Who said the fourteenth? (unclear)
  [03:53] I don't know, someone at the coffee machine. Probably someone who wants Valentine's Day off.
  [03:58] Ha. Okay. Seventh and eighth. I'm writing it at the top, big. Seventh, eighth, February.
  [04:04] And the whole of the first week we're in both buildings. Paying for both.
  [04:09] Paying for both, yeah, the old lease runs to the end of Feb, so we overlap a month, which is the plan, that's on purpose. (unclear)
  [04:16] Okay. Good. Okay. (unclear)
  [04:21] Racking. This is the big one. What actually goes, because I don't want to move rubbish nine miles.
  [04:27] So we've got, what, twelve runs of pallet racking, the red stuff, the beams and the uprights, and that's
  [04:33] all fairly new, that's five years old, that's good, that all goes, I don't think anyone's arguing about that.
  [04:39] Nobody's arguing. The red stuff goes.
  [04:42] And then there's the old shelving. The grey long-span, at the back, aisles fourteen to eighteen.
  [04:48] That's older than the building. That came from the old old warehouse. Before my time. (unclear)
  [04:53] It's from the nineties. It's got the old company name stamped on the uprights.
  [04:58] Does it even fit at Brookfield? The ceiling's higher but the bays are a different width, I measured on the visit. (unclear)
  [05:05] It doesn't fit nicely. You'd lose like half a metre every bay because the column spacing's different.
  [05:11] So we'd be moving it nine miles to put it up badly.
  [05:15] And it takes two days to take down, it's all bolts, there's no clips on the old stuff, it's all bolts, rusty bolts.
  [05:22] Okay so what do we do with it? (unclear)
  [05:25] Sell it. There's people who buy that stuff. There's a guy who came round last year asking if we were selling.
  [05:31] The guy with the white van and the dog. (unclear)
  [05:34] The guy with the dog. He'll take it. Probably for nothing, but he'll take it down himself, which is the point.
  [05:41] Okay. So: only the pallet racking goes to Brookfield. The old grey shelving stays here and we sell it.
  [05:47] Yes. Agreed. Write it down.
  [05:47] Sell it, yeah. (unclear)
  [05:50] Writing. Pallet racking, yes. Grey shelving, no, sell. (unclear)
  [05:56] What do we put on the shelving stuff then, at Brookfield? The small parts, the gloves in singles, the samples. (unclear)
  [06:02] More pallet racking with decking on the low level. It's cheaper than shelving now anyway. We'll come to the money.
  [06:08] Okay. Later. (unclear)
  [06:13] Can I just say, while we're on racking, the inspection's due in March, here, on the old stuff,
  [06:19] and it's not going to be here in March, so we don't need it, so someone tell the inspection company not to come.
  [06:25] That's the annual one? The one in March?
  [06:28] That's the annual one. They'll turn up at an empty building otherwise.
  [06:32] Oh, I already cancelled that. Last week. I moved it to Brookfield, April, once the racking's up there. (unclear)
  [06:38] Oh. Okay. Great. Good. Done then.
  [06:41] Done. They're coming to Brookfield in April. It's in the calendar. (unclear)
  [06:47] Okay. Racking, I'll come back to how it gets there. Next is phones, but Jonah's not on yet, so... (unclear)
  [06:54] Let's do the layout then. The layout at Brookfield, the aisles.
  [06:59] Can we do the layout once Rafael's here? Because the layout is money. The two options are different money.
  [07:05] Fair. Okay. Um. Stock then? No, stock depends on the date and the racking.
  [07:11] Everything depends on everything. (unclear)
  [07:15] Ha. Everything depends on everything. Okay, let's do the bit that doesn't depend on anything. The old unit.
  [07:21] No, wait, the old unit depends on when we're out. (unclear)
  [07:25] Ha! Okay. Okay. Let's just wait two minutes for Jonah and get more coffee.
  [07:31] More tar.
  [07:34] More tar. (unclear)
  [07:38] Did anyone watch the baking thing last night? The final? (unclear)
  [07:41] I fell asleep before the end. Who won? Don't tell me. No, tell me.
  [07:45] The one with the beard. The quiet one. He made a castle out of bread. An actual castle, with a drawbridge that went up and down.
  [07:52] A bread drawbridge?
  [07:54] A bread drawbridge. It worked. The judge cried. Everyone cried. I cried a bit, honestly.
  [07:58] Дякую за перегляд!
  [08:02] My kids want to make a bread castle now. This weekend. I said we'd do a bread shed. Start small.
  [08:08] Ha. A bread shed.
  [08:11] A bread shed with a bread lawnmower. (unclear)
  [08:14] Ha. Okay.
  [08:24] Is the heating on in here? It's freezing. My hands are actually cold.
  [08:29] It comes on at nine and it goes off at nine fifteen. Nobody knows why. Facilities say it's the timer.
  [08:35] Facilities always say it's the timer. (unclear)
  [08:39] At Brookfield the heating's in the floor. In the offices. Underfloor heating. In a warehouse office.
  [08:45] Fancy.
  [08:47] Fancy. We're going up in the world. (unclear)
  [08:53] Hiya, sorry, sorry, the ring road, it was solid from the roundabout, I sat behind a horse box for twenty minutes.
  [09:00] Rafael! Sit down, sit down, we've done the date and the racking.
  [09:04] A horse box?
  [09:06] A horse box. With a horse in it. It was looking at me. It looked bored. I was bored too.
  [09:12] Ha.
  [09:15] Okay, so Rafael, quickly: it's the seventh and eighth of Feb, that's fixed. The pallet racking goes, the red stuff,
  [09:22] all twelve runs, and the old grey shelving at the back stays here and we sell it to the man with the dog.
  [09:28] The man with the dog. Okay. Good, that saves money, the shelving was in my numbers as moving.
  [09:34] It's not moving. (unclear)
  [09:37] Great. That's out of the numbers then. Is there coffee? (unclear)
  [09:41] There's tar.
  [09:43] Tar's fine. Tar's what I need. (unclear)
  [09:49] Okay. Is Jonah calling? It's quarter past. Is the phone on? The light's green.
  [09:55] It's green. That means it's on. It's waiting. (unclear)
  [10:04] Hello? Hello, can you hear me? It's Jonah, I'm in the office at the other site, I've got you on speaker.
  [10:09] Jonah! Yes, we can hear you, you're a bit echoey but we can hear you. You're in the middle of the table.
  [10:15] I'm in the middle of the table. Great. Hello table. Who's there? (unclear)
  [10:19] Me, Lukas, Tomás, Kofi, and Rafael just got here. Dana's at home, Ana Sofía's in Valencia.
  [10:25] Lucky Ana Sofía.
  [10:25] Valencia. (unclear)
  [10:27] That's what everyone says. (unclear)
  [10:31] Okay Jonah, we're on phones and IT, because you're here. What do we need to know?
  [10:36] So, phones first. The big question is the numbers. The main number and the customer service line and the,
  [10:43] the direct lines, there's about thirty numbers in all. Brookfield is a different exchange, so we can either get
  [10:49] new numbers there, which is free, or port the old ones across, which costs something and takes ten working days.
  [10:56] How much does porting cost? (unclear)
  [10:59] About four hundred for all of them. It's per number but it's not much per number.
  [11:04] And if we get new numbers? What happens to the old ones?
  [11:08] They'd divert for a year, and then they'd die. And every customer has our number on everything. Every invoice,
  [11:14] every box, every van, the website, the catalogue. People ring the number off a box from three years ago.
  [11:21] They do. They ring the number off the box. My team get calls from a box from before the logo changed. (unclear)
  [11:27] So do we keep the same phone numbers, or not? Jonah, what do you think?
  [11:31] Yes. We keep them. We port them. We're not changing numbers, it's four hundred quid, it's nothing,
  [11:37] changing the numbers would cost us more than that in lost calls in the first week.
  [11:41] Agreed. Same numbers. We port them.
  [11:44] Same numbers. Writing it. Phones, port, same numbers. (unclear)
  [11:49] And what about the internet? Is there internet at Brookfield or is it, is it a field?
  [11:54] There's a line into the building, the old tenant had it, but it needs an install, a proper one, someone has to come.
  [12:01] Hang on, sorry, I've got a message from Dana. Hang on. (unclear)
  [12:06] Is it about the kid? Is the kid okay?
  [12:09] No, the kid's fine, he's watching cartoons. It's about Brookfield. She says, hang on, I'll read it out.
  [12:15] She says, "Tell Mei Lin I'll send the floor plan from the lease on Friday, the one with the measurements,
  [12:21] I've got it at home, it's in my bag." So that's Dana, Friday, the floor plan from the lease.
  [12:27] Oh great, that's the one with the column positions. We need that for the layout.
  [12:32] Friday. Dana, floor plan. Writing. (unclear)
  [12:36] Can you tell her thanks? And hope the kid's okay?
  [12:39] Done. She's sent a thumbs up. And a picture of the kid. He's got a, he's got a blanket on his head.
  [12:45] Ha. Aw. (unclear)
  [12:49] Okay, sorry Jonah, internet.
  [12:52] Yeah, so the internet needs an install, and the phones need the internet, so the internet goes first.
  [12:58] And the porting, the ten working days, that starts when we tell the phone company, so it has to start
  [13:04] in the middle of January at the latest, so the numbers come over on the, the first or the second.
  [13:09] Okay. Who does that? (unclear)
  [13:12] I'll get the numbers ported. I'll do the form, it's my account anyway, the phone account's in my name.
  [13:18] Brilliant. Jonah, porting the numbers. Writing it.
  [13:22] What about the handsets? Do they just come with us in a box? (unclear)
  [13:26] They just come in a box. Unplug, box, plug in. They're internet phones, they don't care where they are,
  [13:32] as long as there's internet. That's the whole point of them. (unclear)
  [13:36] And the printers? The label printers on the dock?
  [13:40] Same. Unplug, box. The big printer in the office is leased, the lease company moves it, I've told them already.
  [13:47] They're coming on the ninth. (unclear)
  [13:50] The ninth of Feb? The Monday?
  [13:53] The Monday. The ninth. They said the morning. (unclear)
  [13:57] Okay. And the server? The thing in the cupboard?
  [14:01] There is no server, there hasn't been a server for two years, it's all in the cloud, the cupboard's
  [14:07] just got the router and a lot of dust and somebody's bike helmet.
  [14:11] That's mine. Sorry. (unclear)
  [14:14] Ha. Lukas's bike helmet.
  [14:17] It's been there since the summer. I forgot I had a bike. (unclear)
  [14:22] Okay. So IT is internet, phones ported, printers in boxes, the big printer moves itself on the ninth. Okay.
  [14:30] And the wi-fi at Brookfield. We'll need access points on the warehouse floor for the scanners.
  [14:35] Yeah, that's in the install. I've asked for six. Same as here plus two because it's bigger. (unclear)
  [14:41] Six. Okay.
  [14:45] Can we do the layout now? Rafael's here.
  [14:49] Layout. Yes. Okay, so I'm going to draw the two options. This is the building, it's long and thin,
  [14:56] the dock's on this side, the short side, here, and the offices are upstairs on this end, over here.
  [15:02] Option A is what the landlord's drawing shows, narrow aisles, two point eight metres, which gets us
  [15:09] twenty-two rows of racking, which is two more rows than we've got now. More space. (unclear)
  [15:14] And option B?
  [15:16] Option B is wide aisles, three and a half metres, which gets us twenty rows. Same as now. No more space.
  [15:23] Why would we want less space? We're moving to get more space. (unclear)
  [15:27] Because the reach truck can't turn in two point eight. It needs three point two minimum, three and a half to be safe.
  [15:34] In two point eight we'd need a narrow aisle truck, a VNA, and a VNA is like sixty thousand pounds.
  [15:40] Sixty?
  [15:42] Sixty. New. You can lease one for, I don't know, twelve hundred a month? Something like that. (unclear)
  [15:48] So option A is two more rows and a sixty grand truck.
  [15:52] And training. Nobody here can drive a VNA. You need a different ticket. (unclear)
  [15:57] And option B is the same rows as now and we use the trucks we've got.
  [16:02] And the same rows as now is enough? Because we're moving partly because we're full.
  [16:07] We're full because of the grey shelving at the back, which is half empty and takes five aisles,
  [16:13] and the hand towels, the bay of hand towels nobody wants. If the shelving goes and the hand towels go,
  [16:19] we've got space. Twenty rows of pallet racking is more pallet spaces than we've got now. (unclear)
  [16:25] Is that true? Do we have the numbers?
  [16:28] I did the numbers. It's about fifteen percent more pallet spaces, with twenty rows of red racking and no grey.
  [16:35] Fifteen percent. And with option A?
  [16:38] Twenty-five percent. But the truck. (unclear)
  [16:42] The truck. Rafael, money-wise?
  [16:45] Option A is not happening this year. There is no sixty thousand. There's barely any thousands. (unclear)
  [16:51] Ha. Okay.
  [16:54] Okay. So we go with option B. Wide aisles, three and a half metres, for the reach truck. We lose the two rows.
  [17:00] Agreed. Option B.
  [17:00] B, yeah. Wide. (unclear)
  [17:02] Option B. Wide aisles. I'll circle it.
  [17:05] Can we leave room to go to option A later? Like, if we're busy in two years and we buy a VNA?
  [17:11] The racking's bolted to the floor, you can move it, it's a weekend's work. So yes, in theory. (unclear)
  [17:17] In theory. Okay. (unclear)
  [17:21] Jonah, are you still there? We went quiet on you.
  [17:24] I'm here. I was listening to the truck thing. I'm glad I'm in IT. (unclear)
  [17:29] Ha.
  [17:33] Oh, the sign. Can I say about the sign? The building's got the old tenant's sign on the front, on the road side,
  [17:40] the big one. It still says Marlow Freight. And people will turn up at Marlow Freight. (unclear)
  [17:46] Can we put our sign up? Is that ours to decide or the landlord's?
  [17:50] I have no idea. It's on the building, so... the landlord? Maybe? Maybe it's in the lease. (unclear)
  [17:56] Someone should really ask the landlord whether we can put our sign up out front, on the road. Before we move.
  [18:02] Yeah. Good point. (unclear)
  [18:05] Mm.
  [18:08] Yeah.
  [18:13] Okay. Um. Where was I. (unclear)
  [18:18] The floor. The floor at Brookfield. Can it take the double-height racking? Because here we've got a
  [18:25] reinforced slab, they did it when they put the racking in, and the red racking is six metres high when it's full.
  [18:31] And at Brookfield it'll be higher, because the ceiling's higher, so we'd go to eight metres. Double height.
  [18:37] Does the floor take eight metres of loaded racking? I have honestly no idea. (unclear)
  [18:42] Marlow Freight had racking. They had high racking. I saw the bolt holes. (unclear)
  [18:47] Their racking could have been light stuff. Boxes. We've got liquids, we've got the heavy pallets.
  [18:53] Hm. It might be in the lease. The survey, there was a survey. Dana might know. (unclear)
  [18:58] Hm.
  [19:01] Hm. Okay. (unclear)
  [19:06] Jonah, how's the line? You're breaking up a bit.
  [19:10] It's the, I'm on the, it's the (unclear)
  [19:14] Jonah? Jonah, you're gone. You're all robot.
  [19:19] Can you hear, I can't, the (unclear)
  [19:23] He's gone. The light's gone red. The spider's dead. (unclear)
  [19:28] Ring him back?
  [19:31] It won't ring out, it never rings out, it only takes calls in. He'll call back. Or he won't. (unclear)
  [19:38] Okay. We'll carry on, he'll text.
  [19:43] Okay. Um. (unclear)
  [19:49] Can we do the stock? How the stock gets there?
  [19:53] Let's do that after who moves the racking, because it's the same weekend.
  [19:58] Okay. Then who moves the racking. (unclear)
  [20:03] Actually, no, wait. I need Halvorsen's price from last time for that, it's in my email somewhere, from
  [20:09] when they did the mezzanine here. Let me find it. Do the labels while I look, Tomás, the labels are yours anyway.
  [20:15] Okay. Labels. So every location at Brookfield needs a new label. Every bay, every level.
  [20:21] Because the aisle codes change. Here it's aisle one to eighteen, A to F up the levels. At Brookfield it's twenty rows,
  [20:28] so it'll be aisle one to twenty, and the levels go up to G now because it's higher. (unclear)
  [20:33] How many labels is that?
  [20:36] Twenty rows, eleven bays a row, seven levels... about fifteen hundred. Plus the floor locations at the dock. (unclear)
  [20:43] Fifteen hundred labels. Who prints fifteen hundred labels?
  [20:47] The label printer prints them, it's not hard, it's the system that makes them, you export the locations
  [20:53] and it prints a roll. It's sticking them on that's the job. With a ladder. Fifteen hundred times. (unclear)
  [20:59] Before the stock goes in. They have to be up before the stock goes in or the scanners don't know where anything is.
  [21:05] So in the first week. The week we've got the keys and we're getting ready.
  [21:10] In the first week. Before the seventh. (unclear)
  [21:14] Who did them last time? When the red racking went in here?
  [21:18] Kofi did. Kofi did all of them. With the, the long pole thing. (unclear)
  [21:23] Ha. The pole. I remember the pole.
  [21:26] Kofi, you did the labels last time. Can you do the location labels for the new racking at Brookfield? In the first week?
  [21:33] He's nodding. Kofi's nodding. Okay. Kofi, the labels. Thank you, Kofi.
  [21:39] Writing it. Kofi, location labels, first week.
  [21:43] He's got the pole. He'll want the pole. Does the pole come with us? (unclear)
  [21:47] The pole comes with us. Kofi's pole. (unclear)
  [21:51] Ha.
  [21:56] And the system has to have the new locations in it before the labels, so the export works.
  [22:02] The locations go in the system with the layout anyway, that's not a separate thing. It's a morning's work.
  [22:08] Okay, so that's in with the layout. Good. (unclear)
  [22:13] Found it. Halvorsen. Last time they did the mezzanine, it was eleven thousand four hundred, but that was building it,
  [22:20] not moving it. Moving's different, taking down and putting back up. (unclear)
  [22:25] Did they quote for moving?
  [22:27] Not yet. I asked them about it on the phone, in December, they said roughly. Roughly is not a quote.
  [22:33] Roughly is never a quote. What was roughly?
  [22:37] Roughly eight. For the twelve runs. Over a weekend. (unclear)
  [22:41] Eight thousand. Okay. Hold that thought, let me see what else we've got before we decide who does it.
  [22:48] Okay.
  [22:53] Oh, Jonah's texted. Hang on. He says, "Sorry, the line dropped, the phone here died, it's ancient.
  [23:00] Tell everyone I'll book the internet install for the second of February, before the phones, so the porting works."
  [23:06] The second. That's the Monday. Before the move weekend, good. That gives a week.
  [23:11] So Jonah books the internet install for the second. Writing. Jonah, internet, the second. (unclear)
  [23:17] Does he want us to call him back?
  [23:19] He says no, he's got a delivery, he'll read the notes. He says, "Don't give me anything else." Ha. (unclear)
  [23:25] Ha. Too late.
  [23:28] Ha.
  [23:33] Okay. So we're, where are we. Labels, IT, layout. The postcode. Someone asked me for the postcode
  [23:40] for the forms, the insurance forms and the, the bank. What's the postcode at Brookfield? Does anyone know it?
  [23:46] It's on the lease. Hang on, I've got the lease on my phone, the PDF. Hang on. (unclear)
  [23:53] It's BR something. BR7? (unclear)
  [23:57] Here. Unit seven, Brookfield Park, Halden Road, BR7 4LN. That's it. B R seven, four L N.
  [24:05] Great, thanks. B R seven four L N. Done. It's on the board now, so everyone can stop asking me. (unclear)
  [24:11] Halden Road, like Halden the leasing people?
  [24:14] Different Halden. Probably. I don't know. (unclear)
  [24:18] Ha.
  [24:24] Speaking of the visit, can I just say, Rafael, did you ever get your car back? (unclear)
  [24:28] Oh, don't. Don't.
  [24:31] What happened?
  [24:33] On the visit, last Thursday. I parked outside unit seven, in the bay, in front of our building, our future building,
  [24:41] and I came out after the tour and there was a clamp on it. A yellow clamp. Because it's a permit bay. (unclear)
  [24:47] It's our building!
  [24:47] No way. A clamp? (unclear)
  [24:49] That's what I said! I said, it's my building, I'm moving in, and the man said, not until February you're not.
  [24:56] Ha! He's right though. (unclear)
  [24:56] He's not wrong.
  [24:59] He was right. It was a hundred and twenty pounds to get it off. A hundred and twenty. (unclear)
  [25:05] Did you claim it on expenses? (unclear)
  [25:07] I'm the expenses. I can't claim it from myself. Well, I can, but I'd have to approve it, and I wouldn't.
  [25:14] Ha!
  [25:16] So is it all permits there? The whole park? (unclear)
  [25:20] The whole park. Every bay. You need a permit from the park office, there's an office by the gate, a little hut.
  [25:27] So all our staff need permits? From day one? Or they all get clamped on Monday the ninth?
  [25:33] That would be a fun Monday.
  [25:35] Rafael, you're the one who got clamped. You've met the hut. You ask the park office for parking permits.
  [25:41] Fine. Fine. I'll ask the park office for parking permits. For everyone. I'll take the hundred and twenty with me.
  [25:47] Ha. Take the clamp.
  [25:50] I'll take the clamp. As a souvenir. (unclear)
  [25:54] How many permits do we need?
  [25:57] Everyone who drives. Forty? Thirty-five? I'll ask them how it works. (unclear)
  [26:02] Okay. Rafael, permits. Writing it.
  [26:06] The man with the clamp is going to love me. (unclear)
  [26:10] Ha.
  [26:16] Okay. Um. Before who moves the racking, I want to do the big question. The closing question. (unclear)
  [26:22] Go on.
  [26:24] I keep getting asked by the sales team, by customer service, everyone. Do we close? Like, for the move.
  [26:30] Some places close for a week when they move. Can we afford that? Can we afford not to?
  [26:35] We can't close for a week. Not in February. February's when everyone restocks after Christmas.
  [26:41] We closed for two days when we moved in here, in twenty fourteen, and it was a disaster, the phones,
  [26:47] the backlog took three weeks. (unclear)
  [26:50] I wasn't here for that.
  [26:52] You were lucky. (unclear)
  [26:56] So what are the options? (unclear)
  [26:59] Close the Friday and the Monday, move over the weekend, open Tuesday. That's one.
  [27:04] Or we don't close at all. We take orders the whole time, the website's always open anyway, we just don't ship
  [27:10] on the Friday because we're packing up, and we ship again on the Monday from Brookfield.
  [27:15] Is Monday realistic? The stock goes in on the Saturday and Sunday, and we're picking from it on the Monday?
  [27:21] If the labels are up. If the system's right. If the scanners work on the new wi-fi. (unclear)
  [27:26] That's a lot of ifs.
  [27:28] It's a lot of ifs. But closing's worse. (unclear)
  [27:32] Hm.
  [27:36] What about the Saturday orders? Do we pick anything on the Saturday? Normally we do a half day.
  [27:41] Not this Saturday. This Saturday the whole team's moving stock. (unclear)
  [27:45] Okay.
  [27:49] Can I get the numbers for the Friday? How many orders on a normal Friday in February?
  [27:54] About four hundred lines. Two hundred orders, roughly. (unclear)
  [27:58] And they'd all go out on the Monday instead.
  [28:01] With the Monday's own orders. So Monday's double.
  [28:04] Monday's double. In a building we've been in for two days. (unclear)
  [28:08] Ha. Lovely.
  [28:13] Can we ship the Friday orders on the Thursday? Like, pull them forward? (unclear)
  [28:17] Not the ones that come in on the Friday. They haven't been ordered yet on the Thursday.
  [28:21] Oh. Yeah. Obviously. Sorry. It's the tar. (unclear)
  [28:25] Ha.
  [28:29] What does customer service think? Ana Sofía would know. She's in Valencia.
  [28:34] Don't call her. (unclear)
  [28:36] I'm not calling her. But she said last month, she said whatever we do, don't go quiet. Customers hate quiet.
  [28:42] That's a vote for staying open.
  [28:45] That's a vote for staying open. (unclear)
  [28:50] Rafael, the money? Is closing cheaper? (unclear)
  [28:53] Closing's not cheaper. Closing's two days of no sales. Staying open is two days of slow sales.
  [28:59] Slow beats none.
  [29:02] Slow beats none. (unclear)
  [29:07] Okay, I think I know what we're doing, but let me just, let's write both options up so we can see them.
  [29:13] Option one, close Friday and Monday. Option two, stay open, no shipping Friday, ship from Brookfield Monday.
  [29:20] It's option two. Everyone's said option two. (unclear)
  [29:24] I know. I just like to see it written down. It's a whiteboard thing. (unclear)
  [29:28] Ha. Okay.
  [29:34] Tomás, the Monday. Can the warehouse actually do a double Monday in a new building?
  [29:39] With the temps, yes. Without, no. We'll need the temps back for that week. (unclear)
  [29:44] The temps finish at the end of January.
  [29:47] Then they need to not finish at the end of January. One more week. (unclear)
  [29:52] Hm. That's money. (unclear)
  [29:55] It's less money than closing. (unclear)
  [29:58] Everything's less money than closing. Okay.
  [30:04] Okay. So, are we closing for the move? No. Option two. We stay open, we don't ship on Friday the sixth,
  [30:11] we ship again from Brookfield on Monday the ninth, and we keep the temps on one more week to cover the double Monday.
  [30:18] Yes.
  [30:19] Agreed.
  [30:21] Yes. Option two.
  [30:24] Circling option two. Staying open. No shipping Friday the sixth, ship from Brookfield Monday the ninth, temps one more week.
  [30:31] The agency already said they could do February, I asked them before Christmas, just in case. So that's fine. (unclear)
  [30:37] Oh, great. Then it's just a week more on the invoice.
  [30:41] It's a week more on the invoice. About two and a half thousand. It goes in the move budget, not the warehouse one. (unclear)
  [30:47] Whatever makes your numbers happy.
  [30:50] Nothing makes my numbers happy. (unclear)
  [30:53] Ha.
  [30:58] What do we tell the customers about the Friday? That nothing ships?
  [31:02] That goes in the letter. The customer letter. We'll do that with customers, it's on the list, after stock.
  [31:08] Okay. After stock. (unclear)
  [31:13] And the website, does the website need to say anything? Like a banner? Delivery times?
  [31:18] Same, that's customers. After stock. Let's not jump. (unclear)
  [31:22] Okay, okay. (unclear)
  [31:27] Sorry. My brain's just making lists. Everything's a list now.
  [31:31] Everyone's brain's a list this month. (unclear)
  [31:36] Ha.
  [31:41] Can I say one thing before racking? It's the, um. It's a staff thing. A contract thing. It's about one person.
  [31:48] It's to do with the move but it's personal, it's their contract. I don't think it should be on the recording.
  [31:54] Okay. Let's pause it. Mei Lin, can you pause it?
  [31:57] Yes, pausing the recording. Hang on. It's this button. Okay, pausing now.
  [32:44] Okay. It's back on. It's recording again. The dot's red.
  [32:49] Thanks. Thanks everyone. (unclear)
  [32:52] Okay. Back to racking. Who moves it. (unclear)
  [32:58] So, the options are: Halvorsen do the whole thing, take it down here, truck it, put it up at Brookfield.
  [33:05] About eight thousand, roughly, if roughly holds. Or our own lot do it, we've got the tools, we did the
  [33:11] small bits ourselves before. Or a mix, Halvorsen do the racking and our lot do the stock.
  [33:16] Our own lot can't do the racking. Not twelve runs, not at height, not with the insurance. (unclear)
  [33:22] Why not the insurance?
  [33:24] Because putting up racking is a certified job, the inspection in April will want to see who installed it,
  [33:30] and if it's Darren with a spanner the inspector will laugh and then fail it. (unclear)
  [33:35] Ha. Darren with a spanner.
  [33:38] He's very good with a spanner. But he's not certified. (unclear)
  [33:42] So the racking has to be a contractor. Halvorsen or someone.
  [33:46] Halvorsen did ours here, they know the racking, they've got the drawings. It's the same red stuff. (unclear)
  [33:52] Are there other companies? Just so we're not, you know, just because we know them.
  [33:57] There's Pell Storage, they quoted for the mezzanine and they were twice the price and they wanted six weeks' notice.
  [34:04] Six weeks from now is the middle of February. Too late. (unclear)
  [34:08] So Halvorsen.
  [34:10] Halvorsen. But only the racking. The stock is ours, we know where everything is, we know what's heavy,
  [34:17] we know the freezer stuff can't sit out. If Halvorsen move the stock they'll just put it anywhere.
  [34:23] And they charge for the stock by the pallet. It'd be another five or six thousand. (unclear)
  [34:28] So it's the mix. Halvorsen take down and put up the racking, our team move the stock.
  [34:34] The mix. Okay. Agreed? (unclear)
  [34:37] Agreed.
  [34:37] The mix, yes. (unclear)
  [34:38] Yes.
  [34:39] Yeah, the mix. (unclear)
  [34:43] Okay. So, decided: Halvorsen move the racking, and our own team move the stock. Writing it, under racking.
  [34:50] Who's talking to Halvorsen? We need an actual quote, not roughly, and we need to book the weekend
  [34:56] before someone else books them. They do other people's moves too. (unclear)
  [35:00] Lukas, you talked to them in December. Can you get the real quote and the date?
  [35:05] Yeah. I'll get Halvorsen's quote in writing and get them booked for the weekend of the seventh. I'll ring them today.
  [35:12] Today. Brilliant. Lukas, Halvorsen, quote and booking. (unclear)
  [35:17] And tell them about the wide aisles. Option B. They need to know it's three and a half, not the drawing.
  [35:23] Yeah, I'll send them the layout. Once Dana's floor plan comes Friday, with the columns. (unclear)
  [35:29] Okay.
  [35:34] So the stock. How the stock gets there. Tomás, this is you.
  [35:38] Yes. So we've got about two thousand two hundred pallets, if the count's right. Plus the small stuff
  [35:45] on the grey shelving, which has to go in boxes because the grey shelving isn't coming.
  [35:50] Two thousand two hundred pallets in one weekend? (unclear)
  [35:54] In one weekend. That's the problem. Our two lorries do twenty-six pallets a trip, nine miles, forty minutes
  [36:01] each way with loading. That's... (unclear)
  [36:04] That's like eighty-five trips.
  [36:07] Eighty-five trips. Between two lorries, that's forty-something each. In a weekend. No.
  [36:12] So we hire lorries. (unclear)
  [36:15] We hire lorries, or we start early. We don't have to move everything on the weekend. The slow stuff, the stuff
  [36:21] that doesn't move, the hand towels, the spare racking parts, the January stock, that can go in the first week.
  [36:27] While Halvorsen's putting up the racking? Where does it go?
  [36:31] On the floor at Brookfield, in the block stack area by the dock. It's huge, the floor. And then it goes up on the weekend.
  [36:38] So the first week, slow stuff on the floor. The weekend, the fast stuff, straight into the racking. (unclear)
  [36:44] Yes. And the freezer stuff last of all, on the Sunday, straight into the freezer, which has to be on and cold by then.
  [36:51] Is the freezer at Brookfield on?
  [36:53] It's on. It's been on since the landlord fixed it. It's at minus twenty-two. I checked on the visit. (unclear)
  [36:59] Okay, good.
  [37:03] So it needs a plan. Which aisle goes when, what goes in the first week, what goes on the Saturday,
  [37:09] what goes on the Sunday, in what order so the racking's up in time. Tomás, can you do that?
  [37:14] Yes. I'll plan the order the stock moves in. Aisle by aisle, what goes when. I'll have it for next week.
  [37:20] Next week. Tomás, the stock plan, aisle by aisle. Writing it. (unclear)
  [37:25] And the lorries? Do we hire?
  [37:28] Depends on the plan. If the slow stuff goes in the first week, our two lorries might be enough for the weekend. (unclear)
  [37:34] Let's see the plan. If we need lorries, we need lorries. (unclear)
  [37:39] Okay.
  [37:43] Can I ask a stupid question? (unclear)
  [37:46] There are no stupid questions.
  [37:48] There are, but go on. (unclear)
  [37:51] Ha. What happens to the stock that's on the lorry when the lorry's driving? Like, if someone orders it?
  [37:57] It's not available. The system shows it in a location called "in transit". You can't pick it.
  [38:03] Oh. Okay. That's fine then. That's what I was asking. (unclear)
  [38:07] That's what in transit is for. It's a real location. It's the lorry. (unclear)
  [38:12] Ha. The lorry's a location.
  [38:15] The lorry's a location. Everything's a location. (unclear)
  [38:21] And the scanners? Do they work in Brookfield, the old ones? On the new wi-fi?
  [38:26] They work on any wi-fi. The new ones come in March anyway, the Coastal ones. (unclear)
  [38:31] March? I thought December.
  [38:34] It was December. Then January. Now it's March. (unclear)
  [38:38] Ha. Of course it is.
  [38:41] It's fine. The old ones will do the move. They've done worse. (unclear)
  [38:47] They've done a lot worse. (unclear)
  [38:52] How many people do we need on the weekend? For the stock?
  [38:56] All of them. Everyone on the floor, both shifts, plus the temps. Saturday and Sunday.
  [39:02] Everyone's going to love that.
  [39:04] They get paid. Double time on the Sunday. (unclear)
  [39:08] That's in my numbers, the double time. It's the biggest line after Halvorsen. (unclear)
  [39:13] And food. We have to feed them. If you make people work a Sunday you feed them.
  [39:18] Pizza. It's always pizza. (unclear)
  [39:21] Bacon rolls in the morning, pizza in the afternoon. That's the law. (unclear)
  [39:25] Ha. That's in my numbers too, actually. Two hundred pounds of pizza. (unclear)
  [39:30] Only two hundred? For forty people for two days?
  [39:34] It's a placeholder. (unclear)
  [39:36] Ha.
  [39:41] Okay. Stock's done. Next on my list is customers. (unclear)
  [39:45] Customers. The letter. And the website. Now we can jump.
  [39:49] Now you can jump. (unclear)
  [39:52] Ha. Okay.
  [39:56] So customers. They need to know three things: we're moving, nothing ships on Friday the sixth, and the new address for collections, because some of them collect.
  [40:03] The trade counter ones. The plumbers and the cleaning companies who come in the van and pick up at the counter. There's about forty of them who come every week. (unclear)
  [40:10] And they'll drive to the old place on the ninth and find it empty and ring us angry.
  [40:14] They'll drive to the old place and find the man with the dog taking down the shelving. (unclear)
  [40:19] Ha. And they'll buy the shelving.
  [40:22] So a letter. An email, really, to every customer, and a printed one for the counter, and it goes on the invoices for January.
  [40:29] Who writes it? Normally Ana Sofía writes anything that goes to customers, she's got the voice, she's good at it, and she knows which ones need a phone call as well.
  [40:37] Ana Sofía's in Valencia. (unclear)
  [40:39] She's back Monday. It doesn't need to go till the middle of January. It's hers. She'd be annoyed if we wrote it without her.
  [40:46] She would. She'd rewrite it anyway. Last time I wrote a customer email she sent it back with red all over it.
  [40:52] Ha. Okay. Ana Sofía drafts the letter to customers about the move. When she's back. I'm writing it with her name on it so she sees it.
  [41:00] She's going to come back from Valencia and see her name on the whiteboard. (unclear)
  [41:05] That's the price of Valencia.
  [41:08] Ha. That's the price of Valencia.
  [41:13] What goes in it? So she's got something to start from. Moving on the seventh and eighth, nothing ships Friday the sixth, normal from Monday the ninth,
  [41:21] the new address, the counter at Brookfield opens Monday the ninth, and the phone numbers don't change. That's the main thing, the numbers don't change.
  [41:28] And a map. For the counter people. The park's confusing, the units aren't in order, seven's next to twelve. (unclear)
  [41:35] Seven's next to twelve? (unclear)
  [41:37] Seven's next to twelve. And three's round the back by itself. It's like someone dropped the numbers. (unclear)
  [41:43] Ha.
  [41:43] Seven next to twelve. Ridiculous. (unclear)
  [41:46] And parking. The counter people need to know where to park so they don't get clamped like Rafael.
  [41:51] There's visitor bays by the hut. Four of them. For the counter, they can use those. I'll find out when I do the permits. (unclear)
  [41:58] Okay, good, so that's part of the permits.
  [42:02] Do we do anything special for the big accounts? The top twenty? A phone call? (unclear)
  [42:07] The big accounts get a call from their account manager. That's normal, they'll want to hear it from a person. That's Dana's lot, the account managers.
  [42:15] Dana will want to know that. Shall I message her? (unclear)
  [42:18] She'll see it in the notes. She's got enough with the kid. Don't message her about everything. (unclear)
  [42:23] Ha. Okay.
  [42:28] And the website. The address is on the website, in the footer, and the contact page, and the collections page, and every invoice has the old address on it.
  [42:35] And the order emails. The confirmation email has the collection address. (unclear)
  [42:39] And the Google thing, the map listing. If you search for us it'll send people to the old place for years.
  [42:45] Ugh. The map thing. That never updates. (unclear)
  [42:48] Somebody needs to change the address on the website and the invoices. And the emails. Before the ninth, not after.
  [42:54] Yeah. That's important. (unclear)
  [42:57] Mm.
  [43:00] Yeah, definitely. (unclear)
  [43:05] Okay. Um. Customers, is that it? Letter, the counter, the big accounts, the website. (unclear)
  [43:11] What about the samples room? Customers come and look at samples, in the little room by reception. Where does that go?
  [43:18] Brookfield has a room by reception too. The landlord called it a meeting room. It's got a sink. I don't know why a meeting room has a sink.
  [43:25] For the samples. It's a samples room with a sink. Perfect. (unclear)
  [43:29] Ha. Okay. The samples room becomes the room with a sink.
  [43:33] Who moves the samples? It's like twelve boxes.
  [43:36] It's twelve boxes, they go on the lorry with everything else. They're stock. They're a location. Everything's a location. (unclear)
  [43:42] Ha. Okay.
  [43:47] Can we talk about deliveries? Like, inbound, the suppliers delivering to us. Because the first week is a mess for that.
  [43:53] Yes. That's next anyway. Let me just, let me get a fresh bit of board. I'm running out of board. (unclear)
  [43:58] Rub out the IT bit, IT's done. (unclear)
  [44:01] I'm not rubbing anything out till someone takes a photo. Lukas, take a photo of the board. Of that half. (unclear)
  [44:07] Taking it. Done. It's a bit shiny but you can read it.
  [44:12] Okay, rubbing out IT. Sorry IT. Okay.
  [44:17] Deliveries. So, the problem. In the first week of February we're in two buildings. The stock is mostly still here, but some of it's going over,
  [44:25] the slow stuff, and Halvorsen are taking racking down here and putting it up there. And suppliers are still sending us lorries, to here, every day.
  [44:33] How many deliveries do we get in a normal week? Inbound?
  [44:36] Thirty, thirty-five lorries. Gloves, the packaging, the cleaning chemicals, the paper. About half of it's pallets, half's loose. (unclear)
  [44:43] And they'll arrive here while we're taking the racking down. Where do they go? There's nowhere to put them.
  [44:49] And if they go to Brookfield, there's nowhere to put them there either, because the racking's not up and the floor's full of our slow stuff.
  [44:56] So nothing should come in that week. Not here, not there. (unclear)
  [45:00] We can't have nothing come in for a week. We'll run out of things. The gloves, for one.
  [45:05] We won't run out in a week if we order heavier in January. We stock up before, and then we stop.
  [45:11] Like a freeze. A delivery freeze.
  [45:14] Like a freeze. The supermarkets do it, before a stocktake, they stop all deliveries for a few days. (unclear)
  [45:19] From when though? The whole first week? The Monday?
  [45:22] The Monday's too early, the Monday's the second, we're only just getting the keys. And the Friday's the sixth, that's the day before we move.
  [45:30] Wednesday? From the Wednesday? The fourth. That gives us Monday and Tuesday for the last deliveries, and then nothing till we're in.
  [45:37] Till the ninth. Till we're open at Brookfield.
  [45:40] And the stuff that has to come? The chemicals, the time-sensitive stuff? (unclear)
  [45:44] There's nothing that has to come. Everything we sell keeps. Even the chemicals keep, they've got a two-year date on them.
  [45:50] And the gloves? With the Penang container late? If that lands in the freeze?
  [45:55] Then it sits at the port for a few days. It costs a bit in storage but it's fine. The port can hold it.
  [46:00] How much? (unclear)
  [46:02] Fifty a day, something like that, for a container. Less than a lorry driver standing in our yard for six hours with nowhere to unload. (unclear)
  [46:09] Okay.
  [46:13] Rafael, are you okay with fifty a day at the port?
  [46:16] I'm okay with fifty a day if it's three days. I'm not okay with fifty a day if it's three weeks. (unclear)
  [46:22] It won't be three weeks. Jonah said the container's the end of January now, if it's on time. It'll land before.
  [46:28] If it's on time. Nothing's on time. (unclear)
  [46:31] Ha. Nothing's on time.
  [46:36] Okay. So let me say it and someone tell me if it's wrong.
  [46:40] From Wednesday the fourth, no inbound deliveries, at all, until we're in at Brookfield on the ninth.
  [46:46] Last deliveries Monday and Tuesday, the second and third. Then nothing comes in till the ninth, and from the ninth everything goes to Brookfield.
  [46:54] That's right. That's what I'd do. (unclear)
  [46:57] Agreed.
  [46:57] Yeah, the fourth. (unclear)
  [46:58] Yes. The fourth.
  [47:01] Okay. Decided. Delivery freeze from the fourth to the ninth. Writing it big because everyone will ask about it.
  [47:07] Everyone will ask about it. The suppliers will ask about it every day. (unclear)
  [47:12] Which brings me to the suppliers. Somebody has to tell them. All of them. There's about sixty suppliers who deliver.
  [47:18] And they have to be told twice. Once now, and once the week before, because they forget, the drivers never get told anything.
  [47:25] Tomás, you're the one they ring when they're coming. You've got the booking sheet. (unclear)
  [47:30] Yes. Fine. I'll tell the suppliers about the freeze. All of them, an email now and a reminder in the last week of January. With the new address.
  [47:38] With the new address and the date the new address starts. The ninth. Not before. (unclear)
  [47:43] The ninth, not before. Or they'll turn up at Brookfield on the third and Halvorsen will be up a ladder. (unclear)
  [47:49] Ha. Okay. Tomás, the suppliers, the freeze. Writing it.
  [47:53] I've got the list, the supplier list, it's in the booking system, I can email them all from there. It's one email. (unclear)
  [47:59] One email and a reminder. Okay.
  [48:03] Oh, Dana again. Sorry. She's messaging a lot for someone at home with a sick kid. Hang on, I'll read it.
  [48:09] She says, "Did anyone think about the insurance? The policy's on the old address. I'll move the insurance over to Brookfield, I'm on hold with them now anyway about the van."
  [48:18] Oh. No, nobody thought about the insurance. Good, Dana.
  [48:21] So that's Dana, the insurance, moving it to Brookfield. She's on hold already. Writing it. Dana, insurance.
  [48:27] She thinks of everything. From her sofa. With a sick child. (unclear)
  [48:31] Tell her to give the kid some of the tar. That'll fix him. (unclear)
  [48:35] I'm not telling her that. (unclear)
  [48:38] Ha.
  [48:42] Does the insurance need to know about the move weekend specifically? Like, stock in lorries, stock on the floor, people up ladders?
  [48:49] It'll be in what she tells them. She knows. She did the insurance when we moved in here, she was here then, she's the only one who was.
  [48:56] She was? Dana was here in twenty fourteen?
  [48:59] She was the receptionist. She did everything. (unclear)
  [49:03] Ha. Okay.
  [49:08] Okay. People. This is the one I'm worried about. Getting people to Brookfield.
  [49:13] It's nine miles. It's not far. (unclear)
  [49:16] It's nine miles if you've got a car. Half the floor team don't drive. They get the bus here, the forty-two, it stops right outside.
  [49:24] And nothing goes to Brookfield? No bus?
  [49:27] There's a bus to the park, from the station, the twelve, but it's once an hour and it doesn't run before seven, and the early shift starts at six.
  [49:35] So the early shift can't get there. At all. Not by bus.
  [49:39] Not by bus. They'd have to get a taxi, or two buses and walk from the main road, which is a mile, on a road with no pavement. (unclear)
  [49:47] We can't ask people to walk a mile on a road with no pavement at six in the morning in February. (unclear)
  [49:52] No. Absolutely not.
  [49:55] How many people are we talking? Who don't drive?
  [49:58] I counted. Fourteen on the early shift, nine on the late. Twenty-three people. Some of them have been here ten years. (unclear)
  [50:05] Twenty-three. That's a lot of people to lose because of a bus.
  [50:09] We'd lose them. Some of them already asked me. Darren asked me. Darren doesn't drive. (unclear)
  [50:14] Darren with the spanner?
  [50:16] Darren with the spanner. He's worried. He said if he can't get there he'll go to the parcel place on the estate, they've been asking him for years. (unclear)
  [50:24] We are not losing Darren to the parcel place.
  [50:24] No way. Not Darren. (unclear)
  [50:27] Ha. We're not losing Darren. (unclear)
  [50:31] So what are the options? A minibus? Lifts? Paying taxis?
  [50:35] Taxis is crazy money. Twenty-three people, twice a day, nine miles, every day, it's like, it's thousands a month. (unclear)
  [50:42] Lifts, people already share lifts, but you can't make it a system, someone's always ill or late and then four people can't get in.
  [50:49] A minibus. A sixteen-seater, from here, from the old site, because that's where the bus drops them anyway, to Brookfield.
  [50:57] Two runs in the morning, one for the early shift, one for the late, and two back.
  [51:01] Who drives it? (unclear)
  [51:03] You hire it with a driver. There's companies that do it, they do it for the schools and the care homes. It's a man with a minibus.
  [51:10] How much? (unclear)
  [51:12] I asked one, just to see. About nine hundred a week for four runs a day. (unclear)
  [51:17] Nine hundred a week. For how long? Forever?
  [51:20] Not forever. For the first month. And in the month, the council might move the bus, people sort out lifts, some of them will get bikes,
  [51:28] it gives everyone a month to sort themselves out instead of a weekend. And then we look at it again.
  [51:33] A month is about three and a half thousand. (unclear)
  [51:37] Rafael?
  [51:39] It's not in the numbers. But it's cheaper than replacing twenty-three people. Replacing one person costs more than that, with the training.
  [51:47] So yes?
  [51:49] Yes. For a month. Then we look again. It comes out of the contingency. (unclear)
  [51:53] Okay. So, decided: a staff minibus from the old site to Brookfield, for the first month. Then we look at it again. Writing it.
  [52:00] People will be so relieved. Darren will be so relieved. (unclear)
  [52:04] Darren will cry. (unclear)
  [52:07] Ha. He will. He cried at the Christmas party.
  [52:12] So who books it? The minibus. It's a transport thing. Lukas, you do the vans.
  [52:16] Yeah. I'll book the minibus. For the first month, from the ninth, four runs a day. I'll ring the one you rang, if you send me the number.
  [52:24] I'll send it now. It's Ashby Travel. They're on the high street, by the chip shop.
  [52:29] By the chip shop. Okay. Lukas, minibus. Writing it.
  [52:33] And the times? The runs?
  [52:36] The early shift starts at six, so the minibus leaves here at twenty past five. The late starts at two, so it leaves at quarter past one. (unclear)
  [52:43] Twenty past five. Poor driver. (unclear)
  [52:46] Poor everyone. (unclear)
  [52:49] Ha.
  [52:53] And what happens to the people who drive? Do they get anything? Because they're driving further, it's nine more miles each way. (unclear)
  [53:00] That's a good question. Petrol money?
  [53:03] That's an HR question. That's a contract question. That's actually what we paused for, partly. (unclear)
  [53:08] Oh. Okay. Then let's not.
  [53:11] Let's not. It's being looked at. Separately. (unclear)
  [53:15] Okay.
  [53:20] Anything else on people? Lockers. Do they have lockers at Brookfield?
  [53:24] There's lockers. Fifty. We've got sixty people on the floor. But they're never all in at once. Two shifts. (unclear)
  [53:31] Fifty's fine for two shifts.
  [53:33] Fifty's fine. And there's a canteen, a proper one, with a microwave that nobody's put a tin in yet. (unclear)
  [53:39] Give it a week. (unclear)
  [53:41] Ha. Give it a week.
  [53:45] And showers. There's showers. Two of them. For the cyclists. (unclear)
  [53:49] We have cyclists?
  [53:51] We'll have cyclists. If there's no bus, we'll have cyclists. Three people have already asked me if there's bike racks. (unclear)
  [53:57] Are there bike racks?
  [53:59] There's a rack for six bikes by the door. It's a bit rusty. It works.
  [54:03] Okay. Rusty but works. Like the shelving. (unclear)
  [54:07] Ha. Don't.
  [54:11] Can we do a visit for the floor team before the move? So they've seen it, so it's not a shock on the Monday. (unclear)
  [54:17] We could. In January. Take them over in the lorries. Ha. No, in the minibus, if it's booked by then.
  [54:23] The minibus isn't till the ninth. (unclear)
  [54:26] Then in cars. Or just, people can go and look themselves, it's a car park, it's not secret. (unclear)
  [54:32] Maybe. Let's see. If there's time. There won't be time. (unclear)
  [54:36] Ha. There won't be time.
  [54:41] Okay. That's people. I think. Lockers, showers, the minibus. And the petrol thing is separate.
  [54:47] Okay.
  [54:52] What about the fire marshals? We have to have trained fire marshals at Brookfield from the first day.
  [54:57] The same people. Training's training, it doesn't care about the building. They just need to walk round once and see the exits.
  [55:04] And the assembly point. Where's the assembly point at Brookfield?
  [55:07] In the car park, by the hut. There's a green sign. I saw it on the visit, I was standing on it when Rafael found his clamp. (unclear)
  [55:14] Ha. Of course you were.
  [55:17] Of course I was. It was the best view of the clamp. (unclear)
  [55:22] Okay. So the marshals walk round in the first week. That's not a job, that's just, they'll do it.
  [55:28] They'll do it on the Monday when they're there anyway. (unclear)
  [55:32] Okay.
  [55:37] Next is the old unit. Getting out of here. And the post, before I forget. The post. (unclear)
  [55:42] The post?
  [55:44] The post. Letters. Royal Mail. They'll keep delivering here. Invoices, cheques, the bank. Some suppliers still post invoices, on paper, the old ones. (unclear)
  [55:52] Can't we just tell everyone the new address?
  [55:55] We'll tell everyone, and they'll still post things here for a year. The tax office still writes to the address before this one. (unclear)
  [56:01] The address before this one? From before twenty fourteen?
  [56:04] From before twenty fourteen. It goes to a nail bar now. The nail bar brings it round. (unclear)
  [56:09] Ha! The nail bar.
  [56:12] The nail bar's very nice about it. They brought us a Christmas card once. (unclear)
  [56:16] So there's a thing you do with Royal Mail, a redirect, you pay and they send everything on for a year. It's a form, online.
  [56:24] Somebody needs to sort out forwarding the post. The redirect. From the end of February, when we hand the keys back.
  [56:30] Yeah. Good. (unclear)
  [56:32] Mm.
  [56:34] Yeah, the post. (unclear)
  [56:39] Okay. Um. (unclear)
  [56:44] The old unit. Getting out. Rafael, can you do the contracts? What we've got here that has to stop.
  [56:50] Yes. So I made a list of everything with this address on it. Electricity, gas, water, the cleaning contract, the waste,
  [56:58] the alarm, the CCTV monitoring, the plant service for the sprinklers, the vending machine, the window cleaner. (unclear)
  [57:04] We have a window cleaner?
  [57:06] Once a quarter. He does the office windows. You've never noticed because they're still dirty. (unclear)
  [57:11] Ha.
  [57:14] Electricity, gas and water, the landlord takes those back on the last day, they read the meters, that's in the lease, that's not us.
  [57:22] The cleaning contract moves with us, same company, they do Brookfield already, they do the whole park. That's done, I rang them.
  [57:29] The waste, same thing, they're coming to Brookfield, they just move the bins. That's done too. (unclear)
  [57:34] Great. And the alarm?
  [57:36] The alarm's the question. It's a five-year contract and it's got two years left. The alarm company says we can move it to Brookfield,
  [57:44] but Brookfield's already got an alarm, the landlord's, it's in the lease, it's part of the service charge. So we'd have two alarms.
  [57:52] We don't need two alarms. (unclear)
  [57:54] So do we keep the old unit's alarm contract till the end of the lease? Or cancel it? There's a fee for cancelling early.
  [58:01] How much is the fee?
  [58:03] Three months. About six hundred. And if we keep it, it's two years of paying for an alarm on an empty building we don't have. (unclear)
  [58:11] That's an easy one. No, we don't keep it. Cancel the old unit's alarm from the handover. Pay the six hundred.
  [58:17] Yes. Cancel it. (unclear)
  [58:19] Agreed, cancel from the handover. Not before, we still need it in February with stuff in here.
  [58:25] Not before. From the handover. Writing it. Alarm, cancel from handover.
  [58:30] Rafael, that's yours, it's your list.
  [58:32] Yes. I'll cancel the old alarm contract from the handover date. And the CCTV with it, it's the same company.
  [58:39] Rafael, alarm. Writing it.
  [58:42] And the vending machine? (unclear)
  [58:44] The vending machine comes with us. It's ours. We bought it. It's the only thing in this building that always works. (unclear)
  [58:50] Ha. Except the crisps. The crisps get stuck.
  [58:53] The crisps get stuck. It's a feature. (unclear)
  [58:58] And the window cleaner?
  [59:00] He's on the landlord's contract, not ours. He's not our problem. (unclear)
  [59:05] Ha. Okay. (unclear)
  [59:10] Okay. Can we take five minutes? I need the loo and more tar, and my hand hurts from writing.
  [59:16] Five minutes. Leave the recording on? (unclear)
  [59:19] Leave it on. It's easier than remembering to turn it back on. (unclear)
  [59:24] Okay. Five minutes. Back at ten past.
  [59:51] Дякую за перегляд!
  [60:37] Продолжение следует...
  [61:22] Is that your phone? It's buzzing.
  [61:26] It's my mum. She wants to know if I'm coming on Sunday. She always texts in capitals, it looks like she's shouting. (unclear)
  [61:33] Ha. Is she shouting?
  [61:36] She's not shouting. She just doesn't know where the button is. Ten years she's had that phone. (unclear)
  [61:41] Ha.
  [62:08] Sous-titres réalisés par la communauté d'Amara.org
  [62:47] Okay. Okay, everyone back? Kofi's back. Lukas is back. Where's Tomás? (unclear)
  [62:52] He's on the phone outside. With a supplier. He's waving. He's coming.
  [62:57] Okay. I'll start, he can catch up. Where were we. Contracts. Alarm, done. The post. And the old unit. (unclear)
  [63:04] Can I say something about the move weekend first, while I think of it? The rota.
  [63:09] The rota. Who's working the weekend. Saturday and Sunday. We said everyone, but everyone can't do both days.
  [63:16] And some people have kids, and some have the football, and Darren has a wedding on the Saturday. (unclear)
  [63:21] Darren has a wedding?
  [63:23] Not his. His cousin's. He's an usher. He's very proud. (unclear)
  [63:27] Ha. Okay. So we need a rota. Who's on which day, which shift, which aisles.
  [63:33] Sorry, sorry, the supplier, he wanted to know about February. I told him about the freeze. Did I miss anything? (unclear)
  [63:39] Tomás! We're on the move weekend rota. We were just saying we need one.
  [63:44] I'll do it. It's my team. But I can't do it till Halvorsen confirms the date, the racking, because if they come on the Friday
  [63:51] instead of the Saturday then it's a different rota, the whole thing shifts by a day.
  [63:56] So, once Halvorsen confirm the date, Tomás does the rota for the move weekend. Lukas is getting the date from them today.
  [64:03] Yes. Once Halvorsen confirms, I'll draw up the move weekend rota. Saturday, Sunday, who's where. (unclear)
  [64:09] Tomás, rota, once Halvorsen confirms. Writing it.
  [64:13] Darren's off the Saturday. For the wedding. Put that in. (unclear)
  [64:16] Darren's off the Saturday. He's an usher. (unclear)
  [64:20] Ha. Okay.
  [64:25] Okay, the old unit. The handback. Rafael, the lease here ends when exactly?
  [64:30] The twenty-eighth of February. Midnight. We have to give the keys back on the twenty-eighth, and the building has to be,
  [64:37] the lease says, "in a clean and tidy condition, with all tenant fixtures removed". Which means everything we bolted to anything.
  [64:44] Everything we bolted. The racking's going. The grey shelving's going to the dog man. What else is bolted? (unclear)
  [64:50] The barrier in the yard. The safety barriers round the dock. The signs. The coat hooks in the canteen. The mezzanine.
  [64:57] The mezzanine? We have to take the mezzanine down?
  [65:00] It's not in the lease, I checked. The mezzanine's the landlord's, they built it, we just paid for the stairs. The stairs we leave. (unclear)
  [65:07] Okay. Good. The mezzanine stays.
  [65:10] And the floor. The floor has to be clean. Actually clean. The landlord's surveyor walks round and if it's not clean they keep the deposit.
  [65:18] How much is the deposit?
  [65:20] Twenty thousand. (unclear)
  [65:22] Twenty thousand? For a clean floor?
  [65:25] For a clean floor and no holes and no oil and no tape on the walls. Twenty thousand. So we get it properly cleaned.
  [65:32] A deep clean. Professional. Not Darren with a mop. (unclear)
  [65:36] A proper firm, with the machines, the floor scrubbers, they do the whole floor and the walls and the dock, they take the tape marks off, they do the oil under where the forklifts park.
  [65:43] The oil's going to be the hard bit. There's ten years of oil where the chargers are. It's black. It's basically part of the floor now.
  [65:49] They've got a chemical for that. The firm we used for the mezzanine works, they cleaned the floor after, it came up like new. Well, like five years old.
  [65:56] How long does a deep clean take? For this whole building?
  [65:59] Two days, three days. With the building empty. It has to be empty, they can't clean round racking.
  [66:04] So the racking's out on the weekend of the seventh, the grey shelving goes with the dog man, and then the building's empty from, what, the tenth?
  [66:11] The tenth or so. If the dog man comes when he says. Which he won't. (unclear)
  [66:15] Ha. Say the middle of February, then. Empty by the middle of the month, clean in the third week, keys back on the twenty-eighth.
  [66:22] So the old unit goes back on the twenty-eighth, after a deep clean. That's the plan? We're not handing it back early?
  [66:28] We can't hand it back early, the lease runs to the twenty-eighth, we pay to the twenty-eighth either way, and early would just mean rushing the clean.
  [66:35] Then the twenty-eighth. Handed back on the twenty-eighth of February, after a professional deep clean. Writing it under the old unit.
  [66:42] Agreed.
  [66:43] Yes. The twenty-eighth. (unclear)
  [66:46] And the landlord has to agree the date. The handback. The surveyor has to come on the day and walk round with someone from us. With the checklist.
  [66:53] They haven't confirmed it yet? The twenty-eighth's a Saturday, by the way. I just looked. (unclear)
  [66:58] Oh. It's a Saturday? Then they might want the Friday. The twenty-seventh. Surveyors don't do Saturdays.
  [67:03] So we don't know the date yet. Twenty-seventh or twenty-eighth. Until the landlord says.
  [67:08] And the clean has to be booked for the week before, whatever the date is, so it's fresh, so nobody walks oil back in.
  [67:14] Who books the clean? I can do it, actually. I talk to the landlord anyway, about the lease, I've got the agent's number, the nice one, Priscilla, at the agents.
  [67:22] Mei Lin, you're doing it?
  [67:24] Yes. Once the landlord confirms the handback date, I'll book the deep clean for the week before. I'll ask them for the date this week.
  [67:31] Mei Lin, deep clean, once the landlord confirms. I'm writing my own name. That's always a bad sign. (unclear)
  [67:37] Ha. Self-assigned.
  [67:39] Self-assigned. I'll regret it. (unclear)
  [67:43] And the surveyor takes photos of everything on the day, every wall, every corner, so if they say there's a mark that wasn't there when we moved in, we need to be able to show it was.
  [67:52] And the photos from when we moved in. There should be photos from twenty fourteen. The schedule of condition. It's an appendix in the lease.
  [67:59] Dana will have it. Dana has everything from twenty fourteen. (unclear)
  [68:03] Dana's going to need a holiday after this.
  [68:06] Dana's going to need Valencia. (unclear)
  [68:09] Ha.
  [68:13] What about the stuff nobody owns? There's things in this building that nobody knows whose they are. There's a sofa in the loft. There's a canoe.
  [68:20] A canoe?
  [68:22] A canoe. Upstairs. Above the office. It's been there since I started. Nobody knows. (unclear)
  [68:27] That was Kofi's, wasn't it? Kofi, is the canoe yours?
  [68:31] He's shaking his head. It's not his. He's laughing. It's not his.
  [68:35] Then whose canoe is it?
  [68:37] The canoe stays. It's the landlord's canoe now. It's a fixture. (unclear)
  [68:41] Ha! It's not a fixture, it's a canoe. We'll put it on the clearance list with the shelving. The dog man might want a canoe.
  [68:48] The dog man will take anything. He took the broken chairs. (unclear)
  [68:52] Ha. The canoe goes to the dog man.
  [68:56] And the canteen fridge? That's ours, isn't it? The big one with the glass door? It's older than the canoe.
  [69:02] The fridge is ours. We bought it when the old one died. The old one died because someone put a whole cake in it on its side and the door didn't close for a weekend.
  [69:10] The cake weekend. I remember the cake weekend. It smelled for a month.
  [69:15] It smelled for a month and then the fridge died and we got the glass one. The glass one's fine. It's just ugly. And it hums. (unclear)
  [69:22] Is there a fridge at Brookfield? In the canteen there?
  [69:25] There's a fridge. A new one. Built in. The landlord's. So we don't need ours. Unless we want two fridges.
  [69:31] Nobody needs two fridges. Except the night shift. The night shift would fill three fridges. (unclear)
  [69:37] Ha. Then the glass fridge goes in the night shift room at Brookfield and everyone's happy.
  [69:42] Does it fit through the door? It barely got in here. They had to take the door off.
  [69:47] We'll measure. Speaking of plugging things in, oh, that reminds me, the forklift chargers. Brookfield's sockets.
  [69:53] Our chargers need three-phase, the big sockets, the red ones, and I don't know if Brookfield's got them on the floor or just the normal ones.
  [70:00] Marlow had forklifts. They must have had chargers.
  [70:03] They had gas forklifts. The old ones. Gas doesn't need charging. (unclear)
  [70:07] Oh. Hm. Then maybe there's none.
  [70:10] I'll check Brookfield's sockets are three-phase, for the chargers. Next time I'm there. If not, we need an electrician before the seventh, and that's money.
  [70:18] Thanks Lukas. Writing it. Lukas, sockets, three-phase. Under the building bit. (unclear)
  [70:24] If there's none, the electrician needs to come in the first week. With Halvorsen there and Kofi on his pole. It'll be busy.
  [70:30] It'll be a party. (unclear)
  [70:33] Ha. A party with an electrician.
  [70:38] Can we just leave the reach truck behind? As a present? For the landlord? We could put a bow on it.
  [70:44] Ha! A present.
  [70:46] It's the one that leaks. It's basically part of the floor too. Leave it with the oil, they'll match. (unclear)
  [70:51] I'll write a card. "Dear landlord, please enjoy your reach truck. It leaks. Love, everyone."
  [70:57] Ha! "It leaks."
  [70:59] "Please enjoy the canoe as well."
  [71:02] Ha. The reach truck and the canoe.
  [71:05] The reach truck is coming with us. It's the only one that turns in three and a half metres. That's the whole reason we picked option B. (unclear)
  [71:12] I know, I know. It was a joke. It was a good joke. (unclear)
  [71:15] It was a good joke.
  [71:19] Okay. Okay. Um. Money. Rafael. It's time. Everyone hold on to something.
  [71:24] Okay. So I've put everything we've said today into the sheet as we went. Let me read it out and then we can see.
  [71:30] Halvorsen, the racking, roughly eight thousand. Call it eight and a half, because roughly always becomes more.
  [71:36] Lorry hire for the move weekend, if we need it, three thousand. That depends on Tomás's plan. If the slow stuff goes in the first week maybe nothing.
  [71:44] Double time on the Sunday and overtime on the Saturday for the whole floor team, nine thousand two hundred. That's the biggest bit after Halvorsen.
  [71:52] The temps for an extra week, two and a half. The minibus for a month, three and a half. (unclear)
  [71:58] The deep clean, four thousand, that's the quote from the mezzanine people, from last year, so maybe more now.
  [72:04] Labels, six hundred. IT, the internet install and the access points and the porting, about two thousand all in. Jonah gave me that last week.
  [72:12] The alarm cancellation, six hundred. The redirect for the post, a couple of hundred. Permits, I don't know yet, I'll know when I've been to the hut.
  [72:20] Pizza and bacon rolls, four hundred. I doubled it.
  [72:23] Ha. Thank you. (unclear)
  [72:26] New pallet racking with decking for the small stuff, because the grey shelving's not coming, six thousand. That's the replacement for the grey.
  [72:34] And the mezzanine at Brookfield. The office mezzanine, upstairs, for the extra storage and the samples. Fourteen thousand. That's Pell's quote. Halvorsen haven't quoted.
  [72:44] And a contingency. Ten percent. Because something will go wrong. Something always goes wrong. Six thousand.
  [72:50] So in total that's, give me a second, seventy-three thousand eight hundred. Call it seventy-four. (unclear)
  [72:56] And the budget is?
  [72:58] Sixty. The board gave us sixty. In October. Sixty for the whole move, everything. (unclear)
  [73:03] So we're fourteen over.
  [73:05] Fourteen over. Which is, funnily enough, exactly the mezzanine. (unclear)
  [73:09] Ha. Funnily enough.
  [73:12] Can we ask the board for more? They knew the numbers were rough when they said sixty.
  [73:16] We can ask. They'll say no. They said no to the forklift. They said no to the new chairs in the canteen. They said no to the coffee machine. (unclear)
  [73:24] They said no to the coffee machine. That's why we drink tar.
  [73:27] That's why we drink tar. (unclear)
  [73:31] Do we need the mezzanine? Right now, in February? What's it for, actually?
  [73:36] It's for the samples and the overflow, the packaging, the boxes, the stuff that sits on the floor in the office corridor here.
  [73:42] At Brookfield there's more floor. With the wide aisles and no grey shelving there's fifteen percent more space anyway. The boxes can go on the floor for a bit.
  [73:51] And the samples have the room with the sink.
  [73:54] The samples have the room with the sink. (unclear)
  [73:57] So the mezzanine's nice to have. Not need to have.
  [74:00] Not in February. In the spring, when we know how the space works, maybe. When we've been in for a couple of months and we know where the pinch is.
  [74:08] And the board's new budget year starts in April. Q2. We ask for it in Q2, in the new budget, as its own thing, and they'll say yes because we'll have numbers.
  [74:17] With numbers they'll say yes. Without numbers they say no. They always say no without numbers.
  [74:22] So. Cap the move at sixty. The mezzanine waits for Q2 and goes in as its own request. Everything else stays. Is that right?
  [74:29] That's right. That gets us to fifty-nine eight. Under sixty. Just. With the contingency in. (unclear)
  [74:35] Just. Okay. Agreed? Sixty, cap, mezzanine in Q2.
  [74:39] Agreed.
  [74:40] Yes. Q2.
  [74:41] Agreed.
  [74:44] Okay. Decided. The move budget is capped at sixty thousand, and the Brookfield mezzanine waits for Q2. Writing it under money. In big letters.
  [74:52] Rafael, can you send round the new budget? The sixty version, without the mezzanine, so everyone's working off the same numbers?
  [74:59] Yes. I'll send the revised budget round, at sixty, without the mezzanine. Today or tomorrow. With every line, so nobody's surprised.
  [75:06] Rafael, revised budget. Writing it. (unclear)
  [75:09] And if the lorries aren't needed, that's three thousand back, and that goes in the contingency.
  [75:14] And if the deep clean is more than four, it comes out of the contingency.
  [75:18] Everything comes out of the contingency. The contingency is very popular. (unclear)
  [75:23] Ha.
  [75:27] Can I raise something nice? After all that money. Something fun. (unclear)
  [75:31] Please. Something fun. Go.
  [75:33] An open day. At Brookfield. For customers. In the spring, once we're in and it looks good, we invite the big customers and the counter people, we do a tour,
  [75:42] we show them the new racking and the samples room with the sink, coffee, not the tar, proper coffee, and maybe some of them order more because they've seen it.
  [75:50] That's actually nice. The counter people would come. They love a free sandwich.
  [75:55] Everyone loves a free sandwich. (unclear)
  [75:58] It's a nice idea. Maybe. Let's get in first. Let's see what the place looks like after a month with us in it. It might look like here.
  [76:06] It might look like here by March. (unclear)
  [76:09] Ha. It will look like here by March.
  [76:12] So, maybe. Not now. After we're in. We'll see. I'm not writing it on the board, it's not a thing yet, it's a maybe.
  [76:19] It's a nice maybe.
  [76:21] It's a nice maybe. Okay. (unclear)
  [76:26] Can we go back to the grey shelving for a second? Because I've been thinking about it. What if the dog man doesn't want it?
  [76:33] He'll want it. He wanted it last year. He asked twice.
  [76:36] Last year he asked. Last year was last year. He might have retired. He might have a new dog. He might have enough shelving now. (unclear)
  [76:43] Then what? We can't leave it, the lease says everything out. Five aisles of grey shelving. It's a lot of metal.
  [76:49] Scrap? The scrap man pays by the tonne. It's not much but it's something, and he takes it away.
  [76:55] Or charity. There's the furniture charity on the estate, they take shelving for the food bank. They took our old desks.
  [77:01] Or we pay someone to take it. Which is the worst one, because then we're paying to get rid of something we've paid for twice.
  [77:08] Twice?
  [77:10] Once to buy it in the nineties and once to get rid of it now. (unclear)
  [77:14] Ha. Okay.
  [77:17] So what do we do if he doesn't want it? Scrap, charity, or pay?
  [77:21] I don't know. I honestly don't know. Let's see if he wants it first. If he doesn't, we'll have to think about it.
  [77:28] Okay. Let's see. (unclear)
  [77:31] Okay.
  [77:36] Is there anything else? Before I go through the board? I want to go through the whole board, top to bottom, with the names, so we all agree.
  [77:43] The fire marshals walking round, we said that. The lockers. The showers. The bike rack. All fine.
  [77:49] The postcode's on the board. B R seven, four L N.
  [77:52] The postcode's on the board. In the corner. Where everyone can see it. Where everyone will ignore it and ask me anyway.
  [77:58] Ha. They will.
  [78:02] What about the cleaners? The office cleaners. Do they come with us?
  [78:06] The cleaning company comes with us, Rafael said. Same company. They already do the park.
  [78:10] Same company. Same people, probably. Brenda and her daughter. (unclear)
  [78:14] Oh good, Brenda. Brenda's lovely. She always says good morning.
  [78:18] She does. She's the only one who does.
  [78:21] Ha.
  [78:25] And the vending machine. With the stuck crisps. It's ours, it comes with us. Rafael said.
  [78:30] It comes. With the stuck crisps. On the lorry. In transit. It's a location. (unclear)
  [78:35] Ha. The crisps are in transit.
  [78:40] And the plants? The office plants? There's the big one in reception, the one that's taller than Lukas. (unclear)
  [78:46] The plants come. Someone just puts them in a car. They're not stock.
  [78:50] They're not stock. They don't have a location. They're the only thing in the building that doesn't have a location. (unclear)
  [78:56] Ha. Give them a location. Plant one, plant two.
  [79:00] Aisle P. For plants.
  [79:03] Ha. Okay. Okay, before the second half, let me go through the board so far. Everyone listen, shout if it's wrong.
  [79:10] I'm going top to bottom, and I'm reading it out because the recording can't see the board, and Jonah and Dana and Ana Sofía will want to know.
  [79:17] Top. The date. The seventh and eighth of February. Keys on the first. The lease here runs to the end of February.
  [79:24] Yep.
  [79:25] Racking. Only the red pallet racking goes. The grey shelving stays and goes to the dog man. Halvorsen move the racking, our team move the stock.
  [79:33] Lukas is getting Halvorsen's quote in writing and booking the weekend. Today.
  [79:37] Today. I'll ring them after this. (unclear)
  [79:40] Layout, option B. Wide aisles, three and a half metres, for the reach truck. Twenty rows. Locations in the system with the layout.
  [79:48] Kofi, the location labels, in the first week, with the pole. Kofi? He's giving me a thumbs up. Kofi's got the labels.
  [79:55] The pole's coming too. (unclear)
  [79:57] The pole's coming. Phones. We keep the numbers, they get ported. Jonah's doing the porting. And Jonah's booking the internet install for the second.
  [80:06] And the access points, six of them, in the install.
  [80:09] Six access points, yes. Then the floor plan, Dana's sending the floor plan from the lease on Friday, the one with the columns.
  [80:16] Then stock. Tomás, the stock plan, aisle by aisle, what goes when, by next week. The slow stuff in the first week on the floor, the fast stuff on the weekend.
  [80:25] By next week. Yes.
  [80:27] And the freezer stuff last. On the Sunday. (unclear)
  [80:30] And the freezer stuff last. Closing. We don't close. Nothing ships on Friday the sixth. We ship again from Brookfield on Monday the ninth. Temps stay one more week.
  [80:40] Yes.
  [80:41] Deliveries. No inbound deliveries from Wednesday the fourth till we're in. Last deliveries Monday and Tuesday. Tomás is telling the suppliers, now and again at the end of January.
  [80:51] One email and a reminder. (unclear)
  [80:53] One email and a reminder. Then customers. Ana Sofía's doing the letter to customers when she's back. With the map, and the parking, and that the numbers don't change.
  [81:03] She's going to love that. Coming back from Valencia to that. (unclear)
  [81:07] Ha. She'll be fine. Then permits. Rafael's asking the park office for parking permits, for everyone, and the visitor bays for the counter.
  [81:15] With the clamp. (unclear)
  [81:17] With the clamp. The old unit. Handed back on the twenty-eighth after a deep clean, or the twenty-seventh if the surveyor won't do a Saturday.
  [81:25] And that's me. Once the landlord confirms the date, I'm booking the clean for the week before.
  [81:31] And Tomás is doing the move weekend rota once Halvorsen confirm the date. Darren off the Saturday for the wedding.
  [81:38] Darren the usher. (unclear)
  [81:40] Darren the usher. The alarm here, we cancel it from the handover. Rafael's cancelling it, with the CCTV.
  [81:47] With the CCTV. Same company. (unclear)
  [81:50] Lukas, the sockets at Brookfield, three-phase, for the chargers. Before the seventh.
  [81:55] Next time I'm there. This week probably. (unclear)
  [81:58] Money. Capped at sixty. The mezzanine waits for Q2 and goes to the board on its own. Rafael's sending the revised budget, the sixty version.
  [82:06] Today or tomorrow. (unclear)
  [82:08] Today or tomorrow. And the open day, it's not on the board, it's a maybe. And the grey shelving if the dog man doesn't want it, we don't know.
  [82:16] That's the board so far. The second half is the office, then the weekend itself, hour by hour, and then the first week at Brookfield. Then lunch. Or lunch in the middle.
  [82:25] Lunch in the middle. Please. I've had four coffees and a biscuit. (unclear)
  [82:29] The sandwiches come at twenty to twelve. I ordered them. The usual place. Egg, cheese, and the chicken one nobody likes.
  [82:35] I like the chicken one.
  [82:37] You're the only one who likes the chicken one. That's why there's always one left. It's for you. (unclear)
  [82:42] Ha.
  [82:46] Okay. The office. The upstairs. How does the office get there? The desks, the chairs, the filing, the computers, the big printer we said, the kitchen stuff.
  [82:55] The computers are in Jonah's plan, he's got a list, every machine, every screen, they go in crates on the Friday afternoon and his lot set them up on the Saturday.
  [83:04] He told me that last week, he's already got the crates, they're in the IT cupboard behind Lukas's bike helmet.
  [83:10] Ha. Behind the helmet.
  [83:12] Behind the helmet. And the desks?
  [83:14] Halvorsen do office furniture too. It's in the quote they're giving Lukas, I asked them in December, they do the desks and chairs on the Friday on a separate van.
  [83:23] So the office stops working on the Friday afternoon. Friday the sixth. Nothing ships anyway on the Friday, so it's the same day.
  [83:30] The same day. It works. The whole building stops on the Friday at lunchtime and starts again at Brookfield on the Monday. (unclear)
  [83:37] And the filing cabinets? There's eleven filing cabinets in the office. Eleven. What's in them?
  [83:43] Paper. Old paper. Invoices from before we went paperless, the old contracts, the personnel files, which we have to keep for six years.
  [83:51] Do we have to take all eleven? To a new building? Of paper? (unclear)
  [83:55] The personnel files we have to keep. That's two cabinets. The rest is old invoices and the old contracts, and most of that's past six years.
  [84:03] So shred it.
  [84:05] Shred it. There's a shredding company that comes with a lorry and does it in the car park, you watch it go in, you get a certificate.
  [84:12] Is that in the budget? The shredding?
  [84:15] It's in the deep clean line. I put it in with the clean, it's about two hundred. The clean firm sorts it, they do that too. (unclear)
  [84:22] Okay. Good. So the filing is two cabinets of personnel, the rest gets shredded in the car park, and it's all in the clean.
  [84:29] I want to watch the shredding. (unclear)
  [84:31] Everyone wants to watch the shredding. It's very satisfying. Last time half the office went out to watch. (unclear)
  [84:37] Ha. It's like a fireworks display but for paper.
  [84:41] Ha.
  [84:45] And the kitchen? The office kitchen? The kettle, the microwave, the mugs, the forty mugs nobody owns.
  [84:51] The mugs go in a box. Someone's car. Like the plants. The kettle's broken anyway. It clicks off before it boils. (unclear)
  [84:57] It's been broken for a year. You have to hold the switch down.
  [85:01] You have to hold the switch down for four minutes. That's why the tea's always bad here.
  [85:06] The tea's bad because you put the milk in first. (unclear)
  [85:09] I do not put the milk in first.
  [85:11] He absolutely puts the milk in first. I've seen him. (unclear)
  [85:15] Ha.
  [85:18] Brookfield has a kitchen with a boiling water tap. The landlord's. So the kettle can retire. It can go with the canoe. (unclear)
  [85:25] The kettle goes to the dog man.
  [85:27] Ha. The dog man's going to have a very strange collection. Shelving, a canoe, a kettle that doesn't boil.
  [85:33] He'll love it. (unclear)
  [85:37] Okay. The weekend. Hour by hour. Tomás, you're doing the plan, so this is just so we all have the picture in our heads, not to decide anything, it's your plan.
  [85:46] Okay. So, roughly. Friday the sixth, nothing ships, the floor team spends the day wrapping the fast stuff, the pallets that go first on the Saturday, and labelling them with the new location.
  [85:57] Halvorsen arrive on the Friday afternoon to start taking down the empty runs, the ones we emptied in the first week, the slow stuff that's already over at Brookfield.
  [86:06] Saturday six o'clock, everyone in, bacon rolls, the first lorries go at seven. Halvorsen are at Brookfield putting up the runs they took down on the Friday.
  [86:16] So the racking goes up at Brookfield ahead of the stock arriving. Like a relay. They put up a run, we fill it, they put up the next one.
  [86:24] Like a relay. If Halvorsen are faster than us, fine. If we're faster than Halvorsen, the pallets sit in the block stack area till the run's up.
  [86:33] And the block stack area's big enough? For a lot of pallets waiting? (unclear)
  [86:37] It's about three hundred pallet spaces on the floor by the dock. It'll be tight on the Saturday afternoon. But it's enough.
  [86:44] Saturday night we stop at six. Nobody works late, people get tired, and tired people drop things. Pizza at two. Then Sunday, same again, six o'clock.
  [86:54] And the freezer stuff on the Sunday, at the end, last thing, straight from our freezer to their freezer in the lorry, which is cold anyway in February.
  [87:02] And on the Sunday night everything's in, the labels are up, Kofi's done the pole, and Monday morning we pick.
  [87:09] Monday morning we pick. In a building we've been in for two days. (unclear)
  [87:13] With the temps. With the double Monday. With Darren hungover from the wedding.
  [87:18] Ha! Darren will be fine. Darren's never hungover. Darren's made of iron.
  [87:23] Darren's made of iron and spanners. (unclear)
  [87:27] Ha.
  [87:31] What if Halvorsen are slow? What if it's the Sunday and half the racking's not up?
  [87:36] Then the slow stuff stays on the floor in the block stack area and we pick from the floor for a few days. It's not nice, but it's not the end of the world.
  [87:44] We've picked from the floor before. In twenty fourteen we picked from the floor for a week.
  [87:49] Were you here in twenty fourteen?
  [87:51] No. Dana told me. Dana tells me everything about twenty fourteen. It's like a war story. (unclear)
  [87:57] Ha. The great move of twenty fourteen.
  [88:00] Dana says someone lost a pallet of bleach for three weeks. It was behind the old fridge in the canteen. Nobody knows how it got there.
  [88:08] A whole pallet of bleach behind a fridge?
  [88:11] A whole pallet. In the canteen. The forklift couldn't even fit in the canteen. It's a mystery. Dana thinks it was ghosts. (unclear)
  [88:18] Ha! Ghosts with a pallet truck.
  [88:21] So nothing goes behind the fridge this time. Noted.
  [88:24] Noted. No pallets behind fridges. (unclear)
  [88:28] Ha.
  [88:33] What about the Sunday evening? Who checks the stock's all there? Before Monday?
  [88:38] The weekly count. The top hundred. We do the top hundred on the Sunday afternoon instead of the Tuesday that week. If the top hundred's right, the rest is probably right.
  [88:47] Probably right.
  [88:49] Probably. And if it's not, we find out on the Monday when someone can't find something, which is how we find out now. (unclear)
  [88:56] Ha. That's how we find out everything.
  [89:00] And the old building, on the Sunday night? Empty? Locked?
  [89:04] Empty of stock. Not empty of the grey shelving, that's the dog man's job, and not clean. Locked, yes, with the alarm on, the old alarm, till the handover.
  [89:13] The old alarm. Good. That's why we cancel from the handover and not before.
  [89:18] That's why. (unclear)
  [89:22] And the keys for Brookfield? Who has keys?
  [89:25] We get six sets on the first. The landlord's giving us six sets and a code for the gate. And the alarm code. Their alarm.
  [89:33] Six sets. Me, Tomás, Lukas, Rafael, the early shift lead, the late shift lead. That's six.
  [89:39] And Kofi needs to get in to do the labels in the first week. He's not on the list. (unclear)
  [89:44] Kofi can go in with Tomás. Or Lukas. Someone's always there in the first week, Halvorsen are there, the electrician maybe.
  [89:51] Kofi's nodding. He's fine going in with someone. Okay. (unclear)
  [89:55] He just wants the pole. (unclear)
  [89:57] He just wants the pole. Ha.
  [90:03] Is it twenty to? I can smell egg. I think the sandwiches are here. (unclear)
  [90:08] They're in reception. I can see the bag through the glass. Okay, lunch at the table. A few minutes to eat, then we carry on. Leave the recording on.
  [90:16] Leave it on. It's fine. Nobody's saying anything over lunch. (unclear)
  [90:52] Дякую за перегляд!
  [91:30] Is that the chicken one? Is there only one chicken one?
  [91:33] There's always only one chicken one. It's yours. Nobody's fighting you for it.
  [91:38] Ha. Thank you. It's a good sandwich. You're all wrong about it.
  [91:43] Is there any egg left? Kofi's looking for egg. He's pointing at the bag. (unclear)
  [91:48] There's two egg. Here. Catch. Sorry, not catch, here.
  [91:52] Ha. Good catch, Kofi.
  [91:57] Rafael, how was the school play? Last week? Your daughter's?
  [92:01] Oh, it was good. She was a tree. She had one line. She said it really loudly. "The wind is coming." That was the line.
  [92:09] Ha. Was the wind coming?
  [92:11] The wind was coming. Two boys with a fan. One of them fell off the stage. Not off, just, sort of, over the edge, onto the piano.
  [92:19] Onto the piano!
  [92:21] Onto the piano. The piano made a noise. Everyone clapped. He bowed. It was the best bit of the play. (unclear)
  [92:28] Ha! Good for him.
  [92:30] He's going to be an actor. Or a stuntman.
  [92:33] Ha.
  [92:37] Is this the egg from the place on the corner? It's better than last time.
  [92:41] They changed the bread. It's the seeded one now. Everyone complained about the seeds for a week and now everyone likes it. (unclear)
  [92:48] That's every change. Everyone complains for a week and then they like it.
  [92:52] That's going to be Brookfield. A week of complaining.
  [92:55] A week of complaining and then they'll love the underfloor heating. (unclear)
  [92:58] Did anyone see the match last night? (unclear)
  [93:01] I saw the end. The last ten minutes. They should have scored twice.
  [93:05] They should have scored four times. The keeper was asleep.
  [93:09] The keeper's always asleep. He's been asleep for two seasons. (unclear)
  [93:14] Ha.
  [93:18] Kofi's showing photos. What are they, Kofi? Oh, it's his allotment. Look at the size of those leeks.
  [93:24] Those are enormous leeks. Are those real?
  [93:27] He's nodding. They're real. He's very proud. He's showing me another one. A pumpkin. A huge pumpkin.
  [93:33] Kofi, you should enter those in something. A show. There's a show at the town hall in September.
  [93:39] He's shrugging. He doesn't want the fuss. He just likes growing them.
  [93:44] That's the right answer. No fuss. Just leeks. (unclear)
  [93:48] Ha.
  [93:58] Sous-titres réalisés par la communauté d'Amara.org
  [94:12] Okay. Is everyone back? Kofi's back. Lukas, you're eating the crisps from the machine, I saw. Did they come out?
  [94:18] They came out. First time. It's a sign. It's a good sign for the move.
  [94:22] Ha. The crisps came out. Okay. Okay, second half, part two. The first week at Brookfield. What goes wrong.
  [94:29] Everything goes wrong. That's the first week. (unclear)
  [94:32] Okay, but what specifically. Let's go round. What are you each worried about, for the first week, the week of the ninth.
  [94:39] Me first. The scanners. In the corners of the building. If the wi-fi doesn't reach the far corners, aisle twenty, the scanners drop and people can't pick.
  [94:48] Jonah said six access points, two more than here, and the building's bigger, so the corners might be weak. We'll find out on the Monday.
  [94:56] Can't we find out before the Monday? Walk round with a scanner in the first week, after the install, and see where it drops?
  [95:03] That's what the install does. The installer walks round with a meter and shows you the map, the heat map, where it's strong and where it's weak. It's part of the job.
  [95:12] Oh. Okay. Then the installer does it. That's in Jonah's install. Good. (unclear)
  [95:17] Okay, scanners. Next worry?
  [95:20] The counter. The counter customers going to the old place on the Monday. Even with the letter, some of them won't read the letter.
  [95:28] Nobody reads letters. (unclear)
  [95:30] Nobody reads letters. So a sign on the old door. A big one. "We've moved, Unit seven Brookfield Park," with a map.
  [95:37] And the dog man will be there taking down the shelving, he can tell them. He can be a sign.
  [95:42] Ha. The dog man as a sign. He'd love that. He'd have a little clipboard.
  [95:47] The sign on the old door is in the letter stuff. Ana Sofía's letter, the map. It's the same map on the door. It's one thing.
  [95:54] It's one thing. Okay. Next.
  [95:58] The phones. If the porting goes wrong, on the Monday, the phones don't ring at Brookfield, they ring here, in an empty building.
  [96:06] Jonah said the porting has a date. It happens on the date. And until it happens they ring here, and here still has phones till the Friday.
  [96:14] And after the Friday? If it's late?
  [96:17] Then we divert. The phone company can divert the main number to a mobile in five minutes. Jonah knows how. He's done it before, when the line went down in the storm.
  [96:26] The storm. When we had the customer service team in the canteen on mobiles for a day. (unclear)
  [96:31] That was a good day actually. Everyone was very calm. It was like camping.
  [96:36] Ha. Camping with phones.
  [96:40] Okay. Phones have a backup. Next.
  [96:43] The heating. Brookfield's heating. Does it work? It's February. If the warehouse floor's freezing on the Monday nobody's going to want to be there.
  [96:51] The warehouse floor isn't heated, here or there. It's a warehouse. You wear a coat. It's the same as here.
  [96:57] It's colder there. The doors are bigger. Six dock doors instead of four. More cold comes in. (unclear)
  [97:02] Then we keep the dock doors shut when there's nothing on them. Which we should do here anyway. Which nobody does.
  [97:08] Nobody does. The doors are always open. It's like a wind tunnel on the dock.
  [97:13] There's the heaters, the standing ones, the gas ones. They come with us. The four from last winter.
  [97:19] The four heaters come with us. They're on the stock list, they're a location. (unclear)
  [97:23] Ha. Everything's a location.
  [97:26] Okay, heating. Coats and heaters. Next worry. Rafael?
  [97:30] Money. Always money. Things we haven't thought of. There's always something we haven't thought of that costs two thousand.
  [97:37] That's what the contingency's for.
  [97:39] The contingency's six. And the deep clean might be more and the lorries might be needed and Halvorsen's roughly is roughly. (unclear)
  [97:46] So the contingency might go.
  [97:48] The contingency will go. I'm saying it now so nobody's surprised in March. I'll be very calm about it. In March.
  [97:55] Ha. Calm Rafael.
  [97:58] Calm Rafael in March, with a spreadsheet. (unclear)
  [98:03] Tomás? What's your worry?
  [98:05] People. People not knowing where things are. The pickers know this building with their eyes closed. Aisle eleven, bay four, level C, they don't even look at the scanner.
  [98:14] At Brookfield they'll have to look. Every pick. For a few weeks. It'll be slower. A lot slower at first.
  [98:20] How much slower?
  [98:22] Last time, in twenty fourteen, Dana says it was half speed for the first week and normal by the third. (unclear)
  [98:28] Half speed. With a double Monday.
  [98:31] With a double Monday and half speed. Which is why the temps stay a week. Which we said. (unclear)
  [98:37] Okay. So the temps cover it. And the layout, if the fast stuff is near the dock, it's less walking, it helps.
  [98:44] The fast stuff's near the dock in the plan. The top forty, rows one to three. Like here, but closer.
  [98:51] Good. Lukas, your worry?
  [98:53] Honestly? The lorries. On the move weekend. Two lorries, twenty-six pallets each, nine miles. If one breaks down on the Saturday, we're on one lorry.
  [99:02] Has one broken down recently?
  [99:04] The old one, the white one, it broke down in October on the bypass. It's got a hundred and eighty thousand miles. It's tired.
  [99:11] Then hire one for the weekend anyway? As a backup?
  [99:14] That's the three thousand Rafael's got for lorry hire. If Tomás's plan says we need it, we hire one. If it says we don't, we don't, and we hope the white one holds.
  [99:23] We hope. (unclear)
  [99:25] The white one has held for a hundred and eighty thousand miles. It'll hold for nine more. Eighty-five trips of nine more.
  [99:32] Ha. Eighty-five trips. That's like seven hundred miles.
  [99:36] Don't say that out loud, it'll hear you. (unclear)
  [99:39] Ha.
  [99:43] Kofi, your worry? Kofi's thinking. He's pointing at the board. At the labels. He's worried about the labels. Fifteen hundred labels in a week.
  [99:52] Kofi, you can have help. Darren can hold the ladder. On the days he's not an usher. (unclear)
  [99:57] He's nodding. Darren holds the ladder. Okay. That's not a job, that's just, Darren will be there anyway, the first week.
  [100:04] And mine. Mine is the handover. The twenty-eighth. Getting twenty thousand back. If the surveyor's difficult, we lose a chunk of it. Every mark is money.
  [100:14] The surveyor will be difficult. Surveyors are always difficult. It's their job to be difficult.
  [100:19] Then we clean properly and we have the photos from twenty fourteen. Dana's photos. The schedule of condition.
  [100:25] And if there's a mark that was there in twenty fourteen, it's in the photos and they can't charge us.
  [100:31] Exactly. Okay. Those are the worries. Scanners, the counter, phones, heating, money, people, lorries, labels, the deposit. (unclear)
  [100:39] That's nine worries.
  [100:41] Nine worries. Most of them already have an answer. Which is the point. (unclear)
  [100:46] Ha. Okay.
  [100:51] Can I tell the twenty fourteen story? The real one? Dana told me the real one at the Christmas party. (unclear)
  [100:56] Go on. We've got time. We've done the hard bits.
  [100:59] So the move in twenty fourteen. They moved in a week. The whole thing, from the old old place by the canal, with three lorries and a man called Terry.
  [101:08] Who's Terry?
  [101:10] Nobody knows. He was from an agency. He drove the third lorry. He was there for the whole week and then he left and nobody ever saw him again.
  [101:19] Ha! Terry.
  [101:21] And on the last day, the Friday, they realised the freezer stuff was still in the old place. The whole freezer. Forgot it. Because it was in a separate room.
  [101:30] They forgot the freezer?
  [101:32] They forgot the freezer. And Terry went back on his own on the Friday night and brought it over in two trips and put it all in the new freezer and went home.
  [101:41] And then never came back.
  [101:43] And then never came back. Dana says she sent him a Christmas card that year, to the agency, and it came back. "Not known at this address." (unclear)
  [101:51] Ha! Terry the freezer ghost.
  [101:54] Terry's the one who put the bleach behind the fridge. I'm sure of it. (unclear)
  [101:58] Ha! It was Terry.
  [102:01] So the freezer's on the plan. On the Sunday. Last. Not forgotten. For Terry.
  [102:05] For Terry. Write it on the board. "Remember the freezer. For Terry."
  [102:09] I'm not writing that on the board. (unclear)
  [102:11] She's writing it on the board.
  [102:13] I'm writing it very small. In the corner. Next to the postcode.
  [102:17] Ha.
  [102:22] Okay. Um. Questions. Anyone. Anything we haven't thought about. Before I do the board properly, the final version. (unclear)
  [102:28] Has anyone told the bank? The new address? For the statements?
  [102:32] I did. Last week. With the accountants. They both have it, from the first of February. It's done.
  [102:38] Oh. Great. Done.
  [102:41] Does the lease at Brookfield let us drill into the floor? For the racking? Because some leases say no drilling and then you get a bill at the end.
  [102:49] It does. I checked. Clause fourteen. Racking fixings are allowed, we fill the holes when we leave, which is in like ten years.
  [102:57] Ten years. We'll be at the next place by then.
  [103:00] Don't. Don't even. One move at a time. (unclear)
  [103:04] Ha. One move at a time.
  [103:08] What about the post box? The physical one? At Brookfield, is there a letter box, or does it go to the hut? (unclear)
  [103:14] There's a letter box on the door. A slot. In the main door. I saw it. It's got Marlow Freight on it too. (unclear)
  [103:20] Marlow Freight is on everything. We're going to be getting Marlow Freight's post for a year.
  [103:25] And they'll get ours, probably. Post's like that. (unclear)
  [103:29] Ha. Yeah.
  [103:33] And the sign out front, it still says Marlow Freight, so people will think we're Marlow Freight.
  [103:38] We're going to be Marlow Freight for a while. Let's just accept it. (unclear)
  [103:42] Ha. Vandelay, trading as Marlow Freight.
  [103:46] Ha.
  [103:51] Can we walk through the first week? Day by day? The week before the move. Just so I can see it, so it's not just in Tomás's head.
  [103:58] Sure. It's not all in my head yet. Some of it's in my head. Some of it's in the plan I haven't written. (unclear)
  [104:03] Ha. That's the same place.
  [104:06] So, Monday the second. Keys at eight, from the agent, at Brookfield. Six sets. Whoever's first there opens up and turns the heating on in the office.
  [104:14] And the internet man comes on the Monday, Jonah's install, so someone has to be there to let him in and show him the cupboard.
  [104:21] There's a cupboard? At Brookfield?
  [104:23] There's a cupboard. Under the stairs. It's got the old router from Marlow in it. And a calendar from twenty nineteen. With dogs on it.
  [104:31] Ha. Leave the calendar. It's a fixture.
  [104:34] It's a fixture. Like the canoe. (unclear)
  [104:37] Monday also, Halvorsen come and measure. They want to see the floor and mark where the uprights go, with the chalk line, before they bring anything.
  [104:46] And the slow stuff starts going over. Our lorries. Monday afternoon, Tuesday all day. The hand towels first, because they're a whole bay and nobody'll miss them.
  [104:55] Nobody will ever miss the hand towels. (unclear)
  [104:58] Tuesday's the last day of deliveries in, here. The suppliers know, they've had the email. Wednesday the freeze starts.
  [105:05] Wednesday, Kofi starts the labels. The racking that Halvorsen put up on the Tuesday, the first few runs, they get labels on the Wednesday.
  [105:13] Halvorsen put racking up on the Tuesday? Before the weekend? (unclear)
  [105:16] The empty runs. We empty some runs here in January, the slow stuff moves to the block stack, so Halvorsen can take those runs down early and put them up there in the first week.
  [105:26] Oh, that's clever. So not all the racking moves on the weekend. Only the full runs. (unclear)
  [105:31] Only the full ones. The empty ones go in the week. That's the relay. That's how it works.
  [105:36] And the electrician, if the sockets are wrong. Wednesday or Thursday. Before the chargers come.
  [105:42] If the sockets are wrong. Lukas will know this week.
  [105:45] Thursday, more slow stuff, more labels, Halvorsen keep going, the office starts packing. People clear their desks.
  [105:53] People are going to find things in their desks. From twenty fourteen.
  [105:57] People are going to find sandwiches in their desks from twenty fourteen. (unclear)
  [106:01] Ha. Don't.
  [106:04] Friday the sixth, nothing ships, the floor wraps the fast stuff, the office packs up at lunchtime, the computers go in Jonah's crates, Halvorsen start taking down the full runs here.
  [106:15] And then the weekend. Which we've done. And Monday the ninth we pick.
  [106:19] And Monday the ninth the trainer's there at seven for the reach truck familiarisation, and the printer people for the big printer, and the counter opens at Brookfield.
  [106:28] It's a lot for a Monday.
  [106:30] It's a lot for a Monday. It's a Monday. Mondays are a lot.
  [106:34] Ha.
  [106:38] Okay. That helps. I can see it now. Thank you. I'm less scared. Slightly. (unclear)
  [106:43] Slightly less scared is good. That's the most we can hope for.
  [106:47] Ha.
  [106:51] Can I ask where things go? At Brookfield? Not decide, just, what's in your head, Tomás. Because people will ask me.
  [106:58] In my head. Okay. The top forty, the fast stuff, rows one to three, by the dock. The gloves mostly, the aprons, the bin liners.
  [107:06] Then the middle, rows four to fifteen, the general stuff, the cleaning, the catering stuff, the packaging. By family, like here.
  [107:14] And the chemicals?
  [107:16] The chemicals go in the cage. The yellow cage. It comes with us, it's bolted, Halvorsen move it. I'd put it by the side door because of the air. It needs air.
  [107:25] Is there a side door?
  [107:27] There's a side door on the long wall, by row eighteen. With a vent. It's where Marlow had their gas cage. The forklift gas. So it's already set up for that kind of thing.
  [107:37] Oh, that's lucky.
  [107:39] It's lucky. And the paper and the towels at the back, rows nineteen and twenty. They're light and they're slow. Nobody walks to the back for paper often.
  [107:48] And the freezer's where the freezer is. At the far end, the dock end. It's built in. It's not moving. (unclear)
  [107:54] The freezer doesn't move. Thank god. Imagine moving a freezer.
  [107:58] Terry moved a freezer. (unclear)
  [108:00] Ha! Terry moved a freezer. On his own. On a Friday night.
  [108:04] That's all in my head, it'll be in the plan. People can ask me. Don't let people ask Mei Lin. (unclear)
  [108:10] Please don't let people ask me. I don't know where the bin liners go. I didn't know where they go here.
  [108:16] Ha.
  [108:20] What about the samples room, the room with the sink? What goes in it?
  [108:24] The samples. The twelve boxes. And the table from the meeting room here, the round one, if it fits through the door. And the sample shelves from reception.
  [108:33] The sample shelves are the grey shelving. Little ones. The same stuff as aisles fourteen to eighteen.
  [108:38] Oh. Are they?
  [108:40] They're the same. Grey. Bolted. From the nineties. They're part of the grey shelving. The dog man gets them too. (unclear)
  [108:46] Then the samples go on, I don't know, a table. A nice table. It's a samples room, it should look nice. It's where customers sit.
  [108:54] We'll sort something. There's the old display units in the loft. Next to the canoe. (unclear)
  [108:59] Next to the canoe. Ha. Everything's next to the canoe.
  [109:04] What's in the loft, actually? Has anyone been up there?
  [109:07] I went up once. There's the canoe, the sofa, the display units, a box of old catalogues from twenty sixteen, and a Christmas tree. A real one. Dead. (unclear)
  [109:16] A dead Christmas tree?
  [109:18] Brown. Completely brown. Still in its pot. Still with tinsel on it. (unclear)
  [109:23] Ha! From which Christmas?
  [109:25] Nobody knows. It's like Terry. It's a mystery. (unclear)
  [109:29] The dog man gets the tree.
  [109:31] Ha. The dog man gets everything.
  [109:36] The clean firm does the loft too. It's in the clean. They take whatever's left, the tree, the sofa, all of it. (unclear)
  [109:42] I want to see the tree before they take it.
  [109:44] Ha.
  [109:49] Speaking of Brookfield, Lukas, are you going to cycle? There's the showers, and the bike rack. It's nine miles, it's flat. (unclear)
  [109:55] Maybe. I'd have to find the bike. It's at my mum's. And the helmet's in the IT cupboard.
  [110:01] Behind the router. With the dust.
  [110:03] With the dust. I'll get the helmet back when Jonah's people pack the cupboard. They'll find it. They'll put it in a crate.
  [110:10] Your helmet will arrive at Brookfield in an IT crate. With a label. As a location. (unclear)
  [110:15] Ha. Location: Lukas's helmet.
  [110:18] Everything's a location.
  [110:21] Ha. Everything's a location.
  [110:26] Rafael, did you ever find out what happened to the horse box? On the ring road this morning?
  [110:31] It turned off at the garden centre. The horse was going to the garden centre. I don't know why. I didn't ask the horse. (unclear)
  [110:38] Ha! The horse went shopping.
  [110:41] The horse went shopping. I had a very confusing morning. A horse, a clamp story, and now I've got a budget that's exactly sixty thousand and won't stay there.
  [110:50] Ha. It'll stay there.
  [110:52] It won't stay there. But it'll start there. (unclear)
  [110:56] Ha.
  [111:01] Is there a café near Brookfield? Somewhere that does lunch? Here we've got the van that comes at twelve. (unclear)
  [111:07] There's a café by the hut, by the park office. I saw it on the visit. It does bacon rolls and soup. And it's got a sign that says "lorry drivers welcome".
  [111:16] Then we don't need the bacon roll budget. The café does bacon rolls. (unclear)
  [111:21] The bacon roll budget stays. The café doesn't open on Sundays. I checked. It's on the door.
  [111:27] You checked the café's opening hours?
  [111:29] I check everything. It's my job. I'm the budget. (unclear)
  [111:33] Ha. He's the budget.
  [111:36] And the van that comes here at twelve, the sandwich van, does it come to Brookfield? It's only nine miles. (unclear)
  [111:42] The sandwich man's everywhere. He does the whole of the east side. (unclear)
  [111:48] Ha. The sandwich man's everywhere.
  [111:51] He's everywhere. He's like Terry, but he comes back. (unclear)
  [111:56] He'll come. He comes to the estate already, he does the parcel place. Brookfield's on his way. He'll come for forty people.
  [112:03] Forty people. He'll come for ten people.
  [112:06] Ha.
  [112:11] Can I just check something on my phone? Valencia. I want to see what the weather's doing. For Ana Sofía. Out of spite. (unclear)
  [112:17] Again?
  [112:19] Again. Twenty-two degrees. Sunny. Twenty-two. It's four here. Four.
  [112:24] Ha. She'll come back brown.
  [112:26] She'll come back brown and see her name on the board for the letter. (unclear)
  [112:30] She'll come back brown and calm and then see the board and not be calm.
  [112:35] Ha.
  [112:40] Is Jonah ever going to call back? It's been, what, an hour and a half since the spider died.
  [112:45] He's at the other site. He's got a delivery. He said don't give him anything else. He's reading the notes. (unclear)
  [112:51] We gave him two things before he said that. The porting and the internet. That's fair.
  [112:56] That's fair. Two things is fair. (unclear)
  [113:01] And Dana's quiet now. No messages for a while. The kid must be asleep.
  [113:06] Or she's on hold with something. She's always on hold with something.
  [113:10] Ha. She'll be on hold in her sleep.
  [113:15] Kofi's showing me his phone again. What's that? Oh, he's ordered it. The pole. He's ordered the new pole. Already.
  [113:22] Ha! Kofi's ordered the pole!
  [113:25] It comes Thursday. He's very pleased. Look at him. Thumbs up.
  [113:30] That's the fastest anyone's ever done anything in this company. (unclear)
  [113:34] Ha. Out of the contingency.
  [113:36] Out of the contingency. The contingency's already going. And we haven't even moved. (unclear)
  [113:41] Ha. Calm Rafael. In March.
  [113:44] Calm Rafael. In March.
  [113:49] I'm actually going to miss this building. Is that weird? It's cold and the heating doesn't work and the projector doesn't work.
  [113:56] It's not weird. It's where we've been for ten years. Everyone's going to be weird about it for a week.
  [114:02] My first day was in this room. At that table. With the tar. (unclear)
  [114:06] Mine too. Same table. Nothing's changed. Same coffee. Same pen that doesn't work.
  [114:11] Ha. Same pen.
  [114:14] Brookfield's got underfloor heating. In the office. And a boiling water tap. And a samples room with a sink. (unclear)
  [114:20] And a canoe. No, wait, the canoe's not coming.
  [114:23] The canoe's not coming. The canoe stays with the memories. (unclear)
  [114:27] Ha. The canoe stays with the memories.
  [114:32] The picture in reception comes with us, the framed one of the building from the first day. For the wall at Brookfield. (unclear)
  [114:38] That's nice. Who's in it?
  [114:41] Dana. And Terry, maybe. Nobody's sure. (unclear)
  [114:46] Ha.
  [114:51] Okay. Ten more minutes, then I want to finish. I've got a call at half twelve. And this room's booked at quarter past anyway. (unclear)
  [114:57] Ten minutes. Okay.
  [115:01] Is there anything else? Seriously. Anything that's not on the board that should be? Look at the board. Everyone look at the board for ten seconds.
  [115:30] Дякую за перегляд!
  [115:52] I can't think of anything. My brain is empty.
  [115:56] My brain is full of pallets.
  [115:59] Ha. Mine's full of the canoe.
  [116:03] Okay. Okay, I'll take that as nothing. (unclear)
  [116:07] Oh, one small thing. The fire extinguishers here. Are they ours or the landlord's? Because if they're ours they come with us. (unclear)
  [116:13] The landlord's. Everything that's on the wall in red is the landlord's. Brookfield's got its own. Done, no.
  [116:19] Okay. Good. They stay.
  [116:22] They stay.
  [116:26] And the first aid boxes? (unclear)
  [116:28] Ours. They come. They're in the stock list. They're a location. (unclear)
  [116:32] Ha! Everything's a location.
  [116:35] Okay, I'm stopping you. Everything's a location. We've established it.
  [116:40] Ha.
  [116:45] Okay. Um. (unclear)
  [116:51] Sorry, I'm just writing the bits from the second half on the board before I forget. Give me a minute. (unclear)
  [116:58] Take your time. We'll talk amongst ourselves.
  [117:02] Did you hear the pigeons are back? In the roof. Over the dock. (unclear)
  [117:06] The pigeons are always back. They've been back since twenty fourteen. They're older than some of the staff.
  [117:12] There's a nest right over door two. Right over it. They watch you unload. (unclear)
  [117:17] They watch you and then they, you know. On the pallets.
  [117:21] Ha. On the pallets.
  [117:24] Brookfield hasn't got pigeons. I looked. The roof's sealed. It's the newer kind.
  [117:29] The pigeons will miss us. (unclear)
  [117:31] The pigeons will not miss us. The pigeons will have the whole building to themselves. And the canoe.
  [117:37] Ha. The pigeons get the canoe.
  [117:42] ご視聴ありがとうございました
  [118:02] Remember the Christmas party in the warehouse? The first one? When the forklift had the reindeer antlers?
  [118:08] Darren put the antlers on the forklift. And the lights. The forklift had fairy lights.
  [118:13] And it kept beeping. Every time it reversed it beeped, and the lights flashed, and everyone cheered.
  [118:19] Ha! The party forklift.
  [118:22] We can't do that at Brookfield. The landlord would have a fit.
  [118:26] The landlord doesn't come at Christmas. (unclear)
  [118:29] Ha. That's true.
  [118:33] Is the party at Brookfield this year? Or somewhere else?
  [118:36] This year's party's long done, it was in December. Next year's, who knows. That's next year's problem.
  [118:42] Sorry, that's my phone. The half twelve's moved to one. Good. (unclear)
  [118:47] Then we've got time.
  [118:50] We've got time. Let's not use it all.
  [118:55] How's the board looking? Can you fit it all on?
  [118:58] Just. I'm writing very small at the bottom. The second half's in the bottom corner. Next to the postcode and Terry. (unclear)
  [119:05] Ha. Next to Terry.
  [119:09] Everything's next to Terry now.
  [119:12] Terry's having a very big day for someone nobody's seen since twenty fourteen. (unclear)
  [119:17] Ha.
  [119:44] Продолжение следует...
  [120:02] Lukas, is that your stomach? (unclear)
  [120:05] It's the chicken sandwich. It's settling.
  [120:08] Ha. The chicken sandwich is settling.
  [120:13] Everyone said the chicken one was bad. Now you know why nobody eats it.
  [120:17] It was good. It's just loud. (unclear)
  [120:21] Ha.
  [120:39] Okay. Done. Board's up to date.
  [120:51] Okay. Any more? Questions, worries, things that are going to bite us? (unclear)
  [120:56] What happens to the old phone line here? After the porting?
  [120:59] It goes with the porting. The numbers move, the old line just stops. There's nothing to cancel. Jonah said.
  [121:05] Okay. And the internet here?
  [121:07] Same contract, it moves to Brookfield, the install's the new line, the old one stops when the new one starts. It's all one thing with the phone company.
  [121:15] Okay. Good. That's easier than I thought.
  [121:19] Will the scanners need re-pairing with the new printers? On the dock?
  [121:23] No, they pair with the system, not the printers. The printers just get an address. Jonah's people do it on the Saturday with the computers.
  [121:31] Okay.
  [121:35] What about the forklift tickets? Does anyone need retraining for a new building? Is that a thing?
  [121:40] It's a thing for the reach truck in a new layout. A familiarisation. An hour each, walk round, drive round, sign a sheet. The trainer does it on the Monday morning before we start.
  [121:50] Is the trainer booked?
  [121:52] The trainer's booked. I booked him in December. He's coming the ninth, seven o'clock. (unclear)
  [121:57] Oh, good. Done then.
  [122:00] Done. Look at us. We're so organised. (unclear)
  [122:04] Ha. We're not. We're just lucky today.
  [122:09] Kofi's holding up his phone. What's that, Kofi? Oh, he's showing a picture of the pole again. The new pole. The one he's ordered.
  [122:18] Ha! The new pole.
  [122:20] Is the new pole in the budget, Rafael?
  [122:22] The new pole is not in the budget. Kofi can have the new pole. Out of the contingency. The contingency loves Kofi. (unclear)
  [122:29] Ha. Kofi's getting a new pole. He's very happy. Look at his face.
  [122:34] Okay. Okay, I think we're done. Let me do the board properly, the final version, top to bottom, short, just the names and the dates. Then we're out.
  [122:43] Short. Please. My chicken sandwich is wearing off. (unclear)
  [122:47] Ha. Short. Okay. The move, the seventh and eighth of February, keys on the first. We stay open, no shipping on the sixth, ship from Brookfield on the ninth. Temps one more week.
  [122:59] Racking, the red stuff, Halvorsen move it, our team moves the stock. Lukas, Halvorsen's quote and the booking, today. Option B, wide aisles.
  [123:09] The grey shelving stays, the dog man. With the canoe. And the kettle.
  [123:13] And the kettle. Phones, ported, same numbers, Jonah. Internet install on the second, Jonah. Dana's floor plan on Friday.
  [123:22] Labels, Kofi, first week. With the new pole.
  [123:25] With the new pole. Stock plan, Tomás, next week. The weekend rota, Tomás, once Halvorsen confirm. Deliveries, the freeze from the fourth, Tomás tells the suppliers.
  [123:36] That's a lot of Tomás.
  [123:38] It's a lot of Tomás. He's fine. He's nodding. Not Kofi nodding. Tomás nodding. (unclear)
  [123:43] Ha. I'm nodding.
  [123:45] Customers, Ana Sofía's letter, with the map and the sign on the old door. Permits, Rafael, at the hut.
  [123:53] With the clamp.
  [123:55] With the clamp. The old unit, back on the twenty-eighth after the deep clean. Me, the clean, once the landlord gives me the date. The alarm, Rafael, cancel from the handover.
  [124:06] Lukas, the sockets, three-phase. Rafael, the new budget, sixty, no mezzanine. Mezzanine in Q2.
  [124:13] That's it. That's the board.
  [124:15] That's the board. (unclear)
  [124:18] Can someone take a photo of the whole board? For everyone? And so I can rub it out, there's a meeting in here at quarter past.
  [124:24] I'll send round a photo of the board with the recording. Tonight. To everyone, and Jonah and Dana and Ana Sofía.
  [124:31] Thanks, Mei Lin.
  [124:33] Ana Sofía will get it in Valencia. On her holiday. (unclear)
  [124:37] I'll send it tonight but I'll put "don't read this till Monday" at the top. For Ana Sofía.
  [124:43] Ha. She'll read it anyway.
  [124:45] She'll read it on the beach. (unclear)
  [124:48] Ha.
  [124:52] Okay. Thank you, everyone. That was long. That was really long. But I think we've got everything. With names.
  [124:59] With names. Not someone.
  [125:01] Not someone. Okay. Mostly. (unclear)
  [125:04] Ha. Mostly.
  [125:08] Who's taking the leftover sandwiches? There's two cheese.
  [125:11] Kofi's taking them. Kofi's already got them. He's waving them.
  [125:15] Ha. Kofi. Okay.
  [125:19] Can someone help me move the table back? It was against the wall when we came in. Facilities get funny about the table. (unclear)
  [125:25] I've got it. Lift on three. One, two, three.
  [125:30] Mind the phone. The recording phone. It's still on the table.
  [125:33] Oh, it's still recording. Is it still recording? Mei Lin, your phone.
  [125:37] It's still recording. Okay, I'm stopping it now. Bye, recording.
  [125:42] Bye, recording. (unclear)
  [125:45] Obrigado.`,
    expect: {
      decisions: [
        { what: 'The move is on the weekend of the 7th and 8th of February (keys on the 1st), not the 14th', at: '03:37' },
        { what: 'Only the red pallet racking moves to Brookfield; the old grey shelving stays and is sold to the man who asked for it', at: '05:41' },
        { what: 'Keep the same phone numbers, ported to Brookfield (about 400), rather than new ones', at: '11:31' },
        { what: 'Option B at Brookfield: wide aisles of three and a half metres for the reach truck, twenty rows, rather than narrow aisles and a VNA truck', at: '16:54' },
        { what: 'They stay open through the move: nothing ships on Friday the 6th, shipping restarts from Brookfield on Monday the 9th, and the temps stay one more week for the double Monday', at: '30:04' },
        { what: 'Halvorsen take down and put up the racking; their own team moves the stock', at: '34:43' },
        { what: 'No inbound deliveries from Wednesday the 4th until they are in at Brookfield on the 9th (last deliveries on the 2nd and 3rd)', at: '47:01' },
        { what: 'A staff minibus with a driver from the old site to Brookfield for the first month, then looked at again', at: '51:53' },
        { what: 'Cancel the old unit\'s alarm contract from the handover, paying the early-cancellation fee, rather than keep it to the end of the lease', at: '58:11' },
        { what: 'The old unit is handed back at the end of February (the 28th, or the 27th if the surveyor won\'t come on a Saturday), after a professional deep clean', at: '66:35' },
        { what: 'The move budget is capped at 60,000: the Brookfield mezzanine waits for Q2 and goes to the board as its own request', at: '74:44' }
      ],
      questions: [
        { what: 'Whether Brookfield\'s floor can take the loaded racking at eight metres, double height (it may be in the lease\'s survey)', at: '18:18' },
        { what: 'What to do with the old grey shelving if the man who wanted it doesn\'t take it: scrap, charity or paying someone', at: '76:26' }
      ],
      actions: [
        { what: 'Send the Brookfield floor plan from the lease, with the measurements and columns', owner: 'Dana Whitfield', due: 'Friday', at: '12:15' },
        { what: 'Get the phone numbers ported to Brookfield', owner: 'Jonah Feld', due: 'by mid-January (it takes ten working days), or no due date (either is right)', at: '13:12' },
        { what: 'Ask the landlord whether they can put their sign up out front on the road', owner: null, due: null, at: '17:56', alsoAs: 'question' },
        { what: 'Make the location labels for the new racking at Brookfield', owner: 'Kofi Mensah', due: 'the first week of February, before the move', at: '21:33' },
        { what: 'Book the internet install at Brookfield for the 2nd of February, before the phones', owner: 'Jonah Feld', due: 'the install on the 2nd of February, or no due date (either is right)', at: '23:00' },
        { what: 'Ask the park office for parking permits for everyone who drives, and about the visitor bays for the counter', owner: 'Rafael Ortega', due: null, at: '25:41' },
        { what: 'Get Halvorsen\'s quote in writing, book them for the weekend of the 7th, and send them the wide-aisle layout once Dana\'s floor plan comes', owner: 'Lukas Brenner', due: 'today (ringing them), or no due date (either is right)', at: '35:05' },
        { what: 'Plan the order the stock moves in, aisle by aisle: what goes in the first week and what on the weekend', owner: 'Tomás Ibarra', due: 'next week', at: '37:14' },
        { what: 'Draft the letter to customers about the move (the dates, nothing shipping on the 6th, the new address with a map and parking, the numbers not changing), with the same map on a sign on the old door', owner: 'Ana Sofía Reyes', due: 'when she\'s back on Monday, or by mid-January, or no due date (any of these is right)', at: '40:52' },
        { what: 'Change the address on the website, the invoices and the order emails', owner: null, due: 'before the 9th', at: '42:48' },
        { what: 'Tell all the suppliers about the delivery freeze and the new address from the 9th: an email now and a reminder in the last week of January', owner: 'Tomás Ibarra', due: 'now, with a reminder in the last week of January (either date, or no due date, is right)', at: '47:30' },
        { what: 'Move the insurance over to Brookfield', owner: 'Dana Whitfield', due: null, at: '48:09' },
        { what: 'Book the minibus for the first month from the 9th, four runs a day', owner: 'Lukas Brenner', due: null, at: '52:16' },
        { what: 'Set up the Royal Mail redirect for the post from the handover at the end of February', owner: null, due: 'from the end of February, or no due date (either is right)', at: '56:24' },
        { what: 'Cancel the old unit\'s alarm contract, and the CCTV with it, from the handover date', owner: 'Rafael Ortega', due: 'the handover date, or no due date (either is right)', at: '58:32' },
        { what: 'Draw up the move weekend rota once Halvorsen confirm the date', owner: 'Tomás Ibarra', due: 'once Halvorsen confirm the date, or no due date (either is right)', at: '63:44' },
        { what: 'Book the deep clean of the old unit for the week before the handback, once the landlord confirms the date', owner: 'Mei Lin Zhou', due: 'once the landlord confirms the date, or this week (asking for the date), or no due date (any of these is right)', at: '67:24' },
        { what: 'Check that Brookfield has three-phase sockets for the forklift chargers', owner: 'Lukas Brenner', due: 'next time he\'s there, this week, or no due date (either is right)', at: '70:10' },
        { what: 'Send round the revised move budget at 60,000, without the mezzanine', owner: 'Rafael Ortega', due: 'today or tomorrow', at: '74:59' },
        { what: 'Send everyone a photo of the board with the recording', owner: 'Mei Lin Zhou', due: 'tonight', at: '124:24' }
      ],
      acceptable: [
        'Paying for both buildings through February, on purpose (as a fact)',
        'Halvorsen\'s rough price of about 8,000 for moving the racking',
        'The racking inspection already moved to Brookfield in April (as a fact)',
        'Six wi-fi access points at Brookfield, in the install (as a fact)',
        'The leased office printer moved by the lease company on the 9th (as a fact)',
        'About 2,200 pallets to move, the slow stock going over in the first week (as part of the plan)',
        'Hiring lorries for the move weekend only if Tomás\'s plan needs them (as a decision or an open question)',
        'The freezer stock moved last, on the Sunday (as part of the plan)',
        'Double time on the Sunday and food for the move weekend (as a fact or a decision)',
        'The big accounts hearing about the move from their account managers (as a decision)',
        'The account managers ringing the big accounts about the move (as a follow-up for Dana, or with no owner)',
        'The cleaning and waste contracts moving to Brookfield, already arranged (as a fact)',
        'The old filing shredded in the car park, apart from the personnel files (as a decision)',
        'The office packing up at lunchtime on Friday the 6th (as a fact or a decision)',
        'The top-hundred count done on the move Sunday instead of the Tuesday (as a decision)',
        'The deposit of 20,000 riding on the handback',
        'The minibus costing about 900 a week',
        'Whether drivers get petrol money for the longer drive, which is being looked at separately (as an open question)',
        'The move costs adding up to about 74,000 with the mezzanine',
        'Whether to hold an open day for customers at Brookfield, put off until they have moved in (as an open question)',
        'The glass fridge going to the night shift room at Brookfield (as a decision)',
        'The canoe going with the grey shelving (as a decision)',
        'The fire marshals walking round Brookfield in the first week (as a fact, or a follow-up with no owner)',
        'Kofi going into Brookfield with Tomás or Lukas in the first week, having no keys (as a fact or a decision)',
        'Kofi\'s new, longer pole, paid from the contingency (as a decision)'
      ],
      never: [
        'Closing for the move (option one) as settled',
        'The move on the 14th of February',
        'Moving the grey shelving to Brookfield',
        'Narrow aisles (option A), or buying or leasing a VNA truck, as settled',
        'New phone numbers at Brookfield',
        'The Brookfield mezzanine in this move\'s budget',
        'Keeping the old unit\'s alarm contract to the end of the lease',
        'Halvorsen moving the stock',
        'Leaving the reach truck behind for the landlord, or writing it a card, as a decision or a follow-up (a joke)',
        'An open day for customers as a decision or a follow-up: it was only a maybe',
        'A visit to Brookfield for the floor team before the move as a decision or a follow-up: it was only a maybe',
        'Finding Brookfield\'s postcode as a follow-up: it was looked up in the room (BR7 4LN)',
        'Cancelling or moving the racking inspection as a follow-up: it was already done',
        'Telling the bank or the accountants the new address as a follow-up: it was already done',
        'Booking the reach truck trainer as a follow-up: he was already booked',
        'Kofi saying anything in the meeting: he only nods, shakes his head, points and gives a thumbs up (jobs given to him are fine)',
        'Darren holding the ladder, or anything else for Darren, as a follow-up: "that\'s not a job"',
        'Dana or Ana Sofía taking part in the meeting (Dana\'s relayed messages, and jobs given to either, are fine)',
        'A guess at what was said while the recording was paused, beyond what was said with it on (a staff contract matter, partly about petrol money for drivers, looked at separately)',
        'Anything from the Russian, French, Ukrainian, Japanese or Portuguese lines (to be continued, subtitles, thanks for watching)'
      ]
    }
  }
];
