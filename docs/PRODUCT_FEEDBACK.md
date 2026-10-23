# Product feedback and roadmap

## Fire TV web-technology path

**Used for:** a remote-first 10-foot experience with standard keyboard/remote key events and a static deployment.

**Worked well:** the event model makes D-pad interaction predictable, and web technologies allow very fast iteration on motion, contrast, and typography.

**Needs work:** the path from a web prototype to an installable Fire TV/Vega package should have a single current decision tree with a maintained starter for each supported runtime. Simulator camera and microphone capability should also be documented in one matrix.

**Onboarding:** quick for the interaction prototype; less clear at packaging and device-validation boundaries.

**Would we build with it again?** Yes, especially with an official remote-focus utility and a lightweight packaging template.

## Feature requests

1. **Official cross-runtime focus manager — important.** A common library for Fire OS, Vega OS, and web targets would reduce subtle navigation bugs.
2. **Simulator capability matrix — important.** Clearly list support for microphone, camera, Voice Remote, game controllers, and media keys.
3. **TV-safe AI overlay patterns — nice-to-have.** Reference timing, safe areas, interruption rules, and accessibility guidance for assistant overlays.

## Friction log

**Task:** choose a production path for a web-technology Fire TV prototype.  
**Expected:** one guide comparing Fire OS web shell, React Native, and Vega web APIs.  
**Observed:** starter samples cover several paths, but the tradeoffs and final packaging steps are distributed across resources.  
**Severity:** moderate.  
**Workaround:** kept the UI dependency-free, used standard TV key events, and packaged a static `dist/` that can be hosted or placed in a web shell.  
**Suggestion:** add a “prototype to store-ready app” flowchart with simulator commands and validation checkpoints.
