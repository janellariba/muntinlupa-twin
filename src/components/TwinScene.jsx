// TwinScene.jsx
// The 3D canvas: terrain, roads, sidewalks, buildings, barangay outlines and labels,
// AI-SUNOG camera markers, camera fly-to animation, and click/tap picking.
import { memo, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { MapControls, Html, Line } from "@react-three/drei";
import * as THREE from "three";
import { buildingColors, toThree } from "../lib/twinGeometry";

const BG = "#0d1417";
const CAMERA_MARKER_H = 25; // display only: marker height so it shows above rooftops
const CONE_LEN = 600;       // display only: drawn view-cone length, not a detection range

/* Smoothly moves the camera to target = { look:[x,y,z], dir:[dx,dy,dz], dist }. */
function CameraRig({ target }) {
  const { camera, controls } = useThree();
  const anim = useRef(null);
  useEffect(() => {
    if (!target || !controls) return;
    const look = new THREE.Vector3(...target.look);
    const off = new THREE.Vector3(...target.dir).normalize().multiplyScalar(target.dist);
    const instant = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    anim.current = { t: instant ? 1 : 0, p0: camera.position.clone(), q0: controls.target.clone(), p1: look.clone().add(off), q1: look };
  }, [target, controls, camera]);
  useFrame((_, dt) => {
    const a = anim.current;
    if (!a || !controls) return;
    a.t = Math.min(1, a.t + dt / 1.6);
    const k = 1 - Math.pow(1 - a.t, 3); // ease-out
    camera.position.lerpVectors(a.p0, a.p1, k);
    controls.target.lerpVectors(a.q0, a.q1, k);
    controls.update();
    if (a.t >= 1) anim.current = null;
  });
  return null;
}

/* Picking on the canvas element: a click/tap that did not drag selects a building;
   mouse movement updates the coordinate readout (throttled to once per frame).
   R3F's own pointer events would raycast the 2M-vertex building mesh on every move. */
function Picker({ buildingsRef, terrainRef, onPick, onHover }) {
  const { camera, gl } = useThree();
  useEffect(() => {
    const el = gl.domElement;
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let down = null, pending = false;
    const aim = (e) => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
    };
    const onDown = (e) => { if (e.isPrimary) down = [e.clientX, e.clientY]; };
    const onUp = (e) => {
      if (!e.isPrimary || !down) return;
      const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]);
      down = null;
      if (moved > (e.pointerType === "touch" ? 10 : 4)) return; // it was a drag, not a tap
      aim(e);
      const mesh = buildingsRef.current;
      const hit = mesh && mesh.visible ? ray.intersectObject(mesh, false)[0] : null;
      // Where on the map was clicked: the building hit, otherwise the terrain under the pointer.
      const ground = hit || (terrainRef.current ? ray.intersectObject(terrainRef.current, false)[0] : null);
      onPick({ tri: hit ? hit.faceIndex : null, point: ground ? { x: ground.point.x, y: -ground.point.z } : null });
    };
    const onMove = (e) => {
      if (e.pointerType !== "mouse" || pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        const mesh = terrainRef.current;
        if (!mesh) return;
        aim(e);
        const hit = ray.intersectObject(mesh, false)[0];
        onHover(hit ? { x: hit.point.x, y: -hit.point.z } : null);
      });
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointermove", onMove);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointermove", onMove);
    };
  }, [camera, gl, buildingsRef, terrainRef, onPick, onHover]);
  return null;
}

/* ---------- Wind animation ----------
   Small dark comet marks drift across the city in the current wind direction, like a wind map.
   One wind value covers the whole city (it comes from the weather model's grid point), so every
   mark moves the same way. Real wind is too slow to see at city scale, so motion is sped up. */
