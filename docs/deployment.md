# Production MVP deployment

This deployment runs the browser client, signaling/control plane, and coturn on one Docker host.

## Public endpoints

- `https://<VERGE_DOMAIN>/` — Verge web client
- `wss://<VERGE_DOMAIN>/ws` — signaling
- `https://<VERGE_DOMAIN>/api/ice` — short-lived ICE/TURN credentials
- `https://<VERGE_DOMAIN>/healthz` — control-plane health
- `<VERGE_TURN_HOST>:3478` — TURN/STUN over UDP and TCP
- UDP `49160-49200` — TURN relay allocation range

Caddy obtains and renews the HTTPS certificate automatically when the domain resolves to the host and ports 80/443 are reachable.

## Requirements

- Docker Engine with Compose v2
- a public IPv4 address
- DNS A/AAAA record for `VERGE_DOMAIN`
- DNS record for `VERGE_TURN_HOST` (it may be the same host)
- inbound TCP 80, TCP/UDP 443, TCP/UDP 3478, and UDP 49160-49200

## Configure

```bash
cp deploy/.env.production.example .env.production
openssl rand -hex 32
```

Put the generated value in `VERGE_TURN_SHARED_SECRET`. The secret must remain server-side. The signaling service derives time-limited coturn REST credentials and returns those to the browser; the static shared secret is never shipped in the web bundle.

Set `VERGE_PUBLIC_IP` to the host's public IPv4 address. If the host is behind 1:1 NAT, use the externally reachable address and forward the TURN ports/range to this machine.

## Start

```bash
docker compose \
  --env-file .env.production \
  -f deploy/compose.yml \
  up -d --build
```

Check:

```bash
curl https://$VERGE_DOMAIN/healthz
curl https://$VERGE_DOMAIN/api/ice
docker compose --env-file .env.production -f deploy/compose.yml ps
```

The ICE response should contain a STUN entry and a TURN entry with an expiring timestamp-based username.

## Acceptance

Use two devices on different networks (for example Wi-Fi and cellular):

1. Open the same Verge room.
2. Confirm camera and microphone in both directions.
3. Send chat and a small file both ways.
4. Open **Media capabilities** and inspect the ICE path.
5. A direct path is preferred when available.
6. To prove TURN independently, run the CI relay certification or a build with `VITE_ICE_TRANSPORT_POLICY=relay`; the quality badge must report `relay`.

## Security boundary

WebRTC encrypts media in transit. TURN relays encrypted WebRTC packets and does not receive the application media keys as plaintext. The MVP uses high-entropy invite URLs but does not yet provide authenticated participant identity or application-level media E2EE; those remain post-MVP hardening items.

## Operational notes

- Rotate `VERGE_TURN_SHARED_SECRET` by updating both signaling and coturn together.
- Keep TURN credential TTL short; the default is one hour.
- Do not expose a long-lived TURN username/password through `VITE_ICE_SERVERS_JSON` in production.
- Back up Caddy's `caddy_data` volume if certificate/account continuity matters.
- Monitor relay bandwidth: TURN traffic is the primary variable infrastructure cost for this P2P-first architecture.
