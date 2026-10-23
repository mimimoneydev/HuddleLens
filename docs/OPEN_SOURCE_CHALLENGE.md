# Open Source Mini Challenge submission

## Project

**huddlelens-motion** is an MIT-licensed library for privacy-first movement scoring on television devices. It processes low-resolution camera frames locally, converts horizontal movement into anonymous direction events, and falls back to D-pad controls when no camera is available. This matters because family fitness and accessible TV experiences should not require uploading video or owning specialized hardware.

## Submission fields

- Contribution URL: `https://github.com/mimimoneydev/huddlelens-motion`
- HuddleLens repository URL: `https://github.com/mimimoneydev/HuddleLens`
- GitHub username: `mimimoneydev`
- License: MIT
- Hackathon publication date: `TO BE FILLED FROM THE PUBLIC REPOSITORY`

## What was shipped

- Dependency-free browser motion detector using two 96×54 in-memory RGBA frames.
- Anonymous `left`, `right`, or `null` direction output—no identity or pose inference.
- Alternating repetition scorer with configurable targets and cooldown filtering.
- Fire TV/Android D-pad, keyboard, and on-screen control fallback.
- Explicit camera lifecycle that stops media tracks and clears frame state.
- Responsive demo with visible privacy state.
- Automated tests, integration documentation, privacy threat model, contributing guide, security policy, and MIT license.

## Why it matters

Many movement-driven applications assume a cloud video pipeline or specialized sensor. That excludes users with limited connectivity, creates avoidable privacy risk, and leaves camera-denied users without an input method. `huddlelens-motion` demonstrates a small, auditable alternative: derive only a coarse direction locally and use the same scoring contract for an ordinary television remote.

## Verification

```bash
cd huddlelens-motion
npm test
npm pack --dry-run
npm run demo
```

After publication, record the public repository creation date above and use this document as the source for the hackathon submission form.
