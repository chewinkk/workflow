// Minimal typings for the vendored liquidGL v2.0.1 (naughtyduk, MIT).
// The real, untyped implementation lives beside this file as liquidgl.js.
// Options (see README): target, snapshot, resolution, refraction, aberration,
// bevelDepth, bevelWidth, frost, shadow, specular, reveal, tilt, tiltFactor,
// tiltEase, magnify, on.init(instance).
export interface LiquidGLOptions {
  [key: string]: unknown;
  target?: string;
  snapshot?: string;
  resolution?: number;
  refraction?: number;
  aberration?: number;
  bevelDepth?: number;
  bevelWidth?: number;
  frost?: number;
  shadow?: boolean;
  specular?: boolean;
  reveal?: "none" | "fade";
  tilt?: boolean;
  tiltFactor?: number;
  tiltEase?: number;
  magnify?: number;
  on?: { init?: (instance: unknown) => void };
}
export type LiquidGLFactory = ((options?: LiquidGLOptions) => any) & {
  registerDynamic?: (elOrSelector: unknown) => void;
  syncWith?: (opts?: Record<string, unknown>) => unknown;
};
declare const liquidGL: LiquidGLFactory;
export default liquidGL;
