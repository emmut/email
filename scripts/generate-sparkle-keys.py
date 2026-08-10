#!/usr/bin/env python3
"""Generate a Sparkle EdDSA signing key pair.

Prints the base64 private key seed (store as the SPARKLE_ED_PRIVATE_KEY GitHub
Actions secret — never commit it) and the base64 public key (goes in
src-tauri/Info.plist under SUPublicEDKey).
"""

import base64
import secrets

from sign_update import G, _point_compress, _point_mul, hashlib


def public_from_seed(seed):
    h = hashlib.sha512(seed).digest()
    a = int.from_bytes(h[:32], "little")
    a &= (1 << 254) - 8
    a |= 1 << 254
    return _point_compress(_point_mul(a, G))


if __name__ == "__main__":
    seed = secrets.token_bytes(32)
    print("SPARKLE_ED_PRIVATE_KEY (GitHub secret, keep private):")
    print(f"  {base64.b64encode(seed).decode()}")
    print("SUPublicEDKey (public, goes in src-tauri/Info.plist):")
    print(f"  {base64.b64encode(public_from_seed(seed)).decode()}")
