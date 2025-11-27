// CRT simulation - main.js
// Simple 2D side-view with accelerating voltage, deflection plates (uniform field), and optional magnetic deflection

// Physical constants
const E_CHARGE = 1.602e-19; // magnitude of Coulombs
const ELECTRON_CHARGE = -E_CHARGE; // electron charge is negative
const E_MASS = 9.109e-31; // kg

// Canvas & UI
const canvas = document.getElementById('crt-canvas');
const ctx = canvas.getContext('2d');
const accelSlider = document.getElementById('accel-slider');
const deflectSlider = document.getElementById('deflect-slider');
const accelReadout = document.getElementById('accel-readout');
const deflectReadout = document.getElementById('deflect-readout');
const hitY = document.getElementById('hit-y');
const hitPx = document.getElementById('hit-px');
const v0Readout = document.getElementById('v0');
const ayReadout = document.getElementById('ay');
const fireBtn = document.getElementById('fire-btn');
const magneticToggle = document.getElementById('magnetic-toggle');
const autoFire = document.getElementById('auto-fire');
// resetBtn and mode3DToggle are already declared above
const locomotionToggle = document.getElementById('locomotion-toggle');
const beamWidthSlider = document.getElementById('beam-width-slider');
const beamWidthRead = document.getElementById('beam-width-read');
const resetBtn = document.getElementById('reset-btn');
const mode3DToggle = document.getElementById('mode-3d');
const clearHitsBtn = document.getElementById('clear-hits');
const accumulateHitsToggle = document.getElementById('accumulate-hits');
const vectorToggle = document.getElementById('vector-toggle');
const plateSpacingSlider = document.getElementById('plate-spacing-slider');
const plateSpacingRead = document.getElementById('plate-spacing-read');
const plateLengthSlider = document.getElementById('plate-length-slider');
const plateLengthRead = document.getElementById('plate-length-read');
const platePosSlider = document.getElementById('plate-pos-slider');
const platePosRead = document.getElementById('plate-pos-read');
const multiCountSlider = document.getElementById('multi-count');
const multiCountRead = document.getElementById('multi-count-read');
const hudDiv = document.getElementById('hud');

// Coordinates & scale (scene in meters; convert to pixels)
const scene = {
  width_m: 0.5, // 50 cm long tube (meter)
  height_m: 0.25, // 25 cm tall
  gun_x_m: 0.02, // electron gun at 2 cm inside
  plate_x_m: 0.18, // start of deflection plate
  plate_length_m: 0.06, // plate region length 6 cm
  plate_spacing_m: 0.010,
  screen_x_m: 0.46, // screen at 46 cm
};

// Derived pixel scale
function computeScale() {
  const pxWidth = canvas.width;
  const pxHeight = canvas.height;
  return {
    pxPerMeterX: pxWidth / scene.width_m,
    pxPerMeterY: pxHeight / scene.height_m
  };
}

let scale = computeScale();
// Three.js variables
let use3D = false;
let three = null;
let scene3d, camera3d, renderer3d, electronMesh3d, pathLine3d, screenMesh3d, plateTopMesh, plateBottomMesh;
let orbitControls;
let enableLocomotion = false;
let beamMesh3d = null;
let keysDown = {};

// locomotion event handling (WASD + space/shift for up/down)
window.addEventListener('keydown', (e) => {
  if (!enableLocomotion) return;
  const k = e.key.toLowerCase();
  keysDown[k] = true;
  if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
});
window.addEventListener('keyup', (e) => {
  if (!enableLocomotion) return;
  const k = e.key.toLowerCase();
  keysDown[k] = false;
});

function updateLocomotion(dt) {
  if (!camera3d) return;
  const speed = 0.5; // meters per second
  const moveAmount = speed * dt;
  // compute forward and right vectors (ignore camera tilt for movement)
  const forward = new THREE.Vector3();
  camera3d.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();
  const right = new THREE.Vector3();
  right.crossVectors(forward, camera3d.up).normalize();
  if (keysDown['w'] || keysDown['arrowup']) camera3d.position.addScaledVector(forward, moveAmount);
  if (keysDown['s'] || keysDown['arrowdown']) camera3d.position.addScaledVector(forward, -moveAmount);
  if (keysDown['a'] || keysDown['arrowleft']) camera3d.position.addScaledVector(right, -moveAmount);
  if (keysDown['d'] || keysDown['arrowright']) camera3d.position.addScaledVector(right, moveAmount);
  if (keysDown[' ']) camera3d.position.y += moveAmount; // space = up
  if (keysDown['shift']) camera3d.position.y -= moveAmount; // shift = down
}

// Visual tune-ups
const electronRadiusPx = 3;
const trackAlpha = 0.8;
const hitFadeSeconds = 1.2; // how long the dot fades

// State
let hits = []; // {x_px, y_px, time}
let lastFire = 0;
let autoFireIntervalId = null;

// Helper conversions
function mToPxX(x_m) { return x_m * scale.pxPerMeterX; }
function mToPxY(y_m) { return canvas.height - y_m * scale.pxPerMeterY; }

// Physics: calculate initial forward speed v0 from accelerating voltage V_acc
function computeInitialSpeed(V_acc) {
  // kinetic energy = e * V_acc = 0.5 * m * v^2
  // Use magnitude of electron charge for energy; increasing voltage increases kinetic energy.
  return Math.sqrt((2 * E_CHARGE * V_acc) / E_MASS);
}

