#!/usr/bin/env python3
"""Build a deployment ZIP from the working tree, including new uncommitted modules.
No credentials, database, user .env, dependencies, or development outputs are included.
"""
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parents[1]
version = json.loads((root / "release.json").read_text())["version"]
out = root / "releases" / ("my-confession-" + version + ".zip")
files = [".dockerignore", ".gitignore", "Dockerfile", "compose.yaml", "server.js", "admin.js",
         "backup.js", "release.json", "package.json", "package-lock.json", "start.sh", "start.bat",
         "index.html", "1.5.html", "README.md", "README-DEPLOY.txt", "DEPLOY.md", "UPDATE-20261018.md",
         "playwright.config.cjs"]
for directory in ["lib", "js", "css", "pages", "assets", "docs", "deploy", "scripts", "tests"]:
    files += [str(p.relative_to(root)) for p in (root / directory).rglob("*") if p.is_file() and "__pycache__" not in p.parts]
out.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
    for name in sorted(files):
        archive.write(root / name, name)
print(out)
print("SHA256 " + hashlib.sha256(out.read_bytes()).hexdigest())
