# Mock lab — FIXTURE DATA

Mock devices and evidence feeds for developing, demoing and regression-testing the
cross-platform investigation agent **without a Splunk tenant**. Nothing in this directory is a
real system. NetJarvis loads it only when `NETJARVIS_EVIDENCE_FIXTURE` is set, reports every row
under provider `fixture`, and puts a **FIXTURE DATA** banner on any investigation it touches.

```bash
NETJARVIS_EVIDENCE_FIXTURE=1 npm run web        # or npm run dev
npm run demo:investigate                        # prints the jdoe investigation to stdout
npm run demo:investigate -- ip 10.20.0.7 6      # seed by IP, 6h window
npm run demo:investigate -- host LT-4421
```

## Devices (`devices.json`)

| Device | Domain | Platform | Role | Feeds |
|---|---|---|---|---|
| `vpn-asa-1` | firewall | Cisco ASA | VPN concentrator (AnyConnect) | vpn, firewall |
| `fw-pan-1` | firewall | PAN-OS | perimeter firewall | firewall |
| `proxy-zs-1` | proxy | Zscaler ZIA | web proxy | proxy |
| `lb-f5-1` | loadbalancer | F5 TMOS | load balancer | (none — inventory realism) |
| `edr-crowdstrike` | endpoint | CrowdStrike Falcon | EDR tenant | endpoint |
| `idp-okta` | identity | Okta | identity provider | identity |
| `dc-ad-1` | identity | Windows Server | domain controller | identity |
| `aws-prod-account` | cloud | AWS | cloud account 123456789012 | cloud |
| `splunk-es` | siem | Splunk ES | SIEM (notables) | siem |
| `LT-4421` | endpoint | Windows 11 | jdoe's laptop (VPN IP 10.20.0.7) | — |
| `sw1`, `sw2` | data | IOS-XE | Catalyst 9000v access switches (sandbox hostnames) | network |

## Scenario (all times are `offsetMinutes` before "now")

`jdoe` fails Okta three times from `203.0.113.9` then succeeds with a push from a new country →
ASA VPN session assigns `10.20.0.7` → SSH login + config change on `sw1` → PAN denies SMB/RDP to
`198.51.100.4` → CrowdStrike high-severity encoded-PowerShell detection on `LT-4421` → Zscaler
blocks pastebin, allows a 48 MB upload → AWS `ConsoleLogin` (no MFA), `AttachUserPolicy
AdministratorAccess` + `CreateAccessKey` on `svc-backup` → ES notables for each stage → VPN
disconnect. `asmith` is a benign control user who never co-occurs with `jdoe`.

## Adding a feed

Create `<platform>.json` with `{ "platform": "<vpn|proxy|firewall|endpoint|identity|cloud|siem|network>",
"devices": [...], "events": [{ "offsetMinutes", "kind", "severity", "product", "entities": {...},
"summary", "raw": {...} }] }`. Reference only devices present in `devices.json` —
`test/evidence-fixture.test.cjs` validates the whole lab.
