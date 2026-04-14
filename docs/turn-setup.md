# H4KKEN — TURN Server Setup (coturn)

> **Purpose**: Guide for setting up a self-hosted TURN server for WebRTC NAT traversal.

## Why TURN?

STUN alone fails for ~20% of NAT types (symmetric NAT). For reliable Mexico ↔ Germany connectivity, a TURN relay server is required. coturn is the standard open-source TURN server.

## Public STUN Servers (Free)

h4kken includes a multi-provider STUN pool that probes and selects the fastest servers automatically. No configuration needed — these are built-in:

| Provider   | URL                                   | Notes                                    |
|------------|---------------------------------------|------------------------------------------|
| Google     | `stun:stun.l.google.com:19302`        | Most well-known, high availability       |
| Cloudflare | `stun:stun.cloudflare.com:3478`       | Global anycast network, low latency      |
| Mozilla    | `stun:stun.services.mozilla.com:3478` | Operated by Mozilla Foundation           |
| Twilio     | `stun:global.stun.twilio.com:3478`    | Enterprise-grade, global PoPs            |

STUN is free and sufficient for ~80% of NAT types. For the remaining ~20% (symmetric NAT), you need TURN.

## Budget TURN Alternatives (for testing / small deployments)

If you don't want to self-host coturn, these are affordable options:

| Service | Price | Limit | URL |
|---------|-------|-------|-----|
| Open Relay (metered.ca) | Free | 20 GB/month | https://www.metered.ca/tools/openrelay/ |
| FastTURN | €9/month | Unlimited | https://fastturn.net/ |

> **Note**: There are no truly free public TURN servers with no limits. TURN relays media traffic (bandwidth-intensive), so providers must charge or cap usage. Self-hosting coturn on your own server is the most cost-effective option for production.

## Docker Compose Setup

Add to your `compose.yaml` alongside the h4kken service:

```yaml
services:
  h4kken:
    build: .
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - TURN_URL=turn:your-server.com:3478
      - TURN_USERNAME=h4kken
      - TURN_CREDENTIAL=${TURN_SECRET}
    restart: unless-stopped

  coturn:
    image: coturn/coturn:4.6
    ports:
      - "3478:3478"        # TURN/STUN (UDP + TCP)
      - "3478:3478/udp"
      - "443:443"          # TLS TURN (firewall bypass)
      - "443:443/udp"
      - "49152-49200:49152-49200/udp"  # Relay port range
    volumes:
      - ./coturn/turnserver.conf:/etc/coturn/turnserver.conf:ro
    restart: unless-stopped
```

## coturn Configuration

Create `coturn/turnserver.conf`:

```ini
# Network
listening-port=3478
tls-listening-port=443
# Restrict relay port range (fewer ports = less firewall config)
min-port=49152
max-port=49200

# Authentication (long-term credentials)
lt-cred-mech
user=h4kken:your-secret-password

# Realm (your domain)
realm=yourdomain.com

# Logging
log-file=/var/log/turnserver.log
verbose

# Security
no-multicast-peers
no-cli
fingerprint

# TLS (optional but recommended for firewall bypass)
# cert=/etc/ssl/certs/your-cert.pem
# pkey=/etc/ssl/private/your-key.pem
```

## Verification

### 1. Test STUN

```bash
# From any machine — should return your server's external IP
curl -s "https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/" 
# Or use Trickle ICE test page in browser with your STUN/TURN URLs
```

### 2. Test TURN Relay

Open two browser tabs, use the [Trickle ICE](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/) tool:
- Add TURN server: `turn:your-server.com:3478`
- Username: `h4kken`, Credential: `your-secret-password`
- Click "Gather candidates" — should show `relay` type candidates

### 3. End-to-End Game Test

1. Start h4kken + coturn: `docker compose up`
2. Open game from two different networks (or use VPN for one)
3. Start a match — check console for transport type
4. Look for `[NET] transport=webrtc` in browser console

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `TURN_URL` | TURN server URL | `turn:h4kken.loust.pro:3478` |
| `TURN_USERNAME` | TURN long-term credential username | `h4kken` |
| `TURN_CREDENTIAL` | TURN long-term credential password | (from `.env`) |

## Security Notes

- Never commit TURN credentials to git (use `.env` file, already in `.gitignore`)
- TLS on port 443 helps bypass restrictive firewalls that block non-standard ports
- Limit relay port range to minimize attack surface
- Use `no-multicast-peers` to prevent relay abuse
