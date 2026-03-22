/**
 * VLSM Calculator — script.js
 * ============================================================
 * Offline VLSM Calculator with Cisco IOS CLI Generator
 *
 * STRICT PORT ASSIGNMENT RULE (Cisco Convention):
 * ─────────────────────────────────────────────────
 *  Every WAN link is DIRECTIONAL:  RouterA → RouterB
 *
 *  RouterA side = OUT  →  Serial0/1/0  →  firstIP  of /30
 *  RouterB side = IN   →  Serial0/1/1  →  lastIP   of /30
 *
 *  Multiple links per router (ring topology):
 *    1st OUT link  →  Serial0/1/0
 *    2nd OUT link  →  Serial0/2/0   (ring closing link)
 *    1st IN  link  →  Serial0/1/1
 *    2nd IN  link  →  Serial0/2/1
 *
 *  This guarantees:
 *    ✔  Every link has exactly 1 OUT and 1 IN port
 *    ✔  No OUT↔OUT or IN↔IN conflicts
 *    ✔  firstIP always goes to OUT side
 *    ✔  lastIP  always goes to IN  side
 *
 * Modules:
 *  1.  IP Utility Functions
 *  2.  CIDR Reference Table
 *  3.  Host Input Box Management
 *  4.  Topology Selection & WAN Link Generation
 *  5.  Core VLSM Calculation
 *  6.  Table Renderer
 *  7.  Router Object Builder (strict direction-aware)
 *  8.  Visual Connection Map
 *  9.  Next-Hop Resolver (BFS)
 *  10. Cisco IOS CLI Builders — Stage 1 & 2
 *  11. CLI Renderer
 *  12. Copy & Export
 *  13. Excel Table Export
 *  14. Initialisation
 * ============================================================
 */

'use strict';

/* ============================================================
   1. IP UTILITY FUNCTIONS
   ============================================================ */

function ipToInt(ip) {
  return ip.trim().split('.').reduce((a, v) => (a * 256) + parseInt(v, 10), 0) >>> 0;
}

