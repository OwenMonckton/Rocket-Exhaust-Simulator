export const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

// Sky plus plume. Plume space: x downstream and y radial, both in exit radii.
export const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp sampler2D;

// Prototype: plume drawn from the gas simulation instead of the hand-shaped model.
uniform float uUseSim;
uniform sampler2D uSim;
uniform vec2 uSimGrid;
uniform float uSimCell;     // cell size, in exit radii
uniform float uSimUp;       // how far the grid reaches upstream of the nozzle exit, in exit radii
uniform float uSimLip;      // slope of the nozzle wall at the lip
uniform float uSimCurve;    // and how sharply it curves in upstream of that
uniform vec2 uSimFade;      // how far in from its far end and its outer edge the simulated gas fades out, in exit radii
uniform float uSimGamma;
uniform float uSimAmbT;     // ambient temperature over exit temperature
uniform float uSimT0;       // stagnation temperature over exit temperature
uniform float uSimAmbP;     // ambient pressure over exit pressure
uniform float uSimFloor;    // the solver's stand-in for a vacuum: the lowest ambient pressure it can hold
uniform sampler2D uSimS;    // exhaust density
uniform float uAfter;       // afterburning strength
uniform vec3 uAfterCol;
uniform float uParticles;   // glowing particles carried in the exhaust

uniform float uWallOn;           // 1 when a nozzle extension stands in the plume
uniform vec4 uWall;              // its inner surface in exit radii: (x, r) upstream end, (x, r) downstream end
uniform int uExitCount;          // how many nozzle exits to draw a plume from (1 or 2)
uniform float uExitOffsets[2];   // their vertical offsets from uExit, in pixels

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

// Density and temperature of the simulated gas at a point (in exit radii), relative to the nozzle exit.
// Also returns the fraction of the gas that is exhaust rather than air.
vec3 simGas(vec2 q) {
  vec2 uv = clamp((q + vec2(uSimUp, 0.0)) / (uSimGrid * uSimCell), vec2(0.0), vec2(1.0));
  vec4 U = texture(uSim, uv);
  float rho = max(U.x, 1e-6);
  float p = max((uSimGamma - 1.0) * (U.w - 0.5 * (U.y * U.y + U.z * U.z) / rho), 1e-8);
  return vec3(rho, p / rho, clamp(texture(uSimS, uv).x / rho, 0.0, 1.0));
}

// How much of a parcel of exhaust to show, given how close it is to the solver's vacuum floor.
// In a true vacuum the plume thins smoothly to nothing as it fans out around the lip. The solver's
// thin leftover gas instead stops it at a sharp edge, almost straight up and down at the nozzle's
// exit plane, where the exhaust has expanded down to the floor's pressure. Fading out exhaust that
// close to the floor turns that edge back into a gradual thinning. At lower altitudes the outside
// air is far above the floor, so this does nothing there.
float aboveFloor(vec3 gas) {
  return smoothstep(0.4, 2.5, log(max(gas.x * gas.y, 1e-12) / uSimFloor));
}

