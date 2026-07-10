const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

/**
 * 建立最小化 script DOM。
 * 時間／空間複雜度 O(s)，s 為測試期間建立的 script 數。
 *
 * 替代方案比較：完整瀏覽器測試可驗證真實 DOM，但本測試只需要驗證載入狀態機；
 * 使用小型 fake DOM 能更快覆蓋逾時、錯過 load 與重試等難以穩定重現的分支。
 */
function createHarness() {
  const scripts = new Map();
  const appended = [];
  const domListeners = new Map();

  function createScript() {
    const listeners = new Map();
    const script = {
      src: "",
      async: false,
      dataset: {},
      removed: false,
      addEventListener(type, listener, options = {}) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push({ listener, once: Boolean(options.once) });
      },
      emit(type) {
        const entries = [...(listeners.get(type) || [])];
        const retained = [];
        entries.forEach((entry) => {
          entry.listener.call(script, { type, target: script });
          if (!entry.once) retained.push(entry);
        });
        listeners.set(type, retained);
      },
      remove() {
        script.removed = true;
        const marker = script.dataset.mainAsset;
        if (marker && scripts.get(marker) === script) scripts.delete(marker);
      },
    };
    return script;
  }

  const document = {
    head: {
      appendChild(script) {
        appended.push(script);
        const marker = script.dataset.mainAsset;
        if (marker) scripts.set(marker, script);
        return script;
      },
    },
    createElement(tagName) {
      if (String(tagName).toLowerCase() !== "script") {
        throw new Error(`unexpected element: ${tagName}`);
      }
      return createScript();
    },
    querySelector(selector) {
      const match = String(selector).match(/^script\[data-main-asset="(.+)"\]$/);
      if (match) return scripts.get(match[1]) || null;
      return null;
    },
    addEventListener(type, listener) {
      domListeners.set(type, listener);
    },
    getElementById() {
      return null;
    },
  };

  const quietConsole = {
    log() {},
    warn() {},
    error() {},
  };

  const window = {
    document,
    location: { pathname: "/index.html" },
    setTimeout,
    clearTimeout,
    queueMicrotask,
  };

  const context = vm.createContext({
    window,
    document,
    console: quietConsole,
    Promise,
    Map,
    Object,
    String,
    Number,
    Boolean,
    Math,
    Error,
    setTimeout,
    clearTimeout,
    queueMicrotask,
  });

  const source = fs.readFileSync(path.resolve(__dirname, "../JS/main.js"), "utf8");
  vm.runInContext(source, context, { filename: "JS/main.js" });

  return {
    runtime: window.EvanMainRuntime,
    scripts,
    appended,
    createScript,
  };
}

(function testConcurrentSuccess() {
  const harness = createHarness();
  let ready = false;

  const first = harness.runtime.loadScriptOnce({
    src: "module-a.js",
    marker: "module-a",
    isReady: () => ready,
    timeoutMs: 100,
  });
  const second = harness.runtime.loadScriptOnce({
    src: "module-a.js",
    marker: "module-a",
    isReady: () => ready,
    timeoutMs: 100,
  });

  assert.strictEqual(first, second);
  assert.equal(harness.appended.length, 1);
  assert.equal(harness.scripts.get("module-a").dataset.loadState, "loading");

  ready = true;
  harness.scripts.get("module-a").emit("load");

  return Promise.all([first, second]).then((results) => {
    assert.deepEqual(results, [true, true]);
    assert.equal(harness.scripts.get("module-a").dataset.loadState, "loaded");
  });
})();

async function testFailureThenRetry() {
  const harness = createHarness();
  let ready = false;

  const first = harness.runtime.loadScriptOnce({
    src: "module-b.js",
    marker: "module-b",
    isReady: () => ready,
    timeoutMs: 100,
  });
  const failedScript = harness.scripts.get("module-b");
  failedScript.emit("error");
  assert.equal(await first, false);
  assert.equal(failedScript.dataset.loadState, "error");

  const retry = harness.runtime.loadScriptOnce({
    src: "module-b.js",
    marker: "module-b",
    isReady: () => ready,
    timeoutMs: 100,
  });
  const retryScript = harness.scripts.get("module-b");
  assert.notStrictEqual(retryScript, failedScript);
  assert.equal(failedScript.removed, true);
  assert.equal(harness.appended.length, 2);

  ready = true;
  retryScript.emit("load");
  assert.equal(await retry, true);
}

async function testExistingLoadedButNotReady() {
  const harness = createHarness();
  let ready = false;
  const existing = harness.createScript();
  existing.dataset.mainAsset = "module-c";
  existing.dataset.loadState = "loaded";
  harness.scripts.set("module-c", existing);

  const first = harness.runtime.loadScriptOnce({
    src: "module-c.js",
    marker: "module-c",
    isReady: () => ready,
    timeoutMs: 100,
  });
  assert.equal(await first, false);
  assert.equal(existing.dataset.loadState, "error");

  const retry = harness.runtime.loadScriptOnce({
    src: "module-c.js",
    marker: "module-c",
    isReady: () => ready,
    timeoutMs: 100,
  });
  const fresh = harness.scripts.get("module-c");
  assert.notStrictEqual(fresh, existing);
  assert.equal(existing.removed, true);

  ready = true;
  fresh.emit("load");
  assert.equal(await retry, true);
}

async function testTimeoutCompletesAndAllowsRetry() {
  const harness = createHarness();
  let ready = false;

  const timedOut = harness.runtime.loadScriptOnce({
    src: "module-d.js",
    marker: "module-d",
    isReady: () => ready,
    timeoutMs: 5,
  });

  assert.equal(await timedOut, false);
  const expired = harness.scripts.get("module-d");
  assert.equal(expired.dataset.loadState, "error");

  const retry = harness.runtime.loadScriptOnce({
    src: "module-d.js",
    marker: "module-d",
    isReady: () => ready,
    timeoutMs: 100,
  });
  const fresh = harness.scripts.get("module-d");
  assert.notStrictEqual(fresh, expired);

  ready = true;
  fresh.emit("load");
  assert.equal(await retry, true);
}

async function run() {
  await testFailureThenRetry();
  await testExistingLoadedButNotReady();
  await testTimeoutCompletesAndAllowsRetry();
  console.log("main-loader tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