function intToIp(n) {
  n = n >>> 0;
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

/** Wildcard mask — bitwise NOT of subnet mask. Used by OSPF/EIGRP. */
function wildcardOf(mask) {
  return intToIp((~ipToInt(mask)) >>> 0);
}

/** Classful network for RIP v2. Class A ≤127 → /8, Class B ≤191 → /16, C → /24 */
function classfulNet(ip) {
  const n = ipToInt(ip), f = (n >>> 24) & 255;
  if (f <= 127) return intToIp(n & 0xFF000000);
  if (f <= 191) return intToIp(n & 0xFFFF0000);
  return intToIp(n & 0xFFFFFF00);
}

/* ============================================================
   2. CIDR REFERENCE TABLE
   ============================================================ */

const CIDR_TABLE = [
  { cidr: 30, block: 4,        usable: 2,        incr: 4,   mask: '255.255.255.252', octet: '4th' },
  { cidr: 29, block: 8,        usable: 6,        incr: 8,   mask: '255.255.255.248', octet: '4th' },
  { cidr: 28, block: 16,       usable: 14,       incr: 16,  mask: '255.255.255.240', octet: '4th' },
  { cidr: 27, block: 32,       usable: 30,       incr: 32,  mask: '255.255.255.224', octet: '4th' },
  { cidr: 26, block: 64,       usable: 62,       incr: 64,  mask: '255.255.255.192', octet: '4th' },
  { cidr: 25, block: 128,      usable: 126,      incr: 128, mask: '255.255.255.128', octet: '4th' },
  { cidr: 24, block: 256,      usable: 254,      incr: 1,   mask: '255.255.255.0',   octet: '3rd' },
  { cidr: 23, block: 512,      usable: 510,      incr: 2,   mask: '255.255.254.0',   octet: '3rd' },
  { cidr: 22, block: 1024,     usable: 1022,     incr: 4,   mask: '255.255.252.0',   octet: '3rd' },
  { cidr: 21, block: 2048,     usable: 2046,     incr: 8,   mask: '255.255.248.0',   octet: '3rd' },
  { cidr: 20, block: 4096,     usable: 4094,     incr: 16,  mask: '255.255.240.0',   octet: '3rd' },
  { cidr: 19, block: 8192,     usable: 8190,     incr: 32,  mask: '255.255.224.0',   octet: '3rd' },
  { cidr: 18, block: 16384,    usable: 16382,    incr: 64,  mask: '255.255.192.0',   octet: '3rd' },
  { cidr: 17, block: 32768,    usable: 32766,    incr: 128, mask: '255.255.128.0',   octet: '3rd' },
  { cidr: 16, block: 65536,    usable: 65534,    incr: 1,   mask: '255.255.0.0',     octet: '2nd' },
  { cidr: 15, block: 131072,   usable: 131070,   incr: 2,   mask: '255.254.0.0',     octet: '2nd' },
  { cidr: 14, block: 262144,   usable: 262142,   incr: 4,   mask: '255.252.0.0',     octet: '2nd' },
  { cidr: 13, block: 524288,   usable: 524286,   incr: 8,   mask: '255.248.0.0',     octet: '2nd' },
  { cidr: 12, block: 1048576,  usable: 1048574,  incr: 16,  mask: '255.240.0.0',     octet: '2nd' },
  { cidr: 11, block: 2097152,  usable: 2097150,  incr: 32,  mask: '255.224.0.0',     octet: '2nd' },
  { cidr: 10, block: 4194304,  usable: 4194302,  incr: 64,  mask: '255.192.0.0',     octet: '2nd' },
  { cidr:  9, block: 8388608,  usable: 8388606,  incr: 128, mask: '255.128.0.0',     octet: '2nd' },
  { cidr:  8, block: 16777216, usable: 16777214, incr: 1,   mask: '255.0.0.0',       octet: '1st' },
];

const CIDR_30 = { cidr: 30, block: 4, usable: 2, incr: 4, mask: '255.255.255.252', octet: '4th' };

function findCidr(hosts) {
  for (const e of CIDR_TABLE) if (e.usable >= hosts) return e;
  return null;
}

/* ============================================================
   3. HOST INPUT BOX MANAGEMENT
   ============================================================ */

let hostIdSeq = 0;

function addHostBox(val = '') {
  const wrap = document.getElementById('hostBoxes');
  const id   = ++hostIdSeq;
  const n    = wrap.querySelectorAll('.host-box').length + 1;
  const div  = document.createElement('div');
  div.className = 'host-box';
  div.id        = `hb-${id}`;
  div.setAttribute('role', 'listitem');
  div.innerHTML = `
    <span class="host-box-tag">R${n}</span>
    <input type="number" min="1" placeholder="Hosts" value="${val}"
           aria-label="Router ${n} hosts" oninput="updateWanPreview()">
    <button class="host-box-rm" onclick="removeHostBox(${id})"
            title="Remove" aria-label="Remove Router ${n}">✕</button>`;
  wrap.insertBefore(div, wrap.querySelector('.btn-add'));
  renumberHostBoxes();
  updateWanPreview();
}

function removeHostBox(id) {
  document.getElementById(`hb-${id}`)?.remove();
  renumberHostBoxes();
  updateWanPreview();
}

function renumberHostBoxes() {
  document.querySelectorAll('#hostBoxes .host-box').forEach((b, i) => {
    b.querySelector('.host-box-tag').textContent = `R${i + 1}`;
  });
}

function getRouterCount() {
  return document.querySelectorAll('#hostBoxes .host-box').length;
}

function getHostInputs() {
  return Array.from(document.querySelectorAll('#hostBoxes .host-box'))
    .map((box, i) => ({
      h:    parseInt(box.querySelector('input').value, 10),
      rIdx: i,
    }))
    .filter(({ h }) => !isNaN(h) && h > 0);
}

/* ============================================================
   4. TOPOLOGY SELECTION & WAN LINK GENERATION
   ============================================================ */

let selectedTopo = 'bus';

function selectTopo(topo) {
  selectedTopo = topo;
  ['bus', 'ring'].forEach(t => {
    const c = document.getElementById(`topo-${t}`);
    c.classList.toggle('active', t === topo);
    c.setAttribute('aria-checked', t === topo ? 'true' : 'false');
  });
  updateWanPreview();
}

/**
 * Generates ordered WAN link definitions based on topology.
 *
 * Bus:  R1→R2, R2→R3, ..., R(N-1)→RN        (N-1 links)
 * Ring: R1→R2, R2→R3, ..., R(N-1)→RN, RN→R1 (N   links)
 *
 * DIRECTION RULE:
 *   r0 = OUT side (Serial0/x/0, firstIP)
 *   r1 = IN  side (Serial0/x/1, lastIP)
 */
function generateWANLinks(n, topo) {
  const links = [];
  for (let i = 0; i < n - 1; i++) {
    links.push({ label: `R${i + 1}-R${i + 2}`, r0: i, r1: i + 1 });
  }
  if (topo === 'ring' && n > 2) {
    links.push({ label: `R${n}-R1`, r0: n - 1, r1: 0 });
  }
  return links;
}

function updateWanPreview() {
  const n       = getRouterCount();
  const preview = document.getElementById('wanPreview');
  const info    = document.getElementById('topoInfo');

  if (n < 2) {
    preview.classList.add('hidden');
    info.classList.add('hidden');
    return;
  }

  const links     = generateWANLinks(n, selectedTopo);
  const topoLabel = selectedTopo === 'ring' ? 'Ring' : 'Bus/Linear';

  preview.classList.remove('hidden');
  preview.style.display = 'block';
  document.getElementById('wanTags').innerHTML =
    links.map(l => `<span class="wan-tag">🔗 ${l.label} Link</span>`).join('');

  info.classList.remove('hidden');
  info.innerHTML = `Topology: <b>${topoLabel}</b> · ${n} routers → <b>${links.length} /30 WAN links</b> auto-generated`;
}

/* ============================================================
   5. CORE VLSM CALCULATION
   ============================================================
   KEY DESIGN DECISIONS:
   ─────────────────────
   1. LAN subnets allocate sequentially from base IP (largest first)
   2. WAN /30 subnets are placed at the END of the major network
      → This keeps ALL subnets in the SAME classful network
      → Required for RIP to work with a single network statement
   3. Before allocating, we validate total space needed vs available
   4. If LAN subnets would overlap with WAN reserved space → error

   Supported base networks: ANY valid IPv4 classful address
     Class A: 1.x.x.x – 126.x.x.x  (large, up to /8)
     Class B: 128.x.x.x – 191.x.x.x (medium, up to /16)
     Class C: 192.x.x.x – 223.x.x.x (small, up to /24)
   ============================================================ */

let vlsmData      = [];
let lanSubnets    = [];
let serialSubnets = [];
let topoUsed      = '';
let currentProto  = '';

function calculate() {
  document.getElementById('error').textContent = '';

  // ── Validate base IP ───────────────────────────────────
  const baseStr = document.getElementById('base').value.trim();
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(baseStr)) {
    showError('Invalid base IP address. Use format: x.x.x.x');
    return;
  }

  const inputs = getHostInputs();
  if (!inputs.length) {
    showError('Add at least one router with a host count.');
    return;
  }

  vlsmData = []; lanSubnets = []; serialSubnets = [];
  topoUsed = selectedTopo;

  const n        = inputs.length;
  const wanLinks = generateWANLinks(n, selectedTopo);

  // Sort hosts descending — VLSM rule: largest subnet first
  const sorted = [...inputs].sort((a, b) => b.h - a.h);
  const baseInt = ipToInt(baseStr);

  // ── Compute address space boundaries ──────────────────
  // Get the last address of the major classful network
  const majorLastInt = getMajorLastAddress(baseStr);
  // Total address space in this major network
  const majorSize    = (majorLastInt - baseInt + 1) >>> 0;

  // Pre-calculate total space needed for all LAN subnets
  let   lanSpaceNeeded = 0;
  const wanSpaceNeeded = wanLinks.length * 4; // each /30 = 4 addresses

  for (const { h } of sorted) {
    const e = findCidr(h);
    if (!e) {
      showError(`No CIDR block found for ${h} hosts. Try a larger base network.`);
      return;
    }
    lanSpaceNeeded += e.block;
  }

  const totalNeeded = lanSpaceNeeded + wanSpaceNeeded;

  // ── Validate enough space in major network ─────────────
  if (totalNeeded > majorSize) {
    const baseClass = getMajorNetworkClass(baseStr);
    showError(
      `Not enough address space in ${getMajorNetwork(baseStr)} (${baseClass}). ` +
      `Need ${totalNeeded.toLocaleString()} addresses, have ${majorSize.toLocaleString()}. ` +
      `Use a Class ${baseClass === 'C' ? 'B (e.g. 172.16.0.0)' :
        baseClass === 'B' ? 'A (e.g. 10.0.0.0)' : 'A'} base network or reduce host counts.`
    );
    return;
  }

  // ── WAN reserved block start (end of major network) ───
  // WAN /30 links are placed at the TAIL of the major network.
  // This keeps all subnets in the same classful network for RIP.
  const wanStart = getWanStartAddress(baseStr, wanLinks.length);

  // ── LAN subnet allocation ──────────────────────────────
  let cursor = baseInt;

  for (const { h, rIdx } of sorted) {
    const e       = findCidr(h);
    const netInt  = cursor >>> 0;
    const bcastInt = (netInt + e.block - 1) >>> 0;

    // Safety check: LAN must not overlap WAN reserved space
    if (bcastInt >= wanStart) {
      showError(
        `LAN subnet for R${rIdx + 1} (${h} hosts) overlaps with reserved WAN space. ` +
        `Use a larger base network (e.g. ${
          getMajorNetworkClass(baseStr) === 'C' ? '172.16.0.0 (Class B)' : '10.0.0.0 (Class A)'
        }).`
      );
      return;
    }

    const sub = {
      type:      'lan',
      routerIdx: rIdx,
      label:     `R${rIdx + 1} LAN`,
      hostsReq:  h,
      cidr:      e.cidr,
      usable:    e.usable,
      octet:     e.octet,
      incr:      e.incr,
      netAddr:   intToIp(netInt),
      netInt,
      mask:      e.mask,
      firstIP:   intToIp((netInt + 1) >>> 0),
      lastIP:    intToIp((bcastInt - 1) >>> 0),
      broadcast: intToIp(bcastInt),
      bcastInt,
      block:     e.block,
    };
    vlsmData.push(sub);
    lanSubnets.push(sub);
    cursor = (bcastInt + 1) >>> 0;
  }

  // Sort LAN subnets by original router order (R1, R2, R3...)
  lanSubnets.sort((a, b) => a.routerIdx - b.routerIdx);

  // ── WAN /30 allocation (at tail of major network) ──────
  // Separated from LAN — these represent SERIAL point-to-point links only.
  // firstIP → OUT side (S0/x/0), lastIP → IN side (S0/x/1)
  let wanCursor = wanStart;

  for (let i = 0; i < wanLinks.length; i++) {
    const wl       = wanLinks[i];
    const netInt   = wanCursor >>> 0;
    const bcastInt = (netInt + 4 - 1) >>> 0;
    const firstInt = (netInt + 1) >>> 0;
    const lastInt  = (bcastInt - 1) >>> 0;

    const sub = {
      type:      'wan',
      label:     `${wl.label} Link`,
      r0idx:     wl.r0,
      r1idx:     wl.r1,
      hostsReq:  2,
      cidr:      30,
      usable:    2,
      octet:     '4th',
      incr:      4,
      netAddr:   intToIp(netInt),
      netInt,
      mask:      CIDR_30.mask,
      firstIP:   intToIp(firstInt),   // OUT side → S0/x/0
      firstInt,
      lastIP:    intToIp(lastInt),    // IN  side → S0/x/1
      lastInt,
      broadcast: intToIp(bcastInt),
      bcastInt,
      block:     4,
    };
    vlsmData.push(sub);
    serialSubnets.push(sub);
    wanCursor = (bcastInt + 1) >>> 0;
  }

  renderTable(cursor, wanCursor);

  document.getElementById('tableCard').classList.remove('hidden');
  document.getElementById('routingCard').classList.remove('hidden');
  document.getElementById('cliPanel').classList.add('hidden');
  ['static', 'rip', 'ospf', 'eigrp'].forEach(p =>
    document.getElementById(`pb-${p}`).classList.remove('active')
  );

  setTimeout(() =>
    document.getElementById('tableCard').scrollIntoView({ behavior: 'smooth', block: 'start' }),
    60
  );
}