// Given accelerations, compute vertical acceleration inside plate region due to E field (E = V_plate / d)
// We'll approximate plate spacing as 1 cm (0.01 m) for simplicity.
function computePlateVerticalAccel(V_plate) {
  // E field magnitude = V_plate / d (V/m). Force = q * E; acceleration = F/m
  const d = (scene.plate_spacing_m || 0.010);
  const E_field = V_plate / d; // V/m
  // Use electron charge sign here (negative): a = qE/m; this means a positive V_plate causes a downward push on electrons by default,
  // but for the visualization we keep the sign intuitive: positive V_plate causes a positive a_y.
  // To keep things simple for learners, treat slider sign to correspond directly to visual upward deflection,
  // so we invert the electron sign here for an intuitive mapping.
  return (-ELECTRON_CHARGE * E_field) / E_MASS; // m/s^2 positive upward when V_plate>0
}

// Magnetic deflection: small placeholder - field along z causes force q v B -> a_y = q v_x B / m
function computeMagneticAccelFromB(B_tesla, v_x) {
  // a = q v B / m; use electron charge (negative) so sign is correct; then invert to match visualization so positive B deflects upward
  return (ELECTRON_CHARGE * v_x * B_tesla) / E_MASS;
}

// Main function: compute piecewise motion and impact point on screen
function computeTrack(V_acc, V_plate, isMagnetic=false) {
  // geometry: electron starts at gun_x_m, vertical center (y = 0 in meters at centerline)
  const x0 = scene.gun_x_m;
  const y0 = scene.height_m / 2; // centerline slope

  // initial forward speed
  let v0x = computeInitialSpeed(V_acc); // m/s
  if (!Number.isFinite(v0x) || v0x <= 1e-12) v0x = 1e-12; // fallback to avoid division by zero
  const v0y = 0; // initially no vertical speed

  // inside plates: from plate_x to plate_x + plate_length
  const plateStart = scene.plate_x_m;
  const plateEnd = scene.plate_x_m + scene.plate_length_m;

  // Time to reach start of plates: t1
  const dx1 = plateStart - x0; // meters
  const t1 = dx1 / v0x;

  // Vertical position and velocity at plate entry
  const y_entry = y0 + v0y * t1; // just y0
  const v_entry_y = v0y;

  const dx_plate = scene.plate_length_m;
  const t_plate = dx_plate / v0x;

  // Acceleration inside plates
  let a_plate = computePlateVerticalAccel(V_plate); // m/s^2
  if (isMagnetic) {
    // Approximate magnetic field that produces similar bending: we map V_plate to B (not physically linked)
    // For a given V_plate slider value, produce a B that approximates same deflection magnitude
    // Use simple scaling factor to show curved path; pick B such that a_mag ~= a_plate for v_x.
    const B_equiv = (a_plate * E_MASS) / (ELECTRON_CHARGE * v0x + 1e-20); // avoid divide by zero
    // For magnetic deflection, acceleration is perpendicular to velocity and depends on v; we compute instantaneous curvature later.
    a_plate = 0; // no E-accel inside plates if magnetically deflecting here
    // We'll use B_equiv for curvature in magnetic mode
    return computeMagneticTrack(x0, y0, v0x, plateStart, plateEnd, B_equiv);
  }

  // vertical velocity after plates
  const v_exit_y = v_entry_y + a_plate * t_plate;

  // vertical position after plates
  const y_exit = y_entry + v_entry_y * t_plate + 0.5 * a_plate * t_plate * t_plate;

  // Now drift region: from plateEnd to screen_x
  const dx_drift = scene.screen_x_m - plateEnd;
  const t_drift = dx_drift / v0x;

  // final vertical position on screen
  const y_screen = y_exit + v_exit_y * t_drift;

  // ensure it's within visible bounds
  const y_clamped = Math.max(0, Math.min(scene.height_m, y_screen));

  // Also compute impact point pixel coordinates
  const x_screen_px = mToPxX(scene.screen_x_m);
  const y_screen_px = mToPxY(y_clamped);

  // collect path segments for drawing: pre-plate straight, inside plate bent parabola, post-plate straight
  // Use arrays of {x_m, y_m}
  const path = [];

  // Pre-plate segment - straight line from gun to plateStart
  path.push({x: x0, y: y0});
  path.push({x: plateStart, y: y_entry});

  // Plate region - parametric (x increases linearly with time): use small steps
  const stepsPlate = 30;
  for (let i=1;i<=stepsPlate;i++) {
    const frac = i/stepsPlate;
    const x = plateStart + frac * dx_plate;
    const t_local = (frac * dx_plate) / v0x; // time inside plate from start
    const y = y_entry + v_entry_y * t_local + 0.5 * a_plate * t_local * t_local;
    path.push({x, y});
  }

  // Post-plate: final straight line to screen - use two points
  path.push({x: plateEnd + dx_drift*0.4, y: y_exit + v_exit_y * (dx_drift*0.4 / v0x)});
  path.push({x: scene.screen_x_m, y: y_screen});

  return {
    path,
    v0x,
    v_entry_y,
    v_exit_y,
    y_screen_m: y_clamped,
    y_screen_px
  };
}

