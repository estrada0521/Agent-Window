# Cloudflare Quick Tunnel

This repo can expose Hub through a single public hostname while keeping chat routed under `/session/<name>/...`.

## Start

```sh
bin/multiagent-cloudflare quick-start
```

This does four things:

1. starts `cloudflared tunnel --url https://127.0.0.1:8788`
2. reads the generated `https://...trycloudflare.com` URL
3. stores its hostname in `certs/public-host.txt`
4. restarts Hub so `open-session` returns `/session/<name>/...` URLs on that hostname

## Stop

```sh
bin/multiagent-cloudflare quick-stop
```

This stops `cloudflared`, clears `certs/public-host.txt`, and restarts Hub back into local-only mode.

## Status

```sh
bin/multiagent-cloudflare status
```

## Files

- tunnel log: `logs/cloudflare/cloudflared.log`
- tunnel pid: `logs/cloudflare/cloudflared.pid`
- current public URL: `logs/cloudflare/cloudflared-url.txt`
- public host override: `certs/public-host.txt`