function clearAll() {
  vlsmData = []; lanSubnets = []; serialSubnets = [];
  ['vlsmBody', 'cliBlocks', 'summaryRow'].forEach(id =>
    document.getElementById(id).innerHTML = ''
  );
  document.getElementById('error').textContent = '';
  ['tableCard', 'routingCard', 'cliPanel'].forEach(id =>
    document.getElementById(id).classList.add('hidden')
  );
  ['static', 'rip', 'ospf', 'eigrp'].forEach(p =>
    document.getElementById(`pb-${p}`).classList.remove('active')
  );
}

function showError(msg) {
  document.getElementById('error').innerHTML = `<span>⚠</span><span>${msg}</span>`;
}

/* ============================================================
   6. TABLE RENDERER
   ============================================================ */

function renderTable(nextFreeInt, wanNextInt) {
  const body = document.getElementById('vlsmBody');
  body.innerHTML = '';
  let rowNum = 0;

  // LAN rows — sorted largest-first
  [...lanSubnets].sort((a, b) => b.hostsReq - a.hostsReq).forEach(s => {
    rowNum++;
    const tr = document.createElement('tr');
    tr.className = 'row-lan';
    tr.innerHTML = `
      <td>${rowNum}</td>
      <td><span class="td-badge badge-lan">LAN</span></td>
      <td class="td-mono">${s.label}</td>
      <td>${s.hostsReq.toLocaleString()}</td>
      <td>${s.usable.toLocaleString()}</td>
      <td class="td-cidr">/${s.cidr}</td>
      <td>${s.octet}</td>
      <td>${s.incr}</td>
      <td class="td-net">${s.netAddr}</td>
      <td class="td-mask">${s.mask}</td>
      <td class="td-mono">${s.firstIP}</td>
      <td class="td-mono">${s.lastIP}</td>
      <td class="td-mono">${s.broadcast}</td>`;
    body.appendChild(tr);
  });

  // WAN /30 rows — annotated with OUT/IN
  serialSubnets.forEach(s => {
    rowNum++;
    const tr = document.createElement('tr');
    tr.className = 'row-wan';
    const r0name = `R${s.r0idx + 1}`;
    const r1name = `R${s.r1idx + 1}`;
    tr.innerHTML = `
      <td>${rowNum}</td>
      <td><span class="td-badge badge-wan">WAN</span></td>
      <td class="td-mono">${s.label}</td>
      <td>2</td><td>2</td>
      <td class="td-cidr">/30</td>
      <td>4th</td><td>4</td>
      <td class="td-wan-net">${s.netAddr}</td>
      <td class="td-mask">${s.mask}</td>
      <td class="td-mono">${s.firstIP} <span style="color:#6e7681;font-size:10px;">(OUT · ${r0name} S0/1/0)</span></td>
      <td class="td-mono">${s.lastIP}  <span style="color:#6e7681;font-size:10px;">(IN  · ${r1name} S0/1/1)</span></td>
      <td class="td-mono">${s.broadcast}</td>`;
    body.appendChild(tr);
  });

  const totalHosts = lanSubnets.reduce((s, r) => s + r.hostsReq, 0);
  const topoLabel  = topoUsed === 'ring' ? 'Ring' : 'Bus/Linear';

  document.getElementById('tableSubtitle').textContent =
    `${lanSubnets.length} LAN · ${serialSubnets.length} WAN /30 · ${topoLabel} Topology`;

  document.getElementById('summaryRow').innerHTML = `
    <div class="s-chip"><span class="s-chip-label">Routers</span>       <span class="s-chip-val">${lanSubnets.length}</span></div>
    <div class="s-chip"><span class="s-chip-label">LAN Subnets</span>   <span class="s-chip-val">${lanSubnets.length}</span></div>
    <div class="s-chip"><span class="s-chip-label">WAN /30 Links</span> <span class="s-chip-val">${serialSubnets.length}</span></div>
    <div class="s-chip"><span class="s-chip-label">Topology</span>      <span class="s-chip-val">${topoLabel}</span></div>
    <div class="s-chip"><span class="s-chip-label">Total Hosts</span>   <span class="s-chip-val">${totalHosts.toLocaleString()}</span></div>
    <div class="s-chip"><span class="s-chip-label">Next Free (LAN)</span> <span class="s-chip-val">${intToIp(nextFreeInt)}</span></div>
    <div class="s-chip"><span class="s-chip-label">Major Network</span>      <span class="s-chip-val">${getMajorNetwork(intToIp(nextFreeInt)) || "—"}</span></div>
  `;
}

/* ============================================================
   7. ROUTER OBJECT BUILDER — STRICT DIRECTION-AWARE PORT ASSIGNMENT
   ============================================================
   RULES:
     OUT links → Serial0/1/0, Serial0/2/0, Serial0/3/0  (slot = outIdx+1, pin = 0)
     IN  links → Serial0/1/1, Serial0/2/1, Serial0/3/1  (slot = inIdx+1,  pin = 1)

   firstIP of /30 → OUT router's interface
   lastIP  of /30 → IN  router's interface

   This is consistent with Cisco point-to-point serial convention:
     /0 = DCE/DTE OUT side
     /1 = DCE/DTE IN  side
   ============================================================ */

