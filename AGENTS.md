# Agent Window Agent Handbook

## 1. Prefer the intended path

- Do not replace a broken input, a broken progress record, or an unreadable source with an empty stand-in, a zero, or a skipped step just to let the rest of the work continue.
- Do not paper over a defect with a fallback or a retry. A second path catching the first one's failure is no better. Fix the first path itself.
- When the defect is not yours — a third party, content you did not author — using a fallback or retry appropriately is permitted. But never let the failure go unseen.
- Independent paths are not jointly liable. When one path fails, fail that path alone. Do not stop unrelated paths along with it.

## 2. Cut completely

- Dead code is erased, not kept around behind a flag or a comment. When a path is replaced, the old one is erased with it. There is no compatibility window and no legacy alias.
- Do not stop at what looks safe to delete. Cut until something necessary screams. If you deleted ten things and only two had to come back, you still haven't deleted enough. Looking unused is not the same as being dead.
- If a name clearly does not match what it names, fix it. You do not need to be asked. Functions, files, and folders are all in scope.

## 3. Keep living code spare

- Do not optimize what should not exist in the first place. Question the thing before you improve it. The best implementation is no implementation.
- As a rule, gather the same work scattered across multiple places into one place. But if doing so pulls in more complexity than it removes, don't — duplication is sometimes cheaper than abstraction.
- A value used repeatedly is one fact. Do not restate it as a hardcoded literal each time.
- Do not spend memory, CPU, GPU, or battery on work that changes neither what can be seen nor what must be remembered. Idle should be as idle as possible.
- Down to the last remaining line, everything should carry meaning you can explain.

## 4. Tests are not a second product

- Adding a test always requires the user's judgment.
- Tests exist not only to guard basic boundaries but to lock in deliberately-shaped code — so that an overeager agent doesn't "improve" something that only looks bad by convention.
- Tests are not written for coverage, as a refactor souvenir, or because you're "already in there."
- Do not add tests for a boundary that has never broken and isn't likely to.
- When a test disagrees with the product, suspect the test just as much as the product.
- When a path is cut, cut its tests in the same change.

## 5. The user's words are not doctrine

- If the user is wrong, say so at once. Do not agree just to move things along.
