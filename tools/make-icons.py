#!/usr/bin/env python3
"""make-icons.py — generates icons/icon{16,32,48,128}.png for 화면부수기 (Crash Screen).

Pure Python 3: only zlib, struct, math (no Pillow). Deterministic (seeded LCG).
Renders at 4x supersampling, then box-downsamples to the target size.

Design: rounded dark navy square (#1b1f2a, corner radius 22% of size) with a soft
lighter radial glow in the center and a cracked-glass pattern: 9 thin light rays
(#dfe8ff) from the center, 2 jittered concentric web rings, and a small white
impact dot.

Run: python3 tools/make-icons.py
"""
import math
import os
import struct
import sys
import zlib

SS = 4  # supersampling factor
SIZES = (16, 32, 48, 128)
NAVY = (0x1B, 0x1F, 0x2A)
GLOW = (0x3A, 0x45, 0x66)
RAY = (0xDF, 0xE8, 0xFF)
WHITE = (0xFF, 0xFF, 0xFF)


class LCG:
    """Deterministic linear congruential generator (Numerical Recipes constants)."""

    def __init__(self, seed):
        self.state = seed & 0xFFFFFFFF

    def rand(self):
        self.state = (self.state * 1664525 + 1013904223) & 0xFFFFFFFF
        return self.state / 4294967296.0

    def uniform(self, lo, hi):
        return lo + (hi - lo) * self.rand()


class Canvas:
    """Float RGBA canvas, premultiplied compositing via straight alpha blend."""

    def __init__(self, w, h):
        self.w = w
        self.h = h
        self.r = [0.0] * (w * h)
        self.g = [0.0] * (w * h)
        self.b = [0.0] * (w * h)
        self.a = [0.0] * (w * h)

    def blend(self, i, color, alpha):
        if alpha <= 0.0:
            return
        if alpha > 1.0:
            alpha = 1.0
        da = self.a[i]
        out_a = alpha + da * (1.0 - alpha)
        if out_a <= 0.0:
            return
        inv = 1.0 - alpha
        self.r[i] = (color[0] * alpha + self.r[i] * da * inv) / out_a
        self.g[i] = (color[1] * alpha + self.g[i] * da * inv) / out_a
        self.b[i] = (color[2] * alpha + self.b[i] * da * inv) / out_a
        self.a[i] = out_a


def rounded_rect_coverage(x, y, w, h, radius):
    """Signed-distance based coverage (0..1) of pixel center (x, y) inside a rounded rect."""
    cx = w / 2.0
    cy = h / 2.0
    hx = w / 2.0 - radius
    hy = h / 2.0 - radius
    dx = abs(x - cx) - hx
    dy = abs(y - cy) - hy
    ox = dx if dx > 0 else 0.0
    oy = dy if dy > 0 else 0.0
    outside = math.hypot(ox, oy)
    inside = min(max(dx, dy), 0.0)
    d = outside + inside - radius
    cov = 0.5 - d
    return 0.0 if cov < 0 else (1.0 if cov > 1 else cov)


def draw_segment(canvas, mask, p0, p1, half_width, color, alpha=1.0, feather=0.75):
    """Anti-aliased thick line segment, clipped by mask."""
    x0, y0 = p0
    x1, y1 = p1
    minx = max(0, int(math.floor(min(x0, x1) - half_width - 2)))
    maxx = min(canvas.w - 1, int(math.ceil(max(x0, x1) + half_width + 2)))
    miny = max(0, int(math.floor(min(y0, y1) - half_width - 2)))
    maxy = min(canvas.h - 1, int(math.ceil(max(y0, y1) + half_width + 2)))
    vx = x1 - x0
    vy = y1 - y0
    len2 = vx * vx + vy * vy
    for y in range(miny, maxy + 1):
        py = y + 0.5
        row = y * canvas.w
        for x in range(minx, maxx + 1):
            px = x + 0.5
            if len2 > 0:
                t = ((px - x0) * vx + (py - y0) * vy) / len2
                t = 0.0 if t < 0 else (1.0 if t > 1 else t)
            else:
                t = 0.0
            dx = px - (x0 + t * vx)
            dy = py - (y0 + t * vy)
            d = math.sqrt(dx * dx + dy * dy)
            cov = (half_width + feather - d) / feather
            if cov <= 0:
                continue
            if cov > 1:
                cov = 1.0
            i = row + x
            canvas.blend(i, color, cov * alpha * mask[i])


def draw_disc(canvas, mask, center, radius, color, alpha=1.0, feather=0.75, soft=False):
    """Anti-aliased filled disc. If soft, alpha fades quadratically to the edge (glow)."""
    cx, cy = center
    minx = max(0, int(math.floor(cx - radius - 2)))
    maxx = min(canvas.w - 1, int(math.ceil(cx + radius + 2)))
    miny = max(0, int(math.floor(cy - radius - 2)))
    maxy = min(canvas.h - 1, int(math.ceil(cy + radius + 2)))
    for y in range(miny, maxy + 1):
        py = y + 0.5
        row = y * canvas.w
        for x in range(minx, maxx + 1):
            px = x + 0.5
            d = math.hypot(px - cx, py - cy)
            if soft:
                if d >= radius:
                    continue
                t = 1.0 - d / radius
                cov = t * t
            else:
                cov = (radius + feather - d) / feather
                if cov <= 0:
                    continue
                if cov > 1:
                    cov = 1.0
            i = row + x
            canvas.blend(i, color, cov * alpha * mask[i])