function buildRouters() {
  const routers = lanSubnets.map(lan => ({
    idx:      lan.routerIdx + 1,
    hosts:    lan.hostsReq,
    lan,
    outLinks: [],  // links where this router is the OUT side
    inLinks:  [],  // links where this router is the IN  side
  }));

  serialSubnets.forEach(ser => {
    const rOut = routers.find(r => r.idx === ser.r0idx + 1);
    const rIn  = routers.find(r => r.idx === ser.r1idx + 1);

    if (rOut) {
      rOut.outLinks.push({
        sub:     ser,
        dir:     'OUT',
        ip:      ser.firstIP,       // OUT gets firstIP
        mask:    ser.mask,
        peer:    ser.lastIP,        // peer IP (IN side)
        peerIdx: ser.r1idx + 1,
        label:   ser.label,
      });
    }

    if (rIn) {
      rIn.inLinks.push({
        sub:     ser,
        dir:     'IN',
        ip:      ser.lastIP,        // IN gets lastIP
        mask:    ser.mask,
        peer:    ser.firstIP,       // peer IP (OUT side)
        peerIdx: ser.r0idx + 1,
        label:   ser.label,
      });
    }
  });

  // Assign interface names based on direction
  routers.forEach(router => {
    // OUT interfaces: Serial0/1/0, Serial0/2/0, ...
    router.outLinks.forEach((link, i) => {
      link.iface = `Serial0/${i + 1}/0`;
    });
    // IN interfaces: Serial0/1/1, Serial0/2/1, ...
    router.inLinks.forEach((link, i) => {
      link.iface = `Serial0/${i + 1}/1`;
    });

    // Combined list for iteration convenience
    router.serials = [...router.outLinks, ...router.inLinks];
  });

  return routers;
}

/* ============================================================
   8. VISUAL CONNECTION MAP
   ============================================================
   Output format per link:

   R1 (Serial0/1/0) OUT ─────────── IN (Serial0/1/1) R2
     /30 Network : 172.168.x.x
     OUT IP      : 172.168.x.x  → R1 Serial0/1/0
     IN  IP      : 172.168.x.x  → R2 Serial0/1/1
   ============================================================ */

function buildConnectionMap(routers, topo) {
  const N   = '\n';
  const SEP = '─'.repeat(52);
  let   out = '';

  out += 'CONNECTION MAP — ' + (topo === 'ring' ? 'Ring' : 'Bus/Linear') + ' Topology' + N;
  out += SEP + N;
  out += 'RULE: OUT side → Serial0/x/0  uses firstIP of /30' + N;
  out += '      IN  side → Serial0/x/1  uses lastIP  of /30' + N;
  out += SEP + N + N;

  serialSubnets.forEach((ser, i) => {
    const rOut   = routers.find(r => r.idx === ser.r0idx + 1);
    const rIn    = routers.find(r => r.idx === ser.r1idx + 1);
    if (!rOut || !rIn) return;

    const outLink  = rOut.outLinks.find(l => l.sub.netAddr === ser.netAddr);
    const inLink   = rIn.inLinks.find(l  => l.sub.netAddr === ser.netAddr);
    const outIface = outLink ? outLink.iface : 'Serial0/1/0';
    const inIface  = inLink  ? inLink.iface  : 'Serial0/1/1';

    out += `Link ${i + 1}: ${ser.label}` + N;
    out += `  R${rOut.idx} (${outIface}) OUT ─────────── IN (${inIface}) R${rIn.idx}` + N;
    out += `  /30 Network : ${ser.netAddr}/30  (${ser.mask})` + N;
    out += `  OUT IP      : ${ser.firstIP}  → R${rOut.idx} ${outIface}` + N;
    out += `  IN  IP      : ${ser.lastIP}  → R${rIn.idx} ${inIface}` + N;
    out += N;
  });

  out += SEP + N;
  out += 'FULL CHAIN:  ';
  // Print chain string  R1 → R2 → R3 → ... (→ R1 if ring)
  for (let i = 0; i < lanSubnets.length; i++) {
    out += `R${i + 1}`;
    if (i < lanSubnets.length - 1) out += ' → ';
  }
  if (topo === 'ring' && lanSubnets.length > 2) out += ' → R1';
  out += N;

  return out;
}

/* ============================================================
   9. NEXT-HOP RESOLVER — BFS
   ============================================================ */

function resolveNextHop(router, targetSub, routers) {
  const allLinks = [...router.outLinks, ...router.inLinks];

  // Direct adjacency check
  for (const link of allLinks) {
    const peer     = routers.find(r => r.idx === link.peerIdx);
    if (!peer) continue;
    if (peer.lan.netAddr === targetSub.netAddr) return link.peer;
    const peerAll  = [...peer.outLinks, ...peer.inLinks];
    if (peerAll.some(pl => pl.sub.netAddr === targetSub.netAddr)) return link.peer;
  }

  // Multi-hop BFS (handles ring topology)
  const visited = new Set([router.idx]);
  const queue   = allLinks.map(s => ({ peerIdx: s.peerIdx, nextHop: s.peer }));

  while (queue.length) {
    const { peerIdx, nextHop } = queue.shift();
    if (visited.has(peerIdx)) continue;
    visited.add(peerIdx);

    const pr = routers.find(r => r.idx === peerIdx);
    if (!pr) continue;

    if (pr.lan.netAddr === targetSub.netAddr) return nextHop;
    const prAll = [...pr.outLinks, ...pr.inLinks];
    if (prAll.some(pl => pl.sub.netAddr === targetSub.netAddr)) return nextHop;
    prAll.forEach(s => {
      if (!visited.has(s.peerIdx)) queue.push({ peerIdx: s.peerIdx, nextHop });
    });
  }

  return allLinks.length > 0 ? allLinks[0].peer : null;
}

/* ============================================================
   10. CISCO IOS CLI BUILDERS
   ============================================================ */

const NL = '\n';

/**
 * Stage 1 — Interface Configuration
 *
 * Pure Cisco IOS syntax:
 *   • No leading spaces before commands
 *   • ! comments are valid IOS syntax (ignored by parser)
 *   • enable + configure terminal at start
 *   • exit after each interface block
 *   • end at bottom
 *
 * Interface order:
 *   1. FastEthernet0/0 (LAN)
 *   2. OUT serial links (Serial0/1/0, Serial0/2/0, ...)
 *   3. IN  serial links (Serial0/1/1, Serial0/2/1, ...)
 */
