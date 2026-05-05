
// Modified divination-map.js (curve connection fix)

function renderConnections(layout) {
  const fragments = [];

  layout.placements.forEach((placement) => {
    const startX =
      placement.node.type === "reading"
        ? placement.x + placement.width
        : placement.x;

    const endX = placement.streamX;

    const startY = placement.centerY;
    const endY = placement.centerY;

    const curveOffset = Math.min(120, Math.abs(startX - endX) * 0.4);

    const path =
      placement.node.type === "reading"
        ? `M ${startX} ${startY}
           C ${startX + curveOffset} ${startY},
             ${endX - curveOffset} ${endY},
             ${endX} ${endY}`
        : `M ${startX} ${startY}
           C ${startX - curveOffset} ${startY},
             ${endX + curveOffset} ${endY},
             ${endX} ${endY}`;

    fragments.push(
      `<path class="map-stream-branch ${placement.node.type}"
        d="${path}"
        fill="none"
        stroke="rgba(183,148,255,0.35)"
        stroke-width="2"
      />`
    );
  });

  return fragments.join("");
}
