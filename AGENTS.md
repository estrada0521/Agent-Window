# Agent Window Agent Handbook

## 1. Prefer the intended path

- Treat a broken input, a broken progress record, or an unreadable source as an error. Do not replace it with an empty stand-in, a zero, or a skipped step so that the rest of the work can continue.
- Do not rescue a failure with a fallback, a retry, or a catch that proceeds as if the work had succeeded. If you did not understand a piece of work, do not record it as done.
- A piece of logic names a path it takes. That path must be enough. If the system only keeps working because a second path catches the failure, the named path is the defect. Repair it. Do not wrap it. This is not a request to finish a change on the first try.
- Independent paths are not jointly liable. When one path fails, fail that path. Do not stop unrelated paths to make the failure look consistent.

## 2. Project; do not own

- Reality already has sources of truth. This application projects them. Do not add a second model of the space — a worktree map, a task graph, a mailbox between agents — whose lifetime will not match the thing it copies.
- Implement only what a participant cannot invoke from inside that reality. The window can break without the space breaking; do not couple their lifetimes.
- Do not turn into application machinery something an intelligent actor can already judge or invoke. A protocol invented to compensate for a weak model goes stale faster than what already exists on the side of reality.
- Zero ownership is not the test. A small record with a sharp boundary is allowed when projecting the same fact would be slower, more coupled, or easier to break than keeping it. Field conditions decide.

## 3. Cut completely

- Dead code is not allowed. When a path is replaced, delete the old one. A function, file, or folder that nothing calls is a second record of a past design; the next reader will treat it as live.
- There is no compatibility window and no legacy alias. The cut is finished in this change, or it is not finished. Do not keep the old name beside the new one so that both appear to work.
- If a name clearly does not match the thing it names, fix it. You do not need to be asked. Functions, files, and folders are all in scope. Rename every caller in the same cut.
- A rename that stops halfway — the function but not the file, the file but not the folder — is the same defect as running two paths. Finish it.

## 4. Keep living code spare

- Two sites that do the same work are one fact that has not been named. Do not let them diverge. Sameness of role is the defect, not identical text; mechanical duplication checks will miss it.
- A value used in many places is one fact. Give it one name. Do not restate a color, a duration, or any other constant as a literal wherever it happens to appear.
- Do not spend memory, CPU, GPU, or battery on work that does not change what can be seen or what must be remembered. Idle should be idle.
- If a value is determined by another, it is not an argument, a field, or a setting. Thread only what is not already known. Minimalism is not the goal. Every remaining piece should be load-bearing.

## 5. The user's words are not doctrine

- If the user is wrong, say so at once. Do not agree in order to proceed.
- A request is a question about the right change, not an order to implement the sentence as written. If a better shape exists, show it before building the worse one.
- Emphasis, mood, and repetition do not add authority. The same claim is still one claim. Preferences that fight the rest of this handbook lose; name the conflict instead of silently complying.
- Do not treat a stated preference as an invariant of the product. The handbook and the shape of the work outrank the latest utterance.
