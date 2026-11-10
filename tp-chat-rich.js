/**
 * TrackerPro chat rich content helpers (shared pattern for widget / Admin / Customer).
 * - Safe markdown render (bold, italic, code, links, lists)
 * - Image vs PDF attachment helpers
 * - Clipboard paste (screenshots) -> File for upload
 * Allowed uploads: JPEG, PNG, PDF (matches Chat API guardrails).
 */
(function (global) {
  "use strict";

  var ACCEPT = "image/jpeg,image/png,image/jpg,.jpg,.jpeg,.png,application/pdf,.pdf";

  function escapeHtml(text) {
    return String(text == null ? "" : text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderMarkdown(text) {
    var html = escapeHtml(text || "");
    html = html.replace(/```([\s\S]*?)```/g, function (_, code) {
      return '<pre class="tp-md-code"><code>' + code + "</code></pre>";
    });
    html = html.replace(/`([^`]+)`/g, '<code class="tp-md-inline">$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>");
    html = html.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );
    html = html.replace(/(?:^|\n)[-*] (.+)/g, "<br>&bull; $1");
    html = html.replace(/\n/g, "<br>");
    return html;
  }

  function isImageAttachment(a) {
    if (!a) return false;
    var ct = String(a.ContentType || a.contentType || "").toLowerCase();
    var name = String(a.Name || a.name || "").toLowerCase();
    if (ct.indexOf("image/") === 0) return true;
    return /\.(jpe?g|png)$/i.test(name);
  }

  function isAllowedFile(file) {
    if (!file) return false;
    var name = (file.name || "").toLowerCase();
    var type = (file.type || "").toLowerCase();
    if (/\.(jpe?g|png|pdf)$/i.test(name)) return true;
    if (type === "image/jpeg" || type === "image/png" || type === "image/jpg" || type === "application/pdf")
      return true;
    return false;
  }

  function fileFromClipboardItem(item) {
    if (!item || item.kind !== "file") return null;
    var type = item.type || "";
    if (type.indexOf("image/") !== 0) return null;
    var blob = item.getAsFile();
    if (!blob) return null;
    var ext = type.indexOf("png") >= 0 ? "png" : "jpg";
    var name = "screenshot-" + new Date().toISOString().replace(/[:.]/g, "-") + "." + ext;
    if (typeof File !== "undefined") {
      try {
        return new File([blob], name, { type: type || "image/png" });
      } catch (e) { /* IE / older */ }
    }
    blob.name = name;
    return blob;
  }

  /**
   * Bind paste on an input/textarea: clipboard images become Files and are passed to onFiles(FileList-like).
   */
  function bindPasteScreenshots(inputEl, onFiles) {
    if (!inputEl || typeof onFiles !== "function") return;
    inputEl.addEventListener("paste", function (ev) {
      var cd = ev.clipboardData || (ev.originalEvent && ev.originalEvent.clipboardData);
      if (!cd || !cd.items) return;
      var files = [];
      for (var i = 0; i < cd.items.length; i++) {
        var f = fileFromClipboardItem(cd.items[i]);
        if (f && isAllowedFile(f)) files.push(f);
      }
      if (!files.length) return;
      ev.preventDefault();
      onFiles(files);
    });
  }

  /**
   * Optional format toolbar: wraps selection in markdown markers (*bold*, _italic_ uses ** / *).
   */
  function wrapSelection(textarea, before, after) {
    if (!textarea) return;
    var start = textarea.selectionStart || 0;
    var end = textarea.selectionEnd || 0;
    var val = textarea.value || "";
    var selected = val.substring(start, end) || "text";
    var next = val.substring(0, start) + before + selected + after + val.substring(end);
    textarea.value = next;
    var cursor = start + before.length + selected.length + after.length;
    textarea.focus();
    if (textarea.setSelectionRange) textarea.setSelectionRange(cursor, cursor);
  }

  function buildFormatToolbar(textarea, classPrefix) {
    var p = classPrefix || "tp-fmt";
    var bar = document.createElement("div");
    bar.className = p + "-toolbar";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Text formatting");

    function btn(label, title, before, after) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = p + "-btn";
      b.title = title;
      b.textContent = label;
      b.addEventListener("click", function (e) {
        e.preventDefault();
        wrapSelection(textarea, before, after);
      });
      return b;
    }

    bar.appendChild(btn("B", "Bold", "**", "**"));
    bar.appendChild(btn("I", "Italic", "*", "*"));
    bar.appendChild(btn("</>", "Inline code", "`", "`"));
    bar.appendChild(btn("List", "Bullet list", "\n- ", ""));
    return bar;
  }

  function isSpeechSupported() {
    return !!(global.SpeechRecognition || global.webkitSpeechRecognition);
  }

  function joinSpoken(base, spoken) {
    base = base || "";
    spoken = String(spoken || "").replace(/^\s+|\s+$/g, "");
    if (!spoken) return base;
    if (!base) return spoken;
    return base + (/[\s\n]$/.test(base) ? "" : " ") + spoken;
  }

  /**
   * Mic toggle: speak and append transcript into inputEl (live interim + final).
   * options: { lang, titleIdle, onUnsupported, onError }
   * Returns { start, stop, toggle, isListening, supported } or null.
   */
  function bindVoiceDictation(inputEl, micBtn, options) {
    options = options || {};
    var SpeechRecognition = global.SpeechRecognition || global.webkitSpeechRecognition;
    var idleTitle = options.titleIdle || "Voice dictation - click to speak";
    if (!SpeechRecognition || !inputEl || !micBtn) {
      if (micBtn) {
        micBtn.disabled = true;
        micBtn.setAttribute("aria-disabled", "true");
        micBtn.title = "Voice dictation is not supported in this browser";
      }
      if (typeof options.onUnsupported === "function") options.onUnsupported();
      return null;
    }

    var lang = options.lang || "en-GB";
    var wantListen = false;
    var recognition = null;
    var baseSnapshot = "";

    function setListeningUi(on) {
      if (on) {
        micBtn.classList.add("tp-mic-active");
        micBtn.setAttribute("aria-pressed", "true");
        micBtn.title = "Listening - click to stop";
      } else {
        micBtn.classList.remove("tp-mic-active");
        micBtn.setAttribute("aria-pressed", "false");
        micBtn.title = idleTitle;
      }
    }

    function fireInput() {
      if (typeof inputEl.dispatchEvent === "function") {
        try {
          inputEl.dispatchEvent(new Event("input", { bubbles: true }));
        } catch (e) {
          try {
            var ev = document.createEvent("Event");
            ev.initEvent("input", true, true);
            inputEl.dispatchEvent(ev);
          } catch (e2) { /* ignore */ }
        }
      }
    }

    function stop() {
      wantListen = false;
      if (recognition) {
        try { recognition.onend = null; } catch (e) { /* ignore */ }
        try { recognition.stop(); } catch (e2) { /* ignore */ }
        recognition = null;
      }
      setListeningUi(false);
    }

    function start() {
      if (wantListen) return;
      wantListen = true;
      baseSnapshot = inputEl.value || "";
      recognition = new SpeechRecognition();
      recognition.lang = lang;
      recognition.interimResults = true;
      recognition.continuous = true;

      recognition.onstart = function () {
        setListeningUi(true);
      };
      recognition.onend = function () {
        if (wantListen) {
          try {
            recognition.start();
            return;
          } catch (e) {
            wantListen = false;
          }
        }
        recognition = null;
        setListeningUi(false);
      };
      recognition.onerror = function (ev) {
        var err = (ev && ev.error) || "";
        if (err === "aborted" || err === "no-speech") return;
        wantListen = false;
        recognition = null;
        setListeningUi(false);
        if (typeof options.onError === "function") options.onError(err);
      };
      recognition.onresult = function (ev) {
        var finals = "";
        var interim = "";
        for (var i = ev.resultIndex; i < ev.results.length; i++) {
          var r = ev.results[i];
          var piece = (r[0] && r[0].transcript) || "";
          if (r.isFinal) finals += piece;
          else interim += piece;
        }
        if (finals) baseSnapshot = joinSpoken(baseSnapshot, finals);
        inputEl.value = joinSpoken(baseSnapshot, interim);
        fireInput();
        inputEl.focus();
      };

      try {
        recognition.start();
        setListeningUi(true);
      } catch (e) {
        wantListen = false;
        recognition = null;
        setListeningUi(false);
        if (typeof options.onError === "function") options.onError("start-failed");
      }
    }

    function toggle() {
      if (wantListen) stop();
      else start();
    }

    micBtn.setAttribute("aria-pressed", "false");
    micBtn.title = idleTitle;
    micBtn.addEventListener("click", function (e) {
      e.preventDefault();
      toggle();
    });

    return {
      start: start,
      stop: stop,
      toggle: toggle,
      isListening: function () { return wantListen; },
      supported: true
    };
  }

  global.TpChatRich = {
    ACCEPT: ACCEPT,
    escapeHtml: escapeHtml,
    renderMarkdown: renderMarkdown,
    isImageAttachment: isImageAttachment,
    isAllowedFile: isAllowedFile,
    bindPasteScreenshots: bindPasteScreenshots,
    wrapSelection: wrapSelection,
    buildFormatToolbar: buildFormatToolbar,
    isSpeechSupported: isSpeechSupported,
    bindVoiceDictation: bindVoiceDictation
  };
})(typeof window !== "undefined" ? window : this);
