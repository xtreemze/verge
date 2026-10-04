# Production MVP deployment

This deployment runs the browser client, signaling/control plane, and coturn on one Docker host.

## Public endpoints

- `https://<VERGE_DOMAIN>/` — Verge web client
- `wss://<VERGE_DOMAIN>/ws` — signaling
- `https://<VERGE_DOMAIN>/api/ice` — short-lived ICE/TURN credentials
- `https://<VERGE_DOMAIN>/api/rooms` — protected room/invite creation
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
openssl rand -hex 32   # TURN secret
openssl rand -hex 32   # independent invite-signing secret
```

Put the generated values in `VERGE_TURN_SHARED_SECRET` and `VERGE_INVITE_SHARED_SECRET`. Keep them distinct and server-side. The signaling service derives time-limited coturn REST credentials and signs expiring room invitations; neither static secret is shipped in the web bundle.

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
curl -X POST https://$VERGE_DOMAIN/api/rooms
docker compose --env-file .env.production -f deploy/compose.yml ps
```

The ICE response should contain a STUN entry and a TURN entry with an expiring timestamp-based username. The room response should contain a random `roomId`, a versioned `invite`, and an `expiresAt` timestamp.

## Acceptance

Use two devices on different networks (for example Wi-Fi and cellular):

1. Create/open a Verge room and copy its full invitation link.
2. Confirm that the invite link contains both `room` and `invite`, and that the room ID alone cannot join the protected production room.
3. Open the full invitation on the second device.
4. Confirm camera and microphone in both directions.
5. Send chat and a small file both ways.
6. Open **Media capabilities** and inspect the ICE path.
7. A direct path is preferred when available.
8. To prove TURN independently, run the CI relay certification or a build with `VITE_ICE_TRANSPORT_POLICY=relay`; the quality badge must report `relay`.

## Security boundary

WebRTC encrypts media in transit. TURN relays encrypted WebRTC packets and does not receive the application media keys as plaintext. Production room entry requires a signed, expiring invitation token. The token authorizes room access but does not provide authenticated participant identity or application-level media E2EE; those remain separate post-MVP privacy features.

## Operational notes

- Rotate `VERGE_TURN_SHARED_SECRET` by updating both signaling and coturn together.
- Rotate `VERGE_INVITE_SHARED_SECRET` independently; existing invite links become invalid after rotation.
- Keep invite TTL appropriate for the meeting lifecycle; the default is 24 hours.
- Keep TURN credential TTL short; the default is one hour.
- Do not expose a long-lived TURN username/password through `VITE_ICE_SERVERS_JSON` in production.
- Back up Caddy's `caddy_data` volume if certificate/account continuity matters.
- Monitor relay bandwidth: TURN traffic is the primary variable infrastructure cost for this P2P-first architecture.