export const WIND_SPEEDUP = 40;    // display only: animation speed multiplier
const WIND_HEIGHT = 35;            // display only: marks float 35 m above the ground
const MARK_SCREEN = 0.022;         // display only: mark length as a fraction of camera distance (about 12-15 px at any zoom)
function WindParticles({ wind, twin }) {
  const { camera, controls } = useThree();
  const count = typeof window !== "undefined" && window.innerWidth < 768 ? 1200 : 2600; // fewer on phones
  const { ground, meta } = twin;
  const D = meta.dem;
  const box = { x0: D.left, x1: D.left + D.w * D.res, y0: D.top - D.h * D.res, y1: D.top };

  // Particle state: position (local meters), age and lifetime (seconds).
  // Marks spawn within a radius of the point being looked at; the radius grows with zoom-out,
  // so the number of marks on screen stays roughly the same at any zoom level.
  const st = useMemo(() => {
    const p = new Float32Array(count * 2), age = new Float32Array(count), life = new Float32Array(count);
    const view = { cx: 0, cy: 0, r: 9000 };
    const spawn = (i) => {
      for (let t = 0; t < 30; t++) { // only over the city (DEM cells outside it are 0)
        const ang = Math.random() * Math.PI * 2, d = view.r * Math.sqrt(Math.random());
        const x = view.cx + Math.cos(ang) * d, y = view.cy + Math.sin(ang) * d;
        if (x > box.x0 && x < box.x1 && y > box.y0 && y < box.y1 && ground(x, y) > 0) { p[i * 2] = x; p[i * 2 + 1] = y; break; }
      }
      age[i] = 0; life[i] = 2.5 + Math.random() * 4;
    };
    for (let i = 0; i < count; i++) { spawn(i); age[i] = Math.random() * life[i]; }
    return { p, age, life, spawn, view };
  }, [count, twin]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tails (line segments) and heads (dots). Colors are RGBA so each mark can fade in and out.
  const { lines, heads } = useMemo(() => {
    const l = new THREE.BufferGeometry();
    l.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 6), 3));
    l.setAttribute("color", new THREE.BufferAttribute(new Float32Array(count * 8), 4));
    const h = new THREE.BufferGeometry();
    h.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    h.setAttribute("color", new THREE.BufferAttribute(new Float32Array(count * 4), 4));
    return { lines: l, heads: h };
  }, [count]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const ms = (wind.speedKmh / 3.6) * WIND_SPEEDUP;        // m/s on screen
    const b = ((wind.fromDeg + 180) * Math.PI) / 180;       // direction the air moves TO
    const ux = Math.sin(b), uy = Math.cos(b);               // x = east, y = north
    const camDist = controls ? camera.position.distanceTo(controls.target) : 5000;
    const len = Math.min(500, Math.max(10, camDist * MARK_SCREEN)); // short mark, similar size at any zoom
    const { view } = st;
    if (controls) { view.cx = controls.target.x; view.cy = -controls.target.z; }
    view.r = Math.min(12000, Math.max(500, camDist * 1.2));
    const far2 = (view.r * 1.4) ** 2;
    const lp = lines.attributes.position.array, lc = lines.attributes.color.array;
    const hp = heads.attributes.position.array, hc = heads.attributes.color.array;
    const { p, age, life, spawn } = st;
    for (let i = 0; i < count; i++) {
      age[i] += dt;
      let x = p[i * 2] + ux * ms * dt, y = p[i * 2 + 1] + uy * ms * dt;
      const out = (x - view.cx) ** 2 + (y - view.cy) ** 2 > far2; // left the area in view (e.g. after flying)
      if (out || age[i] > life[i] || ground(x, y) <= 0 || x < box.x0 || x > box.x1 || y < box.y0 || y > box.y1) {
        spawn(i); x = p[i * 2]; y = p[i * 2 + 1];
      }
      p[i * 2] = x; p[i * 2 + 1] = y;
      const tx = x - ux * len, ty = y - uy * len;
      const head = toThree(x, y, ground(x, y) + WIND_HEIGHT);
      lp.set(head, i * 6);
      lp.set(toThree(tx, ty, ground(tx, ty) + WIND_HEIGHT), i * 6 + 3);
      hp.set(head, i * 3);
      const a = Math.sin((Math.PI * age[i]) / life[i]);      // fade in and out over its life
      // dark grey-green marks; the tail end is fully transparent
      lc.set([0.1, 0.13, 0.12, 0.85 * a, 0.1, 0.13, 0.12, 0], i * 8);
      hc.set([0.07, 0.09, 0.08, 0.95 * a], i * 4);
    }
    lines.attributes.position.needsUpdate = true; lines.attributes.color.needsUpdate = true;
    heads.attributes.position.needsUpdate = true; heads.attributes.color.needsUpdate = true;
  });

  return (
    <group renderOrder={5}>
      <lineSegments geometry={lines} frustumCulled={false}>
        <lineBasicMaterial vertexColors transparent depthWrite={false} />
      </lineSegments>
      <points geometry={heads} frustumCulled={false}>
        <pointsMaterial vertexColors transparent depthWrite={false} size={3.2} sizeAttenuation={false} />
      </points>
    </group>
  );
}

/* Barangay outline highlight. Drawn on top of everything so hills and buildings never hide it. */
function BarangayOutline({ rec, color, width, opacity }) {
  return rec.outlines.map((pts, i) => (
    <Line key={i} points={pts} color={color} lineWidth={width} transparent opacity={opacity} depthTest={false} renderOrder={20} />
  ));
}

