# Bulkhead — Lancer solo combat for your phone

A small, turn-based **Lancer** combat game you can play in your phone's browser. You pilot
**Vail "Bulkhead" Halvorsen** (LL0) in the GMS Everest **Moral Responsibility** through an
endless string of missions. Each win makes the next mission harder. One loss ends the run and
you start over at Mission 1.

No build step, no dependencies: plain HTML, CSS and ES modules. It works offline once loaded
and can be added to your home screen.

## Play it

- **On GitHub Pages:** in the repo settings, open **Pages** and set **Source** to
  **GitHub Actions**. Every push to `main` then tests and deploys the game. Open the URL on
  your phone and use **Share → Add to Home Screen**.
- **Locally:** run `npm start` (or any static server) and open http://localhost:8080.

## What's in it

**Your build** is locked in from Vail's Comp/Con export. All stats come from the official
`lancer-data` package.

- Everest: 16 HP (10 + Hull 2 + Personalizations), Evasion 8, Speed 4, Heat Cap 6, 4 Structure, 4 Stress, 6 Repairs.
- Shotgun (Main), two Thermal Pistols (Flex, Aux), Heavy Charged Blade (Heavy).
- Type-3 Projected Shield, Pattern-B HEX Charges, Personalizations, Custom Paint Job.
- Talents: Shield of Blades, Handshake Etiquette, Backswing Cut.
- Everest Initiative and the Hyperspec Fuel Injector core power.

**Rules kept:**
- Standard move plus two quick actions or one full action, with no repeated actions unless you Overcharge. Overcharge heat escalates 1 / 1d3 / 1d6 / 1d6+4.
- Attacks roll d20 + Grit against Evasion, with the Accuracy/Difficulty d6s. A 20+ is a crit.
- Hard and soft cover, engagement (it stops your movement and gives ranged attacks +1 Difficulty), Overwatch and Brace.
- Heat, Stress and the Overheating table. Structure and the Structure table, including System Trauma, Direct Hit and Crushing Hit.
- Exposed, Impaired, Stunned and Lock On.
- Skirmish, Barrage, Boost, Stabilize, Disengage, grenades and mines.

**Rules trimmed:** tech actions and invasion, grapple and ram, pilots outside their mechs,
knockback, line of sight blocking, difficult terrain, and reactions other than Overwatch and
Brace. Every mech is Size 1.

**Enemies** are simplified Tier 1–3 NPCs modelled on the core-book roles: Grunt, Assault,
Berserker, Scout, Sniper, Ronin and Bombard. Veteran and Elite templates are simplified too
(Elites get 2 structure and 2 activations).

**Progression:** the enemy budget grows with every win. New NPC roles unlock over the first 6
missions, Veterans appear from Mission 5 and Elites from Mission 7. Tier 2 enemies arrive at
Mission 9 and Tier 3 at Mission 16. Objectives rotate between Eliminate, Hold the Zone (with
reinforcements) and Assassinate the Commander.

## Development

```
npm test          # rules engine unit tests + full auto-played battles
npm run sim       # balance check: a scripted pilot plays missions 1–12
```

| File | What it does |
| --- | --- |
| `js/data.js` | Vail's build, NPC classes, quips |
| `js/engine.js` | The rules: attacks, damage, heat, structure, movement, player actions |
| `js/ai.js` | Enemy activations and end-of-round logic |
| `js/missions.js` | Map and roster generation, difficulty curve |
| `js/ui.js` | Screens, the SVG hex map, touch controls |
| `js/autoplay.js` | Scripted pilot for tests and the simulator |

Lancer is © Massif Press. This is an unofficial, non-commercial fan project made under the
Lancer Third Party License, and it is not affiliated with Massif Press.