// compute track but allow initial y offset or initial vy (for multiple-electron beams)
function computeTrackWithOffset(V_acc, V_plate, isMagnetic=false, yOffset = 0, vyInitial = 0) {
  const base = computeTrack(V_acc, V_plate, isMagnetic);
  // Recompute path using small yOffset: we will produce a shifted path by adding offset to each y
  const path = base.path.map(p => ({x: p.x, y: p.y + yOffset}));
  const y_screen_m = base.y_screen_m + yOffset;
  return { path, v0x: base.v0x, v_entry_y: base.v_entry_y, v_exit_y: base.v_exit_y, y_screen_m, y_screen_px: mToPxY(y_screen_m) };
}

// Magnetic curved track: integrate small steps with Lorentz force
function computeMagneticTrack(x0, y0, v0x, plateStart, plateEnd, B_tesla) {
  // We'll integrate from x0 to screen_x_m with small dt steps using x-trajectory stepping
  const fullDx = scene.screen_x_m - x0;
  const stepsTotal = 400; // small step integration
  const safeVx = (Number.isFinite(v0x) && v0x > 1e-12) ? v0x : 1e-12;
  const dtStep = (fullDx / safeVx) / stepsTotal; // seconds per step

  let x = x0;
  let y = y0;
  let v_x = v0x;
  let v_y = 0;
  const path = [{x, y}];

  for (let i=0;i<stepsTotal;i++) {
    // Lorentz force for charged particle with B along z: a_y = q * v_x * B / m; a_x stays ~0 (we assume B doesn't change v_x magnitude solidly)
    const a_y = computeMagneticAccelFromB(B_tesla, v_x);

    // inside plate region, we apply B only; after plates we might turn off B to mimic magnetic deflection by magnet coils near center? For simplicity, apply B across the 'plate' region only.
    const currentX = x;
    const isInsidePlates = (currentX >= plateStart && currentX <= plateEnd);
    const a_y_effective = isInsidePlates ? a_y : 0;

    v_y += a_y_effective * dtStep;
    x += v_x * dtStep; // v_x assumed constant
    y += v_y * dtStep;
    path.push({x, y});
  }

  const y_final = Math.max(0, Math.min(scene.height_m, y));
  return {
    path,
    v0x,
    y_screen_m: y_final,
    y_screen_px: mToPxY(y_final)
  };
}

// Reset simulation: clear hits, stop auto-fire, clear 3D and 2D previews
function resetSimulation() {
  hits = [];
  clearInterval(autoFireIntervalId);
  autoFireIntervalId = null;
  autoFire.checked = false;
  hitY.textContent = '—';
  hitPx.textContent = '—';
  v0Readout.textContent = '—';
  ayReadout.textContent = '—';
  // remove 3D path and dots
  if (scene3d && pathLine3d) {
    scene3d.remove(pathLine3d);
    try { pathLine3d.geometry.dispose(); pathLine3d.material.dispose(); } catch(e){}
    pathLine3d = null;
  }
  if (scene3d) {
    // remove hit dots
    try { scene3d.children.filter(c => c.userData && c.userData.isHitDot).forEach(dot => scene3d.remove(dot)); } catch(e){}
  }
  // ensure 2D canvas is shown
  document.getElementById('threejs-container').style.display = 'none';
  document.getElementById('crt-canvas').style.display = 'block';
  drawScene();
}

// Draw utilities
function drawScene() {
  ctx.clearRect(0,0,canvas.width,canvas.height);
  // draw tube
  ctx.fillStyle = '#061a26';
  ctx.fillRect(0,0,canvas.width,canvas.height);

  // draw centerline
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, canvas.height / 2);
  ctx.lineTo(canvas.width, canvas.height / 2);
  ctx.stroke();

  // draw rulers / tick marks along tube (x axis in cm)
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  const cmPerTick = 2; // tick every 2 cm
  const ticks = Math.floor(scene.width_m * 100 / cmPerTick);
  for (let i = 0; i <= ticks; i++) {
    const x_m = i * (cmPerTick / 100);
    const px = mToPxX(x_m);
    ctx.beginPath();
    ctx.moveTo(px, canvas.height - 8);
    ctx.lineTo(px, canvas.height - 1);
    ctx.stroke();
    if (i % 5 === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillText(`${(x_m*100).toFixed(0)}cm`, px+2, canvas.height - 10);
    }
  }

  // draw gun
  ctx.fillStyle = '#f7c34a';
  const gunXpx = mToPxX(scene.gun_x_m);
  const gunYpx = mToPxY(scene.height_m / 2);
  ctx.beginPath();
  ctx.ellipse(gunXpx - 8, gunYpx, 8, 12, 0, 0, Math.PI*2);
  ctx.fill();

  // draw plates
  const plateStartPx = mToPxX(scene.plate_x_m);
  const plateEndPx = mToPxX(scene.plate_x_m + scene.plate_length_m);
  const centerY_m = scene.height_m / 2;
  const spacing = scene.plate_spacing_m || 0.010;
  const plateTopY = mToPxY(centerY_m + spacing/2);
  const plateBottomY = mToPxY(centerY_m - spacing/2);
  ctx.strokeStyle = '#66c2ff';
  ctx.lineWidth = 4;
  // top plate
  ctx.beginPath();
  ctx.moveTo(plateStartPx, plateTopY);
  ctx.lineTo(plateEndPx, plateTopY);
  ctx.stroke();
  // bottom plate
  ctx.beginPath();
  ctx.moveTo(plateStartPx, plateBottomY);
  ctx.lineTo(plateEndPx, plateBottomY);
  ctx.stroke();

  // draw screen
  ctx.fillStyle = '#091b1f';
  const screenX = mToPxX(scene.screen_x_m);
  ctx.fillRect(screenX-2, 0, 4, canvas.height);

  // draw hits (persistent, fading)
  const now = performance.now() / 1000.0;
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    const age = now - hit.t;
    if (age > hitFadeSeconds) continue; // skip

    const alpha = Math.max(0, 1.0 - age / hitFadeSeconds);
    // radial glow
    const radius = electronRadiusPx + 6 * alpha;
    const gradient = ctx.createRadialGradient(hit.x, hit.y, 0, hit.x, hit.y, radius);
    gradient.addColorStop(0, `rgba(255, 230, 120, ${0.7*alpha})`);
    gradient.addColorStop(0.7, `rgba(255, 120, 30, ${0.25*alpha})`);
    gradient.addColorStop(1, `rgba(0,0,0,0)`);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(hit.x, hit.y, radius, 0, Math.PI*2);
    ctx.fill();
  }
}

