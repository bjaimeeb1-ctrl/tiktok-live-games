(() => {
  "use strict";

  // The base engine emits reset/food events from its constructor. The game callback
  // reads the engine instance, which is not assigned until construction finishes.
  // Wrap the engine so constructor-time events are silenced, then restore the real
  // callback immediately afterward.
  const BaseSnakeEngine = window.SnakeEngine;

  window.SnakeEngine = class SafeSnakeEngine extends BaseSnakeEngine {
    constructor(options = {}) {
      const onEvent = typeof options.onEvent === "function" ? options.onEvent : () => {};
      super({ ...options, onEvent: () => {} });
      this.onEvent = onEvent;
    }
  };
})();
