/**
 * TrackerPro AI Chat - lightweight website embed (no DevExtreme).
 * Calm Field-Service Engineering (Gemini aesthetic). No purple glow.
 *
 * Usage:
 *   <script
 *     src="tp-chat-widget.js"
 *     data-api-base="https://chat.trackerpro.co.uk"
 *     data-site-key="YourCompany|tp-sample-widget-key"
 *     data-title="Chat with us"
 *     async></script>
 */
(function (window, document) {
  "use strict";

  var SCRIPT = document.currentScript || (function () {
    var scripts = document.getElementsByTagName("script");
    return scripts[scripts.length - 1];
  })();

  var scriptBase = "";
  if (SCRIPT && SCRIPT.src) {
    scriptBase = SCRIPT.src.substring(0, SCRIPT.src.lastIndexOf("/") + 1);
  }

  var cfg = {
    apiBase: (SCRIPT && SCRIPT.getAttribute("data-api-base")) || "https://chat.trackerpro.co.uk",
    siteKey: (SCRIPT && SCRIPT.getAttribute("data-site-key")) || "",
    title: (SCRIPT && SCRIPT.getAttribute("data-title")) || "Chat with us",
    visitorName: (SCRIPT && SCRIPT.getAttribute("data-visitor-name")) || "",
    visitorEmail: (SCRIPT && SCRIPT.getAttribute("data-visitor-email")) || "",
    visitorPhone: (SCRIPT && SCRIPT.getAttribute("data-visitor-phone")) || "",
    primaryColor: SCRIPT && SCRIPT.getAttribute("data-primary-color"),
    accentColor: SCRIPT && SCRIPT.getAttribute("data-accent-color"),
    logoUrl: SCRIPT && SCRIPT.getAttribute("data-logo-url")
  };

  cfg.apiBase = String(cfg.apiBase).replace(/\/+$/, "");

  var state = {
    token: null,
    chatSessionId: null,
    hubPath: "/chathub",
    open: false,
    busy: false,
    pendingAttachments: [],
    hub: null,
    streamBuffers: {},
    typingTimer: null,
    pollTimer: null,
    renderedIds: {},
    preChatDone: false,
    connState: "disconnected", // connecting, connected, reconnecting, disconnected, polling
    isAgentHandling: false
  };

  var STORAGE_KEY = "tpAiChatWidget." + (cfg.siteKey || "default");

  function loadPersistedSession() {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (!saved || !saved.token || !saved.chatSessionId) return;
      if (saved.expiresUtc) {
        var exp = new Date(saved.expiresUtc).getTime();
        if (isFinite(exp) && exp < Date.now() + 60000) return;
      }
      state.token = saved.token;
      state.chatSessionId = saved.chatSessionId;
      state.hubPath = saved.hubPath || "/chathub";
      state.preChatDone = true;
      if (saved.visitorName) cfg.visitorName = saved.visitorName;
      if (saved.visitorEmail) cfg.visitorEmail = saved.visitorEmail;
      if (saved.visitorPhone) cfg.visitorPhone = saved.visitorPhone;
    } catch (e) { /* ignore */ }
  }

  function persistSession(data) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        token: state.token,
        chatSessionId: state.chatSessionId,
        hubPath: state.hubPath,
        expiresUtc: data && (data.expiresUtc || data.ExpiresUtc) || null,
        visitorName: cfg.visitorName || "",
        visitorEmail: cfg.visitorEmail || "",
        visitorPhone: cfg.visitorPhone || ""
      }));
    } catch (e) { /* ignore */ }
  }

  function clearPersistedSession() {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
  }

  loadPersistedSession();

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function escapeHtml(text) {
    return String(text == null ? "" : text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderMarkdown(text) {
    var html = escapeHtml(text || "");
    // Code blocks
    html = html.replace(/```([\s\S]*?)```/g, function (_, code) {
      return '<pre class="tp-md-code"><code>' + code + '</code></pre>';
    });
    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code class="tp-md-inline">$1</code>');
    // Bold & italic
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
    // Links
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    // Bullet lists
    html = html.replace(/(?:^|\n)[-\*] (.+)/g, '<br>&bull; $1');
    html = html.replace(/\n/g, "<br>");
    return html;
  }

  function injectStylesheet() {
    if (document.getElementById("tp-chat-ui-styles")) return;
    var link = document.createElement("link");
    link.id = "tp-chat-ui-styles";
    link.rel = "stylesheet";
    link.href = (scriptBase || "") + "tp-chat-ui.css?v=" + Date.now();
    document.head.appendChild(link);

    // Dynamic tenant theming overrides
    if (cfg.primaryColor || cfg.accentColor) {
      var customStyle = document.createElement("style");
      customStyle.id = "tp-chat-tenant-styles";
      var cssRules = ":root {";
      if (cfg.primaryColor) cssRules += " --tp-chat-primary: " + cfg.primaryColor + ";";
      if (cfg.accentColor) cssRules += " --tp-chat-accent: " + cfg.accentColor + ";";
      cssRules += " }";
      customStyle.textContent = cssRules;
      document.head.appendChild(customStyle);
    }
  }

  function hasVisitorIdentity() {
    var name = (cfg.visitorName || "").trim();
    var email = (cfg.visitorEmail || "").trim();
    return !!name && email.indexOf("@") > 0;
  }

  function setConnectionBanner(stateType, message) {
    state.connState = stateType;
    var banner = document.getElementById("tp-chat-conn-banner");
    var dot = document.getElementById("tp-chat-status-dot");
    var statusText = document.getElementById("tp-chat-header-status-text");
    if (!banner) return;

    banner.className = "";
    banner.innerHTML = "";

    if (stateType === "connected") {
      banner.style.display = "none";
      if (dot) dot.className = "tp-header-status-dot";
      if (statusText) statusText.textContent = state.isAgentHandling ? "Agent connected" : "Live · AI Assistant";
      return;
    }

    if (dot) dot.className = "tp-header-status-dot is-offline";

    if (stateType === "reconnecting") {
      banner.classList.add("is-reconnecting");
      banner.appendChild(el("div", "tp-banner-spinner"));
      banner.appendChild(el("span", null, message || "Reconnecting to live socket..."));
      if (statusText) statusText.textContent = "Reconnecting...";
    } else if (stateType === "polling") {
      banner.classList.add("is-polling");
      banner.appendChild(el("span", null, message || "Live socket offline. Checking for updates automatically."));
      if (statusText) statusText.textContent = "Polling mode";
    } else if (stateType === "disconnected") {
      banner.classList.add("is-disconnected");
      banner.appendChild(el("span", null, message || "Connection lost."));
      var retryLink = el("span", "tp-banner-retry", "Retry");
      retryLink.addEventListener("click", function () {
        connectHub();
      });
      banner.appendChild(retryLink);
      if (statusText) statusText.textContent = "Offline";
    }
  }

  function setPreChatVisible(show) {
    var panel = document.getElementById("tp-chat-panel");
    var pre = document.getElementById("tp-chat-prechat");
    if (!panel || !pre) return;
    if (show) {
      panel.classList.add("tp-prechat-open");
      pre.classList.add("tp-show");
      var nameInput = document.getElementById("tp-prechat-name");
      if (nameInput) {
        nameInput.value = cfg.visitorName || "";
        setTimeout(function () { nameInput.focus(); }, 40);
      }
      var emailInput = document.getElementById("tp-prechat-email");
      if (emailInput) emailInput.value = cfg.visitorEmail || "";
      var phoneInput = document.getElementById("tp-prechat-phone");
      if (phoneInput) phoneInput.value = cfg.visitorPhone || "";
    } else {
      panel.classList.remove("tp-prechat-open");
      pre.classList.remove("tp-show");
    }
  }

  function showPreChatError(msg) {
    var err = document.getElementById("tp-chat-prechat-error");
    if (!err) return;
    if (msg) {
      err.textContent = msg;
      err.classList.add("tp-show");
    } else {
      err.textContent = "";
      err.classList.remove("tp-show");
    }
  }

  function autosizeInput(input) {
    if (!input) return;
    input.style.height = "auto";
    var next = Math.min(140, Math.max(44, input.scrollHeight));
    input.style.height = next + "px";
  }

  function refreshPending() {
    var box = document.getElementById("tp-chat-pending");
    if (!box) return;
    box.innerHTML = "";
    for (var i = 0; i < state.pendingAttachments.length; i++) {
      (function (att, idx) {
        var chip = el("span", "tp-pending-chip", att.Name || att.name || "file");
        var removeBtn = el("button", "tp-pending-remove", "x");
        removeBtn.type = "button";
        removeBtn.addEventListener("click", function () {
          state.pendingAttachments.splice(idx, 1);
          refreshPending();
        });
        chip.appendChild(removeBtn);
        box.appendChild(chip);
      })(state.pendingAttachments[i], i);
    }
  }

  function downloadAttachment(att) {
    var blobPath = att.BlobPath || att.blobPath;
    if (!blobPath || !state.chatSessionId || !state.token) return;
    var url = apiUrl("/chat/attachment/download?chatSessionId=" + encodeURIComponent(state.chatSessionId)
      + "&blobPath=" + encodeURIComponent(blobPath));
    fetch(url, { headers: { Authorization: "Bearer " + state.token } })
      .then(function (res) {
        if (!res.ok) throw new Error("Download failed");
        return res.blob().then(function (blob) {
          var objectUrl = URL.createObjectURL(blob);
          var a = document.createElement("a");
          a.href = objectUrl;
          a.download = att.Name || att.name || "file";
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 1000);
        });
      })
      .catch(function () {
        addMessage("System", "Could not download attachment.", "tp-msg-system");
      });
  }

  function showTypingIndicator(actorName, isAi) {
    var box = document.getElementById("tp-chat-messages");
    if (!box) return;
    var existing = document.getElementById("tp-chat-typing-active");
    if (existing) existing.remove();

    var wrap = el("div", "tp-typing-indicator");
    wrap.id = "tp-chat-typing-active";

    var dots = el("span", "tp-typing-dots");
    dots.appendChild(el("span", "tp-typing-dot"));
    dots.appendChild(el("span", "tp-typing-dot"));
    dots.appendChild(el("span", "tp-typing-dot"));
    wrap.appendChild(dots);

    var label = isAi ? "TrackerPro AI is thinking..." : (actorName + " is typing...");
    wrap.appendChild(el("span", null, label));

    box.appendChild(wrap);
    box.scrollTop = box.scrollHeight;
  }

  function hideTypingIndicator() {
    var existing = document.getElementById("tp-chat-typing-active");
    if (existing) existing.remove();
  }

  function addMessage(sender, text, css, attachments, messageId) {
    hideTypingIndicator();
    var box = document.getElementById("tp-chat-messages");
    if (!box) return;
    if (messageId) {
      var key = String(messageId);
      if (state.renderedIds[key]) return;
      state.renderedIds[key] = true;
    }

    var wrap = el("div", "tp-msg " + (css || ""));
    if (messageId) wrap.setAttribute("data-msg-id", String(messageId));

    // Message meta & badges
    var meta = el("span", "tp-msg-meta");
    meta.textContent = sender;

    if (css && css.indexOf("tp-msg-agent") !== -1) {
      var agentBadge = el("span", "tp-badge-agent", "Verified Agent");
      meta.appendChild(agentBadge);
    } else if (css && css.indexOf("tp-msg-ai") !== -1) {
      var aiBadge = el("span", "tp-badge-ai", "AI");
      meta.appendChild(aiBadge);
    }

    var now = new Date();
    var timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    meta.appendChild(el("span", null, "· " + timeStr));

    wrap.appendChild(meta);

    var body = el("div", "tp-md");
    body.innerHTML = renderMarkdown(text || "");
    wrap.appendChild(body);

    if (attachments && attachments.length) {
      var files = el("div", "tp-msg-files");
      for (var i = 0; i < attachments.length; i++) {
        (function (a) {
          var name = a.Name || a.name || "file";
          var ct = String(a.ContentType || a.contentType || "").toLowerCase();
          var isImg = ct.indexOf("image/") === 0 || /\.(jpe?g|png)$/i.test(name);
          if (isImg && (a.BlobPath || a.blobPath) && state.token && state.chatSessionId) {
            var thumbWrap = el("a", "tp-msg-file-img");
            thumbWrap.href = "#";
            thumbWrap.title = name;
            var img = document.createElement("img");
            img.alt = name;
            img.loading = "lazy";
            thumbWrap.appendChild(img);
            thumbWrap.addEventListener("click", function (ev) {
              ev.preventDefault();
              downloadAttachment(a);
            });
            files.appendChild(thumbWrap);
            var url = apiUrl("/chat/attachment/download?chatSessionId=" + encodeURIComponent(state.chatSessionId)
              + "&blobPath=" + encodeURIComponent(a.BlobPath || a.blobPath));
            fetch(url, { headers: { Authorization: "Bearer " + state.token } })
              .then(function (res) { return res.ok ? res.blob() : null; })
              .then(function (blob) {
                if (!blob) return;
                var objectUrl = URL.createObjectURL(blob);
                img.src = objectUrl;
              })
              .catch(function () { /* keep link-only fallback */ });
          } else {
            var link = el("a", "tp-msg-file", name);
            link.href = "#";
            link.addEventListener("click", function (ev) {
              ev.preventDefault();
              downloadAttachment(a);
            });
            files.appendChild(link);
          }
        })(attachments[i]);
      }
      wrap.appendChild(files);
    }

    box.appendChild(wrap);
    box.scrollTop = box.scrollHeight;
  }

  function renderIncomingMessage(msg) {
    if (!msg) return;
    var id = msg.Id || msg.id;
    var sender = String(msg.Sender || msg.sender || "").toLowerCase();
    var msgType = String(msg.MessageType || msg.messageType || "");

    if (sender === "user") return;
    if (msgType.toLowerCase() === "visitorcontact") return;

    if (sender === "agent") {
      state.isAgentHandling = true;
      var statusText = document.getElementById("tp-chat-header-status-text");
      if (statusText) statusText.textContent = "Agent connected";
    }

    var name = msg.DisplayName || msg.displayName
      || (sender === "agent" ? "Agent" : (sender === "system" ? "System" : "TrackerPro AI"));
    var css = sender === "agent" ? "tp-msg-agent" : (sender === "system" ? "tp-msg-system" : "tp-msg-ai");
    var atts = msg.Attachments || msg.attachments || [];
    addMessage(name, msg.Text || msg.text || "", css, atts, id);
  }

  function startPolling() {
    if (state.pollTimer) return;
    state.pollTimer = setInterval(function () { pollMessages(); }, 3500);
  }

  function pollMessages() {
    if (!state.token || !state.chatSessionId) return;
    fetch(apiUrl("/chat/messages/" + encodeURIComponent(state.chatSessionId)), {
      headers: { Authorization: "Bearer " + state.token, Accept: "application/json" }
    }).then(function (res) {
      return res.text().then(function (raw) {
        if (!res.ok) return;
        var list = null;
        try { list = raw ? JSON.parse(raw) : []; } catch (e) { list = []; }
        if (!list || !list.length) return;
        for (var i = 0; i < list.length; i++) {
          renderIncomingMessage(list[i]);
        }
      });
    }).catch(function () { /* ignore poll errors */ });
  }

  function apiUrl(path) {
    return cfg.apiBase + path;
  }

  function postJson(path, body, token) {
    var headers = { "Content-Type": "application/json", "Accept": "application/json" };
    if (token) headers.Authorization = "Bearer " + token;
    return fetch(apiUrl(path), {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body || {})
    }).then(function (res) {
      return res.text().then(function (raw) {
        var data = null;
        try { data = raw ? JSON.parse(raw) : null; } catch (e) { data = { message: raw }; }
        if (!res.ok) {
          var msg = (data && (data.message || data.Message)) || (res.status + " " + res.statusText);
          throw new Error(msg);
        }
        return data;
      });
    });
  }

  function ensureSession() {
    if (state.token && state.chatSessionId) {
      setPreChatVisible(false);
      if (!state.hub) {
        connectHub();
        startPolling();
        pollMessages();
      }
      return Promise.resolve();
    }
    if (!cfg.siteKey) {
      return Promise.reject(new Error("Missing data-site-key (format CompanyName|key)."));
    }
    if (!state.preChatDone || !hasVisitorIdentity()) {
      state.preChatDone = false;
      setPreChatVisible(true);
      return Promise.reject(new Error("PRECHAT_REQUIRED"));
    }
    setPreChatVisible(false);
    setConnectionBanner("reconnecting", "Starting chat session...");
    return postJson("/chat/widget/start", {
      siteKey: cfg.siteKey,
      origin: window.location.origin || "*",
      visitorName: (cfg.visitorName || "").trim(),
      visitorEmail: (cfg.visitorEmail || "").trim(),
      visitorPhone: (cfg.visitorPhone || "").trim(),
      phone: (cfg.visitorPhone || "").trim()
    }).then(function (data) {
      state.token = data.accessToken || data.AccessToken;
      state.chatSessionId = data.chatSessionId || data.ChatSessionId;
      state.hubPath = data.hubPath || data.HubPath || "/chathub";
      persistSession(data);
      var mode = data.orchestratorMode || data.OrchestratorMode || "AI";
      setConnectionBanner("connected");
      addMessage("System",
        "Welcome " + (cfg.visitorName || "").trim() + ". Connected to TrackerPro field-service assistance.",
        "tp-msg-system");
      connectHub();
      startPolling();
      pollMessages();
    });
  }

  function upsertStreamMessage(streamId, text) {
    hideTypingIndicator();
    var tempId = "stream-" + streamId;
    var box = document.getElementById("tp-chat-messages");
    if (!box) return;
    var existing = box.querySelector('[data-msg-id="' + tempId + '"]');
    if (existing) {
      var md = existing.querySelector(".tp-md");
      if (md) md.innerHTML = renderMarkdown(text);
      box.scrollTop = box.scrollHeight;
      return;
    }
    var wrap = el("div", "tp-msg tp-msg-ai");
    wrap.setAttribute("data-msg-id", tempId);
    var meta = el("span", "tp-msg-meta");
    meta.textContent = "TrackerPro AI";
    meta.appendChild(el("span", "tp-badge-ai", "AI"));
    wrap.appendChild(meta);
    var body = el("div", "tp-md");
    body.innerHTML = renderMarkdown(text);
    wrap.appendChild(body);
    box.appendChild(wrap);
    box.scrollTop = box.scrollHeight;
  }

  function connectHub() {
    if (!window.TpChatSignalR || !state.token || !window.jQuery) {
      setConnectionBanner("polling", "Live socket unavailable - using polling");
      startPolling();
      return;
    }
    setConnectionBanner("reconnecting", "Connecting to live updates...");
    window.TpChatSignalR.connect({
      apiBase: cfg.apiBase,
      hubPath: state.hubPath || "/chathub",
      accessToken: state.token,
      chatSessionId: state.chatSessionId,
      handlers: {
        onConnectionState: function (change) {
          if (!change) return;
          if (change.state === "connected") {
            setConnectionBanner("connected");
          } else if (change.state === "reconnecting") {
            setConnectionBanner("reconnecting", "Reconnecting to live socket...");
          } else if (change.state === "disconnected") {
            setConnectionBanner("polling", "Live socket disconnected. Checking automatically.");
            startPolling();
          }
        },
        onTyping: function (payload) {
          if (!payload) return;
          var typing = !!(payload.isTyping || payload.IsTyping);
          var name = payload.displayName || payload.DisplayName || "Agent";
          var isAi = !!(payload.isAi || payload.IsAi);
          if (typing) showTypingIndicator(name, isAi);
          else hideTypingIndicator();
        },
        onAssistantDelta: function (payload) {
          if (!payload) return;
          var streamId = payload.streamId || payload.StreamId;
          var delta = payload.delta || payload.Delta || "";
          if (!streamId) return;
          state.streamBuffers[streamId] = (state.streamBuffers[streamId] || "") + delta;
          upsertStreamMessage(streamId, state.streamBuffers[streamId]);
        },
        onAssistantComplete: function (payload) {
          if (!payload) return;
          var streamId = payload.streamId || payload.StreamId;
          var message = payload.message || payload.Message;
          if (streamId) {
            var node = document.querySelector('#tp-chat-messages [data-msg-id="stream-' + streamId + '"]');
            if (node) node.remove();
            delete state.streamBuffers[streamId];
          }
          if (message) renderIncomingMessage(message);
        },
        onReceiveMessage: function (message) {
          renderIncomingMessage(message);
        }
      }
    }).done(function (h) {
      state.hub = h;
      setConnectionBanner("connected");
    }).fail(function () {
      setConnectionBanner("polling", "Live socket unavailable - polling active");
      startPolling();
    });
  }

  function notifyTyping(isTyping) {
    if (!state.hub) return;
    if (isTyping) state.hub.typingStart();
    else state.hub.typingEnd();
  }

  function setBusy(busy) {
    state.busy = busy;
    ["tp-chat-input", "tp-chat-send", "tp-chat-escalate", "tp-chat-header-escalate", "tp-chat-mic", "tp-chat-attach"].forEach(function (id) {
      var node = document.getElementById(id);
      if (node) node.disabled = !!busy;
    });
  }

  function sendMessage(text, attachments) {
    attachments = attachments || [];
    if ((!text && !attachments.length) || state.busy) return;
    setBusy(true);

    addMessage("You", text || ("[Attached " + attachments.length + " file(s)]"), "tp-msg-user", attachments);
    showTypingIndicator("TrackerPro AI", true);

    ensureSession()
      .then(function () {
        return postJson("/chat/message", {
          ChatSessionId: state.chatSessionId,
          Text: text || "",
          Attachments: attachments
        }, state.token);
      })
      .then(function (data) {
        var assistant = data.assistantMessage || data.AssistantMessage;
        if (assistant) {
          renderIncomingMessage(assistant);
        } else {
          pollMessages();
        }
      })
      .catch(function (err) {
        hideTypingIndicator();
        addMessage("System", "Error: " + (err && err.message ? err.message : err), "tp-msg-system");
      })
      .then(function () {
        setBusy(false);
        var input = document.getElementById("tp-chat-input");
        if (input) input.focus();
      });
  }

  function uploadFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;

    ensureSession().then(function () {
      files.forEach(function (file) {
        if (window.TpChatRich && typeof window.TpChatRich.isAllowedFile === "function" && !window.TpChatRich.isAllowedFile(file)) {
          addMessage("System", "Only JPEG, PNG or PDF files are allowed.", "tp-msg-system");
          return;
        }
        var fd = new FormData();
        fd.append("chatSessionId", String(state.chatSessionId));
        fd.append("file", file);
        fetch(apiUrl("/chat/attachment"), {
          method: "POST",
          headers: { Authorization: "Bearer " + state.token },
          body: fd
        }).then(function (res) {
          return res.text().then(function (raw) {
            var data = null;
            try { data = raw ? JSON.parse(raw) : null; } catch (e) { data = null; }
            if (!res.ok) throw new Error((data && (data.message || data.Message)) || "Upload failed");
            return data;
          });
        }).then(function (dto) {
          state.pendingAttachments.push({
            AttachmentId: dto.AttachmentId || dto.attachmentId,
            Name: dto.Name || dto.name,
            ContentType: dto.ContentType || dto.contentType,
            SizeBytes: dto.SizeBytes || dto.sizeBytes || 0,
            BlobPath: dto.BlobPath || dto.blobPath,
            DownloadUrl: dto.DownloadUrl || dto.downloadUrl
          });
          refreshPending();
        }).catch(function (err) {
          addMessage("System", "Attachment upload failed: " + (err && err.message ? err.message : err), "tp-msg-system");
        });
      });
    }).catch(function (err) {
      addMessage("System", "Could not attach file: " + (err && err.message ? err.message : err), "tp-msg-system");
    });
  }

  function bindWidgetVoiceDictation(input, micBtn) {
    if (!input || !micBtn) return;
    if (micBtn.getAttribute("data-tp-stt-bound")) return;
    if (!window.TpChatRich || typeof window.TpChatRich.bindVoiceDictation !== "function") {
      micBtn.disabled = true;
      micBtn.title = "Voice dictation is not supported in this browser";
      return;
    }
    window.TpChatRich.bindVoiceDictation(input, micBtn, {
      lang: "en-GB",
      onUnsupported: function () {
        addMessage("System", "Speech-to-text is not supported in this browser. Try Chrome or Edge.", "tp-msg-system");
      },
      onError: function (err) {
        if (err === "not-allowed" || err === "service-not-allowed") {
          addMessage("System", "Microphone access denied. Allow permission and try again.", "tp-msg-system");
        }
      }
    });
    micBtn.setAttribute("data-tp-stt-bound", "1");
  }

  function escalate() {
    if (!state.token || !state.chatSessionId || state.busy) return;
    setBusy(true);
    postJson("/chat/escalate", {
      ChatSessionId: state.chatSessionId,
      Reason: "Visitor requested a human from chat widget"
    }, state.token)
      .then(function () {
        addMessage("System", "Queued for a human dispatcher. Keep this window open for their reply.", "tp-msg-system");
        startPolling();
        pollMessages();
        if (state.hub && state.hub.joinSession) {
          state.hub.joinSession(state.chatSessionId);
        } else {
          connectHub();
        }
      })
      .catch(function (err) {
        addMessage("System", "Escalate failed: " + (err && err.message ? err.message : err), "tp-msg-system");
      })
      .then(function () { setBusy(false); });
  }

  function endChat() {
    if (!state.token || !state.chatSessionId || state.busy) return;
    if (!window.confirm("End this conversation?")) return;

    setBusy(true);
    postJson("/chat/session/end", {
      ChatSessionId: state.chatSessionId,
      Reason: "Visitor ended chat from widget"
    }, state.token)
      .then(function () {
        addMessage("System", "Chat ended. You can start a new conversation anytime.", "tp-msg-system");
        if (state.pollTimer) {
          clearInterval(state.pollTimer);
          state.pollTimer = null;
        }
        if (state.hub && typeof state.hub.stop === "function") {
          try { state.hub.stop(); } catch (e) { /* ignore */ }
        }
        state.hub = null;
        state.token = null;
        state.chatSessionId = null;
        state.preChatDone = false;
        state.pendingAttachments = [];
        state.renderedIds = {};
        clearPersistedSession();
        refreshPending();
      })
      .catch(function (err) {
        addMessage("System", "Could not end chat: " + (err && err.message ? err.message : err), "tp-msg-system");
      })
      .then(function () { setBusy(false); });
  }

  function beginChatFlow() {
    ensureSession().catch(function (err) {
      if (err && err.message === "PRECHAT_REQUIRED") return;
      addMessage("System", "Start failed: " + (err && err.message ? err.message : err), "tp-msg-system");
      setConnectionBanner("disconnected", "Failed to start chat.");
    });
  }

  function submitPreChat() {
    var nameInput = document.getElementById("tp-prechat-name");
    var emailInput = document.getElementById("tp-prechat-email");
    var phoneInput = document.getElementById("tp-prechat-phone");
    var name = nameInput ? nameInput.value.trim() : "";
    var email = emailInput ? emailInput.value.trim() : "";
    var phone = phoneInput ? phoneInput.value.trim() : "";
    showPreChatError("");
    if (!name) {
      showPreChatError("Please enter your name.");
      if (nameInput) nameInput.focus();
      return;
    }
    if (!email || email.indexOf("@") < 1) {
      showPreChatError("Please enter a valid email address.");
      if (emailInput) emailInput.focus();
      return;
    }

    cfg.visitorName = name;
    cfg.visitorEmail = email;
    cfg.visitorPhone = phone;
    state.preChatDone = true;
    var startBtn = document.getElementById("tp-chat-prechat-start");
    if (startBtn) startBtn.disabled = true;

    ensureSession()
      .then(function () {
        var input = document.getElementById("tp-chat-input");
        if (input) {
          setTimeout(function () {
            input.focus();
            autosizeInput(input);
          }, 50);
        }
      })
      .catch(function (err) {
        state.preChatDone = false;
        if (err && err.message === "PRECHAT_REQUIRED") return;
        showPreChatError(err && err.message ? err.message : "Could not start chat.");
      })
      .then(function () {
        if (startBtn) startBtn.disabled = false;
      });
  }

  function buildUi() {
    injectStylesheet();

    // Launcher button
    var launcher = el("button");
    launcher.id = "tp-chat-launcher";
    launcher.type = "button";
    launcher.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>'
      + '<span>' + escapeHtml(cfg.title) + '</span>';

    // Main window panel
    var panel = el("div");
    panel.id = "tp-chat-panel";

    // Mobile drag bar
    var dragHandle = el("div", "tp-drag-handle");
    panel.appendChild(dragHandle);

    // Header
    var header = el("div");
    header.id = "tp-chat-header";

    var headerLeft = el("div", "tp-header-left");
    var avatar = el("div", "tp-header-avatar");
    if (cfg.logoUrl) {
      avatar.innerHTML = '<img src="' + escapeHtml(cfg.logoUrl) + '" alt="Logo" />';
    } else {
      avatar.textContent = "TP";
    }
    headerLeft.appendChild(avatar);

    var headerInfo = el("div", "tp-header-info");
    headerInfo.appendChild(el("span", "tp-header-title", cfg.title));

    var headerStatus = el("span", "tp-header-status");
    var statusDot = el("span", "tp-header-status-dot");
    statusDot.id = "tp-chat-status-dot";
    headerStatus.appendChild(statusDot);
    var statusText = el("span", null, "Live · AI Assistant");
    statusText.id = "tp-chat-header-status-text";
    headerStatus.appendChild(statusText);
    headerInfo.appendChild(headerStatus);
    headerLeft.appendChild(headerInfo);
    header.appendChild(headerLeft);

    var headerActions = el("div", "tp-header-actions");
    var escalateHeaderBtn = el("button", "tp-header-escalate-btn", "Human");
    escalateHeaderBtn.id = "tp-chat-header-escalate";
    escalateHeaderBtn.type = "button";
    escalateHeaderBtn.title = "Talk to a person";
    headerActions.appendChild(escalateHeaderBtn);

    var closeBtn = el("button", "tp-header-btn");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Close chat");
    closeBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
    headerActions.appendChild(closeBtn);
    header.appendChild(headerActions);

    // Connection state banner
    var connBanner = el("div");
    connBanner.id = "tp-chat-conn-banner";

    // Pre-chat form
    var prechat = el("div");
    prechat.id = "tp-chat-prechat";
    prechat.innerHTML = '<span class="tp-prechat-badge">Field Service Support</span>'
      + '<h3>Start a conversation</h3>'
      + '<p>Share your contact details so our dispatch team can locate your account and follow up if needed.</p>';

    var preForm = el("form");
    preForm.id = "tp-chat-prechat-form";
    function field(id, labelText, type, autocomplete) {
      var wrap = el("div", "tp-field");
      var lab = el("label", null, labelText);
      lab.setAttribute("for", id);
      var inp = document.createElement("input");
      inp.id = id;
      inp.type = type || "text";
      inp.autocomplete = autocomplete || "on";
      wrap.appendChild(lab);
      wrap.appendChild(inp);
      return wrap;
    }
    preForm.appendChild(field("tp-prechat-name", "Your name *", "text", "name"));
    preForm.appendChild(field("tp-prechat-email", "Email address *", "email", "email"));
    preForm.appendChild(field("tp-prechat-phone", "Phone number (optional)", "tel", "tel"));
    var preErr = el("div");
    preErr.id = "tp-chat-prechat-error";
    preForm.appendChild(preErr);
    var preStart = el("button", null, "Start Chat");
    preStart.id = "tp-chat-prechat-start";
    preStart.type = "submit";
    preForm.appendChild(preStart);
    prechat.appendChild(preForm);

    // Message stream
    var messages = el("div");
    messages.id = "tp-chat-messages";

    // Quick Action Chips (Next visit / Open jobs / Talk to a person)
    var chips = el("div");
    chips.id = "tp-chat-chips";

    var chipConfigs = [
      {
        label: "Next visit",
        icon: '<svg viewBox="0 0 24 24"><path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zm0-12H5V6h14v2z"/></svg>',
        intentMessage: "When is our next scheduled engineer visit?"
      },
      {
        label: "Open jobs",
        icon: '<svg viewBox="0 0 24 24"><path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"/></svg>',
        intentMessage: "What are the open jobs or service calls for this site?"
      },
      {
        label: "Talk to a person",
        icon: '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>',
        action: "escalate"
      }
    ];

    chipConfigs.forEach(function (c) {
      var chipBtn = el("button", "tp-chip");
      chipBtn.type = "button";
      chipBtn.innerHTML = c.icon + "<span>" + escapeHtml(c.label) + "</span>";
      chipBtn.addEventListener("click", function () {
        if (c.action === "escalate") {
          escalate();
        } else {
          sendMessage(c.intentMessage);
        }
      });
      chips.appendChild(chipBtn);
    });

    // Pending attachments
    var pending = el("div");
    pending.id = "tp-chat-pending";

    // Composer
    var composer = el("div");
    composer.id = "tp-chat-composer";

    var toolbar = el("div");
    toolbar.id = "tp-chat-toolbar";

    var mic = el("button", "tp-tool-btn");
    mic.id = "tp-chat-mic";
    mic.type = "button";
    mic.title = "Voice dictation (speech to text)";
    mic.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z"/></svg><span>Mic</span>';

    var attach = el("button", "tp-tool-btn");
    attach.id = "tp-chat-attach";
    attach.type = "button";
    attach.title = "Attach photo or document (max 10MB)";
    attach.innerHTML = '<svg viewBox="0 0 24 24"><path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/></svg><span>Attach</span>';

    var endBtn = el("button", "tp-tool-btn tp-tool-end", "End");
    endBtn.id = "tp-chat-end";
    endBtn.type = "button";
    endBtn.title = "End this conversation";

    var file = document.createElement("input");
    file.type = "file";
    file.id = "tp-chat-file";
    file.multiple = true;
    file.accept = "image/jpeg,image/png,image/jpg,.jpg,.jpeg,.png,application/pdf,.pdf";
    file.style.display = "none";

    toolbar.appendChild(mic);
    toolbar.appendChild(attach);
    toolbar.appendChild(endBtn);
    toolbar.appendChild(file);

    var form = el("form");
    form.id = "tp-chat-form";

    var inputWrap = el("div");
    inputWrap.id = "tp-chat-input-wrap";

    var input = document.createElement("textarea");
    input.id = "tp-chat-input";
    input.rows = 1;
    input.placeholder = "Type a message... Paste a screenshot, or attach JPEG/PNG/PDF";
    input.setAttribute("aria-label", "Chat message");
    input.autocomplete = "off";

    var send = el("button", null);
    send.id = "tp-chat-send";
    send.type = "submit";
    send.setAttribute("aria-label", "Send message");
    send.innerHTML = '<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';

    inputWrap.appendChild(input);
    inputWrap.appendChild(send);

    var hint = el("p", null, "Enter to send · Shift+Enter for new line · Paste screenshots · **bold** *italic*");
    hint.id = "tp-chat-hint";

    var fmtHost = el("div");
    fmtHost.id = "tp-chat-fmt-host";
    fmtHost.className = "tp-chat-fmt-host";

    form.appendChild(fmtHost);
    form.appendChild(inputWrap);
    form.appendChild(hint);

    composer.appendChild(toolbar);
    composer.appendChild(form);

    function loadTpChatRich(cb) {
      if (window.TpChatRich) { cb(); return; }
      var s = document.createElement("script");
      s.src = scriptBase + "tp-chat-rich.js";
      s.onload = function () { cb(); };
      s.onerror = function () { cb(); };
      document.head.appendChild(s);
    }

    loadTpChatRich(function () {
      if (!window.TpChatRich) {
        bindWidgetVoiceDictation(input, mic);
        return;
      }
      if (window.TpChatRich.ACCEPT) file.accept = window.TpChatRich.ACCEPT;
      if (!fmtHost.hasChildNodes()) {
        fmtHost.appendChild(window.TpChatRich.buildFormatToolbar(input, "tp-chat-fmt"));
      }
      window.TpChatRich.bindPasteScreenshots(input, function (files) {
        uploadFiles(files);
      });
      bindWidgetVoiceDictation(input, mic);
    });

    panel.appendChild(header);
    panel.appendChild(connBanner);
    panel.appendChild(prechat);
    panel.appendChild(messages);
    panel.appendChild(chips);
    panel.appendChild(pending);
    panel.appendChild(composer);

    document.body.appendChild(launcher);
    document.body.appendChild(panel);

    function submitComposer() {
      var text = (input.value || "").trim();
      var atts = state.pendingAttachments.splice(0, state.pendingAttachments.length);
      refreshPending();
      if (!text && !atts.length) return;
      input.value = "";
      autosizeInput(input);
      notifyTyping(false);
      sendMessage(text, atts);
    }

    function toggle(open) {
      state.open = open !== undefined ? open : !state.open;
      if (state.open) {
        panel.classList.add("tp-open");
        beginChatFlow();
        if (state.token && state.chatSessionId) {
          setTimeout(function () {
            input.focus();
            autosizeInput(input);
          }, 50);
        }
      } else {
        panel.classList.remove("tp-open");
      }
    }

    launcher.addEventListener("click", function () { toggle(); });
    closeBtn.addEventListener("click", function () { toggle(false); });
    escalateHeaderBtn.addEventListener("click", escalate);
    preForm.addEventListener("submit", function (e) {
      e.preventDefault();
      submitPreChat();
    });
    endBtn.addEventListener("click", endChat);
    attach.addEventListener("click", function () { file.click(); });
    file.addEventListener("change", function () {
      uploadFiles(file.files);
      file.value = "";
    });
    input.addEventListener("input", function () {
      autosizeInput(input);
      notifyTyping(true);
      if (state.typingTimer) clearTimeout(state.typingTimer);
      state.typingTimer = setTimeout(function () { notifyTyping(false); }, 1200);
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submitComposer();
      }
    });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      submitComposer();
    });
    autosizeInput(input);
  }

  function boot() {
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", boot);
      return;
    }
    buildUi();
  }

  window.TrackerProChatWidget = {
    config: cfg,
    start: function () { return ensureSession(); },
    send: sendMessage,
    escalate: escalate,
    end: endChat
  };

  boot();
})(window, document);
