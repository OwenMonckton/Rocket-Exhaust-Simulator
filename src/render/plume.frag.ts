export const VERTEX_SHADER = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

// Sky plus plume. Plume space: x downstream and y radial, both in exit radii.
export const FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform vec2 uRes;
uniform vec2 uExit;
uniform float uRadius;
uniform float uTime;
uniform float uIntensity;
uniform float uSettle;
uniform float uBloom;
uniform float uSpacing;
uniform float uDiamond;
uniform float uPhase;
uniform float uTurb;
uniform float uLen;
uniform float uOpacity;
uniform float uSoot;
uniform float uSmoke;
uniform float uStars;
uniform vec3 uCore;
uniform vec3 uMid;
uniform vec3 uEdge;
uniform vec3 uSkyTop;
uniform vec3 uSkyBottom;

out vec4 outColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

// 1 below a, 0 above b (a < b).
float falloff(float a, float b, float v) {
  return 1.0 - smoothstep(a, b, v);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(17.1, 9.2);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / uRes;

  vec3 col = mix(uSkyBottom, uSkyTop, smoothstep(0.0, 1.0, uv.y));
  vec2 cell = floor(frag / 2.5);
  float star = step(0.9982, hash(cell)) * (0.35 + 0.65 * hash(cell + 7.0));
  col += vec3(star) * uStars;

  if (uIntensity > 0.002 && uRadius > 0.5) {
    vec2 p = (frag - uExit) / uRadius;
    float x = p.x;
    float y = abs(p.y);

    if (x > -0.05) {
      float t = uTime;
      float xs = max(x, 0.0);

      // Jet boundary: oscillates through shock cells at low altitude, fans out in vacuum.
      float c = xs / uSpacing;
      float osc = cos(6.28318 * c) * exp(-c / 3.0);
      float rShock = mix(uSettle, 1.0, osc);
      float rFan = max(1.0 + (uSettle - 1.0) * (1.0 - exp(-xs / 1.5)), 1.0 + xs * 0.95);
      float rJet = mix(rShock, rFan, uBloom);
      float R = rJet + xs * 0.04 * (1.0 + uTurb);

      float n1 = fbm(vec2(xs * 0.9 - t * 7.0, p.y * 1.7 + 3.0));
      float n2 = fbm(vec2(xs * 2.4 - t * 13.0, p.y * 4.2));
      float wobble = (n1 - 0.5) * uTurb * min(1.0, 0.12 + 0.11 * xs) * 1.7;
      float rr = y / max(0.05, R * (1.0 + wobble));

      float start = smoothstep(-0.05, 0.04, x);
      float axial = exp(-xs / uLen * 2.3) * start;
      float thin = 1.0 / (1.0 + uBloom * xs * 0.55);

      float body = falloff(0.4, 1.05, rr);
      float inner = falloff(0.2, 0.9, rr);
      float coreI = falloff(0.0, 0.55, rr) * exp(-xs / (uLen * 0.32));

      vec3 em = uEdge * body * axial * 0.55
              + uMid * inner * axial * 0.75
              + uCore * coreI * start * 0.7;
      em *= (0.82 + 0.36 * n2) * uOpacity * thin;

      // Soot: a darker, redder sheath around a fuel-rich flame.
      float sheath = smoothstep(0.5, 0.9, rr) * falloff(0.9, 1.15, rr) * exp(-xs / 5.0);
      em *= 1.0 - 0.65 * clamp(uSoot, 0.0, 1.0) * sheath;

      // Shock diamonds.
      float ph = c - uPhase;
      float k = floor(ph + 0.5);
      float d = ph - k;
      float dia = smoothstep(0.0, 0.3, 0.72 * (1.0 - 2.5 * abs(d)) - y / max(0.2, rShock));
      dia *= step(-0.5, k) * exp(-k * 0.42) * uDiamond * start;
      em += (uCore * 1.15 + 0.12) * dia * (0.8 + 0.4 * n2) * max(uOpacity, 0.8);

      // Soft glow around the nozzle exit.
      float halo = exp(-length(vec2(xs * 0.35, max(0.0, y - 0.8))) * 2.4) * start;
      em += uMid * halo * 0.1 * uOpacity;

      em *= uIntensity;

      // Smoke trail: lit by the sky, and it hides what is behind it.
      float smokeAmt = uSmoke + 0.3 * uSoot;
      if (smokeAmt > 0.001) {
        float Rs = R * 1.25 + xs * 0.2;
        float sn = fbm(vec2(xs * 0.55 - t * 2.6, p.y * 0.9 + 11.0));
        float sm = falloff(0.25, 1.1, y / Rs) * smoothstep(1.2, 6.0, xs) * smoothstep(0.25, 0.75, sn);
        sm *= clamp(smokeAmt, 0.0, 1.0) * uIntensity * thin * 0.9;
        float skyLight = 0.25 + 0.75 * dot(uSkyBottom, vec3(0.33));
        vec3 smokeCol = mix(vec3(0.42), vec3(0.9), sn) * skyLight + uMid * 0.25 * axial;
        col = mix(col, smokeCol, clamp(sm, 0.0, 0.92));
      }

      // The flame hides the sky behind it in proportion to how bright it is,
      // so it keeps its colour against a daytime sky as well as in space.
      vec3 lit = 1.0 - exp(-em * 2.4);
      float cover = clamp(max(lit.r, max(lit.g, lit.b)) * 1.5, 0.0, 1.0);
      col = col * (1.0 - cover) + lit;
    }
  }

  outColor = vec4(col, 1.0);
}
`;
