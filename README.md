CRT Simulation (2D Side View)

Overview

- This is a simple interactive 2D simulation of a cathode-ray tube (CRT) from a side view. An electron is emitted from a gun, accelerated by a slider-controlled accelerating voltage (1000–3000 V), passes between deflection plates, and hits a phosphor screen. The deflection plates produce a uniform vertical electric field, and the electron's trajectory bends only while inside the plate region. There is also an optional magnetic deflection mode where the electron follows a curved path.

Files

- index.html — UI and canvas
- style.css — simple styling
- main.js — physics calculation and animation
- README.md — documentation

How to run

- Open `index.html` in a modern browser (Chrome, Firefox, Edge). No server is required – the simulation runs entirely in front-end JavaScript.

Quick start

- Clone or download this folder and open `index.html` in a browser.
- Use the sliders and press "Fire Electron" to animate and see the impact point.

Controls

- Accelerating Voltage: Slider (1000–3000 V). Increases the electron's forward speed using the kinetic energy equation E = eV -> 0.5 m v^2.
- Deflection Voltage: Slider (-100 to 100 V). Positive voltages push the electron upward; negative push downward.
- Magnetic Deflection: Toggle to use simplified magnetic deflection (Lorentz force) instead of electric plate deflection.
- Fire Electron: Creates a visible electron path and shows a glow at the impact point on the screen.
- Auto-fire: Repeats firing so you can see changes in real-time.
- 3D Mode: Toggle a simple 3D scene (Three.js) to explore the same motion in a three-dimensional perspective.
- Reset: Clears hits and stops autofire, resetting displayed readouts.

Locomotion & Beam visual settings

- Enable Locomotion: When enabled in 3D mode, you can move the camera using keys W/A/S/D and the arrow keys; Space raises the camera, and Shift lowers it. This allows you to 'walk through' the tube in a first-person style. When locomotion is enabled, Orbit controls are disabled.
- Beam width: A slider (1–16 px) adjusts the beam width and glow intensity. The change affects both 2D and 3D beams (in 3D the path is shown as a circular Tube with an emissive material to visually pop out).

New features

- Mouse Look / Pointer Lock: Click inside the 3D view when locomotion is enabled to enter pointer-lock mouse-look mode. While pointer-locked, moving your mouse rotates the camera; press ESC to exit the pointer lock.
- Clear hits: A button to clear hits without resetting other UI items or stopping auto-fire.
- Accumulate hits: Toggle whether hits accumulate on the screen (store previous impacts) or are cleared before each new electron.
- Plate geometry: Sliders adjust plate spacing (mm), length (cm), and plate x position (cm). The 3D view updates in real time.
- Velocity vectors: Toggle a visual velocity vector overlay at the plate exit (2D) to see v_x and v_y.
- Multi-electron firing: Use the multi-electron count slider to create a small beam of electrons (1–12) that animate simultaneously.
- Ruler: The 2D canvas has tick marks and distance labels along the x axis (cm) to help visualize distances.

3D scene details

- The 3D scene uses Three.js and draws a simple tube scene: gun, deflection plates and screen as 3D objects. The animation uses the same physics but displays the path and an electron sphere moving in 3D space so you can see perspective.
- In the 3D scene you may use OrbitControls to rotate/zoom with the mouse. Enable Locomotion to walk through the tube with W/A/S/D and arrow keys, Space to raise, Shift to lower.

Physics Simplification & sign conventions

- The simulation uses SI units to compute initial velocities (v = sqrt(2 e V / m)), then maps a small scene in meters (50 cm tube length), which is converted to pixels for display.
-- The plate spacing is approximated as 1 cm; E field = V_plate / d.
-- For magnetic mode, a crude mapping from the plate voltage slider to an equivalent B field is used so users can compare behaviors.
- The sign convention is chosen for educational clarity: a positive deflection slider value produces an upward deflection visually; this avoids confusing negative charge signs for beginners.
- The simulation keeps the physics consistent enough for educational demonstration while remaining easy to understand and fast to compute.

Enhancements & Ideas

- Add more realistic electrode geometry and entry/exit fringing fields.
- Allow variable plate spacing and length.
- Add energy loss, space charge, or multiple electrons for beam shape.
- Allow the user to visualize v_y, v_x as vectors and show computed values.

License

- MIT

Note on physics fidelity

- This simulation uses non-relativistic kinematics and a simplified mapping between slider values and fields for clarity and ease of use. It demonstrates core CRT behavior without modeling every real effect (fringing fields, electron emission physics, space charge, material properties, or relativistic corrections).

Troubleshooting - Common Console Warnings/Errors

- "THREE.Material: 'emissive' is not a property of THREE.MeshBasicMaterial." — This warning appears when a material property (like `emissive`) is passed to a material type that doesn't support it. The simulation uses `MeshStandardMaterial` for the 3D beam now (supports `emissive`) so you shouldn't see this anymore. If you still do, ensure you are running the updated `main.js`.
- "THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The 'position' attribute is likely to have NaN values." — This means the geometry was built from bad input points (NaN or infinite coords), for example when a path wasn't computed correctly or a division by zero happened in the physics. The code now validates points before creating TubeGeometry and skips drawing the 3D beam when the data is invalid, so this error should be prevented. If you keep seeing it, try changing sliders (e.g., set accelerating voltage to a realistic non-zero value) and ensure your browser console is using the updated JS.

