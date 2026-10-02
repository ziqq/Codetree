"""Build and verify a deterministic, dependency-free Chrome extension ZIP."""

import argparse
import hashlib
import json
import re
from pathlib import Path
from zipfile import ZIP_STORED, BadZipFile, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parent.parent
RUNTIME = (
    'manifest.json', 'core.js', 'background.js', 'gitlab.js', 'content.js',
    'sidebar.css', 'options.html', 'options.js', 'options.css',
    'icons/icon16.png', 'icons/icon48.png', 'icons/icon128.png', 'PRIVACY.md',
)
TIMESTAMP = (2026, 1, 1, 0, 0, 0)


def package_files():
    files = list(RUNTIME)
    if (ROOT / 'LICENSE').is_file():
        files.append('LICENSE')
    for name in files:
        path = ROOT / name
        if not path.is_file() or path.is_symlink():
            raise ValueError(f'Missing or unsafe runtime file: {name}')
    return sorted(files)


def validate_assets(manifest, files):
    assets = [manifest['background']['service_worker'], manifest['options_page']]
    assets.extend(manifest['icons'].values())
    for script in manifest['content_scripts']:
        assets.extend(script['js'])
        assets.extend(script.get('css', []))
    for group in manifest['web_accessible_resources']:
        assets.extend(group['resources'])
    for name in ('background.js', 'options.html'):
        source = (ROOT / name).read_text(encoding='utf-8')
        if name.endswith('.js'):
            for call in re.findall(r'importScripts\(([^)]+)\)', source):
                assets.extend(re.findall(r"['\"]([^'\"]+)['\"]", call))
        else:
            assets.extend(re.findall(r"(?:src|href)=['\"]([^'\"]+)['\"]", source))
    for name in assets:
        if name not in files:
            raise ValueError(f'Manifest/runtime asset missing from package allowlist: {name}')


def validate_tag(tag, version):
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
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify(path, files):
    with ZipFile(path) as archive:
        names = archive.namelist()
        if names != files or len(names) != len(set(names)):
            raise ValueError('Archive contents differ from the runtime allowlist.')
        if archive.testzip() is not None:
            raise ValueError('Archive CRC verification failed.')
        for entry in archive.infolist():
            if (entry.date_time != TIMESTAMP or entry.compress_type != ZIP_STORED
                    or entry.create_system != 3 or entry.external_attr >> 16 != 0o100644):
                raise ValueError(f'Non-deterministic ZIP metadata: {entry.filename}')
            if archive.read(entry) != (ROOT / entry.filename).read_bytes():
                raise ValueError(f'Packaged bytes differ from source: {entry.filename}')
    recorded = path.with_suffix('.sha256').read_text(encoding='ascii')
    expected = f'{checksum(path)}  {path.name}\n'
    if recorded != expected:
        raise ValueError('SHA-256 file does not match the archive.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'dist')
    parser.add_argument('--verify', type=Path, help='Verify an existing ZIP against this checkout.')
    parser.add_argument('--tag', help='Validate the stable release tag before packaging/verifying.')
    arguments = parser.parse_args()
    manifest = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
    version = manifest['version']
    if not isinstance(version, str) or not re.fullmatch(r'(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)', version):
        raise ValueError('Manifest must use a three-component numeric release version.')
    components = [int(part) for part in version.split('.')]
    if not any(components) or any(part > 65535 for part in components):
        raise ValueError('Manifest version components must follow Chrome version limits.')
    if arguments.tag:
        validate_tag(arguments.tag, version)
    files = package_files()
    validate_assets(manifest, files)
    if arguments.verify:
        verify(arguments.verify, files)
        print(f'Verified {arguments.verify.name}: {len(files)} files, SHA-256 and source bytes.')
        return
    arguments.output.mkdir(parents=True, exist_ok=True)
    path = arguments.output / f'code-tree-{version}.zip'
    with ZipFile(path, 'w') as archive:
        for name in files:
            entry = ZipInfo(name, TIMESTAMP)
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            entry.compress_type = ZIP_STORED
            archive.writestr(entry, (ROOT / name).read_bytes())
    path.with_suffix('.sha256').write_text(f'{checksum(path)}  {path.name}\n', encoding='ascii')
    verify(path, files)
    print(f'Built {path.name}: {len(files)} files, {path.stat().st_size} bytes, SHA-256 {checksum(path)}.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, BadZipFile) as error:
        raise SystemExit(str(error)) from error
