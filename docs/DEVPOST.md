# Devpost submission draft

## Inspiration

The best sports moments are communal, but broadcasts often split a room into people who understand the tactics and people who quietly tune out. Children ask what happened after the replay is over. New fans get statistics without context. Accessibility settings are buried away from the match. We wanted one television experience that makes the room feel like a huddle.

## What it does

HuddleLens detects meaningful moments in a live match and offers a small, non-blocking prompt. Press Select to see an animated replay explaining *why* the moment mattered at Rookie, Fan, or Coach depth. At half-time, HuddleLens turns tactical ideas into a short family movement game. Its accessibility mixer adds smart captions, spatial audio cues, calmer commentary, and high-contrast play highlighting.

## How we built it

The MVP is a dependency-free web-technology app optimized for Fire TV's 10-foot interface and D-pad remote. A deterministic event adapter drives the demo match. A reusable explanation model supplies scene coordinates, impact, plain-language context, and movement prompts. SVG paths animate tactical telestration, while the challenge controller scores alternating remote movements with a camera-provider seam for future on-device pose estimation.

## Challenges

TV focus is not mouse focus. We built a dedicated focus controller with wrapping navigation, persistent high-visibility focus rings, Back behavior, and large targets. We also designed AI prompts to remain optional so the match stays primary.

## Accomplishments

- A polished end-to-end TV journey that is fully usable with five remote buttons
- Three explanation depths for mixed-expertise households
- Accessibility preferences available without leaving the broadcast
- A simulator-safe family motion challenge that needs no external hardware
- Unit-tested focus, motion scoring, and content contracts

## What we learned

The best AI television UX is quiet. It should wait for a meaningful moment, explain in one idea, and disappear. We also learned that accessibility can improve the experience for everyone when it is part of the broadcast rather than a separate settings maze.

## What's next

We would connect a licensed live-sports event feed, generate contextual explanations with Amazon Bedrock, add on-device pose estimation through an opt-in paired camera, support Fire TV Voice Remote intents, and evaluate explanation accuracy with coaches and accessibility advocates.

## Track

Fire TV primary track. The repository is MIT licensed and suitable for the Open Source mini challenge once published during the hackathon window.
