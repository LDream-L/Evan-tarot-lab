// ==============================
// ripple-effect.js
// 滑鼠移動波瀾背景效果（神秘 × 科技）
// ==============================
//
// 主要函式複雜度：
// - initPointerRippleEffect：O(1) / O(1)
// - updatePointerGlow：O(1) / O(1)
// - spawnRipple：O(1) / O(1)
// - loadLostItemUx：O(1) / O(1)
//
// 更快的替代方案比較：
// - 暴力法：每次 pointermove 都直接建立 DOM 動畫，事件頻率高時容易造成掉幀。
// - 優化法：背景光點用 requestAnimationFrame 合併更新，波紋則加上時間與位移門檻，
//   只在「真的有移動」時生成，因此互動感夠、成本也更穩定。
// ==============================

(function initPointerRippleEffect() {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const supportsHover = window.matchMedia('(hover: hover)').matches;

  if (prefersReducedMotion || !supportsHover) {
    return;
  }

  const root = document.documentElement;
  const layer = document.createElement('div');
  layer.className = 'cursor-ripple-layer';
  layer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(layer);

  let rafId = 0;
  let nextX = window.innerWidth * 0.5;
  let nextY = window.innerHeight * 0.25;
  let lastSpawnAt = 0;
  let lastSpawnX = nextX;
  let lastSpawnY = nextY;

  function updatePointerGlow() {
    rafId = 0;
    root.style.setProperty('--mouse-x', `${nextX}px`);
    root.style.setProperty('--mouse-y', `${nextY}px`);
  }

  function queuePointerGlow(x, y) {
    nextX = x;
    nextY = y;

    if (rafId) return;
    rafId = window.requestAnimationFrame(updatePointerGlow);
  }

  function spawnRipple(x, y) {
    const now = performance.now();
    const deltaX = x - lastSpawnX;
    const deltaY = y - lastSpawnY;
    const travelSq = deltaX * deltaX + deltaY * deltaY;

    if (now - lastSpawnAt < 95 || travelSq < 22 * 22) {
      return;
    }

    lastSpawnAt = now;
    lastSpawnX = x;
    lastSpawnY = y;

    const ripple = document.createElement('span');
    const size = 64 + Math.random() * 52;
    const hueClass = Math.random() > 0.55 ? 'is-cyan' : 'is-violet';

    ripple.className = `cursor-ripple ${hueClass}`;
    ripple.style.width = `${size}px`;
    ripple.style.height = `${size}px`;
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    ripple.style.setProperty('--ripple-rotate', `${(Math.random() * 18 - 9).toFixed(2)}deg`);

    layer.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove(), { once: true });

    if (layer.childElementCount > 14) {
      layer.firstElementChild?.remove();
    }
  }

  function handlePointerMove(event) {
    const { clientX, clientY } = event;
    queuePointerGlow(clientX, clientY);
    spawnRipple(clientX, clientY);
    document.body.classList.add('pointer-awake');
  }

  function handlePointerLeave() {
    document.body.classList.remove('pointer-awake');
    queuePointerGlow(window.innerWidth * 0.5, window.innerHeight * 0.2);
  }

  window.addEventListener('pointermove', handlePointerMove, { passive: true });
  window.addEventListener('pointerleave', handlePointerLeave, { passive: true });
  window.addEventListener('blur', handlePointerLeave);
})();

(function loadLostItemUx() {
  if (!document.getElementById('lost-item-tool')) return;

  const script = document.createElement('script');
  script.src = `JS/lost-item-ux.js?v=20260625-action-guide-v1`;
  script.async = false;
  script.onload = () => window.EvanLostItemUx?.init();
  script.onerror = () => console.warn('[lost-item-ux] 搜尋指令介面載入失敗。');
  document.head.appendChild(script);
})();