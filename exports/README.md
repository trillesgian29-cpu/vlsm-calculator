# exports/

This directory is used to store generated files when exported from the VLSM Calculator.

Generated files include:
- `VLSM_Table_*.xls`      — VLSM routing table Excel export
- `VLSM_CLI_static_*.txt` — Static routing CLI export
- `VLSM_CLI_rip_*.txt`    — RIP v2 CLI export
- `VLSM_CLI_ospf_*.txt`   — OSPF CLI export
- `VLSM_CLI_eigrp_*.txt`  — EIGRP CLI export

These files are generated in-browser and downloaded automatically.
They are listed in `.gitignore` and should not be committed to the repository.