function generateInterfaces(router) {
  let c = '';
  c += 'enable'             + NL;
  c += 'configure terminal' + NL;
  c += NL;

  // LAN interface
  c += '!' + NL;
  c += '! LAN Interface' + NL;
  c += '!' + NL;
  c += 'interface FastEthernet0/0'                                    + NL;
  c += 'ip address ' + router.lan.firstIP + ' ' + router.lan.mask    + NL;
  c += 'no shutdown'                                                  + NL;
  c += 'exit'                                                         + NL;

  // OUT serial interfaces
  router.outLinks.forEach(link => {
    c += NL;
    c += '!' + NL;
    c += '! OUT to R' + link.peerIdx + ' — ' + link.iface            + NL;
    c += '!' + NL;
    c += 'interface ' + link.iface                                    + NL;
    c += 'ip address ' + link.ip + ' ' + link.mask                   + NL;
    c += 'no shutdown'                                                + NL;
    c += 'exit'                                                       + NL;
  });

  // IN serial interfaces
  router.inLinks.forEach(link => {
    c += NL;
    c += '!' + NL;
    c += '! IN from R' + link.peerIdx + ' — ' + link.iface           + NL;
    c += '!' + NL;
    c += 'interface ' + link.iface                                    + NL;
    c += 'ip address ' + link.ip + ' ' + link.mask                   + NL;
    c += 'no shutdown'                                                + NL;
    c += 'exit'                                                       + NL;
  });

  c += NL;
  c += 'end' + NL;
  return c;
}

/* ============================================================
   HELPER FUNCTIONS — ROUTING PROTOCOL SUPPORT
   ============================================================ */

/**
 * getMajorNetwork(ip)
 * ─────────────────────────────────────────────────────────────
 * Converts any IP address to its CLASSFUL major network.
 * This is the exact logic Cisco IOS uses for RIP network statements.
 *
 * Cisco classful boundary rules:
 *   Class A  (1–126)   → a.0.0.0     /8
 *   Class B  (128–191) → a.b.0.0     /16
 *   Class C  (192–223) → a.b.c.0     /24
 *
 * Examples:
 *   172.168.0.1       → 172.168.0.0   (Class B)
 *   172.168.255.241   → 172.168.0.0   (Class B — same major network)
 *   10.0.0.1          → 10.0.0.0      (Class A)
 *   192.168.1.1       → 192.168.1.0   (Class C)
 */
function getMajorNetwork(ip) {
  const parts = ip.trim().split('.').map(Number);
  const a = parts[0], b = parts[1], c = parts[2];
  if (a >= 1   && a <= 126) return a + '.0.0.0';
  if (a >= 128 && a <= 191) return a + '.' + b + '.0.0';
  if (a >= 192 && a <= 223) return a + '.' + b + '.' + c + '.0';
  return null;
}

/**
 * getMajorLastAddress — Last IP address of a classful major network
 * Used to compute available address space and validate capacity.
 */

/**
 * getWanStartAddress — Places WAN /30 blocks at end of major network
 *
 * Ensures ALL WAN subnets stay inside the same classful network as LAN.
 * Working backwards from the last address of the major network.
 */
function getWanStartAddress(baseIp, wanCount) {
  const majorLastInt = getMajorLastAddress(baseIp);
  const totalNeeded  = wanCount * 4;
  let   wanStart     = (majorLastInt - totalNeeded + 1) >>> 0;
  wanStart           = (wanStart & ~3) >>> 0; // align to /30 boundary
  return wanStart;
}

function getMajorLastAddress(ip) {
  const n      = ipToInt(ip);
  const first  = (n >>> 24) & 255;
  const second = (n >>> 16) & 255;
  const third  = (n >>>  8) & 255;

  if (first >= 1   && first <= 126) return ((first << 24) | 0x00FFFFFF) >>> 0; // Class A
  if (first >= 128 && first <= 191) return ((first << 24) | (second << 16) | 0x0000FFFF) >>> 0; // Class B
  return ((first << 24) | (second << 16) | (third << 8) | 0xFF) >>> 0; // Class C
}

/**
 * getMajorNetworkClass — Returns 'A', 'B', or 'C' for a given IP
 */
function getMajorNetworkClass(ip) {
  const first = (ipToInt(ip) >>> 24) & 255;
  if (first >= 1   && first <= 126) return 'A';
  if (first >= 128 && first <= 191) return 'B';
  return 'C';
}


/**
 * bfsHopCount(router, targetSub, routers)
 * ─────────────────────────────────────────────────────────────
 * Returns the minimum hop count from a router to the router
 * that owns a given target subnet using Breadth-First Search.
 *
 * Used by generateStatic() to order routes farthest → nearest,
 * which is the Cisco best-practice output order for static configs.
 */
function bfsHopCount(router, targetSub, routers) {
  const visited = new Set([router.idx]);
  const queue   = [...router.outLinks, ...router.inLinks]
                    .map(l => ({ peerIdx: l.peerIdx, hops: 1 }));

  while (queue.length) {
    const { peerIdx, hops } = queue.shift();
    if (visited.has(peerIdx)) continue;
    visited.add(peerIdx);

    const pr = routers.find(r => r.idx === peerIdx);
    if (!pr) continue;

    if (pr.lan.netAddr === targetSub.netAddr) return hops;
    const prAll = [...pr.outLinks, ...pr.inLinks];
    if (prAll.some(pl => pl.sub.netAddr === targetSub.netAddr)) return hops;

    prAll.forEach(l => {
      if (!visited.has(l.peerIdx)) queue.push({ peerIdx: l.peerIdx, hops: hops + 1 });
    });
  }
  return 999;
}

/**
 * findAlternatePath(router, targetSub, primaryNextHop, routers)
 * ─────────────────────────────────────────────────────────────
 * Finds the SECONDARY next-hop to a target subnet —
 * the path going the OTHER direction around the ring.
 *
 * Used by generateStatic() to create floating backup routes (AD=5)
 * in ring topology. Returns null for bus topology (no alternate path).
 */
function findAlternatePath(router, targetSub, primaryNextHop, routers) {
  const allLinks      = [...router.outLinks, ...router.inLinks];
  const alternateLinks = allLinks.filter(l => l.peer !== primaryNextHop);

  for (const link of alternateLinks) {
    const visited = new Set([router.idx]);
    const queue   = [{ peerIdx: link.peerIdx, nextHop: link.peer }];

    while (queue.length) {
      const { peerIdx, nextHop } = queue.shift();
      if (visited.has(peerIdx)) continue;
      visited.add(peerIdx);

      const pr = routers.find(r => r.idx === peerIdx);
      if (!pr) continue;

      if (pr.lan.netAddr === targetSub.netAddr) return nextHop;
      const prAll = [...pr.outLinks, ...pr.inLinks];
      if (prAll.some(pl => pl.sub.netAddr === targetSub.netAddr)) return nextHop;

      prAll.forEach(s => {
        if (!visited.has(s.peerIdx)) queue.push({ peerIdx: s.peerIdx, nextHop });
      });
    }
  }
  return null;
}

/* ============================================================
   STAGE 2 — ROUTING PROTOCOL GENERATORS
   ============================================================

   Administrative Distance reference (lower = more trusted):
     Static Route   AD = 1
     EIGRP Internal AD = 90
     OSPF           AD = 110
     RIP v2         AD = 120

   All functions:
     • Start with enable + configure terminal
     • End with exit (from routing mode) + end
     • Use no leading spaces on commands
     • Use ! comment lines (valid Cisco IOS syntax)
   ============================================================ */

