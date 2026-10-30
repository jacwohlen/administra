// The attendance grid of the app as a backdrop, drawn on a <canvas
// data-presence>: small squares in a training rhythm (rows are weekdays,
// columns weeks, with holiday breaks), in the shades of the member profile.
// They are strongest towards the top right and faint behind the text
// ([data-presence-text]), so the copy stays readable. A small cone of light
// follows the mouse and fades slowly, red squares appear in a wave when the
// page opens, and on touch screens a square lights up now and then, like a
// check-in. Purely decorative (aria-hidden in the HTML); without JavaScript
// the hero stays plain. Only squares that change are redrawn, and nothing
// runs while nothing moves.
(() => {
  const CELL = 14;
  const GAP = 4;
  const PITCH = CELL + GAP;
  const RADIUS = 3;
  // Opacity of the shades: nobody, one training, two or more
  const SHADE = [0.05, 0.2, 0.42];
  // Chance of a training per weekday (Monday first): the club trains on
  // Monday, Wednesday and Thursday, sometimes Friday
  const WEEKDAY = [0.7, 0.1, 0.65, 0.75, 0.3, 0.04, 0.02];
  const CONE = [1, 0.75, 0.45]; // light at the pointer and one and two squares away
  const FADE = 1.8; // seconds for a lit square to go dark again
  const WAVE = 14; // milliseconds between columns of the opening wave
  const APPEAR = 450; // milliseconds for one square of the wave

  const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
  const touch = window.matchMedia('(hover: none)');

  // A fixed pseudo-random sequence, so the pattern looks the same every visit
  const random = (seed) => () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  function rgb(color) {
    const m = color.match(/[\d.]+/g) ?? ['0', '0', '0'];
    return m.slice(0, 3).map(Number);
  }

  function setup(canvas) {
    const area = canvas.parentElement;
    const context = canvas.getContext('2d');
    if (!context) return;
    const probe = document.createElement('span');
    probe.hidden = true;
    area.append(probe);

    let width = 0;
    let height = 0;
    let cols = 0;
    let rows = 0;
    let left = 0;
    let cells = [];
    let colors = { ink: [0, 0, 0], accent: [220, 0, 36] };
    let opened = 0; // when the opening wave started (0: no wave)
    let frame = 0;
    let last = 0;
    const lit = new Set();

    function readColors() {
      probe.style.color = 'var(--ink)';
      const ink = rgb(getComputedStyle(probe).color);
      probe.style.color = 'var(--accent)';
      colors = { ink, accent: rgb(getComputedStyle(probe).color) };
    }

    function build(wave) {
      const box = canvas.getBoundingClientRect();
      width = box.width;
      height = box.height;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);

      cols = Math.max(1, Math.floor((width + GAP) / PITCH));
      rows = Math.max(1, Math.floor((height + GAP) / PITCH));
      left = (width - (cols * PITCH - GAP)) / 2;
      const text = [...(area.querySelector('[data-presence-text]')?.children ?? [])].map((el) => {
        const r = el.getBoundingClientRect();
        return {
          left: r.left - box.left - 8,
          right: r.right - box.left + 8,
          top: r.top - box.top - 6,
          bottom: r.bottom - box.top + 6
        };
      });
      const reach = Math.max(width, 32 * PITCH);
      const next = random(20261030);
      cells = [];
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const x = left + col * PITCH;
          const y = row * PITCH;
          // Holidays: a few empty weeks, at another place in every band of rows
          const week = (col + Math.floor(row / 7) * 11) % 26;
          const chance = WEEKDAY[row % 7];
          const r = next();
          const shade = week < 17 && r < chance ? (r < chance * 0.3 ? 2 : 1) : 0;
          const behindText = text.some(
            (t) => x + CELL > t.left && x < t.right && y + CELL > t.top && y < t.bottom
          );
          const strength = Math.max(0.12, 1 - Math.hypot(width * 0.92 - x, y * 1.5) / reach);
          cells.push({
            x,
            y,
            col,
            shade,
            strength: behindText ? strength * 0.3 : strength,
            behindText,
            heat: 0
          });
        }
      }
      opened = wave && !calm.matches ? performance.now() : 0;
      lit.clear();
      readColors();
      context.clearRect(0, 0, width, height);
      draw(cells, performance.now());
      if (opened) animate();
    }

    const fill = (color, alpha) => {
      context.fillStyle = `rgb(${color.join(' ')} / ${alpha.toFixed(3)})`;
      context.fill();
    };

    function paint(cell, now) {
      // The opening wave: attended squares grow from grey into their red
      let appear = 1;
      if (opened && cell.shade) {
        appear = Math.min(1, Math.max(0, (now - opened - (cols - cell.col) * WAVE) / APPEAR));
      }
      const glow = cell.behindText ? Math.min(cell.heat, 0.35) : cell.heat;
      const grow = calm.matches || cell.behindText ? 0 : glow * 0.35;
      const size = CELL * (cell.shade ? 0.4 + 0.6 * appear : 1) * (1 + grow);
      const offset = (CELL - size) / 2;
      context.beginPath();
      if (context.roundRect)
        context.roundRect(cell.x + offset, cell.y + offset, size, size, RADIUS);
      else context.rect(cell.x + offset, cell.y + offset, size, size);
      // The square's own shade: grey, or red for attended days
      const grey = cell.shade ? 1 - appear : 1;
      if (grey > 0) fill(colors.ink, SHADE[0] * grey * cell.strength);
      if (cell.shade) fill(colors.accent, SHADE[cell.shade] * appear * cell.strength);
      // The light on top: the accent colour, fading out (never a mixed tone)
      if (glow > 0) {
        if (glow > 0.6 && !cell.behindText) {
          context.shadowColor = `rgb(${colors.accent.join(' ')} / ${(0.7 * glow).toFixed(3)})`;
          context.shadowBlur = 16 * glow;
        }
        fill(colors.accent, glow * Math.max(cell.strength, glow));
        context.shadowBlur = 0;
      }
    }

    function draw(list, now) {
      for (const cell of list) paint(cell, now);
    }

    // Redraw the area around the given squares (lit squares grow and glow
    // into their neighbours, so those are redrawn too)
    function redraw(changed, now) {
      if (!changed.length) return;
      const margin = 2 * PITCH;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const cell of changed) {
        x0 = Math.min(x0, cell.x - margin);
        y0 = Math.min(y0, cell.y - margin);
        x1 = Math.max(x1, cell.x + CELL + margin);
        y1 = Math.max(y1, cell.y + CELL + margin);
      }
      context.save();
      context.beginPath();
      context.rect(x0, y0, x1 - x0, y1 - y0);
      context.clip();
      context.clearRect(x0, y0, x1 - x0, y1 - y0);
      const c0 = Math.max(0, Math.floor((x0 - left) / PITCH) - 1);
      const c1 = Math.min(cols - 1, Math.ceil((x1 - left) / PITCH) + 1);
      const r0 = Math.max(0, Math.floor(y0 / PITCH) - 1);
      const r1 = Math.min(rows - 1, Math.ceil(y1 / PITCH) + 1);
      // Dim squares first, lit ones on top
      const nearby = [];
      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) nearby.push(cells[row * cols + col]);
      }
      nearby.sort((a, b) => a.heat - b.heat);
      draw(nearby, now);
      context.restore();
    }

    function step(now) {
      frame = 0;
      const seconds = Math.min(0.1, (now - (last || now)) / 1000);
      last = now;
      const changed = [];
      for (const cell of lit) {
        cell.heat = Math.max(0, cell.heat - seconds / FADE);
        changed.push(cell);
        if (cell.heat === 0) lit.delete(cell);
      }
      if (opened) {
        // Only the attended squares of the columns that are appearing right
        // now; they stay within their own square while they grow
        const elapsed = now - opened;
        for (let col = 0; col < cols; col++) {
          const local = elapsed - (cols - col) * WAVE;
          if (local < -20 || local > APPEAR + 40) continue;
          for (let row = 0; row < rows; row++) {
            const cell = cells[row * cols + col];
            if (!cell.shade || cell.heat) continue;
            context.clearRect(cell.x, cell.y, CELL, CELL);
            paint(cell, now);
          }
        }
        if (elapsed > cols * WAVE + APPEAR + 40) opened = 0;
      }
      redraw(changed, now);
      if (lit.size || opened) animate();
      else last = 0;
    }

    function animate() {
      if (!frame) frame = requestAnimationFrame(step);
    }

    function light(col, row, peak) {
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const c = col + dc;
          const r = row + dr;
          if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
          const distance = Math.hypot(dc, dr);
          if (distance > 2.3) continue;
          const cell = cells[r * cols + c];
          const heat = peak * CONE[distance < 0.5 ? 0 : distance < 1.5 ? 1 : 2];
          if (heat > cell.heat) {
            cell.heat = heat;
            lit.add(cell);
          }
        }
      }
      animate();
    }

    area.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'touch' || !cells.length) return;
      const box = canvas.getBoundingClientRect();
      const col = Math.floor((event.clientX - box.left - left) / PITCH);
      const row = Math.floor((event.clientY - box.top) / PITCH);
      light(col, row, 1);
    });

    // Touch screens: now and then a check-in lights up, while the hero is seen
    let visible = true;
    new IntersectionObserver(([entry]) => (visible = entry.isIntersecting)).observe(area);
    const checkins = random(7);
    window.setInterval(() => {
      if (!touch.matches || calm.matches || !visible || document.hidden || !cells.length) return;
      for (let tries = 0; tries < 20; tries++) {
        const cell = cells[Math.floor(checkins() * cells.length)];
        if (!cell.behindText && cell.strength > 0.45) {
          cell.heat = 1;
          lit.add(cell);
          animate();
          break;
        }
      }
    }, 2400);

    // Rebuild on resize, recolour when the light/dark mode changes
    let resize = 0;
    window.addEventListener('resize', () => {
      cancelAnimationFrame(resize);
      resize = requestAnimationFrame(() => build(false));
    });
    const recolour = () => {
      readColors();
      context.clearRect(0, 0, width, height);
      draw(cells, performance.now());
    };
    new MutationObserver(recolour).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolour);

    build(true);
  }

  function start() {
    for (const canvas of document.querySelectorAll('canvas[data-presence]')) setup(canvas);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
