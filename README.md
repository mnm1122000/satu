# SATU!

> Every phone is a hand of cards. The host deals. Shout **SATU!** on your last card.

A colour-matching card party game for 2–10 players in the same room. Each player uses their own phone. One person hosts a table, everyone else scans the QR code or types the 5-letter code.

**Play:** https://mnm1122000.github.io/satu/

## How a game runs

1. **Table.** The host taps *Host a table*. Players join with the QR code, the invite link or the code, then pick a name and **take a selfie, choose a photo from the gallery, or pick an emoji**. The host chooses *Play to* (1 round / 200 / 500 points) and *Cards each* (5 / 7 / 10).
2. **Shuffle & deal.** The host taps *Shuffle & deal*. Every phone hears the riffle. Then the host **flicks a card up off the deck (or taps it)**. Each card goes *trrr*: it slides off the top of the host's phone, and on **the player's phone the card slides in from the top edge, flips over and drops into their hand**. Everyone else sees a card glide to that seat. Three ways to deal:
   - **🔄 Round the table:** one card each in turn order (the glowing seat is next). *Auto deal* (Slow / Normal / Fast) does it by itself.
   - **📱 Phone to phone:** the host taps a player, the two phones go **head to head** (top edge to top edge) and the host flicks cards across, so the card leaves the host's screen and arrives on theirs. The player's phone says *"Put the top of your phone against the host's phone"*. When their hand is full the next player who still needs cards is picked.
   - **⏩ Skip:** deal everyone the rest at once, no animation.
3. **Play.** **Press and hold** a card to pop it out of your hand, then **flick it up onto the pile**, like throwing it on the table (tapping twice also works). Tap the deck to draw. The table shows every player around it, card counts, whose turn it is, the direction of play, the pile and the colour in play. Every card played flies from that player's seat onto the pile on every phone, so everyone sees who played what. The line under the table says what just happened.
4. **Round end.** First player out of cards wins the round and scores everyone's leftover cards. Hands are revealed. The host deals the next round (the dealer chip moves one seat).

## Rules (classic)

- Match the top card by **colour**, **number** or **symbol**, or play a **Wild**.
- Can't play? **Draw** one card. If it matches you may play it right away, otherwise your turn ends (or tap *Keep it*).
- **Skip** ⊘: next player misses a turn. **Reverse** ⇄: direction flips; with 2 players it acts like Skip. **+2**: next player draws 2 and misses a turn. **Wild**: choose the colour. **Wild +4**: choose the colour, next player draws 4 and misses a turn.
- **Wild +4 challenge:** a +4 is only allowed if you hold no card of the colour in play. The victim may challenge. Guilty: the player who played it draws 4 and the challenger plays normally. Innocent: the challenger draws 6 and misses their turn.
- **SATU!** When you're down to your last card (or holding 2 on your turn) **the microphone opens and you have to say "SATU!" out loud**. The phone listens (Malay speech recognition; "satu", "1" or "one" count). You get 2.5 seconds of grace, then anyone can tap *Catch* before the next player moves, and you draw 2. If the phone has no speech recognition or the mic is blocked, a SATU! button appears instead.
- **Scoring:** numbers = face value, Skip / Reverse / +2 = 20, Wild / Wild +4 = 50. First to the target wins.
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
- Speech recognition uses the browser's Web Speech API (Chrome on Android sends the audio to Google's recogniser; iPhone needs Siri turned on).
- If the host's page reloads it offers *Resume hosting*. Players who reload rejoin as themselves.

## Development

```
node tools/serve.cjs 5191     # http://localhost:5191  (add ?dev=1 for "Add bot" test players)
node tools/test-engine.js     # rule tests + 360 random full games (2–10 players)
```

`tools/multi.html` opens a host and two players side by side for local testing. `tools/icons.html` renders the PNG icons from `assets/img/logo.svg`.

SATU! is an original game in the classic shedding-card family. It isn't affiliated with any commercial card game.