/**
 * generateStatic(router, routers)
 * ─────────────────────────────────────────────────────────────
 * Generates ip route commands following strict Cisco rules:
 *
 *  ✔ Routes ONLY to remote networks (never directly connected)
 *  ✔ Next-hop = the closest BFS neighbor toward the destination
 *  ✔ Output order: farthest networks first → nearest last
 *  ✔ Ring topology: primary route (AD=1) + floating backup (AD=5)
 *  ✔ Bus topology: single primary route per destination
 *  ✔ Includes both LAN and WAN /30 routes for full reachability
 *
 * Floating static route logic (ring only):
 *   ip route <net> <mask> <primary-nh>      ← AD=1, preferred
 *   ip route <net> <mask> <backup-nh>  5    ← AD=5, only used if primary fails
 *
 * Syntax: ip route <destination> <mask> <next-hop-ip>
 */
function generateStatic(router, routers) {
  const myNets = new Set([
    router.lan.netAddr,
    ...router.outLinks.map(l => l.sub.netAddr),
    ...router.inLinks.map(l  => l.sub.netAddr),
  ]);

  const remoteSubs = [...lanSubnets, ...serialSubnets]
    .filter(sub => !myNets.has(sub.netAddr));

  // Sort farthest destinations first (Cisco best-practice output order)
  remoteSubs.sort((a, b) => bfsHopCount(router, b, routers) - bfsHopCount(router, a, routers));

  let c = '';
  c += 'enable'             + NL;
  c += 'configure terminal' + NL;
  c += NL;
  c += '! ── Static Routing ─────────────────────────────────' + NL;
  c += '! Syntax: ip route <network> <mask> <next-hop>'        + NL;
  c += '! AD=1 (primary)   AD=5 (floating backup — ring only)' + NL;
  c += NL;

  remoteSubs.forEach(sub => {
    const primaryNH = resolveNextHop(router, sub, routers);
    if (!primaryNH) return;

    // Primary static route — AD 1 (default, most trusted)
    c += 'ip route ' + sub.netAddr + ' ' + sub.mask + ' ' + primaryNH + NL;

    // Floating static backup — ring topology only
    // AD=5: higher than 1 so it is never used while primary is active.
    // Automatically becomes active if the primary link goes down.
    if (topoUsed === 'ring') {
      const backupNH = findAlternatePath(router, sub, primaryNH, routers);
      if (backupNH && backupNH !== primaryNH) {
        c += 'ip route ' + sub.netAddr + ' ' + sub.mask + ' ' + backupNH + ' 5' + NL;
      }
    }
  });

  c += NL;
  c += 'end' + NL;
  return c;
}

/**
 * generateRIP(router)
 * ─────────────────────────────────────────────────────────────
 * Generates RIP v2 configuration following REAL Cisco IOS behavior:
 *
 * KEY RULE: The `network` command uses CLASSFUL major networks ONLY.
 *   ✔  network 172.168.0.0     (Class B — covers ALL 172.168.x.x)
 *   ✘  network 172.168.0.0    (wrong — DO NOT also add:)
 *   ✘  network 172.168.255.240 (this is a subnet, not a major network)
 *
 * How it works:
 *   1. Collect every IP configured on this router (LAN + all serials)
 *   2. Convert each IP to its classful major network
 *   3. Deduplicate → one network statement per unique major network
 *   4. If all subnets are 172.168.x.x → only ONE statement needed
 *
 * passive-interface FastEthernet0/0:
 *   Stops RIP hello packets from being sent to LAN end hosts.
 *   Prevents routing table leakage and unnecessary traffic on LAN.
 *   The interface still RECEIVES updates — it just stops SENDING them.
 *
 * no auto-summary:
 *   Required for classless routing. Without it, RIP auto-summarizes
 *   routes at class boundaries, causing discontiguous network issues.
 *
 * Discontiguous network warning:
 *   If LAN is 172.168.x.x but WAN /30 falls in 172.169.x.x,
 *   two major networks are needed — RIP will have routing issues.
 *   The VLSM calculator prevents this by placing all /30 links
 *   inside the same major network as the base IP.
 */
function generateRIP(router) {
  const allLinks = [...router.outLinks, ...router.inLinks];

  // Collect all IPs on this router: LAN + all serial interfaces
  const allIPs = [
    router.lan.firstIP,
    ...allLinks.map(l => l.ip),
  ];

  // Convert to classful major networks and deduplicate
  const majorNets = new Set();
  allIPs.forEach(ip => {
    const major = getMajorNetwork(ip);
    if (major) majorNets.add(major);
  });

  let c = '';
  c += 'enable'                                                         + NL;
  c += 'configure terminal'                                             + NL;
  c += NL;
  c += '! ── RIP Version 2 ──────────────────────────────────'          + NL;
  c += '! Classful major network statements only'                        + NL;
  c += '! One "network" covers ALL subnets of that class'               + NL;
  c += NL;
  c += 'router rip'                                                      + NL;
  c += 'version 2'                                                       + NL;
  c += 'no auto-summary'                                                 + NL;

  majorNets.forEach(net => {
    c += 'network ' + net + NL;
  });

  // passive-interface: suppress RIP hellos toward LAN hosts
  // The LAN still participates in RIP — it just stops sending updates outward
  c += 'passive-interface FastEthernet0/0'                               + NL;
  c += 'exit'                                                            + NL;
  c += NL;
  c += 'end'                                                             + NL;
  return c;
}

/**
 * generateOSPF(router)
 * ─────────────────────────────────────────────────────────────
 * Generates OSPF configuration following Cisco IOS rules:
 *
 * Process ID (ospf 1):
 *   Locally significant only — does NOT need to match between routers.
 *   All routers use Process ID 1 by convention.
 *
 * Network statement syntax:
 *   network <network-address> <wildcard-mask> area <area-id>
 *   Wildcard mask = bitwise inverse of subnet mask
 *     /30 → mask 255.255.255.252 → wildcard 0.0.0.3
 *     /24 → mask 255.255.255.0   → wildcard 0.0.0.255
 *     /17 → mask 255.255.128.0   → wildcard 0.0.127.255
 *
 * OSPF declares EXACT subnets (unlike RIP which uses major classes).
 * Every interface — LAN and WAN — must be declared individually.
 *
 * passive-interface FastEthernet0/0:
 *   Stops OSPF hello packets on LAN toward end hosts.
 *   Prevents unnecessary OSPF traffic and neighbor attempts on LAN.
 *   Interface still advertises its network — just no hellos sent outward.
 *
 * Area 0 (backbone area):
 *   All interfaces in a simple single-area OSPF topology use area 0.
 *   Required for Packet Tracer standard configurations.
 */
