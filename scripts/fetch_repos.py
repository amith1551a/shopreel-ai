"""Fetch optional upstream sources at the exact revisions inspected for this starter."""
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def run(args):
    subprocess.run(args, check=True)


def main():
    manifest = json.loads((ROOT / 'repos.lock.json').read_text())
    for repo in manifest['repositories']:
        destination = ROOT / 'third_party' / repo['directory']
        if destination.exists():
            if not (destination / '.git').exists():
                print(f"Cannot overwrite {destination}; move or rename that folder first.", file=sys.stderr)
                return 1
            current = subprocess.check_output(['git', '-C', str(destination), 'rev-parse', 'HEAD'], text=True).strip()
            if current == repo['commit']:
                print(f"Already present: {repo['directory']} at {current[:12]}")
                continue
            print(f"{destination} already has a different revision; leaving it untouched.", file=sys.stderr)
            return 1
        run(['git', 'clone', '--no-checkout', '--filter=blob:none', repo['url'], str(destination)])
        run(['git', '-C', str(destination), 'fetch', '--depth', '1', 'origin', repo['commit']])
        run(['git', '-C', str(destination), 'checkout', '--detach', repo['commit']])
    print('Sources ready. Only MoviePy is currently integrated. No services were started.')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (subprocess.CalledProcessError, FileNotFoundError) as error:
        print(f'Fetch failed. Check Git installation and network access: {error}', file=sys.stderr)
        sys.exit(1)