// --- 3D Scene setup ---
function init3D() {
  if (scene3d) return;
  scene3d = new THREE.Scene();
  const width = document.getElementById('threejs-container').clientWidth;
  const height = 400; // fixed
  camera3d = new THREE.PerspectiveCamera(40, width / height, 0.01, 100);
  camera3d.position.set(0.25, scene.height_m / 2, 0.7);
  camera3d.lookAt(new THREE.Vector3(0.25, scene.height_m / 2, 0));

  renderer3d = new THREE.WebGLRenderer({antialias: true, alpha: true});
  renderer3d.setSize(width, height);
  renderer3d.setPixelRatio(window.devicePixelRatio || 1);
  const container = document.getElementById('threejs-container');
  container.appendChild(renderer3d.domElement);

  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene3d.add(ambient);
  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(0.5, 0.6, 0.6);
  scene3d.add(dir);

  // Add a simple room: screen plane and plates
  const screenGeom = new THREE.PlaneGeometry(0.01, scene.height_m);
  const screenMat = new THREE.MeshBasicMaterial({color: 0x0b1b1d});
  screenMesh3d = new THREE.Mesh(screenGeom, screenMat);
  screenMesh3d.position.set(scene.screen_x_m - scene.width_m/2, scene.height_m/2, 0);
  screenMesh3d.rotateY(Math.PI/2);
  scene3d.add(screenMesh3d);

  // plates
  const plateThickness = 0.002;
  const plateLength = scene.plate_length_m;
  const plateTopGeom = new THREE.BoxGeometry(plateLength, plateThickness, 0.02);
  const plateMat = new THREE.MeshLambertMaterial({color: 0x66c2ff});
  plateTopMesh = new THREE.Mesh(plateTopGeom, plateMat);
  scene3d.add(plateTopMesh);
  plateBottomMesh = new THREE.Mesh(plateTopGeom, plateMat);
  // 3D plate positions will be set after creation below based on spacing
  // position based on spacing
  const centerY = scene.height_m/2;
  const spacing = scene.plate_spacing_m || 0.010;
  plateTopMesh.position.set(scene.plate_x_m + plateLength/2 - scene.width_m/2, centerY + spacing/2, 0);
  plateBottomMesh.position.set(scene.plate_x_m + plateLength/2 - scene.width_m/2, centerY - spacing/2, 0);
  scene3d.add(plateBottomMesh);

  // gun
  const gunGeom = new THREE.SphereGeometry(0.008, 12, 12);
  const gunMat = new THREE.MeshLambertMaterial({color: 0xffc34a});
  const gun = new THREE.Mesh(gunGeom, gunMat);
  gun.position.set(scene.gun_x_m - scene.width_m/2, scene.height_m/2, 0);
  scene3d.add(gun);

  // electron sphere
  const electronGeom = new THREE.SphereGeometry(0.005, 8, 8);
  const electronMat = new THREE.MeshBasicMaterial({color: 0xffeb6b});
  electronMesh3d = new THREE.Mesh(electronGeom, electronMat);
  scene3d.add(electronMesh3d);

  // orbit controls
  try {
    orbitControls = new THREE.OrbitControls(camera3d, renderer3d.domElement);
    orbitControls.target.set(0, scene.height_m/2, 0);
    orbitControls.update();
  } catch (e) {
    orbitControls = null;
  }
  // pointer lock for mouse-look when locomotion mode is enabled
  try {
    renderer3d.domElement.addEventListener('click', () => {
      if (enableLocomotion) renderer3d.domElement.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === renderer3d.domElement;
      if (locked) {
        // disable orbit controls
        if (orbitControls) orbitControls.enabled = false;
        // initialize custom rotation state
        camera3d.userData.yaw = camera3d.rotation.y;
        camera3d.userData.pitch = camera3d.rotation.x;
      } else {
        if (orbitControls) orbitControls.enabled = !enableLocomotion;
      }
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== renderer3d.domElement) return;
      const sensitivity = 0.0025;
      camera3d.userData.yaw -= e.movementX * sensitivity;
      camera3d.userData.pitch -= e.movementY * sensitivity;
      camera3d.userData.pitch = Math.max(-Math.PI/2 + 0.05, Math.min(Math.PI/2 - 0.05, camera3d.userData.pitch));
      camera3d.rotation.set(camera3d.userData.pitch, camera3d.userData.yaw, 0);
    });
  } catch (e) {
    // pointer lock not supported or failed gracefully
  }
}

