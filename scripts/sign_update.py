#!/usr/bin/env python3
"""Produce a Sparkle edSignature for an update archive.

Ed25519-signs the raw bytes of the file given as argv[1] with the private key
seed in $SPARKLE_ED_PRIVATE_KEY (base64, 32-byte seed — the format printed by
scripts/generate-sparkle-keys.py), then prints the appcast enclosure
attributes:

    sparkle:edSignature="..." length="..."

Equivalent to Sparkle's own `sign_update` tool, but pure stdlib Python so CI
does not need the Sparkle distribution or pip packages to sign a release.

Ed25519 per RFC 8032 (pure-Python reference implementation; fine for signing
one archive per release).
"""

import base64
import hashlib
import os
import sys

# --- Ed25519 (RFC 8032) -----------------------------------------------------

P = 2**255 - 19
L = 2**252 + 27742317777372353535851937790883648493
D = -121665 * pow(121666, P - 2, P) % P

G_Y = 4 * pow(5, P - 2, P) % P


def _recover_x(y, sign):
    x2 = (y * y - 1) * pow(D * y * y + 1, P - 2, P)
    x = pow(x2, (P + 3) // 8, P)
    if (x * x - x2) % P != 0:
        x = x * pow(2, (P - 1) // 4, P) % P
    if (x * x - x2) % P != 0:
        raise ValueError("invalid point")
    if x % 2 != sign:
        x = P - x
    return x


G = (_recover_x(G_Y, 0), G_Y, 1, _recover_x(G_Y, 0) * G_Y % P)  # extended coords


def _point_add(p, q):
    x1, y1, z1, t1 = p
    x2, y2, z2, t2 = q
    a = (y1 - x1) * (y2 - x2) % P
    b = (y1 + x1) * (y2 + x2) % P
    c = 2 * t1 * t2 * D % P
    dd = 2 * z1 * z2 % P
    e, f, g, h = b - a, dd - c, dd + c, b + a
    return (e * f % P, g * h % P, f * g % P, e * h % P)


def _point_mul(s, p):
    q = (0, 1, 1, 0)  # identity
    while s > 0:
        if s & 1:
            q = _point_add(q, p)
        p = _point_add(p, p)
        s >>= 1
    return q


def _point_compress(p):
    x, y, z, _ = p
    zinv = pow(z, P - 2, P)
    x, y = x * zinv % P, y * zinv % P
    return int.to_bytes(y | ((x & 1) << 255), 32, "little")


def _sha512_int(*parts):
    return int.from_bytes(hashlib.sha512(b"".join(parts)).digest(), "little")


def sign(seed, message):
    if len(seed) != 32:
        raise ValueError("seed must be 32 bytes")
    h = hashlib.sha512(seed).digest()
    a = int.from_bytes(h[:32], "little")
    a &= (1 << 254) - 8
    a |= 1 << 254
    prefix = h[32:]
    public = _point_compress(_point_mul(a, G))
    r = _sha512_int(prefix, message) % L
    r_point = _point_compress(_point_mul(r, G))
    k = _sha512_int(r_point, public, message) % L
    s = (r + k * a) % L
    return r_point + int.to_bytes(s, 32, "little")


# --- CLI ---------------------------------------------------------------------


def main():
    if len(sys.argv) != 2:
        sys.exit(f"usage: {sys.argv[0]} <update-archive>")
    key_b64 = os.environ.get("SPARKLE_ED_PRIVATE_KEY")
    if not key_b64:
        sys.exit("SPARKLE_ED_PRIVATE_KEY is not set")
    seed = base64.b64decode(key_b64)
    # Tolerate the 64-byte (seed || public key) form as well.
    if len(seed) == 64:
        seed = seed[:32]
    with open(sys.argv[1], "rb") as f:
        data = f.read()
    signature = base64.b64encode(sign(seed, data)).decode()
    print(f'sparkle:edSignature="{signature}" length="{len(data)}"')


if __name__ == "__main__":
    main()
