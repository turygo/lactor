/**
 * Playback state machine — pure logic, no DOM/Audio/WS dependencies.
 *
 * States: idle, loading, playing, paused, error
 * Events: play, buffered, pause, resume, ended, finished, cancel, jump, error, retry
 *
 * @param {object} deps
 * @param {number} deps.paragraphCount — total number of paragraphs
 * @param {object} [deps.log] — logger with .warn() method
 * @returns {PlaybackState}
 */
export function createPlaybackState({ paragraphCount, log } = {}) {
  const _log = log || { warn() {} };

  // ── State ─────────────────────────────────────────────────────
  let _state = "idle";
  let _currentIndex = 0;
  let _targetIndex = null;
  let _paragraphCount = paragraphCount || 0;

  // ── Event listeners ───────────────────────────────────────────
  const _listeners = new Map();

  // ── Transition table ──────────────────────────────────────────
  // { [currentState]: { [event]: nextState } }
  const _transitions = {
    idle: { play: "loading" },
    loading: { buffered: "playing", error: "error", cancel: "idle" },
    playing: {
      pause: "paused",
      ended: "loading",
      finished: "idle",
      cancel: "idle",
      jump: "loading",
    },
    paused: { resume: "playing", cancel: "idle", jump: "loading" },
    error: { retry: "loading", cancel: "idle" },
  };

  // Index side-effects per transition event — single source of truth
  // for how transitions affect _currentIndex and _targetIndex.
  const _effects = {
    cancel: () => {
      _targetIndex = null;
    },
    finished: () => {
      _currentIndex = 0;
      _targetIndex = null;
    },
  };

  // ── Core API ──────────────────────────────────────────────────

  function transition(event) {
    const allowed = _transitions[_state];
    if (!allowed || !(event in allowed)) {
      _log.warn(`invalid transition: ${_state} --${event}-->`);
      return false;
    }
    const from = _state;
    _state = allowed[event];

    const effect = _effects[event];
    if (effect) effect();

    _emit("stateChange", {
      from,
      to: _state,
      event,
      currentIndex: _currentIndex,
      targetIndex: _targetIndex,
    });
    return true;
  }

  /**
   * Navigate to a specific paragraph.
   * Sets targetIndex, then delegates to the appropriate transition.
   * advanceIndex() will later consume targetIndex to set currentIndex.
   */
  function goTo(index) {
    if (index < 0 || index >= _paragraphCount) {
      _log.warn(`goTo: index ${index} out of range [0, ${_paragraphCount})`);
      return false;
    }

    _targetIndex = index;

    if (_state === "idle") return transition("play");
    if (_state === "playing" || _state === "paused") return transition("jump");

    // Already loading — just retarget without state change
    if (_state === "loading") {
      _emit("stateChange", {
        from: "loading",
        to: "loading",
        event: "retarget",
        currentIndex: _currentIndex,
        targetIndex: _targetIndex,
      });
      return true;
    }

    _log.warn(`goTo: ignored in state ${_state}`);
    return false;
  }

  /**
   * Advance to the next segment.
   * Consumes targetIndex (from goTo) if set, otherwise increments sequentially.
   * Returns true if the new index is within bounds.
   */
  function advanceIndex() {
    if (_targetIndex !== null) {
      _currentIndex = _targetIndex;
      _targetIndex = null;
    } else {
      _currentIndex++;
    }

    const changed = _currentIndex < _paragraphCount;
    _emit("segmentChange", { index: _currentIndex });
    return changed;
  }

  // ── Event emitter ─────────────────────────────────────────────

  function on(event, cb) {
    if (!_listeners.has(event)) _listeners.set(event, []);
    _listeners.get(event).push(cb);
    return () => {
      const arr = _listeners.get(event);
      if (arr) {
        const idx = arr.indexOf(cb);
        if (idx !== -1) arr.splice(idx, 1);
      }
    };
  }

  function _emit(event, data) {
    const cbs = _listeners.get(event);
    if (cbs) cbs.forEach((cb) => cb(data));
  }

  // ── Getters ───────────────────────────────────────────────────

  return {
    get state() {
      return _state;
    },
    get currentIndex() {
      return _currentIndex;
    },
    get targetIndex() {
      return _targetIndex;
    },
    get paragraphCount() {
      return _paragraphCount;
    },
    set paragraphCount(n) {
      _paragraphCount = n;
    },
    get isPlaying() {
      return _state === "playing";
    },
    get isLoading() {
      return _state === "loading";
    },
    get current() {
      return { state: _state, currentIndex: _currentIndex, targetIndex: _targetIndex };
    },
    transition,
    goTo,
    advanceIndex,
    on,
  };
}
