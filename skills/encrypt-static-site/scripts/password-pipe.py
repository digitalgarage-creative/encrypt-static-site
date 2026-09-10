#!/usr/bin/env python3
"""Human-operated hidden prompt; never place the password in argv or a file."""
import getpass
import pathlib
import subprocess
import sys

if not sys.stdin.isatty():
    sys.exit("Run this command in your own interactive terminal.")
secret = getpass.getpass("Site passphrase: ")
if secret != getpass.getpass("Repeat passphrase: "):
    sys.exit("Passphrases did not match.")
script = pathlib.Path(__file__).resolve().with_name("protect.mjs")
result = subprocess.run(["node", str(script), *sys.argv[1:], "--password-stdin"],
                        input=secret.encode("utf-8"), check=False)
secret = ""
sys.exit(result.returncode)
