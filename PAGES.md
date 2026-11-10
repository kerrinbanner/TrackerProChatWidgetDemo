# TrackerPro Chat Widget Demo

Public static demo of the TrackerPro AI chat embed (for GitHub Pages).

## Live demo

After enabling Pages on `main` / root:

`https://YOURUSER.github.io/YOURREPO/`

## Configure on the page

1. **API base:** `https://chat.trackerpro.co.uk`
2. **Site key:** `YourCompany|tp-sample-widget-key` (e.g. `trial|tp-sample-widget-key`)
3. Click **Apply & Reload Widget**

## CORS / allowlist

Add this Pages origin (no path) to ChatApi:

- Widget site `AllowedOrigins`: `https://YOURUSER.github.io` (or `*` for sample)
- `AiChat:TrustedOrigins`: `https://YOURUSER.github.io`

Do not open via `file://` - Pages HTTPS is required for Origin checks.
