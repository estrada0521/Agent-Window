# Agent Window Agent Handbook

## 1. Prefer the intended path

- Treat a broken input, a broken ledger, or an unreadable source as an error. Do not replace it with an empty stand-in, a zero, or a skipped step so that the rest of the work can continue.
- Do not rescue a failure with fallback, retry, or a catch that proceeds as if the work had succeeded. If you did not understand a piece of work, do not record it as done.
- "One shot" is not "land the change in a single attempt." It is: the path this code claims to take should be sufficient. If you need a fallback for the system to keep working, the original logic is the defect. Tighten that path. Do not pad around it.
- Independent paths are not jointly liable. Fail the path that broke. Do not halt unrelated paths to make the failure look consistent.

## 2. Project; do not own

- Reality already has sources of truth. This application projects them. If a record you write cannot be traced back to its source, you have created a second record. Do not do that.
- Implement only what a participant cannot invoke from inside that reality. The window can break without the space breaking; do not couple their lifetimes.
- Do not turn into application machinery something an intelligent actor can already judge or invoke. Ownership creates a second lifetime, and it will not match the thing it copies.
- Do not add a contract to compensate for a weak model. What already exists on the side of reality goes stale slower than a protocol you invent here.
