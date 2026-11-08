"""A self-signed certificate for `run.py --ssl`.

Phone browsers only allow the microphone (getUserMedia) on https:// or on localhost, so a phone on the Wi-Fi
needs the worker on https. The certificate covers localhost, this laptop's .local name and its current LAN IP;
it is reused until the LAN IP changes. The phone shows a warning once ("Advanced", then "Proceed").
"""

import datetime
import ipaddress
import socket
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

CERT_DIR = Path(__file__).resolve().parent / ".certs"


def lan_ip() -> str | None:
    """The address other devices on the Wi-Fi reach this laptop at (no packet is sent)."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return None


def _names() -> tuple[list[str], list[str]]:
    hostname = socket.gethostname().removesuffix(".local")
    dns = ["localhost", f"{hostname}.local"]
    ips = ["127.0.0.1"]
    if ip := lan_ip():
        ips.append(ip)
    return dns, ips


def ensure_self_signed() -> tuple[Path, Path]:
    """Return (certfile, keyfile), creating or refreshing them when the LAN IP is not covered."""
    cert_path, key_path = CERT_DIR / "cert.pem", CERT_DIR / "key.pem"
    dns, ips = _names()

    if cert_path.exists() and key_path.exists():
        cert = x509.load_pem_x509_certificate(cert_path.read_bytes())
        san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
        covered = {str(ip) for ip in san.get_values_for_type(x509.IPAddress)}
        if set(ips) <= covered:
            return cert_path, key_path

    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Handoff voice worker (dev)")])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=30))
        .add_extension(
            x509.SubjectAlternativeName(
                [x509.DNSName(d) for d in dns] + [x509.IPAddress(ipaddress.ip_address(i)) for i in ips]
            ),
            critical=False,
        )
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )

    CERT_DIR.mkdir(exist_ok=True)
    key_path.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
        )
    )
    key_path.chmod(0o600)
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    return cert_path, key_path
