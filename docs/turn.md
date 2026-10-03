# TURN deployment and runtime ICE configuration

WebRTC cannot establish a direct peer-to-peer path across every NAT and firewall combination. A production Verge deployment therefore needs TURN in addition to STUN.

## Runtime credentials

Do not ship long-lived TURN credentials in the static JavaScript bundle.

Set:

```text
VITE_ICE_CONFIG_URL=/api/ice
```

The endpoint should return short-lived credentials:

```json
{
  "iceServers": [
    {
      "urls": "stun:turn.example.com:3478"
    },
    {
      "urls": [
        "turn:turn.example.com:3478?transport=udp",
        "turns:turn.example.com:5349?transport=tcp"
      ],
      "username": "short-lived-username",
      "credential": "short-lived-password"
    }
  ]
}
```

Verge fetches this endpoint immediately before joining a room with `cache: no-store`. The endpoint can be same-origin behind a reverse proxy or another authenticated service exposed through the application origin.

The build-time `VITE_ICE_SERVERS_JSON` variable remains a development/static fallback and must not contain durable production secrets.

## coturn baseline

A production coturn deployment should:

- use a public DNS name with a valid TLS certificate
- expose UDP/TCP TURN on 3478
- expose TURN over TLS on 5349 and, where network policy requires it, make a TLS listener reachable through 443
- use time-limited credentials, normally via TURN REST-style shared-secret authentication
- restrict relay port ranges deliberately at the firewall
- monitor allocation count, failures, bandwidth, and authentication errors
- avoid logging credentials or SDP
- keep the shared TURN authentication secret server-side only

Exact coturn/network configuration depends on the deployment environment and belongs in infrastructure rather than the Verge client.

## Failure behavior

If the runtime ICE endpoint is configured but unavailable or malformed, Verge fails the join attempt with an explicit connectivity-credential error rather than silently falling back to STUN-only behavior.

## Diagnostics

Per-peer WebRTC statistics expose the selected candidate pair. Verge reports whether each established path is direct or TURN-relayed so connectivity failures and unexpected relay usage are visible without exposing credentials.