// Light given off by a small parcel of simulated gas.
vec3 simGlow(vec3 gas) {
  float temp = gas.y;
  float exhaust = gas.z;
  // 0 for cold gas, about a third for exhaust leaving the nozzle, 1 for gas brought to a stop.
  float floorT = 2.0 * uSimAmbT;
  // The hot end of the scale is capped: a very high-expansion nozzle (NERVA, RL10) cools its
  // exhaust so far below its starting temperature that the plume would otherwise barely register.
  float heat = clamp((temp - floorT) / max(0.1, min(uSimT0, 3.0) - floorT), 0.0, 1.0);
  float shock = smoothstep(0.5, 0.9, heat);
  float dens = clamp(pow(gas.x, 0.55), 0.0, 2.2);
  vec3 tint = mix(uEdge, uMid, smoothstep(0.15, 0.45, heat));
  tint = mix(tint, uCore * 1.15, smoothstep(0.45, 0.85, heat));
  float bright = smoothstep(0.0, 0.25, heat) * (0.42 + 1.7 * heat * heat);
  // Gas squeezed above the outside pressure is where the diamonds are: let it glow.
  float squeeze = smoothstep(1.15, 2.6, gas.x * temp / uSimAmbP) * smoothstep(0.1, 0.3, heat);
  tint = mix(tint, uCore * 1.15, 0.55 * squeeze);
  bright *= 1.0 + 1.3 * squeeze;
  // Only exhaust glows; air heated by a passing shock stays dark.
  vec3 glow = tint * bright * dens * exhaust * mix(uOpacity, 1.0, 0.6 * max(shock, squeeze));
  // Afterburning: leftover fuel in the exhaust burns where it mixes with air.
  float mixing = 4.0 * exhaust * (1.0 - exhaust) * smoothstep(0.04, 0.25, exhaust);
  glow += uAfterCol * uAfter * mixing * (0.5 + 0.5 * smoothstep(0.0, 0.3, heat)) * 1.6;
  // Solid particles in the exhaust stay incandescent after the gas around them has cooled.
  // Their glow is in proportion to how many there are, so it thins out as the exhaust spreads.
  glow += mix(uMid, uCore, 0.6) * uParticles * exhaust * clamp(gas.x, 0.0, 1.6) * 1.25;
  return glow * aboveFloor(gas);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / uRes;

  vec3 col = mix(uSkyBottom, uSkyTop, smoothstep(0.0, 1.0, uv.y));
  vec2 cell = floor(frag / 2.5);
  float star = step(0.9982, hash(cell)) * (0.35 + 0.65 * hash(cell + 7.0));
  col += vec3(star) * uStars;

  if (uIntensity > 0.002 && uRadius > 0.5) {
    // A multi-chamber engine has a plume from each nozzle that is drawn. They are worked
    // out one at a time and their light added together; they do not push on each other.
    vec3 emTotal = vec3(0.0);
    for (int e = 0; e < 2; e++) {
    if (e >= uExitCount) break;
    vec2 p = (frag - uExit - vec2(0.0, uExitOffsets[e])) / uRadius;
    float x = p.x;
    float y = abs(p.y);

    // The simulated plume also covers a strip beside the nozzle, upstream of its exit.
    if (x > (uUseSim > 0.5 ? -uSimUp : -0.05)) {
      float t = uTime;
      float xs = max(x, 0.0);

      // Jet boundary: oscillates through shock cells at low altitude, fans out in vacuum.
      float c = xs / uSpacing;
      // The jet closes in (or opens out) to its settled width within the first
      // shock cell, then ripples gently about it as the cells repeat.
      float settle = mix(uSettle, 1.0, exp(-c * 3.0));
      float ripple = -cos(6.28318 * (c - uPhase + 0.5)) * (1.0 - exp(-c * 4.0)) * exp(-c / 2.5);
      float rShock = settle * (1.0 + 0.13 * uDiamond * ripple);
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
      float yj = y / max(0.2, rShock);
      // A soft-edged diamond with a hot centre, wrapped in a wider glow.
      float dia = smoothstep(0.0, 0.75, 0.95 * (1.0 - 2.3 * abs(d)) - yj);
      dia = dia * dia * 1.6 + 0.35 * exp(-pow(d / 0.2, 2.0) - pow(yj / 0.6, 2.0));
      // The first diamond (the Mach disk) is by far the brightest.
      dia *= step(-0.5, k) * exp(-k * 0.7) * uDiamond * start;
      em += (uCore * 1.1 + 0.1) * dia * (0.75 + 0.5 * n2) * max(uOpacity, 0.8);

      // Criss-crossing shock waves that run from the nozzle lip to each diamond.
      float tri = abs(1.0 - 2.0 * fract(c - uPhase + 0.5));
      float lines = exp(-pow((yj - tri) / 0.11, 2.0)) * falloff(0.9, 1.05, rr);
      lines *= exp(-c * 1.3) * uDiamond * start * (0.5 + n2);
      em += uCore * lines * 0.2 * max(uOpacity, 0.6);

      if (uUseSim > 0.5) {
        // Fine turbulence the coarse grid cannot resolve: jiggle where we look.
        vec2 q = vec2(xs + (n2 - 0.5) * 0.14 * uTurb * min(1.0, xs * 0.25), y / (1.0 + 0.6 * wobble));
        // Beside the nozzle (x below zero) look at the gas exactly where it is.
        if (x < 0.0) q = vec2(x, y);
        vec2 size = uSimGrid * uSimCell - vec2(uSimUp, 0.0);
        // Thin the gas out toward the edges of the grid so it never ends in a straight line.
        float edgeFade = falloff(size.x - 0.1 - uSimFade.x, size.x - 0.1, xs)
                       * falloff(size.y - 0.05 - uSimFade.y, size.y - 0.05, y)
                       * smoothstep(-uSimUp, -0.4 * uSimUp, x);
        // The nozzle itself is drawn separately; nothing shows through it. The margin stops the
        // exhaust held inside the nozzle from blurring out past the wall where the grid is coarse.
        if (x < 0.0) {
          float wallR = max(0.3, 1.0 + uSimLip * x + uSimCurve * x * x);
          edgeFade *= smoothstep(wallR + 0.7 * uSimCell, wallR + 1.4 * uSimCell + 0.02, y);
        }

        // The plume is a round column and a camera sees right through it, so add up
        // the glow along the line of sight instead of showing a single slice.
        // Only look as far out as the plume can plausibly reach.
        float reach = mix(min(size.y, max(1.6, 1.3 * uSettle) + 0.16 * xs), size.y, clamp(uBloom * 2.0, 0.0, 1.0));
        // Looking into a nozzle extension, the far wall hides whatever is behind it, so only the
        // gas inside counts. Beside the extension the view is clear, and any exhaust that has
        // curled back around the outside of it is visible as usual.
        if (uWallOn > 0.5 && xs >= uWall.x && xs <= uWall.z) {
          float inner = mix(uWall.y, uWall.w, (xs - uWall.x) / max(1e-6, uWall.z - uWall.x));
          if (q.y < inner) reach = min(reach, inner);
        }
        float depth = sqrt(max(0.0, reach * reach - q.y * q.y));
        const int SAMPLES = 16;
        // Each pixel starts its samples at a slightly different depth so the steps don't show
        // as bands. A smooth, ordered pattern is used for that offset (interleaved gradient
        // noise) because a random one shows up as speckle; it shifts every frame so what is
        // left averages away.
        float jitter = fract(52.9829189 * fract(dot(frag, vec2(0.06711056, 0.00583715)))
                             + 0.61803399 * floor(uTime * 60.0));
        vec3 sum = vec3(0.0);
        for (int i = 0; i < SAMPLES; i++) {
          // Samples crowd toward the middle of the plume, where the gas is densest and brightest,
          // and each is weighted by the stretch of depth it stands for.
          float s = (float(i) + jitter) / float(SAMPLES);
          float z = depth * s * s;
          sum += simGlow(simGas(vec2(q.x, length(vec2(q.y, z))))) * (2.0 * s);
        }
        // Scaled so a path one exit radius long through the gas looks about as bright as the slice did.
        em = sum * (2.0 * depth / float(SAMPLES)) * 0.55;
        em *= (0.85 + 0.3 * n2) * sqrt(exp(-xs / uLen * 2.3)) * edgeFade;
      }

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
        // Simulated plume: the smoke is wherever the simulation says the exhaust went.
        if (uUseSim > 0.5) {
          // Smoke billows outward as it drifts downstream, which the gas solver alone does not capture.
          vec2 size = uSimGrid * uSimCell;
          float widen = 1.0 + 0.1 * xs * (0.5 + sn);
          float ys = y / widen;
          float reachS = min(size.y, 1.8 + 0.16 * xs);
          float depthS = sqrt(max(0.0, reachS * reachS - ys * ys));
          float amount = 0.0;
          for (int i = 0; i < 5; i++) {
            float z = (float(i) + 0.5) / 5.0 * depthS;
            vec3 gas = simGas(vec2(xs, length(vec2(ys, z))));
            amount += gas.x * gas.z * aboveFloor(gas);
          }
          amount *= 2.0 * depthS / 5.0 / widen;
          sm = (1.0 - exp(-amount * 1.6)) * smoothstep(0.4, 3.0, xs) * (0.5 + 0.5 * sn)
             * falloff(size.x - uSimUp - 0.1 - uSimFade.x, size.x - uSimUp - 0.1, xs);
        }
        sm *= clamp(smokeAmt, 0.0, 1.0) * uIntensity * thin * 0.9;
        float skyLight = 0.25 + 0.75 * dot(uSkyBottom, vec3(0.33));
        vec3 smokeCol = mix(vec3(0.42), vec3(0.9), sn) * skyLight + uMid * 0.25 * axial;
        col = mix(col, smokeCol, clamp(sm, 0.0, 0.92));
      }

      // The drawn plume knows nothing about a nozzle extension, so keep it inside the cone,
      // and let it open out gradually past the end instead of appearing all at once.
      // (The simulated plume needs none of this: the gas itself cannot pass through the wall.)
      if (uWallOn > 0.5 && uUseSim < 0.5 && xs >= uWall.x) {
        float allowed = xs <= uWall.z
          ? mix(uWall.y, uWall.w, (xs - uWall.x) / max(1e-6, uWall.z - uWall.x))
          : uWall.w + (xs - uWall.z) * 1.6;
        em *= 1.0 - smoothstep(allowed - 0.04, allowed + 0.12, y);
      }
      emTotal += em;
    }
    }

    // The flame hides the sky behind it in proportion to how bright it is,
    // so it keeps its colour against a daytime sky as well as in space.
    vec3 lit = 1.0 - exp(-emTotal * 2.4);
    float cover = clamp(max(lit.r, max(lit.g, lit.b)) * 1.5, 0.0, 1.0);
    col = col * (1.0 - cover) + lit;
  }

  outColor = vec4(col, 1.0);
}
`;
