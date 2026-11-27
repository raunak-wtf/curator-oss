"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const SOURCE = "/landing/landscape.webp";
const CELL = 2;
type Crop = { top: number; bottom: number };
const HERO_CROP: Crop = { top: 0.22, bottom: 0.84 };

const VERTEX = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAGMENT = `
precision mediump float;
uniform sampler2D uLum;
uniform vec2 uRes;
uniform vec2 uLumSize;
uniform float uTime;
uniform float uFadeTop;

float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 uv = px / uRes;

  float canvasAspect = uRes.x / uRes.y;
  float lumAspect = uLumSize.x / uLumSize.y;
  vec2 tuv = uv;
  if (canvasAspect > lumAspect) {
    tuv.y = uv.y * lumAspect / canvasAspect;
  } else {
    float s = canvasAspect / lumAspect;
    tuv.x = 0.5 + (uv.x - 0.5) * s;
  }
  float zoom = 1.0 - 0.02 * (0.5 + 0.5 * sin(uTime * 0.05));
  tuv = vec2(0.5, 0.0) + (tuv - vec2(0.5, 0.0)) * zoom;

  float v = texture2D(uLum, tuv).r;
  float dark = (1.0 - pow(v, 1.4)) * 0.85;

  vec2 q = vec2(uv.x * canvasAspect, uv.y) * 2.2;
  float mist = fbm(q + vec2(uTime * 0.08, uTime * 0.015));
  float wisps = fbm(q * 2.4 - vec2(uTime * 0.14, uTime * 0.02));
  dark += (mist - 0.5) * 0.32 + (wisps - 0.5) * 0.12;

  dark *= smoothstep(0.0, uFadeTop, uv.y);

  float threshold = bayer8(px) + 0.5 / 64.0;
  float on = step(threshold, clamp(dark, 0.0, 1.0));
  float alpha = on * 0.37;
  gl_FragColor = vec4(vec3(0.235) * alpha, alpha);
}
`;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

function luminance(img: HTMLImageElement, crop: Crop) {
  const width = Math.min(960, img.naturalWidth);
  const srcTop = img.naturalHeight * crop.top;
  const srcHeight = img.naturalHeight * (crop.bottom - crop.top);
  const height = Math.round((srcHeight / img.naturalWidth) * width);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, srcTop, img.naturalWidth, srcHeight, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  const gray = new Uint8Array(width * height);
  const histogram = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) {
    const g = Math.round(data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114);
    gray[i] = g;
    histogram[g]++;
  }
  const percentile = (p: number) => {
    let seen = 0;
    for (let g = 0; g < 256; g++) {
      seen += histogram[g];
      if (seen >= gray.length * p) return g;
    }
    return 255;
  };
  const lo = percentile(0.01);
  const hi = Math.max(lo + 1, percentile(0.99));
  for (let i = 0; i < gray.length; i++) {
    gray[i] = Math.max(0, Math.min(255, Math.round(((gray[i] - lo) / (hi - lo)) * 255)));
  }
  return { gray, width, height };
}

export function DitherBackdrop({
  className,
  fallback = "/landing/dither-hero.png",
  crop = HERO_CROP,
  fadeTop = 0.35,
}: {
  className?: string;
  fallback?: string;
  crop?: Crop;
  fadeTop?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const canvas = canvasRef.current;
    const gl = canvas?.getContext("webgl", { premultipliedAlpha: true, antialias: false });
    if (!canvas || !gl) return;

    const program = gl.createProgram();
    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    if (!program || !vs || !fs) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    const aPos = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(program, "uRes");
    const uLumSize = gl.getUniformLocation(program, "uLumSize");
    const uTime = gl.getUniformLocation(program, "uTime");
    const uFadeTop = gl.getUniformLocation(program, "uFadeTop");
    gl.uniform1f(uFadeTop, fadeTop);

    const img = new window.Image();
    img.src = SOURCE;
    let animId = 0;
    let disposed = false;

    img.onload = () => {
      if (disposed) return;
      const lum = luminance(img, crop);
      if (!lum) return;

      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.LUMINANCE,
        lum.width,
        lum.height,
        0,
        gl.LUMINANCE,
        gl.UNSIGNED_BYTE,
        lum.gray,
      );

      gl.uniform2f(uLumSize, lum.width, lum.height);
      setLive(true);

      const resize = () => {
        const wrap = wrapRef.current;
        if (!wrap) return;
        const rect = wrap.getBoundingClientRect();
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = Math.round((rect.width / CELL) * dpr);
        const h = Math.round((rect.height / CELL) * dpr);
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
          gl.viewport(0, 0, w, h);
          gl.uniform2f(uRes, w, h);
        }
      };
      resize();
      window.addEventListener("resize", resize);

      const start = performance.now();
      const loop = (now: number) => {
        if (disposed) return;
        gl.uniform1f(uTime, (now - start) * 0.001);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        animId = requestAnimationFrame(loop);
      };
      animId = requestAnimationFrame(loop);

      return () => {
        window.removeEventListener("resize", resize);
      };
    };

    return () => {
      disposed = true;
      cancelAnimationFrame(animId);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buffer);
    };
  }, [crop, fadeTop]);

  return (
    <div ref={wrapRef} className={cn("pointer-events-none select-none", className)}>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className={cn(
          "absolute inset-0 size-full transition-opacity duration-700",
          live ? "opacity-100" : "opacity-0",
        )}
      />
      {!live && fallback && (
        <Image
          src={fallback}
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-top opacity-35"
        />
      )}
    </div>
  );
}

export function AppDither({ className, fadeTop = 0.35 }: { className?: string; fadeTop?: number }) {
  return (
    <DitherBackdrop
      fadeTop={fadeTop}
      className={cn(
        "absolute overflow-hidden invert opacity-35",
        className,
      )}
    />
  );
}
