# 🧮 VLSM Calculator with Routing Configuration Generator

![VLSM Calculator](docs/screenshots)

> A fully offline, browser-based VLSM (Variable Length Subnet Masking) calculator that automatically generates complete Cisco IOS router configurations — ready to paste directly into Packet Tracer or a real Cisco router.

---

## 📋 Table of Contents

- [Description](#description)
- [Features](#features)
- [Screenshots](#screenshots)
- [Usage](#usage)
- [File Structure](#file-structure)
- [Technologies Used](#technologies-used)
- [How It Works](#how-it-works)
- [Future Improvements](#future-improvements)
- [License](#license)

---

## Description

The **VLSM Calculator** is a professional-grade networking tool designed for Computer Engineering and Networking students. It solves two problems in one:

1. **Subnet Calculation** — Given a base network and host requirements per router, it allocates the smallest possible subnet for each using VLSM (largest-first allocation rule).

2. **Cisco CLI Generation** — It automatically generates complete router interface and routing protocol configurations, organized into Stage 1 (interfaces) and Stage 2 (routing), ready for immediate use in Cisco Packet Tracer or real IOS routers.

The tool supports **Static Routing**, **RIP v2**, **OSPF**, and **EIGRP** protocols, with Bus/Linear and Ring topology WAN link auto-generation.

---

## ✨ Features

| Feature | Details |
|---|---|
| 🔌 **Fully Offline** | No server, no API — runs entirely in the browser |
| 🧮 **VLSM Engine** | Accurate CIDR allocation using reference subnetting table |
| 🌐 **Topology Selector** | Ring or Bus/Linear — auto-calculates required /30 WAN links |
| 📡 **Auto WAN Links** | Generates exactly N (ring) or N−1 (bus) point-to-point /30 subnets |
| 🖥 **Cisco IOS CLI** | Pure, paste-ready CLI — no HTML, no spaces, no errors |
| 🔗 **Static Routing** | BFS-aware ip route generation per router |
| 📡 **RIP v2** | Classful network advertisements with no auto-summary |
| 🔷 **OSPF** | Area 0 wildcard-mask network statements |
| ⚡ **EIGRP** | AS 100 with wildcard masks and no auto-summary |
| 📋 **Copy Buttons** | Copy Stage 1, Stage 2, or both per router |
| ⬇ **Export Options** | Export CLI as .txt or .xls, Export table as .xls |
| 🎨 **Professional UI** | Dark Cisco-inspired theme with responsive layout |

---

## 📸 Screenshots

> _Screenshots will be added after first deployment._

**Input Panel**
```
docs/screenshots/input.png
```

**VLSM Routing Table**
```
docs/screenshots/table.png
```

**CLI Output Terminal**
```
docs/screenshots/cli.png
```

---

## 🚀 Usage

### Option 1 — Open directly in browser (recommended)

```bash
# Clone the repository
git clone https://github.com/yourusername/vlsm-calculator.git

# Open index.html in any modern browser
open vlsm-calculator/index.html
```

No build step, no npm install, no server required.

### Option 2 — Live Server (VS Code)

Install the **Live Server** extension in VS Code, right-click `index.html` → **Open with Live Server**.

---

### Step-by-Step Guide

**Step 1 — Enter Base Network**
```
172.168.0.0
```
This is the starting IP address for the entire VLSM block.

**Step 2 — Enter Host Requirements**

Add one box per router. Each box represents one LAN network:
```
R1 → 25000 hosts
R2 → 15000 hosts
R3 → 10000 hosts
R4 →   500 hosts
```

**Step 3 — Select Router Topology**

| Topology | WAN Links | Use Case |
|---|---|---|
| **Bus / Linear** | N − 1 | Simple chain of routers |
| **Ring** | N | Redundant loop topology |

The calculator will preview all auto-generated /30 WAN links before you calculate.

**Step 4 — Click Calculate VLSM**

The VLSM Routing Table appears, showing:
- All LAN subnets (blue rows)
- All auto-generated WAN /30 links (yellow rows)
- Network Address, Subnet Mask, Usable IPs, Broadcast

**Step 5 — Generate Routing Configuration**

Select a protocol:
- 🔗 **Static** — manual ip route per router
- 📡 **RIP v2** — router rip + classful networks
- 🔷 **OSPF** — router ospf 1 + wildcard networks area 0
- ⚡ **EIGRP** — router eigrp 100 + wildcard networks

The CLI output appears in a dark terminal panel.

**Step 6 — Copy and Paste**

Use the copy buttons:
- **⎘ Stage 1** — paste interface configuration first
- **⎘ Stage 2** — paste routing protocol after interfaces are up
- **⎘ Both** — copy complete router config
- **⎘ Copy All** — copy all routers at once

Paste directly into Cisco Packet Tracer CLI or a real router terminal.

---

## 📁 File Structure

```
vlsm-calculator/
│
├── index.html          ← Semantic HTML structure (no inline CSS/JS)
├── style.css           ← Complete dark theme stylesheet
├── script.js           ← All JavaScript logic (modular, commented)
│
├── assets/
│   ├── icons/          ← SVG icons (future use)
│   └── images/         ← UI images (future use)
│
├── exports/            ← Output directory for generated .txt / .xls files
│
├── docs/
│   └── screenshots/    ← Application screenshots for README
│
├── README.md           ← This file
├── LICENSE             ← MIT License
└── .gitignore          ← Git ignore rules
```

---

## 🛠 Technologies Used

| Technology | Purpose |
|---|---|
| **HTML5** | Semantic page structure, accessibility attributes |
| **CSS3** | Custom properties, Grid, Flexbox, animations |
| **Vanilla JavaScript** | All logic — no frameworks, no dependencies |
| **Google Fonts** | Inter (UI) + JetBrains Mono (CLI/code) |
| **Clipboard API** | One-click copy to clipboard |
| **Blob API** | In-browser file export (no server needed) |

---

## ⚙ How It Works

### VLSM Allocation Algorithm

1. Sort all host requirements in **descending order** (largest first — VLSM rule)
2. For each host count, find the smallest CIDR block where `usable ≥ hosts`
3. Allocate sequentially from the base IP
4. After all LAN subnets, allocate one /30 WAN subnet per router link

### Topology WAN Link Count

```
Bus/Linear:  links = N − 1   (R1–R2, R2–R3, ..., R(N-1)–RN)
Ring:        links = N       (R1–R2, ..., RN–R1)
```

### Static Routing — BFS Next-Hop

For routers that are not directly adjacent to a destination, the tool uses **Breadth-First Search** across the serial link graph to find the correct next-hop IP, avoiding incorrect routes in ring topologies.

### CLI Output Rules

All generated CLI follows strict Cisco IOS syntax:
- No leading spaces before commands
- Starts with `enable` + `configure terminal`
- Ends with `exit` (from mode) + `end`
- No HTML, no browser artifacts

---

## 🔮 Future Improvements

- [ ] **Topology Visualization** — Dynamic SVG diagram showing router connections
- [ ] **Packet Tracer Export** — Generate `.pkt`-compatible configuration files
- [ ] **IPv6 Support** — VLSM for IPv6 prefix allocation
- [ ] **Auto Diagram Generator** — Printable network diagram from table data
- [ ] **Save / Load** — LocalStorage or JSON import/export of configurations
- [ ] **Dark/Light Theme Toggle** — Optional light mode for printing
- [ ] **Multi-area OSPF** — Support for multiple OSPF areas
- [ ] **Named EIGRP** — Support for newer named EIGRP configuration mode

---

## 👨‍💻 Author

Built as a practical networking tool for Computer Engineering students.

---

## 📄 License

This project is licensed under the **MIT License** — see [LICENSE](LICENSE) for details.