function draw3DPath(track) {
  if (!scene3d) init3D();
  if (pathLine3d) {
    scene3d.remove(pathLine3d);
    try { pathLine3d.geometry.dispose(); pathLine3d.material.dispose(); } catch(e){}
    pathLine3d = null;
  }
  const points = track.path.map(p => {
    // center around origin for camera convenience
    return new THREE.Vector3(p.x - scene.width_m/2, p.y, 0);
  });
  // build a tube so the ray shows a more volumetric beam
  const curve = new THREE.CatmullRomCurve3(points);
  const beamRadius_m = (Number(beamWidthSlider.value) / 2) / scale.pxPerMeterY; // convert px to meters
  // validate points (avoid NaN or infinite values)
  const goodPoints = points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
  if (goodPoints.length < 2) {
    // nothing to draw; points invalid or too few
    if (!draw3DPath._warnedMissingPoints) {
      console.warn('draw3DPath: Not enough valid points to build TubeGeometry (skipping)');
      draw3DPath._warnedMissingPoints = true;
    }
    return;
  }
  // ensure we don't pass degenerate geometry
  // map goodPoints to array of THREE.Vector3 for curve
  const uniquePoints = goodPoints.filter((p, idx, arr) => idx === 0 || !p.equals(arr[idx-1]));
  if (uniquePoints.length < 2) {
    if (!draw3DPath._warnedDegenerate) {
      console.warn('draw3DPath: Tube path points are degenerate (skipping)');
      draw3DPath._warnedDegenerate = true;
    }
    return;
  }
  const safeCurve = new THREE.CatmullRomCurve3(uniquePoints);
  const safeBeamRadius = Number.isFinite(beamRadius_m) ? Math.max(beamRadius_m, 0.0005) : 0.0005;
  let tubeGeom;
  try {
    tubeGeom = new THREE.TubeGeometry(safeCurve, Math.max(8, uniquePoints.length*2), safeBeamRadius, 8, false);
  } catch (err) {
    console.warn('draw3DPath: TubeGeometry construction failed:', err);
    return;
  }
  const m = new THREE.MeshStandardMaterial({color: 0x78ffff, emissive: 0x88eeff, emissiveIntensity: 0.9, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending});
  pathLine3d = new THREE.Mesh(tubeGeom, m);
  scene3d.add(pathLine3d);
  // move electron to start
  if (electronMesh3d) {
    electronMesh3d.position.copy(points[0]);
  }
}

async function animateTrack3D(track) {
  if (!track || !scene3d) return;
  // animate sphere along path
  const path = track.path.map(p => new THREE.Vector3(p.x - scene.width_m/2, p.y, 0));
  // validate path
  if (!path || path.length < 2 || path.some(v => !Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z))) {
    console.warn('animateTrack3D: invalid path - aborting');
    return;
  }
  const steps = Math.max(60, path.length*3);
  for (let i=0;i<=steps;i++) {
    const frac = i/steps;
    const idxFloat = frac * (path.length - 1);
    const idx = Math.floor(idxFloat);
    const nextIdx = Math.min(idx + 1, path.length - 1);
    const localFrac = idxFloat - idx;
    const v = new THREE.Vector3().lerpVectors(path[idx], path[nextIdx], localFrac);
    electronMesh3d.position.copy(v);
    renderer3d.render(scene3d, camera3d);
    await new Promise(r => setTimeout(r, 1000/steps));
  }
  // record hit by creating a small sprite on the screen
  const hx = scene.screen_x_m - scene.width_m/2;
  const hy = track.y_screen_m;
  const dotGeom = new THREE.CircleGeometry(0.008, 16);
  const dotMat = new THREE.MeshBasicMaterial({color: 0xffd46b});
  const dot = new THREE.Mesh(dotGeom, dotMat);
  dot.userData = { isHitDot: true };
  dot.position.set(hx, hy, 0.011);
  scene3d.add(dot);
  // fade and remove later
  setTimeout(() => { scene3d.remove(dot); }, hitFadeSeconds*1000);
}

