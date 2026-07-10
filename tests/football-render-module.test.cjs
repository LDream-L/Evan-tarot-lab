const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const ENTRY = path.join(ROOT, "src", "football", "render.js");

/**
 * 以 esbuild 解析 Render 與評分核心，再於同一 Node realm 驗證 exports。
 * 時間／空間複雜度 O(B)，B 為 data、core、scoring、render source 總大小。
 *
 * 替代方案比較：整頁 E2E 適合驗證完整 DOM，但無法快速區分 Render export、
 * 相容全域或訊息 class 操作哪一層失效；本測試使用最小 DOM stub 定位基礎契約。
 */
function createRuntime() {
  const storage = new Map();
  const localStorage = {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
    removeItem(key) {
      storage.delete(key);
    },
  };

  const browserWindow = {
    localStorage,
    crypto: {
      randomUUID: () => "00000000-0000-4000-8000-000000000001",
      getRandomValues(buffer) {
        buffer[0] = 1;
        return buffer;
      },
    },
  };
  browserWindow.window = browserWindow;

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "football-render-esm-"));
  const bundlePath = path.join(temporaryDirectory, "render.bundle.cjs");
  const previousWindow = global.window;
  const previousDocument = global.document;

  try {
    esbuild.buildSync({
      entryPoints: [ENTRY],
      outfile: bundlePath,
      bundle: true,
      format: "cjs",
      platform: "browser",
      target: ["es2020"],
      logLevel: "silent",
    });

    global.window = browserWindow;
    delete require.cache[bundlePath];
    const exports = require(bundlePath);
    return {
      exports,
      window: browserWindow,
      temporaryDirectory,
      restore() {
        if (previousWindow === undefined) delete global.window;
        else global.window = previousWindow;
        if (previousDocument === undefined) delete global.document;
        else global.document = previousDocument;
      },
    };
  } catch (error) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
    throw error;
  }
}

/** 建立 classList stub：每次操作 O(1)。 */
function createClassList(initial = []) {
  const classes = new Set(initial);
  return {
    add(...names) {
      names.forEach((name) => classes.add(name));
    },
    remove(...names) {
      names.forEach((name) => classes.delete(name));
    },
    contains(name) {
      return classes.has(name);
    },
  };
}

/** 固定契約案例：時間／空間 O(1)。 */
function run() {
  const runtime = createRuntime();
  const api = runtime.exports;

  try {
    assert.ok(api.footballRender, "缺少 footballRender named export");
    assert.strictEqual(runtime.window.FootballLabRender, api.footballRender);
    assert.strictEqual(
      api.footballRender.core,
      runtime.window.FootballStrictScoring.core,
      "Render 必須直接依賴具名嚴格評分核心"
    );
    assert.equal(Object.isFrozen(api.footballRender), true);
    assert.equal(typeof api.renderDraft, "function");
    assert.equal(typeof api.renderRecords, "function");
    assert.equal(typeof api.renderScorecard, "function");
    assert.equal(typeof api.openEvaluation, "function");

    const element = {
      textContent: "",
      classList: createClassList(["football-hidden"]),
    };
    global.document = {
      getElementById(id) {
        return id === "message" ? element : null;
      },
    };

    assert.strictEqual(api.byId("message"), element);
    assert.equal(api.byId("missing"), null);

    api.setMessage("message", "已完成", "is-success");
    assert.equal(element.textContent, "已完成");
    assert.equal(element.classList.contains("football-hidden"), false);
    assert.equal(element.classList.contains("is-success"), true);
    assert.equal(element.classList.contains("is-error"), false);

    api.clearMessage("message");
    assert.equal(element.textContent, "");
    assert.equal(element.classList.contains("football-hidden"), true);
    assert.equal(element.classList.contains("is-success"), false);
    assert.equal(element.classList.contains("is-error"), false);

    console.log("football-render module tests passed");
  } finally {
    runtime.restore();
    fs.rmSync(runtime.temporaryDirectory, { recursive: true, force: true });
  }
}

run();
