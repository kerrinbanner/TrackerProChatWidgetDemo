/**
 * Minimal Classic SignalR helper for TrackerPro AI chat (depends on jQuery + jquery.signalR).
 * Connects to Rest API hub at {apiBase}{hubPath} with access_token query string.
 * Supports live typing, streaming assistant deltas, message receipts, and connection state events.
 */
(function (window, $) {
  "use strict";

  function connectChatHub(options) {
    options = options || {};
    var apiBase = String(options.apiBase || "").replace(/\/+$/, "");
    var hubPath = options.hubPath || "/chathub";
    if (hubPath.charAt(0) !== "/") hubPath = "/" + hubPath;
    var token = options.accessToken || "";
    var chatSessionId = options.chatSessionId;
    var handlers = options.handlers || {};

    if (!token || !apiBase || typeof $.hubConnection !== "function") {
      return $.Deferred().reject("SignalR not available").promise();
    }

    var hubUrl = apiBase + hubPath;
    var connection = $.hubConnection(hubUrl, {
      qs: { access_token: token },
      useDefaultPath: false
    });
    var hub = connection.createHubProxy("chatHub");

    function notifyState(state, info) {
      if (handlers.onConnectionState) {
        try {
          handlers.onConnectionState({ state: state, info: info });
        } catch (e) { /* ignore handler errors */ }
      }
    }

    // Connection lifecycle listeners for UI banner
    connection.stateChanged(function (change) {
      // 0 = connecting, 1 = connected, 2 = reconnecting, 4 = disconnected
      var stateNames = { 0: "connecting", 1: "connected", 2: "reconnecting", 4: "disconnected" };
      var name = stateNames[change.newState] || "unknown";
      notifyState(name, change);
    });

    connection.reconnecting(function () {
      notifyState("reconnecting");
    });

    connection.reconnected(function () {
      notifyState("connected");
      if (chatSessionId) {
        try { hub.invoke("JoinSession", chatSessionId); } catch (e) { /* ignore */ }
      }
    });

    connection.disconnected(function () {
      notifyState("disconnected");
    });

    // Hub method listeners
    hub.on("typing", function (payload) {
      if (handlers.onTyping) handlers.onTyping(payload);
    });
    hub.on("Typing", function (payload) {
      if (handlers.onTyping) handlers.onTyping(payload);
    });
    hub.on("assistantDelta", function (payload) {
      if (handlers.onAssistantDelta) handlers.onAssistantDelta(payload);
    });
    hub.on("AssistantDelta", function (payload) {
      if (handlers.onAssistantDelta) handlers.onAssistantDelta(payload);
    });
    hub.on("assistantComplete", function (payload) {
      if (handlers.onAssistantComplete) handlers.onAssistantComplete(payload);
    });
    hub.on("AssistantComplete", function (payload) {
      if (handlers.onAssistantComplete) handlers.onAssistantComplete(payload);
    });
    hub.on("receiveMessage", function (payload) {
      if (handlers.onReceiveMessage) handlers.onReceiveMessage(payload);
    });
    hub.on("ReceiveMessage", function (payload) {
      if (handlers.onReceiveMessage) handlers.onReceiveMessage(payload);
    });

    return connection.start().then(function () {
      notifyState("connected");
      if (chatSessionId) {
        return hub.invoke("JoinSession", chatSessionId);
      }
    }).then(function () {
      return {
        connection: connection,
        hub: hub,
        chatSessionId: chatSessionId,
        joinSession: function (id) {
          chatSessionId = id;
          this.chatSessionId = id;
          if (!id) return $.Deferred().resolve().promise();
          return hub.invoke("JoinSession", id);
        },
        typingStart: function () {
          if (!chatSessionId) return;
          return hub.invoke("TypingStart", chatSessionId);
        },
        typingEnd: function () {
          if (!chatSessionId) return;
          return hub.invoke("TypingEnd", chatSessionId);
        },
        stop: function () {
          try { connection.stop(); } catch (e) { /* ignore */ }
        }
      };
    });
  }

  window.TpChatSignalR = { connect: connectChatHub };
})(window, window.jQuery);