function drawPath(track) {
  if (!track || !track.path) return;
  // draw path
  const beamPx = Number(beamWidthSlider.value || 6);
  // outer soft glow
  ctx.save();
  ctx.lineWidth = beamPx * 2.4;
  ctx.shadowBlur = Math.max(8, beamPx);
  ctx.shadowColor = 'rgba(120,255,255,0.6)';
  ctx.strokeStyle = `rgba(120, 255, 255, ${trackAlpha * 0.35})`;
  ctx.beginPath();
  track.path.forEach((p, idx) => {
    const x = mToPxX(p.x);
    const y = mToPxY(p.y);
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.restore();
  // inner solid beam
  ctx.lineWidth = Math.max(1, beamPx);
  ctx.strokeStyle = `rgba(200, 255, 210, ${trackAlpha})`;
  ctx.beginPath();
  track.path.forEach((p, idx) => {
    const x = mToPxX(p.x);
    const y = mToPxY(p.y);
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  // clear shadow for other draws
  ctx.shadowBlur = 0;
}

function drawVectors(track) {
  if (!track || !vectorToggle.checked) return;
  // Draw velocity vector at plate exit and at screen hit for 2D
  const v_x = track.v0x;
  const v_y = track.v_exit_y || 0;
  const px_x = mToPxX(scene.plate_x_m + scene.plate_length_m);
  const px_y = mToPxY(track.path[track.path.length - 2]?.y || (scene.height_m/2));
  // scaling for visibility
  const scaleVis = 1e-7; // adjust to fit on canvas
  const vecX = v_x * scaleVis;
  const vecY = -v_y * scaleVis; // negative because canvas Y downwards
  ctx.strokeStyle = 'rgba(255,200,120,0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(px_x, px_y);
  ctx.lineTo(px_x + vecX, px_y + vecY);
  ctx.stroke();
  // arrow head
  ctx.beginPath();
  ctx.moveTo(px_x + vecX, px_y + vecY);
  ctx.lineTo(px_x + vecX - 6, px_y + vecY - 6);
  ctx.moveTo(px_x + vecX, px_y + vecY);
  ctx.lineTo(px_x + vecX - 6, px_y + vecY + 6);
  ctx.stroke();
}
// Also allow smaller vector drawing for multiple tracks (accepts track array)
function drawVectorsForTracks(tracks) {
  if (!tracks || tracks.length === 0 || !vectorToggle.checked) return;
  tracks.forEach(t => drawVectors(t));
}

// Animate a single electron following a computed track
async function animateTrack(track) {
  if (!track) return;
  // We'll animate by stepping along track.path and drawing an electron moving along it, leaving a short trail
  let t0 = performance.now();
  const path = track.path;
  const duration = 1.0; // seconds to animate from gun to screen (scaled for visibility)
  const steps = 120;
  for (let i = 0; i <= steps; i++) {
    // show scene and path
    drawScene();
    drawPath(track);

    // find position along path using linear interpolation
    const frac = i / steps;
    const idxFloat = frac * (path.length - 1);
    const idx = Math.floor(idxFloat);
    const nextIdx = Math.min(idx + 1, path.length - 1);
    const localFrac = idxFloat - idx;
    const x = path[idx].x * (1 - localFrac) + path[nextIdx].x * localFrac;
    const y = path[idx].y * (1 - localFrac) + path[nextIdx].y * localFrac;

    // draw electron
    const px = mToPxX(x);
    const py = mToPxY(y);
    ctx.fillStyle = '#ffeb6b';
    ctx.beginPath();
    ctx.arc(px, py, electronRadiusPx, 0, Math.PI*2);
    ctx.fill();

    // small tail - draw a few faded points behind
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let j = Math.max(0, idx - 6); j < idx; j++) {
      const tpx = mToPxX(path[j].x);
      const tpy = mToPxY(path[j].y);
      if (j === Math.max(0, idx - 6)) ctx.moveTo(tpx, tpy);
      else ctx.lineTo(tpx, tpy);
    }
    ctx.stroke();
    // draw vectors overlay for this track
    drawVectors(track);

    await new Promise(r => setTimeout(r, duration*1000/steps));
  }

  // final: record a hit on screen
  const hx = mToPxX(scene.screen_x_m);
  const hy = track.y_screen_px;
  hits.push({x: hx, y: hy, t: performance.now() / 1000});
  // cleanup old hits
  const now = performance.now() / 1000;
  hits = hits.filter(h => now - h.t < hitFadeSeconds);

  // update numeric display
  hitY.textContent = (track.y_screen_m).toFixed(4);
  hitPx.textContent = Math.round(track.y_screen_px);
}

// Animate multiple 2d tracks at once
async function animateTracks2D(tracks) {
  if (!tracks || tracks.length === 0) return;
  const paths = tracks.map(t => t.path);
  const maxLen = Math.max(...paths.map(p => p.length));
  const duration = 1.0; // seconds total
  const steps = Math.max(60, maxLen * 3);
  for (let i = 0; i <= steps; i++) {
    drawScene();
    // draw all paths
    tracks.forEach(t => drawPath(t));
    // draw vectors if enabled
    tracks.forEach(t => drawVectors(t));
    // draw vectors if enabled
    tracks.forEach(t => drawVectors(t));
    // draw all electrons moving
    const frac = i / steps;
    for (let k=0;k<tracks.length;k++) {
      const path = paths[k];
      const idxFloat = frac * (path.length - 1);
      const idx = Math.floor(idxFloat);
      const nextIdx = Math.min(idx + 1, path.length - 1);
      const localFrac = idxFloat - idx;
      const x = path[idx].x * (1 - localFrac) + path[nextIdx].x * localFrac;
      const y = path[idx].y * (1 - localFrac) + path[nextIdx].y * localFrac;
      const px = mToPxX(x);
      const py = mToPxY(y);
      ctx.fillStyle = '#ffeb6b';
      ctx.beginPath();
      ctx.arc(px, py, electronRadiusPx, 0, Math.PI*2);
      ctx.fill();
    }
    // also draw vectors for moving electrons if enabled
    tracks.forEach(t => drawVectors(t));
    await new Promise(r => setTimeout(r, duration*1000/steps));
  }
}

// Animate multiple 3D tracks at once
async function animateTracks3D(tracks) {
  if (!tracks || tracks.length === 0 || !scene3d) return;
  // convert to 3D paths
  const paths = tracks.map(t => t.path.map(p => new THREE.Vector3(p.x - scene.width_m/2, p.y, 0)));
  const maxLen = Math.max(...paths.map(p => p.length));
  const steps = Math.max(60, maxLen * 3);
  // create a mesh per electron
  const tempMeshes = tracks.map(() => new THREE.Mesh(new THREE.SphereGeometry(0.004, 8, 8), new THREE.MeshBasicMaterial({color: 0xffeb6b})));
  try { tempMeshes.forEach(m => scene3d.add(m)); } catch(e) {}
  for (let i=0;i<=steps;i++) {
    const frac = i/steps;
    for (let k=0;k<paths.length;k++) {
      const path = paths[k];
      const idxFloat = frac * (path.length - 1);
      const idx = Math.floor(idxFloat);
      const nextIdx = Math.min(idx + 1, path.length - 1);
      const localFrac = idxFloat - idx;
      const v = new THREE.Vector3().lerpVectors(path[idx], path[nextIdx], localFrac);
      // update a temporary mesh for each electron if desired; for now, reuse electronMesh3d and just render one at a time: we'll draw the first path as electron
      tempMeshes[k].position.copy(v);
      // optionally add small particles: skipping for simplicity
    }
    if (orbitControls) orbitControls.update();
    renderer3d && renderer3d.render(scene3d, camera3d);
    await new Promise(r => setTimeout(r, 1000/steps));
  }
  try { tempMeshes.forEach(m => scene3d.remove(m)); } catch(e) {}
}

// UI Wiring
function getCurrentParams() {
  const V_acc = Number(accelSlider.value);
  const V_plate = Number(deflectSlider.value);
  const isMag = magneticToggle.checked;
  return {V_acc, V_plate, isMag};
}

function updateReadouts() {
  accelReadout.textContent = `${accelSlider.value} V`;
  deflectReadout.textContent = `${deflectSlider.value} V`;
  beamWidthRead.textContent = beamWidthSlider.value;
  plateSpacingRead.textContent = plateSpacingSlider.value;
  plateLengthRead.textContent = plateLengthSlider.value;
  platePosRead.textContent = platePosSlider.value;
  multiCountRead.textContent = multiCountSlider.value;
}

// Recompute & preview path, but don't animate
function preview() {
  const {V_acc, V_plate, isMag} = getCurrentParams();
  const track = computeTrack(Number(V_acc), Number(V_plate), isMag);
  // draw either 2D or 3D preview
  if (mode3DToggle.checked) {
    // hide 2d canvas and show 3d
    document.getElementById('crt-canvas').style.display = 'none';
    document.getElementById('threejs-container').style.display = 'block';
    init3D();
    try {
      if (plateTopMesh && plateBottomMesh) {
        const centerY = scene.height_m/2;
        const spacing = scene.plate_spacing_m || 0.010;
        const newPlateLen = scene.plate_length_m;
        // Dispose and recreate geometries
        try { plateTopMesh.geometry.dispose(); } catch(e) {}
        try { plateBottomMesh.geometry.dispose(); } catch(e) {}
        plateTopMesh.geometry = new THREE.BoxGeometry(newPlateLen, 0.002, 0.02);
        plateBottomMesh.geometry = new THREE.BoxGeometry(newPlateLen, 0.002, 0.02);
        plateTopMesh.position.set(scene.plate_x_m + newPlateLen/2 - scene.width_m/2, centerY + spacing/2, 0);
        plateBottomMesh.position.set(scene.plate_x_m + newPlateLen/2 - scene.width_m/2, centerY - spacing/2, 0);
      }
    } catch (e) {}
    draw3DPath(track);
    renderer3d.render(scene3d, camera3d);
  } else {
    document.getElementById('threejs-container').style.display = 'none';
    document.getElementById('crt-canvas').style.display = 'block';
    drawScene();
    drawPath(track);
  }
  // update predicted hit readout in real-time
  if (track) {
    hitY.textContent = track.y_screen_m.toFixed(4);
    hitPx.textContent = Math.round(track.y_screen_px);
    v0Readout.textContent = (track.v0x).toExponential(3);
    // compute a_plate using the slider and sign
    const a_plate = computePlateVerticalAccel(Number(V_plate));
    ayReadout.textContent = a_plate.toExponential(3);
  }
  // Update HUD
  try {
    if (mode3DToggle.checked && camera3d) {
      const p = camera3d.position;
      hudDiv.innerHTML = `Camera: x=${p.x.toFixed(3)}m y=${p.y.toFixed(3)}m z=${p.z.toFixed(3)}m<br>` +
                         `Mode: 3D ${enableLocomotion ? '(locomotion)' : '(orbit)'}<br>` +
                         `Multi: ${multiCountSlider.value} Accum: ${accumulateHitsToggle.checked ? 'on' : 'off'}`;
    } else {
      hudDiv.innerHTML = `Mode: 2D<br>V_acc=${accelSlider.value} V; V_plate=${deflectSlider.value} V; Beam ${beamWidthSlider.value}px`;
    }
  } catch(e) {}
}

// Fire electron (compute track and animate)
async function fireElectron() {
  const {V_acc, V_plate, isMag} = getCurrentParams();
  // handle accumulation
  if (!accumulateHitsToggle.checked) {
    hits = [];
  }
  const count = Number(multiCountSlider.value || 1);
  const tracks = [];
  for (let i=0;i<count;i++) {
    // distribute small offsets across the beam height; convert mm to meters.
    const span = 0.002; // 2 mm total spread
    const offset = span * (i - (count-1)/2) / Math.max(1, count-1);
    const tr = computeTrackWithOffset(Number(V_acc), Number(V_plate), isMag, offset, 0);
    tracks.push(tr);
  }
  if (tracks.length === 1) {
    if (mode3DToggle && mode3DToggle.checked) {
      await animateTrack3D(tracks[0]);
      const hx = mToPxX(scene.screen_x_m);
      const hy = tracks[0].y_screen_px;
      hits.push({x:hx, y:hy, t: performance.now()/1000});
    } else {
      await animateTrack(tracks[0]);
    }
  } else {
    // animate many tracks simultaneously
    if (mode3DToggle && mode3DToggle.checked) {
      await animateTracks3D(tracks);
      // record hits
      tracks.forEach(tr => hits.push({x: mToPxX(scene.screen_x_m), y: tr.y_screen_px, t: performance.now()/1000}));
    } else {
      await animateTracks2D(tracks);
      tracks.forEach(tr => hits.push({x: mToPxX(scene.screen_x_m), y: tr.y_screen_px, t: performance.now()/1000}));
    }
  }
}

// Window & events
function resize() {
  // keep high DPI scaling in mind
  const devicePixelRatio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.floor(rect.width * devicePixelRatio);
  canvas.height = Math.floor(rect.height * devicePixelRatio);
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  scale = computeScale();
  preview();
  // also resize 3d renderer if active
  if (renderer3d) {
    const container = document.getElementById('threejs-container');
    const width = container.clientWidth;
    const height = 400;
    renderer3d.setSize(width, height);
    camera3d.aspect = width / height;
    camera3d.updateProjectionMatrix();
  }
}

window.addEventListener('resize', resize);

accelSlider.addEventListener('input', () => { updateReadouts(); preview(); });
deflectSlider.addEventListener('input', () => { updateReadouts(); preview(); });
magneticToggle.addEventListener('change', () => { preview(); });
beamWidthSlider.addEventListener('input', () => { beamWidthRead.textContent = beamWidthSlider.value; preview(); });
locomotionToggle.addEventListener('change', (e) => { enableLocomotion = locomotionToggle.checked && mode3DToggle.checked; if (orbitControls) orbitControls.enabled = !enableLocomotion; });
mode3DToggle.addEventListener('change', () => { enableLocomotion = locomotionToggle.checked && mode3DToggle.checked; if (orbitControls) orbitControls.enabled = !enableLocomotion; });
clearHitsBtn.addEventListener('click', () => { hits = []; if (scene3d) { scene3d.children.filter(c => c.userData && c.userData.isHitDot).forEach(dot => scene3d.remove(dot)); } preview(); });
accumulateHitsToggle.addEventListener('change', () => { /* nothing special; pre-fire behavior clears if unchecked */ });
vectorToggle.addEventListener('change', () => { preview(); });
plateSpacingSlider.addEventListener('input', () => { const mm = Number(plateSpacingSlider.value); plateSpacingRead.textContent = mm; scene.plate_spacing_m = mm / 1000.0; preview(); });
plateLengthSlider.addEventListener('input', () => { const cm = Number(plateLengthSlider.value); plateLengthRead.textContent = cm; scene.plate_length_m = cm / 100.0; preview(); });
platePosSlider.addEventListener('input', () => { const cm = Number(platePosSlider.value); platePosRead.textContent = cm; scene.plate_x_m = cm / 100.0; preview(); });
multiCountSlider.addEventListener('input', () => { multiCountRead.textContent = multiCountSlider.value; });

fireBtn.addEventListener('click', async () => { await fireElectron(); });
resetBtn.addEventListener('click', () => { resetSimulation(); });
mode3DToggle.addEventListener('change', () => { preview(); });

autoFire.addEventListener('change', () => {
  if (autoFire.checked) {
    lastFire = 0;
    autoFireIntervalId = setInterval(() => { fireElectron(); }, 700);
  } else {
    clearInterval(autoFireIntervalId);
    autoFireIntervalId = null;
  }
})

// Start rendering
updateReadouts();
resize();
// initialize scene parameters from sliders
scene.plate_spacing_m = Number(plateSpacingSlider.value || 10) / 1000.0;
scene.plate_length_m = Number(plateLengthSlider.value || 6) / 100.0;
scene.plate_x_m = Number(platePosSlider.value || 18) / 100.0;

// Continuous update loop to draw hits fading and preview if no animation
(function renderLoop() {
  drawScene();
  // if not animating, show current preview path
  const {V_acc, V_plate, isMag} = getCurrentParams();
  const track = computeTrack(Number(V_acc), Number(V_plate), isMag);
  // draw correct view
  if (mode3DToggle && mode3DToggle.checked) {
    if (scene3d) {
      // update 3d preview electron and path
      draw3DPath(track);
      if (orbitControls) orbitControls.update();
      renderer3d && renderer3d.render(scene3d, camera3d);
    }
    } else {
    drawPath(track);
    drawVectors(track);
  }
  // process locomotion updates if enabled
  const now = performance.now() / 1000;
  if (!renderLoop._lastTime) renderLoop._lastTime = now;
  const dt = Math.max(0.001, Math.min(0.1, now - renderLoop._lastTime));
  renderLoop._lastTime = now;
  if (enableLocomotion && camera3d) updateLocomotion(dt);
  // update HUD each frame
  try {
    if (mode3DToggle.checked && camera3d) {
      const p = camera3d.position;
      hudDiv.innerHTML = `Camera: x=${p.x.toFixed(3)}m y=${p.y.toFixed(3)}m z=${p.z.toFixed(3)}m<br>` +
                         `Mode: 3D ${enableLocomotion ? '(locomotion)' : '(orbit)'}<br>` +
                         `Multi: ${multiCountSlider.value} Accum: ${accumulateHitsToggle.checked ? 'on' : 'off'}`;
    }
  } catch(e) {}
  requestAnimationFrame(renderLoop);
})();
