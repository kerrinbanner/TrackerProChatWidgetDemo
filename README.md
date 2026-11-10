# TrackerPro AI Chat Widget (Embeddable Website Client)

Lightweight, self-contained AI chat embed designed for external customer websites and contractor portals.  
**Built with a calm, utilitarian Field-Service aesthetic (Gemini design system).** No purple glows, neon gradients, or consumer distractions.

---

## Features

- **Gemini-Style Field-Service Aesthetic**: Crisp neutral slate scale, deep navy accents (`#0f3d5c`), high legibility, and refined micro-elevations.
- **Quick Action Chips**: One-tap quick intents above the composer:
  - `Next visit` — Checks upcoming engineer visit window and job reference.
  - `Open jobs` — Displays active call-outs and service visits.
  - `Talk to a person` — Escalates directly to the live human dispatch queue.
- **Connection State Banner**: Real-time SignalR socket status indicator directly below the header (Reconnecting with spinner, Polling fallback, Offline alert).
- **Responsive Mobile Bottom Sheet**: Automatically adapts to viewport width. On devices `< 600px`, expands into a native-feeling bottom sheet with touch drag-handle and iOS safe-area padding.
- **Voice Speech-to-Text (Mic)**: Browser-native Web Speech API (`en-GB`) dictation.
- **File & Photo Attachments**: Seamless upload to `POST /chat/attachment` (up to 10MB; PDF, PNG, JPG, WEBP) with chip previews and deletion controls.
- **Live SignalR Streaming**: Supports real-time token streaming (`AssistantDelta`) and multi-actor typing indicators (AI vs Human Agent).
- **Tenant Theming**: Configurable via HTML data-attributes (`data-primary-color`, `data-accent-color`, `data-title`, `data-logo-url`).

---

## File Structure

| File | Purpose |
|------|---------|
| `tp-chat-widget.js` | Core embed script (DOM generation, state machine, REST API calls, SignalR wiring) |
| `tp-chat-ui.css` | Complete stylesheet for launcher, panel, bubbles, cards, chips, and mobile bottom sheet |
| `tp-chat-signalr.js` | Minimal Classic SignalR 2.x hub proxy wrapper with connection state lifecycle listeners |
| `index.html` | Demo host page simulating an external company website |

---

## Quick Start (Local Testing)

> **Important**: Do not open `index.html` via `file://`. An HTTP server is required so that the `Origin` header is populated for CORS/allowlist checks.

Run a static web server in this directory:

```bash
# Using Python
python -m http.server 5500

# Or using Node
npx --yes serve -l 5500
```

1. Open `http://localhost:5500` in your browser.
2. In the configuration card:
   - **API base**: Default is `https://chat.trackerpro.co.uk` (or your local API root `https://localhost:PORT`).
   - **Site key**: Set to `YourCompany|tp-sample-widget-key` (where `YourCompany` matches your tenant database).
3. Click **Apply & Reload Widget**.
4. Click the floating chat launcher in the bottom right corner.
5. Fill in the pre-chat contact form (Name, Email, Phone) and tap **Start Chat**.
6. Try tapping **Next visit** or sending `"hello"` to test assistant response.
7. Try tapping **Human** or **Talk to a person** to test dispatcher queue escalation.

---

## Embedding on External Sites

Include the script tag before `</body>` on any website:

```html
<!-- Required dependencies: jQuery and SignalR 2.4.x -->
<script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/signalr.js/2.4.3/jquery.signalR.min.js"></script>
<script src="https://chat.trackerpro.co.uk/tp-chat-signalr.js"></script>

<!-- TrackerPro Widget Script (automatically links tp-chat-ui.css) -->
<script
  src="https://chat.trackerpro.co.uk/tp-chat-widget.js"
  data-api-base="https://chat.trackerpro.co.uk"
  data-site-key="YourCompany|your-site-key"
  data-title="TrackerPro Assistant"
  data-primary-color="#0f3d5c"
  data-accent-color="#0284c7"
  async></script>
```

### Script Tag Attributes

| Attribute | Required | Default | Description |
|-----------|----------|---------|-------------|
| `data-api-base` | Optional | `https://chat.trackerpro.co.uk` | Root URL of TrackerProChatApi |
| `data-site-key` | **Yes** | `""` | Tenant site identifier (`Company|Key`) |
| `data-title` | Optional | `"Chat with us"` | Window title and launcher label |
| `data-primary-color` | Optional | `#0f3d5c` | Main header and user bubble color |
| `data-accent-color` | Optional | `#0284c7` | Highlight, link, and chip active color |
| `data-logo-url` | Optional | `null` | Header avatar image URL |

---

## API & Hub Integration Details

1. `POST /chat/widget/start`
   - Payload: `{ siteKey, origin, visitorName, visitorEmail, visitorPhone? }`
   - Returns JWT `accessToken`, `chatSessionId`, and `hubPath` (e.g. `/chathub`).
2. `POST /chat/message`
   - Header: `Authorization: Bearer {token}`
   - Payload: `{ ChatSessionId, Text, Attachments }`
3. `POST /chat/escalate`
   - Queues chat for human agent in TrackerPro Admin split inbox.
4. `POST /chat/session/end`
   - Closes active session.
5. SignalR Hub Events:
   - `ReceiveMessage(message)`: Incoming message from AI or dispatcher.
   - `Typing(payload)`: Broadcasts `{ isTyping, displayName, isAi }`.
   - `AssistantDelta(payload)`: Streams chunk deltas for progressive rendering.
   - `AssistantComplete(payload)`: Finalizes streaming response.
