# Cell Mechanics Simulator

**Mechanical pressure as an evolutionary driver of mitosis type — an interactive simulation toolkit**

(Code generated with assistance from Claude (Anthropic). Physics model design and hypothesis by Hyeonje Yang)

[![License: MIT](https://img.shields.io/badge/License-MIT-cyan.svg)](#license)
[![React](https://img.shields.io/badge/React-18+-61DAFB?logo=react&logoColor=white)](#tech-stack)
[![Three.js](https://img.shields.io/badge/Three.js-r128-black?logo=three.js)](#tech-stack)

<p align="center">
  <img src="docs/preview-multi.png" alt="Multi-cell 3D simulation" width="48%" />
  <img src="docs/preview-single.png" alt="Single cell FEA" width="48%" />
</p>

---

## Hypothesis

> Cells under high mechanical pressure from neighboring cells perform **closed mitosis** (nuclear envelope remains intact), while cells in low-pressure environments perform **open mitosis** (nuclear envelope disassembles).

This project provides interactive simulation tools to explore this hypothesis by computing real-time mechanical stress on cells using **Hertz contact mechanics** and **finite element analysis (FEA)**.

---

## Simulators

### 1. Multi-Cell 3D Simulator (`multi_cell_sim.jsx`)

Full 3D tissue-level simulation with multiple interacting cells.

- **Hertz contact mechanics** — force & pressure from cell-cell overlap
- **FEA surface painting** — vertex-level pressure distribution `p(r) = p₀√(1-(r/a)²)`
- **Cell division animation** — visual distinction between open/closed mitosis
- **Viscoelastic model** — Kelvin-Voigt creep under sustained stress
- **Cell adhesion** — cadherin-like short-range attraction with bond visualization
- **Generation tracking** — color-coded lineage through successive divisions
- **Compression walls** — simulate confined tissue environments
- **Presets** — Tight Pack / Loose / Monolayer configurations
- **View modes** — Pressure / Mitosis / Generation / Membrane

| Feature | Detail |
|---------|--------|
| Physics | Hertz contact, viscoelastic damping, adhesion |
| Rendering | Three.js with vertex color painting |
| Division | Animated cytokinesis with contractile ring |
| Controls | Orbit camera, force application, cell selection |

### 2. Single Cell FEA (`single_cell_fea.jsx`)

2D cross-section finite element analysis of a single deformable cell.

- **Triangular CST mesh** — configurable rings × sectors resolution
- **Green-Lagrange strain** — large deformation formulation
- **Von Mises stress** — equivalent stress for rupture prediction
- **Interactive tools:**
  - 👊 **Push** — apply force by dragging on cell surface
  - 🧲 **Pull** — attract nodes toward cursor
  - 📌 **Pin** — fix boundary conditions (click to toggle)
- **Compression plates** — top/bottom and left/right rigid surfaces
- **Cell rupture** — elements flash red when σ_VM > membrane strength
- **4 visualization modes** — Von Mises / Pressure / Strain / Displacement
- **Internal pressure** — cytoplasmic turgor simulation

### 3. 2D Particle Simulator (`cell_mechanics_simulator.jsx`)

Lightweight 2D canvas-based simulation for quick exploration.

- Real-time Hertz contact pressure calculation
- Drag / Push / Pull / Add cell tools
- Membrane integrity tracking with progressive failure
- Pressure-to-mitosis-type prediction

---

## Physics Model

### Hertz Contact Mechanics

Two elastic spheres in contact:

```
Effective modulus:   E* = E / (2(1 - ν²))
Effective radius:    R* = R₁R₂ / (R₁ + R₂)
Contact force:       F  = (4/3) E* √R* · δ^(3/2)
Contact radius:      a  = √(R* · δ)
Contact pressure:    P  = F / (πa²)
Pressure distribution: p(r) = p₀ √(1 - (r/a)²)
```

### FEA (Single Cell)

- **Elements**: Constant Strain Triangle (CST)
- **Strain**: Green-Lagrange `E = ½(FᵀF - I)`
- **Stress**: Plane stress constitutive `σ = D·ε`
- **Failure**: Von Mises criterion `σ_vm = √(σx² + σy² - σxσy + 3τxy²)`
- **Deformation**: Spring-mass network with Verlet integration

### Viscoelastic Model

Kelvin-Voigt approach for time-dependent behavior:
- Creep accumulation under sustained stress
- Stress relaxation upon unloading
- Cell radius increase from prolonged deformation

---

## Getting Started

### Prerequisites

- Node.js 16+
- npm or yarn

### Installation

```bash
git clone https://github.com/YOUR_USERNAME/cell-mechanics-lab.git
cd cell-mechanics-lab
npm install
npm run dev
```

### Project Structure

```
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
```

### Quick Setup with Vite

```bash
npm create vite@latest cell-mechanics-lab -- --template react
cd cell-mechanics-lab
npm install three
# Copy simulator files to src/
npm run dev
```

---

## Parameters Guide

| Parameter | Default | Range | Physical Meaning |
|-----------|---------|-------|------------------|
| Elastic Modulus | 500 Pa | 50–5000 | Cell stiffness (real cells: 100–10,000 Pa) |
| Poisson Ratio | 0.45 | 0.1–0.49 | Near-incompressible biological tissue |
| Membrane Strength | 2000 Pa | 200–20,000 | Rupture threshold |
| Internal Pressure | 30 Pa | 0–200 | Cytoplasmic turgor pressure |
| Adhesion Strength | 50 | 0–200 | Cadherin-like cell-cell junction strength |
| Viscosity | 0.02 | 0–0.1 | Creep rate under sustained stress |

---

## Mitosis Prediction Logic

```
pressure_ratio = cell_pressure / membrane_strength

if ratio > 0.4  →  Closed Mitosis  (nuclear envelope intact)
if ratio > 0.05 →  Open Mitosis    (nuclear envelope disassembles)
else            →  Undetermined
```

**Rationale**: In high-pressure environments, disassembling the nuclear envelope would expose chromosomes to mechanical damage. Closed mitosis protects chromosomes at the cost of slightly less efficient spindle formation.

---

## Limitations & Future Work

### Current Limitations

- Cells modeled as elastic (real cells are viscoelastic with complex rheology)
- Uniform material properties (real cells have membrane, cortex, cytoplasm, nucleus)
- Simplified 2D FEA cross-section (real cells are 3D)
- No biochemical signaling (mechanotransduction pathways not modeled)

### Planned Extensions

- [ ] Full 3D FEA with tetrahedral mesh
- [ ] Maxwell model for stress relaxation
- [ ] Mechanotransduction signaling pathways
- [ ] ECM (extracellular matrix) network
- [ ] GPU-accelerated large-scale tissue simulation
- [ ] Export simulation data to CSV for analysis
- [ ] Comparison with experimental AFM data

---

## References

- Hertz, H. (1882). *Über die Berührung fester elastischer Körper*
- Johnson, K.L. (1985). *Contact Mechanics*, Cambridge University Press
- Boal, D. (2012). *Mechanics of the Cell*, Cambridge University Press
- Mao et al. (2015). *Mechanical forces in tissue morphogenesis*, Journal of Cell Science
- Hatch & Bhatt (2014). *The ins and outs of nuclear pore complexes during open mitosis*
- Güttinger, Laurell & Bhatt (2009). *Orchestrating nuclear envelope disassembly and reassembly during mitosis*

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

<p align="center">
  <sub>Built to explore the mechanical origins of mitosis diversity</sub>
</p>
