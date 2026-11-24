"""Use macOS CA certificates even when the build interpreter came from Homebrew."""
import os

os.environ.setdefault('SSL_CERT_FILE', '/etc/ssl/cert.pem')
