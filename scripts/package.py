"""Package and verify a deterministic Chrome extension ZIP from the bundled build/ directory.

The ZIP contains the bundled runtime files, PRIVACY.md, THIRD_PARTY_NOTICES.md and
LICENSE, with `manifest.json` at its root. Entries are sorted, stored without
compression and use fixed timestamps and permissions, so the archive bytes are
reproducible on every platform. A companion `.sha256` file is written next to it.

Usage:
    python3 scripts/package.py [--source build] [--output dist] [--tag vX.Y.Z]
    python3 scripts/package.py --verify dist/codetree-X.Y.Z.zip [--tag vX.Y.Z]
"""

import argparse
import hashlib
import json
import re
from pathlib import Path
from zipfile import ZIP_STORED, BadZipFile, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parent.parent
# Runtime files copied from the bundle directory.
BUILT = (
    'manifest.json', 'background.js', 'content.js', 'sidebar.css', 'options.html', 'options.js', 'options.css',
    'icons/icon16.png', 'icons/icon48.png', 'icons/icon128.png',
    'fonts/devopicons.woff2', 'fonts/file-icons.woff2', 'fonts/fontawesome.woff2', 'fonts/mfixx.woff2',
)
# Fixed ZIP entry timestamp for reproducible archives.
TIMESTAMP = (2026, 1, 1, 0, 0, 0)


def package_files(source):
    """Return the packaged files (archive name -> path), sorted by name.

    Raises ValueError when a file is missing or is a symbolic link.
    """
    files = {name: source / name for name in BUILT}
    files['PRIVACY.md'] = ROOT / 'PRIVACY.md'
    files['THIRD_PARTY_NOTICES.md'] = ROOT / 'THIRD_PARTY_NOTICES.md'
    if (ROOT / 'LICENSE').is_file():
        files['LICENSE'] = ROOT / 'LICENSE'
    for name, path in files.items():
        if not path.is_file() or path.is_symlink():
            raise ValueError(f'Missing or unsafe runtime file: {name}. Run npm run build first.')
    return dict(sorted(files.items()))


def validate_assets(manifest, files):
    """Require every manifest and Settings asset to be packaged.

    Also rejects a service worker that would load scripts at runtime.
    """
    assets = [manifest['background']['service_worker'], manifest['options_page']]
    assets.extend(manifest['icons'].values())
    for script in manifest['content_scripts']:
        assets.extend(script['js'])
        assets.extend(script.get('css', []))
    for group in manifest['web_accessible_resources']:
        assets.extend(group['resources'])
    source = files['options.html'].read_text(encoding='utf-8')
    assets.extend(re.findall(r"<(?:script|link|img)\b[^>]*\b(?:src|href)=['\"]([^'\"]+)['\"]", source, re.IGNORECASE))
    if re.search(r'\bimportScripts\s*\(|\bimport\s*\(', files['background.js'].read_text(encoding='utf-8')):
        raise ValueError('The bundled service worker must not load scripts at runtime.')
    for name in assets:
        if name not in files:
            raise ValueError(f'Manifest/runtime asset missing from package allowlist: {name}')


def validate_tag(tag, version):
    """Require a stable vX.Y.Z tag matching the manifest, the newest changelog section and a LICENSE."""
    if not re.fullmatch(r'v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)', tag):
        raise ValueError('Release tags must have the form vX.Y.Z.')
    if tag != f'v{version}':
        raise ValueError(f'Tag {tag} does not match manifest version {version}.')
    changelog = (ROOT / 'CHANGELOG.md').read_text(encoding='utf-8')
    sections = re.findall(r'^## (\d+\.\d+\.\d+)$', changelog, re.MULTILINE)
    if not sections or sections[0] != version:
        raise ValueError('The newest changelog section must match the release tag.')
    license_path = ROOT / 'LICENSE'
    if not license_path.is_file() or license_path.is_symlink() or not license_path.read_text(encoding='utf-8').strip():
        raise ValueError('Release publication requires a maintainer-approved LICENSE.')


def checksum(path):
    """Return the SHA-256 hex digest of a file."""
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify(path, files):
    """Verify entry names, CRCs, deterministic metadata, every byte and the SHA-256 file."""
    with ZipFile(path) as archive:
        names = archive.namelist()
        if names != list(files) or len(names) != len(set(names)):
            raise ValueError('Archive contents differ from the runtime allowlist.')
        if archive.testzip() is not None:
            raise ValueError('Archive CRC verification failed.')
        for entry in archive.infolist():
            if (entry.date_time != TIMESTAMP or entry.compress_type != ZIP_STORED
                    or entry.create_system != 3 or entry.external_attr >> 16 != 0o100644):
                raise ValueError(f'Non-deterministic ZIP metadata: {entry.filename}')
            if archive.read(entry) != files[entry.filename].read_bytes():
                raise ValueError(f'Packaged bytes differ from the build: {entry.filename}')
    recorded = path.with_suffix('.sha256').read_text(encoding='ascii')
    expected = f'{checksum(path)}  {path.name}\n'
    if recorded != expected:
        raise ValueError('SHA-256 file does not match the archive.')


def main():
    """Validate the release metadata, then build or verify the ZIP."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=ROOT / 'build', help='Bundled extension directory (npm run build).')
    parser.add_argument('--output', type=Path, default=ROOT / 'dist')
    parser.add_argument('--verify', type=Path, help='Verify an existing ZIP against the bundled build.')
    parser.add_argument('--tag', help='Validate the stable release tag before packaging/verifying.')
    arguments = parser.parse_args()
    manifest = json.loads((ROOT / 'src' / 'manifest.json').read_text(encoding='utf-8'))
    version = manifest['version']
    if not isinstance(version, str) or not re.fullmatch(r'(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)', version):
        raise ValueError('Manifest must use a three-component numeric release version.')
    components = [int(part) for part in version.split('.')]
    if not any(components) or any(part > 65535 for part in components):
        raise ValueError('Manifest version components must follow Chrome version limits.')
    if arguments.tag:
        validate_tag(arguments.tag, version)
    files = package_files(arguments.source)
    if files['manifest.json'].read_bytes() != (ROOT / 'src' / 'manifest.json').read_bytes():
        raise ValueError('The build manifest differs from src/manifest.json. Run npm run build.')
    validate_assets(manifest, files)
    if arguments.verify:
        verify(arguments.verify, files)
        print(f'Verified {arguments.verify.name}: {len(files)} files, SHA-256 and build bytes.')
        return
    arguments.output.mkdir(parents=True, exist_ok=True)
    path = arguments.output / f'codetree-{version}.zip'
    with ZipFile(path, 'w') as archive:
        for name, source in files.items():
            entry = ZipInfo(name, TIMESTAMP)
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            entry.compress_type = ZIP_STORED
            archive.writestr(entry, source.read_bytes())
    path.with_suffix('.sha256').write_text(f'{checksum(path)}  {path.name}\n', encoding='ascii')
    verify(path, files)
    print(f'Built {path.name}: {len(files)} files, {path.stat().st_size} bytes, SHA-256 {checksum(path)}.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, BadZipFile) as error:
        raise SystemExit(str(error)) from error
