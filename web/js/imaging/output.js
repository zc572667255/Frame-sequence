// Output frame size: scale or crop each frame into the export cell.
//
// mode: contain | cover | scale | crop     anchor: "ax,ay" with 0 start, 1 centre, 2 end

function anchorOffset(cell, content, a) {
  if (a === 0) return 0;
  if (a === 2) return cell - content;
  return Math.round((cell - content) / 2);
}

export function drawFrameInto(ctx, frame, cellX, cellY, cw, ch, mode, anchor) {
  const w = frame.width, h = frame.height;
  const [ax, ay] = String(anchor || "1,1").split(",").map(Number);
  ctx.save();
  // clipped to the cell so crop-mode overflow never bleeds into neighbouring cells
  ctx.beginPath();
  ctx.rect(cellX, cellY, cw, ch);
  ctx.clip();
  if (mode === "scale") {
    // stretch to fill: independent x/y factors, so a different aspect distorts
    ctx.drawImage(frame, cellX, cellY, cw, ch);
  } else if (mode === "cover" || mode === "contain") {
    // One factor drives both axes, so neither mode ever distorts. The choice is
    // only about what happens to the aspect-ratio mismatch:
    //   cover   = the LARGER factor — fills the cell, surplus is cropped away
    //   contain = the SMALLER factor — the whole frame fits, padding is transparent
    const s = mode === "cover" ? Math.max(cw / w, ch / h) : Math.min(cw / w, ch / h);
    const ox = anchorOffset(cw, w * s, ax), oy = anchorOffset(ch, h * s, ay);
    ctx.drawImage(frame, cellX + ox, cellY + oy, w * s, h * s);
  } else {
    const ox = anchorOffset(cw, w, ax), oy = anchorOffset(ch, h, ay);
    ctx.drawImage(frame, cellX + ox, cellY + oy);
  }
  ctx.restore();
}

// Spell out what the aspect-ratio mismatch costs, so "some of my image got cut
// off" is visible before exporting rather than discovered afterwards.
export function describeOutput(srcW, srcH, outW, outH, mode) {
  if (mode === "scale") {
    const distort = Math.abs(srcW / srcH - outW / outH) > 1e-6;
    return "拉伸填充" + (distort ? "，⚠ 比例不同会变形" : "");
  }
  if (mode === "crop") return "1:1 裁切 / 扩画布，不缩放";
  const fx = outW / srcW, fy = outH / srcH;
  const s = mode === "cover" ? Math.max(fx, fy) : Math.min(fx, fy);
  const dw = Math.round(srcW * s), dh = Math.round(srcH * s);
  const gapW = outW - dw, gapH = outH - dh;
  let t = "等比缩放 " + (s * 100).toFixed(1) + "%，实际画面 " + dw + "×" + dh;
  if (mode === "cover") {
    const cutW = Math.round(-gapW / s), cutH = Math.round(-gapH / s);
    t += cutW > 0 ? "，⚠ 左右共裁掉原图 " + cutW + " px"
      : cutH > 0 ? "，⚠ 上下共裁掉原图 " + cutH + " px" : "，无裁切";
  } else {
    t += gapW > 0 ? "，左右共留 " + gapW + " px 透明边"
      : gapH > 0 ? "，上下共留 " + gapH + " px 透明边" : "，正好填满";
  }
  return t;
}
