# SATU!

> Every phone is a hand of cards. The host deals. Shout **SATU!** on your last card.

A colour-matching card party game for 2–10 players in the same room. Each player uses their own phone. One person hosts a table, everyone else scans the QR code or types the 5-letter code.

**Play:** https://mnm1122000.github.io/satu/

## How a game runs

1. **Table.** The host taps *Host a table*. Players join with the QR code, the invite link or the code, then pick a name and **take a selfie or choose a gallery photo** (no photo = your initial on a colour you pick). Under **Seats** the host **drags everyone to where they really sit** on a little table (round or long, like TIPU!); turns go clockwise from those seats and every phone's table matches the real one. The host chooses *Play to* (1 round / 200 / 500 points), *Round ends* (after the 1st / 2nd / 3rd player is out, or when only one is left) and *Cards each* (5 / 7 / 10).

Opening the game (or scanning the QR code) plays the SATU! intro: cards deal into a fan, the title stamps in, **BETA**, *made by mnm*. Tap to skip.
2. **Shuffle & deal.** The host taps *Shuffle & deal*. Every phone hears the riffle and the host's phone turns into **one big full-screen deck**. Cards are dealt **one player at a time**: the whole hand to the player after the host, then the next, and so on round the table, **the host last**. For each player the two phones go **head to head** (top edge to top edge) and the host either:
   - **flicks ↑** one card at a time, or
   - **holds the deck**: *brrrr*, the cards stream across one by one until that player's hand is full, then it stops and moves to the next player.

   Each card shoots off the top of the host's phone with a *trrr*. **On the player's phone it lands full screen, face down; they tap it, it flips over, drops into their hand and the table comes back.** Cards that arrive quickly wait in a pile (*+6 more waiting*, *Flip all*). The host can tap a player at the top to change who's next. **⚡ Auto deal** gives everyone their whole hand at once, no animation.
3. **Play.** Your cards are laid out side by side (two or three rows when the hand is big), never on top of each other. **Press and hold** a card to pop it out of your hand, then **flick it up onto the pile**, like throwing it on the table (tapping twice also works). Tap the deck to draw. The table shows every player around it, card counts, whose turn it is, the direction of play, the pile and the colour in play. Every card played flies from that player's seat onto the pile on every phone, so everyone sees who played what. The line under the table says what just happened.
4. **Round end.** A player who plays their last card is **out** and takes a place (1st, 2nd…); the others keep playing and turns skip them. The round ends when the host's *Round ends* setting is reached (classic: the 1st player out). Hands are revealed. The host deals the next round (the dealer chip moves one seat).

## Rules (classic)

- Match the top card by **colour**, **number** or **symbol**, or play a **Wild**.
- Can't play? **Draw** one card. If it matches you may play it right away, otherwise your turn ends (or tap *Keep it*).
- **Skip** ⊘: next player misses a turn. **Reverse** ⇄: direction flips; with 2 players it acts like Skip. **+2**: next player draws 2 and misses a turn. **Wild**: choose the colour. **Wild +4**: choose the colour, next player draws 4 and misses a turn.
- **Wild +4 challenge:** a +4 is only allowed if you hold no card of the colour in play. The victim may challenge. Guilty: the player who played it draws 4 and the challenger plays normally. Innocent: the challenger draws 6 and misses their turn.
- **SATU!** When you're down to your **last card** **the microphone opens and you have to say "SATU!" out loud**. The phone listens (Malay speech recognition; "satu", "1" or "one" count). You get 4 seconds of grace, then anyone can tap *Catch* before the next player moves, and you draw 2. If the phone has no speech recognition or the mic is blocked, a SATU! button appears instead.
- **Scoring:** numbers = face value, Skip / Reverse / +2 = 20, Wild / Wild +4 = 50. The cards still in hands when the round ends are the pot: **1st place scores all of it, 2nd half, 3rd a quarter** (and so on). First to the target wins.

### Rules decided (not in the classic rules)

| Question | Decision |
|---|---|
| Round goes on after the first winner | Host setting *Round ends*: after 1st (classic) / 2nd / 3rd out, or last one left. Players who are out are skipped. |
| How several winners score | Pot = points left in hands at the end. 1st 100%, 2nd 50%, 3rd 25%, halving each place. |
| Going out on a +2 / +4 while the round continues | The next player still draws and is skipped; no challenge on a last-card +4. |
| Reverse when only two players are left | Acts like Skip (you play again), as with two players. |
- **First card:** a Wild +4 is put back. Skip skips the first player, Reverse lets the dealer start the other way, +2 makes the first player draw 2 and miss a turn, a Wild lets the first player pick the colour.
- No stacking of +2/+4 (official rule). If the winning card is a +2 or +4, the next player still draws before scoring.

## Host powers

The host phone is also the dealer. From the ☰ menu the host can skip a stuck or disconnected player's turn (they draw 1), end the game, or close the table for everyone. After the game, *Play again* keeps the same players; *Back to lobby* lets new people join.

## How it works

- No server. Phones talk through public MQTT relay brokers (emqx, hivemq, mosquitto), same as Silent Killer.
- The host phone runs the game engine (`js/engine.js`) and holds the deck. Each player receives only their own hand. Private messages are **end-to-end encrypted** (ECDH P-256 + AES-GCM). Card faces you're dealt or draw only travel to your phone.
- Animations that carry no secrets (a card dealt to someone, a card played, Skip, Reverse…) go out once on a shared topic, so fast dealing doesn't flood the relay.
- Sounds are synthesised live with Web Audio (`js/sfx.js`): shuffle riffle, the dealer's *trrr*, card received, slap on the pile, draw, your-turn chime, Skip, Reverse, +2/+4, Wild, SATU!, Catch, win fanfare. Vibration on Android; iPhone gets Taptic ticks on iOS 18+.
- Limitation: the host phone holds the whole deck in memory. Pick a host who won't open the browser devtools.
- Profile photos are cut to 160×160 JPEG and shared on a retained relay topic; closing the table clears them.
- The first time you host or join, a **microphone setup** sheet explains why, asks for the mic, lets you test by saying "satu", and shows step-by-step help (Android Chrome / iPhone Safari) if the mic or speech recognition is blocked. *Skip* gives you a SATU! button instead. It's also on the home screen (🎙 Mic).
- Speech recognition uses the browser's Web Speech API (Chrome on Android sends the audio to Google's recogniser; iPhone needs Siri turned on).
- If the host's page reloads it offers *Resume hosting*. Players who reload rejoin as themselves.

## Development

```
node tools/serve.cjs 5191     # http://localhost:5191  (add ?dev=1 for "Add bot" test players)
node tools/test-engine.js     # rule tests + 360 random full games (2–10 players)
```

**Test bench:** https://mnm1122000.github.io/satu/tools/bench.html (or `http://localhost:5191/tools/bench.html`). You play the host on the big phone; pick 1–6 players and they join by themselves when your table opens, flip their dealt cards and play their own turns (both can be switched off so you can tap their phones yourself). `tools/multi.html` is the older host + two players bench. `tools/icons.html` renders the PNG icons from `assets/img/logo.svg`.

SATU! is an original game in the classic shedding-card family. It isn't affiliated with any commercial card game.
