    function smoothCornerPath(width, height, radius, smoothing, roundBottom = true) {
      const budget = Math.min(width, height) / 2;
      const s = Math.min(smoothing, budget / radius - 1);
      const p = Math.min((1 + s) * radius, budget);
      const arcMeasure = 90 * (1 - s);
      const rad = (deg) => deg * Math.PI / 180;
      const arc = Math.sin(rad(arcMeasure / 2)) * radius * Math.SQRT2;
      const p3 = radius * Math.tan(rad((90 - arcMeasure) / 4));
      const beta = rad(45 * s);
      const c = p3 * Math.cos(beta);
      const d = c * Math.tan(beta);
      const b = (p - arc - c - d) / 3;
      const a = 2 * b;
      const n = (value) => value.toFixed(4);
      return (
        `M ${n(width - p)} 0 ` +
        `c ${n(a)} 0 ${n(a + b)} 0 ${n(a + b + c)} ${n(d)} ` +
        `a ${n(radius)} ${n(radius)} 0 0 1 ${n(arc)} ${n(arc)} ` +
        `c ${n(d)} ${n(c)} ${n(d)} ${n(b + c)} ${n(d)} ${n(a + b + c)} ` +
        (roundBottom ? (
        `L ${n(width)} ${n(height - p)} ` +
        `c 0 ${n(a)} 0 ${n(a + b)} ${n(-d)} ${n(a + b + c)} ` +
        `a ${n(radius)} ${n(radius)} 0 0 1 ${n(-arc)} ${n(arc)} ` +
        `c ${n(-c)} ${n(d)} ${n(-(b + c))} ${n(d)} ${n(-(a + b + c))} ${n(d)} ` +
        `L ${n(p)} ${n(height)} ` +
        `c ${n(-a)} 0 ${n(-(a + b))} 0 ${n(-(a + b + c))} ${n(-d)} ` +
        `a ${n(radius)} ${n(radius)} 0 0 1 ${n(-arc)} ${n(-arc)} ` +
        `c ${n(-d)} ${n(-c)} ${n(-d)} ${n(-(b + c))} ${n(-d)} ${n(-(a + b + c))} ` 
        ) : `L ${n(width)} ${n(height)} L 0 ${n(height)} `) +
        `L 0 ${n(p)} ` +
        `c 0 ${n(-a)} 0 ${n(-(a + b))} ${n(d)} ${n(-(a + b + c))} ` +
        `a ${n(radius)} ${n(radius)} 0 0 1 ${n(arc)} ${n(-arc)} ` +
        `c ${n(c)} ${n(-d)} ${n(b + c)} ${n(-d)} ${n(a + b + c)} ${n(-d)} ` +
        "Z"
      );
    }