function generateOSPF(router) {
  const allLinks = [...router.outLinks, ...router.inLinks];

  let c = '';
  c += 'enable'                                                          + NL;
  c += 'configure terminal'                                              + NL;
  c += NL;
  c += '! ── OSPF (Open Shortest Path First) ─────────────────'         + NL;
  c += '! Process ID 1 — locally significant, need not match peers'     + NL;
  c += '! Wildcard mask = inverse of subnet mask'                        + NL;
  c += '! All interfaces declared with exact subnet + wildcard + area 0' + NL;
  c += NL;
  c += 'router ospf 1'                                                   + NL;

  // LAN network — advertise exact subnet with wildcard mask
  c += 'network ' + router.lan.netAddr + ' ' + wildcardOf(router.lan.mask) + ' area 0' + NL;

  // WAN serial networks — each /30 declared individually
  allLinks.forEach(link => {
    c += 'network ' + link.sub.netAddr + ' ' + wildcardOf(link.mask) + ' area 0' + NL;
  });

  // passive-interface: stops OSPF hellos toward LAN hosts
  c += 'passive-interface FastEthernet0/0'                               + NL;
  c += 'exit'                                                            + NL;
  c += NL;
  c += 'end'                                                             + NL;
  return c;
}

/**
 * generateEIGRP(router)
 * ─────────────────────────────────────────────────────────────
 * Generates EIGRP configuration following Cisco IOS rules:
 *
 * AS number (eigrp 100):
 *   MUST match on ALL routers in the same EIGRP domain.
 *   Unlike OSPF process ID, EIGRP AS number is globally significant.
 *   Mismatched AS numbers = no neighbor adjacency = no routing.
 *
 * Network statement with wildcard mask:
 *   Enables EIGRP on specific interfaces only.
 *   Same wildcard logic as OSPF — bitwise inverse of subnet mask.
 *   More precise than classful RIP — every subnet declared individually.
 *
 * no auto-summary:
 *   Required when subnets of the same classful network appear on
 *   different interfaces. Disables automatic route summarization
 *   at classful boundaries. Essential for modern networks.
 *
 * passive-interface FastEthernet0/0:
 *   Stops EIGRP hello packets toward LAN end hosts.
 *   Interface still participates in EIGRP routing — just no hellos outward.
 *
 * Administrative Distance:
 *   EIGRP internal routes = AD 90 (lowest among IGPs = most preferred)
 *   EIGRP external routes = AD 170
 *
 * Multicast address:
 *   EIGRP uses multicast 224.0.0.10 for neighbor discovery and updates.
 */
function generateEIGRP(router) {
  const allLinks = [...router.outLinks, ...router.inLinks];

  let c = '';
  c += 'enable'                                                                     + NL;
  c += 'configure terminal'                                                         + NL;
  c += NL;
  c += '! ── EIGRP (Enhanced Interior Gateway Routing Protocol) ─'                  + NL;
  c += '! AS number 100 — MUST match on ALL routers'                                + NL;
  c += '! Wildcard mask = inverse of subnet mask'                                   + NL;
  c += '! AD=90 internal (most preferred among dynamic IGPs)'                       + NL;
  c += NL;
  c += 'router eigrp 100'                                                           + NL;
  c += 'no auto-summary'                                                            + NL;

  // LAN network — exact subnet with wildcard mask
  c += 'network ' + router.lan.netAddr + ' ' + wildcardOf(router.lan.mask)         + NL;

  // WAN serial networks — each /30 declared individually
  allLinks.forEach(link => {
    c += 'network ' + link.sub.netAddr + ' ' + wildcardOf(link.mask)               + NL;
  });

  // passive-interface: stops EIGRP hellos toward LAN hosts
  c += 'passive-interface FastEthernet0/0'                                          + NL;
  c += 'exit'                                                                       + NL;
  c += NL;
  c += 'end'                                                                        + NL;
  return c;
}

/* ============================================================
   11. CLI RENDERER
   ============================================================ */

const PROTO_NAMES = {
  static: 'Static Routing',
  rip:    'RIP v2',
  ospf:   'OSPF',
  eigrp:  'EIGRP',
};

const PROTO_BADGE_CLASS = {
  static: 'cpb-static',
  rip:    'cpb-rip',
  ospf:   'cpb-ospf',
  eigrp:  'cpb-eigrp',
};

function generateCLI(proto) {
  if (!vlsmData.length) { alert('Please calculate VLSM first.'); return; }

  currentProto = proto;
  ['static', 'rip', 'ospf', 'eigrp'].forEach(p =>
    document.getElementById(`pb-${p}`).classList.toggle('active', p === proto)
  );

  const routers  = buildRouters();
  const blocksEl = document.getElementById('cliBlocks');
  blocksEl.innerHTML = '';

  document.getElementById('cliTitleText').textContent =
    `cisco-ios — ${PROTO_NAMES[proto]} — ${topoUsed} topology`;
  document.getElementById('cliProtoBadge').innerHTML =
    `<span class="cli-proto-badge ${PROTO_BADGE_CLASS[proto]}">${PROTO_NAMES[proto]}</span>`;

  // ── Connection Map block ──────────────────────────────
  const mapText  = buildConnectionMap(routers, topoUsed);
  const mapBlock = document.createElement('div');
  mapBlock.className = 'router-block';
  mapBlock._fullCli  = mapText;
  mapBlock._stage1   = mapText;
  mapBlock._stage2   = '';
  mapBlock._label    = 'Connection Map';

  const mapHdr     = document.createElement('div');
  mapHdr.className = 'router-block-header';
  mapHdr.innerHTML = `
    <span class="router-block-title">🔗 Connection Map — Port & IP Assignment</span>
    <div class="router-block-btns">
      <button class="cli-btn cli-btn-copy" onclick="copyBlock(this)">⎘ Copy Map</button>
    </div>`;
  mapBlock.appendChild(mapHdr);

  const mapCode     = document.createElement('div');
  mapCode.className = 'cli-code';
  mapCode.style.color = '#60a5fa';
  mapCode.textContent = mapText;
  mapBlock.appendChild(mapCode);
  blocksEl.appendChild(mapBlock);

  // ── Per-router CLI blocks ─────────────────────────────
  routers.forEach(router => {
    const stage1 = generateInterfaces(router);
    let   stage2 = '';

    switch (proto) {
      case 'static': stage2 = generateStatic(router, routers); break;
      case 'rip':    stage2 = generateRIP(router);             break;
      case 'ospf':   stage2 = generateOSPF(router);            break;
      case 'eigrp':  stage2 = generateEIGRP(router);           break;
    }

    const fullCli  = stage1 + NL + stage2;
    const outPorts = router.outLinks.map(l => `${l.iface} → R${l.peerIdx} (${l.ip})`).join(', ') || '—';
    const inPorts  = router.inLinks.map(l  => `${l.iface} ← R${l.peerIdx} (${l.ip})`).join(', ') || '—';
    const title    = `Router ${router.idx} — ${router.hosts.toLocaleString()} Hosts — LAN: ${router.lan.netAddr}/${router.lan.cidr}`;
    const portInfo = `OUT: ${outPorts}  |  IN: ${inPorts}`;

    appendRouterBlock(blocksEl, title, portInfo, stage1, stage2, fullCli, proto);
  });

  document.getElementById('cliPanel').classList.remove('hidden');
  setTimeout(() =>
    document.getElementById('cliPanel').scrollIntoView({ behavior: 'smooth', block: 'start' }),
    60
  );
}