def render(size, seed=0x5EED):
    W = size * SS
    rng = LCG(seed)
    canvas = Canvas(W, W)
    mask = [0.0] * (W * W)

    # 1. Rounded navy square.
    radius = 0.22 * W
    for y in range(W):
        row = y * W
        for x in range(W):
            cov = rounded_rect_coverage(x + 0.5, y + 0.5, W, W, radius)
            mask[row + x] = cov
            if cov > 0:
                canvas.blend(row + x, NAVY, cov)

    # 2. Soft lighter radial glow in the center.
    cx = W / 2.0
    cy = W / 2.0
    draw_disc(canvas, mask, (cx, cy), 0.62 * W, GLOW, alpha=0.85, soft=True)

    # Geometry scale: line width in final pixels, converted to supersampled units.
    line_w = max(0.8, size * 0.030) * SS
    hw_ray = line_w / 2.0
    hw_ring = max(0.6, size * 0.022) * SS / 2.0

    # 3. Nine rays from the center with jittered angles, lengths and a slight kink.
    n_rays = 9
    rays = []  # list of polylines (list of points)
    base = rng.uniform(0, 2 * math.pi)
    for k in range(n_rays):
        ang = base + (2 * math.pi * k) / n_rays + rng.uniform(-0.16, 0.16)
        length = W * rng.uniform(0.40, 0.50)
        kink_t = rng.uniform(0.45, 0.65)
        kink_a = ang + rng.uniform(-0.18, 0.18)
        p0 = (cx, cy)
        p1 = (cx + math.cos(ang) * length * kink_t, cy + math.sin(ang) * length * kink_t)
        p2 = (p1[0] + math.cos(kink_a) * length * (1.0 - kink_t),
              p1[1] + math.sin(kink_a) * length * (1.0 - kink_t))
        rays.append((ang, [p0, p1, p2]))

    def point_on_ray(poly, dist):
        """Point at radial distance `dist` along the polyline (by cumulative length)."""
        acc = 0.0
        for a, b in zip(poly, poly[1:]):
            seg = math.hypot(b[0] - a[0], b[1] - a[1])
            if acc + seg >= dist or (a, b) == (poly[-2], poly[-1]):
                t = (dist - acc) / seg if seg > 0 else 0.0
                t = 0.0 if t < 0 else (1.0 if t > 1 else t)
                return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
            acc += seg
        return poly[-1]

    # 4. Two jittered concentric web rings connecting neighbouring rays.
    ring_radii = (0.17 * W, 0.31 * W)
    for ridx, rr in enumerate(ring_radii):
        pts = []
        for ang, poly in rays:
            d = rr * rng.uniform(0.86, 1.14)
            pts.append(point_on_ray(poly, d))
        for k in range(n_rays):
            a = pts[k]
            b = pts[(k + 1) % n_rays]
            # slight bow so the ring looks like broken glass, not a polygon
            mx = (a[0] + b[0]) / 2.0
            my = (a[1] + b[1]) / 2.0
            vx = mx - cx
            vy = my - cy
            vl = math.hypot(vx, vy) or 1.0
            bow = rng.uniform(-0.06, 0.04) * rr
            m = (mx + vx / vl * bow, my + vy / vl * bow)
            alpha = (0.78 if ridx == 0 else 0.62) * (0.7 if size <= 16 else 1.0)
            draw_segment(canvas, mask, a, m, hw_ring, RAY, alpha)
            draw_segment(canvas, mask, m, b, hw_ring, RAY, alpha)

    # Rays drawn after rings so they sit on top; outer part slightly thinner/fainter.
    for ang, poly in rays:
        draw_segment(canvas, mask, poly[0], poly[1], hw_ray, RAY, 0.96)
        draw_segment(canvas, mask, poly[1], poly[2], hw_ray * 0.8, RAY, 0.80)

    # 5. Impact dot: soft halo plus a small solid white dot.
    dot_r = max(1.2, size * 0.055) * SS / 2.0
    draw_disc(canvas, mask, (cx, cy), dot_r * 3.2, WHITE, alpha=0.55, soft=True)
    draw_disc(canvas, mask, (cx, cy), dot_r, WHITE, alpha=1.0)

    # 6. Box-downsample SS x SS -> final RGBA bytes (straight alpha, 8-bit).
    rows = []
    n = SS * SS
    for y in range(size):
        row = bytearray()
        for x in range(size):
            sr = sg = sb = sa = 0.0
            for yy in range(y * SS, (y + 1) * SS):
                base_i = yy * W + x * SS
                for xx in range(SS):
                    i = base_i + xx
                    a = canvas.a[i]
                    sr += canvas.r[i] * a
                    sg += canvas.g[i] * a
                    sb += canvas.b[i] * a
                    sa += a
            if sa > 0:
                r = sr / sa
                g = sg / sa
                b = sb / sa
            else:
                r = g = b = 0.0
            a = sa / n
            row += bytes((clamp8(r), clamp8(g), clamp8(b), clamp8(a * 255.0)))
        rows.append(bytes(row))
    return rows


def clamp8(v):
    v = int(round(v))
    return 0 if v < 0 else (255 if v > 255 else v)


def write_png(path, size, rows):
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + r for r in rows)  # filter type 0 per scanline
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
           + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = os.path.join(root, "icons")
    os.makedirs(out_dir, exist_ok=True)
    for size in SIZES:
        rows = render(size)
        path = os.path.join(out_dir, "icon%d.png" % size)
        write_png(path, size, rows)
        print("wrote", path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
