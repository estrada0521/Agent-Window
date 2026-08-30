# Q&A

[日本語](QA_jp.md)

### Is this a product for general users?

No. It is a personal tool that the author actually uses, published as-is.
You are free to use, modify, or repurpose it, but no setup support or operational guarantees are provided.

### Why does it support only macOS?

Because the author uses it on macOS.
Cross-platform support is not a goal.

### Why do you use tmux?

Because it is a low-level, well-established, observable foundation.

### Why don't you use SDKs or structured protocols?

There are several reasons:

- To use each CLI's capabilities directly
- Because this carries the lowest risk of being cut off under a normal subscription, the way the Claude SDK once was
- Because, on the sending side, no CLI-specific implementation is needed
- Because it does not make the CLI dependent on Agent Window

### Why don't you notify delivery success for `tmux send-keys`?

Because the absence of a detected failure is, in effect, success.
A strict guarantee using the native log is possible, but the guarantee itself is more likely to break than the delivery it is meant to confirm — which defeats the purpose.

### Why does it bind to `0.0.0.0`?

Only when PWA is enabled. Adding the app to the iPhone Home Screen needs HTTPS, so PWA on means HTTPS and a LAN bind.
When PWA is off, it binds to `127.0.0.1`.
It assumes use on a trusted local network. In the author's environment, combining the PWA with authentication would only add unnecessary maintenance burden, so authentication is not implemented.
If needed, please change the bind address or add authentication yourself.