function appendRouterBlock(container, title, portInfo, stage1, stage2, fullCli, proto) {
  const block     = document.createElement('div');
  block.className = 'router-block';
  block._fullCli  = fullCli;
  block._stage1   = stage1;
  block._stage2   = stage2;
  block._label    = title;

  const hdr     = document.createElement('div');
  hdr.className = 'router-block-header';
  hdr.innerHTML = `
    <div>
      <div class="router-block-title">▶ ${title}</div>
      <div class="router-block-ports">${portInfo}</div>
    </div>
    <div class="router-block-btns">
      <button class="cli-btn cli-btn-copy" onclick="copyStage(this,1)">⎘ Stage 1</button>
      <button class="cli-btn cli-btn-copy" onclick="copyStage(this,2)">⎘ Stage 2</button>
      <button class="cli-btn cli-btn-copy" onclick="copyBlock(this)">⎘ Both</button>
    </div>`;
  block.appendChild(hdr);

  const sl1     = document.createElement('div');
  sl1.className = 'stage-label s1';
  sl1.textContent = '── Stage 1: Interface Configuration';
  block.appendChild(sl1);
  const pre1     = document.createElement('div');
  pre1.className = 'cli-code';
  pre1.textContent = stage1;
  block.appendChild(pre1);

  const sl2     = document.createElement('div');
  sl2.className = 'stage-label s2';
  sl2.textContent = `── Stage 2: ${PROTO_NAMES[proto]} Configuration`;
  block.appendChild(sl2);
  const pre2     = document.createElement('div');
  pre2.className = 'cli-code';
  pre2.textContent = stage2;
  block.appendChild(pre2);

  container.appendChild(block);
}

/* ============================================================
   12. COPY & EXPORT FUNCTIONS
   ============================================================ */

function copyBlock(btn) {
  const block = btn.closest('.router-block');
  toClipboard(block._fullCli || '', btn);
}

function copyStage(btn, stage) {
  const block = btn.closest('.router-block');
  toClipboard(stage === 1 ? (block._stage1 || '') : (block._stage2 || ''), btn);
}

function copyAllCLI() {
  toClipboard(getAllCLI(), null);
  alert('All CLI copied to clipboard!');
}

function toClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    if (!btn) return;
    const orig = btn.textContent;
    btn.textContent = '✓ Done';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });
}

function getAllCLI() {
  return Array.from(document.querySelectorAll('#cliBlocks .router-block'))
    .map(b => {
      const sep = '! ' + '-'.repeat(60);
      return `${sep}\n! ${b._label}\n${sep}\n\n${b._fullCli}`;
    }).join('\n');
}

function exportCLI()     { exportCLIText(); }

function exportCLIText() {
  const base = document.getElementById('base').value.trim().replace(/\./g, '_');
  dlBlob(getAllCLI(), 'text/plain', `VLSM_CLI_${currentProto}_${base}.txt`);
}

function exportCLIExcel() {
  const base  = document.getElementById('base').value.trim();
  const proto = PROTO_NAMES[currentProto] || '';
  const lines = [`${base} - VLSM CLI (${proto})`, '', ' '];

  document.querySelectorAll('#cliBlocks .router-block').forEach(b => {
    lines.push(b._label || '');
    lines.push('--- Stage 1: Interface Configuration ---');
    (b._stage1 || '').split('\n').forEach(l => lines.push('\t' + l));
    lines.push('--- Stage 2: Routing Configuration ---');
    (b._stage2 || '').split('\n').forEach(l => lines.push('\t' + l));
    lines.push('');
  });

  dlBlob('\uFEFF' + lines.join('\n'), 'application/vnd.ms-excel;charset=utf-8',
    `VLSM_CLI_${currentProto}_${base.replace(/\./g, '_')}.xls`);
}

/* ============================================================
   13. EXCEL TABLE EXPORT
   ============================================================ */

function downloadExcel() {
  const rows = document.querySelectorAll('#vlsmTable tr');
  if (rows.length <= 1) { alert('Please calculate VLSM first.'); return; }

  const base = document.getElementById('base').value.trim();
  const topo = topoUsed === 'ring' ? 'Ring' : 'Bus/Linear';

  let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
    xmlns:x="urn:schemas-microsoft-com:office:excel"
    xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="UTF-8">
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets>
<x:ExcelWorksheet><x:Name>VLSM</x:Name></x:ExcelWorksheet>
</x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
<style>
body{font-family:Arial;font-size:11pt;}
.title{font-size:14pt;font-weight:bold;color:#1e3a8a;background:#dbeafe;padding:6px 14px;}
.sub{font-size:9pt;color:#555;background:#f0f9ff;padding:4px 14px;}
th{background:#1e40af;color:white;font-weight:bold;padding:8px 16px;border:1px solid #1d4ed8;white-space:nowrap;}
td{padding:7px 16px;border:1px solid #d1d5db;white-space:nowrap;}
.lan-e{background:#eff6ff;}.lan-o{background:#fff;}.wan-r{background:#fffbeb;}
.td-net{font-weight:bold;color:#1e40af;}.td-wan{font-weight:bold;color:#b45309;}
.td-cidr{font-weight:bold;color:#166534;}
</style></head><body>
<table>
<tr><td colspan="13" class="title">${base} — VLSM Routing Table (${topo})</td></tr>
<tr><td colspan="13" class="sub">Generated: ${new Date().toLocaleString()} · WAN: OUT=firstIP (S0/x/0) · IN=lastIP (S0/x/1)</td></tr>
<tr><td colspan="13" style="height:4px;background:#f0f9ff;"></td></tr>`;

  let lanIdx = 0;
  rows.forEach((r, ri) => {
    if (ri === 0) {
      html += '<tr>';
      r.querySelectorAll('th').forEach(c => { html += `<th>${c.innerText}</th>`; });
      html += '</tr>'; return;
    }
    const isWan = r.classList.contains('row-wan');
    const cls   = isWan ? 'wan-r' : (lanIdx % 2 === 0 ? 'lan-o' : 'lan-e');
    if (!isWan) lanIdx++;
    html += `<tr class="${cls}">`;
    r.querySelectorAll('td').forEach((c, ci) => {
      const ex = ci === 8 ? (isWan ? ' class="td-wan"' : ' class="td-net"')
               : ci === 5 ? ' class="td-cidr"' : '';
      html += `<td${ex}>${c.innerText}</td>`;
    });
    html += '</tr>';
  });

  html += '</table></body></html>';
  dlBlob('\uFEFF' + html, 'application/vnd.ms-excel;charset=utf-8',
    `VLSM_Table_${base.replace(/\./g, '_')}.xls`);
}

/* ============================================================
   HELPER: BLOB FILE DOWNLOAD
   ============================================================ */

function dlBlob(content, type, filename) {
  const blob = new Blob([content], { type });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

/* ============================================================
   14. INITIALISATION
   ============================================================ */

window.addEventListener('DOMContentLoaded', () => {
  const wrap   = document.getElementById('hostBoxes');
  const addBtn = document.createElement('button');
  addBtn.className = 'btn-add';
  addBtn.setAttribute('aria-label', 'Add a new router');
  addBtn.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    </svg> Add Router`;
  addBtn.onclick = () => addHostBox();
  wrap.appendChild(addBtn);

  // Default example routers
  [25000, 15000, 10000, 500].forEach(v => addHostBox(v));
  selectTopo('bus');
});

// Ctrl+Enter keyboard shortcut
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.ctrlKey) calculate();
});