/* One camera: rooftop pin, optional view cone, and a name label. */
function CameraMarker({ cam, ground }) {
  const g = ground(cam.x, cam.y);
  const cone = useMemo(() => {
    if (cam.heading == null || cam.fov == null) return null;
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    for (let k = 0; k <= 24; k++) {
      const b = ((cam.heading - cam.fov / 2 + (cam.fov * k) / 24) * Math.PI) / 180;
      s.lineTo(Math.sin(b) * CONE_LEN, Math.cos(b) * CONE_LEN); // x = east, y = north
    }
    const geo = new THREE.ShapeGeometry(s);
    geo.rotateX(-Math.PI / 2); // north (+y) becomes -z, matching toThree()
    return geo;
  }, [cam.heading, cam.fov]);
  return (
    <group>
      <mesh position={toThree(cam.x, cam.y, g + CAMERA_MARKER_H / 2)}>
        <cylinderGeometry args={[6, 6, CAMERA_MARKER_H, 12]} />
        <meshBasicMaterial color="#f2a33a" />
      </mesh>
      {cone && (
        <mesh geometry={cone} position={toThree(cam.x, cam.y, g + CAMERA_MARKER_H)}>
          <meshBasicMaterial color="#f2a33a" transparent opacity={0.22} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}
      <Html position={toThree(cam.x, cam.y, g + CAMERA_MARKER_H + 20)} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <div className="whitespace-nowrap font-display text-sm font-semibold uppercase tracking-wider text-accent [text-shadow:0_1px_3px_#000,0_0_8px_#000]">
          {cam.name}
        </div>
      </Html>
    </group>
  );
}

const Scene = memo(function Scene({ twin, buildings, visible, colorMode, flyTarget, selected, selectedBrgy, hoverBrgy, cams, wind, autoOrbit, onPick, onHover }) {
  const buildingsRef = useRef();
  const terrainRef = useRef();

  // Swap building colors in place when the color mode changes (no geometry rebuild).
  const colorCache = useRef({});
  useEffect(() => {
    const { geometry, vStart } = twin.buildings;
    colorCache.current[colorMode] ??= buildingColors(buildings, twin.meta.building_types, vStart, colorMode);
    const attr = geometry.getAttribute("color");
    attr.array.set(colorCache.current[colorMode]);
    attr.needsUpdate = true;
  }, [twin, buildings, colorMode]);

  // Highlight for the selected building, copied out of the merged mesh.
  const highlight = useMemo(() => {
    if (selected == null) return null;
    const { geometry, vStart } = twin.buildings;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(geometry.getAttribute("position").array.slice(vStart[selected] * 3, vStart[selected + 1] * 3), 3));
    return g;
  }, [twin, selected]);

  return (
    <>
      <color attach="background" args={[BG]} />
      <fog attach="fog" args={[BG, 11000, 34000]} />
      <hemisphereLight args={[0xdfeeff, 0x2a2a22, 1.1]} />
      <directionalLight position={[-4000, 6000, 3000]} intensity={1.6} />

      <mesh rotation-x={-Math.PI / 2} position-y={-2}>
        <planeGeometry args={[80000, 80000]} />
        <meshLambertMaterial color="#14242a" />
      </mesh>

      <mesh ref={terrainRef} geometry={twin.terrain} visible={visible.terrain}>
        <meshLambertMaterial vertexColors />
      </mesh>
      {/* polygonOffset pulls the flat layers toward the camera so they never flicker into the terrain */}
      <mesh geometry={twin.sidewalks} visible={visible.sidewalks}>
        <meshBasicMaterial vertexColors polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
      </mesh>
      <mesh geometry={twin.roads} visible={visible.roads}>
        <meshBasicMaterial vertexColors polygonOffset polygonOffsetFactor={-3} polygonOffsetUnits={-3} />
      </mesh>
      <mesh ref={buildingsRef} geometry={twin.buildings.geometry} visible={visible.buildings}>
        <meshLambertMaterial vertexColors />
      </mesh>
      {highlight && visible.buildings && (
        <mesh geometry={highlight} renderOrder={10}>
          <meshBasicMaterial color="#ffffff" transparent opacity={0.4} depthTest={false} />
        </mesh>
      )}

      {visible.barangays && (
        <>
          <lineSegments geometry={twin.boundaries}>
            <lineBasicMaterial color="#ffffff" transparent opacity={0.75} />
          </lineSegments>
          {twin.labels.map((l) => (
            <Html key={l.name} position={l.position} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
              <div className="whitespace-nowrap font-display text-xs font-semibold uppercase tracking-wider text-white [text-shadow:0_1px_3px_#000,0_0_8px_#000] sm:text-sm">
                {l.name}
              </div>
            </Html>
          ))}
        </>
      )}

      {hoverBrgy && hoverBrgy !== selectedBrgy && (
        <BarangayOutline rec={twin.barangayIndex.find((b) => b.name === hoverBrgy)} color="#ffffff" width={2.5} opacity={0.75} />
      )}
      {selectedBrgy && <BarangayOutline rec={twin.barangayIndex.find((b) => b.name === selectedBrgy)} color="#f2a33a" width={4.5} opacity={1} />}

      {visible.cameras && cams.map((c) => <CameraMarker key={c.id} cam={c} ground={twin.ground} />)}
      {visible.wind && wind && <WindParticles wind={wind} twin={twin} />}

      <MapControls makeDefault enableDamping minDistance={60} maxDistance={32000} maxPolarAngle={Math.PI * 0.47} autoRotate={autoOrbit} autoRotateSpeed={0.6} />
      <CameraRig target={flyTarget} />
      <Picker buildingsRef={buildingsRef} terrainRef={terrainRef} onPick={onPick} onHover={onHover} />
    </>
  );
});

export default function TwinScene(props) {
  return (
    <Canvas
      className="!absolute inset-0 touch-none"
      dpr={[1, 2]}
      camera={{ position: [6000, 9000, 10000], fov: 45, near: 5, far: 60000 }}
      gl={{ antialias: true, logarithmicDepthBuffer: true }}
    >
      {props.twin && <Scene {...props} />}
    </Canvas>
  );
}
