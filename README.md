Cell Mechanics Lab
Mechanical pressure as an evolutionary driver of mitosis type — an interactive simulation toolkit
Hypothesis
(Code generated with assistance from Claude (Anthropic). Physics model design and hypothesis by Hyeonje Yang)

Cells under high mechanical pressure from neighboring cells perform closed mitosis (nuclear envelope remains intact), while cells in low-pressure environments perform open mitosis (nuclear envelope disassembles).

This project provides interactive simulation tools to explore this hypothesis by computing real-time mechanical stress on cells using Hertz contact mechanics and finite element analysis (FEA).

Simulators
1. Multi-Cell 3D Simulator (multi_cell_sim.jsx)
Full 3D tissue-level simulation with multiple interacting cells.

Hertz contact mechanics — force & pressure from cell-cell overlap
FEA surface painting — vertex-level pressure distribution p(r) = p₀√(1-(r/a)²)
Cell division animation — visual distinction between open/closed mitosis
Viscoelastic model — Kelvin-Voigt creep under sustained stress
Cell adhesion — cadherin-like short-range attraction with bond visualization
Generation tracking — color-coded lineage through successive divisions
Compression walls — simulate confined tissue environments
Presets — Tight Pack / Loose / Monolayer configurations
View modes — Pressure / Mitosis / Generation / Membrane

FeatureDetailPhysicsHertz contact, viscoelastic damping, adhesionRenderingThree.js with vertex color paintingDivisionAnimated cytokinesis with contractile ringControlsOrbit camera, force application, cell selection
2. Single Cell FEA (single_cell_fea.jsx)
2D cross-section finite element analysis of a single deformable cell.

Triangular CST mesh — configurable rings × sectors resolution
Green-Lagrange strain — large deformation formulation
Von Mises stress — equivalent stress for rupture prediction
Interactive tools:

👊 Push — apply force by dragging on cell surface
🧲 Pull — attract nodes toward cursor
📌 Pin — fix boundary conditions (click to toggle)


Compression plates — top/bottom and left/right rigid surfaces
Cell rupture — elements flash red when σ_VM > membrane strength
4 visualization modes — Von Mises / Pressure / Strain / Displacement
Internal pressure — cytoplasmic turgor simulation

3. 2D Particle Simulator (cell_mechanics_simulator.jsx)
Lightweight 2D canvas-based simulation for quick exploration.

Real-time Hertz contact pressure calculation
Drag / Push / Pull / Add cell tools
Membrane integrity tracking with progressive failure
Pressure-to-mitosis-type prediction


Physics Model
Hertz Contact Mechanics
Two elastic spheres in contact:
Effective modulus:   E* = E / (2(1 - ν²))
Effective radius:    R* = R₁R₂ / (R₁ + R₂)
Contact force:       F  = (4/3) E* √R* · δ^(3/2)
Contact radius:      a  = √(R* · δ)
Contact pressure:    P  = F / (πa²)
Pressure distribution: p(r) = p₀ √(1 - (r/a)²)
FEA (Single Cell)

Elements: Constant Strain Triangle (CST)
Strain: Green-Lagrange E = ½(FᵀF - I)
Stress: Plane stress constitutive σ = D·ε
Failure: Von Mises criterion σ_vm = √(σx² + σy² - σxσy + 3τxy²)
Deformation: Spring-mass network with Verlet integration

Viscoelastic Model
Kelvin-Voigt approach for time-dependent behavior:

Creep accumulation under sustained stress
Stress relaxation upon unloading
Cell radius increase from prolonged deformation


Getting Started
Prerequisites

Node.js 16+
npm or yarn

Installation
bashgit clone https://github.com/YOUR_USERNAME/cell-mechanics-lab.git
cd cell-mechanics-lab
npm install
npm run dev
Project Structure
cell-mechanics-lab/
├── src/
│   ├── multi_cell_sim.jsx        # 3D multi-cell simulator
│   ├── single_cell_fea.jsx       # Single cell FEA
│   ├── cell_mechanics_simulator.jsx  # 2D particle sim
│   └── App.jsx                   # Router / entry point
├── docs/
│   ├── cell_simulator_documentation.md
│   ├── preview-multi.png
│   └── preview-single.png
├── package.json
└── README.md
Quick Setup with Vite
bashnpm create vite@latest cell-mechanics-lab -- --template react
cd cell-mechanics-lab
npm install three
# Copy simulator files to src/
npm run dev

Parameters Guide
ParameterDefaultRangePhysical MeaningElastic Modulus500 Pa50–5000Cell stiffness (real cells: 100–10,000 Pa)Poisson Ratio0.450.1–0.49Near-incompressible biological tissueMembrane Strength2000 Pa200–20,000Rupture thresholdInternal Pressure30 Pa0–200Cytoplasmic turgor pressureAdhesion Strength500–200Cadherin-like cell-cell junction strengthViscosity0.020–0.1Creep rate under sustained stress

Mitosis Prediction Logic
pressure_ratio = cell_pressure / membrane_strength

if ratio > 0.4  →  Closed Mitosis  (nuclear envelope intact)
if ratio > 0.05 →  Open Mitosis    (nuclear envelope disassembles)
else            →  Undetermined
Rationale: In high-pressure environments, disassembling the nuclear envelope would expose chromosomes to mechanical damage. Closed mitosis protects chromosomes at the cost of slightly less efficient spindle formation.

Limitations & Future Work
Current Limitations

Cells modeled as elastic (real cells are viscoelastic with complex rheology)
Uniform material properties (real cells have membrane, cortex, cytoplasm, nucleus)
Simplified 2D FEA cross-section (real cells are 3D)
No biochemical signaling (mechanotransduction pathways not modeled)

Planned Extensions

 Full 3D FEA with tetrahedral mesh
 Maxwell model for stress relaxation
 Mechanotransduction signaling pathways
 ECM (extracellular matrix) network
 GPU-accelerated large-scale tissue simulation
 Export simulation data to CSV for analysis
 Comparison with experimental AFM data
